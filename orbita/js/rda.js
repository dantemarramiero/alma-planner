// RDA interna: richiesta di lavoro a un'altra funzione, con le ore stimate. Il responsabile della funzione la accetta
// (conferma o cambia le ore e la assegna al suo team) o la rifiuta. Accettata, è un ticket come gli altri.
import { h, clear, fill, modal, toast, fmtDate, timeAgo, avatar, loading, statusPill, projChip } from './ui.js';
import { get, post } from './api.js';
import { store, userById, activeProjects } from './store.js';
import { avatarsFor } from './people.js';
import { openTicket } from './tickets.js';

// «5 min fa», «3 h fa», ma «ora» e le date senza «fa»
const ago = iso => { const s = timeAgo(iso); return /^d+ (min|h|g)$/.test(s) ? `${s} fa` : s; };
const STATE = { pending: 'Da accettare', accepted: 'Accettata', rejected: 'Rifiutata' };
export const fmtHours = n => (n === null || n === undefined ? '' : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 })} h`);

// Ore in una riga: «stimate 4 h → confermate 8 h · effettive 9 h».
export function hoursLine(t) {
  const parts = [];
  const est = Number(t.hours_estimated), ok = t.hours_approved === null ? null : Number(t.hours_approved);
  if (ok === null) parts.push(`stimate ${fmtHours(est)}`);
  else if (ok === est) parts.push(`${fmtHours(ok)} confermate`);
  else parts.push(h('span', `stimate ${fmtHours(est)} → `, h('strong', `confermate ${fmtHours(ok)}`)));
  if (t.hours_actual !== null && t.hours_actual !== undefined) parts.push(`effettive ${fmtHours(t.hours_actual)}`);
  return h('span.rda-hours', parts.flatMap((p, i) => (i ? [' · ', p] : [p])));
}

// Etichetta per le liste dei ticket: «RDA · Marketing · 8 h».
export function rdaChip(t) {
  if (!t.rda_function) return null;
  return h('span.rda-chip', { title: 'RDA interna' }, `RDA · ${t.rda_function}${t.hours_approved ? ` · ${fmtHours(t.hours_approved)}` : ''}`);
}

const statePill = t => t.rda_state === 'accepted'
  ? statusPill(t.status)
  : h('span.pill', { class: t.rda_state === 'pending' ? 'rda-pending' : 'rda-rejected' }, h('span.dot'), STATE[t.rda_state]);

let functionsCache = null;
async function functions(force = false) {
  if (!functionsCache || force) functionsCache = await get('/api/rda/functions');
  return functionsCache;
}

// ── nuova richiesta ────────────────────────────────────────────────────────
export async function openRdaForm({ onDone, defaults = {} } = {}) {
  const list = await functions(true);
  if (!list.length) {
    toast('Nessuna funzione: serve l\'organigramma da Microsoft (Organigramma → Aggiorna da Microsoft)', 'err');
    return;
  }
  const others = list.filter(f => !f.mine);
  const title = h('input.input', { placeholder: 'Es. Brochure per la fiera di novembre', autofocus: true, maxlength: 300 });
  const fn = h('select.select', { required: true },
    h('option', { value: '' }, 'Scegli la funzione…'),
    (others.length ? others : list).map(f => h('option', { value: f.name, selected: f.name === defaults.function, disabled: !f.head }, f.head ? f.name : `${f.name} (senza responsabile)`)));
  const headInfo = h('div.small.muted');
  const showHead = () => {
    const f = list.find(x => x.name === fn.value);
    headInfo.textContent = f?.head ? `La riceve ${f.head.name}, che la accetta e la assegna al suo team.` : '';
  };
  fn.addEventListener('change', showHead);
  showHead();
  const hours = h('input.input', { type: 'number', min: '0.25', step: '0.5', inputmode: 'decimal', placeholder: 'Es. 4', style: { maxWidth: '140px' } });
  const due = h('input.input', { type: 'date', value: defaults.due_date || '' });
  const desc = h('textarea.input', { rows: 4, placeholder: 'Cosa serve esattamente, per chi, link o file utili…' });
  const project = h('select.select', h('option', { value: '' }, 'Nessun progetto'),
    activeProjects().map(p => h('option', { value: String(p.id), selected: p.id === defaults.project_id }, p.name)));

  const send = async () => {
    if (!title.value.trim()) { toast('Scrivi cosa ti serve', 'err'); title.focus(); return; }
    if (!fn.value) { toast('Scegli a quale funzione chiederlo', 'err'); fn.focus(); return; }
    if (!(Number(hours.value) > 0)) { toast('Indica più o meno quante ore servono', 'err'); hours.focus(); return; }
    const t = await post('/api/rda', {
      title: title.value, function: fn.value, hours_estimated: hours.value, due_date: due.value || null,
      description: desc.value, project_id: project.value ? Number(project.value) : null,
    });
    m.close();
    const f = list.find(x => x.name === fn.value);
    toast(`Richiesta inviata a ${f?.head?.name || fn.value}`);
    onDone?.(t);
  };

  const m = modal({
    title: 'Nuova RDA interna',
    body: [
      h('label.field', h('span', 'Cosa ti serve'), title),
      h('label.field', h('span', 'A quale funzione'), fn, headInfo),
      h('div.grid-2',
        h('label.field', h('span', 'Ore stimate (più o meno)'), hours),
        h('label.field', h('span', 'Entro il'), due)),
      h('label.field', h('span', 'Dettagli'), desc),
      h('label.field', h('span', 'Progetto (facoltativo)'), project),
    ],
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: send } }, 'Invia la richiesta'),
    ],
  });
}

// ── accetta / rifiuta (solo il responsabile) ───────────────────────────────
async function openAccept(t, onDone) {
  const fn = (await functions(true)).find(f => f.name === t.rda_function);
  const team = fn?.team || [];
  const hours = h('input.input', { type: 'number', min: '0.25', step: '0.5', inputmode: 'decimal', value: String(Number(t.hours_estimated)), style: { maxWidth: '140px' } });
  const changed = h('div.small.muted', `Stimate da chi chiede: ${fmtHours(t.hours_estimated)}. Se le cambi, viene avvisato.`);
  const due = h('input.input', { type: 'date', value: t.due_date || '' });
  const note = h('textarea.input', { rows: 2, placeholder: 'Facoltativa: finisce nei commenti del ticket', style: { minHeight: '60px' } });
  const picked = new Set();
  const people = h('div.rda-team', team.map(p => {
    const u = userById(p.user_id) || { name: p.name };
    const box = h('input', { type: 'checkbox', value: String(p.user_id), on: { change: e => { if (e.target.checked) picked.add(p.user_id); else picked.delete(p.user_id); } } });
    return h('label.rda-person', box, avatar(u, 28), h('span', h('strong', p.name), p.job_title ? h('small', p.job_title) : null));
  }));

  const accept = async () => {
    if (!(Number(hours.value) > 0)) { toast('Indica le ore', 'err'); hours.focus(); return; }
    if (!picked.size) { toast('Scegli chi del tuo team la fa', 'err'); return; }
    await post(`/api/rda/${t.id}/accept`, { hours_approved: hours.value, assignee_ids: [...picked], due_date: due.value || null, note: note.value });
    m.close();
    toast(Number(hours.value) === Number(t.hours_estimated) ? 'Richiesta accettata' : 'Richiesta accettata: chi l\'ha chiesta vede le nuove ore');
    onDone?.();
  };

  const m = modal({
    title: `Accetta: ${t.title}`,
    body: [
      h('div.rda-from', avatar(userById(t.created_by), 32), h('div', h('strong', userById(t.created_by)?.name || 'Un collega'), h('div.small.muted', `chiede a ${t.rda_function} · ${ago(t.created_at)}`))),
      t.description ? h('p.rda-desc', t.description) : '',
      h('div.grid-2',
        h('label.field', h('span', 'Ore confermate'), hours, changed),
        h('label.field', h('span', 'Scadenza'), due)),
      h('div.field', h('span', 'Chi la fa'), team.length ? people : h('div.muted.small', 'Nessuno del tuo team è ancora entrato in Alma Planet.')),
      h('label.field', h('span', 'Nota'), note),
    ],
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: accept } }, 'Accetta e assegna'),
    ],
  });
}

function openReject(t, onDone) {
  const reason = h('textarea.input', { rows: 3, autofocus: true, placeholder: 'Perché no, o cosa servirebbe per farla' });
  const reject = async () => {
    if (!reason.value.trim()) { toast('Scrivi il motivo', 'err'); reason.focus(); return; }
    await post(`/api/rda/${t.id}/reject`, { reason: reason.value });
    m.close();
    toast('Richiesta rifiutata');
    onDone?.();
  };
  const m = modal({
    title: `Rifiuta: ${t.title}`,
    body: h('label.field', h('span', 'Motivo (lo legge chi l\'ha chiesta)'), reason),
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-danger', { type: 'button', on: { click: reject } }, 'Rifiuta'),
    ],
  });
}

// ── pagina ─────────────────────────────────────────────────────────────────
export function rdaView(view) {
  let data = null;
  let tab = 'sent';
  const inbox = h('div');
  const tabs = h('div.seg');
  const listBox = h('div');
  const newBtn = h('button.btn.btn-primary', { type: 'button', on: { click: () => openRdaForm({ onDone: load }) } }, '+ Nuova richiesta');
  fill(view, h('div.page-head', h('div', h('h1', 'RDA interne'), h('div.sub', 'Chiedi lavoro a un\'altra funzione indicando le ore: il suo responsabile la accetta e la assegna.')), newBtn),
    inbox, h('div.section', tabs, listBox));

  async function load() {
    clear(listBox).append(loading());
    data = await get('/api/rda');
    draw();
  }

  function draw() {
    clear(inbox);
    if (data.inbox.length) {
      inbox.append(h('div.section.rda-inbox', h('div.spread', h('h2', `Da accettare (${data.inbox.length})`)),
        data.inbox.map(t => {
          const u = userById(t.created_by);
          return h('div.card.rda-card',
            h('div.rda-card-head', avatar(u, 36), h('div.grow',
              h('div.rda-title', t.title),
              h('div.small.muted', `${u?.name || 'Un collega'} · per ${t.rda_function} · ${ago(t.created_at)}`))),
            t.description ? h('p.rda-desc', t.description) : '',
            h('div.rda-meta', h('span.rda-big', fmtHours(t.hours_estimated), h('small', ' stimate')),
              t.due_date ? h('span', `entro il ${fmtDate(t.due_date)}`) : null,
              t.project_name ? projChip(t.project_name, t.project_color) : null),
            h('div.row.rda-actions',
              h('button.btn.btn-primary', { type: 'button', on: { click: () => openAccept(t, load) } }, 'Accetta…'),
              h('button.btn', { type: 'button', on: { click: () => openReject(t, load) } }, 'Rifiuta…')));
        })));
    }
    const tabList = [['sent', `Le mie richieste (${data.sent.length})`]];
    if (data.led.length) tabList.push(['received', `Arrivate a ${data.led.join(', ')} (${data.received.length})`]);
    if (!tabList.some(([k]) => k === tab)) tab = 'sent';
    fill(tabs, tabList.map(([k, l]) => h('button', { type: 'button', class: k === tab ? 'on' : '', on: { click: () => { tab = k; draw(); } } }, l)));
    const rows = tab === 'sent' ? data.sent : data.received;
    clear(listBox);
    if (tab === 'received' && rows.length) listBox.append(totals(rows));
    if (!rows.length) {
      return listBox.append(h('div.card.empty', tab === 'sent'
        ? h('span', 'Non hai ancora chiesto nulla. ', h('a', { href: '#', on: { click: e => { e.preventDefault(); newBtn.click(); } } }, 'Fai una richiesta'))
        : 'Nessuna richiesta accettata o rifiutata finora.'));
    }
    listBox.append(h('div.card.rda-list', rows.map(t => row(t, tab))));
  }

  // Somma delle ore della funzione: confermate e, per quelle fatte, effettive.
  function totals(rows) {
    const acc = rows.filter(t => t.rda_state === 'accepted');
    const sum = (list, k) => list.reduce((s, t) => s + Number(t[k] || 0), 0);
    const done = acc.filter(t => t.status === 'done');
    return h('div.rda-totals',
      h('div', h('strong', fmtHours(sum(acc.filter(t => t.status !== 'done'), 'hours_approved'))), h('span', 'confermate, da fare')),
      h('div', h('strong', fmtHours(sum(done, 'hours_approved'))), h('span', 'confermate, già fatte')),
      h('div', h('strong', fmtHours(sum(done, 'hours_actual'))), h('span', 'effettive')));
  }

  function row(t, which) {
    const who = which === 'sent' ? t.rda_function : userById(t.created_by)?.name || 'Un collega';
    return h('button.rda-row', { type: 'button', on: { click: () => openTicket(t.id, { onSaved: load }) } },
      h('div.grow',
        h('div.rda-title', t.title),
        h('div.small.muted', which === 'sent' ? `a ${who}` : `da ${who}`, ' · ', hoursLine(t),
          t.rda_state === 'rejected' && t.rda_reject_reason ? h('span', ` · «${t.rda_reject_reason}»`) : null)),
      t.assignee_ids.length ? avatarsFor(t.assignee_ids, 3) : null,
      statePill(t));
  }

  load();
}

// ── dentro la scheda del ticket ───────────────────────────────────────────
// Riquadro in cima: a chi è chiesta, stato, ore. Restituisce i campi delle ore che chi guarda può cambiare
// e un get() con quello che va salvato.
export function rdaTicketBox(t) {
  if (!t.rda_function) return null;
  const me = store.me.id;
  const isHead = t.rda_head_id === me;
  const box = h('div.rda-box');
  const inputs = {};
  const num = (val, label) => h('label.field', h('span', label),
    h('input.input', { type: 'number', min: '0.25', step: '0.5', inputmode: 'decimal', value: val === null || val === undefined ? '' : String(Number(val)), style: { maxWidth: '130px' } }));
  box.append(h('div.spread', h('strong', `RDA interna a ${t.rda_function}`), statePill(t)),
    h('div.small.muted', `Chiesta da ${userById(t.created_by)?.name || 'un collega'}`, t.rda_head_id ? ` · responsabile ${userById(t.rda_head_id)?.name || ''}` : ''));
  if (t.rda_state === 'rejected') box.append(h('div.small', `Rifiutata: «${t.rda_reject_reason || ''}»`));
  const fields = h('div.rda-box-fields');
  if (t.rda_state === 'pending') {
    if (t.created_by === me) fields.append(inputs.hours_estimated = num(t.hours_estimated, 'Ore stimate'));
    else fields.append(h('div', hoursLine(t)));
  } else if (t.rda_state === 'accepted') {
    fields.append(isHead ? (inputs.hours_approved = num(t.hours_approved, 'Ore confermate')) : h('div.field', h('span', 'Ore'), hoursLine(t)));
    fields.append(inputs.hours_actual = num(t.hours_actual, t.status === 'done' ? 'Ore effettive' : 'Ore effettive (a ticket fatto)'));
  }
  box.append(fields);
  return {
    el: box,
    accepted: t.rda_state === 'accepted',
    // solo i valori cambiati
    values() {
      const out = {};
      for (const [k, label] of Object.entries(inputs)) {
        const raw = label.querySelector('input').value;
        const before = t[k] === null || t[k] === undefined ? '' : String(Number(t[k]));
        if (raw !== before && raw !== '') out[k] = raw;
      }
      return out;
    },
    actualInput: inputs.hours_actual?.querySelector('input'),
  };
}
