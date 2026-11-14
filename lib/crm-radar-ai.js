// Radar AI: ogni notte, per ogni BU accesa, cerca in rete le notizie degli ultimi giorni che possono diventare lavoro
// (investimenti, finanziamenti, permessi, opere finanziate, contratti in scadenza, notizie sui clienti) e le
// restituisce come segnali. Usa OpenAI (Dante 14/11/2026: chiave OpenAI) con la ricerca web; senza OPENAI_API_KEY
// non fa niente. La spesa stimata si conta per BU e mese e si ferma alla quota (crm_settings.radar).

const MODEL = process.env.OPENAI_RADAR_MODEL || 'gpt-4.1-mini';
// prezzi per la stima (USD): token per milione e ricerca per chiamata; cambio fisso prudente
const PRICE = { in: Number(process.env.OPENAI_PRICE_IN || 0.4), out: Number(process.env.OPENAI_PRICE_OUT || 1.6), search: Number(process.env.OPENAI_PRICE_SEARCH || 0.03) };
const USD_EUR = 0.95;
const KINDS = ['opera_finanziata', 'scadenza', 'permesso', 'nuovo_gestore', 'investimento', 'cliente', 'notizia', 'gara'];

function prompt({ buLabel, profile, clients, days = 14, today }) {
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
    'NON includere gare già bandite (le segue l\'ufficio gare), notizie senza un committente identificabile o più vecchie del periodo.',
    'Per ogni notizia metti nel campo url il link della pagina da cui l\'hai presa. Se non trovi niente di utile rispondi [].',
    'Rispondi SOLO con un array JSON (massimo 8 elementi, i più utili), senza testo prima o dopo. Ogni elemento:',
    `{"title": "cosa è successo, in una riga", "entity": "ente o azienda", "kind": uno di ${JSON.stringify(KINDS)}, "amount": numero in euro o null, "region": "regione", "place": "comune", "url": "link alla fonte", "published_on": "AAAA-MM-GG" o null, "deadline": "AAAA-MM-GG" data prevista di gara o lavori o null, "summary": "due righe con i fatti", "why": "perché interessa a questa BU"}`,
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
function parseSignals(text, citations = []) {
  const m = String(text || '').match(/\[[\s\S]*\]/);
  if (!m) return [];
  let arr;
  try { arr = JSON.parse(m[0]); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  return arr.slice(0, 12).map(x => ({
    title: String(x?.title || '').trim().slice(0, 500), entity: String(x?.entity || '').trim().slice(0, 300),
    kind: KINDS.includes(x?.kind) ? x.kind : 'notizia', amount: Number.isFinite(Number(x?.amount)) && x?.amount !== null && x?.amount !== '' ? Number(x.amount) : null,
    region: String(x?.region || '').slice(0, 60), place: String(x?.place || '').slice(0, 120),
    url: /^https?:\/\//i.test(String(x?.url || '')) ? String(x.url).slice(0, 500) : citeFor(x, citations), published_on: date(x?.published_on), deadline: date(x?.deadline),
    summary: String(x?.summary || '').slice(0, 1500), why: String(x?.why || '').slice(0, 500),
  })).filter(x => x.title && x.url && x.kind !== 'gara');
}

async function searchBu({ apiKey, buLabel, profile, clients, today, fetchImpl = fetch }) {
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, tools: [{ type: 'web_search_preview', search_context_size: 'medium' }], input: prompt({ buLabel, profile, clients, today }) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || 'errore'}`);
  const parts = (data.output || []).flatMap(o => o.content || []);
  const text = data.output_text || parts.map(c => c.text || '').join('\n');
  const citations = parts.flatMap(c => c.annotations || []).filter(a => a.type === 'url_citation' && a.url).map(a => ({ url: a.url, title: a.title || '' }));
  const searches = (data.output || []).filter(o => o.type === 'web_search_call').length || 1;
  const u = data.usage || {};
  const usd = ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out) / 1e6 + searches * PRICE.search;
  const signals = parseSignals(text, citations);
  return { signals, costEur: Math.round(usd * USD_EUR * 10000) / 10000, raw: signals.length ? '' : String(text || '').replace(/\s+/g, ' ').slice(0, 400) };
}

module.exports = { prompt, parseSignals, searchBu, MODEL };
