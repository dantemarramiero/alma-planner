// Biglietti da visita (ALM2-47, canvas CRM v10).
// «Il mio biglietto»: ognuno ha un biglietto digitale Almacis con un QR personale. Chi lo inquadra apre una pagina
// pubblica (senza login, senza cookie) con «Salva nella rubrica» (vCard) e, se acceso, «Lasciami i tuoi contatti».
// I dati lasciati diventano contatti del CRM solo con «Conferma» del proprietario, con le stesse regole di Alma
// (doppioni, azienda dal dominio dell'email, azienda nuova come lead), e si possono annullare per 10 minuti.
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { HttpError, v } = require('../lib/http');
const { rateLimit } = require('../lib/security');
const { toBuffer } = require('../lib/media');
const { getter, caller } = require('../lib/loopback');
const { contactPreview, contactExecute, contactUndo } = require('../lib/assistente-azioni');
const { faceHtml } = require('../lib/biglietto-face');

const UNDO_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{8,40}$/;
const newToken = () => crypto.randomBytes(9).toString('base64url'); // 12 caratteri, non si indovina

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// vCard 3.0: virgole, punti e virgola e a capo vanno protetti
const vc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const digits = s => String(s || '').replace(/[^\d+]/g, '');
const waNumber = s => { let d = digits(s).replace(/^\+/, '').replace(/^00/, ''); if (d && !d.startsWith('39') && d.length <= 10) d = `39${d}`; return d; };
const linkedinUrl = s => { const t = String(s || '').trim(); if (!t) return ''; return /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`; };
const splitName = full => { const p = String(full || '').trim().split(/\s+/); return { first: p.slice(0, -1).join(' ') || p[0] || '', last: p.length > 1 ? p[p.length - 1] : '' }; };

function registerBiglietti(app, { db, config, notifier, baseUrl }) {
  const cardUrl = token => `${baseUrl}/biglietto/${token}`;

  // ── dati ────────────────────────────────────────────────────────────────────────────────────────
  async function ensureCard(userId) {
    const { rows: [c] } = await db.query('SELECT * FROM business_cards WHERE user_id = $1', [userId]);
    if (c) return c;
    const { rows: [n] } = await db.query('INSERT INTO business_cards (user_id, token) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING *', [userId, newToken()]);
    return n;
  }
  // Nome, email, ruolo e foto dal profilo; reparto dall'organigramma (Entra), se no la prima ASA del CRM.
  async function profileOf(userId) {
    const { rows: [u] } = await db.query(
      `SELECT u.id, u.name, u.email, u.job_title, u.avatar_id, u.suspended_at,
              (SELECT p.department FROM org_people p WHERE lower(p.email) = lower(u.email) AND coalesce(p.department, '') <> '' LIMIT 1) AS department,
              (SELECT a.label FROM crm_asa_members m JOIN crm_asa a ON a.key = m.asa_key WHERE m.email = lower(u.email) ORDER BY a.sort, a.label LIMIT 1) AS asa
         FROM users u WHERE u.id = $1`, [userId]);
    return u;
  }
  function publicView(card, u) {
    return {
      name: u.name, email: u.email, role: card.role || u.job_title || '', unit: u.department || u.asa || '',
      mobile: card.show_mobile ? card.mobile : '', phone: card.show_phone ? card.phone : '',
      linkedin: card.show_linkedin ? linkedinUrl(card.linkedin) : '', address: card.show_address ? card.address : '',
      photo: Boolean(u.avatar_id), accept_leads: card.accept_leads,
    };
  }
  async function cardByToken(token) {
    if (!TOKEN_RE.test(String(token || ''))) return null;
    const { rows: [card] } = await db.query('SELECT * FROM business_cards WHERE token = $1', [token]);
    if (!card) return null;
    const u = await profileOf(card.user_id);
    if (!u || u.suspended_at) return null;
    return { card, u, view: publicView(card, u) };
  }
  const qrSvg = (token, size) => QRCode.toString(cardUrl(token), { type: 'svg', margin: 1, errorCorrectionLevel: 'M', width: size });

  // ── pagina pubblica ─────────────────────────────────────────────────────────────────────────────
  const page = (title, body) => `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>
<link rel="icon" href="/brand/almacis/almacis-mark.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&amp;display=swap">
<link rel="stylesheet" href="/css/biglietto.css"><link rel="stylesheet" href="/css/biglietto-digitale.css"></head>
<body class="bv-pub">${body}</body></html>`;
  const ico = (d, extra = '') => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
  const I = {
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5Z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    in: '<rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/>',
    add: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    web: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
  };
  // pagina pubblica: il biglietto digitale (fronte e retro, lib/biglietto-face.js), i pulsanti, «Lasciami i tuoi contatti»
  function cardHtml(token, x, { thanks = false, error = '', form = {} } = {}) {
    const first = splitName(x.name).first || x.name;
    const f = k => esc(form[k] || '');
    const leave = !x.accept_leads ? '' : thanks
      ? `<div class="bv-thanks" role="status">${ico(I.check)}<div><b>Grazie, ${esc(first)} ha ricevuto i tuoi contatti.</b><span>Ti ricontatterà presto.</span></div></div>`
      : `<details class="bv-leave"${error ? ' open' : ''}>
  <summary>${ico(I.send)}Lasciami i tuoi contatti</summary>
  <form method="post" action="/biglietto/${esc(token)}/lascia" class="bv-form">
    <p>Li riceve solo ${esc(first)}, per ricontattarti. Bastano nome ed email.</p>
    ${error ? `<p class="bv-err" role="alert">${esc(error)}</p>` : ''}
    <div class="bv-two"><label>Nome<input name="nome" required maxlength="120" autocomplete="given-name" value="${f('nome')}"></label>
    <label>Cognome<input name="cognome" maxlength="120" autocomplete="family-name" value="${f('cognome')}"></label></div>
    <label>Email<input name="email" type="email" required maxlength="200" autocomplete="email" value="${f('email')}"></label>
    <div class="bv-two"><label>Azienda <em>facoltativo</em><input name="azienda" maxlength="200" autocomplete="organization" value="${f('azienda')}"></label>
    <label>Cellulare <em>facoltativo</em><input name="cellulare" type="tel" maxlength="40" autocomplete="tel" value="${f('cellulare')}"></label></div>
    <label>Ruolo <em>facoltativo</em><input name="ruolo" maxlength="120" autocomplete="organization-title" value="${f('ruolo')}"></label>
    <label>Messaggio <em>facoltativo</em><textarea name="messaggio" rows="3" maxlength="1000">${f('messaggio')}</textarea></label>
    <label class="bv-hp" aria-hidden="true">Sito<input name="sito" tabindex="-1" autocomplete="off"></label>
    <label class="bv-priv"><input type="checkbox" name="consenso" value="1" required><span>Ho letto l'<a href="https://www.almacis.it/privacy" rel="noopener">informativa privacy di Almacis</a> e accetto di essere ricontattato.</span></label>
    <button type="submit" class="bv-send">Invia a ${esc(first)}</button>
  </form>
</details>`;
    return page(`${x.name} · Almacis`, `<main class="bv-wrap bvd-wrap"><div class="bvd-eyebrow">Almacis · Solving Generation</div>
  <h1 class="bvd-title">${esc(x.name)}<span>.</span></h1>
  ${faceHtml(x)}
  <nav class="bvd-actions" aria-label="Azioni">
    <a class="bvd-btn bvd-primary" href="/biglietto/${esc(token)}/contatto.vcf">${ico(I.add)}Salva contatto</a>
    ${x.mobile || x.phone ? `<a class="bvd-btn" href="tel:${esc(digits(x.mobile || x.phone))}">${ico(I.phone)}Chiama</a>` : ''}
    ${x.mobile ? `<a class="bvd-btn" href="https://wa.me/${esc(waNumber(x.mobile))}" rel="noopener">${ico(I.chat)}WhatsApp</a>` : ''}
    <a class="bvd-btn" href="https://www.almacis.it" rel="noopener">${ico(I.web)}Visita il sito</a>
  </nav>
  ${leave}
  <footer class="bv-foot">Almacis · <a href="https://www.almacis.it/privacy" rel="noopener">Privacy</a> · Questa pagina non usa cookie.</footer>
</main>`);
  }
  const missing = () => page('Biglietto non trovato · Almacis', `<main class="bv-wrap"><header class="bv-hero"><img src="/brand/almacis/almacis-logo.png" alt="Almacis" width="806" height="212" class="bv-logo"></header>
  <section class="bv-card bv-missing"><h1>Biglietto non più attivo</h1><p>Questo QR è stato sostituito con uno nuovo. Chiedi un biglietto aggiornato a chi te l'ha dato, oppure visita <a href="https://www.almacis.it">almacis.it</a>.</p></section></main>`);

  const noStore = res => res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });

  app.get('/biglietto/:token', async (req, res) => {
    noStore(res);
    const found = await cardByToken(req.params.token);
    if (!found) return res.status(404).type('html').send(missing());
    const thanks = req.query.grazie === '1';
    if (!thanks) await db.query('UPDATE business_cards SET scans = scans + 1 WHERE user_id = $1', [found.card.user_id]);
    res.type('html').send(cardHtml(found.card.token, found.view, { thanks }));
  });

  app.get('/biglietto/:token/contatto.vcf', async (req, res) => {
    noStore(res);
    const found = await cardByToken(req.params.token);
    if (!found) return res.status(404).type('html').send(missing());
    const x = found.view;
    const { first, last } = splitName(x.name);
    let photo = '';
    if (found.u.avatar_id) {
      const { rows: [m] } = await db.query('SELECT mime, data FROM media WHERE id = $1', [found.u.avatar_id]);
      if (m && /^image\/(jpeg|png)$/.test(m.mime)) {
        const b64 = toBuffer(m.data).toString('base64');
        if (b64.length < 400000) photo = `PHOTO;ENCODING=b;TYPE=${m.mime === 'image/png' ? 'PNG' : 'JPEG'}:${b64}`;
      }
    }
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vc(last)};${vc(first)};;;`, `FN:${vc(x.name)}`, 'ORG:Almacis' + (x.unit ? `;${vc(x.unit)}` : ''),
      x.role ? `TITLE:${vc(x.role)}` : '', x.mobile ? `TEL;TYPE=CELL,VOICE:${vc(x.mobile)}` : '', x.phone ? `TEL;TYPE=WORK,VOICE:${vc(x.phone)}` : '',
      `EMAIL;TYPE=INTERNET,WORK:${vc(x.email)}`, 'URL:https://www.almacis.it', x.linkedin ? `URL;TYPE=LinkedIn:${vc(x.linkedin)}` : '',
      x.address ? `ADR;TYPE=WORK:;;${vc(x.address)};;;;` : '', photo, 'END:VCARD'].filter(Boolean);
    await db.query('UPDATE business_cards SET saves = saves + 1 WHERE user_id = $1', [found.card.user_id]);
    const file = `${x.name.replace(/[^\p{L}\p{N} ._-]/gu, '').trim() || 'contatto'}.vcf`;
    res.set({ 'Content-Type': 'text/vcard; charset=utf-8', 'Content-Disposition': `attachment; filename="contatto.vcf"; filename*=UTF-8''${encodeURIComponent(file)}` });
    res.send(lines.join('\r\n') + '\r\n');
  });

  app.get('/biglietto/:token/foto', async (req, res) => {
    const found = await cardByToken(req.params.token);
    if (!found || !found.u.avatar_id) return res.status(404).end();
    const { rows: [m] } = await db.query('SELECT mime, data FROM media WHERE id = $1', [found.u.avatar_id]);
    if (!m) return res.status(404).end();
    res.set({ 'Content-Type': m.mime, 'Cache-Control': 'public, max-age=3600' }).send(toBuffer(m.data));
  });

  // «Lasciami i tuoi contatti»: modulo normale (funziona senza JavaScript). Pochi invii per IP, campo trappola per i bot.
  const leaveLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: config.production ? 5 : 50, key: req => req.ip, message: 'Troppi invii da questa rete: riprova tra qualche minuto.' });
  app.post('/biglietto/:token/lascia', leaveLimit, express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
    noStore(res);
    const found = await cardByToken(req.params.token);
    if (!found) return res.status(404).type('html').send(missing());
    const { card, u, view } = found;
    if (!card.accept_leads) return res.redirect(303, `/biglietto/${card.token}`);
    const b = req.body || {};
    const t = (k, max) => String(b[k] ?? '').trim().slice(0, max);
    const form = { nome: t('nome', 120), cognome: t('cognome', 120), email: t('email', 200).toLowerCase(), azienda: t('azienda', 200), cellulare: t('cellulare', 40), ruolo: t('ruolo', 120), messaggio: t('messaggio', 1000) };
    if (t('sito', 200)) return res.redirect(303, `/biglietto/${card.token}?grazie=1`); // bot: fingiamo che sia andato
    const error = !form.nome ? 'Scrivi il tuo nome.' : !EMAIL_RE.test(form.email) ? 'Controlla l\'email: non sembra valida.' : b.consenso !== '1' ? 'Per inviare serve il consenso privacy.' : '';
    if (error) return res.status(400).type('html').send(cardHtml(card.token, view, { error, form }));
    const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM business_card_leads WHERE user_id = $1 AND created_at > now() - interval '1 day'", [card.user_id]);
    if (n >= 50) return res.status(429).type('html').send(cardHtml(card.token, view, { error: 'Oggi questo biglietto ha ricevuto troppi contatti: riprova domani o scrivi via email.', form }));
    await db.query(`INSERT INTO business_card_leads (user_id, first_name, last_name, email, company, mobile, job, message, consent_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`, [card.user_id, form.nome, form.cognome, form.email, form.azienda, form.cellulare, form.ruolo, form.messaggio]);
    const who = [form.nome, form.cognome].filter(Boolean).join(' ');
    await notifier.notify({ userIds: [u.id], actorId: null, kind: 'crm', body: `${who}${form.azienda ? ` (${form.azienda})` : ''} ha inquadrato il tuo biglietto e ti ha lasciato i suoi contatti: confermali per metterli nel CRM.`, link: '/crm/contatti/biglietti' })
      .catch(err => console.warn('[biglietti] avviso non inviato', err.message));
    res.redirect(303, `/biglietto/${card.token}?grazie=1`);
  });

  // ── il mio biglietto (con login) ───────────────────────────────────────────────────────────────
  async function mine(req) {
    const card = await ensureCard(req.user.id);
    const u = await profileOf(req.user.id);
    const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM business_card_leads WHERE user_id = $1 AND status = 'nuovo'", [req.user.id]);
    return {
      card: { role: card.role, mobile: card.mobile, phone: card.phone, linkedin: card.linkedin, address: card.address, show_mobile: card.show_mobile, show_phone: card.show_phone,
        show_linkedin: card.show_linkedin, show_address: card.show_address, accept_leads: card.accept_leads, scans: card.scans, saves: card.saves },
      profile: { name: u.name, email: u.email, job_title: u.job_title || '', unit: u.department || u.asa || '', avatar_id: u.avatar_id },
      view: publicView(card, u), url: cardUrl(card.token), qr: await qrSvg(card.token), face: faceHtml(publicView(card, u), { qr: await qrSvg(card.token) }), leads_new: n,
      leads_total: (await db.query('SELECT count(*)::int AS n FROM business_card_leads WHERE user_id = $1', [req.user.id])).rows[0].n,
    };
  }
  app.get('/api/biglietto', async (req, res) => res.json(await mine(req)));

  app.patch('/api/biglietto', async (req, res) => {
    const b = req.body || {};
    await ensureCard(req.user.id);
    const sets = [], vals = [req.user.id];
    const text = (key, field, max) => { const x = v.text(b[key], field, { max }); if (x !== undefined) { vals.push(x); sets.push(`${key} = $${vals.length}`); } };
    text('role', 'ruolo', 120); text('mobile', 'cellulare', 40); text('phone', 'telefono', 40); text('linkedin', 'LinkedIn', 200); text('address', 'sede', 200);
    for (const k of ['show_mobile', 'show_phone', 'show_linkedin', 'show_address', 'accept_leads']) {
      if (b[k] === undefined) continue;
      if (typeof b[k] !== 'boolean') throw new HttpError(400, `Il campo «${k}» non è valido`);
      vals.push(b[k]); sets.push(`${k} = $${vals.length}`);
    }
    if (sets.length) await db.query(`UPDATE business_cards SET ${sets.join(', ')}, updated_at = now() WHERE user_id = $1`, vals);
    res.json(await mine(req));
  });

  app.post('/api/biglietto/rigenera', async (req, res) => {
    await ensureCard(req.user.id);
    await db.query('UPDATE business_cards SET token = $2, updated_at = now() WHERE user_id = $1', [req.user.id, newToken()]);
    res.json(await mine(req));
  });

  app.get('/api/biglietto/qr.png', async (req, res) => {
    const card = await ensureCard(req.user.id);
    const png = await QRCode.toBuffer(cardUrl(card.token), { type: 'png', margin: 2, width: 1024, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#FFFFFF' } });
    res.set({ 'Content-Type': 'image/png', 'Content-Disposition': 'attachment; filename="il-mio-biglietto-qr.png"', 'Cache-Control': 'no-store' }).send(png);
  });

  // ── contatti lasciati dal QR ───────────────────────────────────────────────────────────────────
  const leadInput = (l, scelta) => ({
    nome: l.first_name, cognome: l.last_name || undefined, email: l.email, cellulare: l.mobile || undefined, qualifica: l.job || undefined,
    azienda: l.company || undefined,
    nota: `Ha lasciato i suoi dati dal mio biglietto (QR) il ${new Date(l.created_at).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}${l.message ? `: «${l.message}»` : ''}`,
    ...(scelta && typeof scelta === 'object' ? {
      ...(scelta.azienda !== undefined ? { azienda: String(scelta.azienda).slice(0, 20) } : {}),
      ...(scelta.azienda_nuova ? { azienda_nuova: true } : {}),
      ...(scelta.senza_azienda ? { senza_azienda: true, azienda: undefined } : {}),
    } : {}),
  });
  // Cosa succederà con «Conferma»: stesso calcolo della scheda di Alma (modo, campi, avvisi) o la domanda «Quale?».
  async function previewOf(req, l, scelta) {
    try {
      const p = await contactPreview(leadInput(l, scelta), getter(req), {});
      return { title: p.title, fields: p.fields, warnings: p.warnings || [], mode: p.data.mode, data: p.data };
    } catch (e) {
      if (e.choices) return { choices: e.choices };
      return { blocked: e.message.replace(/ Dillo all'utente\.$/, '').replace(/: chiedi all'utente di ripeterla\.$/, '.') };
    }
  }
  const leadOut = (l, preview) => ({
    id: l.id, first_name: l.first_name, last_name: l.last_name, email: l.email, company: l.company, mobile: l.mobile, job: l.job, message: l.message,
    status: l.status, contact_id: l.contact_id, created_at: l.created_at, decided_at: l.decided_at,
    can_undo: l.status === 'confermato' && Boolean(l.undo) && Date.now() - new Date(l.decided_at).getTime() < UNDO_MS,
    ...(preview ? { preview: (({ data, ...rest }) => rest)(preview) } : {}),
  });
  async function leadOf(req) {
    const id = v.int(req.params.id, 'contatto', { min: 1 });
    const { rows: [l] } = await db.query('SELECT * FROM business_card_leads WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!l) throw new HttpError(404, 'Contatto non trovato');
    return l;
  }

  app.get('/api/biglietto/contatti', async (req, res) => {
    const stato = ['nuovo', 'confermato', 'saltato'].includes(req.query.stato) ? req.query.stato : 'nuovo';
    const { rows } = await db.query('SELECT * FROM business_card_leads WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 100', [req.user.id, stato]);
    const leads = [];
    for (const l of rows) leads.push(leadOut(l, stato === 'nuovo' ? await previewOf(req, l) : null));
    const { rows: counts } = await db.query('SELECT status, count(*)::int AS n FROM business_card_leads WHERE user_id = $1 GROUP BY status', [req.user.id]);
    res.json({ leads, counts: Object.fromEntries(counts.map(c => [c.status, c.n])) });
  });

  // anteprima con una scelta («Quale azienda?»)
  app.post('/api/biglietto/contatti/:id/anteprima', async (req, res) => {
    const l = await leadOf(req);
    res.json(leadOut(l, await previewOf(req, l, req.body?.scelta)));
  });

  app.post('/api/biglietto/contatti/:id/conferma', async (req, res) => {
    const l = await leadOf(req);
    if (l.status !== 'nuovo') throw new HttpError(409, 'Questo contatto è già stato gestito');
    const p = await previewOf(req, l, req.body?.scelta);
    if (p.choices) throw new HttpError(409, p.choices.question);
    if (p.blocked) throw new HttpError(409, p.blocked);
    const done = await contactExecute(p.data, caller(req));
    const contactId = done.undo?.contact_id || null;
    const { rows: [n] } = await db.query(`UPDATE business_card_leads SET status = 'confermato', contact_id = $3, undo = $4, decided_at = now()
      WHERE id = $1 AND user_id = $2 RETURNING *`, [l.id, req.user.id, contactId, JSON.stringify(done.undo || null)]);
    res.json({ ...leadOut(n), message: done.message, link: done.link });
  });

  app.post('/api/biglietto/contatti/:id/salta', async (req, res) => {
    const l = await leadOf(req);
    if (l.status !== 'nuovo') throw new HttpError(409, 'Questo contatto è già stato gestito');
    const { rows: [n] } = await db.query("UPDATE business_card_leads SET status = 'saltato', decided_at = now() WHERE id = $1 RETURNING *", [l.id]);
    res.json(leadOut(n));
  });

  // «Annulla»: nei 10 minuti dopo la conferma si toglie il contatto creato (o si rimettono i dati di prima) e torna da confermare.
  // Anche un contatto saltato torna da confermare.
  app.post('/api/biglietto/contatti/:id/annulla', async (req, res) => {
    const l = await leadOf(req);
    if (l.status === 'confermato') {
      if (!l.undo || Date.now() - new Date(l.decided_at).getTime() >= UNDO_MS) throw new HttpError(409, 'Sono passati più di 10 minuti: il contatto ora si cambia dalla sua scheda nel CRM.');
      await contactUndo(l.undo, caller(req));
    } else if (l.status !== 'saltato') throw new HttpError(409, 'Non c\'è niente da annullare');
    const { rows: [n] } = await db.query("UPDATE business_card_leads SET status = 'nuovo', contact_id = NULL, undo = NULL, decided_at = NULL WHERE id = $1 RETURNING *", [l.id]);
    res.json(leadOut(n, await previewOf(req, n)));
  });
}

module.exports = { registerBiglietti };
