// Censimento software: solo amministratori, costi, assegnazioni manuali e da collegamento, pacchetti per ruolo,
// licenze di chi è uscito da Microsoft.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { applySource } = require('../lib/software-sources');

let server, base, db, admin, other;
const ADMIN = 'dante@almacis.it';

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const as = cookie => (method, path, body) => api(cookie, method, path, body);
let A, B;

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login(ADMIN);
  other = await login('marco@almacis.it');
  A = as(admin);
  B = as(other);
  await db.exec(`
    INSERT INTO org_people (oid, name, email, job_title, department) VALUES
      ('o-dante', 'Dante', 'dante@almacis.it', 'Responsabile IT', 'IT'),
      ('o-anna', 'Anna Commerciale', 'anna@almacis.it', 'Commerciale', 'Vendite'),
      ('o-luca', 'Luca Tecnico', 'luca@almacis.it', 'Tecnico', 'Cantieri');`);
});

after(async () => {
  server?.close();
  await db?.close();
});

test('solo gli amministratori vedono e cambiano il censimento', async () => {
  assert.equal((await B('GET', '/api/software')).status, 403);
  assert.equal((await B('POST', '/api/software', { name: 'Zoho CRM' })).status, 403);
  assert.equal((await B('GET', '/api/software/people')).status, 403);
  assert.equal((await A('GET', '/api/software')).status, 200);
});

test('software a mano: licenze, costi al mese e all\'anno, assegnazioni', async () => {
  const sw = (await A('POST', '/api/software', { name: 'Zoho CRM', vendor: 'Zoho', category: 'CRM e vendite', website: 'https://www.zoho.com' })).body;
  assert.equal((await A('POST', '/api/software', { name: 'zoho crm' })).status, 400); // doppione, anche con maiuscole diverse
  assert.equal((await A('POST', '/api/software', { name: 'X', website: 'zoho.com' })).status, 400);

  const std = (await A('POST', `/api/software/${sw.id}/plans`, { name: 'Standard', seats: 10, unit_cost: '14,00', billing: 'mese', renewal_date: '2027-03-01' })).body;
  const ent = (await A('POST', `/api/software/${sw.id}/plans`, { name: 'Enterprise', seats: 2, unit_cost: 480, billing: 'anno' })).body;
  assert.equal((await A('POST', `/api/software/${sw.id}/plans`, { name: 'X', unit_cost: '-3' })).status, 400);

  assert.equal((await A('POST', `/api/software/plans/${std.id}/assignments`, { oids: ['o-anna', 'o-luca'] })).body.added, 2);
  assert.equal((await A('POST', `/api/software/plans/${std.id}/assignments`, { oids: ['o-anna'] })).body.added, 0); // già sua
  assert.equal((await A('POST', `/api/software/plans/${ent.id}/assignments`, { oids: ['nessuno'] })).status, 400);
  await A('POST', `/api/software/plans/${ent.id}/assignments`, { oids: ['o-dante'] });

  const d = (await A('GET', `/api/software/${sw.id}`)).body;
  const s = d.plans.find(p => p.name === 'Standard'), e = d.plans.find(p => p.name === 'Enterprise');
  assert.deepEqual([s.assigned, s.free, s.monthly_unit, s.monthly_cost], [2, 8, 14, 140]); // si pagano le 10 acquistate
  assert.deepEqual([e.assigned, e.free, e.monthly_unit, e.monthly_cost], [1, 1, 40, 80]);
  assert.equal(d.assignments.length, 3);

  const all = (await A('GET', '/api/software')).body;
  const row = all.software.find(x => x.id === sw.id);
  assert.deepEqual([row.monthly_cost, row.people_count, row.free, row.renewal_date], [220, 3, 9, '2027-03-01']);
  assert.equal(all.totals.monthly_cost, 220);
  assert.equal(all.totals.free_cost, 8 * 14 + 40);

  const people = (await A('GET', '/api/software/people')).body;
  assert.equal(people.find(p => p.oid === 'o-anna').monthly_cost, 14);
  const dante = (await A('GET', '/api/software/people/o-dante')).body;
  assert.deepEqual(dante.items.map(i => [i.software_name, i.plan_name, i.monthly_cost]), [['Zoho CRM', 'Enterprise', 40]]);

  // togliere una licenza messa a mano
  const anna = d.assignments.find(a => a.person_oid === 'o-anna');
  assert.equal((await A('DELETE', `/api/software/assignments/${anna.id}`)).status, 200);
  assert.equal((await A('GET', `/api/software/${sw.id}`)).body.assignments.length, 2);
});

test('Microsoft: piani e assegnazioni dalla fonte, prezzo stimato finché non si mette quello vero', async () => {
  const read = (people, seats = 5) => [{ external_id: 'microsoft-365', name: 'Microsoft 365', vendor: 'Microsoft', category: 'Produttività', plans: [
    { external_id: 'O365_BUSINESS_PREMIUM', name: 'Microsoft 365 Business Standard', seats, assigned: people.length, renewal_date: '2026-12-05', unit_cost: 11.7, people },
    { external_id: 'POWER_BI_STANDARD', name: 'Power BI (gratuito)', seats: null, assigned: 1, renewal_date: null, unit_cost: 0, people: people.slice(0, 1) },
  ] }];
  const p = (oid, name, disabled = false) => ({ oid, name, email: `${oid}@almacis.it`, disabled });
  // o-ex: account disattivato con la licenza ancora assegnata; o-svc: casella senza posta, non in organigramma ma attiva
  const r1 = await applySource(db, 'microsoft', read([p('o-dante', 'Dante'), p('o-anna', 'Anna Commerciale'), p('o-ex', 'Ex Dipendente', true), p('o-svc', 'Casella Cantiere')]), null);
  assert.deepEqual([r1.created, r1.plans, r1.assignments], [1, 2, 5]);

  let all = (await A('GET', '/api/software')).body;
  const m = all.software.find(x => x.name === 'Microsoft 365');
  assert.equal(m.estimated, true);
  assert.equal(m.monthly_cost, 58.5); // 5 × 11,70
  assert.deepEqual(all.departed.map(x => x.person_name), ['Ex Dipendente']); // solo l'account disattivato, non la casella
  const ppl = (await A('GET', '/api/software/people')).body;
  assert.equal(ppl.find(x => x.oid === 'o-svc').not_in_org, true); // compare anche chi non è nell'organigramma
  assert.ok(all.sync.microsoft);

  const det = (await A('GET', `/api/software/${m.id}`)).body;
  const bs = det.plans.find(x => x.external_id === 'O365_BUSINESS_PREMIUM');
  // nome, quantità e assegnazioni le decide Microsoft; il prezzo si corregge e non è più stimato
  assert.equal((await A('PATCH', `/api/software/plans/${bs.id}`, { seats: 99 })).status, 400);
  assert.equal((await A('POST', `/api/software/plans/${bs.id}/assignments`, { oids: ['o-luca'] })).status, 400);
  assert.equal((await A('DELETE', `/api/software/plans/${bs.id}`)).status, 400);
  assert.equal((await A('DELETE', `/api/software/${m.id}`)).status, 400);
  const annaMs = det.assignments.find(a => a.person_oid === 'o-anna' && a.plan_id === bs.id);
  assert.equal((await A('DELETE', `/api/software/assignments/${annaMs.id}`)).status, 400);
  assert.equal((await A('PATCH', `/api/software/plans/${bs.id}`, { unit_cost: '10,50', billing: 'mese' })).status, 200);

  // secondo aggiornamento: Anna non ce l'ha più, Luca sì, licenze diventate 6; il prezzo vero resta
  await applySource(db, 'microsoft', read([p('o-dante', 'Dante'), p('o-luca', 'Luca Tecnico')], 6), null);
  const again = (await A('GET', `/api/software/${m.id}`)).body;
  const bs2 = again.plans.find(x => x.id === bs.id);
  assert.deepEqual([bs2.seats, bs2.unit_cost, bs2.cost_estimated, bs2.assigned], [6, 10.5, false, 2]);
  assert.deepEqual(again.assignments.filter(a => a.plan_id === bs.id).map(a => a.person_oid).sort(), ['o-dante', 'o-luca']);
  all = (await A('GET', '/api/software')).body;
  assert.equal(all.departed.length, 0); // l'ex dipendente non c'è più neanche in Microsoft

  // licenza messa a mano a chi poi esce dall'organigramma: da recuperare, e si toglie da qui
  const zoho = all.software.find(x => x.name === 'Zoho CRM');
  const std = (await A('GET', `/api/software/${zoho.id}`)).body.plans.find(x => x.name === 'Standard');
  await A('POST', `/api/software/plans/${std.id}/assignments`, { oids: ['o-luca'] });
  await db.query("DELETE FROM org_people WHERE oid = 'o-luca'");
  const gone = (await A('GET', '/api/software')).body.departed;
  assert.deepEqual(gone.map(x => [x.person_name, x.software_name]), [['Luca Tecnico', 'Zoho CRM']]);
  assert.equal((await A('DELETE', `/api/software/assignments/${gone[0].id}`)).status, 200);
  await db.query("INSERT INTO org_people (oid, name, email, job_title, department) VALUES ('o-luca', 'Luca Tecnico', 'luca@almacis.it', 'Tecnico', 'Cantieri')");
});

test('Entra: un software scoperto si collega a quello già messo a mano, senza doppioni', async () => {
  await applySource(db, 'entra', [{ external_id: 'app-zoho', name: 'Zoho CRM', vendor: '', category: 'CRM e vendite', status: 'da_verificare',
    plans: [{ external_id: 'collegati', name: 'Utenti collegati', seats: null, assigned: 1, renewal_date: null, people: [{ oid: 'o-anna', name: 'Anna Commerciale', email: 'anna@almacis.it' }] }] },
  { external_id: 'app-otter', name: 'Otter', vendor: '', category: 'Intelligenza artificiale', status: 'da_verificare',
    plans: [{ external_id: 'collegati', name: 'Utenti collegati', seats: null, assigned: 1, renewal_date: null, people: [{ oid: 'o-luca', name: 'Luca Tecnico', email: 'luca@almacis.it' }] }] }], null);
  const all = (await A('GET', '/api/software')).body;
  const zoho = all.software.filter(s => s.name.toLowerCase() === 'zoho crm');
  assert.equal(zoho.length, 1);
  assert.equal(zoho[0].status, 'attivo'); // era già confermato a mano
  assert.equal(all.software.find(s => s.name === 'Otter').status, 'da_verificare');
  assert.equal(all.totals.to_check, 1);
  // archiviato, esce dai totali
  const otter = all.software.find(s => s.name === 'Otter');
  await A('PATCH', `/api/software/${otter.id}`, { status: 'archiviato' });
  assert.equal((await A('GET', '/api/software')).body.totals.to_check, 0);
});

test('pacchetti per ruolo: proposti per ruolo o reparto, assegnati in un colpo; quelli di Microsoft restano da fare', async () => {
  const all = (await A('GET', '/api/software')).body;
  const zoho = (await A('GET', `/api/software/${all.software.find(s => s.name === 'Zoho CRM').id}`)).body;
  const ms = (await A('GET', `/api/software/${all.software.find(s => s.name === 'Microsoft 365').id}`)).body;
  const std = zoho.plans.find(p => p.name === 'Standard');
  const bs = ms.plans.find(p => p.external_id === 'O365_BUSINESS_PREMIUM');

  const k = (await A('POST', '/api/software/packages', { name: 'Commerciale', job_titles: ['commerciale'], departments: [], plan_ids: [std.id, bs.id] })).body;
  assert.equal((await A('POST', '/api/software/packages', { name: 'commerciale' })).status, 400);
  const list = (await A('GET', '/api/software/packages')).body;
  assert.equal(list[0].monthly_cost, 14 + 10.5);

  const anna = (await A('GET', '/api/software/people/o-anna')).body;
  assert.deepEqual(anna.suggested_packages.map(x => x.name), ['Commerciale']); // ruolo «Commerciale», maiuscole a parte

  const r = (await A('POST', `/api/software/packages/${k.id}/apply`, { oids: ['o-anna'] })).body;
  assert.equal(r.added, 1); // Zoho Standard
  assert.deepEqual(r.todo, [{ oid: 'o-anna', software: 'Microsoft 365', plan: 'Microsoft 365 Business Standard', where: 'Microsoft 365' }]);
  const after = (await A('GET', '/api/software/people/o-anna')).body;
  assert.ok(after.items.some(i => i.plan_name === 'Standard' && i.source === 'pacchetto' && i.package_name === 'Commerciale'));
});

test('fornitori: il nome dell\'app dice il fornitore; le persone si contano una volta per fornitore', async () => {
  const { vendorOf } = require('../lib/software-sources');
  assert.deepEqual(['Zoho Sign', 'Zoho Projects for Teams', 'Trello', 'M365 MCP Client for Claude', 'AutoCAD', 'Fathom'].map(vendorOf),
    ['Zoho', 'Zoho', 'Atlassian', 'Anthropic', 'Autodesk', 'Fathom']);
  const anna = { oid: 'o-anna', name: 'Anna Commerciale', email: 'anna@almacis.it' };
  const linked = people => [{ external_id: 'collegati', name: 'Utenti collegati', seats: null, assigned: people.length, renewal_date: null, people }];
  await applySource(db, 'entra', [
    { external_id: 'app-sign', name: 'Zoho Sign', vendor: vendorOf('Zoho Sign'), category: '', status: 'da_verificare', plans: linked([anna]) },
    { external_id: 'app-zoho', name: 'Zoho CRM', vendor: vendorOf('Zoho CRM'), category: '', status: 'da_verificare', plans: linked([anna]) },
  ], null);
  const all = (await A('GET', '/api/software')).body;
  assert.equal(all.software.find(s => s.name === 'Zoho Sign').vendor, 'Zoho');
  assert.equal(all.software.find(s => s.name === 'Zoho CRM').vendor, 'Zoho'); // messo a mano con «Zoho»: resta
  assert.equal(all.vendor_people.Zoho, 2); // Anna e Dante (Enterprise): Anna una volta sola
});

test('proposte per ruolo: il team IT vede il censimento, riceve la notifica e accetta in parte; il rifiuto chiude', async () => {
  const { proposeFor } = require('../lib/software-proposals');
  const { createNotifier } = require('../lib/notifier');
  // Marco è del team IT (reparto Microsoft «IT - Sistemi Informativi»): vede il censimento anche senza essere amministratore
  await db.exec(`INSERT INTO org_people (oid, name, email, job_title, department) VALUES
    ('o-marco', 'Marco IT', 'marco@almacis.it', 'ICT Coordinator', 'IT - Sistemi Informativi'),
    ('o-nuova', 'Nuova Commerciale', 'nuova@almacis.it', 'Commerciale', 'Vendite'),
    ('o-tec', 'Tecnico Nuovo', 'tec@almacis.it', 'Tecnico', 'Cantieri')`);
  assert.equal((await B('GET', '/api/software')).status, 200);
  assert.equal((await B('GET', '/api/me')).body.software, true);
  const estraneo = as(await login('altro@almacis.it'));
  assert.equal((await estraneo('GET', '/api/software')).status, 403);
  assert.equal((await estraneo('GET', '/api/me')).body.software, false);

  // persona nuova con ruolo «Commerciale»: nasce la proposta del pacchetto Commerciale (Zoho Standard + Business Standard)
  const live = { send() {} };
  const n = await proposeFor(db, createNotifier({ db, live }), ['o-nuova', 'o-tec'], {});
  assert.equal(n, 1); // il tecnico non ha pacchetti per il suo ruolo
  assert.equal(await proposeFor(db, createNotifier({ db, live }), ['o-nuova'], {}), 0); // non si ripropone
  const notif = (await B('GET', '/api/notifications')).body;
  assert.ok(notif.some(x => x.kind === 'software_proposal' && x.proposal_person === 'Nuova Commerciale' && x.proposal_package === 'Commerciale'));

  const list = (await B('GET', '/api/software/proposals')).body;
  assert.equal(list.it_department, 'IT - Sistemi Informativi');
  const prop = list.proposals.find(p => p.person_oid === 'o-nuova');
  assert.deepEqual(prop.items.map(i => [i.plan_name, i.managed_by]).sort(), [['Microsoft 365 Business Standard', 'Microsoft 365'], ['Standard', null]]);
  assert.equal((await B('GET', '/api/software')).body.totals.proposals, 1);

  // il team IT accetta solo Zoho Standard: assegnata subito; Business Standard non scelto
  const zohoStd = prop.items.find(i => i.plan_name === 'Standard');
  const r = (await B('POST', `/api/software/proposals/${prop.id}/accept`, { plan_ids: [zohoStd.plan_id] })).body;
  assert.deepEqual([r.added, r.todo.length], [1, 0]);
  assert.equal((await B('POST', `/api/software/proposals/${prop.id}/accept`, {})).status, 400); // già decisa
  const person = (await A('GET', '/api/software/people/o-nuova')).body;
  assert.deepEqual(person.items.map(i => [i.plan_name, i.source]), [['Standard', 'pacchetto']]);
  const done = (await B('GET', '/api/software/proposals?status=accettata')).body.proposals.find(p => p.id === prop.id);
  assert.deepEqual(done.items.map(i => i.accepted).sort(), [false, true]);
  assert.equal(done.decided_by_name, 'Marco');

  // proposta a mano dopo un cambio di ruolo, poi rifiutata con il motivo
  await db.query("UPDATE org_people SET job_title = 'Commerciale' WHERE oid = 'o-tec'");
  assert.equal((await B('POST', '/api/software/proposals', { oid: 'o-tec' })).body.created, 1);
  const tec = (await B('GET', '/api/software/proposals')).body.proposals.find(p => p.person_oid === 'o-tec');
  assert.equal((await B('POST', `/api/software/proposals/${tec.id}/reject`, { note: 'lavora in cantiere' })).status, 200);
  const rej = (await B('GET', '/api/software/proposals?status=rifiutata')).body.proposals.find(p => p.id === tec.id);
  assert.equal(rej.note, 'lavora in cantiere');
  assert.equal((await A('GET', '/api/software/people/o-tec')).body.items.length, 0);
});
