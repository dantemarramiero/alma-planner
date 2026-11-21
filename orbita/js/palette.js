// Barra di ricerca in alto e finestra Ctrl K (ALM2-46, canvas CRM v10 · V10-Barra, via di Dante 19/11/2026).
// - Sul computer una barra fissa al centro in alto su ogni pagina, con «+ Nuovo», notifiche e profilo a destra.
// - Ctrl K (⌘K), «/» o un clic sulla barra aprono la finestra: cerca insieme aziende e contatti del CRM (prima),
//   progetti, ticket, note, email, persone e post; frecce ↑↓ e Invio per aprire, Esc per chiudere.
// - «+ Nuovo» (o Ctrl Shift K) apre la stessa finestra con le azioni «Crea»; Alt + lettera crea subito.
// - Con due lettere o più, in fondo «Chiedi ad Alma». La pagina #/search resta per vedere tutti i risultati.
import { h, fill, avatar, debounce, isMobile } from './ui.js';
import { icon } from './icons.js';
import { get } from './api.js';
import { store } from './store.js';

const TYPE = { subject: ['Azienda', 'crm'], contact: ['Contatto', 'crm'], mail: ['Dalla posta', 'mail'], project: ['Progetto', ''], ticket: ['Ticket', ''],
  note: ['Nota', ''], email: ['Email', 'mail'], person: ['Persona', ''], post: ['Post', ''] };
const ROLE = { lead: 'Lead', cliente: 'Cliente', fornitore: 'Fornitore', partner: 'Partner', concorrente: 'Concorrente' };

// azioni «Crea»: lettera, testo, chi le vede, cosa fanno
const ACTIONS = [
  { key: 'c', label: 'Nuovo contatto', sub: 'Nel CRM, con la sua azienda', icon: 'user-plus', tone: 'c', crm: true, run: async () => (await import('./crm.js')).newContact() },
  { key: 'm', label: 'Contatto dalla mia posta', sub: 'Persone con cui mi scrivo e non sono nel CRM', icon: 'mail', tone: 'c', crm: true, run: () => { location.hash = '#/crm/contatti/scrivo'; } },
  { key: 'a', label: 'Nuova azienda', sub: 'Lead, cliente, fornitore o partner', icon: 'building', tone: 'a', crm: true, run: async () => (await import('./crm.js')).newSubject() },
  { key: 't', label: 'Nuovo ticket', sub: 'Una cosa da fare, anche per un collega', icon: 'square-check', tone: 't', run: async () => (await import('./tickets.js')).openTicket(null, { defaults: { assignee_ids: [store.me.id] } }) },
  { key: 'p', label: 'Nuovo progetto', sub: 'Con Gantt, ticket, documenti e persone', icon: 'folder', tone: 'p', run: async () => (await import('./projects.js')).editProject(null, p => { location.hash = `#/projects/${p.id}`; }) },
  { key: 'n', label: 'Nuovo post', sub: 'In bacheca, per tutta Almacis', icon: 'image', tone: 'n', run: async () => (await import('./feed.js')).openComposer({ onCreated: () => { location.hash = '#/'; } }) },
];
const actionsFor = () => ACTIONS.filter(a => !a.crm || store.me?.crm);

function highlight(text, q) {
  const s = String(text || '');
  if (!q) return [s];
  const out = [];
  const low = s.toLowerCase(), ql = q.toLowerCase();
  let i = 0, at;
  while ((at = low.indexOf(ql, i)) >= 0) { out.push(s.slice(i, at), h('mark', s.slice(at, at + q.length))); i = at + q.length; }
  out.push(s.slice(i));
  return out;
}

async function openItem(it) {
  if (it.type === 'subject') { location.hash = `#/crm/scheda/${it.id}`; return; }
  if (it.type === 'contact') { location.hash = `#/crm/contatti/${it.id}`; return; }
  if (it.type === 'mail') { location.hash = `#/crm/contatti/scrivo?q=${encodeURIComponent(it.email)}`; return; }
  if (it.type === 'ticket') return (await import('./tickets.js')).openTicket(it.id, {});
  if (it.type === 'project') { location.hash = `#/projects/${it.id}`; return; }
  if (it.type === 'note') { if (it.project_id) { location.hash = `#/projects/${it.project_id}/note`; return; } return (await import('./tickets.js')).openTicket(it.ticket_id, {}); }
  if (it.type === 'email') { location.hash = `#/projects/${it.project_id}/email`; return; }
  if (it.type === 'person') { location.hash = it.id ? `#/u/${it.id}` : '#/org'; return; }
  if (it.type === 'post') location.hash = `#/p/${it.id}`;
}

// ── la finestra ──────────────────────────────────────────────────────────────
let current = null; // finestra aperta (una sola)

export function openPalette({ mode = 'search', q = '' } = {}) {
  if (current) { current.setMode(mode); return; }
  const back = document.activeElement;
  const input = h('input.pal-input', { type: 'text', value: q, placeholder: mode === 'new' ? 'Cosa vuoi creare? Scrivi o premi una lettera' : 'Cerca aziende, contatti, progetti, ticket, email…',
    'aria-label': 'Cerca o crea', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list' });
  const list = h('div.pal-list', { id: 'pal-list', role: 'listbox', 'aria-label': 'Risultati' });
  const foot = h('div.pal-foot', h('span', '↑↓ per scegliere · Invio per aprire · Ctrl Invio = tutti i risultati'), h('span', 'Esc per chiudere'));
  const box = h('div.pal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Cerca o crea' },
    h('label.pal-in', icon('search', { size: 20 }), input, h('kbd', 'Esc')), list, foot);
  const veil = h('div.pal-veil', { on: { mousedown: e => { if (e.target === veil) close(); } } }, box);
  document.body.append(veil);
  document.documentElement.classList.add('pal-open');
  let items = [];  // { el, run }
  let sel = 0;
  let seq = 0;
  let state = { mode };

  const close = () => {
    veil.remove();
    document.documentElement.classList.remove('pal-open');
    document.removeEventListener('keydown', keys, true);
    current = null;
    if (back && back.focus && document.contains(back)) back.focus();
  };
  const pick = i => {
    sel = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((it, k) => { it.el.classList.toggle('on', k === sel); it.el.setAttribute('aria-selected', String(k === sel)); });
    items[sel]?.el.scrollIntoView({ block: 'nearest' });
  };
  const runItem = it => { close(); it.run(); };
  const row = (attrs, ...kids) => {
    const el = h('button.pal-it', { type: 'button', role: 'option', ...attrs }, ...kids);
    return el;
  };
  const section = label => h('div.pal-sec', label);

  function draw(groups, qq) {
    items = [];
    const nodes = [];
    for (const g of groups) {
      if (!g.rows.length) continue;
      nodes.push(section(g.label));
      for (const r of g.rows) {
        const el = row({ on: { click: () => runItem(r), mousemove: () => pick(items.findIndex(x => x.el === el)) } }, ...r.view(qq));
        items.push({ el, run: r.run });
        nodes.push(el);
      }
    }
    if (!nodes.length) nodes.push(h('p.pal-empty', qq.length < 2 ? 'Scrivi almeno 2 lettere.' : `Nessun risultato per «${qq}». Prova con meno lettere, o chiedi ad Alma.`));
    fill(list, nodes);
    pick(0);
  }

  const typeTag = t => h('span.pal-type', { class: TYPE[t]?.[1] || '' }, TYPE[t]?.[0] || t);
  const main = (title, sub, qq) => h('span.pal-tt', h('b', highlight(title, qq)), sub ? h('small', highlight(sub, qq)) : null);
  const actionRow = a => ({ run: a.run, view: () => [h('span.pal-plus', { class: `t-${a.tone}` }, icon(a.icon, { size: 16 })), main(a.label, a.sub, ''), h('kbd.pal-key', `Alt ${a.key.toUpperCase()}`)] });
  const almaRow = qq => ({ run: () => { location.hash = `#/alma?q=${encodeURIComponent(qq)}`; },
    view: () => [h('span.pal-alma', icon('sparkles', { size: 15 })), main(`Chiedi ad Alma: «${qq}»`, 'Alma cerca nei dati e ti risponde', '')] });
  const seeAll = qq => ({ run: () => { location.hash = `#/search?q=${encodeURIComponent(qq)}`; },
    view: () => [h('span.pal-plus.t-n', icon('list', { size: 16 })), main('Vedi tutti i risultati', `nella pagina Cerca · «${qq}»`, '')] });

  async function run() {
    const qq = input.value.trim();
    const mine = ++seq;
    const acts = actionsFor();
    if (state.mode === 'new') {
      const f = qq.toLowerCase();
      draw([{ label: 'Crea', rows: acts.filter(a => !f || a.label.toLowerCase().includes(f) || a.sub.toLowerCase().includes(f)).map(actionRow) }], '');
      return;
    }
    if (qq.length < 2) {
      draw([{ label: 'Crea', rows: acts.map(actionRow) }], qq);
      return;
    }
    list.setAttribute('aria-busy', 'true');
    const [crm, rest] = await Promise.all([
      store.me?.crm ? get(`/api/crm/scrivo/cerca?q=${encodeURIComponent(qq)}`, { quiet: true }).catch(() => null) : null,
      get(`/api/search?q=${encodeURIComponent(qq)}`, { quiet: true }).catch(() => ({ groups: [] })),
    ]);
    if (mine !== seq) return; // nel frattempo si è scritto altro
    list.removeAttribute('aria-busy');
    const G = t => (rest.groups || []).find(g => g.type === t)?.items || [];
    const gen = (type, arr, map) => arr.slice(0, 4).map(x => { const it = { ...x, type }; const m = map(it); return { run: () => openItem(it), view: q2 => [typeTag(m.tag || type), main(m.title, m.sub, q2), m.meta ? h('span.pal-meta', m.meta) : null] }; });
    draw([
      { label: 'Alma CRM', rows: [
        ...gen('subject', crm?.subjects || [], s => ({ title: s.name, sub: [s.roles?.map(r => ROLE[r]).filter(Boolean).join(', '), s.city, s.emails ? `${s.emails} email` : ''].filter(Boolean).join(' · ') })),
        ...gen('contact', crm?.contacts || [], c => ({ title: c.name, sub: [c.sub, c.email].filter(Boolean).join(' · ') })),
        ...gen('mail', crm?.mail || [], m => ({ title: m.name || m.email, sub: `${m.email} · non è nel CRM`, meta: 'Crea contatto' })),
      ] },
      { label: 'Progetti e ticket', rows: [
        ...gen('project', G('project'), p => ({ title: p.title, sub: p.sub || p.snippet })),
        ...gen('ticket', G('ticket'), t => ({ title: t.title, sub: t.sub })),
      ] },
      { label: 'Note ed email', rows: [
        ...gen('note', G('note'), n => ({ title: n.title, sub: n.sub })),
        ...gen('email', G('email'), e => ({ title: e.title, sub: e.sub })),
      ] },
      { label: 'Persone e post', rows: [
        ...gen('person', G('person'), p => ({ title: p.title, sub: p.sub })),
        ...gen('post', G('post'), p => ({ title: p.title, sub: '' })),
      ] },
      { label: 'Altro', rows: [seeAll(qq), almaRow(qq)] },
    ], qq);
  }

  function keys(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); pick(sel + 1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); pick(sel - 1); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const qq = input.value.trim();
      if ((e.ctrlKey || e.metaKey) && qq.length >= 2) { close(); location.hash = `#/search?q=${encodeURIComponent(qq)}`; return; }
      if (items[sel]) runItem(items[sel]);
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^Key[A-Z]$/.test(e.code)) {
      const a = actionsFor().find(x => x.key === e.code.slice(3).toLowerCase());
      if (a) { e.preventDefault(); close(); a.run(); }
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); input.focus(); } // il fuoco resta nella finestra
  }
  document.addEventListener('keydown', keys, true);
  const update = debounce(run, 180);
  input.addEventListener('input', update);
  current = {
    setMode(m) { state.mode = m; input.placeholder = m === 'new' ? 'Cosa vuoi creare? Scrivi o premi una lettera' : 'Cerca aziende, contatti, progetti, ticket, email…'; input.value = ''; input.focus(); run(); },
  };
  setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 0);
  run();
}

// ── barra in alto (computer) e scorciatoie ───────────────────────────────────
export function setupTopbar() {
  const main = document.querySelector('.shell > main.main');
  if (main && !document.querySelector('.topbar')) {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const crumb = h('div.tb-crumb', { id: 'tb-crumb' });
    const me = h('a.tb-av', { href: `#/u/${store.me.id}`, 'aria-label': `Il mio profilo: ${store.me.name}` }, avatar(store.me, 34));
    const bar = h('header.topbar', { 'aria-label': 'Barra in alto' },
      crumb,
      h('button.tb-search', { type: 'button', 'aria-label': 'Cerca in Alma Space', 'aria-keyshortcuts': mac ? 'Meta+K' : 'Control+K', on: { click: () => openPalette() } },
        icon('search', { size: 18 }), h('span', 'Cerca aziende, contatti, progetti, ticket, email…'), h('kbd', mac ? '⌘ K' : 'Ctrl K')),
      h('div.tb-right',
        h('button.btn.btn-primary.tb-new', { type: 'button', 'aria-keyshortcuts': mac ? 'Meta+Shift+K' : 'Control+Shift+K', on: { click: () => openPalette({ mode: 'new' }) } }, icon('plus', { size: 16 }), 'Nuovo'),
        h('a.tb-ico', { href: '#/notifications', 'aria-label': 'Notifiche' }, icon('bell', { size: 18 }), h('span.nav-badge', { 'data-badge': 'notifications', hidden: true })),
        me));
    main.prepend(bar);
    document.documentElement.classList.add('has-topbar');
    document.addEventListener('me-changed', () => fill(me, avatar(store.me, 34)));
  }

  // Ctrl K / ⌘K e «/» (quando non si sta scrivendo) aprono la ricerca; Ctrl Shift K il «+ Nuovo»
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    const k = e.key && e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey);
    if (k) { e.preventDefault(); if (isMobile()) { location.hash = '#/search'; return; } openPalette({ mode: e.shiftKey ? 'new' : 'search' }); return; }
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !current) { e.preventDefault(); if (isMobile()) location.hash = '#/search'; else openPalette(); }
  });

  // percorso a sinistra: modulo + voce attiva del menu, aggiornato a ogni cambio di pagina
  const crumbNow = () => setTimeout(() => {
    const mod = document.getElementById('ws-name')?.textContent || '';
    const a = document.querySelector('.sidebar .nav:not([hidden]) a.active');
    const page = a ? [...a.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() : '';
    setCrumb(mod, location.hash.startsWith('#/search') ? 'Cerca' : page);
  }, 60);
  window.addEventListener('hashchange', crumbNow);
  crumbNow();
}

// Il percorso a sinistra della barra («Alma CRM › Contatti»): il modulo e la voce attiva del menu
export function setCrumb(moduleLabel, page) {
  const el = document.getElementById('tb-crumb');
  if (!el) return;
  fill(el, moduleLabel ? h('span', moduleLabel) : null, moduleLabel && page ? h('span.tb-sep', { 'aria-hidden': 'true' }, '›') : null, page ? h('b', page) : null);
}
