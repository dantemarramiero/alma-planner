// Migrazione 040: chat interna tolta, impostazioni in «settings», registri «già mandato» in «send_log».
// Si parte da un database fermo alla 039 con dati veri nelle tabelle vecchie, poi si applica la 040.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDb, migrate } = require('../lib/db');
const { getSetting, saveSetting, markSent } = require('../lib/settings');

test('040: le impostazioni e i registri vecchi passano intatti nelle tabelle nuove', async () => {
  const src = path.join(__dirname, '..', 'migrations');
  const until039 = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  for (const f of fs.readdirSync(src).filter(f => f < '040')) fs.copyFileSync(path.join(src, f), path.join(until039, f));
  const db = await createDb({});
  try {
    await migrate(db, until039);
    await db.exec(`
      INSERT INTO users (id, email, name) VALUES (1, 'dante@almacis.it', 'Dante');
      INSERT INTO tickets (id, title, created_by) VALUES (7, 'Preventivo', 1);
      UPDATE software_settings SET value = 'IT - Sistemi Informativi' WHERE key = 'it_department';
      INSERT INTO energy_settings (key, value, updated_by) VALUES ('screening', '{"soglia": 3}', 1);
      INSERT INTO planet_settings (key, value) VALUES ('shortcuts', '["#/projects"]');
      INSERT INTO reminder_log (ticket_id, user_id, kind, due_date) VALUES (7, 1, 'due_tomorrow', '2026-11-12');
      INSERT INTO fleet_reminder_log (key) VALUES ('soon:5');
      INSERT INTO energy_reminder_log (key) VALUES ('scadenza:9');`);
    await migrate(db, src);

    assert.equal(await getSetting(db, 'software.it_department'), 'IT - Sistemi Informativi');
    assert.deepEqual(await getSetting(db, 'energy.screening'), { soglia: 3 });
    assert.deepEqual(await getSetting(db, 'planet.shortcuts'), ['#/projects']);
    const keys = (await db.query('SELECT key FROM send_log ORDER BY key')).rows.map(r => r.key);
    assert.deepEqual(keys, ['energy:scadenza:9', 'fleet:soon:5', 'ticket:7:1:due_tomorrow:2026-11-12']);
    // già mandato: la seconda volta no
    assert.equal(await markSent(db, 'fleet:soon:5'), false);
    assert.equal(await markSent(db, 'fleet:soon:6'), true);
    await saveSetting(db, 'planet.shortcuts', ['#/tickets'], 1);
    assert.deepEqual(await getSetting(db, 'planet.shortcuts'), ['#/tickets']);

    const gone = (await db.query(`SELECT to_regclass('conversations') a, to_regclass('messages') b, to_regclass('software_settings') c,
      to_regclass('planet_settings') d, to_regclass('energy_settings') e, to_regclass('reminder_log') f, to_regclass('fleet_reminder_log') g,
      to_regclass('energy_reminder_log') h, to_regclass('digest_log') i`)).rows[0];
    assert.deepEqual(Object.values(gone).slice(0, 8), [null, null, null, null, null, null, null, null]);
    assert.ok(gone.i); // il registro del riepilogo resta
  } finally {
    await db.close();
    fs.rmSync(until039, { recursive: true, force: true });
  }
});
