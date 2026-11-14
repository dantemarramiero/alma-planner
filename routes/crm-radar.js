// Radar commerciale (Dante 14/11/2026; canvas «Segnale», «Piano d'azione», «Proposte dal radar»):
// - segnali per BU con punteggio; il responsabile decide Interessa / Scarta (con motivo) / Manda a un'altra BU;
// - le gare già bandite (Infordat) vanno solo all'ufficio gare: «Porta su BOSS» o «Scarta» (il mercoledì decide BOSS);
// - Interessa → l'azienda nel CRM (nuovo lead se non c'è) e un piano d'azione proposto dal playbook, che diventa
//   prossimi passi quando lo si accetta (PC-10);
// - Infordat si carica con l'export (non dà le API, Dante 14/11).
const express = require('express');
const { HttpError, v } = require('../lib/http');
const { readXlsx } = require('../lib/xlsx');
const { loadSettings, managerOf, CHANNELS } = require('../lib/crm-commerciale');
const { scoreSignal, bestBu, parseDelimited, readInfordat, proposePlan, pickPlaybook, norm } = require('../lib/crm-radar');

const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const KINDS = ['gara', 'opera_finanziata', 'scadenza', 'permesso', 'nuovo_gestore', 'investimento', 'cliente', 'notizia', 'indiscrezione'];

function registerCrmRadar(app, { db, subjectById, syncNext, notifier, adminEmails = [], radarFetch }) {
  const raw = express.raw({ type: () => true, limit: '20mb' });
  async function ctx(req) {
    const [settings, { rows: users }] = await Promise.all([loadSettings(db), db.query('SELECT id, name, email FROM users')]);
    const busOf = userId => Object.entries(settings.profiles).filter(([, p]) => managerOf(p, users)?.id === userId).map(([k]) => k);
    const gare = req.crm.admin || (settings.radar.gare_users || []).includes(req.user.id);
    return { settings, users, myBus: busOf(req.user.id), gare, managerId: bu => managerOf(settings.profiles[bu], users)?.id || null };
  }
  const gareOnly = c => { if (!c.gare) throw new HttpError(403, 'Le proposte dal radar le gestisce l\'ufficio gare'); };

  // azienda del CRM con lo stesso nome dell'ente o dell'azienda del segnale
  async function matchSubject(entity) {
    const n = norm(entity).replace(/[^a-z0-9 ]/g, '').replace(/\b(srl|spa|s r l|s p a|snc|sas|scarl|soc coop)\b/g, '').trim();
    if (n.length < 3) return null;
    const { rows } = await db.query(
      `SELECT id, name, roles FROM crm_subjects WHERE merged_into IS NULL
          AND (lower(name) = lower($1) OR lower(short_name) = lower($1)
               OR regexp_replace(lower(name), '[^a-z0-9 ]|\\m(srl|spa|snc|sas)\\M', '', 'g') ILIKE $2) LIMIT 1`, [entity.trim(), `%${n}%`]);
    return rows[0] || null;
  }
  // nuovo segnale: BU, azienda collegata, punteggio; null se c'è già (stessa fonte e codice)
  async function addSignal(sig, c, userId) {
    const subject = sig.subject_id ? (await db.query('SELECT id, name, roles FROM crm_subjects WHERE id = $1', [sig.subject_id])).rows[0] : sig.entity ? await matchSubject(sig.entity) : null;
    const bu = sig.bu || bestBu(sig, c.settings.profiles);
    const relationship = subject ? (subject.roles.includes('cliente') ? 'client' : 'known') : 'unknown';
    const { score, parts, why } = scoreSignal(sig, bu ? c.settings.profiles[bu] : null, c.settings.scoring, { relationship, today: todayRome() });
    const { rows: [row] } = await db.query(
      `INSERT INTO crm_signals (source, external_id, kind, bu, title, summary, why, entity, subject_id, amount, region, place, url, published_on, deadline, cig, soa,
                                score, score_parts, to_gare, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       ON CONFLICT (source, external_id) WHERE external_id <> '' DO NOTHING RETURNING *`,
      [sig.source, sig.external_id || '', sig.kind || '', bu, sig.title, sig.summary || '', sig.why || why.join(' · '), sig.entity || '', subject?.id || null,
        sig.amount ?? null, sig.region || '', sig.place || '', sig.url || '', sig.published_on || null, sig.deadline || null, sig.cig || '', sig.soa || [],
        score, JSON.stringify(parts), Boolean(sig.to_gare), userId]);
    return row || null;
  }
  const SELECT = `SELECT g.*, s.name AS subject_name, s.roles AS subject_roles, a.label AS bu_label, u.name AS decided_by_name
                    FROM crm_signals g LEFT JOIN crm_subjects s ON s.id = g.subject_id LEFT JOIN crm_asa a ON a.key = g.bu
                    LEFT JOIN users u ON u.id = g.decided_by`;
  async function signalById(id) {
    const { rows: [g] } = await db.query(`${SELECT} WHERE g.id = $1`, [id]);
    if (!g) throw new HttpError(404, 'Segnale non trovato');
    return g;
  }

  // ── segnali ────────────────────────────────────────────────────────────────────────────────
  // view: mine (le mie BU, sopra soglia) · sotto (le mie BU, sotto soglia) · gare (ufficio gare) · bu (una BU, direzione)
  app.get('/api/crm/radar/signals', async (req, res) => {
    const c = await ctx(req);
    const view = String(req.query.view || 'mine');
    const min = c.settings.scoring.min;
    const params = [];
    const where = [];
    const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };
    if (view === 'gare') {
      gareOnly(c);
      where.push('g.to_gare');
      add('g.status = ANY(?::text[])', req.query.all ? ['nuovo', 'boss', 'gara_scartata'] : ['nuovo']);
    } else {
      where.push('NOT g.to_gare');
      add('g.status = ANY(?::text[])', req.query.all ? ['nuovo', 'interessa', 'scartato'] : ['nuovo']);
      const bus = req.query.bu ? String(req.query.bu).split(',') : c.myBus;
      if (req.query.bu && !req.crm.admin && bus.some(b => !c.myBus.includes(b))) throw new HttpError(403, 'Vedi i segnali delle tue BU');
      add('g.bu = ANY(?::text[])', bus);
      if (view === 'sotto') add('g.score < ?', min);
      else if (view === 'mine') add('g.score >= ?', min);
    }
    const { rows } = await db.query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY g.score DESC, g.created_at DESC LIMIT 300`, params);
    res.json({ signals: rows, min, highlight: c.settings.scoring.highlight, bus: c.myBus, gare: c.gare, discardReasons: c.settings.rules.discard_reasons });
  });
  app.get('/api/crm/radar/signals/:id', async (req, res) => {
    const g = await signalById(v.int(req.params.id, 'id', { min: 1 }));
    const c = await ctx(req);
    res.json({ ...g, weights: c.settings.scoring.weights, discardReasons: c.settings.rules.discard_reasons });
  });
  // segnalazione a mano (anche dal telefono): passa dal punteggio come le altre
  app.post('/api/crm/radar/signals', async (req, res) => {
    const c = await ctx(req);
    const b = req.body;
    const asaKeys = Object.keys(c.settings.profiles);
    const sig = {
      source: 'manuale', external_id: '', kind: b.kind ? v.oneOf(b.kind, 'Tipo', KINDS) : 'notizia',
      bu: b.bu ? v.oneOf(b.bu, 'BU', asaKeys) : null, title: v.text(b.title, 'Cosa è successo', { max: 500, required: true }),
      summary: v.text(b.summary, 'Dettagli', { max: 3000 }) || '', entity: v.text(b.entity, 'Ente o azienda', { max: 300 }) || '',
      subject_id: b.subject_id ? v.int(b.subject_id, 'Azienda', { min: 1 }) : null,
      amount: b.amount === undefined || b.amount === null || b.amount === '' ? null : Number(String(b.amount).replace(/\./g, '').replace(',', '.')),
      url: v.text(b.url, 'Link', { max: 500 }) || '', deadline: v.date(b.deadline || null, 'Quando'), region: v.text(b.region, 'Regione', { max: 60 }) || '',
      soa: Array.isArray(b.soa) ? b.soa.map(String).slice(0, 20) : [], to_gare: Boolean(b.to_gare),
    };
    if (sig.amount !== null && !Number.isFinite(sig.amount)) throw new HttpError(400, 'L\'importo non è valido');
    if (sig.url && !/^https?:\/\//i.test(sig.url)) throw new HttpError(400, 'Il link deve iniziare con http');
    res.status(201).json(await addSignal(sig, c, req.user.id));
  });
  async function decideCheck(req, g, c) {
    if (g.status !== 'nuovo') throw new HttpError(409, 'Su questo segnale si è già deciso');
    if (g.to_gare) throw new HttpError(409, 'Le gare già bandite le decide l\'ufficio gare');
    if (!req.crm.admin && !c.myBus.includes(g.bu)) throw new HttpError(403, 'Decide il responsabile della BU');
  }
  // proposta di piano per un'azienda (dal segnale o a mano)
  async function makePlan(subjectId, { signal = null, playbookId = null, c, userId }) {
    const s = await subjectById(null, subjectId);
    const bu = signal?.bu || s.asa[0];
    const playbook = playbookId ? c.settings.playbooks.find(p => p.id === playbookId) : pickPlaybook(c.settings.playbooks, { kind: signal?.kind, bu, isClient: s.roles.includes('cliente') });
    if (!playbook) throw new HttpError(400, 'Nessun playbook: aggiungine uno in Impostazioni');
    const { rows: [contact] } = await db.query(
      `SELECT c.id, c.title, c.first_name, c.last_name FROM crm_contact_links l JOIN crm_contacts c ON c.id = l.contact_id
        WHERE l.subject_id = $1 AND l.date_to IS NULL ORDER BY l.is_primary DESC, c.id LIMIT 1`, [subjectId]);
    const { rows: refs } = await db.query(
      `SELECT name FROM crm_subjects WHERE merged_into IS NULL AND 'cliente' = ANY(roles) AND $1 = ANY(asa) AND id <> $2 ORDER BY client_since NULLS LAST LIMIT 3`, [bu || '', subjectId]);
    const ownerId = (bu && c.managerId(bu)) || s.owner_id || userId;
    const p = proposePlan({ playbook, signal, subject: s, contact, ownerId, refs: refs.map(r => r.name), today: todayRome() });
    const { rows: [plan] } = await db.query(
      `INSERT INTO crm_plans (subject_id, signal_id, playbook_id, title, check_question, refs, steps, owner_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [subjectId, signal?.id || null, p.playbook_id, p.title.slice(0, 500), p.check_question, p.refs, JSON.stringify(p.steps), ownerId, userId]);
    return plan;
  }
  app.post('/api/crm/radar/signals/:id/interessa', async (req, res) => {
    const g = await signalById(v.int(req.params.id, 'id', { min: 1 }));
    const c = await ctx(req);
    await decideCheck(req, g, c);
    let subjectId = g.subject_id || (req.body.subject_id ? v.int(req.body.subject_id, 'Azienda', { min: 1 }) : null);
    if (subjectId) await subjectById(req, subjectId, { forWrite: true });
    else { // l'azienda non c'è: nuovo lead della BU, owner il responsabile
      const name = v.text(req.body.name || g.entity || g.title, 'Nome dell\'azienda', { max: 200, required: true });
      const { rows: [s] } = await db.query(
        `INSERT INTO crm_subjects (name, roles, asa, owner_id, lead_why, origin, created_by) VALUES ($1, '{lead}', $2, $3, $4, 'Radar', $5) RETURNING id, lead_stage`,
        [name, g.bu ? [g.bu] : ['altri_servizi'], c.managerId(g.bu) || req.user.id, g.title.slice(0, 2000), req.user.id]);
      await db.query('INSERT INTO crm_stage_history (subject_id, from_stage, to_stage, note, user_id) VALUES ($1, NULL, $2, $3, $4)', [s.id, s.lead_stage, 'dal radar', req.user.id]);
      subjectId = s.id;
    }
    await db.query(`UPDATE crm_signals SET status = 'interessa', subject_id = $2, decided_by = $3, decided_at = now(), note = $4 WHERE id = $1`,
      [g.id, subjectId, req.user.id, v.text(req.body.note, 'Nota', { max: 2000 }) || '']);
    const plan = await makePlan(subjectId, { signal: { ...g, subject_id: subjectId }, c, userId: req.user.id });
    res.json({ subject_id: subjectId, plan });
  });
  app.post('/api/crm/radar/signals/:id/scarta', async (req, res) => {
    const g = await signalById(v.int(req.params.id, 'id', { min: 1 }));
    const c = await ctx(req);
    await decideCheck(req, g, c);
    const reason = v.text(req.body.reason, 'Motivo', { max: 120, required: true });
    await db.query(`UPDATE crm_signals SET status = 'scartato', discard_reason = $2, note = $3, decided_by = $4, decided_at = now() WHERE id = $1`,
      [g.id, reason, v.text(req.body.note, 'Nota', { max: 2000 }) || '', req.user.id]);
    res.json({ ok: true });
  });
  app.post('/api/crm/radar/signals/:id/bu', async (req, res) => { // «Manda a un'altra BU»: punteggio rifatto con il suo profilo
    const g = await signalById(v.int(req.params.id, 'id', { min: 1 }));
    const c = await ctx(req);
    await decideCheck(req, g, c);
    const bu = v.oneOf(req.body.bu, 'BU', Object.keys(c.settings.profiles));
    const relationship = g.subject_roles ? (g.subject_roles.includes('cliente') ? 'client' : 'known') : 'unknown';
    const { score, parts, why } = scoreSignal({ ...g, amount: g.amount === null ? null : Number(g.amount), deadline: g.deadline ? String(g.deadline instanceof Date ? g.deadline.toISOString() : g.deadline).slice(0, 10) : null },
      c.settings.profiles[bu], c.settings.scoring, { relationship, today: todayRome() });
    await db.query('UPDATE crm_signals SET bu = $2, score = $3, score_parts = $4, why = $5 WHERE id = $1', [g.id, bu, score, JSON.stringify(parts), why.join(' · ')]);
    res.json(await signalById(g.id));
  });
  // ufficio gare: «Porta su BOSS» (ci si lavora alla riunione del mercoledì) o «Scarta»
  app.post('/api/crm/radar/signals/:id/gare', async (req, res) => {
    const g = await signalById(v.int(req.params.id, 'id', { min: 1 }));
    const c = await ctx(req);
    gareOnly(c);
    if (!g.to_gare) throw new HttpError(409, 'Non è una gara per l\'ufficio gare');
    if (g.status !== 'nuovo') throw new HttpError(409, 'Su questa gara si è già deciso');
    const action = v.oneOf(req.body.action, 'Azione', ['boss', 'scarta']);
    const reason = action === 'scarta' ? v.text(req.body.reason, 'Motivo', { max: 120, required: true }) : '';
    await db.query('UPDATE crm_signals SET status = $2, discard_reason = $3, note = $4, decided_by = $5, decided_at = now() WHERE id = $1',
      [g.id, action === 'boss' ? 'boss' : 'gara_scartata', reason, v.text(req.body.note, 'Nota', { max: 2000 }) || '', req.user.id]);
    res.json({ ok: true });
  });

  // ── export di Infordat ─────────────────────────────────────────────────────────────────────
  function infordatRows(buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) throw new HttpError(400, 'Carica l\'export di Infordat (Excel o CSV)');
    let rows;
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      try { rows = Object.values(readXlsx(buf))[0] || []; } catch { throw new HttpError(400, 'Il file non è un Excel (.xlsx) valido'); }
    } else {
      let text = buf.toString('utf8');
      if (text.includes('�')) text = buf.toString('latin1'); // export in Windows-1252
      rows = parseDelimited(text.replace(/^﻿/, ''));
    }
    const out = readInfordat(rows);
    if (out.missing.length) throw new HttpError(400, `Non trovo la colonna «oggetto» della gara. Colonne del file: ${(rows.find(r => r.length >= 3) || []).slice(0, 15).join(', ')}`);
    return out;
  }
  app.post('/api/crm/radar/infordat/anteprima', raw, async (req, res) => {
    const c = await ctx(req);
    gareOnly(c);
    const { rows, columns } = infordatRows(req.body);
    const ids = rows.map(r => r.external_id);
    const { rows: seen } = await db.query(`SELECT external_id FROM crm_signals WHERE source = 'infordat' AND external_id = ANY($1::text[])`, [ids]);
    const old = new Set(seen.map(r => r.external_id));
    res.json({ total: rows.length, fresh: rows.filter(r => !old.has(r.external_id)).length, columns, sample: rows.slice(0, 8) });
  });
  app.post('/api/crm/radar/infordat', raw, async (req, res) => {
    const c = await ctx(req);
    gareOnly(c);
    const { rows } = infordatRows(req.body);
    let added = 0;
    for (const r of rows) {
      const g = await addSignal({ ...r, source: 'infordat', kind: 'gara', to_gare: true }, c, req.user.id);
      if (g) added++;
    }
    res.json({ total: rows.length, added, skipped: rows.length - added });
  });

  // ── piani d'azione ─────────────────────────────────────────────────────────────────────────
  const PLAN_SELECT = `SELECT p.*, s.name AS subject_name, u.name AS owner_name, g.title AS signal_title, g.url AS signal_url
                         FROM crm_plans p JOIN crm_subjects s ON s.id = p.subject_id LEFT JOIN users u ON u.id = p.owner_id
                         LEFT JOIN crm_signals g ON g.id = p.signal_id`;
  async function planById(id) {
    const { rows: [p] } = await db.query(`${PLAN_SELECT} WHERE p.id = $1`, [id]);
    if (!p) throw new HttpError(404, 'Piano non trovato');
    return p;
  }
  async function withSteps(plans) {
    if (!plans.length) return plans;
    const { rows } = await db.query(`SELECT st.id, st.plan_id, st.title, st.due_date, st.done_at, st.outcome, u.name AS owner_name FROM crm_steps st
                                       LEFT JOIN users u ON u.id = st.owner_id WHERE st.plan_id = ANY($1::int[]) ORDER BY st.sort, st.due_date`, [plans.map(p => p.id)]);
    return plans.map(p => ({ ...p, live: rows.filter(r => r.plan_id === p.id) }));
  }
  app.get('/api/crm/subjects/:id/plans', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await subjectById(req, id);
    const [{ rows }, { rows: signals }] = await Promise.all([
      db.query(`${PLAN_SELECT} WHERE p.subject_id = $1 ORDER BY p.status = 'chiuso', p.created_at DESC`, [id]),
      db.query(`${SELECT} WHERE g.subject_id = $1 ORDER BY g.created_at DESC LIMIT 50`, [id]),
    ]);
    const c = await ctx(req);
    res.json({ plans: await withSteps(rows), signals, playbooks: c.settings.playbooks.map(p => ({ id: p.id, name: p.name })), channels: CHANNELS });
  });
  app.get('/api/crm/radar/plans', async (req, res) => { // piani da accettare o aperti di chi guarda
    const status = String(req.query.status || 'proposto');
    const { rows } = await db.query(`${PLAN_SELECT} WHERE p.status = $1 AND p.owner_id = $2 ORDER BY p.created_at DESC LIMIT 100`, [status, req.user.id]);
    res.json({ plans: await withSteps(rows) });
  });
  app.get('/api/crm/plans/:id', async (req, res) => {
    const p = await planById(v.int(req.params.id, 'id', { min: 1 }));
    const { rows: contacts } = await db.query(`SELECT c.id, c.title, c.first_name, c.last_name, l.job FROM crm_contact_links l JOIN crm_contacts c ON c.id = l.contact_id
                                                WHERE l.subject_id = $1 AND l.date_to IS NULL ORDER BY l.is_primary DESC, lower(c.last_name)`, [p.subject_id]);
    res.json({ ...(await withSteps([p]))[0], contacts, channels: CHANNELS });
  });
  app.post('/api/crm/subjects/:id/plans', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await subjectById(req, id, { forWrite: true });
    const c = await ctx(req);
    res.status(201).json(await makePlan(id, { playbookId: req.body.playbook_id ? String(req.body.playbook_id) : null, c, userId: req.user.id }));
  });
  // «Accetta piano»: i passi (anche modificati) diventano prossimi passi dell'azienda
  app.post('/api/crm/plans/:id/accept', async (req, res) => {
    const p = await planById(v.int(req.params.id, 'id', { min: 1 }));
    if (p.status !== 'proposto') throw new HttpError(409, 'Il piano è già stato accettato');
    const steps = Array.isArray(req.body.steps) ? req.body.steps : p.steps;
    if (!steps.length || steps.length > 15) throw new HttpError(400, 'Il piano deve avere da 1 a 15 passi');
    const clean = [];
    for (const st of steps) {
      const title = v.text(st.title, 'Passo', { max: 300 });
      if (!title) continue;
      const due = v.date(st.due_date, 'Data del passo');
      if (!due) throw new HttpError(400, `Manca la data del passo «${title}»`);
      const owner = st.owner_id ? v.int(st.owner_id, 'Chi lo fa', { min: 1 }) : null;
      clean.push({ title, due, owner, contact: st.contact_id ? v.int(st.contact_id, 'Contatto', { min: 1 }) : null,
        channel: st.channel && CHANNELS[st.channel] ? st.channel : '', draft: v.text(st.draft, 'Bozza', { max: 5000 }) || '' });
    }
    if (!clean.length) throw new HttpError(400, 'Il piano non ha passi');
    await db.tx(async q => {
      for (const [i, st] of clean.entries()) {
        await q.query(`INSERT INTO crm_steps (subject_id, contact_id, title, channel, due_date, owner_id, draft, plan_id, sort, created_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [p.subject_id, st.contact, st.title, st.channel, st.due, st.owner || p.owner_id, st.draft, p.id, i, req.user.id]);
      }
      await q.query(`UPDATE crm_plans SET status = 'accettato', steps = $2, accepted_by = $3, accepted_at = now(), title = COALESCE(NULLIF($4, ''), title) WHERE id = $1`,
        [p.id, JSON.stringify(clean), req.user.id, v.text(req.body.title, 'Titolo', { max: 500 }) || '']);
    });
    await syncNext(p.subject_id);
    res.json(await planById(p.id));
  });
  app.post('/api/crm/plans/:id/close', async (req, res) => {
    const p = await planById(v.int(req.params.id, 'id', { min: 1 }));
    if (p.status === 'chiuso') throw new HttpError(409, 'Il piano è già chiuso');
    const outcome = v.oneOf(req.body.outcome, 'Esito', ['opportunita', 'rimandato', 'perso']);
    await db.query(`UPDATE crm_plans SET status = 'chiuso', outcome = $2, outcome_note = $3, closed_at = now() WHERE id = $1`, [p.id, outcome, v.text(req.body.note, 'Nota', { max: 2000 }) || '']);
    if (req.body.close_steps) await db.query('UPDATE crm_steps SET done_at = now(), done_by = $2, outcome = $3 WHERE plan_id = $1 AND done_at IS NULL', [p.id, req.user.id, 'piano chiuso']);
    await syncNext(p.subject_id);
    res.json(await planById(p.id));
  });
  app.delete('/api/crm/plans/:id', async (req, res) => { // una proposta che non serve
    const p = await planById(v.int(req.params.id, 'id', { min: 1 }));
    if (p.status !== 'proposto') throw new HttpError(409, 'Si cancella solo una proposta non ancora accettata');
    await db.query('DELETE FROM crm_plans WHERE id = $1', [p.id]);
    res.json({ ok: true });
  });

  // ── giro dell'AI (notizie in rete), quote del budget ───────────────────────────────────────
  const month = () => todayRome().slice(0, 7);
  async function spendOf(bu) {
    const { rows: [r] } = await db.query('SELECT eur, alerted_at FROM crm_radar_spend WHERE month = $1 AND bu = $2', [month(), bu]);
    return { eur: Number(r?.eur || 0), alerted: Boolean(r?.alerted_at) };
  }
  // quota finita: avviso agli amministratori una volta al mese per BU, con «Aumenta» nelle impostazioni
  async function budgetAlert(bu, c, quota) {
    const { rowCount } = await db.query('UPDATE crm_radar_spend SET alerted_at = now() WHERE month = $1 AND bu = $2 AND alerted_at IS NULL', [month(), bu]);
    if (!rowCount || !c.settings.radar.alert_admins_on_budget || !notifier) return;
    const { rows: admins } = await db.query('SELECT id FROM users WHERE lower(email) = ANY($1::text[])', [adminEmails.map(e => e.toLowerCase())]);
    const label = (await db.query('SELECT label FROM crm_asa WHERE key = $1', [bu])).rows[0]?.label || bu;
    if (admins.length) await notifier.notify({ userIds: admins.map(a => a.id), actorId: null, kind: 'crm', body: `${label} ha finito il budget del radar (${quota} €): aumenta la quota o lascia così. Fino ad allora riceve solo i segnali dai dati pubblici.`, link: '/crm/impostazioni/radar' });
  }
  async function runRadar({ bus = null, fetchImpl = radarFetch || fetch, apiKey = process.env.OPENAI_API_KEY || (radarFetch ? 'test' : '') } = {}) {
    if (!apiKey) return { skipped: 'Manca OPENAI_API_KEY su Railway' };
    const { searchBu } = require('../lib/crm-radar-ai');
    const settings = await loadSettings(db);
    const { rows: users } = await db.query('SELECT id, name, email FROM users');
    const c = { settings, users, managerId: bu => managerOf(settings.profiles[bu], users)?.id || null };
    const totalSpent = Number((await db.query('SELECT COALESCE(SUM(eur), 0) AS n FROM crm_radar_spend WHERE month = $1', [month()])).rows[0].n);
    const out = [];
    for (const [bu, b] of Object.entries(settings.radar.bu)) {
      if (bus ? !bus.includes(bu) : !b.on) continue;
      const profile = settings.profiles[bu];
      if (!profile?.description) { out.push({ bu, skipped: 'profilo vuoto' }); continue; }
      const spent = await spendOf(bu);
      if (spent.eur >= b.quota_eur || totalSpent >= settings.radar.budget_eur) { await budgetAlert(bu, c, b.quota_eur); out.push({ bu, skipped: 'budget finito' }); continue; }
      const { rows: cl } = await db.query(`SELECT name FROM crm_subjects WHERE merged_into IS NULL AND 'cliente' = ANY(roles) AND $1 = ANY(asa) ORDER BY client_since NULLS LAST LIMIT 30`, [bu]);
      const label = (await db.query('SELECT label FROM crm_asa WHERE key = $1', [bu])).rows[0]?.label || bu;
      let found = 0, added = 0, cost = 0, error = '';
      try {
        const r = await searchBu({ apiKey, buLabel: label, profile, clients: cl.map(x => x.name), today: todayRome(), fetchImpl });
        cost = r.costEur;
        found = r.signals.length;
        for (const s of r.signals) if (await addSignal({ ...s, source: 'stampa', external_id: s.url, bu }, c, null)) added++;
      } catch (err) { error = String(err.message || err).slice(0, 500); }
      await db.query(`INSERT INTO crm_radar_spend (month, bu, eur) VALUES ($1, $2, $3) ON CONFLICT (month, bu) DO UPDATE SET eur = crm_radar_spend.eur + EXCLUDED.eur`, [month(), bu, cost]);
      await db.query('INSERT INTO crm_radar_runs (bu, found, added, cost_eur, error) VALUES ($1, $2, $3, $4, $5)', [bu, found, added, cost, error]);
      if ((await spendOf(bu)).eur >= b.quota_eur) await budgetAlert(bu, c, b.quota_eur);
      out.push({ bu, found, added, cost, error });
    }
    return { runs: out };
  }
  app.get('/api/crm/radar/status', async (req, res) => {
    if (!req.crm.admin) throw new HttpError(403, 'Solo la direzione');
    const [{ rows: spend }, { rows: runs }] = await Promise.all([
      db.query('SELECT bu, eur, alerted_at FROM crm_radar_spend WHERE month = $1', [month()]),
      db.query('SELECT * FROM crm_radar_runs ORDER BY at DESC LIMIT 30'),
    ]);
    res.json({ ai: Boolean(process.env.OPENAI_API_KEY || radarFetch), model: require('../lib/crm-radar-ai').MODEL, month: month(), spend, runs });
  });
  app.post('/api/crm/radar/run', async (req, res) => { // «Avvia adesso» (direzione), per una BU o per quelle accese
    if (!req.crm.admin) throw new HttpError(403, 'Solo la direzione');
    const out = await runRadar({ bus: req.body.bu ? [String(req.body.bu)] : null });
    if (out.skipped) throw new HttpError(400, out.skipped);
    res.json(out);
  });
  app.post('/api/crm/radar/budget/:bu', async (req, res) => { // «Aumenta di …»: la quota della BU (e il tetto, se serve)
    if (!req.crm.admin) throw new HttpError(403, 'Solo la direzione');
    const eur = v.int(req.body.eur, 'Aumento (€)', { min: 1, max: 1000 });
    const settings = await loadSettings(db);
    const radar = structuredClone(settings.radar);
    if (!radar.bu[req.params.bu]) throw new HttpError(404, 'BU sconosciuta');
    radar.bu[req.params.bu].quota_eur += eur;
    const quotas = Object.values(radar.bu).reduce((s, b) => s + b.quota_eur, 0);
    if (quotas > radar.budget_eur) radar.budget_eur = quotas;
    await db.query(`INSERT INTO crm_settings (key, value, updated_by, updated_at) VALUES ('radar', $1, $2, now())
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [JSON.stringify(radar), req.user.id]);
    await db.query('UPDATE crm_radar_spend SET alerted_at = NULL WHERE month = $1 AND bu = $2', [month(), req.params.bu]);
    res.json({ quota_eur: radar.bu[req.params.bu].quota_eur, budget_eur: radar.budget_eur });
  });
  // ogni ora controlla se è l'ora del giro notturno (una volta al giorno); spento nei test e senza chiave
  if (process.env.OPENAI_API_KEY && !process.env.NODE_TEST_CONTEXT) {
    let lastDay = '';
    const t = setInterval(async () => {
      try {
        const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }));
        const settings = await loadSettings(db);
        if (hour !== settings.radar.run_hour || lastDay === todayRome()) return;
        lastDay = todayRome();
        await runRadar();
      } catch (err) { console.warn('[radar]', err.message); }
    }, 15 * 60000);
    t.unref?.();
  }

  return { addSignal, runRadar };
}

module.exports = { registerCrmRadar };
