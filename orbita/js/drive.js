// OneDrive: esploratore (pagina intera, cartella di progetto) e finestra per scegliere file o cartelle.
import { h, clear, modal, toast, fmtSize, fmtDateTime, loading, promptDialog, debounce } from './ui.js';
import { icon, fileIconName } from './icons.js';
import { get, post, api, qs } from './api.js';
import { store } from './store.js';
import { uploadButtons, uploadFiles, droppedEntries } from './upload.js';

export const fileIcon = it => icon(fileIconName(it.name, Boolean(it.folder)));

const notConnected = () => h('div.card.empty', 'OneDrive non è ancora collegato: manca la registrazione dell\'app Microsoft.');

// Esploratore riusabile. opts: { root: {driveId,id,name}, mode: 'browse'|'pick', pickFolders, onPick, tabs }
export function driveBrowser(container, opts = {}) {
  const mode = opts.mode || 'browse';
  const many = mode === 'pickMany';
  const chosen = new Map(); // id → elemento scelto (pickMany)
  const rootCrumb = opts.root ? { driveId: opts.root.driveId, id: opts.root.id, name: opts.root.name } : { name: 'Il mio OneDrive' };
  let source = 'mine'; // mine | shared | recent | search
  let stack = [rootCrumb];
  let current = null;
  const head = h('div');
  const crumbs = h('div.crumbs');
  const body = h('div.drop-zone');

  const queue = h('div.up-queue');
  const target = () => { const c = top(); return `/api/drive/upload${qs({ drive: c.driveId || current?.driveId, item: c.id || current?.id })}`; };
  const ups = mode === 'browse' ? uploadButtons(() => target(), { queue, small: false, primary: true, onDone: () => load() }) : null;
  const search = h('input.input', { type: 'search', placeholder: 'Cerca nel mio OneDrive…', on: { input: debounce(e => {
    const q = e.target.value.trim();
    if (q.length >= 2) { source = 'search'; load(q); } else if (!q && source === 'search') { source = 'mine'; load(); }
  }, 400) } });

  const tabs = opts.tabs === false ? null : h('div.seg', [['mine', 'Il mio OneDrive'], ['shared', 'Condivisi con me'], ['recent', 'Recenti']].map(([k, l]) =>
    h('button', { type: 'button', 'data-k': k, class: k === 'mine' ? 'on' : '', on: { click: () => {
      source = k; stack = [rootCrumb]; search.value = '';
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
      load();
    } } }, l)));

  const actions = h('div.row',
    h('button.btn', { type: 'button', on: { click: newFolder } }, '+ Cartella'),
    ups ? ups.el : null);

  head.append(h('div.toolbar', tabs, opts.root ? null : search, h('span.grow'), actions));
  const footer = many ? h('div.pick-foot') : null;
  clear(container).append(head, crumbs, queue, body, footer);

  // trascina file dal computer per caricarli nella cartella aperta
  if (mode === 'browse') {
    body.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files') && canWrite()) { e.preventDefault(); body.classList.add('drag'); } });
    body.addEventListener('dragleave', () => body.classList.remove('drag'));
    body.addEventListener('drop', async e => { e.preventDefault(); body.classList.remove('drag'); if (!canWrite()) return; const entries = await droppedEntries(e.dataTransfer); if (entries.length && await uploadFiles(target(), entries, queue)) load(); });
  }

  const canWrite = () => source === 'mine' || (stack.length > 1);
  const top = () => stack[stack.length - 1];

  function drawCrumbs() {
    clear(crumbs);
    if (source === 'search') return crumbs.append(h('span.muted', 'Risultati della ricerca'));
    const first = source === 'shared' ? { name: 'Condivisi con me' } : source === 'recent' ? { name: 'Recenti' } : stack[0];
    const items = [first, ...stack.slice(1)];
    items.forEach((c, i) => {
      if (i) crumbs.append(h('span.muted', '›'));
      crumbs.append(h('button', { type: 'button', on: { click: () => { stack = stack.slice(0, i + 1); load(); } } }, c.name));
    });
    actions.hidden = !canWrite();
  }

  async function load(q) {
    drawCrumbs();
    body.replaceChildren(loading());
    try {
      let items;
      const c = top();
      if (source === 'search') items = (await get(`/api/drive/search${qs({ q })}`)).items;
      else if (stack.length > 1 || c.driveId) {
        const r = await get(`/api/drive/items${qs({ drive: c.driveId, item: c.id })}`);
        current = r.folder; items = r.items;
      } else if (source === 'shared') items = (await get('/api/drive/shared')).items;
      else if (source === 'recent') items = (await get('/api/drive/recent')).items;
      else { const r = await get('/api/drive/items'); current = r.folder; stack[0] = { ...stack[0], driveId: r.folder.driveId, id: r.folder.id }; items = r.items; }
      render(items);
    } catch (err) {
      body.replaceChildren(err.code === 'ms_not_configured' ? notConnected() : h('div.card.empty', err.message));
    }
  }

  function open(it) {
    if (it.folder) { stack.push({ driveId: it.driveId, id: it.id, name: it.name }); load(); return; }
    if (mode === 'pick' && !opts.pickFolders) return opts.onPick(it);
    window.open(it.webUrl, '_blank', 'noopener');
  }

  function render(items) {
    clear(body);
    if (mode === 'pick' && opts.pickFolders && stack.length) {
      const c = top();
      body.append(h('div.toolbar', h('span.muted', 'Apri la cartella giusta, poi:'),
        h('button.btn.btn-primary.btn-sm', { type: 'button', disabled: !c.id, on: { click: () => opts.onPick({ driveId: c.driveId || current?.driveId, id: c.id || current?.id, name: c.name, webUrl: current?.webUrl, folder: true }) } }, `Usa «${c.name}»`)));
    }
    const shown = mode === 'pick' && opts.pickFolders ? items.filter(i => i.folder) : items;
    if (!shown.length) return body.append(h('div.card.empty', mode === 'browse' && canWrite() ? 'Cartella vuota. Trascina qui i file per caricarli.' : 'Nessun elemento.'));
    body.append(h('div.card.table-wrap', h('table.list',
      h('thead', h('tr', h('th', 'Nome'), h('th', 'Modificato'), h('th', 'Da'), h('th', 'Dimensione'), h('th', ''))),
      h('tbody', shown.map(it => h('tr', { class: chosen.has(it.id) ? 'picked' : '', on: { click: () => open(it) } },
        h('td', h('div.f-name', many ? h('input.pick-box', { type: 'checkbox', checked: chosen.has(it.id), 'aria-label': `Scegli ${it.name}`, on: { click: e => { e.stopPropagation(); toggle(it, e.target.checked); e.target.closest('tr').classList.toggle('picked', e.target.checked); } } }) : null, h('span.f-ico', fileIcon(it)), h('span', it.name))),
        h('td.muted', fmtDateTime(it.modified)),
        h('td.muted', it.modifiedBy || ''),
        h('td.muted', it.folder ? (it.childCount !== null ? `${it.childCount} elementi` : '') : fmtSize(it.size)),
        h('td', h('div.row-actions', rowActions(it)))))))));
  }

  function toggle(it, on) {
    if (on) chosen.set(it.id, it); else chosen.delete(it.id);
    drawFooter();
  }
  function drawFooter() {
    if (!footer) return;
    footer.replaceChildren(
      h('span.muted', chosen.size ? `${chosen.size} ${chosen.size === 1 ? 'elemento scelto' : 'elementi scelti'}: ${[...chosen.values()].map(i => i.name).slice(0, 3).join(', ')}${chosen.size > 3 ? '…' : ''}` : 'Spunta file e cartelle, anche da cartelle diverse.'),
      h('span.grow'),
      h('button.btn.btn-primary', { type: 'button', disabled: !chosen.size, on: { click: () => opts.onPick([...chosen.values()]) } }, chosen.size ? `Collega ${chosen.size}` : 'Collega'));
  }
  drawFooter();

  function rowActions(it) {
    const stop = fn => e => { e.stopPropagation(); fn(); };
    if (many) return null;
    if (mode === 'pick') {
      return opts.pickFolders
        ? null
        : it.folder ? null : h('button.btn.btn-sm', { type: 'button', on: { click: stop(() => opts.onPick(it)) } }, 'Scegli');
    }
    return [
      h('a.btn.btn-ghost.btn-sm', { href: it.webUrl, target: '_blank', rel: 'noopener', title: 'Apri in OneDrive', on: { click: e => e.stopPropagation() } }, icon('external', { size: 16 })),
      it.folder ? null : h('a.btn.btn-ghost.btn-sm', { href: `/api/drive/download${qs({ drive: it.driveId, item: it.id })}`, title: 'Scarica', on: { click: e => e.stopPropagation() } }, '↓'),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Copia link', on: { click: stop(async () => {
        try { await navigator.clipboard.writeText(it.webUrl); toast('Link copiato'); } catch { toast('Copia non riuscita', 'err'); }
      }) } }, icon('link', { size: 16 })),
    ];
  }

  async function newFolder() {
    const name = await promptDialog('Nuova cartella', { label: 'Nome', ok: 'Crea' });
    if (!name) return;
    const c = top();
    await post('/api/drive/folder', { drive: c.driveId || current?.driveId, item: c.id || current?.id, name });
    toast('Cartella creata');
    load();
  }

  load();
  return { reload: () => load() };
}

// Finestra per scegliere un file (o una cartella). Ritorna l'elemento o null.
export function pickDriveItem({ title = 'Scegli da OneDrive', folders = false, start = null } = {}) {
  if (!store.me.microsoft) { toast('OneDrive non è ancora collegato', 'err'); return Promise.resolve(null); }
  return new Promise(resolve => {
    let picked = null;
    const box = h('div');
    const m = modal({ title, body: box, wide: true, onClose: () => resolve(picked) });
    driveBrowser(box, { mode: 'pick', pickFolders: folders, root: start, tabs: !start, onPick: it => { picked = it; m.close(); } });
  });
}

// Finestra per scegliere più file e cartelle (anche da cartelle diverse). Ritorna l'elenco (vuoto se si chiude).
export function pickDriveItems({ title = 'Scegli da OneDrive', start = null } = {}) {
  if (!store.me.microsoft) { toast('OneDrive non è ancora collegato', 'err'); return Promise.resolve([]); }
  return new Promise(resolve => {
    let picked = [];
    const box = h('div');
    const m = modal({ title, body: box, wide: true, onClose: () => resolve(picked) });
    driveBrowser(box, { mode: 'pickMany', root: start, tabs: !start, onPick: list => { picked = list; m.close(); } });
  });
}

export function driveView(container) {
  clear(container).append(h('div.page-head', h('div', h('h1', 'OneDrive'), h('div.sub', 'I tuoi file e quelli condivisi con te. Trascina file o intere cartelle nella cartella aperta per caricarli.'))));
  const box = h('div');
  container.append(box);
  if (!store.me.microsoft) return box.append(notConnected());
  driveBrowser(box);
}
