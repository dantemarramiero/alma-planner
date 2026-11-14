// Radar commerciale (canvas «Segnale», «Piano d'azione», «Scheda azienda · Piano d'azione», «Proposte dal radar»):
// segnali da decidere, piano d'azione proposto dal playbook, coda dell'ufficio gare con l'export di Infordat.
import { h, fill, modal, confirmDialog, toast, fmtDate, loading } from './ui.js';
import { get, post, del, api } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';

const CHANNELS = { telefonata: 'Telefonata', email: 'Email', incontro: 'Incontro', sopralluogo: 'Sopralluogo', altro: 'Altro' };
const KINDS = { investimento: 'Investimento privato', permesso: 'Permesso o piano attuativo', opera_finanziata: 'Opera pubblica finanziata', scadenza: 'Contratto in scadenza',
  nuovo_gestore: 'Nuovo gestore o proprietà', cliente: 'Notizia su un cliente', notizia: 'Notizia', indiscrezione: 'Indiscrezione', gara: 'Gara già bandita' };
const PARTS = [['fit', 'Coerenza'], ['concreteness', 'Concretezza'], ['timing', 'Tempi'], ['relationship', 'Rapporto'], ['value', 'Valore']];
const OUTCOMES = { opportunita: 'Opportunità in BOSS', rimandato: 'Rimandato', perso: 'Perso' };
const day = d => (d ? fmtDate(String(d).slice(0, 10), { year: true }) : '—');
const eur = n => (n === null || n === undefined || n === '' ? '—' : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0 })} €`);
const field = (label, control, hint) => h('label.field', h('span', label), control, hint ? h('small.muted', hint) : null);
const input = (attrs = {}) => h('input.input', attrs);
const select = (options, value, attrs = {}) => h('select.select', attrs, options.map(([k, label]) => h('option', { value: k, selected: String(k) === String(value ?? '') }, label)));
const textarea = (value, attrs = {}) => h('textarea.input', { rows: 3, ...attrs }, value || '');
const userOptions = () => [['', '—'], ...store.users.filter(u => u.active !== false).map(u => [u.id, u.name])];
const personName = p => [p.title, p.first_name, p.last_name].filter(Boolean).join(' ');
const empty = text => h('p.small.muted', text);

export const scoreBadge = (score, highlight = 70) => h('span.crm-score', { class: score >= highlight ? 'hi' : '', title: 'Punteggio del radar (0–100)' }, String(score));

// ── decidere un segnale ───────────────────────────────────────────────────────────────────────
export function discardDialog(sig, reasons, onDone) {
  const reason = select([['', 'Scegli il motivo…'], ...reasons.map(r => [r, r])], '');
  const note = textarea('', { rows: 2, placeholder: 'Facoltativa' });
  const m = modal({
    title: 'Scarta il segnale',
    body: h('div.en-form', h('p', h('strong', sig.title)), field('Perché', reason, 'Gli scarti servono a correggere il radar.'), field('Nota', note)),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      if (!reason.value) return toast('Scegli il motivo', 'err');
      await post(sig.to_gare ? `/api/crm/radar/signals/${sig.id}/gare` : `/api/crm/radar/signals/${sig.id}/scarta`, sig.to_gare ? { action: 'scarta', reason: reason.value, note: note.value } : { reason: reason.value, note: note.value });
      m.close();
      toast('Scartato');
      onDone?.();
    } } }, 'Scarta')],
  });
}
export async function interessa(sig, onDone) {
  const out = await post(`/api/crm/radar/signals/${sig.id}/interessa`, {});
  toast('Interessa: ecco il piano d\'azione proposto');
  onDone?.();
  openPlan(out.plan.id, onDone);
}
export async function openSignal(id, onDone, data) {
  const g = await get(`/api/crm/radar/signals/${id}`);
  const parts = g.score_parts || {};
  const done = () => { m.close(); onDone?.(); };
  const decide = g.status === 'nuovo' ? (g.to_gare
    ? [h('button.btn', { type: 'button', on: { click: () => discardDialog(g, g.discardReasons, done) } }, 'Scarta'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await post(`/api/crm/radar/signals/${g.id}/gare`, { action: 'boss' }); toast('Da portare su BOSS'); done(); } } }, 'Porta su BOSS')]
    : [data ? select([['', 'Manda a un\'altra BU…'], ...data.asa.filter(a => a.key !== g.bu).map(a => [a.key, a.label])], '', { 'aria-label': 'Manda a un\'altra BU', on: { change: async e => {
      if (!e.target.value) return;
      await post(`/api/crm/radar/signals/${g.id}/bu`, { bu: e.target.value });
      toast('Mandato all\'altra BU');
      done();
    } } }) : null,
    h('button.btn', { type: 'button', on: { click: () => discardDialog(g, g.discardReasons, done) } }, 'Scarta'),
    h('button.btn.btn-primary', { type: 'button', on: { click: () => { m.close(); interessa(g, onDone); } } }, icon('check', { size: 15 }), 'Interessa')]) : [];
  const m = modal({
    title: 'Segnale del radar',
    wide: true,
    body: h('div.crm-signal',
      h('div.crm-signal-head', scoreBadge(g.score), h('div.grow', h('h3.crm-signal-t', g.title),
        h('div.t-meta', [KINDS[g.kind] || g.kind, g.bu_label, g.source === 'infordat' ? 'Infordat' : g.source === 'manuale' ? 'segnalato a mano' : g.source, day(g.created_at)].filter(Boolean).join(' · ')))),
      h('div.crm-signal-grid',
        h('div', h('dl.en-dl',
          h('dt', 'Ente o azienda'), h('dd', g.subject_id ? h('a', { href: `#/crm/scheda/${g.subject_id}` }, g.subject_name || g.entity) : (g.entity || '—'), g.subject_roles?.includes('cliente') ? h('span.pill.crm-r-cliente', 'cliente') : g.subject_id ? h('span.pill', 'nel CRM') : null),
          h('dt', 'Importo'), h('dd', eur(g.amount)), h('dt', g.to_gare ? 'Scadenza' : 'Quando'), h('dd', day(g.deadline)),
          h('dt', 'Luogo'), h('dd', [g.place, g.region].filter(Boolean).join(', ') || '—'),
          g.soa?.length ? [h('dt', 'SOA'), h('dd', g.soa.join(' · '))] : null, g.cig ? [h('dt', 'CIG'), h('dd', g.cig)] : null,
          h('dt', 'Fonte'), h('dd', g.url ? h('a', { href: g.url, target: '_blank', rel: 'noopener' }, 'Apri la fonte') : '—')),
        g.summary ? h('p.en-notes', g.summary) : null,
        g.why ? h('p.small', h('strong', 'Perché interessa: '), g.why) : null),
        h('div.crm-score-box', h('h3.crm-h3', 'Come si arriva a ', String(g.score)),
          PARTS.map(([k, l]) => h('div.crm-score-row', h('span', l), h('span.crm-score-bar', h('span', { style: `width:${g.weights?.[k] ? Math.round(100 * (parts[k] || 0) / g.weights[k]) : 0}%` })), h('strong', `${parts[k] ?? 0}/${g.weights?.[k] ?? '—'}`))),
          h('p.small.muted', 'Pesi e soglie in Impostazioni → Punteggio.'))),
      g.status !== 'nuovo' ? h('p.small.muted', `Deciso: ${({ interessa: 'Interessa', scartato: `scartato (${g.discard_reason})`, boss: 'portato su BOSS', gara_scartata: `gara scartata (${g.discard_reason})` })[g.status]} · ${g.decided_by_name || ''} ${day(g.decided_at)}`) : null),
    actions: decide.filter(Boolean),
  });
}
// riga di un segnale nelle liste
export function signalRow(sig, { highlight, reasons, onChange, data }) {
  return h('div.crm-sig', { class: sig.score >= highlight ? 'hi' : '' },
    scoreBadge(sig.score, highlight),
    h('button.grow.crm-sig-main', { type: 'button', on: { click: () => openSignal(sig.id, onChange, data) } },
      h('div.crm-line-t', sig.title),
      h('div.t-meta', [sig.subject_name || sig.entity, sig.amount ? eur(sig.amount) : null, sig.deadline ? `entro ${day(sig.deadline)}` : null, KINDS[sig.kind]].filter(Boolean).join(' · ')),
      sig.why ? h('div.t-meta', sig.why) : null),
    sig.status === 'nuovo' && !sig.to_gare ? h('div.crm-sig-acts',
      h('button.btn.btn-sm', { type: 'button', on: { click: () => discardDialog({ ...sig, to_gare: false }, reasons, onChange) } }, 'Scarta'),
      h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => interessa(sig, onChange) } }, 'Interessa')) : null);
}

// segnalazione a mano: chiunque, dal computer o dal telefono
export function newSignalDialog(data, onDone) {
  const title = input({ placeholder: 'Cosa è successo: «Rossi Logistica ottiene 8 M€ per un polo a San Salvo»', maxlength: 500 });
  const entity = input({ placeholder: 'Ente o azienda', maxlength: 300 });
  const kind = select(Object.entries(KINDS).filter(([k]) => k !== 'gara'), 'notizia');
  const bu = select([['', 'La sceglie il radar dal profilo'], ...data.asa.map(a => [a.key, a.label])], '');
  const amount = input({ placeholder: 'es. 1.200.000', inputmode: 'decimal' });
  const deadline = input({ type: 'date' });
  const url = input({ type: 'url', placeholder: 'https://…' });
  const summary = textarea('', { rows: 3, placeholder: 'Dettagli (facoltativi)' });
  const m = modal({
    title: 'Segnala un\'occasione',
    body: h('div.en-form', field('Cosa è successo', title), h('div.en-row2', field('Ente o azienda', entity), field('Tipo', kind)),
      h('div.en-row2', field('BU', bu), field('Importo (€)', amount)), h('div.en-row2', field('Quando (gara o lavori)', deadline), field('Link alla fonte', url)), field('Dettagli', summary)),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      if (!title.value.trim()) return toast('Scrivi cosa è successo', 'err');
      const g = await post('/api/crm/radar/signals', { title: title.value, entity: entity.value, kind: kind.value, bu: bu.value || null, amount: amount.value || null, deadline: deadline.value || null, url: url.value, summary: summary.value });
      m.close();
      toast(`Segnale salvato: punteggio ${g.score}${g.bu ? '' : ' (nessuna BU adatta)'}`);
      onDone?.();
    } } }, 'Salva')],
  });
}

// ── piano d'azione ────────────────────────────────────────────────────────────────────────────
export async function openPlan(id, onDone) {
  const p = await get(`/api/crm/plans/${id}`);
  const proposed = p.status === 'proposto';
  const contactOpts = [['', '—'], ...p.contacts.map(c => [c.id, personName(c) + (c.job ? ` · ${c.job}` : '')])];
  const rows = h('div.crm-plan-steps');
  const addRow = (st = { title: '', due_date: '', owner_id: p.owner_id, contact_id: '', channel: '', draft: '' }) => {
    const r = h('div.card.crm-plan-step',
      h('div.crm-plan-step-top', h('span.crm-plan-n'), input({ value: st.title, 'data-f': 'title', placeholder: 'Passo', maxlength: 300 }),
        input({ type: 'date', value: st.due_date || '', 'data-f': 'due_date', 'aria-label': 'Entro quando' }),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Togli il passo', on: { click: () => { r.remove(); renumber(); } } }, icon('x', { size: 14 }))),
      h('div.crm-plan-step-mid', select(userOptions(), st.owner_id || '', { 'data-f': 'owner_id', 'aria-label': 'Chi lo fa' }),
        select(contactOpts, st.contact_id || '', { 'data-f': 'contact_id', 'aria-label': 'Con chi' }),
        select([['', 'Come…'], ...Object.entries(CHANNELS)], st.channel || '', { 'data-f': 'channel', 'aria-label': 'Come' })),
      h('details.crm-draft', { open: Boolean(st.draft) }, h('summary.t-meta', 'Bozza del messaggio'), textarea(st.draft, { rows: 5, 'data-f': 'draft' })));
    rows.append(r);
    renumber();
  };
  const renumber = () => [...rows.children].forEach((r, i) => { r.querySelector('.crm-plan-n').textContent = String(i + 1); });
  const read = () => [...rows.children].map(r => Object.fromEntries([...r.querySelectorAll('[data-f]')].map(el => [el.dataset.f, el.value]))).filter(s => s.title.trim());
  if (proposed) p.steps.forEach(addRow);
  const live = p.live || [];
  const m = modal({
    title: proposed ? 'Piano d\'azione proposto' : 'Piano d\'azione',
    wide: true,
    body: h('div.en-form',
      h('div', h('h3.crm-signal-t', p.title), h('div.t-meta', [h('a', { href: `#/crm/scheda/${p.subject_id}` }, p.subject_name), p.owner_name && ` · responsabile ${p.owner_name}`, p.signal_url ? [' · ', h('a', { href: p.signal_url, target: '_blank', rel: 'noopener' }, 'fonte')] : null])),
      p.refs ? h('p.small', h('strong', 'Referenze da citare: '), p.refs) : null,
      proposed ? [h('p.small.muted', 'Modifica, togli o aggiungi passi. Con «Accetta piano» ogni passo diventa un prossimo passo dell\'azienda, con il «!» se scade.'), rows,
        h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => addRow() } }, icon('plus', { size: 14 }), 'Aggiungi passo')]
        : h('div.crm-lines', live.map(st => h('div.crm-line', h('span.crm-ico', icon(st.done_at ? 'check' : 'alarm-clock', { size: 15 })),
          h('div.grow', h('div.crm-line-t', st.title), h('div.t-meta', [st.done_at ? `fatto il ${day(st.done_at)}` : `entro ${day(st.due_date)}`, st.owner_name, st.outcome].filter(Boolean).join(' · ')))))),
      p.check_question ? h('p.small', h('strong', 'Verifica: '), p.check_question) : null,
      p.status === 'chiuso' ? h('p.small', h('strong', 'Esito: '), `${OUTCOMES[p.outcome]}${p.outcome_note ? ` · ${p.outcome_note}` : ''}`) : null),
    left: proposed ? [h('button.btn.btn-ghost.danger', { type: 'button', on: { click: async () => {
      if (!await confirmDialog('Cancellare questa proposta di piano?', { ok: 'Cancella', danger: true })) return;
      await del(`/api/crm/plans/${p.id}`);
      m.close();
      onDone?.();
    } } }, 'Non serve')] : [],
    actions: proposed ? [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const steps = read();
      if (!steps.length) return toast('Il piano non ha passi', 'err');
      if (steps.some(s => !s.due_date)) return toast('Ogni passo ha bisogno di una data', 'err');
      await post(`/api/crm/plans/${p.id}/accept`, { steps: steps.map(s => ({ ...s, owner_id: s.owner_id ? Number(s.owner_id) : null, contact_id: s.contact_id ? Number(s.contact_id) : null })) });
      m.close();
      toast('Piano accettato: i passi sono nei prossimi passi');
      onDone?.();
    } } }, 'Accetta piano')]
      : p.status === 'accettato' ? [h('button.btn', { type: 'button', on: { click: () => { m.close(); closePlanDialog(p, onDone); } } }, 'Chiudi il piano')] : [],
  });
}
function closePlanDialog(p, onDone) {
  const outcome = select(Object.entries(OUTCOMES), 'opportunita');
  const note = textarea('', { rows: 2 });
  const steps = h('input', { type: 'checkbox', checked: true });
  const m = modal({
    title: 'Chiudi il piano',
    body: h('div.en-form', field('Com\'è andata', outcome), field('Nota', note), h('label.crm-check', steps, h('span', 'Chiudi anche i passi ancora aperti del piano'))),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      await post(`/api/crm/plans/${p.id}/close`, { outcome: outcome.value, note: note.value, close_steps: steps.checked });
      m.close();
      toast('Piano chiuso');
      onDone?.();
    } } }, 'Chiudi')],
  });
}

// tab «Piano d'azione» sulla scheda dell'azienda: piani (proposti, in corso, chiusi) e segnali agganciati
export async function plansTab(box, s, refresh) {
  fill(box, loading());
  const { plans, signals, playbooks } = await get(`/api/crm/subjects/${s.id}/plans`);
  const pb = select([['', 'Nuovo piano da un playbook…'], ...playbooks.map(p => [p.id, p.name])], '', { 'aria-label': 'Nuovo piano', on: { change: async e => {
    if (!e.target.value) return;
    const plan = await post(`/api/crm/subjects/${s.id}/plans`, { playbook_id: e.target.value });
    openPlan(plan.id, refresh);
  } } });
  const status = p => (p.status === 'proposto' ? h('span.pill.crm-r-lead', 'da accettare') : p.status === 'accettato' ? h('span.pill.crm-r-cliente', 'in corso') : h('span.pill', OUTCOMES[p.outcome] || 'chiuso'));
  fill(box, h('div.crm-grid',
    h('section.card.crm-pad', h('div.crm-card-head', h('h3.crm-h3', 'Piani d\'azione'), pb),
      plans.length ? h('div.crm-lines', plans.map(p => {
        const done = p.live.filter(x => x.done_at).length;
        const late = p.live.filter(x => !x.done_at && String(x.due_date).slice(0, 10) < new Date().toISOString().slice(0, 10)).length;
        return h('button.crm-line.crm-linkline', { type: 'button', on: { click: () => openPlan(p.id, refresh) } }, h('span.crm-ico', icon('list', { size: 15 })),
          h('div.grow', h('div.crm-line-t', p.title, late ? h('span.crm-bang', '!') : null),
            h('div.t-meta', [p.owner_name, p.status === 'proposto' ? `${p.steps.length} passi proposti` : `${done} di ${p.live.length} passi fatti`, day(p.created_at)].filter(Boolean).join(' · ')),
            p.status === 'accettato' && p.live.length ? h('span.crm-progress', h('span', { style: `width:${Math.round(100 * done / p.live.length)}%` })) : null),
          status(p));
      })) : empty('Nessun piano. Nasce da «Interessa» su un segnale del radar, oppure da un playbook qui sopra.')),
    h('section.card.crm-pad', h('h3.crm-h3', 'Segnali del radar'),
      signals.length ? h('div.crm-lines', signals.map(g => h('button.crm-line.crm-linkline', { type: 'button', on: { click: () => openSignal(g.id, refresh) } }, scoreBadge(g.score),
        h('div.grow', h('div.crm-line-t', g.title), h('div.t-meta', [KINDS[g.kind], day(g.created_at), ({ nuovo: 'da decidere', interessa: 'Interessa', scartato: 'scartato', boss: 'su BOSS', gara_scartata: 'gara scartata' })[g.status]].filter(Boolean).join(' · '))))))
        : empty('Nessun segnale su quest\'azienda.'))));
}

// ── ufficio gare: «Proposte dal radar» ────────────────────────────────────────────────────────
export async function gareTab(box, data) {
  fill(box, loading());
  const { signals, discardReasons } = await get('/api/crm/radar/signals?view=gare');
  const again = () => gareTab(box, data);
  const file = h('input', { type: 'file', accept: '.xlsx,.csv,.txt', 'aria-label': 'Export di Infordat' });
  const preview = h('div');
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    fill(preview, loading());
    const buf = await f.arrayBuffer();
    try {
      const pre = await api('POST', '/api/crm/radar/infordat/anteprima', buf, { raw: true, quiet: true, headers: { 'Content-Type': 'application/octet-stream' } });
      fill(preview, h('div.crm-import-pre',
        h('p', h('strong', `${pre.total} gare nel file`), ` · ${pre.fresh} nuove, ${pre.total - pre.fresh} già caricate`),
        h('p.small.muted', 'Colonne riconosciute: ', Object.entries(pre.columns).map(([k, c]) => `${c}`).join(' · ')),
        h('div.en-table-wrap', h('table.en-table', h('thead', h('tr', h('th', 'Oggetto'), h('th', 'Ente'), h('th.num', 'Importo'), h('th', 'Scadenza'), h('th', 'SOA'))),
          h('tbody', pre.sample.map(r => h('tr', h('td', r.title), h('td', r.entity || '—'), h('td.num', eur(r.amount)), h('td', day(r.deadline)), h('td', r.soa.join(' ') || '—')))))),
        h('button.btn.btn-primary', { type: 'button', disabled: !pre.fresh || undefined, on: { click: async () => {
          const out = await api('POST', '/api/crm/radar/infordat', buf, { raw: true, quiet: true, headers: { 'Content-Type': 'application/octet-stream' } });
          toast(`${out.added} gare caricate${out.skipped ? `, ${out.skipped} già presenti` : ''}`);
          again();
        } } }, `Carica ${pre.fresh} gare`)));
    } catch (err) { fill(preview, h('p.small.due-late', err.message)); }
  });
  fill(box,
    h('div.crm-filterbar.crm-info', icon('calendar', { size: 15 }), h('span', 'Le gare segnalate dal radar arrivano solo qui. Chi le porta su BOSS le trova alla riunione gare del mercoledì, dove si decide se lavorarci.')),
    h('div.crm-grid',
      h('section.card.crm-pad', h('div.crm-card-head', h('h3.crm-h3', `Proposte dal radar (${signals.length})`)),
        signals.length ? h('div.en-table-wrap', h('table.en-table.crm-gare', h('thead', h('tr', h('th', ''), h('th', 'Gara'), h('th.num', 'Importo'), h('th', 'Scadenza'), h('th', 'SOA'), h('th', ''))),
          h('tbody', signals.map(g => h('tr',
            h('td', scoreBadge(g.score)),
            h('td', h('button.crm-sig-main', { type: 'button', on: { click: () => openSignal(g.id, again, data) } }, h('div.crm-line-t', g.title),
              h('div.t-meta', [g.subject_name || g.entity, g.bu_label, g.subject_roles?.includes('cliente') ? 'cliente attuale' : null, g.cig && `CIG ${g.cig}`].filter(Boolean).join(' · ')))),
            h('td.num', eur(g.amount)), h('td', { class: g.deadline && String(g.deadline).slice(0, 10) < new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) ? 'due-late' : '' }, day(g.deadline)),
            h('td', g.soa.join(' ') || '—'),
            h('td.crm-nowrap', h('button.btn.btn-sm', { type: 'button', on: { click: () => discardDialog(g, discardReasons, again) } }, 'Scarta'), ' ',
              h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async () => { await post(`/api/crm/radar/signals/${g.id}/gare`, { action: 'boss' }); toast('Da portare su BOSS'); again(); } } }, 'Porta su BOSS')))))))
          : empty('Nessuna gara da guardare. Carica l\'ultimo export di Infordat qui accanto.')),
      h('section.card.crm-pad', h('h3.crm-h3', 'Carica l\'export di Infordat'),
        h('p.small.muted', 'Excel o CSV, come esce da Infordat. Le gare già caricate non si ripetono; il radar assegna la BU dal profilo e calcola il punteggio.'),
        file, preview)));
}

// «Sotto soglia»: i segnali delle mie BU che il radar non ha mandato, per controllare che non perda niente
export async function belowTab(box, data) {
  fill(box, loading());
  const again = () => belowTab(box, data);
  const r = await get('/api/crm/radar/signals?view=sotto');
  fill(box, h('section.card.crm-pad',
    h('p.small.muted', `Segnali delle tue BU con punteggio sotto ${r.min}: non arrivano in «La mia settimana». Se qui ce n'è uno buono, decidilo lo stesso e correggi il profilo della BU o i pesi del punteggio.`),
    r.signals.length ? h('div.crm-steplist', r.signals.map(g => signalRow(g, { highlight: r.highlight, reasons: r.discardReasons, onChange: again, data })))
      : empty(r.bus.length ? 'Nessun segnale sotto soglia.' : 'Non sei responsabile di nessuna BU.')));
}
