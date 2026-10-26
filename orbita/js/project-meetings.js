// Incontri del progetto: quelli collegati dal calendario Outlook (come le email), la scheda dell'incontro con le sue
// note e i suoi file, e «Collega incontro», che apre il proprio calendario per sceglierne uno o più.
// Le note dell'incontro sono note del progetto (tipo «Riunione»): compaiono anche nel tab Note.
import { h, fill, avatar, modal, toast, loading, debounce, confirmDialog, fmtDate, fmtSize, today, addDays } from './ui.js';
import { icon } from './icons.js';
import { api, get, post, del } from './api.js';
import { store, userById, activeProjects, loadProjects } from './store.js';
import { withMentions } from './social.js';

const canRemove = (m, p) => m.linked_by === store.me.id || p.my_role === 'owner' || p.my_role === 'admin';
const FILE_MAX = 20 * 1024 * 1024;
const DAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

// «lun 26 ott · 9:00–10:30» (orari già in ora italiana)
export function meetingWhen(m) {
  const day = String(m.start_at || m.start).slice(0, 10);
  const d = new Date(`${day}T12:00:00`);
  const hhmm = s => String(s || '').slice(11, 16).replace(/^0/, '');
  const end = m.end_at || m.end;
  const time = (m.all_day ?? m.allDay) ? 'tutto il giorno' : `${hhmm(m.start_at || m.start)}${end ? `–${hhmm(end)}` : ''}`;
  return `${DAYS[d.getDay()].slice(0, 3)} ${fmtDate(day)} · ${time}`;
}
const isPast = m => String(m.start_at || m.start).slice(0, 10) <= today();

// Carica dei file su una nota (uno alla volta, nel database). Ritorna quanti sono andati.
export async function uploadNoteFiles(noteId, files) {
  let ok = 0;
  for (const f of files) {
    if (f.size > FILE_MAX) { toast(`«${f.name}» supera 20 MB: non caricato`, 'err'); continue; }
    try {
      await api('POST', `/api/notes/${noteId}/files?name=${encodeURIComponent(f.name)}&type=${encodeURIComponent(f.type || 'application/octet-stream')}`, f,
        { raw: true, headers: { 'Content-Type': 'application/octet-stream' } });
      ok++;
    } catch { /* l'errore lo mostra già api() */ }
  }
  return ok;
}

export function noteFileLinks(n, onChange) {
  if (!n.files?.length) return null;
  return h('div.mt-files', n.files.map(f => h('span.mt-file',
    h('a', { href: `/api/note-files/${f.id}`, download: f.name, title: 'Scarica' }, icon('paperclip', { size: 13 }), ' ', f.name, h('span.muted', ` ${fmtSize(f.size)}`)),
    onChange && (f.added_by === store.me.id || n.author_id === store.me.id || store.me.is_admin)
      ? h('button.mt-file-x', { type: 'button', title: 'Togli il file', 'aria-label': `Togli «${f.name}»`, on: { click: async () => {
        if (!await confirmDialog(`Togliere «${f.name}»?`, { ok: 'Togli', danger: true })) return;
        await del(`/api/note-files/${f.id}`);
        onChange();
      } } }, '×') : null)));
}

// ── elenco nel progetto ──────────────────────────────────────────────────────
export function projectMeetings(box, p, { onCount } = {}) {
  let meetings = [];
  const listBox = h('div.mt-list', loading());
  const count = h('span.pe-count');
  box.append(
    h('div.pe-head',
      h('h3', 'Incontri', count),
      h('div.row', h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => linkDialog(p, load) } }, '＋ Collega incontro'))),
    listBox);

  async function load() {
    try { meetings = await get(`/api/projects/${p.id}/meetings`); } catch { return fill(listBox, h('p.muted', 'Incontri non disponibili.')); }
    count.textContent = meetings.length ? String(meetings.length) : '';
    onCount?.(meetings.length);
    if (!meetings.length) {
      return fill(listBox, h('div.pe-empty', h('strong', 'Nessun incontro nel progetto.'),
        h('span.muted', 'Con «Collega incontro» scegli dal tuo calendario Outlook le riunioni del progetto. Dopo l\'incontro ci aggiungi note e file: finiscono anche nel tab Note.')));
    }
    const upcoming = meetings.filter(m => !isPast(m)).reverse(); // dal più vicino
    const past = meetings.filter(isPast);
    fill(listBox, [
      upcoming.length ? [h('div.mt-group', 'In programma'), upcoming.map(row)] : null,
      past.length ? [h('div.mt-group', 'Fatti'), past.map(row)] : null,
    ]);
  }

  function row(m) {
    const by = userById(m.linked_by);
    return h('button.pe-row.mt-row', { type: 'button', on: { click: () => openMeeting(m.id, p, load) } },
      h('span.mt-cal', h('span.mt-cal-m', fmtDate(m.start_at).split(' ')[1] || ''), h('span.mt-cal-d', String(Number(String(m.start_at).slice(8, 10))))),
      h('div.pe-main',
        h('div.pe-subject', m.subject),
        h('div.pe-preview', meetingWhen(m), m.location ? ` · ${m.location}` : ''),
        h('div.mt-counts',
          m.note_count ? h('span', icon('file', { size: 13 }), ` ${m.note_count} ${m.note_count === 1 ? 'nota' : 'note'}`) : h('span.muted', isPast(m) ? 'Nessuna nota' : ''),
          m.file_count ? h('span', icon('paperclip', { size: 13 }), ` ${m.file_count} file`) : null)),
      by ? h('span.pe-by', { title: `Collegato da ${by.name}` }, avatar(by, 22)) : null);
  }

  load();
  return { reload: load };
}

// ── scheda dell'incontro: dati copiati da Outlook, note e file ───────────────
export async function openMeeting(id, p, onChange) {
  let m;
  try { m = await get(`/api/meetings/${id}`); } catch { return; }
  const by = userById(m.linked_by);
  const notesBox = h('div.mt-notes');
  const people = list => list.map(x => x.name || x.address).join(', ');

  const body = h('textarea.input', { rows: 4, placeholder: isPast(m) ? 'Com\'è andato? Decisioni, cose da fare… usa @ per menzionare un collega' : 'Puoi già preparare l\'ordine del giorno… usa @ per menzionare un collega', maxLength: 20000 });
  const fileIn = h('input', { type: 'file', multiple: true, hidden: true });
  const chosen = h('div.mt-chosen');
  const saveBtn = h('button.btn.btn-primary.btn-sm', { type: 'button', disabled: true }, 'Aggiungi');
  const refreshSave = () => { saveBtn.disabled = !body.value.trim() && !fileIn.files.length; };
  body.addEventListener('input', refreshSave);
  fileIn.addEventListener('change', () => {
    fill(chosen, [...fileIn.files].map(f => h('span.mt-file', icon('paperclip', { size: 13 }), ` ${f.name}`, h('span.muted', ` ${fmtSize(f.size)}`))));
    refreshSave();
  });
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const files = [...fileIn.files];
    try {
      const n = await post(`/api/meetings/${m.id}/notes`, { body: body.value.trim(), with_files: files.length > 0 });
      const up = files.length ? await uploadNoteFiles(n.id, files) : 0;
      body.value = ''; fileIn.value = ''; fill(chosen);
      toast(files.length ? `Aggiunta all'incontro${up ? ` con ${up} file` : ''}, anche nelle note del progetto` : 'Nota aggiunta all\'incontro e alle note del progetto');
      if (n.mentions?.notified?.length) toast(`Notifica inviata a ${n.mentions.notified.map(uid => userById(uid)?.name || 'un collega').join(', ')}`);
      await reload();
      onChange?.();
    } catch { refreshSave(); }
  });

  async function reload() {
    try { m = await get(`/api/meetings/${id}`); } catch { return; }
    drawNotes();
  }
  function drawNotes() {
    fill(notesBox, m.notes.length
      ? m.notes.map(n => {
        const a = userById(n.author_id);
        return h('article.mt-note',
          h('div.mt-note-head', a ? avatar(a, 22) : null, h('strong', a?.name || 'Utente rimosso'), h('span.muted.small', ` · ${fmtDate(n.created_at, { year: false })}`)),
          n.body ? h('div.mt-note-body', n.body) : null,
          noteFileLinks(n, reload));
      })
      : h('p.muted.small', isPast(m) ? 'Ancora nessuna nota su questo incontro.' : 'L\'incontro non c\'è ancora stato.'));
  }
  drawNotes();

  const dlg = modal({
    title: m.subject,
    wide: true,
    body: [
      h('div.pe-meta',
        h('div.row', icon('calendar', { size: 15 }), h('strong', meetingWhen(m))),
        m.location ? h('div.row', icon('map-pin', { size: 15 }), m.location) : null,
        m.organizer_name || m.organizer_address ? h('div', h('span.muted', 'Organizzatore '), m.organizer_name || m.organizer_address) : null,
        m.attendees.length ? h('div', h('span.muted', 'Partecipanti '), people(m.attendees)) : null,
        m.online_url ? h('div', h('a.link', { href: m.online_url, target: '_blank', rel: 'noopener noreferrer' }, 'Link della riunione Teams')) : null,
        by ? h('div.muted', `collegato da ${by.name}`) : null),
      m.body_text ? h('details.mt-desc', h('summary', 'Descrizione dell\'invito'), h('div.pe-body', m.body_text)) : null,
      h('h3.mt-notes-title', 'Note e file dell\'incontro'),
      notesBox,
      h('div.mt-add',
        withMentions(body),
        h('div.mt-add-foot',
          h('button.btn.btn-sm', { type: 'button', on: { click: () => fileIn.click() } }, icon('paperclip', { size: 15 }), 'Allega file'),
          fileIn, chosen, h('span.grow'), saveBtn),
        h('div.muted.small', 'Le note e i file dell\'incontro compaiono anche nel tab Note del progetto.')),
    ],
    left: canRemove(m, p) ? [h('button.btn.btn-danger', { type: 'button', on: { click: async () => {
      if (!await confirmDialog('Togliere l\'incontro dal progetto? Nel calendario Outlook resta com\'è, e le sue note restano nel tab Note.', { ok: 'Togli', danger: true })) return;
      await del(`/api/meetings/${m.id}`);
      dlg.close();
      toast('Incontro tolto dal progetto');
      onChange?.();
    } } }, 'Togli dal progetto')] : [],
    actions: [
      m.web_link ? h('a.btn', { href: m.web_link, target: '_blank', rel: 'noopener' }, 'Apri in Outlook') : null,
      h('button.btn.btn-primary', { type: 'button', on: { click: () => dlg.close() } }, 'Chiudi'),
    ].filter(Boolean),
  });
}

// ── collegare dal proprio calendario ─────────────────────────────────────────
// Si guarda una finestra di 30 giorni alla volta: «Prima» e «Dopo» la spostano. Si parte dagli ultimi 30 giorni.
function linkDialog(p, onDone) {
  if (!store.me.microsoft) return toast('Outlook non è collegato: serve l\'accesso con Microsoft', 'err');
  let from = addDays(today(), -29);
  const picked = new Set();
  const listBox = h('div.pe-pick-list', loading());
  const search = h('input.input', { type: 'search', placeholder: 'Cerca per titolo, luogo o organizzatore…' });
  const range = h('strong.mt-range');
  const counter = h('span.muted');
  const linkBtn = h('button.btn.btn-primary', { type: 'button', disabled: true }, 'Collega');
  const shift = days => { from = addDays(from, days); reload(); };

  const dlg = modal({
    title: `Collega incontri a «${p.name}»`,
    wide: true,
    body: [h('div.pe-pick-bar',
      h('button.btn.btn-sm', { type: 'button', on: { click: () => shift(-30) } }, '‹ Prima'), range,
      h('button.btn.btn-sm', { type: 'button', on: { click: () => shift(30) } }, 'Dopo ›'), search), listBox],
    left: [counter],
    actions: [h('button.btn', { type: 'button', on: { click: () => dlg.close() } }, 'Annulla'), linkBtn],
  });
  dlg.box.classList.add('pe-pick-modal');

  function updateFooter() {
    counter.textContent = picked.size ? `${picked.size} ${picked.size === 1 ? 'selezionato' : 'selezionati'}` : 'Seleziona uno o più incontri';
    linkBtn.disabled = !picked.size;
    linkBtn.textContent = picked.size > 1 ? `Collega ${picked.size} incontri` : 'Collega';
  }

  async function reload() {
    const to = addDays(from, 30);
    range.textContent = `${fmtDate(from)} – ${fmtDate(addDays(to, -1))}`;
    fill(listBox, loading());
    try {
      const evs = await get(`/api/meetings/calendar?start=${from}&end=${to}&project=${p.id}${search.value.trim() ? `&q=${encodeURIComponent(search.value.trim())}` : ''}`, { quiet: true });
      if (!evs.length) return fill(listBox, h('p.muted.pe-none', search.value.trim() ? 'Nessun incontro trovato in questo periodo.' : 'Nessun incontro in questo periodo.'));
      // dal più recente, così dopo una riunione la si trova in cima
      fill(listBox, evs.reverse().map(row));
    } catch (err) {
      fill(listBox, h('div.banner', err?.code === 'calendar_read'
        ? 'Per leggere il calendario serve il permesso di Microsoft. Un amministratore deve approvarlo in Entra; poi esci e rientra in Alma Planet.'
        : err?.message || 'Outlook non risponde, riprova tra poco.'));
    }
  }

  function row(ev) {
    const on = picked.has(ev.id);
    const box = h('input', { type: 'checkbox', checked: on || ev.linked, disabled: ev.linked, tabIndex: -1 });
    const el = h('label.pe-pick', { class: [on ? 'on' : '', ev.linked ? 'done' : ''].join(' ') },
      box,
      h('div.pe-main',
        h('div.pe-line', h('strong.pe-from', ev.subject), h('span.pe-date', meetingWhen(ev))),
        h('div.pe-preview', [ev.location, ev.organizer.name ? `organizza ${ev.organizer.name}` : '', ev.attendee_count ? `${ev.attendee_count} invitati` : '', ev.online ? 'Teams' : ''].filter(Boolean).join(' · ') || ' ',
          ev.linked ? h('span.pill.pe-already', 'già nel progetto') : null)));
    box.addEventListener('change', () => {
      if (box.checked) picked.add(ev.id); else picked.delete(ev.id);
      el.classList.toggle('on', box.checked);
      updateFooter();
    });
    return el;
  }

  search.addEventListener('input', debounce(reload, 400));
  linkBtn.addEventListener('click', async () => {
    linkBtn.disabled = true;
    linkBtn.textContent = 'Collego…';
    try {
      const r = await post(`/api/projects/${p.id}/meetings`, { event_ids: [...picked] });
      dlg.close();
      toast(r.added ? `${r.added} ${r.added === 1 ? 'incontro collegato' : 'incontri collegati'} al progetto${r.already ? ` (${r.already} c'erano già)` : ''}` : 'Gli incontri erano già nel progetto');
      onDone?.();
    } catch { updateFooter(); }
  });

  updateFooter();
  reload();
}

// ── dal Calendario: «Collega a un progetto» su un evento di Outlook ───────────
export async function linkEventToProject(ev) {
  await loadProjects();
  const projects = activeProjects();
  if (!projects.length) return toast('Non vedi nessun progetto attivo', 'err');
  const sel = h('select.select', { autofocus: true }, h('option', { value: '' }, 'Scegli il progetto…'), projects.map(x => h('option', { value: String(x.id) }, x.name)));
  const ok = h('button.btn.btn-primary', { type: 'button', disabled: true }, 'Collega');
  sel.addEventListener('change', () => { ok.disabled = !sel.value; });
  const dlg = modal({
    title: `Collega «${ev.title}» a un progetto`,
    body: [h('label.field', h('span', 'Progetto'), sel),
      h('div.muted.small', 'Lo vedranno tutti i membri del progetto; dopo l\'incontro potrete aggiungerci note e file.')],
    actions: [h('button.btn', { type: 'button', on: { click: () => dlg.close() } }, 'Annulla'), ok],
  });
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    const pid = Number(sel.value);
    try {
      const r = await post(`/api/projects/${pid}/meetings`, { event_ids: [ev.id] });
      dlg.close();
      const p = projects.find(x => x.id === pid);
      toast(r.added ? `Collegato a «${p.name}»` : `Era già in «${p.name}»`);
      location.hash = `#/projects/${pid}/incontri`;
      if (r.ids?.[0]) openMeeting(r.ids[0], p);
    } catch { ok.disabled = false; }
  });
}
