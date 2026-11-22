// Filtro «Regioni» a scelta multipla di Concorrenza e gare (canvas v17, approvato da Dante il 22/11/2026): Chi vince e
// Partner. Pillola «Regioni: …» che apre un menu con una casella per regione e quante gare (o partner) ci sono,
// più «Zone del profilo BU» e «Tutta Italia».
//   regionPicker({ counts: [{ region, n }], selected, profile, unit, onChange })
//     selected: undefined = zone del profilo BU · [] = tutta Italia · ['Abruzzo', …] = quelle
//     onChange(nuovo selected) — con lo stesso significato · none: la scritta quando non c'è filtro
import { h } from './ui.js';
import { icon } from './icons.js';

const label = (selected, profile, none = 'Regioni: tutta Italia') => {
  if (selected === undefined) return profile?.length ? `Regioni: ${profile.join(', ')}` : none;
  if (!selected.length) return 'Regioni: tutta Italia';
  return selected.length <= 3 ? `Regioni: ${selected.join(', ')}` : `Regioni: ${selected.slice(0, 2).join(', ')} e altre ${selected.length - 2}`;
};

export function regionPicker({ counts = [], selected, profile = [], unit = 'gare', none, onChange }) {
  const current = selected === undefined ? (profile || []) : selected;
  const chosen = new Set(current);
  const wrap = h('span.rp');
  const btn = h('button.rp-btn', { type: 'button', class: current.length ? 'on' : '', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, icon('map-pin', { size: 13 }), h('span', label(selected, profile, none)), icon('chevron-down', { size: 13 }));
  const menu = h('div.rp-menu', { hidden: true, role: 'dialog', 'aria-label': 'Scegli le regioni' });
  const known = new Set(counts.map(c => c.region));
  const rows = [...counts, ...current.filter(r => !known.has(r)).map(r => ({ region: r, n: 0 }))];
  const boxes = rows.map(c => {
    const input = h('input', { type: 'checkbox', checked: chosen.has(c.region), on: { change: () => { if (input.checked) chosen.add(c.region); else chosen.delete(c.region); } } });
    return h('label.rp-row', input, h('span.rp-name', c.region), h('small', `${c.n.toLocaleString('it-IT')} ${unit}`));
  });
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', outside, true); };
  const outside = e => { if (!wrap.contains(e.target)) close(); };
  const pick = v => { close(); onChange(v); };
  menu.append(
    h('div.rp-list', boxes.length ? boxes : h('p.rp-none', 'Nessuna regione con dati per questi filtri.')),
    h('div.rp-foot',
      profile?.length ? h('button.rp-link', { type: 'button', on: { click: () => pick(undefined) } }, 'Zone del profilo BU') : null,
      h('button.rp-link', { type: 'button', on: { click: () => pick([]) } }, 'Tutta Italia'),
      h('span.rp-gap'),
      h('button.rp-ok', { type: 'button', on: { click: () => pick([...chosen]) } }, 'Applica')));
  btn.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) setTimeout(() => document.addEventListener('click', outside, true));
  });
  wrap.append(btn, menu);
  return wrap;
}

// selected → valore del parametro ?regions= (undefined = non mandarlo)
export const regionsQuery = selected => (selected === undefined ? undefined : selected.length ? selected.join(',') : 'tutte');
