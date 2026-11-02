// Alma Energy: screening dei tetti da OpenStreetMap (ALM2-23). Una query Overpass per provincia porta gli edifici
// grandi (il perimetro filtra già sul server: un tetto di S m² ha almeno 3,5·√S m di perimetro), le aree produttive
// e commerciali, le attività con nome, il fotovoltaico già mappato e i centri abitati. Qui si calcolano superficie e
// centro di ogni edificio, si riconosce l'azienda e si deduce il profilo di consumo. Niente rete: la chiamata la fa
// energy-screening.js.

// Edifici che non sono tetti da PPA: case, chiese, rovine, serre, tettoie.
const EXCLUDED = 'house|residential|apartments|detached|semidetached_house|terrace|bungalow|dormitory|church|cathedral|chapel|mosque|synagogue|temple|religious|monastery|shrine|ruins|construction|roof|greenhouse|carport|garage|garages|shed|hut|cabin|bunker|bridge|collapsed|abandoned|grandstand|tent|houseboat|static_caravan';

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function overpassQuery(iso, minArea) {
  const perimeter = Math.floor(3.5 * Math.sqrt(minArea));
  return `[out:json][timeout:900][maxsize:1073741824];
area["ISO3166-2"="${iso}"]["boundary"="administrative"]->.a;
(
  way["building"]["building"!~"^(${EXCLUDED})$"](area.a)(if: length() > ${perimeter});
  rel["building"]["building"!~"^(${EXCLUDED})$"](area.a);
)->.b;
.b out geom;
wr["landuse"~"^(industrial|commercial|retail)$"](area.a)->.lu;
.lu out tags bb;
.lu map_to_area->.lua;
(
  nwr["name"]["shop"](area.lua);
  nwr["name"]["office"](area.lua);
  nwr["name"]["craft"](area.lua);
  nwr["name"]["industrial"](area.lua);
  nwr["name"]["man_made"="works"](area.lua);
);
out tags center;
nwr["generator:source"="solar"](area.a);
out tags center;
node["place"~"^(city|town|village)$"](area.a);
out;`;
}

// ── geometria ────────────────────────────────────────────────────────────────
// Superficie in m² e centro di un anello (proiezione equirettangolare: errore trascurabile per un edificio).
function ring(geometry) {
  if (!geometry?.length || geometry.length < 4) return { area: 0, lat: null, lon: null };
  const lat0 = (geometry[0].lat * Math.PI) / 180;
  const kx = Math.cos(lat0) * 111320, ky = 110540;
  let s = 0, cx = 0, cy = 0;
  for (let i = 0; i < geometry.length - 1; i++) {
    const x1 = geometry[i].lon * kx, y1 = geometry[i].lat * ky, x2 = geometry[i + 1].lon * kx, y2 = geometry[i + 1].lat * ky;
    const f = x1 * y2 - x2 * y1;
    s += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (!s) return { area: 0, lat: geometry[0].lat, lon: geometry[0].lon };
  return { area: Math.abs(s) / 2, lat: cy / (3 * s) / ky, lon: cx / (3 * s) / kx };
}

function shape(el) {
  if (el.type === 'way') {
    const r = ring(el.geometry);
    return { ...r, poly: [el.geometry], bounds: el.bounds };
  }
  // multipoligono: somma degli anelli esterni meno gli interni, centro dell'anello più grande
  const rings = (el.members || []).filter(m => m.type === 'way' && m.geometry?.length > 3);
  const outer = rings.filter(m => m.role !== 'inner').map(m => ({ ...ring(m.geometry), g: m.geometry }));
  const inner = rings.filter(m => m.role === 'inner').reduce((s, m) => s + ring(m.geometry).area, 0);
  if (!outer.length) return { area: 0, lat: null, lon: null, poly: [] };
  const main = outer.reduce((a, b) => (b.area > a.area ? b : a));
  return { area: outer.reduce((s, r) => s + r.area, 0) - inner, lat: main.lat, lon: main.lon, poly: outer.map(r => r.g), bounds: el.bounds };
}

function inPoly(lat, lon, poly) {
  let inside = false;
  for (const g of poly) {
    for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
      if ((g[i].lat > lat) !== (g[j].lat > lat) && lon < ((g[j].lon - g[i].lon) * (lat - g[i].lat)) / (g[j].lat - g[i].lat) + g[i].lon) inside = !inside;
    }
  }
  return inside;
}
const inBounds = (lat, lon, b) => b && lat >= b.minlat && lat <= b.maxlat && lon >= b.minlon && lon <= b.maxlon;
const pointOf = el => (el.type === 'node' ? { lat: el.lat, lon: el.lon } : el.center ? { lat: el.center.lat, lon: el.center.lon } : null);
const km = (a, b) => Math.hypot((a.lat - b.lat) * 110.54, (a.lon - b.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180));

// ── profilo di consumo dai tag ───────────────────────────────────────────────
// Come nello screening dell'Abruzzo: D1 7 su 7 o ciclo continuo, D2 energivori su più turni, D3 un turno, D4 consumi
// bassi, ND non si sa, X escluso. Dai soli tag la confidenza è bassa: il profilo si corregge dalla scheda.
const D1_SHOP = /^(supermarket|mall|department_store|hypermarket|wholesale)$/;
const D2_INDUSTRY = /glass|paper|cardboard|plastic|food|dairy|meat|beverage|bottl|steel|metal|foundry|chemical|ceramic|cement|textile|brewery|bakery|alimentar|vetr|cartier|cartotecn|plastic|acciai|metallur|fonderi|chimic|ceramic|cementi|tessil|birrific|caseific|salumific|pastific|conserv|imbottigli|lattier|mangimi|laterizi|fornac|zuccher|oleific|cantin|frantoi/i;
// insegne della grande distribuzione, quando manca il tag shop
const D1_BRAND = /\b(conad|coop|ipercoop|esselunga|lidl|eurospin|carrefour|despar|interspar|eurospar|penny|aldi|famila|tigre|auchan|bennet|tosano|iper|ipermercato|supermercato|centro commerciale|outlet)\b/i;
// nomi di aree che sono zone, non aziende
const ZONE_NAME = /\b(zona|area|nucleo|consorzio|interporto|polo|centro|distretto|insediamento|lottizzazione|comparto|pip|asi|industriale|artigianale|commerciale|produttiva)\b/i;
const D3_SHOP = /^(doityourself|hardware|furniture|car|car_parts|electronics|trade|garden_centre|building_materials|sports|clothes|appliance)$/;
function profileOf(tags, pois) {
  const all = [tags, ...pois];
  const val = k => all.map(t => t[k]).filter(Boolean);
  const text = all.map(t => [t.industrial, t.product, t.manufacturer, t.craft, t.name, t.operator].filter(Boolean).join(' ')).join(' ');
  if (tags.power || val('power').length) return ['X', 'Infrastruttura elettrica'];
  if (val('shop').some(s => D1_SHOP.test(s)) || ['supermarket'].includes(tags.building) || D1_BRAND.test(text)) return ['D1', 'Grande distribuzione o centro commerciale, aperto 7 giorni'];
  if (/cold|frigo|freddo|surgel/i.test(text)) return ['D1', 'Logistica del freddo o celle frigorifere'];
  if (['hospital'].includes(tags.building) || val('amenity').includes('hospital')) return ['D1', 'Ospedale, consumi continui'];
  if (D2_INDUSTRY.test(text)) return ['D2', `Manifattura energivora (${(text.match(D2_INDUSTRY) || [])[0]})`];
  if (['industrial', 'manufacture', 'factory'].includes(tags.building) && (tags.name || pois.length)) return ['D3', 'Stabilimento industriale, settore non noto'];
  if (['warehouse'].includes(tags.building) || /logistic/i.test(text)) return ['D3', 'Magazzino o logistica a temperatura ambiente'];
  if (val('shop').some(s => D3_SHOP.test(s)) || ['retail', 'commercial'].includes(tags.building)) return ['D3', 'Commercio specializzato o uffici'];
  if (['farm_auxiliary', 'barn', 'storage_tank', 'silo'].includes(tags.building)) return ['D4', 'Deposito o edificio agricolo'];
  return ['ND', 'Azienda o attività non identificata'];
}

const companyOf = (tags, pois) => tags.name || tags.operator || tags.brand
  || pois.map(p => p.name || p.operator || p.brand).find(Boolean) || '';

// Dalla risposta di Overpass agli edifici sopra la superficie minima, con azienda, profilo, comune e area produttiva.
function parseOverpass(json, { minArea }) {
  const els = json.elements || [];
  const buildings = [], landuse = [], pois = [], solar = [], places = [];
  for (const el of els) {
    const t = el.tags || {};
    if (t.building && (el.geometry || el.members)) buildings.push(el);
    else if (t.landuse) landuse.push(el);
    else if (t.place) places.push({ lat: el.lat, lon: el.lon, name: t.name || '' });
    else if (t['generator:source'] === 'solar') solar.push(pointOf(el));
    else if (t.name) pois.push({ ...pointOf(el), tags: t });
  }
  const out = [];
  for (const el of buildings) {
    const s = shape(el);
    if (s.area < minArea || s.lat === null) continue;
    const t = el.tags;
    const inside = p => p && p.lat !== undefined && inBounds(p.lat, p.lon, s.bounds) && inPoly(p.lat, p.lon, s.poly);
    const own = pois.filter(inside).map(p => p.tags);
    const lu = landuse.find(l => inBounds(s.lat, s.lon, l.bounds));
    // senza nome sull'edificio: l'area industriale che lo contiene spesso porta il nome dell'azienda («Fater»)
    const luCompany = lu?.tags?.name && !ZONE_NAME.test(lu.tags.name) ? lu.tags.name : '';
    const company = companyOf(t, own) || luCompany;
    const [profilo, motivazione] = profileOf(t, luCompany ? [...own, { name: luCompany }] : own);
    const near = places.length ? places.reduce((a, b) => (km(s, b) < km(s, a) ? b : a)) : null;
    const activity = [t.shop || own.map(p => p.shop).find(Boolean), t.industrial || own.map(p => p.industrial).find(Boolean), t.product, t.craft || own.map(p => p.craft).find(Boolean)]
      .filter(Boolean).join(', ');
    out.push({
      key: `${el.type === 'way' ? 'w' : 'r'}${el.id}`,
      company,
      area: Math.round(s.area),
      lat: Math.round(s.lat * 1e6) / 1e6,
      lon: Math.round(s.lon * 1e6) / 1e6,
      city: t['addr:city'] || own.map(p => p['addr:city']).find(Boolean) || near?.name || '',
      profilo,
      motivazione,
      attivita: activity || t.building,
      area_produttiva: lu?.tags?.name || (lu ? `area ${lu.tags.landuse === 'industrial' ? 'industriale' : 'commerciale'} senza nome` : ''),
      fv_osm: solar.some(inside) ? 'Sì' : 'No',
      fonte: companyOf(t, own) ? 'OSM' : luCompany ? "OSM (nome dell'area)" : 'OSM (senza nome)',
      confidenza: companyOf(t, own) ? 'media' : 'bassa',
    });
  }
  return out;
}

module.exports = { OVERPASS_URLS, overpassQuery, parseOverpass, profileOf, ring };
