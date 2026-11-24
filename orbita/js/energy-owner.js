// Alma Energy · chi segue l'opportunità (ALM2-78, canvas approvato da Dante il 24/11/2026).
// Il nome del responsabile è un pulsante: un clic apre il riquadro con la ricerca, «Assegna a me» in cima, i membri
// del modulo con quante opportunità aperte hanno e «Togli il responsabile». Si salva al clic; un messaggio in basso
// conferma con «Annulla» per 5 secondi. Lo stesso riquadro serve alla pagina, all'elenco e alla barra «Assegna a…».
import { h, avatar, toast } from './ui.js';
import { get, post } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';

let members = null; // [{ user_id, name, email, open }] dei membri del modulo
export async function loadMembers(force = false) {
  if (!members || force) members = ((await get('/api/energy')).members || []).filter(m => m.user_id);
  return members;
}
const userOf = id => store.users?.find(u => u.id === id) || members?.find(m => m.user_id === id) && { id, name: members.find(m => m.user_id === id).name };
const who = (id, name) => avatar({ ...(store.users?.find(u => u.id === id) || {}), name: name || userOf(id)?.name || '?' }, 24);

// Chiude il riquadro aperto (uno solo alla volta)
let openPop = null;
function closePop() {
  if (!openPop) return;
  openPop.el.remove();
  document.removeEventListener('mousedown', openPop.out, true);
  document.removeEventListener('keydown', openPop.key, true);
  openPop.anchor?.setAttribute('aria-expanded', 'false');
  openPop.anchor?.classList.remove('open');
  openPop = null;
}

// Riquadro del responsabile vicino a `anchor`. current = id di adesso (o null); onPick(id|null) salva.
export async function ownerPicker(anchor, { current = null, onPick, title = 'Scegli il responsabile', allowNone = true }) {
  if (openPop?.anchor === anchor) return closePop();
  closePop();
  const list = await loadMembers();
  const me = store.me;
  const items = h('div.eo-items');
  const pick = id => { closePop(); onPick(id); };
  const row = (m, extra) => h('button.eo-pick', { type: 'button', class: extra, on: { click: () => pick(m.user_id) } },
    who(m.user_id, m.name), h('span.eo-name', m.user_id === me.id ? `${m.name} (tu)` : m.name),
    m.user_id === current ? icon('check', { size: 16, title: 'attuale' }) : h('span.eo-count', m.open ? `${m.open} ${m.open === 1 ? 'aperta' : 'aperte'}` : ''));
  const draw = q => {
    const s = q.trim().toLowerCase();
    const found = list.filter(m => !s || m.name.toLowerCase().includes(s) || String(m.email).includes(s));
    items.replaceChildren(...[
      !s && current !== me.id && list.some(m => m.user_id === me.id)
        ? h('button.eo-pick.eo-me', { type: 'button', on: { click: () => pick(me.id) } }, who(me.id, me.name), h('span.eo-name', 'Assegna a me')) : null,
      h('div.eo-lab', 'Membri di Alma Energy'),
      ...(found.length ? found.map(m => row(m)) : [h('p.eo-empty', 'Nessun membro con questo nome.')]),
      h('p.eo-note', 'Solo chi è nei Membri del modulo. Gli altri si aggiungono dal tab «Membri».'),
      allowNone && current ? h('div.eo-sep', h('button.eo-pick.eo-none', { type: 'button', on: { click: () => pick(null) } }, 'Togli il responsabile')) : null,
    ].filter(Boolean));
  };
  const search = h('input', { type: 'search', placeholder: 'Cerca un collega', 'aria-label': 'Cerca un collega', on: { input: e => draw(e.target.value) } });
  const el = h('div.eo-pop', { role: 'dialog', 'aria-label': title },
    h('label.eo-search', icon('search', { size: 16 }), search), items);
  draw('');
  document.body.append(el);
  // sotto il pulsante, allineato a destra se non c'è spazio
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth; // senza la barra di scorrimento
  const w = Math.min(320, vw - 24);
  el.style.width = `${w}px`;
  el.style.left = `${Math.max(12, Math.min(r.left, vw - w - 12)) + window.scrollX}px`;
  el.style.top = `${r.bottom + 8 + window.scrollY}px`;
  anchor.setAttribute('aria-expanded', 'true');
  anchor.classList.add('open');
  const out = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePop(); };
  const key = e => { if (e.key === 'Escape') { closePop(); anchor.focus(); } };
  document.addEventListener('mousedown', out, true);
  document.addEventListener('keydown', key, true);
  openPop = { el, anchor, out, key };
  setTimeout(() => search.focus(), 0);
}

// Assegna e mostra «Assegnata a X» con «Annulla»; before = { id: owner di prima } per tornare indietro.
export async function assignOwners(ids, ownerId, before = {}, onDone) {
  const r = await post('/api/energy/opportunities/assign', { ids, owner_id: ownerId });
  const name = ownerId === null ? null : ownerId === store.me.id ? 'te' : userOf(ownerId)?.name || 'un collega';
  const what = ids.length === 1 ? 'Assegnata' : `${ids.length} opportunità assegnate`;
  undoToast(ownerId === null ? (ids.length === 1 ? 'Ora è senza responsabile' : `${ids.length} opportunità senza responsabile`) : `${what} a ${name}`, async () => {
    // si torna al responsabile di prima, opportunità per opportunità
    const groups = new Map();
    for (const id of r.ids) { const k = before[id] ?? null; groups.set(k, [...(groups.get(k) || []), id]); }
    for (const [prev, list] of groups) await post('/api/energy/opportunities/assign', { ids: list, owner_id: prev });
    toast('Annullato');
    onDone?.();
  });
  members = null; // i conteggi «aperte» cambiano
  onDone?.();
  return r;
}

function undoToast(message, undo) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const t = h('div.toast.eo-toast', h('span', message),
    h('button.eo-undo', { type: 'button', on: { click: async () => { t.remove(); await undo(); } } }, 'Annulla'));
  root.append(t);
  setTimeout(() => t.remove(), 5000);
}

// Pulsante con iniziali e nome; onChanged() dopo il salvataggio.
export function ownerChip(o, onChanged, { big = false } = {}) {
  const btn = h('button.eo-chip', { type: 'button', class: big ? 'big' : '', 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
    'aria-label': o.owner_id ? `Responsabile: ${o.owner_name}. Cambia` : 'Senza responsabile. Assegna',
    on: { click: e => { e.stopPropagation(); ownerPicker(btn, { current: o.owner_id || null, onPick: id => assignOwners([o.id], id, { [o.id]: o.owner_id || null }, onChanged) }); } } },
  o.owner_id ? [who(o.owner_id, o.owner_name), h('span', o.owner_name || '—')] : h('span.muted', 'Senza responsabile'),
  icon('chevron-down', { size: 14 }));
  return btn;
}

// Nelle righe senza responsabile: «Prendo io» e «Assegna…»
export function takeButtons(o, onChanged) {
  const assignBtn = h('button.btn.btn-ghost.btn-sm.eo-assign', { type: 'button', 'aria-haspopup': 'dialog',
    on: { click: e => { e.stopPropagation(); ownerPicker(assignBtn, { current: null, allowNone: false, onPick: id => assignOwners([o.id], id, { [o.id]: null }, onChanged) }); } } }, 'Assegna…');
  return h('span.eo-take-row',
    h('button.eo-take', { type: 'button', on: { click: e => { e.stopPropagation(); assignOwners([o.id], store.me.id, { [o.id]: null }, onChanged); } } }, icon('plus', { size: 14 }), 'Prendo io'),
    assignBtn);
}
