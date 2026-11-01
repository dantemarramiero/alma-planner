// Alma Energy: promemoria delle scadenze delle opportunità (30, 7, 1, 0 giorni e scaduta), una volta sola,
// al responsabile o, se non c'è, ai membri del modulo; niente per le scadenze fatte o le opportunità chiuse.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, migrate } = require('../lib/db');
const { createEnergyReminders } = require('../lib/energy-reminders');

let db, sent, reminders, dante, tullio;
const NOW = new Date('2026-11-02T09:00:00Z'); // lunedì, 10:00 a Roma
const day = n => new Date(Date.parse('2026-11-02T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

before(async () => {
  db = await createDb({});
  await migrate(db);
  ({ rows: [{ id: dante }] } = await db.query("INSERT INTO users (email, name) VALUES ('dante.marramiero@almacis.it', 'Dante') RETURNING id"));
  ({ rows: [{ id: tullio }] } = await db.query("INSERT INTO users (email, name) VALUES ('tullio@almacis.it', 'Tullio') RETURNING id"));
  await db.query("INSERT INTO energy_members (email) VALUES ('tullio@almacis.it')");
  sent = [];
  reminders = createEnergyReminders({ db, notifier: { notify: async n => { sent.push(n); return n.userIds; } } });
});
after(async () => { await db?.close(); });

async function opp(title, scadenze, { owner = null, stage = 'proposta' } = {}) {
  const { rows: [o] } = await db.query(
    "INSERT INTO energy_opportunities (kind, title, stage, owner_id, data) VALUES ('fv_classico', $1, $2, $3, $4) RETURNING id",
    [title, stage, owner, JSON.stringify({ scadenze })]);
  return o.id;
}

test('soglie, destinatari e una volta sola', async () => {
  const a = await opp('Agrivoltaico Lanciano', [
    { label: 'Accettazione STMG', date: day(5) }, // soglia dei 7 giorni
    { label: 'Opzione sul terreno', date: day(-2) }, // scaduta
    { label: 'Validità del titolo', date: day(200) }, // troppo lontana
    { label: 'Integrazioni', date: day(0), done: true }, // già fatta
  ], { owner: dante });
  const b = await opp('FV Vasto', [{ label: 'Deposito PAS', date: day(0) }]); // senza responsabile: ai membri
  await opp('Persa', [{ label: 'Qualcosa', date: day(1) }], { stage: 'perso' });

  assert.equal(await reminders.remindDeadlines(NOW), 3);
  const byText = Object.fromEntries(sent.map(n => [n.body, n]));
  const stmg = Object.keys(byText).find(t => t.startsWith('«Accettazione STMG»'));
  assert.match(stmg, /tra 5 giorni/);
  assert.deepEqual(byText[stmg].userIds, [dante]);
  assert.equal(byText[stmg].link, `/energy/opportunita/${a}`);
  assert.ok(Object.keys(byText).some(t => /«Opzione sul terreno» di Agrivoltaico Lanciano è scaduta/.test(t)));
  const pas = sent.find(n => n.body === '«Deposito PAS» di FV Vasto scade oggi.');
  assert.deepEqual(pas.userIds.sort(), [dante, tullio].sort()); // Dante è membro dalla migrazione, Tullio aggiunto qui
  assert.equal(pas.link, `/energy/opportunita/${b}`);
  assert.ok(sent.every(n => n.kind === 'energy'));

  // il giro dopo non rimanda niente
  assert.equal(await reminders.remindDeadlines(NOW), 0);
  // quattro giorni dopo: la STMG è a 1 giorno e il deposito PAS è scaduto, due avvisi nuovi
  assert.equal(await reminders.remindDeadlines(new Date(NOW.getTime() + 4 * 86400000)), 2);
});

test('di notte niente promemoria; la notifica vera entra nella tabella', async () => {
  sent.length = 0;
  await opp('Notturna', [{ label: 'Scadenza', date: day(0) }], { owner: dante });
  await reminders.tick(new Date('2026-11-02T22:30:00Z')); // 23:30 a Roma
  assert.equal(sent.length, 0);
  await reminders.tick(NOW);
  assert.equal(sent.length, 1);

  // con il notifier vero la notifica passa il controllo sul tipo
  const { createNotifier } = require('../lib/notifier');
  const real = createEnergyReminders({ db, notifier: createNotifier({ db, live: { send() {} } }) });
  await opp('Con notifica', [{ label: 'Termine', date: day(0) }], { owner: dante });
  assert.equal(await real.remindDeadlines(NOW), 1);
  const { rows } = await db.query("SELECT body, link FROM notifications WHERE kind = 'energy'");
  assert.equal(rows[0].body, '«Termine» di Con notifica scade oggi.');
});
