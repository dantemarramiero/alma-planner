// Attestazioni SOA (ALM2-49, canvas CRM v13 · V13-SOA, via di Dante 21/11/2026).
//   qualifiedSection(ctx) → la sezione «Chi è qualificato in zona» del Mercato: fascia scura con tre numeri e il grafico
//                           per classifica, filtri a pillola, una scheda per impresa con la classifica a gradini
//   soaBox(cf, cats)      → il riquadro «Attestazione SOA» della scheda impresa
//   openSoaPanel(c, cats) → scheda di un'impresa che non ha ancora vinto gare qui (solo attestazione)
import { h, fill, toast, loading, modal, fmtDate } from './ui.js';
import { get, post } from './api.js';
import { icon } from './icons.js';

const ic = (n, s = 16) => icon(n, { size: s });
const num = n => Number(n || 0).toLocaleString('it-IT');
const nice = s => String(s || '').toLowerCase().replace(/(^|[\s'.(-])([a-zà-ù])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Srl|Spa|Snc|Sas|Scarl|Scrl)\b/g, x => x[0] + x.slice(1));
const day = d => (d ? fmtDate(String(d).slice(0, 10), { year: true }) : '—');
const money = n => (n === null || n === undefined ? 'oltre 15,5 M€' : n >= 1e6 ? `${(n / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 2 })} M€` : `${Math.round(n / 1000).toLocaleString('it-IT')} mila €`);
const CLASSES = ['I', 'II', 'III', 'III-BIS', 'IV', 'IV-BIS', 'V', 'VI', 'VII', 'VIII'];
const clsLabel = c => String(c || '').replace('-BIS', '-bis');
const short = c => String(c || '').replace('-BIS', '-b');
const ROLE = { partner: ['partner', 'gr'], fornitore: ['fornitore', 'gr'], cliente: ['cliente', 'gr'], lead: ['lead', 'bl'], concorrente: ['concorrente', 'gy'] };
const roleOf = s => (!s ? '' : ['partner', 'fornitore', 'concorrente', 'cliente', 'lead'].find(r => s.roles?.includes(r)) || 'altro');
const soonExpiring = d => d && (new Date(`${d}T12:00:00`) - Date.now()) / 864e5 < 90;
const initial = s => (nice(s).replace(/^(Impresa|Ditta|Società|Soc\.?)\s+/i, '').trim()[0] || '?').toUpperCase();
const AV = ['', 'b', 'c', 'd'];

function steps(cls) {
  const n = cls ? CLASSES.indexOf(cls) + 1 : 0;
  return h('span.qz-steps', { 'aria-hidden': 'true' }, CLASSES.map((_, k) => h('i', { class: k < n ? 'f' : '' })));
}
function classRow(x) {
  return h('div.qz-cls', { class: x.cls ? '' : 'dim', role: 'img', 'aria-label': x.cls ? `${x.cat} classifica ${clsLabel(x.cls)}` : `${x.cat} non qualificata` },
    h('span.qz-cat', x.cat), steps(x.cls), h('b', x.cls ? clsLabel(x.cls) : '—'), h('small', x.cls ? `gare da sola fino a ${money(x.max)}` : 'non qualificata'));
}

// ── sezione del Mercato ──────────────────────────────────────────────────────
export function qualifiedSection({ id, months, cats, regions = [], openCompany, onChange }) {
  const el = h('section.qz', loading());
  const f = { filter: 'tutte', province: '', limit: 8 };
  async function load() {
    const qs = new URLSearchParams({ months, filter: f.filter, limit: f.limit, ...(f.province ? { province: f.province } : {}), ...(cats ? { cats: cats.join(',') } : {}) });
    let d;
    try { d = await get(`/api/crm/business/${id}/mercato/qualificate?${qs}`, { quiet: true }); } catch (err) { fill(el, h('p.nb-small.muted', err.message)); return; }
    draw(d);
  }
  const setF = patch => { Object.assign(f, patch); load(); };
  function draw(d) {
    if (!d.source.updated_at) {
      return fill(el, h('div.qz-empty', h('span.qz-empty-i', ic('badge-check', 22)), h('div',
        h('b', d.source.running ? 'Sto caricando le attestazioni SOA da ANAC' : 'Le attestazioni SOA arrivano presto'),
        h('p', d.source.running ? 'Ci vogliono pochi minuti: la sezione si riempie da sola.' : 'Le carico da ANAC una volta a settimana; la prima volta pochi minuti dopo la pubblicazione.')),
        d.admin && !d.source.running ? h('button.nb-btn', { type: 'button', on: { click: async () => { await post('/api/crm/soa/aggiorna', {}); toast('Caricamento partito: ci vogliono pochi minuti'); setTimeout(load, 4000); } } }, 'Carica adesso') : null));
    }
    const k = d.kpi;
    const maxN = Math.max(1, ...d.ladder.map(x => x.n));
    const bigN = (n, label, filter, hot = false) => h('button.qz-n', { type: 'button', class: [hot ? 'hot' : '', f.filter === filter ? 'sel' : ''].join(' '), 'aria-pressed': String(f.filter === filter),
      on: { click: () => setF({ filter: f.filter === filter ? 'tutte' : filter }) } }, h('span.qz-num', num(n)), h('span.qz-l', label));
    const hero = h('div.qz-hero',
      h('div.qz-ttl', h('div.qz-eb', `Attestazioni SOA valide · ${d.ladder.length ? (cats || []).join(' e ') || '' : ''}`.replace(/ · $/, '')),
        h('h3', 'Chi è ', h('b', 'qualificato in zona')),
        h('p', `${regions.length ? regions.join(' · ') : 'Tutta Italia'}. Chi può fare le nostre gare, anche se non ne ha ancora vinta una.`)),
      h('div.qz-big', bigN(k.total, 'imprese qualificate', 'tutte'), bigN(k.never, ['mai vinto qui', h('br'), 'partner o rivali in arrivo'], 'mai', true), bigN(k.in_crm, 'già nel nostro CRM', 'crm')),
      h('div.qz-ladder', h('div.qz-lt', `Quante imprese per classifica · ${d.category}`),
        h('div.qz-cols', d.ladder.map(x => h('span', { title: `${x.n} imprese con classifica ${clsLabel(x.cls)}`, class: x.n === maxN ? 'on' : '' },
          h('i', { style: { height: `${Math.max(4, Math.round((x.n / maxN) * 100))}%` } }), h('b', short(x.cls))))),
        h('div.qz-lf', 'La classifica dice fino a che importo l\'impresa può fare una gara da sola.')));
    const seg = h('div.qz-seg', { role: 'group', 'aria-label': 'Filtro' }, [['tutte', 'Tutte'], ['mai', 'Mai vinto qui'], ['classe', 'Classifica ≥ III'], ['crm', 'Già nel CRM']]
      .map(([key, label]) => h('button', { type: 'button', class: f.filter === key ? 'on' : '', 'aria-pressed': String(f.filter === key), on: { click: () => setF({ filter: key }) } }, label)));
    const prov = d.provinces.length ? h('label.qz-prov', h('select', { 'aria-label': 'Provincia', on: { change: e => setF({ province: e.target.value }) } },
      h('option', { value: '' }, 'Provincia: tutte'), d.provinces.map(p => h('option', { value: p, selected: p === f.province }, p))), ic('chevron-down', 13)) : null;
    const src = h('span.qz-src', h('span.qz-dot'), `ANAC · Attestazioni SOA · aggiornata il ${day(d.source.updated_at)}`);
    const card = (c, n) => {
      const role = roleOf(c.subject);
      const hot = !c.won;
      const act = c.subject ? h('button.nb-btn', { type: 'button', on: { click: () => { location.hash = `#/crm/scheda/${c.subject.id}`; } } }, 'Apri nel CRM')
        : hot ? h('button.nb-btn.pri', { type: 'button', on: { click: async () => { await post(`/api/crm/business/${id}/tasks`, { title: `Proporre un'ATI a ${nice(c.name)}` }); toast('Passo creato nel piano dell\'iniziativa'); onChange?.(); } } }, 'Proponi ATI')
          : h('button.nb-btn', { type: 'button', on: { click: async () => { const r = await post('/api/crm/concorrenza/scheda', { name: nice(c.name), cf: c.cf, role: 'concorrente' }); toast(r.created ? 'Aggiunta al CRM come concorrente' : 'Era già nel CRM: segnata come concorrente'); load(); } } }, 'Concorrente');
      return h('article.qz-card', { class: hot ? 'hot' : '' },
        h('header', h('span.qz-av', { class: AV[n % 4], 'aria-hidden': 'true' }, initial(c.name)),
          h('button.qz-who', { type: 'button', title: 'Apri la scheda dell\'impresa', on: { click: () => openCompany(c) } }, h('b', nice(c.name)),
            h('small', { class: soonExpiring(c.expires_on) ? 'warn' : '' }, [c.province, c.expires_on ? `scade ${day(c.expires_on)}` : ''].filter(Boolean).join(' · '))),
          role ? h('span.nb-pill', { class: (ROLE[role] || ['', 'gy'])[1] }, (ROLE[role] || [role])[0]) : h('span.nb-pill.line', 'non nel CRM')),
        c.classes.map(classRow),
        h('footer', hot ? h('span.qz-new', 'Mai vinto qui') : h('span.qz-won', h('b', num(c.won)), c.won === 1 ? ' gara vinta qui' : ' gare vinte qui'), act));
    };
    fill(el, hero, h('div.qz-bar', seg, prov, src),
      d.companies.length ? h('div.qz-grid', d.companies.map(card)) : h('div.qz-none', 'Nessuna impresa con questi filtri.'),
      d.shown > d.companies.length ? h('button.qz-more', { type: 'button', on: { click: () => setF({ limit: f.limit + 24 }) } }, `Mostro ${num(d.companies.length)} di ${num(d.shown)} · `, h('b', 'Mostra altre')) : null);
  }
  load();
  return el;
}

// ── riquadro nella scheda impresa ────────────────────────────────────────────
export function soaBox(cf, cats = []) {
  const el = h('div.qz-soa', loading());
  get(`/api/crm/soa/impresa?cf=${encodeURIComponent(cf)}&cats=${encodeURIComponent(cats.join(','))}`, { quiet: true }).then(({ soa, source }) => {
    if (!soa) {
      return fill(el, h('div.qz-soa-h', h('b', 'Attestazione SOA'), h('span.nb-pill.line', source.updated_at ? 'nessuna valida' : 'dati in arrivo')),
        h('small', source.updated_at ? 'Negli open data ANAC non c\'è un\'attestazione SOA valida per questo codice fiscale.' : 'Le attestazioni SOA si caricano da ANAC una volta a settimana.'));
    }
    const ours = soa.cats.find(x => x.ours);
    fill(el,
      h('div.qz-soa-h', h('b', 'Attestazione SOA'), h('span.nb-pill', { class: soonExpiring(soa.expires_on) ? 'warn' : 'ok' }, soa.expires_on ? `valida fino al ${day(soa.expires_on)}` : 'valida')),
      h('small', [soa.soa_name ? `Rilasciata da ${nice(soa.soa_name)}` : '', soa.mid_check_on ? `verifica triennale il ${day(soa.mid_check_on)}` : ''].filter(Boolean).join(' · ')),
      h('div.qz-soa-cats', soa.cats.map(x => h('span.qz-chip', { class: x.ours ? 'hi' : '', title: `gare da sola fino a ${money(x.max)}` }, `${x.cat} · ${clsLabel(x.cls)}`))),
      h('small', ours ? `In arancio le categorie dell'iniziativa. Con ${ours.cat} ${clsLabel(ours.cls)} può fare da sola gare fino a ${money(ours.max)}.` : 'Nessuna delle categorie dell\'iniziativa.'));
  }).catch(err => fill(el, h('small', err.message)));
  return el;
}

// scheda di un'impresa qualificata che non ha gare vinte nel perimetro
export function openSoaPanel(c, cats = []) {
  const m = modal({
    drawer: true,
    title: h('div', h('div.en-eyebrow', 'Qualificata in zona · nessuna gara vinta qui'), h('h2', nice(c.name)), h('div.nb-small.muted', [c.province, c.cf ? `C.F. ${c.cf}` : ''].filter(Boolean).join(' · '))),
    body: h('div.nb-form.nb-mco', soaBox(c.cf, cats),
      h('div.nb-mhint', ic('lightbulb', 15), h('span', 'Non ha ancora vinto gare in queste categorie e zone: può essere un partner per un\'ATI o un concorrente in arrivo.'))),
    actions: [h('button.nb-btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi')],
  });
  m.box.classList.add('nb-dlg', 'nb-panel');
  return m;
}
