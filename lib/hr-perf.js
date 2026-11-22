// Alma HR, Fase 5: performance annuale e revisione retributiva (ALM2-59). Logica pura.
// Decisioni di Dante 22/11: check solo a luglio; voto finale obiettivi/competenze con i pesi del pannello per grade
// (60/40, dal G6 70/30); aumenti dal responsabile nel budget dell'area; voti 1–5 di prima convertiti ×2.
const H = require('./hr');
const { zip } = require('./hr-rec');

const SCALA = [[9, 'eccezionale: oltre il ruolo', 'z-ok'], [7, 'sopra le attese', 'z-ok'], [5, 'in linea con il ruolo', ''], [3, 'da migliorare, con un piano', 'z-warn'], [1, 'insufficiente', 'z-bad']];
const BUCKETS = ['1–2', '3–4', '5–6', '7–8', '9–10'];
const VALORI = 'Valori Almacis e lavoro in squadra';
const round1 = x => Math.round(Number(x) * 10) / 10;

// voto 1–10 su una scala vecchia 1–5: ×2 (decisione D)
const toTen = (x, scale = 10) => (x == null || x === '' ? null : Number(scale) === 5 ? Number(x) * 2 : Number(x));
const labelOf = score => (score == null ? null : (SCALA.find(([min]) => Number(score) >= min) || SCALA[SCALA.length - 1]));
const bucketOf = score => Math.min(4, Math.max(0, Math.floor((Number(score) - 1) / 2))); // 1–2 · 3–4 · 5–6 · 7–8 · 9–10

// voto proposto di un obiettivo dal raggiungimento: 0% → 1, 100% → 8, 110% e oltre → 10
function objScoreFromAchievement(a) {
  if (a == null || a === '') return null;
  const x = Number(a);
  if (x >= 110) return 10;
  if (x >= 100) return Math.round(8 + (x - 100) / 5);
  return Math.max(1, Math.round(1 + 7 * Math.max(0, x) / 100));
}

// pesi del voto per grade (pannello): [obiettivi, competenze]
function weightsFor(grade, rules = H.DEFAULT_RULES) {
  const p = rules.pesi || H.DEFAULT_RULES.pesi;
  const o = Number(p[grade] ?? p[String(grade)] ?? (Number(grade) >= 6 ? 70 : 60));
  return [o, 100 - o];
}

// competenze del ruolo (mansionario, al massimo 4) + valori e squadra per tutti
function competencesFor(role) {
  const fromRole = [...(role?.hard_skills || []), ...(role?.responsibilities || [])].map(x => String(x).trim()).filter(Boolean);
  if (!fromRole.length && role?.description) fromRole.push(...String(role.description).split(/[;.]/).map(x => x.trim()).filter(x => x.length > 8).map(x => x[0].toUpperCase() + x.slice(1)));
  return [...new Set(fromRole)].slice(0, 4).concat(VALORI);
}

// voto finale: media pesata degli obiettivi (pesi degli obiettivi, normalizzati) e media delle competenze
function finalScore({ objectives = [], comps = [], grade, rules }) {
  const objs = objectives.filter(o => o.score != null);
  const wSum = objs.reduce((s, o) => s + (Number(o.weight) || 0), 0);
  const obj = objs.length ? (wSum ? objs.reduce((s, o) => s + Number(o.score) * (Number(o.weight) || 0), 0) / wSum : objs.reduce((s, o) => s + Number(o.score), 0) / objs.length) : null;
  const cs = comps.filter(x => x != null).map(Number);
  const comp = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : null;
  const [wo, wc] = weightsFor(grade, rules);
  let final = null;
  if (obj != null && comp != null) final = (obj * wo + comp * wc) / 100;
  else if (obj != null) final = obj;
  else if (comp != null) final = comp;
  return { obj: obj == null ? null : round1(obj), comp: comp == null ? null : round1(comp), final: final == null ? null : round1(final), pesi: [wo, wc] };
}

// distribuzione dei voti e scarto di ogni valutatore dalla media dell'azienda (calibrazione)
function distribution(scores) {
  const out = [0, 0, 0, 0, 0];
  for (const s of scores) if (s != null) out[bucketOf(s)]++;
  return BUCKETS.map((l, i) => ({ label: l, n: out[i] }));
}
function managerBias(rows) {
  const all = rows.filter(r => r.voto != null);
  const avg = all.length ? all.reduce((s, r) => s + Number(r.voto), 0) / all.length : null;
  const by = new Map();
  for (const r of all) { const k = r.manager || '—'; (by.get(k) || by.set(k, []).get(k)).push(Number(r.voto)); }
  return { media: avg == null ? null : round1(avg), valutatori: [...by.entries()].map(([nome, v]) => ({ nome, persone: v.length, media: round1(v.reduce((a, b) => a + b, 0) / v.length), scarto: avg == null ? 0 : round1(v.reduce((a, b) => a + b, 0) / v.length - avg) })).sort((a, b) => Math.abs(b.scarto) - Math.abs(a.scarto)) };
}

// proposta di una persona: al minimo di fascia, poi merito dalla matrice; o promozione al grade dopo
function proposal({ ral, partTimePct, band, voto, rules = H.DEFAULT_RULES, newBand = null, grade = null }) {
  const pos = band ? H.position(ral, partTimePct, band, rules) : null;
  const zona = pos?.zone || null;
  const pt = Number(partTimePct) > 0 && Number(partTimePct) < 100 ? Number(partTimePct) / 100 : 1;
  const alMinimo = pos?.toMin ? Math.round(pos.toMin * pt) : 0; // a tempo pieno → riportato al part-time
  const merito = voto == null ? 0 : H.meritPct(voto, zona === 'sopra' ? 'alta' : zona === 'sotto' ? 'ingresso' : zona, rules);
  const base = Number(ral) + alMinimo;
  if (newBand) {
    const nuova = Math.round(H.promotionRal(base / pt, newBand, rules) * pt);
    return { zona, merito_pct: merito, al_minimo: alMinimo, tipo: 'promozione', proposta_pct: round1((nuova / Number(ral) - 1) * 100), nuova_ral: roundTo(nuova, 10), una_tantum: 0 };
  }
  // sopra il massimo: niente aumento della RAL, una tantum della stessa entità
  if (zona === 'sopra') return { zona, merito_pct: merito, al_minimo: 0, tipo: merito ? 'una_tantum' : 'nessuno', proposta_pct: 0, nuova_ral: Number(ral), una_tantum: roundTo(Number(ral) * merito / 100, 50) };
  const nuova = roundTo(base * (1 + merito / 100), 10);
  return { zona, merito_pct: merito, al_minimo: alMinimo, tipo: merito || alMinimo ? 'merito' : 'nessuno', proposta_pct: merito, nuova_ral: nuova, una_tantum: 0 };
}
const roundTo = (x, n) => Math.round(Number(x) / n) * n;
// nuova RAL da una percentuale scritta dal responsabile (sopra l'eventuale portata al minimo)
const ralFromPct = (ral, alMinimo, pct) => roundTo((Number(ral) + Number(alMinimo || 0)) * (1 + Number(pct) / 100), 10);

// controlli di una riga della revisione
function checks({ row, band, grade, rules = H.DEFAULT_RULES, peers = [], sesso = null, crescita = false }) {
  const out = [];
  const pt = Number(row.part_time_pct) > 0 && Number(row.part_time_pct) < 100 ? Number(row.part_time_pct) / 100 : 1;
  const k = Number(row.nuova_ral) / pt / 1000;
  const ccnl = rules.ccnl?.[grade]?.minimo;
  if (ccnl && k < ccnl) out.push({ livello: 'bad', testo: `sotto il minimo CCNL (${ccnl} k€)` });
  if (band && row.tipo !== 'una_tantum' && k > band.max) out.push({ livello: 'warn', testo: 'sopra il massimo di fascia: una tantum?' });
  if (row.tipo === 'promozione' && !crescita) out.push({ livello: 'warn', testo: 'promozione senza il criterio «come si cresce» segnato nella scheda' });
  if (row.tipo !== 'promozione' && row.tipo !== 'una_tantum' && Math.abs(Number(row.proposta_pct) - Number(row.merito_pct)) > 1 && !row.motivo) out.push({ livello: 'warn', testo: 'oltre ±1 punto dalla matrice: serve il motivo' });
  if (sesso && peers.length) {
    const other = peers.filter(p => p.sesso && p.sesso !== sesso).map(p => Number(p.ral_fte));
    if (other.length) {
      const avg = other.reduce((a, b) => a + b, 0) / other.length;
      const gap = Math.round((Number(row.nuova_ral) / pt / avg - 1) * 100);
      if (Math.abs(gap) > (rules.equityAlarm || 5)) out.push({ livello: gap < 0 ? 'bad' : 'warn', testo: `equità: ${gap > 0 ? '+' : ''}${gap}% sui pari ruolo ${sesso === 'F' ? 'uomini' : 'donne'}` });
    }
  }
  return out;
}

// budget di un'area: % del monte RAL (pannello); speso = aumenti + portate al minimo + una tantum
function budget(rows, rules = H.DEFAULT_RULES) {
  const monte = rows.reduce((s, r) => s + Number(r.ral || 0), 0);
  const tetto = monte * (Number(rules.budgetPct) || 0) / 100;
  const speso = rows.reduce((s, r) => s + Math.max(0, Number(r.nuova_ral) - Number(r.ral)) + Number(r.una_tantum || 0), 0);
  return { monte, tetto: Math.round(tetto), speso: Math.round(speso), budget_pct: Number(rules.budgetPct) || 0, speso_pct: monte ? round1(speso / monte * 100) : 0, sopra: speso > tetto + 1 };
}

// calendario di partenza del ciclo dell'anno Y (valutazione a cavallo dell'anno, aumenti dal 1° aprile Y+1)
function defaultCycle(year) {
  const y = Number(year);
  return {
    fasi: {
      obiettivi: { apre: `${y}-01-07`, chiude: `${y}-02-15` }, semestre: { apre: `${y}-07-01`, chiude: `${y}-07-31` },
      valutazione: { apre: `${y}-12-01`, chiude: `${y + 1}-01-31` }, calibrazione: { apre: `${y + 1}-02-01`, chiude: `${y + 1}-02-28` },
      revisione: { apre: `${y + 1}-03-01`, chiude: `${y + 1}-03-31` },
    },
    decorrenza: `${y + 1}-04-01`,
  };
}
const FASI = [['obiettivi', 'Obiettivi'], ['semestre', 'Check di luglio'], ['valutazione', 'Valutazione'], ['calibrazione', 'Calibrazione'], ['revisione', 'Revisione retributiva']];
const faseAperta = (cycle, today) => (FASI.find(([k]) => cycle.fasi?.[k] && cycle.fasi[k].apre <= today && today <= cycle.fasi[k].chiude) || [null])[0];

// lettere di esito in un unico .docx, una per pagina
const xmlEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const eur = n => `${Math.round(Number(n)).toLocaleString('it-IT')} €`;
const itDate = iso => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : '');
function lettersDocx(letters, { oggi, firmatario = 'Ufficio Risorse Umane' }) {
  const p = (t, bold) => `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p>`;
  const brk = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const one = l => {
    const lab = labelOf(l.voto);
    const esito = l.tipo === 'promozione' ? `Con decorrenza ${itDate(l.decorrenza)} il tuo ruolo diventa ${l.nuovo_ruolo} e la tua retribuzione annua lorda passa a ${eur(l.nuova_ral)}.`
      : l.tipo === 'una_tantum' ? `La tua retribuzione resta ${eur(l.ral)}; ti riconosciamo un importo una tantum di ${eur(l.una_tantum)}, con la retribuzione di ${itDate(l.decorrenza).slice(3)}.`
        : Number(l.nuova_ral) > Number(l.ral) ? `Con decorrenza ${itDate(l.decorrenza)} la tua retribuzione annua lorda passa a ${eur(l.nuova_ral)} (+${(Number(l.nuova_ral) / Number(l.ral) * 100 - 100).toFixed(1).replace('.', ',')}%).`
          : `La tua retribuzione resta ${eur(l.ral)}.`;
    return [p(`Chieti, ${itDate(oggi)}`), p(''), p(`Gentile ${l.nome},`), p(''),
      p(`a conclusione del ciclo di valutazione ${l.anno} il tuo voto è ${String(l.voto).replace('.', ',')} · ${lab ? lab[1] : ''}.`), p(''), p(esito),
      l.ruolo && l.tipo !== 'promozione' ? p(`Il tuo ruolo resta ${l.ruolo}.`) : '', l.crescita ? p(`Per crescere: ${l.crescita}`) : '',
      p(''), p('Un cordiale saluto,'), p(firmatario, true)].join('');
  };
  const body = letters.map(one).join(brk);
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': doc,
  });
}

module.exports = {
  SCALA, BUCKETS, VALORI, FASI, toTen, labelOf, bucketOf, objScoreFromAchievement, weightsFor, competencesFor, finalScore,
  distribution, managerBias, proposal, ralFromPct, checks, budget, defaultCycle, faseAperta, lettersDocx, round1,
};
