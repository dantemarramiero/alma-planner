// «Cerca su internet» nell'anagrafica: alternative quando Alma è indecisa, dati con la fonte, si salvano solo quelli spuntati
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { parseAnswer } = require('../lib/crm-web');

let server, base, db, D;
const prompts = [];
async function fakeOpenAI(url, opts) {
  const body = JSON.parse(opts.body);
  prompts.push(body.input);
  if (/profilo LinkedIn pubblico/.test(body.input)) {
    const profili = [{ url: 'https://it.linkedin.com/in/paolo-di-fabio-123?trk=x', titolo: 'Paolo Di Fabio – Direttore tecnico', azienda: 'Impianti Adriatica' },
      { url: 'https://www.linkedin.com/company/adriatica', titolo: 'pagina aziendale' }, { url: 'https://it.linkedin.com/in/paolo-di-fabio-123', titolo: 'doppione' }];
    return { ok: true, json: async () => ({ output_text: JSON.stringify({ profili }), output: [], usage: {} }) };
  }
  const chosen = /scelta dalla persona/.test(body.input);
  const answer = chosen
    ? { ambigua: false, azienda: { nome: 'Impianti Adriatica S.r.l.', citta: 'Pescara', piva: '02134560685' },
      dati: [{ campo: 'vat', valore: '02134560685', fonte: 'https://www.registroimprese.it/x' }, { campo: 'address', valore: 'Via Tiburtina Valeria 214', fonte: 'https://impiantiadriatica.it/contatti' },
        { campo: 'province', valore: 'PE', fonte: 'https://impiantiadriatica.it/contatti' }, { campo: 'region', valore: 'Narnia', fonte: 'https://x.it' }, { campo: 'inventato', valore: 'x' }, { campo: 'phone', valore: '085 431 2210' }] }
    : { ambigua: true, candidati: [{ nome: 'Impianti Adriatica S.r.l.', citta: 'Pescara', descrizione: 'impianti termici' }, { nome: 'Impianti Adriatica S.n.c.', citta: 'Ancona', descrizione: 'impianti elettrici' }] };
  return { ok: true, json: async () => ({ output_text: `Ecco: ${JSON.stringify(answer)}`, output: [{ type: 'web_search_call' }, { content: [{ text: '', annotations: [{ type: 'url_citation', url: 'https://impiantiadriatica.it' }] }] }], usage: { input_tokens: 1000, output_tokens: 200 } }) };
}
const as = cookie => async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'direzione@almacis.it', API_WRITE_MAX: '2000' }), { db, crmFetchEvents: async () => [], radarFetch: fakeOpenAI });
  server = out.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/dev-login?email=direzione@almacis.it`, { redirect: 'manual' });
  D = as(res.headers.get('set-cookie').split(';')[0]);
});
after(async () => { server?.close(); await db?.close(); });

test('risposta di OpenAI: candidati se è ambigua, dati validi con la fonte se è sicura', () => {
  const amb = parseAnswer('{"ambigua": true, "candidati": [{"nome": "A"}, {"nome": "B"}]}');
  assert.equal(amb.ambiguous, true);
  assert.deepEqual(amb.candidates.map(c => c.name), ['A', 'B']);
  const ok = parseAnswer('testo {"ambigua": false, "azienda": {"nome": "A"}, "dati": [{"campo": "pec", "valore": "a@pec.it", "fonte": "https://a.it"}, {"campo": "pec", "valore": "doppio"}, {"campo": "x", "valore": "y"}]} fine');
  assert.deepEqual(ok.fields.map(f => [f.key, f.value, f.source, f.label]), [['pec', 'a@pec.it', 'https://a.it', 'PEC']]);
  assert.equal(parseAnswer('niente json').error, 'Risposta non leggibile');
});

test('«Cerca su internet»: alternative → scelta → dati spuntati salvati «da internet» → conferma', async () => {
  const s = (await D('POST', '/api/crm/subjects/rapida', { name: 'Impianti Adriatica' })).body;
  const first = await D('POST', `/api/crm/subjects/${s.id}/cerca-web`, {});
  assert.equal(first.status, 200);
  assert.equal(first.body.ambiguous, true);
  assert.equal(first.body.candidates.length, 2);
  assert.match(prompts[0], /Impianti Adriatica/);
  const second = await D('POST', `/api/crm/subjects/${s.id}/cerca-web`, { scelta: first.body.candidates[0] });
  assert.equal(second.body.ambiguous, false);
  assert.match(prompts[1], /Pescara/);
  const keys = second.body.fields.map(f => f.key);
  assert.deepEqual(keys, ['vat', 'address', 'province', 'region', 'phone']);
  assert.equal(second.body.fields.find(f => f.key === 'phone').source, 'https://impiantiadriatica.it'); // fonte dalla citazione
  const pick = Object.fromEntries(second.body.fields.filter(f => f.key !== 'phone').map(f => [f.key, f.value]));
  const sources = Object.fromEntries(second.body.fields.map(f => [f.key, f.source]));
  const saved = await D('POST', `/api/crm/subjects/${s.id}/da-web`, { fields: pick, sources });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.saved.sort(), ['address', 'province', 'vat']);
  assert.deepEqual(saved.body.skipped, ['Regione']); // «Narnia» non è una regione: si salta, il resto si salva
  assert.equal(saved.body.subject.phone, '');
  assert.ok(saved.body.subject.web_fields.vat.source.includes('registroimprese'));
  // cambiato a mano non è più «da internet»; confermato idem
  await D('PATCH', `/api/crm/subjects/${s.id}`, { address: 'Via Tiburtina Valeria 216' });
  let cur = (await D('GET', `/api/crm/subjects/${s.id}`)).body;
  assert.ok(!cur.web_fields.address && cur.web_fields.vat);
  await D('POST', `/api/crm/subjects/${s.id}/da-web/conferma`, { key: 'vat' });
  cur = (await D('GET', `/api/crm/subjects/${s.id}`)).body;
  assert.deepEqual(Object.keys(cur.web_fields), ['province']);
  assert.equal((await D('POST', `/api/crm/subjects/${s.id}/da-web`, { fields: { inventato: 'x' } })).status, 400);
});

test('«Trova su LinkedIn»: solo link linkedin.com/in/ puliti e senza doppioni; il link si salva solo scelto', async () => {
  const c = (await D('POST', '/api/crm/contacts', { first_name: 'Paolo', last_name: 'Di Fabio' })).body;
  const r = await D('POST', `/api/crm/contacts/${c.id}/cerca-linkedin`, {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.profiles.map(p => p.url), ['https://it.linkedin.com/in/paolo-di-fabio-123']);
  assert.match(prompts.at(-1), /Paolo Di Fabio/);
  assert.equal((await D('GET', `/api/crm/contacts/${c.id}`)).body.linkedin, '');
});

test('Azienda al volo con la categoria scelta (22/11): fornitore e partner, cliente; lead se non detta; lead e cliente no', async () => {
  const a = (await D('POST', '/api/crm/subjects/rapida', { name: 'Termo Abruzzo', roles: ['fornitore', 'partner'] })).body;
  assert.deepEqual(a.roles, ['fornitore', 'partner']);
  const b = (await D('POST', '/api/crm/subjects/rapida', { name: 'Comune di Prova', roles: ['cliente'] })).body;
  assert.deepEqual(b.roles, ['cliente']);
  assert.ok(b.client_since);
  assert.deepEqual((await D('POST', '/api/crm/subjects/rapida', { name: 'Senza categoria', roles: ['boh'] })).body.roles, ['lead']);
  assert.equal((await D('POST', '/api/crm/subjects/rapida', { name: 'Doppia', roles: ['lead', 'cliente'] })).status, 400);
});
