// HQSE (ALM2-100): il catalogo di partenza, letto da Vittoria RMS il 26/11/2026 (Interferenza → Master Check-Lists).
// Si carica una volta sola quando le tabelle sono vuote; poi HQSE lo cambia da «Checklist e regole», senza codice.
// Regole di validità: firma | rilascio | attestato = mesi da quella data; documento = la data scritta sul documento;
// nessuna = non scade (si ricarica a ogni revisione).
const DOC = (code, name, scope, rule, months, instructions = '', o = {}) => ({ code, name, scope, rule, months, instructions, blocking: o.blocking ?? true, template: o.template || '', checks: [] });

const PRIMA_AGG = 'Prima formazione + aggiornamento in corso di validità, in un unico PDF.';

const DOC_TYPES = [
  // ── azienda ──
  DOC('aut_unica', 'Autodichiarazione Unica', 'fornitore', 'firma', 6, 'Scarica il modello rev.01 e compila tutte le sezioni: titolari e amministratori, SOA o patente a punti con il fatturato degli ultimi 3 anni, collegamenti con altre società, whitelist e antimafia, conflitti d\'interesse, tracciabilità dei flussi con i delegati sul conto dedicato.', { template: 'CK1-3 Autodichiarazione unica di qualificazione rev01.docx' }),
  DOC('cciaa', 'Visura camerale (CCIAA)', 'fornitore', 'rilascio', 6, 'Certificato di iscrizione alla Camera di commercio o visura camerale.'),
  DOC('idoneita_tp', 'Dichiarazione di idoneità tecnico-professionale', 'fornitore', 'firma', 6, 'Compila il modello e allega il documento d\'identità del dichiarante, in un unico PDF.', { template: 'Dichiarazione idoneità tecnico-professionale.docx' }),
  DOC('nif', 'NIF', 'fornitore', 'firma', 6, 'Compila l\'intestazione, spunta almeno un\'opzione, inserisci i dati del dichiarante. Con timbro e firma.'),
  DOC('antimafia', 'Autocertificazione antimafia + conviventi e membri della società', 'fornitore', 'documento', null),
  DOC('ci_dichiarante', 'Carta d\'identità del dichiarante', 'fornitore', 'documento', null),
  DOC('durc', 'DURC', 'fornitore', 'documento', null),
  DOC('whitelist', 'Iscrizione Whitelist o dichiarazione di non iscrizione', 'fornitore', 'documento', null, 'Obbligatoria per: inerti, calcestruzzo e bitume, noli a freddo e a caldo, ferro lavorato, autotrasporto conto terzi, guardiania, servizi funerari. Se non sei tenuto, carica l\'autodichiarazione di non iscrizione.'),
  DOC('albo_gestori', 'Iscrizione Albo Nazionale Gestori Ambientali (se applicabile)', 'fornitore', 'documento', null, 'Vale 10 anni per la categoria 2-bis, 5 anni per le altre.', { blocking: false }),
  DOC('soa', 'Attestazione SOA (se applicabile)', 'fornitore', 'documento', null, '', { blocking: false }),
  DOC('art47', 'Autodichiarazione ai sensi dell\'art. 47 DPR 445/2000', 'fornitore', 'firma', 6),
  DOC('rls', 'Designazione RLS o RLST + attestato', 'fornitore', 'attestato', 12, 'In un unico PDF: prima formazione di 32 ore con l\'eventuale aggiornamento e la nomina dell\'RLS o RLST.'),
  DOC('organico_ccnl', 'Dichiarazione organico medio annuo + CCNL applicato', 'fornitore', 'firma', 12, 'Usa il modello senza cambiarne il testo, riferito all\'anno precedente, e indica il CCNL applicato.'),
  DOC('dvr', 'DVR', 'fornitore', 'nessuna', null, 'Il DVR in tutte le sue pagine, con la pagina delle firme di datore di lavoro, RSPP, RLS o RLST e medico competente.'),
  DOC('medico', 'Nomina del medico competente', 'fornitore', 'documento', null, 'La scadenza solo se è scritta sul documento.'),
  DOC('rspp', 'Nomina RSPP + attestato', 'fornitore', 'attestato', 60, 'Nomina o autonomina del RSPP e ultimo aggiornamento in corso di validità (RSPP/DDL o RSPP esterno, 40 ore), in un unico PDF.'),
  DOC('patente_crediti', 'Patente a crediti (se SOA inferiore alla III)', 'fornitore', 'rilascio', 6, 'Con il punteggio in evidenza. Se non hai la patente a crediti, carica l\'attestazione SOA.'),
  DOC('rct_1m', 'RCT/RCO superiore a 1.000.000 € + quietanza', 'fornitore', 'documento', null, 'Polizza con il massimale in evidenza e la quietanza di pagamento in corso di validità.'),
  DOC('rct', 'RCT/RCO con massimali + quietanza', 'fornitore', 'documento', null, 'Polizza con i massimali in evidenza e la quietanza in corso di validità.'),
  DOC('art90', 'Requisiti ex art. 90 DPR 207/2010 (senza SOA)', 'fornitore', 'firma', 6, 'Solo se non hai la SOA: compila il modello e allega il documento d\'identità del dichiarante.', { blocking: false }),
  DOC('albo_prof', 'Abilitazione alla professione o iscrizione all\'albo', 'fornitore', 'documento', null, 'Non sono ammesse autodichiarazioni.'),
  // CL6 punteggi aggiuntivi: facoltativi, non bloccano
  ...[['bilancio_sost', 'Bilancio di sostenibilità'], ['iso37001', 'Certificazione ISO 37001'], ['iso45001', 'Certificazione ISO 45001'], ['iso9001', 'Certificazione ISO 9001'], ['ghc', 'Certificazione GHC'], ['iso27001', 'Certificazione ISO/IEC 27001'], ['iso14001', 'Certificazione ISO 14001'], ['iso30415', 'Certificazione ISO 30415:2021'], ['iso50001', 'Certificazione ISO 50001'], ['pdr125', 'Certificazione PdR 125'], ['sa8000', 'Certificazione SA8000'], ['mod231', 'Modello D.Lgs 231/01'], ['rating_sost', 'Rating di sostenibilità']]
    .map(([c, n]) => DOC(c, n, 'fornitore', 'documento', null, c === 'mod231' ? 'A ogni nuova revisione aggiorna il documento.' : 'Inserisci le date di validità scritte sul documento.', { blocking: false })),
  DOC('rating_legalita', 'Rating di legalità', 'fornitore', 'rilascio', 24, 'Vale 2 anni dal rilascio.', { blocking: false }),
  // CL7 associazione al cantiere
  DOC('conf_macchine', 'Dichiarazione di conformità di macchine, attrezzature e opere provvisionali', 'fornitore', 'nessuna', null, 'Su carta intestata, con timbro e firma del dichiarante.'),
  DOC('art14', 'Dichiarazione di assenza di provvedimenti ex art. 14 D.Lgs 81/08', 'fornitore', 'nessuna', null, 'Con timbro e firma del dichiarante.'),
  DOC('format_macchine', 'Elenco di macchine, attrezzature e opere provvisionali (format Almacis)', 'fornitore', 'nessuna', null, 'Compila il format predisposto da Almacis in tutte le parti, per ogni macchina, attrezzatura e opera provvisionale che porti in cantiere.'),
  DOC('pimus', 'PiMUS e libretto del ponteggio (se monti ponteggi)', 'fornitore', 'nessuna', null, 'Piano di montaggio, uso e smontaggio firmato, con l\'autorizzazione ministeriale e il libretto del ponteggio usato.', { blocking: false }),
  DOC('pos', 'POS', 'fornitore', 'nessuna', null, 'Completo e firmato da DL, RSPP, RLS e medico competente; anche le revisioni con tutte le pagine e tutte le firme.'),
  // CL12 ambientali
  DOC('anga', 'Albo Gestori Ambientali (ANGA)', 'fornitore', 'documento', null, 'Obbligatorio per trasportatori e intermediari o commercianti di rifiuti.'),
  DOC('aut_ambientale', 'Autodichiarazione ambientale', 'fornitore', 'firma', 12, 'Usa il modello senza cambiarne il testo. La sezione 1 decide quali documenti servono; nella sezione 3 indica se sei iscritto al RENTRI.'),
  DOC('terre_rocce', 'Autorizzazione terre e rocce da scavo', 'fornitore', 'documento', null, 'Per i siti di destino delle terre e rocce da scavo come sottoprodotto.', { blocking: false }),
  DOC('albo_autotrasp', 'Iscrizione all\'Albo Nazionale degli Autotrasportatori', 'fornitore', 'nessuna', null, 'Solo per i trasportatori.', { blocking: false }),
  DOC('rentri', 'Iscrizione RENTRI (screenshot o PDF del portale)', 'fornitore', 'nessuna', null, 'Se lo dichiari nell\'autodichiarazione ambientale.', { blocking: false }),
  DOC('eer_trasporto', 'Codici EER autorizzati al trasporto', 'fornitore', 'nessuna', null, 'Solo per i trasportatori.', { blocking: false }),
  DOC('eer_impianto', 'Codici EER autorizzati all\'impianto', 'fornitore', 'nessuna', null, 'Solo per gli impianti.', { blocking: false }),
  DOC('aut_rifiuti', 'Titolo autorizzativo alla gestione dei rifiuti (AIA, art. 208, AUA…)', 'fornitore', 'documento', null, 'Solo per gli impianti.', { blocking: false }),
  // CL13 lavoratori autonomi
  DOC('attestati_autonomo', 'Attestati di formazione e idoneità sanitaria', 'fornitore', 'documento', null, 'Indica la data di fine validità del primo documento che scade.'),
  DOC('dich_autonomo', 'Dichiarazione sostitutiva del lavoratore autonomo', 'fornitore', 'nessuna', null, 'Compila tutti i punti e allega il documento d\'identità del dichiarante, in un unico PDF.'),
  // commesse
  DOC('dompe_all2', 'Allegato 2 Dompé', 'fornitore', 'nessuna', null, 'Su carta intestata, con il contratto n. 4500097935 nel riferimento, timbro e firma.'),
  DOC('dompe_all3', 'Allegato 3 Dompé', 'fornitore', 'nessuna', null, 'Su carta intestata, con il contratto n. 4500097935 nel riferimento, timbro e firma.'),
  DOC('dompe_all4', 'Allegato 4 Dompé (solo lavoratore autonomo)', 'fornitore', 'nessuna', null, 'Su carta intestata, con il contratto n. 4500097935 nel riferimento, timbro e firma.', { blocking: false }),
  DOC('dompe_all5', 'Allegato 5 Dompé', 'fornitore', 'nessuna', null, 'Su carta intestata oppure con il timbro aziendale.'),
  DOC('durf', 'DURF', 'fornitore', 'rilascio', 4, 'Certificato di regolarità fiscale: vale 4 mesi dal rilascio.'),
  DOC('uniemens', 'UNIEMENS', 'fornitore', 'documento', null),
  DOC('sgi_antimafia', 'Autocertificazione antimafia con dichiarazione sostitutiva', 'fornitore', 'nessuna', null, 'Compila il modello in tutte le sue parti.'),
  DOC('casellari', 'Casellari giudiziali ex art. 94 D.Lgs 36/2023', 'fornitore', 'rilascio', 6, 'Non servono se il contratto principale è sotto 50.000 €.'),
  DOC('carichi_pendenti', 'Carichi pendenti (Agenzia delle Entrate)', 'fornitore', 'rilascio', 6, 'Non servono se il contratto principale è sotto 50.000 €.'),
  DOC('sgi_dpcm187', 'Dichiarazione ai sensi del DPCM 187/1991', 'fornitore', 'nessuna', null),
  DOC('sgi_conformita', 'Conformità all\'originale di CCIAA e SOA', 'fornitore', 'nessuna', null),
  DOC('sgi_art85', 'Dichiarazione sui soggetti dell\'art. 85 D.Lgs 159/2011', 'fornitore', 'nessuna', null),
  DOC('sgi_codice_etico', 'Accettazione del codice etico di Società Gasdotti Italia', 'fornitore', 'nessuna', null),
  DOC('sgi_sanzioni', 'Sanzioni amministrative ex art. 31 DPR 313/2002', 'fornitore', 'nessuna', null),
  DOC('sgi_psc', 'Accettazione del Piano di Sicurezza e Coordinamento', 'fornitore', 'nessuna', null),
  DOC('sgi_8108', 'Requisiti cogenti del D.Lgs 81/08 del subappaltatore', 'fornitore', 'nessuna', null, 'Usa il modello senza cambiarne testo e forma.'),
  DOC('sgi_comprova', 'Comprova dei requisiti (subappalto sotto 150.000 €)', 'fornitore', 'nessuna', null, 'Con la SOA basta la copia dell\'attestazione.'),
  DOC('sgi_prefettizia', 'Documentazione per l\'informazione prefettizia (sopra 150.000 €)', 'fornitore', 'rilascio', 12, 'In un unico PDF: istanza, dichiarazione sostitutiva della CCIAA, DURC, familiari conviventi.'),
  DOC('sgi_polizza_inf', 'Polizza infortuni professionali del subappaltatore', 'fornitore', 'documento', null, 'Non ostativo.', { blocking: false }),
  DOC('tracciabilita', 'Tracciabilità dei flussi finanziari (L. 136/2010)', 'fornitore', 'nessuna', null, 'Compila il modello in tutte le sue parti.'),
  DOC('ad_2359', 'Dichiarazione art. 2359 c.c. su controllo e collegamento', 'fornitore', 'firma', 12),
  DOC('ad_cciaa', 'Dichiarazione CCIAA conforme all\'originale', 'fornitore', 'documento', null),
  DOC('ad_dimensione', 'Dichiarazione piccola, media o grande impresa', 'fornitore', 'firma', 12),
  DOC('ad_150k', 'Requisiti per lavori sotto 150.000 € (senza SOA)', 'fornitore', 'documento', null, '', { blocking: false }),
  DOC('ig_a03', 'A03 Dichiarazione sostitutiva del subappaltatore', 'fornitore', 'nessuna', null),
  DOC('ig_a05', 'A05 Patto etico e di integrità', 'fornitore', 'nessuna', null),
  DOC('ig_a09', 'A09 Rating di legalità del subappaltatore', 'fornitore', 'nessuna', null),
  DOC('ig_a11', 'A11 Certificato di sostenibilità Synesgy', 'fornitore', 'nessuna', null, 'Il subappalto si autorizza solo con score di sostenibilità CRIF-ESG almeno D.'),
  DOC('ig_mezzi_doc', 'Documenti di mezzi e attrezzature (proprietà, libretti)', 'fornitore', 'nessuna', null),
  DOC('ig_mezzi_elenco', 'Elenco di mezzi e attrezzature impiegati', 'fornitore', 'nessuna', null),
  DOC('ig_noli', 'Mezzi noleggiati e contratti di nolo', 'fornitore', 'nessuna', null),
  DOC('ig_personale', 'Elenco del personale impiegato con ruolo e qualifica', 'fornitore', 'nessuna', null),
  // ── dipendenti ──
  DOC('r_ci', 'Carta d\'identità', 'risorsa', 'documento', null),
  DOC('r_cf', 'Codice fiscale (tessera sanitaria)', 'risorsa', 'documento', null),
  DOC('r_art37', 'Formazione lavoratori art. 37 (generale + specifica)', 'risorsa', 'attestato', 60, 'Formazione generale (4 ore) e specifica per il rischio dell\'attività (12 ore per il rischio alto, come in edilizia), con l\'aggiornamento di 6 ore ogni 5 anni (Accordo Stato-Regioni del 17 aprile 2025). ' + PRIMA_AGG),
  DOC('r_ddl_form', 'Formazione del datore di lavoro (Accordo Stato-Regioni 2025)', 'risorsa', 'attestato', 60, 'Corso per il datore di lavoro introdotto dall\'Accordo Stato-Regioni del 17 aprile 2025, con l\'aggiornamento previsto. ' + PRIMA_AGG, { blocking: false }),
  DOC('r_foto', 'Foto tessera', 'risorsa', 'nessuna', null),
  DOC('r_idoneita', 'Idoneità sanitaria alla mansione', 'risorsa', 'documento', null, 'Rilasciata dal medico competente nominato dall\'azienda.'),
  DOC('r_dpi', 'Lettera di consegna DPI', 'risorsa', 'firma', 12, 'Vale 1 anno dalla consegna.'),
  DOC('r_tesserino', 'Lettera di consegna del tesserino di riconoscimento', 'risorsa', 'nessuna', null),
  DOC('r_lul', 'LUL', 'risorsa', 'rilascio', 6, 'Scadenza semestrale.'),
  DOC('r_unilav', 'UNILAV con il CCNL applicato', 'risorsa', 'nessuna', null, 'Deve risultare il CCNL applicato, che si confronta con quello dichiarato dall\'azienda.'),
  DOC('r_distacco', 'UNILAV di distacco', 'risorsa', 'documento', null, 'Con le date di inizio e fine del distacco.'),
  DOC('r_ps', 'Attestato addetto al primo soccorso', 'risorsa', 'attestato', 36, PRIMA_AGG),
  DOC('r_ps_nomina', 'Nomina addetto al primo soccorso', 'risorsa', 'nessuna', null),
  DOC('r_ai', 'Attestato addetto antincendio', 'risorsa', 'attestato', 60, 'Attestato base + aggiornamento in corso di validità (D.Lgs 2 settembre 2021).'),
  DOC('r_ai_nomina', 'Nomina addetto antincendio', 'risorsa', 'nessuna', null),
  DOC('r_pes', 'Nomina + attestato lavori elettrici PES/PEI/PAV', 'risorsa', 'attestato', 60, PRIMA_AGG),
  DOC('r_confinati', 'Ambienti confinati + DPI respiratori di 3ª categoria', 'risorsa', 'documento', null, PRIMA_AGG),
  DOC('r_anticaduta', 'Addestramento DPI anticaduta di 3ª categoria', 'risorsa', 'documento', null, PRIMA_AGG),
  DOC('r_amianto', 'Rimozione, smaltimento e bonifica amianto', 'risorsa', 'attestato', 48, PRIMA_AGG),
  DOC('r_mmt', 'Conduzione di macchine movimento terra', 'risorsa', 'attestato', 60, PRIMA_AGG),
  DOC('r_gru_torre', 'Conduzione di gru a torre', 'risorsa', 'attestato', 60, PRIMA_AGG),
  DOC('r_gru_autocarro', 'Conduzione di gru per autocarro', 'risorsa', 'attestato', 60, PRIMA_AGG),
  DOC('r_carrelli', 'Conduzione di carrelli elevatori semoventi', 'risorsa', 'attestato', 60, PRIMA_AGG),
  DOC('r_gru_mobili', 'Conduzione di gru mobili su ruote', 'risorsa', 'attestato', 60, PRIMA_AGG),
  DOC('r_pompe', 'Conduzione di pompe per calcestruzzo', 'risorsa', 'attestato', 60, PRIMA_AGG),
  DOC('r_perforazione', 'Conduzione di macchine per la perforazione', 'risorsa', 'attestato', 60, PRIMA_AGG),
  DOC('r_ple', 'Piattaforme di lavoro elevabili (PLE)', 'risorsa', 'attestato', 60, 'PLE con e senza stabilizzatori: ' + PRIMA_AGG.toLowerCase()),
  DOC('r_ponteggi', 'Montaggio, smontaggio e trasformazione dei ponteggi', 'risorsa', 'attestato', 48, PRIMA_AGG),
  DOC('r_saldatore_acc', 'Saldatore acciaio', 'risorsa', 'documento', null, 'La scadenza è scritta sull\'attestato.'),
  DOC('r_saldatore_pe', 'Saldatore polietilene', 'risorsa', 'documento', null, 'La scadenza è scritta sull\'attestato.'),
  DOC('r_segnaletica', 'Segnaletica stradale nei cantieri', 'risorsa', 'attestato', 60, PRIMA_AGG),
  DOC('r_vaccini', 'Vaccinazioni obbligatorie', 'risorsa', 'nessuna', null, 'Evidenza delle vaccinazioni necessarie (per esempio nei depuratori).'),
  DOC('r_preposto', 'Formazione preposto', 'risorsa', 'attestato', 24, PRIMA_AGG),
  DOC('r_preposto_nomina', 'Nomina preposto', 'risorsa', 'nessuna', null),
  DOC('r_chimico', 'Attestato rischio chimico', 'risorsa', 'attestato', 60),
  // ── mezzi ──
  DOC('m_ce', 'Dichiarazione o certificazione CE', 'mezzo', 'nessuna', null, 'La dichiarazione o certificazione CE del mezzo.'),
  DOC('m_disponibilita', 'Disponibilità legale dell\'attrezzatura', 'mezzo', 'documento', null, 'Carta di circolazione con le revisioni.'),
  DOC('m_manutenzione', 'Registro di manutenzione', 'mezzo', 'nessuna', null, 'Registro o schede di manutenzione aggiornati come indica il libretto del costruttore.', { blocking: false }),
  DOC('m_verifiche', 'Verifiche periodiche (allegato VII D.Lgs 81/08)', 'mezzo', 'documento', null, 'Solo per le attrezzature dell\'allegato VII (apparecchi di sollevamento, PLE, gru…): l\'ultimo verbale di verifica periodica con la data della prossima.', { blocking: false }),
];

// Criteri di controllo dell'Ufficio QHSE (Aristide, email del 27/11/2026): presenza, completezza, validità temporale,
// conformità normativa e coerenza con le lavorazioni. Diventano i «controlli dell'AI» di ogni tipo di documento;
// HQSE li cambia da «Checklist e regole». on_fail: respingi = il documento non vale; chiedi = da guardare o integrare.
const R = text => ({ text, on_fail: 'respingi' });
const Q = text => ({ text, on_fail: 'chiedi' });
const FORMAZIONE = ore => [
  R('Attestato completo: nome e codice fiscale del lavoratore, soggetto formatore, ore, date del corso e firma'),
  R(`Durata del corso pari almeno a quella prevista${ore ? ` (${ore})` : ''}`),
  Q('Soggetto formatore con i requisiti dell\'Accordo Stato-Regioni del 17 aprile 2025 (o della norma specifica del corso)'),
  R('Aggiornamento fatto entro i termini: se la prima formazione è scaduta, c\'è l\'attestato di aggiornamento'),
  Q('Corso coerente con la mansione e con le lavorazioni del lavoratore'),
];
const ATTREZZATURA = FORMAZIONE('teoria e pratica previste per l\'attrezzatura; aggiornamento di 4 ore ogni 5 anni');
const CRITERI = [
  { area: 'Formazione del personale', rif: 'Accordo Stato-Regioni 17/04/2025 e norme specifiche', text: 'Durata, validità e aggiornamento degli attestati, requisiti del soggetto formatore, coerenza con la mansione.' },
  { area: 'Documentazione aziendale', rif: 'D.Lgs 81/2008', text: 'DVR, nomine e designazioni (RSPP, medico competente, RLS/RLST, preposti, addetti antincendio e primo soccorso), DURC, idoneità tecnico-professionale.' },
  { area: 'Documentazione del personale', rif: 'D.Lgs 81/2008', text: 'UNILAV, eventuale distacco, verbale di consegna dei DPI, giudizio di idoneità alla mansione specifica, formazione e abilitazioni per le lavorazioni.' },
  { area: 'Patente a crediti', rif: 'art. 27 D.Lgs 81/2008', text: 'Possesso, validità e almeno 15 crediti, salvo eccezioni; non serve con la SOA in classifica III o superiore.' },
  { area: 'Macchine, attrezzature e opere provvisionali', rif: 'D.Lgs 81/2008', text: 'Format Almacis compilato in tutte le parti; conformità, manutenzione e verifiche periodiche dove servono.' },
];
const CHECKS = {
  // azienda
  dvr: [R('Completo in tutte le pagine'), R('Firmato da datore di lavoro, RSPP, RLS o RLST e medico competente'), Q('Data certa o attestata dalle firme'), Q('Rischi valutati coerenti con le lavorazioni da fare per Almacis')],
  rspp: [R('Nomina firmata dal datore di lavoro e accettata dall\'RSPP (o autonomina del datore di lavoro)'), ...FORMAZIONE('modulo per RSPP o per il datore di lavoro che lo svolge; aggiornamento ogni 5 anni')],
  medico: [R('Nomina firmata dal datore di lavoro e dal medico competente'), Q('Medico con i titoli previsti (art. 38 D.Lgs 81/08)')],
  rls: [R('Designazione o elezione dell\'RLS, oppure indicazione dell\'RLST territoriale'), ...FORMAZIONE('32 ore; aggiornamento annuale di 4 o 8 ore')],
  durc: [R('Esito «regolare»'), R('Intestato all\'impresa, con la data di scadenza')],
  idoneita_tp: [R('Firmata dal legale rappresentante con il documento d\'identità'), R('Contenuti dell\'allegato XVII del D.Lgs 81/08 (CCIAA, DVR, DURC, assenza di provvedimenti art. 14)'), Q('Nomine delle figure della sicurezza indicate: RSPP, medico competente, RLS/RLST, preposti, addetti antincendio e primo soccorso')],
  patente_crediti: [R('Patente a crediti attiva, non sospesa né revocata'), R('Almeno 15 crediti residui (salvo eccezioni di legge)'), R('Se è una SOA al posto della patente: classifica III o superiore')],
  soa: [R('Attestazione in corso di validità, con la verifica triennale se dovuta'), Q('Categorie e classifiche coerenti con le lavorazioni da fare')],
  pos: [R('Completo e firmato da datore di lavoro, RSPP, RLS e medico competente'), Q('Lavorazioni, macchine e attrezzature coerenti con il cantiere Almacis')],
  conf_macchine: [R('Su carta intestata, con timbro e firma'), R('Dichiara la conformità (marcatura CE o adeguamento) di macchine, attrezzature e opere provvisionali')],
  format_macchine: [R('Format Almacis compilato in tutte le parti: tipo, marca, modello, matricola, marcatura CE, ultima manutenzione, verifiche periodiche'), Q('Macchine e attrezzature coerenti con le lavorazioni')],
  pimus: [R('PiMUS firmato e riferito al ponteggio usato'), R('Autorizzazione ministeriale e libretto del ponteggio')],
  attestati_autonomo: FORMAZIONE(''),
  // personale
  r_art37: FORMAZIONE('4 ore di generale + specifica per il rischio: 12 ore per il rischio alto; aggiornamento di 6 ore ogni 5 anni'),
  r_ddl_form: FORMAZIONE('corso per datori di lavoro dell\'Accordo 2025'),
  r_preposto: FORMAZIONE('12 ore; aggiornamento di 6 ore ogni 2 anni'),
  r_ps: FORMAZIONE('12 o 16 ore secondo il gruppo dell\'azienda (DM 388/2003); aggiornamento ogni 3 anni'),
  r_ai: FORMAZIONE('livello 1, 2 o 3 del DM 2 settembre 2021; aggiornamento ogni 5 anni'),
  r_pes: FORMAZIONE('norma CEI 11-27, con l\'attribuzione PES/PAV/PEI del datore di lavoro'),
  r_confinati: FORMAZIONE('DPR 177/2011, con l\'addestramento ai DPI respiratori'),
  r_anticaduta: FORMAZIONE('addestramento ai DPI di 3ª categoria'),
  r_amianto: FORMAZIONE('corso per addetti o dirigenti alla bonifica dell\'amianto'),
  r_ponteggi: FORMAZIONE('28 ore; aggiornamento di 4 ore ogni 4 anni (allegato XXI)'),
  r_segnaletica: FORMAZIONE('DI 22 gennaio 2019'),
  r_chimico: FORMAZIONE(''),
  r_saldatore_acc: [R('Patentino o qualifica in corso di validità, con il processo di saldatura')],
  r_saldatore_pe: [R('Patentino o qualifica in corso di validità, con il processo di saldatura')],
  r_unilav: [Q('Qualifica e mansione coerenti con le lavorazioni da fare')],
  r_distacco: [R('Distaccante e distaccatario indicati'), R('Date di inizio e fine che coprono il periodo in cantiere')],
  r_dpi: [R('Verbale firmato dal lavoratore, con l\'elenco dei DPI consegnati'), Q('DPI coerenti con le lavorazioni (per esempio anticaduta per i lavori in quota)')],
  r_idoneita: [R('Giudizio riferito alla mansione specifica svolta in cantiere'), R('Firmato dal medico competente'), Q('Esito «idoneo»: prescrizioni o limitazioni da valutare con l\'Ufficio QHSE')],
  // mezzi
  m_ce: [R('Marcatura CE o dichiarazione di conformità del costruttore (o adeguamento per le macchine più vecchie)')],
  m_manutenzione: [Q('Manutenzioni registrate secondo il libretto del costruttore, l\'ultima negli ultimi 12 mesi')],
  m_verifiche: [R('Ultima verifica periodica entro la periodicità dell\'allegato VII, con la data della prossima')],
};
for (const k of ['r_mmt', 'r_gru_torre', 'r_gru_autocarro', 'r_carrelli', 'r_gru_mobili', 'r_pompe', 'r_perforazione', 'r_ple']) CHECKS[k] = ATTREZZATURA;
for (const t of DOC_TYPES) t.checks = CHECKS[t.code] || [];
const CATALOG_VERSION = 2; // 2 = criteri dell'Ufficio QHSE (27/11/2026)

const SGI = ['AL 1507', 'AL 1508', 'AL 1509', 'AL 1510', 'AL 1511', 'AL 1514'];
const ITALGAS = ['AL 1001', 'AL 1003', 'AL 1006', 'AL 1007', 'AL 1013', 'AL 1016', 'AL 1017', 'AL 2010'];
const CL = (code, name, kind, docs, o = {}) => ({ code, name, kind, docs, commesse: o.commesse || [], optional: o.optional || false, vittoria: o.vittoria || name });

const LAVORI = ['soa', 'antimafia', 'art47', 'ci_dichiarante', 'rls', 'organico_ccnl', 'durc', 'dvr', 'albo_gestori', 'whitelist', 'medico', 'rspp', 'patente_crediti', 'rct_1m', 'art90'];
const CHECKLISTS = [
  CL('CL1', 'Generale', 'fornitore', ['aut_unica', 'cciaa', 'idoneita_tp', 'nif'], { vittoria: 'NEW-Checklist 1 - Generale' }),
  CL('CL2', 'Servizi', 'fornitore', ['antimafia', 'ci_dichiarante', 'durc', 'whitelist', 'albo_gestori'], { vittoria: 'NEW-Checklist 2 - Servizi' }),
  CL('CL3', 'Lavori', 'fornitore', LAVORI, { vittoria: 'NEW-Checklist 3 - Lavori' }),
  CL('CL4', 'Servizi e lavori', 'fornitore', LAVORI.filter(c => c !== 'art47'), { vittoria: 'NEW-Checklist 4 - Servizi e Lavori' }),
  CL('CL5', 'Liberi professionisti', 'fornitore', ['aut_unica', 'ci_dichiarante', 'albo_prof', 'nif', 'rct'], { vittoria: 'NEW-Checklist 5 - Liberi Professionisti' }),
  CL('CL6', 'Punteggi aggiuntivi', 'fornitore', ['bilancio_sost', 'iso37001', 'iso45001', 'iso9001', 'ghc', 'iso27001', 'iso14001', 'iso30415', 'iso50001', 'pdr125', 'sa8000', 'mod231', 'rating_legalita', 'rating_sost'], { optional: true, vittoria: 'NEW-Checklist 6 - Punteggi Aggiuntivi' }),
  CL('CL7', 'Associazione al cantiere', 'fornitore', ['conf_macchine', 'format_macchine', 'pimus', 'art14', 'pos'], { vittoria: 'NEW-Checklist 7 - Associazione al Cantiere' }),
  CL('CL8', 'Commessa Dompé', 'fornitore', ['dompe_all2', 'dompe_all3', 'dompe_all4', 'dompe_all5', 'durf', 'uniemens'], { commesse: ['AL 3015'], vittoria: 'NEW-Check List 8- COMMESSA DOMPE\'' }),
  CL('CL9', 'Commesse SGI', 'fornitore', ['aut_unica', 'sgi_antimafia', 'casellari', 'carichi_pendenti', 'sgi_dpcm187', 'sgi_conformita', 'sgi_art85', 'sgi_codice_etico', 'sgi_sanzioni', 'sgi_psc', 'sgi_8108', 'sgi_comprova', 'sgi_prefettizia', 'sgi_polizza_inf', 'tracciabilita'], { commesse: SGI, vittoria: 'NEW-Check list 9 - COMMESSE SGI' }),
  CL('CL10', 'Commesse A-Distribuzione', 'fornitore', ['ad_2359', 'ad_cciaa', 'ad_dimensione', 'ad_150k', 'tracciabilita'], { vittoria: 'New-Check List 10- COMMESSE ADISTRIBUZIONE' }),
  CL('CL11', 'Commesse Italgas', 'fornitore', ['ig_a03', 'ig_a05', 'ig_a09', 'ig_a11', 'ig_mezzi_doc', 'ig_mezzi_elenco', 'ig_noli', 'ig_personale'], { commesse: ITALGAS, vittoria: 'New-Check List 11- COMMESSE ITALGAS' }),
  CL('CL12', 'Fornitori ambientali', 'fornitore', ['anga', 'aut_ambientale', 'terre_rocce', 'albo_autotrasp', 'rentri', 'eer_trasporto', 'eer_impianto', 'aut_rifiuti'], { vittoria: 'New - Check List 12 - Fornitori Ambientali' }),
  CL('CL13', 'Lavoratori autonomi', 'fornitore', ['aut_unica', 'ci_dichiarante', 'cciaa', 'durc', 'patente_crediti', 'attestati_autonomo', 'dich_autonomo'], { vittoria: 'New - Check List 13 - Lavoratori Autonomi' }),
  CL('WL', 'Iscrizione Whitelist', 'fornitore', ['whitelist'], { vittoria: 'NEW - Iscrizione Whitelist' }),
  // dipendenti
  CL('R-DIP', 'Risorsa dipendente', 'risorsa', ['r_ci', 'r_cf', 'r_art37', 'r_foto', 'r_idoneita', 'r_dpi', 'r_tesserino', 'r_lul', 'r_unilav']),
  CL('R-DDL', 'Datore di lavoro lavoratore', 'risorsa', ['r_ci', 'r_cf', 'r_art37', 'r_ddl_form', 'r_foto', 'r_idoneita', 'r_dpi', 'r_tesserino'], { vittoria: 'Datore di lavoro_Lavoratore' }),
  CL('R-DIST', 'Distacco', 'risorsa', ['r_distacco']),
  CL('R-PS', 'Primo soccorso', 'risorsa', ['r_ps', 'r_ps_nomina']),
  CL('R-AI', 'Antincendio', 'risorsa', ['r_ai', 'r_ai_nomina']),
  CL('R-PES', 'Lavori elettrici PES/PEI/PAV', 'risorsa', ['r_pes'], { vittoria: 'PES/PEI/PAV' }),
  CL('R-CONF', 'Spazi confinati', 'risorsa', ['r_confinati']),
  CL('R-ANTIC', 'DPI anticaduta di 3ª categoria', 'risorsa', ['r_anticaduta'], { vittoria: 'addestramento DPI anticaduta di 3° categoria' }),
  CL('R-AMI', 'Amianto', 'risorsa', ['r_amianto']),
  CL('R-MMT', 'Macchine movimento terra', 'risorsa', ['r_mmt'], { vittoria: 'MMT' }),
  CL('R-GT', 'Gru a torre', 'risorsa', ['r_gru_torre'], { vittoria: 'Gruisti a torre' }),
  CL('R-GA', 'Gru su autocarro', 'risorsa', ['r_gru_autocarro']),
  CL('R-CAR', 'Carrelli semoventi', 'risorsa', ['r_carrelli']),
  CL('R-GM', 'Gru mobili', 'risorsa', ['r_gru_mobili']),
  CL('R-POMPE', 'Pompe calcestruzzo', 'risorsa', ['r_pompe']),
  CL('R-PERF', 'Perforazione', 'risorsa', ['r_perforazione']),
  CL('R-PLE', 'PLE', 'risorsa', ['r_ple']),
  CL('R-PONT', 'Ponteggi', 'risorsa', ['r_ponteggi']),
  CL('R-SALD-A', 'Saldatore acciaio', 'risorsa', ['r_saldatore_acc']),
  CL('R-SALD-P', 'Saldatore polietilene', 'risorsa', ['r_saldatore_pe']),
  CL('R-SEGN', 'Segnaletica stradale', 'risorsa', ['r_segnaletica']),
  CL('R-VACC', 'Vaccinazioni', 'risorsa', ['r_vaccini']),
  CL('R-PREP', 'Preposto di cantiere', 'risorsa', ['r_preposto_nomina', 'r_preposto'], { vittoria: 'Preposto cantiere' }),
  CL('R-CHIM', 'Rischio chimico', 'risorsa', ['r_chimico']),
  // mezzi
  CL('M-BASE', 'Documenti base attrezzatura', 'mezzo', ['m_ce', 'm_disponibilita', 'm_manutenzione', 'm_verifiche'], { vittoria: '1. Documenti Base Attrezzatura' }),
];

// Questionario dell'azienda (Vittoria: «Questionario fornitori almacis 2025», 2 domande) e regole risposta → checklist.
// Il legame tipo di appalto → checklist è un'ipotesi da confermare con HQSE (PRD, domande aperte).
const TIPI_APPALTO = [
  { key: 'lavori', label: 'Lavori', hint: 'Attività in cantiere: edilizia, scavi, demolizioni, impianti, montaggi', checklists: ['CL1', 'CL3'] },
  { key: 'servizi', label: 'Servizi', hint: 'Consulenza, formazione, manutenzioni leggere, trasporti, noleggi, pulizie, guardiania', checklists: ['CL1', 'CL2'] },
  { key: 'lavori_servizi', label: 'Lavori e servizi', hint: 'Lavori in cantiere e anche servizi', checklists: ['CL1', 'CL4'] },
  { key: 'materiali', label: 'Materiali', hint: 'Solo forniture di beni, senza lavori né servizi', checklists: [] },
  { key: 'professionista', label: 'Libero professionista', hint: 'Ingegneri, architetti, geometri, periti, consulenti', checklists: ['CL5'] },
];

// Questionario di ogni dipendente (Vittoria: «Check list risorse umane almacis» v9, 23 domande): risposta «sì» → checklist.
const DOMANDE_RISORSA = [
  { key: 'assunta', text: 'La risorsa è regolarmente assunta presso la vostra società?', options: { si: 'R-DIP', ddl: 'R-DDL' }, labels: { si: 'Sì', no: 'No', ddl: 'Datore di lavoro lavoratore' } },
  { key: 'distaccata', text: 'La risorsa è distaccata presso la vostra società?', yes: 'R-DIST' },
  { key: 'primo_soccorso', text: 'La risorsa è un addetto al primo soccorso?', yes: 'R-PS' },
  { key: 'antincendio', text: 'La risorsa è un addetto antincendio?', yes: 'R-AI' },
  { key: 'elettrici', text: 'La risorsa svolge lavori elettrici?', yes: 'R-PES' },
  { key: 'confinati', text: 'La risorsa svolge lavori in spazi confinati?', yes: 'R-CONF' },
  { key: 'anticaduta', text: 'La risorsa è formata all\'uso di DPI anticaduta di 3ª categoria?', yes: 'R-ANTIC' },
  { key: 'amianto', text: 'La risorsa rimuove, smaltisce o bonifica amianto?', yes: 'R-AMI' },
  { key: 'mmt', text: 'La risorsa conduce macchine movimento terra?', yes: 'R-MMT' },
  { key: 'gru_torre', text: 'La risorsa conduce gru a torre?', yes: 'R-GT' },
  { key: 'gru_autocarro', text: 'La risorsa conduce gru su autocarro?', yes: 'R-GA' },
  { key: 'carrelli', text: 'La risorsa conduce carrelli elevatori semoventi?', yes: 'R-CAR' },
  { key: 'gru_ruote', text: 'La risorsa conduce gru su ruote?', yes: 'R-GM' },
  { key: 'pompe', text: 'La risorsa conduce pompe per calcestruzzo?', yes: 'R-POMPE' },
  { key: 'perforazione', text: 'La risorsa conduce macchine per la perforazione?', yes: 'R-PERF' },
  { key: 'ple', text: 'La risorsa lavora su piattaforme elevabili (PLE)?', yes: 'R-PLE' },
  { key: 'ponteggi', text: 'La risorsa monta, trasforma e smonta ponteggi?', yes: 'R-PONT' },
  { key: 'saldatura_acciaio', text: 'La risorsa salda su acciaio?', yes: 'R-SALD-A' },
  { key: 'saldatura_pe', text: 'La risorsa salda su polietilene?', yes: 'R-SALD-P' },
  { key: 'segnaletica', text: 'La risorsa pianifica, controlla e mette la segnaletica nei cantieri stradali?', yes: 'R-SEGN' },
  { key: 'vaccini', text: 'Le attività della risorsa richiedono vaccinazioni particolari?', yes: 'R-VACC' },
  { key: 'preposto', text: 'La risorsa è un preposto di cantiere?', yes: 'R-PREP' },
  { key: 'chimico', text: 'La risorsa è esposta al rischio chimico?', yes: 'R-CHIM' },
];

module.exports = { DOC_TYPES, CHECKLISTS, TIPI_APPALTO, DOMANDE_RISORSA, CRITERI, CATALOG_VERSION };
