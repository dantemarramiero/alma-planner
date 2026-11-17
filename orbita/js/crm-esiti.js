// Win ratio (Dante 16/11/2026, canvas «v3 · Win ratio e facilità»):
// «Vinte e perse» (V3-Esiti), «Registra esito» (V3-Registra), «Chi conosciamo» (V3-Relazioni) e, nel riquadro del
// segnale, probabilità + strade calde + primo passo pronto (V3-Segnale).
import { h, fill, toast, fmtDate, loading, confirmDialog } from './ui.js';
import { get, post, put, del } from './api.js';
import { store } from './store.js';
import { ic, dots, pill, av, pageTop, title, card, sect, listRow, emptyState, choiceChips, cvModal, scoreRing, seg } from './crm-v2.js';

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const day = d => (d ? fmtDate(String(d).slice(0, 10)) : '—');
const eur = n => (n === null || n === undefined || n === '' ? '—' : Number(n) >= 1e6 ? `${(Number(n) / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 2 })} M€` : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0 })} €`);
const pct = n => (n === null || n === undefined || n === '' ? '—' : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`);
const input = (attrs = {}) => h('input.input', attrs);
const select = (options, value, attrs = {}) => h('select.select', attrs, options.map(([k, label]) => h('option', { value: k, selected: String(k) === String(value ?? '') }, label)));
const fld = (label, control, hint) => h('label.cv-fld', h('span', label), control, hint ? h('span.cv-hint', hint) : null);
const userOptions = () => [['', '—'], ...store.users.filter(u => u.active !== false).map(u => [u.id, u.name])];
const CHANNELS = { telefonata: 'Telefonata', email: 'Email', incontro: 'Incontro' };
const RESULT = { vinta: ['Vinta', 'trophy', 'gr'], persa: ['Persa', 'x', 'rd'], non_partecipato: ['Non abbiamo partecipato', 'clock', ''] };
const daysAgo = d => (d ? Math.round((Date.now() - new Date(d).getTime()) / 864e5) : null);

// forza della relazione in pillola: forte (fiamma), media, debole, si raffredda
export function warmPill(level, { cooling = false } = {}) {
  if (cooling) return h('span.cv-warm.c', ic('snowflake', 12), 'si raffredda');
  if (!level) return null;
  return h('span.cv-warm', { class: { forte: 'f', media: 'm', debole: 'd' }[level] }, level === 'forte' ? ic('flame', 12) : null, level);
}

// ── probabilità di vittoria ───────────────────────────────────────────────────────────────────
function explainProbability(p) {
  const m = cvModal({
    title: h('div', h('h2', 'Come si calcola la probabilità'), h('p.cv-small.cv-muted', { style: { margin: '2px 0 0' } }, 'Dagli esiti degli ultimi mesi (Impostazioni → Esiti).')),
    body: h('div', { style: { display: 'grid', gap: '10px' } },
      p.steps.map((s, i) => h('div.cv-row', h('span.cv-grow', s.label), h('span.cv-small.cv-muted', s.note), h('b', { style: { width: '52px', textAlign: 'right' } }, i === 0 ? `${Math.round(s.value * 100)}%` : `${s.delta >= 0 ? '+' : '−'} ${Math.abs(s.delta)}`))),
      h('div.cv-row', { style: { borderTop: '1px solid var(--cv-line)', paddingTop: '10px' } }, h('span.cv-grow.cv-t5', 'Probabilità'), h('b', { style: { color: 'var(--cv-gr)' } }, `${p.p}%`)),
      h('p.cv-hint', 'Ogni voce pesa di più quanti più esiti ha. Con BOSS gli esiti arrivano da soli e la stima migliora.')),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi')],
  });
}
export function probabilityBox(p) {
  if (!p) return null;
  if (p.learning) return h('div.cv-prob.learn', ic('sparkles', 18), h('div.cv-grow.cv-small', h('div.cv-t5', 'Probabilità di vittoria: in apprendimento'),
    h('div.cv-muted', `La BU ha ${p.have} esiti registrati: ne servono ${p.need} per dare un numero affidabile.`)));
  return h('div.cv-prob', h('span.cv-prob-n', `${p.p}%`),
    h('div.cv-grow.cv-small', h('div.cv-t5', 'Probabilità di vittoria'), h('div.cv-muted', p.steps.map(s => `${s.label.toLowerCase()} ${s.note}`).slice(0, 3).join(' · '))),
    h('button.cv-lnk', { type: 'button', on: { click: () => explainProbability(p) } }, 'Come si calcola'));
}

// strade calde: chi di noi → quale persona, con forza e motivo; la prima evidenziata
export function pathsBox(paths, { entity = '' } = {}) {
  return h('div', { style: { display: 'grid', gap: '8px' } },
    h('div.cv-row', h('div.cv-lbl.cv-grow', 'Chi conosciamo'), paths.length ? h('span.cv-small.cv-muted', `${paths.length} ${paths.length === 1 ? 'strada' : 'strade'}`) : null),
    paths.length ? paths.map((p, i) => h('div.cv-path', { class: i === 0 && (p.level === 'forte' || p.level === 'media') ? 'best' : '' },
      av(p.us?.name || '?', 'or'),
      h('div.cv-chain', h('span.cv-t5', p.us?.name || '—'), h('span.cv-ar', ic('chevron-right', 14)), h('span.cv-t5', p.contact), p.job ? h('span.cv-muted.cv-small', p.job) : null,
        p.why ? h('div.cv-small.cv-muted', { style: { width: '100%' } }, dots([p.why, p.last_at ? `ultimo contatto ${day(p.last_at)}` : ''])) : null),
      warmPill(p.level)))
      : h('p.cv-small.cv-muted', { style: { margin: 0 } }, entity ? `Non conosciamo ancora nessuno in «${entity}»: il primo passo va all'ufficio tecnico o a un contatto da cercare.` : 'Non conosciamo ancora nessuno qui.'));
}

// primo passo pronto: chi, come, quando e l'email; tutto modificabile. value() → il primo passo come lo si approva
export function firstMoveBox(move, { onRewrite } = {}) {
  if (!move) return { el: null, value: () => null };
  const owner = select(userOptions(), move.owner_id || '', { 'aria-label': 'Chi lo fa' });
  const channel = select(Object.entries(CHANNELS), move.channel || 'email', { 'aria-label': 'Come' });
  const due = input({ type: 'date', value: move.due_date || today(), 'aria-label': 'Quando' });
  const to = input({ value: move.contact || '', placeholder: 'Persona da contattare', 'aria-label': 'Persona' });
  const subject = input({ value: move.subject || '', 'aria-label': 'Oggetto' });
  const body = h('textarea.input', { rows: 8, 'aria-label': 'Email', style: { lineHeight: '21px' } }, move.body || '');
  const mailto = () => `mailto:${encodeURIComponent(move.contact_email || '')}?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(body.value)}`;
  const el = h('div', { style: { display: 'grid', gap: '10px' } },
    h('div.cv-row', h('div.cv-lbl.cv-grow.cv-row', { style: { gap: '6px' } }, ic('sparkles', 14), 'Primo passo pronto'),
      move.ai ? h('span.cv-small.cv-muted', 'scritto dall\'AI') : h('span.cv-small.cv-muted', 'modello del playbook'),
      onRewrite ? h('button.cv-lnk', { type: 'button', on: { click: onRewrite } }, ic('refresh', 13), 'Riscrivi') : null),
    h('div.cv-grid3', fld('Chi lo fa', owner), fld('Come', channel), fld('Quando', due)),
    h('div.cv-mail',
      h('div.cv-mail-h', h('span', 'A'), to, h('span', 'Oggetto'), subject),
      body),
    h('div.cv-row.cv-wrap', { style: { gap: '8px' } },
      h('a.btn.btn-sm', { href: '#', on: { click: e => { e.preventDefault(); window.location.href = mailto(); } } }, ic('mail', 14), 'Apri in Outlook'),
      h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: async () => { await navigator.clipboard?.writeText(`${subject.value}\n\n${body.value}`); toast('Email copiata'); } } }, ic('file-text', 14), 'Copia'),
      h('span.cv-small.cv-muted', 'L\'email non parte da sola: si apre come bozza nella tua posta.')));
  return { el, value: () => ({ ...move, owner_id: Number(owner.value) || null, channel: channel.value, due_date: due.value, contact: to.value.trim(), subject: subject.value, body: body.value }) };
}

// ── registra esito (riquadro a destra) ────────────────────────────────────────────────────────
export async function registraEsito(query = {}, onDone, existing = null) {
  const pre = existing ? { ...existing, reasons: (await get('/api/crm/esiti/nuovo')).reasons } : await get(`/api/crm/esiti/nuovo?${new URLSearchParams(Object.entries(query).filter(([, x]) => x))}`);
  const data = store.crmData || null;
  let result = pre.result || '';
  let m;
  const titleIn = input({ value: pre.title || '', placeholder: 'Gara o lavoro', 'aria-label': 'Gara o lavoro' });
  const buSel = select([['', '—'], ...(data?.asa || []).map(a => [a.key, a.label])], pre.bu || '', { 'aria-label': 'BU' });
  const origin = select(Object.entries(pre.origins || {}), pre.origin || 'altro', { 'aria-label': 'Provenienza' });
  const amount = input({ value: pre.amount ?? '', inputmode: 'decimal', placeholder: 'es. 1.200.000', 'aria-label': 'Importo' });
  const cig = input({ value: pre.cig || '', 'aria-label': 'CIG' });
  const reasonChips = choiceChips(pre.reasons.map(r => [r, r]), pre.reason || '', { label: 'Motivo' });
  const winner = input({ value: pre.winner_display || pre.winner_name || '', placeholder: 'Nome dell\'impresa', 'aria-label': 'Chi ha vinto' });
  const theirs = input({ value: pre.winner_discount ?? '', inputmode: 'decimal', placeholder: '%', 'aria-label': 'Il loro ribasso' });
  const ours = input({ value: pre.our_discount ?? '', inputmode: 'decimal', placeholder: '%', 'aria-label': 'Il nostro ribasso' });
  const bidders = input({ type: 'number', min: 0, value: pre.bidders ?? '', 'aria-label': 'Offerenti' });
  const when = input({ type: 'date', value: String(pre.decided_on || today()).slice(0, 10), 'aria-label': 'Data dell\'esito' });
  const lesson = h('textarea.input', { rows: 3, placeholder: 'Facoltativo', 'aria-label': 'Cosa impariamo' }, pre.lesson || '');
  const lostBox = h('div', { style: { display: 'grid', gap: '16px' } });
  const choice = h('div.cv-choice3');
  const draw = () => {
    fill(choice, Object.entries(RESULT).map(([k, [l, i, tone]]) => h('button.cv-choice', { type: 'button', class: k === result ? 'on' : '', 'aria-pressed': String(k === result), on: { click: () => { result = k; draw(); } } },
      h('span.cv-ib', { class: tone }, ic(i, 16)), h('span.cv-t5', l))));
    fill(lostBox,
      result === 'persa' ? [fld('Perché l\'abbiamo persa?', reasonChips.el), h('div.cv-grid3', fld('Chi ha vinto', winner, 'Se non è nel CRM diventa «Concorrente»'), fld('Il loro ribasso', theirs), fld('Il nostro', ours))]
        : result === 'non_partecipato' ? [fld('Perché?', reasonChips.el)]
          : result === 'vinta' ? [h('div.cv-grid3', fld('Il nostro ribasso', ours))] : null);
  };
  draw();
  m = cvModal({
    drawer: true,
    title: h('div.cv-head-row', h('span.cv-ib', { style: { width: '44px', height: '44px', borderRadius: '14px' } }, ic('trophy', 20)),
      h('div.cv-grow', h('div.cv-row.cv-wrap.cv-small.cv-muted', { style: { gap: '6px' } }, pre.bu && data ? pill(data.asa.find(a => a.key === pre.bu)?.label || pre.bu, 'line') : null, h('span', dots([pre.cig && `CIG ${pre.cig}`, pre.amount && eur(pre.amount)]))),
        h('h2', { style: { marginTop: '6px' } }, existing ? 'Esito' : 'Registra esito'), pre.subject_name ? h('div.cv-small.cv-muted', pre.subject_name) : null)),
    body: h('div', { style: { display: 'grid', gap: '18px' } },
      choice,
      fld('Gara o lavoro', titleIn),
      lostBox,
      h('div.cv-grid3', fld('Offerenti', bidders), fld('Data dell\'esito', when), fld('Importo', amount)),
      h('div.cv-grid3', fld('BU', buSel), fld('Da dove arriva', origin), fld('CIG', cig)),
      fld('Cosa impariamo', lesson),
      pre.anac && !existing ? h('div.cv-box.cv-ok.cv-small', h('div.cv-row', { style: { gap: '8px' } }, ic('check', 15), h('span', 'Compilato con l’aggiudicazione pubblicata da ANAC: esito, vincitore, ribasso e offerenti. Controlla e aggiungi il motivo.'))) : null,
      h('div.cv-box.cv-small.cv-muted', h('div.cv-row', { style: { gap: '8px' } }, ic('info', 15), h('span', 'Calcolato da solo: ', h('b', { style: { color: 'var(--cv-ink)' } }, pre.warm ? 'contatto caldo sì' : 'contatto caldo no'),
        pre.subject_name ? ` (rapporti con ${pre.subject_name})` : '', '. Con BOSS esiti, vincitore e ribassi arriveranno da soli.')))),
    left: existing && existing.source !== 'boss' ? [h('button.btn.btn-ghost', { type: 'button', on: { click: async () => {
      if (!await confirmDialog('Cancellare questo esito?', { ok: 'Cancella', danger: true })) return;
      await del(`/api/crm/esiti/${existing.id}`); m.close(); toast('Esito cancellato'); onDone?.();
    } } }, ic('trash', 15), 'Cancella')] : [],
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      existing?.source === 'boss' ? null : h('button.btn.btn-primary', { type: 'button', on: { click: async e => {
        if (!result) { toast('Scegli: vinta, persa o non abbiamo partecipato', 'error'); return; }
        e.currentTarget.disabled = true;
        const body = { result, title: titleIn.value, bu: buSel.value || null, origin: origin.value, amount: amount.value, cig: cig.value, reason: reasonChips.value || '',
          winner_name: winner.value, winner_discount: theirs.value, our_discount: ours.value, bidders: bidders.value, decided_on: when.value, lesson: lesson.value,
          subject_id: pre.subject_id || null, signal_id: pre.signal_id || null, plan_id: pre.plan_id || null, initiative_id: pre.initiative_id || null };
        try {
          if (existing) await put(`/api/crm/esiti/${existing.id}`, body); else await post('/api/crm/esiti', body);
        } catch { e.currentTarget.disabled = false; return; }
        m.close(); toast(result === 'vinta' ? 'Esito salvato: complimenti!' : 'Esito salvato'); onDone?.();
      } } }, ic('check', 15), 'Salva esito')],
  });
}

// ── esiti da registrare ───────────────────────────────────────────────────────────────────────
export function todoRows(items, onDone) {
  return items.map(t => listRow({ icon: 'trophy', title: t.title, after: t.late ? h('span.cv-bang', { title: 'Esito da registrare da più di un mese' }, '!') : null,
    meta: dots([t.bu_label, t.subject_name, t.plan_outcome === 'opportunita' ? `piano chiuso il ${day(t.closed_at)}` : t.deadline ? `${t.to_gare ? 'gara scaduta' : 'scadenza'} il ${day(t.deadline)}` : '', t.owner_name]),
    actions: [h('button.btn.btn-sm', { type: 'button', on: { click: () => registraEsito({ signal_id: t.signal_id, plan_id: t.plan_id }, onDone) } }, 'Registra esito')] }));
}
async function todoDialog(onDone) {
  const r = await get('/api/crm/esiti/da-registrare');
  let m;
  m = cvModal({ drawer: true, title: h('div', h('h2', 'Esiti da registrare'), h('p.cv-small.cv-muted', { style: { margin: '2px 0 0' } }, `Piani diventati opportunità e gare passate senza esito. Il «!» dopo ${r.alertDays} giorni.`)),
    body: r.items.length ? h('div', todoRows(r.items, () => { m.close(); onDone?.(); })) : emptyState('trophy', 'Nessun esito da registrare.'),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi')] });
}

// ── pagina «Vinte e perse» ────────────────────────────────────────────────────────────────────
const wrRow = (x, avg) => h('div.cv-wr', h('span.cv-t5', x.label), h('span.cv-wr-b', { role: 'img', 'aria-label': `${x.ratio}% vinte` }, h('i', { style: { width: `${x.ratio}%` } }), avg !== null ? h('u', { style: { left: `${avg}%` } }) : null),
  h('span.cv-wr-v', `${x.ratio}%`, h('small', `${x.won} su ${x.total}`)));
export async function esitiTab(box, data, state = { period: '12', bu: '' }) {
  fill(box, loading());
  const again = () => esitiTab(box, data, state);
  const r = await get(`/api/crm/esiti?period=${state.period}${state.bu ? `&bu=${state.bu}` : ''}`);
  const s = r.stats;
  const avg = s.ratio;
  const group = (label, list) => (list.length ? [sect(label), list.map(x => wrRow(x, avg))] : null);
  const buLabel = k => data.asa.find(a => a.key === k)?.label || k;
  const kpi = (l, n, sub, tone = '') => h('div.cv-kpi', h('span.cv-kpi-l', l), h('span.cv-kpi-n', n), sub ? h('span.cv-kpi-d', { class: tone }, sub) : null);
  const tbl = r.outcomes.length ? h('div.cv-tblwrap', h('table.cv-tbl', h('thead', h('tr', h('th', 'Esito'), h('th', 'Gara o lavoro'), h('th', 'BU'), h('th', 'Da'), h('th.num', 'Data'))),
    h('tbody', r.outcomes.map(o => h('tr.cv-click', { tabindex: 0, on: { click: () => registraEsito({}, again, o), keydown: e => { if (e.key === 'Enter') registraEsito({}, again, o); } } },
      h('td', pill(RESULT[o.result][0], RESULT[o.result][2])),
      h('td', h('div.cv-t5.cv-ell', { style: { maxWidth: '440px' } }, o.title), h('div.cv-small.cv-muted.cv-ell', { style: { maxWidth: '440px' } },
        dots([o.subject_name, o.result === 'persa' && (o.winner_display || o.winner_name) ? `vince ${o.winner_display || o.winner_name}${o.winner_discount != null ? ` · ${pct(o.winner_discount)}` : ''}` : '', o.reason, o.amount && eur(o.amount), o.warm ? 'contatto caldo' : '']))),
      h('td', o.bu ? pill(o.bu_label || o.bu, 'line') : '—'),
      h('td', o.source === 'boss' ? pill('BOSS', 'bl') : pill('a mano')),
      h('td.num.cv-small.cv-muted', day(o.decided_on))))))) : emptyState('trophy', 'Nessun esito in questo periodo. Registra il primo: bastano tre tocchi.', h('button.btn.btn-sm', { type: 'button', on: { click: () => registraEsito({}, again) } }, 'Registra esito'));
  fill(box,
    pageTop({ eyebrow: 'Alma CRM · win ratio', heading: title('Vinte e', 'perse'), sub: 'Cosa vinciamo, cosa perdiamo e perché. Gli esiti di BOSS arriveranno da soli.',
      actions: [r.todo ? h('button.btn', { type: 'button', on: { click: () => todoDialog(again) } }, ic('alert-triangle', 15), 'Esiti da registrare', h('span.cv-bang', String(r.todo))) : null,
        h('button.btn.btn-primary', { type: 'button', on: { click: () => registraEsito({}, again) } }, ic('plus', 15), 'Registra esito')] }),
    h('div.cv-row.cv-wrap', { style: { gap: '10px', marginBottom: '20px' } },
      seg([['12', 'Ultimi 12 mesi'], ...r.years.map(y => [String(y), String(y)]), ['tutto', 'Tutto']], state.period, k => { state.period = k; again(); }, { label: 'Periodo' }),
      r.bus.length > 1 ? seg([['', 'Tutte le BU'], ...r.bus.map(b => [b, buLabel(b)])], state.bu, k => { state.bu = k; again(); }, { label: 'BU' }) : null),
    h('div.cv-kpis',
      kpi('Win ratio', s.ratio === null ? '—' : h('b', `${s.ratio}%`), `${s.won} vinte · ${s.lost} perse`),
      kpi('Valore vinto', h('span', eur(s.value_won)), s.value_bid ? `su ${eur(s.value_bid)} offerti` : ''),
      kpi('Offerte con esito', h('b', String(s.won + s.lost)), s.skipped ? `${s.skipped} senza partecipare` : ''),
      kpi('Ribasso medio di chi vince', h('b', pct(s.winner_discount)), s.our_discount !== null ? `il nostro: ${pct(s.our_discount)}` : '', 'rd')),
    s.won + s.lost ? h('div.cv-grid2', { style: { gap: '24px', marginTop: '24px' } },
      card({ title: 'Dove vinciamo', right: avg !== null ? h('span.cv-small.cv-muted', `| media Almacis ${avg}%`) : null }, group('Contatto caldo', s.by.warm), group('Per BU', s.by.bu), h('div', { style: { height: '12px' } })),
      card({ title: 'Da dove arrivano' }, group('Provenienza', s.by.origin), group('Per tipo di ente', s.by.entity), group('Per importo', s.by.band), h('div', { style: { height: '12px' } }))) : null,
    h('div.cv-cols.w400', { style: { marginTop: '24px' } },
      card({ title: 'Ultimi esiti', count: r.total }, tbl),
      h('div', { style: { display: 'grid', gap: '24px' } },
        card({ title: 'Chi ci batte', right: h('span.cv-small.cv-muted', r.boss ? 'da BOSS' : 'dagli esiti') },
          s.winners.length ? s.winners.map(w => listRow({ icon: 'handshake', tone: 'rd', title: w.name, href: w.subject_id ? `#/crm/scheda/${w.subject_id}` : undefined,
            meta: dots([w.bus.join(', '), `ci ha battuti ${w.times} ${w.times === 1 ? 'volta' : 'volte'}`]), actions: w.discount !== null ? [h('div', { style: { textAlign: 'right' } }, h('div.cv-t5', pct(w.discount)), h('div.cv-small.cv-muted', 'ribasso medio'))] : null }))
            : emptyState('handshake', 'Quando registri una gara persa con il vincitore, qui vedi chi ci batte e con che ribasso.')),
        s.by.reason.length ? card({ title: 'Perché perdiamo' }, s.by.reason.map(x => listRow({ icon: 'x', tone: 'rd', title: x.label, meta: `${x.n} ${x.n === 1 ? 'volta' : 'volte'}` }))) : null)));
}

// ── pagina «Chi conosciamo» ───────────────────────────────────────────────────────────────────
export async function relazioniTab(box, data, state = { mine: false, q: '' }) {
  fill(box, loading());
  const again = () => relazioniTab(box, data, state);
  const r = await get(`/api/crm/relazioni${state.mine ? '?mine=1' : ''}`);
  const { openSignal } = await import('./crm-radar.js');
  const list = h('div');
  const search = h('input.input', { type: 'search', placeholder: 'Cerca azienda o persona…', value: state.q, 'aria-label': 'Cerca', style: { maxWidth: '240px', height: '34px' } });
  const drawList = () => {
    const q = state.q.trim().toLowerCase();
    const rows = r.list.filter(x => !q || `${x.name} ${x.people.map(p => p.name).join(' ')}`.toLowerCase().includes(q));
    fill(list, rows.length ? h('div.cv-tblwrap', h('table.cv-tbl', h('thead', h('tr', h('th', 'Azienda o ente'), h('th', 'Persone che conosciamo'), h('th', 'Chi di noi'), h('th', 'Ultimo contatto'), h('th', 'Forza'))),
      h('tbody', rows.slice(0, 150).map(x => h('tr.cv-click', { tabindex: 0, on: { click: () => { location.hash = `#/crm/scheda/${x.subject_id}`; }, keydown: e => { if (e.key === 'Enter') location.hash = `#/crm/scheda/${x.subject_id}`; } } },
        h('td', h('div.cv-t5.cv-ell', { style: { maxWidth: '260px' } }, x.name), h('div.cv-small.cv-muted', dots([x.key ? 'key account' : '', x.projects ? `${x.projects} ${x.projects === 1 ? 'commessa' : 'commesse'}` : '']))),
        h('td.cv-small', h('div.cv-ell', { style: { maxWidth: '260px' } }, x.people.map(p => p.name).join(', ') || '—')),
        h('td', h('span.cv-row', { style: { gap: '0' } }, [...new Map(x.people.filter(p => p.us).map(p => [p.us.id, p.us])).values(), ...(x.us && !x.people.some(p => p.us?.id === x.us.id) ? [x.us] : [])].slice(0, 3).map(u => av(u.name, 'or')))),
        h('td.cv-small.cv-muted', x.last_at ? day(x.last_at) : '—'),
        h('td', warmPill(x.level, { cooling: x.cooling })))))))
      : emptyState('users', q ? 'Nessuna azienda con questo nome.' : 'Ancora niente: i rapporti nascono da incontri ed email collegati nel CRM, commesse e key account.'));
  };
  search.addEventListener('input', () => { state.q = search.value; drawList(); });
  drawList();
  fill(box,
    pageTop({ eyebrow: 'Alma CRM · relazioni', heading: title('Chi', 'conosciamo'), sub: 'Le persone che ci aprono le porte, da incontri, email, commesse e key account.',
      actions: [r.myBus.length ? seg([['0', 'Tutte le BU'], ['1', 'Le mie BU']], state.mine ? '1' : '0', k => { state.mine = k === '1'; again(); }, { label: 'BU' }) : null] }),
    card({ title: 'Occasioni dove conosciamo qualcuno', count: r.warm.length, right: h('a.cv-lnk', { href: '#/crm/radar' }, 'Tutte nel radar') },
      r.warm.length ? r.warm.map(g => h('div.cv-sig.cv-sig-warm', scoreRing(g.score),
        h('button.cv-sig-main', { type: 'button', on: { click: () => openSignal(g.id, again, data, r.warm) } }, h('div.cv-sig-t.cv-clamp', g.title), h('div.cv-sig-m', g.bu_label ? pill(g.bu_label, 'line') : null, g.status === 'interessa' ? pill('Interessa', 'gr') : null)),
        h('div.cv-chain', av(g.path.us?.name || '?', 'or'), h('span.cv-t5', (g.path.us?.name || '').split(' ')[0]), h('span.cv-ar', ic('chevron-right', 14)), h('span', h('span.cv-t5', g.path.contact), g.path.job ? h('div.cv-small.cv-muted', g.path.job) : null)),
        h('div', { style: { display: 'grid', justifyItems: 'end', gap: '6px' } }, warmPill(g.level), h('span.cv-small.cv-muted.cv-ell', { style: { maxWidth: '220px' } }, g.path.why))))
        : emptyState('radar', 'Nessun segnale aperto su aziende dove conosciamo qualcuno.')),
    h('div.cv-cols.w400', { style: { marginTop: '24px' } },
      card({ title: 'Le nostre relazioni', count: r.total, right: search }, list),
      h('div', { style: { display: 'grid', gap: '24px' } },
        card({ title: 'Si raffreddano', count: r.cooling.length || null },
          r.cooling.length ? r.cooling.map(x => listRow({ icon: 'snowflake', tone: 'bl', title: x.name, href: `#/crm/scheda/${x.subject_id}`,
            meta: dots([x.key ? 'key account' : '', x.last_at ? `nessun contatto da ${daysAgo(x.last_at)} giorni` : 'nessun contatto recente', x.us?.name]) }))
            : emptyState('snowflake', `Nessun rapporto forte fermo da più di ${r.coolDays} giorni.`)),
        card({ title: 'Ex colleghi', count: r.ex.length || null },
          r.ex.length ? r.ex.map(p => listRow({ icon: 'arrows', tone: 'or', title: p.name, href: `#/crm/scheda/${p.subject_id}`,
            meta: dots([p.now_at ? `ora in ${p.now_at}` : '', `prima in ${p.subject_name}`, p.us ? `lo conosce ${p.us.name}` : '']) }))
            : emptyState('users', 'Quando un contatto cambia azienda, qui vedi dove porta i suoi rapporti.')))));
}
