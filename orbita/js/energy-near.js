// Alma Energy «Vicino a me» (app 2.0 sul telefono, canvas approvato il 13/11/2026): la mappa in alto con le
// opportunità intorno a dove sei, l'elenco sotto dal più vicino. Chiama, portami lì (Strada), lascia una nota.
import { h, fill, loading, toast } from './ui.js';
import { get } from './api.js';
import { icon } from './icons.js';
import { loadLeaflet } from './energy-map.js';
import { meta, ensureMeta, stageLabel } from './energy.js';

const KM = [10, 25, 50, 100];
const num = (n, d = 0) => Number(n).toLocaleString('it-IT', { maximumFractionDigits: d });
const position = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) { reject(new Error('Il telefono non dà la posizione')); return; }
  navigator.geolocation.getCurrentPosition(p => resolve([p.coords.latitude, p.coords.longitude]),
    e => reject(new Error(e.code === 1 ? 'Permesso della posizione negato: riattivalo nelle impostazioni del telefono' : 'Posizione non disponibile')),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
});

export async function nearView(container, params) {
  await ensureMeta();
  let km = KM.includes(Number(params.get('km'))) ? Number(params.get('km')) : 25;
  const mapBox = h('div.a2-near-map');
  const list = h('div.a2-near-items', loading());
  const title = h('strong', { style: { fontSize: '18px', color: 'var(--a2-ink)' } }, 'Cerco dove sei…');
  const kmBtn = h('button', { type: 'button', on: { click: () => { km = KM[(KM.indexOf(km) + 1) % KM.length]; location.replace(`#/energy/vicino?km=${km}`); } } }, `Entro ${km} km`);
  fill(container, h('div.a2-near',
    h('div', { style: { position: 'relative' } }, mapBox,
      h('div.a2-near-top', h('a', { href: '#/esplora' }, '‹ Esplora'), kmBtn)),
    h('div.a2-near-list', h('div.sheet-grip'),
      h('div.a2-row-head', title, h('a', { href: '#/energy/ppa' }, 'Pipeline')),
      list)));

  let here;
  try { here = await position(); } catch (e) {
    title.textContent = 'Posizione non disponibile';
    fill(list, h('div.a2-card', h('span', e.message), h('a.a2-btn', { href: '#/energy/panoramica' }, 'Vai alla panoramica di Alma Energy')));
    return;
  }
  const data = await get(`/api/energy/opportunities?near=${here[0].toFixed(5)},${here[1].toFixed(5)}&km=${km}`);
  const ops = data.opportunities || [];
  title.textContent = ops.length ? `${data.total} ${data.total === 1 ? 'opportunità' : 'opportunità'} entro ${km} km` : `Nessuna opportunità entro ${km} km`;

  // mappa
  loadLeaflet().then(L => {
    const map = L.map(mapBox, { zoomControl: false, attributionControl: true }).setView(here, km <= 10 ? 12 : km <= 25 ? 11 : km <= 50 ? 10 : 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
    L.marker(here, { icon: L.divIcon({ className: '', html: '<span class="a2-near-me" style="display:block"></span>', iconSize: [14, 14] }) }).addTo(map);
    const color = o => (o.priority === 'A' ? '#B54E0A' : o.kind === 'ppa_onsite' ? '#2F6FA3' : '#2E8B57');
    for (const o of ops) {
      L.marker([o.lat, o.lon], { icon: L.divIcon({ className: '', html: `<span class="a2-near-dot" style="display:block;background:${color(o)}"></span>`, iconSize: [18, 18] }) })
        .addTo(map).on('click', () => document.getElementById(`near-${o.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  }).catch(() => { mapBox.append(h('p.a2-muted', { style: { padding: '60px 16px', textAlign: 'center' } }, 'Mappa non caricata')); });

  const call = async o => {
    const d = await get(`/api/energy/opportunities/${o.id}`);
    const tel = (d.links || []).find(l => l.phone && !l.opt_out)?.phone;
    if (tel) location.href = `tel:${String(tel).replace(/\s+/g, '')}`;
    else { toast('Nessun telefono tra le persone collegate', 'err'); location.hash = `#/energy/opportunita/${o.id}`; }
  };
  fill(list, ops.map((o, i) => h('div.a2-card', { id: `near-${o.id}` },
    h('div.a2-meet-row', h('a', { href: `#/energy/opportunita/${o.id}`, style: { color: 'var(--a2-ink)', fontWeight: 700, textDecoration: 'none', minWidth: 0, overflowWrap: 'anywhere' } }, o.title),
      h('span.a2-muted', `${num(o.km, 1)} km`)),
    h('span.a2-muted', [meta.kinds[o.kind], o.mw ? `${num(Number(o.mw) * 1000)} kWp` : null, o.priority ? `Tier ${o.priority}` : null, stageLabel(o.kind, o.stage)].filter(Boolean).join(' · ')),
    i < 8 ? h('div.a2-near-quick',
      h('button.a2-btn.blue', { type: 'button', on: { click: () => call(o) } }, icon('phone', { size: 15 }), ' Chiama'),
      h('a.a2-btn', { href: `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lon}`, target: '_blank', rel: 'noopener' }, icon('navigation', { size: 15 }), ' Strada'),
      h('a.a2-btn', { href: `#/energy/opportunita/${o.id}` }, icon('pencil', { size: 15 }), ' Nota')) : null)));
}
