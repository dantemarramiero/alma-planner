// Progetti: griglia raggruppata nelle macro aree personali (ognuno ha le sue), scheda del progetto (tab Panoramica, Gantt, Ticket, Documenti, Email, Note, Membri), creazione e modifica.
// Ognuno vede solo i progetti di cui è responsabile o membro (lib/access.js lato server).
// Le date del progetto non si scrivono a mano: sono l'arco delle sue attività (ticket con date + attività).
import { h, clear, fill, modal, confirmDialog, promptDialog, toast, fmtDate, avatar, loading, today, isMobile, PROJECT_STATUS, PROJECT_COLORS } from './ui.js';
import { icon } from './icons.js';
import { get, post, put, patch, del } from './api.js';
import { store, loadProjects, loadAreas, projectById, userById, areaById } from './store.js';
import { ticketsView, openTicket } from './tickets.js';
import { peoplePicker, avatarsFor } from './people.js';
import { openChatWithEmails } from './teams.js';
import { ganttView, ganttPhone } from './gantt.js';
import { projectDocuments } from './activities.js';
import { projectEmails } from './project-emails.js';
import { projectMeetings, openMeeting, meetingWhen } from './project-meetings.js';
import { notesPanel } from './notes.js';

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
    h('div.page-head', h('div', h('h1', 'Progetti'), h('div.sub', 'I progetti di cui sei responsabile o membro, raggruppati nelle tue macro aree: ognuno raccoglie Gantt, ticket, documenti e persone.')),
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
    // i progetti delle opportunità di Alma Energy si aprono da Alma Energy (ALM2-24)
    const list = store.projects.filter(p => !p.energy && (showArchived || p.status !== 'archived'));
    if (!store.areas.length) {
      // senza macro aree: la griglia di sempre, con l'invito a crearle
      if (!list.length) return body.append(h('div.card.empty', 'Ancora nessun progetto.'));
      return body.append(
        h('div.area-hint.small.muted', 'Puoi raggruppare i progetti nelle tue macro aree (es. Clienti, Marketing, Interni); sono solo tue, gli altri non le vedono: ',
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
    body: [h('p.muted.small', { style: { margin: 0 } }, 'Le macro aree raggruppano i progetti nella pagina Progetti e nel Gantt. Sono solo tue: ognuno si fa le sue, e mettere un progetto in una macro area non cambia niente per gli altri.'), list],
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
      h('button.area-dot.area-dot-btn', { type: 'button', title: 'Cambia colore', on: { click: () => recolor(a) } }),
      h('span.grow', h('strong', a.name), h('span.muted.small', `  ·  ${a.project_count} ${a.project_count === 1 ? 'progetto' : 'progetti'}`)),
      h('div.row-actions',
        h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Sposta su', disabled: i === 0, on: { click: () => move(i, -1) } }, '↑'),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Sposta giù', disabled: i === n - 1, on: { click: () => move(i, 1) } }, '↓'),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => rename(a) } }, 'Rinomina'),
        h('button.btn.btn-ghost.btn-sm.btn-danger', { type: 'button', on: { click: () => remove(a) } }, 'Cancella')))));
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
    await Promise.all(order.map((a, pos) => (a.position !== pos ? patch(`/api/areas/${a.id}`, { position: pos }) : null)));
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

// ── scheda del progetto: intestazione con quattro numeri, tab in orizzontale, Panoramica riassuntiva ──────────
const TABS = [
  ['panoramica', 'Panoramica'],
  ['gantt', 'Gantt'],
  ['ticket', 'Ticket'],
  ['documenti', 'Documenti'],
  ['email', 'Email'],
  ['incontri', 'Incontri'],
  ['note', 'Note'],
  ['membri', 'Membri'],
];
const canManage = p => p.my_role === 'owner' || p.my_role === 'admin';

// opts (pagina dell'opportunità di Alma Energy, ALM2-24): base dell'indirizzo dei tab, percorso, riga in più
// nell'intestazione (lo stadio), azioni al posto di «Modifica» e tab in più dopo la Panoramica: [chiave, etichetta, disegna].
export async function projectDetail(container, id, opts = {}) {
  clear(container).append(loading());
  await Promise.all([loadProjects(), loadAreas()]);
  // il progetto di un A3 lo vedono tutti (in sola lettura) anche se non è nel proprio elenco
  const p = projectById(id) || (opts.base ? await get(`/api/projects/${id}`, { quiet: true }).catch(() => null) : null);
  const viewer = p?.my_role === 'viewer';
  const area = areaById(p?.area_id);
  if (!p) return clear(container).append(h('div.card.empty', 'Progetto non trovato, oppure non sei tra i suoi membri. ', h('a', { href: '#/projects' }, 'Torna ai progetti')));
  // il progetto di un'opportunità di Alma Energy si apre nella pagina dell'opportunità
  if (p.energy && !opts.base) {
    const t = location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[2] || '';
    const r = await get(`/api/energy/projects/${p.id}/opportunity`, { quiet: true }).catch(() => null);
    if (r) {
      location.replace(`#/energy/opportunita/${r.id}${t ? `/${t === 'impianto' ? 'iter' : t}` : ''}`);
      return;
    }
  }
  // il progetto di un A3 di Alma Strategy si apre nella pagina dell'A3
  if (p.hk && !opts.base) {
    const t = location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[2] || '';
    const r = await get(`/api/strategy/by-project/${p.id}`, { quiet: true }).catch(() => null);
    if (r) {
      location.replace(`#/strategy/a3/${r.id}${t ? `/${t}` : ''}`);
      return;
    }
  }
  const owner = userById(p.owner_id);
  const extra = opts.extraTabs || [];
  const tabs = [TABS[0], ...extra.map(([k, label]) => [k, label]), ...TABS.slice(1)];
  const base = opts.base || `#/projects/${p.id}`;
  const reload = () => projectDetail(container, id, opts);
  const tabFromHash = () => {
    const t = location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[base.replace(/^#\/?/, '').split('/').length];
    if (t === 'cartella') return 'documenti'; // vecchio tab, ora dentro Documenti
    return tabs.some(([k]) => k === t) ? t : opts.defaultTab || 'panoramica';
  };
  let tab = tabFromHash();
  let cleanupTab = null;

  // intestazione: percorso (l'unico «indietro» della pagina), nome e stato, azioni, quattro numeri
  const open = p.ticket_count - p.done_count;
  const lateNote = h('span.pj-fact-note.pj-late');
  const crew = h('span.pj-crew', h('span.muted', `${p.member_count + 1} ${p.member_count ? 'persone' : 'persona'}`));
  const head = h('header.pj-head', { style: { '--c': p.color } },
    h('nav.pj-top', { 'aria-label': 'Percorso' },
      opts.crumb ? h('a.pj-crumb', { href: opts.crumb.href }, icon('chevron-left', { size: 16 }), opts.crumb.label)
        : h('a.pj-crumb', { href: '#/projects' }, icon('chevron-left', { size: 16 }), 'Progetti'),
      area && !opts.crumb ? [h('span.pj-crumb-sep', '/'), h('span.pj-crumb.pj-area', { style: { '--ac': area.color } }, h('span.area-dot'), area.name)] : null),
    h('div.pj-row',
      h('div.pj-title',
        h('div.pj-name', h('span.pj-swatch'), h('h1', p.name),
          h('span.pill', { class: `pj-st-${p.status}` }, h('span.dot'), PROJECT_STATUS[p.status])),
        h('div.pj-meta', [owner ? `Responsabile ${owner.name}` : 'Senza responsabile',
          p.my_role === 'member' ? 'sei membro' : p.my_role === 'admin' ? 'vedi come amministratore' : viewer ? 'non sei nel progetto: lo vedi in sola lettura' : null].filter(Boolean).join('  ·  '))),
      h('div.pj-actions',
        opts.actions ? opts.actions() : canManage(p) ? h('button.btn', { type: 'button', on: { click: () => editProject(p, reload) } }, icon('pencil', { size: 16 }), 'Modifica') : null,
        viewer ? null : h('button.btn.btn-primary', { type: 'button', on: { click: () => openTicket(null, { defaults: { project_id: p.id, assignee_ids: [store.me.id] }, onSaved: () => show(tab) }) } }, icon('plus', { size: 16 }), 'Nuovo ticket'),
        moreMenu(
          viewer ? null : [h('span.pj-menu-label', 'La tua macro area'), areaPicker(p, reload), h('span.pj-menu-sep')],
          p.claude_url ? h('a.pj-menu-item', { href: p.claude_url, target: '_blank', rel: 'noopener', role: 'menuitem' }, icon('external', { size: 16 }), 'Apri in Claude') : null,
          h('a.pj-menu-item', { href: `#/gantt?project=${p.id}`, role: 'menuitem' }, icon('gantt', { size: 16 }), 'Apri il Gantt a tutta pagina')))),
    h('div.pj-facts',
      fact('Durata', dates(p), h('span.pj-fact-note', 'dalle attività del Gantt')),
      fact('Avanzamento', `${pct(p)} %`, h('div.progress', h('i', { style: { width: `${pct(p)}%` } }))),
      fact('Ticket aperti', `${open} di ${p.ticket_count}`, lateNote),
      fact('Persone', crew)),
    opts.head || null);
  // ticket in ritardo e volti delle persone: si leggono a parte
  get(`/api/tickets?project=${p.id}&status=open`, { quiet: true }).then(list => {
    const n = list.filter(t => t.due_date && t.due_date < today()).length;
    if (n) lateNote.textContent = `${n} in ritardo`;
  }).catch(() => {});
  get(`/api/projects/${p.id}/members`, { quiet: true }).then(team => {
    fill(crew, avatarsFor(team.map(m => m.id), 5), h('span.muted', `${team.length} ${team.length === 1 ? 'persona' : 'persone'}`));
  }).catch(() => {});

  // tab in orizzontale sotto l'intestazione (sul telefono scorrono)
  const nav = h('nav.pj-nav', { role: 'tablist', 'aria-label': 'Sezioni del progetto' }, tabs.map(([k, label]) => h('button.pj-tab', {
    type: 'button', role: 'tab', 'data-k': k, class: k === tab ? 'on' : '',
    on: { click: () => show(k) },
  }, k === 'gantt' && isMobile() ? 'Attività' : label, counter(k))));
  const content = h('div.pj-content');
  clear(container).append(h('div.pj', head, nav, content));
  show(tab);
  // il numero di email accanto al tab si legge a parte (non è nei dati del progetto)
  get(`/api/projects/${p.id}/emails`, { quiet: true }).then(list => {
    if (list?.length) nav.querySelector('[data-k="email"]')?.append(h('span.pj-count', String(list.length)));
  }).catch(() => {});
  // il numero di incontri, con un pallino rosso se uno già fatto non ha ancora le note
  function setMeetingsCount(n, missing = 0) {
    const tabBtn = nav.querySelector('[data-k="incontri"]');
    tabBtn?.querySelector('.pj-count')?.remove();
    tabBtn?.querySelector('.pj-nonotes')?.remove();
    if (n) tabBtn?.append(h('span.pj-count', String(n)));
    if (missing) tabBtn?.append(h('span.pj-nonotes', { title: missing === 1 ? 'Un incontro fatto non ha le note' : `${missing} incontri fatti non hanno le note`, 'aria-label': 'note mancanti' }));
  }
  get(`/api/projects/${p.id}/meetings`, { quiet: true }).then(list => setMeetingsCount(list?.length || 0,
    (list || []).filter(m => String(m.start_at).slice(0, 10) <= today() && !m.note_count).length)).catch(() => {});
  // lo stesso per le note (del progetto e dei suoi ticket); si aggiorna quando se ne aggiungono o tolgono
  function setNotesCount(n) {
    const tabBtn = nav.querySelector('[data-k="note"]');
    tabBtn?.querySelector('.pj-count')?.remove();
    if (n) tabBtn?.append(h('span.pj-count', String(n)));
  }
  get(`/api/projects/${p.id}/notes`, { quiet: true }).then(list => setNotesCount(list?.length || 0)).catch(() => {});

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
    history.replaceState(null, '', `${base}/${k}`);
    nav.querySelectorAll('.pj-tab').forEach(b => { b.classList.toggle('on', b.dataset.k === k); b.setAttribute('aria-selected', String(b.dataset.k === k)); });
    cleanupTab?.();
    cleanupTab = null;
    const box = h('div.pj-pane');
    clear(content).append(box);
    const ex = extra.find(([x]) => x === k);
    if (ex) ex[2](box, reload);
    else if (k === 'panoramica') overview(box);
    else if (k === 'gantt') {
      if (isMobile()) ganttPhone(box, { project: p.id });
      else ganttView(box, new URLSearchParams({ project: String(p.id) }), { embedded: true });
    } else if (k === 'ticket') ticketsView(box, { fixed: { project: String(p.id) }, view: isMobile() ? 'list' : 'board' });
    else if (k === 'documenti') projectDocuments(box, p.id, { canManage: canManage(p), onFolderChanged: reload });
    else if (k === 'email') projectEmails(box, p);
    else if (k === 'incontri') projectMeetings(box, p, { onCount: setMeetingsCount });
    else if (k === 'note') notesPanel(box, { url: `/api/projects/${p.id}/notes`, showTicket: true, onCount: setNotesCount });
    else if (k === 'membri') members(box);
  }

  // ── Panoramica: un riassunto, non le altre viste ripetute. Ogni riquadro porta al suo tab ─────────
  async function overview(box) {
    const card = (title, linkTab, linkLabel, body) => h('section.card.pj-card',
      h('div.pj-card-head', h('h2', title), linkTab ? h('button.pj-link', { type: 'button', on: { click: () => show(linkTab) } }, linkLabel) : null),
      body);
    const due = card('Prossime scadenze', 'ticket', 'Tutti i ticket', loading());
    const plan = card('Attività', 'gantt', isMobile() ? 'Tutte le attività' : 'Apri il Gantt', h('div.pj-plan'));
    const desc = card('Descrizione', null, null,
      p.description ? h('p.pj-desc', p.description) : h('p.muted', canManage(p) ? 'Nessuna descrizione. Aggiungila con «Modifica».' : 'Nessuna descrizione.'));
    const ppl = card('Persone', 'membri', canManage(p) ? 'Gestisci' : 'Vedi', loading());
    const news = card('Ultimi aggiornamenti', null, null, loading());
    box.append(h('div.pj-over', h('div.pj-col', due, plan), h('div.pj-col.pj-side', desc, ppl, news)));
    timeline(plan.lastChild, p, () => show('panoramica'));

    const [tickets, team, emails, notes, meetings] = await Promise.all([
      get(`/api/tickets?project=${p.id}&status=open`), get(`/api/projects/${p.id}/members`),
      get(`/api/projects/${p.id}/emails`, { quiet: true }).catch(() => []), get(`/api/projects/${p.id}/notes`, { quiet: true }).catch(() => []),
      get(`/api/projects/${p.id}/meetings`, { quiet: true }).catch(() => []),
    ]);

    // il prossimo incontro collegato al progetto (oggi o dopo)
    const next = meetings.filter(m => String(m.start_at).slice(0, 10) >= today()).sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)))[0];
    desc.after(card('Prossimo incontro', 'incontri', 'Tutti', next
      ? h('button.pj-meet', { type: 'button', on: { click: () => openMeeting(next.id, p, () => show('panoramica')) } },
        h('span.mt-cal', h('span.mt-cal-m', fmtDate(next.start_at).split(' ')[1] || ''), h('span.mt-cal-d', String(Number(String(next.start_at).slice(8, 10))))),
        h('span.pj-news-text', h('span.pj-news-title', next.subject),
          h('small', meetingWhen(next), next.location ? ` · ${next.location}` : ''),
          next.note_count || next.file_count ? h('small', [next.note_count ? `${next.note_count} ${next.note_count === 1 ? 'nota' : 'note'}` : null, next.file_count ? `${next.file_count} file` : null].filter(Boolean).join(' · ')) : null))
      : h('p.muted', meetings.length ? 'Nessun incontro in programma.' : 'Nessun incontro collegato. Collegalo dal tab Incontri.')));
    const late = t => t.due_date && t.due_date < today();
    const upcoming = tickets.filter(t => t.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 6);
    due.lastChild.replaceWith(upcoming.length
      ? h('div.pj-list', upcoming.map(t => h('button.pj-line', { type: 'button', on: { click: () => openTicket(t.id, { onSaved: () => show('panoramica') }) } },
        h('span.pj-dot', { class: t.status === 'doing' ? 'doing' : '' }), h('span.grow', t.title), avatarsFor(t.assignee_ids, 3),
        h('span.pj-due', { class: late(t) ? 'late' : '' }, late(t) ? `scaduto ${fmtDate(t.due_date)}` : fmtDate(t.due_date)))))
      : h('p.muted', 'Nessun ticket aperto con scadenza.'));
    ppl.lastChild.replaceWith(h('div.pj-people', team.map(m => h('div.pj-person',
      avatar(m, 30), h('span.grow', m.name), h('small', m.owner ? 'Responsabile' : `${m.open_tickets} ${m.open_tickets === 1 ? 'aperto' : 'aperti'}`)))));

    // le ultime email e note del progetto, dalla più recente
    const items = [
      ...emails.slice(0, 3).map(e => ({ when: e.sent_at || '', ico: 'mail', title: e.subject || '(senza oggetto)', sub: ['Email', e.from_name, e.sent_at ? fmtDate(e.sent_at.slice(0, 10)) : null], k: 'email' })),
      ...notes.slice().sort((a, b) => (b.note_date || '').localeCompare(a.note_date || '') || b.id - a.id).slice(0, 3)
        .map(n => ({ when: n.note_date || '', ico: 'file-text', title: n.title || n.body.split('\n')[0], sub: ['Nota', userById(n.author_id)?.name, n.note_date ? fmtDate(n.note_date.slice(0, 10)) : null], k: 'note' })),
    ].sort((a, b) => b.when.localeCompare(a.when)).slice(0, 4);
    news.lastChild.replaceWith(items.length
      ? h('div.pj-list', items.map(it => h('button.pj-news', { type: 'button', on: { click: () => show(it.k) } },
        h('span.pj-news-ico', icon(it.ico, { size: 17 })),
        h('span.pj-news-text', h('span.pj-news-title', it.title), h('small', it.sub.filter(Boolean).join(' · '))))))
      : h('p.muted', 'Ancora nessuna email o nota nel progetto.'));
  }

  // ── Membri: chi vede e lavora al progetto ────────────────────────────────────
  async function members(box) {
    const list = h('div.card.table-wrap', loading());
    box.append(
      h('div.spread', h('div', h('h3', 'Membri'), h('p.muted.small', { style: { margin: '2px 0 0' } },
        'Il progetto e i suoi ticket li vedono solo queste persone (e gli amministratori). Chi viene assegnato a un ticket del progetto entra da solo.')),
      opts.membersActions ? h('div.row.pj-members-actions', opts.membersActions(reload)) : canManage(p) ? h('button.btn.btn-primary', { type: 'button', on: { click: addPeople } }, '＋ Aggiungi persone') : null),
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
            m.id !== store.me.id && store.me.microsoft ? h('button.btn.btn-ghost.btn-sm', { type: 'button', title: `Chat con ${m.name}`, on: { click: () => openChatWithEmails([m.email]) } }, icon('message', { size: 16 })) : null,
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
      reload(); // ricarica anche intestazione e contatori
    }

    function addPeople() {
      const picker = peoplePicker({ selected: [], label: '＋ Scegli' });
      const md = modal({
        title: `Aggiungi persone a «${p.name}»`,
        body: [h('p.muted.small', { style: { margin: 0 } }, 'Puoi scegliere anche colleghi che non sono ancora entrati in Alma Planet: cercali per nome nella rubrica.'), picker.el],
        actions: [
          h('button.btn', { type: 'button', on: { click: () => md.close() } }, 'Annulla'),
          h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
            if (!picker.value.length) return toast('Scegli almeno una persona', 'err');
            await post(`/api/projects/${p.id}/members`, { user_ids: picker.value });
            md.close();
            toast(picker.value.length === 1 ? 'Persona aggiunta al progetto' : `${picker.value.length} persone aggiunte al progetto`);
            reload(); // ricarica anche intestazione e contatori
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
  const claude = h('input.input', { type: 'url', value: p.claude_url || '', placeholder: 'https://claude.ai/project/…' });
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
      h('div.field', h('span', 'La tua macro area'), h('div.row.area-pick', area, newArea), h('small.muted', 'Solo per te: gli altri raggruppano i progetti nelle loro.')),
      h('div.field', h('span', 'Colore'), swatches),
      h('label.field', h('span', 'Progetto Claude'), claude, h('small.muted', 'Incolla l\'indirizzo del progetto su claude.ai: nella scheda comparirà «Apri in Claude».')),
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
    if (claude.value.trim() && !/^https:\/\/claude\.ai\//.test(claude.value.trim())) { toast('Il progetto Claude deve essere un indirizzo https://claude.ai/…', 'err'); return; }
    const payload = {
      name: name.value, description: desc.value, color, status: status.value, claude_url: claude.value.trim() || null,
      owner_id: owner.value ? Number(owner.value) : null,
    };
    const r = isNew ? await post('/api/projects', payload) : await patch(`/api/projects/${p.id}`, payload);
    const areaId = area.value ? Number(area.value) : null;
    if (areaId !== (p.area_id ?? null)) await put(`/api/projects/${isNew ? r.id : p.id}/area`, { area_id: areaId });
    if (isNew && invite.value.length) await post(`/api/projects/${r.id}/members`, { user_ids: invite.value });
    m.close();
    await loadProjects();
    toast(isNew ? 'Progetto creato' : 'Progetto salvato');
    onSaved?.({ id: isNew ? r.id : p.id });
  }
}

// Pulsante «…» dell'intestazione: un menu che si chiude cliccando fuori o con Esc.
function moreMenu(...children) {
  const pop = h('div.pj-menu', { role: 'menu', hidden: true }, children);
  const btn = h('button.btn.pj-more-btn', { type: 'button', 'aria-label': 'Altre azioni', 'aria-haspopup': 'menu', 'aria-expanded': 'false', on: { click: () => toggle(pop.hidden) } }, icon('more'));
  const wrap = h('div.pj-more', btn, pop);
  const outside = e => { if (!wrap.contains(e.target)) toggle(false); };
  const esc = e => { if (e.key === 'Escape') { toggle(false); btn.focus(); } };
  function toggle(on) {
    pop.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    document[on ? 'addEventListener' : 'removeEventListener']('pointerdown', outside);
    document[on ? 'addEventListener' : 'removeEventListener']('keydown', esc);
  }
  pop.addEventListener('click', e => { if (e.target.closest('a')) toggle(false); });
  return wrap;
}

// Menu «macro area» nella scheda del progetto: sposta il progetto in una delle mie macro aree (solo per me).
function areaPicker(p, onChange) {
  const NEW = '__new';
  const sel = h('select.select.pj-area-select', { 'aria-label': 'La tua macro area', title: 'La tua macro area (solo per te)', on: { change: async () => {
    let areaId = sel.value === NEW ? (await createArea())?.id : sel.value ? Number(sel.value) : null;
    if (areaId === undefined) { sel.value = p.area_id ? String(p.area_id) : ''; return; } // nuova annullata
    await put(`/api/projects/${p.id}/area`, { area_id: areaId });
    toast(areaId ? `Spostato in «${areaById(areaId)?.name}»` : 'Tolto dalla macro area');
    onChange();
  } } },
  h('option', { value: '' }, 'Nessuna macro area'),
  store.areas.map(a => h('option', { value: String(a.id), selected: a.id === p.area_id }, a.name)),
  h('option', { value: NEW }, '＋ Nuova macro area…'));
  return sel;
}
