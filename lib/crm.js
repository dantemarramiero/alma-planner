// CRM di Alma Planet: elenchi e accesso.
// Dal 13/11/2026 (Dante) tutti vedono tutto; le ASA di ognuno (crm_asa_members, più i membri di Alma Energy per
// l'ASA Energy) servono solo a preimpostare i filtri delle liste. La direzione gestisce ASA e caricamenti.

const ROLES = { lead: 'Lead', cliente: 'Cliente', fornitore: 'Fornitore', partner: 'Partner', concorrente: 'Concorrente' };
const KINDS = {
  impresa: 'Impresa', ente_pubblico: 'Ente pubblico', partecipata: 'Società partecipata', consorzio: 'Consorzio',
  professionista: 'Professionista', condominio: 'Condominio', altro: 'Altro',
};
const STATUS = { attivo: 'Attivo', inattivo: 'Inattivo', bloccato: 'Bloccato' };
// fila del lead; «diventa cliente» non è una fase: succede da solo alla prima commessa in BOSS
const LEAD_STAGES = [
  ['da_contattare', 'Da contattare'], ['contattato', 'Contattato'], ['incontro', 'Incontro fatto'],
  ['opportunita', 'Opportunità aperta'], ['non_interessato', 'Non interessato'],
];
const PRIORITIES = { alta: 'Alta', media: 'Media', bassa: 'Bassa' };
const ORIGINS = ['Rete commerciale', 'Segnalazione', 'Fiera o evento', 'Sito web', 'Alma.ai', 'Partner', 'Gara pubblica', 'Zoho (storico)'];
const LOST_REASONS = ['Ha già un fornitore', 'Fuori zona', 'Troppo piccolo', 'Troppo grande', 'Prezzi', 'Altro'];
const SEGMENTS = {
  pubblico: ['Comune', 'Provincia', 'Regione', 'ASL', 'Gestore servizio idrico', 'Università', 'Altro ente'],
  privato: ['Industria', 'Immobiliare', 'Retail', 'Energia', 'Condominio', 'Impresa edile', 'Altro privato'],
};
const SUPPLIER_CATEGORIES = {
  materiali: 'Materie prime e materiali', subappalti: 'Subappaltatori', noli: 'Noli', servizi_cantiere: 'Servizi di cantiere',
  professionisti: 'Professionisti', mezzi: 'Mezzi e attrezzature', servizi_generali: 'Servizi generali',
};
// ── elenchi da cui scegliere (Dante 13/11: «ovunque abbia senso una picklist») ──
// Categorie SOA (DPR 207/2010, allegato A) e classifiche con l'importo fino a cui valgono.
const SOA_CATEGORIES = [
  ['OG1', 'Edifici civili e industriali'], ['OG2', 'Restauro e manutenzione dei beni immobili sottoposti a tutela'],
  ['OG3', 'Strade, autostrade, ponti, viadotti, ferrovie, metropolitane'], ['OG4', 'Opere d\'arte nel sottosuolo'], ['OG5', 'Dighe'],
  ['OG6', 'Acquedotti, gasdotti, oleodotti, opere di irrigazione e di evacuazione'], ['OG7', 'Opere marittime e lavori di dragaggio'],
  ['OG8', 'Opere fluviali, di difesa, di sistemazione idraulica e di bonifica'], ['OG9', 'Impianti per la produzione di energia elettrica'],
  ['OG10', 'Impianti per la trasformazione alta/media tensione e distribuzione di energia elettrica'], ['OG11', 'Impianti tecnologici'],
  ['OG12', 'Opere ed impianti di bonifica e protezione ambientale'], ['OG13', 'Opere di ingegneria naturalistica'],
  ['OS1', 'Lavori in terra'], ['OS2-A', 'Superfici decorate e beni culturali mobili di interesse storico, artistico, archeologico'],
  ['OS2-B', 'Beni culturali mobili di interesse archivistico e librario'], ['OS3', 'Impianti idrico-sanitario, cucine, lavanderie'],
  ['OS4', 'Impianti elettromeccanici trasportatori'], ['OS5', 'Impianti pneumatici e antintrusione'],
  ['OS6', 'Finiture di opere generali in materiali lignei, plastici, metallici e vetrosi'], ['OS7', 'Finiture di opere generali di natura edile e tecnica'],
  ['OS8', 'Opere di impermeabilizzazione'], ['OS9', 'Impianti per la segnaletica luminosa e la sicurezza del traffico'],
  ['OS10', 'Segnaletica stradale non luminosa'], ['OS11', 'Apparecchiature strutturali speciali'], ['OS12-A', 'Barriere stradali di sicurezza'],
  ['OS12-B', 'Barriere paramassi, fermaneve e simili'], ['OS13', 'Strutture prefabbricate in cemento armato'],
  ['OS14', 'Impianti di smaltimento e recupero rifiuti'], ['OS15', 'Pulizia di acque marine, lacustri, fluviali'],
  ['OS16', 'Impianti per centrali di produzione di energia elettrica'], ['OS17', 'Linee telefoniche ed impianti di telefonia'],
  ['OS18-A', 'Componenti strutturali in acciaio'], ['OS18-B', 'Componenti per facciate continue'],
  ['OS19', 'Impianti di reti di telecomunicazione e di trasmissione dati'], ['OS20-A', 'Rilevamenti topografici'], ['OS20-B', 'Indagini geognostiche'],
  ['OS21', 'Opere strutturali speciali'], ['OS22', 'Impianti di potabilizzazione e depurazione'], ['OS23', 'Demolizione di opere'],
  ['OS24', 'Verde e arredo urbano'], ['OS25', 'Scavi archeologici'], ['OS26', 'Pavimentazioni e sovrastrutture speciali'],
  ['OS27', 'Impianti per la trazione elettrica'], ['OS28', 'Impianti termici e di condizionamento'], ['OS29', 'Armamento ferroviario'],
  ['OS30', 'Impianti interni elettrici, telefonici, radiotelefonici e televisivi'], ['OS31', 'Impianti per la mobilità sospesa'],
  ['OS32', 'Strutture in legno'], ['OS33', 'Coperture speciali'], ['OS34', 'Sistemi antirumore per infrastrutture di mobilità'],
  ['OS35', 'Interventi a basso impatto ambientale'],
];
const SOA_CLASSES = [
  ['I', 'fino a 258.000 €'], ['II', 'fino a 516.000 €'], ['III', 'fino a 1.033.000 €'], ['III-bis', 'fino a 1.500.000 €'],
  ['IV', 'fino a 2.582.000 €'], ['IV-bis', 'fino a 3.500.000 €'], ['V', 'fino a 5.165.000 €'], ['VI', 'fino a 10.329.000 €'],
  ['VII', 'fino a 15.494.000 €'], ['VIII', 'oltre 15.494.000 €'],
];
const LEGAL_FORMS = ['S.r.l.', 'S.r.l.s.', 'S.p.A.', 'S.a.p.A.', 'S.n.c.', 'S.a.s.', 'S.s.', 'Ditta individuale', 'Società cooperativa', 'Consorzio',
  'Consorzio stabile', 'Rete d\'imprese', 'Associazione', 'Fondazione', 'Ente pubblico', 'Società in house', 'Studio associato', 'Libero professionista', 'Società estera'];
const TITLES = ['Ing.', 'Arch.', 'Geom.', 'Dott.', 'Dott.ssa', 'Avv.', 'Per. Ind.', 'Rag.', 'Prof.', 'Sig.', 'Sig.ra'];
const CONTACT_JOBS = ['Titolare', 'Amministratore delegato', 'Direttore generale', 'Direttore tecnico', 'Responsabile commerciale', 'Ufficio acquisti',
  'Ufficio gare', 'Amministrazione', 'Ufficio tecnico', 'Responsabile sicurezza (RSPP)', 'Capo cantiere', 'Progettista',
  'RUP', 'Direttore dei lavori', 'Coordinatore sicurezza (CSE/CSP)', 'Collaudatore', 'Ufficio contratti', 'Segreteria', 'Energy manager', 'Facility manager'];
const LANGUAGES = ['Italiano', 'Inglese', 'Francese', 'Tedesco', 'Spagnolo', 'Altra'];
// sottocategorie dei fornitori (si potranno allungare in Impostazioni)
const SUPPLIER_SUBCATEGORIES = {
  materiali: ['Calcestruzzo', 'Inerti', 'Acciaio e ferro lavorato', 'Bitumi', 'Laterizi', 'Tubazioni', 'Materiale elettrico', 'Materiale idraulico', 'Legname', 'Isolanti e impermeabilizzanti'],
  subappalti: ['Scavi e movimento terra', 'Opere in cemento armato', 'Impianti elettrici', 'Impianti meccanici', 'Facciate e serramenti', 'Pavimentazioni', 'Demolizioni', 'Carpenteria metallica', 'Finiture edili'],
  noli: ['Nolo a freddo', 'Nolo a caldo', 'Gru e autogru', 'Piattaforme aeree', 'Escavatori', 'Ponteggi'],
  servizi_cantiere: ['Trasporti', 'Rifiuti e terre da scavo', 'Laboratori prove', 'Rilievi', 'Vigilanza', 'Bagni chimici', 'Ponteggi'],
  professionisti: ['Progettista', 'Geologo', 'Coordinatore sicurezza', 'Collaudatore', 'Consulente tecnico', 'Consulente legale'],
  mezzi: ['Acquisto', 'Leasing', 'Officina e manutenzione', 'Pneumatici'],
  servizi_generali: ['Assicurazioni', 'Carburante', 'Utenze', 'Pulizie', 'Consulenze', 'Telefonia'],
};
const NOTE_KINDS = { nota: 'Nota', telefonata: 'Telefonata', riunione: 'Riunione', decisione: 'Decisione' };
const CONTACT_STATUS = { attivo: 'Attivo', non_raggiungibile: 'Non più raggiungibile' };
const LEGAL_BASIS = { contratto: 'Contratto', legittimo_interesse: 'Legittimo interesse', consenso: 'Consenso' };

// P.IVA italiana: 11 cifre con la cifra di controllo. Quelle estere (con le lettere del paese) passano come sono.
function vatOk(vat) {
  if (!/^\d+$/.test(vat)) return /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(vat);
  if (vat.length !== 11) return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    let d = Number(vat[i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
// Codice fiscale: 16 caratteri (persona) o 11 cifre (società).
const taxCodeOk = cf => /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(cf) || (/^\d{11}$/.test(cf) && vatOk(cf));

function createCrmAccess({ db, isAdmin }) {
  // ASA a cui è assegnato chi chiede (anche per la direzione: servono per i filtri preimpostati)
  async function asasOf(req) {
    if (!req.user) return [];
    const email = String(req.user.email || '').toLowerCase();
    const { rows } = await db.query(
      `SELECT a.key FROM crm_asa a
        WHERE EXISTS (SELECT 1 FROM crm_asa_members m WHERE m.asa_key = a.key AND m.email = $1)
           OR (a.key = 'energy' AND EXISTS (SELECT 1 FROM energy_members em WHERE em.email = $1))
        ORDER BY a.sort, a.label`, [email]);
    return rows.map(r => r.key);
  }
  // req.crm = { admin, asas } per le route
  async function load(req) {
    if (!req.crm) req.crm = { admin: Boolean(isAdmin(req)), asas: await asasOf(req) };
    return req.crm;
  }
  const canUse = async req => { await load(req); return Boolean(req.user); };
  return { asasOf, load, canUse };
}

module.exports = {
  ROLES, KINDS, STATUS, LEAD_STAGES, PRIORITIES, ORIGINS, LOST_REASONS, SEGMENTS, SUPPLIER_CATEGORIES, NOTE_KINDS,
  SOA_CATEGORIES, SOA_CLASSES, LEGAL_FORMS, TITLES, CONTACT_JOBS, LANGUAGES, SUPPLIER_SUBCATEGORIES, CONTACT_STATUS, LEGAL_BASIS, vatOk, taxCodeOk, createCrmAccess,
};
