// Notifiche push dell'app aggiunta alla schermata Home (iPhone da iOS 16.4, Android, computer).
// Le chiavi VAPID le crea Alma la prima volta e le tiene nelle impostazioni («planet.vapid»), la privata cifrata
// con la chiave dei token: nessuno deve generarle o copiarle a mano.
const webpush = require('web-push');
const { getSetting, saveSetting } = require('./settings');

const KEY = 'planet.vapid';
const SUBJECT = 'mailto:it@almacis.it';

function createPush({ db, auth, sender = null }) {
  let keys = null;

  async function vapid() {
    if (keys) return keys;
    let s = await getSetting(db, KEY);
    if (!s?.public || !s?.private) {
      const fresh = webpush.generateVAPIDKeys();
      s = { public: fresh.publicKey, private: auth.encrypt(fresh.privateKey) };
      await saveSetting(db, KEY, s);
    }
    keys = { publicKey: s.public, privateKey: auth.decrypt(s.private) };
    return keys;
  }

  async function publicKey() {
    return (await vapid()).publicKey;
  }

  async function subscribe(userId, sub, device = '') {
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('iscrizione non valida');
    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, keys, device) VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, keys = EXCLUDED.keys, device = EXCLUDED.device`,
      [userId, sub.endpoint, JSON.stringify({ p256dh: sub.keys.p256dh, auth: sub.keys.auth }), String(device).slice(0, 120)]);
  }

  async function unsubscribe(userId, endpoint) {
    await db.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
  }

  // Manda a tutti i dispositivi delle persone; quelli che non esistono più (404/410) si tolgono. Mai bloccante.
  async function send(userIds, { title, body, url, tag }) {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (!ids.length) return 0;
    const { rows } = await db.query('SELECT id, endpoint, keys FROM push_subscriptions WHERE user_id = ANY($1::int[])', [ids]);
    if (!rows.length) return 0;
    let k;
    try { k = await vapid(); } catch (err) { console.warn('[push] chiavi non disponibili', err.message); return 0; }
    const payload = JSON.stringify({ title: title || 'Alma Planet', body: body || '', url: url || '/app#/benvenuto', tag: tag || undefined });
    let ok = 0;
    await Promise.all(rows.map(async r => {
      try {
        await (sender || webpush.sendNotification.bind(webpush))({ endpoint: r.endpoint, keys: r.keys }, payload,
          { vapidDetails: { subject: SUBJECT, publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 3600 });
        ok++;
        await db.query('UPDATE push_subscriptions SET last_ok_at = now() WHERE id = $1', [r.id]);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) await db.query('DELETE FROM push_subscriptions WHERE id = $1', [r.id]);
        else console.warn(`[push] non inviata (${err.statusCode || err.message})`);
      }
    }));
    return ok;
  }

  async function devices(userId) {
    const { rows } = await db.query('SELECT id, device, created_at, last_ok_at FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return rows;
  }

  return { publicKey, subscribe, unsubscribe, send, devices };
}

module.exports = { createPush };
