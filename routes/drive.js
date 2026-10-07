// OneDrive: sfoglia il proprio OneDrive e i file condivisi, cerca, scarica, carica, crea cartelle.
const express = require('express');
const { HttpError, v } = require('../lib/http');
const { graph, graphAll, odataString } = require('../lib/graph');
const { uploadFile } = require('../lib/onedrive');

const SELECT = 'id,name,size,folder,file,lastModifiedDateTime,lastModifiedBy,webUrl,parentReference,remoteItem';

function mapItem(it) {
  const r = it.remoteItem; // elementi condivisi: i dati veri stanno in remoteItem
  const src = r || it;
  return {
    id: src.id,
    driveId: src.parentReference?.driveId || it.parentReference?.driveId,
    name: it.name || src.name,
    folder: Boolean(src.folder),
    childCount: src.folder?.childCount ?? null,
    size: src.size ?? null,
    mimeType: src.file?.mimeType || null,
    modified: src.lastModifiedDateTime || it.lastModifiedDateTime,
    modifiedBy: src.lastModifiedBy?.user?.displayName || null,
    webUrl: src.webUrl || it.webUrl,
    shared: Boolean(r),
  };
}

// driveId + itemId → percorso Graph; senza driveId è il proprio OneDrive.
function itemPath(drive, item) {
  const d = v.text(drive, 'drive', { max: 300 });
  const i = v.text(item, 'elemento', { max: 300 });
  if (!d && !i) return '/me/drive/root';
  if (!d || !i) throw new HttpError(400, 'Cartella non valida');
  return `/drives/${encodeURIComponent(d)}/items/${encodeURIComponent(i)}`;
}

const sortItems = items => items.sort((a, b) => (b.folder - a.folder) || a.name.localeCompare(b.name, 'it'));

function registerDrive(app, { auth }) {
  app.get('/api/drive/items', async (req, res) => {
    const token = await auth.graphToken(req.user.id);
    const base = itemPath(req.query.drive, req.query.item);
    const [self, children] = await Promise.all([
      graph(token, 'GET', `${base}?$select=id,name,webUrl,parentReference,folder`),
      graphAll(token, `${base}/children?$select=${SELECT}&$top=200`, { max: 2000 }),
    ]);
    res.json({
      folder: { id: self.id, driveId: self.parentReference?.driveId, name: self.name, webUrl: self.webUrl, path: self.parentReference?.path || null },
      items: sortItems(children.map(mapItem)),
    });
  });

  app.get('/api/drive/shared', async (req, res) => {
    const token = await auth.graphToken(req.user.id);
    const items = await graphAll(token, '/me/drive/sharedWithMe?$top=200', { max: 500 }).catch(() => []);
    res.json({ items: sortItems(items.map(mapItem)) });
  });

  app.get('/api/drive/recent', async (req, res) => {
    const token = await auth.graphToken(req.user.id);
    const data = await graph(token, 'GET', '/me/drive/recent?$top=50');
    res.json({ items: (data.value || []).map(mapItem) });
  });

  app.get('/api/drive/search', async (req, res) => {
    const q = v.text(req.query.q, 'ricerca', { max: 200, required: true });
    const token = await auth.graphToken(req.user.id);
    const items = await graphAll(token, `/me/drive/root/search(q='${encodeURIComponent(odataString(q))}')?$select=${SELECT}&$top=100`, { max: 200 });
    res.json({ items: sortItems(items.map(mapItem)) });
  });

  // Scarica: reindirizza al link temporaneo di Microsoft (non passa dal nostro server).
  app.get('/api/drive/download', async (req, res) => {
    const token = await auth.graphToken(req.user.id);
    const it = await graph(token, 'GET', `${itemPath(req.query.drive, req.query.item)}?$select=id,name,file`);
    const url = it['@microsoft.graph.downloadUrl'];
    if (!url) throw new HttpError(400, 'Questo elemento non si può scaricare');
    res.redirect(url);
  });

  app.post('/api/drive/folder', async (req, res) => {
    const name = v.text(req.body?.name, 'nome', { max: 250, required: true });
    if (/[\\/:*?"<>|]/.test(name)) throw new HttpError(400, 'Il nome contiene caratteri non ammessi');
    const token = await auth.graphToken(req.user.id);
    const created = await graph(token, 'POST', `${itemPath(req.body?.drive, req.body?.item)}/children`, {
      body: { name, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' },
    });
    res.status(201).json(mapItem(created));
  });

  // Caricamento: corpo binario, ?drive=&item= (cartella di destinazione) &name=.
  app.post('/api/drive/upload', express.raw({ type: () => true, limit: '250mb' }), async (req, res) => {
    const name = v.text(req.query.name, 'nome', { max: 250, required: true });
    if (/[\\/:*?"<>|]/.test(name)) throw new HttpError(400, 'Il nome del file contiene caratteri non ammessi');
    const token = await auth.graphToken(req.user.id);
    const item = await uploadFile(token, itemPath(req.query.drive, req.query.item), { name, data: req.body });
    res.status(201).json(mapItem(item));
  });
}

module.exports = { registerDrive, mapItem, itemPath };
