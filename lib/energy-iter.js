// Alma Energy · Progetti selezionati (ALM2-74, canvas approvato da Dante il 24/11/2026).
// Un progetto selezionato sta in una pipeline a tre colonne: in valutazione → partiti (DD tecnica avviata) → scartati.
// Da «Avvia la DD tecnica» il progetto segue il suo iter: fasi con i punti da spuntare, partite dal modello del tipo
// (FV nuovo, Acquisizione, Revamping, PPA on-site) e modificabili sul singolo progetto. Il modello del tipo si cambia
// da «Parametri e modelli di iter» (tabella energy_iter_templates; senza riga vale quello scritto qui).

const PROJECT_TYPES = { fv_nuovo: 'FV nuovo', acquisizione: 'Acquisizione', revamping: 'Revamping', ppa_onsite: 'PPA on-site' };
const SELECTION = { valutazione: 'In valutazione', avviato: 'Partiti · DD tecnica avviata', scartato: 'Scartati' };

// I punti della due diligence hanno le stesse chiavi della checklist dei vecchi Impianti target (t_*, l_*, scenario,
// approvato, condizioni, inviata, risposta): così l'iter dei target già in produzione si ricostruisce con le spunte.
const DD_TECNICA = [
  ['t_producibilita', 'Producibilità e storico'], ['t_componenti', 'Moduli, inverter e strutture'], ['t_connessione', 'Connessione'],
  ['t_om', 'O&M e monitoraggio'],
];
const DD_LEGALE = [
  ['l_titolo', 'Titolo autorizzativo'], ['l_superficie', 'Diritti sul terreno o sul tetto'], ['l_convenzione', 'Convenzione GSE e regolarità'],
  ['l_contratti', 'Contratti (O&M, PPA, finanziamenti)'], ['l_contenziosi', 'Contenziosi'], ['l_spv', 'Situazione della società (SPV)'],
];
const DELIBERA = [['scenario', 'Analisi aggiornata con i dati della due diligence'], ['approvato', 'Approvazione interna (Dante e Tullio)']];
const OFFERTA = [['condizioni', 'Importo, condizioni e scadenza definiti'], ['inviata', 'Offerta inviata'], ['risposta', 'Risposta del venditore']];

const DEFAULT_TEMPLATES = {
  fv_nuovo: [
    { key: 'dd_tecnica', label: 'Due diligence tecnica', days: 20, items: [
      ['terreno', 'Terreno: titolo, superficie e vincoli'], ['t_connessione', 'Connessione: STMG e punto di consegna'],
      ['producibilita', 'Producibilità (PVGIS o misure)'], ['vincoli', 'Vincoli paesaggistici e ambientali'], ['layout', 'Layout preliminare']] },
    { key: 'autorizzazione', label: 'Autorizzazione', days: 180, items: [
      ['istanza', 'Istanza depositata (PAS, PAUR o AU)'], ['procedibilita', 'Procedibilità e pubblicazione'], ['osservazioni', 'Osservazioni chiuse'],
      ['integrazioni', 'Integrazioni consegnate'], ['cds', 'Conferenza di servizi'], ['titolo', 'Titolo autorizzativo ottenuto']] },
    { key: 'connessione', label: 'Connessione', days: 90, items: [
      ['stmg', 'STMG accettata'], ['progetto_rete', 'Progetto delle opere di rete approvato'], ['contratto_conn', 'Contratto di connessione']] },
    { key: 'rtb', label: 'Ready to build', days: 60, items: [
      ['analisi_finale', 'Analisi aggiornata e delibera di investimento'], ['finanziamento', 'Finanziamento'], ['epc', 'Contratto EPC'], ['incentivo', 'Incentivo o PPA (FER X, contratto)']] },
    { key: 'costruzione', label: 'Costruzione', days: 120, items: [
      ['cantiere', 'Avvio del cantiere'], ['montaggio', 'Montaggio di moduli e inverter'], ['collaudo', 'Collaudo'], ['allaccio', 'Allaccio alla rete']] },
    { key: 'esercizio', label: 'Esercizio', days: 10, items: [
      ['convenzione', 'Convenzione GSE o PPA attiva'], ['om', 'Contratto O&M'], ['monitoraggio', 'Monitoraggio attivo']] },
  ],
  acquisizione: [
    { key: 'dd_tecnica', label: 'Due diligence tecnica', days: 15, items: DD_TECNICA },
    { key: 'dd_legale', label: 'Due diligence legale', days: 15, items: DD_LEGALE },
    { key: 'approvazione', label: 'Delibera di investimento', days: 5, items: DELIBERA },
    { key: 'offerta', label: 'Offerta', days: 10, items: OFFERTA },
    { key: 'closing', label: 'Closing', days: 30, items: [
      ['spa', 'Contratto di compravendita firmato'], ['pagamento', 'Prezzo pagato'], ['voltura', 'Voltura GSE, autorizzazioni e contratti']] },
  ],
  revamping: [
    { key: 'dd_tecnica', label: 'Due diligence tecnica', days: 15, items: [...DD_TECNICA, ['t_gse', 'Incassi GSE e cause della sottoperformance']] },
    { key: 'dd_legale', label: 'Due diligence legale', days: 15, items: DD_LEGALE },
    { key: 'approvazione', label: 'Delibera di investimento', days: 5, items: DELIBERA },
    { key: 'offerta', label: 'Offerta e accordo', days: 20, items: OFFERTA },
    { key: 'lavori', label: 'Lavori di revamping', days: 60, items: [
      ['progetto_rev', 'Progetto del revamping'], ['comunicazione_gse', 'Comunicazione al GSE'], ['fornitori', 'Fornitori scelti'],
      ['lavori', 'Lavori eseguiti'], ['collaudo', 'Collaudo e ripartenza']] },
  ],
  ppa_onsite: [
    { key: 'dd_tecnica', label: 'Due diligence tecnica', days: 15, items: [
      ['sopralluogo', 'Sopralluogo'], ['consumi', 'Curve di consumo (12 mesi)'], ['tetto', 'Tetto: struttura, amianto, proprietà'],
      ['rating', 'Merito di credito del cliente']] },
    { key: 'proposta', label: 'Proposta PPA', days: 15, items: [
      ['analisi', 'Analisi con prezzo e durata del PPA'], ['proposta_inviata', 'Proposta inviata'], ['risposta', 'Risposta del cliente']] },
    { key: 'firma', label: 'Firma del PPA', days: 20, items: [
      ['contratto', 'Contratto PPA firmato'], ['superficie', 'Diritto di superficie sul tetto'], ['delibera', 'Delibera di investimento']] },
    { key: 'costruzione', label: 'Costruzione', days: 60, items: [
      ['pratiche', 'Pratiche (comunicazione, connessione)'], ['lavori', 'Lavori'], ['collaudo', 'Collaudo e allaccio']] },
    { key: 'esercizio', label: 'Esercizio', days: 10, items: [['fatturazione', 'Prima fattura al cliente'], ['monitoraggio', 'Monitoraggio attivo']] },
  ],
};

// Il tipo di progetto che si propone, dal tipo di opportunità.
const typeFromKind = kind => (kind === 'revamping' ? 'revamping' : kind === 'ppa_onsite' ? 'ppa_onsite' : 'fv_nuovo');

// Un modello come arriva dalla pagina di Parametri: fasi con nome, giorni e punti. Errore in italiano se non va.
function cleanTemplate(phases) {
  if (!Array.isArray(phases) || !phases.length || phases.length > 20) throw new Error('Il modello deve avere da 1 a 20 fasi');
  const keys = new Set();
  return phases.map((p, i) => {
    const label = String(p?.label || '').trim().slice(0, 120);
    if (!label) throw new Error(`Dai un nome alla fase ${i + 1}`);
    let key = String(p.key || '').trim().slice(0, 40) || `fase_${i + 1}`;
    while (keys.has(key)) key = `${key}_${i + 1}`;
    keys.add(key);
    const days = Math.min(Math.max(Math.round(Number(p.days) || 10), 1), 730);
    const items = (Array.isArray(p.items) ? p.items : []).slice(0, 40).map((it, j) => {
      const [k, l] = Array.isArray(it) ? it : [it?.key, it?.label];
      const itemLabel = String(l || '').trim().slice(0, 200);
      return itemLabel ? [String(k || '').trim().slice(0, 40) || `p${j + 1}`, itemLabel] : null;
    }).filter(Boolean);
    return { key, label, days, items };
  });
}

// Fasi di un progetto da un modello. Per un target già avviato prima di ALM2-74 si ricostruiscono le spunte della vecchia
// checklist (stesse chiavi) e le fasi già passate: lo step «approvazione» vuol dire due diligence chiuse, «offerta»
// anche la delibera; l'esito «acquisito» chiude tutto.
function phasesFromTemplate(template, legacy = null) {
  const doneUntil = !legacy ? -1
    : legacy.outcome === 'acquisito' ? template.length
    : legacy.step === 'offerta' ? template.findIndex(p => p.key === 'offerta')
    : legacy.step === 'approvazione' ? template.findIndex(p => p.key === 'approvazione') : 0;
  const ticks = Object.assign({}, ...Object.values(legacy?.checklist || {}));
  return template.map((p, i) => ({
    key: p.key, label: p.label, days: p.days,
    done: legacy ? i < doneUntil : false,
    items: p.items.map(([k, label]) => ({ key: k, label, done: Boolean(ticks[k]) || (legacy ? i < doneUntil : false) })),
  }));
}

// Lo step dei vecchi target che corrisponde alla fase in corso (per il cruscotto e l'export, che contano gli step).
function legacyStepOf(phaseKey) {
  if (phaseKey === 'approvazione' || phaseKey === 'rtb' || phaseKey === 'firma') return 'approvazione';
  if (['offerta', 'closing', 'lavori', 'costruzione', 'esercizio', 'proposta'].includes(phaseKey)) return 'offerta';
  return 'due_diligence';
}

module.exports = { PROJECT_TYPES, SELECTION, DEFAULT_TEMPLATES, typeFromKind, cleanTemplate, phasesFromTemplate, legacyStepOf };
