// Scelta delle persone (uno o più assegnatari), con ricerca nella rubrica Microsoft per chi non è ancora entrato.
import { h, clear, avatar, debounce } from './ui.js';
import { get, post } from './api.js';
import { store, loadUsers, userById } from './store.js';

export function peoplePicker({ selected = [], onChange, label = '+ Persona' }) {
  let ids = [...selected];
  const root = h('div.people');
  let menu = null;

  const emit = () => { render(); onChange?.([...ids]); };

  function render() {
    clear(root);
    for (const id of ids) {
      const u = userById(id);
      if (!u) continue;
      root.append(h('span.person-chip', avatar(u), u.name,
        h('button', { type: 'button', title: `Togli ${u.name}`, on: { click: () => { ids = ids.filter(x => x !== id); emit(); } } }, '×')));
    }
    const wrap = h('span.picker', h('button.btn.btn-sm', { type: 'button', on: { click: toggle } }, label));
    root.append(wrap);
    if (menu) wrap.append(menu);
  }

  function closeMenu() {
    menu = null;
    document.removeEventListener('mousedown', outside);
    render();
  }
  const outside = e => { if (menu && !root.contains(e.target)) closeMenu(); };

  function toggle() {
    if (menu) return closeMenu();
    const input = h('input.input', { placeholder: 'Cerca persona…', autofocus: true });
    const list = h('div');
    menu = h('div.picker-menu', input, list);
    document.addEventListener('mousedown', outside);
    render();
    input.focus();

    const searchDirectory = debounce(async q => {
      if (!store.me?.microsoft || q.length < 2) return;
      try {
        const found = await get(`/api/users/directory?q=${encodeURIComponent(q)}`, { quiet: true });
        const known = new Set(store.users.map(u => u.email));
        const extra = found.filter(f => !known.has(f.email));
        if (!extra.length || !menu) return;
        list.append(h('div.picker-sep', 'Dalla rubrica Almacis'));
        for (const f of extra) {
          list.append(h('div.picker-item', {
            on: { click: async () => {
              const { id } = await post('/api/users', f);
              await loadUsers();
              if (!ids.includes(id)) ids.push(id);
              closeMenu();
              onChange?.([...ids]);
            } },
          }, avatar(f), h('div.grow', f.name, h('small', f.email))));
        }
      } catch { /* la rubrica è un aiuto, non blocca */ }
    }, 300);

    const draw = () => {
      const q = input.value.trim().toLowerCase();
      clear(list);
      const matches = store.users.filter(u => !q || u.name.toLowerCase().includes(q) || u.email.includes(q));
      if (!matches.length) list.append(h('div.picker-item.muted', 'Nessuno nel team'));
      for (const u of matches) {
        const on = ids.includes(u.id);
        list.append(h('div.picker-item', {
          class: on ? 'on' : '',
          on: { click: () => { ids = on ? ids.filter(x => x !== u.id) : [...ids, u.id]; emit(); input.focus(); draw(); } },
        }, avatar(u), h('div.grow', u.name, h('small', u.job_title || u.email)), on ? '✓' : ''));
      }
      searchDirectory(q);
    };
    input.addEventListener('input', draw);
    draw();
  }

  render();
  return { el: root, get value() { return [...ids]; } };
}

export function avatarsFor(userIds = [], max = 4) {
  const users = userIds.map(userById).filter(Boolean);
  const el = h('span.avatars', users.slice(0, max).map(u => avatar(u)));
  if (users.length > max) el.append(h('span.avatar', { style: { background: 'var(--ap-grey-500)' } }, `+${users.length - max}`));
  if (!users.length) el.append(h('span.muted.small', '—'));
  return el;
}
