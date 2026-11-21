// Alma HR, Fase 2 (ALM2-52; canvas «Alma HR», pagina «Fase 2 · organigramma»). Regola di Dante: organigramma e persone
// sono solo da vedere, il data entry si fa su BOSS («Modifica su BOSS ↗»). Pagine:
//   #/hr/organigramma (tutti): albero, per area, matrice livello × area, scheda dell'incarico
//   #/hr/costo · #/hr/scenari[/:id] · #/hr/cambi · #/hr/strategia (solo team HR)
import { h, fill, toast, modal, confirmDialog, promptDialog, loading, fmtDateTime, debounce } from './ui.js';
import { get, post, patch } from './api.js';
import { icon } from './icons.js';
import { ambitoSelect, ambQs } from './hr.js';

const eur = n => (n == null ? '—' : `${Math.round(n).toLocaleString('it-IT')} €`);
const keur = n => (n == null ? '—' : `${Math.round(n / 1000).toLocaleString('it-IT')} k€`);
const k1 = n => Number(n).toLocaleString('it-IT', { maximumFractionDigits: 1 });
const days = iso => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86400000)) : null);
const head = (title, sub, right) => h('div.page-head', h('div', h('div.hr-eyebrow', 'Alma HR'), h('h1', title), sub ? h('div.sub', sub) : null), right || null);
const lockBar = txt => h('div.hr-lock', icon('lock', { size: 14 }), h('span', txt));
const howTo = (...t) => h('div.hr-howto', h('b', 'Come si legge'), ' · ', ...t);
const bossBtn = (url, label = 'Modifica su BOSS ↗') => (url ? h('a.btn.btn-sm', { href: url, target: '_blank', rel: 'noopener' }, label) : h('span.hr-chip', { title: 'Il link arriverà con la sincronizzazione da BOSS' }, 'si modifica su BOSS'));

// ── Organigramma ────────────────────────────────────────────────────────────────────────────────────────────
export async function organigrammaView(c, params) {
  const d = await get(`/api/hr/organigramma?${ambQs()}`);
  const amb = await ambitoSelect(() => organigrammaView(c, params));
  const vista = ['albero', 'area', 'matrice'].includes(params.get('vista')) ? params.get('vista') : 'albero';
  let area = params.get('area') || '';
  let mostra = params.get('mostra') || 'ruolo';
  let cerca = '';
  const byId = new Map(d.incarichi.map(i => [i.id, i]));
  const kids = new Map();
  for (const i of d.incarichi) { const p = i.riporta_a_id && byId.has(i.riporta_a_id) ? i.riporta_a_id : 0; (kids.get(p) || kids.set(p, []).get(p)).push(i); }
  const areaName = id => d.aree.find(a => a.id === id)?.nome || 'Senza area';
  const open = new Set(); // nodi aperti oltre ai primi due livelli
  const closed = new Set();
  const body = h('div');
  const statsBox = h('div');

  const nodeCard = i => {
    const vac = !i.persona;
    const match = cerca && (`${i.nome} ${i.persona?.nome || ''}`.toLowerCase().includes(cerca));
    return h('button.hr-node', { type: 'button', class: [vac ? 'vac' : '', match ? 'match' : ''].join(' '), on: { click: () => scheda(i) } },
      h('b', i.nome), h('div.small.muted', vac ? `vacante${i.vacante_dal ? ` da ${days(i.vacante_dal)} giorni` : ''}` : i.persona.nome),
      mostra === 'nomi' ? null : h('div.hr-node-chips',
        mostra === 'costo' && d.is_hr ? h('span.hr-chip', vac ? (i.vacante_rif ? `rif. ${keur(i.vacante_rif)}` : '—') : keur(i.costo))
          : i.role ? [h('span.hr-chip', i.role.title), h('span.hr-chip', vac && i.band ? `G${i.role.grade} · ${k1(i.band.min)}–${k1(i.band.max)} k€` : `G${i.role.grade}`)]
            : h('span.hr-chip.z-warn', i.da_confermare ? 'ruolo da confermare' : 'senza ruolo')));
  };
  const depthOpen = (i, depth) => !closed.has(i.id) && (depth < 1 || open.has(i.id));
  const tree = (list, depth) => h('ul.hr-tree', list.map(i => {
    const ch = kids.get(i.id) || [];
    const isOpen = depthOpen(i, depth);
    return h('li', nodeCard(i),
      ch.length ? h('button.hr-tree-toggle', { type: 'button', 'aria-label': isOpen ? 'Chiudi il ramo' : 'Apri il ramo', on: { click: () => { if (isOpen) { closed.add(i.id); open.delete(i.id); } else { open.add(i.id); closed.delete(i.id); } draw(); } } }, isOpen ? '−' : `+${ch.length}`) : null,
      ch.length && isOpen ? tree(ch, depth + 1) : null);
  }));
  // con una ricerca si aprono i rami che portano a ciò che si cerca
  const openPathsTo = q => {
    for (const i of d.incarichi) {
      if (!`${i.nome} ${i.persona?.nome || ''}`.toLowerCase().includes(q)) continue;
      let cur = i.riporta_a_id; const seen = new Set();
      while (cur && byId.has(cur) && !seen.has(cur)) { seen.add(cur); open.add(cur); closed.delete(cur); cur = byId.get(cur).riporta_a_id; }
    }
  };
  const roots = () => {
    if (!area) return kids.get(0) || [];
    const inArea = d.incarichi.filter(i => String(i.area_id ?? 'none') === area);
    return inArea.filter(i => !i.riporta_a_id || String(byId.get(i.riporta_a_id)?.area_id ?? 'none') !== area);
  };

  function draw() {
    if (vista === 'albero') {
      const r = roots();
      fill(body, h('div.card.hr-pad', r.length ? h('div.hr-tree-wrap', tree(r, 0)) : h('div.empty', d.incarichi.length ? 'Nessun incarico in quest\'area' : 'L\'organigramma è vuoto: arriverà da BOSS (oggi con l\'import in Impostazioni › Organigramma).'),
        howTo('Ogni riquadro è un incarico; sotto chi lo ricopre. Tratteggio arancio = incarico ', h('b', 'vacante'), ', con la fascia del suo ruolo. Il «+» apre un ramo. Clic su un riquadro: la scheda. Per cambiare qualcosa: «Modifica su BOSS ↗».')));
    } else if (vista === 'area') {
      fill(body, h('div.card.hr-scroll', h('table.list.hr-nohover', h('thead', h('tr', ['Area', 'Responsabile', 'Persone', 'Vacanti', 'Senza ruolo', 'Span medio', 'Grade medio', 'Donne', d.is_hr ? 'Monte RAL' : null].filter(Boolean).map(x => h('th', x)))),
        h('tbody', d.aree_stats.map(a => h('tr', h('td', h('a', { href: `#/hr/organigramma?area=${a.area_id ?? 'none'}` }, h('b', a.nome))), h('td', a.responsabile || '—'), h('td', a.persone),
          h('td', a.vacanti ? h('span.hr-chip.z-warn', a.vacanti) : '0'), h('td', a.senza_ruolo || '0'), h('td', a.span > 8 || (a.span && a.span < 2) ? h('span.hr-chip.z-warn', `${k1(a.span)} !`) : k1(a.span)),
          h('td', a.grade_medio ? `G${k1(a.grade_medio)}` : '—'), h('td', a.donne_pct == null ? '—' : `${a.donne_pct}%`), d.is_hr ? h('td', keur(a.monte)) : null))))),
        h('p.small.muted', 'Span medio = persone che riportano direttamente ÷ capi dell\'area; «!» sopra 8 o sotto 2.'));
    } else {
      const lv = [...d.livelli.filter(l => l.attivo), { id: null, nome: 'Senza livello' }];
      const ar = d.aree_stats;
      const cell = (l, a) => d.incarichi.filter(i => (i.livello_id ?? null) === l.id && (i.area_id ?? null) === a.area_id);
      const max = Math.max(1, ...lv.flatMap(l => ar.map(a => cell(l, a).length)));
      fill(body, h('div.card.hr-pad.hr-scroll', h('div.hr-matrix', { style: { gridTemplateColumns: `150px repeat(${ar.length}, minmax(96px, 1fr))` } },
        h('span'), ar.map(a => h('b.small', a.nome)),
        lv.flatMap(l => [h('b.small', l.nome), ...ar.map(a => {
          const list = cell(l, a); const vac = list.filter(i => !i.persona).length;
          return list.length ? h('button.hr-mcell', { type: 'button', style: { '--alpha': String(0.15 + 0.7 * list.length / max) }, on: { click: () => listModal(`${l.nome} · ${a.nome}`, list) } }, String(list.length), vac ? h('small', ` · ${vac} vac.`) : null) : h('span.hr-mcell.hr-mnone', '—');
        })])),
        h('p.small.muted', 'Colore più scuro = più incarichi. Clic su una casella: gli incarichi di quel livello in quell\'area.')));
    }
  }
  const listModal = (title, list) => modal({ title, body: h('div', list.map(i => h('div.hr-li', h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => scheda(i) } }, i.nome), h('span.small.muted', i.persona?.nome || 'vacante')))) });

  function scheda(i) {
    const up = i.riporta_a_id ? byId.get(i.riporta_a_id) : null;
    const ch = kids.get(i.id) || [];
    modal({
      title: h('div', h('h2', i.nome), h('div.small.muted', [areaName(i.area_id), d.livelli.find(l => l.id === i.livello_id)?.nome, up ? `riporta a ${up.nome}` : 'vertice'].filter(Boolean).join(' · '), ' ⟳')),
      drawer: true,
      body: h('div.hr-form',
        h('div.card.hr-pad', i.persona ? h('div.hr-row.hr-between', h('div', h('b', i.persona.nome), h('div.small.muted', 'da BOSS ⟳')),
          d.is_hr && i.persona.key ? h('a.btn.btn-sm', { href: `#/hr/persona/${encodeURIComponent(i.persona.key)}` }, 'Scheda persona') : null)
          : h('div', h('b', 'Vacante'), h('div.small.muted', i.vacante_dal ? `da ${days(i.vacante_dal)} giorni` : ''), h('div.small.muted', 'In Fase 3: «Apri richiesta di personale», già compilata con ruolo e fascia.'))),
        h('div.card.hr-pad', h('div.hr-label', 'Ruolo del mansionario (Alma HR)'),
          i.role ? h('div', h('b', i.role.title), ' ', h('span.hr-chip', `G${i.role.grade}`)) : h('span.hr-chip.z-warn', i.da_confermare ? 'proposta da confermare' : 'senza ruolo'),
          d.is_hr ? h('div', { style: { marginTop: '8px' } }, h('a.btn.btn-sm', { href: '#/hr/ruoli' }, 'Cambia ruolo')) : null),
        h('div.card.hr-pad', h('div.hr-label', `Riportano a questo incarico ⟳ (${ch.length})`),
          ch.length ? h('table.hr-t', ch.map(x => h('tr', h('td', x.nome), h('td.small.muted', x.persona?.nome || 'vacante'), h('td', x.role ? h('span.hr-chip', `G${x.role.grade}`) : h('span.hr-chip.z-warn', 'senza ruolo'))))) : h('p.small.muted', 'Nessuno')),
        d.is_hr ? h('div.card.hr-pad.hr-dark', h('div.hr-label', 'Solo team HR'),
          h('p.small', i.persona ? `RAL ${eur(i.ral)} · costo azienda ${eur(i.costo)}${i.position ? ` · posizione in fascia ${i.position.pct}%` : ''}` : `Vacante al riferimento: ${eur(i.vacante_rif)}`)) : null,
        h('div.hr-row', bossBtn(i.boss_url), i.persona?.boss_url ? bossBtn(i.persona.boss_url, 'Persona su BOSS ↗') : null)),
    });
  }

  const tabs = h('div.hr-tabs', [['albero', 'Albero'], ['area', 'Per area'], ['matrice', 'Matrice livello × area']].map(([k, l]) => h('a', { href: `#/hr/organigramma?vista=${k}`, class: k === vista ? 'on' : '' }, l)));
  const areaSel = h('select.select', h('option', { value: '' }, 'Tutte le aree'), d.aree_stats.map(a => h('option', { value: a.area_id ?? 'none', selected: String(a.area_id ?? 'none') === area }, a.nome)));
  const mostraSel = h('select.select', [['ruolo', 'Mostra: ruolo e grade'], ['nomi', 'Mostra: solo nomi'], ...(d.is_hr ? [['costo', 'Mostra: costo (solo HR)']] : [])].map(([k, l]) => h('option', { value: k, selected: k === mostra }, l)));
  const search = h('input.input', { type: 'search', placeholder: 'Cerca persona o incarico…' });
  areaSel.addEventListener('change', () => { area = areaSel.value; draw(); });
  mostraSel.addEventListener('change', () => { mostra = mostraSel.value; draw(); });
  search.addEventListener('input', debounce(() => { cerca = search.value.trim().toLowerCase(); if (cerca) openPathsTo(cerca); draw(); }, 200));
  const t = d.totali;
  fill(statsBox, h('div.hr-row.hr-filters', h('span.hr-chip', `${t.incarichi} incarichi`), h('span.hr-chip', `${t.persone} persone`), t.vacanti ? h('span.hr-chip.z-warn', `${t.vacanti} vacanti`) : null,
    t.senza_ruolo ? (d.is_hr ? h('a.hr-chip.z-warn', { href: '#/hr/ruoli' }, `${t.senza_ruolo} senza ruolo`) : h('span.hr-chip.z-warn', `${t.senza_ruolo} senza ruolo`)) : null,
    h('span.hr-chip', `span medio ${k1(t.span)}`), h('span.hr-chip', d.sync.at ? `⟳ BOSS ${fmtDateTime(d.sync.at)}${d.sync.api ? '' : ' (export)'}` : 'non ancora sincronizzato')));
  fill(c, head('Organigramma', 'Da BOSS, in sola lettura: ruolo e grade del mansionario sopra ogni incarico, i vacanti con la loro fascia. Si cambia su BOSS.',
    h('div.hr-row', h('button.btn', { type: 'button', on: { click: doveSiCambia } }, icon('info', { size: 16 }), ' Cosa si cambia dove'),
      h('button.btn', { type: 'button', title: 'Stampa la vista aperta, o salvala in PDF dalla finestra di stampa', on: { click: () => { document.body.classList.add('hr-print'); window.print(); setTimeout(() => document.body.classList.remove('hr-print'), 500); } } }, icon('download', { size: 16 }), ' Stampa / PDF'),
      d.boss_base ? bossBtn(d.boss_base, 'Apri BOSS ↗') : null)),
    tabs, h('div.hr-row.hr-filters', amb, search, vista === 'albero' ? areaSel : null, vista === 'albero' ? mostraSel : null), statsBox, body);
  draw();
}

// Tavola P: una regola sola, se il dato c'è su BOSS si cambia su BOSS.
export function doveSiCambia() {
  const B = h('span.hr-chip.hr-chip-dark', 'BOSS');
  const A = () => h('span.hr-chip.z-hi', 'Alma HR');
  const rows = [
    ['Persona: nome, contatti, società, contratto, CCNL e livello, part-time, scadenze', B.cloneNode(true), 'vista ⟳'],
    ['RAL e storico retributivo', B.cloneNode(true), 'vista ⟳ (solo HR)'],
    ['Incarico: nome, area, livello, riporto, chi lo ricopre', B.cloneNode(true), 'vista ⟳'],
    ['Aree e livelli dell\'organigramma', B.cloneNode(true), 'vista ⟳'],
    ['Ruolo del mansionario sull\'incarico', A(), 'Ruoli sugli incarichi'],
    ['Schede del mansionario e versioni (uno solo con Alma Strategy)', A(), 'Mansionario'],
    ['Griglia, regole, merito, minimi CCNL, mercato, costo azienda', A(), 'Pannello di controllo'],
    ['Fuori dalla griglia (operai, apprendisti…)', A(), 'Scheda persona'],
    ['Scenari di riorganizzazione: simulazioni che non toccano BOSS', A(), 'Scenari'],
  ];
  modal({ title: 'Cosa si cambia dove', wide: true, body: h('div', h('p', 'Una regola sola: se il dato c\'è su BOSS, si cambia su BOSS. In Alma HR si decide solo ciò che BOSS non ha.'),
    h('table.hr-t', h('tr', h('th', 'Dato'), h('th', 'Dove si cambia'), h('th', 'In Alma')), rows.map(([a, b, cc]) => h('tr', h('td', a), h('td', b), h('td.small.muted', cc))))) });
}

// ── Costo (solo HR) ─────────────────────────────────────────────────────────────────────────────────────────
export async function costoView(c) {
  const d = await get(`/api/hr/costo?${ambQs()}`);
  const amb = await ambitoSelect(() => costoView(c));
  const max = Math.max(1, ...d.aree.map(a => a.monte + a.vacanti_rif));
  fill(c, head('Costo dell\'organigramma', 'Quanto costa ogni area oggi (RAL da BOSS) e quanto costerebbe coprire i vacanti al riferimento della loro fascia.',
    h('a.btn', { href: `/api/hr/costo.xlsx?${ambQs()}`, download: '' }, icon('download', { size: 16 }), ' Esporta Excel')),
    lockBar('Solo team HR · registrata nel Registro.'),
    h('div.hr-row.hr-filters', amb),
    h('div.hr-grid4',
      h('div.hr-kpi', h('div.l', 'Monte RAL attuale ⟳'), h('div.v', keur(d.totale.monte)), h('div.small.muted', `${d.totale.persone} persone`)),
      h('div.hr-kpi', h('div.l', 'Costo azienda stimato'), h('div.v', keur(d.totale.costo)), h('div.small.muted', `RAL × ${k1(d.coeff)} (Pannello › Zone, soglie)`)),
      h('div.hr-kpi', h('div.l', 'Vacanti al riferimento'), h('div.v', `+${keur(d.totale.vacanti_rif)}`), h('div.small.muted', `${d.totale.vacanti} incarichi vacanti`)),
      h('div.hr-kpi', h('div.l', 'Rientro in fascia'), h('div.v', `+${keur(d.totale.rientro)}`), h('div.small.muted', 'chi è sotto il minimo'))),
    h('div.card.hr-scroll', h('table.list.hr-nohover', h('thead', h('tr', ['Area', 'Persone', 'Monte RAL', 'Costo azienda', 'Vacanti al rif.', 'Peso'].map(x => h('th', x)))),
      h('tbody', d.aree.map(a => h('tr', h('td', h('b', a.nome)), h('td', a.persone), h('td', keur(a.monte)), h('td', keur(a.costo)), h('td', a.vacanti_rif ? `+${keur(a.vacanti_rif)}` : '—'),
        h('td', { style: { minWidth: '220px' } }, h('span.hr-cbar', { style: { width: `${a.monte / max * 100}%` } }), a.vacanti_rif ? h('span.hr-cbar.v', { style: { width: `${a.vacanti_rif / max * 100}%` } }) : null)))))),
    howTo('La barra piena è il monte RAL dell\'area rispetto alla più costosa; la parte a righe è quanto si aggiungerebbe coprendo i vacanti al riferimento della loro fascia. Il costo azienda è una stima: RAL per il coefficiente del pannello (contributi, TFR, INAIL).'));
}

// ── Scenari (solo HR) ───────────────────────────────────────────────────────────────────────────────────────
export async function scenariView(c, id) {
  if (id) return scenarioView(c, id);
  const d = await get('/api/hr/scenari');
  const nuovo = async () => { const nome = await promptDialog('Nuovo scenario', { label: 'Nome (es. «Riorganizzazione Reti 2027»)', ok: 'Crea' }); if (nome) { const r = await post('/api/hr/scenari', { nome }); location.hash = `#/hr/scenari/${r.id}`; } };
  const ST = { aperto: ['aperto', 'z-ok'], realizzato: ['realizzato su BOSS', ''], archiviato: ['archiviato', ''] };
  fill(c, head('Scenari', 'Simulazioni di riorganizzazione: partono da una copia dell\'organigramma di oggi e non toccano mai BOSS né l\'organigramma vero.',
    h('button.btn.btn-primary', { type: 'button', on: { click: nuovo } }, icon('plus', { size: 16 }), ' Nuovo scenario')),
    h('div.card.hr-scroll', h('table.list', h('thead', h('tr', ['Scenario', 'Stato', 'Passi', 'Autore', 'Aggiornato'].map(x => h('th', x)))),
      h('tbody', d.scenari.length ? d.scenari.map(s => h('tr', { on: { click: () => { location.hash = `#/hr/scenari/${s.id}`; } } }, h('td', h('b', s.nome)), h('td', h('span.hr-chip', { class: ST[s.stato][1] }, ST[s.stato][0])), h('td', s.passi), h('td', s.autore || '—'), h('td.small', fmtDateTime(s.updated_at))))
        : h('tr', h('td.empty', { colSpan: 5 }, 'Ancora nessuno scenario'))))));
}
async function scenarioView(c, id) {
  let s = await get(`/api/hr/scenari/${id}`);
  const save = async changes => { try { s = await patch(`/api/hr/scenari/${id}`, { changes }); draw(); } catch { /* il messaggio lo mostra api */ } };
  const opts = (list, sel, empty) => [h('option', { value: '' }, empty), ...list.map(x => h('option', { value: x.id, selected: String(sel) === String(x.id) }, x.label))];
  const incOpts = () => s.incarichi.map(i => ({ id: i.id, label: `${i.nome}${i.persona ? ` · ${i.persona.nome}` : ' · vacante'}` }));
  const roleOpts = () => s.roles.map(r => ({ id: r.id, label: `${r.title} · G${r.grade}` }));
  const fld = (l, el) => h('label.field', h('span', l), el);
  const dialog = tipo => {
    const nome = h('input.input', { placeholder: 'Nome del nuovo incarico' });
    const inc = h('select.select', opts(incOpts(), '', 'Scegli l\'incarico…'));
    const sopra = h('select.select', opts(incOpts(), '', 'Nessuno (vertice)'));
    const role = h('select.select', opts(roleOpts(), '', 'Nessun ruolo'));
    const areaSel = h('select.select', opts(s.aree.map(a => ({ id: a.id, label: a.nome })), '', 'Senza area'));
    const T = { nuovo: ['Incarico nuovo nello scenario', [fld('Nome', nome), fld('Riporta a', sopra), fld('Ruolo del mansionario', role), fld('Area', areaSel)]],
      riporto: ['Cambia riporto', [fld('Incarico', inc), fld('Riporta a', sopra)]], ruolo: ['Cambia ruolo del mansionario', [fld('Incarico', inc), fld('Ruolo', role)]], disattiva: ['Togli un incarico', [fld('Incarico', inc)]] };
    const m = modal({ title: T[tipo][0], body: h('div.hr-form', T[tipo][1], h('p.small.muted', 'Solo nello scenario: l\'organigramma vero non cambia.')),
      actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        const val = el => (el.value === '' ? null : /^\d+$/.test(el.value) ? Number(el.value) : el.value);
        const ch = tipo === 'nuovo' ? { tipo, tmp: `n${Date.now() % 100000}`, nome: nome.value.trim(), riporta_a_id: val(sopra), role_id: val(role), area_id: val(areaSel) }
          : tipo === 'riporto' ? { tipo, incarico_id: val(inc), riporta_a_id: val(sopra) } : tipo === 'ruolo' ? { tipo, incarico_id: val(inc), role_id: val(role) } : { tipo, incarico_id: val(inc) };
        if ((tipo === 'nuovo' && !ch.nome) || (tipo !== 'nuovo' && ch.incarico_id == null)) return toast('Completa i campi', 'err');
        m.close(); await save([...s.changes, ch]);
      } } }, 'Aggiungi')] });
  };
  const box = h('div');
  const desc = ch => {
    const n = idx => s.incarichi.find(i => String(i.id) === String(idx))?.nome || s.changes.find(x => x.tmp === idx)?.nome || 'incarico';
    return ch.tipo === 'nuovo' ? `Nuovo incarico «${ch.nome}»` : ch.tipo === 'riporto' ? `«${n(ch.incarico_id)}» riporta a «${ch.riporta_a_id != null ? n(ch.riporta_a_id) : 'nessuno'}»`
      : ch.tipo === 'ruolo' ? `Ruolo di «${n(ch.incarico_id)}»: ${s.roles.find(r => r.id === ch.role_id)?.title || 'nessuno'}` : `Tolto «${n(ch.incarico_id)}» (nello scenario)`;
  };
  function draw() {
    const o = s.oggi; const sc = s.scenario;
    const row = (l, a, b, fmt = x => x) => h('tr', h('td', l), h('td', fmt(a)), h('td', h('b', fmt(b))));
    fill(box,
      h('div.hr-alert.info', icon('info', { size: 14 }), h('span', 'Questo è uno scenario: non cambia l\'organigramma vero e non scrive su BOSS. Si segna «realizzato» quando le modifiche sono state fatte su BOSS.')),
      h('div.hr-row.hr-filters', h('button.btn', { type: 'button', on: { click: () => dialog('nuovo') } }, '+ Incarico'), h('button.btn', { type: 'button', on: { click: () => dialog('riporto') } }, 'Cambia riporto'),
        h('button.btn', { type: 'button', on: { click: () => dialog('ruolo') } }, 'Cambia ruolo'), h('button.btn', { type: 'button', on: { click: () => dialog('disattiva') } }, 'Togli incarico')),
      h('div.hr-grid32',
        h('div.card.hr-pad', h('div.hr-label', `Modifiche nello scenario (${s.changes.length})`),
          s.changes.length ? h('ol.hr-steps', s.changes.map((ch, n) => h('li', h('span', desc(ch)), h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Togli questa modifica', on: { click: () => save(s.changes.filter((_, j) => j !== n)) } }, '×'))))
            : h('p.small.muted', 'Ancora nessuna modifica: usa i pulsanti qui sopra.'),
          h('div.hr-label', 'Incarichi cambiati o nuovi'),
          h('div.hr-row', s.incarichi.filter(i => i.cambiato).map(i => h('span.hr-chip', { class: i.nuovo ? 'z-hi' : 'z-info' }, `${i.nome}${i.role ? ` · G${i.role.grade}` : ''}`)))),
        h('div',
          h('div.card.hr-pad', h('div.hr-label', 'Oggi → scenario'), h('table.hr-t', h('tr', h('th', ''), h('th', 'Oggi'), h('th', 'Scenario')),
            row('Incarichi', o.incarichi, sc.incarichi), row('Vacanti da coprire', o.vacanti, sc.vacanti), row('Senza ruolo', o.senza_ruolo, sc.senza_ruolo),
            row('Monte RAL + vacanti al rif.', o.costo, sc.costo, keur), row('Span medio', k1(o.span), k1(sc.span))),
            h('p.small', `Costo azienda stimato: ${sc.costo_azienda_delta >= 0 ? '+' : ''}${keur(sc.costo_azienda_delta)} · persone toccate: ${s.persone_toccate}`)),
          h('div.card.hr-pad', h('div.hr-label', `Da fare su BOSS (${s.steps.length})`),
            s.steps.length ? h('ol.small', s.steps.map(x => h('li', x))) : h('p.small.muted', 'Niente da fare su BOSS (i cambi di ruolo si fanno in Alma HR).'),
            h('div.hr-row', h('button.btn.btn-sm', { type: 'button', on: { click: async () => { await navigator.clipboard.writeText(s.steps.map((x, n) => `${n + 1}. ${x}`).join('\n')); toast('Elenco copiato'); } } }, 'Copia l\'elenco'))))));
  }
  const stato = h('select.select', [['aperto', 'Aperto'], ['realizzato', 'Realizzato su BOSS'], ['archiviato', 'Archiviato']].map(([k, l]) => h('option', { value: k, selected: s.stato === k }, l)));
  stato.addEventListener('change', async () => { s = await patch(`/api/hr/scenari/${id}`, { stato: stato.value }); toast('Stato salvato'); });
  fill(c, h('a.hr-back', { href: '#/hr/scenari' }, '‹ Scenari'), head(s.nome, 'Simulazione · non tocca BOSS né l\'organigramma vero', h('div.hr-row', h('span.hr-chip.z-info', 'simulazione'), stato)), lockBar('Solo team HR.'), box);
  draw();
}

// ── Cambi da BOSS (solo HR) ─────────────────────────────────────────────────────────────────────────────────
const TIPO = { incarico_nuovo: 'Nuovo incarico', incarico_disattivato: 'Incarico disattivato', riporto: 'Riporto cambiato', ricoperto: 'Nuova persona sull\'incarico', vacante: 'Incarico vacante', persona_entrata: 'Persona entrata', persona_uscita: 'Persona uscita', ral: 'Nuova RAL', livello: 'Nuovo livello CCNL' };
export async function cambiView(c) {
  const d = await get('/api/hr/eventi');
  const done = async e => { await post(`/api/hr/eventi/${e.id}/fatto`); cambiView(c); };
  const link = e => (e.tipo === 'incarico_nuovo' ? '#/hr/ruoli' : e.tipo === 'persona_entrata' && e.person_key ? `#/hr/persona/${encodeURIComponent(e.person_key)}` : null);
  fill(c, head('Cambi da BOSS', 'Ogni notte Alma confronta la copia di BOSS con quella del giorno prima. I cambi che chiedono una scelta in Alma diventano avvisi.'),
    h('div.hr-grid32',
      h('div.card.hr-scroll', h('table.list.hr-nohover', h('thead', h('tr', ['Quando', 'Cambio', 'Su', 'Cosa serve in Alma'].map(x => h('th', x)))),
        h('tbody', d.eventi.length ? d.eventi.map(e => h('tr', h('td.small', fmtDateTime(e.at)), h('td', TIPO[e.tipo] || e.tipo), h('td', e.oggetto),
          h('td', e.azione ? (e.fatto ? h('span.hr-chip.z-ok', 'fatto') : h('span.hr-chip.z-warn', e.azione)) : h('span.hr-chip.z-ok', 'niente: si aggiorna da solo'))))
          : h('tr', h('td.empty', { colSpan: 4 }, 'Ancora nessun cambio registrato'))))),
      h('div',
        h('div.card.hr-pad', h('div.hr-label', `Avvisi al team HR (${d.avvisi.length})`),
          d.avvisi.length ? d.avvisi.map(e => h('div.hr-li', h('div', h('b', TIPO[e.tipo] || e.tipo), h('div.small', e.oggetto), h('div.small.muted', e.azione)),
            h('div.hr-row', link(e) ? h('a.btn.btn-sm', { href: link(e) }, 'Vai') : null, h('button.btn.btn-sm', { type: 'button', on: { click: () => done(e) } }, 'Fatto')))) : h('p.small.muted', 'Nessun avviso aperto.')),
        h('div.card.hr-pad', h('div.hr-label', 'Stato della sincronizzazione'),
          h('table.hr-t', h('tr', h('td', 'Ultima'), h('td', d.sync.at ? fmtDateTime(d.sync.at) : 'mai')), h('tr', h('td', 'Fonte'), h('td', d.sync.api ? 'API di BOSS, ogni notte' : 'export mensile di BOSS (l\'API non è ancora collegata)')),
            h('tr', h('td', 'Persone · incarichi'), h('td', `${d.sync.persone} · ${d.sync.incarichi}`)), h('tr', h('td', 'Incarichi senza ruolo'), h('td', d.sync.senza_ruolo))),
          h('p.small.muted', 'Se una sincronizzazione fallisce, Alma tiene la copia del giorno prima.')))));
}

// ── Ruoli di Alma Strategy → mansionario (solo HR) ──────────────────────────────────────────────────────────
export async function strategiaView(c) {
  const d = await get('/api/hr/strategy-ruoli');
  const sel = new Map(d.ruoli.map(r => [r.id, r.proposto?.id || '']));
  const go = async items => {
    if (!items.length) return toast('Niente da collegare', 'err');
    const tot = items.reduce((t, it) => t + (d.ruoli.find(r => r.id === it.old_id)?.persone || 0), 0);
    if (!(await confirmDialog(`Collegare ${items.length} ruoli di Strategy al mansionario? Cambia il ruolo di ${tot} persone in Alma Strategy; obiettivi e valutazioni restano.`))) return;
    const r = await post('/api/hr/strategy-ruoli/collega', { items });
    toast(`${r.n} ruoli collegati`); strategiaView(c);
  };
  const rows = d.ruoli.map(r => {
    const s = h('select.select.select-sm', h('option', { value: '' }, 'Scegli…'), d.hr.map(x => h('option', { value: x.id, selected: sel.get(r.id) === x.id }, `${x.title} · G${x.grade}`)));
    s.addEventListener('change', () => sel.set(r.id, s.value ? Number(s.value) : ''));
    return h('tr', h('td', h('b', r.title || '(senza nome)')), h('td', r.persone), h('td', r.obiettivi), h('td', r.proposto ? h('span.hr-chip.z-ai', `✦ ${r.proposto.title}`) : h('span.muted', '—'), h('div', { style: { marginTop: '4px' } }, s)),
      h('td.small.muted', `${r.resp} responsabilità, ${r.skills} competenze`), h('td', h('button.btn.btn-sm', { type: 'button', on: { click: () => go(sel.get(r.id) ? [{ old_id: r.id, role_id: sel.get(r.id) }] : []) } }, '✓')));
  });
  const prop = d.ruoli.filter(r => r.proposto);
  fill(c, head('Ruoli di Alma Strategy', 'Un solo mansionario per salary grade e performance management: i ruoli scritti in Strategy si collegano a quelli del mansionario HR. Le loro responsabilità e competenze passano al ruolo HR se non le ha già; poi il ruolo vecchio sparisce.',
    prop.length ? h('button.btn.btn-primary', { type: 'button', on: { click: () => go(prop.map(r => ({ old_id: r.id, role_id: sel.get(r.id) || r.proposto.id }))) } }, `Collega i ${prop.length} proposti ✦`) : null),
    h('div.card.hr-scroll', h('table.list.hr-nohover', h('thead', h('tr', ['Ruolo in Strategy (oggi)', 'Persone', 'Obiettivi', 'Diventa (mansionario HR)', 'Cosa passa', ''].map(x => h('th', x)))),
      h('tbody', rows.length ? rows : h('tr', h('td.empty', { colSpan: 6 }, 'Tutti i ruoli di Strategy sono già collegati al mansionario.'))))),
    h('div.hr-grid3',
      h('div.card.hr-pad', h('div.hr-label', '1 · Un solo catalogo'), h('p.small.muted', 'Questa pagina: i ruoli vecchi di Strategy diventano ruoli del mansionario HR.')),
      h('div.card.hr-pad', h('div.hr-label', '2 · Il ruolo viene dall\'incarico'), h('p.small.muted', 'In Strategy il ruolo di una persona è quello del suo incarico in Alma HR; si aggiorna da solo a ogni sincronizzazione e conferma.')),
      h('div.card.hr-pad', h('div.hr-label', '3 · Il responsabile dall\'organigramma'), h('p.small.muted', 'Chi valuta in Strategy è chi ricopre l\'incarico a cui la persona riporta su BOSS (i vacanti si saltano).'))));
}
