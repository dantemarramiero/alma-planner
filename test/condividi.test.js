// ALM2-87 (canvas «Condividi ovunque»): Condividi su progetti e su ogni scheda del CRM, con Teams ed email.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { HttpError } = require('../lib/http');
const C = require('../lib/condividi');

let server, base, db, D, E, F, G;
const ADMIN = 'direzione@almacis.it';
// invio finto: registra cosa partirebbe; failTeams = email di chi deve far fallire Teams (Microsoft chiede di rientrare)
const sent = [];
let failTeams = '';
const sender = {
  async teams(from, to, html) {
    if (to.email === failTeams) throw new HttpError(401, 'Serve un nuovo accesso con Microsoft', 'reauth');
    sent.push({ via: 'teams', from: from.email, to: to.email, html });
  },
  async mail(from, to, subject, html) { sent.push({ via: 'mail', from: from.email, to: to.email, subject, html }); },
};

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
const as = cookie => async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};
const meId = async who => { const b = (await who('GET', '/api/me')).body; return b.id ?? b.user?.id; };
const notes = async email => (await db.query('SELECT n.kind, n.body, n.link FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = $1 ORDER BY n.id', [email])).rows;

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN, API_WRITE_MAX: '2000' }), { db, crmFetchEvents: async () => [], condividiSender: sender });
  server = out.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  D = as(await login(ADMIN));
  E = as(await login('edile@almacis.it'));
  F = as(await login('facility@almacis.it'));
  G = as(await login('reti@almacis.it'));
});
after(async () => { server?.close(); await db?.close(); });

test('progetto: chi non è nel progetto ha il «!»; Teams ed email partono a nome di chi condivide; cronologia con canale e «aperta»', async () => {
  const p = (await E('POST', '/api/projects', { name: 'Scuola Pescara' })).body;
  const [fId, gId] = [await meId(F), await meId(G)];
  const info = (await E('GET', `/api/condividi/projects/${p.id}/persone`)).body;
  assert.equal(info.item.name, 'Scuola Pescara');
  assert.equal(info.item.link, `/projects/${p.id}`);
  assert.equal(info.people.find(u => u.id === fId).ok, false);
  assert.deepEqual(info.blocked_reason, ['non fa parte del progetto', 'non fanno parte del progetto']);
  // chi non è nel progetto non riceve: si dice prima
  const no = await E('POST', `/api/condividi/projects/${p.id}`, { user_ids: [fId], teams: true });
  assert.equal(no.status, 409);
  assert.equal(no.body.code, 'senza_accesso');
  assert.deepEqual(no.body.blocked, [fId]);
  assert.match(no.body.error || no.body.message || '', /non fa parte del progetto/);
  // un progetto che non vedo non si condivide (e non si dice che c'è)
  assert.equal((await F('GET', `/api/condividi/projects/${p.id}/persone`)).status, 404);

  assert.equal((await E('POST', `/api/projects/${p.id}/members`, { user_ids: [fId, gId] })).status < 300, true);
  sent.length = 0;
  const ok = await E('POST', `/api/condividi/projects/${p.id}`, { user_ids: [fId, gId], message: 'Domani <b>sopralluogo</b> alle 10', teams: true, mail: true });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body, { sent: 2, teams: { ok: 2, failed: [] }, mail: { ok: 2, failed: [] } });
  assert.equal(sent.filter(s => s.via === 'teams').length, 2);
  const mail = sent.find(s => s.via === 'mail' && s.to === 'facility@almacis.it');
  assert.equal(mail.from, 'edile@almacis.it');
  assert.match(mail.subject, /ti ha condiviso «Scuola Pescara»/);
  assert.ok(mail.html.includes(`/app#/projects/${p.id}`));
  assert.ok(mail.html.includes('Domani &lt;b&gt;sopralluogo&lt;/b&gt; alle 10'), 'il messaggio è testo, non HTML');
  assert.ok(sent.find(s => s.via === 'teams').html.includes('Apri in Alma Space'));
  // l'avviso in Alma parte sempre
  assert.ok((await notes('facility@almacis.it')).some(n => n.link === `/projects/${p.id}` && /ti ha condiviso Scuola Pescara/.test(n.body)));

  assert.equal((await F('POST', `/api/condividi/projects/${p.id}/aperta`, {})).body.opened, 1);
  const st = (await E('GET', `/api/condividi/projects/${p.id}/storia`)).body.items;
  assert.equal(st.length, 1, 'un invio a due colleghi è una riga sola');
  assert.equal(st[0].to.length, 2);
  const f = st[0].to.find(x => x.name && x.opened);
  assert.ok(f && f.teams === 'ok' && f.mail === 'ok');
  assert.ok(st[0].to.some(x => !x.opened));
});

test('Teams non parte: l\'avviso in Alma sì, il motivo torna e resta nella cronologia', async () => {
  const s = (await E('POST', '/api/crm/subjects', { name: 'Reti Gas Spa', roles: ['lead'], asa: ['edilizia'] })).body;
  const [fId, gId] = [await meId(F), await meId(G)];
  failTeams = 'reti@almacis.it';
  try {
    const r = await E('POST', `/api/condividi/subjects/${s.id}`, { user_ids: [fId, gId], teams: true });
    assert.equal(r.status, 201);
    assert.equal(r.body.teams.ok, 1);
    assert.deepEqual(r.body.teams.failed.map(f => [f.id, f.error, f.mail]), [[gId, 'Microsoft chiede di rientrare', false]]);
  } finally { failTeams = ''; }
  assert.ok((await notes('reti@almacis.it')).some(n => n.link === `/crm/scheda/${s.id}`));
  // la cronologia della scheda azienda: una riga, le persone con il loro canale e il «!»
  const tl = (await E('GET', `/api/crm/subjects/${s.id}/timeline`)).body.items;
  const sh = tl.find(i => i.type === 'share');
  assert.equal(sh.to.length, 2);
  assert.match(sh.to.find(x => x.teams === 'errore').error, /Teams: Microsoft chiede di rientrare/);
  // «Mandalo per email»: solo l'email, a chi non ha ricevuto Teams; solo chi ha condiviso può farlo
  failTeams = 'reti@almacis.it';
  let r2;
  try { r2 = (await E('POST', `/api/condividi/subjects/${s.id}`, { user_ids: [gId], teams: true, message: 'Albo a gennaio' })).body; } finally { failTeams = ''; }
  const shareId = r2.teams.failed[0].share_id;
  assert.ok(shareId);
  assert.equal((await F('POST', '/api/condividi/email-di-nuovo', { share_ids: [shareId] })).status, 404);
  const before = (await notes('reti@almacis.it')).length;
  sent.length = 0;
  const again = await E('POST', '/api/condividi/email-di-nuovo', { share_ids: [shareId] });
  assert.deepEqual(again.body, { ok: 1, failed: [] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].via, 'mail');
  assert.equal(sent[0].to, 'reti@almacis.it');
  assert.ok(sent[0].html.includes('Albo a gennaio'));
  assert.equal((await notes('reti@almacis.it')).length, before, 'nessun nuovo avviso in Alma');
  const { rows: [row] } = await db.query('SELECT teams, mail, error FROM crm_shares WHERE id = $1', [shareId]);
  assert.deepEqual([row.teams, row.mail], ['errore', 'ok']);
  assert.match(row.error, /^Teams: /);
  // una seconda volta non la rimanda
  sent.length = 0;
  assert.deepEqual((await E('POST', '/api/condividi/email-di-nuovo', { share_ids: [shareId] })).body, { ok: 1, failed: [] });
  assert.equal(sent.length, 0);
  // e il vecchio «Condividi» (schede aperte prima del deploy) scrive ancora
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/condividi`, { user_ids: [fId] })).status, 201);
});

test('nuovo business, opportunità Impianti ed Energy: link giusti; Energy solo a chi è della BU', async () => {
  const [eId, fId] = [await meId(E), await meId(F)];
  const ini = (await D('POST', '/api/crm/business', { name: 'Data center Abruzzo', owner_id: await meId(D) })).body;
  const b = await D('POST', `/api/condividi/business/${ini.id}`, { user_ids: [fId] });
  assert.equal(b.status, 201);
  assert.ok((await notes('facility@almacis.it')).some(n => n.link === `/crm/business/${ini.id}`));

  const { rows: [g] } = await db.query("INSERT INTO crm_signals (source, bu, title, region) VALUES ('manuale', 'impianti', 'HVAC ospedale', 'Abruzzo') RETURNING id").catch(async () => {
    await db.query("INSERT INTO crm_asa (key, label) VALUES ('impianti', 'Impianti') ON CONFLICT DO NOTHING");
    return db.query("INSERT INTO crm_signals (source, bu, title, region) VALUES ('manuale', 'impianti', 'HVAC ospedale', 'Abruzzo') RETURNING id");
  });
  const im = (await E('GET', `/api/condividi/impianti/${g.id}/persone`)).body;
  assert.equal(im.item.link, `/impianti/opportunita/${g.id}`);
  assert.match(im.item.summary, /Opportunità Impianti/);

  await db.query("INSERT INTO energy_members (email) VALUES ('edile@almacis.it') ON CONFLICT DO NOTHING");
  const o = (await E('POST', '/api/energy/opportunities', { kind: 'ppa_onsite', title: 'FV Logistica Sud' })).body;
  const en = (await E('GET', `/api/condividi/energy/${o.id}/persone`)).body;
  assert.equal(en.people.find(u => u.id === fId).ok, false, 'chi non è della BU Energy ha il «!»');
  assert.equal((await E('POST', `/api/condividi/energy/${o.id}`, { user_ids: [fId] })).status, 409);
  assert.equal((await F('GET', `/api/condividi/energy/${o.id}/persone`)).status, 403);
  assert.ok(eId);
});

test('messaggi: testo sicuro e oggetto con il nome di chi condivide', () => {
  const item = { name: 'A & B <srl>', summary: 'Azienda · Lead' };
  const html = C.teamsHtml({ from: { name: 'Dante M' }, item, message: '<script>x</script>', url: 'https://alma/app#/crm/scheda/1', kind: 'subjects' });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('A &amp; B &lt;srl&gt;'));
  assert.equal(C.mailSubject({ from: { name: 'Dante Marramiero' }, item: { name: 'Scuola' } }), 'Dante ti ha condiviso «Scuola»');
  assert.equal(C.reason(new HttpError(503, 'x', 'ms_not_configured')), 'Microsoft 365 non è collegato ad Alma');
});
