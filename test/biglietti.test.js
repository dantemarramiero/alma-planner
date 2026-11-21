// Biglietti da visita (ALM2-47): «Il mio biglietto» con QR, pagina pubblica, vCard, «Lasciami i tuoi contatti»
// e conferma nel CRM con le regole di Alma (azienda nuova come lead, annulla nei 10 minuti).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, D, cookieD;
const ADMIN = 'direzione@almacis.it';

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const form = (path, fields) => fetch(base + path, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
const tokenOf = url => url.split('/biglietto/')[1];

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  cookieD = await login(ADMIN);
  D = (method, path, body) => api(cookieD, method, path, body);
});
after(async () => { server?.close(); await db?.close(); });

test('senza login le API del biglietto non rispondono', async () => {
  const r = await api(null, 'GET', '/api/biglietto');
  assert.equal(r.status, 401);
});

test('il mio biglietto: si crea al primo accesso, con link e QR', async () => {
  const r = await D('GET', '/api/biglietto');
  assert.equal(r.status, 200);
  assert.match(r.body.url, /\/biglietto\/[A-Za-z0-9_-]{12}$/);
  assert.match(r.body.qr, /^<svg/);
  assert.match(r.body.face, /bvd-front[\s\S]*bvd-back[\s\S]*bvd-qr/); // fronte con il logo, retro con contatti e QR
  assert.equal(r.body.card.scans, 0);
  const again = await D('GET', '/api/biglietto');
  assert.equal(again.body.url, r.body.url, 'stesso link alla seconda volta');
  const png = await fetch(`${base}/api/biglietto/qr.png`, { headers: { cookie: cookieD } });
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.ok((await png.arrayBuffer()).byteLength > 1000);
});

test('pagina pubblica, campi da mostrare e vCard', async () => {
  const set = await D('PATCH', '/api/biglietto', { role: 'Direttore commerciale', mobile: '333 123 4567', phone: '085 111 2222', show_phone: false });
  assert.equal(set.status, 200);
  const token = tokenOf(set.body.url);
  const page = await fetch(`${base}/biglietto/${token}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /almacis-logo-white\.png/); // biglietto digitale: fronte scuro con il logo a scritta bianca (Dante 21/11)
  assert.match(html, /bvd-front/);
  assert.match(html, /Salva contatto/);
  assert.match(html, /EST\. 1955/);
  assert.match(html, /Direttore commerciale/);
  assert.match(html, /333 123 4567/);
  assert.doesNotMatch(html, /085 111 2222/, 'il telefono dell\'ufficio è nascosto');
  assert.match(html, /Lasciami i tuoi contatti/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(page.headers.get('set-cookie'), null, 'la pagina pubblica non mette cookie');

  const vcf = await fetch(`${base}/biglietto/${token}/contatto.vcf`);
  assert.match(vcf.headers.get('content-type'), /text\/vcard/);
  const card = await vcf.text();
  assert.match(card, /^BEGIN:VCARD\r\nVERSION:3\.0/);
  assert.match(card, /TITLE:Direttore commerciale/);
  assert.match(card, /TEL;TYPE=CELL,VOICE:333 123 4567/);
  assert.match(card, /ORG:Almacis/);
  assert.doesNotMatch(card, /085 111 2222/);

  const me = await D('GET', '/api/biglietto');
  assert.equal(me.body.card.scans, 1);
  assert.equal(me.body.card.saves, 1);

  assert.equal((await fetch(`${base}/biglietto/inesistente123`)).status, 404);
});

test('«Lasciami i tuoi contatti»: consenso obbligatorio, bot scartati, avviso al proprietario', async () => {
  const token = tokenOf((await D('GET', '/api/biglietto')).body.url);
  const noConsent = await form(`/biglietto/${token}/lascia`, { nome: 'Giulia', cognome: 'Ferri', email: 'giulia.ferri@example.org' });
  assert.equal(noConsent.status, 400);
  assert.match(await noConsent.text(), /consenso privacy/);

  const bot = await form(`/biglietto/${token}/lascia`, { nome: 'Bot', email: 'bot@example.org', consenso: '1', sito: 'http://spam' });
  assert.equal(bot.status, 303);

  const ok = await form(`/biglietto/${token}/lascia`, { nome: 'Giulia', cognome: 'Ferri', email: 'Giulia.Ferri@Example.org', azienda: 'Ferri Impianti srl',
    cellulare: '349 220 1187', ruolo: 'Ufficio acquisti', messaggio: 'Ci sentiamo per il bando di gennaio', consenso: '1' });
  assert.equal(ok.status, 303);
  assert.match(ok.headers.get('location'), /\?grazie=1$/);
  const thanks = await (await fetch(base + ok.headers.get('location'))).text();
  assert.match(thanks, /ha ricevuto i tuoi contatti/);

  const { rows } = await db.query('SELECT * FROM business_card_leads');
  assert.equal(rows.length, 1, 'il bot non lascia niente');
  assert.equal(rows[0].email, 'giulia.ferri@example.org');
  assert.ok(rows[0].consent_at);
  const { rows: notes } = await db.query("SELECT body, link FROM notifications WHERE kind = 'crm' AND link = '/crm/contatti/biglietti'");
  assert.equal(notes.length, 1);
  assert.match(notes[0].body, /Giulia Ferri/);
  assert.equal((await D('GET', '/api/biglietto')).body.leads_new, 1);
});

test('conferma: contatto e azienda nuova (lead) nel CRM, poi Annulla e Salta', async () => {
  const list = await D('GET', '/api/biglietto/contatti');
  assert.equal(list.status, 200);
  const [l] = list.body.leads;
  assert.equal(l.preview.mode, 'nuova', JSON.stringify(l.preview));
  assert.match(l.preview.title, /Giulia Ferri/);

  const ok = await D('POST', `/api/biglietto/contatti/${l.id}/conferma`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'confermato');
  assert.ok(ok.body.contact_id);
  assert.ok(ok.body.can_undo);
  const c = await D('GET', `/api/crm/contacts/${ok.body.contact_id}`);
  assert.equal(c.body.email, 'giulia.ferri@example.org');
  assert.equal(c.body.mobile, '349 220 1187');
  assert.match(c.body.notes, /biglietto \(QR\).*bando di gennaio/);
  assert.ok(c.body.links.some(x => x.name === 'Ferri Impianti srl'));

  const twice = await D('POST', `/api/biglietto/contatti/${l.id}/conferma`, {});
  assert.equal(twice.status, 409);

  const undo = await D('POST', `/api/biglietto/contatti/${l.id}/annulla`, {});
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  assert.equal(undo.body.status, 'nuovo');
  assert.equal((await D('GET', `/api/crm/contacts/${ok.body.contact_id}`)).status, 404, 'il contatto creato è tolto');

  const skip = await D('POST', `/api/biglietto/contatti/${l.id}/salta`, {});
  assert.equal(skip.body.status, 'saltato');
  const counts = (await D('GET', '/api/biglietto/contatti?stato=saltato')).body;
  assert.equal(counts.leads.length, 1);
  assert.equal(counts.counts.saltato, 1);
});

test('i contatti lasciati si vedono solo dal proprietario del biglietto', async () => {
  const other = await login('altro@almacis.it');
  const r = await api(other, 'GET', '/api/biglietto/contatti?stato=saltato');
  assert.equal(r.body.leads.length, 0);
  const { rows: [l] } = await db.query('SELECT id FROM business_card_leads LIMIT 1');
  assert.equal((await api(other, 'POST', `/api/biglietto/contatti/${l.id}/annulla`, {})).status, 404);
});

test('«Rigenera»: il vecchio QR smette di funzionare', async () => {
  const before = (await D('GET', '/api/biglietto')).body.url;
  const r = await D('POST', '/api/biglietto/rigenera', {});
  assert.notEqual(r.body.url, before);
  assert.equal((await fetch(`${base}/biglietto/${tokenOf(before)}`)).status, 404);
  assert.equal((await fetch(`${base}/biglietto/${tokenOf(r.body.url)}`)).status, 200);
});

test('«Lasciami i tuoi contatti» spento: niente modulo', async () => {
  const r = await D('PATCH', '/api/biglietto', { accept_leads: false });
  const html = await (await fetch(r.body.url.replace(/^https?:\/\/[^/]+/, base))).text();
  assert.doesNotMatch(html, /Lasciami i tuoi contatti/);
  assert.equal((await D('PATCH', '/api/biglietto', { show_mobile: 'sì' })).status, 400);
});

test('«Condividi» da Android (ALM2-48): manifest con share_target, service worker e ripiego del server', async () => {
  const man = await (await fetch(`${base}/manifest.webmanifest`)).json();
  assert.equal(man.share_target.action, '/condividi');
  assert.equal(man.share_target.method, 'POST');
  assert.equal(man.share_target.enctype, 'multipart/form-data');
  assert.deepEqual(man.share_target.params.files[0].accept, ['image/*']);
  const sw = await (await fetch(`${base}/sw.js`)).text();
  assert.match(sw, /pathname !== '\/condividi'/);
  assert.match(sw, /#\/crm\/contatti\/biglietti\?condivisi=/);
  // senza service worker il POST arriva al server: con login si va ai biglietti, senza al login
  const fd = new FormData();
  fd.append('foto', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'biglietto.jpg');
  const withLogin = await fetch(`${base}/condividi`, { method: 'POST', redirect: 'manual', headers: { cookie: cookieD }, body: fd });
  assert.equal(withLogin.status, 303);
  assert.equal(withLogin.headers.get('location'), '/app#/crm/contatti/biglietti?condivisi=0');
  const anon = await fetch(`${base}/condividi`, { method: 'POST', redirect: 'manual', body: fd });
  assert.equal(anon.status, 303);
  assert.match(anon.headers.get('location'), /^\/auth\/login/);
});
