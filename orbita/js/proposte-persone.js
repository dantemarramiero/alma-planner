// Proposte per persona (ALM2-84): in cima a «Collega incontro» / «Assegna email» (progetti) e «Collega email» (CRM)
// le email e gli incontri con le persone della scheda, già spuntati. La lista sotto resta per cercare il resto.
import { h, fill } from './ui.js';
import { icon } from './icons.js';
import { get } from './api.js';

export const peopleText = (people, max = 3) => {
  const names = people.map(p => p.name || p.address);
  return names.length > max ? `${names.slice(0, max).join(', ')} e ${names.length === max + 1 ? 'un altro' : `altri ${names.length - max}`}` : names.join(', ').replace(/, ([^,]*)$/, ' e $1');
};

// url → { people, <listKey>: [...] }. row(item) disegna la riga con la sua casella (che deve stare in un <label>);
// pick(item) la mette tra le scelte. noun = ['email', 'email', 'f'] o ['incontro', 'incontri']. max: quante mostrarne.
export function proposalSection({ url, listKey, row, pick, noun, max = 20, onReady }) {
  const box = h('div.pp-box', { hidden: true });
  (async () => {
    let r;
    try { r = await get(url, { quiet: true }); } catch { return; }
    const items = (r[listKey] || []).slice(0, max);
    if (!r.people?.length) return;
    box.hidden = false;
    const f = noun[2] === 'f';
    if (!items.length) {
      fill(box, h('div.pp-head', icon('users', { size: 15 }), h('span', h('strong', `Con ${peopleText(r.people)}`), h('span.muted', ` · ${f ? 'nessuna' : 'nessun'} ${noun[0]} ${f ? 'nuova' : 'nuovo'} da collegare`))));
      return onReady?.(0);
    }
    items.forEach(pick);
    const list = h('div.pp-list', items.map(row));
    const toggle = h('button.pp-toggle', { type: 'button' }, 'Togli le spunte');
    toggle.addEventListener('click', () => {
      const boxes = [...list.querySelectorAll('input[type=checkbox]:not(:disabled)')];
      const on = !boxes.every(b => b.checked);
      for (const b of boxes) if (b.checked !== on) { b.checked = on; b.dispatchEvent(new Event('change')); }
      toggle.textContent = on ? 'Togli le spunte' : 'Spunta tutte';
    });
    fill(box,
      h('div.pp-head', icon('sparkles', { size: 15 }),
        h('span.pp-title', h('strong', `Con ${peopleText(r.people)}`),
          h('span.muted', ` · ${items.length} ${items.length === 1 ? noun[0] : noun[1]} ${items.length === 1 ? (f ? 'proposta, già spuntata' : 'proposto, già spuntato') : (f ? 'proposte, già spuntate' : 'proposti, già spuntati')}`)),
        toggle),
      list,
      h('div.pp-rest', 'Oppure cerca nel resto qui sotto'));
    onReady?.(items.length);
  })();
  return box;
}

// Le stesse caselle compaiono due volte (proposte e lista completa): si tengono allineate.
export function syncTwin(root, id, checked) {
  for (const b of root.querySelectorAll('input[data-pid]')) {
    if (b.dataset.pid !== id || b.checked === checked || b.disabled) continue;
    b.checked = checked;
    b.closest('label')?.classList.toggle('on', checked);
  }
}
