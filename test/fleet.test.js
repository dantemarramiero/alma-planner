// Parco mezzi: categorie e mezzi (solo gestori), prenotazione per categoria → approvazione con il mezzo → ritiro e
// riconsegna con i km (storico), conflitti e manutenzioni, QR code e segnalazioni (ticket ai gestori, mezzo fermo),
// promemoria di riconsegna e scadenze, multe a chi aveva il mezzo, permessi.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, fleet;
const ADMIN = 'dante@almacis.it';
const users = {};

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(who, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie: users[who].cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const hours = h => new Date(Date.now() + h * 3600000).toISOString();
const notes = async who => (await api(who, 'GET', '/api/notifications')).body.filter(n => n.kind === 'mezzi');

before(async () => {
  db = await createDb({});
  const created = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  fleet = created.fleet;
  server = created.app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of [['admin', ADMIN], ['gestore', 'paola.flotta@almacis.it'], ['anna', 'anna.rossi@almacis.it'], ['luca', 'luca.bianchi@almacis.it']]) {
    users[k] = { cookie: await login(email) };
    users[k].id = (await api(k, 'GET', '/api/me')).body.id;
  }
});

after(async () => {
  server?.closeAllConnections?.();
  server?.close();
  await db?.close();
});

let auto, furgone, panda, golf, ducato;

test('gestori, categorie e mezzi: solo chi gestisce il parco', async () => {
  assert.equal((await api('anna', 'GET', '/api/me')).body.fleet_manager, false);
  assert.equal((await api('admin', 'GET', '/api/me')).body.fleet_manager, true); // gli amministratori gestiscono sempre
  assert.equal((await api('gestore', 'PUT', '/api/mezzi/gestori', { user_ids: [users.gestore.id] })).status, 403);
  const g = await api('admin', 'PUT', '/api/mezzi/gestori', { user_ids: [users.gestore.id] });
  assert.deepEqual(g.body.map(x => x.user_id), [users.gestore.id]);
  assert.equal((await api('gestore', 'GET', '/api/me')).body.fleet_manager, true);

  assert.equal((await api('anna', 'POST', '/api/mezzi/categorie', { name: 'Auto' })).status, 403);
  auto = (await api('gestore', 'POST', '/api/mezzi/categorie', { name: 'Auto', description: 'Auto aziendali' })).body;
  furgone = (await api('gestore', 'POST', '/api/mezzi/categorie', { name: 'Furgoni' })).body;
  assert.equal((await api('gestore', 'POST', '/api/mezzi/categorie', { name: 'auto' })).status, 409);

  assert.equal((await api('anna', 'POST', '/api/mezzi/elenco', { category_id: auto.id, code: 'X' })).status, 403);
  panda = (await api('gestore', 'POST', '/api/mezzi/elenco', { category_id: auto.id, code: 'AUTO-01', plate: 'ab 123cd', make: 'Fiat', model: 'Panda', km: 42000, fuel: 'benzina' })).body;
  assert.equal(panda.plate, 'AB123CD');
  assert.equal(panda.state, 'libero');
  assert.ok(panda.qr_token.length >= 10);
  golf = (await api('gestore', 'POST', '/api/mezzi/elenco', { category_id: auto.id, code: 'AUTO-02', plate: 'EF456GH', make: 'VW', model: 'Golf', km: 10000 })).body;
  ducato = (await api('gestore', 'POST', '/api/mezzi/elenco', { category_id: furgone.id, code: 'FUR-01', plate: 'IJ789KL', make: 'Fiat', model: 'Ducato' })).body;
  assert.equal((await api('gestore', 'POST', '/api/mezzi/elenco', { category_id: auto.id, code: 'auto-01' })).status, 409);
  assert.equal((await api('gestore', 'POST', '/api/mezzi/elenco', { category_id: auto.id, code: 'AUTO-09', plate: 'AB 123 CD' })).status, 409);

  // chi non gestisce vede solo i conteggi per categoria, non l'elenco né i dati riservati
  const o = (await api('anna', 'GET', '/api/mezzi')).body;
  assert.equal(o.manager, false);
  assert.equal(o.vehicles, undefined);
  assert.deepEqual(o.categories.map(c => [c.name, c.total, c.libero]), [['Auto', 2, 2], ['Furgoni', 1, 1]]);
  assert.equal((await api('anna', 'GET', '/api/mezzi/elenco')).status, 403);
  const pub = (await api('anna', 'GET', `/api/mezzi/elenco/${panda.id}`)).body;
  assert.equal(pub.vehicle.telepass, undefined);
  assert.equal(pub.vehicle.qr_token, undefined);
});

let req1;
test('prenotazione per categoria: richiesta → approvazione col mezzo → ritiro → riconsegna con i km', async () => {
  const avail = (await api('anna', 'GET', `/api/mezzi/disponibilita?category_id=${auto.id}&start=${encodeURIComponent(hours(1))}&end=${encodeURIComponent(hours(5))}`)).body;
  assert.equal(avail.free, 2);
  assert.equal(avail.vehicles, undefined); // chi prenota vede solo quanti, non quali

  assert.equal((await api('anna', 'POST', '/api/mezzi/prenotazioni', { category_id: auto.id, start_at: hours(5), end_at: hours(1), purpose: 'x' })).status, 400);
  assert.equal((await api('anna', 'POST', '/api/mezzi/prenotazioni', { category_id: auto.id, start_at: hours(1), end_at: hours(5) })).status, 400); // motivo obbligatorio
  const r = await api('anna', 'POST', '/api/mezzi/prenotazioni', { category_id: auto.id, start_at: hours(0.5), end_at: hours(5), purpose: 'Sopralluogo cantiere Teramo', notes: 'Serve il seggiolino' });
  assert.equal(r.status, 201);
  req1 = r.body;
  assert.equal(req1.status, 'richiesta');
  assert.equal(req1.vehicle_id, null);
  assert.equal(req1.free, 2);

  // il gestore riceve la notifica e vede il contatore
  assert.match((await notes('gestore'))[0].body, /chiede un mezzo «Auto».*Sopralluogo/);
  assert.equal((await api('gestore', 'GET', '/api/badges')).body.mezzi, 1);
  assert.equal((await api('anna', 'GET', '/api/badges')).body.mezzi, 0);

  // solo il gestore approva, e vede i mezzi liberi
  assert.equal((await api('anna', 'POST', `/api/mezzi/prenotazioni/${req1.id}/approva`, { vehicle_id: panda.id })).status, 403);
  const detail = (await api('gestore', 'GET', `/api/mezzi/prenotazioni/${req1.id}`)).body;
  assert.deepEqual(detail.free.map(x => x.code).sort(), ['AUTO-01', 'AUTO-02', 'FUR-01']);
  assert.equal((await api('luca', 'GET', `/api/mezzi/prenotazioni/${req1.id}`)).status, 404); // non è sua
  const ok = await api('gestore', 'POST', `/api/mezzi/prenotazioni/${req1.id}/approva`, { vehicle_id: panda.id, note: 'Chiavi in portineria' });
  assert.equal(ok.body.status, 'approvata');
  assert.equal(ok.body.vehicle_id, panda.id);
  assert.match((await notes('anna'))[0].body, /approvato.*AUTO-01.*Chiavi in portineria/);
  assert.equal((await api('gestore', 'POST', `/api/mezzi/prenotazioni/${req1.id}/approva`, { vehicle_id: golf.id })).status, 409); // già decisa

  // ora per chi prenota c'è un'auto libera in meno
  assert.equal((await api('luca', 'GET', `/api/mezzi/disponibilita?category_id=${auto.id}&start=${encodeURIComponent(hours(1))}&end=${encodeURIComponent(hours(2))}`)).body.free, 1);
  // e il mezzo non si può dare a un'altra richiesta sovrapposta
  const r2 = (await api('luca', 'POST', '/api/mezzi/prenotazioni', { category_id: auto.id, start_at: hours(2), end_at: hours(3), purpose: 'Cliente' })).body;
  const clash = await api('gestore', 'POST', `/api/mezzi/prenotazioni/${r2.id}/approva`, { vehicle_id: panda.id });
  assert.equal(clash.status, 409);
  assert.match(clash.body.error, /già prenotato da Anna Rossi/);
  assert.equal((await api('gestore', 'POST', `/api/mezzi/prenotazioni/${r2.id}/rifiuta`, {})).status, 400); // serve il motivo
  assert.equal((await api('gestore', 'POST', `/api/mezzi/prenotazioni/${r2.id}/rifiuta`, { note: 'Nessuna auto libera, usa il furgone' })).body.status, 'rifiutata');
  assert.match((await notes('luca'))[0].body, /rifiutato.*usa il furgone/);

  // ritiro: solo chi ha prenotato (o il gestore), km non sotto gli ultimi
  assert.equal((await api('luca', 'POST', `/api/mezzi/prenotazioni/${req1.id}/ritiro`, { km: 42010 })).status, 404);
  assert.equal((await api('anna', 'POST', `/api/mezzi/prenotazioni/${req1.id}/ritiro`, { km: 41000 })).status, 400);
  const picked = (await api('anna', 'POST', `/api/mezzi/prenotazioni/${req1.id}/ritiro`, { km: 42010 })).body;
  assert.equal(picked.status, 'in_corso');
  const states = (await api('gestore', 'GET', '/api/mezzi/elenco')).body;
  assert.equal(states.find(x => x.id === panda.id).state, 'in_uso');
  assert.equal(states.find(x => x.id === panda.id).current_user_name, 'Anna Rossi');
  assert.equal(states.find(x => x.id === panda.id).km, 42010);
  assert.equal((await api('anna', 'POST', `/api/mezzi/prenotazioni/${req1.id}/annulla`)).status, 409); // ritirato: va riconsegnato

  // riconsegna con km e nota: storico e km del mezzo aggiornati, nota ai gestori
  assert.equal((await api('anna', 'POST', `/api/mezzi/prenotazioni/${req1.id}/riconsegna`, { km: 42000 })).status, 400);
  const back = (await api('anna', 'POST', `/api/mezzi/prenotazioni/${req1.id}/riconsegna`, { km: 42135, fuel: '1/2', notes: 'Lavaggio da fare' })).body;
  assert.equal(back.status, 'conclusa');
  assert.match((await notes('gestore'))[0].body, /riconsegnato AUTO-01.*Lavaggio da fare/);
  const hist = (await api('gestore', 'GET', `/api/mezzi/storico?vehicle_id=${panda.id}`)).body;
  assert.deepEqual(hist.map(h => [h.requester_name, h.pickup_km, h.return_km]), [['Anna Rossi', 42010, 42135]]);
  const card = (await api('gestore', 'GET', `/api/mezzi/elenco/${panda.id}`)).body;
  assert.equal(card.vehicle.km, 42135);
  assert.equal(card.totals.km_driven, 125);
  assert.equal(card.vehicle.state, 'libero');
  const csv = await api('gestore', 'GET', '/api/mezzi/esporta/storico.csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.body, /AUTO-01;AB123CD;Auto;Anna Rossi/);
});

test('manutenzione: il mezzo non è prenotabile in quei giorni', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const m = await api('gestore', 'POST', `/api/mezzi/elenco/${golf.id}/manutenzioni`, { kind: 'tagliando', start_date: today, supplier: 'Officina Rossi', cost: '180,50', km: 10500 });
  assert.equal(m.status, 201);
  assert.equal((await api('gestore', 'GET', `/api/mezzi/elenco/${golf.id}`)).body.vehicle.state, 'manutenzione');
  const r = (await api('luca', 'POST', '/api/mezzi/prenotazioni', { category_id: auto.id, start_at: hours(1), end_at: hours(2), purpose: 'Riunione' })).body;
  const no = await api('gestore', 'POST', `/api/mezzi/prenotazioni/${r.id}/approva`, { vehicle_id: golf.id });
  assert.equal(no.status, 409);
  assert.match(no.body.error, /manutenzione/);
  await api('gestore', 'PATCH', `/api/mezzi/manutenzioni/${m.body.id}`, { end_date: today });
  // finita oggi: oggi resta in officina; domani è libero
  const tomorrow = new Date(Date.now() + 36 * 3600000).toISOString();
  assert.equal((await api('gestore', 'GET', `/api/mezzi/disponibilita?category_id=${auto.id}&start=${encodeURIComponent(tomorrow)}&end=${encodeURIComponent(new Date(Date.now() + 40 * 3600000).toISOString())}`)).body.free, 2);
  assert.equal((await api('gestore', 'GET', `/api/mezzi/elenco/${golf.id}`)).body.totals.maintenance, 180.5);
  await api('gestore', 'POST', `/api/mezzi/prenotazioni/${r.id}/annulla`);
});

test('QR code: link breve con login, stato del mezzo, ritiro della propria prenotazione, segnalazione → ticket ai gestori', async () => {
  // il link del QR passa dal server: senza sessione porta al login con ritorno al QR
  const anon = await fetch(`${base}/m/${panda.qr_token}`, { redirect: 'manual' });
  assert.equal(anon.status, 302);
  assert.match(anon.headers.get('location'), /\/auth\/login\?returnTo=%2Fm%2F/);
  const logged = await api('anna', 'GET', `/m/${panda.qr_token}`);
  assert.equal(logged.headers.get('location'), `/app#/mezzi/qr/${panda.qr_token}`);
  const svg = await api('gestore', 'GET', `/api/mezzi/${panda.id}/qr.svg`);
  assert.match(svg.body, /<svg/);
  assert.equal((await api('anna', 'GET', `/api/mezzi/${panda.id}/qr.svg`)).status, 403);

  const scan = (await api('luca', 'GET', `/api/mezzi/qr/${panda.qr_token}`)).body;
  assert.equal(scan.vehicle.code, 'AUTO-01');
  assert.equal(scan.vehicle.state, 'libero');
  assert.equal(scan.booking, null);
  assert.equal((await api('luca', 'GET', '/api/mezzi/qr/sbagliato')).status, 404);

  // segnalazione non bloccante: ticket alta priorità ai gestori, legato al mezzo
  const s = await api('luca', 'POST', `/api/mezzi/${panda.id}/segnala`, { title: 'Spia olio accesa', description: 'Da stamattina' });
  assert.equal(s.status, 201);
  const t = (await api('gestore', 'GET', `/api/tickets/${s.body.ticket_id}`)).body;
  assert.equal(t.vehicle_id, panda.id);
  assert.equal(t.priority, 'high');
  assert.deepEqual(t.assignee_ids, [users.gestore.id]);
  assert.match(t.title, /AUTO-01 \(AB123CD\): Spia olio accesa/);
  assert.equal((await api('gestore', 'GET', `/api/mezzi/elenco/${panda.id}`)).body.vehicle.state, 'libero');

  // bloccante: urgente e mezzo subito fuori servizio (nessuno lo prende), poi il gestore lo rimette attivo
  await api('luca', 'POST', `/api/mezzi/${panda.id}/segnala`, { title: 'Freni rumorosi', blocking: true });
  const stopped = (await api('gestore', 'GET', `/api/mezzi/elenco/${panda.id}`)).body;
  assert.equal(stopped.vehicle.state, 'fuori_servizio');
  assert.match(stopped.vehicle.status_note, /Freni rumorosi/);
  assert.equal(stopped.tickets.length, 2);
  assert.equal((await api('anna', 'GET', `/api/mezzi/disponibilita?category_id=${auto.id}&start=${encodeURIComponent(hours(48))}&end=${encodeURIComponent(hours(50))}`)).body.free, 1);
  await api('gestore', 'PATCH', `/api/mezzi/elenco/${panda.id}`, { status: 'attivo' });
  const active = (await api('gestore', 'GET', `/api/mezzi/elenco/${panda.id}`)).body.vehicle;
  assert.equal(active.state, 'libero');
  assert.equal(active.status_note, '');

  // con una prenotazione approvata, dal QR la si vede (e si può ritirare)
  // già iniziata da qualche minuto: il mezzo risulta «prenotato» (prima dell'inizio è ancora «libero»)
  const r = (await api('luca', 'POST', '/api/mezzi/prenotazioni', { category_id: furgone.id, start_at: hours(-0.05), end_at: hours(3), purpose: 'Consegna materiale' })).body;
  await api('gestore', 'POST', `/api/mezzi/prenotazioni/${r.id}/approva`, { vehicle_id: ducato.id });
  const scan2 = (await api('luca', 'GET', `/api/mezzi/qr/${ducato.qr_token}`)).body;
  assert.equal(scan2.booking.id, r.id);
  assert.equal(scan2.vehicle.state, 'prenotato');
  assert.equal((await api('anna', 'GET', `/api/mezzi/qr/${ducato.qr_token}`)).body.booking, null);

  // nuovo QR: il vecchio smette di funzionare
  const fresh = (await api('gestore', 'POST', `/api/mezzi/elenco/${ducato.id}/nuovo-qr`)).body;
  assert.notEqual(fresh.qr_token, ducato.qr_token);
  assert.equal((await api('luca', 'GET', `/api/mezzi/qr/${ducato.qr_token}`)).status, 404);
  ducato = fresh;
  await api('gestore', 'POST', `/api/mezzi/prenotazioni/${r.id}/annulla`);
});

test('promemoria di riconsegna: un\'ora prima a chi ha il mezzo, in ritardo anche ai gestori, una volta sola', async () => {
  const r = (await api('anna', 'POST', '/api/mezzi/prenotazioni', { category_id: furgone.id, start_at: hours(0.1), end_at: hours(0.75), purpose: 'Banca' })).body;
  await api('gestore', 'POST', `/api/mezzi/prenotazioni/${r.id}/approva`, { vehicle_id: ducato.id });
  await api('anna', 'POST', `/api/mezzi/prenotazioni/${r.id}/ritiro`, { km: 900 });
  const before = (await notes('anna')).length;
  await fleet.remindReturns();
  await fleet.remindReturns(); // il secondo giro non ripete
  const after1 = await notes('anna');
  assert.equal(after1.length, before + 1);
  assert.match(after1[0].body, /Tra meno di un'ora riconsegni FUR-01 .*Ducato/);
  assert.match((await notes('gestore'))[0].body, /FUR-01 .* rientra .* da Anna Rossi/);

  // in ritardo (simulato: fine 2 ore fa)
  await db.query("UPDATE vehicle_bookings SET end_at = now() - interval '2 hours', start_at = now() - interval '5 hours' WHERE id = $1", [r.id]);
  await fleet.remindReturns();
  await fleet.remindReturns();
  assert.match((await notes('anna'))[0].body, /Riconsegna in ritardo: FUR-01 .*Ducato andava riportato/);
  assert.match((await notes('gestore'))[0].body, /Anna Rossi non ha ancora riconsegnato FUR-01/);
  assert.equal((await notes('anna')).filter(n => /in ritardo/.test(n.body)).length, 1);
  // chi è in ritardo tiene occupato il mezzo: niente nuove prenotazioni sopra
  assert.equal((await api('gestore', 'GET', '/api/mezzi')).body.counts.late, 1);
  const r2 = (await api('luca', 'POST', '/api/mezzi/prenotazioni', { category_id: furgone.id, start_at: hours(0.1), end_at: hours(1), purpose: 'Posta' })).body;
  const blocked = await api('gestore', 'POST', `/api/mezzi/prenotazioni/${r2.id}/approva`, { vehicle_id: ducato.id });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /non è ancora stato riconsegnato da Anna Rossi/);
  await api('gestore', 'POST', `/api/mezzi/prenotazioni/${r2.id}/annulla`);
  await api('anna', 'POST', `/api/mezzi/prenotazioni/${r.id}/riconsegna`, { km: 950 });
});

test('scadenze: avviso alla soglia giusta, scaduta, a km, fatta con la successiva', async () => {
  // date contate dal giorno del giro dei promemoria (le 10:00 UTC di oggi), così non si scavalca la mezzanotte
  const inDays = n => { const d = new Date(); d.setUTCHours(10, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const bollo = (await api('gestore', 'POST', `/api/mezzi/elenco/${panda.id}/scadenze`, { kind: 'bollo', due_date: inDays(5), repeat_months: 12 })).body;
  await api('gestore', 'POST', `/api/mezzi/elenco/${golf.id}/scadenze`, { kind: 'revisione', due_date: inDays(-3) });
  await api('gestore', 'POST', `/api/mezzi/elenco/${panda.id}/scadenze`, { kind: 'tagliando', due_km: 42800 });
  assert.equal((await api('gestore', 'POST', `/api/mezzi/elenco/${panda.id}/scadenze`, { kind: 'altro' })).status, 400);
  // il gestore riceve: bollo tra 5 giorni (soglia dei 7, non anche quella dei 30), revisione scaduta, tagliando a 665 km
  const noon = new Date(); noon.setUTCHours(10, 0, 0, 0);
  await fleet.remindDeadlines(noon);
  await fleet.remindDeadlines(noon);
  const got = (await notes('gestore')).map(n => n.body);
  assert.equal(got.filter(b => /Bollo di AUTO-01/.test(b)).length, 1);
  assert.ok(got.some(b => /Bollo di AUTO-01 .*Panda scade il .* \(tra 5 giorni\)/.test(b)), got.join('\n'));
  assert.ok(got.some(b => /Revisione di AUTO-02 .*Golf scaduta il/.test(b)), got.join('\n'));
  assert.ok(got.some(b => /Tagliando di AUTO-01 .*Panda a 42\.800 km: mancano 665 km/.test(b)), got.join('\n'));
  // in elenco «da guardare» del cruscotto
  assert.equal((await api('gestore', 'GET', '/api/mezzi')).body.deadlines.length, 3);
  // fatta: si chiude e nasce la prossima
  const done = (await api('gestore', 'POST', `/api/mezzi/scadenze/${bollo.id}/fatta`, { next_due_date: inDays(370) })).body;
  assert.ok(done.done.done_at);
  assert.equal(done.next.kind, 'bollo');
  assert.equal(done.next.repeat_months, 12);
  assert.equal((await api('gestore', 'POST', `/api/mezzi/scadenze/${bollo.id}/fatta`, {})).status, 409);
});

test('costi: la multa va a chi aveva il mezzo in quel momento', async () => {
  // Anna aveva la Panda (prenotazione conclusa del primo test): una multa durante quell'uso
  const { rows: [b] } = await db.query("SELECT picked_up_at, returned_at FROM vehicle_bookings WHERE vehicle_id = $1 AND status = 'conclusa' ORDER BY id LIMIT 1", [panda.id]);
  const during = new Date((new Date(b.picked_up_at).getTime() + new Date(b.returned_at).getTime()) / 2).toISOString();
  const who = (await api('gestore', 'GET', `/api/mezzi/elenco/${panda.id}/chi-guidava?at=${encodeURIComponent(during)}`)).body;
  assert.equal(who.name, 'Anna Rossi');
  const fine = (await api('gestore', 'POST', `/api/mezzi/elenco/${panda.id}/costi`, { kind: 'multa', occurred_at: during, amount: '42', description: 'Divieto di sosta' })).body;
  assert.equal(fine.driver_id, users.anna.id);
  assert.ok(fine.booking_id);
  await api('gestore', 'POST', `/api/mezzi/elenco/${panda.id}/costi`, { kind: 'carburante', occurred_at: new Date().toISOString(), amount: 65.3, liters: '35,2', km: 42200 });
  const card = (await api('gestore', 'GET', `/api/mezzi/elenco/${panda.id}`)).body;
  assert.equal(card.totals.costs, 107.3);
  assert.equal(card.vehicle.km, 42200);
  assert.equal((await api('anna', 'POST', `/api/mezzi/elenco/${panda.id}/costi`, { kind: 'carburante', occurred_at: new Date().toISOString(), amount: 1 })).status, 403);
  const csv = (await api('gestore', 'GET', '/api/mezzi/esporta/costi.csv')).body;
  assert.match(csv, /multa;[^;]*;42,00;;;Anna Rossi;Divieto di sosta/);
  assert.match(csv, /carburante;[^;]*;65,30;42200;35,20;/);
});

test('uso diretto dal gestore, planner, cancellare e dismettere', async () => {
  const u = await api('gestore', 'POST', '/api/mezzi/uso-diretto', { vehicle_id: ducato.id, user_id: users.luca.id, end_at: hours(4), km: 1000 });
  assert.equal(u.status, 201);
  assert.equal(u.body.status, 'in_corso');
  assert.match((await notes('luca'))[0].body, /ti ha consegnato FUR-01/);
  const from = new Date(Date.now() - 86400000).toISOString(), to = new Date(Date.now() + 6 * 86400000).toISOString();
  const plan = (await api('gestore', 'GET', `/api/mezzi/planner?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).body;
  assert.ok(plan.bookings.some(b => b.vehicle_id === ducato.id && b.status === 'in_corso'));
  assert.ok(plan.maintenance.some(m => m.vehicle_id === golf.id));
  assert.equal((await api('anna', 'GET', `/api/mezzi/planner?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).status, 403);

  // un mezzo con storico non si cancella: si dismette, e sparisce dai conteggi
  assert.equal((await api('gestore', 'DELETE', `/api/mezzi/elenco/${panda.id}`)).status, 409);
  await api('gestore', 'PATCH', `/api/mezzi/elenco/${panda.id}`, { status: 'dismesso' });
  assert.equal((await api('anna', 'GET', '/api/mezzi')).body.categories.find(c => c.name === 'Auto').total, 1);
  const nuovo = (await api('gestore', 'POST', '/api/mezzi/elenco', { category_id: furgone.id, code: 'FUR-99' })).body;
  assert.equal((await api('gestore', 'DELETE', `/api/mezzi/elenco/${nuovo.id}`)).status, 200);
  assert.equal((await api('gestore', 'DELETE', `/api/mezzi/categorie/${auto.id}`)).status, 409);
  // km che scendono: solo con la correzione esplicita
  assert.equal((await api('gestore', 'PATCH', `/api/mezzi/elenco/${golf.id}`, { km: 5 })).status, 400);
  assert.equal((await api('gestore', 'PATCH', `/api/mezzi/elenco/${golf.id}`, { km: 5, km_correction: true })).body.km, 5);
});

test('le mie prenotazioni: ognuno vede solo le sue', async () => {
  const mine = (await api('anna', 'GET', '/api/mezzi/prenotazioni?scope=all')).body;
  assert.ok(mine.length > 0);
  assert.ok(mine.every(b => b.requester_id === users.anna.id));
  const all = (await api('gestore', 'GET', '/api/mezzi/prenotazioni')).body;
  assert.ok(all.some(b => b.requester_id === users.luca.id));
});

test('senza gestori nominati: richieste e promemoria vanno agli amministratori', async () => {
  await api('admin', 'PUT', '/api/mezzi/gestori', { user_ids: [] });
  assert.equal((await api('gestore', 'GET', '/api/me')).body.fleet_manager, false);
  const before = (await notes('admin')).length;
  await api('luca', 'POST', '/api/mezzi/prenotazioni', { category_id: furgone.id, start_at: hours(30), end_at: hours(32), purpose: 'Fiera' });
  const after = await notes('admin');
  assert.equal(after.length, before + 1);
  assert.match(after[0].body, /chiede un mezzo «Furgoni»/);
  assert.equal((await api('admin', 'GET', '/api/badges')).body.mezzi, 1);
});
