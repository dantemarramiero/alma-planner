// Gare europee da TED (ALM2-49, canvas v14 · V14-TED): lettura degli avvisi (finti), pulizia dei testi, bandi aperti
// ed esiti per un'iniziativa (zona o tutta Italia), vincitori nel CRM, «Porta avanti», fonte e completezza, Impostazioni.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const T = require('../lib/crm-ted');

const inDays = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const NOTICES = [
  { 'publication-number': '100-2026', 'notice-type': 'cn-standard', 'notice-title': { hun: 'Olaszország – x – y', ita: 'Italia – Lavori di installazione di linee elettriche – RIFACIMENTO RETE DI ILLUMINAZIONE PUBBLICA' },
    'buyer-name': { ita: ['COMUNE DI PESCARA'] }, 'organisation-city-buyer': { mul: ['Pescara'] }, 'publication-date': `${inDays(-10)}+01:00`, 'place-of-performance': ['ITF13', 'ITA'],
    'classification-cpv': ['45231400', '71250000'], 'total-value': 6200000, 'estimated-value-lot': ['3100000', '3100000'], 'deadline-receipt-tender-date-lot': [`${inDays(20)}+01:00`, `${inDays(20)}+01:00`] },
  { 'publication-number': '101-2026', 'notice-type': 'cn-standard', 'notice-title': { ita: ['Italia – Impianti elettrici – IMPIANTI DEL NUOVO OSPEDALE &#224; Milano <p>lotto</p>'] },
    'buyer-name': { ita: ['ASST S.A.C. SocietÃÃÃÃÃÂ  Ospedaliera'] }, 'publication-date': `${inDays(-5)}+01:00`, 'place-of-performance': ['ITC4C'], 'classification-cpv': ['45311000'],
    'estimated-value-lot': ['9000000'], 'deadline-receipt-tender-date-lot': [`${inDays(40)}+01:00`] },
  { 'publication-number': '102-2026', 'notice-type': 'cn-standard', 'notice-title': { ita: ['Italia – Linee elettriche – BANDO SCADUTO'] }, 'buyer-name': { ita: ['ENTE'] },
    'publication-date': `${inDays(-90)}+01:00`, 'place-of-performance': ['ITF13'], 'classification-cpv': ['45231400'], 'deadline-receipt-tender-date-lot': [`${inDays(-30)}+01:00`] },
  { 'publication-number': '103-2026', 'notice-type': 'can-standard', 'notice-title': { ita: ['Italia – Linee elettriche – MANUTENZIONE CABINE MT/BT'] }, 'buyer-name': { ita: ['REGIONE MARCHE'] },
    'publication-date': `${inDays(-60)}+01:00`, 'place-of-performance': ['ITI32'], 'classification-cpv': ['45232200'], 'total-value': 7000000,
    'winner-name': { ita: ['ROSSI IMPIANTI SRL', 'BIANCHI SPA'] }, 'winner-identifier': ['IT01234567890', '09876543210'], 'received-submissions-type-val': ['4', '0', '4'] },
  { 'publication-number': '104-2026', 'notice-type': 'veat', 'notice-title': { ita: ['avviso di trasparenza'] }, 'classification-cpv': ['45231400'] },
];
const calls = [];
const fakeTed = async (url, opts) => {
  const body = JSON.parse(opts.body);
  calls.push(body);
  return new Response(JSON.stringify({ notices: body.iterationNextToken ? [] : NOTICES, totalNoticeCount: NOTICES.length, iterationNextToken: body.iterationNextToken ? null : 'tok' }), { status: 200, headers: { 'content-type': 'application/json' } });
};

let server, base, db, D, iniziativa, theApp;
const ADMIN = 'direzione@almacis.it';
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

before(async () => {
  db = await createDb({});
  const { app } = theApp = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db, tedFetch: fakeTed });
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/dev-login?email=${ADMIN}`, { redirect: 'manual' });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  D = (method, path, body) => api(cookie, method, path, body);
  const { rows: [i] } = await db.query(`INSERT INTO crm_initiatives (name, profile, created_by) VALUES ('Reti', $1::jsonb, (SELECT id FROM users LIMIT 1)) RETURNING id`,
    [JSON.stringify({ soa: ['OG10', 'OS30'], regions: ['Abruzzo', 'Marche', 'Molise'] })]);
  iniziativa = i.id;
  await db.query(`INSERT INTO crm_subjects (name, roles, vat, created_by) VALUES ('Rossi Impianti', '{partner}', '01234567890', (SELECT id FROM users LIMIT 1))`);
});
after(async () => { server?.close(); await db?.close(); });

test('categorie → codici CPV, con quelli aggiunti in Impostazioni', () => {
  assert.deepEqual(T.codesFor(['OG10']), ['45231400', '45232200', '45316100']);
  assert.ok(T.codesFor(['OG10'], { concorrenza: { ted_cpv: { OG10: ['45317000'] } } }).includes('45317000'));
  assert.deepEqual(T.codesFor(['OS99']), []);
  assert.equal(T.prefix('45310000'), '4531');
});

test('avvisi: titolo pulito, regioni dal NUTS, offerte, vincitori con P.IVA', () => {
  const [a, b, , d, e] = NOTICES.map(T.toRow);
  assert.equal(a.kind, 'bando');
  assert.equal(a.title, 'RIFACIMENTO RETE DI ILLUMINAZIONE PUBBLICA');
  assert.deepEqual(a.regions, ['Abruzzo']);
  assert.equal(a.value, 6200000);
  assert.equal(a.lots, 2);
  assert.match(b.title, /OSPEDALE à Milano lotto$/);
  assert.match(b.buyer, /Società Ospedaliera/);
  assert.deepEqual(b.regions, ['Lombardia']);
  assert.equal(d.kind, 'esito');
  assert.equal(d.offers, 4);
  assert.deepEqual(d.winners.map(w => w.cf), ['01234567890', '09876543210']);
  assert.equal(e, null);
});

test('prima di caricare: la sezione lo dice', async () => {
  const r = await D('GET', `/api/crm/business/${iniziativa}/mercato/ted`);
  assert.equal(r.status, 200);
  assert.equal(r.body.source.updated_at, null);
});

test('caricamento: tutti i codici delle categorie in uso, 24 mesi, a pagine', async () => {
  const out = await T.syncTed(db, { fetchImpl: fakeTed, log: () => {} });
  assert.equal(out.rows, 4);
  const q = calls[0].query;
  assert.match(q, /place-of-performance IN \(ITA\)/);
  assert.match(q, /45231400/);
  assert.match(q, /45310000/);
  assert.ok(calls.some(c => c.iterationNextToken === 'tok'));
  // la seconda volta solo gli ultimi giorni
  calls.length = 0;
  await T.syncTed(db, { fetchImpl: fakeTed, log: () => {} });
  const since = Number(calls[0].query.match(/publication-date>=(\d{8})/)[1]);
  assert.ok(since >= Number(inDays(-10).replace(/-/g, '')));
});

test('bandi aperti: in zona sono meno di 5, quindi tutta Italia; scaduti fuori', async () => {
  const r = await D('GET', `/api/crm/business/${iniziativa}/mercato/ted`);
  assert.equal(r.status, 200);
  assert.equal(r.body.zone, false);
  assert.equal(r.body.kpi.open, 2);
  assert.deepEqual(r.body.rows.map(x => x.pub), ['100-2026', '101-2026']);
  assert.equal(r.body.rows[0].cpv[0].label, 'linee elettriche');
  const z = await D('GET', `/api/crm/business/${iniziativa}/mercato/ted?zona=1`);
  assert.equal(z.body.zone, true);
  assert.deepEqual(z.body.rows.map(x => x.pub), ['100-2026']);
});

test('esiti: offerte, valore, vincitore riconosciuto nel CRM', async () => {
  const r = await D('GET', `/api/crm/business/${iniziativa}/mercato/ted?vista=esiti`);
  assert.equal(r.body.kpi.awards, 1);
  assert.equal(r.body.kpi.avg_offers, 4);
  const [e] = r.body.rows;
  assert.equal(e.offers, 4);
  assert.equal(e.winners[0].subject.name, 'Rossi Impianti');
  assert.equal(e.winners[1].subject, null);
});

test('«Porta avanti»: il bando ricorda il segnale del radar', async () => {
  const s = await D('POST', '/api/crm/radar/signals', { kind: 'gara', title: 'RIFACIMENTO RETE', entity: 'Comune di Pescara', amount: 6200000 });
  assert.equal(s.status, 201);
  assert.equal((await D('POST', '/api/crm/ted/100-2026/segnale', { signal_id: s.body.id })).status, 200);
  const r = await D('GET', `/api/crm/business/${iniziativa}/mercato/ted`);
  assert.equal(r.body.rows[0].signal_id, s.body.id);
  assert.equal((await D('POST', '/api/crm/ted/nessuno/segnale', { signal_id: s.body.id })).status, 404);
});

test('«Da dove vengono i dati»: TED attiva e completezza degli esiti', async () => {
  const r = await D('GET', `/api/crm/fonti?iniziativa=${iniziativa}`);
  const ted = r.body.sources.find(s => s.key === 'ted');
  assert.equal(ted.status, 'ok');
  assert.equal(r.body.ted_quality.n, 1);
  assert.equal(r.body.ted_quality.fields.find(f => f.key === 'offers').pct, 100);
});

test('Impostazioni: codici CPV in più per TED', async () => {
  const st = await D('GET', '/api/crm/commerciale');
  const conc = st.body.concorrenza || st.body.settings?.concorrenza;
  assert.ok(conc, Object.keys(st.body).join(','));
  const put = await D('PUT', '/api/crm/commerciale/concorrenza', { value: { ...conc, ted_cpv: { og10: ['45317000', 'xx'] } } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const map = await D('GET', '/api/crm/ted/cpv');
  assert.deepEqual(map.body.extra, { OG10: ['45317000'] });
  assert.ok(map.body.map.OG10.includes('45317000'));
  assert.equal((await D('PUT', '/api/crm/commerciale/concorrenza', { value: { ...conc, ted_cpv: { XX1: ['45317000'] } } })).status, 400);
});

// ── v17: avvisi di preinformazione → Radar «Gara in arrivo» ──
test('preinformazione: letta con la data prevista, poi segnale «Gara in arrivo» nella BU, una volta sola', async () => {
  const pin = T.toRow({ 'publication-number': '900-2026', 'notice-type': 'pin-only', 'notice-title': { ita: 'Italia – Impianti elettrici – ACCORDO QUADRO IMPIANTI ELETTRICI SCUOLE' },
    'buyer-name': { ita: ['COMUNE DI CHIETI'] }, 'publication-date': `${inDays(-3)}+01:00`, 'place-of-performance': ['ITF14'], 'classification-cpv': ['45310000'],
    'total-value': 2500000, 'BT-127-notice': [`${inDays(40)}+01:00`] });
  assert.equal(pin.kind, 'preinfo');
  assert.equal(pin.future_on, inDays(40));
  assert.deepEqual(pin.regions, ['Abruzzo']);
  await T.save(db, [pin]);
  const { loadSettings } = require('../lib/crm-commerciale');
  const base = await loadSettings(db);
  const bu = Object.keys(base.profiles).find(k => T.codesFor((base.profiles[k].soa || []), base).some(c => '45310000'.startsWith(T.prefix(c))));
  assert.ok(bu, 'una BU con impianti elettrici');
  const settings = { ...base, radar: { ...base.radar, bu: { [bu]: { on: true } } } };
  const radar = theApp.app.locals.crmRadar;
  assert.equal(await T.tedSignals(db, { settings, radar }), 1);
  const { rows: [g] } = await db.query(`SELECT * FROM crm_signals WHERE source = 'ted' AND external_id = '900-2026'`);
  assert.equal(g.stage, 'determina');
  assert.equal(g.kind, 'preinformazione');
  assert.equal(String(g.expected_on instanceof Date ? g.expected_on.toISOString() : g.expected_on).slice(0, 10), inDays(40));
  assert.equal(await T.tedSignals(db, { settings, radar }), 0);
  const board = await D('GET', '/api/crm/radar/board');
  assert.equal(board.body.signals.find(x => x.id === g.id).column, 'arrivo');
  // le esistenti sezioni TED (bandi ed esiti) non contano la preinformazione
  const r = await D('GET', `/api/crm/business/${iniziativa}/mercato/ted?vista=bandi`);
  assert.ok(!r.body.rows.some(x => x.pub === '900-2026'));
  assert.equal(await T.tedSignals(db, { settings: { ...settings, prima_bando: { ...settings.prima_bando, ted_pin: false } }, radar }), 0);
});
