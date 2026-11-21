// Storie dai cantieri (Dante 21/11/2026, canvas app 3.0 righe C1–C5; lato BOSS: BSAL-1725).
// - I cantieri sono le commesse di BOSS: copia in sola lettura sincronizzata da BOSS quando BOSS espone l'elenco
//   (BOSS_CANTIERI_URL + BOSS_CANTIERI_TOKEN); fino ad allora la direzione li inserisce a mano e il codice commessa
//   fa da chiave per unirli alla prima sincronizzazione.
// - Una foto = una riga di cantiere_foto (per sempre: il diario) + la storia del cantiere per 24 ore + il post del
//   giorno del cantiere in «Dai cantieri» (un post al giorno per cantiere, con tutte le foto del giorno).
// - Nasconde una foto chi l'ha scattata, il capo cantiere o la direzione.
const { HttpError, v } = require('../lib/http');
const { checkOwnMedia, toBuffer } = require('../lib/media');
const { makeZip } = require('../lib/zip');
const { givenName } = require('../lib/nome');

const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const dayOf = x => (x ? (x instanceof Date ? x.toLocaleDateString('sv-SE') : String(x)).slice(0, 10) : null);
const lower = s => String(s || '').trim().toLowerCase();
const num = (val, field, min, max) => {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${field} non valida`);
  return n;
};
// distanza in metri tra due punti (formula dell'emisenoverso)
function meters(a, b) {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 6371000, rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function cantiereFields(b, { partial }) {
  const f = {};
  const set = (k, val) => { if (val !== undefined) f[k] = val; };
  set('code', v.text(b.code, 'Codice commessa', { max: 60, required: !partial }));
  set('name', v.text(b.name, 'Nome', { max: 200, required: !partial }));
  set('client', v.text(b.client, 'Committente', { max: 200 }));
  set('address', v.text(b.address, 'Indirizzo', { max: 300 }));
  if (b.lat !== undefined) f.lat = num(b.lat, 'Latitudine', -90, 90);
  if (b.lng !== undefined) f.lng = num(b.lng, 'Longitudine', -180, 180);
  if (b.chief_email !== undefined) f.chief_email = lower(v.text(b.chief_email, 'Capo cantiere', { max: 200 }) || '');
  if (b.member_emails !== undefined) {
    if (!Array.isArray(b.member_emails)) throw new HttpError(400, 'Squadra non valida');
    f.member_emails = [...new Set(b.member_emails.map(lower).filter(e => /^[^@\s]+@[^@\s]+$/.test(e)))].slice(0, 500);
  }
  if (b.status !== undefined) f.status = v.oneOf(b.status, 'Stato', ['aperto', 'chiuso']);
  if (b.starts_on !== undefined) f.starts_on = v.date(b.starts_on, 'Inizio') ?? null;
  if (b.ends_on !== undefined) f.ends_on = v.date(b.ends_on, 'Fine') ?? null;
  return f;
}

function registerCantieri(app, { db, live, isAdmin }) {
  const me = async req => (await db.query('SELECT id, email, name FROM users WHERE id = $1', [req.user.id])).rows[0];
  const byId = async id => {
    const { rows: [c] } = await db.query('SELECT * FROM cantieri WHERE id = $1', [id]);
    if (!c) throw new HttpError(404, 'Cantiere non trovato');
    return c;
  };
  const adminOnly = req => { if (!isAdmin(req)) throw new HttpError(403, 'I cantieri li gestisce la direzione (poi arriveranno da BOSS)'); };

  // elenco per il telefono: prima i cantieri della mia squadra, poi i più vicini; ?tutti=1 anche i chiusi
  app.get('/api/cantieri', async (req, res) => {
    const u = await me(req);
    const here = { lat: num(req.query.lat, 'Latitudine', -90, 90), lng: num(req.query.lng, 'Longitudine', -180, 180) };
    const all = req.query.tutti === '1';
    const { rows } = await db.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM cantiere_foto f WHERE f.cantiere_id = c.id AND f.hidden_at IS NULL) AS photos,
              (SELECT MAX(f.created_at) FROM cantiere_foto f WHERE f.cantiere_id = c.id AND f.hidden_at IS NULL) AS last_photo_at
         FROM cantieri c ${all ? '' : "WHERE c.status = 'aperto'"} ORDER BY lower(c.name)`);
    const mine = lower(u.email);
    const out = rows.map(c => ({ ...c, mine: c.member_emails.includes(mine) || c.chief_email === mine, distance: meters(here, c) }));
    out.sort((a, b) => (a.distance ?? 1e12) - (b.distance ?? 1e12) || Number(b.mine) - Number(a.mine) || String(b.last_photo_at || '').localeCompare(String(a.last_photo_at || '')));
    // il più vicino entro 500 m vince; altrimenti i miei vengono prima
    const near = out[0]?.distance != null && out[0].distance <= 500 ? [out.shift()] : [];
    const rest = [...out.filter(c => c.mine), ...out.filter(c => !c.mine)];
    res.json({ cantieri: [...near, ...rest], here: near[0]?.id || null, can_manage: isAdmin(req) });
  });

  app.post('/api/cantieri', async (req, res) => {
    adminOnly(req);
    const f = cantiereFields(req.body || {}, { partial: false });
    const keys = Object.keys(f);
    try {
      const { rows: [c] } = await db.query(
        `INSERT INTO cantieri (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, keys.map(k => f[k]));
      res.status(201).json(c);
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'C\'è già un cantiere con questo codice commessa');
      throw err;
    }
  });

  app.patch('/api/cantieri/:id', async (req, res) => {
    adminOnly(req);
    const c = await byId(v.int(req.params.id, 'cantiere', { min: 1 }));
    const f = cantiereFields(req.body || {}, { partial: true });
    if (c.source === 'boss') for (const k of ['code', 'name', 'client', 'chief_email', 'member_emails', 'status', 'starts_on', 'ends_on']) delete f[k]; // li comanda BOSS
    const keys = Object.keys(f);
    if (!keys.length) return res.json(c);
    const { rows: [out] } = await db.query(
      `UPDATE cantieri SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, [c.id, ...keys.map(k => f[k])]);
    res.json(out);
  });

  // pubblica una foto: diario + storia + post del giorno del cantiere
  app.post('/api/cantieri/:id/foto', async (req, res) => {
    const c = await byId(v.int(req.params.id, 'cantiere', { min: 1 }));
    if (c.status !== 'aperto') throw new HttpError(400, 'Il cantiere è chiuso');
    const b = req.body || {};
    const mediaId = v.int(b.media_id, 'foto', { min: 1 });
    const caption = v.text(b.caption, 'didascalia', { max: 500 }) || '';
    const lat = num(b.lat, 'Latitudine', -90, 90), lng = num(b.lng, 'Longitudine', -180, 180);
    const day = todayRome();
    const u = await me(req);
    const out = await db.tx(async q => {
      await checkOwnMedia(q, [mediaId], req.user.id);
      // il post del giorno: uno per cantiere e giorno (il primo che scatta ne è l'autore)
      let { rows: [p] } = await q.query('SELECT id FROM posts WHERE cantiere_id = $1 AND cantiere_day = $2', [c.id, day]);
      if (!p) {
        ({ rows: [p] } = await q.query(
          "INSERT INTO posts (author_id, body, kind, cantiere_id, cantiere_day) VALUES ($1, '', 'cantiere', $2, $3) RETURNING id", [req.user.id, c.id, day]));
      }
      const { rows: [pos] } = await q.query('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM post_media WHERE post_id = $1', [p.id]);
      await q.query('INSERT INTO post_media (post_id, media_id, position) VALUES ($1, $2, $3)', [p.id, mediaId, pos.n]);
      const { rows: [f] } = await q.query(
        `INSERT INTO cantiere_foto (cantiere_id, author_id, media_id, caption, lat, lng, day, post_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`, [c.id, req.user.id, mediaId, caption, lat, lng, day, p.id]);
      await rebuildBody(q, p.id);
      return { foto: f, post_id: p.id };
    });
    live?.broadcast('post', { id: out.post_id, author_id: req.user.id }, { except: req.user.id });
    res.status(201).json({ ...out, cantiere: { id: c.id, name: c.name }, author: u.name });
  });

  // il testo del post del giorno: le didascalie con il nome di chi ha scattato
  async function rebuildBody(q, postId) {
    const { rows } = await q.query(
      `SELECT f.caption, u.name, u.email FROM cantiere_foto f LEFT JOIN users u ON u.id = f.author_id
        WHERE f.post_id = $1 AND f.hidden_at IS NULL AND f.caption <> '' ORDER BY f.id`, [postId]);
    const body = rows.map(r => `${givenName(r.name, r.email) || 'Qualcuno'}: ${r.caption}`).join('\n').slice(0, 5000); // «Luca: …», col nome e non il cognome
    await q.query('UPDATE posts SET body = $2 WHERE id = $1', [postId, body]);
  }

  // nascondi (autore, capo cantiere, direzione): sparisce da storia, post e diario
  app.post('/api/cantieri/foto/:id/nascondi', async (req, res) => {
    const id = v.int(req.params.id, 'foto', { min: 1 });
    const { rows: [f] } = await db.query('SELECT f.*, c.chief_email FROM cantiere_foto f JOIN cantieri c ON c.id = f.cantiere_id WHERE f.id = $1', [id]);
    if (!f) throw new HttpError(404, 'Foto non trovata');
    const u = await me(req);
    if (f.author_id !== req.user.id && lower(u.email) !== f.chief_email && !isAdmin(req)) throw new HttpError(403, 'La nasconde chi l\'ha scattata, il capo cantiere o la direzione');
    await db.tx(async q => {
      await q.query('UPDATE cantiere_foto SET hidden_at = now(), hidden_by = $2 WHERE id = $1', [id, req.user.id]);
      if (f.post_id) {
        await q.query('DELETE FROM post_media WHERE post_id = $1 AND media_id = $2', [f.post_id, f.media_id]);
        const { rows: [{ n }] } = await q.query('SELECT COUNT(*)::int AS n FROM post_media WHERE post_id = $1', [f.post_id]);
        if (!n) await q.query('DELETE FROM posts WHERE id = $1', [f.post_id]);
        else await rebuildBody(q, f.post_id);
      }
    });
    res.json({ ok: true });
  });

  const PHOTO_SELECT = `SELECT f.id, f.cantiere_id, f.media_id, f.caption, f.day, f.created_at, f.author_id, u.name AS author_name,
                               m.width, m.height
                          FROM cantiere_foto f LEFT JOIN users u ON u.id = f.author_id JOIN media m ON m.id = f.media_id`;

  // storie: i cantieri con foto nelle ultime 24 ore (le più recenti prima)
  app.get('/api/cantieri/storie', async (req, res) => {
    const { rows } = await db.query(
      `${PHOTO_SELECT} WHERE f.hidden_at IS NULL AND f.created_at > now() - interval '24 hours' ORDER BY f.cantiere_id, f.id`);
    const ids = [...new Set(rows.map(r => r.cantiere_id))];
    const { rows: sites } = ids.length ? await db.query('SELECT id, name, code, address FROM cantieri WHERE id = ANY($1::int[])', [ids]) : { rows: [] };
    const out = sites.map(s => ({ ...s, photos: rows.filter(r => r.cantiere_id === s.id).map(r => ({ ...r, day: dayOf(r.day) })) }))
      .sort((a, b) => String(b.photos.at(-1).created_at).localeCompare(String(a.photos.at(-1).created_at)));
    res.json({ storie: out });
  });

  // diario: scheda del cantiere, numeri e foto per giorno (?prima=AAAA-MM-GG per le pagine successive)
  app.get('/api/cantieri/:id/diario', async (req, res) => {
    const c = await byId(v.int(req.params.id, 'cantiere', { min: 1 }));
    const before = v.date(req.query.prima, 'giorno') ?? null;
    const { rows: [st] } = await db.query(
      `SELECT COUNT(*)::int AS photos, COUNT(DISTINCT author_id)::int AS people, COUNT(DISTINCT day)::int AS days, MIN(day) AS first_day, MAX(day) AS last_day
         FROM cantiere_foto WHERE cantiere_id = $1 AND hidden_at IS NULL`, [c.id]);
    const { rows: days } = await db.query(
      `SELECT DISTINCT day FROM cantiere_foto WHERE cantiere_id = $1 AND hidden_at IS NULL ${before ? 'AND day < $2' : ''} ORDER BY day DESC LIMIT 14`,
      before ? [c.id, before] : [c.id]);
    const list = days.map(d => dayOf(d.day));
    const { rows: photos } = list.length
      ? await db.query(`${PHOTO_SELECT} WHERE f.cantiere_id = $1 AND f.hidden_at IS NULL AND f.day = ANY($2::date[]) ORDER BY f.day DESC, f.id`, [c.id, list])
      : { rows: [] };
    const u = await me(req);
    res.json({
      cantiere: c,
      stats: { ...st, first_day: dayOf(st.first_day), last_day: dayOf(st.last_day) },
      days: list.map(d => ({ day: d, photos: photos.filter(p => dayOf(p.day) === d).map(p => ({ ...p, day: d })) })),
      more: list.length === 14,
      can_hide_all: isAdmin(req) || (c.chief_email && c.chief_email === lower(u.email)),
    });
  });

  // prima e dopo: la prima foto del giorno scelto e l'ultima (default: primo e ultimo giorno)
  app.get('/api/cantieri/:id/linea', async (req, res) => {
    const c = await byId(v.int(req.params.id, 'cantiere', { min: 1 }));
    const { rows } = await db.query(`${PHOTO_SELECT} WHERE f.cantiere_id = $1 AND f.hidden_at IS NULL ORDER BY f.day, f.id`, [c.id]);
    // una foto per giorno (la prima), per il video dell'avanzamento e il prima/dopo
    const seen = new Set();
    const line = rows.filter(r => { const d = dayOf(r.day); if (seen.has(d)) return false; seen.add(d); return true; }).map(r => ({ ...r, day: dayOf(r.day) }));
    res.json({ cantiere: { id: c.id, name: c.name }, line });
  });

  // «Scarica per il SAL»: tutte le foto di un periodo in uno zip (nome = giorno_ora_autore)
  app.get('/api/cantieri/:id/zip', async (req, res) => {
    const c = await byId(v.int(req.params.id, 'cantiere', { min: 1 }));
    const from = v.date(req.query.dal, 'dal') ?? '1900-01-01';
    const to = v.date(req.query.al, 'al') ?? '2999-12-31';
    const { rows } = await db.query(
      `SELECT f.id, f.day, f.created_at, u.name, m.mime, m.data FROM cantiere_foto f JOIN media m ON m.id = f.media_id
         LEFT JOIN users u ON u.id = f.author_id
        WHERE f.cantiere_id = $1 AND f.hidden_at IS NULL AND f.day BETWEEN $2 AND $3 ORDER BY f.day, f.id LIMIT 2000`, [c.id, from, to]);
    if (!rows.length) throw new HttpError(404, 'Nessuna foto in questo periodo');
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
    const clean = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').slice(0, 40);
    const zip = makeZip(rows.map(r => {
      const t = new Date(r.created_at);
      const hm = t.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).replace(':', '');
      return { name: `${dayOf(r.day)}_${hm}_${clean(r.name)}_${r.id}.${ext[r.mime] || 'jpg'}`, data: toBuffer(r.data), date: t };
    }));
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${clean(c.code)}_${clean(c.name)}_foto.zip"` });
    res.send(zip);
  });

  // sincronizzazione da BOSS (BSAL-1725): parte da sola quando ci sono BOSS_CANTIERI_URL e BOSS_CANTIERI_TOKEN
  app.post('/api/cantieri/sincronizza', async (req, res) => {
    adminOnly(req);
    res.json(await syncFromBoss(db));
  });
}

// Formato atteso da BOSS: { commesse: [{ code, name, client, address, lat, lng, chief_email, members: [email], status: 'aperto'|'chiuso', starts_on, ends_on }] }
async function syncFromBoss(db, { url = process.env.BOSS_CANTIERI_URL, token = process.env.BOSS_CANTIERI_TOKEN, fetchImpl = fetch } = {}) {
  if (!url || !token) return { ok: false, reason: 'BOSS non è ancora collegato (BSAL-1725)' };
  const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!r.ok) throw new HttpError(502, `BOSS ha risposto ${r.status}`);
  const data = await r.json();
  const list = Array.isArray(data?.commesse) ? data.commesse : [];
  let n = 0;
  for (const raw of list) {
    let f;
    try { f = cantiereFields({ ...raw, member_emails: raw.members || raw.member_emails || [] }, { partial: false }); } catch { continue; }
    const keys = Object.keys(f);
    await db.query(
      `INSERT INTO cantieri (${keys.join(', ')}, source, synced_at) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}, 'boss', now())
       ON CONFLICT (code) DO UPDATE SET ${keys.filter(k => k !== 'code').map(k => `${k} = EXCLUDED.${k}`).join(', ')}, source = 'boss', synced_at = now(), updated_at = now()`,
      keys.map(k => f[k]));
    n++;
  }
  return { ok: true, cantieri: n };
}

module.exports = { registerCantieri, syncFromBoss, meters };
