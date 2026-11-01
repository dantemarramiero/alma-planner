// Alma Energy: accesso solo ai membri, CRM (aziende con tipi, persone in più aziende), opportunità con lo storico
// degli stadi, collegamenti con un ruolo e simulatore.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, A, T, X, dante;
const ADMIN = 'admin@almacis.it';

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const as = cookie => (method, path, body) => api(cookie, method, path, body);

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  dante = await login('dante.marramiero@almacis.it');
  A = as(dante); // membro dalla migrazione
  T = as(await login('tullio@almacis.it'));
  X = as(await login(ADMIN)); // amministratore ma non della BU Energy
});

after(async () => {
  server?.close();
  await db?.close();
});

test('il modulo è solo dei membri: Dante entra, gli altri (anche gli amministratori) no finché non vengono aggiunti', async () => {
  assert.equal((await A('GET', '/api/energy')).status, 200);
  assert.equal((await A('GET', '/api/me')).body.energy, true);
  assert.equal((await T('GET', '/api/energy')).status, 403);
  assert.equal((await T('GET', '/api/me')).body.energy, false);
  assert.equal((await X('GET', '/api/energy/companies')).status, 403);
  assert.equal((await T('POST', '/api/energy/companies', { name: 'X' })).status, 403);

  assert.equal((await A('POST', '/api/energy/members', { email: 'Tullio@almacis.it' })).status, 201);
  assert.equal((await T('GET', '/api/energy')).status, 200);
  const { body } = await A('GET', '/api/energy');
  assert.deepEqual(body.members.map(m => m.email), ['dante.marramiero@almacis.it', 'tullio@almacis.it']);
  assert.ok(body.meta.stages.revamping.some(([k]) => k === 'due_diligence'));
  // non ci si toglie da soli
  assert.equal((await A('DELETE', '/api/energy/members/dante.marramiero@almacis.it')).status, 400);
});

let pilk, spv, studio;
test('aziende: tipi multipli, campi del tipo, filtro per tipo e doppioni di P.IVA', async () => {
  pilk = (await A('POST', '/api/energy/companies', {
    name: 'Pilkington Italia S.p.A.', vat: 'IT 01234567890', types: ['cliente'], city: 'San Salvo', province: 'Chieti', region: 'Abruzzo',
    extra: { consumi_mwh: '12.500', profilo_consumo: 'D1', mw_sviluppo: 5 }, source: 'Screening tetti',
  })).body;
  assert.equal(pilk.vat, '01234567890');
  assert.deepEqual(pilk.extra, { consumi_mwh: 12.5, profilo_consumo: 'D1' }); // mw_sviluppo non è un campo dei clienti
  assert.equal((await A('POST', '/api/energy/companies', { name: 'Doppione', vat: '01234567890' })).status, 409);
  assert.equal((await A('GET', '/api/energy/companies/check?vat=IT01234567890')).body.matches[0].id, pilk.id);

  const group = (await A('POST', '/api/energy/companies', { name: 'Enervita Group', types: ['proprietario', 'investitore'] })).body;
  spv = (await A('POST', '/api/energy/companies', { name: 'Enervitabio Santa Reparata', vat: '01130710955', types: ['proprietario'], group_id: group.id, extra: { convenzioni: 2 } })).body;
  studio = (await T('POST', '/api/energy/companies', { name: 'Studio Rossi Ingegneria', types: ['progettista', 'epc'], region: 'Abruzzo' })).body;
  assert.equal((await A('POST', '/api/energy/companies', { name: 'Tipo sbagliato', types: ['fornaio'] })).status, 400);

  const progettisti = (await A('GET', '/api/energy/companies?type=progettista')).body;
  assert.deepEqual(progettisti.companies.map(c => c.name), ['Studio Rossi Ingegneria']);
  assert.equal(progettisti.byType.proprietario, 2);
  assert.equal((await A('GET', '/api/energy/companies?q=reparata')).body.companies[0].group_name, 'Enervita Group');

  // togliendo un tipo spariscono i suoi campi
  const upd = (await A('PATCH', `/api/energy/companies/${group.id}`, { types: ['investitore'], extra: { ticket_min: '1000000', convenzioni: 4 } })).body;
  assert.deepEqual(upd.extra, { ticket_min: 1000000 });
  assert.equal((await A('PATCH', `/api/energy/companies/${group.id}`, { group_id: group.id })).status, 400);
  assert.equal((await A('GET', `/api/energy/companies/${group.id}`)).body.controlled[0].name, 'Enervitabio Santa Reparata');
});

let rossi;
test('persone: in più aziende con qualifiche diverse, opposizione al contatto', async () => {
  rossi = (await A('POST', '/api/energy/people', {
    first_name: 'Mario', last_name: 'Rossi', title: 'Ing.', influence: 'decisore', email: 'M.Rossi@studiorossi.it',
    companies: [{ company_id: studio.id, role: 'Titolare' }, { company_id: spv.id, role: 'Amministratore' }],
  })).body;
  assert.equal(rossi.email, 'm.rossi@studiorossi.it');
  const card = (await A('GET', `/api/energy/people/${rossi.id}`)).body;
  assert.deepEqual(card.companies.map(c => [c.name, c.role]), [['Enervitabio Santa Reparata', 'Amministratore'], ['Studio Rossi Ingegneria', 'Titolare']]);
  assert.equal((await A('GET', `/api/energy/companies/${studio.id}`)).body.people[0].role, 'Titolare');

  const bianchi = (await A('POST', '/api/energy/people', { last_name: 'Bianchi', opt_out: true, companies: [{ company_id: pilk.id, role: 'Energy manager' }] })).body;
  assert.equal((await A('GET', '/api/energy/people?type=cliente')).body.people[0].id, bianchi.id);
  assert.equal((await A('GET', '/api/energy/people?type=cliente&contactable=1')).body.people.length, 0);
  assert.equal((await A('GET', '/api/energy/people?q=mario rossi')).body.people[0].id, rossi.id);
  assert.equal((await A('POST', '/api/energy/people', { first_name: 'Senza cognome' })).status, 400);
});

test('opportunità: stadio iniziale del tipo, storico, «perso» con motivo, collegamenti con un ruolo dai due lati', async () => {
  const opp = (await A('POST', '/api/energy/opportunities', { kind: 'ppa_onsite', title: 'Pilkington San Salvo', company_id: pilk.id, mw: 21.1, priority: 'A' })).body;
  assert.equal(opp.stage, 'da_qualificare');
  assert.equal((await A('POST', '/api/energy/opportunities', { kind: 'ppa_onsite', title: 'X', stage: 'due_diligence' })).status, 400);
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/stage`, { stage: 'target' })).status, 400);
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/stage`, { stage: 'primo_contatto', note: 'chiamato l\'energy manager' })).status, 200);
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/stage`, { stage: 'perso' })).status, 400); // manca il motivo

  // collegamenti: l'azienda principale è già collegata come cliente
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/links`, { person_id: rossi.id, role: 'progettista' })).status, 201);
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/links`, { person_id: rossi.id, role: 'progettista' })).status, 409);
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/links`, { person_id: rossi.id, company_id: pilk.id, role: 'altro' })).status, 400);
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/links`, { company_id: studio.id, role: 'boh' })).status, 400);
  const card = (await A('GET', `/api/energy/opportunities/${opp.id}`)).body;
  assert.deepEqual(card.links.map(l => [l.company_name || l.last_name, l.role]), [['Pilkington Italia S.p.A.', 'cliente'], ['Rossi', 'progettista']]);
  assert.deepEqual(card.history.map(h => h.to_stage), ['primo_contatto', 'da_qualificare']);
  assert.equal((await A('GET', `/api/energy/people/${rossi.id}`)).body.opportunities[0].title, 'Pilkington San Salvo');
  const pc = (await A('GET', `/api/energy/companies/${pilk.id}`)).body;
  assert.deepEqual(pc.opportunities?.[0]?.roles, ['cliente'], JSON.stringify(pc));

  const rev = (await T('POST', '/api/energy/opportunities', { kind: 'revamping', title: 'Enervitabio (2 convenzioni)', company_id: spv.id, priority: 'A' })).body;
  assert.equal(rev.stage, 'da_analizzare');
  assert.equal((await T('POST', `/api/energy/opportunities/${rev.id}/stage`, { stage: 'perso', lost_reason: 'Non vende' })).body.lost_reason, 'Non vende');
  assert.equal((await A('GET', '/api/energy/opportunities?kind=revamping&stage=perso')).body.opportunities.length, 1);
  const byCompany = (await A('GET', `/api/energy/opportunities?company=${spv.id}`)).body;
  assert.equal(byCompany.opportunities?.[0]?.id, rev.id, JSON.stringify(byCompany));

  // cancellando un'azienda i collegamenti spariscono, l'opportunità resta
  await A('DELETE', `/api/energy/companies/${studio.id}`);
  assert.equal((await A('GET', `/api/energy/people/${rossi.id}`)).body.companies.length, 1);
});

test('simulatore: calcolo con le ipotesi del Modello fotovoltaico e input non validi', async () => {
  const r = (await A('POST', '/api/energy/simulate', { model: 'cashflows', input: { sizeMw: 3.25, capex: { acquisto: 1375000, revamping: 975000 } }, sensitivity: true })).body;
  assert.ok(Math.abs(r.kpi.irrUnlevered - 0.12956) < 1e-4);
  assert.equal(r.rows.length, 31);
  assert.equal(r.sensitivity.prezzo.length, 5);
  assert.ok(Math.abs((await A('POST', '/api/energy/simulate', { model: 'brs', input: {} })).body.kpi.roe - 0.8052) < 1e-4);
  assert.equal((await A('POST', '/api/energy/simulate', { model: 'cashflows', input: { capex: {} } })).status, 400);
  assert.equal((await A('POST', '/api/energy/simulate', { model: 'cashflows', input: { sizeMw: 'tanti' } })).status, 400);
  assert.equal((await X('POST', '/api/energy/simulate', { model: 'brs', input: {} })).status, 403);
});

test('scenari salvati: calcolo, salvataggio sull\'opportunità, scelto che porta i numeri, export Excel', async () => {
  const { readXlsx } = require('../lib/xlsx');
  const calc = (await A('POST', '/api/energy/scenarios/calcola', { model: 'ppa_onsite', input: { roofArea: 20000, kwhPerKwp: 1300 } })).body;
  assert.equal(calc.plant.kwp, 2400);
  assert.equal((await A('POST', '/api/energy/scenarios/calcola', { model: 'boh', input: {} })).status, 400);
  assert.equal((await A('POST', '/api/energy/scenarios/calcola', { model: 'ppa_onsite', input: { 'x;drop': 1 } })).status, 400);

  const opp = (await A('POST', '/api/energy/opportunities', { kind: 'ppa_onsite', title: 'Tetto per scenari' })).body;
  const s1 = (await A('POST', '/api/energy/scenarios', { opportunity_id: opp.id, name: 'PPA 100 €/MWh', model: 'ppa_onsite', input: { roofArea: 20000 } })).body;
  const s2 = (await A('POST', '/api/energy/scenarios', { opportunity_id: opp.id, name: 'PPA 110 €/MWh', model: 'ppa_onsite', input: { roofArea: 20000, ppaPrice: 110 } })).body;
  assert.equal(s1.summary.mw, 2.4);
  assert.ok(s2.summary.irr > s1.summary.irr);
  const draft = (await A('POST', '/api/energy/scenarios', { name: 'Bozza revamping', model: 'revamping', input: {} })).body;
  assert.equal((await A('GET', '/api/energy/scenarios?opportunity=bozze')).body[0].id, draft.id);
  assert.equal((await A('POST', `/api/energy/scenarios/${draft.id}/scegli`)).status, 400); // una bozza non si sceglie

  assert.equal((await A('POST', `/api/energy/scenarios/${s2.id}/scegli`)).status, 200);
  assert.equal((await A('POST', `/api/energy/scenarios/${s1.id}/scegli`)).status, 200); // uno solo scelto per opportunità
  const list = (await A('GET', `/api/energy/scenarios?opportunity=${opp.id}`)).body;
  assert.deepEqual(list.map(s => [s.id, s.chosen]), [[s1.id, true], [s2.id, false]]);
  let card = (await A('GET', `/api/energy/opportunities/${opp.id}`)).body;
  assert.equal(Number(card.mw), 2.4);
  assert.equal(card.data.scenario.id, s1.id);
  // modificare lo scenario scelto aggiorna l'opportunità
  await A('PATCH', `/api/energy/scenarios/${s1.id}`, { input: { roofArea: 30000 } });
  card = (await A('GET', `/api/energy/opportunities/${opp.id}`)).body;
  assert.equal(Number(card.mw), 3.6);
  assert.equal((await A('GET', `/api/energy/scenarios/${s1.id}`)).body.result.plant.kwp, 3600);

  // export: tre fogli leggibili
  const res = await fetch(`${base}/api/energy/scenarios/${s1.id}/excel`, { headers: { cookie: dante } });
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  const book = readXlsx(Buffer.from(await res.arrayBuffer()));
  assert.deepEqual(Object.keys(book), ['Riepilogo', 'Ipotesi', 'Flussi']);
  assert.equal(book.Flussi.length, 22); // intestazione + anno 0 + 20 anni
  const fv = await fetch(`${base}/api/energy/scenarios/excel`, { method: 'POST', headers: { cookie: dante, 'X-Alma': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'fv_classico', name: 'Greenfield', input: {} }) });
  assert.deepEqual(Object.keys(readXlsx(Buffer.from(await fv.arrayBuffer()))), ['Riepilogo', 'Ipotesi', 'Variante A', 'Variante B', 'Variante C']);

  // PPA: la proposta chiede uno scenario salvato (qui c'è) e la persona di riferimento
  const p = (await A('POST', '/api/energy/people', { last_name: 'Neri' })).body;
  await A('POST', `/api/energy/opportunities/${opp.id}/links`, { person_id: p.id, role: 'referente' });
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/stage`, { stage: 'proposta' })).status, 200);
  const bare = (await A('POST', '/api/energy/opportunities', { kind: 'ppa_onsite', title: 'Senza scenario' })).body;
  await A('POST', `/api/energy/opportunities/${bare.id}/links`, { person_id: p.id, role: 'referente' });
  const noScen = await A('POST', `/api/energy/opportunities/${bare.id}/stage`, { stage: 'proposta' });
  assert.equal(noScen.status, 400);
  assert.match(noScen.body.error, /scenario/);

  // cancellando lo scenario scelto l'opportunità perde il riferimento
  await A('DELETE', `/api/energy/scenarios/${s1.id}`);
  assert.equal((await A('GET', `/api/energy/opportunities/${opp.id}`)).body.data.scenario, undefined);
  assert.equal((await X('GET', '/api/energy/scenarios')).status, 403);
});

test('Impianti target: progetto riservato alla BU Energy, iter a step con checklist, Gantt ed esito', async () => {
  const opp = (await A('POST', '/api/energy/opportunities', { kind: 'revamping', title: 'Impianto da acquisire', mw: 3 })).body;
  // FV classico: solo da RTB
  const fv = (await A('POST', '/api/energy/opportunities', { kind: 'fv_classico', title: 'Greenfield non pronto' })).body;
  assert.equal((await A('POST', `/api/energy/opportunities/${fv.id}/target`)).status, 400);

  const r = await A('POST', `/api/energy/opportunities/${opp.id}/target`);
  assert.equal(r.status, 201);
  const pid = r.body.project_id;
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/target`)).status, 400); // già target
  const card = (await A('GET', `/api/energy/opportunities/${opp.id}`)).body;
  assert.deepEqual([card.stage, card.project_id, card.target_step], ['target', pid, 'contatto_venditore']);

  // il progetto: Dante (responsabile) e Tullio (membro del modulo) lo vedono, un amministratore fuori dalla BU Energy no
  assert.equal((await A('GET', `/api/projects/${pid}`)).status, 200);
  assert.equal((await T('GET', `/api/projects/${pid}`)).status, 200);
  assert.equal((await X('GET', `/api/projects/${pid}`)).status, 404);
  assert.ok(!(await X('GET', '/api/projects')).body.some(p => p.id === pid));
  const tickets = (await A('GET', `/api/tickets?project_id=${pid}`)).body;
  const list = Array.isArray(tickets) ? tickets : tickets.tickets;
  assert.deepEqual(list.map(t => t.title).sort(), ['Step 1 · Contatto del venditore', 'Step 2 · Due diligence tecnica e legale', 'Step 3 · Approvazione dell\'investimento', 'Step 4 · Offerta']);
  const step1 = list.find(t => t.title.startsWith('Step 1'));
  assert.equal(step1.status, 'doing');
  assert.equal((await X('GET', `/api/tickets/${step1.id}`)).status, 404);
  const adminList = (await X('GET', '/api/tickets')).body;
  assert.ok(!(Array.isArray(adminList) ? adminList : adminList.tickets).some(t => t.project_id === pid)); // nemmeno nell'elenco dei ticket
  assert.ok(!(await X('GET', '/api/search?q=Impianto')).body.projects?.some(p => p.id === pid)); // né nella ricerca
  assert.equal((await A('GET', `/api/energy/projects/${pid}/target`)).body.id, opp.id);

  // avanti solo con la checklist completa, o forzando con un motivo
  const blocked = await A('POST', `/api/energy/opportunities/${opp.id}/target/step`, { step: 'due_diligence' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /Checklist incompleta/);
  for (const item of ['primo_contatto', 'interesse', 'nda', 'data_room']) {
    await A('PATCH', `/api/energy/opportunities/${opp.id}/target/checklist`, { step: 'contatto_venditore', item, done: true });
  }
  assert.equal((await A('PATCH', `/api/energy/opportunities/${opp.id}/target/checklist`, { step: 'contatto_venditore', item: 'boh', done: true })).status, 400);
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/target/step`, { step: 'due_diligence' })).status, 200);
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/target/step`, { step: 'approvazione', reason: 'DD fatta dal consulente esterno' })).status, 200);
  const detail = (await A('GET', `/api/energy/opportunities/${opp.id}/target`)).body;
  assert.deepEqual(detail.steps.map(s => s.state), ['fatto', 'fatto', 'attuale', 'dopo']);
  assert.equal(detail.steps[1].checklist.length, 11); // revamping: c'è anche la voce sugli incassi GSE
  assert.equal(detail.history[0].note, 'Forzato: DD fatta dal consulente esterno');
  const after = (await A('GET', `/api/tickets?project_id=${pid}`)).body;
  const statuses = Object.fromEntries((Array.isArray(after) ? after : after.tickets).map(t => [t.title.slice(0, 6), t.status]));
  assert.deepEqual([statuses['Step 1'], statuses['Step 2'], statuses['Step 3'], statuses['Step 4']], ['done', 'done', 'doing', 'todo']);

  // kanban dei target
  const board = (await A('GET', '/api/energy/targets')).body;
  assert.equal(board.columns.find(c => c.key === 'approvazione').cards[0].id, opp.id);

  // esito: perso chiede il motivo; acquisito chiude il progetto
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/target/esito`, { outcome: 'perso' })).status, 400);
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/target/esito`, { outcome: 'acquisito' })).body.target_outcome, 'acquisito');
  assert.equal((await A('GET', `/api/projects/${pid}`)).body.status, 'done');
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/target/step`, { step: 'offerta' })).status, 400); // iter chiuso
  assert.equal((await A('GET', '/api/energy/targets')).body.columns.find(c => c.key === 'acquisito').count, 1);
  // riaperto: progetto di nuovo attivo
  await A('POST', `/api/energy/opportunities/${opp.id}/target/esito`, { outcome: null });
  assert.equal((await A('GET', `/api/projects/${pid}`)).body.status, 'active');
});

test('cruscotto: MW e capex per tipo e fase, valore pesato, IRR medio, ferme, step in scadenza, export', async () => {
  const { readXlsx } = require('../lib/xlsx');
  const a = (await A('POST', '/api/energy/opportunities', { kind: 'ppa_onsite', title: 'Cruscotto PPA', mw: 2, capex: 1000000 })).body;
  const b = (await A('POST', '/api/energy/opportunities', { kind: 'ppa_onsite', title: 'Cruscotto PPA 2', mw: 1, capex: 500000, probability: 80 })).body;
  await A('POST', `/api/energy/opportunities/${a.id}/stage`, { stage: 'primo_contatto' });
  // ferma: cambio di stadio di 40 giorni fa
  await db.query("UPDATE energy_opportunities SET stage_changed_at = now() - interval '40 days' WHERE id = $1", [a.id]);
  const s = (await A('POST', '/api/energy/scenarios', { opportunity_id: a.id, name: 'Base', model: 'ppa_onsite', input: { roofArea: 20000 } })).body;
  await A('POST', `/api/energy/scenarios/${s.id}/scegli`);

  const d = (await A('GET', '/api/energy/cruscotto?days=30')).body;
  const ppa = d.kinds.ppa_onsite;
  assert.ok(ppa.phases.primo_contatto.count >= 1);
  // pesato: a ha 2,4 MW (dallo scenario scelto) al 10% del primo contatto; b 1 MW all'80% scritto sull'opportunità
  assert.ok(Math.abs(ppa.phases.primo_contatto.mwWeighted - ppa.phases.primo_contatto.mw * 0.1) < 1e-9);
  assert.ok(ppa.phases.da_qualificare.mwWeighted >= 0.8 - 1e-9);
  assert.ok(ppa.mwWeighted < ppa.mw);
  assert.ok(d.irr.count >= 1 && d.irr.avg > 0);
  assert.ok(d.stale.list.some(o => o.id === a.id));
  assert.ok(!(await A('GET', '/api/energy/cruscotto?days=60')).body.stale.list.some(o => o.id === a.id));
  assert.ok(d.recent.length > 0);
  assert.ok(Array.isArray(d.dueSteps)); // gli step dei target del test precedente scadono fra settimane
  assert.ok(d.targets.active + d.targets.acquired >= 1);

  const res = await fetch(`${base}/api/energy/cruscotto/excel`, { headers: { cookie: dante } });
  const book = readXlsx(Buffer.from(await res.arrayBuffer()));
  assert.deepEqual(Object.keys(book), ['Riepilogo', 'Pipeline', 'Impianti target']);
  assert.ok(book.Pipeline.some(r => r[1] === 'Cruscotto PPA 2' && r[7] === 80));
  assert.equal((await X('GET', '/api/energy/cruscotto')).status, 403);
});
