// Design v2 del CRM: lead «vivi» nel kanban, gli altri in «Da riordinare» con assegnazione o chiusura in blocco.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, D, E, F;
const ADMIN = 'direzione@almacis.it';

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

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db, crmFetchEvents: async () => [] });
  server = out.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  D = as(await login(ADMIN));
  E = as(await login('edile@almacis.it'));
  F = as(await login('facility@almacis.it'));
});
after(async () => { server?.close(); await db?.close(); });

// un lead come quelli arrivati da Zoho: codice Zoho, nessuna storia, creato da tempo
async function zohoLead(name, ownerId) {
  const { rows: [s] } = await db.query(
    `INSERT INTO crm_subjects (name, kind, roles, asa, zoho_id, owner_id, created_at, updated_at)
     VALUES ($1, 'impresa', '{lead}', '{edilizia}', $2, $3, now() - interval '200 days', now() - interval '200 days') RETURNING id`,
    [name, `Z-${name}`, ownerId]);
  // come il caricamento di Zoho: la riga di nascita nello storico non conta come lavoro
  await db.query("INSERT INTO crm_stage_history (subject_id, from_stage, to_stage, note) VALUES ($1, NULL, 'da_contattare', 'da Zoho')", [s.id]);
  return s.id;
}

test('lead vivi e da riordinare: chi ha un passo, è stato lavorato o creato a mano è vivo; il resto di Zoho no', async () => {
  const eId = await meId(E);
  const fresh = (await E('POST', '/api/crm/subjects', { name: 'Creato a mano', roles: ['lead'], asa: ['edilizia'] })).body;
  const old = await zohoLead('Vecchio Zoho', eId);
  const worked = await zohoLead('Zoho lavorato', eId);
  await db.query("UPDATE crm_subjects SET lead_stage = 'contattato' WHERE id = $1", [worked]);
  const withStep = await zohoLead('Zoho con passo', eId);
  await db.query("INSERT INTO crm_steps (subject_id, title, due_date, owner_id, created_at) VALUES ($1, 'Chiamare', CURRENT_DATE + 3, $2, now() - interval '200 days')", [withStep, eId]);

  const all = (await E('GET', '/api/crm/subjects?role=lead')).body.subjects;
  const live = Object.fromEntries(all.map(s => [s.name, s.live]));
  assert.equal(live['Creato a mano'], true);
  assert.equal(live['Vecchio Zoho'], false);
  assert.equal(live['Zoho lavorato'], true);
  assert.equal(live['Zoho con passo'], true);
  const dead = (await E('GET', '/api/crm/subjects?role=lead&live=0')).body.subjects.map(s => s.id);
  assert.deepEqual(dead, [old]);
  assert.ok((await E('GET', '/api/crm/subjects?role=lead&live=1')).body.subjects.some(s => s.id === fresh.id));
});

test('riordino in blocco: assegna l\'owner o chiudi come «Non interessato» con il motivo; solo direzione o owner', async () => {
  const eId = await meId(E);
  const fId = await meId(F);
  const a = await zohoLead('Blocco A', eId);
  const b = await zohoLead('Blocco B', eId);
  const c = await zohoLead('Blocco C', fId);

  assert.equal((await E('POST', '/api/crm/subjects/bulk', { action: 'assign', ids: [], owner_id: fId })).status, 400);
  assert.equal((await E('POST', '/api/crm/subjects/bulk', { action: 'boh', ids: [a] })).status, 400);
  // E non è owner di C
  assert.equal((await E('POST', '/api/crm/subjects/bulk', { action: 'assign', ids: [a, c], owner_id: fId })).status, 403);
  // chiusura senza motivo
  assert.equal((await E('POST', '/api/crm/subjects/bulk', { action: 'close', ids: [a, b] })).status, 400);
  // un cliente non si riordina
  const cli = (await D('POST', '/api/crm/subjects', { name: 'Cliente vero', roles: ['cliente'], asa: ['edilizia'] })).body;
  assert.equal((await D('POST', '/api/crm/subjects/bulk', { action: 'assign', ids: [cli.id], owner_id: eId })).status, 400);

  const closed = await E('POST', '/api/crm/subjects/bulk', { action: 'close', ids: [a, b], reason: 'Fuori zona', note: 'giro di pulizia' });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.updated, 2);
  const sa = (await E('GET', `/api/crm/subjects/${a}`)).body;
  assert.equal(sa.lead_stage, 'non_interessato');
  assert.equal(sa.lost_reason, 'Fuori zona');
  assert.match(sa.history[0].note, /Fuori zona · giro di pulizia/);

  // la direzione assegna anche quelli degli altri
  const moved = await D('POST', '/api/crm/subjects/bulk', { action: 'assign', ids: [c], owner_id: eId });
  assert.equal(moved.body.updated, 1);
  assert.equal((await E('GET', `/api/crm/subjects/${c}`)).body.owner_id, eId);
  assert.equal((await D('POST', '/api/crm/subjects/bulk', { action: 'assign', ids: [c], owner_id: 999999 })).status, 400);
});
