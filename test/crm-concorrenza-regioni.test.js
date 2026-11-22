// «Concorrenza e gare» · Regioni e Partner (canvas v12, 21/11): «Conviene» per regione di una BU (ribasso sotto la media,
// meno concorrenza, noi vicini), dettaglio della regione con enti e fasce, partner per regione × BU e «Proponi un incontro».
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, D;
const ADMIN = 'direzione@almacis.it';
const as = cookie => async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};
const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
let k = 0;
async function award({ region, discount, bidders, amount = 1e6, winners, sa = ['80000000001', 'COMUNE DI PROVA'], cat = 'OG1' }) {
  k++;
  await db.query(`INSERT INTO crm_anac_awards (cig, object, sa_cf, sa_name, region, province, category, cpv, kind, amount, discount, bidders, awarded_on, winners, month)
    VALUES ($1, 'Lavori', $2, $3, $4, '', $5, '45000000', 'LAVORI', $6, $7, $8, $9, $10, '202606')`,
  [`T${String(k).padStart(9, '0')}`, sa[0], sa[1], region, cat, amount, discount, bidders, day(30 + k), JSON.stringify(winners)]);
}
const solo = (cf, name) => [{ cf, name, role: '' }];
const ati = (a, b) => [{ cf: a[0], name: a[1], role: 'mandataria' }, { cf: b[0], name: b[1], role: 'mandante' }];

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db, crmFetchEvents: async () => [], anacFetch: async () => ({ ok: false, status: 404 }) });
  server = out.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/dev-login?email=${ADMIN}`, { redirect: 'manual' });
  D = as(res.headers.get('set-cookie').split(';')[0]);
  await db.query(`INSERT INTO crm_settings (key, value) VALUES ('profiles', $1), ('concorrenza', $2)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  [JSON.stringify({ edilizia: { soa: ['OG1'], regions: ['Abruzzo'] } }), JSON.stringify({ on: true, months: 24, min_amount: 0, cpv: {}, extra_categories: [], our_cf: ['02222222222'], our_names: [] })]);
  // Abruzzo: ribassi bassi, pochi offerenti, una vinta da noi, ATI di Di Vincenzo con Taddei
  for (let i = 0; i < 8; i++) await award({ region: 'Abruzzo', discount: 14 + i * 0.5, bidders: 5, winners: i === 0 ? solo('02222222222', 'ALMACIS SRL') : i < 4 ? ati(['00114560680', 'DI VINCENZO DINO & C. SPA'], ['09876543210', 'TADDEI SPA']) : solo(`0300000000${i}`, `IMPRESA ABRUZZO ${i}`), sa: i < 5 ? ['80000000001', 'PROVINCIA DI PESCARA'] : ['80000000002', 'ASL TERAMO'] });
  // Lazio: ribassi alti, tanti offerenti, mercato in mano a 1 impresa
  for (let i = 0; i < 10; i++) await award({ region: 'Lazio', discount: 27 + i * 0.4, bidders: 16, amount: 2e6, winners: i < 7 ? solo('04444444444', 'GRANDE COSTRUTTORE SPA') : solo(`0500000000${i}`, `ROMANA ${i}`), sa: ['80000000009', 'ROMA CAPITALE'] });
  // Molise: troppo poche
  for (let i = 0; i < 2; i++) await award({ region: 'Molise', discount: 10, bidders: 3, winners: solo('06666666666', 'EDIL MOLISE') });
  // l'ente di Pescara è nel CRM; Taddei è un concorrente segnato (non compare tra i partner)
  await db.query(`INSERT INTO crm_subjects (name, vat, tax_code, roles, asa) VALUES ('Provincia di Pescara', '', '80000000001', '{cliente}', '{}'), ('Taddei S.p.A.', '09876543210', '', '{concorrente}', '{}')`);
});
after(async () => { server?.close(); await db?.close(); });

test('Regioni: «Conviene» premia ribasso basso, poca concorrenza e vicinanza; poche gare = niente punteggio', async () => {
  const r = await D('GET', '/api/crm/concorrenza/regioni?bu=edilizia');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.regioni.map(x => [x.region, x]));
  assert.equal(r.body.regioni[0].region, 'Abruzzo');
  assert.ok(by.Abruzzo.conviene > by.Lazio.conviene, `${by.Abruzzo.conviene} > ${by.Lazio.conviene}`);
  assert.equal(by.Molise.conviene, null);
  assert.match(by.Molise.perche[0].text, /troppo poche/);
  assert.equal(by.Abruzzo.noi, 1);
  assert.equal(by.Abruzzo.enti, 1);
  assert.ok(by.Lazio.top3 >= 0.7);
  assert.ok(by.Abruzzo.perche.some(p => /sotto la media/.test(p.text) && p.tone === 'gr'));
  assert.ok(by.Lazio.perche.some(p => /in mano a pochi/.test(p.text)));
  assert.equal(r.body.migliori.ribasso.region, 'Abruzzo');
  assert.ok(r.body.bus.includes('edilizia'));

  const d = await D('GET', '/api/crm/concorrenza/regioni/Abruzzo?bu=edilizia');
  assert.equal(d.status, 200);
  assert.equal(d.body.enti[0].name, 'PROVINCIA DI PESCARA');
  assert.equal(d.body.enti[0].subject.name, 'Provincia di Pescara');
  assert.ok(d.body.bands.length >= 1);
  assert.equal(d.body.winners[0].name, 'DI VINCENZO DINO & C. SPA');
  assert.equal((await D('GET', '/api/crm/concorrenza/regioni/Sicilia?bu=edilizia')).status, 404);
});

test('Partner: chi vince in ATI nella regione, senza noi né i concorrenti; «Proponi un incontro» crea scheda e passo', async () => {
  const r = await D('GET', '/api/crm/concorrenza/partner?bu=edilizia&region=Abruzzo');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.partners.map(p => p.name), ['DI VINCENZO DINO & C. SPA']); // Taddei è concorrente, Almacis siamo noi
  const p = r.body.partners[0];
  assert.equal(p.in_ati, 3);
  assert.equal(p.mandataria, 3);
  assert.match(p.perche[0], /3 gare vinte in Abruzzo/);
  assert.equal(r.body.matrix[0].region, 'Abruzzo');
  assert.equal(r.body.matrix[0].cells.edilizia.best.name, 'DI VINCENZO DINO & C. SPA');

  const m = await D('POST', '/api/crm/concorrenza/incontro', { name: 'Di Vincenzo Dino & C. S.p.A.', cf: '00114560680', bu: 'edilizia', region: 'Abruzzo' });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  assert.equal(m.body.created, true);
  const { rows: [s] } = await db.query('SELECT roles, next_step FROM crm_subjects WHERE id = $1', [m.body.subject_id]);
  assert.deepEqual(s.roles, ['partner']);
  assert.match(s.next_step, /Incontro con Di Vincenzo.*partner per edilizia in Abruzzo/);
  // adesso è nel CRM come partner
  const again = await D('GET', '/api/crm/concorrenza/partner?bu=edilizia&region=Abruzzo');
  assert.equal(again.body.partners[0].subject.roles[0], 'partner');
});

test('Impostazioni Concorrenza: le categorie in più tengono la S, i CPV solo le cifre (barre perse, 22/11)', () => {
  const { clean } = require('../lib/crm-commerciale');
  const v = clean('concorrenza', { on: true, months: 24, min_amount: 40000, cpv: { edilizia: ['45214200-3'] }, extra_categories: ['os 28', 'OG1'], our_cf: ['01234567890'], our_names: ['ALMACIS'] }, { asaKeys: ['edilizia'] });
  assert.deepEqual(v.extra_categories, ['OS28', 'OG1']);
  assert.deepEqual(v.cpv.edilizia, ['452142003']);
});

test('filtro Regioni (v17): Chi vince su una o più regioni con il conteggio per regione; Partner solo le regioni scelte', async () => {
  const prof = (await D('GET', '/api/crm/concorrenza?bu=edilizia')).body;
  assert.deepEqual(prof.scope.regions, ['Abruzzo']); // di partenza le zone del profilo
  assert.deepEqual(prof.profile_regions, ['Abruzzo']);
  const counts = Object.fromEntries(prof.region_counts.map(r => [r.region, r.n]));
  assert.equal(counts.Abruzzo, 8);
  assert.equal(counts.Lazio, 10);
  const two = (await D('GET', '/api/crm/concorrenza?bu=edilizia&regions=Lazio,Molise')).body;
  assert.deepEqual(two.scope.regions, ['Lazio', 'Molise']);
  assert.equal(two.kpi.gare, 12);
  assert.equal((await D('GET', '/api/crm/concorrenza?bu=edilizia&regions=tutte')).body.kpi.gare, 20);
  const p = (await D('GET', '/api/crm/concorrenza/partner?bu=edilizia&regions=Abruzzo')).body;
  assert.deepEqual(p.regions, ['Abruzzo']);
  assert.ok(p.region_counts.some(r => r.region === 'Abruzzo'));
  const pl = (await D('GET', '/api/crm/concorrenza/partner?bu=edilizia&regions=Lazio&region=Abruzzo')).body;
  assert.ok(!pl.regions.includes('Abruzzo'));
  assert.notEqual(pl.region, 'Abruzzo');
});
