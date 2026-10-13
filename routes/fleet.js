// Parco mezzi. Tutti: vedono quante auto sono libere per categoria, chiedono una categoria (con note), seguono le
// proprie prenotazioni, ritirano e riconsegnano col QR code e segnalano problemi (diventano ticket ai gestori).
// Gestori (fleet_managers, più gli amministratori): anagrafica, approvazioni con scelta del mezzo, planner,
// scadenze, manutenzioni, costi, storico di chi ha usato ogni mezzo, «chi guidava il…» per le multe.
const QRCode = require('qrcode');
const express = require('express');
const { planImport, applyImport, iconFor, CATEGORY_ICONS } = require('../lib/fleet-import');
const { HttpError, v } = require('../lib/http');
const { checkOwnMedia, sniffImage, toBuffer } = require('../lib/media');
const { newQrToken, vehicleName, itDateTime, esc, DEADLINE_LABEL } = require('../lib/fleet');

const OWNERSHIP = ['proprieta', 'noleggio', 'leasing', 'comodato'];
const VEHICLE_STATUS = ['attivo', 'fuori_servizio', 'dismesso'];
const DEADLINE_KINDS = Object.keys(DEADLINE_LABEL);
const MAINT_KINDS = ['tagliando', 'riparazione', 'gomme', 'carrozzeria', 'revisione', 'altro'];
const COST_KINDS = ['carburante', 'pedaggio', 'multa', 'assicurazione', 'bollo', 'noleggio', 'lavaggio', 'parcheggio', 'altro'];
const MAX_BOOKING_DAYS = 92;

const duplicate = err => err?.code === '23505';
const pick = obj => Object.fromEntries(Object.entries(obj).filter(([, val]) => val !== undefined));

// Data e ora: ISO con fuso (dal browser) → Date; vuoto non ammesso.
function when(value, field, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `Il campo «${field}» è obbligatorio`);
    return undefined;
  }
  const d = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(d.getTime())) throw new HttpError(400, `La data «${field}» non è valida`);
  return d;
}
function money(value, field, { required = false } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') {
    if (required) throw new HttpError(400, `Il campo «${field}» è obbligatorio`);
    return null;
  }
  const n = Number(String(value).replace(/\s|€/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 1e7) throw new HttpError(400, `L'importo «${field}» non è valido`);
  return Math.round(n * 100) / 100;
}
const km = (value, field = 'km') => v.int(value, field, { min: 0, max: 5000000, nullable: true });
const plate = value => {
  const s = v.text(value, 'targa', { max: 20 });
  return s === undefined ? undefined : s.replace(/\s+/g, '').toUpperCase() || null;
};

function registerFleet(app, { db, fleet, isAdmin, baseUrl }) {
  // ── utilità ────────────────────────────────────────────────────────────────
  async function getVehicle(id) {
    const [s] = await fleet.vehicleStates('v.id = $1', [id]);
    if (!s) throw new HttpError(404, 'Mezzo non trovato');
    return s;
  }
  async function getBooking(id) {
    const { rows: [b] } = await db.query(
      `SELECT b.*, c.name AS category_name, c.icon AS category_icon, u.name AS requester_name, u.email AS requester_email,
              v.code, v.plate, v.make, v.model, v.qr_token, d.name AS decided_by_name
         FROM vehicle_bookings b JOIN vehicle_categories c ON c.id = b.category_id JOIN users u ON u.id = b.requester_id
         LEFT JOIN vehicles v ON v.id = b.vehicle_id LEFT JOIN users d ON d.id = b.decided_by
        WHERE b.id = $1`, [id]);
    if (!b) throw new HttpError(404, 'Prenotazione non trovata');
    return b;
  }
  // La vede chi l'ha chiesta e i gestori; agli altri sembra non esistere.
  async function visibleBooking(req, id) {
    const b = await getBooking(id);
    if (b.requester_id !== req.user.id && !(await fleet.isManager(req))) throw new HttpError(404, 'Prenotazione non trovata');
    return b;
  }
  const bookingLink = id => `/mezzi/prenotazioni/${id}`;

  async function setVehicleKm(q, vehicleId, value) {
    if (value === null || value === undefined) return;
    await q.query('UPDATE vehicles SET km = GREATEST(COALESCE(km, 0), $2), km_at = now() WHERE id = $1', [vehicleId, value]);
  }

  // ── panoramica (tutti) ─────────────────────────────────────────────────────
  app.get('/api/mezzi', async (req, res) => {
    const manager = await fleet.isManager(req);
    const [{ rows: categories }, states, { rows: mine }] = await Promise.all([
      db.query('SELECT * FROM vehicle_categories WHERE NOT archived ORDER BY position, lower(name)'),
      fleet.vehicleStates("v.status <> 'dismesso'"),
      db.query(
        `SELECT b.*, c.name AS category_name, c.icon AS category_icon, v.code, v.plate, v.make, v.model
           FROM vehicle_bookings b JOIN vehicle_categories c ON c.id = b.category_id LEFT JOIN vehicles v ON v.id = b.vehicle_id
          WHERE b.requester_id = $1 AND (b.status IN ('richiesta', 'approvata', 'in_corso') OR b.end_at > now() - interval '30 days')
          ORDER BY CASE b.status WHEN 'in_corso' THEN 0 WHEN 'approvata' THEN 1 WHEN 'richiesta' THEN 2 ELSE 3 END, b.start_at DESC
          LIMIT 50`, [req.user.id]),
    ]);
    const byCat = new Map(categories.map(c => [c.id, { ...c, total: 0, libero: 0, in_uso: 0, prenotato: 0, manutenzione: 0, fuori_servizio: 0, assegnato: 0 }]));
    for (const s of states) {
      const c = byCat.get(s.category_id);
      if (!c) continue;
      c.total++;
      c[s.state] = (c[s.state] || 0) + 1;
    }
    const out = { manager, categories: [...byCat.values()], mine };
    if (manager) {
      const [{ rows: [counts] }, { rows: deadlines }] = await Promise.all([
        db.query(`SELECT (SELECT COUNT(*)::int FROM vehicle_bookings WHERE status = 'richiesta') AS pending,
                         (SELECT COUNT(*)::int FROM tickets WHERE vehicle_id IS NOT NULL AND status <> 'done') AS reports,
                         (SELECT COUNT(*)::int FROM vehicle_bookings WHERE status = 'in_corso' AND end_at < now()) AS late`),
        db.query(
          `SELECT d.*, v.code, v.plate, v.make, v.model, v.km AS vehicle_km FROM vehicle_deadlines d JOIN vehicles v ON v.id = d.vehicle_id
            WHERE d.done_at IS NULL AND v.status <> 'dismesso'
              AND (d.due_date <= CURRENT_DATE + 30 OR (d.due_km IS NOT NULL AND v.km >= d.due_km - 1000))
            ORDER BY d.due_date NULLS LAST LIMIT 30`),
      ]);
      Object.assign(out, { vehicles: states, counts, deadlines });
    }
    res.json(out);
  });

  // Quanti mezzi della categoria sono liberi nell'intervallo (per chi prenota: solo il numero).
  app.get('/api/mezzi/disponibilita', async (req, res) => {
    const categoryId = v.int(req.query.category_id, 'categoria', { min: 1 });
    const start = when(req.query.start, 'dal'), end = when(req.query.end, 'al');
    if (end <= start) throw new HttpError(400, 'La fine deve essere dopo l\'inizio');
    const free = await fleet.freeVehicles({ categoryId, start, end });
    const manager = await fleet.isManager(req);
    res.json({ free: free.length, vehicles: manager ? free.map(x => ({ id: x.id, code: x.code, plate: x.plate, make: x.make, model: x.model, category_id: x.category_id })) : undefined });
  });

  // ── prenotazioni ───────────────────────────────────────────────────────────
  app.post('/api/mezzi/prenotazioni', async (req, res) => {
    const b = req.body || {};
    const categoryId = v.int(b.category_id, 'categoria', { min: 1 });
    if (!categoryId) throw new HttpError(400, 'Scegli la categoria di mezzo');
    const { rows: [cat] } = await db.query('SELECT * FROM vehicle_categories WHERE id = $1 AND NOT archived', [categoryId]);
    if (!cat) throw new HttpError(400, 'Categoria non trovata');
    const start = when(b.start_at, 'dal'), end = when(b.end_at, 'al');
    if (end <= start) throw new HttpError(400, 'La riconsegna deve essere dopo il ritiro');
    if (end < new Date()) throw new HttpError(400, 'Le date sono già passate');
    if ((end - start) / 86400000 > MAX_BOOKING_DAYS) throw new HttpError(400, `Una prenotazione dura al massimo ${MAX_BOOKING_DAYS} giorni: per periodi più lunghi chiedi un'assegnazione al gestore`);
    const purpose = v.text(b.purpose, 'motivo', { max: 300, required: true });
    const fields = {
      requester_id: req.user.id, category_id: categoryId, start_at: start, end_at: end, purpose,
      destination: v.text(b.destination, 'destinazione', { max: 300 }) || '',
      notes: v.text(b.notes, 'note', { max: 2000 }) || '',
      project_id: v.int(b.project_id, 'progetto', { min: 1, nullable: true }) || null,
    };
    const cols = Object.keys(fields);
    const { rows: [row] } = await db.query(
      `INSERT INTO vehicle_bookings (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, Object.values(fields));
    const booking = await getBooking(row.id);
    const free = (await fleet.freeVehicles({ categoryId, start, end })).length;
    const approvers = (await fleet.approverIds()).filter(id => id !== req.user.id);
    const when2 = `${itDateTime(start)} → ${itDateTime(end)}`;
    await fleet.notify(approvers, { actorId: req.user.id, body: `chiede un mezzo «${cat.name}» ${when2}${free ? '' : ' (nessun mezzo libero in quelle date)'}: ${purpose}`, link: bookingLink(row.id) });
    fleet.mail(req.user.id, await fleet.usersByIds(approvers), {
      subject: `Richiesta mezzo: ${cat.name}, ${itDateTime(start)}`,
      lines: [`<b>${esc(req.user.name)}</b> chiede un mezzo della categoria <b>${esc(cat.name)}</b>.`,
        `Dal ${esc(itDateTime(start))} al ${esc(itDateTime(end))}.`, `Motivo: ${esc(purpose)}${fields.destination ? ` · destinazione ${esc(fields.destination)}` : ''}`,
        fields.notes ? `Note: ${esc(fields.notes)}` : '', free ? `Mezzi liberi in quelle date: ${free}.` : '<b>In quelle date non c\'è nessun mezzo libero della categoria.</b>'].filter(Boolean),
      link: bookingLink(row.id), linkLabel: 'Approva o rifiuta',
    });
    res.status(201).json({ ...booking, free });
  });

  app.get('/api/mezzi/prenotazioni', async (req, res) => {
    const manager = await fleet.isManager(req);
    const scope = req.query.scope === 'mine' || !manager ? 'mine' : 'all';
    const params = [];
    const where = [];
    const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };
    if (scope === 'mine') add('b.requester_id = ?', req.user.id);
    if (req.query.status) add('b.status = ANY(?::text[])', String(req.query.status).split(',').slice(0, 6));
    if (req.query.vehicle_id) add('b.vehicle_id = ?', v.int(req.query.vehicle_id, 'mezzo', { min: 1 }));
    if (req.query.from) add('b.end_at >= ?', when(req.query.from, 'da'));
    if (req.query.to) add('b.start_at <= ?', when(req.query.to, 'a'));
    const { rows } = await db.query(
      `SELECT b.*, c.name AS category_name, c.icon AS category_icon, u.name AS requester_name, v.code, v.plate, v.make, v.model, d.name AS decided_by_name
         FROM vehicle_bookings b JOIN vehicle_categories c ON c.id = b.category_id JOIN users u ON u.id = b.requester_id
         LEFT JOIN vehicles v ON v.id = b.vehicle_id LEFT JOIN users d ON d.id = b.decided_by
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY CASE b.status WHEN 'richiesta' THEN 0 WHEN 'in_corso' THEN 1 WHEN 'approvata' THEN 2 ELSE 3 END, b.start_at DESC
        LIMIT 500`, params);
    res.json(rows);
  });

  app.get('/api/mezzi/prenotazioni/:id', async (req, res) => {
    const b = await visibleBooking(req, v.int(req.params.id, 'prenotazione', { min: 1 }));
    const manager = await fleet.isManager(req);
    // al gestore che deve decidere: i mezzi liberi della categoria (e degli altri, se serve cambiare)
    let free;
    if (manager && b.status === 'richiesta') {
      free = (await fleet.freeVehicles({ start: b.start_at, end: b.end_at, exceptBooking: b.id }))
        .map(x => ({ id: x.id, code: x.code, plate: x.plate, make: x.make, model: x.model, category_id: x.category_id }));
    }
    res.json({ ...b, manager, free });
  });

  app.post('/api/mezzi/prenotazioni/:id/approva', async (req, res) => {
    await fleet.assertManager(req);
    const id = v.int(req.params.id, 'prenotazione', { min: 1 });
    const vehicleId = v.int(req.body?.vehicle_id, 'mezzo', { min: 1 });
    if (!vehicleId) throw new HttpError(400, 'Scegli il mezzo da assegnare');
    const note = v.text(req.body?.note, 'nota', { max: 1000 }) || '';
    await db.tx(async q => {
      const { rows: [b] } = await q.query('SELECT * FROM vehicle_bookings WHERE id = $1 FOR UPDATE', [id]);
      if (!b) throw new HttpError(404, 'Prenotazione non trovata');
      if (b.status !== 'richiesta') throw new HttpError(409, 'La richiesta è già stata decisa');
      // il controllo dentro la transazione, con il mezzo bloccato: due gestori non lo danno a due persone
      await q.query('SELECT id FROM vehicles WHERE id = $1 FOR UPDATE', [vehicleId]);
      const conflict = await fleet.conflictFor(vehicleId, b.start_at, b.end_at, id, q);
      if (conflict) throw new HttpError(409, conflict);
      await q.query(`UPDATE vehicle_bookings SET status = 'approvata', vehicle_id = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`,
        [id, vehicleId, req.user.id, note]);
    });
    const b = await getBooking(id);
    const name = vehicleName(b);
    await fleet.notify([b.requester_id], { actorId: req.user.id, body: `ha approvato la tua richiesta: ${name}, ${itDateTime(b.start_at)} → ${itDateTime(b.end_at)}.${note ? ` ${note}` : ''}`, link: bookingLink(id) });
    fleet.mail(req.user.id, [{ name: b.requester_name, email: b.requester_email }], {
      subject: `Mezzo approvato: ${name}`,
      lines: [`<b>${esc(req.user.name)}</b> ha approvato la tua richiesta.`, `Mezzo: <b>${esc(name)}</b>`,
        `Dal ${esc(itDateTime(b.start_at))} al ${esc(itDateTime(b.end_at))}.`, note ? `Nota: ${esc(note)}` : '',
        'Al ritiro inquadra il QR code del mezzo e scrivi i km.'].filter(Boolean),
      link: bookingLink(id), linkLabel: 'Apri la prenotazione',
    });
    res.json(b);
  });

  app.post('/api/mezzi/prenotazioni/:id/rifiuta', async (req, res) => {
    await fleet.assertManager(req);
    const id = v.int(req.params.id, 'prenotazione', { min: 1 });
    const note = v.text(req.body?.note, 'motivo', { max: 1000, required: true });
    const { rowCount } = await db.query(
      `UPDATE vehicle_bookings SET status = 'rifiutata', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1 AND status = 'richiesta'`,
      [id, req.user.id, note]);
    if (!rowCount) throw new HttpError(409, 'La richiesta è già stata decisa');
    const b = await getBooking(id);
    await fleet.notify([b.requester_id], { actorId: req.user.id, body: `ha rifiutato la tua richiesta di un mezzo «${b.category_name}» (${itDateTime(b.start_at)}): ${note}`, link: bookingLink(id) });
    fleet.mail(req.user.id, [{ name: b.requester_name, email: b.requester_email }], {
      subject: `Richiesta mezzo non approvata: ${b.category_name}`,
      lines: [`<b>${esc(req.user.name)}</b> non ha approvato la tua richiesta di un mezzo «${esc(b.category_name)}» del ${esc(itDateTime(b.start_at))}.`, `Motivo: ${esc(note)}`],
      link: bookingLink(id), linkLabel: 'Apri la richiesta',
    });
    res.json(b);
  });

  // Annulla: chi ha chiesto finché non ha ritirato; i gestori sempre, tranne quelle concluse.
  app.post('/api/mezzi/prenotazioni/:id/annulla', async (req, res) => {
    const id = v.int(req.params.id, 'prenotazione', { min: 1 });
    const b = await visibleBooking(req, id);
    const manager = await fleet.isManager(req);
    const allowed = manager ? ['richiesta', 'approvata'] : b.requester_id === req.user.id ? ['richiesta', 'approvata'] : [];
    if (!allowed.includes(b.status)) throw new HttpError(409, b.status === 'in_corso' ? 'Il mezzo è già stato ritirato: va riconsegnato' : 'La prenotazione non si può più annullare');
    await db.query(`UPDATE vehicle_bookings SET status = 'annullata' WHERE id = $1`, [id]);
    if (b.requester_id === req.user.id) {
      if (b.status === 'approvata' || b.status === 'richiesta') {
        await fleet.notify(await fleet.approverIds(), { actorId: req.user.id, body: `ha annullato la prenotazione${b.vehicle_id ? ` di ${vehicleName(b)}` : ` (${b.category_name})`} del ${itDateTime(b.start_at)}.`, link: bookingLink(id) });
      }
    } else {
      await fleet.notify([b.requester_id], { actorId: req.user.id, body: `ha annullato la tua prenotazione${b.vehicle_id ? ` di ${vehicleName(b)}` : ''} del ${itDateTime(b.start_at)}.`, link: bookingLink(id) });
    }
    res.json(await getBooking(id));
  });

  // Il gestore cambia date o mezzo di una prenotazione approvata (o allunga quella in corso).
  app.patch('/api/mezzi/prenotazioni/:id', async (req, res) => {
    await fleet.assertManager(req);
    const id = v.int(req.params.id, 'prenotazione', { min: 1 });
    const b0 = await getBooking(id);
    if (!['approvata', 'in_corso', 'richiesta'].includes(b0.status)) throw new HttpError(409, 'La prenotazione è chiusa');
    const start = b0.status === 'in_corso' ? new Date(b0.start_at) : (when(req.body?.start_at, 'dal', { required: false }) || new Date(b0.start_at));
    const end = when(req.body?.end_at, 'al', { required: false }) || new Date(b0.end_at);
    if (end <= start) throw new HttpError(400, 'La riconsegna deve essere dopo il ritiro');
    const vehicleId = b0.status === 'in_corso' ? b0.vehicle_id : (v.int(req.body?.vehicle_id, 'mezzo', { min: 1 }) || b0.vehicle_id);
    await db.tx(async q => {
      if (vehicleId && b0.status !== 'richiesta') {
        await q.query('SELECT id FROM vehicles WHERE id = $1 FOR UPDATE', [vehicleId]);
        const conflict = await fleet.conflictFor(vehicleId, start, end, id, q);
        if (conflict) throw new HttpError(409, conflict);
      }
      await q.query('UPDATE vehicle_bookings SET start_at = $2, end_at = $3, vehicle_id = $4 WHERE id = $1', [id, start, end, b0.status === 'richiesta' ? null : vehicleId]);
    });
    // i promemoria della riconsegna ripartono dalla nuova data
    await db.query("DELETE FROM fleet_reminder_log WHERE key IN ($1, $2)", [`soon:${id}`, `tomorrow:${id}`]);
    const b = await getBooking(id);
    if (b.requester_id !== req.user.id) {
      await fleet.notify([b.requester_id], { actorId: req.user.id, body: `ha cambiato la tua prenotazione: ${b.vehicle_id ? `${vehicleName(b)}, ` : ''}${itDateTime(b.start_at)} → ${itDateTime(b.end_at)}.`, link: bookingLink(id) });
    }
    res.json(b);
  });

  // Ritiro: chi ha prenotato (o un gestore), con i km sul cruscotto.
  app.post('/api/mezzi/prenotazioni/:id/ritiro', async (req, res) => {
    const id = v.int(req.params.id, 'prenotazione', { min: 1 });
    const b = await visibleBooking(req, id);
    if (b.status !== 'approvata') throw new HttpError(409, b.status === 'in_corso' ? 'Il mezzo è già stato ritirato' : 'La prenotazione non è approvata');
    if (new Date(b.start_at) - Date.now() > 12 * 3600000) throw new HttpError(409, `Il ritiro è previsto ${itDateTime(b.start_at)}: si può fare al massimo 12 ore prima`);
    const pickupKm = km(req.body?.km);
    await db.tx(async q => {
      const { rows: [busy] } = await q.query(
        "SELECT b.id, u.name FROM vehicle_bookings b JOIN users u ON u.id = b.requester_id WHERE b.vehicle_id = $1 AND b.status = 'in_corso' AND b.id <> $2", [b.vehicle_id, id]);
      if (busy) throw new HttpError(409, `Il mezzo risulta ancora in uso da ${busy.name}: va prima riconsegnato`);
      const { rows: [veh] } = await q.query('SELECT km FROM vehicles WHERE id = $1', [b.vehicle_id]);
      if (pickupKm !== null && pickupKm !== undefined && veh.km !== null && pickupKm < veh.km) throw new HttpError(400, `I km non possono essere meno degli ultimi registrati (${veh.km.toLocaleString('it-IT')})`);
      await q.query(`UPDATE vehicle_bookings SET status = 'in_corso', picked_up_at = now(), pickup_km = $2, pickup_by = $3 WHERE id = $1`, [id, pickupKm ?? null, req.user.id]);
      await setVehicleKm(q, b.vehicle_id, pickupKm);
    });
    res.json(await getBooking(id));
  });

  // Riconsegna: km, carburante, note (danni). Con note di danni, i gestori ricevono un ticket.
  app.post('/api/mezzi/prenotazioni/:id/riconsegna', async (req, res) => {
    const id = v.int(req.params.id, 'prenotazione', { min: 1 });
    const b = await visibleBooking(req, id);
    if (b.status !== 'in_corso') throw new HttpError(409, 'Il mezzo non risulta ritirato');
    const returnKm = km(req.body?.km);
    const fuel = v.text(req.body?.fuel, 'carburante', { max: 40 }) || '';
    const notes = v.text(req.body?.notes, 'note', { max: 2000 }) || '';
    const damage = req.body?.damage === true;
    if (returnKm !== null && returnKm !== undefined && b.pickup_km !== null && returnKm < b.pickup_km) {
      throw new HttpError(400, `I km alla riconsegna non possono essere meno di quelli al ritiro (${b.pickup_km.toLocaleString('it-IT')})`);
    }
    await db.tx(async q => {
      await q.query(`UPDATE vehicle_bookings SET status = 'conclusa', returned_at = now(), return_km = $2, return_fuel = $3, return_notes = $4 WHERE id = $1`,
        [id, returnKm ?? null, fuel, notes]);
      await setVehicleKm(q, b.vehicle_id, returnKm);
    });
    const name = vehicleName(b);
    const managers = await fleet.approverIds();
    if (damage) await report(req, b.vehicle_id, { title: `Danno segnalato alla riconsegna`, description: notes || 'Danno segnalato alla riconsegna, senza descrizione.', blocking: false });
    else if (notes) await fleet.notify(managers, { actorId: req.user.id, body: `ha riconsegnato ${name} con una nota: ${notes}`, link: `/mezzi/v/${b.vehicle_id}` });
    res.json(await getBooking(id));
  });

  // Uso senza prenotazione, registrato dal gestore (chiavi date a mano): nasce già ritirato.
  app.post('/api/mezzi/uso-diretto', async (req, res) => {
    await fleet.assertManager(req);
    const b = req.body || {};
    const vehicleId = v.int(b.vehicle_id, 'mezzo', { min: 1 });
    const userId = v.int(b.user_id, 'persona', { min: 1 });
    if (!vehicleId || !userId) throw new HttpError(400, 'Scegli il mezzo e la persona');
    const start = new Date(), end = when(b.end_at, 'riconsegna prevista');
    if (end <= start) throw new HttpError(400, 'La riconsegna deve essere nel futuro');
    const pickupKm = km(b.km);
    const id = await db.tx(async q => {
      const { rows: [veh] } = await q.query('SELECT * FROM vehicles WHERE id = $1 FOR UPDATE', [vehicleId]);
      if (!veh) throw new HttpError(404, 'Mezzo non trovato');
      const conflict = await fleet.conflictFor(vehicleId, start, end, null, q);
      if (conflict) throw new HttpError(409, conflict);
      const { rows: [row] } = await q.query(
        `INSERT INTO vehicle_bookings (requester_id, category_id, vehicle_id, start_at, end_at, purpose, status, decided_by, decided_at, picked_up_at, pickup_km, pickup_by, walk_in)
         VALUES ($1, $2, $3, $4, $5, $6, 'in_corso', $7, now(), now(), $8, $7, true) RETURNING id`,
        [userId, veh.category_id, vehicleId, start, end, v.text(b.purpose, 'motivo', { max: 300 }) || 'Uso registrato dal gestore', req.user.id, pickupKm ?? null]);
      await setVehicleKm(q, vehicleId, pickupKm);
      return row.id;
    });
    const bk = await getBooking(id);
    await fleet.notify([userId], { actorId: req.user.id, body: `ti ha consegnato ${vehicleName(bk)}: riconsegna prevista ${itDateTime(end)}.`, link: bookingLink(id) });
    res.status(201).json(bk);
  });

  // ── QR code ────────────────────────────────────────────────────────────────
  // Chi inquadra il QR: il mezzo, il suo stato, e cosa può fare (ritirare/riconsegnare la sua prenotazione, segnalare).
  app.get('/api/mezzi/qr/:token', async (req, res) => {
    const token = v.text(req.params.token, 'codice', { max: 40, required: true });
    const [veh] = await fleet.vehicleStates('v.qr_token = $1', [token]);
    if (!veh) throw new HttpError(404, 'QR code non riconosciuto: il mezzo potrebbe essere stato tolto');
    const { rows: mine } = await db.query(
      `SELECT b.* FROM vehicle_bookings b WHERE b.vehicle_id = $1 AND b.requester_id = $2
          AND (b.status = 'in_corso' OR (b.status = 'approvata' AND b.end_at > now() AND b.start_at < now() + interval '12 hours'))
        ORDER BY (b.status = 'in_corso') DESC, b.start_at LIMIT 1`, [veh.id, req.user.id]);
    const manager = await fleet.isManager(req);
    res.json({ vehicle: publicVehicle(veh, manager), booking: mine[0] || null, manager });
  });

  // Quello che di un mezzo vedono tutti (niente telepass, carta carburante, note interne).
  function publicVehicle(x, manager) {
    if (manager) return x;
    const keep = ['id', 'code', 'plate', 'make', 'model', 'year', 'fuel', 'seats', 'category_id', 'category_name', 'location', 'km', 'state',
      'photo_media_id', 'current_end', 'next_start', 'maintenance_end', 'status', 'status_note'];
    return Object.fromEntries(keep.map(k => [k, x[k]]));
  }

  // Segnalazione: un ticket «Mezzo …» assegnato ai gestori; se il mezzo non è utilizzabile va fuori servizio subito.
  async function report(req, vehicleId, { title, description, blocking }) {
    const veh = await getVehicle(vehicleId);
    const managers = await fleet.approverIds();
    const name = vehicleName(veh);
    const ticketId = await db.tx(async q => {
      const { rows: [{ p }] } = await q.query('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM tickets');
      const { rows: [t] } = await q.query(
        `INSERT INTO tickets (title, description, priority, created_by, position, vehicle_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [`Mezzo ${veh.code}${veh.plate ? ` (${veh.plate})` : ''}: ${title}`.slice(0, 300),
          `${description}\n\nSegnalato da ${req.user.name} dal QR code del mezzo ${name}.${blocking ? '\nIl mezzo è stato segnalato come NON utilizzabile.' : ''}`,
          blocking ? 'urgent' : 'high', req.user.id, p, vehicleId]);
      for (const uid of managers) await q.query('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [t.id, uid]);
      if (blocking) {
        await q.query(`UPDATE vehicles SET status = 'fuori_servizio', status_note = $2, updated_at = now() WHERE id = $1 AND status = 'attivo'`,
          [vehicleId, `Segnalato non utilizzabile da ${req.user.name}: ${title}`.slice(0, 500)]);
      }
      return t.id;
    });
    await fleet.notify(managers, { actorId: req.user.id, body: `ha segnalato un problema su ${name}${blocking ? ' (NON utilizzabile, messo fuori servizio)' : ''}: ${title}`, link: `/tickets/${ticketId}` });
    fleet.mail(req.user.id, await fleet.usersByIds(managers.filter(id => id !== req.user.id)), {
      subject: `${blocking ? 'Mezzo fermo' : 'Segnalazione'}: ${name}`,
      lines: [`<b>${esc(req.user.name)}</b> ha segnalato un problema sul mezzo <b>${esc(name)}</b>.`, `<b>${esc(title)}</b>`, esc(description),
        blocking ? '<b>Il mezzo è segnalato come non utilizzabile ed è stato messo fuori servizio.</b>' : ''].filter(Boolean),
      link: `/tickets/${ticketId}`, linkLabel: 'Apri il ticket',
    });
    return ticketId;
  }

  app.post('/api/mezzi/:id/segnala', async (req, res) => {
    const vehicleId = v.int(req.params.id, 'mezzo', { min: 1 });
    const title = v.text(req.body?.title, 'problema', { max: 200, required: true });
    const description = v.text(req.body?.description, 'descrizione', { max: 5000 }) || '';
    const ticketId = await report(req, vehicleId, { title, description, blocking: req.body?.blocking === true });
    res.status(201).json({ ticket_id: ticketId });
  });

  // Immagine del QR (SVG): punta a /m/<codice>, che dopo il login apre il mezzo in Alma Planet.
  app.get('/api/mezzi/:id/qr.svg', async (req, res) => {
    await fleet.assertManager(req);
    const { rows: [veh] } = await db.query('SELECT qr_token FROM vehicles WHERE id = $1', [v.int(req.params.id, 'mezzo', { min: 1 })]);
    if (!veh) throw new HttpError(404, 'Mezzo non trovato');
    const svg = await QRCode.toString(`${baseUrl}/m/${veh.qr_token}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').set('Cache-Control', 'private, max-age=3600').send(svg);
  });

  // ── anagrafica (gestori) ───────────────────────────────────────────────────
  function readVehicle(b, { partial }) {
    return pick({
      category_id: v.int(b.category_id, 'categoria', { min: 1 }) ?? (partial ? undefined : (() => { throw new HttpError(400, 'Scegli la categoria'); })()),
      code: v.text(b.code, 'codice', { max: 30, required: !partial }),
      plate: plate(b.plate),
      make: v.text(b.make, 'marca', { max: 60 }),
      model: v.text(b.model, 'modello', { max: 80 }),
      year: v.int(b.year, 'anno', { min: 1950, max: 2100, nullable: true }),
      fuel: v.text(b.fuel, 'alimentazione', { max: 30 }),
      seats: v.int(b.seats, 'posti', { min: 1, max: 99, nullable: true }),
      vin: v.text(b.vin, 'telaio', { max: 40 }),
      ownership: v.oneOf(b.ownership, 'possesso', OWNERSHIP),
      lessor: v.text(b.lessor, 'società di noleggio', { max: 120 }),
      contract_end: v.date(b.contract_end, 'fine contratto'),
      location: v.text(b.location, 'sede', { max: 120 }),
      km: km(b.km),
      fuel_card: v.text(b.fuel_card, 'carta carburante', { max: 60 }),
      telepass: v.text(b.telepass, 'telepass', { max: 60 }),
      assigned_user_id: v.int(b.assigned_user_id, 'assegnato a', { min: 1, nullable: true }),
      status: v.oneOf(b.status, 'stato', VEHICLE_STATUS),
      status_note: v.text(b.status_note, 'nota sullo stato', { max: 500 }),
      photo_media_id: v.int(b.photo_media_id, 'foto', { min: 1, nullable: true }),
      notes: v.text(b.notes, 'note', { max: 5000 }),
      env_class: v.text(b.env_class, 'classe ambientale', { max: 20 }),
      commessa: v.text(b.commessa, 'commessa', { max: 300 }),
      purchase_value: money(b.purchase_value, 'valore di acquisto'),
      depreciation_rate: money(b.depreciation_rate, 'aliquota di ammortamento'),
      hourly_cost: money(b.hourly_cost, 'costo orario'),
    });
  }

  app.get('/api/mezzi/elenco', async (req, res) => {
    await fleet.assertManager(req);
    res.json(await fleet.vehicleStates(req.query.dismessi === '1' ? 'true' : "v.status <> 'dismesso'"));
  });

  app.post('/api/mezzi/elenco', async (req, res) => {
    await fleet.assertManager(req);
    const f = readVehicle(req.body || {}, { partial: false });
    if (f.photo_media_id) await checkOwnMedia(db, [f.photo_media_id], req.user.id);
    f.qr_token = newQrToken();
    f.created_by = req.user.id;
    if (f.km !== undefined && f.km !== null) f.km_at = new Date();
    const cols = Object.keys(f);
    try {
      const { rows: [row] } = await db.query(
        `INSERT INTO vehicles (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, Object.values(f));
      res.status(201).json(await getVehicle(row.id));
    } catch (err) {
      if (duplicate(err)) throw new HttpError(409, 'Esiste già un mezzo con questo codice o questa targa');
      if (err.code === '23503') throw new HttpError(400, 'Categoria non trovata');
      throw err;
    }
  });

  // Scheda completa: tutti la possono aprire (dal QR o dal link), i dettagli riservati solo ai gestori.
  app.get('/api/mezzi/elenco/:id', async (req, res) => {
    const id = v.int(req.params.id, 'mezzo', { min: 1 });
    const manager = await fleet.isManager(req);
    const veh = await getVehicle(id);
    if (!manager) return res.json({ vehicle: publicVehicle(veh, false), manager: false });
    const q = (sql, params = [id]) => db.query(sql, params).then(r => r.rows);
    const [deadlines, maintenance, costs, bookings, tickets] = await Promise.all([
      q(`SELECT d.*, u.name AS done_by_name FROM vehicle_deadlines d LEFT JOIN users u ON u.id = d.done_by
          WHERE d.vehicle_id = $1 ORDER BY (d.done_at IS NULL) DESC, d.due_date NULLS LAST, d.id`),
      q(`SELECT m.*, u.name AS created_by_name,
                COALESCE((SELECT json_agg(json_build_object('id', f.id, 'name', f.name, 'size', f.size, 'mime', f.mime, 'created_at', f.created_at) ORDER BY f.id)
                            FROM vehicle_maintenance_files f WHERE f.maintenance_id = m.id), '[]') AS files
           FROM vehicle_maintenance m LEFT JOIN users u ON u.id = m.created_by WHERE m.vehicle_id = $1 ORDER BY m.start_date DESC, m.id DESC`),
      q('SELECT c.*, u.name AS driver_name FROM vehicle_costs c LEFT JOIN users u ON u.id = c.driver_id WHERE c.vehicle_id = $1 ORDER BY c.occurred_at DESC LIMIT 300'),
      q(`SELECT b.*, u.name AS requester_name FROM vehicle_bookings b JOIN users u ON u.id = b.requester_id
          WHERE b.vehicle_id = $1 AND b.status IN ('approvata', 'in_corso', 'conclusa') ORDER BY b.start_at DESC LIMIT 300`),
      q('SELECT t.id, t.title, t.status, t.priority, t.created_at, u.name AS created_by_name FROM tickets t LEFT JOIN users u ON u.id = t.created_by WHERE t.vehicle_id = $1 ORDER BY t.created_at DESC'),
    ]);
    const sum = rows => rows.reduce((a, r) => a + Number(r.amount ?? r.cost ?? 0), 0);
    const year = String(new Date().getFullYear());
    const kmDriven = bookings.filter(b => b.return_km !== null && b.pickup_km !== null).reduce((a, b) => a + (b.return_km - b.pickup_km), 0);
    res.json({
      vehicle: veh, manager: true, deadlines, maintenance, costs, bookings, tickets,
      totals: {
        costs: Math.round(sum(costs) * 100) / 100,
        maintenance: Math.round(sum(maintenance) * 100) / 100,
        year: Math.round((sum(costs.filter(c => String(c.occurred_at instanceof Date ? c.occurred_at.toISOString() : c.occurred_at).startsWith(year)))
          + sum(maintenance.filter(m => String(m.start_date).startsWith(year)))) * 100) / 100,
        km_driven: kmDriven,
        uses: bookings.filter(b => b.status !== 'approvata').length,
      },
    });
  });

  app.patch('/api/mezzi/elenco/:id', async (req, res) => {
    await fleet.assertManager(req);
    const id = v.int(req.params.id, 'mezzo', { min: 1 });
    const before = await getVehicle(id);
    const f = readVehicle(req.body || {}, { partial: true });
    if (f.photo_media_id) await checkOwnMedia(db, [f.photo_media_id], req.user.id);
    if (f.km !== undefined && f.km !== null && before.km !== null && f.km < before.km && req.body?.km_correction !== true) {
      throw new HttpError(400, `I km non possono scendere (ora ${before.km.toLocaleString('it-IT')}): per correggere un errore conferma la correzione`);
    }
    if (f.km !== undefined) f.km_at = new Date();
    if (f.status === 'attivo' && before.status !== 'attivo' && f.status_note === undefined) f.status_note = '';
    const cols = Object.keys(f);
    if (cols.length) {
      try {
        await db.query(`UPDATE vehicles SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [id, ...Object.values(f)]);
      } catch (err) {
        if (duplicate(err)) throw new HttpError(409, 'Esiste già un mezzo con questo codice o questa targa');
        throw err;
      }
    }
    res.json(await getVehicle(id));
  });

  // Nuovo QR (es. etichetta rubata o rovinata): il vecchio smette di funzionare.
  app.post('/api/mezzi/elenco/:id/nuovo-qr', async (req, res) => {
    await fleet.assertManager(req);
    const id = v.int(req.params.id, 'mezzo', { min: 1 });
    await db.query('UPDATE vehicles SET qr_token = $2, updated_at = now() WHERE id = $1', [id, newQrToken()]);
    res.json(await getVehicle(id));
  });

  // Si cancella solo un mezzo mai usato; gli altri si dismettono (lo storico resta).
  app.delete('/api/mezzi/elenco/:id', async (req, res) => {
    await fleet.assertManager(req);
    const id = v.int(req.params.id, 'mezzo', { min: 1 });
    const { rows: [used] } = await db.query(
      `SELECT EXISTS (SELECT 1 FROM vehicle_bookings WHERE vehicle_id = $1) OR EXISTS (SELECT 1 FROM vehicle_costs WHERE vehicle_id = $1)
              OR EXISTS (SELECT 1 FROM vehicle_maintenance WHERE vehicle_id = $1) AS used`, [id]);
    if (used.used) throw new HttpError(409, 'Il mezzo ha già uno storico: invece di cancellarlo mettilo «Dismesso»');
    await db.query('DELETE FROM vehicles WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ── scadenze ───────────────────────────────────────────────────────────────
  function readDeadline(b, { partial }) {
    const remind = b.remind_days === undefined ? undefined : (() => {
      if (!Array.isArray(b.remind_days)) throw new HttpError(400, 'I promemoria non sono validi');
      return [...new Set(b.remind_days.map(n => v.int(n, 'promemoria', { min: 0, max: 365 })))].sort((a, c) => c - a);
    })();
    return pick({
      kind: v.oneOf(b.kind, 'tipo', DEADLINE_KINDS) ?? (partial ? undefined : 'altro'),
      label: v.text(b.label, 'descrizione', { max: 120 }),
      due_date: v.date(b.due_date, 'scadenza'),
      due_km: v.int(b.due_km, 'km', { min: 0, max: 5000000, nullable: true }),
      remind_days: remind,
      repeat_months: v.int(b.repeat_months, 'ripeti ogni', { min: 1, max: 120, nullable: true }),
      notes: v.text(b.notes, 'note', { max: 2000 }),
    });
  }

  app.post('/api/mezzi/elenco/:id/scadenze', async (req, res) => {
    await fleet.assertManager(req);
    const vehicleId = v.int(req.params.id, 'mezzo', { min: 1 });
    await getVehicle(vehicleId);
    const f = readDeadline(req.body || {}, { partial: false });
    if (!f.due_date && !f.due_km) throw new HttpError(400, 'Indica la data di scadenza o i km');
    const cols = Object.keys(f);
    const { rows: [row] } = await db.query(
      `INSERT INTO vehicle_deadlines (vehicle_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
      [vehicleId, ...Object.values(f)]);
    res.status(201).json(row);
  });

  app.patch('/api/mezzi/scadenze/:id', async (req, res) => {
    await fleet.assertManager(req);
    const id = v.int(req.params.id, 'scadenza', { min: 1 });
    const f = readDeadline(req.body || {}, { partial: true });
    const cols = Object.keys(f);
    if (!cols.length) throw new HttpError(400, 'Niente da cambiare');
    const { rows: [row] } = await db.query(
      `UPDATE vehicle_deadlines SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...Object.values(f)]);
    if (!row) throw new HttpError(404, 'Scadenza non trovata');
    if (!row.due_date && !row.due_km) throw new HttpError(400, 'Indica la data di scadenza o i km');
    res.json(row);
  });

  // Fatta: si chiude e, se si ripete, nasce la successiva (es. bollo ogni 12 mesi, tagliando ogni 30.000 km).
  app.post('/api/mezzi/scadenze/:id/fatta', async (req, res) => {
    await fleet.assertManager(req);
    const id = v.int(req.params.id, 'scadenza', { min: 1 });
    const nextDate = v.date(req.body?.next_due_date, 'prossima scadenza');
    const nextKm = v.int(req.body?.next_due_km, 'prossimi km', { min: 0, max: 5000000, nullable: true });
    const out = await db.tx(async q => {
      const { rows: [d] } = await q.query('UPDATE vehicle_deadlines SET done_at = now(), done_by = $2 WHERE id = $1 AND done_at IS NULL RETURNING *', [id, req.user.id]);
      if (!d) throw new HttpError(409, 'La scadenza è già chiusa');
      let next = null;
      if (nextDate || nextKm) {
        const { rows: [n] } = await q.query(
          `INSERT INTO vehicle_deadlines (vehicle_id, kind, label, due_date, due_km, remind_days, repeat_months, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, '') RETURNING *`,
          [d.vehicle_id, d.kind, d.label, nextDate || null, nextKm || null, d.remind_days, d.repeat_months]);
        next = n;
      }
      return { done: d, next };
    });
    res.json(out);
  });

  app.delete('/api/mezzi/scadenze/:id', async (req, res) => {
    await fleet.assertManager(req);
    await db.query('DELETE FROM vehicle_deadlines WHERE id = $1', [v.int(req.params.id, 'scadenza', { min: 1 })]);
    res.json({ ok: true });
  });

  // Tutte le scadenze aperte del parco, per il tab «Scadenze».
  app.get('/api/mezzi/scadenze', async (req, res) => {
    await fleet.assertManager(req);
    const { rows } = await db.query(
      `SELECT d.*, v.code, v.plate, v.make, v.model, v.km AS vehicle_km FROM vehicle_deadlines d JOIN vehicles v ON v.id = d.vehicle_id
        WHERE d.done_at IS NULL AND v.status <> 'dismesso' ORDER BY d.due_date NULLS LAST, v.code`);
    res.json(rows);
  });

  // ── manutenzioni ───────────────────────────────────────────────────────────
  function readMaintenance(b, { partial }) {
    return pick({
      kind: v.oneOf(b.kind, 'tipo', MAINT_KINDS) ?? (partial ? undefined : 'altro'),
      start_date: v.date(b.start_date, 'dal') ?? (partial ? undefined : (() => { throw new HttpError(400, 'Indica da quando'); })()),
      end_date: v.date(b.end_date, 'al'),
      km: km(b.km),
      supplier: v.text(b.supplier, 'officina', { max: 120 }),
      cost: money(b.cost, 'costo'),
      description: v.text(b.description, 'descrizione', { max: 5000 }),
      deadline_id: v.int(b.deadline_id, 'scadenza', { min: 1, nullable: true }),
      ticket_id: v.int(b.ticket_id, 'ticket', { min: 1, nullable: true }),
    });
  }

  app.post('/api/mezzi/elenco/:id/manutenzioni', async (req, res) => {
    await fleet.assertManager(req);
    const vehicleId = v.int(req.params.id, 'mezzo', { min: 1 });
    await getVehicle(vehicleId);
    const f = readMaintenance(req.body || {}, { partial: false });
    if (f.end_date && f.end_date < f.start_date) throw new HttpError(400, 'La fine è prima dell\'inizio');
    f.created_by = req.user.id;
    const cols = Object.keys(f);
    const row = await db.tx(async q => {
      const { rows: [m] } = await q.query(
        `INSERT INTO vehicle_maintenance (vehicle_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
        [vehicleId, ...Object.values(f)]);
      await setVehicleKm(q, vehicleId, f.km);
      return m;
    });
    // manutenzione nelle date di prenotazioni già approvate: i gestori lo vedono subito
    const { rows: clash } = await db.query(
      `SELECT b.id, u.name, b.start_at FROM vehicle_bookings b JOIN users u ON u.id = b.requester_id
        WHERE b.vehicle_id = $1 AND b.status = 'approvata'
          AND (b.end_at AT TIME ZONE 'Europe/Rome')::date >= $2::date AND ($3::date IS NULL OR (b.start_at AT TIME ZONE 'Europe/Rome')::date <= $3::date)`,
      [vehicleId, row.start_date, row.end_date]);
    res.status(201).json({ ...row, clashes: clash });
  });

  app.patch('/api/mezzi/manutenzioni/:id', async (req, res) => {
    await fleet.assertManager(req);
    const id = v.int(req.params.id, 'manutenzione', { min: 1 });
    const f = readMaintenance(req.body || {}, { partial: true });
    const cols = Object.keys(f);
    if (!cols.length) throw new HttpError(400, 'Niente da cambiare');
    const { rows: [row] } = await db.query(
      `UPDATE vehicle_maintenance SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...Object.values(f)]);
    if (!row) throw new HttpError(404, 'Manutenzione non trovata');
    if (row.end_date && String(row.end_date) < String(row.start_date)) throw new HttpError(400, 'La fine è prima dell\'inizio');
    await setVehicleKm(db, row.vehicle_id, f.km);
    res.json(row);
  });

  // Allegati della manutenzione (bolle, fatture, foto): PDF, immagini o documenti Office, fino a 15 MB.
  const FILE_MAX = 15 * 1024 * 1024;
  const fileType = buf => {
    if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
    if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
    const img = sniffImage(buf);
    if (img) return img;
    if (buf.subarray(4, 12).toString('latin1').startsWith('ftyphei') || buf.subarray(4, 12).toString('latin1').startsWith('ftypmif')) return 'image/heic';
    if (buf[0] === 0x50 && buf[1] === 0x4b) return 'application/octet-stream'; // docx, xlsx (zip): si scaricano
    return null;
  };
  app.post('/api/mezzi/manutenzioni/:id/allegati', express.raw({ type: () => true, limit: FILE_MAX }), async (req, res) => {
    await fleet.assertManager(req);
    const id = v.int(req.params.id, 'manutenzione', { min: 1 });
    const { rows: [m] } = await db.query('SELECT id FROM vehicle_maintenance WHERE id = $1', [id]);
    if (!m) throw new HttpError(404, 'Manutenzione non trovata');
    const name = v.text(req.query.name, 'nome del file', { max: 200, required: true }).replace(/[\\/:*?"<>|]/g, '-');
    const mime = fileType(req.body);
    if (!mime) throw new HttpError(400, 'Formato non supportato: carica un PDF, una foto (JPG, PNG, HEIC) o un documento Word/Excel');
    const { rows: [f] } = await db.query(
      'INSERT INTO vehicle_maintenance_files (maintenance_id, name, mime, size, data, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, mime, size, created_at',
      [id, name, mime, req.body.length, req.body, req.user.id]);
    res.status(201).json(f);
  });

  app.get('/api/mezzi/allegati/:id', async (req, res) => {
    await fleet.assertManager(req);
    const { rows: [f] } = await db.query('SELECT name, mime, data FROM vehicle_maintenance_files WHERE id = $1', [v.int(req.params.id, 'allegato', { min: 1 })]);
    if (!f) throw new HttpError(404, 'Allegato non trovato');
    // PDF e immagini si aprono nel browser, il resto si scarica
    const inline = /^(application\/pdf|image\/(jpeg|png|webp|gif))$/.test(f.mime);
    res.set({
      'Content-Type': f.mime,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'Cache-Control': 'private, max-age=3600',
    }).send(toBuffer(f.data));
  });

  app.delete('/api/mezzi/allegati/:id', async (req, res) => {
    await fleet.assertManager(req);
    await db.query('DELETE FROM vehicle_maintenance_files WHERE id = $1', [v.int(req.params.id, 'allegato', { min: 1 })]);
    res.json({ ok: true });
  });

  app.delete('/api/mezzi/manutenzioni/:id', async (req, res) => {
    await fleet.assertManager(req);
    await db.query('DELETE FROM vehicle_maintenance WHERE id = $1', [v.int(req.params.id, 'manutenzione', { min: 1 })]);
    res.json({ ok: true });
  });

  // ── costi ──────────────────────────────────────────────────────────────────
  // Chi aveva il mezzo in quel momento (per le multe): dallo storico di ritiri e riconsegne.
  async function driverAt(vehicleId, at) {
    const { rows: [b] } = await db.query(
      `SELECT b.id, b.requester_id, u.name FROM vehicle_bookings b JOIN users u ON u.id = b.requester_id
        WHERE b.vehicle_id = $1 AND b.status IN ('in_corso', 'conclusa')
          AND COALESCE(b.picked_up_at, b.start_at) <= $2 AND COALESCE(b.returned_at, now()) >= $2
        ORDER BY b.picked_up_at DESC LIMIT 1`, [vehicleId, at]);
    if (b) return { booking_id: b.id, user_id: b.requester_id, name: b.name, source: 'storico' };
    const { rows: [veh] } = await db.query('SELECT v.assigned_user_id, u.name FROM vehicles v LEFT JOIN users u ON u.id = v.assigned_user_id WHERE v.id = $1', [vehicleId]);
    if (veh?.assigned_user_id) return { booking_id: null, user_id: veh.assigned_user_id, name: veh.name, source: 'assegnazione' };
    return null;
  }

  app.get('/api/mezzi/elenco/:id/chi-guidava', async (req, res) => {
    await fleet.assertManager(req);
    const vehicleId = v.int(req.params.id, 'mezzo', { min: 1 });
    res.json(await driverAt(vehicleId, when(req.query.at, 'quando')) || { user_id: null });
  });

  app.post('/api/mezzi/elenco/:id/costi', async (req, res) => {
    await fleet.assertManager(req);
    const vehicleId = v.int(req.params.id, 'mezzo', { min: 1 });
    await getVehicle(vehicleId);
    const b = req.body || {};
    const at = when(b.occurred_at, 'data');
    const kind = v.oneOf(b.kind, 'tipo', COST_KINDS) || 'altro';
    let driverId = v.int(b.driver_id, 'conducente', { min: 1, nullable: true });
    let bookingId = null;
    if (driverId === undefined && kind === 'multa') {
      const d = await driverAt(vehicleId, at); // la multa va a chi aveva il mezzo
      driverId = d?.user_id ?? null;
      bookingId = d?.booking_id ?? null;
    }
    const f = {
      vehicle_id: vehicleId, kind, occurred_at: at, amount: money(b.amount, 'importo', { required: true }),
      km: km(b.km) ?? null, liters: money(b.liters, 'litri') ?? null, driver_id: driverId ?? null, booking_id: bookingId,
      description: v.text(b.description, 'descrizione', { max: 2000 }) || '', created_by: req.user.id,
    };
    const cols = Object.keys(f);
    const { rows: [row] } = await db.query(
      `INSERT INTO vehicle_costs (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, Object.values(f));
    await setVehicleKm(db, vehicleId, f.km);
    res.status(201).json(row);
  });

  app.delete('/api/mezzi/costi/:id', async (req, res) => {
    await fleet.assertManager(req);
    await db.query('DELETE FROM vehicle_costs WHERE id = $1', [v.int(req.params.id, 'costo', { min: 1 })]);
    res.json({ ok: true });
  });

  // ── planner e storico (gestori) ────────────────────────────────────────────
  app.get('/api/mezzi/planner', async (req, res) => {
    await fleet.assertManager(req);
    const from = when(req.query.from, 'da'), to = when(req.query.to, 'a');
    if (to <= from || (to - from) / 86400000 > 62) throw new HttpError(400, 'Intervallo non valido (al massimo 62 giorni)');
    const [vehicles, { rows: bookings }, { rows: maintenance }] = await Promise.all([
      fleet.vehicleStates("v.status <> 'dismesso'"),
      db.query(
        `SELECT b.id, b.vehicle_id, b.status, b.start_at, b.end_at, b.picked_up_at, b.returned_at, b.purpose, u.name AS requester_name
           FROM vehicle_bookings b JOIN users u ON u.id = b.requester_id
          WHERE b.vehicle_id IS NOT NULL AND b.status IN ('approvata', 'in_corso', 'conclusa')
            AND b.start_at < $2 AND COALESCE(b.returned_at, CASE WHEN b.status = 'in_corso' THEN GREATEST(b.end_at, now()) ELSE b.end_at END) > $1`, [from, to]),
      db.query(
        `SELECT id, vehicle_id, kind, start_date, end_date, supplier FROM vehicle_maintenance
          WHERE start_date <= ($2::timestamptz AT TIME ZONE 'Europe/Rome')::date AND (end_date IS NULL OR end_date >= ($1::timestamptz AT TIME ZONE 'Europe/Rome')::date)`, [from, to]),
    ]);
    res.json({ vehicles, bookings, maintenance });
  });

  // Storico di utilizzo (chi, quando, km), filtrabile; anche in CSV.
  async function history(req) {
    const params = [];
    const where = ["b.status IN ('in_corso', 'conclusa')"];
    const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };
    if (req.query.vehicle_id) add('b.vehicle_id = ?', v.int(req.query.vehicle_id, 'mezzo', { min: 1 }));
    if (req.query.user_id) add('b.requester_id = ?', v.int(req.query.user_id, 'persona', { min: 1 }));
    if (req.query.from) add('COALESCE(b.returned_at, now()) >= ?', when(req.query.from, 'da'));
    if (req.query.to) add('b.picked_up_at <= ?', when(req.query.to, 'a'));
    const { rows } = await db.query(
      `SELECT b.id, b.vehicle_id, v.code, v.plate, v.make, v.model, c.name AS category_name, c.icon AS category_icon, u.name AS requester_name, u.email AS requester_email,
              b.purpose, b.destination, b.start_at, b.end_at, b.picked_up_at, b.returned_at, b.pickup_km, b.return_km, b.return_fuel, b.return_notes, b.walk_in, b.status
         FROM vehicle_bookings b JOIN vehicles v ON v.id = b.vehicle_id JOIN vehicle_categories c ON c.id = v.category_id JOIN users u ON u.id = b.requester_id
        WHERE ${where.join(' AND ')} ORDER BY b.picked_up_at DESC NULLS LAST LIMIT 2000`, params);
    return rows;
  }

  app.get('/api/mezzi/storico', async (req, res) => {
    await fleet.assertManager(req);
    res.json(await history(req));
  });

  const csvCell = x => {
    const s = x === null || x === undefined ? '' : x instanceof Date ? x.toISOString() : String(x);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = (header, rows) => `﻿${[header, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n')}`;
  const rome = x => (x ? new Date(x).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) : '');

  app.get('/api/mezzi/esporta/:what', async (req, res) => {
    await fleet.assertManager(req);
    let body, name;
    if (req.params.what === 'storico.csv') {
      const rows = await history(req);
      body = csv(['Mezzo', 'Targa', 'Categoria', 'Persona', 'Email', 'Motivo', 'Destinazione', 'Ritiro', 'Riconsegna', 'Km ritiro', 'Km riconsegna', 'Km percorsi', 'Carburante', 'Note riconsegna'],
        rows.map(r => [r.code, r.plate, r.category_name, r.requester_name, r.requester_email, r.purpose, r.destination, rome(r.picked_up_at), rome(r.returned_at),
          r.pickup_km, r.return_km, r.return_km !== null && r.pickup_km !== null ? r.return_km - r.pickup_km : '', r.return_fuel, r.return_notes]));
      name = 'storico-mezzi.csv';
    } else if (req.params.what === 'mezzi.csv') {
      const rows = await fleet.vehicleStates('true');
      const dec = n => (n === null || n === undefined ? '' : String(n).replace('.', ','));
      body = csv(['Codice', 'Targa', 'Telaio/matricola', 'Categoria', 'Marca', 'Modello', 'Anno', 'Alimentazione', 'Classe ambientale', 'Possesso', 'Società', 'Fine contratto', 'Sede', 'Km', 'Stato', 'Assegnato a', 'Commessa', 'Valore acquisto €', 'Ammortamento %', 'Costo orario €', 'Prossima scadenza'],
        rows.map(r => [r.code, r.plate, r.vin, r.category_name, r.make, r.model, r.year, r.fuel, r.env_class, r.ownership, r.lessor, r.contract_end ? String(r.contract_end).slice(0, 10) : '',
          r.location, r.km, r.state, r.assigned_name, r.commessa, dec(r.purchase_value), dec(r.depreciation_rate), dec(r.hourly_cost), r.next_deadline ? String(r.next_deadline).slice(0, 10) : '']));
      name = 'mezzi.csv';
    } else if (req.params.what === 'costi.csv') {
      const { rows } = await db.query(
        `SELECT x.* FROM (
           SELECT v.code, v.plate, c.kind, c.occurred_at AS at, c.amount, c.km, c.liters, u.name AS driver, c.description FROM vehicle_costs c
             JOIN vehicles v ON v.id = c.vehicle_id LEFT JOIN users u ON u.id = c.driver_id
           UNION ALL
           SELECT v.code, v.plate, 'manutenzione: ' || m.kind, m.start_date::timestamptz, m.cost, m.km, NULL, NULL, trim(m.supplier || ' ' || m.description)
             FROM vehicle_maintenance m JOIN vehicles v ON v.id = m.vehicle_id WHERE m.cost IS NOT NULL) x ORDER BY x.at DESC`);
      body = csv(['Mezzo', 'Targa', 'Tipo', 'Data', 'Importo €', 'Km', 'Litri', 'Conducente', 'Descrizione'],
        rows.map(r => [r.code, r.plate, r.kind, rome(r.at), String(r.amount).replace('.', ','), r.km, r.liters === null ? '' : String(r.liters).replace('.', ','), r.driver, r.description]));
      name = 'costi-mezzi.csv';
    } else throw new HttpError(404, 'Esportazione non trovata');
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` }).send(body);
  });

  // ── importazione da Zoho CRM (gestori) ─────────────────────────────────────
  // Il CSV dell'esportazione «Mezzi» (Tutti i campi) arriva come testo: prima l'anteprima, poi la conferma.
  const csvBody = express.text({ type: () => true, limit: '10mb' });
  const previewOf = plan => ({
    summary: plan.summary,
    vehicles: plan.vehicles.map(x => ({
      action: x._action, code: x.code, plate: x.plate, vin: x.vin, make: x.make, model: x.model, category: x.category,
      fuel: x.fuel, env_class: x.env_class, ownership: x.ownership, status: x.status, commessa: x.commessa,
      purchase_value: x.purchase_value, hourly_cost: x.hourly_cost, warnings: x._warn,
    })),
  });
  app.post('/api/mezzi/importa/anteprima', csvBody, async (req, res) => {
    await fleet.assertManager(req);
    res.json(previewOf(await planImport(db, req.body)));
  });
  app.post('/api/mezzi/importa', csvBody, async (req, res) => {
    await fleet.assertManager(req);
    const plan = await planImport(db, req.body);
    const done = await applyImport(db, plan, req.user.id);
    res.json({ ...done, summary: plan.summary });
  });

  // ── impostazioni: categorie (gestori) e gestori (amministratori) ───────────
  app.get('/api/mezzi/categorie', async (_req, res) => {
    const { rows } = await db.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM vehicles v WHERE v.category_id = c.id AND v.status <> 'dismesso') AS vehicles
         FROM vehicle_categories c ORDER BY c.archived, c.position, lower(c.name)`);
    res.json(rows);
  });

  app.post('/api/mezzi/categorie', async (req, res) => {
    await fleet.assertManager(req);
    const name = v.text(req.body?.name, 'nome', { max: 80, required: true });
    try {
      const { rows: [row] } = await db.query(
        'INSERT INTO vehicle_categories (name, description, position, icon) VALUES ($1, $2, (SELECT COALESCE(MAX(position), 0) + 1 FROM vehicle_categories), $3) RETURNING *',
        [name, v.text(req.body?.description, 'descrizione', { max: 300 }) || '', v.oneOf(req.body?.icon, 'icona', CATEGORY_ICONS) ?? iconFor(name)]);
      res.status(201).json(row);
    } catch (err) {
      if (duplicate(err)) throw new HttpError(409, 'Esiste già una categoria con questo nome');
      throw err;
    }
  });

  app.patch('/api/mezzi/categorie/:id', async (req, res) => {
    await fleet.assertManager(req);
    const id = v.int(req.params.id, 'categoria', { min: 1 });
    const f = pick({
      name: v.text(req.body?.name, 'nome', { max: 80 }),
      description: v.text(req.body?.description, 'descrizione', { max: 300 }),
      icon: v.oneOf(req.body?.icon, 'icona', CATEGORY_ICONS),
      position: v.int(req.body?.position, 'posizione', { min: 0, max: 10000 }),
      archived: typeof req.body?.archived === 'boolean' ? req.body.archived : undefined,
    });
    if (f.name === '') throw new HttpError(400, 'Il nome è obbligatorio');
    const cols = Object.keys(f);
    if (!cols.length) throw new HttpError(400, 'Niente da cambiare');
    try {
      const { rows: [row] } = await db.query(`UPDATE vehicle_categories SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...Object.values(f)]);
      if (!row) throw new HttpError(404, 'Categoria non trovata');
      res.json(row);
    } catch (err) {
      if (duplicate(err)) throw new HttpError(409, 'Esiste già una categoria con questo nome');
      throw err;
    }
  });

  app.delete('/api/mezzi/categorie/:id', async (req, res) => {
    await fleet.assertManager(req);
    const id = v.int(req.params.id, 'categoria', { min: 1 });
    const { rows: [used] } = await db.query(
      'SELECT EXISTS (SELECT 1 FROM vehicles WHERE category_id = $1) OR EXISTS (SELECT 1 FROM vehicle_bookings WHERE category_id = $1) AS used', [id]);
    if (used.used) throw new HttpError(409, 'La categoria ha mezzi o prenotazioni: invece di cancellarla archiviala');
    await db.query('DELETE FROM vehicle_categories WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  app.get('/api/mezzi/gestori', async (_req, res) => {
    const { rows } = await db.query('SELECT m.user_id, u.name, u.email FROM fleet_managers m JOIN users u ON u.id = m.user_id ORDER BY u.name');
    res.json(rows);
  });

  app.put('/api/mezzi/gestori', async (req, res) => {
    if (!isAdmin(req)) throw new HttpError(403, 'I gestori del parco mezzi li sceglie un amministratore');
    const ids = v.ids(req.body?.user_ids, 'gestori') || [];
    if (ids.length) {
      const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM users WHERE id = ANY($1::int[])', [ids]);
      if (n !== ids.length) throw new HttpError(400, 'Una delle persone non esiste');
    }
    await db.tx(async q => {
      await q.query('DELETE FROM fleet_managers WHERE NOT (user_id = ANY($1::int[]))', [ids]);
      for (const id of ids) await q.query('INSERT INTO fleet_managers (user_id, added_by) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, req.user.id]);
    });
    const { rows } = await db.query('SELECT m.user_id, u.name, u.email FROM fleet_managers m JOIN users u ON u.id = m.user_id ORDER BY u.name');
    res.json(rows);
  });
}

module.exports = { registerFleet };
