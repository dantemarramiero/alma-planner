// Posta e progetto commerciale da una email (ALM2-55): casella finta con la conversazione del data center del canvas.
// Posta → proposta di Alma (regole, senza chiave) → opportunità → sala di lancio (trattativa privata, colleghi in copia)
// → progetto con le email → risposte nuove che entrano da sole → stato della trattativa, impegni, committente, persone.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { createPostaFake } = require('../lib/crm-posta-fake');
const P = require('../lib/crm-posta');

let server, base, db, D, fake;
const ADMIN = 'direzione@almacis.it';

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

before(async () => {
  db = await createDb({});
  fake = createPostaFake();
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db, postaFake: fake, crmFetchEvents: async () => [] });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await login('marco.bianchi@almacis.it'); // il collega in copia esiste in Alma Space
  D = (method, path, body) => api(null, method, path, body);
  const cookie = await login(ADMIN);
  D = (method, path, body) => api(cookie, method, path, body);
});
after(async () => { server?.close(); await db?.close(); });

test('regole senza AI: importo, scadenza, temi e committente', () => {
  assert.deepEqual(P.amountOf('il computo preliminare (circa 18 milioni)'), { value: 18000000, text: '18 milioni' });
  assert.equal(P.deadlineOf('chiudere le offerte entro fine gennaio', '2026-11-22'), '2027-01-31');
  assert.equal(P.deadlineOf('entro il 15/12', '2026-11-22'), '2026-12-15');
  assert.ok(P.themesOf('Data center Chieti Scalo, impianti', '').includes('chieti'));
  const st = P.heuristicDeal({ emails: [{ from_address: 's@x.it', from_name: 'Sara', sent_at: '2026-11-22T10:00:00Z', subject: 'Re', body_text: 'Confermo il sopralluogo giovedì 27 alle 10. Il committente è Adriatica Data srl.' }], internal: () => false });
  assert.equal(st.commitments[0].who, 'fissato');
  assert.match(st.client, /^Adriatica Data srl/);
  assert.equal(st.next_move.kind, 'incontro');
});

let msgId, prop, signalId, projectId;
test('Posta: elenco della casella e lettura di una email', async () => {
  const r = await D('GET', '/api/crm/posta');
  assert.equal(r.status, 200);
  const m = r.body.messages.find(x => x.subject === 'Re: Data center Chieti Scalo, impianti');
  assert.ok(m, 'la email del data center è in arrivo');
  assert.equal(m.project, undefined);
  msgId = m.id;
  const one = await D('GET', `/api/crm/posta/${msgId}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.conversation_count, 2);
  assert.deepEqual(one.body.attachments.map(a => a.name), ['Computo_preliminare_DC.pdf']);
  assert.match(one.body.body, /4 MW IT/);
});

test('Proposta: concetto, persone, azienda nuova, email in più', async () => {
  const r = await D('POST', '/api/crm/posta/proposta', { message_id: msgId });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  prop = r.body;
  assert.equal(prop.fields.title, 'Data center Chieti Scalo, impianti');
  assert.equal(prop.fields.importo, 18000000);
  assert.match(prop.fields.scadenza, /-01-31$/);
  assert.equal(prop.fields.tipo, 'trattativa');
  assert.match(prop.fields.prossimo_passo, /sopralluogo/i);
  const rossi = prop.people.find(p => p.email === 'l.rossi@studiotecnicorossi.it');
  assert.equal(rossi.kind, 'nuova');
  assert.equal(rossi.role, 'ha scritto');
  assert.equal(rossi.last_name, 'Rossi');
  assert.equal(rossi.job, 'Direttore tecnico');
  assert.equal(prop.people.find(p => p.email === 's.marini@studiotecnicorossi.it').role, 'in copia');
  assert.equal(prop.people.find(p => p.email === 'marco.bianchi@almacis.it').kind, 'collega');
  assert.ok(!prop.people.some(p => p.email === ADMIN), 'io non sono tra le persone');
  assert.equal(prop.company.kind, 'nuova');
  assert.match(prop.company.name, /Studio Tecnico Rossi/);
  assert.deepEqual(prop.attachments, ['Computo_preliminare_DC.pdf']);
  assert.ok(prop.extra.some(e => e.subject === 'Preventivo raffrescamento'), 'un\'altra email di Rossi parla del data center');
});

test('Crea: opportunità nel Radar con azienda, contatti e conversazione', async () => {
  const people = prop.people.map(p => ({ ...p, on: true }));
  const r = await D('POST', '/api/crm/posta/crea', { conversation_id: prop.conversation_id, message_id: prop.message_id, fields: prop.fields, company: { new: { name: 'Studio Tecnico Rossi s.r.l.', domain: 'studiotecnicorossi.it' } }, people, extra_ids: prop.extra.map(e => e.id) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  signalId = r.body.signal_id;
  assert.equal(r.body.contacts, 2);
  const again = await D('POST', '/api/crm/posta/crea', { conversation_id: prop.conversation_id, fields: prop.fields, people: [] });
  assert.equal(again.status, 409);
  const list = await D('GET', '/api/crm/posta');
  assert.equal(list.body.messages.find(x => x.id === msgId).signal.id, signalId);
  const p2 = await D('POST', '/api/crm/posta/proposta', { message_id: msgId });
  assert.deepEqual(p2.body.already, { signal_id: signalId });
});

test('Sala di lancio: trattativa privata, collega in copia in squadra, date dalla email', async () => {
  const r = await D('GET', `/api/crm/lancio/proposta?signal=${signalId}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.kind, 'trattativa');
  assert.deepEqual(r.body.steps, ['Seguo', 'Primo incontro', 'Sopralluogo e richiesta', 'Offerta', 'Esito']);
  assert.ok(r.body.team.some(t => t.name === 'Marco Bianchi' && /in copia/.test(t.why)));
  assert.equal(r.body.phases[0].title, 'Primo incontro');
  assert.match(r.body.phases[0].tasks[0].title, /sopralluogo/i);
  assert.equal(r.body.goal.value, 18000000);
  const out = await D('POST', '/api/crm/lancio', { signal_id: signalId, owner_id: r.body.owner_id, member_ids: r.body.team.filter(t => t.on).map(t => t.user_id), phases: r.body.phases, goal: r.body.goal, name: r.body.name });
  assert.equal(out.status, 201, JSON.stringify(out.body));
  projectId = out.body.project_id;
  assert.equal(out.body.kind, 'trattativa');
  assert.equal(out.body.mail.copied, 3, 'due email della conversazione e quella in più');
  const emails = await D('GET', `/api/projects/${projectId}/emails`);
  assert.equal(emails.body.length, 3);
  assert.equal(emails.body.find(e => e.subject.startsWith('Re:')).attachment_count, 1);
});

test('Trattativa: tocca a noi, impegni, cronologia', async () => {
  const r = await D('GET', `/api/crm/progetti/${projectId}/trattativa`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.has_mail, true);
  assert.equal(r.body.ball.who, 'noi');
  assert.ok(r.body.days_to_offer > 0);
  assert.ok(r.body.commitments.some(c => c.who === 'noi' && /referenze/.test(c.text)), JSON.stringify(r.body.commitments));
  assert.equal(r.body.next_move.kind, 'risposta');
  const c = await D('GET', `/api/crm/progetti/${projectId}/cronologia`);
  assert.equal(c.body.items.filter(i => i.type === 'email').length, 3);
  const note = await D('POST', `/api/projects/${projectId}/notes`, { body: 'Rossi dice che decide il fondo sul prezzo a metro quadro.', note_date: P.romeDay() });
  assert.equal(note.status, 201);
  const c2 = await D('GET', `/api/crm/progetti/${projectId}/cronologia`);
  assert.equal(c2.body.items[0].type, 'note');
});

test('Email nuove: entrano da sole, il committente compare, persona nuova', async () => {
  fake.arrive();
  const s = await D('POST', `/api/crm/progetti/${projectId}/posta/aggiorna`, {});
  assert.equal(s.status, 200);
  assert.equal(s.body.added, 2);
  const r = await D('GET', `/api/crm/progetti/${projectId}/trattativa`);
  assert.equal(r.body.emails, 5);
  assert.ok(r.body.commitments.some(c => c.who === 'fissato' && /giovedì 27/.test(c.text)));
  assert.equal(r.body.next_move.kind, 'incontro');
  assert.match(r.body.client?.name || '', /^Adriatica Data/);
  const items = (await D('GET', `/api/crm/progetti/${projectId}/cronologia`)).body.items.filter(i => i.type === 'email');
  assert.equal(items.filter(i => i.auto).length, 2, 'le due risposte nuove sono «entrate da sole»');
  // impegno → compito
  const i = r.body.commitments.find(c => c.who === 'noi').i;
  const t = await D('POST', `/api/crm/progetti/${projectId}/impegni/${i}`, { azione: 'compito' });
  assert.equal(t.status, 200);
  assert.ok(t.body.ticket_id);
  const r2 = await D('GET', `/api/crm/progetti/${projectId}/trattativa`);
  assert.equal(r2.body.commitments.find(c => c.i === i).state, 'compito');
  // committente nel CRM e collegato
  const cm = await D('POST', `/api/crm/progetti/${projectId}/committente`, { azione: 'aggiungi' });
  assert.equal(cm.status, 200);
  const links = await db.query("SELECT role FROM crm_project_links WHERE project_id = $1 AND subject_id = $2", [projectId, cm.body.subject_id]);
  assert.equal(links.rows[0].role, 'committente');
  // la prossima mossa si segna fatta
  assert.equal((await D('POST', `/api/crm/progetti/${projectId}/mossa`, {})).status, 200);
  assert.equal((await D('GET', `/api/crm/progetti/${projectId}/trattativa`)).body.next_move, null);
});

test('Email suggerite e risposta nella conversazione', async () => {
  // «Preventivo raffrescamento» è già entrata; un'email suggerita nuova si aggiunge o si scarta
  await db.query(`INSERT INTO crm_mail_suggestions (project_id, owner_id, internet_message_id, outlook_id, subject, from_address) VALUES ($1, (SELECT id FROM users WHERE email = $2), '<m-mn-1@fake>', 'm-mn-1', 'Contratto quadro manutenzioni', 's.marini@studiotecnicorossi.it')`, [projectId, ADMIN]);
  const r = await D('GET', `/api/crm/progetti/${projectId}/trattativa`);
  const s = r.body.suggestions.find(x => x.subject === 'Contratto quadro manutenzioni');
  assert.ok(s);
  assert.equal((await D('POST', `/api/crm/progetti/${projectId}/suggerite/${s.id}`, { azione: 'scarta' })).status, 200);
  assert.ok(!(await D('GET', `/api/crm/progetti/${projectId}/trattativa`)).body.suggestions.some(x => x.id === s.id));
  const draft = await D('POST', `/api/crm/progetti/${projectId}/risposta/bozza`, {});
  assert.equal(draft.status, 200);
  assert.match(draft.body.text, /Buongiorno/);
  assert.match(draft.body.subject, /^Re: Data center/);
  const sent = await D('POST', `/api/crm/progetti/${projectId}/risposta`, { text: 'Confermo, saremo io e Marco.' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(fake.sent.length, 1);
  const list = await D('GET', '/api/crm/posta');
  assert.equal(list.body.messages.find(x => x.id === msgId).project.id, projectId);
});

test('Il progetto compare in I miei progetti con le tappe della trattativa', async () => {
  const r = await D('GET', `/api/crm/progetti/${projectId}`);
  assert.equal(r.body.kind, 'trattativa');
  assert.equal(r.body.steps[2], 'Sopralluogo e richiesta');
  assert.equal(r.body.source.email, true);
  const mine = await D('GET', '/api/crm/progetti?vista=miei');
  assert.ok(mine.body.projects.some(p => p.id === projectId));
});

test('Dalla email (ALM2-58): persone, azienda e opportunità con lo stato nel CRM', async () => {
  const pace = await D('GET', '/api/crm/posta/m-pc-1');
  assert.equal(pace.status, 200);
  const c = pace.body.crm;
  assert.equal(c.people[0].email, 'andrea.pace@studiopace-ing.com');
  assert.equal(c.people[0].kind, 'nuova');
  assert.equal(c.people[0].job, 'Responsabile progettazione');
  assert.equal(c.company.kind, 'nuova');
  assert.equal(c.company.domain, 'studiopace-ing.com');
  assert.equal(c.opportunity.title, 'Sopralluogo capannone Val Pescara');
  assert.ok(c.asa.length > 0);
  // la conversazione del data center è già in un progetto, Rossi e Studio Tecnico Rossi sono nel CRM
  const dc = (await D('GET', `/api/crm/posta/${msgId}`)).body.crm;
  assert.equal(dc.opportunity.project.id, projectId);
  assert.equal(dc.people.find(p => p.email === 'l.rossi@studiotecnicorossi.it').kind, 'crm');
  assert.equal(dc.company.kind, 'crm');
});
