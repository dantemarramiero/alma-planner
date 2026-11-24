// Dalla gara di progettazione alla gara dei lavori (ALM2-76, canvas «Radar · dalla progettazione ai lavori» approvato da
// Dante il 24/11/2026): «ha trovato il bando di progettazione esecutiva, quindi tra non molto esce il bando di costruzione;
// vorrei un'opportunità e una segnalazione quando si trova chi è il progettista, censirlo e indicare i suoi contatti utili».
// - l'opportunità dei lavori è un segnale «Prima del bando» collegato alla gara di progettazione (design_signal_id) e
//   seguito (watch_designer) fino a 18 mesi o finché non lo si scarta;
// - ogni notte si cerca l'aggiudicazione col CIG nei dati ANAC che già leggiamo per i Progettisti (crm_anac_design);
//   ogni 7 giorni Alma cerca sul web l'esito, il progetto esecutivo e la gara dei lavori (l'esito sul web arriva prima);
// - trovato il progettista: ogni studio del raggruppamento nel CRM come «progettista», collegato all'opportunità e alla
//   gara di progettazione; dati del capogruppo trovati su internet (da spuntare nella scheda), persone da conoscere,
//   passo proposto («Chiedi a … di presentarci» se un collega lo conosce); avviso al responsabile della BU e a chi ha
//   aggiunto l'opportunità. Dal web il progettista resta «da confermare» finché non lo conferma ANAC.
const { searchCompany } = require('./crm-web');
const { linkCrm } = require('./crm-progettisti');
const { relationsFor, pathsOf } = require('./crm-relazioni');
const { managerOf } = require('./crm-commerciale');

const MODEL = process.env.OPENAI_RADAR_FIND_MODEL || 'gpt-4.1';
const PRICE = { in: 2, out: 8, search: Number(process.env.OPENAI_PRICE_SEARCH || 0.03) };
const USD_EUR = 0.95;
const WEB_EVERY_DAYS = 7;
const WATCH_MONTHS = 18;
const cfClean = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^IT(?=\d{11}$)/, '');
const dateOf = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const nice = s => String(s || '').toLowerCase().replace(/(^|[\s'’(.-])([a-zà-ù])/g, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(S\.?r\.?l|S\.?p\.?a|S\.?c\.?a\.?r\.?l|S\.?n\.?c|Rtp|Rti)\b\.?/gi, x => x.toUpperCase());
const watchUntil = today => { const d = new Date(`${today}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + WATCH_MONTHS); return d.toISOString().slice(0, 10); };
// ruolo nel raggruppamento: ANAC scrive «MANDATARIA», «MANDANTE», «CAPOGRUPPO»…
function roleOf(r) {
  const s = String(r || '').toLowerCase();
  if (/mandatari|capogrupp|capofila/.test(s)) return 'capogruppo';
  if (/mandant/.test(s)) return 'mandante';
  if (/consorzi|ausiliari|consorziat/.test(s)) return 'mandante';
  return s ? s.slice(0, 40) : '';
}
// un gruppo ordinato: prima il capogruppo; un solo studio = «capogruppo» anche se ANAC non lo dice
function teamOf(list) {
  const t = list.map(w => ({ name: nice(String(w.name || '').trim()).slice(0, 200), cf: cfClean(w.cf), role: roleOf(w.role) })).filter(w => w.name);
  if (t.length === 1) t[0].role = 'capogruppo';
  if (t.length && !t.some(w => w.role === 'capogruppo')) t[0].role = 'capogruppo';
  return t.sort((a, b) => (a.role === 'capogruppo' ? -1 : b.role === 'capogruppo' ? 1 : 0));
}

// ── la ricerca settimanale sul web ───────────────────────────────────────────────────────────────
function webPrompt({ work, design, today }) {
  return [
    `Sei l'analista gare di Almacis, impresa italiana di costruzioni. Oggi è il ${today}.`,
    `Seguiamo un'opera: «${work.title}»${work.entity ? ` (${work.entity})` : ''}${work.place ? `, ${work.place}` : ''}.`,
    design ? `La progettazione è stata messa in gara: «${design.title}»${design.cig ? `, CIG ${design.cig}` : ''}${design.published_on ? `, pubblicata il ${design.published_on}` : ''}${design.url ? `, fonte ${design.url}` : ''}.` : '',
    'Cerca in rete (sito e albo dell\'ente, piattaforma telematica della gara, Amministrazione trasparente, ANAC, stampa locale, siti degli studi):',
    '1) se la gara di progettazione è stata aggiudicata e a chi: lo studio o il raggruppamento (capogruppo e mandanti), con codice fiscale o P.IVA se li vedi;',
    '2) le persone del gruppo di progettazione che conviene conoscere (titolari, progettista responsabile dell\'integrazione, progettisti indicati nell\'offerta), con il ruolo;',
    '3) se il progetto esecutivo è stato approvato (data);',
    '4) se è uscita la gara dei lavori (data, scadenza delle offerte, importo, CIG, link).',
    'Non inventare: metti solo quello che leggi in una pagina, con il link. Se una cosa non la trovi lasciala vuota.',
    'Rispondi SOLO con un oggetto JSON, senza testo prima o dopo:',
    '{"aggiudicata": true|false, "data_aggiudicazione": "AAAA-MM-GG" o null, "fonte_aggiudicazione": "url" o "", "gruppo": [{"nome": "...", "cf": "codice fiscale o P.IVA" o "", "ruolo": "capogruppo" o "mandante"}], "persone": [{"nome": "Ing. Nome Cognome", "ruolo": "...", "studio": "...", "fonte": "url"}], "esecutivo_approvato": "AAAA-MM-GG" o null, "fonte_esecutivo": "url" o "", "gara_lavori": {"pubblicata": true|false, "data": "AAAA-MM-GG" o null, "scadenza": "AAAA-MM-GG" o null, "importo": numero o null, "cig": "" , "url": ""}}',
  ].filter(Boolean).join('\n');
}
function firstObject(s) {
  const t = String(s || '');
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = fenced ? fenced[1] : t;
  const start = src.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(src.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}
const urlOf = v => (/^https?:\/\//i.test(String(v || '')) ? String(v).slice(0, 500) : '');
function parseWeb(text) {
  const o = firstObject(text) || {};
  const g = o.gara_lavori && typeof o.gara_lavori === 'object' ? o.gara_lavori : {};
  return {
    awarded: Boolean(o.aggiudicata) && Array.isArray(o.gruppo) && o.gruppo.some(x => x && x.nome),
    awarded_on: dateOf(o.data_aggiudicazione), url: urlOf(o.fonte_aggiudicazione),
    team: teamOf((Array.isArray(o.gruppo) ? o.gruppo : []).slice(0, 8).map(x => ({ name: x?.nome, cf: x?.cf, role: x?.ruolo }))),
    people: (Array.isArray(o.persone) ? o.persone : []).slice(0, 8).map(p => ({ name: String(p?.nome || '').trim().slice(0, 120), role: String(p?.ruolo || '').slice(0, 120),
      company: nice(String(p?.studio || '')).slice(0, 200), source: urlOf(p?.fonte) })).filter(p => p.name),
    esecutivo_on: dateOf(o.esecutivo_approvato), esecutivo_url: urlOf(o.fonte_esecutivo),
    gara: g.pubblicata ? { on: dateOf(g.data), deadline: dateOf(g.scadenza), amount: Number.isFinite(Number(g.importo)) && g.importo !== null && g.importo !== '' ? Number(g.importo) : null,
      cig: String(g.cig || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), url: urlOf(g.url) } : null,
  };
}
async function webCheck({ apiKey, fetchImpl = fetch, work, design, today }) {
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, tools: [{ type: 'web_search_preview', search_context_size: 'high', user_location: { type: 'approximate', country: 'IT' } }], input: webPrompt({ work, design, today }) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || 'errore'}`);
  const parts = (data.output || []).flatMap(o => o.content || []);
  const text = data.output_text || parts.map(c => c.text || '').join('\n');
  const searches = (data.output || []).filter(o => o.type === 'web_search_call').length || 1;
  const u = data.usage || {};
  const usd = ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out) / 1e6 + searches * PRICE.search;
  return { ...parseWeb(text), costEur: Math.round(usd * USD_EUR * 10000) / 10000 };
}

// ── il progettista nel CRM ───────────────────────────────────────────────────────────────────────
async function ensureDesigner(db, w, userId) {
  const found = [{ cf: w.cf, name: w.name }];
  await linkCrm(db, found);
  if (found[0].subject) {
    const s = found[0].subject;
    // ALM2-80: il progettista è anche fornitore (Professionisti › Progettista)
    await db.query(`UPDATE crm_subjects SET roles = ARRAY(SELECT DISTINCT unnest(roles || '{progettista,fornitore}'::text[])),
        supplier_categories = ARRAY(SELECT DISTINCT unnest(supplier_categories || '{professionisti}'::text[])),
        supplier_subcategories = ARRAY(SELECT DISTINCT unnest(supplier_subcategories || '{Progettista}'::text[])) WHERE id = $1`, [s.id]);
    return { id: s.id, name: s.name, created: false };
  }
  const { rows: [s] } = await db.query(`INSERT INTO crm_subjects (name, vat, tax_code, roles, supplier_categories, supplier_subcategories, asa, owner_id, origin, created_by)
    VALUES ($1, $2, $3, '{progettista,fornitore}', '{professionisti}', '{Progettista}', '{}', $4, 'ANAC', $4) RETURNING id, name`,
    [w.name, /^\d{11}$/.test(w.cf) ? w.cf : '', /^[A-Z0-9]{16}$/.test(w.cf) ? w.cf : '', userId || null]);
  return { id: s.id, name: s.name, created: true };
}
async function linkSignal(db, signalId, subjectId, role, userId) {
  if (!signalId || !subjectId) return;
  await db.query(`INSERT INTO crm_signal_links (signal_id, subject_id, role, linked_by) VALUES ($1, $2, $3, $4)
                  ON CONFLICT (signal_id, subject_id) WHERE subject_id IS NOT NULL DO UPDATE SET role = EXCLUDED.role`, [signalId, subjectId, role, userId || null]);
}

// passo proposto: un collega che conosce il capogruppo lo presenta; se no, lo contatta il responsabile della BU
async function proposeStep(db, capo, settings, ownerId, users) {
  const rel = (await relationsFor(db, [capo.subject_id], settings.relazioni))[capo.subject_id];
  const known = pathsOf(rel).filter(p => p.us);
  const firstName = n => String(n || '').split(' ')[0];
  const knows = known.map(p => ({ user_id: p.us.id, user_name: p.us.name, contact: p.contact, level: p.level, why: p.why }));
  if (knows.length) return { knows, step: { kind: 'presentaci', user_id: knows[0].user_id, title: `Chiedi a ${firstName(knows[0].user_name)} di presentarci`, within_days: 7 } };
  const owner = users.find(u => u.id === ownerId);
  return { knows: [], step: { kind: 'contatta', user_id: ownerId || null, title: `Contatta ${capo.name}`, within_days: 7 } };
}

// Il segnale seguito: controlla ANAC (sempre) e il web (ogni 7 giorni, o subito con «Controlla adesso»).
// Restituisce { found, note, costEur }. Non lancia: gli errori diventano la nota del controllo.
async function checkOne(db, sig, { apiKey = '', fetchImpl = fetch, notifier = null, settings, users, today, force = false, actorId = null } = {}) {
  let design = null;
  if (sig.design_signal_id) design = (await db.query('SELECT id, title, entity, cig, url, published_on, deadline, created_by FROM crm_signals WHERE id = $1', [sig.design_signal_id])).rows[0] || null;
  const cig = sig.watch_cig || design?.cig || '';
  const des = sig.designer ? { ...sig.designer } : null;
  const was = des ? { confirmed: Boolean(des.confirmed), n: (des.team || []).length } : null;
  let next = des ? { ...des } : null;
  let cost = 0;
  const notes = [];
  // 1. ANAC col CIG
  if (cig && !(next && next.confirmed)) {
    const { rows: [a] } = await db.query('SELECT cig, winners, amount, awarded_on FROM crm_anac_design WHERE cig = $1', [cig]);
    if (a && Array.isArray(a.winners) && a.winners.length) {
      next = { ...(next || {}), source: 'anac', confirmed: true, team: teamOf(a.winners), awarded_on: a.awarded_on ? String(a.awarded_on).slice(0, 10) : null,
        amount: a.amount != null ? Number(a.amount) : null, url: next?.url || '', found_at: next?.found_at || new Date().toISOString() };
      notes.push('aggiudicazione trovata nei dati ANAC');
    } else notes.push(cig ? 'ANAC: ancora niente col CIG' : '');
  }
  // 2. web ogni 7 giorni
  const webDue = apiKey && (force || !sig.watch_web_at || Date.now() - new Date(sig.watch_web_at).getTime() > WEB_EVERY_DAYS * 864e5);
  let web = null;
  if (webDue) {
    try {
      web = await webCheck({ apiKey, fetchImpl, today, work: { title: sig.title, entity: sig.entity, place: [sig.place, sig.region].filter(Boolean).join(', ') }, design });
      cost += web.costEur;
      if (web.awarded && !next) {
        next = { source: 'web', confirmed: false, team: web.team, awarded_on: web.awarded_on, amount: null, url: web.url, found_at: new Date().toISOString() };
        notes.push('esito trovato sul web');
      } else if (!next) notes.push('web: nessun esito');
      if (next) {
        const seen = new Set((next.people || []).map(p => p.name.toLowerCase()));
        next.people = [...(next.people || []), ...web.people.filter(p => !seen.has(p.name.toLowerCase()))].slice(0, 10);
        next.steps = { ...(next.steps || {}) };
        if (web.esecutivo_on) Object.assign(next.steps, { esecutivo_on: web.esecutivo_on, esecutivo_url: web.esecutivo_url });
      }
    } catch (err) { notes.push(`web: ${String(err.message || err).slice(0, 120)}`); }
  }
  const newlyFound = next && next.team?.length && !was;
  // 3. il progettista nel CRM (la prima volta, o quando ANAC conferma un gruppo diverso da quello del web)
  if (next && next.team?.length && (newlyFound || (next.confirmed && was && !was.confirmed))) {
    for (const w of next.team) {
      const s = await ensureDesigner(db, w, sig.created_by || actorId);
      w.subject_id = s.id; w.created = s.created;
      const role = w.role === 'capogruppo' ? 'progettista capogruppo' : 'progettista';
      await linkSignal(db, sig.id, s.id, role, actorId);
      await linkSignal(db, design?.id, s.id, role, actorId);
    }
    const capo = next.team[0];
    const ownerId = managerOf(settings.profiles[sig.bu], users)?.id || sig.created_by || null;
    Object.assign(next, await proposeStep(db, capo, settings, ownerId, users));
    // dati del capogruppo dalla ricerca su internet: restano da spuntare nella scheda
    if (apiKey && !next.web) {
      try {
        const s = (await db.query('SELECT id, name, city, province, vat, website, email, pec, phone, address FROM crm_subjects WHERE id = $1', [capo.subject_id])).rows[0];
        const out = await searchCompany({ apiKey, fetchImpl, subject: { name: s.name, city: s.city, province: s.province, vat: s.vat, website: s.website, email: s.email } });
        cost += out.costEur || 0;
        if (!out.ambiguous) next.web = { subject_id: s.id, fields: (out.fields || []).filter(f => !s[f.key] || String(s[f.key]).toLowerCase() !== String(f.value).toLowerCase()).map(f => ({ ...f, current: s[f.key] || '' })) };
      } catch (err) { notes.push(`dati da internet: ${String(err.message || err).slice(0, 100)}`); }
    }
  }
  // 4. la gara dei lavori è uscita: data nel segnale, sorveglianza finita
  let garaOut = false;
  if (web?.gara && (web.gara.on || web.gara.url)) {
    next = next || { team: [], source: '', confirmed: false };
    next.steps = { ...(next.steps || {}), gara_on: web.gara.on, gara_url: web.gara.url, gara_cig: web.gara.cig };
    garaOut = !(sig.designer?.steps?.gara_on || sig.designer?.steps?.gara_url);
  }
  await db.query(`UPDATE crm_signals SET designer = $2, watch_checked_at = now(), watch_web_at = CASE WHEN $3 THEN now() ELSE watch_web_at END, watch_note = $4,
                    watch_designer = CASE WHEN $5 THEN false ELSE watch_designer END,
                    deadline = CASE WHEN $5 AND $6::date IS NOT NULL THEN $6::date ELSE deadline END,
                    expected_on = CASE WHEN $5 AND $7::date IS NOT NULL THEN $7::date ELSE expected_on END,
                    stage = CASE WHEN $5 THEN 'determina' ELSE stage END
                  WHERE id = $1`,
    [sig.id, next ? JSON.stringify(next) : null, Boolean(web), notes.filter(Boolean).join(' · ').slice(0, 300), garaOut, web?.gara?.deadline || null, web?.gara?.on || null]);
  if (cost && sig.bu) {
    await db.query(`INSERT INTO crm_radar_spend (month, bu, eur) VALUES ($1, $2, $3) ON CONFLICT (month, bu) DO UPDATE SET eur = crm_radar_spend.eur + EXCLUDED.eur`, [today.slice(0, 7), sig.bu, cost]);
  }
  // 5. avvisi: responsabile della BU, chi ha aggiunto l'opportunità e chi ha aggiunto la gara di progettazione
  const ids = [...new Set([managerOf(settings.profiles[sig.bu], users)?.id, sig.created_by, design?.created_by].filter(Boolean))];
  if (notifier && ids.length && (newlyFound || garaOut)) {
    const capo = next.team?.[0];
    const body = garaOut
      ? `«${sig.title}»: è uscita la gara dei lavori${web.gara.deadline ? `, offerte entro il ${web.gara.deadline.split('-').reverse().join('/')}` : ''}.`
      : `«${sig.title}»: c'è il progettista — ${capo.name}${next.team.length > 1 ? ` (raggruppamento di ${next.team.length})` : ''}${next.confirmed ? '' : ', da confermare'}.${next.knows?.length ? ` ${next.knows[0].user_name.split(' ')[0]} lo conosce.` : ''}`;
    try { await notifier.notify({ userIds: ids, actorId: null, kind: 'crm', body, link: garaOut ? '/crm/radar' : `/crm/scheda/${capo.subject_id}` }); } catch (err) { console.warn('[progettista] avviso:', err.message); }
  }
  return { found: Boolean(next?.team?.length), newly: Boolean(newlyFound), gara: garaOut, note: notes.filter(Boolean).join(' · '), costEur: cost };
}

// Il giro di ogni notte: i segnali seguiti ancora aperti; oltre i 18 mesi (o scartati) si smette.
async function runWatches(db, opts) {
  await db.query(`UPDATE crm_signals SET watch_designer = false WHERE watch_designer AND (watch_until < $1::date OR status IN ('scartato', 'gara_scartata'))`, [opts.today]);
  const { rows } = await db.query('SELECT * FROM crm_signals WHERE watch_designer ORDER BY id');
  const out = [];
  for (const sig of rows) {
    try { out.push({ id: sig.id, ...(await checkOne(db, sig, opts)) }); } catch (err) { out.push({ id: sig.id, error: err.message }); }
  }
  return out;
}

// è una gara di progettazione? (servizi di architettura e ingegneria, non lavori né appalto integrato)
const DESIGN_RE = /\b(progettazion\w*|progetto (esecutivo|definitivo)|servizi (tecnici )?(di|attinenti all[’']?)\s*(architettura|ingegneria)|architettura e (l[’'])?ingegneria|pfte|fattibilit[aà] tecnic)/i;
const isDesignTender = s => DESIGN_RE.test(`${s.title || ''} ${s.summary || ''}`) && !/\b(appalto integrato|esecuzione dei lavori|lavori di)\b/i.test(String(s.title || ''));

module.exports = { checkOne, runWatches, webCheck, webPrompt, parseWeb, teamOf, roleOf, watchUntil, isDesignTender, ensureDesigner, WEB_EVERY_DAYS, WATCH_MONTHS, MODEL };
