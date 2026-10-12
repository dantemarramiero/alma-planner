// Attività del Gantt (= ticket del progetto con date) e documenti del progetto.
import { h, clear, fill, toast, fmtDateTime, fmtSize, today, addDays, loading } from './ui.js';
import { icon, fileIconName } from './icons.js';
import { get, post, del, api, qs } from './api.js';
import { store, projectById, loadProjects } from './store.js';
import { pickDriveItems } from './drive.js';
import { uploadButtons, uploadFiles, droppedEntries } from './upload.js';
import { openTicket } from './tickets.js';

const fileIcon = name => icon(fileIconName(name));

// Nuova attività: un ticket del progetto con inizio, fine e almeno un responsabile.
export function newActivity(projectId, { onSaved } = {}) {
  return openTicket(null, {
    requireSchedule: true,
    defaults: { project_id: projectId, start_date: today(), due_date: addDays(today(), 4), assignee_ids: [store.me.id] },
    onSaved,
  });
}

// Pulsanti di caricamento per la scheda del ticket (i file vanno nella sottocartella del ticket, vedi upload.js).
export function uploadButton(url, projectId, { onDone } = {}) {
  return uploadButtons(url, { onDone }).el;
}

export function fileRow(f, { onRemove, note } = {}) {
  return h('div.file-row', h('span.f-ico', fileIcon(f.name)),
    h('a', { href: f.web_url || '#', target: '_blank', rel: 'noopener' }, f.name),
    note ? h('span.pill', note) : null,
    h('span.muted.small', [f.added_by_name, f.created_at ? fmtDateTime(f.created_at) : null].filter(Boolean).join(' · ')),
    onRemove ? h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Scollega (il file resta su OneDrive)', on: { click: onRemove } }, '×') : null);
}

// Documenti del progetto: si trascinano o si scelgono file e cartelle, che vanno nella cartella OneDrive del progetto.
// L'elenco è la cartella vera (quindi c'è anche ciò che viene messo da OneDrive o Teams), più file e cartelle collegati
// da altre parti di OneDrive (si apre una cartella collegata per vederne il contenuto) e i file delle attività.
export async function projectDocuments(container, projectId) {
  const url = `/api/projects/${projectId}/files/upload`;
  const folderInfo = h('div.small.muted');
  const listBox = h('div.docs-list', loading());
  const ups = uploadButtons(url, { onDone: async () => { await loadProjects(); load(); }, primary: true });
  const link = h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => {
    const p = projectById(projectId);
    const start = p?.onedrive_item_id ? { driveId: p.onedrive_drive_id, id: p.onedrive_item_id, name: p.onedrive_name } : null;
    const picked = await pickDriveItems({ title: 'Collega file e cartelle da OneDrive', start });
    if (!picked?.length) return;
    const r = await post(`/api/projects/${projectId}/files`, { items: picked.map(it => ({ drive_id: it.driveId, item_id: it.id, name: it.name, web_url: it.webUrl, size: it.folder ? null : it.size, folder: it.folder })) });
    toast(r.added === picked.length ? `Collegat${picked.length === 1 ? 'o' : 'i'} ${picked.length} element${picked.length === 1 ? 'o' : 'i'}` : `Collegati ${r.added} elementi (gli altri c'erano già)`);
    load();
  } } }, icon('link', { size: 16 }), 'Collega da OneDrive');
  const drop = h('div.drop-docs',
    h('span.drop-ico', icon('upload', { size: 22 })),
    h('div.drop-txt', h('strong', 'Trascina qui file o cartelle del progetto'), folderInfo),
    h('div.row', ups.el, link));
  clear(container).append(drop, ups.queue, listBox);

  // trascinare file o cartelle sulla sezione
  let depth = 0;
  const hasFiles = e => e.dataTransfer?.types?.includes('Files');
  container.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; drop.classList.add('drag'); });
  container.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  container.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove('drag'); });
  container.addEventListener('drop', async e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    drop.classList.remove('drag');
    if (!store.me.microsoft) return toast('Microsoft 365 non è collegato: esci e rientra', 'err');
    const entries = await droppedEntries(e.dataTransfer);
    if (entries.length && await uploadFiles(url, entries, ups.queue)) { await loadProjects(); load(); }
  });

  const itemRow = it => h('div.file-row',
    h('span.f-ico', icon(it.folder ? 'folder' : fileIconName(it.name))),
    h('a', { href: it.webUrl, target: '_blank', rel: 'noopener' }, it.name),
    h('span.muted.small', [it.folder ? `${it.childCount ?? 0} elementi` : fmtSize(it.size), it.modifiedBy, it.modified ? fmtDateTime(it.modified) : null].filter(Boolean).join(' · ')));

  // cartella collegata: si apre e mostra il contenuto letto da OneDrive (con l'accesso di chi guarda)
  function linkedFolder(f) {
    const inner = h('div.linked-inner', { hidden: true });
    const toggle = h('button.gx-chev.cl', { type: 'button', 'aria-expanded': 'false', title: 'Mostra il contenuto', on: { click: async () => {
      const open = inner.hidden;
      inner.hidden = !open;
      toggle.classList.toggle('cl', !open);
      toggle.setAttribute('aria-expanded', String(open));
      if (!open || inner.dataset.loaded) return;
      inner.replaceChildren(loading());
      try {
        const r = await get(`/api/drive/items${qs({ drive: f.drive_id, item: f.item_id })}`, { quiet: true });
        inner.dataset.loaded = '1';
        inner.replaceChildren(...(r.items.length ? r.items.map(itemRow) : [h('div.muted.small', 'Cartella vuota.')]));
      } catch (err) { inner.replaceChildren(h('div.banner', err.message)); }
    } } }, icon('expand', { size: 14 }));
    return h('div.linked-folder',
      h('div.file-row', toggle, h('span.f-ico', icon('folder')),
        h('a', { href: f.web_url || '#', target: '_blank', rel: 'noopener' }, f.name),
        h('span.muted.small', [f.added_by_name, f.created_at ? fmtDateTime(f.created_at) : null].filter(Boolean).join(' · ')),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Scollega (la cartella resta su OneDrive)', on: { click: async () => { await del(`/api/projects/${projectId}/files/${f.id}`); load(); } } }, '×')),
      inner);
  }

  async function load() {
    let data;
    try { data = await get(`/api/projects/${projectId}/files`, { quiet: true }); }
    catch (err) { return fill(listBox, h('div.banner', err.message)); }
    const { folder, items, folderError, files, ticketFiles } = data;
    fill(folderInfo, folder
      ? ['Vanno nella cartella ', h('a', { href: folder.webUrl, target: '_blank', rel: 'noopener' }, `«${folder.name}»`), ' su OneDrive, che vedono tutte le persone del progetto.']
      : `Al primo caricamento creo la cartella «Alma Planet/${projectById(projectId)?.name || 'progetto'}» nel tuo OneDrive e la condivido con le persone del progetto.`);
    const out = [];
    if (folderError) out.push(h('div.banner', folderError));
    if (items?.length) out.push(h('div.picker-sep', `Nella cartella del progetto · ${items.length}`), h('div', items.map(itemRow)));
    const linkedFolders = files.filter(f => f.is_folder), linkedFiles = files.filter(f => !f.is_folder);
    if (linkedFolders.length) out.push(h('div.picker-sep', `Cartelle collegate · ${linkedFolders.length}`), linkedFolders.map(linkedFolder));
    if (linkedFiles.length) {
      out.push(h('div.picker-sep', `File collegati · ${linkedFiles.length}`), linkedFiles.map(f => fileRow(f, {
        onRemove: async () => { await del(`/api/projects/${projectId}/files/${f.id}`); load(); },
      })));
    }
    if (ticketFiles.length) out.push(h('div.picker-sep', 'Dalle attività'), ticketFiles.map(f => fileRow(f, { note: f.ticket_title })));
    if (!items?.length && !files.length && !ticketFiles.length) {
      out.push(h('div.empty', folder ? 'La cartella è vuota: trascina qui i primi file o una cartella.' : 'Nessun documento ancora: trascina qui i primi file o una cartella.'));
    }
    fill(listBox, out);
  }
  load();
  return { reload: load };
}
