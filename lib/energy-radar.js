// Alma Energy · Radar energia (ALM2-74 tappa 3): tipi di segnale, punteggio, impostazioni e ricerca web propria.
// Il punteggio (0–100) somma cinque parti, come nel radar del CRM: Coerenza (tipo di segnale), Valore (MW nella fascia),
// Tempi (scadenza vicina), Rapporto (azienda già nel CRM di Energy), Zona (regioni preferite).

const KINDS = {
  cessione: 'Cessione', autorizzazione: 'Autorizzazione', revamping: 'Revamping', conto_energia: 'Conto Energia', asta_fer: 'Asta FER', notizia: 'Notizia',
  fondo: 'Fondo cerca EPC', energivoro: 'Energivoro',
};
const SOURCES = { database_ce: 'Database CE', impianti: 'Radar di Alma Impianti', web: 'Ricerca web', manuale: 'A mano' };
// dove va il segnale preso: pipeline dell'opportunità e tipo dell'analisi
const TAKE = {
  cessione: { kind: 'revamping', type: 'acquisizione', role: 'venditore', companyType: 'proprietario' },
  revamping: { kind: 'revamping', type: 'revamping', role: 'proprietario', companyType: 'proprietario' },
  conto_energia: { kind: 'revamping', type: 'acquisizione', role: 'proprietario', companyType: 'proprietario' },
  autorizzazione: { kind: 'fv_classico', type: 'fv_nuovo', role: 'sviluppatore', companyType: 'sviluppatore' },
  asta_fer: { kind: 'fv_classico', type: 'fv_nuovo', role: 'sviluppatore', companyType: 'sviluppatore' },
  notizia: { kind: 'fv_classico', type: 'fv_nuovo', role: 'altro', companyType: 'sviluppatore' },
};
const COHERENCE = { cessione: 30, autorizzazione: 28, fondo: 28, energivoro: 26, revamping: 26, conto_energia: 22, asta_fer: 20, notizia: 10 };

const DEFAULTS = Object.freeze({
  web: true,          // ricerca web notturna (cessioni e aste FER), solo con OPENAI_API_KEY
  quota_eur: 20,      // spesa massima al mese per la ricerca web
  regions: [],        // regioni preferite (vuoto = tutta Italia)
  mw_min: 0.5, mw_max: 20,
  ce_limit: 40,       // proprietari dal Database CE per giro
});
function normalizeSettings(v = {}) {
  const num = (x, d, min, max) => (Number.isFinite(Number(x)) ? Math.min(Math.max(Number(x), min), max) : d);
  return {
    web: v.web === undefined ? DEFAULTS.web : Boolean(v.web),
    quota_eur: num(v.quota_eur, DEFAULTS.quota_eur, 0, 500),
    regions: Array.isArray(v.regions) ? v.regions.map(r => String(r).trim()).filter(Boolean).slice(0, 20) : [],
    mw_min: num(v.mw_min, DEFAULTS.mw_min, 0, 1000),
    mw_max: num(v.mw_max, DEFAULTS.mw_max, 0, 5000),
    ce_limit: num(v.ce_limit, DEFAULTS.ce_limit, 0, 500),
  };
}

const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// «3,4 MW», «980 kWp», «6 MWp» → MW
function mwOf(...texts) {
  for (const t of texts) {
    const m = /(\d{1,4}(?:[.,]\d{1,3})?)\s*(mwp?|kwp?)\b/i.exec(String(t || ''));
    if (m) {
      const n = Number(m[1].replace(',', '.'));
      return /^k/i.test(m[2]) ? n / 1000 : n;
    }
  }
  return null;
}

// Tipo di un segnale letto da una notizia (radar di Alma Impianti, ricerca web).
function kindOf(text) {
  const t = norm(text);
  if (/(in vendita|cession|cede |vende |vendita di|acquisizion|portafoglio|data room|advisor|asta giudiziar)/.test(t)) return 'cessione';
  if (/(fer ?x|fer ?2|graduatori|contingente|asta gse|aste gse|registri gse)/.test(t)) return 'asta_fer';
  if (/(autorizzat|paur|\bpas\b|autorizzazione unica|\bvia\b|valutazione di impatto|ready to build|\brtb\b|agrivoltaic)/.test(t)) return 'autorizzazione';
  if (/(revamping|repowering)/.test(t)) return 'revamping';
  return 'notizia';
}

function scoreOf(sig, settings, { knownCompany = false, today = new Date().toISOString().slice(0, 10) } = {}) {
  const s = normalizeSettings(settings);
  const coherence = COHERENCE[sig.kind] ?? 10;
  const mw = sig.mw === null || sig.mw === undefined || sig.mw === '' ? null : Number(sig.mw);
  const value = mw === null ? 12 : mw >= s.mw_min && mw <= s.mw_max ? 25 : 8;
  let timing = 8;
  if (sig.deadline) {
    const days = (Date.parse(`${sig.deadline}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5;
    timing = days < 0 ? 2 : days <= 60 ? 20 : days <= 180 ? 12 : 8;
  }
  const relationship = knownCompany ? 15 : 5;
  const area = !s.regions.length ? 10 : sig.region && s.regions.some(r => norm(r) === norm(sig.region)) ? 10 : 3;
  const parts = { coerenza: coherence, valore: value, tempi: timing, rapporto: relationship, zona: area };
  return { score: Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0)), parts };
}

// ── ricerca web propria: cessioni di impianti e aste FER (le autorizzazioni arrivano dal radar di Alma Impianti) ──
const SEARCHES = [
  { kind: 'cessione', label: 'Cessioni di impianti',
    hint: 'impianti fotovoltaici, eolici o idroelettrici già in esercizio messi in vendita in Italia: cessioni di impianti o di portafogli, SPV in vendita, data room aperte da advisor, impianti in aste giudiziarie o di società in liquidazione, fondi che escono da un investimento' },
  // ALM2-83: clienti potenziali. Fondi infrastrutturali che devono trovare chi costruisce; energivori da efficientare.
  { kind: 'fondo', label: 'Fondi che cercano un EPC', force: true,
    hint: 'fondi d\'investimento infrastrutturali e investitori che in Italia comprano progetti rinnovabili autorizzati o pronti da costruire (ready to build), raccolgono capitali per fotovoltaico, agrivoltaico, biometano o accumuli, o entrano nel mercato italiano: dovranno scegliere un EPC che costruisca. Scrivi il nome del fondo in entity e, se li sai, MW, tecnologia e regioni' },
  { kind: 'energivoro', label: 'Energivori da chiamare', force: true,
    hint: 'aziende industriali energivore in Italia (carta, vetro, ceramica, acciaio, chimica, alimentare, logistica) che annunciano nuovi stabilimenti o reparti, ampliamenti, investimenti in efficienza energetica, impianti fotovoltaici, diagnosi energetiche, cambi di proprietà o di direzione tecnica: momenti buoni per proporre efficienza e un PPA sul tetto. Scrivi il nome dell\'azienda in entity' },
  { kind: 'asta_fer', label: 'Aste FER',
    hint: 'esiti delle aste e dei registri GSE (FER X, FER 2, decreto FER 1): graduatorie pubblicate, progetti esclusi o fuori contingente, sviluppatori con progetti autorizzati senza incentivo che potrebbero cedere' },
];

function prompt({ hint, settings, today, days = 14 }) {
  const s = normalizeSettings(settings);
  return [
    `Sei l'analista di Almacis Energy, produttore indipendente di energia (IPP) che compra e sviluppa impianti da fonti rinnovabili in Italia. Oggi è il ${today}.`,
    `Cerca in rete le notizie degli ultimi ${days} giorni su: ${hint}.`,
    `Interessano impianti o progetti tra ${s.mw_min} e ${s.mw_max} MW${s.regions.length ? `, meglio se in ${s.regions.join(', ')}` : ', in tutta Italia'}.`,
    'Per ogni notizia utile scrivi chi vende o chi ha il progetto, dove, quanti MW, a che punto è, entro quando conviene muoversi.',
    'Rispondi solo con un elenco JSON di al massimo 8 oggetti, senza testo prima o dopo, ciascuno così:',
    '{"title": "cosa è successo, in una riga, con i MW se li sai", "entity": "chi vende o ha il progetto", "kind": "notizia", "amount": prezzo o valore in euro o null, "region": "regione", "place": "comune", "url": "link alla fonte", "published_on": "AAAA-MM-GG" o null, "deadline": "AAAA-MM-GG" entro quando muoversi o null, "summary": "due righe con i fatti", "why": "perché interessa a un IPP"}',
  ].join('\n');
}

const PRICE = { in: Number(process.env.OPENAI_PRICE_IN || 0.4), out: Number(process.env.OPENAI_PRICE_OUT || 1.6), search: Number(process.env.OPENAI_PRICE_SEARCH || 0.03) };
async function searchWeb({ apiKey, search, settings, today, fetchImpl = fetch }) {
  const { parseSignals, MODEL } = require('./crm-radar-ai');
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, tools: [{ type: 'web_search_preview', search_context_size: 'medium' }], input: prompt({ hint: search.hint, settings, today }) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || 'errore'}`);
  const parts = (data.output || []).flatMap(o => o.content || []);
  const text = data.output_text || parts.map(c => c.text || '').join('\n');
  const citations = parts.flatMap(c => c.annotations || []).filter(a => a.type === 'url_citation' && a.url).map(a => ({ url: a.url, title: a.title || '' }));
  const searches = (data.output || []).filter(o => o.type === 'web_search_call').length || 1;
  const u = data.usage || {};
  const usd = ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out) / 1e6 + searches * PRICE.search;
  const signals = parseSignals(text, citations).map(x => {
    const k = kindOf(`${x.title} ${x.summary}`);
    return { ...x, kind: search.force || k === 'notizia' ? search.kind : k, mw: mwOf(x.title, x.summary) };
  });
  return { signals, costEur: Math.round(usd * 0.95 * 10000) / 10000 };
}

module.exports = { KINDS, SOURCES, TAKE, DEFAULTS, normalizeSettings, mwOf, kindOf, scoreOf, SEARCHES, searchWeb, prompt };
