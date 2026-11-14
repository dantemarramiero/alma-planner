// Design v2 del CRM (Dante 14/11/2026, artboard «V2-Sistema»): i pezzi comuni a tutte le pagine.
// Intestazione con titolo Light + parola chiave Bold, contatori piccoli cliccabili (gli zeri tenui), card con titolo,
// contatore e link arancione, righe con l'icona colorata, stati vuoti con icona + frase + azione, punteggio ad anello,
// tab con sottolineatura arancione e «Altro ▾», finestre (e riquadri laterali) con il piede grigio fisso.
// Gli stili sono in css/crm-v2.css (classi cv-*).
import { h, fill, modal, initials } from './ui.js';
import { icon } from './icons.js';

export const ic = (name, size = 16) => icon(name, { size });
export const dots = list => list.filter(x => x !== null && x !== undefined && x !== false && x !== '').join(' · ');
// tono: gr (cliente, fatto), or (lead), am (da decidere/accettare), rd (scaduto), line (ASA/BU), dark (key account), bl (fonte, dato)
export const pill = (text, tone = '', attrs = {}) => h('span.cv-pill', { ...attrs, class: tone }, text);
export const av = (name, tone = '') => h('span.cv-av', { class: tone, title: name || '', 'aria-hidden': 'true' }, initials(name || '?'));

// punteggio del radar: anello arancione pieno da 70 (soglia «in evidenza»), chiaro sotto
export function scoreRing(score, { size = '', hi = 70 } = {}) {
  const n = Math.max(0, Math.min(100, Number(score) || 0));
  return h('span.cv-score', { class: [size, n < hi ? 'mid' : ''].join(' '), style: { '--p': String(n) }, role: 'img', 'aria-label': `Punteggio ${n} su 100`, title: 'Punteggio del radar (0–100)' },
    h('span', String(n)));
}

// intestazione della pagina: eyebrow arancione, titolo Light con la parola chiave Bold, una frase sotto
export const title = (light, bold, after = '') => [light ? `${light} ` : '', h('b', bold), after ? ` ${after}` : ''];
export function pageTop({ eyebrow, heading, sub, actions = [] }) {
  return h('div.cv-top',
    h('div.cv-top-l', eyebrow ? h('div.cv-eyebrow', eyebrow) : null, h('h1.cv-h1', heading), sub ? h('p.cv-sub', sub) : null),
    actions.filter(Boolean).length ? h('div.cv-top-r', actions.filter(Boolean)) : null);
}

// contatori della pagina: icona + numero + due parole; lo zero diventa tenue; cliccabili
export function kpiRow(items) {
  return h('div.cv-focus', items.filter(Boolean).map(k => {
    const attrs = { class: k.n ? (k.tone || '') : 'zero', 'aria-label': `${k.n} ${k.label.join(' ')}` };
    const inner = [h('span.cv-fc-ic', ic(k.icon, 17)), h('span.cv-fc-n', String(k.n)), h('span.cv-fc-l', k.label[0], h('br'), ' ', k.label[1] || '')];
    if (k.href) return h('a.cv-fc', { ...attrs, href: k.href }, inner);
    if (k.onClick) return h('button.cv-fc', { ...attrs, type: 'button', on: { click: k.onClick } }, inner);
    return h('div.cv-fc', attrs, inner);
  }));
}

// card: titolo 15 medium (con icona), contatore in pillola grigia, link o comandi a destra; va a capo invece di uscire
export function card({ title: t, icon: i, count, right, cls = '', attrs = {} }, ...body) {
  return h('section.cv-card', { ...attrs, class: cls },
    h('div.cv-ch', h('h3.cv-t', i ? ic(i, 17) : null, h('span', t), count !== null && count !== undefined ? h('span.cv-c', String(count)) : null), right ? h('div.cv-ch-r', right) : null),
    ...body);
}
export const link = (text, attrs = {}) => h(attrs.href ? 'a.cv-lnk' : 'button.cv-lnk', { type: attrs.href ? undefined : 'button', ...attrs }, text);
export const sect = (label, red = false) => h('div.cv-sect', { class: red ? 'rd' : '' }, label);

// riga ricorrente: icona colorata in un quadrato da 34, titolo su una riga con «…», dettagli «chi · quando», azione a destra
export function listRow({ icon: i, tone = '', lead, title: t, after, meta, extra, actions, href, onClick, cls = '', titleAttrs = {} }) {
  const text = [h('div.cv-li-t', { ...titleAttrs }, h('span.cv-ell', t), after || null), meta ? h('div.cv-li-m', meta) : null, extra || null];
  const main = href ? h('a.cv-li-main', { href }, text) : onClick ? h('button.cv-li-main', { type: 'button', on: { click: onClick } }, text) : h('div.cv-li-main', text);
  return h('div.cv-li', { class: cls },
    lead || (i ? h('span.cv-ib', { class: tone, 'aria-hidden': 'true' }, ic(i, 16)) : null),
    main,
    actions ? h('div.cv-acts', actions) : null);
}

// stato vuoto: icona + frase + azione
export const emptyState = (i, text, action = null) => h('div.cv-empty', h('span.cv-ei', { 'aria-hidden': 'true' }, ic(i, 17)), h('span.cv-grow', text), action);

// segmento a pillola (filtri veloci); options = [[key, label, n?]]
export function seg(options, value, onChange, { label = 'Filtro' } = {}) {
  const el = h('div.cv-seg', { role: 'group', 'aria-label': label });
  const draw = cur => fill(el, options.map(([k, l, n]) => h('button', {
    type: 'button', class: k === cur ? 'on' : '', 'aria-pressed': String(k === cur),
    on: { click: () => { draw(k); onChange(k); } },
  }, l, n !== undefined && n !== null ? h('i.cv-seg-n', String(n)) : null)));
  draw(value);
  return el;
}

// tab con la sottolineatura arancione; quelli in più finiscono in «Altro ▾». tabs = [[key, label, count?, warn?]]
export function tabsBar(tabs, active, go, { max = 7 } = {}) {
  const item = ([k, l, n, warn]) => h('button.cv-tab', {
    type: 'button', role: 'tab', class: k === active ? 'on' : '', 'aria-selected': String(k === active), 'data-tab': k, on: { click: () => go(k) },
  }, l, n ? h('i.cv-tab-n', String(n)) : null, warn ? h('span.cv-bang', { title: 'Incontri fatti senza note' }, '!') : null);
  const shown = tabs.slice(0, max);
  const rest = tabs.slice(max);
  const activeInRest = rest.some(([k]) => k === active);
  return h('nav.cv-tabs', { role: 'tablist' }, shown.map(item),
    rest.length ? h('details.cv-more', h('summary.cv-tab', { class: activeInRest ? 'on' : '' }, activeInRest ? rest.find(([k]) => k === active)[1] : 'Altro', ic('chevron-down', 13)),
      h('div.cv-menu', { role: 'menu' }, rest.map(([k, l, n]) => h('button', { type: 'button', role: 'menuitem', class: k === active ? 'on' : '', on: { click: e => { e.currentTarget.closest('details').open = false; go(k); } } }, l, n ? h('i.cv-tab-n', String(n)) : null)))) : null);
}

// menu «…» con le azioni secondarie
export function moreMenu(items, { label = 'Altre azioni', ghost = false } = {}) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  const d = h('details.cv-more.cv-more-r', h(ghost ? 'summary.btn.btn-ghost.btn-sm.cv-ico' : 'summary.btn.cv-ico', { 'aria-label': label, title: label }, ic('more', 16)),
    h('div.cv-menu', { role: 'menu' }, list.map(([text, fn, danger]) => h('button', { type: 'button', role: 'menuitem', class: danger ? 'danger' : '', on: { click: () => { d.open = false; fn(); } } }, text))));
  return d;
}

// interruttore al posto della casella (impostazioni, key account)
export function toggle(checked, label, attrs = {}) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked: Boolean(checked), ...attrs });
  return { input, el: h('label.cv-tg', input, h('span.cv-tg-ui', { 'aria-hidden': 'true' }), label ? h('span', label) : null) };
}

// pillole a scelta singola (motivi, date rapide, ritmo); restituisce { el, get value, set }
export function choiceChips(options, value, { onChange, label = 'Scegli' } = {}) {
  let cur = value;
  const el = h('div.cv-chips', { role: 'radiogroup', 'aria-label': label });
  const draw = () => fill(el, options.map(([k, l]) => h('button.cv-chip', {
    type: 'button', role: 'radio', class: k === cur ? 'on' : '', 'aria-checked': String(k === cur),
    on: { click: () => { cur = k; draw(); onChange?.(k); } },
  }, l)));
  draw();
  return { el, get value() { return cur; }, set: k => { cur = k; draw(); } };
}

// finestra v2 (angoli 22, piede grigio fisso con le azioni secondarie a sinistra); drawer = riquadro laterale da 600
export function cvModal(opts) {
  const m = modal(opts);
  m.box.classList.add('cv-dlg');
  if (opts.drawer) m.box.classList.add('cv-drawer');
  if (opts.size) m.box.classList.add(`cv-${opts.size}`);
  return m;
}
