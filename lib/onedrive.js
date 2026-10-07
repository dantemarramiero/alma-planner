// Caricamento di un file su OneDrive/SharePoint dentro una cartella, con eventuali sottocartelle
// (create da Graph se mancano). Fino a 4 MB in un colpo, oltre con una sessione di caricamento.
const { HttpError } = require('./http');
const { graph } = require('./graph');

const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
const CHUNK = 320 * 1024 * 12; // i blocchi delle sessioni di caricamento devono essere multipli di 320 KiB
const BAD_CHARS = /[\\/:*?"<>|#%]/g;

// Nome valido per OneDrive (file o cartella).
const safeName = s => String(s).replace(BAD_CHARS, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 200) || 'senza nome';

// parentPath: percorso Graph della cartella (es. /drives/{d}/items/{i}); subfolders: nomi di sottocartelle.
async function uploadFile(token, parentPath, { name, data, subfolders = [] }) {
  if (!Buffer.isBuffer(data)) throw new HttpError(400, 'File mancante');
  const rel = [...subfolders.map(safeName), name].map(encodeURIComponent).join('/');
  const target = `${parentPath}:/${rel}:`;
  if (data.length <= SIMPLE_UPLOAD_MAX) {
    return graph(token, 'PUT', `${target}/content?@microsoft.graph.conflictBehavior=rename`, {
      body: data, raw: true, headers: { 'Content-Type': 'application/octet-stream' },
    });
  }
  const session = await graph(token, 'POST', `${target}/createUploadSession`, {
    body: { item: { '@microsoft.graph.conflictBehavior': 'rename' } },
  });
  let item;
  for (let off = 0; off < data.length; off += CHUNK) {
    const chunk = data.subarray(off, Math.min(off + CHUNK, data.length));
    const r = await fetch(session.uploadUrl, { // URL pre-autorizzato: niente header Authorization
      method: 'PUT',
      headers: { 'Content-Length': String(chunk.length), 'Content-Range': `bytes ${off}-${off + chunk.length - 1}/${data.length}` },
      body: chunk,
    });
    if (!r.ok) throw new HttpError(502, `Caricamento interrotto (${r.status})`);
    if (r.status === 200 || r.status === 201) item = await r.json();
  }
  return item;
}

module.exports = { uploadFile, safeName };
