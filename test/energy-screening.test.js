// Alma Energy: screening dei tetti per provincia (ALM2-23) con OpenStreetMap e PVGIS finti. Edifici sopra la
// superficie minima, azienda dal nome dell'edificio o dell'area, profilo dai tag, producibilità per cella, punteggio
// con i parametri dei tier; rifarlo non duplica e tiene il profilo corretto a mano.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { parseOverpass, ring } = require('../lib/energy-osm');
const { cellOf } = require('../lib/energy-screening');

// quadrato di `side` metri con l'angolo in basso a sinistra in (lat, lon)
function square(lat, lon, side) {
  const dlat = side / 110540, dlon = side / (111320 * Math.cos((lat * Math.PI) / 180));
  return [{ lat, lon }, { lat, lon: lon + dlon }, { lat: lat + dlat, lon: lon + dlon }, { lat: lat + dlat, lon }, { lat, lon }];
}
const bounds = g => ({ minlat: Math.min(...g.map(p => p.lat)), maxlat: Math.max(...g.map(p => p.lat)), minlon: Math.min(...g.map(p => p.lon)), maxlon: Math.max(...g.map(p => p.lon)) });
const way = (id, tags, g) => ({ type: 'way', id, tags, bounds: bounds(g), geometry: g });

const gA = square(42.40, 14.10, 100); // 10.000 m², supermercato con nome
const gB = square(42.45, 14.20, 54.78); // ~3.000 m², senza nome, dentro l'area «Fater»
const gC = square(42.46, 14.21, 30); // 900 m²: sotto la soglia
const OSM = {
  elements: [
    way(1, { building: 'retail', name: 'Conad Superstore', shop: 'supermarket', 'addr:city': 'Pescara' }, gA),
    way(2, { building: 'industrial' }, gB),
    way(3, { building: 'industrial', name: 'Piccola Srl' }, gC),
    way(4, { building: 'yes' }, square(42.30, 13.90, 60)), // 3.600 m² in campagna, senza nome: fuori
    { type: 'way', id: 10, tags: { landuse: 'industrial', name: 'Fater' }, bounds: { minlat: 42.44, maxlat: 42.47, minlon: 14.19, maxlon: 14.22 } },
    { type: 'node', id: 20, lat: 42.4502, lon: 14.2003, tags: { 'generator:source': 'solar', power: 'generator' } },
    { type: 'node', id: 30, lat: 42.455, lon: 14.205, tags: { place: 'town', name: 'Cepagatti' } },
  ],
};

let server, base, db, cookie, screening;
const calls = { overpass: 0, pvgis: 0 };
let gate = null; // promessa che trattiene la risposta di OpenStreetMap
async function fakeFetch(url) {
  if (url.includes('overpass')) {
    calls.overpass++;
    if (gate) await gate;
    // il primo server è pieno: si passa al successivo
    if (url.startsWith('https://overpass-api.de')) return new Response('# 502 Gateway Timeout', { status: 502 });
    return new Response(JSON.stringify(OSM), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('PVcalc')) {
    calls.pvgis++;
    // il centro della cella del supermercato cade in mare: risponde solo il punto dell'edificio
    if (url.includes('lat=42.5&lon=14.1')) return new Response(JSON.stringify({ message: 'Location over the sea', status: 400 }), { status: 400 });
    return new Response(JSON.stringify({ outputs: { totals: { fixed: { E_y: 1300 } } } }), { status: 200 });
  }
  throw new Error(`chiamata inattesa: ${url}`);
}
async function api(method, url, body) {
  const res = await fetch(base + url, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

before(async () => {
  db = await createDb({});
  let app;
  ({ app, energyScreening: screening } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0' }), { db, energyFetch: fakeFetch }));
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

test('OpenStreetMap: superficie, azienda dall\'edificio o dall\'area, profilo, comune, FV già sul tetto', () => {
  assert.ok(Math.abs(ring(gA).area - 10000) < 5);
  const rows = parseOverpass(OSM, { minArea: 2000 });
  assert.deepEqual(rows.map(r => r.key), ['w1', 'w2']);
  const [a, b] = rows;
  assert.deepEqual([a.company, a.profilo, a.city, a.fv_osm], ['Conad Superstore', 'D1', 'Pescara', 'No']);
  assert.deepEqual([b.company, b.profilo, b.city, b.fv_osm, b.fonte, b.confidenza], ['Fater', 'D3', 'Cepagatti', 'Sì', "OSM (nome dell'area)", 'bassa']);
  assert.equal(cellOf(42.40, 14.10), '42.5,14.1');
});

test('OpenStreetMap: un multipoligono a pezzi si richiude; pezzi aperti e superfici impossibili si scartano', () => {
  const g = square(42.40, 14.10, 100);
  // il quadrato in due vie, la seconda al contrario, più un pezzo che non si chiude
  const rel = { type: 'relation', id: 7, tags: { building: 'industrial', name: 'Due Pezzi Spa' }, bounds: bounds(g), members: [
    { type: 'way', role: 'outer', geometry: g.slice(0, 3) },
    { type: 'way', role: 'outer', geometry: [...g.slice(2)].reverse() },
    { type: 'way', role: 'outer', geometry: square(42.50, 14.50, 5000).slice(0, 3) },
  ] };
  const open = { type: 'way', id: 8, tags: { building: 'industrial' }, bounds: bounds(g), geometry: square(42.6, 14.6, 3000).slice(0, 4) };
  const huge = way(9, { building: 'industrial' }, square(42.7, 14.7, 1000)); // 1 km²: errore della mappa
  const rows = parseOverpass({ elements: [rel, open, huge] }, { minArea: 2000 });
  assert.deepEqual(rows.map(r => r.key), ['r7']);
  assert.ok(Math.abs(rows[0].area - 10000) < 5);
  assert.ok(Math.abs(rows[0].lat - 42.40045) < 0.0001);
});

test('screening per provincia: opportunità PPA con punteggio e producibilità, rifarlo non duplica', async () => {
  const meta = (await api('GET', '/api/energy/screenings')).body;
  assert.equal(meta.regions.length, 20);
  assert.equal(meta.places, false);
  assert.equal((await api('POST', '/api/energy/screenings', { provinces: [] })).status, 400);
  assert.equal((await api('POST', '/api/energy/screenings', { provinces: ['XX'] })).status, 400);

  const s = await api('POST', '/api/energy/screenings', { provinces: ['PE'], min_area: 2000 });
  assert.equal(s.status, 201);
  await screening.idle();
  const run = (await api('GET', '/api/energy/screenings')).body.screenings.find(x => x.id === s.body.id);
  assert.equal(run.status, 'fatto', run.error);
  assert.deepEqual([run.summary[0].provincia, run.summary[0].edifici, run.summary[0].created], ['Pescara', 2, 2]);

  const { opportunities } = (await api('GET', '/api/energy/opportunities?kind=ppa_onsite')).body;
  const conad = opportunities.find(o => o.title === 'Conad Superstore');
  assert.deepEqual([conad.priority, conad.province, conad.region], ['A', 'Pescara', 'Abruzzo']);
  const card = (await api('GET', `/api/energy/opportunities/${conad.id}`)).body;
  assert.equal(card.data.kwh_kwp, 1300);
  assert.equal(card.data.punteggio, 84.95); // 34,95 di taglia + 50 di profilo D1
  assert.equal(card.data.mwh, 1560); // 10.000 m² · 0,6 · 0,2 kWp/m² · 1.300 kWh/kWp
  assert.equal(card.links[0].role, 'cliente');
  const fater = opportunities.find(o => o.title === 'Fater');
  assert.equal(fater.priority, 'C');

  // profilo corretto a mano, poi di nuovo lo screening: niente doppioni, il profilo resta
  await api('PATCH', `/api/energy/opportunities/${fater.id}`, { data: { profilo: 'D1' } });
  const pvgisBefore = calls.pvgis;
  await api('POST', '/api/energy/screenings', { provinces: ['PE'] });
  await screening.idle();
  assert.equal(calls.pvgis, pvgisBefore); // celle già in cache
  const again = (await api('GET', '/api/energy/opportunities?kind=ppa_onsite')).body.opportunities;
  assert.equal(again.length, opportunities.length);
  const fater2 = (await api('GET', `/api/energy/opportunities/${fater.id}`)).body;
  assert.deepEqual([fater2.data.profilo, fater2.priority], ['D1', 'B']); // 8,80 di taglia + 50 di D1 = 58,8
});

test('screening: fermare un giro in coda e filtro per regione su kanban e mappa', async () => {
  // due giri: il secondo resta in coda finché gira il primo e si ferma prima di partire
  let release;
  gate = new Promise(r => { release = r; });
  const first = await api('POST', '/api/energy/screenings', { provinces: ['PE'] });
  const second = await api('POST', '/api/energy/screenings', { provinces: ['CH'] });
  const stop = await api('POST', `/api/energy/screenings/${second.body.id}/ferma`);
  assert.equal(stop.body.status, 'fermato');
  gate = null;
  release();
  await screening.idle();
  const list = (await api('GET', '/api/energy/screenings')).body.screenings;
  assert.equal(list.find(x => x.id === first.body.id).status, 'fatto');
  assert.equal(list.find(x => x.id === second.body.id).status, 'fermato');
  assert.equal((await api('POST', `/api/energy/screenings/${second.body.id}/ferma`)).status, 400);

  const map = (await api('GET', '/api/energy/map/ppa_onsite?region=Abruzzo')).body;
  assert.equal(map.points.length, 2);
  assert.equal((await api('GET', '/api/energy/map/ppa_onsite?region=Lombardia')).body.points.length, 0);
});
