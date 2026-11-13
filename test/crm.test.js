// CRM: accesso per ASA, soggetti con ruoli e controllo dei doppioni, lead con le fasi e Lead → Cliente alla prima
// commessa, contatti collegati a più soggetti, attività, unione dei doppioni.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, D, E, F, N, G, crmSync;
const calendar = new Map(); // calendario finto per email dell'utente
const ADMIN = 'direzione@almacis.it';

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
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db,
    crmFetchEvents: async userId => calendar.get((await db.query('SELECT email FROM users WHERE id = $1', [userId])).rows[0].email) || [] });
  const { app } = out;
  crmSync = out.crmSync;
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  D = as(await login(ADMIN)); // direzione
  E = as(await login('edile@almacis.it')); // ASA Edilizia
  F = as(await login('facility@almacis.it')); // ASA Facility
  N = as(await login('nessuno@almacis.it')); // nessuna ASA
  G = as(await login('dante.marramiero@almacis.it')); // membro di Alma Energy → ASA Energy
});

after(async () => {
  server?.close();
  await db?.close();
});

test('entra la direzione e chi ha un\'ASA; i membri di Alma Energy sono dell\'ASA Energy', async () => {
  assert.equal((await N('GET', '/api/crm')).status, 403);
  assert.equal((await N('GET', '/api/me')).body.crm, false);
  assert.equal((await E('GET', '/api/crm')).status, 403);
  assert.equal((await D('POST', '/api/crm/asa/edilizia/members', { email: 'Edile@almacis.it' })).status, 201);
  assert.equal((await D('POST', '/api/crm/asa/facility/members', { email: 'facility@almacis.it' })).status, 201);
  assert.equal((await E('POST', '/api/crm/asa/facility/members', { email: 'edile@almacis.it' })).status, 403);
  const e = await E('GET', '/api/crm');
  assert.equal(e.status, 200);
  assert.deepEqual(e.body.myAsa, ['edilizia']);
  assert.equal(e.body.asa.length, 10);
  assert.equal((await E('GET', '/api/me')).body.crm, true);
  assert.deepEqual((await G('GET', '/api/crm')).body.myAsa, ['energy']);
  const d = await D('GET', '/api/crm');
  assert.equal(d.body.admin, true);
  assert.equal(d.body.myAsa.length, 10);
});

test('P.IVA e codice fiscale controllati; niente doppioni; ASA e ruoli obbligatori', async () => {
  assert.equal((await E('POST', '/api/crm/subjects', { name: 'Rossi Costruzioni', vat: '12345678901', roles: ['lead'], asa: ['edilizia'] })).status, 400);
  assert.equal((await E('POST', '/api/crm/subjects', { name: 'Rossi Costruzioni', roles: ['lead'], asa: [] })).status, 400);
  assert.equal((await E('POST', '/api/crm/subjects', { name: 'Rossi Costruzioni', roles: [], asa: ['edilizia'] })).status, 400);
  assert.equal((await E('POST', '/api/crm/subjects', { name: 'Rossi Costruzioni', roles: ['lead', 'cliente'], asa: ['edilizia'] })).status, 400);
  // non può creare una scheda solo per un'ASA non sua
  assert.equal((await E('POST', '/api/crm/subjects', { name: 'Rossi Costruzioni', roles: ['lead'], asa: ['facility'] })).status, 400);
  const r = await E('POST', '/api/crm/subjects', { name: 'Rossi Costruzioni', vat: 'IT 0274 386 0690', roles: ['lead'], asa: ['edilizia'], lead_why: 'Fa ristrutturazioni a Pescara' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.vat, '02743860690');
  assert.equal(r.body.lead_stage, 'da_contattare');
  // valore scritto all'italiana o come arriva dal database
  for (const [raw, want] of [['1.200.000', 1200000], ['1200000.00', 1200000], ['1.200.000,50', 1200000.5], ['450000', 450000]]) {
    assert.equal(Number((await E('PATCH', `/api/crm/subjects/${r.body.id}`, { potential_value: raw })).body.potential_value), want, raw);
  }
  assert.equal((await E('POST', '/api/crm/subjects', { name: 'Altro nome', vat: '02743860690', roles: ['cliente'], asa: ['edilizia'] })).status, 409);
  assert.equal((await E('POST', '/api/crm/subjects', { name: 'X', tax_code: 'ABC', roles: ['cliente'], asa: ['edilizia'] })).status, 400);
});

test('ognuno vede la sua ASA; il doppione di un\'altra ASA si segnala e ci si può unire', async () => {
  const { body: list } = await F('GET', '/api/crm/subjects');
  assert.equal(list.subjects.length, 0);
  const { body: chk } = await F('GET', '/api/crm/subjects/check?vat=02743860690');
  assert.equal(chk.matches.length, 1);
  assert.equal(chk.matches[0].visible, false);
  const id = chk.matches[0].id;
  assert.equal((await F('GET', `/api/crm/subjects/${id}`)).status, 404);
  assert.equal((await F('PATCH', `/api/crm/subjects/${id}`, { name: 'Hack' })).status, 404);
  assert.equal((await F('POST', `/api/crm/subjects/${id}/join`, { asa: 'edilizia' })).status, 400); // non è sua
  assert.equal((await F('POST', `/api/crm/subjects/${id}/join`, { asa: 'facility' })).status, 200);
  const s = await F('GET', `/api/crm/subjects/${id}`);
  assert.equal(s.status, 200);
  assert.deepEqual(s.body.asa.sort(), ['edilizia', 'facility']);
  assert.equal((await D('GET', '/api/crm/subjects?asa=facility')).body.subjects.length, 1);
});

test('fasi del lead con lo storico; diventa cliente solo alla prima commessa', async () => {
  const { body: { subjects: [s] } } = await E('GET', '/api/crm/subjects?role=lead');
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/stage`, { stage: 'contattato' })).status, 200);
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/stage`, { stage: 'non_interessato' })).status, 400); // serve il motivo
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/stage`, { stage: 'non_interessato', lost_reason: 'Prezzi', retry_date: '2027-06-01' })).body.retry_date, '2027-06-01');
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/stage`, { stage: 'diventa_cliente' })).status, 400);
  // a mano no
  assert.equal((await E('PATCH', `/api/crm/subjects/${s.id}`, { roles: ['cliente'] })).status, 400);
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/prima-commessa`, {})).status, 403);
  const c = await D('POST', `/api/crm/subjects/${s.id}/prima-commessa`, { commessa: 'C-2026-014' });
  assert.deepEqual(c.body.roles, ['cliente']);
  assert.ok(c.body.client_since);
  const { body: d } = await E('GET', `/api/crm/subjects/${s.id}`);
  assert.deepEqual(d.history.map(h => h.to_stage), ['cliente', 'non_interessato', 'contattato', 'da_contattare']);
  assert.match(d.history[0].note, /C-2026-014/);
  assert.equal((await E('GET', '/api/crm')).body.counts.cliente, 1);
});

test('contatti in più soggetti, controllo per email, visibili solo con la propria ASA', async () => {
  const { body: { subjects: [cli] } } = await E('GET', '/api/crm/subjects?role=cliente');
  const { body: comune } = await E('POST', '/api/crm/subjects', { name: 'Comune di Pescara', kind: 'ente_pubblico', roles: ['lead'], asa: ['edilizia'], ipa_code: 'c_g482' });
  assert.equal((await E('POST', '/api/crm/contacts', { last_name: 'Bianchi' })).status, 400); // senza anagrafica
  const c = await E('POST', '/api/crm/contacts', {
    title: 'Ing.', first_name: 'Mario', last_name: 'Bianchi', email: 'M.Bianchi@example.it',
    links: [{ subject_id: cli.id, job: 'Direttore tecnico', is_primary: true }, { subject_id: comune.id, job: 'RUP' }],
  });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.email, 'm.bianchi@example.it');
  assert.equal((await E('GET', '/api/crm/contacts/check?email=m.bianchi@example.it')).body.matches.length, 1);
  const { body: det } = await E('GET', `/api/crm/contacts/${c.body.id}`);
  assert.deepEqual(det.links.map(l => l.job), ['Direttore tecnico', 'RUP']);
  // Facility vede il cliente (ASA aggiunta) ma non il Comune: del contatto vede solo il collegamento al cliente
  const { body: f } = await F('GET', `/api/crm/contacts/${c.body.id}`);
  assert.deepEqual(f.links.map(l => l.job), ['Direttore tecnico']);
  // e salvando non toglie il collegamento al Comune che non vede
  assert.equal((await F('PATCH', `/api/crm/contacts/${c.body.id}`, { links: [{ subject_id: cli.id, job: 'Direttore tecnico' }] })).status, 200);
  assert.equal((await E('GET', `/api/crm/contacts/${c.body.id}`)).body.links.length, 2);
  assert.equal((await G('GET', `/api/crm/contacts/${c.body.id}`)).status, 404);
  assert.equal((await G('GET', '/api/crm/contacts')).body.contacts.length, 0);
  const { body: sc } = await E('GET', `/api/crm/subjects/${comune.id}`);
  assert.equal(sc.contacts[0].job, 'RUP');
});

test('note come negli A3 su azienda e contatto; quelle del contatto ricadono sull\'azienda dove lavorava a quella data', async () => {
  const { body: { subjects } } = await E('GET', '/api/crm/subjects?q=pescara');
  const comune = subjects.find(s => s.name === 'Comune di Pescara');
  const { body: { contacts: [mario] } } = await E('GET', '/api/crm/contacts?q=bianchi');
  const n1 = await E('POST', `/api/crm/subjects/${comune.id}/notes`, { kind: 'telefonata', body: 'Sentito il RUP per il bando scuole', note_date: '2026-11-10' });
  assert.equal(n1.status, 201);
  assert.equal((await E('POST', `/api/crm/subjects/${comune.id}/notes`, { kind: 'fax', body: 'x' })).status, 400);
  assert.equal((await F('POST', `/api/crm/subjects/${comune.id}/notes`, { body: 'x' })).status, 404);
  const n2 = await E('POST', `/api/crm/contacts/${mario.id}/notes`, { body: 'Mario dice che il bando esce a gennaio', note_date: '2026-11-11' });
  const { body: onComune } = await E('GET', `/api/crm/subjects/${comune.id}/notes`);
  assert.deepEqual(onComune.map(n => n.body), ['Mario dice che il bando esce a gennaio', 'Sentito il RUP per il bando scuole']);
  assert.match(onComune[0].via, /Mario Bianchi/);
  assert.equal(onComune[1].via, null);
  // sul contatto solo le sue
  assert.equal((await E('GET', `/api/crm/contacts/${mario.id}/notes`)).body.length, 1);
  // dopo che ha lasciato il Comune le sue note non ci ricadono più
  await E('PATCH', `/api/crm/contacts/${mario.id}`, { links: [...(await E('GET', `/api/crm/contacts/${mario.id}`)).body.links.map(l => ({ ...l, date_to: l.name === 'Comune di Pescara' ? '2026-11-30' : l.date_to }))] });
  await E('POST', `/api/crm/contacts/${mario.id}/notes`, { body: 'Ora lavora altrove', note_date: '2026-12-15' });
  assert.ok(!(await E('GET', `/api/crm/subjects/${comune.id}/notes`)).body.some(n => n.body === 'Ora lavora altrove'));
  // le modifica e le elimina solo chi le ha scritte; eliminare si annulla
  assert.equal((await G('PATCH', `/api/crm/notes/${n1.body.id}`, { body: 'x' })).status, 404); // G non vede l'azienda
  assert.equal((await E('PATCH', `/api/crm/notes/${n1.body.id}`, { pinned: true })).body.pinned, true);
  assert.equal((await E('DELETE', `/api/crm/notes/${n2.body.id}`)).status, 200);
  assert.equal((await E('POST', `/api/crm/notes/${n2.body.id}/restore`)).status, 200);
});

test('incontri di Outlook collegati da soli: per email del contatto, per dominio con proposta di contatto; «Togli» non torna più', async () => {
  const { body: adr } = await E('POST', '/api/crm/subjects', { name: 'Adriatica Costruzioni', roles: ['lead'], asa: ['edilizia'], website: 'www.adriatica.example' });
  const { body: rossi } = await E('POST', '/api/crm/contacts', { last_name: 'Rossi', first_name: 'Luca', email: 'l.rossi@adriatica.example', links: [{ subject_id: adr.id, job: 'Direttore tecnico' }] });
  const ev = (id, subject, start, end, emails) => ({ id, iCalUId: `uid-${id}`, subject, start: { dateTime: start }, end: { dateTime: end },
    organizer: { emailAddress: { address: 'edile@almacis.it', name: 'Marco' } }, attendees: emails.map(a => ({ emailAddress: { address: a, name: a.split('@')[0] } })) });
  calendar.set('edile@almacis.it', [
    ev('e1', 'Sopralluogo', '2026-11-11T10:00:00', '2026-11-11T11:00:00', ['L.Rossi@adriatica.example']),
    ev('e2', 'Presentazione', '2026-11-12T15:00:00', '2026-11-12T16:00:00', ['nuovo@adriatica.example']),
    ev('e3', 'Pranzo', '2026-11-12T13:00:00', '2026-11-12T14:00:00', ['amico@gmail.com']),
  ]);
  const { rows: [u] } = await db.query("SELECT id FROM users WHERE email = 'edile@almacis.it'");
  assert.equal(await crmSync.syncUser(u.id, new Date('2026-11-13T09:00:00Z')), 2);
  const { body: onContact } = await E('GET', `/api/crm/contacts/${rossi.id}/meetings`);
  assert.deepEqual(onContact.map(m => [m.subject, m.auto]), [['Sopralluogo', true]]);
  const { body: onAdr } = await E('GET', `/api/crm/subjects/${adr.id}/meetings`);
  assert.deepEqual(onAdr.map(m => m.subject).sort(), ['Presentazione', 'Sopralluogo']);
  assert.match(onAdr.find(m => m.subject === 'Sopralluogo').via, /Luca Rossi/);
  const { body: props } = await E('GET', `/api/crm/subjects/${adr.id}/proposals`);
  assert.deepEqual(props.map(p => p.email), ['nuovo@adriatica.example']);
  // tolto dall'azienda non torna al giro dopo; dal contatto si toglie solo dalla sua scheda
  const pres = onAdr.find(m => m.subject === 'Presentazione');
  assert.equal((await E('DELETE', `/api/crm/subjects/${adr.id}/meetings/${onAdr.find(m => m.subject === 'Sopralluogo').id}`)).status, 400);
  assert.equal((await E('DELETE', `/api/crm/subjects/${adr.id}/meetings/${pres.id}`)).status, 200);
  await crmSync.syncUser(u.id, new Date('2026-11-13T09:00:00Z'));
  assert.deepEqual((await E('GET', `/api/crm/subjects/${adr.id}/meetings`)).body.map(m => m.subject), ['Sopralluogo']);
  // chi non vede l'azienda non vede l'incontro
  assert.equal((await G('GET', `/api/crm/meetings/${pres.id}`)).status, 404);
});

test('incontro finito senza note: «!» e avviso subito a chi c\'era, una volta sola; sparisce con la prima nota', async () => {
  const { body: { subjects: [adr] } } = await E('GET', '/api/crm/subjects?q=adriatica');
  const { body: list } = await E('GET', `/api/crm/subjects/${adr.id}/meetings`);
  const sop = list.find(m => m.subject === 'Sopralluogo');
  assert.equal(sop.missing_notes, true);
  assert.equal((await E('GET', '/api/crm/subjects?q=adriatica')).body.subjects[0].missing_notes, 1);
  assert.equal(await crmSync.alertTick(new Date('2026-11-13T09:00:00Z')), 1);
  assert.equal(await crmSync.alertTick(new Date('2026-11-13T09:05:00Z')), 0);
  const { rows } = await db.query("SELECT n.body, n.link FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = 'edile@almacis.it' AND n.kind = 'crm'");
  assert.equal(rows.length, 1);
  assert.match(rows[0].body, /Sopralluogo/);
  assert.equal(rows[0].link, `/crm/incontro/${sop.id}`);
  const n = await E('POST', `/api/crm/meetings/${sop.id}/notes`, { body: 'Interessati alle facciate' });
  assert.equal(n.status, 201);
  assert.equal(n.body.kind, 'riunione');
  assert.equal((await E('GET', `/api/crm/meetings/${sop.id}`)).body.missing_notes, false);
  // la nota dell'incontro compare sia sul contatto sia sull'azienda
  assert.ok((await E('GET', `/api/crm/subjects/${adr.id}/notes`)).body.some(x => x.body === 'Interessati alle facciate'));
  const { body: tl } = await E('GET', `/api/crm/subjects/${adr.id}/timeline`);
  assert.ok(tl.items.some(i => i.type === 'meeting' && i.title === 'Sopralluogo' && !i.missing));
});

test('email collegate a un contatto ricadono sull\'azienda; progetti collegati', async () => {
  const { body: { subjects: [adr] } } = await E('GET', '/api/crm/subjects?q=adriatica');
  const { body: { contacts: [rossi] } } = await E('GET', '/api/crm/contacts?q=rossi');
  const { rows: [e] } = await db.query("INSERT INTO crm_emails (internet_message_id, subject, from_address, sent_at) VALUES ('<m1@x>', 'Richiesta di offerta', 'l.rossi@adriatica.example', '2026-11-10T09:00:00Z') RETURNING id");
  await db.query('INSERT INTO crm_email_links (email_id, contact_id) VALUES ($1, $2)', [e.id, rossi.id]);
  const { body: emails } = await E('GET', `/api/crm/subjects/${adr.id}/emails`);
  assert.equal(emails[0].subject, 'Richiesta di offerta');
  assert.match(emails[0].via, /Luca Rossi/);
  assert.equal((await E('DELETE', `/api/crm/subjects/${adr.id}/emails/${e.id}`)).status, 400);
  assert.equal((await E('GET', `/api/crm/emails/${e.id}`)).body.subject, 'Richiesta di offerta');
  assert.equal((await G('GET', `/api/crm/emails/${e.id}`)).status, 404);
  const { body: p } = await E('POST', '/api/projects', { name: 'Proposta Adriatica' });
  assert.equal((await E('POST', `/api/crm/subjects/${adr.id}/projects`, { project_id: p.id })).status, 201);
  assert.equal((await E('GET', `/api/crm/subjects/${adr.id}/projects`)).body[0].name, 'Proposta Adriatica');
});

test('liste da cui scegliere: SOA con classifica, forma giuridica, provincia, zone, titolo', async () => {
  const ok = await E('POST', '/api/crm/subjects', { name: 'Impianti Sud', roles: ['partner'], asa: ['edilizia'], legal_form: 'Consorzio', province: 'BA', region: 'Puglia',
    soa: [{ cat: 'OS30', cls: 'V' }, { cat: 'OG11', cls: 'III', expires: '2027-05-01' }], supplier_zones: ['BA', 'BT'] });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.soa.map(x => `${x.cat} ${x.cls}`), ['OS30 V', 'OG11 III']);
  for (const bad of [{ soa: [{ cat: 'OG99', cls: 'I' }] }, { soa: [{ cat: 'OG1', cls: 'IX' }] }, { legal_form: 'Srl' }, { province: 'XX' }, { supplier_zones: ['Puglia'] }]) {
    assert.equal((await E('PATCH', `/api/crm/subjects/${ok.body.id}`, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await E('POST', '/api/crm/contacts', { last_name: 'X', title: 'Dottore', links: [{ subject_id: ok.body.id }] })).status, 400);
  const { body } = await E('GET', '/api/crm');
  assert.ok(body.meta.soaCategories.some(([k]) => k === 'OS18-A'));
  assert.equal(body.meta.soaClasses.length, 10);
  assert.ok(body.meta.regions.find(r => r.name === 'Abruzzo').provinces.some(([k]) => k === 'PE'));
});

test('unione dei doppioni (direzione): contatti e note passano alla scheda buona', async () => {
  const { body: a } = await E('POST', '/api/crm/subjects', { name: 'Verdi Srl', roles: ['fornitore'], asa: ['edilizia'], supplier_categories: ['noli'] });
  const { body: b } = await E('POST', '/api/crm/subjects', { name: 'Verdi S.r.l.', vat: '00488410010', roles: ['fornitore'], asa: ['edilizia'] });
  await E('POST', '/api/crm/contacts', { last_name: 'Neri', links: [{ subject_id: a.id, job: 'Commerciale' }] });
  await E('POST', `/api/crm/subjects/${a.id}/notes`, { body: 'Preventivo nolo gru' });
  assert.equal((await E('POST', `/api/crm/subjects/${a.id}/merge`, { into: b.id })).status, 403);
  assert.equal((await D('POST', `/api/crm/subjects/${a.id}/merge`, { into: b.id })).status, 200);
  const { body: good } = await E('GET', `/api/crm/subjects/${b.id}`);
  assert.equal(good.contacts[0].last_name, 'Neri');
  assert.equal((await E('GET', `/api/crm/subjects/${b.id}/notes`)).body[0].body, 'Preventivo nolo gru');
  assert.equal((await E('GET', `/api/crm/subjects/${a.id}`)).body.merged_into, b.id);
  assert.equal((await E('PATCH', `/api/crm/subjects/${a.id}`, { name: 'x' })).status, 409);
  assert.ok(!(await E('GET', '/api/crm/subjects?role=fornitore')).body.subjects.some(s => s.id === a.id));
});

test('la direzione crea nuove ASA', async () => {
  const r = await D('POST', '/api/crm/asa', { label: 'Manutenzione strade' });
  assert.equal(r.body.key, 'manutenzione_strade');
  assert.equal((await D('POST', '/api/crm/asa', { label: 'Manutenzione strade' })).status, 409);
  assert.equal((await E('POST', '/api/crm/asa', { label: 'Mia' })).status, 403);
  const { body } = await D('GET', '/api/crm/asa');
  assert.equal(body.asa.find(a => a.key === 'energy').energyMembers[0].email, 'dante.marramiero@almacis.it');
});

test('owner obbligatorio e funzione di riferimento scelta tra i reparti dell\'organigramma', async () => {
  await db.query(`INSERT INTO org_people (oid, name, email, department) VALUES ('o1', 'Laura Acquisti', 'laura@almacis.it', 'Acquisti'), ('o2', 'Gino Gare', 'gino@almacis.it', 'Gare')`);
  const { body: meta } = await E('GET', '/api/crm');
  assert.deepEqual(meta.functions, ['Acquisti', 'Gare']);
  const r = await E('POST', '/api/crm/subjects', { name: 'Ferro Sud', roles: ['fornitore'], asa: ['edilizia'], function_name: 'Acquisti' });
  assert.equal(r.status, 201);
  assert.ok(r.body.owner_id); // di default chi la crea
  assert.equal(r.body.function_name, 'Acquisti');
  assert.equal((await E('PATCH', `/api/crm/subjects/${r.body.id}`, { owner_id: null })).status, 400);
  assert.equal((await E('PATCH', `/api/crm/subjects/${r.body.id}`, { function_name: 'Marketing' })).status, 400);
  assert.equal((await E('PATCH', `/api/crm/subjects/${r.body.id}`, { function_name: 'Gare' })).body.function_name, 'Gare');
  assert.deepEqual((await E('GET', '/api/crm/subjects?function=Gare')).body.subjects.map(s => s.name), ['Ferro Sud']);
});
