// Dalla email alla pipeline di Alma Energy (ALM2-78, tavola «Dalla email»): cosa propone Alma leggendo la conversazione.
// Nome, tipo di opportunità, MW e luogo. Prima regole semplici (servono senza chiave e nei test), poi Alma se c'è la chiave;
// quello che Alma non trova resta dalle regole. Non si inventa niente: un dato che manca resta vuoto.
const { askJson } = require('./crm-posta');
const S = require('./crm-scrivo');
const { KINDS } = require('./energy');
const { PROVINCES } = require('./energy-places');

const textOf = messages => messages.map(m => `${m.subject}\n${S.ownPart(m.body || m.preview || '')}`).join('\n\n');

// «1,8 MWp», «980 kW», «3.400 kWp» → MW
function mwOf(text) {
  const m = String(text).match(/(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(MWp|MW|kWp|kW)\b/i);
  if (!m) return null;
  let raw = m[1].replace(/\s/g, '');
  raw = /,\d+$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : /\.\d{3}$/.test(raw) && /^kw/i.test(m[2]) ? raw.replace(/\./g, '') : raw.replace(',', '.');
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mw = /^kw/i.test(m[2]) ? n / 1000 : n;
  return Math.round(mw * 1000) / 1000;
}

// Tipo: revamping se si parla di cessione/impianto esistente/convenzione GSE, PPA se di autoconsumo/offtaker, altrimenti FV.
function kindOf(text) {
  const t = String(text).toLowerCase();
  if (/revamping|repowering|in esercizio|conto energia|convenzione gse|cession|vend[eoi]|impianto esistente|acquisizione/.test(t)) return 'revamping';
  if (/\bppa\b|autoconsumo|on-?site|tetto|capannone|copertura|energivor/.test(t)) return 'ppa_onsite';
  if (/fotovoltaic|agrivoltaic|terreno|autorizza|\bpas\b|\bpaur\b|stmg|connessione/.test(t)) return 'fv_classico';
  return '';
}

// Comune e provincia: «a Lanciano (CH)», «Atessa (Chieti)»
function placeOf(text) {
  const m = String(text).match(/\b(?:a|di|in|presso)\s+([A-ZÀ-Ý][a-zà-ÿ']+(?:\s+[A-ZÀ-Ý][a-zà-ÿ']+){0,2})\s*\(([A-Z]{2}|[A-ZÀ-Ý][a-zà-ÿ]+)\)/);
  if (!m) return { city: '', province: '', region: '' };
  const p = PROVINCES.get(m[2].toUpperCase()) || [...PROVINCES.values()].find(x => String(x.name).toLowerCase() === m[2].toLowerCase());
  return { city: m[1], province: p ? p.name : m[2], region: p ? p.region : '' };
}

function heuristic(messages) {
  const text = textOf(messages);
  const subject = String(messages[0]?.subject || '').replace(/^\s*((r|i)[ei]?|fw|fwd|inoltro)\s*:\s*/gi, '').trim();
  return { title: subject.slice(0, 200), kind: kindOf(text), mw: mwOf(text), ...placeOf(text), azienda: '' };
}

async function extractEnergy(messages, ctx = {}) {
  const base = heuristic(messages);
  const conv = messages.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(m => `--- da ${m.from.name || ''} <${m.from.address}>\nOggetto: ${m.subject}\n${S.ownPart(m.body || m.preview || '').slice(0, 3000)}`).join('\n\n').slice(-12000);
  const ai = await askJson({
    key: ctx.key, fetchImpl: ctx.fetchImpl, maxTokens: 500,
    system: [
      'Sei l\'analista della BU Energy di Almacis (investimenti in impianti fotovoltaici). Leggi una conversazione email e',
      'rispondi SOLO con un oggetto JSON con queste chiavi: title (nome breve dell\'opportunità, es. «Impianto FV 1,8 MWp a terra, Lanciano»),',
      `kind (una di: ${Object.entries(KINDS).map(([k, l]) => `${k} = ${l}`).join('; ')}; revamping anche per impianti esistenti in vendita),`,
      'mw (potenza in MW come numero, o null), city (comune), province (provincia per esteso), region, azienda (nome dell\'azienda di chi propone, se scritto).',
      'Non inventare: se un dato non c\'è, stringa vuota o null.',
    ].join(' '),
    input: conv,
  }).catch(err => { console.warn('[posta energy] lettura AI non riuscita:', err.message); return null; });
  if (!ai) return { fields: base, eur: 0, ai: false };
  const d = ai.data || {};
  const s = (k, max) => (typeof d[k] === 'string' && d[k].trim() ? d[k].trim().slice(0, max) : base[k]);
  const mw = Number(d.mw);
  return {
    fields: {
      title: s('title', 200), kind: KINDS[d.kind] ? d.kind : base.kind, mw: Number.isFinite(mw) && mw > 0 ? mw : base.mw,
      city: s('city', 100), province: s('province', 60), region: s('region', 60), azienda: s('azienda', 200) || '',
    },
    eur: ai.eur, ai: true,
  };
}

module.exports = { extractEnergy, heuristic, mwOf, kindOf, placeOf };
