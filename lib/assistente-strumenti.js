// Ricerche di Alma, l'assistente di Alma Space (porting delle ricerche di Bacco).
// Alma non vede il database: ogni ricerca è una GET a un'API che Alma Space ha già, fatta con la sessione di chi
// chiede (routes/assistente.js → get). Permessi, filtri e numeri sono quelli delle pagine; una ricerca che la persona
// non può fare (allowed) non viene neanche offerta.
// Ogni ricerca restituisce un JSON corto con i numeri già calcolati (totali, aperti, in ritardo, percentuali, somme):
// Claude li riporta così come sono, non calcola. wrap() aggiunge a ogni risultato la ricevuta (fonte, periodo, filtri,
// righe, link alla pagina), che resta sul server: a Claude va solo «fonte_id».
// Campi facoltativi (N) fuori da required; niente «strict» (troppi campi facoltativi per la validazione stretta).

const S = (type, description, extra = {}) => ({ type, description, ...extra });
const N = (type, description, extra = {}) => ({ type, description, ...extra, optional: true });
const schema = props => ({ type: 'object', additionalProperties: false,
  properties: Object.fromEntries(Object.entries(props).map(([k, { optional, ...v }]) => [k, v])),
  required: Object.keys(props).filter(k => !props[k].optional) });

const { isDesignTender } = require('./crm-segui-progettista');
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const nowTime = () => new Date().toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
const day = d => (d ? String(d).slice(0, 10) : null);
const itDay = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const r2 = n => Math.round(Number(n) * 100) / 100;
const q = obj => Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const many = (n, one, more) => (n == null ? null : `${n} ${n === 1 ? one : more}`);
const short = (s, n = 300) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t; };
const STATUS = { todo: 'da fare', doing: 'in corso', review: 'in revisione', done: 'fatto' };
const PRIORITY = { low: 'bassa', normal: 'normale', high: 'alta', urgent: 'urgente' };

// Un risultato troppo lungo non si taglia a metà: elenchi accorciati (con quanti ne restano) e testi brevi.
function trim(v, depth = 0) {
  if (Array.isArray(v)) {
    const list = v.slice(0, depth ? 8 : 15).map(x => trim(x, depth + 1));
    return v.length > list.length ? [...list, { altri: v.length - list.length }] : list;
  }
  if (v && typeof v === 'object') {
    if (depth > 4) return undefined;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined || x === '') continue;
      const t = trim(x, depth + 1);
      if (t !== undefined) out[k] = t;
    }
    return out;
  }
  return typeof v === 'string' ? short(v, 300) : v;
}

// ── nomi detti dall'utente → schede ─────────────────────────────────────────────────────────────
async function users(get) {
  const list = await get('/api/users');
  return Array.isArray(list) ? list : [];
}
// «io», «Simone», «Simone Recchia» → una persona; più persone → errore con i nomi, perché Alma chieda quale.
async function personOf(name, get, ctx) {
  const n = norm(name);
  if (!n) return null;
  if (['io', 'me', 'mio', 'mia', 'miei', 'mie', 'a me'].includes(n)) return { id: ctx.me.id, name: ctx.me.name };
  const list = await users(get);
  const exact = list.filter(u => norm(u.name) === n || norm(u.email) === n);
  const part = exact.length ? exact : list.filter(u => norm(u.name).split(' ').includes(n) || norm(u.name).includes(n));
  if (part.length === 1) return { id: part[0].id, name: part[0].name };
  if (!part.length) throw new Error(`In Alma Space non c'è nessuna persona «${name}».`);
  throw new Error(`Ci sono più persone per «${name}»: ${part.slice(0, 6).map(u => u.name).join(', ')}. Chiedi quale.`);
}
async function projectOf(value, get) {
  const list = await get('/api/projects?all=1');
  const id = Number(value);
  if (Number.isInteger(id) && id > 0 && String(value).trim() === String(id)) {
    const p = list.find(x => x.id === id);
    if (p) return p;
  }
  const n = norm(value);
  const exact = list.filter(p => norm(p.name) === n);
  const part = exact.length ? exact : list.filter(p => norm(p.name).includes(n));
  if (part.length === 1) return part[0];
  if (!part.length) throw new Error(`Non trovo nessun progetto «${value}» tra quelli che vedi.`);
  throw new Error(`Ci sono più progetti per «${value}»: ${part.slice(0, 6).map(p => `${p.name} (id ${p.id})`).join(', ')}. Chiedi quale.`);
}
async function subjectOf(value, get) {
  const id = Number(value);
  if (Number.isInteger(id) && id > 0 && String(value).trim() === String(id)) return { id };
  const { subjects = [] } = await get(`/api/crm/subjects?${q({ q: value })}`);
  const n = norm(value);
  const exact = subjects.filter(s => norm(s.name) === n || norm(s.short_name) === n);
  const list = exact.length ? exact : subjects;
  if (list.length === 1) return list[0];
  if (!list.length) throw new Error(`Nel CRM non trovo «${value}».`);
  throw new Error(`Nel CRM ci sono ${list.length} schede per «${value}»: ${list.slice(0, 6).map(s => `${s.name}${s.city ? ` (${s.city})` : ''}, id ${s.id}`).join('; ')}. Chiedi quale.`);
}

const ticketRow = (t, names, now) => {
  const due = day(t.due_date);
  const late = t.status !== 'done' && due && due < now;
  return { id: t.id, titolo: t.title, stato: STATUS[t.status] || t.status, priorita: PRIORITY[t.priority] || t.priority, scadenza: due,
    ...(late ? { giorni_ritardo: daysBetween(due, now) } : {}), progetto: t.project_name || null,
    assegnati: (t.assignee_ids || []).map(id => names.get(id)).filter(Boolean), link: `#/tickets/${t.id}` };
};
function ticketNumbers(list, now) {
  const open = list.filter(t => t.status !== 'done');
  const late = open.filter(t => day(t.due_date) && day(t.due_date) < now);
  return { totale: list.length, aperti: open.length, in_ritardo: late.length, fatti: list.length - open.length,
    per_stato: { da_fare: list.filter(t => t.status === 'todo').length, in_corso: list.filter(t => t.status === 'doing').length,
      in_revisione: list.filter(t => t.status === 'review').length, fatti: list.filter(t => t.status === 'done').length } };
}
const byUrgency = now => (a, b) => {
  const la = a.status !== 'done' && day(a.due_date) && day(a.due_date) < now, lb = b.status !== 'done' && day(b.due_date) && day(b.due_date) < now;
  if (la !== lb) return la ? -1 : 1;
  return String(day(a.due_date) || '9999').localeCompare(String(day(b.due_date) || '9999'));
};

const TOOLS = [
  {
    name: 'cerca',
    label: 'Cerco in Alma Space',
    description: 'Ricerca unica per nome o testo (almeno 2 lettere) tra ticket, progetti, note, email dei progetti, persone e post. Restituisce gruppi con titolo e link. Usala per trovare l\'id di qualcosa nominato dall\'utente.',
    input_schema: schema({ testo: S('string', 'Il testo da cercare.') }),
    run: async (i, get) => {
      const d = await get(`/api/search?${q({ q: i.testo })}`);
      const link = (type, x) => ({ ticket: `#/tickets/${x.id}`, project: `#/projects/${x.id}`, person: x.id ? `#/u/${x.id}` : null,
        note: x.project_id ? `#/projects/${x.project_id}` : x.ticket_id ? `#/tickets/${x.ticket_id}` : null, email: x.project_id ? `#/projects/${x.project_id}` : null, post: `#/p/${x.id}` }[type] || null);
      return { totale: d.total, gruppi: (d.groups || []).map(g => ({ tipo: g.label, voci: g.items.map(x => ({ id: x.id, titolo: x.title, dettaglio: x.sub || undefined, estratto: x.snippet || undefined, link: link(g.type, x) })) })) };
    },
    ricevuta: (i, o) => ({ titolo: 'Ricerca in Alma Space', filtri: [`Testo «${i.testo}»`], righe: many(o.totale, 'risultato', 'risultati'), link: `#/search?q=${encodeURIComponent(i.testo)}` }),
  },
  {
    name: 'ticket_elenco',
    label: 'Leggo i ticket',
    description: 'Ticket di una persona e/o di un progetto con i numeri già contati: totale, aperti, in ritardo (scadenza passata e non fatti), per stato. Restituisce fino a 25 ticket, prima quelli in ritardo. persona: nome o «io»; progetto: nome o id. Senza persona né progetto: i ticket assegnati a chi chiede.',
    input_schema: schema({
      persona: N('string', 'Nome della persona assegnataria, oppure «io».'),
      progetto: N('string', 'Nome o id del progetto.'),
      stato: N('string', 'aperti (predefinito), fatti o tutti.', { enum: ['aperti', 'fatti', 'tutti'] }),
      solo_in_ritardo: N('boolean', 'true = solo quelli con la scadenza passata.'),
      testo: N('string', 'Parola nel titolo o nella descrizione.'),
    }),
    run: async (i, get, ctx) => {
      const person = i.persona ? await personOf(i.persona, get, ctx) : (!i.progetto ? { id: ctx.me.id, name: ctx.me.name } : null);
      const project = i.progetto ? await projectOf(i.progetto, get) : null;
      const status = i.stato === 'fatti' ? 'done' : i.stato === 'tutti' ? null : 'open';
      const list = await get(`/api/tickets?${q({ assignee: person ? (person.id === ctx.me.id ? 'me' : person.id) : null, project: project?.id, status, q: i.testo })}`);
      const now = today();
      const names = new Map((await users(get)).map(u => [u.id, u.name]));
      let rows = [...list].sort(byUrgency(now));
      if (i.solo_in_ritardo) rows = rows.filter(t => t.status !== 'done' && day(t.due_date) && day(t.due_date) < now);
      return { persona: person?.name || null, progetto: project ? project.name : null, ...ticketNumbers(list, now), mostrati: Math.min(rows.length, 25),
        completo: rows.length <= 25, ticket: rows.slice(0, 25).map(t => ticketRow(t, names, now)) };
    },
    ricevuta: (i, o) => ({ titolo: 'Ticket', filtri: [o.persona ? `Assegnati a ${o.persona}` : null, o.progetto ? `Progetto «${o.progetto}»` : null,
      { fatti: 'Solo fatti', tutti: 'Tutti gli stati' }[i.stato] || 'Solo aperti', i.solo_in_ritardo ? 'Solo in ritardo' : null, i.testo ? `Testo «${i.testo}»` : null],
    righe: many(o.totale, 'ticket', 'ticket'), periodo: `fino a oggi, ${itDay(today())}`, link: '#/tickets' }),
  },
  {
    name: 'ticket_dettaglio',
    label: 'Apro il ticket',
    description: 'Un ticket per id: titolo, descrizione, stato, priorità, date, progetto, assegnati, ore (se è una RDA) e gli ultimi commenti.',
    input_schema: schema({ id: S('integer', 'Id del ticket.') }),
    run: async (i, get) => {
      const t = await get(`/api/tickets/${Number(i.id)}`);
      const names = new Map((await users(get)).map(u => [u.id, u.name]));
      const now = today();
      return { ...ticketRow(t, names, now), descrizione: short(t.description, 800) || undefined, inizio: day(t.start_date), avanzamento_pct: t.progress ?? undefined,
        ore_stimate: t.hours_estimated ?? undefined, ore_confermate: t.hours_approved ?? undefined, ore_effettive: t.hours_actual ?? undefined,
        commenti: (t.comments || []).length, ultimi_commenti: (t.comments || []).slice(-5).map(c => ({ chi: c.user_name, quando: day(c.created_at), testo: short(c.body || c.text, 300) })) };
    },
    ricevuta: (i, o) => ({ titolo: `Ticket «${o.titolo || i.id}»`, link: `#/tickets/${i.id}` }),
  },
  {
    name: 'progetti_elenco',
    label: 'Guardo i progetti',
    description: 'Progetti che chi chiede vede, con responsabile, stato, ticket aperti e fatti, avanzamento in % (ticket fatti su totali) e arco delle date. Filtri: testo nel nome, stato.',
    input_schema: schema({
      testo: N('string', 'Parola nel nome del progetto.'),
      stato: N('string', 'attivi (predefinito) o tutti.', { enum: ['attivi', 'tutti'] }),
    }),
    run: async (i, get) => {
      let list = await get(`/api/projects${i.stato === 'tutti' ? '?all=1' : ''}`);
      if (i.testo) list = list.filter(p => norm(p.name).includes(norm(i.testo)));
      const rows = list.map(p => ({ id: p.id, nome: p.name, stato: { active: 'attivo', paused: 'in pausa', done: 'concluso', archived: 'archiviato' }[p.status] || p.status,
        responsabile: p.owner_name, ticket_totali: p.ticket_count, ticket_aperti: p.ticket_count - p.done_count, avanzamento_pct: pct(p.done_count, p.ticket_count),
        inizio: day(p.span_start || p.start_date), fine: day(p.span_end || p.end_date), link: `#/projects/${p.id}` }));
      return { totale: rows.length, attivi: rows.filter(p => p.stato === 'attivo').length, progetti: rows.slice(0, 30), completo: rows.length <= 30 };
    },
    ricevuta: (i, o) => ({ titolo: 'Progetti', filtri: [i.stato === 'tutti' ? 'Anche archiviati' : 'Senza gli archiviati', i.testo ? `Nome con «${i.testo}»` : null], righe: many(o.totale, 'progetto', 'progetti'), link: '#/projects' }),
  },
  {
    name: 'progetto_riepilogo',
    label: 'Riassumo il progetto',
    description: 'Riepilogo di un progetto (nome o id): responsabile, date, ticket aperti/fatti/in ritardo, avanzamento %, attività del Gantt in ritardo (con i giorni), ore stimate/confermate/effettive delle RDA del progetto, persone con i loro ticket aperti.',
    input_schema: schema({ progetto: S('string', 'Nome o id del progetto.') }),
    run: async (i, get) => {
      const base = await projectOf(i.progetto, get);
      const [p, list, members] = await Promise.all([get(`/api/projects/${base.id}`), get(`/api/tickets?${q({ project: base.id })}`), get(`/api/projects/${base.id}/members`)]);
      const now = today();
      const names = new Map((await users(get)).map(u => [u.id, u.name]));
      const dated = list.filter(t => t.start_date || t.due_date);
      const late = dated.filter(t => t.status !== 'done' && day(t.due_date) && day(t.due_date) < now).sort(byUrgency(now));
      const sum = k => r2(list.reduce((s, t) => s + (Number(t[k]) || 0), 0));
      const hours = { ore_stimate: sum('hours_estimated'), ore_confermate: sum('hours_approved'), ore_effettive: sum('hours_actual') };
      return { id: p.id, nome: p.name, stato: p.status, responsabile: p.owner_name, descrizione: short(p.description, 400) || undefined,
        inizio: day(p.span_start || p.start_date), fine: day(p.span_end || p.end_date), ...ticketNumbers(list, now), avanzamento_pct: pct(list.filter(t => t.status === 'done').length, list.length),
        attivita_gantt: dated.length, attivita_in_ritardo: late.length, ritardi: late.slice(0, 10).map(t => ticketRow(t, names, now)),
        ...(hours.ore_stimate || hours.ore_confermate || hours.ore_effettive ? hours : { ore: 'Il progetto non ha ore registrate (le ore ci sono solo nelle RDA interne).' }),
        persone: (members || []).map(m => ({ nome: m.name, ruolo: m.owner ? 'responsabile' : 'membro', ticket_aperti: m.open_tickets })), link: `#/projects/${p.id}` };
    },
    ricevuta: (i, o) => ({ titolo: `Progetto «${o.nome}»`, filtri: ['Ticket e attività del Gantt del progetto'], righe: many(o.totale, 'ticket', 'ticket'), periodo: o.inizio ? `${itDay(o.inizio)} – ${itDay(o.fine)}` : null, link: o.link }),
  },
  {
    name: 'ore_rda',
    label: 'Leggo le ore delle RDA',
    description: 'RDA interne (lavori chiesti a un\'altra funzione, con le ore): quelle che chi chiede ha mandato, quelle arrivate alle funzioni che guida e quelle da accettare. Somme già fatte di ore stimate, confermate ed effettive, anche per progetto.',
    input_schema: schema({ progetto: N('string', 'Solo le RDA di questo progetto (nome).') }),
    run: async (i, get) => {
      const d = await get('/api/rda');
      let all = [...(d.inbox || []), ...(d.received || []), ...(d.sent || [])];
      all = [...new Map(all.map(t => [t.id, t])).values()];
      if (i.progetto) all = all.filter(t => norm(t.project_name).includes(norm(i.progetto)));
      const sum = (list, k) => r2(list.reduce((s, t) => s + (Number(t[k]) || 0), 0));
      const byProject = new Map();
      for (const t of all) { const k = t.project_name || '(senza progetto)'; if (!byProject.has(k)) byProject.set(k, []); byProject.get(k).push(t); }
      return { funzioni_che_guidi: d.led || [], da_accettare: (d.inbox || []).length, totale: all.length,
        ore_stimate: sum(all, 'hours_estimated'), ore_confermate: sum(all, 'hours_approved'), ore_effettive: sum(all, 'hours_actual'),
        per_progetto: [...byProject.entries()].map(([k, list]) => ({ progetto: k, rda: list.length, ore_stimate: sum(list, 'hours_estimated'), ore_confermate: sum(list, 'hours_approved'), ore_effettive: sum(list, 'hours_actual') })),
        rda: all.slice(0, 20).map(t => ({ id: t.id, titolo: t.title, funzione: t.rda_function, stato: t.rda_state, ore_stimate: t.hours_estimated, ore_confermate: t.hours_approved, ore_effettive: t.hours_actual, link: `#/tickets/${t.id}` })) };
    },
    ricevuta: (i, o) => ({ titolo: 'RDA interne', filtri: ['Mandate da te e arrivate alle funzioni che guidi', i.progetto ? `Progetto «${i.progetto}»` : null], righe: many(o.totale, 'RDA', 'RDA'), link: '#/rda' }),
  },
  {
    name: 'manuali',
    label: 'Leggo i manuali d\'uso',
    description: 'Come si usa Alma CRM: cerca nei manuali d\'uso (Impostazioni › Manuali d\'uso) i capitoli che spiegano una pagina, un pulsante o una procedura (es. «trasforma in cliente», «primo passo», «biglietto da visita»). Usala per ogni domanda su COME si fa qualcosa nel CRM; rispondi coi passi del manuale e dai il link al capitolo.',
    input_schema: schema({ domanda: S('string', 'Le parole chiave della domanda, es. «diventa cliente» o «scrivere email con Alma».') }),
    run: async i => {
      const found = require('./manuali-crm').search(i.domanda, { limit: 4 });
      return { trovati: found.length, capitoli: found.map(r => ({ manuale: r.title, capitolo: `${r.chapter} · ${r.chapter_title}`, testo: short(r.text, 1400), link: `#/impostazioni/manuali/${r.manual}/${r.chapter}` })) };
    },
    ricevuta: (i, o) => ({ titolo: 'Manuali d\'uso di Alma CRM', filtri: [`Domanda «${i.domanda}»`], righe: many(o.trovati, 'capitolo', 'capitoli'), link: '#/impostazioni/manuali' }),
  },
  {
    name: 'crm_cerca',
    label: 'Cerco nel CRM',
    description: 'Cerca nel CRM aziende ed enti (lead, clienti, fornitori, partner, concorrenti) e contatti per nome, P.IVA o città. Restituisce id, ruoli, città, owner, prossimo passo e link.',
    input_schema: schema({ testo: S('string', 'Nome, P.IVA o città.'), ruolo: N('string', 'Solo questo ruolo.', { enum: ['lead', 'cliente', 'fornitore', 'partner', 'concorrente'] }) }),
    run: async (i, get) => {
      const [{ subjects = [] }, { contacts = [] }] = await Promise.all([get(`/api/crm/subjects?${q({ q: i.testo, role: i.ruolo })}`), get(`/api/crm/contacts?${q({ q: i.testo })}`)]);
      return { aziende_trovate: subjects.length, contatti_trovati: contacts.length,
        aziende: subjects.slice(0, 10).map(s => ({ id: s.id, nome: s.name, ruoli: s.roles, citta: s.city, owner: s.owner_name, fase_lead: s.lead_stage || undefined, prossimo_passo: s.next_step || undefined, entro: day(s.next_step_date), link: `#/crm/scheda/${s.id}` })),
        contatti: contacts.slice(0, 8).map(c => ({ id: c.id, nome: [c.title, c.first_name, c.last_name].filter(Boolean).join(' '), email: c.email || undefined, aziende: (c.links || []).map(l => l.name), link: `#/crm/contatti/${c.id}` })) };
    },
    ricevuta: (i, o) => ({ titolo: 'CRM', filtri: [`Testo «${i.testo}»`, i.ruolo ? `Ruolo ${i.ruolo}` : null], righe: many(o.aziende_trovate, 'azienda', 'aziende'), link: '#/crm/tutte' }),
  },
  {
    name: 'crm_scheda',
    label: 'Apro la scheda CRM',
    description: 'La scheda di un\'azienda o ente del CRM (nome o id): ruoli, ASA, owner, fase del lead, prossimi passi aperti e fatti, contatti, ultime note e quanto la conosciamo (forza del rapporto e strade calde: chi di noi conosce chi).',
    input_schema: schema({ azienda: S('string', 'Nome o id della scheda.') }),
    run: async (i, get) => {
      const base = await subjectOf(i.azienda, get);
      const id = base.id;
      const [s, steps, notes, rel] = await Promise.all([
        get(`/api/crm/subjects/${id}`), get(`/api/crm/subjects/${id}/steps`).catch(() => ({})),
        get(`/api/crm/subjects/${id}/notes`).catch(() => []), get(`/api/crm/subjects/${id}/relazioni`).catch(() => null)]);
      const noteList = Array.isArray(notes) ? notes : notes.notes || [];
      const now = today();
      return { id: s.id, nome: s.name, ruoli: s.roles, asa: s.asa, citta: s.city, provincia: s.province, stato: s.status, fase_lead: s.lead_stage || undefined,
        owner: s.owner_name, key_account: s.key_account || undefined, valore_potenziale: s.potential_value ?? undefined,
        passi_aperti: (steps.open || []).map(x => ({ id: x.id, cosa: x.title, entro: day(x.due_date), in_ritardo: day(x.due_date) < now || undefined, chi: x.owner_name, contatto: x.contact_name || undefined })),
        passi_fatti_recenti: (steps.done || []).slice(0, 5).map(x => ({ cosa: x.title, fatto: day(x.done_at), esito: short(x.outcome, 200) || undefined })),
        contatti: (s.contacts || []).filter(c => !c.date_to).slice(0, 10).map(c => ({ id: c.id, nome: [c.title, c.first_name, c.last_name].filter(Boolean).join(' '), qualifica: c.job || undefined, email: c.email || undefined, telefono: c.mobile || c.phone || undefined })),
        note_recenti: noteList.slice(0, 5).map(n => ({ data: day(n.note_date), tipo: n.kind, titolo: n.title || undefined, testo: short(n.body, 300), autore: n.author_name })),
        rapporto: rel ? { livello: rel.level || 'nessuno', punti: rel.points, strade: (rel.paths || []).slice(0, 3).map(p => ({ noi: p.us?.name, contatto: p.contact, qualifica: p.job, perche: p.why })) } : undefined,
        link: `#/crm/scheda/${s.id}` };
    },
    ricevuta: (i, o) => ({ titolo: `Scheda CRM «${o.nome}»`, filtri: ['Passi, contatti, note e rapporti'], link: o.link }),
  },
  {
    name: 'crm_settimana',
    label: 'Guardo La mia settimana',
    description: 'La mia settimana del CRM: prossimi passi fino a fine settimana (quanti, quanti in ritardo), key account senza contatti da troppo, incontri senza note, lead senza passo, passi delle iniziative di Nuovi business. persona solo per la direzione.',
    input_schema: schema({ persona: N('string', 'Nome della persona (solo la direzione può guardare quella di un altro).') }),
    run: async (i, get, ctx) => {
      const person = i.persona ? await personOf(i.persona, get, ctx) : null;
      const d = await get(`/api/crm/settimana${person && person.id !== ctx.me.id ? `?user=${person.id}` : ''}`);
      const steps = d.steps || [];
      return { persona: d.user?.name, fino_al: d.until, passi: steps.length, passi_in_ritardo: steps.filter(s => s.late).length,
        elenco_passi: steps.slice(0, 15).map(s => ({ id: s.id, cosa: s.title, azienda: s.subject_name, entro: s.due_date, in_ritardo: s.late || undefined, link: `#/crm/scheda/${s.subject_id}` })),
        key_account_totali: d.keyAccounts?.total, key_account_silenziosi: (d.keyAccounts?.silent || []).length,
        silenziosi: (d.keyAccounts?.silent || []).slice(0, 10).map(k => ({ nome: k.name, giorni_senza_contatti: k.days, ritmo_giorni: k.rhythm, link: `#/crm/scheda/${k.id}` })),
        incontri_senza_note: (d.missingNotes || []).length, lead_senza_passo: d.leadsWithoutStep?.total || 0,
        passi_nuovi_business: (d.business || []).slice(0, 10).map(t => ({ cosa: t.title, iniziativa: t.initiative_name, entro: t.due_date, in_ritardo: t.late || undefined })) };
    },
    ricevuta: (i, o) => ({ titolo: 'La mia settimana (CRM)', filtri: [o.persona ? `Di ${o.persona}` : null], periodo: o.fino_al ? `fino al ${itDay(o.fino_al)}` : null, righe: many(o.passi, 'passo', 'passi'), link: '#/crm/settimana' }),
  },
  {
    name: 'radar_segnali',
    label: 'Guardo il radar',
    description: 'Segnali del radar commerciale (gare, bandi, notizie) delle BU di chi chiede, con punteggio 0–100, ente, BU, importo e stato. vista: mine (sopra soglia, predefinita), sotto (sotto soglia), tutti (direzione).',
    input_schema: schema({ vista: N('string', 'mine, sotto o tutti.', { enum: ['mine', 'sotto', 'tutti'] }), stato: N('string', 'nuovo (predefinito), interessa o scartato.', { enum: ['nuovo', 'interessa', 'scartato'] }) }),
    run: async (i, get) => {
      const d = await get(`/api/crm/radar/signals?${q({ view: i.vista || 'mine', status: i.stato })}`);
      const list = d.signals || [];
      return { totale: list.length, soglia: d.min, in_evidenza: list.filter(g => g.score >= (d.highlight || 70)).length,
        segnali: list.slice(0, 15).map(g => ({ id: g.id, titolo: g.title, ente: g.entity || undefined, punteggio: g.score, bu: g.bu_label || g.bu, importo_eur: g.amount != null ? Number(g.amount) : undefined, scadenza: day(g.deadline), stato: g.status, azienda_crm: g.subject_name || undefined })) };
    },
    ricevuta: (i, o) => ({ titolo: 'Radar', filtri: [{ mine: 'Le mie BU, sopra soglia', sotto: 'Le mie BU, sotto soglia', tutti: 'Tutte le BU' }[i.vista || 'mine'], `Stato ${i.stato || 'nuovo'}`], righe: many(o.totale, 'segnale', 'segnali'), link: '#/crm/radar' }),
  },
  {
    // Dante 24/11/2026: «io so di un'opportunità che il radar non trova, vorrei che la cercasse e la aggiungesse»
    name: 'radar_cerca_web',
    label: 'Cerco il bando sul web',
    allowed: (req, deps) => deps.crmAccess.canUse(req),
    description: 'Cerca SUL WEB (albi pretori, piattaforme di gara, ANAC, siti degli enti, stampa) una gara, un bando o un\'opera precisa di cui l\'utente ha sentito parlare e che il radar non ha: dà oggetto, ente, importo, CIG, scadenza, link alla fonte e se è già nel radar. Usala quando chiedono «c\'è un bando per…», «trovami la gara…», «cerca l\'opportunità…» e radar_segnali/cerca non la trovano. Costa qualche centesimo: chiamala una volta, con una descrizione precisa (opera, luogo, cosa si affida).',
    input_schema: schema({ cosa: S('string', 'L\'opportunità da cercare, con opera, luogo e tipo di affidamento (es. «progetto esecutivo ex COFA Pescara»).') }),
    run: async (i, get) => {
      const cosa = String(i.cosa || '').trim();
      if (!cosa) throw new Error('Dimmi cosa cercare (opera, luogo, cosa si affida).');
      const d = await get(`/api/crm/radar/cerca-web?${q({ q: cosa })}`);
      return { _cost_usd: d.cost_usd, _model: 'web', cercato: d.query, trovati: d.found.length,
        nota: 'Trovati sul web: CIG, importi e scadenze vanno controllati sul bando prima di partecipare. Per aggiungerne uno al radar usa «proponi_segnale_radar» con i suoi dati.',
        risultati: d.found.map(x => ({ titolo: x.title, ente: x.entity, fase: x.phase, tipo: x.kind, importo_eur: x.amount ?? undefined, cig: x.cig || undefined,
          scadenza_offerte: day(x.deadline), bando_atteso: day(x.expected_on), pubblicato: day(x.published_on), regione: x.region || undefined, comune: x.place || undefined,
          piattaforma: x.platform || undefined, fonte_web: x.url, riassunto: x.summary, progettazione: isDesignTender(x) || undefined, importo_intervento_eur: x.works_amount ?? undefined,
          gia_nel_radar: x.already ? { id: x.already.id, titolo: x.already.title, stato: x.already.status, bu: x.already.bu, link: '#/crm/radar' } : false })) };
    },
    ricevuta: (i, o) => ({ titolo: 'Ricerca sul web', filtri: [i.cosa ? `«${String(i.cosa).slice(0, 80)}»` : null], righe: many(o.trovati, 'risultato', 'risultati'), link: '#/crm/radar' }),
  },
  {
    name: 'vinte_perse',
    label: 'Leggo Vinte e perse',
    description: 'Esiti delle gare e delle offerte (vinte, perse, non partecipato): win ratio in %, vinte, perse, valore vinto e offerto in euro, ribasso medio, win ratio per BU, origine, contatto caldo, fascia di importo, motivi delle perse e chi ci batte. periodo: «12» (ultimi 12 mesi, predefinito) o un anno; bu: chiave della BU.',
    input_schema: schema({ periodo: N('string', '«12» o un anno (es. «2026»).'), bu: N('string', 'Chiave della BU (es. facility, edilizia).') }),
    run: async (i, get) => {
      const d = await get(`/api/crm/esiti?${q({ period: i.periodo || '12', bu: i.bu })}`);
      const s = d.stats || {};
      const g = list => (list || []).map(x => ({ voce: x.label, vinte: x.won, totale: x.total, win_ratio_pct: x.ratio }));
      return { esiti: d.total, win_ratio_pct: s.ratio, vinte: s.won, perse: s.lost, non_partecipato: s.skipped, valore_vinto_eur: s.value_won, valore_offerto_eur: s.value_bid,
        ribasso_medio_vincitore_pct: s.winner_discount, nostro_ribasso_medio_pct: s.our_discount, da_registrare: d.todo,
        per_bu: g(s.by?.bu), per_contatto: g(s.by?.warm), per_origine: g(s.by?.origin), per_fascia: g(s.by?.band), motivi_perse: s.by?.reason,
        chi_ci_batte: (s.winners || []).map(w => ({ nome: w.name, volte: w.times, ribasso_medio_pct: w.discount })),
        ultimi: (d.outcomes || []).slice(0, 10).map(o => ({ titolo: o.title, esito: o.result, data: day(o.decided_on), bu: o.bu, importo_eur: o.amount != null ? Number(o.amount) : undefined })) };
    },
    ricevuta: (i, o) => ({ titolo: 'Vinte e perse (esiti del CRM)', filtri: [i.bu ? `BU ${i.bu}` : 'Tutte le BU', 'Win ratio su vinte e perse, senza «non partecipato»'],
      periodo: !i.periodo || i.periodo === '12' ? 'ultimi 12 mesi' : `anno ${i.periodo}`, righe: o.esiti != null ? `${o.esiti} esiti: ${o.vinte || 0} vinte, ${o.perse || 0} perse` : null, link: '#/crm/esiti' }),
  },
  {
    name: 'concorrenza',
    label: 'Guardo la concorrenza',
    description: 'Concorrenza dai dati ANAC per una BU: chi vince le gare nelle sue categorie e zone, ribasso tipico, ATI, le nostre gare. bu: chiave della BU (predefinita la mia); mesi: 12 o 24.',
    input_schema: schema({ bu: N('string', 'Chiave della BU.'), mesi: N('integer', '12 o 24.') }),
    run: async (i, get) => {
      const d = await get(`/api/crm/concorrenza?${q({ bu: i.bu, months: i.mesi })}`);
      const { bus, myBus, admin, ...rest } = d;
      return trim(rest);
    },
    ricevuta: (i, o) => ({ titolo: 'Concorrenza (ANAC)', filtri: [i.bu ? `BU ${i.bu}` : 'La mia BU'], periodo: `ultimi ${i.mesi || 12} mesi`, aggiornato: o.data?.ultimo ? `Gare ANAC fino a ${o.data.ultimo}` : null, link: '#/crm/concorrenza' }),
  },
  {
    name: 'concorrenza_stima',
    label: 'Stimo ribasso e concorrenti',
    description: 'Stima per una gara: ribasso tipico, quante offerte, chi la vince di solito. Per un segnale del radar (segnale_id) o per categoria SOA (es. OG1), regione e importo in euro.',
    input_schema: schema({ segnale_id: N('integer', 'Id del segnale del radar.'), categoria: N('string', 'Categoria SOA (es. OG1, OS28).'), regione: N('string', 'Regione.'), importo: N('number', 'Importo a base d\'asta in euro.') }),
    run: async (i, get) => trim(await get(`/api/crm/concorrenza/stima?${q({ signal_id: i.segnale_id, category: i.categoria, region: i.regione, amount: i.importo })}`)),
    ricevuta: i => ({ titolo: 'Stima della concorrenza (ANAC)', filtri: [i.segnale_id ? `Segnale ${i.segnale_id}` : null, i.categoria ? `Categoria ${i.categoria}` : null, i.regione ? `Regione ${i.regione}` : null, i.importo ? `Importo ${i.importo} €` : null], link: '#/crm/concorrenza' }),
  },
  {
    name: 'prima_del_bando',
    label: 'Guardo Prima del bando',
    description: 'Opere in arrivo prima che esca il bando, per fase (programmazione, progetto, finanziamento…) e gare vinte da altri dove proporsi in subappalto o ATI. bu: chiave della BU; entro_mesi: 6 o 12.',
    input_schema: schema({ bu: N('string', 'Chiave della BU.'), entro_mesi: N('integer', '6 o 12.') }),
    run: async (i, get) => {
      const d = await get(`/api/crm/prima-del-bando?${q({ bu: i.bu, within: i.entro_mesi })}`);
      const row = g => ({ id: g.id, titolo: g.title, ente: g.entity || undefined, importo_eur: g.amount != null ? Number(g.amount) : undefined, atteso: day(g.expected_on), punteggio: g.score, bu: g.bu_label || g.bu, rapporto: g.level || undefined });
      const stages = Object.entries(d.stages || {});
      return { totale: stages.reduce((n, [, l]) => n + l.length, 0), per_fase: stages.map(([k, l]) => ({ fase: k, numero: l.length, prime: l.slice(0, 5).map(row) })),
        vinte_da_altri: (d.vinte_altri || []).length, subappalto_o_ati: (d.vinte_altri || []).slice(0, 8).map(row) };
    },
    ricevuta: (i, o) => ({ titolo: 'Prima del bando', filtri: [i.bu ? `BU ${i.bu}` : 'Le mie BU', i.entro_mesi ? `Attese entro ${i.entro_mesi} mesi` : null], righe: many(o.totale, 'opera', 'opere'), link: '#/crm/prima' }),
  },
  {
    name: 'persone',
    label: 'Guardo l\'organigramma',
    description: 'Persone di Almacis dall\'organigramma: ruolo, reparto, sede, responsabile diretto e ticket aperti; e le funzioni aziendali con il loro responsabile (chi è responsabile di cosa). testo: nome, ruolo o reparto.',
    input_schema: schema({ testo: N('string', 'Nome, ruolo o reparto da cercare.') }),
    run: async (i, get) => {
      const [org, fns] = await Promise.all([get('/api/org'), get('/api/rda/functions').catch(() => [])]);
      const people = org.people || [];
      const byOid = new Map(people.map(p => [p.oid, p]));
      const n = norm(i.testo);
      const hit = p => !n || [p.name, p.job_title, p.department, p.office].some(x => norm(x).includes(n));
      const list = people.filter(hit);
      const functions = (fns || []).filter(f => !n || norm(f.name).includes(n) || norm(f.head?.name).includes(n));
      return { persone_trovate: list.length, persone: list.slice(0, 20).map(p => ({ nome: p.name, ruolo: p.job_title || undefined, reparto: p.department || undefined, sede: p.office || undefined,
        responsabile: byOid.get(p.manager_oid)?.name, ticket_aperti: p.open_tickets ?? undefined, link: p.user_id ? `#/u/${p.user_id}` : undefined })),
        funzioni: functions.slice(0, 15).map(f => ({ funzione: f.name, responsabile: f.head?.name || null, persone: f.member_count })) };
    },
    ricevuta: (i, o) => ({ titolo: 'Organigramma', filtri: [i.testo ? `Testo «${i.testo}»` : null], righe: many(o.persone_trovate, 'persona', 'persone'), link: '#/persone?vista=organigramma' }),
  },
  {
    name: 'mezzi',
    label: 'Guardo i mezzi',
    description: 'Parco mezzi: per categoria quanti sono liberi, in uso, prenotati, in manutenzione; le mie prenotazioni; per i gestori anche richieste da approvare, riconsegne in ritardo e scadenze dei prossimi 30 giorni.',
    input_schema: schema({}),
    run: async (i, get) => {
      const d = await get('/api/mezzi');
      return { gestore: !!d.manager, categorie: (d.categories || []).map(c => ({ categoria: c.name, totale: c.total, liberi: c.libero, in_uso: c.in_uso, prenotati: c.prenotato, manutenzione: c.manutenzione, fuori_servizio: c.fuori_servizio })),
        mie_prenotazioni: (d.mine || []).slice(0, 10).map(b => ({ categoria: b.category_name, mezzo: [b.make, b.model, b.plate].filter(Boolean).join(' ') || undefined, stato: b.status, dal: b.start_at, al: b.end_at })),
        ...(d.manager ? { richieste_da_approvare: d.counts?.pending, segnalazioni_aperte: d.counts?.reports, riconsegne_in_ritardo: d.counts?.late,
          scadenze: (d.deadlines || []).slice(0, 10).map(x => ({ mezzo: [x.make, x.model, x.plate].filter(Boolean).join(' '), cosa: x.kind || x.title, entro: day(x.due_date) })) } : {}) };
    },
    ricevuta: () => ({ titolo: 'Mezzi', link: '#/mezzi' }),
  },
  {
    name: 'energia_cruscotto',
    label: 'Leggo il cruscotto di Alma Energy',
    description: 'Cruscotto di Alma Energy (solo per la BU Energy): opportunità per tipo e stadio, valori e potenze, valore pesato, impianti target, movimenti degli ultimi giorni.',
    input_schema: schema({ giorni: N('integer', 'Giorni per i movimenti recenti (predefinito 30).') }),
    allowed: (req, deps) => deps.energyAccess.canUse(req),
    run: async (i, get) => trim(await get(`/api/energy/cruscotto?${q({ days: i.giorni })}`)),
    ricevuta: i => ({ titolo: 'Cruscotto di Alma Energy', periodo: `movimenti degli ultimi ${i.giorni || 30} giorni`, link: '#/energy/panoramica' }),
  },
  {
    // Email (17/11/2026, canvas V7-Email): chi ricontattare e come gli si scriveva (lib/assistente-email.js)
    name: 'crm_da_ricontattare',
    label: 'Cerco chi ricontattare nel CRM',
    description: 'Aziende ed enti del CRM senza contatti (note, passi fatti, incontri, email) da almeno N giorni, con il contatto principale che ha l\'email (id da usare come «c:ID» in proponi_email). Filtri: ruolo (cliente, lead, fornitore, partner), ASA/BU, giorni (predefinito 90).',
    input_schema: schema({ ruolo: N('string', 'cliente, lead, fornitore o partner.', { enum: ['cliente', 'lead', 'fornitore', 'partner'] }), asa: N('string', 'ASA o BU (es. Facility).'), giorni: N('integer', 'Da quanti giorni senza contatti (predefinito 90).') }),
    allowed: (req, deps) => deps.crmAccess.canUse(req),
    run: async (i, get) => get(`/api/alma/email/da-ricontattare?${q({ ruolo: i.ruolo, asa: i.asa, giorni: i.giorni })}`),
    ricevuta: (i, o) => ({ titolo: 'CRM · da ricontattare', filtri: [i.ruolo ? `Ruolo ${i.ruolo}` : null, i.asa ? `ASA ${i.asa}` : null, `Nessun contatto da ${o.giorni || i.giorni || 90} giorni`], righe: many(o.totale, 'azienda', 'aziende'), link: '#/crm/tutte' }),
  },
  {
    name: 'email_tono',
    label: 'Leggo il tono delle email passate',
    description: 'Prima di scrivere a uno o più contatti del CRM: per ognuno, inizio e fine delle ultime email che l\'utente gli ha mandato (saluto, tu/lei, come lo chiamava, firma). contatti = «c:ID» o nomi (al massimo 10).',
    input_schema: schema({ contatti: S('array', '«c:ID» o nomi dei contatti.', { items: { type: 'string' } }) }),
    allowed: (req, deps) => deps.crmAccess.canUse(req),
    run: async (i, get) => {
      const ids = [], missing = [];
      for (const raw of (Array.isArray(i.contatti) ? i.contatti : []).slice(0, 10)) {
        const id = (/^c:(\d+)$/i.exec(String(raw).trim()) || /^(\d+)$/.exec(String(raw).trim()) || [])[1];
        if (id) { ids.push(id); continue; }
        const { contacts = [] } = await get(`/api/crm/contacts?${q({ q: String(raw).slice(0, 80) })}`).catch(() => ({}));
        if (contacts.length === 1) ids.push(contacts[0].id); else missing.push(`${raw}${contacts.length ? ' (più persone: usa c:ID)' : ' (non nel CRM)'}`);
      }
      const out = ids.length ? await get(`/api/alma/email/tono?contatti=${ids.join(',')}`) : { contatti: [] };
      return { ...out, ...(missing.length ? { non_trovati: missing } : {}) };
    },
    ricevuta: (i, o) => ({ titolo: 'Posta inviata (Outlook)', filtri: ['Solo inizio e fine delle ultime 3 email per persona, non salvate'], righe: many((o.contatti || []).length, 'contatto', 'contatti') }),
  },
];

// ── ricevuta e confezione di ogni risultato ──────────────────────────────────────────────────────
function receiptOf(t, i, o) {
  let r = {};
  try { r = (t.ricevuta ? t.ricevuta(i, o) : null) || {}; } catch { r = {}; } // la ricevuta non deve mai far fallire la ricerca
  return { titolo: r.titolo || t.label, periodo: r.periodo || null, filtri: (r.filtri || []).filter(Boolean), righe: r.righe || null,
    aggiornato: r.aggiornato || `aggiornato alle ${nowTime()}`, link: r.link || null };
}
function wrap(t) {
  const run = t.run;
  t.run = async (input = {}, get, ctx) => {
    let raw = await run(input || {}, get, ctx);
    if (Array.isArray(raw)) raw = { risultati: raw };
    if (!raw || typeof raw !== 'object') return raw;
    const out = { fonte: t.label.replace(/^(Cerco|Leggo|Guardo|Apro|Riassumo|Stimo)\s+/i, '').replace(/^(in|il|la|i|le|l')\s*/i, ''), ...raw };
    Object.defineProperty(out, 'ricevuta', { value: receiptOf(t, input || {}, raw), enumerable: false });
    return out;
  };
  return t;
}
TOOLS.forEach(wrap);

module.exports = TOOLS;
module.exports.trim = trim;
module.exports.personOf = personOf;
module.exports.projectOf = projectOf;
module.exports.subjectOf = subjectOf;
module.exports.today = today;
module.exports.norm = norm;
