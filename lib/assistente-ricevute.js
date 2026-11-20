// Alma: ogni numero con la sua fonte (porting dalle ricevute di Bacco, l'assistente della cantina).
// - Ogni ricerca ha una ricevuta (lib/assistente-strumenti.js, receiptOf): fonte, periodo, filtri, righe, aggiornato, link
//   alla pagina di Alma Space con gli stessi filtri. Nel risultato che legge Claude c'è solo fonte_id (f1, f2, …).
// - Claude scrive i numeri chiave in grassetto seguiti dalla fonte tra graffe: **€ 12.345**{f2}.
// - Dopo la risposta checkReply() cerca ogni cifra in grassetto nei risultati delle ricerche della conversazione (con la
//   tolleranza dell'arrotondamento mostrato): se non c'è è «non verificata» (la chat la segna in rosso, la traccia la
//   conta). Se la graffa manca o è sbagliata, la fonte giusta la trova il controllo.
// Niente dipendenze: lo usano routes/assistente.js e i test.

const MARK = /\{(f\d+)\}/g;
const BOLD = /\*\*([^*\n]+)\*\*(?:\{(f\d+)\})?/g;
// Numero all'italiana (12.345,67), con il punto decimale (12.5) o intero; segno a parte.
const NUM = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g;
const MULT = [[/^\s*(?:mila|k)\b/i, 1e3], [/^\s*(?:milioni|milione|mln|mio)\b\.?/i, 1e6], [/^\s*(?:miliardi|miliardo|mld)\b/i, 1e9]];

const stripMarks = text => String(text || '').replace(MARK, '');

// I numeri scritti in un testo, con il numero di decimali mostrati (per la tolleranza) e l'eventuale «mila/milioni».
function shownNumbers(s) {
  const out = [];
  const str = String(s);
  let m;
  NUM.lastIndex = 0;
  while ((m = NUM.exec(str))) {
    const raw = m[0];
    let v, dec = 0;
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(raw)) { const [int, d = ''] = raw.split(','); v = Number(int.replace(/\./g, '') + (d ? `.${d}` : '')); dec = d.length; }
    else if (raw.includes(',')) { v = Number(raw.replace(',', '.')); dec = raw.split(',')[1].length; }
    else if (raw.includes('.')) { v = Number(raw); dec = raw.split('.')[1].length; }
    else v = Number(raw);
    let mult = 1;
    const after = str.slice(m.index + raw.length);
    for (const [re, k] of MULT) if (re.test(after)) { mult = k; break; }
    if (Number.isFinite(v)) out.push({ text: raw, value: v * mult, tol: 10 ** -dec * mult });
  }
  return out;
}

// Tutti i numeri di un risultato: valori numerici, numeri dentro i testi (date, nomi), lunghezze degli elenchi.
function resultNumbers(o, acc = []) {
  if (o == null) return acc;
  if (typeof o === 'number') { if (Number.isFinite(o)) acc.push(Math.abs(o)); return acc; }
  if (typeof o === 'string') { for (const x of o.match(/\d+(?:\.\d+)?/g) || []) acc.push(Number(x)); return acc; }
  if (Array.isArray(o)) { acc.push(o.length); for (const x of o) resultNumbers(x, acc); return acc; }
  if (typeof o === 'object') for (const v of Object.values(o)) resultNumbers(v, acc);
  return acc;
}
const has = (values, n) => values.some(x => Math.abs(x - Math.abs(n.value)) <= n.tol + 1e-9);

// sources: [{ id, values }] (id null = risultato senza ricevuta, es. una proposta); question: la domanda (i numeri
// detti da chi chiede valgono). Restituisce i numeri in grassetto nell'ordine del testo.
function checkReply(text, sources, question = '') {
  const asked = resultNumbers(String(question || ''));
  const numeri = [];
  let m;
  BOLD.lastIndex = 0;
  while ((m = BOLD.exec(String(text || '')))) {
    const inner = m[1].trim(), mark = m[2] || null;
    const nums = shownNumbers(inner);
    if (!nums.length) continue; // grassetto senza cifre: niente da controllare
    const fits = s => nums.every(n => has(s.values, n));
    const marked = mark && sources.find(s => s.id === mark);
    const src = marked && fits(marked) ? marked : sources.find(s => s.id && fits(s)) || sources.find(fits);
    const ok = !!src || nums.every(n => has(asked, n));
    numeri.push({ testo: inner, fonte: src && src.id ? src.id : null, ok });
  }
  return { numeri, non_verificati: numeri.filter(n => !n.ok).map(n => n.testo) };
}

// Le ricerche della conversazione dai messaggi salvati: tool_result con fonte_id → valori; quelli senza → senza fonte.
function sourcesFrom(messages) {
  const out = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const b of msg.content) {
      if (b.type !== 'tool_result' || b.is_error || typeof b.content !== 'string') continue;
      let o;
      try { o = JSON.parse(b.content); } catch { continue; }
      out.push({ id: (o && o.fonte_id) || null, tool_use_id: b.tool_use_id, values: resultNumbers(o) });
    }
  }
  return out;
}

module.exports = { checkReply, sourcesFrom, shownNumbers, resultNumbers, stripMarks };
