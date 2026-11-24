// Impostazioni uniche di Alma Space (canvas «Alma Space · Impostazioni», approvato da Dante il 19/11/2026):
// #/impostazioni/<sezione> con panoramica, organigramma e ruoli, utenti, costi AI, privacy e visibilità, registro accessi
// e azioni, integrazioni, moduli. Solo amministratori; Costi AI anche per chi ha «Costi AI: Tutto».
// Pezzi grafici da crm-v2.js (classi cv-*), il resto in css/impostazioni.css (classi imp-*).
import { h, fill, toast, loading, confirmDialog, fmtDate, fmtDateTime, timeAgo, debounce } from './ui.js';
import { get, post, put, patch, del, qs } from './api.js';
import { store } from './store.js';
import { ic, pill, av, pageTop, title, card, emptyState, seg, cvModal, link, toggle } from './crm-v2.js';
import { renderOrganigramma } from './org-incarichi.js';
import { renderManuali } from './manuali.js';

const SECTIONS = [
  ['panoramica', 'Panoramica', 'tutto in un colpo d\'occhio', 'layout-dashboard'],
  ['organigramma', 'Organigramma e ruoli', 'da Microsoft Entra', 'network'],
  ['utenti', 'Utenti', 'chi è entrato, chi no', 'users'],
  ['costi', 'Costi AI', 'per persona e per azienda', 'coins'],
  ['privacy', 'Privacy e visibilità', 'cosa vede ogni ruolo', 'key-round'],
  ['registro', 'Registro accessi e azioni', 'chi ha fatto cosa', 'clock'],
  ['integrazioni', 'Integrazioni', 'servizi collegati', 'plug'],
  ['moduli', 'Moduli', 'impostazioni di un solo modulo', 'grid'],
  ['manuali', 'Manuali d\'uso', 'come si usa, passo per passo', 'book-open'], // per tutti (ALM2-72)
];
const eur = n => `€ ${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// «2 g fa», «ora»: per le frasi che iniziano con «Aggiornato», «Ultimo accesso»…
const ago = iso => { const t = timeAgo(iso); return /^\d/.test(t) ? `${t} fa` : t; };
const roleTone = k => (k === 'admin' ? 'or' : '');
const LEVEL_TONE = { all: 'gr', bu: 'bl', own: 'or', none: '' };
const monthLabel = m => new Date(`${m}-01T12:00:00`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase());
const field = (label, input, hint) => h('label.imp-fld', h('span.imp-lbl', label), input, hint ? h('span.cv-small.cv-muted', hint) : null);
const input = attrs => h('input.input', attrs);
const select = (options, value, attrs = {}) => h('select.input', attrs, options.map(([k, l]) => h('option', { value: k, selected: String(k) === String(value) }, l)));

export async function renderImpostazioni(view, parts = []) {
  const admin = Boolean(store.me?.is_admin);
  const costsOnly = !admin && store.me?.privacy?.costi_ai === 'all';
  // chi non è amministratore vede i Manuali d'uso (e Costi AI se ha «Costi AI: Tutto»)
  const visible = SECTIONS.filter(([k]) => admin || k === 'manuali' || (costsOnly && k === 'costi'));
  const section = visible.some(([k]) => k === parts[1]) ? parts[1] : admin ? 'panoramica' : 'manuali';
  const go = k => { location.hash = `#/impostazioni/${k}`; };
  const nav = h('nav.cv-snav', { 'aria-label': 'Sezioni delle impostazioni' },
    visible.map(([k, l, s2, i]) => h('button', {
      type: 'button', class: k === section ? 'on' : '', 'aria-current': k === section ? 'page' : undefined, on: { click: () => go(k) },
    }, ic(i, 17), h('span', h('span', l), h('span.s2', s2)))));
  const body = h('div.cv-sbody', loading());
  // un manuale aperto usa tutta la larghezza (tavola «Un manuale aperto»): niente menu delle sezioni
  const wide = visible.length < 2 || (section === 'manuali' && parts[2]);
  fill(view, h('div.cv.imp', wide ? body : h('div.cv-settings', nav, body)));
  const draw = { panoramica, organigramma, utenti, costi, privacy, registro, integrazioni, moduli, manuali: (b, o) => renderManuali(b, o.parts) }[section];
  try {
    await draw(body, { go, parts });
  } catch (err) {
    fill(body, emptyState('alert-triangle', err.message || 'Non sono riuscito a caricare questa sezione.'));
  }
}

const head = (eyebrow, light, bold, sub, actions = []) => pageTop({ eyebrow: `Impostazioni · ${eyebrow}`, heading: title(light, bold), sub, actions });

// ── Panoramica ─────────────────────────────────────────────────────────────────────────────────
async function panoramica(body, { go }) {
  const p = await get('/api/impostazioni/panoramica');
  const tile = (key, icon, name, text, status, tone = '') => h('a.cv-card.pad.imp-tile', { href: `#/impostazioni/${key}` },
    h('span.imp-ico', ic(icon, 20)), h('h3.cv-t', name), h('p.cv-small.cv-muted.imp-p', text), pill(status, tone));
  const org = p.org;
  fill(body,
    head('amministratori', '', 'Impostazioni', 'Valgono per tutto il software: Agorà, Project, CRM, Mezzi, Energy, IT e Alma. Le impostazioni proprie di un modulo sono sotto «Moduli».'),
    h('div.imp-grid',
      tile('organigramma', 'network', 'Organigramma e ruoli', `Incarichi, livelli e aree come in BOSS; le persone${org ? ` (${org.people})` : ''} da Microsoft Entra. I ruoli di Alma Space si legano a qualifiche e reparti.`,
        org ? `Aggiornato ${ago(org.synced_at)}` : 'Mai letto da Microsoft', org ? 'gr' : 'am'),
      tile('utenti', 'users', 'Utenti', 'Chi è entrato in Alma Space, quando, con quale ruolo. Chi non è ancora entrato si invita da qui.',
        `${p.users.entered} entrati · ${p.users.never} non ancora`),
      tile('costi', 'coins', 'Costi AI', 'Quanto spende l\'AI per persona e per tutta l\'azienda, con i tetti al mese e al giorno.',
        `${eur(p.cost.month_eur)} di ${eur(p.cost.cap_eur)} questo mese`, p.cost.month_eur >= p.cost.cap_eur * 0.8 ? 'am' : ''),
      tile('privacy', 'key-round', 'Privacy e visibilità', 'Cosa vede ogni ruolo: progetti, CRM, Energy, persone, mezzi, costi AI, documenti.',
        `${p.roles} ruoli · ${p.exceptions} ${p.exceptions === 1 ? 'eccezione personale' : 'eccezioni personali'}`),
      tile('registro', 'clock', 'Registro accessi e azioni', 'Chi è entrato, da dove, cosa ha cambiato. Non si modifica e non si cancella.',
        p.refused_today ? `${p.refused_today} ${p.refused_today === 1 ? 'accesso rifiutato' : 'accessi rifiutati'} oggi` : 'Nessun accesso rifiutato oggi', p.refused_today ? 'rd' : ''),
      tile('integrazioni', 'plug', 'Integrazioni', 'I servizi collegati ad Alma Space. Oggi Microsoft 365: accesso, OneDrive, Outlook, Teams.',
        p.microsoft ? 'Microsoft 365 collegato' : 'Microsoft 365 non configurato', p.microsoft ? 'gr' : 'am'),
      tile('moduli', 'grid', 'Moduli', 'Le impostazioni proprie di Alma, CRM, Mezzi, Energy e Notifiche.', '5 moduli'),
      tile('manuali', 'book-open', 'Manuali d\'uso', 'Come si usa Alma CRM, passo per passo. Li vedono tutti, anche chi non è amministratore.', '17 manuali del CRM')));
  void go;
}

// ── Organigramma e ruoli ───────────────────────────────────────────────────────────────────────
// Organigramma a incarichi (js/org-incarichi.js, come BOSS); la scheda «Ruoli e Microsoft Entra» è ruoliEntra qui sotto.
async function organigramma(body, { parts } = {}) {
  await renderOrganigramma(body, { parts, ruoli: el => ruoliEntra(el) });
}

async function ruoliEntra(body) {
  const o = await get('/api/impostazioni/organigramma');
  const reload = () => ruoliEntra(body);
  const syncBtn = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    syncBtn.disabled = true;
    try {
      const r = await post('/api/impostazioni/organigramma/sync');
      toast(`Organigramma aggiornato: ${r.people} persone${r.new_people ? `, ${r.new_people} nuove` : ''}`);
      reload();
    } finally { syncBtn.disabled = false; }
  } } }, ic('refresh', 15), 'Aggiorna ora');
  const s = o.sync;
  const fact = (label, value, extra) => h('div', h('div.cv-small.cv-muted', label), h('div.imp-strong', value, extra || null));
  const node = (n, depth = 0) => h('div.imp-node-wrap',
    h('div.imp-node', av(n.name, depth ? '' : 'or'), h('div', h('b', n.name), h('span.cv-small.cv-muted', [n.job_title, n.department].filter(Boolean).join(' · ') + (n.team ? ` · ${n.team} persone` : '')))),
    n.children?.length ? h('div.imp-branch', n.children.map(c => node(c, depth + 1))) : null);
  const roleLabel = k => o.roles.find(r => r.key === k)?.label || k;
  fill(body,
    h('div.cv-row', { style: { flexWrap: 'wrap', justifyContent: 'space-between', gap: '12px' } },
      h('p.cv-small.cv-muted', { style: { margin: 0, maxWidth: '640px' } }, 'Le persone, le qualifiche e i reparti arrivano da Microsoft Entra ogni notte. Qui si decide anche quale ruolo di Alma Space ha ognuno (amministratori compresi).'),
      h('div.cv-row', h('a.btn', { href: 'https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserManagementMenuBlade/~/AllUsers', target: '_blank', rel: 'noopener' }, ic('external', 15), 'Apri in Entra'), syncBtn)),
    h('section.cv-card.pad.imp-facts',
      h('div.cv-row', { style: { gap: '10px' } }, pill(s ? 'Collegato' : 'Mai letto', s ? 'gr' : 'am'), h('span.cv-small.cv-muted', 'Microsoft Entra')),
      fact('Ultimo aggiornamento', s ? `${fmtDateTime(s.synced_at)}${s.synced_by_name ? ` · ${s.synced_by_name}` : ''}` : '—', h('span.cv-small.cv-muted', ' · ogni notte alle 3')),
      fact('Persone', String(o.people)),
      fact('Reparti', String(o.departments)),
      fact('Senza responsabile in Entra', String(o.without_manager.length), o.without_manager.length ? link(' vedi chi', { on: { click: () => dialog({
        title: 'Senza responsabile in Entra', body: h('div.imp-list', o.without_manager.map(p => h('div.cv-row', av(p.name), h('div', h('b', p.name), h('div.cv-small.cv-muted', p.job_title || p.email))))),
        actions: [{ label: 'Chiudi' }] }) } }) : null)),
    h('div.imp-two',
      card({ title: 'Ruoli di Alma Space', icon: 'key-round', right: h('button.btn.btn-sm', { type: 'button', on: { click: () => roleDialog(o, null, reload) } }, ic('plus', 14), 'Nuovo ruolo') },
        h('p.cv-small.cv-muted.imp-pad', 'Ogni persona ha il ruolo dato a mano oppure il primo, dall\'alto, la cui regola vale per lei. Anche gli amministratori si scelgono da qui.'),
        h('div.cv-tblwrap', h('table.cv-tbl',
          h('thead', h('tr', h('th', 'Ruolo'), h('th', 'Chi lo ha'), h('th.num', 'Persone'))),
          h('tbody', o.roles.map(r => h('tr.cv-click', { tabindex: 0, on: { click: () => roleDialog(o, r, reload), keydown: e => { if (e.key === 'Enter') roleDialog(o, r, reload); } } },
            h('td', pill(r.label, roleTone(r.key))),
            h('td', r.rule === 'job_title' || r.rule === 'department' ? `${r.rule_label} «${r.rule_value}»` : r.key === 'admin' ? `scelti a mano${o.env_admins.length ? ` + ${o.env_admins.length} su Railway` : ''}` : r.rule_label),
            h('td.num', String(r.people))))))),
        h('div.cv-cardfoot.imp-foot',
          o.manual.filter(m => m.differs).length ? h('div.imp-note', ic('info', 15), `${o.manual.filter(m => m.differs).length} ${o.manual.filter(m => m.differs).length === 1 ? 'persona ha' : 'persone hanno'} un ruolo dato a mano diverso dalla regola`) : null,
          h('button.btn.btn-sm', { type: 'button', on: { click: () => assignDialog(o, reload) } }, ic('user-plus', 14), 'Ruolo a mano'),
          o.manual.length ? h('div.imp-list', o.manual.map(m => h('div.cv-row.imp-manual',
            av(m.name), h('div.cv-grow', h('b', m.name), h('div.cv-small.cv-muted', `${roleLabel(m.role_key)} a mano${m.differs ? ` · la regola direbbe ${roleLabel(m.rule_role)}` : ''}${m.assigned_by_name ? ` · da ${m.assigned_by_name} il ${fmtDate(m.assigned_at, { year: true })}` : ''}`)),
            h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => {
              await put('/api/impostazioni/ruoli-assegnati', { email: m.email, role_key: null });
              toast('Torna alla regola'); reload();
            } } }, 'Torna alla regola')))) : null))));
}

function roleDialog(o, role, done) {
  const sys = role?.system;
  const name = input({ value: role?.label || '', maxlength: 60 });
  const rules = Object.entries(o.rules).filter(([k]) => role?.system ? k === role.rule : !['default', 'guest'].includes(k));
  const rule = select(rules, role?.rule || 'department', { disabled: sys });
  const value = input({ value: role?.rule_value || '', maxlength: 100, placeholder: 'es. Amministrazione' });
  const pos = input({ type: 'number', min: 1, max: 89, value: role?.position ?? 50 });
  const valueRow = field('Testo da cercare', value, 'Senza distinguere maiuscole: basta che sia contenuto nella qualifica o nel reparto di Entra.');
  const sync = () => { valueRow.hidden = !['job_title', 'department'].includes(rule.value); };
  rule.addEventListener('change', sync);
  sync();
  const m = dialog({
    title: role ? `Ruolo «${role.label}»` : 'Nuovo ruolo',
    body: h('div.imp-form', field('Nome', name), field('Chi lo ha', rule, sys ? 'La regola dei ruoli di sistema non si cambia.' : null), valueRow,
      sys ? null : field('Ordine', pos, 'Vince il primo ruolo, dall\'alto, la cui regola vale. Amministratore è 0, gli ospiti 90, tutti gli altri 100.')),
    left: role && !sys ? [{ label: 'Elimina', danger: true, onClick: async () => {
      if (!await confirmDialog(`Eliminare il ruolo «${role.label}»? Chi lo aveva torna alla regola successiva.`, { ok: 'Elimina', danger: true })) return false;
      await del(`/api/impostazioni/ruoli/${role.key}`); toast('Ruolo eliminato'); done(); return true;
    } }] : [],
    actions: [{ label: 'Annulla' }, { label: role ? 'Salva' : 'Crea il ruolo', primary: true, onClick: async () => {
      const b = { label: name.value, rule: rule.value, rule_value: value.value, position: Number(pos.value) };
      if (role) await patch(`/api/impostazioni/ruoli/${role.key}`, b); else await post('/api/impostazioni/ruoli', b);
      toast(role ? 'Ruolo salvato' : 'Ruolo creato'); done(); return true;
    } }],
  });
  return m;
}

function assignDialog(o, done) {
  const people = select([['', 'Scegli una persona'], ...o.directory.map(p => [p.email, p.name])], '');
  const role = select(o.roles.map(r => [r.key, r.label]), 'collaboratore');
  const current = h('span.cv-small.cv-muted');
  people.addEventListener('change', () => {
    const p = o.directory.find(x => x.email === people.value);
    current.textContent = p ? `Oggi: ${o.roles.find(r => r.key === p.role.key)?.label || p.role.key} (${p.role.source === 'manual' ? 'a mano' : 'dalla regola'})` : '';
  });
  dialog({
    title: 'Ruolo dato a mano', body: h('div.imp-form', field('Persona', people), current, field('Ruolo', role)),
    actions: [{ label: 'Annulla' }, { label: 'Assegna', primary: true, onClick: async () => {
      if (!people.value) { toast('Scegli una persona', 'error'); return false; }
      await put('/api/impostazioni/ruoli-assegnati', { email: people.value, role_key: role.value });
      toast('Ruolo assegnato'); done(); return true;
    } }],
  });
}

// ── Utenti ─────────────────────────────────────────────────────────────────────────────────────
async function utenti(body, { parts }) {
  const d = await get('/api/impostazioni/utenti');
  let tab = ['entrati', 'mai', 'sospesi'].includes(parts[2]) ? parts[2] : 'entrati';
  let q = '';
  let roleF = '';
  let deptF = '';
  const picked = new Set();
  const table = h('div');
  const depts = [...new Set([...d.users, ...d.never].map(u => u.department).filter(Boolean))].sort();
  const inviteBtn = h('button.btn.btn-primary', { type: 'button', on: { click: () => invite() } }, ic('send', 15), 'Invita chi non è entrato');
  const invite = async () => {
    const emails = picked.size ? [...picked] : d.never.map(p => p.email);
    if (!emails.length) return toast('Sono già entrati tutti');
    if (!await confirmDialog(`Mandare l'invito a ${emails.length} ${emails.length === 1 ? 'persona' : 'persone'}? Parte un'email dalla tua casella Outlook.`, { ok: 'Manda l\'invito' })) return;
    const r = await post('/api/impostazioni/utenti/invita', { emails: emails.slice(0, 50) });
    toast(`Inviti mandati: ${r.sent} su ${r.asked}${emails.length > 50 ? ' (al massimo 50 alla volta)' : ''}`);
    picked.clear(); draw();
  };
  const match = u => (!q || `${u.name} ${u.email}`.toLowerCase().includes(q)) && (!roleF || u.role_label === roleF) && (!deptF || u.department === deptF);
  const status = u => {
    if (u.suspended_at) return pill('Sospeso', 'rd');
    const days = u.last_login ? Math.floor((Date.now() - new Date(u.last_login)) / 86400000) : null;
    return days !== null && days > 14 ? pill(`Fermo da ${days} giorni`, 'am') : pill('Attivo', 'gr');
  };
  const draw = () => {
    if (tab === 'mai') {
      const list = d.never.filter(match);
      fill(table, list.length ? h('div.cv-tblwrap', h('table.cv-tbl',
        h('thead', h('tr', h('th', h('span.sr', 'Scegli')), h('th', 'Persona'), h('th', 'Ruolo'), h('th', 'Reparto (Entra)'), h('th', 'Qualifica'))),
        h('tbody', list.map(p => h('tr',
          h('td', h('input', { type: 'checkbox', checked: picked.has(p.email), 'aria-label': `Scegli ${p.name}`, on: { change: e => { if (e.target.checked) picked.add(p.email); else picked.delete(p.email); inviteBtn.lastChild.textContent = picked.size ? `Invita ${picked.size}` : 'Invita chi non è entrato'; } } })),
          h('td', h('div.cv-row', av(p.name), h('div', h('b', p.name), h('div.cv-small.cv-muted', p.email)))),
          h('td', pill(p.role_label)), h('td', p.department || '—'), h('td', p.job_title || '—')))))) : emptyState('users', 'Sono entrati tutti quelli dell\'organigramma.'));
      return;
    }
    const list = d.users.filter(u => (tab === 'sospesi' ? u.suspended_at : !u.suspended_at)).filter(match);
    fill(table, list.length ? h('div.cv-tblwrap', h('table.cv-tbl',
      h('thead', h('tr', h('th', 'Persona'), h('th', 'Ruolo'), h('th', 'Reparto (Entra)'), h('th', 'Ultimo accesso'), h('th', 'Stato'), h('th', ''))),
      h('tbody', list.map(u => h('tr',
        h('td', h('div.cv-row', av(u.name, roleTone(u.role)), h('div', h('b', u.name), h('div.cv-small.cv-muted', u.email)))),
        h('td', pill(u.role_label, roleTone(u.role))), h('td', u.department || '—'),
        h('td', u.last_login ? h('div', timeAgo(u.last_login), h('div.cv-small.cv-muted', [u.first_login ? `dal ${fmtDate(u.first_login, { year: true })}` : null, `${u.sessions} ${u.sessions === 1 ? 'sessione' : 'sessioni'}`].filter(Boolean).join(' · '))) : '—'), h('td', status(u)),
        h('td', u.id === store.me.id ? null : u.suspended_at
          ? h('button.btn.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/impostazioni/utenti/${u.id}/riattiva`); toast(`${u.name} riattivato`); utenti(body, { parts }); } } }, 'Riattiva')
          : h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => {
            if (!await confirmDialog(`Sospendere ${u.name}? Esce subito da tutti i dispositivi e non rientra finché non lo riattivi.`, { ok: 'Sospendi', danger: true })) return;
            await post(`/api/impostazioni/utenti/${u.id}/sospendi`); toast(`${u.name} sospeso`); utenti(body, { parts });
          } } }, 'Sospendi'))))))) : emptyState('users', tab === 'sospesi' ? 'Nessun utente sospeso.' : 'Nessuno con questi filtri.'));
  };
  const kpi = (n, label) => h('div.cv-card.pad.imp-kpi', h('span.cv-small.cv-muted', label), h('b', String(n)));
  fill(body,
    head('utenti', '', 'Utenti', 'Chi è entrato in Alma Space con il suo account Microsoft. Sospendere un utente lo fa uscire subito da tutti i dispositivi.', [inviteBtn]),
    h('div.imp-kpis', kpi(d.kpi.entered, 'Entrati almeno una volta'), kpi(d.kpi.active_7d, 'Attivi negli ultimi 7 giorni'), kpi(d.kpi.never, 'In Entra, mai entrati'), kpi(d.kpi.suspended, 'Sospesi')),
    h('section.cv-card',
      h('div.cv-ch',
        seg([['entrati', 'Entrati'], ['mai', 'Mai entrati', d.kpi.never], ['sospesi', 'Sospesi', d.kpi.suspended || null]], tab, k => { tab = k; history.replaceState(null, '', `#/impostazioni/utenti/${k}`); draw(); }, { label: 'Quali utenti' }),
        h('div.cv-ch-r',
          input({ type: 'search', placeholder: 'Cerca per nome o email', 'aria-label': 'Cerca', style: { width: '220px' }, on: { input: debounce(e => { q = e.target.value.trim().toLowerCase(); draw(); }, 150) } }),
          select([['', 'Tutti i ruoli'], ...d.roles.map(r => [r.label, r.label])], '', { 'aria-label': 'Ruolo', on: { change: e => { roleF = e.target.value; draw(); } } }),
          select([['', 'Tutti i reparti'], ...depts.map(x => [x, x])], '', { 'aria-label': 'Reparto', on: { change: e => { deptF = e.target.value; draw(); } } }))),
      table,
      h('div.cv-cardfoot.cv-small.cv-muted', 'Persona, ruolo e reparto arrivano da Microsoft Entra.')));
  draw();
}

// ── Costi AI ───────────────────────────────────────────────────────────────────────────────────
async function costi(body, { parts }) {
  const month = /^\d{4}-\d{2}$/.test(parts[2] || '') ? parts[2] : '';
  const c = await get(`/api/impostazioni/costi${qs({ mese: month || undefined })}`);
  const months = [...new Set([...c.months.map(m => m.month), c.month])].sort().reverse();
  const pctBar = (pct, cls = '') => h('div.imp-bar', { class: cls, role: 'img', 'aria-label': `${pct}%` }, h('i', { style: { width: `${Math.min(100, pct)}%` } }));
  const maxF = Math.max(...c.features.map(f => f.eur), 0.01);
  const warn = c.is_current && c.forecast_eur > c.cap_eur;
  const caps = c.can_edit ? (() => {
    const m = input({ type: 'number', min: 1, step: '0.5', value: c.cap_eur });
    const dd = input({ type: 'number', min: 0.5, step: '0.5', value: c.daily_eur });
    const a = input({ type: 'number', min: 10, max: 100, step: 5, value: c.alert_pct });
    const unl = toggle(c.admins_unlimited, 'Gli amministratori non hanno limite al giorno', { 'aria-label': 'Amministratori senza limite al giorno' });
    return card({ title: 'Tetti di spesa', icon: 'sliders', cls: 'pad' },
      field('Tetto aziendale al mese (€)', m, 'Raggiunto il tetto, l\'AI si ferma per tutti fino al mese dopo.'),
      field('Tetto per persona al giorno (€)', dd, 'Raggiunto, si ferma solo per quella persona fino a domani. Per qualcuno in più o in meno: «Quote per persona».'),
      h('div.imp-fld', unl.el, h('span.cv-small.cv-muted', 'Vedono comunque quanto spendono accanto al tasto Alma. Il tetto del mese vale per tutti.')),
      field('Avvisa gli amministratori al (%)', a),
      h('button.btn.btn-primary', { type: 'button', style: { justifySelf: 'start' }, on: { click: async () => {
        await put('/api/impostazioni/costi', { monthly_eur: Number(m.value), daily_eur: Number(dd.value), alert_pct: Number(a.value), admins_unlimited: unl.input.checked });
        toast('Tetti salvati'); costi(body, { parts });
      } } }, 'Salva'));
  })() : null;
  // Quote per persona (ALM2-62): chi ha una quota al giorno diversa da tutti, o nessun limite.
  const perPerson = c.can_edit ? (() => {
    const save = async (id, quota) => { await put(`/api/impostazioni/costi/persona/${id}`, { quota }); toast('Quota salvata'); costi(body, { parts }); };
    const free = c.users.filter(u => !c.quotas.some(q => q.id === u.id));
    const who = select([['', 'Scegli una persona…'], ...free.map(u => [u.id, u.admin ? `${u.name} (amministratore)` : u.name])], '', { 'aria-label': 'Persona' });
    const amount = input({ type: 'number', min: 0.5, step: '0.5', placeholder: String(c.daily_eur), 'aria-label': 'Euro al giorno', style: { width: '96px' } });
    const noLimit = toggle(false, 'Senza limite', { 'aria-label': 'Senza limite' });
    noLimit.input.addEventListener('change', () => { amount.disabled = noLimit.input.checked; });
    const add = h('button.btn', { type: 'button', on: { click: () => {
      if (!who.value) return toast('Scegli una persona');
      if (!noLimit.input.checked && !(Number(amount.value) > 0)) return toast('Scrivi quanti euro al giorno');
      save(who.value, noLimit.input.checked ? 'unlimited' : Number(amount.value));
    } } }, ic('plus', 15), 'Aggiungi');
    return card({ title: 'Quote per persona', icon: 'users', cls: 'pad' },
      h('span.cv-small.cv-muted', `Tutti gli altri hanno ${eur(c.daily_eur)} al giorno${c.admins_unlimited ? ', gli amministratori nessun limite' : ''}.`),
      c.quotas.length ? h('div.imp-quotas', c.quotas.map(q => h('div.cv-row.imp-quota',
        av(q.name), h('span.cv-grow', q.name),
        pill(q.value === 'unlimited' ? 'Senza limite' : `${eur(q.value)} al giorno`, q.value === 'unlimited' ? 'or' : ''),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Torna come tutti', 'aria-label': `Togli la quota di ${q.name}`, on: { click: () => save(q.id, null) } }, ic('x', 15))))) : null,
      h('div.imp-quota-add', who, h('div.cv-row', { style: { gap: '10px', flexWrap: 'wrap' } }, h('span.cv-row', { style: { gap: '6px' } }, amount, h('span.cv-small.cv-muted', '€ al giorno')), noLimit.el, add)));
  })() : null;
  fill(body,
    head('costi AI', '', 'Costi AI', 'Tutto quello che l\'AI costa in Alma Space, in euro: Alma per scritto e a voce, trascrizioni, ricerche AI del CRM. I prezzi in dollari si convertono al cambio di Alma.',
      [select(months.map(m => [m, monthLabel(m)]), c.month, { 'aria-label': 'Mese', on: { change: e => { location.hash = `#/impostazioni/costi/${e.target.value}`; } } })]),
    h('div.imp-two',
      h('section.cv-card.pad.imp-total',
        h('span.cv-small.cv-muted', `Tutta l'azienda · ${monthLabel(c.month).toLowerCase()}${c.is_current ? ', fino a oggi' : ''}`),
        h('div.imp-big', h('span', eur(c.month_eur)), h('span.cv-small.cv-muted', `di ${eur(c.cap_eur)} al mese`)),
        pctBar(c.pct, c.pct >= c.alert_pct ? 'warn' : ''),
        h('div.cv-row', { style: { flexWrap: 'wrap', justifyContent: 'space-between', gap: '8px' } },
          h('span.cv-small.cv-muted', `${c.pct}% del tetto${c.is_current ? ` · a questo ritmo a fine mese ${eur(c.forecast_eur)}` : ''}`),
          warn ? pill('Supererà il tetto prima di fine mese', 'am') : null)),
      card({ title: 'Per funzione', icon: 'bar-chart-3', cls: 'pad' },
        c.features.map(f => h('div.imp-feat', h('div.cv-row', h('span.cv-grow', f.label), h('b', eur(f.eur))), pctBar(Math.round(f.eur / maxF * 100), 'thin'))))),
    h('div.imp-two.wide-left',
      card({ title: 'Per persona', icon: 'users', right: h('span.cv-small.cv-muted', `di solito ${eur(c.daily_eur)} al giorno`) },
        c.people.length ? h('div.cv-tblwrap', h('table.cv-tbl',
          h('thead', h('tr', h('th', 'Persona'), h('th.num', 'Domande'), h('th.num', 'Mese'), c.is_current ? h('th', 'Oggi sul tetto del giorno') : null, h('th.num', 'Giorni al tetto'))),
          h('tbody', c.people.map(p => h('tr',
            h('td', h('div.cv-row', av(p.name), p.name)), h('td.num', String(p.questions)), h('td.num', eur(p.eur)),
            c.is_current ? h('td', h('div.cv-row', p.quota.unlimited ? null : pctBar(Math.round(p.today_eur / p.quota.eur * 100), 'mini'), h('span.cv-small.cv-muted', p.quota.unlimited ? `${eur(p.today_eur)} · senza limite` : `${eur(p.today_eur)} di ${eur(p.quota.eur)}`))) : null,
            h('td.num', pill(String(p.cap_days), p.cap_days ? 'am' : ''))))))) : emptyState('coins', 'Nessuna spesa AI in questo mese.')),
      h('div.imp-side', caps, perPerson)));
}

// ── Privacy e visibilità ───────────────────────────────────────────────────────────────────────
async function privacy(body) {
  await privacyBase(body);
  await appendHrPrivacy(body).catch(() => {}); // Alma HR: chi vede RAL e mappatura (sola lettura qui)
}
async function privacyBase(body) {
  const p = await get('/api/impostazioni/privacy');
  const matrix = JSON.parse(JSON.stringify(p.matrix));
  let changes = 0;
  const changeText = h('span.cv-grow.cv-small');
  const bar = h('div.cv-savebar', { hidden: true, role: 'status' }, changeText,
    h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => privacy(body) } }, 'Annulla'),
    h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async () => {
      const r = await put('/api/impostazioni/privacy', { matrix });
      toast(r.changes === 1 ? 'Permesso salvato' : `${r.changes} permessi salvati`); privacy(body);
    } } }, 'Salva le modifiche'));
  const editable = (role, area) => !area.fixed && area.levels.length > 1 && (role !== 'admin' || p.admin_editable.includes(area.key));
  const cell = (role, area) => {
    const lv = matrix[role][area.key];
    const label = p.levels[lv];
    if (!editable(role, area)) return h('td', pill(label, LEVEL_TONE[lv]));
    const btn = h('button.imp-cell', { type: 'button', title: `Cambia: ${area.label}`, 'aria-label': `${area.label} per ${p.roles.find(r => r.key === role).label}: ${label}. Cambia` }, pill(label, LEVEL_TONE[lv]));
    btn.addEventListener('click', () => {
      const i = area.levels.indexOf(matrix[role][area.key]);
      matrix[role][area.key] = area.levels[(i + 1) % area.levels.length];
      changes = Object.keys(matrix).reduce((n, r) => n + p.areas.filter(a => matrix[r][a.key] !== p.matrix[r][a.key]).length, 0);
      bar.hidden = !changes;
      changeText.textContent = changes === 1 ? '1 modifica non salvata' : `${changes} modifiche non salvate`;
      btn.replaceWith(cell(role, area).firstChild);
    });
    return h('td', btn);
  };
  const exc = p.exceptions;
  const areaLabel = k => p.areas.find(a => a.key === k)?.label || k;
  fill(body,
    head('privacy', '', 'Privacy', 'Cosa vede ogni ruolo. Clicca una casella per cambiarla. Alma risponde con le stesse regole di chi le fa la domanda.',
      [h('button.btn', { type: 'button', on: { click: () => tryAs(p) } }, ic('user', 15), 'Prova come…')]),
    h('div.cv-row.imp-legend', Object.entries(p.levels).map(([k, l]) => pill(l, LEVEL_TONE[k])),
      h('span.cv-small.cv-muted', 'Per regole su un reparto crea un ruolo con la regola «Reparto contiene» in Organigramma e ruoli.')),
    h('section.cv-card', h('div.cv-tblwrap', h('table.cv-tbl.imp-matrix',
      h('thead', h('tr', h('th', 'Ruolo'), p.areas.map(a => h('th', { title: a.hint || '' }, a.label)))),
      h('tbody', p.roles.map(r => h('tr', h('td', pill(r.label, roleTone(r.key))), p.areas.map(a => cell(r.key, a)))))))),
    h('p.cv-small.cv-muted.imp-hints', p.areas.filter(a => a.hint).map(a => h('span', h('b', `${a.label}: `), a.hint))),
    bar,
    card({ title: 'Eccezioni personali', icon: 'user', count: exc.length, right: h('button.btn.btn-sm', { type: 'button', on: { click: () => exceptionDialog(p, () => privacy(body)) } }, ic('plus', 14), 'Aggiungi eccezione') },
      h('p.cv-small.cv-muted.imp-pad', 'Valgono più del ruolo. Ogni tre mesi vanno riconfermate da un amministratore.'),
      exc.length ? h('div.imp-list.imp-pad', exc.map(e => h('div.cv-row.imp-exc',
        av(e.name), h('div.cv-grow',
          h('b', `${e.name}${e.department ? ` · ${e.department}` : ''}`),
          h('div.cv-small.cv-muted', `${areaLabel(e.area)}: `, h('b', p.levels[e.level]), ` invece di «${p.levels[e.role_level] || '—'}» · ${e.until ? `fino al ${fmtDate(e.until, { year: true })}` : 'senza scadenza'}${e.note ? ` · ${e.note}` : ''}`),
          h('div.cv-small.cv-muted', `data da ${e.created_by_name || '—'} il ${fmtDate(e.created_at, { year: true })}${e.reviewed_at ? ` · riconfermata il ${fmtDate(e.reviewed_at, { year: true })}` : ''}`)),
        e.expired ? pill('Scaduta', 'rd') : e.review_due ? h('button.btn.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/impostazioni/privacy/eccezioni/${e.id}/conferma`); toast('Eccezione riconfermata'); privacy(body); } } }, 'Riconferma') : null,
        h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => {
          if (!await confirmDialog(`Togliere l'eccezione di ${e.name}?`, { ok: 'Togli', danger: true })) return;
          await del(`/api/impostazioni/privacy/eccezioni/${e.id}`); toast('Eccezione tolta'); privacy(body);
        } } }, 'Togli')))) : h('div.imp-pad', emptyState('user', 'Nessuna eccezione: valgono solo i ruoli.'))));
}

async function tryAs(p) {
  const org = await get('/api/impostazioni/organigramma');
  const people = select([['', 'Scegli una persona'], ...org.directory.map(x => [x.email, x.name])], '');
  const out = h('div.imp-list');
  people.addEventListener('change', async () => {
    if (!people.value) return fill(out);
    const r = await get(`/api/impostazioni/privacy/prova${qs({ email: people.value })}`);
    fill(out, h('div.cv-small.cv-muted', `Ruolo: ${r.role_label}${r.role.source === 'manual' ? ' (a mano)' : r.role.source === 'env' ? ' (chiave di riserva su Railway)' : ' (dalla regola)'}`),
      p.areas.map(a => h('div.cv-row', h('span.cv-grow', a.label), pill(p.levels[r.levels[a.key]], LEVEL_TONE[r.levels[a.key]]))));
  });
  dialog({ title: 'Prova come…', body: h('div.imp-form', field('Persona', people), out), actions: [{ label: 'Chiudi' }] });
}

async function exceptionDialog(p, done) {
  const org = await get('/api/impostazioni/organigramma');
  const people = select([['', 'Scegli una persona'], ...org.directory.map(x => [x.email, x.name])], '');
  const areas = p.areas.filter(a => !a.fixed);
  const area = select(areas.map(a => [a.key, a.label]), areas[0].key);
  const level = select([], '');
  const syncLevels = () => {
    const a = areas.find(x => x.key === area.value);
    fill(level, a.levels.map(k => h('option', { value: k }, p.levels[k])));
  };
  area.addEventListener('change', syncLevels);
  syncLevels();
  const until = input({ type: 'date' });
  const note = input({ maxlength: 300, placeholder: 'es. segue le gare fino a fine anno' });
  dialog({
    title: 'Eccezione personale', body: h('div.imp-form', field('Persona', people), field('Area', area), field('Cosa vede', level), field('Fino al', until, 'Vuoto = senza scadenza.'), field('Perché', note)),
    actions: [{ label: 'Annulla' }, { label: 'Aggiungi', primary: true, onClick: async () => {
      if (!people.value) { toast('Scegli una persona', 'error'); return false; }
      await post('/api/impostazioni/privacy/eccezioni', { email: people.value, area: area.value, level: level.value, until: until.value || null, note: note.value });
      toast('Eccezione aggiunta'); done(); return true;
    } }],
  });
}

// ── Registro accessi e azioni ──────────────────────────────────────────────────────────────────
async function registro(body) {
  const f = { tipo: '', persona: '', modulo: '', giorni: '7' };
  let rows = [];
  let more = false;
  let total = 0;
  let meta = null;
  const tableBox = h('div');
  const foot = h('div.cv-cardfoot.cv-row', { style: { justifyContent: 'space-between' } });
  const csv = h('a.btn', { href: '#', download: '' }, ic('download', 15), 'Esporta CSV');
  const esito = r => {
    if (r.action === 'login_refused') return pill(`Rifiutato${r.target && r.detail?.label ? `: ${r.detail.label}` : ''}`, 'rd');
    if (r.action === 'login') return pill('Entrato', 'gr');
    if (r.status >= 400) return pill(`Non riuscito (${r.status})`, 'rd');
    return pill('Fatto', 'gr');
  };
  const fmtVal = x => (x == null ? '—' : Array.isArray(x) ? x.join('\n') : typeof x === 'object' ? Object.entries(x).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v ?? '—'}`).join('\n') : String(x));
  const drawTable = () => {
    fill(tableBox, rows.length ? h('div.cv-tblwrap', h('table.cv-tbl.imp-log',
      h('thead', h('tr', h('th', 'Quando'), h('th', 'Chi'), h('th', 'Azione'), h('th', 'Su cosa'), h('th', 'Modulo'), h('th', 'Da dove'), h('th', 'Esito'))),
      h('tbody', rows.flatMap(r => {
        const has = r.detail && (r.detail.before || r.detail.after);
        const line = h('tr', { class: has ? 'cv-click' : '' },
          h('td', fmtDateTime(r.created_at)),
          h('td', r.name ? h('div.cv-row', av(r.name), r.name) : h('span.cv-muted', r.action === 'login_refused' ? 'sconosciuto' : 'Sistema')),
          h('td', r.what, has ? h('span.cv-small.cv-muted', ' · prima / dopo') : null), h('td', r.target || '—'), h('td', r.module || '—'), h('td.cv-small', r.ip || '—'), h('td', esito(r)));
        if (!has) return [line];
        const diff = h('tr.imp-diffrow', { hidden: true }, h('td', { colspan: 7 }, h('div.imp-diff',
          h('div.imp-before', h('span.cv-small.cv-muted', 'Prima'), h('pre', fmtVal(r.detail.before))),
          h('div.imp-after', h('span.cv-small.cv-muted', 'Dopo'), h('pre', fmtVal(r.detail.after))))));
        line.addEventListener('click', () => { diff.hidden = !diff.hidden; });
        return [line, diff];
      })))) : emptyState('clock', 'Nessuna riga con questi filtri.'));
    fill(foot, h('span.cv-small.cv-muted', `${rows.length} di ${total.toLocaleString('it-IT')} righe`),
      more ? link('Carica altre', { on: { click: () => load(rows[rows.length - 1].id) } }) : null);
  };
  const load = async (prima) => {
    const query = { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), prima };
    const r = await get(`/api/impostazioni/registro${qs(query)}`);
    rows = prima ? [...rows, ...r.rows] : r.rows;
    more = r.more; total = r.total;
    if (!meta) { meta = r; drawFilters(); }
    csv.href = `/api/impostazioni/registro.csv${qs(Object.fromEntries(Object.entries(f).filter(([, v]) => v)))}`;
    drawTable();
  };
  const filters = h('div.cv-ch');
  const drawFilters = () => fill(filters,
    seg([['', 'Tutto'], ['accessi', 'Accessi'], ['modifiche', 'Modifiche'], ['impostazioni', 'Impostazioni e permessi'], ['rifiutati', 'Rifiutati']], f.tipo, k => { f.tipo = k; load(); }, { label: 'Tipo' }),
    h('div.cv-ch-r',
      select([['', 'Tutte le persone'], ...meta.people.map(p => [p.id, p.name])], f.persona, { 'aria-label': 'Persona', on: { change: e => { f.persona = e.target.value; load(); } } }),
      select([['', 'Tutti i moduli'], ...meta.modules.map(m => [m, m])], f.modulo, { 'aria-label': 'Modulo', on: { change: e => { f.modulo = e.target.value; load(); } } }),
      select([['1', 'Oggi e ieri'], ['7', 'Ultimi 7 giorni'], ['30', 'Ultimi 30 giorni'], ['365', 'Ultimo anno'], ['730', 'Ultimi 2 anni']], f.giorni, { 'aria-label': 'Periodo', on: { change: e => { f.giorni = e.target.value; load(); } } })));
  fill(body,
    head('registro', '', 'Registro', 'Ogni accesso e ogni modifica, con il prima e il dopo quando ci sono. Il registro non si modifica e non si cancella; si tiene per 24 mesi.', [csv]),
    h('section.cv-card', filters, tableBox, foot));
  await load();
}

// ── Integrazioni ───────────────────────────────────────────────────────────────────────────────
async function integrazioni(body) {
  const d = await get('/api/impostazioni/integrazioni');
  const ms = d.microsoft;
  const testOut = h('span.cv-small.cv-muted');
  const svc = (name, text, status, tone) => h('div.cv-box.big.imp-svc', h('b', name), h('span.cv-small.cv-muted', text), pill(status, tone));
  const perm = (text, used) => h('div.imp-perm', h('span', text), h('span.cv-small.cv-muted', used));
  const exp = String(ms.secret_expires || '');
  fill(body,
    head('integrazioni', '', 'Integrazioni', 'I servizi esterni collegati ad Alma Space. Per ognuno: se funziona, cosa può fare e quando scade il collegamento.'),
    h('section.cv-card.pad',
      h('div.cv-row', { style: { flexWrap: 'wrap', justifyContent: 'space-between', gap: '12px' } },
        h('div.cv-row', { style: { gap: '14px' } }, h('span.imp-mslogo', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
          h('div', h('h3.cv-t', 'Microsoft 365'), h('div.cv-small.cv-muted', 'Tenant almacis.it · app «Alma Planner» in Entra'))),
        h('div.cv-row', pill(ms.configured ? 'Collegato' : 'Non configurato', ms.configured ? 'gr' : 'am'), testOut,
          ms.configured ? h('button.btn', { type: 'button', on: { click: async e => {
            e.currentTarget.disabled = true;
            try { const r = await post('/api/impostazioni/integrazioni/microsoft/prova'); testOut.textContent = `Risponde in ${r.ms} ms · ${r.name || ''}`; toast('Microsoft 365 risponde'); } finally { e.currentTarget.disabled = false; }
          } } }, 'Prova il collegamento') : null)),
      h('div.imp-svcs',
        svc('Accesso', 'Login con l\'account Microsoft, controllo ogni 12 ore', ms.last_login ? `Ultimo accesso ${ago(ms.last_login)}` : 'Nessun accesso ancora', ms.configured ? 'gr' : 'am'),
        svc('Organigramma', 'Persone, responsabili, reparti da Entra, ogni notte', ms.org ? `Aggiornato ${ago(ms.org.synced_at)}` : 'Mai letto', ms.org ? 'gr' : 'am'),
        svc('OneDrive', 'Documenti dei progetti nella cartella «Alma Planet»', ms.configured ? 'Funziona' : 'Non configurato', ms.configured ? 'gr' : 'am'),
        svc('Outlook', 'Email nei progetti, calendario, incontri, promemoria', ms.configured ? 'Funziona' : 'Non configurato', ms.configured ? 'gr' : 'am'),
        svc('Teams', 'Chat in «Messaggi»', ms.configured ? 'Funziona' : 'Non configurato', ms.configured ? 'gr' : 'am'),
        svc('Collegati', 'Persone con i token Microsoft salvati (cifrati)', `${ms.users_with_tokens} persone`, '')),
      h('div.imp-two',
        h('div', h('div.cv-sect', { style: { padding: '0 0 6px' } }, 'Permessi dati da un amministratore'),
          perm('Leggere i profili di tutti (User.Read.All)', 'organigramma'), perm('File di OneDrive (Files.ReadWrite.All)', 'documenti'),
          perm('Calendari (Calendars.ReadWrite)', 'calendario, incontri'), perm('Leggere e mandare email (Mail.Read, Mail.Send)', 'email, promemoria, inviti'),
          perm('Chat di Teams (Chat.ReadWrite)', 'messaggi')),
        h('div', h('div.cv-sect', { style: { padding: '0 0 6px' } }, 'Scadenze'),
          h('div.imp-perm', h('span', 'Segreto dell\'app in Entra'), pill(exp ? monthLabel(exp).toLowerCase() : '—')),
          h('div.imp-perm', h('span', 'Chiave che cifra i token'), pill(ms.token_key ? 'Impostata' : 'Manca', ms.token_key ? 'gr' : 'rd')),
          h('p.cv-small.cv-muted', 'I permessi si danno e si tolgono nel portale di Entra, non da qui.')))),
    card({ title: 'Altri collegamenti già usati dai moduli', icon: 'link', cls: 'pad' },
      h('div.imp-perm', h('span', h('b', 'OpenAI'), h('span.cv-small.cv-muted', ' · Alma per scritto e a voce, ricerche AI del CRM; i costi sono in «Costi AI»')), pill(d.openai ? 'Funziona' : 'Chiave mancante', d.openai ? 'gr' : 'am')),
      h('div.imp-perm', h('span', h('b', 'ANAC dati aperti'), h('span.cv-small.cv-muted', ' · gare e concorrenza nel CRM')), pill(d.radar_last_run ? `Ultimo giro ${ago(d.radar_last_run)}` : 'Nessun giro ancora', d.radar_last_run ? 'gr' : '')),
      h('div.imp-perm', h('span', h('b', 'Zoho CRM'), h('span.cv-small.cv-muted', ' · importazione da file, in CRM → Impostazioni')), pill('Solo importazione'))));
}

// ── Moduli ─────────────────────────────────────────────────────────────────────────────────────
async function moduli(body) {
  const mod = (href, name, items, moved, tone = 'gr', status = 'attivo') => h('a.cv-card.pad.imp-mod', { href },
    h('div.cv-row', { style: { justifyContent: 'space-between' } }, h('h3.cv-t', name), pill(status, tone)),
    h('ul', items.map(i => h('li', i))), h('div.imp-moved', moved));
  fill(body,
    head('moduli', 'Impostazioni dei', 'moduli', 'Quello che riguarda un solo modulo. Utenti, permessi, costi AI e collegamenti stanno nelle sezioni comuni.'),
    h('div.imp-grid',
      mod('#/alma/impostazioni', 'Alma, l\'assistente', ['Accesa o spenta', 'Proposte e azioni con conferma', 'Voce e modello', 'Risposte con utile e non utile, regole'], 'I tetti di spesa sono in Costi AI.'),
      mod('#/crm/impostazioni', 'Alma CRM', ['Radar: segnali e pesi del punteggio', 'Profili BU, fonti, playbook', 'Regole, esiti, concorrenza', 'ASA e caricamento da Zoho'], 'Chi vede il CRM si decide anche in Privacy e visibilità.'),
      mod('#/mezzi/impostazioni', 'Mezzi', ['Categorie dei mezzi e icone', 'Gestori e chi approva le richieste'], 'Chi vede i Mezzi si decide in Privacy e visibilità.'),
      mod('#/energy/parametri', 'Alma Energy', ['Parametri dei tier e del simulatore', 'Screening per provincia'], 'Chi vede Alma Energy si decide in Privacy e visibilità.'),
      mod('#/notifiche/impostazioni', 'Notifiche', ['Le mie notifiche: campanella, telefono, email'], 'Le scelte sono di ogni persona.', 'or', 'per ognuno')));
}

// Finestra con le azioni come oggetti { label, primary, danger, onClick }: onClick che restituisce false la lascia aperta
// (es. un campo mancante); senza onClick il pulsante chiude.
function dialog({ title, body, actions = [], left = [] }) {
  let m = null;
  const btn = a => {
    const b = h('button.btn', { type: 'button', class: a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : '', on: { click: async () => {
      if (!a.onClick) return m.close();
      b.disabled = true;
      try { if ((await a.onClick()) !== false) m.close(); } finally { b.disabled = false; }
    } } }, a.label);
    return b;
  };
  m = cvModal({ title, body, actions: actions.map(btn), left: left.map(btn) });
  return m;
}

// ── Alma HR in Privacy (tavola I): le regole decise da Dante il 21/11/2026 e chi ha il ruolo «Team HR» ──────────
async function appendHrPrivacy(body) {
  const d = await get('/api/hr/privacy', { quiet: true });
  const Y = () => h('td', { style: { textAlign: 'center', color: 'var(--green)', fontWeight: 700 } }, '✓');
  const N = () => h('td', { style: { textAlign: 'center', color: 'var(--muted)' } }, '—');
  const T = t => h('td.cv-small', { style: { textAlign: 'center' } }, t);
  const rows = [
    ['Griglia salary grade e regole', Y(), Y(), Y(), Y()],
    ['Schede del mansionario', Y(), Y(), Y(), Y()],
    ['Organigramma con ruolo e grade', Y(), Y(), Y(), Y()],
    ['Chi ha quale ruolo e grade', Y(), Y(), T('sé'), N()],
    ['RAL, storico, posizione in fascia', Y(), N(), N(), N()],
    ['Mappatura, costo, registro', Y(), N(), N(), N()],
    ['Modifica mansionario, griglia e pannello', Y(), N(), N(), N()],
  ];
  body.append(h('section.cv-card', { style: { marginTop: '16px' } },
    h('div.cv-ch', h('h3.cv-t', 'Alma HR'), h('span.cv-small.cv-muted', 'Regole fisse, controllate dal server a ogni richiesta')),
    h('div.cv-tblwrap', h('table.cv-tbl', h('thead', h('tr', ['Cosa', 'Team HR', 'Responsabile (suo ramo)', 'Dipendente (sé)', 'Tutti'].map(x => h('th', x)))),
      h('tbody', rows.map(([l, ...c]) => h('tr', h('td', l), ...c))))),
    h('div', { style: { padding: '12px 16px' } },
      h('div.cv-small', h('b', `Chi ha il ruolo «Team HR» (${d.team.length}): `), d.team.length ? d.team.map(t => t.name || t.email).join(', ') : 'nessuno'),
      h('p.cv-small.cv-muted', { style: { margin: '6px 0 0' } }, 'Il ruolo si dà e si toglie in Organigramma e ruoli › Ruoli. Ogni apertura di una RAL e ogni export finiscono nel registro di Alma HR. Gli amministratori senza il ruolo «Team HR» non vedono le RAL.'))));
}
