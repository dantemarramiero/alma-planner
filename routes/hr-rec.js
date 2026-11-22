// Alma HR, Fase 3: recruitment (ALM2-53; canvas «Alma HR», pagina «Fase 3 · recruitment», tavole S–Z).
// Decisioni di Dante 22/11: pagina pubblica «Lavora con noi» per ogni annuncio; approvano sempre HR + Direzione, il CFO
// solo per posizioni nuove, fuori dal piano o sopra G6; CV dei non assunti 24 mesi con il consenso. Persone e organigramma
// restano su BOSS. ALM2-63 (Dante 22/11): la posizione della richiesta si può creare in Alma e resta in Alma; all'assunzione
// Alma manda a BOSS via API solo la persona; candidati aggiunti col CV letto dall'AI, solo in posizioni aperte e approvate.
//   /api/hr/richieste[...]       richieste di personale e approvazioni (HR, chi la chiede, chi approva)
//   /api/hr/richieste/:id/annuncio   annuncio con la fascia e i controlli (team HR)
//   /lavora-con-noi[/:slug]      pagina pubblica degli annunci e candidatura (senza login)
//   /api/hr/candidati[...]       tutti i candidati per ruolo o BU, «Aggiungi con CV» (tavola AP)
//   /api/hr/candidature/:id[...] scheda, passi, CV, corrispondenza, colloqui, voti
//   /api/hr/offerte/:id[...]     offerta, approvazione, lettera Word, esito
//   /api/hr/preboarding[...]     compiti dal «sì» al primo giorno · /benvenuto/:token pagina del nuovo assunto
//   /api/hr/recruitment/numeri   numeri con l'ambito (funzione o Business Unit)
const crypto = require('crypto');
const express = require('express');
const { HttpError, v } = require('../lib/http');
const { rateLimit } = require('../lib/security');
const H = require('../lib/hr');
const R = require('../lib/hr-rec');

const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const hrMod = () => require('./hr');
const plusMonths = (iso, m) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RUOLI_LABEL = { hr: 'Team HR', direzione: 'Direzione', cfo: 'CFO', bu: 'Responsabile di BU' };
const MAX_FILE = 5 * 1024 * 1024;

// file in arrivo come { nome, mime, base64 }: solo PDF, Word, immagini, testo
const ACCEPT = /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/msword|image\/(png|jpeg)|text\/plain)$/;
function readFile(f, what = 'file') {
  if (!f || !f.base64) return null;
  const nome = v.text(String(f.nome || 'file'), 'nome del file', { max: 200 }) || 'file';
  const mime = String(f.mime || '').toLowerCase();
  if (!ACCEPT.test(mime)) throw new HttpError(400, `Il ${what} deve essere PDF, Word, immagine o testo`);
  const data = Buffer.from(String(f.base64), 'base64');
  if (!data.length || data.length > MAX_FILE) throw new HttpError(400, `Il ${what} supera 5 MB o è vuoto`);
  return { nome, mime, data };
}

// Testo di un CV .docx o .txt (per la lettura senza AI).
function cvText(file) {
  try {
    if (file.mime === 'text/plain') return file.data.toString('utf8');
    if (/wordprocessingml/.test(file.mime)) {
      const { unzip } = require('../lib/xlsx');
      const xml = unzip(file.data)('word/document.xml') || '';
      return xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
    }
  } catch { /* file non leggibile */ }
  return '';
}

// Corrispondenza al ruolo con il modello (OpenAI, come Alma) se c'è la chiave; altrimenti lettura per parole chiave.
async function matchCv(file, role) {
  const { apiKey, openaiCall, textOf, MODELS } = require('../lib/assistente-openai');
  if (apiKey() && file && (file.mime === 'application/pdf' || cvText(file))) {
    const ask = `Sei il team HR di Almacis (costruzioni, impianti, reti gas). Confronta il CV con il ruolo «${H.roleTitle(role)}».
Scopo del ruolo: ${role.description || ''}
Autonomia per complessità di commessa (C1–C5): ${JSON.stringify(role.autonomy || {})}
Competenze: ${(role.hard_skills || []).join(', ')} · Requisiti: ${(role.requirements || []).join(', ')}
Rispondi solo con JSON: {"pct": numero 0-100, "note": "3-4 righe in italiano: esperienza per complessità di commessa, certificazioni, settore, cosa verificare al colloquio"}. Non dedurre età, genere o provenienza.`;
    const content = file.mime === 'application/pdf'
      ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data.toString('base64') }, title: file.nome }, { type: 'text', text: ask }]
      : [{ type: 'text', text: `${ask}\n\nCV:\n${cvText(file).slice(0, 20000)}` }];
    try {
      const r = await openaiCall({ model: MODELS.haiku, max_tokens: 400, system: 'Rispondi solo con JSON valido.', messages: [{ role: 'user', content }] });
      const j = JSON.parse((textOf(r.content).match(/\{[\s\S]*\}/) || ['{}'])[0]);
      if (Number.isFinite(Number(j.pct))) return { pct: Math.max(0, Math.min(100, Math.round(Number(j.pct)))), note: `${String(j.note || '').slice(0, 1200)}\n(Alma propone, non decide: da verificare al colloquio.)` };
    } catch { /* si ripiega sulla lettura senza AI */ }
  }
  return file ? R.cvHeuristic(cvText(file), role) : null;
}

// «Aggiungi con CV» (ALM2-63): dati del candidato e corrispondenza con ogni posizione aperta, in una sola lettura del modello.
// Senza chiave (o se la risposta non si legge): email, telefono e nome dal testo e corrispondenza per parole chiave.
async function readCv(file, positions) {
  const { apiKey, openaiCall, textOf, MODELS } = require('../lib/assistente-openai');
  const text = cvText(file);
  const base = R.cvContacts(text);
  const heur = () => positions.map(p => ({ req_id: p.id, pct: p.role ? (R.cvHeuristic(text, p.role)?.pct ?? null) : null }));
  let data = null;
  if (apiKey() && (file.mime === 'application/pdf' || text)) {
    const list = positions.map(p => `- id ${p.id}: «${p.posizione}» · ruolo ${p.role ? H.roleTitle(p.role) : p.ruolo || 'senza ruolo'} G${p.grade ?? '?'} · ${p.area_nome || ''} · competenze: ${(p.role?.hard_skills || []).slice(0, 8).join(', ')} · requisiti: ${(p.role?.requirements || []).slice(0, 6).join(', ')}`).join('\n');
    const ask = `Sei il team HR di Almacis (costruzioni, impianti, reti gas). Leggi il CV e confrontalo con le posizioni aperte.
Posizioni aperte:
${list}
Rispondi solo con JSON: {"nome": "", "cognome": "", "email": "", "telefono": "", "profilo": "una riga in italiano: anni di esperienza, ruolo, settore, certificazioni", "posizioni": [{"id": numero, "pct": numero 0-100}]}.
Metti tutte le posizioni dell'elenco. Non dedurre età, genere o provenienza.`;
    const content = file.mime === 'application/pdf'
      ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data.toString('base64') }, title: file.nome }, { type: 'text', text: ask }]
      : [{ type: 'text', text: `${ask}\n\nCV:\n${text.slice(0, 20000)}` }];
    try {
      const r = await openaiCall({ model: MODELS.haiku, max_tokens: 600, system: 'Rispondi solo con JSON valido.', messages: [{ role: 'user', content }] });
      data = JSON.parse((textOf(r.content).match(/\{[\s\S]*\}/) || ['{}'])[0]);
    } catch { data = null; /* si ripiega sulla lettura senza AI */ }
  }
  const s = (x, max) => String(x ?? '').trim().slice(0, max);
  const ai = Boolean(data && (data.nome || data.cognome || data.email));
  const pctOf = new Map((ai && Array.isArray(data.posizioni) ? data.posizioni : []).map(x => [Number(x.id), Math.max(0, Math.min(100, Math.round(Number(x.pct) || 0)))]));
  const h = new Map(heur().map(x => [x.req_id, x.pct]));
  const proposte = positions.map(p => ({ req_id: p.id, posizione: p.posizione, ruolo: p.role ? H.roleTitle(p.role) : p.ruolo, grade: p.grade, area: p.area_nome, approved_at: p.approved_at,
    pct: pctOf.has(p.id) ? pctOf.get(p.id) : h.get(p.id) ?? null })).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  return {
    ai, nome: s(ai ? data.nome : base.nome, 80), cognome: s(ai ? data.cognome : base.cognome, 80), email: s(ai ? data.email || base.email : base.email, 200).toLowerCase(),
    telefono: s(ai ? data.telefono || base.telefono : base.telefono, 40), profilo: s(ai ? data.profilo : '', 400), proposte,
  };
}

function registerHrRec(app, { db, gov, notifier, auth, config = {} }) {
  const isHr = req => gov.roleOf(req.user.email).key === 'hr';
  const hrOnly = req => { if (!isHr(req)) throw new HttpError(403, 'Riservato al team HR'); };
  const hrLog = (req, action, extra = {}) => db.query('INSERT INTO hr_log (user_id, kind, action, person_key, after) VALUES ($1, $2, $3, $4, $5)',
    [req.user.id, extra.kind || 'modifica', action, extra.person || null, extra.after ? JSON.stringify(extra.after) : null]);
  const usersWithRole = async key => {
    const { rows } = await db.query('SELECT id, lower(email) AS email FROM users WHERE email IS NOT NULL AND suspended_at IS NULL');
    return rows.filter(u => gov.roleOf(u.email).key === key).map(u => u.id);
  };
  const notify = (userIds, actorId, body, link) => (userIds.length ? notifier?.notify({ userIds, actorId, kind: 'hr', body, link }).catch(() => {}) : null);
  // invio a BOSS: URL e token dall'ambiente; nei test config.boss = { url, token, fetchImpl }
  const bossOpts = () => ({ ...bossConfig(), ...(config.boss || {}), notifyHr: async (body, link) => notify(await usersWithRole('hr'), null, body, link) });
  registerHrRec.retryBoss = () => retryBoss(db, bossOpts());

  // ── accessi ──
  async function reqRow(id) {
    const { rows: [r] } = await db.query(`SELECT r.*, a.nome AS area_nome, a.tipo AS area_tipo, u.name AS richiedente
      FROM hr_requisitions r LEFT JOIN org_aree a ON a.id = r.area_id LEFT JOIN users u ON u.id = r.requested_by WHERE r.id = $1`, [id]);
    if (!r) throw new HttpError(404, 'Richiesta non trovata');
    return r;
  }
  // chi ricopre l'incarico più alto dell'area (il responsabile di BU per le offerte)
  async function areaHead(areaId) {
    if (!areaId) return null;
    const { rows } = await db.query('SELECT id, riporta_a_id, lower(ricoperto_da) AS email, area_id FROM org_incarichi WHERE attivo AND area_id = $1', [areaId]);
    const ids = new Set(rows.map(r => r.id));
    const top = rows.find(r => r.email && !ids.has(r.riporta_a_id));
    if (!top) return null;
    const { rows: [u] } = await db.query('SELECT id FROM users WHERE lower(email) = $1', [top.email]);
    return u?.id || null;
  }
  async function canDecide(req, step, ctx) {
    if (step.ruolo === 'hr') return isHr(req);
    const me = gov.roleOf(req.user.email).key;
    if (step.ruolo === 'direzione' || step.ruolo === 'cfo') {
      if (me === step.ruolo) return true;
      return gov.isAdmin(req) && !(await usersWithRole(step.ruolo)).length; // nessuno con quel ruolo: decide un amministratore
    }
    if (step.ruolo === 'bu') return req.user.id === ctx.requested_by || req.user.id === (await areaHead(ctx.area_id)) || gov.isAdmin(req);
    return false;
  }
  async function approversFor(step, ctx) {
    if (step.ruolo === 'hr') return usersWithRole('hr');
    if (step.ruolo === 'bu') return [...new Set([ctx.requested_by, await areaHead(ctx.area_id)].filter(Boolean))];
    const ids = await usersWithRole(step.ruolo);
    if (ids.length) return ids;
    const { rows } = await db.query('SELECT id, email FROM users WHERE email IS NOT NULL');
    return rows.filter(u => gov.isAdminEmail(u.email)).map(u => u.id);
  }
  const steps = async (oggetto, id) => (await db.query(`SELECT s.*, u.name AS chi FROM hr_approvals s LEFT JOIN users u ON u.id = s.user_id WHERE oggetto = $1 AND oggetto_id = $2 ORDER BY ordine`, [oggetto, id])).rows;
  const pending = list => list.find(s => !s.decisione || s.decisione === 'modifica') || null;
  async function interviewerOf(req, reqId) {
    const { rows: [x] } = await db.query('SELECT 1 FROM hr_interviews i JOIN hr_applications a ON a.id = i.app_id WHERE a.req_id = $1 AND lower(i.interviewer_email) = $2 LIMIT 1', [reqId, req.user.email.toLowerCase()]);
    return Boolean(x);
  }
  async function canSeeReq(req, r) {
    if (isHr(req) || r.requested_by === req.user.id) return true;
    const st = await steps('richiesta', r.id);
    if (st.some(s => s.user_id === req.user.id)) return true; // ha già deciso un passo: continua a vederla
    const p = r.stato === 'approvazione' ? pending(st) : null;
    if (p && await canDecide(req, p, r)) return true;
    return interviewerOf(req, r.id);
  }
  const roleAndBand = async roleId => {
    if (!roleId) return { role: null, band: null, grid: await hrMod().currentGrid(db) };
    const { rows: [role] } = await db.query('SELECT * FROM pm_roles WHERE id = $1', [roleId]);
    const grid = await hrMod().currentGrid(db);
    return { role, band: role ? H.bandOf(grid.bands, role.grade) : null, grid };
  };

  // ── richieste di personale (tavole S e T) ──
  app.get('/api/hr/richieste', async (req, res) => {
    const hr = isHr(req);
    const { rows } = await db.query(`SELECT r.id, r.posizione, r.tipo, r.stato, r.da_quando, r.created_at, r.approved_at, r.requested_by, r.area_id, r.role_id, r.incarico_id,
        a.nome AS area_nome, a.tipo AS area_tipo, p.title AS ruolo, p.grade, u.name AS richiedente, pb.pubblicato, pb.published_at,
        (SELECT count(*)::int FROM hr_applications x WHERE x.req_id = r.id) AS candidati
      FROM hr_requisitions r LEFT JOIN org_aree a ON a.id = r.area_id LEFT JOIN pm_roles p ON p.id = r.role_id
      LEFT JOIN users u ON u.id = r.requested_by LEFT JOIN hr_postings pb ON pb.req_id = r.id ORDER BY r.created_at DESC`);
    const ambito = hrMod().ambitoOf(req);
    const out = [];
    for (const r of rows) {
      if (!hrMod().inScope({ id: r.area_id, tipo: r.area_tipo }, ambito) && ambito) continue;
      const st = await steps('richiesta', r.id);
      const p = r.stato === 'approvazione' ? pending(st) : null;
      const tocca = p ? await canDecide(req, p, r) : false;
      if (!hr && r.requested_by !== req.user.id && !tocca && !st.some(x => x.user_id === req.user.id) && !(await interviewerOf(req, r.id))) continue;
      out.push({ ...r, da_approvare: tocca, passo: p ? RUOLI_LABEL[p.ruolo] : null });
    }
    // incarichi vacanti per la nuova richiesta: tutti per HR, quelli sotto i propri incarichi per gli altri
    const { rows: vac } = await db.query(`SELECT i.id, i.nome, i.area_id, a.nome AS area, i.vacante_dal::text AS vacante_dal, r.role_id, p.title AS ruolo, p.grade,
        lower(sopra.ricoperto_da) AS sopra_email
      FROM org_incarichi i LEFT JOIN org_aree a ON a.id = i.area_id LEFT JOIN hr_incarico_roles r ON r.incarico_id = i.id LEFT JOIN pm_roles p ON p.id = r.role_id
      LEFT JOIN org_incarichi sopra ON sopra.id = i.riporta_a_id
      WHERE i.attivo AND i.ricoperto_da IS NULL AND NOT EXISTS (SELECT 1 FROM hr_requisitions q WHERE q.incarico_id = i.id AND q.stato NOT IN ('rifiutata', 'chiusa'))
      ORDER BY a.nome NULLS LAST, i.nome`);
    const grid = await hrMod().currentGrid(db);
    // posizione nuova creata in Alma (ALM2-63): HR in tutte le aree, un responsabile nelle aree dove guida qualcuno
    const mine = hr ? null : await managedAreas(req.user.email);
    const roles = hr || mine.length ? (await hrMod().hrRoles(db)).map(r => ({ id: r.id, title: H.roleTitle(r), grade: r.grade, band: H.bandOf(grid.bands, r.grade) })) : [];
    const aree = (await db.query('SELECT id, nome, tipo FROM org_aree WHERE attiva ORDER BY nome')).rows.filter(a => hr || mine.includes(a.id));
    const capi = hr ? (await db.query(`SELECT DISTINCT lower(i.ricoperto_da) AS email, COALESCE(NULLIF(trim(h.nome || ' ' || h.cognome), ''), i.ricoperto_da) AS nome, i.nome AS incarico
      FROM org_incarichi i LEFT JOIN hr_people h ON lower(h.email) = lower(i.ricoperto_da) AND h.attivo
      WHERE i.attivo AND i.ricoperto_da IS NOT NULL AND EXISTS (SELECT 1 FROM org_incarichi s WHERE s.riporta_a_id = i.id AND s.attivo) ORDER BY 2`)).rows : [];
    res.json({ richieste: out, vacanti: vac.filter(x => hr || x.sopra_email === req.user.email.toLowerCase()).map(x => ({ ...x, sopra_email: undefined, band: x.grade ? H.bandOf(grid.bands, x.grade) : null })),
      roles, aree, capi, puo_creare_posizione: hr || aree.length > 0, coeff: Number(grid.rules.costCoeff) || 1.38, is_hr: hr });
  });
  // aree in cui la persona ricopre un incarico con qualcuno che le riporta
  async function managedAreas(email) {
    const { rows } = await db.query(`SELECT DISTINCT i.area_id FROM org_incarichi i WHERE i.attivo AND i.area_id IS NOT NULL AND lower(i.ricoperto_da) = $1
      AND EXISTS (SELECT 1 FROM org_incarichi s WHERE s.riporta_a_id = i.id AND s.attivo)`, [String(email).toLowerCase()]);
    return rows.map(r => r.area_id);
  }

  const reqBody = b => ({
    posizione: v.text(b.posizione, 'posizione', { max: 160 }), tipo: v.oneOf(b.tipo, 'tipo', ['sostituzione', 'nuova', 'temporanea']),
    motivo: v.text(b.motivo, 'motivo', { max: 2000 }), da_quando: v.text(b.da_quando, 'da quando', { max: 60 }),
    contratto: v.oneOf(b.contratto, 'contratto', ['TI', 'TD', 'APPR', 'STAFF_LEASING', 'TIROCINIO']), sede: v.text(b.sede, 'sede', { max: 120 }),
    nel_piano: b.nel_piano === undefined ? undefined : Boolean(b.nel_piano),
  });
  app.post('/api/hr/richieste', async (req, res) => {
    const f = reqBody(req.body);
    const incaricoId = v.int(req.body.incarico_id, 'incarico', { min: 1, nullable: true });
    let inc = null;
    if (incaricoId) {
      ({ rows: [inc] } = await db.query(`SELECT i.id, i.nome, i.area_id, r.role_id, lower(sopra.ricoperto_da) AS sopra_email FROM org_incarichi i
        LEFT JOIN hr_incarico_roles r ON r.incarico_id = i.id LEFT JOIN org_incarichi sopra ON sopra.id = i.riporta_a_id WHERE i.id = $1 AND i.attivo`, [incaricoId]));
      if (!inc) throw new HttpError(404, 'Incarico non trovato');
      const { rows: [dup] } = await db.query("SELECT id FROM hr_requisitions WHERE incarico_id = $1 AND stato NOT IN ('rifiutata', 'chiusa')", [inc.id]);
      if (dup) throw new HttpError(409, `Per questo incarico c'è già la richiesta n. ${dup.id}`);
    }
    const me = req.user.email.toLowerCase();
    const roleId = inc?.role_id || v.int(req.body.role_id, 'ruolo', { min: 1, nullable: true }) || null;
    const areaId = inc?.area_id || v.int(req.body.area_id, 'area', { min: 1, nullable: true }) || null;
    if (inc) {
      if (!isHr(req) && inc.sopra_email !== me) throw new HttpError(403, 'La richiesta la apre il responsabile dell\'incarico o il team HR');
    } else {
      // posizione nuova: si crea qui in Alma e resta in Alma (a BOSS va solo la persona assunta)
      if (!isHr(req) && !(areaId && (await managedAreas(me)).includes(areaId))) throw new HttpError(403, 'Una posizione nuova la apre il team HR o il responsabile dell\'area');
      if (!f.posizione) throw new HttpError(400, 'Scrivi come si chiama la posizione nuova');
      if (!roleId || !areaId) throw new HttpError(400, 'Per una posizione nuova scegli il ruolo del mansionario e l\'area');
    }
    const posizione = f.posizione || inc?.nome;
    const riporta = inc ? inc.sopra_email : (isHr(req) ? (v.text(req.body.riporta_a, 'a chi riporta', { max: 200 }) || '').toLowerCase() || null : me);
    const { rows: [r] } = await db.query(`INSERT INTO hr_requisitions (incarico_id, posizione, role_id, area_id, tipo, motivo, da_quando, contratto, sede, nel_piano, requested_by, riporta_a)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [inc?.id || null, posizione, roleId, areaId, f.tipo || (inc ? 'sostituzione' : 'nuova'), f.motivo || '', f.da_quando || '', f.contratto || 'TI', f.sede || '', f.nel_piano ?? true, req.user.id, riporta]);
    res.json({ id: r.id });
  });

  app.get('/api/hr/richieste/:id', async (req, res) => {
    const r = await reqRow(v.int(req.params.id, 'id', { min: 1 }));
    if (!(await canSeeReq(req, r))) throw new HttpError(403, 'Non puoi vedere questa richiesta');
    const hr = isHr(req);
    const { role, band, grid } = await roleAndBand(r.role_id);
    const st = await steps('richiesta', r.id);
    const p = r.stato === 'approvazione' ? pending(st) : null;
    const coeff = Number(grid.rules.costCoeff) || 1.38;
    const { rows: [posting] } = await db.query('SELECT * FROM hr_postings WHERE req_id = $1', [r.id]);
    let apps = [];
    if (hr || r.requested_by === req.user.id) {
      ({ rows: apps } = await db.query(`SELECT a.id, a.stage, a.fonte, a.match_pct, a.created_at, a.motivo_scarto, c.nome, c.cognome, (SELECT o.stato FROM hr_offers o WHERE o.app_id = a.id ORDER BY o.id DESC LIMIT 1) AS offerta, (SELECT json_build_object('tipo', i.tipo, 'quando', i.quando, 'chi', COALESCE(u.name, i.interviewer_email)) FROM hr_interviews i LEFT JOIN users u ON lower(u.email) = lower(i.interviewer_email) WHERE i.app_id = a.id ORDER BY i.quando DESC NULLS LAST LIMIT 1) AS colloquio, (SELECT count(DISTINCT s.email)::int FROM hr_scores s WHERE s.app_id = a.id) AS votanti FROM hr_applications a JOIN hr_candidates c ON c.id = a.candidate_id
        WHERE a.req_id = $1 ORDER BY a.updated_at DESC`, [r.id]));
    } else {
      ({ rows: apps } = await db.query(`SELECT DISTINCT a.id, a.stage, c.nome, c.cognome FROM hr_applications a JOIN hr_candidates c ON c.id = a.candidate_id JOIN hr_interviews i ON i.app_id = a.id
        WHERE a.req_id = $1 AND lower(i.interviewer_email) = $2`, [r.id, req.user.email.toLowerCase()]));
    }
    res.json({
      richiesta: r, ruolo: role ? { id: role.id, title: H.roleTitle(role), grade: role.grade } : null, band,
      costo: band ? { riferimento: Math.round(band.mid * 1000), azienda: Math.round(band.mid * 1000 * coeff) } : null,
      catena: st.map(s => ({ ...s, label: RUOLI_LABEL[s.ruolo] })), passo: p ? { ...p, label: RUOLI_LABEL[p.ruolo], tocca_a_me: await canDecide(req, p, r) } : null,
      catena_prevista: R.reqChain({ tipo: r.tipo, nel_piano: r.nel_piano, grade: role?.grade }).map(k => RUOLI_LABEL[k]),
      annuncio: posting && (hr || r.requested_by === req.user.id) ? { ...posting, controlli: R.postingChecks(posting) } : null,
      candidature: apps, stages: R.STAGES, is_hr: hr, puo_aggiungere: await canAddTo(req, r), puo_modificare: ['bozza', 'modifica'].includes(r.stato) && (hr || r.requested_by === req.user.id),
    });
  });

  app.patch('/api/hr/richieste/:id', async (req, res) => {
    const r = await reqRow(v.int(req.params.id, 'id', { min: 1 }));
    if (!['bozza', 'modifica'].includes(r.stato) || !(isHr(req) || r.requested_by === req.user.id)) throw new HttpError(403, 'La richiesta non si può più modificare');
    const f = Object.fromEntries(Object.entries(reqBody(req.body)).filter(([, x]) => x !== undefined));
    if (!Object.keys(f).length) throw new HttpError(400, 'Niente da cambiare');
    const keys = Object.keys(f);
    await db.query(`UPDATE hr_requisitions SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`, [...keys.map(k => f[k]), r.id]);
    res.json({ ok: true });
  });

  app.post('/api/hr/richieste/:id/invia', async (req, res) => {
    const r = await reqRow(v.int(req.params.id, 'id', { min: 1 }));
    if (!['bozza', 'modifica'].includes(r.stato) || !(isHr(req) || r.requested_by === req.user.id)) throw new HttpError(403, 'La richiesta non si può inviare');
    const { role } = await roleAndBand(r.role_id);
    const old = await steps('richiesta', r.id);
    await db.tx(async q => {
      if (r.stato === 'bozza' || !old.length) {
        await q.query("DELETE FROM hr_approvals WHERE oggetto = 'richiesta' AND oggetto_id = $1", [r.id]);
        const chain = R.reqChain({ tipo: r.tipo, nel_piano: r.nel_piano, grade: role?.grade });
        for (const [i, ruolo] of chain.entries()) await q.query("INSERT INTO hr_approvals (oggetto, oggetto_id, ordine, ruolo) VALUES ('richiesta', $1, $2, $3)", [r.id, i + 1, ruolo]);
      } else {
        // dopo «chiedi una modifica»: si riparte dal passo che l'ha chiesta, le approvazioni già date restano
        await q.query("UPDATE hr_approvals SET decisione = NULL, commento = '', user_id = NULL, decided_at = NULL WHERE oggetto = 'richiesta' AND oggetto_id = $1 AND decisione = 'modifica'", [r.id]);
      }
      await q.query("UPDATE hr_requisitions SET stato = 'approvazione' WHERE id = $1", [r.id]);
    });
    const p = pending(await steps('richiesta', r.id));
    await notify(await approversFor(p, r), req.user.id, `chiede di approvare la richiesta di personale «${r.posizione}».`, `/hr/richieste/${r.id}`);
    res.json({ ok: true });
  });

  // una decisione su un passo della catena (richiesta o offerta)
  async function decide(req, oggetto, id, ctx, onDone, onNo, onModifica) {
    const decisione = v.oneOf(req.body.decisione, 'decisione', ['ok', 'modifica', 'no']);
    const commento = v.text(req.body.commento, 'commento', { max: 2000 }) || '';
    if (decisione !== 'ok' && !commento) throw new HttpError(400, 'Scrivi il motivo');
    const p = pending(await steps(oggetto, id));
    if (!p || p.decisione === 'modifica') throw new HttpError(400, 'Niente da decidere adesso');
    if (!(await canDecide(req, p, ctx))) throw new HttpError(403, `Questo passo lo decide: ${RUOLI_LABEL[p.ruolo]}`);
    await db.query('UPDATE hr_approvals SET decisione = $1, commento = $2, user_id = $3, decided_at = now() WHERE id = $4', [decisione, commento, req.user.id, p.id]);
    if (decisione === 'no') return onNo(commento);
    if (decisione === 'modifica') return onModifica(commento);
    const next = pending(await steps(oggetto, id));
    if (next) { await notify(await approversFor(next, ctx), req.user.id, `chiede la tua approvazione (${oggetto} «${ctx.posizione || ctx.titolo || ''}»).`, oggetto === 'richiesta' ? `/hr/richieste/${id}` : `/hr/candidato/${ctx.app_id}`); return null; }
    return onDone();
  }

  app.post('/api/hr/richieste/:id/decidi', async (req, res) => {
    const r = await reqRow(v.int(req.params.id, 'id', { min: 1 }));
    if (r.stato !== 'approvazione') throw new HttpError(400, 'La richiesta non è in approvazione');
    await decide(req, 'richiesta', r.id, r,
      async () => {
        await db.query("UPDATE hr_requisitions SET stato = 'approvata', approved_at = now() WHERE id = $1", [r.id]);
        // nasce la bozza dell'annuncio dalla scheda del ruolo
        const { role, band, grid } = await roleAndBand(r.role_id);
        const d = R.postingDraft({ role, band, req: r, rules: grid.rules, areaName: r.area_nome });
        await db.query(`INSERT INTO hr_postings (req_id, slug, titolo, testo, ral_min, ral_max, variabile) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (req_id) DO NOTHING`,
          [r.id, R.slugify(r.posizione, r.id), d.titolo, JSON.stringify(d.testo), d.ral_min, d.ral_max, d.variabile]);
        await notify(await usersWithRole('hr'), req.user.id, `ha approvato la richiesta «${r.posizione}»: la bozza dell'annuncio è pronta da pubblicare.`, `/hr/richieste/${r.id}`);
        if (r.requested_by) await notify([r.requested_by], req.user.id, `la tua richiesta «${r.posizione}» è approvata.`, `/hr/richieste/${r.id}`);
      },
      async m => { await db.query("UPDATE hr_requisitions SET stato = 'rifiutata', closed_at = now() WHERE id = $1", [r.id]); if (r.requested_by) await notify([r.requested_by], req.user.id, `ha rifiutato la richiesta «${r.posizione}»: ${m}`, `/hr/richieste/${r.id}`); },
      async m => { await db.query("UPDATE hr_requisitions SET stato = 'modifica' WHERE id = $1", [r.id]); if (r.requested_by) await notify([r.requested_by], req.user.id, `chiede una modifica alla richiesta «${r.posizione}»: ${m}`, `/hr/richieste/${r.id}`); });
    res.json({ ok: true, stato: (await reqRow(r.id)).stato });
  });

  app.post('/api/hr/richieste/:id/chiudi', async (req, res) => {
    hrOnly(req);
    const r = await reqRow(v.int(req.params.id, 'id', { min: 1 }));
    await db.query("UPDATE hr_requisitions SET stato = 'chiusa', closed_at = now() WHERE id = $1", [r.id]);
    await db.query('UPDATE hr_postings SET pubblicato = false WHERE req_id = $1', [r.id]);
    res.json({ ok: true });
  });

  // ── annuncio (tavola U) ──
  app.put('/api/hr/richieste/:id/annuncio', async (req, res) => {
    hrOnly(req);
    const r = await reqRow(v.int(req.params.id, 'id', { min: 1 }));
    const { rows: [p] } = await db.query('SELECT * FROM hr_postings WHERE req_id = $1', [r.id]);
    if (!p) throw new HttpError(400, 'L\'annuncio nasce quando la richiesta è approvata');
    const titolo = v.text(req.body.titolo, 'titolo', { max: 200 }) || p.titolo;
    const t = req.body.testo || {};
    const testo = Object.fromEntries(['scopo', 'cosa', 'requisiti', 'crescita'].map(k => [k, v.text(t[k] ?? p.testo[k] ?? '', k, { max: 5000 }) || '']));
    await db.query('UPDATE hr_postings SET titolo = $1, testo = $2, updated_at = now() WHERE id = $3', [titolo, JSON.stringify(testo), p.id]);
    const { rows: [n] } = await db.query('SELECT * FROM hr_postings WHERE id = $1', [p.id]);
    res.json({ ...n, controlli: R.postingChecks(n) });
  });
  app.post('/api/hr/richieste/:id/annuncio/pubblica', async (req, res) => {
    hrOnly(req);
    const r = await reqRow(v.int(req.params.id, 'id', { min: 1 }));
    const on = req.body.pubblicato !== false;
    const { rows: [p] } = await db.query('SELECT * FROM hr_postings WHERE req_id = $1', [r.id]);
    if (!p) throw new HttpError(400, 'Nessun annuncio');
    if (on) {
      if (r.stato !== 'approvata') throw new HttpError(400, 'Si pubblica solo una richiesta approvata e ancora aperta');
      const bad = R.postingChecks(p).filter(c => !c.ok);
      if (bad.length) throw new HttpError(400, `Prima di pubblicare: ${bad.map(c => c.testo.toLowerCase()).join('; ')}`);
      // la fascia segue sempre la griglia in vigore
      const { band } = await roleAndBand(r.role_id);
      if (band) await db.query('UPDATE hr_postings SET ral_min = $1, ral_max = $2 WHERE id = $3', [Math.round(band.min * 1000), Math.round(band.max * 1000), p.id]);
    }
    await db.query('UPDATE hr_postings SET pubblicato = $1, published_at = CASE WHEN $1 THEN COALESCE(published_at, now()) ELSE published_at END WHERE id = $2', [on, p.id]);
    await hrLog(req, on ? 'annuncio pubblicato' : 'annuncio ritirato', { after: { richiesta: r.id } });
    res.json({ ok: true, url: `${config.baseUrl || ''}/lavora-con-noi/${p.slug}` });
  });

  // ── candidati: inserimento (pagina pubblica o HR) ──
  async function addCandidate(q, { nome, cognome, email, telefono, sesso, consenso, conserva, file, reqId, fonte, userId }) {
    const e = email ? email.toLowerCase() : null;
    let cand = null;
    if (e) ({ rows: [cand] } = await q.query('SELECT id FROM hr_candidates WHERE lower(email) = $1', [e]));
    const fino = conserva ? plusMonths(todayIso(), R.CONSERVA_MESI) : null;
    if (cand) {
      await q.query(`UPDATE hr_candidates SET nome = $1, cognome = $2, telefono = COALESCE($3, telefono), sesso = COALESCE($4, sesso), consenso = consenso OR $5,
        conserva = conserva OR $6, conservare_fino = GREATEST(conservare_fino, $7::date), consenso_at = COALESCE(consenso_at, now()) WHERE id = $8`, [nome, cognome, telefono, sesso, consenso, conserva, fino, cand.id]);
    } else {
      ({ rows: [cand] } = await q.query(`INSERT INTO hr_candidates (nome, cognome, email, telefono, sesso, consenso, conserva, consenso_at, conservare_fino)
        VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $6 THEN now() END, $8) RETURNING id`, [nome, cognome, e, telefono, sesso, consenso, conserva, fino]));
    }
    if (file) await q.query('INSERT INTO hr_files (candidate_id, tipo, nome, mime, size, data) VALUES ($1, $2, $3, $4, $5, $6)', [cand.id, 'cv', file.nome, file.mime, file.data.length, file.data]);
    const { rows: [a] } = await q.query(`INSERT INTO hr_applications (candidate_id, req_id, fonte, added_by) VALUES ($1, $2, $3, $4) ON CONFLICT (candidate_id, req_id) DO UPDATE SET updated_at = now() RETURNING id`, [cand.id, reqId, fonte, fonte === 'pagina' ? null : userId || null]);
    await q.query('INSERT INTO hr_app_events (app_id, user_id, testo) VALUES ($1, $2, $3)', [a.id, userId || null, `candidatura da ${R.FONTI[fonte] || fonte}`]);
    return { candidate_id: cand.id, app_id: a.id };
  }
  // un candidato si aggiunge solo a una posizione aperta e approvata: il budget è della posizione (Dante 22/11, ALM2-63).
  // Lo aggiunge il team HR, chi ha chiesto la posizione o il responsabile dell'area.
  async function canAddTo(req, r) {
    if (r.stato !== 'approvata') return false;
    if (isHr(req) || r.requested_by === req.user.id) return true;
    return req.user.id === (await areaHead(r.area_id));
  }
  // posizioni aperte e approvate visibili a chi chiede (HR tutte, gli altri le proprie o della loro area), con l'ambito
  async function openPositions(req) {
    const { rows } = await db.query(`SELECT r.id, r.posizione, r.role_id, r.area_id, r.requested_by, r.approved_at, r.stato, a.nome AS area_nome, a.tipo AS area_tipo, p.title AS ruolo, p.grade
      FROM hr_requisitions r LEFT JOIN org_aree a ON a.id = r.area_id LEFT JOIN pm_roles p ON p.id = r.role_id WHERE r.stato = 'approvata' ORDER BY r.approved_at DESC NULLS LAST`);
    const ambito = isHr(req) ? hrMod().ambitoOf(req) : null;
    const out = [];
    for (const r of rows) {
      if (ambito && !hrMod().inScope({ id: r.area_id, tipo: r.area_tipo }, ambito)) continue;
      if (await canAddTo(req, r)) out.push(r);
    }
    return out;
  }
  const candBody = b => ({
    nome: v.text(b.nome, 'nome', { max: 80, required: true }), cognome: v.text(b.cognome, 'cognome', { max: 80, required: true }),
    email: v.text(b.email, 'email', { max: 200 }) || null, telefono: v.text(b.telefono, 'telefono', { max: 40 }) || null,
    sesso: ['F', 'M'].includes(b.sesso) ? b.sesso : null,
  });

  app.post('/api/hr/richieste/:id/candidati', express.json({ limit: '8mb' }), async (req, res) => {
    const r = await reqRow(v.int(req.params.id, 'id', { min: 1 }));
    if (r.stato !== 'approvata') throw new HttpError(400, 'Si aggiungono candidati solo a una posizione aperta e approvata');
    if (!(await canAddTo(req, r))) throw new HttpError(403, 'Candidati in questa posizione li aggiunge il team HR o il suo responsabile');
    const c = candBody(req.body);
    const file = readFile(req.body.cv, 'CV');
    const fonte = v.oneOf(req.body.fonte || 'hr', 'fonte', Object.keys(R.FONTI));
    const out = await db.tx(q => addCandidate(q, { ...c, consenso: true, conserva: Boolean(req.body.conserva), file, reqId: r.id, fonte, userId: req.user.id }));
    const { role } = await roleAndBand(r.role_id);
    if (file && role) { const m = await matchCv(file, role); if (m) await db.query('UPDATE hr_applications SET match_pct = $1, match_note = $2 WHERE id = $3', [m.pct, m.note, out.app_id]); }
    res.json(out);
  });

  // ── tutti i candidati in selezione, per ruolo o per BU (tavola AP, ALM2-63) ──
  app.get('/api/hr/candidati', async (req, res) => {
    const per = req.query.per === 'bu' ? 'bu' : 'ruolo';
    const pos = await openPositions(req);
    const ids = pos.map(p => p.id);
    const { rows } = ids.length ? await db.query(`SELECT a.id, a.req_id, a.stage, a.fonte, a.match_pct, a.created_at, a.updated_at, c.nome, c.cognome, u.name AS caricato_da,
        r.posizione, r.area_id, ar.nome AS area_nome, p.title AS ruolo, p.grade, (SELECT o.stato FROM hr_offers o WHERE o.app_id = a.id ORDER BY o.id DESC LIMIT 1) AS offerta
      FROM hr_applications a JOIN hr_candidates c ON c.id = a.candidate_id JOIN hr_requisitions r ON r.id = a.req_id LEFT JOIN org_aree ar ON ar.id = r.area_id
      LEFT JOIN pm_roles p ON p.id = r.role_id LEFT JOIN users u ON u.id = a.added_by
      WHERE a.req_id = ANY($1::int[]) AND a.stage <> 'scartata' ORDER BY a.updated_at DESC`, [ids]) : { rows: [] };
    const perBu = {};
    for (const x of rows) perBu[x.area_nome || 'Senza area'] = (perBu[x.area_nome || 'Senza area'] || 0) + 1;
    res.json({
      per, gruppi: R.groupCandidates(rows, per), stages: R.STAGES, fonti: R.FONTI, is_hr: isHr(req),
      numeri: { in_selezione: rows.length, posizioni: pos.length, per_bu: Object.entries(perBu).sort((a, b) => b[1] - a[1]),
        colloquio: rows.filter(x => ['colloquio_hr', 'colloquio_tecnico'].includes(x.stage)).length, offerte: rows.filter(x => x.stage === 'offerta').length,
        offerte_approvazione: rows.filter(x => x.stage === 'offerta' && x.offerta === 'approvazione').length },
      posizioni: pos.map(p => ({ id: p.id, posizione: p.posizione, ruolo: p.ruolo, grade: p.grade, area: p.area_nome, approved_at: p.approved_at })),
    });
  });

  // «Aggiungi con CV»: l'AI legge nome, contatti e profilo e propone la posizione aperta più adatta; chi carica conferma
  app.post('/api/hr/candidati/leggi-cv', express.json({ limit: '8mb' }), async (req, res) => {
    const file = readFile(req.body.cv, 'CV');
    if (!file) throw new HttpError(400, 'Allega il CV');
    const pos = await openPositions(req);
    if (!pos.length) throw new HttpError(400, 'Non ci sono posizioni aperte e approvate: prima si apre la richiesta di personale');
    const roles = new Map();
    for (const p of pos) if (p.role_id && !roles.has(p.role_id)) roles.set(p.role_id, (await roleAndBand(p.role_id)).role);
    const out = await readCv(file, pos.map(p => ({ ...p, role: roles.get(p.role_id) || null })));
    res.json(out);
  });

  // ── pagina pubblica «Lavora con noi» (decisione A) ──
  const publicLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: config.production ? 8 : 100, key: rq => rq.ip, message: 'Troppi invii da questa rete: riprova tra qualche minuto.' });
  const noStore = res => res.set({ 'Cache-Control': 'no-store' });
  const shell = (title, body) => `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<link rel="icon" href="/brand/favicon-64.png"><style>
:root{--o:#FF8A26;--ink:#2C2C2C;--mid:#515151;--mut:#6B6B6B;--rule:#DCDCDA;--bg:#F7F6F3}
*{box-sizing:border-box}body{margin:0;font-family:Roboto,'Helvetica Neue',Arial,sans-serif;background:var(--bg);color:var(--mid);line-height:1.5}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}header{display:flex;align-items:center;gap:12px;margin-bottom:20px}header img{height:28px}
.card{background:#fff;border:1px solid var(--rule);border-radius:18px;padding:22px;margin-bottom:16px}h1{color:var(--ink);font-weight:500;font-size:26px;margin:0 0 4px}
h2{color:var(--ink);font-size:15px;margin:18px 0 6px}.mut{color:var(--mut);font-size:14px}.chip{display:inline-block;border-radius:999px;padding:3px 12px;font-size:13px;background:#FFF1E5;color:#B85A0F;margin:2px 4px 2px 0}
a{color:#B85A0F}label{display:block;font-size:13px;color:var(--mid);margin:12px 0 4px}input[type=text],input[type=email],input[type=tel],select{width:100%;padding:10px 12px;border:1px solid var(--rule);border-radius:12px;font:inherit}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:560px){.row{grid-template-columns:1fr}}.ck{display:flex;gap:8px;align-items:flex-start;font-size:13px;margin-top:12px}
button{background:var(--o);color:#fff;border:0;border-radius:12px;padding:12px 20px;font:inherit;font-weight:500;cursor:pointer;margin-top:16px}button:disabled{opacity:.6}
.list a{display:block;text-decoration:none;color:inherit}.list .card:hover{border-color:var(--o)}pre{white-space:pre-wrap;font:inherit;margin:0}.ok{color:#2E7D4F}.err{color:#C0392B}
</style></head><body><main><header><img src="/brand/almacis/almacis-logo.png" alt="Almacis"></header>${body}</main></body></html>`;
  const para = t => `<pre>${esc(t)}</pre>`;

  // script delle pagine pubbliche (la CSP non permette script in linea)
  const PUB_JS = { lavora: "document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('button'),m=document.getElementById('msg'),f=document.getElementById('cv').files[0];\nif(!f||f.size>5*1024*1024){m.textContent='Il CV deve essere al massimo 5 MB.';m.className='err';return}b.disabled=true;m.textContent='Invio in corso…';m.className='mut';\nconst r=new FileReader();r.onload=async()=>{const base64=String(r.result).split(',')[1];const v=id=>document.getElementById(id).value.trim();\ntry{const res=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nome:v('nome'),cognome:v('cognome'),email:v('email'),telefono:v('telefono'),sesso:v('sesso'),consenso:document.getElementById('consenso').checked,conserva:document.getElementById('conserva').checked,cv:{nome:f.name,mime:f.type||'application/pdf',base64}})});\nconst j=await res.json().catch(()=>({}));if(res.ok){e.target.innerHTML='<h2 class=\"ok\" style=\"margin-top:0\">Grazie, abbiamo ricevuto la tua candidatura.</h2><p>Ti scriveremo all\\'indirizzo che hai indicato.</p>'}else{m.textContent=j.error||'Invio non riuscito, riprova.';m.className='err';b.disabled=false}}\ncatch{m.textContent='Invio non riuscito, riprova.';m.className='err';b.disabled=false}};r.readAsDataURL(f)});", benvenuto: "const rd=f=>new Promise((ok,ko)=>{const r=new FileReader();r.onload=()=>ok({nome:f.name,mime:f.type||'application/pdf',base64:String(r.result).split(',')[1]});r.onerror=ko;r.readAsDataURL(f)});\ndocument.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();const m=document.getElementById('msg'),b=e.target.querySelector('button');const fs=[...document.getElementById('doc').files];\nif(fs.some(f=>f.size>5*1024*1024)){m.textContent='Ogni file al massimo 5 MB.';m.className='err';return}b.disabled=true;m.textContent='Invio in corso…';const v=id=>document.getElementById(id).value.trim();\ntry{const files=await Promise.all(fs.map(rd));const res=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({documenti:files,taglie:{giacca:v('giacca'),scarpe:v('scarpe'),casco:v('casco'),pantaloni:v('pantaloni')}})});\nconst j=await res.json().catch(()=>({}));if(res.ok){m.textContent='Ricevuto, grazie! Puoi tornare qui se ti manca qualcosa.';m.className='ok';setTimeout(()=>location.reload(),1500)}else{m.textContent=j.error||'Invio non riuscito.';m.className='err';b.disabled=false}}catch{m.textContent='Invio non riuscito.';m.className='err';b.disabled=false}});" };
  app.get('/lavora-con-noi.js', (_req, res) => res.type('application/javascript').set('Cache-Control', 'no-cache').send(PUB_JS.lavora));
  app.get('/benvenuto.js', (_req, res) => res.type('application/javascript').set('Cache-Control', 'no-cache').send(PUB_JS.benvenuto));
  app.get('/lavora-con-noi', async (_req, res) => {
    noStore(res);
    const { rows: raw } = await db.query(`SELECT p.slug, p.titolo, p.ral_min, p.ral_max, r.sede, r.contratto, r.role_id FROM hr_postings p JOIN hr_requisitions r ON r.id = p.req_id
      WHERE p.pubblicato AND r.stato = 'approvata' ORDER BY p.published_at DESC`);
    const rows = await Promise.all(raw.map(liveBand));
    res.type('html').send(shell('Lavora con noi · Almacis', `<h1>Lavora con noi</h1><p class="mut">Le posizioni aperte in Almacis. Ogni annuncio dice la fascia di retribuzione.</p>
<div class="list">${rows.length ? rows.map(p => `<a href="/lavora-con-noi/${esc(p.slug)}"><div class="card"><b style="color:var(--ink)">${esc(p.titolo)}</b><div class="mut">${esc(p.sede || 'Almacis')} · RAL ${p.ral_min?.toLocaleString('it-IT')} – ${p.ral_max?.toLocaleString('it-IT')} €</div></div></a>`).join('') : '<div class="card">Al momento non ci sono posizioni aperte.</div>'}</div>`));
  });
  async function liveBand(p) {
    if (!p.role_id) return p;
    const { band } = await roleAndBand(p.role_id);
    return band ? { ...p, ral_min: Math.round(band.min * 1000), ral_max: Math.round(band.max * 1000) } : p;
  }
  async function postingBySlug(slug) {
    const { rows: [p] } = await db.query(`SELECT p.*, r.sede, r.contratto, r.da_quando, r.stato, r.id AS req_id, r.role_id FROM hr_postings p JOIN hr_requisitions r ON r.id = p.req_id
      WHERE p.slug = $1 AND p.pubblicato AND r.stato = 'approvata'`, [String(slug)]);
    return p ? liveBand(p) : null;
  }
  app.get('/lavora-con-noi/:slug', async (req, res) => {
    noStore(res);
    const p = await postingBySlug(req.params.slug);
    if (!p) return res.status(404).type('html').send(shell('Posizione non disponibile · Almacis', '<div class="card"><h1>Posizione non più disponibile</h1><p><a href="/lavora-con-noi">Vedi le posizioni aperte</a></p></div>'));
    const t = p.testo || {};
    const contr = { TI: 'tempo indeterminato', TD: 'tempo determinato', APPR: 'apprendistato' }[p.contratto] || p.contratto;
    res.type('html').send(shell(`${p.titolo} · Almacis`, `<div class="card"><h1>${esc(p.titolo)}</h1><div class="mut">Almacis · ${esc(p.sede || '')} · ${esc(contr)}${p.da_quando ? ` · ingresso ${esc(p.da_quando)}` : ''}</div>
<div style="margin:12px 0"><span class="chip">RAL ${p.ral_min?.toLocaleString('it-IT')} – ${p.ral_max?.toLocaleString('it-IT')} € lordi annui</span>${p.variabile ? `<span class="chip">premio variabile ${esc(p.variabile)}</span>` : ''}</div>
${t.scopo ? `<h2>Il ruolo</h2>${para(t.scopo)}` : ''}${t.cosa ? `<h2>Cosa farai</h2>${para(t.cosa)}` : ''}${t.requisiti ? `<h2>Cosa cerchiamo</h2>${para(t.requisiti)}` : ''}${t.crescita ? `<h2>Come crescerai</h2>${para(t.crescita)}` : ''}</div>
<form class="card" id="f"><h2 style="margin-top:0">Candidati</h2><div class="row"><div><label for="nome">Nome</label><input type="text" id="nome" name="nome" required maxlength="80"></div>
<div><label for="cognome">Cognome</label><input type="text" id="cognome" name="cognome" required maxlength="80"></div></div>
<div class="row"><div><label for="email">Email</label><input type="email" id="email" name="email" required maxlength="200"></div><div><label for="telefono">Telefono</label><input type="tel" id="telefono" name="telefono" maxlength="40"></div></div>
<label for="cv">CV (PDF o Word, al massimo 5 MB)</label><input type="file" id="cv" accept=".pdf,.doc,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required>
<label for="sesso">Genere (facoltativo: serve solo alle statistiche di equità delle offerte)</label><select id="sesso"><option value="">Preferisco non dirlo</option><option value="F">Donna</option><option value="M">Uomo</option></select>
<div class="ck"><input type="checkbox" id="consenso" required><label for="consenso" style="margin:0">Ho letto l'informativa: Almacis tratta i miei dati solo per questa selezione. (obbligatorio)</label></div>
<div class="ck"><input type="checkbox" id="conserva"><label for="conserva" style="margin:0">Potete conservare il mio CV per 24 mesi e ricontattarmi per altre posizioni.</label></div>
<p class="mut" style="font-size:12px">Non chiediamo la retribuzione attuale né dati come età o stato civile. Il CV di chi non viene assunto si cancella da solo: alla chiusura della selezione, o dopo 24 mesi se scegli di farcelo conservare.</p>
<button type="submit">Invia la candidatura</button><p id="msg" class="mut"></p></form>
<script src="/lavora-con-noi.js"></script>`));
  });
  app.post('/lavora-con-noi/:slug', publicLimit, express.json({ limit: '8mb' }), async (req, res) => {
    const p = await postingBySlug(req.params.slug);
    if (!p) throw new HttpError(404, 'Posizione non più disponibile');
    const c = candBody(req.body || {});
    if (!c.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) throw new HttpError(400, 'Scrivi un indirizzo email valido');
    if (req.body.consenso !== true) throw new HttpError(400, 'Per candidarti serve il consenso al trattamento dei dati');
    const file = readFile(req.body.cv, 'CV');
    if (!file) throw new HttpError(400, 'Allega il CV');
    const out = await db.tx(q => addCandidate(q, { ...c, consenso: true, conserva: req.body.conserva === true, file, reqId: p.req_id, fonte: 'pagina' }));
    const { role } = await roleAndBand(p.role_id);
    if (role) matchCv(file, role).then(m => (m ? db.query('UPDATE hr_applications SET match_pct = $1, match_note = $2 WHERE id = $3', [m.pct, m.note, out.app_id]) : null)).catch(() => {});
    await notify(await usersWithRole('hr'), null, `nuova candidatura per «${p.titolo}» dalla pagina «Lavora con noi».`, `/hr/candidato/${out.app_id}`);
    res.json({ ok: true });
  });

  // ── scheda del candidato (tavola W) ──
  async function appRow(id) {
    const { rows: [a] } = await db.query(`SELECT a.*, c.nome, c.cognome, c.email, c.telefono, c.consenso, c.conserva, c.conservare_fino::text AS conservare_fino,
        r.posizione, r.role_id, r.area_id, r.requested_by, r.stato AS req_stato, r.incarico_id, r.contratto AS req_contratto, ab.name AS caricato_da
      FROM hr_applications a JOIN hr_candidates c ON c.id = a.candidate_id JOIN hr_requisitions r ON r.id = a.req_id LEFT JOIN users ab ON ab.id = a.added_by WHERE a.id = $1`, [id]);
    if (!a) throw new HttpError(404, 'Candidatura non trovata');
    return a;
  }
  async function appAccess(req, a) {
    if (isHr(req)) return 'hr';
    if (a.requested_by === req.user.id || (a.added_by && a.added_by === req.user.id)) return 'responsabile';
    if (a.area_id && req.user.id === (await areaHead(a.area_id))) return 'responsabile';
    const { rows: [i] } = await db.query('SELECT 1 FROM hr_interviews WHERE app_id = $1 AND lower(interviewer_email) = $2', [a.id, req.user.email.toLowerCase()]);
    if (i) return 'intervistatore';
    const { rows: [o] } = await db.query("SELECT id FROM hr_offers WHERE app_id = $1 AND stato = 'approvazione' ORDER BY id DESC LIMIT 1", [a.id]);
    if (o) { const p = pending(await steps('offerta', o.id)); if (p && await canDecide(req, p, a)) return 'approvatore'; }
    const { rows: [dec] } = await db.query("SELECT 1 FROM hr_approvals s JOIN hr_offers f ON f.id = s.oggetto_id WHERE s.oggetto = 'offerta' AND f.app_id = $1 AND s.user_id = $2 LIMIT 1", [a.id, req.user.id]);
    return dec ? 'approvatore' : null;
  }
  const addEvent = (appId, userId, testo) => db.query('INSERT INTO hr_app_events (app_id, user_id, testo) VALUES ($1, $2, $3)', [appId, userId, testo]);

  app.get('/api/hr/candidature/:id', async (req, res) => {
    const a = await appRow(v.int(req.params.id, 'id', { min: 1 }));
    const acc = await appAccess(req, a);
    if (!acc) throw new HttpError(403, 'Non puoi vedere questo candidato');
    const { role, band, grid } = await roleAndBand(a.role_id);
    const [files, events, interviews, scores, offers] = await Promise.all([
      db.query('SELECT id, tipo, nome, mime, size, created_at FROM hr_files WHERE candidate_id = $1 ORDER BY created_at', [a.candidate_id]),
      db.query('SELECT e.at, e.testo, u.name AS chi FROM hr_app_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.app_id = $1 ORDER BY e.at', [a.id]),
      db.query('SELECT i.id, i.tipo, i.interviewer_email, i.quando, i.join_url, u.name FROM hr_interviews i LEFT JOIN users u ON lower(u.email) = lower(i.interviewer_email) WHERE i.app_id = $1 ORDER BY i.quando NULLS LAST', [a.id]),
      db.query('SELECT email, competenza, voto, nota FROM hr_scores WHERE app_id = $1', [a.id]),
      db.query('SELECT * FROM hr_offers WHERE app_id = $1 ORDER BY id DESC', [a.id]),
    ]);
    const items = R.scorecardItems(role);
    const sv = R.scoreView(scores.rows, interviews.rows.map(i => i.interviewer_email), req.user.email);
    if (acc !== 'hr') await hrLog(req, 'scheda candidato', { kind: 'accesso', after: { candidatura: a.id } });
    const offer = offers.rows[0] || null;
    let canSeeRal = acc === 'hr' || acc === 'approvatore';
    if (!canSeeRal && offer && offer.stato === 'approvazione') { const p0 = pending(await steps('offerta', offer.id)); canSeeRal = Boolean(p0 && await canDecide(req, p0, a)); }
    let offerOut = null;
    if (offer) {
      const st = await steps('offerta', offer.id);
      const oc = R.offerChain(offer.ral, band);
      offerOut = canSeeRal ? { ...offer, zona: oc.zona, catena: st.map(s => ({ ...s, label: RUOLI_LABEL[s.ruolo] })) } : { id: offer.id, stato: offer.stato, zona: oc.zona };
      if (canSeeRal) {
        const peers = (await hrMod().loadPeople(db, { withPay: true })).filter(p => p.role_id === a.role_id && p.ral && !p.esclusione).map(p => H.fte(p.ral, p.part_time_pct));
        offerOut.equita = R.equity(offer.ral, peers);
        const p = pending(st);
        offerOut.passo = p && offer.stato === 'approvazione' ? { ...p, label: RUOLI_LABEL[p.ruolo], tocca_a_me: await canDecide(req, p, a) } : null;
      }
    }
    const { rows: [pre] } = await db.query('SELECT id FROM hr_preboarding WHERE app_id = $1', [a.id]);
    res.json({
      accesso: acc, candidatura: { id: a.id, stage: a.stage, fonte: a.fonte, fonte_label: a.fonte === 'hr' ? `CV caricato in Alma${a.caricato_da ? ` da ${a.caricato_da}` : ''}` : R.FONTI[a.fonte], match_pct: a.match_pct, match_note: a.match_note, motivo_scarto: a.motivo_scarto, created_at: a.created_at, req_id: a.req_id, posizione: a.posizione },
      candidato: acc === 'hr' ? { nome: a.nome, cognome: a.cognome, email: a.email, telefono: a.telefono, consenso: a.consenso, conserva: a.conserva, conservare_fino: a.conservare_fino } : { nome: a.nome, cognome: a.cognome },
      ruolo: role ? { id: role.id, title: H.roleTitle(role), grade: role.grade } : null, band: canSeeRal ? band : null,
      variabile: canSeeRal && role && grid.rules.variabile?.[role.grade] ? `${grid.rules.variabile[role.grade][0]}–${grid.rules.variabile[role.grade][1]}%` : null,
      files: ['hr', 'intervistatore', 'responsabile'].includes(acc) ? files.rows : [], storia: acc === 'hr' || acc === 'responsabile' ? events.rows : [],
      colloqui: interviews.rows, scorecard: { voci: items, ...sv, io: req.user.email.toLowerCase(), posso_votare: interviews.rows.some(i => i.interviewer_email.toLowerCase() === req.user.email.toLowerCase()) },
      offerta: offerOut, preboarding_id: pre?.id || null, stages: R.STAGES, fonti: R.FONTI,
    });
  });

  app.patch('/api/hr/candidature/:id', async (req, res) => {
    hrOnly(req);
    const a = await appRow(v.int(req.params.id, 'id', { min: 1 }));
    const stage = v.oneOf(req.body.stage, 'passo', R.STAGES.map(s => s[0]).filter(s => s !== 'accettata'));
    const motivo = v.text(req.body.motivo_scarto, 'motivo', { max: 500 }) || '';
    if (stage === 'scartata' && !motivo) throw new HttpError(400, 'Scrivi il motivo dello scarto');
    await db.query(`UPDATE hr_applications SET stage = $1, motivo_scarto = $2, passi = CASE WHEN $1 = ANY(passi) THEN passi ELSE array_append(passi, $1) END, updated_at = now() WHERE id = $3`, [stage, motivo, a.id]);
    await addEvent(a.id, req.user.id, stage === 'scartata' ? `scartato: ${motivo}` : `passa a «${R.STAGES.find(s => s[0] === stage)[1]}»`);
    res.json({ ok: true, risposta: stage === 'scartata' ? `Gentile ${a.nome},\n\ngrazie per l'interesse verso Almacis e per il tempo dedicato alla selezione per «${a.posizione}». Abbiamo scelto di proseguire con altri profili${a.conserva ? ', ma conserveremo il tuo CV per ricontattarti se si aprirà una posizione adatta' : ''}.\n\nUn cordiale saluto,\nUfficio Risorse Umane · Almacis` : null });
  });

  app.delete('/api/hr/candidature/:id/candidato', async (req, res) => {
    hrOnly(req);
    const a = await appRow(v.int(req.params.id, 'id', { min: 1 }));
    if (a.stage === 'accettata') throw new HttpError(400, "La persona è stata assunta: i suoi dati restano per l'assunzione");
    await db.query('DELETE FROM hr_candidates WHERE id = $1', [a.candidate_id]);
    await hrLog(req, 'candidato cancellato su richiesta', { after: { candidatura: a.id } });
    res.json({ ok: true, req_id: a.req_id });
  });

  app.post('/api/hr/candidature/:id/match', async (req, res) => {
    hrOnly(req);
    const a = await appRow(v.int(req.params.id, 'id', { min: 1 }));
    const { role } = await roleAndBand(a.role_id);
    const { rows: [f] } = await db.query("SELECT nome, mime, data FROM hr_files WHERE candidate_id = $1 AND tipo = 'cv' ORDER BY id DESC LIMIT 1", [a.candidate_id]);
    if (!f || !role) throw new HttpError(400, 'Servono il CV e il ruolo della posizione');
    const m = await matchCv(f, role);
    if (!m) throw new HttpError(400, 'Il CV non si riesce a leggere');
    await db.query('UPDATE hr_applications SET match_pct = $1, match_note = $2 WHERE id = $3', [m.pct, m.note, a.id]);
    res.json(m);
  });

  app.get('/api/hr/file/:id', async (req, res) => {
    const { rows: [f] } = await db.query('SELECT f.*, (SELECT a.id FROM hr_applications a WHERE a.candidate_id = f.candidate_id ORDER BY a.id DESC LIMIT 1) AS app_id FROM hr_files f WHERE f.id = $1', [v.int(req.params.id, 'id', { min: 1 })]);
    if (!f) throw new HttpError(404, 'File non trovato');
    if (!isHr(req)) {
      const { rows } = await db.query('SELECT a.id FROM hr_applications a WHERE a.candidate_id = $1', [f.candidate_id]);
      let ok = false;
      for (const x of rows) { const acc = await appAccess(req, await appRow(x.id)); if (acc && acc !== 'approvatore' && f.tipo === 'cv') ok = true; }
      if (!ok) throw new HttpError(403, 'Non puoi aprire questo file');
    }
    await hrLog(req, `file del candidato (${f.tipo})`, { kind: 'accesso', after: { file: f.id } });
    res.set('Content-Type', f.mime).set('Content-Disposition', `inline; filename="${encodeURIComponent(f.nome)}"`).set('Cache-Control', 'no-store').send(f.data);
  });

  // colloqui: invito Outlook con Teams dal calendario di chi lo fissa (se Microsoft è collegato)
  app.post('/api/hr/candidature/:id/colloqui', async (req, res) => {
    hrOnly(req);
    const a = await appRow(v.int(req.params.id, 'id', { min: 1 }));
    const tipo = v.oneOf(req.body.tipo || 'hr', 'tipo', ['hr', 'tecnico']);
    const email = (v.text(req.body.interviewer_email, 'intervistatore', { max: 200, required: true }) || '').toLowerCase();
    const quando = req.body.quando ? new Date(String(req.body.quando)) : null;
    if (quando && isNaN(quando)) throw new HttpError(400, 'Data del colloquio non valida');
    let outlookId = null, joinUrl = null, avviso = null;
    if (quando && req.body.outlook !== false && auth?.msConfigured) {
      try {
        const { graph, TIMEZONE } = require('../lib/graph');
        const token = await auth.graphToken(req.user.id);
        const end = new Date(quando.getTime() + 60 * 60000);
        const local = d => d.toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace(' ', 'T');
        const ev = await graph(token, 'POST', '/me/events', { headers: { Prefer: `outlook.timezone="${TIMEZONE}"` }, body: {
          subject: `Colloquio ${tipo === 'hr' ? 'HR' : 'tecnico'} · ${a.nome} ${a.cognome} · ${a.posizione}`,
          start: { dateTime: local(quando), timeZone: TIMEZONE }, end: { dateTime: local(end), timeZone: TIMEZONE },
          attendees: [email, a.email].filter(Boolean).map(x => ({ type: 'required', emailAddress: { address: x } })),
          isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness',
        } });
        outlookId = ev.id; joinUrl = ev.onlineMeeting?.joinUrl || null;
      } catch (err) { avviso = `Invito Outlook non creato: ${err.message}`; }
    } else if (quando && !auth?.msConfigured) avviso = 'Microsoft non è collegato: invito Outlook non creato.';
    await db.query('INSERT INTO hr_interviews (app_id, tipo, interviewer_email, quando, outlook_id, join_url) VALUES ($1, $2, $3, $4, $5, $6)', [a.id, tipo, email, quando, outlookId, joinUrl]);
    const next = tipo === 'hr' ? 'colloquio_hr' : 'colloquio_tecnico';
    await db.query(`UPDATE hr_applications SET stage = CASE WHEN stage IN ('nuovi','screening','colloquio_hr') THEN $1 ELSE stage END, passi = CASE WHEN $1 = ANY(passi) THEN passi ELSE array_append(passi, $1) END, updated_at = now() WHERE id = $2`, [next, a.id]);
    await addEvent(a.id, req.user.id, `colloquio ${tipo === 'hr' ? 'HR' : 'tecnico'} con ${email}${quando ? ` il ${quando.toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' })}` : ''}`);
    const { rows: [u] } = await db.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
    if (u) await notify([u.id], req.user.id, `ti ha chiesto un colloquio con ${a.nome} ${a.cognome} (${a.posizione}): la scorecard è nella scheda.`, `/hr/candidato/${a.id}`);
    res.json({ ok: true, avviso, join_url: joinUrl });
  });

  app.put('/api/hr/candidature/:id/voti', async (req, res) => {
    const a = await appRow(v.int(req.params.id, 'id', { min: 1 }));
    const me = req.user.email.toLowerCase();
    const { rows: [i] } = await db.query('SELECT 1 FROM hr_interviews WHERE app_id = $1 AND lower(interviewer_email) = $2', [a.id, me]);
    if (!i) throw new HttpError(403, 'Vota chi ha fatto il colloquio');
    const { role } = await roleAndBand(a.role_id);
    const allowed = new Set(R.scorecardItems(role));
    const voti = Array.isArray(req.body.voti) ? req.body.voti : [];
    for (const x of voti) {
      if (!allowed.has(x.competenza)) continue;
      const voto = v.int(x.voto, 'voto', { min: 1, max: 5 });
      await db.query(`INSERT INTO hr_scores (app_id, email, competenza, voto, nota) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (app_id, email, competenza) DO UPDATE SET voto = EXCLUDED.voto, nota = EXCLUDED.nota, updated_at = now()`, [a.id, me, x.competenza, voto, v.text(String(x.nota || ''), 'nota', { max: 500 }) || '']);
    }
    await addEvent(a.id, req.user.id, 'scorecard compilata');
    res.json({ ok: true });
  });

  // ── offerta (tavola X) ──
  app.post('/api/hr/candidature/:id/offerta', async (req, res) => {
    hrOnly(req);
    const a = await appRow(v.int(req.params.id, 'id', { min: 1 }));
    const ral = v.int(req.body.ral, 'RAL', { min: 10000, max: 400000 });
    if (!ral) throw new HttpError(400, 'Scrivi la RAL');
    const f = { ral, ingresso: v.date(req.body.ingresso, 'ingresso') || null, contratto: v.oneOf(req.body.contratto || a.req_contratto || 'TI', 'contratto', ['TI', 'TD', 'APPR', 'STAFF_LEASING', 'TIROCINIO']),
      ccnl_livello: v.text(req.body.ccnl_livello, 'CCNL', { max: 80 }) || '', benefit: v.text(req.body.benefit, 'benefit', { max: 500 }) || '',
      prova_mesi: v.int(req.body.prova_mesi ?? 6, 'prova', { min: 0, max: 12 }), motivo: v.text(req.body.motivo, 'motivo', { max: 2000 }) || '' };
    const { rows: [cur] } = await db.query("SELECT id, stato FROM hr_offers WHERE app_id = $1 ORDER BY id DESC LIMIT 1", [a.id]);
    let id;
    if (cur && cur.stato === 'bozza') {
      await db.query('UPDATE hr_offers SET ral=$1, ingresso=$2, contratto=$3, ccnl_livello=$4, benefit=$5, prova_mesi=$6, motivo=$7, updated_at=now() WHERE id=$8', [...Object.values(f), cur.id]);
      id = cur.id;
    } else {
      ({ rows: [{ id }] } = await db.query('INSERT INTO hr_offers (app_id, ral, ingresso, contratto, ccnl_livello, benefit, prova_mesi, motivo, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [a.id, ...Object.values(f), req.user.id]));
    }
    await db.query(`UPDATE hr_applications SET stage = 'offerta', passi = CASE WHEN 'offerta' = ANY(passi) THEN passi ELSE array_append(passi, 'offerta') END, updated_at = now() WHERE id = $1`, [a.id]);
    const { band } = await roleAndBand(a.role_id);
    const oc = R.offerChain(ral, band);
    const peers = (await hrMod().loadPeople(db, { withPay: true })).filter(p => p.role_id === a.role_id && p.ral && !p.esclusione).map(p => H.fte(p.ral, p.part_time_pct));
    res.json({ id, band, zona: oc.zona, catena: oc.chain.map(k => RUOLI_LABEL[k]), fuori: Boolean(oc.fuori), equita: R.equity(ral, peers) });
  });
  async function offerRow(id) {
    const { rows: [o] } = await db.query(`SELECT o.*, a.req_id, a.candidate_id, r.posizione, r.area_id, r.requested_by, r.role_id, c.nome, c.cognome, c.email
      FROM hr_offers o JOIN hr_applications a ON a.id = o.app_id JOIN hr_requisitions r ON r.id = a.req_id JOIN hr_candidates c ON c.id = a.candidate_id WHERE o.id = $1`, [id]);
    if (!o) throw new HttpError(404, 'Offerta non trovata');
    return o;
  }
  app.post('/api/hr/offerte/:id/invia', async (req, res) => {
    hrOnly(req);
    const o = await offerRow(v.int(req.params.id, 'id', { min: 1 }));
    if (o.stato !== 'bozza') throw new HttpError(400, 'L\'offerta è già stata inviata');
    const { band } = await roleAndBand(o.role_id);
    const oc = R.offerChain(o.ral, band);
    if (oc.fuori && !o.motivo) throw new HttpError(400, 'Fuori fascia serve il motivo scritto per la Direzione');
    await db.tx(async q => {
      await q.query("DELETE FROM hr_approvals WHERE oggetto = 'offerta' AND oggetto_id = $1", [o.id]);
      for (const [i, ruolo] of oc.chain.entries()) {
        // il primo passo è del team HR: chi la invia la approva
        if (ruolo === 'hr') await q.query("INSERT INTO hr_approvals (oggetto, oggetto_id, ordine, ruolo, decisione, user_id, decided_at) VALUES ('offerta', $1, $2, 'hr', 'ok', $3, now())", [o.id, i + 1, req.user.id]);
        else await q.query("INSERT INTO hr_approvals (oggetto, oggetto_id, ordine, ruolo) VALUES ('offerta', $1, $2, $3)", [o.id, i + 1, ruolo]);
      }
      await q.query(`UPDATE hr_offers SET stato = $1, updated_at = now() WHERE id = $2`, [oc.chain.length === 1 ? 'approvata' : 'approvazione', o.id]);
    });
    await addEvent(o.app_id, req.user.id, `offerta ${oc.chain.length === 1 ? 'approvata (dentro il riferimento)' : 'inviata per approvazione'}`);
    const p = pending(await steps('offerta', o.id));
    if (p) await notify(await approversFor(p, o), req.user.id, `chiede di approvare l'offerta per «${o.posizione}» (${oc.zona}).`, `/hr/candidato/${o.app_id}`);
    res.json({ ok: true, stato: oc.chain.length === 1 ? 'approvata' : 'approvazione' });
  });
  app.post('/api/hr/offerte/:id/decidi', async (req, res) => {
    const o = await offerRow(v.int(req.params.id, 'id', { min: 1 }));
    if (o.stato !== 'approvazione') throw new HttpError(400, 'L\'offerta non è in approvazione');
    await decide(req, 'offerta', o.id, o,
      async () => { await db.query("UPDATE hr_offers SET stato = 'approvata', updated_at = now() WHERE id = $1", [o.id]); await addEvent(o.app_id, req.user.id, 'offerta approvata'); await notify(await usersWithRole('hr'), req.user.id, `ha approvato l'offerta per «${o.posizione}».`, `/hr/candidato/${o.app_id}`); },
      async m => { await db.query("UPDATE hr_offers SET stato = 'respinta', updated_at = now() WHERE id = $1", [o.id]); await addEvent(o.app_id, req.user.id, `offerta respinta: ${m}`); },
      async m => { await db.query("UPDATE hr_offers SET stato = 'bozza', updated_at = now() WHERE id = $1", [o.id]); await addEvent(o.app_id, req.user.id, `offerta da rivedere: ${m}`); });
    res.json({ ok: true, stato: (await offerRow(o.id)).stato });
  });
  app.get('/api/hr/offerte/:id/lettera.docx', async (req, res) => {
    hrOnly(req);
    const o = await offerRow(v.int(req.params.id, 'id', { min: 1 }));
    if (!['approvata', 'inviata', 'accettata'].includes(o.stato)) throw new HttpError(400, 'La lettera si prepara quando l\'offerta è approvata');
    const { role, grid } = await roleAndBand(o.role_id);
    const vb = role && grid.rules.variabile?.[role.grade];
    const { rows: [ar] } = await db.query('SELECT nome FROM org_aree WHERE id = $1', [o.area_id]);
    const buf = R.offerLetterDocx({ candidato: `${o.nome} ${o.cognome}`, ruolo: role ? H.roleTitle(role) : o.posizione, area: ar?.nome, oggi: todayIso(),
      offerta: { ...o, ingresso: o.ingresso ? new Date(o.ingresso).toISOString().slice(0, 10) : null, variabile: vb ? `${vb[0]}–${vb[1]}%` : '' }, firmatario: req.user.name });
    await hrLog(req, 'lettera d\'offerta', { kind: 'accesso', after: { offerta: o.id } });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').set('Content-Disposition', `attachment; filename="offerta-${encodeURIComponent(o.cognome)}.docx"`).send(buf);
  });
  app.post('/api/hr/offerte/:id/esito', async (req, res) => {
    hrOnly(req);
    const o = await offerRow(v.int(req.params.id, 'id', { min: 1 }));
    const esito = v.oneOf(req.body.esito, 'esito', ['inviata', 'accettata', 'rifiutata']);
    if (!['approvata', 'inviata'].includes(o.stato)) throw new HttpError(400, 'Prima l\'offerta va approvata');
    const motivo = v.text(req.body.motivo, 'motivo', { max: 500 }) || '';
    if (esito === 'rifiutata' && !motivo) throw new HttpError(400, 'Scrivi perché il candidato ha rifiutato');
    await db.query('UPDATE hr_offers SET stato = $1, motivo_rifiuto = $2, updated_at = now() WHERE id = $3', [esito, motivo, o.id]);
    let pre = null;
    if (esito === 'accettata') {
      const ingresso = o.ingresso ? new Date(o.ingresso).toISOString().slice(0, 10) : R.addDays(todayIso(), 30);
      await db.tx(async q => {
        await q.query(`UPDATE hr_applications SET stage = 'accettata', passi = CASE WHEN 'accettata' = ANY(passi) THEN passi ELSE array_append(passi, 'accettata') END, updated_at = now() WHERE id = $1`, [o.app_id]);
        await q.query("UPDATE hr_requisitions SET stato = 'coperta', closed_at = now() WHERE id = $1", [o.req_id]);
        await q.query('UPDATE hr_postings SET pubblicato = false WHERE req_id = $1', [o.req_id]);
        // il candidato assunto non va cancellato con gli altri
        await q.query('UPDATE hr_candidates SET conservare_fino = NULL, conserva = true WHERE id = $1', [o.candidate_id]);
        const { rows: [p] } = await q.query('INSERT INTO hr_preboarding (app_id, token, ingresso) VALUES ($1, $2, $3) ON CONFLICT (app_id) DO UPDATE SET ingresso = EXCLUDED.ingresso RETURNING id', [o.app_id, crypto.randomBytes(18).toString('base64url'), ingresso]);
        const { rows: [has] } = await q.query('SELECT count(*)::int AS n FROM hr_pre_tasks WHERE pre_id = $1', [p.id]);
        if (!has.n) for (const [i, [titolo, chi, giorni]] of R.PRE_TASKS.entries()) await q.query('INSERT INTO hr_pre_tasks (pre_id, ordine, titolo, chi, giorni) VALUES ($1, $2, $3, $4, $5)', [p.id, i + 1, titolo, chi, giorni]);
        pre = p.id;
      });
      if (o.requested_by) await notify([o.requested_by], req.user.id, `${o.nome} ${o.cognome} ha accettato l'offerta per «${o.posizione}»: parte il pre-boarding.`, `/hr/preboarding/${pre}`);
      // la persona va a BOSS per creare l'anagrafica del personale (ALM2-63)
      await sendToBoss(db, pre, bossOpts()).catch(err => console.warn('[hr] invio a BOSS non riuscito', err.message));
    }
    await addEvent(o.app_id, req.user.id, `offerta ${esito}${motivo ? `: ${motivo}` : ''}`);
    const altri = esito === 'accettata' ? (await db.query("SELECT a.id, c.nome, c.cognome FROM hr_applications a JOIN hr_candidates c ON c.id = a.candidate_id WHERE a.req_id = $1 AND a.id <> $2 AND a.stage NOT IN ('scartata')", [o.req_id, o.app_id])).rows : [];
    res.json({ ok: true, preboarding_id: pre, da_avvisare: altri });
  });

  // ── pre-boarding (tavola Y) ──
  async function checkArrivals() {
    const { rows } = await db.query(`SELECT p.id, p.app_id, p.boss_id, lower(c.email) AS email, lower(c.nome) AS nome, lower(c.cognome) AS cognome, r.incarico_id, r.id AS req_id FROM hr_preboarding p JOIN hr_applications a ON a.id = p.app_id
      JOIN hr_candidates c ON c.id = a.candidate_id JOIN hr_requisitions r ON r.id = a.req_id WHERE p.stato = 'aperto'`);
    for (const p of rows) {
      // su BOSS la persona ha l'email aziendale, non quella della candidatura: si cerca per l'id che BOSS ha dato all'invio,
      // poi per email e per nome e cognome
      const { rows: [hp] } = await db.query(`SELECT key, lower(email) AS email FROM hr_people WHERE attivo AND ((boss_id = $4 AND $4 IS NOT NULL) OR email = $1 OR (lower(nome) = $2 AND lower(cognome) = $3))
        ORDER BY (boss_id = $4 AND $4 IS NOT NULL) DESC, (email = $1) DESC, data_assunzione DESC NULLS LAST LIMIT 1`, [p.email, p.nome, p.cognome, p.boss_id || null]);
      if (!hp) continue;
      const { rows: [inc] } = p.incarico_id ? await db.query('SELECT 1 FROM org_incarichi WHERE id = $1 AND lower(ricoperto_da) = ANY($2)', [p.incarico_id, [p.email, hp.email].filter(Boolean)]) : { rows: [true] };
      await db.query("UPDATE hr_pre_tasks SET fatto = true, fatto_at = now() WHERE pre_id = $1 AND chi = 'boss' AND NOT fatto", [p.id]);
      if (inc) {
        await db.query("UPDATE hr_preboarding SET stato = 'arrivato', arrived_at = now() WHERE id = $1", [p.id]);
        // Fase 4: parte l'inserimento, con la data d'ingresso e i mesi di prova dell'offerta
        const { rows: [x] } = await db.query('SELECT p.ingresso::text AS ingresso, (SELECT o.prova_mesi FROM hr_offers o WHERE o.app_id = p.app_id ORDER BY o.id DESC LIMIT 1) AS prova FROM hr_preboarding p WHERE p.id = $1', [p.id]);
        await require('./hr-onb').createOnboarding(db, { personKey: hp.key, inizio: x.ingresso, preboardingId: p.id, provaMesi: x.prova || null, notifier }).catch(err => console.warn('[hr] inserimento non avviato', err.message));
      }
    }
  }
  registerHrRec.checkArrivals = checkArrivals;
  const preRow = async id => {
    const { rows: [p] } = await db.query(`SELECT p.*, p.ingresso::text AS ingresso, a.req_id, a.candidate_id, c.nome, c.cognome, c.email, c.telefono, r.posizione, r.requested_by, r.incarico_id, r.contratto,
        i.nome AS incarico_nome, ar.nome AS area_nome, o.ral, o.ccnl_livello, o.contratto AS offerta_contratto
      FROM hr_preboarding p JOIN hr_applications a ON a.id = p.app_id JOIN hr_candidates c ON c.id = a.candidate_id JOIN hr_requisitions r ON r.id = a.req_id
      LEFT JOIN org_incarichi i ON i.id = r.incarico_id LEFT JOIN org_aree ar ON ar.id = r.area_id
      LEFT JOIN LATERAL (SELECT * FROM hr_offers WHERE app_id = a.id ORDER BY id DESC LIMIT 1) o ON true WHERE p.id = $1`, [id]);
    if (!p) throw new HttpError(404, 'Pre-boarding non trovato');
    return p;
  };
  app.get('/api/hr/preboarding', async (req, res) => {
    hrOnly(req);
    await checkArrivals();
    const { rows } = await db.query(`SELECT p.id, p.ingresso::text AS ingresso, p.stato, c.nome, c.cognome, r.posizione,
        (SELECT count(*)::int FROM hr_pre_tasks t WHERE t.pre_id = p.id) AS compiti, (SELECT count(*)::int FROM hr_pre_tasks t WHERE t.pre_id = p.id AND t.fatto) AS fatti
      FROM hr_preboarding p JOIN hr_applications a ON a.id = p.app_id JOIN hr_candidates c ON c.id = a.candidate_id JOIN hr_requisitions r ON r.id = a.req_id ORDER BY p.ingresso`);
    res.json({ preboarding: rows });
  });
  app.get('/api/hr/preboarding/:id', async (req, res) => {
    const p = await preRow(v.int(req.params.id, 'id', { min: 1 }));
    if (!isHr(req) && p.requested_by !== req.user.id) throw new HttpError(403, 'Riservato al team HR e al responsabile');
    await checkArrivals();
    const { rows: tasks } = await db.query('SELECT * FROM hr_pre_tasks WHERE pre_id = $1 ORDER BY ordine', [p.id]);
    const { rows: docs } = await db.query("SELECT id, nome, size, created_at FROM hr_files WHERE candidate_id = $1 AND tipo = 'documento' ORDER BY id", [p.candidate_id]);
    const fresh = await preRow(p.id);
    res.json({
      preboarding: { id: p.id, ingresso: p.ingresso, stato: fresh.stato, taglie: p.taglie, nome: p.nome, cognome: p.cognome, posizione: p.posizione, app_id: p.app_id },
      compiti: tasks.map(t => ({ ...t, scadenza: R.scadenza(p.ingresso, t.giorni), in_ritardo: !t.fatto && R.scadenza(p.ingresso, t.giorni) < todayIso() })),
      documenti: isHr(req) ? docs : docs.map(d => ({ id: d.id, nome: '(riservato al team HR)' })),
      boss: isHr(req) ? { nome: p.nome, cognome: p.cognome, email: p.email, telefono: p.telefono, posizione: p.posizione, incarico: p.incarico_nome, area: p.area_nome, contratto: p.offerta_contratto || p.contratto,
        ccnl_livello: p.ccnl_livello, ingresso: p.ingresso, ral: p.ral, url: fresh.boss_url || process.env.BOSS_APP_URL || null,
        stato: fresh.boss_stato, boss_id: fresh.boss_id, errore: fresh.boss_errore, tentativi: fresh.boss_tentativi, inviata_at: fresh.boss_inviata_at, collegato: Boolean(bossOpts().url) } : null,
      link_candidato: isHr(req) ? `${config.baseUrl || ''}/benvenuto/${p.token}` : null, is_hr: isHr(req),
    });
  });
  // «Invia a BOSS» / «Riprova» (team HR): riparte anche dopo che Alma ha smesso di riprovare da sola
  app.post('/api/hr/preboarding/:id/boss', async (req, res) => {
    hrOnly(req);
    const p = await preRow(v.int(req.params.id, 'id', { min: 1 }));
    if (p.stato !== 'aperto') throw new HttpError(400, 'Il pre-boarding è chiuso');
    await db.query("UPDATE hr_preboarding SET boss_tentativi = 0, boss_stato = CASE WHEN boss_stato = 'inviata' THEN boss_stato ELSE 'da_inviare' END WHERE id = $1", [p.id]);
    const out = await sendToBoss(db, p.id, bossOpts());
    await hrLog(req, 'persona inviata a BOSS', { after: { preboarding: p.id, esito: out.stato } });
    res.json(out);
  });
  app.patch('/api/hr/preboarding/:id', async (req, res) => {
    hrOnly(req);
    const p = await preRow(v.int(req.params.id, 'id', { min: 1 }));
    const ingresso = v.date(req.body.ingresso, 'ingresso');
    if (ingresso) await db.query('UPDATE hr_preboarding SET ingresso = $1 WHERE id = $2', [ingresso, p.id]);
    if (req.body.stato === 'annullato') await db.query("UPDATE hr_preboarding SET stato = 'annullato' WHERE id = $1", [p.id]);
    res.json({ ok: true });
  });
  app.patch('/api/hr/preboarding/:id/compiti/:taskId', async (req, res) => {
    const p = await preRow(v.int(req.params.id, 'id', { min: 1 }));
    const { rows: [t] } = await db.query('SELECT * FROM hr_pre_tasks WHERE id = $1 AND pre_id = $2', [v.int(req.params.taskId, 'compito', { min: 1 }), p.id]);
    if (!t) throw new HttpError(404, 'Compito non trovato');
    if (!isHr(req) && !(t.chi === 'responsabile' && p.requested_by === req.user.id)) throw new HttpError(403, 'Questo compito lo segna il team HR');
    const fatto = Boolean(req.body.fatto);
    await db.query('UPDATE hr_pre_tasks SET fatto = $1, fatto_at = CASE WHEN $1 THEN now() END, fatto_by = CASE WHEN $1 THEN $2::int END WHERE id = $3', [fatto, req.user.id, t.id]);
    res.json({ ok: true });
  });

  // pagina del nuovo assunto: documenti e taglie, senza account; il link scade il giorno dopo l'ingresso
  const preByToken = async token => {
    const { rows: [p] } = await db.query(`SELECT p.*, p.ingresso::text AS ingresso, c.nome, c.id AS cand_id, r.posizione, r.sede, u.name AS responsabile
      FROM hr_preboarding p JOIN hr_applications a ON a.id = p.app_id JOIN hr_candidates c ON c.id = a.candidate_id JOIN hr_requisitions r ON r.id = a.req_id
      LEFT JOIN users u ON u.id = r.requested_by WHERE p.token = $1 AND p.stato = 'aperto' AND p.ingresso >= ($2::date - 1)`, [String(token), todayIso()]);
    return p || null;
  };
  app.get('/benvenuto/:token', async (req, res) => {
    noStore(res).set('X-Robots-Tag', 'noindex, nofollow');
    const p = await preByToken(req.params.token);
    if (!p) return res.status(404).type('html').send(shell('Link non più attivo · Almacis', '<div class="card"><h1>Link non più attivo</h1><p>Per qualsiasi cosa scrivi all\'ufficio del personale.</p></div>'));
    const { rows: docs } = await db.query("SELECT nome FROM hr_files WHERE candidate_id = $1 AND tipo = 'documento' ORDER BY id", [p.cand_id]);
    const t = p.taglie || {};
    res.type('html').send(shell('Benvenuto in Almacis', `<div class="card"><h1>Benvenuto in Almacis, ${esc(p.nome)}</h1><div class="mut">${esc(p.posizione)} · primo giorno ${esc(p.ingresso.split('-').reverse().join('/'))}${p.sede ? ` · ${esc(p.sede)}` : ''}${p.responsabile ? ` · chiedi di ${esc(p.responsabile)}` : ''}</div></div>
<form class="card" id="f"><h2 style="margin-top:0">I documenti per l'assunzione</h2><p class="mut">Documento d'identità, codice fiscale, coordinate bancarie (IBAN) e titolo di studio. PDF o foto, al massimo 5 MB ciascuno. Li vede solo l'ufficio del personale.</p>
${docs.length ? `<p class="ok">Già ricevuti: ${docs.map(d => esc(d.nome)).join(', ')}</p>` : ''}<label for="doc">Aggiungi documenti</label><input type="file" id="doc" multiple accept=".pdf,image/png,image/jpeg">
<h2>Le taglie per i dispositivi di protezione</h2><div class="row"><div><label for="giacca">Giacca</label><input type="text" id="giacca" value="${esc(t.giacca || '')}" maxlength="10"></div>
<div><label for="scarpe">Scarpe</label><input type="text" id="scarpe" value="${esc(t.scarpe || '')}" maxlength="10"></div></div><div class="row"><div><label for="casco">Casco</label><input type="text" id="casco" value="${esc(t.casco || '')}" maxlength="10"></div>
<div><label for="pantaloni">Pantaloni</label><input type="text" id="pantaloni" value="${esc(t.pantaloni || '')}" maxlength="10"></div></div><button type="submit">Invia</button><p id="msg" class="mut"></p></form>
<script src="/benvenuto.js"></script>`));
  });
  app.post('/benvenuto/:token', publicLimit, express.json({ limit: '25mb' }), async (req, res) => {
    const p = await preByToken(req.params.token);
    if (!p) throw new HttpError(404, 'Link non più attivo');
    const docs = (Array.isArray(req.body.documenti) ? req.body.documenti : []).slice(0, 6).map(f => readFile(f, 'documento'));
    const t = req.body.taglie || {};
    const taglie = Object.fromEntries(['giacca', 'scarpe', 'casco', 'pantaloni'].map(k => [k, String(t[k] || '').slice(0, 10)]));
    await db.tx(async q => {
      for (const d of docs) await q.query("INSERT INTO hr_files (candidate_id, tipo, nome, mime, size, data) VALUES ($1, 'documento', $2, $3, $4, $5)", [p.cand_id, d.nome, d.mime, d.data.length, d.data]);
      await q.query('UPDATE hr_preboarding SET taglie = $1 WHERE id = $2', [JSON.stringify(taglie), p.id]);
      const { rows: [n] } = await q.query("SELECT count(*)::int AS n FROM hr_files WHERE candidate_id = $1 AND tipo = 'documento'", [p.cand_id]);
      if (n.n >= 3) await q.query("UPDATE hr_pre_tasks SET fatto = true, fatto_at = now() WHERE pre_id = $1 AND chi = 'candidato' AND NOT fatto", [p.id]);
    });
    if (docs.length) await notify(await usersWithRole('hr'), null, `${p.nome} ha caricato ${docs.length} documenti per l'assunzione (${p.posizione}).`, `/hr/preboarding/${p.id}`);
    res.json({ ok: true });
  });

  // ── numeri (tavola Z), con l'ambito ──
  async function numeri(req) {
    const ambito = hrMod().ambitoOf(req);
    const da = v.date(req.query.dal, 'dal') || plusMonths(todayIso(), -12);
    const [{ rows: reqs }, { rows: apps }, { rows: offers }, { rows: arrived }] = await Promise.all([
      db.query(`SELECT r.id, r.stato, r.approved_at, r.area_id, a.tipo AS area_tipo,
          (SELECT max(o.updated_at) FROM hr_offers o JOIN hr_applications x ON x.id = o.app_id WHERE x.req_id = r.id AND o.stato = 'accettata') AS accepted_at
        FROM hr_requisitions r LEFT JOIN org_aree a ON a.id = r.area_id WHERE r.created_at >= $1`, [da]),
      db.query(`SELECT x.id, x.fonte, x.stage, x.passi, r.area_id, a.tipo AS area_tipo FROM hr_applications x JOIN hr_requisitions r ON r.id = x.req_id LEFT JOIN org_aree a ON a.id = r.area_id WHERE x.created_at >= $1`, [da]),
      db.query(`SELECT o.stato, o.motivo_rifiuto, o.ral, r.role_id, c.sesso, r.area_id, a.tipo AS area_tipo FROM hr_offers o JOIN hr_applications x ON x.id = o.app_id JOIN hr_requisitions r ON r.id = x.req_id
        JOIN hr_candidates c ON c.id = x.candidate_id LEFT JOIN org_aree a ON a.id = r.area_id WHERE o.created_at >= $1`, [da]),
      db.query(`SELECT p.arrived_at, (SELECT bool_or(h.attivo) FROM hr_people h WHERE h.email = lower(c.email)) AS attivo, r.area_id, a.tipo AS area_tipo
        FROM hr_preboarding p JOIN hr_applications x ON x.id = p.app_id JOIN hr_candidates c ON c.id = x.candidate_id JOIN hr_requisitions r ON r.id = x.req_id LEFT JOIN org_aree a ON a.id = r.area_id
        WHERE p.arrived_at IS NOT NULL AND p.arrived_at < now() - interval '6 months'`),
    ]);
    const sc = x => hrMod().inScope({ id: x.area_id, tipo: x.area_tipo }, ambito);
    const st = R.recruitmentStats({ reqs: reqs.filter(sc), apps: apps.filter(sc), offers: offers.filter(sc) });
    // equità delle offerte: per ruolo, media donne vs uomini (solo dove ci sono entrambi)
    const byRole = {};
    for (const o of offers.filter(sc).filter(x => x.sesso && ['approvata', 'inviata', 'accettata', 'rifiutata'].includes(x.stato))) (byRole[o.role_id] ||= { F: [], M: [] })[o.sesso].push(o.ral);
    const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
    const titles = new Map((await hrMod().hrRoles(db)).map(r => [r.id, H.roleTitle(r)]));
    const equita = Object.entries(byRole).filter(([, g]) => g.F.length && g.M.length).map(([role, g]) => ({ role_id: Number(role), ruolo: titles.get(Number(role)) || 'ruolo', gap: Math.round((avg(g.F) / avg(g.M) - 1) * 1000) / 10, f: g.F.length, m: g.M.length }));
    const arr = arrived.filter(sc);
    return { ...st, ancora_qui: arr.length ? { su: arr.length, attivi: arr.filter(x => x.attivo).length } : null, equita, ambito, dal: da };
  }
  app.get('/api/hr/recruitment/numeri', async (req, res) => { hrOnly(req); res.json(await numeri(req)); });
  app.get('/api/hr/recruitment/numeri.xlsx', async (req, res) => {
    hrOnly(req);
    const n = await numeri(req);
    const { writeXlsx } = require('../lib/xlsx');
    const sheets = {
      Sintesi: [['Voce', 'Valore'], ['Dal', n.dal], ['Ambito', n.ambito || "tutta l'azienda"], ['Tempo per assumere (mediana, giorni)', n.tempo_mediana ?? ''], ['Posizioni chiuse', n.chiuse], ['Aperte da oltre 45 giorni', n.aperte_vecchie], ['Offerte accettate %', n.offerte_accettate_pct ?? ''], ['Ancora qui dopo 6 mesi', n.ancora_qui ? `${n.ancora_qui.attivi} di ${n.ancora_qui.su}` : '']],
      Imbuto: [['Passo', 'Candidati'], ...n.funnel],
      Canali: [['Canale', 'Candidature', 'Assunti', 'Resa %'], ...n.canali.map(c => [c.label, c.candidature, c.assunti, c.resa])],
      Equità: [['Ruolo', 'Offerte a donne', 'Offerte a uomini', 'Scarto donne/uomini %'], ...n.equita.map(e => [e.ruolo, e.f, e.m, e.gap])],
    };
    await hrLog(req, 'export numeri del recruitment', { kind: 'accesso' });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', 'attachment; filename="numeri-recruitment.xlsx"').send(writeXlsx(sheets));
  });
}

// ── Invio della persona assunta a BOSS (ALM2-63) ──
// Quando il candidato accetta, Alma manda a BOSS (POST su BOSS_PERSONALE_CREATE_URL, token BOSS_PERSONALE_TOKEN) i dati per
// creare l'anagrafica del personale. Solo la persona: la posizione resta in Alma. Se BOSS non risponde si riprova (fino a 10
// volte, ogni 6 ore) e si avvisa il team HR; se l'API non è configurata resta «Copia i dati». Contratto in docs/boss-api-personale.md.
const BOSS_MAX_TENTATIVI = 10;
async function bossData(db, preId) {
  const { rows: [p] } = await db.query(`SELECT p.id, p.ingresso::text AS ingresso, p.stato, p.boss_stato, p.boss_tentativi, c.nome, c.cognome, c.email, c.telefono, c.sesso,
      r.posizione, r.contratto, r.sede, r.riporta_a, r.requested_by, ar.nome AS area_nome, pr.title AS ruolo, pr.grade, i.boss_id AS incarico_boss_id,
      lower(sopra.ricoperto_da) AS sopra_email, o.ral, o.ccnl_livello, o.contratto AS offerta_contratto, o.prova_mesi
    FROM hr_preboarding p JOIN hr_applications a ON a.id = p.app_id JOIN hr_candidates c ON c.id = a.candidate_id JOIN hr_requisitions r ON r.id = a.req_id
    LEFT JOIN org_aree ar ON ar.id = r.area_id LEFT JOIN pm_roles pr ON pr.id = r.role_id LEFT JOIN org_incarichi i ON i.id = r.incarico_id
    LEFT JOIN org_incarichi sopra ON sopra.id = i.riporta_a_id
    LEFT JOIN LATERAL (SELECT * FROM hr_offers WHERE app_id = a.id ORDER BY id DESC LIMIT 1) o ON true WHERE p.id = $1`, [preId]);
  if (!p) return null;
  return { ...p, responsabile_email: p.riporta_a || p.sopra_email || null };
}
const bossConfig = () => ({ url: process.env.BOSS_PERSONALE_CREATE_URL || '', token: process.env.BOSS_PERSONALE_CREATE_TOKEN || process.env.BOSS_PERSONALE_TOKEN || '' });
async function sendToBoss(db, preId, { fetchImpl = fetch, url = bossConfig().url, token = bossConfig().token, notifyHr = null } = {}) {
  const p = await bossData(db, preId);
  if (!p || p.stato === 'annullato') return { ok: false, stato: 'annullato' };
  if (p.boss_stato === 'inviata') return { ok: true, stato: 'inviata' };
  if (!url || !token) {
    await db.query("UPDATE hr_preboarding SET boss_stato = 'non_collegato', boss_errore = NULL WHERE id = $1", [p.id]);
    return { ok: false, stato: 'non_collegato' };
  }
  const payload = R.bossPayload(p);
  let errore = null, risposta = null;
  try {
    const r = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': payload.riferimentoAlma }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
    const txt = await r.text().catch(() => '');
    try { risposta = txt ? JSON.parse(txt) : {}; } catch { risposta = {}; }
    // 409 = la persona c'è già con questo riferimentoAlma: BOSS rimanda il suo id, va bene così
    if (!r.ok && r.status !== 409) errore = `BOSS ha risposto ${r.status}${risposta?.error ? `: ${String(risposta.error).slice(0, 200)}` : ''}`;
  } catch (err) { errore = `BOSS non risponde (${String(err.message || err).slice(0, 120)})`; }
  if (errore) {
    const n = (p.boss_tentativi || 0) + 1;
    await db.query("UPDATE hr_preboarding SET boss_stato = 'errore', boss_errore = $1, boss_tentativi = $2 WHERE id = $3", [errore, n, p.id]);
    if (n === 1 || n === BOSS_MAX_TENTATIVI) await notifyHr?.(`l'invio di ${p.nome} ${p.cognome} a BOSS non è riuscito (${errore})${n === BOSS_MAX_TENTATIVI ? ': Alma smette di riprovare, usa «Copia i dati»' : ': Alma riprova da sola'}.`, `/hr/preboarding/${p.id}`);
    return { ok: false, stato: 'errore', errore };
  }
  const bossId = risposta?.id != null ? String(risposta.id).slice(0, 100) : null;
  const bossUrl = typeof risposta?.bossUrl === 'string' && /^https:\/\//.test(risposta.bossUrl) ? risposta.bossUrl.slice(0, 500) : null;
  await db.query("UPDATE hr_preboarding SET boss_stato = 'inviata', boss_id = $1, boss_url = $2, boss_errore = NULL, boss_tentativi = boss_tentativi + 1, boss_inviata_at = now() WHERE id = $3", [bossId, bossUrl, p.id]);
  await db.query("UPDATE hr_pre_tasks SET fatto = true, fatto_at = now() WHERE pre_id = $1 AND chi = 'boss' AND NOT fatto", [p.id]);
  return { ok: true, stato: 'inviata', boss_id: bossId };
}
// riprova gli invii non riusciti (job ogni 6 ore)
async function retryBoss(db, opts = {}) {
  const { rows } = await db.query("SELECT id FROM hr_preboarding WHERE stato = 'aperto' AND boss_stato IN ('errore', 'da_inviare', 'non_collegato') AND boss_tentativi < $1", [BOSS_MAX_TENTATIVI]);
  let n = 0;
  for (const r of rows) if ((await sendToBoss(db, r.id, opts)).ok) n++;
  return n;
}

// Cancellazione automatica dei CV (decisione C): dopo 24 mesi con il consenso; senza, 30 giorni dopo la chiusura delle
// posizioni a cui si era candidato. Chi è stato assunto non si cancella.
async function purgeCandidates(db) {
  const { rowCount } = await db.query(`DELETE FROM hr_candidates c WHERE NOT EXISTS (SELECT 1 FROM hr_applications a WHERE a.candidate_id = c.id AND a.stage = 'accettata')
    AND ((c.conserva AND c.conservare_fino < current_date)
      OR (NOT c.conserva AND NOT EXISTS (SELECT 1 FROM hr_applications a JOIN hr_requisitions r ON r.id = a.req_id
            WHERE a.candidate_id = c.id AND (r.closed_at IS NULL OR r.closed_at > now() - interval '30 days'))))`);
  return rowCount;
}

// Sollecito (tavola T): un passo fermo da più di 2 giorni lavorativi riceve un promemoria, una volta al giorno.
function workDaysSince(iso, now = new Date()) {
  let d = new Date(iso), n = 0;
  while (d < now) { d = new Date(d.getTime() + 86400000); if (d <= now && d.getDay() !== 0 && d.getDay() !== 6) n++; }
  return n;
}
async function remindApprovals(db, gov, notifier) {
  const { rows } = await db.query(`SELECT s.id, s.oggetto, s.oggetto_id, s.ruolo,
      COALESCE((SELECT max(p.decided_at) FROM hr_approvals p WHERE p.oggetto = s.oggetto AND p.oggetto_id = s.oggetto_id AND p.ordine < s.ordine), r.created_at, o.updated_at) AS da,
      COALESCE(r.posizione, rr.posizione) AS posizione, COALESCE(r.requested_by, rr.requested_by) AS requested_by, o.app_id
    FROM hr_approvals s LEFT JOIN hr_requisitions r ON s.oggetto = 'richiesta' AND r.id = s.oggetto_id AND r.stato = 'approvazione'
    LEFT JOIN hr_offers o ON s.oggetto = 'offerta' AND o.id = s.oggetto_id AND o.stato = 'approvazione'
    LEFT JOIN hr_applications a ON a.id = o.app_id LEFT JOIN hr_requisitions rr ON rr.id = a.req_id
    WHERE s.decisione IS NULL AND (r.id IS NOT NULL OR o.id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM hr_approvals p WHERE p.oggetto = s.oggetto AND p.oggetto_id = s.oggetto_id AND p.ordine < s.ordine AND (p.decisione IS NULL OR p.decisione <> 'ok'))`);
  const { rows: users } = await db.query('SELECT id, lower(email) AS email FROM users WHERE email IS NOT NULL AND suspended_at IS NULL');
  let n = 0;
  for (const s of rows) {
    if (workDaysSince(s.da) < 2) continue;
    let ids = s.ruolo === 'bu' ? [s.requested_by].filter(Boolean) : users.filter(u => gov.roleOf(u.email).key === s.ruolo).map(u => u.id);
    if (!ids.length && s.ruolo !== 'bu') ids = users.filter(u => gov.isAdminEmail(u.email)).map(u => u.id);
    if (!ids.length) continue;
    await notifier.notify({ userIds: ids, actorId: null, kind: 'hr', body: `promemoria: aspetta la tua approvazione da ${workDaysSince(s.da)} giorni lavorativi (${s.oggetto} «${s.posizione}»).`,
      link: s.oggetto === 'richiesta' ? `/hr/richieste/${s.oggetto_id}` : `/hr/candidato/${s.app_id}` }).catch(() => {});
    n++;
  }
  return n;
}

module.exports = { registerHrRec, purgeCandidates, remindApprovals, workDaysSince, sendToBoss, retryBoss };
