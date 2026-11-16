// Win ratio (Dante 16/11/2026, canvas «v3 · Win ratio e facilità»):
// - «Vinte e perse»: esiti delle offerte, numeri per BU / contatto caldo / provenienza / tipo di ente, chi ci batte;
// - «Esiti da registrare»: piani diventati opportunità e gare passate senza esito (con BOSS si svuota da sola);
// - «Chi conosciamo»: forza dei rapporti, occasioni dove conosciamo qualcuno, rapporti che si raffreddano, ex colleghi.
// Gli esiti di BOSS arriveranno con source 'boss' e boss_ref: gli stessi numeri, senza doppioni.
const { HttpError, v } = require('../lib/http');
const { loadSettings, managerOf } = require('../lib/crm-commerciale');
const { relationsFor, pathsOf } = require('../lib/crm-relazioni');
const { stats, probability, ORIGINS, ENTITY } = require('../lib/crm-esiti');

const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const RESULTS = ['vinta', 'persa', 'non_partecipato'];
const num = (x, what, { min = 0, max = 1e12 } = {}) => {
  if (x === undefined || x === null || x === '') return null;
  const n = Number(String(x).replace(/\s|€|%/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `«${what}» non è un numero valido`);
  return n;
};

function registerCrmEsiti(app, { db, subjectById }) {
  async function ctx(req) {
    const [settings, { rows: users }, { rows: asa }] = await Promise.all([loadSettings(db), db.query('SELECT id, name, email FROM users'), db.query('SELECT key, label FROM crm_asa')]);
    const myBus = Object.entries(settings.profiles).filter(([, p]) => managerOf(p, users)?.id === req.user.id).map(([k]) => k);
    return { settings, users, myBus, buLabel: k => asa.find(a => a.key === k)?.label || k || 'Senza BU' };
  }
  // esiti usati per imparare (ultimi N mesi)
  async function learningSet(months) {
    const { rows } = await db.query(
      `SELECT bu, result, origin, entity_kind, amount, warm FROM crm_outcomes WHERE decided_on >= (CURRENT_DATE - ($1::int * INTERVAL '1 month'))`, [months]);
    return rows;
  }
  const OUT_SELECT = `SELECT o.*, s.name AS subject_name, w.name AS winner_display, a.label AS bu_label, u.name AS created_by_name
                        FROM crm_outcomes o LEFT JOIN crm_subjects s ON s.id = o.subject_id LEFT JOIN crm_subjects w ON w.id = o.winner_subject_id
                        LEFT JOIN crm_asa a ON a.key = o.bu LEFT JOIN users u ON u.id = o.created_by`;
  const warmOf = async subjectId => {
    if (!subjectId) return false;
    const settings = await loadSettings(db);
    const rel = (await relationsFor(db, [subjectId], settings.relazioni))[subjectId];
    return rel?.level === 'forte' || rel?.level === 'media';
  };

  // ── da registrare: piani diventati opportunità e gare/segnali «Interessa» passati senza esito ─────
  async function todo({ userId = null, alertDays }) {
    const params = [alertDays];
    const mine = userId ? (params.push(userId), `AND COALESCE(p.owner_id, g.decided_by) = $${params.length}`) : '';
    const { rows } = await db.query(
      `SELECT g.id AS signal_id, p.id AS plan_id, COALESCE(p.title, g.title) AS title, g.bu, a.label AS bu_label, COALESCE(p.subject_id, g.subject_id) AS subject_id,
              s.name AS subject_name, g.deadline, p.closed_at, p.outcome AS plan_outcome, g.to_gare, g.status, u.name AS owner_name,
              (COALESCE(g.deadline, p.closed_at::date) < CURRENT_DATE - $1::int) AS late
         FROM crm_signals g
         FULL JOIN crm_plans p ON p.signal_id = g.id
         LEFT JOIN crm_subjects s ON s.id = COALESCE(p.subject_id, g.subject_id)
         LEFT JOIN crm_asa a ON a.key = g.bu
         LEFT JOIN users u ON u.id = COALESCE(p.owner_id, g.decided_by)
        WHERE ((p.status = 'chiuso' AND p.outcome = 'opportunita')
               OR (g.status IN ('interessa', 'boss') AND g.deadline IS NOT NULL AND g.deadline < CURRENT_DATE))
          AND NOT EXISTS (SELECT 1 FROM crm_outcomes o WHERE o.signal_id = g.id OR o.plan_id = p.id)
          ${mine}
        ORDER BY late DESC, COALESCE(g.deadline, p.closed_at::date) LIMIT 100`, params);
    return rows;
  }

  app.get('/api/crm/esiti', async (req, res) => {
    const c = await ctx(req);
    const period = String(req.query.period || '12');
    const where = [];
    const params = [];
    if (period === '12') where.push("o.decided_on >= CURRENT_DATE - INTERVAL '12 months'");
    else if (/^\d{4}$/.test(period)) { params.push(Number(period)); where.push(`EXTRACT(YEAR FROM o.decided_on) = $${params.length}`); }
    if (req.query.bu) { params.push(String(req.query.bu).split(',')); where.push(`o.bu = ANY($${params.length}::text[])`); }
    const { rows } = await db.query(`${OUT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.decided_on DESC, o.id DESC LIMIT 1000`, params);
    const { rows: years } = await db.query('SELECT DISTINCT EXTRACT(YEAR FROM decided_on)::int AS y FROM crm_outcomes ORDER BY y DESC');
    const { rows: busWith } = await db.query('SELECT DISTINCT bu FROM crm_outcomes WHERE bu IS NOT NULL');
    res.json({
      outcomes: rows.slice(0, 200), total: rows.length, stats: stats(rows, { buLabel: c.buLabel }),
      todo: (await todo({ alertDays: c.settings.esiti.alert_days })).length,
      years: years.map(r => r.y), bus: busWith.map(r => r.bu), myBus: c.myBus,
      reasons: c.settings.esiti.reasons, origins: ORIGINS, entities: ENTITY, boss: c.settings.esiti.boss_on,
    });
  });
  app.get('/api/crm/esiti/da-registrare', async (req, res) => {
    const c = await ctx(req);
    res.json({ items: await todo({ userId: req.query.mine ? req.user.id : null, alertDays: c.settings.esiti.alert_days }), alertDays: c.settings.esiti.alert_days });
  });
  // campi già compilati per «Registra esito» da un segnale, un piano o un'azienda
  app.get('/api/crm/esiti/nuovo', async (req, res) => {
    const c = await ctx(req);
    const out = { result: '', title: '', bu: null, subject_id: null, subject_name: '', signal_id: null, plan_id: null, cig: '', amount: null, origin: 'altro', decided_on: todayRome() };
    let g = null;
    if (req.query.plan_id) {
      const { rows: [p] } = await db.query('SELECT p.*, s.name AS subject_name, s.asa FROM crm_plans p JOIN crm_subjects s ON s.id = p.subject_id WHERE p.id = $1', [v.int(req.query.plan_id, 'Piano', { min: 1 })]);
      if (!p) throw new HttpError(404, 'Piano non trovato');
      Object.assign(out, { plan_id: p.id, title: p.title, subject_id: p.subject_id, subject_name: p.subject_name, bu: p.asa?.[0] || null, origin: 'relazione' });
      if (p.signal_id) g = (await db.query('SELECT * FROM crm_signals WHERE id = $1', [p.signal_id])).rows[0];
    }
    if (req.query.signal_id) g = (await db.query('SELECT * FROM crm_signals WHERE id = $1', [v.int(req.query.signal_id, 'Segnale', { min: 1 })])).rows[0];
    if (g) {
      const { rows: [p] } = out.plan_id ? { rows: [] } : await db.query('SELECT id FROM crm_plans WHERE signal_id = $1 ORDER BY id DESC LIMIT 1', [g.id]);
      Object.assign(out, { signal_id: g.id, plan_id: out.plan_id || p?.id || null, title: out.title || g.title, bu: g.bu || out.bu, subject_id: out.subject_id || g.subject_id,
        cig: g.cig || '', amount: g.amount === null ? null : Number(g.amount), origin: g.to_gare ? 'gare' : g.source === 'manuale' ? 'relazione' : 'radar' });
    }
    if (req.query.subject_id && !out.subject_id) out.subject_id = v.int(req.query.subject_id, 'Azienda', { min: 1 });
    if (out.subject_id) {
      const s = await subjectById(req, out.subject_id);
      out.subject_name = s.name;
      out.bu = out.bu || s.asa?.[0] || null;
      if (out.origin === 'altro' && s.roles.includes('cliente')) out.origin = 'cliente';
      out.entity_kind = s.kind;
    }
    out.warm = await warmOf(out.subject_id);
    res.json({ ...out, reasons: c.settings.esiti.reasons, origins: ORIGINS });
  });

  // concorrente: scheda del CRM con quel nome, o nuova scheda «Concorrente»
  async function winnerId(name, userId) {
    const n = String(name || '').trim();
    if (!n) return null;
    const { rows: [s] } = await db.query('SELECT id FROM crm_subjects WHERE merged_into IS NULL AND (lower(name) = lower($1) OR lower(short_name) = lower($1)) LIMIT 1', [n]);
    if (s) return s.id;
    const { rows: [nw] } = await db.query(`INSERT INTO crm_subjects (name, roles, asa, owner_id, origin, created_by) VALUES ($1, '{concorrente}', '{}', $2, 'Esito di gara', $2) RETURNING id`, [n.slice(0, 200), userId]);
    return nw.id;
  }
  async function readBody(req, c, before = {}) {
    const b = req.body;
    const result = v.oneOf(b.result ?? before.result, 'Esito', RESULTS);
    const bu = b.bu === undefined ? before.bu : b.bu ? v.oneOf(b.bu, 'BU', Object.keys(c.settings.profiles)) : null;
    const subjectId = b.subject_id === undefined ? before.subject_id : b.subject_id ? v.int(b.subject_id, 'Azienda', { min: 1 }) : null;
    const subject = subjectId ? await subjectById(req, subjectId) : null;
    const winnerName = v.text(b.winner_name ?? before.winner_name, 'Chi ha vinto', { max: 200 }) || '';
    let winnerSubject = b.winner_subject_id === undefined ? before.winner_subject_id || null : b.winner_subject_id ? v.int(b.winner_subject_id, 'Chi ha vinto', { min: 1 }) : null;
    if (result === 'persa' && !winnerSubject && winnerName) winnerSubject = await winnerId(winnerName, req.user.id);
    return {
      result, bu, subject_id: subjectId,
      title: v.text(b.title ?? before.title, 'Gara o lavoro', { max: 500, required: true }),
      signal_id: b.signal_id === undefined ? before.signal_id || null : b.signal_id ? v.int(b.signal_id, 'Segnale', { min: 1 }) : null,
      plan_id: b.plan_id === undefined ? before.plan_id || null : b.plan_id ? v.int(b.plan_id, 'Piano', { min: 1 }) : null,
      cig: v.text(b.cig ?? before.cig, 'CIG', { max: 40 }) || '',
      origin: b.origin ? v.oneOf(b.origin, 'Provenienza', Object.keys(ORIGINS)) : before.origin || 'altro',
      reason: result === 'persa' ? v.text(b.reason ?? before.reason, 'Motivo', { max: 120 }) || '' : result === 'non_partecipato' ? v.text(b.reason ?? before.reason, 'Motivo', { max: 120 }) || '' : '',
      amount: num(b.amount ?? before.amount, 'Importo'),
      our_discount: num(b.our_discount ?? before.our_discount, 'Il nostro ribasso', { max: 100 }),
      winner_discount: result === 'persa' ? num(b.winner_discount ?? before.winner_discount, 'Il loro ribasso', { max: 100 }) : null,
      winner_subject_id: result === 'persa' ? winnerSubject : null, winner_name: result === 'persa' ? winnerName : '',
      bidders: num(b.bidders ?? before.bidders, 'Offerenti', { max: 10000 }),
      decided_on: v.date(b.decided_on ?? before.decided_on, 'Data dell\'esito') || todayRome(),
      lesson: v.text(b.lesson ?? before.lesson, 'Cosa impariamo', { max: 2000 }) || '',
      entity_kind: subject?.kind || before.entity_kind || '',
      warm: await warmOf(subjectId),
    };
  }
  const FIELDS = ['result', 'bu', 'subject_id', 'title', 'signal_id', 'plan_id', 'cig', 'origin', 'reason', 'amount', 'our_discount', 'winner_discount', 'winner_subject_id', 'winner_name', 'bidders', 'decided_on', 'lesson', 'entity_kind', 'warm'];
  app.post('/api/crm/esiti', async (req, res) => {
    const c = await ctx(req);
    const x = await readBody(req, c);
    try {
      const { rows: [o] } = await db.query(
        `INSERT INTO crm_outcomes (${FIELDS.join(', ')}, created_by) VALUES (${FIELDS.map((_, i) => `$${i + 1}`).join(', ')}, $${FIELDS.length + 1}) RETURNING id`,
        [...FIELDS.map(f => x[f]), req.user.id]);
      res.status(201).json((await db.query(`${OUT_SELECT} WHERE o.id = $1`, [o.id])).rows[0]);
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'Per questa gara l\'esito è già registrato');
      throw err;
    }
  });
  app.put('/api/crm/esiti/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows: [before] } = await db.query('SELECT * FROM crm_outcomes WHERE id = $1', [id]);
    if (!before) throw new HttpError(404, 'Esito non trovato');
    if (before.source === 'boss') throw new HttpError(409, 'Questo esito arriva da BOSS: si cambia lì');
    const x = await readBody(req, await ctx(req), before);
    await db.query(`UPDATE crm_outcomes SET ${FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [id, ...FIELDS.map(f => x[f])]);
    res.json((await db.query(`${OUT_SELECT} WHERE o.id = $1`, [id])).rows[0]);
  });
  app.delete('/api/crm/esiti/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows: [o] } = await db.query('SELECT source, created_by FROM crm_outcomes WHERE id = $1', [id]);
    if (!o) throw new HttpError(404, 'Esito non trovato');
    if (o.source === 'boss') throw new HttpError(409, 'Questo esito arriva da BOSS');
    if (!req.crm.admin && o.created_by !== req.user.id) throw new HttpError(403, 'Cancella solo chi l\'ha scritto o la direzione');
    await db.query('DELETE FROM crm_outcomes WHERE id = $1', [id]);
    res.json({ ok: true });
  });
  // probabilità di vittoria per un segnale o un'azienda (spiegata voce per voce)
  async function probabilityFor({ bu, subjectId, origin, amount, settings }) {
    if (!settings.esiti.prob_on || !bu) return null;
    const subject = subjectId ? (await db.query('SELECT kind FROM crm_subjects WHERE id = $1', [subjectId])).rows[0] : null;
    return probability(await learningSet(settings.esiti.months),
      { bu, origin, amount, entity_kind: subject?.kind || '', warm: subjectId ? await warmOf(subjectId) : false }, settings.esiti);
  }

  // ── chi conosciamo ─────────────────────────────────────────────────────────────────────────
  app.get('/api/crm/subjects/:id/relazioni', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await subjectById(req, id);
    const settings = await loadSettings(db);
    const rel = (await relationsFor(db, [id], settings.relazioni))[id];
    res.json({ ...rel, paths: pathsOf(rel) });
  });
  app.get('/api/crm/relazioni', async (req, res) => {
    const c = await ctx(req);
    const bus = req.query.bu ? String(req.query.bu).split(',') : req.query.mine && c.myBus.length ? c.myBus : null;
    // aziende con qualcosa da contare: contatti, incontri, email, commesse o key account
    const { rows: ids } = await db.query(
      `SELECT s.id FROM crm_subjects s WHERE s.merged_into IS NULL ${bus ? 'AND s.asa && $1::text[]' : ''}
          AND (s.key_account OR EXISTS (SELECT 1 FROM crm_project_links p WHERE p.subject_id = s.id)
               OR EXISTS (SELECT 1 FROM crm_meeting_links m WHERE m.subject_id = s.id AND NOT m.removed)
               OR EXISTS (SELECT 1 FROM crm_email_links e WHERE e.subject_id = s.id)
               OR EXISTS (SELECT 1 FROM crm_contact_links l JOIN crm_meeting_links m ON m.contact_id = l.contact_id AND NOT m.removed WHERE l.subject_id = s.id)
               OR EXISTS (SELECT 1 FROM crm_contact_links l JOIN crm_email_links e ON e.contact_id = l.contact_id WHERE l.subject_id = s.id))`, bus ? [bus] : []);
    const rels = await relationsFor(db, ids.map(r => r.id), c.settings.relazioni);
    const list = Object.values(rels).filter(r => r.level).sort((a, b) => b.points - a.points);
    // occasioni aperte dove conosciamo qualcuno
    const { rows: signals } = await db.query(
      `SELECT g.id, g.title, g.score, g.bu, a.label AS bu_label, g.subject_id, g.status, g.amount FROM crm_signals g LEFT JOIN crm_asa a ON a.key = g.bu
        WHERE NOT g.to_gare AND g.status IN ('nuovo', 'interessa') AND g.subject_id IS NOT NULL ${bus ? 'AND g.bu = ANY($1::text[])' : ''}
        ORDER BY g.score DESC LIMIT 300`, bus ? [bus] : []);
    const sigRels = await relationsFor(db, signals.map(g => g.subject_id), c.settings.relazioni);
    const warm = signals.map(g => ({ ...g, path: pathsOf(sigRels[g.subject_id])[0] || null, level: sigRels[g.subject_id]?.level || '' }))
      .filter(g => g.path && g.level).slice(0, 30);
    const ex = list.flatMap(r => r.people.filter(p => p.past && p.points > 0).map(p => ({ ...p, subject_id: r.subject_id, subject_name: r.name }))).slice(0, 20);
    res.json({
      warm, list: list.slice(0, 300).map(r => ({ ...r, people: r.people.filter(p => !p.past).slice(0, 4) })), total: list.length,
      cooling: list.filter(r => r.cooling).sort((a, b) => (b.key - a.key) || String(a.last_at || '').localeCompare(String(b.last_at || ''))).slice(0, 20),
      ex, myBus: c.myBus, coolDays: c.settings.relazioni.cool_days,
    });
  });

  return { probabilityFor, warmOf };
}

module.exports = { registerCrmEsiti };
