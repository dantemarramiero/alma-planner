// Documenti del progetto con un OneDrive simulato: cartella creata al primo caricamento e condivisa con i membri,
// nomi con caratteri non ammessi ripuliti, elenco letto dalla cartella vera (anche i file messi da fuori),
// caricamento sui ticket in sottocartella, condivisione ai nuovi membri, messaggio chiaro senza accesso.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, auth;
const cookies = {};
const realFetch = globalThis.fetch;

// ── OneDrive finto: elementi in memoria, cartella radice «root» nel drive «drv» ──────────────────────────
const items = new Map([['root', { id: 'root', name: 'root', folder: {}, parent: null }]]);
const invites = [];
let seq = 0;
let denied = false;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const out = it => ({ id: it.id, name: it.name, ...(it.folder ? { folder: { childCount: 0 } } : { file: { mimeType: 'application/octet-stream' }, size: it.size }),
  webUrl: `https://onedrive/${it.id}`, lastModifiedDateTime: '2026-10-09T10:00:00Z', parentReference: { driveId: 'drv' } });
const childOf = (pid, name) => [...items.values()].find(i => i.parent === pid && i.name === name);
function add(pid, name, folder, size = 0) {
  let n = name, k = 1;
  while (childOf(pid, n)) n = name.replace(/(\.\w+)?$/, ` ${k++}$1`); // conflictBehavior=rename
  const it = { id: `i${++seq}`, name: n, parent: pid, folder: folder ? {} : null, size };
  items.set(it.id, it);
  return it;
}
// fuori dall'app qualcuno mette un file nella cartella
const putExternally = (pid, name) => add(pid, name, false, 10);

function fakeGraph(url, opts = {}) {
  if (denied) return json({ error: { code: 'accessDenied', message: 'Access denied' } }, 403);
  const u = new URL(url);
  const method = opts.method || 'GET';
  const p = decodeURIComponent(u.pathname.replace('/v1.0', ''));
  let m;
  if (p === '/me/drive/root') return json({ id: 'root', parentReference: { driveId: 'drv' } });
  if ((m = p.match(/^\/drives\/drv\/items\/([^/:]+)\/children$/))) {
    if (method === 'POST') {
      const b = JSON.parse(opts.body);
      if (childOf(m[1], b.name)) return json({ error: { code: 'nameAlreadyExists' } }, 409);
      return json(out(add(m[1], b.name, true)), 201);
    }
    return json({ value: [...items.values()].filter(i => i.parent === m[1]).map(out) });
  }
  if ((m = p.match(/^\/drives\/drv\/items\/([^/:]+)\/invite$/))) {
    invites.push({ item: m[1], emails: JSON.parse(opts.body).recipients.map(r => r.email) });
    return json({ value: [] });
  }
  if ((m = p.match(/^\/drives\/drv\/items\/([^/:]+):\/(.+?):?\/content$/)) && method === 'PUT') {
    const parts = m[2].split('/');
    let pid = m[1];
    for (const f of parts.slice(0, -1)) pid = (childOf(pid, f) || add(pid, f, true)).id; // Graph crea le sottocartelle
    return json(out(add(pid, parts.at(-1), false, opts.body.length)), 201);
  }
  if ((m = p.match(/^\/drives\/drv\/items\/([^/:]+):\/(.+)$/)) && method === 'GET') {
    const it = childOf(m[1], m[2]);
    return it ? json(out(it)) : json({ error: { code: 'itemNotFound', message: 'not found' } }, 404);
  }
  return json({ error: { message: `non simulato: ${method} ${p}` } }, 404);
}

async function api(who, method, path, body, raw) {
  const res = await realFetch(base + path, {
    method,
    headers: { cookie: cookies[who], 'X-Alma': '1', ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const login = async email => {
  const res = await realFetch(`${base}/auth/dev-login?email=${encodeURIComponent(email)}`, { redirect: 'manual' });
  cookies[email] = res.headers.get('set-cookie').split(';')[0];
};

const DANTE = 'dante@almacis.it', GIULIA = 'giulia@almacis.it', MARCO = 'marco@almacis.it';

before(async () => {
  db = await createDb({});
  const created = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', MS_TENANT_ID: '' }), { db });
  auth = created.auth;
  server = created.app.listen(0);
  server.keepAliveTimeout = 60000; // vedi gli altri test: evita ECONNRESET sotto carico
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const e of [DANTE, GIULIA, MARCO]) await login(e);
  auth.graphToken = async () => 'token-finto';
  auth.msConfigured = true;
  globalThis.fetch = (url, opts) => (String(url).startsWith('https://graph.microsoft.com/') ? fakeGraph(String(url), opts) : realFetch(url, opts));
});

after(async () => {
  globalThis.fetch = realFetch;
  server?.close();
  await db?.close();
});

test('primo caricamento: crea «Alma Planet/<progetto>», la collega, la condivide con i membri; nome ripulito', async () => {
  const giulia = (await api(GIULIA, 'GET', '/api/me')).body.id;
  const p = (await api(DANTE, 'POST', '/api/projects', { name: 'Gara: Pescara?' })).body;
  await api(DANTE, 'POST', `/api/projects/${p.id}/members`, { user_ids: [giulia] });

  const up = await api(DANTE, 'POST', `/api/projects/${p.id}/files/upload?name=${encodeURIComponent('Verbale: riunione?.pdf')}`, null, Buffer.from('ciao'));
  assert.equal(up.status, 201);
  assert.equal(up.body.name, 'Verbale- riunione-.pdf');
  assert.equal(up.body.folderCreated, 'Gara- Pescara-');
  assert.equal(up.body.sharedWith, 1);

  const root = childOf('root', 'Alma Planet');
  const folder = childOf(root.id, 'Gara- Pescara-');
  assert.ok(folder, 'cartella del progetto creata');
  assert.deepEqual(invites.at(-1), { item: folder.id, emails: [GIULIA] });
  const proj = (await api(DANTE, 'GET', `/api/projects/${p.id}`)).body;
  assert.equal(proj.onedrive_item_id, folder.id);

  // l'elenco legge la cartella vera: c'è anche il file messo da fuori, e si vede pure da Giulia
  putExternally(folder.id, 'Offerta firmata.pdf');
  const docs = (await api(GIULIA, 'GET', `/api/projects/${p.id}/files`)).body;
  assert.equal(docs.folderError, null);
  assert.deepEqual(docs.items.map(i => i.name).sort(), ['Offerta firmata.pdf', 'Verbale- riunione-.pdf']);
  assert.equal(docs.folder.name, 'Gara- Pescara-');

  // secondo caricamento: stessa cartella, nessuna nuova creazione; stesso nome = rinominato da OneDrive
  const again = await api(GIULIA, 'POST', `/api/projects/${p.id}/files/upload?name=${encodeURIComponent('Verbale: riunione?.pdf')}`, null, Buffer.from('bis'));
  assert.equal(again.status, 201);
  assert.equal(again.body.folderCreated, null);
  assert.equal(again.body.name, 'Verbale- riunione- 1.pdf');
  assert.equal([...items.values()].filter(i => i.name === 'Gara- Pescara-').length, 1);

  // un nuovo membro riceve la condivisione della cartella
  const marco = (await api(MARCO, 'GET', '/api/me')).body.id;
  const r = await api(DANTE, 'POST', `/api/projects/${p.id}/members`, { user_ids: [marco] });
  assert.equal(r.body.folderSharedWith, 1);
  assert.deepEqual(invites.at(-1), { item: folder.id, emails: [MARCO] });

  // caricamento su un ticket: sottocartella «Ticket N - titolo», e il file resta legato al ticket
  const t = (await api(DANTE, 'POST', '/api/tickets', { title: 'Sopralluogo', project_id: p.id })).body;
  const tu = await api(DANTE, 'POST', `/api/tickets/${t.id}/files/upload?name=foto.jpg`, null, Buffer.from('jpg'));
  assert.equal(tu.status, 201);
  assert.ok(childOf(folder.id, `Ticket ${t.id} - Sopralluogo`));
  const docs2 = (await api(DANTE, 'GET', `/api/projects/${p.id}/files`)).body;
  assert.deepEqual(docs2.ticketFiles.map(f => [f.name, f.ticket_title]), [['foto.jpg', 'Sopralluogo']]);
});

test('senza accesso alla cartella: messaggio chiaro, sia nell\'elenco sia nel caricamento', async () => {
  const p = (await api(DANTE, 'POST', '/api/projects', { name: 'Riservato' })).body;
  await api(DANTE, 'POST', `/api/projects/${p.id}/files/upload?name=a.txt`, null, Buffer.from('a')); // crea la cartella
  denied = true;
  try {
    const up = await api(DANTE, 'POST', `/api/projects/${p.id}/files/upload?name=b.txt`, null, Buffer.from('b'));
    assert.equal(up.status, 403);
    assert.match(up.body.error, /non ti dà accesso/);
    const docs = (await api(DANTE, 'GET', `/api/projects/${p.id}/files`)).body;
    assert.equal(docs.items, null);
    assert.match(docs.folderError, /non ti dà accesso/);
  } finally { denied = false; }
});

test('file vuoto: errore chiaro, nessuna cartella creata', async () => {
  const p = (await api(DANTE, 'POST', '/api/projects', { name: 'Vuoto' })).body;
  const before = items.size;
  const up = await api(DANTE, 'POST', `/api/projects/${p.id}/files/upload?name=x.txt`, null, Buffer.alloc(0));
  assert.equal(up.status, 400);
  assert.equal(items.size, before); // nessuna cartella creata per un file vuoto
});
