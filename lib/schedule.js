// Programmazione automatica delle attività collegate, come in Microsoft Project.
// Ogni collegamento ha un tipo e uno scarto (lag) in giorni lavorativi, anche negativo (anticipo):
//   FS fine-inizio  il successore inizia dopo la fine del predecessore (+ scarto)
//   SS inizio-inizio il successore inizia quando inizia il predecessore (+ scarto)
//   FF fine-fine    il successore finisce quando finisce il predecessore (+ scarto)
//   SF inizio-fine  il successore finisce quando inizia il predecessore (+ scarto)
// Un'attività con predecessori parte il prima possibile: la data più tarda imposta dai suoi collegamenti. Se un
// predecessore si sposta (avanti o indietro), i successori lo seguono a catena mantenendo scarti e durata
// (in giorni lavorativi). Le attività completate non si spostano. Le milestone (solo scadenza) durano 0 giorni.
const { addWorkdays, isWorkday, workdaysBetween, workdaysIn } = require('./workdays');

const LINK_TYPES = ['FS', 'SS', 'FF', 'SF'];

// Inizio, fine, durata di un ticket; null se non ha date.
function span(t) {
  if (!t || (!t.start_date && !t.due_date)) return null;
  const ms = !t.start_date;
  const s = t.start_date || t.due_date, f = t.due_date || t.start_date;
  return { s, f, ms, dur: ms ? 0 : Math.max(1, workdaysIn(s, f)) };
}

// Vincolo che un collegamento impone al successore: { start } oppure { finish }.
function constraint(type, lag, P, T) {
  switch (type) {
    case 'SS': return { start: addWorkdays(P.s, lag) };
    case 'FF': return { finish: addWorkdays(P.f, lag) };
    case 'SF': return { finish: addWorkdays(P.s, T.ms ? lag : lag - 1) };
    default: return { start: addWorkdays(P.f, T.ms ? lag : lag + 1) }; // FS
  }
}

// Lo scarto che rende il collegamento esatto con le date di oggi (l'inverso di constraint).
function lagFor(type, P, T) {
  switch (type) {
    case 'SS': return workdaysBetween(P.s, T.s);
    case 'FF': return workdaysBetween(P.f, T.f);
    case 'SF': return workdaysBetween(P.s, T.f) + (T.ms ? 0 : 1);
    default: return workdaysBetween(P.f, T.s) - (T.ms ? 0 : 1);
  }
}

// Nuove date di T dati i vincoli: parte il prima possibile, cioè dal vincolo più tardo; durata invariata.
function place(T, cons) {
  let start = null;
  for (const c of cons) {
    const s = c.start || (T.ms ? c.finish : addWorkdays(c.finish, -(T.dur - 1)));
    if (!start || s > start) start = s;
  }
  if (!T.ms && !isWorkday(start)) start = addWorkdays(start, 1); // un'attività non inizia di sabato, domenica o festivo
  return { s: start, f: T.ms ? start : addWorkdays(start, T.dur - 1) };
}

// Scrive le nuove date mantenendo la forma del ticket: milestone = solo scadenza, solo inizio = solo inizio.
function datesFor(t, s, f) {
  if (!t.start_date) return { start_date: null, due_date: f };
  if (!t.due_date) return { start_date: s, due_date: null };
  return { start_date: s, due_date: f };
}

async function loadTickets(q, ids) {
  const { rows } = await q.query('SELECT id, title, start_date, due_date, status FROM tickets WHERE id = ANY($1::int[])', [[...ids]]);
  return new Map(rows.map(r => [r.id, r]));
}

// Riprogramma i successori (diretti e indiretti) di rootId; con self anche rootId stesso (collegamenti appena cambiati).
// Restituisce le attività spostate: [{ id, title, start_date, due_date }].
async function reschedule(q, rootId, { self = false } = {}) {
  const { rows: down } = await q.query(`
    WITH RECURSIVE down(id) AS (
      SELECT ticket_id FROM ticket_deps WHERE depends_on_id = $1
      UNION SELECT d.ticket_id FROM ticket_deps d JOIN down ON d.depends_on_id = down.id
    ) SELECT id FROM down`, [rootId]);
  const targets = new Set(down.map(r => r.id));
  if (self) targets.add(rootId);
  if (!targets.size) return [];
  const { rows: links } = await q.query(
    'SELECT ticket_id, depends_on_id, type, lag FROM ticket_deps WHERE ticket_id = ANY($1::int[])', [[...targets]]);
  const tickets = await loadTickets(q, new Set([...targets, ...links.map(l => l.depends_on_id)]));

  // ordine: ogni attività dopo tutti i suoi predecessori (i collegamenti non hanno cicli: lo controlla setDeps)
  const incoming = new Map([...targets].map(id => [id, []]));
  for (const l of links) incoming.get(l.ticket_id).push(l);
  const waiting = new Map([...targets].map(id => [id, incoming.get(id).filter(l => targets.has(l.depends_on_id)).length]));
  const order = [...targets].filter(id => !waiting.get(id));
  for (let i = 0; i < order.length; i++) {
    for (const l of links) {
      if (l.depends_on_id !== order[i]) continue;
      waiting.set(l.ticket_id, waiting.get(l.ticket_id) - 1);
      if (!waiting.get(l.ticket_id)) order.push(l.ticket_id);
    }
  }

  const moved = [];
  for (const id of order) {
    const t = tickets.get(id), T = span(t);
    if (!T || t.status === 'done') continue;
    const cons = [];
    for (const l of incoming.get(id)) {
      const P = span(tickets.get(l.depends_on_id));
      if (!P) continue; // un predecessore senza date non vincola
      cons.push(constraint(l.type, l.lag ?? lagFor(l.type, P, T), P, T));
    }
    if (!cons.length) continue;
    const { s, f } = place(T, cons);
    if (s === T.s && f === T.f) continue;
    const dates = datesFor(t, s, f);
    await q.query('UPDATE tickets SET start_date = $2, due_date = $3, updated_at = now() WHERE id = $1', [id, dates.start_date, dates.due_date]);
    Object.assign(t, dates);
    moved.push({ id, title: t.title, ...dates });
  }
  return moved;
}

// L'utente ha messo a mano le date di un'attività con predecessori: resta dove l'ha messa e i suoi collegamenti
// prendono lo scarto che ha ora da ciascun predecessore (da qui in poi lo mantengono).
async function fitLags(q, id) {
  const { rows: links } = await q.query('SELECT depends_on_id, type FROM ticket_deps WHERE ticket_id = $1', [id]);
  if (!links.length) return;
  const tickets = await loadTickets(q, new Set([id, ...links.map(l => l.depends_on_id)]));
  const T = span(tickets.get(id));
  for (const l of links) {
    const P = span(tickets.get(l.depends_on_id));
    await q.query('UPDATE ticket_deps SET lag = $3 WHERE ticket_id = $1 AND depends_on_id = $2',
      [id, l.depends_on_id, P && T ? lagFor(l.type, P, T) : 0]);
  }
}

// All'avvio: i collegamenti senza scarto (quelli di prima della 016) prendono lo scarto che hanno oggi.
async function backfillLags(db) {
  const { rows } = await db.query('SELECT DISTINCT ticket_id FROM ticket_deps WHERE lag IS NULL');
  for (const r of rows) await fitLags(db, r.ticket_id);
  if (rows.length) console.log(`[gantt] scarto calcolato per i collegamenti di ${rows.length} attività`);
}

module.exports = { LINK_TYPES, span, constraint, lagFor, place, reschedule, fitLags, backfillLags };
