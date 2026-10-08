// Progetti: griglia raggruppata per macro area, scheda del progetto (tab Panoramica, Gantt, Ticket, Documenti, Cartella OneDrive, Membri), creazione e modifica.
// Ognuno vede solo i progetti di cui è responsabile o membro (lib/access.js lato server).
// Le date del progetto non si scrivono a mano: sono l'arco delle sue attività (ticket con date + attività).
import { h, clear, fill, modal, confirmDialog, promptDialog, toast, fmtDate, avatar, loading, today, isMobile, PROJECT_STATUS, PROJECT_COLORS } from './ui.js';
import { get, post, patch, del } from './api.js';
import { store, loadProjects, loadAreas, projectById, userById, areaById } from './store.js';
import { ticketsView, openTicket } from './tickets.js';
import { peoplePicker, avatarsFor } from './people.js';
import { openChatWithEmails } from './teams.js';
import { driveBrowser, pickDriveItem } from './drive.js';
import { ganttView } from './gantt.js';
import { projectDocuments } from './activities.js';

const dates = p => {
  const s = p.span_start, e = p.span_end;
  if (!s && !e) return 'Nessuna attività';
  return `${fmtDate(s) || '…'} → ${fmtDate(e) || '…'}`;
};
const pct = p => (p.ticket_count ? Math.round((p.done_count / p.ticket_count) * 100) : 0);

const AREA_KEY = 'alma.projectsArea';
const FOLDED_KEY = 'alma.areasFolded';
const readLocal = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeLocal = (k, val) => { try { localStorage.setItem(k, JSON.stringify(val)); } catch { /* niente */ } };

export async function projectsView(container) {
  clear(container).append(loading());
  await Promise.all([loadProjects(), loadAreas()]);
  let showArchived = false;
  let areaFilter = readLocal(AREA_KEY, ''); // '' = tutte, 'none' = senza macro area, altrimenti l'id
  const folded = new Set(readLocal(FOLDED_KEY, []));

  const body = h('div.areas');
  const archivedToggle = h('label.check', h('input', { type: 'checkbox', on: { change: e => { showArchived = e.target.checked; draw(); } } }), 'Mostra archiviati');
  const areaSelect = h('select.select', { 'aria-label': 'Macro area', on: { change: e => { areaFilter = e.target.value; writeLocal(AREA_KEY, areaFilter); draw(); } } });
  const newProject = defaults => editProject(null, async p => { location.hash = `#/projects/${p.id}`; }, defaults);
  clear(container).append(
    h('div.page-head', h('div', h('h1', 'Progetti'), h('div.sub', 'I progetti di cui sei responsabile o membro, raggruppati per macro area: ognuno raccoglie Gantt, ticket, documenti e persone.')),
      h('div.row', areaSelect, archivedToggle,
        h('button.btn', { type: 'button', on: { click: () => manageAreas(draw) } }, 'Macro aree'),
        h('button.btn.btn-primary', { type: 'button', on: { click: () => newProject(areaFilter && areaFilter !== 'none' ? { area_id: Number(areaFilter) } : {}) } }, '+ Nuovo progetto'))),
    body);

  function drawSelect() {
    if (areaFilter && areaFilter !== 'none' && !areaById(Number(areaFilter))) areaFilter = '';
    fill(areaSelect,
      h('option', { value: '' }, 'Tutte le macro aree'),
      store.areas.map(a => h('option', { value: String(a.id), selected: String(a.id) === areaFilter }, a.name)),
      h('option', { value: 'none', selected: areaFilter === 'none' }, 'Senza macro area'));
    areaSelect.hidden = !store.areas.length;
  }

  function card(p) {
    const owner = userById(p.owner_id);
    return h('div.card.proj-card', { style: { '--c': p.color }, on: { click: () => { location.hash = `#/projects/${p.id}`; } } },
      h('div.spread', h('h2', p.name), h('span.pill', PROJECT_STATUS[p.status])),
      p.description ? h('p', p.description) : null,
      h('div', h('div.spread.small.muted', { style: { marginBottom: '5px' } }, h('span', `${p.done_count}/${p.ticket_count} ticket fatti`), h('span', `${pct(p)}%`)),
        h('div.progress', h('i', { style: { width: `${pct(p)}%` } }))),
      h('div.spread.small.muted', h('span', dates(p)), owner ? h('span.row', avatar(owner, 22), owner.name, p.member_count ? ` +${p.member_count}` : '') : null),
      p.my_role === 'member' ? h('span.pill.pj-member', 'Sei membro') : null);
  }

  // Un gruppo per macro area (nell'ordine scelto in «Macro aree»), poi i progetti senza macro area.
  // Il gruppo si chiude e si riapre cliccando il titolo; la scelta resta per le volte dopo.
  function group(key, title, color, list, area) {
    const isFolded = folded.has(key);
    const toggle = () => {
      if (folded.has(key)) folded.delete(key); else folded.add(key);
      writeLocal(FOLDED_KEY, [...folded]);
      draw();
    };
    return h('section.area-group', { class: isFolded ? 'folded' : '', style: { '--ac': color } },
      h('div.area-head',
        h('button.area-title', { type: 'button', 'aria-expanded': String(!isFolded), on: { click: toggle } },
          h('span.area-caret', isFolded ? '▸' : '▾'), h('span.area-dot'), h('h2', title), h('span.area-count', String(list.length))),
        area ? h('button.btn.btn-ghost.btn-sm', { type: 'button', title: `Nuovo progetto in «${area.name}»`, on: { click: () => newProject({ area_id: area.id }) } }, '＋ Progetto') : null),
      isFolded ? null : list.length
        ? h('div.proj-grid', list.map(card))
        : h('div.area-empty.muted.small', 'Nessun progetto in questa macro area.'));
  }

  function draw() {
    drawSelect();
    clear(body);
    const list = store.projects.filter(p => showArchived || p.status !== 'archived');
    if (!store.areas.length) {
      // senza macro aree: la griglia di sempre, con l'invito a crearle
      if (!list.length) return body.append(h('div.card.empty', 'Ancora nessun progetto.'));
      return body.append(
        h('div.area-hint.small.muted', 'Puoi raggruppare i progetti in macro aree (es. Clienti, Marketing, Interni): ',
          h('button.btn-link', { type: 'button', on: { click: () => manageAreas(draw) } }, 'crea la prima macro area'), '.'),
        h('div.proj-grid', list.map(card)));
    }
    const shown = store.areas.filter(a => !areaFilter || String(a.id) === areaFilter);
    for (const a of shown) body.append(group(`a${a.id}`, a.name, a.color, list.filter(p => p.area_id === a.id), a));
    const loose = list.filter(p => !p.area_id || !areaById(p.area_id));
    if ((!areaFilter && loose.length) || areaFilter === 'none') body.append(group('none', 'Senza macro area', 'var(--muted)', loose, null));
  }
  draw();
}

// ── Macro aree: crea, rinomina, colore, ordine, cancella ─────────────────────
export function manageAreas(onChange) {
  const list = h('div.area-list');
  const m = modal({
    title: 'Macro aree',
    body: [h('p.muted.small', { style: { margin: 0 } }, 'Le macro aree raggruppano i progetti nella pagina Progetti e nel Gantt. Le vedono tutti; ognuno ci trova solo i progetti a cui partecipa. Le cambia chi le ha create (e gli amministratori).'), list],
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi'),
      h('button.btn.btn-primary', { type: 'button', on: { click: add } }, '＋ Nuova macro area'),
    ],
    onClose: () => onChange?.(),
  });
  draw();

  async function reload() { await Promise.all([loadAreas(), loadProjects()]); draw(); }

  function draw() {
    if (!store.areas.length) return fill(list, h('div.empty', 'Ancora nessuna macro area.'));
    const n = store.areas.length;
    fill(list, store.areas.map((a, i) => h('div.area-row', { style: { '--ac': a.color } },
      a.can_edit
        ? h('button.area-dot.area-dot-btn', { type: 'button', title: 'Cambia colore', on: { click: () => recolor(a) } })
        : h('span.area-dot'),
      h('span.grow', h('strong', a.name), h('span.muted.small', `  ·  ${a.project_count} ${a.project_count === 1 ? 'progetto' : 'progetti'}`)),
      a.can_edit ? h('div.row-actions',
        h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Sposta su', disabled: i === 0, on: { click: () => move(i, -1) } }, '↑'),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Sposta giù', disabled: i === n - 1, on: { click: () => move(i, 1) } }, '↓'),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => rename(a) } }, 'Rinomina'),
        h('button.btn.btn-ghost.btn-sm.btn-danger', { type: 'button', on: { click: () => remove(a) } }, 'Cancella')) : null)));
  }

  async function add() {
    if (await createArea()) await reload();
  }
  async function rename(a) {
    const name = await promptDialog('Rinomina la macro area', { label: 'Nome', value: a.name });
    if (!name || name === a.name) return;
    await patch(`/api/areas/${a.id}`, { name });
    await reload();
  }
  async function recolor(a) {
    const next = PROJECT_COLORS[(PROJECT_COLORS.indexOf(a.color) + 1) % PROJECT_COLORS.length];
    await patch(`/api/areas/${a.id}`, { color: next });
    await reload();
  }
  // l'ordine si salva riscrivendo la posizione di quelle che cambiano posto (sono poche)
  async function move(i, dir) {
    const order = store.areas.slice();
    [order[i], order[i + dir]] = [order[i + dir], order[i]];
    await Promise.all(order.map((a, pos) => (a.can_edit && a.position !== pos ? patch(`/api/areas/${a.id}`, { position: pos }) : null)));
    await reload();
  }
  async function remove(a) {
    const msg = a.project_count
      ? `Cancellare la macro area «${a.name}»? I suoi progetti restano, senza macro area.`
      : `Cancellare la macro area «${a.name}»?`;
    if (!await confirmDialog(msg, { ok: 'Cancella', danger: true })) return;
    await del(`/api/areas/${a.id}`);
    toast('Macro area cancellata');
    await reload();
  }
}

// Chiede il nome e crea la macro area; restituisce { id, name } o null.
async function createArea() {
  const name = await promptDialog('Nuova macro area', { label: 'Nome (es. Clienti, Marketing, Interni)', ok: 'Crea' });
  if (!name) return null;
  const color = PROJECT_COLORS[(store.areas.length + 1) % PROJECT_COLORS.length];
  const r = await post('/api/areas', { name, color });
  await loadAreas();
  toast(`Macro area «${name}» creata`);
  return { id: r.id, name };
}

// ── scheda del progetto: intestazione, fatti, tab laterali (come la scheda opportunità di BOSS) ──────────
const TABS = [
  ['panoramica', 'Panoramica'],
  ['gantt', 'Gantt'],
  ['ticket', 'Ticket'],
  ['documenti', 'Documenti'],
  ['cartella', 'Cartella OneDrive'],
  ['membri', 'Membri'],
];
const canManage = p => p.my_role === 'owner' || p.my_role === 'admin';

export async function projectDetail(container, id) {
  clear(container).append(loading());
  await Promise.all([loadProjects(), loadAreas()]);
  const p = projectById(id);
  const area = areaById(p?.area_id);
  if (!p) return clear(container).append(h('div.card.empty', 'Progetto non trovato, oppure non sei tra i suoi membri. ', h('a', { href: '#/projects' }, 'Torna ai progetti')));
  const owner = userById(p.owner_id);
  const tabFromHash = () => {
    const t = location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[2];
    return TABS.some(([k]) => k === t) ? t : 'panoramica';
  };
  let tab = tabFromHash();
  let cleanupTab = null;

  // intestazione
  const open = p.ticket_count - p.done_count;
  const head = h('header.pj-head', { style: { '--c': p.color } },
    h('div.pj-top', h('a.pj-crumb', { href: '#/projects' }, '← Progetti'), h('span.pj-crumb-sep', '›'),
      area ? [h('span.pj-crumb.pj-area', { style: { '--ac': area.color } }, h('span.area-dot'), area.name), h('span.pj-crumb-sep', '›')] : null, h('span.pj-crumb-cur', p.name)),
    h('div.pj-row',
      h('div.pj-title',
        h('h1', h('span.pj-swatch'), p.name),
        h('div.pj-meta',
          h('span.pill', { class: `pj-st-${p.status}` }, h('span.dot'), PROJECT_STATUS[p.status]),
          h('span', [owner ? `Responsabile ${owner.name}` : 'Senza responsabile', `${p.member_count + 1} ${p.member_count ? 'persone' : 'persona'}`,
            p.my_role === 'member' ? 'sei membro' : p.my_role === 'admin' ? 'vedi come amministratore' : null].filter(Boolean).join('  ·  ')))),
      h('div.pj-actions',
        h('button.btn', { type: 'button', on: { click: () => openTicket(null, { defaults: { project_id: p.id, assignee_ids: [store.me.id] }, onSaved: () => show(tab) }) } }, '＋ Ticket'),
        canManage(p) ? h('button.btn', { type: 'button', on: { click: () => editProject(p, () => projectDetail(container, id)) } }, 'Modifica') : null)),
    h('div.pj-facts',
      fact('Stato', PROJECT_STATUS[p.status]),
      fact('Durata', dates(p)),
      fact('Avanzamento', `${pct(p)} %`, h('div.progress', h('i', { style: { width: `${pct(p)}%` } }))),
      fact('Ticket aperti', `${open} di ${p.ticket_count}`),
      fact('Responsabile', owner ? h('span.row', avatar(owner, 22), owner.name) : h('span.muted', 'Non assegnato'))));

  // tab laterali (sul telefono diventano una barra scorrevole in alto)
  const nav = h('nav.pj-nav', TABS.map(([k, label]) => h('button.pj-tab', {
    type: 'button', 'data-k': k, class: k === tab ? 'on' : '',
    on: { click: () => show(k) },
  }, k === 'gantt' && isMobile() ? 'Attività' : label, counter(k))));
  const content = h('div.pj-content');
  clear(container).append(h('div.pj', head, h('div.pj-body', nav, content)));
  show(tab);

  function counter(k) {
    const n = k === 'ticket' ? open : k === 'membri' ? p.member_count + 1 : null;
    return n ? h('span.pj-count', String(n)) : null;
  }
  function fact(label, value, extra) {
    return h('div.pj-fact', h('span.pj-fact-label', label), h('span.pj-fact-value', value), extra || null);
  }

  // Ogni tab si disegna quando lo si apre, quindi mostra sempre dati aggiornati.
  function show(k) {
    tab = k;
    history.replaceState(null, '', `#/projects/${p.id}/${k}`);
    nav.querySelectorAll('.pj-tab').forEach(b => b.classList.toggle('on', b.dataset.k === k));
    cleanupTab?.();
    cleanupTab = null;
    const box = h('div.pj-pane');
    clear(content).append(box);
    if (k === 'panoramica') overview(box);
    else if (k === 'gantt') {
      if (isMobile()) timeline(box, p, () => {});
      else ganttView(box, new URLSearchParams({ project: String(p.id) }), { embedded: true });
    } else if (k === 'ticket') ticketsView(box, { fixed: { project: String(p.id) }, view: isMobile() ? 'list' : 'board' });
    else if (k === 'documenti') projectDocuments(box, p.id);
    else if (k === 'cartella') folder(box);
    else if (k === 'membri') members(box);
  }

  // ── Panoramica: tutto il progetto in una pagina (riepilogo, Gantt, ticket, documenti, cartella);
  // i tab a sinistra sono scorciatoie alle viste dedicate ──────────────────────────────────────────
  async function overview(box) {
    const desc = h('section.card.pj-card', h('h3', 'Descrizione'),
      p.description ? h('p.pj-desc', p.description) : h('p.muted', canManage(p) ? 'Nessuna descrizione. Aggiungila con «Modifica».' : 'Nessuna descrizione.'));
    const due = h('section.card.pj-card', h('div.spread', h('h3', 'Prossime scadenze'), h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => show('ticket') } }, 'Tutti i ticket →')), loading());
    const ppl = h('section.card.pj-card', h('div.spread', h('h3', 'Persone'), h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => show('membri') } }, canManage(p) ? 'Gestisci →' : 'Vedi →')), loading());
    box.append(h('div.pj-grid', desc, ppl), due);

    // le sezioni di sempre, una sotto l'altra, ognuna con il collegamento al suo tab
    const section = (k, title, fill) => {
      const body = h('div');
      box.append(h('section.pj-section', { id: `pj-${k}` },
        h('div.spread', h('h2', title), h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => show(k) } }, 'Apri →')),
        body));
      fill(body);
    };
    section('gantt', isMobile() ? 'Attività' : 'Gantt', b => (isMobile() ? timeline(b, p, () => {}) : ganttView(b, new URLSearchParams({ project: String(p.id) }), { embedded: true })));
    section('ticket', 'Ticket', b => ticketsView(b, { fixed: { project: String(p.id) }, view: isMobile() ? 'list' : 'board' }));
    section('documenti', 'Documenti', b => projectDocuments(b, p.id));
    section('cartella', 'Cartella OneDrive', b => folder(b, { titled: false }));

    const [tickets, team] = await Promise.all([get(`/api/tickets?project=${p.id}&status=open`), get(`/api/projects/${p.id}/members`)]);
    const late = t => t.due_date && t.due_date < today();
    const upcoming = tickets.filter(t => t.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 6);
    due.lastChild.replaceWith(upcoming.length
      ? h('div.pj-list', upcoming.map(t => h('button.pj-line', { type: 'button', on: { click: () => openTicket(t.id, { onSaved: () => show('panoramica') }) } },
        h('span.grow', t.title), avatarsFor(t.assignee_ids, 3), h('span', { class: late(t) ? 'due-late' : 'muted' }, late(t) ? `scaduto ${fmtDate(t.due_date)}` : fmtDate(t.due_date)))))
      : h('p.muted', 'Nessun ticket aperto con scadenza.'));
    ppl.lastChild.replaceWith(h('div.pj-people', team.map(m => h('span.pj-person', { title: `${m.name}${m.owner ? ' · responsabile' : ''}` },
      avatar(m, 30), h('span', h('strong', m.name.split(' ')[0]), h('small', m.owner ? 'Responsabile' : `${m.open_tickets} aperti`))))));
  }

  // ── Cartella OneDrive del progetto ───────────────────────────────────────────
  function folder(box, { titled = true } = {}) {
    const action = store.me.microsoft ? h('button.btn.btn-sm', { type: 'button', on: { click: linkFolder } }, p.onedrive_item_id ? 'Cambia cartella' : 'Collega una cartella') : null;
    box.append(titled ? h('div.spread', h('h3', 'Cartella OneDrive'), action) : h('div.row', action));
    if (!store.me.microsoft) return box.append(h('div.card.empty', 'OneDrive non è ancora collegato.'));
    if (!p.onedrive_item_id) return box.append(h('div.card.empty', 'Nessuna cartella collegata. Collegane una (meglio se condivisa con il team) per avere qui i documenti del progetto.'));
    box.append(h('div.small.muted', { style: { margin: '6px 0 10px' } }, h('a', { href: p.onedrive_url, target: '_blank', rel: 'noopener' }, `Apri «${p.onedrive_name}» in OneDrive ↗`)));
    const inner = h('div');
    box.append(inner);
    driveBrowser(inner, { root: { driveId: p.onedrive_drive_id, id: p.onedrive_item_id, name: p.onedrive_name }, tabs: false });
  }

  async function linkFolder() {
    const f = await pickDriveItem({ title: 'Scegli la cartella del progetto', folders: true });
    if (!f) return;
    await patch(`/api/projects/${p.id}`, { onedrive_drive_id: f.driveId, onedrive_item_id: f.id, onedrive_name: f.name, onedrive_url: f.webUrl || null });
    toast('Cartella collegata');
    projectDetail(container, id);
  }

  // ── Membri: chi vede e lavora al progetto ────────────────────────────────────
  async function members(box) {
    const list = h('div.card.table-wrap', loading());
    box.append(
      h('div.spread', h('div', h('h3', 'Membri'), h('p.muted.small', { style: { margin: '2px 0 0' } },
        'Il progetto e i suoi ticket li vedono solo queste persone (e gli amministratori). Chi viene assegnato a un ticket del progetto entra da solo.')),
      canManage(p) ? h('button.btn.btn-primary', { type: 'button', on: { click: addPeople } }, '＋ Aggiungi persone') : null),
      list);
    await draw();

    async function draw() {
      const team = await get(`/api/projects/${p.id}/members`);
      fill(list, h('table.list',
        h('thead', h('tr', h('th', 'Persona'), h('th', 'Ruolo'), h('th', 'Ticket aperti'), h('th', 'Aggiunto'), h('th', ''))),
        h('tbody', team.map(m => h('tr', { style: { cursor: 'default' } },
          h('td', h('div.row', avatar(m, 30), h('div', h('div.t-title', m.name), h('div.t-meta', m.job_title || m.email)))),
          h('td', m.owner ? h('span.pill.st-review', 'Responsabile') : h('span.pill', 'Membro'), !m.active ? h('span.muted.small', ' · non ancora entrato') : null),
          h('td', String(m.open_tickets)),
          h('td.muted.small', m.owner ? '—' : [m.added_at ? fmtDate(m.added_at.slice(0, 10)) : null, m.added_by_name ? `da ${m.added_by_name}` : null].filter(Boolean).join(' ')),
          h('td', h('div.row-actions',
            m.id !== store.me.id && store.me.microsoft ? h('button.btn.btn-ghost.btn-sm', { type: 'button', title: `Chat con ${m.name}`, on: { click: () => openChatWithEmails([m.email]) } }, '💬') : null,
            !m.owner && m.id === store.me.id ? h('button.btn.btn-sm', { type: 'button', on: { click: () => remove(m, true) } }, 'Esci dal progetto') : null,
            !m.owner && m.id !== store.me.id && canManage(p) ? h('button.btn.btn-ghost.btn-sm.btn-danger', { type: 'button', title: 'Togli dal progetto', on: { click: () => remove(m, false) } }, 'Togli') : null)))))));
    }

    async function remove(m, self) {
      const msg = self
        ? `Uscire dal progetto «${p.name}»? Non lo vedrai più, tranne i ticket assegnati a te.`
        : `Togliere ${m.name} dal progetto? Non lo vedrà più, tranne i ticket assegnati a lui o a lei.`;
      if (!await confirmDialog(msg, { ok: self ? 'Esci' : 'Togli', danger: true })) return;
      await del(`/api/projects/${p.id}/members/${m.id}`);
      if (self) { await loadProjects(); location.hash = '#/projects'; return; }
      toast(`${m.name} non è più nel progetto`);
      projectDetail(container, id); // ricarica anche intestazione e contatori
    }

    function addPeople() {
      const picker = peoplePicker({ selected: [], label: '＋ Scegli' });
      const md = modal({
        title: `Aggiungi persone a «${p.name}»`,
        body: [h('p.muted.small', { style: { margin: 0 } }, 'Puoi scegliere anche colleghi che non sono ancora entrati in Alma Planner: cercali per nome nella rubrica.'), picker.el],
        actions: [
          h('button.btn', { type: 'button', on: { click: () => md.close() } }, 'Annulla'),
          h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
            if (!picker.value.length) return toast('Scegli almeno una persona', 'err');
            await post(`/api/projects/${p.id}/members`, { user_ids: picker.value });
            md.close();
            toast(picker.value.length === 1 ? 'Persona aggiunta al progetto' : `${picker.value.length} persone aggiunte al progetto`);
            projectDetail(container, id); // ricarica anche intestazione e contatori
          } } }, 'Aggiungi'),
        ],
      });
    }
  }

  return () => cleanupTab?.();
}

// Attività del progetto (ticket con date) come barre su un'unica scala, con la riga di oggi. Un tocco apre il ticket.
function timeline(box, p, onChange) {
  const day = iso => new Date(`${iso}T12:00:00`).getTime();
  async function reload() {
    fill(box, loading());
    const list = (await get(`/api/tickets?project=${p.id}`)).filter(t => t.start_date || t.due_date);
    if (!list.length) return fill(box, h('div.card.empty', 'Nessuna attività con date. Le attività sono i ticket del progetto con inizio e scadenza.'));
    for (const t of list) { t._s = t.start_date || t.due_date; t._e = t.due_date || t.start_date; }
    list.sort((a, b) => a._s.localeCompare(b._s) || a._e.localeCompare(b._e));
    const min = day(list.reduce((m, t) => (t._s < m ? t._s : m), list[0]._s));
    const max = day(list.reduce((m, t) => (t._e > m ? t._e : m), list[0]._e)) + 86400000;
    const span = Math.max(max - min, 86400000);
    const pos = ms => `${Math.min(100, Math.max(0, ((ms - min) / span) * 100))}%`;
    const now = day(today());
    const label = t => (t._s === t._e ? fmtDate(t._s) : `${fmtDate(t._s)} – ${fmtDate(t._e)}`);
    fill(box, h('div.card.m-timeline', { style: { '--c': p.color } },
      h('div.m-tl-axis', h('span', fmtDate(list[0]._s)), h('span', fmtDate(new Date(max - 86400000).toISOString().slice(0, 10)))),
      h('div.m-tl-rows',
        now >= min && now <= max ? h('span.m-tl-today', { style: { left: pos(now) }, title: 'Oggi' }) : null,
        list.map(t => h('button.m-tl-row', { type: 'button', class: t.status === 'done' ? 'done' : '', on: { click: () => openTicket(t.id, { onSaved: () => { reload(); onChange(); } }) } },
          h('span.m-tl-top', h('strong', t.title), h('span', label(t))),
          h('span.m-tl-track', h('span.m-tl-bar', { style: { left: pos(day(t._s)), width: `calc(${pos(day(t._e) + 86400000)} - ${pos(day(t._s))})` } }))))),
      now >= min && now <= max ? h('p.m-tl-note', 'La riga arancione è oggi. Tocca un\'attività per aprirla.') : null));
  }
  reload();
  return { reload };
}

export function editProject(p, onSaved, defaults = {}) {
  const isNew = !p;
  p = p || { name: '', description: '', color: PROJECT_COLORS[store.projects.length % PROJECT_COLORS.length], status: 'active', owner_id: store.me.id, area_id: null, ...defaults };
  let color = p.color;
  const name = h('input.input', { value: p.name, autofocus: true, placeholder: 'Es. Sito nuovo Almacis' });
  const desc = h('textarea.input', { rows: 3 }, p.description);
  const status = h('select.select', Object.entries(PROJECT_STATUS).map(([k, l]) => h('option', { value: k, selected: k === p.status }, l)));
  const owner = h('select.select', h('option', { value: '' }, '—'), store.users.map(u => h('option', { value: String(u.id), selected: u.id === p.owner_id }, u.name)));
  const area = h('select.select');
  const drawAreas = selected => fill(area, h('option', { value: '' }, 'Nessuna'), store.areas.map(a => h('option', { value: String(a.id), selected: a.id === selected }, a.name)));
  drawAreas(p.area_id);
  loadAreas().then(() => drawAreas(area.value ? Number(area.value) : p.area_id)).catch(() => {});
  let creatingArea = false; // un secondo clic (o Invio sul pulsante) non apre un'altra finestra
  const newArea = h('button.btn.btn-sm', { type: 'button', title: 'Crea una nuova macro area', on: { click: async () => {
    if (creatingArea) return;
    creatingArea = true;
    try { const a = await createArea(); if (a) drawAreas(a.id); } finally { creatingArea = false; }
  } } }, '＋ Nuova');
  // in un progetto nuovo si possono invitare subito le persone (poi dal tab Membri)
  const invite = isNew ? peoplePicker({ selected: [], label: '＋ Persona' }) : null;
  const swatches = h('div.swatches', PROJECT_COLORS.map(c => h('button.swatch', { type: 'button', title: c, class: c === color ? 'on' : '', style: { background: c }, on: { click: e => {
    color = c; swatches.querySelectorAll('.swatch').forEach(s => s.classList.remove('on')); e.currentTarget.classList.add('on');
  } } })));

  const left = isNew ? [] : [h('button.btn.btn-danger', { type: 'button', on: { click: async () => {
    if (!await confirmDialog(`Cancellare il progetto «${p.name}»? I suoi ticket restano, senza progetto.`, { ok: 'Cancella', danger: true })) return;
    await del(`/api/projects/${p.id}`);
    m.close();
    await loadProjects();
    toast('Progetto cancellato');
    location.hash = '#/projects';
  } } }, 'Cancella')];

  const m = modal({
    title: isNew ? 'Nuovo progetto' : 'Modifica progetto',
    body: [
      h('label.field', h('span', 'Nome'), name),
      h('label.field', h('span', 'Descrizione'), desc),
      h('div.grid-2',
        h('label.field', h('span', 'Stato'), status),
        h('label.field', h('span', 'Responsabile'), owner)),
      h('div.field', h('span', 'Macro area'), h('div.row.area-pick', area, newArea)),
      h('div.field', h('span', 'Colore'), swatches),
      invite ? h('div.field', h('span', 'Membri'), invite.el, h('small.muted', 'Solo il responsabile, i membri e gli amministratori vedono il progetto e i suoi ticket.')) : null,
      h('div.muted.small', 'La durata del progetto la danno le sue attività nel Gantt.'),
    ],
    left,
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: save } }, isNew ? 'Crea progetto' : 'Salva'),
    ],
  });

  async function save() {
    if (!name.value.trim()) { toast('Scrivi un nome', 'err'); return; }
    const payload = {
      name: name.value, description: desc.value, color, status: status.value,
      owner_id: owner.value ? Number(owner.value) : null,
      area_id: area.value ? Number(area.value) : null,
    };
    const r = isNew ? await post('/api/projects', payload) : await patch(`/api/projects/${p.id}`, payload);
    if (isNew && invite.value.length) await post(`/api/projects/${r.id}/members`, { user_ids: invite.value });
    m.close();
    await loadProjects();
    toast(isNew ? 'Progetto creato' : 'Progetto salvato');
    onSaved?.({ id: isNew ? r.id : p.id });
  }
}
