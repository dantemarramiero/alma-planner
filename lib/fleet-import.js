// Importazione dei mezzi dall'esportazione CSV di Zoho CRM (modulo «Mezzi», «Tutti i campi»).
// Uniforma i valori scritti in modi diversi (categorie, alimentazione, classe ambientale, possesso), separa marca e
// modello, mette la matricola delle macchine nel telaio quando non è una targa, segnala doppioni e dati mancanti.
// Ogni mezzo resta agganciato al suo record di Zoho (external_ref): reimportare aggiorna, non duplica.
const { HttpError } = require('./http');
const { newQrToken } = require('./fleet');

// Categorie concordate con Dante (13/10/2026): valore di Zoho → categoria di Alma Planet.
const CATEGORY_MAP = new Map(Object.entries({
  autovettura: 'Autovetture', auto: 'Autovetture',
  autocarro: 'Autocarri', 'autocarro per trasporto di cose': 'Autocarri',
  'autocarro furgone con cassone aperto': 'Furgoni con cassone aperto',
  'autocarro furgone senza cassone': 'Furgoni senza cassone',
  'autocarro furgone con cassone chiuso': 'Furgoni con cassone chiuso',
  escavatore: 'Escavatori', escavatori: 'Escavatori',
  'escavatore gru': 'Escavatori con gru',
  motociclo: 'Motocicli',
}));
const UNCLASSIFIED = 'Da classificare';
const CATEGORY_ORDER = ['Autovetture', 'Autocarri', 'Furgoni con cassone aperto', 'Furgoni senza cassone', 'Furgoni con cassone chiuso', 'Escavatori', 'Escavatori con gru', 'Motocicli', UNCLASSIFIED];

const FUEL_MAP = {
  gasolio: 'Gasolio', diesel: 'Gasolio', benzina: 'Benzina', elettrico: 'Elettrico', gpl: 'GPL', metano: 'Metano',
  'benzina/elettrico': 'Ibrido benzina/elettrico', 'benzina/gpl': 'Benzina/GPL', 'benzina/metano': 'Benzina/Metano',
};
// Marche riconosciute all'inizio del modello; per alcuni modelli Fiat la marca in Zoho manca.
const MAKES = ['ALFA ROMEO', 'LAND ROVER', 'MERCEDES-BENZ', 'MERCEDES', 'FIAT', 'IVECO', 'PEUGEOT', 'CITROEN', 'CITROËN', 'RENAULT', 'FORD', 'OPEL', 'NISSAN', 'TOYOTA',
  'VOLKSWAGEN', 'VW', 'AUDI', 'BMW', 'DACIA', 'JEEP', 'MITSUBISHI', 'ISUZU', 'HYUNDAI', 'KIA', 'TESLA', 'SKODA', 'SEAT', 'SUZUKI', 'LANCIA', 'PIAGGIO', 'HONDA',
  'YANMAR', 'CATERPILLAR', 'CAT', 'KUBOTA', 'BOBCAT', 'JCB', 'KOMATSU', 'HITACHI', 'TAKEUCHI', 'VOLVO', 'MAN', 'SCANIA', 'DAF', 'EUROCOMACH', 'VERMEER', 'MANITOU', 'MERLO'];
const FIAT_MODELS = /^(GRANDE PUNTO|PUNTO|PANDA|DOBLO|DOBLÒ|DUCATO|FIORINO|TALENTO|SCUDO|QUBO|TIPO|500)\b/i;
// Marche scritte dentro il testo («GIREVOLE YANMAR», «TERNA JCB 2 CX») e modelli che dicono la marca da soli.
const MAKES_INSIDE = ['YANMAR', 'CATERPILLAR', 'JCB', 'KUBOTA', 'BOBCAT', 'GEHL', 'MAGNI', 'MANITOU', 'MERLO', 'VERMEER', 'VERMER', 'FERRARI', 'ASTRA', 'MG'];
const MODEL_MAKE = [
  [/^(EUROCARGO|STRALIS|TRAKKER|DAILY|TECTOR)\b/i, 'Iveco'],
  [/^(208|2008|308|3008|PARTNER|BOXER|EXPERT|RIFTER)\b/i, 'Peugeot'],
  [/^(STELVIO|GIULIA|GIULIETTA|TONALE)\b/i, 'Alfa Romeo'],
  [/^(VESPA|PORTER|APE)\b/i, 'Piaggio'],
];

// Targhe italiane: auto/autocarri (AA000AA), macchine operatrici e agricole (AAA000), rimorchi (AA00000).
const PLATE_RE = /^([A-Z]{2}\d{3}[A-Z]{2}|[A-Z]{3}\d{3}|[A-Z]{2}\d{5})$/;

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

// Numeri: l'esportazione di Zoho usa il punto per i decimali e niente migliaia («33642.16»); se c'è una virgola
// il numero è scritto all'italiana («1.234,50»).
const num = s => {
  const t = String(s ?? '').replace(/\s|€/g, '');
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
};
const cap = s => String(s || '').toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

function splitModel(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return { make: '', model: '' };
  const up = s.toUpperCase();
  const make = MAKES.find(m => up === m || up.startsWith(`${m} `));
  if (make) return { make: cap(make === 'VW' ? 'Volkswagen' : make === 'CAT' ? 'Caterpillar' : make), model: s.slice(make.length).trim() };
  if (FIAT_MODELS.test(s)) return { make: 'Fiat', model: s };
  const hint = MODEL_MAKE.find(([re]) => re.test(s));
  if (hint) return { make: hint[1], model: s };
  const inside = MAKES_INSIDE.find(m => new RegExp(`(^|\\s)${m}(\\s|$)`, 'i').test(s));
  if (inside) {
    const name = inside === 'VERMER' ? 'Vermeer' : inside === 'MG' || inside === 'JCB' ? inside : cap(inside);
    return { make: name, model: s.replace(new RegExp(`(^|\\s)${inside}(?=\\s|$)`, 'i'), ' ').replace(/\s+/g, ' ').trim() || s };
  }
  return { make: '', model: s };
}

// Una riga di Zoho → campi del mezzo + avvisi.
function mapRow(r) {
  const warn = [];
  const zohoId = r['ID record'];
  const uid = (r.UID || '').trim();
  const rawPlate = (r.Targa || '').trim();
  const norm = rawPlate.replace(/\s+/g, '').toUpperCase();
  const isPlate = PLATE_RE.test(norm);
  const catRaw = (r.Categoria || '').trim();
  const category = catRaw ? (CATEGORY_MAP.get(catRaw.toLowerCase()) || cap(catRaw)) : UNCLASSIFIED;
  if (!catRaw) warn.push('categoria vuota in Zoho: va in «Da classificare»');
  const own = `${r.Stato || ''} ${r['Tipo di proprietà'] || ''}`.toUpperCase();
  const ownership = /NOLEGG|LOCAZ/.test(own) ? 'noleggio' : 'proprieta';
  if (!own.trim()) warn.push('possesso non indicato in Zoho: messo «Proprietà»');
  const fuelRaw = (r.Alimentazione || '').trim();
  const fuel = fuelRaw ? (FUEL_MAP[fuelRaw.toLowerCase()] || cap(fuelRaw)) : '';
  const env = (r['Classe Ambientale'] || '').trim().toUpperCase().replace(/^EUR\s*(?=\d)/, 'EURO ').replace(/^EURO(?=\d)/, 'EURO ');
  const { make, model } = splitModel(r.Modello);
  const statusRaw = (r.Stato || '').trim().toLowerCase();
  const desc = (r.Descrizione || '').trim();
  const annual = Object.fromEntries([
    ['revisione', num(r.Revisione)], ['carburanti', num(r['Costo Carburanti (€)'])],
    ['assicurazione', num(r['Assicurazioni(€)'])], ['bollo', num(r['Bollo(€)'])],
  ].filter(([, n]) => n));
  return {
    external_ref: `zoho:${zohoId}`,
    code: uid || `ZOHO-${zohoId.slice(-6)}`,
    category,
    plate: isPlate ? norm : null,
    vin: isPlate ? '' : rawPlate,       // macchine: matricola o telaio al posto della targa
    make, model,
    fuel,
    env_class: env,
    ownership,
    status: statusRaw === 'venduto' ? 'dismesso' : 'attivo',
    status_note: statusRaw === 'in dismissione' ? 'In dismissione (da Zoho)' : '',
    purchase_value: num(r['Valore Acquisto']) || null,
    depreciation_rate: num(r['Aliquota percentuale di ammortamento']),
    hourly_cost: num(r['Costo orario']) || null,
    annual_costs: annual,
    commessa: (r.Commessa || '').trim(),
    notes: desc,
    _plate_raw: rawPlate,
    _warn: warn,
  };
}

// Dal testo CSV al piano: mezzi da creare o aggiornare, categorie nuove, avvisi.
async function planImport(db, csvText) {
  const text = String(csvText || '').replace(/^﻿/, '');
  const [head, ...rows] = parseCsv(text);
  if (!head || !head.includes('ID record') || !head.includes('Targa')) {
    throw new HttpError(400, 'Il file non sembra un\'esportazione dei Mezzi di Zoho CRM (mancano le colonne «ID record» e «Targa»). Esporta con «Tutti i campi» in formato CSV.');
  }
  if (rows.length > 5000) throw new HttpError(400, 'Troppe righe (massimo 5000)');
  const records = rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  const vehicles = records.filter(r => r['ID record']).map(mapRow);

  // doppioni di targa o matricola dentro il file: il secondo tiene il dato nel telaio, senza targa (la targa è unica)
  const seenPlate = new Map(), seenVin = new Map(), seenCode = new Set();
  for (const x of vehicles) {
    if (x.plate) {
      if (seenPlate.has(x.plate)) { x._warn.push(`targa ${x.plate} uguale a ${seenPlate.get(x.plate)}: tenuta solo come telaio, da verificare in Zoho`); x.vin = x.plate; x.plate = null; }
      else seenPlate.set(x.plate, x.code);
    } else if (x.vin) {
      const key = x.vin.toUpperCase().replace(/\s+/g, '');
      if (seenVin.has(key)) x._warn.push(`matricola uguale a ${seenVin.get(key)}: da verificare in Zoho`);
      else seenVin.set(key, x.code);
      // stessa matricola scritta in due macchine diverse (es. «CAT 309 … GW902030» e «CAT 265 … GW902030»)
      const serial = key.match(/MATRICOLA([A-Z0-9]+)/)?.[1];
      if (serial) {
        const prev = [...seenVin.entries()].find(([k, c]) => c !== x.code && k.includes(`MATRICOLA${serial}`) && k !== key);
        if (prev) x._warn.push(`matricola ${serial} anche su ${prev[1]}: da verificare in Zoho`);
      }
    }
    if (seenCode.has(x.code.toLowerCase())) { x._warn.push(`codice ${x.code} ripetuto: aggiunto il suffisso`); x.code = `${x.code}-${x.external_ref.slice(-4)}`; }
    seenCode.add(x.code.toLowerCase());
  }

  const { rows: existing } = await db.query('SELECT id, external_ref, code, plate FROM vehicles');
  const byRef = new Map(existing.filter(e => e.external_ref).map(e => [e.external_ref, e]));
  const byPlate = new Map(existing.filter(e => e.plate).map(e => [e.plate.toUpperCase(), e]));
  const byCode = new Map(existing.map(e => [e.code.toLowerCase(), e]));
  for (const x of vehicles) {
    const match = byRef.get(x.external_ref) || (x.plate && byPlate.get(x.plate)) || null;
    x._action = match ? 'aggiorna' : 'nuovo';
    x._id = match?.id || null;
    // un mezzo già in Alma Planet con la stessa targa ma non agganciato a Zoho: viene agganciato e aggiornato
    if (match && !match.external_ref) x._warn.push(`già presente in Alma Planet come ${match.code}: viene agganciato a Zoho e aggiornato`);
    const clash = byCode.get(x.code.toLowerCase());
    if (clash && clash.id !== x._id) { x._warn.push(`codice ${x.code} già usato da un altro mezzo: aggiunto il suffisso`); x.code = `${x.code}-Z`; }
  }

  const { rows: cats } = await db.query('SELECT name FROM vehicle_categories');
  const known = new Set(cats.map(c => c.name.toLowerCase()));
  const byCategory = {};
  for (const x of vehicles) byCategory[x.category] = (byCategory[x.category] || 0) + 1;
  const newCategories = Object.keys(byCategory).filter(c => !known.has(c.toLowerCase()))
    .sort((a, b) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99));
  const count = k => vehicles.filter(x => x[k] && (typeof x[k] !== 'object' || Object.keys(x[k]).length)).length;
  return {
    vehicles,
    summary: {
      total: vehicles.length,
      new: vehicles.filter(x => x._action === 'nuovo').length,
      update: vehicles.filter(x => x._action === 'aggiorna').length,
      by_category: byCategory,
      new_categories: newCategories,
      without_plate: vehicles.filter(x => !x.plate).length,
      with_commessa: count('commessa'),
      with_costs: count('annual_costs'),
      with_value: count('purchase_value'),
      warnings: vehicles.filter(x => x._warn.length).length,
    },
  };
}

// Applica il piano: categorie mancanti, poi ogni mezzo creato o aggiornato. Km, foto, QR, assegnazioni e stato
// cambiato in Alma Planet non si toccano nei mezzi già presenti (tranne «Venduto» in Zoho → dismesso).
async function applyImport(db, plan, userId) {
  return db.tx(async q => {
    let pos = (await q.query('SELECT COALESCE(MAX(position), 0) AS p FROM vehicle_categories')).rows[0].p;
    for (const name of plan.summary.new_categories) {
      await q.query('INSERT INTO vehicle_categories (name, position) VALUES ($1, $2) ON CONFLICT DO NOTHING', [name, ++pos]);
    }
    const { rows: cats } = await q.query('SELECT id, name FROM vehicle_categories');
    const catId = name => cats.find(c => c.name.toLowerCase() === name.toLowerCase()).id;
    let created = 0, updated = 0;
    for (const x of plan.vehicles) {
      const f = {
        category_id: catId(x.category), code: x.code, plate: x.plate, vin: x.vin, make: x.make, model: x.model, fuel: x.fuel,
        env_class: x.env_class, ownership: x.ownership, purchase_value: x.purchase_value, depreciation_rate: x.depreciation_rate,
        hourly_cost: x.hourly_cost, annual_costs: JSON.stringify(x.annual_costs), commessa: x.commessa, notes: x.notes, external_ref: x.external_ref,
      };
      if (x._action === 'nuovo') {
        Object.assign(f, { status: x.status, status_note: x.status_note, qr_token: newQrToken(), created_by: userId });
        const cols = Object.keys(f);
        await q.query(`INSERT INTO vehicles (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(f));
        created++;
      } else {
        if (x.status === 'dismesso') f.status = 'dismesso';
        const cols = Object.keys(f);
        await q.query(`UPDATE vehicles SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [x._id, ...Object.values(f)]);
        updated++;
      }
    }
    return { created, updated, categories: plan.summary.new_categories.length };
  });
}

module.exports = { planImport, applyImport, mapRow, parseCsv, CATEGORY_MAP };
