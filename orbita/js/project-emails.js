// Email del progetto (sotto Documenti): l'elenco di quelle assegnate, la lettura con gli allegati,
// e «Assegna email», che apre la propria casella Outlook per sceglierne una o più.
import { h, clear, fill, avatar, modal, toast, loading, debounce, confirmDialog, fmtDateTime, fmtSize } from './ui.js';
import { icon } from './icons.js';
import { get, post, del } from './api.js';
import { store, userById } from './store.js';

const FOLDERS = [['inbox', 'Posta in arrivo'], ['sent', 'Posta inviata'], ['all', 'Tutte']];
const sender = e => ({ name: e.from_name || e.from?.name || e.from_address || e.from?.address || '?', email: e.from_address || e.from?.address || '' });
const canRemove = (e, p) => e.assigned_by === store.me.id || p.my_role === 'owner' || p.my_role === 'admin';

// Testo dell'email con i link cliccabili (niente HTML dell'email: solo testo).
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

const mailErrorBox = err => h('div.banner', err?.code === 'mail_read'
  ? 'Per leggere la posta serve il permesso «Mail.Read» di Microsoft. Un amministratore deve approvarlo in Entra; poi esci e rientra in Alma Planet.'
  : err?.message || 'Outlook non risponde, riprova tra poco.');

export function projectEmails(box, p) {
  let emails = [];
  const listBox = h('div.pe-list', loading());
  const filter = h('input.input.pe-filter', { type: 'search', placeholder: 'Cerca nelle email del progetto…' });
  const count = h('span.pe-count');
  filter.addEventListener('input', draw);
  box.append(
    h('div.pe-head',
      h('h3', 'Email', count),
      h('div.row', filter, h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => assignDialog(p, load) } }, '＋ Assegna email'))),
    listBox);

  async function load() {
    try {
      emails = await get(`/api/projects/${p.id}/emails`);
    } catch { return fill(listBox, h('p.muted', 'Email non disponibili.')); }
    draw();
  }

  function draw() {
    count.textContent = emails.length ? String(emails.length) : '';
    const q = filter.value.trim().toLowerCase();
    const shown = q ? emails.filter(e => `${e.subject} ${e.from_name} ${e.from_address} ${e.preview}`.toLowerCase().includes(q)) : emails;
    if (!emails.length) {
      return fill(listBox, h('div.pe-empty', h('strong', 'Nessuna email nel progetto.'),
        h('span.muted', 'Con «Assegna email» scegli dalla tua casella Outlook i messaggi da tenere qui: li leggeranno tutti i membri del progetto.')));
    }
    if (!shown.length) return fill(listBox, h('p.muted', 'Nessuna email corrisponde alla ricerca.'));
    fill(listBox, shown.map(e => {
      const s = sender(e), by = userById(e.assigned_by);
      return h('button.pe-row', { type: 'button', on: { click: () => openEmail(e.id, p, load) } },
        avatar({ name: s.name, email: s.email }, 36),
        h('div.pe-main',
          h('div.pe-line', h('strong.pe-from', s.name), h('span.pe-date', e.sent_at ? fmtDateTime(e.sent_at) : '')),
          h('div.pe-subject', e.subject, e.attachment_count ? h('span.pe-clip', { title: `${e.attachment_count} allegati` }, icon('paperclip', { size: 13 }), ` ${e.attachment_count}`) : null),
          h('div.pe-preview', e.preview)),
        by ? h('span.pe-by', { title: `Assegnata da ${by.name}` }, avatar(by, 22)) : null);
    }));
  }

  load();
}

// ── lettura ──────────────────────────────────────────────────────────────────
async function openEmail(id, p, onChange) {
  let e;
  try { e = await get(`/api/project-emails/${id}`); } catch { return; }
  const s = sender(e), by = userById(e.assigned_by);
  const people = list => list.map(x => (x.name ? `${x.name} <${x.address}>` : x.address)).join(', ');
  const m = modal({
    title: e.subject,
    wide: true,
    body: [
      h('div.pe-meta',
        h('div', h('span.muted', 'Da '), h('strong', s.name), s.email && s.email !== s.name ? h('span.muted', ` <${s.email}>`) : null),
        e.to_list.length ? h('div', h('span.muted', 'A '), people(e.to_list)) : null,
        e.cc_list.length ? h('div', h('span.muted', 'Cc '), people(e.cc_list)) : null,
        h('div.muted', [e.sent_at ? fmtDateTime(e.sent_at) : null, by ? `assegnata da ${by.name} il ${fmtDateTime(e.assigned_at)}` : null].filter(Boolean).join(' · '))),
      e.attachments.length ? h('div.pe-files', e.attachments.map(a => h('a.pe-file', { href: `/api/project-emails/${e.id}/attachments/${a.id}`, download: a.name },
        icon('paperclip', { size: 14 }), ' ', a.name, h('span.muted', ` ${fmtSize(a.size)}`)))) : null,
      h('div.pe-body', linkify(e.body_text || '(email senza testo)')),
    ],
    left: canRemove(e, p) ? [h('button.btn.btn-danger', { type: 'button', on: { click: async () => {
      if (!await confirmDialog('Togliere questa email dal progetto? Nella casella Outlook resta com\'è.', { ok: 'Togli', danger: true })) return;
      await del(`/api/project-emails/${e.id}`);
      m.close();
      toast('Email tolta dal progetto');
      onChange?.();
    } } }, 'Togli dal progetto')] : [],
    actions: [
      e.web_link ? h('a.btn', { href: e.web_link, target: '_blank', rel: 'noopener' }, 'Apri in Outlook') : null,
      h('button.btn.btn-primary', { type: 'button', on: { click: () => m.close() } }, 'Chiudi'),
    ].filter(Boolean),
  });
}

// ── assegnare dalla propria casella ──────────────────────────────────────────
function assignDialog(p, onDone) {
  if (!store.me.microsoft) return toast('Outlook non è collegato: serve l\'accesso con Microsoft', 'err');
  let folder = 'inbox', next = null, loadingMore = false;
  const picked = new Map(); // id → messaggio
  const listBox = h('div.pe-pick-list', loading());
  const search = h('input.input', { type: 'search', placeholder: 'Cerca per oggetto, mittente o testo…', autofocus: true });
  const tabs = h('div.seg', FOLDERS.map(([k, label]) => h('button', { type: 'button', class: k === folder ? 'on' : '', 'data-k': k, on: { click: () => { folder = k; tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); reload(); } } }, label)));
  const counter = h('span.muted');
  const assignBtn = h('button.btn.btn-primary', { type: 'button', disabled: true }, 'Assegna');

  const m = modal({
    title: `Assegna email a «${p.name}»`,
    wide: true,
    body: [h('div.pe-pick-bar', tabs, search), listBox],
    left: [counter],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), assignBtn],
  });
  m.box.classList.add('pe-pick-modal');

  function updateFooter() {
    counter.textContent = picked.size ? `${picked.size} ${picked.size === 1 ? 'selezionata' : 'selezionate'}` : 'Seleziona una o più email';
    assignBtn.disabled = !picked.size;
    assignBtn.textContent = picked.size > 1 ? `Assegna ${picked.size} email` : 'Assegna';
  }

  function row(msg) {
    const on = picked.has(msg.id);
    const box = h('input', { type: 'checkbox', checked: on || msg.assigned, disabled: msg.assigned, tabIndex: -1 });
    const el = h('label.pe-pick', { class: [on ? 'on' : '', msg.assigned ? 'done' : ''].join(' ') },
      box,
      h('div.pe-main',
        h('div.pe-line', h('strong.pe-from', msg.from.name || msg.from.address), h('span.pe-date', fmtDateTime(msg.date))),
        h('div.pe-subject', msg.subject, msg.has_attachments ? h('span.pe-clip', { title: 'Con allegati' }, icon('paperclip', { size: 13 })) : null, msg.assigned ? h('span.pill.pe-already', 'già nel progetto') : null),
        h('div.pe-preview', msg.preview)));
    box.addEventListener('change', () => {
      if (box.checked) picked.set(msg.id, msg); else picked.delete(msg.id);
      el.classList.toggle('on', box.checked);
      updateFooter();
    });
    return el;
  }

  async function fetchPage(reset) {
    const qs = new URLSearchParams({ folder, project: String(p.id) });
    if (search.value.trim()) qs.set('q', search.value.trim());
    if (!reset && next) qs.set('next', next);
    return get(`/api/mail/messages?${qs}`, { quiet: true });
  }

  async function reload() {
    fill(listBox, loading());
    next = null;
    try {
      const data = await fetchPage(true);
      next = data.next;
      fill(listBox, data.messages.length ? data.messages.map(row) : h('p.muted.pe-none', search.value.trim() ? 'Nessuna email trovata.' : 'Nessuna email in questa cartella.'));
      moreButton();
    } catch (err) { fill(listBox, mailErrorBox(err)); }
  }

  function moreButton() {
    listBox.querySelector('.pe-more')?.remove();
    if (next) listBox.append(h('button.btn.btn-sm.pe-more', { type: 'button', on: { click: loadMore } }, 'Carica altre'));
  }

  async function loadMore() {
    if (loadingMore || !next) return;
    loadingMore = true;
    try {
      const data = await fetchPage(false);
      next = data.next;
      listBox.querySelector('.pe-more')?.remove();
      listBox.append(...data.messages.map(row));
      moreButton();
    } catch (err) { toast(err.message, 'err'); } finally { loadingMore = false; }
  }

  // scorrendo in fondo carica la pagina successiva
  listBox.addEventListener('scroll', () => { if (listBox.scrollTop + listBox.clientHeight > listBox.scrollHeight - 200) loadMore(); });
  search.addEventListener('input', debounce(reload, 400));

  assignBtn.addEventListener('click', async () => {
    assignBtn.disabled = true;
    assignBtn.textContent = 'Copio le email nel progetto…';
    try {
      const r = await post(`/api/projects/${p.id}/emails`, { message_ids: [...picked.keys()] });
      m.close();
      toast(r.added ? `${r.added} ${r.added === 1 ? 'email assegnata' : 'email assegnate'} al progetto${r.already ? ` (${r.already} c'erano già)` : ''}` : 'Le email erano già nel progetto');
      if (r.skipped_attachments.length) toast(`Allegati troppo grandi, rimasti solo in Outlook: ${r.skipped_attachments.join(', ')}`, 'err');
      onDone?.();
    } catch { updateFooter(); }
  });

  updateFooter();
  reload();
}
