// Riquadro «Attestazione SOA» della scheda azienda (canvas CRM v14 · V14-SOA-CRM, via di Dante 22/11/2026).
// Le SOA arrivano da ANAC con la P.IVA (bollino «da ANAC»); quelle scritte a mano restano, segnate «a mano». Se le due
// si sovrappongono si vedono le differenze e si sceglie: Usa ANAC · Tieni anche le mie in più · Tieni le mie.
import { h, fill, toast, loading, confirmDialog } from './ui.js';
import { get, post } from './api.js';
import { ic, pill } from './crm-v2.js';

const RANK = ['I', 'II', 'III', 'III-bis', 'IV', 'IV-bis', 'V', 'VI', 'VII', 'VIII'];
const SOURCE = 'https://dati.anticorruzione.it/opendata/dataset/attestazioni-soa-v2';
const day = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('it-IT') : '');
const months = d => Math.round((Date.parse(d) - Date.now()) / (30.4 * 864e5));
const until = d => { const m = months(d); return m >= 2 ? `fra ${m} mesi` : `fra ${Math.max(0, Math.round((Date.parse(d) - Date.now()) / 864e5))} giorni`; };

// s = scheda con soa_effective, soa_anac, soa_state, soa_conflict, soa_wanted; meta = data.meta; onEdit = apre la modifica
export function soaCard(s, { meta, onEdit, refresh }) {
  const a = s.soa_anac;
  const st = s.soa_state;
  const list = s.soa_effective || [];
  const roles = s.roles || [];
  const relevant = ['fornitore', 'partner', 'concorrente'].some(r => roles.includes(r));
  if (!list.length && !a && !relevant) return null;
  const hasCf = Boolean(s.vat || s.tax_code);
  const catName = Object.fromEntries((meta.soaCategories || []).map(([k, n]) => [k, n]));
  const clsMax = Object.fromEntries((meta.soaClasses || []).map(([k, n]) => [k, n]));
  const wanted = s.soa_wanted || {};

  const badge = st === 'valida' ? h('span.soa-anac', ic('check', 11), 'da ANAC')
    : st === 'in_scadenza' ? pill(`scade ${until(a.expires_on)}`, 'or')
      : st === 'scaduta' ? pill(a.gone && !(a.expires_on && a.expires_on < new Date().toISOString().slice(0, 10)) ? 'non più su ANAC' : 'scaduta', 'rd') : null;
  const head = h('div.cv-row.soa-head', h('span.soa-ico', ic('scale', 16)), h('span.cv-t5.soa-title', 'Attestazione SOA'), badge, h('span.cv-grow'),
    a?.checked_at ? h('span.cv-small.cv-muted', `aggiornata ${day(a.checked_at)}`) : null,
    a?.found ? h('a.cv-small.soa-src', { href: SOURCE, target: '_blank', rel: 'noopener' }, ic('external', 13), 'Fonte ANAC') : null);

  const facts = a?.found ? h('div.soa-facts', [['Organismo', a.soa_name || '—'], ['Rilasciata', day(a.issued_on) || '—'],
    ['Scade', day(a.expires_on) || '—', a.expires_on ? (st === 'scaduta' ? 'scaduta' : until(a.expires_on)) : ''],
    ['Verifica triennale', day(a.mid_check_on) || '—', a.mid_check_on ? (a.mid_check_on < new Date().toISOString().slice(0, 10) ? 'fatta' : until(a.mid_check_on)) : '']]
    .map(([k, v, sub]) => h('div', h('span.soa-k', k), h('b', v), sub ? h('span.cv-small.cv-muted', sub) : null))) : null;

  const tile = x => h(`div.soa-tile${wanted[x.cat] ? '.want' : ''}${x.expired ? '.off' : ''}`, { title: wanted[x.cat] ? `Serve a: ${wanted[x.cat].join(', ')}` : undefined },
    h('div.cv-row', h('b.soa-cat', x.cat), h('span.cv-grow'), x.source === 'mano' ? h('span.soa-hand', 'a mano') : null, h('span.soa-cls', x.cls)),
    h('div.soa-steps', RANK.map((c, i) => h('span', { class: i <= RANK.indexOf(x.cls) ? 'on' : '' }))),
    h('span.cv-small.cv-muted', [catName[x.cat] ? catName[x.cat].split(',')[0].toLowerCase() : '', clsMax[x.cls] || ''].filter(Boolean).join(' · ')));
  const tiles = list.length ? h('div.soa-tiles', list.map(tile)) : null;

  const c = s.soa_conflict;
  const choose = async (choice, btn) => {
    btn.disabled = true;
    try { await post(`/api/crm/subjects/${s.id}/soa-scelta`, { choice }); toast(choice === 'mine' ? 'Tenute le tue SOA' : 'SOA aggiornate da ANAC'); refresh(); } catch { btn.disabled = false; }
  };
  const btn = (label, choice, pri) => { const b = h(`button.btn.btn-sm${pri ? '.btn-primary' : ''}`, { type: 'button', on: { click: () => choose(choice, b) } }, label); return b; };
  const txt = l => l.map(x => `${x.cat} ${x.cls}`).join(' · ');
  const conflict = c ? h('div.soa-diff',
    h('div.cv-row', { style: { gap: '8px' } }, h('span.soa-warn', ic('info', 15)), h('span.cv-t5.cv-small', `Scritte a mano prima: ${txt(c.mine)}`)),
    h('p.cv-small', [
      c.differ.length ? ['ANAC dice ', ...c.differ.flatMap((d, i) => [i ? ', ' : '', h('b', `${d.cat} ${d.anac}`), ` (a mano ${d.mine})`])] : 'ANAC conferma quelle in comune',
      c.only_anac.length ? ['; ha in più ', h('b', txt(c.only_anac))] : '',
      c.only_mine.length ? ['; ', h('b', txt(c.only_mine)), ' non c\'è su ANAC'] : '', '.']),
    h('div.cv-row', { style: { gap: '8px', flexWrap: 'wrap' } }, btn('Usa ANAC', 'anac', true),
      c.only_mine.length ? btn(`Tieni anche ${txt(c.only_mine)} a mano`, 'aggiungi') : null, btn('Tieni le mie', 'mine'))) : null;

  const note = !hasCf ? h('div.soa-empty', h('span.cv-small', 'Le SOA arrivano da ANAC con la ', h('b', 'P.IVA'), ': per nome no, ci sono troppi omonimi.'),
    h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: onEdit } }, ic('plus', 14), 'Aggiungi la P.IVA'))
    : a && !a.found ? h('div.cv-row.cv-small.cv-muted', { style: { gap: '8px' } }, h('span.soa-anac', 'ANAC'), `Nessuna attestazione valida · controllato il ${day(a.checked_at)}`)
      : !a ? h('p.cv-small.cv-muted', 'Le attestazioni ANAC non sono ancora caricate: le SOA arrivano da sole al primo caricamento.') : null;
  const wantNames = [...new Set(Object.values(wanted).flat())];
  const foot = wantNames.length ? h('div.cv-row.cv-small.cv-muted', { style: { gap: '8px' } }, ic('handshake', 14),
    `In arancio le categorie che servono alle iniziative aperte (${wantNames.slice(0, 3).join(', ')}${wantNames.length > 3 ? '…' : ''})`) : null;
  return h('section.cv-card.pad.soa-card', head, facts, tiles, conflict, note, foot);
}

// testo breve per la scheda Anagrafica e gli elenchi: le valide, le scadute escluse
export const soaShort = s => (s.soa_effective || []).filter(x => !x.expired).map(x => `${x.cat} ${x.cls}`).join(' · ');

// Impostazioni → SOA delle aziende: quante sono collegate ad ANAC e quelle con SOA a mano diverse da ANAC
export async function soaSettings(body) {
  fill(body, loading());
  const d = await get('/api/crm/soa/differenze');
  const num = n => Number(n || 0).toLocaleString('it-IT');
  const kpi = (v, l) => h('div.soa-kpi', h('b', num(v)), h('span.cv-small.cv-muted', l));
  const useAll = async btn => {
    if (!await confirmDialog(`Usare le SOA di ANAC per tutte le ${d.subjects.length} aziende? Le SOA scritte a mano in quelle aziende si tolgono.`, { ok: 'Usa ANAC per tutte' })) return;
    btn.disabled = true;
    await post('/api/crm/soa/usa-anac', { ids: d.subjects.map(x => x.id) });
    toast('SOA prese da ANAC');
    soaSettings(body);
  };
  const txt = l => l.map(x => `${x.cat} ${x.cls}`).join(' · ');
  fill(body, h('section.cv-card.pad', { style: { display: 'grid', gap: '14px' } },
    h('div', h('h2.cv-t5', { style: { margin: 0, fontSize: '16px' } }, 'SOA delle aziende da ANAC'),
      h('p.cv-small.cv-muted', { style: { margin: '4px 0 0' } }, 'Le attestazioni SOA di ANAC si collegano da sole alle aziende con la P.IVA o il codice fiscale: quando si salva la P.IVA e ogni lunedì con il ricaricamento. Le SOA scritte a mano non si toccano da sole.')),
    h('div.soa-kpis', kpi(d.with_vat, 'aziende con P.IVA'), kpi(d.found, 'trovate su ANAC'), kpi(d.subjects.length, 'diverse dal manuale')),
    d.subjects.length ? [
      h('div.cv-row', { style: { gap: '8px' } }, h('span.cv-t5.cv-grow', 'Diverse da quelle scritte a mano'),
        d.admin ? h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: e => useAll(e.currentTarget) } }, 'Usa ANAC per tutte') : null),
      h('div.soa-dlist', d.subjects.map(x => h('a.soa-drow', { href: `#/crm/scheda/${x.id}` }, h('b', x.name),
        h('span.cv-small.cv-muted', `a mano ${txt(x.conflict.mine)}`),
        h('span.cv-small', x.conflict.differ.length ? `ANAC ${x.conflict.differ.map(c => `${c.cat} ${c.anac}`).join(' · ')}` : 'ANAC conferma, con altre categorie'))))]
      : h('p.cv-small.cv-muted', 'Nessuna differenza da sistemare.')));
}
