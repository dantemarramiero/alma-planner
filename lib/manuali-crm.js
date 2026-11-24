// Manuali d'uso di Alma CRM (ALM2-72, canvas «Alma Space · Manuali d'uso del CRM» approvato da Dante il 23/11/2026).
// Un solo posto per i testi: li servono GET /api/manuali (Impostazioni › Manuali d'uso e «Come si usa» sulle pagine del
// CRM) e la ricerca «manuali» di Alma. Scritti dal codice vero: i nomi tra «» sono le etichette dei pulsanti e delle voci.
//
// Forma: { id, n, group, title, desc, page, routes, dir, chapters: [{ t, b: [blocco…] }] }
//   routes  = prefissi dell'indirizzo (#/crm/lead…) su cui «Come si usa» apre questo manuale (vince il più lungo)
//   blocchi = ['p', testo] · ['steps', [testo…]] · ['auto'|'info'|'bell'|'who', testo]
//     auto = succede da solo · info = da sapere · bell = ti avvisa il CRM · who = chi può farlo
//   Nei testi: «…» diventa un'etichetta a pillola, **…** grassetto. Aggiornare qui quando cambia una pagina del CRM.

const UPDATED = '2026-11-24';

const GROUPS = [
  ['inizio', 'Da dove partire'],
  ['lavoro', 'Lavoro commerciale'],
  ['anagrafiche', 'Anagrafiche'],
  ['strumenti', 'Strumenti'],
];

const MANUALS = [
  // ── 1 ───────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'primi-passi', n: 1, group: 'inizio', title: 'Primi passi nel CRM', page: '#/crm/settimana', routes: ['#/crm'],
    desc: 'Il menu, chi vede cosa, i filtri che restano ricordati, «+ Nuovo» e la ricerca.',
    chapters: [
      { t: 'Cos\'è Alma CRM', b: [
        ['p', 'Alma CRM è il posto dove teniamo **aziende, enti e persone** con cui lavoriamo o vorremmo lavorare, e tutto quello che facciamo con loro: passi, email, incontri, note, progetti, gare.'],
        ['p', 'Le opportunità e le offerte si lavorano in BOSS: il CRM le mostra e le collega, non le duplica.'],
        ['info', 'Il CRM si apre sempre su «La mia settimana»: è la tua scrivania. Se non vedi il CRM nel menu dei moduli, chiedi alla direzione di accenderlo per te.'],
      ] },
      { t: 'Il menu', b: [
        ['p', 'A sinistra il menu del CRM ha tre gruppi:'],
        ['steps', [
          '**Lavoro commerciale**: «La mia settimana», «Radar», «I miei progetti», «Posta», «Calendario», «Concorrenza e gare», «Nuovi business».',
          '**Anagrafiche**: «Contatti», «Lead», «Clienti», «Fornitori», «Partner e concorrenti», «Tutte le anagrafiche».',
          '**Direzione** (solo amministratori): «ASA e accessi» e «Impostazioni CRM».',
        ]],
        ['p', 'Su ogni pagina del CRM, in alto a destra, il pulsante «Come si usa» apre il manuale di quella pagina.'],
      ] },
      { t: 'Chi vede cosa', b: [
        ['p', '**Tutti vedono tutte le anagrafiche.** L\'ASA (la business unit) e l\'owner servono a filtrare e a decidere chi riceve segnali e promemoria, non a nascondere.'],
        ['who', 'La direzione ha in più le impostazioni, l\'importazione da Zoho, la settimana dei colleghi e alcune azioni (cancellare un\'azienda, unire qualsiasi doppione). L\'ufficio gare ha in più la coda delle gare proposte dal radar.'],
        ['info', 'Le email restano private: le vedi solo tu finché non le colleghi a un\'azienda o a un progetto.'],
      ] },
      { t: 'I filtri restano ricordati', b: [
        ['p', 'Negli elenchi (Lead, Clienti, Contatti…) puoi filtrare per ASA, owner («I miei»), funzione e key account. I filtri attivi sono in arancione e **restano ricordati su questo computer**.'],
        ['info', 'Se vedi pochi dati, guarda la barra «Stai vedendo solo…» e premi «Mostra tutto».'],
      ] },
      { t: 'Cercare e creare al volo', b: [
        ['p', 'La ricerca nella barra in alto trova aziende, contatti e anche indirizzi della tua posta che non sono ancora nel CRM («non è nel CRM · Crea contatto»).'],
        ['p', 'Il pulsante «+ Nuovo» propone «Nuovo contatto», «Contatto dalla mia posta» e «Nuova azienda».'],
        ['steps', [
          'Ogni giorno apri «La mia settimana» e chiudi i passi di oggi.',
          'Dopo ogni incontro scrivi la nota: il CRM te la chiede da solo.',
          'Dai sempre un prossimo compito alle aziende che segui.',
        ]],
      ] },
    ],
  },

  // ── 2 ───────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'settimana', n: 2, group: 'lavoro', title: 'La mia settimana', page: '#/crm/settimana', routes: ['#/crm/settimana'],
    desc: 'La scrivania di ogni giorno: passi, segnali, piani da approvare, incontri senza note.',
    chapters: [
      { t: 'A cosa serve', b: [
        ['p', '«La mia settimana» è la prima pagina del CRM. In alto un saluto ti dice cosa c\'è di urgente: passi scaduti, segnali da decidere, primi passi da approvare. Sotto, una riga di contatori che si cliccano: «passi scaduti», «segnali da decidere», «primi passi da approvare», «incontri senza note», «lead senza prossimo passo», «key account da sentire».'],
        ['who', 'La direzione ha il selettore «Settimana di» per guardare la settimana di un collega.'],
      ] },
      { t: 'I prossimi passi', b: [
        ['p', 'Nella colonna sinistra, «Prossimi passi» li raggruppa in «Scaduti», «Oggi», «Questa settimana», «Più avanti».'],
        ['steps', [
          'Fatto un compito, clicca il cerchio a sinistra: si apre «Compito fatto».',
          'Scrivi «Com\'è andata?» e, in «Il compito dopo», cosa fare dopo con «Fra 3 giorni» o «Fra una settimana».',
          'Premi «Salva». Se non serve altro, «Fatto, senza compito dopo».',
        ]],
        ['info', 'Senza un compito aperto l\'azienda torna tra i «lead senza prossimo passo».'],
        ['bell', 'Quando un compito scade ricevi un avviso sulla campanella e sul telefono, una volta sola.'],
      ] },
      { t: 'Dare un compito', b: [
        ['p', 'La finestra «Dai un compito» si apre da qui e dalla scheda di ogni azienda e contatto. Un compito si può dare a te stesso o a uno o più colleghi: a loro arriva un avviso.'],
        ['steps', [
          'In «Cosa fare» scrivi l\'azione (es. «richiamare per il sopralluogo»).',
          'In «Entro quando» scegli «Domani», «Fra 3 giorni», «Fra una settimana», «Fra un mese» o una data.',
          'Scegli «Come» (Telefonata, Email, Incontro, Sopralluogo), «Chi lo fa» e «Con chi».',
          'In «Note per chi lo fa» scrivi quello che serve sapere; se vuoi, «Aggiungi una bozza del messaggio». Poi «Dai il compito».',
        ]],
      ] },
      { t: 'Segnali e piani da approvare', b: [
        ['p', '«Pronti da approvare» raccoglie i piani e le email del primo passo scritti dal CRM per i segnali che ti interessano: li cambi come vuoi, poi «Approva». Il primo passo finisce nei prossimi passi.'],
        ['p', '«Segnali del radar» mostra le occasioni della tua BU: «In evidenza · 70 e oltre» e «Altri». Su ogni riga «Interessa» o «Scarta». Il manuale «Radar» spiega il resto.'],
      ] },
      { t: 'La colonna destra', b: [
        ['steps', [
          '«Esiti da registrare»: le gare finite di cui manca il risultato; «Registra esito».',
          '«Ufficio gare» (solo per l\'ufficio gare): le gare proposte dal radar, «Apri la coda».',
          '«Nuovi business»: i passi delle iniziative, da spuntare.',
          '«Incontri senza note»: premi «Nota» e scrivila.',
          '«Key account da sentire»: i clienti chiave non sentiti da più del loro ritmo.',
          '«Lead senza prossimo passo»: «Assegna o chiudi».',
        ]],
      ] },
      { t: 'Segnalare un\'occasione', b: [
        ['p', 'Hai saputo di un lavoro in arrivo? Premi «Segnala un\'occasione», scrivi «Cosa è successo», l\'ente o l\'azienda e il link alla fonte, poi «Salva il segnale». Il CRM gli dà subito un punteggio.'],
      ] },
    ],
  },

  // ── 3 ───────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'radar', n: 3, group: 'lavoro', title: 'Radar', page: '#/crm/radar', routes: ['#/crm/radar', '#/crm/sottosoglia', '#/crm/gare', '#/crm/prima'],
    desc: 'Le gare prima che escano: lavagna, filtri, punteggio, «Interessa», piano e primo passo.',
    chapters: [
      { t: 'A cosa serve', b: [
        ['p', 'Il Radar raccoglie le **opere prima che diventino gare**: programmate, finanziate, con progetto approvato, gara in arrivo. Le notizie arrivano da più fonti: «Radar AI», «OpenCUP», «TED · preinformazione», «Programmi triennali», «Infordat», «Vinte da altri» e quelle segnalate «A mano».'],
        ['auto', 'Ogni notte il radar legge le notizie per ogni BU accesa e dà un punteggio da 0 a 100. Le opportunità scadute passano da sole tra le scartate.'],
        ['info', 'Sai di una gara che il radar non ha? Chiedila ad Alma («c\'è un bando per l\'ex COFA a Pescara, lo trovi?»): la cerca sul web, ti dice ente, importo, scadenza e la fonte, e se vuoi la aggiunge al Radar dopo la tua conferma. Le gare già uscite vanno all\'ufficio gare. CIG, importo e scadenza vanno sempre controllati sul bando.'],
        ['info', 'Gara di progettazione (servizi di architettura e ingegneria, progetto esecutivo)? Dopo arriva la gara dei lavori: insieme alla gara si aggiunge l’opportunità dei lavori in «Prima del bando», collegata. Alma segue l’aggiudicazione (ANAC ogni notte col CIG, il web ogni settimana): quando si sa chi è il progettista lo mette nel CRM come «progettista» con i dati trovati su internet e le persone da conoscere, e avvisa il responsabile della BU e chi l’ha aggiunta. Nel segnale: «A che punto è», «Controlla adesso», «Smetti di seguirla»; in «La mia settimana»: «Progettisti nuovi da conoscere».'],
      ] },
      { t: 'La lavagna', b: [
        ['p', 'Quattro colonne: «Programmata», «Finanziata», «Progetto approvato», «Gara in arrivo». Ogni scheda mostra fonte, punteggio, valore, BU, regione, scadenza e chi di noi conosce l\'ente.'],
        ['steps', [
          'Trascina una scheda in un\'altra colonna per cambiarle fase.',
          'La scritta «nuova» indica che è arrivata nelle ultime 24 ore.',
          'In fondo alla scheda: «Porta avanti», oppure «in corso · nome» se c\'è già un progetto, «su BOSS» o «scartata».',
        ]],
        ['p', 'A destra «Questa settimana» mostra le gare attese nei prossimi 60 giorni, quelle arrivate stanotte e le grandi dove nessuno ci conosce.'],
      ] },
      { t: 'Filtri e preferiti', b: [
        ['p', 'Puoi filtrare per BU, regioni (anche cliccando la mappa), importo, tipo, «Chi conosciamo» e fonte. «Mostra» decide se vedere anche le vinte da altri o le scartate. La vista si cambia tra «Lavagna» ed «Elenco».'],
        ['steps', [
          'Imposta i filtri e premi «+ Salva questi filtri».',
          'La puntina li rende il tuo filtro predefinito; × li toglie.',
          '«Togli i filtri» riporta tutto.',
        ]],
      ] },
      { t: 'Il segnale aperto', b: [
        ['p', 'Un clic su una scheda apre il segnale di lato. Trovi: «Chi», «Quanto», «Quando», «Cosa dice la notizia», «Come si arriva a» (Coerenza, Concretezza, Tempi, Rapporto, Valore), luogo, SOA, CIG.'],
        ['p', 'Sotto: «Prezzo e concorrenti» dai dati ANAC, la «Probabilità di vittoria», «Chi conosciamo» (le strade calde: chi di noi conosce quale persona) e il «Primo passo pronto».'],
        ['info', 'Le frecce in alto (o ← → da tastiera) passano al segnale prima e dopo.'],
      ] },
      { t: 'Interessa o scarta', b: [
        ['steps', [
          '«Interessa»: il CRM prepara il piano dal playbook. Se l\'ente non è nel CRM lo crea come lead.',
          '«Interessa e approva»: accetta anche il piano e il primo passo in un colpo solo.',
          '«Altra BU…» passa il segnale alla BU giusta.',
          '«Scarta»: scegli il motivo. Gli scarti insegnano al radar cosa non mandare più.',
        ]],
      ] },
      { t: 'Primo passo e piano d\'azione', b: [
        ['p', 'Il «Primo passo pronto» dice chi lo fa, come, quando e propone l\'email: «Riscrivi», «Apri in Outlook», «Copia».'],
        ['p', 'Il piano proposto ha i passi in ordine (trascinabili), le referenze da citare e la domanda di verifica. «Accetta piano» lo trasforma in prossimi passi; «Non serve» lo scarta. A piano finito, «Chiudi il piano» con l\'esito: «Opportunità in BOSS», «Rimandato» o «Perso».'],
      ] },
      { t: 'Porta avanti e sotto soglia', b: [
        ['p', '«Porta avanti» apre la sala di lancio: diventa un progetto con squadra, piano e obiettivo (manuale «I miei progetti»).'],
        ['p', '«Sotto soglia» mostra i segnali con punteggio basso, per BU: se uno ti interessa lo stesso, «Interessa lo stesso».'],
        ['who', 'La direzione vede «Correggi il profilo della BU» quando il radar porta segnali sbagliati.'],
      ] },
      { t: 'Opere finanziate e ufficio gare', b: [
        ['p', 'La scheda «Opere finanziate · OpenCUP» elenca le opere con finanziamento deciso: filtra «Senza gara», BU, zone, provincia; su ogni riga «Segnala al radar».'],
        ['who', 'Il pulsante «Gare» porta a «Proposte dal radar», solo per l\'ufficio gare e la direzione: le gare da guardare alla riunione del mercoledì, con «Scarta» o «Porta su BOSS», e il caricamento dell\'export di Infordat.'],
      ] },
    ],
  },

  // ── 4 ───────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'progetti', n: 4, group: 'lavoro', title: 'I miei progetti', page: '#/crm/progetti', routes: ['#/crm/progetti', '#/crm/progetto', '#/crm/lancio'],
    desc: 'Gare e trattative che segui: sala di lancio, squadra, piano, compiti.',
    chapters: [
      { t: 'Il portafoglio', b: [
        ['p', '«I miei progetti» mostra le gare, le trattative private (nate dalle email) e i nuovi settori che stai portando avanti. In alto: «Gare e trattative», «Nuovi settori», «Valore pesato», «Compiti». Il selettore passa tra «Miei», «Del mio team» e «Tutti».'],
        ['p', 'A destra «La mia giornata» (incontri e compiti di oggi) e «I miei compiti», da spuntare.'],
      ] },
      { t: 'La sala di lancio', b: [
        ['p', 'Si apre da «Porta avanti» (Radar, email, Nuovi business). A sinistra l\'opportunità con punteggio e strade calde; al centro «Lancia il progetto» in tre passi.'],
        ['steps', [
          '«1 · Squadra»: scegli il responsabile e spunta i membri; «+ persona» per aggiungerne.',
          '«2 · Piano»: fasi e compiti, modificabili; «+ compito», «+ fase».',
          '«3 · Obiettivo»: valore, probabilità, margine e ore (per i nuovi settori budget e ore).',
          'Premi «Lancia il progetto».',
        ]],
      ] },
      { t: 'La scheda del progetto', b: [
        ['p', 'In testa le tappe (cliccabili per dire «Siamo a…») e quattro numeri. Le tab: «Panoramica», «Compiti» (Kanban «Da fare», «In corso», «Fatti»), «Relazioni», «Incontri», «Calendario», «Note», «Gantt», «Rendiconto», «Documenti», «Email», «Membri».'],
        ['who', '«Modifica» è di chi gestisce il progetto; «Nuovo compito» dei membri.'],
      ] },
      { t: 'Trattativa nata da un\'email', b: [
        ['p', 'Se il progetto viene da un\'email, in testa trovi «In breve, secondo Alma», a chi tocca rispondere e il «Termometro». La barra «La prossima mossa» propone «Fatto», «Crea l\'incontro» o «Prepara la risposta».'],
        ['p', 'Sotto: «Cronologia» con le note, «Impegni presi nelle email» («Compito», «Ricordamelo», «In calendario»), «Chi conta in questa trattativa», le persone nuove e le email che aspettano il tuo sì.'],
      ] },
      { t: 'Collegati e punti di contatto', b: [
        ['p', 'Nel riquadro «Collegati» cerchi nel CRM un\'azienda o persona e scegli il ruolo (RUP, referente, partner ATI…). Se non c\'è, «Crea … al volo».'],
        ['p', 'I «Punti di contatto trovati» propongono «Collega come…», «Chiedi a … un\'introduzione», «Aggiungi … alla squadra» o «Non c\'entra».'],
        ['info', 'Niente si collega da solo: decidi sempre tu.'],
      ] },
    ],
  },

  // ── 5 ───────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'posta', n: 5, group: 'lavoro', title: 'Posta', page: '#/crm/posta', routes: ['#/crm/posta', '#/posta-mia', '#/firma'],
    desc: 'Outlook dentro il CRM: rispondere, scrivere con Alma, da email a progetto.',
    chapters: [
      { t: 'La tua casella nel CRM', b: [
        ['p', '«Posta» è la tua casella di Outlook dentro il CRM. Le pillole «In arrivo», «Inviate», «Cartelle» e «Da approvare» cambiano l\'elenco; «Cerca nella posta» cerca.'],
        ['info', 'Le tue email le vedi solo tu. Nemmeno la direzione può farle entrare in un progetto al posto tuo.'],
      ] },
      { t: 'Leggere e rispondere', b: [
        ['p', 'Aperta un\'email: «Rispondi», «Rispondi a tutti», «Inoltra», «Sposta», «Elimina». Nelle conversazioni lunghe «Riassumi» fa un riassunto con Alma (mostra il costo prima).'],
        ['info', 'Tasti rapidi: R rispondi, A a tutti, F inoltra, V sposta, Canc elimina, J e K email dopo e prima, N nuova email.'],
        ['p', 'Selezionando più email compaiono «Sposta», «Elimina», «Deseleziona». Dopo spostare o eliminare c\'è sempre «Annulla».'],
      ] },
      { t: 'Scrivere, anche con Alma', b: [
        ['steps', [
          'Premi «Nuova email». In A, Cc, Ccn scrivi un nome o un indirizzo.',
          'La «Firma Almacis» si mette da sola: «togli», «rimettila», «cambia».',
          '«Scrivi con Alma»: un punto per riga in «Indicazioni per Alma», scegli lingua e tono, poi «Scrivi la bozza».',
          '«Allega» per i file, «Salva bozza» per finire dopo, «Invia» (o Ctrl+Invio).',
        ]],
        ['info', 'Se chiudi senza inviare, la bozza resta: «Ho ripreso la bozza che avevi lasciato».'],
      ] },
      { t: 'Dalla email al CRM', b: [
        ['p', 'Sopra ogni email la barra «Dalla email · cosa c\'è già nel CRM» dice se l\'azienda (dal dominio e dalla firma), chi ha scritto e chi è in copia sono «nel CRM» o «non nel CRM».'],
        ['steps', [
          '«+ Contatto» crea la persona con i dati della firma.',
          '«+ Azienda» crea l\'azienda (Lead, Cliente, Fornitore, Partner) e può collegarle l\'email.',
          '«+ Opportunità» la salva nel Radar.',
        ]],
      ] },
      { t: 'Da email a progetto', b: [
        ['steps', [
          'Premi «Crea progetto commerciale».',
          'Controlla titolo, azienda, BU e tipo («Trattativa privata» o «Gara»).',
          'Spunta le persone da collegare e le email che entrano nel progetto.',
          'Scegli per le risposte future: «Le approvo io una per una» oppure «Entrano da sole».',
          '«Avanti: sala di lancio», oppure «Salva solo nel Radar».',
        ]],
        ['p', 'Per un progetto che c\'è già: «Aggiungi a un progetto».'],
      ] },
      { t: 'Da approvare', b: [
        ['p', 'In «Da approvare» arrivano le risposte nuove delle conversazioni che hai legato a un progetto. Per ognuna «Entra nel progetto» o «Non c\'entra»; «Entrano tutte» le fa entrare in blocco.'],
        ['auto', 'Con «Entrano da sole» le risposte entrano nel progetto ogni 30 minuti, senza chiederti niente.'],
      ] },
    ],
  },

  // ── 6 ───────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'calendario', n: 6, group: 'lavoro', title: 'Calendario', page: '#/crm/calendario', routes: ['#/crm/calendario', '#/crm/incontro'],
    desc: 'Gli incontri di Outlook collegati da soli, le note, il riepilogo ai partecipanti.',
    chapters: [
      { t: 'Il tuo Outlook coi colori del CRM', b: [
        ['p', 'Il «Calendario» è il tuo Outlook. A sinistra «Mostra» accende i colori: clienti e aziende del CRM, progetti e trattative, inviti da confermare, scadenze del Radar, altri esterni, colleghi.'],
        ['p', 'Viste Giorno, Settimana, Mese, Agenda (tasti G, S, M, A; T per oggi). Gli incontri che organizzi tu si spostano trascinandoli: gli invitati ricevono l\'aggiornamento.'],
        ['auto', 'Ogni 15 minuti il CRM legge il tuo calendario: se tra gli invitati c\'è un contatto del CRM, l\'incontro si collega da solo a lui e alla sua azienda. Se c\'è un indirizzo del dominio di un\'azienda, si collega all\'azienda e ti propone di creare il contatto.'],
      ] },
      { t: 'Un incontro aperto', b: [
        ['p', 'Il pannello dell\'incontro ha «Accetta», «Forse», «Rifiuta», «Entra in Teams», «Apri in Outlook». «Collegato a» mostra azienda, contatti e progetto («+ azienda o contatto», «+ progetto»). In «Chi c\'è» trovi chi non è nel CRM, con «Aggiungi».'],
        ['p', '«Prepara l\'incontro» chiede ad Alma cosa sapere, l\'ultima volta, cosa chiedere e cosa portare.'],
      ] },
      { t: 'Le note dopo l\'incontro', b: [
        ['steps', [
          'Finito l\'incontro, apri il pannello e scrivi le note; «Salva la nota».',
          '«Riepilogo ai partecipanti»: Alma scrive il riassunto, tu lo controlli e lo mandi.',
          '«Attività di follow-up» crea un compito per te a due giorni; «Prossimo incontro» ne fissa un altro.',
        ]],
        ['bell', 'Se un incontro collegato al CRM finisce senza note, ricevi un avviso «Mancano le note dell\'incontro…» (una volta). Lo trovi anche in «Da sistemare» e in «La mia settimana».'],
      ] },
      { t: 'Nuovo incontro', b: [
        ['steps', [
          'Premi «Nuovo incontro» (o N).',
          'Titolo e «Con chi»: colleghi, contatti del CRM o un indirizzo email.',
          'Giorno, ora e durata; «Trova un orario libero per tutti» guarda le agende dei colleghi.',
          '«Riunione Teams» oppure un luogo; «Collega a» un\'azienda o un progetto.',
          'Il testo dell\'invito lo puoi far scrivere ad Alma. Poi «Invia l\'invito».',
        ]],
      ] },
    ],
  },

  // ── 7 ───────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'concorrenza', n: 7, group: 'lavoro', title: 'Concorrenza e gare', page: '#/crm/concorrenza', routes: ['#/crm/concorrenza', '#/crm/esiti', '#/crm/relazioni'],
    desc: 'Chi vince, a che ribasso, dove conviene, partner, progettisti, vinte e perse.',
    chapters: [
      { t: 'Da dove vengono i dati', b: [
        ['p', 'La pagina usa i dati aperti di **ANAC**: le gare aggiudicate nelle nostre categorie e zone. In alto: «Gare aggiudicate», «Ribasso tipico», «Imprese che vincono», «Vinte da noi».'],
        ['auto', 'ANAC si controlla ogni giorno alle 5: quando esce un mese nuovo si carica da solo.'],
        ['p', 'Filtri: BU, 12 o 24 mesi, categorie, regioni, fascia d\'importo. «Cerca un\'impresa per nome o P.IVA» apre la sua scheda di mercato.'],
      ] },
      { t: 'Chi vince', b: [
        ['p', 'La classifica delle imprese che vincono: gare vinte, valore, ribasso medio, quante in ATI, se sono nel CRM. «Aggiungi» mette un\'impresa nel CRM come concorrente.'],
        ['p', 'A lato: «Ribasso per fascia d\'importo», «Con chi fare ATI» e «Le nostre» gare.'],
      ] },
      { t: 'Regioni, partner, vinte da altri', b: [
        ['steps', [
          '«Regioni»: dove conviene concentrarsi (punteggio «Conviene» da 0 a 100), con gli enti che bandiscono di più; «Crea iniziativa» apre Nuovi business già compilato.',
          '«Partner»: le imprese con cui fare squadra, per regione e BU; «Proponi un incontro» crea un compito sull\'azienda.',
          '«Vinte da altri»: gare appena aggiudicate ad altri; «Proponiti in subappalto».',
        ]],
      ] },
      { t: 'Progettisti', b: [
        ['p', 'La sezione «Progettisti» mostra chi progetta le opere pubbliche (incarichi di architettura e ingegneria da ANAC): i più attivi, per quali enti lavorano, con chi vanno in gara e quali imprese vincono le opere che progettano.'],
        ['steps', [
          '«Cerca un progettista» per nome o codice fiscale, oppure scegli dalla classifica.',
          'Nella scheda vedi incarichi, onorari, enti e «Opere progettate · cosa è successo dopo».',
          '«Aggiungi al CRM» lo salva come progettista: il CRM ti dice chi di noi lo conosce dalle email e dagli incontri.',
        ]],
        ['info', 'Nel segnale del Radar e nella scheda di un ente trovi anche chi ha progettato l\'opera e i progettisti più forti con quell\'ente.'],
      ] },
      { t: 'Vinte e perse', b: [
        ['p', 'Ogni gara a cui partecipiamo ha un esito. La pagina «Vinte e perse» si apre da «La mia settimana» («Esiti da registrare») e dal segnale del Radar («Registra esito»).'],
        ['steps', [
          'Premi «Registra esito».',
          'Se c\'è il CIG, il CRM compila da ANAC vincitore e ribasso.',
          'Indica vinta o persa e, se persa, il motivo. Il vincitore diventa un concorrente nel CRM.',
        ]],
        ['auto', 'Con gli esiti il CRM calcola la «Probabilità di vittoria» sui segnali; sotto 15 esiti per BU è «in apprendimento».'],
      ] },
      { t: 'Chi conosciamo', b: [
        ['p', 'Il CRM misura quanto ci conosce ogni azienda: contano gli incontri, le email scambiate, le commesse fatte e i key account. Il rapporto è «forte», «medio» o debole e si raffredda col tempo.'],
        ['p', 'Lo vedi nel Radar (filtro «Chi conosciamo», avatar sulle schede, «strade calde» nel segnale) e nella scheda di ogni azienda.'],
      ] },
    ],
  },

  // ── 8 ───────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'business', n: 8, group: 'lavoro', title: 'Nuovi business', page: '#/crm/business', routes: ['#/crm/business'],
    desc: 'Iniziative a cinque fasi, i gate, la chat, i clienti target.',
    chapters: [
      { t: 'A cosa serve', b: [
        ['p', '«Nuovi business» segue le aree d\'affari nuove come iniziative in cinque fasi: Esplorazione, Analisi, Piano, Ingresso, Consolidamento. Tra una fase e l\'altra c\'è un **gate** che decide la direzione: «Prosegui», «Rimanda» o «Abbandona».'],
        ['p', 'In alto i numeri: iniziative aperte, clienti target, già contattati, requisiti a posto, gate scaduti, spesa sul budget.'],
      ] },
      { t: 'Creare un\'iniziativa', b: [
        ['steps', [
          'Premi «Nuova iniziativa» (o «Chiedi un\'idea» per farti proporre spunti).',
          '«1 · Cosa»: nome e descrizione; «Parti con l\'assistente» se vuoi ragionarci con l\'AI.',
          '«2 · Chi e quanto»: responsabile, sponsor della direzione, budget, ASA dei nuovi lead, data del gate G0.',
          'Premi «Apri l\'iniziativa».',
        ]],
      ] },
      { t: 'La scheda dell\'iniziativa', b: [
        ['steps', [
          '«Chat»: l\'assistente propone riflessioni, clienti, requisiti e passi; «Scegli e aggiungi».',
          '«Clienti target»: «Trova altri clienti», «Aggiungi cliente», «Crea il lead» per portarli nel CRM.',
          '«Cosa ci manca»: i requisiti (SOA, persone, attrezzature).',
          '«Piano»: Gantt e gate, «Decidi il gate».',
          '«Riflessioni»: ipotesi, rischi, SWOT. «Analisi» e «Mercato»: numeri e mappa del mercato.',
        ]],
        ['who', 'Modifica il responsabile; i gate li decide lo sponsor o la direzione. «Elimina l\'iniziativa» solo gli amministratori.'],
      ] },
      { t: 'Riepilogo per la riunione', b: [
        ['p', 'Il selettore «Riepilogo» mostra tutte le iniziative in colonne e la sezione «Da decidere in questa riunione», con «Prosegui», «Rimanda», «Abbandona». «Esporta per la riunione» stampa su A4.'],
        ['bell', 'Dalle 8 di mattina arrivano avvisi per gate in scadenza o scaduti, iniziative ferme da 21 giorni e passi scaduti (uno al giorno per iniziativa). Si regolano in Profilo › Notifiche.'],
      ] },
      { t: 'Porta avanti', b: [
        ['p', 'Quando l\'iniziativa è pronta, «Porta avanti» apre la sala di lancio e la fa diventare un progetto con squadra e piano; poi trovi «Apri il progetto».'],
      ] },
    ],
  },

  // ── 9 ───────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'contatti', n: 9, group: 'anagrafiche', title: 'Contatti', page: '#/crm/contatti', routes: ['#/crm/contatti', '#/biglietto'],
    desc: 'Nuovo contatto, persone con cui mi scrivo, biglietti da visita.',
    chapters: [
      { t: 'L\'elenco', b: [
        ['p', 'I contatti sono le **persone** legate a lead, clienti, fornitori e partner. In alto i riquadri per tipo di azienda filtrano l\'elenco; sotto gli avvisi «senza azienda», «da sistemare», «senza recapiti». Sulle righe con dati sporchi c\'è «Sistema».'],
        ['p', 'Le sotto-schede: «Tutti i contatti», «Persone con cui mi scrivo», «Biglietti da visita».'],
      ] },
      { t: 'Nuovo contatto', b: [
        ['steps', [
          'Premi «Nuovo contatto».',
          'Scrivi il nome intero in «Nome»: titolo, nome e cognome si dividono da soli.',
          'Scrivi l\'email: l\'azienda viene suggerita dal dominio. Se non c\'è, «Crea …» e scegli il tipo (lead, cliente…).',
          'Cellulare e, in «Altri campi», qualifica, telefono, LinkedIn, note. Poi salva.',
          'Per trovare le persone di un\'azienda dalla posta, dagli incontri o da internet usa «Persone da aggiungere» nella sua scheda (manuale 12).',
        ]],
        ['info', 'L\'email serve a collegare da soli gli incontri di Outlook: mettila sempre. Se il contatto c\'è già, il CRM te lo dice («C\'è già:…»).'],
      ] },
      { t: 'Persone con cui mi scrivo', b: [
        ['p', 'Il CRM legge la **tua** posta degli ultimi 12 mesi e ti mostra chi ti scrive e non è nel CRM. Ognuno vede solo la sua.'],
        ['steps', [
          'In «Da aggiungere» premi «Crea contatto»: i dati arrivano dalla firma.',
          'Scegli l\'azienda (già nel CRM, nuova come lead, o a mano) e se collegare le email già scambiate.',
          '«Ignora» chi non serve; «Crea progetto dalle sue email» se è una trattativa.',
        ]],
        ['auto', 'L\'elenco si aggiorna da solo se l\'ultima lettura ha più di un giorno; «Aggiorna dalla posta» lo fa subito.'],
      ] },
      { t: 'Biglietti da visita', b: [
        ['steps', [
          '«Leggi i biglietti»: trascina le foto ad Alma o premi «Scegli foto» / «Fotografa».',
          'Alma legge nome, azienda e recapiti; tu controlli e confermi. Niente si salva senza conferma.',
          '«Dal mio QR»: chi ha inquadrato il tuo biglietto e ti ha lasciato i contatti; «Conferma contatto» o «Salta».',
        ]],
      ] },
      { t: 'Il mio biglietto', b: [
        ['p', 'In «Il mio biglietto» hai il tuo biglietto digitale con QR: «A tutto schermo», «Scarica QR», «Copia link». In «Cosa mostra il biglietto» decidi se mostrare cellulare, telefono dell\'ufficio, LinkedIn, sede e se chiedere a chi lo apre di lasciarti i suoi contatti.'],
      ] },
    ],
  },

  // ── 10 ──────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'lead', n: 10, group: 'anagrafiche', title: 'Lead', page: '#/crm/lead', routes: ['#/crm/lead'],
    desc: 'Imbuto, colonne, riordino: quando un lead diventa cliente.',
    chapters: [
      { t: 'Cos\'è un lead', b: [
        ['p', 'Un lead è un\'**azienda con P. IVA che vorremmo come cliente** ma con cui non lavoriamo ancora. È lead anche l\'ente pubblico che ha una gara a cui partecipiamo.'],
        ['auto', 'Un lead diventa cliente alla sua prima commessa in BOSS: non c\'è un pulsante da premere. Nella scheda la casella «Diventa cliente» resta grigia per questo.'],
      ] },
      { t: 'La pagina Lead', b: [
        ['p', 'In alto l\'imbuto con le fasi «Da contattare», «Contattato», «Incontro fatto», «Opportunità aperta», ognuna con numero e valore. Sotto tre avvisi che si cliccano: «lead fermi da 90 giorni», «senza prossimo passo», «passi in ritardo».'],
        ['p', 'Filtri: ASA, owner, funzione, key account, «Fase», «Priorità». Viste: «Elenco», «Colonne», «Da riordinare». «Esporta» scarica l\'elenco.'],
        ['info', 'Se vedi pochi lead, guarda la barra «Stai vedendo solo…» e premi «Mostra tutto».'],
      ] },
      { t: 'Aggiungere un lead', b: [
        ['steps', [
          'Premi «Nuovo lead».',
          'Scrivi ragione sociale e P. IVA: il CRM cerca subito su ANAC e propone i dati.',
          'Se compare «Sembra già presente», premi «Usa questa scheda»: eviti un doppione.',
          'Scegli l\'owner (obbligatorio: è chi segue il lead) e l\'ASA, poi salva.',
        ]],
        ['info', 'Anche un «Interessa» sul Radar crea il lead da solo, se l\'ente non è ancora nel CRM.'],
      ] },
      { t: 'Portarlo avanti', b: [
        ['steps', [
          'Nella vista «Colonne» trascina la scheda nella fase giusta.',
          'Dai sempre un prossimo compito: nella scheda «Dai un compito», poi «Dai il compito».',
          'Se non è interessato, portalo su «Non interessato»: il CRM chiede il motivo e quando riprovare.',
        ]],
        ['bell', 'Quando un compito scade ricevi un avviso sulla campanella e sul telefono, una volta sola.'],
      ] },
      { t: 'Riordinare i lead fermi', b: [
        ['p', 'La vista «Da riordinare» raccoglie i lead fermi. Spunta quelli da sistemare e scegli «Assegna a…» (poi «Assegna») per passarli a un collega, oppure «Chiudi come non interessati» con motivo, nota e data per riprovare.'],
        ['who', 'Ognuno riordina i lead di cui è owner; la direzione tutti. «Importa» (da Zoho) è della direzione.'],
      ] },
    ],
  },

  // ── 11 ──────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'clienti', n: 11, group: 'anagrafiche', title: 'Clienti, fornitori, partner', page: '#/crm/clienti',
    routes: ['#/crm/clienti', '#/crm/fornitori', '#/crm/partner', '#/crm/tutte', '#/crm/doppioni'],
    desc: 'Le liste per tipo, i concorrenti, «Tutte le anagrafiche», i doppioni.',
    chapters: [
      { t: 'Clienti', b: [
        ['p', 'I riquadri in alto filtrano per tipo: «Enti pubblici», «Partecipate e consorzi», «Imprese», «Altri privati». Gli avvisi segnalano i clienti «senza prossimo passo», con «passi in ritardo» o «senza referente». Su ogni riga si chiama e si scrive con un clic.'],
        ['auto', 'Un lead diventa cliente da solo alla prima commessa in BOSS.'],
      ] },
      { t: 'Fornitori', b: [
        ['p', 'Stesso disegno dei clienti, con i riquadri per categoria (materie prime, subappalti, noli, servizi, professionisti…) e gli avvisi «senza categoria», «senza referente», «senza P. IVA».'],
        ['info', 'La qualifica dei fornitori e i documenti a scadenza arriveranno da Vittoria: nella scheda la tab «Qualifica e documenti» dice «in arrivo con l\'integrazione».'],
      ] },
      { t: 'Partner e concorrenti', b: [
        ['p', '«Partner e concorrenti» ha il selettore per passare da una lista all\'altra. Si filtra per «Categoria SOA», «Classifica» e «Solo valide»: utile per trovare con chi fare ATI.'],
        ['p', 'I concorrenti si aggiungono anche da «Concorrenza e gare» («Aggiungi») e dagli esiti delle gare.'],
      ] },
      { t: 'Tutte le anagrafiche', b: [
        ['p', '«Tutte le anagrafiche» mostra ogni azienda, filtrabile per «Ruolo». Il menu «…» della riga ha «Apri la scheda» e «Dai un compito». «Esporta» scarica l\'elenco.'],
      ] },
      { t: 'I doppioni', b: [
        ['p', 'Quando due schede sembrano la stessa azienda (o persona), in cima agli elenchi compare l\'avviso con «Controlla». Da qui si possono unire due aziende o due contatti doppi in una scheda sola.'],
        ['steps', [
          'Guarda la coppia: se sono diverse, «Non sono la stessa».',
          'Se sono la stessa, «Unisci…»: scegli dato per dato quale tenere; email, note e passi si spostano sulla scheda che resta.',
          'Se una delle due non è tua, «Chiedi all\'owner».',
        ]],
        ['who', 'Unisce chi è owner di tutte e due le schede, oppure la direzione.'],
      ] },
    ],
  },

  // ── 12 ──────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'scheda-azienda', n: 12, group: 'anagrafiche', title: 'La scheda dell\'azienda', page: '#/crm/tutte', routes: ['#/crm/scheda'],
    desc: 'Anagrafica, completezza, «Cerca su internet», «Collega a», «Trasforma in».',
    chapters: [
      { t: 'L\'intestazione', b: [
        ['p', 'In testa trovi nome, ruolo («Cliente dal…», «Lead · fase»), ASA, key account, owner, P. IVA e sede. I pulsanti: «Come si usa», «Chiama», «Email», «Sito», «Cerca su internet», «Dai un compito», «Condividi» e il menu «…».'],
        ['p', 'Un «!» rosso «Da completare» segna le aziende create al volo (da un contatto o da un\'email): completale.'],
        ['p', 'L\'anello di completezza dice la percentuale e cosa manca (P. IVA, PEC, indirizzo, telefono, email, sito, ATECO).'],
      ] },
      { t: 'Compiti e fase del lead', b: [
        ['p', 'Sotto l\'intestazione c\'è il «Prossimo compito» con «Fatto». Se non ce n\'è: «Nessun compito aperto». La tab «Compiti» li mostra tutti (aperti e fatti, tuoi o di tutti) e permette di modificarli o riaprirli.'],
        ['p', 'Per i lead c\'è la barra «Fase del lead»: clicca la fase a cui siete arrivati. L\'ultima casella, «Diventa cliente», succede da sola alla prima commessa in BOSS.'],
      ] },
      { t: 'Panoramica e anagrafica', b: [
        ['p', 'La «Panoramica» ha l\'anagrafica a sezioni: «Dati fiscali», «Sede», «Recapiti», «Attività». Ogni campo vuoto ha «+ Aggiungi».'],
        ['p', 'Il riquadro «Attestazione SOA» si riempie da ANAC con la P. IVA: organismo, scadenze, categorie. Se non coincide con quanto scritto a mano, scegli «Usa ANAC» o «Tieni le mie».'],
        ['p', 'Poi «Ultimi aggiornamenti» (email, incontri, note), «Storico» e a destra «Collegata a» e «Persone».'],
      ] },
      { t: 'Cerca su internet', b: [
        ['steps', [
          'Premi «Cerca su internet».',
          'Se Alma trova più aziende con quel nome, ti chiede «Di quale si tratta?».',
          'Spunta i dati trovati (ognuno con la sua fonte) e premi «Usa i … spuntati».',
        ]],
        ['info', 'Niente si salva da solo. I dati presi da internet hanno il bollino «da internet» finché qualcuno non li conferma («Confermali tutti»).'],
      ] },
      { t: 'Persone da aggiungere', b: [
        ['p', 'Nella tab «Contatti» (e accanto ai «Compiti») il riquadro «Persone da aggiungere» mostra chi lavora nell\'azienda ma non è nel CRM, da più fonti:'],
        ['steps', [
          '«La tua posta»: chi ti ha scritto da un indirizzo dell\'azienda (lo vedi solo tu).',
          '«Incontri»: chi era invitato alle riunioni con l\'azienda.',
          'Sito, LinkedIn e «Gare · RUP»: premi «Cerca su sito, LinkedIn e i RUP delle gare» e Alma li cerca su internet, con il link alla fonte.',
        ]],
        ['p', 'Su ogni persona premi «Aggiungi» (si apre il nuovo contatto già compilato) oppure «Ignora»: chi ignori non torna. Per aggiungere qualcuno a mano c\'è sempre «Nuovo contatto» nel riquadro «Persone».'],
        ['info', 'Senza il sito o un\'email dell\'azienda il CRM non può cercarla nella tua posta: aggiungili nell\'anagrafica.'],
      ] },
      { t: 'Condividere con un collega', b: [
        ['p', '«Condividi» (o «Condividi con un collega» dal menu «…») manda a uno o più colleghi un avviso con il link alla scheda e un tuo messaggio. Nella scheda, in «Ultimi aggiornamenti», vedi se l\'hanno aperta.'],
        ['info', 'Chi non vede il CRM è segnato con un «!»: toglilo dall\'elenco prima di condividere.'],
      ] },
      { t: 'Email, incontri, note', b: [
        ['p', '«Email»: le email non si collegano mai da sole. «Collega dalla casella» per sceglierle; il riquadro «email proposte da collegare» ti propone quelle che sembrano sue («Guarda», «Collega»).'],
        ['p', '«Incontri»: si collegano da soli da Outlook quando c\'è un contatto o il dominio dell\'azienda. Il «!» sulla tab segnala incontri senza note: «Scrivi la nota». «Programma» ne fissa uno nuovo.'],
        ['p', '«Note»: tipo (Nota, Telefonata, Riunione, Decisione), @menzioni per avvisare un collega, allegati, «Fissa in alto». Il filtro «Da dove vengono» mostra anche le note dei contatti e degli incontri.'],
        ['auto', 'Tutto quello che colleghi a un contatto (email, incontri, note) ricade anche sulla sua azienda.'],
      ] },
      { t: '«Collega a» e «Trasforma in»', b: [
        ['p', 'Dal menu «…» dell\'intestazione:'],
        ['steps', [
          '«Collega a…» quando l\'azienda è **anche** altro (es. cliente e anche partner): aggiunge un ruolo. Se c\'è già un\'altra scheda della stessa azienda, le unisce.',
          '«Trasforma in…» quando il ruolo era sbagliato: lo cambia, con una nota del perché.',
        ]],
        ['who', 'Un lead non diventa cliente a mano: solo la direzione può farlo, altrimenti succede alla prima commessa in BOSS.'],
      ] },
      { t: 'Key account e piano d\'azione', b: [
        ['p', '«Key account» (dal menu «…») segna i clienti chiave e il ritmo con cui sentirli: 30, 60, 90 giorni o altro. Quando il ritmo scade, il cliente compare in «Key account da sentire».'],
        ['p', 'La tab «Piano d\'azione» mostra i piani nati dal Radar per quest\'azienda e permette «Nuovo piano da un playbook…».'],
      ] },
      { t: 'Modificare o cancellare', b: [
        ['p', '«Modifica i dati» apre tutta l\'anagrafica: ragione sociale, P. IVA, owner (obbligatorio), funzione, ruoli, ASA, blocchi del lead e del fornitore, SOA, indirizzo, codici SDI/IPA/BOSS, stato.'],
        ['info', 'Se la P. IVA è già di un\'altra scheda, il CRM chiede «È la stessa azienda?» e propone di unirle.'],
        ['who', '«Cancella» è solo della direzione.'],
      ] },
    ],
  },

  // ── 13 ──────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'scheda-contatto', n: 13, group: 'anagrafiche', title: 'La scheda del contatto', page: '#/crm/contatti', routes: ['#/crm/contatti/'],
    desc: 'Recapiti, LinkedIn, dove lavora, cosa ricade sull\'azienda.',
    chapters: [
      { t: 'L\'intestazione', b: [
        ['p', 'Nome, qualifica e azienda, owner. La pillola «anche su …» ricorda che quello che colleghi al contatto ricade sulla sua azienda.'],
        ['p', 'Pulsanti: «Chiama», «Email», «Nuova nota», «Condividi» e LinkedIn: «Apri su LinkedIn» se c\'è, altrimenti «Trova su LinkedIn» (Alma propone i profili: «Guarda», «È questo»).'],
        ['p', 'L\'anello di completezza conta email, cellulare, qualifica, azienda, LinkedIn e lingua.'],
      ] },
      { t: 'Le tab', b: [
        ['p', '«Panoramica» (lavoro, recapiti, lingua, privacy, «Dove ha lavorato»), «Compiti», «Email», «Incontri», «Note», «Progetti». Funzionano come nella scheda dell\'azienda; per dare un compito su un contatto, collegalo prima a un\'azienda.'],
      ] },
      { t: 'Dove lavora', b: [
        ['p', 'In «Modifica» puoi indicare più aziende in «Dove lavora», con la qualifica, quale è la principale e «fino al» quando ci ha lavorato. Chi cambia azienda resta nello storico della vecchia («Non ci lavorano più»).'],
      ] },
      { t: 'Privacy e cancellazione', b: [
        ['p', 'In «Modifica» ci sono la base giuridica e il «Consenso alle comunicazioni».'],
        ['who', '«Cancella» (menu «…») è di chi ha creato il contatto o della direzione.'],
      ] },
    ],
  },

  // ── 14 ──────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'alma', n: 14, group: 'strumenti', title: 'Alma nel CRM', page: '#/alma', routes: ['#/alma'],
    desc: 'Chiedere ad Alma; cosa prepara e cosa ti chiede di confermare.',
    chapters: [
      { t: 'Chiedere ad Alma', b: [
        ['p', 'Il tasto «Alma» in basso a destra c\'è su ogni pagina e sa dove sei («Stai guardando: …»). Scrivi o parla: Alma cerca nel CRM con i tuoi stessi permessi.'],
        ['steps', [
          'In una scheda: «Riassumi questa azienda», «Chi di noi la conosce meglio?».',
          'Altrove: «Cosa ho questa settimana nel CRM?», «Win ratio degli ultimi 12 mesi», «Segnali del radar in evidenza».',
          'Su come si usa il CRM: «Come trasformo un lead in cliente?». Alma risponde leggendo questi manuali.',
        ]],
      ] },
      { t: 'Cosa prepara, cosa conferma', b: [
        ['p', 'Alma può preparare note, prossimi passi, contatti, ticket ed email. Le proposte arancioni **restano da confermare**: «Conferma», «Conferma tutti» o «Annulla». Niente si salva senza il tuo sì.'],
        ['info', 'I campi letti male da una foto sono segnati «da controllare».'],
      ] },
      { t: 'Email preparate da Alma', b: [
        ['p', 'Le email che Alma prepara si inviano subito o si programmano («Invia ora», «Programma») e restano in «Email di Alma», col collegamento alla scheda CRM.'],
        ['info', 'Alma ha un budget giornaliero: l\'anello sul tasto dice quanto ne resta.'],
      ] },
    ],
  },

  // ── 15 ──────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'telefono', n: 15, group: 'strumenti', title: 'Il CRM sul telefono', page: '#/crm', routes: ['#/crm/persona'],
    desc: 'Chiamare, WhatsApp, scansionare un biglietto, il mio biglietto.',
    chapters: [
      { t: 'Trovare una persona', b: [
        ['p', 'Tocca «CRM» nella barra in basso. In alto c\'è la ricerca: scrivi un nome, un\'azienda o una P. IVA, oppure tocca il microfono e dillo.'],
        ['steps', [
          'Le pillole «Persone», «Aziende», «Lead», «I miei passi» cambiano l\'elenco.',
          'Tocca la persona: si apre la sua scheda.',
        ]],
        ['auto', 'Quello che scrivi dal telefono lo ritrovi uguale sul computer.'],
      ] },
      { t: 'Chiamare e scrivere', b: [
        ['p', 'Nella scheda della persona: «Chiama», «WhatsApp», «Email», «In rubrica» (la salva nei contatti del telefono). Poi «Nota», «Compito», «Incontro» e il «Prossimo compito» con «Fatto».'],
        ['p', '«Apri la scheda completa» porta alla scheda del computer.'],
      ] },
      { t: 'Il tasto +', b: [
        ['steps', [
          '«Contatto o lead»: nuova persona o azienda.',
          '«Scansiona biglietto»: fotografa uno o più biglietti (anche fronte e retro), scegli «Dove vi siete conosciuti?» e «Leggi con Alma».',
          '«Nota», scritta o a voce.',
          '«Compito»: con un contatto diventa un compito del CRM, altrimenti un ticket.',
        ]],
      ] },
      { t: 'Il mio biglietto', b: [
        ['p', '«Il mio biglietto» mostra il QR grande da far inquadrare (lo schermo resta acceso), con «Condividi» e «WhatsApp». Chi lo inquadra può lasciarti i suoi contatti: li confermi in «Biglietti da visita».'],
        ['info', 'Su Android puoi condividere una foto dalla galleria verso Alma Space: arriva direttamente nei biglietti da leggere.'],
      ] },
    ],
  },

  // ── 16 ──────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'impostazioni-crm', n: 16, group: 'strumenti', title: 'Impostazioni del CRM', page: '#/crm/impostazioni', routes: ['#/crm/impostazioni', '#/crm/asa'], dir: true,
    desc: 'Radar, punteggio, profili BU, fonti, ASA, Zoho.',
    chapters: [
      { t: 'Come funzionano', b: [
        ['who', 'Le «Impostazioni CRM» sono della direzione (menu «Direzione» del CRM, o Impostazioni › Moduli › Alma CRM).'],
        ['p', 'A sinistra le sezioni. Quando cambi qualcosa compare la barra «Modifiche non salvate» con «Annulla» e «Salva». Sotto ogni sezione «Modificato il … da …» e «Valori di partenza» per tornare indietro.'],
      ] },
      { t: 'Radar e punteggio', b: [
        ['steps', [
          '«Radar»: quali BU sono accese, responsabile, quota di spesa per BU, budget mensile, ora del giro notturno, persone dell\'ufficio gare. «Avvia adesso» fa partire un giro subito.',
          '«Punteggio»: i pesi di Coerenza, Concretezza, Tempi, Rapporto, Valore (devono fare 100), la soglia «In evidenza da» e il «Punteggio minimo». «Esempio dal vivo» mostra l\'effetto.',
          '«Primo passo»: se prepararlo, se scrivere l\'email con l\'AI, tono, giorni e firma.',
        ]],
        ['bell', 'Quando una BU finisce la quota, la direzione riceve un avviso con «Aumenta di 10 €» o «Lascia così».'],
      ] },
      { t: 'Profili BU, fonti, playbook', b: [
        ['steps', [
          '«Profili BU»: per ogni BU cosa fa, parole da cercare ed escludere, lavori tipici, SOA, zone, fascia d\'importo. È quello che il radar legge per capire cosa cercare.',
          '«Fonti»: accendere o spegnere una fonte, aggiungerne una, come si legge l\'export di Infordat.',
          '«Playbook»: i passi in ordine che il CRM propone dopo un «Interessa», per tipo di segnale e BU.',
        ]],
      ] },
      { t: 'Relazioni, esiti, regole', b: [
        ['steps', [
          '«Relazioni»: punti per incontri, email, commesse e key account; soglie «forte» e «medio»; dopo quanto si raffredda.',
          '«Esiti»: motivi di sconfitta, dopo quanti giorni avvisare se manca l\'esito, quanti esiti servono per la probabilità.',
          '«Prima del bando»: secondo giro del radar, gare vinte da altri, OpenCUP, TED, programmi triennali.',
          '«Regole e tempi»: entro quante ore la nota dell\'incontro, ritmo dei key account, motivi di scarto e di perdita.',
        ]],
      ] },
      { t: 'Concorrenza e SOA', b: [
        ['p', '«Concorrenza»: quanti mesi di ANAC caricare, importo minimo, categorie in più, **P. IVA e nomi di Almacis** (servono a riconoscere le nostre gare), codici CPV delle BU di servizi.'],
        ['p', '«SOA delle aziende»: le schede in cui le SOA scritte a mano non coincidono con ANAC; «Usa ANAC per tutte».'],
      ] },
      { t: 'ASA e accessi', b: [
        ['p', 'Una scheda per ASA con le persone: × per toglierle, «+ persona» per aggiungerle, «Nuova ASA». L\'ASA decide chi riceve segnali e promemoria e qual è il filtro di partenza: non nasconde le anagrafiche.'],
        ['auto', 'I membri di Alma Energy fanno parte da soli dell\'ASA Energy.'],
      ] },
      { t: 'Caricamento da Zoho', b: [
        ['steps', [
          'Scegli il tipo di export: Aziende, Contatti o Commesse.',
          'Carica il file e guarda l\'anteprima in «Controlla».',
          '«Carica»: le schede già presenti non si toccano.',
        ]],
        ['auto', 'Il caricamento «Commesse» fa diventare clienti i committenti.'],
      ] },
    ],
  },
  // ── 17 · Alma Impianti (ALM2-73) ────────────────────────────────────────────────────────────────
  {
    id: 'impianti', n: 17, group: 'lavoro', title: 'Alma Impianti', page: '#/impianti/home', routes: ['#/impianti'],
    desc: 'La BU Impianti: Home, chi chiamare e chi non ha risposto, radar per settore, opportunità col triangolo, fondi, energivori, progettisti.',
    chapters: [
      { t: 'Cos\'è Alma Impianti', b: [
        ['p', 'Alma Impianti è il modulo della BU Impianti (depurazione, fotovoltaico, biometano, impianti in edilizia, efficientamento). Si apre dal selettore dei moduli in cima alla barra laterale. Aziende, contatti, compiti e radar sono **gli stessi del CRM**: quello che fai qui lo vede tutta l\'azienda.'],
        ['info', 'I fondi e le aziende energivore sono clienti con un tipo: «Fondo o investitore» e «Azienda energivora». Si sceglie nella scheda dell\'azienda, nel tipo di cliente.'],
      ] },
      { t: 'Da fare: chi chiamare, chi non ha risposto', b: [
        ['p', 'Quattro gruppi: «In attesa di risposta» (email mandate a persone del CRM senza risposta da 5 giorni lavorativi), «Da chiamare oggi», «Compiti in ritardo» e «Da risentire» (fondi, progettisti e clienti con un\'opportunità aperta che non senti da più della cadenza).'],
        ['steps', [
          'Tocca un gruppo per vedere le sue righe.',
          '«Chiama» e «Scrivi» aprono il telefono e la posta; «Riscrivi» apre l\'email in Outlook.',
          '«Lascia stare» toglie un\'email dall\'elenco per sempre; «Fatto» e «Sposta» chiudono o rimandano un compito.',
        ]],
        ['auto', 'Lo stato del contatto cambia da solo: email inviata → «contattato», nessuna risposta → «in attesa», risposta → «ha risposto», incontro in calendario → «incontro fatto».'],
        ['who', 'Le cadenze («Ogni quanto sentirli») le cambia la direzione con «Cambia».'],
      ] },
      { t: 'Il radar per settore', b: [
        ['p', 'È il Radar del CRM con solo le opportunità della BU Impianti e le pillole dei cinque settori. Ogni notte, se il radar della BU è acceso, fa un giro in più per ogni settore: incentivi e graduatorie, autorizzazioni, piani d\'investimento, gare vinte da altri.'],
        ['info', '«I miei filtri» qui sono separati da quelli del Radar del CRM; tra gli importi c\'è «oltre 2 M€».'],
      ] },
      { t: 'Fondi e investitori', b: [
        ['steps', [
          '«Nuovo fondo» lo aggiunge al CRM come lead col tipo «Fondo o investitore».',
          '«Compila il mandato»: settori, ticket per progetto, regioni, fase, se cerca un EPC e chi lo segue (Alma Impianti, Alma Energy o tutte e due).',
          'In «Progetti che combaciano» trovi le opportunità del radar adatte al fondo: «Apri» per guardarle e proporgliele.',
        ]],
        ['auto', 'Gli abbinamenti si rifanno da soli a ogni opportunità nuova del radar.'],
      ] },
      { t: 'Home', b: [
        ['p', 'La Home di Alma Impianti mostra un riquadro per ogni settore (valore delle opportunità aperte, segnali nuovi della settimana, quante sono oltre 2 M€), le opportunità a cui manca un pezzo, i segnali caldi, i fondi da risentire e il dare e avere coi progettisti.'],
      ] },
      { t: 'Opportunità: chi paga, chi progetta, dove si fa', b: [
        ['p', 'Le opportunità sono i segnali del radar con «Interessa» o già su BOSS. Ognuna ha la sua fase (Origination, Fattibilità, Offerta EPC, Negoziazione, Firmato, o Persa) e tre caselle: **chi finanzia**, **chi progetta**, **dove si fa**.'],
        ['steps', [
          'Apri un\'opportunità da «Opportunità» o dalla Home.',
          'Tocca la fase giusta nella barra in alto per spostarla.',
          'Dove manca un pezzo trovi le proposte: i fondi col mandato che combacia, i progettisti da ANAC (stessa opera o stesso ente) e quelli del CRM. «Scegli» per collegarli, oppure «Cerca nel CRM».',
        ]],
        ['auto', 'Chi scegli come finanziatore diventa del tipo «Fondo o investitore»; chi progetta prende il ruolo «Progettista».'],
        ['info', 'Le offerte e i margini restano in BOSS.'],
      ] },
      { t: 'Energivori', b: [
        ['steps', [
          '«Carica l\'elenco»: un Excel o CSV con ragione sociale, partita IVA, comune, provincia, settore, consumo e tetto (per esempio l\'elenco delle imprese energivore della CSEA). Prima vedi l\'anteprima, poi «Carica».',
          'Filtra per regione (anche toccando la mappa), tetto oltre 5.000 m² o «Solo chi non è nel CRM».',
          '«Porta nel radar»: l\'azienda entra nel CRM come lead col tipo «Azienda energivora» e nasce un\'opportunità nel settore Efficientamento.',
        ]],
        ['info', 'Punteggio e risparmio sono stime per scegliere chi chiamare prima («Come si calcola»): i numeri veri vengono dalla diagnosi energetica.'],
      ] },
      { t: 'Progettisti: dare e avere', b: [
        ['p', 'Per ogni progettista del CRM vedi quanti lavori ci ha portato e quanti gliene abbiamo portati. Gli avvisi in alto filtrano chi è «da ricambiare», «fermo», «da conoscere» o ha un «rapporto forte».'],
        ['steps', [
          'Scegli un progettista nell\'elenco.',
          '«Registra uno scambio»: chi l\'ha portato, cosa e quando.',
          '«Nuovo compito» per fissare il prossimo contatto.',
        ]],
      ] },
    ],
  },
];

// ── ricerca (pagina «Cerca nei manuali» e Alma) ─────────────────────────────────────────────────────
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[«»*]/g, '').replace(/\s+/g, ' ').trim();
const blockText = b => (Array.isArray(b[1]) ? b[1].join(' ') : String(b[1] || ''));
const chapterText = c => c.b.map(blockText).join(' ');
const plain = s => String(s || '').replace(/\*\*/g, '');

// Parole troppo comuni non contano; un capitolo vale di più se la parola è nel titolo.
const STOP = new Set('il lo la i gli le un una uno di a da in con su per tra fra e o che come cosa si mi ti ci non del della dei delle al alla ai alle nel nella è'.split(' '));
function search(query, { limit = 12 } = {}) {
  const q = norm(query);
  // radice grossolana: «aziende» trova «azienda», «trasformo» trova «trasforma»
  const words = q.split(' ').filter(w => w.length > 1 && !STOP.has(w)).map(w => (w.length > 5 ? w.slice(0, -2) : w));
  if (!words.length) return [];
  const out = [];
  for (const m of MANUALS) {
    m.chapters.forEach((c, i) => {
      const title = norm(`${m.title} ${c.t}`), body = norm(chapterText(c));
      let score = 0;
      for (const w of words) {
        if (title.includes(w)) score += 3;
        if (body.includes(w)) score += 1;
      }
      if (body.includes(q) || title.includes(q)) score += 4;
      if (!score || score < words.length) return;
      out.push({ manual: m.id, n: m.n, title: m.title, chapter: i + 1, chapter_title: c.t, score, text: plain(chapterText(c)) });
    });
  }
  return out.sort((a, b) => b.score - a.score || a.n - b.n).slice(0, limit);
}

const minutes = m => Math.max(1, Math.round(m.chapters.reduce((s, c) => s + chapterText(c).split(/\s+/).length, 0) / 130));
const catalog = () => ({ updated: UPDATED, groups: GROUPS.map(([id, name]) => ({ id, name })),
  manuals: MANUALS.map(m => ({ ...m, minutes: minutes(m) })) });

module.exports = { MANUALS, GROUPS, UPDATED, catalog, search };
