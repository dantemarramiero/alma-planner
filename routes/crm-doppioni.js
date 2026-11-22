// Doppioni e «Unisci» (canvas v15, via di Dante 22/11/2026)
//   GET  /api/crm/doppioni?kind=subject|contact&stato=open|dismissed&mie=1   coppie proposte, le più sicure in cima
//   GET  /api/crm/doppioni/conteggio?kind=&role=                            per l'avviso in cima agli elenchi
//   GET  /api/crm/doppioni/di?kind=&id=                                      coppie aperte di una scheda («Forse è la stessa di …»)
//   POST /api/crm/doppioni/:id/scarta · /riapri · /chiedi                    «Non sono la stessa», riapri, chiedi all'owner
//   POST /api/crm/doppioni/cerca                                             cerca adesso (direzione)
//   GET  /api/crm/unisci/anteprima?kind=&a=&b=&keep=                         finestra Unisci: dato per dato e cosa si sposta
//   POST /api/crm/unisci { kind, keep, other, values }                       unisce (owner di tutte e due o direzione)
// Ricerca: ogni notte alle 03:15, pochi minuti dopo l'avvio e poco dopo che si crea o modifica un'azienda o un contatto.
const { HttpError, v } = require('../lib/http');
const D = require('../lib/crm-doppioni');
const U = require('../lib/crm-unisci');

const KINDS = ['subject', 'contact'];

function registerCrmDoppioni(app, { db, notifier, afterMerge = () => {} }) {
  let running = null, again = false;
  const run = () => {
    if (running) { again = true; return running; }
    running = D.findDuplicates(db).catch(e => { console.log(`[doppioni] ricerca non riuscita: ${e.message}`); return null; })
      .finally(() => { running = null; if (again) { again = false; setTimeout(run, 1000); } });
    return running;
  };
  // dopo una modifica si aspetta un attimo, così dieci salvataggi di fila fanno una ricerca sola
  let soon = null;
  const later = () => { clearTimeout(soon); soon = setTimeout(run, process.env.NODE_TEST_CONTEXT ? 10 : 20000); soon.unref?.(); };
  app.use(['/api/crm/subjects', '/api/crm/contacts'], (req, res, next) => {
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) res.on('finish', () => { if (res.statusCode < 300) later(); });
    next();
  });

  const summary = async (kind, ids) => {
    if (!ids.length) return new Map();
    const sql = kind === 'subject'
      ? `SELECT s.id, s.name, s.roles, s.city, s.vat, s.boss_code, s.owner_id, u.name AS owner_name, s.created_quick, s.zoho_id <> '' AS zoho, s.soa_anac->>'found' = 'true' AS soa,
           (SELECT count(*)::int FROM crm_contact_links l WHERE l.subject_id = s.id AND l.date_to IS NULL) AS contacts,
           (SELECT count(*)::int FROM crm_email_links l WHERE l.subject_id = s.id) AS emails,
           (SELECT count(*)::int FROM crm_meeting_links l WHERE l.subject_id = s.id AND NOT l.removed) AS meetings
         FROM crm_subjects s LEFT JOIN users u ON u.id = s.owner_id WHERE s.id = ANY($1::int[])`
      : `SELECT c.id, c.title, c.first_name, c.last_name, c.email, c.mobile, c.owner_id, u.name AS owner_name,
           (SELECT string_agg(s.name, ', ') FROM crm_contact_links l JOIN crm_subjects s ON s.id = l.subject_id WHERE l.contact_id = c.id AND l.date_to IS NULL) AS companies,
           (SELECT count(*)::int FROM crm_email_links l WHERE l.contact_id = c.id) AS emails,
           (SELECT count(*)::int FROM crm_meeting_links l WHERE l.contact_id = c.id AND NOT l.removed) AS meetings
         FROM crm_contacts c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = ANY($1::int[])`;
    const { rows } = await db.query(sql, [ids]);
    return new Map(rows.map(r => [r.id, r]));
  };
  const canMerge = (req, a, b) => req.crm.admin || (a.owner_id === req.user.id && b.owner_id === req.user.id);

  app.get('/api/crm/doppioni', async (req, res) => {
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'subject';
    const status = ['open', 'dismissed'].includes(req.query.stato) ? req.query.stato : 'open';
    const { rows } = await db.query('SELECT * FROM crm_duplicates WHERE kind = $1 AND status = $2 ORDER BY score DESC, id LIMIT 500', [kind, status]);
    const sum = await summary(kind, [...new Set(rows.flatMap(r => [r.a_id, r.b_id]))]);
    let pairs = rows.map(r => ({ id: r.id, score: r.score, reasons: r.reasons, status: r.status, a: sum.get(r.a_id), b: sum.get(r.b_id) })).filter(p => p.a && p.b);
    const mine = p => p.a.owner_id === req.user.id || p.b.owner_id === req.user.id;
    if (req.query.mie === '1' || !req.crm.admin) pairs = pairs.filter(mine);
    if (req.query.role) pairs = pairs.filter(p => kind === 'subject' && (p.a.roles.includes(req.query.role) || p.b.roles.includes(req.query.role)));
    const { rows: [n] } = await db.query("SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'dismissed')::int AS dismissed FROM crm_duplicates WHERE kind = $1", [kind]);
    res.json({ pairs: pairs.map(p => ({ ...p, can_merge: canMerge(req, p.a, p.b) })), counts: n, admin: req.crm.admin, running: Boolean(running) });
  });

  app.get('/api/crm/doppioni/conteggio', async (req, res) => {
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'subject';
    const params = [kind, req.user.id, Boolean(req.crm.admin)];
    let roleSql = '';
    if (kind === 'subject' && req.query.role) { params.push(String(req.query.role)); roleSql = `AND ($${params.length} = ANY(a.roles) OR $${params.length} = ANY(b.roles))`; }
    const t = kind === 'subject' ? 'crm_subjects' : 'crm_contacts';
    const { rows: [r] } = await db.query(`SELECT count(*)::int AS n FROM crm_duplicates d JOIN ${t} a ON a.id = d.a_id JOIN ${t} b ON b.id = d.b_id
      WHERE d.kind = $1 AND d.status = 'open' AND ($3 OR a.owner_id = $2 OR b.owner_id = $2) ${roleSql}`, params);
    res.json({ n: r.n });
  });

  app.get('/api/crm/doppioni/di', async (req, res) => {
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'subject';
    const id = v.int(req.query.id, 'Scheda', { min: 1 });
    const { rows } = await db.query("SELECT * FROM crm_duplicates WHERE kind = $1 AND status = 'open' AND (a_id = $2 OR b_id = $2) ORDER BY score DESC LIMIT 3", [kind, id]);
    const sum = await summary(kind, rows.map(r => (r.a_id === id ? r.b_id : r.a_id)));
    const me = (await summary(kind, [id])).get(id);
    res.json({ pairs: rows.map(r => { const o = sum.get(r.a_id === id ? r.b_id : r.a_id); return o && { id: r.id, score: r.score, reasons: r.reasons, other: o, can_merge: me && canMerge(req, me, o) }; }).filter(Boolean) });
  });

  const decide = async (req, status) => {
    const id = v.int(req.params.id, 'Coppia', { min: 1 });
    const { rows: [d] } = await db.query('UPDATE crm_duplicates SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1 RETURNING *', [id, status, req.user.id]);
    if (!d) throw new HttpError(404, 'Coppia non trovata');
    return d;
  };
  app.post('/api/crm/doppioni/:id/scarta', async (req, res) => res.json(await decide(req, 'dismissed')));
  app.post('/api/crm/doppioni/:id/riapri', async (req, res) => res.json(await decide(req, 'open')));
  // chi non può unire chiede agli owner con un avviso
  app.post('/api/crm/doppioni/:id/chiedi', async (req, res) => {
    const id = v.int(req.params.id, 'Coppia', { min: 1 });
    const { rows: [d] } = await db.query('SELECT * FROM crm_duplicates WHERE id = $1', [id]);
    if (!d) throw new HttpError(404, 'Coppia non trovata');
    const sum = await summary(d.kind, [d.a_id, d.b_id]);
    const a = sum.get(d.a_id), b = sum.get(d.b_id);
    const label = x => (d.kind === 'subject' ? x.name : [x.first_name, x.last_name].filter(Boolean).join(' ') || x.email);
    const to = [...new Set([a?.owner_id, b?.owner_id].filter(u => u && u !== req.user.id))];
    if (to.length) await notifier.notify({ userIds: to, actorId: req.user.id, kind: 'crm', body: `pensa che «${label(a)}» e «${label(b)}» siano la stessa ${d.kind === 'subject' ? 'azienda' : 'persona'}: puoi unirle?`, link: `/crm/doppioni${d.kind === 'contact' ? '/contatti' : ''}` });
    res.json({ asked: to.length });
  });
  app.post('/api/crm/doppioni/cerca', async (req, res) => {
    if (!req.crm.admin) throw new HttpError(403, 'Solo la direzione');
    res.json(await run());
  });

  async function load(kind, id) {
    const t = kind === 'subject' ? 'crm_subjects' : 'crm_contacts';
    const { rows: [x] } = await db.query(`SELECT x.*, u.name AS owner_name FROM ${t} x LEFT JOIN users u ON u.id = x.owner_id WHERE x.id = $1`, [id]);
    if (!x) throw new HttpError(404, kind === 'subject' ? 'Anagrafica non trovata' : 'Contatto non trovato');
    if (x.merged_into) throw new HttpError(409, `«${x.name}» è già stata unita a un'altra scheda`);
    return x;
  }
  app.get('/api/crm/unisci/anteprima', async (req, res) => {
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'subject';
    const a = await load(kind, v.int(req.query.a, 'Prima scheda', { min: 1 }));
    const b = await load(kind, v.int(req.query.b, 'Seconda scheda', { min: 1 }));
    if (a.id === b.id) throw new HttpError(400, 'Sono la stessa scheda');
    const counts = { [a.id]: await U.refCounts(db, kind, a.id), [b.id]: await U.refCounts(db, kind, b.id) };
    const keepId = Number(req.query.keep);
    const keep = keepId === a.id ? a : keepId === b.id ? b : (kind === 'subject' ? U.keepFirst(a, b, counts) : (counts[a.id].total >= counts[b.id].total ? a : b));
    const other = keep === a ? b : a;
    const fields = kind === 'subject' ? U.SUBJECT_FIELDS : U.CONTACT_FIELDS;
    const rows = U.compare(keep, other, fields, kind === 'subject' ? U.SUBJECT_LABELS : U.CONTACT_LABELS);
    // valori da leggere: il nome dell'owner, non il numero; tipo, stato e priorità in parole
    const { KINDS: K, STATUS: ST, PRIORITIES: PR } = require('../lib/crm');
    const users = new Map((await db.query('SELECT id, name FROM users WHERE id = ANY($1::int[])', [[keep.owner_id, other.owner_id].filter(Boolean)])).rows.map(u => [u.id, u.name]));
    const words = { owner_id: x => users.get(x), kind: x => K[x], status: x => ST[x], priority: x => PR[x] };
    for (const r of rows) if (words[r.key]) { r.keep_label = words[r.key](r.keep) || null; r.other_label = words[r.key](r.other) || null; }
    const card = x => (kind === 'subject' ? { id: x.id, name: x.name, roles: x.roles, city: x.city, owner_id: x.owner_id, owner_name: x.owner_name }
      : { id: x.id, name: [x.title, x.first_name, x.last_name].filter(Boolean).join(' ') || x.email, owner_id: x.owner_id, owner_name: x.owner_name });
    res.json({ kind, keep: card(keep), other: card(other), rows, moves: counts[other.id], can_merge: canMerge(req, keep, other),
      sums: kind === 'subject' ? { roles: [...new Set([...keep.roles, ...other.roles])], soa: (other.soa || []).length, notes: Boolean(other.notes) } : null });
  });

  app.post('/api/crm/unisci', async (req, res) => {
    const kind = KINDS.includes(req.body?.kind) ? req.body.kind : 'subject';
    const keep = await load(kind, v.int(req.body?.keep, 'Scheda che resta', { min: 1 }));
    const other = await load(kind, v.int(req.body?.other, 'Scheda da unire', { min: 1 }));
    if (keep.id === other.id) throw new HttpError(400, 'Sono la stessa scheda');
    if (!canMerge(req, keep, other)) throw new HttpError(403, 'Unisce chi è owner di tutte e due o la direzione: chiedi all\'owner');
    const fields = kind === 'subject' ? U.SUBJECT_FIELDS : U.CONTACT_FIELDS;
    const values = {};
    for (const [k, val] of Object.entries(req.body?.values || {})) {
      if (!fields.includes(k)) continue;
      values[k] = val === 'keep' || val === 'other' ? val : val && typeof val === 'object' ? { value: typeof val.value === 'string' ? val.value.slice(0, 500) : val.value } : undefined;
    }
    try {
      if (kind === 'subject') { await U.mergeSubjects(db, { keep, other, values, userId: req.user.id }); await afterMerge(keep.id); }
      else await U.mergeContacts(db, { keep, other, values, userId: req.user.id });
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'C\'è già un\'altra anagrafica con questa P.IVA o questo codice fiscale');
      throw err;
    }
    const name = x => (kind === 'subject' ? x.name : [x.first_name, x.last_name].filter(Boolean).join(' ') || x.email);
    const tell = [...new Set([keep.owner_id, other.owner_id].filter(u => u && u !== req.user.id))];
    if (tell.length) await notifier.notify({ userIds: tell, actorId: req.user.id, kind: 'crm', body: `ha unito «${name(other)}» a «${name(keep)}»`, link: kind === 'subject' ? `/crm/scheda/${keep.id}` : `/crm/contatti/${keep.id}` }).catch(() => {});
    res.json({ ok: true, kind, into: keep.id });
  });

  if (!process.env.NODE_TEST_CONTEXT) {
    const first = setTimeout(run, 5 * 60000); first.unref?.();
    let lastDay = '';
    const tick = setInterval(() => {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
      const key = now.toISOString().slice(0, 10);
      if (now.getHours() === 3 && now.getMinutes() >= 15 && lastDay !== key) { lastDay = key; run(); }
    }, 5 * 60000);
    tick.unref?.();
  }
  return { run };
}

module.exports = { registerCrmDoppioni };
