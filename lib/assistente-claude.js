// Alma: le chiamate a Claude (porting del motore di Bacco). Due modelli, come nella cantina:
// Claude Haiku 5.5 (economico) per le domande semplici e per preparare ticket/note, Claude Sonnet 5.5 per le analisi.
// In automatico sceglie un classificatore Haiku (2,5 secondi al massimo, poi una regola sulle parole), una volta per
// domanda: il modello non cambia a metà giro e la cache della conversazione resta valida. Se Haiku rifiuta si ripete su
// Sonnet; su Sonnet un rifiuto lo ripete l'API su un modello di riserva (fallback lato server, «default»).
// Memoria corta fatta dall'API (gestione del contesto, beta): oltre ~20.000 token toglie i risultati delle ricerche più
// vecchi (tiene gli ultimi 6), oltre ~50.000 riassume la parte vecchia della conversazione.
const { HttpError } = require('./http');

const MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5' };
// Prezzi in dollari per milione di token (input, output, lettura e scrittura della cache; Haiku fino a 100K token).
const PRICES = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125 },
  'claude-sonnet-5-5': { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 },
};
const ANALYSIS = /(rispetto|confront|anno (scorso|prima|precedente)|andament|trend|perch[eé]|analis|crescit|calo|percentual|%|in media|win ratio|classific|migliori|peggiori|per (mese|mesi|persona|persone|progetto|progetti|bu|zona|regione|categoria)|riepilog|riassum|cos'?\s*[eè] successo|chi ci batte|concorren)/i;
const MODE_LABELS = { auto: 'Automatico (Haiku, Sonnet per le analisi)', sonnet: 'Sempre Sonnet', haiku: 'Sempre Haiku' };
const pickModel = (text, mode) => (mode === 'sonnet' ? MODELS.sonnet : mode === 'haiku' ? MODELS.haiku : ANALYSIS.test(text) ? MODELS.sonnet : MODELS.haiku);

const ROUTER_TIMEOUT_MS = 2500;
const ROUTER_SYSTEM = `Scegli il modello che risponde a una domanda fatta ad Alma, l'assistente di Alma Planet (gestionale interno di Almacis, impresa di costruzioni e servizi).
Rispondi "sonnet" quando serve ragionare sui dati: confronti tra periodi, andamenti, classifiche, numeri divisi per persona/progetto/BU, percentuali e medie, win ratio, concorrenza, cause («perché»), riepiloghi di un progetto o di più cose, domande che richiedono di combinare più ricerche.
Rispondi "haiku" per tutto il resto: un dato solo, un elenco semplice, trovare una scheda, un ticket o una persona, la mia settimana, preparare ticket/note/passi/contatti, saluti, conferme, correzioni brevi.
Se c'è la domanda precedente, usala per capire le domande brevi di seguito (es. «e per persona?»).`;
const ROUTER_SCHEMA = { type: 'object', properties: { modello: { type: 'string', enum: ['haiku', 'sonnet'] } }, required: ['modello'], additionalProperties: false };
const textOf = content => (content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

function routerParams(text, prev) {
  const ask = (prev ? `Domanda precedente: ${prev.slice(0, 500)}\n` : '') + `Domanda: ${text.slice(0, 1500)}`;
  return { model: MODELS.haiku, max_tokens: 64, system: ROUTER_SYSTEM, messages: [{ role: 'user', content: ask }],
    thinking: { type: 'disabled' }, output_config: { effort: 'low', format: { type: 'json_schema', schema: ROUTER_SCHEMA } } };
}
async function claudeRoute(text, prev) {
  const { default: Anthropic } = require('@anthropic-ai/sdk');
  const client = new Anthropic({ maxRetries: 0 });
  const r = await client.messages.create(routerParams(text, prev), { signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS) });
  const choice = JSON.parse(textOf(r.content) || '{}').modello;
  return { model: MODELS[choice] || null, usage: r.usage || {} };
}

const CLEAR_AT = 20000, CLEAR_MIN = 5000, KEEP_TOOL_USES = 6, COMPACT_AT = 50000;
const CONTEXT_BETAS = ['context-management-2025-06-27', 'compact-2026-01-12'];
let CONTEXT_OFF = false; // se l'API rifiuta la gestione del contesto, la si spegne e si continua senza
function contextManagement(keepTools) {
  return { edits: [
    { type: 'clear_tool_uses_20250919', trigger: { type: 'input_tokens', value: CLEAR_AT }, keep: { type: 'tool_uses', value: KEEP_TOOL_USES },
      clear_at_least: { type: 'input_tokens', value: CLEAR_MIN }, ...(keepTools.length ? { exclude_tools: keepTools } : {}) },
    { type: 'compact_20260112', trigger: { type: 'input_tokens', value: COMPACT_AT } },
  ] };
}
// Punto di cache sull'ultimo blocco dell'ultimo messaggio: il giro dopo (e la domanda dopo) rilegge tutto il prima dalla cache.
const CACHEABLE = new Set(['text', 'tool_result', 'image', 'document']);
function cacheTail(messages) {
  const last = messages[messages.length - 1];
  if (!last) return messages;
  if (typeof last.content === 'string') last.content = [{ type: 'text', text: last.content }];
  const block = Array.isArray(last.content) ? last.content[last.content.length - 1] : null;
  if (block && CACHEABLE.has(block.type)) block.cache_control = { type: 'ephemeral' };
  return messages;
}

function costOf(u = {}, model = MODELS.sonnet) {
  const P = PRICES[model] || PRICES[MODELS.sonnet];
  const one = x => (Number(x.input_tokens || 0) * P.input + Number(x.output_tokens || 0) * P.output
    + Number(x.cache_read_input_tokens || 0) * P.cache_read + Number(x.cache_creation_input_tokens || 0) * P.cache_write) / 1e6;
  // Il riassunto è un giro in più che i totali in cima non contano: sta in usage.iterations.
  return one(u) + (Array.isArray(u.iterations) ? u.iterations.filter(i => i && i.type === 'compaction').reduce((a, i) => a + one(i), 0) : 0);
}

// opts (risposta in diretta): onText(pezzo di testo), onTool(nome della ricerca appena chiesta), signal per fermare.
async function claudeCall(params, opts = null) {
  const { default: Anthropic } = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const { context_management: ctx, ...base } = params;
  const send = async withCtx => {
    const sonnet = params.model === MODELS.sonnet;
    const betas = [...(sonnet ? ['server-side-fallback-2026-07-01'] : []), ...(withCtx ? CONTEXT_BETAS : [])];
    const body = { ...base, ...(sonnet ? { fallbacks: 'default' } : {}), ...(withCtx ? { context_management: ctx } : {}), ...(betas.length ? { betas } : {}) };
    if (!opts) return client.beta.messages.create(body);
    const stream = client.beta.messages.stream(body, { signal: opts.signal });
    if (opts.onText) stream.on('text', t => opts.onText(t));
    if (opts.onTool) stream.on('streamEvent', ev => { if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'tool_use') opts.onTool(ev.content_block.name); });
    return stream.finalMessage();
  };
  try {
    const withCtx = !!ctx && !CONTEXT_OFF;
    try {
      return await send(withCtx);
    } catch (e) {
      // Se l'API rifiuta la gestione del contesto (400 prima di scrivere qualcosa), Alma non si deve rompere.
      if (!withCtx || !(e instanceof Anthropic.BadRequestError) || !/context_management|compact|clear_tool_uses|beta/i.test(String(e.message))) throw e;
      CONTEXT_OFF = true;
      console.warn('[alma] gestione del contesto rifiutata dall\'API, spenta:', String(e.message).slice(0, 300));
      return await send(false);
    }
  } catch (e) {
    if (e instanceof Anthropic.APIUserAbortError) throw e; // fermata da chi chiede (o tempo scaduto)
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'La chiave di Claude (ANTHROPIC_API_KEY) non è valida.');
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(503, 'Claude è occupato in questo momento: riprova tra un minuto.');
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `Claude ha risposto con un errore (${e.status}): riprova.`);
    throw e;
  }
}

module.exports = { MODELS, PRICES, MODE_LABELS, pickModel, claudeRoute, claudeCall, costOf, contextManagement, cacheTail, textOf, routerParams };
