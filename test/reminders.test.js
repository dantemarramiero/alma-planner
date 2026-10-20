// Promemoria sui ticket: testo scritto da chi lo manda, a chi lavora al ticket, nelle notifiche e per email; storico.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { buildReminderEmail } = require('../lib/ticket-mail');

let server, base, db;
async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
const as = cookie => async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};
let dante, anna, luca;

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0' }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  dante = as(await login('dante@almacis.it'));
  anna = as(await login('anna.rossi@almacis.it'));
  luca = as(await login('luca.bianchi@almacis.it'));
});
after(async () => { server?.close(); await db?.close(); });

test('promemoria: arriva nelle notifiche con il testo scritto; storico nel ticket; niente raffiche', async () => {
  const users = (await dante('GET', '/api/users')).body;
  const id = name => users.find(u => u.email.startsWith(name)).id;
  const t = (await dante('POST', '/api/tickets', { title: 'Preventivo impianto', assignee_ids: [id('anna'), id('luca')], due_date: '2026-10-25' })).body;

  const before = (await dante('GET', `/api/tickets/${t.id}/reminders`)).body;
  assert.deepEqual(before.reminders, []);
  assert.deepEqual(before.recipients.map(p => p.name).sort(), ['Anna Rossi', 'Luca Bianchi']); // non me stesso

  assert.equal((await dante('POST', `/api/tickets/${t.id}/reminders`, { message: '  ' })).status, 400);
  assert.equal((await dante('POST', `/api/tickets/${t.id}/reminders`, { message: 'x', user_ids: [id('dante')] })).status, 400); // non è sul ticket come destinatario

  const r = (await dante('POST', `/api/tickets/${t.id}/reminders`, { message: 'Anna, mi serve entro giovedì <grazie>', user_ids: [id('anna')] })).body;
  assert.deepEqual([r.notified, r.emails_sent], [1, 0]); // in locale niente Microsoft: niente email

  const nAnna = (await anna('GET', '/api/notifications')).body.find(n => n.kind === 'ticket_reminder');
  assert.equal(nAnna.body, 'Anna, mi serve entro giovedì <grazie>');
  assert.equal(nAnna.ticket_id, t.id);
  assert.equal(nAnna.ticket_title, 'Preventivo impianto');
  assert.ok(!(await luca('GET', '/api/notifications')).body.some(n => n.kind === 'ticket_reminder')); // Luca non era tra i destinatari

  const hist = (await anna('GET', `/api/tickets/${t.id}/reminders`)).body;
  assert.equal(hist.reminders.length, 1);
  assert.deepEqual([hist.reminders[0].sender_name, hist.reminders[0].to_names, hist.reminders[0].message], ['Dante', ['Anna Rossi'], 'Anna, mi serve entro giovedì <grazie>']);
  assert.ok(hist.recipients.some(p => p.name === 'Dante')); // per Anna, Dante (autore) è un destinatario possibile

  // subito un altro dallo stesso: fermato; da un'altra persona sì; senza destinatari = tutti
  assert.equal((await dante('POST', `/api/tickets/${t.id}/reminders`, { message: 'di nuovo' })).status, 429);
  const r2 = (await luca('POST', `/api/tickets/${t.id}/reminders`, { message: 'Ci sono novità?' })).body;
  assert.equal(r2.notified, 2); // Anna e Dante
});

test('email del promemoria: testo di chi lo manda, riquadro del ticket, niente HTML iniettato', () => {
  const { subject, html } = buildReminderEmail({
    ticket: { id: 7, title: 'Preventivo <b>impianto</b>', status: 'doing', priority: 'high', due_date: '2026-10-25', project_name: 'Sede' },
    to: { name: 'Anna Rossi', email: 'anna@almacis.it' }, actor: { name: 'Dante' },
    message: 'Mi serve entro giovedì <script>x</script>', link: 'https://alma.example/app#/tickets/7',
  });
  assert.equal(subject, '[Alma Planet] Promemoria da Dante: Preventivo <b>impianto</b>');
  assert.match(html, /Ciao Anna/);
  assert.match(html, /Mi serve entro giovedì &lt;script&gt;/);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /25 ottobre 2026/);
  assert.match(html, /#\/tickets\/7/);
});

test('eliminare più ticket insieme: solo quelli creati da me; gli altri restano, con il motivo', async () => {
  const mine1 = (await dante('POST', '/api/tickets', { title: 'Da togliere 1' })).body;
  const mine2 = (await dante('POST', '/api/tickets', { title: 'Da togliere 2' })).body;
  const other = (await anna('POST', '/api/tickets', { title: 'Di Anna' })).body;
  assert.equal((await dante('POST', '/api/tickets/delete', { ids: [] })).status, 400);
  const r = (await dante('POST', '/api/tickets/delete', { ids: [mine1.id, other.id, mine2.id, 999999] })).body;
  assert.deepEqual(r.deleted.sort(), [mine1.id, mine2.id].sort());
  assert.deepEqual(r.skipped.map(s => [s.id, s.reason]), [[other.id, 'lo può cancellare solo chi l\'ha creato'], [999999, 'non trovato']]);
  assert.equal((await dante('GET', `/api/tickets/${mine1.id}`)).status, 404);
  assert.equal((await anna('GET', `/api/tickets/${other.id}`)).status, 200);
});
