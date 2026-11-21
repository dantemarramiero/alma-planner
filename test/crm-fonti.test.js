// «Da dove vengono i dati» (ALM2-49): fonti, completezza delle gare nel perimetro, limiti.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, D;
const ADMIN = 'direzione@almacis.it';

async function api(cookie, method, path, body) {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/dev-login?email=${ADMIN}`, { redirect: 'manual' });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  D = (method, path, body) => api(cookie, method, path, body);
  const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const w = JSON.stringify([{ cf: '01234567890', name: 'ROSSI SRL', role: '' }]);
  // 4 gare OG10 in Abruzzo: 3 con vincitore, 2 con ribasso vero e 2 offerenti, 1 senza importo; 1 OS30 in Lazio
  const rows = [
    ['C1', 'OG10', 'Abruzzo', 120000, 22.5, 3, w], ['C2', 'OG10', 'Abruzzo', 90000, 18, 2, w], ['C3', 'OG10', 'Abruzzo', null, null, null, w],
    ['C4', 'OG10', 'Abruzzo', 300000, null, 1, '[]'], ['C5', 'OS30', 'Lazio', 80000, 10, 4, w],
  ];
  for (const [cig, cat, reg, amt, disc, bid, win] of rows) {
    await db.query(`INSERT INTO crm_anac_awards (cig, category, region, base_amount, amount, discount, bidders, winners, awarded_on, month) VALUES ($1, $2, $3, 100000, $4, $5, $6, $7, $8, '202611')`,
      [cig, cat, reg, amt, disc, bid, win, day(20)]);
  }
  await db.query("UPDATE crm_anac_awards SET cats_sec = ARRAY['OS30'], cup = 'J12B2400' WHERE cig = 'C1'");
  await db.query("INSERT INTO crm_anac_bidders (cig, cf, name) VALUES ('C1', '01234567890', 'ROSSI SRL'), ('C1', '09999999999', 'BIANCHI SPA'), ('C2', '09999999999', 'BIANCHI SPA')");
  await db.query("INSERT INTO crm_anac_subcontracts (id, cig, cf, name) VALUES ('S1', 'C1', '08888888888', 'VERDI SRL')");
  await db.query(`INSERT INTO crm_anac_imports (month, awards, kept, error, at) VALUES ('202611', 100, 5, '', now()), ('202610', 0, 0, 'ANAC 500', now())`);
});
after(async () => { server?.close(); await db?.close(); });

test('fonti: ANAC aggiornata con il periodo, TED e OpenCUP in arrivo', async () => {
  const r = await D('GET', '/api/crm/fonti');
  assert.equal(r.status, 200);
  const anac = r.body.sources.find(s => s.key === 'anac');
  assert.equal(anac.status, 'ok');
  assert.equal(anac.months, 1);
  assert.equal(anac.errors, 1);
  assert.ok(anac.period.from && anac.period.to);
  assert.deepEqual(r.body.sources.filter(s => s.status === 'in_arrivo').map(s => s.key), ['ted', 'opencup']);
  assert.ok(r.body.limits.some(t => t.includes('40.000')), 'importo minimo dalle impostazioni');
});

test('completezza misurata sulle gare del perimetro', async () => {
  const r = await D('GET', '/api/crm/fonti?cats=OG10&regions=Abruzzo&months=12');
  const q = r.body.quality;
  assert.equal(q.n, 4);
  const f = Object.fromEntries(q.fields.map(x => [x.key, x.pct]));
  assert.equal(f.winners, 75);
  assert.equal(f.amount, 75);
  assert.equal(f.discount, 50);
  assert.equal(f.bidders, 75);
  assert.equal(f.category, 100);
  assert.equal(q.discount_real, 2);
  assert.equal(f.known_bidders, 50, 'partecipanti noti su 2 gare su 4');
  assert.equal(f.cats_sec, 25);
  assert.equal(f.cup, 25);
  assert.equal(q.subcontracts, 1);
  const one = await D('GET', '/api/crm/fonti?cats=OG10&regions=Abruzzo&cf=01234567890');
  assert.equal(one.body.quality.n, 3, 'solo le gare vinte da quell\'impresa');
});

test('perimetro di un\'iniziativa di Nuovi business e «i» sul ribasso del Mercato', async () => {
  const { rows: [i] } = await db.query(`INSERT INTO crm_initiatives (name, profile, created_by) VALUES ('Reti', $1, (SELECT id FROM users LIMIT 1)) RETURNING id`, [JSON.stringify({ soa: ['OG10'], regions: ['Abruzzo'] })]);
  const r = await D('GET', `/api/crm/fonti?iniziativa=${i.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.quality.n, 4);
  assert.deepEqual(r.body.scope.categories, ['OG10']);
  assert.equal((await D('GET', '/api/crm/fonti?iniziativa=999999')).status, 404);
});
