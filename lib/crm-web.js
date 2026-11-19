// «Cerca su internet» per un'anagrafica del CRM (canvas v9, Dante 19/11/2026): OpenAI con la ricerca web.
// Se ci sono più aziende plausibili Alma non sceglie: propone le alternative e la persona dice qual è; poi cerca i dati
// di quella, ognuno con la sua fonte. Niente si salva da solo: i dati si spuntano e si confermano nella scheda.
const MODEL = process.env.OPENAI_WEB_MODEL || process.env.OPENAI_RADAR_MODEL || 'gpt-4.1-mini';
const PRICE = { in: Number(process.env.OPENAI_PRICE_IN || 0.4), out: Number(process.env.OPENAI_PRICE_OUT || 1.6), search: Number(process.env.OPENAI_PRICE_SEARCH || 0.03) };
const USD_EUR = 0.95;

// campi che la ricerca può riempire, con l'etichetta che vede la persona
const WEB_FIELDS = {
  legal_form: 'Forma giuridica', vat: 'P.IVA', tax_code: 'Codice fiscale', pec: 'PEC', sdi_code: 'Codice SDI',
  address: 'Indirizzo', zip: 'CAP', city: 'Comune', province: 'Provincia', region: 'Regione',
  phone: 'Telefono', email: 'Email', website: 'Sito', linkedin: 'LinkedIn',
  ateco: 'ATECO', employees: 'Dipendenti', revenue: 'Fatturato',
};

function prompt(subject, choice) {
  const known = [
    subject.city && `comune: ${subject.city}`, subject.province && `provincia: ${subject.province}`, subject.vat && `P.IVA: ${subject.vat}`,
    subject.website && `sito: ${subject.website}`, subject.email && `email: ${subject.email}`, subject.domain && `dominio email dei contatti: ${subject.domain}`,
  ].filter(Boolean).join('; ');
  const target = choice
    ? `L'azienda è questa (scelta dalla persona): ${[choice.name, choice.city, choice.vat && `P.IVA ${choice.vat}`, choice.website, choice.note].filter(Boolean).join(' · ')}.`
    : `Cerca l'azienda o l'ente italiano «${subject.name}»${known ? ` (dati già noti: ${known})` : ''}.`;
  return `${target}
Usa la ricerca web (sito ufficiale, registro imprese, IndicePA, PagineGialle, LinkedIn, Google Maps).
${choice ? '' : `Se trovi più aziende o enti diversi che potrebbero essere questo e i dati noti non bastano per essere sicuri, NON scegliere: rispondi solo con
{"ambigua": true, "candidati": [{"nome": "...", "citta": "...", "piva": "...", "sito": "...", "descrizione": "cosa fa, in poche parole"}]} (al massimo 4).
`}Se sei sicuro di quale sia, rispondi solo con
{"ambigua": false, "azienda": {"nome": "...", "citta": "...", "piva": "...", "sito": "..."}, "dati": [{"campo": "...", "valore": "...", "fonte": "url della pagina"}]}
I campi possibili sono: ${Object.keys(WEB_FIELDS).join(', ')}. Provincia come sigla (PE, CH…). Metti solo i dati che hai visto in una fonte, con la sua url; non inventare.
Rispondi solo con il JSON, senza altro testo.`;
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

const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
function parseAnswer(text, citations = []) {
  const o = firstObject(text);
  if (!o) return { ambiguous: false, candidates: [], company: null, fields: [], error: 'Risposta non leggibile' };
  if (o.ambigua) {
    const candidates = (Array.isArray(o.candidati) ? o.candidati : []).slice(0, 4).map(c => ({
      name: clean(c?.nome), city: clean(c?.citta, 100), vat: clean(c?.piva, 20).replace(/\s/g, ''), website: clean(c?.sito), note: clean(c?.descrizione, 300),
    })).filter(c => c.name);
    return { ambiguous: candidates.length > 1, candidates, company: candidates.length === 1 ? candidates[0] : null, fields: [] };
  }
  const fallback = citations[0]?.url || '';
  const seen = new Set();
  const fields = (Array.isArray(o.dati) ? o.dati : []).map(d => ({ key: String(d?.campo || ''), value: clean(d?.valore, 300), source: /^https?:\/\//i.test(String(d?.fonte || '')) ? clean(d.fonte, 500) : fallback }))
    .filter(d => WEB_FIELDS[d.key] && d.value && !seen.has(d.key) && seen.add(d.key))
    .map(d => ({ ...d, label: WEB_FIELDS[d.key] }));
  const a = o.azienda || {};
  return { ambiguous: false, candidates: [], company: { name: clean(a.nome), city: clean(a.citta, 100), vat: clean(a.piva, 20), website: clean(a.sito) }, fields };
}

async function searchCompany({ apiKey, subject, choice = null, fetchImpl = fetch }) {
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, tools: [{ type: 'web_search_preview', search_context_size: 'medium' }], input: prompt(subject, choice) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || 'errore'}`);
  const parts = (data.output || []).flatMap(o => o.content || []);
  const text = data.output_text || parts.map(c => c.text || '').join('\n');
  const citations = parts.flatMap(c => c.annotations || []).filter(a => a.type === 'url_citation' && a.url).map(a => ({ url: a.url, title: a.title || '' }));
  const searches = (data.output || []).filter(o => o.type === 'web_search_call').length || 1;
  const u = data.usage || {};
  const usd = ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out) / 1e6 + searches * PRICE.search;
  return { ...parseAnswer(text, citations), costEur: Math.round(usd * USD_EUR * 10000) / 10000 };
}

module.exports = { WEB_FIELDS, prompt, parseAnswer, searchCompany, MODEL };
