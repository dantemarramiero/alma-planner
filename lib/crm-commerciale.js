// Impostazioni del lavoro commerciale (Dante 14/11/2026: «tutte queste impostazioni modificabili dalle impostazioni
// dell'app»). Qui i valori di partenza, presi dal doc «Approccio commerciale Almacis»: chi li cambia da
// CRM → Impostazioni salva in crm_settings, una riga per sezione; quello che non è salvato resta com'è qui.
const { HttpError } = require('./http');

const CHANNELS = { telefonata: 'Telefonata', email: 'Email', incontro: 'Incontro', sopralluogo: 'Sopralluogo', altro: 'Altro' };

// BU che fanno il pilota del radar (14/11): Reti AP, Facility, Restauro
const PILOT = ['reti_ap', 'facility', 'restauro'];

const DEFAULTS = {
  rules: {
    meeting_note_hours: 24,      // PC-02 nota dell'incontro
    lead_qualify_hours: 48,      // PC-01 qualifica del lead
    signal_decide_days: 7,       // PC-08 decisione sui segnali
    plan_accept_hours: 48,       // PC-10 accettare il piano d'azione
    key_rhythm_days: 90,         // PC-03 ritmo dei key account
    week_ahead_days: 7,          // «La mia settimana» mostra i passi fino a 7 giorni avanti
    gonogo_threshold_eur: null,  // da decidere (Dante 14/11)
    gonogo_min_score: 60,
    gonogo_questions: [          // Dante 14/11: «teniamola ma ricordami che non ne sono convinto»
      { text: 'Il lavoro è nelle nostre SOA e classifiche?', weight: 20 },
      { text: 'La zona è servibile con le nostre squadre?', weight: 15 },
      { text: 'L\'importo regge il carico di produzione?', weight: 15 },
      { text: 'Il margine atteso è sopra il minimo?', weight: 20 },
      { text: 'Conosciamo il committente o chi decide?', weight: 15 },
      { text: 'La concorrenza è affrontabile?', weight: 15 },
    ],
    discard_reasons: ['Fuori dai nostri lavori', 'Importo troppo piccolo', 'Importo troppo grande', 'Zona non servita', 'Notizia vecchia o già nota', 'Committente non affidabile', 'Già seguito da un\'altra BU', 'Altro'],
    lost_reasons: ['Prezzo', 'Tempi', 'Requisiti SOA', 'Scelto un concorrente', 'Progetto fermo', 'Nessuna risposta', 'Altro'],
  },
  scoring: {
    weights: { fit: 35, concreteness: 25, timing: 15, relationship: 15, value: 10 },
    highlight: 70,               // ≥ 70 in evidenza
    min: 50,                     // sotto: non arriva, resta in «Sotto soglia»
  },
  radar: {
    budget_eur: 200,
    run_hour: 2,                 // di notte
    alert_admins_on_budget: true, // quota finita → avviso agli amministratori «Aumenta / Lascia così»
    gare_users: [],              // ufficio gare: vede la coda «Proposte dal radar» e carica l'export di Infordat
    bu: {
      reti_ap: { on: true, quota_eur: 30 }, facility: { on: true, quota_eur: 30 }, restauro: { on: true, quota_eur: 30 },
      edilizia: { on: false, quota_eur: 25 }, impianti: { on: false, quota_eur: 25 }, reti_mp_bp: { on: false, quota_eur: 25 },
      esco: { on: false, quota_eur: 0 }, energy: { on: false, quota_eur: 35 }, progettazione: { on: false, quota_eur: 0 }, altri_servizi: { on: false, quota_eur: 0 },
    },
  },
  sources: [
    { id: 'infordat', name: 'Infordat', what: 'Gare e avvisi già selezionati', on: true, bu: [], to_gare: true },
    { id: 'anac', name: 'ANAC (programmazione e aggiudicazioni)', what: 'Opere programmate; contratti aggiudicati con la scadenza', on: true, bu: ['edilizia', 'facility', 'reti_mp_bp', 'reti_ap'] },
    { id: 'opencup', name: 'OpenCUP, OpenCoesione, opendata PNRR', what: 'Opere finanziate con importo e stato', on: true, bu: ['edilizia', 'restauro', 'impianti', 'reti_mp_bp'] },
    { id: 'ricostruzione', name: 'Uffici ricostruzione (USRA, USRC, USR)', what: 'Contributi concessi per la ricostruzione', on: true, bu: ['restauro', 'edilizia'] },
    { id: 'reti', name: 'Snam, SGI, Terna, ARERA', what: 'Piani di investimento, ATEM, perdite idriche', on: true, bu: ['reti_ap', 'reti_mp_bp'] },
    { id: 'zes', name: 'ZES Unica, Invitalia, MIMIT', what: 'Autorizzazioni uniche, contratti di sviluppo, crediti d\'imposta', on: true, bu: ['impianti', 'edilizia', 'facility'] },
    { id: 'stampa', name: 'Stampa nazionale, locale e di settore', what: 'Investimenti privati, finanziamenti, nuovi stabilimenti, notizie sui clienti', on: true, bu: [] },
  ],
  infordat_mode: 'export',       // Dante 14/11: export di file (Infordat non dà le API)
  profiles: {
    edilizia: { manager_name: 'Antonio Erbivendolo', description: 'Nuova costruzione e ristrutturazione di edifici civili e industriali, ampliamenti di centri commerciali, efficientamento energetico di condomini, adeguamento sismico, lavori per committenti industriali.',
      works: ['Edifici industriali e logistici', 'Centri commerciali', 'Efficientamento di condomini ed edilizia pubblica', 'Adeguamento sismico'], soa: ['OG1', 'OG8', 'OG11'], amount_min: 300000, amount_max: 12000000,
      regions: [], keywords: ['polo logistico', 'nuovo stabilimento', 'ampliamento', 'permesso di costruire', 'piano attuativo', 'ATER', 'riqualificazione'], exclude: ['villetta', 'appartamento'] },
    restauro: { manager_name: 'Annalisa Antonucci', description: 'Restauro strutturale, architettonico e pittorico di beni vincolati (chiese, fortezze, teatri), miglioramento sismico, ricostruzione post-sisma.',
      works: ['Restauro di chiese e beni vincolati', 'Miglioramento sismico', 'Ricostruzione post-sisma'], soa: ['OG2', 'OS2-A', 'OG1'], amount_min: 500000, amount_max: 6000000,
      regions: [], keywords: ['restauro', 'Soprintendenza', 'bene vincolato', 'ricostruzione', 'USRA', 'USRC', '8x1000', 'Art Bonus', 'PNRR borghi'], exclude: [] },
    impianti: { manager_name: 'Simone Mancinelli', description: 'Impianti per l\'industria (camere bianche, revamping elettrico e meccanico), depurazione e riuso delle acque reflue, fotovoltaico a terra, impianti per gestori di servizi.',
      works: ['Camere bianche e impianti industriali', 'Depuratori e riuso delle acque', 'Fotovoltaico a terra (EPC)'], soa: ['OG6', 'OS22', 'OG9', 'OG11'], amount_min: 500000, amount_max: 10000000,
      regions: [], keywords: ['depuratore', 'revamping', 'Transizione 5.0', 'ZES', 'fotovoltaico a terra', 'nuovo stabilimento'], exclude: [] },
    reti_mp_bp: { manager_name: 'Tommaso Natale', description: 'Costruzione, estensione e manutenzione di reti gas di distribuzione, pronto intervento, risanamento di reti idriche e ricerca perdite.',
      works: ['Reti gas di distribuzione', 'Manutenzione e pronto intervento', 'Reti idriche e ricerca perdite'], soa: ['OG6'], amount_min: 1000000, amount_max: 20000000,
      regions: [], keywords: ['ATEM', 'rete gas', 'distribuzione gas', 'perdite idriche', 'gestore idrico', 'accordo quadro'], exclude: [] },
    reti_ap: { manager_name: 'Simone Recchia', description: 'Costruzione e rifacimento di metanodotti in alta pressione, allacci, protezione catodica. Primo obiettivo: committenti oltre a Società Gasdotti Italia.',
      works: ['Metanodotti in alta pressione', 'Allacci (anche biometano)', 'Protezione catodica'], soa: ['OG6', 'OS35'], amount_min: 2000000, amount_max: 20000000,
      regions: [], keywords: ['metanodotto', 'gasdotto', 'Snam', 'biometano', 'idrogenodotto', 'allaccio'], exclude: [] },
    facility: { manager_name: 'Gianfranco Di Nicola', description: 'Manutenzione e conduzione di impianti (riscaldamento, raffrescamento, elettrici, fotovoltaici), revamping, piccoli lavori per stabilimenti, caserme, aeroporti, centri commerciali.',
      works: ['Manutenzione impianti', 'Conduzione e revamping', 'Piccoli lavori in stabilimento'], soa: ['OG11', 'OG9'], amount_min: 50000, amount_max: 2000000,
      regions: [], keywords: ['manutenzione impianti', 'conduzione', 'global service', 'facility', 'Consip'], exclude: [] },
    esco: { manager_name: '', description: '', works: [], soa: [], amount_min: null, amount_max: null, regions: [], keywords: [], exclude: [] },
    energy: { manager_name: '', description: 'Alma Energy: fotovoltaico sui tetti, con lo screening dei tetti già in Alma Energy.', works: [], soa: [], amount_min: null, amount_max: null, regions: [], keywords: [], exclude: [] },
    progettazione: { manager_name: '', description: '', works: [], soa: [], amount_min: null, amount_max: null, regions: [], keywords: [], exclude: [] },
    altri_servizi: { manager_name: '', description: '', works: [], soa: [], amount_min: null, amount_max: null, regions: [], keywords: [], exclude: [] },
  },
  playbooks: [
    { id: 'investimento', name: 'Investimento privato (finanziamento, aumento di capitale, nuovo stabilimento)', bu: ['edilizia', 'impianti', 'facility'],
      steps: ['Contatto con chi conosciamo, oppure presentazione da progettista o partner', 'Incontro con le referenze simili', 'Proposta anche di altre BU', 'Nota dell\'incontro e verifica'], check: 'C\'è una trattativa entro 60 giorni?' },
    { id: 'permesso', name: 'Permesso di costruire o piano attuativo approvato', bu: ['edilizia'],
      steps: ['Individuare progettista e direttore lavori', 'Contatto con il committente', 'Chiedere di essere invitati alla gara privata'], check: 'Siamo nella lista degli invitati?' },
    { id: 'opera_finanziata', name: 'Opera pubblica finanziata non ancora bandita', bu: ['edilizia', 'restauro', 'impianti', 'reti_mp_bp', 'reti_ap'],
      steps: ['Contatto con RUP o ufficio tecnico per tempi e procedura', 'Segnalazione all\'ufficio gare con la data prevista', 'Eventuale proposta di progettazione'], check: 'L\'ufficio gare conosce la data prevista della gara?' },
    { id: 'scadenza', name: 'Contratto in scadenza (manutenzione, accordo quadro)', bu: ['facility', 'reti_mp_bp'],
      steps: ['Verificare gestore attuale e scadenza', 'Visita conoscitiva al committente 6 mesi prima', 'Segnalazione all\'ufficio gare'], check: 'Il committente ci conosce prima del bando?' },
    { id: 'nuovo_gestore', name: 'Nuovo gestore o cambio di proprietà', bu: ['reti_mp_bp', 'facility'],
      steps: ['Contatto con il nuovo gestore', 'Presentazione delle referenze sulla stessa rete o sullo stesso sito', 'Richiesta di qualifica come fornitore'], check: 'Siamo in albo fornitori?' },
    { id: 'cliente', name: 'Cliente attuale con notizie nuove', bu: [],
      steps: ['Telefonata del referente che lo segue già', 'Incontro con chi decide sul nuovo progetto'], check: 'C\'è un prossimo lavoro?' },
  ],
};
const SECTIONS = ['rules', 'scoring', 'radar', 'sources', 'infordat_mode', 'profiles', 'playbooks'];

// ── controlli: si salva solo quello che ha la forma giusta ────────────────────────────────────
const bad = what => { throw new HttpError(400, what); };
const int = (x, what, min, max, nullable = false) => {
  if (nullable && (x === null || x === '' || x === undefined)) return null;
  const n = Number(x);
  if (!Number.isInteger(n) || n < min || n > max) bad(`«${what}» deve essere un numero tra ${min} e ${max}`);
  return n;
};
const str = (x, what, max) => { if (x === null || x === undefined) return ''; if (typeof x !== 'string') bad(`«${what}» non è valido`); if (x.length > max) bad(`«${what}» è troppo lungo`); return x.trim(); };
const strs = (x, what, maxItems = 60, max = 200) => {
  if (x === undefined || x === null) return [];
  if (!Array.isArray(x) || x.length > maxItems) bad(`«${what}» non è valido`);
  return [...new Set(x.map(s => str(s, what, max)).filter(Boolean))];
};
const obj = (x, what) => { if (!x || typeof x !== 'object' || Array.isArray(x)) bad(`«${what}» non è valido`); return x; };
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

function clean(section, value, { asaKeys = [], userIds = [] } = {}) {
  const asaList = (x, what) => { const out = strs(x, what, 20, 40); for (const k of out) if (!asaKeys.includes(k)) bad(`BU «${k}» sconosciuta`); return out; };
  switch (section) {
    case 'rules': {
      const v = obj(value, 'Regole');
      const qs = Array.isArray(v.gonogo_questions) ? v.gonogo_questions : bad('Domande del Go/No-Go non valide');
      if (qs.length > 15) bad('Troppe domande nel Go/No-Go');
      const questions = qs.map(q => ({ text: str(q?.text, 'Domanda', 200), weight: int(q?.weight, 'Peso', 0, 100) })).filter(q => q.text);
      const total = questions.reduce((s, q) => s + q.weight, 0);
      if (questions.length && total !== 100) bad(`I pesi del Go/No-Go devono fare 100 (ora fanno ${total})`);
      return {
        meeting_note_hours: int(v.meeting_note_hours, 'Nota dell\'incontro (ore)', 1, 720),
        lead_qualify_hours: int(v.lead_qualify_hours, 'Qualifica del lead (ore)', 1, 720),
        signal_decide_days: int(v.signal_decide_days, 'Decisione sui segnali (giorni)', 1, 90),
        plan_accept_hours: int(v.plan_accept_hours, 'Accettare il piano (ore)', 1, 720),
        key_rhythm_days: int(v.key_rhythm_days, 'Ritmo dei key account (giorni)', 7, 730),
        week_ahead_days: int(v.week_ahead_days, 'Giorni avanti in La mia settimana', 1, 60),
        gonogo_threshold_eur: int(v.gonogo_threshold_eur, 'Soglia Go/No-Go (€)', 0, 1e10, true),
        gonogo_min_score: int(v.gonogo_min_score, 'Punteggio minimo del Go', 0, 100),
        gonogo_questions: questions,
        discard_reasons: strs(v.discard_reasons, 'Motivi di scarto', 30, 120),
        lost_reasons: strs(v.lost_reasons, 'Motivi di perdita', 30, 120),
      };
    }
    case 'scoring': {
      const v = obj(value, 'Punteggio');
      const w = obj(v.weights, 'Pesi');
      const weights = Object.fromEntries(Object.keys(DEFAULTS.scoring.weights).map(k => [k, int(w[k], 'Peso', 0, 100)]));
      const total = Object.values(weights).reduce((s, n) => s + n, 0);
      if (total !== 100) bad(`I pesi del punteggio devono fare 100 (ora fanno ${total})`);
      const min = int(v.min, 'Punteggio minimo', 0, 100);
      const highlight = int(v.highlight, 'Soglia «in evidenza»', 0, 100);
      if (highlight < min) bad('La soglia «in evidenza» non può essere sotto il punteggio minimo');
      return { weights, min, highlight };
    }
    case 'radar': {
      const v = obj(value, 'Radar');
      const bu = obj(v.bu || {}, 'BU del radar');
      const out = {};
      for (const k of Object.keys(bu)) {
        if (!asaKeys.includes(k)) bad(`BU «${k}» sconosciuta`);
        out[k] = { on: Boolean(bu[k]?.on), quota_eur: int(bu[k]?.quota_eur ?? 0, 'Quota (€)', 0, 10000) };
      }
      const budget = int(v.budget_eur, 'Budget mensile (€)', 0, 10000);
      const quotas = Object.values(out).reduce((s, b) => s + b.quota_eur, 0);
      if (quotas > budget) bad(`Le quote delle BU (${quotas} €) superano il budget mensile (${budget} €)`);
      const gare = Array.isArray(v.gare_users) ? [...new Set(v.gare_users.map(x => int(x, 'Ufficio gare', 1, 1e9)))] : [];
      for (const id of gare) if (!userIds.includes(id)) bad('Persona dell\'ufficio gare non trovata');
      return { budget_eur: budget, run_hour: int(v.run_hour, 'Ora di lavoro', 0, 23), alert_admins_on_budget: v.alert_admins_on_budget !== false, gare_users: gare, bu: out };
    }
    case 'sources': {
      if (!Array.isArray(value) || value.length > 40) bad('Fonti non valide');
      const seen = new Set();
      return value.map(s => {
        const name = str(s?.name, 'Nome della fonte', 120);
        if (!name) bad('Ogni fonte ha bisogno di un nome');
        let id = slug(s?.id || name) || 'fonte';
        while (seen.has(id)) id += '_2';
        seen.add(id);
        return { id, name, what: str(s?.what, 'Cosa porta', 300), on: Boolean(s?.on), bu: asaList(s?.bu, 'BU della fonte'), to_gare: Boolean(s?.to_gare) };
      });
    }
    case 'infordat_mode': {
      if (!['email', 'export', 'api'].includes(value)) bad('Modo di lettura di Infordat non valido');
      return value;
    }
    case 'profiles': {
      const v = obj(value, 'Profili BU');
      const out = {};
      for (const [k, p] of Object.entries(v)) {
        if (!asaKeys.includes(k)) bad(`BU «${k}» sconosciuta`);
        obj(p, 'Profilo');
        const managerId = p.manager_id === null || p.manager_id === '' || p.manager_id === undefined ? null : int(p.manager_id, 'Responsabile', 1, 1e9);
        if (managerId && !userIds.includes(managerId)) bad('Responsabile non trovato tra le persone di Alma Planet');
        const min = int(p.amount_min, 'Importo minimo', 0, 1e10, true);
        const max = int(p.amount_max, 'Importo massimo', 0, 1e10, true);
        if (min !== null && max !== null && min > max) bad('L\'importo minimo è più alto del massimo');
        out[k] = { manager_id: managerId, manager_name: str(p.manager_name, 'Responsabile', 120), description: str(p.description, 'Descrizione', 2000),
          works: strs(p.works, 'Lavori tipici', 30, 200), soa: strs(p.soa, 'SOA', 50, 10), amount_min: min, amount_max: max,
          regions: strs(p.regions, 'Regioni', 25, 60), keywords: strs(p.keywords, 'Parole chiave', 80, 80), exclude: strs(p.exclude, 'Parole da escludere', 80, 80) };
      }
      return out;
    }
    case 'playbooks': {
      if (!Array.isArray(value) || value.length > 40) bad('Playbook non validi');
      const seen = new Set();
      return value.map(p => {
        const name = str(p?.name, 'Tipo di segnale', 200);
        if (!name) bad('Ogni playbook ha bisogno di un nome');
        const steps = strs(p?.steps, 'Passi', 12, 300);
        if (!steps.length) bad(`Il playbook «${name}» non ha passi`);
        let id = slug(p?.id || name) || 'playbook';
        while (seen.has(id)) id += '_2';
        seen.add(id);
        return { id, name, bu: asaList(p?.bu, 'BU del playbook'), steps, check: str(p?.check, 'Domanda di verifica', 300) };
      });
    }
    default: bad('Sezione delle impostazioni sconosciuta');
  }
  return null;
}

// impostazioni in uso = valori di partenza + quello che è stato salvato (radar e profili: BU per BU)
async function loadSettings(db) {
  const { rows } = await db.query('SELECT key, value, updated_at, updated_by FROM crm_settings');
  const saved = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const out = structuredClone(DEFAULTS);
  for (const k of SECTIONS) {
    if (!(k in saved)) continue;
    if (k === 'radar') out.radar = { ...out.radar, ...saved.radar, bu: { ...out.radar.bu, ...saved.radar.bu } };
    else if (k === 'profiles') out.profiles = { ...out.profiles, ...saved.profiles };
    else out[k] = saved[k];
  }
  out.saved = Object.fromEntries(rows.map(r => [r.key, { at: r.updated_at, by: r.updated_by }]));
  return out;
}

// «Cognome Nome» di Microsoft o «Nome Cognome»: stesse parole in qualunque ordine
const personKey = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/).filter(Boolean).sort().join(' ');

// responsabile di una BU: quello scelto, oppure la persona con lo stesso nome del valore di partenza
function managerOf(profile, users) {
  if (profile?.manager_id) return users.find(u => u.id === profile.manager_id) || null;
  const key = personKey(profile?.manager_name);
  return key ? users.find(u => personKey(u.name) === key) || null : null;
}

module.exports = { DEFAULTS, SECTIONS, CHANNELS, PILOT, clean, loadSettings, personKey, managerOf };
