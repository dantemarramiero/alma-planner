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
  assert.ok(s.da_completare?.length); // creata solo col nome: «!» da completare (mancano P.IVA e città, V8)
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

test('v2: G0 scelto alla creazione, date delle fasi, passi collegati, rischi con probabilità, ipotesi prima di un gate, radar per stato, sintesi salvata, idee', async () => {
  const recchia = await meId(E);
  const c = await D('POST', '/api/crm/business', { name: 'Teleriscaldamento', description: 'Reti di teleriscaldamento per comuni', owner_id: recchia, budget_eur: 10000, gate0_due: plus(20) });
  assert.equal(c.status, 201);
  const id = c.body.id;
  const i = (await E('GET', `/api/crm/business/${id}`)).body;
  assert.equal(i.gates[0].due_date, plus(20));
  // date delle fasi per il Gantt
  assert.equal((await E('PATCH', `/api/crm/business/${id}`, { phase_dates: { esplorazione: { from: plus(0), to: plus(30) }, analisi: { from: plus(31), to: plus(90) } } })).status, 200);
  assert.equal((await E('PATCH', `/api/crm/business/${id}`, { phase_dates: { piano: { from: plus(90), to: plus(10) } } })).status, 400);
  assert.equal((await E('GET', `/api/crm/business/${id}`)).body.phase_dates.analisi.to, plus(90));
  // passo collegato a un cliente target
  const t = await E('POST', `/api/crm/business/${id}/targets`, { name: 'Hera Servizi Energia', priority: 'alta' });
  const task = await E('POST', `/api/crm/business/${id}/tasks`, { title: 'Incontro Hera', due_date: plus(5), target_id: t.body.id });
  assert.equal(task.status, 201);
  assert.equal((await E('GET', `/api/crm/business/${id}/tasks`)).body.tasks[0].target_name, 'Hera Servizi Energia');
  // rischio con probabilità, ipotesi prima del gate G1
  const r = await E('POST', `/api/crm/business/${id}/riflessioni`, { kind: 'rischio', title: 'Margini bassi', level: 'alto', probability: 'probabile' });
  assert.equal(r.body.probability, 'probabile');
  assert.equal((await E('POST', `/api/crm/business/${id}/riflessioni`, { kind: 'rischio', title: 'x', probability: 'forse' })).status, 400);
  assert.equal((await E('POST', `/api/crm/business/${id}/riflessioni`, { kind: 'ipotesi', title: 'Bastano 2 squadre', before_gate: 1 })).body.before_gate, 1);
  assert.equal((await D('GET', `/api/crm/business/${id}/analisi`)).body.risks[0].probability, 'probabile');
  // radar: ultima ricerca e conteggi per stato
  const run = await E('POST', `/api/crm/business/${id}/radar/run`, {});
  assert.equal(run.status, 200, JSON.stringify(run.body));
  const rd = (await E('GET', `/api/crm/business/${id}/radar`)).body;
  assert.ok(rd.last.at);
  assert.equal(rd.counts.nuovo, 1);
  await E('POST', `/api/crm/business/signals/${rd.signals[0].id}/scarta`, {});
  assert.equal((await E('GET', `/api/crm/business/${id}/radar?status=scartato`)).body.signals.length, 1);
  // sintesi salvata e mostrata in cima all'analisi
  assert.equal((await D('POST', `/api/crm/business/${id}/sintesi`, {})).status, 201);
  const a = (await D('GET', `/api/crm/business/${id}/analisi`)).body;
  assert.ok(a.summary && a.summary_at);
  // spesa dell'AI del mese nell'elenco
  assert.ok((await D('GET', '/api/crm/business')).body.kpis.aiMonth > 0);
});

test('win ratio: forza del rapporto sui clienti target e gare vinte/perse in Analisi', async () => {
  const recchia = await meId(E);
  const asa = (await D('GET', '/api/crm')).body.asa[0].key;
  const c = await D('POST', '/api/crm/business', { name: 'Illuminazione pubblica', owner_id: recchia, asa, budget_eur: 1000 });
  const id = c.body.id;
  const s = await D('POST', '/api/crm/subjects', { name: 'Comune di Prova Win', roles: ['lead'], asa: [asa], owner_id: recchia });
  assert.equal((await E('POST', `/api/crm/business/${id}/targets`, { name: 'Comune di Prova Win' })).status, 201);
  const t = (await E('GET', `/api/crm/business/${id}/targets`)).body.targets[0];
  assert.equal(t.subject_id, s.body.id);
  assert.ok(t.relation && Array.isArray(t.relation.paths)); // calcolo comune di «Chi conosciamo»
  // esito con committente tra i clienti target: conta nell'iniziativa
  const o = await D('POST', '/api/crm/esiti', { result: 'vinta', title: 'Lotto 1 illuminazione', subject_id: s.body.id, amount: 200000, origin: 'business' });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  await D('POST', '/api/crm/esiti', { result: 'persa', title: 'Lotto 2 illuminazione', subject_id: s.body.id, amount: 100000, reason: 'Prezzo', origin: 'business' });
  const a = (await D('GET', `/api/crm/business/${id}/analisi`)).body;
  assert.equal(a.outcomes.won, 1);
  assert.equal(a.outcomes.lost, 1);
  assert.equal(a.outcomes.ratio, 50);
  assert.equal(a.outcomes.last.length, 2);
  // esito collegato all'iniziativa (anche con un committente fuori dai target): precompilato da /esiti/nuovo
  const pre = (await D('GET', `/api/crm/esiti/nuovo?initiative_id=${id}`)).body;
  assert.equal(pre.initiative_id, id);
  assert.equal((await D('POST', '/api/crm/esiti', { result: 'vinta', title: pre.title, initiative_id: id, origin: pre.origin })).status, 201);
  assert.equal((await D('GET', `/api/crm/business/${id}/analisi`)).body.outcomes.won, 2);
});

test('mappa del mercato: categorie SOA del profilo, chi vince, chi compra, dove, impresa, avvisami', async () => {
  const recchia = await meId(E);
  const asa = (await D('GET', '/api/crm')).body.asa[0].key;
  const id = (await D('POST', '/api/crm/business', { name: 'Reti MT mercato', description: 'Costruzione di cabine MT e reti di distribuzione elettrica', owner_id: recchia, asa })).body.id;
  // categorie dall'elenco ufficiale, con classifica; codice sconosciuto rifiutato
  assert.equal((await E('PUT', `/api/crm/business/${id}/soa`, { soa: ['OG10', 'OZ99'] })).status, 400);
  const soa = await E('PUT', `/api/crm/business/${id}/soa`, { soa: ['og10', 'OS30'], classes: { OG10: 'III' } });
  assert.equal(soa.status, 200, JSON.stringify(soa.body));
  assert.deepEqual(soa.body.missing, ['OG10', 'OS30']); // nessuna gara caricata ancora
  assert.ok((await E('POST', `/api/crm/business/${id}/soa/proponi`, {})).body.proposals.some(p => p.code === 'OG10'));
  // il profilo del radar non perde le classifiche
  await E('PUT', `/api/crm/business/${id}/profile`, { description: 'reti', soa: ['OG10', 'OS30'], regions: ['Abruzzo'] });
  // stato «le carico stanotte» e «Avvisami»
  let m = (await E('GET', `/api/crm/business/${id}/mercato`)).body;
  assert.deepEqual(m.state.missing, ['OG10', 'OS30']);
  assert.equal(m.classes.OG10, 'III');
  assert.equal((await E('POST', `/api/crm/business/${id}/mercato/avvisami`, {})).body.watching, true);
  // gare ANAC finte nelle categorie e zone dell'iniziativa
  const day = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const aw = [
    ['C1', 'Cabina MT lotto 1', 'Provincia di Chieti', 'Abruzzo', 'Chieti', 'OG10', 600000, 22, 5, [{ cf: '01111111111', name: 'ELETTRO ADRIATICA SRL', role: 'mandataria' }, { cf: '02222222222', name: 'SCAVI SANGRO SRL', role: 'mandante' }]],
    ['C2', 'Rete BT Ortona', 'Comune di Ortona', 'Abruzzo', 'Chieti', 'OG10', 300000, 25, 4, [{ cf: '01111111111', name: 'ELETTRO ADRIATICA SRL', role: '' }]],
    ['C3', 'Impianti scuola', 'Provincia di Pescara', 'Abruzzo', 'Pescara', 'OS30', 2500000, 18, 6, [{ cf: '03333333333', name: 'DI NARDO IMPIANTI SRL', role: '' }]],
    ['C4', 'Cabine Molise', 'Regione Molise', 'Molise', 'Campobasso', 'OG10', 900000, 20, 3, [{ cf: '04444444444', name: 'ALTRA SRL', role: '' }]],
  ];
  for (const [cig, object, sa, region, province, category, amount, discount, bidders, winners] of aw) {
    await db.query(`INSERT INTO crm_anac_awards (cig, object, sa_cf, sa_name, region, province, category, amount, discount, bidders, criterion, awarded_on, winners, month)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'prezzo', $11, $12, '202611')`, [cig, object, `SA${sa.length}${sa.slice(-6)}`, sa, region, province, category, amount, discount, bidders, day(30), JSON.stringify(winners)]);
  }
  // mesi caricati dal CRM con le nostre categorie (copertura = categoryCoverage della sessione CRM)
  for (let k = 0; k < 12; k++) {
    const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k);
    await db.query("INSERT INTO crm_anac_imports (month, awards, kept, cats) VALUES ($1, 0, 0, $2) ON CONFLICT (month) DO UPDATE SET cats = EXCLUDED.cats", [d.toISOString().slice(0, 7).replace('-', ''), ['OG10', 'OS30']]);
  }
  // Elettro Adriatica è già partner nel CRM
  assert.equal((await D('POST', '/api/crm/subjects', { name: 'Elettro Adriatica Srl', roles: ['partner'], asa: [asa], owner_id: recchia })).status, 201);
  m = (await E('GET', `/api/crm/business/${id}/mercato`)).body;
  assert.equal(m.state.missing.length, 0);
  assert.equal(m.kpi.gare, 3); // solo Abruzzo: Molise fuori dalle zone del profilo
  assert.equal(m.winners[0].name, 'ELETTRO ADRIATICA SRL');
  assert.equal(m.winners[0].vinte, 2);
  assert.equal(m.winners[0].role, 'partner');
  assert.deepEqual(m.winners[0].partners, ['SCAVI SANGRO SRL']);
  assert.equal(m.synergies.length, 1);
  assert.equal(m.where[0].region, 'Abruzzo');
  assert.equal(m.where[0].provinces.length, 2);
  // filtro per provincia e per categoria
  const ch = (await E('GET', `/api/crm/business/${id}/mercato?province=Chieti`)).body;
  assert.equal(ch.kpi.gare, 2);
  assert.equal(ch.where[0].provinces.length, 2); // «Dove» mostra sempre tutte le province
  assert.equal((await E('GET', `/api/crm/business/${id}/mercato?cats=OS30`)).body.kpi.gare, 1);
  // chi compra → cliente target
  const buyer = m.buyers.find(b => b.name === 'Provincia di Chieti');
  assert.equal(buyer.target, false);
  assert.equal((await E('POST', `/api/crm/business/${id}/mercato/stazione`, { name: buyer.name, gare: buyer.gare })).status, 201);
  assert.equal((await E('GET', `/api/crm/business/${id}/mercato`)).body.buyers.find(b => b.name === 'Provincia di Chieti').target, true);
  // cerca un'impresa e la sua scheda
  const found = (await E('GET', `/api/crm/business/${id}/mercato/imprese?q=nardo`)).body.companies;
  assert.equal(found[0].name, 'DI NARDO IMPIANTI SRL');
  const card = (await E('GET', `/api/crm/business/${id}/mercato/impresa?cf=${found[0].cf}`)).body;
  assert.equal(card.kpi.vinte, 1);
  assert.equal(card.tenders[0].cig, 'C3');
  assert.equal(card.role, '');
  assert.equal((await E('GET', `/api/crm/business/${id}/mercato/impresa?cf=09999999999`)).status, 404);
  // scheda comune (usata anche da Concorrenza): stesse gare con categorie date, oppure senza perimetro
  const shared = (await E('GET', `/api/crm/mercato/impresa?cf=${found[0].cf}&cats=${card.categorie.join(',')}`)).body;
  assert.equal(shared.kpi.vinte, 1);
  assert.equal((await E('GET', '/api/crm/mercato/impresa')).status, 400);
  // analisi e tab
  assert.equal((await E('GET', `/api/crm/business/${id}/analisi`)).body.market.kpi.gare, 3);
  assert.equal((await E('GET', `/api/crm/business/${id}`)).body.market_gare, 3);
});
