// SOA delle aziende del CRM da ANAC con la P.IVA (canvas v14, 22/11): collegamento per P.IVA, differenze con le SOA
// a mano e scelta, filtri negli elenchi, azienda sparita da ANAC = scaduta, P.IVA cambiata = SOA trovate subito.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { vatOk } = require('../lib/crm');
const S = require('../lib/crm-soa');
const C = require('../lib/crm-soa-crm');

// P.IVA valide (cifra di controllo giusta) a partire da 10 cifre
const vat = ten => ten + [...'0123456789'].find(d => vatOk(ten + d));
const V1 = vat('0123456789'), V2 = vat('0987654321'), V3 = vat('0555555555');
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const att = (cf, cats, expires) => ({ cf, name: cf, province: 'Pescara', region: 'Abruzzo', soa_name: 'CQOP SOA', issued_on: day(-400), mid_check_on: day(300), expires_on: expires, cats });

let server, base, db, D;
before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'direzione@almacis.it' }), { db });
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/dev-login?email=direzione@almacis.it`, { redirect: 'manual' });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  D = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
});
after(async () => { server?.close(); await db?.close(); });

test('SOA da ANAC sulle aziende del CRM: differenze, scelta, filtri, scadute, P.IVA nuova', async () => {
  const ins = async (name, v, soa = []) => (await db.query("INSERT INTO crm_subjects (name, roles, vat, soa) VALUES ($1, '{partner}', $2, $3::jsonb) RETURNING id", [name, v, JSON.stringify(soa)])).rows[0].id;
  const termo = await ins('Termo Abruzzo', V1, [{ cat: 'OS28', cls: 'III', expires: null }, { cat: 'OS6', cls: 'I', expires: null }]);
  const edil = await ins('Edil Sud', V2);
  const senza = await ins('Studio Rossi', '', [{ cat: 'OS28', cls: 'III', expires: null }]);
  const nuova = await ins('Nuova Srl', '');

  // ANAC non ancora caricato: non si segna niente come «non trovata»
  assert.equal((await C.syncSubjectsSoa(db)).skipped, 'ANAC non ancora caricato');
  await S.save(db, [att(V1, { OS28: 'IV-BIS', OS30: 'III' }, day(500)), att(V2, { OG1: 'V' }, day(40)), att(V3, { OG11: 'II' }, day(500))]);

  // la scheda si collega da sola la prima volta che si apre
  let s = (await D('GET', `/api/crm/subjects/${termo}`)).body;
  assert.equal(s.soa_state, 'valida');
  assert.equal(s.soa_anac.soa_name, 'CQOP SOA');
  assert.deepEqual(s.soa_anac.cats.map(x => `${x.cat} ${x.cls}`), ['OS28 IV-bis', 'OS30 III']);
  assert.deepEqual(s.soa_conflict.differ, [{ cat: 'OS28', mine: 'III', anac: 'IV-bis' }]);
  assert.deepEqual(s.soa_conflict.only_mine, [{ cat: 'OS6', cls: 'I' }]);
  assert.deepEqual(s.soa_effective.map(x => `${x.cat} ${x.cls} ${x.source}`), ['OS28 IV-bis anac', 'OS30 III anac', 'OS6 I mano']);

  // «Tieni anche OS6 I a mano»: restano a mano solo quelle che ANAC non ha, niente più differenze
  s = (await D('POST', `/api/crm/subjects/${termo}/soa-scelta`, { choice: 'aggiungi' })).body;
  assert.deepEqual(s.soa.map(x => x.cat), ['OS6']);
  assert.equal(s.soa_conflict, null);

  // passata su tutte: Edil Sud in scadenza, senza P.IVA niente
  const r = await C.syncSubjectsSoa(db);
  assert.equal(r.found, 2);
  assert.equal((await D('GET', `/api/crm/subjects/${edil}`)).body.soa_state, 'in_scadenza');
  const ss = (await D('GET', `/api/crm/subjects/${senza}`)).body;
  assert.equal(ss.soa_anac, null);
  assert.deepEqual(ss.soa_effective.map(x => x.source), ['mano']);

  // filtri dell'elenco: categoria e classifica minima, solo valide
  const names = async q => (await D('GET', `/api/crm/subjects?role=partner&${q}`)).body.subjects.map(x => x.name).sort();
  assert.deepEqual(await names('soa_cat=OS28&soa_cls=IV'), ['Termo Abruzzo']);
  assert.deepEqual(await names('soa_cat=OS28'), ['Studio Rossi', 'Termo Abruzzo']);
  assert.deepEqual(await names('soa_cat=OS28&soa_cls=V'), []);

  // Termo sparisce da ANAC al ricaricamento: si vede scaduta e non conta più
  await S.save(db, [att(V2, { OG1: 'V' }, day(40)), att(V3, { OG11: 'II' }, day(500))]);
  await C.syncSubjectsSoa(db);
  s = (await D('GET', `/api/crm/subjects/${termo}`)).body;
  assert.equal(s.soa_state, 'scaduta');
  assert.ok(s.soa_effective.find(x => x.cat === 'OS28').expired);
  assert.deepEqual(await names('soa_cat=OS28&soa_valide=1'), ['Studio Rossi']);

  // P.IVA aggiunta dopo: le SOA arrivano subito, con quante sono nella risposta
  const p = await D('PATCH', `/api/crm/subjects/${nuova}`, { vat: V3 });
  assert.equal(p.status, 200);
  assert.equal(p.body.soa_found, 1);

  // differenze per la direzione e «Usa ANAC» per tutte
  await db.query("UPDATE crm_subjects SET soa = $2::jsonb WHERE id = $1", [edil, JSON.stringify([{ cat: 'OG1', cls: 'III', expires: null }])]);
  const d = (await D('GET', '/api/crm/soa/differenze')).body;
  assert.deepEqual(d.subjects.map(x => x.name), ['Edil Sud']);
  await D('POST', '/api/crm/soa/usa-anac', { ids: [edil] });
  assert.deepEqual((await D('GET', `/api/crm/subjects/${edil}`)).body.soa, []);
});
