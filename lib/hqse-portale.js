// HQSE fase 2 (ALM2-101): portale del fornitore, la parte senza HTTP.
// - Accesso senza password: link nell'email (7 giorni, una volta), poi sessione di 30 giorni; scaduta la sessione o da un
//   altro dispositivo, un codice di 6 cifre via email (10 minuti, 5 tentativi). Di token e codici si tiene solo l'impronta.
// - Email ai fornitori dalla casella di HQSE_MITTENTE (un utente di Alma Space con Mail.Send), come le altre email di
//   Alma; senza Microsoft (in locale e nei test) le email finiscono in una lista e nel log.
// - Impostazioni del widget sul sito (tavola 2) con i valori di partenza.
const crypto = require('crypto');
const { graph } = require('./graph');

const LINK_DAYS = 7;
const SESSION_DAYS = 30;
const CODE_MINUTES = 10;
const CODE_ATTEMPTS = 5;
const COOKIE = 'hqse_s';

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const newToken = () => crypto.randomBytes(24).toString('base64url');
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const cleanEmail = s => String(s || '').trim().toLowerCase();
const validEmail = s => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s);
const vatOf = s => String(s || '').replace(/^IT/i, '').replace(/\D/g, '');
const validVat = s => /^\d{11}$/.test(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const WIDGET_DEFAULT = {
  titolo: 'Lavora con Almacis',
  testo: 'Registra la tua azienda. Ti mandiamo un link per entrare nel portale fornitori, dove carichi i documenti richiesti per la qualifica.',
  grazie: 'Grazie! Ti abbiamo mandato un\'email con il link al portale.',
  privacy_url: 'https://www.almacis.it/privacy',
  tipi: ['lavori', 'servizi', 'lavori_servizi', 'materiali', 'professionista'],
  avvisa: '',
};
function widgetSettings(row) {
  const s = { ...WIDGET_DEFAULT, ...(row || {}) };
  return { ...s, tipi: Array.isArray(s.tipi) && s.tipi.length ? s.tipi : WIDGET_DEFAULT.tipi };
}

// siti da cui il widget può registrare (CORS): HQSE_WIDGET_ORIGINS su Railway; di serie il sito di Almacis
function widgetOrigins(env = process.env) {
  const raw = env.HQSE_WIDGET_ORIGINS || 'https://www.almacis.it,https://almacis.it';
  return raw.split(/[,\s]+/).map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
}
const originAllowed = (origin, env = process.env) => Boolean(origin) && (widgetOrigins(env).includes(origin)
  || ((env.DEV_LOGIN === '1' || env.NODE_TEST_CONTEXT) && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)));

// ── email ai fornitori ─────────────────────────────────────────────────────────────────────────────
function emailHtml(baseUrl, { saluto, righe, bottone, link, nota }) {
  return `<div style="font-family:Roboto,Helvetica Neue,Arial,sans-serif;font-size:15px;line-height:1.55;color:#3F3F3F;max-width:560px">
  <img src="${baseUrl}/brand/almacis/almacis-logo.png" alt="Almacis" style="height:34px;margin-bottom:6px"><div style="font-size:13px;color:#6B6B6B;margin-bottom:16px">Portale fornitori</div>
  ${saluto ? `<p style="margin:0 0 10px">${esc(saluto)}</p>` : ''}
  ${righe.map(l => `<p style="margin:0 0 10px">${l}</p>`).join('')}
  ${link ? `<p style="margin:18px 0"><a href="${esc(link)}" style="display:inline-block;background:#FF8A26;color:#FFFFFF;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:500">${esc(bottone)}</a></p>` : ''}
  ${nota ? `<p style="margin:0;font-size:13px;color:#6B6B6B">${nota}</p>` : ''}
</div>`;
}

// sendMail: casella di HQSE_MITTENTE via Microsoft Graph; senza Microsoft una lista (outbox) che i test leggono
function createMailer({ db, auth, env = process.env }) {
  const outbox = [];
  const fake = !auth?.msConfigured;
  async function send({ to, subject, html, text }) {
    if (fake) {
      outbox.push({ to, subject, html, text });
      if (!env.NODE_TEST_CONTEXT) console.log(`[hqse] email a ${to}: «${subject}»${text ? ` — ${text}` : ''}`);
      return true;
    }
    const from = cleanEmail(env.HQSE_MITTENTE || 'dante.marramiero@almacis.it');
    const { rows: [u] } = await db.query('SELECT id FROM users WHERE lower(email) = $1', [from]);
    if (!u) throw new Error(`HQSE_MITTENTE ${from} non è un utente di Alma Space`);
    const token = await auth.graphToken(u.id);
    await graph(token, 'POST', '/me/sendMail', {
      body: { message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true },
    });
    return true;
  }
  return { send, outbox, fake };
}

module.exports = {
  LINK_DAYS, SESSION_DAYS, CODE_MINUTES, CODE_ATTEMPTS, COOKIE, sha, newToken, newCode, cleanEmail, validEmail, vatOf, validVat, esc,
  WIDGET_DEFAULT, widgetSettings, widgetOrigins, originAllowed, emailHtml, createMailer,
};
