// CRM: classificazione delle aziende esportate da Zoho (Almacis) per il primo caricamento (richiesta di Dante del 13/11).
// Dal nome, dalla «Tipologia» di Zoho e da chi le ha caricate propone tipo di soggetto, ruolo, ASA, sicurezza e motivo.
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const has = (re, s) => re.test(s);

// words = parole intere (sigle corte), stems = inizio di parola (costruzion → costruzioni, costruzione…)
const mk = (words, stems = []) => new RegExp(`\\b(?:${[...words.map(w => `${w}\\b`), ...stems].join('|')})`);
const RE = {
  interna: mk(['almacis', 'alma c i s', 'alma cis', 'boss s r l']),
  segnaposto: /\btest\b|^(nd|n d|non disponibile|dato non ancora disponibile|gara privato non comunicato|privato|da definire|test|prova|x|the next standard in)$/,
  pubblico: mk(['comune', 'comuni', 'com', 'min', 'asp', 'aulss', 'univ', 'asi', 'invitalia', 'asl', 'asst', 'ulss', 'usl', 'aou', 'irccs', 'cuc', 'c u c', 'sua', 's u a', 'mic', 'mit', 'inail', 'inps', 'infn', 'usr', 'usrc', 'arpa', 'ater', 'cnr', 'enea', 'cineca', 'edisu', 'ipab', 'corte', 'parco'],
    ['provinc', 'region', 'minister', 'universit', 'ateneo', 'azienda ospedal', 'ospedal', 'policlinic', 'centrale unica', 'stazione appaltante', 'consorzio di bonifica', 'bonifica', 'autorita',
      'provveditorat', 'segretariat', 'soprintendenz', 'direzione regional', 'direzionale regional', 'muse', 'istitut', 'agenzia del', 'agenzia regional', 'agenzia nazional', 'commissari', 'ufficio special',
      'prefettur', 'camera di commercio', 'capitaneri', 'genio civile', 'banca d italia', 'vigili del fuoco', 'polizi', 'carabinier', 'esercit', 'marina militare', 'aeronautic', 'difesa', 'demani',
      'unione montan', 'unione dei comuni', 'unione di comuni', 'comunita montan', 'galleri', 'uffizi', 'tribunal', 'questur', 'cratere', 'ricostruzion', 'azienda regional', 'diritto allo studio',
      'scuol', 'lice', 'fondazione', 'consorzio per l area di sviluppo', 'area di sviluppo industrial']),
  citta: /^[a-z' ]+ [a-z]{2}$/, // «Pescara (PE)» dopo norm(): un comune scritto con la sigla
  partecipata: mk(['gas', 'reti', 'r f i', 'trenitalia', 'uniacque', 'hera', 'acea', 'a2a', 'iren', 'enel', 'terna', 'snam', 'anas', 'rfi', 'amag', 'aca', 'sasi', 'ruzzo', 'tws', 'aisa', 'agesp', 'aset', 'etra', 'gaia', 'talete', 'ciip', 'tua', 'poste', 'rai', 'tper', 'atac', 'gtt', 'expo', 'asa', 's a g a', 'saga'],
    ['acqua', 'acque', 'acquedott', 'idric', 'gasdott', 'italgas', 'iretegas', 'ambiente', 'ambiental', 'ferrovi', 'autostrad', 'autostazion', 'aeroport', 'portual', 'port utilities', 'utilities', 'metropolitan',
      'multiservizi', 'igiene urban', 'rifiuti', 'retiambiente', 'abbanoa', 'acqualatina', 'sport e salute', 'trasporto pubblic', 'trasporto', 'mobilita', 'distribuzione', 'ciclo idrico', 'cicli integrati',
      'servizio idric', 'centro agroalimentar', 'agroalimentar', 'giubileo', 'innovapuglia', 'valle umbra servizi', 'servizi pubblic']),
  condominio: mk([], ['condomini', 'aggregato', 'supercondomini']),
  professionista: new RegExp(`^(arch|ing|geom|dott|avv|per ind|p i)\\b|${mk([], ['studio tecnic', 'studio associat', 'studio legal', 'studio di ingegneria', 'studio di architettura', 'studio ', 'architett', 'ingegner', 'progettazion', 'progetti', 'engineering', 'geolog', 'idrostudi']).source}`),
  edile: mk(['rti', 'ati', 'coop', 'edil'], ['costruzion', 'costruttor', 'edil', 'impres', 'appalt', 'lavori', 'scavi', 'cantier', 'infrastruttur', 'restaur', 'consorzio stabil', 'cooperativ', 'general contractor',
    'mandatari', 'mandant', 'strade', 'stradal', 'asfalt', 'demolizion', 'movimento terra', 'condotte', 'immobiliar']),
  rti: mk(['rti', 'r t i', 'ati', 'a t i'], ['mandatari', 'mandant', 'raggruppament']),
  assicurazione: mk(['generali', 'unipol', 'allianz', 'axa'], ['assicura', 'insurance', 'riassicura', 'fideiuss', 'broker', 'cauzion']),
  fornitoreServizi: mk(['nolo'], ['noleggi', 'logistic', 'fornitur', 'material', 'ferrament', 'calcestruzz', 'inert', 'laterizi', 'software', 'informatic', 'consulting', 'consulenz', 'pulizi', 'formazion',
    'laborator', 'prove material', 'rilievi', 'topograf', 'vigilanz', 'carburant', 'contrattipubblici', 'talentia']),
  energia: mk(['esco', 'energy', 'res'], ['energi', 'solar', 'solare', 'fotovoltaic', 'efficientament', 'termic', 'rinnovabil', 'idrogen', 'biogas', 'eolic', 'bluenergy', 'edison']),
  restauro: mk(['mic'], ['restaur', 'muse', 'soprintendenz', 'beni cultural', 'galleri', 'uffizi', 'segretariato regional', 'chies', 'dioces', 'basilic', 'archeolog']),
  reti: mk(['gas', 'reti'], ['acqua', 'acque', 'acquedott', 'idric', 'gasdott', 'fognatur', 'depurazion', 'bonifica', 'irrigazion', 'italgas', 'iretegas', 'snam', 'condotte', 'distribuzione']),
  facility: mk([], ['manutenzion', 'facility', 'global service', 'gestione immobil', 'jones lang', 'pulizi']),
  persona: /^[A-Z][a-zà-ù']+ [A-Z][a-zà-ù']+( [A-Z][a-zà-ù']+)?$/,
  societa: /\b(s r l|srl|s p a|spa|s n c|snc|s a s|sas|srls|s r l s|scarl|s c a r l|coop|onlus|consorzio|group|gruppo|ltd|gmbh|inc|sa)\b/,
};

function classify(r) {
  const name = String(r.name || '').trim();
  const n = norm(name);
  const tip = String(r.tipologia || '').toLowerCase();
  const out = { kind: 'impresa', roles: [], asa: [], conf: 'bassa', why: [] };
  if (!name) return { skip: 'senza nome' };
  if (has(RE.interna, n)) return { skip: 'azienda del gruppo Almacis' };
  if (RE.segnaposto.test(n) || n.length < 2) return { skip: 'nome segnaposto (non è un\'azienda)' };

  // 1) la Tipologia scritta in Zoho vince
  if (tip) {
    const add = role => { if (!out.roles.includes(role)) out.roles.push(role); };
    if (/cliente/.test(tip)) add('cliente');
    if (/partner/.test(tip)) add('partner');
    if (/concorrente/.test(tip)) add('concorrente');
    if (/fornitor|consulen|progettazion/.test(tip)) add('fornitore');
    if (/start up/.test(tip) && !out.roles.length) add('partner');
    if (out.roles.length) { out.conf = 'alta'; out.why.push(`Tipologia in Zoho: ${r.tipologia}`); }
    if (/consulen|progettazion/.test(tip)) out.kind = 'professionista';
    if (/start up/.test(tip)) out.why.push('start up: partner di innovazione');
  }

  // 2) dal nome
  if (has(RE.condominio, n)) { out.kind = 'condominio'; if (!out.roles.length) { out.roles.push('lead'); out.conf = 'media'; out.why.push('condominio: committente privato da conquistare'); } }
  else if (has(RE.pubblico, n) || (RE.citta.test(n) && /([A-Z]{2})/.test(name))) { out.kind = 'ente_pubblico'; if (!out.roles.length) { out.roles.push('lead'); out.conf = 'alta'; out.why.push('ente pubblico / stazione appaltante: lead (decisione 12/11: chi pubblica gare a cui partecipiamo è già lead)'); } }
  else if (has(RE.partecipata, n) && !has(RE.edile, n)) { out.kind = 'partecipata'; if (!out.roles.length) { out.roles.push('lead'); out.conf = 'media'; out.why.push('società di servizi pubblici / partecipata: committente'); } }
  else if (has(RE.assicurazione, n)) { if (!out.roles.length) { out.roles.push('fornitore'); out.conf = 'media'; out.why.push('assicurazione: fornitore di servizi (polizze, cauzioni)'); } out.categories = ['servizi_generali']; }
  else if (has(RE.professionista, n)) { out.kind = 'professionista'; if (!out.roles.length) { out.roles.push('fornitore'); out.conf = 'media'; out.why.push('professionista / studio tecnico: fornitore (progettazione)'); } out.categories = ['professionisti']; }
  else if (has(RE.edile, n)) {
    if (!out.roles.length) {
      if (has(RE.rti, n) || r.owner === 'Super Admin') { out.roles.push('concorrente'); out.conf = 'media'; out.why.push(has(RE.rti, n) ? 'RTI / mandataria: aggiudicatario di gara, concorrente' : 'impresa edile caricata dalle gare: concorrente'); }
      else { out.roles.push('partner'); out.conf = 'bassa'; out.why.push('impresa edile seguita dal commerciale: partner o subappaltatore, da verificare'); }
    }
  } else if (has(RE.fornitoreServizi, n)) { if (!out.roles.length) { out.roles.push('fornitore'); out.conf = 'bassa'; out.why.push('nome da fornitore di beni o servizi'); } }
  else if (RE.persona.test(name) && !has(RE.societa, n)) { out.kind = 'altro'; if (!out.roles.length) { out.roles.push('lead'); out.conf = 'bassa'; out.why.push('sembra una persona: committente privato'); } }
  if (!out.roles.length) { out.roles.push('lead'); out.why.push(r.owner === 'Super Admin' ? 'caricata dalle gare, senza altri indizi' : 'azienda seguita dal commerciale, senza altri indizi: lead da qualificare'); }

  // ASA proposte dal nome (da controllare)
  if (has(RE.restauro, n)) out.asa.push('restauro');
  if (has(RE.reti, n)) out.asa.push(/\bgas\b|gasdott|italgas|snam/.test(n) ? 'reti_mp_bp' : 'reti_ap');
  if (has(RE.energia, n)) out.asa.push('esco');
  if (has(RE.facility, n)) out.asa.push('facility');
  if (has(RE.professionista, n)) out.asa.push('progettazione');
  if (!out.asa.length && ['ente_pubblico', 'condominio'].includes(out.kind)) out.asa.push('edilizia');
  if (!out.asa.length && has(RE.edile, n)) out.asa.push('edilizia');
  if (!out.asa.length) out.asa.push('altri_servizi');
  return out;
}

module.exports = { classify, norm };
