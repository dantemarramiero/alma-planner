// Radar commerciale: punteggio dei segnali, lettura dell'export di Infordat, piano d'azione proposto dal playbook.
// Punteggio (Dante 14/11/2026): Coerenza con la BU + Concretezza + Tempi + Rapporto + Valore, pesi nelle impostazioni.
// Senza chiave AI il radar lavora sulle fonti strutturate (Infordat, segnalazioni a mano); la lettura delle notizie e
// i piani scritti su misura arrivano quando su Railway c'è ANTHROPIC_API_KEY.

const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// «OG 1», «OG-1», «og1», «OS 2-A» → OG1, OS2-A
function soaCodes(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/\b(OG|OS)\s*-?\s*(\d{1,2})(?:\s*-\s*([A-D]))?\b/gi)) out.add(`${m[1].toUpperCase()}${Number(m[2])}${m[3] ? `-${m[3].toUpperCase()}` : ''}`);
  return [...out];
}

// concretezza per tipo di segnale (frazioni dei punti: 25 / 18 / 10 / 5)
const CONCRETE = { gara: 1, opera_finanziata: 1, scadenza: 1, permesso: 0.72, nuovo_gestore: 0.72, investimento: 0.4, cliente: 0.4, notizia: 0.4, indiscrezione: 0.2 };

// quanto un segnale c'entra con il profilo di una BU (0…1), con i motivi
function fitOf(sig, p) {
  const text = norm(`${sig.title} ${sig.summary} ${sig.entity}`);
  const why = [];
  if ((p.exclude || []).some(w => w && text.includes(norm(w)))) return { fit: 0, why: ['contiene parole da escludere'] };
  const parts = [];
  if (sig.soa?.length && p.soa?.length) {
    const hit = sig.soa.filter(c => p.soa.includes(c));
    parts.push(hit.length ? 1 : 0);
    if (hit.length) why.push(`SOA ${hit.join(', ')}`);
  }
  const kw = (p.keywords || []).filter(w => w && text.includes(norm(w)));
  const works = (p.works || []).filter(w => w && norm(w).split(' ').filter(x => x.length > 4).some(x => text.includes(x)));
  const hits = kw.length + works.length;
  if (p.keywords?.length || p.works?.length) parts.push(hits >= 2 ? 1 : hits === 1 ? 0.7 : 0.2);
  if (kw.length) why.push(`parole: ${kw.slice(0, 3).join(', ')}`);
  if (p.regions?.length && sig.region) parts.push(p.regions.some(r => norm(r) === norm(sig.region)) ? 1 : 0.3);
  if (sig.amount != null && (p.amount_min != null || p.amount_max != null)) {
    const inside = (p.amount_min == null || sig.amount >= p.amount_min) && (p.amount_max == null || sig.amount <= p.amount_max);
    parts.push(inside ? 1 : 0.5);
    if (inside) why.push('importo nella fascia');
  }
  return { fit: parts.length ? parts.reduce((s, x) => s + x, 0) / parts.length : 0.3, why };
}

// punteggio 0…100 con il dettaglio per criterio
function scoreSignal(sig, profile, scoring, { relationship = 'unknown', today = new Date().toISOString().slice(0, 10) } = {}) {
  const w = scoring.weights;
  const { fit, why } = fitOf(sig, profile || {});
  const concrete = CONCRETE[sig.kind] ?? 0.4;
  let timing = 0.53;
  if (sig.deadline) {
    const months = (Date.parse(sig.deadline) - Date.parse(today)) / (30.4 * 86400000);
    timing = months <= 12 ? 1 : months <= 24 ? 0.53 : 0.2;
  }
  const rel = relationship === 'client' ? 1 : relationship === 'known' ? 0.53 : 0;
  let value = 0.4;
  if (sig.amount != null && profile) {
    const below = profile.amount_min != null && sig.amount < profile.amount_min;
    value = below ? 0.4 : 1;
  }
  const parts = {
    fit: Math.round(w.fit * fit), concreteness: Math.round(w.concreteness * concrete), timing: Math.round(w.timing * timing),
    relationship: Math.round(w.relationship * rel), value: Math.round(w.value * value),
  };
  if (relationship === 'client') why.push('cliente attuale');
  else if (relationship === 'known') why.push('già nel CRM');
  return { score: Math.min(100, Object.values(parts).reduce((s, n) => s + n, 0)), parts, why };
}

// BU a cui va il segnale: quella con la coerenza più alta (tra quelle con un profilo compilato)
function bestBu(sig, profiles) {
  let best = null;
  for (const [k, p] of Object.entries(profiles)) {
    if (!p.description && !(p.keywords || []).length) continue;
    const { fit } = fitOf(sig, p);
    if (!best || fit > best.fit) best = { bu: k, fit };
  }
  return best && best.fit > 0 ? best.bu : null;
}

// ── export di Infordat (CSV con ; o , oppure Excel) ───────────────────────────────────────────
function parseDelimited(text) {
  // separatore: quello che compare di più nelle prime righe (sopra le intestazioni a volte c'è un titolo)
  const head = text.split('\n', 6).join('\n');
  const count = ch => (head.match(new RegExp(ch, 'g')) || []).length;
  const sep = [';', '\t', ','].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}
// colonne riconosciute (il file vero di Infordat le confermerà)
const COLS = {
  id: ['id', 'codice', 'codice gara', 'rif', 'riferimento', 'numero', 'n.', 'id gara', 'codice infordat'],
  title: ['oggetto', 'oggetto gara', 'oggetto dell\'appalto', 'descrizione', 'titolo', 'oggetto appalto'],
  entity: ['ente', 'stazione appaltante', 'amministrazione', 'ente appaltante', 'committente', 'amministrazione aggiudicatrice'],
  amount: ['importo', 'importo base', 'importo a base d\'asta', 'importo base d\'asta', 'importo lavori', 'importo complessivo', 'valore', 'importo totale'],
  deadline: ['scadenza', 'data scadenza', 'termine', 'scadenza offerte', 'data termine', 'termine presentazione offerte', 'scadenza presentazione'],
  published: ['data pubblicazione', 'pubblicazione', 'data', 'pubblicata il', 'data inserimento'],
  cig: ['cig', 'codice cig'],
  soa: ['categoria', 'categoria prevalente', 'soa', 'categorie', 'og/os', 'categorie soa', 'cat. prevalente', 'categorie scorporabili'],
  region: ['regione'],
  place: ['provincia', 'comune', 'luogo', 'localita', 'luogo di esecuzione', 'citta'],
  url: ['link', 'url', 'bando', 'link bando', 'indirizzo'],
  procedure: ['procedura', 'tipo procedura', 'tipologia', 'criterio'],
};
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  let t = String(v).replace(/[€\s]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function dateOf(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10); // data di Excel
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}
function readInfordat(rows) {
  const headAt = rows.findIndex(r => r.filter(x => String(x).trim()).length >= 3); // a volte ci sono righe di titolo sopra
  if (headAt < 0) return { rows: [], columns: {}, missing: ['oggetto'] };
  const head = rows[headAt].map(norm);
  const columns = {};
  for (const [k, names] of Object.entries(COLS)) {
    const i = head.findIndex(h => names.includes(h));
    const j = i >= 0 ? i : head.findIndex(h => names.some(n => n.length > 3 && h.startsWith(n)));
    if (j >= 0) columns[k] = j;
  }
  const missing = ['title'].filter(k => columns[k] === undefined).map(() => 'oggetto');
  const cell = (r, k) => (columns[k] === undefined ? '' : r[columns[k]] ?? '');
  const out = [];
  for (const r of rows.slice(headAt + 1)) {
    const title = String(cell(r, 'title')).trim().replace(/\s+/g, ' ');
    if (!title) continue;
    const cig = String(cell(r, 'cig')).trim().toUpperCase();
    const id = String(cell(r, 'id')).trim() || cig || norm(`${title} ${cell(r, 'entity')}`).slice(0, 180);
    out.push({
      external_id: id.slice(0, 200), title: title.slice(0, 500), entity: String(cell(r, 'entity')).trim().slice(0, 300), amount: num(cell(r, 'amount')),
      deadline: dateOf(cell(r, 'deadline')), published_on: dateOf(cell(r, 'published')), cig: cig.slice(0, 20), soa: soaCodes(`${cell(r, 'soa')} ${title}`),
      region: String(cell(r, 'region')).trim().slice(0, 60), place: String(cell(r, 'place')).trim().slice(0, 120), url: /^https?:\/\//i.test(String(cell(r, 'url')).trim()) ? String(cell(r, 'url')).trim().slice(0, 500) : '',
      summary: String(cell(r, 'procedure')).trim().slice(0, 300),
    });
  }
  return { rows: out, columns: Object.fromEntries(Object.entries(columns).map(([k, i]) => [k, rows[headAt][i]])), missing };
}

// ── piano d'azione proposto dal playbook ──────────────────────────────────────────────────────
const OFFSETS = [2, 7, 14, 21, 30, 45, 60, 75, 90, 105, 120, 135];
function channelOf(text) {
  const t = norm(text);
  if (/sopralluog/.test(t)) return 'sopralluogo';
  if (/incontr|visita|riunion/.test(t)) return 'incontro';
  if (/chiam|telefon/.test(t)) return 'telefonata';
  if (/email|mail|mandar|inviar|presentazion/.test(t)) return 'email';
  return '';
}
function pickPlaybook(playbooks, { kind, bu, isClient }) {
  return playbooks.find(p => p.id === kind)
    || (isClient && playbooks.find(p => p.id === 'cliente'))
    || playbooks.find(p => p.bu?.includes(bu))
    || playbooks.find(p => !p.bu?.length)
    || playbooks[0];
}
function addDays(iso, n) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function proposePlan({ playbook, signal, subject, contact, ownerId, refs = [], today }) {
  const who = contact ? [contact.title, contact.first_name, contact.last_name].filter(Boolean).join(' ') : '';
  const steps = playbook.steps.map((t, i) => {
    const channel = channelOf(t);
    const draft = i === 0 && (channel === 'email' || channel === 'telefonata' || /contatto/i.test(t))
      ? `Buongiorno${who ? ` ${who}` : ''},\n${signal ? `abbiamo letto di «${signal.title}»` : `vi contattiamo per ${subject.name}`}. Almacis ha lavorato su interventi simili${refs.length ? ` (${refs.slice(0, 2).join(', ')})` : ''} e ci farebbe piacere capire come possiamo esservi utili. Avete dieci minuti nei prossimi giorni?\n\nUn saluto`
      : '';
    return { title: t, due_date: addDays(today, OFFSETS[i] ?? 30 + i * 15), owner_id: ownerId, contact_id: contact?.id || null, channel, draft };
  });
  if (playbook.check) steps.push({ title: `Verifica: ${playbook.check}`, due_date: addDays(today, (OFFSETS[playbook.steps.length] ?? 60) + 7), owner_id: ownerId, contact_id: null, channel: '', draft: '' });
  return { playbook_id: playbook.id, title: signal ? signal.title : playbook.name, check_question: playbook.check || '', refs: refs.join(', '), steps };
}

module.exports = { norm, soaCodes, fitOf, scoreSignal, bestBu, parseDelimited, readInfordat, proposePlan, pickPlaybook, channelOf, CONCRETE };
