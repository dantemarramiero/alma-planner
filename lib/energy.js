// Alma Energy: chi entra nel modulo, stadi delle pipeline, tipi di azienda e ruoli nelle opportunità.
// Lo stesso elenco serve al server (validazione) e alla pagina (etichette), che lo riceve da GET /api/energy.

// Stadi delle tre pipeline commerciali (ALM2-10, ALM2-13, ALM2-14). «target» = diventata Impianto target, «perso» = chiusa.
const STAGES = {
  ppa_onsite: [
    ['da_qualificare', 'Da qualificare'], ['primo_contatto', 'Primo contatto'], ['sopralluogo', 'Incontro / sopralluogo'],
    ['analisi_consumi', 'Analisi consumi'], ['proposta', 'Proposta PPA'], ['negoziazione', 'Negoziazione'],
    ['firmato', 'PPA firmato'], ['target', 'Impianto target'], ['perso', 'Perso'],
  ],
  revamping: [
    ['da_analizzare', 'Da analizzare'], ['proprietario', 'Proprietario individuato'], ['contatto', 'Contatto'],
    ['nda', 'NDA / data room'], ['due_diligence', 'Due diligence tecnica'], ['offerta', 'Offerta'],
    ['loi', 'LOI / negoziazione'], ['target', 'Impianto target'], ['perso', 'Perso'],
  ],
  fv_classico: [
    ['proposta', 'Proposta ricevuta'], ['screening', 'Screening'], ['terreno', 'Terreno contrattualizzato'],
    ['connessione', 'Connessione (STMG)'], ['progettazione', 'Progettazione'], ['istanza', 'Istanza depositata'],
    ['istruttoria', 'Istruttoria / CdS'], ['autorizzato', 'Autorizzato'], ['rtb', 'RTB'],
    ['target', 'Impianto target'], ['perso', 'Perso'],
  ],
};
const KINDS = { ppa_onsite: 'PPA on-site', revamping: 'Revamping / Repowering', fv_classico: 'FV classico' };

// Iter commerciale degli Impianti target (ALM2-17, step confermati da Dante il 30/10), uguale per i tre tipi.
// Ogni step ha la sua checklist (la due diligence in due parti) e una durata indicativa in giorni lavorativi per il Gantt.
const TARGET_STEPS = [
  { key: 'contatto_venditore', label: 'Contatto del venditore', days: 10, checklist: [
    ['primo_contatto', 'Primo contatto con il venditore'], ['interesse', 'Interesse a vendere confermato'], ['nda', 'NDA firmato'], ['data_room', 'Data room richiesta']] },
  { key: 'due_diligence', label: 'Due diligence tecnica e legale', days: 20, checklist: [
    ['t_producibilita', 'Tecnica: producibilità e storico'], ['t_componenti', 'Tecnica: moduli, inverter e strutture'], ['t_connessione', 'Tecnica: connessione'],
    ['t_om', 'Tecnica: O&M e monitoraggio'], ['t_gse', 'Tecnica: incassi GSE e cause della sottoperformance (revamping)'],
    ['l_titolo', 'Legale: titolo autorizzativo'], ['l_superficie', 'Legale: diritti sul terreno o sul tetto'], ['l_convenzione', 'Legale: convenzione GSE e regolarità'],
    ['l_contratti', 'Legale: contratti (O&M, PPA, finanziamenti)'], ['l_contenziosi', 'Legale: contenziosi'], ['l_spv', 'Legale: situazione della società (SPV)']] },
  { key: 'approvazione', label: 'Approvazione dell\'investimento', days: 5, checklist: [
    ['scenario', 'Scenario del simulatore confermato con i dati della due diligence'], ['approvato', 'Approvazione interna (Dante e Tullio)']] },
  { key: 'offerta', label: 'Offerta', days: 10, checklist: [
    ['condizioni', 'Importo, condizioni e scadenza definiti'], ['inviata', 'Offerta inviata'], ['risposta', 'Risposta del venditore']] },
];
const TARGET_OUTCOMES = { acquisito: 'Acquisito', perso: 'Perso / rinunciato' };

// Probabilità di chiudere (in %) per stadio e per step dei target, per il valore pesato del cruscotto (ALM2-18).
// Valori proposti, da tarare con Dante; la probabilità scritta sull'opportunità prevale.
const STAGE_PROBABILITY = {
  ppa_onsite: { da_qualificare: 5, primo_contatto: 10, sopralluogo: 20, analisi_consumi: 30, proposta: 45, negoziazione: 65, firmato: 90 },
  revamping: { da_analizzare: 5, proprietario: 10, contatto: 15, nda: 25, due_diligence: 40, offerta: 55, loi: 75 },
  fv_classico: { proposta: 5, screening: 10, terreno: 20, connessione: 30, progettazione: 40, istanza: 50, istruttoria: 60, autorizzato: 80, rtb: 90 },
  target: { contatto_venditore: 50, due_diligence: 65, approvazione: 80, offerta: 90, acquisito: 100, perso: 0 },
};
// voci della checklist che non valgono per un tipo (il PPA e il FV classico non hanno incassi GSE da analizzare)
const checklistFor = (step, kind) => step.checklist.filter(([k]) => !(k === 't_gse' && kind !== 'revamping'));

// Tipi di azienda del CRM e i campi in più di ciascun tipo (ALM2-2). type: number | text | date | bool | choice
const COMPANY_TYPES = {
  cliente: {
    label: 'Cliente / offtaker', short: 'Clienti',
    fields: [
      ['consumi_mwh', 'Consumi annui (MWh)', 'number'], ['profilo_consumo', 'Profilo di consumo', 'choice', ['D1', 'D2', 'D3', 'D4', 'ND']],
      ['pod', 'Numero di POD', 'number'], ['fornitore_energia', 'Fornitore di energia', 'text'],
      ['prezzo_energia', 'Prezzo attuale (€/MWh)', 'number'], ['scadenza_fornitura', 'Scadenza del contratto di fornitura', 'date'],
      ['superficie_tetti', 'Superficie dei tetti (m²)', 'number'], ['tetto', 'Tetto', 'choice', ['proprietà', 'affitto']],
      ['rating', 'Merito di credito / rating', 'text'], ['esg', 'Interesse ESG', 'bool'],
    ],
  },
  proprietario: {
    label: 'Proprietario impianto (SPV)', short: 'Proprietari',
    fields: [
      ['convenzioni', 'Convenzioni GSE', 'number'], ['mw_posseduti', 'MW posseduti', 'number'],
      ['incassi_gse', 'Incassi GSE annui (€)', 'number'], ['disponibile_vendere', 'Disponibile a vendere', 'choice', ['sì', 'no', 'da capire']],
      ['ultimo_cambio_proprieta', 'Ultimo cambio di proprietà (anno)', 'number'],
    ],
  },
  sviluppatore: {
    label: 'Sviluppatore', short: 'Sviluppatori',
    fields: [
      ['mw_sviluppo', 'MW in sviluppo', 'number'], ['regioni', 'Regioni', 'text'], ['mw_autorizzati', 'MW autorizzati (track record)', 'number'],
      ['modello', 'Modello', 'choice', ['vende RTB', 'co-sviluppo', 'entrambi']],
    ],
  },
  progettista: {
    label: 'Progettista', short: 'Progettisti',
    fields: [['specializzazioni', 'Specializzazioni (FV a terra, tetti, agrivoltaico, connessioni, VIA)', 'text'], ['regioni', 'Regioni', 'text'], ['albo', 'Iscrizione all\'albo', 'text']],
  },
  epc: {
    label: 'EPC / installatore', short: 'EPC',
    fields: [['mw_realizzati', 'MW realizzati', 'number'], ['regioni', 'Regioni', 'text'], ['prezzo_kwp', 'Prezzo indicativo (€/kWp)', 'number'], ['certificazioni', 'Certificazioni', 'text']],
  },
  om: {
    label: 'O&M', short: 'O&M',
    fields: [['mw_gestione', 'MW in gestione', 'number'], ['servizi', 'Servizi (monitoraggio, manutenzione, vigilanza)', 'text']],
  },
  investitore: {
    label: 'Investitore / fondo', short: 'Investitori',
    fields: [['ticket_min', 'Ticket minimo (€)', 'number'], ['ticket_max', 'Ticket massimo (€)', 'number'], ['strategia', 'Strategia (RTB, operativi, revamping)', 'text'], ['regioni', 'Regioni', 'text']],
  },
  banca: {
    label: 'Banca', short: 'Banche',
    fields: [['prodotti', 'Prodotti (project finance, leasing)', 'text'], ['leva_tipica', 'Leva tipica (%)', 'number']],
  },
  consulente: {
    label: 'Consulente / advisor', short: 'Consulenti',
    fields: [['ambito', 'Ambito', 'choice', ['legale', 'tecnico', 'fiscale', 'M&A', 'altro']]],
  },
};

// Ruolo di un'azienda o di una persona in un'opportunità (ALM2-4).
const LINK_ROLES = {
  proprietario: 'Proprietario', cliente: 'Cliente / offtaker', referente: 'Referente', progettista: 'Progettista incaricato',
  sviluppatore: 'Sviluppatore', epc: 'EPC', advisor: 'Advisor', banca: 'Banca', venditore: 'Venditore', altro: 'Altro',
};

const RELATIONS = { da_contattare: 'Da contattare', in_contatto: 'In contatto', attivo: 'Attivo', non_interessato: 'Non interessato' };
const COMPANY_STATUS = { attiva: 'Attiva', in_liquidazione: 'In liquidazione', cessata: 'Cessata' };
const INFLUENCE = { decisore: 'Decisore', influenzatore: 'Influenzatore', tecnico: 'Tecnico', operativo: 'Operativo' };
const CHANNELS = { email: 'Email', telefono: 'Telefono', cellulare: 'Cellulare', linkedin: 'LinkedIn', di_persona: 'Di persona' };

const stageKeys = kind => (STAGES[kind] || []).map(([k]) => k);

// Chi entra in Alma Energy: le email in energy_members. Finché l'elenco è vuoto entrano gli amministratori,
// così il primo membro si può sempre aggiungere.
function createEnergyAccess({ db, isAdmin }) {
  async function canUse(req) {
    if (!req.user) return false;
    const { rows: [r] } = await db.query(
      'SELECT EXISTS (SELECT 1 FROM energy_members WHERE email = lower($1)) AS member, NOT EXISTS (SELECT 1 FROM energy_members) AS empty',
      [req.user.email || '']);
    return r.member || (r.empty && Boolean(isAdmin?.(req)));
  }
  return { canUse };
}

module.exports = {
  TARGET_STEPS, TARGET_OUTCOMES, checklistFor, STAGE_PROBABILITY, STAGES, KINDS, COMPANY_TYPES, LINK_ROLES, RELATIONS, COMPANY_STATUS, INFLUENCE, CHANNELS, stageKeys, createEnergyAccess,
};
