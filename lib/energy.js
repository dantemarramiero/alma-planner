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
  STAGES, KINDS, COMPANY_TYPES, LINK_ROLES, RELATIONS, COMPANY_STATUS, INFLUENCE, CHANNELS, stageKeys, createEnergyAccess,
};
