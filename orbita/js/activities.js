// Attività del Gantt (= ticket del progetto con date) e documenti del progetto.
import { h, clear, fill, toast, fmtDateTime, fmtSize, today, addDays, loading } from './ui.js';
import { icon, fileIconName } from './icons.js';
import { get, post, del, api, qs } from './api.js';
import { store, projectById, loadProjects } from './store.js';
import { pickDriveItem } from './drive.js';
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

// ── caricamento dei file ──────────────────────────────────────────────────
// I file vanno nella cartella OneDrive del progetto: se non c'è, il server la crea al primo caricamento
// («Alma Planet/<progetto>» nel OneDrive di chi carica) e la condivide con le persone del progetto.
const MAX_SIZE = 250 * 1024 * 1024;

// Un file con l'avanzamento (fetch non lo dà, XMLHttpRequest sì). Risolve con la risposta, rifiuta con il messaggio.
function sendFile(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${url}${qs({ name: file.name })}`);
    xhr.setRequestHeader('X-Alma', '1');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* risposta non JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data || {});
      else reject(new Error(data?.error || `Caricamento non riuscito (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Connessione interrotta: riprova'));
    xhr.send(file);
  });
}

// Carica più file uno dopo l'altro, mostrando ognuno in «queue» con la sua barra. Restituisce quanti sono andati bene.
export async function uploadFiles(url, files, queue) {
  let ok = 0, created = null, shared = 0;
  for (const f of files) {
    const bar = h('i');
    const status = h('span.up-st', 'in attesa');
    const row = h('div.up-row', h('span.f-ico', fileIcon(f.name)), h('span.up-name', f.name), h('span.up-bar', bar), status);
    queue?.append(row);
    if (f.size > MAX_SIZE) { row.classList.add('err'); status.textContent = 'oltre 250 MB: caricalo da OneDrive'; continue; }
    try {
      const r = await sendFile(url, f, x => { bar.style.width = `${Math.round(x * 100)}%`; status.textContent = `${Math.round(x * 100)}%`; });
      bar.style.width = '100%';
      row.classList.add('ok');
      status.textContent = r.name && r.name !== f.name ? `caricato come «${r.name}»` : 'caricato';
      if (r.folderCreated) created = r.folderCreated;
      shared = Math.max(shared, r.sharedWith || 0);
      ok++;
      setTimeout(() => row.remove(), 4000);
    } catch (err) {
      row.classList.add('err');
      status.textContent = err.message;
    }
  }
  if (created) toast(`Creata la cartella «${created}» nel tuo OneDrive${shared ? ` e condivisa con ${shared} ${shared === 1 ? 'persona' : 'persone'} del progetto` : ''}`);
  else if (ok) toast(ok === 1 ? 'File caricato' : `${ok} file caricati`);
  return ok;
}

// Pulsante «Carica file» (scheda del ticket): sceglie i file e li carica, con l'avanzamento sotto il pulsante.
export function uploadButton(url, projectId, { onDone, label = 'Carica file', queue } = {}) {
  const q = queue || h('div.up-queue');
  const input = h('input', { type: 'file', multiple: true, hidden: true, on: { change: async e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (await uploadFiles(url, files, q)) onDone?.();
  } } });
  const btn = h('button.btn.btn-sm', { type: 'button', on: { click: () => {
    if (!store.me.microsoft) return toast('Microsoft 365 non è collegato: esci e rientra', 'err');
    input.click();
  } } }, icon('upload', { size: 16 }), label.replace(/^↑\s*/, ''));
  return h('span.up-wrap', btn, input, queue ? null : q);
}

export function fileRow(f, { onRemove, note } = {}) {
  return h('div.file-row', h('span.f-ico', fileIcon(f.name)),
    h('a', { href: f.web_url || '#', target: '_blank', rel: 'noopener' }, f.name),
    note ? h('span.pill', note) : null,
    h('span.muted.small', [f.added_by_name, f.created_at ? fmtDateTime(f.created_at) : null].filter(Boolean).join(' · ')),
    onRemove ? h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Scollega (il file resta su OneDrive)', on: { click: onRemove } }, '×') : null);
}

// Documenti del progetto: si trascinano o si scelgono i file, che vanno nella cartella OneDrive del progetto.
// L'elenco è la cartella vera (quindi c'è anche ciò che viene messo da OneDrive o Teams), più i file collegati da
// altre cartelle e quelli delle attività.
export async function projectDocuments(container, projectId) {
  const url = `/api/projects/${projectId}/files/upload`;
  const queue = h('div.up-queue');
  const folderInfo = h('div.small.muted');
  const listBox = h('div.docs-list', loading());
  const input = h('input', { type: 'file', multiple: true, hidden: true, on: { change: e => { const f = [...e.target.files]; e.target.value = ''; upload(f); } } });
  const choose = h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => {
    if (!store.me.microsoft) return toast('Microsoft 365 non è collegato: esci e rientra', 'err');
    input.click();
  } } }, icon('upload', { size: 16 }), 'Scegli file');
  const link = h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => {
    const p = projectById(projectId);
    const start = p?.onedrive_item_id ? { driveId: p.onedrive_drive_id, id: p.onedrive_item_id, name: p.onedrive_name } : null;
    const item = await pickDriveItem({ title: 'Collega un file da un\'altra cartella di OneDrive', start });
    if (!item) return;
    await post(`/api/projects/${projectId}/files`, { drive_id: item.driveId, item_id: item.id, name: item.name, web_url: item.webUrl, size: item.size });
    toast('File collegato');
    load();
  } } }, icon('link', { size: 16 }), 'Collega da OneDrive');
  const drop = h('div.drop-docs',
    h('span.drop-ico', icon('upload', { size: 22 })),
    h('div.drop-txt', h('strong', 'Trascina qui i file del progetto'), folderInfo),
    h('div.row', choose, link), input);
  clear(container).append(drop, queue, listBox);

  // trascinare i file sulla zona (o sull'intera sezione)
  let depth = 0;
  container.addEventListener('dragenter', e => { if (!e.dataTransfer?.types?.includes('Files')) return; e.preventDefault(); depth++; drop.classList.add('drag'); });
  container.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  container.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove('drag'); });
  container.addEventListener('drop', e => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    depth = 0;
    drop.classList.remove('drag');
    if (!store.me.microsoft) return toast('Microsoft 365 non è collegato: esci e rientra', 'err');
    upload([...e.dataTransfer.files]);
  });

  async function upload(files) {
    if (!files.length) return;
    if (await uploadFiles(url, files, queue)) { await loadProjects(); load(); }
  }

  async function load() {
    let data;
    try { data = await get(`/api/projects/${projectId}/files`, { quiet: true }); }
    catch (err) { return fill(listBox, h('div.banner', err.message)); }
    const { folder, items, folderError, files, ticketFiles } = data;
    fill(folderInfo, folder
      ? ['Vanno nella cartella ', h('a', { href: folder.webUrl, target: '_blank', rel: 'noopener' }, `«${folder.name}»`), ' su OneDrive, che vedono tutte le persone del progetto.']
      : 'Al primo caricamento creo la cartella «Alma Planet/' + (projectById(projectId)?.name || 'progetto') + '» nel tuo OneDrive e la condivido con le persone del progetto.');
    const out = [];
    if (folderError) out.push(h('div.banner', folderError));
    if (items?.length) {
      out.push(h('div.picker-sep', `Nella cartella del progetto · ${items.length}`), h('div', items.map(it => h('div.file-row',
        h('span.f-ico', icon(it.folder ? 'folder' : fileIconName(it.name))),
        h('a', { href: it.webUrl, target: '_blank', rel: 'noopener' }, it.name),
        h('span.muted.small', [it.folder ? `${it.childCount ?? 0} elementi` : fmtSize(it.size), it.modifiedBy, it.modified ? fmtDateTime(it.modified) : null].filter(Boolean).join(' · '))))));
    }
    if (files.length) {
      out.push(h('div.picker-sep', 'Collegati da altre cartelle'), files.map(f => fileRow(f, {
        onRemove: async () => { await del(`/api/projects/${projectId}/files/${f.id}`); load(); },
      })));
    }
    if (ticketFiles.length) out.push(h('div.picker-sep', 'Dalle attività'), ticketFiles.map(f => fileRow(f, { note: f.ticket_title })));
    if (!out.length || (folder && items && !items.length && !files.length && !ticketFiles.length && !folderError)) {
      out.push(h('div.empty', folder ? 'La cartella è vuota: trascina qui il primo file.' : 'Nessun documento ancora: trascina qui il primo file.'));
    }
    fill(listBox, out);
  }
  load();
  return { reload: load };
}
