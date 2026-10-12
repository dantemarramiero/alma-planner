// Ricerca unica: casella in cima alla barra laterale (su computer), lente nella barra in alto (sul telefono),
// pagina #/search?q=… con i risultati per gruppo. «/» o Ctrl+K portano alla ricerca da qualsiasi pagina.
import { h, clear, fill, avatar, loading, debounce } from './ui.js';
import { icon } from './icons.js';
import { get } from './api.js';

const ICON = { ticket: 'square-check', project: 'folder', note: 'file-text', email: 'mail', person: 'user', post: 'image' };

// Il testo con la parola cercata evidenziata (nodi, niente HTML).
function highlight(text, q) {
  const s = String(text || '');
  if (!q) return [s];
  const out = [];
  const low = s.toLowerCase(), ql = q.toLowerCase();
  let i = 0, at;
  while ((at = low.indexOf(ql, i)) >= 0) {
    out.push(s.slice(i, at), h('mark', s.slice(at, at + q.length)));
    i = at + q.length;
  }
  out.push(s.slice(i));
  return out;
}

async function openResult(type, it) {
  if (type === 'ticket') return (await import('./tickets.js')).openTicket(it.id, {});
  if (type === 'project') { location.hash = `#/projects/${it.id}`; return; }
  if (type === 'note') {
    if (it.project_id) { location.hash = `#/projects/${it.project_id}/note`; return; }
    return (await import('./tickets.js')).openTicket(it.ticket_id, {});
  }
  if (type === 'email') { location.hash = `#/projects/${it.project_id}/email`; return; }
  if (type === 'person') { location.hash = it.id ? `#/u/${it.id}` : '#/org'; return; }
  if (type === 'post') location.hash = `#/p/${it.id}`;
}

export function searchView(view, params) {
  let q = (params.get('q') || '').trim();
  let seq = 0;
  const input = h('input.input.search-big', { type: 'search', value: q, placeholder: 'Cerca ticket, progetti, note, email, persone…', autofocus: true, 'aria-label': 'Cerca' });
  const results = h('div.search-results');
  fill(view, h('div.search-page',
    h('div.page-head', h('h1', 'Cerca')),
    h('div.search-field', icon('search', { size: 18 }), input),
    results));
  setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 0);

  async function run() {
    const mine = ++seq;
    if (q.length < 2) {
      fill(results, h('p.muted.search-hint', 'Scrivi almeno 2 lettere. Cerca nei ticket, nei progetti, nelle note, nelle email dei progetti, tra le persone e nei post.'));
      return;
    }
    fill(results, loading());
    let data;
    try { data = await get(`/api/search?q=${encodeURIComponent(q)}`, { quiet: true }); } catch (err) { if (mine === seq) fill(results, h('p.muted', err.message)); return; }
    if (mine !== seq) return; // nel frattempo si è scritto altro
    if (!data.groups.length) return fill(results, h('div.card.empty', `Nessun risultato per «${q}». Prova con un'altra parola o con meno lettere.`));
    fill(results, data.groups.map(g => h('section.search-group',
      h('h2.search-group-title', g.label, h('span.search-count', String(g.items.length))),
      h('div.card.search-list', g.items.map(it => h('button.search-item', { type: 'button', on: { click: () => openResult(g.type, it) } },
        g.type === 'person' && it.id ? avatar({ name: it.title, avatar_id: it.avatar_id }, 30) : h('span.search-ico', icon(ICON[g.type], { size: 18 })),
        h('span.search-main',
          h('span.search-title', highlight(it.title, q)),
          it.sub ? h('span.search-sub', it.sub) : null,
          it.snippet ? h('span.search-snippet', highlight(it.snippet, q)) : null)))))));
  }

  const update = debounce(() => {
    q = input.value.trim();
    history.replaceState(null, '', `#/search${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    syncSidebar(q);
    run();
  }, 250);
  input.addEventListener('input', update);
  run();
}

// ── casella nella barra laterale e scorciatoie ───────────────────────────────
let sideInput = null;
function syncSidebar(q) { if (sideInput && document.activeElement !== sideInput) sideInput.value = q; }

export function setupSearch() {
  const go = q => {
    const hash = `#/search${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    if (location.hash.startsWith('#/search')) {
      // già nella pagina: aggiorna la sua casella
      const big = document.querySelector('.search-big');
      if (big) { big.value = q; big.dispatchEvent(new Event('input')); return; }
    }
    location.hash = hash;
  };

  // computer: casella sotto il logo
  const brand = document.querySelector('.sidebar .brand-side');
  if (brand) {
    sideInput = h('input.input', { type: 'search', placeholder: 'Cerca…  (/)', 'aria-label': 'Cerca in Alma Planet' });
    const box = h('div.side-search', icon('search', { size: 16 }), sideInput);
    brand.after(box);
    sideInput.addEventListener('input', debounce(() => { const q = sideInput.value.trim(); if (q.length >= 2 || location.hash.startsWith('#/search')) go(q); }, 300));
    sideInput.addEventListener('keydown', e => { if (e.key === 'Enter') go(sideInput.value.trim()); if (e.key === 'Escape') sideInput.blur(); });
  }

  // telefono: lente nella barra in alto
  const icons = document.querySelector('.m-top .m-icons');
  if (icons) icons.prepend(h('a.m-ico', { href: '#/search', 'aria-label': 'Cerca', 'data-nav': 'search' }, icon('search', { size: 24 })));

  // «/» o Ctrl+K da qualsiasi pagina (non mentre si scrive)
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    const shortcut = (e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing);
    if (!shortcut) return;
    e.preventDefault();
    if (sideInput && sideInput.offsetParent) sideInput.focus();
    else location.hash = '#/search';
  });
}
