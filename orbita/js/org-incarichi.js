// Organigramma a incarichi in Impostazioni → Organigramma e ruoli (canvas «Alma Planet · Organigramma a incarichi»,
// approvato da Dante il 20/11/2026; viste riprese dalla PR #895 di BOSS: Matrice, Albero, Per area, scheda a destra,
// «Cambia riporto e livello» con anteprima). API: /api/organigramma (routes/organigramma.js).
// #/impostazioni/organigramma/<scheda>/<vista>: scheda = organigramma | persone | livelli | ruoli | storia;
// vista = matrice | albero | area.
import { h, fill, toast, loading, confirmDialog, promptDialog, fmtDateTime, debounce } from './ui.js';
import { api, get, post, patch } from './api.js';
import { ic, pill, av, pageTop, title, emptyState, seg, cvModal } from './crm-v2.js';

const TABS = [['organigramma', 'Organigramma'], ['persone', 'Persone'], ['livelli', 'Livelli e aree'], ['ruoli', 'Ruoli e Microsoft Entra'], ['storia', 'Storia dei cambi']];
const VISTE = [['matrice', 'Matrice'], ['albero', 'Albero'], ['area', 'Per area']];
const NODO_L = 208, NODO_A = 60, GAP_O = 44, GAP_V = 76, GAP_PILA = 8, RIENTRO = 22, TESTA_PILA = 18;
const norm = s => String(s || '').trim().toLowerCase();
let M = null; // il modello caricato
let sel = null; // incarico scelto

const colore = a => (a ? `oi-c${(M.aree.indexOf(a) % 5) + 1}` : 'oi-c0');
const area = id => M.aree.find(a => a.id === id);
const livello = id => M.livelli.find(l => l.id === id);
const incarico = id => M.incarichi.find(i => i.id === id);
const persona = e => M.persone.find(p => p.email === norm(e));
const nomeP = e => persona(e)?.nome || e || '';
const sq = a => h('i.oi-sq', { class: colore(a), 'aria-hidden': 'true' });
const lvPill = id => { const l = livello(id); return l ? pill(`${l.ordine} · ${l.nome}`, l.approva ? 'or' : '') : pill('senza livello', 'rd'); };
const antenati = id => { const out = []; const seen = new Set(); let cur = incarico(id)?.riportaAIncaricoId; while (cur && incarico(cur) && !seen.has(cur)) { seen.add(cur); out.unshift(cur); cur = incarico(cur).riportaAIncaricoId; } return out; };
// da sistemare (bordo rosso) e, fra questi, fuori dalla catena (non riportano a nessuno: colonna/riquadro a parte)
const dsIds = () => new Set(M.daSistemare.filter(d => d.tipo === 'incarico').map(d => d.id));
const fuoriIds = () => new Set(M.daSistemare.filter(d => d.tipo === 'incarico' && d.motivo === 'senza_riporto').map(d => d.id));
const approvaTxt = r => (r.tipo === 'incarico' ? r.nome : r.tipo === 'vertice' ? 'nessuno: è il vertice, le richieste nascono approvate' : `al personale · ${r.motivo}`);

export async function renderOrganigramma(body, { parts = [], ruoli } = {}) {
  const tab = TABS.some(([k]) => k === parts[2]) ? parts[2] : 'organigramma';
  const vista = VISTE.some(([k]) => k === parts[3]) ? parts[3] : 'matrice';
  const go = (t, v) => { location.hash = `#/impostazioni/organigramma/${t}${v ? `/${v}` : ''}`; };
  fill(body, loading());
  M = await get('/api/organigramma');
  const reload = () => renderOrganigramma(body, { parts, ruoli });
  const nds = M.daSistemare.length;
  const top = pageTop({
    eyebrow: 'Impostazioni · organigramma', heading: title('', 'Organigramma'),
    sub: 'Le frecce uniscono gli incarichi, non le persone: se cambia chi ricopre un incarico, chi gli riporta resta al suo posto. Le persone e gli account arrivano da Microsoft Entra.',
    actions: [h('button.btn', { type: 'button', on: { click: () => importDialog(reload) } }, ic('upload', 15), 'Importa da foglio'),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => incaricoDialog(null, reload) } }, ic('plus', 15), 'Nuovo incarico')],
  });
  const tabs = h('nav.oi-tabs', { 'aria-label': 'Sezioni dell\'organigramma' }, TABS.map(([k, l]) => h('a', { href: `#/impostazioni/organigramma/${k}`, class: k === tab ? 'on' : '', 'aria-current': k === tab ? 'page' : undefined }, l)));
  const area_ = h('div.oi-body');
  fill(body, top, tabs, area_);
  if (tab === 'organigramma') return organigrammaTab(area_, vista, go, reload, nds);
  if (tab === 'persone') return personeTab(area_, reload);
  if (tab === 'livelli') return livelliTab(area_, reload);
  if (tab === 'ruoli') return ruoli?.(area_);
  if (tab === 'storia') return storiaTab(area_);
}

// ── scheda Organigramma: barra, vista, scheda a destra ────────────────────────────────────────────────
function organigrammaTab(box, vista, go, reload, nds) {
  let filtroArea = '';
  let cerca = '';
  const viewBox = h('div.oi-view');
  const scheda = h('aside.oi-scheda', { hidden: true });
  const select = id => { sel = id; draw(); drawScheda(); };
  const draw = () => {
    if (vista === 'matrice') matrice(viewBox, { filtroArea, cerca, select });
    else if (vista === 'albero') albero(viewBox, { filtroArea, cerca, select });
    else perArea(viewBox, { filtroArea, cerca, select });
  };
  const drawScheda = () => { if (!sel || !incarico(sel)) { scheda.hidden = true; return; } scheda.hidden = false; schedaIncarico(scheda, sel, reload, () => select(null)); };
  const bar = h('div.oi-bar',
    h('div.oi-row', seg(VISTE, vista, k => go('organigramma', k), { label: 'Vista' }),
      h('input.input', { type: 'search', placeholder: 'Cerca un incarico o una persona', 'aria-label': 'Cerca', style: { width: '260px' }, on: { input: debounce(e => { cerca = norm(e.target.value); draw(); }, 150) } }),
      h('select.input', { 'aria-label': 'Area', on: { change: e => { filtroArea = e.target.value; draw(); } } }, h('option', { value: '' }, 'Tutte le aree'), h('option', { value: 'none' }, 'Senza area'), M.aree.filter(a => a.attiva).map(a => h('option', { value: a.id }, a.nome)))),
    nds ? h('button.oi-ds', { type: 'button', on: { click: () => go('organigramma', 'area') } }, ic('alert-triangle', 15), `${nds} da sistemare`) : pill('Niente da sistemare', 'gr'));
  fill(box, bar, M.incarichi.length ? h('div.oi-split', viewBox, scheda) : emptyState('network', 'Ancora nessun incarico. Crea il primo, importa un foglio o parti dai responsabili di Entra (Importa da foglio).'));
  if (M.incarichi.length) { draw(); drawScheda(); }
}

const match = (i, { filtroArea, cerca }) => (!filtroArea || (filtroArea === 'none' ? !i.businessUnitId : String(i.businessUnitId) === String(filtroArea)))
  && (!cerca || norm(i.nome).includes(cerca) || norm(nomeP(i.ricopertoDaPersonaleId)).includes(cerca));

// Matrice livello × area (vista iniziale): righe per livello divise in «approvano» / «non approvano», colonne per area.
function matrice(box, f) {
  const ds = dsIds();
  const fuori = fuoriIds();
  const path = sel ? new Set(antenati(sel)) : new Set();
  const figli = sel ? new Set(incarico(sel)?.figli || []) : new Set();
  const colonne = [{ id: null, nome: 'Senza area', grp: '' },
    ...M.aree.filter(a => a.attiva && a.tipo === 'funzionale').map((a, n) => ({ ...a, grp: n === 0 ? 'Funzionali' : '' })),
    ...M.aree.filter(a => a.attiva && a.tipo === 'operativa').map((a, n) => ({ ...a, grp: n === 0 ? 'Area Lavori' : '' })),
    ...M.aree.filter(a => a.attiva && a.tipo === 'altro').map((a, n) => ({ ...a, grp: n === 0 ? 'Altro' : '' }))];
  const usate = new Set(M.incarichi.map(i => i.businessUnitId ?? null));
  const cols = colonne.filter(c => usate.has(c.id ?? null) || c.id === null);
  const chip = i => {
    const cls = [i.id === sel ? 'sel' : path.has(i.id) ? 'path' : figli.has(i.id) ? 'rep' : '', !i.ricopertoDaPersonaleId ? 'vac' : '', ds.has(i.id) ? 'bad' : ''].join(' ');
    return h('button.oi-chip', { type: 'button', class: cls, 'aria-pressed': String(i.id === sel), on: { click: () => f.select(i.id === sel ? null : i.id) } },
      h('b', i.nome), h('span', i.ricopertoDaPersonaleId ? nomeP(i.ricopertoDaPersonaleId) : 'Vacante'),
      i.approva && i.ricopertoDaPersonaleId ? h('span.oi-ap', ic('check', 11), 'Approva') : null);
  };
  const cell = (lv, col) => M.incarichi.filter(i => match(i, f) && (i.livelloOrganigrammaId ?? null) === lv && (i.businessUnitId ?? null) === (col.id ?? null) && !fuori.has(i.id));
  const rows = [];
  const lvs = M.livelli.filter(l => l.attivo || M.incarichi.some(i => i.livelloOrganigrammaId === l.id));
  for (const [titolo, list] of [['Approvano le richieste', lvs.filter(l => l.approva)], ['Non approvano', lvs.filter(l => !l.approva)]]) {
    if (!list.length) continue;
    rows.push(h('tr.oi-sep', h('td', { colspan: cols.length + 2 }, titolo)));
    for (const l of list) {
      rows.push(h('tr', h('th.oi-lv', { scope: 'row' }, `${l.ordine} · ${l.nome}`), cols.map(c => {
        const items = cell(l.id, c);
        return h('td', items.slice(0, 8).map(chip), items.length > 8 ? h('span.oi-more', `e altri ${items.length - 8}`) : null);
      }), h('td.oi-dsc', l === list[0] && titolo.startsWith('Appr') ? M.incarichi.filter(i => fuori.has(i.id) && match(i, f)).map(chip) : null)));
    }
  }
  const senzaLiv = M.incarichi.filter(i => !i.livelloOrganigrammaId && !fuori.has(i.id) && match(i, f));
  if (senzaLiv.length) rows.push(h('tr', h('th.oi-lv', { scope: 'row' }, 'Senza livello'), cols.map(c => h('td', senzaLiv.filter(i => (i.businessUnitId ?? null) === (c.id ?? null)).map(chip))), h('td.oi-dsc')));
  fill(box, h('section.cv-card.oi-mx-card', h('div.oi-mx-wrap', h('table.oi-mx',
    h('thead', h('tr', h('th.oi-corner', 'Livello'), cols.map(c => h('th', h('span.oi-grp', c.grp || ' '), h('span.oi-row', sq(c.id ? c : null), c.nome))), h('th.oi-dsh', 'Da sistemare'))),
    h('tbody', rows))),
  h('div.oi-legend', h('span', h('i.l-sel'), 'scelto e la sua catena'), h('span', h('i.l-rep'), 'riportano all\'incarico scelto'), h('span', h('i.l-vac'), 'vacante'), h('span', 'Testate e prima colonna restano ferme mentre si scorre'))));
}

// Albero: il disegno di BOSS (alberoLayout): righe centrate sotto chi sta sopra, squadre impilate in colonna,
// riquadri d'area, «Da sistemare» a destra fuori dalla catena. Si trascina, rotella o − / + per lo zoom, «Adatta».
const espansi = new Set();
let vistaAlbero = null;
function layout(radice, filtro) {
  const figliDi = id => (espansi.has(id) ? (incarico(id)?.figli || []).filter(c => incarico(c)) : []);
  const pos = new Map(), linee = [], riquadri = [], impilati = new Set();
  // larghezza di un sottoalbero
  const larg = new Map();
  const misura = id => {
    const k = figliDi(id);
    if (!k.length) { larg.set(id, NODO_L); return NODO_L; }
    const pila = k.every(c => !figliDi(c).length);
    if (pila) { impilati.add(id); larg.set(id, NODO_L + RIENTRO); return NODO_L + RIENTRO; }
    const w = Math.max(NODO_L, k.reduce((s, c) => s + misura(c), 0) + GAP_O * (k.length - 1));
    larg.set(id, w);
    return w;
  };
  const piazza = (id, x, y) => {
    const w = larg.get(id);
    const nx = impilati.has(id) ? x : x + (w - NODO_L) / 2;
    pos.set(id, { x: nx, y });
    const k = figliDi(id);
    if (!k.length) return y + NODO_A;
    if (impilati.has(id)) {
      let cy = y + NODO_A + TESTA_PILA;
      const lx = nx + 11;
      let d = `M${lx} ${y + NODO_A} V${cy + k.length * (NODO_A + GAP_PILA) - GAP_PILA - NODO_A / 2}`;
      for (const c of k) { pos.set(c, { x: nx + RIENTRO, y: cy }); d += ` M${lx} ${cy + NODO_A / 2} H${nx + RIENTRO}`; cy += NODO_A + GAP_PILA; }
      linee.push({ figli: k, d });
      return cy - GAP_PILA;
    }
    let cx = x + (w - (k.reduce((s, c) => s + larg.get(c), 0) + GAP_O * (k.length - 1))) / 2;
    let bottom = y + NODO_A;
    const my = y + NODO_A + GAP_V / 2;
    for (const c of k) {
      bottom = Math.max(bottom, piazza(c, cx, y + NODO_A + GAP_V));
      const p = pos.get(c);
      linee.push({ figli: [c], d: `M${nx + NODO_L / 2} ${y + NODO_A} V${my} H${p.x + NODO_L / 2} V${p.y}` });
      cx += larg.get(c) + GAP_O;
    }
    return bottom;
  };
  let altezza = 40, x0 = 24;
  if (radice) { misura(radice); altezza = piazza(radice, x0, 40) + 40; }
  // riquadri d'area: chi apre un'area diversa da quella di chi sta sopra, con il suo ramo aperto
  const ramo = id => { const out = [id]; for (const c of figliDi(id)) out.push(...ramo(c)); return out; };
  for (const [id] of pos) {
    const i = incarico(id);
    const pa = incarico(i.riportaAIncaricoId);
    if (i.businessUnitId && (!pa || pa.businessUnitId !== i.businessUnitId)) {
      const ids = ramo(id).filter(x => pos.has(x));
      const xs = ids.map(x => pos.get(x).x), ys = ids.map(x => pos.get(x).y);
      riquadri.push({ areaId: i.businessUnitId, x: Math.min(...xs) - 12, y: Math.min(...ys) - 28, w: Math.max(...xs) - Math.min(...xs) + NODO_L + 24, h: Math.max(...ys) - Math.min(...ys) + NODO_A + 40 });
    }
  }
  let larghezza = Math.max(0, ...[...pos.values()].map(p => p.x + NODO_L)) + 40;
  // «da sistemare»: gli incarichi fuori dalla catena (radici che non sono il vertice), in colonna a destra
  const fuori = M.incarichi.filter(i => i.id !== M.vertice && (!i.riportaAIncaricoId || !incarico(i.riportaAIncaricoId)) && match(i, filtro));
  let dsBox = null;
  if (fuori.length) {
    const bx = larghezza + 20;
    fuori.forEach((i, n) => pos.set(i.id, { x: bx + 16, y: 96 + n * (NODO_A + 20) }));
    dsBox = { x: bx, y: 40, w: NODO_L + 32, h: 72 + fuori.length * (NODO_A + 20) };
    larghezza = bx + NODO_L + 72;
    altezza = Math.max(altezza, dsBox.y + dsBox.h + 40);
  }
  return { pos, linee, riquadri, impilati, larghezza, altezza, dsBox, fuori: fuori.length };
}
function albero(box, f) {
  const ds = dsIds();
  if (!espansi.size && M.vertice) { espansi.add(M.vertice); for (const c of incarico(M.vertice)?.figli || []) espansi.add(c); }
  if (sel) for (const a of antenati(sel)) espansi.add(a);
  const L = layout(M.vertice, f);
  const path = sel ? new Set([...antenati(sel), sel]) : new Set();
  const world = h('div.oi-world', { style: { width: `${L.larghezza}px`, height: `${L.altezza}px` } });
  for (const r of L.riquadri) { const a = area(r.areaId); world.append(h('div.oi-box', { style: { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }, 'aria-hidden': 'true' }, h('span', sq(a), a?.nome))); }
  if (L.dsBox) world.append(h('div.oi-dsbox', { style: { left: `${L.dsBox.x}px`, top: `${L.dsBox.y}px`, width: `${L.dsBox.w}px`, height: `${L.dsBox.h}px` }, 'aria-hidden': 'true' }, h('b', ic('alert-triangle', 13), `Da sistemare · ${L.fuori}`), h('span', 'Fuori dalla catena dei riporti')));
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', L.larghezza); svg.setAttribute('height', L.altezza); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('oi-svg');
  const p1 = document.createElementNS(NS, 'path'), p2 = document.createElementNS(NS, 'path');
  p1.setAttribute('d', L.linee.filter(l => !l.figli.some(c => path.has(c))).map(l => l.d).join(' ')); p1.setAttribute('class', 'oi-l');
  p2.setAttribute('d', L.linee.filter(l => l.figli.length === 1 && path.has(l.figli[0])).map(l => l.d).join(' ')); p2.setAttribute('class', 'oi-l on');
  svg.append(p1, p2);
  world.append(svg);
  for (const [id, p] of L.pos) {
    const i = incarico(id);
    if (!i) continue;
    const a = area(i.businessUnitId);
    const fuoriCatena = fuoriIds().has(id);
    const daSist = ds.has(id);
    const att = (f.filtroArea || f.cerca) && !match(i, f) && !path.has(id);
    const cls = [id === sel ? 'sel' : path.has(id) ? 'path' : '', !i.ricopertoDaPersonaleId ? 'vac' : '', daSist ? 'bad' : '', att ? 'dim' : ''].join(' ');
    const nk = (i.figli || []).length;
    world.append(h('div.oi-n-wrap', { style: { left: `${p.x}px`, top: `${p.y}px` } },
      h('button.oi-n', { type: 'button', class: cls, 'aria-pressed': String(id === sel), 'aria-label': `${i.nome}, ${i.ricopertoDaPersonaleId ? nomeP(i.ricopertoDaPersonaleId) : 'vacante'}`, on: { click: () => { if (!dragged) f.select(id); } } },
        h('span.l1', h('b', i.nome), i.approva && i.ricopertoDaPersonaleId ? h('span.oi-ap', ic('check', 11), 'Approva') : null),
        h('span.l2', { class: fuoriCatena ? 'rd' : !i.ricopertoDaPersonaleId ? 'am' : '' }, sq(a), `${i.ricopertoDaPersonaleId ? nomeP(i.ricopertoDaPersonaleId) : 'Vacante'} · ${a?.nome || 'senza area'}`)),
      nk && !fuoriCatena ? h('button.oi-plus', { type: 'button', 'data-cmd': '1', class: espansi.has(id) && L.impilati.has(id) ? 'left' : '', 'aria-expanded': String(espansi.has(id)),
        'aria-label': espansi.has(id) ? `Comprimi il ramo di ${i.nome}` : `Espandi il ramo di ${i.nome}`, on: { click: () => { if (espansi.has(id)) espansi.delete(id); else espansi.add(id); albero(box, f); } } },
      espansi.has(id) ? '−' : `+${i.nelRamo}`) : null));
  }
  // viewport con trascinamento e zoom
  const zoomLbl = h('span.oi-z', { 'aria-live': 'polite' });
  const vp = h('div.oi-vp', { role: 'group', 'aria-label': 'Albero dell\'organigramma' }, world);
  let dragged = false;
  const v = vistaAlbero || { x: 0, y: 0, k: 0.8 };
  const apply = () => { world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`; zoomLbl.textContent = `${Math.round(v.k * 100)}%`; vistaAlbero = { ...v }; };
  const adatta = () => {
    const k = Math.max(0.5, Math.min(1, (vp.clientWidth - 40) / L.larghezza, (vp.clientHeight - 80) / L.altezza));
    Object.assign(v, { k, x: Math.max(10, (vp.clientWidth - L.larghezza * k) / 2), y: 50 });
    apply();
  };
  const zoom = fz => { const cx = vp.clientWidth / 2, cy = vp.clientHeight / 2; const k2 = Math.min(2, Math.max(0.3, v.k * fz)); v.x = cx - (cx - v.x) * (k2 / v.k); v.y = cy - (cy - v.y) * (k2 / v.k); v.k = k2; apply(); };
  vp.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('[data-cmd]')) return;
    const sx = e.clientX, sy = e.clientY, ox = v.x, oy = v.y;
    dragged = false;
    const move = ev => { if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) dragged = true; v.x = ox + ev.clientX - sx; v.y = oy + ev.clientY - sy; apply(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setTimeout(() => { dragged = false; }, 0); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
  vp.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.1 : 0.9); }, { passive: false });
  const crumbs = sel ? h('nav.oi-crumbs', { 'aria-label': 'Percorso', 'data-cmd': '1' }, h('ol', [...antenati(sel), sel].map((id, n, arr) => h('li', n ? h('span.oi-sepc', { 'aria-hidden': 'true' }, '›') : null,
    h('button', { type: 'button', class: n === arr.length - 1 ? 'cur' : '', on: { click: () => f.select(id) } }, incarico(id)?.nome))))) : null;
  const ctl = h('div.oi-ctl', { 'data-cmd': '1' },
    h('button', { type: 'button', 'aria-label': 'Riduci', on: { click: () => zoom(0.8) } }, '−'), zoomLbl, h('button', { type: 'button', 'aria-label': 'Ingrandisci', on: { click: () => zoom(1.25) } }, '+'),
    h('span.oi-sepv', { 'aria-hidden': 'true' }),
    h('button', { type: 'button', title: 'Mostra tutto senza scendere sotto la leggibilità', on: { click: adatta } }, ic('expand', 14), 'Adatta'),
    h('button', { type: 'button', on: { click: () => { for (const i of M.incarichi) espansi.add(i.id); albero(box, f); } } }, 'Espandi tutto'),
    h('button', { type: 'button', on: { click: () => { espansi.clear(); if (M.vertice) espansi.add(M.vertice); albero(box, f); } } }, 'Comprimi tutto'));
  // minimappa
  const s = Math.min(220 / L.larghezza, 140 / L.altezza);
  const mini = h('div.oi-mini', { 'aria-hidden': 'true' }, [...L.pos.values()].map(p => h('i', { style: { left: `${p.x * s}px`, top: `${p.y * s}px`, width: `${Math.max(3, NODO_L * s)}px`, height: `${Math.max(2, NODO_A * s)}px` } })));
  vp.append(...[crumbs, ctl, mini].filter(Boolean));
  fill(box, vp, h('p.cv-small.cv-muted.oi-hint', 'Si trascina; rotella o − / + per lo zoom; «Adatta» mostra tutto; «+N» apre un ramo. Le squadre senza altri incarichi sotto si impilano in colonna; un riquadro d\'area avvolge chi apre un\'area diversa da chi sta sopra.'));
  if (vistaAlbero) apply(); else requestAnimationFrame(adatta);
}

// Per area (al telefono è la vista che conta): «Da sistemare» per motivo, poi Senza area, Area Lavori, funzionali.
function perArea(box, f) {
  const open = new Set(f.filtroArea ? [String(f.filtroArea)] : []);
  const blocco = (key, titolo, testa, corpo) => {
    const det = h('details.oi-acc', { open: open.has(key) || key === 'ds' }, h('summary', ic('chevron-down', 15), testa), corpo);
    return det;
  };
  const incRow = i => h('div.oi-li', h('button.oi-li-main', { type: 'button', on: { click: () => f.select(i.id) } }, lvPill(i.livelloOrganigrammaId), h('span', `${i.nome} · `, i.ricopertoDaPersonaleId ? nomeP(i.ricopertoDaPersonaleId) : pill('vacante', 'am'))),
    h('span.cv-small.cv-muted', i.riportaAIncaricoId ? `riporta a ${incarico(i.riportaAIncaricoId)?.nome}` : i.vertice ? 'vertice' : 'non riporta a nessuno'));
  const ds = M.daSistemare;
  const out = [];
  if (ds.length) {
    out.push(h('section.cv-card.oi-dscard', blocco('ds', 'Da sistemare', [h('b.rd', 'Da sistemare'), pill(String(ds.length), 'rd')],
      h('div.oi-acc-b', ds.map(d => h('div.oi-li', h('span', h('b', d.testo), ` · ${d.nome}`),
        d.tipo === 'persona' ? h('button.btn.btn-sm', { type: 'button', on: { click: () => riportoPersonaDialog(d.email, () => location.reload()) } }, 'Scegli a chi riporta')
          : d.motivo === 'esterno_senza_account' ? pill('invitalo da Utenti', 'am') : h('button.btn.btn-sm', { type: 'button', on: { click: () => f.select(d.id) } }, 'Apri')))))));
  }
  const areaBox = a => {
    const incs = M.incarichi.filter(i => (i.businessUnitId ?? null) === (a?.id ?? null) && match(i, f));
    const pers = M.persone.filter(p => (p.businessUnitId ?? null) === (a?.id ?? null) && a);
    if (a && !incs.length && !pers.length) return null;
    const resp = incs.find(i => i.responsabileArea);
    const nds = ds.filter(d => d.tipo === 'incarico' && incs.some(i => i.id === d.id)).length;
    return blocco(String(a?.id ?? 'none'), a?.nome || 'Senza area', [sq(a), h('b', a?.nome || 'Senza area'), h('span.cv-small.cv-muted', `${incs.length} incarichi${a ? ` · ${pers.length} persone` : ''}`), nds ? pill(`${nds} da sistemare`, 'am') : null],
      h('div.oi-acc-b', resp ? h('div.cv-small', 'Responsabile dell\'area: ', h('b', `${resp.nome} · ${nomeP(resp.ricopertoDaPersonaleId) || 'vacante'}`)) : null,
        incs.length ? h('div.cv-small.cv-muted', 'Incarichi') : null, incs.map(incRow),
        pers.length ? h('div.cv-small.cv-muted', 'Persone dell\'area (costo e commesse)') : null,
        pers.slice(0, 12).map(p => h('div.oi-li', h('span.cv-row', av(p.nome), p.nome), h('span.cv-small.cv-muted', p.incarichi.length ? `${p.incarichi.length} incarichi` : p.riportaAIncaricoId ? `riporta a ${incarico(p.riportaAIncaricoId)?.nome}` : 'non riporta a nessuno'))),
        pers.length > 12 ? h('span.cv-small.cv-muted', `e altre ${pers.length - 12} persone (scheda Persone)`) : null));
  };
  out.push(h('div.oi-grp', 'Senza area'), h('section.cv-card', areaBox(null)));
  for (const [tipo, t] of [['operativa', 'Area Lavori'], ['funzionale', 'Funzionali'], ['altro', 'Altro']]) {
    const items = M.aree.filter(a => a.tipo === tipo && a.attiva).map(areaBox).filter(Boolean);
    if (items.length) out.push(h('div.oi-grp', t), h('section.cv-card', items));
  }
  fill(box, h('div.oi-pa', out));
}

// ── scheda di un incarico ────────────────────────────────────────────────────────────────────────────
async function schedaIncarico(box, id, reload, close) {
  const i = incarico(id);
  const a = area(i.businessUnitId);
  const chi = persona(i.ricopertoDaPersonaleId);
  const altri = chi ? chi.incarichi.filter(x => x !== id).map(x => incarico(x)?.nome).filter(Boolean) : [];
  const ds = M.daSistemare.filter(d => d.tipo === 'incarico' && d.id === id);
  fill(box,
    h('div.cv-row', { style: { justifyContent: 'space-between' } }, h('span.cv-small.cv-muted', 'Incarico'), h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: close } }, 'Chiudi')),
    h('h3.oi-h3', i.nome),
    h('div.cv-row', { style: { flexWrap: 'wrap', gap: '8px' } }, lvPill(i.livelloOrganigrammaId), h('span.cv-row.cv-small', sq(a), a?.nome || 'Senza area', i.responsabileArea ? ' · responsabile dell\'area' : '')),
    ds.length ? h('div.oi-warn', ic('alert-triangle', 14), ds.map(d => d.testo).join(' · ')) : null,
    chi ? h('div.cv-row', av(chi.nome), h('div', h('b', chi.nome), h('div.cv-small.cv-muted', [chi.esterno ? 'esterno' : chi.jobTitle, altri.length ? `ricopre anche ${altri.join(', ')}` : null].filter(Boolean).join(' · ')))) : h('div', pill('Vacante', 'am'), h('span.cv-small.cv-muted', ' le richieste salgono')),
    h('div.oi-kv', h('span.cv-small.cv-muted', 'Riporta a'), h('span', i.riportaAIncaricoId ? `${incarico(i.riportaAIncaricoId)?.nome} · ${nomeP(incarico(i.riportaAIncaricoId)?.ricopertoDaPersonaleId) || 'vacante'}` : i.vertice ? 'nessuno: è il vertice' : 'nessuno')),
    chi ? h('div.oi-kv.col', h('span.cv-small.cv-muted', `Chi approva le richieste di ${chi.nome.split(' ')[0]}`), h('span', approvaTxt(chi.chiApprova))) : null,
    h('div.oi-kv', h('span.cv-small.cv-muted', 'Riporti diretti'), h('span', `${i.figli.length} incarichi · ${i.riporti.length} persone`)),
    h('div.oi-kv', h('span.cv-small.cv-muted', 'Nel ramo'), h('span', `${i.nelRamo} persone`)),
    h('div.oi-acts',
      h('button.btn.btn-primary', { type: 'button', on: { click: () => riportoIncaricoDialog(i, reload) } }, 'Cambia riporto e livello'),
      h('button.btn', { type: 'button', on: { click: () => ricopertoDialog(i, reload) } }, 'Cambia chi lo ricopre'),
      h('div.cv-row', { style: { gap: '6px' } },
        h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => incaricoDialog(i, reload) } }, 'Modifica'),
        chi && chi.incarichi.length > 1 && chi.incaricoPrincipaleId !== id ? h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => azione({ azione: 'impostaPrincipale', email: chi.email, incaricoId: id }, reload, 'Incarico principale cambiato') } }, 'Rendilo principale') : null,
        h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => { if (await confirmDialog(`Disattivare «${i.nome}»? Per l'organigramma non esisterà più.`, { ok: 'Disattiva', danger: true })) azione({ azione: 'disattivaIncarico', incaricoId: id }, reload, 'Incarico disattivato'); } } }, 'Disattiva'))));
}

// ── azioni con anteprima ─────────────────────────────────────────────────────────────────────────────
async function azione(body, reload, msg) {
  const r = await post('/api/organigramma/azione', body);
  toast(r.cambiano ? `${msg}: ${r.cambiano} ${r.cambiano === 1 ? 'persona cambia' : 'persone cambiano'} approvatore` : msg);
  reload();
}
// Finestra con anteprima del server: ricalcola a ogni modifica dei campi, «Conferma» spento se ci sono errori.
function dialogAnteprima({ titolo, sottotitolo, campi, corpo, okLabel = 'Conferma', reload, msg }) {
  const prev = h('div.oi-prev');
  let ultimo = null;
  const okBtn = h('button.btn.btn-primary', { type: 'button', disabled: true }, okLabel);
  const ricalcola = debounce(async () => {
    const b = corpo();
    if (!b) { fill(prev); okBtn.disabled = true; return; }
    const r = await post('/api/organigramma/anteprima', b, { quiet: true }).catch(e => ({ errori: [e.message] }));
    ultimo = b;
    okBtn.disabled = r.errori.length > 0;
    fill(prev,
      h('div.cv-small.oi-prev-t', 'Anteprima del server'),
      r.prima || r.dopo ? Object.keys({ ...(r.prima || {}), ...(r.dopo || {}) }).map(k => h('div.oi-pr', h('span.cv-small.cv-muted', k.replace(/_/g, ' ')), h('span.b', String(r.prima?.[k] ?? '—')), h('span.a', String(r.dopo?.[k] ?? '—')))) : null,
      r.errori.length ? h('div.oi-blk', h('b', 'Così non si può: '), r.errori.join(' · ')) : null,
      !r.errori.length ? (r.cambiano?.length ? h('div', h('div.cv-small', `Chi cambia approvatore (${r.cambiano.length}). Le richieste già fatte restano a chi le aveva.`),
        h('div.oi-tblwrap', h('table.oi-tbl', h('thead', h('tr', h('th', 'Chi'), h('th', 'Oggi approva'), h('th', 'Dopo approva'))),
          h('tbody', r.cambiano.slice(0, 30).map(c => h('tr', h('td', c.nome), h('td', c.prima), h('td', h('b', c.dopo)))))))) : h('div.cv-small.cv-muted', 'Nessuno cambia approvatore.')) : null);
  }, 250);
  const m = cvModal({
    title: h('div', sottotitolo ? h('div.cv-small.cv-muted', sottotitolo) : null, h('h2', titolo)),
    body: h('div.oi-form', campi, prev),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), okBtn],
  });
  okBtn.addEventListener('click', async () => { okBtn.disabled = true; try { await azione(ultimo, reload, msg); m.close(); } catch { okBtn.disabled = false; } });
  m.box.addEventListener('input', ricalcola);
  m.box.addEventListener('change', ricalcola);
  ricalcola();
  return m;
}
const fld = (label, el, hint) => h('label.oi-fld', h('span.oi-lbl', label), el, hint ? h('span.cv-small.cv-muted', hint) : null);
const sel_ = (opts, value, attrs = {}) => h('select.input', attrs, opts.map(([k, l, dis]) => h('option', { value: k ?? '', selected: String(k ?? '') === String(value ?? ''), disabled: !!dis }, l)));
const optsPersone = () => [['', 'Nessuno (vacante)'], ...M.persone.map(p => [p.email, `${p.nome}${p.esterno ? ' · esterno' : ''}`])];
const optsAree = () => [['', 'Senza area'], ...M.aree.filter(a => a.attiva).map(a => [a.id, a.nome])];
const optsLivelli = () => [['', 'Senza livello'], ...M.livelli.filter(l => l.attivo).map(l => [l.id, `${l.ordine} · ${l.nome}${l.approva ? ' (approva)' : ''}`])];
// incarichi a cui si può riportare: livello più alto di quello scelto, fuori dal ramo
function optsRiporto(self, livelloId) {
  const ord = livello(Number(livelloId))?.ordine;
  const ramo = new Set();
  if (self) { const st = [self.id]; while (st.length) { const c = st.pop(); ramo.add(c); st.push(...(incarico(c)?.figli || [])); } }
  return [['', 'Nessuno (vertice)'], ...M.incarichi.filter(i => !ramo.has(i.id)).sort((a, b) => (livello(a.livelloOrganigrammaId)?.ordine ?? 99) - (livello(b.livelloOrganigrammaId)?.ordine ?? 99) || a.nome.localeCompare(b.nome))
    .map(i => { const o = livello(i.livelloOrganigrammaId)?.ordine; const no = ord != null && o != null && o >= ord; return [i.id, `${i.nome} · ${nomeP(i.ricopertoDaPersonaleId) || 'vacante'}${o ? ` (${o})` : ''}${no ? ' — livello non più alto' : ''}`, no]; })];
}

function incaricoDialog(i, reload) {
  const nome = h('input.input', { value: i?.nome || '', maxlength: 120, placeholder: 'es. Responsabile Reti BP/MP' });
  const ar = sel_(optsAree(), i?.businessUnitId);
  const resp = h('input', { type: 'checkbox', checked: !!i?.responsabileArea });
  if (i) {
    return dialogAnteprima({ titolo: `Modifica «${i.nome}»`, sottotitolo: 'Incarico', reload, msg: 'Incarico modificato', okLabel: 'Salva',
      campi: h('div.oi-form', fld('Nome', nome), fld('Area', ar), h('label.cv-row', resp, 'È il responsabile dell\'area')),
      corpo: () => ({ azione: 'modificaIncarico', incaricoId: i.id, nome: nome.value, businessUnitId: ar.value ? Number(ar.value) : null, responsabileArea: resp.checked }) });
  }
  const lv = sel_(optsLivelli(), '');
  const rip = sel_(optsRiporto(null, ''), M.vertice || '');
  const ric = sel_(optsPersone(), '');
  lv.addEventListener('change', () => { const cur = rip.value; fill(rip, optsRiporto(null, lv.value).map(([k, l, d]) => h('option', { value: k ?? '', disabled: !!d, selected: String(k) === cur }, l))); });
  return dialogAnteprima({ titolo: 'Nuovo incarico', reload, msg: 'Incarico creato', okLabel: 'Crea l\'incarico',
    campi: h('div.oi-form', fld('Nome', nome), h('div.oi-two', fld('Area', ar), fld('Livello', lv)), fld('Riporta a', rip, 'Solo incarichi di un livello più alto. Niente cicli.'), fld('Ricoperto da', ric, 'Vuoto = vacante.'), h('label.cv-row', resp, 'È il responsabile dell\'area')),
    corpo: () => (nome.value.trim() ? { azione: 'creaIncarico', nome: nome.value, businessUnitId: ar.value ? Number(ar.value) : null, livelloOrganigrammaId: lv.value ? Number(lv.value) : null,
      riportaAIncaricoId: rip.value ? Number(rip.value) : null, ricopertoDaPersonaleId: ric.value || null, responsabileArea: resp.checked } : null) });
}
function riportoIncaricoDialog(i, reload) {
  const lv = sel_(optsLivelli(), i.livelloOrganigrammaId);
  const rip = sel_(optsRiporto(i, i.livelloOrganigrammaId), i.riportaAIncaricoId);
  lv.addEventListener('change', () => { const cur = rip.value; fill(rip, optsRiporto(i, lv.value).map(([k, l, d]) => h('option', { value: k ?? '', disabled: !!d, selected: String(k) === cur }, l))); });
  return dialogAnteprima({ titolo: `Cambia riporto e livello · ${i.nome}`, sottotitolo: 'Incarico', reload, msg: 'Riporto e livello cambiati',
    campi: h('div.oi-form', fld('Livello', lv), fld('Riporta a', rip, 'Solo incarichi di un livello più alto, fuori dal ramo di questo incarico.')),
    corpo: () => ({ azione: 'cambiaRiportoIncarico', incaricoId: i.id, livelloOrganigrammaId: lv.value ? Number(lv.value) : null, riportaAIncaricoId: rip.value ? Number(rip.value) : null, updatedAt: i.updatedAt }) });
}
function ricopertoDialog(i, reload) {
  const ric = sel_(optsPersone(), i.ricopertoDaPersonaleId);
  return dialogAnteprima({ titolo: `Chi ricopre «${i.nome}»`, sottotitolo: 'Incarico', reload, msg: 'Cambiato chi ricopre l\'incarico',
    campi: h('div.oi-form', fld('Ricoperto da', ric, 'Chi riporta a questo incarico resta al suo posto e segue il nuovo titolare.')),
    corpo: () => ({ azione: 'cambiaRicopertoDa', incaricoId: i.id, ricopertoDaPersonaleId: ric.value || null, updatedAt: i.updatedAt }) });
}
function riportoPersonaDialog(email, reload) {
  const p = persona(email);
  const rip = sel_([['', 'Nessuno'], ...M.incarichi.map(i => [i.id, `${i.nome} · ${nomeP(i.ricopertoDaPersonaleId) || 'vacante'}`])], p?.riportaAIncaricoId);
  return dialogAnteprima({ titolo: `A chi riporta ${p?.nome || email}`, sottotitolo: 'Persona', reload, msg: 'Cambiato a chi riporta',
    campi: h('div.oi-form', fld('Riporta a', rip, 'Si riporta a un incarico, non a una persona: se cambia chi lo ricopre, si segue il nuovo.')),
    corpo: () => ({ azione: 'cambiaRiportoPersona', email, riportaAIncaricoId: rip.value ? Number(rip.value) : null }) });
}

// ── scheda Persone ───────────────────────────────────────────────────────────────────────────────────
function personeTab(box, reload) {
  let filtro = 'tutte', q = '';
  const ds = new Set(M.daSistemare.filter(d => d.tipo === 'persona').map(d => d.email));
  const table = h('div');
  const draw = () => {
    const list = M.persone.filter(p => (filtro === 'tutte' || (filtro === 'incarichi' && p.incarichi.length) || (filtro === 'esterni' && p.esterno) || (filtro === 'ds' && ds.has(p.email)))
      && (!q || norm(p.nome).includes(q) || p.email.includes(q)));
    fill(table, list.length ? h('div.oi-tblwrap', h('table.cv-tbl', h('thead', h('tr', h('th', 'Persona'), h('th', 'Incarichi'), h('th', 'Riporta a'), h('th', 'Area (costo e commesse)'), h('th', 'Chi approva le sue richieste'))),
      h('tbody', list.map(p => h('tr', { class: ds.has(p.email) ? 'oi-trbad' : '' },
        h('td', h('div.cv-row', av(p.nome, p.esterno ? 'bl' : ''), h('div', h('b', p.nome), h('div.cv-small.cv-muted', p.esterno ? `${p.email} · esterno${p.account ? '' : ' senza account'}` : p.jobTitle || p.email)))),
        h('td', p.incarichi.length ? h('div.cv-row', { style: { flexWrap: 'wrap', gap: '4px' } }, p.incarichi.map(id => pill(`${incarico(id)?.nome}${id === p.incaricoPrincipaleId && p.incarichi.length > 1 ? ' · principale' : ''}`, id === p.incaricoPrincipaleId ? 'or' : ''))) : h('span.cv-muted', 'nessuno')),
        h('td', p.incarichi.length ? h('span.cv-muted', `da ${incarico(p.incaricoPrincipaleId)?.nome}`) : h('button.btn.btn-sm', { type: 'button', on: { click: () => riportoPersonaDialog(p.email, reload) } }, p.riportaAIncaricoId ? incarico(p.riportaAIncaricoId)?.nome : 'Scegli…')),
        h('td', sel_(optsAree(), p.businessUnitId, { 'aria-label': `Area di ${p.nome}`, style: { minHeight: '32px', height: '32px' }, on: { change: e => azione({ azione: 'areaPersona', email: p.email, businessUnitId: e.target.value ? Number(e.target.value) : null }, reload, 'Area cambiata') } })),
        h('td', approvaTxt(p.chiApprova))))))) : emptyState('users', 'Nessuno con questi filtri.'));
  };
  const n = k => M.persone.filter(p => (k === 'incarichi' ? p.incarichi.length : k === 'esterni' ? p.esterno : ds.has(p.email))).length;
  fill(box, h('section.cv-card',
    h('div.cv-ch', seg([['tutte', 'Tutte', M.persone.length], ['incarichi', 'Con incarichi', n('incarichi')], ['esterni', 'Esterni', n('esterni')], ['ds', 'Da sistemare', n('ds') || null]], filtro, k => { filtro = k; draw(); }, { label: 'Quali persone' }),
      h('div.cv-ch-r', h('input.input', { type: 'search', placeholder: 'Cerca per nome', 'aria-label': 'Cerca', on: { input: debounce(e => { q = norm(e.target.value); draw(); }, 150) } }),
        h('button.btn', { type: 'button', on: { click: () => esternoDialog(reload) } }, ic('user-plus', 15), 'Persona esterna'))),
    table, h('div.cv-cardfoot.cv-small.cv-muted', 'Chi ricopre incarichi parte dal suo incarico principale; gli altri riportano a un incarico. L\'area è separata dagli incarichi. Le persone nuove di Entra arrivano ogni notte.')));
  draw();
}
function esternoDialog(reload) {
  const nome = h('input.input', { maxlength: 120 });
  const email = h('input.input', { type: 'email', maxlength: 200 });
  const m = cvModal({ title: 'Persona esterna', body: h('div.oi-form', h('p.cv-small.cv-muted', 'Consulenti e responsabili non assunti: possono ricoprire incarichi e approvare. Per approvare devono entrare in Alma Space.'), fld('Nome e cognome', nome), fld('Email', email)),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await azione({ azione: 'registraEsterno', nome: nome.value, email: email.value }, reload, 'Persona esterna aggiunta'); m.close(); } } }, 'Aggiungi')] });
}

// ── scheda Livelli e aree ────────────────────────────────────────────────────────────────────────────
function livelliTab(box, reload) {
  const uso = id => M.incarichi.filter(i => i.livelloOrganigrammaId === id).length;
  const ids = M.livelli.map(l => l.id);
  const sposta = async (n, d) => { const x = [...ids]; [x[n], x[n + d]] = [x[n + d], x[n]]; await post('/api/organigramma/livelli/ordine', { ids: x }); toast('Livelli riordinati'); reload(); };
  const areaChip = a => h('button.oi-areachip', { type: 'button', class: a.attiva ? '' : 'off', on: { click: () => areaDialog(a, reload) } }, sq(a), a.nome, h('i', String(M.persone.filter(p => p.businessUnitId === a.id).length)));
  fill(box, h('div.oi-two-col',
    h('section.cv-card.pad',
      h('div.cv-row', { style: { justifyContent: 'space-between' } }, h('h3.cv-t', 'Livelli dell\'organigramma'), h('button.btn.btn-sm', { type: 'button', on: { click: async () => { const nome = await promptDialog('Nuovo livello', { label: 'Nome del livello', ok: 'Aggiungi' }); if (nome) { await post('/api/organigramma/livelli', { nome, approva: true }); reload(); } } } }, ic('plus', 14), 'Livello')),
      h('p.cv-small.cv-muted', { style: { margin: 0 } }, 'Ordine 1 = in cima. Un incarico riporta sempre a uno di livello più alto; un vice si fa con un livello in più. Un livello non si cancella: si disattiva. Il riordino che rompe dei riporti viene rifiutato.'),
      h('div.oi-tblwrap', h('table.cv-tbl', h('thead', h('tr', h('th', 'Ordine'), h('th', 'Livello'), h('th', 'Approva le richieste'), h('th', 'Attivo'), h('th.num', 'Incarichi'))),
        h('tbody', M.livelli.map((l, n) => h('tr',
          h('td', h('div.cv-row', { style: { gap: '2px' } }, String(l.ordine), h('button.btn.btn-ghost.btn-sm', { type: 'button', disabled: n === 0, 'aria-label': `Sposta su ${l.nome}`, on: { click: () => sposta(n, -1) } }, ic('chevron-up', 14)),
            h('button.btn.btn-ghost.btn-sm', { type: 'button', disabled: n === ids.length - 1, 'aria-label': `Sposta giù ${l.nome}`, on: { click: () => sposta(n, 1) } }, ic('chevron-down', 14)))),
          h('td', h('input.input', { value: l.nome, 'aria-label': 'Nome del livello', style: { minHeight: '32px', height: '32px' }, on: { change: async e => { await patch(`/api/organigramma/livelli/${l.id}`, { nome: e.target.value }); reload(); } } })),
          h('td', h('label.cv-row', h('input', { type: 'checkbox', checked: l.approva, on: { change: async e => { await patch(`/api/organigramma/livelli/${l.id}`, { approva: e.target.checked }); reload(); } } }), l.approva ? 'sì' : 'no')),
          h('td', h('input', { type: 'checkbox', checked: l.attivo, 'aria-label': 'Attivo', on: { change: async e => { await patch(`/api/organigramma/livelli/${l.id}`, { attivo: e.target.checked }); reload(); } } })),
          h('td.num', String(uso(l.id)))))))),
      h('p.cv-small.cv-muted', { style: { margin: 0 } }, 'Chi non ricopre incarichi non approva mai.')),
    h('section.cv-card.pad',
      h('div.cv-row', { style: { justifyContent: 'space-between' } }, h('h3.cv-t', 'Aree'), h('button.btn.btn-sm', { type: 'button', on: { click: () => areaDialog(null, reload) } }, ic('plus', 14), 'Area')),
      [['funzionale', 'Funzionali'], ['operativa', 'Operative · Area Lavori (etichetta di raggruppamento, non un\'area)'], ['altro', 'Altro']].map(([t, l]) => h('div', h('div.cv-small.cv-muted', { style: { marginBottom: '8px' } }, l), h('div.oi-areas', M.aree.filter(a => a.tipo === t).map(areaChip)))),
      h('p.cv-small.cv-muted', { style: { margin: 0 } }, 'Le aree restano piatte: dicono dove va il costo e quali commesse si vedono. Le regioni sono incarichi dentro l\'area, non sotto-aree.'))));
}
function areaDialog(a, reload) {
  const nome = h('input.input', { value: a?.nome || '', maxlength: 80 });
  const tipo = sel_([['funzionale', 'Funzionale'], ['operativa', 'Operativa (Area Lavori)'], ['altro', 'Altro']], a?.tipo || 'funzionale');
  const cc = h('input.input', { value: a?.centroCosto || '', maxlength: 40, placeholder: 'es. RET-BP' });
  const att = h('input', { type: 'checkbox', checked: a ? a.attiva : true });
  const m = cvModal({ title: a ? `Area «${a.nome}»` : 'Nuova area', body: h('div.oi-form', fld('Nome', nome), fld('Tipo', tipo), a ? fld('Centro di costo', cc) : null, a ? h('label.cv-row', att, 'Attiva') : null),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      if (a) await patch(`/api/organigramma/aree/${a.id}`, { nome: nome.value, tipo: tipo.value, centroCosto: cc.value, attiva: att.checked });
      else await post('/api/organigramma/aree', { nome: nome.value, tipo: tipo.value });
      toast('Area salvata'); m.close(); reload();
    } } }, 'Salva')] });
}

// ── scheda Storia ────────────────────────────────────────────────────────────────────────────────────
async function storiaTab(box) {
  const rows = await get('/api/organigramma/storia');
  const val = x => (x == null ? '—' : Array.isArray(x) ? x.join(', ') : typeof x === 'object' ? Object.entries(x).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ') : String(x));
  fill(box, h('section.cv-card.pad', rows.length ? rows.map(r => h('div.oi-ev', h('div.oi-when', fmtDateTime(r.at)), h('div', { style: { flex: 1, minWidth: 0 } },
    h('div.cv-row', { style: { flexWrap: 'wrap' } }, h('b', `${r.azione}${r.oggetto ? ` · ${r.oggetto}` : ''}`), r.persone_cambiate ? pill(`${r.persone_cambiate} cambiano approvatore`, 'am') : null),
    h('div.cv-small.cv-muted', r.name || 'Sistema'),
    r.prima || r.dopo ? h('div.oi-diff', h('div.b', h('span.cv-small.cv-muted', 'Prima'), h('div', val(r.prima))), h('div.a', h('span.cv-small.cv-muted', 'Dopo'), h('div', val(r.dopo)))) : null)))
    : emptyState('clock', 'Ancora nessun cambio.')));
}

// ── import da foglio / proposta da Entra ─────────────────────────────────────────────────────────────
function importDialog(reload) {
  const out = h('div.oi-imp');
  let ultimo = null; // { tipo: 'file'|'entra', buf }
  const applica = h('button.btn.btn-primary', { type: 'button', disabled: true }, 'Applica');
  const mostra = r => {
    const bad = r.righeConErrori.length;
    applica.disabled = bad > 0;
    applica.textContent = bad ? `Applica (correggi prima ${bad} ${bad === 1 ? 'riga' : 'righe'})` : 'Applica';
    const tbl = (titolo, rows, cols) => rows.length ? h('div', h('div.cv-small', { style: { margin: '8px 0 4px' } }, titolo), h('div.oi-tblwrap', h('table.oi-tbl', h('thead', h('tr', h('th', 'Riga'), cols.map(c => h('th', c)), h('th', 'Problema'))),
      h('tbody', rows.map(row => h('tr', h('td', String(row.riga)), cols.map(c => h('td', row[c] || '—')), h('td', row.problemi.length ? h('span.oi-err', row.problemi.join(' · ')) : pill('ok', 'gr')))))))) : null;
    fill(out, h('div.cv-row', { style: { flexWrap: 'wrap', gap: '6px' } }, pill(`${r.incarichi.length} incarichi`, 'gr'), pill(`${r.persone.length} persone`, 'gr'), bad ? pill(`${bad} righe da correggere`, 'rd') : null, r.daSistemare ? pill(`dopo: ${r.daSistemare} da sistemare`, 'am') : null),
      tbl('Incarichi', r.incarichi, ['incarico', 'riporta a', 'livello', 'area', 'ricoperto da']), tbl('Persone', r.persone, ['email', 'nome', 'riporta a', 'area', 'esterno']),
      r.avvisi?.length ? h('div.oi-blk', r.avvisi.slice(0, 5).join(' · ')) : null);
  };
  const file = h('input', { type: 'file', accept: '.xlsx', on: { change: async e => {
    const f = e.target.files[0]; if (!f) return;
    const buf = await f.arrayBuffer();
    ultimo = { tipo: 'file', buf };
    mostra(await api('POST', '/api/organigramma/import', buf, { raw: true, headers: { 'Content-Type': 'application/octet-stream' } }));
  } } });
  const m = cvModal({ title: 'Importa l\'organigramma', wide: true,
    body: h('div.oi-form',
      h('p.cv-small.cv-muted', { style: { margin: 0 } }, 'Un foglio con poche colonne, poi si corregge nell\'editor. Il file entra tutto o non entra. Gli incarichi si riconoscono dal nome: quelli che ci sono già si aggiornano.'),
      h('div.oi-drop', file, h('a.btn.btn-sm', { href: '/api/organigramma/modello.xlsx' }, ic('download', 14), 'Scarica il modello vuoto'),
        h('button.btn.btn-sm', { type: 'button', on: { click: async () => { ultimo = { tipo: 'entra' }; mostra(await post('/api/organigramma/proposta-entra')); } } }, 'Proponi dai responsabili di Entra')),
      out),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi'), applica] });
  applica.addEventListener('click', async () => {
    if (!ultimo) return;
    applica.disabled = true;
    try {
      if (ultimo.tipo === 'file') await api('POST', '/api/organigramma/import?applica=1', ultimo.buf, { raw: true, headers: { 'Content-Type': 'application/octet-stream' } });
      else await post('/api/organigramma/proposta-entra?applica=1');
      toast('Organigramma importato'); m.close(); reload();
    } catch { applica.disabled = false; }
  });
}
