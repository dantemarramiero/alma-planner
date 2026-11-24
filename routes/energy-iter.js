// Alma Energy · Progetti selezionati (ALM2-74): pipeline in valutazione → partiti (DD tecnica avviata) → scartati, e
// iter a fasi per progetto, dal modello del tipo e modificabile. Le rotte stanno sotto /api/energy, quindi già
// riservate ai membri del modulo (controllo in routes/energy.js). Ogni fase è anche una riga del Gantt del progetto
// («Fase N · nome»): la si tiene allineata dopo ogni cambio.
//
// Per i conti di prima (cruscotto, export, probabilità) la pipeline si riflette sui campi dei vecchi Impianti target:
// valutazione = step «contatto_venditore», partito = step della fase in corso, scartato = esito «perso», tutte le fasi
// chiuse = esito «acquisito».
const { HttpError, v } = require('../lib/http');
const { PROJECT_TYPES, SELECTION, DEFAULT_TEMPLATES, typeFromKind, cleanTemplate, phasesFromTemplate, legacyStepOf } = require('../lib/energy-iter');
const { addWorkdays, romeNow } = require('../lib/workdays');

const TICKET_RE = /^Fase \d+ · /;
const ticketTitle = (i, label) => `Fase ${i + 1} · ${label}`.slice(0, 200);

function registerEnergyIter(app, { db, opportunityById }) {
  // ── modelli ────────────────────────────────────────────────────────────────────────────────
  async function templateOf(q, type) {
    const { rows: [r] } = await q.query('SELECT phases FROM energy_iter_templates WHERE project_type = $1', [type]);
    return r?.phases || DEFAULT_TEMPLATES[type];
  }

  app.get('/api/energy/iter/templates', async (_req, res) => {
    const { rows } = await db.query(
      `SELECT t.project_type, t.phases, t.updated_at, u.name AS updated_by FROM energy_iter_templates t LEFT JOIN users u ON u.id = t.updated_by`);
    const custom = Object.fromEntries(rows.map(r => [r.project_type, r]));
    res.json({
      types: PROJECT_TYPES,
      templates: Object.fromEntries(Object.keys(PROJECT_TYPES).map(t => [t, {
        phases: custom[t]?.phases || DEFAULT_TEMPLATES[t], custom: Boolean(custom[t]),
        updated_at: custom[t]?.updated_at || null, updated_by: custom[t]?.updated_by || null,
      }])),
    });
  });

  app.put('/api/energy/iter/templates/:type', async (req, res) => {
    const type = v.oneOf(req.params.type, 'Tipo', Object.keys(PROJECT_TYPES));
    let phases;
    try { phases = cleanTemplate(req.body?.phases); } catch (err) { throw new HttpError(400, err.message); }
    await db.query(
      `INSERT INTO energy_iter_templates (project_type, phases, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (project_type) DO UPDATE SET phases = EXCLUDED.phases, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [type, JSON.stringify(phases), req.user.id]);
    res.json({ phases });
  });

  // Torna al modello di partenza (quello scritto nel codice).
  app.delete('/api/energy/iter/templates/:type', async (req, res) => {
    const type = v.oneOf(req.params.type, 'Tipo', Object.keys(PROJECT_TYPES));
    await db.query('DELETE FROM energy_iter_templates WHERE project_type = $1', [type]);
    res.json({ phases: DEFAULT_TEMPLATES[type] });
  });

  // ── fasi di un progetto ───────────────────────────────────────────────────────────────────
  async function selectedById(id) {
    const o = await opportunityById(id);
    if (!o.selection) throw new HttpError(400, 'Non è un progetto selezionato');
    return o;
  }
  const phasesOf = (q, oppId) => q.query('SELECT * FROM energy_iter_phases WHERE opportunity_id = $1 ORDER BY position, id', [oppId]).then(r => r.rows);
  async function phaseById(q, phaseId) {
    const { rows: [p] } = await q.query('SELECT * FROM energy_iter_phases WHERE id = $1', [phaseId]);
    if (!p) throw new HttpError(404, 'Fase non trovata');
    const o = await selectedById(p.opportunity_id);
    return { p, o };
  }

  // Crea le fasi dal modello (o, per un target di prima, dalla vecchia checklist), con le date una dopo l'altra.
  async function createPhases(q, o, userId, legacy = null) {
    const template = await templateOf(q, o.project_type || typeFromKind(o.kind));
    const owner = o.owner_id || userId;
    let start = romeNow().day;
    const built = phasesFromTemplate(template, legacy);
    for (const [i, ph] of built.entries()) {
      const due = addWorkdays(start, Math.max(ph.days, 1) - 1);
      await q.query(
        `INSERT INTO energy_iter_phases (opportunity_id, position, key, label, days, owner_id, due_date, done_at, items)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [o.id, i + 1, ph.key, ph.label, ph.days, owner, due, ph.done ? new Date() : null, JSON.stringify(ph.items)]);
      start = addWorkdays(due, 1);
    }
  }

  // Le righe del Gantt: una per fase, numerate in ordine, fatte / in corso / da fare; responsabile della fase.
  async function syncTickets(q, o, userId) {
    if (!o.project_id) return;
    const phases = await phasesOf(q, o.id);
    const cur = phases.findIndex(p => !p.done_at);
    const { rows: [{ pos }] } = await q.query('SELECT COALESCE(MAX(position), 0) AS pos FROM tickets');
    for (const [i, p] of phases.entries()) {
      const status = p.done_at ? 'done' : i === cur && o.selection === 'avviato' ? 'doing' : 'todo';
      let ticketId = p.ticket_id;
      if (ticketId) {
        const { rowCount } = await q.query('UPDATE tickets SET title = $2, status = $3, due_date = $4, updated_at = now() WHERE id = $1',
          [ticketId, ticketTitle(i, p.label), status, p.due_date]);
        if (!rowCount) ticketId = null;
      }
      if (!ticketId) {
        const { rows: [t] } = await q.query(
          `INSERT INTO tickets (project_id, title, description, status, start_date, due_date, position, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [o.project_id, ticketTitle(i, p.label), 'Punti da spuntare nell\'iter del progetto (Alma Energy).', status,
            p.due_date ? addWorkdays(String(p.due_date).slice(0, 10), -(Math.max(p.days, 1) - 1)) : romeNow().day, p.due_date, pos + i + 1, userId]);
        ticketId = t.id;
        await q.query('UPDATE energy_iter_phases SET ticket_id = $2 WHERE id = $1', [p.id, ticketId]);
      }
      const assignee = p.owner_id || o.owner_id;
      if (assignee) {
        await q.query('DELETE FROM ticket_assignees WHERE ticket_id = $1 AND user_id <> $2', [ticketId, assignee]);
        await q.query('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ticketId, assignee]);
      }
    }
  }

  // Dopo un cambio delle fasi: step dei vecchi target, esito e stato del progetto, righe del Gantt.
  async function afterChange(q, o, userId) {
    const phases = await phasesOf(q, o.id);
    if (o.selection === 'avviato' && phases.length) {
      const cur = phases.find(p => !p.done_at);
      const outcome = cur ? null : 'acquisito';
      await q.query('UPDATE energy_opportunities SET target_step = $2, target_outcome = $3, updated_at = now() WHERE id = $1',
        [o.id, legacyStepOf(cur?.key || ''), outcome]);
      if (o.project_id) await q.query('UPDATE projects SET status = $2, updated_at = now() WHERE id = $1', [o.project_id, outcome ? 'done' : 'active']);
    }
    await syncTickets(q, o, userId);
  }

  const history = (q, oppId, from, to, note, userId) => q.query(
    'INSERT INTO energy_stage_history (opportunity_id, from_stage, to_stage, note, user_id) VALUES ($1, $2, $3, $4, $5)', [oppId, from, to, note || '', userId]);

  // Iter del progetto. Un target avviato prima di ALM2-74 riceve qui le sue fasi, la prima volta che si apre.
  async function iterDetail(id, userId) {
    let o = await selectedById(id);
    if (o.selection === 'avviato' && !(await phasesOf(db, id)).length) {
      await db.tx(async q => {
        await createPhases(q, o, userId, { step: o.target_step, outcome: o.target_outcome, checklist: o.target_checklist });
        await afterChange(q, o, userId);
      });
      o = await selectedById(id);
    }
    const phases = await phasesOf(db, id);
    const cur = phases.findIndex(p => !p.done_at);
    const { rows: users } = await db.query('SELECT id, name FROM users WHERE id = ANY($1)', [[...new Set(phases.map(p => p.owner_id).filter(Boolean))]]);
    const names = Object.fromEntries(users.map(u => [u.id, u.name]));
    const { rows: hist } = await db.query(
      `SELECT h.from_stage, h.to_stage, h.note, h.at, u.name AS user_name FROM energy_stage_history h LEFT JOIN users u ON u.id = h.user_id
        WHERE h.opportunity_id = $1 AND (h.to_stage LIKE 'sel:%' OR h.to_stage LIKE 'fase:%' OR h.to_stage = 'target') ORDER BY h.at DESC, h.id DESC LIMIT 50`, [id]);
    return {
      id: o.id, title: o.title, kind: o.kind, project_type: o.project_type || typeFromKind(o.kind), project_id: o.project_id,
      selection: o.selection, selection_reason: o.selection_reason, selection_changed_at: o.selection_changed_at,
      company_name: o.company_name, owner_id: o.owner_id, owner_name: o.owner_name, mw: o.mw, capex: o.capex,
      city: o.city, province: o.province, scenario: o.data?.scenario || null,
      current: cur, done: cur === -1 && phases.length > 0,
      phases: phases.map((p, i) => ({
        id: p.id, position: p.position, key: p.key, label: p.label, days: p.days, added: p.added,
        owner_id: p.owner_id, owner_name: names[p.owner_id] || null, due_date: p.due_date ? String(p.due_date).slice(0, 10) : null,
        done_at: p.done_at, state: p.done_at ? 'fatta' : i === cur && o.selection === 'avviato' ? 'attuale' : 'dopo',
        items: p.items, items_done: p.items.filter(x => x.done).length,
      })),
      history: hist,
    };
  }
  app.get('/api/energy/opportunities/:id/iter', async (req, res) => {
    res.json(await iterDetail(v.int(req.params.id, 'id', { min: 1 }), req.user.id));
  });

  // Tipo di progetto (cambia il modello solo per le fasi che si creano dopo: quelle esistenti restano).
  app.patch('/api/energy/opportunities/:id/iter', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await selectedById(id);
    const type = v.oneOf(req.body?.project_type, 'Tipo', Object.keys(PROJECT_TYPES));
    await db.query('UPDATE energy_opportunities SET project_type = $2, updated_at = now() WHERE id = $1', [id, type]);
    res.json(await iterDetail(id, req.user.id));
  });

  // ── pipeline: valutazione → avviato → scartato (e ritorno in valutazione) ───────────────────
  app.post('/api/energy/opportunities/:id/selection', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const o = await selectedById(id);
    const to = v.oneOf(req.body?.to, 'Colonna', Object.keys(SELECTION));
    if (!to) throw new HttpError(400, 'Scegli la colonna');
    const reason = v.text(req.body?.reason, 'Motivo', { max: 500 }) || '';
    if (to === o.selection) return res.json(await iterDetail(id, req.user.id));
    if (to === 'scartato' && !reason) throw new HttpError(400, 'Scrivi il motivo per cui si scarta');
    await db.tx(async q => {
      await q.query(
        `UPDATE energy_opportunities SET selection = $2, selection_reason = $3, selection_changed_at = now(), updated_at = now(),
                target_step = CASE WHEN $2 = 'valutazione' THEN 'contatto_venditore' ELSE target_step END,
                target_outcome = CASE WHEN $2 = 'scartato' THEN 'perso' ELSE NULL END
          WHERE id = $1`, [id, to, to === 'scartato' ? reason : '']);
      await history(q, id, `sel:${o.selection}`, `sel:${to}`, reason, req.user.id);
      const now = { ...o, selection: to };
      if (to === 'avviato' && !(await phasesOf(q, id)).length) await createPhases(q, now, req.user.id);
      if (o.project_id) await q.query('UPDATE projects SET status = $2, updated_at = now() WHERE id = $1', [o.project_id, to === 'scartato' ? 'done' : 'active']);
      if (to === 'avviato') await afterChange(q, now, req.user.id);
      else await syncTickets(q, now, req.user.id);
    });
    res.json(await iterDetail(id, req.user.id));
  });

  // Colonne della pipeline, con la fase in corso e la prossima scadenza di ogni progetto.
  app.get('/api/energy/selected', async (req, res) => {
    const params = [];
    const where = ['o.selection IS NOT NULL'];
    if (req.query.type) { params.push(v.oneOf(String(req.query.type), 'Tipo', Object.keys(PROJECT_TYPES))); where.push(`COALESCE(o.project_type, '') = $${params.length}`); }
    if (req.query.q) { params.push(`%${String(req.query.q).trim()}%`); where.push(`(o.title ILIKE $${params.length} OR c.name ILIKE $${params.length})`); }
    const { rows } = await db.query(
      `SELECT o.id, o.kind, o.project_type, o.title, o.mw, o.capex, o.city, o.province, o.project_id, o.selection, o.selection_reason,
              o.selection_changed_at, c.name AS company_name, u.name AS owner_name, (o.data->'scenario'->>'irr')::float AS irr
         FROM energy_opportunities o LEFT JOIN energy_companies c ON c.id = o.company_id LEFT JOIN users u ON u.id = o.owner_id
        WHERE ${where.join(' AND ')} ORDER BY o.selection_changed_at DESC NULLS LAST, o.id DESC`, params);
    const { rows: phases } = rows.length ? await db.query(
      `SELECT p.opportunity_id, p.label, p.due_date::text AS due_date, p.done_at, u.name AS owner_name
         FROM energy_iter_phases p LEFT JOIN users u ON u.id = p.owner_id WHERE p.opportunity_id = ANY($1) ORDER BY p.position, p.id`, [rows.map(r => r.id)]) : { rows: [] };
    const byOpp = {};
    for (const p of phases) (byOpp[p.opportunity_id] ||= []).push(p);
    const cards = rows.map(r => {
      const list = byOpp[r.id] || [];
      const cur = list.findIndex(p => !p.done_at);
      const p = cur >= 0 ? list[cur] : null;
      return {
        ...r, project_type: r.project_type || typeFromKind(r.kind),
        phases: list.map((x, i) => (x.done_at ? 'fatta' : i === cur ? 'attuale' : 'dopo')),
        phase: p ? { n: cur + 1, total: list.length, label: p.label, due_date: p.due_date, owner_name: p.owner_name } : null,
        done: list.length > 0 && cur === -1,
      };
    });
    const col = key => {
      const list = cards.filter(c => c.selection === key);
      return { key, label: SELECTION[key], count: list.length, mw: list.reduce((s, x) => s + (Number(x.mw) || 0), 0), cards: list };
    };
    res.json({ types: PROJECT_TYPES, columns: Object.keys(SELECTION).map(col) });
  });

  // ── modifica dell'iter sul singolo progetto ──────────────────────────────────────────────────
  const itemsOf = p => (Array.isArray(p.items) ? p.items : []);
  const isoDay = d => (d ? String(d).slice(0, 10) : null);

  // Nuova fase (in fondo o dopo un'altra), segnata come aggiunta a mano.
  app.post('/api/energy/opportunities/:id/iter/phases', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const o = await selectedById(id);
    const label = v.text(req.body?.label, 'Nome della fase', { max: 120 });
    if (!label) throw new HttpError(400, 'Dai un nome alla fase');
    const after = req.body?.after === undefined || req.body?.after === null ? null : v.int(req.body?.after, 'Dopo la fase', { min: 1 });
    await db.tx(async q => {
      const phases = await phasesOf(q, id);
      const at = after ? phases.findIndex(p => p.id === after) + 1 : phases.length;
      if (after && at === 0) throw new HttpError(400, 'Fase di riferimento non trovata');
      const prevDue = isoDay(phases[at - 1]?.due_date) || romeNow().day;
      await q.query('UPDATE energy_iter_phases SET position = position + 1 WHERE opportunity_id = $1 AND position > $2', [id, at]);
      await q.query(
        `INSERT INTO energy_iter_phases (opportunity_id, position, key, label, days, owner_id, due_date, added, items)
         VALUES ($1, $2, '', $3, 10, $4, $5, true, '[]')`, [id, at + 1, label, o.owner_id || req.user.id, addWorkdays(prevDue, 10)]);
      await renumber(q, id);
      await history(q, id, '', `fase:aggiunta`, label, req.user.id);
      await afterChange(q, o, req.user.id);
    });
    res.status(201).json(await iterDetail(id, req.user.id));
  });

  async function renumber(q, oppId) {
    const phases = await phasesOf(q, oppId);
    for (const [i, p] of phases.entries()) if (p.position !== i + 1) await q.query('UPDATE energy_iter_phases SET position = $2 WHERE id = $1', [p.id, i + 1]);
  }

  // Nome, responsabile e scadenza della fase.
  app.patch('/api/energy/iter/phases/:phaseId', async (req, res) => {
    const { p, o } = await phaseById(db, v.int(req.params.phaseId, 'id', { min: 1 }));
    const label = req.body?.label === undefined ? undefined : v.text(req.body?.label, 'Nome della fase', { max: 120 });
    if (label === '') throw new HttpError(400, 'Dai un nome alla fase');
    const owner = req.body?.owner_id === undefined ? undefined : req.body?.owner_id === null || req.body?.owner_id === '' ? null : v.int(req.body?.owner_id, 'Responsabile', { min: 1 });
    const due = req.body?.due_date === undefined ? undefined : req.body?.due_date ? v.date(req.body?.due_date, 'Scadenza') : null;
    await db.tx(async q => {
      await q.query(
        `UPDATE energy_iter_phases SET label = COALESCE($2, label), owner_id = CASE WHEN $3 THEN $4::int ELSE owner_id END,
                due_date = CASE WHEN $5 THEN $6::date ELSE due_date END WHERE id = $1`,
        [p.id, label || null, owner !== undefined, owner ?? null, due !== undefined, due ?? null]);
      await syncTickets(q, o, req.user.id);
    });
    res.json(await iterDetail(o.id, req.user.id));
  });

  // Sposta su o giù.
  app.post('/api/energy/iter/phases/:phaseId/move', async (req, res) => {
    const { p, o } = await phaseById(db, v.int(req.params.phaseId, 'id', { min: 1 }));
    const dir = Number(req.body?.dir) < 0 ? -1 : 1;
    await db.tx(async q => {
      const phases = await phasesOf(q, o.id);
      const i = phases.findIndex(x => x.id === p.id);
      const j = i + dir;
      if (j < 0 || j >= phases.length) return;
      await q.query('UPDATE energy_iter_phases SET position = $2 WHERE id = $1', [phases[i].id, j + 1]);
      await q.query('UPDATE energy_iter_phases SET position = $2 WHERE id = $1', [phases[j].id, i + 1]);
      await afterChange(q, o, req.user.id);
    });
    res.json(await iterDetail(o.id, req.user.id));
  });

  // Toglie una fase (e la sua riga del Gantt). Ne resta sempre almeno una.
  app.delete('/api/energy/iter/phases/:phaseId', async (req, res) => {
    const { p, o } = await phaseById(db, v.int(req.params.phaseId, 'id', { min: 1 }));
    await db.tx(async q => {
      const { rows: [{ n }] } = await q.query('SELECT count(*)::int AS n FROM energy_iter_phases WHERE opportunity_id = $1', [o.id]);
      if (n <= 1) throw new HttpError(400, 'L\'iter deve avere almeno una fase');
      await q.query('DELETE FROM energy_iter_phases WHERE id = $1', [p.id]);
      if (p.ticket_id) await q.query('DELETE FROM tickets WHERE id = $1', [p.ticket_id]);
      await renumber(q, o.id);
      await history(q, o.id, '', 'fase:tolta', p.label, req.user.id);
      await afterChange(q, o, req.user.id);
    });
    res.json(await iterDetail(o.id, req.user.id));
  });

  // Punti della fase: aggiungere, spuntare, rinominare, data, togliere.
  app.post('/api/energy/iter/phases/:phaseId/items', async (req, res) => {
    const { p, o } = await phaseById(db, v.int(req.params.phaseId, 'id', { min: 1 }));
    const label = v.text(req.body?.label, 'Punto', { max: 200 });
    if (!label) throw new HttpError(400, 'Scrivi il punto');
    const items = itemsOf(p);
    if (items.length >= 60) throw new HttpError(400, 'Troppi punti in questa fase');
    let key = `m${Date.now().toString(36)}`;
    while (items.some(x => x.key === key)) key += 'x';
    items.push({ key, label, done: false, added: true });
    await db.query('UPDATE energy_iter_phases SET items = $2 WHERE id = $1', [p.id, JSON.stringify(items)]);
    res.status(201).json(await iterDetail(o.id, req.user.id));
  });

  app.patch('/api/energy/iter/phases/:phaseId/items/:key', async (req, res) => {
    const { p, o } = await phaseById(db, v.int(req.params.phaseId, 'id', { min: 1 }));
    const items = itemsOf(p);
    const it = items.find(x => x.key === req.params.key);
    if (!it) throw new HttpError(404, 'Punto non trovato');
    if (req.body?.done !== undefined) it.done = Boolean(req.body?.done);
    if (req.body?.label !== undefined) {
      const label = v.text(req.body?.label, 'Punto', { max: 200 });
      if (!label) throw new HttpError(400, 'Scrivi il punto');
      it.label = label;
    }
    if (req.body?.due_date !== undefined) it.due_date = req.body?.due_date ? v.date(req.body?.due_date, 'Data') : null;
    await db.query('UPDATE energy_iter_phases SET items = $2 WHERE id = $1', [p.id, JSON.stringify(items)]);
    res.json(await iterDetail(o.id, req.user.id));
  });

  app.delete('/api/energy/iter/phases/:phaseId/items/:key', async (req, res) => {
    const { p, o } = await phaseById(db, v.int(req.params.phaseId, 'id', { min: 1 }));
    const items = itemsOf(p).filter(x => x.key !== req.params.key);
    await db.query('UPDATE energy_iter_phases SET items = $2 WHERE id = $1', [p.id, JSON.stringify(items)]);
    res.json(await iterDetail(o.id, req.user.id));
  });

  // Chiude la fase in corso: con tutti i punti spuntati, oppure con un motivo. L'ultima chiude l'iter.
  app.post('/api/energy/iter/phases/:phaseId/close', async (req, res) => {
    const { p, o } = await phaseById(db, v.int(req.params.phaseId, 'id', { min: 1 }));
    if (o.selection !== 'avviato') throw new HttpError(400, 'L\'iter parte con «Avvia la DD tecnica»');
    if (p.done_at) throw new HttpError(400, 'La fase è già chiusa');
    const phases = await phasesOf(db, o.id);
    if (phases.find(x => !x.done_at)?.id !== p.id) throw new HttpError(400, 'Si chiude una fase alla volta, nell\'ordine');
    const reason = v.text(req.body?.reason, 'Motivo', { max: 500 }) || '';
    const missing = itemsOf(p).filter(x => !x.done);
    if (missing.length && !reason) {
      throw new HttpError(400, `Punti ancora aperti: ${missing.map(x => x.label).join(', ')}. Spuntali o scrivi perché si chiude lo stesso.`, 'checklist');
    }
    await db.tx(async q => {
      await q.query('UPDATE energy_iter_phases SET done_at = now() WHERE id = $1', [p.id]);
      await history(q, o.id, `fase:${p.label}`, `fase:chiusa`, reason ? `${p.label} · chiusa con punti aperti: ${reason}` : p.label, req.user.id);
      await afterChange(q, o, req.user.id);
    });
    res.json(await iterDetail(o.id, req.user.id));
  });

  // Riapre una fase chiusa (e tutte quelle dopo).
  app.post('/api/energy/iter/phases/:phaseId/reopen', async (req, res) => {
    const { p, o } = await phaseById(db, v.int(req.params.phaseId, 'id', { min: 1 }));
    if (!p.done_at) throw new HttpError(400, 'La fase è già aperta');
    await db.tx(async q => {
      await q.query('UPDATE energy_iter_phases SET done_at = NULL WHERE opportunity_id = $1 AND position >= $2', [o.id, p.position]);
      await history(q, o.id, '', 'fase:riaperta', p.label, req.user.id);
      await afterChange(q, o, req.user.id);
    });
    res.json(await iterDetail(o.id, req.user.id));
  });
}

module.exports = { registerEnergyIter, TICKET_RE };
