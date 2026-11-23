// Compiti, Condividi e Persone da aggiungere nelle schede del CRM (ALM2-71, canvas CRM v18, via di Dante 23/11/2026).
// - tab «Compiti» della scheda azienda e contatto: aperti per scadenza (scaduti, oggi, questa settimana, più avanti),
//   «Miei» e «Fatti»; «Dai un compito» a uno o più colleghi (la finestra è stepDialog in crm-commerciale.js);
// - «Persone da aggiungere»: chi lavora nell'azienda e non è nel CRM, dalla mia posta, dagli incontri, dal sito,
//   da LinkedIn e dagli atti delle gare (RUP); «Aggiungi» o «Ignora», le ignorate non tornano;
// - «Condividi»: la scheda a uno o più colleghi con un messaggio; chi non vede il CRM ha il «!» rosso prima di inviare.
import { h, fill, toast, fmtDate, loading } from './ui.js';
import { get, post } from './api.js';
import { store } from './store.js';
import { peoplePicker } from './people.js';
import { openContactFromMail } from './crm-scrivo.js';
import { stepRow, stepDialog } from './crm-commerciale.js';
import { ic, dots, pill, card, emptyState, seg, cvModal } from './crm-v2.js';

const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const plusDays = n => { const d = new Date(`${todayIso()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayOf = x => String(x || '').slice(0, 10);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ── tab Compiti ──────────────────────────────────────────────────────────────
// target = { kind: 'subjects' | 'contacts', id, subjectId, subjectName, contacts, defaultOwner, contactId }
export async function compitiTab(box, target, { aside = null, onChange } = {}) {
  let filter = 'aperti';
  const list = h('div', loading());
  const head = h('div.cv-ch-r');
  const newTask = () => stepDialog({ subjectId: target.subjectId, subjectName: target.subjectName, contacts: target.contacts || [], defaultOwner: target.defaultOwner,
    contactId: target.contactId || null, onSaved: () => { draw(); onChange?.(); } });
  const main = card({ title: 'Compiti', icon: 'square-check', right: head }, list,
    h('div.cm-foot', h('button.btn.btn-sm.cm-add', { type: 'button', on: { click: newTask } }, ic('plus', 14), 'Dai un compito'),
      h('p.cv-small.cv-muted', 'I compiti dati a un collega gli arrivano come avviso e compaiono nella sua pagina Compiti. Il primo aperto è il «Prossimo compito» nelle liste del CRM.')));
  fill(box, aside ? h('div.cv-cols.w400', main, aside) : main);
  let data = { open: [], done: [] };
  const mine = st => st.owner_id === store.me.id || (st.people || []).some(p => p.id === store.me.id);
  async function draw() {
    data = await get(target.kind === 'contacts' ? `/api/crm/contacts/${target.id}/steps` : `/api/crm/subjects/${target.id}/steps`);
    fill(head, seg([['aperti', 'Aperti', data.open.length], ['miei', 'Miei', data.open.filter(mine).length], ['fatti', 'Fatti', data.done.length]], filter, k => { filter = k; paint(); }, { label: 'Quali compiti' }));
    paint();
  }
  const reload = () => { draw(); onChange?.(); };
  function paint() {
    if (filter === 'fatti') {
      fill(list, data.done.length ? data.done.map(st => h('div.cv-step', h('span.cv-ck.done', ic('check', 13)),
        h('div', { style: { minWidth: 0 } }, h('div.cv-step-t', { style: { color: 'var(--cv-faint)', textDecoration: 'line-through' } }, st.title),
          h('div.cv-step-m', dots([`fatto il ${fmtDate(dayOf(st.done_at))}`, st.done_by_name, st.outcome && `«${st.outcome}»`]))),
        h('span'), h('div.cv-acts', h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/crm/steps/${st.id}/reopen`); reload(); } } }, 'Riapri'))))
        : emptyState('square-check', 'Nessun compito fatto, per ora.'));
      return;
    }
    const rows = filter === 'miei' ? data.open.filter(mine) : data.open;
    if (!rows.length) {
      fill(list, emptyState('square-check', filter === 'miei' ? 'Nessun compito tuo aperto qui.' : 'Nessun compito aperto.',
        h('button.btn.btn-sm', { type: 'button', on: { click: newTask } }, ic('plus', 14), 'Dai un compito')));
      return;
    }
    const today = todayIso(), week = plusDays(7);
    const groups = [['Scaduti', r => dayOf(r.due_date) < today, 'rd'], ['Oggi', r => dayOf(r.due_date) === today, ''],
      ['Questa settimana', r => dayOf(r.due_date) > today && dayOf(r.due_date) <= week, ''], ['Più avanti', r => dayOf(r.due_date) > week, '']];
    fill(list, groups.map(([label, test, tone]) => {
      const g = rows.filter(test);
      return g.length ? [h('div.cv-sect', { class: tone }, `${label} · ${g.length}`),
        g.map(st => stepRow(st, { onChange: reload, contacts: target.contacts || [], otherOpen: data.open.length - 1, siblings: data.open }))] : null;
    }));
  }
  await draw().catch(err => fill(list, emptyState('alert-triangle', err.message || 'Compiti non disponibili.')));
}

// ── Persone da aggiungere ────────────────────────────────────────────────────
const SRC = { posta: ['La tua posta', 'or'], incontri: ['Incontri', 'am'], anac: ['Gare · RUP', 'bl'], sito: ['Sito', 'line'], linkedin: ['LinkedIn', 'line'] };
const splitName = n => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? { first_name: p[0], last_name: p.slice(1).join(' ') } : { first_name: '', last_name: p[0] || '' }; };

// onAdd(preset) apre il modulo del nuovo contatto (crm.js) e risolve con il contatto creato, o null
export function personeCard(s, { onAdd, onChange } = {}) {
  const body = h('div', loading());
  const right = h('div');
  const el = card({ title: 'Persone da aggiungere', icon: 'user-plus', right, cls: 'cm-persone' }, body);
  let busy = false;
  async function draw() {
    const r = await get(`/api/crm/subjects/${s.id}/persone`);
    fill(right, r.people.length ? h('span.cv-c', String(r.people.length)) : null);
    const searchLabel = r.tenders ? 'Cerca su sito, LinkedIn e i RUP delle gare' : 'Cerca altre persone su sito e LinkedIn';
    const searchBtn = r.can_search ? h('button.btn.btn-sm.cm-search', { type: 'button', disabled: busy || undefined, on: { click: search } }, busy ? h('span.spinner') : ic('sparkles', 14), busy ? 'Alma sta cercando…' : searchLabel) : null;
    const last = r.last_search ? h('p.cv-small.cv-muted', r.last_search.error ? `Ultima ricerca non riuscita (${fmtDate(dayOf(r.last_search.at))}).`
      : `Ultima ricerca ${fmtDate(dayOf(r.last_search.at))}${r.last_search.user_name ? ` di ${r.last_search.user_name.split(' ')[0]}` : ''}: ${plural(r.last_search.found, 'persona nuova', 'persone nuove')}.`) : null;
    fill(body,
      h('p.cv-small.cv-muted.cm-intro', `Lavorano in ${s.short_name || s.name} ma non sono nel CRM. Aggiungi chi serve, le altre ignorale: non tornano.`),
      r.people.length ? r.people.map(p => row(p)) : h('p.cv-small.cm-none', r.domains.length ? 'Nessuna persona nuova dalla tua posta e dagli incontri.' : 'Senza il sito o un\'email dell\'azienda non posso cercarla nella tua posta.'),
      h('div.cm-pfoot', searchBtn, last,
        h('p.cv-small.cv-muted', '«La tua posta» la vedi solo tu. Sito, LinkedIn e gare li cerca Alma quando premi il pulsante.')));
  }
  function row(p) {
    const [label, tone] = SRC[p.source] || [p.source, ''];
    const name = p.name || p.email;
    const meta = p.source === 'posta' ? dots([p.email, plural(p.emails, 'email', 'email'), p.last_at && `l'ultima il ${fmtDate(dayOf(p.last_at))}`])
      : p.source === 'incontri' ? dots([p.email, p.detail]) : dots([p.job, p.email]);
    const link = p.url ? h('a', { href: p.url, target: '_blank', rel: 'noopener' }, p.source === 'linkedin' ? 'apri il profilo' : 'fonte') : null;
    const add = h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => addPerson(p) } }, 'Aggiungi');
    const ignore = h('button.btn.btn-sm', { type: 'button', on: { click: () => ignorePerson(p) } }, 'Ignora');
    return h('div.cm-person',
      h('div.cm-person-h', h('b', name), pill(label, tone)),
      meta ? h('div.cv-small', meta) : null,
      p.detail && p.source !== 'incontri' || link ? h('div.cv-small.cv-muted', p.detail && p.source !== 'incontri' ? p.detail : '', p.detail && p.source !== 'incontri' && link ? ' · ' : '', link) : null,
      h('div.cm-person-a', add, ignore));
  }
  async function addPerson(p) {
    if (p.source === 'posta') {
      const out = await openContactFromMail({ email: p.email, name: p.name, received: p.emails || 0, sent: 0 });
      if (out === 'ok') { draw(); onChange?.(); }
      return;
    }
    const preset = { subject_id: s.id, email: p.email || '', ...splitName(p.name || (p.email || '').split('@')[0]), job: p.job || '', linkedin: p.linkedin || '',
      notes: p.url ? `Trovato da Alma (${SRC[p.source]?.[0] || p.source}): ${p.url}` : '' };
    const c = await onAdd?.(preset);
    if (!c) return;
    if (p.id && p.source !== 'incontri') await post(`/api/crm/persone-proposte/${p.id}`, { status: 'aggiunta' }).catch(() => {});
    draw(); onChange?.();
  }
  async function ignorePerson(p) {
    if (p.source === 'posta') await post('/api/crm/scrivo/ignora', { email: p.email });
    else if (p.source === 'incontri') await post(`/api/crm/proposals/${p.id}/dismiss`);
    else await post(`/api/crm/persone-proposte/${p.id}`, { status: 'ignorata' });
    toast(`${p.name || p.email} ignorata: non torna`);
    draw();
  }
  async function search() {
    busy = true; draw().catch(() => {});
    try {
      const r = await post(`/api/crm/subjects/${s.id}/persone/cerca`, {});
      toast(r.added ? `Alma ha trovato ${plural(r.added, 'persona nuova', 'persone nuove')}` : 'Nessuna persona nuova trovata');
    } catch { /* l'errore lo mostra api.js */ }
    busy = false;
    draw();
  }
  draw().catch(err => fill(body, h('p.cv-small', err.message || 'Non disponibile.')));
  return el;
}

// ── Condividi ────────────────────────────────────────────────────────────────
// target = 'subjects' | 'contacts'; summary: una riga su cosa si condivide
export async function shareDialog({ target, id, name, summary = '', initials = '' }) {
  const all = await get('/api/crm/condividi/persone');
  const noCrm = new Set(all.filter(u => !u.crm).map(u => u.id));
  let ids = [];
  const warn = h('div');
  const pickerBox = h('div');
  const drawWarn = () => {
    const bad = ids.filter(x => noCrm.has(x)).map(x => all.find(u => u.id === x)?.name).filter(Boolean);
    fill(warn, bad.length ? h('div.cm-warn', h('span.cm-bang', '!'),
      h('span', `${bad.join(', ')} non ${bad.length === 1 ? 'vede' : 'vedono'} il CRM: ${bad.length === 1 ? 'riceverebbe' : 'riceverebbero'} l'avviso ma non ${bad.length === 1 ? 'può' : 'possono'} aprire la scheda. ${bad.length === 1 ? 'Toglila' : 'Toglile'}, oppure chiedi alla direzione di dare il CRM.`)) : null);
    pickerBox.querySelectorAll('.person-chip').forEach(chip => {
      const u = all.find(x => chip.textContent.includes(x.name));
      chip.classList.toggle('cm-nocrm', Boolean(u && noCrm.has(u.id)));
    });
  };
  const picker = peoplePicker({ selected: [], label: '+ Collega', onChange: x => { ids = x.filter(i => i !== store.me.id); drawWarn(); } });
  fill(pickerBox, picker.el);
  const msg = h('textarea.input', { rows: 3, maxlength: 1000, placeholder: 'Perché glielo mandi: cosa guardare, cosa fare', 'aria-label': 'Messaggio' });
  const link = `${location.origin}/app#/crm/${target === 'contacts' ? 'contatti' : 'scheda'}/${id}`;
  const send = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    if (!ids.length) return toast('Scegli almeno un collega', 'err');
    if (ids.some(x => noCrm.has(x))) return toast('Togli chi non vede il CRM, poi condividi', 'err');
    send.disabled = true;
    try {
      const r = await post(`/api/crm/${target}/${id}/condividi`, { user_ids: ids, message: msg.value });
      m.close();
      toast(`Condivisa con ${plural(r.sent, 'collega', 'colleghi')}: ricevono l'avviso`);
    } catch { send.disabled = false; }
  } } }, ic('share-2', 15), 'Condividi');
  const m = cvModal({
    size: 'md',
    title: h('div', h('h2', `Condividi ${name}`), h('div.cv-subh', 'Il collega riceve l\'avviso con il link alla scheda')),
    body: h('div.en-form',
      h('div.cv-fld', h('span', 'Con chi'), pickerBox, warn),
      h('label.cv-fld', h('span', 'Messaggio · facoltativo'), msg),
      h('div.cv-fld', h('span', 'Cosa condividi'), h('div.cm-what', h('span.cv-mono', initials || name.slice(0, 2).toUpperCase()), h('div', h('b', name), summary ? h('div.cv-small.cv-muted', summary) : null)))),
    left: [h('button.btn.btn-ghost', { type: 'button', on: { click: async () => { try { await navigator.clipboard.writeText(link); toast('Link copiato'); } catch { toast(link); } } } }, ic('link', 15), 'Copia il link')],
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), send],
  });
}

// chi apre una scheda che gli è stata condivisa: la cronologia mostra «l'ha aperta»
export function markShareOpened(target, id) { post(`/api/crm/${target}/${id}/condivisioni/aperta`, {}, { quiet: true }).catch(() => {}); }
