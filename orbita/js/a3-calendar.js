// Calendario dell'A3: la settimana del proprio calendario Outlook, con in evidenza gli incontri già collegati
// all'A3. Da qui si fissa un incontro come in Outlook (invitati: i membri del progetto) e nasce già collegato;
// un incontro del calendario si collega con un clic. Gli incontri fatti senza note sono segnalati.
import { h, fill, modal, toast, loading, today, addDays } from './ui.js';
import { icon } from './icons.js';
import { get, post } from './api.js';
import { store, userById } from './store.js';
import { openMeeting } from './project-meetings.js';

const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const H0 = 8, H1 = 20, ROW = 44; // ore visibili e altezza di un'ora in px
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mondayOf = iso => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDay(d); };
const hours = s => Number(s.slice(11, 13)) + Number(s.slice(14, 16)) / 60;
const hhmm = s => s.slice(11, 16);

export function a3Calendar(box, p, { color = '#FF8A26' } = {}) {
  let week = mondayOf(today());
  let showWeekend = false;
  let events = [], meetings = [], members = [];
  const body = h('div.a3c-body', loading());
  const title = h('strong.a3c-title');
  const warn = h('div');
  box.append(
    h('div.a3c-head',
      h('div.row', h('button.btn.btn-sm', { type: 'button', 'aria-label': 'Settimana prima', on: { click: () => { week = addDays(week, -7); load(); } } }, '‹'),
        h('button.btn.btn-sm', { type: 'button', on: { click: () => { week = mondayOf(today()); load(); } } }, 'Oggi'),
        h('button.btn.btn-sm', { type: 'button', 'aria-label': 'Settimana dopo', on: { click: () => { week = addDays(week, 7); load(); } } }, '›'), title),
      h('div.row',
        h('label.a3c-we', h('input', { type: 'checkbox', on: { change: e => { showWeekend = e.target.checked; draw(); } } }), 'Sabato e domenica'),
        h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => schedule() } }, icon('plus', { size: 14 }), 'Fissa un incontro'))),
    warn,
    h('div.a3c-legend', h('span', h('i', { style: { background: color } }), 'collegato all’A3'), h('span', h('i.other'), 'altro nel tuo calendario: clicca per collegarlo'), h('span', h('i.nonotes'), 'fatto, senza note')),
    body);

  async function load() {
    fill(body, loading());
    const end = addDays(week, 7);
    const d0 = new Date(`${week}T12:00:00`), d6 = new Date(`${addDays(week, 6)}T12:00:00`);
    title.textContent = `${d0.getDate()} ${d0.toLocaleDateString('it-IT', { month: 'short' })} – ${d6.getDate()} ${d6.toLocaleDateString('it-IT', { month: 'short', year: 'numeric' })}`;
    try {
      [events, meetings] = await Promise.all([
        get(`/api/meetings/calendar?start=${week}&end=${end}&project=${p.id}`),
        get(`/api/projects/${p.id}/meetings`)]);
    } catch (err) {
      return fill(body, h('div.card.empty', err.message || 'Calendario Outlook non disponibile.'));
    }
    if (!members.length) members = await get(`/api/projects/${p.id}/members`).catch(() => []);
    const missing = meetings.filter(m => String(m.start_at).slice(0, 10) <= today() && !m.note_count);
    fill(warn, missing.length ? h('div.mt-warn', icon('alarm-clock', { size: 16 }),
      h('span', ` ${missing.length === 1 ? 'Un incontro fatto non ha' : `${missing.length} incontri fatti non hanno`} ancora le note: `),
      missing.slice(0, 3).map((m, i) => [i ? ', ' : '', h('button.link-btn', { type: 'button', on: { click: () => openMeeting(m.id, p, load) } }, m.subject)])) : null);
    draw();
  }

  const meetingFor = e => meetings.find(m => m.start_at === e.start && m.subject === e.subject);

  function draw() {
    const n = showWeekend ? 7 : 5;
    const days = Array.from({ length: n }, (_, i) => addDays(week, i));
    const grid = h('div.a3c-grid', { style: { gridTemplateColumns: `52px repeat(${n}, minmax(0, 1fr))` } },
      h('div.a3c-corner'),
      days.map((d, i) => h('div.a3c-day', { class: d === today() ? 'now' : '' }, `${DAYS[i]} ${Number(d.slice(8, 10))}`)),
      h('div.a3c-hours', Array.from({ length: H1 - H0 }, (_, i) => h('span', { style: { height: `${ROW}px` } }, `${H0 + i}:00`))),
      days.map(d => {
        const col = h('div.a3c-col', { style: { height: `${(H1 - H0) * ROW}px` } },
          Array.from({ length: H1 - H0 }, (_, i) => h('button.a3c-slot', { type: 'button', title: `Fissa un incontro alle ${H0 + i}:00`, 'aria-label': `Fissa un incontro ${d} alle ${H0 + i}:00`,
            style: { top: `${i * ROW}px`, height: `${ROW}px` }, 'data-label': `+ Fissa alle ${H0 + i}:00`, on: { click: () => schedule(`${d}T${pad(H0 + i)}:00`) } })));
        for (const e of events.filter(x => !x.all_day && x.start.slice(0, 10) === d)) {
          const top = Math.max(0, (hours(e.start) - H0) * ROW), bottom = Math.min((H1 - H0) * ROW, (hours(e.end || e.start) - H0) * ROW);
          if (bottom <= 0 || top >= (H1 - H0) * ROW) continue;
          const m = e.linked ? meetingFor(e) : null;
          const noNotes = m && d <= today() && !m.note_count;
          col.append(h('button.a3c-ev', { type: 'button', class: `${e.linked ? 'linked' : 'other'} ${noNotes ? 'nonotes' : ''}`,
            style: { top: `${top}px`, height: `${Math.max(22, bottom - top - 2)}px`, ...(e.linked ? { background: color, borderColor: color } : {}) },
            title: e.linked ? (noNotes ? 'Incontro dell’A3 senza note: aprilo e scrivile' : 'Incontro dell’A3: apri le note') : 'Collega questo incontro all’A3',
            on: { click: () => (e.linked ? (m ? openMeeting(m.id, p, load) : null) : linkOne(e)) } },
          h('strong', e.subject), h('small', `${hhmm(e.start)}–${hhmm(e.end || e.start)}${e.location ? ` · ${e.location}` : ''}`),
          noNotes ? h('span.a3c-flag', icon('alarm-clock', { size: 12 }), 'note mancanti') : null));
        }
        if (d === today()) {
          const now = new Date(), t = (now.getHours() + now.getMinutes() / 60 - H0) * ROW;
          if (t > 0 && t < (H1 - H0) * ROW) col.append(h('i.a3c-now', { style: { top: `${t}px` } }));
        }
        return col;
      }));
    const allDay = events.filter(e => e.all_day);
    fill(body, allDay.length ? h('div.a3c-allday', h('span.muted.small', 'Tutto il giorno: '), allDay.map(e => h('span.pill', e.subject))) : null,
      h('div.a3c-scroll', grid));
  }

  async function linkOne(e) {
    const m = modal({
      title: 'Collegare all’A3?',
      body: [h('p', h('strong', e.subject)), h('p.muted', `${e.start.slice(0, 10).split('-').reverse().join('/')} · ${hhmm(e.start)}–${hhmm(e.end || e.start)}`),
        h('p.muted.small', 'Lo vedranno tutti quelli che vedono l’A3; dopo l’incontro ci si scrivono le note.')],
      actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
        h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await post(`/api/projects/${p.id}/meetings`, { event_ids: [e.id] }); m.close(); toast('Incontro collegato all’A3'); load(); } } }, 'Collega')],
    });
  }

  function schedule(startIso) {
    const start = startIso || `${today() < week ? week : today()}T${pad(Math.min(Math.max(new Date().getHours() + 1, H0), H1 - 1))}:00`;
    const subject = h('input.input', { maxlength: 255, value: `${p.name} · `, 'aria-label': 'Titolo' });
    const day = h('input.input', { type: 'date', value: start.slice(0, 10) });
    const from = h('input.input', { type: 'time', value: start.slice(11, 16), step: 900 });
    const to = h('input.input', { type: 'time', value: `${pad(Math.min(23, Number(start.slice(11, 13)) + 1))}:${start.slice(14, 16)}`, step: 900 });
    const online = h('input', { type: 'checkbox', checked: true });
    const place = h('input.input', { maxlength: 255, placeholder: 'Facoltativo' });
    const desc = h('textarea.input', { rows: 3, placeholder: 'Ordine del giorno (finisce nell’invito)' });
    const people = members.filter(u => u.id !== store.me.id && u.email);
    const picks = people.map(u => h('label.a3c-person', h('input', { type: 'checkbox', checked: true, value: u.email }), userById(u.id)?.name || u.name));
    const extra = h('input.input', { placeholder: 'Altre email, separate da virgola' });
    const m = modal({
      title: 'Fissa un incontro dell’A3',
      wide: true,
      body: [
        h('label.field', h('span', 'Titolo'), subject),
        h('div.a3c-when', h('label.field', h('span', 'Giorno'), day), h('label.field', h('span', 'Dalle'), from), h('label.field', h('span', 'Alle'), to)),
        h('label.a3c-online', online, ' Riunione Teams'),
        h('label.field', h('span', 'Luogo'), place),
        h('div.field', h('span', 'Invitati (i membri del progetto)'), people.length ? h('div.a3c-people', picks) : h('p.muted.small', 'Nessun altro membro nel progetto.'), extra),
        h('label.field', h('span', 'Descrizione'), desc),
        h('p.muted.small', 'L’incontro nasce nel tuo calendario Outlook, parte l’invito a chi hai scelto ed è già collegato all’A3. Dopo, ricordati le note.')],
      actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
        h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
          if (!subject.value.trim() || !day.value || !from.value || !to.value) { toast('Titolo, giorno e orari sono obbligatori', 'err'); return; }
          const attendees = [...picks.map(l => l.querySelector('input')).filter(i => i.checked).map(i => i.value),
            ...extra.value.split(',').map(s => s.trim()).filter(Boolean)];
          await post(`/api/projects/${p.id}/meetings/new`, { title: subject.value.trim(), start: `${day.value}T${from.value}`, end: `${day.value}T${to.value}`,
            online: online.checked, location: place.value, body: desc.value, attendees });
          m.close(); toast('Incontro fissato e collegato all’A3'); week = mondayOf(day.value); load();
        } } }, 'Fissa e invita')],
    });
  }

  load();
}
