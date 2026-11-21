// Banco di prova di Alma (21/11): il giudizio delle risposte (numeri all'italiana, nomi, proposte, numeri inventati) e
// un giro intero con un modello finto: 60 domande, quelle senza dati saltate, conversazioni e tracce cancellate dopo.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const BANCO = require('../lib/assistente-banco');

test('banco: 60 domande e giudizio delle risposte', () => {
  assert.equal(BANCO.QUESTIONS.length, 60);
  assert.ok(BANCO.numberIn('Hai **1.234** ticket{f1}', 1234));
  assert.ok(BANCO.numberIn('Avanzamento al **62,5%**', 62.5));
  assert.ok(BANCO.numberIn('Avanzamento circa al 63%', 62.5));
  assert.ok(!BANCO.numberIn('Avanzamento al 60%', 62.5));
  assert.ok(BANCO.numberIn('Non ci sono ticket in ritardo.', 0));
  assert.ok(!BANCO.numberIn('Hai 3 ticket.', 4));
  assert.ok(BANCO.nameIn('Il responsabile è **Mario Rossi**.', 'Mario Rossi'));
  assert.ok(BANCO.nameIn('Lo segue Rossi.', 'Mario Rossi'));
  assert.ok(!BANCO.nameIn('Lo segue Bianchi.', 'Mario Rossi'));
  assert.deepEqual(BANCO.grade({ numeri: [3] }, { reply: 'Hai **3** ticket aperti.', proposte: [], non_verificati: 0 }), { ok: true, note: '' });
  const bad = BANCO.grade({ numeri: [3] }, { reply: 'Hai **3** ticket e **7** in ritardo.', proposte: [], non_verificati: 1 });
  assert.equal(bad.ok, false);
  assert.match(bad.note, /1 numero inventato/);
  assert.equal(BANCO.grade({ proposta: 'proponi_ticket' }, { reply: 'Fatto.', proposte: [] }).ok, false);
  assert.equal(BANCO.grade({ proposta: 'proponi_ticket' }, { reply: 'Ecco la scheda.', proposte: ['proponi_ticket'] }).ok, true);
  assert.equal(BANCO.grade({ nessuna_proposta: true, frase: /non (ho )?trov/i }, { reply: 'Non trovo questo progetto.', proposte: [] }).ok, true);
  assert.equal(BANCO.grade({ numeri: [1] }, { error: 'Tempo scaduto' }).ok, false);
});

let server, base, db, alma, D;
const ADMIN = 'direzione@almacis.it';
const asked = [];
// Modello finto: per «Quanti ticket aperti ho?» cerca e risponde col numero; per un ticket prepara la scheda; il resto
// non lo trova. Così si vede un giro con domande giuste, sbagliate e saltate.
async function fakeModel(params) {
  const last = params.messages[params.messages.length - 1];
  const text = Array.isArray(last.content) ? last.content.filter(b => b.type === 'text').map(b => b.text).join(' ') : String(last.content);
  const tr = Array.isArray(last.content) && last.content.find(b => b.type === 'tool_result');
  const usage = { input_tokens: 100, output_tokens: 10 };
  if (tr) {
    const out = JSON.parse(tr.content);
    if (out.aperti !== undefined) return { usage, stop_reason: 'end_turn', content: [{ type: 'text', text: `Hai **${out.aperti}**{${out.fonte_id}} ticket aperti.` }] };
    return { usage, stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ecco la scheda da confermare.' }] };
  }
  asked.push(text);
  if (/Quanti ticket aperti ho\?/.test(text)) return { usage, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${asked.length}`, name: 'ticket_elenco', input: {} }] };
  if (/Crea un ticket per me/.test(text)) return { usage, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${asked.length}`, name: 'proponi_ticket', input: { titolo: 'Report mensile', assegnati: ['io'] } }] };
  return { usage, stop_reason: 'end_turn', content: [{ type: 'text', text: 'Non ho trovato niente su questo.' }] };
}
async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
const as = cookie => async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN, API_WRITE_MAX: '2000' }), { db, crmFetchEvents: async () => [], assistantClient: fakeModel,
    almaMailer: async () => {}, almaMailReader: async () => [] });
  alma = out.alma;
  server = out.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  D = as(await login(ADMIN));
  const me = (await D('GET', '/api/me')).body.id;
  assert.equal((await D('POST', '/api/tickets', { title: 'Controllo estintori sede', assignee_ids: [me], due_date: '2026-01-15' })).status, 201);
});
after(async () => { server?.close(); await db?.close(); });

test('banco: un giro intero in sottofondo, giudicato e ripulito', async () => {
  const E = as(await login('edile@almacis.it'));
  assert.equal((await E('POST', '/api/alma/banco/esegui')).status, 403);
  const start = await D('POST', '/api/alma/banco/esegui');
  assert.equal(start.status, 202);
  assert.equal((await D('POST', '/api/alma/banco/esegui')).status, 409);
  await alma.banco.wait();
  const { body } = await D('GET', '/api/alma/banco');
  const run = body.ultimo;
  assert.equal(run.status, 'finito');
  assert.equal(run.total, 60);
  assert.equal(run.done, 60);
  const byId = Object.fromEntries(run.details.map(d => [d.id, d]));
  assert.equal(byId[1].ok, true, byId[1].note); // «Quanti ticket aperti ho?» → 1
  assert.equal(byId[2].ok, false); // in ritardo: il finto non lo sa
  assert.ok(run.details.some(d => d.saltata), 'senza mezzi o radar alcune domande si saltano');
  const ticketProp = run.details.find(d => d.testo && d.testo.startsWith('Crea un ticket per me'));
  assert.equal(ticketProp.ok, true, ticketProp.note);
  const notFound = run.details.find(d => d.testo && d.testo.includes('Zefiro'));
  assert.equal(notFound.ok, true, notFound.note);
  assert.equal(run.invented, 0);
  assert.ok(run.passed >= 3 && run.passed < run.total - run.skipped);
  assert.equal(run.proposals_ok, 1);
  assert.ok(run.proposals_n >= 1);
  // niente resta: conversazioni, proposte e tracce del banco vanno via
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM assistant_conversations')).rows[0].n, 0);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM assistant_actions')).rows[0].n, 0);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM assistant_traces')).rows[0].n, 0);
  assert.ok((await db.query('SELECT COUNT(*)::int AS n FROM assistant_usage')).rows[0].n > 0, 'il costo resta');
  // il secondo giro si confronta col primo
  await D('POST', '/api/alma/banco/esegui');
  await alma.banco.wait();
  const again = (await D('GET', '/api/alma/banco')).body;
  assert.equal(again.precedente.id, run.id);
  assert.equal(again.precedente.esiti[1], true);
  assert.equal(again.giri.length, 2);
});
