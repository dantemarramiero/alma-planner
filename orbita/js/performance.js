// Alma Strategy: performance management. Quattro pagine:
// - La mia scheda: ruolo dal mansionario, le 5 responsabilità, hard e soft skills (autovalutazione e responsabile);
// - I miei obiettivi: KPI di livello 1 con peso; con la fonte «Hoshin Kanri» il raggiungimento viene dai progetti;
// - Dashboard team (amministratori): raggiungimento per team e per persona, chi ha quale ruolo e responsabile;
// - Mansionario (amministratori): la persona propone, l'amministratore conferma o modifica, la scheda mostra la versione confermata.
import { h, fill, toast, confirmDialog, modal, loading, avatar } from './ui.js';
import { get, post, patch, put, del } from './api.js';
import { store, userById } from './store.js';
import { icon } from './icons.js';

const head = (title, right) => h('div.page-head.hk-head', h('div', h('div.hk-eyebrow', 'Alma Strategy · Performance management 2026'), h('h1', title)), right || null);
const flash = () => {
  const el = document.getElementById('hk-saved');
  if (!el) return;
  el.textContent = `Salvato alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 1200);
};
const REVIEW = { self: ['Autovalutazione da fare', 'warn'], manager: ['Valutazione del responsabile in corso', 'info'], closed: ['Valutazione chiusa', 'ok'] };
const ROLE_ST = { missing: ['Ruolo da compilare', 'muted'], review: ['Proposta in revisione', 'warn'], confirmed: ['Ruolo confermato', 'ok'] };
const itDate = iso => (iso ? new Date(iso).toLocaleDateString('it-IT') : '');
const notAdmin = c => fill(c, head('Riservato'), h('div.card.empty', 'Questa pagina è riservata agli amministratori.'));

// selettore della persona (amministratori: tutti; responsabili: chi riportano a loro)
// scegliere di chi vedere la scheda: tutti per amministratori e HR, chi è sotto per i responsabili
function personPicker(currentId, path) {
  const wrap = h('span');
  const show = list => {
    if (!list.length) return;
    const me = list.some(u => u.id === store.me.id) ? [] : [{ id: store.me.id, name: `${store.me.name} (io)` }];
    const sel = h('select.hk-in.pm-picker', { 'aria-label': 'Persona', on: { change: e => { location.hash = `${path}/${e.target.value}`; } } },
      [...me, ...list].map(u => h('option', { value: u.id, selected: u.id === currentId }, u.name)));
    fill(wrap, h('label.pm-pick', h('span', 'Scheda di'), sel));
  };
  if (store.me.is_admin) show(store.users.filter(u => u.active !== false));
  else get('/api/pm/team', { quiet: true }).then(d => show(d?.people || [])).catch(() => {});
  return wrap;
}

export async function performanceView(container, page, arg) {
  fill(container, loading());
  if (page === 'scheda') return schedaPage(container, Number(arg) || store.me.id);
  if (page === 'obiettivi') return obiettiviPage(container, Number(arg) || store.me.id);
  if (page === 'team') return teamPage(container); // amministratori: tutti; responsabili: i loro collaboratori
  if (page === 'mansionario') return store.me.is_admin ? mansionarioPage(container, Number(arg) || null) : notAdmin(container);
}

// ═══ La mia scheda ═════════════════════════════════════════════════════════════════════════════
async function schedaPage(container, userId) {
  const d = await get(`/api/pm/person?user=${userId}`);
  const { user, role, review, rights } = d;
  const mine = rights.self;
  const reload = () => schedaPage(container, userId);
  const rst = ROLE_ST[role?.status || 'missing'];
  const rv = REVIEW[review.status];

  const scoreRow = (name, { manager = true } = {}) => {
    const s = review.self_scores[name], m = review.manager_scores[name];
    const canSelf = mine && review.status === 'self';
    const canMgr = (rights.manager || rights.admin) && review.status !== 'closed';
    const dots = (val, can, key) => h('span.pm-dots', { role: 'group', 'aria-label': `${name}, ${key === 'self_scores' ? 'autovalutazione' : 'responsabile'}` },
      [1, 2, 3, 4, 5].map(n => h('button.pm-dot', { type: 'button', disabled: !can, 'aria-pressed': String(val === n), title: String(n),
        class: `${val >= n ? 'on' : ''} ${key === 'manager_scores' ? 'mgr' : ''}`,
        on: { click: async () => { const next = { ...review[key], [name]: val === n ? null : n }; if (next[name] === null) delete next[name]; await patch(`/api/pm/reviews/${userId}`, { [key]: next }); review[key] = next; flash(); drawSkills(); } } })));
    const gap = s && m ? m - s : null;
    return h('div.pm-skill', h('span.pm-sname', name), dots(s, canSelf, 'self_scores'), manager ? dots(m, canMgr, 'manager_scores') : h('span'),
      h('span.pm-gap', { class: gap === null ? 'muted' : gap < 0 ? 'ko' : gap > 0 ? 'ok' : 'muted' }, gap === null ? '—' : gap > 0 ? `+${gap}` : gap === 0 ? '0' : `−${-gap}`));
  };
  const skillsBox = h('div.pm-skills-wrap');
  function drawSkills() {
    const avg = key => { const vals = d.soft_skills.map(s => review[key][s]).filter(Boolean); return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1).replace('.', ',') : '—'; };
    const actions = [];
    if (mine && review.status === 'self') actions.push(h('button.btn.btn-primary', { type: 'button', on: { click: async () => { if (await confirmDialog('Inviare l’autovalutazione al responsabile? Dopo non si modifica più.', { ok: 'Invia' })) { await patch(`/api/pm/reviews/${userId}`, { status: 'manager' }); reload(); } } } }, 'Invia l’autovalutazione'));
    if ((rights.manager || rights.admin) && review.status === 'manager') actions.push(h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await patch(`/api/pm/reviews/${userId}`, { status: 'closed' }); reload(); } } }, 'Chiudi la valutazione'));
    if (rights.admin && review.status !== 'self') actions.push(h('button.btn', { type: 'button', on: { click: async () => { await patch(`/api/pm/reviews/${userId}`, { status: review.status === 'closed' ? 'manager' : 'self' }); reload(); } } }, 'Riapri'));
    fill(skillsBox,
      h('section.hk-card',
        h('div.pm-skillhead', h('h2.pm-h', 'Hard skills del ruolo'), h('span', 'Autovalutazione'), h('span', 'Responsabile'), h('span', 'Gap')),
        role?.hard_skills?.length ? role.hard_skills.map(s => scoreRow(s)) : h('p.muted', 'Le hard skills arrivano con il ruolo confermato nel mansionario.')),
      h('section.hk-card',
        h('div.pm-skillhead', h('h2.pm-h', 'Soft skills · da 1 a 5'), h('span', 'Autovalutazione'), h('span', 'Responsabile'), h('span', 'Gap')),
        d.soft_skills.map(s => scoreRow(s)),
        h('div.pm-avg', h('span', 'Media soft skills'), h('span', 'autovalutazione ', h('b', avg('self_scores')), ' · responsabile ', h('b', avg('manager_scores')))),
        actions.length ? h('div.row.pm-actions', actions) : null));
  }

  // ── modifiche della scheda: la persona le prepara (bozza su questo computer) e le invia al responsabile ──
  const DRAFT_KEY = `alma.pmDraft.${userId}`;
  let draft = {};
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch { draft = {}; }
  const keepDraft = () => { try { if (Object.keys(draft).length) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); else localStorage.removeItem(DRAFT_KEY); } catch { /* niente */ } };
  const req = d.request;
  const pending = req?.status === 'pending' ? req : null;
  const canEdit = mine && role && !pending;
  const pendingKey = c => (c.field === 'resp' ? `resp:${c.index}` : c.field);
  const pendingSet = new Set((pending?.changes || []).map(pendingKey));
  const cur = key => (key.startsWith('resp:') ? (role.responsibilities || [])[Number(key.slice(5))] || '' : role[key] ?? '');
  const valOf = key => (key in draft ? draft[key] : cur(key));
  const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
  const setDraft = (key, val) => { if (same(val, cur(key))) delete draft[key]; else draft[key] = val; keepDraft(); render(); };
  // scheda vuota: si apre già con tutti i riquadri da compilare
  const blank = canEdit && role.status === 'missing' && !role.title && !role.description && !(role.responsibilities || []).length;
  const editing = new Set(blank ? ['who', 'desc', 'resp', 'int', 'hard'] : []);
  // segno accanto a un valore: «da inviare» (bozza), «in approvazione» (inviata)
  const mark = key => (key in draft ? h('span.pm-mark.draft', 'da inviare') : pendingSet.has(key) ? h('span.pm-mark.wait', 'in approvazione') : null);
  const was = key => (key in draft && cur(key) ? h('span.pm-was-old', Array.isArray(cur(key)) ? cur(key).join(', ') : String(cur(key))) : null);
  const editBtn = sec => (canEdit ? h('button.btn.btn-sm', { type: 'button', on: { click: () => { editing.has(sec) ? editing.delete(sec) : editing.add(sec); render(); } } }, icon('pencil', { size: 14 }), editing.has(sec) ? 'Fatto' : 'Modifica') : null);
  const toApprover = d.profile?.manager_name ? `a ${d.profile.manager_name}` : 'all’amministratore';

  async function send() {
    const changes = Object.entries(draft).map(([key, after]) => (key.startsWith('resp:') ? { field: 'resp', index: Number(key.slice(5)), after } : { field: key, after }));
    if (!await confirmDialog(`Inviare ${changes.length === 1 ? '1 modifica' : `${changes.length} modifiche`} ${toApprover} per l’approvazione? Finché non decide resta in vigore la versione di oggi.`, { ok: 'Invia' })) return;
    await post('/api/pm/requests', { changes });
    draft = {}; keepDraft(); toast('Inviate per l’approvazione'); reload();
  }

  // il responsabile decide qui le modifiche della persona
  function reviewBox() {
    // sulla propria scheda decide solo un amministratore senza responsabile (altrimenti nessuno potrebbe)
    if (!pending || !(rights.manager || rights.admin) || (mine && !(rights.admin && !d.profile?.manager_name))) return null;
    const dec = pending.changes.map(() => ({ decision: null, reason: '' }));
    const box = h('section.hk-card.pm-review');
    const drawReview = () => {
      const n = dec.filter(x => x.decision).length;
      fill(box,
        h('div.row.spread', h('div', h('h2.pm-h', 'Modifiche da approvare'), h('span.muted.small', `inviate il ${itDate(pending.created_at)}`)),
          h('button.btn', { type: 'button', on: { click: () => { dec.forEach(x => { x.decision = 'ok'; }); drawReview(); } } }, 'Accetta tutto')),
        pending.changes.map((c, i) => h('div.pm-change', { class: dec[i].decision || '' },
          h('span.pm-lbl', c.label),
          h('span.pm-before', Array.isArray(c.before) ? c.before.join(', ') || '—' : String(c.before ?? '') || '—'),
          h('span.pm-after', Array.isArray(c.after) ? c.after.join(', ') : String(c.after)),
          h('div.row', h('button.btn.btn-sm', { type: 'button', class: dec[i].decision === 'ok' ? 'pm-ok' : '', 'aria-pressed': String(dec[i].decision === 'ok'), on: { click: () => { dec[i].decision = 'ok'; drawReview(); } } }, 'Accetta'),
            h('button.btn.btn-sm', { type: 'button', class: dec[i].decision === 'no' ? 'pm-no' : '', 'aria-pressed': String(dec[i].decision === 'no'), on: { click: () => { dec[i].decision = 'no'; drawReview(); } } }, 'Rifiuta'),
            dec[i].decision === 'no' ? h('input.hk-in.pm-reason', { value: dec[i].reason, placeholder: 'Perché? (lo legge la persona)', on: { input: e => { dec[i].reason = e.target.value; } } }) : null))),
        h('div.row.spread', h('span.muted.small', `${n} di ${dec.length} decise · le accettate entrano nel mansionario e valgono per chi ha lo stesso ruolo`),
          h('button.btn.btn-primary', { type: 'button', disabled: n < dec.length, on: { click: async () => { await post(`/api/pm/requests/${pending.id}/decide`, { decisions: dec }); toast('Decisioni salvate'); reload(); } } }, 'Conferma le decisioni')));
    };
    drawReview();
    return box;
  }

  // sulla propria scheda: le richieste dei collaboratori da approvare
  const inbox = h('div');
  if (mine) {
    get('/api/pm/requests', { quiet: true }).then(list => {
      if (!list?.length) return;
      fill(inbox, h('section.hk-card.pm-inbox', h('h2.pm-h', 'Da approvare'),
        list.map(r => h('a.pm-inbox-line', { href: `#/strategy/scheda/${r.user_id}` }, avatar(userById(r.user_id) || { name: r.name }, 28),
          h('span', h('strong', r.name), h('small', `${r.changes.length === 1 ? '1 modifica' : `${r.changes.length} modifiche`} alla scheda · ${itDate(r.created_at)}`)), icon('chevron-left', { size: 16 })))));
    }).catch(() => {});
  }

  const banner = () => {
    const n = Object.keys(draft).length;
    if (pending) return h('div.pm-banner.wait', h('span', h('b', mine ? `In attesa di ${pending.approver_name || 'un amministratore'}` : 'Modifiche in attesa di approvazione'), ` · inviate il ${itDate(pending.created_at)} · qui sotto resta la versione in vigore`),
      mine ? h('button.btn.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/pm/requests/${pending.id}/withdraw`); reload(); } } }, 'Ritira la richiesta') : null);
    if (n) return h('div.pm-banner.draft', h('span', h('b', n === 1 ? '1 modifica' : `${n} modifiche`), n === 1 ? ' non ancora inviata' : ' non ancora inviate'),
      h('div.row', h('button.btn.btn-sm', { type: 'button', on: { click: () => { draft = {}; keepDraft(); render(); } } }, 'Annulla le modifiche'),
        h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: send } }, `Invia ${toApprover} per l’approvazione`)));
    if (blank) return h('div.pm-banner.draft', h('span', h('b', 'La tua scheda è da compilare'), ` · scrivi ruolo, responsabilità e competenze, poi inviala ${toApprover}: dopo l’approvazione entra nel mansionario`));
    if (req?.status === 'decided' && mine) {
      const ok = req.changes.filter(c => c.decision === 'ok').length, no = req.changes.filter(c => c.decision === 'no');
      return h('div.pm-banner.done', h('span', h('b', `Decise da ${req.decided_by_name || 'il responsabile'}`), ` il ${itDate(req.decided_at)}: ${ok} ${ok === 1 ? 'accettata' : 'accettate'}, ${no.length} ${no.length === 1 ? 'rifiutata' : 'rifiutate'}`,
        no.filter(c => c.reason).map(c => h('span.pm-why', ` · ${c.label}: «${c.reason}»`))));
    }
    return null;
  };

  const tabs = h('div.row.pm-subnav', h('a.hk-chip.on', { href: `#/strategy/scheda/${userId}` }, 'Ruolo e valutazione'), h('a.hk-chip', { href: `#/strategy/obiettivi/${userId}` }, 'Obiettivi'));
  const page = h('div');
  fill(container,
    head(mine ? 'La mia scheda' : `Scheda di ${user.name}`, h('div.row', h('span.hk-saved#hk-saved'), personPicker(userId, '#/strategy/scheda'),
      h('span.hk-status', { class: rv[1] }, rv[0]))),
    tabs, inbox, page);
  const reviewCard = reviewBox();

  function render() {
    const textIn = (key, { rows = 0, placeholder = '' } = {}) => (rows
      ? h('textarea.hk-in.pm-edit', { rows, placeholder, on: { change: e => setDraft(key, e.target.value) } }, valOf(key))
      : h('input.hk-in.pm-edit', { value: valOf(key), placeholder, on: { change: e => setDraft(key, key === 'coordinates' ? Number(e.target.value || 0) : e.target.value) } }));
    const fact = (label, key, show) => h('div', h('span', label, ' ', mark(key)),
      editing.has('who') ? textIn(key) : h('b', show(valOf(key))), editing.has('who') ? null : was(key));
    fill(page,
      banner(),
      reviewCard,
      h('section.hk-card.pm-hero',
        avatar(userById(user.id) || user, 56),
        h('div.pm-who', h('strong', user.name), h('span', [valOf('title'), valOf('area')].filter(Boolean).join(' · ') || 'Nessun ruolo assegnato')),
        role ? h('div.pm-facts',
          fact('Ruolo', 'title', v => v || '—'), fact('Area', 'area', v => v || '—'),
          fact('A chi rispondo', 'reports_to', v => v || '—'), fact('Persone che coordino', 'coordinates', v => (v ? `Sì · ${v}` : 'No')),
          h('div', h('span', 'Responsabile in Alma Planet'), h('b', d.profile?.manager_name || '—')),
          h('div', h('span', 'Ruolo nel mansionario'), h('b', { class: rst[1] }, role.status === 'confirmed' && role.confirmed_at ? `Confermato il ${itDate(role.confirmed_at)}` : rst[0]))) : null,
        role ? editBtn('who') : null),
      h('div.pm-cols',
        h('div.pm-col',
          role ? [
            h('section.hk-card',
              h('div.row.spread', h('h2.pm-h', 'Io sono responsabile di… ', mark('description')), editBtn('desc')),
              editing.has('desc') ? textIn('description', { rows: 7 }) : h('p.pm-desc', { class: 'description' in draft ? 'pm-changed' : '' }, valOf('description') || 'Ancora da scrivere.'),
              editing.has('desc') ? null : was('description')),
            h('section.hk-card',
              h('div.row.spread', h('h2.pm-h', 'Le mie 5 responsabilità principali'), editBtn('resp')),
              [0, 1, 2, 3, 4].map(i => {
                const key = `resp:${i}`, val = valOf(key);
                if (!editing.has('resp') && !val && !(key in draft)) return null;
                return h('div.pm-resp', { class: key in draft ? 'pm-changed' : pendingSet.has(key) ? 'pm-waiting' : '' }, h('span.hk-num', String(i + 1)),
                  editing.has('resp') ? textIn(key, { placeholder: `Responsabilità ${i + 1}` }) : h('span.pm-resp-t', h('span', val), was(key)), mark(key));
              })),
            h('section.hk-card',
              h('div.row.spread', h('h2.pm-h', 'Con chi mi interfaccio ', mark('interfaces')), editBtn('int')),
              editing.has('int')
                ? h('input.hk-in.pm-edit', { value: (valOf('interfaces') || []).join(', '), placeholder: 'Separati da virgola', on: { change: e => setDraft('interfaces', e.target.value.split(',').map(x => x.trim()).filter(Boolean)) } })
                : h('div.pm-chips', (valOf('interfaces') || []).map(x => h('span.pm-chip', x)))),
            h('section.hk-card',
              h('div.row.spread', h('h2.pm-h', 'Hard skills del ruolo ', mark('hard_skills')), editBtn('hard')),
              editing.has('hard')
                ? h('textarea.hk-in.pm-edit', { rows: 5, placeholder: 'Una per riga', on: { change: e => setDraft('hard_skills', e.target.value.split('\n').map(x => x.trim()).filter(Boolean)) } }, (valOf('hard_skills') || []).join('\n'))
                : h('div.pm-chips', (valOf('hard_skills') || []).map(x => h('span.pm-chip', x))),
              h('span.muted.small', 'I voti delle hard skills sono nel riquadro a destra.')),
            canEdit ? h('p.muted.small', `Ogni riquadro ha «Modifica». Quello che cambi resta segnato «da inviare» finché non lo invii ${toApprover}.`) : null,
          ] : h('section.hk-card', h('h2.pm-h', 'Nessun ruolo assegnato'), h('p.muted', 'L’amministratore assegna il ruolo dalla dashboard del team o dal mansionario.'))),
        h('div.pm-col', skillsBox)));
  }
  render();
  drawSkills();
}

// ═══ Obiettivi ═════════════════════════════════════════════════════════════════════════════════
// Raggiungimento con la fonte Hoshin Kanri: media dei progetti che lavorano sul KPI di livello 0 (reale su atteso).
function hoshinAchievement(hk, kpiId) {
  if (!hk || !kpiId) return null;
  const ps = hk.projects.filter(p => p.kpi_ids.includes(kpiId));
  if (!ps.length) return null;
  const vals = ps.map(p => {
    let act = 0, exp = 0;
    for (const t of p.tasks) { if (t.closed_date && t.closed_date <= hk.today) act += t.weight; if (t.due_date && t.due_date <= hk.today) exp += t.weight; }
    return exp ? Math.min(1, act / exp) : 1;
  });
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100);
}
const isHoshin = o => /hoshin/i.test(o.source || '');
const achOf = (o, hk) => (isHoshin(o) && o.hk_kpi_id ? hoshinAchievement(hk, o.hk_kpi_id) ?? o.achievement : o.achievement);
function weighted(objs, hk) {
  let w = 0, s = 0;
  for (const o of objs) { const a = achOf(o, hk); if (a === null || a === undefined) continue; w += o.weight; s += o.weight * Math.min(100, a); }
  return w ? Math.round(s / w) : null;
}

async function obiettiviPage(container, userId) {
  const [d, hk] = await Promise.all([get(`/api/pm/person?user=${userId}`), get('/api/strategy?year=2026').catch(() => null)]);
  const { user, rights } = d;
  const can = rights.self || rights.manager || rights.admin;
  const reload = () => obiettiviPage(container, userId);
  const tiles = h('div.hk-stats.pm-tiles');
  const body = h('div');
  fill(container,
    head(rights.self ? 'I miei obiettivi' : `Obiettivi di ${user.name}`, h('div.row', h('span.hk-saved#hk-saved'), personPicker(userId, '#/strategy/obiettivi'),
      can ? h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await post('/api/pm/objectives', { user_id: userId }); reload(); } } }, icon('plus', { size: 16 }), 'Nuovo obiettivo') : null)),
    h('div.row.pm-subnav', h('a.hk-chip', { href: `#/strategy/scheda/${userId}` }, 'Ruolo e valutazione'), h('a.hk-chip.on', { href: `#/strategy/obiettivi/${userId}` }, 'Obiettivi')),
    tiles, body);

  function drawTiles() {
    const objs = d.objectives;
    const tot = objs.reduce((s, o) => s + o.weight, 0);
    const score = weighted(objs, hk);
    const ok = objs.filter(o => (achOf(o, hk) ?? -1) >= 100).length;
    const stat = (label, value, cls) => h('div.hk-stat', h('span', label), h('strong', { class: cls || '' }, value));
    const measured = objs.filter(o => achOf(o, hk) !== null && achOf(o, hk) !== undefined).length;
    fill(tiles, stat(`Raggiungimento pesato · su ${measured} ${measured === 1 ? 'obiettivo misurato' : 'obiettivi misurati'}`, score === null ? '—' : `${score}%`), stat('Obiettivi a target', `${ok} su ${objs.length}`, 'ok'),
      stat('Pesi assegnati', `${tot}%`, tot === 100 ? 'ok' : 'ko'), stat('Dato dall’Hoshin Kanri', String(objs.filter(isHoshin).length)),
      stat('Approvati dal responsabile', `${objs.filter(o => o.approved).length} su ${objs.length}`));
  }
  const cell = (o, field, { cls = '', type = 'text', rows = 0, placeholder = '' } = {}) => {
    const attrs = { 'aria-label': field, placeholder, disabled: !can, on: { change: async e => {
      const val = type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value;
      const up = await patch(`/api/pm/objectives/${o.id}`, { [field]: val }); Object.assign(o, up); flash(); drawTiles(); if (field === 'source' || field === 'hk_kpi_id' || field === 'achievement') draw();
    } } };
    return rows ? h(`textarea.hk-in${cls ? `.${cls}` : ''}`, { rows, ...attrs }, o[field] ?? '') : h(`input.hk-in${cls ? `.${cls}` : ''}`, { type, value: o[field] ?? '', ...attrs });
  };
  function draw() {
    drawTiles();
    if (!d.objectives.length) return fill(body, h('div.card.empty', 'Nessun obiettivo per il 2026. ', can ? 'Aggiungilo con «Nuovo obiettivo».' : ''));
    const groups = [];
    for (const o of d.objectives) { const g = groups.find(x => x.r === o.responsibility); if (g) g.list.push(o); else groups.push({ r: o.responsibility, p: o.pillar, list: [o] }); }
    fill(body, h('div.hk-gcard.pm-objs', h('table.hk-grid',
      h('thead', h('tr', ['Obiettivo e KPI', 'Formula', 'Fonte del dato', 'Frequenza', 'Target', 'Peso', 'Ultimo valore', 'Raggiungimento', 'Approvato', ''].map(t => h('th', t)))),
      groups.map(g => h('tbody',
        h('tr.pm-group', h('td', { colspan: 10 }, h('strong', g.r || 'Senza responsabilità'), g.p ? h('span.pm-chip', g.p) : null)),
        g.list.map(o => {
          const auto = isHoshin(o) && o.hk_kpi_id ? hoshinAchievement(hk, o.hk_kpi_id) : null;
          const a = achOf(o, hk);
          return h('tr',
            h('td', { style: { minWidth: '220px' } }, cell(o, 'objective', { cls: 'strong', rows: 2 }), cell(o, 'kpi', { cls: 'small', placeholder: 'KPI' }),
              h('details.pm-more', h('summary', 'responsabilità, note e ostacoli'), cell(o, 'responsibility', { cls: 'small', placeholder: 'Responsabilità principale' }), cell(o, 'pillar', { cls: 'small', placeholder: 'Pilastro' }), cell(o, 'notes', { cls: 'small', rows: 2, placeholder: 'Note' }), cell(o, 'obstacles', { cls: 'small', rows: 2, placeholder: 'Ostacoli principali' }))),
            h('td', { style: { minWidth: '150px' } }, cell(o, 'formula', { cls: 'small', rows: 2 })),
            h('td', { style: { minWidth: '130px' } }, cell(o, 'source', { cls: 'small' }),
              isHoshin(o) ? h('select.hk-in.small', { disabled: !can, 'aria-label': 'KPI di livello 0', on: { change: async e => { const up = await patch(`/api/pm/objectives/${o.id}`, { hk_kpi_id: e.target.value ? Number(e.target.value) : null }); Object.assign(o, up); flash(); draw(); } } },
                h('option', { value: '' }, 'KPI di livello 0…'), d.hk_kpis.map(k => h('option', { value: k.id, selected: k.id === o.hk_kpi_id }, `${k.letter} · ${k.name}`))) : null),
            h('td', { style: { width: '90px' } }, cell(o, 'frequency', { cls: 'small' })),
            h('td', { style: { width: '100px' } }, cell(o, 'target')),
            h('td', { style: { width: '64px' } }, cell(o, 'weight', { type: 'number', cls: 'center' })),
            h('td', { style: { width: '90px' } }, cell(o, 'last_value', { placeholder: '—' })),
            h('td', { style: { width: '120px' } }, auto !== null
              ? h('div.pm-auto', h('span.pm-ach', { class: a >= 100 ? 'ok' : a >= 80 ? 'warn' : 'ko' }, `${a}%`), h('small', 'dai progetti Hoshin'))
              : h('div.pm-achin', cell(o, 'achievement', { type: 'number', cls: 'center', placeholder: '%' }), a !== null && a !== undefined ? h('span.pm-bar', h('i', { style: { width: `${Math.min(100, a)}%` }, class: a >= 100 ? 'ok' : a >= 80 ? 'warn' : 'ko' })) : null)),
            h('td.center', h('input', { type: 'checkbox', checked: o.approved, disabled: !(rights.manager || rights.admin), 'aria-label': 'Approvato', on: { change: async e => { const up = await patch(`/api/pm/objectives/${o.id}`, { approved: e.target.checked }); Object.assign(o, up); flash(); drawTiles(); } } })),
            h('td.hk-actions', can ? h('button.hk-icon', { type: 'button', 'aria-label': 'Elimina', on: { click: async () => { if (await confirmDialog('Eliminare questo obiettivo?', { ok: 'Elimina', danger: true })) { await del(`/api/pm/objectives/${o.id}`); reload(); } } } }, icon('trash', { size: 16 })) : null));
        }))))),
    h('p.muted.pm-foot', 'Il raggiungimento pesato usa il peso di ogni obiettivo misurato. Con la fonte «Hoshin Kanri» e un KPI di livello 0 scelto, il raggiungimento viene dai progetti che lavorano su quel KPI (reale su atteso a oggi).'));
  }
  draw();
}

// ═══ Obiettivi di team con revisione trimestrale ═══════════════════════════════════════════════════
// Amministratori: tutte le persone; responsabili: i loro collaboratori. Ogni trimestre il responsabile rivede con la
// persona i suoi obiettivi (valore del trimestre, raggiungimento, commento, azioni) e chiude la revisione.
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const DEADLINES = ['15/04', '15/07', '15/10', '15/01'];
const qColor = v => (v === null || v === undefined ? 'muted' : v >= 90 ? 'ok' : v >= 70 ? 'warn' : 'ko');
async function teamPage(container) {
  const [d, hk] = await Promise.all([get('/api/pm/team'), get('/api/strategy?year=2026').catch(() => null)]);
  const today = hk?.today || new Date().toISOString().slice(0, 10);
  const curQ = Number(today.slice(0, 4)) === d.year ? Math.floor((Number(today.slice(5, 7)) - 1) / 3) : 3;
  let q = curQ, sel = d.people[0]?.id || null, team = null;
  const reload = () => teamPage(container);
  // raggiungimento di una persona in un trimestre: dalla revisione (chiusa o in bozza) o, nel trimestre in corso, dal valore di oggi
  const reviewOf = (p, i) => p.quarters.find(x => x.quarter === i + 1);
  function scoreOf(p, i) {
    const rv = reviewOf(p, i);
    if (rv && Object.keys(rv.values || {}).length) {
      let w = 0, s = 0;
      for (const o of p.objectives) { const a = rv.values[o.id]?.achievement; if (a === null || a === undefined) continue; w += o.weight; s += o.weight * Math.min(100, a); }
      return { v: w ? Math.round(s / w) : null, closed: rv.status === 'closed' };
    }
    if (i === curQ) return { v: weighted(p.objectives, hk), closed: false, live: true };
    return { v: null, closed: rv?.status === 'closed' };
  }
  const body = h('div');
  fill(container, head('Obiettivi di team', h('div.row',
    h('div.pm-quarters', QUARTERS.map((l, i) => h('button', { type: 'button', class: q === i ? 'on' : '', disabled: i > curQ, 'aria-pressed': String(q === i), on: { click: () => { q = i; draw(); } } }, l, i === curQ ? ' · in corso' : ''))),
    d.admin ? h('button.btn', { type: 'button', on: { click: () => assign(null) } }, icon('plus', { size: 16 }), 'Aggiungi persona') : null)), body);
  if (!d.people.length) return fill(body, h('div.card.empty', d.admin ? 'Nessuna persona con un profilo: aggiungila con «Aggiungi persona».' : 'Qui compaiono le persone sotto di te. Al momento non ce ne sono.'));

  function assign(person) {
    const users = store.users.filter(u => u.active !== false);
    const who = h('select.input', { disabled: Boolean(person) }, users.map(u => h('option', { value: u.id, selected: person?.id === u.id }, u.name)));
    const mgr = h('select.input', h('option', { value: '' }, '—'), users.map(u => h('option', { value: u.id, selected: person?.manager_id === u.id }, u.name)));
    const teamIn = h('input.input', { value: person?.team || '', placeholder: 'Es. ICT, Engineering, Impianti' });
    const roleSel = h('select.input', h('option', { value: '' }, 'Caricamento…'));
    get('/api/pm/admin/roles').then(roles => fill(roleSel, h('option', { value: '' }, '—'), roles.map(r => h('option', { value: r.id, selected: r.title === person?.role }, r.title))));
    const m = modal({
      title: person ? `Ruolo di ${person.name}` : 'Aggiungi una persona',
      body: h('div.pm-form', h('label.field', h('span', 'Persona'), who), h('label.field', h('span', 'Ruolo nel mansionario'), roleSel), h('label.field', h('span', 'Responsabile (approva la scheda, fa le revisioni)'), mgr), h('label.field', h('span', 'Team'), teamIn)),
      actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        await put(`/api/pm/admin/profiles/${person?.id || who.value}`, { role_id: roleSel.value || null, manager_id: mgr.value || null, team: teamIn.value });
        m.close(); reload();
      } } }, 'Salva')],
    });
  }

  function reviewPanel(p) {
    const rv = reviewOf(p, q);
    const closed = rv?.status === 'closed';
    const lock = closed || !p.can_review; // HR e i responsabili più in alto la vedono soltanto
    const vals = {};
    for (const o of p.objectives) {
      const saved = rv?.values?.[o.id];
      vals[o.id] = { value: saved?.value ?? (q === curQ ? o.last_value || '' : ''), achievement: saved?.achievement ?? (q === curQ ? achOf(o, hk) ?? null : null) };
    }
    const note = h('textarea.hk-in.pm-note-in', { rows: 3, disabled: lock, placeholder: 'Com’è andato il trimestre' }, rv?.note || '');
    const actions = h('textarea.hk-in.pm-note-in', { rows: 2, disabled: lock, placeholder: 'Cosa cambia nel trimestre dopo, chi fa cosa' }, rv?.actions || '');
    const payload = () => ({ values: vals, note: note.value, actions: actions.value });
    const sc = scoreOf(p, q);
    return h('section.hk-card.pm-qreview',
      h('div.row.spread', h('div', h('span.pm-lbl', `Revisione ${QUARTERS[q]} · ${p.team || 'senza team'}`), h('h2', { style: { margin: '2px 0' } }, p.name),
        h('span.muted.small', closed ? `chiusa il ${itDate(rv.closed_at)}` : `da chiudere entro il ${DEADLINES[q]}`, p.can_review ? '' : ' · la fa il responsabile diretto')),
        h('span.pm-qbig', { class: qColor(sc.v) }, sc.v === null ? '—' : `${sc.v}%`)),
      p.objectives.length ? h('div.pm-qobjs',
        h('div.pm-qrow.head', h('span', 'Obiettivo'), h('span', 'Target'), h('span', `Valore ${QUARTERS[q]}`), h('span', '%')),
        p.objectives.map(o => h('div.pm-qrow',
          h('span', o.objective, h('small', ` · peso ${o.weight}%`)), h('span.muted', o.target || '—'),
          h('input.hk-in', { value: vals[o.id].value, disabled: lock, 'aria-label': `Valore del trimestre: ${o.objective}`, on: { change: e => { vals[o.id].value = e.target.value; } } }),
          h('input.hk-in.center', { type: 'number', min: 0, max: 200, value: vals[o.id].achievement ?? '', disabled: lock, 'aria-label': `Raggiungimento: ${o.objective}`, on: { change: e => { vals[o.id].achievement = e.target.value === '' ? null : Number(e.target.value); } } })))) : h('p.muted', 'Nessun obiettivo per il 2026.'),
      h('label.pm-lbl2', 'Commento del responsabile', note),
      h('label.pm-lbl2', 'Azioni per il trimestre dopo', actions),
      h('div.row.pm-qactions',
        !p.can_review ? null : closed ? (d.admin ? h('button.btn', { type: 'button', on: { click: async () => { await post(`/api/pm/quarters/${p.id}/${q + 1}/reopen`); reload(); } } }, 'Riapri') : null) : [
          h('button.btn', { type: 'button', on: { click: async () => { await put(`/api/pm/quarters/${p.id}/${q + 1}`, payload()); toast('Bozza salvata'); reload(); } } }, 'Salva bozza'),
          h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
            if (!await confirmDialog(`Chiudere la revisione ${QUARTERS[q]} di ${p.name}? Dopo la può riaprire solo un amministratore.`, { ok: 'Chiudi la revisione' })) return;
            await put(`/api/pm/quarters/${p.id}/${q + 1}`, payload()); await post(`/api/pm/quarters/${p.id}/${q + 1}/close`); toast('Revisione chiusa'); reload();
          } } }, `Chiudi la revisione ${QUARTERS[q]}`)]));
  }

  function draw() {
    const people = d.people.filter(p => !team || (p.team || 'Senza team') === team);
    const scores = d.people.map(p => scoreOf(p, q).v).filter(x => x !== null);
    const closedN = d.people.filter(p => reviewOf(p, q)?.status === 'closed').length;
    const down = q ? d.people.filter(p => { const a = scoreOf(p, q).v, b = scoreOf(p, q - 1).v; return a !== null && b !== null && a < b; }).length : 0;
    const byTeam = {};
    for (const p of d.people) (byTeam[p.team || 'Senza team'] ||= []).push(p);
    const stat = (label, value, cls) => h('div.hk-stat', h('span', label), h('strong', { class: cls || '' }, value));
    const cell = (p, i) => {
      if (i > curQ) return h('span.pm-qcell.future', '—');
      const s = scoreOf(p, i);
      return h('span.pm-qcell', { class: `${qColor(s.v)} ${s.closed ? '' : 'open'}`, title: s.closed ? 'revisione chiusa' : s.live ? 'in corso, dai valori di oggi' : 'revisione non chiusa' }, s.v === null ? '—' : `${s.v}%`);
    };
    const selP = d.people.find(p => p.id === sel) || d.people[0];
    fill(body,
      h('div.hk-stats.pm-tiles', stat(`Raggiungimento medio · ${QUARTERS[q]}`, scores.length ? `${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}%` : '—'),
        stat(`Revisioni chiuse · ${QUARTERS[q]}`, `${closedN} su ${d.people.length}`), stat('Scadenza della revisione', DEADLINES[q]),
        stat('In calo rispetto al trimestre prima', String(down), down ? 'ko' : '')),
      h('div.pm-qgrid',
        h('section.hk-card',
          h('div.pm-qhead', h('span', 'Team e persone'), QUARTERS.map(l => h('span.c', l)), h('span', `Revisione ${QUARTERS[q]}`), d.admin ? h('span') : null),
          Object.entries(byTeam).map(([t, list]) => [
            h('button.pm-qteam', { type: 'button', class: team === t ? 'on' : '', on: { click: () => { team = team === t ? null : t; draw(); } } }, h('span', t),
              QUARTERS.map((_, i) => { if (i > curQ) return h('span.c.muted', '—'); const vs = list.map(p => scoreOf(p, i).v).filter(x => x !== null); const v = vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) : null; return h('span.c', { class: qColor(v) }, v === null ? '—' : `${v}%`); }),
              h('span'), d.admin ? h('span') : null),
            (team && team !== t ? [] : list).map(p => {
              const rv = reviewOf(p, q), st = rv?.status === 'closed' ? ['Chiusa', 'ok'] : rv ? ['In bozza', 'warn'] : ['Da fare', 'muted'];
              return h('div.pm-qperson', { class: sel === p.id ? 'on' : '' },
                h('button.pm-qname', { type: 'button', on: { click: () => { sel = p.id; draw(); } } }, avatar(userById(p.id) || p, 26), h('span', h('strong', p.name), h('small', p.role || 'senza ruolo'))),
                QUARTERS.map((_, i) => h('span.c', cell(p, i))),
                h('span', h('span.hk-status', { class: st[1] }, st[0])),
                d.admin ? h('button.hk-icon', { type: 'button', title: 'Ruolo, responsabile e team', 'aria-label': 'Modifica ruolo e responsabile', on: { click: () => assign(p) } }, icon('pencil', { size: 14 })) : null);
            })]),
          h('p.muted.small', { style: { marginTop: '10px' } }, 'Verde ≥ 90%, giallo 70–89%, rosso sotto il 70%. Tratteggiato = revisione non ancora chiusa (nel trimestre in corso i valori sono quelli di oggi).')),
        selP ? reviewPanel(selP) : null));
  }
  draw();
}

// ═══ Mansionario ═══════════════════════════════════════════════════════════════════════════════
async function mansionarioPage(container, roleId) {
  const roles = await get('/api/pm/admin/roles');
  let filter = 'all';
  const sel = roles.find(r => r.id === roleId) || roles.find(r => r.status === 'review') || roles[0];
  const listBox = h('section.hk-card.pm-roles');
  const detail = h('div');
  fill(container, head('Mansionario generale', h('div.row', h('span.muted.small', 'La persona propone, l’amministratore conferma o modifica, la scheda mostra la versione confermata.'),
    h('button.btn', { type: 'button', on: { click: async () => { const r = await post('/api/pm/admin/roles', {}); location.hash = `#/strategy/mansionario/${r.id}`; } } }, icon('plus', { size: 16 }), 'Nuovo ruolo'))),
  h('div.pm-mans', listBox, detail));

  function drawList() {
    const count = st => roles.filter(r => st === 'all' || r.status === st).length;
    fill(listBox,
      h('div.row.wrap.pm-filters', [['all', 'Tutti'], ['review', 'Da rivedere'], ['confirmed', 'Confermati'], ['missing', 'Da compilare']].map(([k, l]) =>
        h('button.hk-chip', { type: 'button', class: filter === k ? 'on' : '', on: { click: () => { filter = k; drawList(); } } }, `${l} · ${count(k)}`))),
      roles.filter(r => filter === 'all' || r.status === filter).map(r => h('a.pm-roleitem', { href: `#/strategy/mansionario/${r.id}`, class: r.id === sel?.id ? 'on' : '' },
        h('span', h('strong', r.title), h('small', [r.area, r.holders.map(x => x.name).join(', ')].filter(Boolean).join(' · ') || '—')),
        h('span.hk-status', { class: ROLE_ST[r.status][1] }, ROLE_ST[r.status][0]))));
  }
  function drawDetail() {
    if (!sel) return fill(detail, h('div.card.empty', 'Nessun ruolo.'));
    const pr = sel.proposal;
    const base = pr || sel;
    const input = (val, attrs = {}) => h('input.hk-in', { value: val ?? '', ...attrs });
    const f = {
      title: input(base.title, { class: 'strong' }), area: input(base.area), reports_to: input(base.reports_to), coordinates: input(base.coordinates ?? 0, { type: 'number', min: 0 }),
      interfaces: input((base.interfaces || []).join(', ')), description: h('textarea.hk-in', { rows: 7 }, base.description || ''),
      resp: [0, 1, 2, 3, 4].map(i => input((base.responsibilities || [])[i] || '', { placeholder: `Responsabilità ${i + 1}` })),
      hard: h('textarea.hk-in', { rows: 5, placeholder: 'Una per riga' }, (base.hard_skills || []).join('\n')),
    };
    const sideBySide = (label, proposed, current, editor) => h('div.pm-compare', h('span.pm-lbl', label),
      pr ? h('div.pm-old', h('small', 'Proposta'), h('div', proposed || '—')) : null,
      h('div.pm-new', h('small', pr ? 'Versione del mansionario (modificabile)' : 'Versione del mansionario'), editor),
      pr && current && current !== proposed ? h('div.pm-cur', h('small', 'In vigore oggi'), h('div', current)) : null);
    fill(detail, h('section.hk-card.pm-roledetail',
      h('div.row.spread',
        h('div', h('div.hk-eyebrow', sel.area || 'Ruolo'), h('h2', { style: { margin: '2px 0' } }, sel.title),
          h('span.muted.small', pr ? `${sel.proposed_at ? `Proposta di ${userById(sel.proposed_by)?.name || 'un collaboratore'} del ${itDate(sel.proposed_at)}` : 'Proposta in attesa di conferma'}${sel.confirmed_at ? ` · in vigore la versione del ${itDate(sel.confirmed_at)}` : ''}`
            : sel.confirmed_at ? `Confermato il ${itDate(sel.confirmed_at)}` : 'Ancora da compilare'),
          h('div.pm-chips', sel.holders.map(x => h('a.pm-chip', { href: `#/strategy/scheda/${x.id}` }, x.name)))),
        h('div.row',
          h('button.btn', { type: 'button', on: { click: async () => { if (await confirmDialog(`Eliminare il ruolo «${sel.title}»? Chi lo ha resta senza ruolo.`, { ok: 'Elimina', danger: true })) { await del(`/api/pm/admin/roles/${sel.id}`); location.hash = '#/strategy/mansionario'; } } } }, 'Elimina'),
          h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
            await post(`/api/pm/admin/roles/${sel.id}/confirm`, {
              title: f.title.value, area: f.area.value, reports_to: f.reports_to.value, coordinates: Number(f.coordinates.value || 0),
              interfaces: f.interfaces.value.split(',').map(s => s.trim()).filter(Boolean), description: f.description.value,
              responsibilities: f.resp.map(i => i.value.trim()).filter(Boolean), hard_skills: f.hard.value.split('\n').map(s => s.trim()).filter(Boolean),
            });
            toast('Ruolo confermato: ora è nella scheda di chi lo ha'); mansionarioPage(container, sel.id);
          } } }, 'Conferma e pubblica nel profilo'))),
      h('div.pm-grid4', h('label.hk-fact', h('span', 'Ruolo'), f.title), h('label.hk-fact', h('span', 'Area'), f.area), h('label.hk-fact', h('span', 'A chi risponde'), f.reports_to), h('label.hk-fact', h('span', 'Persone coordinate'), f.coordinates)),
      h('label.hk-fact', h('span', 'Con chi si interfaccia (separati da virgola)'), f.interfaces),
      sideBySide('Io sono responsabile di…', pr?.description, sel.description, f.description),
      h('div.pm-compare', h('span.pm-lbl', 'Le 5 responsabilità principali'),
        f.resp.map((inp, i) => h('div.pm-resprow', h('span.hk-num', String(i + 1)),
          pr ? h('span.pm-was', { class: (pr.responsibilities || [])[i] === (sel.responsibilities || [])[i] ? 'same' : 'diff' }, (sel.responsibilities || [])[i] ? `In vigore: ${(sel.responsibilities || [])[i]}` : 'Nuova') : null,
          inp))),
      h('label.hk-fact', h('span', 'Hard skills del ruolo (una per riga)'), f.hard)));
  }
  drawList();
  drawDetail();
}
