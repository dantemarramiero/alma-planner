// Alma HR, Fase 1 (canvas «Alma HR», 21/11/2026): logica pura del salary grade, senza database.
// - Griglia G1–G8: una fascia per grade { grade, min, mid, max } in migliaia di euro; si genera dalle leve della vista
//   d'insieme (RAL di riferimento di G1, salto G1–G4, salto G5–G8, ampiezza) e si ritocca grade per grade.
// - Posizione in fascia = RAL a tempo pieno ÷ riferimento; zone ingresso / in linea / alta; fuori fascia = anomalia;
//   lontanissimo = «ruolo forse sbagliato».
// - Controlli del pannello: max > rif > min, riferimento crescente, minimo CCNL (blocca), salto 15–25% e
//   sovrapposizione 10–40% (avvisi), vertice Field sotto il PM Senior.
// - Import: export mensile HR di BOSS (persone + RAL) e la mappatura Excel v11 (persona → inquadramento).

const GRADES = [1, 2, 3, 4, 5, 6, 7, 8];

const FAMILIES = [
  { key: 'gestione', label: 'Gestione commessa' },
  { key: 'field', label: 'Field' },
  { key: 'engineering', label: 'Engineering e gare' },
  { key: 'staff', label: 'Staff' },
  { key: 'direzione', label: 'Direzione' },
];

// La griglia scelta il 21/11 (ancorata ai riferimenti della v11: PM 40/48/56, Resp. Area 65, Resp. BU 78, C-Level 60/70/85).
const DEFAULT_BANDS = [
  { grade: 1, min: 24, mid: 26, max: 29 }, { grade: 2, min: 28, mid: 32, max: 36 },
  { grade: 3, min: 34, mid: 40, max: 45 }, { grade: 4, min: 42, mid: 48, max: 54 },
  { grade: 5, min: 49, mid: 56, max: 63 }, { grade: 6, min: 57, mid: 65, max: 73 },
  { grade: 7, min: 67, mid: 76, max: 86 }, { grade: 8, min: 78, mid: 88, max: 100 },
];
const DEFAULT_PARAMS = { g1: 26, lo: 23, hi: 16, w: 12 };

// Tutte le regole del pannello. ccnl e market: per grade, in migliaia (minimo tabellare del livello collegato e mediana
// di mercato); valori di partenza indicativi, da sostituire con quelli veri (CCNL da BOSS, mercato dalla fonte annuale).
const DEFAULT_RULES = {
  zone: { low: 90, high: 110 },
  wrongRole: { low: 75, high: 130 },
  equityAlarm: 5,
  stepRange: [15, 25],
  overlapRange: [10, 45],
  offers: { hr: 'mid', bu: 'max' },        // fino al riferimento HR, fino al massimo HR + Resp. BU, oltre la Direzione
  merit: { '9-10': [7, 5, 3], '7-8': [5, 3.5, 2], '5-6': [3, 2, 1], '3-4': [1, 0, 0], '1-2': [0, 0, 0] },
  promoPct: 8,
  budgetPct: 2.5,
  ccnl: { 1: { minimo: 22.6, link: 'Metalm. C1 · Edil. 2' }, 2: { minimo: 25.1, link: 'Metalm. C3 · Edil. 4' }, 3: { minimo: 28.4, link: 'Metalm. B1 · Edil. 5' },
    4: { minimo: 32.0, link: 'Metalm. B2 · Edil. 6' }, 5: { minimo: 36.5, link: 'Metalm. A1 · Edil. 7' }, 6: { minimo: 41.0, link: 'Quadro' },
    7: { minimo: 47.0, link: 'Quadro' }, 8: { minimo: 55.0, link: 'Dirigente' } },
  market: { 1: 26.5, 2: 31.5, 3: 38.5, 4: 47.0, 5: 55.5, 6: 66.0, 7: 79.0, 8: 92.0 },
  excluded: ['operaio', 'apprendista', 'tirocinio', 'staff_leasing', 'organo'],
  costCoeff: 1.38, // costo azienda ≈ RAL × coefficiente (contributi, TFR, INAIL): si cambia nel pannello
  // premio variabile target in % della RAL, per grade [min, max], e su cosa si misura (tavola H, punto 6)
  variabile: { 1: [0, 5], 2: [0, 5], 3: [5, 10], 4: [5, 10], 5: [10, 20], 6: [10, 20], 7: [20, 30], 8: [20, 30] },
  variabileSu: { 1: 'obiettivi personali e premio di risultato', 2: 'obiettivi personali e premio di risultato', 3: 'margine commesse, SAL nei tempi, obiettivi personali',
    4: 'margine commesse, SAL nei tempi, obiettivi personali', 5: "margine d'area, portafoglio, win ratio gare", 6: "margine d'area, portafoglio, win ratio gare", 7: 'EBITDA di BU o azienda', 8: 'EBITDA di BU o azienda' },
};

// Il catalogo di partenza: le famiglie della griglia scelta, i testi dalle «definizioni oggettive» della v11.
const A = (c1, c2, c3, c4, c5) => ({ C1: c1, C2: c2, C3: c3, C4: c4, C5: c5 });
const SEED_ROLES = [
  ['gestione', 'Assistente di commessa', 'Junior', 1, 'Supporto operativo-documentale della commessa (SAL, ordini, reportistica, interfacce) sotto la guida del PM, con supervisione. Non responsabile di margine e cliente.', A('sup', 'support', 'support', 'support', 'support'), 'Gestisce in autonomia l\'operatività documentale di una commessa fino a C3.'],
  ['gestione', 'Assistente di commessa', 'Senior', 2, 'Gestisce in autonomia l\'operatività documentale e amministrativa della commessa (fino a C3) e affianca il PM su commesse complesse. Presenza obbligatoria (1–2) sulle commesse C4–C5.', A('auto', 'auto', 'auto', 'support', 'support'), 'Chiude da solo una commessa C3 senza escalation ricorrenti (→ PM Junior).'],
  ['gestione', 'Project Manager', 'Junior', 3, 'Possiede in autonomia commesse C1–C2 e conduce C3 con supervisione. Risponde di tempi, costi e qualità della singola commessa.', A('auto', 'auto', 'sup', 'none', 'none'), 'Chiude in autonomia una commessa C3 senza escalation ricorrenti (→ Intermedio).'],
  ['gestione', 'Project Manager', 'Intermedio', 4, 'Possiede in autonomia commesse fino a C3 e conduce C4 con supervisione. Piena responsabilità di tempi, costi e qualità; gestione autonoma di cliente e varianti.', A('auto', 'auto', 'auto', 'sup', 'none'), 'Chiude in autonomia una commessa C4 (→ Senior).'],
  ['gestione', 'Project Manager', 'Senior', 5, 'Possiede in autonomia commesse C3–C4 e presidia C5 in co-gestione. Piena responsabilità di margine, tempi, cliente e varianti.', A('auto', 'auto', 'auto', 'auto', 'sup'), 'Guida un portafoglio di commesse e coordina altri PM (→ Responsabile di Area).'],
  ['gestione', 'Responsabile di Area', '', 6, 'Responsabile del portafoglio commesse di un\'area: margine d\'area, coordinamento dei PM, priorità e allocazione risorse. Valutato sul portafoglio.', A('auto', 'auto', 'auto', 'auto', 'auto'), ''],
  ['gestione', 'Responsabile di BU', '', 7, 'Responsabile economico-organizzativo della BU (budget, margine, sviluppo del perimetro); coordina responsabili d\'area e PM; impatto su fatturato ed EBITDA.', A('auto', 'auto', 'auto', 'auto', 'auto'), ''],
  ['field', 'Tecnico di cantiere', 'Junior', 2, 'Presidia in autonomia gli aspetti tecnico-esecutivi di cantiere e supporta il PM sulla realizzazione. Non responsabile di margine e cliente.', A('auto', 'auto', 'support', 'support', 'support'), 'Presidia da solo la tecnica di cantiere su una commessa C3 (→ Senior).'],
  ['field', 'Capo zona reti', '', 2, 'Coordina le attività di una zona territoriale delle reti (squadre, cantieri, rapporti con il distributore) con il supporto del responsabile d\'area.', A('auto', 'auto', 'sup', 'support', 'support'), ''],
  ['field', 'Tecnico di cantiere', 'Senior', 3, 'Riferimento sugli aspetti realizzativi; presidia in autonomia la tecnica di cantiere su commesse fino a C3–C4 e affianca il PM sulle commesse complesse.', A('auto', 'auto', 'auto', 'sup', 'support'), 'Coordina più squadre e cantieri in autonomia (→ Capo cantiere).'],
  ['field', 'Capo cantiere / Tecnico esperto', '', 4, 'Vertice del binario tecnico: guida cantieri complessi e squadre, è il riferimento tecnico della BU. Resta un grade sotto il PM Senior.', A('auto', 'auto', 'auto', 'auto', 'sup'), ''],
  ['engineering', 'Disegnatore / Assistente gare', '', 1, 'Prepara elaborati, documenti di gara e qualifiche con supervisione.', A('support', 'support', 'support', 'none', 'none'), ''],
  ['engineering', 'Progettista', 'Junior', 2, 'Sviluppa parti di progetto (MEP, BIM, processi) con supervisione.', A('sup', 'support', 'support', 'none', 'none'), ''],
  ['engineering', 'Progettista', '', 3, 'Sviluppa in autonomia progetti di media complessità.', A('auto', 'auto', 'sup', 'support', 'none'), ''],
  ['engineering', 'Progettista', 'Senior', 4, 'Guida progetti complessi e coordina altri progettisti; riferimento tecnico (BIM lead).', A('auto', 'auto', 'auto', 'sup', 'sup'), ''],
  ['engineering', 'Proposal Manager', 'Junior', 3, 'Elabora offerte per commesse C1–C3 con supervisione; imposta computi, tempi e struttura del dossier di gara.', A('auto', 'auto', 'sup', 'none', 'none'), 'Guida da solo un\'offerta C4 complessa o vincente (→ Senior).'],
  ['engineering', 'Proposal Manager', 'Senior', 5, 'Guida offerte per commesse C4–C5 e gare strategiche; definisce marginalità e strategia d\'offerta.', A('auto', 'auto', 'auto', 'auto', 'sup'), ''],
  ['engineering', 'Responsabile Ufficio Tecnico', '', 6, 'Responsabile della progettazione e dell\'ufficio tecnico gare e lavori.', A('auto', 'auto', 'auto', 'auto', 'auto'), ''],
  ['staff', 'Impiegato', 'Junior', 1, 'Profilo d\'ingresso: attività definite con supervisione.', {}, 'Lavora in autonomia sulle attività note (→ Confermato).'],
  ['staff', 'Impiegato', 'Confermato', 2, 'Impiegato specializzato, autonomo sulle attività note.', {}, ''],
  ['staff', 'Specialist di funzione', '', 3, 'Specialista (HR, IT, Procurement, Amministrazione, QHSE): presidia un ambito della funzione.', {}, ''],
  ['staff', 'Responsabile di Funzione', 'Junior', 4, 'Guida una funzione piccola o un ambito di una funzione.', {}, ''],
  ['staff', 'Responsabile di Funzione', 'Senior', 5, 'Guida una funzione di staff con persone e budget.', {}, ''],
  ['direzione', 'Direttore di funzione', '', 6, 'Direzione di una funzione corporate in avvio (C-Level Junior).', {}, ''],
  ['direzione', 'C-Level', '', 7, 'Direzione consolidata con piena responsabilità di funzione corporate.', {}, ''],
  ['direzione', 'C-Level', 'Senior', 8, 'Direzione con piena responsabilità di funzione corporate e impatto sull\'azienda.', {}, ''],
].map(([family, name, level, grade, description, autonomy, next], i) => ({ family, name, level, grade, description, autonomy, next, order: (i + 1) * 10 }));

const roleTitle = r => (r.hr_level || r.level ? `${r.hr_name || r.name} · ${r.hr_level || r.level}` : (r.hr_name || r.name));
const round1 = n => Math.round(n * 10) / 10;
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

// Le leve → la griglia (salto più ripido nei grade bassi, più dolce in quelli alti).
function generateBands({ g1, lo, hi, w } = DEFAULT_PARAMS) {
  const out = [];
  let ref = Number(g1);
  for (const g of GRADES) {
    if (g > 1) ref *= 1 + (g <= 4 ? Number(lo) : Number(hi)) / 100;
    out.push({ grade: g, min: round1(ref * (1 - w / 100)), mid: round1(ref), max: round1(ref * (1 + w / 100)) });
  }
  return out;
}

const bandOf = (bands, grade) => bands.find(b => Number(b.grade) === Number(grade)) || null;

// Controlli del pannello: errors bloccano il salvataggio, warnings si vedono e basta.
function checkBands(bands, rules = DEFAULT_RULES, roles = []) {
  const errors = [];
  const warnings = [];
  const list = GRADES.map(g => bandOf(bands, g));
  if (list.some(b => !b)) return { errors: ['La griglia deve avere tutti gli 8 grade'], warnings };
  list.forEach((b, i) => {
    const G = `G${b.grade}`;
    if (![b.min, b.mid, b.max].every(n => Number.isFinite(Number(n)) && Number(n) > 0)) errors.push(`${G}: min, riferimento e max devono essere numeri`);
    else if (!(b.max > b.mid && b.mid > b.min)) errors.push(`${G}: serve max > riferimento > min`);
    const floor = rules.ccnl?.[b.grade]?.minimo;
    if (floor && b.min < floor) errors.push(`${G}: il minimo di fascia (${b.min} k) è sotto il minimo CCNL (${floor} k, ${rules.ccnl[b.grade].link})`);
    if (i) {
      const prev = list[i - 1];
      if (b.mid <= prev.mid) errors.push(`${G}: il riferimento deve crescere rispetto a G${prev.grade}`);
      const step = (b.mid / prev.mid - 1) * 100;
      const [sLo, sHi] = rules.stepRange || [15, 25];
      if (step < sLo || step > sHi) warnings.push(`Salto G${prev.grade} → ${G} del ${Math.round(step)}%: fuori dalla regola ${sLo}–${sHi}%`);
      const ov = overlap(prev, b);
      const [oLo, oHi] = rules.overlapRange || [10, 40];
      if (ov < oLo || ov > oHi) warnings.push(`Sovrapposizione G${prev.grade}–${G} del ${Math.round(ov)}%: fuori dalla regola ${oLo}–${oHi}%`);
    }
  });
  // vertice Field sotto il PM Senior
  const fieldTop = Math.max(0, ...roles.filter(r => r.hr_family === 'field' && r.grade).map(r => r.grade));
  const pmSr = roles.find(r => r.hr_family === 'gestione' && norm(r.hr_name) === 'project manager' && norm(r.hr_level) === 'senior');
  if (fieldTop && pmSr?.grade && fieldTop >= pmSr.grade) errors.push(`Il vertice del binario Field (G${fieldTop}) deve stare sotto il PM Senior (G${pmSr.grade})`);
  return { errors, warnings };
}

// Quanto si sovrappone una fascia con quella sopra, in % della sua ampiezza.
function overlap(a, b) {
  const width = a.max - a.min;
  return width > 0 ? Math.max(0, (a.max - b.min) / width * 100) : 0;
}

const fte = (ral, pct) => (Number(pct) > 0 && Number(pct) < 100 ? Number(ral) / (Number(pct) / 100) : Number(ral));

// Posizione di una RAL (in euro) nella fascia (in migliaia).
function position(ral, partTimePct, band, rules = DEFAULT_RULES) {
  if (!band || !ral) return null;
  const k = fte(ral, partTimePct) / 1000;
  const pct = Math.round(k / band.mid * 100);
  const zone = k < band.min ? 'sotto' : k > band.max ? 'sopra' : pct < rules.zone.low ? 'ingresso' : pct > rules.zone.high ? 'alta' : 'linea';
  const wrong = pct < rules.wrongRole.low || pct > rules.wrongRole.high;
  return { ralFte: Math.round(fte(ral, partTimePct)), pct, zone, wrong, toMin: k < band.min ? Math.round((band.min - k) * 1000) : 0 };
}

// Numeri della mappatura su un elenco di persone { ral, part_time_pct, grade, sesso, esclusione }.
function stats(people, bands, rules = DEFAULT_RULES) {
  let below = 0, above = 0, wrong = 0, inBand = 0, cost = 0, counted = 0;
  const byGrade = {};
  for (const p of people) {
    if (p.esclusione || !p.grade || !p.ral) continue;
    const pos = position(p.ral, p.part_time_pct, bandOf(bands, p.grade), rules);
    if (!pos) continue;
    counted++;
    if (pos.wrong) wrong++;
    if (pos.zone === 'sotto') { below++; cost += pos.toMin; } else if (pos.zone === 'sopra') above++; else inBand++;
    const g = (byGrade[p.grade] ||= { F: [], M: [] });
    if (p.sesso === 'F' || p.sesso === 'M') g[p.sesso].push(pos.ralFte);
  }
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  const equity = GRADES.map(g => {
    const x = byGrade[g];
    if (!x || !x.F.length || !x.M.length) return { grade: g, gap: null };
    return { grade: g, gap: round1((avg(x.F) / avg(x.M) - 1) * 100), f: x.F.length, m: x.M.length };
  });
  const all = Object.values(byGrade).reduce((acc, x) => ({ F: acc.F.concat(x.F), M: acc.M.concat(x.M) }), { F: [], M: [] });
  // divario a parità di grade: media pesata dei divari dei grade con donne e uomini
  const w = equity.filter(e => e.gap !== null);
  const gap = w.length ? round1(w.reduce((s, e) => s + e.gap * (e.f + e.m), 0) / w.reduce((s, e) => s + e.f + e.m, 0)) : null;
  const ov = GRADES.slice(0, 7).map(g => overlap(bandOf(bands, g), bandOf(bands, g + 1)));
  return { counted, below, above, inBand, wrong, inPct: counted ? Math.round(inBand / counted * 100) : 0, cost, gap, equity,
    overlapAvg: Math.round(ov.reduce((s, x) => s + x, 0) / ov.length), women: all.F.length, men: all.M.length };
}

// Aumento suggerito dalla matrice di merito: voto 1–10 e zona.
function meritPct(score, zone, rules = DEFAULT_RULES) {
  const s = Number(score);
  const row = s >= 9 ? '9-10' : s >= 7 ? '7-8' : s >= 5 ? '5-6' : s >= 3 ? '3-4' : '1-2';
  const col = zone === 'sotto' || zone === 'ingresso' ? 0 : zone === 'linea' ? 1 : 2;
  return rules.merit[row][col];
}

// Promozione: il valore più alto tra il minimo del nuovo grade e la RAL attuale + promoPct.
function promotionRal(ral, newBand, rules = DEFAULT_RULES) {
  return Math.round(Math.max(newBand.min * 1000, Number(ral) * (1 + rules.promoPct / 100)));
}

// Chi approva un'offerta, in base alla fascia.
function offerApprover(ralEuro, band, rules = DEFAULT_RULES) {
  const k = ralEuro / 1000;
  if (k < band.min || k > band.max) return 'direzione';
  if (k <= band[rules.offers.hr === 'mid' ? 'mid' : 'max']) return 'hr';
  return 'bu';
}

// ── Import ──────────────────────────────────────────────────────────────────────────────────────────────────
const HEADERS = {
  boss_id: ['id', 'id boss', 'codice dipendente', 'matricola'],
  cognome: ['cognome'], nome: ['nome'], email: ['email', 'e-mail', 'mail'],
  societa: ['societa', 'denominazione', 'ditta'], bu: ['bu', 'business unit', 'settore', 'area', 'asa'],
  qualifica: ['qualifica', 'mansione', 'incarico', 'ruolo', 'ruolo (organigramma)'],
  ccnl: ['ccnl', 'codice ccnl'], livello: ['livello', 'livello ccnl'], contratto: ['contratto', 'tipo contratto'],
  part_time_pct: ['part time', 'part-time', '% part time', 'percentuale part time', 'orario %'],
  data_assunzione: ['data assunzione', 'assunzione'], scadenza: ['scadenza', 'scadenza contratto', 'data fine'],
  sesso: ['sesso', 'genere'], ral: ['ral', 'ral attuale', 'ral annua'], ad_personam: ['ad personam', 'superminimo'],
  valid_from: ['valido dal', 'decorrenza', 'dal'],
};
function headerMap(row) {
  const map = {};
  row.forEach((cell, i) => {
    const c = norm(cell);
    for (const [k, names] of Object.entries(HEADERS)) if (!(k in map) && names.includes(c)) map[k] = i;
  });
  return map;
}
// Date di Excel (numero di giorni dal 1899-12-30) o testo gg/mm/aaaa o aaaa-mm-gg.
function toDate(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0].slice(0, 10) : null;
}
const toNum = v => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[€\s]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) || 0);
const CONTRACTS = [['apprend', 'APPR'], ['tirocin', 'TIROCINIO'], ['stage', 'TIROCINIO'], ['leasing', 'STAFF_LEASING'], ['somministr', 'STAFF_LEASING'],
  ['determinato', 'TD'], ['td', 'TD'], ['indeterminato', 'TI'], ['ti', 'TI']];
const contractOf = s => { const c = norm(s); if (!c) return null; const hit = CONTRACTS.find(([k]) => c === k || c.includes(k)); return hit ? hit[1] : String(s).trim(); };
const exclusionOf = (contratto, qualifica) => {
  if (contratto === 'APPR') return 'apprendista';
  if (contratto === 'TIROCINIO') return 'tirocinio';
  if (contratto === 'STAFF_LEASING') return 'staff_leasing';
  const q = norm(qualifica);
  if (/\b(operai|muratore|manovale|ferraiolo|carpentiere|palista|gruista|saldatore|autista)\b/.test(q)) return 'operaio';
  if (/revisore|odv|organismo di vigilanza/.test(q)) return 'organo';
  return null;
};
const personKey = p => (p.boss_id ? `boss:${p.boss_id}` : p.email ? `mail:${p.email}` : `nome:${norm(p.cognome)}|${norm(p.nome)}`);

// Export mensile HR di BOSS: un foglio con una riga d'intestazione riconoscibile (Cognome, Nome, …, RAL).
function parseBossExport(sheets) {
  for (const [sheet, rows] of Object.entries(sheets)) {
    const hi = rows.findIndex(r => { const m = headerMap(r); return 'cognome' in m && 'nome' in m; });
    if (hi < 0) continue;
    const m = headerMap(rows[hi]);
    const people = [];
    const problems = [];
    rows.slice(hi + 1).forEach((r, i) => {
      const get = k => (k in m ? r[m[k]] : '');
      const cognome = String(get('cognome') || '').trim();
      const nome = String(get('nome') || '').trim();
      if (!cognome && !nome) return;
      const contratto = contractOf(get('contratto'));
      const qualifica = String(get('qualifica') || '').trim() || null;
      const p = {
        boss_id: String(get('boss_id') || '').trim() || null, cognome, nome,
        email: String(get('email') || '').trim().toLowerCase() || null,
        societa: String(get('societa') || '').trim() || null, bu: String(get('bu') || '').trim() || null, qualifica,
        ccnl: String(get('ccnl') || '').trim() || null, livello: String(get('livello') || '').trim() || null, contratto,
        part_time_pct: toNum(get('part_time_pct')) || 100, data_assunzione: toDate(get('data_assunzione')), scadenza: toDate(get('scadenza')),
        sesso: ['F', 'M'].includes(String(get('sesso')).trim().toUpperCase()) ? String(get('sesso')).trim().toUpperCase() : null,
        ral: toNum(get('ral')) || null, ad_personam: toNum(get('ad_personam')) || 0, valid_from: toDate(get('valid_from')),
      };
      p.esclusione = exclusionOf(contratto, qualifica);
      if (p.part_time_pct <= 1) p.part_time_pct = Math.round(p.part_time_pct * 100); // 0,6 → 60
      if (p.ral && p.ral < 1000) problems.push({ riga: hi + i + 2, problema: `RAL ${p.ral}: sembra in migliaia, va in euro` });
      p.key = personKey(p);
      people.push(p);
    });
    return { sheet, people, problems, columns: Object.keys(m) };
  }
  return { sheet: null, people: [], problems: [{ riga: 0, problema: 'Nessun foglio con le colonne Cognome e Nome' }], columns: [] };
}

// Mappatura v11: nei fogli «BU …» e «Staff …» righe «Persona | Ruolo (organigramma) | Inquadramento target | RAL …».
// Persona = «Cognome I.». Restituisce le righe con la traduzione dell'inquadramento nel ruolo nuovo.
const V11_MAP = [
  [/assistente di commessa.*junior/, ['gestione', 'assistente di commessa', 'junior']],
  [/assistente di commessa.*senior/, ['gestione', 'assistente di commessa', 'senior']],
  [/project manager.*junior/, ['gestione', 'project manager', 'junior']],
  [/project manager.*intermedio/, ['gestione', 'project manager', 'intermedio']],
  [/project manager.*senior/, ['gestione', 'project manager', 'senior']],
  [/responsabile di area/, ['gestione', 'responsabile di area', '']],
  [/responsabile di bu/, ['gestione', 'responsabile di bu', '']],
  [/proposal manager.*junior/, ['engineering', 'proposal manager', 'junior']],
  [/proposal manager.*senior/, ['engineering', 'proposal manager', 'senior']],
  [/tecnico di cantiere.*junior/, ['field', 'tecnico di cantiere', 'junior']],
  [/tecnico di cantiere.*senior/, ['field', 'tecnico di cantiere', 'senior']],
  [/c-level.*senior/, ['direzione', 'c-level', 'senior']],
  [/c-level.*standard/, ['direzione', 'c-level', '']],
  [/responsabile di funzione/, ['staff', 'responsabile di funzione', 'senior']],
  [/specialist di funzione/, ['staff', 'specialist di funzione', '']],
  [/specialist \/ impiegato|impiegato.*confermato/, ['staff', 'impiegato', 'confermato']],
  [/impiegato.*junior/, ['staff', 'impiegato', 'junior']],
];
// I casi che la griglia nuova inquadra diversamente (tavola H, «Primo import»): capi zona, capi funzione in C-Level Junior.
function translateV11(target, qualifica) {
  const t = norm(target);
  const q = norm(qualifica);
  if (/^area |capo zona|resp.* zona/.test(q) && /assistente di commessa/.test(t)) return { role: ['field', 'capo zona reti', ''], why: 'responsabile di zona territoriale: nella v11 era Assistente di commessa' };
  if (/c-level.*junior/.test(t)) return /cfo|direttore|direzione/.test(q)
    ? { role: ['direzione', 'direttore di funzione', ''], why: 'C-Level Junior della v11' }
    : { role: ['staff', 'responsabile di funzione', 'junior'], why: 'capo funzione: nella v11 era C-Level Junior' };
  if (/contabil|amministra/.test(q) && /assistente di commessa/.test(t)) return { role: ['staff', 'impiegato', /senior/.test(t) ? 'confermato' : 'junior'], why: 'attività amministrativa: ruolo di staff' };
  if (/progettazione|mep|bim|processi/.test(q) && /specialist|impiegato/.test(t)) return { role: ['engineering', 'progettista', ''], why: 'progettazione: famiglia Engineering' };
  if (/resp.*squadre|officin/.test(q)) return { role: ['field', 'capo cantiere / tecnico esperto', ''], why: 'responsabile di squadre: vertice Field' };
  const hit = V11_MAP.find(([re]) => re.test(t));
  return hit ? { role: hit[1], why: `inquadramento v11 «${String(target).trim()}»` } : null;
}
function parseV11(sheets) {
  const rows = [];
  for (const [sheet, data] of Object.entries(sheets)) {
    const hi = data.findIndex(r => norm(r[0]) === 'persona' && r.some(c => /inquadramento/.test(norm(c))));
    if (hi < 0) continue;
    const head = data[hi].map(norm);
    const off = head[1] === 'funzione' ? 1 : 0;
    for (const r of data.slice(hi + 1)) {
      const persona = String(r[0] || '').trim();
      if (!persona || /^giallo|^tabella|^inquadramento/i.test(persona)) break;
      const qualifica = String(r[1 + off] || '').trim();
      const target = String(r[2 + off] || '').trim();
      const tr = target ? translateV11(target, qualifica) : null;
      const [cognome, iniziale] = persona.replace(/\(.*\)/, '').trim().split(/\s+(?=[A-ZÀ-Ý][.\s]|[A-ZÀ-Ý]\.?$)/);
      rows.push({ sheet, persona, cognome: (cognome || persona).trim(), iniziale: (iniziale || '').replace(/\./g, '').trim().charAt(0), qualifica, target, proposta: tr });
    }
  }
  return rows;
}
// Abbina «Cognome I.» a una persona: stesso cognome e stessa iniziale del nome.
function matchPerson(row, people) {
  const c = norm(row.cognome);
  const hits = people.filter(p => norm(p.cognome) === c && (!row.iniziale || norm(p.nome).startsWith(norm(row.iniziale))));
  return hits.length === 1 ? hits[0] : null;
}
const findRole = (roles, [family, name, level]) => roles.find(r => r.hr_family === family && norm(r.hr_name) === name && norm(r.hr_level) === level) || null;

module.exports = {
  GRADES, FAMILIES, DEFAULT_BANDS, DEFAULT_PARAMS, DEFAULT_RULES, SEED_ROLES,
  roleTitle, generateBands, bandOf, checkBands, overlap, fte, position, stats, meritPct, promotionRal, offerApprover,
  parseBossExport, parseV11, translateV11, matchPerson, findRole, personKey, exclusionOf, contractOf, toDate, toNum, norm,
};
