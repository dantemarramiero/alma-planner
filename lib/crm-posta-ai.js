// Riassunto e bozza col tuo tono (ALM2-61, tavola G del canvas «Progetto da email», approvata da Dante il 22/11/2026).
// - G1: solo al clic; il costo di ogni volta torna indietro (eur) e finisce in crm_mail_spend (Costi AI).
// - G2: il tono viene dalle ultime email che hai mandato a quella persona (tu/lei, saluto, chiusura, firma, lunghezza);
//   i testi servono solo per la richiesta e non si salvano.
// - G3: «Riassumi» ha senso su email lunghe o conversazioni di 3+ email (lo decide la pagina con isLong).
// Senza OPENAI_API_KEY (test, locale) tutto funziona con regole semplici.
const S = require('./crm-scrivo');
const { askJson, amountOf, deadlineOf, baseSubject } = require('./crm-posta');
const { HttpError } = require('./http');

// Modello leggero (Dante 22/11: «un modello meno costoso»): gpt-4.1-nano, ~1/4 di gpt-4.1-mini. Si cambia con
// OPENAI_MAIL_LIGHT_MODEL e i prezzi in $ per milione di token con OPENAI_LIGHT_PRICE_IN / _OUT.
const LIGHT = { model: process.env.OPENAI_MAIL_LIGHT_MODEL || 'gpt-4.1-nano', price: { in: Number(process.env.OPENAI_LIGHT_PRICE_IN || 0.1), out: Number(process.env.OPENAI_LIGHT_PRICE_OUT || 0.4) } };

// Catena dal più economico (22/11: in produzione gpt-4.1-nano risponde 404 con la chiave di Almacis): si prova nano,
// poi gpt-4o-mini, poi il modello della Posta; il primo che risponde resta quello buono finché il server gira.
const CHAIN = [LIGHT, { model: 'gpt-4o-mini', price: { in: 0.15, out: 0.6 } }, { model: process.env.OPENAI_MAIL_MODEL || 'gpt-4.1-mini', price: { in: 0.4, out: 1.6 } }]
  .filter((x, i, a) => a.findIndex(y => y.model === x.model) === i);
let chainAt = 0;
async function askLight(opts) {
  if (!opts.key) return null;
  let last;
  for (let i = chainAt; i < CHAIN.length; i++) {
    try {
      const r = await askJson({ ...opts, ...CHAIN[i] });
      if (i !== chainAt) { console.warn(`[posta] modello ${CHAIN[chainAt].model} non disponibile, uso ${CHAIN[i].model}`); chainAt = i; }
      return r ? { ...r, model: CHAIN[i].model } : null;
    } catch (err) {
      last = err;
      if (!/OpenAI (400|403|404)/.test(err.message)) throw err;
    }
  }
  throw last;
}
const aiDown = what => new HttpError(502, `Alma non riesce a ${what} adesso: riprova tra poco`, 'ai');

const own = text => S.ownPart(String(text || '')).replace(/\r/g, '').trim();
const words = text => (String(text || '').match(/\S+/g) || []).length;
const sentences = text => String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-ZÀ-Ü])/).map(s => s.trim()).filter(Boolean);
const first = name => String(name || '').split(' ').filter(w => !/^(ing|arch|geom|dott|avv|sig|sig\.ra)\.?$/i.test(w))[0] || '';
const byDate = list => list.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));

// Email lunga o conversazione lunga: qui ha senso «Riassumi»
const isLong = (msg, count = 1) => count >= 3 || words(own(msg?.body)) > 150;

const thread = (messages, max = 16000) => byDate(messages)
  .map(m => `--- ${String(m.date || '').slice(0, 16)} · da ${m.from.name || ''} <${m.from.address}>\nOggetto: ${m.subject}\n${own(m.body || m.preview).slice(0, 5000)}`)
  .join('\n\n').slice(-max);

// ── riassunto ─────────────────────────────────────────────────────────────────────────────────────
function heuristicSummary(messages, { me = '' } = {}) {
  const list = byDate(messages);
  const last = list[list.length - 1] || {};
  const body = own(last.body || last.preview);
  const all = list.map(m => own(m.body || m.preview)).join('\n');
  const ss = sentences(body.replace(/^(buongiorno|buonasera|ciao|gentile|egregio|salve)[^\n]*\n/i, ''));
  const ask = sentences(all).filter(s => /\?|\b(ci serve|vi chiedo|ti chiedo|potete|potresti|potreste|chiediamo|servirebbe|attendiamo|aspettiamo)\b/i.test(s)).slice(-3);
  const amount = amountOf(all);
  const deadline = deadlineOf(all);
  const lastFromMe = me && last.from?.address === me.toLowerCase();
  return {
    breve: (s => s.charAt(0).toUpperCase() + s.slice(1))(ss.slice(0, 2).join(' ').slice(0, 400) || last.subject || ''),
    chiedono: ask.join(' ').slice(0, 300),
    cifre_date: [amount.text ? amount.text : '', deadline ? `entro ${deadline.split('-').reverse().join('/')}` : ''].filter(Boolean).join(' · '),
    tocca_a_te: lastFromMe ? '' : `Rispondere a ${first(last.from?.name) || last.from?.address || 'chi ha scritto'}.`,
  };
}

async function summarize(messages, ctx = {}) {
  const base = heuristicSummary(messages, ctx);
  const ai = await askLight({
    key: ctx.key, fetchImpl: ctx.fetchImpl, maxTokens: 500,
    system: [
      'Riassumi in italiano una conversazione email per un dirigente di Almacis (costruzioni e impianti) che la legge al posto suo.',
      `Lui è ${ctx.meName || 'il destinatario'} <${ctx.me || ''}>. Rispondi SOLO con JSON con le chiavi:`,
      'breve (2-3 frasi: di cosa si tratta e a che punto è), chiedono (cosa chiedono a noi, una frase, "" se niente),',
      'cifre_date (importi, quantità e date importanti separati da " · ", "" se niente), tocca_a_te (cosa deve fare lui adesso,',
      'una frase, "" se niente). Non inventare nulla che non sia scritto.',
    ].join(' '),
    input: thread(messages),
  }).catch(err => { console.warn('[posta] riassunto AI non riuscito:', err.message); return null; });
  if (!ai) { if (ctx.key) throw aiDown('fare il riassunto'); return { ...base, eur: 0, ai: false }; }
  const d = ai.data || {};
  const pick = (k, max) => (typeof d[k] === 'string' ? d[k].trim().slice(0, max) : base[k]);
  return { breve: pick('breve', 700), chiedono: pick('chiedono', 400), cifre_date: pick('cifre_date', 300), tocca_a_te: pick('tocca_a_te', 300), eur: ai.eur, ai: true, model: ai.model };
}

// ── tono dalle email mandate a quella persona ─────────────────────────────────────────────────────
// sent: testi (solo la parte scritta da te) delle ultime email a quella persona, dalla più recente.
function toneOf(sent, { name = '' } = {}) {
  const texts = (sent || []).map(own).filter(t => t.length > 10).slice(0, 10);
  if (!texts.length) return { n: 0, tu: null, saluto: '', chiusura: '', firma: '', lunghezza: '', chips: [] };
  const lines = t => t.split('\n').map(l => l.trim()).filter(Boolean);
  const count = re => texts.filter(t => re.test(t)).length;
  const tu = count(/\b(ciao|ti\b|tuo|tua|tuoi|sei\b|fammi|dimmi|scrivimi|chiamami|grazie a te)\b/i);
  const lei = count(/\b(gentile|egregio|la ringrazio|le chiedo|le scrivo|sua|suo|potrebbe|cordialmente|resto a disposizione)\b/i);
  const most = arr => { const m = new Map(); for (const x of arr.filter(Boolean)) m.set(x, (m.get(x) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || ''; };
  const fn = first(name);
  const saluto = most(texts.map(t => {
    const l = lines(t)[0] || '';
    return /^(ciao|buongiorno|buonasera|gentile|egregio|caro|cara|salve|hello|hi)\b/i.test(l) && l.length < 60 ? l.replace(new RegExp(`\\b${fn}\\b`, 'i'), '{nome}').replace(/[,!.]?$/, ',') : '';
  }));
  const tail = texts.map(t => lines(t).slice(-3));
  const chiusura = most(tail.map(ls => ls.find(l => /^(a presto|grazie|cordiali saluti|saluti|un saluto|buona giornata|buon lavoro|ciao|un abbraccio|distinti saluti|resto a disposizione)/i.test(l)) || ''));
  const firma = most(tail.map(ls => { const l = ls[ls.length - 1] || ''; return l.length < 40 && !/[.?!:]$/.test(l) && !/^(a presto|grazie|saluti|cordiali)/i.test(l) ? l : ''; }));
  const avg = texts.reduce((s, t) => s + words(t), 0) / texts.length;
  const lunghezza = avg < 60 ? 'frasi brevi, diretto' : avg < 160 ? 'email di media lunghezza' : 'email articolate';
  const t = tu > lei ? true : lei > tu ? false : null;
  const chips = [t === true ? 'gli dai del tu' : t === false ? 'gli dai del lei' : null,
    saluto ? `apri con «${saluto.replace('{nome}', fn).trim()}»` : null, lunghezza,
    chiusura ? `chiudi con «${firma ? `${chiusura.replace(/[,.]$/, '')}, ${firma}` : chiusura}»` : firma ? `firmi «${firma}»` : null].filter(Boolean);
  return { n: texts.length, tu: t, saluto, chiusura, firma, lunghezza, chips };
}

const STILI = { breve: 'Rendila più breve, al massimo 4 righe di testo.', formale: 'Rendila più formale (dai del lei, tono professionale).', declina: 'Declina con garbo e lascia la porta aperta per il futuro.' };

async function toneDraft({ messages, reply, tutti = true, target, tone, samples = [], meName = '', me = '', istruzione = '', stile = '', attuale = '' }, ctx = {}) {
  const fn = first(target?.name);
  const saluto = tone.saluto ? tone.saluto.replace('{nome}', fn).replace(/\s+,/, ',') : tone.tu ? `Ciao ${fn},` : `Buongiorno${fn ? ` ${fn}` : ''},`;
  const chiusura = tone.chiusura || (tone.tu ? 'A presto,' : 'Cordiali saluti');
  const firma = tone.firma || first(meName) || meName;
  const fallback = `${saluto}\n\n${istruzione ? `${istruzione.charAt(0).toUpperCase()}${istruzione.slice(1)}.` : stile === 'declina' ? 'grazie per aver pensato a noi: questa volta non riusciamo a partecipare, ma restiamo a disposizione per le prossime occasioni.' : 'grazie del messaggio, ti rispondo a breve con quanto richiesto.'}\n\n${chiusura}\n${firma}`;
  const ai = await askLight({
    key: ctx.key, fetchImpl: ctx.fetchImpl, maxTokens: 800,
    system: [
      `Scrivi in italiano la risposta ${tutti ? 'a tutti ' : ''}all'email indicata come «email a cui rispondi», a nome di ${meName} (Almacis, costruzioni e impianti).`,
      'Imita il suo modo di scrivere a questa persona, dagli esempi: tu/lei, saluto, lunghezza, chiusura e firma.',
      'Sii concreto: rispondi alle domande e a cosa chiedono. Non promettere prezzi, date o persone che non sono nelle email o',
      'nell\'istruzione: se serve una data, proponi di fissarla. Rispondi SOLO con JSON {"text": "..."} (solo il testo della risposta,',
      'senza oggetto né citazione).',
    ].join(' '),
    input: [
      `Tono rilevato: ${tone.chips.join('; ') || 'nessuna email passata: usa il lei e un saluto cordiale'}.`,
      samples.length ? `Esempi delle sue email a ${target?.name || target?.address} (inizio e fine):\n${samples.map(s => `«${s.slice(0, 220)}${s.length > 220 ? ` … ${s.slice(-180)}` : ''}»`).join('\n')}` : '',
      istruzione ? `Cosa vuole dire: ${istruzione}` : '',
      stile && STILI[stile] ? STILI[stile] : '',
      attuale ? `Bozza attuale da rifare:\n${attuale.slice(0, 3000)}` : '',
      reply ? `Email a cui rispondi: da ${reply.from.name || ''} <${reply.from.address}>, ${String(reply.date || '').slice(0, 16)}, «${reply.subject}»` : '',
      `Conversazione:\n${thread(messages, 9000)}`,
    ].filter(Boolean).join('\n\n'),
  }).catch(err => { console.warn('[posta] bozza AI non riuscita:', err.message); return null; });
  if (!ai && ctx.key) throw aiDown('scrivere la bozza');
  return { text: ai?.data?.text ? String(ai.data.text).trim().slice(0, 8000) : fallback, eur: ai?.eur || 0, ai: Boolean(ai), model: ai?.model || null };
}

module.exports = { LIGHT, CHAIN, askLight, isLong, summarize, heuristicSummary, toneOf, toneDraft, STILI, subjectOf: baseSubject };
