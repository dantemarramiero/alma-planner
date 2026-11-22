// Doppioni e «Unisci» (canvas CRM v15 · V15-Doppioni e V15-Unisci, via di Dante 22/11/2026).
// Pagina Doppioni (aziende e contatti), avviso in cima agli elenchi, riga «Forse è la stessa di …» nella scheda, finestra
// Unisci dato per dato, e la proposta di unire quando una P.IVA è già di un'altra scheda (anche da «Cerca su internet»).
import { h, fill, toast, loading } from './ui.js';
import { get, post, qs } from './api.js';
import { ic, pill, cvModal, emptyState } from './crm-v2.js';

const REASON_TONE = { nome: 'or', simile: 'or', cf: 'or', email: 'bl', sito: 'bl', nome_azienda: 'or', nome_cell: 'or' };
const reasonPills = rs => rs.map(r => h('span.dp-why', { class: REASON_TONE[r.code] || '' }, r.label));
const personName = c => [c.title, c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || '—';
const initialsOf = s => String(s || '?').replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
const ROLE = { lead: 'Lead', cliente: 'Cliente', fornitore: 'Fornitore', partner: 'Partner', concorrente: 'Concorrente' };

function card(kind, x, best) {
  const name = kind === 'subject' ? x.name : personName(x);
  const sub = kind === 'subject' ? [x.roles.map(r => ROLE[r] || r).join(', '), x.city, x.owner_name && `owner ${x.owner_name}`].filter(Boolean).join(' · ')
    : [x.companies, x.owner_name && `owner ${x.owner_name}`].filter(Boolean).join(' · ');
  const facts = kind === 'subject'
    ? [x.vat ? `P.IVA ${x.vat}` : 'senza P.IVA', `${x.contacts} ${x.contacts === 1 ? 'contatto' : 'contatti'}`, x.emails && `${x.emails} email`, x.meetings && `${x.meetings} incontri`,
      x.boss_code && `BOSS ${x.boss_code}`, x.soa && 'SOA da ANAC', x.created_quick && 'creata al volo', x.zoho && 'da Zoho']
    : [x.email, x.mobile, x.emails && `${x.emails} email`, x.meetings && `${x.meetings} incontri`];
  const href = kind === 'subject' ? `#/crm/scheda/${x.id}` : `#/crm/contatti/${x.id}`;
  return h('a.dp-card', { href, class: best ? 'best' : '' },
    h('div.dp-card-top', h('span.dp-ini', initialsOf(name)), h('div.dp-card-t', h('b', name), h('small', sub || '—')), best ? h('span.dp-stays', 'resta questa') : null),
    h('div.dp-facts', facts.filter(Boolean).map(f => h('span', f))));
}

// ── pagina Doppioni ─────────────────────────────────────────────────────────────────────────────────────────
export async function doppioniPage(box, kind = 'subject') {
  const st = { stato: 'open', mie: false };
  const head = h('div'), list = h('div', loading());
  const draw = async () => {
    fill(list, loading());
    const d = await get(`/api/crm/doppioni${qs({ kind, stato: st.stato, mie: st.mie ? '1' : '' })}`);
    const by = code => d.pairs.filter(p => p.reasons.some(r => r.code === code)).length;
    const tiles = kind === 'subject'
      ? [['Stesso nome', by('nome'), 'quasi sicuri'], ['Nomi simili', by('simile'), 'da guardare'], ['Stesso sito o email', by('sito') + by('email'), ''], ['Stesso codice fiscale', by('cf'), '']]
      : [['Stessa email', by('email'), 'quasi sicuri'], ['Stesso nome in azienda', by('nome_azienda'), ''], ['Stesso nome e cellulare', by('nome_cell'), ''], ['Coppie', d.pairs.length, '']];
    fill(head, h('section.ld-hero.dp-hero',
      h('div.ld-hero-top', h('div.cv-grow', h('div.ld-kicker', `Anagrafiche · Doppioni · ${kind === 'subject' ? 'aziende' : 'contatti'}`),
        h('h1.ld-h1', st.stato === 'open' ? `${d.pairs.length} ${d.pairs.length === 1 ? 'coppia' : 'coppie'} da controllare` : `${d.pairs.length} scartate`),
        h('p.ld-sub', kind === 'subject' ? 'Unire sposta contatti, email, incontri, note, passi e progetti nella scheda che resta.' : 'Unire sposta aziende, email, incontri, note e passi sul contatto che resta.')),
        d.admin ? h('div.ld-acts', h('button.ld-ghost', { type: 'button', on: { click: async e => { e.currentTarget.disabled = true; await post('/api/crm/doppioni/cerca'); toast('Ricerca fatta'); draw(); } } }, ic('refresh', 13), 'Cerca adesso')) : null),
      h('div.dp-tiles', tiles.map(([k, n, s]) => h('div.dp-tile', h('small', k), h('b', String(n)), s ? h('span', s) : null)))),
    h('div.cv-row.dp-filters',
      h('div.dp-seg', [['subject', 'Aziende', '#/crm/doppioni'], ['contact', 'Contatti', '#/crm/doppioni/contatti']].map(([k, l, href]) => h('a.pill', { href, class: k === kind ? 'on' : '' }, l))),
      h('span.cv-grow'),
      h('button.pill.en-chip', { type: 'button', class: st.stato === 'open' && !st.mie ? 'on' : '', on: { click: () => { st.stato = 'open'; st.mie = false; draw(); } } }, `Da controllare ${d.counts.open}`),
      h('button.pill.en-chip', { type: 'button', class: st.mie ? 'on' : '', on: { click: () => { st.stato = 'open'; st.mie = true; draw(); } } }, 'Mie'),
      h('button.pill.en-chip', { type: 'button', class: st.stato === 'dismissed' ? 'on' : '', on: { click: () => { st.stato = 'dismissed'; st.mie = false; draw(); } } }, `Scartate ${d.counts.dismissed}`)));
    if (!d.pairs.length) return fill(list, h('section.cv-card', emptyState('check', st.stato === 'open' ? 'Nessun doppione da controllare.' : 'Nessuna coppia scartata.')));
    fill(list, h('section.cv-card.dp-list', d.pairs.map(p => pairRow(kind, p, draw))));
  };
  fill(box, h('div.cv', head, list));
  await draw();
}

function pairRow(kind, p, again) {
  const actions = p.status === 'dismissed'
    ? [h('button.btn.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/crm/doppioni/${p.id}/riapri`); toast('Coppia riaperta'); again(); } } }, 'Riapri')]
    : [h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: async () => { await post(`/api/crm/doppioni/${p.id}/scarta`); toast('Tolta: non torna più'); again(); } } }, kind === 'subject' ? 'Non sono la stessa' : 'Non è la stessa persona'),
      p.can_merge ? h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => mergeDialog({ kind, a: p.a.id, b: p.b.id, reasons: p.reasons, onDone: again }) } }, 'Unisci…')
        : h('button.btn.btn-sm', { type: 'button', title: 'Unisce chi è owner di tutte e due o la direzione', on: { click: async () => { const r = await post(`/api/crm/doppioni/${p.id}/chiedi`); toast(r.asked ? 'Chiesto all\'owner' : 'Nessuno a cui chiedere'); } } }, 'Chiedi all\'owner')];
  return h('div.dp-pair',
    h('div.cv-row.dp-pair-top', reasonPills(p.reasons), h('span.cv-grow'), actions),
    h('div.dp-pair-cards', card(kind, p.a), h('span.dp-arrow', ic('arrows', 16)), card(kind, p.b)));
}

// ── avviso in cima agli elenchi ─────────────────────────────────────────────────────────────────────────────
export function dupBanner(kind = 'subject', role = '') {
  const el = h('div');
  get(`/api/crm/doppioni/conteggio${qs({ kind, role })}`, { quiet: true }).then(({ n }) => {
    if (!n) return;
    const what = kind === 'contact' ? 'tra i contatti' : role ? `tra i ${{ lead: 'lead', cliente: 'clienti', fornitore: 'fornitori', partner: 'partner', concorrente: 'concorrenti' }[role] || 'soggetti'}` : 'tra le aziende';
    fill(el, h('div.dp-banner', h('span.dp-banner-ic', ic('copy', 17)), h('div.cv-grow', h('b', `${n} ${n === 1 ? 'possibile doppione' : 'possibili doppioni'} ${what}`), h('small', 'Unirli tiene pulito il CRM e i numeri giusti.')),
      h('a.btn.btn-sm.btn-primary', { href: kind === 'contact' ? '#/crm/doppioni/contatti' : '#/crm/doppioni' }, 'Controlla')));
  }).catch(() => {});
  return el;
}

// ── nella scheda: «Forse è la stessa di …» ────────────────────────────────────────────────────────────────────
export function dupLine(kind, id, onMerged) {
  const el = h('div');
  get(`/api/crm/doppioni/di${qs({ kind, id })}`, { quiet: true }).then(({ pairs }) => {
    if (!pairs.length) return;
    fill(el, pairs.map(p => {
      const o = p.other;
      const name = kind === 'subject' ? o.name : personName(o);
      const who = kind === 'subject' ? [o.roles.map(r => ROLE[r] || r).join(', ').toLowerCase(), o.owner_name && `di ${o.owner_name}`].filter(Boolean).join(' ') : o.companies || '';
      return h('div.dp-line', h('span.dp-banner-ic', ic('copy', 15)),
        h('span.cv-grow', kind === 'subject' ? 'Forse è la stessa di ' : 'Forse è la stessa persona di ', h('a', { href: kind === 'subject' ? `#/crm/scheda/${o.id}` : `#/crm/contatti/${o.id}` }, name), who ? ` (${who})` : '', ' · ', h('span.cv-muted', p.reasons.map(r => r.label).join(', '))),
        p.can_merge ? h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => mergeDialog({ kind, a: id, b: o.id, reasons: p.reasons, onDone: onMerged }) } }, 'Unisci…') : null,
        h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: async () => { await post(`/api/crm/doppioni/${p.id}/scarta`); el.remove(); toast('Tolta: non torna più'); } } }, 'Non è la stessa'));
    }));
  }).catch(() => {});
  return el;
}

// ── finestra Unisci ─────────────────────────────────────────────────────────────────────────────────────────
// prefill: { campo: valore } (es. i dati di «Cerca su internet»): diventano la scelta per quel campo
const MOVES = { crm_contact_links: ['contatto', 'contatti', 'azienda', 'aziende'], crm_email_links: ['email', 'email'], crm_meeting_links: ['incontro', 'incontri'], crm_notes: ['nota', 'note'],
  crm_steps: ['passo', 'passi'], crm_project_links: ['progetto', 'progetti'], crm_stage_history: ['voce di storico', 'voci di storico'], crm_plans: ['piano', 'piani'],
  crm_signal_links: ['segnale', 'segnali'], crm_signals: ['segnale del radar', 'segnali del radar'], crm_contact_proposals: ['proposta di contatto', 'proposte di contatto'],
  crm_outcomes: ['esito', 'esiti'], crm_initiative_targets: ['cliente target', 'clienti target'], crm_initiative_signals: ['segnale di iniziativa', 'segnali di iniziativa'],
  assistant_emails: ['email di Alma', 'email di Alma'], business_card_leads: ['biglietto da visita', 'biglietti da visita'] };
const fmt = v => (v === null || v === undefined || v === '' ? '' : String(v));

export async function mergeDialog({ kind = 'subject', a, b, keep = null, reasons = [], prefill = {}, onDone }) {
  const body = h('div.dp-merge', loading());
  let m, pre, choice = {};
  const done = h('button.btn.btn-primary', { type: 'button', disabled: true }, ic('check', 15), 'Unisci');
  const note = h('span.cv-small.cv-muted');
  const draw = async keepId => {
    fill(body, loading());
    pre = await get(`/api/crm/unisci/anteprima${qs({ kind, a, b, keep: keepId || '' })}`);
    choice = {};
    const rows = [...pre.rows];
    const WEB_LABELS = { vat: 'P.IVA', tax_code: 'Codice fiscale', pec: 'PEC', email: 'Email', phone: 'Telefono', website: 'Sito', address: 'Indirizzo', zip: 'CAP', city: 'Comune',
      province: 'Provincia', region: 'Regione', ateco: 'ATECO', legal_form: 'Forma giuridica', linkedin: 'LinkedIn', employees: 'Dipendenti', revenue: 'Fatturato', name: 'Ragione sociale' };
    for (const [k, val] of Object.entries(prefill)) if (!rows.some(r => r.key === k) && val) rows.push({ key: k, label: WEB_LABELS[k] || k, keep: null, other: null, pick: 'web' });
    const label = x => x.name;
    const row = r => {
      const web = prefill[r.key];
      const w = fmt(web), same = (x, y) => x.trim().toLowerCase() === y.trim().toLowerCase();
      const showWeb = w && !same(w, fmt(r.keep)) && !same(w, fmt(r.other));
      const opts = [['keep', fmt(r.keep_label ?? r.keep)], ['other', fmt(r.other_label ?? r.other)], ...(showWeb ? [['web', w]] : [])];
      choice[r.key] = showWeb ? 'web' : w && same(w, fmt(r.other)) ? 'other' : w && same(w, fmt(r.keep)) ? 'keep' : r.pick;
      const cells = h('div.dp-mopts');
      const paint = () => fill(cells, opts.map(([k, v]) => h('button.dp-mopt', { type: 'button', class: [choice[r.key] === k ? 'on' : '', v ? '' : 'is-empty'].join(' '), disabled: !v && k !== 'keep' ? true : undefined,
        on: { click: () => { choice[r.key] = k; paint(); } } }, h('span.dp-radio'), h('span', v || 'vuoto'), k === 'web' ? h('small', 'da internet') : null)));
      paint();
      return h('div.dp-mrow', h('span.dp-mk', r.label), cells);
    };
    const moves = Object.entries(pre.moves || {}).filter(([k]) => k !== 'total' && MOVES[k]).map(([k, n]) => {
      const w = MOVES[k]; const [one, many] = kind === 'contact' && w.length > 2 ? [w[2], w[3]] : [w[0], w[1]];
      return h('span.cv-pill.line', `${n} ${n === 1 ? one : many}`);
    });
    fill(body,
      reasons.length ? h('div.cv-row', { style: { gap: '6px', flexWrap: 'wrap' } }, reasonPills(reasons)) : null,
      h('div.dp-mhead', h('span'),
        h('div.dp-mwho.keep', h('small', 'Resta'), h('b', label(pre.keep)), h('span', pre.keep.owner_name ? `owner ${pre.keep.owner_name}` : '')),
        h('div.dp-mwho', h('div.cv-row', h('small.cv-grow', 'Si unisce'), h('button.cv-lnk', { type: 'button', on: { click: () => draw(pre.other.id) } }, ic('arrows', 12), 'scambia')),
          h('b', label(pre.other)), h('span', pre.other.owner_name ? `owner ${pre.other.owner_name}` : ''))),
      h('div.dp-mrows', rows.map(row)),
      pre.sums ? h('p.cv-small', h('b', 'Si sommano: '), `ruoli (${pre.sums.roles.map(r => ROLE[r] || r).join(', ')}), ASA, categorie, SOA a mano, note. Telefoni, email e indirizzi non tenuti finiscono nelle note.`)
        : h('p.cv-small', h('b', 'Si sommano: '), 'aziende, note e consenso alle comunicazioni. Email e numeri non tenuti finiscono nelle note.'),
      h('div.dp-mmoves', h('b.cv-small', `Si spostano in «${label(pre.keep)}»`), moves.length ? h('div.cv-row', { style: { gap: '6px', flexWrap: 'wrap' } }, moves) : h('span.cv-small.cv-muted', 'niente da spostare'),
        h('small.cv-muted', kind === 'subject' ? `«${label(pre.other)}» resta raggiungibile come «unita a ${label(pre.keep)}»; nello storico resta chi l'ha unita e quando.` : `Il contatto «${label(pre.other)}» si cancella dopo aver spostato tutto.`)));
    const owners = [pre.keep.owner_name, pre.other.owner_name].filter(n => n);
    note.textContent = pre.can_merge ? (owners.length ? 'Gli owner ricevono un avviso.' : '') : 'Unisce chi è owner di tutte e due o la direzione.';
    done.disabled = !pre.can_merge;
  };
  done.addEventListener('click', async () => {
    done.disabled = true;
    const values = {};
    for (const [k, c] of Object.entries(choice)) values[k] = c === 'web' ? { value: prefill[k] } : c;
    try {
      const r = await post('/api/crm/unisci', { kind, keep: pre.keep.id, other: pre.other.id, values });
      m.close();
      toast(`Unite in «${pre.keep.name}»`);
      onDone?.(r);
      if (!onDone) location.hash = kind === 'subject' ? `#/crm/scheda/${r.into}` : `#/crm/contatti/${r.into}`;
    } catch { done.disabled = false; }
  });
  m = cvModal({ title: h('div', h('h2', kind === 'subject' ? 'Unisci due schede' : 'Unisci due contatti'), h('p.cv-small.cv-muted', { style: { margin: '2px 0 0' } }, 'Scegli cosa tenere: dove una è vuota si prende l\'altra.')),
    body, wide: true, left: [note], actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), done] });
  try { await draw(keep); } catch { m.close(); }
}

// ── P.IVA già di un'altra scheda: «È la stessa azienda?» ────────────────────────────────────────────────────
// err = ApiError con data.conflict (e data.web da «Cerca su internet»); currentId = la scheda aperta
export function conflictBox(err, { currentId, onSaveWithout, onMerged } = {}) {
  const c = err?.data?.conflict;
  if (!c) return null;
  const web = err.data.web || {};
  return h('div.dp-conflict',
    h('div.cv-row', { style: { gap: '8px', alignItems: 'flex-start' } }, h('span.dp-banner-ic', ic('copy', 15)),
      h('span', 'Questa P.IVA è già di ', h('b', c.name), ` (${[(c.roles || []).map(r => ROLE[r] || r).join(', ').toLowerCase(), c.city, `${c.contacts} ${c.contacts === 1 ? 'contatto' : 'contatti'}`, c.owner_name && `owner ${c.owner_name}`].filter(Boolean).join(', ')}). `, h('b', 'È la stessa azienda?'))),
    h('div.cv-row', { style: { gap: '8px', flexWrap: 'wrap' } },
      currentId ? h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => mergeDialog({ kind: 'subject', a: currentId, b: c.id, reasons: [{ code: 'cf', label: 'Stessa P.IVA' }], prefill: web, onDone: onMerged }) } }, 'Unisci le due schede') : null,
      onSaveWithout ? h('button.btn.btn-sm', { type: 'button', on: { click: onSaveWithout } }, 'Salva gli altri dati senza la P.IVA') : null,
      h('a.btn.btn-sm.btn-ghost', { href: `#/crm/scheda/${c.id}` }, `Apri ${c.name}`)));
}
