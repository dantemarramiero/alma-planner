// Caricamento di file su OneDrive dall'app (documenti del progetto, file dei ticket, pagina OneDrive):
// più file e intere cartelle (trascinate o scelte, con le loro sottocartelle), una barra di avanzamento per file,
// errori mostrati accanto al file. Il server mette ogni file nella cartella giusta (vedi lib/onedrive.js).
import { h, toast } from './ui.js';
import { icon, fileIconName } from './icons.js';

const MAX_SIZE = 250 * 1024 * 1024;
const withParams = (url, params) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return q ? `${url}${url.includes('?') ? '&' : '?'}${q}` : url;
};

// Un file con l'avanzamento (fetch non lo dà, XMLHttpRequest sì). Risolve con la risposta, rifiuta con il messaggio.
function sendFile(url, file, path, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', withParams(url, { name: file.name, path }));
    xhr.setRequestHeader('X-Alma', '1');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* risposta non JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data || {});
      else if (xhr.status === 401 && (data?.code === 'login' || data?.code === 'reauth')) {
        location.href = `/auth/login?returnTo=${encodeURIComponent('/app' + location.hash)}`;
        reject(new Error('Serve un nuovo accesso con Microsoft'));
      } else reject(new Error(data?.error || `Caricamento non riuscito (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Connessione interrotta: riprova'));
    xhr.send(file);
  });
}

// Da un trascinamento: file e cartelle (con tutto il contenuto). Ritorna [{ file, path }], path = cartella relativa.
export async function droppedEntries(dataTransfer) {
  const roots = [...(dataTransfer.items || [])].map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (!roots.length) return [...(dataTransfer.files || [])].map(file => ({ file, path: '' }));
  const out = [];
  const readAll = reader => new Promise((resolve, reject) => {
    const all = [];
    const next = () => reader.readEntries(batch => { if (!batch.length) resolve(all); else { all.push(...batch); next(); } }, reject);
    next();
  });
  async function walk(entry, dir) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      out.push({ file, path: dir });
    } else if (entry.isDirectory) {
      const here = dir ? `${dir}/${entry.name}` : entry.name;
      for (const child of await readAll(entry.createReader())) await walk(child, here);
    }
  }
  for (const r of roots) await walk(r, '');
  return out;
}

// Da un <input type=file> (anche con webkitdirectory): il percorso viene da webkitRelativePath.
export const pickedEntries = files => [...files].map(file => {
  const rel = file.webkitRelativePath || '';
  return { file, path: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '' };
});

// Carica uno dopo l'altro, mostrando ogni file in «queue» con la sua barra. Restituisce quanti sono andati bene.
export async function uploadFiles(url, entries, queue) {
  const list = entries.map(e => (e instanceof File ? { file: e, path: '' } : e));
  let ok = 0, created = null, shared = 0;
  const folders = new Set(list.map(e => e.path.split('/')[0]).filter(Boolean));
  for (const { file: f, path } of list) {
    const bar = h('i');
    const status = h('span.up-st', 'in attesa');
    const label = path ? `${path}/${f.name}` : f.name;
    const row = h('div.up-row', h('span.f-ico', icon(fileIconName(f.name))), h('span.up-name', { title: label }, label), h('span.up-bar', bar), status);
    queue?.append(row);
    if (f.size > MAX_SIZE) { row.classList.add('err'); status.textContent = 'oltre 250 MB: caricalo da OneDrive'; continue; }
    if (!f.size) { row.classList.add('err'); status.textContent = 'file vuoto: saltato'; continue; }
    try {
      const r = await sendFile(url, f, path, x => { bar.style.width = `${Math.round(x * 100)}%`; status.textContent = `${Math.round(x * 100)}%`; });
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
  const what = folders.size ? `${ok} file${folders.size === 1 ? ` nella cartella «${[...folders][0]}»` : ` in ${folders.size} cartelle`}` : ok === 1 ? 'File caricato' : `${ok} file caricati`;
  if (created) toast(`Creata la cartella «${created}» nel tuo OneDrive${shared ? ` e condivisa con ${shared} ${shared === 1 ? 'persona' : 'persone'} del progetto` : ''}`);
  else if (ok) toast(folders.size ? `Caricati ${what}` : what);
  if (ok < list.length) toast(`${list.length - ok} file non caricati: vedi il motivo accanto a ognuno`, 'err');
  return ok;
}

// Pulsanti «Carica file» e «Carica cartella»: aprono la scelta e caricano su «url», con l'avanzamento in «queue».
export function uploadButtons(url, { onDone, queue, small = true, primary = false } = {}) {
  const q = queue || h('div.up-queue');
  // url può essere una funzione: la destinazione si legge al momento (es. la cartella aperta nella pagina OneDrive)
  const run = async files => { if (files.length && await uploadFiles(typeof url === 'function' ? url() : url, pickedEntries(files), q)) onDone?.(); };
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true, on: { change: e => { const f = [...e.target.files]; e.target.value = ''; run(f); } } });
  const dirInput = h('input', { type: 'file', multiple: true, hidden: true, webkitdirectory: true, on: { change: e => { const f = [...e.target.files]; e.target.value = ''; run(f); } } });
  dirInput.setAttribute('webkitdirectory', '');
  const cls = `button.btn${small ? '.btn-sm' : ''}`;
  return {
    el: h('span.up-wrap',
      h('span.row',
        h(primary ? `${cls}.btn-primary` : cls, { type: 'button', on: { click: () => fileInput.click() } }, icon('upload', { size: 16 }), 'Carica file'),
        h(`${cls}.btn-ghost`, { type: 'button', title: 'Carica una cartella con tutto il suo contenuto', on: { click: () => dirInput.click() } }, icon('folder', { size: 16 }), 'Carica cartella'),
        fileInput, dirInput),
      queue ? null : q),
    queue: q,
  };
}
