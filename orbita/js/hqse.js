// HQSE · Qualifica fornitori (ALM2-98, fase 1 ALM2-100; canvas approvato da Dante il 26/11/2026, tavole 6 e 9).
// Pagine: Fornitori (aziende del CRM in qualifica), scheda del fornitore, Checklist e regole.
// Stili in css/hqse.css (classi hq-*), sopra il design v2 del CRM (cv-*).
import { h, fill, toast, fmtDate, fmtDateTime, loading } from './ui.js';
import { get, post, put, del, patch } from './api.js';
import { ic, dots, pill, pageTop, title, card, link, emptyState, cvModal, seg } from './crm-v2.js';

const STATE_TONE = { da_caricare: 'line', in_verifica: 'bl', respinto: 'rd', approvato: 'gr', in_scadenza: 'am', scaduto: 'rd' };
const STATUS_TONE = { registrato: 'line', in_qualifica: 'am', attivo: 'gr', sospeso: 'rd', terminato: 'line' };
const KIND_LABEL = { fornitore: 'Dell\'azienda', risorsa: 'Dei dipendenti', mezzo: 'Dei mezzi' };
let cfgCache = null;
const config = async () => (cfgCache ||= await get('/api/hqse/config'));
const go = hash => { location.hash = hash; };
const input = (attrs = {}) => h('input.input', attrs);
const fld = (label, control, hint) => h('label.cv-fld', h('span', label), control, hint ? h('span.cv-hint', hint) : null);
const ini = name => String(name || '?').replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?)\b/gi, '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
const top = (light, bold, sub, actions) => pageTop({ eyebrow: 'HQSE · Qualifica fornitori', heading: title(light, bold), sub, actions });

export async function hqseView(container, parts = []) {
  const page = parts[1] || 'fornitori';
  const body = h('div.cv.hq', loading());
  fill(container, body);
  const cfg = await config();
  if (page === 'fornitore' && Number(parts[2])) return supplierPage(body, Number(parts[2]), cfg);
  if (page === 'widget') return widgetPage(body, cfg);
  if (page === 'regole') return rulesPage(body, cfg, { checklist: Number(parts[2]) || null, doc: Number(parts[3]) || null });
  return suppliersPage(body, cfg);
}

// ── Fornitori ───────────────────────────────────────────────────────────────────────────────────
async function suppliersPage(box, cfg) {
  let status = '';
  let q = '';
  const list = h('section.cv-card.hq-list', loading());
  const load = async () => {
    const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) });
    const rows = await get(`/api/hqse/fornitori?${qs}`);
    fill(list, rows.length ? rows.map(r => supplierRow(r, cfg)) : emptyState('shield-check', q || status ? 'Nessun fornitore con questi filtri.' : 'Nessun fornitore in qualifica. Mettine uno dal CRM.',
      h('button.btn.btn-primary', { type: 'button', on: { click: () => addSupplier(cfg) } }, 'Metti in qualifica')));
  };
  const search = input({ type: 'search', placeholder: 'Cerca per nome o P.IVA', 'aria-label': 'Cerca fornitore', class: 'hq-search' });
  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = search.value.trim(); load(); }, 250); });
  fill(box,
    top('Fornitori', 'in qualifica', 'Le aziende del CRM che lavorano con noi: documenti, dipendenti e cantieri.',
      [h('button.btn.btn-primary', { type: 'button', on: { click: () => addSupplier(cfg) } }, ic('plus', 16), 'Metti in qualifica')]),
    h('div.hq-bar', search, seg([['', 'Tutti'], ...Object.entries(cfg.status).map(([k, l]) => [k, l])], '', k => { status = k; load(); }, { label: 'Stato' })),
    list);
  await load();
}

function supplierRow(r, cfg) {
  const d = r.docs || {};
  const pct = d.total ? Math.round((d.ok / d.total) * 100) : 0;
  return h('a.hq-row', { href: `#/hqse/fornitore/${r.id}` },
    h('span.hq-av', { 'aria-hidden': 'true' }, ini(r.name)),
    h('span.hq-row-main', h('b', r.name), h('span.hq-sub', dots([r.vat ? `P.IVA ${r.vat}` : '', r.city, cfg.tipi_appalto.find(t => t.key === r.tipo_appalto)?.label]))),
    h('span.hq-row-prog', h('span.hq-sub', `${d.ok || 0} su ${d.total || 0} documenti`), h('span.hq-bar-p', h('i', { style: { width: `${pct}%` } }))),
    h('span.hq-row-tags',
      d.respinti ? pill(`${d.respinti} respint${d.respinti === 1 ? 'o' : 'i'}`, 'rd') : null,
      d.scaduti ? pill(`${d.scaduti} scadut${d.scaduti === 1 ? 'o' : 'i'}`, 'rd') : null,
      pill(cfg.status[r.status], STATUS_TONE[r.status])));
}

function addSupplier(cfg) {
  let chosen = null;
  let tipo = 'lavori';
  const q = input({ type: 'search', placeholder: 'Nome o partita IVA', autofocus: true, 'aria-label': 'Cerca l\'azienda nel CRM' });
  const results = h('div.hq-pick');
  const picked = h('div');
  const tipi = h('div.hq-tipi', { role: 'radiogroup', 'aria-label': 'Tipo di appalto' });
  const drawTipi = () => fill(tipi, cfg.tipi_appalto.map(t => h('button.hq-tipo', {
    type: 'button', role: 'radio', 'aria-checked': String(t.key === tipo), class: t.key === tipo ? 'on' : '',
    on: { click: () => { tipo = t.key; drawTipi(); } },
  }, h('b', t.label), h('span', t.hint), h('span.hq-sub', t.checklists.length ? `Checklist ${t.checklists.join(' + ')}` : 'Solo anagrafica'))));
  drawTipi();
  const pick = s => {
    chosen = s;
    fill(results);
    fill(picked, h('div.hq-chosen', h('span.hq-av', ini(s.name)), h('span', h('b', s.name), h('span.hq-sub', dots([s.vat && `P.IVA ${s.vat}`, s.city]))),
      link('Cambia', { on: { click: () => { chosen = null; fill(picked); q.focus(); } } })));
  };
  let t;
  q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const rows = q.value.trim().length < 2 ? [] : await get(`/api/hqse/aziende?q=${encodeURIComponent(q.value.trim())}`);
      fill(results, rows.length ? rows.map(s => h('button.hq-pick-i', { type: 'button', on: { click: () => pick(s) } },
        h('b', s.name), h('span.hq-sub', dots([s.vat && `P.IVA ${s.vat}`, s.city, s.roles?.includes('fornitore') ? 'fornitore' : s.roles?.[0]]))))
        : q.value.trim().length >= 2 ? h('p.hq-sub', 'Non c\'è nel CRM. ', h('a', { href: '#/crm/fornitori' }, 'Crealo nel CRM'), ' e poi torna qui.') : null);
    }, 250);
  });
  const ok = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    if (!chosen) return toast('Scegli l\'azienda dal CRM', 'err');
    ok.disabled = true;
    try {
      const s = await post('/api/hqse/fornitori', { subject_id: chosen.id, tipo_appalto: tipo });
      m.close();
      toast(`${chosen.name} è in qualifica`);
      go(`#/hqse/fornitore/${s.id}`);
    } catch (e) { ok.disabled = false; toast(e.message, 'err'); }
  } } }, 'Metti in qualifica');
  const m = cvModal({
    title: 'Metti un fornitore in qualifica',
    body: h('div.hq-form', fld('Azienda del CRM', q, 'Un\'anagrafica sola: il fornitore si prende dal CRM.'), results, picked,
      h('div.cv-fld', h('span', 'Tipo di appalto'), tipi)),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok],
  });
}

// ── Scheda fornitore ────────────────────────────────────────────────────────────────────────────
async function supplierPage(box, id, cfg) {
  const s = await get(`/api/hqse/fornitori/${id}`);
  const d = s.docs || {};
  const tile = (label, big, sub, accent) => h('div.cv-card.hq-tile', { class: accent ? 'acc' : '' }, h('span.hq-lbl', label), h('span.hq-big', big), h('span.hq-sub', sub));
  const docsSub = dots([d.in_verifica && `${d.in_verifica} in verifica`, d.respinti && `${d.respinti} respint${d.respinti === 1 ? 'o' : 'i'}`, d.mancanti && `${d.mancanti} da caricare`, d.scaduti && `${d.scaduti} scadut${d.scaduti === 1 ? 'o' : 'i'}`]) || 'tutti in regola';
  const extra = s.checklists.filter(c => c.optional && c.ok).length;
  const reload = () => supplierPage(box, id, cfg);
  fill(box,
    h('a.cv-crumb', { href: '#/hqse/fornitori' }, ic('chevron-left', 14), 'Fornitori'),
    pageTop({
      eyebrow: dots(['Fornitori', s.tipo_label, s.vat && `P.IVA ${s.vat}`]),
      heading: title('', s.name),
      sub: h('span.hq-tags', pill(cfg.status[s.status], STATUS_TONE[s.status]), s.risk ? pill(`Rischio ${cfg.risks[s.risk].toLowerCase()}`, 'line') : null,
        s.whitelist === true ? pill('Whitelist: sì', 'line') : s.whitelist === false ? pill('Whitelist: no', 'line') : null,
        h('a.cv-pill.line', { href: `#/crm/scheda/${s.subject_id}` }, 'Scheda CRM')),
      actions: [h('button.btn', { type: 'button', on: { click: () => invite(s, reload) } }, ic('send', 16), 'Invita al portale'), h('button.btn', { type: 'button', on: { click: () => editQualifica(s, cfg, reload) } }, 'Modifica qualifica')],
    }),
    h('section.hq-tiles',
      tile('Livello di qualifica', cfg.levels[s.level], extra ? `+ ${extra} ${extra === 1 ? 'certificazione' : 'certificazioni'} della CL6` : 'deciso da HQSE', true),
      tile('Documenti dell\'azienda', `${d.ok || 0} / ${d.total || 0}`, docsSub),
      tile('Dipendenti in regola', `${s.workers.ok} / ${s.workers.total}`, s.workers.total ? `${s.workers.total - s.workers.ok} con documenti mancanti` : 'arrivano dal portale (fase 2)'),
      tile('Cantieri', String(s.sites.length), s.sites.length ? s.sites.map(x => x.code).join(', ') : 'nessuno associato')),
    h('div.hq-two',
      checklistsCard(s, cfg, reload),
      h('div.hq-col',
        peopleCard(s),
        card({ title: 'Cantieri', icon: 'hard-hat', count: s.sites.length },
          s.sites.length ? s.sites.map(x => h('div.hq-ev', h('span', h('b', x.code), ` · ${x.name}`))) : emptyState('hard-hat', 'L\'associazione ai cantieri arriva con la fase 4.')),
        card({ title: 'Storico', icon: 'clock', count: s.history.length },
          s.history.length ? s.history.map(e => h('div.hq-ev', h('span', e.text), h('span.hq-sub', dots([e.actor ? `da ${e.actor}` : 'automatico', fmtDateTime(e.at)])))) : emptyState('clock', 'Niente ancora.')))));
}

function checklistsCard(s, cfg, reload) {
  const open = new Set();
  const body = h('div.hq-cls');
  const draw = () => fill(body, s.checklists.map(c => {
    const tone = c.optional ? 'soft' : c.ok === c.total ? 'gr' : 'or';
    const row = h('button.hq-cl', { type: 'button', 'aria-expanded': String(open.has(c.id)), on: { click: () => { open.has(c.id) ? open.delete(c.id) : open.add(c.id); draw(); } } },
      h('span.hq-cl-h', h('span', h('b', `${c.code} ${c.name}`), h('span.hq-sub', ` · ${c.optional ? 'facoltativa' : c.commesse?.length ? `solo ${c.commesse.join(', ')}` : c.origin === 'questionario' ? 'dal tipo di appalto' : 'aggiunta a mano'}`)),
        h('span.hq-sub', `${c.ok} su ${c.total}`)),
      h('span.hq-bar-p', { class: tone }, h('i', { style: { width: `${c.pct}%` } })));
    if (!open.has(c.id)) return row;
    return h('div.hq-cl-open', row, h('div.hq-docs', c.docs.map(x => h('div.hq-doc',
      h('span', h('span.hq-doc-n', x.name), h('span.hq-sub', dots([x.validity, x.until && `fino al ${fmtDate(x.until)}`, x.reason && `perché: ${x.reason}`]))),
      x.blocking ? h('span.hq-lock', { title: 'Blocca il cantiere' }, ic('lock', 14)) : null,
      h('span.hq-doc-r', x.document_id ? h('a.cv-lnk', { href: `/api/hqse/documenti/${x.document_id}/file`, target: '_blank', rel: 'noopener' }, 'Apri') : null, pill(cfg.doc_states[x.state], STATE_TONE[x.state]))))),
    h('div.hq-cl-act', link('Togli dal fornitore', { on: { click: async () => { await del(`/api/hqse/fornitori/${s.id}/checklists/${c.id}`); reload(); } } })));
  }));
  draw();
  const add = h('button.cv-lnk', { type: 'button', on: { click: () => addChecklist(s, cfg, reload) } }, 'Aggiungi una checklist');
  return card({ title: 'Checklist', icon: 'list-checks', count: s.checklists.length, right: add },
    s.checklists.length ? body : emptyState('list-checks', 'Nessuna checklist: con «Materiali» basta l\'anagrafica.'),
    s.vehicle_list.length ? h('div.hq-veh', h('span.hq-lbl', 'Mezzi'), h('span', s.vehicle_list.map(m => dots([m.kind, m.plate])).join(' · '))) : null);
}

function addChecklist(s, cfg, reload) {
  const have = new Set(s.checklists.map(c => c.id));
  const options = cfg.checklists.filter(c => c.kind === 'fornitore' && !have.has(c.id));
  const m = cvModal({
    title: `Aggiungi una checklist a ${s.name}`,
    body: h('div.hq-pick', options.map(c => h('button.hq-pick-i', { type: 'button', on: { click: async () => {
      try { await post(`/api/hqse/fornitori/${s.id}/checklists`, { checklist_id: c.id }); m.close(); reload(); } catch (e) { toast(e.message, 'err'); }
    } } }, h('b', `${c.code} ${c.name}`), h('span.hq-sub', dots([`${c.docs} documenti`, c.optional && 'facoltativa', c.commesse?.length && `solo ${c.commesse.join(', ')}`]))))),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi')],
  });
}

function editQualifica(s, cfg, reload) {
  const sel = (obj, val) => h('select.input', Object.entries(obj).map(([k, l]) => h('option', { value: k, selected: k === val }, l)));
  const st = sel(cfg.status, s.status);
  const lv = sel(cfg.levels, s.level);
  const rk = sel({ ...cfg.risks, '': 'Non indicato' }, s.risk);
  const wl = h('select.input', [['', 'Non indicato'], ['si', 'Sì'], ['no', 'No']].map(([k, l]) => h('option', { value: k, selected: k === (s.whitelist === true ? 'si' : s.whitelist === false ? 'no' : '') }, l)));
  const ok = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    try {
      await patch(`/api/hqse/fornitori/${s.id}`, { status: st.value, level: lv.value, risk: rk.value, whitelist: wl.value === '' ? null : wl.value === 'si' });
      m.close(); toast('Qualifica aggiornata'); reload();
    } catch (e) { toast(e.message, 'err'); }
  } } }, 'Salva');
  const m = cvModal({
    title: 'Modifica qualifica',
    body: h('div.hq-grid2', fld('Stato', st), fld('Livello di qualifica', lv), fld('Rischio', rk), fld('Iscritto alla whitelist', wl)),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok],
  });
}

// ── Checklist e regole ──────────────────────────────────────────────────────────────────────────
async function rulesPage(box, cfg, sel) {
  const lists = cfg.checklists;
  const current = lists.find(c => c.id === sel.checklist) || lists.find(c => c.code === 'CL3') || lists[0];
  const cl = await get(`/api/hqse/checklists/${current.id}`);
  const docId = sel.doc && cl.docs.some(d => d.id === sel.doc) ? sel.doc : cl.docs[0]?.id;
  const groups = [
    ['Dell\'azienda', lists.filter(c => c.kind === 'fornitore' && !c.commesse.length)],
    ['Per commessa', lists.filter(c => c.kind === 'fornitore' && c.commesse.length)],
    ['Dei dipendenti', lists.filter(c => c.kind === 'risorsa')],
    ['Dei mezzi', lists.filter(c => c.kind === 'mezzo')],
  ];
  const nav = h('section.cv-card.hq-nav', { 'aria-label': 'Checklist' }, groups.map(([label, items]) => [
    h('span.hq-lbl.hq-nav-l', `${label} · ${items.length}`),
    items.map(c => h('a.hq-nav-i', { href: `#/hqse/regole/${c.id}`, class: c.id === current.id ? 'on' : '', 'aria-current': c.id === current.id ? 'page' : null },
      h('span', c.kind === 'fornitore' ? `${c.code} ${c.name}` : c.name), h('span.hq-sub', c.commesse.length > 1 ? `${c.commesse.length} cantieri` : c.commesse[0] || String(c.docs)))),
  ]));
  const tipi = cfg.tipi_appalto.filter(t => t.checklists.includes(cl.code)).map(t => `«${t.label}»`);
  const table = h('section.cv-card.hq-tab',
    h('div.hq-tab-h', h('b', cl.kind === 'fornitore' ? `${cl.code} ${cl.name}` : cl.name),
      h('span.hq-sub', cl.commesse.length ? `solo ${cl.commesse.join(', ')}` : tipi.length ? `da ${tipi.join(', ')} nel questionario` : KIND_LABEL[cl.kind])),
    h('div.hq-scroll', h('table.hq-t',
      h('thead', h('tr', h('th', 'Documento'), h('th', 'Vale'), h('th', 'Blocca'))),
      h('tbody', cl.docs.map(d => h('tr', { class: d.id === docId ? 'on' : '', on: { click: () => go(`#/hqse/regole/${cl.id}/${d.id}`) } },
        h('td', h('a', { href: `#/hqse/regole/${cl.id}/${d.id}` }, d.name)), h('td.hq-sub', d.validity), h('td', d.blocking ? 'sì' : 'no')))))),
    h('div.hq-tab-f', link('Aggiungi un documento', { on: { click: () => addDoc(cl) } })));
  const editor = h('section.cv-card.hq-ed', loading());
  fill(box,
    top('Le regole le', 'scriviamo noi', 'Checklist e documenti: quanto vale ogni documento, quando avvisare, cosa blocca il cantiere e cosa controlla l\'AI.',
      [h('button.btn.btn-primary', { type: 'button', on: { click: () => newChecklist() } }, 'Nuova checklist')]),
    h('div.hq-rules', nav, table, editor));
  if (docId) docEditor(editor, docId, cfg, () => rulesPage(box, cfg, { checklist: cl.id, doc: docId }));
  else fill(editor, emptyState('file-text', 'Questa checklist non ha ancora documenti.'));
}

async function docEditor(box, id, cfg, reload) {
  const t = await get(`/api/hqse/doc-types/${id}`);
  const instr = h('textarea.input', { rows: 3 }, t.instructions);
  const rule = h('select.input', Object.entries(cfg.rules).map(([k, l]) => h('option', { value: k, selected: k === t.validity_rule }, l)));
  const months = input({ type: 'number', min: 1, max: 240, value: t.validity_months ?? '', 'aria-label': 'Mesi' });
  const monthsBox = fld('Mesi', months);
  const showMonths = () => { monthsBox.hidden = !['firma', 'rilascio', 'attestato'].includes(rule.value); };
  rule.addEventListener('change', showMonths);
  showMonths();
  const notice = input({ value: (t.notice_days || []).join(', '), 'aria-label': 'Reminder' });
  const grace = input({ type: 'number', min: 0, max: 365, value: t.grace_days });
  const tpl = input({ value: t.template_name, placeholder: 'nessuno' });
  const blocking = h('input', { type: 'checkbox', checked: t.blocking });
  const checks = [...(t.ai_checks || [])];
  const checksBox = h('div.hq-checks');
  const drawChecks = () => fill(checksBox, checks.map((c, i) => h('div.hq-rule',
    h('input.input', { value: c.text, 'aria-label': 'Controllo', on: { input: e => { checks[i].text = e.target.value; } } }),
    h('select.input.hq-onfail', { 'aria-label': 'Se non va', on: { change: e => { checks[i].on_fail = e.target.value; } } },
      h('option', { value: 'respingi', selected: c.on_fail !== 'chiedi' }, 'se no: respingi'), h('option', { value: 'chiedi', selected: c.on_fail === 'chiedi' }, 'se no: incerto')),
    h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Togli il controllo', on: { click: () => { checks.splice(i, 1); drawChecks(); } } }, ic('x', 14)))),
    checks.length ? null : h('p.hq-sub', 'Nessun controllo ancora: l\'AI guarderà solo date e intestatario.'));
  drawChecks();
  const save = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    save.disabled = true;
    try {
      await put(`/api/hqse/doc-types/${t.id}`, {
        instructions: instr.value, validity_rule: rule.value, validity_months: monthsBox.hidden ? null : Number(months.value),
        notice_days: notice.value.split(/[,;\s]+/).filter(Boolean).map(Number), grace_days: Number(grace.value) || 0,
        template_name: tpl.value, blocking: blocking.checked, ai_checks: checks,
      });
      toast('Regole salvate');
      cfgCache = null;
      reload();
    } catch (e) { save.disabled = false; toast(e.message, 'err'); }
  } } }, 'Salva');
  fill(box,
    h('span.hq-accent', { 'aria-hidden': 'true' }),
    h('b.hq-ed-t', t.name),
    h('span.hq-sub', dots([`in ${t.checklists.map(c => c.code.startsWith('R-') || c.code.startsWith('M-') ? c.name : c.code).join(', ')}`, t.uploaded_by_suppliers ? `caricato da ${t.uploaded_by_suppliers} fornitori` : null])),
    fld('Istruzioni per il fornitore', instr),
    h('div.hq-grid2', fld('Validità', rule), monthsBox, fld('Reminder (giorni prima)', notice, 'Es. 30, 15, 7'), fld('Proroga dopo la scadenza (giorni)', grace), fld('Modello da scaricare', tpl)),
    h('label.hq-check', blocking, 'Bloccante per il cantiere'),
    h('div.hq-ai-h', h('span.hq-lbl', 'Controlli dell\'AI'), link('Aggiungi un controllo', { on: { click: () => { checks.push({ text: '', on_fail: 'respingi' }); drawChecks(); checksBox.querySelector('.hq-rule:last-child input')?.focus(); } } })),
    checksBox,
    h('div.hq-ed-f', h('span.hq-sub', 'Cambiare una regola non tocca i documenti già approvati.'), save));
}

function addDoc(cl) {
  const name = input({ autofocus: true, placeholder: 'Es. Certificato antincendio del deposito' });
  const ok = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    try { const r = await post(`/api/hqse/checklists/${cl.id}/docs`, { name: name.value }); m.close(); go(`#/hqse/regole/${cl.id}/${r.doc_type_id}`); } catch (e) { toast(e.message, 'err'); }
  } } }, 'Aggiungi');
  const m = cvModal({ title: `Nuovo documento in ${cl.name}`, body: fld('Nome del documento', name, 'Poi scegli validità, reminder e controlli.'), actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok] });
}

function newChecklist() {
  const name = input({ autofocus: true, placeholder: 'Es. Commessa Hera' });
  const kind = h('select.input', Object.entries(KIND_LABEL).map(([k, l]) => h('option', { value: k }, l)));
  const commesse = input({ placeholder: 'Es. AL 4005, AL 4006 (vuoto = tutti i cantieri)' });
  const ok = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    try {
      const c = await post('/api/hqse/checklists', { name: name.value, kind: kind.value, commesse: commesse.value.split(',').map(x => x.trim()).filter(Boolean) });
      m.close(); cfgCache = null; go(`#/hqse/regole/${c.id}`);
    } catch (e) { toast(e.message, 'err'); }
  } } }, 'Crea');
  const m = cvModal({ title: 'Nuova checklist', body: h('div.hq-form', fld('Nome', name), fld('Di chi', kind), fld('Solo per queste commesse', commesse)), actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok] });
}

// ── portale: chi ci entra e invito (fase 2) ─────────────────────────────────────────────────────
function peopleCard(s) {
  const body = h('div', loading());
  get(`/api/hqse/fornitori/${s.id}/persone`).then(rows => fill(body, rows.length
    ? rows.map(p => h('div.hq-ev', h('span', h('b', p.name || p.email), ` · ${p.role === 'referente' ? 'referente' : p.can_upload ? 'collega' : 'solo vedere'}`),
      h('span.hq-sub', dots([p.email, p.last_login ? `ultimo accesso ${fmtDate(p.last_login)}` : 'non è ancora entrato']))))
    : emptyState('send', 'Nessuno entra ancora nel portale: invita il referente.'))).catch(() => fill(body));
  return card({ title: 'Portale del fornitore', icon: 'users' }, body);
}

function invite(s, reload) {
  const email = input({ type: 'email', autofocus: true, placeholder: 'nome@azienda.it' });
  const name = input({ placeholder: 'Nome e cognome' });
  const ok = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    ok.disabled = true;
    try { await post(`/api/hqse/fornitori/${s.id}/invita`, { email: email.value, name: name.value }); m.close(); toast(`Invito mandato a ${email.value}`); reload(); } catch (e) { ok.disabled = false; toast(e.message, 'err'); }
  } } }, 'Manda l\'invito');
  const m = cvModal({
    title: `Invita ${s.name} al portale`,
    body: h('div.hq-form', fld('Email', email, 'Riceve un link per entrare: niente password. Poi, ogni 30 giorni, un codice via email.'), fld('Nome', name)),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok],
  });
}

// ── Widget del sito (tavola 2) ─────────────────────────────────────────────────────────────────
async function widgetPage(box, cfg) {
  const w = await get('/api/hqse/widget');
  const st = w.settings;
  const titolo = input({ value: st.titolo });
  const testo = h('textarea.input', { rows: 3 }, st.testo);
  const grazie = input({ value: st.grazie });
  const privacy = input({ value: st.privacy_url, placeholder: 'https://www.almacis.it/privacy' });
  const avvisa = input({ value: st.avvisa, placeholder: 'qualifica@almacis.it', type: 'email' });
  const chosen = new Set(st.tipi);
  const tipi = w.tipi.map(t => {
    const ck = h('input', { type: 'checkbox', checked: chosen.has(t.key), on: { change: e => { if (e.target.checked) chosen.add(t.key); else chosen.delete(t.key); } } });
    const cl = cfg.tipi_appalto.find(x => x.key === t.key)?.checklists || [];
    return h('label.hq-wrow', h('span', h('b', t.label), h('span.hq-sub', ` · ${cl.length ? cl.join(' + ') : 'solo anagrafica'}`)), ck);
  });
  const snippet = `<div id="alma-fornitori"></div>\n<script src="${location.origin}/fornitori/widget.js" async></script>`;
  const save = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    save.disabled = true;
    try {
      await put('/api/hqse/widget', { titolo: titolo.value, testo: testo.value, grazie: grazie.value, privacy_url: privacy.value, avvisa: avvisa.value, tipi: [...chosen] });
      toast('Widget aggiornato: sul sito si vede subito');
    } catch (e) { toast(e.message, 'err'); }
    save.disabled = false;
  } } }, 'Pubblica le modifiche');
  fill(box,
    top('Quello che i fornitori', 'vedono sul sito', 'Il widget di registrazione su almacis.it: i testi si cambiano da qui, senza toccare il sito.',
      [h('a.btn', { href: '/fornitori', target: '_blank', rel: 'noopener' }, 'Apri il portale'), save]),
    h('div.hq-two',
      card({ title: 'Testi', icon: 'file-text' },
        h('div.hq-form', fld('Titolo', titolo), fld('Testo di presentazione', testo), fld('Messaggio dopo l\'invio', grazie),
          h('div.cv-fld', h('span', 'Tipi di appalto nel modulo'), h('span.cv-hint', 'Ognuno porta le sue checklist (si cambiano in Checklist e regole)'), h('div.hq-wlist', tipi)),
          fld('Link all\'informativa privacy', privacy))),
      h('div.hq-col',
        card({ title: 'Codice da incollare sul sito', icon: 'file-text' },
          h('p.hq-sub', 'Una volta sola, in un blocco HTML della pagina Fornitori. Poi i testi si cambiano solo da qui.'),
          h('pre.hq-code', snippet),
          h('button.btn', { type: 'button', on: { click: () => navigator.clipboard.writeText(snippet).then(() => toast('Codice copiato')) } }, 'Copia il codice')),
        card({ title: 'Sicurezza e avvisi', icon: 'shield-check' },
          h('div.hq-ev', h('span', 'Siti autorizzati'), h('span.hq-sub', w.origins.join(', '))),
          h('div.hq-ev', h('span', 'Contro i robot'), h('span.hq-sub', 'campo esca nascosto e limite di invii per rete')),
          h('div.hq-ev', h('span', 'Partita IVA già registrata'), h('span.hq-sub', 'manda il link solo se l\'email è di chi entra già nel portale')),
          fld('Avvisa di ogni registrazione', avvisa, 'Un\'email per ogni fornitore nuovo (vuoto = nessuno)')),
        h('section.hq-tiles2',
          h('div.cv-card.hq-tile', h('span.hq-lbl', 'Nuovi in 30 giorni'), h('span.hq-big', String(w.stats?.nuovi ?? 0))),
          h('div.cv-card.hq-tile', h('span.hq-lbl', 'Non sono mai entrati'), h('span.hq-big', String(w.stats?.mai ?? 0)))))));
}
