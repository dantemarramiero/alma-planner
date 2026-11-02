// Alma Energy: screening dei tetti per provincia (ALM2-23). Si scelgono le province (o regioni intere) e la
// superficie minima; Alma Energy cerca gli edifici su OpenStreetMap, calcola la producibilità con PVGIS e il punteggio
// con i parametri dei tier, e mette i tetti nel kanban del PPA on-site. Il giro va avanti anche chiudendo la pagina.
import { h, fill, toast, loading, confirmDialog, fmtDateTime } from './ui.js';
import { get, post } from './api.js';
import { icon } from './icons.js';
import { num, field, input } from './energy.js';

const STATUS = {
  in_coda: 'In coda', in_corso: 'In corso', fermando: 'Si sta fermando', fatto: 'Fatto', fermato: 'Fermato', errore: 'Errore',
};
const PHASES = { OpenStreetMap: 'Cerco gli edifici su OpenStreetMap', PVGIS: 'Producibilità da PVGIS', 'Google Places': 'Aziende da Google Places', Salvataggio: 'Salvo i tetti' };

export async function screeningView(box) {
  fill(box, loading());
  let data = await get('/api/energy/screenings');
  const chosen = new Set();
  let timer = null; // aggiornamento automatico mentre un giro è in corso
  // arrivando dalla mappa (#/energy/screening?regione=… o ?provincia=…) la scelta è già fatta
  const want = new URLSearchParams(location.hash.split('?')[1] || '');
  for (const r of data.regions) {
    if (want.get('regione') === r.name) r.provinces.forEach(p => chosen.add(p.code));
    for (const p of r.provinces) if (want.get('provincia') === p.name) chosen.add(p.code);
  }
  const runs = h('div.en-scr-runs');
  const minArea = input({ type: 'number', min: 500, step: 500, value: 2000, inputmode: 'numeric' });
  const usePlaces = h('input', { type: 'checkbox', disabled: !data.places });
  const count = h('span.muted');
  const startBtn = h('button.btn.btn-primary', { type: 'button', disabled: true, on: { click: start } }, icon('search', { size: 16 }), 'Avvia lo screening');
  const updateCount = () => {
    count.textContent = chosen.size ? `${chosen.size} ${chosen.size === 1 ? 'provincia scelta' : 'province scelte'}` : 'Nessuna provincia scelta';
    startBtn.disabled = !chosen.size;
  };

  // regioni a fisarmonica: la casella della regione sceglie tutte le sue province
  const regions = data.regions.map(r => {
    const boxes = r.provinces.map(p => {
      const cb = h('input', { type: 'checkbox', value: p.code, checked: chosen.has(p.code), on: { change: e => { e.target.checked ? chosen.add(p.code) : chosen.delete(p.code); sync(); updateCount(); } } });
      return h('label.en-check', cb, `${p.name} (${p.code})`);
    });
    const all = h('input', { type: 'checkbox', on: { change: e => {
      for (const p of r.provinces) e.target.checked ? chosen.add(p.code) : chosen.delete(p.code);
      boxes.forEach(l => { l.querySelector('input').checked = e.target.checked; });
      updateCount();
    } } });
    const sync = () => {
      const n = r.provinces.filter(p => chosen.has(p.code)).length;
      all.checked = n === r.provinces.length;
      all.indeterminate = n > 0 && n < r.provinces.length;
    };
    queueMicrotask(sync);
    return h('details.en-scr-region', { open: r.provinces.some(p => chosen.has(p.code)) },
      h('summary', h('label.en-check', { on: { click: e => e.stopPropagation() } }, all, h('strong', r.name)), h('span.muted', `${r.provinces.length} ${r.provinces.length === 1 ? 'provincia' : 'province'}`)),
      h('div.en-scr-provinces', boxes));
  });

  fill(box,
    h('div.en-sim',
      h('div.en-sim-form',
        h('section.card.sw-card',
          h('h3', 'Dove cercare'),
          h('p.muted', 'Apri una regione per scegliere le province, o spunta la regione intera. Le province grandi richiedono qualche minuto ciascuna.'),
          h('div.en-scr-regions', regions)),
        h('section.card.sw-card',
          h('h3', 'Cosa cercare'),
          field('Superficie minima del tetto (m²)', minArea, 'Lo screening dell\'Abruzzo partiva da 2.000 m².'),
          h('label.en-check', usePlaces, 'Riconosci le aziende anche con Google Places'),
          h('small.muted', data.places
            ? 'A pagamento: al massimo 300 edifici senza nome per provincia, i più grandi.'
            : 'Serve la chiave GOOGLE_PLACES_KEY su Railway (a pagamento). Senza, le aziende vengono solo da OpenStreetMap.'),
          h('div.en-stage-row', startBtn, count))),
      h('div.en-sim-results',
        h('section.card.sw-card', h('h3', 'Giri di screening'), runs),
        h('p.t-meta', 'Edifici e attività: © contributori di OpenStreetMap. Producibilità: PVGIS (Commissione europea), moduli a 10° verso sud, perdite 14%. Punteggio e priorità con i «Parametri dei tier».'))));
  updateCount();
  drawRuns();
  // la regione arrivata dalla mappa è aperta: la si porta in vista nell'elenco
  box.querySelector('.en-scr-region[open]')?.scrollIntoView({ block: 'nearest' });

  async function start() {
    const area = Number(minArea.value) || 2000;
    if (!await confirmDialog(`Avviare lo screening di ${chosen.size} ${chosen.size === 1 ? 'provincia' : 'province'} sopra i ${num(area)} m²? I tetti trovati entrano nel kanban del PPA on-site come «Da qualificare»; quelli che ci sono già si aggiornano senza toccare stadi e note.`, { ok: 'Avvia' })) return;
    await post('/api/energy/screenings', { provinces: [...chosen], min_area: area, use_places: usePlaces.checked });
    toast('Screening avviato');
    await refresh();
  }

  async function refresh() {
    data = await get('/api/energy/screenings');
    drawRuns();
  }
  function drawRuns() {
    clearTimeout(timer);
    if (!data.screenings.length) return fill(runs, h('p.muted', 'Ancora nessuno screening.'));
    fill(runs, h('ul.en-scr-list', data.screenings.map(runItem)));
    // finché qualcosa gira, si aggiorna da sola (e smette quando si cambia pagina)
    if (data.screenings.some(s => ['in_coda', 'in_corso', 'fermando'].includes(s.status))) {
      timer = setTimeout(() => { if (box.isConnected) refresh().catch(() => {}); }, 3000);
    }
  }

  function runItem(s) {
    const p = s.progress || {};
    const names = s.provinces.map(code => data.regions.flatMap(r => r.provinces).find(x => x.code === code)?.name || code);
    const running = s.status === 'in_corso';
    const pct = running && p.totale ? Math.round((p.fatti / p.totale) * 100) : null;
    const sums = Array.isArray(s.summary) ? s.summary : []; // {} finché nessuna provincia è finita
    const totals = sums.reduce((t, x) => ({ edifici: t.edifici + x.edifici, nuovi: t.nuovi + x.created, aggiornati: t.aggiornati + x.updated, A: t.A + (x.byPriority?.A || 0), B: t.B + (x.byPriority?.B || 0) }),
      { edifici: 0, nuovi: 0, aggiornati: 0, A: 0, B: 0 });
    return h('li.en-scr-run',
      h('div.en-scr-head',
        h('strong', names.length > 4 ? `${names.slice(0, 4).join(', ')} e altre ${names.length - 4}` : names.join(', ')),
        h('span.pill.en-stage', { class: s.status === 'errore' ? 'en-lost' : s.status === 'fatto' ? 'en-target' : '' }, h('span.dot'), STATUS[s.status] || s.status)),
      h('div.t-meta', [`da ${num(s.min_area)} m²`, s.use_places ? 'con Google Places' : null, fmtDateTime(s.created_at), s.user_name].filter(Boolean).join(' · ')),
      running ? h('div.en-scr-progress',
        h('div.t-meta', `${p.provincia ? `${p.provincia} (${p.indice} di ${p.province}) · ` : ''}${PHASES[p.fase] || p.fase || 'Avvio'}${p.totale ? ` · ${num(p.fatti)} di ${num(p.totale)}` : ''}${p.server ? ` · server ${p.server}${p.tentativo > 1 ? `, giro ${p.tentativo} di 3` : ''}, da ${Math.max(0, Math.round((Date.now() - new Date(p.dal)) / 60000))} min` : ''}`),
        h('div.en-progress', h('i', { style: { width: `${pct ?? 5}%` } }), h('span', pct === null ? '' : `${pct}%`))) : null,
      s.error ? h('div.en-scr-error', s.error) : null,
      totals.edifici ? h('div', `${num(totals.edifici)} tetti: ${num(totals.nuovi)} nuovi, ${num(totals.aggiornati)} aggiornati · ${num(totals.A)} in A, ${num(totals.B)} in B`) : null,
      sums.length > 1 ? h('details.en-scr-detail', h('summary', 'Per provincia'), h('ul.en-history', sums.map(x => h('li',
        h('strong', x.provincia), ` · ${num(x.edifici)} tetti, ${num(x.conAzienda)} con azienda, A ${num(x.byPriority?.A || 0)}, B ${num(x.byPriority?.B || 0)}`)))) : null,
      h('div.en-stage-row',
        ['in_coda', 'in_corso'].includes(s.status) ? h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => {
          await post(`/api/energy/screenings/${s.id}/ferma`);
          toast('Il giro si ferma appena finisce il passo in corso');
          refresh();
        } } }, 'Ferma') : null,
        totals.edifici ? h('a.btn.btn-sm', { href: '#/energy/ppa' }, 'Apri il PPA on-site') : null));
  }
}
