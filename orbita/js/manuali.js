// Manuali d'uso di Alma CRM (ALM2-72, canvas «Alma Space · Manuali d'uso del CRM» approvato da Dante il 23/11/2026).
// #/impostazioni/manuali                indice (tavola 1) con la ricerca (tavola 3)
// #/impostazioni/manuali/<id>[/<cap>]   un manuale aperto (tavola 2; sul telefono tavola 6, capitoli a pillole)
// helpButton(hash)                      «Come si usa» sulle pagine del CRM: riquadro laterale col manuale (tavola 4)
// I testi arrivano da GET /api/manuali (lib/manuali-crm.js, gli stessi che legge Alma). Classi mn-* in css/manuali.css.
import { h, fill, toast, loading, debounce, isMobile } from './ui.js';
import { get } from './api.js';
import { ic, cvModal } from './crm-v2.js';
import { openFeedback } from './feedback.js';

let catalogP = null;
const loadCatalog = () => (catalogP = catalogP || get('/api/manuali').catch(err => { catalogP = null; throw err; }));

const TONE = { inizio: 'dk', lavoro: 'bl', anagrafiche: 'or', strumenti: 'gr' };
const CALL = {
  auto: ['check', 'Succede da solo.'],
  info: ['info', 'Da sapere.'],
  bell: ['bell', 'Ti avvisa il CRM.'],
  who: ['lock', 'Chi può farlo.'],
};
const fmtDay = iso => iso.split('-').reverse().join('/');
const manualHref = (m, cap) => `#/impostazioni/manuali/${m.id}${cap ? `/${cap}` : ''}`;
const badge = (m, cls = '') => h('span.mn-num', { class: `${TONE[m.group] || ''} ${cls}`.trim(), 'aria-hidden': 'true' }, String(m.n));
const count = m => `${m.chapters.length} ${m.chapters.length === 1 ? 'capitolo' : 'capitoli'} · ${m.minutes} min`;

// «…» = etichetta a pillola, **…** = grassetto; marks = parole da evidenziare (ricerca)
function rich(text, marks = []) {
  const re = marks.length ? new RegExp(`(${marks.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi') : null;
  const hl = s => (re ? s.split(re).map((p, i) => (i % 2 ? h('mark', p) : p)) : s);
  return String(text).split(/(\*\*[^*]+\*\*|«[^»]+»)/).filter(Boolean).map(part => {
    if (part.startsWith('**')) return h('b', hl(part.slice(2, -2)));
    if (part.startsWith('«')) return h('span.mn-k', hl(part.slice(1, -1)));
    return hl(part);
  });
}

function block([kind, val]) {
  if (kind === 'p') return h('p', rich(val));
  if (kind === 'steps') return h('ol.mn-steps', val.map((s, i) => h('li', h('b.mn-n', String(i + 1)), h('span', rich(s)))));
  const [icon, lead] = CALL[kind] || CALL.info;
  return h('div.mn-call', { class: kind }, h('span.mn-ci', ic(icon, 18)), h('span', h('b', lead), ' ', rich(val)));
}

// ── pagina: indice, ricerca, manuale ─────────────────────────────────────────────────────────────
export async function renderManuali(body, parts = []) {
  fill(body, loading());
  const cat = await loadCatalog();
  const m = cat.manuals.find(x => x.id === parts[2]);
  if (m) return manualPage(body, cat, m, Number(parts[3]) || 0);
  return indexPage(body, cat);
}

function indexPage(body, cat) {
  const byGroup = id => cat.manuals.filter(m => m.group === id && m.n !== 1);
  const first = cat.manuals.find(m => m.n === 1);
  const groupsEl = h('div.mn-groups', cat.groups.filter(g => byGroup(g.id).length).map(g => h('section.mn-group',
    h('h2.mn-gh', g.name),
    h('div.mn-grid', byGroup(g.id).map(m => h('a.cv-card.mn-card', { href: manualHref(m) },
      badge(m), h('b.mn-ct', m.title), h('span.mn-cd', rich(m.desc)),
      h('span.mn-cm', count(m), m.dir ? h('span.mn-dir', 'per la direzione') : null)))))));
  const results = h('div.mn-results', { hidden: true, 'aria-live': 'polite' });
  const counter = h('span.mn-count');
  const input = h('input', { type: 'search', 'aria-label': 'Cerca nei manuali', autocomplete: 'off',
    placeholder: isMobile() ? 'Cerca nei manuali' : 'Cerca nei manuali: «trasforma in cliente», «primo passo», «biglietto»…' });
  const run = debounce(async () => {
    const q = input.value.trim();
    const searching = q.length >= 2;
    results.hidden = !searching;
    groupsEl.hidden = searching;
    hero.hidden = searching;
    if (!searching) { counter.textContent = ''; return; }
    const r = await get(`/api/manuali/cerca?q=${encodeURIComponent(q)}`, { quiet: true }).catch(() => ({ results: [] }));
    if (input.value.trim() !== q) return;
    counter.textContent = `${r.results.length} ${r.results.length === 1 ? 'risultato' : 'risultati'}`;
    const words = q.split(/\s+/).filter(w => w.length > 2);
    const manual = id => cat.manuals.find(x => x.id === id);
    fill(results,
      r.results.map(x => {
        const mm = manual(x.manual);
        return h('a.cv-card.mn-res', { href: manualHref(mm, x.chapter) }, badge(mm),
          h('span.mn-res-b', h('span.mn-res-w', `${x.title} › capitolo ${x.chapter}`),
            h('b.mn-res-h', rich(x.chapter_title, words)),
            h('span.mn-res-t', rich(snippet(x.text.replace(/[«»]/g, ''), words), words))),
          h('span.mn-res-go', 'Apri', ic('chevron-right', 14)));
      }),
      h('div.mn-ask', h('span', r.results.length ? 'Non trovi quello che cerchi?' : 'Nei manuali non c\'è.'),
        h('button.btn.btn-dark', { type: 'button', on: { click: () => askAlma(`Come si fa nel CRM: ${q}?`) } }, ic('sparkles', 15), 'Chiedi ad Alma'),
        h('span.cv-small.cv-muted', 'Alma risponde leggendo questi manuali.')));
  }, 200);
  input.addEventListener('input', run);
  const hero = first ? h('a.mn-hero', { href: manualHref(first) },
    h('span.mn-hero-l', h('span.mn-num.big', '1'),
      h('span', h('span.mn-hero-e', 'Da dove partire'), h('b', first.title), h('span.mn-hero-d', rich(`${first.desc} ${first.minutes} minuti.`)))),
    h('span.mn-hero-b', 'Inizia da qui')) : null;
  fill(body,
    h('div.cv-top', h('div.cv-top-l',
      h('div.cv-eyebrow', 'Impostazioni · Manuali d\'uso'),
      h('h1.cv-h1', 'Manuali d\'uso di ', h('b', 'Alma CRM')),
      h('p.cv-sub', 'Come si usa ogni pagina del CRM, passo per passo, con i nomi dei pulsanti che trovi sullo schermo.')),
    h('div.cv-top-r', h('span.mn-chip.on', `Alma CRM · ${cat.manuals.length}`), h('span.mn-chip', 'Altri moduli più avanti'))),
    h('label.mn-search', ic('search', 18), input, counter),
    hero, results, groupsEl,
    h('p.mn-foot', 'Manca qualcosa o un passaggio non torna? ', h('button.cv-lnk', { type: 'button', on: { click: () => openFeedback() } }, 'Scrivilo nei feedback'),
      `: i manuali si aggiornano a ogni funzione nuova del CRM (ultimo aggiornamento ${fmtDay(cat.updated)}).`));
  if (!isMobile()) setTimeout(() => input.focus({ preventScroll: true }), 0);
}

// il pezzo del capitolo intorno alla prima parola trovata
function snippet(text, words) {
  const low = text.toLowerCase();
  const at = Math.min(...words.map(w => low.indexOf(w.toLowerCase())).filter(i => i >= 0), Infinity);
  if (!Number.isFinite(at) || at < 80) return text.length > 220 ? `${text.slice(0, 220).trimEnd()}…` : text;
  const from = text.lastIndexOf(' ', Math.max(0, at - 60)) + 1;
  const to = text.indexOf(' ', at + 160);
  return `…${text.slice(from, to < 0 ? undefined : to).trim()}${to < 0 ? '' : '…'}`;
}

function manualPage(body, cat, m, cap) {
  const all = [...cat.manuals].sort((a, b) => a.n - b.n);
  const i = all.indexOf(m);
  const prev = all[i - 1], next = all[i + 1];
  const group = cat.groups.find(g => g.id === m.group)?.name || '';
  const secs = m.chapters.map((c, k) => h('section.mn-ch', { id: `mn-c${k + 1}`, 'data-cap': k + 1 },
    h('h2', h('span', String(k + 1)), c.t), c.b.map(block)));
  const tocLinks = m.chapters.map((c, k) => h('button', { type: 'button', 'data-cap': k + 1, on: { click: () => goCap(k + 1) } }, h('b', String(k + 1)), h('span', c.t)));
  const pills = h('div.mn-pills', m.chapters.map((c, k) => h('button', { type: 'button', 'data-cap': k + 1, on: { click: () => goCap(k + 1) } }, `${k + 1} · ${c.t}`)));
  const related = all.filter(x => x !== m && (x.group === m.group || x.n === 1)).slice(0, 3);
  const setOn = n => {
    for (const b of [...tocLinks, ...pills.children]) {
      const on = Number(b.dataset.cap) === n;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    }
    pills.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  };
  function goCap(n) {
    document.getElementById(`mn-c${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', manualHref(m, n));
    setOn(n);
  }
  const useful = h('div.mn-useful', 'Ti è stato utile?',
    h('button.btn.btn-sm', { type: 'button', on: { click: () => { fill(useful, 'Grazie!'); toast('Grazie del riscontro'); } } }, 'Sì'),
    h('button.btn.btn-sm', { type: 'button', on: { click: () => openFeedback() } }, 'No, manca qualcosa'));
  const print = () => { document.body.classList.add('mn-print'); window.print(); setTimeout(() => document.body.classList.remove('mn-print'), 500); };
  const article = h('article.cv-card.mn-article',
    h('div.mn-print-head', `Alma CRM · Manuale ${m.n} · ${m.title}`),
    secs,
    h('footer.mn-nav',
      prev ? h('a.btn', { href: manualHref(prev) }, ic('chevron-left', 15), `${prev.n} · ${prev.title}`) : h('span'),
      useful,
      next ? h('a.btn', { href: manualHref(next) }, `${next.n} · ${next.title}`, ic('chevron-right', 15)) : h('span')));
  fill(body,
    h('a.cv-crumb', { href: '#/impostazioni/manuali' }, ic('chevron-left', 14), 'Impostazioni › Manuali d\'uso › Alma CRM'),
    h('div.cv-top',
      h('div.cv-top-l.mn-head', badge(m, 'big'), h('div',
        h('div.cv-eyebrow', `Manuale · ${group}`),
        h('h1.cv-h1', h('b', m.title)),
        h('p.cv-sub', `${count(m)} · aggiornato il ${fmtDay(cat.updated)}`, m.dir ? ' · per la direzione' : ''))),
      h('div.cv-top-r',
        h('button.btn.mn-print-btn', { type: 'button', on: { click: print } }, ic('file-text', 15), 'Stampa'),
        m.page ? h('a.btn.btn-primary', { href: m.page }, ic('external', 15), `Apri ${pageName(m)}`) : null)),
    pills,
    h('div.mn-body',
      h('nav.cv-card.mn-toc', { 'aria-label': 'Capitoli' },
        h('div.mn-toc-h', 'Capitoli'), tocLinks,
        related.length ? [h('div.mn-toc-sep'), h('div.mn-toc-h', 'Leggi anche'),
          related.map(x => h('a', { href: manualHref(x) }, h('b', String(x.n)), h('span', x.title)))] : null),
      article));
  // il capitolo attivo segue lo scorrimento
  const io = new IntersectionObserver(entries => {
    const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (vis) setOn(Number(vis.target.dataset.cap));
  }, { rootMargin: '-15% 0px -70% 0px' });
  secs.forEach(s => io.observe(s));
  setOn(cap || 1);
  if (cap > 1) setTimeout(() => document.getElementById(`mn-c${cap}`)?.scrollIntoView({ block: 'start' }), 50);
  else body.closest('.view, main')?.scrollTo?.(0, 0);
}

const pageName = m => (m.page?.startsWith('#/crm/') && m.id !== 'primi-passi' ? `la pagina ${m.title}` : m.id === 'alma' ? 'Alma' : 'il CRM');

// Apre il pannello di Alma con la domanda già scritta (bottone «Chiedi ad Alma» della ricerca)
function askAlma(text) {
  const fab = document.querySelector('.al-fab');
  if (!fab) { location.hash = '#/alma'; return; }
  fab.click();
  setTimeout(() => {
    const box = document.querySelector('.al-panel:not([hidden]) textarea.al-input');
    if (box) { box.value = text; box.dispatchEvent(new Event('input', { bubbles: true })); box.focus(); }
  }, 300);
}

// ── «Come si usa» sulle pagine del CRM (tavola 4) ────────────────────────────────────────────────
// Il manuale giusto è quello con il prefisso d'indirizzo più lungo che combacia (es. #/crm/contatti/12 → scheda contatto).
export function manualFor(cat, hash) {
  let best = null, len = -1;
  for (const m of cat.manuals) for (const r of m.routes || []) {
    const ok = r.endsWith('/') ? hash.startsWith(r) && /\d/.test(hash.slice(r.length, r.length + 1)) : hash === r || hash.startsWith(`${r}/`) || hash.startsWith(`${r}?`);
    if (ok && r.length > len) { best = m; len = r.length; }
  }
  return best;
}

export function helpButton(hash = location.hash) {
  return h('button.btn.mn-help', { type: 'button', 'data-hash': hash.split('?')[0], on: { click: () => openHelp(hash) } }, ic('book-open', 15), h('span', 'Come si usa'));
}

export async function openHelp(hash = location.hash) {
  const cat = await loadCatalog();
  const m = manualFor(cat, hash.split('?')[0]) || cat.manuals.find(x => x.n === 1);
  const items = m.chapters.map((c, k) => h('details.mn-acc', { open: k === 0 },
    h('summary', h('span', c.t), ic('chevron-down', 16)), h('div.mn-acc-b', c.b.map(block))));
  let dlg = null;
  dlg = cvModal({
    drawer: true,
    title: h('div', h('div.cv-eyebrow', 'Come si usa'), h('h2.mn-dh', m.id === 'primi-passi' ? 'Il ' : 'La pagina ', h('b', m.id === 'primi-passi' ? 'CRM' : m.title))),
    body: h('div.mn-drawer', h('p.mn-dd', rich(m.desc)), items),
    actions: [h('a.btn.btn-dark', { href: manualHref(m), on: { click: () => dlg.close() } }, 'Apri il manuale completo')],
    left: [h('a.btn', { href: '#/impostazioni/manuali', on: { click: () => dlg.close() } }, 'Tutti i manuali')],
  });
  dlg.box.classList.add('mn-drawer-box');
}

// Mette «Come si usa» tra i pulsanti in alto della pagina appena disegnata (o, se la pagina non ne ha, in cima).
// Le pagine che si ridisegnano da sole (cambio di tab, filtri) lo perderebbero: un osservatore lo rimette finché
// si resta sullo stesso indirizzo.
let helpObserver = null;
export function attachHelp(container) {
  if (!container) return;
  helpObserver?.disconnect();
  const hash = location.hash;
  const place = () => {
    if (location.hash.split('?')[0] !== hash.split('?')[0]) { helpObserver?.disconnect(); return; }
    if (container.querySelector('.mn-help') || document.querySelector('.topbar .mn-help')) return;
    const right = container.querySelector('.cv-top-r, .cv-head-acts'); // testata v2 e schede di azienda e contatto
    if (right) { right.prepend(helpButton(hash)); return; }
    // testate proprie (Lead, Contatti, Radar, Progetti, Concorrenza…): la riga del titolo, accanto ai suoi pulsanti
    const h1 = [...container.querySelectorAll('h1')].find(x => !x.closest('.modal, .drawer, .mn-article'));
    const row = h1?.closest('.ld-hero-top, .rk-hero-top, .pv-row, .cg-top, .nb-top, .cv-top');
    if (row) {
      const acts = [...row.children].find(c => !c.contains(h1) && c.querySelector('.btn') && !c.matches('.pv-seg, [role="group"]'));
      if (acts) acts.prepend(helpButton(hash));
      else row.append(h('div.mn-help-wrap', helpButton(hash)));
      return;
    }
    // pagine senza testata (Posta, Calendario, Nuovi business vuoto…): nella barra in alto, accanto a «+ Nuovo»,
    // dove si vede sempre (nel percorso a sinistra si tagliava sugli schermi stretti); cambiando pagina si toglie
    const tbNew = document.querySelector('.topbar .tb-new');
    if (tbNew) { const b = helpButton(hash); b.classList.add('mn-help-tb'); tbNew.before(b); }
  };
  document.querySelectorAll('.topbar .mn-help').forEach(b => b.remove());
  place();
  let queued = false;
  helpObserver = new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; place(); }); });
  helpObserver.observe(container, { childList: true, subtree: true });
}
// lasciando la pagina, il pulsante nella barra in alto se ne va con lei
window.addEventListener('hashchange', () => {
  document.querySelectorAll('.topbar .mn-help').forEach(b => { if (location.hash.split('?')[0] !== b.dataset.hash) b.remove(); });
});
