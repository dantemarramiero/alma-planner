// Radar commerciale: segnali con punteggio, Interessa → piano d'azione, Scarta, export di Infordat all'ufficio gare.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, D, E, F;
const aiCalls = [];
// OpenAI finto: due notizie (una senza link, da scartare) e il costo dai token
async function fakeOpenAI(url, opts) {
  aiCalls.push(JSON.parse(opts.body));
  const items = [
    { title: 'Nuovo stabilimento con capannone da 20.000 mq a Ortona', entity: 'Ortona Logistica Srl', kind: 'investimento', amount: 9000000, region: 'Abruzzo', place: 'Ortona', url: 'https://example.com/ortona', published_on: '2026-11-12', deadline: null, summary: 'Investimento annunciato.', why: 'Capannone industriale' },
    { title: 'Senza fonte', entity: 'X', kind: 'notizia', url: '' },
  ];
  return { ok: true, json: async () => ({ output_text: 'Ecco:\n```json\n' + JSON.stringify(items) + '\n```', output: [{ type: 'web_search_call' }], usage: { input_tokens: 20000, output_tokens: 2000 } }) };
}
const cookies = {};
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
const upload = (cookie, path, text) => fetch(base + path, { method: 'POST', headers: { cookie, 'X-Alma': '1', 'Content-Type': 'text/csv' }, body: text })
  .then(async r => ({ status: r.status, body: await r.json() }));
const meId = async who => { const b = (await who('GET', '/api/me')).body; return b.id ?? b.user?.id; };

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db, crmFetchEvents: async () => [], radarFetch: fakeOpenAI });
  server = out.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  cookies.D = await login(ADMIN);
  cookies.E = await login('edile@almacis.it');
  D = as(cookies.D);
  E = as(cookies.E);
  F = as(await login('facility@almacis.it'));
  // edile@ è il responsabile di Edilizia; parola chiave «capannone»
  const s = (await D('GET', '/api/crm/commerciale')).body.settings;
  const r = await D('PUT', '/api/crm/commerciale/profiles', { value: { edilizia: { ...s.profiles.edilizia, manager_id: await meId(E), keywords: ['capannone'] } } });
  assert.equal(r.status, 200);
  assert.equal((await E('POST', '/api/crm/subjects', { name: 'Logistica Sud', roles: ['lead'], asa: ['edilizia'] })).status, 201);
});
after(async () => { server?.close(); await db?.close(); });

test('segnalazione con punteggio, Interessa → piano d\'azione dal playbook, Accetta → prossimi passi, chiusura', async () => {
  const g = await E('POST', '/api/crm/radar/signals', { title: 'Nuovo capannone logistico a San Salvo', entity: 'Logistica Sud', kind: 'investimento', amount: '5.000.000', deadline: plus(60), url: 'https://example.com/notizia' });
  assert.equal(g.status, 201);
  assert.equal(g.body.bu, 'edilizia'); // BU scelta dal profilo
  assert.ok(g.body.subject_id); // agganciato all'azienda del CRM con lo stesso nome
  const p = g.body.score_parts;
  assert.equal(g.body.score, p.fit + p.concreteness + p.timing + p.relationship + p.value);
  assert.equal(p.relationship, 8); // già nel CRM, non cliente
  assert.equal(p.concreteness, 10); // investimento = notizia
  assert.ok(g.body.score >= 50);
  assert.ok((await E('GET', '/api/crm/radar/signals')).body.signals.some(x => x.id === g.body.id));
  assert.equal((await F('POST', `/api/crm/radar/signals/${g.body.id}/interessa`, {})).status, 403); // decide il responsabile della BU
  const i = await E('POST', `/api/crm/radar/signals/${g.body.id}/interessa`, {});
  assert.equal(i.status, 200);
  assert.equal(i.body.subject_id, g.body.subject_id);
  const plan = i.body.plan;
  assert.equal(plan.status, 'proposto');
  assert.equal(plan.playbook_id, 'investimento');
  assert.equal(plan.steps.length, 5); // 4 passi del playbook + la verifica
  assert.match(plan.steps.at(-1).title, /^Verifica:/);
  assert.equal(plan.steps[0].due_date, plus(2));
  assert.equal((await E('POST', `/api/crm/radar/signals/${g.body.id}/scarta`, { reason: 'Altro' })).status, 409); // già deciso
  assert.ok((await E('GET', '/api/crm/radar/plans')).body.plans.some(x => x.id === plan.id)); // da accettare
  const steps = plan.steps.map((s, k) => (k === 0 ? { ...s, title: 'Chiamare l\'ing. Bianchi' } : s));
  const acc = await E('POST', `/api/crm/plans/${plan.id}/accept`, { steps });
  assert.equal(acc.status, 200);
  assert.equal(acc.body.status, 'accettato');
  const open = (await E('GET', `/api/crm/subjects/${g.body.subject_id}/steps`)).body.open;
  assert.ok(open.some(s => s.title === 'Chiamare l\'ing. Bianchi' && s.plan_id === plan.id));
  assert.equal((await E('GET', `/api/crm/subjects/${g.body.subject_id}`)).body.next_step, 'Chiamare l\'ing. Bianchi');
  assert.equal((await E('POST', `/api/crm/plans/${plan.id}/accept`, { steps })).status, 409);
  const sp = (await E('GET', `/api/crm/subjects/${g.body.subject_id}/plans`)).body;
  assert.equal(sp.plans[0].live.length, 5);
  assert.ok(sp.signals.some(x => x.id === g.body.id && x.status === 'interessa'));
  const closed = await E('POST', `/api/crm/plans/${plan.id}/close`, { outcome: 'opportunita', note: 'Aperta in BOSS', close_steps: true });
  assert.equal(closed.body.outcome, 'opportunita');
  assert.equal((await E('GET', `/api/crm/subjects/${g.body.subject_id}/steps`)).body.open.filter(s => s.plan_id === plan.id).length, 0);
  // piano a mano da un playbook, poi cancellato perché non serve
  const manual = await E('POST', `/api/crm/subjects/${g.body.subject_id}/plans`, { playbook_id: 'cliente' });
  assert.equal(manual.status, 201);
  assert.equal((await E('DELETE', `/api/crm/plans/${manual.body.id}`)).status, 200);
});

test('Scarta con motivo; azienda nuova → nuovo lead della BU; «Manda a un\'altra BU»; sotto soglia', async () => {
  const a = (await E('POST', '/api/crm/radar/signals', { title: 'Ampliamento capannone industriale', entity: 'Capannoni Nuovi Spa', kind: 'permesso', bu: 'edilizia' })).body;
  assert.equal((await E('POST', `/api/crm/radar/signals/${a.id}/scarta`, {})).status, 400);
  assert.equal((await E('POST', `/api/crm/radar/signals/${a.id}/scarta`, { reason: 'Importo troppo piccolo' })).status, 200);
  const b = (await E('POST', '/api/crm/radar/signals', { title: 'Nuovo capannone per la logistica', entity: 'Capannoni Nuovi Spa', kind: 'permesso', bu: 'edilizia' })).body;
  const i = await E('POST', `/api/crm/radar/signals/${b.id}/interessa`, {});
  assert.equal(i.status, 200);
  const s = (await E('GET', `/api/crm/subjects/${i.body.subject_id}`)).body;
  assert.equal(s.name, 'Capannoni Nuovi Spa');
  assert.deepEqual(s.roles, ['lead']);
  assert.deepEqual(s.asa, ['edilizia']);
  assert.equal(s.origin, 'Radar');
  assert.equal(i.body.plan.playbook_id, 'permesso');
  // un segnale che non c'entra: sotto soglia, non arriva ma si vede in «Sotto soglia»; poi va a Facility
  const c = (await E('POST', '/api/crm/radar/signals', { title: 'Fornitura di cancelleria', bu: 'edilizia', kind: 'indiscrezione' })).body;
  assert.ok(c.score < 50);
  assert.ok(!(await E('GET', '/api/crm/radar/signals')).body.signals.some(x => x.id === c.id));
  assert.ok((await E('GET', '/api/crm/radar/signals?view=sotto')).body.signals.some(x => x.id === c.id));
  const moved = await E('POST', `/api/crm/radar/signals/${c.id}/bu`, { bu: 'facility' });
  assert.equal(moved.body.bu, 'facility');
  assert.equal((await E('POST', `/api/crm/radar/signals/${c.id}/scarta`, { reason: 'Altro' })).status, 403); // ora è di Facility
});

test('export di Infordat all\'ufficio gare (CSV con ;), niente doppioni, «Porta su BOSS» o «Scarta»', async () => {
  const csv = 'Export Infordat del 14/11/2026\n'
    + 'Codice;Oggetto;Stazione appaltante;Importo a base d\'asta;Scadenza;CIG;Categoria prevalente;Regione\n'
    + '1001;Restauro e miglioramento sismico della chiesa di San Pietro;Comune di Teramo;1.250.000,00;15/12/2026;B123456789;OG 2 classifica III;Abruzzo\n'
    + '1002;Manutenzione impianti termici edifici comunali;Comune di Chieti;180.000,00;20/12/2026;C987654321;OG11;Abruzzo\n'
    + ';;;;;;;\n';
  assert.equal((await upload(cookies.E, '/api/crm/radar/infordat/anteprima', csv)).status, 403); // solo ufficio gare o direzione
  const pre = await upload(cookies.D, '/api/crm/radar/infordat/anteprima', csv);
  assert.equal(pre.status, 200);
  assert.equal(pre.body.total, 2);
  assert.equal(pre.body.sample[0].amount, 1250000);
  assert.equal(pre.body.sample[0].deadline, '2026-12-15');
  assert.deepEqual(pre.body.sample[0].soa, ['OG2']);
  const up = await upload(cookies.D, '/api/crm/radar/infordat', csv);
  assert.deepEqual([up.body.added, up.body.skipped], [2, 0]);
  assert.equal((await upload(cookies.D, '/api/crm/radar/infordat', csv)).body.added, 0); // stesso export: niente doppioni
  assert.equal((await upload(cookies.D, '/api/crm/radar/infordat', 'a;b;c\n1;2;3\n')).status, 400); // senza la colonna dell'oggetto
  assert.equal((await E('GET', '/api/crm/radar/signals?view=gare')).status, 403);
  const q = (await D('GET', '/api/crm/radar/signals?view=gare')).body.signals;
  assert.equal(q.length, 2);
  const chiesa = q.find(x => x.cig === 'B123456789');
  assert.equal(chiesa.bu, 'restauro');
  assert.equal(chiesa.to_gare, true);
  assert.ok(!(await E('GET', '/api/crm/radar/signals?view=sotto')).body.signals.some(x => x.to_gare)); // le gare non vanno alle BU
  assert.equal((await D('POST', `/api/crm/radar/signals/${chiesa.id}/interessa`, {})).status, 409);
  assert.equal((await D('POST', `/api/crm/radar/signals/${chiesa.id}/gare`, { action: 'boss' })).status, 200);
  const other = q.find(x => x.cig === 'C987654321');
  assert.equal((await D('POST', `/api/crm/radar/signals/${other.id}/gare`, { action: 'scarta' })).status, 400);
  assert.equal((await D('POST', `/api/crm/radar/signals/${other.id}/gare`, { action: 'scarta', reason: 'Fuori dai nostri lavori' })).status, 200);
  assert.equal((await D('GET', '/api/crm/radar/signals?view=gare')).body.signals.length, 0);
  // chi è dell'ufficio gare lo decide la direzione nelle impostazioni
  const s = (await D('GET', '/api/crm/commerciale')).body.settings;
  assert.equal((await D('PUT', '/api/crm/commerciale/radar', { value: { ...s.radar, gare_users: [await meId(F)] } })).status, 200);
  assert.equal((await F('GET', '/api/crm/radar/signals?view=gare')).status, 200);
  assert.equal((await F('GET', '/api/crm')).body.gare, true);
  assert.equal((await E('GET', '/api/crm')).body.gare, false);
});

test('giro AI (OpenAI finto): notizie → segnali della BU, spesa per BU, quota finita → avviso alla direzione, «Aumenta»', async () => {
  assert.equal((await E('POST', '/api/crm/radar/run', {})).status, 403);
  const r = await D('POST', '/api/crm/radar/run', { bu: 'edilizia' });
  assert.equal(r.status, 200);
  assert.equal(r.body.runs[0].found, 1); // la notizia senza link non passa
  assert.equal(r.body.runs[0].added, 1);
  assert.ok(r.body.runs[0].cost > 0);
  assert.match(aiCalls[0].input, /Edilizia/);
  assert.match(aiCalls[0].input, /capannone/);
  assert.equal(aiCalls[0].tools[0].type, 'web_search_preview');
  const sig = (await E('GET', '/api/crm/radar/signals?all=1')).body.signals.concat((await E('GET', '/api/crm/radar/signals?view=sotto')).body.signals).find(x => x.url === 'https://example.com/ortona');
  assert.ok(sig);
  assert.equal(sig.source, 'stampa');
  assert.equal(sig.bu, 'edilizia');
  assert.equal((await D('POST', '/api/crm/radar/run', { bu: 'edilizia' })).body.runs[0].added, 0); // stessa notizia: niente doppioni
  // quota di Edilizia a 0 €: niente giro e avviso agli amministratori, una volta sola
  const s = (await D('GET', '/api/crm/commerciale')).body.settings;
  const radar = structuredClone(s.radar);
  radar.bu.edilizia = { on: true, quota_eur: 0 };
  assert.equal((await D('PUT', '/api/crm/commerciale/radar', { value: radar })).status, 200);
  const calls = aiCalls.length;
  assert.equal((await D('POST', '/api/crm/radar/run', { bu: 'edilizia' })).body.runs[0].skipped, 'budget finito');
  assert.equal(aiCalls.length, calls);
  await D('POST', '/api/crm/radar/run', { bu: 'edilizia' });
  const { rows } = await db.query("SELECT n.body, n.link FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = $1 AND n.kind = 'crm' AND n.body LIKE '%budget del radar%'", [ADMIN]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].link, '/crm/impostazioni/radar');
  const up = await D('POST', '/api/crm/radar/budget/edilizia', { eur: 10 });
  assert.equal(up.body.quota_eur, 10);
  const st = (await D('GET', '/api/crm/radar/status')).body;
  assert.equal(st.ai, true);
  assert.ok(st.runs.length >= 2);
  assert.ok(Number(st.spend.find(x => x.bu === 'edilizia').eur) > 0);
});
