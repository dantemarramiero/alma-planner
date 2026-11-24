// Alma Procurement (ALM2-81, canvas «Alma Procurement · capitolato e fornitori» approvato da Dante il 24/11/2026).
// Dentro Alma Space come Alma Impianti: Home con «Di cosa hai bisogno?», Capitolato (categorie → merci → scheda),
// Fornitori a schede che si scelgono, Chiedi ad Alma, Richieste di quotazione (email per persona nel suo tono, invio,
// risposte con l'offerta). I fornitori sono le aziende del CRM: «Scheda CRM» apre la loro scheda.
// Stili in css/procurement.css (classi pr-*), sopra i pezzi del design v2 del CRM (cv-*).
import { h, fill, toast, fmtDate, loading, confirmDialog } from './ui.js';
import { get, post, put, del, api } from './api.js';
import { ic, dots, pill, pageTop, title as cvTitle, card, link, emptyState, cvModal, seg } from './crm-v2.js';
// titolo Light + parola Bold; la punteggiatura dopo la parola resta attaccata («bisogno?», «compriamo, e da chi»)
const title = (light, bold, after = '') => (/^[?,.!]/.test(after) ? [light ? `${light} ` : '', h('b', bold), after] : cvTitle(light, bold, after));

const CAT_ICON = { materiali: 'package', subappalti: 'hard-hat', noli: 'veh-escavatore', servizi_cantiere: 'clipboard-check', professionisti: 'pencil-ruler', mezzi: 'veh-autocarro', servizi_generali: 'grid' };
const CAT_TONE = { materiali: 'or', subappalti: 'bl', noli: 'gr', servizi_cantiere: 'am', professionisti: 'so', mezzi: 'bl', servizi_generali: 'or' };
const TAG_TONE = { qualita: 'gr', prezzo: 'bl', da_qualificare: 'am' };
const TAG_LABEL = { qualita: 'Qualità', prezzo: 'Prezzo', da_qualificare: 'Da qualificare' };
const AV_TONES = ['or', 'bl', 'gr', 'so'];
const avTone = name => AV_TONES[[...String(name || '')].reduce((s, c) => s + c.charCodeAt(0), 0) % AV_TONES.length];
const ini = name => String(name || '?').replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?)\b/gi, '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
const avatar = (name, size = '') => h('span.pr-av', { class: `${avTone(name)} ${size}`, 'aria-hidden': 'true', title: name }, ini(name));
const tagPills = tags => (tags || []).map(t => pill(t.label || TAG_LABEL[t.tag] || TAG_LABEL[t], TAG_TONE[t.tag || t]));
const input = (attrs = {}) => h('input.input', attrs);
const fld = (label, control, hint) => h('label.cv-fld', h('span', label), control, hint ? h('span.cv-hint', hint) : null);
const eur = n => (n === null || n === undefined ? '—' : `€ ${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 })}`);
const hashQuery = () => new URLSearchParams(location.hash.split('?')[1] || '');
const go = hash => { location.hash = hash; };

export async function procurementView(container, parts = []) {
  const page = parts[1] || 'home';
  const body = h('div.cv.pr', loading());
  fill(container, body);
  if (page === 'capitolato') return capitolatoPage(body, { cat: parts[2] || null, item: Number(parts[3]) || null });
  if (page === 'fornitori') return fornitoriPage(body);
  if (page === 'chiedi') return chiediPage(body);
  if (page === 'quotazioni') {
    if (parts[2] === 'nuova') return nuovaPage(body);
    if (Number(parts[2])) return rfqPage(body, Number(parts[2]));
    return rfqListPage(body);
  }
  return homePage(body);
}

// ── Home ─────────────────────────────────────────────────────────────────────────────────────────
async function homePage(box) {
  const r = await get('/api/crm/procurement/home');
  const t = r.totals;
  const q = input({ type: 'search', placeholder: 'Es. calcestruzzo C25/30 per Roma Sud, 1.200 m³', 'aria-label': 'Di cosa hai bisogno', class: 'pr-ask-in' });
  const ask = text => { chiediState.pending = text; go('#/procurement/chiedi'); };
  const form = h('form.pr-ask', { on: { submit: e => { e.preventDefault(); if (q.value.trim()) ask(q.value.trim()); } } },
    ic('search', 19), q, h('button.btn.btn-primary', { type: 'submit' }, 'Chiedi ad Alma'));
  const chips = ['casseri in alluminio a noleggio a Pescara', 'alternative per l\'acciaio B450C', 'smaltimento terre e rocce a Roma']
    .map(x => h('button.pr-chip', { type: 'button', on: { click: () => ask(`Mi serve un fornitore di ${x}`) } }, x));
  const tile = (cls, label, big, sub, href) => h('a.pr-tile', { class: cls, href }, h('span.pr-tile-l', label), h('span.pr-tile-n', big), h('span.pr-tile-s', sub));
  fill(box,
    pageTop({ eyebrow: 'Alma Procurement', heading: title('Di cosa hai', 'bisogno', '?') }),
    h('section.cv-card.pr-ask-card', form,
      h('div.pr-chips', h('span.pr-sub', 'Prova:'), chips),
      h('p.pr-sub', 'Alma cerca nel capitolato, nel CRM, nei DDT di BOSS e sul web; chi trova entra nel CRM.')),
    h('section.pr-tiles',
      t.replies ? tile('dark', 'Risposte arrivate', `${t.replies} ${t.replies === 1 ? 'prezzo' : 'prezzi'}`, r.last_reply ? `${r.last_reply.item_name}${r.last_reply.site ? ` · ${r.last_reply.site}` : ''}` : '', r.last_reply ? `#/procurement/quotazioni/${r.last_reply.id}` : '#/procurement/quotazioni')
        : tile('', 'Quotazioni in attesa', `${t.waiting}`, t.waiting ? 'email senza risposta' : 'nessuna richiesta aperta', '#/procurement/quotazioni'),
      tile('', 'Un solo fornitore', `${t.single} ${t.single === 1 ? 'merce' : 'merci'}`, t.single ? `${t.single_name ? `tra cui ${t.single_name} · ` : ''}trovane altri con Alma` : 'ogni merce ne ha almeno due', '#/procurement/capitolato'),
      tile('', 'Dai DDT di BOSS', `${t.proposals} ${t.proposals === 1 ? 'merce nuova' : 'merci nuove'}`, t.proposals ? 'comprate dalle BU, non ancora nel capitolato' : 'carica l\'export dei DDT per vederle', '#/procurement/home?ddt=1')),
    h('div.pr-sec-h', h('h2', 'Il capitolato di Almacis'), link('Apri il capitolato', { href: '#/procurement/capitolato' })),
    h('section.pr-cats', r.categories.map(c => h('a.pr-tile.pr-cat', { href: `#/procurement/capitolato/${c.key}` },
      h('span.pr-cat-h', h('span.pr-cat-ic', { class: CAT_TONE[c.key] }, ic(CAT_ICON[c.key] || 'package', 20)), h('span.pr-cat-n', String(c.items))),
      h('b', c.label),
      h('span.pr-avs', c.avatars.map(n => avatar(n, 'sm')), h('span.pr-sub', `${c.suppliers} ${c.suppliers === 1 ? 'fornitore' : 'fornitori'}`))))),
    ddtCard(r.proposals, t.proposals, () => homePage(box)));
  if (hashQuery().get('ddt')) document.querySelector('.pr-ddt')?.scrollIntoView({ behavior: 'smooth' });
}

function ddtCard(list, total, refresh) {
  return card({ title: 'Merci proposte dai DDT di BOSS', icon: 'file-text', count: total || null, cls: 'pr-ddt',
    right: h('button.btn.btn-sm', { type: 'button', on: { click: () => ddtUpload(refresh) } }, ic('upload', 14), 'Carica i DDT') },
  list.length ? list.map(p => h('div.pr-li',
    h('div', h('b', p.name), h('div.pr-sub', dots([`${p.n} DDT`, p.suppliers.slice(0, 2).join(', ') + (p.suppliers.length > 2 ? ` e altri ${p.suppliers.length - 2}` : ''), p.bus.join(', '), p.last ? `ultimo ${fmtDate(p.last)}` : '']))),
    h('div.pr-acts', pill(p.subcategory || 'da classificare', 'line'),
      h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => ddtAddDialog(p, refresh) } }, 'Aggiungi'),
      h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: async () => { await post('/api/crm/procurement/ddt/proposte/ignora', { key: p.key }); toast('Non la propongo più'); refresh(); } } }, 'Non è una merce'))))
    : emptyState('file-text', 'Carica l\'export dei DDT di BOSS (Excel o CSV con fornitore, P.IVA, descrizione, commessa): Alma propone le merci che le BU comprano e che mancano nel capitolato.'));
}
function ddtUpload(onDone) {
  const file = h('input', { type: 'file', accept: '.xlsx,.csv,.txt' });
  const m = cvModal({ size: 'sm', title: h('h2', 'Carica i DDT di BOSS'),
    body: h('div.en-form', h('p.pr-sub', 'Export da BOSS (Gestione DDT) in Excel o CSV. Servono le colonne Fornitore e Descrizione; aiutano P.IVA, Commessa, BU, Data, Quantità, UM.'), file),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        const f = file.files[0];
        if (!f) return toast('Scegli il file', 'err');
        const buf = await f.arrayBuffer();
        const r = await api('POST', `/api/crm/procurement/ddt?nome=${encodeURIComponent(f.name)}`, buf, { raw: true, headers: { 'Content-Type': 'application/octet-stream' } });
        m.close(); toast(`${r.imported} righe caricate · ${r.proposals} merci proposte`); onDone();
      } } }, 'Carica')] });
}
function ddtAddDialog(p, onDone) {
  const name = input({ value: p.name.charAt(0).toUpperCase() + p.name.slice(1).toLowerCase() });
  const { cat, sub } = catPickers(p.category, p.subcategory);
  const unit = input({ placeholder: 'm³, t, kg, ora…' });
  const m = cvModal({ size: 'sm', title: h('h2', 'Aggiungi al capitolato'),
    body: h('div.en-form', fld('Merce', name), fld('Categoria', cat), fld('Sottocategoria', sub), fld('Unità', unit),
      h('p.pr-sub', `I fornitori dei DDT (${p.suppliers.join(', ')}) si collegano da soli, riconosciuti per P.IVA.`)),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        const r = await post('/api/crm/procurement/ddt/proposte/aggiungi', { key: p.key, name: name.value, category: cat.value, subcategory: sub.value, unit: unit.value });
        m.close(); toast(`Aggiunta, con ${r.suppliers} ${r.suppliers === 1 ? 'fornitore' : 'fornitori'}`); onDone();
      } } }, 'Aggiungi')] });
}
let CATS = null;
async function cats() { if (!CATS) CATS = (await get('/api/crm/procurement/capitolato?q=%23nessuna%23')).categories; return CATS; }
function catPickers(catValue, subValue) {
  const cat = h('select.input');
  const sub = h('select.input');
  const drawSubs = () => {
    const c = (CATS || []).find(x => x.key === cat.value);
    fill(sub, h('option', { value: '' }, '—'), (c?.subs || []).map(s => h('option', { value: s, selected: s === subValue }, s)));
  };
  cats().then(list => {
    fill(cat, list.map(c => h('option', { value: c.key, selected: c.key === catValue }, c.label)));
    drawSubs();
  });
  cat.addEventListener('change', drawSubs);
  return { cat, sub };
}

// ── Capitolato ───────────────────────────────────────────────────────────────────────────────────
async function capitolatoPage(box, { cat, item }) {
  const r = await get(`/api/crm/procurement/capitolato?categoria=${encodeURIComponent(cat || '')}`);
  CATS = r.categories;
  const current = cat || r.categories.find(c => c.n)?.key || 'materiali';
  const list = cat ? r.items : (await get(`/api/crm/procurement/capitolato?categoria=${current}`)).items;
  const sel = list.find(i => i.id === item) || list[0] || null;
  const again = (c, i) => go(`#/procurement/capitolato/${c || current}${i ? `/${i}` : ''}`);
  const drawer = h('aside.cv-card.pr-drawer', sel ? loading() : emptyState('package', 'Nessuna merce in questa categoria: aggiungine una o chiedi ad Alma.'));
  fill(box,
    pageTop({ eyebrow: 'Capitolato merci', heading: title('Cosa', 'compriamo', ', e da chi'),
      actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => itemDialog(null, current, it => again(it.category, it.id)) } }, ic('plus', 15), 'Nuova merce')] }),
    h('div.pr-catbar', { role: 'group', 'aria-label': 'Categorie' }, r.categories.map(c => h('button.pr-catbtn', {
      type: 'button', class: c.key === current ? 'on' : '', 'aria-pressed': String(c.key === current), on: { click: () => again(c.key) },
    }, c.label, h('span', String(c.n))))),
    h('div.pr-main',
      h('div.pr-grid', list.length ? list.map(i => h('button.pr-card', {
        type: 'button', class: sel && i.id === sel.id ? 'on' : '', on: { click: () => again(current, i.id) },
      },
      h('span.pr-card-top', h('span.pr-lbl', i.subcategory || r.categories.find(c => c.key === i.category)?.label), i.suppliers.length === 1 ? pill('1 fornitore', 'am') : null),
      h('b', i.name),
      h('span.pr-avs', i.suppliers.slice(0, 3).map(s => avatar(s.name, 'sm')), h('span.pr-sub', i.suppliers.length ? `${i.suppliers.length} ${i.suppliers.length === 1 ? 'fornitore' : 'fornitori'}` : 'nessun fornitore'))))
        : [emptyState('package', 'Nessuna merce qui.', h('a.btn.btn-sm', { href: '#/procurement/chiedi' }, 'Chiedi ad Alma'))]),
      drawer));
  if (sel) itemDrawer(drawer, sel.id, () => again(current, sel.id));
}
async function itemDrawer(box, id, refresh) {
  const r = await get(`/api/crm/procurement/merci/${id}`);
  const it = r.item;
  fill(box,
    h('div', h('div.pr-lbl', `Scheda merce${it.subcategory ? ` · ${it.subcategory}` : ''}`), h('h2.pr-h2', it.name),
      h('p.pr-sub', dots([it.bus.length ? `Comprata da ${it.bus.join(', ')}` : '', it.unit ? `unità: ${it.unit}` : '']))),
    it.specs || it.norms || it.documents ? h('dl.pr-dl',
      it.specs ? [h('dt', 'Specifiche'), h('dd', it.specs)] : null, it.norms ? [h('dt', 'Norme'), h('dd', it.norms)] : null,
      it.documents ? [h('dt', 'Documenti'), h('dd', it.documents)] : null) : h('p.pr-sub', 'Specifiche da scrivere: con «Modifica» finiscono anche nelle richieste di quotazione.'),
    h('div.pr-lbl', `Fornitori${r.suppliers.length ? ` · ${r.suppliers.length}` : ''}`),
    r.suppliers.length ? h('div.pr-slist', r.suppliers.map(s => h('div.pr-srow',
      avatar(s.name),
      h('div', h('a.pr-sname', { href: `#/crm/scheda/${s.id}` }, s.name), h('div.pr-sub', dots([s.ddt ? `${s.ddt.n} DDT${s.ddt.last ? ` · ultimo ${fmtDate(s.ddt.last)}` : ''}` : s.source === 'web' ? 'trovato da Alma' : 'nel CRM', s.city]))),
      h('div.pr-tags', tagPills(s.tags)),
      h('button.btn.btn-ghost.btn-sm.cv-ico', { type: 'button', 'aria-label': `Scollega ${s.name}`, title: 'Scollega', on: { click: async () => { if (await confirmDialog(`Scollegare ${s.name} da questa merce?`)) { await del(`/api/crm/procurement/merci/${id}/fornitori/${s.id}`); refresh(); } } } }, ic('x', 14)))))
      : emptyState('users', 'Nessun fornitore collegato.'),
    h('div.pr-acts',
      r.suppliers.length ? h('a.btn.btn-primary', { href: `#/procurement/quotazioni/nuova?merce=${id}&fornitori=${r.suppliers.map(s => s.id).join(',')}` }, 'Chiedi i prezzi') : null,
      h('button.btn', { type: 'button', on: { click: () => { chiediState.pending = `Mi serve un fornitore di ${it.name}${it.specs ? ` (${it.specs})` : ''}`; chiediState.item = { id: it.id, name: it.name }; go('#/procurement/chiedi'); } } }, ic('sparkles', 14), 'Trovane altri con Alma'),
      h('button.btn', { type: 'button', on: { click: () => pickSubject('Collega un fornitore del CRM', async s => { await post(`/api/crm/procurement/merci/${id}/fornitori`, { subject_id: s.id }); toast(`${s.name} collegato`); refresh(); }) } }, 'Collega un fornitore'),
      h('button.btn.btn-ghost', { type: 'button', on: { click: () => itemDialog(it, it.category, refresh) } }, 'Modifica')));
}
function itemDialog(it, catKey, onSaved) {
  const { cat, sub } = catPickers(it?.category || catKey, it?.subcategory || '');
  const name = input({ value: it?.name || '', placeholder: 'Es. Calcestruzzo C25/30 XC2' });
  const unit = input({ value: it?.unit || '', placeholder: 'm³, t, kg, ora…' });
  const specs = h('textarea.input', { rows: 3, placeholder: 'Cosa chiediamo: classe, dimensioni, prestazioni' }, it?.specs || '');
  const norms = input({ value: it?.norms || '', placeholder: 'Es. UNI EN 206, NTC 2018' });
  const docs = input({ value: it?.documents || '', placeholder: 'Es. certificato FPC, DoP, marcatura CE' });
  const BUS = ['Edilizia', 'Reti AP', 'Reti MP/BP', 'Impianti', 'Facility', 'Restauro', 'Energy'];
  const checks = BUS.map(b => { const c = h('input', { type: 'checkbox', value: b, checked: (it?.bus || []).includes(b) }); return { c, el: h('label.pr-check', c, b) }; });
  const m = cvModal({ title: h('h2', it ? 'Modifica la merce' : 'Nuova merce'),
    body: h('div.en-form', fld('Nome', name), h('div.pr-two', fld('Categoria', cat), fld('Sottocategoria', sub)), fld('Unità', unit), fld('Specifiche', specs), fld('Norme', norms), fld('Documenti da chiedere', docs),
      fld('BU che la comprano', h('div.pr-checks', checks.map(x => x.el)))),
    left: it ? [h('button.btn.btn-ghost', { type: 'button', on: { click: async () => { if (await confirmDialog('Togliere la merce dal capitolato?', { danger: true, ok: 'Togli' })) { await del(`/api/crm/procurement/merci/${it.id}`); m.close(); go(`#/procurement/capitolato/${it.category}`); } } } }, 'Togli dal capitolato')] : [],
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        const b = { category: cat.value, subcategory: sub.value, name: name.value, unit: unit.value, specs: specs.value, norms: norms.value, documents: docs.value, bus: checks.filter(x => x.c.checked).map(x => x.c.value) };
        const r = it ? await put(`/api/crm/procurement/merci/${it.id}`, b) : await post('/api/crm/procurement/merci', b);
        m.close(); toast('Salvata'); onSaved(r.item);
      } } }, 'Salva')] });
  setTimeout(() => name.focus(), 50);
}
function pickSubject(label, onPick) {
  const q = input({ type: 'search', placeholder: 'Nome dell\'azienda', 'aria-label': 'Cerca' });
  const out = h('div.pr-pick');
  let t;
  const run = async () => {
    const val = q.value.trim();
    if (val.length < 2) return fill(out, h('p.pr-sub', 'Scrivi almeno due lettere.'));
    const r = await get(`/api/crm/impianti/cerca?q=${encodeURIComponent(val)}`);
    fill(out, r.subjects.length ? r.subjects.map(s => h('button.pr-pick-row', { type: 'button', on: { click: () => { m.close(); onPick(s); } } },
      h('div', h('b', s.name), h('div.pr-sub', dots([s.kind_label, s.city]))), h('span.pr-or', 'Scegli')))
      : h('p.pr-sub', 'Nessuna azienda con questo nome nel CRM: chiedi ad Alma di trovarla o aggiungila dal CRM.'));
  };
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
  const m = cvModal({ size: 'sm', title: h('h2', label), body: h('div.en-form', q, out), actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Chiudi')] });
  setTimeout(() => q.focus(), 50);
}

// ── Fornitori ────────────────────────────────────────────────────────────────────────────────────
const fState = { filtro: '', q: '', sel: new Set() };
async function fornitoriPage(box) {
  const r = await get(`/api/crm/procurement/fornitori?filtro=${fState.filtro}&q=${encodeURIComponent(fState.q)}`);
  const again = () => fornitoriPage(box);
  const qIn = input({ type: 'search', value: fState.q, placeholder: 'Nome, P.IVA, merce, città', 'aria-label': 'Cerca un fornitore' });
  let t;
  qIn.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { fState.q = qIn.value.trim(); again().then(() => { const el = box.querySelector('input[type=search]'); el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); }); }, 350); });
  const bar = h('div.pr-selbar');
  const drawBar = () => fill(bar, fState.sel.size ? h('div.pr-selbar-in', h('span', h('b', String(fState.sel.size)), ` ${fState.sel.size === 1 ? 'fornitore scelto' : 'fornitori scelti'}`),
    h('button.btn.btn-ghost.pr-on-dark', { type: 'button', on: { click: () => { fState.sel.clear(); again(); } } }, 'Togli la scelta'),
    h('a.btn.btn-primary', { href: `#/procurement/quotazioni/nuova?fornitori=${[...fState.sel].join(',')}` }, 'Chiedi i prezzi')) : null);
  const cardOf = s => {
    const on = fState.sel.has(s.id);
    const el = h('article.pr-sup', { class: on ? 'on' : '' },
      h('button.pr-sup-pick', { type: 'button', 'aria-pressed': String(on), 'aria-label': `${on ? 'Togli' : 'Scegli'} ${s.name}`, on: { click: () => {
        if (fState.sel.has(s.id)) fState.sel.delete(s.id); else fState.sel.add(s.id);
        el.classList.toggle('on'); drawBar();
      } } }, ic('check', 13)),
      h('div.pr-sup-top', avatar(s.name, 'lg'), moreSupplier(s, again)),
      h('div', h('a.pr-sname', { href: `#/crm/scheda/${s.id}` }, s.name), h('div.pr-sub', dots([s.items.slice(0, 2).join(', '), s.city]))),
      h('div.pr-tags', tagPills(s.tags)),
      h('div.pr-sup-foot',
        s.ddt ? h('span', h('b.pr-big', String(s.ddt.n)), ' DDT') : s.last_mail ? h('span', 'ultima email ', h('b', fmtDate(s.last_mail))) : h('span.pr-sub', s.contact?.email || s.email || 'manca l\'email'),
        h('span.pr-sub', s.origin)));
    return el;
  };
  const c = r.counts;
  fill(box,
    pageTop({ eyebrow: 'Fornitori', heading: title('Tutti i', 'fornitori', ', in un posto'), sub: 'Gli stessi del CRM, uniti a quelli dei DDT di BOSS e a quelli trovati da Alma.',
      actions: [h('a.btn', { href: '#/procurement/chiedi' }, ic('sparkles', 15), 'Trova con Alma')] }),
    h('div.pr-filters', qIn, seg([['', 'Tutti'], ['qualita', 'Qualità', c.qualita], ['prezzo', 'Prezzo', c.prezzo], ['da_qualificare', 'Da qualificare', c.da_qualificare]], fState.filtro,
      k => { fState.filtro = k; again(); }, { label: 'Etichetta' })),
    r.suppliers.length ? h('section.pr-sups', r.suppliers.map(cardOf)) : emptyState('users', fState.q || fState.filtro ? 'Nessun fornitore con questi filtri.' : 'Ancora nessun fornitore: collegali alle merci del capitolato o chiedi ad Alma.'),
    h('p.pr-sub', 'Un clic sul segno di spunta sceglie il fornitore; poi «Chiedi i prezzi» prepara un\'email per ognuno.'),
    bar);
  drawBar();
}
function moreSupplier(s, refresh) {
  const has = k => s.tags.some(t => t.tag === k);
  const flip = (tag, on) => async () => { await post(`/api/crm/procurement/fornitori/${s.id}/etichette`, { tag, on }); toast('Fatto'); refresh(); };
  const d = h('details.cv-more.cv-more-r', h('summary.btn.btn-ghost.btn-sm.cv-ico', { 'aria-label': 'Etichette e altro', title: 'Etichette e altro' }, ic('more', 16)),
    h('div.cv-menu', { role: 'menu' },
      h('button', { type: 'button', role: 'menuitem', on: { click: flip('qualita', !has('qualita')) } }, has('qualita') ? 'Togli «Qualità»' : 'Segna «Qualità»'),
      h('button', { type: 'button', role: 'menuitem', on: { click: flip('prezzo', !has('prezzo')) } }, has('prezzo') ? 'Togli «Prezzo»' : 'Segna «Prezzo»'),
      has('da_qualificare') ? h('button', { type: 'button', role: 'menuitem', on: { click: flip('da_qualificare', false) } }, 'Qualificato') : h('button', { type: 'button', role: 'menuitem', on: { click: flip('da_qualificare', true) } }, 'Da qualificare'),
      h('a', { role: 'menuitem', href: `#/crm/scheda/${s.id}` }, 'Apri la scheda CRM')));
  return d;
}

// ── Chiedi ad Alma ───────────────────────────────────────────────────────────────────────────────
const chiediState = { pending: '', item: null, last: null };
const SOURCES = ['Capitolato', 'CRM', 'DDT di BOSS', 'Web'];
async function chiediPage(box) {
  const recent = await get('/api/crm/procurement/ricerche').catch(() => ({ searches: [] }));
  const recentBox = h('div');
  const drawRecent = list => fill(recentBox, list.length ? list.map(s => h('div.pr-li.pr-li-sm', h('div', h('b', s.query), h('div.pr-sub', `${fmtDate(s.created_at)} · ${s.n} ${s.n === 1 ? 'trovato' : 'trovati'}`)))) : emptyState('search', 'Ancora nessuna ricerca.'));
  drawRecent(recent.searches);
  const thread = h('div.pr-thread');
  const q = input({ type: 'search', placeholder: chiediState.item ? `Altri fornitori di ${chiediState.item.name}…` : 'Es. impermeabilizzanti bituminosi nel Lazio, i più economici', 'aria-label': 'Domanda per Alma', class: 'pr-ask-in' });
  const form = h('form.pr-ask', { on: { submit: e => { e.preventDefault(); if (q.value.trim()) { run(q.value.trim()); q.value = ''; } } } }, q, h('button.btn.btn-primary', { type: 'submit' }, 'Chiedi'));
  async function run(text) {
    const item = chiediState.item;
    chiediState.item = null;
    const srcs = h('div.pr-srcs');
    const ans = h('div.pr-ans', srcs);
    thread.append(h('div.pr-me', text), h('div.pr-alma', h('span.pr-alma-av', 'A'), ans));
    let step = 0;
    const draw = () => fill(srcs, SOURCES.map((n, i) => h('span.pr-src', { class: i < step ? 'done' : i === step ? 'run' : '' },
      i < step ? ic('check', 13) : i === step ? h('span.pr-spin') : null, n)));
    draw();
    const tick = setInterval(() => { if (step < SOURCES.length - 1) { step += 1; draw(); } }, 700);
    let r;
    try { r = await post('/api/crm/procurement/chiedi', { domanda: text, merce_id: item?.id || null }); } catch (e) { clearInterval(tick); fill(ans, h('p', e.message)); return; } finally { clearInterval(tick); }
    step = SOURCES.length; draw();
    chiediState.last = r;
    get('/api/crm/procurement/ricerche').then(x => drawRecent(x.searches)).catch(() => {});
    const created = r.found.filter(f => f.created).length;
    const lead = r.found.length
      ? `${r.local.length ? `Nel capitolato ne abbiamo già ${new Set(r.local.map(l => l.id)).size}. ` : 'Nel capitolato, nel CRM e nei DDT non c\'era nessuno. '}Sul web ne ho trovati ${r.found.length}${created ? `: ${created === r.found.length ? 'li ho aggiunti' : `${created} li ho aggiunti`} al CRM come «Da qualificare»` : ', già nel CRM'}${r.item ? ` e collegati alla merce ${r.item.created ? 'nuova ' : ''}«${r.item.name}»` : ''}.`
      : 'Non ho trovato fornitori adatti: prova a dire meglio cosa serve e dove.';
    const rows = h('div.pr-found', r.found.map((f, i) => {
      const row = h('article.pr-res', { style: { animationDelay: `${i * 0.12}s` } },
        avatar(f.name, 'lg'),
        h('div.pr-res-b', h('a.pr-sname', { href: `#/crm/scheda/${f.subject_id}` }, f.name),
          h('div.pr-tags', tagPills(f.tags), h('span.pr-sub', dots([f.city, f.distance]))),
          f.why ? h('p', f.why) : null,
          h('div.pr-links', f.website ? h('a', { href: f.website, target: '_blank', rel: 'noopener' }, 'Sito') : null, f.source ? h('a', { href: f.source, target: '_blank', rel: 'noopener' }, 'Fonte') : null, f.email ? h('span.pr-sub', f.email) : null, f.phone ? h('span.pr-sub', f.phone) : null)),
        h('div.pr-res-r', pill('Nel CRM', 'gr'),
          h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => { const x = await post(`/api/crm/procurement/chiedi/${f.subject_id}/togli`, { merce_id: r.item?.id || null }); row.remove(); toast(x.removed_from_crm ? 'Tolto, anche dal CRM' : 'Scollegato dalla merce'); } } }, 'Togli')));
      return row;
    }));
    fill(ans, srcs, h('p.pr-lead', lead), r.fake ? h('p.pr-sub', 'Ricerca d\'esempio: in locale non c\'è la chiave OpenAI.') : null, rows,
      r.found.length && r.item ? h('div.pr-acts', h('a.btn.btn-primary', { href: `#/procurement/quotazioni/nuova?merce=${r.item.id}&fornitori=${r.found.map(f => f.subject_id).join(',')}` }, `Chiedi i prezzi a ${r.found.length === 1 ? 'questo fornitore' : `tutti e ${r.found.length}`}`),
        h('a.btn', { href: `#/procurement/capitolato/${r.item.category}/${r.item.id}` }, 'Apri la merce')) : null,
      r.cost_eur ? h('p.pr-sub', `Costo della ricerca: ${r.cost_eur.toLocaleString('it-IT', { maximumFractionDigits: 3 })} €, nel tuo budget AI.`) : null);
  }
  fill(box,
    pageTop({ eyebrow: 'Chiedi ad Alma', heading: title('Trova un', 'fornitore') }),
    h('div.pr-main',
      h('section.cv-card.pr-chat', thread, form),
      h('aside.pr-side',
        card({ title: 'Cosa sa fare', icon: 'sparkles' }, h('ul.pr-ul',
          h('li', 'trova fornitori per merce, zona e tempi'), h('li', 'dice chi è noto per la qualità e chi per il prezzo, con le fonti'),
          h('li', 'li aggiunge al CRM «Da qualificare», senza doppioni'), h('li', 'li collega alla merce del capitolato, o ne crea una'))),
        card({ title: 'Le tue ricerche', icon: 'search' }, recentBox),
        h('p.pr-sub', 'Ogni ricerca costa qualche centesimo ed entra nel budget AI di chi la fa.'))));
  if (chiediState.pending) { const t0 = chiediState.pending; chiediState.pending = ''; run(t0); } else q.focus();
}

// ── Richieste di quotazione ──────────────────────────────────────────────────────────────────────
async function rfqListPage(box) {
  const r = await get('/api/crm/procurement/quotazioni');
  const st = x => (x.status === 'bozza' ? pill('Bozza', 'am') : x.status === 'chiusa' ? pill('Chiusa', 'line') : x.replies === x.n ? pill('Tutti hanno risposto', 'gr') : pill(`${x.replies} di ${x.n} risposte`, x.replies ? 'bl' : ''));
  fill(box,
    pageTop({ eyebrow: 'Richieste di quotazione', heading: title('Chi ha', 'risposto', ', chi no'),
      actions: [h('a.btn.btn-primary', { href: '#/procurement/quotazioni/nuova' }, ic('plus', 15), 'Nuova richiesta')] }),
    h('section.cv-card.pr-list', r.rfqs.length ? r.rfqs.map(x => h('a.pr-li', { href: `#/procurement/quotazioni/${x.id}` },
      h('div', h('b', x.item_name), h('div.pr-sub', dots([[x.quantity, x.unit].filter(Boolean).join(' '), x.site, x.sent_at ? `inviata il ${fmtDate(x.sent_at)}` : `preparata il ${fmtDate(x.created_at)}`, x.due_date ? `entro ${fmtDate(x.due_date)}` : '', x.created_by_name]))),
      h('div.pr-acts', st(x), h('span.pr-or', 'Apri ›'))))
      : emptyState('send', 'Nessuna richiesta ancora. Parti da una merce del capitolato o dai fornitori scelti.', h('a.btn.btn-sm', { href: '#/procurement/capitolato' }, 'Apri il capitolato'))));
}

async function nuovaPage(box) {
  const params = hashQuery();
  const wanted = (params.get('fornitori') || '').split(',').map(Number).filter(Boolean);
  const cap = await get('/api/crm/procurement/capitolato');
  const items = cap.items;
  let itemId = Number(params.get('merce')) || null;
  if (!itemId && wanted.length) itemId = items.find(i => wanted.every(w => i.suppliers.some(s => s.id === w)))?.id || items.find(i => i.suppliers.some(s => wanted.includes(s.id)))?.id || null;
  const merce = h('select.input', h('option', { value: '' }, 'Scegli la merce'), cap.categories.map(c => {
    const its = items.filter(i => i.category === c.key);
    return its.length ? h('optgroup', { label: c.label }, its.map(i => h('option', { value: i.id, selected: i.id === itemId }, i.name))) : null;
  }));
  const qty = input({ placeholder: 'Es. 1.200' });
  const unit = input({ placeholder: 'm³' });
  const site = input({ placeholder: 'Es. Roma Sud · AL1013' });
  const delivery = input({ placeholder: 'Es. dal 15 gennaio per 8 settimane' });
  const due = input({ type: 'date' });
  const notes = h('textarea.input', { rows: 2, placeholder: 'Altro da chiedere (facoltativo)' });
  const supBox = h('div.pr-checks.pr-checks-col');
  const picked = new Set(wanted);
  let extra = [];
  const drawSup = async () => {
    const it = items.find(i => i.id === Number(merce.value));
    if (it && !unit.value) unit.value = it.unit || '';
    let list = it ? it.suppliers : [];
    const missing = [...picked].filter(id => !list.some(s => s.id === id));
    if (missing.length && !extra.length) {
      const all = (await get('/api/crm/procurement/fornitori')).suppliers;
      extra = all.filter(s => missing.includes(s.id));
    }
    list = [...list, ...extra.filter(s => !list.some(x => x.id === s.id))];
    if (!it && !list.length) return fill(supBox, h('p.pr-sub', 'Scegli la merce: compaiono i suoi fornitori.'));
    if (it && !picked.size) it.suppliers.forEach(s => picked.add(s.id));
    fill(supBox, list.length ? list.map(s => { const c = h('input', { type: 'checkbox', checked: picked.has(s.id), on: { change: () => (c.checked ? picked.add(s.id) : picked.delete(s.id)) } });
      return h('label.pr-check', c, avatar(s.name, 'sm'), h('span', s.name), h('span.pr-tags', tagPills(s.tags))); })
      : h('p.pr-sub', 'Questa merce non ha fornitori: collegali dal capitolato o chiedi ad Alma.'));
  };
  merce.addEventListener('change', () => { picked.clear(); drawSup(); });
  const go1 = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    if (!merce.value) return toast('Scegli la merce', 'err');
    if (!picked.size) return toast('Scegli almeno un fornitore', 'err');
    go1.disabled = true;
    fill(go1, h('span.pr-spin'), ' Alma scrive le email…');
    try {
      const r = await post('/api/crm/procurement/quotazioni', { merce_id: Number(merce.value), fornitori: [...picked], quantita: qty.value, unita: unit.value, cantiere: site.value, consegna: delivery.value, entro: due.value || null, note: notes.value });
      go(`#/procurement/quotazioni/${r.rfq.id}`);
    } catch (e) { go1.disabled = false; fill(go1, 'Prepara le email'); throw e; }
  } } }, 'Prepara le email');
  fill(box,
    pageTop({ eyebrow: 'Nuova richiesta di quotazione', heading: title('Cosa chiediamo, e a', 'chi'), sub: 'Alma scrive un\'email per ogni referente, nel tono delle vostre email passate. Prima di partire le vedi e le approvi.' }),
    h('div.pr-main',
      h('section.cv-card.pr-form', h('div.pr-lbl', '1 · Cosa'), fld('Merce del capitolato', merce), h('div.pr-two', fld('Quantità', qty), fld('Unità', unit)), fld('Commessa o cantiere', site), fld('Consegna', delivery), fld('Risposta entro', due), fld('Note', notes)),
      h('section.cv-card.pr-form', h('div.pr-lbl', '2 · A chi'), supBox, h('div.pr-acts', go1))));
  drawSup();
}

async function rfqPage(box, id) {
  const r = await get(`/api/crm/procurement/quotazioni/${id}`);
  const q = r.rfq;
  const again = () => rfqPage(box, id);
  const chips = h('div.pr-chips', pill(q.item_name, 'or'), [[q.quantity, q.unit].filter(Boolean).join(' '), q.site, q.due_date ? `risposta entro ${fmtDate(q.due_date)}` : ''].filter(Boolean).map(x => h('span.pr-chip.static', x)));
  if (q.status === 'bozza') return draftView(box, q, r.recipients, chips, again);
  const rows = r.recipients;
  const answered = rows.filter(x => x.status === 'risposta');
  const prices = answered.map(x => x.offer?.price).filter(x => Number.isFinite(x));
  const max = prices.length ? Math.max(...prices) : 0;
  const late = rows.filter(x => x.status === 'inviata');
  const step = x => (x.status === 'risposta' ? 2 : x.status === 'inviata' ? 1 : 0);
  const dot = (on, pulse) => h('span.pr-dot', { class: [on ? 'on' : '', pulse ? 'pulse' : ''].join(' ') });
  fill(box,
    pageTop({ eyebrow: dots([q.item_name, q.site, q.sent_at ? `inviata il ${fmtDate(q.sent_at)}` : '']), heading: [h('b', `${answered.length} su ${rows.length}`), ' hanno risposto'],
      actions: [q.mine ? h('button.btn', { type: 'button', on: { click: async () => { const x = await post(`/api/crm/procurement/quotazioni/${id}/aggiorna`); toast(x.new_replies ? `${x.new_replies} risposte nuove` : 'Nessuna risposta nuova'); again(); } } }, ic('refresh-cw', 14), 'Aggiorna') : null,
        q.mine && late.length ? h('button.btn', { type: 'button', on: { click: async () => { if (!await confirmDialog(`Mando un sollecito a ${late.length === 1 ? 'chi non ha risposto' : `i ${late.length} che non hanno risposto`}, nella stessa conversazione?`, { ok: 'Manda' })) return; const x = await post(`/api/crm/procurement/quotazioni/${id}/sollecita`); toast(`${x.reminded} solleciti mandati`); again(); } } }, `Sollecita ${late.length === 1 ? 'chi manca' : `gli altri ${late.length}`}`) : null,
        q.status !== 'chiusa' ? h('button.btn.btn-ghost', { type: 'button', on: { click: async () => { await post(`/api/crm/procurement/quotazioni/${id}/chiudi`); toast('Richiesta chiusa'); again(); } } }, 'Chiudi la richiesta') : null] }),
    chips,
    h('section.cv-card.pr-track', rows.map(x => h('div.pr-trow',
      h('div.pr-trow-who', avatar(x.company || x.name, 'lg'), h('div', h('a.pr-sname', { href: x.subject_id ? `#/crm/scheda/${x.subject_id}` : '#' }, x.company || x.email), h('div.pr-sub', x.name || x.email))),
      h('div.pr-steps', { 'aria-label': 'Avanzamento' },
        h('span.pr-step', dot(true), 'Inviata'), h('span.pr-bar', { class: step(x) >= 2 ? 'on' : '' }),
        h('span.pr-step', dot(step(x) >= 2, step(x) === 1), 'Risposto')),
      h('div.pr-offer',
        x.status === 'risposta' ? [
          h('div.pr-offer-top', h('span.pr-price', x.offer?.price ? `${eur(x.offer.price)}${x.offer.unit ? `/${x.offer.unit}` : ''}` : 'prezzo da leggere'), x.best ? pill('Il più basso', 'gr') : null),
          x.offer?.price && max ? h('div.pr-pbar', h('i', { class: x.best ? 'best' : '', style: { width: `${Math.round(x.offer.price / max * 90)}%` } })) : null,
          h('div.pr-sub', dots([x.offer?.notes, x.offer?.delivery, x.offer?.payment])),
          x.reply_preview ? h('details.pr-reply', h('summary', 'Leggi la risposta'), h('p', x.reply_preview)) : null]
          : x.status === 'errore' ? h('span.pr-err', x.error || 'Invio non riuscito')
            : h('span.pr-sub', x.reminded_at ? `Sollecitato il ${fmtDate(x.reminded_at)}` : x.late ? `Nessuna risposta da ${Math.floor((Date.now() - new Date(x.sent_at)) / 864e5)} giorni` : 'In attesa di risposta'))))),
    answered.length ? h('section.cv-card.pr-alma-note', h('span.pr-alma-av', 'A'), h('p', almaNote(answered))) : null,
    h('p.pr-sub', 'I numeri li legge Alma dall\'email: controllali aprendo la risposta. Il confronto completo, la scelta e l\'ordine passeranno dalle Richieste di acquisto (RDO).'));
}
function almaNote(answered) {
  const withPrice = answered.filter(x => Number.isFinite(x.offer?.price)).sort((a, b) => a.offer.price - b.offer.price);
  if (!withPrice.length) return `Ho ${answered.length === 1 ? 'una risposta' : `${answered.length} risposte`}, ma senza un prezzo chiaro: aprile per leggerle.`;
  const b = withPrice[0];
  const parts = [`${b.company || b.name} è il più basso (${eur(b.offer.price)}${b.offer.unit ? `/${b.offer.unit}` : ''}${b.offer.notes ? `, ${b.offer.notes}` : ''})`];
  for (const x of withPrice.slice(1, 3)) parts.push(`${x.company || x.name} chiede ${eur(x.offer.price)}${x.offer.payment ? ` con pagamento ${x.offer.payment}` : ''}${x.offer.notes ? `, ${x.offer.notes}` : ''}`);
  return `${parts.join('; ')}. Prima di scegliere guarda condizioni e documenti.`;
}

function draftView(box, q, recipients, chips, again) {
  const live = recipients.slice();
  const grid = h('section.pr-mails');
  const bar = h('div.pr-selbar');
  const nOk = () => live.filter(x => x.approved && x.status === 'bozza').length;
  const drawBar = () => fill(bar, q.mine ? h('div.pr-selbar-in',
    h('span', h('b', String(nOk())), ` di ${live.filter(x => x.status === 'bozza').length} approvate`),
    h('button.btn.btn-ghost.pr-on-dark', { type: 'button', on: { click: async () => { const r = await post(`/api/crm/procurement/quotazioni/${q.id}/approva-tutte`); r.recipients.forEach(x => { const i = live.findIndex(y => y.id === x.id); if (i >= 0) live[i] = x; }); drawAll(); } } }, 'Approva tutte'),
    h('button.btn.btn-primary', { type: 'button', on: { click: send } }, `Invia ${nOk()} ${nOk() === 1 ? 'email' : 'email'}`))
    : h('div.pr-selbar-in', h('span', `Preparata da ${q.created_by_name}: le email partono dalla sua casella.`)));
  async function send() {
    if (!nOk()) return toast('Approva almeno un\'email', 'err');
    const r = await post(`/api/crm/procurement/quotazioni/${q.id}/invia`);
    grid.querySelectorAll('.pr-mail.ok').forEach((el, i) => { el.style.transitionDelay = `${i * 0.1}s`; el.classList.add('fly'); });
    setTimeout(() => {
      fill(bar);
      fill(grid, h('div.pr-sent', h('span.pr-sent-ic', ic('check', 26)), h('b', `${r.sent} ${r.sent === 1 ? 'email inviata' : 'email inviate'} dalla tua casella Outlook`),
        h('span.pr-sub', r.failed.length ? `${r.failed.length} non partite: ${r.failed.map(f => f.error).join('; ')}` : 'Alma ti avvisa quando rispondono; dopo 5 giorni lavorativi puoi sollecitare con un clic.'),
        h('div.pr-acts', h('button.btn.btn-primary', { type: 'button', on: { click: again } }, 'Segui le risposte'))));
    }, 700);
  }
  const mailCard = (x, i) => {
    const subj = input({ value: x.mail_subject, 'aria-label': 'Oggetto', disabled: !q.mine });
    const body = h('textarea.input.pr-body', { rows: 9, 'aria-label': 'Testo', disabled: !q.mine }, x.body);
    const email = input({ value: x.email, type: 'email', placeholder: 'email del referente', 'aria-label': 'Email' });
    let t;
    const save = patch => { clearTimeout(t); t = setTimeout(async () => { const r = await put(`/api/crm/procurement/quotazioni/${q.id}/destinatari/${x.id}`, patch); live[i] = r.recipient; drawBar(); }, 500); };
    subj.addEventListener('input', () => save({ oggetto: subj.value }));
    body.addEventListener('input', () => save({ testo: body.value }));
    const tone = x.tone || {};
    return h('article.pr-mail', { class: x.approved ? 'ok' : x.status === 'errore' ? 'err' : '' },
      h('div.pr-mail-h', avatar(x.company || x.name, 'lg'), h('div', h('b', x.name || 'Ufficio commerciale'), h('div.pr-sub', x.company))),
      x.status === 'errore' ? h('div.pr-err', x.error, q.mine ? h('div.pr-two', email, h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
        await put(`/api/crm/procurement/quotazioni/${q.id}/destinatari/${x.id}`, { email: email.value });
        const r = await post(`/api/crm/procurement/quotazioni/${q.id}/destinatari/${x.id}/riscrivi`, {}); live[i] = r.recipient; drawAll();
      } } }, 'Scrivi la bozza')) : null) : [
        h('div.pr-tone', h('div.pr-tone-l', h('span', 'Formale'), h('span', 'Amichevole')),
          h('div.pr-tone-bar', h('i', { style: { width: `${tone.level ?? 15}%` } }), h('b', { style: { left: `${tone.level ?? 15}%` } })),
          h('span.pr-sub', tone.why || '')),
        subj, body,
        q.mine ? h('div.pr-acts',
          h('button.btn.btn-sm', { type: 'button', class: x.approved ? 'btn-primary' : '', 'aria-pressed': String(x.approved), on: { click: async () => { const r = await put(`/api/crm/procurement/quotazioni/${q.id}/destinatari/${x.id}`, { approvata: !x.approved }); live[i] = r.recipient; drawAll(); } } }, x.approved ? h('span', ic('check', 13), ' Approvata') : 'Approva'),
          h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: async e => { e.currentTarget.disabled = true; const r = await post(`/api/crm/procurement/quotazioni/${q.id}/destinatari/${x.id}/riscrivi`, { stile: 'formale' }); live[i] = r.recipient; drawAll(); } } }, 'Più formale'),
          h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: async e => { e.currentTarget.disabled = true; const r = await post(`/api/crm/procurement/quotazioni/${q.id}/destinatari/${x.id}/riscrivi`, { stile: 'breve' }); live[i] = r.recipient; drawAll(); } } }, 'Più breve'),
          h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: async () => { await put(`/api/crm/procurement/quotazioni/${q.id}/destinatari/${x.id}`, { togli: true }); live.splice(i, 1); drawAll(); } } }, 'Togli')) : null]);
  };
  const drawAll = () => { fill(grid, live.filter(x => x.status !== 'tolta').map(mailCard)); drawBar(); };
  fill(box,
    pageTop({ eyebrow: 'Nuova richiesta di quotazione', heading: [`${live.length} email, `, h('b', 'una per persona')],
      sub: 'Alma scrive a ognuno come gli scrivete voi: legge le email passate con quella persona. A chi non avete mai scritto arriva il tono di Almacis. Nessuna email parte senza approvazione.' }),
    chips, grid, bar);
  drawAll();
}
