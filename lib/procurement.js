// Alma Procurement (ALM2-81, canvas approvato da Dante il 24/11/2026): la logica senza database.
// - categorie del capitolato = categorie dei fornitori del CRM (Dante: «Usa quelle del CRM»), con le sottocategorie;
// - «Chiedi ad Alma»: ricerca web di fornitori con OpenAI (web_search_preview), etichette Qualità / Prezzo proposte;
// - richiesta di quotazione: le indicazioni per la bozza col tono (lib/crm-posta-ai toneDraft), l'oggetto, il livello
//   formale ↔ amichevole per la barra del canvas, la lettura dell'offerta nella risposta;
// - righe dei DDT di BOSS da file: colonne riconosciute per nome, merci proposte raggruppando le descrizioni.
const { SUPPLIER_CATEGORIES, SUPPLIER_SUBCATEGORIES } = require('./crm');

const CATEGORIES = Object.entries(SUPPLIER_CATEGORIES).map(([key, label]) => ({ key, label, subs: SUPPLIER_SUBCATEGORIES[key] || [] }));
// nomi brevi come nel canvas
const SHORT = { materiali: 'Materiali', subappalti: 'Subappalti', noli: 'Noli', servizi_cantiere: 'Servizi di cantiere', professionisti: 'Professionisti', mezzi: 'Mezzi', servizi_generali: 'Servizi generali' };
const TAGS = { qualita: 'Qualità', prezzo: 'Prezzo', da_qualificare: 'Da qualificare' };
const BUS = ['Edilizia', 'Reti AP', 'Reti MP/BP', 'Impianti', 'Facility', 'Restauro', 'Energy'];
const MODEL = process.env.OPENAI_WEB_MODEL || process.env.OPENAI_RADAR_MODEL || 'gpt-4.1-mini';
const PRICE = { in: Number(process.env.OPENAI_PRICE_IN || 0.4), out: Number(process.env.OPENAI_PRICE_OUT || 1.6), search: Number(process.env.OPENAI_PRICE_SEARCH || 0.03) };
const USD_EUR = 0.95;

// Chi vede Alma Procurement (Dante 25/11/2026: «solo io»). Si allarga con PROCUREMENT_UTENTI su Railway (email separate da
// virgola). Nei test e in locale senza la variabile lo vedono tutti quelli del CRM.
const PROC_DEFAULT = ['dante.marramiero@almacis.it'];
function procUsers() {
  const raw = process.env.PROCUREMENT_UTENTI;
  if (raw) return raw.split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  return process.env.NODE_TEST_CONTEXT || process.env.DEV_LOGIN === '1' ? null : PROC_DEFAULT;
}
const canSee = email => { const list = procUsers(); return !list || list.includes(String(email || '').toLowerCase()); };

const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const vatOf = s => String(s || '').replace(/^IT/i, '').replace(/\D/g, '').slice(0, 11);

// ── categoria proposta dalle parole (DDT, ricerca) ─────────────────────────────────────────────
const GUESS = [
  [/calcestruzz|\bcls\b|betoncin|magrone/, 'materiali', 'Calcestruzzo'], [/inert|stabilizzat|sabbia|ghiaia|pietrisc|misto/, 'materiali', 'Inerti'],
  [/acciaio|ferro|b450|tondin|rete elettrosald|carpenteria/, 'materiali', 'Acciaio e ferro lavorato'], [/bitum|conglomerat|asfalt|binder|tappetino/, 'materiali', 'Bitumi'],
  [/mattoni|laterizi|forati|blocchi/, 'materiali', 'Laterizi'], [/tubo|tubaz|pead|pvc|ghisa sferoidale|raccord/, 'materiali', 'Tubazioni'],
  [/cavo|cavi|quadro elettr|interruttor|corrugat/, 'materiali', 'Materiale elettrico'], [/idraulic|valvol|saracinesc|pozzett/, 'materiali', 'Materiale idraulico'],
  [/legname|tavol|abete|morali/, 'materiali', 'Legname'], [/isolant|impermeabil|guaina|membran/, 'materiali', 'Isolanti e impermeabilizzanti'],
  [/nolo a caldo|con operatore/, 'noli', 'Nolo a caldo'], [/autogru|\bgru\b/, 'noli', 'Gru e autogru'], [/piattaform|cestell/, 'noli', 'Piattaforme aeree'],
  [/escavator|miniescav|pala meccanic/, 'noli', 'Escavatori'], [/ponteggi/, 'noli', 'Ponteggi'], [/casser|casseform/, 'noli', 'Nolo a freddo'], [/nolo|noleggio/, 'noli', 'Nolo a freddo'],
  [/trasport/, 'servizi_cantiere', 'Trasporti'], [/smaltiment|rifiut|terre e rocce|cer \d|17 0\d/, 'servizi_cantiere', 'Rifiuti e terre da scavo'],
  [/prove di laborat|laboratorio|provini|carotagg/, 'servizi_cantiere', 'Laboratori prove'], [/rilievo|topograf/, 'servizi_cantiere', 'Rilievi'],
  [/bagni chimici|wc chimic/, 'servizi_cantiere', 'Bagni chimici'], [/vigilanz/, 'servizi_cantiere', 'Vigilanza'],
  [/gasolio|carburant/, 'servizi_generali', 'Carburante'], [/pneumatic|gomme/, 'mezzi', 'Pneumatici'], [/officina|manutenzione mezz|ricambi/, 'mezzi', 'Officina e manutenzione'],
];
function guessCategory(text) {
  const t = norm(text);
  for (const [re, category, subcategory] of GUESS) if (re.test(t)) return { category, subcategory };
  return { category: 'materiali', subcategory: '' };
}

// ── capitolato: controllo dei campi di una merce ─────────────────────────────────────────────────
function itemFields(b = {}, { partial = false } = {}) {
  const out = {};
  const txt = (k, max) => { if (b[k] !== undefined) out[k] = clean(b[k], max); };
  if (!partial || b.category !== undefined) {
    if (!SUPPLIER_CATEGORIES[b.category]) throw Object.assign(new Error('Categoria non valida'), { status: 400 });
    out.category = b.category;
  }
  if (!partial || b.name !== undefined) {
    const name = clean(b.name, 200);
    if (!name) throw Object.assign(new Error('Scrivi il nome della merce'), { status: 400 });
    out.name = name;
  }
  txt('subcategory', 100); txt('unit', 30);
  for (const k of ['specs', 'norms', 'documents', 'notes']) if (b[k] !== undefined) out[k] = String(b[k] ?? '').trim().slice(0, 2000);
  if (b.bus !== undefined) out.bus = (Array.isArray(b.bus) ? b.bus : []).map(x => clean(x, 40)).filter(Boolean).slice(0, 10);
  return out;
}

// ── Chiedi ad Alma: ricerca dei fornitori sul web ────────────────────────────────────────────────
function searchPrompt({ query, item = null, known = [], today }) {
  const cats = CATEGORIES.map(c => `${c.key} (${c.label}: ${c.subs.join(', ')})`).join('; ');
  return [
    `Sei il buyer dell'ufficio acquisti di Almacis, impresa italiana di costruzioni e impianti (sede in Abruzzo, cantieri nel Centro Italia). Oggi è il ${today}.`,
    `Richiesta della persona: «${query}».`,
    item ? `Merce del capitolato: ${item.name}${item.specs ? ` (${item.specs})` : ''}${item.unit ? `, unità ${item.unit}` : ''}.` : '',
    known.length ? `Fornitori che abbiamo già e che NON devi riproporre: ${known.slice(0, 40).join(', ')}.` : '',
    'Usa la ricerca web (siti aziendali, registro imprese, PagineGialle, Google Maps, recensioni, notizie) e trova fino a 5 fornitori italiani REALI ed esistenti che fanno al caso.',
    'Preferisci aziende vicine al luogo indicato; se non c\'è luogo, il Centro Italia. Mai inventare aziende, partite IVA, email o telefoni: se un dato non lo trovi lascialo vuoto.',
    'Per ognuno: qualita = true solo se è noto per la qualità (certificazioni come ISO 9001/FPC/CE, referenze importanti, buone recensioni); prezzo = true solo se è noto per prezzi bassi (listini pubblici bassi, discount, recensioni sul prezzo).',
    `Indica anche la merce di cui si parla, con la categoria tra queste chiavi: ${cats}.`,
    'Rispondi SOLO con JSON: {"merce": {"nome": "...", "categoria": "<chiave>", "sottocategoria": "...", "unita": "..."}, "fornitori": [{"nome": "...", "citta": "...", "provincia": "<sigla>", "piva": "...", "sito": "https://...", "email": "...", "telefono": "...", "distanza": "es. 18 km da Pescara", "perche": "una frase concreta", "qualita": true|false, "prezzo": true|false, "fonte": "https://..."}]}',
  ].filter(Boolean).join('\n');
}

function firstObject(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (!depth) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

const EMAIL_RE = /^[^\s"@<>]+@[^\s"@<>]+\.[^\s"@<>]+$/;
function parseSuppliers(text, citations = []) {
  const o = firstObject(text);
  if (!o) return { merce: null, suppliers: [], error: 'Risposta non leggibile' };
  const m = o.merce || {};
  const merce = m.nome ? { name: clean(m.nome, 200), category: SUPPLIER_CATEGORIES[m.categoria] ? m.categoria : guessCategory(m.nome).category,
    subcategory: clean(m.sottocategoria, 100), unit: clean(m.unita, 30) } : null;
  const fallback = citations[0]?.url || '';
  const seen = new Set();
  const suppliers = (Array.isArray(o.fornitori) ? o.fornitori : []).map(f => {
    const site = clean(f?.sito, 300);
    const email = clean(f?.email, 200).toLowerCase();
    return {
      name: clean(f?.nome, 200), city: clean(f?.citta, 100), province: clean(f?.provincia, 4).toUpperCase(), vat: vatOf(f?.piva),
      website: /^https?:\/\//i.test(site) ? site : site ? `https://${site.replace(/^\/+/, '')}` : '',
      email: EMAIL_RE.test(email) ? email : '', phone: clean(f?.telefono, 40), distance: clean(f?.distanza, 80), why: clean(f?.perche, 400),
      quality: f?.qualita === true, price: f?.prezzo === true,
      source: /^https?:\/\//i.test(String(f?.fonte || '')) ? clean(f.fonte, 500) : fallback,
    };
  }).filter(f => f.name && !seen.has(norm(f.name)) && seen.add(norm(f.name))).slice(0, 6);
  return { merce, suppliers };
}

async function searchWeb({ apiKey, query, item, known, today, fetchImpl = fetch }) {
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, tools: [{ type: 'web_search_preview', search_context_size: 'medium' }], input: searchPrompt({ query, item, known, today }) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || 'errore'}`);
  const parts = (data.output || []).flatMap(o => o.content || []);
  const text = data.output_text || parts.map(c => c.text || '').join('\n');
  const citations = parts.flatMap(c => c.annotations || []).filter(a => a.type === 'url_citation' && a.url).map(a => ({ url: a.url, title: a.title || '' }));
  const searches = (data.output || []).filter(o => o.type === 'web_search_call').length || 1;
  const u = data.usage || {};
  const usd = ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out) / 1e6 + searches * PRICE.search;
  return { ...parseSuppliers(text, citations), costUsd: usd, costEur: Math.round(usd * USD_EUR * 10000) / 10000 };
}

// In locale e nei test senza chiave OpenAI: tre fornitori d'esempio, dichiarati come tali.
function fakeSearch(query) {
  const g = guessCategory(query);
  const what = clean(query, 80).replace(/^(mi serve|cerco|trova(mi)?)\s+(un|una|dei|delle)?\s*(fornitore|fornitori)?\s*(di|per)?\s*/i, '') || 'merce richiesta';
  return {
    merce: { name: what.charAt(0).toUpperCase() + what.slice(1), category: g.category, subcategory: g.subcategory, unit: '' },
    suppliers: [
      { name: 'Fornitore Esempio Qualità S.r.l.', city: 'Chieti', province: 'CH', vat: '', website: 'https://esempio.invalid', email: '', phone: '', distance: '18 km', why: 'Esempio di prova (senza chiave OpenAI): certificato ISO 9001.', quality: true, price: false, source: '' },
      { name: 'Fornitore Esempio Prezzo S.r.l.', city: 'Teramo', province: 'TE', vat: '', website: 'https://esempio.invalid', email: '', phone: '', distance: '60 km', why: 'Esempio di prova: listino tra i più bassi.', quality: false, price: true, source: '' },
      { name: 'Fornitore Esempio Italia S.p.A.', city: 'Ancona', province: 'AN', vat: '', website: 'https://esempio.invalid', email: '', phone: '', distance: '145 km', why: 'Esempio di prova: consegna in 5–7 giorni.', quality: false, price: false, source: '' },
    ],
    costUsd: 0, costEur: 0, fake: true,
  };
}

// ── richiesta di quotazione ──────────────────────────────────────────────────────────────────────
const fmtDay = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : '');
function rfqSubject(rfq) {
  return clean(`Richiesta di quotazione: ${rfq.item_name}${rfq.site ? `, ${rfq.site}` : ''}`, 250);
}
// le righe che la bozza deve dire (la sostanza): toneDraft le sviluppa nel tono della persona
function rfqPoints(rfq, item = {}, { toQualify = false, firstContact = false } = {}) {
  const qty = [rfq.quantity, rfq.unit].filter(Boolean).join(' ');
  return [
    firstContact ? 'presentati in una riga: ufficio acquisti di Almacis, impresa di costruzioni e impianti' : '',
    `chiedi la migliore quotazione per ${qty ? `${qty} di ` : ''}${rfq.item_name}${rfq.site ? ` per il cantiere ${rfq.site}` : ''}`,
    item.specs ? `specifiche richieste: ${item.specs}` : '',
    item.norms ? `norme: ${item.norms}` : '',
    rfq.delivery ? `consegna: ${rfq.delivery}` : '',
    'chiedi prezzo unitario, tempi di consegna e condizioni di pagamento',
    rfq.due_date ? `chiedi di rispondere entro il ${fmtDay(rfq.due_date)}` : '',
    item.documents || toQualify ? `chiedi di allegare ${[item.documents, toQualify ? 'DURC e iscrizione alla white list se serve' : ''].filter(Boolean).join('; ')}` : '',
    rfq.notes ? rfq.notes : '',
  ].filter(Boolean).join('\n');
}
// posizione sulla barra «Formale ↔ Amichevole» del canvas (0–100)
function toneLevel(tone = {}) {
  if (!tone.n) return 15;
  if (tone.tu === true) return 85;
  if (tone.tu === false) return 35;
  return 50;
}
function toneWhy(tone = {}, name = '') {
  if (!tone.n) return 'Mai scritto: primo contatto con il tono di Almacis.';
  const who = name ? ` con ${name.split(/\s+/)[0]}` : '';
  return `${tone.n} ${tone.n === 1 ? 'email' : 'email'}${who}: ${tone.chips?.length ? tone.chips.slice(0, 2).join(', ') : 'tono cordiale'}.`;
}

// ── l'offerta nella risposta: prezzo, consegna, pagamento ────────────────────────────────────────
function offerFromText(text) {
  const t = String(text || '').replace(/\r/g, '');
  const pm = t.match(/(?:€|euro|eur)\s*([0-9]{1,3}(?:[.\s]?[0-9]{3})*(?:,[0-9]{1,2})?)\s*(?:\/|al|a|per)?\s*(m³|m3|mc|metro cubo|ton|t|kg|m|ml|ora|h|giorno|cad|pz)?/i)
    || t.match(/([0-9]{1,3}(?:[.\s]?[0-9]{3})*(?:,[0-9]{1,2})?)\s*(?:€|euro|eur)\s*(?:\/|al|a|per)?\s*(m³|m3|mc|metro cubo|ton|t|kg|m|ml|ora|h|giorno|cad|pz)?/i);
  const price = pm ? Number(pm[1].replace(/[.\s]/g, '').replace(',', '.')) : null;
  const unit = pm?.[2] ? pm[2].replace(/^(m3|mc|metro cubo)$/i, 'm³').toLowerCase().replace('m³', 'm³') : '';
  const pay = t.match(/(\d{2,3})\s*(?:gg|giorni)(?:\s*(?:d\.?f\.?f\.?m\.?|df|fm|fine mese|data fattura))*/i);
  const del = t.match(/(?:consegna|disponibil\w*|tempi)[^.\n]{0,80}/i);
  return {
    price: Number.isFinite(price) ? price : null, price_text: pm ? pm[0].trim() : '', unit,
    payment: pay ? pay[0].trim() : '', delivery: del ? clean(del[0], 120) : '', notes: '', ai: false,
  };
}

// ── DDT di BOSS da file ──────────────────────────────────────────────────────────────────────────
const COLS = {
  supplier: /^(fornitore|ragione sociale|ragionesociale|denominazione|mittente)/, vat: /(p\.?\s?iva|partita iva|piva|vat)/,
  description: /^(descrizione|articolo|materiale|merce|prodotto|voce)/, job_code: /^(commessa|cod\.? commessa|codice commessa|cantiere)/,
  bu: /^(bu|business unit|asa|divisione)/, ddt_date: /^(data|data ddt|data documento)/, quantity: /^(quantit|qta|q ta)/, unit: /^(um|u m|unit)/,
};
function ddtRows(rows, source = '') {
  if (!rows.length) return [];
  const headers = rows[0].map(h => norm(h).replace(/\s+/g, ' '));
  const idx = {};
  for (const [k, re] of Object.entries(COLS)) idx[k] = headers.findIndex(h => re.test(h));
  if (idx.supplier < 0 || idx.description < 0) throw Object.assign(new Error('Nel file servono almeno le colonne «Fornitore» e «Descrizione»'), { status: 400 });
  const val = (r, k) => (idx[k] >= 0 ? r[idx[k]] : '');
  const dateOf = x => {
    if (x === '' || x === null || x === undefined) return null;
    if (typeof x === 'number') return new Date(Math.round((x - 25569) * 864e5)).toISOString().slice(0, 10);
    const s = String(x).trim();
    const it = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (it) return `${it[3].length === 2 ? `20${it[3]}` : it[3]}-${it[2].padStart(2, '0')}-${it[1].padStart(2, '0')}`;
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  };
  return rows.slice(1).map(r => ({
    supplier: clean(val(r, 'supplier'), 200), vat: vatOf(val(r, 'vat')), description: clean(val(r, 'description'), 300),
    job_code: clean(val(r, 'job_code'), 40), bu: clean(val(r, 'bu'), 40), ddt_date: dateOf(val(r, 'ddt_date')),
    quantity: Number.isFinite(Number(String(val(r, 'quantity')).replace(',', '.'))) && val(r, 'quantity') !== '' ? Number(String(val(r, 'quantity')).replace(',', '.')) : null,
    unit: clean(val(r, 'unit'), 20), source: clean(source, 200),
  })).filter(r => r.supplier && r.description);
}
// le descrizioni dei DDT raggruppate (parole significative), per le merci proposte
const STOP = new Set(['di', 'da', 'del', 'della', 'per', 'con', 'in', 'e', 'a', 'il', 'la', 'lo', 'gli', 'le', 'un', 'una', 'al', 'nr', 'n', 'pz', 'mc', 'kg', 'ton', 'ddt', 'fornitura', 'consegna']);
const descKey = s => norm(s).split(' ').filter(w => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)).slice(0, 4).join(' ');

module.exports = {
  canSee, procUsers, CATEGORIES, SHORT, TAGS, BUS, MODEL, USD_EUR, clean, norm, vatOf, guessCategory, itemFields,
  searchPrompt, parseSuppliers, searchWeb, fakeSearch, rfqSubject, rfqPoints, toneLevel, toneWhy, offerFromText, ddtRows, descKey,
};
