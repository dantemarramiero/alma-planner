// «Da dove vengono i dati» (ALM2-49, canvas CRM v13 · V13-Fonti, via di Dante 21/11/2026).
// Per le gare di una pagina (Mercato, Concorrenza e gare, scheda impresa): le fonti usate con periodo e ultimo
// aggiornamento, quanto sono completi i campi che contano (vincitore, importo, ribasso, offerenti, categoria) e
// cosa non c'è. Si legge soltanto: le gare le carica il CRM (lib/crm-anac.js).

const STALE_H = 48; // oltre: pallino arancio

// fonti che arrivano con ALM2-49: si accendono da sole quando hanno dati (tabelle future)
const SOON = [
  { key: 'ted', name: 'TED · Gazzetta europea degli appalti', what: 'Gare sopra soglia europea con tutti i partecipanti.', url: 'https://ted.europa.eu' },
  { key: 'opencup', name: 'OpenCUP · opere finanziate', what: 'Progetti con fondi stanziati, prima che esca il bando.', url: 'https://www.opencup.gov.it' },
];

const ym = m => (m ? `${m.slice(4, 6)}/${m.slice(0, 4)}` : null);

async function anacSource(db) {
  const { rows: [r] } = await db.query(`SELECT max(at) FILTER (WHERE error = '') AS last_ok, max(at) AS last_try,
      min(month) FILTER (WHERE error = '') AS first, max(month) FILTER (WHERE error = '') AS last,
      count(*) FILTER (WHERE error = '')::int AS months, count(*) FILTER (WHERE error <> '')::int AS errors
    FROM crm_anac_imports`);
  const { rows: [p] } = await db.query('SELECT min(awarded_on) AS da, max(awarded_on) AS a FROM crm_anac_awards');
  const day = d => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);
  const lastOk = r?.last_ok ? new Date(r.last_ok) : null;
  return {
    key: 'anac', name: 'ANAC · Banca dati nazionale dei contratti pubblici',
    what: 'Esiti, vincitori, ribassi, partecipanti e subappalti dichiarati dalle stazioni appaltanti. Open data ufficiali.',
    url: 'https://dati.anticorruzione.it/opendata',
    status: !lastOk ? 'vuota' : (Date.now() - lastOk.getTime()) / 36e5 > STALE_H ? 'vecchia' : 'ok',
    updated_at: lastOk ? lastOk.toISOString() : null,
    period: { from: day(p?.da), to: day(p?.a), first_file: ym(r?.first), last_file: ym(r?.last) },
    months: r?.months || 0, errors: r?.errors || 0,
  };
}

// completezza delle gare nel perimetro (WHERE con alias «a»)
async function quality(db, sql, params) {
  const { rows: [q] } = await db.query(`SELECT count(*)::int AS n,
      count(*) FILTER (WHERE jsonb_array_length(a.winners) > 0)::int AS winners,
      count(*) FILTER (WHERE a.amount IS NOT NULL AND a.amount > 0)::int AS amount,
      count(*) FILTER (WHERE a.discount IS NOT NULL AND a.discount > 0 AND a.discount < 70)::int AS discount,
      count(*) FILTER (WHERE a.bidders IS NOT NULL AND a.bidders > 0)::int AS bidders,
      count(*) FILTER (WHERE a.category <> '')::int AS category,
      count(*) FILTER (WHERE a.bidders >= 2 AND a.discount > 0 AND a.discount < 70)::int AS discount_real,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM crm_anac_bidders b WHERE b.cig = a.cig))::int AS known_bidders,
      count(*) FILTER (WHERE cardinality(a.cats_sec) > 0)::int AS cats_sec,
      count(*) FILTER (WHERE a.cup <> '')::int AS cup,
      count(*) FILTER (WHERE a.bidders_counted)::int AS bidders_counted
    FROM crm_anac_awards a WHERE ${sql}`, params);
  const { rows: [sub] } = await db.query(`SELECT count(*)::int AS n FROM crm_anac_subcontracts s JOIN crm_anac_awards a ON a.cig = s.cig WHERE ${sql}`, params);
  q.subcontracts = sub.n;
  const pct = k => (q.n ? Math.round((q[k] / q.n) * 100) : null);
  return {
    n: q.n, discount_real: q.discount_real,
    fields: [
      { key: 'winners', label: 'Vincitore indicato', n: q.winners, pct: pct('winners') },
      { key: 'amount', label: 'Importo di aggiudicazione', n: q.amount, pct: pct('amount') },
      { key: 'discount', label: 'Ribasso dichiarato', n: q.discount, pct: pct('discount') },
      { key: 'bidders', label: q.bidders_counted ? 'Numero di offerenti (dichiarato o contato dai partecipanti)' : 'Numero di offerenti', n: q.bidders, pct: pct('bidders'), counted: q.bidders_counted },
      { key: 'category', label: 'Categoria SOA prevalente', n: q.category, pct: pct('category') },
      { key: 'known_bidders', label: 'Chi ha partecipato (anche chi ha perso)', n: q.known_bidders, pct: pct('known_bidders'), extra: true },
      { key: 'cats_sec', label: 'Con categorie secondarie (scorporabili)', n: q.cats_sec, pct: pct('cats_sec'), extra: true, info: true },
      { key: 'cup', label: 'Collegate a un\'opera (CUP)', n: q.cup, pct: pct('cup'), extra: true, info: true },
    ],
    subcontracts: q.subcontracts,
  };
}

function limits(settings) {
  const min = Number(settings.concorrenza?.min_amount) || 0;
  return [
    'Lavori privati: ANAC raccoglie solo gli appalti pubblici.',
    min ? `Affidamenti sotto ${min.toLocaleString('it-IT')} € (si cambia nelle Impostazioni del CRM, Concorrenza).` : null,
    'Gare in corso, deserte o annullate: solo quelle aggiudicate.',
    'Categorie secondarie: una gara conta solo per la sua categoria prevalente.',
    'La zona è quella dell\'ente che fa la gara, non quella del cantiere.',
    'L\'ultimo mese è incompleto: le stazioni appaltanti comunicano gli esiti con ritardo.',
  ].filter(Boolean);
}

async function sources(db) {
  return [await anacSource(db), ...SOON.map(s => ({ ...s, status: 'in_arrivo' }))];
}

module.exports = { sources, quality, limits, anacSource, STALE_H };
