// Radar AI: ogni notte, per ogni BU accesa, cerca in rete le notizie degli ultimi giorni che possono diventare lavoro
// (investimenti, finanziamenti, permessi, opere finanziate, contratti in scadenza, notizie sui clienti) e le
// restituisce come segnali. Usa OpenAI (Dante 14/11/2026: chiave OpenAI) con la ricerca web; senza OPENAI_API_KEY
// non fa niente. La spesa stimata si conta per BU e mese e si ferma alla quota (crm_settings.radar).

const MODEL = process.env.OPENAI_RADAR_MODEL || 'gpt-4.1-mini';
// prezzi per la stima (USD): token per milione e ricerca per chiamata; cambio fisso prudente
const PRICE = { in: Number(process.env.OPENAI_PRICE_IN || 0.4), out: Number(process.env.OPENAI_PRICE_OUT || 1.6), search: Number(process.env.OPENAI_PRICE_SEARCH || 0.03) };
const USD_EUR = 0.95;
const KINDS = ['opera_finanziata', 'scadenza', 'permesso', 'nuovo_gestore', 'investimento', 'cliente', 'notizia', 'gara'];
// «Prima del bando» (17/11): a che punto è l'opera prima che esca la gara
const STAGES = ['programmata', 'finanziata', 'progetto', 'determina'];

function prompt({ buLabel, profile, clients, days = 14, today, mode = '' }) {
  if (mode === 'pre') return promptPre({ buLabel, profile, days: 30, today });
  return [
    `Sei l'analista commerciale di Almacis, impresa italiana di costruzioni e impianti. Oggi è il ${today}.`,
    `Cerca in rete notizie e atti pubblicati negli ultimi ${days} giorni in Italia che possono portare lavoro alla BU «${buLabel}».`,
    `Cosa fa la BU: ${profile.description || '—'}`,
    profile.works?.length ? `Lavori tipici: ${profile.works.join('; ')}.` : '',
    profile.soa?.length ? `Categorie SOA: ${profile.soa.join(', ')}.` : '',
    profile.amount_min || profile.amount_max ? `Importi interessanti: da ${profile.amount_min ?? 0} a ${profile.amount_max ?? 'senza limite'} euro.` : '',
    profile.regions?.length ? `Zone: ${profile.regions.join(', ')}.` : 'Zone: tutta Italia.',
    profile.keywords?.length ? `Parole utili: ${profile.keywords.join(', ')}.` : '',
    profile.exclude?.length ? `Escludi: ${profile.exclude.join(', ')}.` : '',
    clients.length ? `Clienti attuali (cerca anche notizie nuove su di loro): ${clients.slice(0, 30).join(', ')}.` : '',
    'Cerca: investimenti e nuovi stabilimenti, finanziamenti bancari e aumenti di capitale importanti, permessi di costruire e piani attuativi, opere pubbliche finanziate non ancora bandite (PNRR, contributi, ricostruzione), contratti di manutenzione in scadenza, cambi di gestore o di proprietà, notizie sui clienti attuali.',
    'Solo occasioni concrete: un singolo progetto, investimento o contratto con un committente preciso (ente o azienda) e un luogo. NON includere leggi, decreti, proroghe, linee guida, fondi generici, guide o notizie di settore senza un\'opera precisa, né notizie più vecchie del periodo.',
    'Le gare già bandite mettile con kind "gara" (vanno all\'ufficio gare, non alla BU).',
    'Per ogni notizia metti nel campo url il link della pagina da cui l\'hai presa. Se non trovi niente di utile rispondi [].',
    'Rispondi SOLO con un array JSON (massimo 8 elementi, i più utili), senza testo prima o dopo. Ogni elemento:',
    `{"title": "cosa è successo, in una riga", "entity": "ente o azienda", "kind": uno di ${JSON.stringify(KINDS)}, "amount": numero in euro o null, "region": "regione", "place": "comune", "url": "link alla fonte", "published_on": "AAAA-MM-GG" o null, "deadline": "AAAA-MM-GG" data prevista di gara o lavori o null, "summary": "due righe con i fatti", "why": "perché interessa a questa BU"}`,
  ].filter(Boolean).join('\n');
}

// Secondo giro: solo gli atti che vengono PRIMA del bando (arrivare quando la gara non c'è ancora).
function promptPre({ buLabel, profile, days, today }) {
  return [
    `Sei l'analista commerciale di Almacis, impresa italiana di costruzioni e impianti. Oggi è il ${today}.`,
    `Cerca in rete atti e notizie pubblicati negli ultimi ${days} giorni in Italia su opere che diventeranno gare nei prossimi 18 mesi, utili alla BU «${buLabel}».`,
    `Cosa fa la BU: ${profile.description || '—'}`,
    profile.works?.length ? `Lavori tipici: ${profile.works.join('; ')}.` : '',
    profile.soa?.length ? `Categorie SOA: ${profile.soa.join(', ')}.` : '',
    profile.amount_min || profile.amount_max ? `Importi interessanti: da ${profile.amount_min ?? 0} a ${profile.amount_max ?? 'senza limite'} euro.` : '',
    profile.regions?.length ? `Zone: ${profile.regions.join(', ')}.` : 'Zone: tutta Italia.',
    profile.keywords?.length ? `Parole utili: ${profile.keywords.join(', ')}.` : '',
    'Cerca SOLO atti che vengono prima della gara, e dimmi a che punto è l’opera (campo stage):',
    '- "programmata": inserita nel programma triennale dei lavori pubblici o nel programma biennale di servizi e forniture, nel piano investimenti di una società o di un ente;',
    '- "finanziata": finanziamento assegnato (decreto PNRR, bando regionale vinto, mutuo, contributo ministeriale, fondi per la ricostruzione, delibera ARERA);',
    '- "progetto": progetto di fattibilità o esecutivo approvato con delibera, conferenza dei servizi chiusa, autorizzazione della Soprintendenza, VIA, permesso di costruire;',
    '- "determina": determina a contrarre, avviso di preinformazione, manifestazione di interesse, indagine di mercato (la gara esce entro poche settimane).',
    'NON includere gare già bandite, aggiudicazioni, leggi, decreti generici senza un’opera precisa.',
    'Per ogni opera indica quando ti aspetti il bando (expected_on, AAAA-MM-GG, anche approssimata al primo del mese) in base all’atto.',
    'Per ogni notizia metti nel campo url il link della pagina da cui l’hai presa. Se non trovi niente di utile rispondi [].',
    'Rispondi SOLO con un array JSON (massimo 8 elementi, i più utili), senza testo prima o dopo. Ogni elemento:',
    `{"title": "l'opera e l'atto, in una riga", "entity": "ente o azienda che farà la gara", "kind": "opera_finanziata" o "investimento" o "permesso" o "scadenza", "stage": uno di ${JSON.stringify(STAGES)}, "amount": numero in euro o null, "region": "regione", "place": "comune", "url": "link alla fonte", "published_on": "AAAA-MM-GG" o null, "expected_on": "AAAA-MM-GG" o null, "summary": "due righe con i fatti", "why": "perché interessa a questa BU"}`,
  ].filter(Boolean).join('\n');
}

// citazione della ricerca web più vicina alla notizia (stesse parole nel titolo), altrimenti nessuna
function citeFor(x, citations) {
  if (!citations.length) return '';
  const words = String(`${x?.title || ''} ${x?.entity || ''}`).toLowerCase().split(/[^a-zà-ù0-9]+/).filter(w => w.length > 4);
  let best = null;
  for (const c of citations) {
    const t = `${c.title || ''} ${c.url}`.toLowerCase();
    const n = words.filter(w => t.includes(w)).length;
    if (n && (!best || n > best.n)) best = { url: c.url, n };
  }
  return best ? best.url.slice(0, 500) : '';
}
// estrae l'array JSON dalla risposta (a volte arriva dentro ```json … ```)
// Dopo il JSON la ricerca web aggiunge le citazioni «([sito](link))»: si legge solo l'array, dalla prima «[» alla
// sua «]» di chiusura (contando le parentesi fuori dalle stringhe), non fino all'ultima «]» del testo.
function firstArray(s) {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1].trim().startsWith('[')) s = fenced[1];
  const start = s.indexOf('[');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}
// le notizie una per una ({…} al primo livello): se una è rotta si perdono solo lei
function objectsOf(s) {
  const out = [];
  let depth = 0, inStr = false, esc = false, start = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth++ === 0) start = i; }
    else if (c === '}' && depth > 0 && --depth === 0) {
      try { out.push(JSON.parse(s.slice(start, i + 1).replace(/,\s*}/g, '}'))); } catch { /* notizia rotta */ }
    }
  }
  return out;
}
function parseSignals(text, citations = [], diag = {}) {
  const s = String(text || '');
  const json = firstArray(s);
  let arr;
  try { arr = JSON.parse(json ?? ''); } catch (err) { diag.reason = json ? `JSON non valido (${err.message})` : 'elenco non chiuso'; arr = objectsOf(json || s.slice(Math.max(0, s.indexOf('[')))); }
  if (!Array.isArray(arr)) return [];
  diag.items = arr.length;
  const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  return arr.slice(0, 12).map(x => ({
    title: String(x?.title || '').trim().slice(0, 500), entity: String(x?.entity || '').trim().slice(0, 300),
    kind: KINDS.includes(x?.kind) ? x.kind : 'notizia', amount: Number.isFinite(Number(x?.amount)) && x?.amount !== null && x?.amount !== '' ? Number(x.amount) : null,
    region: String(x?.region || '').slice(0, 60), place: String(x?.place || '').slice(0, 120),
    url: /^https?:\/\//i.test(String(x?.url || '')) ? String(x.url).slice(0, 500) : citeFor(x, citations), published_on: date(x?.published_on), deadline: date(x?.deadline),
    summary: String(x?.summary || '').slice(0, 1500), why: String(x?.why || '').slice(0, 500),
    stage: STAGES.includes(x?.stage) ? x.stage : '', expected_on: date(x?.expected_on),
  })).filter(x => x.title && x.url);
}

async function searchBu({ apiKey, buLabel, profile, clients, today, fetchImpl = fetch, mode = '' }) {
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, tools: [{ type: 'web_search_preview', search_context_size: 'medium' }], input: prompt({ buLabel, profile, clients, today, mode }) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || 'errore'}`);
  const parts = (data.output || []).flatMap(o => o.content || []);
  const text = data.output_text || parts.map(c => c.text || '').join('\n');
  const citations = parts.flatMap(c => c.annotations || []).filter(a => a.type === 'url_citation' && a.url).map(a => ({ url: a.url, title: a.title || '' }));
  const searches = (data.output || []).filter(o => o.type === 'web_search_call').length || 1;
  const u = data.usage || {};
  const usd = ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out) / 1e6 + searches * PRICE.search;
  const diag = {};
  const signals = parseSignals(text, citations, diag);
  const flat = String(text || '').replace(/\s+/g, ' ');
  return { signals, costEur: Math.round(usd * USD_EUR * 10000) / 10000,
    raw: signals.length ? '' : `${diag.reason ? `${diag.reason}; ` : ''}${diag.items ? `${diag.items} notizie lette ma scartate (senza titolo o link); ` : ''}inizio: ${flat.slice(0, 200)} … fine: ${flat.slice(-250)}` };
}

// ── Ricerca mirata (ALM2, Dante 24/11/2026): «c'è un bando per l'ex COFA a Pescara, lo trovi?» ─────────────────────
// Quando chi lavora sa di un'occasione che il radar non ha visto, Alma la cerca sul web (albi pretori, piattaforme
// telematiche, ANAC, siti degli enti, stampa locale) e propone di aggiungerla al radar. Un modello più forte del giro
// notturno: qui conta trovare quella gara precisa, non tante notizie.
const FIND_MODEL = process.env.OPENAI_RADAR_FIND_MODEL || 'gpt-4.1';
const FIND_PRICE = { in: Number(process.env.OPENAI_FIND_PRICE_IN || 2), out: Number(process.env.OPENAI_FIND_PRICE_OUT || 8) };
const PHASES = ['bandita', 'in_arrivo', 'aggiudicata', 'scaduta', 'notizia'];

function findPrompt({ query, today }) {
  return [
    `Sei l'analista gare di Almacis, impresa italiana di costruzioni, impianti e servizi. Oggi è il ${today}.`,
    `Un collega sa di questa occasione e il nostro radar non l'ha trovata: «${query}».`,
    'Cercala in rete e trova la gara, l’avviso o l’atto preciso. Guarda soprattutto: albo pretorio e sezione «Bandi di gara e contratti» / Amministrazione trasparente dell’ente, piattaforme telematiche di e-procurement (es. TuttoGare, Net4market, Sintel, MePA, Appalti&Contratti, piattaforme regionali), ANAC (CIG), stazioni uniche appaltanti e centrali di committenza, Invitalia, siti delle società pubbliche, stampa locale.',
    'Comprendi anche le gare di servizi di ingegneria e architettura (progettazione di fattibilità, definitiva o esecutiva, direzione lavori, coordinamento sicurezza) e gli appalti integrati, oltre ai lavori.',
    'Se il bando non è ancora uscito, riporta l’atto più recente che lo annuncia (delibera, determina a contrarre, finanziamento, avviso di preinformazione, programma triennale) e quando si aspetta la gara.',
    'Non inventare: CIG, importi, date e link solo se li leggi davvero in una pagina. Per ogni risultato il campo url è il link della pagina da cui l’hai preso (meglio la pagina dell’ente o della piattaforma che un giornale).',
    'Se non trovi niente di pertinente rispondi [].',
    'Rispondi SOLO con un array JSON (massimo 5 elementi, il più pertinente per primo), senza testo prima o dopo. Ogni elemento:',
    `{"title": "oggetto della gara o dell'atto, in una riga", "entity": "ente o stazione appaltante", "phase": uno di ${JSON.stringify(PHASES)}, "kind": uno di ${JSON.stringify(KINDS)}, "stage": "" oppure uno di ${JSON.stringify(STAGES)} se non ancora bandita, "amount": importo a base di gara in euro o null, "works_amount": per una gara di progettazione o servizi tecnici, il valore complessivo dell'intervento o dei lavori da progettare in euro se lo leggi, altrimenti null, "cig": "CIG" o "", "region": "regione", "place": "comune", "url": "link alla fonte", "platform": "piattaforma o sito dove si partecipa" o "", "published_on": "AAAA-MM-GG" o null, "deadline": "AAAA-MM-GG" scadenza delle offerte o null, "expected_on": "AAAA-MM-GG" bando atteso o null, "summary": "due o tre righe con i fatti (cosa, quanto, procedura, requisiti principali)"}`,
  ].join('\n');
}

async function findOpportunity({ apiKey, query, today, fetchImpl = fetch }) {
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: FIND_MODEL, tools: [{ type: 'web_search_preview', search_context_size: 'high', user_location: { type: 'approximate', country: 'IT' } }], input: findPrompt({ query, today }) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || 'errore'}`);
  const parts = (data.output || []).flatMap(o => o.content || []);
  const text = data.output_text || parts.map(c => c.text || '').join('\n');
  const citations = parts.flatMap(c => c.annotations || []).filter(a => a.type === 'url_citation' && a.url).map(a => ({ url: a.url, title: a.title || '' }));
  const searches = (data.output || []).filter(o => o.type === 'web_search_call').length || 1;
  const u = data.usage || {};
  const costUsd = ((u.input_tokens || 0) * FIND_PRICE.in + (u.output_tokens || 0) * FIND_PRICE.out) / 1e6 + searches * PRICE.search;
  let arr;
  try { arr = JSON.parse(firstArray(String(text || '')) ?? ''); } catch { arr = objectsOf(String(text || '')); }
  if (!Array.isArray(arr)) arr = [];
  const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const found = arr.slice(0, 5).map(x => ({
    title: String(x?.title || '').trim().slice(0, 500), entity: String(x?.entity || '').trim().slice(0, 300),
    phase: PHASES.includes(x?.phase) ? x.phase : 'notizia', kind: KINDS.includes(x?.kind) ? x.kind : (x?.phase === 'bandita' ? 'gara' : 'notizia'),
    stage: STAGES.includes(x?.stage) ? x.stage : '',
    amount: Number.isFinite(Number(x?.amount)) && x?.amount !== null && x?.amount !== '' ? Number(x.amount) : null,
    cig: String(x?.cig || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
    region: String(x?.region || '').slice(0, 60), place: String(x?.place || '').slice(0, 120),
    url: /^https?:\/\//i.test(String(x?.url || '')) ? String(x.url).slice(0, 500) : citeFor(x, citations),
    platform: String(x?.platform || '').slice(0, 200),
    published_on: date(x?.published_on), deadline: date(x?.deadline), expected_on: date(x?.expected_on),
    summary: String(x?.summary || '').slice(0, 1500),
    works_amount: Number.isFinite(Number(x?.works_amount)) && x?.works_amount !== null && x?.works_amount !== '' ? Number(x.works_amount) : null,
  })).filter(x => x.title && x.url);
  return { found, sources: citations.slice(0, 8), costUsd: Math.round(costUsd * 10000) / 10000, model: FIND_MODEL };
}

module.exports = { prompt, parseSignals, searchBu, findPrompt, findOpportunity, MODEL, FIND_MODEL, STAGES, PHASES };
