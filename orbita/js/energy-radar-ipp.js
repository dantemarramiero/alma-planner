// Alma Energy · Radar da produttore indipendente (ALM2-93, tavole F, G e H del canvas «Alma Energy da capo» approvate da
// Dante il 25/11/2026). Un posto solo per i MW da costruire, rifare o comprare, in tre tab:
// - Da guardare: notizie, impianti del Database CE e aste, con «In pipeline» che chiede solo la pipeline;
// - Impianti: l'anagrafica degli impianti (in esercizio dal Database CE, tetti dello screening, autorizzati dalle notizie);
// - Pipeline: Revamping, FV classico e PPA on-site, il kanban di prima con un selettore.
import { h, fill, loading } from './ui.js';
import { get } from './api.js';
import { icon } from './icons.js';
import { num } from './energy.js';
import { radarView, addDialog, settingsDialog } from './energy-radar.js';
import { pipelineView, databaseView } from './energy-pipeline.js';
import { screeningView } from './energy-screening.js';

const PIPES = [['revamping', 'revamping', 'Revamping'], ['fv', 'fv_classico', 'FV classico'], ['ppa', 'ppa_onsite', 'PPA on-site']];
const PLANTS = [['ce', 'In esercizio · Database CE'], ['tetti', 'Tetti · screening'], ['autorizzati', 'Autorizzati']];
const mw = n => `${num(n, n >= 10 ? 0 : 1)} MW`;
const eurShort = n => (n >= 1e6 ? `${num(n / 1e6, 1)} M€` : n >= 1e3 ? `${num(n / 1e3, 0)} mila €` : `${num(n, 0)} €`);

export async function radarHub(container, parts = []) {
  const tab = ['impianti', 'pipeline'].includes(parts[2]) ? parts[2] : 'segnali';
  const sub = parts[3] || '';
  const kpi = h('section.en-rx-kpis', { 'aria-label': 'Numeri del radar' });
  const tabs = h('nav.seg.en-rx-tabs', { 'aria-label': 'Radar' });
  const subBar = h('div.seg.en-filter', { role: 'group' });
  const body = h('div', loading());
  fill(container,
    h('div.page-head.en-rx-head',
      h('div', h('div.en-eyebrow', 'CRM Energy'), h('h1', 'Radar ', h('b', 'energia')),
        h('p.muted.en-lead', 'Dove un produttore indipendente trova i MW da costruire, rifare o comprare: notizie, impianti del Database CE e tetti dello screening, fino alle tre pipeline.')),
      h('div.en-rx-actions',
        h('button.btn', { type: 'button', on: { click: () => settingsDialog(() => radarHub(container, parts)) } }, icon('settings', { size: 15 }), 'Fonti e giro automatico'),
        h('button.btn.btn-primary', { type: 'button', on: { click: () => addDialog(() => radarHub(container, parts)) } }, icon('plus', { size: 15 }), 'Segnala'))),
    kpi,
    h('div.en-rx-bar', tabs, subBar),
    body);

  const n = await get('/api/energy/radar/numeri');
  const p = n.pipeline;
  const totMw = p.revamping.mw + p.fv_classico.mw + p.ppa_onsite.mw;
  const totOpp = p.revamping.n + p.fv_classico.n + p.ppa_onsite.n;
  const d = n.da_guardare;
  fill(kpi,
    tile(String(n.da_guardare.total), 'da guardare', [d.web ? `${d.web} notizie` : null, d.database_ce ? `${d.database_ce} impianti CE` : null, d.impianti ? `${d.impianti} da Alma Impianti` : null, d.manuale ? `${d.manuale} a mano` : null].filter(Boolean).join(' · ') || 'nessun segnale nuovo', '#/energy/radar'),
    tile(mw(totMw), 'in pipeline', `Revamping ${num(p.revamping.mw, 0)} · FV ${num(p.fv_classico.mw, 0)} · PPA ${num(p.ppa_onsite.mw, 0)} MW`, '#/energy/radar/pipeline'),
    tile(eurShort(n.lost_a), 'incassi GSE persi l\'anno', 'negli impianti CE in priorità A', '#/energy/radar/impianti'),
    tile(String(n.scadenze), 'aste e scadenze', 'aste FER e segnali con scadenza entro 60 giorni', '#/energy/radar'));
  fill(tabs, [['segnali', 'Da guardare', d.total], ['impianti', 'Impianti', n.impianti], ['pipeline', 'Pipeline', totOpp]].map(([k, label, c]) =>
    h('a', { href: k === 'segnali' ? '#/energy/radar' : `#/energy/radar/${k}`, class: tab === k ? 'on' : '', 'aria-current': tab === k ? 'page' : null }, label, h('small', num(c, 0)))));

  if (tab === 'pipeline') {
    const pick = PIPES.find(([k]) => k === sub) || PIPES[0];
    fill(subBar, PIPES.map(([k, kind, label]) => h('a', { href: `#/energy/radar/pipeline/${k}`, class: pick[0] === k ? 'on' : '' },
      `${label} · ${p[kind].n} · ${mw(p[kind].mw)}`)));
    return pipelineView(body, pick[1]);
  }
  if (tab === 'impianti') {
    const pick = PLANTS.find(([k]) => k === sub) || PLANTS[0];
    fill(subBar, PLANTS.map(([k, label]) => h('a', { href: `#/energy/radar/impianti/${k}`, class: pick[0] === k ? 'on' : '' }, label)));
    if (pick[0] === 'tetti') return screeningView(body);
    if (pick[0] === 'autorizzati') return radarView(body, { kinds: 'autorizzazione', note: 'Progetti autorizzati trovati dal radar: chi li ha sviluppati entra nel CRM, l\'opportunità va in FV classico.' });
    return databaseView(body);
  }
  subBar.remove();
  return radarView(body, { pipes: true });
}

function tile(value, label, hint, href) {
  return h('a.card.en-rx-kpi', { href }, h('strong', value), h('b', label), h('span', hint));
}
