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
function personPicker(currentId, path) {
  if (!store.me.is_admin) return null;
  const sel = h('select.hk-in.pm-picker', { 'aria-label': 'Persona', on: { change: e => { location.hash = `${path}/${e.target.value}`; } } },
    store.users.filter(u => u.active !== false).map(u => h('option', { value: u.id, selected: u.id === currentId }, u.name)));
  return h('label.pm-pick', h('span', 'Scheda di'), sel);
}

export async function performanceView(container, page, arg) {
  fill(container, loading());
  if (page === 'scheda') return schedaPage(container, Number(arg) || store.me.id);
  if (page === 'obiettivi') return obiettiviPage(container, Number(arg) || store.me.id);
  if (page === 'team') return store.me.is_admin ? teamPage(container) : notAdmin(container);
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

  function proposeRole() {
    const src = role.proposal || role;
    const f = {
      title: h('input.input', { value: src.title || '' }), area: h('input.input', { value: src.area || '' }), reports_to: h('input.input', { value: src.reports_to || '' }),
      coordinates: h('input.input', { type: 'number', min: 0, value: src.coordinates || 0 }), interfaces: h('input.input', { value: (src.interfaces || []).join(', ') }),
      description: h('textarea.input', { rows: 6 }, src.description || ''),
      resp: [0, 1, 2, 3, 4].map(i => h('input.input', { value: (src.responsibilities || [])[i] || '', placeholder: `Responsabilità ${i + 1}` })),
      hard: h('textarea.input', { rows: 4, placeholder: 'Una per riga' }, (src.hard_skills || []).join('\n')),
    };
    const field = (label, el) => h('label.field', h('span', label), el);
    const m = modal({
      title: 'Proponi modifiche al mio ruolo', wide: true,
      body: h('div.pm-form',
        h('p.muted', 'La proposta va all’amministratore, che la conferma o la modifica. Finché non è confermata, nella scheda resta la versione in vigore.'),
        h('div.pm-grid2', field('Ruolo', f.title), field('Area', f.area), field('A chi rispondo', f.reports_to), field('Persone che coordino', f.coordinates)),
        field('Con chi mi interfaccio (separati da virgola)', f.interfaces),
        field('Io sono responsabile di…', f.description),
        h('div.field', h('span', 'Le mie 5 responsabilità principali'), f.resp),
        field('Hard skills del ruolo', f.hard)),
      actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
        h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
          await post(`/api/pm/roles/${role.id}/proposal`, {
            title: f.title.value, area: f.area.value, reports_to: f.reports_to.value, coordinates: Number(f.coordinates.value || 0),
            interfaces: f.interfaces.value.split(',').map(s => s.trim()).filter(Boolean), description: f.description.value,
            responsibilities: f.resp.map(i => i.value.trim()).filter(Boolean), hard_skills: f.hard.value.split('\n').map(s => s.trim()).filter(Boolean),
          });
          m.close(); toast('Proposta inviata all’amministratore'); reload();
        } } }, 'Invia la proposta')],
    });
  }

  const tabs = h('div.row.pm-subnav', h('a.hk-chip.on', { href: `#/strategy/scheda/${userId}` }, 'Ruolo e valutazione'), h('a.hk-chip', { href: `#/strategy/obiettivi/${userId}` }, 'Obiettivi'));
  fill(container,
    head(mine ? 'La mia scheda' : `Scheda di ${user.name}`, h('div.row', h('span.hk-saved#hk-saved'), personPicker(userId, '#/strategy/scheda'),
      h('span.hk-status', { class: rv[1] }, rv[0]))),
    tabs,
    h('section.hk-card.pm-hero',
      avatar(userById(user.id) || user, 56),
      h('div.pm-who', h('strong', user.name), h('span', [role?.title, role?.area].filter(Boolean).join(' · ') || 'Nessun ruolo assegnato')),
      h('div.pm-facts',
        h('div', h('span', 'A chi rispondo'), h('b', role?.reports_to || '—')),
        h('div', h('span', 'Responsabile in Alma Planet'), h('b', d.profile?.manager_name || '—')),
        h('div', h('span', 'Coordino persone'), h('b', role?.coordinates ? `Sì · ${role.coordinates}` : 'No')),
        h('div', h('span', 'Ruolo nel mansionario'), h('b', { class: rst[1] }, role?.status === 'confirmed' && role.confirmed_at ? `Confermato il ${itDate(role.confirmed_at)}` : rst[0])))),
    h('div.pm-cols',
      h('div.pm-col',
        role ? [
          h('section.hk-card',
            h('div.row.spread', h('h2.pm-h', 'Io sono responsabile di…'), mine ? h('button.btn', { type: 'button', on: { click: proposeRole } }, icon('pencil', { size: 16 }), 'Proponi modifiche al mio ruolo') : null),
            role.status === 'review' ? h('p.pm-note', 'C’è una proposta in revisione: qui resta la versione in vigore finché l’amministratore non la conferma.') : null,
            h('p.pm-desc', role.description || 'Ancora da scrivere.')),
          h('section.hk-card', h('h2.pm-h', 'Le mie 5 responsabilità principali'),
            (role.responsibilities || []).length ? role.responsibilities.map((r, i) => h('div.pm-resp', h('span.hk-num', String(i + 1)), h('span', r))) : h('p.muted', 'Ancora da definire.')),
          h('section.hk-card', h('h2.pm-h', 'Con chi mi interfaccio'), h('div.pm-chips', (role.interfaces || []).map(x => h('span.pm-chip', x)))),
        ] : h('section.hk-card', h('h2.pm-h', 'Nessun ruolo assegnato'), h('p.muted', 'L’amministratore assegna il ruolo dal mansionario o dalla dashboard del team.'))),
      h('div.pm-col', skillsBox)));
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
            h('td', { style: { minWidth: '260px' } }, cell(o, 'objective', { cls: 'strong', rows: 2 }), cell(o, 'kpi', { cls: 'small', placeholder: 'KPI' }),
              h('details.pm-more', h('summary', 'responsabilità, note e ostacoli'), cell(o, 'responsibility', { cls: 'small', placeholder: 'Responsabilità principale' }), cell(o, 'pillar', { cls: 'small', placeholder: 'Pilastro' }), cell(o, 'notes', { cls: 'small', rows: 2, placeholder: 'Note' }), cell(o, 'obstacles', { cls: 'small', rows: 2, placeholder: 'Ostacoli principali' }))),
            h('td', { style: { minWidth: '200px' } }, cell(o, 'formula', { cls: 'small', rows: 2 })),
            h('td', { style: { minWidth: '170px' } }, cell(o, 'source', { cls: 'small' }),
              isHoshin(o) ? h('select.hk-in.small', { disabled: !can, 'aria-label': 'KPI di livello 0', on: { change: async e => { const up = await patch(`/api/pm/objectives/${o.id}`, { hk_kpi_id: e.target.value ? Number(e.target.value) : null }); Object.assign(o, up); flash(); draw(); } } },
                h('option', { value: '' }, 'KPI di livello 0…'), d.hk_kpis.map(k => h('option', { value: k.id, selected: k.id === o.hk_kpi_id }, `${k.letter} · ${k.name}`))) : null),
            h('td', { style: { width: '110px' } }, cell(o, 'frequency', { cls: 'small' })),
            h('td', { style: { width: '120px' } }, cell(o, 'target')),
            h('td', { style: { width: '64px' } }, cell(o, 'weight', { type: 'number', cls: 'center' })),
            h('td', { style: { width: '110px' } }, cell(o, 'last_value', { placeholder: '—' })),
            h('td', { style: { width: '140px' } }, auto !== null
              ? h('div.pm-auto', h('span.pm-ach', { class: a >= 100 ? 'ok' : a >= 80 ? 'warn' : 'ko' }, `${a}%`), h('small', 'dai progetti Hoshin'))
              : h('div.pm-achin', cell(o, 'achievement', { type: 'number', cls: 'center', placeholder: '%' }), a !== null && a !== undefined ? h('span.pm-bar', h('i', { style: { width: `${Math.min(100, a)}%` }, class: a >= 100 ? 'ok' : a >= 80 ? 'warn' : 'ko' })) : null)),
            h('td.center', h('input', { type: 'checkbox', checked: o.approved, disabled: !(rights.manager || rights.admin), 'aria-label': 'Approvato', on: { change: async e => { const up = await patch(`/api/pm/objectives/${o.id}`, { approved: e.target.checked }); Object.assign(o, up); flash(); drawTiles(); } } })),
            h('td.hk-actions', can ? h('button.hk-icon', { type: 'button', 'aria-label': 'Elimina', on: { click: async () => { if (await confirmDialog('Eliminare questo obiettivo?', { ok: 'Elimina', danger: true })) { await del(`/api/pm/objectives/${o.id}`); reload(); } } } }, icon('trash', { size: 16 })) : null));
        }))))),
    h('p.muted.pm-foot', 'Il raggiungimento pesato usa il peso di ogni obiettivo misurato. Con la fonte «Hoshin Kanri» e un KPI di livello 0 scelto, il raggiungimento viene dai progetti che lavorano su quel KPI (reale su atteso a oggi).'));
  }
  draw();
}

// ═══ Dashboard team ════════════════════════════════════════════════════════════════════════════
async function teamPage(container) {
  const [d, hk] = await Promise.all([get('/api/pm/admin/team'), get('/api/strategy?year=2026').catch(() => null)]);
  let team = null;
  const people = d.people.map(p => {
    const score = weighted(p.objectives, hk);
    const soft = d.soft_skills.map(s => p.manager_scores?.[s]).filter(Boolean);
    return { ...p, score, softAvg: soft.length ? (soft.reduce((a, b) => a + b, 0) / soft.length).toFixed(1).replace('.', ',') : '—', nObj: p.objectives.length, nOk: p.objectives.filter(o => (achOf(o, hk) ?? -1) >= 100).length };
  });
  const col = v => (v === null ? 'muted' : v >= 80 ? 'ok' : v >= 70 ? 'warn' : 'ko');
  const body = h('div');
  fill(container, head('Obiettivi per team', h('div.row', h('button.btn', { type: 'button', on: { click: () => assign(null) } }, icon('plus', { size: 16 }), 'Aggiungi persona'), h('a.btn', { href: '#/strategy/mansionario' }, 'Mansionario'))), body);

  function assign(person) {
    const users = store.users.filter(u => u.active !== false);
    const who = h('select.input', { disabled: Boolean(person) }, users.map(u => h('option', { value: u.id, selected: person?.id === u.id }, u.name)));
    const mgr = h('select.input', h('option', { value: '' }, '—'), users.map(u => h('option', { value: u.id, selected: person?.manager_id === u.id }, u.name)));
    const teamIn = h('input.input', { value: person?.team || '', placeholder: 'Es. ICT, Engineering, Impianti' });
    const roleSel = h('select.input', h('option', { value: '' }, 'Caricamento…'));
    get('/api/pm/admin/roles').then(roles => fill(roleSel, h('option', { value: '' }, '—'), roles.map(r => h('option', { value: r.id, selected: r.title === person?.role }, r.title))));
    const m = modal({
      title: person ? `Ruolo di ${person.name}` : 'Aggiungi una persona',
      body: h('div.pm-form', h('label.field', h('span', 'Persona'), who), h('label.field', h('span', 'Ruolo nel mansionario'), roleSel), h('label.field', h('span', 'Responsabile (fa la valutazione)'), mgr), h('label.field', h('span', 'Team'), teamIn)),
      actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        await put(`/api/pm/admin/profiles/${person?.id || who.value}`, { role_id: roleSel.value || null, manager_id: mgr.value || null, team: teamIn.value });
        m.close(); teamPage(container);
      } } }, 'Salva')],
    });
  }

  function draw() {
    const byTeam = {};
    for (const p of people) (byTeam[p.team || 'Senza team'] ||= []).push(p);
    const teams = Object.entries(byTeam).map(([n, list]) => { const sc = list.map(p => p.score).filter(x => x !== null); return { n, v: sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null, k: list.length }; }).sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
    const list = people.filter(p => !team || (p.team || 'Senza team') === team);
    const scored = people.map(p => p.score).filter(x => x !== null);
    const stat = (label, value, cls) => h('div.hk-stat', h('span', label), h('strong', { class: cls || '' }, value));
    fill(body,
      h('div.hk-stats.pm-tiles', stat('Raggiungimento medio', scored.length ? `${Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)}%` : '—'),
        stat('Persone con obiettivi', `${people.filter(p => p.nObj).length} su ${people.length}`), stat('Valutazioni chiuse', `${people.filter(p => p.review_status === 'closed').length} su ${people.length}`),
        stat('Sotto il 70%', String(people.filter(p => p.score !== null && p.score < 70).length), 'ko')),
      h('div.pm-team',
        h('section.hk-card', h('h2.pm-h', 'Raggiungimento per team'),
          teams.map(t => h('button.pm-teambar', { type: 'button', class: team === t.n ? 'on' : '', on: { click: () => { team = team === t.n ? null : t.n; draw(); } } },
            h('span.n', t.n, h('small', ` · ${t.k}`)), h('span.pm-bar', h('i', { class: col(t.v), style: { width: `${t.v ?? 0}%` } })), h('b', t.v === null ? '—' : `${t.v}%`))),
          h('p.muted.small', 'Media pesata degli obiettivi delle persone del team. Clicca un team per filtrare.')),
        h('section.hk-card', h('h2.pm-h', team ? `Persone · ${team}` : 'Tutte le persone'),
          h('table.hk-grid', h('thead', h('tr', ['Persona', 'Team', 'Obiettivi', 'Raggiungimento', 'Valutazione', 'Soft skills', ''].map(t => h('th', t)))),
            h('tbody', list.map(p => h('tr',
              h('td', h('a.pm-person', { href: `#/strategy/scheda/${p.id}` }, avatar(userById(p.id) || p, 30), h('span', h('strong', p.name), h('small', p.role || 'senza ruolo')))),
              h('td', p.team || '—'),
              h('td', h('a', { href: `#/strategy/obiettivi/${p.id}` }, `${p.nOk} / ${p.nObj}`)),
              h('td', h('div.pm-achin', h('span.pm-bar', h('i', { class: col(p.score), style: { width: `${p.score ?? 0}%` } })), h('b', { class: col(p.score) }, p.score === null ? '—' : `${p.score}%`))),
              h('td', h('span.hk-status', { class: REVIEW[p.review_status || 'self'][1] }, REVIEW[p.review_status || 'self'][0])),
              h('td.center', p.softAvg),
              h('td.hk-actions', h('button.hk-icon', { type: 'button', title: 'Ruolo, responsabile e team', 'aria-label': 'Modifica ruolo e responsabile', on: { click: () => assign(p) } }, icon('pencil', { size: 16 }))))))))));
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
