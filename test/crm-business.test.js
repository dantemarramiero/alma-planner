// Nuovi business: iniziativa, chat con azioni, clienti target con sinergie, lead nel CRM, gap, gate, radar, analisi.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { trafficLight, parseAnswer } = require('../lib/crm-business');

let server, base, db, D, E, F;
const calls = [];
// OpenAI finto: la chat (input = array di messaggi) risponde con il JSON dell'assistente, il radar (input = testo) con notizie
async function fakeOpenAI(url, opts) {
  const body = JSON.parse(opts.body);
  calls.push(body);
  if (Array.isArray(body.input)) {
    const answer = {
      answer: 'I clienti più vicini sono **e-distribuzione** e **Hera Reti**.\n- serve la SOA OG10',
      sources: [{ title: 'Portale fornitori', url: 'https://example.com/fornitori' }, { title: 'senza link', url: '' }],
      crm: ['Hera Reti'],
      targets: [{ name: 'e-distribuzione', segment: 'Distributore', why: 'rete in Abruzzo', priority: 'alta' }, { name: 'Hera Reti', segment: 'Distributore', why: 'gruppo già cliente', priority: 'alta' }],
      gaps: [{ title: 'SOA OG10', kind: 'Requisito', status: 'manca', how: 'ATI con un partner', timing: '24 mesi' }],
      steps: [{ title: 'Chiamare Elettro Adriatica', days: 6 }],
      plan: [{ phase: 'analisi', when: 'nov – gen', steps: ['Business plan'], gate: 'Proseguire con la qualifica?' }],
    };
    return { ok: true, json: async () => ({ output_text: '```json\n' + JSON.stringify(answer) + '\n```', output: [{ type: 'web_search_call' }], usage: { input_tokens: 10000, output_tokens: 1000 } }) };
  }
  const items = [{ title: 'Piano di sviluppo della rete MT in Abruzzo', entity: 'e-distribuzione', kind: 'investimento', amount: 30000000, region: 'Abruzzo', place: 'Pescara', url: 'https://example.com/piano', published_on: '2026-11-10', deadline: null, summary: 'Nuove cabine.', why: 'reti MT' }];
  return { ok: true, json: async () => ({ output_text: JSON.stringify(items), output: [], usage: { input_tokens: 5000, output_tokens: 500 } }) };
}
const ADMIN = 'direzione@almacis.it';
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const plus = n => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
const as = cookie => async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};
const meId = async who => { const b = (await who('GET', '/api/me')).body; return b.id ?? b.user?.id; };

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db, crmFetchEvents: async () => [], radarFetch: fakeOpenAI });
  server = out.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  D = as(await login(ADMIN));
  E = as(await login('recchia@almacis.it'));
  F = as(await login('altro@almacis.it'));
});
after(async () => { server?.close(); await db?.close(); });

test('semaforo e lettura della risposta', () => {
  const t = '2026-11-14';
  assert.equal(trafficLight({ phase: 'analisi', gate: { n: 1, due_date: '2026-11-12' }, lastActivity: t, spent: 10, budget: 100, today: t }).color, 'y');
  assert.equal(trafficLight({ phase: 'analisi', gate: null, lastActivity: '2026-09-01', spent: 10, budget: 100, today: t }).color, 'r');
  assert.equal(trafficLight({ phase: 'analisi', gate: null, lastActivity: t, spent: 150, budget: 100, today: t }).color, 'r');
  assert.equal(trafficLight({ phase: 'piano', gate: { n: 2, due_date: '2026-12-30' }, lastActivity: t, spent: 10, budget: 100, today: t }).color, 'g');
  assert.equal(trafficLight({ phase: 'abbandonata', today: t }).color, 'n');
  assert.equal(parseAnswer('testo libero').answer, 'testo libero');
});

test('iniziativa: chat, azioni, clienti target con sinergie, lead nel CRM, gap, piano, gate, radar, analisi', async () => {
  const recchia = await meId(E);
  await meId(F);
  // azienda già cliente nel CRM, con un contatto: la sinergia deve comparire
  const asa = (await D('GET', '/api/crm')).body.asa[0].key;
  const hera = await D('POST', '/api/crm/subjects', { name: 'Hera Reti', roles: ['partner'], asa: [asa], owner_id: recchia });
  assert.equal(hera.status, 201);

  const c = await D('POST', '/api/crm/business', { name: 'Reti elettriche MT/BT', description: 'Costruzione e manutenzione reti di distribuzione', owner_id: recchia, budget_eur: '25.000', asa });
  assert.equal(c.status, 201);
  const id = c.body.id;
  assert.equal(c.body.sponsor_id, await meId(D)); // la direzione che la crea ne è lo sponsor

  // chi non la segue la vede ma non la cambia
  assert.equal((await F('GET', `/api/crm/business/${id}`)).status, 200);
  assert.equal((await F('POST', `/api/crm/business/${id}/gaps`, { title: 'x' })).status, 403);

  // chat: risposta con fonti (solo quelle con link) e sinergia trovata nel CRM
  const m = await E('POST', `/api/crm/business/${id}/messages`, { question: 'Chi possono essere i primi clienti?' });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  assert.equal(m.body.sources.length, 1);
  assert.equal(m.body.crm[0].name, 'Hera Reti');
  assert.ok(m.body.crm[0].synergies.some(s => s.includes('partner')));
  assert.ok(Array.isArray(calls.at(-1).input) && calls.at(-1).input[0].content.includes('Reti elettriche MT/BT')); // l'assistente conosce l'iniziativa

  // azioni sotto la risposta
  assert.equal((await E('POST', `/api/crm/business/messages/${m.body.id}/apply`, { what: 'targets' })).body.added, 2);
  assert.equal((await E('POST', `/api/crm/business/messages/${m.body.id}/apply`, { what: 'targets' })).status, 409); // una volta sola
  assert.equal((await E('POST', `/api/crm/business/messages/${m.body.id}/apply`, { what: 'gaps' })).body.added, 1);
  assert.equal((await E('POST', `/api/crm/business/messages/${m.body.id}/apply`, { what: 'steps' })).body.added, 1);
  assert.equal((await E('POST', `/api/crm/business/messages/${m.body.id}/apply`, { what: 'note' })).body.added, 1);
  assert.equal((await E('POST', `/api/crm/business/messages/${m.body.id}/apply`, { what: 'plan' })).body.added, 1);

  // clienti target: Hera collegata al CRM con sinergie, e-distribuzione no → «Aggiungi al CRM come lead»
  const t = (await E('GET', `/api/crm/business/${id}/targets`)).body.targets;
  const h = t.find(x => x.name === 'Hera Reti');
  const ed = t.find(x => x.name === 'e-distribuzione');
  assert.equal(h.subject_id, hera.body.id);
  assert.ok(h.synergies.length >= 2);
  assert.equal(ed.subject_id, null);
  const lead = await E('POST', `/api/crm/business/targets/${ed.id}/lead`, {});
  assert.equal(lead.status, 201);
  const s = (await D('GET', `/api/crm/subjects/${lead.body.subject_id}`)).body;
  assert.deepEqual(s.roles, ['lead']);
  assert.equal(s.owner_id, recchia);
  assert.equal((await E('PATCH', `/api/crm/business/targets/${ed.id}`, { status: 'incontro' })).status, 200);

  // gap colmato
  const g = (await E('GET', `/api/crm/business/${id}/gaps`)).body.gaps[0];
  assert.equal((await E('PATCH', `/api/crm/business/gaps/${g.id}`, { status: 'ce', cost_eur: '6.000' })).body.status, 'ce');

  // gate: lo decide la direzione, non il responsabile; si decide quello della fase in corso
  assert.equal((await E('POST', `/api/crm/business/${id}/gates/0/decide`, { decision: 'prosegui' })).status, 403);
  assert.equal((await D('POST', `/api/crm/business/${id}/gates/1/decide`, { decision: 'prosegui' })).status, 409);
  assert.equal((await D('POST', `/api/crm/business/${id}/gates/0/decide`, { decision: 'rimanda' })).status, 400); // serve il perché
  assert.equal((await D('POST', `/api/crm/business/${id}/gates/0/decide`, { decision: 'rimanda', note: 'Manca il business plan', due_date: plus(10) })).status, 200);
  const ok = await D('POST', `/api/crm/business/${id}/gates/0/decide`, { decision: 'prosegui', note: 'Budget 25.000 € per l\'analisi' });
  assert.equal(ok.body.phase, 'analisi');
  const nr = await E('GET', `/api/crm/business/${id}/riflessioni`);
  assert.equal(nr.status, 200, JSON.stringify(nr.body));
  const notes = nr.body.notes;
  assert.equal(notes.filter(n => n.kind === 'decisione').length, 2); // anche il rimando resta nel diario
  assert.equal((await E('DELETE', `/api/crm/business/riflessioni/${notes.find(n => n.kind === 'decisione').id}`)).status, 403);

  // ipotesi da verificare, rischio
  assert.equal((await E('POST', `/api/crm/business/${id}/riflessioni`, { kind: 'ipotesi', title: 'Le squadre bastano' })).body.check_status, 'da_verificare');
  assert.equal((await E('POST', `/api/crm/business/${id}/riflessioni`, { kind: 'rischio', title: 'Tempi di qualifica', level: 'alto', mitigation: 'ATI' })).status, 201);

  // radar dell'iniziativa: profilo, giro, segnale → cliente target
  assert.equal((await E('POST', `/api/crm/business/${id}/radar/run`, {})).status, 200); // usa la descrizione se il profilo è vuoto
  assert.equal((await E('PUT', `/api/crm/business/${id}/profile`, { description: 'reti MT/BT', keywords: ['cabine', 'reti'], regions: ['Abruzzo'] })).status, 200);
  const radar = (await E('GET', `/api/crm/business/${id}/radar`)).body;
  assert.equal(radar.signals.length, 1);
  assert.ok(radar.signals[0].score > 0);
  assert.equal((await E('POST', `/api/crm/business/signals/${radar.signals[0].id}/target`, {})).status, 200);

  // analisi e lista
  const a = (await D('GET', `/api/crm/business/${id}/analisi`)).body;
  assert.equal(a.funnel.individuati, 2);
  assert.equal(a.funnel.contattati, 1);
  assert.equal(a.funnel.incontrati, 1);
  assert.equal(a.gaps.ok, 1);
  assert.ok(a.ai_eur > 0); // la chat e il radar contano nella spesa
  assert.equal(a.weeks.length, 4);
  assert.ok(a.weeks[3].notes >= 2); // le riflessioni del responsabile contano come attività
  assert.equal(a.risks.length, 1);
  assert.ok(['g', 'y'].includes(a.light.color));
  const list = (await F('GET', '/api/crm/business')).body;
  assert.equal(list.kpis.open, 1);
  assert.equal(list.initiatives[0].phase, 'analisi');

  // abbandonare
  assert.equal((await D('POST', `/api/crm/business/${id}/gates/1/decide`, { decision: 'abbandona', note: 'Margini troppo bassi' })).body.phase, 'abbandonata');
  assert.equal((await D('GET', '/api/crm/business')).body.kpis.open, 0);

  // idea senza iniziativa
  assert.equal((await F('POST', '/api/crm/business/idea', { question: 'In quali aree potremmo entrare?' })).status, 201);
});
