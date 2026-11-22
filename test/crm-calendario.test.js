// Calendario del CRM (ALM2-65): eventi con i colori del CRM, scheda, dettaglio, inviti, collega, note, Alma, orari, nuovo.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { createPostaFake } = require('../lib/crm-posta-fake');
const { createCalendarioFake } = require('../lib/crm-calendario-fake');
const C = require('../lib/crm-calendario-ai');

let server, base, db, D, cal, mail;
const ADMIN = 'direzione@almacis.it';
const day = (n = 0) => { const t = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }); const wd = (new Date(`${t}T12:00:00Z`).getUTCDay() + 6) % 7; const d = new Date(`${t}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - wd + n); return d.toISOString().slice(0, 10); };

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
  cal = createCalendarioFake();
  mail = createPostaFake();
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db, postaFake: mail, calendarioFake: cal, crmFetchEvents: async () => [] });
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await login('marco.bianchi@almacis.it');
  const cookie = await login(ADMIN);
  D = (method, path, body) => api(cookie, method, path, body);
  // Studio Rossi nel CRM con Luca come contatto
  const { rows: [s] } = await db.query("INSERT INTO crm_subjects (name) VALUES ('Studio Tecnico Rossi s.r.l.') RETURNING id");
  const { rows: [c] } = await db.query("INSERT INTO crm_contacts (first_name, last_name, email) VALUES ('Luca', 'Rossi', 'l.rossi@studiotecnicorossi.it') RETURNING id");
  await db.query('INSERT INTO crm_contact_links (contact_id, subject_id) VALUES ($1, $2)', [c.id, s.id]);
  D.subject = s.id; D.contact = c.id;
});
after(async () => { server?.close(); await db?.close(); });

test('eventi della settimana con i colori del CRM', async () => {
  const r = await D('GET', `/api/crm/calendario/eventi?start=${day(0)}&end=${day(7)}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const k = id => r.body.events.find(e => e.id === id)?.kind;
  assert.equal(k('ev-dir'), 'int');        // solo colleghi
  assert.equal(k('ev-sopr'), 'crm');       // Luca è un contatto del CRM
  assert.equal(k('ev-bess'), 'inv');       // invito da confermare
  assert.equal(k('ev-pace'), 'oth');       // esterno, non nel CRM
  assert.ok(r.body.events.find(e => e.id === 'ev-sopr').crm_people.includes('Luca Rossi'));
});

test('dettaglio, risposta all\'invito, collega, nota e scheda', async () => {
  let r = await D('GET', '/api/crm/calendario/evento/ev-sopr');
  assert.equal(r.status, 200);
  const luca = r.body.people.find(p => p.address === 'l.rossi@studiotecnicorossi.it');
  assert.equal(luca.subject_id, D.subject);
  assert.equal(luca.response, 'accepted');
  assert.ok(r.body.people.find(p => p.address === 'marco.bianchi@almacis.it').internal);
  r = await D('POST', '/api/crm/calendario/evento/ev-bess/risposta', { tipo: 'forse' });
  assert.equal(r.body.response, 'tentativelyAccepted');
  assert.equal(cal.responses.at(-1).kind, 'tentativelyAccept');
  assert.equal((await D('POST', '/api/crm/calendario/evento/ev-bess/risposta', { tipo: 'boh' })).status, 400);
  // nota su un incontro non collegato: si collega da solo all'azienda di Luca
  r = await D('POST', '/api/crm/calendario/evento/ev-old/nota', { testo: 'Rivisto il contratto quadro, mandano la bozza entro venerdì' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await D('GET', `/api/crm/calendario/eventi?start=${day(-7)}&end=${day(7)}&scheda=subjects:${D.subject}`);
  const old = r.body.events.find(e => e.id === 'ev-old');
  assert.equal(old.here, true);
  assert.equal(old.missing_notes, false);
  assert.equal(r.body.events.find(e => e.id === 'ev-dir').here, false);
  // collega a mano un incontro all'azienda
  r = await D('POST', '/api/crm/calendario/evento/ev-pace/collega', { subject_id: D.subject });
  assert.equal(r.status, 201);
  r = await D('GET', '/api/crm/calendario/evento/ev-pace');
  assert.ok(r.body.links.some(l => l.subject_id === D.subject));
});

test('Alma: prepara, riepilogo (con le note) e invio con la firma', async () => {
  let r = await D('POST', '/api/crm/calendario/evento/ev-sopr/prepara');
  assert.equal(r.status, 200);
  assert.equal(r.body.ai, false);
  assert.ok(r.body.ultima_volta.includes('contratto quadro') || r.body.da_sapere.length);
  assert.equal((await D('POST', '/api/crm/calendario/evento/ev-sopr/riepilogo')).status, 400, 'senza note niente riepilogo');
  r = await D('POST', '/api/crm/calendario/evento/ev-old/riepilogo');
  assert.equal(r.status, 200);
  assert.match(r.body.testo, /contratto quadro/);
  r = await D('POST', '/api/crm/calendario/evento/ev-old/manda', { a: r.body.to, oggetto: r.body.oggetto, testo: r.body.testo });
  assert.equal(r.status, 200);
  const sent = mail.sent.at(-1);
  assert.match(sent.message.body.content, /almacis-firma/);
  assert.equal(sent.message.attachments[0].contentId, 'almacis-logo');
});

test('orari liberi, invito con Alma e nuovo incontro collegato', async () => {
  let r = await D('POST', '/api/crm/calendario/orari', { emails: ['marco.bianchi@almacis.it', 'esterno@altro.it'], minuti: 60, da: day(7) });
  assert.equal(r.status, 200);
  assert.equal(r.body.slots.length, 3);
  assert.equal(r.body.people, 2, 'io e Marco, non gli esterni');
  // regole: niente pausa pranzo, niente weekend
  const slots = C.freeSlots([{ start: `${day(7)}T09:00`, end: `${day(7)}T12:00` }], { from: day(5), minutes: 60, max: 3 });
  assert.equal(slots[0].start, `${day(7)}T12:00`);
  assert.ok(slots.every(s => s.start.slice(11) !== '13:00' && s.start.slice(11) !== '13:30'));
  r = await D('POST', '/api/crm/calendario/invito', { titolo: 'Primo incontro', con: [{ name: 'Luca Rossi', address: 'l.rossi@studiotecnicorossi.it' }], quando: 'ven 15:00' });
  assert.match(r.body.testo, /Buongiorno Luca/);
  r = await D('POST', '/api/crm/calendario/nuovo', { titolo: 'Primo incontro · ampliamento', inizio: `${day(11)}T15:00`, fine: `${day(11)}T16:00`,
    con: [{ name: 'Luca Rossi', address: 'l.rossi@studiotecnicorossi.it' }], teams: true, testo: 'Ciao Luca', promemoria: 1440, subject_id: D.subject });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const e = cal.created.at(-1);
  assert.equal(e.isOnlineMeeting, true);
  assert.equal(e.reminderMinutesBeforeStart, 1440);
  assert.match(e.body.content, /almacis-firma/);
  assert.ok(r.body.meeting_id);
  assert.equal((await D('POST', '/api/crm/calendario/nuovo', { titolo: 'x', inizio: `${day(11)}T15:00`, fine: `${day(11)}T14:00` })).status, 400);
  r = await D('GET', '/api/crm/calendario/cerca?q=ross');
  assert.ok(r.body.items.some(i => i.kind === 'azienda' && i.subject_id === D.subject));
  r = await D('GET', `/api/crm/calendario/occupato?emails=marco.bianchi@almacis.it&start=${day(0)}&end=${day(7)}`);
  assert.ok(r.body.people[0].busy.length >= 1);
});
