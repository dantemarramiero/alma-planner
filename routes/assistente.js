// Alma, l'assistente di Alma Space (porting di «Bacco», l'assistente della cantina; canvas V5-Alma, V5-Ovunque,
// V5-Impostazioni del 17/11/2026). Una chat con Claude: pagina #/alma, pannello laterale da ogni pagina, telefono.
//
// Come risponde: Claude non vede il database. Gli si offrono delle ricerche (lib/assistente-strumenti.js), ognuna è una
// GET a un'API che Alma Space ha già, fatta con la sessione di chi scrive: permessi, filtri e numeri sono gli stessi
// delle pagine. Le proposte (ticket, nota CRM, passo, contatto) non scrivono niente finché chi chiede non conferma.
//
// API (/api/alma):
//   GET  /status                         { configured, enabled, admin, fake, actions, limiti }
//   GET  /conversations                  le mie conversazioni (le ultime 50); GET|PATCH|DELETE /conversations/:id
//   POST /chat { conversation_id?, text, context?, retry? } → { conversation_id, title, reply, steps, proposals, ricevute, blocchi, trace_id }
//   POST /chat/stream (stessi dati) → Server-Sent Events start / step / delta / reset / proposal / done / error, ping ogni 15 s.
//        Chiudere la richiesta = Ferma: la parte scritta resta con stopped: true. Timeout 90 s. retry = «Riprova».
//   POST /tracce/:id/voto { voto: 1 | -1 | 0, commento? }   👍/👎 su una risposta (solo chi l'ha ricevuta)
//   POST /azioni/:id/conferma | annulla | modifica | scegli | disfa   proposte (lib/assistente-bozze.js)
//   GET|PUT /settings, GET /risposte, GET|POST /regole, PATCH|DELETE /regole/:id   solo amministratori
//
// Senza OPENAI_API_KEY: /status dice configured: false (la pagina spiega cosa manca), la chat risponde 503.
const { HttpError } = require('../lib/http');
const { getSetting, saveSetting } = require('../lib/settings');
const TOOLS = require('../lib/assistente-strumenti');
const ACTIONS = require('../lib/assistente-azioni');
const RICEVUTE = require('../lib/assistente-ricevute');
const BLOCCHI = require('../lib/assistente-blocchi');
const DIFESA = require('../lib/assistente-difesa');
const CONTESTO = require('../lib/assistente-contesto');
const CLAUDE = require('../lib/assistente-openai');
const { createAlmaEmail } = require('../lib/assistente-email');
const VOCE = require('../lib/assistente-voce');
const GRAF = require('../lib/assistente-grafici');
// Il grafico come lo vede la pagina: senza la ricerca da cui viene (resta sul server, serve alla dashboard).
const chartView = ({ source, ...c }) => c;
const express = require('express'); // il modello: OpenAI (Dante 17/11/2026)
const { fakeClaude } = require('../lib/assistente-finto');

const BASE = '/api/alma';
const SETTING = 'alma.settings';
const DEFAULTS = { enabled: true, monthly_eur: 150, daily_eur: 3, actions: true, voice: true, model_mode: 'auto', usd_eur: 0.92 };
const MAX_STEPS = 8; // giri di ricerche per una domanda
const MAX_TEXT = 4000;
// Foto nella domanda (biglietti da visita, 17/11/2026): al massimo 5, JPEG/PNG/WebP già rimpicciolite dalla pagina.
// Non si salvano: arrivano al modello solo nei giri di questa domanda; nel messaggio salvato resta «[N foto allegate…]».
const MAX_IMAGES = 5;
const MAX_IMAGE_CHARS = 2.5 * 1024 * 1024;
const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const PHOTO_MARK = 'foto allegate a questa domanda';
function imagesOf(body) {
  const list = Array.isArray(body?.images) ? body.images : [];
  if (list.length > MAX_IMAGES) throw new HttpError(400, `Al massimo ${MAX_IMAGES} foto per domanda.`);
  return list.map(x => {
    const m = typeof x === 'string' && x.length <= MAX_IMAGE_CHARS ? IMAGE_RE.exec(x) : null;
    if (!m) throw new HttpError(400, 'Una foto non va bene: servono JPEG, PNG o WebP fino a circa 2 MB.');
    return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
  });
}
// Le foto vanno nel messaggio della domanda di adesso (quello con il segno «foto allegate…»).
function withImages(messages, images) {
  if (!images.length) return messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && Array.isArray(m.content) && m.content.some(b => b.type === 'text' && String(b.text).includes(PHOTO_MARK))) {
      messages[i] = { ...m, content: [...m.content, ...images] };
      break;
    }
  }
  return messages;
}
const PROPOSAL_TTL_MS = 30 * 60 * 1000; // una proposta non confermata scade dopo 30 minuti
const MAX_RESULT_CHARS = 14000;
const STOPPED = 'Fermata da chi chiedeva';
const ROUTER_PAUSE_MS = 10 * 60 * 1000;
// Risposte brevi a una proposta aperta («Sì, confermo.», «ok vai», «no, lascia stare»).
const YES = /^\s*(s[iì]+|confermo|conferma|ok(ay)?|va bene|vai|procedi|fallo|crealo|creala)([\s,]+(s[iì]|confermo|conferma|vai|grazie|pure|ok))*[\s.!]*$/i;
const NO = /^\s*(no|annulla|lascia stare|stop|non farlo|lascia perdere)([\s,]+(no|annulla|lascia stare|grazie|lascia perdere))*[\s.!]*$/i;

const today = TOOLS.today;
const monthStart = () => `${today().slice(0, 8)}01`;
const textOf = CLAUDE.textOf;
const plainBlocks = content => JSON.parse(JSON.stringify(content || []));
function resultJson(out) {
  const json = JSON.stringify(out);
  if (json.length <= MAX_RESULT_CHARS) return json;
  return JSON.stringify({ completo: false, troppo_grande: true, nota: 'Il risultato è troppo grande: rifai la ricerca con un filtro più stretto.' });
}

function systemPrompt() {
  return `Sei Alma, l'assistente di Alma Space, il gestionale interno di Almacis (impresa di costruzioni, impianti e servizi, Italia). Rispondi in italiano, in modo breve e concreto, a chi lavora in Almacis.

Come lavori:
- I dati li prendi SOLO dalle ricerche (strumenti) che hai. Non inventare numeri, nomi o date: se una ricerca non dà il dato, dillo e suggerisci dove guardare.
- Le ricerche usano i permessi di chi ti scrive. Se manca la ricerca giusta, o una risponde che non ha il permesso, spiega che quel dato non lo vedi per il suo profilo.
- Dì sempre di quali dati parli (es. «ticket aperti assegnati a te», «esiti degli ultimi 12 mesi, BU Facility»).
- Non fare calcoli. Totali, aperti, in ritardo, percentuali (*_pct), somme di ore e importi (*_eur) arrivano già calcolati: riportali così come sono. Se ti serve un numero che non c'è, chiedi un'altra ricerca invece di calcolarlo tu.
- Persone, progetti e aziende dette per nome: passa il nome detto, non un id inventato. Se una ricerca dice che ci sono più persone o schede con quel nome, chiedi quale: non scegliere MAI tu.
- Le ore registrate in Alma Space ci sono solo nelle RDA interne (ore stimate, confermate, effettive): se chiedono ore di altro tipo, dillo.
- Puoi registrare SOLO con gli strumenti «proponi_…» (ticket, nota CRM, prossimo passo CRM, contatto CRM). Non scrivono subito: preparano una scheda che l'utente conferma o annulla. Dopo una proposta dì in una frase cosa hai preparato e che serve la sua conferma: MAI dire che è fatto. Saprai l'esito da un messaggio successivo.
- Prepara una proposta solo quando chi ti scrive te lo chiede. Se mancano dati obbligatori (titolo, azienda, entro quando), chiedili prima. Più cose dette insieme: chiama tutti i «proponi_…» nella stessa risposta (al massimo 5), arrivano in una sola scheda.
- Email: le prepari con «proponi_email» e partono dalla casella Outlook di chi ti scrive solo dopo la sua conferma. Destinatari SOLO contatti del CRM (usa «c:ID» dalle ricerche); a chi non è nel CRM non si scrive: proponi prima di creare il contatto. Prima di scrivere usa «email_tono» per vedere come l'utente scriveva a quella persona (tu o lei, come la chiamava, saluto e firma) e scrivi nello stesso tono; senza email passate usa il «lei». Firma con il nome di chi ti scrive e «Almacis». Nel testo niente indirizzi email né link. Metti «quando» solo se l'utente dice un giorno o un'ora.
- Email a un gruppo («scrivi ai clienti di Facility che non sentiamo da 3 mesi»): trova i destinatari (crm_da_ricontattare, crm_cerca, crm_scheda), leggi il tono di tutti con una sola «email_tono», poi UNA «proponi_email» con una voce per persona (al massimo 10), ognuna diversa e con i dati veri della sua scheda; in «criterio» scrivi come li hai scelti. Chi non ha email lo salti e lo dici.
- Contatti («aggiungi l'ing. Rossi di Elettro Sud, cellulare…»): una «proponi_contatto_crm» con il nome come detto in «nome_completo», l'azienda come detta e i recapiti. Crea da sola l'azienda se non c'è e la trova anche dall'email: NON chiedere campi mancanti (P.IVA, città, qualifica…), si completano dopo. Basta un nome o un'email.
- Biglietti da visita (foto o dettati): per OGNI biglietto chiama «proponi_biglietto» nella stessa risposta (al massimo 5). Copia nomi, email e numeri esattamente come sono scritti; se un campo non si legge bene mettilo in «incerti» invece di indovinare. Se l'utente dice dove li ha conosciuti, mettilo in «nota» di ognuno. Se nella foto non ci sono biglietti, dillo e chiedi cosa vuole fare.
- Se l'utente corregge una scheda ancora aperta («la scadenza è lunedì», «assegnalo a Giulia») usa «modifica_proposta». Dopo il salvataggio l'utente ha 10 minuti per «Annulla».
- Cancellazioni e modifiche a cose già salvate non le fai: indica la pagina dove farle.
- Grafici: quando un confronto, un andamento o una classifica ha 4 o più voci (o l'utente chiede un grafico), dopo la ricerca chiama «grafico» con il fonte_id e i campi dell'elenco; il server lo disegna con i numeri veri. Poi commenta in due frasi cosa si vede, senza ripetere tutti i numeri. L'utente può cambiarlo in barre, linee o tabella e aggiungerlo alla sua dashboard.
${CONTESTO.RULE}

Come scrivi:
- Prima la risposta in una frase con il numero che conta, poi i dettagli.
- Usa **grassetto** per i numeri chiave, elenchi con «- » e tabelle Markdown (| a | b |) quando ci sono più righe. Al massimo 10 righe per tabella: poi dì quante ne restano.
- Ogni risultato ha un «fonte_id» (f1, f2, …). Subito dopo ogni numero chiave in grassetto scrivi la sua fonte tra graffe, senza spazi: **12**{f2}. In grassetto solo numeri presi così come sono da un risultato.
- Importi in euro col formato italiano (€ 1.234,56), date gg/mm/aaaa, percentuali con il segno quando sono differenze (+8%, −3%).
- Link solo a pagine di Alma Space che trovi nei risultati (campo «link»), scritti come [testo](#/percorso). Mai link esterni.
${DIFESA.PROMPT}
- Niente saluti lunghi, niente ripetere la domanda.

${BLOCCHI.PROMPT}`;
}
// Oggi, l'ora (per programmare le email) e chi scrive (per firmarle).
const todayBlock = (user = null) => ({ type: 'text', text: `Oggi è ${new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long' })} ${today().split('-').reverse().join('/')}, ore ${new Date().toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })} (ora italiana).${user && user.name ? ` Ti scrive ${user.name}.` : ''}` });

function registerAssistente(app, { db, audit, auth, notifier, isAdmin, crmAccess, energyAccess, assistantClient = null, assistantRouter, almaMailer = null, almaMailReader = null, almaTranscriber = null, almaSpeaker = null, almaRealtime = null, openaiKey = null, almaFake = false }) {
  // Email ai contatti del CRM (lib/assistente-email.js): API /api/alma/email e giro ogni minuto per le programmate.
  // in modalità finta (solo locale) le email non partono: si scrivono nel log
  const fakeMailer = almaFake ? async (userId, e) => console.log(`[alma email finta] a ${e.to_email}: ${e.subject}`) : null;
  const email = createAlmaEmail({ db, auth, notifier, crmAccess, mailer: almaMailer || fakeMailer, reader: almaMailReader || (almaFake ? async () => [] : null) });
  email.register(app, '/api/alma/email');
  if (!process.env.NODE_TEST_CONTEXT && process.env.ALMA_EMAIL_JOB !== 'off') email.start();
  let call = assistantClient || (almaFake ? fakeClaude : CLAUDE.openaiCall);
  // Classificatore Haiku solo con il Claude vero; con un Claude finto (test, modalità finta) resta la regola sulle parole.
  let route = assistantRouter !== undefined ? assistantRouter : (assistantClient || almaFake ? null : CLAUDE.openaiRoute);
  let routerPausedUntil = 0;
  let streamTimeoutMs = 90 * 1000;
  const configured = () => call !== CLAUDE.openaiCall || Boolean(openaiKey);
  const admin = req => Boolean(isAdmin(req));
  const deps = { crmAccess, energyAccess };

  async function settings() {
    const s = (await getSetting(db, SETTING, {})) || {};
    return {
      enabled: s.enabled !== false,
      monthly_eur: Number(s.monthly_eur) > 0 ? Number(s.monthly_eur) : DEFAULTS.monthly_eur,
      daily_eur: Number(s.daily_eur) > 0 ? Number(s.daily_eur) : DEFAULTS.daily_eur,
      actions: s.actions !== false,
      voice: s.voice !== false,
      model_mode: CLAUDE.MODE_LABELS[s.model_mode] ? s.model_mode : 'auto',
      usd_eur: Number(s.usd_eur) > 0 ? Number(s.usd_eur) : DEFAULTS.usd_eur,
    };
  }
  const sumCost = async (sql, params) => Number((await db.query(sql, params)).rows[0].c) || 0;
  const monthCostUsd = () => sumCost('SELECT COALESCE(SUM(cost_usd), 0) AS c FROM assistant_usage WHERE day >= $1', [monthStart()]);
  const todayCostUsd = userId => sumCost('SELECT COALESCE(SUM(cost_usd), 0) AS c FROM assistant_usage WHERE day = $1 AND user_id = $2', [today(), userId]);
  const ctxOf = req => ({ me: { id: req.user.id, name: req.user.name }, admin: admin(req) });

  // Ricerche e azioni che questa persona può fare: la stessa regola dell'API che chiamano.
  async function toolsFor(req) {
    const out = [];
    for (const t of TOOLS) if (!t.allowed || await t.allowed(req, deps)) out.push(t);
    return out;
  }
  async function actionsFor(req, s) {
    if (!s.actions) return [];
    const out = [];
    for (const a of ACTIONS) if (!a.allowed || await a.allowed(req, deps)) out.push(a);
    return out;
  }

  // GET a un'API di Alma Space con la sessione di chi chiede (stessi permessi delle pagine). Solo /api/…
  const loopback = req => `http://127.0.0.1:${req.socket.localPort}`;
  // Le API di Alma restano fuori dalle ricerche e dalle azioni, tranne quelle delle email (/api/alma/email…).
  const ownApi = path => path.startsWith(BASE) && !/^\/api\/alma\/email(\/|\?|$)/.test(path);
  function getter(req) {
    return async path => {
      if (!/^\/api\/[^?]*$/.test(path.split('?')[0]) || path.includes('..') || ownApi(path)) throw new Error('Ricerca non valida.');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      try {
        const res = await fetch(loopback(req) + path, { headers: { cookie: req.headers.cookie || '' }, signal: ctrl.signal });
        const data = await res.json().catch(() => null);
        if (res.status === 403) throw new Error('Non hai il permesso per questi dati.');
        if (res.status === 404) throw new Error((data && data.error) || 'Non trovato.');
        if (!res.ok) throw new Error((data && data.error) || `Errore ${res.status}.`);
        return data;
      } catch (e) {
        throw new Error(e.name === 'AbortError' ? 'La ricerca ci ha messo troppo.' : e.message || 'La ricerca non è riuscita.');
      } finally { clearTimeout(timer); }
    };
  }
  // Scrittura (solo dopo «Conferma»): API di Alma Space con la sessione di chi conferma.
  function caller(req) {
    return async (method, path, body) => {
      if (!/^\/api\/[^?]*$/.test(path.split('?')[0]) || path.includes('..') || ownApi(path)) throw new Error('Azione non valida.');
      const res = await fetch(loopback(req) + path, { method, headers: { cookie: req.headers.cookie || '', 'content-type': 'application/json', 'X-Alma': '1' }, body: method === 'DELETE' ? undefined : JSON.stringify(body || {}) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) throw new Error((data && data.error) || 'Non hai il permesso per farlo.');
      if (!res.ok) throw new Error((data && data.error) || `Errore ${res.status}.`);
      return data;
    };
  }
  async function runTool(req, tool, input) {
    try { return await tool.run(input || {}, getter(req), ctxOf(req)); } catch (e) { return { error: e.message || 'La ricerca non è riuscita.' }; }
  }

  // ── messaggi e conversazioni ──────────────────────────────────────────────────────────────────
  async function addMessage(convId, role, content, display = null, meta = null) {
    const { rows: [m] } = await db.query('INSERT INTO assistant_messages (conversation_id, role, content, display, meta) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [convId, role, JSON.stringify(content), display, meta ? JSON.stringify(meta) : null]);
    return m.id;
  }
  const touchConv = convId => db.query('UPDATE assistant_conversations SET updated_at = now() WHERE id = $1', [convId]);
  async function note(convId, system, text) {
    await addMessage(convId, 'user', [{ type: 'text', text: system }]);
    await addMessage(convId, 'assistant', [{ type: 'text', text }], text);
    await touchConv(convId);
  }
  async function ownConversation(req, id) {
    const { rows: [c] } = await db.query('SELECT * FROM assistant_conversations WHERE id = $1', [Number(id) || 0]);
    if (!c || c.user_id !== req.user.id) throw new HttpError(404, 'Conversazione non trovata.');
    return c;
  }
  // Una ricerca chiesta e mai risolta (giro interrotto) romperebbe la conversazione: le si dà un risultato di errore.
  async function history(convId) {
    const msgs = (await db.query('SELECT role, content FROM assistant_messages WHERE conversation_id = $1 ORDER BY id', [convId])).rows;
    const out = [];
    msgs.forEach((m, i) => {
      out.push({ role: m.role, content: m.content });
      if (m.role !== 'assistant' || !Array.isArray(m.content)) return;
      const ids = m.content.filter(b => b.type === 'tool_use').map(b => b.id);
      if (!ids.length) return;
      const next = msgs[i + 1];
      const nextBlocks = next && next.role === 'user' && Array.isArray(next.content) ? next.content : null;
      const answered = new Set((nextBlocks || []).filter(b => b.type === 'tool_result').map(b => b.tool_use_id));
      const fill = ids.filter(id => !answered.has(id)).map(id => ({ type: 'tool_result', tool_use_id: id, content: 'Ricerca interrotta.', is_error: true }));
      if (!fill.length) return;
      if (nextBlocks) next.content = [...fill, ...nextBlocks];
      else out.push({ role: 'user', content: fill });
    });
    return out;
  }
  const userTexts = async convId => (await db.query("SELECT display FROM assistant_messages WHERE conversation_id = $1 AND role = 'user' AND display IS NOT NULL ORDER BY id", [convId])).rows.map(m => m.display);

  // ── proposte ──────────────────────────────────────────────────────────────────────────────────
  const proposalExpired = row => Date.now() - new Date(row.created_at).getTime() > PROPOSAL_TTL_MS;
  async function proposalView(row) {
    if (!row) return null;
    const a = ACTIONS.find(x => x.name === row.kind);
    const p = row.preview || {}, r = row.result;
    return { id: row.id, kind: row.kind, label: a ? a.label : row.kind, icon: a ? a.icon : 'sparkles', title: p.title, fields: p.fields || [], warnings: p.warnings || [], status: row.status,
      message: r ? r.message : null, link: r ? r.link : null, error: row.error || null, ...(p.dai_dati ? { dai_dati: true } : {}), ...bozze.extras(row) };
  }
  const proposalsById = async ids => (await Promise.all((ids || []).map(async id => proposalView((await db.query('SELECT * FROM assistant_actions WHERE id = $1', [id])).rows[0])))).filter(Boolean);
  const openProposal = async convId => (await db.query("SELECT * FROM assistant_actions WHERE conversation_id = $1 AND status = 'proposta' ORDER BY id DESC LIMIT 1", [convId])).rows[0];
  async function proposalIsCurrent(convId, row) {
    if (proposalExpired(row)) return false;
    const { rows: [q] } = await db.query("SELECT created_at FROM assistant_messages WHERE conversation_id = $1 AND role = 'user' AND display IS NOT NULL ORDER BY id DESC LIMIT 1", [convId]);
    return !q || new Date(row.created_at) >= new Date(q.created_at);
  }
  const expireOpen = convId => db.query("UPDATE assistant_actions SET status = 'superata', done_at = now() WHERE conversation_id = $1 AND status = 'proposta'", [convId]);
  async function execRow(req, row, confirm) {
    const action = ACTIONS.find(a => a.name === row.kind);
    if (!confirm) {
      await db.query("UPDATE assistant_actions SET status = 'annullata', done_at = now() WHERE id = $1", [row.id]);
      return;
    }
    if (!action || (action.allowed && !(await action.allowed(req, deps)))) throw new HttpError(403, 'Non hai il permesso per farlo.');
    try {
      const r = await action.execute(row.input || {}, caller(req));
      await db.query("UPDATE assistant_actions SET status = 'fatta', result = $2, done_at = now() WHERE id = $1", [row.id, JSON.stringify(r)]);
      audit?.log(req.user.id, 'alma.azione', { action: row.id, kind: row.kind, link: r.link });
    } catch (e) {
      await db.query("UPDATE assistant_actions SET status = 'errore', error = $2, done_at = now() WHERE id = $1", [row.id, String(e.message || e)]);
    }
  }
  const bozze = require('../lib/assistente-bozze')({ db, ACTIONS, HttpError, getter, caller, ctxOf, audit, proposalView, proposalExpired, execRow, note });
  const flagFromData = id => db.query("UPDATE assistant_actions SET preview = preview || '{\"dai_dati\": true}'::jsonb WHERE id = $1", [id]);

  // ── ricevute ──────────────────────────────────────────────────────────────────────────────────
  async function priorFonti(convId) {
    const out = [];
    for (const m of (await db.query("SELECT meta FROM assistant_messages WHERE conversation_id = $1 AND role = 'assistant' AND meta IS NOT NULL ORDER BY id", [convId])).rows) {
      for (const f of (m.meta.ricevute && m.meta.ricevute.tutte) || []) if (!out.some(x => x.id === f.id)) out.push(f);
    }
    return out;
  }
  async function receiptsFor(convId, reply, question, allFonti, turnFonti, trace) {
    try {
      const sources = RICEVUTE.sourcesFrom(await history(convId));
      const { numeri, non_verificati } = RICEVUTE.checkReply(reply, sources, question);
      trace.numbers_checked = numeri.length;
      trace.unverified = non_verificati;
      const used = new Set(numeri.map(n => n.fonte).filter(Boolean));
      const shown = allFonti.filter(f => used.has(f.id));
      const fonti = (shown.length ? shown : turnFonti).map(({ tool_use_id, ...f }) => f);
      if (!fonti.length && !numeri.length) return turnFonti.length ? { tutte: turnFonti } : undefined;
      return { fonti, numeri, tutte: turnFonti };
    } catch (e) {
      console.error('[alma] controllo dei numeri non riuscito:', e.message); // la risposta conta più del controllo
      return undefined;
    }
  }

  // ── tracce e uso ──────────────────────────────────────────────────────────────────────────────
  const newTrace = (convId, userId, question) => ({ convId, userId, question: question.slice(0, 1000), t0: Date.now(), steps: [], models: [], router_cost: 0 });
  function traceStep(tr, model, ms, stop, u) {
    tr.steps.push({ model, ms, stop_reason: stop || null, input_tokens: Number(u.input_tokens || 0), output_tokens: Number(u.output_tokens || 0),
      cache_read: Number(u.cache_read_input_tokens || 0), cache_write: Number(u.cache_creation_input_tokens || 0), cost_usd: CLAUDE.costOf(u, model), tools: [] });
    if (!tr.models.includes(model)) tr.models.push(model);
  }
  function traceTool(tr, name, ms, error) {
    const step = tr.steps[tr.steps.length - 1];
    if (step) step.tools.push({ name, ms, ...(error ? { error: String(error).slice(0, 300) } : {}) });
  }
  const logUsage = (userId, convId, model, u) => db.query(`INSERT INTO assistant_usage (user_id, conversation_id, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, day)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [userId, convId, model, Number(u.input_tokens || 0), Number(u.output_tokens || 0),
    Number(u.cache_read_input_tokens || 0), Number(u.cache_creation_input_tokens || 0), CLAUDE.costOf(u, model), today()]);
  async function saveTrace(tr, status, messageId, error = null) {
    try {
      const sum = k => tr.steps.reduce((a, x) => a + (k === 'tools' ? x.tools.length : k === 'errors' ? x.tools.filter(t => t.error).length : Number(x[k] || 0)), 0);
      const unv = tr.unverified || [];
      const { rows: [t] } = await db.query(`INSERT INTO assistant_traces (conversation_id, user_id, message_id, question, model, models, steps, steps_count, tool_count, tool_errors,
          input_tokens, output_tokens, cache_read, cache_write, cost_usd, latency_ms, status, error, numbers_checked, numbers_unverified, unverified_numbers)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING id`,
      [tr.convId, tr.userId, messageId || null, tr.question, tr.models[tr.models.length - 1] || null, JSON.stringify(tr.models), JSON.stringify(tr.steps), tr.steps.length,
        sum('tools'), sum('errors'), sum('input_tokens'), sum('output_tokens'), sum('cache_read'), sum('cache_write'), sum('cost_usd') + Number(tr.router_cost || 0),
        Date.now() - tr.t0, status, error ? String(error).slice(0, 500) : null, Number(tr.numbers_checked || 0), unv.length, unv.length ? JSON.stringify(unv.slice(0, 20)) : null]);
      if (messageId) await db.query("UPDATE assistant_messages SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('trace_id', $2::int) WHERE id = $1", [messageId, t.id]);
      return t.id;
    } catch (e) {
      console.error('[alma] traccia non salvata:', e.message); // la risposta conta più della traccia
      return null;
    }
  }
  const lastReply = async convId => (await db.query("SELECT id, display, meta FROM assistant_messages WHERE conversation_id = $1 AND role = 'assistant' AND display IS NOT NULL ORDER BY id DESC LIMIT 1", [convId])).rows[0];

  // ── controlli prima di rispondere ─────────────────────────────────────────────────────────────
  async function retrying(req, text) {
    if (!req.body?.retry || !req.body?.conversation_id) return false;
    const { rows: [last] } = await db.query(`SELECT m.role, m.display FROM assistant_messages m JOIN assistant_conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = $1 AND c.user_id = $2 AND m.display IS NOT NULL ORDER BY m.id DESC LIMIT 1`, [Number(req.body.conversation_id) || 0, req.user.id]);
    return !!last && last.role === 'user' && last.display === text;
  }
  async function checks(req) {
    const images = imagesOf(req.body);
    let text = String(req.body?.text || '').trim();
    if (!text && images.length) text = images.length === 1 ? 'Crea il contatto da questo biglietto da visita.' : 'Crea i contatti da questi biglietti da visita.';
    if (!text) throw new HttpError(400, 'Scrivi una domanda.');
    if (text.length > MAX_TEXT) throw new HttpError(400, `La domanda è troppo lunga (al massimo ${MAX_TEXT} caratteri).`);
    if (!configured()) throw new HttpError(503, admin(req) ? 'Alma è spenta: manca la chiave OPENAI_API_KEY su Railway.' : 'Alma non è ancora attiva.', 'not_configured');
    const s = await settings();
    if (!s.enabled) throw new HttpError(403, 'Alma è spenta. Si accende in Impostazioni → Alma.', 'disabled');
    const month = (await monthCostUsd()) * s.usd_eur;
    if (month >= s.monthly_eur) throw new HttpError(429, `Alma ha finito la quota del mese (${s.monthly_eur} €). Riparte il 1° del mese prossimo, oppure un amministratore può alzarla in Impostazioni → Alma.`, 'month_limit');
    const mine = (await todayCostUsd(req.user.id)) * s.usd_eur;
    if (mine >= s.daily_eur) throw new HttpError(429, `Per oggi hai usato tutta la tua quota di Alma (${s.daily_eur} €). Puoi tornare a usarla domani dalle 00:00.`, 'daily_limit');
    if (req.body?.conversation_id) await ownConversation(req, req.body.conversation_id);
    return { text, s, images };
  }

  const busy = new Set(); // una risposta alla volta per conversazione

  // live (POST /chat/stream): { emit(evento, dati), signal, reason() → 'stop' | 'timeout' }.
  async function chat(req, live = null) {
    const { text, s, images } = await checks(req);
    const emit = live ? live.emit : () => {};
    const signal = live ? live.signal : null;
    const reuse = await retrying(req, text);

    let conv;
    if (req.body?.conversation_id) conv = await ownConversation(req, req.body.conversation_id);
    else {
      const { rows: [c] } = await db.query('INSERT INTO assistant_conversations (user_id, title) VALUES ($1, $2) RETURNING id, title', [req.user.id, text.replace(/\s+/g, ' ').slice(0, 70)]);
      conv = c;
    }
    if (busy.has(conv.id)) throw new HttpError(409, 'Sto ancora rispondendo in questa conversazione: aspetta un attimo.');
    busy.add(conv.id);
    emit('start', { conversation_id: conv.id, title: conv.title });
    const trace = newTrace(conv.id, req.user.id, text);
    const steps = [];
    let draft = '';
    try {
      const prevQuestion = (await db.query("SELECT display FROM assistant_messages WHERE conversation_id = $1 AND role = 'user' AND display IS NOT NULL ORDER BY id DESC LIMIT 2", [conv.id])).rows
        .map(m => m.display).filter(d => d !== text)[0] || null;
      let open = req.body?.conversation_id ? await openProposal(conv.id) : null;
      if (open && !(await proposalIsCurrent(conv.id, open))) { await expireOpen(conv.id); open = null; }
      const ctx = reuse ? null : await CONTESTO.resolve(CONTESTO.normalize(req.body?.context), getter(req));
      const ctxState = { free: 0, suspicious: 0 };
      if (!reuse) {
        const photoNote = images.length ? `\n[${images.length} ${PHOTO_MARK}: le vedi solo adesso; i dati che leggi sulle foto valgono come detti dall'utente]` : '';
        const meta = { ...(ctx ? { contesto: { route: ctx.route, label: CONTESTO.label(ctx) } } : {}), ...(images.length ? { foto: images.length } : {}) };
        await addMessage(conv.id, 'user', [...(ctx ? [{ type: 'text', text: CONTESTO.block(ctx, ctxState) }] : []), { type: 'text', text: text + photoNote }], text,
          Object.keys(meta).length ? meta : null);
      }
      // «Sì» / «no» su tutta la scheda aperta, «la seconda» su una scelta, «annulla» subito dopo il salvataggio:
      // si decide subito, senza chiamare Claude.
      const quick = req.body?.conversation_id ? await bozze.quick(req, conv.id, open, text, { YES, NO }) : null;
      if (quick) {
        const last = await lastReply(conv.id);
        const traceId = await saveTrace(trace, 'decisa', last?.id);
        return { conversation_id: conv.id, title: conv.title, reply: quick.reply, steps: [], proposals: quick.proposals, trace_id: traceId };
      }
      // «Fallo a barre», «in tabella»…: si cambia il tipo dell'ultimo grafico, senza chiamare il modello.
      const newType = req.body?.conversation_id && !images.length ? GRAF.tipoDaTesto(text) : null;
      if (newType) {
        const { rows: [lastChart] } = await db.query(`SELECT meta FROM assistant_messages WHERE conversation_id = $1 AND role = 'assistant' AND display IS NOT NULL
          AND meta ? 'charts' ORDER BY id DESC LIMIT 1`, [conv.id]);
        if (lastChart) {
          const charts = lastChart.meta.charts.map(c => ({ ...c, tipo: newType === 'torta' && (c.serie.length > 1 || c.etichette.length > 6) ? 'barre' : newType }));
          const reply = charts.some(c => c.tipo !== newType) ? 'A torta non si legge bene con tante voci: l\'ho lasciato a barre.' : `Ecco il grafico ${{ barre: 'a barre', linee: 'a linee', tabella: 'in tabella', torta: 'a torta' }[newType]}.`;
          const id = await addMessage(conv.id, 'assistant', [{ type: 'text', text: reply }], reply, { steps: [], charts });
          await touchConv(conv.id);
          const traceId = await saveTrace(trace, 'decisa', id);
          return { conversation_id: conv.id, title: conv.title, reply, steps: [], proposals: [], trace_id: traceId, message_id: id, charts: charts.map(chartView) };
        }
      }

      const earlierFonti = await priorFonti(conv.id);
      let nextFonte = earlierFonti.reduce((n, f) => Math.max(n, Number(String(f.id).slice(1)) || 0), 0) + 1;
      const turnFonti = [];
      const turnOut = new Map(); // fonte_id → { tool, input, out }: i risultati di questa risposta, per i grafici
      const turnCharts = [];
      const reads = await toolsFor(req);
      const acts = await actionsFor(req, s);
      const tools = [...reads, ...(reads.length ? [GRAF.TOOL] : []), ...acts, ...(acts.length ? bozze.TOOLS : [])];
      // Il grafico lo costruisce il server dal risultato di una ricerca di questa risposta (mai numeri scritti dal modello).
      const makeChart = input => {
        const src = turnOut.get(String(input?.fonte_id || ''));
        if (!src) return { error: 'Questo fonte_id non è di una ricerca fatta in questa risposta: rifai la ricerca, poi chiedi il grafico.' };
        try {
          const { fonte_id: _f, ...spec } = input;
          const c = { id: `g${turnCharts.length + 1}`, ...GRAF.build(src.out, spec), source: { tool: src.tool, input: src.input || {}, spec } };
          turnCharts.push(c);
          emit('chart', { chart: chartView(c) });
          return { grafico_id: c.id, mostrato: true, tipo: c.tipo, voci: c.etichette.length, serie: c.serie.map(x => x.nome), ...(c.troncato ? { nota: `mostrate le prime 40 voci su ${c.troncato}` } : {}) };
        } catch (e) { return { error: e.message }; }
      };
      const toolDefs = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
      if (toolDefs.length) toolDefs[toolDefs.length - 1].cache_control = { type: 'ephemeral' };
      const rules = (await db.query('SELECT text FROM assistant_rules WHERE active ORDER BY id')).rows.map(r => r.text);
      const system = [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }, todayBlock(req.user),
        ...(rules.length ? [{ type: 'text', text: `Regole della direzione di Almacis (seguile sempre):\n${rules.map(r => `- ${r}`).join('\n')}` }] : [])];
      const proposals = [];
      const seen = { free: 0 };
      DIFESA.see(seen, ctxState);
      const said = await userTexts(conv.id);
      // Una proposta passa solo se chi scrive ha chiesto di fare qualcosa: nella frase di adesso se in questo giro sono
      // arrivati testi scritti da altri (note, email, segnali…), altrimenti in una delle sue ultime tre frasi.
      const guardOf = (tool, input) => {
        // Biglietti dalle foto di chi scrive: mandare le foto è già la richiesta («Fiera Ecomondo» basta), e email e siti
        // scritti sul biglietto valgono come detti da lui. Se nel giro sono arrivati testi di altri serve un verbo d'azione.
        if (tool.name === 'proponi_biglietto' && images.length) {
          return seen.free && !DIFESA.asksAction(text) ? 'Non preparo niente: chi ti scrive non ha chiesto di registrare nulla. Chiedigli se vuole che lo prepari.' : null;
        }
        if (!seen.free && !said.slice(-3).some(DIFESA.asksAction)) {
          return 'Non preparo niente: chi ti scrive non ha chiesto di registrare nulla. Chiedigli se vuole che lo prepari.';
        }
        return DIFESA.guard({ tool, input, question: text, userTexts: said, ctx: seen, checkAsk: true });
      };
      const group = { id: null, size: 0 };
      let proposing = Promise.resolve();
      const shownProposals = async () => {
        const out = [];
        for (const id of [...new Set(proposals)]) {
          const { rows: [r] } = await db.query('SELECT status FROM assistant_actions WHERE id = $1', [id]);
          if (r && r.status !== 'superata') out.push(id);
        }
        return out;
      };
      let model = images.length ? CLAUDE.MODELS.sonnet : CLAUDE.pickModel(text, s.model_mode); // le foto le legge il modello più preciso
      if (!images.length && s.model_mode === 'auto' && route && Date.now() >= routerPausedUntil) {
        const t0 = Date.now();
        try {
          const r = await route(text, prevQuestion);
          if (r && r.model) model = r.model;
          const u = (r && r.usage) || {};
          trace.router = { model: r && r.model, ms: Date.now() - t0 };
          trace.router_cost = CLAUDE.costOf(u, CLAUDE.MODELS.haiku);
          await logUsage(req.user.id, conv.id, CLAUDE.MODELS.haiku, u);
        } catch (e) {
          trace.router = { error: String(e.message || e).slice(0, 200), ms: Date.now() - t0 };
          routerPausedUntil = Date.now() + ROUTER_PAUSE_MS;
          console.warn('[alma] classificatore del modello non disponibile, regola sulle parole per 10 minuti:', String(e.message || e).slice(0, 200));
        }
      }
      const context_management = CLAUDE.contextManagement(acts.map(t => t.name));
      const announced = new Set();
      const announce = name => {
        const label = (tools.find(t => t.name === name) || {}).label || name;
        if (announced.has(label)) return;
        announced.add(label);
        emit('step', { label });
      };
      const stopNow = () => { if (signal && signal.aborted) throw Object.assign(new Error('Fermata'), { stopped: true }); };
      const ask = async (params, m) => {
        const t0 = Date.now();
        if (draft) emit('reset', {}); // il testo di prima non era la risposta (veniva prima di altre ricerche)
        draft = '';
        let firstText = null;
        const r = await call({ ...params, model: m }, live ? { signal,
          onText: x => { if (firstText === null) firstText = Date.now() - trace.t0; draft += x; emit('delta', { text: x }); },
          onTool: name => announce(name) } : undefined);
        stopNow();
        const u = r.usage || {};
        traceStep(trace, m, Date.now() - t0, r.stop_reason, u);
        if (firstText !== null) trace.steps[trace.steps.length - 1].first_text_ms = firstText;
        await logUsage(req.user.id, conv.id, m, u);
        return r;
      };
      const finish = async (content, reply) => {
        const b = BLOCCHI.split(reply);
        const ricevute = await receiptsFor(conv.id, BLOCCHI.checkText(b.text, b.blocchi), text, [...earlierFonti, ...turnFonti], turnFonti, trace);
        await addMessage(conv.id, 'assistant', content.length ? content : [{ type: 'text', text: reply }], b.text || reply,
          { steps, proposals: await shownProposals(), ...(ricevute ? { ricevute } : {}), ...(b.blocchi ? { blocchi: b.blocchi } : {}), ...(turnCharts.length ? { charts: turnCharts } : {}) });
      };
      for (let step = 0; step < MAX_STEPS; step++) {
        const messages = CLAUDE.cacheTail(withImages(await history(conv.id), images));
        const params = { max_tokens: 8000, system, tools: toolDefs, messages, output_config: { effort: 'medium' }, context_management };
        let response = await ask(params, model);
        // Haiku rifiuta (non ha il fallback lato server): si ripete la stessa richiesta su Sonnet.
        if (response.stop_reason === 'refusal' && model === CLAUDE.MODELS.haiku) { model = CLAUDE.MODELS.sonnet; response = await ask(params, model); }
        const content = plainBlocks(response.content);
        const uses = content.filter(b => b.type === 'tool_use');
        if (response.stop_reason !== 'tool_use' || !uses.length) {
          let reply = DIFESA.cleanReply(textOf(content));
          if (response.stop_reason === 'refusal') reply = 'Su questa domanda non posso rispondere.';
          if (!reply) reply = 'Non sono riuscita a rispondere: prova a riformulare la domanda.';
          await finish(content, reply);
          break;
        }
        await addMessage(conv.id, 'assistant', content);
        const results = await Promise.all(uses.map(async b => {
          const tool = tools.find(t => t.name === b.name);
          steps.push(tool ? tool.label : b.name);
          announce(b.name);
          let out;
          const t0 = Date.now();
          const no = tool && tool.preview_tool ? guardOf(tool, b.input) : null;
          if (no) out = { error: no };
          else if (tool && tool.preview_tool) {
            proposing = proposing.catch(() => {}).then(() => bozze.propose(req, conv.id, tool, b.input, group));
            const p = await proposing; out = p.out;
            if (p.id && seen.free) await flagFromData(p.id);
            if (p.id) { proposals.push(p.id); emit('proposal', { proposal: (await proposalsById([p.id]))[0] }); }
          } else if (tool && tool.bozza) {
            const p = await bozze.runTool(req, conv.id, tool.name, b.input); out = p.out;
            for (const pr of p.proposals || []) { proposals.push(pr.id); emit('proposal', { proposal: pr }); }
          } else if (tool && tool.grafico) out = makeChart(b.input);
          else out = tool ? await runTool(req, tool, b.input) : { error: 'Ricerca non disponibile.' };
          traceTool(trace, b.name, Date.now() - t0, out && out.error);
          if (out && !out.error && out.ricevuta) { // fonte_id per Claude, la ricevuta resta per la chat
            const id = `f${nextFonte++}`;
            turnFonti.push({ id, tool_use_id: b.id, ...out.ricevuta });
            turnOut.set(id, { tool: b.name, input: b.input, out });
            out = { fonte_id: id, ...out };
          }
          if (!(tool && (tool.preview_tool || tool.bozza))) out = DIFESA.wrap(out, seen); // dati, non istruzioni
          return { type: 'tool_result', tool_use_id: b.id, content: resultJson(out), ...(out && out.error ? { is_error: true } : {}) };
        }));
        await addMessage(conv.id, 'user', results);
        stopNow();
        if (step === MAX_STEPS - 1) {
          await addMessage(conv.id, 'user', [{ type: 'text', text: 'Fermati qui e rispondi con quello che hai.' }]);
          const r2 = await ask({ max_tokens: 4000, system, tools: toolDefs, tool_choice: { type: 'none' }, messages: CLAUDE.cacheTail(withImages(await history(conv.id), images)), output_config: { effort: 'low' }, context_management }, model);
          const c2 = plainBlocks(r2.content);
          await finish(c2, DIFESA.cleanReply(textOf(c2)) || 'Ci sono volute troppe ricerche: prova a fare una domanda più precisa.');
        }
      }
      await touchConv(conv.id);
      const last = await lastReply(conv.id);
      const traceId = await saveTrace(trace, 'ok', last?.id);
      const meta = last?.meta || {};
      return { conversation_id: conv.id, title: conv.title, reply: last ? last.display : '', steps: [...new Set(steps)], proposals: await proposalsById(await shownProposals()), trace_id: traceId,
        message_id: last?.id, ...(meta.charts ? { charts: meta.charts.map(chartView) } : {}),
        ...(meta.ricevute && meta.ricevute.fonti ? { ricevute: { fonti: meta.ricevute.fonti, numeri: meta.ricevute.numeri } } : {}), ...(meta.blocchi ? { blocchi: meta.blocchi } : {}) };
    } catch (e) {
      // Fermata in diretta. Con «Ferma» la parte già scritta resta nella conversazione, segnata come fermata; con il
      // tempo scaduto è un errore e si può riprovare.
      if (signal && signal.aborted) {
        if (live.reason() === 'timeout') {
          await saveTrace(trace, 'errore', null, 'Tempo scaduto (90 secondi)');
          throw new HttpError(504, 'Ci ho messo troppo (più di 90 secondi). Riprova, magari con una domanda più precisa.', 'timeout');
        }
        const said = BLOCCHI.split(draft).text;
        const id = await addMessage(conv.id, 'assistant', [{ type: 'text', text: said || '(risposta fermata da chi chiedeva)' }], said, { steps, stopped: true });
        await touchConv(conv.id);
        await saveTrace(trace, 'errore', id, STOPPED);
        return { conversation_id: conv.id, title: conv.title, reply: said, steps: [...new Set(steps)], proposals: [], stopped: true };
      }
      await saveTrace(trace, 'errore', null, e.message || String(e));
      throw e;
    } finally { busy.delete(conv.id); }
  }

  async function chatStream(req, res) {
    await checks(req); // limiti e permessi prima di aprire il flusso: tornano come errori normali
    res.status(200);
    res.set({ 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
    res.flushHeaders();
    const ctrl = new AbortController();
    let why = 'stop';
    const send = (event, data) => { if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    res.on('close', () => { if (!res.writableEnded) { why = 'stop'; ctrl.abort(); } });
    const timer = setTimeout(() => { why = 'timeout'; ctrl.abort(); }, streamTimeoutMs);
    const ping = setInterval(() => { if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n'); }, 15000);
    try {
      send('done', await chat(req, { emit: send, signal: ctrl.signal, reason: () => why }));
    } catch (e) {
      if (!(e instanceof HttpError || e.status)) console.error('[alma] risposta in diretta:', e);
      send('error', { error: e instanceof HttpError || e.status ? e.message : 'Errore interno.', status: e.status || 500, code: e.code });
    } finally {
      clearTimeout(timer);
      clearInterval(ping);
      if (!res.writableEnded) res.end();
    }
  }

  // ── rotte ─────────────────────────────────────────────────────────────────────────────────────
  const adminOnly = req => { if (!admin(req)) throw new HttpError(403, 'Le impostazioni di Alma le gestiscono gli amministratori.'); };
  const r2 = n => Math.round(n * 100) / 100;

  // ── voce (prima parte): dettatura e «Ascolta» (lib/assistente-voce.js) ──
  let transcribe = almaTranscriber || (a => VOCE.openaiTranscribe(a, openaiKey));
  let speak = almaSpeaker || (t => VOCE.openaiSpeech(t, openaiKey));
  const voiceReady = () => Boolean(almaTranscriber || almaSpeaker || openaiKey);
  async function voiceCheck(req) {
    const s = await settings();
    if (!s.enabled) throw new HttpError(403, 'Alma è spenta.', 'disabled');
    if (!s.voice || !voiceReady()) throw new HttpError(403, 'La voce di Alma è spenta.', 'voice_off');
    if ((await monthCostUsd()) * s.usd_eur >= s.monthly_eur) throw new HttpError(429, 'Alma ha finito la quota del mese.', 'month_limit');
    if ((await todayCostUsd(req.user.id)) * s.usd_eur >= s.daily_eur) throw new HttpError(429, 'Per oggi hai usato tutta la tua quota di Alma.', 'daily_limit');
  }
  const logVoice = (userId, model, usd) => db.query(`INSERT INTO assistant_usage (user_id, conversation_id, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, day)
    VALUES ($1, NULL, $2, 0, 0, 0, 0, $3, $4)`, [userId, model, usd, today()]);
  // Audio → testo: il corpo è l'audio (Content-Type audio/…), ?secondi= la durata per il costo. L'audio non si salva.
  app.post(`${BASE}/voce/trascrivi`, express.raw({ type: () => true, limit: VOCE.MAX_AUDIO_BYTES }), async (req, res) => {
    await voiceCheck(req);
    const mime = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = VOCE.MIMES[mime];
    if (!ext) throw new HttpError(415, 'Formato audio non supportato.');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Nessun audio ricevuto.');
    const seconds = Math.min(120, Math.max(1, Number(req.query.secondi) || 10));
    const text = await transcribe({ buffer: req.body, mime, filename: `voce.${ext}` });
    await logVoice(req.user.id, VOCE.STT_MODEL, (seconds / 60) * VOCE.STT_USD_PER_MIN);
    res.json({ text });
  });
  // Testo della risposta → mp3 con la voce di Alma (versione «da dire», corta).
  app.post(`${BASE}/voce/ascolta`, async (req, res) => {
    await voiceCheck(req);
    const said = VOCE.speakable(req.body?.text);
    if (!said) throw new HttpError(400, 'Niente da leggere.');
    const audio = await speak(said);
    await logVoice(req.user.id, VOCE.TTS_MODEL, (said.length / 900) * VOCE.TTS_USD_PER_MIN); // ~900 caratteri al minuto
    res.set('Content-Type', 'audio/mpeg').set('Cache-Control', 'no-store').send(audio);
  });

  // ── voce in tempo reale (migrazione 060, lib/assistente-voce-live.js): come la modalità voce di Bacco ──
  const VOICE_MODEL = process.env.OPENAI_ALMA_VOICE_MODEL || 'gpt-realtime-2.1-mini';
  const VOICE_USD_PER_MIN = 0.03;
  const rt = almaRealtime || {
    secret: async session => {
      const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', { method: 'POST', headers: { authorization: `Bearer ${openaiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: 120 }, session }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) throw new HttpError(503, 'La chiave OpenAI (OPENAI_API_KEY) non è valida.');
      if (!r.ok) throw new HttpError(502, `La voce in tempo reale non si è avviata (${r.status}${d.error?.message ? `: ${d.error.message}` : ''}).`);
      return { value: d.value || d.client_secret?.value, expires_at: d.expires_at || d.client_secret?.expires_at };
    },
    connect: async (sdp, secret) => {
      const r = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', body: sdp, headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/sdp' } });
      if (!r.ok) throw new HttpError(502, `Collegamento alla voce rifiutato (${r.status}).`);
      return { sdp: await r.text(), call_id: ((r.headers.get('location') || '').match(/calls\/([^/?]+)/) || [])[1] || null };
    },
    hangup: async callId => { if (callId && openaiKey) await fetch(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/hangup`, { method: 'POST', headers: { authorization: `Bearer ${openaiKey}` } }).catch(() => {}); },
  };
  const V = require('../lib/assistente-voce-live')({ db, HttpError, model: VOICE_MODEL, usdPerMin: VOICE_USD_PER_MIN, maxMinutes: 15, today, addMessage,
    connect: (sdp, secret) => rt.connect(sdp, secret), hangup: id => rt.hangup(id),
    quota: async req => { const s = await settings(); return { month_left_usd: s.monthly_eur / s.usd_eur - await monthCostUsd(), user_left_usd: s.daily_eur / s.usd_eur - await todayCostUsd(req.user.id) }; } });
  if (!process.env.NODE_TEST_CONTEXT) V.start();
  const voiceSeen = new Map(); // conversazione → testi liberi visti dopo l'ultima frase dell'utente (difesa)
  const CONFIRM_TOOLS = [
    { type: 'function', name: 'conferma_proposta', description: 'Esegue la scheda aperta: tutte le proposte preparate nell\'ultima risposta (proponi_…). Da chiamare SOLO dopo un sì chiaro dell\'utente.', parameters: { type: 'object', properties: {}, required: [] } },
    { type: 'function', name: 'annulla_proposta', description: 'Annulla la scheda aperta (non salva niente), se l\'utente dice di no o cambia idea.', parameters: { type: 'object', properties: {}, required: [] } },
  ];
  const voiceInstructions = () => `${systemPrompt()}

MODALITÀ VOCE (stai parlando a voce, in tempo reale):
- Parla SEMPRE e SOLO in italiano. Sei Alma, l'assistente di Almacis: voce calma, chiara e cordiale, professionale, svelta.
- Frasi brevi e naturali: al massimo due o tre frasi per risposta, poi fermati. Niente elenchi lunghi, tabelle o Markdown: dì i due o tre numeri che contano e offri di continuare («vuoi i dettagli?»).
- Prima di una ricerca dì una frase breve come «Un attimo che guardo…» e poi chiama lo strumento.
- Numeri, importi e date in modo parlato («milleduecento euro», «martedì venticinque»).
- Per registrare qualcosa usa SOLO gli strumenti «proponi_…»: prepara la proposta, riassumila in una frase e chiedi «Confermi?». Chiama «conferma_proposta» SOLO dopo un sì chiaro; con un no o un dubbio chiama «annulla_proposta». Non dire mai che è fatto prima dell'esito di conferma_proposta.
- Più cose dette insieme: chiama tutti i «proponi_…» nella stessa risposta; conferma_proposta le salva tutte. Correzioni prima del sì: «modifica_proposta». Omonimi: chiedi quale e usa «scegli_opzione».
- Quando la risposta ha dei numeri presi da una ricerca, chiama anche «mostra_numeri» con i 1–4 numeri chiave e il loro fonte_id: compaiono sullo schermo, tu dilli comunque a voce.
- La conferma la controlla il server: vale solo un «sì» detto subito dopo la tua domanda, oppure un tocco su Conferma. Se conferma_proposta risponde che il sì non è chiaro, chiedi di nuovo; non dire mai che è salvato.
- Se l'utente ti interrompe, fermati e ascolta.`;
  app.post(`${BASE}/voce/sessione`, async (req, res) => {
    await voiceCheck(req);
    const s = await settings();
    const context = await V.chatContext(req, req.body?.chat_id);
    const { rows: [c] } = await db.query('INSERT INTO assistant_conversations (user_id, title) VALUES ($1, $2) RETURNING id', [req.user.id, `Conversazione a voce · ${today().split('-').reverse().join('/')}`]);
    const reads = await toolsFor(req), acts = await actionsFor(req, s);
    const tools = [...reads, ...acts].map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.input_schema }));
    if (acts.length) tools.push(...bozze.TOOLS.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.input_schema })), ...CONFIRM_TOOLS);
    tools.push(V.NUMBERS_TOOL);
    const rules = (await db.query('SELECT text FROM assistant_rules WHERE active ORDER BY id')).rows.map(r => r.text);
    const session = { type: 'realtime', model: VOICE_MODEL,
      instructions: [voiceInstructions(), todayBlock(req.user).text, rules.length ? `Regole della direzione di Almacis (seguile sempre):\n${rules.map(r => `- ${r}`).join('\n')}` : '', context].filter(Boolean).join('\n\n'),
      audio: { input: { noise_reduction: { type: 'near_field' }, transcription: { model: 'gpt-4o-mini-transcribe', language: 'it' }, turn_detection: { type: 'semantic_vad', eagerness: 'low', interrupt_response: false } },
        output: { voice: process.env.OPENAI_ALMA_VOICE || 'marin' } },
      tools, tool_choice: 'auto' };
    let secret, vs;
    try { secret = await rt.secret(session); vs = await V.create(req, c.id, secret); } catch (e) { await db.query('DELETE FROM assistant_conversations WHERE id = $1', [c.id]); throw e; }
    res.json({ conversation_id: c.id, model: VOICE_MODEL, max_seconds: vs.max_seconds, beat_ms: V.BEAT_MS, with_context: !!context });
  });
  app.post(`${BASE}/voce/collega`, async (req, res) => res.json(await V.link(await ownConversation(req, req.body?.conversation_id), req.body?.sdp)));
  app.post(`${BASE}/voce/battito`, async (req, res) => { const conv = await ownConversation(req, req.body?.conversation_id); res.json(V.state(await V.seen(conv.id))); });
  app.post(`${BASE}/voce/strumento`, async (req, res) => {
    const conv = await ownConversation(req, req.body?.conversation_id);
    const name = String(req.body?.name || '');
    let args = req.body?.arguments;
    if (typeof args === 'string') { try { args = JSON.parse(args || '{}'); } catch { args = {}; } }
    args = args && typeof args === 'object' ? args : {};
    const vrow = await V.seen(conv.id);
    if (!vrow || vrow.ended_at) return res.json({ output: JSON.stringify({ error: 'La chiamata è finita.' }), voce: V.state(vrow) });
    const s = await settings();
    if (name === 'mostra_numeri') {
      const b = await V.showNumbers(conv.id, args);
      return res.json({ output: JSON.stringify({ mostrati: b.numeri.length, non_verificati: b.numeri.filter(n => !n.ok).map(n => n.testo) }), numeri: b.numeri, fonti: b.fonti, silent: true });
    }
    const acts = await actionsFor(req, s);
    if (name === 'conferma_proposta' || name === 'annulla_proposta') {
      let open = await openProposal(conv.id);
      if (open && proposalExpired(open)) { await expireOpen(conv.id); open = null; }
      if (!open) return res.json({ output: JSON.stringify({ error: 'Non c\'è nessuna proposta aperta da confermare.' }) });
      const rows = await bozze.groupRows(open);
      let yes = null;
      if (name === 'conferma_proposta') {
        yes = await V.yesFor(conv.id, rows);
        if (!yes.ok) {
          return res.json({ output: JSON.stringify({ error: yes.text ? `Non ho sentito un «sì» chiaro (ho sentito: «${yes.text}»): non ho salvato niente. Chiedi di nuovo se conferma, o di toccare Conferma.` : 'Non ho sentito nessun «sì»: non ho salvato niente. Chiedi se conferma, o di toccare Conferma.' }),
            proposals: await Promise.all(rows.map(x => proposalView(x))), yes_missing: true });
        }
      }
      let r2;
      try { r2 = await bozze.settleGroup(req, rows, name === 'conferma_proposta' ? null : []); } catch (e) { return res.json({ output: JSON.stringify({ error: e.message }) }); }
      if (yes) await V.markConfirmed(rows.map(x => x.id), yes);
      return res.json({ output: JSON.stringify({ esito: r2.reply }), proposals: await proposalsById(rows.map(x => x.id)) });
    }
    if (bozze.TOOLS.some(t => t.name === name)) {
      if (!acts.length) return res.json({ output: JSON.stringify({ error: 'Non disponibile per il tuo profilo.' }) });
      const p = await bozze.runTool(req, conv.id, name, args);
      if ((p.proposals || []).length) await V.pend(conv.id, { proposals: p.proposals.map(x => x.id) });
      return res.json({ output: resultJson(p.out), proposals: p.proposals || [] });
    }
    const tool = [...(await toolsFor(req)), ...acts].find(t => t.name === name);
    if (!tool) return res.json({ output: JSON.stringify({ error: 'Ricerca non disponibile per il tuo profilo.' }) });
    const seenV = voiceSeen.get(conv.id) || { free: 0 };
    let out, proposals = [];
    if (tool.preview_tool) {
      const no = DIFESA.guard({ tool, input: args, userTexts: await userTexts(conv.id), ctx: seenV, checkAsk: false, contactsAfterDataOnly: true });
      if (no) out = { error: no };
      else {
        const g = voiceGroups.get(conv.id);
        const group = g && g.key === String(req.body?.gruppo || '') ? g.group : { id: null, size: 0 };
        voiceGroups.set(conv.id, { key: String(req.body?.gruppo || ''), group });
        const p = await bozze.propose(req, conv.id, tool, args, group); out = p.out;
        if (p.id && seenV.free) await flagFromData(p.id);
        if (p.id) { proposals = await proposalsById((await bozze.groupRows((await db.query('SELECT * FROM assistant_actions WHERE id = $1', [p.id])).rows[0])).map(x => x.id)); await V.pend(conv.id, { proposals: proposals.map(x => x.id) }); }
      }
    } else {
      out = DIFESA.wrap(await V.addFonte(conv.id, await runTool(req, tool, args)), seenV);
      voiceSeen.set(conv.id, seenV);
    }
    await touchConv(conv.id);
    res.json({ output: resultJson(out), label: tool.label, proposals });
  });
  const voiceGroups = new Map(); // conversazione → { key: id della risposta, group } (le proposte di una risposta insieme)
  app.post(`${BASE}/voce/trascritto`, async (req, res) => {
    const conv = await ownConversation(req, req.body?.conversation_id);
    const role = req.body?.role === 'assistant' ? 'assistant' : 'user';
    const text = String(req.body?.text || '').trim().slice(0, MAX_TEXT);
    if (!text) return res.json({ ok: true });
    const st = await V.line(conv, role, role === 'assistant' ? DIFESA.cleanReply(text) : text);
    if (role === 'user') voiceSeen.delete(conv.id);
    await touchConv(conv.id);
    res.json({ ok: true, voce: st });
  });
  app.post(`${BASE}/voce/fine`, async (req, res) => {
    const conv = await ownConversation(req, req.body?.conversation_id);
    const row = await V.sessionOf(conv.id);
    const closed = row ? await V.close(row.id, 'fine') : null;
    const { rows: [n] } = await db.query('SELECT COUNT(*)::int AS n FROM assistant_messages WHERE conversation_id = $1', [conv.id]);
    if (!n.n) await db.query('DELETE FROM assistant_conversations WHERE id = $1', [conv.id]); // chiamata senza frasi: non resta una conversazione vuota
    voiceSeen.delete(conv.id); voiceGroups.delete(conv.id);
    res.json({ ok: true, voce: V.state(closed) });
  });

  // ── dashboard di Alma (migrazione 059): grafici tenuti, rifatti con i dati di oggi e i permessi di chi guarda ──
  const dashView = r => ({ id: r.id, titolo: r.title, chart: { ...r.snapshot, titolo: r.title }, aggiornato: r.refreshed_at, errore: r.refresh_error || undefined });
  async function ownDash(req) {
    const { rows: [r] } = await db.query('SELECT * FROM assistant_dashboard WHERE id = $1', [Number(req.params.id) || 0]);
    if (!r || r.user_id !== req.user.id) throw new HttpError(404, 'Grafico non trovato.');
    return r;
  }
  app.post(`${BASE}/dashboard`, async (req, res) => {
    const { rows: [m] } = await db.query(`SELECT m.meta FROM assistant_messages m JOIN assistant_conversations c ON c.id = m.conversation_id
      WHERE m.id = $1 AND c.user_id = $2`, [Number(req.body?.message_id) || 0, req.user.id]);
    const c = m && Array.isArray(m.meta?.charts) ? m.meta.charts.find(x => x.id === String(req.body?.chart_id || '')) : null;
    if (!c || !c.source) throw new HttpError(404, 'Grafico non trovato.');
    const { rows: [n] } = await db.query('SELECT COUNT(*)::int AS n FROM assistant_dashboard WHERE user_id = $1', [req.user.id]);
    if (n.n >= 24) throw new HttpError(409, 'La dashboard ha già 24 grafici: togline qualcuno.');
    const { source, ...snapshot } = c;
    const { rows: [r] } = await db.query(`INSERT INTO assistant_dashboard (user_id, title, tool, tool_input, spec, snapshot, sort)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [req.user.id, c.titolo, source.tool, JSON.stringify(source.input || {}), JSON.stringify({ ...source.spec, tipo: c.tipo }), JSON.stringify(snapshot), n.n]);
    res.status(201).json(dashView(r));
  });
  app.get(`${BASE}/dashboard`, async (req, res) => {
    const { rows } = await db.query('SELECT * FROM assistant_dashboard WHERE user_id = $1 ORDER BY sort, id', [req.user.id]);
    res.json({ grafici: rows.map(dashView) });
  });
  // Rifà la ricerca (stessi permessi di chi guarda: se la ricerca non gli è più permessa, errore) e ricostruisce il grafico.
  app.post(`${BASE}/dashboard/:id/aggiorna`, async (req, res) => {
    const r = await ownDash(req);
    const tool = (await toolsFor(req)).find(t => t.name === r.tool);
    let snapshot = r.snapshot, error = null;
    try {
      if (!tool) throw new Error('Questa ricerca non è più disponibile per te.');
      const out = await tool.run(r.tool_input || {}, getter(req), ctxOf(req));
      if (out && out.error) throw new Error(out.error);
      snapshot = { ...GRAF.build(out, r.spec), id: r.snapshot.id };
    } catch (e) { error = String(e.message || e).slice(0, 300); }
    const { rows: [u] } = await db.query(`UPDATE assistant_dashboard SET snapshot = $2, refresh_error = $3, refreshed_at = CASE WHEN $3::text IS NULL THEN now() ELSE refreshed_at END
      WHERE id = $1 RETURNING *`, [r.id, JSON.stringify(snapshot), error]);
    res.json(dashView(u));
  });
  app.patch(`${BASE}/dashboard/:id`, async (req, res) => {
    const r = await ownDash(req);
    const b = req.body || {};
    const title = b.titolo !== undefined ? String(b.titolo).replace(/\s+/g, ' ').trim().slice(0, 120) : r.title;
    if (!title) throw new HttpError(400, 'Serve un titolo.');
    let spec = r.spec, snapshot = r.snapshot;
    if (b.tipo !== undefined) {
      if (!GRAF.TIPI.includes(b.tipo)) throw new HttpError(400, 'Tipo: barre, linee, tabella o torta.');
      spec = { ...spec, tipo: b.tipo };
      snapshot = { ...snapshot, tipo: b.tipo === 'torta' && (snapshot.serie.length > 1 || snapshot.etichette.length > 6) ? 'barre' : b.tipo };
    }
    const { rows: [u] } = await db.query('UPDATE assistant_dashboard SET title = $2, spec = $3, snapshot = $4, sort = COALESCE($5, sort) WHERE id = $1 RETURNING *',
      [r.id, title, JSON.stringify(spec), JSON.stringify(snapshot), Number.isInteger(b.posizione) ? b.posizione : null]);
    res.json(dashView(u));
  });
  app.delete(`${BASE}/dashboard/:id`, async (req, res) => {
    const r = await ownDash(req);
    await db.query('DELETE FROM assistant_dashboard WHERE id = $1', [r.id]);
    res.json({ ok: true });
  });

  app.get(`${BASE}/status`, async (req, res) => {
    const s = await settings();
    const eur = n => r2(n * s.usd_eur);
    res.json({ configured: configured(), enabled: s.enabled, admin: admin(req), fake: call === fakeClaude, actions: s.actions, voce: s.voice && voiceReady(), voce_live: s.voice && Boolean(almaRealtime || openaiKey),
      limits: { daily_eur: s.daily_eur, used_today_eur: eur(await todayCostUsd(req.user.id)), month_blocked: (await monthCostUsd()) * s.usd_eur >= s.monthly_eur },
      tools: (await toolsFor(req)).map(t => t.name) });
  });
  app.get(`${BASE}/conversations`, async (req, res) => {
    const { rows } = await db.query('SELECT id, title, updated_at FROM assistant_conversations WHERE user_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 50', [req.user.id]);
    res.json({ conversations: rows });
  });
  app.get(`${BASE}/conversations/:id`, async (req, res) => {
    const c = await ownConversation(req, req.params.id);
    const { rows } = await db.query('SELECT id, role, display, meta, created_at FROM assistant_messages WHERE conversation_id = $1 AND display IS NOT NULL ORDER BY id', [c.id]);
    const traceIds = rows.map(m => m.meta?.trace_id).filter(Boolean);
    const ratings = new Map((traceIds.length ? (await db.query('SELECT id, rating FROM assistant_traces WHERE id = ANY($1::int[])', [traceIds])).rows : []).map(t => [t.id, t.rating]));
    const messages = [];
    for (const m of rows) {
      const meta = m.meta || {};
      messages.push({ id: m.id, role: m.role, text: m.display, ...(meta.foto ? { foto: meta.foto } : {}), steps: meta.steps || [], proposals: await proposalsById(meta.proposals), created_at: m.created_at,
        ...(meta.stopped ? { stopped: true } : {}), ...(meta.ricevute && meta.ricevute.fonti ? { ricevute: { fonti: meta.ricevute.fonti, numeri: meta.ricevute.numeri } } : {}),
        ...(meta.blocchi ? { blocchi: meta.blocchi } : {}), ...(meta.contesto ? { contesto: meta.contesto } : {}), ...(meta.charts ? { charts: meta.charts.map(chartView) } : {}),
        ...(meta.trace_id ? { trace_id: meta.trace_id, rating: ratings.get(meta.trace_id) ?? null } : {}) });
    }
    res.json({ id: c.id, title: c.title, messages });
  });
  app.patch(`${BASE}/conversations/:id`, async (req, res) => {
    const c = await ownConversation(req, req.params.id);
    const title = String(req.body?.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) throw new HttpError(400, 'Scrivi un titolo.');
    await db.query('UPDATE assistant_conversations SET title = $2 WHERE id = $1', [c.id, title]);
    res.json({ id: c.id, title });
  });
  app.delete(`${BASE}/conversations/:id`, async (req, res) => {
    const c = await ownConversation(req, req.params.id);
    await db.query('DELETE FROM assistant_conversations WHERE id = $1', [c.id]);
    res.json({ ok: true });
  });
  app.post(`${BASE}/chat`, async (req, res) => res.json(await chat(req)));
  app.post(`${BASE}/chat/stream`, (req, res) => chatStream(req, res));
  app.post(`${BASE}/tracce/:id/voto`, async (req, res) => {
    const { rows: [tr] } = await db.query('SELECT id, user_id FROM assistant_traces WHERE id = $1', [Number(req.params.id) || 0]);
    if (!tr || tr.user_id !== req.user.id) throw new HttpError(404, 'Risposta non trovata.');
    const v = Number(req.body?.voto);
    if (![1, -1, 0].includes(v)) throw new HttpError(400, 'Voto: 1 (utile), -1 (non utile) o 0 per toglierlo.');
    const comment = String(req.body?.commento || '').trim().slice(0, 1000) || null;
    await db.query('UPDATE assistant_traces SET rating = $2, rating_comment = $3, rated_at = $4 WHERE id = $1', [tr.id, v || null, v ? comment : null, v ? new Date() : null]);
    res.json({ ok: true, trace_id: tr.id, rating: v || null });
  });
  bozze.routes(app, BASE, {
    guard: async () => {},
    enabledCheck: async () => { if (!(await settings()).enabled) throw new HttpError(403, 'Alma è spenta.'); },
  });

  // Costi e uso del mese, per modello e per giorno, e qualità delle risposte (👍/👎, errori, numeri senza ricevuta).
  async function stats(s) {
    const from = monthStart();
    const eur = n => r2(Number(n || 0) * s.usd_eur);
    const { rows: byModel } = await db.query('SELECT model, COUNT(*)::int AS calls, SUM(cost_usd) AS cost FROM assistant_usage WHERE day >= $1 GROUP BY model ORDER BY model', [from]);
    const { rows: days } = await db.query("SELECT day::text AS day, SUM(cost_usd) AS cost FROM assistant_usage WHERE day >= CURRENT_DATE - 13 GROUP BY day ORDER BY day");
    const { rows: [q] } = await db.query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE rating = 1)::int AS up, COUNT(*) FILTER (WHERE rating = -1)::int AS down,
        COUNT(*) FILTER (WHERE status = 'errore' AND COALESCE(error, '') <> $2)::int AS errors, COUNT(DISTINCT user_id)::int AS users,
        COUNT(*) FILTER (WHERE numbers_unverified > 0)::int AS unverified, AVG(latency_ms) AS ms, SUM(cost_usd) AS cost
      FROM assistant_traces WHERE created_at >= $1::date`, [from, STOPPED]);
    const label = m => CLAUDE.LABELS[m] || m;
    const month = byModel.reduce((a, x) => a + Number(x.cost || 0), 0);
    return {
      month: { from, cost_eur: eur(month), answers: q.n, users: q.users, avg_cent: q.n ? r2((Number(month) * s.usd_eur * 100) / q.n) : null },
      by_model: byModel.map(x => ({ model: x.model, label: label(x.model), calls: x.calls, cost_eur: eur(x.cost) })),
      days: days.map(d => ({ day: d.day, cost_eur: eur(d.cost) })),
      quality: { up: q.up, down: q.down, errors: q.errors, unverified: q.unverified, avg_seconds: q.ms ? Math.round(Number(q.ms) / 100) / 10 : null },
    };
  }
  app.get(`${BASE}/settings`, async (req, res) => {
    adminOnly(req);
    const s = await settings();
    res.json({ ...s, configured: configured(), fake: call === fakeClaude, modes: CLAUDE.MODE_LABELS, stats: await stats(s) });
  });
  app.put(`${BASE}/settings`, async (req, res) => {
    adminOnly(req);
    const b = req.body || {};
    const before = await settings();
    const next = { ...before };
    if (b.enabled !== undefined) next.enabled = Boolean(b.enabled);
    if (b.actions !== undefined) next.actions = Boolean(b.actions);
    if (b.voice !== undefined) next.voice = Boolean(b.voice);
    if (b.model_mode !== undefined) {
      if (!CLAUDE.MODE_LABELS[b.model_mode]) throw new HttpError(400, 'Modelli: auto, sonnet o haiku.');
      next.model_mode = b.model_mode;
    }
    const money = (v, label, max) => {
      const n = Number(String(v).replace(',', '.'));
      if (!(n > 0) || n > max) throw new HttpError(400, `${label}: un importo in euro da 0,01 a ${max.toLocaleString('it-IT')}.`);
      return Math.round(n * 100) / 100;
    };
    if (b.monthly_eur !== undefined) next.monthly_eur = money(b.monthly_eur, 'Quota del mese', 10000);
    if (b.daily_eur !== undefined) next.daily_eur = money(b.daily_eur, 'Quota per persona al giorno', 1000);
    await saveSetting(db, SETTING, next, req.user.id);
    audit?.log(req.user.id, 'alma.impostazioni', { before, after: next });
    res.json({ ...next, configured: configured() });
  });
  // Risposte: le ultime tracce, con chi ha chiesto, il voto e il commento (solo amministratori).
  app.get(`${BASE}/risposte`, async (req, res) => {
    adminOnly(req);
    const filter = String(req.query.voto || '');
    const where = filter === 'su' ? 'WHERE t.rating = 1' : filter === 'giu' ? 'WHERE t.rating = -1' : filter === 'problemi' ? "WHERE t.status = 'errore' OR t.numbers_unverified > 0" : '';
    const { rows } = await db.query(`SELECT t.id, t.question, t.model, t.tool_count, t.tool_errors, t.cost_usd, t.latency_ms, t.status, t.error, t.numbers_checked, t.numbers_unverified,
        t.unverified_numbers, t.rating, t.rating_comment, t.created_at, u.name AS user_name, t.steps
      FROM assistant_traces t LEFT JOIN users u ON u.id = t.user_id ${where} ORDER BY t.id DESC LIMIT 100`);
    const s = await settings();
    res.json({ risposte: rows.map(({ steps, ...t }) => ({ ...t, cost_cent: r2(Number(t.cost_usd) * s.usd_eur * 100), ricerche: [...new Set((steps || []).flatMap(x => (x.tools || []).map(y => y.name)))] })) });
  });
  app.get(`${BASE}/regole`, async (req, res) => {
    adminOnly(req);
    res.json({ regole: (await db.query('SELECT r.id, r.text, r.active, r.updated_at, u.name AS created_by_name FROM assistant_rules r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.id')).rows });
  });
  const ruleText = v => {
    const t = String(v || '').replace(/\s+/g, ' ').trim();
    if (!t) throw new HttpError(400, 'Scrivi la regola.');
    if (t.length > 500) throw new HttpError(400, 'La regola è troppo lunga (al massimo 500 caratteri).');
    return t;
  };
  app.post(`${BASE}/regole`, async (req, res) => {
    adminOnly(req);
    const { rows: [n] } = await db.query('SELECT COUNT(*)::int AS n FROM assistant_rules');
    if (n.n >= 50) throw new HttpError(400, 'Al massimo 50 regole.');
    const { rows: [r] } = await db.query('INSERT INTO assistant_rules (text, created_by) VALUES ($1, $2) RETURNING id, text, active', [ruleText(req.body?.text), req.user.id]);
    res.status(201).json(r);
  });
  app.patch(`${BASE}/regole/:id`, async (req, res) => {
    adminOnly(req);
    const sets = [], vals = [Number(req.params.id) || 0];
    if (req.body?.text !== undefined) { vals.push(ruleText(req.body.text)); sets.push(`text = $${vals.length}`); }
    if (req.body?.active !== undefined) { vals.push(Boolean(req.body.active)); sets.push(`active = $${vals.length}`); }
    if (!sets.length) throw new HttpError(400, 'Niente da cambiare.');
    const { rows: [r] } = await db.query(`UPDATE assistant_rules SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING id, text, active`, vals);
    if (!r) throw new HttpError(404, 'Regola non trovata.');
    res.json(r);
  });
  app.delete(`${BASE}/regole/:id`, async (req, res) => {
    adminOnly(req);
    await db.query('DELETE FROM assistant_rules WHERE id = $1', [Number(req.params.id) || 0]);
    res.json({ ok: true });
  });

  return {
    setClient: fn => { call = fn || CLAUDE.openaiCall; route = fn ? null : CLAUDE.openaiRoute; routerPausedUntil = 0; }, // solo per i test
    setStreamTimeout: ms => { streamTimeoutMs = ms || 90 * 1000; }, // solo per i test
    setVoice: (t, s) => { if (t) transcribe = t; if (s) speak = s; }, // solo per i test
    voice: V, // solo per i test
    settings, toolsFor, email,
  };
}

module.exports = { registerAssistente, systemPrompt };
