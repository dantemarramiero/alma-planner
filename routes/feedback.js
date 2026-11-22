// Feedback su Alma Space (ALM2-56), per tutti: «Feedback su Alma Space» in fondo alla barra laterale (sul telefono
// da Io) manda un problema tecnico o un suggerimento sulla procedura, con fino a 3 foto dello schermo, a Linear.
// «I miei feedback» mostra l'esito che torna da Linear.
const { HttpError, v } = require('../lib/http');
const { rateLimit } = require('../lib/security');
const linear = require('../lib/linear');
const { sendToLinear, syncFeedback } = require('../lib/feedback');

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const REFRESH_MS = 2 * 60 * 1000; // «I miei feedback» rilegge Linear se l'ultimo giro è più vecchio di 2 minuti

// foto in arrivo come { name, mime, base64 } (scelte o incollate con Ctrl+V)
function readImages(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new HttpError(400, 'Le foto non sono valide');
  if (list.length > MAX_IMAGES) throw new HttpError(400, `Puoi aggiungere al massimo ${MAX_IMAGES} foto`);
  return list.map((img, i) => {
    const mime = String(img?.mime || '').toLowerCase();
    if (!IMAGE_MIME.includes(mime)) throw new HttpError(400, 'La foto dev\'essere un\'immagine PNG, JPG, WebP o GIF');
    if (typeof img.base64 !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(img.base64)) throw new HttpError(400, 'La foto non è valida');
    const data = Buffer.from(img.base64, 'base64');
    if (!data.length) throw new HttpError(400, 'La foto è vuota');
    if (data.length > MAX_IMAGE_BYTES) throw new HttpError(400, 'Ogni foto può essere al massimo di 5 MB');
    const base = String(img.name || '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    return { name: base && /\.\w+$/.test(base) ? base : `foto-schermo-${i + 1}.${EXT[mime]}`, mime, data };
  });
}

function registerFeedback(app, { db, notifier }) {
  // pochi invii al minuto per persona (le foto pesano)
  const limit = rateLimit({ windowMs: 60 * 1000, max: 5, key: req => req.user?.id, message: 'Hai mandato molti feedback di fila: riprova tra un minuto' });
  let lastSync = 0;
  const sync = () => { lastSync = Date.now(); return syncFeedback(db, notifier); };

  app.post('/api/feedback', limit, async (req, res) => {
    const b = req.body || {};
    const kind = v.oneOf(b.kind, 'tipo', ['tecnico', 'procedura']);
    if (!kind) throw new HttpError(400, 'Scegli se è un problema tecnico o un suggerimento sulla procedura');
    const body = v.text(b.body, 'cosa succede', { max: 5000 }) || '';
    if (body.length < 5) throw new HttpError(400, 'Scrivi in qualche parola cosa succede');
    const page = (v.text(b.page, 'pagina', { max: 300 }) || '').replace(/\s+/g, ' ');
    const images = readImages(b.images);
    const userAgent = String(req.get('user-agent') || '').slice(0, 400);

    const f = await db.tx(async q => {
      const { rows: [row] } = await q.query(
        'INSERT INTO feedback (user_id, kind, body, page, user_agent) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [req.user.id, kind, body, page, userAgent]);
      for (const img of images) {
        await q.query('INSERT INTO feedback_images (feedback_id, name, mime, data) VALUES ($1, $2, $3, $4)', [row.id, img.name, img.mime, img.data]);
      }
      return row;
    });

    // subito su Linear; se non risponde (o non è collegato) il feedback resta salvato e parte al giro dopo
    let sent = null;
    if (linear.configured()) {
      try { sent = await sendToLinear(db, f.id); } catch (err) { console.warn(`[feedback] ${f.id} non mandato a Linear: ${err.message}`); }
    }
    res.status(201).json(sent?.linear_identifier
      ? { id: f.id, sent: true, identifier: sent.linear_identifier }
      : { id: f.id, sent: false, identifier: null, message: 'Feedback salvato: lo mandiamo a Linear appena possibile.' });
  });

  app.get('/api/feedback/mine', async (req, res) => {
    if (linear.configured() && Date.now() - lastSync > REFRESH_MS) {
      await sync().catch(err => console.warn('[feedback] Linear non aggiornato', err.message));
    }
    const { rows } = await db.query(
      `SELECT id, kind, body, page, outcome, outcome_reason, linear_identifier, created_at
         FROM feedback WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200`, [req.user.id]);
    res.json({ feedback: rows });
  });

  // esiti da Linear e invii rimandati: ogni 15 minuti (se Linear è collegato)
  setInterval(() => sync().catch(err => console.warn('[feedback] Linear non aggiornato', err.message)), 15 * 60 * 1000).unref();
}

module.exports = { registerFeedback, readImages, MAX_IMAGES };
