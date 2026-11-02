// Alma Energy: mappa delle opportunità e degli Impianti target (ALM2-11), con Leaflet servito da /vendor/leaflet e il
// fondo di OpenStreetMap. Le opportunità con le coordinate (screening dei tetti, dati tecnici) sono punti colorati per
// priorità e grandi secondo i MW; quelle senza (il Database CE ha solo la sede del proprietario) si contano per regione.
import { h, fill, loading } from './ui.js';
import { get, qs } from './api.js';
import { meta, num } from './energy.js';

let leafletReady = null;
function loadLeaflet() {
  leafletReady ??= new Promise((resolve, reject) => {
    document.head.append(h('link', { rel: 'stylesheet', href: '/vendor/leaflet/leaflet.css' }));
    const s = h('script', { src: '/vendor/leaflet/leaflet.js' });
    s.addEventListener('load', () => resolve(window.L));
    s.addEventListener('error', () => { leafletReady = null; reject(new Error('Mappa non caricata')); });
    document.head.append(s);
  });
  return leafletReady;
}

// Centri approssimati delle regioni, per le opportunità senza coordinate.
const REGION_CENTERS = {
  Abruzzo: [42.23, 13.85], Basilicata: [40.5, 16.08], Calabria: [39.07, 16.35], Campania: [40.86, 14.84], 'Emilia-Romagna': [44.53, 11.0],
  'Friuli-Venezia Giulia': [46.15, 13.05], Lazio: [41.98, 12.77], Liguria: [44.32, 8.7], Lombardia: [45.62, 9.77], Marche: [43.35, 13.15],
  Molise: [41.68, 14.6], Piemonte: [45.05, 7.92], Puglia: [41.0, 16.62], Sardegna: [40.08, 9.03], Sicilia: [37.57, 14.15], Toscana: [43.45, 11.12],
  'Trentino-Alto Adige': [46.45, 11.3], Umbria: [42.96, 12.49], "Valle d'Aosta": [45.74, 7.38], Veneto: [45.65, 11.85],
};

// Colori dai token del brand (Leaflet disegna su canvas e vuole valori, non variabili CSS).
const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const colorFor = p => {
  if (p.target_outcome === 'acquisito' || p.stage === 'target') return token('--green') || 'green';
  if (p.priority === 'A') return token('--orange') || 'orange';
  if (p.priority === 'B') return token('--ap-text-strong') || 'black';
  return token('--muted') || 'gray';
};

function stageText(p) {
  if (p.target_step) {
    return p.target_outcome ? meta.targetOutcomes[p.target_outcome] : `Target · ${meta.targetSteps.find(s => s.key === p.target_step)?.label || ''}`;
  }
  return (meta.stages[p.kind] || []).find(([k]) => k === p.stage)?.[1] || p.stage;
}

// Disegna la mappa nel contenitore; onOpen(id) apre la scheda.
export async function mapView(box, kind, filters, onOpen) {
  fill(box, loading());
  let L;
  try {
    L = await loadLeaflet();
  } catch (err) {
    return fill(box, h('div.card.empty', err.message));
  }
  const data = await get(`/api/energy/map/${kind}${qs(filters)}`);
  const el = h('div.en-map', { role: 'region', 'aria-label': 'Mappa delle opportunità' });
  const legend = h('div.en-map-legend',
    h('span', h('i.en-dot', { style: { background: colorFor({ priority: 'A' }) } }), 'Priorità A'),
    h('span', h('i.en-dot', { style: { background: colorFor({ priority: 'B' }) } }), 'Priorità B'),
    h('span', h('i.en-dot', { style: { background: colorFor({}) } }), 'Altre'),
    h('span', h('i.en-dot', { style: { background: colorFor({ stage: 'target' }) } }), 'Impianto target'),
    h('span.muted', `${num(data.points.length)} sulla mappa${data.regions.length ? ` · ${num(data.regions.reduce((s, r) => s + r.count, 0))} senza coordinate, contate per regione` : ''}`));
  // regione o provincia senza tetti: si parte da lì con lo screening (ALM2-25)
  const place = filters.province || filters.region;
  const hint = !data.points.length && place && kind !== 'revamping'
    ? h('div.card.en-map-hint', h('span', `Ancora nessun tetto in ${place}.`),
      h('a.btn.btn-sm.btn-primary', { href: `#/energy/screening?${filters.province ? 'provincia' : 'regione'}=${encodeURIComponent(place)}` }, 'Avvia lo screening qui'))
    : null;
  fill(box, hint, el, legend);

  const map = L.map(el, { preferCanvas: true, zoomControl: true }).setView([42.3, 12.6], 6);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; contributori di <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    // OpenStreetMap vuole sapere da quale sito arrivano le richieste (senza, risponde «Access blocked»), ma Alma Planet
    // dice al browser di non mandare l'indirizzo ad altri siti: per le sole tessere della mappa si manda il dominio
    referrerPolicy: 'origin',
  }).addTo(map);

  const bounds = [];
  for (const p of data.points) {
    const radius = Math.min(18, 4 + Math.sqrt(Number(p.mw) || 0) * 2);
    const marker = L.circleMarker([p.lat, p.lon], { radius, color: colorFor(p), fillColor: colorFor(p), fillOpacity: 0.55, weight: 1 }).addTo(map);
    marker.bindPopup(() => h('div.en-map-pop',
      h('strong', p.title),
      p.company_name && p.company_name !== p.title ? h('div', p.company_name) : null,
      h('div.t-meta', [stageText(p), p.priority && `priorità ${p.priority}`, p.mw && `${num(p.mw, 2)} MW`, p.city].filter(Boolean).join(' · ')),
      h('div.en-map-actions',
        h('button.btn.btn-sm', { type: 'button', on: { click: () => onOpen(p) } }, 'Apri la scheda'),
        h('a.btn.btn-sm.btn-ghost', { href: `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`, target: '_blank', rel: 'noopener' }, 'Satellite'))));
    bounds.push([p.lat, p.lon]);
  }
  for (const r of data.regions) {
    const c = REGION_CENTERS[r.region];
    if (!c) continue;
    const marker = L.circleMarker(c, { radius: Math.min(30, 8 + Math.sqrt(r.count) * 1.5), color: token('--ap-text-strong') || 'black', weight: 1,
      fillColor: token('--ap-grey-200') || 'lightgray', fillOpacity: 0.85 }).addTo(map);
    marker.bindTooltip(num(r.count), { permanent: true, direction: 'center', className: 'en-map-count' });
    marker.bindPopup(() => h('div.en-map-pop', h('strong', r.region),
      h('div', `${num(r.count)} opportunità senza coordinate`),
      r.lost ? h('div.t-meta', `${num(Math.round(r.lost))} € di incassi GSE persi all'anno`) : null,
      h('div.t-meta', 'Posizione della sede del proprietario: la posizione dell\'impianto si scrive nei dati tecnici.')));
    bounds.push(c);
  }
  if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 11 });
  // regione scelta e niente da mostrare: la mappa va comunque lì (per lo screening si usa «Screening per provincia»)
  else if (filters.region && REGION_CENTERS[filters.region]) map.setView(REGION_CENTERS[filters.region], 8);
  // la mappa nasce in un contenitore appena aggiunto: ricalcola le misure quando è a schermo
  setTimeout(() => map.invalidateSize(), 50);
}
