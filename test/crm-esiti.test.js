// Win ratio (16/11): esiti e numeri, concorrente nuovo dal vincitore, probabilità di vittoria, chi conosciamo,
// primo passo pronto e «Interessa e approva».
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { probability, stats } = require('../lib/crm-esiti');
const { addWorkdays } = require('../lib/crm-primo-passo');

let server, base, db, D, E;
const ADMIN = 'direzione@almacis.it';
const drafts = [];
async function fakeOpenAI(url, opts) {
  const body = JSON.parse(opts.body);
  drafts.push(body);
  return { ok: true, json: async () => ({ output_text: '{"subject": "Due parole sul capannone", "body": "Buongiorno ing. Rossi,\\nci sentiamo?\\n\\nEdile"}', usage: { input_tokens: 800, output_tokens: 150 } }) };
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
const meId = async who => { const b = (await who('GET', '/api/me')).body; return b.id ?? b.user?.id; };
let eId, subjectId, contactId;

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db, crmFetchEvents: async () => [], radarFetch: fakeOpenAI });
  server = out.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  D = as(await login(ADMIN));
  E = as(await login('edile@almacis.it'));
  eId = await meId(E);
  const s = (await D('GET', '/api/crm/commerciale')).body.settings;
  assert.equal((await D('PUT', '/api/crm/commerciale/profiles', { value: { edilizia: { ...s.profiles.edilizia, manager_id: eId, keywords: ['capannone'] } } })).status, 200);
  const subj = await E('POST', '/api/crm/subjects', { name: 'Comune di Ortona', kind: 'ente_pubblico', roles: ['lead'], asa: ['edilizia'] });
  assert.equal(subj.status, 201);
  subjectId = subj.body.id;
  const ct = await db.query(`INSERT INTO crm_contacts (title, first_name, last_name, email) VALUES ('ing.', 'Mario', 'Rossi', 'm.rossi@comune.ortona.it') RETURNING id`);
  contactId = ct.rows[0].id;
  await db.query(`INSERT INTO crm_contact_links (contact_id, subject_id, job) VALUES ($1, $2, 'RUP')`, [contactId, subjectId]);
  // tre incontri con l'ing. Rossi a cui c'era edile@
  for (let i = 1; i <= 3; i++) {
    const m = await db.query(`INSERT INTO crm_meetings (ical_uid, start_at, subject, organizer_address, attendees) VALUES ($1, now() - ($2 || ' days')::interval, 'Incontro', 'edile@almacis.it', '[]') RETURNING id`, [`uid-${i}`, String(i * 10)]);
    await db.query('INSERT INTO crm_meeting_links (meeting_id, contact_id) VALUES ($1, $2)', [m.rows[0].id, contactId]);
  }
});
after(async () => { server?.close(); await db?.close(); });

test('probabilità: in apprendimento sotto il minimo, poi spiegata voce per voce', () => {
  const few = [{ bu: 'edilizia', result: 'vinta' }, { bu: 'edilizia', result: 'persa' }];
  assert.deepEqual(probability(few, { bu: 'edilizia' }, { prob_min: 15 }), { learning: true, have: 2, need: 15 });
  const many = [];
  for (let i = 0; i < 20; i++) many.push({ bu: 'edilizia', result: i < 5 ? 'vinta' : 'persa', warm: i < 6, origin: 'gare' });
  const p = probability(many, { bu: 'edilizia', warm: true, origin: 'gare' }, { prob_min: 15 });
  assert.equal(p.learning, false);
  assert.ok(p.p > p.base); // con il contatto caldo vinciamo di più
  assert.equal(p.steps[0].note, '5 su 20');
  const s = stats(many);
  assert.equal(s.ratio, 25);
  assert.equal(s.by.warm.find(x => x.key === 'caldo').ratio, 83);
});

test('giorni lavorativi: dal venerdì due giorni portano a martedì', () => {
  assert.equal(addWorkdays('2026-11-13', 2), '2026-11-17');
  assert.equal(addWorkdays('2026-11-14', 0), '2026-11-16');
});

test('chi conosciamo: forza dagli incontri, chi di noi, punteggio «Rapporto» del radar', async () => {
  const r = await E('GET', `/api/crm/subjects/${subjectId}/relazioni`);
  assert.equal(r.status, 200);
  assert.equal(r.body.level, 'forte'); // 3 incontri × 3 punti = 9 ≥ 8
  assert.equal(r.body.paths[0].contact, 'ing. Mario Rossi');
  assert.equal(r.body.paths[0].us.id, eId);
  const page = await E('GET', '/api/crm/relazioni');
  assert.equal(page.status, 200);
  assert.ok(page.body.list.some(x => x.subject_id === subjectId));
  // un segnale sull'ente: rapporto forte = tutti i punti del «Rapporto»
  const g = await E('POST', '/api/crm/radar/signals', { title: 'Comune di Ortona: nuovo capannone per i mezzi comunali', entity: 'Comune di Ortona', kind: 'opera_finanziata', amount: 2000000, url: 'https://example.com/ortona' });
  assert.equal(g.status, 201);
  assert.equal(g.body.subject_id, subjectId);
  assert.equal(g.body.score_parts.relationship, 15);
  assert.ok((await E('GET', '/api/crm/relazioni')).body.warm.some(x => x.id === g.body.id));
});

test('primo passo pronto: Rossi, chiamato da chi lo conosce, email dell\'AI; Interessa e approva → piano accettato', async () => {
  const { body: list } = await E('GET', '/api/crm/radar/signals?view=tutti');
  const g = list.signals.find(x => x.subject_id === subjectId);
  const pp = await E('GET', `/api/crm/radar/signals/${g.id}/primo-passo`);
  assert.equal(pp.status, 200);
  assert.equal(pp.body.move.contact, 'ing. Mario Rossi');
  assert.equal(pp.body.move.contact_email, 'm.rossi@comune.ortona.it');
  assert.equal(pp.body.move.owner_id, eId);
  assert.equal(pp.body.move.channel, 'telefonata'); // rapporto forte: si telefona
  assert.equal(pp.body.move.ai, true);
  assert.equal(pp.body.move.subject, 'Due parole sul capannone');
  assert.equal(pp.body.probability.learning, true);
  const n = drafts.length;
  assert.equal((await E('GET', `/api/crm/radar/signals/${g.id}/primo-passo`)).body.move.subject, 'Due parole sul capannone'); // salvato: niente seconda chiamata
  assert.equal(drafts.length, n);
  // senza AI: modello fisso
  const set = (await D('GET', '/api/crm/commerciale')).body.settings;
  assert.equal((await D('PUT', '/api/crm/commerciale/primo_passo', { value: { ...set.primo_passo, ai: false, tone: 'formale' } })).status, 200);
  const tpl = await E('GET', `/api/crm/radar/signals/${g.id}/primo-passo?fresh=1`);
  assert.equal(tpl.body.move.ai, false);
  assert.match(tpl.body.move.body, /^Gentile ing\. Mario Rossi,/);
  // Interessa e approva, con l'email ritoccata
  const i = await E('POST', `/api/crm/radar/signals/${g.id}/interessa`, { approve: true, first_move: { ...tpl.body.move, body: 'Testo mio' } });
  assert.equal(i.status, 200);
  assert.equal(i.body.plan.status, 'accettato');
  const { rows: steps } = await db.query('SELECT title, contact_id, owner_id, channel, draft FROM crm_steps WHERE plan_id = $1 ORDER BY sort', [i.body.plan.id]);
  assert.equal(steps[0].title, 'Chiama ing. Mario Rossi (RUP)');
  assert.equal(steps[0].contact_id, contactId);
  assert.equal(steps[0].channel, 'telefonata');
  assert.match(steps[0].draft, /Testo mio/);
});

test('esiti: registra, numeri, vincitore che diventa concorrente, da registrare', async () => {
  const pre = await E('GET', `/api/crm/esiti/nuovo?subject_id=${subjectId}`);
  assert.equal(pre.status, 200);
  assert.equal(pre.body.warm, true);
  assert.equal(pre.body.bu, 'edilizia');
  const won = await E('POST', '/api/crm/esiti', { result: 'vinta', title: 'Scuola media di Ortona', bu: 'edilizia', subject_id: subjectId, amount: '1.200.000', our_discount: '18,5', origin: 'gare' });
  assert.equal(won.status, 201);
  assert.equal(won.body.warm, true);
  assert.equal(won.body.entity_kind, 'ente_pubblico');
  assert.equal(Number(won.body.amount), 1200000);
  assert.equal(Number(won.body.our_discount), 18.5);
  const lost = await E('POST', '/api/crm/esiti', { result: 'persa', title: 'Palestra comunale', bu: 'edilizia', reason: 'Prezzo', winner_name: 'Edil Concorrenza Srl', winner_discount: 27, origin: 'gare' });
  assert.equal(lost.status, 201);
  assert.equal(lost.body.warm, false);
  const { rows: [w] } = await db.query('SELECT roles FROM crm_subjects WHERE id = $1', [lost.body.winner_subject_id]);
  assert.deepEqual(w.roles, ['concorrente']);
  const page = await E('GET', '/api/crm/esiti');
  assert.equal(page.status, 200);
  assert.equal(page.body.stats.ratio, 50);
  assert.equal(page.body.stats.winners[0].name, 'Edil Concorrenza Srl');
  assert.equal(page.body.stats.by.warm.find(x => x.key === 'caldo').ratio, 100);
  // non si cancella l'esito di un altro
  assert.equal((await as(await login('altro@almacis.it'))('DELETE', `/api/crm/esiti/${won.body.id}`)).status, 403);
  assert.equal((await E('PUT', `/api/crm/esiti/${lost.body.id}`, { bidders: 9 })).body.bidders, 9);
  // piano chiuso come opportunità senza esito → da registrare
  const { rows: [plan] } = await db.query(`SELECT id FROM crm_plans WHERE subject_id = $1 LIMIT 1`, [subjectId]);
  await db.query(`UPDATE crm_plans SET status = 'chiuso', outcome = 'opportunita', closed_at = now() WHERE id = $1`, [plan.id]);
  const todo = await E('GET', '/api/crm/esiti/da-registrare?mine=1');
  assert.ok(todo.body.items.some(x => x.plan_id === plan.id));
  const fromPlan = await E('GET', `/api/crm/esiti/nuovo?plan_id=${plan.id}`);
  assert.ok(fromPlan.body.signal_id);
  assert.equal(fromPlan.body.origin, 'relazione'); // segnalato a mano
  const reg = await E('POST', '/api/crm/esiti', { ...fromPlan.body, result: 'non_partecipato', reason: 'Requisiti tecnici o SOA' });
  assert.equal(reg.status, 201);
  assert.ok(!(await E('GET', '/api/crm/esiti/da-registrare?mine=1')).body.items.some(x => x.plan_id === plan.id));
  assert.equal((await E('POST', '/api/crm/esiti', { ...fromPlan.body, result: 'vinta' })).status, 409); // un esito per gara
});

test('esito da un\'iniziativa di Nuovi business: precompilato e collegato', async () => {
  const ini = await db.query(`INSERT INTO crm_initiatives (name, asa) VALUES ('Data center in Abruzzo', 'edilizia') RETURNING id`);
  const pre = (await E('GET', `/api/crm/esiti/nuovo?initiative_id=${ini.rows[0].id}`)).body;
  assert.equal(pre.initiative_id, ini.rows[0].id);
  assert.equal(pre.origin, 'business');
  assert.equal(pre.bu, 'edilizia');
  assert.equal(pre.title, 'Data center in Abruzzo');
  const r = await E('POST', '/api/crm/esiti', { result: 'vinta', title: pre.title, bu: pre.bu, origin: pre.origin, initiative_id: pre.initiative_id });
  assert.equal(r.status, 201);
  const row = (await db.query('SELECT initiative_id FROM crm_outcomes WHERE id = $1', [r.body.id])).rows[0];
  assert.equal(row.initiative_id, ini.rows[0].id);
  assert.equal((await E('GET', '/api/crm/esiti/nuovo?initiative_id=999999')).status, 404);
});
