// Alma HR, Fase 2 (ALM2-52): organigramma in sola lettura (anche in Impostazioni), ruolo e grade per tutti, costo solo HR,
// scenari che non toccano l'organigramma vero, passi da fare su BOSS, sincronizzazione da BOSS con gli eventi,
// un solo mansionario con Alma Strategy (collegamento dei ruoli, ruolo dall'incarico, responsabile dal riporto).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const O = require('../lib/hr-org');
const { syncPeopleFromBoss } = require('../routes/hr');

let server, base, db, gov;
const cookies = {};
async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${encodeURIComponent(email)}`, { redirect: 'manual' });
  cookies[email] = res.headers.get('set-cookie')?.split(';')[0];
}
async function api(who, method, path, body) {
  const res = await fetch(base + path, { method, headers: { cookie: cookies[who] || '', 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const ADMIN = 'dante@almacis.it';
const HRP = 'giulia.hr@almacis.it';
const LUCA = 'luca.verdi@almacis.it';
const ANNA = 'anna.bassi@almacis.it';

const bossData = (extra = {}) => ({
  personale: [
    { id: 'p1', nome: 'Luca', cognome: 'Verdi', email: LUCA, contratto: 'TI', sesso: 'M', bossUrl: 'https://boss/p/p1', retribuzioni: [{ ralAnnua: 66000, validoDal: '2026-01-01' }] },
    { id: 'p2', nome: 'Anna', cognome: 'Bassi', email: ANNA, contratto: 'TI', sesso: 'F', retribuzioni: [{ ralAnnua: 32000, validoDal: '2026-01-01' }] },
    ...(extra.persone || []),
  ],
  businessUnits: [{ id: 'bu1', nome: 'Reti BP/MP', tipo: 'operativa' }],
  livelli: [{ id: 'l1', nome: 'Responsabili', ordine: 3, approva: true }],
  incarichi: [
    { id: 'i1', nome: 'Resp. Area Metano MP', businessUnitId: 'bu1', livelloOrganigrammaId: 'l1', ricopertoDaPersonaleId: 'p1', bossUrl: 'https://boss/i/i1' },
    { id: 'i2', nome: 'Capo zona Toscana', businessUnitId: 'bu1', riportaAIncaricoId: 'i1', ricopertoDaPersonaleId: 'p2' },
    { id: 'i3', nome: 'Capo zona Puglia', businessUnitId: 'bu1', riportaAIncaricoId: 'i1' },
    ...(extra.incarichi || []),
  ],
});
const fakeBoss = data => async () => ({ ok: true, json: async () => data });

before(async () => {
  db = await createDb({});
  const made = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  gov = made.gov;
  server = made.app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await db.query("INSERT INTO role_assignments (email, role_key) VALUES ($1, 'hr')", [HRP]);
  await gov.reload();
  for (const e of [ADMIN, HRP, LUCA, ANNA]) await login(e);
  await api(HRP, 'GET', '/api/hr/griglia'); // crea mansionario e griglia
});
after(async () => { server?.close(); await db?.close(); });

test('logica pura: scenario, cicli, passi per BOSS, eventi, proposta di ruolo', () => {
  const inc = [{ id: 1, nome: 'A', riporta_a_id: null, persona: { nome: 'x' } }, { id: 2, nome: 'B', riporta_a_id: 1, persona: null }];
  const r = O.applyScenario(inc, [{ tipo: 'nuovo', tmp: 'n1', nome: 'C', riporta_a_id: 1 }, { tipo: 'riporto', incarico_id: 2, riporta_a_id: 'n1' }]);
  assert.equal(r.incarichi.length, 3);
  assert.equal(r.incarichi.find(i => i.id === 2).riporta_a_id, 'n1');
  assert.equal(inc[1].riporta_a_id, 1, 'l\'organigramma vero non cambia');
  assert.match(O.applyScenario(inc, [{ tipo: 'riporto', incarico_id: 1, riporta_a_id: 2 }]).errors[0], /sé stesso/);
  assert.deepEqual(O.bossSteps(inc, [{ tipo: 'nuovo', tmp: 'n1', nome: 'C', riporta_a_id: 1 }, { tipo: 'riporto', incarico_id: 2, riporta_a_id: 'n1' }, { tipo: 'ruolo', incarico_id: 2, role_id: 5 }]),
    ['Crea l\'incarico «C» sotto «A» (vacante)', 'Sposta «B» sotto «C»']);
  const ev = O.diffOrg({ incarichi: [{ boss_id: 'a', nome: 'A', riporta_a: null, ricoperto_da: 'x' }], persone: [{ key: 'k1', nome: 'Mario', cognome: 'R', ral: 30000 }] },
    { incarichi: [{ boss_id: 'a', nome: 'A', riporta_a: null, ricoperto_da: null }, { boss_id: 'b', nome: 'B' }], persone: [{ key: 'k1', nome: 'Mario', cognome: 'R', ral: 31000 }, { key: 'k2', nome: 'Eva', cognome: 'N' }] });
  assert.deepEqual(ev.map(e => e.tipo).sort(), ['incarico_nuovo', 'persona_entrata', 'ral', 'vacante']);
  const roles = [{ hr_name: 'Project Manager', hr_level: 'Junior' }, { hr_name: 'Project Manager', hr_level: 'Intermedio' }, { hr_name: 'Direttore di funzione', hr_level: '' }, { hr_name: 'Impiegato', hr_level: 'Junior' }];
  assert.equal(O.suggestHrRole('Project Manager', roles).hr_level, 'Intermedio');
  assert.equal(O.suggestHrRole('CIO', roles).hr_name, 'Direttore di funzione');
  assert.equal(O.suggestHrRole('Addetta amministrazione', roles).hr_name, 'Impiegato');
});

test('Impostazioni › Organigramma è in sola lettura: niente modifiche, resta l\'import', async () => {
  const m = await api(ADMIN, 'GET', '/api/organigramma');
  assert.equal(m.body.readonly, true);
  const r = await api(ADMIN, 'POST', '/api/organigramma/azione', { azione: 'nuovoIncarico', nome: 'Prova' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /BOSS/);
  assert.equal((await api(ADMIN, 'POST', '/api/organigramma/livelli', { nome: 'X' })).status, 403);
  assert.equal((await api(ADMIN, 'POST', '/api/organigramma/proposta-entra')).status, 403);
  assert.notEqual((await api(ADMIN, 'POST', '/api/organigramma/import')).status, 403, 'l\'import dell\'export di BOSS resta');
});

test('sincronizzazione da BOSS: incarichi, aree, livelli, link, eventi', async () => {
  const r = await syncPeopleFromBoss(db, { url: 'http://boss', token: 't', fetchImpl: fakeBoss(bossData()) });
  assert.equal(r.incarichi, 3);
  const org = (await api(LUCA, 'GET', '/api/hr/organigramma')).body;
  assert.equal(org.incarichi.length, 3);
  const toscana = org.incarichi.find(i => i.nome === 'Capo zona Toscana');
  const metano = org.incarichi.find(i => i.nome === 'Resp. Area Metano MP');
  assert.equal(toscana.riporta_a_id, metano.id);
  assert.equal(toscana.persona.nome, 'Anna Bassi');
  assert.equal(metano.boss_url, 'https://boss/i/i1');
  assert.equal(org.incarichi.find(i => i.nome === 'Capo zona Puglia').persona, null);
  assert.equal(org.is_hr, false);
  assert.equal(metano.ral, undefined, 'chi non è HR non riceve RAL né costo');
  // seconda notte: nuovo incarico, Anna lascia la Toscana, nuova persona
  await syncPeopleFromBoss(db, { url: 'http://boss', token: 't', fetchImpl: fakeBoss({ ...bossData({ persone: [{ id: 'p3', nome: 'Eva', cognome: 'Neri', email: 'eva.neri@almacis.it' }] }),
    incarichi: [...bossData().incarichi.map(i => (i.id === 'i2' ? { ...i, ricopertoDaPersonaleId: null } : i)), { id: 'i4', nome: 'Capo zona Lazio', businessUnitId: 'bu1', riportaAIncaricoId: 'i1', ricopertoDaPersonaleId: 'p3' }] }) });
  const ev = (await api(HRP, 'GET', '/api/hr/eventi')).body;
  const tipi = ev.eventi.map(e => e.tipo);
  for (const t of ['incarico_nuovo', 'vacante', 'persona_entrata']) assert.ok(tipi.includes(t), t);
  assert.ok(ev.avvisi.some(e => e.tipo === 'incarico_nuovo' && e.oggetto === 'Capo zona Lazio'));
  const one = ev.avvisi[0];
  await api(HRP, 'POST', `/api/hr/eventi/${one.id}/fatto`);
  assert.ok(!(await api(HRP, 'GET', '/api/hr/eventi')).body.avvisi.some(e => e.id === one.id));
  assert.equal((await api(LUCA, 'GET', '/api/hr/eventi')).status, 403);
});

test('ruolo dall\'incarico e responsabile dal riporto anche in Alma Strategy', async () => {
  const inc = (await api(HRP, 'GET', '/api/hr/incarichi')).body;
  const roleId = t => inc.roles.find(r => r.title === t).id;
  const id = n => inc.incarichi.find(i => i.nome === n).id;
  await api(HRP, 'POST', '/api/hr/incarichi/conferma', { items: [{ incarico_id: id('Resp. Area Metano MP'), role_id: roleId('Responsabile di Area') }, { incarico_id: id('Capo zona Lazio'), role_id: roleId('Capo zona reti') }] });
  const { rows: [eva] } = await db.query("SELECT u.id, p.role_id, p.manager_id FROM users u LEFT JOIN pm_profiles p ON p.user_id = u.id WHERE lower(u.email) = 'eva.neri@almacis.it'");
  // Eva non è ancora entrata in Alma (niente utente): il profilo nasce al primo accesso e alla sincronizzazione dopo
  assert.equal(eva, undefined);
  await login('eva.neri@almacis.it');
  await require('../routes/hr-org').syncStrategyProfiles(db);
  const { rows: [p] } = await db.query("SELECT p.role_id, m.email AS manager FROM users u JOIN pm_profiles p ON p.user_id = u.id LEFT JOIN users m ON m.id = p.manager_id WHERE lower(u.email) = 'eva.neri@almacis.it'");
  assert.equal(p.role_id, roleId('Capo zona reti'));
  assert.equal(p.manager.toLowerCase(), LUCA);
  const org = (await api(LUCA, 'GET', '/api/hr/organigramma')).body;
  assert.equal(org.incarichi.find(i => i.nome === 'Resp. Area Metano MP').role.grade, 6);
  assert.ok(org.aree_stats.find(a => a.nome === 'Reti BP/MP').incarichi >= 4);
});

test('costo solo HR; scenari che non toccano l\'organigramma vero', async () => {
  assert.equal((await api(LUCA, 'GET', '/api/hr/costo')).status, 403);
  const c = (await api(HRP, 'GET', '/api/hr/costo')).body;
  const reti = c.aree.find(a => a.nome === 'Reti BP/MP');
  assert.equal(reti.monte, 66000);
  assert.equal(reti.costo, Math.round(66000 * 1.38));
  const org = (await api(HRP, 'GET', '/api/hr/organigramma')).body;
  assert.ok(org.incarichi.find(i => i.nome === 'Resp. Area Metano MP').ral);
  const before2 = org.incarichi.length;
  const metano = org.incarichi.find(i => i.nome === 'Resp. Area Metano MP');
  const puglia = org.incarichi.find(i => i.nome === 'Capo zona Puglia');
  const { body: { id } } = await api(HRP, 'POST', '/api/hr/scenari', { nome: 'Riorganizzazione Reti 2027' });
  const roles = (await api(HRP, 'GET', '/api/hr/incarichi')).body.roles;
  const bu = roles.find(r => r.title === 'Responsabile di BU').id;
  const s = (await api(HRP, 'PATCH', `/api/hr/scenari/${id}`, { changes: [
    { tipo: 'nuovo', tmp: 'n1', nome: 'Direttore Reti', role_id: bu },
    { tipo: 'riporto', incarico_id: metano.id, riporta_a_id: 'n1' },
    { tipo: 'disattiva', incarico_id: puglia.id },
  ] })).body;
  assert.equal(s.scenario.incarichi, before2);
  assert.ok(s.scenario.costo > s.oggi.costo - 1, 'il vacante nuovo costa il riferimento di G7');
  assert.deepEqual(s.steps, ['Crea l\'incarico «Direttore Reti» (vacante)', 'Sposta «Resp. Area Metano MP» sotto «Direttore Reti»', 'Disattiva l\'incarico «Capo zona Puglia»']);
  const bad = await api(HRP, 'PATCH', `/api/hr/scenari/${id}`, { changes: [{ tipo: 'riporto', incarico_id: metano.id, riporta_a_id: org.incarichi.find(i => i.nome === 'Capo zona Toscana').id }] });
  assert.equal(bad.status, 400);
  const after2 = (await api(HRP, 'GET', '/api/hr/organigramma')).body;
  assert.equal(after2.incarichi.length, before2);
  assert.equal(after2.incarichi.find(i => i.id === metano.id).riporta_a_id, metano.riporta_a_id, 'l\'organigramma vero è rimasto com\'era');
  assert.equal((await api(LUCA, 'GET', '/api/hr/scenari')).status, 403);
});

test('i ruoli di Alma Strategy si collegano al mansionario e poi spariscono', async () => {
  const { rows: [old] } = await db.query("INSERT INTO pm_roles (title, status, responsibilities) VALUES ('Project Manager', 'confirmed', '[\"Pianificare\",\"Controllare i costi\"]') RETURNING id");
  const { rows: [u] } = await db.query("SELECT id FROM users WHERE lower(email) = $1", [ANNA]);
  await db.query('INSERT INTO pm_profiles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET role_id = $2', [u.id, old.id]);
  const list = (await api(HRP, 'GET', '/api/hr/strategy-ruoli')).body;
  const row = list.ruoli.find(r => r.id === old.id);
  assert.equal(row.persone, 1);
  assert.equal(row.proposto.title, 'Project Manager · Intermedio');
  const r = await api(HRP, 'POST', '/api/hr/strategy-ruoli/collega', { items: [{ old_id: old.id, role_id: row.proposto.id }] });
  assert.equal(r.status, 200);
  const { rows: [p] } = await db.query('SELECT role_id FROM pm_profiles WHERE user_id = $1', [u.id]);
  assert.equal(p.role_id, row.proposto.id);
  const { rows: [nr] } = await db.query('SELECT responsibilities FROM pm_roles WHERE id = $1', [row.proposto.id]);
  assert.deepEqual(nr.responsibilities, ['Pianificare', 'Controllare i costi'], 'le responsabilità passano al ruolo HR che non le aveva');
  assert.ok(!(await api(HRP, 'GET', '/api/hr/strategy-ruoli')).body.ruoli.some(x => x.id === old.id));
  const adm = (await api(ADMIN, 'GET', '/api/pm/admin/roles')).body;
  assert.ok(!adm.some(x => x.id === old.id), 'in Alma Strategy il ruolo vecchio non si vede più');
});
