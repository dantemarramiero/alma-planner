// Alma: risposte a blocchi (porting da Bacco). Claude scrive la risposta in Markdown e, quando ci sono dati, chiude con
//   ```blocchi
//   { "cifre": [...], "elenco": {...}, "azioni": [...], "domande": [...] }
//   ```
// Qui il blocco si toglie dal testo da mostrare, si controlla e si riduce a ciò che la chat sa disegnare:
//   cifre    fino a 3: { etichetta, valore, diff? }; il valore è «**€ 12.345**{f2}» come nel testo (ricevute)
//   elenco   { titolo?, voci: [{ nome, dettaglio?, link? }] } fino a 8 persone, aziende, ticket o progetti da aprire
//   azioni   fino a 3: { tipo: 'prepara', testo, chiedi } chiede ad Alma di preparare una proposta (mai un salvataggio);
//            { tipo: 'apri', testo, link } apre una pagina di Alma Space
//   domande  2–3 domande successive da toccare
// Link solo a pagine di Alma Space (#/percorso). Un blocco rotto non rompe la risposta: si ignora.

const FENCE = /```blocchi[ \t]*\r?\n?([\s\S]*?)(?:```|$)/i;
const MAX = { cifre: 3, voci: 8, azioni: 3, domande: 3, testo: 160, valore: 80 };

const str = (v, n) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, n) : '');
// Pagine di Alma Space: «#/crm/scheda/12» (anche scritto «/app#/…»). Niente altro.
const localLink = v => {
  const s = str(v, 400).replace(/^\/app(?=#\/)/, '');
  return /^#\/[^\s]*$/.test(s) && !s.includes('..') ? s : null;
};

function clean(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  const cifre = (Array.isArray(raw.cifre) ? raw.cifre : []).map(c => ({ etichetta: str(c && c.etichetta, 40), valore: str(c && c.valore, MAX.valore), diff: str(c && c.diff, 60) || undefined }))
    .filter(c => c.etichetta && c.valore && /\d/.test(c.valore)).slice(0, MAX.cifre);
  if (cifre.length) out.cifre = cifre;
  const el = raw.elenco && typeof raw.elenco === 'object' ? raw.elenco : null;
  const voci = (el && Array.isArray(el.voci) ? el.voci : []).map(v => ({ nome: str(v && v.nome, 80), dettaglio: str(v && v.dettaglio, 120) || undefined, link: localLink(v && v.link) || undefined }))
    .filter(v => v.nome).slice(0, MAX.voci);
  if (voci.length) out.elenco = { titolo: str(el.titolo, 60) || undefined, voci };
  const azioni = (Array.isArray(raw.azioni) ? raw.azioni : []).map(a => {
    const tipo = a && a.tipo === 'apri' ? 'apri' : a && (a.tipo === 'prepara' || a.tipo === 'compito') ? 'prepara' : null;
    const testo = str(a && a.testo, 60);
    if (!tipo || !testo) return null;
    if (tipo === 'apri') { const link = localLink(a.link); return link ? { tipo, testo, link } : null; }
    return { tipo, testo, chiedi: str(a.chiedi, MAX.testo) || `Prepara: ${testo}` };
  }).filter(Boolean).slice(0, MAX.azioni);
  if (azioni.length) out.azioni = azioni;
  const domande = [...new Set((Array.isArray(raw.domande) ? raw.domande : []).map(d => str(d, MAX.testo)).filter(Boolean))].slice(0, MAX.domande);
  if (domande.length) out.domande = domande;
  return Object.keys(out).length ? out : null;
}

// reply → { text: testo da mostrare (senza il blocco), blocchi | null }
function split(reply) {
  const s = String(reply || '');
  const m = FENCE.exec(s);
  if (!m) return { text: s.trim(), blocchi: null };
  const text = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim();
  let raw = null;
  try { raw = JSON.parse(m[1].trim()); } catch { raw = null; }
  return { text, blocchi: clean(raw) };
}

// Testo su cui si controllano i numeri: prima i valori delle cifre, poi il testo, nello stesso ordine in cui la chat li
// disegna (così i numeri controllati e quelli mostrati si incontrano uno a uno).
function checkText(text, blocchi) {
  const head = blocchi && blocchi.cifre ? blocchi.cifre.map(c => c.valore).join('\n') : '';
  return head ? `${head}\n${text}` : text;
}

const PROMPT = `Blocchi (chi legge capisce in 3 secondi e agisce con un tocco, anche sul telefono):
- Quando la risposta ha dati, chiudila con un blocco \`\`\`blocchi con un JSON (niente altro dopo):
\`\`\`blocchi
{"cifre":[{"etichetta":"Win ratio Facility","valore":"**40%**{f1}","diff":"+5 punti sul 2025"}],"elenco":{"titolo":"Ticket in ritardo","voci":[{"nome":"…","dettaglio":"…","link":"#/tickets/12"}]},"azioni":[{"tipo":"prepara","testo":"Crea un ticket","chiedi":"Prepara un ticket per …"},{"tipo":"apri","testo":"Apri il progetto","link":"#/projects/3"}],"domande":["E per persona?","…"]}
\`\`\`
- «cifre»: da 1 a 3 numeri che contano, ognuno in grassetto con la fonte come nel testo; «diff» solo se il risultato dà già la differenza. Le cifre del blocco non ripeterle nel testo.
- Il testo sopra il blocco resta breve: una o due frasi e, se servono, la tabella (al massimo 10 righe).
- «elenco»: persone, aziende, ticket o progetti da aprire, con «link» solo se il risultato lo dà. Non ripeterli anche in una tabella.
- «azioni»: al massimo 3. «prepara» chiede di preparare una proposta (ticket, nota, passo, contatto) solo quando l'utente la tocca: mettici in «chiedi» la richiesta completa; «apri» solo con un link di Alma Space dai risultati.
- «domande»: sempre 2 o 3 domande successive brevi e pertinenti, scritte come le farebbe l'utente.
- Senza dati (saluti, conferme, domande di chiarimento) niente blocco.`;

module.exports = { split, clean, checkText, PROMPT, localLink };
