// Alma HR, Fase 4: onboarding (ALM2-54). Logica pura: modelli, composizione del piano, formazione, fine prova.
// Decisioni di Dante 22/11: piano di 90 giorni + decisione di fine prova; formazione in Alma; buddy per tutti;
// fine prova responsabile + HR, Direzione da G6.

const addDays = (iso, n) => { const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + Number(n)); return d.toISOString().slice(0, 10); };
const addMonths = (iso, n) => { const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + Number(n)); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${String(b).slice(0, 10)}T12:00:00Z`) - Date.parse(`${String(a).slice(0, 10)}T12:00:00Z`)) / 86400000);

const CHI = { nuovo: 'nuovo assunto', responsabile: 'responsabile', buddy: 'buddy', hr: 'HR', it: 'IT', qhse: 'QHSE', magazzino: 'magazzino', mezzi: 'mezzi' };
const TAPPE = [30, 60, 90];
const PIANO_GIORNI = 90;
const PROVA_MESI = 6; // impiegati; se l'offerta dice altro vince l'offerta, se BOSS ha la data vince BOSS

// Modelli di partenza (tavola AF): il team HR li cambia in Alma, ogni salvataggio è una versione nuova.
const DEFAULT_TEMPLATES = [
  { chiave: 'base', nome: 'Base · tutti', items: [
    [0, 'Accoglienza, giro della sede e presentazione alla squadra', 'responsabile'],
    [0, 'PC, account Microsoft, BOSS e Alma Space attivi', 'it'],
    [1, 'Buddy presentato: primo caffè insieme', 'buddy'],
    [2, 'Giro degli uffici: amministrazione, acquisti, HR, QHSE', 'hr'],
    [5, 'Badge, accessi e parcheggio', 'hr'],
    [20, 'Primo bilancio con HR: come sta andando?', 'hr'],
  ] },
  { chiave: 'fam:gestione', nome: 'Gestione commessa', items: [
    [1, 'Presentazione delle commesse in corso dell\'area', 'responsabile'],
    [5, 'Accesso a BOSS commesse: SAL, varianti, subappalti', 'it'],
    [10, 'Affiancamento su una commessa al livello del ruolo', 'buddy'],
    [45, 'Prima commessa gestita con supervisione', 'nuovo'],
  ] },
  { chiave: 'fam:field', nome: 'Field · cantiere', items: [
    [1, 'Giro dei cantieri della zona con il responsabile', 'responsabile'],
    [3, 'Procedure di sicurezza del cantiere e piano di emergenza', 'qhse'],
    [7, 'Affiancamento in cantiere', 'buddy'],
    [40, 'Prima attività in cantiere con supervisione', 'nuovo'],
  ] },
  { chiave: 'fam:engineering', nome: 'Engineering e gare', items: [
    [1, 'Presentazione delle gare e dei progetti in corso', 'responsabile'],
    [5, 'Accesso agli strumenti di progetto e all\'archivio gare', 'it'],
    [10, 'Affiancamento su un\'offerta o un progetto', 'buddy'],
    [45, 'Primo elaborato consegnato con revisione', 'nuovo'],
  ] },
  { chiave: 'fam:staff', nome: 'Staff · funzioni', items: [
    [1, 'Presentazione dei processi della funzione', 'responsabile'],
    [5, 'Accessi ai gestionali della funzione', 'it'],
    [10, 'Affiancamento sulle attività ricorrenti', 'buddy'],
  ] },
  { chiave: 'fam:direzione', nome: 'Direzione', items: [
    [1, 'Presentazione della strategia e dell\'Hoshin dell\'anno', 'responsabile'],
  ] },
  { chiave: 'sede:cantiere', nome: 'Sede: cantiere', items: [
    [0, 'Consegna dei DPI nelle taglie indicate (firmata)', 'magazzino'],
    [0, 'Auto aziendale, se prevista', 'mezzi'],
    [2, 'Idoneità sanitaria alla mansione verificata', 'hr'],
  ] },
  { chiave: 'resp', nome: 'Responsabili (G6 e oltre)', items: [
    [3, 'Incontri con i responsabili delle BU e delle funzioni', 'responsabile'],
    [10, 'Deleghe, firme e poteri di spesa', 'hr'],
    [20, 'Budget e obiettivi dell\'area', 'responsabile'],
  ] },
].map(t => ({ ...t, items: t.items.map(([giorno, titolo, chi]) => ({ giorno, titolo, chi })) }));

// Catalogo di partenza (tavola AC). validita in mesi (null = non scade); blocca = senza, niente cantiere da soli.
const DEFAULT_COURSES = [
  { k: 'gen', nome: 'Formazione generale lavoratori', ore: 4, validita_mesi: null, blocca_cantiere: true, giorno: 5 },
  { k: 'alto', nome: 'Formazione specifica rischio alto', ore: 12, validita_mesi: 60, blocca_cantiere: true, giorno: 14 },
  { k: 'basso', nome: 'Formazione specifica rischio basso', ore: 4, validita_mesi: 60, blocca_cantiere: false, giorno: 14 },
  { k: 'pes', nome: 'PES/PAV (CEI 11-27)', ore: 16, validita_mesi: 60, blocca_cantiere: true, giorno: 45 },
  { k: 'preposto', nome: 'Preposto', ore: 12, validita_mesi: 24, blocca_cantiere: false, giorno: 45 },
  { k: 'quota', nome: 'Lavori in quota e DPI anticaduta', ore: 8, validita_mesi: 60, blocca_cantiere: true, giorno: 30 },
  { k: 'ps', nome: 'Primo soccorso', ore: 12, validita_mesi: 36, blocca_cantiere: false, giorno: 60 },
];
// Corsi di partenza per ruolo, dalla famiglia del mansionario (HR li cambia ruolo per ruolo)
function defaultCoursesFor(role) {
  const fam = role?.hr_family;
  const name = `${role?.hr_name || ''}`.toLowerCase();
  const g = Number(role?.grade) || 0;
  if (fam === 'field') return ['gen', 'alto', 'pes', 'quota', 'ps', ...(name.includes('capo') ? ['preposto'] : [])];
  if (fam === 'gestione') return ['gen', 'alto', 'pes', ...(g >= 3 ? ['preposto'] : [])];
  return ['gen', 'basso'];
}

// Sede di partenza: field = cantiere, il resto ufficio (HR la cambia all'avvio)
const sedeFor = role => (role?.hr_family === 'field' || role?.hr_family === 'gestione' ? 'cantiere' : 'ufficio');
// Modelli che compongono il piano di un ruolo
function templateKeys(role, sede) {
  const keys = ['base'];
  if (role?.hr_family) keys.push(`fam:${role.hr_family}`);
  if (sede === 'cantiere') keys.push('sede:cantiere');
  if (Number(role?.grade) >= 6) keys.push('resp');
  return keys;
}

// Obiettivi di inserimento dalla scheda del ruolo (autonomia per complessità di commessa)
function goalsFor(role) {
  const out = [];
  const aut = role?.autonomy || {};
  const sup = ['C1', 'C2', 'C3', 'C4', 'C5'].filter(c => aut[c] === 'sup');
  const auto = ['C1', 'C2', 'C3', 'C4', 'C5'].filter(c => aut[c] === 'auto');
  if (sup.length) out.push(`Gestire una commessa ${sup[0]} con supervisione`);
  else if (auto.length) out.push(`Gestire in autonomia una commessa ${auto[auto.length - 1]}`);
  else if (role?.description) out.push(String(role.description).split(/[;.]/)[0].trim());
  out.push('Conoscere procedure e strumenti (BOSS, Alma Space) del ruolo');
  return out;
}

// Il piano: modelli + corsi del ruolo + documenti da leggere + obiettivi + incontri 30/60/90 + fine prova
function composePlan({ templates, courses = [], docs = [], fineProvaGiorno = null }) {
  const out = [];
  for (const t of templates) for (const it of t.items || []) out.push({ giorno: Number(it.giorno) || 0, titolo: it.titolo, chi: it.chi || 'hr', tipo: 'compito', ref: null });
  for (const c of courses) out.push({ giorno: c.giorno ?? 30, titolo: `${c.nome}${c.ore ? ` (${Number(c.ore)} h)` : ''}`, chi: 'qhse', tipo: 'corso', ref: String(c.id) });
  if (docs.length) out.push({ giorno: 5, titolo: `Presa visione: ${docs.map(d => d.titolo).join(', ')}`, chi: 'nuovo', tipo: 'documento', ref: null });
  out.push({ giorno: 14, titolo: 'Obiettivi di inserimento scritti con il responsabile', chi: 'responsabile', tipo: 'obiettivi', ref: null });
  for (const t of TAPPE) out.push({ giorno: t, titolo: `Incontro dei ${t} giorni`, chi: 'responsabile', tipo: 'incontro', ref: String(t) });
  if (fineProvaGiorno != null) out.push({ giorno: Math.max(91, fineProvaGiorno - 30), titolo: 'Decisione di fine prova', chi: 'responsabile', tipo: 'prova', ref: null });
  return out.sort((a, b) => a.giorno - b.giorno || ['compito', 'documento', 'corso', 'obiettivi', 'incontro', 'prova'].indexOf(a.tipo) - ['compito', 'documento', 'corso', 'obiettivi', 'incontro', 'prova'].indexOf(b.tipo))
    .map((t, i) => ({ ...t, ordine: i + 1 }));
}

const phaseOf = giorno => (giorno <= 0 ? 'Giorno 1' : giorno < 30 ? 'Settimana 1–4' : giorno < 60 ? 'Mese 2' : 'Mese 3 · fine prova');
const PHASES = ['Giorno 1', 'Settimana 1–4', 'Mese 2', 'Mese 3 · fine prova'];

// Stato di un corso per una persona: ok (con scadenza), scade (entro 60 gg), scaduto, manca
function certStatus(cert, course, today) {
  if (!cert) return { stato: 'manca' };
  const scade = cert.scade ? String(cert.scade).slice(0, 10) : null;
  if (!scade) return { stato: 'ok', scade: null, data: String(cert.data).slice(0, 10) };
  if (scade < today) return { stato: 'scaduto', scade };
  if (daysBetween(today, scade) <= 60) return { stato: 'scade', scade };
  return { stato: 'ok', scade };
}
const expiryOf = (dataIso, course) => (course?.validita_mesi ? addMonths(dataIso, course.validita_mesi) : null);
// Può lavorare da solo in cantiere: tutti i corsi che bloccano del suo ruolo validi
function siteStatus(statuses) {
  const bad = statuses.filter(s => s.course.blocca_cantiere && ['manca', 'scaduto'].includes(s.stato));
  return { ok: !bad.length, mancano: bad.map(s => s.course.nome) };
}

const fineProva = (inizio, mesi = PROVA_MESI) => addMonths(inizio, mesi);
// Chi decide la fine prova (decisione D): responsabile + HR; Direzione da G6
const probationChain = grade => ['responsabile', 'hr', ...(Number(grade) >= 6 ? ['direzione'] : [])];
// Avvisi di fine prova: 30 giorni al responsabile, 10 a HR, 1 a HR e Direzione
function probationAlerts(fine, today) {
  const d = daysBetween(today, fine);
  return [30, 10, 1].filter(x => d <= x).map(x => ({ soglia: x, a: x === 30 ? ['responsabile'] : x === 10 ? ['hr'] : ['hr', 'direzione'] }));
}

// Segnali per HR (tavola AD): pulse sotto 3 o voto sotto 6
function flags({ pulse, meeting }) {
  const out = [];
  if (pulse) for (const [k, l] of [['q1', 'strumenti'], ['q2', 'aspettative'], ['q3', 'accoglienza']]) if (pulse[k] < 3) out.push(`pulse basso su ${l} (${pulse[k]})`);
  if (meeting) for (const [k, l] of [['voto_obiettivi', 'obiettivi'], ['voto_squadra', 'squadra']]) if (meeting[k] != null && meeting[k] < 6) out.push(`voto ${l} ${meeting[k]}`);
  return out;
}
const pulseAvg = p => (p ? Math.round((p.q1 + p.q2 + p.q3) / 3 * 10) / 10 : null);

module.exports = {
  CHI, TAPPE, PIANO_GIORNI, PROVA_MESI, DEFAULT_TEMPLATES, DEFAULT_COURSES, PHASES,
  addDays, addMonths, daysBetween, defaultCoursesFor, sedeFor, templateKeys, goalsFor, composePlan, phaseOf,
  certStatus, expiryOf, siteStatus, fineProva, probationChain, probationAlerts, flags, pulseAvg,
};
