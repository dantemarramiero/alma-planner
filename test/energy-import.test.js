// Alma Energy: import dello screening tetti e del Database Conto Energia, pipeline a kanban, «Porta in pipeline»
// e scadenze. I file Excel di prova si costruiscono qui, con le stesse colonne dei file veri della BU Energy.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { readXlsx } = require('../lib/xlsx');

// ── un .xlsx minimo: zip senza compressione con workbook, relazioni e un foglio per nome ──────────
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = i => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
function sheetXml(rows) {
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${
    rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (v === null || v === undefined ? ''
      : typeof v === 'number' ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>`
        : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`)).join('')}</row>`).join('')}</sheetData></worksheet>`;
}
function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, data);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}
function xlsx(sheets) {
  const names = Object.keys(sheets);
  const files = {
    'xl/workbook.xml': `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  };
  names.forEach((n, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheets[n]); });
  return zip(files);
}

const SCREENING_HEAD = ['Rank', 'Priorità', 'Punteggio', 'Punti taglia', 'Punti profilo', 'Profilo consumi', 'Azienda', 'Attività', 'Giorni/sett', 'Turni',
  'Motivazione profilo', 'Confidenza', 'Provincia', 'Comune', 'Area produttiva', 'Superficie tetto (m²)', 'kWp stimati', 'kWh/kWp anno', 'MWh/anno',
  'Capex indicativo (k€)', 'Ricavi lordi (k€/anno)', 'FV già mappato OSM', 'Fonte', 'Vista satellite', 'Lat', 'Lon', 'ID OSM'];
const screening = rows => xlsx({ Ipotesi: [['Screening tetti']], Edifici: [SCREENING_HEAD, ...rows] });
const building = (rank, prio, score, azienda, comune, mq, osm) => [rank, prio, score, 50, score - 50, azienda ? 'D1' : 'ND', azienda, 'Stabilimento', 7, '24/7', 'Ciclo continuo',
  'alta', 'Chieti', comune, 'Zona industriale', mq, mq * 0.12, 1329, mq * 0.16, mq * 0.09, mq * 0.016, 'No', 'OSM', 'Apri', 42.06, 14.75, osm];

const CE_HEAD = ['N.', 'Priorità', 'Convenzione GSE', 'Proprietario', 'P.IVA', 'Provincia (sede)', 'Regione (sede)', 'Tipo di proprietario', 'Classe di incasso',
  ...[2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map(y => `Incasso ${y} €`), 'Incasso medio 2016-2019 €', 'Incasso medio 2023-2025 €',
  'Variazione', 'Incassi persi €/anno', 'Andamento', 'Note', 'Note', 'Ultimo cambio proprietà', 'Proprietario precedente'];
const conv = (n, prio, id, owner, vat, lost, note = '', note2 = null) => [n, prio, id, owner, vat, 'Chieti', 'Abruzzo', 'Industriale', '60.000-400.000 €',
  200000, 210000, 205000, 200000, 190000, 180000, 170000, 160000, 150000, 140000, 203750, 150000, -0.26, lost, 'Progressivo', note, note2, null, null];
const database = rows => xlsx({ Impianti: [['IMPIANTI fotovoltaici italiani incentivati in Conto Energia'], ['Un impianto per riga'], CE_HEAD, ...rows] });

// ── server di prova ──────────────────────────────────────────────────────────────────────────
let server, base, db, cookie;
async function api(method, path, body, { raw = false, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'X-Alma': '1', ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : {}), ...headers },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0' }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/dev-login?email=dante.marramiero@almacis.it`, { redirect: 'manual' });
  cookie = res.headers.get('set-cookie').split(';')[0];
});
after(async () => {
  server?.close();
  await db?.close();
});

test('lettore xlsx: fogli, celle vuote e testo con caratteri speciali', () => {
  const book = readXlsx(xlsx({ Uno: [['a', null, 3], ['Società & Co. <x>', 1.5]], Due: [['solo']] }));
  assert.deepEqual(Object.keys(book), ['Uno', 'Due']);
  assert.deepEqual(book.Uno[0], ['a', null, 3]);
  assert.equal(book.Uno[1][0], 'Società & Co. <x>');
  assert.throws(() => readXlsx(Buffer.from('non un excel')), /xlsx/);
});

test('screening tetti: anteprima, import (una opportunità per edificio, aziende nel CRM) e reimport senza doppioni', async () => {
  const file = screening([
    building(1, 'A', 100, 'Pilkington Italia S.p.A.', 'San Salvo', 175949, 'w97981587'),
    building(2, 'A', 95, 'Pilkington Italia S.p.A.', 'San Salvo', 50000, 'w111'), // stessa azienda, secondo edificio
    building(190, 'B', 65, null, 'Teramo', 67467, 'w845265146'), // azienda non identificata
  ]);
  const prev = (await api('POST', '/api/energy/import/screening/anteprima', file, { raw: true })).body;
  assert.deepEqual([prev.total, prev.new, prev.withCompany], [3, 3, 2]);
  const done = (await api('POST', '/api/energy/import/screening', file, { raw: true, headers: { 'X-File-Name': encodeURIComponent('Screening tetti.xlsx') } })).body;
  assert.deepEqual([done.created, done.companiesCreated], [3, 1]);

  const { opportunities } = (await api('GET', '/api/energy/opportunities?kind=ppa_onsite')).body;
  const pilk = opportunities.find(o => o.title === 'Pilkington Italia S.p.A.' && Number(o.mw) > 20);
  assert.ok(pilk);
  assert.equal(pilk.stage, 'da_qualificare');
  assert.equal(pilk.region, 'Abruzzo');
  assert.ok(opportunities.some(o => o.title.startsWith('Capannone Teramo') && !o.company_name));
  const card = (await api('GET', `/api/energy/opportunities/${pilk.id}`)).body;
  assert.equal(card.data.profilo, 'D1');
  assert.equal(card.links[0].role, 'cliente');

  // reimport: aggiorna i dati, non tocca stadio e nome cambiati a mano
  await api('POST', `/api/energy/opportunities/${pilk.id}/stage`, { stage: 'primo_contatto' });
  await api('PATCH', `/api/energy/opportunities/${pilk.id}`, { title: 'Pilkington – tetto grande' });
  const again = (await api('POST', '/api/energy/import/screening', file, { raw: true })).body;
  assert.deepEqual([again.created, again.updated, again.companiesCreated], [0, 3, 0]);
  const after = (await api('GET', `/api/energy/opportunities/${pilk.id}`)).body;
  assert.deepEqual([after.stage, after.title], ['primo_contatto', 'Pilkington – tetto grande']);
  assert.ok((await api('GET', '/api/energy/imports')).body.some(i => i.kind === 'screening_tetti' && i.file_name === 'Screening tetti.xlsx'));

  assert.equal((await api('POST', '/api/energy/import/screening', xlsx({ Altro: [['x']] }), { raw: true })).status, 400);
  assert.equal((await api('POST', '/api/energy/import/screening', Buffer.from('ciao'), { raw: true })).status, 400);
});

test('Database CE: convenzioni nel database, in pipeline un\'opportunità per proprietario con almeno una A o B', async () => {
  const file = database([
    conv(1, 'A', '603836', 'ENERVITABIO SANTA REPARATA S.R.L.', '01130710955', 100000, 'Proprietario con più convenzioni: valutare acquisto in blocco; Incassi 2023-2025 inferiori del 39% rispetto al 2016-2019, molto più della media della zona: possibile sottoperformance'),
    conv(7, 'D', '603352', 'ENERVITABIO SANTA REPARATA S.R.L.', '01130710955', -5000, 'Proprietario non energetico: impianto non strategico'),
    conv(20, 'C', '700001', 'SOLARE SPA', '02222222222', 30000, 'Proprietario in liquidazione: possibile vendita a sconto', 'Verificare la causa'),
    conv(21, 'B', '700002', 'SENZA PARTITA IVA SRL', '', 20000),
    conv(22, 'Dati insufficienti', '700003', 'ALTRO SRL', '03333333333', null),
  ]);
  const prev = (await api('POST', '/api/energy/import/database-ce/anteprima', file, { raw: true })).body;
  assert.deepEqual([prev.total, prev.owners, prev.ownersToPipeline], [5, 4, 2]);
  const done = (await api('POST', '/api/energy/import/database-ce', file, { raw: true })).body;
  assert.equal(done.opportunities, 2);

  const { opportunities } = (await api('GET', '/api/energy/opportunities?kind=revamping')).body;
  assert.deepEqual(opportunities.map(o => o.title).sort(), ['ENERVITABIO SANTA REPARATA S.R.L. (2 convenzioni)', 'SENZA PARTITA IVA SRL']);
  const ener = opportunities.find(o => o.title.startsWith('ENERVITABIO'));
  const card = (await api('GET', `/api/energy/opportunities/${ener.id}`)).body;
  assert.equal(card.priority, 'A');
  assert.equal(card.conventions.length, 2); // anche la convenzione D del proprietario
  assert.equal(card.data.incassi_persi, 100000); // la D che incassa di più non compensa
  assert.deepEqual(card.data.segnali.sort(), ['acquisto_blocco', 'non_strategico', 'sottoperformance']);
  assert.equal(card.data.incassi['2016'], 400000);
  assert.equal(card.links[0].company_name, 'ENERVITABIO SANTA REPARATA S.R.L.');
  assert.deepEqual((await api('GET', `/api/energy/companies/${card.company_id}`)).body.types, ['proprietario']);

  // database: filtri e «Porta in pipeline» per un proprietario rimasto fuori
  const db1 = (await api('GET', '/api/energy/conventions?in_pipeline=0&sort=incassi_persi')).body;
  assert.deepEqual([db1.total, db1.conventions[0].owner_name], [2, 'SOLARE SPA']);
  assert.deepEqual(db1.conventions[0].signals, ['in_liquidazione']);
  assert.equal((await api('GET', '/api/energy/conventions?signal=sottoperformance')).body.total, 1);
  assert.equal((await api('GET', '/api/energy/conventions?q=01130710955')).body.owners, 1);
  const moved = (await api('POST', '/api/energy/conventions/pipeline', { owners: [db1.conventions[0].owner_key] })).body;
  assert.equal(moved.opportunities, 1);
  assert.equal((await api('GET', '/api/energy/conventions?in_pipeline=0')).body.total, 1);
  assert.equal((await api('POST', '/api/energy/conventions/pipeline', { owners: [] })).status, 400);

  // reimport: niente doppioni, stadio conservato
  await api('POST', `/api/energy/opportunities/${ener.id}/stage`, { stage: 'contatto' });
  const again = (await api('POST', '/api/energy/import/database-ce', file, { raw: true })).body;
  assert.deepEqual([again.opportunities, again.summary.updated], [0, 5]);
  assert.equal((await api('GET', '/api/energy/opportunities?kind=revamping')).body.opportunities.length, 3);
  assert.equal((await api('GET', `/api/energy/opportunities/${ener.id}`)).body.stage, 'contatto');
});

test('revamping: staccare una convenzione in un\'opportunità sua, strategia e reimport che non la riattacca', async () => {
  const { opportunities } = (await api('GET', '/api/energy/opportunities?kind=revamping&q=ENERVITABIO')).body;
  const parent = opportunities[0];
  await api('POST', `/api/energy/opportunities/${parent.id}/links`, { person_id: (await api('POST', '/api/energy/people', { last_name: 'Sanna' })).body.id, role: 'referente' });
  const r = await api('POST', '/api/energy/conventions/603352/stacca', {});
  assert.equal(r.status, 201);
  const child = (await api('GET', `/api/energy/opportunities/${r.body.id}`)).body;
  assert.equal(child.title, 'ENERVITABIO SANTA REPARATA S.R.L. – convenzione 603352');
  assert.equal(child.stage, 'contatto'); // lo stadio dell'opportunità da cui viene
  assert.deepEqual(child.conventions.map(c => c.convention), ['603352']);
  assert.equal(child.priority, 'D');
  assert.deepEqual(child.links.map(l => l.role).sort(), ['proprietario', 'referente']);
  const after = (await api('GET', `/api/energy/opportunities/${parent.id}`)).body;
  assert.equal(after.title, 'ENERVITABIO SANTA REPARATA S.R.L.'); // «(2 convenzioni)» tolto: ne resta una
  assert.equal(after.conventions.length, 1);
  assert.equal(after.history[0].note, 'Staccata la convenzione 603352');
  // l'ultima convenzione non si stacca
  assert.equal((await api('POST', '/api/energy/conventions/603836/stacca', {})).status, 400);
  assert.equal((await api('POST', '/api/energy/conventions/999/stacca', {})).status, 404);

  // reimport: la convenzione staccata resta nella sua opportunità
  const file = database([
    conv(1, 'A', '603836', 'ENERVITABIO SANTA REPARATA S.R.L.', '01130710955', 100000),
    conv(7, 'D', '603352', 'ENERVITABIO SANTA REPARATA S.R.L.', '01130710955', -5000),
  ]);
  await api('POST', '/api/energy/import/database-ce', file, { raw: true });
  assert.deepEqual((await api('GET', `/api/energy/opportunities/${r.body.id}`)).body.conventions.map(c => c.convention), ['603352']);
  assert.equal((await api('GET', `/api/energy/opportunities/${parent.id}`)).body.conventions.length, 1);

  // strategia: nel dato dell'opportunità, filtro nel kanban
  await api('PATCH', `/api/energy/opportunities/${child.id}`, { data: { strategia: 'rivendita', tipo_offerta: 'acquisto' } });
  const board = (await api('GET', '/api/energy/pipeline/revamping?strategia=rivendita')).body;
  const cards = board.stages.flatMap(s => s.cards);
  assert.deepEqual(cards.map(c => [c.id, c.strategia]), [[child.id, 'rivendita']]);
});

test('kanban: colonne per stadio con conteggi, schede in ordine di priorità e filtri', async () => {
  const ppa = (await api('GET', '/api/energy/pipeline/ppa_onsite')).body;
  assert.deepEqual(ppa.stages.map(s => s.key).slice(0, 2), ['da_qualificare', 'primo_contatto']);
  const first = ppa.stages[0];
  assert.equal(first.count, 2);
  assert.deepEqual(first.cards.map(c => c.priority), ['A', 'B']);
  assert.ok(ppa.stages.find(s => s.key === 'primo_contatto').mw > 20);
  assert.equal((await api('GET', '/api/energy/pipeline/ppa_onsite?priority=B')).body.stages[0].count, 1);
  assert.equal((await api('GET', '/api/energy/pipeline/ppa_onsite?q=teramo')).body.stages[0].count, 1);
  const rev = (await api('GET', '/api/energy/pipeline/revamping?signal=in_liquidazione')).body;
  assert.equal(rev.stages.reduce((s, x) => s + x.count, 0), 1);
  assert.equal((await api('GET', '/api/energy/pipeline/nessuna')).status, 400);
});

test('PPA on-site: dall\'analisi dei consumi in poi serve la persona di riferimento', async () => {
  const opp = (await api('POST', '/api/energy/opportunities', { kind: 'ppa_onsite', title: 'Capannone di prova' })).body;
  const r = await api('POST', `/api/energy/opportunities/${opp.id}/stage`, { stage: 'analisi_consumi' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /persona di riferimento/);
  assert.equal((await api('POST', `/api/energy/opportunities/${opp.id}/stage`, { stage: 'sopralluogo' })).status, 200);
  assert.equal((await api('POST', `/api/energy/opportunities/${opp.id}/stage`, { stage: 'perso', lost_reason: 'Tetto in amianto' })).status, 200);
  const p = (await api('POST', '/api/energy/people', { last_name: 'Verdi' })).body;
  await api('POST', `/api/energy/opportunities/${opp.id}/links`, { person_id: p.id, role: 'referente' });
  // riaprire da «Persa» chiede la motivazione (come in BOSS)
  assert.equal((await api('POST', `/api/energy/opportunities/${opp.id}/stage`, { stage: 'analisi_consumi' })).status, 400);
  assert.equal((await api('POST', `/api/energy/opportunities/${opp.id}/stage`, { stage: 'analisi_consumi', note: 'Il cliente ci ha ricontattati' })).status, 200);
});

test('FV classico: dati autorizzativi nel dato dell\'opportunità e scadenze in arrivo', async () => {
  const o = (await api('POST', '/api/energy/opportunities', { kind: 'fv_classico', title: 'Agrivoltaico Lanciano', mw: 12 })).body;
  assert.equal(o.stage, 'proposta');
  const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const later = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);
  await api('PATCH', `/api/energy/opportunities/${o.id}`, { data: { regime: 'PAS', ente: 'Comune di Lanciano', scadenze: [
    { label: 'Opzione sul terreno', date: soon }, { label: 'Validità del titolo', date: later }, { label: 'Fatta', date: soon, done: true }] } });
  await api('PATCH', `/api/energy/opportunities/${o.id}`, { data: { mw_immissione: 10 } }); // i dati si uniscono, non si sostituiscono
  const card = (await api('GET', `/api/energy/opportunities/${o.id}`)).body;
  assert.deepEqual([card.data.regime, card.data.mw_immissione], ['PAS', 10]);
  const s = (await api('GET', '/api/energy/scadenze?days=90')).body;
  assert.deepEqual(s.map(x => x.label), ['Opzione sul terreno']);
  assert.equal((await api('GET', '/api/energy/scadenze?days=500')).body.length, 2);
});

test('mappa: punti dove ci sono le coordinate (screening), regioni per chi non le ha (Database CE), filtri del kanban', async () => {
  const ppa = (await api('GET', '/api/energy/map/ppa_onsite')).body;
  assert.ok(ppa.points.length >= 2);
  assert.ok(ppa.points.every(p => typeof p.lat === 'number' && typeof p.lon === 'number'));
  assert.equal((await api('GET', '/api/energy/map/ppa_onsite?priority=B')).body.points.length, 1);
  const rev = (await api('GET', '/api/energy/map/revamping')).body;
  assert.equal(rev.points.length, 0);
  assert.ok(rev.regions.some(r => r.region === 'Abruzzo' && r.count >= 1));
  assert.equal((await api('GET', '/api/energy/map/nessuno')).status, 400);
});
