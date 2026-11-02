// Alma Energy: screening dei tetti per provincia (ALM2-23). Gira in background, un giro alla volta, una provincia
// alla volta: OpenStreetMap (Overpass) per gli edifici, PVGIS per la producibilità (una chiamata per cella di 0,2°,
// poi in cache), Google Places solo se c'è la chiave e lo si chiede, poi gli stessi passi dell'import del file
// (punteggio con i parametri dei tier, aziende nel CRM, chiave = ID OSM: rifarlo aggiorna e non duplica).
const { OVERPASS_URLS, overpassQuery, parseOverpass } = require('./energy-osm');
const { PROVINCES } = require('./energy-places');
const { getParams, scoreRoof } = require('./energy-tiers');
const { upsertRoofs } = require('./energy-import');

const PVGIS_URL = 'https://re.jrc.ec.europa.eu/api/v5_2/PVcalc';
const PLACES_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const USER_AGENT = 'AlmaPlanet/1.0 (Alma Energy, screening tetti)';
const PLACES_MAX = 300; // tetto alle chiamate a pagamento per giro
// centro della cella di 0,2° (il piccolo margine evita che 42,4 / 0,2 = 211,999… finisca nella cella sotto)
const cell = v => (Math.floor(v / 0.2 + 1e-9) * 0.2 + 0.1).toFixed(1);
const cellOf = (lat, lon) => `${cell(lat)},${cell(lon)}`;
const D1_PLACES = /^(supermarket|shopping_mall|department_store|hypermarket|warehouse_store|grocery_store|hospital)$/;

class Stopped extends Error {}

function createScreeningRunner({ db, fetchImpl = fetch, overpassUrls = OVERPASS_URLS, placesKey = process.env.GOOGLE_PLACES_KEY || '', retryDelayMs = 20000, logger = console }) {
  let busy = null; // promessa del giro in corso

  const set = (id, fields) => {
    const keys = Object.keys(fields);
    return db.query(`UPDATE energy_screenings SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
      [id, ...keys.map(k => (fields[k] && typeof fields[k] === 'object' && !(fields[k] instanceof Date) ? JSON.stringify(fields[k]) : fields[k]))]);
  };
  const checkStop = async id => {
    const { rows: [j] } = await db.query('SELECT status FROM energy_screenings WHERE id = $1', [id]);
    if (!j || j.status === 'fermando') throw new Stopped();
  };

  // Overpass: i server pubblici sono spesso pieni; si provano a turno, per tre giri.
  async function overpass(iso, minArea, onTry = () => {}) {
    const body = `data=${encodeURIComponent(overpassQuery(iso, minArea))}`;
    let last = '';
    for (let round = 0; round < 3; round++) {
      for (const url of overpassUrls) {
        await onTry(new URL(url).host, round + 1);
        try {
          const res = await fetchImpl(url, {
            method: 'POST', body, signal: AbortSignal.timeout(15 * 60 * 1000),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
          });
          const text = await res.text();
          if (res.ok && text.trimStart().startsWith('{')) {
            const json = JSON.parse(text);
            // risposta arrivata ma interrotta dal server (tempo o memoria): non vale
            if (json.remark && /runtime error/i.test(json.remark)) { last = json.remark; continue; }
            return json;
          }
          last = `${res.status} da ${new URL(url).host}`;
        } catch (err) {
          last = `${err.name === 'TimeoutError' ? 'tempo scaduto' : err.message} da ${new URL(url).host}`;
        }
      }
      if (round < 2) await new Promise(r => setTimeout(r, retryDelayMs));
    }
    throw new Error(`OpenStreetMap non risponde (${last}). Riprova più tardi.`);
  }

  // PVGIS: kWh/kWp all'anno per cella, moduli a 10° verso sud, perdite 14% (come lo screening dell'Abruzzo).
  async function pvgis(cells, onStep) {
    const out = new Map();
    const { rows } = await db.query('SELECT cell, kwh_kwp FROM energy_pvgis_cells WHERE cell = ANY($1::text[])', [cells]);
    // -1 = cella in mare (PVGIS non ha dati): si ricorda anche quello, per non richiederla a ogni giro
    const sea = new Set(rows.filter(r => Number(r.kwh_kwp) < 0).map(r => r.cell));
    for (const r of rows) if (!sea.has(r.cell)) out.set(r.cell, Number(r.kwh_kwp));
    const todo = cells.filter(c => !out.has(c) && !sea.has(c));
    let done = cells.length - todo.length;
    onStep(done);
    const worker = async () => {
      while (todo.length) {
        const cell = todo.shift();
        const [lat, lon] = cell.split(',');
        try {
          const url = `${PVGIS_URL}?lat=${lat}&lon=${lon}&peakpower=1&loss=14&angle=10&aspect=0&outputformat=json`;
          const get = () => fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60000) });
          // una connessione caduta capita: si riprova una volta dopo qualche secondo
          const res = await get().catch(() => new Promise(r => setTimeout(r, Math.min(retryDelayMs, 5000))).then(get));
          const body = await res.json().catch(() => null);
          const overSea = res.status === 400 && /sea/i.test(body?.message || '');
          const y = overSea ? -1 : res.ok ? body?.outputs?.totals?.fixed?.E_y : null;
          if (Number.isFinite(y)) {
            if (y > 0) out.set(cell, y);
            await db.query('INSERT INTO energy_pvgis_cells (cell, kwh_kwp) VALUES ($1, $2) ON CONFLICT (cell) DO UPDATE SET kwh_kwp = EXCLUDED.kwh_kwp, fetched_at = now()', [cell, y]);
          }
        } catch (err) {
          logger.warn?.(`[energy] PVGIS ${cell}: ${err.message}`);
        }
        onStep(++done);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out;
  }

  // Google Places (a pagamento): il nome dell'attività più vicina al centro dell'edificio.
  async function places(b) {
    const res = await fetchImpl(PLACES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': placesKey, 'X-Goog-FieldMask': 'places.displayName,places.primaryType' },
      body: JSON.stringify({ maxResultCount: 1, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude: b.lat, longitude: b.lon }, radius: Math.max(30, Math.sqrt(b.area) / 1.5) } } }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Google Places ${res.status}`);
    const p = (await res.json())?.places?.[0];
    return p ? { name: p.displayName?.text || '', type: p.primaryType || '' } : null;
  }

  async function runProvince(job, code, index, total) {
    const prov = PROVINCES.get(code);
    const progress = (fase, fatti = null, tot = null, extra = {}) => set(job.id, { progress: { provincia: prov.name, indice: index + 1, province: total, fase, fatti, totale: tot, ...extra } });
    const json = await overpass(prov.iso, job.min_area, (server, tentativo) => progress('OpenStreetMap', null, null, { server, tentativo, dal: new Date().toISOString() }));
    await checkStop(job.id);
    const buildings = parseOverpass(json, { minArea: job.min_area });

    const cells = [...new Set(buildings.map(b => cellOf(b.lat, b.lon)))];
    // lungo la costa il centro della cella cade in mare (PVGIS risponde «Location over the sea»): per quegli edifici
    // si chiede la producibilità nel punto dell'edificio, arrotondato a 0,02°
    const near = b => `${(Math.round(b.lat * 50) / 50).toFixed(2)},${(Math.round(b.lon * 50) / 50).toFixed(2)}`;
    await progress('PVGIS', 0, cells.length);
    const yields = await pvgis(cells, n => { if (n % 5 === 0 || n === cells.length) progress("PVGIS", n, cells.length).catch(() => {}); });
    const sea = buildings.filter(b => !yields.has(cellOf(b.lat, b.lon)));
    if (sea.length) {
      const extra = await pvgis([...new Set(sea.map(near))], () => {});
      for (const [k, y] of extra) yields.set(k, y);
    }
    const kwhOf = b => yields.get(cellOf(b.lat, b.lon)) ?? yields.get(near(b)) ?? null;
    await checkStop(job.id);

    let placesCalls = 0;
    if (job.use_places && placesKey) {
      const unnamed = buildings.filter(b => !b.company).sort((a, b) => b.area - a.area).slice(0, PLACES_MAX);
      await progress('Google Places', 0, unnamed.length);
      for (const b of unnamed) {
        try {
          const p = await places(b);
          placesCalls++;
          if (p?.name) {
            b.company = p.name;
            b.fonte = 'Google Places';
            b.confidenza = 'media';
            if (D1_PLACES.test(p.type)) [b.profilo, b.motivazione] = ['D1', `Google Places: ${p.type}`];
            else if (p.type) b.attivita = p.type;
          }
        } catch (err) {
          logger.warn?.(`[energy] ${err.message}`);
          break; // chiave sbagliata o quota finita: si va avanti senza
        }
        if (placesCalls % 10 === 0) await progress('Google Places', placesCalls, unnamed.length);
      }
    }

    await progress('Salvataggio', 0, buildings.length);
    const params = (await getParams(db)).screening;
    const rows = buildings.map(b => {
      const data = {
        fonte: 'Screening tetti', rank: null, profilo: b.profilo, attivita: b.attivita, giorni: null, turni: '', motivazione: b.motivazione,
        confidenza: b.confidenza, area_produttiva: b.area_produttiva, superficie: b.area, kwh_kwp: kwhOf(b),
        fv_osm: b.fv_osm, fonte_dati: b.fonte, screening_id: job.id,
      };
      const s = scoreRoof(data, params);
      return {
        key: b.key,
        title: b.company || `Capannone ${b.city}${` (${b.area.toLocaleString('it-IT')} m²)`}`,
        company: b.company, priority: s.priority, mw: s.mw, capex: s.capex,
        city: b.city, province: prov.name, region: prov.region, lat: b.lat, lon: b.lon,
        data: { ...data, ...s.data },
      };
    });
    const saved = await db.tx(q => upsertRoofs(q, rows, job.user_id, `Screening per provincia (${prov.name})`));
    const byPriority = {};
    for (const r of rows) byPriority[r.priority] = (byPriority[r.priority] || 0) + 1;
    return { provincia: prov.name, edifici: rows.length, conAzienda: rows.filter(r => r.company).length, celle: cells.length, google: placesCalls, byPriority, ...saved };
  }

  async function runJob(job) {
    await set(job.id, { status: 'in_corso', started_at: new Date(), error: '' });
    const summary = [];
    try {
      for (const [i, code] of job.provinces.entries()) {
        summary.push(await runProvince(job, code, i, job.provinces.length));
        await set(job.id, { summary });
        await checkStop(job.id);
      }
      await set(job.id, { status: 'fatto', finished_at: new Date(), progress: {} });
    } catch (err) {
      if (err instanceof Stopped) await set(job.id, { status: 'fermato', finished_at: new Date(), progress: {} });
      else {
        logger.error?.(`[energy] screening #${job.id}: ${err.message}`);
        await set(job.id, { status: 'errore', error: err.message.slice(0, 500), finished_at: new Date() });
      }
    }
  }

  // Prende i giri in coda uno alla volta finché ce ne sono.
  function kick() {
    if (busy) return busy;
    busy = (async () => {
      try {
        for (;;) {
          const { rows: [job] } = await db.query("SELECT * FROM energy_screenings WHERE status = 'in_coda' ORDER BY id LIMIT 1");
          if (!job) break;
          await runJob(job);
        }
      } finally {
        busy = null;
      }
    })();
    return busy;
  }

  return {
    hasPlaces: Boolean(placesKey),
    kick,
    // Al riavvio del server: i giri che stavano girando sono persi, quelli in coda ripartono.
    async start() {
      await db.query("UPDATE energy_screenings SET status = 'errore', error = 'Interrotto da un riavvio del server: rilancialo', finished_at = now() WHERE status IN ('in_corso', 'fermando')");
      kick();
    },
    idle: () => busy || Promise.resolve(),
  };
}

module.exports = { createScreeningRunner, cellOf };
