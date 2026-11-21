// Organigramma a incarichi (canvas «Alma Planet · Organigramma a incarichi», 20/11/2026; modello di BOSS). Solo
// amministratori. La logica è in lib/organigramma.js (pura): qui si caricano le righe, si applicano le azioni e si
// salvano solo le righe cambiate, con la storia dei cambi.
//   GET  /api/organigramma                     modello: aree, livelli, incarichi, persone, chi approva, da sistemare
//   POST /api/organigramma/anteprima           { azione, … } → errori, chi cambia approvatore
//   POST /api/organigramma/azione              { azione, … } → applica (stessi controlli dell'anteprima)
//   POST/PATCH /api/organigramma/livelli[/:id] · POST /api/organigramma/livelli/ordine { ids }
//   POST/PATCH /api/organigramma/aree[/:id]
//   POST /api/organigramma/import?applica=1    xlsx (fogli «Incarichi» e «Persone») → anteprima o applica
//   GET  /api/organigramma/modello.xlsx        il foglio vuoto · POST /api/organigramma/proposta-entra (?applica=1)
//   GET  /api/organigramma/storia
const express = require('express');
const { HttpError, v } = require('../lib/http');
const { readXlsx, writeXlsx } = require('../lib/xlsx');
const O = require('../lib/organigramma');

const norm = O.norm;

async function loadState(db) {
  const [aree, livelli, incarichi, entra, persone, accounts] = await Promise.all([
    db.query('SELECT id, nome, tipo, ordine, attiva, centro_costo FROM org_aree ORDER BY ordine, nome'),
    db.query('SELECT id, nome, ordine, approva, attivo FROM org_livelli ORDER BY ordine, id'),
    db.query('SELECT id, nome, area_id, livello_id, riporta_a_id, ricoperto_da, responsabile_area, attivo, updated_at FROM org_incarichi ORDER BY id'),
    db.query('SELECT oid, name, lower(email) AS email, job_title, department, manager_oid FROM org_people WHERE email IS NOT NULL'),
    db.query('SELECT email, nome, esterno, riporta_a_incarico_id, incarico_principale_id, area_id FROM org_persone'),
    db.query('SELECT lower(email) AS email FROM users WHERE last_login IS NOT NULL AND suspended_at IS NULL'),
  ]);
  return { aree: aree.rows, livelli: livelli.rows, incarichi: incarichi.rows, entra: entra.rows, persone: persone.rows, accounts: new Set(accounts.rows.map(r => r.email)) };
}

// Salva le differenze fra lo stato letto e quello nuovo. Gli incarichi nuovi hanno un id provvisorio: si inseriscono
// prima senza riferimenti, poi si sistemano «riporta a» e i riferimenti delle persone.
async function persist(q, before, after, userId) {
  const map = new Map(); // id provvisorio → id vero
  const real = id => (id == null ? null : map.get(id) ?? id);
  for (const i of after.incarichi.filter(x => x._nuovo)) {
    const { rows: [r] } = await q.query(
      `INSERT INTO org_incarichi (nome, area_id, livello_id, ricoperto_da, responsabile_area, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [i.nome, i.area_id, i.livello_id, i.ricoperto_da, !!i.responsabile_area, userId]);
    map.set(i.id, r.id);
  }
  const prev = new Map(before.incarichi.map(i => [i.id, i]));
  const FIELDS = ['nome', 'area_id', 'livello_id', 'riporta_a_id', 'ricoperto_da', 'responsabile_area', 'attivo'];
  for (const i of after.incarichi) {
    const p = prev.get(i.id);
    const target = i._nuovo ? { ...i, riporta_a_id: null } : p;
    const changed = FIELDS.filter(f => (f === 'riporta_a_id' ? real(i[f]) : i[f]) !== (target?.[f] ?? null) && !(i[f] == null && target?.[f] == null));
    if (!changed.length) continue;
    const vals = changed.map(f => (f === 'riporta_a_id' ? real(i[f]) : i[f]));
    await q.query(`UPDATE org_incarichi SET ${changed.map((f, n) => `${f} = $${n + 2}`).join(', ')}, updated_by = $${changed.length + 2}, updated_at = now() WHERE id = $1`,
      [real(i.id), ...vals, userId]);
  }
  const prevP = new Map(before.persone.map(p => [norm(p.email), p]));
  for (const p of after.persone) {
    const o = prevP.get(norm(p.email));
    const row = { nome: p.nome ?? null, esterno: !!p.esterno, riporta_a_incarico_id: real(p.riporta_a_incarico_id), incarico_principale_id: real(p.incarico_principale_id), area_id: p.area_id ?? null };
    if (o && Object.keys(row).every(k => (o[k] ?? null) === row[k] || (k === 'esterno' && !!o[k] === row[k]))) continue;
    await q.query(
      `INSERT INTO org_persone (email, nome, esterno, riporta_a_incarico_id, incarico_principale_id, area_id, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, esterno = EXCLUDED.esterno, riporta_a_incarico_id = EXCLUDED.riporta_a_incarico_id,
         incarico_principale_id = EXCLUDED.incarico_principale_id, area_id = EXCLUDED.area_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [norm(p.email), row.nome, row.esterno, row.riporta_a_incarico_id, row.incarico_principale_id, row.area_id, userId]);
  }
  return map;
}

// Il modello per la pagina: come lo legge chi usa l'API di BOSS (nomi dei campi uguali) più quello che serve allo schermo.
function vista(state) {
  const m = O.build(state);
  const ds = O.daSistemare(m);
  const incarichi = [...m.incarichi.values()].map(i => ({
    id: i.id, nome: i.nome, businessUnitId: i.area_id, livelloOrganigrammaId: i.livello_id, riportaAIncaricoId: i.riporta_a_id,
    ricopertoDaPersonaleId: i.ricoperto_da, responsabileArea: !!i.responsabile_area, attivo: true,
    figli: i.figli, riporti: i.riporti, nelRamo: O.nelRamo(m, i.id), approva: m.approva(i.id), vertice: i.id === m.vertice,
    updatedAt: i.updated_at || null,
  }));
  const persone = [...m.persone.values()].filter(p => p.inEntra || p.esterno || p.incarichi.length).map(p => ({
    email: p.email, nome: p.nome, esterno: p.esterno, inEntra: p.inEntra, account: p.account, jobTitle: p.jobTitle || null, department: p.department || null,
    incarichi: p.incarichi, incaricoPrincipaleId: m.principaleDi(p), riportaAIncaricoId: p.riporta_a_incarico_id, businessUnitId: p.area_id,
    chiApprova: O.chiApprova(m, p.email),
  })).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  return {
    aree: state.aree.map(a => ({ id: a.id, nome: a.nome, tipo: a.tipo, ordine: a.ordine, attiva: a.attiva, centroCosto: a.centro_costo })),
    livelli: state.livelli.map(l => ({ id: l.id, nome: l.nome, ordine: l.ordine, approva: l.approva, attivo: l.attivo })),
    incarichi, persone, daSistemare: ds, vertice: m.vertice, avvisi: O.erroriTutti(m),
  };
}

// ── import da foglio ──────────────────────────────────────────────────────────────────────────────────
const HEAD_INC = ['incarico', 'riporta a', 'livello', 'area', 'ricoperto da', 'responsabile dell\'area'];
const HEAD_PER = ['email', 'nome', 'riporta a', 'incarico principale', 'area', 'esterno'];
const yes = s => /^(s[iì]|x|1|true|vero)$/i.test(String(s || '').trim());
function righe(sheet, heads) {
  if (!sheet?.length) return [];
  const idx = sheet[0].map(h => norm(h).replace(/[’`]/g, '\''));
  const col = h => idx.indexOf(h);
  return sheet.slice(1).map((r, n) => ({ riga: n + 2, ...Object.fromEntries(heads.map(h => [h, String(r[col(h)] ?? '').trim()])) })).filter(r => heads.some(h => r[h]));
}
// Applica le righe allo stato (in memoria): incarichi per nome (aggiorna se c'è, crea se no), poi le persone.
function pianoImport(state, inc, per) {
  const s = { ...state, incarichi: state.incarichi.map(x => ({ ...x })), persone: state.persone.map(x => ({ ...x })) };
  const errori = [];
  const out = { incarichi: [], persone: [] };
  const livello = n => state.livelli.find(l => norm(l.nome) === norm(n) && l.attivo !== false);
  const area = n => state.aree.find(a => norm(a.nome) === norm(n));
  const persona = e => state.entra.some(p => norm(p.email) === norm(e)) || state.persone.some(p => norm(p.email) === norm(e)) || per.some(p => norm(p.email) === norm(e) && yes(p.esterno));
  let seq = Math.max(1000000, ...s.incarichi.map(i => i.id)) + 1;
  const byName = new Map(s.incarichi.filter(i => i.attivo !== false).map(i => [norm(i.nome), i]));
  for (const r of inc) {
    const problemi = [];
    if (!r.incarico) problemi.push('manca il nome dell\'incarico');
    if (r.livello && !livello(r.livello)) problemi.push(`livello «${r.livello}» non esiste: ${state.livelli.map(l => l.nome).join(', ')}`);
    if (r.area && !area(r.area)) problemi.push(`area «${r.area}» non esiste`);
    if (r['ricoperto da'] && !persona(r['ricoperto da'])) problemi.push('email non trovata in Entra né tra gli esterni');
    if (norm(r['riporta a']) && norm(r['riporta a']) === norm(r.incarico)) problemi.push('un incarico non riporta a sé stesso');
    out.incarichi.push({ ...r, problemi });
    if (problemi.length) { errori.push(r.riga); continue; }
    let i = byName.get(norm(r.incarico));
    if (!i) { i = { id: seq++, nome: r.incarico, attivo: true, _nuovo: true }; s.incarichi.push(i); byName.set(norm(r.incarico), i); }
    Object.assign(i, { livello_id: r.livello ? livello(r.livello).id : i.livello_id ?? null, area_id: r.area ? area(r.area).id : i.area_id ?? null,
      ricoperto_da: r['ricoperto da'] ? norm(r['ricoperto da']) : null, responsabile_area: yes(r['responsabile dell\'area']), _riporta: r['riporta a'] });
  }
  for (const i of s.incarichi) {
    if (i._riporta === undefined) continue;
    const padre = i._riporta ? byName.get(norm(i._riporta)) : null;
    if (i._riporta && !padre) { const r = out.incarichi.find(x => norm(x.incarico) === norm(i.nome)); r.problemi.push(`«riporta a» «${i._riporta}» non è un incarico del foglio`); errori.push(r.riga); }
    i.riporta_a_id = padre ? padre.id : null;
    delete i._riporta;
  }
  for (const r of per) {
    const problemi = [];
    const email = norm(r.email);
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) problemi.push('email non valida');
    const esterno = yes(r.esterno);
    if (email && !esterno && !state.entra.some(p => norm(p.email) === email) && !state.persone.some(p => norm(p.email) === email)) problemi.push('non è in Entra: se è esterno scrivi «sì» in «esterno»');
    if (esterno && !r.nome) problemi.push('per un esterno serve il nome');
    if (r['riporta a'] && !byName.get(norm(r['riporta a']))) problemi.push(`«riporta a» «${r['riporta a']}» non è un incarico`);
    if (r['incarico principale'] && !byName.get(norm(r['incarico principale']))) problemi.push(`incarico principale «${r['incarico principale']}» non esiste`);
    if (r.area && !area(r.area)) problemi.push(`area «${r.area}» non esiste`);
    out.persone.push({ ...r, problemi });
    if (problemi.length) { errori.push(r.riga); continue; }
    let p = s.persone.find(x => norm(x.email) === email);
    if (!p) { p = { email, nome: null, esterno: false, riporta_a_incarico_id: null, incarico_principale_id: null, area_id: null }; s.persone.push(p); }
    Object.assign(p, { nome: esterno ? r.nome : p.nome, esterno, riporta_a_incarico_id: r['riporta a'] ? byName.get(norm(r['riporta a'])).id : p.riporta_a_incarico_id,
      incarico_principale_id: r['incarico principale'] ? byName.get(norm(r['incarico principale'])).id : p.incarico_principale_id, area_id: r.area ? area(r.area).id : p.area_id });
  }
  const m = O.build(s);
  return { state: s, righeConErrori: [...new Set(errori)], incarichi: out.incarichi, persone: out.persone, avvisi: O.erroriTutti(m), daSistemare: O.daSistemare(m).length };
}

// Proposta dai responsabili di Entra: un incarico per ogni persona che ha collaboratori; gli altri riportano
// all'incarico del loro responsabile. Senza livelli (BOSS non li indovina dalle parole).
function propostaEntra(state) {
  const people = state.entra;
  const byOid = new Map(people.map(p => [p.oid, p]));
  const managers = new Set(people.map(p => p.manager_oid).filter(o => o && byOid.has(o)));
  const nomeInc = p => (p.job_title ? p.job_title : `Responsabile ${p.department || p.name}`);
  const usati = new Map();
  const inc = [...managers].map(o => byOid.get(o)).map(p => {
    let nome = nomeInc(p);
    if (usati.has(norm(nome))) nome = `${nome} · ${p.name}`;
    usati.set(norm(nome), p.oid);
    return { p, nome };
  });
  const incOf = new Map(inc.map(x => [x.p.oid, x.nome]));
  const area = d => state.aree.find(a => d && norm(d).includes(norm(a.nome)))?.nome || '';
  return {
    incarichi: inc.map(({ p, nome }) => ({ incarico: nome, 'riporta a': p.manager_oid ? incOf.get(p.manager_oid) || '' : '', livello: '', area: area(p.department), 'ricoperto da': p.email, 'responsabile dell\'area': '' })),
    persone: people.filter(p => !managers.has(p.oid) && p.manager_oid && incOf.has(p.manager_oid)).map(p => ({ email: p.email, nome: '', 'riporta a': incOf.get(p.manager_oid), 'incarico principale': '', area: area(p.department), esterno: '' })),
  };
}

function registerOrganigramma(app, { db, gov, config = {} }) {
  const BASE = '/api/organigramma';
  // Alma HR fase 2 (ALM2-52): il data entry dell'organigramma si fa su BOSS. In Alma restano la vista e l'import
  // dell'export di BOSS; ogni altra modifica risponde 403 (salvo ORG_EDITABLE=1, per i test e i casi d'emergenza).
  const readOnly = !config.orgEditable;
  app.use(BASE, (req, _res, next) => {
    if (!readOnly || ['GET', 'HEAD'].includes(req.method) || req.path === '/anteprima' || req.path === '/import') return next();
    next(new HttpError(403, "L'organigramma si modifica su BOSS: in Alma si guarda soltanto"));
  });
  const adminOnly = req => { if (!gov.isAdmin(req)) throw new HttpError(403, 'L\'organigramma lo cambiano gli amministratori'); };
  const log = (q, req, azione, oggetto, prima, dopo, n = 0) => q.query('INSERT INTO org_cambi (user_id, azione, oggetto, prima, dopo, persone_cambiate) VALUES ($1, $2, $3, $4, $5, $6)',
    [req.user.id, azione, oggetto || null, prima ? JSON.stringify(prima) : null, dopo ? JSON.stringify(dopo) : null, n]);

  app.get(BASE, async (req, res) => {
    adminOnly(req);
    res.json({ ...vista(await loadState(db)), readonly: readOnly });
  });

  app.post(`${BASE}/anteprima`, async (req, res) => {
    adminOnly(req);
    const st = await loadState(db);
    const r = O.applica(st, req.body || {});
    res.json({ errori: r.errori, prima: r.prima, dopo: r.dopo, cambiano: r.errori.length ? [] : O.differenze(st, r.state) });
  });

  app.post(`${BASE}/azione`, async (req, res) => {
    adminOnly(req);
    const st = await loadState(db);
    const b = req.body || {};
    // controllo di concorrenza: l'incarico non è cambiato dopo l'apertura della finestra
    if (b.incaricoId && b.updatedAt !== undefined) {
      const cur = st.incarichi.find(i => i.id === Number(b.incaricoId));
      const at = cur?.updated_at ? new Date(cur.updated_at).toISOString() : null;
      if ((b.updatedAt || null) !== at) throw new HttpError(409, 'Nel frattempo qualcuno ha cambiato questo incarico: riapri la finestra');
    }
    const r = O.applica(st, b);
    if (r.errori.length) throw new HttpError(400, r.errori[0]);
    const cambiano = O.differenze(st, r.state);
    await db.tx(async q => {
      await persist(q, st, r.state, req.user.id);
      await log(q, req, r.etichetta, r.oggetto, r.prima, r.dopo, cambiano.length);
    });
    req.auditDetail = { label: `Organigramma: ${r.etichetta.toLowerCase()}`, target: r.oggetto, before: r.prima, after: r.dopo };
    res.json({ ok: true, cambiano: cambiano.length });
  });

  // ── livelli ──────────────────────────────────────────────────────────────────────────────────────
  app.post(`${BASE}/livelli`, async (req, res) => {
    adminOnly(req);
    const nome = v.text(req.body?.nome, 'nome', { max: 60, required: true });
    const { rows: [{ max }] } = await db.query('SELECT COALESCE(MAX(ordine), 0) AS max FROM org_livelli');
    await db.query('INSERT INTO org_livelli (nome, ordine, approva) VALUES ($1, $2, $3)', [nome, Number(max) + 1, !!req.body?.approva]);
    await log(db, req, 'Nuovo livello', nome, null, { ordine: Number(max) + 1, approva: !!req.body?.approva });
    res.status(201).json({ ok: true });
  });
  app.patch(`${BASE}/livelli/:id`, async (req, res) => {
    adminOnly(req);
    const id = v.int(req.params.id, 'livello', { min: 1 });
    const { rows: [l] } = await db.query('SELECT * FROM org_livelli WHERE id = $1', [id]);
    if (!l) throw new HttpError(404, 'Livello non trovato');
    const b = req.body || {};
    const nome = b.nome !== undefined ? v.text(b.nome, 'nome', { max: 60, required: true }) : l.nome;
    const approva = b.approva !== undefined ? !!b.approva : l.approva;
    const attivo = b.attivo !== undefined ? !!b.attivo : l.attivo;
    await db.query('UPDATE org_livelli SET nome = $2, approva = $3, attivo = $4 WHERE id = $1', [id, nome, approva, attivo]);
    await log(db, req, 'Livello modificato', nome, { nome: l.nome, approva: l.approva, attivo: l.attivo }, { nome, approva, attivo });
    res.json({ ok: true });
  });
  // Riordino: rifiutato se un incarico finirebbe a riportare a uno di livello uguale o più basso (li elenca).
  app.post(`${BASE}/livelli/ordine`, async (req, res) => {
    adminOnly(req);
    const ids = v.ids(req.body?.ids, 'livelli');
    const st = await loadState(db);
    if (ids.length !== st.livelli.length || !st.livelli.every(l => ids.includes(l.id))) throw new HttpError(400, 'Mandami tutti i livelli nel nuovo ordine');
    const nuovo = { ...st, livelli: st.livelli.map(l => ({ ...l, ordine: ids.indexOf(l.id) + 1 })) };
    const errori = O.erroriTutti(O.build(nuovo));
    if (errori.length > O.erroriTutti(O.build(st)).length) throw new HttpError(400, `Così non si può: ${errori.slice(0, 3).join(' · ')}`);
    await db.tx(async q => {
      for (const [n, id] of ids.entries()) await q.query('UPDATE org_livelli SET ordine = $2 WHERE id = $1', [id, n + 1]);
      await log(q, req, 'Livelli riordinati', null, st.livelli.map(l => l.nome), ids.map(id => st.livelli.find(l => l.id === id).nome));
    });
    res.json({ ok: true });
  });

  // ── aree ─────────────────────────────────────────────────────────────────────────────────────────
  app.post(`${BASE}/aree`, async (req, res) => {
    adminOnly(req);
    const b = req.body || {};
    const nome = v.text(b.nome, 'nome', { max: 80, required: true });
    const tipo = v.oneOf(b.tipo || 'funzionale', 'tipo', ['funzionale', 'operativa', 'altro']);
    const { rows: dup } = await db.query('SELECT 1 FROM org_aree WHERE lower(nome) = lower($1)', [nome]);
    if (dup.length) throw new HttpError(409, 'C\'è già un\'area con questo nome');
    await db.query('INSERT INTO org_aree (nome, tipo, ordine) VALUES ($1, $2, (SELECT COALESCE(MAX(ordine), 0) + 10 FROM org_aree WHERE tipo = $2))', [nome, tipo]);
    await log(db, req, 'Nuova area', nome, null, { tipo });
    res.status(201).json({ ok: true });
  });
  app.patch(`${BASE}/aree/:id`, async (req, res) => {
    adminOnly(req);
    const id = v.int(req.params.id, 'area', { min: 1 });
    const { rows: [a] } = await db.query('SELECT * FROM org_aree WHERE id = $1', [id]);
    if (!a) throw new HttpError(404, 'Area non trovata');
    const b = req.body || {};
    const next = {
      nome: b.nome !== undefined ? v.text(b.nome, 'nome', { max: 80, required: true }) : a.nome,
      tipo: b.tipo !== undefined ? v.oneOf(b.tipo, 'tipo', ['funzionale', 'operativa', 'altro']) : a.tipo,
      attiva: b.attiva !== undefined ? !!b.attiva : a.attiva,
      centro_costo: b.centroCosto !== undefined ? (v.text(b.centroCosto, 'centro di costo', { max: 40 }) || null) : a.centro_costo,
    };
    await db.query('UPDATE org_aree SET nome = $2, tipo = $3, attiva = $4, centro_costo = $5 WHERE id = $1', [id, next.nome, next.tipo, next.attiva, next.centro_costo]);
    await log(db, req, 'Area modificata', next.nome, { nome: a.nome, tipo: a.tipo, attiva: a.attiva, centro_costo: a.centro_costo }, next);
    res.json({ ok: true });
  });

  // ── import da foglio e proposta da Entra ─────────────────────────────────────────────────────────
  async function applicaPiano(req, piano, etichetta) {
    const st = await loadState(db);
    if (piano.righeConErrori.length) throw new HttpError(400, `Correggi prima ${piano.righeConErrori.length} righe`);
    await db.tx(async q => {
      await persist(q, st, piano.state, req.user.id);
      await log(q, req, etichetta, `${piano.incarichi.length} incarichi e ${piano.persone.length} persone`, null, null);
    });
    req.auditDetail = { label: `Organigramma: ${etichetta.toLowerCase()}`, target: `${piano.incarichi.length} incarichi, ${piano.persone.length} persone` };
  }
  const raw = express.raw({ type: () => true, limit: '10mb' });
  app.post(`${BASE}/import`, raw, async (req, res) => {
    adminOnly(req);
    let sheets;
    try { sheets = readXlsx(req.body); } catch { throw new HttpError(400, 'Il file non è un Excel (.xlsx) valido'); }
    const find = name => sheets[Object.keys(sheets).find(k => norm(k) === name)];
    const inc = righe(find('incarichi'), HEAD_INC);
    const per = righe(find('persone'), HEAD_PER);
    if (!inc.length && !per.length) throw new HttpError(400, 'Servono i fogli «Incarichi» e/o «Persone» con le intestazioni del modello');
    const piano = pianoImport(await loadState(db), inc, per);
    if (req.query.applica === '1') { await applicaPiano(req, piano, 'Importato da foglio'); return res.json({ ok: true }); }
    res.json({ incarichi: piano.incarichi, persone: piano.persone, righeConErrori: piano.righeConErrori, avvisi: piano.avvisi, daSistemare: piano.daSistemare });
  });
  app.post(`${BASE}/proposta-entra`, async (req, res) => {
    adminOnly(req);
    const st = await loadState(db);
    const p = propostaEntra(st);
    const piano = pianoImport(st, p.incarichi.map((r, n) => ({ riga: n + 2, ...r })), p.persone.map((r, n) => ({ riga: n + 2, ...r })));
    if (req.query.applica === '1') { await applicaPiano(req, piano, 'Proposta dai responsabili di Entra'); return res.json({ ok: true }); }
    res.json({ incarichi: piano.incarichi, persone: piano.persone, righeConErrori: piano.righeConErrori, avvisi: piano.avvisi, daSistemare: piano.daSistemare });
  });
  app.get(`${BASE}/modello.xlsx`, async (req, res) => {
    adminOnly(req);
    const buf = writeXlsx({
      Incarichi: [HEAD_INC.map(h => h[0].toUpperCase() + h.slice(1)), ['Amministratore delegato', '', 'Direzione', '', 'nome.cognome@almacis.it', ''], ['Responsabile Reti BP/MP', 'Amministratore delegato', 'Responsabili', 'Reti BP/MP', 'nome.cognome@almacis.it', 'sì']],
      Persone: [HEAD_PER.map(h => h[0].toUpperCase() + h.slice(1)), ['nome.cognome@almacis.it', '', 'Responsabile Reti BP/MP', '', 'Reti BP/MP', ''], ['consulente@studio.it', 'Nome Cognome', 'Amministratore delegato', '', '', 'sì']],
    });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', 'attachment; filename="organigramma-modello.xlsx"');
    res.send(buf);
  });

  app.get(`${BASE}/storia`, async (req, res) => {
    adminOnly(req);
    const { rows } = await db.query(
      `SELECT c.id, c.at, c.azione, c.oggetto, c.prima, c.dopo, c.persone_cambiate, u.name FROM org_cambi c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.id DESC LIMIT 200`);
    res.json(rows);
  });
}

module.exports = { registerOrganigramma, pianoImport, propostaEntra, vista };
