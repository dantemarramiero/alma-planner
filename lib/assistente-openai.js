// Alma: le chiamate al modello, con OpenAI (Dante 17/11/2026: «usiamo OpenAI», la stessa OPENAI_API_KEY del radar).
// Il resto di Alma (route, ricerche, proposte, ricevute, test) parla il formato dei messaggi a blocchi nato con Bacco
// (text / tool_use / tool_result): qui lo si traduce nelle Chat Completions di OpenAI e la risposta torna nello stesso
// formato ({ role, stop_reason, usage, content }). Così il motore di Alma non cambia.
// Due modelli, come nella cantina: uno veloce ed economico per le domande semplici e per preparare ticket/note, uno più
// forte per le analisi. I nomi interni restano «haiku» (veloce) e «sonnet» (analisi) perché sono salvati nelle
// impostazioni (model_mode); i modelli veri si cambiano da Railway con OPENAI_ALMA_MODEL_FAST e OPENAI_ALMA_MODEL.
// In automatico sceglie un classificatore (il modello veloce, 2,5 secondi al massimo, poi una regola sulle parole).
// Memoria corta: oltre ~80.000 caratteri di conversazione si tolgono i risultati delle ricerche più vecchi (restano gli ultimi 6).
const { HttpError } = require('./http');

const API = 'https://api.openai.com/v1/chat/completions';
const MODELS = { haiku: process.env.OPENAI_ALMA_MODEL_FAST || 'gpt-4.1-mini', sonnet: process.env.OPENAI_ALMA_MODEL || 'gpt-4.1' };
// Dollari per milione di token (input, output, input già in cache). OpenAI non fa pagare la scrittura della cache.
const KNOWN_PRICES = {
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cache_read: 0.1, cache_write: 0 },
  'gpt-4.1': { input: 2, output: 8, cache_read: 0.5, cache_write: 0 },
};
const PRICES = { ...KNOWN_PRICES, [MODELS.haiku]: KNOWN_PRICES[MODELS.haiku] || KNOWN_PRICES['gpt-4.1-mini'], [MODELS.sonnet]: KNOWN_PRICES[MODELS.sonnet] || KNOWN_PRICES['gpt-4.1'] };
const LABELS = { [MODELS.haiku]: 'OpenAI ' + MODELS.haiku, [MODELS.sonnet]: 'OpenAI ' + MODELS.sonnet, 'gpt-4o-transcribe': 'Voce: dettatura (OpenAI)', 'gpt-4o-mini-tts': 'Voce: «Ascolta» (OpenAI)', 'web-search': 'Ricerca bandi sul web (OpenAI)' };
const ANALYSIS = /(rispetto|confront|anno (scorso|prima|precedente)|andament|trend|perch[eé]|analis|crescit|calo|percentual|%|in media|win ratio|classific|migliori|peggiori|per (mese|mesi|persona|persone|progetto|progetti|bu|zona|regione|categoria)|riepilog|riassum|cos'?\s*[eè] successo|chi ci batte|concorren)/i;
const MODE_LABELS = { auto: `Automatico (${MODELS.haiku}, ${MODELS.sonnet} per le analisi)`, sonnet: `Sempre ${MODELS.sonnet}`, haiku: `Sempre ${MODELS.haiku}` };
const pickModel = (text, mode) => (mode === 'sonnet' ? MODELS.sonnet : mode === 'haiku' ? MODELS.haiku : ANALYSIS.test(text) ? MODELS.sonnet : MODELS.haiku);
const textOf = content => (content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
const apiKey = () => (process.env.OPENAI_API_KEY || '').trim();

const ROUTER_TIMEOUT_MS = 2500;
const ROUTER_SYSTEM = `Scegli il modello che risponde a una domanda fatta ad Alma, l'assistente di Alma Space (gestionale interno di Almacis, impresa di costruzioni e servizi).
Rispondi "analisi" quando serve ragionare sui dati: confronti tra periodi, andamenti, classifiche, numeri divisi per persona/progetto/BU, percentuali e medie, win ratio, concorrenza, cause («perché»), riepiloghi di un progetto o di più cose, domande che richiedono di combinare più ricerche.
Rispondi "veloce" per tutto il resto: un dato solo, un elenco semplice, trovare una scheda, un ticket o una persona, la mia settimana, preparare ticket/note/passi/contatti, saluti, conferme, correzioni brevi.
Se c'è la domanda precedente, usala per capire le domande brevi di seguito (es. «e per persona?»).`;
const ROUTER_SCHEMA = { type: 'object', properties: { modello: { type: 'string', enum: ['veloce', 'analisi'] } }, required: ['modello'], additionalProperties: false };

function routerParams(text, prev) {
  const ask = (prev ? `Domanda precedente: ${prev.slice(0, 500)}\n` : '') + `Domanda: ${text.slice(0, 1500)}`;
  return { model: MODELS.haiku, max_completion_tokens: 32, messages: [{ role: 'system', content: ROUTER_SYSTEM }, { role: 'user', content: ask }],
    response_format: { type: 'json_schema', json_schema: { name: 'scelta', strict: true, schema: ROUTER_SCHEMA } } };
}

// ---- traduzione dei messaggi a blocchi → OpenAI ----
const sysText = system => (typeof system === 'string' ? system : (system || []).map(b => b.text || '').filter(Boolean).join('\n\n'));
const strOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => (b.type === 'text' ? b.text : '')).join('\n') : JSON.stringify(c ?? ''));
const KEEP_RESULTS = 6, TRIM_AT = 80000;
const TRIMMED = JSON.stringify({ tolto: 'Risultato di una ricerca vecchia, tolto per spazio: se serve ancora, rifai la ricerca.' });

function toOpenAI(system, messages) {
  const out = [{ role: 'system', content: sysText(system) }];
  for (const m of messages || []) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content || []);
    if (m.role === 'assistant') {
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const calls = blocks.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
      if (!text && !calls.length) continue;
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // utente: prima i risultati delle ricerche (devono seguire subito la risposta con le chiamate), poi il testo
    for (const b of blocks.filter(x => x.type === 'tool_result')) out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: strOf(b.content) });
    const parts = [];
    for (const b of blocks) {
      if (b.type === 'text' && b.text) parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image' && b.source && b.source.type === 'base64') parts.push({ type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
      else if (b.type === 'document' && b.source && b.source.type === 'base64') parts.push({ type: 'file', file: { filename: b.title || 'documento.pdf', file_data: `data:${b.source.media_type};base64,${b.source.data}` } });
    }
    if (parts.length) out.push({ role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts });
  }
  // memoria corta: oltre la soglia si svuotano i risultati più vecchi, restano gli ultimi KEEP_RESULTS
  const lenOf = c => (typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((a, p) => a + (p.type === 'text' ? p.text.length : 0), 0) : 0); // le foto non contano
  const size = out.reduce((a, m) => a + lenOf(m.content) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
  if (size > TRIM_AT) {
    const tools = out.filter(m => m.role === 'tool');
    tools.slice(0, Math.max(0, tools.length - KEEP_RESULTS)).forEach(m => { m.content = TRIMMED; });
  }
  return out;
}
const toolsOf = tools => (tools || []).filter(t => t.input_schema).map(t => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema } }));
function choiceOf(tc) {
  if (!tc) return undefined;
  if (tc.type === 'none') return 'none';
  if (tc.type === 'any') return 'required';
  if (tc.type === 'tool') return { type: 'function', function: { name: tc.name } };
  return 'auto';
}
const STOP = { tool_calls: 'tool_use', function_call: 'tool_use', stop: 'end_turn', length: 'max_tokens', content_filter: 'refusal' };
function usageOf(u = {}) {
  const cached = Number((u.prompt_tokens_details || {}).cached_tokens || 0);
  return { input_tokens: Math.max(0, Number(u.prompt_tokens || 0) - cached), output_tokens: Number(u.completion_tokens || 0), cache_read_input_tokens: cached, cache_creation_input_tokens: 0 };
}
function costOf(u = {}, model = MODELS.sonnet) {
  const P = PRICES[model] || PRICES[MODELS.sonnet];
  return (Number(u.input_tokens || 0) * P.input + Number(u.output_tokens || 0) * P.output
    + Number(u.cache_read_input_tokens || 0) * P.cache_read + Number(u.cache_creation_input_tokens || 0) * P.cache_write) / 1e6;
}

async function post(body, signal, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(API, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey()}` }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') throw e;
    throw new HttpError(502, 'OpenAI non risponde in questo momento: riprova.');
  }
  if (res.ok) return res;
  let msg = '';
  try { const j = await res.json(); msg = (j.error && (j.error.code || j.error.message)) || ''; } catch { /* corpo non JSON */ }
  console.warn('[alma] errore OpenAI', res.status, String(msg).slice(0, 300));
  if (res.status === 401) throw new HttpError(503, 'La chiave OpenAI (OPENAI_API_KEY) non è valida.');
  if (res.status === 429 && /insufficient_quota|quota/i.test(msg)) throw new HttpError(503, 'Il credito OpenAI è finito: va ricaricato su platform.openai.com.');
  if (res.status === 429) throw new HttpError(503, 'OpenAI è occupato in questo momento: riprova tra un minuto.');
  throw new HttpError(502, `OpenAI ha risposto con un errore (${res.status}): riprova.`);
}

async function openaiRoute(text, prev) {
  const res = await post(routerParams(text, prev), AbortSignal.timeout(ROUTER_TIMEOUT_MS));
  const j = await res.json();
  const choice = JSON.parse((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '{}').modello;
  return { model: choice === 'analisi' ? MODELS.sonnet : choice === 'veloce' ? MODELS.haiku : null, usage: usageOf(j.usage) };
}

// Legge il flusso SSE delle Chat Completions e rimette insieme testo e chiamate alle ricerche.
async function readStream(res, opts) {
  const dec = new TextDecoder();
  let buf = '', text = '', finish = null, usage = {};
  const calls = []; // per indice: { id, name, args }
  const onLine = line => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const ev = JSON.parse(data);
    if (ev.usage) usage = ev.usage;
    const ch = ev.choices && ev.choices[0];
    if (!ch) return;
    const d = ch.delta || {};
    if (d.content) { text += d.content; if (opts.onText) opts.onText(d.content); }
    for (const tc of d.tool_calls || []) {
      const c = calls[tc.index] || (calls[tc.index] = { id: '', name: '', args: '' });
      if (tc.id) c.id = tc.id;
      if (tc.function && tc.function.name) { c.name += tc.function.name; if (opts.onTool) opts.onTool(c.name); }
      if (tc.function && tc.function.arguments) c.args += tc.function.arguments;
    }
    if (ch.finish_reason) finish = ch.finish_reason;
  };
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
  }
  if (buf.trim()) onLine(buf.trim());
  return { text, finish, usage, calls: calls.filter(Boolean) };
}
function toResponse({ text, finish, usage, calls }) {
  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const c of calls) {
    let input = {};
    try { input = c.args ? JSON.parse(c.args) : {}; } catch { input = {}; }
    content.push({ type: 'tool_use', id: c.id || `call_${Math.random().toString(36).slice(2, 10)}`, name: c.name, input });
  }
  const stop = calls.length ? 'tool_use' : (STOP[finish] || 'end_turn');
  return { role: 'assistant', stop_reason: stop, usage: usageOf(usage), content };
}

// params nel formato a blocchi ({ model, max_tokens, system, tools, tool_choice, messages }); il resto si ignora.
// opts (risposta in diretta): onText(pezzo di testo), onTool(nome della ricerca appena chiesta), signal per fermare.
async function openaiCall(params, opts = null) {
  const tools = toolsOf(params.tools);
  const body = { model: params.model || MODELS.sonnet, messages: toOpenAI(params.system, params.messages),
    ...(params.max_tokens ? { max_completion_tokens: params.max_tokens } : {}),
    ...(tools.length ? { tools, tool_choice: choiceOf(params.tool_choice) || 'auto', parallel_tool_calls: true } : {}),
    stream: true, stream_options: { include_usage: true } };
  const res = await post(body, opts && opts.signal);
  return toResponse(await readStream(res, opts || {}));
}

// Restano per compatibilità con la route: la gestione del contesto e i punti di cache erano di Claude, qui non servono.
const contextManagement = () => undefined;
const cacheTail = messages => messages;

module.exports = { MODELS, PRICES, LABELS, MODE_LABELS, pickModel, openaiRoute, openaiCall, costOf, contextManagement, cacheTail, textOf, routerParams, toOpenAI, toResponse, readStream, usageOf, apiKey };
