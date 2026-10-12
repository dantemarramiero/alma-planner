// Attività del Gantt (= ticket del progetto con date) e documenti del progetto.
import { h, clear, fill, toast, fmtDateTime, fmtSize, today, addDays, loading } from './ui.js';
import { icon, fileIconName } from './icons.js';
import { get, post, patch, del, api, qs } from './api.js';
import { store, projectById, loadProjects } from './store.js';
import { pickDriveItem, pickDriveItems } from './drive.js';
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

// Documenti del progetto (un solo posto, prima c'era anche il tab «Cartella OneDrive» che mostrava la stessa cartella):
// si trascinano o si scelgono file e cartelle, che vanno nella cartella OneDrive del progetto. L'elenco è la cartella
// vera (quindi c'è anche ciò che viene messo da OneDrive o Teams; le sottocartelle si aprono sul posto), più file e
// cartelle collegati da altre parti di OneDrive e i file delle attività. Chi gestisce il progetto può cambiare cartella.
export async function projectDocuments(container, projectId, { canManage = false, onFolderChanged } = {}) {
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
  const change = canManage && store.me.microsoft ? h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => {
    const p = projectById(projectId);
    const f = await pickDriveItem({ title: 'Scegli la cartella del progetto', folders: true });
    if (!f) return;
    await patch(`/api/projects/${projectId}`, { onedrive_drive_id: f.driveId, onedrive_item_id: f.id, onedrive_name: f.name, onedrive_url: f.webUrl || null });
    toast(p?.onedrive_item_id ? 'Cartella del progetto cambiata' : 'Cartella del progetto collegata');
    await loadProjects();
    if (onFolderChanged) onFolderChanged(); else load();
  } } }, icon('folder', { size: 16 }), 'Cambia cartella') : null;
  const drop = h('div.drop-docs',
    h('span.drop-ico', icon('upload', { size: 22 })),
    h('div.drop-txt', h('strong', 'Trascina qui file o cartelle del progetto'), folderInfo),
    h('div.row', ups.el, link, change));
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

  const itemMeta = it => h('span.muted.small', [it.folder ? `${it.childCount ?? 0} elementi` : fmtSize(it.size), it.modifiedBy, it.modified ? fmtDateTime(it.modified) : null].filter(Boolean).join(' · '));
  const itemRow = it => (it.folder
    ? folderRow({ drive: it.driveId, item: it.id, name: it.name, webUrl: it.webUrl, meta: itemMeta(it) })
    : h('div.file-row', h('span.f-ico', icon(fileIconName(it.name))), h('a', { href: it.webUrl, target: '_blank', rel: 'noopener' }, it.name), itemMeta(it)));
  const linkedFolder = f => folderRow({ drive: f.drive_id, item: f.item_id, name: f.name, webUrl: f.web_url,
    meta: h('span.muted.small', [f.added_by_name, f.created_at ? fmtDateTime(f.created_at) : null].filter(Boolean).join(' · ')),
    remove: h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Scollega (la cartella resta su OneDrive)', on: { click: async () => { await del(`/api/projects/${projectId}/files/${f.id}`); load(); } } }, '×') });

  // cartella: si apre e mostra il contenuto letto da OneDrive (con l'accesso di chi guarda)
  function folderRow({ drive, item, name, webUrl, meta, remove = null }) {
    const inner = h('div.linked-inner', { hidden: true });
    const toggle = h('button.gx-chev.cl', { type: 'button', 'aria-expanded': 'false', title: 'Mostra il contenuto', on: { click: async () => {
      const open = inner.hidden;
      inner.hidden = !open;
      toggle.classList.toggle('cl', !open);
      toggle.setAttribute('aria-expanded', String(open));
      if (!open || inner.dataset.loaded) return;
      inner.replaceChildren(loading());
      try {
        const r = await get(`/api/drive/items${qs({ drive, item })}`, { quiet: true });
        inner.dataset.loaded = '1';
        inner.replaceChildren(...(r.items.length ? r.items.map(itemRow) : [h('div.muted.small', 'Cartella vuota.')]));
      } catch (err) { inner.replaceChildren(h('div.banner', err.message)); }
    } } }, icon('expand', { size: 14 }));
    return h('div.linked-folder',
      h('div.file-row', toggle, h('span.f-ico', icon('folder')),
        h('a', { href: webUrl || '#', target: '_blank', rel: 'noopener' }, name), meta, remove),
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
