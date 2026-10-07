// Attività del Gantt create a mano: scheda (inizio, fine, responsabili, avanzamento, file) e file del progetto.
import { h, clear, modal, confirmDialog, toast, fmtDate, fmtDateTime, today, addDays, loading } from './ui.js';
import { get, post, patch, del, api, qs } from './api.js';
import { store, projectById } from './store.js';
import { peoplePicker, avatarsFor } from './people.js';
import { pickDriveItem } from './drive.js';

const fileIcon = name => (/\.(xlsx?|csv)$/i.test(name) ? '📊' : /\.(docx?|rtf)$/i.test(name) ? '📝' : /\.pdf$/i.test(name) ? '📕' : /\.(png|jpe?g|gif|webp|heic)$/i.test(name) ? '🖼' : '📎');

// Carica file dal computer nella cartella OneDrive del progetto (activityId: sottocartella dell'attività).
export function uploadButton(projectId, { activityId = null, onDone, label = '↑ Carica file' } = {}) {
  const input = h('input', { type: 'file', multiple: true, hidden: true, on: { change: async e => {
    const files = [...e.target.files];
    e.target.value = '';
    let ok = 0;
    for (const f of files) {
      if (f.size > 250 * 1024 * 1024) { toast(`${f.name}: oltre 250 MB, caricalo da OneDrive`, 'err'); continue; }
      toast(`Caricamento di ${f.name}…`);
      try {
        await api('POST', `/api/projects/${projectId}/files/upload${qs({ name: f.name, activity: activityId })}`, f,
          { raw: true, headers: { 'Content-Type': 'application/octet-stream' } });
        ok++;
      } catch { /* l'errore è già mostrato */ }
    }
    if (ok) { toast(ok === 1 ? 'File caricato' : `${ok} file caricati`); onDone?.(); }
  } } });
  const p = projectById(projectId);
  const btn = h('button.btn.btn-sm', { type: 'button', on: { click: () => {
    if (!store.me.microsoft) return toast('OneDrive non è ancora collegato', 'err');
    if (!projectById(projectId)?.onedrive_item_id) return toast('Collega prima una cartella OneDrive al progetto (sezione «Cartella OneDrive»)', 'err');
    input.click();
  } }, title: p?.onedrive_name ? `Nella cartella «${p.onedrive_name}»` : '' }, label);
  return h('span', btn, input);
}

export function linkButton(projectId, { activityId = null, onDone } = {}) {
  return h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
    const p = projectById(projectId);
    const start = p?.onedrive_item_id ? { driveId: p.onedrive_drive_id, id: p.onedrive_item_id, name: p.onedrive_name } : null;
    const item = await pickDriveItem({ title: 'Collega un file da OneDrive', start });
    if (!item) return;
    await post(`/api/projects/${projectId}/files`, { drive_id: item.driveId, item_id: item.id, name: item.name, web_url: item.webUrl, size: item.size, activity_id: activityId });
    toast('File collegato');
    onDone?.();
  } } }, '🔗 Collega da OneDrive');
}

export function fileRow(f, { onRemove, note } = {}) {
  return h('div.file-row', h('span', fileIcon(f.name)),
    h('a', { href: f.web_url || '#', target: '_blank', rel: 'noopener' }, f.name),
    note ? h('span.pill', note) : null,
    h('span.muted.small', [f.added_by_name, f.created_at ? fmtDateTime(f.created_at) : null].filter(Boolean).join(' · ')),
    onRemove ? h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Scollega (il file resta su OneDrive)', on: { click: onRemove } }, '×') : null);
}

// ── scheda dell'attività ───────────────────────────────────────────────────
export async function openActivity(id, { projectId, defaults = {}, onSaved } = {}) {
  const isNew = !id;
  let a = isNew
    ? { title: '', description: '', start_date: today(), end_date: addDays(today(), 4), progress: 0, assignee_ids: [store.me.id], files: [], project_id: projectId, ...defaults }
    : await get(`/api/activities/${id}`);
  const pid = a.project_id;
  let changed = false;

  const title = h('input.title-input', { value: a.title, placeholder: 'Nome dell\'attività', autofocus: isNew });
  const start = h('input.input', { type: 'date', value: a.start_date, required: true });
  const end = h('input.input', { type: 'date', value: a.end_date, required: true });
  const progressVal = h('span.muted', `${a.progress}%`);
  const progress = h('input.range', { type: 'range', min: '0', max: '100', step: '5', value: String(a.progress), on: { input: e => { progressVal.textContent = `${e.target.value}%`; } } });
  const people = peoplePicker({ selected: a.assignee_ids, label: '+ Responsabile' });
  const desc = h('textarea.input', { rows: 4, placeholder: 'Cosa prevede, note…' }, a.description);
  start.addEventListener('change', () => { if (end.value && end.value < start.value) end.value = start.value; });

  const filesBox = h('div');

  async function save({ close = true } = {}) {
    const payload = {
      title: title.value, description: desc.value, start_date: start.value, end_date: end.value,
      progress: Number(progress.value), assignee_ids: people.value,
    };
    if (!payload.title.trim()) { toast('Scrivi il nome dell\'attività', 'err'); title.focus(); return null; }
    if (!payload.start_date || !payload.end_date) { toast('Un\'attività ha sempre inizio e fine', 'err'); return null; }
    if (!payload.assignee_ids.length) { toast('Indica almeno un responsabile', 'err'); return null; }
    const saved = isNew ? await post(`/api/projects/${pid}/activities`, payload) : await patch(`/api/activities/${a.id}`, payload);
    changed = true;
    if (close) { m.close(); toast(isNew ? 'Attività creata' : 'Attività salvata'); }
    return saved;
  }

  const m = modal({
    drawer: true,
    title: h('span.muted', `${isNew ? 'Nuova attività' : 'Attività'} · ${projectById(pid)?.name || a.project_name || ''}`),
    body: [
      title,
      h('div.grid-2',
        h('label.field', h('span', 'Inizio'), start),
        h('label.field', h('span', 'Fine'), end)),
      h('div.field', h('span', 'Responsabili'), people.el),
      h('label.field', h('span', h('span', 'Avanzamento '), progressVal), progress),
      h('label.field', h('span', 'Descrizione'), desc),
      filesBox,
    ],
    left: isNew ? [] : [h('button.btn.btn-danger', { type: 'button', on: { click: async () => {
      if (!await confirmDialog(`Cancellare l'attività «${a.title}»? I file restano su OneDrive.`, { ok: 'Cancella', danger: true })) return;
      await del(`/api/activities/${a.id}`);
      changed = true;
      m.close();
      toast('Attività cancellata');
    } } }, 'Cancella')],
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi'),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => save() } }, isNew ? 'Crea attività' : 'Salva'),
    ],
    onClose: () => { if (changed) onSaved?.(); },
  });
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

  drawFiles();

  async function refresh() {
    a = await get(`/api/activities/${a.id}`);
    changed = true;
    drawFiles();
  }

  function drawFiles() {
    clear(filesBox);
    const head = h('div.spread', h('h3', `File dell'attività${a.files.length ? ` (${a.files.length})` : ''}`));
    filesBox.append(h('div.section', head));
    if (isNew) {
      filesBox.append(h('div.muted.small', 'Crea l\'attività, poi potrai allegare i file.'));
      return;
    }
    head.append(h('div.row', uploadButton(pid, { activityId: a.id, onDone: refresh }), linkButton(pid, { activityId: a.id, onDone: refresh })));
    if (!a.files.length) filesBox.append(h('div.muted.small', `Nessun file. Quelli caricati finiscono nella cartella del progetto, sottocartella «Attività ${a.id} - …».`));
    for (const f of a.files) {
      filesBox.append(fileRow(f, { onRemove: async () => { await del(`/api/projects/${pid}/files/${f.id}`); refresh(); } }));
    }
  }
}

// ── documenti del progetto (pagina progetto) ───────────────────────────────
export async function projectDocuments(container, projectId) {
  const box = h('div.card', { style: { padding: '6px 14px' } });
  clear(container).append(
    h('div.toolbar', uploadButton(projectId, { onDone: load, label: '↑ Carica file nel progetto' }), linkButton(projectId, { onDone: load }),
      h('span.grow'), h('span.muted.small', 'I file delle attività e dei ticket compaiono qui insieme a quelli del progetto.')),
    box);

  async function load() {
    box.replaceChildren(loading());
    const { files, ticketFiles } = await get(`/api/projects/${projectId}/files`);
    clear(box);
    if (!files.length && !ticketFiles.length) {
      box.append(h('div.empty', 'Nessun documento ancora.'));
      return;
    }
    const remove = f => async () => { await del(`/api/projects/${projectId}/files/${f.id}`); load(); };
    const own = files.filter(f => !f.activity_id);
    const byActivity = files.filter(f => f.activity_id);
    if (own.length) box.append(h('div.picker-sep', 'Progetto'), own.map(f => fileRow(f, { onRemove: remove(f) })));
    if (byActivity.length) box.append(h('div.picker-sep', 'Attività'), byActivity.map(f => fileRow(f, { onRemove: remove(f), note: f.activity_title })));
    if (ticketFiles.length) box.append(h('div.picker-sep', 'Ticket'), ticketFiles.map(f => fileRow(f, { note: f.ticket_title })));
  }
  load();
  return { reload: load };
}

// ── «I miei ticket»: attività di progetto di cui sono responsabile ─────────
export async function myActivities(container) {
  const list = await get('/api/activities?assignee=me');
  clear(container);
  if (!list.length) return;
  const late = x => x.end_date < today();
  container.append(h('div.section', h('div.spread', h('h2', 'Le mie attività di progetto')),
    h('div.card.table-wrap', h('table.list',
      h('thead', h('tr', h('th', 'Attività'), h('th', 'Progetto'), h('th', 'Responsabili'), h('th', 'Dal'), h('th', 'Al'), h('th', 'Avanzamento'))),
      h('tbody', list.map(x => h('tr', { on: { click: () => openActivity(x.id, { onSaved: () => myActivities(container) }) } },
        h('td', h('div.t-title', x.title), x.file_count ? h('div.t-meta', `📎 ${x.file_count}`) : null),
        h('td', h('a', { href: `#/projects/${x.project_id}`, on: { click: e => e.stopPropagation() } }, x.project_name)),
        h('td', avatarsFor(x.assignee_ids)),
        h('td', fmtDate(x.start_date)),
        h('td', { class: late(x) ? 'due-late' : '' }, fmtDate(x.end_date)),
        h('td', `${x.progress}%`))))))));
}
