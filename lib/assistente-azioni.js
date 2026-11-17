// Azioni di Alma (porting delle azioni di Bacco): ticket, nota CRM, prossimo passo CRM, contatto CRM.
// Flusso: Alma raccoglie i dati → preview() li controlla leggendo Alma Planet (persone, progetti, schede, doppioni) e
// prepara la scheda arancione → chi chiede preme «Conferma» (o risponde «sì») → execute() scrive con le API di sempre,
// con la sessione di chi conferma. Niente cancellazioni; unica eccezione: «Annulla» entro 10 minuti toglie quello che
// Alma ha appena salvato (result.undo, lib/assistente-bozze.js).
// preview(input, get, ctx) → { title, fields: [[etichetta, valore]], warnings: [], data } (data = quanto serve a execute)
//   oppure lancia un Error col motivo, che torna ad Alma perché chieda o corregga; un Error con .choices diventa la
//   scelta «Quale …?» nella scheda (Alma non sceglie mai da sola tra due persone o due aziende con lo stesso nome).
// execute(data, call) → { message, link, undo }.
const { norm, today } = require('./assistente-strumenti');
const EMAIL = require('./assistente-email');

const S = (type, description, extra = {}) => ({ type, description, ...extra });
const O = (type, description, extra = {}) => ({ type, description, ...extra, optional: true });
const schema = props => ({ type: 'object', additionalProperties: false,
  properties: Object.fromEntries(Object.entries(props).map(([k, { optional, ...v }]) => [k, v])),
  required: Object.keys(props).filter(k => !props[k].optional) });
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const itDate = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
const CONTACT_TITLES = ['Ing.', 'Arch.', 'Geom.', 'Dott.', 'Dott.ssa', 'Avv.', 'Per. Ind.', 'Rag.', 'Prof.', 'Sig.', 'Sig.ra'];
const SUBJECT_KINDS = ['impresa', 'ente_pubblico', 'partecipata', 'consorzio', 'professionista', 'altro'];
const PRIORITY = { bassa: 'low', normale: 'normal', alta: 'high', urgente: 'urgent' };
const NOTE_KINDS = { nota: 'Nota', telefonata: 'Telefonata', riunione: 'Riunione', decisione: 'Decisione' };
const CHANNELS = { telefonata: 'Telefonata', email: 'Email', incontro: 'Incontro', sopralluogo: 'Sopralluogo', altro: 'Altro' };
const dateOf = (v, label, { required = false } = {}) => {
  if (v == null || v === '') { if (required) throw new Error(`Serve ${label} (AAAA-MM-GG).`); return null; }
  if (!ISO.test(String(v))) throw new Error(`${label} deve essere AAAA-MM-GG.`);
  return String(v);
};

function choice(question, options) {
  const e = new Error(`${question} ${options.map((o, i) => `${i + 1}) ${o.label}${o.sub ? ` (${o.sub})` : ''}`).join('; ')}. Chiedi quale: non scegliere tu.`);
  e.choices = { question, options };
  return e;
}

// Persone dai nomi detti («io», «Simone», «Recchia»): una sola → quella; più persone → «Quale?»; nessuna → errore.
async function peopleOf(names, get, ctx, field = 'assegnati', single = false) {
  const list = await get('/api/users');
  const out = [];
  for (const raw of names || []) {
    const n = norm(raw);
    if (!n) continue;
    if (['io', 'me', 'a me', 'mio', 'mia'].includes(n)) { out.push({ id: ctx.me.id, name: ctx.me.name }); continue; }
    const exact = list.filter(u => norm(u.name) === n || norm(u.email) === n);
    const part = exact.length ? exact : list.filter(u => norm(u.name).split(' ').includes(n) || norm(u.name).includes(n));
    if (part.length === 1) { out.push({ id: part[0].id, name: part[0].name }); continue; }
    if (!part.length) throw new Error(`In Alma Planet non c'è nessuna persona «${raw}».`);
    throw choice(`Ci sono ${part.length} persone per «${raw}». Quale?`, part.slice(0, 6).map(u => ({
      label: u.name, sub: [u.job_title, u.email].filter(Boolean).join(' · '),
      input: { [field]: single ? u.email : (names || []).map(x => (x === raw ? u.email : x)) } })));
  }
  return [...new Map(out.map(p => [p.id, p])).values()];
}
async function projectOf(value, get) {
  const list = await get('/api/projects');
  const id = Number(value);
  if (Number.isInteger(id) && id > 0 && String(value).trim() === String(id)) {
    const p = list.find(x => x.id === id);
    if (p) return p;
    throw new Error('Il progetto scelto non c\'è più, o non lo vedi.');
  }
  const n = norm(value);
  const exact = list.filter(p => norm(p.name) === n);
  const part = exact.length ? exact : list.filter(p => norm(p.name).includes(n));
  if (part.length === 1) return part[0];
  if (!part.length) throw new Error(`Non trovo nessun progetto attivo «${value}» tra quelli che vedi.`);
  throw choice(`Ci sono ${part.length} progetti per «${value}». Quale?`, part.slice(0, 6).map(p => ({ label: p.name, sub: p.owner_name ? `responsabile ${p.owner_name}` : '', input: { progetto: String(p.id) } })));
}
async function subjectOf(value, get) {
  const id = Number(value);
  if (Number.isInteger(id) && id > 0 && String(value).trim() === String(id)) {
    const s = await get(`/api/crm/subjects/${id}`).catch(() => null);
    if (!s) throw new Error('La scheda CRM scelta non c\'è più.');
    return s;
  }
  const { subjects = [] } = await get(`/api/crm/subjects?q=${encodeURIComponent(String(value).slice(0, 100))}`);
  const n = norm(value);
  const exact = subjects.filter(s => norm(s.name) === n || norm(s.short_name) === n);
  const list = exact.length ? exact : subjects;
  if (list.length === 1) return list[0];
  if (!list.length) throw new Error(`Nel CRM non trovo «${value}».`);
  throw choice(`Nel CRM ci sono ${list.length} schede per «${value}». Quale?`, list.slice(0, 6).map(s => ({
    label: s.name, sub: [s.city, (s.roles || []).join(', '), s.owner_name].filter(Boolean).join(' · '), input: { azienda: String(s.id) } })));
}
const crmOnly = (req, deps) => deps.crmAccess.canUse(req);

// Destinatario di un'email: «c:ID», un id, o un nome (contatto; se è il nome di un'azienda, i suoi contatti con email).
// Più persone possibili → «Quale?»: la scelta sostituisce il destinatario di quella voce (n) con «c:ID».
async function emailContactOf(dest, get, list, n) {
  const pick = (people, question) => {
    throw choice(question, people.slice(0, 6).map(c => ({
      label: [c.title, c.first_name, c.last_name].filter(Boolean).join(' '),
      sub: [(c.links || []).map(l => l.name).filter(Boolean)[0], c.email || 'senza email'].filter(Boolean).join(' · '),
      input: { email: list.map((x, k) => (k === n ? { ...x, destinatario: `c:${c.id}` } : x)) } })));
  };
  const raw = dest.trim();
  const id = (/^c:(\d+)$/i.exec(raw) || /^(\d+)$/.exec(raw) || [])[1];
  if (id) {
    const c = await get(`/api/crm/contacts/${id}`).catch(() => null);
    if (!c) throw new Error(`Il contatto ${raw} non c'è nel CRM (o non lo vedi).`);
    return c;
  }
  const bare = norm(raw).replace(/^(ing|arch|geom|dott\.?ssa|dottoressa|dott|avv|sig\.?ra|sig|prof|per\.? ind|rag)\.?\s+/, '');
  if (!bare) throw new Error('Manca il destinatario.');
  const { contacts = [] } = await get(`/api/crm/contacts?q=${encodeURIComponent(bare.slice(0, 80))}`).catch(() => ({}));
  const full = c => [norm(`${c.first_name || ''} ${c.last_name}`), norm(`${c.last_name} ${c.first_name || ''}`), norm(c.last_name)];
  const exact = contacts.filter(c => full(c).includes(bare));
  const found = exact.length ? exact : contacts;
  if (found.length === 1) return get(`/api/crm/contacts/${found[0].id}`);
  if (found.length > 1) return pick(found, `Nel CRM ci sono ${found.length} persone per «${raw}». A chi scrivo?`);
  // forse è un'azienda: i suoi contatti
  const { subjects = [] } = await get(`/api/crm/subjects?q=${encodeURIComponent(bare.slice(0, 80))}`).catch(() => ({}));
  if (subjects.length === 1) {
    const s = await get(`/api/crm/subjects/${subjects[0].id}`);
    const people = (s.contacts || []).filter(c => !c.date_to && c.email).map(c => ({ ...c, links: [{ name: s.name }] }));
    if (people.length === 1) return get(`/api/crm/contacts/${people[0].id}`);
    if (people.length > 1) return pick(people, `In «${s.name}» ci sono ${people.length} contatti con email. A chi scrivo?`);
    throw new Error(`«${s.name}» non ha contatti con email nel CRM: prima aggiungi il contatto (anche da un biglietto da visita).`);
  }
  throw new Error(`Nel CRM non c'è «${raw}»: le email si mandano solo ai contatti del CRM. Prima va creato il contatto.`);
}

const ACTIONS = [
  {
    name: 'proponi_ticket',
    label: 'Nuovo ticket',
    icon: 'square-check',
    description: 'Prepara un ticket da confermare (non lo crea subito): titolo, a chi (nomi o «io»), progetto (nome), scadenza, priorità, dettagli. Se mancano titolo o a chi, chiedili prima.',
    input_schema: schema({
      titolo: S('string', 'Cosa fare, breve.'),
      assegnati: O('array', 'Nomi delle persone a cui assegnarlo (anche «io»).', { items: { type: 'string' } }),
      progetto: O('string', 'Nome del progetto.'),
      scadenza: O('string', 'Scadenza AAAA-MM-GG.'),
      inizio: O('string', 'Inizio AAAA-MM-GG.'),
      priorita: O('string', 'bassa, normale, alta o urgente.', { enum: ['bassa', 'normale', 'alta', 'urgente'] }),
      descrizione: O('string', 'Dettagli.'),
    }),
    async preview(i, get, ctx) {
      const title = String(i.titolo || '').trim().slice(0, 300);
      if (!title) throw new Error('Serve il titolo del ticket.');
      const people = await peopleOf(i.assegnati, get, ctx);
      const project = i.progetto ? await projectOf(i.progetto, get) : null;
      const due = dateOf(i.scadenza, 'la scadenza');
      const start = dateOf(i.inizio, 'l\'inizio');
      if (start && due && start > due) throw new Error('La scadenza è prima dell\'inizio.');
      const warnings = [];
      if (!people.length) warnings.push('Nessuno assegnato: il ticket resta senza assegnatario.');
      if (due && due < today()) warnings.push('La scadenza è già passata.');
      const priority = PRIORITY[i.priorita] || 'normal';
      return {
        title: `Nuovo ticket · ${title}`,
        fields: [['Ticket', title], ['A chi', people.map(p => p.name).join(', ') || '—'], ...(project ? [['Progetto', project.name]] : []),
          ...(start ? [['Inizio', itDate(start)]] : []), ['Scadenza', due ? itDate(due) : '—'], ['Priorità', i.priorita || 'normale'],
          ...(i.descrizione ? [['Dettagli', String(i.descrizione).slice(0, 2000)]] : [])],
        warnings,
        data: { title, description: i.descrizione ? String(i.descrizione).slice(0, 20000) : undefined, assignee_ids: people.map(p => p.id), project_id: project ? project.id : null,
          due_date: due, start_date: start, priority },
      };
    },
    async execute(d, call) {
      const t = await call('POST', '/api/tickets', d);
      return { message: `ticket «${t.title}» creato`, link: `#/tickets/${t.id}`, undo: { ticket_id: t.id } };
    },
    undo: (u, call) => call('DELETE', `/api/tickets/${Number(u.ticket_id)}`),
  },
  {
    name: 'proponi_nota_crm',
    label: 'Nota nel CRM',
    icon: 'file-text',
    allowed: crmOnly,
    description: 'Prepara una nota su un\'azienda o ente del CRM, da confermare: azienda (nome detto dall\'utente o id), testo, titolo, tipo (nota, telefonata, riunione, decisione), data.',
    input_schema: schema({
      azienda: S('string', 'Nome dell\'azienda come l\'ha detto l\'utente, oppure l\'id della scheda.'),
      testo: S('string', 'Il testo della nota.'),
      titolo: O('string', 'Titolo breve.'),
      tipo: O('string', 'nota (predefinito), telefonata, riunione o decisione.', { enum: Object.keys(NOTE_KINDS) }),
      data: O('string', 'Data AAAA-MM-GG (predefinita oggi).'),
    }),
    async preview(i, get) {
      const body = String(i.testo || '').trim().slice(0, 20000);
      if (!body) throw new Error('Serve il testo della nota.');
      const s = await subjectOf(i.azienda, get);
      const date = dateOf(i.data, 'la data') || today();
      const kind = NOTE_KINDS[i.tipo] ? i.tipo : 'nota';
      return {
        title: `Nota nel CRM · ${s.name}`,
        fields: [['Azienda', s.name], ['Tipo', NOTE_KINDS[kind]], ...(i.titolo ? [['Titolo', String(i.titolo).slice(0, 200)]] : []), ['Data', itDate(date)], ['Nota', body]],
        warnings: date > today() ? ['La data è nel futuro.'] : [],
        data: { subject_id: s.id, subject_name: s.name, kind, title: i.titolo ? String(i.titolo).slice(0, 200) : '', body, note_date: date },
      };
    },
    async execute(d, call) {
      const n = await call('POST', `/api/crm/subjects/${d.subject_id}/notes`, { kind: d.kind, title: d.title, body: d.body, note_date: d.note_date });
      return { message: `nota salvata su «${d.subject_name}»`, link: `#/crm/scheda/${d.subject_id}/note`, undo: { note_id: n.id } };
    },
    undo: (u, call) => call('DELETE', `/api/crm/notes/${Number(u.note_id)}`),
  },
  {
    name: 'proponi_passo',
    label: 'Prossimo passo CRM',
    icon: 'alarm-clock',
    allowed: crmOnly,
    description: 'Prepara un prossimo passo su un\'azienda del CRM, da confermare: azienda (nome o id), cosa fare, entro quando (obbligatorio), chi lo fa (nome o «io», predefinito l\'owner della scheda), canale.',
    input_schema: schema({
      azienda: S('string', 'Nome dell\'azienda come l\'ha detto l\'utente, oppure l\'id della scheda.'),
      cosa: S('string', 'Cosa fare.'),
      entro: S('string', 'Entro quando, AAAA-MM-GG.'),
      chi: O('string', 'Chi lo fa: nome o «io».'),
      canale: O('string', 'telefonata, email, incontro, sopralluogo o altro.', { enum: Object.keys(CHANNELS) }),
    }),
    async preview(i, get, ctx) {
      const title = String(i.cosa || '').trim().slice(0, 300);
      if (!title) throw new Error('Serve cosa fare.');
      const due = dateOf(i.entro, 'entro quando', { required: true });
      const s = await subjectOf(i.azienda, get);
      const who = i.chi ? (await peopleOf([i.chi], get, ctx, 'chi', true))[0] : null;
      return {
        title: `Prossimo passo · ${s.name}`,
        fields: [['Azienda', s.name], ['Cosa', title], ['Entro', itDate(due)], ['Chi', who ? who.name : (s.owner_name || 'owner della scheda')], ...(i.canale ? [['Canale', CHANNELS[i.canale]]] : [])],
        warnings: due < today() ? ['La data è già passata.'] : [],
        data: { subject_id: s.id, subject_name: s.name, title, due_date: due, ...(who ? { owner_id: who.id } : {}), ...(i.canale ? { channel: i.canale } : {}) },
      };
    },
    async execute(d, call) {
      const { subject_id: sid, subject_name: name, ...body } = d;
      const st = await call('POST', `/api/crm/subjects/${sid}/steps`, body);
      return { message: `passo «${d.title}» su «${name}» entro il ${itDate(d.due_date)}`, link: `#/crm/scheda/${sid}`, undo: { step_id: st.id } };
    },
    undo: (u, call) => call('DELETE', `/api/crm/steps/${Number(u.step_id)}`),
  },
  {
    name: 'proponi_contatto_crm',
    label: 'Nuovo contatto CRM',
    icon: 'user-plus',
    allowed: crmOnly,
    description: 'Prepara un nuovo contatto (persona) nel CRM, da confermare, collegato alla sua azienda: nome, cognome (obbligatorio), azienda (nome o id), qualifica, email, cellulare, telefono, titolo (Ing., Arch., Dott.…). Controlla i doppioni.',
    input_schema: schema({
      cognome: S('string', 'Cognome.'),
      nome: O('string', 'Nome.'),
      azienda: O('string', 'Azienda o ente a cui collegarlo (nome o id).'),
      qualifica: O('string', 'Ruolo nell\'azienda (es. RUP, Direttore tecnico).'),
      email: O('string', 'Email.'),
      cellulare: O('string', 'Cellulare.'),
      telefono: O('string', 'Telefono fisso.'),
      titolo: O('string', 'Titolo: Ing., Arch., Geom., Dott., Avv.…'),
    }),
    async preview(i, get, ctx) {
      const last = String(i.cognome || '').trim().slice(0, 120);
      if (!last) throw new Error('Serve il cognome.');
      const s = i.azienda ? await subjectOf(i.azienda, get) : null;
      if (!s && !ctx.admin) throw new Error('Serve l\'azienda a cui collegare il contatto (nel CRM ogni contatto sta nella sua azienda).');
      const email = i.email ? String(i.email).trim().toLowerCase() : '';
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('L\'email non è valida.');
      const warnings = [];
      const dup = await get(`/api/crm/contacts/check?email=${encodeURIComponent(email)}&last_name=${encodeURIComponent(last)}&first_name=${encodeURIComponent(i.nome || '')}&subject_id=${s ? s.id : 0}`).catch(() => ({ matches: [] }));
      for (const m of dup.matches || []) warnings.push(`C'è già ${[m.first_name, m.last_name].filter(Boolean).join(' ')}${m.email ? ` (${m.email})` : ''} nel CRM: controlla che non sia la stessa persona.`);
      const titles = ['Ing.', 'Arch.', 'Geom.', 'Dott.', 'Dott.ssa', 'Avv.', 'Per. Ind.', 'Rag.', 'Prof.', 'Sig.', 'Sig.ra'];
      const title = titles.find(t => norm(t).replace('.', '') === norm(i.titolo).replace('.', '')) || '';
      const full = [title, i.nome, last].filter(Boolean).join(' ');
      return {
        title: `Nuovo contatto · ${full}`,
        fields: [['Persona', full], ...(s ? [['Azienda', s.name]] : []), ...(i.qualifica ? [['Qualifica', i.qualifica]] : []), ...(email ? [['Email', email]] : []),
          ...(i.cellulare ? [['Cellulare', i.cellulare]] : []), ...(i.telefono ? [['Telefono', i.telefono]] : [])],
        warnings,
        data: { title, first_name: i.nome ? String(i.nome).slice(0, 120) : '', last_name: last, email: email || undefined, mobile: i.cellulare || undefined, phone: i.telefono || undefined,
          links: s ? [{ subject_id: s.id, job: i.qualifica ? String(i.qualifica).slice(0, 120) : '', is_primary: true }] : [], subject_name: s ? s.name : null },
      };
    },
    async execute(d, call) {
      const { subject_name: name, ...body } = d;
      const c = await call('POST', '/api/crm/contacts', body);
      return { message: `contatto ${[d.first_name, d.last_name].filter(Boolean).join(' ')}${name ? ` aggiunto a «${name}»` : ' creato'}`, link: `#/crm/contatti/${c.id}`, undo: { contact_id: c.id } };
    },
    undo: (u, call) => call('DELETE', `/api/crm/contacts/${Number(u.contact_id)}`),
  },
  {
    // Biglietti da visita (17/11/2026, canvas V6-Biglietti): uno per biglietto, letto da una foto o dettato.
    name: 'proponi_biglietto',
    label: 'Biglietto da visita',
    icon: 'id-card',
    allowed: crmOnly,
    description: 'Un biglietto da visita (letto da una foto o dettato) → proposta da confermare nel CRM. Chiamalo UNA volta per ogni biglietto, tutti nella stessa risposta. Controlla da solo se la persona c\'è già (allora propone solo i dati che cambiano), se l\'azienda c\'è già (contatto nuovo) o se va creata (azienda nuova come lead + contatto). Copia i dati esattamente come sono scritti sul biglietto; metti in «incerti» i campi che non si leggono bene.',
    input_schema: schema({
      cognome: S('string', 'Cognome.'),
      nome: O('string', 'Nome.'),
      titolo: O('string', 'Titolo: Ing., Arch., Geom., Dott., Avv.…'),
      qualifica: O('string', 'Ruolo scritto sul biglietto (es. RUP, Responsabile lavori).'),
      azienda: S('string', 'Azienda o ente del biglietto, con maiuscole e minuscole normali («Comune di Lanciano», non «COMUNE DI LANCIANO»), oppure l\'id della scheda se l\'utente ha scelto.'),
      email: O('string', 'Email.'),
      cellulare: O('string', 'Cellulare.'),
      telefono: O('string', 'Telefono fisso.'),
      sito: O('string', 'Sito web.'),
      indirizzo: O('string', 'Indirizzo (via e numero).'),
      citta: O('string', 'Solo il nome del comune, senza CAP e provincia (es. «Lanciano»).'),
      tipo_ente: O('string', 'Tipo di azienda se va creata: impresa, ente_pubblico (Comuni, Province, Regioni, ASL…), partecipata, consorzio, professionista, altro.', { enum: SUBJECT_KINDS }),
      nota: O('string', 'Dove o come l\'utente ha conosciuto la persona, se l\'ha detto (es. «Fiera Ecomondo, interessato al facility»).'),
      bu: O('string', 'ASA/BU della nuova azienda, solo se l\'utente la dice.'),
      incerti: O('array', 'Campi letti male dalla foto (email, cellulare, telefono, nome, cognome, azienda…).', { items: { type: 'string' } }),
      azienda_nuova: O('boolean', 'true solo se l\'utente ha scelto di creare l\'azienda come nuova.'),
    }),
    async preview(i, get, ctx) {
      const last = String(i.cognome || '').trim().slice(0, 120);
      if (!last) throw new Error('Sul biglietto serve almeno il cognome.');
      const first = String(i.nome || '').trim().slice(0, 120);
      const companyName = String(i.azienda || '').trim().slice(0, 200);
      if (!companyName) throw new Error('Serve l\'azienda del biglietto (nel CRM ogni contatto sta nella sua azienda).');
      const email = i.email ? String(i.email).trim().toLowerCase().replace(/\s+/g, '') : '';
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`L'email «${i.email}» non è valida: chiedi all'utente di controllarla.`);
      const title = CONTACT_TITLES.find(t => norm(t).replace(/\./g, '') === norm(i.titolo).replace(/\./g, '')) || '';
      const mobile = i.cellulare ? String(i.cellulare).trim().slice(0, 40) : '';
      const phone = i.telefono ? String(i.telefono).trim().slice(0, 40) : '';
      const job = i.qualifica ? String(i.qualifica).trim().slice(0, 120) : '';
      const nota = i.nota ? String(i.nota).trim().slice(0, 1000) : '';
      const noteLine = nota ? `${itDate(today())} · ${nota}` : '';
      const full = [title, first, last].filter(Boolean).join(' ');
      const unsure = (Array.isArray(i.incerti) ? i.incerti : []).map(x => String(x).trim()).filter(Boolean);
      const warnings = unsure.length ? [`Da controllare, letti male dalla foto: ${unsure.join(', ')}.`] : [];

      // 1) la persona c'è già? (stessa email, o stesso nome e cognome) → solo i dati che cambiano
      const dup = await get(`/api/crm/contacts/check?email=${encodeURIComponent(email)}&last_name=${encodeURIComponent(last)}&first_name=${encodeURIComponent(first)}&subject_id=0`).catch(() => ({ matches: [] }));
      const same = (dup.matches || []).find(m => (email && norm(m.email) === email) || (norm(m.last_name) === norm(last) && norm(m.first_name) === norm(first)));
      if (same) {
        const c = await get(`/api/crm/contacts/${same.id}`);
        const patch = {}, before = {}, fields = [];
        const put = (key, label, value) => {
          if (!value || norm(value) === norm(c[key])) return;
          patch[key] = value; before[key] = c[key] || '';
          fields.push([label, c[key] ? `${c[key]} → ${value}` : value]);
        };
        put('email', 'Email', email); put('mobile', 'Cellulare', mobile); put('phone', 'Telefono', phone);
        if (title && !c.title) put('title', 'Titolo', title);
        if (noteLine) { patch.notes = c.notes ? `${c.notes}\n${noteLine}` : noteLine; before.notes = c.notes || ''; fields.push(['Nota', nota]); }
        const where = (c.links || []).map(l => l.name).filter(Boolean).join(', ');
        if (!Object.keys(patch).length) throw new Error(`${full} c'è già nel CRM${where ? ` (${where})` : ''} con gli stessi dati: non c'è niente da aggiornare. Dillo all'utente.`);
        return {
          title: `Aggiorna · ${full}`,
          fields: [['Persona', full], ...(where ? [['Azienda', `${where} (già nel CRM)`]] : []), ...fields],
          warnings,
          data: { mode: 'aggiorna', contact_id: c.id, full, patch, before },
        };
      }

      const contact = { title, first_name: first, last_name: last, email: email || undefined, mobile: mobile || undefined, phone: phone || undefined, notes: noteLine || undefined };
      const contactFields = [['Persona', full], ...(job ? [['Qualifica', job]] : []), ...(email ? [['Email', email]] : []), ...(mobile ? [['Cellulare', mobile]] : []),
        ...(phone ? [['Telefono', phone]] : []), ...(nota ? [['Nota', nota]] : [])];

      // 2) l'azienda c'è già? (più schede con quel nome → «In quale?», con la scelta di crearla nuova)
      let subject = null;
      const asId = Number(companyName);
      if (Number.isInteger(asId) && asId > 0 && companyName === String(asId)) subject = await subjectOf(companyName, get);
      else if (!i.azienda_nuova) {
        const { subjects = [] } = await get(`/api/crm/subjects?q=${encodeURIComponent(companyName.slice(0, 100))}`).catch(() => ({}));
        const n = norm(companyName);
        const exact = subjects.filter(s => norm(s.name) === n || norm(s.short_name) === n);
        const list = exact.length ? exact : subjects;
        if (list.length === 1) subject = list[0];
        else if (list.length > 1) {
          throw choice(`Nel CRM ci sono ${list.length} schede per «${companyName}». In quale va ${full}?`, [
            ...list.slice(0, 5).map(s => ({ label: s.name, sub: [s.city, (s.roles || []).join(', ')].filter(Boolean).join(' · '), input: { azienda: String(s.id) } })),
            { label: `Nessuna: crea «${companyName}» come nuova`, sub: 'azienda nuova, come lead', input: { azienda_nuova: true } }]);
        }
      }
      if (subject) {
        return {
          title: `Nuovo contatto · ${full}`,
          fields: [contactFields[0], ['Azienda', `${subject.name} (già nel CRM)`], ...contactFields.slice(1)],
          warnings,
          data: { mode: 'contatto', contact: { ...contact, links: [{ subject_id: subject.id, job, is_primary: true }] }, subject_name: subject.name, full },
        };
      }

      // 3) azienda nuova come lead, nell'ASA di chi carica (più ASA o nessuna → «In quale ASA?»)
      const meta = await get('/api/crm');
      const all = meta.asa || [];
      let asa = null;
      if (i.bu) {
        const b = norm(i.bu);
        asa = all.find(a => [a.key, a.label, a.boss_label].some(x => norm(x) === b)) || all.find(a => [a.label, a.boss_label].some(x => x && norm(x).includes(b)));
        if (!asa) throw new Error(`Non c'è nessuna ASA «${i.bu}». Le ASA sono: ${all.map(a => a.label).join(', ')}.`);
      } else {
        const mine = all.filter(a => (meta.myAsa || []).includes(a.key));
        if (mine.length === 1) asa = mine[0];
        else {
          const opts = mine.length ? mine : all;
          if (!opts.length) throw new Error('Nel CRM non ci sono ASA: la direzione deve crearle prima.');
          throw choice(`«${companyName}» non c'è nel CRM: la creo come lead. In quale ASA?`, opts.slice(0, 8).map(a => ({ label: a.label, input: { bu: a.key, azienda_nuova: true } })));
        }
      }
      const kind = SUBJECT_KINDS.includes(i.tipo_ente) ? i.tipo_ente : undefined;
      const website = i.sito ? String(i.sito).trim().slice(0, 200) : '';
      const city = i.citta ? String(i.citta).trim().slice(0, 100) : '';
      const subjectBody = { name: companyName, roles: ['lead'], asa: [asa.key], owner_id: ctx.me.id, origin: nota ? 'Fiera o evento' : 'Rete commerciale',
        ...(kind ? { kind } : {}), ...(website ? { website } : {}), ...(i.indirizzo ? { address: String(i.indirizzo).trim().slice(0, 200) } : {}), ...(city ? { city } : {}),
        ...(nota ? { lead_why: nota } : {}) };
      return {
        title: `Nuovo contatto e nuova azienda · ${full}`,
        fields: [contactFields[0], ['Azienda', `${companyName} (nuova, come lead · ${asa.label})`], ...contactFields.slice(1),
          ...(website ? [['Sito', website]] : []), ...(city ? [['Comune', city]] : [])],
        warnings,
        data: { mode: 'nuova', subject: subjectBody, contact, job, full },
      };
    },
    async execute(d, call) {
      if (d.mode === 'aggiorna') {
        await call('PATCH', `/api/crm/contacts/${d.contact_id}`, d.patch);
        return { message: `${d.full} aggiornato`, link: `#/crm/contatti/${d.contact_id}`, undo: { contact_id: d.contact_id, before: d.before } };
      }
      if (d.mode === 'contatto') {
        const c = await call('POST', '/api/crm/contacts', d.contact);
        return { message: `${d.full} aggiunto a «${d.subject_name}»`, link: `#/crm/contatti/${c.id}`, undo: { contact_id: c.id, created: true } };
      }
      const s = await call('POST', '/api/crm/subjects', d.subject);
      const c = await call('POST', '/api/crm/contacts', { ...d.contact, links: [{ subject_id: s.id, job: d.job || '', is_primary: true }] });
      return { message: `${d.full} e «${s.name}» (lead) creati`, link: `#/crm/scheda/${s.id}`, undo: { contact_id: c.id, created: true, subject_id: s.id } };
    },
    async undo(u, call) {
      if (!u.created) return call('PATCH', `/api/crm/contacts/${Number(u.contact_id)}`, u.before || {});
      await call('DELETE', `/api/crm/contacts/${Number(u.contact_id)}`);
      if (u.subject_id) {
        try { await call('DELETE', `/api/crm/subjects/${Number(u.subject_id)}`); } catch { throw new Error('Il contatto è tolto; la nuova azienda resta (la può togliere solo la direzione).'); }
      }
      return null;
    },
  },
  {
    // Email ai contatti del CRM (17/11/2026, canvas V7-Email, strada A): parte dalla casella Outlook di chi conferma,
    // subito o programmata; a un gruppo un'email diversa per persona (lib/assistente-email.js).
    name: 'proponi_email',
    label: 'Email',
    icon: 'mail',
    allowed: crmOnly,
    description: 'Prepara una o più email da mandare dalla casella Outlook di chi ti scrive, da confermare (non parte niente prima). Una voce per destinatario (al massimo 10), ognuna con il suo oggetto e il suo testo completo (saluto, corpo, firma) nel tono giusto per quella persona. I destinatari sono SOLO contatti del CRM: passa «c:ID» con l\'id del contatto preso dalle ricerche, oppure il nome della persona. «quando» solo se l\'utente dice quando mandarla.',
    input_schema: schema({
      email: S('array', 'Una voce per destinatario.', { items: { type: 'object', additionalProperties: false, required: ['destinatario', 'oggetto', 'testo'], properties: {
        destinatario: { type: 'string', description: '«c:ID» (id del contatto CRM) oppure nome e cognome della persona.' },
        oggetto: { type: 'string', description: 'Oggetto dell\'email.' },
        testo: { type: 'string', description: 'Testo completo, con saluto e firma; niente indirizzi email o link.' } } } }),
      quando: O('string', 'Quando mandarla, AAAA-MM-GG HH:MM in ora italiana; vuoto = subito.'),
      criterio: O('string', 'Per un gruppo: come hai scelto i destinatari (es. «clienti Facility senza contatti da 90 giorni»).'),
      oggetto: O('string', 'Solo per correggere l\'oggetto di un\'email singola.'),
      testo: O('string', 'Solo per correggere il testo di un\'email singola.'),
      escludi: O('array', 'Numeri (da 1) delle email da togliere dal gruppo.', { items: { type: 'integer' } }),
    }),
    async preview(i, get) {
      const list = Array.isArray(i.email) ? i.email.slice(0, EMAIL.MAX) : [];
      if (!list.length) throw new Error('Serve almeno un destinatario con oggetto e testo.');
      if (Array.isArray(i.email) && i.email.length > EMAIL.MAX) throw new Error(`Al massimo ${EMAIL.MAX} email per volta.`);
      if (list.length === 1 && (i.oggetto || i.testo)) list[0] = { ...list[0], ...(i.oggetto ? { oggetto: i.oggetto } : {}), ...(i.testo ? { testo: i.testo } : {}) };
      const skip = new Set((Array.isArray(i.escludi) ? i.escludi : []).map(Number));
      let at;
      try { at = EMAIL.whenOf(i.quando); } catch (e) { throw new Error(e.message); }
      const items = [], skipped = [], seen = new Set();
      for (const [n, it] of list.entries()) {
        const oggetto = String(it.oggetto || '').trim().slice(0, 250), testo = String(it.testo || '').trim().slice(0, 20000);
        if (!oggetto || !testo) throw new Error(`L'email ${n + 1} non ha oggetto o testo.`);
        const c = await emailContactOf(String(it.destinatario || ''), get, list, n);
        const name = [c.title, c.first_name, c.last_name].filter(Boolean).join(' ');
        const company = (c.links || []).map(l => l.name).filter(Boolean)[0] || '';
        if (!c.email) { if (list.length === 1) throw new Error(`${name} non ha l'email nel CRM: aggiungila nella sua scheda, poi riprova.`); skipped.push(`${name} (senza email nel CRM)`); continue; }
        const mail = String(c.email).toLowerCase();
        if (seen.has(mail)) { skipped.push(`${name} (già in elenco)`); continue; }
        seen.add(mail);
        items.push({ n: n + 1, contact_id: c.id, nome: name, azienda: company, email: mail, oggetto, testo, incluso: !skip.has(n + 1) });
      }
      const go = items.filter(x => x.incluso);
      if (!go.length) throw new Error('Non resta nessuna email da mandare.');
      const when = at ? `${EMAIL.romeLabel(at)}${go.length > 1 ? ', poi una al minuto' : ''}` : (go.length > 1 ? 'subito, una al minuto' : 'subito');
      const warnings = skipped.length ? [`Non scrivo a: ${skipped.join(', ')}.`] : [];
      const single = items.length === 1;
      return {
        title: single ? `Email · ${items[0].nome}` : `${go.length} ${go.length === 1 ? 'email personalizzata' : 'email personalizzate'}`,
        fields: single
          ? [['A', [items[0].nome, items[0].email, items[0].azienda].filter(Boolean).join(' · ')], ['Oggetto', items[0].oggetto], ['Testo', items[0].testo], ['Da', 'la tua casella Outlook'], ['Quando', when]]
          : [...(i.criterio ? [['Criterio', String(i.criterio).slice(0, 300)]] : []), ['Email', `${go.length} da mandare${items.length > go.length ? ` (${items.length - go.length} ${items.length - go.length === 1 ? 'tolta' : 'tolte'})` : ''}`], ['Da', 'la tua casella Outlook'], ['Quando', when]],
        warnings,
        items: single ? undefined : items.map(({ n, nome, azienda, email, oggetto, testo, incluso }) => ({ n, nome, azienda, email, oggetto, testo, incluso })),
        data: { items: go.map(x => ({ contact_id: x.contact_id, oggetto: x.oggetto, testo: x.testo })), names: go.map(x => x.nome), send_at: at ? at.toISOString() : null,
          criterio: i.criterio ? String(i.criterio).slice(0, 300) : '' },
      };
    },
    async execute(d, call) {
      const r = await call('POST', '/api/alma/email', d);
      const who = d.names.length === 1 ? d.names[0] : `${d.names.length} persone`;
      if (r.first === 'errore') throw new Error(`l'email a ${d.names[0]} non è partita (${r.error})${d.names.length > 1 ? '; le altre restano programmate in «Email di Alma»' : ''}.`);
      const message = r.first === 'inviata'
        ? (d.names.length === 1 ? `email inviata a ${who}` : `email a ${who}: la prima è partita, le altre partono una al minuto`)
        : `${d.names.length === 1 ? 'email programmata' : `${d.names.length} email programmate`} per ${r.send_label} (a ${who})`;
      return { message, link: '#/alma/email', ...(r.pending ? { undo: { email_ids: r.ids } } : {}) };
    },
    async undo(u, call) {
      const r = await call('POST', '/api/alma/email/annulla-gruppo', { ids: u.email_ids || [] });
      if (!r.cancelled) throw new Error('Le email sono già partite: non si possono richiamare.');
      return null;
    },
  },
];
for (const a of ACTIONS) a.preview_tool = true;

module.exports = ACTIONS;
module.exports.choice = choice;
