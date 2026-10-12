// OneDrive/SharePoint: caricamento di un file dentro una cartella (con eventuali sottocartelle, create da Graph se
// mancano), cartella del progetto creata al primo caricamento, condivisione con le persone del progetto.
// Fino a 4 MB in un colpo, oltre con una sessione di caricamento.
const { HttpError } = require('./http');
const { graph } = require('./graph');

const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
const CHUNK = 320 * 1024 * 12; // i blocchi delle sessioni di caricamento devono essere multipli di 320 KiB
const BAD_CHARS = /[\\/:*?"<>|#%]/g;
const ROOT_FOLDER = 'Alma Planet'; // nel OneDrive di chi carica per primo: Alma Planet/<nome del progetto>

// Nome valido per OneDrive (file o cartella): i caratteri non ammessi diventano «-».
const safeName = s => String(s).replace(BAD_CHARS, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 200) || 'senza nome';

// Errori di Microsoft tradotti per chi carica: 403/404 su OneDrive = niente accesso o niente OneDrive nella licenza.
function driveError(err) {
  if (err instanceof HttpError && (err.status === 403 || err.status === 404)) {
    return new HttpError(err.status === 403 ? 403 : 404,
      'OneDrive non ti dà accesso a questa cartella. Chiedi a chi l\'ha creata di condividerla con te; se non hai OneDrive (licenza «solo posta»), chiedi la licenza all\'amministratore.', 'drive_access');
  }
  return err;
}

// parentPath: percorso Graph della cartella (es. /drives/{d}/items/{i}); subfolders: nomi di sottocartelle.
async function uploadFile(token, parentPath, { name, data, subfolders = [] }) {
  if (!Buffer.isBuffer(data) || !data.length) throw new HttpError(400, 'Il file è vuoto o non è arrivato');
  const rel = [...subfolders, name].map(safeName).map(encodeURIComponent).join('/');
  const target = `${parentPath}:/${rel}:`;
  try {
    if (data.length <= SIMPLE_UPLOAD_MAX) {
      return await graph(token, 'PUT', `${target}/content?@microsoft.graph.conflictBehavior=rename`, {
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
      if (!r.ok) throw new HttpError(502, `Caricamento interrotto da OneDrive (${r.status}): riprova`);
      if (r.status === 200 || r.status === 201) item = await r.json();
    }
    return item;
  } catch (err) { throw driveError(err); }
}

// Crea (o ritrova) la cartella «Alma Planet/<progetto>» nel OneDrive di chi carica e ne restituisce i dati.
// Prima si cerca la cartella per percorso, e la si crea solo se manca (mai «replace»: svuoterebbe quella esistente).
async function ensureFolder(token, projectName) {
  const path = [ROOT_FOLDER, safeName(projectName)];
  try {
    let parent = await graph(token, 'GET', '/me/drive/root?$select=id,parentReference');
    let driveId = parent.parentReference.driveId;
    let folder = null;
    for (const name of path) {
      const base = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parent.id)}`;
      folder = await graph(token, 'GET', `${base}:/${encodeURIComponent(name)}?$select=id,name,webUrl,parentReference,folder`)
        .catch(err => { if (err.status === 404) return null; throw err; });
      if (!folder) folder = await graph(token, 'POST', `${base}/children`, { body: { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' } });
      driveId = folder.parentReference?.driveId || driveId;
      parent = folder;
    }
    return { driveId, id: folder.id, name: folder.name, webUrl: folder.webUrl };
  } catch (err) { throw driveError(err); }
}

// Condivide la cartella (in modifica) con queste email, senza mandare email di invito. Non blocca mai: chi non
// può condividere (non è proprietario) riceve solo un avviso nel registro.
async function shareFolder(token, driveId, itemId, emails) {
  const list = [...new Set(emails.filter(Boolean).map(e => e.toLowerCase()))];
  if (!list.length || !driveId || !itemId) return 0;
  try {
    await graph(token, 'POST', `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/invite`, {
      body: { recipients: list.map(email => ({ email })), roles: ['write'], requireSignIn: true, sendInvitation: false },
    });
    return list.length;
  } catch (err) {
    console.warn(`[onedrive] condivisione della cartella non riuscita: ${err.message}`);
    return 0;
  }
}

module.exports = { uploadFile, ensureFolder, shareFolder, safeName, driveError };
