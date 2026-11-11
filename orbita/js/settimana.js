// Alma Project: «La mia settimana» (la pagina di partenza del modulo) e la pagina unica dei Ticket.
// La settimana mette insieme, giorno per giorno, incontri di Outlook, ticket in scadenza, RDA e mezzi prenotati;
// ogni riquadro apre il suo dettaglio. La Home di Alma Planet ne mostra solo oggi.
import { h, fill, loading, today, addDays, fmtDate, isMobile } from './ui.js';
import { get } from './api.js';
import { ticketsView, openTicket } from './tickets.js';

const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì'];
const num = n => Number(n || 0).toLocaleString('it-IT');
// luogo dell'incontro leggibile: i link delle riunioni diventano «Collegamento alla riunione», via la «\» iniziale di Outlook
export const placeOf = loc => { const l = String(loc || '').replace(/^[\\\s]+/, '').trim(); return /^https?:\/\//i.test(l) ? 'Collegamento alla riunione' : l; };

// lunedì della settimana di una data (yyyy-mm-dd)
function monday(iso) {
  const d = new Date(`${iso}T12:00:00`);
  const wd = (d.getDay() + 6) % 7; // 0 = lunedì
  return addDays(iso, -wd);
}

export async function settimanaView(container, params) {
  const start = monday(params.get('da') || today());
  const end = addDays(start, 4);
  const go = days => `#/settimana?da=${addDays(start, days)}`;
  const body = h('div.wk-body', loading());
  fill(container,
    h('div.page-head',
      h('div', h('h1', 'La mia settimana'), h('div.sub', `${fmtDate(start)} – ${fmtDate(end, { year: true })} · quello che mi aspetta, giorno per giorno.`)),
      h('div.row', h('a.btn', { href: go(-7) }, '← Settimana prima'), start !== monday(today()) ? h('a.btn', { href: '#/settimana' }, 'Questa settimana') : null, h('a.btn', { href: go(7) }, 'Dopo →'))),
    body);

  const [cal, rda, mezzi] = await Promise.all([
    get(`/api/calendar?start=${start}T00:00:00&end=${end}T23:59:59`, { quiet: true }).catch(() => ({ events: [], tickets: [], outlookError: 'non raggiungibile' })),
    get('/api/rda', { quiet: true }).catch(() => ({ inbox: [], sent: [] })),
    get(`/api/mezzi/prenotazioni?scope=mine&from=${start}T00:00:00&to=${end}T23:59:59`, { quiet: true }).catch(() => []),
  ]);
  const events = (cal.events || []).filter(e => !e.allDay);
  const tickets = (cal.tickets || []).filter(t => t.status !== 'done' && t.due_date && t.due_date >= start && t.due_date <= end);
  const rdaDue = [...(rda.inbox || []), ...(rda.sent || [])].filter(t => t.due_date && t.due_date >= start && t.due_date <= end && t.status !== 'done');
  const bookings = (mezzi || []).filter(b => ['richiesta', 'approvata', 'in_corso'].includes(b.status));
  const todayIso = today();

  const kpi = (label, value, sub, href, warn) => h('a.card.wk-kpi', { href }, h('span.small.muted', label), h('strong', { class: warn ? 'ko' : '' }, num(value)), h('span.small', sub));
  const dueToday = tickets.filter(t => t.due_date === todayIso).length;
  const items = day => [
    ...events.filter(e => String(e.start).slice(0, 10) === day).map(e => ({ at: String(e.start).slice(11, 16), kind: 'meet', el: h('a.wk-item.wk-meet', { href: e.webLink || '#/calendar', target: e.webLink ? '_blank' : null, rel: e.webLink ? 'noopener' : null },
      h('span.wk-tag', String(e.start).slice(11, 16)), h('strong', { title: e.title || '' }, e.title || 'Incontro'), placeOf(e.location) ? h('small', { title: e.location }, placeOf(e.location)) : null) })),
    ...tickets.filter(t => t.due_date === day).map(t => ({ at: '99', kind: 'ticket', el: h('button.wk-item.wk-ticket', { type: 'button', class: day < todayIso ? 'late' : day === todayIso ? 'now' : '', on: { click: () => openTicket(t.id, {}) } },
      h('span.wk-tag', 'Scade'), h('strong', t.title), t.project_name ? h('small', t.project_name) : null) })),
    ...rdaDue.filter(t => t.due_date === day).map(t => ({ at: '98', kind: 'rda', el: h('a.wk-item.wk-rda', { href: '#/rda' }, h('span.wk-tag', 'RDA'), h('strong', t.title), h('small', t.rda_function || '')) })),
    ...bookings.filter(b => String(b.start_at).slice(0, 10) <= day && String(b.end_at).slice(0, 10) >= day).map(b => ({ at: String(b.start_at).slice(11, 16), kind: 'car',
      el: h('a.wk-item.wk-car', { href: `#/mezzi/prenotazioni/${b.id}` }, h('span.wk-tag', 'Mezzo'), h('strong', [b.category_name, b.plate || b.code].filter(Boolean).join(' · ')),
        h('small', b.status === 'richiesta' ? 'da approvare' : String(b.start_at).slice(0, 10) === day ? `ritiro ${String(b.start_at).slice(11, 16)}` : 'in uso')) })),
  ].sort((a, b) => a.at.localeCompare(b.at)).map(x => x.el);

  // telefono: i cinque giorni in una fila di pulsanti, sotto il giorno scelto (oggi, se è in questa settimana)
  function phoneDays() {
    let pick = Math.max(0, DAYS.findIndex((_, i) => addDays(start, i) === todayIso));
    const box = h('section.wk-phone');
    const draw = () => {
      const day = addDays(start, pick);
      const list = items(day);
      fill(box,
        h('div.wk-pick', { role: 'tablist', 'aria-label': 'Giorno' }, DAYS.map((name, i) => {
          const d = addDays(start, i);
          return h('button', { type: 'button', role: 'tab', 'aria-selected': String(i === pick), class: [i === pick ? 'on' : '', d === todayIso ? 'today' : ''].join(' '),
            on: { click: () => { pick = i; draw(); } } }, h('span', name.slice(0, 3)), h('strong', String(Number(d.slice(8, 10)))));
        })),
        h('div.wk-phone-list', list.length ? list : h('p.small.muted', 'Niente in agenda.')));
    };
    draw();
    return box;
  }

  fill(body,
    h('section.wk-kpis',
      kpi('Ticket in scadenza', tickets.length, dueToday ? `${dueToday} oggi` : 'nessuno oggi', '#/tickets', dueToday > 0),
      kpi('Incontri', events.length, cal.outlookError ? 'Outlook non raggiungibile' : 'da Outlook', '#/calendar'),
      kpi('RDA da accettare', (rda.inbox || []).length, 'alla mia funzione', '#/rda'),
      kpi('Mezzi prenotati', bookings.length, 'questa settimana', '#/mezzi')),
    isMobile() ? phoneDays() : h('section.wk-days', DAYS.map((name, i) => {
      const day = addDays(start, i);
      const list = items(day);
      return h('div.card.wk-day', { class: day === todayIso ? 'today' : '' },
        h('h2', `${name} ${Number(day.slice(8, 10))}`, day === todayIso ? h('span.wk-now', ' oggi') : null),
        list.length ? list : h('p.small.muted', 'Niente in agenda.'));
    })),
    h('p.small.muted', 'Ogni riquadro apre il suo dettaglio. La Home di Alma Planet ne mostra solo oggi.'));
}

// Pagina unica dei ticket: «I miei» di partenza, «Creati da me» e «Tutti» con un clic.
const WHO = [['miei', 'I miei', { assignee: 'me' }], ['creati', 'Creati da me', { creator: 'me' }], ['tutti', 'Tutti', {}]];
export function ticketsPage(container, params) {
  const who = WHO.find(([k]) => k === params.get('di')) || WHO[0];
  const inner = h('div');
  const actions = h('div.tk-head-actions',
    h('nav.seg', { 'aria-label': 'Di chi' }, WHO.map(([k, l]) => h('a', { href: k === 'miei' ? '#/tickets' : `#/tickets?di=${k}`, class: k === who[0] ? 'on' : '', 'aria-current': k === who[0] ? 'page' : null }, l))));
  fill(container,
    h('div.page-head.tk-page-head',
      h('div', h('h1', 'Ticket'), h('div.sub', 'Una pagina sola: i miei di partenza, tutti con un clic.')),
      actions),
    inner);
  // bacheca a colonne di partenza, come nel layout
  ticketsView(inner, { fixed: who[2], view: 'board', page: { head: actions } });
  get('/api/tickets?assignee=me&status=open', { quiet: true }).then(list => {
    const a = container.querySelector('.seg a');
    if (a && Array.isArray(list)) a.textContent = `I miei · ${list.length}`;
  }).catch(() => {});
}
