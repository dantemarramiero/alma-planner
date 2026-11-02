// Alma Energy: regioni e province italiane con il codice ISO 3166-2 che OpenStreetMap mette sui confini
// (ALM2-23). Servono ai filtri di kanban e mappa e allo screening per provincia. La Valle d'Aosta non ha province:
// si cerca sulla regione.
const REGIONS = [
  ['Piemonte', 'IT-21', [['TO', 'Torino'], ['VC', 'Vercelli'], ['NO', 'Novara'], ['CN', 'Cuneo'], ['AT', 'Asti'], ['AL', 'Alessandria'], ['BI', 'Biella'], ['VB', 'Verbano-Cusio-Ossola']]],
  ["Valle d'Aosta", 'IT-23', [['AO', 'Aosta']]],
  ['Lombardia', 'IT-25', [['VA', 'Varese'], ['CO', 'Como'], ['SO', 'Sondrio'], ['MI', 'Milano'], ['BG', 'Bergamo'], ['BS', 'Brescia'], ['PV', 'Pavia'], ['CR', 'Cremona'],
    ['MN', 'Mantova'], ['LC', 'Lecco'], ['LO', 'Lodi'], ['MB', 'Monza e Brianza']]],
  ['Trentino-Alto Adige', 'IT-32', [['BZ', 'Bolzano'], ['TN', 'Trento']]],
  ['Veneto', 'IT-34', [['VR', 'Verona'], ['VI', 'Vicenza'], ['BL', 'Belluno'], ['TV', 'Treviso'], ['VE', 'Venezia'], ['PD', 'Padova'], ['RO', 'Rovigo']]],
  ['Friuli-Venezia Giulia', 'IT-36', [['UD', 'Udine'], ['GO', 'Gorizia'], ['TS', 'Trieste'], ['PN', 'Pordenone']]],
  ['Liguria', 'IT-42', [['IM', 'Imperia'], ['SV', 'Savona'], ['GE', 'Genova'], ['SP', 'La Spezia']]],
  ['Emilia-Romagna', 'IT-45', [['PC', 'Piacenza'], ['PR', 'Parma'], ['RE', 'Reggio Emilia'], ['MO', 'Modena'], ['BO', 'Bologna'], ['FE', 'Ferrara'], ['RA', 'Ravenna'],
    ['FC', 'Forlì-Cesena'], ['RN', 'Rimini']]],
  ['Toscana', 'IT-52', [['MS', 'Massa-Carrara'], ['LU', 'Lucca'], ['PT', 'Pistoia'], ['FI', 'Firenze'], ['LI', 'Livorno'], ['PI', 'Pisa'], ['AR', 'Arezzo'], ['SI', 'Siena'],
    ['GR', 'Grosseto'], ['PO', 'Prato']]],
  ['Umbria', 'IT-55', [['PG', 'Perugia'], ['TR', 'Terni']]],
  ['Marche', 'IT-57', [['PU', 'Pesaro e Urbino'], ['AN', 'Ancona'], ['MC', 'Macerata'], ['AP', 'Ascoli Piceno'], ['FM', 'Fermo']]],
  ['Lazio', 'IT-62', [['VT', 'Viterbo'], ['RI', 'Rieti'], ['RM', 'Roma'], ['LT', 'Latina'], ['FR', 'Frosinone']]],
  ['Abruzzo', 'IT-65', [['AQ', "L'Aquila"], ['TE', 'Teramo'], ['PE', 'Pescara'], ['CH', 'Chieti']]],
  ['Molise', 'IT-67', [['CB', 'Campobasso'], ['IS', 'Isernia']]],
  ['Campania', 'IT-72', [['CE', 'Caserta'], ['BN', 'Benevento'], ['NA', 'Napoli'], ['AV', 'Avellino'], ['SA', 'Salerno']]],
  ['Puglia', 'IT-75', [['FG', 'Foggia'], ['BA', 'Bari'], ['TA', 'Taranto'], ['BR', 'Brindisi'], ['LE', 'Lecce'], ['BT', 'Barletta-Andria-Trani']]],
  ['Basilicata', 'IT-77', [['PZ', 'Potenza'], ['MT', 'Matera']]],
  ['Calabria', 'IT-78', [['CS', 'Cosenza'], ['CZ', 'Catanzaro'], ['RC', 'Reggio Calabria'], ['KR', 'Crotone'], ['VV', 'Vibo Valentia']]],
  ['Sicilia', 'IT-82', [['TP', 'Trapani'], ['PA', 'Palermo'], ['ME', 'Messina'], ['AG', 'Agrigento'], ['CL', 'Caltanissetta'], ['EN', 'Enna'], ['CT', 'Catania'],
    ['RG', 'Ragusa'], ['SR', 'Siracusa']]],
  ['Sardegna', 'IT-88', [['SS', 'Sassari'], ['NU', 'Nuoro'], ['CA', 'Cagliari'], ['OR', 'Oristano'], ['OT', 'Gallura Nord-Est Sardegna'], ['OG', 'Ogliastra'],
    ['SU', 'Sulcis Iglesiente'], ['VS', 'Medio Campidano']]],
].map(([name, iso, provinces]) => ({ name, iso, provinces: provinces.map(([code, pname]) => ({ code, name: pname, iso: code === 'AO' ? iso : `IT-${code}` })) }));

const PROVINCES = new Map(REGIONS.flatMap(r => r.provinces.map(p => [p.code, { ...p, region: r.name }])));

module.exports = { REGIONS, PROVINCES };
