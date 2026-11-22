// Feedback su Alma Space (ALM2-56): invio con controlli, issue su Linear (etichette, backlog, titolo, descrizione,
// foto caricate), esito che torna da Linear con la notifica una sola volta, invio rimandato se Linear non risponde.
// Linear è simulato.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { createNotifier } = require('../lib/notifier');
const linear = require('../lib/linear');
const { deviceOf, buildIssue, outcomeOf, syncFeedback, fmtRome } = require('../lib/feedback');

let server, base, db, ANNA, BRUNO, CARLA, anna, notifier;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64'); // basta che sia qualcosa

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
const as = cookie => async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'X-Alma': '1', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};

before(async () => {
  delete process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_FEEDBACK_TEAM;
  linear._reset();
  db = await createDb({});
  const { app, live } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0' }), { db });
  notifier = createNotifier({ db, live });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  ANNA = as(await login('anna@almacis.it'));
  BRUNO = as(await login('bruno@almacis.it'));
  CARLA = as(await login('carla@almacis.it'));
  anna = (await ANNA('GET', '/api/me')).body;
});

after(async () => {
  server?.close();
  await db?.close();
  delete process.env.LINEAR_API_KEY;
  linear._reset();
});

test('dispositivo leggibile dal user agent', () => {
  assert.equal(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'), 'Chrome su Windows');
  assert.equal(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'), 'Safari su iPhone');
  assert.equal(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0'), 'Edge su Mac');
  assert.equal(deviceOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'), 'Chrome su Android');
  assert.equal(deviceOf(''), 'Non indicato');
});

test('titolo e descrizione dell\'issue', () => {
  const long = `La tabella dei mezzi non si aggiorna\ndopo il salvataggio ${'e poi niente '.repeat(10)}`;
  const { title, description } = buildIssue({ kind: 'tecnico', body: long, page: 'Mezzi · #/mezzi', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Safari/604.1',
    user: { name: 'Anna Rossi', email: 'anna@almacis.it' }, createdAt: '2026-11-22T09:05:00Z', images: ['https://uploads.linear.app/a.png'] });
  assert.ok(title.startsWith('[Feedback] La tabella dei mezzi non si aggiorna dopo il salvataggio'));
  assert.ok(!title.includes('\n'));
  assert.ok(title.length <= '[Feedback] '.length + 81);
  const lines = description.split('\n');
  assert.equal(lines[0], 'La tabella dei mezzi non si aggiorna');
  assert.ok(description.includes('![foto dello schermo](https://uploads.linear.app/a.png)'));
  assert.ok(lines.includes('---'));
  for (const l of ['**Da:** Anna Rossi (anna@almacis.it)', '**Tipo:** Problema tecnico', '**App:** Alma Space', '**Pagina:** Mezzi · #/mezzi',
    '**Dispositivo:** Safari su iPhone', '**Inviato:** 22/11/2026 10:05']) assert.ok(lines.includes(l), l);
  assert.equal(buildIssue({ kind: 'procedura', body: 'Breve', page: '', userAgent: '', user: { name: 'A', email: 'a@x' }, createdAt: new Date() }).title, '[Feedback] Breve');
  assert.equal(fmtRome('2026-07-01T22:30:00Z'), '02/07/2026 00:30'); // ora legale
});

test('esito dallo stato di Linear', () => {
  const lab = (...n) => ({ nodes: n.map(name => ({ name })) });
  assert.deepEqual(outcomeOf({ state: { type: 'backlog' }, labels: lab('Feedback', 'Da valutare') }), { outcome: 'da_valutare', reason: null });
  assert.deepEqual(outcomeOf({ state: { type: 'backlog' }, labels: lab('Feedback') }), { outcome: 'approvato', reason: null });
  assert.deepEqual(outcomeOf({ state: { type: 'started' }, labels: lab('Feedback') }), { outcome: 'approvato', reason: null });
  assert.deepEqual(outcomeOf({ state: { type: 'completed' }, labels: lab('Da valutare') }), { outcome: 'risolto', reason: null });
  assert.deepEqual(outcomeOf({ state: { type: 'canceled', name: 'Canceled' }, labels: lab(), comments: { nodes: [
    { body: 'Motivo: vecchio', createdAt: '2026-11-20T10:00:00Z' },
    { body: 'Motivo: si fa già da Impostazioni', createdAt: '2026-11-21T10:00:00Z' },
    { body: 'ok ci penso', createdAt: '2026-11-22T10:00:00Z' }] } }), { outcome: 'non_accolto', reason: 'si fa già da Impostazioni' });
  assert.deepEqual(outcomeOf({ state: { type: 'canceled' }, labels: lab(), comments: { nodes: [] } }), { outcome: 'non_accolto', reason: null });
  assert.deepEqual(outcomeOf({ state: { type: 'duplicate' } }), { outcome: 'doppione', reason: null });
  assert.deepEqual(outcomeOf({ state: { type: 'duplicate' }, relations: { nodes: [{ type: 'related', relatedIssue: { identifier: 'ALM2-3' } }, { type: 'duplicate', relatedIssue: { identifier: 'ALM2-7' } }] } }),
    { outcome: 'doppione', reason: 'Doppione di ALM2-7' });
  assert.equal(outcomeOf({ state: { type: 'canceled' }, relations: { nodes: [{ type: 'duplicate', relatedIssue: { identifier: 'ALM2-7' } }] } }).outcome, 'doppione');
  assert.equal(outcomeOf({ state: { type: 'backlog' }, labels: lab('Feedback'), relations: { nodes: [{ type: 'related' }] } }).outcome, 'approvato');
});

test('controlli dell\'invio e limite di frequenza', async () => {
  const bad = [
    { body: 'Manca il tipo di feedback' },
    { kind: 'altro', body: 'Tipo che non esiste' },
    { kind: 'tecnico', body: 'poco' },
    { kind: 'tecnico', body: 'x'.repeat(5001) },
    { kind: 'tecnico', body: 'Quattro foto sono troppe', images: [1, 2, 3, 4].map(() => ({ name: 'a.png', mime: 'image/png', base64: PNG })) },
  ];
  for (const b of bad) assert.equal((await BRUNO('POST', '/api/feedback', b)).status, 400, JSON.stringify(b).slice(0, 60));
  assert.equal((await BRUNO('POST', '/api/feedback', { kind: 'tecnico', body: 'Sesto invio nel minuto' })).status, 429);

  const pdf = await CARLA('POST', '/api/feedback', { kind: 'tecnico', body: 'Un PDF non è una foto', images: [{ name: 'a.pdf', mime: 'application/pdf', base64: PNG }] });
  assert.equal(pdf.status, 400);
  const big = await CARLA('POST', '/api/feedback', { kind: 'tecnico', body: 'Foto troppo grande', images: [{ name: 'a.png', mime: 'image/png', base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') }] });
  assert.equal(big.status, 400);
  assert.match(big.body.error, /5 MB/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM feedback')).rows[0].n, 0);
});

test('senza Linear il feedback si salva e resta da valutare', async () => {
  const r = await ANNA('POST', '/api/feedback', { kind: 'procedura', body: 'Le ferie si potrebbero chiedere dal calendario', page: 'Calendario · #/calendar',
    images: [{ name: 'foto-schermo.png', mime: 'image/png', base64: PNG }] });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.sent, r.body.identifier], [false, null]);
  assert.match(r.body.message, /salvato/);
  const mine = (await ANNA('GET', '/api/feedback/mine')).body.feedback;
  assert.deepEqual([mine.length, mine[0].kind, mine[0].outcome, mine[0].linear_identifier], [1, 'procedura', 'da_valutare', null]);
  assert.equal((await BRUNO('GET', '/api/feedback/mine')).body.feedback.length, 0); // ognuno vede i suoi
  const { rows: [f] } = await db.query('SELECT page, user_agent FROM feedback WHERE id = $1', [r.body.id]);
  assert.equal(f.page, 'Calendario · #/calendar');
  assert.match(f.user_agent, /Chrome/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM feedback_images')).rows[0].n, 1);
});

test('con Linear: issue con etichette e foto, rimandati i non inviati, esito con notifica una volta sola', async () => {
  process.env.LINEAR_API_KEY = 'lin_api_prova';
  linear._reset();
  const sent = [], puts = [];
  const issues = new Map();
  let n = 40, down = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://uploads.linear.app/')) { puts.push({ url: String(url), headers: opts.headers, size: opts.body.length }); return new Response('', { status: 200 }); }
    if (String(url) !== 'https://api.linear.app/graphql') return realFetch(url, opts);
    if (down) return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
    const { query, variables } = JSON.parse(opts.body);
    sent.push({ query, variables });
    const json = data => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (query.includes('teams(')) return json({ teams: { nodes: [{ id: 'team-it', key: 'IT', name: 'IT' }, { id: 'team-alm2', key: 'ALM2', name: 'Alma Space' }] } });
    if (query.includes('issueLabels(')) return json({ issueLabels: { nodes: [{ id: 'lab-fb', name: 'Feedback' }] } });
    if (query.includes('issueLabelCreate')) return json({ issueLabelCreate: { success: true, issueLabel: { id: `lab-${variables.input.name}`, name: variables.input.name } } });
    if (query.includes('workflowStates(')) return json({ workflowStates: { nodes: [{ id: 'st-backlog2', name: 'Icebox', position: 2 }, { id: 'st-backlog', name: 'Backlog', position: 1 }] } });
    if (query.includes('fileUpload(')) return json({ fileUpload: { success: true, uploadFile: { uploadUrl: `https://uploads.linear.app/put/${variables.filename}`,
      assetUrl: `https://uploads.linear.app/asset/${variables.filename}`, headers: [{ key: 'x-goog-meta', value: 'abc' }] } } });
    if (query.includes('issueCreate')) {
      const issue = { id: `iss-${++n}`, identifier: `ALM2-${n}`, url: `https://linear.app/almacis/issue/ALM2-${n}`,
        state: { type: 'backlog', name: 'Backlog' }, labels: { nodes: [{ name: 'Feedback' }, { name: 'Da valutare' }] }, comments: { nodes: [] }, relations: { nodes: [] } };
      issues.set(issue.id, issue);
      return json({ issueCreate: { success: true, issue: { id: issue.id, identifier: issue.identifier, url: issue.url } } });
    }
    if (query.includes('relations')) return json({ issues: { nodes: variables.ids.map(id => issues.get(id)).filter(Boolean) } });
    return json({});
  };
  const notes = async () => (await db.query("SELECT body, link FROM notifications WHERE user_id = $1 AND kind = 'feedback' ORDER BY id", [anna.id])).rows;
  try {
    // il feedback salvato senza Linear parte al primo giro (con la sua foto)
    assert.equal(await syncFeedback(db, notifier), 0);
    const first = (await db.query('SELECT linear_identifier FROM feedback ORDER BY id LIMIT 1')).rows[0];
    assert.equal(first.linear_identifier, 'ALM2-41');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM feedback_images')).rows[0].n, 0); // foto caricata, tolta dal database

    // nuovo feedback con due foto: issue subito
    const r = await ANNA('POST', '/api/feedback', { kind: 'tecnico', body: 'Il Gantt dà errore quando sposto una attività',
      page: 'Gantt · #/gantt', images: [{ name: 'foto-schermo.png', mime: 'image/png', base64: PNG }, { mime: 'image/jpeg', base64: PNG }] });
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.sent, r.body.identifier], [true, 'ALM2-42']);
    const create = sent.filter(s => s.query.includes('issueCreate')).at(-1).variables.input;
    assert.equal(create.teamId, 'team-alm2');
    assert.equal(create.stateId, 'st-backlog');
    assert.equal(create.priority, 0);
    assert.deepEqual(create.labelIds, ['lab-fb', 'lab-Feedback: tecnico', 'lab-Da valutare']);
    assert.equal(create.title, '[Feedback] Il Gantt dà errore quando sposto una attività');
    assert.match(create.description, /^Il Gantt dà errore quando sposto una attività\n/);
    assert.match(create.description, /!\[foto dello schermo\]\(https:\/\/uploads\.linear\.app\/asset\/foto-schermo\.png\)/);
    assert.match(create.description, /!\[foto dello schermo\]\(https:\/\/uploads\.linear\.app\/asset\/foto-schermo-2\.jpg\)/);
    assert.match(create.description, /\*\*Da:\*\* .+ \(anna@almacis\.it\)/);
    assert.match(create.description, /\*\*Tipo:\*\* Problema tecnico/);
    assert.match(create.description, /\*\*Pagina:\*\* Gantt · #\/gantt/);
    assert.match(create.description, /\*\*Dispositivo:\*\* Chrome su Windows/);
    assert.match(create.description, /\*\*Inviato:\*\* \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    // etichette create una volta sola, nel team dei feedback
    const created = sent.filter(s => s.query.includes('issueLabelCreate')).map(s => [s.variables.input.name, s.variables.input.teamId]);
    assert.deepEqual(created, [['Feedback: tecnico', 'team-alm2'], ['Feedback: procedura', 'team-alm2'], ['Da valutare', 'team-alm2']]);
    // foto: PUT con gli header di Linear più tipo e cache
    const put = puts.at(-1);
    assert.deepEqual([put.headers['Content-Type'], put.headers['Cache-Control'], put.headers['x-goog-meta']], ['image/jpeg', 'public, max-age=31536000', 'abc']);
    assert.equal(sent.filter(s => s.query.includes('fileUpload(')).at(-1).variables.size, Buffer.from(PNG, 'base64').length);

    // Linear non risponde: il feedback resta salvato e parte al giro dopo
    down = true;
    const r2 = await ANNA('POST', '/api/feedback', { kind: 'procedura', body: 'Nel CRM servirebbe il filtro per provincia' });
    assert.deepEqual([r2.status, r2.body.sent], [201, false]);
    down = false;
    await syncFeedback(db, notifier);
    assert.equal((await db.query('SELECT linear_identifier FROM feedback WHERE id = $1', [r2.body.id])).rows[0].linear_identifier, 'ALM2-43');

    // su Linear: tolta «Da valutare» → approvato (notifica), poi completato → risolto (seconda notifica), poi niente
    const gantt = issues.get('iss-42');
    gantt.labels = { nodes: [{ name: 'Feedback' }] };
    const crm = issues.get('iss-43');
    crm.state = { type: 'canceled', name: 'Canceled' };
    crm.comments = { nodes: [{ body: 'Motivo: c\'è già nella ricerca avanzata', createdAt: '2026-11-22T10:00:00Z' }] };
    assert.equal(await syncFeedback(db, notifier), 2);
    assert.equal(await syncFeedback(db, notifier), 0);
    gantt.state = { type: 'completed', name: 'Done' };
    assert.equal(await syncFeedback(db, notifier), 1);
    const got = await notes();
    assert.deepEqual(got.map(x => x.link), ['/feedback', '/feedback', '/feedback']);
    assert.match(got[0].body, /approvato.*ALM2-42/);
    assert.match(got[1].body, /non è stato accolto: c'è già nella ricerca avanzata/);
    assert.match(got[2].body, /risolto.*ALM2-42/);

    // doppione: collegato a un'issue che c'è già
    const r3 = await ANNA('POST', '/api/feedback', { kind: 'tecnico', body: 'Il Gantt sbaglia quando trascino' });
    issues.get(`iss-${n}`).state = { type: 'duplicate', name: 'Duplicate' };
    issues.get(`iss-${n}`).relations = { nodes: [{ type: 'duplicate', relatedIssue: { identifier: 'ALM2-42' } }] };
    assert.equal(await syncFeedback(db, notifier), 1);
    assert.match((await notes()).at(-1).body, /era già stato segnalato \(è uguale a ALM2-42\)/);
    assert.deepEqual(Object.values((await db.query('SELECT outcome, outcome_reason FROM feedback WHERE id = $1', [r3.body.id])).rows[0]), ['doppione', 'Doppione di ALM2-42']);

    const mine = (await ANNA('GET', '/api/feedback/mine')).body.feedback;
    const byId = Object.fromEntries(mine.map(f => [f.linear_identifier, f]));
    assert.deepEqual([byId['ALM2-42'].outcome, byId['ALM2-43'].outcome, byId['ALM2-43'].outcome_reason, byId['ALM2-41'].outcome],
      ['risolto', 'non_accolto', 'c\'è già nella ricerca avanzata', 'da_valutare']);
    assert.equal(mine[0].linear_identifier, 'ALM2-44'); // il più recente in alto
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.LINEAR_API_KEY;
    linear._reset();
  }
});
