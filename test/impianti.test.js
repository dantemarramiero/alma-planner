// Alma Impianti (ALM2-73): settori, mandato dei fondi, email senza risposta, stato del contatto, dare/avere con i
// progettisti, Da fare, Fondi e Progettisti via API (casella finta), settore e filtri del Radar.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const I = require('../lib/impianti');

let server, base, db, D, U;
const ADMIN = 'direzione@almacis.it';
const USER = 'simone.mancinelli@almacis.it';

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, { method, headers: { ...(cookie ? { cookie } : {}), 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await login(ADMIN);
  D = (method, path, body) => api(a, method, path, body);
  const u = await login(USER);
  U = (method, path, body) => api(u, method, path, body);
});
after(async () => { server?.close(); await db?.close(); });

test('settore dalle parole del segnale', () => {
  assert.equal(I.sectorOf('Impianto di biometano da 500 Smc/h ammesso in graduatoria GSE'), 'biometano');
  assert.equal(I.sectorOf('Adeguamento del depuratore consortile', 'acque reflue'), 'depurazione');
  assert.equal(I.sectorOf('Cartiera energivora investe in cogenerazione'), 'efficientamento');
  assert.equal(I.sectorOf('Parco agrivoltaico da 12 MWp autorizzato'), 'fotovoltaico');
  assert.equal(I.sectorOf('Nuovo polo logistico da 38.000 m²'), 'edilizia');
  assert.equal(I.sectorOf('Rifacimento della piazza'), '');
});

test('mandato del fondo: settore, taglia, regione, fase', () => {
  const m = { techs: ['biometano', 'fotovoltaico'], ticket_min: 5e6, ticket_max: 30e6, regions: ['Puglia', 'Sicilia'], phases: ['autorizzato'] };
  const ok = I.fundFits(m, { sector: 'biometano', amount: 7.8e6, region: 'Puglia', phase: 'autorizzato' });
  assert.equal(ok.ok, true);
  assert.ok(ok.score >= 90);
  assert.equal(I.fundFits(m, { sector: 'depurazione', amount: 7e6, region: 'Puglia' }).ok, false);
  assert.equal(I.fundFits(m, { sector: 'biometano', amount: 1e6, region: 'Puglia' }).ok, false, 'troppo piccolo per il ticket');
  assert.equal(I.fundFits(m, { sector: 'biometano', amount: 8e6, region: 'Lombardia' }).ok, false);
  assert.equal(I.fundFits({ techs: [], regions: [] }, { sector: 'depurazione', amount: 2e6 }).ok, true, 'mandato aperto');
  assert.equal(I.fundFits(null, { sector: 'biometano' }).ok, false);
});

test('giorni lavorativi ed email senza risposta', () => {
  assert.equal(I.businessDays('2026-11-20T10:00:00Z', '2026-11-24T10:00:00Z'), 2); // ven → mar: lun e mar
  const now = new Date('2026-11-24T12:00:00Z');
  const r = n => ({ emailAddress: { name: n, address: `${n}@ditta.it` } });
  const sent = [
    { id: 'a', conversationId: 'c1', subject: 'Offerta', sentDateTime: '2026-11-12T09:00:00Z', toRecipients: [r('rossi')] },
    { id: 'b', conversationId: 'c2', subject: 'Sopralluogo', sentDateTime: '2026-11-12T09:00:00Z', toRecipients: [r('bianchi')] },
    { id: 'c', conversationId: 'c3', subject: 'Recente', sentDateTime: '2026-11-23T09:00:00Z', toRecipients: [r('verdi')] },
    { id: 'd', conversationId: 'c4', subject: 'Fuori CRM', sentDateTime: '2026-11-10T09:00:00Z', toRecipients: [r('amico')] },
    // ho riscritto nella stessa conversazione: conta l'ultima
    { id: 'e1', conversationId: 'c5', subject: 'Primo', sentDateTime: '2026-11-03T09:00:00Z', toRecipients: [r('neri')] },
    { id: 'e2', conversationId: 'c5', subject: 'Sollecito', sentDateTime: '2026-11-13T09:00:00Z', toRecipients: [r('neri')] },
  ];
  const inbox = [{ conversationId: 'c2', from: r('bianchi'), receivedDateTime: '2026-11-13T09:00:00Z' }];
  const out = I.awaitingReplies(sent, inbox, { now, waitDays: 5, keep: a => !a.startsWith('amico') });
  assert.deepEqual(out.map(x => x.id).sort(), ['a', 'e2']);
  assert.equal(I.awaitingReplies(sent, inbox, { now, waitDays: 5, keep: () => true, ignored: ['a'] }).some(x => x.id === 'a'), false);
});

test('stato del contatto e dare/avere', () => {
  assert.equal(I.contactState({}), 'mai');
  assert.equal(I.contactState({ sent: 2 }), 'contattato');
  assert.equal(I.contactState({ sent: 2, awaiting: true }), 'attesa');
  assert.equal(I.contactState({ sent: 1, received: 1 }), 'risposto');
  assert.equal(I.contactState({ sent: 1, meetings: 1 }), 'incontro');
  const now = new Date('2026-11-24T12:00:00Z');
  assert.equal(I.exchangeState({ now }), 'da_conoscere');
  assert.equal(I.exchangeState({ dato: 0, ricevuto: 3, last_contact: '2026-11-20', now }), 'da_ricambiare');
  assert.equal(I.exchangeState({ dato: 2, ricevuto: 2, last_contact: '2026-11-20', now }), 'forte');
  assert.equal(I.exchangeState({ dato: 1, ricevuto: 1, last_contact: '2026-08-01', now, cadence: 45 }), 'fermo');
});

test('Fondi: nuovo fondo, mandato e abbinamento coi segnali della BU', async () => {
  const f = await U('POST', '/api/crm/impianti/fondi', { name: 'Fondo Verde Test' });
  assert.equal(f.status, 201);
  const id = f.body.id;
  const bad = await U('PUT', `/api/crm/impianti/fondi/${id}/mandato`, { ticket_min: 10, ticket_max: 5 });
  assert.equal(bad.status, 400);
  const m = await U('PUT', `/api/crm/impianti/fondi/${id}/mandato`, { techs: ['biometano', 'nonvalido'], ticket_min: 5e6, ticket_max: 30e6, regions: ['Puglia'], bus: ['impianti', 'energy'] });
  assert.equal(m.status, 200);
  assert.deepEqual(m.body.mandate.techs, ['biometano']);
  // segnale di biometano in Puglia per Impianti
  const s = await D('POST', '/api/crm/radar/signals', { title: 'Biometano 500 Smc/h ammesso in graduatoria GSE a Lucera', entity: 'Az. agricola Test', bu: 'impianti', amount: 7800000, region: 'Puglia' });
  assert.ok([200, 201].includes(s.status), JSON.stringify(s.body));
  const { rows: [sig] } = await db.query("SELECT sector FROM crm_signals WHERE title LIKE 'Biometano 500%'");
  assert.equal(sig.sector, 'biometano');
  const list = await U('GET', '/api/crm/impianti/fondi');
  const mine = list.body.funds.find(x => x.id === id);
  assert.equal(mine.matches, 1);
  assert.equal(list.body.totals.both, 1);
  const one = await U('GET', `/api/crm/impianti/fondi/${id}`);
  assert.equal(one.body.matches[0].sector, 'biometano');
  // stesso nome: niente doppione
  const again = await U('POST', '/api/crm/impianti/fondi', { name: 'fondo verde test' });
  assert.equal(again.body.existing, true);
  const { rows: [subj] } = await db.query('SELECT segment, asa FROM crm_subjects WHERE id = $1', [id]);
  assert.equal(subj.segment, I.SEGMENT_FUND);
  assert.ok(subj.asa.includes('impianti'));
});

test('Progettisti: scambi dati e ricevuti, stato «da ricambiare»', async () => {
  const { rows: [p] } = await db.query("INSERT INTO crm_subjects (name, roles, kind) VALUES ('Hydro Progetti Test', '{progettista}', 'professionista') RETURNING id");
  for (const t of ['Depuratore di Ortona', 'Presentazione al gestore']) {
    const r = await U('POST', `/api/crm/impianti/progettisti/${p.id}/scambi`, { direction: 'ricevuto', title: t });
    assert.equal(r.status, 201);
  }
  assert.equal((await U('POST', `/api/crm/impianti/progettisti/${p.id}/scambi`, { title: 'senza verso' })).status, 400);
  const list = await U('GET', '/api/crm/impianti/progettisti');
  const row = list.body.progettisti.find(x => x.id === p.id);
  assert.equal(row.ricevuto, 2);
  assert.equal(row.state, 'da_ricambiare');
  const sc = await U('GET', `/api/crm/impianti/progettisti/${p.id}/scambi`);
  assert.equal(sc.body.scambi.length, 2);
  // lo toglie chi l'ha scritto
  const del = await U('DELETE', `/api/crm/impianti/scambi/${sc.body.scambi[0].id}`);
  assert.equal(del.status, 200);
});

test('Da fare: email senza risposta a persone del CRM, passi, da risentire, «Lascia stare»', async () => {
  // contatti con le email della casella finta
  const mk = async (name, segment, roles, email, last) => {
    const { rows: [s] } = await db.query('INSERT INTO crm_subjects (name, roles, segment, asa) VALUES ($1, $2, $3, $4) RETURNING id', [name, roles, segment, ['impianti']]);
    const { rows: [c] } = await db.query('INSERT INTO crm_contacts (first_name, last_name, email) VALUES ($1, $2, $3) RETURNING id', [last, last, email]);
    await db.query('INSERT INTO crm_contact_links (contact_id, subject_id, is_primary) VALUES ($1, $2, true)', [c.id, s.id]);
    return s.id;
  };
  const fondo = await mk('Fondo Verde Esempio', I.SEGMENT_FUND, '{lead}', 'l.neri@fondoverde-esempio.it', 'Neri');
  await mk('Bianchi & Associati', '', '{progettista}', 'bianchi@bianchi-associati.it', 'Bianchi');
  await mk('Studio Tecnico Rossi', '', '{progettista}', 'p.rossi@studiotecnicorossi-esempio.it', 'Rossi');
  const { rows: [me] } = await db.query('SELECT id FROM users WHERE email = $1', [USER]);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  await db.query("INSERT INTO crm_steps (subject_id, title, due_date, owner_id) VALUES ($1, 'Chiamare Neri', $2, $3), ($1, 'Mandare il dossier', $2::date - 3, $3)", [fondo, today, me.id]);
  const r = await U('GET', '/api/crm/impianti/dafare');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const g = r.body.groups;
  assert.deepEqual(g.attesa.map(x => x.email).sort(), ['bianchi@bianchi-associati.it', 'l.neri@fondoverde-esempio.it']);
  assert.equal(g.attesa.find(x => x.email.startsWith('l.neri')).kind, 'Fondo');
  assert.match(g.attesa[0].what, /nessuna risposta/);
  assert.equal(g.oggi.length, 1);
  assert.equal(g.ritardo.length, 1);
  assert.match(g.ritardo[0].what, /scaduto da 3 giorni/);
  assert.ok(g.risentire.some(x => x.subject_id === fondo), 'fondo mai sentito');
  assert.ok(r.body.funnel.attesa >= 1);
  const ign = await U('POST', '/api/crm/impianti/dafare/ignora', { message_id: 'imp-out-1' });
  assert.equal(ign.status, 200);
  const r2 = await U('GET', '/api/crm/impianti/dafare');
  assert.equal(r2.body.groups.attesa.some(x => x.message_id === 'imp-out-1'), false);
});

test('impostazioni: le cambia solo la direzione', async () => {
  assert.equal((await U('PUT', '/api/crm/impianti/impostazioni', { wait_days: 3 })).status, 403);
  const r = await D('PUT', '/api/crm/impianti/impostazioni', { wait_days: 3, cadence: { fondo: 21 }, sectors: ['biometano', 'xx'] });
  assert.equal(r.body.settings.wait_days, 3);
  assert.equal(r.body.settings.cadence.fondo, 21);
  assert.equal(r.body.settings.cadence.progettista, 45);
  assert.deepEqual(r.body.settings.sectors, ['biometano']);
});

test('Radar: settore sulle carte e filtri salvati separati per Alma Impianti', async () => {
  const b = await U('GET', '/api/crm/radar/board?scope=impianti');
  assert.equal(b.status, 200);
  const sig = b.body.signals.find(s => s.title.startsWith('Biometano 500'));
  assert.equal(sig.sector, 'biometano');
  await U('PUT', '/api/crm/radar/filtri?scope=impianti', { filtri: [{ nome: 'Biometano Sud', filtri: { sector: 'biometano' } }] });
  assert.equal((await U('GET', '/api/crm/radar/board?scope=impianti')).body.filtri[0].nome, 'Biometano Sud');
  assert.deepEqual((await U('GET', '/api/crm/radar/board')).body.filtri, []);
});
