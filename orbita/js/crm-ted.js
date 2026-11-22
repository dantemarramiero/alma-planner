// Gare europee da TED (ALM2-49, canvas CRM v14 · V14-TED, via di Dante 22/11/2026).
//   tedSection(ctx) → la sezione «Gare europee» del Mercato: fascia scura con tre numeri, vista Bandi aperti / Esiti,
//                     zona dell'iniziativa o tutta Italia, tabella con «Porta avanti» (bandi) e azioni sul vincitore (esiti)
import { h, fill, toast, loading, fmtDate } from './ui.js';
import { get, post } from './api.js';
import { icon } from './icons.js';

const ic = (n, s = 16) => icon(n, { size: s });
const num = n => Number(n || 0).toLocaleString('it-IT');
const nice = s => String(s || '').toLowerCase().replace(/(^|[\s'.(-])([a-zà-ù])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Srl|Spa|Snc|Sas|Scarl|Scrl)\b/g, x => x[0] + x.slice(1));
const money = n => (!n ? '—' : n >= 1e6 ? `${(n / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })} M€` : `${Math.round(n / 1000).toLocaleString('it-IT')} mila €`);
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const daysTo = d => Math.round((new Date(`${d}T12:00:00`) - Date.now()) / 864e5);
const ROLE = { partner: ['partner', 'gr'], fornitore: ['fornitore', 'gr'], cliente: ['cliente', 'gr'], lead: ['lead', 'bl'], concorrente: ['concorrente', 'or'] };
const roleOf = s => ['partner', 'fornitore', 'concorrente', 'cliente', 'lead'].find(r => s.roles?.includes(r)) || '';

function due(d) {
  const dt = new Date(`${d}T12:00:00`);
  return h('span.te-due', { class: daysTo(d) > 21 ? 'far' : '', title: `Scadenza ${fmtDate(d, { year: true })}` }, h('b', String(dt.getDate())), h('span', MONTHS[dt.getMonth()]));
}
function offers(n) {
  if (!n) return h('span.te-muted', '—');
  return h('div.te-off', { role: 'img', 'aria-label': `${n} offerte ricevute` }, h('i', Array.from({ length: 6 }, (_, k) => h('u', { class: k < Math.min(n, 6) ? '' : 'e' }))), h('b', String(n)));
}
const cpvChips = r => r.cpv.map(c => h('span.te-cpv', c.label ? `${c.code} · ${c.label}` : c.code));
const place = r => [nice(r.city), r.regions.join(', '), r.nuts[0] ? `NUTS ${r.nuts[0]}` : ''].filter(Boolean).join(' · ');

export function tedSection({ id, cats, canEdit = false, openCompany }) {
  const el = h('section.te', loading());
  const f = { view: 'bandi', zone: null, limit: 10 };
  async function load() {
    const qs = new URLSearchParams({ vista: f.view, limit: f.limit, ...(f.zone === null ? {} : { zona: f.zone ? '1' : '0' }), ...(cats ? { cats: cats.join(',') } : {}) });
    let d;
    try { d = await get(`/api/crm/business/${id}/mercato/ted?${qs}`, { quiet: true }); } catch (err) { fill(el, h('p.nb-small.muted', err.message)); return; }
    draw(d);
  }
  const setF = patch => { Object.assign(f, patch); load(); };

  async function forward(r, d) { // «Porta avanti»: il bando diventa un segnale del radar e si apre la sala di lancio
    if (r.signal_id) { location.hash = `#/crm/lancio/s/${r.signal_id}`; return; }
    const s = await post('/api/crm/radar/signals', { kind: 'gara', title: r.title.slice(0, 500), entity: r.buyer, amount: r.value ? Math.round(r.value) : null,
      url: r.url, deadline: r.deadline, region: r.regions[0] || '', soa: d.categories, summary: `Bando europeo TED ${r.pub}${r.lots > 1 ? ` · ${r.lots} lotti` : ''}. Luogo: ${place(r)}.` });
    if (!s?.id) { toast('Questo bando era già nel radar'); return; }
    await post(`/api/crm/ted/${encodeURIComponent(r.pub)}/segnale`, { signal_id: s.id });
    location.hash = `#/crm/lancio/s/${s.id}`;
  }

  function draw(d) {
    if (!d.source.updated_at) {
      return fill(el, h('div.te-empty', h('span.te-empty-i', ic('globe', 22)), h('div',
        h('b', d.source.running ? 'Sto caricando le gare europee da TED' : 'Le gare europee arrivano presto'),
        h('p', d.source.running ? 'Ci vogliono pochi minuti: la sezione si riempie da sola.' : 'Le carico da TED ogni notte; la prima volta pochi minuti dopo la pubblicazione.')),
        d.admin && !d.source.running ? h('button.nb-btn', { type: 'button', on: { click: async () => { await post('/api/crm/ted/aggiorna', {}); toast('Caricamento partito: ci vogliono pochi minuti'); setTimeout(load, 5000); } } }, 'Carica adesso') : null));
    }
    if (!d.codes.length) {
      return fill(el, h('div.te-empty', h('span.te-empty-i', ic('globe', 22)), h('div', h('b', 'Gare europee: nessun codice CPV per queste categorie'),
        h('p', `TED non usa le categorie SOA. Per ${d.missing.join(', ') || 'queste categorie'} aggiungi i codici CPV in Impostazioni del CRM → Concorrenza.`))));
    }
    const k = d.kpi;
    const view = v => setF({ view: v, limit: 10 });
    const bigN = (n, label, v, hot = false) => h('button.te-n', { type: 'button', class: [hot ? 'hot' : '', f.view === v ? 'sel' : ''].join(' '), 'aria-pressed': String(f.view === v), on: { click: () => view(v) } }, h('b', n), h('span', label));
    const where = d.zone ? d.regions.join(' · ') : 'tutta Italia';
    const head = h('div.te-h',
      h('div.te-ttl', h('div.te-eb', ic('globe', 14), 'TED · Gazzetta europea degli appalti'),
        h('h3', 'Gare ', h('b', 'europee'), ' nei nostri lavori'),
        h('p', `Le gare grandi, sopra soglia UE, con ${d.categories.join(' e ')} tradotte in codici CPV. In ${where}: bandi ancora aperti ed esiti con le offerte ricevute.`)),
      h('div.te-k',
        bigN(num(k.open), ['bandi aperti', h('br'), 'si può ancora partecipare'], 'bandi', true),
        bigN(num(k.awards), ['esiti in 24 mesi', h('br'), k.awards_median ? `valore tipico ${money(k.awards_median)}` : 'aggiudicati'], 'esiti'),
        h('div.te-n.static', h('b', k.avg_offers === null ? '—' : k.avg_offers.toLocaleString('it-IT')), h('span', ['offerte in media', h('br'), 'per gara']))));
    const seg = (items) => h('div.te-seg', { role: 'group' }, items.map(([label, on, click, badge]) => h('button', { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), on: { click } }, label, badge !== undefined ? h('em', num(badge)) : null)));
    const bar = h('div.te-bar',
      seg([['Bandi aperti', f.view === 'bandi', () => view('bandi'), k.open], ['Esiti', f.view === 'esiti', () => view('esiti'), k.awards]]),
      d.regions.length ? seg([[d.regions.join(' · '), d.zone, () => setF({ zone: true })], ['Tutta Italia', !d.zone, () => setF({ zone: false })]]) : null,
      h('span.te-src', h('span.te-dot'), `TED · aggiornata il ${fmtDate(d.source.updated_at.slice(0, 10))} · ${num(d.codes.length)} codici CPV`));

    let table;
    if (!d.rows.length) {
      table = h('p.te-none', f.view === 'bandi' ? `Nessun bando europeo aperto in ${where} per questi codici.${d.zone ? ' Prova «Tutta Italia».' : ''}` : `Nessun esito europeo in ${where} negli ultimi 24 mesi.`);
    } else if (f.view === 'bandi') {
      table = h('div.te-wrap', h('table.te-t.no-cards', h('thead', h('tr', h('th', { style: { width: '84px' } }, 'Scade'), h('th', 'Gara'), h('th', { style: { width: '240px' } }, 'Ente e luogo del cantiere'), h('th', { style: { width: '140px' } }, 'Valore stimato'), h('th', { style: { width: '220px' } }, ''))),
        h('tbody', d.rows.map(r => h('tr',
          h('td', { 'data-l': 'Scade' }, due(r.deadline)),
          h('td', h('b.te-title', { title: r.title }, r.title), h('div', cpvChips(r))),
          h('td', { 'data-l': 'Ente' }, h('b', nice(r.buyer)), h('small', place(r))),
          h('td', { 'data-l': 'Valore' }, h('b', money(r.value)), h('small', r.lots > 1 ? `${r.lots} lotti` : 'lotto unico')),
          h('td.te-act',
            canEdit ? h('button.nb-btn.pri', { type: 'button', on: { click: () => forward(r, d).catch(err => toast(err.message)) } }, ic('rocket', 14), r.signal_id ? 'Apri' : 'Porta avanti') : null,
            h('a.nb-btn', { href: r.url, target: '_blank', rel: 'noopener' }, 'Apri su TED')))))));
    } else {
      table = h('div.te-wrap', h('table.te-t.no-cards', h('thead', h('tr', h('th', { style: { width: '112px' } }, 'Aggiudicata'), h('th', 'Gara'), h('th', { style: { width: '270px' } }, 'Vincitore'), h('th', { style: { width: '150px' } }, 'Offerte ricevute'), h('th', { style: { width: '120px' } }, 'Valore'), h('th', { style: { width: '150px' } }, ''))),
        h('tbody', d.rows.map(r => {
          const w = r.winners[0];
          const role = w?.subject ? roleOf(w.subject) : '';
          return h('tr',
            h('td', { 'data-l': 'Aggiudicata' }, h('b', fmtDate(r.published_on, { year: true }))),
            h('td', h('b.te-title', { title: r.title }, r.title), h('small', [nice(r.buyer), r.regions.join(', ')].filter(Boolean).join(' · '))),
            h('td', { 'data-l': 'Vincitore' }, w ? [h('b', nice(r.winners.map(x => x.name).join(' – '))), h('small', w.cf ? `${w.cf} · ` : r.winners.length > 1 || r.winners[0].cfs ? 'in raggruppamento · ' : '',
              w.subject ? h('span.te-pill', { class: ROLE[role]?.[1] || 'gr' }, ROLE[role]?.[0] || 'nel CRM') : h('span.te-pill.bl', 'non nel CRM'))] : h('span.te-muted', 'non indicato')),
            h('td', { 'data-l': 'Offerte' }, offers(r.offers)),
            h('td', { 'data-l': 'Valore' }, h('b', money(r.value))),
            h('td.te-act', w && w.cf ? h('button.nb-btn', { type: 'button', on: { click: () => openCompany?.({ cf: w.cf, name: w.name }) } }, 'Scheda impresa')
              : h('a.nb-btn', { href: r.url, target: '_blank', rel: 'noopener' }, 'Apri su TED')));
        }))));
    }
    const more = d.shown > d.rows.length ? h('button.te-more', { type: 'button', on: { click: () => setF({ limit: 100 }) } }, `Mostro i primi ${d.rows.length} ${f.view === 'bandi' ? 'per scadenza' : 'più recenti'} · `, h('b', `Vedi tutti i ${num(d.shown)}`)) : null;
    fill(el, h('div.te-card', head, bar, table, more));
  }
  load();
  return el;
}
