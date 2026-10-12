// Riepilogo del mattino, solleciti e ricerca unica.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { isWorkday, addWorkdays, easter, romeNow } = require('../lib/workdays');

let server, base, db, digest, realFetch;
const users = {};
let sent = [];

async function api(who, method, path, body) {
  const res = await realFetch(base + path, {
    method,
    headers: { cookie: users[who].cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text() };
}

// Giovedì 15 ottobre 2026 come «oggi»: le date dei ticket sono relative a questo giorno.
const TODAY = '2026-10-15';

before(async () => {
  db = await createDb({});
  const created = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', BASE_URL: 'https://alma.example.it', ADMIN_EMAILS: 'capo@almacis.it' }), { db });
  digest = created.digest;
  created.auth.graphToken = async userId => `fake:${userId}`;
  realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    if (String(url) === 'https://graph.microsoft.com/v1.0/me/sendMail') {
      sent.push({ from: opts.headers.Authorization.replace('Bearer fake:', ''), ...JSON.parse(opts.body) });
      return new Response(null, { status: 202 });
    }
    return realFetch(url, opts);
  };
  server = created.app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, e] of [['anna', 'anna.rossi@almacis.it'], ['luca', 'luca.bianchi@almacis.it'], ['ext', 'esterno@almacis.it'], ['capo', 'capo@almacis.it']]) {
    const r = await realFetch(`${base}/auth/dev-login?email=${e}`, { redirect: 'manual' });
    users[k] = { cookie: r.headers.get('set-cookie').split(';')[0] };
    users[k].id = (await api(k, 'GET', '/api/me')).body.id;
  }
});

after(async () => {
  global.fetch = realFetch;
  server?.closeAllConnections?.();
  server?.close();
  await db?.close();
});

beforeEach(() => { sent = []; });

test('giorni lavorativi: weekend, festività nazionali e Pasquetta', () => {
  assert.equal(easter(2026), '2026-04-05');
  assert.equal(isWorkday('2026-04-06'), false); // Pasquetta
  assert.equal(isWorkday('2026-12-08'), false);
  assert.equal(isWorkday('2026-10-17'), false); // sabato
  assert.equal(isWorkday('2026-10-15'), true);
  assert.equal(addWorkdays('2026-10-16', 1), '2026-10-19'); // venerdì → lunedì
  assert.equal(addWorkdays('2026-10-19', -2), '2026-10-15');
  assert.equal(addWorkdays('2026-12-24', 1), '2026-12-28'); // 25 e 26 festivi, poi domenica
  // ora italiana anche con il server in UTC
  assert.deepEqual(romeNow(new Date('2026-10-15T06:00:00Z')), { day: '2026-10-15', minute: 8 * 60 });
  assert.deepEqual(romeNow(new Date('2026-12-15T07:00:00Z')), { day: '2026-12-15', minute: 8 * 60 });
});

test('contenuto del riepilogo: ritardi, oggi, prossimi giorni, nuovi assegnati, ritardi nei propri progetti', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Ospedale Teramo' })).body;
  const mk = (who, title, due, assignees, extra = {}) => api(who, 'POST', '/api/tickets', { title, due_date: due, assignee_ids: assignees, project_id: p.id, ...extra }).then(r => r.body);
  await mk('anna', 'Offerta in ritardo', '2026-10-13', [users.luca.id]);
  await mk('anna', 'Verbale di oggi', TODAY, [users.luca.id], { priority: 'urgent' });
  await mk('anna', 'Planimetrie', '2026-10-21', [users.luca.id]);
  await mk('anna', 'Più avanti', '2026-11-20', [users.luca.id]);
  const done = await mk('anna', 'Già fatto', '2026-10-10', [users.luca.id]);
  await api('anna', 'PATCH', `/api/tickets/${done.id}`, { status: 'done' });

  const d = await digest.build(users.luca.id, TODAY, { since: new Date(Date.now() - 3600 * 1000) });
  const titles = k => d.sections[k].map(t => t.title);
  assert.deepEqual(titles('overdue'), ['Offerta in ritardo']);
  assert.deepEqual(titles('dueToday'), ['Verbale di oggi']);
  assert.deepEqual(titles('soon'), ['Planimetrie']); // entro 5 giorni lavorativi (22 ottobre)
  assert.deepEqual(titles('assigned'), ['Più avanti']); // gli altri 3 nuovi stanno già nelle sezioni per scadenza, con «nuovo»
  assert.ok(d.sections.soon[0].is_new && d.sections.overdue[0].is_new);
  // Anna è responsabile del progetto: vede il ritardo di Luca (2+ giorni lavorativi)
  const a = await digest.build(users.anna.id, TODAY, { since: new Date() });
  assert.deepEqual(a.sections.projectLate.map(t => [t.title, t.assignees]), [['Offerta in ritardo', 'Luca Bianchi']]);
  assert.equal(a.sections.overdue.length, 0);

  // email: oggetto con i numeri, link al ticket, testo dell'utente protetto
  await mk('anna', 'Prova <b>grassetto</b>', TODAY, [users.luca.id]);
  const d2 = await digest.build(users.luca.id, TODAY, { since: new Date(Date.now() - 3600 * 1000) });
  const { subject, html } = digest.render({ name: 'Luca Bianchi' }, d2);
  assert.equal(subject, 'Alma Planet · la tua giornata: 1 in ritardo, 2 in scadenza oggi');
  assert.match(html, /Buongiorno Luca/);
  assert.match(html, /giovedì 15 ott/);
  assert.match(html, /https:\/\/alma\.example\.it\/app#\/tickets\/\d+/);
  assert.match(html, /Prova &lt;b&gt;grassetto&lt;\/b&gt;/);
});

test('invio: uno al giorno, all\'ora scelta, mai se vuoto o spento; dalla propria casella a sé stessi', async () => {
  const day = '2026-10-15';
  // Luca ha ticket (test precedente); Anna non ha niente di suo da fare; ext lo spegne
  await api('ext', 'PATCH', '/api/me/digest', { enabled: false });
  await api('ext', 'POST', '/api/tickets', { title: 'Mio ticket', due_date: day, assignee_ids: [users.ext.id] });

  assert.equal(await digest.runDigests(day, 7 * 60 + 55), 0); // prima delle 8 niente
  await digest.runDigests(day, 8 * 60);
  const toLuca = sent.filter(m => m.message.toRecipients[0].emailAddress.address === 'luca.bianchi@almacis.it');
  assert.equal(toLuca.length, 1);
  assert.equal(toLuca[0].from, String(users.luca.id)); // dalla sua casella
  assert.equal(toLuca[0].saveToSentItems, false);
  assert.ok(!sent.some(m => m.message.toRecipients[0].emailAddress.address === 'esterno@almacis.it'));

  // un secondo giro (o un'altra istanza) non manda di nuovo
  sent = [];
  await digest.runDigests(day, 8 * 60 + 5);
  assert.equal(sent.length, 0);
  const log = Object.fromEntries((await db.query('SELECT user_id, status FROM digest_log WHERE day = $1', [day])).rows.map(r => [r.user_id, r.status]));
  assert.equal(log[users.luca.id], 'sent');
  assert.equal(log[users.capo.id], 'empty');
  assert.equal(log[users.ext.id], undefined);

  // ora diversa: Anna lo vuole alle 9:30
  assert.equal((await api('anna', 'PATCH', '/api/me/digest', { minute: 9 * 60 + 30 })).body.minute, 570);
  assert.equal((await api('anna', 'PATCH', '/api/me/digest', { minute: 9 * 60 + 7 })).status, 400); // solo quarti d'ora
  assert.equal((await api('anna', 'PATCH', '/api/me/digest', { minute: 13 * 60 })).status, 400);
  const prefs = (await api('luca', 'GET', '/api/me/digest')).body;
  assert.equal(prefs.enabled, true);
  assert.equal(prefs.minute, 480);
});

test('solleciti nell\'app: il giorno prima della scadenza e, dopo 2 giorni di ritardo, al responsabile del progetto; una volta sola', async () => {
  const p = (await api('capo', 'POST', '/api/projects', { name: 'Comune Pescara' })).body;
  await api('capo', 'POST', '/api/tickets', { title: 'Scade lunedì', due_date: '2026-10-19', assignee_ids: [users.luca.id], project_id: p.id });
  await api('capo', 'POST', '/api/tickets', { title: 'Scaduto martedì', due_date: '2026-10-13', assignee_ids: [users.luca.id], project_id: p.id });
  const friday = '2026-10-16';
  await digest.runReminders(friday);
  await digest.runReminders(friday); // secondo giro: niente doppioni
  const kinds = async uid => (await db.query('SELECT n.kind, t.title FROM notifications n JOIN tickets t ON t.id = n.ticket_id WHERE n.user_id = $1 AND n.kind IN ($2, $3) ORDER BY n.id', [uid, 'due_tomorrow', 'overdue_project'])).rows;
  const luca = await kinds(users.luca.id);
  assert.deepEqual(luca.filter(n => n.title === 'Scade lunedì').map(n => n.kind), ['due_tomorrow']); // di venerdì per il lunedì
  const capo = await kinds(users.capo.id);
  assert.deepEqual(capo.filter(n => n.title === 'Scaduto martedì').map(n => n.kind), ['overdue_project']);
  // la notifica si legge nell'app con il titolo del ticket
  const list = (await api('capo', 'GET', '/api/notifications')).body;
  assert.ok(list.some(n => n.kind === 'overdue_project' && n.ticket_title === 'Scaduto martedì'));
});

test('riassegnare non cambia la data di chi era già assegnato', async () => {
  const t = (await api('anna', 'POST', '/api/tickets', { title: 'Riassegnato', assignee_ids: [users.luca.id] })).body;
  await db.query("UPDATE ticket_assignees SET assigned_at = now() - interval '3 days' WHERE ticket_id = $1", [t.id]);
  await api('anna', 'PATCH', `/api/tickets/${t.id}`, { assignee_ids: [users.luca.id, users.capo.id] });
  const { rows } = await db.query("SELECT user_id, assigned_at < now() - interval '1 day' AS old FROM ticket_assignees WHERE ticket_id = $1 ORDER BY user_id", [t.id]);
  assert.deepEqual(Object.fromEntries(rows.map(r => [r.user_id, r.old])), { [users.luca.id]: true, [users.capo.id]: false });
});

test('ricerca unica: gruppi, visibilità come nel resto dell\'app, caratteri speciali', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Depuratore Chieti', description: 'Impianto di depurazione' })).body;
  const t = (await api('anna', 'POST', '/api/tickets', { title: 'Collaudo depuratore', project_id: p.id })).body;
  await api('anna', 'POST', `/api/projects/${p.id}/notes`, { body: 'Il collaudo del depuratore slitta di una settimana' });
  await api('anna', 'POST', `/api/tickets/${t.id}/notes`, { body: 'Chiamare il collaudatore del depuratore' });
  await api('anna', 'POST', '/api/posts', { body: 'Foto dal cantiere del depuratore' });

  const r = (await api('anna', 'GET', '/api/search?q=depurator')).body;
  const types = Object.fromEntries(r.groups.map(g => [g.type, g.items.length]));
  assert.equal(types.ticket, 1);
  assert.equal(types.project, 1);
  assert.equal(types.note, 2);
  assert.equal(types.post, 1);
  assert.match(r.groups.find(g => g.type === 'note').items[0].snippet, /depuratore/);

  // chi non è nel progetto non trova progetto, ticket e note (il post è di tutti)
  const ext = (await api('ext', 'GET', '/api/search?q=depurator')).body;
  assert.deepEqual(ext.groups.map(g => g.type), ['post']);
  // l'amministratore trova tutto
  assert.ok((await api('capo', 'GET', '/api/search?q=depurator')).body.groups.some(g => g.type === 'project'));
  // persone (utenti dell'app)
  assert.ok((await api('ext', 'GET', '/api/search?q=bianchi')).body.groups.find(g => g.type === 'person').items.some(i => i.title === 'Luca Bianchi'));
  // % e _ sono cercati come caratteri, non come jolly
  assert.equal((await api('anna', 'GET', '/api/search?q=%25%25')).body.total, 0);
  assert.equal((await api('anna', 'GET', '/api/search?q=a')).status, 400);
});
