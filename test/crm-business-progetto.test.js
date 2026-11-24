// Nuovi business come progetto (ALM2-79, Dante 24/11/2026): ogni iniziativa ha da subito il suo progetto (compiti, relazioni,
// incontri, calendario, email, note, documenti, Gantt, membri), i passi del piano sono compiti veri, «Porta avanti» non crea
// un secondo progetto. Relazioni: aziende con i loro contatti.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, D, E;
const ADMIN = 'direzione@almacis.it';
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
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const plus = n => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN, API_WRITE_MAX: '2000' }), { db, crmFetchEvents: async () => [], radarFetch: async () => ({ ok: true, json: async () => ({ output_text: '[]', output: [], usage: {} }) }) });
  server = out.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  D = as(await login(ADMIN));
  E = as(await login('edile@almacis.it'));
});
after(async () => { server?.close(); await db?.close(); });

test('l\'iniziativa nasce con il suo progetto; non è in «I miei progetti» finché non è portata avanti', async () => {
  const ini = (await D('POST', '/api/crm/business', { name: 'Biometano centro sud', description: 'Impianti con sviluppatori', owner_id: await meId(D) })).body;
  assert.ok(ini.project_id, 'il progetto c\'è subito');
  const p = (await D('GET', `/api/projects/${ini.project_id}`)).body;
  assert.equal(p.name, 'Biometano centro sud');
  const sum = (await D('GET', `/api/crm/progetti/${ini.project_id}`)).body;
  assert.equal(sum.source.type, 'initiative');
  assert.equal(sum.source.launched, false);
  const mine = (await D('GET', '/api/crm/progetti?vista=tutti')).body.projects;
  assert.ok(!mine.some(x => x.id === ini.project_id), 'prima del lancio resta solo in Nuovi business');
  // il nome cambiato nell'iniziativa passa al progetto
  await D('PATCH', `/api/crm/business/${ini.id}`, { name: 'Biometano Lazio e Campania' });
  assert.equal((await D('GET', `/api/projects/${ini.project_id}`)).body.name, 'Biometano Lazio e Campania');
});

test('un\'iniziativa nata prima riceve il progetto alla prima apertura, con un compito per ogni passo', async () => {
  const { rows: [i] } = await db.query("INSERT INTO crm_initiatives (name, owner_id) VALUES ('Vecchia iniziativa', (SELECT id FROM users WHERE email = $1)) RETURNING id", [ADMIN]);
  await db.query("INSERT INTO crm_initiative_tasks (initiative_id, phase, title, due_date) VALUES ($1, 'esplorazione', 'Mappa degli impianti', $2)", [i.id, plus(5)]);
  const got = (await D('GET', `/api/crm/business/${i.id}`)).body;
  assert.ok(got.project_id);
  const tickets = (await D('GET', `/api/tickets?project=${got.project_id}`)).body;
  assert.deepEqual(tickets.map(t => t.title), ['Mappa degli impianti']);
  // una seconda apertura non crea doppioni
  await D('GET', `/api/crm/business/${i.id}`);
  assert.equal((await D('GET', `/api/tickets?project=${got.project_id}`)).body.length, 1);
});

test('passi del piano ↔ compiti: creare, assegnare, chiudere dal compito, cancellare', async () => {
  const eId = await meId(E);
  const ini = (await D('POST', '/api/crm/business', { name: 'Agrisolare', owner_id: await meId(D) })).body;
  const step = (await D('POST', `/api/crm/business/${ini.id}/tasks`, { title: 'Chiamare Acqualatina', owner_id: eId, due_date: plus(3) })).body;
  assert.ok(step.ticket_id);
  let t = (await D('GET', `/api/tickets/${step.ticket_id}`)).body;
  assert.equal(t.title, 'Chiamare Acqualatina');
  assert.equal(t.due_date, plus(3));
  assert.deepEqual(t.assignee_ids, [eId]);
  assert.equal(t.project_id, ini.project_id);
  // chi riceve il passo entra nel progetto e lo trova nei suoi compiti
  const members = (await D('GET', `/api/projects/${ini.project_id}/members`)).body;
  assert.ok(members.some(m => m.id === eId));
  // dal Piano al compito
  await D('PATCH', `/api/crm/business/tasks/${step.id}`, { title: 'Chiamare Acqualatina (digestato)', due_date: plus(6) });
  t = (await D('GET', `/api/tickets/${step.ticket_id}`)).body;
  assert.equal(t.title, 'Chiamare Acqualatina (digestato)');
  assert.equal(t.due_date, plus(6));
  // dal compito al Piano: chi lo fa lo chiude dalla bacheca
  assert.equal((await E('PATCH', `/api/tickets/${step.ticket_id}`, { status: 'done' })).status, 200);
  let plan = (await D('GET', `/api/crm/business/${ini.id}/tasks`)).body.tasks;
  assert.ok(plan.find(x => x.id === step.id).done_at, 'il passo risulta fatto');
  await E('PATCH', `/api/tickets/${step.ticket_id}`, { status: 'todo' });
  plan = (await D('GET', `/api/crm/business/${ini.id}/tasks`)).body.tasks;
  assert.equal(plan.find(x => x.id === step.id).done_at, null);
  // passo fatto dal Piano → compito fatto
  await D('PATCH', `/api/crm/business/tasks/${step.id}`, { done: true });
  assert.equal((await D('GET', `/api/tickets/${step.ticket_id}`)).body.status, 'done');
  // via il passo, via il compito
  await D('DELETE', `/api/crm/business/tasks/${step.id}`);
  assert.equal((await D('GET', `/api/tickets/${step.ticket_id}`)).status, 404);
});

test('relazioni: clienti target, persona con la sua azienda, azienda con le persone spuntate', async () => {
  const ini = (await D('POST', '/api/crm/business', { name: 'Teleriscaldamento', owner_id: await meId(D) })).body;
  const hera = (await D('POST', '/api/crm/subjects/rapida', { name: 'HeraAmbiente Spa' })).body;
  const fater = (await D('POST', '/api/crm/subjects/rapida', { name: 'Fatergroup' })).body;
  // un cliente target nel CRM entra da solo nelle relazioni del progetto
  assert.equal((await D('POST', `/api/crm/business/${ini.id}/targets`, { name: 'HeraAmbiente Spa', subject_id: hera.id })).status, 201);
  let links = (await D('GET', `/api/crm/collegamenti?project=${ini.project_id}`)).body.links;
  assert.deepEqual(links.map(l => [l.subject_id, l.role, l.role_label]), [[hera.id, 'cliente_target', 'Cliente target']]);
  // una persona porta con sé la sua azienda
  const rinaldi = (await D('POST', '/api/crm/contacts', { first_name: 'Paolo', last_name: 'Rinaldi', links: [{ subject_id: fater.id, job: 'direttore tecnico' }] })).body;
  links = (await D('POST', '/api/crm/collegamenti', { project: ini.project_id, contact_id: rinaldi.id })).body.links;
  assert.ok(links.some(l => l.subject_id === fater.id), 'entra anche Fatergroup');
  const c = links.find(l => l.contact_id === rinaldi.id);
  assert.equal(c.works_at_id, fater.id);
  assert.equal(c.job, 'direttore tecnico');
  // le persone di un'azienda, da spuntare
  const ferri = (await D('POST', '/api/crm/contacts', { first_name: 'Laura', last_name: 'Ferri', links: [{ subject_id: hera.id }] })).body;
  const altro = (await D('POST', '/api/crm/contacts', { first_name: 'Gino', last_name: 'Altrove' })).body;
  const ppl = (await D('GET', `/api/crm/collegamenti/persone?subject=${hera.id}`)).body.people;
  assert.deepEqual(ppl.map(p => p.id), [ferri.id]);
  // collegando l'azienda con le persone spuntate entrano solo quelle che ci lavorano
  links = (await D('POST', '/api/crm/collegamenti', { project: ini.project_id, subject_id: hera.id, role: 'cliente_target', with_contacts: [ferri.id, altro.id] })).body.links;
  assert.ok(links.some(l => l.contact_id === ferri.id));
  assert.ok(!links.some(l => l.contact_id === altro.id));
});

test('«Porta avanti» fa crescere lo stesso progetto: compiti ed email restano, entra in «I miei progetti»', async () => {
  const ini = (await D('POST', '/api/crm/business', { name: 'Fotovoltaico su tetti', budget_eur: 15000, owner_id: await meId(D) })).body;
  const step = (await D('POST', `/api/crm/business/${ini.id}/tasks`, { title: 'Elenco sviluppatori', due_date: plus(4) })).body;
  const prop = (await D('GET', `/api/crm/lancio/proposta?initiative=${ini.id}`)).body;
  assert.ok(!prop.phases.some(p => p.tasks.some(t => t.title === 'Elenco sviluppatori')), 'il passo è già un compito: niente doppione');
  const out = await D('POST', '/api/crm/lancio', { initiative_id: ini.id, phases: prop.phases, goal: prop.goal, member_ids: [await meId(E)] });
  assert.equal(out.status, 201);
  assert.equal(out.body.project_id, ini.project_id, 'stesso progetto');
  const tickets = (await D('GET', `/api/tickets?project=${ini.project_id}`)).body;
  assert.ok(tickets.some(t => t.id === step.ticket_id), 'il compito di prima c\'è ancora');
  assert.ok(tickets.length > 1);
  const card = (await D('GET', '/api/crm/progetti?vista=tutti')).body.projects.find(p => p.id === ini.project_id);
  assert.ok(card, 'ora è in «I miei progetti»');
  assert.equal(card.source.launched, true);
  assert.equal(card.goal.budget, 15000);
  assert.equal((await D('GET', `/api/crm/lancio/proposta?initiative=${ini.id}`)).body.already, ini.project_id);
  assert.equal((await D('POST', '/api/crm/lancio', { initiative_id: ini.id, phases: prop.phases })).status, 409);
});

test('email suggerite da Alma (solo mie, entrano col mio sì) e persone spuntate da sole da email e incontri', async () => {
  const ini = (await D('POST', '/api/crm/business', { name: 'Raffrescamento capannoni', owner_id: await meId(D) })).body;
  const pid = ini.project_id;
  const studio = (await D('POST', '/api/crm/subjects/rapida', { name: 'Studio Tecnico Rossi' })).body;
  const rossi = (await D('POST', '/api/crm/contacts', { first_name: 'Luca', last_name: 'Rossi', email: 'l.rossi@studiotecnicorossi.it', links: [{ subject_id: studio.id }] })).body;
  await D('POST', '/api/crm/collegamenti', { project: pid, subject_id: studio.id });
  // Alma cerca nella mia casella le email delle aziende collegate
  const r = await D('POST', `/api/crm/progetti/${pid}/cerca-email`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.found > 0);
  const list = (await D('GET', `/api/crm/progetti/${pid}/suggerite`)).body.suggestions;
  const pre = list.find(s => s.subject === 'Preventivo raffrescamento');
  assert.ok(pre, 'trova l\'email di Rossi');
  assert.match(pre.why, /Luca Rossi \(Studio Tecnico Rossi\)|raffrescamento/);
  // un collega non le vede
  assert.deepEqual((await E('GET', `/api/crm/progetti/${pid}/suggerite`)).body.suggestions, []);
  // una seconda ricerca non le ripropone
  await D('POST', `/api/crm/progetti/${pid}/cerca-email`, {});
  assert.equal((await D('GET', `/api/crm/progetti/${pid}/suggerite`)).body.suggestions.length, list.length);
  // «Aggiungi»: entra nelle email del progetto
  assert.equal((await D('POST', `/api/crm/progetti/${pid}/suggerite/${pre.id}`, { azione: 'aggiungi' })).status, 200);
  const emails = (await D('GET', `/api/projects/${pid}/emails`)).body;
  assert.ok(emails.some(e => e.subject === 'Preventivo raffrescamento'));
  // ricollegando l'azienda, Rossi (che è nelle email del progetto) si spunta da solo
  await D('DELETE', '/api/crm/collegamenti', { project: pid, subject_id: studio.id });
  // nella ricerca di Relazioni si vede già quante sue persone sono nelle email (ALM2-86)
  assert.deepEqual((await D('GET', `/api/crm/collegamenti/nelle-email?project=${pid}&subjects=${studio.id}`)).body.counts, { [studio.id]: 1 });
  const out =(await D('POST', '/api/crm/collegamenti', { project: pid, subject_id: studio.id, auto_contacts: true })).body;
  assert.equal(out.auto, 1);
  assert.ok(out.links.some(l => l.contact_id === rossi.id));
});
