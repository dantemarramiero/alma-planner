// Organigramma da Microsoft 365: albero per responsabile, vista per reparto, ricerca, scheda della persona.
import { h, clear, modal, toast, avatar, loading, fmtDateTime, debounce } from './ui.js';
import { get, post } from './api.js';
import { store } from './store.js';

const VIEW_KEY = 'alma.orgView';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) || 'tree'; } catch { return 'tree'; } };
const teamsChat = email => `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(email)}`;

export async function orgView(container) {
  let data = { people: [], sync: null };
  let view = readView();
  let q = '';
  let dept = '';
  const collapsed = new Set();

  const sub = h('div.sub');
  const syncBtn = h('button.btn.btn-primary', { type: 'button', on: { click: sync } }, '↻ Aggiorna da Microsoft');
  const search = h('input.input', { type: 'search', placeholder: 'Cerca persona, ruolo, reparto…', on: { input: debounce(e => { q = e.target.value.trim().toLowerCase(); draw(); }, 200) } });
  const deptSelect = h('select.select', { 'aria-label': 'Reparto', on: { change: e => { dept = e.target.value; draw(); } } });
  const viewSeg = h('div.seg', [['tree', 'Albero'], ['dept', 'Per reparto']].map(([k, l]) => h('button', {
    type: 'button', 'data-k': k, class: k === view ? 'on' : '',
    on: { click: () => {
      view = k;
      try { localStorage.setItem(VIEW_KEY, k); } catch { /* niente */ }
      viewSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
      draw();
    } },
  }, l)));
  const body = h('div');

  clear(container).append(
    h('div.page-head', h('div', h('h1', 'Organigramma'), sub), syncBtn),
    h('div.toolbar', search, deptSelect, h('span.grow'), viewSeg),
    body);

  await load();

  async function load() {
    body.replaceChildren(loading());
    data = await get('/api/org');
    const depts = [...new Set(data.people.map(p => p.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
    clear(deptSelect).append(h('option', { value: '' }, 'Tutti i reparti'), depts.map(d => h('option', { value: d, selected: d === dept }, d)));
    const s = data.sync;
    sub.textContent = s
      ? `${s.people} persone da Microsoft 365 · aggiornato ${fmtDateTime(s.synced_at)}${s.synced_by_name ? ` da ${s.synced_by_name}` : ''}`
      : 'Le persone, i ruoli e i responsabili arrivano da Microsoft 365.';
    draw();
  }

  async function sync() {
    if (!store.me.microsoft) return toast('Microsoft 365 non è ancora collegato', 'err');
    syncBtn.disabled = true;
    syncBtn.textContent = 'Lettura da Microsoft…';
    try {
      const r = await post('/api/org/sync', {}, { quiet: true });
      toast(`Organigramma aggiornato: ${r.people} persone, ${r.with_manager} con responsabile`);
      await load();
    } catch (err) {
      if (err.code === 'org_permission') {
        body.replaceChildren(h('div.banner', 'Microsoft non concede ancora la lettura dell\'organigramma. Un amministratore deve aggiungere il permesso «User.Read.All» all\'app Alma Planner in Entra e dare il consenso; poi esci e rientra.'));
      } else toast(err.message, 'err');
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = '↻ Aggiorna da Microsoft';
    }
  }

  // ── filtri ─────────────────────────────────────────────────────────────────
  const matches = p => !q || [p.name, p.email, p.job_title, p.department, p.office].some(x => x && x.toLowerCase().includes(q));
  const inDept = p => !dept || p.department === dept;

  function draw() {
    clear(body);
    if (!data.people.length) {
      body.append(h('div.card.empty', 'L\'organigramma è vuoto. ', h('a', { href: '#', on: { click: e => { e.preventDefault(); sync(); } } }, 'Leggilo da Microsoft 365'), '.'));
      return;
    }
    if (q) return drawList(data.people.filter(p => matches(p) && inDept(p)), 'Nessuna persona trovata.');
    if (view === 'dept') return drawDepartments();
    if (dept) return drawList(data.people.filter(inDept), 'Nessuna persona in questo reparto.');
    drawTree();
  }

  const byOid = () => new Map(data.people.map(p => [p.oid, p]));
  function reportsOf() {
    const map = new Map();
    for (const p of data.people) {
      if (!p.manager_oid) continue;
      if (!map.has(p.manager_oid)) map.set(p.manager_oid, []);
      map.get(p.manager_oid).push(p);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'it'));
    return map;
  }

  // Albero: in cima chi non ha responsabile ma ha collaboratori; chi non ha né l'uno né gli altri va in fondo.
  function drawTree() {
    const reports = reportsOf();
    const roots = data.people.filter(p => !p.manager_oid && reports.has(p.oid));
    const loose = data.people.filter(p => !p.manager_oid && !reports.has(p.oid));
    const withManager = data.people.length - roots.length - loose.length;
    if (!withManager) {
      body.append(h('div.banner', 'In Microsoft 365 nessuno ha il campo «Responsabile» compilato, quindi l\'albero è piatto. Si compila in Entra (Utenti → persona → Proprietà → Responsabile); intanto puoi usare la vista «Per reparto».'));
    }
    const tree = h('ul.org-tree');
    const node = (p, depth) => {
      const kids = reports.get(p.oid) || [];
      const isCollapsed = collapsed.has(p.oid) || (depth >= 2 && !collapsed.has(`open:${p.oid}`));
      const li = h('li', h('div.org-row',
        kids.length ? h('button.org-toggle', { type: 'button', title: isCollapsed ? 'Apri' : 'Chiudi', on: { click: () => {
          if (isCollapsed) { collapsed.delete(p.oid); collapsed.add(`open:${p.oid}`); } else { collapsed.add(p.oid); collapsed.delete(`open:${p.oid}`); }
          draw();
        } } }, isCollapsed ? `▸ ${kids.length}` : '▾') : h('span.org-toggle.org-leaf'),
        card(p)));
      if (kids.length && !isCollapsed) li.append(h('ul', kids.map(k => node(k, depth + 1))));
      return li;
    };
    roots.sort((a, b) => (reports.get(b.oid)?.length || 0) - (reports.get(a.oid)?.length || 0));
    tree.append(...roots.map(r => node(r, 0)));
    body.append(h('div.card.org-card', tree));
    if (loose.length) {
      body.append(h('div.section', h('div.spread', h('h2', `Senza responsabile indicato (${loose.length})`)),
        h('div.org-grid', loose.map(card))));
    }
  }

  function drawDepartments() {
    const groups = new Map();
    for (const p of data.people.filter(inDept)) {
      const k = p.department || 'Senza reparto';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    const names = [...groups.keys()].sort((a, b) => (a === 'Senza reparto') - (b === 'Senza reparto') || a.localeCompare(b, 'it'));
    for (const n of names) {
      body.append(h('div.section', h('div.spread', h('h2', `${n} (${groups.get(n).length})`)), h('div.org-grid', groups.get(n).map(card))));
    }
  }

  function drawList(list, empty) {
    if (!list.length) return body.append(h('div.card.empty', empty));
    const people = byOid();
    body.append(h('div.org-grid', list.map(p => card(p, { manager: people.get(p.manager_oid) }))));
  }

  function card(p, { manager } = {}) {
    return h('button.org-person', { type: 'button', on: { click: () => openPerson(p) } },
      avatar(p, 34),
      h('span.org-info',
        h('span.org-name', p.name),
        h('span.org-role', p.job_title || '—'),
        h('span.org-meta', [p.department, p.office].filter(Boolean).join(' · ')),
        manager ? h('span.org-meta', `Responsabile: ${manager.name}`) : null),
      p.open_tickets ? h('span.pill.st-doing', { title: 'Ticket aperti assegnati' }, String(p.open_tickets)) : null);
  }

  function openPerson(p) {
    const people = byOid();
    const reports = reportsOf().get(p.oid) || [];
    const manager = people.get(p.manager_oid);
    const chain = [];
    for (let m = manager; m && chain.length < 10; m = people.get(m.manager_oid)) chain.unshift(m);
    const link = x => h('a', { href: '#', on: { click: e => { e.preventDefault(); md.close(); openPerson(x); } } }, x.name);
    const md = modal({
      title: h('span.row', avatar(p, 32), p.name),
      body: [
        h('div', h('strong', p.job_title || 'Ruolo non indicato'), p.department ? ` · ${p.department}` : '', p.office ? ` · ${p.office}` : ''),
        p.email ? h('div.row', h('a', { href: `mailto:${p.email}` }, p.email), h('a.btn.btn-sm', { href: teamsChat(p.email), target: '_blank', rel: 'noopener' }, 'Chat su Teams')) : null,
        chain.length ? h('div.field', h('span', 'Linea di riporto'), h('div.small', ...chain.flatMap((m, i) => [i ? ' › ' : '', link(m)]))) : h('div.muted.small', 'Nessun responsabile indicato in Microsoft 365.'),
        reports.length ? h('div.field', h('span', `Collaboratori diretti (${reports.length})`), h('div.org-grid', reports.map(r => h('div', link(r), r.job_title ? h('div.muted.small', r.job_title) : null)))) : null,
        p.user_id ? h('div.muted.small', p.open_tickets ? `${p.open_tickets} ticket aperti in Alma Planner.` : 'Nessun ticket aperto in Alma Planner.') : h('div.muted.small', 'Non è ancora entrato in Alma Planner.'),
      ],
      actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => md.close() } }, 'Chiudi')],
    });
  }
}
