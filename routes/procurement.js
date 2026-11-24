// Alma Procurement (ALM2-81, canvas «Alma Procurement · capitolato e fornitori» approvato da Dante il 24/11/2026).
// L'ufficio acquisti vede in un posto il capitolato merci di Almacis e tutti i fornitori, chiede ad Alma di trovarne
// di nuovi (entrano nel CRM da soli, «Da qualificare») e manda richieste di quotazione a più fornitori: un'email per
// referente, scritta da Alma nel tono delle email passate con quella persona, approvata e mandata dalla propria casella.
// I fornitori sono le aziende del CRM centrale (crm_subjects, ruolo «fornitore»): qui niente anagrafiche parallele.
// Le API stanno sotto /api/crm, così valgono gli stessi accessi del CRM.
const express = require('express');
const { HttpError, v } = require('../lib/http');
const { graph } = require('../lib/graph');
const { readXlsx } = require('../lib/xlsx');
const { parseDelimited } = require('../lib/crm-radar');
const S = require('../lib/crm-scrivo');
const A = require('../lib/crm-posta-ai');
const PI = require('../lib/crm-posta-invio');
const F = require('../lib/firma');
const R = require('../lib/procurement');

const BASE = '/api/crm/procurement';
const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const TEXT = { Prefer: 'outlook.body-content-type="text"' };
const REMIND_DAYS = 5;
const raw = express.raw({ type: () => true, limit: '20mb' });

function registerProcurement(app, { db, auth, config, radarFetch, mailFake }) {
  const aiKey = () => process.env.OPENAI_API_KEY || '';
  const ai = () => ({ key: aiKey(), fetchImpl: radarFetch || fetch });
  const g = (t, method, path, opts) => (mailFake ? mailFake.graph(t, method, path, opts) : graph(t, method, path, opts));
  const readToken = async uid => (mailFake ? 'fake' : auth.graphToken(uid));
  async function writeToken(uid) {
    if (mailFake) return 'fake';
    try { return await auth.graphTokenFor(uid, ['Mail.ReadWrite']); } catch (err) {
      if (err.status === 403 || err.code === 'consent') throw new HttpError(403, 'Per mandare le email serve il permesso «Mail.ReadWrite» di Microsoft: esci e rientra in Alma Space', 'mail_write');
      throw err;
    }
  }
  // il costo delle ricerche e delle bozze va nel budget AI di chi le chiede (come le ricerche di Alma)
  async function charge(userId, usd, model) {
    if (!usd) return;
    await db.query('INSERT INTO assistant_usage (user_id, conversation_id, model, cost_usd, day) VALUES ($1, NULL, $2, $3, $4)', [userId, model, usd, todayRome()]).catch(e => console.error('[procurement] costo:', e.message));
  }
  const eurToUsd = eur => (Number(eur) || 0) / R.USD_EUR;

  // ── pezzi comuni ───────────────────────────────────────────────────────────────────────────────
  async function tagsOf(ids) {
    if (!ids.length) return {};
    const { rows } = await db.query('SELECT subject_id, tag, confirmed, why FROM proc_supplier_tags WHERE subject_id = ANY($1::int[])', [ids]);
    const out = {};
    for (const r of rows) (out[r.subject_id] ||= []).push({ tag: r.tag, label: R.TAGS[r.tag], confirmed: r.confirmed, why: r.why });
    return out;
  }
  async function ddtOf(ids) {
    if (!ids.length) return {};
    const { rows } = await db.query(`SELECT s.id, COUNT(d.id)::int AS n, MAX(d.ddt_date) AS last, array_remove(array_agg(DISTINCT NULLIF(d.job_code, '')), NULL) AS jobs
        FROM crm_subjects s JOIN proc_ddt_lines d ON d.vat <> '' AND d.vat = regexp_replace(s.vat, '\\D', '', 'g')
       WHERE s.id = ANY($1::int[]) GROUP BY s.id`, [ids]);
    return Object.fromEntries(rows.map(r => [r.id, { n: r.n, last: r.last, jobs: (r.jobs || []).slice(0, 4) }]));
  }
  async function mainContacts(ids) {
    if (!ids.length) return {};
    const { rows } = await db.query(`
      SELECT DISTINCT ON (l.subject_id) l.subject_id, c.id, trim(concat_ws(' ', c.first_name, c.last_name)) AS name, c.email, l.job
        FROM crm_contact_links l JOIN crm_contacts c ON c.id = l.contact_id
       WHERE l.subject_id = ANY($1::int[]) AND l.date_to IS NULL
       ORDER BY l.subject_id, (c.email <> '') DESC, l.is_primary DESC, l.id`, [ids]);
    return Object.fromEntries(rows.map(r => [r.subject_id, r]));
  }
  async function lastMail(ids) {
    if (!ids.length) return {};
    const { rows } = await db.query(`SELECT cl.subject_id, MAX(p.last_at) AS last_at, COALESCE(SUM(p.sent), 0)::int AS sent
        FROM crm_contact_links cl JOIN crm_contacts c ON c.id = cl.contact_id AND c.email <> ''
        JOIN crm_mail_people p ON p.email = lower(c.email) WHERE cl.subject_id = ANY($1::int[]) GROUP BY cl.subject_id`, [ids]);
    return Object.fromEntries(rows.map(r => [r.subject_id, r]));
  }
  async function itemOr404(id) {
    const { rows: [it] } = await db.query('SELECT * FROM proc_items WHERE id = $1 AND NOT archived', [id]);
    if (!it) throw new HttpError(404, 'Merce non trovata');
    return it;
  }
  async function suppliersOfItems(itemIds) {
    if (!itemIds.length) return {};
    const { rows } = await db.query(`SELECT l.item_id, l.source, s.id, s.name, s.city, s.province, s.vat
        FROM proc_item_suppliers l JOIN crm_subjects s ON s.id = l.subject_id AND s.merged_into IS NULL
       WHERE l.item_id = ANY($1::int[]) ORDER BY l.item_id, l.created_at`, [itemIds]);
    const ids = [...new Set(rows.map(r => r.id))];
    const [tags, ddt] = await Promise.all([tagsOf(ids), ddtOf(ids)]);
    const out = {};
    for (const r of rows) (out[r.item_id] ||= []).push({ id: r.id, name: r.name, city: r.city, province: r.province, source: r.source, tags: tags[r.id] || [], ddt: ddt[r.id] || null });
    return out;
  }
  // un fornitore del CRM: lo trova per P.IVA o per nome, altrimenti lo crea («Da qualificare» se arriva dal web)
  async function upsertSupplier(q, f, { userId, category, subcategory, origin }) {
    const vat = R.vatOf(f.vat);
    let s = null;
    if (vat) ({ rows: [s] } = await q.query("SELECT id, name, roles, supplier_categories, supplier_subcategories FROM crm_subjects WHERE merged_into IS NULL AND regexp_replace(vat, '\\D', '', 'g') = $1 LIMIT 1", [vat]));
    if (!s) ({ rows: [s] } = await q.query('SELECT id, name, roles, supplier_categories, supplier_subcategories FROM crm_subjects WHERE merged_into IS NULL AND lower(name) = lower($1) LIMIT 1', [f.name]));
    if (s) {
      const roles = s.roles.includes('fornitore') ? s.roles : [...s.roles, 'fornitore'];
      const cats = category && !s.supplier_categories.includes(category) ? [...s.supplier_categories, category] : s.supplier_categories;
      const subs = subcategory && !s.supplier_subcategories.includes(subcategory) ? [...s.supplier_subcategories, subcategory] : s.supplier_subcategories;
      await q.query('UPDATE crm_subjects SET roles = $2, supplier_categories = $3, supplier_subcategories = $4, updated_at = now() WHERE id = $1', [s.id, roles, cats, subs]);
      return { id: s.id, name: s.name, created: false };
    }
    const { rows: [n] } = await q.query(`INSERT INTO crm_subjects (name, vat, website, email, phone, city, province, roles, asa, supplier_categories, supplier_subcategories, owner_id, origin, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, '{fornitore}', '{}', $8, $9, $10, $11, $12, $10) RETURNING id, name`,
    [f.name.slice(0, 200), vat, f.website || '', f.email || '', f.phone || '', f.city || '', f.province || '', category ? [category] : [], subcategory ? [subcategory] : [], userId, origin, f.why || '']);
    return { id: n.id, name: n.name, created: true };
  }
  async function setTag(q, subjectId, tag, { on = true, confirmed = false, why = '', userId = null } = {}) {
    if (!on) return q.query('DELETE FROM proc_supplier_tags WHERE subject_id = $1 AND tag = $2', [subjectId, tag]);
    return q.query(`INSERT INTO proc_supplier_tags (subject_id, tag, confirmed, why, set_by) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (subject_id, tag) DO UPDATE SET confirmed = proc_supplier_tags.confirmed OR EXCLUDED.confirmed,
        why = CASE WHEN EXCLUDED.why <> '' THEN EXCLUDED.why ELSE proc_supplier_tags.why END, set_by = COALESCE(EXCLUDED.set_by, proc_supplier_tags.set_by)`,
    [subjectId, tag, confirmed, why.slice(0, 400), userId]);
  }
  async function link(q, itemId, subjectId, source, userId, note = '') {
    await q.query(`INSERT INTO proc_item_suppliers (item_id, subject_id, source, note, created_by) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (item_id, subject_id) DO NOTHING`, [itemId, subjectId, source, note.slice(0, 400), userId]);
  }

  // ── Home ───────────────────────────────────────────────────────────────────────────────────────
  app.get(`${BASE}/home`, async (req, res) => {
    const [{ rows: cats }, { rows: [t] }, { rows: av }, proposals] = await Promise.all([
      db.query(`SELECT i.category, COUNT(DISTINCT i.id)::int AS items, COUNT(DISTINCT l.subject_id)::int AS suppliers
          FROM proc_items i LEFT JOIN proc_item_suppliers l ON l.item_id = i.id WHERE NOT i.archived GROUP BY i.category`),
      db.query(`SELECT
          (SELECT COUNT(*) FROM proc_items WHERE NOT archived)::int AS items,
          (SELECT COUNT(*) FROM crm_subjects WHERE merged_into IS NULL AND 'fornitore' = ANY(roles))::int AS suppliers,
          (SELECT COUNT(*) FROM proc_items i WHERE NOT i.archived AND (SELECT COUNT(*) FROM proc_item_suppliers l WHERE l.item_id = i.id) = 1)::int AS single,
          (SELECT name FROM proc_items i WHERE NOT i.archived AND (SELECT COUNT(*) FROM proc_item_suppliers l WHERE l.item_id = i.id) = 1 ORDER BY i.updated_at DESC LIMIT 1) AS single_name,
          (SELECT COUNT(*) FROM proc_rfq_recipients r JOIN proc_rfqs q ON q.id = r.rfq_id WHERE r.status = 'risposta' AND q.status = 'inviata')::int AS replies,
          (SELECT COUNT(DISTINCT r.rfq_id) FROM proc_rfq_recipients r JOIN proc_rfqs q ON q.id = r.rfq_id WHERE r.status = 'risposta' AND q.status = 'inviata')::int AS reply_rfqs,
          (SELECT COUNT(*) FROM proc_rfq_recipients r JOIN proc_rfqs q ON q.id = r.rfq_id WHERE r.status = 'inviata' AND q.status = 'inviata')::int AS waiting,
          (SELECT COUNT(*) FROM crm_subjects s JOIN proc_supplier_tags g ON g.subject_id = s.id AND g.tag = 'da_qualificare' WHERE s.merged_into IS NULL)::int AS to_qualify`),
      db.query(`SELECT DISTINCT ON (i.category, s.id) i.category, s.id, s.name FROM proc_items i JOIN proc_item_suppliers l ON l.item_id = i.id
          JOIN crm_subjects s ON s.id = l.subject_id WHERE NOT i.archived ORDER BY i.category, s.id`),
      ddtProposals({ limit: 6 }),
    ]);
    const { rows: [lastReply] } = await db.query(`SELECT q.id, q.item_name, q.site FROM proc_rfq_recipients r JOIN proc_rfqs q ON q.id = r.rfq_id
        WHERE r.status = 'risposta' AND q.status = 'inviata' ORDER BY r.reply_at DESC NULLS LAST LIMIT 1`);
    res.json({
      totals: { ...t, proposals: proposals.total },
      last_reply: lastReply || null,
      categories: R.CATEGORIES.map(c => {
        const x = cats.find(r => r.category === c.key) || { items: 0, suppliers: 0 };
        return { key: c.key, label: R.SHORT[c.key], items: x.items, suppliers: x.suppliers, avatars: av.filter(a => a.category === c.key).slice(0, 3).map(a => a.name) };
      }),
      proposals: proposals.list,
    });
  });

  // ── Capitolato ─────────────────────────────────────────────────────────────────────────────────
  app.get(`${BASE}/capitolato`, async (req, res) => {
    const cat = R.CATEGORIES.some(c => c.key === req.query.categoria) ? req.query.categoria : null;
    const q = String(req.query.q || '').trim();
    const { rows: counts } = await db.query('SELECT category, COUNT(*)::int AS n FROM proc_items WHERE NOT archived GROUP BY category');
    const params = [];
    const where = ['NOT i.archived'];
    if (cat) { params.push(cat); where.push(`i.category = $${params.length}`); }
    if (q) { params.push(`%${q}%`); where.push(`(i.name ILIKE $${params.length} OR i.subcategory ILIKE $${params.length} OR i.specs ILIKE $${params.length})`); }
    if (req.query.bu) { params.push(String(req.query.bu)); where.push(`$${params.length} = ANY(i.bus)`); }
    const { rows: items } = await db.query(`SELECT i.* FROM proc_items i WHERE ${where.join(' AND ')} ORDER BY i.subcategory, lower(i.name) LIMIT 500`, params);
    const sup = await suppliersOfItems(items.map(i => i.id));
    res.json({
      categories: R.CATEGORIES.map(c => ({ key: c.key, label: R.SHORT[c.key], long: c.label, subs: c.subs, n: counts.find(x => x.category === c.key)?.n || 0 })),
      bus: R.BUS,
      items: items.map(i => ({ ...i, suppliers: sup[i.id] || [] })),
    });
  });
  app.get(`${BASE}/merci/:id`, async (req, res) => {
    const it = await itemOr404(v.int(req.params.id, 'merce', { min: 1 }));
    const sup = (await suppliersOfItems([it.id]))[it.id] || [];
    const { rows: rfqs } = await db.query(`SELECT q.id, q.created_at, q.status, q.site, (SELECT COUNT(*) FROM proc_rfq_recipients r WHERE r.rfq_id = q.id AND r.status <> 'tolta')::int AS n
        FROM proc_rfqs q WHERE q.item_id = $1 ORDER BY q.created_at DESC LIMIT 5`, [it.id]);
    res.json({ item: it, suppliers: sup, rfqs });
  });
  app.post(`${BASE}/merci`, async (req, res) => {
    let f;
    try { f = R.itemFields(req.body || {}); } catch (e) { throw new HttpError(e.status || 400, e.message); }
    const { rows: [dup] } = await db.query('SELECT id FROM proc_items WHERE NOT archived AND category = $1 AND lower(name) = lower($2)', [f.category, f.name]);
    if (dup) throw new HttpError(409, 'Questa merce c\'è già nel capitolato');
    const { rows: [it] } = await db.query(`INSERT INTO proc_items (category, subcategory, name, unit, specs, norms, documents, bus, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [f.category, f.subcategory || '', f.name, f.unit || '', f.specs || '', f.norms || '', f.documents || '', f.bus || [], f.notes || '', req.user.id]);
    res.status(201).json({ item: it });
  });
  app.put(`${BASE}/merci/:id`, async (req, res) => {
    const it = await itemOr404(v.int(req.params.id, 'merce', { min: 1 }));
    let f;
    try { f = R.itemFields(req.body || {}, { partial: true }); } catch (e) { throw new HttpError(e.status || 400, e.message); }
    const keys = Object.keys(f);
    if (!keys.length) return res.json({ item: it });
    const { rows: [up] } = await db.query(`UPDATE proc_items SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, [it.id, ...keys.map(k => f[k])]);
    res.json({ item: up });
  });
  app.delete(`${BASE}/merci/:id`, async (req, res) => {
    const it = await itemOr404(v.int(req.params.id, 'merce', { min: 1 }));
    await db.query('UPDATE proc_items SET archived = true, updated_at = now() WHERE id = $1', [it.id]);
    res.json({ ok: true });
  });
  app.post(`${BASE}/merci/:id/fornitori`, async (req, res) => {
    const it = await itemOr404(v.int(req.params.id, 'merce', { min: 1 }));
    const sid = v.int(req.body?.subject_id, 'fornitore', { min: 1 });
    const { rows: [s] } = await db.query('SELECT id, name, roles FROM crm_subjects WHERE id = $1 AND merged_into IS NULL', [sid]);
    if (!s) throw new HttpError(404, 'Azienda non trovata nel CRM');
    if (!s.roles.includes('fornitore')) await db.query("UPDATE crm_subjects SET roles = array_append(roles, 'fornitore'), updated_at = now() WHERE id = $1", [sid]);
    await db.query("UPDATE crm_subjects SET supplier_categories = CASE WHEN $2 = ANY(supplier_categories) THEN supplier_categories ELSE array_append(supplier_categories, $2) END WHERE id = $1", [sid, it.category]);
    await link(db, it.id, sid, 'crm', req.user.id);
    res.json({ ok: true });
  });
  app.delete(`${BASE}/merci/:id/fornitori/:sid`, async (req, res) => {
    await db.query('DELETE FROM proc_item_suppliers WHERE item_id = $1 AND subject_id = $2', [v.int(req.params.id, 'merce', { min: 1 }), v.int(req.params.sid, 'fornitore', { min: 1 })]);
    res.json({ ok: true });
  });

  // ── Fornitori ──────────────────────────────────────────────────────────────────────────────────
  app.get(`${BASE}/fornitori`, async (req, res) => {
    const filtro = ['qualita', 'prezzo', 'da_qualificare'].includes(req.query.filtro) ? req.query.filtro : '';
    const q = String(req.query.q || '').trim();
    const params = [];
    const where = ["s.merged_into IS NULL", "('fornitore' = ANY(s.roles) OR EXISTS (SELECT 1 FROM proc_item_suppliers l WHERE l.subject_id = s.id))"];
    if (filtro) { params.push(filtro); where.push(`EXISTS (SELECT 1 FROM proc_supplier_tags g WHERE g.subject_id = s.id AND g.tag = $${params.length})`); }
    if (q) { params.push(`%${q}%`); where.push(`(s.name ILIKE $${params.length} OR s.vat ILIKE $${params.length} OR s.city ILIKE $${params.length} OR EXISTS (SELECT 1 FROM proc_item_suppliers l JOIN proc_items i ON i.id = l.item_id WHERE l.subject_id = s.id AND i.name ILIKE $${params.length}))`); }
    if (req.query.categoria) { params.push(String(req.query.categoria)); where.push(`$${params.length} = ANY(s.supplier_categories)`); }
    if (req.query.merce) { params.push(Number(req.query.merce) || 0); where.push(`EXISTS (SELECT 1 FROM proc_item_suppliers l WHERE l.subject_id = s.id AND l.item_id = $${params.length})`); }
    const { rows } = await db.query(`SELECT s.id, s.name, s.city, s.province, s.vat, s.origin, s.supplier_categories, s.created_at,
        (SELECT array_agg(i.name ORDER BY i.name) FROM proc_item_suppliers l JOIN proc_items i ON i.id = l.item_id AND NOT i.archived WHERE l.subject_id = s.id) AS items,
        (SELECT array_agg(DISTINCT l.source) FROM proc_item_suppliers l WHERE l.subject_id = s.id) AS sources
        FROM crm_subjects s WHERE ${where.join(' AND ')} ORDER BY lower(s.name) LIMIT 400`, params);
    const ids = rows.map(r => r.id);
    const [tags, ddt, contacts, mails] = await Promise.all([tagsOf(ids), ddtOf(ids), mainContacts(ids), lastMail(ids)]);
    const { rows: [counts] } = await db.query(`SELECT
        (SELECT COUNT(*) FROM proc_supplier_tags WHERE tag = 'qualita')::int AS qualita,
        (SELECT COUNT(*) FROM proc_supplier_tags WHERE tag = 'prezzo')::int AS prezzo,
        (SELECT COUNT(*) FROM proc_supplier_tags WHERE tag = 'da_qualificare')::int AS da_qualificare`);
    res.json({
      counts,
      suppliers: rows.map(r => {
        const src = r.sources || [];
        const origin = ddt[r.id] ? (src.includes('web') ? 'BOSS + web' : 'BOSS + CRM') : src.includes('web') || /procurement/i.test(r.origin) ? 'Alma, dal web' : 'CRM';
        return { id: r.id, name: r.name, city: r.city, province: r.province, vat: r.vat, items: (r.items || []).slice(0, 6), categories: r.supplier_categories,
          tags: tags[r.id] || [], ddt: ddt[r.id] || null, contact: contacts[r.id] || null, last_mail: mails[r.id]?.last_at || null, origin, created_at: r.created_at };
      }),
    });
  });
  app.post(`${BASE}/fornitori/:id/etichette`, async (req, res) => {
    const id = v.int(req.params.id, 'fornitore', { min: 1 });
    const tag = v.oneOf(req.body?.tag, 'etichetta', Object.keys(R.TAGS));
    if (!tag) throw new HttpError(400, 'Scegli l\'etichetta');
    await setTag(db, id, tag, { on: req.body?.on !== false, confirmed: true, why: v.text(req.body?.why, 'motivo', { max: 400 }) || '', userId: req.user.id });
    res.json({ tags: (await tagsOf([id]))[id] || [] });
  });

  // ── Chiedi ad Alma ─────────────────────────────────────────────────────────────────────────────
  app.post(`${BASE}/chiedi`, async (req, res) => {
    const query = v.text(req.body?.domanda, 'domanda', { max: 600, required: true });
    const itemId = v.int(req.body?.merce_id, 'merce', { min: 1, nullable: true }) || null;
    let item = itemId ? await itemOr404(itemId) : null;
    // 1. capitolato e CRM: chi abbiamo già per le parole della domanda
    const words = R.norm(query).split(' ').filter(w => w.length > 3 && !['serve', 'fornitore', 'fornitori', 'cerco', 'trova', 'meglio', 'fretta', 'affidabile', 'noleggio'].includes(w)).slice(0, 6);
    const like = words.map(w => `%${w}%`);
    const local = like.length ? (await db.query(`SELECT DISTINCT i.id AS item_id, i.name AS item_name, s.id, s.name
        FROM proc_items i JOIN proc_item_suppliers l ON l.item_id = i.id JOIN crm_subjects s ON s.id = l.subject_id
       WHERE NOT i.archived AND (i.name ILIKE ANY($1::text[]) OR i.subcategory ILIKE ANY($1::text[])) LIMIT 20`, [like])).rows : [];
    const known = local.map(r => r.name);
    // 2. il web
    const key = aiKey();
    let out;
    if (key) {
      try { out = await R.searchWeb({ apiKey: key, query, item, known, today: todayRome(), fetchImpl: radarFetch || fetch }); } catch (e) {
        console.warn('[procurement] ricerca:', e.message);
        throw new HttpError(502, 'La ricerca sul web non è riuscita: riprova tra poco');
      }
    } else if (config.devLogin || process.env.NODE_TEST_CONTEXT) out = R.fakeSearch(query);
    else throw new HttpError(503, 'Per cercare sul web serve la chiave OpenAI (OPENAI_API_KEY)');
    await charge(req.user.id, out.costUsd, 'procurement-web');
    // 3. la merce: quella scelta, una del capitolato col nome giusto, o una nuova proposta da Alma
    const found = [];
    const saved = await db.tx(async client => {
      if (!item && out.merce?.name) {
        const { rows: [ex] } = await client.query('SELECT * FROM proc_items WHERE NOT archived AND lower(name) = lower($1) LIMIT 1', [out.merce.name]);
        item = ex || (await client.query(`INSERT INTO proc_items (category, subcategory, name, unit, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [out.merce.category, out.merce.subcategory || '', out.merce.name, out.merce.unit || '', `Creata da «Chiedi ad Alma»: ${query}`.slice(0, 2000), req.user.id])).rows[0];
        item._new = !ex;
      }
      for (const f of out.suppliers) {
        const s = await upsertSupplier(client, f, { userId: req.user.id, category: item?.category || out.merce?.category, subcategory: item?.subcategory || out.merce?.subcategory, origin: 'Alma Procurement (web)' });
        if (s.created) await setTag(client, s.id, 'da_qualificare', { why: 'Trovato da Alma sul web: da qualificare prima di un ordine' });
        if (f.quality) await setTag(client, s.id, 'qualita', { why: f.why });
        if (f.price) await setTag(client, s.id, 'prezzo', { why: f.why });
        if (item) await link(client, item.id, s.id, 'web', req.user.id, f.why);
        found.push({ subject_id: s.id, name: s.name, created: s.created, city: f.city, province: f.province, distance: f.distance, why: f.why, website: f.website, email: f.email, phone: f.phone, source: f.source,
          tags: [s.created ? 'da_qualificare' : null, f.quality ? 'qualita' : null, f.price ? 'prezzo' : null].filter(Boolean) });
      }
      const { rows: [srch] } = await client.query('INSERT INTO proc_searches (user_id, query, item_id, result, cost_eur) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [req.user.id, query, item?.id || null, JSON.stringify({ found, local, fake: Boolean(out.fake) }), out.costEur || 0]);
      return srch;
    });
    res.json({ search_id: saved.id, item: item ? { id: item.id, name: item.name, category: item.category, created: Boolean(item._new) } : null,
      local, found, cost_eur: out.costEur || 0, fake: Boolean(out.fake) });
  });
  app.get(`${BASE}/ricerche`, async (req, res) => {
    const { rows } = await db.query(`SELECT s.id, s.query, s.created_at, s.item_id, jsonb_array_length(COALESCE(s.result->'found', '[]'::jsonb))::int AS n
        FROM proc_searches s WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT 8`, [req.user.id]);
    res.json({ searches: rows });
  });
  // «Togli»: il fornitore trovato non va bene. Se Alma l'aveva appena creato e non c'è altro, sparisce dal CRM.
  app.post(`${BASE}/chiedi/:sid/togli`, async (req, res) => {
    const sid = v.int(req.params.sid, 'fornitore', { min: 1 });
    const itemId = v.int(req.body?.merce_id, 'merce', { min: 1, nullable: true }) || null;
    if (itemId) await db.query('DELETE FROM proc_item_suppliers WHERE item_id = $1 AND subject_id = $2', [itemId, sid]);
    const { rows: [s] } = await db.query(`SELECT s.id FROM crm_subjects s WHERE s.id = $1 AND s.origin = 'Alma Procurement (web)' AND s.created_by = $2
        AND s.created_at > now() - interval '7 days'
        AND NOT EXISTS (SELECT 1 FROM proc_item_suppliers l WHERE l.subject_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM crm_contact_links l WHERE l.subject_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM proc_rfq_recipients r WHERE r.subject_id = s.id)`, [sid, req.user.id]);
    if (s) await db.query('DELETE FROM crm_subjects WHERE id = $1', [sid]);
    res.json({ ok: true, removed_from_crm: Boolean(s) });
  });

  // ── Richieste di quotazione ────────────────────────────────────────────────────────────────────
  async function draftFor(req, rfq, item, r, { stile = '', t } = {}) {
    const target = r.email ? { address: r.email, name: r.name } : null;
    const samples = target ? await sentTo(t, target.address) : [];
    const tone = A.toneOf(samples, { name: target?.name });
    const toQualify = r.subject_id ? Boolean((await db.query("SELECT 1 FROM proc_supplier_tags WHERE subject_id = $1 AND tag = 'da_qualificare'", [r.subject_id])).rows.length) : false;
    const indicazioni = R.rfqPoints(rfq, item || {}, { toQualify, firstContact: !tone.n });
    const out = await A.toneDraft({ messages: [], reply: null, target, tone, samples: samples.map(x => S.ownPart(x)).slice(0, 6), meName: req.user.name, me: req.user.email,
      indicazioni, lingua: 'it', stile, oggetto: R.rfqSubject(rfq) }, ai()).catch(e => { if (e.status === 503 || e.status === 502) throw e; throw new HttpError(502, 'Alma non è riuscita a scrivere la bozza'); });
    await charge(req.user.id, eurToUsd(out.eur), 'procurement-mail');
    return { body: out.text, tone: { n: tone.n, tu: tone.tu, chips: tone.chips, level: R.toneLevel(tone), why: R.toneWhy(tone, target?.name), to_qualify: toQualify } };
  }
  async function sentTo(t, address) {
    const params = new URLSearchParams({ $search: `"to:${address.replace(/"/g, '')}"`, $top: '10', $select: 'body,toRecipients,sentDateTime,subject' });
    const data = await g(t, 'GET', `/me/mailFolders/sentitems/messages?${params}`, { headers: TEXT }).catch(() => ({ value: [] }));
    return (data.value || []).filter(x => (x.toRecipients || []).some(rr => rr.emailAddress?.address?.toLowerCase() === address))
      .sort((a, b) => String(b.sentDateTime).localeCompare(String(a.sentDateTime))).map(x => String(x.body?.content || ''));
  }
  async function rfqOr404(id, req) {
    const { rows: [q] } = await db.query('SELECT q.*, u.name AS created_by_name FROM proc_rfqs q LEFT JOIN users u ON u.id = q.created_by WHERE q.id = $1', [id]);
    if (!q) throw new HttpError(404, 'Richiesta non trovata');
    q.mine = q.created_by === req.user.id;
    return q;
  }
  const mustOwn = q => { if (!q.mine) throw new HttpError(403, 'Questa richiesta l\'ha preparata un\'altra persona: le email partono dalla sua casella'); };
  async function recipientsOf(rfqId) {
    const { rows } = await db.query(`SELECT r.*, s.name AS company FROM proc_rfq_recipients r LEFT JOIN crm_subjects s ON s.id = r.subject_id
       WHERE r.rfq_id = $1 AND r.status <> 'tolta' ORDER BY r.id`, [rfqId]);
    return rows;
  }

  app.post(`${BASE}/quotazioni`, async (req, res) => {
    const b = req.body || {};
    const item = await itemOr404(v.int(b.merce_id, 'merce', { min: 1 }));
    const ids = (v.ids(b.fornitori, 'fornitori') || []).slice(0, 30);
    if (!ids.length) throw new HttpError(400, 'Scegli almeno un fornitore');
    const rfqIn = {
      item_name: item.name, quantity: v.text(b.quantita, 'quantità', { max: 40 }) || '', unit: v.text(b.unita, 'unità', { max: 30 }) ?? item.unit ?? '',
      site: v.text(b.cantiere, 'cantiere', { max: 200 }) || '', delivery: v.text(b.consegna, 'consegna', { max: 300 }) || '',
      due_date: v.date(b.entro, 'risposta entro') || null, notes: v.text(b.note, 'note', { max: 1000 }) || '',
    };
    if (!rfqIn.unit) rfqIn.unit = item.unit || '';
    const { rows: subs } = await db.query('SELECT id, name, email FROM crm_subjects WHERE id = ANY($1::int[]) AND merged_into IS NULL', [ids]);
    const contacts = await mainContacts(subs.map(s => s.id));
    const { rows: [rfq] } = await db.query(`INSERT INTO proc_rfqs (item_id, item_name, quantity, unit, site, delivery, due_date, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [item.id, rfqIn.item_name, rfqIn.quantity, rfqIn.unit, rfqIn.site, rfqIn.delivery, rfqIn.due_date, rfqIn.notes, req.user.id]);
    const t = await readToken(req.user.id).catch(() => null);
    for (const s of ids.map(id => subs.find(x => x.id === id)).filter(Boolean)) {
      const c = contacts[s.id];
      const email = (c?.email || s.email || '').trim().toLowerCase();
      const name = c?.name || '';
      const r = { subject_id: s.id, contact_id: c?.email ? c.id : null, email, name };
      let d = { body: '', tone: { n: 0, level: 15, why: 'Manca l\'email: aggiungila nella scheda CRM del fornitore.' } };
      let status = 'bozza', error = '';
      if (!email) { status = 'errore'; error = 'Manca l\'email del fornitore: aggiungila nella scheda CRM'; } else if (t) d = await draftFor(req, rfq, item, r, { t });
      await db.query(`INSERT INTO proc_rfq_recipients (rfq_id, subject_id, contact_id, email, name, mail_subject, body, tone, status, error)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [rfq.id, s.id, r.contact_id, email, name, R.rfqSubject(rfq), d.body, JSON.stringify(d.tone), status, error]);
      // il fornitore scelto da qui entra nella merce, se non c'era
      await link(db, item.id, s.id, 'crm', req.user.id);
    }
    res.status(201).json({ rfq: { ...rfq, mine: true }, recipients: await recipientsOf(rfq.id) });
  });
  app.get(`${BASE}/quotazioni`, async (req, res) => {
    const { rows } = await db.query(`SELECT q.id, q.item_name, q.quantity, q.unit, q.site, q.due_date, q.status, q.created_at, q.sent_at, u.name AS created_by_name,
        COUNT(r.id) FILTER (WHERE r.status <> 'tolta')::int AS n,
        COUNT(r.id) FILTER (WHERE r.status = 'risposta')::int AS replies,
        COUNT(r.id) FILTER (WHERE r.status = 'inviata')::int AS waiting
        FROM proc_rfqs q LEFT JOIN proc_rfq_recipients r ON r.rfq_id = q.id LEFT JOIN users u ON u.id = q.created_by
       GROUP BY q.id, u.name ORDER BY COALESCE(q.sent_at, q.created_at) DESC LIMIT 100`);
    res.json({ rfqs: rows });
  });
  app.get(`${BASE}/quotazioni/:id`, async (req, res) => {
    const q = await rfqOr404(v.int(req.params.id, 'richiesta', { min: 1 }), req);
    if (q.status === 'inviata' && q.mine && req.query.aggiorna !== '0') await syncReplies(req, q).catch(e => console.warn('[procurement] risposte:', e.message));
    const recipients = await recipientsOf(q.id);
    const prices = recipients.map(r => r.offer?.price).filter(x => Number.isFinite(x));
    const best = prices.length ? Math.min(...prices) : null;
    res.json({ rfq: q, recipients: recipients.map(r => ({ ...r, best: best !== null && r.offer?.price === best && prices.length > 1,
      late: r.status === 'inviata' && r.sent_at && Date.now() - new Date(r.sent_at) > REMIND_DAYS * 864e5 })) });
  });
  app.put(`${BASE}/quotazioni/:id/destinatari/:rid`, async (req, res) => {
    const q = await rfqOr404(v.int(req.params.id, 'richiesta', { min: 1 }), req);
    mustOwn(q);
    const rid = v.int(req.params.rid, 'destinatario', { min: 1 });
    const b = req.body || {};
    const sets = [], vals = [];
    const add = (col, val) => { if (val !== undefined) { vals.push(val); sets.push(`${col} = $${vals.length + 2}`); } };
    add('mail_subject', v.text(b.oggetto, 'oggetto', { max: 250 }));
    add('body', typeof b.testo === 'string' ? b.testo.slice(0, 20000) : undefined);
    if (b.email !== undefined) {
      const e = String(b.email || '').trim().toLowerCase();
      if (!/^[^\s"@<>]+@[^\s"@<>]+\.[^\s"@<>]+$/.test(e)) throw new HttpError(400, 'Email non valida');
      add('email', e);
      if (b.testo === undefined) { vals.push(''); sets.push(`error = $${vals.length + 2}`); vals.push('bozza'); sets.push(`status = CASE WHEN status = 'errore' THEN $${vals.length + 2} ELSE status END`); }
    }
    if (b.approvata !== undefined) add('approved', b.approvata === true);
    if (b.togli === true) add('status', 'tolta');
    if (!sets.length) throw new HttpError(400, 'Niente da cambiare');
    const { rows: [r] } = await db.query(`UPDATE proc_rfq_recipients SET ${sets.join(', ')} WHERE id = $2 AND rfq_id = $1 AND status IN ('bozza', 'errore') RETURNING *`, [q.id, rid, ...vals]);
    if (!r) throw new HttpError(409, 'Questa email è già partita');
    res.json({ recipient: r });
  });
  app.post(`${BASE}/quotazioni/:id/approva-tutte`, async (req, res) => {
    const q = await rfqOr404(v.int(req.params.id, 'richiesta', { min: 1 }), req);
    mustOwn(q);
    await db.query("UPDATE proc_rfq_recipients SET approved = true WHERE rfq_id = $1 AND status = 'bozza' AND body <> ''", [q.id]);
    res.json({ recipients: await recipientsOf(q.id) });
  });
  app.post(`${BASE}/quotazioni/:id/destinatari/:rid/riscrivi`, async (req, res) => {
    const q = await rfqOr404(v.int(req.params.id, 'richiesta', { min: 1 }), req);
    mustOwn(q);
    const { rows: [r] } = await db.query("SELECT * FROM proc_rfq_recipients WHERE id = $1 AND rfq_id = $2 AND status IN ('bozza', 'errore')", [v.int(req.params.rid, 'destinatario', { min: 1 }), q.id]);
    if (!r) throw new HttpError(409, 'Questa email è già partita');
    if (!r.email) throw new HttpError(400, 'Manca l\'email del fornitore');
    const item = q.item_id ? (await db.query('SELECT * FROM proc_items WHERE id = $1', [q.item_id])).rows[0] : null;
    const stile = ['formale', 'breve'].includes(req.body?.stile) ? req.body.stile : '';
    const d = await draftFor(req, q, item, r, { stile, t: await readToken(req.user.id) });
    const { rows: [up] } = await db.query("UPDATE proc_rfq_recipients SET body = $2, tone = $3, approved = false, status = 'bozza', error = '' WHERE id = $1 RETURNING *", [r.id, d.body, JSON.stringify(d.tone)]);
    res.json({ recipient: up });
  });

  const graphMe = uid => (mailFake ? null : async () => g(await readToken(uid), 'GET', '/me?$select=displayName,jobTitle,mobilePhone,businessPhones'));
  const upload = (url, buf) => (mailFake ? mailFake.upload(url, buf) : PI.uploadChunks(url, buf));
  app.post(`${BASE}/quotazioni/:id/invia`, async (req, res) => {
    const q = await rfqOr404(v.int(req.params.id, 'richiesta', { min: 1 }), req);
    mustOwn(q);
    const { rows: list } = await db.query("SELECT * FROM proc_rfq_recipients WHERE rfq_id = $1 AND status = 'bozza' AND approved ORDER BY id", [q.id]);
    if (!list.length) throw new HttpError(400, 'Approva almeno un\'email prima di mandarla');
    const t = await writeToken(req.user.id);
    const signature = await F.signatureOf({ db, userId: req.user.id, graphMe: graphMe(req.user.id) });
    const out = [];
    for (const r of list) {
      try {
        if (!r.body.trim()) throw new HttpError(400, 'Email vuota');
        const s = await PI.compose({ g, upload, t, id: null, mode: 'nuova', to: PI.people([{ address: r.email, name: r.name }]), cc: [], subject: r.mail_subject || R.rfqSubject(q), text: r.body, signature: signature?.enabled ? signature : null });
        await db.query("UPDATE proc_rfq_recipients SET status = 'inviata', sent_at = now(), message_id = $2, conversation_id = $3, error = '' WHERE id = $1", [r.id, s.id || '', s.conversation_id || '']);
        out.push({ id: r.id, ok: true });
      } catch (e) {
        await db.query("UPDATE proc_rfq_recipients SET status = 'errore', error = $2 WHERE id = $1", [r.id, String(e.message || 'Invio non riuscito').slice(0, 300)]);
        out.push({ id: r.id, ok: false, error: e.message });
        if (e.status === 403) throw e;
      }
    }
    if (out.some(x => x.ok)) await db.query("UPDATE proc_rfqs SET status = 'inviata', sent_at = COALESCE(sent_at, now()) WHERE id = $1", [q.id]);
    res.json({ sent: out.filter(x => x.ok).length, failed: out.filter(x => !x.ok) });
  });

  // risposte: le email arrivate nella stessa conversazione, da chi non è chi ha mandato; l'offerta la legge Alma
  async function syncReplies(req, q) {
    const { rows } = await db.query("SELECT * FROM proc_rfq_recipients WHERE rfq_id = $1 AND status = 'inviata' AND conversation_id <> ''", [q.id]);
    if (!rows.length) return 0;
    const t = await readToken(req.user.id);
    const me = String(req.user.email || '').toLowerCase();
    let n = 0;
    for (const r of rows) {
      const conv = r.conversation_id.replace(/'/g, "''");
      const data = await g(t, 'GET', `/me/messages?$filter=${encodeURIComponent(`conversationId eq '${conv}'`)}&$select=from,receivedDateTime,bodyPreview,body&$top=20`, { headers: TEXT }).catch(() => ({ value: [] }));
      const replies = (data.value || []).filter(m => (m.from?.emailAddress?.address || '').toLowerCase() !== me && (!r.sent_at || new Date(m.receivedDateTime) >= new Date(r.sent_at)))
        .sort((a, b) => String(a.receivedDateTime).localeCompare(String(b.receivedDateTime)));
      if (!replies.length) continue;
      const m = replies[0];
      const text = S.ownPart(String(m.body?.content || m.bodyPreview || ''));
      const offer = await readOffer(req, q, text);
      await db.query("UPDATE proc_rfq_recipients SET status = 'risposta', reply_at = $2, reply_preview = $3, offer = $4 WHERE id = $1",
        [r.id, m.receivedDateTime, text.slice(0, 600), JSON.stringify(offer)]);
      n += 1;
    }
    return n;
  }
  async function readOffer(req, q, text) {
    const base = R.offerFromText(text);
    const r = await A.askLight({ ...ai(), maxTokens: 300,
      system: 'Leggi la risposta di un fornitore a una richiesta di quotazione. Rispondi SOLO con JSON {"prezzo": numero o null (prezzo unitario in euro), "unita": "m³|t|kg|m|ora|giorno|cad|…", "consegna": "frase breve", "pagamento": "es. 60 gg DFFM", "note": "condizioni importanti, es. pompa a parte"}. Non inventare: se un dato non c\'è, null o stringa vuota.',
      input: `Richiesta: ${q.quantity} ${q.unit} di ${q.item_name}.\n\nRisposta:\n${text.slice(0, 4000)}` }).catch(() => null);
    if (r?.eur) await charge(req.user.id, eurToUsd(r.eur), 'procurement-mail');
    const d = r?.data;
    if (!d) return base;
    const price = Number(d.prezzo);
    return { price: Number.isFinite(price) && price > 0 ? price : base.price, price_text: base.price_text, unit: R.clean(d.unita, 20) || base.unit,
      delivery: R.clean(d.consegna, 160) || base.delivery, payment: R.clean(d.pagamento, 80) || base.payment, notes: R.clean(d.note, 200), ai: true };
  }
  app.post(`${BASE}/quotazioni/:id/aggiorna`, async (req, res) => {
    const q = await rfqOr404(v.int(req.params.id, 'richiesta', { min: 1 }), req);
    mustOwn(q);
    res.json({ new_replies: await syncReplies(req, q) });
  });
  // Sollecito: rispondi nella stessa conversazione a chi non ha risposto (il clic è l'approvazione)
  app.post(`${BASE}/quotazioni/:id/sollecita`, async (req, res) => {
    const q = await rfqOr404(v.int(req.params.id, 'richiesta', { min: 1 }), req);
    mustOwn(q);
    const { rows } = await db.query("SELECT * FROM proc_rfq_recipients WHERE rfq_id = $1 AND status = 'inviata' AND message_id <> ''", [q.id]);
    if (!rows.length) throw new HttpError(400, 'Hanno risposto tutti');
    const t = await writeToken(req.user.id);
    let n = 0;
    for (const r of rows) {
      const tone = r.tone || {};
      const first = (r.name || '').split(/\s+/)[0];
      const text = tone.tu ? `Ciao${first ? ` ${first}` : ''},\nti riscrivo per la richiesta di prezzo qui sotto: riesci a mandarci la quotazione${q.due_date ? ` entro il ${new Date(`${String(q.due_date).slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}` : ''}?\n\nGrazie, a presto`
        : `Buongiorno${first ? ` ${first}` : ''},\nvi riscrivo per la nostra richiesta di quotazione qui sotto: potete farci avere la vostra offerta${q.due_date ? ` entro il ${new Date(`${String(q.due_date).slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}` : ''}?\n\nCordiali saluti`;
      try {
        await PI.compose({ g, upload, t, id: r.message_id, mode: 'rispondi', to: PI.people([{ address: r.email, name: r.name }]), cc: [], text });
        await db.query('UPDATE proc_rfq_recipients SET reminded_at = now() WHERE id = $1', [r.id]);
        n += 1;
      } catch (e) { console.warn('[procurement] sollecito:', e.message); }
    }
    res.json({ reminded: n });
  });
  app.post(`${BASE}/quotazioni/:id/chiudi`, async (req, res) => {
    const q = await rfqOr404(v.int(req.params.id, 'richiesta', { min: 1 }), req);
    await db.query("UPDATE proc_rfqs SET status = 'chiusa' WHERE id = $1", [q.id]);
    res.json({ ok: true });
  });

  // ── DDT di BOSS (da file finché BOSS non espone le righe): merci proposte ───────────────────────
  async function ddtProposals({ limit = 50 } = {}) {
    const { rows } = await db.query(`SELECT d.id, d.description, d.supplier, d.vat, d.bu, d.job_code, d.ddt_date FROM proc_ddt_lines d
       WHERE d.item_id IS NULL AND NOT d.dismissed ORDER BY d.ddt_date DESC NULLS LAST LIMIT 20000`);
    const groups = new Map();
    for (const r of rows) {
      const k = R.descKey(r.description);
      if (!k) continue;
      const g0 = groups.get(k) || { key: k, name: r.description, n: 0, suppliers: new Map(), bus: new Set(), jobs: new Set(), last: null };
      g0.n += 1;
      g0.suppliers.set(r.vat || r.supplier, r.supplier);
      if (r.bu) g0.bus.add(r.bu);
      if (r.job_code) g0.jobs.add(r.job_code);
      if (r.ddt_date && (!g0.last || r.ddt_date > g0.last)) g0.last = r.ddt_date;
      groups.set(k, g0);
    }
    const list = [...groups.values()].sort((a, b) => b.n - a.n).map(x => ({ key: x.key, name: x.name, n: x.n, suppliers: [...x.suppliers.values()].slice(0, 5), bus: [...x.bus], jobs: [...x.jobs].slice(0, 4),
      last: x.last, ...R.guessCategory(x.name) }));
    return { total: list.length, list: list.slice(0, limit) };
  }
  function rowsOf(buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) throw new HttpError(400, 'Carica l\'export dei DDT di BOSS (Excel o CSV)');
    let rows;
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      try { rows = Object.values(readXlsx(buf))[0] || []; } catch { throw new HttpError(400, 'Il file non è un Excel (.xlsx) valido'); }
    } else {
      let text = buf.toString('utf8');
      if (text.includes('�')) text = buf.toString('latin1');
      rows = parseDelimited(text.replace(/^﻿/, ''));
    }
    return rows;
  }
  app.post(`${BASE}/ddt`, raw, async (req, res) => {
    const name = String(req.query.nome || 'ddt').slice(0, 200);
    let lines;
    try { lines = R.ddtRows(rowsOf(req.body), name); } catch (e) { throw e instanceof HttpError ? e : new HttpError(e.status || 400, e.message); }
    if (!lines.length) throw new HttpError(400, 'Nel file non ci sono righe con fornitore e descrizione');
    await db.tx(async client => {
      for (const l of lines.slice(0, 50000)) {
        await client.query(`INSERT INTO proc_ddt_lines (supplier, vat, description, job_code, bu, ddt_date, quantity, unit, source, imported_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [l.supplier, l.vat, l.description, l.job_code, l.bu, l.ddt_date, l.quantity, l.unit, l.source, req.user.id]);
      }
    });
    res.json({ imported: Math.min(lines.length, 50000), proposals: (await ddtProposals({ limit: 0 })).total });
  });
  app.get(`${BASE}/ddt/proposte`, async (req, res) => res.json(await ddtProposals({ limit: 100 })));
  app.post(`${BASE}/ddt/proposte/aggiungi`, async (req, res) => {
    const b = req.body || {};
    const key = v.text(b.key, 'proposta', { max: 200, required: true });
    let f;
    try { f = R.itemFields({ category: b.category, subcategory: b.subcategory, name: b.name, unit: b.unit, bus: b.bus }); } catch (e) { throw new HttpError(e.status || 400, e.message); }
    const { rows: lines } = await db.query('SELECT id, description, supplier, vat, bu FROM proc_ddt_lines WHERE item_id IS NULL AND NOT dismissed');
    const mine = lines.filter(l => R.descKey(l.description) === key);
    if (!mine.length) throw new HttpError(404, 'Proposta non trovata');
    const out = await db.tx(async client => {
      let { rows: [it] } = await client.query('SELECT * FROM proc_items WHERE NOT archived AND category = $1 AND lower(name) = lower($2)', [f.category, f.name]);
      if (!it) ({ rows: [it] } = await client.query(`INSERT INTO proc_items (category, subcategory, name, unit, bus, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [f.category, f.subcategory || '', f.name, f.unit || '', f.bus?.length ? f.bus : [...new Set(mine.map(l => l.bu).filter(Boolean))].slice(0, 10), 'Dai DDT di BOSS', req.user.id]));
      const seen = new Set();
      for (const l of mine) {
        const k = l.vat || R.norm(l.supplier);
        if (seen.has(k)) continue;
        seen.add(k);
        const s = await upsertSupplier(client, { name: l.supplier, vat: l.vat }, { userId: req.user.id, category: f.category, subcategory: f.subcategory, origin: 'DDT di BOSS' });
        await link(client, it.id, s.id, 'boss', req.user.id);
      }
      await client.query('UPDATE proc_ddt_lines SET item_id = $1 WHERE id = ANY($2::int[])', [it.id, mine.map(l => l.id)]);
      return { item: it, suppliers: seen.size };
    });
    res.json(out);
  });
  app.post(`${BASE}/ddt/proposte/ignora`, async (req, res) => {
    const key = v.text(req.body?.key, 'proposta', { max: 200, required: true });
    const { rows } = await db.query('SELECT id, description FROM proc_ddt_lines WHERE item_id IS NULL AND NOT dismissed');
    const ids = rows.filter(l => R.descKey(l.description) === key).map(l => l.id);
    if (ids.length) await db.query('UPDATE proc_ddt_lines SET dismissed = true WHERE id = ANY($1::int[])', [ids]);
    res.json({ ok: true, lines: ids.length });
  });

  // per la casella finta in locale: risposte che arrivano da sole (vedi lib/procurement-fake)
  return { syncReplies };
}

module.exports = { registerProcurement };
