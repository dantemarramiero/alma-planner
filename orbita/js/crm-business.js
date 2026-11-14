// Nuovi business (canvas «Nuovi business · ingresso in nuove aree d'affari», Dante 14/11/2026):
// elenco delle iniziative e, per ognuna, Chat · Clienti target · Cosa ci manca · Piano · Radar · Riflessioni · Analisi.
import { h, fill, modal, confirmDialog, toast, fmtDate, loading } from './ui.js';
import { get, post, put, patch, del } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';

const PHASES = [['esplorazione', 'Esplorazione'], ['analisi', 'Analisi'], ['piano', 'Piano'], ['ingresso', 'Ingresso'], ['consolidamento', 'Consolidamento']];
const PHASE_KEYS = PHASES.map(([k]) => k);
const TARGET_STATUS = { da_contattare: 'Da contattare', contattato: 'Contattato', incontro: 'Incontro', qualificati: 'Qualificati come fornitori', opportunita: 'Opportunità', scartato: 'Scartato' };
const TARGET_CLASS = { contattato: 'nb-info', incontro: 'nb-warn', qualificati: 'nb-ok', opportunita: 'crm-r-lead', scartato: 'nb-off' };
const GAP_STATUS = { manca: 'manca', in_corso: 'in corso', ce: 'c\'è' };
const GAP_CLASS = { manca: 'nb-red', in_corso: 'nb-warn', ce: 'nb-ok' };
const GAP_KINDS = ['Requisito', 'Qualifica', 'Persone', 'Mezzi e squadre', 'Referenze', 'Certificazioni', 'Processi', 'Altro'];
const HOW_KINDS = { assumere: 'Assumere', formare: 'Formare', partner: 'Partner o ATI', avvalimento: 'Avvalimento', acquisire: 'Acquisire un\'azienda', noleggiare: 'Noleggiare', non_serve: 'Non serve ora' };
const NOTE_KINDS = { ipotesi: 'Ipotesi', decisione: 'Decisione', chat: 'Dalla chat', nota: 'Nota', rischio: 'Rischio' };
const NOTE_CLASS = { decisione: 'nb-dark', ipotesi: 'crm-r-lead', chat: 'nb-info', nota: '', rischio: 'nb-red' };
const TABS = [['chat', 'Chat'], ['clienti', 'Clienti target'], ['gap', 'Cosa ci manca'], ['piano', 'Piano'], ['radar', 'Radar'], ['riflessioni', 'Riflessioni'], ['analisi', 'Analisi']];
const LIGHT = { g: 'Verde', y: 'Giallo', r: 'Rosso', n: 'Spento' };

const day = d => (d ? fmtDate(String(d).slice(0, 10), { year: true }) : '—');
const eur = n => (n === null || n === undefined || n === '' ? '—' : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0, useGrouping: 'always' })} €`);
const eur2 = n => `${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const field = (label, control, hint) => h('label.field', h('span', label), control, hint ? h('small.muted', hint) : null);
const input = (attrs = {}) => h('input.input', attrs);
const select = (options, value, attrs = {}) => h('select.select', attrs, options.map(([k, label]) => h('option', { value: k, selected: String(k) === String(value ?? '') }, label)));
const textarea = (value, attrs = {}) => h('textarea.input', { rows: 3, ...attrs }, value || '');
const userOptions = (none = '—') => [['', none], ...store.users.filter(u => u.active !== false).map(u => [u.id, u.name])];
const card = (title, extra, ...body) => h('section.card.crm-pad', h('div.crm-card-head', h('h3.crm-h3', title), extra || null), ...body);
const empty = text => h('p.small.muted', text);
const dot = c => h('span.nb-dot', { class: `nb-${c}` });
const btn = (label, onClick, { primary = false, small = false, ico = null, disabled = false } = {}) =>
  h(`button.btn${primary ? '.btn-primary' : ''}${small ? '.btn-sm' : ''}`, { type: 'button', disabled, on: { click: onClick } }, ico ? icon(ico, { size: small ? 14 : 15 }) : null, label);
const relDay = d => {
  if (!d) return '—';
  const n = Math.round((Date.parse(`${new Date().toLocaleDateString('sv-SE')}T12:00:00Z`) - Date.parse(`${String(d).slice(0, 10)}T12:00:00Z`)) / 86400000);
  return n <= 0 ? 'oggi' : n === 1 ? 'ieri' : n < 14 ? `${n} giorni fa` : day(d);
};

// fasi a pillole, come nel canvas
function phasePills(phase, { small = false } = {}) {
  if (phase === 'abbandonata') return h('span.pill.nb-off', 'Abbandonata');
  const on = PHASE_KEYS.indexOf(phase);
  return h('div.nb-ph', { class: small ? 'sm' : '' }, PHASES.map(([, label], i) => h('span', { class: i < on ? 'done' : i === on ? 'on' : '' }, label)));
}

// testo dell'assistente: righe «- » diventano elenco, **grassetto**
function richText(text) {
  const inline = line => line.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? h('b', part) : part));
  const out = [];
  let list = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    if (/^\s*[-•]\s+/.test(line)) {
      if (!list) { list = h('ul'); out.push(list); }
      list.append(h('li', inline(line.replace(/^\s*[-•]\s+/, ''))));
    } else {
      list = null;
      if (line.trim()) out.push(h('p', inline(line)));
    }
  }
  return out;
}

// ── elenco ────────────────────────────────────────────────────────────────────────────────────
export async function businessView(container, parts = [], crmData = {}) {
  const id = Number(parts[0]);
  if (id) return initiativePage(container, id, parts[1] || 'chat', crmData);
  fill(container, loading());
  const d = await get('/api/crm/business');
  const k = d.kpis;
  const kpi = (n, label, warn) => h('div.crm-wk-kpi', { class: warn ? 'warn' : '' }, h('strong', String(n)), h('span', label));
  const row = i => h('a.nb-ini', { href: `#/crm/business/${i.id}` },
    h('div', h('div.crm-line-t', i.name), i.description ? h('div.t-meta', i.description) : null, h('div.nb-ph-inline', phasePills(i.phase, { small: true }))),
    h('div.small.nb-who', icon('user', { size: 14 }), i.owner_name || '—'),
    h('div', phasePills(i.phase, { small: true })),
    h('div', h('div.small', i.gaps.total ? `${i.gaps.ok} di ${i.gaps.total} colmati` : 'da analizzare'), h('div.nb-bar', h('i', { style: { width: `${i.gaps.total ? Math.round(i.gaps.ok / i.gaps.total * 100) : 0}%` } }))),
    h('div.small', `${i.funnel.contattati} / ${i.funnel.individuati}`),
    h('div.small', h('div.nb-who', dot(i.light.color), relDay(i.lastActivity)),
      i.phase === 'abbandonata' ? h('div.t-meta', i.abandoned_reason ? `abbandonata: ${i.abandoned_reason}` : 'abbandonata')
        : i.light.reasons.filter(r => r.c !== 'g')[0] ? h('div.t-meta', i.light.reasons.filter(r => r.c !== 'g')[0].t) : null),
    h('span.muted', icon('chevron-left', { size: 14 })));
  fill(container,
    h('div.page-head', h('div', h('div.en-eyebrow', 'Alma CRM · Strategia commerciale'), h('h1', 'Nuovi business'),
      h('div.sub', 'Le aree d\'affari in cui stiamo provando a entrare: chi le segue, a che punto sono, cosa ci manca.')),
    h('div.crm-actions', btn('Chiedi all\'assistente un\'idea', () => ideaDialog(d.ai), { ico: 'lightbulb' }), btn('Nuova iniziativa', () => initiativeForm({ asa: crmData.asa || [], onSaved: x => { location.hash = `#/crm/business/${x.id}`; } }), { primary: true, ico: 'plus' }))),
    h('div.crm-wk-kpis', kpi(k.open, 'iniziative aperte'), kpi(k.targets, 'clienti target individuati'), kpi(k.contacted, 'già contattati'),
      kpi(k.lateGates, k.lateGates === 1 ? 'gate scaduto, da decidere' : 'gate scaduti, da decidere', k.lateGates > 0), kpi(eur(k.spent), `spesi su ${eur(k.budget)} di budget`)),
    h('section.card.crm-pad.nb-list',
      h('div.nb-ini.nb-head', ['Iniziativa', 'Responsabile', 'Fase', 'Cosa ci manca', 'Clienti contattati', 'Ultima attività', ''].map(x => h('span', x))),
      d.initiatives.length ? d.initiatives.map(row) : empty('Nessuna iniziativa. Con «Nuova iniziativa» apri un\'area d\'affari da esplorare, oppure chiedi un\'idea all\'assistente.')));
}

function initiativeForm({ initiative = null, asa = [], onSaved }) {
  const i = initiative || {};
  const name = input({ value: i.name || '', placeholder: 'Es. Reti elettriche MT/BT' });
  const desc = textarea(i.description, { placeholder: 'Che cosa vorremmo fare, per chi' });
  const owner = select(userOptions('Scegli…'), i.owner_id || '');
  const sponsor = select(userOptions(), i.sponsor_id || (initiative ? '' : store.me.id));
  const asaSel = select([['', '—'], ...asa.map(a => [a.key, a.label])], i.asa || '');
  const budget = input({ value: i.budget_eur ? String(Number(i.budget_eur)) : '', inputmode: 'decimal', placeholder: '25.000' });
  const spent = input({ value: i.spent_eur ? String(Number(i.spent_eur)) : '', inputmode: 'decimal' });
  const started = input({ type: 'date', value: i.started_on || '' });
  const periods = PHASES.map(([k, label]) => [k, input({ value: i.periods?.[k] || '', placeholder: label === 'Esplorazione' ? 'ott – nov 2026' : '' })]);
  const m = modal({
    title: initiative ? 'Modifica l\'iniziativa' : 'Nuova iniziativa',
    body: h('div.en-form',
      field('Nome', name), field('Descrizione', desc),
      h('div.nb-2', field('Responsabile', owner), field('Sponsor della direzione', sponsor)),
      h('div.nb-2', field('ASA dei nuovi lead', asaSel, 'Le aziende target aggiunte al CRM come lead prendono questa ASA.'), field('Budget', budget, 'In euro, per tutta l\'iniziativa.')),
      initiative ? h('div.nb-2', field('Spese scritte a mano', spent, 'Consulenze, corsi… L\'assistente si somma da solo.'), field('Avviata il', started)) : null,
      initiative ? h('div', h('div.crm-h3', 'Quando si fa ogni fase'), h('div.nb-5', periods.map(([k, el]) => field(PHASES.find(p => p[0] === k)[1], el)))) : null),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const body = { name: name.value, description: desc.value, owner_id: Number(owner.value) || null, sponsor_id: Number(sponsor.value) || null, asa: asaSel.value || null, budget_eur: budget.value };
      if (initiative) Object.assign(body, { spent_eur: spent.value, started_on: started.value || undefined, periods: Object.fromEntries(periods.map(([k, el]) => [k, el.value])) });
      const out = initiative ? await patch(`/api/crm/business/${i.id}`, body) : await post('/api/crm/business', body);
      m.close();
      toast(initiative ? 'Salvata' : 'Iniziativa aperta');
      onSaved?.(out);
    } } }, initiative ? 'Salva' : 'Apri l\'iniziativa')],
  });
}

// «Chiedi all'assistente un'idea»: una chat senza iniziativa
function ideaDialog(ai) {
  const box = h('div.nb-msgs', h('p.small.muted', 'L\'assistente conosce le BU, le SOA e il CRM di Almacis e cerca in rete. Chiedi in quali aree d\'affari vicine a quello che facciamo potremmo entrare.'));
  const q = textarea('', { rows: 2, placeholder: 'Es. Quali nuovi mercati vicini alle reti gas e idriche potremmo provare nel 2027?' });
  const send = async () => {
    if (!q.value.trim()) return;
    const text = q.value;
    q.value = '';
    box.append(bubble({ role: 'user', body: text }));
    const wait = h('div', loading());
    box.append(wait);
    try { box.append(bubble(await post('/api/crm/business/idea', { question: text }))); } finally { wait.remove(); }
  };
  modal({ title: 'Chiedi all\'assistente un\'idea', wide: true, body: h('div.nb-idea', box, ai ? h('div.nb-composer', q, btn('Invia', send, { primary: true, ico: 'message' })) : empty('L\'assistente si accende quando su Railway c\'è OPENAI_API_KEY.')) });
}

// ── iniziativa ────────────────────────────────────────────────────────────────────────────────
async function initiativePage(container, id, tabKey, crmData) {
  fill(container, loading());
  const i = await get(`/api/crm/business/${id}`);
  const tab = TABS.some(([k]) => k === tabKey) ? tabKey : 'chat';
  const go = (k, extra) => { history.replaceState(null, '', `#/crm/business/${id}/${k}`); initiativePage(container, id, k, { ...crmData, ...extra }); };
  const refresh = () => initiativePage(container, id, tab, crmData);
  const body = h('div');
  const extra = h('div.crm-actions');
  const more = h('div.crm-more');
  if (crmData.admin) more.append(h('button.btn.btn-ghost.danger', { type: 'button', on: { click: async () => {
    if (!await confirmDialog(`Eliminare «${i.name}» con chat, clienti target, gap e riflessioni? Per chiuderla e tenerne la storia usa «Abbandona» al gate.`, { ok: 'Elimina', danger: true })) return;
    await del(`/api/crm/business/${id}`);
    location.hash = '#/crm/business';
  } } }, 'Elimina'));
  const gateLate = i.gate?.late;
  const lightReason = i.light.reasons.find(r => r.c === i.light.color && r.c !== 'g');
  const label = (name, n) => [name, n ? h('span.muted', ` ${n}`) : null];
  const tabs = TABS.map(([k, l]) => [k, k === 'gap' ? label(l, i.gaps.total ? `${i.gaps.ok}/${i.gaps.total}` : '') : k === 'clienti' ? label(l, i.funnel.individuati || '') : l]);
  fill(container,
    h('nav.pj-top', { 'aria-label': 'Percorso' }, h('a.pj-crumb', { href: '#/crm/business' }, icon('chevron-left', { size: 16 }), 'Nuovi business')),
    h('div.page-head.crm-head',
      h('div', h('div.en-eyebrow', ['Nuovo business', `avviato il ${day(i.started_on)}`, i.sponsor_name && `sponsor ${i.sponsor_name}`].filter(Boolean).join(' · ')), h('h1', i.name),
        h('div.nb-headrow', phasePills(i.phase), h('span.small.nb-who', icon('user', { size: 14 }), `${i.owner_name || '—'} · responsabile`),
          h('span.small.nb-who', dot(i.light.color), i.phase === 'abbandonata' ? 'abbandonata' : gateLate ? `in ritardo sul gate G${i.gate.n}` : lightReason ? lightReason.t : 'tutto in regola'))),
      h('div.crm-actions', extra,
        i.canEdit ? btn('Modifica', () => initiativeForm({ initiative: i, asa: crmData.asa || [], onSaved: refresh }), { ico: 'pencil' }) : null,
        more.childElementCount ? h('details.crm-menu', h('summary.btn.btn-ghost', { 'aria-label': 'Altro' }, icon('more', { size: 16 })), more) : null)),
    h('nav.profile-tabs.crm-tabs.nb-tabs', { role: 'tablist' }, tabs.map(([k, l]) => h('button', { type: 'button', role: 'tab', class: k === tab ? 'on' : '', 'aria-selected': String(k === tab), on: { click: () => go(k) } }, l))),
    body);
  body.append(loading());
  const ctx = { i, id, body, extra, refresh, go, crmData, ask: q => go('chat', { ask: q }) };
  const fn = { chat: chatTab, clienti: targetsTab, gap: gapsTab, piano: planTab, radar: radarTab, riflessioni: notesTab, analisi: analysisTab }[tab];
  await fn(ctx);
}

// ── chat ──────────────────────────────────────────────────────────────────────────────────────
function bubble(m, { onApply, canEdit = false } = {}) {
  if (m.role === 'user') return h('div.nb-msg.me', h('span.nb-who-ico', (m.author_name || store.me.name || '?').split(' ').map(x => x[0]).slice(0, 2).join('')), h('div.nb-bubble', m.body));
  const p = m.proposals || {};
  const used = m.used || {};
  const act = (what, labelText, n) => (n === 0 ? null : btn(used[what] !== undefined ? `${labelText} · fatto` : labelText, () => onApply?.(m, what), { small: true, disabled: !canEdit || used[what] !== undefined, ico: what === 'note' ? 'file-text' : what === 'steps' ? 'clock' : 'plus' }));
  return h('div.nb-msg.ai', h('span.nb-who-ico.ai', icon('lightbulb', { size: 15 })),
    h('div.grow',
      h('div.nb-bubble', richText(m.body),
        m.sources?.length || m.crm?.length ? h('div.nb-srcs',
          (m.sources || []).map(s => h('a.nb-src', { href: s.url, target: '_blank', rel: 'noopener' }, icon('link', { size: 12 }), s.title)),
          (m.crm || []).map(s => h('a.nb-src', { href: `#/crm/scheda/${s.subject_id}` }, icon('link', { size: 12 }), `CRM · ${s.name}`))) : null),
      onApply ? h('div.nb-acts',
        act('note', 'Salva come riflessione'),
        p.targets?.length ? act('targets', `Aggiungi ${p.targets.length} ai clienti target`) : null,
        p.gaps?.length ? act('gaps', `Aggiungi ${p.gaps.length} ai gap`) : null,
        p.steps?.length ? act('steps', p.steps.length === 1 ? `Crea passo: ${p.steps[0].title}` : `Crea ${p.steps.length} passi`) : null,
        p.plan?.length ? act('plan', 'Usa come piano d\'ingresso') : null) : null,
      m.cost_eur ? h('div.t-meta', `costo ${eur2(m.cost_eur)}`) : null));
}

async function applyDialog(m, what, done) {
  const p = m.proposals || {};
  const list = what === 'targets' ? p.targets : what === 'gaps' ? p.gaps : what === 'steps' ? p.steps : null;
  if (!list || list.length === 1) {
    const out = await post(`/api/crm/business/messages/${m.id}/apply`, { what });
    toast(what === 'note' ? 'Salvata nelle riflessioni' : out.added ? `Aggiunti ${out.added}` : 'Erano già presenti');
    return done();
  }
  const checks = list.map(() => h('input', { type: 'checkbox', checked: true }));
  const line = (x, k) => h('label.nb-pick', checks[k], h('div', h('div.crm-line-t', x.name || x.title), h('div.t-meta', x.why || x.how || x.segment || (x.days ? `entro ${x.days} giorni` : ''))));
  const md = modal({
    title: { targets: 'Aggiungi ai clienti target', gaps: 'Aggiungi a «Cosa ci manca»', steps: 'Crea i passi' }[what],
    body: h('div.nb-picks', list.map(line)),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const indexes = checks.map((c, k) => (c.checked ? k : null)).filter(x => x !== null);
      if (!indexes.length) return toast('Scegli almeno una voce', 'err');
      const out = await post(`/api/crm/business/messages/${m.id}/apply`, { what, indexes });
      md.close();
      toast(out.added ? `Aggiunti ${out.added}` : 'Erano già presenti');
      done();
    } } }, 'Aggiungi')],
  });
}

const CHIPS = ['Chi sono i concorrenti in zona?', 'Chi possono essere i primi clienti?', 'Cosa ci manca per qualificarci?', 'Prepara il piano d\'ingresso', 'Riassumi cosa ha fatto il responsabile questo mese'];
async function chatTab({ i, id, body, crmData, refresh }) {
  const d = await get(`/api/crm/business/${id}/messages`);
  const list = h('div.nb-msgs');
  const draw = () => {
    list.replaceChildren(...(d.messages.length ? d.messages.map(m => bubble(m, { canEdit: i.canEdit, onApply: (msg, what) => applyDialog(msg, what, refresh) }))
      : [empty('Fai una domanda: clienti possibili, concorrenti, requisiti per qualificarsi, costi e tempi. Ogni risposta si può salvare come riflessione o trasformare in clienti target, gap e passi.')]));
  };
  draw();
  const q = textarea('', { rows: 2, placeholder: 'Scrivi una domanda: clienti, concorrenti, requisiti, costi, tempi…' });
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); });
  let busy = false;
  async function send(text = q.value) {
    if (!text.trim() || busy) return;
    busy = true;
    q.value = '';
    if (!d.messages.length) list.replaceChildren();
    list.append(bubble({ role: 'user', body: text, author_name: store.me.name }));
    const wait = h('div.nb-wait', loading(), h('span.small.muted', 'L\'assistente sta cercando…'));
    list.append(wait);
    wait.scrollIntoView({ block: 'nearest' });
    try {
      await post(`/api/crm/business/${id}/messages`, { question: text });
      await refresh();
    } catch { wait.remove(); q.value = text; } finally { busy = false; }
  }
  const synergies = [];
  const seen = new Set();
  for (const m of d.messages) for (const s of m.crm || []) if (!seen.has(s.subject_id)) { seen.add(s.subject_id); synergies.push(s); }
  fill(body, h('div.nb-chatgrid',
    h('section.card.crm-pad.nb-chat', list,
      d.ai ? [h('div.nb-composer', q, btn('Invia', () => send(), { primary: true, ico: 'message' })),
        h('div.nb-chips', CHIPS.map(c => h('button.nb-chip', { type: 'button', on: { click: () => send(c) } }, c)))]
        : h('div.crm-filterbar', icon('alert-triangle', { size: 15 }), h('span', 'L\'assistente si accende quando su Railway c\'è OPENAI_API_KEY.'))),
    h('div.crm-side',
      card('Cosa sa l\'assistente', null, h('div.crm-lines', [
        ['Almacis', 'BU, categorie SOA e lavori tipici dai profili del radar'], ['CRM', 'clienti, partner e fornitori con le loro SOA; contatti, incontri ed email collegati'],
        ['Questa iniziativa', 'clienti target, cosa ci manca, passi, riflessioni salvate'], ['Ricerca in rete', 'notizie, piani di sviluppo, albi, bilanci · sempre con la fonte']]
        .map(([t, s]) => h('div.crm-line', h('span.crm-ico.note', icon('file-text', { size: 15 })), h('div.grow', h('div.crm-line-t', t), h('div.t-meta', s)))))),
      card('Sinergie trovate in questa chat', null, synergies.length ? h('div', synergies.map(s => h('div.nb-syn', h('span.nb-tag', 'sinergia'),
        h('div.grow', h('a.crm-line-t', { href: `#/crm/scheda/${s.subject_id}` }, `${s.name}${s.roles?.length ? ` · ${s.roles.join(', ')}` : ''}`), h('div.t-meta', s.synergies.join(' · ')))))) : empty('Quando l\'assistente cita aziende già nel CRM, qui trovi chi le conosce e come.')),
      h('section.card.crm-pad.small.muted', 'Costo della chat questo mese: ', h('b', eur2(d.monthCost)), ' · conta nel budget dell\'iniziativa'))));
  if (crmData.ask) { const a = crmData.ask; delete crmData.ask; send(a); }
}

// ── clienti target ───────────────────────────────────────────────────────────────────────────
function targetForm(i, t, done) {
  const name = input({ value: t?.name || '' });
  const segment = input({ value: t?.segment || '', placeholder: 'Distributore, Industria, Comune…' });
  const why = textarea(t?.why, { rows: 2 });
  const prio = select([['alta', 'alta'], ['media', 'media'], ['bassa', 'bassa']], t?.priority || 'media');
  const status = select(Object.entries(TARGET_STATUS), t?.status || 'da_contattare');
  const note = textarea(t?.note, { rows: 2 });
  const m = modal({
    title: t ? t.name : 'Aggiungi cliente target',
    body: h('div.en-form', field('Azienda o ente', name, t ? null : 'Se è già nel CRM la collego da sola.'), field('Segmento', segment), field('Perché', why), h('div.nb-2', field('Priorità', prio), field('Stato', status)), field('Nota', note)),
    left: t ? [h('button.btn.btn-ghost.danger', { type: 'button', on: { click: async () => { if (!await confirmDialog(`Togliere «${t.name}» dai clienti target?`, { ok: 'Togli', danger: true })) return; await del(`/api/crm/business/targets/${t.id}`); m.close(); done(); } } }, 'Togli')] : [],
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const b = { name: name.value, segment: segment.value, why: why.value, priority: prio.value, status: status.value, note: note.value };
      if (t) await patch(`/api/crm/business/targets/${t.id}`, b); else await post(`/api/crm/business/${i.id}/targets`, b);
      m.close();
      done();
    } } }, 'Salva')],
  });
}
async function targetsTab({ i, id, body, extra, refresh, ask }) {
  if (i.canEdit) extra.prepend(btn('Trova altri clienti', () => ask('Trova altri clienti possibili per questa iniziativa, diversi da quelli già nella lista.'), { ico: 'lightbulb' }),
    btn('Aggiungi cliente target', () => targetForm(i, null, refresh), { primary: true, ico: 'plus' }));
  const d = await get(`/api/crm/business/${id}/targets`);
  const segs = {};
  for (const t of d.targets) segs[t.segment || 'Altro'] = (segs[t.segment || 'Altro'] || 0) + 1;
  let filter = '';
  const table = h('div');
  const f = i.funnel;
  const draw = () => {
    const rows = d.targets.filter(t => !filter || (t.segment || 'Altro') === filter);
    table.replaceChildren(rows.length ? h('div.nb-scroll', h('table.list.nb-table.nb-targets', h('thead', h('tr', ['Azienda', 'Perché', 'Priorità', 'Stato', 'Sinergie dal CRM', ''].map(x => h('th', x)))),
      h('tbody', rows.map(t => h('tr', { on: { click: e => { if (!e.target.closest('button,select,a') && i.canEdit) targetForm(i, t, refresh); } } },
        h('td', h('div.crm-line-t', t.name), t.segment ? h('div.t-meta', t.segment) : null),
        h('td.small', t.why || '—'),
        h('td', h('span.pill', { class: t.priority === 'alta' ? 'crm-r-lead' : '' }, t.priority)),
        h('td', i.canEdit ? select(Object.entries(TARGET_STATUS), t.status, { class: `nb-status ${TARGET_CLASS[t.status] || ''}`, 'aria-label': 'Stato', on: { change: async e => { await patch(`/api/crm/business/targets/${t.id}`, { status: e.target.value }); refresh(); } } })
          : h('span.pill', { class: TARGET_CLASS[t.status] || '' }, TARGET_STATUS[t.status])),
        h('td.nb-syncol', t.synergies.length ? t.synergies.map(x => h('div.nb-syn', h('span.nb-tag', 'sinergia'), h('span.small.grow', x))) : h('span.small.muted', 'nessuna: non è nel CRM')),
        h('td', t.subject_id ? h('a.small.nb-who', { href: `#/crm/scheda/${t.subject_id}` }, icon('link', { size: 13 }), 'scheda CRM')
          : i.canEdit ? btn('Aggiungi al CRM come lead', async () => { const out = await post(`/api/crm/business/targets/${t.id}/lead`, {}); toast(out.existed ? 'Collegata all\'azienda già nel CRM' : 'Lead creato nel CRM'); refresh(); }, { small: true }) : null)))))) : empty('Nessun cliente target. Chiedili all\'assistente nella chat o aggiungili a mano.'));
  };
  draw();
  fill(body,
    h('div.nb-toolbar', h('div.nb-chips', [['', `Tutti ${d.targets.length}`], ...Object.entries(segs).map(([s, n]) => [s, `${s} ${n}`])].map(([k, l]) => h('button.nb-chip', { type: 'button', class: k === filter ? 'on' : '', on: { click: e => { filter = k; e.target.parentNode.querySelectorAll('.nb-chip').forEach(c => c.classList.toggle('on', c === e.target)); draw(); } } }, l))),
      h('span.grow'), h('span.small.muted', `${f.contattati} contattati · ${f.incontrati} incontri · ${f.qualificati} qualificati · ${f.opportunita} opportunità`)),
    h('section.card.crm-pad', table),
    h('div.crm-filterbar.nb-banner', icon('bell', { size: 15 }), h('span', 'Quando un cliente target diventa lead del CRM ha come owner il responsabile dell\'iniziativa: email, incontri e note su di lui contano nell\'analisi.')));
}

// ── cosa ci manca ─────────────────────────────────────────────────────────────────────────────
function gapForm(i, g, done) {
  const title = input({ value: g?.title || '' });
  const kind = select([['', '—'], ...GAP_KINDS.map(k => [k, k])], g?.kind || '');
  const status = select(Object.entries(GAP_STATUS), g?.status || 'manca');
  const howKind = select([['', '—'], ...Object.entries(HOW_KINDS)], g?.how_kind || '');
  const how = textarea(g?.how, { rows: 2 });
  const cost = input({ value: g?.cost_eur ? String(Number(g.cost_eur)) : '', inputmode: 'decimal' });
  const timing = input({ value: g?.timing || '', placeholder: '3 mesi' });
  const who = input({ value: g?.who || '', placeholder: 'Persona o ufficio' });
  const m = modal({
    title: g ? g.title : 'Aggiungi requisito',
    body: h('div.en-form', field('Requisito', title), h('div.nb-2', field('Tipo', kind), field('Stato', status)), h('div.nb-2', field('Come colmarlo', howKind), field('Chi', who)), field('Dettagli', how), h('div.nb-2', field('Costo stimato', cost), field('Tempi', timing))),
    left: g ? [h('button.btn.btn-ghost.danger', { type: 'button', on: { click: async () => { await del(`/api/crm/business/gaps/${g.id}`); m.close(); done(); } } }, 'Togli')] : [],
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const b = { title: title.value, kind: kind.value, status: status.value, how_kind: howKind.value, how: how.value, cost_eur: cost.value, timing: timing.value, who: who.value };
      if (g) await patch(`/api/crm/business/gaps/${g.id}`, b); else await post(`/api/crm/business/${i.id}/gaps`, b);
      m.close();
      done();
    } } }, 'Salva')],
  });
}
async function gapsTab({ i, id, body, extra, refresh, ask }) {
  if (i.canEdit) extra.prepend(btn('Rifai l\'analisi', () => ask('Rifai l\'analisi di cosa ci manca per entrare in questo business: requisiti, qualifiche, persone, mezzi, referenze, certificazioni, con come colmarli, costi e tempi.'), { ico: 'lightbulb' }),
    btn('Aggiungi requisito', () => gapForm(i, null, refresh), { primary: true, ico: 'plus' }));
  const { gaps } = await get(`/api/crm/business/${id}/gaps`);
  const ok = gaps.filter(g => g.status === 'ce').length;
  const missing = gaps.filter(g => g.status === 'manca').length;
  const doing = gaps.filter(g => g.status === 'in_corso').length;
  const cost = gaps.filter(g => g.status !== 'ce').reduce((s, g) => s + Number(g.cost_eur || 0), 0);
  const kpi = (n, l, warn, bar) => h('div.crm-wk-kpi', { class: warn ? 'warn' : '' }, h('strong', n), h('span', l), bar);
  fill(body,
    h('div.nb-kpi4', kpi(`${ok} / ${gaps.length}`, 'requisiti già a posto', false, h('div.nb-bar', h('i', { style: { width: `${gaps.length ? Math.round(ok / gaps.length * 100) : 0}%` } }))),
      kpi(String(missing), 'mancano', missing > 0), kpi(String(doing), 'in corso'), kpi(eur(cost), 'costo stimato per colmarli')),
    h('section.card.crm-pad', gaps.length ? h('div.nb-scroll', h('table.list.nb-table', h('thead', h('tr', ['Requisito', 'Tipo', 'Stato', 'Come colmarlo', 'Costo', 'Tempi', 'Chi'].map(x => h('th', x)))),
      h('tbody', gaps.map(g => h('tr', { on: { click: e => { if (!e.target.closest('select') && i.canEdit) gapForm(i, g, refresh); } } },
        h('td.crm-line-t', g.title), h('td.small', g.kind || '—'),
        h('td', i.canEdit ? select(Object.entries(GAP_STATUS), g.status, { class: `nb-status ${GAP_CLASS[g.status]}`, 'aria-label': 'Stato', on: { change: async e => { await patch(`/api/crm/business/gaps/${g.id}`, { status: e.target.value }); refresh(); } } }) : h('span.pill', { class: GAP_CLASS[g.status] }, GAP_STATUS[g.status])),
        h('td.small', [g.how_kind ? h('b', `${HOW_KINDS[g.how_kind]}. `) : null, g.how || (g.how_kind ? '' : '—')]),
        h('td.small.nb-num', g.cost_eur ? eur(g.cost_eur) : '—'), h('td.small', g.timing || '—'), h('td.small', g.who || '—')))))) : empty('Nessun requisito. Chiedi all\'assistente «Cosa ci manca per qualificarci?» o aggiungili a mano.')),
    h('p.small.muted', `Come colmarlo si sceglie tra: ${Object.values(HOW_KINDS).join(' · ')}.`));
}

// ── piano d'ingresso ──────────────────────────────────────────────────────────────────────────
function taskForm(i, t, done, phase) {
  const title = input({ value: t?.title || '' });
  const ph = select(PHASES, t?.phase || phase || (PHASE_KEYS.includes(i.phase) ? i.phase : 'esplorazione'));
  const owner = select(userOptions(), t ? t.owner_id || '' : i.owner_id || '');
  const due = input({ type: 'date', value: t?.due_date || '' });
  const m = modal({
    title: t ? 'Passo' : 'Nuovo passo',
    body: h('div.en-form', field('Cosa fare', title), h('div.nb-2', field('Fase', ph), field('Chi lo fa', owner)), field('Entro quando', due, 'Con la data diventa un prossimo passo: se scade compare il «!».')),
    left: t ? [h('button.btn.btn-ghost.danger', { type: 'button', on: { click: async () => { await del(`/api/crm/business/tasks/${t.id}`); m.close(); done(); } } }, 'Togli')] : [],
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const b = { title: title.value, phase: ph.value, owner_id: Number(owner.value) || null, due_date: due.value || null };
      if (t) await patch(`/api/crm/business/tasks/${t.id}`, b); else await post(`/api/crm/business/${i.id}/tasks`, b);
      m.close();
      done();
    } } }, 'Salva')],
  });
}
function taskRow(i, t, refresh, { showPhase = false } = {}) {
  return h('div.crm-step', { class: t.late ? 'late' : '' },
    h('button.crm-step-check', { type: 'button', class: t.done_at ? 'done' : '', 'aria-label': t.done_at ? 'Riapri' : 'Fatto', disabled: !i.canEdit, on: { click: async () => { await patch(`/api/crm/business/tasks/${t.id}`, { done: !t.done_at }); refresh(); } } }, icon('check', { size: 14 })),
    h('div.grow', h('div.crm-line-t', { class: t.done_at ? 'nb-done' : '' }, t.title, t.late ? h('span.crm-bang', '!') : null), h('div.t-meta', [t.owner_name || 'senza responsabile', showPhase ? PHASES.find(p => p[0] === t.phase)?.[1] : null].filter(Boolean).join(' · '))),
    h('span.crm-step-date', { class: t.late ? 'due-late' : '' }, t.done_at ? `fatto ${day(t.done_at)}` : t.due_date ? (t.late ? `scaduto ${day(t.due_date)}` : day(t.due_date)) : 'senza data'),
    i.canEdit ? h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Modifica', on: { click: () => taskForm(i, t, refresh) } }, icon('pencil', { size: 14 })) : null);
}
function gateDialog(i, g, decision, done) {
  const note = textarea('', { rows: 3, placeholder: decision === 'prosegui' ? 'Facoltativo: budget, condizioni…' : 'Perché' });
  const due = input({ type: 'date' });
  const m = modal({
    title: `Gate G${g.n} · ${{ prosegui: 'Prosegui', rimanda: 'Rimanda', abbandona: 'Abbandona' }[decision]}`,
    body: h('div.en-form', h('p', `«${g.question}»`), field(decision === 'prosegui' ? 'Nota' : 'Perché', note), decision === 'rimanda' ? field('Nuova data del gate', due) : null,
      h('p.small.muted', 'La decisione resta nelle riflessioni con chi l\'ha presa e perché.')),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      await post(`/api/crm/business/${i.id}/gates/${g.n}/decide`, { decision, note: note.value, due_date: due.value || undefined });
      m.close();
      toast('Decisione salvata');
      done();
    } } }, 'Conferma')],
  });
}
function gateEdit(i, g, done) {
  const q = input({ value: g.question || '' });
  const due = input({ type: 'date', value: g.due_date || '' });
  const m = modal({ title: `Gate G${g.n}`, body: h('div.en-form', field('Domanda per la direzione', q), field('Data', due)),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await patch(`/api/crm/business/${i.id}/gates/${g.n}`, { question: q.value, due_date: due.value || null }); m.close(); done(); } } }, 'Salva')] });
}
async function planTab({ i, id, body, extra, refresh, ask }) {
  if (i.canEdit) extra.prepend(btn('Rigenera il piano', () => ask('Prepara il piano d\'ingresso per fasi (esplorazione, analisi, piano, ingresso, consolidamento) con periodi, passi e la domanda del gate alla fine di ogni fase.'), { ico: 'lightbulb' }),
    btn('Aggiungi passo', () => taskForm(i, null, refresh), { primary: true, ico: 'plus' }));
  const { tasks } = await get(`/api/crm/business/${id}/tasks`);
  const cur = PHASE_KEYS.indexOf(i.phase);
  const today = new Date().toLocaleDateString('sv-SE');
  // linea del tempo: i gate con la data, «oggi» in proporzione
  // gate a distanza fissa come nel canvas; «oggi» in proporzione tra le date dei gate (decisione o scadenza)
  const gateX = g => 6 + g.n * 22;
  const when = g => (g.decided_at ? String(g.decided_at).slice(0, 10) : g.due_date);
  const pts = [[i.started_on, 1], ...i.gates.filter(when).map(g => [when(g), gateX(g)])].sort((x, y) => (x[0] < y[0] ? -1 : 1));
  const pos = d => {
    for (let k = 1; k < pts.length; k++) if (d <= pts[k][0]) { const [d0, x0] = pts[k - 1]; const [d1, x1] = pts[k]; return x0 + (x1 - x0) * Math.max(0, Date.parse(d) - Date.parse(d0)) / Math.max(1, Date.parse(d1) - Date.parse(d0)); }
    return Math.min(97, pts.at(-1)[1] + 3);
  };
  const timeline = h('div.nb-tl', h('div.nb-ax'),
    i.gates.map(g => [h('span.nb-m', { class: g.decision === 'prosegui' ? 'done' : g.n === cur && i.phase !== 'abbandonata' ? (g.due_date && g.due_date < today ? 'late' : 'gate') : '', style: { left: `${gateX(g)}%` } }),
      h('span.nb-lt', { style: { left: `${gateX(g)}%` } }, `G${g.n}`),
      h('span.nb-lb', { style: { left: `${gateX(g)}%` } }, g.decision ? `${day(g.decided_at)}` : g.due_date ? `${day(g.due_date)}${g.due_date < today && g.n === cur ? ' · scaduto' : ''}` : 'da fissare')]),
    h('span.nb-m.today', { style: { left: `${pos(today)}%` } }), i.gates.some(g => Math.abs(gateX(g) - pos(today)) < 5) ? null : h('span.nb-lb.today', { style: { left: `${pos(today)}%` } }, 'oggi'));
  const phaseCard = ([k, label], n) => {
    const g = i.gates.find(x => x.n === n);
    const list = tasks.filter(t => t.phase === k);
    const state = i.phase === 'abbandonata' ? '' : n < cur ? 'fatta' : n === cur ? 'in corso' : '';
    return h('div.nb-phase', { class: n === cur ? 'on' : '' },
      h('div.nb-phase-h', h('span.crm-line-t', `${n + 1} · ${label}`), state ? h('span.pill', { class: state === 'fatta' ? 'nb-ok' : 'crm-r-lead' }, state) : null),
      h('div.t-meta', i.periods?.[k] || '—'),
      list.length ? list.slice(0, 6).map((t, x) => h('div.nb-pstep', h('span.nb-sn', { class: t.done_at ? 'done' : t.late ? 'late' : '' }, t.done_at ? icon('check', { size: 11 }) : t.late ? '!' : String(x + 1)), h('span.small', t.title))) : h('span.small.muted', 'nessun passo'),
      list.length > 6 ? h('span.t-meta', `e altri ${list.length - 6}`) : null,
      g ? h('button.nb-gate', { type: 'button', disabled: !i.canEdit, on: { click: () => gateEdit(i, g, refresh) } }, h('span', '◆'),
        h('div', h('b', `G${g.n} · ${g.question}`), h('div.nb-gate-d', g.decision ? `${{ prosegui: 'approvato', abbandona: 'abbandonata', rimanda: 'rimandato' }[g.decision]} ${day(g.decided_at)}` : g.due_date ? `${g.due_date < today && n === cur ? 'scaduto il ' : ''}${day(g.due_date)}` : 'data da fissare'))) : null);
  };
  const curTasks = tasks.filter(t => t.phase === i.phase);
  const g = i.gate;
  fill(body,
    card('Linea del tempo', null, timeline),
    h('div.nb-phases', PHASES.map(phaseCard)),
    h('div.crm-grid',
      card(i.phase === 'abbandonata' ? 'Passi' : `Passi della fase ${PHASES[cur]?.[1] || ''} · diventano prossimi passi`, null,
        curTasks.length ? h('div.crm-steplist', curTasks.map(t => taskRow(i, t, refresh))) : empty('Nessun passo in questa fase. Aggiungili a mano o dalla chat («Crea passo»).')),
      g && i.phase !== 'abbandonata' ? h('section.nb-gatebox',
        h('b', `Gate G${g.n} · decide la direzione`),
        h('div', `«${g.question}»${g.late ? ' È scaduto: va deciso.' : g.due_date ? ` Entro il ${day(g.due_date)}.` : ''}`),
        i.canDecide ? h('div.nb-acts', btn('Prosegui', () => gateDialog(i, g, 'prosegui', refresh), { small: true, primary: true }), btn('Rimanda', () => gateDialog(i, g, 'rimanda', refresh), { small: true }), btn('Abbandona', () => gateDialog(i, g, 'abbandona', refresh), { small: true }))
          : h('div.small', 'Lo decide lo sponsor o la direzione.'),
        h('div.small.nb-gate-d', 'La decisione resta nelle riflessioni con chi l\'ha presa e perché.'))
        : i.phase === 'abbandonata' ? h('section.nb-gatebox', h('b', 'Iniziativa abbandonata'), h('div', i.abandoned_reason || '—')) : null));
}

// ── radar dell'iniziativa ─────────────────────────────────────────────────────────────────────
async function radarTab({ i, id, body, refresh }) {
  const d = await get(`/api/crm/business/${id}/radar`);
  const p = d.profile || {};
  const desc = textarea(p.description || i.description, { rows: 2 });
  const listInput = (arr, ph) => input({ value: (arr || []).join(', '), placeholder: ph });
  const works = listInput(p.works, 'cabine MT, posa cavi, manutenzione reti');
  const kw = listInput(p.keywords, 'distributore, rete elettrica, cabina');
  const regions = listInput(p.regions, 'Abruzzo, Marche, Molise');
  const soa = listInput(p.soa, 'OG10, OS30');
  const split = el => el.value.split(',').map(x => x.trim()).filter(Boolean);
  const save = async () => { await put(`/api/crm/business/${id}/profile`, { description: desc.value, works: split(works), keywords: split(kw), regions: split(regions), soa: split(soa) }); toast('Profilo salvato'); };
  const run = async () => {
    await save();
    const r = await post(`/api/crm/business/${id}/radar/run`, {});
    toast(`${r.added} segnali nuovi (costo ${eur2(r.cost)})`);
    refresh();
  };
  fill(body, h('div.crm-grid',
    card('Segnali per questa iniziativa', h('span.t-meta', `${d.signals.length} da guardare`),
      d.signals.length ? h('div.crm-lines', d.signals.map(s => h('div.crm-line',
        h('span.crm-score', { class: s.score >= 70 ? 'hi' : '' }, String(s.score)),
        h('div.grow', h('div.crm-line-t', s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title) : s.title),
          h('div.t-meta', [s.entity, s.region, s.amount ? eur(s.amount) : null, s.published_on ? day(s.published_on) : null].filter(Boolean).join(' · ')),
          s.why ? h('div.small', s.why) : null),
        i.canEdit ? h('div.nb-acts', btn('Cliente target', async () => { await post(`/api/crm/business/signals/${s.id}/target`, {}); toast('Aggiunto ai clienti target'); refresh(); }, { small: true, ico: 'plus' }),
          btn('Scarta', async () => { await post(`/api/crm/business/signals/${s.id}/scarta`, {}); refresh(); }, { small: true })) : null)))
        : empty(d.ai ? 'Nessun segnale da guardare. «Cerca adesso» legge le notizie degli ultimi giorni con il profilo qui a destra.' : 'Il radar si accende quando su Railway c\'è OPENAI_API_KEY.')),
    h('div.crm-side', card('Profilo dell\'iniziativa', null,
      h('p.small.muted', 'Il radar usa lo stesso motore e lo stesso punteggio delle BU: questo profilo fa da «BU in più». La spesa conta nel budget dell\'iniziativa.'),
      h('div.en-form', field('Cosa cerchiamo', desc), field('Lavori tipici', works, 'separati da virgola'), field('Parole utili', kw), field('Zone', regions), field('Categorie SOA', soa)),
      i.canEdit ? h('div.nb-acts', btn('Salva', save), btn('Cerca adesso', run, { primary: true, ico: 'crosshair', disabled: !d.ai })) : null))));
}

// ── riflessioni ───────────────────────────────────────────────────────────────────────────────
function noteForm(i, n, done) {
  const kind = select(Object.entries(NOTE_KINDS).filter(([k]) => k !== 'decisione' && k !== 'chat'), n?.kind || 'nota', { disabled: Boolean(n) });
  const title = input({ value: n?.title || '' });
  const text = textarea(n?.body, { rows: 5 });
  const level = select([['', '—'], ['alto', 'alto'], ['medio', 'medio'], ['basso', 'basso']], n?.level || '');
  const mit = input({ value: n?.mitigation || '' });
  const riskBox = h('div.nb-2', field('Livello del rischio', level), field('Mitigazione', mit));
  const sync = () => { riskBox.hidden = kind.value !== 'rischio'; };
  kind.addEventListener('change', sync);
  sync();
  const m = modal({
    title: n ? 'Riflessione' : 'Nuova riflessione',
    body: h('div.en-form', field('Tipo', kind, 'Le ipotesi restano «da verificare» finché qualcuno non le conferma o le smentisce.'), field('Titolo', title), field('Testo', text), riskBox),
    left: n && n.kind !== 'decisione' ? [h('button.btn.btn-ghost.danger', { type: 'button', on: { click: async () => { await del(`/api/crm/business/riflessioni/${n.id}`); m.close(); done(); } } }, 'Togli')] : [],
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const b = { title: title.value, body: text.value, level: level.value, mitigation: mit.value };
      if (n) await patch(`/api/crm/business/riflessioni/${n.id}`, b); else await post(`/api/crm/business/${i.id}/riflessioni`, { ...b, kind: kind.value });
      m.close();
      done();
    } } }, 'Salva')],
  });
}
function swotForm(i, swot, done) {
  const box = k => textarea(swot?.[k], { rows: 3 });
  const f = { forze: box('forze'), debolezze: box('debolezze'), opportunita: box('opportunita'), minacce: box('minacce') };
  const m = modal({ title: 'SWOT dell\'iniziativa', wide: true,
    body: h('div.nb-swot.edit', field('Forze', f.forze), field('Debolezze', f.debolezze), field('Opportunità', f.opportunita), field('Minacce', f.minacce)),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await put(`/api/crm/business/${i.id}/swot`, Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]))); m.close(); done(); } } }, 'Salva')] });
}
async function notesTab({ i, id, body, extra, refresh, ask }) {
  if (i.canEdit) extra.prepend(btn('Nuova riflessione', () => noteForm(i, null, refresh), { primary: true, ico: 'plus' }));
  const { notes, swot } = await get(`/api/crm/business/${id}/riflessioni`);
  const groups = [['', 'Tutte'], ['ipotesi', 'Ipotesi'], ['decisione', 'Decisioni'], ['chat', 'Dalla chat'], ['nota', 'Note'], ['rischio', 'Rischi']];
  let filter = '';
  const listBox = h('div.nb-journal-list');
  const entry = n => h('div.nb-journal', { class: `k-${n.kind}` },
    h('div.nb-who.small', h('span.pill', { class: NOTE_CLASS[n.kind] }, NOTE_KINDS[n.kind]), h('span.muted', [n.author_name, day(n.created_at), n.kind === 'ipotesi' ? { da_verificare: 'da verificare', confermata: 'confermata', smentita: 'smentita' }[n.check_status] : null, n.level ? `rischio ${n.level}` : null].filter(Boolean).join(' · '))),
    n.title ? h('div.crm-line-t', n.title) : null,
    n.kind === 'chat' ? h('div.small.nb-rich', richText(n.body)) : h('div.small.crm-line-b', n.body),
    n.mitigation ? h('div.small.muted', `Mitigazione: ${n.mitigation}`) : null,
    i.canEdit ? h('div.nb-acts',
      n.kind === 'ipotesi' && n.check_status === 'da_verificare' ? [btn('Confermata', async () => { await patch(`/api/crm/business/riflessioni/${n.id}`, { check_status: 'confermata' }); refresh(); }, { small: true }),
        btn('Smentita', async () => { await patch(`/api/crm/business/riflessioni/${n.id}`, { check_status: 'smentita' }); refresh(); }, { small: true })] : null,
      n.kind !== 'decisione' && n.author_id === store.me.id ? btn('Modifica', () => noteForm(i, n, refresh), { small: true }) : null) : null);
  const draw = () => listBox.replaceChildren(...(notes.filter(n => !filter || n.kind === filter).map(entry)), ...(notes.length ? [] : [empty('Il diario è vuoto: ipotesi, decisioni dei gate e risposte salvate dalla chat compaiono qui.')]));
  draw();
  const count = k => (k ? notes.filter(n => n.kind === k).length : notes.length);
  const open = notes.filter(n => n.kind === 'ipotesi' && n.check_status === 'da_verificare');
  const sw = swot || {};
  fill(body,
    h('div.nb-toolbar', h('div.nb-chips', groups.map(([k, l]) => h('button.nb-chip', { type: 'button', class: k === filter ? 'on' : '', on: { click: e => { filter = k; e.target.parentNode.querySelectorAll('.nb-chip').forEach(c => c.classList.toggle('on', c === e.target)); draw(); } } }, `${l} ${count(k)}`)))),
    h('div.crm-grid',
      h('section.card.crm-pad', listBox),
      h('div.crm-side',
        card('SWOT dell\'iniziativa', i.canEdit ? h('div.nb-acts', btn('Modifica', () => swotForm(i, sw, refresh), { small: true }), btn('Proponi', () => ask('Proponi la SWOT di questa iniziativa: forze, debolezze, opportunità, minacce, in poche parole per voce.'), { small: true, ico: 'lightbulb' })) : null,
          h('div.nb-swot', [['forze', 'Forze', 'g'], ['debolezze', 'Debolezze', 'r'], ['opportunita', 'Opportunità', 'b'], ['minacce', 'Minacce', 'y']].map(([k, l, c]) => h('div', { class: `s-${c}` }, h('b', l), h('div', sw[k] || '—')))),
          sw.by ? h('div.t-meta', `${sw.by} · aggiornata il ${day(sw.at)}`) : null),
        card('Da verificare', null, open.length ? h('div.crm-lines', open.map(n => h('div.crm-line', h('span.crm-ico.warn', '?'), h('div.grow.small', n.title || n.body.slice(0, 120)))))
          : empty('Nessuna ipotesi aperta.')))));
}

// ── analisi per la direzione ──────────────────────────────────────────────────────────────────
async function analysisTab({ i, id, body, extra }) {
  extra.prepend(btn('Esporta per la riunione', () => window.print(), { ico: 'file-text' }));
  const a = await get(`/api/crm/business/${id}/analisi`);
  const kpi = (n, l, warn) => h('div.crm-wk-kpi', { class: warn ? 'warn' : '' }, h('strong', n), h('span', l));
  const cur = PHASE_KEYS.indexOf(i.phase);
  const f = a.funnel;
  const fun = [['individuati', f.individuati], ['contattati', f.contattati], ['incontrati', f.incontrati], ['qualificati come fornitori', f.qualificati], ['opportunità', f.opportunita]];
  const max = Math.max(1, ...a.weeks.flatMap(w => [w.meetings, w.emails, w.notes, w.tasks]));
  const COLORS = [['meetings', 'incontri', 'nb-c1'], ['emails', 'email', 'nb-c2'], ['notes', 'note e riflessioni', 'nb-c3'], ['tasks', 'passi fatti', 'nb-c4']];
  const total2 = a.weeks.slice(2).reduce((s, w) => s + w.meetings + w.emails + w.notes + w.tasks, 0);
  const summary = h('div.grow', h('div.crm-line-t', 'Sintesi dell\'assistente per la riunione di direzione'), h('div.small.muted', 'Riassume attività del responsabile, stato, cosa manca per il gate e sinergie con il CRM.'));
  fill(body,
    h('div.crm-wk-kpis',
      kpi(i.phase === 'abbandonata' ? 'Abbandonata' : PHASES[cur][1], i.phase === 'abbandonata' ? (i.abandoned_reason || '—') : `fase ${cur + 1} di 5${a.gate?.late ? ` · gate G${a.gate.n} scaduto il ${day(a.gate.due_date)}` : a.gate?.due_date ? ` · gate G${a.gate.n} il ${day(a.gate.due_date)}` : ''}`),
      kpi(a.gaps.total ? `${Math.round(a.gaps.ok / a.gaps.total * 100)}%` : '—', `gap colmati (${a.gaps.ok} di ${a.gaps.total})`),
      kpi(`${f.contattati} / ${f.individuati}`, 'clienti target contattati'),
      kpi(eur(a.spent), `spesi su ${eur(a.budget)} di budget${a.ai_eur ? ` · AI ${eur2(a.ai_eur)}` : ''}`, a.budget > 0 && a.spent > a.budget),
      kpi(String(a.lateTasks), a.lateTasks === 1 ? 'passo scaduto' : 'passi scaduti', a.lateTasks > 0)),
    h('div.nb-3',
      card('Clienti target', null, h('div.nb-funnel', fun.map(([l, n]) => h('div', { style: { width: `${Math.max(f.individuati ? n / f.individuati * 100 : 0, 34)}%` } }, h('span', l), h('b', String(n))))),
        h('p.t-meta', 'Dalla scheda «Clienti target»: lo stato di ogni azienda.')),
      card(`Cosa fa ${a.owner_name || 'il responsabile'} · ultime 4 settimane`, null,
        h('div.nb-wk', h('span'), a.weeks.map(w => h('span.t-meta.nb-c', fmtDate(w.from))),
          h('span.small', 'attività'), a.weeks.map(w => h('div.nb-c', COLORS.map(([k, , c]) => h('i', { class: c, title: `${w[k]}`, style: { height: `${Math.round(w[k] / max * 84) + 2}px` } }))))),
        h('div.nb-legend', COLORS.map(([, l, c]) => h('span', h('span.nb-dot', { class: c }), l))),
        h('p.t-meta', 'Incontri ed email con le aziende target (da Outlook, collegati nel CRM), note, riflessioni e passi fatti.')),
      card('Semaforo', null, h('div.nb-who', dot(a.light.color), h('span.crm-line-t', LIGHT[a.light.color])),
        h('div.crm-lines', a.light.reasons.map(r => h('div.crm-line', dot(r.c), h('div.small.grow', r.t)))),
        h('p.t-meta', `${total2} cose fatte nelle ultime 2 settimane`))),
    h('div.crm-grid',
      card('Prossimi passi', null, a.next.length ? h('div.crm-steplist', a.next.map(t => taskRow({ ...i, canEdit: false }, t, () => {}, { showPhase: true }))) : empty('Nessun passo aperto.')),
      card('Rischi', null, a.risks.length ? h('div.crm-lines', a.risks.map(r => h('div.crm-line', h('span.pill', { class: r.level === 'alto' ? 'nb-red' : 'nb-warn' }, r.level || '—'),
        h('div.grow', h('div.small.crm-line-t', r.title || r.body), r.mitigation ? h('div.t-meta', `mitigazione: ${r.mitigation}`) : null)))) : empty('Nessun rischio scritto. Si aggiungono dalle Riflessioni (tipo «Rischio»).'))),
    h('section.card.crm-pad.nb-summary', h('span.crm-ico.meet', icon('lightbulb', { size: 15 })), summary,
      i.ai ? btn('Prepara la sintesi', async e => {
        e.currentTarget.disabled = true; const b0 = e.currentTarget;
        summary.replaceChildren(h('div.crm-line-t', 'Sintesi dell\'assistente per la riunione di direzione'), loading());
        try {
          const m = await post(`/api/crm/business/${id}/sintesi`, {});
          summary.replaceChildren(h('div.crm-line-t', 'Sintesi dell\'assistente per la riunione di direzione'), h('div.small.nb-rich', richText(m.body)));
        } finally { b0.disabled = false; }
      }, { small: true }) : h('span.t-meta', 'serve OPENAI_API_KEY')));
}
