// «Porta avanti» → progetto di Alma Planet, «I miei progetti», testata e rendiconto (canvas v9, Dante 19/11/2026)
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
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const plus = n => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN, API_WRITE_MAX: '2000' }), { db, crmFetchEvents: async () => [], radarFetch: async () => ({ ok: true, json: async () => ({ output_text: '[]', output: [], usage: {} }) }) });
  server = out.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  D = as(await login(ADMIN));
  E = as(await login('edile@almacis.it'));
  F = as(await login('facility@almacis.it'));
  const s = (await D('GET', '/api/crm/commerciale')).body.settings;
  assert.equal((await D('PUT', '/api/crm/commerciale/profiles', { value: { edilizia: { ...s.profiles.edilizia, manager_id: await meId(E) } } })).status, 200);
});
after(async () => { server?.close(); await db?.close(); });

test('sala di lancio → «Lancia il progetto»: progetto, compiti assegnati, ente nel CRM, opportunità «in corso»', async () => {
  const sig = (await F('POST', '/api/crm/radar/signals', { title: 'Global service edifici provinciali', entity: 'Provincia di Pescara', bu: 'edilizia', kind: 'opera_finanziata', amount: 3200000, region: 'Abruzzo', deadline: plus(60) })).body;
  const prop = await F('GET', `/api/crm/lancio/proposta?signal=${sig.id}`);
  assert.equal(prop.status, 200);
  assert.equal(prop.body.kind, 'gara');
  assert.equal(prop.body.phases.length, 4);
  assert.ok(prop.body.phases.every(p => p.tasks.every(t => t.due_date > today() && t.owner_id)));
  assert.ok(prop.body.team.some(t => t.role === 'responsabile'));
  assert.ok(prop.body.team.some(t => t.user_id === (prop.body.users.find(u => u.name) && t.user_id))); // la squadra ha persone vere
  assert.equal(prop.body.goal.value, 3200000);
  const eId = await meId(E);
  const phases = prop.body.phases.map((p, i) => ({ ...p, tasks: p.tasks.map((t, j) => (i === 1 && j === 1 ? { ...t, owner_id: eId } : t)) }));
  const launched = await F('POST', '/api/crm/lancio', { signal_id: sig.id, owner_id: await meId(F), member_ids: [eId], phases, goal: { ...prop.body.goal, probability: 35 } });
  assert.equal(launched.status, 201);
  const pid = launched.body.project_id;
  assert.equal(launched.body.tasks, 8);
  assert.ok(launched.body.subject_id, 'l\'ente entra nel CRM');
  assert.equal((await F('POST', '/api/crm/lancio', { signal_id: sig.id, phases })).status, 409);
  assert.equal((await F('GET', `/api/crm/lancio/proposta?signal=${sig.id}`)).body.already, pid);

  // nel Radar resta con «in corso»
  const board = (await D('GET', '/api/crm/radar/board')).body.signals.find(g => g.id === sig.id);
  assert.equal(board.project_id, pid);
  assert.ok(board.project_owner);

  // I miei progetti: miei per chi l'ha lanciato e per chi ha un compito; tutti per tutti
  const mine = (await F('GET', '/api/crm/progetti?vista=miei')).body;
  const card = mine.projects.find(p => p.id === pid);
  assert.equal(card.kind, 'gara');
  assert.equal(card.tasks_total, 8);
  assert.equal(card.weighted, 1120000);
  assert.equal(card.source.entity, 'Provincia di Pescara');
  assert.ok(card.next && card.next.title);
  assert.ok(mine.tasks.length >= 1);
  assert.ok((await E('GET', '/api/crm/progetti?vista=miei')).body.projects.some(p => p.id === pid));
  assert.ok((await D('GET', '/api/crm/progetti?vista=tutti')).body.projects.some(p => p.id === pid));

  // il progetto lo vedono tutti in sola lettura; chi non è dentro non lo cambia
  const other = as(await login('altro@almacis.it'));
  assert.equal((await other('GET', `/api/projects/${pid}`)).body.my_role, 'viewer');
  assert.ok((await other('GET', `/api/tickets?project=${pid}`)).body.length >= 8);
  assert.equal((await other('PATCH', `/api/crm/progetti/${pid}`, { step: 2 })).status, 403);

  // testata: tappa e obiettivo
  const moved = await E('PATCH', `/api/crm/progetti/${pid}`, { step: 1, goal: { hours: 200 } });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.step, 1);
  assert.equal(moved.body.goal.hours, 200);
  const detail = (await F('GET', `/api/crm/progetti/${pid}`)).body;
  assert.equal(detail.links.length, 1);
  assert.equal(detail.links[0].subject_name, 'Provincia di Pescara');

  // rendiconto (anche in CSV)
  const r = (await F('GET', `/api/crm/progetti/${pid}/rendiconto`)).body;
  assert.equal(r.tasks.length, 8);
  assert.ok(r.people.length >= 2);
  const csv = await fetch(`${base}/api/crm/progetti/${pid}/rendiconto?formato=csv`, { headers: { cookie: await login('facility@almacis.it'), 'X-Alma': '1' } });
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(await csv.text(), /Rendiconto · Global service edifici provinciali/);
});

test('Porta avanti di un\'iniziativa di Nuovi business: progetto «settore» con i gate', async () => {
  const ini = await D('POST', '/api/crm/business', { name: 'Agrivoltaico', asa: 'edilizia', budget_eur: 25000, owner_id: await meId(D) });
  assert.ok([200, 201].includes(ini.status), JSON.stringify(ini.body));
  const id = ini.body.id;
  const prop = (await D('GET', `/api/crm/lancio/proposta?initiative=${id}`)).body;
  assert.equal(prop.kind, 'settore');
  assert.ok(prop.phases.length >= 1 && prop.phases.every(p => /^G\d/.test(p.title)));
  assert.equal(prop.goal.budget, 25000);
  const out = await D('POST', '/api/crm/lancio', { initiative_id: id, phases: prop.phases, goal: prop.goal });
  assert.equal(out.status, 201);
  const card = (await D('GET', '/api/crm/progetti?vista=miei')).body.projects.find(p => p.id === out.body.project_id);
  assert.equal(card.kind, 'settore');
  assert.equal(card.source.type, 'initiative');
  assert.equal(card.source.budget, 25000);
  assert.equal(card.steps[0], 'G1 · Idea');
});

test('collegamenti con il ruolo: all\'opportunità e al progetto, visibili dall\'altra parte; al lancio passano al progetto', async () => {
  const sig = (await F('POST', '/api/crm/radar/signals', { title: 'Messa in sicurezza ponti', entity: 'Provincia di Teramo', bu: 'edilizia', kind: 'opera_finanziata', amount: 5700000 })).body;
  const partner = (await D('POST', '/api/crm/subjects/rapida', { name: 'SolarEst' })).body;
  const rup = (await D('POST', '/api/crm/contacts', { first_name: 'Luca', last_name: 'Marchetti' })).body;
  assert.equal((await F('POST', '/api/crm/collegamenti', { signal: sig.id, subject_id: partner.id, role: 'boh' })).status, 400);
  let r = await F('POST', '/api/crm/collegamenti', { signal: sig.id, subject_id: partner.id, role: 'ati' });
  assert.equal(r.status, 201);
  r = await F('POST', '/api/crm/collegamenti', { signal: sig.id, contact_id: rup.id, role: 'rup' });
  assert.deepEqual(r.body.links.map(l => [l.kind, l.role_label]), [['subject', 'Partner ATI'], ['contact', 'RUP']]);
  r = await F('POST', '/api/crm/collegamenti', { signal: sig.id, subject_id: partner.id, role: 'subappalto' }); // cambia ruolo, niente doppione
  assert.equal(r.body.links.length, 2);
  assert.equal(r.body.links[0].role, 'subappalto');
  const side = (await D('GET', `/api/crm/subjects/${partner.id}/collegata`)).body.items;
  assert.deepEqual(side.map(i => [i.type, i.role_label]), [['signal', 'Subappaltatore']]);
  // al lancio i collegamenti passano al progetto, l'ente come «Ente appaltante»
  const prop = (await F('GET', `/api/crm/lancio/proposta?signal=${sig.id}`)).body;
  const pid = (await F('POST', '/api/crm/lancio', { signal_id: sig.id, phases: prop.phases, goal: prop.goal })).body.project_id;
  const links = (await F('GET', `/api/crm/collegamenti?project=${pid}`)).body.links;
  assert.deepEqual(links.map(l => l.role).sort(), ['ente', 'rup', 'subappalto']);
  const side2 = (await D('GET', `/api/crm/contacts/${rup.id}/collegata`)).body.items;
  assert.deepEqual(side2.map(i => i.type), ['project']); // l'opportunità portata avanti si vede come progetto
  r = await F('DELETE', '/api/crm/collegamenti', { project: pid, contact_id: rup.id });
  assert.equal(r.body.links.length, 2);
});

test('punti di contatto: persona che conosciamo, partner che ha vinto con l\'ente (ANAC); introduzione e «Non c\'entra»', async () => {
  const fId = await meId(F);
  const ente = (await D('POST', '/api/crm/subjects/rapida', { name: 'Comune di Vasto' })).body;
  await db.query('UPDATE crm_subjects SET owner_id = $2 WHERE id = $1', [ente.id, fId]);
  const rup = (await D('POST', '/api/crm/contacts', { first_name: 'Anna', last_name: 'Ricci', links: [{ subject_id: ente.id, job: 'RUP lavori pubblici', is_primary: true }] })).body;
  await db.query('UPDATE crm_contacts SET owner_id = $2 WHERE id = $1', [rup.id, fId]);
  const { rows: [partner] } = await db.query(`INSERT INTO crm_subjects (name, roles, asa, vat) VALUES ('SolarEst S.r.l.', '{partner}', '{edilizia}', '01234567897') RETURNING id`);
  await db.query(`INSERT INTO crm_anac_awards (cig, object, sa_name, region, province, category, amount, awarded_on, winners, month)
    VALUES ('PCTEST0001', 'Impianti FV scuole', 'COMUNE DI VASTO', 'Abruzzo', 'Chieti', 'OG9', 900000, CURRENT_DATE - 60, '[{"cf": "01234567897", "name": "SOLAREST SRL", "role": ""}]', '202609')`);
  const sig = (await E('POST', '/api/crm/radar/signals', { title: 'Nuova scuola di Vasto', entity: 'Comune di Vasto', bu: 'edilizia', kind: 'opera_finanziata', amount: 2000000 })).body;
  await db.query('UPDATE crm_signals SET subject_id = $2 WHERE id = $1', [sig.id, ente.id]);
  let r = (await E('GET', `/api/crm/punti-contatto?signal=${sig.id}`)).body;
  const persona = r.items.find(i => i.type === 'persona');
  assert.ok(persona, JSON.stringify(r.items));
  assert.equal(persona.role, 'rup');
  assert.equal(persona.knows.id, fId);
  assert.deepEqual(persona.actions, ['collega', 'introduzione']);
  const anac = r.items.find(i => i.type === 'anac');
  assert.equal(anac.subject_id, partner.id);
  assert.equal(anac.role, 'ati');
  // collegato → non si ripropone; «Non c'entra» → nemmeno
  await E('POST', '/api/crm/collegamenti', { signal: sig.id, contact_id: rup.id, role: 'rup' });
  await E('POST', '/api/crm/punti-contatto/non-centra', { signal: sig.id, key: anac.key });
  r = (await E('GET', `/api/crm/punti-contatto?signal=${sig.id}`)).body;
  assert.ok(!r.items.some(i => i.type === 'persona' || i.type === 'anac'));
  // «Chiedi un'introduzione»: un compito a chi conosce
  const intro = await E('POST', '/api/crm/punti-contatto/introduzione', { signal: sig.id, user_id: fId, name: 'Anna Ricci' });
  assert.equal(intro.status, 201);
  const tk = (await F('GET', `/api/tickets/${intro.body.ticket_id}`)).body;
  assert.match(tk.title, /Presentaci a Anna Ricci/);
  assert.ok(tk.assignee_ids.includes(fId));
  // conteggi per le liste
  const counts = (await E('POST', '/api/crm/punti-contatto/conteggi', { subjects: [ente.id, partner.id] })).body;
  assert.equal(counts[ente.id], 1);
  assert.equal(counts[partner.id], undefined);
});
