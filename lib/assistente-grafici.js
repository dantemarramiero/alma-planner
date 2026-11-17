// Grafici di Alma (17/11/2026, canvas «v5 · Alma, l'assistente»: barre / linea / tabella, «Aggiungi alla dashboard»,
// Excel; porting dell'idea di Bacco CAN-194). Il grafico lo costruisce il SERVER dal risultato di una ricerca fatta
// nella stessa risposta: il modello sceglie solo quale elenco, quali campi e che tipo, mai i numeri.
//   - TOOL «grafico» (offerto ad Alma): { fonte_id, elenco, etichetta, valori[], nomi[], tipo, titolo, unita }
//   - build(out, spec) → blocco { titolo, tipo, etichette, serie: [{ nome, valori }], unita, troncato }
//   - tipoDaTesto(text) → «fallo a barre», «a linee», «in tabella», «a torta» (senza chiamare il modello)
// La dashboard (#/alma/dashboard) salva la ricerca (strumento + input) e la spec: si ricostruisce con i dati di oggi.
const TIPI = ['barre', 'linee', 'tabella', 'torta'];
const UNITA = ['', '€', '%', 'ore', 'n'];
const MAX_VOCI = 40, MAX_SERIE = 4, TORTA_MAX = 6;
const MESI = /^(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)|^\d{4}-\d{2}(-\d{2})?$|^\d{2}\/\d{4}$/i;

const toNum = x => (x == null || x === '' ? null : typeof x === 'number' ? (Number.isFinite(x) ? x : null) : Number.isFinite(Number(x)) ? Number(x) : null);
function pick(obj, path) {
  let cur = obj;
  for (const k of String(path || '').split('.').filter(Boolean)) { if (cur == null || typeof cur !== 'object') return undefined; cur = cur[k]; }
  return cur;
}
// Gli elenchi di oggetti dentro un risultato (per dire ad Alma cosa può usare quando sbaglia).
function listsOf(out, prefix = '', depth = 0, acc = []) {
  if (!out || typeof out !== 'object' || depth > 2) return acc;
  for (const [k, v] of Object.entries(out)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object') acc.push(`${p} (campi: ${Object.keys(v[0]).slice(0, 8).join(', ')})`);
    else if (v && typeof v === 'object' && !Array.isArray(v)) listsOf(v, p, depth + 1, acc);
  }
  return acc;
}
function unitOf(spec, keys) {
  if (UNITA.includes(spec.unita)) return spec.unita;
  if (keys.every(k => /_eur$|importo|valore/i.test(k))) return '€';
  if (keys.every(k => /_pct$|ratio|percent/i.test(k))) return '%';
  if (keys.every(k => /^ore|_ore$/i.test(k))) return 'ore';
  return '';
}

function build(out, spec = {}) {
  const list = pick(out, spec.elenco);
  if (!Array.isArray(list) || !list.length) {
    const ok = listsOf(out);
    throw new Error(`«${spec.elenco || ''}» non è un elenco di questo risultato.${ok.length ? ` Elenchi che puoi usare: ${ok.join('; ')}.` : ' Il risultato non ha elenchi da disegnare.'}`);
  }
  const rows = list.filter(r => r && typeof r === 'object').slice(0, MAX_VOCI);
  const first = rows[0] || {};
  if (!spec.etichetta || !(spec.etichetta in first)) throw new Error(`«etichetta» deve essere un campo delle righe: ${Object.keys(first).join(', ')}.`);
  const keys = (Array.isArray(spec.valori) ? spec.valori : []).map(String).slice(0, MAX_SERIE);
  if (!keys.length) throw new Error('Serve almeno un campo numerico in «valori».');
  for (const k of keys) if (!rows.some(r => toNum(r[k]) !== null)) throw new Error(`«${k}» non è un campo numerico delle righe (campi: ${Object.keys(first).join(', ')}).`);
  const etichette = rows.map(r => String(r[spec.etichetta] ?? '—').slice(0, 60));
  const nomi = Array.isArray(spec.nomi) ? spec.nomi : [];
  const serie = keys.map((k, i) => ({ nome: String(nomi[i] || k.replace(/_(eur|pct)$/, '').replace(/_/g, ' ')).slice(0, 40), valori: rows.map(r => toNum(r[k])) }));
  let tipo = TIPI.includes(spec.tipo) ? spec.tipo : (etichette.every(l => MESI.test(l)) ? 'linee' : 'barre');
  if (tipo === 'torta' && (serie.length > 1 || etichette.length > TORTA_MAX || serie[0].valori.some(v => v != null && v < 0))) tipo = 'barre';
  return { titolo: String(spec.titolo || 'Grafico').slice(0, 120), tipo, etichette, serie, unita: unitOf(spec, keys), ...(list.length > MAX_VOCI ? { troncato: list.length } : {}) };
}

// «fallo a barre», «mettilo a linee», «in tabella», «a torta»: solo frasi brevi che chiedono quello.
function tipoDaTesto(text) {
  const t = String(text || '').toLowerCase().trim();
  if (t.length > 50) return null;
  if (/\bbarr[ea]\b|istogramm/.test(t)) return 'barre';
  if (/\blinea\b|\blinee\b|andamento/.test(t)) return 'linee';
  if (/\btabell/.test(t)) return 'tabella';
  if (/\btorta\b/.test(t)) return 'torta';
  return null;
}

const TOOL = {
  name: 'grafico',
  label: 'Preparo il grafico',
  grafico: true,
  description: 'Mostra un grafico costruito dal server con i numeri di una ricerca fatta in QUESTA risposta (tu non scrivi i numeri). Usalo quando un andamento, un confronto o una classifica si capiscono meglio a colpo d\'occhio. fonte_id: quello della ricerca; elenco: il campo del risultato che è un elenco (es. «per_bu», «chi_ci_batte»); etichetta: il campo di ogni riga che fa da nome (es. «voce», «nome»); valori: 1–4 campi numerici (es. ["vinte","totale"]); nomi: come chiamarli nella legenda; tipo: barre, linee (per i mesi), tabella o torta (una sola serie, al massimo 6 voci); titolo breve. Dopo, nel testo non ripetere tutti i numeri: commenta quello che conta.',
  input_schema: { type: 'object', additionalProperties: false, required: ['fonte_id', 'elenco', 'etichetta', 'valori', 'titolo'], properties: {
    fonte_id: { type: 'string', description: 'Il fonte_id della ricerca (f1, f2…).' },
    elenco: { type: 'string', description: 'Campo del risultato che contiene l\'elenco (anche annidato con il punto, es. «stats.per_mese»).' },
    etichetta: { type: 'string', description: 'Campo di ogni riga da usare come nome della voce.' },
    valori: { type: 'array', items: { type: 'string' }, description: '1–4 campi numerici da disegnare.' },
    nomi: { type: 'array', items: { type: 'string' }, description: 'Nomi delle serie nella legenda, nello stesso ordine.' },
    tipo: { type: 'string', enum: TIPI },
    titolo: { type: 'string' },
    unita: { type: 'string', enum: UNITA },
  } },
};

module.exports = { TOOL, TIPI, build, tipoDaTesto, listsOf };
