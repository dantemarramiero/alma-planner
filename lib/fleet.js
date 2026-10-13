// Parco mezzi: chi gestisce, quando un mezzo è libero, conflitti tra prenotazioni, notifiche ed email,
// promemoria automatici (riconsegna per chi ha il mezzo e per i gestori, scadenze del mezzo per i gestori).
const crypto = require('crypto');
const { HttpError } = require('./http');
const { graph } = require('./graph');
const { romeNow } = require('./workdays');

const KM_WARNING = 1000;        // scadenze a km: avviso quando mancano meno di 1000 km
const LATE_GRACE_MIN = 15;      // riconsegna in ritardo dopo 15 minuti dalla fine
const RETURN_SOON_MIN = 60;     // «riconsegna tra un'ora»
const LONG_BOOKING_H = 26;      // per le prenotazioni lunghe anche l'avviso del giorno prima

const newQrToken = () => crypto.randomBytes(9).toString('base64url');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const itDateTime = iso => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const itDate = d => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
const vehicleName = v => [v.code, v.plate, [v.make, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');

// Una prenotazione «occupa» il mezzo da start_at a end_at. Se è ritirata e la riconsegna è in ritardo, non si sa
// quando rientra: il mezzo resta occupato per le 24 ore successive (non lo si dà a un altro finché non torna).
const OCCUPYING = "b.status IN ('approvata', 'in_corso')";
const occupiedUntil = "CASE WHEN b.status = 'in_corso' AND b.end_at < now() THEN now() + interval '24 hours' ELSE b.end_at END";

const DEADLINE_LABEL = {
  assicurazione: 'Assicurazione', bollo: 'Bollo', revisione: 'Revisione', tagliando: 'Tagliando', gomme: 'Cambio gomme',
  noleggio: 'Fine noleggio', tachigrafo: 'Tachigrafo', altro: 'Scadenza',
};
const deadlineName = d => d.label || DEADLINE_LABEL[d.kind] || 'Scadenza';

function createFleet({ db, auth, baseUrl, notifier, isAdmin, adminEmails = [] }) {
  // ── chi gestisce ───────────────────────────────────────────────────────────
  async function managerIds() {
    const { rows } = await db.query('SELECT user_id FROM fleet_managers');
    return rows.map(r => r.user_id);
  }
  async function isManager(req) {
    if (isAdmin(req)) return true;
    const { rows } = await db.query('SELECT 1 FROM fleet_managers WHERE user_id = $1', [req.user.id]);
    return Boolean(rows[0]);
  }
  async function assertManager(req) {
    if (!(await isManager(req))) throw new HttpError(403, 'Solo i gestori del parco mezzi possono farlo');
  }
  // Chi riceve richieste, segnalazioni, rientri e scadenze: i gestori; senza gestori nominati, gli amministratori
  // (così niente resta senza risposta).
  async function approverIds() {
    const ids = await managerIds();
    if (ids.length || !adminEmails.length) return ids;
    const { rows } = await db.query('SELECT id FROM users WHERE lower(email) = ANY($1::text[])', [adminEmails]);
    return rows.map(r => r.id);
  }

  // ── disponibilità ──────────────────────────────────────────────────────────
  // Mezzi della categoria (o tutti) liberi nell'intervallo: attivi, senza assegnazione fissa, senza
  // prenotazioni approvate/in corso sovrapposte e senza manutenzioni sovrapposte.
  async function freeVehicles({ categoryId = null, start, end, exceptBooking = null, q = db }) {
    const { rows } = await q.query(
      `SELECT v.* FROM vehicles v
        WHERE v.status = 'attivo' AND v.assigned_user_id IS NULL
          AND ($1::int IS NULL OR v.category_id = $1)
          AND NOT EXISTS (SELECT 1 FROM vehicle_bookings b WHERE b.vehicle_id = v.id AND ${OCCUPYING}
                            AND b.id IS DISTINCT FROM $4 AND b.start_at < $3 AND ${occupiedUntil} > $2)
          AND NOT EXISTS (SELECT 1 FROM vehicle_maintenance m WHERE m.vehicle_id = v.id
                            AND m.start_date <= ($3::timestamptz AT TIME ZONE 'Europe/Rome')::date
                            AND (m.end_date IS NULL OR m.end_date >= ($2::timestamptz AT TIME ZONE 'Europe/Rome')::date))
        ORDER BY v.code`, [categoryId, start, end, exceptBooking]);
    return rows;
  }

  // Perché un mezzo non si può dare in quell'intervallo (null = si può).
  async function conflictFor(vehicleId, start, end, exceptBooking = null, q = db) {
    const { rows: [v] } = await q.query('SELECT * FROM vehicles WHERE id = $1', [vehicleId]);
    if (!v) return 'Mezzo non trovato';
    if (v.status !== 'attivo') return v.status === 'dismesso' ? 'Il mezzo è dismesso' : 'Il mezzo è fuori servizio';
    const { rows: [b] } = await q.query(
      `SELECT b.id, b.status, b.start_at, b.end_at, u.name FROM vehicle_bookings b JOIN users u ON u.id = b.requester_id
        WHERE b.vehicle_id = $1 AND ${OCCUPYING} AND b.id IS DISTINCT FROM $4 AND b.start_at < $3 AND ${occupiedUntil} > $2
        ORDER BY b.start_at LIMIT 1`, [vehicleId, start, end, exceptBooking]);
    if (b?.status === 'in_corso' && new Date(b.end_at) < new Date()) return `Il mezzo non è ancora stato riconsegnato da ${b.name} (doveva rientrare ${itDateTime(b.end_at)})`;
    if (b) return `Il mezzo è già prenotato da ${b.name} (${itDateTime(b.start_at)} → ${itDateTime(b.end_at)})`;
    const { rows: [m] } = await q.query(
      `SELECT m.start_date, m.end_date FROM vehicle_maintenance m WHERE m.vehicle_id = $1
          AND m.start_date <= ($3::timestamptz AT TIME ZONE 'Europe/Rome')::date
          AND (m.end_date IS NULL OR m.end_date >= ($2::timestamptz AT TIME ZONE 'Europe/Rome')::date) LIMIT 1`, [vehicleId, start, end]);
    if (m) return `Il mezzo è in manutenzione ${m.end_date ? `fino al ${itDate(m.end_date)}` : 'senza data di fine'}`;
    return null;
  }

  // Stato di adesso di ogni mezzo: libero, in uso, prenotato, in manutenzione, fuori servizio, dismesso, assegnato.
  const STATE_SQL = `
    SELECT v.*, c.name AS category_name, c.icon AS category_icon, au.name AS assigned_name,
           cur.id AS current_booking_id, cur.status AS current_status, cur.start_at AS current_start, cur.end_at AS current_end,
           cu.id AS current_user_id, cu.name AS current_user_name,
           nx.start_at AS next_start, nx.end_at AS next_end, nu.name AS next_user_name,
           mt.id AS maintenance_id, mt.end_date AS maintenance_end, mt.supplier AS maintenance_supplier,
           (SELECT COUNT(*)::int FROM tickets t WHERE t.vehicle_id = v.id AND t.status <> 'done') AS open_reports,
           (SELECT MIN(d.due_date) FROM vehicle_deadlines d WHERE d.vehicle_id = v.id AND d.done_at IS NULL) AS next_deadline,
           CASE
             WHEN v.status = 'dismesso' THEN 'dismesso'
             WHEN v.status = 'fuori_servizio' THEN 'fuori_servizio'
             WHEN mt.id IS NOT NULL THEN 'manutenzione'
             WHEN cur.status = 'in_corso' THEN 'in_uso'
             WHEN cur.id IS NOT NULL THEN 'prenotato'
             WHEN v.assigned_user_id IS NOT NULL THEN 'assegnato'
             ELSE 'libero'
           END AS state
      FROM vehicles v
      JOIN vehicle_categories c ON c.id = v.category_id
      LEFT JOIN users au ON au.id = v.assigned_user_id
      LEFT JOIN LATERAL (
        SELECT b.* FROM vehicle_bookings b WHERE b.vehicle_id = v.id
           AND (b.status = 'in_corso' OR (b.status = 'approvata' AND b.start_at <= now() AND b.end_at > now()))
         ORDER BY (b.status = 'in_corso') DESC, b.start_at LIMIT 1) cur ON true
      LEFT JOIN users cu ON cu.id = cur.requester_id
      LEFT JOIN LATERAL (
        SELECT b.* FROM vehicle_bookings b WHERE b.vehicle_id = v.id AND b.status = 'approvata' AND b.start_at > now()
         ORDER BY b.start_at LIMIT 1) nx ON true
      LEFT JOIN users nu ON nu.id = nx.requester_id
      LEFT JOIN LATERAL (
        SELECT m.* FROM vehicle_maintenance m WHERE m.vehicle_id = v.id
           AND m.start_date <= (now() AT TIME ZONE 'Europe/Rome')::date
           AND (m.end_date IS NULL OR m.end_date >= (now() AT TIME ZONE 'Europe/Rome')::date)
         ORDER BY m.start_date DESC LIMIT 1) mt ON true`;

  async function vehicleStates(where = 'true', params = []) {
    const { rows } = await db.query(`${STATE_SQL} WHERE ${where} ORDER BY c.position, lower(c.name), v.code`, params);
    return rows;
  }

  // ── notifiche ed email ─────────────────────────────────────────────────────
  async function notify(userIds, { actorId = null, body, link }) {
    return notifier.notify({ userIds, actorId, kind: 'mezzi', body, link });
  }

  // Email dalla casella di `fromId` (Mail.Send). Mai bloccante: se non parte, si scrive nel log.
  async function mail(fromId, toUsers, { subject, lines, link, linkLabel = 'Apri in Alma Planet' }) {
    if (!auth.msConfigured || !toUsers.length) return;
    try {
      const token = await auth.graphToken(fromId);
      const html = `<div style="font-family:Roboto,Helvetica Neue,Arial,sans-serif;font-size:14px;line-height:1.5;color:#3F3F3F;max-width:560px">
  <div style="font-size:18px;font-weight:300;margin-bottom:10px">Alma <b style="font-weight:700;color:#FF8A26">Planet</b> · Mezzi</div>
  ${lines.map(l => `<p style="margin:0 0 8px">${l}</p>`).join('')}
  ${link ? `<p style="margin:16px 0 0"><a href="${esc(`${baseUrl}/app#${link}`)}" style="display:inline-block;background:#FF8A26;color:#FFFFFF;text-decoration:none;padding:10px 16px;border-radius:12px;font-weight:500">${esc(linkLabel)}</a></p>` : ''}
</div>`;
      await graph(token, 'POST', '/me/sendMail', {
        body: {
          message: { subject: `[Alma Planet] ${subject}`.slice(0, 250), body: { contentType: 'HTML', content: html },
            toRecipients: toUsers.map(u => ({ emailAddress: { address: u.email, name: u.name } })) },
          saveToSentItems: false,
        },
      });
    } catch (err) {
      console.warn(`[mezzi] email «${subject}» non inviata (${err.message})`);
    }
  }
  const usersByIds = async ids => (ids.length ? (await db.query('SELECT id, name, email FROM users WHERE id = ANY($1::int[])', [ids])).rows : []);

  // ── promemoria ─────────────────────────────────────────────────────────────
  // Una chiave per promemoria: se la riga c'era già, non si rimanda.
  async function once(key) {
    const { rows } = await db.query('INSERT INTO fleet_reminder_log (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key', [key]);
    return Boolean(rows[0]);
  }

  async function remindReturns(now = new Date()) {
    const managers = await approverIds();
    const { rows } = await db.query(
      `SELECT b.*, v.code, v.plate, v.make, v.model, u.name AS requester_name, u.email AS requester_email
         FROM vehicle_bookings b JOIN vehicles v ON v.id = b.vehicle_id JOIN users u ON u.id = b.requester_id
        WHERE b.status IN ('approvata', 'in_corso') AND b.end_at < $1::timestamptz + interval '${LONG_BOOKING_H} hours'`, [now]);
    let sent = 0;
    for (const b of rows) {
      const minutes = (new Date(b.end_at) - now) / 60000;
      const name = vehicleName(b);
      const link = `/mezzi/prenotazioni/${b.id}`;
      const long = (new Date(b.end_at) - new Date(b.start_at)) / 3600000 >= LONG_BOOKING_H;
      if (b.status === 'in_corso' && minutes < -LATE_GRACE_MIN) {
        // in ritardo: a chi ha il mezzo e ai gestori, una volta al giorno
        const day = romeNow(now).day;
        if (await once(`late:${b.id}:${day}`)) {
          await notify([b.requester_id], { body: `Riconsegna in ritardo: ${name} andava riportato ${itDateTime(b.end_at)}. Riconsegnalo o chiedi di prolungare.`, link });
          await notify(managers.filter(id => id !== b.requester_id), { body: `${b.requester_name} non ha ancora riconsegnato ${name} (fine prevista ${itDateTime(b.end_at)}).`, link });
          await mail(b.requester_id, [{ name: b.requester_name, email: b.requester_email }], {
            subject: `Riconsegna in ritardo: ${name}`,
            lines: [`Il mezzo <b>${esc(name)}</b> andava riconsegnato ${esc(itDateTime(b.end_at))}.`, 'Riconsegnalo appena puoi, oppure avvisa il gestore del parco mezzi.'],
            link, linkLabel: 'Riconsegna il mezzo',
          });
          sent++;
        }
      } else if (minutes > 0 && minutes <= RETURN_SOON_MIN && b.status === 'in_corso') {
        if (await once(`soon:${b.id}`)) {
          await notify([b.requester_id], { body: `Tra meno di un'ora riconsegni ${name} (${itDateTime(b.end_at)}).`, link });
          await notify(managers.filter(id => id !== b.requester_id), { body: `${name} rientra ${itDateTime(b.end_at)} da ${b.requester_name}.`, link });
          sent++;
        }
      } else if (long && minutes > RETURN_SOON_MIN && minutes <= 24 * 60) {
        if (await once(`tomorrow:${b.id}`)) {
          await notify([b.requester_id], { body: `Promemoria: riconsegni ${name} ${itDateTime(b.end_at)}.`, link });
          await mail(b.requester_id, [{ name: b.requester_name, email: b.requester_email }], {
            subject: `Promemoria riconsegna: ${name}`,
            lines: [`Ricordati di riconsegnare <b>${esc(name)}</b> ${esc(itDateTime(b.end_at))}.`, 'Alla riconsegna inquadra il QR code del mezzo e scrivi i km.'],
            link, linkLabel: 'Apri la prenotazione',
          });
          sent++;
        }
      }
    }
    return sent;
  }

  async function remindDeadlines(now = new Date()) {
    const managers = await approverIds();
    const today = romeNow(now).day;
    const { rows } = await db.query(
      `SELECT d.*, v.code, v.plate, v.make, v.model, v.km AS vehicle_km, v.assigned_user_id
         FROM vehicle_deadlines d JOIN vehicles v ON v.id = d.vehicle_id
        WHERE d.done_at IS NULL AND v.status <> 'dismesso'`);
    let sent = 0;
    for (const d of rows) {
      const to = [...new Set([...managers, d.assigned_user_id].filter(Boolean))];
      const name = vehicleName(d);
      const link = `/mezzi/v/${d.vehicle_id}`;
      if (d.due_date) {
        const due = String(d.due_date).slice(0, 10);
        const left = Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
        let key = null, text = null;
        if (left < 0) { key = `dl:${d.id}:${due}:scaduta`; text = `${deadlineName(d)} di ${name} scaduta il ${itDate(due)}.`; }
        else {
          // la soglia più vicina già raggiunta (chi crea una scadenza a 5 giorni riceve l'avviso dei 7, non anche quello dei 30)
          const step = [...d.remind_days].sort((a, b) => a - b).find(n => left <= n);
          if (step !== undefined) {
            key = `dl:${d.id}:${due}:${step}`;
            text = left === 0 ? `${deadlineName(d)} di ${name} scade oggi.` : `${deadlineName(d)} di ${name} scade il ${itDate(due)} (tra ${left} ${left === 1 ? 'giorno' : 'giorni'}).`;
          }
        }
        if (key && to.length && await once(key)) { await notify(to, { body: text, link }); sent++; }
      }
      if (d.due_km && d.vehicle_km !== null) {
        const over = d.vehicle_km >= d.due_km;
        if (over || d.vehicle_km >= d.due_km - KM_WARNING) {
          const key = `dlkm:${d.id}:${d.due_km}:${over ? 'over' : 'soon'}`;
          const text = over ? `${deadlineName(d)} di ${name}: superati i ${d.due_km.toLocaleString('it-IT')} km (ora ${d.vehicle_km.toLocaleString('it-IT')}).`
            : `${deadlineName(d)} di ${name} a ${d.due_km.toLocaleString('it-IT')} km: mancano ${(d.due_km - d.vehicle_km).toLocaleString('it-IT')} km.`;
          if (to.length && await once(key)) { await notify(to, { body: text, link }); sent++; }
        }
      }
    }
    return sent;
  }

  let running = false;
  async function tick(now = new Date()) {
    if (running) return;
    running = true;
    try {
      await remindReturns(now);
      const { minute } = romeNow(now);
      if (minute >= 7 * 60 && minute < 20 * 60) await remindDeadlines(now); // le scadenze di giorno, non di notte
    } catch (err) {
      console.warn('[mezzi] promemoria non riusciti', err.message);
    } finally {
      running = false;
    }
  }
  function start(intervalMs = 5 * 60 * 1000) {
    setTimeout(() => tick(), 45 * 1000).unref();
    return setInterval(() => tick(), intervalMs).unref();
  }

  return {
    managerIds, isManager, assertManager, approverIds, freeVehicles, conflictFor, vehicleStates,
    notify, mail, usersByIds, remindReturns, remindDeadlines, tick, start,
  };
}

module.exports = { createFleet, newQrToken, vehicleName, deadlineName, itDateTime, itDate, esc, DEADLINE_LABEL };
