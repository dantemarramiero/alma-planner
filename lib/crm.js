// CRM di Alma Planet: elenchi e regole di accesso per ASA.
// La direzione (amministratori) vede tutto; chi è di un'ASA vede solo i soggetti che hanno la sua ASA, e i contatti
// collegati a quei soggetti. I membri di Alma Energy sono dell'ASA Energy anche senza essere in crm_asa_members.

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
const ACTIVITY_KINDS = { nota: 'Nota', chiamata: 'Chiamata', email: 'Email', incontro: 'Incontro' };
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
  // ASA di chi chiede: tutte per gli amministratori
  async function asasOf(req) {
    if (!req.user) return [];
    if (isAdmin(req)) return (await db.query('SELECT key FROM crm_asa ORDER BY sort, label')).rows.map(r => r.key);
    const email = String(req.user.email || '').toLowerCase();
    const { rows } = await db.query(
      `SELECT a.key FROM crm_asa a
        WHERE EXISTS (SELECT 1 FROM crm_asa_members m WHERE m.asa_key = a.key AND m.email = $1)
           OR (a.key = 'energy' AND EXISTS (SELECT 1 FROM energy_members em WHERE em.email = $1))
        ORDER BY a.sort, a.label`, [email]);
    return rows.map(r => r.key);
  }
  // req.crm = { admin, asas } per le route; chi non ha nessuna ASA e non è amministratore non entra
  async function load(req) {
    if (!req.crm) req.crm = { admin: Boolean(isAdmin(req)), asas: await asasOf(req) };
    return req.crm;
  }
  const canUse = async req => { const c = await load(req); return c.admin || c.asas.length > 0; };
  return { asasOf, load, canUse };
}

module.exports = {
  ROLES, KINDS, STATUS, LEAD_STAGES, PRIORITIES, ORIGINS, LOST_REASONS, SEGMENTS, SUPPLIER_CATEGORIES, ACTIVITY_KINDS,
  CONTACT_STATUS, LEGAL_BASIS, vatOk, taxCodeOk, createCrmAccess,
};
