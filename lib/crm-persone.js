// «Persone da aggiungere» nella scheda azienda (ALM2-71, canvas CRM v18 · V18-1, via di Dante 23/11/2026):
// Alma cerca su internet chi lavora nell'azienda in ruoli utili per noi (ufficio tecnico, acquisti, direzione), dal sito
// e da LinkedIn, e, se l'azienda è una stazione appaltante, i RUP delle sue gare. ANAC non pubblica i nomi dei RUP
// (nei dati aperti c'è solo l'ufficio): Alma li cerca negli atti pubblicati, partendo dai CIG che abbiamo da ANAC.
// Ogni persona ha la sua fonte; niente entra nel CRM da solo: si sceglie «Aggiungi» o «Ignora».
const { MODEL } = require('./crm-web');

const PRICE = { in: Number(process.env.OPENAI_PRICE_IN || 0.4), out: Number(process.env.OPENAI_PRICE_OUT || 1.6), search: Number(process.env.OPENAI_PRICE_SEARCH || 0.03) };
const USD_EUR = 0.95;
const SOURCES = ['sito', 'linkedin', 'anac'];

function peoplePrompt(subject, { tenders = [], known = [] } = {}) {
  const hints = [subject.city && `comune: ${subject.city}`, subject.website && `sito: ${subject.website}`, subject.domain && `dominio email: ${subject.domain}`].filter(Boolean).join('; ');
  const gare = tenders.length
    ? `\nÈ anche una stazione appaltante. Queste sono alcune sue gare recenti (CIG e oggetto): ${tenders.map(t => `${t.cig} «${String(t.object).slice(0, 120)}»`).join('; ')}.
Cerca il RUP (responsabile unico del procedimento) di queste gare negli atti pubblicati (bandi, determine, albo pretorio, sito dell'ente): per ogni RUP trovato usa "fonte": "anac" e metti nel dettaglio il CIG e l'oggetto della gara.`
    : '';
  return `Cerca le persone che lavorano in «${subject.name}»${hints ? ` (${hints})` : ''} e che possono servire a un'impresa italiana di costruzioni e impianti:
direzione, ufficio tecnico, lavori pubblici, manutenzione, reti, acquisti e approvvigionamenti, gare e appalti.
Usa la ricerca web: il sito ufficiale (chi siamo, organigramma, contatti, amministrazione trasparente) e i profili LinkedIn pubblici.${gare}
${known.length ? `Queste persone le conosciamo già, non rimetterle: ${known.slice(0, 40).join(', ')}.\n` : ''}Rispondi solo con
{"persone": [{"nome": "Nome Cognome", "ruolo": "...", "email": "solo se pubblicata", "linkedin": "url linkedin.com/in/... se l'hai vista", "fonte": "sito" | "linkedin" | "anac", "dettaglio": "dove l'hai trovata, in poche parole", "url": "url della pagina"}]}
al massimo 12, dalle più utili. Metti solo persone con nome e cognome che hai visto davvero in una pagina, con la sua url; non inventare.
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
const norm = s => clean(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

function parsePeople(text, citations = [], { known = [] } = {}) {
  const o = firstObject(text) || {};
  const knownSet = new Set(known.map(norm));
  const seen = new Set();
  const fallback = citations[0]?.url || '';
  return (Array.isArray(o.persone) ? o.persone : []).map(p => {
    const linkedin = clean(p?.linkedin, 300).replace(/[?#].*$/, '');
    const url = /^https?:\/\//i.test(String(p?.url || '')) ? clean(p.url, 500) : (linkedin || fallback);
    let source = SOURCES.includes(p?.fonte) ? p.fonte : /linkedin\.com/i.test(url) ? 'linkedin' : 'sito';
    if (source === 'linkedin' && !linkedin && !/linkedin\.com/i.test(url)) source = 'sito';
    const email = clean(p?.email, 200).toLowerCase();
    return {
      name: clean(p?.nome, 120), job: clean(p?.ruolo, 160), email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
      linkedin: /^https:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/in\/[^/\s]+\/?$/i.test(linkedin) ? linkedin : '',
      source, detail: clean(p?.dettaglio, 300), url,
    };
  }).filter(p => p.name.split(' ').length >= 2 && p.url && !knownSet.has(norm(p.name)) && !seen.has(norm(p.name)) && seen.add(norm(p.name))).slice(0, 12);
}

async function searchPeople({ apiKey, subject, tenders = [], known = [], fetchImpl = fetch }) {
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, tools: [{ type: 'web_search_preview', search_context_size: 'medium' }], input: peoplePrompt(subject, { tenders, known }) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || 'errore'}`);
  const parts = (data.output || []).flatMap(o => o.content || []);
  const text = data.output_text || parts.map(c => c.text || '').join('\n');
  const citations = parts.flatMap(c => c.annotations || []).filter(a => a.type === 'url_citation' && a.url).map(a => ({ url: a.url, title: a.title || '' }));
  const searches = (data.output || []).filter(o => o.type === 'web_search_call').length || 1;
  const u = data.usage || {};
  const usd = ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out) / 1e6 + searches * PRICE.search;
  return { people: parsePeople(text, citations, { known }), costEur: Math.round(usd * USD_EUR * 10000) / 10000 };
}

module.exports = { peoplePrompt, parsePeople, searchPeople, norm, SOURCES };
