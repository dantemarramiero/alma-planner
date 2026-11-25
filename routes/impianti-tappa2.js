// Alma Impianti tappa 2 (ALM2-77, tavole 1, 3 e 6 del canvas approvato da Dante il 24/11/2026):
// - Home della BU: settori, opportunità da completare, segnali caldi, fondi da risentire, progettisti;
// - Opportunità col triangolo (chi finanzia, chi progetta, dove si fa) e la fase EPC, con le proposte per ciò che manca;
// - Energivori: elenco caricato da file, punteggio consumo × tetto, stime, «Porta nel radar».
// Si registra da routes/impianti.js con i suoi pezzi (impostazioni, ultimi contatti, segnali aperti, mandati).
const express = require('express');
const { HttpError, v } = require('../lib/http');
const { readXlsx } = require('../lib/xlsx');
const { parseDelimited } = require('../lib/crm-radar');
const { REGIONS } = require('../lib/energy-places');
const I = require('../lib/impianti');

const OPEN = "g.bu = 'impianti' AND (g.status IN ('interessa', 'boss') OR g.imp_stage <> '')";

function registerImpiantiTappa2(app, { db, settings, lastContacts, mainContacts, openSignals, matchesOf, mandateOut, kindOf, radarFetch }) {
  const raw = express.raw({ type: () => true, limit: '20mb' });
  const num = x => (x != null ? Number(x) : null);

  async function opportunities(where = '', params = []) {
    const { rows } = await db.query(`
      SELECT g.id, g.title, g.entity, g.sector, g.amount, g.region, g.place, g.stage, g.status, g.imp_stage, g.score, g.to_gare,
             g.subject_id, g.fund_id, g.designer_id, g.project_id, g.decided_at, g.created_at,
             s.name AS site_name, f.name AS fund_name, d.name AS designer_name, u.name AS owner_name
        FROM crm_signals g LEFT JOIN crm_subjects s ON s.id = g.subject_id LEFT JOIN crm_subjects f ON f.id = g.fund_id
        LEFT JOIN crm_subjects d ON d.id = g.designer_id LEFT JOIN users u ON u.id = g.decided_by
       WHERE ${OPEN} ${where} ORDER BY g.amount DESC NULLS LAST, g.score DESC LIMIT 500`, params);
    return rows.map(g => ({ ...g, amount: num(g.amount), sector: g.sector || I.sectorOf(g.title), imp_stage: I.stageOf(g), missing: I.missingOf(g) }));
  }

  // ── Home della BU (tavola 1) ────────────────────────────────────────────────────────────────
  app.get('/api/crm/impianti/home', async (_req, res) => {
    const cfg = await settings();
    const opps = (await opportunities()).filter(o => o.imp_stage !== 'persa');
    const { rows: fresh } = await db.query(`SELECT id, title, entity, sector, amount, region, score, created_at FROM crm_signals
      WHERE bu = 'impianti' AND status = 'nuovo' AND created_at > now() - interval '14 days' ORDER BY score DESC, created_at DESC LIMIT 200`);
    const freshS = fresh.map(g => ({ ...g, amount: num(g.amount), sector: g.sector || I.sectorOf(g.title) }));
    const week = Date.now() - 7 * 864e5;
    const sectors = I.SECTORS.map(s => {
      const o = opps.filter(x => x.sector === s.key);
      return { key: s.key, label: s.label, color: s.color, value: o.reduce((t, x) => t + (x.amount || 0), 0), opportunities: o.length,
        fresh: freshS.filter(x => x.sector === s.key && new Date(x.created_at) > week).length,
        big: [...o, ...freshS.filter(x => x.sector === s.key)].filter(x => x.amount >= cfg.big_amount).length };
    });
    const incomplete = opps.filter(o => o.missing.length && o.imp_stage !== 'firmato').slice(0, 5);
    // fondi della BU da risentire
    const { rows: funds } = await db.query(`SELECT s.id, s.name, row_to_json(m) AS mandate FROM crm_subjects s JOIN crm_fund_mandates m ON m.subject_id = s.id
      WHERE s.merged_into IS NULL AND 'impianti' = ANY(m.bus)`);
    const fl = await lastContacts(funds.map(f => f.id));
    const signals = await openSignals();
    const now = Date.now();
    const fundsLate = funds.map(f => {
      const days = fl[f.id] ? Math.floor((now - new Date(fl[f.id])) / 864e5) : null;
      return { id: f.id, name: f.name, days, matches: matchesOf(f.mandate, signals).length, techs: f.mandate.techs };
    }).filter(f => f.days === null || f.days > cfg.cadence.fondo).sort((a, b) => b.matches - a.matches || (b.days ?? 1e6) - (a.days ?? 1e6)).slice(0, 4);
    const { rows: prog } = await db.query(`SELECT s.id, s.name, s.city, COUNT(*) FILTER (WHERE x.direction = 'dato')::int AS dato, COUNT(*) FILTER (WHERE x.direction = 'ricevuto')::int AS ricevuto
      FROM crm_exchanges x JOIN crm_subjects s ON s.id = x.subject_id WHERE s.merged_into IS NULL GROUP BY s.id ORDER BY abs(COUNT(*) FILTER (WHERE x.direction = 'ricevuto') - COUNT(*) FILTER (WHERE x.direction = 'dato')) DESC, COUNT(*) DESC LIMIT 4`);
    res.json({ sectors, incomplete, hot: freshS.slice(0, 5), funds: fundsLate, progettisti: prog, settings: cfg,
      totals: { funds_all: funds.length, fresh: freshS.filter(x => new Date(x.created_at) > week).length, incomplete: opps.filter(o => o.missing.length).length, funds_late: fundsLate.length, opportunities: opps.length } });
  });

  // ── Opportunità (tavola 3) ──────────────────────────────────────────────────────────────────
  app.get('/api/crm/impianti/opportunita', async (_req, res) => {
    res.json({ opportunities: await opportunities(), stages: I.IMP_STAGES, settings: await settings() });
  });
  app.get('/api/crm/impianti/opportunita/:id', async (req, res) => {
    const id = v.int(req.params.id, 'opportunità', { min: 1 });
    const [o] = await opportunities('AND g.id = $1', [id]);
    let g = o;
    if (!g) { // anche un segnale ancora «nuovo» si può aprire come opportunità
      const { rows: [x] } = await db.query(`SELECT g.*, s.name AS site_name FROM crm_signals g LEFT JOIN crm_subjects s ON s.id = g.subject_id WHERE g.id = $1 AND g.bu = 'impianti'`, [id]);
      if (!x) throw new HttpError(404, 'Opportunità non trovata');
      g = { ...x, amount: num(x.amount), sector: x.sector || I.sectorOf(x.title), imp_stage: I.stageOf(x), missing: I.missingOf(x) };
    }
    const ids = [g.subject_id, g.fund_id, g.designer_id].filter(Boolean);
    const [contacts, last] = await Promise.all([mainContacts(ids), lastContacts(ids)]);
    const who = sid => (sid ? { id: sid, contact: contacts[sid] || null, last_contact: last[sid] || null } : null);
    // proposte per chi finanzia: i fondi il cui mandato combacia
    const { rows: mands } = await db.query(`SELECT s.id, s.name, row_to_json(m) AS mandate FROM crm_subjects s JOIN crm_fund_mandates m ON m.subject_id = s.id WHERE s.merged_into IS NULL`);
    const fl = await lastContacts(mands.map(m => m.id));
    const fundIdeas = g.fund_id ? [] : mands.map(m => ({ id: m.id, name: m.name, fit: I.fundFits(m.mandate, { sector: g.sector, amount: g.amount, region: g.region, phase: I.phaseOfSignal(g) }), last_contact: fl[m.id] || null }))
      .filter(x => x.fit.ok).sort((a, b) => b.fit.score - a.fit.score).slice(0, 4).map(x => ({ id: x.id, name: x.name, score: x.fit.score, reasons: x.fit.reasons, known: Boolean(x.last_contact) }));
    // proposte per chi progetta (dal CRM): chi ha già scambiato lavori con noi, prima quelli della stessa regione
    const { rows: des } = g.designer_id ? { rows: [] } : await db.query(`
      SELECT s.id, s.name, s.city, s.region, COUNT(x.id) FILTER (WHERE x.direction = 'ricevuto')::int AS ricevuto, COUNT(x.id) FILTER (WHERE x.direction = 'dato')::int AS dato
        FROM crm_subjects s LEFT JOIN crm_exchanges x ON x.subject_id = s.id
       WHERE s.merged_into IS NULL AND 'progettista' = ANY(s.roles)
       GROUP BY s.id ORDER BY (s.region = $1 AND $1 <> '') DESC, COUNT(x.id) DESC, lower(s.name) LIMIT 4`, [g.region || '']);
    const { rows: steps } = ids.length ? await db.query(`SELECT st.id, st.title, st.due_date::text AS due_date, st.subject_id, s.name AS subject_name, u.name AS owner_name
      FROM crm_steps st JOIN crm_subjects s ON s.id = st.subject_id LEFT JOIN users u ON u.id = st.owner_id
      WHERE st.done_at IS NULL AND st.subject_id = ANY($1::int[]) ORDER BY st.due_date LIMIT 5`, [ids]) : { rows: [] };
    const { rows: history } = await db.query(`
      (SELECT x.happened_on::timestamptz AS at, 'Scambio con ' || s.name || ': ' || x.title AS text FROM crm_exchanges x JOIN crm_subjects s ON s.id = x.subject_id WHERE x.signal_id = $1)
      UNION ALL (SELECT g.decided_at, 'Interessa dal radar' || COALESCE(' · ' || u.name, '') FROM crm_signals g LEFT JOIN users u ON u.id = g.decided_by WHERE g.id = $1 AND g.decided_at IS NOT NULL)
      UNION ALL (SELECT g.created_at, 'Arrivata nel radar' || CASE WHEN g.source <> '' THEN ' (' || g.source || ')' ELSE '' END FROM crm_signals g WHERE g.id = $1)
      ORDER BY at DESC NULLS LAST LIMIT 12`, [id]);
    res.json({ opportunity: { ...g, site: who(g.subject_id), fund: who(g.fund_id), designer: who(g.designer_id) },
      ideas: { funds: fundIdeas, designers: des }, steps, history, stages: I.IMP_STAGES, settings: await settings() });
  });
  app.put('/api/crm/impianti/opportunita/:id', async (req, res) => {
    const id = v.int(req.params.id, 'opportunità', { min: 1 });
    const { rows: [g] } = await db.query(`SELECT id, status FROM crm_signals WHERE id = $1 AND bu = 'impianti'`, [id]);
    if (!g) throw new HttpError(404, 'Opportunità non trovata');
    const b = req.body || {};
    const sets = [], params = [id];
    const subject = async (key, col) => {
      if (!(key in b)) return;
      const sid = b[key] === null || b[key] === '' ? null : v.int(b[key], key, { min: 1 });
      if (sid) { const { rows: [s] } = await db.query('SELECT id FROM crm_subjects WHERE id = $1 AND merged_into IS NULL', [sid]); if (!s) throw new HttpError(404, 'Azienda non trovata'); }
      params.push(sid); sets.push(`${col} = $${params.length}`);
    };
    await subject('fund_id', 'fund_id'); await subject('designer_id', 'designer_id'); await subject('subject_id', 'subject_id');
    if ('imp_stage' in b) { const st = v.oneOf(b.imp_stage ?? '', 'fase', I.IMP_STAGE_KEYS); params.push(st); sets.push(`imp_stage = $${params.length}`); }
    if (!sets.length) throw new HttpError(400, 'Niente da cambiare');
    // un segnale ancora «nuovo» che entra nelle opportunità diventa «Interessa»
    if (g.status === 'nuovo') { params.push(req.user.id); sets.push(`status = 'interessa', decided_by = $${params.length}, decided_at = now()`); }
    await db.query(`UPDATE crm_signals SET ${sets.join(', ')} WHERE id = $1`, params);
    // chi finanzia diventa un fondo, chi progetta un progettista (se non lo erano già)
    if (b.fund_id) await db.query(`UPDATE crm_subjects SET segment = $2, updated_at = now() WHERE id = $1 AND segment = ''`, [b.fund_id, I.SEGMENT_FUND]);
    if (b.designer_id) await db.query(`UPDATE crm_subjects SET roles = array_append(roles, 'progettista'), updated_at = now() WHERE id = $1 AND NOT 'progettista' = ANY(roles)`, [b.designer_id]);
    res.json({ ok: true });
  });
  // cerca un'azienda del CRM per riempire un vertice del triangolo
  app.get('/api/crm/impianti/cerca', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q.length < 2) return res.json({ subjects: [] });
    const { rows } = await db.query(`SELECT id, name, city, roles, segment, kind FROM crm_subjects WHERE merged_into IS NULL AND (name ILIKE $1 OR short_name ILIKE $1)
      ORDER BY (lower(name) LIKE lower($2)) DESC, lower(name) LIMIT 12`, [`%${q}%`, `${q}%`]);
    res.json({ subjects: rows.map(s => ({ ...s, kind_label: kindOf(s) })) });
  });

  // ── Energivori (tavola 6) ───────────────────────────────────────────────────────────────────
  function rowsOf(buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) throw new HttpError(400, 'Carica l\'elenco delle aziende energivore (Excel o CSV)');
    let rows;
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      try { rows = Object.values(readXlsx(buf))[0] || []; } catch { throw new HttpError(400, 'Il file non è un Excel (.xlsx) valido'); }
    } else {
      let text = buf.toString('utf8');
      if (text.includes('�')) text = buf.toString('latin1');
      rows = parseDelimited(text.replace(/^﻿/, ''));
    }
    const out = I.readEnergivori(rows, { provinces: REGIONS });
    if (out.missing.length) throw new HttpError(400, `Non trovo la colonna con la ragione sociale. Colonne del file: ${(rows.find(r => r.length >= 2) || []).slice(0, 15).join(', ')}`);
    if (!out.rows.length) throw new HttpError(400, 'Nel file non ci sono aziende');
    return out;
  }
  const keyOf = r => (r.vat ? `v:${r.vat}` : `n:${r.name.toLowerCase()}|${r.city}`);
  app.get('/api/crm/impianti/energivori', async (_req, res) => {
    const { rows } = await db.query(`SELECT e.id, e.name, e.vat, e.city, e.province, e.region, e.sector, e.consumption_gwh, e.roof_m2, e.csea_class, e.source, e.subject_id, e.signal_id,
             s.name AS subject_name, s.roles AS subject_roles, g.status AS signal_status
      FROM crm_energivori e LEFT JOIN crm_subjects s ON s.id = e.subject_id LEFT JOIN crm_signals g ON g.id = e.signal_id`);
    // collegate al CRM anche senza «Porta nel radar»: stessa P.IVA
    const vats = rows.filter(r => !r.subject_id && r.vat).map(r => r.vat);
    const { rows: known } = vats.length ? await db.query(`SELECT id, name, roles, vat FROM crm_subjects WHERE merged_into IS NULL AND vat = ANY($1::text[])`, [vats]) : { rows: [] };
    const byVat = new Map(known.map(k => [k.vat, k]));
    const list = rows.map(r => {
      const k = !r.subject_id && r.vat ? byVat.get(r.vat) : null;
      const e = { ...r, consumption_gwh: num(r.consumption_gwh), roof_m2: num(r.roof_m2), subject_id: r.subject_id || k?.id || null, subject_name: r.subject_name || k?.name || null, subject_roles: r.subject_roles || k?.roles || null };
      return { ...e, score: I.energivoroScore(e), ...I.estimate(e) };
    }).sort((a, b) => b.score - a.score);
    const regions = {};
    for (const e of list) if (e.region) regions[e.region] = (regions[e.region] || 0) + 1;
    res.json({ energivori: list, regions, estimate: I.EST, sources: [...new Set(rows.map(r => r.source).filter(Boolean))] });
  });
  app.post('/api/crm/impianti/energivori/anteprima', raw, async (req, res) => {
    const { rows, columns } = rowsOf(req.body);
    const { rows: have } = await db.query('SELECT vat, lower(name) AS name, city FROM crm_energivori');
    const seen = new Set(have.map(h => (h.vat ? `v:${h.vat}` : `n:${h.name}|${h.city}`)));
    res.json({ total: rows.length, fresh: rows.filter(r => !seen.has(keyOf(r))).length, columns, sample: rows.slice(0, 5).map(r => ({ ...r, score: I.energivoroScore(r) })) });
  });
  app.post('/api/crm/impianti/energivori', raw, async (req, res) => {
    const { rows } = rowsOf(req.body);
    const source = String(req.query.nome || 'elenco').slice(0, 200);
    let added = 0, updated = 0;
    await db.tx(async q => {
      // con la P.IVA: a blocchi di 300 (una riga per P.IVA, vince l'ultima del file); senza: una alla volta
      const byVat = new Map();
      for (const r of rows) if (r.vat) byVat.set(r.vat, r);
      const withVat = [...byVat.values()];
      const COLS = 11;
      for (let i = 0; i < withVat.length; i += 300) {
        const part = withVat.slice(i, i + 300);
        const params = [];
        const values = part.map((r, k) => {
          params.push(r.name, r.vat, r.city, r.province, r.region, r.sector, r.consumption_gwh, r.roof_m2, source, req.user.id, r.csea_class || '');
          return `(${Array.from({ length: COLS }, (_, j) => '$' + (k * COLS + j + 1)).join(', ')})`;
        });
        const { rows: out } = await q.query(`INSERT INTO crm_energivori (name, vat, city, province, region, sector, consumption_gwh, roof_m2, source, imported_by, csea_class)
          VALUES ${values.join(', ')}
          ON CONFLICT (vat) WHERE vat <> '' DO UPDATE SET name = EXCLUDED.name, city = CASE WHEN EXCLUDED.city <> '' THEN EXCLUDED.city ELSE crm_energivori.city END,
            province = CASE WHEN EXCLUDED.province <> '' THEN EXCLUDED.province ELSE crm_energivori.province END, region = CASE WHEN EXCLUDED.region <> '' THEN EXCLUDED.region ELSE crm_energivori.region END,
            sector = CASE WHEN EXCLUDED.sector <> '' THEN EXCLUDED.sector ELSE crm_energivori.sector END,
            consumption_gwh = COALESCE(EXCLUDED.consumption_gwh, crm_energivori.consumption_gwh), roof_m2 = COALESCE(EXCLUDED.roof_m2, crm_energivori.roof_m2),
            csea_class = CASE WHEN EXCLUDED.csea_class <> '' THEN EXCLUDED.csea_class ELSE crm_energivori.csea_class END, source = EXCLUDED.source, imported_at = now()
          RETURNING (xmax = 0) AS inserted`, params);
        for (const x of out) if (x.inserted) added++; else updated++;
      }
      for (const r of rows.filter(x => !x.vat)) {
        const vals = [r.name, r.vat, r.city, r.province, r.region, r.sector, r.consumption_gwh, r.roof_m2, source, req.user.id, r.csea_class || ''];
        const sql = r.vat
          ? `INSERT INTO crm_energivori (name, vat, city, province, region, sector, consumption_gwh, roof_m2, source, imported_by, csea_class) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (vat) WHERE vat <> '' DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, province = EXCLUDED.province, region = EXCLUDED.region, sector = EXCLUDED.sector,
               consumption_gwh = COALESCE(EXCLUDED.consumption_gwh, crm_energivori.consumption_gwh), roof_m2 = COALESCE(EXCLUDED.roof_m2, crm_energivori.roof_m2), csea_class = CASE WHEN EXCLUDED.csea_class <> '' THEN EXCLUDED.csea_class ELSE crm_energivori.csea_class END, source = EXCLUDED.source, imported_at = now()
             RETURNING (xmax = 0) AS inserted`
          : `INSERT INTO crm_energivori (name, vat, city, province, region, sector, consumption_gwh, roof_m2, source, imported_by, csea_class) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (lower(name), city) WHERE vat = '' DO UPDATE SET province = EXCLUDED.province, region = EXCLUDED.region, sector = EXCLUDED.sector,
               consumption_gwh = COALESCE(EXCLUDED.consumption_gwh, crm_energivori.consumption_gwh), roof_m2 = COALESCE(EXCLUDED.roof_m2, crm_energivori.roof_m2), csea_class = CASE WHEN EXCLUDED.csea_class <> '' THEN EXCLUDED.csea_class ELSE crm_energivori.csea_class END, source = EXCLUDED.source, imported_at = now()
             RETURNING (xmax = 0) AS inserted`;
        const { rows: [x] } = await q.query(sql, vals);
        if (x.inserted) added++; else updated++;
      }
    });
    res.status(201).json({ added, updated });
  });
  // «Fai diventare lead» (Dante 25/11, ALM2-92): l'azienda entra nel CRM come lead col tipo «Azienda energivora» e l'ASA
  // Impianti, senza segnale nel radar; si segue poi dalla pagina Lead. Una o più alla volta.
  async function energivoroToLead(e, userId) {
    let sid = e.subject_id;
    if (!sid) {
      const { rows: [s] } = await db.query(`SELECT id FROM crm_subjects WHERE merged_into IS NULL AND ((vat <> '' AND vat = $1) OR lower(name) = lower($2)) ORDER BY (vat = $1) DESC LIMIT 1`, [e.vat, e.name]);
      sid = s?.id || null;
    }
    let created = false;
    if (sid) {
      await db.query(`UPDATE crm_subjects SET segment = CASE WHEN segment = '' THEN $2 ELSE segment END, asa = CASE WHEN 'impianti' = ANY(asa) THEN asa ELSE array_append(asa, 'impianti') END,
        roles = CASE WHEN roles && ARRAY['lead', 'cliente']::text[] THEN roles ELSE array_append(roles, 'lead') END, updated_at = now() WHERE id = $1`, [sid, I.SEGMENT_ENERGIVORA]);
    } else {
      const { rows: [s] } = await db.query(`INSERT INTO crm_subjects (name, vat, city, province, region, kind, roles, asa, segment, owner_id, origin, created_by, ateco, notes)
        VALUES ($1, $2, $3, $4, $5, 'impresa', '{lead}', '{impianti}', $6, $7, 'Alma Impianti · energivori', $7, $8, $9) RETURNING id`,
      [e.name, e.vat, e.city, e.province, e.region, I.SEGMENT_ENERGIVORA, userId, /^\d{2}(\.\d+)*$/.test(e.sector) ? e.sector : '',
        e.csea_class ? `Elenco CSEA delle imprese energivore, classe ${e.csea_class}.` : 'Elenco delle aziende energivore.']);
      sid = s.id;
      created = true;
    }
    await db.query('UPDATE crm_energivori SET subject_id = $2 WHERE id = $1', [e.id, sid]);
    return { subject_id: sid, created };
  }
  app.post('/api/crm/impianti/energivori/lead', async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 200);
    if (!ids.length) throw new HttpError(400, 'Scegli almeno un\'azienda');
    const { rows } = await db.query('SELECT * FROM crm_energivori WHERE id = ANY($1::int[])', [ids]);
    const out = [];
    for (const e of rows) out.push(await energivoroToLead(e, req.user.id));
    res.status(201).json({ leads: out.length, created: out.filter(x => x.created).length, ids: out.map(x => x.subject_id) });
  });
  // «Porta nel radar»: l'azienda entra nel CRM (lead col tipo «Azienda energivora») e nasce un segnale Efficientamento
  app.post('/api/crm/impianti/energivori/:id/radar', async (req, res) => {
    const id = v.int(req.params.id, 'azienda', { min: 1 });
    const { rows: [e] } = await db.query('SELECT * FROM crm_energivori WHERE id = $1', [id]);
    if (!e) throw new HttpError(404, 'Azienda non trovata');
    let sid = e.subject_id;
    if (!sid) {
      const { rows: [s] } = await db.query(`SELECT id FROM crm_subjects WHERE merged_into IS NULL AND ((vat <> '' AND vat = $1) OR lower(name) = lower($2)) ORDER BY (vat = $1) DESC LIMIT 1`, [e.vat, e.name]);
      sid = s?.id || null;
    }
    if (sid) await db.query(`UPDATE crm_subjects SET segment = CASE WHEN segment = '' THEN $2 ELSE segment END, asa = CASE WHEN 'impianti' = ANY(asa) THEN asa ELSE array_append(asa, 'impianti') END, updated_at = now() WHERE id = $1`, [sid, I.SEGMENT_ENERGIVORA]);
    else {
      const { rows: [s] } = await db.query(`INSERT INTO crm_subjects (name, vat, city, province, region, kind, roles, asa, segment, owner_id, origin, created_by, ateco)
        VALUES ($1, $2, $3, $4, $5, 'impresa', '{lead}', '{impianti}', $6, $7, 'Alma Impianti · energivori', $7, $8) RETURNING id`,
      [e.name, e.vat, e.city, e.province, e.region, I.SEGMENT_ENERGIVORA, req.user.id, /^\d{2}(\.\d+)*$/.test(e.sector) ? e.sector : '']);
      sid = s.id;
    }
    const est = I.estimate(e);
    const facts = [e.consumption_gwh ? `${Number(e.consumption_gwh).toLocaleString('it-IT')} GWh l'anno` : '', e.roof_m2 ? `${Number(e.roof_m2).toLocaleString('it-IT')} m² di tetto` : ''].filter(Boolean).join(', ');
    const { rows: [g] } = await db.query(`INSERT INTO crm_signals (source, external_id, kind, bu, sector, title, summary, why, entity, subject_id, region, place, score, score_parts, created_by)
      VALUES ('energivori', $1, 'investimento', 'impianti', 'efficientamento', $2, $3, $4, $5, $6, $7, $8, $9, '{}', $10)
      ON CONFLICT (source, external_id) WHERE external_id <> '' DO UPDATE SET subject_id = EXCLUDED.subject_id RETURNING id`,
    [`energivoro:${e.id}`, `${e.name}: efficienza energetica${e.roof_m2 ? ' e fotovoltaico' : ''}${facts ? ` (${facts})` : ''}`,
      est.saving_eur ? `Risparmio stimato ${est.saving_eur.toLocaleString('it-IT')} € l'anno${est.kwp ? `, FV da circa ${est.kwp} kWp sul tetto` : ''}. Da confermare con la diagnosi.` : '',
      `Azienda energivora${est.incentives.length ? `; incentivi possibili: ${est.incentives.join(', ')}` : ''}.`, e.name, sid, e.region, e.city, Math.max(40, I.energivoroScore(e)), req.user.id]);
    await db.query('UPDATE crm_energivori SET subject_id = $2, signal_id = $3 WHERE id = $1', [id, sid, g.id]);
    res.status(201).json({ subject_id: sid, signal_id: g.id });
  });

  // ── «Trova fondi con Alma»: proposte dal web, si aggiungono al CRM solo quelle scelte ──────────
  const monthNow = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 7);
  app.post('/api/crm/impianti/fondi/cerca', async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY || (radarFetch ? 'test' : '');
    if (!apiKey) throw new HttpError(503, 'La ricerca con Alma non è attiva: manca la chiave OpenAI');
    const sector = I.SECTOR_KEYS.includes(req.body?.sector) ? I.sectorLabel(req.body.sector) : '';
    const region = v.text(req.body?.region, 'regione', { max: 60 }) || '';
    const { rows: known } = await db.query(`SELECT s.name FROM crm_subjects s WHERE s.merged_into IS NULL
      AND (s.segment = $1 OR EXISTS (SELECT 1 FROM crm_fund_mandates m WHERE m.subject_id = s.id)) ORDER BY s.updated_at DESC LIMIT 80`, [I.SEGMENT_FUND]);
    const { searchFondi } = require('../lib/impianti-fondi-ai');
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
    const r = await searchFondi({ apiKey, fetchImpl: radarFetch || fetch, sector, region, known: known.map(k => k.name), today });
    await db.query(`INSERT INTO crm_radar_spend (month, bu, eur) VALUES ($1, 'impianti', $2) ON CONFLICT (month, bu) DO UPDATE SET eur = crm_radar_spend.eur + EXCLUDED.eur`, [monthNow(), r.costEur]);
    // già nel CRM? stesso nome (senza forma giuridica) o stesso sito
    const norm = s => String(s || '').toLowerCase().replace(/\b(s\.?p\.?a\.?|s\.?r\.?l\.?|sgr|spa|srl|s\.a\.|ltd|plc|fund|fondo)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    const { rows: all } = await db.query(`SELECT id, name, website FROM crm_subjects WHERE merged_into IS NULL`);
    const funds = r.funds.map(f => {
      const hit = all.find(s => (norm(s.name) && norm(s.name) === norm(f.name)) || (f.website && s.website && host(s.website) === host(f.website)));
      return { ...f, existing: hit ? { id: hit.id, name: hit.name } : null };
    });
    // senza proposte, alla direzione un estratto della risposta di Alma (per capire cosa non torna)
    res.json({ funds, cost_eur: r.costEur, ...(funds.length || !req.crm.admin ? {} : { note: r.raw }) });
  });
  app.post('/api/crm/impianti/fondi/aggiungi', async (req, res) => {
    const list = Array.isArray(req.body?.funds) ? req.body.funds.slice(0, 20) : [];
    if (!list.length) throw new HttpError(400, 'Scegli almeno un fondo');
    const { parseFondi } = require('../lib/impianti-fondi-ai');
    const clean = parseFondi(JSON.stringify(list.map(f => ({ ...f, url: f.url || f.website || 'https://alma' }))));
    const ids = [];
    for (const f of clean) {
      const { rows: [dup] } = await db.query(`SELECT id FROM crm_subjects WHERE merged_into IS NULL AND lower(name) = lower($1) LIMIT 1`, [f.name]);
      let sid = dup?.id;
      if (sid) await db.query(`UPDATE crm_subjects SET segment = CASE WHEN segment = '' THEN $2 ELSE segment END, asa = CASE WHEN 'impianti' = ANY(asa) THEN asa ELSE array_append(asa, 'impianti') END,
        website = CASE WHEN website = '' THEN $3 ELSE website END, updated_at = now() WHERE id = $1`, [sid, I.SEGMENT_FUND, f.website]);
      else {
        const { rows: [s] } = await db.query(`INSERT INTO crm_subjects (name, kind, roles, asa, segment, owner_id, origin, created_by, city, website, notes)
          VALUES ($1, 'impresa', '{lead}', '{impianti}', $2, $3, 'Alma · ricerca fondi', $3, $4, $5, $6) RETURNING id`,
        [f.name, I.SEGMENT_FUND, req.user.id, f.city, f.website, [f.type, f.why, f.url ? `Fonte: ${f.url}` : ''].filter(Boolean).join('\n')]);
        sid = s.id;
      }
      // mandato: si compila solo se non c'era (quello scritto da una persona vince)
      await db.query(`INSERT INTO crm_fund_mandates (subject_id, techs, ticket_min, ticket_max, regions, phases, seeks_epc, bus, notes, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, '{impianti}', $8, $9) ON CONFLICT (subject_id) DO UPDATE SET
          bus = CASE WHEN 'impianti' = ANY(crm_fund_mandates.bus) THEN crm_fund_mandates.bus ELSE array_append(crm_fund_mandates.bus, 'impianti') END,
          techs = CASE WHEN cardinality(crm_fund_mandates.techs) = 0 THEN EXCLUDED.techs ELSE crm_fund_mandates.techs END,
          ticket_min = COALESCE(crm_fund_mandates.ticket_min, EXCLUDED.ticket_min), ticket_max = COALESCE(crm_fund_mandates.ticket_max, EXCLUDED.ticket_max),
          regions = CASE WHEN cardinality(crm_fund_mandates.regions) = 0 THEN EXCLUDED.regions ELSE crm_fund_mandates.regions END,
          phases = CASE WHEN cardinality(crm_fund_mandates.phases) = 0 THEN EXCLUDED.phases ELSE crm_fund_mandates.phases END`,
      [sid, f.techs, f.ticket_min, f.ticket_max, f.regions, f.phases, f.seeks_epc, `Proposto da Alma: ${f.why}`.slice(0, 2000), req.user.id]);
      ids.push(sid);
    }
    res.status(201).json({ added: ids.length, ids });
  });
}

module.exports = { registerImpiantiTappa2 };
