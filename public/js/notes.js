// Note con data su progetti e ticket (come le note del CRM di MyWinery): tipo, data, titolo facoltativo,
// «fissa in alto», autore e «modificata il». Le modifica chi le ha scritte (o un amministratore);
// dopo l'eliminazione c'è «Annulla» per qualche secondo. Nel progetto compaiono anche le note dei suoi ticket.
import { h, clear, fill, avatar, toast, fmtDate, fmtDateTime, today, loading } from './ui.js';
import { get, post, patch, del } from './api.js';
import { store, userById } from './store.js';

export const NOTE_KINDS = [['nota', 'Nota'], ['telefonata', 'Telefonata'], ['riunione', 'Riunione'], ['decisione', 'Decisione']];
const KIND_LABEL = Object.fromEntries(NOTE_KINDS);
const canEdit = n => n.author_id === store.me.id || Boolean(store.me.is_admin);

function linkify(text) {
  const out = [];
  let last = 0;
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g)) {
    out.push(text.slice(last, m.index), h('a.link', { href: m[0], target: '_blank', rel: 'noopener noreferrer' }, m[0]));
    last = m.index + m[0].length;
  }
  out.push(String(text || '').slice(last));
  return out;
}

// Messaggio in basso con «Annulla» (l'eliminazione si può ripristinare).
function undoToast(message, onUndo) {
  const root = document.getElementById('toasts');
  if (!root) return;
  let done = false;
  const el = h('div.toast.nt-undo', h('span', message), h('button', { type: 'button', on: { click: async () => {
    if (done) return;
    done = true;
    el.remove();
    await onUndo();
  } } }, 'Annulla'));
  root.append(el);
  setTimeout(() => { done = true; el.remove(); }, 6000);
}

// box: dove disegnare; url: /api/projects/:id/notes oppure /api/tickets/:id/notes;
// showTicket: nel progetto, le note dei ticket portano il collegamento al ticket; onCount(n): per i contatori.
export function notesPanel(box, { url, showTicket = false, onCount, title = 'Note' } = {}) {
  let notes = [], editing = null, adding = false, filter = 'all';
  const listBox = h('div.nt-list', loading());
  const search = h('input.input.nt-search', { type: 'search', placeholder: 'Cerca nelle note…' });
  const count = h('span.nt-count');
  const newBtn = h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => { adding = true; editing = null; draw(); } } }, '＋ Nuova nota');
  const kinds = h('div.seg.nt-kinds', [['all', 'Tutte'], ...NOTE_KINDS].map(([k, label]) => h('button', {
    type: 'button', 'data-k': k, class: k === filter ? 'on' : '',
    on: { click: () => { filter = k; kinds.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); draw(); } },
  }, label)));
  search.addEventListener('input', draw);

  box.append(h('div.nt-head', h('h3', title, count), h('div.nt-tools', search, newBtn)), kinds, listBox);

  async function load() {
    try { notes = await get(url); } catch { return fill(listBox, h('p.muted', 'Note non disponibili.')); }
    draw();
  }

  function draw() {
    count.textContent = notes.length ? String(notes.length) : '';
    onCount?.(notes.length);
    newBtn.hidden = adding;
    const q = search.value.trim().toLowerCase();
    const shown = notes.filter(n => (filter === 'all' || n.kind === filter)
      && (!q || `${n.title} ${n.body} ${n.ticket_title || ''}`.toLowerCase().includes(q)));
    const items = [];
    if (adding) items.push(editor(null));
    for (const n of shown) items.push(editing === n.id ? editor(n) : card(n));
    if (!items.length) {
      items.push(notes.length
        ? h('p.muted.nt-none', 'Nessuna nota corrisponde.')
        : h('div.nt-empty', h('strong', 'Nessuna nota.'), h('span.muted', 'Annota telefonate, riunioni e decisioni con la loro data: restano qui per tutti.')));
    }
    fill(listBox, items);
  }

  function card(n) {
    const author = userById(n.author_id);
    const mine = canEdit(n);
    const actions = mine ? h('div.nt-actions',
      h('button.link-btn', { type: 'button', on: { click: () => { editing = n.id; adding = false; draw(); } } }, 'Modifica'),
      h('button.link-btn', { type: 'button', on: { click: () => save(n, { pinned: !n.pinned }) } }, n.pinned ? 'Sgancia' : 'Fissa'),
      h('button.link-btn.nt-del', { type: 'button', on: { click: () => remove(n) } }, 'Elimina')) : null;
    return h('article.nt-card', { class: n.pinned ? 'pinned' : '' },
      h('div.nt-top',
        h('span.nt-kind', { class: `k-${n.kind}` }, KIND_LABEL[n.kind]),
        h('span.nt-date', fmtDate(n.note_date, { year: true })),
        n.pinned ? h('span.nt-pin', { title: 'Fissata in alto' }, '📌') : null,
        showTicket && n.ticket_id ? h('button.nt-ticket', { type: 'button', title: 'Apri il ticket',
          on: { click: async () => (await import('./tickets.js')).openTicket(n.ticket_id, { onSaved: load }) } }, `Ticket #${n.ticket_id} · ${n.ticket_title || ''}`) : null,
        actions),
      n.title ? h('div.nt-title', n.title) : null,
      h('div.nt-body', linkify(n.body)),
      h('div.nt-foot', author ? avatar(author, 20) : null, h('span', author?.name || 'Utente rimosso'),
        n.updated_at ? h('span.muted', ` · modificata il ${fmtDateTime(n.updated_at)}`) : null));
  }

  function editor(n) {
    const kind = h('select.select', NOTE_KINDS.map(([k, label]) => h('option', { value: k, selected: (n?.kind || 'nota') === k }, label)));
    const date = h('input.input', { type: 'date', value: n?.note_date || today(), required: true });
    const titleIn = h('input.input', { placeholder: 'Titolo (facoltativo)', maxLength: 200, value: n?.title || '' });
    const body = h('textarea.input', { rows: 4, placeholder: 'Scrivi la nota…', maxLength: 20000, autofocus: true });
    body.value = n?.body || '';
    const pin = h('input', { type: 'checkbox', checked: Boolean(n?.pinned) });
    const saveBtn = h('button.btn.btn-primary.btn-sm', { type: 'button', disabled: !body.value.trim() }, n ? 'Salva' : 'Salva nota');
    body.addEventListener('input', () => { saveBtn.disabled = !body.value.trim() || !date.value; });
    date.addEventListener('input', () => { saveBtn.disabled = !body.value.trim() || !date.value; });
    const cancel = () => { adding = false; editing = null; draw(); };
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      const data = { kind: kind.value, note_date: date.value, title: titleIn.value.trim(), body: body.value.trim(), pinned: pin.checked };
      const ok = n ? await save(n, data) : await create(data);
      if (!ok) saveBtn.disabled = false;
    });
    body.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveBtn.click(); if (e.key === 'Escape') { e.stopPropagation(); cancel(); } });
    const el = h('article.nt-card.nt-editing',
      h('div.nt-edit-row', kind, date, titleIn),
      body,
      h('div.nt-edit-foot',
        h('label.check', pin, 'Fissa in alto'),
        h('span.grow'),
        h('button.btn.btn-sm', { type: 'button', on: { click: cancel } }, 'Annulla'),
        saveBtn));
    setTimeout(() => body.focus(), 0);
    return el;
  }

  async function create(data) {
    try {
      const n = await post(url, data);
      notes.unshift(n);
      sortNotes();
      adding = false;
      draw();
      toast('Nota salvata');
      return true;
    } catch { return false; }
  }

  async function save(n, data) {
    try {
      const updated = await patch(`/api/notes/${n.id}`, data);
      notes = notes.map(x => (x.id === n.id ? updated : x));
      sortNotes();
      editing = null;
      draw();
      return true;
    } catch { return false; }
  }

  async function remove(n) {
    try { await del(`/api/notes/${n.id}`); } catch { return; }
    notes = notes.filter(x => x.id !== n.id);
    draw();
    undoToast('Nota eliminata', async () => {
      const back = await post(`/api/notes/${n.id}/restore`);
      notes.push(back);
      sortNotes();
      draw();
    });
  }

  function sortNotes() {
    notes.sort((a, b) => (b.pinned - a.pinned) || String(b.note_date).localeCompare(String(a.note_date)) || b.id - a.id);
  }

  load();
  return { reload: load };
}
