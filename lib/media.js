// Immagini dell'intranet (post, storie, foto profilo), salvate nel database.
const { HttpError } = require('./http');

const MAX_BYTES = 12 * 1024 * 1024;

// Il tipo si legge dai primi byte del file, non da quello che dichiara il browser.
function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 6 && buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// pg restituisce Buffer, PGlite Uint8Array.
const toBuffer = data => (Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength));

async function storeImage(db, { ownerId, data, width, height }) {
  if (!Buffer.isBuffer(data) || !data.length) throw new HttpError(400, 'Immagine mancante');
  if (data.length > MAX_BYTES) throw new HttpError(413, 'Immagine troppo grande (massimo 12 MB)');
  const mime = sniffImage(data);
  if (!mime) throw new HttpError(400, 'Formato non supportato: usa JPG, PNG, GIF o WebP');
  const dim = n => (Number.isInteger(n) && n > 0 && n < 20000 ? n : null);
  const { rows } = await db.query(
    'INSERT INTO media (owner_id, mime, data, width, height) VALUES ($1, $2, $3, $4, $5) RETURNING id, width, height',
    [ownerId, mime, data, dim(width), dim(height)]);
  return rows[0];
}

// Controlla che le immagini siano state caricate da chi le usa.
async function checkOwnMedia(q, ids, userId) {
  if (!ids.length) return;
  const { rows } = await q.query(
    'SELECT COUNT(*)::int AS n FROM media WHERE id = ANY($1::int[]) AND owner_id = $2', [ids, userId]);
  if (rows[0].n !== ids.length) throw new HttpError(400, 'Una delle immagini non è valida');
}

// Al primo accesso con Microsoft la foto del profilo arriva da Microsoft 365, se c'è. Mai bloccante.
async function importMicrosoftPhoto(db, userId, accessToken) {
  const { rows } = await db.query('SELECT avatar_id FROM users WHERE id = $1', [userId]);
  if (!rows[0] || rows[0].avatar_id) return;
  const res = await fetch('https://graph.microsoft.com/v1.0/me/photos/240x240/$value', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return;
  const data = Buffer.from(await res.arrayBuffer());
  if (!sniffImage(data)) return;
  const m = await storeImage(db, { ownerId: userId, data, width: 240, height: 240 });
  await db.query('UPDATE users SET avatar_id = $1 WHERE id = $2 AND avatar_id IS NULL', [m.id, userId]);
}

// Pulizia: storie scadute da più di un giorno, poi le immagini caricate e mai usate.
async function purgeMedia(db) {
  await db.query("DELETE FROM stories WHERE expires_at < now() - interval '1 day'");
  await db.query(`DELETE FROM media m WHERE m.created_at < now() - interval '1 day'
    AND NOT EXISTS (SELECT 1 FROM post_media x WHERE x.media_id = m.id)
    AND NOT EXISTS (SELECT 1 FROM stories x WHERE x.media_id = m.id)
    AND NOT EXISTS (SELECT 1 FROM users x WHERE x.avatar_id = m.id)`);
}

module.exports = { sniffImage, toBuffer, storeImage, checkOwnMedia, importMicrosoftPhoto, purgeMedia, MAX_BYTES };
