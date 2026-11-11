// Alma Planet · Persone: chi c'è in Almacis e chi fa cosa. Vista «Colleghi» (ricorrenze della settimana, ricerca,
// schede) e vista «Organigramma» (l'albero di Microsoft e il PDF). Prima erano Organigramma e i riquadri della Home.
import { h, fill, avatar, loading, debounce } from './ui.js';
import { get } from './api.js';
import { userById } from './store.js';
import { icon } from './icons.js';
import { orgView } from './org.js';
import { orgChartBox } from './welcome.js';
import { openChatWithEmails } from './teams.js';
import { openGrazieLoading } from './grazie.js';

const lc = s => String(s || '').toLowerCase();
const inDays = d => (d === 0 ? 'oggi' : d === 1 ? 'domani' : `fra ${d} giorni`);
const itDate = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

export async function personeView(container, params) {
  const vista = ['organigramma', 'reparti'].includes(params.get('vista')) ? params.get('vista') : 'colleghi';
  const body = h('div.ps-body');
  const seg = h('div.seg', { role: 'tablist', 'aria-label': 'Vista' }, [['colleghi', 'Colleghi'], ['organigramma', 'Organigramma'], ['reparti', 'Per reparto']].map(([k, l]) =>
    h('a', { href: k === 'colleghi' ? '#/persone' : `#/persone?vista=${k}`, role: 'tab', 'aria-selected': String(k === vista), class: k === vista ? 'on' : '' }, l)));
  fill(container, h('div.page-head', h('div', h('h1', 'Persone'), h('div.sub', 'Chi c\'è in Almacis, chi fa cosa, e le ricorrenze della settimana.')), seg), body);
  if (vista === 'organigramma') {
    const tree = h('div');
    const pdf = h('div.ps-pdf');
    fill(body, pdf, tree);
    get('/api/welcome/home', { quiet: true }).then(home => { if (home) fill(pdf, orgChartBox(home, () => personeView(container, params))); }).catch(() => {});
    return orgView(tree, params);
  }

  fill(body, loading());
  const [org, home] = await Promise.all([get('/api/org'), get('/api/welcome/home', { quiet: true }).catch(() => null)]);
  const ppl = home?.people || { arrivals: [], birthdays: [], anniversaries: [] };
  const first = (list, note) => (list.length ? [h('strong', list[0].name), h('small', note(list[0]) + (list.length > 1 ? ` · e altri ${list.length - 1}` : ''))] : [h('small.muted', 'Nessuno questa settimana')]);
  const week = h('section.ps-week',
    h('div.card.ps-tile', h('span.ps-lab', icon('sprout', { size: 16 }), 'Nuovi arrivi'), first(ppl.arrivals, p => `arrivato il ${itDate(p.hired_on)}`)),
    h('div.card.ps-tile', h('span.ps-lab', icon('cake', { size: 16 }), 'Compleanni'), first(ppl.birthdays, p => inDays(p.in_days))),
    h('div.card.ps-tile', h('span.ps-lab', icon('star', { size: 16 }), 'Anniversari'), first(ppl.anniversaries, p => `${p.years} anni in azienda, ${inDays(p.in_days)}`)),
    h('div.card.ps-tile.ps-grazie', h('span.ps-lab', icon('heart', { size: 16 }), 'Grazie a…'),
      h('strong', `${(home?.grazie || []).length} ringraziamenti`),
      h('button.btn.btn-sm.ps-thank', { type: 'button', on: { click: () => openGrazieLoading(() => personeView(container, params)) } }, 'Ringrazia un collega')));

  const depts = [...new Set(org.people.map(p => p.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  let q = '', dept = '';
  const grid = h('div.ps-grid');
  const count = h('span.small.muted');
  const tools = h('div.ps-tools',
    h('input.input', { type: 'search', placeholder: 'Cerca per nome, ruolo o reparto', 'aria-label': 'Cerca un collega', on: { input: debounce(e => { q = lc(e.target.value.trim()); draw(); }, 150) } }),
    h('select.select', { 'aria-label': 'Reparto', on: { change: e => { dept = e.target.value; draw(); } } },
      h('option', { value: '' }, 'Tutti i reparti'), depts.map(d => h('option', { value: d }, d))),
    count);
  fill(body, vista === 'reparti' ? null : week, tools, grid);
  draw();

  function card(p) {
    const u = p.user_id ? userById(p.user_id) : null;
    return h('article.card.ps-card',
      avatar(u || { name: p.name }, 64),
      h('strong', p.name),
      h('span.small.muted', [p.job_title, p.department].filter(Boolean).join(' · ') || ' '),
      h('div.row',
        p.email ? h('button.btn.btn-sm', { type: 'button', on: { click: () => openChatWithEmails([p.email]) } }, 'Chat') : null,
        u ? h('a.btn.btn-sm', { href: `#/u/${u.id}` }, 'Profilo') : null));
  }

  function draw() {
    const rows = org.people.filter(p => (!dept || p.department === dept) && (!q || lc(`${p.name} ${p.job_title} ${p.department} ${p.email}`).includes(q)));
    count.textContent = `${rows.length} ${rows.length === 1 ? 'persona' : 'persone'}`;
    // «Per reparto»: un gruppo per reparto, con quante persone ha
    if (vista === 'reparti') {
      const groups = new Map();
      for (const p of rows) {
        const k = p.department || 'Senza reparto';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(p);
      }
      const names = [...groups.keys()].sort((a, b) => (a === 'Senza reparto') - (b === 'Senza reparto') || a.localeCompare(b, 'it'));
      grid.className = 'ps-groups';
      return fill(grid, names.length ? names.map(n => h('section.ps-group',
        h('h2', n, h('span.small.muted', ` · ${groups.get(n).length}`)),
        h('div.ps-grid', groups.get(n).map(card)))) : h('div.card.empty', 'Nessuno trovato.'));
    }
    grid.className = 'ps-grid';
    fill(grid, rows.slice(0, 240).map(p => {
      const u = p.user_id ? userById(p.user_id) : null;
      return h('article.card.ps-card',
        avatar(u || { name: p.name }, 64),
        h('strong', p.name),
        h('span.small.muted', [p.job_title, p.department].filter(Boolean).join(' · ') || ' '),
        h('div.row',
          p.email ? h('button.btn.btn-sm', { type: 'button', on: { click: () => openChatWithEmails([p.email]) } }, 'Chat') : null,
          u ? h('a.btn.btn-sm', { href: `#/u/${u.id}` }, 'Profilo') : null));
    }), rows.length > 240 ? h('p.muted.small', 'Ne mostro 240: affina la ricerca per vedere gli altri.') : null,
    rows.length ? null : h('div.card.empty', 'Nessuno trovato.'));
  }
}
