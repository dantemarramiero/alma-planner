// Concorrenza (dati ANAC) e «Prima del bando» (Dante 17/11/2026, punti 3 e 5; canvas «v4»).
// - /api/crm/concorrenza: chi vince nelle categorie e zone della BU, ribasso tipico, ATI, le nostre gare;
// - /api/crm/concorrenza/stima: per una gara, ribasso tipico e probabili concorrenti;
// - /api/crm/prima-del-bando: segnali divisi per fase (programmata → determina) e gare vinte da altri;
// - ogni giorno alle 5 si caricano i mesi ANAC nuovi e si propongono le gare vinte da altri (subappalto o ATI).
// I dati ANAC sono pubblici: li vedono tutti quelli che usano il CRM.
const { HttpError, v } = require('../lib/http');
const { loadSettings, managerOf } = require('../lib/crm-commerciale');
const { syncAnac, isRunning, normCat } = require('../lib/crm-anac');
const { overview, estimate, awardByCig, isOurs, scopeOf, linkSubjects } = require('../lib/crm-concorrenza');
const { regionsView, regionDetail, partnersView } = require('../lib/crm-concorrenza-regioni');

const STAGES = ['programmata', 'finanziata', 'progetto', 'determina'];
const anacUrl = cig => `https://dati.anticorruzione.it/superset/dashboard/dettaglio_cig/?cig=${encodeURIComponent(cig)}`;
const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

function registerCrmConcorrenza(app, { db, radar, anacFetch }) {
  async function ctx(req) {
    const [settings, { rows: users }] = await Promise.all([loadSettings(db), db.query('SELECT id, name, email FROM users')]);
    const myBus = Object.entries(settings.profiles).filter(([, p]) => managerOf(p, users)?.id === req.user.id).map(([k]) => k);
    return { settings, users, myBus };
  }
  const buOk = (c, bu) => { if (bu && !c.settings.profiles[bu]) throw new HttpError(404, 'BU sconosciuta'); return bu || ''; };

  app.get('/api/crm/concorrenza', async (req, res) => {
    const c = await ctx(req);
    const bu = buOk(c, String(req.query.bu ?? (c.myBus[0] || '')));
    const months = [12, 24].includes(Number(req.query.months)) ? Number(req.query.months) : Math.min(12, c.settings.concorrenza.months);
    const amount = req.query.amount === 'tutte' ? null : 'profilo';
    const regions = req.query.regions === 'tutte' ? [] : undefined;
    const [o, { rows: [st] }] = await Promise.all([
      overview(db, c.settings, bu || null, { months, amount, regions }),
      db.query("SELECT COUNT(*)::int AS gare, MAX(month) AS ultimo FROM crm_anac_awards"),
    ]);
    const { rows: imports } = await db.query('SELECT month, kept, error, at FROM crm_anac_imports ORDER BY month DESC LIMIT 1');
    res.json({ ...o, bus: Object.keys(c.settings.profiles).filter(k => (c.settings.profiles[k].soa || []).length || (c.settings.concorrenza.cpv?.[k] || []).length), myBus: c.myBus,
      data: { gare: st.gare, ultimo: st.ultimo, at: imports[0]?.at || null, running: isRunning(), on: c.settings.concorrenza.on }, admin: req.crm.admin });
  });

  // per una gara (segnale) o per categoria/zona/importo
  app.get('/api/crm/concorrenza/stima', async (req, res) => {
    const c = await ctx(req);
    let q = { category: req.query.category, region: req.query.region, amount: req.query.amount ? Number(req.query.amount) : null, criterion: req.query.criterion };
    let award = null;
    if (req.query.signal_id) {
      const { rows: [g] } = await db.query('SELECT soa, region, amount, cig FROM crm_signals WHERE id = $1', [v.int(req.query.signal_id, 'Segnale', { min: 1 })]);
      if (!g) throw new HttpError(404, 'Segnale non trovato');
      q = { category: g.soa?.[0] || '', region: g.region, amount: g.amount === null ? null : Number(g.amount) };
      if (g.cig) award = await awardByCig(db, g.cig);
      if (!q.category && award) q.category = award.category;
    }
    const est = q.category ? await estimate(db, c.settings, q) : null;
    res.json({ estimate: est, award: award ? { ...award, ours: isOurs(c.settings, award.winners) } : null, category: normCat(q.category) });
  });

  // stato e «Aggiorna adesso» (direzione)
  app.get('/api/crm/concorrenza/stato', async (req, res) => {
    if (!req.crm.admin) throw new HttpError(403, 'Solo la direzione');
    const { rows } = await db.query('SELECT * FROM crm_anac_imports ORDER BY month DESC LIMIT 36');
    res.json({ imports: rows, running: isRunning() });
  });
  app.post('/api/crm/concorrenza/aggiorna', async (req, res) => {
    if (!req.crm.admin) throw new HttpError(403, 'Solo la direzione');
    const settings = await loadSettings(db);
    if (isRunning()) return res.json({ running: true });
    syncAnac(db, settings, { fetchImpl: anacFetch || fetch }).then(() => vinteAltri()).catch(err => console.warn('[anac]', err.message));
    res.json({ running: true });
  });

  // impresa di ANAC → scheda del CRM (concorrente o partner); se c'è già, si aggiunge il ruolo
  // un'impresa dei dati ANAC nel CRM (o il ruolo aggiunto se c'è già): { id, created }
  async function ensureSubject(req, role) {
    const name = v.text(req.body.name, 'Impresa', { max: 200, required: true });
    const cf = String(req.body.cf || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    const found = [{ cf, name }];
    await linkSubjects(db, found);
    if (found[0].subject) {
      if (!found[0].subject.roles.includes(role)) await db.query('UPDATE crm_subjects SET roles = array_append(roles, $2) WHERE id = $1', [found[0].subject.id, role]);
      return { id: found[0].subject.id, name: found[0].subject.name, created: false };
    }
    const { rows: [s] } = await db.query(`INSERT INTO crm_subjects (name, vat, roles, asa, owner_id, origin, created_by) VALUES ($1, $2, $3, '{}', $4, 'ANAC', $4) RETURNING id, name`,
      [name, /^\d{11}$/.test(cf) ? cf : '', [role], req.user.id]);
    return { id: s.id, name: s.name, created: true };
  }
  app.post('/api/crm/concorrenza/scheda', async (req, res) => {
    const s = await ensureSubject(req, req.body.role === 'partner' ? 'partner' : 'concorrente');
    res.status(s.created ? 201 : 200).json({ id: s.id, created: s.created });
  });

  // ── Regioni e Partner (canvas v12, Dante 21/11/2026) ─────────────────────────────────────────
  const monthsOf = (c, q) => ([12, 24].includes(Number(q)) ? Number(q) : Math.min(24, c.settings.concorrenza.months || 24));
  const busOf = c => Object.keys(c.settings.profiles).filter(k => (c.settings.profiles[k].soa || []).length || (c.settings.concorrenza.cpv?.[k] || []).length);
  app.get('/api/crm/concorrenza/regioni', async (req, res) => {
    const c = await ctx(req);
    const bus = busOf(c);
    const bu = buOk(c, String(req.query.bu || c.myBus.find(b => bus.includes(b)) || bus[0] || ''));
    res.json({ ...(await regionsView(db, c.settings, bu || null, { months: monthsOf(c, req.query.months) })), bus });
  });
  app.get('/api/crm/concorrenza/regioni/:region', async (req, res) => {
    const c = await ctx(req);
    const bu = buOk(c, String(req.query.bu || ''));
    const d = await regionDetail(db, c.settings, bu || null, req.params.region, { months: monthsOf(c, req.query.months) });
    if (!d) throw new HttpError(404, 'Nessuna gara in questa regione con questi filtri');
    res.json(d);
  });
  app.get('/api/crm/concorrenza/partner', async (req, res) => {
    const c = await ctx(req);
    const bu = req.query.bu ? buOk(c, String(req.query.bu)) : (c.myBus.find(b => busOf(c).includes(b)) || '');
    res.json(await partnersView(db, c.settings, { months: monthsOf(c, req.query.months), bus: busOf(c), bu, region: String(req.query.region || '') }));
  });
  // «Proponi un incontro»: l'impresa nel CRM come partner e un passo «Incontro» a chi lo chiede, entro una settimana
  app.post('/api/crm/concorrenza/incontro', async (req, res) => {
    const s = await ensureSubject(req, 'partner');
    const bu = req.body.bu && c0(req.body.bu);
    const where = String(req.body.region || '').slice(0, 60);
    const due = new Date(Date.now() + 7 * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
    const title = `Incontro con ${s.name}: partner${bu ? ` per ${bu}` : ''}${where ? ` in ${where}` : ''}`.slice(0, 300);
    const { rows: [st] } = await db.query(`INSERT INTO crm_steps (subject_id, title, channel, due_date, owner_id, created_by) VALUES ($1, $2, 'incontro', $3, $4, $4) RETURNING id`,
      [s.id, title, due, req.user.id]);
    await db.query( // il primo passo aperto torna sulla scheda (come in routes/crm-commerciale.js)
      `UPDATE crm_subjects s SET next_step = COALESCE(x.title, ''), next_step_date = x.due_date
         FROM (SELECT $1::int AS id) k LEFT JOIN LATERAL (
           SELECT title, due_date FROM crm_steps WHERE subject_id = $1 AND done_at IS NULL ORDER BY due_date, sort, id LIMIT 1) x ON true
        WHERE s.id = k.id`, [s.id]);
    res.status(201).json({ subject_id: s.id, step_id: st.id, created: s.created, due_date: due });
  });
  const c0 = x => String(x).replace(/_/g, ' ').slice(0, 40);

  // ── Prima del bando ─────────────────────────────────────────────────────────────────────────
  // «Cerca un'impresa» (v11 · Concorrenza e gare): per nome o P.IVA tra chi ha vinto gare ANAC, anche se non è nel CRM
  app.get('/api/crm/concorrenza/cerca', async (req, res) => {
    const q = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (q.length < 2) return res.json({ imprese: [] });
    const cf = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const { rows } = await db.query(
      `SELECT w->>'cf' AS cf, max(w->>'name') AS name, count(*)::int AS vinte, sum(a.amount) AS valore
         FROM crm_anac_awards a, jsonb_array_elements(a.winners) w
        WHERE (w->>'name') ILIKE $1 OR ($2 <> '' AND length($2) >= 6 AND (w->>'cf') LIKE $2 || '%')
        GROUP BY 1 ORDER BY count(*) DESC LIMIT 8`, [`%${q}%`, cf]);
    res.json({ imprese: rows.map(r => ({ cf: r.cf || '', name: r.name, vinte: r.vinte, valore: r.valore != null ? Number(r.valore) : null })) });
  });

  app.get('/api/crm/prima-del-bando', async (req, res) => {
    const c = await ctx(req);
    const bus = req.query.bu ? [buOk(c, String(req.query.bu))] : req.crm.admin || !c.myBus.length ? Object.keys(c.settings.profiles) : c.myBus;
    if (req.query.bu && !req.crm.admin && !c.myBus.includes(bus[0]) && c.myBus.length) throw new HttpError(403, 'Vedi le tue BU');
    const within = [6, 12].includes(Number(req.query.within)) ? Number(req.query.within) : null;
    const { rows } = await db.query(
      `SELECT g.id, g.title, g.entity, g.subject_id, g.amount, g.bu, g.region, g.place, g.url, g.stage, g.expected_on, g.score, g.status, g.kind, g.summary, g.why, g.cig, g.created_at,
              a.label AS bu_label, s.name AS subject_name
         FROM crm_signals g LEFT JOIN crm_asa a ON a.key = g.bu LEFT JOIN crm_subjects s ON s.id = g.subject_id
        WHERE g.stage <> '' AND g.bu = ANY($1::text[]) AND g.status IN ('nuovo', 'interessa') AND NOT g.to_gare
          ${within ? `AND (g.expected_on IS NULL OR g.expected_on <= CURRENT_DATE + ($2 || ' months')::interval)` : ''}
        ORDER BY g.expected_on NULLS LAST, g.score DESC LIMIT 400`, within ? [bus, String(within)] : [bus]);
    const { relationsFor } = require('../lib/crm-relazioni');
    const rel = await relationsFor(db, [...new Set(rows.map(r => r.subject_id).filter(Boolean))], c.settings.relazioni);
    for (const r of rows) r.level = r.subject_id ? rel[r.subject_id]?.level || '' : '';
    res.json({
      stages: Object.fromEntries(STAGES.map(s => [s, rows.filter(r => r.stage === s)])),
      vinte_altri: rows.filter(r => r.stage === 'vinta_altri'),
      bus, myBus: c.myBus, on: c.settings.prima_bando,
    });
  });

  // gare vinte da altri negli ultimi N giorni, nelle categorie e zone della BU → segnali «subappalto o ATI»
  async function vinteAltri() {
    const settings = await loadSettings(db);
    if (!settings.prima_bando.vinte_altri || !radar?.addSignal) return 0;
    const { rows: users } = await db.query('SELECT id, name, email FROM users');
    const c = { settings, users, managerId: bu => managerOf(settings.profiles[bu], users)?.id || null };
    let added = 0;
    // una gara può andare bene a più BU (OG1 è anche del Restauro): va a quella per cui la categoria viene prima nel profilo
    const cand = new Map();
    for (const [bu, b] of Object.entries(settings.radar.bu)) {
      if (!b.on) continue;
      const s = scopeOf(settings, bu, { months: 12 });
      if (!s.cats.length && !s.cpv.length) continue;
      const { rows } = await db.query(
        `SELECT a.* FROM crm_anac_awards a WHERE ${s.sql} AND a.awarded_on >= CURRENT_DATE - ($${s.params.length + 1} || ' days')::interval
            AND jsonb_array_length(a.winners) BETWEEN 1 AND 4
            AND NOT EXISTS (SELECT 1 FROM crm_signals g WHERE g.source = 'anac' AND g.external_id = a.cig)
          ORDER BY COALESCE(a.amount, a.base_amount) DESC NULLS LAST LIMIT 200`,
        [...s.params, String(settings.prima_bando.days)]);
      for (const a of rows) {
        const rank = s.cats.indexOf(a.category) >= 0 ? s.cats.indexOf(a.category) : 0;
        const old = cand.get(a.cig);
        if (!old || rank < old.rank) cand.set(a.cig, { a, bu, rank });
      }
    }
    const byBu = {};
    for (const { a, bu } of cand.values()) (byBu[bu] ||= []).push(a);
    for (const [bu, list] of Object.entries(byBu)) {
      const rows = list.sort((x, y) => Number(y.amount ?? y.base_amount ?? 0) - Number(x.amount ?? x.base_amount ?? 0));
      let n = 0;
      for (const a of rows) {
        if (n >= settings.prima_bando.max_per_bu) break;
        if (isOurs(settings, a.winners)) continue;
        const lead = a.winners.find(w => w.role === 'mandataria') || a.winners[0];
        const sig = await radar.addSignal({ source: 'anac', external_id: a.cig, kind: 'subappalto', stage: 'vinta_altri', bu,
          title: `${lead.name} ha vinto: ${a.object}`.slice(0, 500), entity: lead.name, amount: a.amount ?? a.base_amount, region: a.region, place: a.sa_name,
          url: anacUrl(a.cig), published_on: a.awarded_on, cig: a.cig, soa: a.category ? [a.category] : [],
          summary: [a.sa_name, a.discount !== null ? `ribasso ${Number(a.discount).toLocaleString('it-IT')}%` : '', a.bidders ? `${a.bidders} offerenti` : '', a.winners.length > 1 ? `in ATI con ${a.winners.filter(w => w !== lead).map(w => w.name).join(', ')}` : ''].filter(Boolean).join(' · '),
          why: 'Gara vinta da altri nelle nostre categorie: proponi subappalto o ATI a chi ha vinto.' }, c, null);
        if (sig) { n++; added++; }
      }
    }
    return added;
  }

  // ogni giorno alle 5: mesi ANAC nuovi (il file del mese esce nei primi giorni) e gare vinte da altri
  if (!process.env.NODE_TEST_CONTEXT && process.env.ANAC_SYNC !== 'off') {
    let lastDay = '';
    const t = setInterval(async () => {
      try {
        const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }));
        if (hour !== 5 || lastDay === todayRome() || isRunning()) return;
        const settings = await loadSettings(db);
        if (!settings.concorrenza.on) return;
        await syncAnac(db, settings, { fetchImpl: anacFetch || fetch });
        lastDay = todayRome(); // solo se ANAC ha risposto: se no si riprova ogni 15 minuti fino alle 6 (21/11)
        await vinteAltri();
      } catch (err) { console.warn('[anac]', err.message); }
    }, 15 * 60000);
    t.unref?.();
  }
  return { vinteAltri };
}

module.exports = { registerCrmConcorrenza, STAGES };
