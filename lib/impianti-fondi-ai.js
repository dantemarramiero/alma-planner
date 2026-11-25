// «Trova fondi con Alma» (ALM2-73): Alma cerca in rete i fondi e gli investitori che finanziano in Italia impianti nei
// settori della BU (fotovoltaico, biometano, depurazione e idrico, efficientamento, impianti negli edifici) e ne propone
// il mandato. Niente si scrive da solo: chi guarda sceglie quali aggiungere al CRM (regola «Alma propone, una persona
// conferma»). Usa OpenAI con la ricerca web come il radar; senza OPENAI_API_KEY non fa niente.
const { SECTOR_KEYS, PHASES } = require('./impianti');

const MODEL = process.env.OPENAI_RADAR_MODEL || 'gpt-4.1-mini';
const PRICE = { in: Number(process.env.OPENAI_PRICE_IN || 0.4), out: Number(process.env.OPENAI_PRICE_OUT || 1.6), search: Number(process.env.OPENAI_PRICE_SEARCH || 0.03) };
const USD_EUR = 0.95;

function promptFondi({ sector = '', region = '', known = [], today }) {
  return [
    `Sei l'analista commerciale di Almacis, impresa italiana che costruisce impianti chiavi in mano (EPC). Oggi è il ${today}.`,
    'Cerca in rete fondi d\'investimento, SGR, investitori infrastrutturali, IPP finanziari ed ESCo che investono in Italia in impianti e che quindi hanno bisogno di un costruttore (EPC).',
    sector ? `Concentrati sul settore: ${sector}.` : 'Settori: fotovoltaico e agrivoltaico, biometano e biogas, depurazione e servizio idrico, efficienza energetica e PPA per le aziende, impianti per edifici e logistica.',
    region ? `Preferisci chi investe in ${region}.` : 'Tutta Italia.',
    known.length ? `NON riproporre questi, li conosciamo già: ${known.slice(0, 60).join('; ')}.` : '',
    'Solo soggetti reali e attivi, con un investimento o una raccolta in Italia negli ultimi 24 mesi. Niente banche generiche, niente elenchi di settore.',
    'Per ogni soggetto metti nel campo url la pagina da cui hai preso l\'informazione (sito ufficiale o notizia). Se non trovi niente di utile rispondi [].',
    'Rispondi SOLO con un array JSON (massimo 10 elementi), senza testo prima o dopo. Ogni elemento:',
    `{"name": "nome del fondo o della SGR", "type": "fondo infrastrutturale | SGR | IPP | ESCo | family office | altro", "city": "città della sede in Italia o \\"\\"", "website": "sito ufficiale o \\"\\"", "techs": array tra ${JSON.stringify(SECTOR_KEYS)}, "ticket_min": numero in euro o null, "ticket_max": numero in euro o null, "regions": array di regioni italiane (vuoto = tutta Italia), "phases": array tra ${JSON.stringify(PHASES.map(p => p[0]))}, "seeks_epc": true o false, "why": "una riga: cosa ha fatto di recente in Italia", "url": "link alla fonte"}`,
  ].filter(Boolean).join('\n');
}

// gli oggetti {…} al primo livello, uno per uno: se uno è rotto si perde solo lui
function objectsOf(s) {
  const out = [];
  let depth = 0, inStr = false, esc = false, start = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth++ === 0) start = i; }
    else if (c === '}' && depth > 0 && --depth === 0) { try { out.push(JSON.parse(s.slice(start, i + 1).replace(/,\s*}/g, '}'))); } catch { /* rotto */ } }
  }
  return out;
}
// legge l'array anche se arriva dentro ```json```, dopo del testo con link «[sito](…)» o con le citazioni dopo
function parseFondi(text) {
  let s = String(text || '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) s = fenced[1];
  const m = /\[\s*(\{|\])/.exec(s);           // la prima «[» seguita da «{» o «]», non quella di un link
  const start = m ? m.index : -1;
  if (start < 0) return clean(objectsOf(s));
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '[') depth++; else if (c === ']' && --depth === 0) { end = i; break; }
  }
  let arr;
  try { arr = JSON.parse(s.slice(start, end + 1)); } catch { arr = objectsOf(s.slice(start)); }
  return clean(arr);
}
function clean(arr) {
  if (!Array.isArray(arr)) return [];
  const money = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));
  const list = (v, allowed) => (Array.isArray(v) ? [...new Set(v.map(String))].filter(x => !allowed || allowed.includes(x)) : []);
  return arr.slice(0, 12).map(x => ({
    name: String(x?.name || '').replace(/\s+/g, ' ').trim().slice(0, 200), type: String(x?.type || '').slice(0, 60), city: String(x?.city || '').slice(0, 120),
    website: /^https?:\/\//i.test(String(x?.website || '')) ? String(x.website).slice(0, 300) : '', techs: list(x?.techs, SECTOR_KEYS),
    ticket_min: money(x?.ticket_min), ticket_max: money(x?.ticket_max), regions: list(x?.regions).slice(0, 20).map(r => r.slice(0, 60)),
    phases: list(x?.phases, PHASES.map(p => p[0])), seeks_epc: x?.seeks_epc !== false, why: String(x?.why || '').slice(0, 400),
    url: /^https?:\/\//i.test(String(x?.url || '')) ? String(x.url).slice(0, 500) : '',
  })).filter(x => x.name && x.url);
}

async function searchFondi({ apiKey, fetchImpl = fetch, ...opts }) {
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, tools: [{ type: 'web_search_preview', search_context_size: 'medium' }], input: promptFondi(opts) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || 'errore'}`);
  const text = data.output_text || (data.output || []).flatMap(o => o.content || []).map(c => c.text || '').join('\n');
  const searches = (data.output || []).filter(o => o.type === 'web_search_call').length || 1;
  const u = data.usage || {};
  const usd = ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out) / 1e6 + searches * PRICE.search;
  const funds = parseFondi(text);
  const flat = String(text || '').replace(/\s+/g, ' ');
  return { funds, costEur: Math.round(usd * USD_EUR * 10000) / 10000, raw: funds.length ? '' : `${flat.slice(0, 300)} … ${flat.slice(-200)}` };
}

module.exports = { promptFondi, parseFondi, searchFondi, objectsOf };
