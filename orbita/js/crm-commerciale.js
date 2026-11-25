// Lavoro commerciale del CRM (Dante 14/11/2026; canvas «Lavoro commerciale · Radar AI · Piani d'azione»), con il
// design v2 dello stesso giorno (artboard «Settimana», «Telefono», «Dialoghi», «Imp-*»):
// «La mia settimana» del responsabile di BU, prossimi passi sulla scheda, key account, impostazioni modificabili.
import { h, fill, modal, confirmDialog, toast, fmtDate, loading } from './ui.js';
import { soaSettings } from './crm-soa-card.js';
import { dupBanner } from './crm-doppioni.js';
import { get, post, put, patch, del } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';
import { openCrmMeeting } from './crm-tabs.js';
import { signalRow, newSignalDialog, openPlan } from './crm-radar.js';
import { ic, dots, pill, av, pageTop, title, kpiRow, card, link, sect, listRow, emptyState, seg, toggle, choiceChips, cvModal, scoreRing, settingsCrumb } from './crm-v2.js';
import { todoRows } from './crm-esiti.js';
import { peoplePicker } from './people.js';

const CHANNELS = { telefonata: 'Telefonata', email: 'Email', incontro: 'Incontro', sopralluogo: 'Sopralluogo', altro: 'Altro' };
const CH_ICON = { telefonata: 'phone', email: 'mail', incontro: 'users', sopralluogo: 'map-pin', altro: 'circle' };
const DAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const plusDays = n => { const d = new Date(`${todayIso()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const longDay = iso => { const d = new Date(`${iso}T12:00:00Z`); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const day = d => (d ? fmtDate(String(d).slice(0, 10)) : '—');
const input = (attrs = {}) => h('input.input', attrs);
const select = (options, value, attrs = {}) => h('select.select', attrs, options.map(([k, label]) => h('option', { value: k, selected: String(k) === String(value ?? '') }, label)));
const textarea = (value, attrs = {}) => h('textarea.input', { rows: 3, ...attrs }, value || '');
const fld = (label, control, hint) => h('label.cv-fld', h('span', label), control, hint ? h('span.cv-hint', hint) : null);
const userOptions = (empty = '—') => [['', empty], ...store.users.filter(u => u.active !== false).map(u => [u.id, u.name])];
const userName = id => store.users.find(u => u.id === Number(id))?.name || '';
const personName = p => [p.title, p.first_name, p.last_name].filter(Boolean).join(' ');

function chipSet(options, selected, { onChange } = {}) {
  const values = new Set(selected);
  const el = h('div.cv-chips', options.map(([k, label]) => h('button.cv-chip', {
    type: 'button', class: values.has(k) ? 'on' : '', 'aria-pressed': String(values.has(k)),
    on: { click: e => {
      values.has(k) ? values.delete(k) : values.add(k);
      e.currentTarget.classList.toggle('on', values.has(k));
      e.currentTarget.setAttribute('aria-pressed', String(values.has(k)));
      e.currentTarget.dispatchEvent(new Event('input', { bubbles: true }));
      onChange?.(values);
    } },
  }, label)));
  return { el, values };
}
// elenco di righe modificabili: aggiungi, togli, sposta su e giù
function lineList(values, { placeholder = '', max = 300, numbered = false } = {}) {
  const rows = h('div.crm-lineedit');
  const renumber = () => numbered && [...rows.children].forEach((r, i) => { r.querySelector('.crm-plan-n').textContent = String(i + 1); });
  const add = (val = '') => {
    const row = h('div.crm-lineedit-row', numbered ? h('span.crm-plan-n') : null,
      h('textarea.input.crm-grow', { rows: 1, placeholder, maxlength: max, 'aria-label': placeholder || 'Voce' }, val),
      h('button.btn.btn-ghost.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Sposta su', on: { click: () => { if (row.previousElementSibling) rows.insertBefore(row, row.previousElementSibling); renumber(); rows.dispatchEvent(new Event('input', { bubbles: true })); } } }, ic('chevron-up', 14)),
      h('button.btn.btn-ghost.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Sposta giù', on: { click: () => { if (row.nextElementSibling) rows.insertBefore(row.nextElementSibling, row); renumber(); rows.dispatchEvent(new Event('input', { bubbles: true })); } } }, ic('chevron-down', 14)),
      h('button.btn.btn-ghost.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Togli', on: { click: () => { rows.dispatchEvent(new Event('input', { bubbles: true })); row.remove(); renumber(); } } }, ic('x', 14)));
    rows.append(row);
    renumber();
    return row;
  };
  values.forEach(x => add(x));
  return {
    el: h('div', rows, h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => add().querySelector('textarea').focus() } }, ic('plus', 14), 'Aggiungi')),
    value: () => [...rows.querySelectorAll('textarea')].map(i => i.value.trim()).filter(Boolean),
  };
}
// parole come pillole con la ×, più un campo per aggiungerne
function tagEditor(values, { placeholder = 'parola', max = 80 } = {}) {
  const list = [...values];
  const el = h('div.cv-chips');
  const add = h('input.cv-tagin', { placeholder: `+ ${placeholder}`, maxlength: max, 'aria-label': `Aggiungi ${placeholder}` });
  const draw = () => {
    fill(el, list.map((w, i) => h('span.cv-chip.on', w, h('button.crm-x', { type: 'button', 'aria-label': `Togli ${w}`, on: { click: () => { list.splice(i, 1); draw(); el.dispatchEvent(new Event('input', { bubbles: true })); } } }, ic('x', 11)))),
      h('span.cv-chip', add));
    add.focus({ preventScroll: true });
  };
  add.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const w = add.value.trim();
    if (w && !list.includes(w)) list.push(w);
    add.value = '';
    draw();
  });
  fill(el, list.map((w, i) => h('span.cv-chip.on', w, h('button.crm-x', { type: 'button', 'aria-label': `Togli ${w}`, on: { click: () => { list.splice(i, 1); draw(); } } }, ic('x', 11)))), h('span.cv-chip', add));
  return { el, value: () => { const w = add.value.trim(); return w && !list.includes(w) ? [...list, w] : [...list]; } };
}

// ── prossimi passi ─────────────────────────────────────────────────────────────────────────────
// Nuovo passo (artboard «Dialoghi»): date rapide come pillole sopra il calendario, «Come» con le icone, chi e con chi,
// la bozza del messaggio solo se serve.
export function stepDialog({ subjectId, subjectName, step = null, contacts = [], defaultOwner = null, contactId = null, onSaved }) {
  const titleIn = input({ value: step?.title || '', placeholder: 'Cosa fare: chiamare l\'ing. Rossi, mandare le referenze…', maxlength: 300 });
  const due = input({ type: 'date', value: step?.due_date?.slice(0, 10) || plusDays(3), 'aria-label': 'Entro quando' });
  const quickOpts = [['1', 'Domani'], ['3', 'Fra 3 giorni'], ['7', 'Fra una settimana'], ['30', 'Fra un mese']];
  const quick = choiceChips(quickOpts, step ? '' : '3', { label: 'Date rapide', onChange: n => { due.value = plusDays(Number(n)); } });
  due.addEventListener('input', () => quick.set(quickOpts.find(([n]) => plusDays(Number(n)) === due.value)?.[0] || ''));
  let channel = step?.channel || 'telefonata';
  const picks = h('div.cv-picks', { role: 'radiogroup', 'aria-label': 'Come' });
  const drawPicks = () => fill(picks, ['telefonata', 'email', 'incontro', 'sopralluogo'].map(k => h('button.cv-pick', {
    type: 'button', role: 'radio', class: channel === k ? 'on' : '', 'aria-checked': String(channel === k), on: { click: () => { channel = channel === k ? '' : k; drawPicks(); } },
  }, ic(CH_ICON[k], 18), CHANNELS[k])));
  drawPicks();
  let people = step ? [step.owner_id, ...(step.people || []).map(p => p.id)].filter(Boolean) : [defaultOwner || store.me.id].filter(Boolean);
  let mode = 'tutti';
  const modeBox = h('div.cv-fld', { hidden: true });
  const drawMode = () => {
    modeBox.hidden = Boolean(step) || people.length < 2;
    const pick = choiceChips([['tutti', 'Uno per tutti'], ['testa', 'Uno a testa']], mode, { label: 'Con più persone', onChange: k => { mode = k; } });
    fill(modeBox, h('span', 'Con più persone'), pick.el, h('span.cv-hint', '«Uno per tutti»: basta che uno lo chiuda. «Uno a testa»: ognuno ha il suo compito.'));
  };
  const suggest = h('div.cv-row.cv-wrap', { style: { gap: '6px' } });
  let picker;
  const drawSuggest = () => fill(suggest, h('span.cv-small.cv-muted', 'Suggeriti:'),
    [[store.me.id, 'Io'], defaultOwner && defaultOwner !== store.me.id ? [defaultOwner, `${userName(defaultOwner)} · owner`] : null].filter(Boolean)
      .filter(([id]) => !people.includes(id))
      .map(([id, label]) => h('button.pill.en-chip', { type: 'button', on: { click: () => { people = [...people, id]; mountPicker(); } } }, label)));
  const pickerBox = h('div');
  const mountPicker = () => {
    picker = peoplePicker({ selected: people, label: '+ Collega', onChange: ids => { people = ids; drawMode(); drawSuggest(); } });
    fill(pickerBox, picker.el);
    drawMode(); drawSuggest();
  };
  mountPicker();
  const note = textarea(step?.note || '', { rows: 2, placeholder: 'Quello che serve sapere a chi lo fa', 'aria-label': 'Note per chi lo fa', maxlength: 2000 });
  const contact = select([['', 'Nessuno in particolare'], ...contacts.map(c => [c.id, personName(c) + (c.job ? ` · ${c.job}` : '')])], step?.contact_id || contactId || '', { 'aria-label': 'Con chi' });
  const draft = textarea(step?.draft || '', { rows: 4, placeholder: 'Il testo dell\'email o cosa dire al telefono' });
  const draftBox = h('div', { hidden: !step?.draft }, fld('Bozza del messaggio', draft));
  const draftLink = link([ic('plus', 14), 'Aggiungi una bozza del messaggio'], { hidden: Boolean(step?.draft), on: { click: () => { draftBox.hidden = false; draftLink.hidden = true; draft.focus(); } } });
  const m = cvModal({
    size: 'md',
    title: h('div', h('h2', step ? 'Modifica il compito' : 'Dai un compito'), subjectName ? h('div.cv-subh', subjectName) : null),
    body: h('div.en-form', fld('Cosa fare', titleIn),
      h('div.cv-fld', h('span', 'A chi · uno o più colleghi'), pickerBox, suggest), modeBox,
      h('div.cv-fld', h('span', 'Entro quando'), quick.el, due),
      h('div.cv-fld', h('span', 'Come'), picks),
      contacts.length ? fld('Con chi', contact) : null,
      fld('Note per chi lo fa', note),
      draftLink, draftBox),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (!titleIn.value.trim()) return toast('Scrivi cosa fare', 'err');
        if (!due.value) return toast('Scegli entro quando', 'err');
        if (!people.length) return toast('Scegli a chi darlo', 'err');
        const body = { title: titleIn.value, due_date: due.value, owner_ids: people, mode, channel, draft: draft.value, note: note.value,
          ...(contacts.length ? { contact_id: contact.value ? Number(contact.value) : null } : {}) };
        if (step) await patch(`/api/crm/steps/${step.id}`, body);
        else await post(`/api/crm/subjects/${subjectId}/steps`, body);
        m.close();
        const others = people.filter(id => id !== store.me.id);
        toast(step ? 'Compito salvato' : others.length ? `Compito dato a ${others.map(userName).map(n => n.split(' ')[0]).join(' e ')}: riceve l'avviso` : 'Compito salvato');
        onSaved?.();
      } } }, step ? 'Salva' : 'Dai il compito')],
  });
  setTimeout(() => titleIn.focus(), 50);
}
// «Fatto» (artboard «Dialoghi»): com'è andata e «E adesso?» con il passo dopo; un lead senza passo aperto non è vivo
export function doneDialog(step, { otherOpen = 0, nextFromPlan = null, onSaved } = {}) {
  const outcome = textarea('', { placeholder: 'Interessati, vogliono un sopralluogo la settimana prossima…', 'aria-label': 'Com\'è andata' });
  const nextTitle = input({ placeholder: 'Il compito dopo (consigliato)', maxlength: 300, 'aria-label': 'Il compito dopo' });
  const nextDue = input({ type: 'date', value: plusDays(7), 'aria-label': 'Entro quando' });
  const when = h('span.cv-small.cv-muted', `· ${longDay(nextDue.value)}`);
  const quick = choiceChips([['3', 'Fra 3 giorni'], ['7', 'Fra una settimana']], '7', { label: 'Date rapide', onChange: n => { nextDue.value = plusDays(Number(n)); when.textContent = `· ${longDay(nextDue.value)}`; } });
  nextDue.addEventListener('input', () => { when.textContent = nextDue.value ? `· ${longDay(nextDue.value)}` : ''; quick.set(''); });
  const save = async withNext => {
    const next = withNext && nextTitle.value.trim() ? { title: nextTitle.value, due_date: nextDue.value } : null;
    if (next && !next.due_date) return toast('Scegli la data del passo dopo', 'err');
    await post(`/api/crm/steps/${step.id}/done`, { outcome: outcome.value, next });
    m.close();
    toast('Fatto');
    onSaved?.();
  };
  const m = cvModal({
    size: 'sm',
    title: h('div', h('h2', 'Compito fatto'), h('div.cv-subh', dots([step.title, step.subject_name]))),
    body: h('div.en-form',
      fld('Com\'è andata?', outcome),
      nextFromPlan ? h('div.cv-box.big', h('div.cv-row', h('span.cv-lbl.cv-grow', 'E adesso?'), pill('dal piano', 'bl')),
        h('div.cv-small', `Il passo dopo è già in agenda: «${nextFromPlan.title}» entro ${day(nextFromPlan.due_date)}.`))
        : h('div.cv-box.big', h('div.cv-lbl', 'E adesso?'), nextTitle, h('div.cv-row.cv-wrap', { style: { gap: '6px' } }, quick.el, when), h('details', h('summary.cv-hint', { style: { cursor: 'pointer' } }, 'Scegli un\'altra data'), nextDue)),
      h('p.cv-hint', otherOpen ? `Ci sono già altri ${otherOpen} compiti aperti su quest'azienda.` : 'Senza un compito aperto l\'azienda torna tra i lead senza prossimo compito.')),
    left: nextFromPlan ? [] : [h('button.btn.btn-ghost', { type: 'button', on: { click: () => save(false) } }, 'Fatto, senza compito dopo')],
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => save(true) } }, ic('check', 15), 'Salva')],
  });
  setTimeout(() => outcome.focus(), 50);
}
// riga di un passo: cerchio «Fatto» a sinistra, data a destra (rossa se scaduto)
export function stepRow(st, { showSubject = false, onChange, contacts = [], otherOpen = 0, siblings = [] } = {}) {
  const late = String(st.due_date).slice(0, 10) < todayIso();
  const nextFromPlan = st.plan_id ? siblings.find(x => x.plan_id === st.plan_id && x.id !== st.id) : null;
  const who = [st.owner_name, ...(st.people || []).map(p => p.name)].filter(Boolean);
  const meta = [showSubject ? h('a', { href: `#/crm/scheda/${st.subject_id}` }, st.subject_name) : null,
    st.channel ? CHANNELS[st.channel].toLowerCase() : null, st.contact_name && `con ${st.contact_name}`,
    st.created_by_name && st.created_by !== st.owner_id ? `dato da ${st.created_by_name.split(' ')[0]}` : null,
    st.plan_id ? 'dal piano d\'azione' : null, st.note ? `«${st.note.length > 90 ? `${st.note.slice(0, 90)}…` : st.note}»` : null].filter(Boolean);
  return h('div.cv-step', { class: showSubject ? '' : 'acts' },
    h('button.cv-ck', { type: 'button', class: late ? 'late' : '', title: 'Segna come fatto', 'aria-label': `Segna come fatto: ${st.title}`, on: { click: () => doneDialog(st, { otherOpen, nextFromPlan, onSaved: onChange }) } }, ic('check', 13)),
    h('div', { style: { minWidth: 0 } },
      h('div.cv-step-t', st.title),
      meta.length || st.draft ? h('div.cv-step-m', meta.flatMap((x, i) => (i ? [' · ', x] : [x])), st.draft ? pill('bozza pronta', 'bl') : null) : null,
      st.draft ? h('details.cv-draft', h('summary', 'Bozza del messaggio'), h('p', st.draft)) : null),
    h('span.cm-when', h('span.cv-date', { class: late ? 'late' : '' }, late && String(st.due_date).slice(0, 10) === plusDays(-1) ? 'ieri' : String(st.due_date).slice(0, 10) === todayIso() ? 'oggi' : day(st.due_date)),
      who.length ? h('span.cm-avs', { title: who.join(', '), 'aria-label': `Lo fa ${who.join(', ')}` }, who.slice(0, 3).map(n => av(n, 'bl')), who.length > 3 ? h('span.cm-more', `+${who.length - 3}`) : null) : null),
    showSubject ? null : h('div.cv-acts',
      h('button.btn.btn-ghost.btn-sm.cv-ico', { type: 'button', 'aria-label': `Modifica ${st.title}`, on: { click: () => stepDialog({ subjectId: st.subject_id, step: st, contacts, onSaved: onChange }) } }, ic('pencil', 14)),
      h('button.btn.btn-ghost.btn-sm.cv-ico', { type: 'button', 'aria-label': `Cancella ${st.title}`, on: { click: async () => {
        if (!await confirmDialog(`Cancellare il compito «${st.title}»?`, { ok: 'Cancella', danger: true })) return;
        await del(`/api/crm/steps/${st.id}`);
        onChange?.();
      } } }, ic('trash', 14))));
}

// sulla scheda dell'azienda, nell'intestazione: il prossimo passo è una riga; «Tutti i passi» apre l'elenco
export function stepsCard(s, refresh, { onNew, onAll } = {}) {
  const box = h('div', { 'aria-live': 'polite' }, h('div.cv-small.cv-muted', 'Compiti…'));
  const contacts = s.contacts.filter(c => !c.date_to);
  let expanded = false;
  const draw = async () => {
    const { open, done } = await get(`/api/crm/subjects/${s.id}/steps`);
    const isLead = s.roles.includes('lead') && s.lead_stage !== 'non_interessato';
    const first = open[0];
    const late = first && String(first.due_date).slice(0, 10) < todayIso();
    const toggleAll = onAll && open.length + done.length ? link(`Tutti i compiti (${open.length + done.length})`, { on: { click: onAll } })
      : open.length + done.length > 1 || done.length ? link(expanded ? 'Chiudi l\'elenco' : `Tutti i compiti (${open.length + done.length})`, { 'aria-expanded': String(expanded), on: { click: () => { expanded = !expanded; draw(); } } }) : null;
    const nLate = open.filter(x => String(x.due_date).slice(0, 10) < todayIso()).length;
    fill(box,
      first ? h('div.cv-next', h('span.cv-ib', { class: late ? 'rd' : 'or' }, ic('alarm-clock', 16)),
        h('div.cv-grow', h('span.cv-t5', 'Prossimo compito: '), h('span', dots([first.title, first.channel && CHANNELS[first.channel].toLowerCase(), first.contact_name, first.owner_name && first.owner_name.split(' ')[0]])),
          open.length > 1 ? h('span.cv-small.cv-muted', ` · ${open.length} aperti${nLate ? ` · ${nLate} scadut${nLate === 1 ? 'o' : 'i'}` : ''}`) : null),
        h('span.cv-date', { class: late ? 'late' : '' }, late ? `scaduto il ${day(first.due_date)}` : `entro ${day(first.due_date)}`),
        h('button.btn.btn-sm.cv-ok', { type: 'button', on: { click: () => doneDialog({ ...first, subject_name: s.name }, { otherOpen: open.length - 1, nextFromPlan: first.plan_id ? open.find(x => x.plan_id === first.plan_id && x.id !== first.id) : null, onSaved: refresh }) } }, ic('check', 14), 'Fatto'),
        toggleAll)
        : h('div.cv-next', h('span.cv-ib', ic('alarm-clock', 16)),
          h('div.cv-grow', h('span.cv-t5', 'Nessun compito aperto'), isLead ? h('span.cv-muted', ' · senza un prossimo compito il lead non è vivo') : null),
          h('button.btn.btn-sm', { type: 'button', on: { click: onNew } }, ic('plus', 14), 'Aggiungi'), toggleAll),
      expanded ? h('div', { style: { margin: '6px -28px -24px' } },
        open.map(st => stepRow(st, { onChange: refresh, contacts, otherOpen: open.length - 1, siblings: open })),
        done.length ? [h('div.cv-sect', `Fatti · ${done.length}`), done.map(st => h('div.cv-step', { class: 'acts' }, h('span.cv-ck.done', ic('check', 13)),
          h('div', { style: { minWidth: 0 } }, h('div.cv-step-t', { style: { color: 'var(--cv-faint)', textDecoration: 'line-through' } }, st.title), h('div.cv-step-m', dots([`fatto il ${day(st.done_at)}`, st.done_by_name, st.outcome && `«${st.outcome}»`]))),
          h('span'), h('div.cv-acts', h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/crm/steps/${st.id}/reopen`); refresh(); } } }, 'Riapri'))))] : null) : null);
  };
  draw().catch(() => fill(box, h('div.cv-small.cv-muted', 'Prossimi passi non disponibili.')));
  return box;
}

// key account (artboard «Dialoghi»): interruttore e ritmo come pillole 30 / 60 / 90 giorni, con l'anteprima
export function keyAccountDialog(s, refresh, defaultRhythm = 90) {
  const on = toggle(true, 'È un key account della BU'); // si apre per segnarlo; per toglierlo si spegne
  const cur = s.key_rhythm_days || defaultRhythm;
  const preset = ['30', '60', '90'].includes(String(cur)) ? String(cur) : 'altro';
  const other = input({ type: 'number', min: 7, max: 730, value: preset === 'altro' ? cur : '', placeholder: 'giorni', 'aria-label': 'Ogni quanti giorni', style: { width: '120px' }, hidden: preset !== 'altro' });
  const preview = h('div.cv-small');
  const days = () => (rhythm.value === 'altro' ? Number(other.value) || defaultRhythm : Number(rhythm.value));
  const drawPreview = () => fill(preview, on.input.checked ? ['Se nessuno lo sente per ', h('b', `${days()} giorni`), ', compare in «La mia settimana» di chi lo segue. Oggi vorrebbe dire: entro ', h('b', longDay(plusDays(days()))), '.'] : 'Non è un key account: niente promemoria.');
  const rhythm = choiceChips([['30', '30 giorni'], ['60', '60 giorni'], ['90', '90 giorni'], ['altro', 'Altro…']], preset, { label: 'Sentirlo almeno ogni', onChange: k => { other.hidden = k !== 'altro'; drawPreview(); } });
  other.addEventListener('input', drawPreview);
  on.input.addEventListener('change', drawPreview);
  drawPreview();
  const m = cvModal({
    size: 'sm',
    title: h('div', h('h2', 'Key account'), h('div.cv-subh', s.name)),
    body: h('div.en-form', h('div.cv-row', { style: { justifyContent: 'space-between' } }, on.el),
      h('div.cv-fld', h('span', 'Sentirlo almeno ogni'), rhythm.el, other),
      h('div.cv-row.cv-soft', h('span.cv-ib', ic('clock', 16)), preview)),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        const n = days();
        await post(`/api/crm/subjects/${s.id}/key-account`, { key_account: on.input.checked, key_rhythm_days: n === defaultRhythm ? null : n });
        m.close();
        refresh();
      } } }, 'Salva')],
  });
}
// pillola nell'intestazione della scheda: grafite se è key account, tratteggiata se no
export function keyAccountPill(s, refresh, defaultRhythm = 90) {
  return h('button.cv-pill', { type: 'button', class: s.key_account ? 'dark' : 'line', title: 'Key account: azienda su cui la BU punta, con un ritmo di contatto',
    style: s.key_account ? {} : { borderStyle: 'dashed', color: 'var(--cv-muted)' },
    on: { click: () => keyAccountDialog(s, refresh, defaultRhythm) } },
  ic('star', 11), s.key_account ? `Key account · ogni ${s.key_rhythm_days || defaultRhythm} gg` : 'Key account?');
}

// ── la mia settimana (artboard «Settimana» e «Telefono») ──────────────────────────────────────
export async function weekTab(box, data, { userId = null } = {}) {
  fill(box, loading());
  const w = await get(`/api/crm/settimana${userId ? `?user=${userId}` : ''}`);
  const again = () => weekTab(box, data, { userId });
  const today = todayIso();
  const sunday = (() => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7)); return d.toISOString().slice(0, 10); })();
  const late = w.steps.filter(s => s.late);
  const asaName = k => data.asa.find(a => a.key === k)?.label || k;
  const self = w.user.id === store.me.id;
  // segnali e piani da accettare: quelli di chi guarda (la settimana di un altro li mostra solo a lui)
  const [sig, plans, gare, todoOut] = self ? await Promise.all([
    get('/api/crm/radar/signals').catch(() => null), get('/api/crm/radar/plans').catch(() => ({ plans: [] })),
    data.gare ? get('/api/crm/radar/signals?view=gare').catch(() => null) : null,
    get('/api/crm/esiti/da-registrare?mine=1').catch(() => ({ items: [] }))]) : [null, { plans: [] }, null, { items: [] }];
  const signals = sig?.signals || [];
  const hi = sig?.highlight ?? 70;
  const toAccept = plans.plans.filter(p => p.status === 'proposto');
  const strong = signals.filter(g => g.score >= hi).length;

  // la frase in alto: cosa fare oggi
  const hour = Number(new Date().toLocaleString('it-IT', { hour: 'numeric', hour12: false, timeZone: 'Europe/Rome' }));
  const hello = hour < 13 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const first = (w.user.name || '').split(' ')[0];
  const bits = [late.length ? h('b.rd', `${late.length} ${late.length === 1 ? 'passo scaduto' : 'passi scaduti'}`) : null,
    strong ? `${strong} ${strong === 1 ? 'segnale in evidenza' : 'segnali in evidenza'} da decidere` : null,
    toAccept.length ? `${toAccept.length} ${toAccept.length === 1 ? 'primo passo pronto' : 'primi passi pronti'} da approvare` : null].filter(Boolean);
  const sentence = self ? [`${hello} ${first}: `, ...(bits.length ? bits.flatMap((b, i) => (i ? [i === bits.length - 1 ? ' e ' : ', ', b] : [b])) : ['niente di urgente oggi']), '.']
    : [`La settimana di ${w.user.name}: `, ...(bits.length ? bits.flatMap((b, i) => (i ? [', ', b] : [b])) : ['niente di urgente']), '.'];

  const who = data.admin ? h('label.btn', { style: { paddingLeft: '8px', gap: '8px' } }, av(w.user.name, 'or'), h('span.cv-sr', 'Settimana di'),
    select(userOptions('Io').map(([k, l]) => [k, k === '' ? store.me.name : l]), userId || '', { style: { border: 0, background: 'transparent', boxShadow: 'none', minHeight: '0', padding: '0 4px', font: 'inherit', fontWeight: '500', color: 'inherit' },
      on: { change: e => weekTab(box, data, { userId: Number(e.target.value) || null }) } })) : null;
  const scrollTo = id => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // segnali: «In evidenza» (≥ soglia) e «Altri», filtro per BU, un solo rigo di dettagli
  let buFilter = '';
  let showAll = false;
  const sigBody = h('div');
  const drawSignals = () => {
    const list = signals.filter(g => !buFilter || g.bu === buFilter);
    if (!list.length) {
      return fill(sigBody, w.radar.on.length ? emptyState('radar', `Nessun segnale da decidere per ${w.radar.on.map(asaName).join(', ')}. Il radar legge le fonti ogni notte; puoi anche segnalare tu un'occasione.`, h('button.btn.btn-sm', { type: 'button', on: { click: () => newSignalDialog(data, again) } }, 'Segnala'))
        : w.bus.length ? emptyState('radar', `Il radar di ${w.bus.map(asaName).join(', ')} è spento: nel pilota sono accese ${w.radar.pilot.map(asaName).join(', ')}.`, data.admin ? h('a.btn.btn-sm', { href: '#/crm/impostazioni/radar' }, 'Accendi') : null)
          : emptyState('radar', 'I segnali del radar arrivano ai responsabili di BU, scelti in Impostazioni → Profili BU.'));
    }
    const top = list.filter(g => g.score >= hi);
    const rest = list.filter(g => g.score < hi);
    const cap = showAll ? Infinity : 5;
    const shownTop = top.slice(0, cap);
    const shownRest = rest.slice(0, Math.max(0, cap - shownTop.length));
    const row = g => signalRow(g, { highlight: hi, reasons: sig.discardReasons, onChange: again, data, list });
    fill(sigBody,
      shownTop.length ? [h('div.cv-sect', `In evidenza · ${hi} e oltre`), shownTop.map(row)] : null,
      shownRest.length ? [h('div.cv-sect', 'Altri'), shownRest.map(row)] : null,
      list.length > shownTop.length + shownRest.length ? h('div.cv-more-row', link([`Mostra altri ${list.length - shownTop.length - shownRest.length} segnali`, ic('chevron-down', 14)], { on: { click: () => { showAll = true; drawSignals(); } } })) : null);
  };
  const bus = [...new Set(signals.map(g => g.bu).filter(Boolean))];
  const radarCard = card({ title: 'Segnali del radar', icon: 'radar', count: signals.length, attrs: { id: 'cv-wk-signals' },
    right: [bus.length > 1 ? seg([['', 'Tutte le BU'], ...bus.map(b => [b, asaName(b), signals.filter(g => g.bu === b).length])], '', k => { buFilter = k; drawSignals(); }, { label: 'BU' }) : null,
      self && w.bus.length ? h('a.cv-lnk', { href: '#/crm/sottosoglia' }, 'Sotto soglia') : null] }, sigBody);
  drawSignals();

  // prossimi passi raggruppati: Scaduti / Oggi / Questa settimana / Più avanti
  const groups = [['Scaduti', w.steps.filter(s => s.late), true], ['Oggi', w.steps.filter(s => s.due_date === today)],
    ['Questa settimana', w.steps.filter(s => !s.late && s.due_date > today && s.due_date <= sunday)], ['Più avanti', w.steps.filter(s => s.due_date > sunday)]].filter(g => g[1].length);
  const stepsCardEl = card({ title: 'Prossimi passi', icon: 'alarm-clock', count: w.steps.length, attrs: { id: 'cv-wk-steps' } },
    w.steps.length ? groups.map(([l, list, red]) => [sect(l, red), list.map(st => stepRow(st, { showSubject: true, onChange: again, siblings: w.steps }))])
      : emptyState('alarm-clock', `Niente in scadenza fino al ${day(w.until)}. Ogni lead e cliente attivo dovrebbe avere un prossimo passo.`));

  const side = [];
  const CH_VERB = { telefonata: 'telefonata', email: 'email', incontro: 'incontro', sopralluogo: 'sopralluogo' };
  const readyCard = toAccept.length ? card({ title: 'Pronti da approvare', icon: 'sparkles', count: toAccept.length, attrs: { id: 'cv-wk-plans' }, right: h('span.cv-small.cv-muted', 'scritti dal CRM, li cambi come vuoi') },
    toAccept.map(p => {
      const s0 = p.steps[0] || {};
      const prob = p.probability && !p.probability.learning ? pill(`${p.probability.p}% di vittoria`, 'gr') : null;
      return h('div.cv-li.cv-ready',
        h('span.cv-ib.or', { 'aria-hidden': 'true' }, ic('sparkles', 16)),
        h('button.cv-li-main', { type: 'button', on: { click: () => openPlan(p.id, again) } },
          h('div.cv-li-t', h('span.cv-ell', s0.title || p.title)),
          h('div.cv-li-m', dots([p.subject_name, p.signal_title || p.title])),
          h('div.cv-row.cv-wrap.cv-small', { style: { gap: '10px', marginTop: '6px' } },
            p.level === 'forte' || p.level === 'media' ? h('span.cv-warm', { class: p.level === 'forte' ? 'f' : 'm' }, p.level === 'forte' ? ic('flame', 12) : null, 'li conosciamo') : null,
            s0.channel ? h('span.cv-row.cv-muted', { style: { gap: '4px' } }, ic(s0.channel === 'telefonata' ? 'phone' : s0.channel === 'email' ? 'mail' : 'users', 13), CH_VERB[s0.channel] || s0.channel) : null,
            s0.due_date ? h('span.cv-row.cv-muted', { style: { gap: '4px' } }, ic('calendar', 13), day(s0.due_date)) : null, prob)),
        h('div.cv-acts',
          h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => openPlan(p.id, again) } }, s0.draft ? [ic('mail', 14), 'Vedi email'] : 'Apri'),
          h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async e => { e.currentTarget.disabled = true; await post(`/api/crm/plans/${p.id}/accept`, {}); toast('Approvato: il primo passo è nei prossimi passi'); again(); } } }, ic('check', 14), 'Approva')));
    })) : null;
  // ALM2-76 (tavola 3): progettisti delle opportunità seguite, con il passo proposto da approvare
  if (w.designers?.length) {
    side.unshift(card({ title: 'Progettisti nuovi da conoscere', icon: 'pencil-ruler', count: w.designers.length, attrs: { id: 'cv-wk-designers' } },
      w.designers.map(dz => h('div.cv-li', { style: { display: 'grid', gap: '8px' } },
        h('div.cv-row', { style: { gap: '10px' } }, av(dz.capo.name, 'bl'),
          h('div.cv-grow', { style: { minWidth: 0 } }, h('a.cv-li-t', { href: `#/crm/scheda/${dz.capo.subject_id}` }, dz.capo.name),
            h('div.cv-li-m', dots([`progetta ${dz.title}`, dz.amount ? `${Number(dz.amount).toLocaleString('it-IT')} €` : '', dz.expected_on ? `gara attesa ${day(dz.expected_on)}` : 'gara attesa da capire', dz.confirmed ? '' : 'da confermare']))),
          dz.knows[0] ? pill(`${dz.knows[0].user_name.split(' ')[0]} lo conosce`, 'gr') : null),
        dz.step ? h('div.cv-soft.cv-small', 'Passo proposto: ', h('b', dz.step.title), ` entro ${dz.step.within_days || 7} giorni. Il progettista sceglie materiali e capitolato: conoscerlo prima del bando dei lavori conta.`) : null,
        h('div.cv-row', { style: { gap: '8px' } },
          dz.step ? h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async e => { e.currentTarget.disabled = true; await post(`/api/crm/radar/signals/${dz.id}/progettista/passo`, {}); toast('Passo approvato: è nei prossimi passi'); again(); } } }, 'Approva il passo') : null,
          h('a.btn.btn-sm', { href: `#/crm/scheda/${dz.capo.subject_id}` }, 'Cambia'))))));
  }
  if (todoOut.items.length) {
    side.push(card({ title: 'Esiti da registrare', icon: 'trophy', count: todoOut.items.length, right: h('a.cv-lnk', { href: '#/crm/esiti' }, 'Vinte e perse') }, todoRows(todoOut.items.slice(0, 5), again)));
  }
  if (gare?.signals?.length) {
    side.push(card({ title: 'Ufficio gare', icon: 'inbox', count: gare.signals.length, right: h('a.cv-lnk', { href: '#/crm/gare' }, 'Apri la coda') },
      listRow({ icon: 'inbox', tone: 'bl', title: `${gare.signals.length} gare proposte dal radar`, meta: 'da guardare prima della riunione del mercoledì', href: '#/crm/gare' })));
  }
  if (w.business?.length) {
    side.push(card({ title: 'Nuovi business', icon: 'zap', count: w.business.length, right: h('a.cv-lnk', { href: '#/crm/business' }, 'Iniziative') },
      w.business.map(t => h('div.cv-step',
        h('button.cv-ck', { type: 'button', class: t.late ? 'late' : '', title: 'Segna come fatto', 'aria-label': `Segna come fatto: ${t.title}`, on: { click: async () => { await patch(`/api/crm/business/tasks/${t.id}`, { done: true }); toast('Fatto'); again(); } } }, ic('check', 13)),
        h('div', { style: { minWidth: 0 } }, h('div.cv-step-t', t.title), h('div.cv-step-m', h('a', { href: `#/crm/business/${t.initiative_id}` }, t.initiative_name))),
        h('span.cv-date', { class: t.late ? 'late' : '' }, t.due_date ? (t.late && t.due_date === plusDays(-1) ? 'ieri' : day(t.due_date)) : 'senza data')))));
  }
  let allMeetings = false;
  const meetBody = h('div');
  const drawMeetings = () => fill(meetBody, w.missingNotes.length ? w.missingNotes.slice(0, allMeetings ? 50 : 3).map(m => listRow({ icon: 'calendar', tone: 'rd', title: m.subject || 'Incontro',
    meta: dots([day(m.start_at), m.who]), onClick: () => openCrmMeeting(m.id, again),
    actions: [h('button.btn.btn-sm', { type: 'button', on: { click: () => openCrmMeeting(m.id, again) } }, ic('pencil', 14), 'Nota')] })) : emptyState('calendar', 'Nessun incontro da completare.'));
  drawMeetings();
  side.push(card({ title: 'Incontri senza note', icon: 'calendar', count: w.missingNotes.length || null, attrs: { id: 'cv-wk-meetings' },
    right: w.missingNotes.length > 3 ? link('Tutti', { on: { click: e => { allMeetings = !allMeetings; e.currentTarget.textContent = allMeetings ? 'Meno' : 'Tutti'; drawMeetings(); } } }) : null }, meetBody));
  side.push(card({ title: 'Key account da sentire', icon: 'star', count: w.keyAccounts.silent.length || null, attrs: { id: 'cv-wk-keys' } },
    w.keyAccounts.silent.length ? w.keyAccounts.silent.map(k => listRow({ icon: 'star', tone: 'or', title: k.name, href: `#/crm/scheda/${k.id}`,
      meta: k.last_contact ? `ultimo contatto ${day(k.last_contact)} · ${k.days} giorni fa` : 'mai sentito da quando è nel CRM', actions: [h('span.cv-date.late', `ritmo ${k.rhythm} gg`)] }))
      : emptyState('star', w.keyAccounts.total ? 'Tutti sentiti nel loro ritmo.' : 'Nessun key account. Si segnano dalla scheda dell\'azienda.')));
  side.push(card({ title: 'Lead senza prossimo passo', icon: 'target', count: w.leadsWithoutStep.total || null, attrs: { id: 'cv-wk-leads' } },
    w.leadsWithoutStep.total ? listRow({ title: h('span.cv-small.cv-muted', { style: { whiteSpace: 'normal', fontWeight: 400 } }, 'Quasi tutti arrivano dal caricamento di Zoho: assegnali ai responsabili di BU o chiudili.'),
      actions: [h('a.btn.btn-sm', { href: '#/crm/lead/riordina' }, 'Assegna o chiudi')] })
      : emptyState('check', 'Tutti i tuoi lead hanno un prossimo passo.')));

  fill(box,
    pageTop({ eyebrow: ['Alma CRM', pill(longDay(today), 'line')], heading: title('La mia', 'settimana'), sub: h('span', sentence),
      actions: [who, h('button.btn.btn-primary', { type: 'button', on: { click: () => newSignalDialog(data, again) } }, ic('plus', 15), 'Segnala un\'opportunità')] }),
    self && new Date().getDay() === 1 ? dupBanner('subject') : null, // il lunedì: i doppioni delle mie aziende (canvas v15)
    kpiRow([
      { icon: 'alarm-clock', n: late.length, label: ['passi', 'scaduti'], tone: 'hot', onClick: scrollTo('cv-wk-steps') },
      self ? { icon: 'radar', n: signals.length, label: ['segnali', 'da decidere'], tone: 'or', onClick: scrollTo('cv-wk-signals') } : null,
      self ? { icon: 'sparkles', n: toAccept.length, label: [toAccept.length === 1 ? 'primo passo' : 'primi passi', 'da approvare'], onClick: scrollTo('cv-wk-plans') } : null,
      { icon: 'calendar', n: w.missingNotes.length, label: ['incontri', 'senza note'], onClick: scrollTo('cv-wk-meetings') },
      { icon: 'target', n: w.leadsWithoutStep.total, label: ['lead senza', 'prossimo passo'], href: '#/crm/lead/riordina' },
      { icon: 'star', n: w.keyAccounts.silent.length, label: ['key account', 'da sentire'], onClick: scrollTo('cv-wk-keys') },
    ]),
    h('div.cv-cols', h('div.cv-stack', readyCard, radarCard, stepsCardEl), h('div.cv-stack', side)));
}

// ── impostazioni del lavoro commerciale (solo direzione; artboard «Imp-radar», «Imp-punteggio», «Imp-regole», «Imp-asa») ─
// Menu a sinistra con una riga di spiegazione, interruttori al posto delle caselle, barra scura «Modifiche non salvate».
const SECTIONS = [['radar', 'Radar', 'BU accese, budget, giro notturno', 'radar'], ['scoring', 'Punteggio', 'pesi e soglie', 'target'],
  ['primo_passo', 'Primo passo', 'tono, firma, quando prepararlo', 'sparkles'], ['relazioni', 'Relazioni', 'come si misura la forza', 'users'], ['esiti', 'Esiti', 'motivi, probabilità, BOSS', 'trophy'],
  ['prima_bando', 'Prima del bando', 'secondo giro del radar, vinte da altri', 'hourglass'], ['concorrenza', 'Concorrenza', 'dati ANAC, CPV, Almacis', 'scale'], ['soa', 'SOA delle aziende', 'da ANAC con la P.IVA', 'badge-check'],
  ['profiles', 'Profili BU', 'cosa cerca ogni BU', 'users'],
  ['sources', 'Fonti', 'Infordat, ANAC, stampa…', 'inbox'], ['playbooks', 'Playbook', 'passi per tipo di segnale', 'list'], ['rules', 'Regole e tempi', 'procedure, Go/No-Go, motivi', 'clock'],
  ['asa', 'ASA e accessi', 'chi è di quale ASA', 'key-round'], ['zoho', 'Caricamento Zoho', 'primo caricamento', 'upload']];
const WEIGHTS = [['fit', 'Coerenza con la BU', 'lavoro, SOA, importo, zona'], ['concreteness', 'Concretezza', 'atto ufficiale → indiscrezione'],
  ['timing', 'Tempi', 'entro 12 mesi → oltre 24'], ['relationship', 'Rapporto', 'rapporto forte o cliente → sconosciuto'], ['value', 'Valore', 'dentro la fascia della BU']];

export async function settingsTab(box, data, section = 'radar', { asaTab, importCard } = {}) {
  if (!SECTIONS.some(([k]) => k === section)) section = 'radar';
  fill(box, loading());
  const view = await get('/api/crm/commerciale');
  const st = view.settings;
  const asaOpts = view.asa.map(a => [a.key, a.label]);
  const go = k => { history.replaceState(null, '', `#/crm/impostazioni/${k}`); settingsTab(box, data, k, { asaTab, importCard }); };
  let onSave = null;
  let changes = 0;
  const changeText = h('span.cv-grow.cv-small');
  const bar = h('div.cv-savebar', { hidden: true, role: 'status' }, changeText,
    h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => go(section) } }, 'Annulla'),
    h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => onSave?.() } }, 'Salva'));
  const dirty = () => { if (!onSave) return; changes += 1; bar.hidden = false; changeText.textContent = 'Modifiche non salvate'; };
  const save = async (key, value) => { await put(`/api/crm/commerciale/${key}`, { value }); toast('Impostazioni salvate'); go(section); };
  const reset = key => h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => {
    if (!await confirmDialog('Tornare ai valori di partenza per questa sezione? Le modifiche salvate si perdono.', { ok: 'Torna ai valori di partenza' })) return;
    await del(`/api/crm/commerciale/${key}`);
    toast('Valori di partenza');
    go(section);
  } } }, 'Valori di partenza');
  const savedLine = key => h('div.cv-row.cv-small.cv-muted', { style: { gap: '8px' } },
    h('span.cv-grow', st.saved?.[key] ? `Modificato il ${day(st.saved[key].at)}${st.saved[key].by ? ` da ${userName(st.saved[key].by) || '—'}` : ''}` : 'Valori di partenza del documento «Approccio commerciale Almacis»'),
    st.saved?.[key] ? reset(key) : null);
  const nav = h('nav.cv-snav', { 'aria-label': 'Sezioni delle impostazioni' }, SECTIONS.map(([k, l, s2, i]) => h('button', { type: 'button', class: k === section ? 'on' : '', 'aria-current': k === section ? 'page' : undefined, on: { click: () => go(k) } },
    ic(i, 17), h('span', h('span', l), h('span.s2', s2)))));
  const body = h('div.cv-sbody');
  body.addEventListener('input', dirty);
  body.addEventListener('change', dirty);
  fill(box,
    settingsCrumb('Alma CRM'),
    pageTop({ eyebrow: 'Alma CRM · direzione', heading: title('', 'Impostazioni', 'del CRM'), sub: 'Tutto quello che decide come lavora il CRM commerciale. I promemoria cambiano subito, il radar dal giorno dopo.' }),
    h('div.cv-settings', nav, h('div.cv-sbody', body, bar)));

  if (section === 'asa') { onSave = null; return asaTab?.(body); }
  if (section === 'zoho') { onSave = null; return fill(body, importCard?.()); }
  if (section === 'soa') { onSave = null; return soaSettings(body); } // canvas v14

  if (section === 'radar') {
    const r = st.radar;
    const status = await get('/api/crm/radar/status').catch(() => ({ ai: false, spend: [], runs: [] }));
    const spent = k => Number(status.spend.find(x => x.bu === k)?.eur || 0);
    const budget = input({ type: 'number', min: 0, max: 10000, value: r.budget_eur, 'aria-label': 'Budget mensile (€)' });
    const hour = input({ type: 'number', min: 0, max: 23, value: r.run_hour, 'aria-label': 'Ora del giro notturno' });
    const alert = toggle(r.alert_admins_on_budget, 'Avvisa la direzione quando una BU finisce la quota');
    const gare = new Set(r.gare_users || []);
    const gareBox = h('div.cv-chips');
    const drawGare = () => fill(gareBox, [...gare].map(id => h('span.cv-pill.line.big', av(userName(id), 'or'), userName(id) || '—',
      h('button.crm-x', { type: 'button', 'aria-label': `Togli ${userName(id)}`, on: { click: () => { gare.delete(id); drawGare(); dirty(); } } }, ic('x', 12)))),
    select(userOptions('+ Aggiungi'), '', { 'aria-label': 'Aggiungi all’ufficio gare', style: { width: 'auto', minHeight: '30px', height: '30px', borderRadius: '999px', fontSize: '12.5px' },
      on: { change: e => { if (e.target.value) gare.add(Number(e.target.value)); drawGare(); } } }));
    drawGare();
    const total = view.asa.reduce((t, a) => t + spent(a.key), 0);
    const rows = view.asa.map(a => {
      const b = r.bu[a.key] || { on: false, quota_eur: 0 };
      const on = toggle(b.on, null, { 'aria-label': `Radar acceso per ${a.label}` });
      const quota = input({ type: 'number', min: 0, max: 10000, value: b.quota_eur, 'aria-label': `Quota di ${a.label} (€)`, style: { width: '84px', minHeight: '32px', height: '32px', textAlign: 'right' } });
      const mgr = st.profiles[a.key]?.manager?.name || '';
      const s = spent(a.key);
      const pct = b.quota_eur ? Math.min(100, Math.round((100 * s) / b.quota_eur)) : 0;
      return { key: a.key, on: on.input, quota, tr: h('tr',
        h('td', h('div.cv-row', { style: { gap: '10px' } }, on.el, h('span.cv-t5', a.label), view.pilot.includes(a.key) ? pill('pilota', 'or') : null)),
        h('td', mgr ? h('div.cv-row', { style: { gap: '8px' } }, av(mgr, 'bl'), h('span.cv-small', mgr)) : h('span.cv-small.cv-muted', st.profiles[a.key]?.manager_name || 'da assegnare')),
        h('td.cv-hide-m', { style: { width: '240px' } }, h('div.cv-row', { style: { gap: '8px' } }, h('span.cv-bar.cv-grow', { class: b.quota_eur && s >= b.quota_eur ? 'rd' : '' }, h('i', { style: { width: `${pct}%` } })),
          h('span.cv-small.cv-muted', { style: { width: '64px' } }, `${s.toLocaleString('it-IT', { maximumFractionDigits: 2 })} €`))),
        h('td.num', quota)) };
    });
    const radarValue = () => ({ budget_eur: Number(budget.value), run_hour: Number(hour.value), alert_admins_on_budget: alert.input.checked, gare_users: [...gare],
      bu: Object.fromEntries(rows.map(x => [x.key, { on: x.on.checked, quota_eur: Number(x.quota.value) || 0 }])) });
    const finished = status.spend.filter(x => x.alerted_at);
    const last = status.runs[0];
    fill(body,
      h('section.cv-card.pad', { style: { gap: '12px' } },
        h('div.cv-row', h('span.cv-ib', { class: status.ai ? 'gr' : 'rd' }, ic('sparkles', 16)),
          h('div.cv-grow', h('div.cv-t5', `Lettura delle notizie con l'AI · ${status.ai ? 'accesa' : 'spenta'}`),
            h('div.cv-small.cv-muted', status.ai ? dots([`OpenAI ${status.model || ''}`.trim(), last ? `ultimo giro ${day(last.at)}${last.bu ? ` (${view.asa.find(a => a.key === last.bu)?.label || last.bu})` : ''}${last.error ? ` · errore: ${last.error}` : ''}` : 'nessun giro ancora', `prossimo stanotte alle ${r.run_hour}`])
              : 'Manca la chiave OpenAI (OPENAI_API_KEY su Railway). Senza chiave il radar lavora con l’export di Infordat e le segnalazioni a mano.')),
          status.ai ? h('button.btn', { type: 'button', on: { click: async e => {
            e.currentTarget.disabled = true;
            // gli interruttori cambiati e non ancora salvati valgono già per questo giro (14/11: tornavano spenti)
            if (changes) { try { await put('/api/crm/commerciale/radar', { value: radarValue() }); changes = 0; bar.hidden = true; } catch { e.currentTarget.disabled = false; return; } }
            const out = await post('/api/crm/radar/run', {}).catch(() => null);
            if (out) toast(out.runs.map(x => `${view.asa.find(a => a.key === x.bu)?.label || x.bu}: ${x.skipped || `${x.added} segnali nuovi${x.error ? ' (errore)' : ''}`}`).join(' · ') || 'Nessuna BU accesa');
            go(section);
          } } }, ic('refresh', 15), 'Avvia adesso') : null),
        finished.map(x => h('div.cv-row.cv-wrap', { style: { background: 'var(--cv-or-t)', borderRadius: '14px', padding: '12px 14px' } }, h('span.cv-ib.or', ic('alert-triangle', 16)),
          h('div.cv-grow.cv-small', h('b', `${view.asa.find(a => a.key === x.bu)?.label || x.bu} ha finito il budget del radar (${r.bu[x.bu]?.quota_eur ?? 0} €).`), ' Fino a quando non decidi riceve solo i segnali dai dati pubblici.'),
          h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: e => e.currentTarget.parentElement.remove() } }, 'Lascia così'),
          h('button.btn.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/crm/radar/budget/${x.bu}`, { eur: 10 }); toast('Quota aumentata di 10 €'); go(section); } } }, 'Aumenta di 10 €')))),
      card({ title: 'BU del radar', right: h('span.cv-small.cv-muted', `${MONTHS[new Date().getMonth()].replace(/^./, c => c.toUpperCase())} · speso `, h('b', { style: { color: 'var(--cv-ink)' } }, `${total.toLocaleString('it-IT', { maximumFractionDigits: 2 })} €`), ` di ${r.budget_eur} €`) },
        h('div.cv-tblwrap', h('table.cv-tbl', h('thead', h('tr', h('th', 'BU'), h('th', 'Responsabile'), h('th.cv-hide-m', 'Speso / quota'), h('th.num', 'Quota'))), h('tbody', rows.map(x => x.tr))))),
      h('section.cv-card.pad', h('div.cv-grid3', fld('Budget mensile (€)', budget, 'Arrivato al tetto il radar si ferma fino al mese dopo.'), fld('Ora del giro notturno', hour, 'Il radar legge le fonti una volta al giorno.'),
        h('div.cv-fld', h('span', 'Ufficio gare'), gareBox, h('span.cv-hint', 'Vedono «Proposte dal radar» e caricano l’export di Infordat.'))), alert.el),
      savedLine('radar'));
    onSave = () => save('radar', radarValue());
  } else if (section === 'scoring') {
    const sc = st.scoring;
    const totalPill = h('span');
    const ex = h('div');
    const sample = await get('/api/crm/radar/signals').then(r => r.signals[0]).catch(() => null);
    const sampleFull = sample ? await get(`/api/crm/radar/signals/${sample.id}`).catch(() => null) : null;
    const ws = WEIGHTS.map(([k, l, hint]) => {
      const range = h('input', { type: 'range', min: 0, max: 60, step: 1, value: sc.weights[k], 'aria-label': l });
      const val = h('b', String(sc.weights[k]));
      range.addEventListener('input', () => { val.textContent = range.value; draw(); });
      return { k, range, el: h('div.cv-slider', h('div', h('div.cv-t5.cv-small', l), h('div.cv-hint', hint)), range, val) };
    });
    const hiIn = input({ type: 'number', min: 0, max: 100, value: sc.highlight, 'aria-label': 'In evidenza da' });
    const minIn = input({ type: 'number', min: 0, max: 100, value: sc.min, 'aria-label': 'Punteggio minimo' });
    const draw = () => {
      const tot = ws.reduce((t, w) => t + Number(w.range.value), 0);
      fill(totalPill, pill(`totale ${tot}`, tot === 100 ? 'gr' : 'rd'));
      if (!sampleFull) return fill(ex, emptyState('radar', 'L\'esempio dal vivo compare quando c\'è almeno un segnale da decidere.'));
      const parts = sampleFull.score_parts || {};
      const old = sampleFull.weights || {};
      const score = Math.round(ws.reduce((t, w) => t + (old[w.k] ? (Number(parts[w.k] || 0) / old[w.k]) * Number(w.range.value) : 0), 0));
      const hiN = Number(hiIn.value) || 70;
      fill(ex, h('div.cv-row', scoreRing(score, { size: 'lg', hi: hiN }), h('div.cv-grow', h('div.cv-t5', sampleFull.title), h('div.cv-small.cv-muted', dots([sampleFull.bu_label, sampleFull.amount ? `${Number(sampleFull.amount).toLocaleString('it-IT')} €` : null])))),
        h('div.cv-small.cv-muted', 'Con questi pesi ', h('b', { style: { color: 'var(--cv-ink)' } }, score >= hiN ? 'resta in evidenza' : score >= (Number(minIn.value) || 0) ? 'arriva fra gli «Altri»' : 'finisce sotto soglia'), ` (oggi vale ${sampleFull.score}).`));
    };
    hiIn.addEventListener('input', draw);
    minIn.addEventListener('input', draw);
    draw();
    fill(body,
      h('div.cv-cols.cv-split',
        h('section.cv-card.pad', h('div.cv-row', h('div.cv-t5.cv-grow', { style: { fontSize: '15px' } }, 'Pesi del punteggio'), totalPill),
          h('p.cv-small.cv-muted', 'Ogni segnale prende da 0 a 100 punti: la somma di cinque criteri. I pesi devono fare 100.'),
          ws.map(w => w.el), h('div.cv-hr'),
          h('div.cv-grid2', { style: { gap: '12px' } }, fld('In evidenza da', hiIn, 'Sopra sta in cima a «La mia settimana».'), fld('Punteggio minimo', minIn, 'Sotto resta in «Sotto soglia».'))),
        h('section.cv-card.pad', { style: { background: 'var(--cv-head)' } }, h('div.cv-lbl', 'Esempio dal vivo'), ex)),
      savedLine('scoring'));
    onSave = () => {
      const tot = ws.reduce((t, w) => t + Number(w.range.value), 0);
      if (tot !== 100) return toast(`I pesi fanno ${tot}: devono fare 100`, 'err');
      return save('scoring', { weights: Object.fromEntries(ws.map(w => [w.k, Number(w.range.value)])), min: Number(minIn.value), highlight: Number(hiIn.value) });
    };
  } else if (section === 'profiles') {
    let k = view.asa.find(a => st.profiles[a.key])?.key || view.asa[0]?.key;
    const picker = h('div');
    const form = h('div', { style: { display: 'grid', gap: '14px' } });
    let read = () => ({});
    const drawProfile = () => {
      fill(picker, choiceChips(asaOpts, k, { label: 'BU', onChange: async x => { if (changes && !await confirmDialog('Ci sono modifiche non salvate: cambiare BU le perde. Continuare?', { ok: 'Cambia BU' })) { drawProfile(); return; } changes = 0; bar.hidden = true; k = x; drawProfile(); } }).el);
      const p = st.profiles[k] || {};
      const manager = select(userOptions('da assegnare'), p.manager?.id || '', { 'aria-label': 'Responsabile' });
      const desc = textarea(p.description, { rows: 3, placeholder: 'Cosa fa la BU, in due righe', 'aria-label': 'Cosa fa' });
      const works = lineList(p.works || [], { placeholder: 'Lavoro tipico' });
      const soa = chipSet(data.meta.soaCategories.map(([c]) => [c, c]), p.soa || []);
      const amin = input({ type: 'number', min: 0, value: p.amount_min ?? '', placeholder: 'minimo €', 'aria-label': 'Importo minimo (€)' });
      const amax = input({ type: 'number', min: 0, value: p.amount_max ?? '', placeholder: 'massimo €', 'aria-label': 'Importo massimo (€)' });
      const regions = chipSet(data.meta.regions.map(r => [r.name, r.name]), p.regions || []);
      const kw = tagEditor(p.keywords || []);
      const exc = tagEditor(p.exclude || []);
      fill(form,
        h('div.cv-grid2', fld('Responsabile', manager, p.manager || !p.manager_name ? null : `Nel documento: ${p.manager_name} (non ancora tra le persone di Alma Space)`),
          h('div.cv-fld', h('span', 'Fascia d\'importo'), h('div.cv-row', { style: { gap: '8px' } }, amin, h('span.cv-muted', '–'), amax))),
        fld('Cosa fa', desc),
        h('div.cv-grid2', h('div.cv-fld', h('span', 'Parole da cercare'), kw.el, h('span.cv-hint', 'Invio per aggiungere')), h('div.cv-fld', h('span', 'Parole da escludere'), exc.el)),
        h('div.cv-fld', h('span', 'Lavori tipici'), works.el),
        h('div.cv-grid2', h('div.cv-fld', h('span', 'SOA'), h('details', h('summary.cv-chip', { style: { listStyle: 'none', display: 'inline-flex' } }, (p.soa || []).join(' · ') || 'Scegli…', ic('chevron-down', 12)), h('div', { style: { marginTop: '8px' } }, soa.el))),
          h('div.cv-fld', h('span', 'Zone'), h('details', h('summary.cv-chip', { style: { listStyle: 'none', display: 'inline-flex' } }, (p.regions || []).length ? p.regions.join(' · ') : 'Tutta Italia', ic('chevron-down', 12)), h('div', { style: { marginTop: '8px' } }, regions.el)), h('span.cv-hint', 'Nessuna regione = tutta Italia.'))),
        h('div.cv-fld', h('span', 'Clienti attuali ', h('span.cv-hint', '· dalle anagrafiche con ruolo Cliente e questa ASA')),
          p.clients?.length ? h('div.cv-chips', p.clients.slice(0, 24).map(c => h('a.cv-pill', { href: `#/crm/scheda/${c.id}`, style: { textDecoration: 'none' } }, c.name)), p.clients.length > 24 ? pill(`+ altri ${p.clients.length - 24}`) : null)
            : h('span.cv-small.cv-muted', 'Nessun cliente con questa ASA.')));
      read = () => ({ [k]: { ...p, manager_id: manager.value ? Number(manager.value) : null, description: desc.value, works: works.value(), soa: [...soa.values],
        amount_min: amin.value === '' ? null : Number(amin.value), amount_max: amax.value === '' ? null : Number(amax.value), regions: [...regions.values], keywords: kw.value(), exclude: exc.value() } });
    };
    drawProfile();
    fill(body, h('section.cv-card.pad', h('div.cv-row', h('div.cv-t5.cv-grow', { style: { fontSize: '15px' } }, 'Profili BU'), h('span.cv-small.cv-muted', 'cosa cerca il radar per ogni BU')), picker, form), savedLine('profiles'));
    onSave = () => save('profiles', read());
  } else if (section === 'sources') {
    const list = h('div');
    const items = [];
    const add = (s = { name: '', what: '', on: true, bu: [] }, openEdit = false) => {
      const on = toggle(s.on, null, { 'aria-label': `Fonte accesa: ${s.name || 'nuova'}` });
      const name = input({ value: s.name, placeholder: 'Nome della fonte', maxlength: 120, 'aria-label': 'Nome della fonte' });
      const what = input({ value: s.what, placeholder: 'Cosa porta', maxlength: 300, 'aria-label': 'Cosa porta' });
      const bu = chipSet(asaOpts, s.bu || []);
      const gareT = toggle(Boolean(s.to_gare), 'Le gare già bandite vanno all\'ufficio gare');
      const edit = h('div', { hidden: !openEdit, style: { display: 'grid', gap: '10px', padding: '0 24px 16px 72px' } }, h('div.cv-grid2', { style: { gap: '10px' } }, name, what), fld('Porta segnali a (nessuna = tutte le BU)', bu.el), gareT.el);
      const label = (s.bu || []).length ? (s.bu || []).map(b => view.asa.find(a => a.key === b)?.label || b).join(', ') : s.to_gare ? 'ufficio gare' : 'tutte le BU';
      const row = h('div', { style: { borderTop: '1px solid var(--cv-line-2)' } },
        listRow({ icon: s.to_gare ? 'inbox' : s.id === 'stampa' ? 'sparkles' : 'file', tone: s.to_gare ? 'bl' : s.id === 'stampa' ? 'or' : '', title: s.name || 'Nuova fonte', meta: dots([s.what, `porta a ${label}`]),
          actions: [h('button.btn.btn-ghost.btn-sm.cv-ico', { type: 'button', 'aria-label': `Modifica ${s.name || 'la fonte'}`, 'aria-expanded': String(openEdit), on: { click: e => { edit.hidden = !edit.hidden; e.currentTarget.setAttribute('aria-expanded', String(!edit.hidden)); } } }, ic('pencil', 14)),
            h('button.btn.btn-ghost.btn-sm.cv-ico', { type: 'button', 'aria-label': `Togli ${s.name || 'la fonte'}`, on: { click: () => { row.remove(); items.splice(items.indexOf(item), 1); dirty(); } } }, ic('trash', 14)), on.el], cls: '' }), edit);
      row.firstChild.style.borderTop = '0';
      const item = { read: () => ({ id: s.id, name: name.value, what: what.value, on: on.input.checked, bu: [...bu.values], to_gare: gareT.input.checked }) };
      items.push(item);
      list.append(row);
      if (openEdit) name.focus();
    };
    st.sources.forEach(x => add(x));
    const mode = select([['export', 'File esportato (scelta del 14/11)'], ['email', 'Avvisi email su una casella dedicata'], ['api', 'Accesso API']], st.infordat_mode, { 'aria-label': 'Come si legge Infordat' });
    fill(body,
      card({ title: 'Fonti', count: st.sources.length, right: h('button.btn.btn-sm', { type: 'button', on: { click: () => { add(undefined, true); dirty(); } } }, ic('plus', 14), 'Aggiungi') }, list),
      h('section.cv-card.pad', h('div.cv-row.cv-wrap', fld('Come si legge Infordat', mode), h('span.cv-grow'),
        h('button.btn', { type: 'button', on: { click: () => save('infordat_mode', mode.value) } }, 'Salva il modo'))),
      savedLine('sources'));
    onSave = () => save('sources', items.map(x => x.read()));
  } else if (section === 'playbooks') {
    const pbs = st.playbooks.map(p => ({ ...p }));
    let cur = 0;
    const picker = h('div');
    const form = h('div', { style: { display: 'grid', gap: '12px' } });
    let readCur = () => {};
    const draw = () => {
      readCur();
      fill(picker, h('div.cv-chips', pbs.map((p, i) => h('button.cv-chip', { type: 'button', class: i === cur ? 'on' : '', 'aria-pressed': String(i === cur), on: { click: () => { readCur(); cur = i; readCur = () => {}; draw(); } } }, p.name.split(' (')[0] || 'Nuovo playbook'))));
      const p = pbs[cur];
      if (!p) return fill(form, emptyState('list', 'Nessun playbook.'));
      const name = h('textarea.input.crm-grow', { rows: 1, placeholder: 'Tipo di segnale', maxlength: 200, 'aria-label': 'Tipo di segnale' }, p.name || '');
      const bu = chipSet(asaOpts, p.bu || []);
      const steps = lineList(p.steps || [], { placeholder: 'Passo', numbered: true });
      const check = h('textarea.input.crm-grow', { rows: 1, placeholder: 'Domanda di verifica (c\'è una trattativa?)', maxlength: 300, 'aria-label': 'Domanda di verifica', style: { flex: '1', minWidth: '0' } }, p.check || '');
      readCur = () => Object.assign(p, { name: name.value, bu: [...bu.values], steps: steps.value(), check: check.value });
      fill(form, fld('Tipo di segnale', name), fld('Vale per (nessuna = tutte le BU)', bu.el), h('div.cv-fld', h('span', 'Passi, in ordine'), steps.el),
        h('div.cv-row', { style: { border: '1px dashed var(--cv-line-strong)', borderRadius: '12px', padding: '8px 10px' } },
          h('span', { style: { width: '24px', height: '24px', borderRadius: '50%', background: 'var(--cv-dark)', color: 'var(--cv-on-dark)', fontWeight: 700, display: 'grid', placeItems: 'center', fontSize: '12px', flex: 'none' } }, '?'), check),
        h('div', h('button.btn.btn-ghost.btn-sm.danger', { type: 'button', on: { click: () => { pbs.splice(cur, 1); cur = 0; readCur = () => {}; draw(); dirty(); } } }, ic('trash', 14), 'Togli questo playbook')));
    };
    draw();
    fill(body, h('section.cv-card.pad', h('div.cv-row', h('div.cv-t5.cv-grow', { style: { fontSize: '15px' } }, 'Playbook'),
      h('button.btn.btn-sm', { type: 'button', on: { click: () => { readCur(); pbs.push({ name: '', bu: [], steps: [''], check: '' }); cur = pbs.length - 1; readCur = () => {}; draw(); dirty(); } } }, ic('plus', 14), 'Nuovo')),
    h('p.cv-small.cv-muted', 'Dopo «Interessa» il CRM propone un piano d\'azione partendo dal playbook del tipo di segnale, adattato ai contatti e alle commesse simili.'), picker, form), savedLine('playbooks'));
    onSave = () => { readCur(); return save('playbooks', pbs.map(p => ({ id: p.id, name: p.name, bu: p.bu, steps: p.steps, check: p.check }))); };
  } else if (section === 'rules') {
    const r = st.rules;
    const nums = [['meeting_note_hours', 'ore', 'Nota dell\'incontro', 'PC-02', 1, 720], ['lead_qualify_hours', 'ore', 'Qualifica del lead', 'PC-01', 1, 720], ['signal_decide_days', 'giorni', 'Decisione sul segnale', 'PC-08', 1, 90],
      ['plan_accept_hours', 'ore', 'Accettare il piano', 'PC-10', 1, 720], ['key_rhythm_days', 'giorni', 'Ritmo key account', 'PC-03', 7, 730], ['week_ahead_days', 'giorni', '«La mia settimana» guarda avanti', '', 1, 60]]
      .map(([k, u, l, c, min, max]) => ({ k, el: h('input', { type: 'number', min, max, value: r[k] ?? '', 'aria-label': `${l} (${u})` }), u, l, c }));
    const threshold = input({ type: 'number', min: 0, value: r.gonogo_threshold_eur ?? '', placeholder: 'da decidere', 'aria-label': 'Sopra quest\'importo decide la direzione (€)' });
    const gmin = input({ type: 'number', min: 0, max: 100, value: r.gonogo_min_score, 'aria-label': 'Punteggio minimo per il Go', style: { width: '90px' } });
    const qs = h('div', { style: { display: 'grid', gap: '6px' } });
    const qTot = h('span');
    const sumQ = () => { const t = [...qs.querySelectorAll('[data-q="weight"]')].reduce((a, i) => a + (Number(i.value) || 0), 0); fill(qTot, pill(`totale ${t}`, t === 100 ? 'gr' : 'rd')); };
    const addQ = (q = { text: '', weight: 0 }) => {
      const w = input({ type: 'number', min: 0, max: 100, value: q.weight, 'data-q': 'weight', 'aria-label': 'Peso', style: { width: '70px', minHeight: '32px', height: '32px', textAlign: 'right' } });
      w.addEventListener('input', sumQ);
      const row = h('div.cv-row', { style: { gap: '8px', alignItems: 'flex-start' } }, h('textarea.input.crm-grow', { rows: 1, placeholder: 'Domanda', maxlength: 200, 'data-q': 'text', 'aria-label': 'Domanda', style: { flex: '1', minWidth: '0', width: 'auto' } }, q.text), w,
        h('button.btn.btn-ghost.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Togli la domanda', on: { click: () => { row.remove(); sumQ(); dirty(); } } }, ic('x', 14)));
      qs.append(row);
      sumQ();
    };
    r.gonogo_questions.forEach(addQ);
    const discard = tagEditor(r.discard_reasons, { placeholder: 'motivo', max: 120 });
    const lost = tagEditor(r.lost_reasons, { placeholder: 'motivo', max: 120 });
    fill(body,
      h('section.cv-card.pad', h('div.cv-t5', { style: { fontSize: '15px' } }, 'Regole e tempi'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(124px, 1fr))', gap: '10px' } }, nums.map(n => h('label.cv-num', h('div.cv-row', { style: { gap: '4px', alignItems: 'baseline' } }, n.el, h('span.cv-small.cv-muted', n.u)),
          h('div.cv-small.cv-t5', n.l), n.c ? h('div.cv-hint', n.c) : null))),
        h('div.cv-cols.cv-split', { style: { gap: '16px' } },
          h('div.cv-box.big', h('div.cv-row', h('span.cv-t5.cv-grow', 'Go/No-Go delle trattative private · PC-04'), pill('da ridiscutere', 'am')),
            h('div.cv-hint', 'Dante non è convinto delle 6 domande (14/11): resta così finché non si decide.'),
            h('div.cv-row', h('span.cv-small.cv-grow', 'Domande e pesi'), qTot), qs,
            h('div', h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => { addQ(); dirty(); } } }, ic('plus', 14), 'Aggiungi una domanda')),
            h('div.cv-grid2', { style: { gap: '10px' } }, fld('Sopra quest\'importo decide la direzione (€)', threshold), fld('Punteggio minimo per il Go', gmin))),
          h('div', { style: { display: 'grid', gap: '12px', alignContent: 'start' } }, h('div.cv-fld', h('span', 'Motivi di scarto dei segnali'), discard.el), h('div.cv-fld', h('span', 'Motivi di perdita'), lost.el)))),
      savedLine('rules'));
    onSave = () => save('rules', {
      ...Object.fromEntries(nums.map(n => [n.k, Number(n.el.value)])),
      gonogo_threshold_eur: threshold.value === '' ? null : Number(threshold.value), gonogo_min_score: Number(gmin.value),
      gonogo_questions: [...qs.children].map(row => ({ text: row.querySelector('[data-q="text"]').value, weight: Number(row.querySelector('[data-q="weight"]').value) || 0 })).filter(q => q.text.trim()),
      discard_reasons: discard.value(), lost_reasons: lost.value(),
    });
  } else if (section === 'primo_passo') { // canvas «v3 · Impostazioni» (16/11)
    const p = st.primo_passo;
    const on = toggle(p.on, '');
    const ai = toggle(p.ai, '');
    const tone = select([['cordiale', 'Cordiale'], ['formale', 'Formale']], p.tone, { 'aria-label': 'Tono' });
    const within = input({ type: 'number', min: 0, max: 30, value: p.within_days, 'aria-label': 'Contatto entro' });
    const sig = textarea(p.signature, { rows: 3, 'aria-label': 'Firma' });
    const tg = (t, d, x) => h('div.cv-row', { style: { alignItems: 'flex-start', padding: '12px 0', borderTop: '1px solid var(--cv-line-2)' } }, h('div.cv-grow', h('div.cv-t5', t), h('div.cv-small.cv-muted', d)), x.el);
    fill(body, h('section.cv-card.pad', { style: { maxWidth: '760px' } }, h('div.cv-lbl', 'Primo passo pronto'),
      tg('Prepara il primo passo', 'Quando si apre un segnale: chi chiama chi, quando, e l\'email già scritta.', on),
      tg('Scrivi l\'email con l\'AI', 'Circa 1 cent a segnale, nel budget della BU. Spento = modello fisso del playbook.', ai),
      h('div.cv-grid2', { style: { gap: '12px', paddingTop: '12px', borderTop: '1px solid var(--cv-line-2)' } }, fld('Tono', tone), fld('Contatto entro (giorni lavorativi)', within)),
      h('div', { style: { marginTop: '12px' } }, fld('Firma', sig, '{nome} diventa il nome di chi manda l\'email.'))), savedLine('primo_passo'));
    onSave = () => save('primo_passo', { on: on.input.checked, ai: ai.input.checked, tone: tone.value, within_days: Number(within.value), signature: sig.value });
  } else if (section === 'relazioni') {
    const r = st.relazioni;
    const F = [['meeting', 'Punti per un incontro'], ['email', 'Punti per un\'email'], ['email_max', 'Punti massimi dalle email (per persona)'], ['project', 'Punti per una commessa'], ['key', 'Punti per un key account'],
      ['strong', 'Rapporto forte da (punti)'], ['medium', 'Rapporto medio da (punti)'], ['cool_days', 'Si raffredda dopo (giorni senza contatti)'], ['months', 'Mesi di incontri ed email considerati']];
    const nums = F.map(([k, l]) => ({ k, el: input({ type: 'number', min: 0, value: r[k], 'aria-label': l, style: { width: '120px' } }), l }));
    fill(body, h('section.cv-card.pad', { style: { maxWidth: '760px' } }, h('div.cv-lbl', 'Come si misura la forza di un rapporto'),
      h('p.cv-small.cv-muted', 'Per ogni persona: incontri ed email con qualcuno di noi; per l\'azienda si aggiungono commesse e key account. La forza decide anche il «Rapporto» del punteggio del radar.'),
      nums.map(n => h('div.cv-row', { style: { padding: '10px 0', borderTop: '1px solid var(--cv-line-2)' } }, h('span.cv-grow', n.l), n.el))), savedLine('relazioni'));
    onSave = () => save('relazioni', Object.fromEntries(nums.map(n => [n.k, Number(n.el.value)])));
  } else if (section === 'esiti') {
    const e = st.esiti;
    const prob = toggle(e.prob_on, '');
    const boss = toggle(e.boss_on, '');
    const pmin = input({ type: 'number', min: 3, value: e.prob_min, 'aria-label': 'Esiti minimi per BU', style: { width: '120px' } });
    const months = input({ type: 'number', min: 3, value: e.months, 'aria-label': 'Mesi di esiti', style: { width: '120px' } });
    const alert = input({ type: 'number', min: 1, value: e.alert_days, 'aria-label': 'Avviso dopo', style: { width: '120px' } });
    const reasons = tagEditor(e.reasons, { placeholder: 'motivo', max: 120 });
    const tg = (t, d, x) => h('div.cv-row', { style: { alignItems: 'flex-start', padding: '12px 0', borderTop: '1px solid var(--cv-line-2)' } }, h('div.cv-grow', h('div.cv-t5', t), h('div.cv-small.cv-muted', d)), x.el);
    const row = (l, x) => h('div.cv-row', { style: { padding: '10px 0', borderTop: '1px solid var(--cv-line-2)' } }, h('span.cv-grow', l), x);
    fill(body, h('div.cv-grid2', { style: { gap: '24px', alignItems: 'start' } },
      h('section.cv-card.pad', h('div.cv-lbl', 'Esiti'),
        tg('Esiti da BOSS', 'Si accende con l\'integrazione: vincitore, ribasso e offerenti arriveranno da soli.', boss),
        row('Avvisa se manca l\'esito dopo (giorni)', alert),
        h('div.cv-fld', { style: { paddingTop: '12px', borderTop: '1px solid var(--cv-line-2)' } }, h('span', 'Motivi di sconfitta'), reasons.el)),
      h('section.cv-card.pad', h('div.cv-lbl', 'Probabilità di vittoria'),
        tg('Mostra la probabilità sui segnali', 'Imparata dagli esiti: si parte dal win ratio della BU e si aggiunge l\'effetto di contatto caldo, provenienza, tipo di ente e importo.', prob),
        row('Esiti minimi per BU', pmin), row('Mesi di esiti usati', months),
        h('p.cv-hint', 'Sotto il minimo la BU vede «in apprendimento» invece di un numero.'))), savedLine('esiti'));
    onSave = () => save('esiti', { reasons: reasons.value(), alert_days: Number(alert.value), prob_on: prob.input.checked, prob_min: Number(pmin.value), months: Number(months.value), boss_on: boss.input.checked });
  } else if (section === 'prima_bando') { // canvas «v4 · Prima del bando» (17/11)
    const p = st.prima_bando;
    const on = toggle(p.on, '');
    const va = toggle(p.vinte_altri, '');
    const days = input({ type: 'number', min: 7, max: 365, value: p.days, 'aria-label': 'Giorni', style: { width: '120px' } });
    const max = input({ type: 'number', min: 1, max: 30, value: p.max_per_bu, 'aria-label': 'Gare per BU', style: { width: '120px' } });
    const oc = toggle(p.opere_cup !== false, ''); // v16: opere finanziate da OpenCUP
    const ocMax = input({ type: 'number', min: 1, max: 30, value: p.opere_max ?? 5, 'aria-label': 'Opere finanziate per BU', style: { width: '120px' } });
    const tp = toggle(p.ted_pin !== false, ''); // v17: preinformazione TED
    const sc = toggle(p.scadute !== false, ''); // v17: scadute tolte da sole
    const pt = toggle(p.triennali !== false, ''); // v17: programmi triennali
    const ptMax = input({ type: 'number', min: 1, max: 30, value: p.triennali_max ?? 5, 'aria-label': 'Interventi dei programmi triennali per BU', style: { width: '120px' } });
    const tg = (t, d, x) => h('div.cv-row', { style: { alignItems: 'flex-start', padding: '12px 0', borderTop: '1px solid var(--cv-line-2)' } }, h('div.cv-grow', h('div.cv-t5', t), h('div.cv-small.cv-muted', d)), x.el);
    const row = (l, x) => h('div.cv-row', { style: { padding: '10px 0', borderTop: '1px solid var(--cv-line-2)' } }, h('span.cv-grow', l), x);
    fill(body, h('section.cv-card.pad', { style: { maxWidth: '760px' } }, h('div.cv-lbl', 'Prima del bando'),
      tg('Secondo giro del radar', 'Ogni notte, per ogni BU accesa, cerca programmi triennali, finanziamenti, progetti approvati e determine: le opere prima che diventino gare. Costa come il primo giro, nella quota della BU.', on),
      tg('Gare vinte da altri', 'Quando escono i dati ANAC del mese: le gare delle nostre categorie e zone vinte da altri diventano segnali per proporre subappalto o ATI.', va),
      row('Aggiudicate negli ultimi (giorni)', days), row('Al massimo per BU, ogni volta', max),
      tg('Opere finanziate (OpenCUP)', 'Ogni mese, dopo il caricamento OpenCUP, le opere nuove ancora senza gara nei tipi di lavoro, nelle zone e negli importi del profilo di ogni BU diventano segnali nella colonna «Finanziata».', oc),
      row('Opere finanziate: al massimo per BU, ogni mese (le più grandi prima)', ocMax),
      tg('Avvisi di preinformazione (TED)', 'Ogni notte, le gare annunciate dagli enti sulla gazzetta europea nei codici CPV e nelle zone di ogni BU diventano segnali nella colonna «Gara in arrivo», con la data prevista del bando.', tp),
      tg('Programmi triennali dei lavori pubblici', 'Ogni settimana, gli interventi che gli enti hanno messo in programma per quest\'anno e il prossimo, nei tipi di lavoro, nelle zone e negli importi di ogni BU, diventano segnali nella colonna «Programmata» con la data prevista della gara. Se l\'opera è già nel Radar con lo stesso CUP, si aggiorna quella scheda.', pt),
      row('Programmi triennali: al massimo per BU, ogni settimana (prima annualità e priorità alta prima)', ptMax),
      tg('Togli da sole le opportunità scadute', 'Le opportunità ancora da valutare con la gara scaduta, o con il bando atteso da più di 3 mesi, passano tra le scartate con il motivo «scaduta». Si ritrovano con «Mostra: anche scartate».', sc)), savedLine('prima_bando'));
    onSave = () => save('prima_bando', { on: on.input.checked, vinte_altri: va.input.checked, days: Number(days.value), max_per_bu: Number(max.value), opere_cup: oc.input.checked, opere_max: Number(ocMax.value),
      ted_pin: tp.input.checked, scadute: sc.input.checked, triennali: pt.input.checked, triennali_max: Number(ptMax.value) });
  } else if (section === 'concorrenza') { // canvas «v4 · Concorrenza» (17/11)
    const c = st.concorrenza;
    const on = toggle(c.on, '');
    const months = input({ type: 'number', min: 3, max: 36, value: c.months, 'aria-label': 'Mesi di gare', style: { width: '120px' } });
    const min = input({ type: 'number', min: 0, value: c.min_amount, 'aria-label': 'Importo minimo', style: { width: '160px' } });
    const cfs = tagEditor(c.our_cf || [], { placeholder: 'P. IVA o codice fiscale', max: 16 });
    const names = tagEditor(c.our_names || [], { placeholder: 'nome', max: 80 });
    const extra = tagEditor(c.extra_categories || [], { placeholder: 'es. OS30', max: 10 });
    const cpvEd = Object.fromEntries(data.asa.map(a => [a.key, tagEditor(c.cpv?.[a.key] || [], { placeholder: 'prefisso CPV', max: 12 })]));
    // Gare europee (TED, canvas v14): le categorie SOA diventano codici CPV; qui si aggiungono codici a quelli fissi
    const tedEd = {};
    const tedCard = h('section.cv-card.pad', { style: { marginTop: '24px' } }, h('div.cv-lbl', 'Gare europee (TED): categorie SOA → codici CPV'), loading());
    get('/api/crm/ted/cpv').then(t => {
      const cats = Object.keys(t.map);
      fill(tedCard, h('div.cv-lbl', 'Gare europee (TED): categorie SOA → codici CPV'),
        h('p.cv-small.cv-muted', 'TED non usa le categorie SOA ma i codici CPV europei (8 cifre; la ricerca prende anche i sotto-codici). A sinistra quelli fissi, a destra puoi aggiungerne: il caricamento della notte li usa da subito.'),
        cats.map(cat => {
          tedEd[cat] = tagEditor(t.extra[cat] || [], { placeholder: 'codice CPV', max: 10 });
          return h('div.cv-fld', { style: { paddingTop: '10px', borderTop: '1px solid var(--cv-line-2)' } }, h('span', h('b', cat), ' · ', (t.base[cat] || []).map(x => t.labels[x] ? `${x} ${t.labels[x]}` : x).join(', ') || 'nessun codice fisso'), tedEd[cat].el);
        }));
    }).catch(err => fill(tedCard, h('p.cv-small.cv-muted', err.message)));
    // Opere finanziate (OpenCUP, canvas v14): le categorie SOA diventano tipi di lavoro del CUP
    const cupEd = {};
    const cupCard = h('section.cv-card.pad', { style: { marginTop: '24px' } }, h('div.cv-lbl', 'Opere finanziate (OpenCUP): categorie SOA → tipi di lavoro CUP'), loading());
    get('/api/crm/cup/tipi').then(t => {
      fill(cupCard, h('div.cv-lbl', 'Opere finanziate (OpenCUP): categorie SOA → tipi di lavoro CUP'),
        h('p.cv-small.cv-muted', 'Il CUP classifica le opere per settore, sottosettore e categoria (es. 03.16.065 = trasmissione di energia elettrica; bastano le prime cifre, es. 05.08 = edifici sociali e scolastici). A sinistra quelli fissi, a destra puoi aggiungerne: valgono dal caricamento del mese.'),
        Object.keys(t.map).map(cat => {
          cupEd[cat] = tagEditor(t.extra[cat] || [], { placeholder: 'es. 05.99.193', max: 12 });
          return h('div.cv-fld', { style: { paddingTop: '10px', borderTop: '1px solid var(--cv-line-2)' } }, h('span', h('b', cat), ' · ', (t.base[cat] || []).map(x => t.labels[x] ? `${x} ${t.labels[x]}` : x).join(', ') || 'nessun tipo fisso'), cupEd[cat].el);
        }));
    }).catch(err => fill(cupCard, h('p.cv-small.cv-muted', err.message)));
    const tg = (t, d, x) => h('div.cv-row', { style: { alignItems: 'flex-start', padding: '12px 0', borderTop: '1px solid var(--cv-line-2)' } }, h('div.cv-grow', h('div.cv-t5', t), h('div.cv-small.cv-muted', d)), x.el);
    const row = (l, x) => h('div.cv-row', { style: { padding: '10px 0', borderTop: '1px solid var(--cv-line-2)' } }, h('span.cv-grow', l), x);
    const fldTop = (l, x, hint) => h('div.cv-fld', { style: { paddingTop: '12px', borderTop: '1px solid var(--cv-line-2)' } }, h('span', l), x, hint ? h('span.cv-hint', hint) : null);
    fill(body, h('div.cv-grid2', { style: { gap: '24px', alignItems: 'start' } },
      h('section.cv-card.pad', h('div.cv-lbl', 'Dati ANAC'),
        tg('Carica i dati ANAC', 'Ogni giorno alle 5 controlla se ANAC ha pubblicato il mese nuovo (gare aggiudicate, vincitori, ribassi) e lo carica.', on),
        row('Mesi di gare da tenere', months), row('Importo minimo (€)', min),
        fldTop('Categorie in più', extra.el, 'Oltre alle categorie SOA dei profili BU, che si usano già.'),
        fldTop('Almacis: P. IVA e codici fiscali', cfs.el, 'Per riconoscere le gare vinte da noi (anche dalle società del gruppo).'),
        fldTop('Almacis: nomi', names.el, 'Se manca la P. IVA, una gara è nostra quando il nome del vincitore contiene uno di questi.')),
      h('section.cv-card.pad', h('div.cv-lbl', 'BU di servizi: codici CPV'),
        h('p.cv-small.cv-muted', 'Le gare di servizi non hanno categoria SOA: per queste BU si usano i codici CPV (bastano le prime cifre, es. 507 = manutenzione di impianti).'),
        data.asa.map(a => h('div.cv-fld', { style: { paddingTop: '10px', borderTop: '1px solid var(--cv-line-2)' } }, h('span', a.label), cpvEd[a.key].el)))), tedCard, cupCard, savedLine('concorrenza'));
    onSave = () => save('concorrenza', { on: on.input.checked, months: Number(months.value), min_amount: Number(min.value), our_cf: cfs.value(), our_names: names.value(), extra_categories: extra.value(),
      cpv: Object.fromEntries(Object.entries(cpvEd).map(([k, e]) => [k, e.value()]).filter(([, l]) => l.length)),
      ted_cpv: Object.keys(tedEd).length ? Object.fromEntries(Object.entries(tedEd).map(([k, e]) => [k, e.value()]).filter(([, l]) => l.length)) : (c.ted_cpv || {}),
      cup_types: Object.keys(cupEd).length ? Object.fromEntries(Object.entries(cupEd).map(([k, e]) => [k, e.value()]).filter(([, l]) => l.length)) : (c.cup_types || {}) });
  }
}
