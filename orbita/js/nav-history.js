// ── Navigazione Indietro / Avanti (ALM2-97) ──────────────────────────────────────────────────────────────
// Come un browser o un'app moderna: due frecce nella barra in alto, a sinistra del percorso. Passando sopra
// alla freccia si legge dove porta («Indietro · Hoshin Kanri 2026»); il clic destro, la pressione lunga o il
// pulsante con l'orologio aprono la cronologia della scheda con le ultime pagine, il loro modulo e da quanto.
// Alt+← / Alt+→ funzionano come nel browser. Al primo ingresso, senza pagine prima, «Indietro» porta alla
// prima pagina del modulo in cui si è (mai al login di Microsoft o al sito da cui si arriva).
//
// Con la Navigation API (Edge, Chrome, Safari recenti) la cronologia è quella vera del browser: ogni voce ha una
// chiave che resta uguale quando la pagina si rimanda altrove (location.replace, tab con replaceState), così un
// «progetto → A3» resta una pagina sola. Senza, ogni voce porta un numero in history.state.navId.
import { h } from './ui.js';
import { icon } from './icons.js';

const KEY = 'alma.nav';
const MAX = 60;
let st = (() => { try { return JSON.parse(sessionStorage.getItem(KEY)) || { list: [], i: -1, n: 0 }; } catch { return { list: [], i: -1, n: 0 }; } })();
const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch { /* niente */ } };
const cur = () => st.list[st.i];
const NAV = typeof window.navigation?.entries === 'function' ? window.navigation : null;
const META_KEY = 'alma.navMeta';
let meta = (() => { try { return JSON.parse(sessionStorage.getItem(META_KEY)) || {}; } catch { return {}; } })();
const inApp = url => { try { return new URL(url).pathname.startsWith('/app'); } catch { return false; } };
const hashOf = url => { try { return new URL(url).hash || '#/'; } catch { return '#/'; } };
// la cronologia vera della scheda, solo le pagine di Alma Space attaccate a quella in cui si è
function syncNav() {
  const es = NAV.entries();
  const at = es.findIndex(e => e.key === NAV.currentEntry?.key);
  let a = at, b = at;
  while (a > 0 && inApp(es[a - 1].url)) a--;
  while (b < es.length - 1 && inApp(es[b + 1].url)) b++;
  const keep = at < 0 ? [] : es.slice(a, b + 1);
  st.list = keep.map(e => ({ id: e.key, hash: hashOf(e.url), ...(meta[e.key] || {}), done: true }));
  st.i = at < 0 ? -1 : at - a;
  const keys = new Set(keep.map(e => e.key));
  for (const k of Object.keys(meta)) if (!keys.has(k)) delete meta[k];
  try { sessionStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* niente */ }
}

// i tab che cambiano l'indirizzo senza una pagina nuova (progetti, CRM, Strategy…) usano replaceState(null):
// si tiene il numero della voce e si aggiorna il suo indirizzo, così tornando qui si riapre lo stesso tab
const origReplace = history.replaceState.bind(history);
if (!NAV) history.replaceState = (state, title, url) => {
  const e = cur();
  origReplace(state ?? (e ? { navId: e.id } : null), title, url);
  if (e && url && e.id === history.state?.navId) { e.hash = String(url).replace(/^[^#]*/, '') || e.hash; save(); }
};

let ui = null; // { back, fwd, hist, tip }
let modInfo = () => ({ label: '', icon: 'circle', home: '#/' });

// chiamata da route() a ogni cambio di indirizzo, prima di disegnare la pagina
export function navTrack(hash, mod) {
  if (NAV) {
    const k = NAV.currentEntry?.key;
    if (k) {
      const m = meta[k];
      // stessa voce rimandata altrove (location.replace): nuovo modulo e titolo
      meta[k] = m && m.hash === hash ? m : { hash, mod: mod.key, title: '', t: Date.now() };
    }
    syncNav();
    draw();
    return;
  }
  const id = history.state?.navId;
  const at = id ? st.list.findIndex(x => x.id === id) : -1;
  if (at >= 0) {
    st.i = at; // indietro, avanti o la stessa pagina ricaricata
    st.list[at].hash = hash;
  } else if (cur() && !cur().done && !id) {
    // la pagina di prima non è mai arrivata a disegnarsi (un rimando con location.replace): la si sostituisce
    Object.assign(cur(), { hash, mod: mod.key, title: '', done: false, t: Date.now() });
    origReplace({ ...(history.state || {}), navId: cur().id }, '', location.href);
  } else {
    const e = { id: ++st.n, hash, mod: mod.key, title: '', done: false, t: Date.now() };
    st.list = st.list.slice(0, st.i + 1);
    st.list.push(e);
    if (st.list.length > MAX) st.list = st.list.slice(-MAX);
    st.i = st.list.length - 1;
    origReplace({ ...(history.state || {}), navId: e.id }, '', location.href);
  }
  save();
  draw();
}

// chiamata quando la pagina è disegnata: il titolo che si legge nella cronologia
export function navDone(title) {
  if (NAV) {
    const k = NAV.currentEntry?.key;
    if (k && meta[k] && title) { meta[k].title = title.slice(0, 70); try { sessionStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* niente */ } }
    syncNav();
    draw();
    return;
  }
  const e = cur();
  if (!e) return;
  e.done = true;
  if (title) e.title = title.slice(0, 70);
  save();
  draw();
}

export function navBack() {
  if (st.i > 0) history.back();
  else {
    const home = modInfo(cur()?.mod).home;
    if (location.hash !== home) location.hash = home;
  }
}
export function navForward() { if (st.i < st.list.length - 1) history.forward(); }
const jump = idx => { const d = idx - st.i; if (!d) return; if (NAV) NAV.traverseTo(st.list[idx].id); else history.go(d); };

const labelOf = e => e?.title || modInfo(e?.mod).label || 'Pagina precedente';
const ago = t => {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'adesso' : m < 60 ? `${m} min fa` : `${Math.round(m / 60)} h fa`;
};

function draw() {
  if (!ui) return;
  const prev = st.list[st.i - 1];
  const next = st.list[st.i + 1];
  const atHome = !prev && location.hash === modInfo(cur()?.mod).home;
  ui.back.disabled = atHome;
  ui.back.dataset.tip = prev ? `Indietro · ${labelOf(prev)}` : `Inizio di ${modInfo(cur()?.mod).label}`;
  ui.back.setAttribute('aria-label', ui.back.dataset.tip);
  ui.fwd.disabled = !next;
  ui.fwd.dataset.tip = next ? `Avanti · ${labelOf(next)}` : 'Avanti';
  ui.fwd.setAttribute('aria-label', ui.fwd.dataset.tip);
  ui.hist.disabled = st.list.length < 2;
}

// ── cronologia della scheda ──
let menu = null;
function closeMenu() { menu?.remove(); menu = null; ui?.hist.setAttribute('aria-expanded', 'false'); }
function openMenu(anchor) {
  if (menu) { closeMenu(); return; }
  ui?.tipEl?.remove();
  // solo le pagine di cui si sa cosa sono (quelle aperte prima di ricaricare la scheda non hanno il titolo)
  const rows = st.list.map((e, idx) => ({ e, idx })).filter(({ e, idx }) => e.mod || idx === st.i).reverse().slice(0, 15);
  const m = modInfo;
  menu = h('div.nh-menu', { role: 'menu', 'aria-label': 'Pagine visitate' },
    h('div.nh-menu-head', icon('history', { size: 14 }), 'Pagine visitate in questa scheda'),
    ...rows.map(({ e, idx }) => h('button.nh-row', { type: 'button', role: 'menuitem', class: idx === st.i ? 'on' : '',
      on: { click: () => { closeMenu(); jump(idx); } } },
      h('span.nh-ico', icon(m(e.mod).icon, { size: 15 })),
      h('span.nh-txt', h('b', labelOf(e)), h('small', [m(e.mod).label, idx === st.i ? 'sei qui' : ago(e.t)].filter(Boolean).join(' · '))),
      idx === st.i ? h('span.nh-here', icon('check', { size: 15 })) : null)),
    h('div.nh-menu-foot', h('kbd', 'Alt ←'), ' indietro ', h('kbd', 'Alt →'), ' avanti'));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 8}px`;
  menu.style.left = `${Math.max(12, r.left)}px`;
  ui.hist.setAttribute('aria-expanded', 'true');
  menu.querySelector('.nh-row.on, .nh-row')?.focus();
}

// tooltip leggero, come nelle app: compare subito sotto la freccia
function tip(btn) {
  if (!ui.tipEl) ui.tipEl = h('div.nh-tip', { role: 'tooltip' });
  const show = () => { if (btn.disabled && btn !== ui.back) return; ui.tipEl.textContent = btn.dataset.tip; document.body.append(ui.tipEl); const r = btn.getBoundingClientRect(); ui.tipEl.style.top = `${r.bottom + 6}px`; ui.tipEl.style.left = `${r.left}px`; };
  const hide = () => ui.tipEl.remove();
  btn.addEventListener('mouseenter', show);
  btn.addEventListener('mouseleave', hide);
  btn.addEventListener('focus', show);
  btn.addEventListener('blur', hide);
  btn.addEventListener('click', hide);
}

// le frecce nella barra in alto (computer); getModule(key) → { label, icon, home }
export function navButtons(getModule) {
  modInfo = key => getModule(key) || { label: '', icon: 'circle', home: '#/' };
  const back = h('button.nh-btn', { type: 'button', 'aria-keyshortcuts': 'Alt+ArrowLeft', on: { click: navBack } }, icon('chevron-left', { size: 18 }));
  const fwd = h('button.nh-btn', { type: 'button', 'aria-keyshortcuts': 'Alt+ArrowRight', on: { click: navForward } }, icon('chevron-right', { size: 18 }));
  const hist = h('button.nh-btn.nh-hist', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Pagine visitate', 'data-tip': 'Pagine visitate',
    on: { click: e => { e.stopPropagation(); openMenu(back); } } }, icon('history', { size: 16 }));
  ui = { back, fwd, hist };
  // clic destro o pressione lunga sulla freccia = cronologia, come nei browser
  back.addEventListener('contextmenu', e => { e.preventDefault(); openMenu(back); });
  let press = null;
  back.addEventListener('pointerdown', () => { press = setTimeout(() => { press = 'long'; openMenu(back); }, 500); });
  back.addEventListener('pointerup', e => { if (press === 'long') { e.preventDefault(); } clearTimeout(press); });
  back.addEventListener('click', e => { if (press === 'long') { e.stopImmediatePropagation(); press = null; } }, true);
  for (const b of [back, fwd, hist]) tip(b);
  document.addEventListener('click', e => { if (menu && !e.target.closest('.nh-menu')) closeMenu(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menu) { e.stopPropagation(); closeMenu(); }
    if (menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const rows = [...menu.querySelectorAll('.nh-row')];
      const k = rows.indexOf(document.activeElement);
      rows[(k + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
    }
  }, true);
  addEventListener('hashchange', closeMenu);
  draw();
  return h('div.nh', { role: 'group', 'aria-label': 'Navigazione' }, back, fwd, hist);
}

// mantenuto per il telefono e per chi chiama ancora la vecchia freccia
export function navHasBack() { return st.i > 0; }
