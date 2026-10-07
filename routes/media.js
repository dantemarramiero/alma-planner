// Caricamento e lettura delle immagini dell'intranet.
const express = require('express');
const { HttpError, v } = require('../lib/http');
const { storeImage, toBuffer, MAX_BYTES } = require('../lib/media');

function registerMedia(app, { db }) {
  app.post('/api/media', express.raw({ type: () => true, limit: MAX_BYTES }), async (req, res) => {
    const width = v.int(req.query.w, 'larghezza', { min: 1, max: 20000 });
    const height = v.int(req.query.h, 'altezza', { min: 1, max: 20000 });
    const m = await storeImage(db, { ownerId: req.user.id, data: req.body, width, height });
    res.status(201).json(m);
  });

  app.get('/api/media/:id', async (req, res) => {
    const id = v.int(req.params.id, 'immagine', { min: 1 });
    const { rows } = await db.query(
      `SELECT m.mime, m.data FROM media m
        WHERE m.id = $1 AND (m.conversation_id IS NULL OR EXISTS (
          SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = m.conversation_id AND cm.user_id = $2))`,
      [id, req.user.id]);
    if (!rows[0]) throw new HttpError(404, 'Immagine non trovata');
    // L'id non cambia mai contenuto: il browser può tenerla in cache a lungo.
    res.set({ 'Content-Type': rows[0].mime, 'Cache-Control': 'private, max-age=31536000, immutable' });
    res.send(toBuffer(rows[0].data));
  });
}

module.exports = { registerMedia };
