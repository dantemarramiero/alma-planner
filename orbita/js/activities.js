// Attività del Gantt (= ticket del progetto con date) e documenti del progetto.
import { h, clear, toast, fmtDateTime, today, addDays, loading } from './ui.js';
import { icon, fileIconName } from './icons.js';
import { get, post, del, api, qs } from './api.js';
import { store, projectById } from './store.js';
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

// Carica file dal computer nella cartella OneDrive del progetto.
// url: endpoint di caricamento (progetto o ticket); projectId serve a controllare che la cartella sia collegata.
export function uploadButton(url, projectId, { onDone, label = '↑ Carica file' } = {}) {
  const input = h('input', { type: 'file', multiple: true, hidden: true, on: { change: async e => {
    const files = [...e.target.files];
    e.target.value = '';
    let ok = 0;
    for (const f of files) {
      if (f.size > 250 * 1024 * 1024) { toast(`${f.name}: oltre 250 MB, caricalo da OneDrive`, 'err'); continue; }
      toast(`Caricamento di ${f.name}…`);
      try {
        await api('POST', `${url}${qs({ name: f.name })}`, f, { raw: true, headers: { 'Content-Type': 'application/octet-stream' } });
        ok++;
      } catch { /* l'errore è già mostrato */ }
    }
    if (ok) { toast(ok === 1 ? 'File caricato' : `${ok} file caricati`); onDone?.(); }
  } } });
  const btn = h('button.btn.btn-sm', { type: 'button', on: { click: () => {
    if (!store.me.microsoft) return toast('OneDrive non è ancora collegato', 'err');
    if (!projectById(projectId)?.onedrive_item_id) return toast('Collega prima una cartella OneDrive al progetto (pagina del progetto, «Cartella OneDrive»)', 'err');
    input.click();
  } } }, label);
  return h('span', btn, input);
}

export function fileRow(f, { onRemove, note } = {}) {
  return h('div.file-row', h('span.f-ico', fileIcon(f.name)),
    h('a', { href: f.web_url || '#', target: '_blank', rel: 'noopener' }, f.name),
    note ? h('span.pill', note) : null,
    h('span.muted.small', [f.added_by_name, f.created_at ? fmtDateTime(f.created_at) : null].filter(Boolean).join(' · ')),
    onRemove ? h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Scollega (il file resta su OneDrive)', on: { click: onRemove } }, '×') : null);
}

// Documenti del progetto: del progetto intero e delle sue attività/ticket.
export async function projectDocuments(container, projectId) {
  const box = h('div.card', { style: { padding: '6px 14px' } });
  const link = h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
    const p = projectById(projectId);
    const start = p?.onedrive_item_id ? { driveId: p.onedrive_drive_id, id: p.onedrive_item_id, name: p.onedrive_name } : null;
    const item = await pickDriveItem({ title: 'Collega un file da OneDrive', start });
    if (!item) return;
    await post(`/api/projects/${projectId}/files`, { drive_id: item.driveId, item_id: item.id, name: item.name, web_url: item.webUrl, size: item.size });
    toast('File collegato');
    load();
  } } }, icon('link'), 'Collega da OneDrive');
  clear(container).append(
    h('div.toolbar', uploadButton(`/api/projects/${projectId}/files/upload`, projectId, { onDone: load, label: '↑ Carica file nel progetto' }), link,
      h('span.grow'), h('span.muted.small', 'Qui compaiono anche i file delle attività.')),
    box);

  async function load() {
    box.replaceChildren(loading());
    const { files, ticketFiles } = await get(`/api/projects/${projectId}/files`);
    clear(box);
    if (!files.length && !ticketFiles.length) {
      box.append(h('div.empty', 'Nessun documento ancora.'));
      return;
    }
    if (files.length) {
      box.append(h('div.picker-sep', 'Progetto'), files.map(f => fileRow(f, {
        onRemove: async () => { await del(`/api/projects/${projectId}/files/${f.id}`); load(); },
      })));
    }
    if (ticketFiles.length) {
      box.append(h('div.picker-sep', 'Attività'), ticketFiles.map(f => fileRow(f, { note: f.ticket_title })));
    }
  }
  load();
  return { reload: load };
}
