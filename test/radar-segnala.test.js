// ALM2-94 «Segnala un'opportunità» (canvas approvato da Dante il 25/11/2026): screenshot e allegati, colleghi che
// decidono «Tienila / Scartala» via avviso, Teams ed email; basta un «Tienila» → Interessa; tutti «Scartala» → Scartate.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const RS = require('../lib/radar-segnala');

let server, base, db, app, D, E, F, G, cookies = {};
const ADMIN = 'direzione@almacis.it';
const sent = [];
const sender = {
  async teams(from, to, html, opts = {}) { sent.push({ via: 'teams', from: from.email, to: to.email, html, hosted: opts.hosted || [] }); },
  async mail(from, to, subject, html, opts = {}) { sent.push({ via: 'mail', from: from.email, to: to.email, subject, html, attachments: opts.attachments || [] }); },
};
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
const as = cookie => async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};
const upload = (cookie, path, buf, type) => fetch(base + path, { method: 'POST', headers: { cookie, 'X-Alma': '1', 'Content-Type': 'application/octet-stream' }, body: buf })
  .then(async r => ({ status: r.status, body: await r.json() }));
const meId = async who => { const b = (await who('GET', '/api/me')).body; return b.id ?? b.user?.id; };
const notes = async email => (await db.query('SELECT n.body, n.link FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = $1 ORDER BY n.id', [email])).rows;

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN, API_WRITE_MAX: '2000' }), { db, crmFetchEvents: async () => [], condividiSender: sender });
  app = out.app;
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  cookies.D = await login(ADMIN);
  cookies.E = await login('edile@almacis.it');
  D = as(cookies.D);
  E = as(cookies.E);
  F = as(await login('facility@almacis.it'));
  G = as(await login('reti@almacis.it'));
  const s = (await D('GET', '/api/crm/commerciale')).body.settings;
  await D('PUT', '/api/crm/commerciale/profiles', { value: {
    edilizia: { ...s.profiles.edilizia, manager_id: await meId(E), keywords: ['capannone'] },
    facility: { ...s.profiles.facility, manager_id: await meId(F) },
  } });
});
after(async () => { server?.close(); await db?.close(); });

test('screenshot e allegati: si caricano, si vedono nella segnalazione, l\'immagine si apre in linea, il resto si scarica', async () => {
  const g = (await D('POST', '/api/crm/radar/signals', { title: 'Nuovo capannone a Vasto', entity: 'Vasto Srl' })).body;
  const shot = await upload(cookies.D, `/api/crm/radar/signals/${g.id}/files?name=Screenshot%201.png&type=image/png&screenshot=1`, PNG);
  assert.equal(shot.status, 201);
  assert.equal(shot.body.screenshot, true);
  const doc = await upload(cookies.D, `/api/crm/radar/signals/${g.id}/files?name=Delibera.pdf&type=application/pdf&screenshot=1`, Buffer.from('%PDF-1.4'));
  assert.equal(doc.body.screenshot, false); // un PDF non è uno screenshot anche se lo si chiede
  const full = (await D('GET', `/api/crm/radar/signals/${g.id}`)).body;
  assert.deepEqual(full.files.map(f => f.name), ['Screenshot 1.png', 'Delibera.pdf']);
  assert.equal(full.files[0].data, undefined); // i byte non viaggiano nella scheda
  const img = await fetch(`${base}/api/crm/radar/files/${shot.body.id}?inline=1`, { headers: { cookie: cookies.D } });
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('content-disposition'), /^inline/);
  const pdf = await fetch(`${base}/api/crm/radar/files/${doc.body.id}?inline=1`, { headers: { cookie: cookies.D } });
  assert.equal(pdf.headers.get('content-type'), 'application/octet-stream');
  assert.match(pdf.headers.get('content-disposition'), /^attachment/);
  // lo toglie chi l'ha aggiunto (o la direzione), non un altro
  assert.equal((await G('DELETE', `/api/crm/radar/files/${doc.body.id}`)).status, 403);
  assert.equal((await D('DELETE', `/api/crm/radar/files/${doc.body.id}`)).status, 200);
});

test('chiedi a due colleghi: avviso sempre, Teams con lo screenshot, email con gli allegati e i pulsanti Tienila / Scartala', async () => {
  sent.length = 0;
  const g = (await G('POST', '/api/crm/radar/signals', { title: 'Rossi Logistica: polo logistico a San Salvo', entity: 'Rossi Logistica', amount: '8.000.000' })).body;
  await upload(cookies.D, `/api/crm/radar/signals/${g.id}/files?name=shot.png&type=image/png&screenshot=1`, PNG);
  const [eId, fId] = [await meId(E), await meId(F)];
  const r = await G('POST', `/api/crm/radar/signals/${g.id}/chiedi`, { user_ids: [eId, fId], message: 'Per voi ha senso?', due_on: '2026-12-01', teams: true, mail: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.teams.ok, 2);
  assert.equal(r.body.mail.ok, 2);
  const t = sent.find(x => x.via === 'teams' && x.to === 'edile@almacis.it');
  assert.equal(t.from, 'reti@almacis.it');
  assert.equal(t.hosted.length, 1); // lo screenshot dentro il messaggio
  assert.match(t.html, new RegExp(`#/crm/segnale/${g.id}\\?decidi=tieni`));
  const m = sent.find(x => x.via === 'mail' && x.to === 'facility@almacis.it');
  assert.match(m.subject, /^Da decidere: Rossi Logistica/);
  assert.equal(m.attachments[0].isInline, true);
  assert.match(m.html, /cid:shot/);
  assert.match(m.html, /decidi=scarta/);
  assert.ok((await notes('edile@almacis.it')).some(n => n.link === `/crm/segnale/${g.id}` && /ti chiede di decidere/.test(n.body)));
  // chi è stato chiesto lo vede nella scheda; aprirla la segna come «aperta»
  const seen = (await E('GET', `/api/crm/radar/signals/${g.id}`)).body;
  assert.equal(seen.my_ask.decision, '');
  const byG = (await G('GET', `/api/crm/radar/signals/${g.id}`)).body;
  assert.ok(byG.asks.find(k => k.user_id === eId).opened_at);
  assert.equal(byG.asks.find(k => k.user_id === fId).opened_at, null);
  assert.equal(byG.asks_total, 2);
  // chi non è stato chiesto non decide
  assert.equal((await D('POST', `/api/crm/radar/signals/${g.id}/decidi`, { decision: 'tieni' })).status, 403);
  // scarta senza motivo: no
  assert.equal((await F('POST', `/api/crm/radar/signals/${g.id}/decidi`, { decision: 'scarta' })).status, 400);
  const f1 = await F('POST', `/api/crm/radar/signals/${g.id}/decidi`, { decision: 'scarta', reason: 'Fuori dalla nostra BU', note: 'Girala a Edilizia' });
  assert.equal(f1.body.outcome, 'in_attesa'); // l'altro non ha ancora risposto
  assert.ok((await notes('reti@almacis.it')).some(n => /ha scartato/.test(n.body) && /Fuori dalla nostra BU/.test(n.body)));
  // basta un «Tienila»: Interessa nella BU di chi la tiene, con il piano
  const e1 = await E('POST', `/api/crm/radar/signals/${g.id}/decidi`, { decision: 'tieni' });
  assert.equal(e1.status, 200);
  assert.equal(e1.body.outcome, 'interessa');
  assert.ok(e1.body.plan_id);
  const after = (await G('GET', `/api/crm/radar/signals/${g.id}`)).body;
  assert.equal(after.status, 'interessa');
  assert.equal(after.bu, 'edilizia');
  assert.equal(after.asks_done, 2);
});

test('tutti «Scartala» → Scartate con i motivi; promemoria a chi non ha risposto entro la data', async () => {
  const g = (await G('POST', '/api/crm/radar/signals', { title: 'Ampliamento uffici a Lanciano' })).body;
  const [eId, fId] = [await meId(E), await meId(F)];
  await G('POST', `/api/crm/radar/signals/${g.id}/chiedi`, { user_ids: [eId, fId], due_on: '2020-01-01' });
  // la data è passata: un promemoria solo, poi basta
  const before = (await notes('edile@almacis.it')).length;
  const radar = app.locals.crmRadar;
  if (radar?.remindDue) {
    assert.equal(await radar.remindDue(), 2);
    assert.equal(await radar.remindDue(), 0);
    assert.equal((await notes('edile@almacis.it')).length, before + 1);
  }
  await E('POST', `/api/crm/radar/signals/${g.id}/decidi`, { decision: 'scarta', reason: 'Troppo piccola' });
  const last = await F('POST', `/api/crm/radar/signals/${g.id}/decidi`, { decision: 'scarta', reason: 'Fuori dalla nostra BU', note: 'Non è nostro' });
  assert.equal(last.body.outcome, 'scartata');
  const x = (await G('GET', `/api/crm/radar/signals/${g.id}`)).body;
  assert.equal(x.status, 'scartato');
  assert.equal(x.discard_reason, 'Troppo piccola');
  assert.match(x.note, /Non è nostro/);
});

test('i messaggi: link con la scelta pronta, allegati troppo grandi lasciati in Alma', () => {
  const g = { id: 7, title: 'Titolo', entity: 'Ente', amount: 1200000, score: 74, summary: '' };
  const big = { id: 1, name: 'grande.pdf', content_type: 'application/pdf', size: RS.MAIL_ATTACH_MAX + 1, data: Buffer.alloc(1), screenshot: false };
  const m = RS.mailMessage({ g, from: { name: 'Dante' }, message: '', dueOn: null, files: [big], baseUrl: 'https://x' });
  assert.equal(m.attachments.length, 0);
  assert.match(m.html, /li trovi in Alma: grande\.pdf/);
  assert.match(m.html, /https:\/\/x\/app#\/crm\/segnale\/7\?decidi=tieni/);
  const t = RS.teamsMessage({ g, message: 'ciao <b>', dueOn: '2026-11-27', files: [], baseUrl: 'https://x' });
  assert.equal(t.hosted.length, 0);
  assert.match(t.html, /ciao &lt;b&gt;/);
});
