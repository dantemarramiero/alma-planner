// Lavoro commerciale del CRM (Dante 14/11/2026; canvas «Lavoro commerciale · Radar AI · Piani d'azione»):
// «La mia settimana» del responsabile di BU, prossimi passi sulla scheda, key account, impostazioni modificabili.
import { h, fill, modal, confirmDialog, toast, fmtDate, loading } from './ui.js';
import { get, post, put, patch, del } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';
import { openCrmMeeting } from './crm-tabs.js';

const CHANNELS = { telefonata: 'Telefonata', email: 'Email', incontro: 'Incontro', sopralluogo: 'Sopralluogo', altro: 'Altro' };
const CH_ICON = { telefonata: 'phone', email: 'mail', incontro: 'users', sopralluogo: 'map-pin', altro: 'circle' };
const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const plusDays = n => { const d = new Date(`${todayIso()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const day = d => (d ? fmtDate(String(d).slice(0, 10), { year: true }) : '—');
const field = (label, control, hint) => h('label.field', h('span', label), control, hint ? h('small.muted', hint) : null);
const input = (attrs = {}) => h('input.input', attrs);
const select = (options, value, attrs = {}) => h('select.select', attrs, options.map(([k, label]) => h('option', { value: k, selected: String(k) === String(value ?? '') }, label)));
const textarea = (value, attrs = {}) => h('textarea.input', { rows: 3, ...attrs }, value || '');
const userOptions = (empty = '—') => [['', empty], ...store.users.filter(u => u.active !== false).map(u => [u.id, u.name])];
const personName = p => [p.title, p.first_name, p.last_name].filter(Boolean).join(' ');
const card = (title, extra, ...body) => h('section.card.crm-pad', h('div.crm-card-head', h('h3.crm-h3', title), extra || null), ...body);
const empty = text => h('p.small.muted', text);
const ico = name => h('span.crm-ico', icon(name, { size: 15 }));

function chipSet(options, selected, { onChange } = {}) {
  const values = new Set(selected);
  const el = h('div.en-chips', options.map(([k, label]) => h('button.pill.en-chip', {
    type: 'button', class: values.has(k) ? 'on' : '', 'aria-pressed': String(values.has(k)),
    on: { click: e => {
      values.has(k) ? values.delete(k) : values.add(k);
      e.currentTarget.classList.toggle('on', values.has(k));
      e.currentTarget.setAttribute('aria-pressed', String(values.has(k)));
      onChange?.(values);
    } },
  }, label)));
  return { el, values };
}
// elenco di righe modificabili: aggiungi, togli, sposta su e giù
function lineList(values, { placeholder = '', max = 300 } = {}) {
  const rows = h('div.crm-lineedit');
  const add = (val = '') => {
    const row = h('div.crm-lineedit-row',
      input({ value: val, placeholder, maxlength: max, 'aria-label': placeholder || 'Voce' }),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Sposta su', on: { click: () => row.previousElementSibling && rows.insertBefore(row, row.previousElementSibling) } }, icon('chevron-up', { size: 14 })),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Sposta giù', on: { click: () => row.nextElementSibling && rows.insertBefore(row.nextElementSibling, row) } }, icon('chevron-down', { size: 14 })),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Togli', on: { click: () => row.remove() } }, icon('x', { size: 14 })));
    rows.append(row);
    return row;
  };
  values.forEach(x => add(x));
  return {
    el: h('div', rows, h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => add().querySelector('input').focus() } }, icon('plus', { size: 14 }), 'Aggiungi')),
    value: () => [...rows.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean),
  };
}
const words = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

// ── prossimi passi ─────────────────────────────────────────────────────────────────────────────
// nuovo passo o modifica; contacts = persone dell'azienda
export function stepDialog({ subjectId, subjectName, step = null, contacts = [], defaultOwner = null, onSaved }) {
  const title = input({ value: step?.title || '', placeholder: 'Cosa fare: chiamare l\'ing. Rossi, mandare le referenze…', maxlength: 300 });
  const due = input({ type: 'date', value: step?.due_date?.slice(0, 10) || plusDays(2) });
  const owner = select(userOptions(), step ? step.owner_id : (defaultOwner || store.me.id));
  const channel = select([['', '—'], ...Object.entries(CHANNELS)], step?.channel || '');
  const contact = select([['', 'Nessuno in particolare'], ...contacts.map(c => [c.id, personName(c) + (c.job ? ` · ${c.job}` : '')])], step?.contact_id || '');
  const draft = textarea(step?.draft || '', { rows: 4, placeholder: 'Facoltativa: il testo dell\'email o cosa dire al telefono' });
  const quick = h('div.en-chips', [['Domani', 1], ['Fra 3 giorni', 3], ['Fra una settimana', 7], ['Fra un mese', 30]].map(([l, n]) =>
    h('button.pill.en-chip', { type: 'button', on: { click: () => { due.value = plusDays(n); } } }, l)));
  const m = modal({
    title: step ? 'Modifica il passo' : `Prossimo passo${subjectName ? ` · ${subjectName}` : ''}`,
    body: h('div.en-form', field('Cosa fare', title), field('Entro quando', h('div', due, quick)),
      h('div.en-row2', field('Chi lo fa', owner), field('Come', channel)),
      contacts.length ? field('Con chi', contact) : null, field('Bozza', draft)),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      if (!title.value.trim()) return toast('Scrivi cosa fare', 'err');
      if (!due.value) return toast('Scegli entro quando', 'err');
      const body = { title: title.value, due_date: due.value, owner_id: owner.value ? Number(owner.value) : null, channel: channel.value, draft: draft.value,
        ...(contacts.length ? { contact_id: contact.value ? Number(contact.value) : null } : {}) };
      if (step) await patch(`/api/crm/steps/${step.id}`, body);
      else await post(`/api/crm/subjects/${subjectId}/steps`, body);
      m.close();
      toast('Passo salvato');
      onSaved?.();
    } } }, 'Salva')],
  });
  setTimeout(() => title.focus(), 50);
}
// «Fatto»: com'è andata e, se serve, il passo dopo (un lead senza passo aperto non è vivo)
export function doneDialog(step, { otherOpen = 0, onSaved } = {}) {
  const outcome = textarea('', { placeholder: 'Com\'è andata (facoltativo)' });
  const nextTitle = input({ placeholder: 'Il passo dopo (consigliato)', maxlength: 300, class: 'crm-grow' });
  const nextDue = input({ type: 'date', value: plusDays(7) });
  const m = modal({
    title: 'Passo fatto',
    body: h('div.en-form', h('p', h('strong', step.title), step.subject_name ? h('span.muted', ` · ${step.subject_name}`) : null),
      field('Esito', outcome),
      field('E adesso?', h('div.crm-composer-row', nextTitle, nextDue), otherOpen ? `Ci sono già altri ${otherOpen} passi aperti su quest'azienda.` : 'Senza un passo aperto l\'azienda finisce tra i lead senza prossimo passo.')),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const next = nextTitle.value.trim() ? { title: nextTitle.value, due_date: nextDue.value } : null;
      if (next && !next.due_date) return toast('Scegli la data del passo dopo', 'err');
      await post(`/api/crm/steps/${step.id}/done`, { outcome: outcome.value, next });
      m.close();
      toast('Fatto');
      onSaved?.();
    } } }, 'Segna come fatto')],
  });
  setTimeout(() => outcome.focus(), 50);
}
function stepRow(st, { showSubject = false, onChange, contacts = [], otherOpen = 0 } = {}) {
  const late = String(st.due_date).slice(0, 10) < todayIso();
  const meta = [showSubject ? null : st.owner_name, st.contact_name, st.channel && CHANNELS[st.channel]].filter(Boolean).join(' · ');
  return h('div.crm-step', { class: late ? 'late' : '' },
    h('button.crm-step-check', { type: 'button', title: 'Segna come fatto', 'aria-label': `Segna come fatto: ${st.title}`, on: { click: () => doneDialog(st, { otherOpen, onSaved: onChange }) } }, icon('check', { size: 14 })),
    h('div.grow',
      h('div.crm-line-t', st.title, late ? h('span.crm-bang', { title: 'Scaduto' }, '!') : null),
      showSubject ? h('a.t-meta', { href: `#/crm/scheda/${st.subject_id}` }, st.subject_name) : null,
      meta ? h('div.t-meta', st.channel ? icon(CH_ICON[st.channel], { size: 12 }) : null, ' ', meta) : null,
      st.draft ? h('details.crm-draft', h('summary.t-meta', 'Bozza'), h('p.en-notes', st.draft)) : null),
    h('span.crm-step-date', { class: late ? 'due-late' : '' }, day(st.due_date)),
    showSubject ? null : h('div.crm-step-acts',
      h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Modifica', on: { click: () => stepDialog({ subjectId: st.subject_id, step: st, contacts, onSaved: onChange }) } }, icon('pencil', { size: 14 })),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Cancella', on: { click: async () => {
        if (!await confirmDialog(`Cancellare il passo «${st.title}»?`, { ok: 'Cancella', danger: true })) return;
        await del(`/api/crm/steps/${st.id}`);
        onChange?.();
      } } }, icon('trash', { size: 14 }))));
}

// sulla scheda dell'azienda, sempre in alto (al posto del vecchio «Prossimo passo» unico)
export function stepsCard(s, refresh) {
  const box = h('section.card.crm-pad.crm-steps', loading());
  const contacts = s.contacts.filter(c => !c.date_to);
  const draw = async () => {
    const { open, done } = await get(`/api/crm/subjects/${s.id}/steps`);
    const add = h('button.btn.btn-sm', { type: 'button', on: { click: () => stepDialog({ subjectId: s.id, subjectName: s.name, contacts, defaultOwner: s.owner_id, onSaved: refresh }) } }, icon('plus', { size: 14 }), 'Aggiungi passo');
    const isLead = s.roles.includes('lead') && s.lead_stage !== 'non_interessato';
    fill(box,
      h('div.crm-card-head', h('h3.crm-h3', icon('alarm-clock', { size: 14 }), ' Prossimi passi'), add),
      open.length ? h('div.crm-steplist', open.map(st => stepRow(st, { onChange: refresh, contacts, otherOpen: open.length - 1 })))
        : h('p.small', { class: isLead ? 'due-late' : 'muted' }, isLead ? 'Nessun passo aperto: senza un prossimo passo il lead non è vivo.' : 'Nessun passo aperto.'),
      done.length ? h('details.crm-done', h('summary.small.muted', `Fatti (${done.length})`),
        h('div.crm-lines', done.map(st => h('div.crm-line', ico('check'), h('div.grow', h('div.crm-line-t', st.title),
          h('div.t-meta', [day(st.done_at), st.done_by_name, st.outcome].filter(Boolean).join(' · '))),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/crm/steps/${st.id}/reopen`); refresh(); } } }, 'Riapri'))))) : null);
  };
  draw().catch(() => fill(box, empty('Prossimi passi non disponibili.')));
  return box;
}

// key account: pillola nell'intestazione, si cambia al clic
export function keyAccountPill(s, refresh, defaultRhythm = 90) {
  return h('button.pill.crm-key', {
    type: 'button', class: s.key_account ? 'on' : '', title: 'Key account: azienda su cui la BU punta, con un ritmo di contatto',
    on: { click: () => {
      const on = h('input', { type: 'checkbox', checked: s.key_account });
      const rhythm = input({ type: 'number', min: 7, max: 730, value: s.key_rhythm_days || '', placeholder: String(defaultRhythm) });
      const m = modal({
        title: 'Key account',
        body: h('div.en-form', h('label.crm-check', on, h('span', `${s.name} è un key account`)),
          field('Sentirlo almeno ogni (giorni)', rhythm, `Vuoto = ${defaultRhythm} giorni, come nelle impostazioni. Oltre il ritmo compare in «La mia settimana».`)),
        actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
          await post(`/api/crm/subjects/${s.id}/key-account`, { key_account: on.checked, key_rhythm_days: rhythm.value || null });
          m.close();
          refresh();
        } } }, 'Salva')],
      });
    } },
  }, icon('star', { size: 12 }), s.key_account ? `Key account · ogni ${s.key_rhythm_days || defaultRhythm} gg` : 'Key account?');
}

// ── la mia settimana ───────────────────────────────────────────────────────────────────────────
export async function weekTab(box, data, { userId = null } = {}) {
  const w = await get(`/api/crm/settimana${userId ? `?user=${userId}` : ''}`);
  const again = () => weekTab(box, data, { userId });
  const late = w.steps.filter(s => s.late);
  const soon = w.steps.filter(s => !s.late);
  const kpi = (n, label, warn) => h('div.crm-wk-kpi', { class: warn && n ? 'warn' : '' }, h('strong', String(n)), h('span', label));
  const who = data.admin ? select(userOptions('Io'), userId || '', { 'aria-label': 'Settimana di', on: { change: e => weekTab(box, data, { userId: Number(e.target.value) || null }) } }) : null;
  const asaName = k => data.asa.find(a => a.key === k)?.label || k;
  const stepsList = list => h('div.crm-steplist', list.map(st => stepRow(st, { showSubject: true, onChange: again })));
  const radarCard = card('Segnali del radar', null,
    w.radar.on.length ? empty(`Il radar della tua BU (${w.radar.on.map(asaName).join(', ')}) parte con il pilota: qui arriveranno i segnali da decidere (Interessa o Scarta) e i piani d'azione.`)
      : w.bus.length ? empty(`Il radar di ${w.bus.map(asaName).join(', ')} è spento: nel pilota sono accese ${w.radar.pilot.map(asaName).join(', ')}. Si accende da Impostazioni.`)
        : empty('I segnali del radar arrivano ai responsabili di BU. Il responsabile di ogni BU si sceglie in Impostazioni → Profili BU.'));
  fill(box,
    h('div.crm-wk-head', h('p.muted', `${w.user.id === store.me.id ? 'Le tue cose' : `Le cose di ${w.user.name}`} fino al ${day(w.until)}${w.bus.length ? ` · responsabile di ${w.bus.map(asaName).join(', ')}` : ''}`), who),
    h('div.crm-wk-kpis', kpi(late.length, 'passi scaduti', true), kpi(soon.length, 'passi in scadenza'), kpi(w.keyAccounts.silent.length, 'key account da sentire', true),
      kpi(w.missingNotes.length, 'incontri senza note', true), kpi(w.leadsWithoutStep.total, 'lead senza passo', true)),
    h('div.crm-grid',
      h('div.crm-side',
        card('Prossimi passi', null, w.steps.length ? [late.length ? h('div.crm-wk-sub.due-late', 'Scaduti') : null, late.length ? stepsList(late) : null,
          soon.length ? h('div.crm-wk-sub', 'Da fare') : null, soon.length ? stepsList(soon) : null] : empty('Niente in scadenza. Ogni lead e cliente attivo dovrebbe avere un prossimo passo.')),
        card('Lead senza prossimo passo', w.leadsWithoutStep.total > w.leadsWithoutStep.list.length ? h('span.t-meta', `${w.leadsWithoutStep.list.length} di ${w.leadsWithoutStep.total}`) : null,
          w.leadsWithoutStep.list.length ? h('div.crm-lines', w.leadsWithoutStep.list.map(l => h('div.crm-line', ico('building'),
            h('a.grow.crm-line-t', { href: `#/crm/scheda/${l.id}` }, l.name),
            h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
              const s = await get(`/api/crm/subjects/${l.id}`);
              stepDialog({ subjectId: l.id, subjectName: l.name, contacts: s.contacts.filter(c => !c.date_to), defaultOwner: w.user.id, onSaved: again });
            } } }, icon('plus', { size: 14 }), 'Passo'))))
            : empty('Tutti i tuoi lead hanno un prossimo passo.'))),
      h('div.crm-side',
        radarCard,
        card('Key account da sentire', h('span.t-meta', `${w.keyAccounts.total} key account`),
          w.keyAccounts.silent.length ? h('div.crm-lines', w.keyAccounts.silent.map(k => h('a.crm-line.crm-linkline', { href: `#/crm/scheda/${k.id}` }, ico('star'),
            h('div.grow', h('div.crm-line-t', k.name), h('div.t-meta', k.last_contact ? `Ultimo contatto ${day(k.last_contact)} · ${k.days} giorni fa` : 'Mai sentito da quando è nel CRM')),
            h('span.t-meta.due-late', `ritmo ${k.rhythm} gg`))))
            : empty(w.keyAccounts.total ? 'Tutti sentiti nel loro ritmo.' : 'Nessun key account: si segnano dalla scheda dell\'azienda con la pillola «Key account?».')),
        card('Incontri senza note', null, w.missingNotes.length ? h('div.crm-lines', w.missingNotes.map(m => h('button.crm-line.crm-linkline', { type: 'button', on: { click: () => openCrmMeeting(m.id, again) } },
          ico('calendar'), h('div.grow', h('div.crm-line-t', m.subject || 'Incontro', h('span.crm-bang', '!')), h('div.t-meta', [day(m.start_at), m.who].filter(Boolean).join(' · '))))))
          : empty('Nessun incontro da completare.')))));
}

// ── impostazioni del lavoro commerciale (solo direzione) ───────────────────────────────────────
const SECTIONS = [['radar', 'Radar'], ['scoring', 'Punteggio'], ['profiles', 'Profili BU'], ['sources', 'Fonti'], ['playbooks', 'Playbook'], ['rules', 'Regole e tempi']];
const WEIGHTS = [['fit', 'Coerenza con la BU', 'Tipo di lavoro, SOA, fascia d\'importo e zona rispetto al profilo'],
  ['concreteness', 'Concretezza', 'Atto ufficiale o fondi concessi · delibera o permesso · notizia di stampa · indiscrezione'],
  ['timing', 'Tempi', 'Lavori entro 12 mesi · tra 12 e 24 mesi · oltre'],
  ['relationship', 'Rapporto', 'Cliente attuale · lead, partner o contatto noto · sconosciuto'],
  ['value', 'Valore', 'Importo dentro la fascia della BU · sotto la fascia']];

export async function settingsTab(box, data, section = 'radar') {
  const view = await get('/api/crm/commerciale');
  const st = view.settings;
  const asaName = k => view.asa.find(a => a.key === k)?.label || k;
  const asaOpts = view.asa.map(a => [a.key, a.label]);
  const go = k => settingsTab(box, data, k);
  const save = async (key, value) => { await put(`/api/crm/commerciale/${key}`, { value }); toast('Impostazioni salvate'); go(section); };
  const reset = key => h('button.btn.btn-ghost', { type: 'button', on: { click: async () => {
    if (!await confirmDialog('Tornare ai valori di partenza per questa sezione? Le modifiche salvate si perdono.', { ok: 'Torna ai valori di partenza' })) return;
    await del(`/api/crm/commerciale/${key}`);
    toast('Valori di partenza');
    go(section);
  } } }, 'Valori di partenza');
  const savedLine = key => (st.saved?.[key] ? h('span.t-meta', `Modificato il ${day(st.saved[key].at)}${st.saved[key].by ? ` da ${store.users.find(u => u.id === st.saved[key].by)?.name || '—'}` : ''}`) : h('span.t-meta', 'Valori di partenza del documento'));
  const foot = (key, onSave) => h('div.crm-set-foot', savedLine(key), h('div.grow'), reset(key), h('button.btn.btn-primary', { type: 'button', on: { click: onSave } }, 'Salva'));
  const nav = h('nav.profile-tabs.crm-tabs', { role: 'tablist' }, SECTIONS.map(([k, l]) => h('button', { type: 'button', role: 'tab', class: k === section ? 'on' : '', 'aria-selected': String(k === section), on: { click: () => go(k) } }, l)));
  const body = h('div');
  fill(box, h('p.small.muted', 'Tutto quello che decide come lavora il CRM commerciale: si cambia qui, senza toccare il codice. I promemoria cambiano subito, il radar dal giorno dopo.'), nav, body);

  if (section === 'radar') {
    const r = st.radar;
    const budget = input({ type: 'number', min: 0, max: 10000, value: r.budget_eur });
    const hour = input({ type: 'number', min: 0, max: 23, value: r.run_hour });
    const alert = h('input', { type: 'checkbox', checked: r.alert_admins_on_budget });
    const sum = h('strong');
    const rows = view.asa.map(a => {
      const b = r.bu[a.key] || { on: false, quota_eur: 0 };
      const on = h('input', { type: 'checkbox', checked: b.on, 'aria-label': `Radar acceso per ${a.label}` });
      const quota = input({ type: 'number', min: 0, max: 10000, value: b.quota_eur, 'aria-label': `Quota di ${a.label}` });
      return { key: a.key, on, quota, tr: h('tr', h('td', h('label.crm-check', on, h('span', a.label))), h('td', view.pilot.includes(a.key) ? h('span.pill.crm-r-lead', 'pilota') : ''),
        h('td', st.profiles[a.key]?.manager?.name || st.profiles[a.key]?.manager_name || h('span.muted', 'da assegnare')), h('td.num', quota)) };
    });
    const total = () => { const n = rows.reduce((s, x) => s + (Number(x.quota.value) || 0), 0); sum.textContent = `${n} € di ${budget.value || 0} €`; sum.classList.toggle('due-late', n > Number(budget.value || 0)); };
    rows.forEach(x => x.quota.addEventListener('input', total));
    budget.addEventListener('input', total);
    total();
    fill(body, h('section.card.crm-pad.en-form',
      h('div.en-row2', field('Budget mensile dell\'AI (€)', budget, 'Arrivato al tetto, il radar si ferma fino al mese dopo.'), field('Ora del giro notturno', hour, 'Il radar legge le fonti una volta al giorno.')),
      h('label.crm-check', alert, h('span', 'Quando una BU finisce la sua quota, avvisa gli amministratori con «Aumenta» o «Lascia così». Finché nessuno decide riceve solo i segnali dai dati pubblici.')),
      h('div.en-table-wrap', h('table.en-table', h('thead', h('tr', h('th', 'BU (acceso / spento)'), h('th', ''), h('th', 'Responsabile'), h('th.num', 'Quota (€/mese)'))), h('tbody', rows.map(x => x.tr)))),
      h('p.small', 'Quote assegnate: ', sum),
      foot('radar', () => save('radar', { budget_eur: Number(budget.value), run_hour: Number(hour.value), alert_admins_on_budget: alert.checked,
        bu: Object.fromEntries(rows.map(x => [x.key, { on: x.on.checked, quota_eur: Number(x.quota.value) || 0 }])) }))));
  } else if (section === 'scoring') {
    const sc = st.scoring;
    const ws = WEIGHTS.map(([k, l, hint]) => ({ k, el: input({ type: 'number', min: 0, max: 100, value: sc.weights[k], 'aria-label': l }), l, hint }));
    const tot = h('strong');
    const total = () => { const n = ws.reduce((s, w) => s + (Number(w.el.value) || 0), 0); tot.textContent = String(n); tot.classList.toggle('due-late', n !== 100); };
    ws.forEach(w => w.el.addEventListener('input', total));
    total();
    const min = input({ type: 'number', min: 0, max: 100, value: sc.min });
    const hi = input({ type: 'number', min: 0, max: 100, value: sc.highlight });
    fill(body, h('section.card.crm-pad.en-form',
      h('p', 'Ogni segnale prende da 0 a 100 punti: quanto vale la pena che il responsabile di BU ci perda tempo. È la somma di cinque criteri.'),
      h('div.en-table-wrap', h('table.en-table', h('thead', h('tr', h('th', 'Criterio'), h('th', 'Come si assegnano i punti'), h('th.num', 'Peso'))),
        h('tbody', ws.map(w => h('tr', h('td', h('strong', w.l)), h('td.small', w.hint), h('td.num', w.el))), h('tr', h('td', h('strong', 'Totale')), h('td.small.muted', 'deve fare 100'), h('td.num', tot))))),
      h('div.en-row2', field('In evidenza da', hi, 'Sopra questa soglia il segnale sta in cima a «La mia settimana».'), field('Punteggio minimo', min, 'Sotto non arriva al responsabile, ma resta in «Sotto soglia».')),
      foot('scoring', () => save('scoring', { weights: Object.fromEntries(ws.map(w => [w.k, Number(w.el.value) || 0])), min: Number(min.value), highlight: Number(hi.value) }))));
  } else if (section === 'profiles') {
    const pick = select(asaOpts, view.asa[0]?.key, { 'aria-label': 'BU' });
    const form = h('div');
    const drawProfile = () => {
      const k = pick.value;
      const p = st.profiles[k] || {};
      const manager = select(userOptions('da assegnare'), p.manager?.id || '');
      const desc = textarea(p.description, { rows: 3, placeholder: 'Cosa fa la BU, in due righe' });
      const works = lineList(p.works || [], { placeholder: 'Lavoro tipico' });
      const soa = chipSet(data.meta.soaCategories.map(([c]) => [c, c]), p.soa || []);
      const amin = input({ type: 'number', min: 0, value: p.amount_min ?? '', placeholder: 'minimo €' });
      const amax = input({ type: 'number', min: 0, value: p.amount_max ?? '', placeholder: 'massimo €' });
      const regions = chipSet(data.meta.regions.map(r => [r.name, r.name]), p.regions || []);
      const kw = textarea((p.keywords || []).join(', '), { rows: 2, placeholder: 'separate da virgole' });
      const ex = textarea((p.exclude || []).join(', '), { rows: 2, placeholder: 'separate da virgole' });
      fill(form, h('div.en-form',
        h('div.en-row2', field('Responsabile', manager, p.manager || !p.manager_name ? null : `Nel documento: ${p.manager_name} (non ancora tra le persone di Alma Planet)`), field('Fascia d\'importo (€)', h('div.crm-composer-row', amin, amax))),
        field('Cosa fa', desc), field('Lavori tipici', works.el), field('Categorie SOA', h('details.crm-soa-pick', h('summary.small', (p.soa || []).join(' · ') || 'Scegli…'), soa.el)),
        field('Zone', h('details.crm-soa-pick', h('summary.small', (p.regions || []).length ? p.regions.join(' · ') : 'Tutta Italia'), regions.el), 'Nessuna regione scelta = tutta Italia.'),
        h('div.en-row2', field('Parole da cercare', kw), field('Parole da escludere', ex)),
        field('Clienti attuali', p.clients?.length ? h('div.en-links', p.clients.slice(0, 40).map(c => h('a.en-link', { href: `#/crm/scheda/${c.id}` }, c.name)), p.clients.length > 40 ? h('span.t-meta', `e altri ${p.clients.length - 40}`) : null)
          : empty('Nessun cliente con questa ASA.'), 'Non si scrivono a mano: arrivano dalle anagrafiche con ruolo Cliente e questa ASA (commesse).'),
        foot('profiles', () => save('profiles', { [k]: { ...p, manager_id: manager.value ? Number(manager.value) : null, description: desc.value, works: works.value(), soa: [...soa.values],
          amount_min: amin.value === '' ? null : Number(amin.value), amount_max: amax.value === '' ? null : Number(amax.value), regions: [...regions.values], keywords: words(kw.value), exclude: words(ex.value) } }))));
    };
    pick.addEventListener('change', drawProfile);
    fill(body, h('section.card.crm-pad', field('BU', pick), form));
    drawProfile();
  } else if (section === 'sources') {
    const list = h('div.crm-set-list');
    const add = (s = { name: '', what: '', on: true, bu: [] }) => {
      const on = h('input', { type: 'checkbox', checked: s.on, 'aria-label': 'Accesa' });
      const name = input({ value: s.name, placeholder: 'Nome della fonte', maxlength: 120 });
      const what = input({ value: s.what, placeholder: 'Cosa porta', maxlength: 300 });
      const bu = chipSet(asaOpts, s.bu || []);
      const gare = h('input', { type: 'checkbox', checked: Boolean(s.to_gare) });
      const row = h('div.card.crm-pad.crm-set-item', h('div.crm-composer-row', h('label.crm-check', on, h('span', 'Accesa')), name,
        h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Togli la fonte', on: { click: () => row.remove() } }, icon('trash', { size: 14 }))),
      what, field('Porta segnali a (nessuna = tutte le BU)', bu.el), h('label.crm-check', gare, h('span', 'Le gare già bandite vanno all\'ufficio gare (coda «Proposte dal radar»)')));
      row.read = () => ({ id: s.id, name: name.value, what: what.value, on: on.checked, bu: [...bu.values], to_gare: gare.checked });
      list.append(row);
    };
    st.sources.forEach(add);
    const mode = select([['email', 'Avvisi email su una casella dedicata'], ['export', 'File esportato'], ['api', 'Accesso API']], st.infordat_mode);
    fill(body, h('div.en-form', list, h('button.btn', { type: 'button', on: { click: () => add() } }, icon('plus', { size: 14 }), 'Aggiungi una fonte'),
      h('section.card.crm-pad', field('Come si legge Infordat', mode, 'Da decidere con l\'ufficio gare.'),
        h('div.crm-set-foot', h('div.grow'), h('button.btn', { type: 'button', on: { click: () => save('infordat_mode', mode.value) } }, 'Salva il modo'))),
      foot('sources', () => save('sources', [...list.children].map(r => r.read())))));
  } else if (section === 'playbooks') {
    const list = h('div.crm-set-list');
    const add = (p = { name: '', bu: [], steps: [''], check: '' }) => {
      const name = input({ value: p.name, placeholder: 'Tipo di segnale', maxlength: 200 });
      const bu = chipSet(asaOpts, p.bu || []);
      const steps = lineList(p.steps || [], { placeholder: 'Passo' });
      const check = input({ value: p.check, placeholder: 'Domanda di verifica (c\'è una trattativa?)', maxlength: 300 });
      const row = h('div.card.crm-pad.crm-set-item', h('div.crm-composer-row', name,
        h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Togli il playbook', on: { click: () => row.remove() } }, icon('trash', { size: 14 }))),
      field('Vale per (nessuna = tutte le BU)', bu.el), field('Passi, in ordine', steps.el), field('Verifica', check));
      row.read = () => ({ id: p.id, name: name.value, bu: [...bu.values], steps: steps.value(), check: check.value });
      list.append(row);
    };
    st.playbooks.forEach(add);
    fill(body, h('div.en-form', h('p.small.muted', 'Dopo «Interessa» il CRM propone un piano d\'azione partendo dal playbook del tipo di segnale, adattato ai contatti e alle commesse simili.'),
      list, h('button.btn', { type: 'button', on: { click: () => add() } }, icon('plus', { size: 14 }), 'Aggiungi un playbook'),
      foot('playbooks', () => save('playbooks', [...list.children].map(r => r.read())))));
  } else if (section === 'rules') {
    const r = st.rules;
    const num = (k, min, max) => input({ type: 'number', min, max, value: r[k] ?? '', 'data-k': k });
    const nums = { meeting_note_hours: num('meeting_note_hours', 1, 720), lead_qualify_hours: num('lead_qualify_hours', 1, 720), signal_decide_days: num('signal_decide_days', 1, 90),
      plan_accept_hours: num('plan_accept_hours', 1, 720), key_rhythm_days: num('key_rhythm_days', 7, 730), week_ahead_days: num('week_ahead_days', 1, 60) };
    const threshold = input({ type: 'number', min: 0, value: r.gonogo_threshold_eur ?? '', placeholder: 'da decidere' });
    const gmin = input({ type: 'number', min: 0, max: 100, value: r.gonogo_min_score });
    const qs = h('div.crm-lineedit');
    const addQ = (q = { text: '', weight: 0 }) => {
      const row = h('div.crm-lineedit-row', input({ value: q.text, placeholder: 'Domanda', maxlength: 200, 'data-q': 'text' }),
        input({ type: 'number', min: 0, max: 100, value: q.weight, 'data-q': 'weight', 'aria-label': 'Peso', class: 'crm-w' }),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Togli', on: { click: () => row.remove() } }, icon('x', { size: 14 })));
      qs.append(row);
    };
    r.gonogo_questions.forEach(addQ);
    const discard = lineList(r.discard_reasons, { placeholder: 'Motivo di scarto', max: 120 });
    const lost = lineList(r.lost_reasons, { placeholder: 'Motivo di perdita', max: 120 });
    fill(body, h('div.en-form',
      h('section.card.crm-pad.en-form', h('h3.crm-h3', 'Tempi delle procedure'),
        h('div.crm-set-grid', field('Nota dell\'incontro (ore) · PC-02', nums.meeting_note_hours), field('Qualifica del lead (ore) · PC-01', nums.lead_qualify_hours),
          field('Decisione sui segnali (giorni) · PC-08', nums.signal_decide_days), field('Accettare il piano d\'azione (ore) · PC-10', nums.plan_accept_hours),
          field('Ritmo dei key account (giorni) · PC-03', nums.key_rhythm_days), field('«La mia settimana» guarda avanti (giorni)', nums.week_ahead_days))),
      h('section.card.crm-pad.en-form', h('h3.crm-h3', 'Go/No-Go delle trattative private · PC-04'),
        h('p.small.due-late', 'Da ridiscutere: Dante non è convinto delle 6 domande (14/11). Resta così finché non si decide.'),
        h('div.en-row2', field('Sopra quest\'importo decide la direzione (€)', threshold), field('Punteggio minimo per il Go', gmin)),
        field('Domande e pesi (totale 100)', h('div', qs, h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => addQ() } }, icon('plus', { size: 14 }), 'Aggiungi una domanda')))),
      h('div.en-row2', h('section.card.crm-pad', field('Motivi di scarto dei segnali', discard.el)), h('section.card.crm-pad', field('Motivi di perdita', lost.el))),
      foot('rules', () => save('rules', {
        ...Object.fromEntries(Object.entries(nums).map(([k, el]) => [k, Number(el.value)])),
        gonogo_threshold_eur: threshold.value === '' ? null : Number(threshold.value), gonogo_min_score: Number(gmin.value),
        gonogo_questions: [...qs.children].map(row => ({ text: row.querySelector('[data-q="text"]').value, weight: Number(row.querySelector('[data-q="weight"]').value) || 0 })).filter(q => q.text.trim()),
        discard_reasons: discard.value(), lost_reasons: lost.value(),
      }))));
  }
}
