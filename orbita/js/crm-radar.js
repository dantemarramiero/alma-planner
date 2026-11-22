// Radar commerciale (canvas «Segnale», «Piano d'azione», «Scheda azienda · Piano d'azione», «Proposte dal radar»),
// con il design v2 del 14/11 (artboard «Segnale», «Piano», «Scheda-tab», «Gare», «Sotto-soglia»): segnale e piano
// si aprono in un riquadro laterale da 600 px con l'elenco visibile dietro; azioni sempre nel piede fisso.
import { h, fill, confirmDialog, toast, fmtDate, loading, promptDialog, initials } from './ui.js';
import { get, post, del, api } from './api.js';
import { store } from './store.js';
import { ic, dots, pill, av, pageTop, title, kpiRow, card, link, sect, listRow, emptyState, toggle, choiceChips, cvModal, scoreRing } from './crm-v2.js';
import { probabilityBox, pathsBox, firstMoveBox, registraEsito } from './crm-esiti.js';
import { garaBox } from './crm-concorrenza.js';
import { linksBox, touchBox, touchBadges } from './crm-progetti.js';
import { regionPicker } from './crm-regioni-pick.js';
const STAGE_LABEL = { programmata: 'Programmata', finanziata: 'Finanziata', progetto: 'Progetto approvato', determina: 'Determina o avviso', vinta_altri: 'Vinta da altri' };

const CHANNELS = { telefonata: 'Telefonata', email: 'Email', incontro: 'Incontro', sopralluogo: 'Sopralluogo', altro: 'Altro' };
const CH_ICON = { telefonata: 'phone', email: 'mail', incontro: 'users', sopralluogo: 'map-pin', altro: 'circle' };
const KINDS = { investimento: 'Investimento privato', permesso: 'Permesso o piano attuativo', opera_finanziata: 'Opera pubblica finanziata', scadenza: 'Contratto in scadenza',
  nuovo_gestore: 'Nuovo gestore o proprietà', cliente: 'Notizia su un cliente', notizia: 'Notizia', indiscrezione: 'Indiscrezione', gara: 'Gara già bandita' };
const KIND_SHORT = { investimento: 'Investimento', permesso: 'Permesso', opera_finanziata: 'Opera finanziata', scadenza: 'Contratto in scadenza', nuovo_gestore: 'Nuovo gestore',
  cliente: 'Notizia su un cliente', notizia: 'Notizia', indiscrezione: 'Indiscrezione', gara: 'Gara' };
const PARTS = [['fit', 'Coerenza'], ['concreteness', 'Concretezza'], ['timing', 'Tempi'], ['relationship', 'Rapporto'], ['value', 'Valore']];
const OUTCOMES = { opportunita: 'Opportunità in BOSS', rimandato: 'Rimandato', perso: 'Perso' };
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const day = d => (d ? fmtDate(String(d).slice(0, 10)) : '—');
const eur = n => (n === null || n === undefined || n === '' ? '—' : Number(n) >= 1e6 ? `${(Number(n) / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 2 })} M€` : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0 })} €`);
const input = (attrs = {}) => h('input.input', attrs);
const select = (options, value, attrs = {}) => h('select.select', attrs, options.map(([k, label]) => h('option', { value: k, selected: String(k) === String(value ?? '') }, label)));
const textarea = (value, attrs = {}) => h('textarea.input', { rows: 3, ...attrs }, value || '');
const fld = (label, control, hint) => h('label.cv-fld', h('span', label), control, hint ? h('span.cv-hint', hint) : null);
const userOptions = () => [['', '—'], ...store.users.filter(u => u.active !== false).map(u => [u.id, u.name])];
const personName = p => [p.title, p.first_name, p.last_name].filter(Boolean).join(' ');
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const daysTo = d => Math.round((Date.parse(`${String(d).slice(0, 10)}T12:00:00Z`) - Date.parse(`${today()}T12:00:00Z`)) / 864e5);

export const scoreBadge = (score, highlight = 70) => scoreRing(score, { size: 'sm', hi: highlight });

// ── decidere un segnale ───────────────────────────────────────────────────────────────────────
// Scarta (artboard «Segnale»): motivi come pillole da toccare, nota facoltativa
export function discardDialog(sig, reasons, onDone) {
  const reason = choiceChips(reasons.map(r => [r, r]), '', { label: 'Perché?' });
  const note = input({ placeholder: 'Facoltativa: «già arrivato da Infordat la settimana scorsa»', maxlength: 500, 'aria-label': 'Nota' });
  const m = cvModal({
    size: 'sm',
    title: h('div', h('h2', sig.to_gare ? 'Scarta la gara' : 'Scarta il segnale'), h('div.cv-subh.cv-clamp', sig.title)),
    body: h('div.en-form', h('div.cv-fld', h('span', 'Perché?'), reason.el), fld('Nota (facoltativa)', note), h('p.cv-hint', 'Gli scarti insegnano al radar cosa non mandare più.')),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (!reason.value) return toast('Scegli il motivo', 'err');
        await post(sig.to_gare ? `/api/crm/radar/signals/${sig.id}/gare` : `/api/crm/radar/signals/${sig.id}/scarta`, sig.to_gare ? { action: 'scarta', reason: reason.value, note: note.value } : { reason: reason.value, note: note.value });
        m.close();
        toast('Scartato');
        onDone?.();
      } } }, 'Scarta')],
  });
}
export async function interessa(sig, onDone, { move = null, approve = false } = {}) {
  const out = await post(`/api/crm/radar/signals/${sig.id}/interessa`, { ...(move ? { first_move: move } : {}), approve });
  onDone?.();
  if (approve) { toast('Piano partito: il primo passo è in «La mia settimana»'); return; }
  toast('Interessa: ecco il piano d\'azione proposto');
  openPlan(out.plan.id, onDone);
}
// Il segnale nel riquadro a destra: punteggio grande, titolo, fonte; tre fatti; il punteggio spiegato; chi conosciamo.
// Le frecce passano al segnale prima e dopo dell'elenco da cui si è aperto.
export async function openSignal(id, onDone, data, list = []) {
  const g = await get(`/api/crm/radar/signals/${id}`);
  const parts = g.score_parts || {};
  let m;
  const done = () => { m.close(); onDone?.(); };
  const idx = list.findIndex(x => x.id === id);
  const move = d => { const next = list[idx + d]; if (next) { m.close(); openSignal(next.id, onDone, data, list); } };
  const why = {
    fit: g.why || (g.bu_label ? `profilo di ${g.bu_label}` : ''),
    concreteness: KINDS[g.kind] || '',
    timing: g.deadline ? `${g.to_gare ? 'scadenza' : 'lavori'} ${day(g.deadline)}` : 'data non indicata',
    relationship: g.subject_roles?.includes('cliente') ? 'cliente attuale' : g.subject_id ? 'già nel CRM' : 'non lo conosciamo ancora',
    value: g.amount ? eur(g.amount) : 'importo non indicato',
  };
  const facts = [['Chi', g.subject_id ? h('a', { href: `#/crm/scheda/${g.subject_id}`, on: { click: () => m.close() } }, g.subject_name || g.entity) : (g.entity || '—'), 'building'],
    ['Quanto', eur(g.amount), 'euro'], g.expected_on && !g.deadline ? ['Bando atteso', day(g.expected_on), 'hourglass'] : ['Quando', g.deadline ? (g.to_gare ? `scade il ${day(g.deadline)}` : day(g.deadline)) : '—', 'calendar']];
  const known = h('div', { style: { display: 'grid', gap: '18px' } }, h('div.loading', h('span.spinner')));
  let fm = null;
  const decided = g.status !== 'nuovo';
  const buSel = data && !g.to_gare && !decided ? select([['', 'Altra BU…'], ...data.asa.filter(a => a.key !== g.bu).map(a => [a.key, a.label])], '', { 'aria-label': 'Manda a un\'altra BU', style: { width: 'auto' } }) : null;
  buSel?.addEventListener('change', async () => {
    if (!buSel.value) return;
    await post(`/api/crm/radar/signals/${g.id}/bu`, { bu: buSel.value });
    toast('Mandato all\'altra BU');
    done();
  });
  m = cvModal({
    drawer: true,
    title: h('div.cv-head-row', scoreRing(g.score, { size: 'lg', hi: g.highlight || 70 }),
      h('div.cv-grow',
        h('div.cv-row.cv-wrap.cv-small.cv-muted', { style: { gap: '6px' } }, pill(KIND_SHORT[g.kind] || (g.kind === 'subappalto' ? 'Subappalto o ATI' : g.kind) || 'Segnale', 'or'), g.stage ? pill(STAGE_LABEL[g.stage] || g.stage, 'bl') : null, g.bu_label ? pill(g.bu_label, 'line') : null,
          h('span', dots([g.source === 'infordat' ? 'Infordat' : g.source === 'manuale' ? 'segnalato a mano' : g.source, day(g.published_on || g.created_at)]))),
        h('h2', { style: { marginTop: '6px' } }, g.title),
        g.url ? h('a.cv-lnk', { href: g.url, target: '_blank', rel: 'noopener', style: { marginTop: '4px' } }, ic('external', 13), `Apri la fonte${host(g.url) ? ` · ${host(g.url)}` : ''}`) : null),
      list.length > 1 ? h('div.cv-navbtns',
        h('button.btn.btn-sm.btn-ghost.cv-ico', { type: 'button', 'aria-label': 'Segnale prima', disabled: idx <= 0 || undefined, on: { click: () => move(-1) } }, ic('chevron-left', 15)),
        h('button.btn.btn-sm.btn-ghost.cv-ico', { type: 'button', 'aria-label': 'Segnale dopo', disabled: idx < 0 || idx >= list.length - 1 || undefined, on: { click: () => move(1) } }, ic('chevron-right', 15))) : null),
    body: h('div', { style: { display: 'grid', gap: '20px' } },
      h('div.cv-facts', facts.map(([l, val, i]) => h('div.cv-fact', h('div.cv-row.cv-small.cv-muted', { style: { gap: '6px' } }, ic(i, 14), l), h('div.cv-t5', val)))),
      g.summary ? h('div', h('div.cv-lbl', 'Cosa dice la notizia'), h('p', { style: { margin: '6px 0 0' } }, g.summary)) : null,
      h('div.cv-box.big', h('div.cv-row', h('div.cv-lbl.cv-grow', `Come si arriva a ${g.score}`), h('span.cv-small.cv-muted', 'pesi in Impostazioni')),
        PARTS.map(([k, l]) => [h('div.cv-part', h('span', l), h('span.cv-bar', h('i', { style: { width: `${g.weights?.[k] ? Math.round((100 * (parts[k] || 0)) / g.weights[k]) : 0}%` } })), h('b', `${parts[k] ?? 0}/${g.weights?.[k] ?? '—'}`)),
          why[k] ? h('div.cv-part-why.cv-small.cv-muted', why[k]) : null])),
      g.soa?.length || g.cig || g.place || g.region ? h('dl.cv-kv', [g.place || g.region ? [h('dt', 'Luogo'), h('dd', [g.place, g.region].filter(Boolean).join(', '))] : null,
        g.soa?.length ? [h('dt', 'SOA'), h('dd', g.soa.join(' · '))] : null, g.cig ? [h('dt', 'CIG'), h('dd', g.cig)] : null]) : null,
      g.soa?.length || g.cig ? garaBox(g, { onDone, close: () => m.close() }) : null, // prezzo e concorrenti dai dati ANAC (17/11)
      known,
      (() => { const wrap = h('div', { style: { display: 'grid', gap: '14px' } }); const lb = () => linksBox({ signal: g.id }, { title: 'Collegati a questa opportunità' }); let cur = lb(); wrap.append(touchBox({ signal: g.id }, { onChange: () => { const n = lb(); cur.replaceWith(n); cur = n; } }), cur); return wrap; })(),
      decided ? h('div.cv-soft.cv-small', `Deciso: ${({ interessa: 'Interessa', scartato: `scartato (${g.discard_reason})`, boss: 'portato su BOSS', gara_scartata: `gara scartata (${g.discard_reason})` })[g.status]} · ${dots([g.decided_by_name, day(g.decided_at)])}`) : null),
    left: decided ? [] : g.to_gare ? [h('button.btn', { type: 'button', on: { click: () => discardDialog(g, g.discardReasons, done) } }, ic('x', 15), 'Scarta')]
      : [h('button.btn', { type: 'button', on: { click: () => discardDialog(g, g.discardReasons, done) } }, ic('x', 15), 'Scarta'), buSel],
    actions: decided ? [['interessa', 'boss'].includes(g.status) ? h('button.btn', { type: 'button', on: { click: () => { m.close(); registraEsito({ signal_id: g.id }, onDone); } } }, ic('trophy', 15), 'Registra esito') : null,
      g.project_id ? h('a.btn', { href: `#/crm/progetto/${g.project_id}`, on: { click: () => m.close() } }, ic('folder', 15), 'Apri il progetto')
        : g.status === 'interessa' ? h('a.btn.btn-primary', { href: `#/crm/lancio/s/${g.id}`, on: { click: () => m.close() } }, ic('rocket', 15), 'Porta avanti') : null,
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi')]
      : g.to_gare ? [h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await post(`/api/crm/radar/signals/${g.id}/gare`, { action: 'boss' }); toast('Da portare su BOSS'); done(); } } }, 'Porta su BOSS')]
        : [h('button.btn', { type: 'button', on: { click: () => { const move = fm?.value(); m.close(); interessa(g, onDone, { move }); } } }, fm?.el ? 'Solo interessa' : [ic('check', 15), 'Interessa']),
          h('button.btn.btn-primary', { type: 'button', 'data-approve': '', hidden: true, on: { click: () => { const move = fm?.value(); m.close(); interessa(g, onDone, { move, approve: true }); } } }, ic('check', 15), 'Interessa e approva')],
  });
  const keys = e => { if (e.target.closest('input, textarea, select')) return; if (e.key === 'ArrowLeft') move(-1); if (e.key === 'ArrowRight') move(1); };
  m.box.addEventListener('keydown', keys);
  // probabilità di vittoria, chi conosciamo (strade calde) e primo passo pronto (canvas «v3 · Segnale», 16/11)
  const drawKnown = async fresh => {
    const pp = await get(`/api/crm/radar/signals/${g.id}/primo-passo${fresh ? '?fresh=1' : ''}`).catch(() => null);
    if (!known.isConnected) return;
    if (!pp) { fill(known); return; }
    fm = !decided && pp.move ? firstMoveBox(pp.move, { onRewrite: () => { fill(known, h('div.loading', h('span.spinner'))); drawKnown(true); } }) : null;
    fill(known, probabilityBox(pp.probability), pathsBox(pp.paths, { entity: g.entity }),
      !g.subject_id && !pp.paths.length ? h('p.cv-small.cv-muted', { style: { margin: '-10px 0 0' } }, `«${g.entity || 'Questo ente'}» non è ancora nel CRM: con «Interessa» diventa un lead.`) : null,
      fm?.el || null);
    const approve = m.box.querySelector('[data-approve]');
    if (approve) approve.hidden = !fm?.el;
    const only = approve?.previousElementSibling;
    if (only) fill(only, ...(fm?.el ? ['Solo interessa'] : [ic('check', 15), 'Interessa']));
  };
  drawKnown(false);
}
// riga di un segnale: anello, titolo su 2 righe, un rigo di dettagli con il perché in pillola, Scarta · Interessa
export function signalRow(sig, { highlight = 70, reasons, onChange, data, list = [], weak = null }) {
  const bu = data?.asa?.find(a => a.key === sig.bu)?.label || sig.bu_label;
  return h('div.cv-sig',
    scoreRing(sig.score, { hi: highlight }),
    h('button.cv-sig-main', { type: 'button', on: { click: () => openSignal(sig.id, onChange, data, list) } },
      h('div.cv-sig-t.cv-clamp', sig.title),
      h('div.cv-sig-m', [sig.subject_name || sig.entity, sig.amount ? eur(sig.amount) : null, KIND_SHORT[sig.kind]].filter(Boolean).flatMap((x, i) => (i ? [h('i', '·'), x] : [x])),
        weak ? [h('i', '·'), weak] : bu ? [h('i', '·'), pill(bu, 'line')] : null)),
    sig.status === 'nuovo' && !sig.to_gare ? h('div.cv-acts',
      h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => discardDialog({ ...sig, to_gare: false }, reasons, onChange) } }, 'Scarta'),
      h('button.btn.btn-sm', { type: 'button', on: { click: () => interessa(sig, onChange) } }, ic('check', 14), weak ? 'Interessa lo stesso' : 'Interessa')) : null);
}

// Segnala un'occasione: tre campi; tipo, BU, importo e data si aprono con «Aggiungi dettagli»
export function newSignalDialog(data, onDone) {
  const titleIn = input({ placeholder: '«Rossi Logistica ottiene 8 M€ per un polo a San Salvo»', maxlength: 500, 'aria-label': 'Cosa è successo' });
  const entity = input({ placeholder: 'Ente o azienda', maxlength: 300, 'aria-label': 'Ente o azienda', list: 'cv-subjects' });
  const names = h('datalist', { id: 'cv-subjects' });
  get('/api/crm/subjects').then(r => fill(names, r.subjects.slice(0, 2000).map(s => h('option', { value: s.name })))).catch(() => {});
  const inCrm = h('span');
  entity.addEventListener('input', () => fill(inCrm, [...names.children].some(o => o.value.toLowerCase() === entity.value.trim().toLowerCase()) ? pill('nel CRM', 'gr') : null));
  const url = input({ type: 'url', placeholder: 'https://…', 'aria-label': 'Link alla fonte' });
  const kind = select(Object.entries(KINDS).filter(([k]) => k !== 'gara'), 'notizia', { 'aria-label': 'Tipo' });
  const bu = select([['', 'La sceglie il radar dal profilo'], ...data.asa.map(a => [a.key, a.label])], '', { 'aria-label': 'BU' });
  const amount = input({ placeholder: 'es. 1.200.000', inputmode: 'decimal', 'aria-label': 'Importo (€)' });
  const deadline = input({ type: 'date', 'aria-label': 'Quando' });
  const summary = textarea('', { rows: 3, placeholder: 'Dettagli (facoltativi)', 'aria-label': 'Dettagli' });
  const more = h('div', { hidden: true, style: { display: 'grid', gap: '16px' } }, h('div.cv-grid2', { style: { gap: '10px' } }, fld('Tipo', kind), fld('BU', bu)),
    h('div.cv-grid2', { style: { gap: '10px' } }, fld('Importo (€)', amount), fld('Quando (gara o lavori)', deadline)), fld('Dettagli', summary));
  const moreLink = link([ic('plus', 14), 'Aggiungi dettagli (tipo, BU, importo, data)'], { on: { click: () => { more.hidden = false; moreLink.hidden = true; } } });
  const m = cvModal({
    size: 'sm',
    title: h('div', h('h2', 'Segnala un\'occasione'), h('div.cv-subh', 'Il radar sceglie la BU e calcola il punteggio.')),
    body: h('div.en-form', fld('Cosa è successo', titleIn), h('label.cv-fld', h('span', 'Ente o azienda'), h('div.cv-row', { style: { gap: '8px' } }, entity, inCrm), names), fld('Link alla fonte', url), moreLink, more),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (!titleIn.value.trim()) return toast('Scrivi cosa è successo', 'err');
        const g = await post('/api/crm/radar/signals', { title: titleIn.value, entity: entity.value, kind: kind.value, bu: bu.value || null, amount: amount.value || null, deadline: deadline.value || null, url: url.value, summary: summary.value });
        m.close();
        toast(`Segnale salvato: punteggio ${g.score}${g.bu ? '' : ' (nessuna BU adatta)'}`);
        onDone?.();
      } } }, 'Salva il segnale')],
  });
  setTimeout(() => titleIn.focus(), 50);
}

// ── piano d'azione (artboard «Piano»), nel riquadro laterale ─────────────────────────────────
// Proposto: linea del tempo, referenze come pillole, passi come schede compatte (chi, come, con chi, data), bozza con
// «Copia», passi trascinabili, «Aggiungi passo». Accettato: barra di avanzamento e passi spuntati, «Chiudi il piano».
export async function openPlan(id, onDone) {
  const p = await get(`/api/crm/plans/${id}`);
  const proposed = p.status === 'proposto';
  const contactOpts = [['', 'Con chi…'], ...p.contacts.map(c => [c.id, personName(c) + (c.job ? ` · ${c.job}` : '')])];
  const rows = h('div');
  const timeline = h('div');
  const refs = String(p.refs || '').split(/\s*[;\n]\s*|\s+·\s+/).map(x => x.trim()).filter(Boolean);
  let dragged = null;
  const drawTimeline = () => {
    const dates = [...rows.querySelectorAll('[data-f="due_date"]')].map(i => i.value).filter(Boolean).sort();
    if (!dates.length) return fill(timeline);
    const t0 = Date.parse(`${today()}T12:00:00Z`);
    const last = Date.parse(`${dates[dates.length - 1]}T12:00:00Z`);
    const span = Math.max(1, last - t0);
    const all = [['Oggi', t0, 'now'], ...[...new Set(dates)].map((d, i, a) => [day(d), Date.parse(`${d}T12:00:00Z`), i === a.length - 1 ? 'end' : ''])];
    // le etichette troppo vicine si toccherebbero: resta il pallino, l'etichetta solo se c'è spazio (sempre l'ultima)
    let lastPct = -100;
    const marks = all.map(([l, t, k]) => { const pct = ((t - t0) / span) * 100; const show = k === 'end' || pct - lastPct >= 12; if (show) lastPct = pct; return [show ? l : '', t, k]; });
    fill(timeline, h('div', { style: { position: 'relative', height: '44px', margin: '0 22px' }, 'aria-label': `Il piano dura fino al ${day(dates[dates.length - 1])}` },
      h('div', { style: { position: 'absolute', left: 0, right: 0, top: '12px', height: '2px', background: 'var(--cv-line)' } }),
      marks.map(([l, t, k]) => h('div', { style: { position: 'absolute', left: `${Math.max(0, Math.min(100, ((t - t0) / span) * 100))}%`, top: '6px', transform: 'translateX(-50%)', display: 'grid', justifyItems: 'center', gap: '4px' } },
        h('span', { style: { width: '14px', height: '14px', borderRadius: '50%', background: k === 'now' ? 'var(--cv-dark)' : k === 'end' ? 'var(--cv-card)' : 'var(--cv-orange)', border: `2px solid ${k === 'end' ? 'var(--cv-dark)' : 'var(--cv-card)'}`, boxShadow: '0 0 0 1px var(--cv-line-strong)' } }),
        h('span.cv-small.cv-muted', { style: { whiteSpace: 'nowrap' } }, l)))));
  };
  const renumber = () => { [...rows.children].forEach((r, i) => { r.querySelector('.cv-n').textContent = String(i + 1); }); drawTimeline(); };
  const addRow = (st = { title: '', due_date: '', owner_id: p.owner_id, contact_id: '', channel: '', draft: '' }) => {
    const draft = textarea(st.draft, { rows: 4, 'data-f': 'draft', 'aria-label': 'Bozza del messaggio', placeholder: 'Il testo dell\'email o cosa dire al telefono' });
    const draftBox = h('div.cv-soft', { hidden: !st.draft, style: { display: 'grid', gap: '6px' } },
      h('div.cv-row.cv-small.cv-muted', { style: { gap: '6px' } }, ic('mail', 13), 'Bozza del messaggio', h('span.cv-grow'),
        link('Copia', { on: { click: async () => { try { await navigator.clipboard.writeText(draft.value); toast('Bozza copiata'); } catch { toast('Non riesco a copiare', 'err'); } } } })), draft);
    const r = h('div', { draggable: 'true', style: { display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: '12px', padding: '14px 0', borderTop: '1px solid var(--cv-line-2)' },
      on: { dragstart: e => { dragged = r; e.dataTransfer.effectAllowed = 'move'; r.style.opacity = '.5'; }, dragend: () => { r.style.opacity = ''; dragged = null; renumber(); },
        dragover: e => { e.preventDefault(); if (dragged && dragged !== r) { const after = e.clientY > r.getBoundingClientRect().top + r.offsetHeight / 2; rows.insertBefore(dragged, after ? r.nextSibling : r); } } } },
    h('span.cv-n', { style: { width: '26px', height: '26px', borderRadius: '50%', background: 'var(--cv-or-t)', color: 'var(--cv-or-ink)', fontWeight: 700, fontSize: '12px', display: 'grid', placeItems: 'center' } }),
    h('div', { style: { display: 'grid', gap: '8px', minWidth: 0 } },
      h('div.cv-row', { style: { gap: '8px' } }, input({ value: st.title, 'data-f': 'title', placeholder: 'Passo', maxlength: 300, 'aria-label': 'Passo', style: { fontWeight: 500, flex: '1', minWidth: '0', width: 'auto' } }),
        input({ type: 'date', value: st.due_date || '', 'data-f': 'due_date', 'aria-label': 'Entro quando', style: { width: '150px', flex: 'none' }, on: { input: drawTimeline } }),
        h('span.btn.btn-sm.btn-ghost.cv-ico', { title: 'Trascina per spostare', 'aria-hidden': 'true', style: { cursor: 'grab' } }, ic('grip-vertical', 15)),
        h('button.btn.btn-sm.btn-ghost.cv-ico', { type: 'button', 'aria-label': 'Togli il passo', on: { click: () => { r.remove(); renumber(); } } }, ic('trash', 14))),
      h('div.cv-row.cv-wrap', { style: { gap: '8px' } },
        select(userOptions(), st.owner_id || '', { 'data-f': 'owner_id', 'aria-label': 'Chi lo fa', style: { width: 'auto', minHeight: '32px', height: '32px', fontSize: '13px' } }),
        select([['', 'Come…'], ...Object.entries(CHANNELS)], st.channel || '', { 'data-f': 'channel', 'aria-label': 'Come', style: { width: 'auto', minHeight: '32px', height: '32px', fontSize: '13px' } }),
        p.contacts.length ? select(contactOpts, st.contact_id || '', { 'data-f': 'contact_id', 'aria-label': 'Con chi', style: { width: 'auto', maxWidth: '220px', minHeight: '32px', height: '32px', fontSize: '13px' } }) : null,
        draftBox.hidden ? link([ic('plus', 13), 'Bozza'], { on: { click: e => { draftBox.hidden = false; e.currentTarget.remove(); draft.focus(); } } }) : null),
      draftBox));
    rows.append(r);
    renumber();
  };
  const read = () => [...rows.children].map(r => Object.fromEntries([...r.querySelectorAll('[data-f]')].map(el => [el.dataset.f, el.value]))).filter(s => s.title.trim());
  if (proposed) p.steps.forEach(addRow);
  const live = p.live || [];
  const doneN = live.filter(x => x.done_at).length;
  const status = proposed ? pill('Da accettare', 'am') : p.status === 'accettato' ? pill('In corso', 'gr') : pill(OUTCOMES[p.outcome] || 'Chiuso');
  const m = cvModal({
    drawer: true,
    title: h('div.cv-head-row', h('span.cv-ib.or.lg', ic('list', 20)),
      h('div.cv-grow', h('div.cv-row.cv-wrap.cv-small.cv-muted', { style: { gap: '6px' } }, status,
        h('span', proposed ? dots([p.signal_title ? 'dal radar' : 'da un playbook', p.playbook_id && `playbook «${p.playbook_id}»`]) : p.accepted_at ? `accettato il ${day(p.accepted_at)}` : '')),
        h('h2', { style: { marginTop: '6px' } }, p.title),
        h('div.cv-small.cv-muted', dots([p.subject_name, p.owner_name && `responsabile ${p.owner_name}`, proposed ? 'da accettare entro 48 ore' : null])),
        p.signal_url ? h('a.cv-lnk', { href: p.signal_url, target: '_blank', rel: 'noopener', style: { marginTop: '4px' } }, ic('external', 13), 'Fonte del segnale') : null)),
    body: h('div', { style: { display: 'grid', gap: '20px' } },
      proposed ? timeline : null,
      refs.length ? h('div', h('div.cv-lbl', { style: { marginBottom: '6px' } }, 'Referenze da citare'), h('div.cv-chips', refs.map(r => pill([ic('folder', 12), r], 'line', { style: { height: '28px' } })))) : null,
      proposed ? h('div', rows, p.check_question ? h('div', { style: { display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: '12px', padding: '14px 0', borderTop: '1px solid var(--cv-line-2)' } },
        h('span', { style: { width: '26px', height: '26px', borderRadius: '50%', background: 'var(--cv-dark)', color: 'var(--cv-on-dark)', fontWeight: 700, display: 'grid', placeItems: 'center' } }, '?'),
        h('span.cv-t5', `Verifica: ${p.check_question}`)) : null,
      link([ic('plus', 14), 'Aggiungi passo'], { on: { click: () => addRow() }, style: { marginTop: '6px' } }))
        : h('div', { style: { display: 'grid', gap: '12px' } },
          live.length ? h('div.cv-row', h('span.cv-bar.gr.cv-grow', h('i', { style: { width: `${Math.round((100 * doneN) / live.length)}%` } })), h('span.cv-small.cv-t5', `${doneN} di ${live.length} passi`)) : null,
          live.map(st => {
            const lateSt = !st.done_at && String(st.due_date).slice(0, 10) < today();
            return h('div.cv-row', { style: { alignItems: 'flex-start' } }, h('span.cv-ck', { class: st.done_at ? 'done' : lateSt ? 'late' : '', style: { cursor: 'default' } }, ic('check', 13)),
              h('div.cv-grow', h('div.cv-t5', { style: st.done_at ? { color: 'var(--cv-faint)', textDecoration: 'line-through' } : {} }, st.title),
                h('div.cv-small', { style: { color: lateSt ? 'var(--cv-rd)' : 'var(--cv-muted)' } }, st.done_at ? dots([`fatto il ${day(st.done_at)}`, st.outcome && `«${st.outcome}»`]) : dots([`entro ${day(st.due_date)}`, lateSt && 'scaduto', st.owner_name]))));
          }),
          p.check_question ? h('div.cv-soft.cv-small', h('b', 'Verifica: '), p.check_question) : null,
          p.status === 'chiuso' ? h('div.cv-soft.cv-small', h('b', 'Esito: '), `${OUTCOMES[p.outcome]}${p.outcome_note ? ` · ${p.outcome_note}` : ''}`) : null)),
    left: proposed ? [h('button.btn.btn-ghost', { type: 'button', on: { click: async () => {
      if (!await confirmDialog('Cancellare questa proposta di piano?', { ok: 'Cancella', danger: true })) return;
      await del(`/api/crm/plans/${p.id}`);
      m.close();
      onDone?.();
    } } }, 'Non serve')] : [],
    actions: proposed ? [h('span.cv-small.cv-muted.cv-hide-m', 'I passi diventano prossimi passi dell\'azienda'), h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const steps = read();
      if (!steps.length) return toast('Il piano non ha passi', 'err');
      if (steps.some(s => !s.due_date)) return toast('Ogni passo ha bisogno di una data', 'err');
      await post(`/api/crm/plans/${p.id}/accept`, { steps: steps.map(s => ({ ...s, owner_id: s.owner_id ? Number(s.owner_id) : null, contact_id: s.contact_id ? Number(s.contact_id) : null })) });
      m.close();
      toast('Piano accettato: i passi sono nei prossimi passi');
      onDone?.();
    } } }, ic('check', 15), 'Accetta piano')]
      : p.status === 'accettato' ? [h('button.btn', { type: 'button', on: { click: () => { m.close(); closePlanDialog(p, onDone); } } }, 'Chiudi il piano')]
        : [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi')],
  });
}
// «Chiudi il piano»: tre esiti grandi, nota, interruttore per chiudere anche i passi aperti
function closePlanDialog(p, onDone) {
  let outcome = 'opportunita';
  const picks = h('div.cv-picks.three', { role: 'radiogroup', 'aria-label': 'Com\'è andata?' });
  const draw = () => fill(picks, [['opportunita', 'target', 'gr'], ['rimandato', 'clock', ''], ['perso', 'x', 'rd']].map(([k, i, tone]) => h('button.cv-pick', {
    type: 'button', role: 'radio', class: outcome === k ? 'on' : '', 'aria-checked': String(outcome === k), on: { click: () => { outcome = k; draw(); } },
  }, h('span.cv-ib', { class: tone }, ic(i, 16)), h('span.cv-t5', OUTCOMES[k]))));
  draw();
  const note = input({ placeholder: '«Gara attesa a febbraio, opportunità aperta in BOSS»', maxlength: 2000, 'aria-label': 'Nota' });
  const steps = toggle(true, 'Chiudi anche i passi ancora aperti');
  const m = cvModal({
    size: 'md',
    title: h('div', h('h2', 'Chiudi il piano'), h('div.cv-subh', 'Com\'è andata?')),
    body: h('div.en-form', picks, fld('Nota', note), steps.el),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        await post(`/api/crm/plans/${p.id}/close`, { outcome, note: note.value, close_steps: steps.input.checked });
        m.close();
        toast('Piano chiuso');
        onDone?.();
      } } }, 'Chiudi il piano')],
  });
}

// tab «Piano d'azione» della scheda (artboard «Scheda-tab»): piani come schede con avanzamento e prossimo passo;
// a destra i segnali dell'azienda con lo stato in pillola
export async function plansTab(box, s, refresh) {
  fill(box, loading());
  const { plans, signals, playbooks } = await get(`/api/crm/subjects/${s.id}/plans`);
  const pb = select([['', 'Nuovo piano da un playbook…'], ...playbooks.map(p => [p.id, p.name.split(' (')[0]])], '', { 'aria-label': 'Nuovo piano da un playbook', style: { width: 'auto', maxWidth: '320px' }, on: { change: async e => {
    if (!e.target.value) return;
    const plan = await post(`/api/crm/subjects/${s.id}/plans`, { playbook_id: e.target.value });
    openPlan(plan.id, refresh);
  } } });
  const status = p => (p.status === 'proposto' ? pill('Da accettare', 'am') : p.status === 'accettato' ? pill('In corso', 'gr') : pill(OUTCOMES[p.outcome] || 'Chiuso'));
  const sigState = { nuovo: ['Da decidere', 'am'], interessa: ['Interessa', 'gr'], scartato: ['Scartato', ''], boss: ['Su BOSS', 'bl'], gara_scartata: ['Gara scartata', ''] };
  fill(box, h('div.cv-cols.w420',
    h('div.cv-stack',
      h('div.cv-row.cv-wrap', h('div.cv-lbl.cv-grow', 'Piani'), pb),
      plans.length ? plans.map(p => {
        const done = p.live.filter(x => x.done_at).length;
        const next = p.live.find(x => !x.done_at);
        const pct = p.live.length ? Math.round((100 * done) / p.live.length) : 0;
        return h('section.cv-card.pad', { style: { gap: '10px' } },
          h('div.cv-row', h('span.cv-ib.or', ic('list', 16)), h('div.cv-grow', h('div.cv-t5', { style: { fontSize: '15px' } }, p.title), h('div.cv-small.cv-muted', dots([p.owner_name, day(p.created_at)]))), status(p)),
          p.status === 'accettato' && p.live.length ? h('div.cv-row', h('span.cv-bar.gr.cv-grow', h('i', { style: { width: `${pct}%` } })), h('span.cv-small.cv-t5', `${pct}%`)) : null,
          h('div.cv-small.cv-muted', p.status === 'proposto' ? `${p.steps.length} passi proposti${p.playbook_id ? ` dal playbook «${p.playbook_id}»` : ''}`
            : p.status === 'accettato' ? dots([`${done} di ${p.live.length} passi`, next && `prossimo: «${next.title}» entro ${day(next.due_date)}`]) : dots([OUTCOMES[p.outcome], p.outcome_note])),
          h('div', h('button.btn.btn-sm', { type: 'button', on: { click: () => openPlan(p.id, refresh) } }, p.status === 'proposto' ? 'Rivedi e accetta' : 'Apri il piano')));
      }) : h('section.cv-card', emptyState('list', 'Nessun piano. Nasce da «Interessa» su un segnale del radar, oppure da un playbook qui sopra.'))),
    h('div.cv-stack', card({ title: 'Segnali del radar', count: signals.length },
      signals.length ? signals.map(g => h('div.cv-sig.sm', scoreRing(g.score, { size: 'sm' }),
        h('button.cv-sig-main', { type: 'button', on: { click: () => openSignal(g.id, refresh, null, signals) } }, h('div.cv-sig-t.cv-clamp', g.title),
          h('div.cv-sig-m', pill(...(sigState[g.status] || [g.status])), h('i', '·'), day(g.created_at)))))
        : emptyState('radar', 'Nessun segnale su quest\'azienda.')))));
}

// ── ufficio gare: «Proposte dal radar» (artboard «Gare») ──────────────────────────────────────
export async function gareTab(box, data) {
  fill(box, loading());
  const { signals, discardReasons } = await get('/api/crm/radar/signals?view=gare');
  const again = () => gareTab(box, data);
  const soon = signals.filter(g => g.deadline && daysTo(g.deadline) <= 7);
  const wed = (() => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + ((3 - d.getUTCDay() + 7) % 7)); return d.toISOString().slice(0, 10); })();
  const uploader = infordatCard(again);
  const deadline = g => {
    if (!g.deadline) return h('span.cv-date', '—');
    const n = daysTo(g.deadline);
    return h('span.cv-date', { class: n <= 7 ? 'late' : '', title: day(g.deadline) }, n < 0 ? 'scaduta' : n === 0 ? 'oggi' : n <= 14 ? `fra ${n} g` : day(g.deadline));
  };
  fill(box,
    pageTop({ eyebrow: 'Alma CRM · ufficio gare', heading: title('Proposte dal', 'radar'),
      sub: `Le gare già bandite arrivano solo qui. Si decide alla riunione gare di mercoledì ${fmtDate(wed)}.`,
      actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => uploader.querySelector('input[type=file]').click() } }, ic('upload', 15), 'Carica export Infordat')] }),
    kpiRow([{ icon: 'inbox', n: signals.length, label: ['gare da', 'guardare'], tone: 'or' }, { icon: 'alarm-clock', n: soon.length, label: ['scadono', 'entro 7 giorni'], tone: 'hot' }]),
    h('div.cv-cols.w400',
      h('section.cv-card', signals.length ? h('div.cv-tblwrap', h('table.cv-tbl',
        h('thead', h('tr', h('th', h('span.cv-sr', 'Punteggio')), h('th', 'Gara'), h('th.num', 'Importo'), h('th', 'Scadenza'), h('th.cv-hide-m', 'SOA'), h('th', h('span.cv-sr', 'Azioni')))),
        h('tbody', signals.map(g => h('tr',
          h('td', scoreRing(g.score, { size: 'sm' })),
          h('td', h('button.cv-sig-main', { type: 'button', on: { click: () => openSignal(g.id, again, data, signals) } }, h('div.cv-t5.cv-clamp', g.title),
            h('div.cv-small.cv-muted.cv-row.cv-wrap', { style: { gap: '4px 6px' } }, dots([g.subject_name || g.entity, g.bu_label, g.cig && `CIG ${g.cig}`]), g.subject_roles?.includes('cliente') ? pill('cliente attuale', 'gr') : null))),
          h('td.num', eur(g.amount)),
          h('td', deadline(g)),
          h('td.cv-hide-m', h('div.cv-row.cv-wrap', { style: { gap: '4px' } }, g.soa.length ? g.soa.slice(0, 3).map(x => pill(x, 'line')) : h('span.cv-small.cv-muted', '—'))),
          h('td', h('div.cv-acts', h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => discardDialog(g, discardReasons, again) } }, 'Scarta'),
            h('button.btn.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/crm/radar/signals/${g.id}/gare`, { action: 'boss' }); toast('Da portare su BOSS'); again(); } } }, 'Porta su BOSS'))))))))
        : emptyState('inbox', 'Nessuna gara da guardare. Carica l\'ultimo export di Infordat qui accanto.')),
      uploader));
}
// caricamento dell'export di Infordat in 3 passi (file → anteprima → carica), con trascina e rilascia
function infordatCard(onDone) {
  const file = h('input', { type: 'file', accept: '.xlsx,.csv,.txt', 'aria-label': 'Export di Infordat' });
  const stepper = h('div.cv-stepper');
  const drawStep = n => fill(stepper, ['File', 'Anteprima', 'Carica'].map((l, i) => [i ? h('span.ln') : null, h('span.s', { class: i + 1 < n ? 'done' : i + 1 === n ? 'on' : '' }, h('b', i + 1 < n ? ic('check', 12) : String(i + 1)), l)]));
  drawStep(1);
  const drop = h('label.cv-drop', file, h('span.cv-ib.or', ic('upload', 18)), h('span.cv-t5', 'Trascina qui l\'export di Infordat'), h('span.cv-small.cv-muted', 'Excel o CSV, come esce da Infordat'));
  drop.addEventListener('dragover', () => drop.classList.add('over'));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('over')));
  const preview = h('div', { style: { display: 'grid', gap: '14px' } });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    drop.querySelector('.cv-t5').textContent = f.name;
    drop.querySelector('.cv-small').textContent = 'Trascina qui un altro file per sostituirlo';
    fill(preview, loading());
    const buf = await f.arrayBuffer();
    try {
      const pre = await api('POST', '/api/crm/radar/infordat/anteprima', buf, { raw: true, quiet: true, headers: { 'Content-Type': 'application/octet-stream' } });
      drawStep(2);
      const cols = Object.keys(pre.columns || {}).length;
      fill(preview,
        h('div.cv-row', h('div.cv-grow', h('div.cv-t5', `${pre.total} gare nel file`), h('div.cv-small.cv-muted', `${pre.fresh} nuove · ${pre.total - pre.fresh} già caricate`)), pill(`colonne riconosciute ${cols}`, cols ? 'gr' : 'am')),
        pre.sample.length ? h('div.cv-box', { style: { padding: 0, overflow: 'hidden' } }, pre.sample.slice(0, 6).map(r => listRow({ cls: 'tight', title: r.title, meta: dots([r.entity, r.amount ? eur(r.amount) : null, r.deadline && `scade ${day(r.deadline)}`]) }))) : null,
        h('div.cv-row', h('span.cv-grow.cv-small.cv-muted', 'BU e punteggio li assegna il radar'),
          h('button.btn.btn-primary', { type: 'button', disabled: !pre.fresh || undefined, on: { click: async () => {
            const out = await api('POST', '/api/crm/radar/infordat', buf, { raw: true, quiet: true, headers: { 'Content-Type': 'application/octet-stream' } });
            toast(`${out.added} gare caricate${out.skipped ? `, ${out.skipped} già presenti` : ''}`);
            onDone();
          } } }, `Carica ${pre.fresh} gare`)));
    } catch (err) { drawStep(1); fill(preview, h('p.cv-small', { style: { color: 'var(--cv-rd)' } }, err.message)); }
  });
  return h('section.cv-card.pad', { style: { gap: '14px' } }, h('div.cv-t5', { style: { fontSize: '15px' } }, 'Carica l\'export di Infordat'), stepper, drop, preview);
}

// «Sotto soglia» (artboard «Sotto-soglia»): perché sono qui, la voce più debole del punteggio, raggruppati per BU
export async function belowTab(box, data) {
  fill(box, loading());
  const again = () => belowTab(box, data);
  const r = await get('/api/crm/radar/signals?view=sotto');
  const weights = await get('/api/crm/commerciale').then(v => v.settings.scoring.weights).catch(() => ({}));
  const weakest = g => {
    const parts = g.score_parts || {};
    const [k] = PARTS.map(([key]) => [key, weights[key] ? (parts[key] || 0) / weights[key] : 1]).sort((a, b) => a[1] - b[1])[0] || [];
    return k ? pill(`${PARTS.find(([x]) => x === k)[1]} ${parts[k] ?? 0}/${weights[k]}`, 'am') : null;
  };
  const bus = [...new Set(r.signals.map(g => g.bu_label || 'Senza BU'))];
  fill(box,
    pageTop({ eyebrow: 'Alma CRM · radar', heading: title('Segnali', 'sotto soglia'),
      sub: `Punteggio sotto ${r.min}: non arrivano in «La mia settimana». Se qui ce n'è uno buono, decidilo lo stesso e correggi il profilo della BU.`,
      actions: [data.admin ? h('a.btn', { href: '#/crm/impostazioni/profiles' }, ic('sliders', 15), 'Correggi il profilo della BU') : null] }),
    h('section.cv-card', r.signals.length ? bus.map(b => {
      const list = r.signals.filter(g => (g.bu_label || 'Senza BU') === b);
      return [sect(`${b} · ${list.length}`), list.map(g => signalRow(g, { highlight: r.highlight, reasons: r.discardReasons, onChange: again, data, list: r.signals, weak: weakest(g) }))];
    }) : emptyState('radar', r.bus.length ? 'Nessun segnale sotto soglia: il radar non ha scartato niente.' : 'Non sei responsabile di nessuna BU.')));
}

// «Radar» (canvas v17, approvato da Dante il 22/11/2026): tutto quello che deve ancora uscire, da tutte le fonti.
// In alto la strada verso la gara (Programmata → Finanziata → Progetto approvato → Gara in arrivo) e la mappa d'Italia;
// sotto BU, regioni e gli altri filtri, le fonti come pillole, la lavagna a quattro colonne con l'etichetta della fonte
// su ogni scheda e a destra «Questa settimana». Da qui anche «Opere finanziate» (OpenCUP, per BU) e «Le fonti del Radar».
const COLS = [['programmata', 'Programmata', 'calendar', '#8A8A8A'], ['finanziata', 'Finanziata', 'coins', '#FF8A26'], ['approvato', 'Progetto approvato', 'check', '#1B7A45'], ['arrivo', 'Gara in arrivo', 'flag', '#E5484D']];
const WARM = [['', 'Chi conosciamo: tutti'], ['forte', 'Ci conoscono: forte'], ['media', 'Ci conoscono: forte o media'], ['qualcuno', 'Ci conosce qualcuno'], ['nessuno', 'Non ci conosce nessuno']];
const SHOW = [['', 'Mostra: in corsa'], ['altri', 'Anche vinte da altri'], ['scartate', 'Anche scartate'], ['tutte', 'Tutte']];
const AMOUNTS = [['', 'Importo: tutti'], ['100000', 'Importo: da 100 mila €'], ['1000000', 'Importo: da 1 M€'], ['5000000', 'Importo: da 5 M€']];
const WARM_RANK = { forte: 3, media: 2, debole: 1, '': 0 };
const FILTER_KEYS = ['q', 'bu', 'kind', 'regions', 'min', 'warm', 'altri', 'scartate', 'col', 'src'];
const emptyFilters = () => ({ q: '', bu: '', kind: '', regions: [], min: '', warm: '', altri: false, scartate: false, col: '', src: '' });
// i filtri salvati prima del 22/11 avevano una regione sola («region») e la provincia d'Abruzzo («prov»)
const upgradeFilters = x => { const f = { ...emptyFilters(), ...x }; if (!Array.isArray(f.regions)) f.regions = []; if (x?.region && !f.regions.length) f.regions = [x.region]; delete f.region; delete f.prov; return f; };
const PER_COL = 12;
// fonti del Radar: chiave del segnale (source) → [nome, cosa porta, classe dell'etichetta]
const SRC = { stampa: ['Radar AI', 'stampa e siti degli enti', 'ai'], opencup: ['OpenCUP', 'opere finanziate', 'cup'], infordat: ['Infordat', 'bandi già usciti', 'inf'],
  manuale: ['A mano', 'segnalate da noi', 'man'], anac: ['Vinte da altri', 'ANAC', 'anac'] };
const srcOf = g => (['manual', 'mano', 'manuale', ''].includes(g.source || '') ? 'manuale' : SRC[g.source] ? g.source : 'manuale');
// fonti nuove, in arrivo una alla volta (canvas v17 · Le fonti del Radar)
const SOON = [['ted', 'TED · preinformazione'], ['triennali', 'Programmi triennali'], ['via', 'Valutazioni ambientali'], ['gestori', 'Piani dei gestori'], ['bollettini', 'Bollettini regionali']];
const SRC_INFO = [
  ['stampa', 'Radar AI', 'Stampa nazionale e locale, siti degli enti: programmi, delibere, determine (anche il secondo giro «Prima del bando»)', 'tutte', 'ogni notte'],
  ['opencup', 'OpenCUP', 'Opere pubbliche finanziate con il CUP, nei tipi di lavoro e nelle zone di ogni BU', 'finanziata', 'ogni mese'],
  ['infordat', 'Infordat', 'Bandi già usciti: vanno all\'ufficio gare', 'gara', 'a ogni export'],
  ['manuale', 'A mano', 'Segnalate da noi con «Segnala» o da altre pagine', 'tutte', '—'],
  ['ted', 'TED · preinformazione', 'Gare grandi annunciate dagli enti nei mesi prima del bando', 'gara in arrivo', 'ogni notte'],
  ['triennali', 'Programmi triennali', 'Le opere che ogni ente farà nei prossimi 3 anni, con importo e anno', 'programmata', 'ogni mese'],
  ['via', 'Valutazioni ambientali', 'Grandi impianti e reti in valutazione al Ministero dell\'Ambiente', 'programmata → approvato', 'ogni settimana'],
  ['gestori', 'Piani dei gestori', 'Piani di sviluppo di Terna, gestori idrici, RFI e ANAS', 'programmata', 'ogni anno'],
  ['bollettini', 'Bollettini regionali', 'Finanziamenti e graduatorie per i comuni', 'finanziata', 'ogni settimana'],
];
// mappa d'Italia a tessere (colonna, riga, sigla)
const TILES = { 'Valle d\'Aosta': [0, 0, 'VdA'], Piemonte: [1, 0, 'Pie'], Lombardia: [2, 0, 'Lom'], 'Trentino-Alto Adige': [3, 0, 'TAA'], Veneto: [4, 0, 'Ven'], 'Friuli-Venezia Giulia': [5, 0, 'FVG'],
  Liguria: [1, 1, 'Lig'], 'Emilia-Romagna': [3, 1, 'EmR'], Toscana: [2, 2, 'Tos'], Umbria: [3, 2, 'Umb'], Marche: [4, 2, 'Mar'], Lazio: [3, 3, 'Laz'], Abruzzo: [4, 3, 'Abr'],
  Molise: [5, 3, 'Mol'], Campania: [4, 4, 'Cam'], Puglia: [5, 4, 'Pug'], Basilicata: [5, 5, 'Bas'], Calabria: [5, 6, 'Cal'], Sicilia: [4, 7, 'Sic'], Sardegna: [1, 5, 'Sar'] };
const TINTS = ['#5A6B7A', '#7A5A6B', '#6B7A5A', '#C25E0E', '#4B6B8A', '#5A7A6B', '#7A6B5A', '#6B5A7A'];
const tintOf = s => TINTS[[...String(s || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length];
const entInitials = s => String(s || '?').split(/\s+/).filter(x => x.length > 2 && !/^(del|della|dei|delle|degli|di|spa|srl)$/i.test(x)).map(x => x[0]).join('').slice(0, 2).toUpperCase() || '?';
const PROGRESS = { '': 15, programmata: 20, finanziata: 50, progetto: 75, determina: 90 };
const isNew = g => Date.now() - new Date(g.created_at).getTime() < 24 * 36e5;
const scoreDial = v => {
  const n = Math.max(0, Math.min(100, Number(v) || 0));
  return h('span.rk-dial', { class: n >= 70 ? 'hi' : n >= 50 ? 'mid' : '', style: { '--p': String(n) }, title: 'Punteggio di Alma: quanto conviene (0–100)', role: 'img', 'aria-label': `Punteggio ${n} su 100` }, h('span', String(n)));
};
const MON = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
const whenOf = g => g.deadline || g.expected_on || null;
let radarState = null;

// «Le fonti del Radar»: cosa porta ogni fonte, in che fase, ogni quanto, quante opportunità e quanti progetti
function sourcesDialog(signals) {
  const by = k => signals.filter(g => srcOf(g) === k);
  const body = h('div.rk-src-tab', h('table',
    h('thead', h('tr', h('th', 'Fonte'), h('th', 'Fase'), h('th', 'Ogni'), h('th', 'Portate'), h('th', 'Progetti'))),
    h('tbody', SRC_INFO.map(([k, name, what, phase, every]) => {
      const live = SRC[k] || k === 'manuale';
      const list = live ? by(k) : [];
      return h('tr', { class: live ? '' : 'soon' },
        h('td', h('span.rk-src', { class: SRC[k]?.[2] || 'soon' }, name), h('small', what)),
        h('td', phase), h('td', every),
        live ? [h('td', h('b', String(list.length))), h('td', String(list.filter(g => g.project_id).length))] : h('td', { colSpan: 2 }, pill('in arrivo')));
    }))),
    h('p.cv-hint', 'Le fonti grigie arrivano una alla volta, ognuna dopo aver verificato che i dati ci sono e sono completi. I bandi già usciti restano all\'ufficio gare in «Gare».'));
  cvModal({ title: 'Le fonti del Radar', body, drawer: true });
}

export async function radarTab(box, data, sub = '') {
  fill(box, loading());
  const st = radarState || (radarState = { view: 'kanban', f: null, more: {}, opere: null });
  const again = (s = sub) => radarTab(box, data, s);
  const asaName = k => data.asa.find(a => a.key === k)?.label || k || 'Senza BU';
  // sotto-vista «Opere finanziate» (OpenCUP per BU, canvas v16 spostata qui con la v17)
  const subTabs = h('div.rk-sub', { role: 'tablist' },
    [['', 'Lavagna', 'radar'], ['opere', 'Opere finanziate · OpenCUP', 'calendar']].map(([k, l, i]) => h('a.rk-subt', { href: `#/crm/radar${k ? `/${k}` : ''}`, role: 'tab', 'aria-selected': String(k === sub), class: k === sub ? 'on' : '' }, ic(i, 13), l)));
  if (sub === 'opere') {
    const { opereSection } = await import('./crm-gare-opere.js');
    return opereSection(box, { st, buLabel: asaName, tabs: subTabs, again: () => again('opere') });
  }
  const load = () => get(`/api/crm/radar/board?${st.f?.altri ? 'altri=1&' : ''}${st.f?.scartate ? 'scartate=1' : ''}`);
  let r = await load();
  if (!st.f) { const def = (r.filtri || []).find(x => x.predefinito); st.f = upgradeFilters(def ? def.filtri : {}); if (st.f.altri || st.f.scartate) r = await load(); }
  const f = st.f;
  const passes = (g, skip = '') => {
    const q = f.q.trim().toLowerCase();
    if (q && !`${g.title} ${g.entity || ''} ${g.subject_name || ''} ${g.place || ''}`.toLowerCase().includes(q)) return false;
    if (f.bu && g.bu !== f.bu) return false;
    if (f.kind && g.kind !== f.kind) return false;
    if (skip !== 'region' && f.regions.length && !f.regions.includes(g.region || '')) return false;
    if (skip !== 'col' && f.col && g.column !== f.col) return false;
    if (skip !== 'src' && f.src && srcOf(g) !== f.src) return false;
    if (f.min && !(g.amount >= Number(f.min))) return false;
    if (f.warm === 'forte' && g.warm !== 'forte') return false;
    if (f.warm === 'media' && WARM_RANK[g.warm] < 2) return false;
    if (f.warm === 'qualcuno' && !g.warm) return false;
    if (f.warm === 'nessuno' && g.warm) return false;
    return true;
  };
  const opts = (list, all) => [['', all], ...list];
  const bus = [...new Set(r.signals.map(g => g.bu).filter(Boolean))].sort((a, b) => asaName(a).localeCompare(asaName(b), 'it')).map(b => [b, `BU: ${asaName(b)}`]);
  const kinds = [...new Set(r.signals.map(g => g.kind).filter(Boolean))].map(k => [k, `Tipo: ${KIND_SHORT[k] || k}`]);
  const sel = (key, list, label, cls = '') => {
    const s = select(list, f[key], { 'aria-label': label, class: [f[key] ? 'on' : '', cls].join(' ') });
    s.addEventListener('change', () => { f[key] = s.value; s.classList.toggle('on', Boolean(s.value)); st.more = {}; draw(); });
    return s;
  };
  const search = h('input.input', { type: 'search', placeholder: 'Cerca ente, opera, luogo…', value: f.q, 'aria-label': 'Cerca' });
  search.addEventListener('input', () => { f.q = search.value; draw(); });
  const showSel = () => {
    const cur = f.altri && f.scartate ? 'tutte' : f.altri ? 'altri' : f.scartate ? 'scartate' : '';
    const s = select(SHOW, cur, { 'aria-label': 'Quali mostrare', class: cur ? 'on' : '' });
    s.addEventListener('change', () => { f.altri = ['altri', 'tutte'].includes(s.value); f.scartate = ['scartate', 'tutte'].includes(s.value); again(); });
    return s;
  };
  const timeline = h('div.rk-tl');
  const favs = h('div.rk-favs');
  const map = h('div.rk-it');
  const regionBox = h('span');
  const sources = h('div.rk-srcs');
  const body = h('div');
  const side = h('aside.rk-side');
  const viewChips = choiceChips([['kanban', 'Lavagna'], ['elenco', 'Elenco']], st.view, { label: 'Vista', onChange: k => { st.view = k; draw(); } });

  const saveFavs = async list => { const out = await api('PUT', '/api/crm/radar/filtri', { filtri: list }); r.filtri = out.filtri; drawFavs(); };
  const same = a => FILTER_KEYS.every(k => JSON.stringify(a[k] ?? '') === JSON.stringify(f[k] ?? ''));
  const drawFavs = () => fill(favs,
    h('span.rk-favs-l', 'I miei filtri'),
    (r.filtri || []).map((x, i) => h('span.rk-fav', { class: same(upgradeFilters(x.filtri)) ? 'on' : '' },
      h('button', { type: 'button', title: 'Applica', on: { click: () => { st.f = upgradeFilters(x.filtri); st.more = {}; again(); } } }, x.predefinito ? ic('star', 12) : null, x.nome),
      h('button.rk-fav-star', { type: 'button', class: x.predefinito ? 'on' : '', title: x.predefinito ? 'Il radar si apre già così: tocca per toglierlo' : 'Apri il radar con questo filtro', 'aria-label': 'Predefinito',
        on: { click: () => saveFavs(r.filtri.map((y, j) => ({ ...y, predefinito: j === i ? !y.predefinito : false }))) } }, ic('pin', 12)),
      h('button.rk-fav-x', { type: 'button', title: 'Togli', 'aria-label': `Togli ${x.nome}`, on: { click: () => saveFavs(r.filtri.filter((_, j) => j !== i)) } }, ic('x', 12)))),
    h('button.rk-fav-add', { type: 'button', on: { click: async () => {
      const nome = await promptDialog('Salva questi filtri', { label: 'Nome del filtro', ok: 'Salva' });
      if (nome && nome.trim()) { await saveFavs([...(r.filtri || []), { nome: nome.trim(), filtri: { ...f }, predefinito: false }]); toast('Filtro salvato'); }
    } } }, '+ Salva questi filtri'),
    FILTER_KEYS.some(k => (Array.isArray(f[k]) ? f[k].length : f[k]) && k !== 'altri') ? h('button.rk-fav-add', { type: 'button', on: { click: () => { st.f = emptyFilters(); st.more = {}; again(); } } }, 'Togli i filtri') : null);

  // la strada verso la gara: quante opportunità e quanto valgono per fase (clic = solo quella fase)
  const drawTimeline = () => {
    const base = r.signals.filter(g => passes(g, 'col'));
    fill(timeline, COLS.map(([k, label, , color]) => {
      const list = base.filter(g => g.column === k);
      const sum = list.reduce((s, g) => s + (g.amount || 0), 0);
      return h('button.rk-st', { type: 'button', class: f.col === k ? 'sel' : '', 'aria-pressed': String(f.col === k), title: f.col === k ? 'Togli il filtro' : `Solo «${label}»`,
        on: { click: () => { f.col = f.col === k ? '' : k; st.more = {}; draw(); } } },
        h('span.rk-st-dot', { style: { background: color } }), h('b', String(list.length)), h('span.rk-st-l', label), h('small', sum ? eur(sum) : '—'));
    }));
  };
  // mappa d'Italia a tessere: più arancio = più opportunità; clic = regione sì/no
  const drawMap = () => {
    const base = r.signals.filter(g => passes(g, 'region'));
    const counts = {};
    for (const g of base) if (g.region) counts[g.region] = (counts[g.region] || 0) + 1;
    const max = Math.max(1, ...Object.values(counts));
    const other = base.filter(g => !g.region || !TILES[g.region]).length;
    fill(map, h('span.rk-k', 'Dove sono · Italia'),
      h('div.rk-it-grid', Object.entries(TILES).map(([name, [c, row, s]]) => {
        const n = counts[name] || 0;
        const lvl = !n ? '' : n / max > 0.66 ? 'h3' : n / max > 0.33 ? 'h2' : 'h1';
        return h('button.rk-tile', { type: 'button', class: [lvl, f.regions.includes(name) ? 'sel' : ''].join(' '), style: { gridColumn: String(c + 1), gridRow: String(row + 1) },
          title: `${name}: ${n} ${n === 1 ? 'opportunità' : 'opportunità'}${f.regions.includes(name) ? ' · tocca per toglierla' : ''}`,
          on: { click: () => { f.regions = f.regions.includes(name) ? f.regions.filter(x => x !== name) : [...f.regions, name]; st.more = {}; draw(); } } }, s);
      })),
      h('small.rk-it-note', other ? `${other} senza regione o fuori Italia` : 'Più arancio = più opportunità'));
    const regCounts = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([region, n]) => ({ region, n }));
    fill(regionBox, regionPicker({ counts: regCounts, selected: f.regions, unit: 'opportunità', none: 'Regioni: tutte', onChange: v => { f.regions = v || []; st.more = {}; draw(); } }));
  };
  // le fonti come pillole: quante opportunità porta ognuna; le nuove in grigio «in arrivo»
  const drawSources = () => {
    const base = r.signals.filter(g => passes(g, 'src'));
    const keys = Object.keys(SRC).filter(k => k !== 'anac' || f.altri);
    fill(sources,
      h('button.rk-sc', { type: 'button', class: !f.src ? 'on' : '', on: { click: () => { f.src = ''; draw(); } } }, 'Tutte le fonti', h('em', String(base.length))),
      keys.map(k => { const n = base.filter(g => srcOf(g) === k).length; return h('button.rk-sc', { type: 'button', class: [f.src === k ? 'on' : '', n ? 'rk-live' : 'rk-zero'].join(' '), on: { click: () => { f.src = f.src === k ? '' : k; draw(); } } }, h('i'), SRC[k][0], h('em', String(n))); }),
      SOON.map(([, l]) => h('span.rk-sc.soon', { title: 'Fonte nuova: arriva con le prossime fasi' }, h('i'), l, h('em', 'in arrivo'))),
      h('button.rk-sc.info', { type: 'button', on: { click: () => sourcesDialog(r.signals) } }, ic('info', 13), 'Le fonti del Radar'));
  };

  const warmEl = g => g.warm
    ? h('span.rk-warm', { class: g.warm, title: g.warm_why ? `Strada calda: ${g.warm_why} · rapporto ${g.warm}` : `Rapporto ${g.warm} con l’ente` },
      h('span.rk-avs', (g.warm_us.length ? g.warm_us : ['?']).slice(0, 3).map(n => h('span.rk-av', initials(n)))))
    : h('span.rk-warm.none', 'nessuno ci conosce');
  const due = g => {
    if (g.deadline) { const d = daysTo(g.deadline); return h('span.rk-due', { class: d < 0 ? 'past' : d <= 40 ? 'soon' : '' }, ic('clock', 11), d < 0 ? `scaduta ${day(g.deadline)}` : d <= 40 ? `gara entro ${d} giorni` : `scade ${day(g.deadline)}`); }
    if (g.expected_on) { const d = daysTo(g.expected_on); return h('span.rk-due', { class: d >= 0 && d <= 60 ? 'soon' : '' }, ic('clock', 11), `bando atteso ${day(g.expected_on)}`); }
    return g.stage === 'determina' ? h('span.rk-due', ic('clock', 11), 'determina a contrarre') : null;
  };
  const srcTag = g => { const k = srcOf(g); return h('span.rk-src', { class: SRC[k]?.[2] || 'man' }, SRC[k]?.[0] || 'A mano'); };
  const cardEl = (g, list) => {
    const off = g.status === 'scartato' || g.status === 'gara_scartata';
    const ent = g.subject_name || g.entity || '—';
    return h('article.rk-card', { tabIndex: 0, draggable: 'true', 'data-id': String(g.id), class: [off ? 'off' : '', isNew(g) && !off ? 'hot' : ''].join(' '),
      on: { dragstart: e => { e.dataTransfer.setData('text/plain', String(g.id)); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('drag'); }, dragend: e => e.currentTarget.classList.remove('drag'),
        click: e => { if (!e.target.closest('button, a')) openSignal(g.id, again, data, list); }, keydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) openSignal(g.id, again, data, list); } } },
      h('div.rk-card-src', srcTag(g), isNew(g) && !off ? h('span.rk-hot', { title: 'Arrivata nelle ultime 24 ore' }, 'nuova') : null),
      h('div.rk-card-top', h('span.rk-ent-ic', { style: { background: tintOf(ent) }, 'aria-hidden': 'true' }, entInitials(ent)),
        h('div.rk-card-tt', h('h4', g.title), h('div.rk-ent', ent)), scoreDial(g.score)),
      h('div.rk-meta', { 'data-sid': g.subject_id || '' }, h('b.rk-val', g.amount ? eur(g.amount) : '—'), h('span.rk-bu', g.bu_label || asaName(g.bu)), g.region ? h('span.rk-bu', g.region) : null, h('span.cv-grow'), due(g)),
      h('div.rk-prog', { title: 'Avanzamento verso la gara' }, h('span', { style: { width: `${g.to_gare ? 95 : PROGRESS[g.stage] ?? 15}%` } })),
      h('div.rk-card-ft', warmEl(g), h('span.cv-grow'),
        g.project_id ? h('a.rk-run', { href: `#/crm/progetto/${g.project_id}`, title: 'Apri il progetto' }, `● in corso${g.project_owner ? ` · ${g.project_owner.split(' ')[0]}` : ''}`)
          : g.status === 'boss' ? h('span.rk-run', `● su BOSS${g.decided_by_name ? ` · ${g.decided_by_name.split(' ')[0]}` : ''}`)
          : off ? h('span.rk-run.off', 'scartata')
          : h('a.rk-go', { href: `#/crm/lancio/s/${g.id}` }, 'Porta avanti')));
  };
  // «Questa settimana»: gare attese nei prossimi 60 giorni, nuove di stanotte, grandi dove nessuno ci conosce
  const drawSide = shown => {
    const soon = shown.filter(g => { const w = whenOf(g); if (!w) return false; const d = daysTo(w); return d >= 0 && d <= 60; }).sort((a, b) => String(whenOf(a)).localeCompare(String(whenOf(b)))).slice(0, 5);
    const fresh = shown.filter(isNew);
    const bySrc = Object.entries(fresh.reduce((m, g) => { const k = SRC[srcOf(g)]?.[0] || 'A mano'; m[k] = (m[k] || 0) + 1; return m; }, {}));
    const cold = shown.filter(g => !g.warm && g.amount >= 1e6 && !g.project_id).sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 3);
    const row = (g, left) => h('button.rk-li', { type: 'button', on: { click: () => openSignal(g.id, again, data, shown) } }, left, h('span.rk-li-t', h('b', g.title), h('small', dots([g.subject_name || g.entity, g.amount ? eur(g.amount) : '']))), srcTag(g));
    fill(side,
      h('section.rk-box', h('h4', 'Gare attese nei prossimi 60 giorni'),
        soon.length ? soon.map(g => { const w = new Date(`${String(whenOf(g)).slice(0, 10)}T12:00:00`); return row(g, h('span.rk-date', h('small', MON[w.getMonth()]), h('b', String(w.getDate())))); })
          : h('p.rk-box-none', 'Nessuna gara attesa nei prossimi 60 giorni con questi filtri.')),
      h('section.rk-box', h('h4', `Arrivate stanotte · ${fresh.length}`),
        h('p.rk-box-none', fresh.length ? bySrc.map(([k, n]) => `${n} da ${k}`).join(', ') : 'Niente di nuovo nelle ultime 24 ore.')),
      h('section.rk-box', h('h4', 'Grandi, ma nessuno ci conosce'),
        cold.length ? cold.map(g => row(g, h('span.rk-date.cold', '?'))) : h('p.rk-box-none', 'Sulle opportunità sopra 1 M€ abbiamo già una strada.')));
  };

  function draw() {
    const shown = r.signals.filter(g => passes(g));
    drawFavs(); drawTimeline(); drawMap(); drawSources(); drawSide(shown);
    if (!shown.length) { fill(body, h('section.cv-card', emptyState('radar', r.signals.length ? 'Nessuna opportunità con questi filtri.' : 'Il radar non ha ancora trovato opportunità.'))); return; }
    if (st.view === 'elenco') { fill(body, h('section.cv-card', shown.map(g => signalRow(g, { highlight: r.highlight, reasons: r.discardReasons, onChange: again, data, list: shown })))); return; }
    const cols = f.col ? COLS.filter(([k]) => k === f.col) : COLS;
    fill(body, h('div.rk-board', { style: { gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` } }, cols.map(([k, label, i, color]) => {
      const list = shown.filter(g => g.column === k);
      const sum = list.reduce((s, g) => s + (g.amount || 0), 0);
      const limit = st.more[k] ? list.length : PER_COL;
      const drop = async e => {
        e.preventDefault(); e.currentTarget.classList.remove('over');
        const g = r.signals.find(x => String(x.id) === e.dataTransfer.getData('text/plain'));
        if (!g || g.column === k) return;
        const out = await api('POST', `/api/crm/radar/signals/${g.id}/fase`, { column: k });
        Object.assign(g, { stage: out.stage, column: out.column }); draw(); toast(`Spostata in «${label}»`);
      };
      return h('section.rk-col', { class: k, on: { dragover: e => { e.preventDefault(); e.currentTarget.classList.add('over'); }, dragleave: e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('over'); }, drop } },
        h('header.rk-col-h', h('span.rk-col-dot', { style: { background: color } }), h('b.cv-grow', label), h('span.rk-col-n', `${list.length} · `, h('b', sum ? eur(sum) : '—'))),
        list.length ? list.slice(0, limit).map(g => cardEl(g, shown)) : h('p.rk-col-empty', 'Niente in questa fase.'),
        list.length > limit ? h('button.rk-more', { type: 'button', on: { click: () => { st.more[k] = true; draw(); } } }, `Mostra le altre ${list.length - limit}`) : null);
    })));
    // punti di contatto: bollino verde sulle carte delle aziende che conosciamo
    touchBadges([...body.querySelectorAll('.rk-meta[data-sid]')].filter(el => el.dataset.sid).map(el => [Number(el.dataset.sid), el]));
  }
  const newest = r.signals.reduce((m, g) => (g.created_at > m ? g.created_at : m), '');
  const upd = newest ? new Date(newest).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  fill(box,
    subTabs,
    h('section.rk-hero.v17',
      h('div.rk-hero-l',
        h('div.rk-hero-top',
          h('div.cv-grow', h('div.rk-eyebrow', ic('radar', 12), `Radar${upd ? ` · ultima novità ${upd}` : ''} · ${Object.keys(SRC).length - 1} fonti attive`),
            h('h1.rk-h1', 'Le gare ', h('b', 'prima che escano')),
            h('p.rk-lede', 'Opere programmate, finanziate e approvate nelle categorie e nelle zone delle BU, da tutte le fonti. Più sono a destra, più la gara è vicina.')),
          h('div.rk-hero-act',
            h('a.rk-ghost', { href: '#/crm/sottosoglia' }, 'Sotto soglia'),
            data.gare ? h('a.rk-ghost', { href: '#/crm/gare' }, ic('gavel', 13), 'Gare') : null,
            h('button.rk-ghost', { type: 'button', on: { click: () => newSignalDialog(data, again) } }, ic('plus', 13), 'Segnala'))),
        timeline, favs),
      map),
    h('section.rk-bar',
      h('span.rk-search', ic('search', 14), search), sel('bu', opts(bus, 'BU: tutte'), 'BU'), regionBox,
      sel('min', AMOUNTS, 'Importo'), sel('kind', opts(kinds, 'Tipo: tutti'), 'Tipo'), sel('warm', WARM, 'Chi conosciamo', 'warm'),
      h('div.rk-bar-r', showSel(), viewChips.el)),
    sources,
    h('div.rk-main', body, side));
  draw();
}
