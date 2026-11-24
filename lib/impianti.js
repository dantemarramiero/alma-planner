// Alma Impianti (ALM2-73, canvas approvato da Dante il 24/11/2026): logica senza Express.
// - i cinque settori della BU Impianti, con le parole per riconoscerli e cosa cercare in rete per ognuno;
// - abbinamento tra il mandato di un fondo e un progetto (settore, taglia, regione);
// - email inviate senza risposta (stessa conversazione) dopo N giorni lavorativi;
// - stato del contatto con un'azienda (mai contattato → contattato → in attesa → ha risposto → incontro fatto).

const SECTORS = [
  { key: 'depurazione', label: 'Depurazione', color: '#0057B8',
    words: ['depurat', 'depurazione', 'acque reflue', 'fognatur', 'potabilizz', 'servizio idrico', 'riuso delle acque', 'trattamento acque', 'fanghi', 'os22'],
    hint: 'Depuratori civili e industriali, potabilizzazione e riuso delle acque: piani d\'investimento dei gestori idrici e degli ATO, adeguamenti chiesti da rinnovi AIA o prescrizioni sugli scarichi, opere idriche finanziate (PNRR, fondi regionali), industrie che devono rifare il trattamento delle acque.' },
  { key: 'fotovoltaico', label: 'Fotovoltaico', color: '#E0A400',
    words: ['fotovoltaic', 'agrivoltaic', 'solare', 'mwp', 'kwp', 'pannelli', 'comunità energetic', 'cer '],
    hint: 'Impianti fotovoltaici a terra, agrivoltaici e su tetto: progetti autorizzati (PAS, PAUR, VIA, autorizzazione unica) che cercano chi li costruisca (EPC), aste e contratti FER, portafogli comprati da fondi, revamping di impianti esistenti.' },
  { key: 'biometano', label: 'Biometano', color: '#2E8B57',
    words: ['biometano', 'biogas', 'digestore', 'digestione anaerobica', 'forsu', 'upgrading', 'smc/h'],
    hint: 'Impianti di biometano e biogas (agricoli, zootecnici, FORSU): progetti ammessi alle graduatorie e agli incentivi GSE che devono essere costruiti entro le scadenze, autorizzazioni PAUR, riconversioni di impianti biogas, consorzi agricoli e multiutility che investono.' },
  { key: 'edilizia', label: 'Impianti in edilizia', color: '#7A5AF8',
    words: ['polo logistico', 'capannon', 'stabiliment', 'ospedal', 'nuova sede', 'data center', 'impianti meccanici', 'impianti elettrici', 'os28', 'os30', 'os3 ', 'og11'],
    hint: 'Nuovi edifici e stabilimenti dove servono gli impianti (meccanici OS28, elettrici OS30, idrico-sanitari OS3, tecnologici OG11): appalti di edilizia aggiudicati a imprese edili che dovranno affidare gli impianti, poli logistici, data center, ospedali, nuove sedi industriali con permesso di costruire.' },
  { key: 'efficientamento', label: 'Efficientamento', color: '#FF8A26',
    words: ['efficientamento', 'efficienza energetic', 'energivor', 'cogenerazion', 'trigenerazion', 'diagnosi energetic', 'transizione 5.0', 'conto termico', 'certificati bianchi', 'pompe di calore', 'relamping'],
    hint: 'Efficientamento energetico per aziende energivore e per enti: imprese con consumi alti che investono (Transizione 5.0, certificati bianchi, Conto Termico), diagnosi energetiche, cogenerazione e trigenerazione, riqualificazione energetica di edifici pubblici, contratti con ESCo.' },
];
const SECTOR_KEYS = SECTORS.map(s => s.key);
const sectorLabel = k => SECTORS.find(s => s.key === k)?.label || '';

// settore da titolo e testo del segnale: quello con più parole trovate; '' se nessuna
function sectorOf(...texts) {
  const t = ` ${texts.filter(Boolean).join(' ').toLowerCase()} `;
  let best = '', n = 0;
  for (const s of SECTORS) {
    const hits = s.words.filter(w => t.includes(w)).length;
    if (hits > n) { best = s.key; n = hits; }
  }
  return best;
}

// impostazioni di Alma Impianti (settings «impianti.settings»): giorni di attesa, cadenze, settori cercati dal radar
const SEGMENT_FUND = 'Fondo o investitore';
const SEGMENT_ENERGIVORA = 'Azienda energivora';
const DEFAULTS = Object.freeze({
  wait_days: 5,                                               // giorni lavorativi senza risposta → «in attesa»
  cadence: { fondo: 30, progettista: 45, opportunita: 14 },   // ogni quanto sentirli (giorni)
  sectors: SECTOR_KEYS,                                       // settori che il radar cerca ogni notte
  big_amount: 2000000,                                        // «oltre 2 M€»: in cima al radar (Dante 24/11)
});
function normalizeSettings(v = {}) {
  const num = (x, d, min, max) => { const n = Number(x); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d; };
  const c = v.cadence || {};
  return {
    wait_days: num(v.wait_days, DEFAULTS.wait_days, 1, 30),
    cadence: { fondo: num(c.fondo, DEFAULTS.cadence.fondo, 7, 365), progettista: num(c.progettista, DEFAULTS.cadence.progettista, 7, 365), opportunita: num(c.opportunita, DEFAULTS.cadence.opportunita, 3, 180) },
    sectors: Array.isArray(v.sectors) ? v.sectors.filter(k => SECTOR_KEYS.includes(k)) : [...DEFAULTS.sectors],
    big_amount: num(v.big_amount, DEFAULTS.big_amount, 0, 1e10),
  };
}

// ── fondi: il mandato combacia col progetto? ─────────────────────────────────────────────────
const PHASES = [['greenfield', 'Da sviluppare'], ['autorizzato', 'Autorizzato (RTB)'], ['costruzione', 'In costruzione'], ['esercizio', 'In esercizio']];
// fase del progetto dal segnale del radar
const phaseOfSignal = g => (g.stage === 'progetto' || g.stage === 'determina' || g.to_gare ? 'autorizzato' : g.stage === 'finanziata' ? 'autorizzato' : 'greenfield');
// { ok, score 0–100, reasons[] }: settore obbligatorio (se il fondo ne ha), poi taglia, regione, fase
function fundFits(m, p) {
  if (!m) return { ok: false, score: 0, reasons: ['mandato non compilato'] };
  const reasons = [];
  let score = 0;
  if (m.techs?.length) {
    if (!p.sector || !m.techs.includes(p.sector)) return { ok: false, score: 0, reasons: ['settore diverso'] };
    score += 45; reasons.push(sectorLabel(p.sector));
  } else score += 20;
  const amt = Number(p.amount) || 0;
  const min = m.ticket_min != null ? Number(m.ticket_min) : null, max = m.ticket_max != null ? Number(m.ticket_max) : null;
  if (amt && ((min != null && amt < min * 0.5) || (max != null && amt > max * 1.5))) return { ok: false, score: 0, reasons: ['taglia fuori dal ticket'] };
  if (amt && (min == null || amt >= min) && (max == null || amt <= max)) { score += 25; reasons.push('taglia nel ticket'); } else if (!amt) score += 10; else score += 12;
  if (m.regions?.length) {
    if (p.region && !m.regions.includes(p.region)) return { ok: false, score: 0, reasons: ['regione fuori dal mandato'] };
    if (p.region) { score += 15; reasons.push(p.region); }
  } else score += 10;
  const phase = p.phase || '';
  if (m.phases?.length && phase) { if (m.phases.includes(phase)) { score += 15; reasons.push(PHASES.find(x => x[0] === phase)?.[1] || phase); } }
  else score += 8;
  return { ok: true, score: Math.min(100, score), reasons };
}

// ── giorni lavorativi (lun–ven) tra due istanti ──────────────────────────────────────────────
function businessDays(from, to) {
  const a = new Date(from), b = new Date(to);
  if (!(b > a)) return 0;
  let n = 0;
  const d = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
  const end = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
  while (d < end) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

// ── email inviate senza risposta ─────────────────────────────────────────────────────────────
// sent: messaggi della Posta inviata { id, conversationId, toRecipients, subject, sentDateTime, webLink }
// inbox: messaggi ricevuti { conversationId, from, receivedDateTime }
// Una email è «in attesa» se nella stessa conversazione non è arrivato niente da altri dopo l'invio, e se dopo di lei
// non ho già scritto di nuovo nella stessa conversazione (conta l'ultima). keep(address) dice quali destinatari contano.
function awaitingReplies(sent, inbox, { waitDays = DEFAULTS.wait_days, now = new Date(), keep = () => true, ownEmail = '', ignored = [] } = {}) {
  const own = String(ownEmail || '').toLowerCase();
  const lastIn = new Map();
  for (const m of inbox) {
    const from = String(m.from?.emailAddress?.address || '').toLowerCase();
    if (!m.conversationId || from === own) continue;
    const t = m.receivedDateTime;
    if (!lastIn.has(m.conversationId) || t > lastIn.get(m.conversationId)) lastIn.set(m.conversationId, t);
  }
  const lastOut = new Map();
  for (const m of sent) {
    if (!m.conversationId) continue;
    const cur = lastOut.get(m.conversationId);
    if (!cur || m.sentDateTime > cur.sentDateTime) lastOut.set(m.conversationId, m);
  }
  const skip = new Set(ignored);
  const out = [];
  for (const m of lastOut.values()) {
    if (skip.has(m.id) || skip.has(m.conversationId)) continue;
    const answered = lastIn.get(m.conversationId);
    if (answered && answered > m.sentDateTime) continue;
    const to = (m.toRecipients || []).map(r => ({ name: String(r?.emailAddress?.name || ''), address: String(r?.emailAddress?.address || '').toLowerCase() }))
      .filter(r => r.address && r.address !== own && keep(r.address));
    if (!to.length) continue;
    const days = businessDays(m.sentDateTime, now);
    if (days < waitDays) continue;
    out.push({ id: m.id, conversation_id: m.conversationId, subject: m.subject || '(senza oggetto)', sent_at: m.sentDateTime, days, to, web_link: m.webLink || null });
  }
  return out.sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)));
}

// ── stato del contatto con un'azienda ────────────────────────────────────────────────────────
// x: { sent, received, last_sent, last_received, meetings, awaiting } → chiave e etichetta
const STATES = [['mai', 'Mai contattato'], ['contattato', 'Contattato'], ['attesa', 'In attesa'], ['risposto', 'Ha risposto'], ['incontro', 'Incontro fatto']];
function contactState(x = {}) {
  if (x.meetings > 0) return 'incontro';
  if (x.awaiting) return 'attesa';
  if (x.received > 0 && x.sent > 0) return 'risposto';
  if (x.sent > 0) return 'contattato';
  if (x.received > 0) return 'risposto';
  return 'mai';
}

// ── progettisti: dare e avere ────────────────────────────────────────────────────────────────
// { dato, ricevuto, last_contact, cadence } → stato della relazione
function exchangeState({ dato = 0, ricevuto = 0, last_contact = null, cadence = DEFAULTS.cadence.progettista, now = new Date() } = {}) {
  if (!dato && !ricevuto && !last_contact) return 'da_conoscere';
  if (ricevuto > dato) return 'da_ricambiare';
  if (last_contact && (now - new Date(last_contact)) / 864e5 > cadence) return 'fermo';
  if (dato >= 2 && ricevuto >= 2) return 'forte';
  return 'medio';
}
const EXCHANGE_STATES = { forte: 'Rapporto forte', medio: 'Rapporto medio', da_ricambiare: 'Da ricambiare', fermo: 'Fermo', da_conoscere: 'Da conoscere' };

// ── tappa 2 (ALM2-77): opportunità col triangolo ─────────────────────────────────────────────
const IMP_STAGES = [['origination', 'Origination', 'segnale accettato'], ['fattibilita', 'Fattibilità', 'sopralluogo e numeri'], ['offerta', 'Offerta EPC', 'in BOSS'],
  ['negoziazione', 'Negoziazione', 'contratto'], ['firmato', 'Firmato', 'diventa commessa']];
const IMP_STAGE_KEYS = [...IMP_STAGES.map(s => s[0]), 'persa'];
// fase di un'opportunità: quella scritta, altrimenti dal segnale (su BOSS = offerta, «Interessa» = origination)
const stageOf = g => g.imp_stage || (g.status === 'boss' ? 'offerta' : 'origination');
// vertici che mancano: chi finanzia, chi progetta, dove si fa
function missingOf(g) {
  const out = [];
  if (!g.fund_id) out.push('fondo');
  if (!g.designer_id) out.push('progettista');
  if (!g.subject_id) out.push('sito');
  return out;
}

// ── tappa 2: energivori da file ──────────────────────────────────────────────────────────────
const H = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// colonne riconosciute dal nome dell'intestazione
const COLS = {
  name: /^(ragione sociale|denominazione|azienda|impresa|nome|societa|soggetto|denominazione sociale)/,
  vat: /(partita iva|^p iva|^piva|codice fiscale|^cf$|^p iva cf|vat)/,
  city: /^(comune|citta|localita|sede)/,
  province: /^(provincia|prov|sigla prov)/,
  region: /^regione/,
  sector: /(settore|ateco|attivita|codice ateco|divisione)/,
  consumption: /(consum|energia|gwh|mwh|kwh)/,
  roof: /(tetto|copertura|superficie|m2|mq)/,
};
const num = v => { if (v === null || v === undefined || v === '') return null; if (typeof v === 'number') return v; const s = String(v).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); const n = Number(s.replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : null; };
// rows: array di righe (array di celle) dal foglio o dal CSV → { rows: [...], columns: {campo: intestazione}, missing }
function readEnergivori(rows, { provinces = [] } = {}) {
  const head = rows.findIndex(r => (r || []).some(c => COLS.name.test(H(c))));
  if (head < 0) return { rows: [], columns: {}, missing: ['ragione sociale'] };
  const hdr = rows[head].map(H);
  const idx = {};
  for (const [k, re] of Object.entries(COLS)) { const i = hdr.findIndex(h => re.test(h)); if (i >= 0 && !Object.values(idx).includes(i)) idx[k] = i; }
  const unit = idx.consumption !== undefined ? (/kwh/.test(hdr[idx.consumption]) ? 1e-6 : /mwh/.test(hdr[idx.consumption]) ? 1e-3 : /tep/.test(hdr[idx.consumption]) ? 0.01163 : 1) : 1;
  const provByCode = new Map(), provByName = new Map();
  // provinces = REGIONS di lib/energy-places: [{ name, provinces: [{ code, name }] }]
  for (const r of provinces) for (const p of r.provinces || []) { provByCode.set(p.code, r.name); provByName.set(H(p.name), { code: p.code, region: r.name }); }
  const cell = (r, k) => (idx[k] !== undefined ? r[idx[k]] : '');
  const out = [];
  for (const r of rows.slice(head + 1)) {
    const name = String(cell(r, 'name') ?? '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    let province = String(cell(r, 'province') ?? '').trim().toUpperCase();
    let region = String(cell(r, 'region') ?? '').trim();
    if (province.length > 2) { const p = provByName.get(H(province)); province = p ? p.code : ''; }
    if (!region && province) region = provByCode.get(province) || '';
    const c = num(cell(r, 'consumption'));
    out.push({ name: name.slice(0, 300), vat: String(cell(r, 'vat') ?? '').replace(/\s|^IT/gi, '').slice(0, 20), city: String(cell(r, 'city') ?? '').trim().slice(0, 120),
      province: province.slice(0, 2), region: region.slice(0, 60), sector: String(cell(r, 'sector') ?? '').trim().slice(0, 200),
      consumption_gwh: c === null ? null : Math.round(c * unit * 1000) / 1000, roof_m2: num(cell(r, 'roof')) });
  }
  const columns = Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, rows[head][i]]));
  return { rows: out, columns, missing: [] };
}
// stime prudenti (Dante: «stima», si conferma con la diagnosi): prezzo dell'energia, risparmio con l'efficienza, FV sul tetto
const EST = { price_mwh: 150, efficiency: 0.12, kwp_per_m2: 0.15, mwh_per_kwp: 1.3 };
function estimate(e) {
  const mwh = (Number(e.consumption_gwh) || 0) * 1000;
  const kwp = e.roof_m2 ? Math.round(Number(e.roof_m2) * EST.kwp_per_m2) : 0;
  const fvMwh = Math.min(kwp * EST.mwh_per_kwp, mwh || Infinity);
  const saving = Math.round(mwh * EST.efficiency * EST.price_mwh + (Number.isFinite(fvMwh) ? fvMwh : 0) * EST.price_mwh);
  const incentives = [mwh ? 'Transizione 5.0' : '', mwh >= 10000 ? 'certificati bianchi' : '', kwp ? 'FV in autoconsumo' : ''].filter(Boolean);
  return { kwp, saving_eur: saving || null, incentives };
}
// punteggio 0–100: consumo (60) e tetto libero (40)
function energivoroScore(e) {
  const c = Math.min(1, Math.log10((Number(e.consumption_gwh) || 0) + 1) / 2);   // 99 GWh = pieno
  const t = Math.min(1, (Number(e.roof_m2) || 0) / 20000);                     // 20.000 m² = pieno
  return Math.round(c * 60 + t * 40);
}

module.exports = {
  SECTORS, SECTOR_KEYS, sectorLabel, sectorOf, DEFAULTS, normalizeSettings, SEGMENT_FUND, SEGMENT_ENERGIVORA,
  PHASES, phaseOfSignal, fundFits, businessDays, awaitingReplies, STATES, contactState, exchangeState, EXCHANGE_STATES,
  IMP_STAGES, IMP_STAGE_KEYS, stageOf, missingOf, readEnergivori, estimate, energivoroScore, EST,
};
