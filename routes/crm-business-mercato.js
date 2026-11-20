// Nuovi business · Mappa del mercato (Dante 20/11/2026, canvas «Nuovi business · Mappa del mercato», tavole NB-Mercato,
// NB-Mercato-Analisi, NB-Mercato-Stati, NB-Mercato-Telefono, NB-Mercato-Impresa, NB-Mercato-Categorie):
// - tab «Mercato»: chi vince nelle categorie SOA e nelle zone dell'iniziativa, chi compra, dove, ribasso per fascia;
// - «Cerca un'impresa» con la sua scheda di mercato;
// - categorie SOA del profilo dall'elenco ufficiale, con classifica facoltativa e «L'assistente propone»;
// - categorie non ancora caricate dal CRM → «le carico stanotte» e «Avvisami quando è pronto».
// Le gare sono quelle che il CRM scarica da ANAC (lib/crm-anac.js): qui si leggono soltanto.
const { HttpError, v } = require('../lib/http');
const { loadSettings } = require('../lib/crm-commerciale');
const { SOA_CATEGORIES, SOA_CLASSES } = require('../lib/crm');
const { normCat } = require('../lib/crm-anac');
const M = require('../lib/crm-business-mercato');

const SOA_CODES = SOA_CATEGORIES.map(([k]) => k);
const CLASS_CODES = SOA_CLASSES.map(([k]) => k);

function registerCrmBusinessMercato(app, { db, notifier, byId, editable, iid, addTarget, aiKey, fetchImpl }) {
  const opts = q => ({
    months: [12, 24].includes(Number(q.months)) ? Number(q.months) : 12,
    province: String(q.province || '').trim().slice(0, 60),
    cats: q.cats ? String(q.cats).split(',').map(normCat).filter(Boolean) : null,
  });

  app.get('/api/crm/business/:id/mercato', async (req, res) => {
    const i = await byId(iid(req));
    const settings = await loadSettings(db);
    const m = await M.market(db, settings, i, opts(req.query));
    const { rows: [w] } = await db.query('SELECT notified_at FROM crm_initiative_market_watch WHERE initiative_id = $1 AND user_id = $2', [i.id, req.user.id]);
    res.json({ ...m, watching: Boolean(w && !w.notified_at), admin: req.crm.admin, canEdit: req.crm.admin || [i.owner_id, i.sponsor_id, i.created_by].includes(req.user.id),
      min_amount: Number(settings.concorrenza?.min_amount) || 0, classes: i.profile?.soa_classes || {} });
  });

  app.get('/api/crm/business/:id/mercato/imprese', async (req, res) => {
    const i = await byId(iid(req));
    res.json({ companies: await M.searchCompanies(db, await loadSettings(db), i, req.query.q, opts(req.query)) });
  });

  app.get('/api/crm/business/:id/mercato/impresa', async (req, res) => {
    const i = await byId(iid(req));
    const cf = String(req.query.cf || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    const name = v.text(req.query.name, 'Impresa', { max: 200 }) || '';
    if (!cf && !name) throw new HttpError(400, 'Scegli un\'impresa');
    const c = await M.company(db, await loadSettings(db), i, { cf, name }, opts(req.query));
    if (!c) throw new HttpError(404, 'Questa impresa non ha gare vinte nelle categorie e zone dell\'iniziativa');
    res.json(c);
  });

  // «Avvisami quando è pronto»: un avviso quando le categorie mancanti arrivano tra le gare caricate
  app.post('/api/crm/business/:id/mercato/avvisami', async (req, res) => {
    const i = await byId(iid(req));
    const st = await M.dataState(db, i);
    if (!st.missing.length) return res.json({ ready: true });
    await db.query(`INSERT INTO crm_initiative_market_watch (initiative_id, user_id, categories) VALUES ($1, $2, $3)
                    ON CONFLICT (initiative_id, user_id) DO UPDATE SET categories = EXCLUDED.categories, notified_at = NULL, created_at = now()`, [i.id, req.user.id, st.missing]);
    res.json({ watching: true, categories: st.missing });
  });

  // «Aggiungi ai clienti target» da «Chi compra»
  app.post('/api/crm/business/:id/mercato/stazione', async (req, res) => {
    const i = await editable(req, iid(req));
    const name = v.text(req.body.name, 'Stazione appaltante', { max: 200, required: true });
    const gare = Number(req.body.gare) || 0;
    const t = await addTarget(i, { name, segment: 'Stazione appaltante', priority: gare >= 3 ? 'alta' : 'media',
      why: `${gare ? `${gare} ${gare === 1 ? 'gara aggiudicata' : 'gare aggiudicate'} nelle nostre categorie` : 'Compra nelle nostre categorie'} (dati ANAC)` }, req.user.id);
    res.status(t ? 201 : 200).json({ target: t, existed: !t });
  });

  // categorie SOA del profilo (elenco ufficiale) con classifica facoltativa; il resto del profilo resta com'è
  app.put('/api/crm/business/:id/soa', async (req, res) => {
    const i = await editable(req, iid(req));
    const list = Array.isArray(req.body.soa) ? [...new Set(req.body.soa.map(normCat))] : null;
    if (!list) throw new HttpError(400, 'Le categorie non sono valide');
    const bad = list.filter(c => !SOA_CODES.includes(c));
    if (bad.length) throw new HttpError(400, `Categoria SOA sconosciuta: ${bad.join(', ')}`);
    if (list.length > 12) throw new HttpError(400, 'Al massimo 12 categorie');
    const classes = {};
    for (const [k, c] of Object.entries(req.body.classes || {})) {
      const code = normCat(k);
      if (list.includes(code) && c) { if (!CLASS_CODES.includes(c)) throw new HttpError(400, `Classifica non valida: ${c}`); classes[code] = c; }
    }
    const profile = { ...(i.profile || {}), soa: list, soa_classes: classes };
    await db.query('UPDATE crm_initiatives SET profile = $2, updated_at = now() WHERE id = $1', [i.id, JSON.stringify(profile)]);
    const st = await M.dataState(db, { ...i, profile });
    res.json({ soa: list, classes, missing: st.missing });
  });

  // «L'assistente propone» le categorie leggendo descrizione e profilo; si confermano una per una
  app.post('/api/crm/business/:id/soa/proponi', async (req, res) => {
    const i = await byId(iid(req));
    const text = [i.name, i.description, i.profile?.description, ...(i.profile?.works || [])].filter(Boolean).join('. ');
    let out = M.proposeSoa(text);
    let source = 'regole';
    const key = aiKey();
    if (key) {
      try {
        const list = SOA_CATEGORIES.map(([k, l]) => `${k} ${l}`).join('; ');
        const r = await fetchImpl()('https://api.openai.com/v1/responses', {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: process.env.OPENAI_BUSINESS_MODEL || 'gpt-4.1-mini', input: [
            { role: 'system', content: `Sei un esperto di qualificazione SOA per imprese edili italiane. Categorie: ${list}. Rispondi SOLO con JSON {"categorie":[{"code":"OG10","why":"motivo breve"}]}, massimo 5, solo codici dell'elenco.` },
            { role: 'user', content: `Iniziativa: ${text}` }] }),
        });
        const data = await r.json().catch(() => ({}));
        const raw = data.output_text || (data.output || []).flatMap(o => o.content || []).map(c => c.text || '').join('\n');
        const m = String(raw).match(/\{[\s\S]*\}/);
        const got = m ? (JSON.parse(m[0]).categorie || []) : [];
        const clean = got.map(x => ({ code: normCat(x?.code), why: String(x?.why || '').slice(0, 120) })).filter(x => SOA_CODES.includes(x.code)).slice(0, 5);
        if (clean.length) { out = clean; source = 'assistente'; }
      } catch { /* resta la proposta a regole */ }
    }
    const chosen = M.catsOf(i);
    res.json({ proposals: out.map(x => ({ ...x, label: SOA_CATEGORIES.find(([k]) => k === x.code)?.[1] || '', chosen: chosen.includes(x.code) })), source });
  });

  // ogni ora: chi ha chiesto «Avvisami» riceve la notifica quando le categorie sono arrivate
  async function watchTick() {
    const { rows } = await db.query(`SELECT w.*, i.name FROM crm_initiative_market_watch w JOIN crm_initiatives i ON i.id = w.initiative_id WHERE w.notified_at IS NULL`);
    for (const w of rows) {
      const loaded = await M.loadedCats(db, w.categories);
      if (loaded.length < w.categories.length) continue;
      await notifier.notify({ userIds: [w.user_id], actorId: null, kind: 'crm', body: `le gare ${w.categories.join(' e ')} sono arrivate: la tab Mercato di «${w.name}» è pronta`, link: `/crm/business/${w.initiative_id}/mercato` });
      await db.query('UPDATE crm_initiative_market_watch SET notified_at = now() WHERE initiative_id = $1 AND user_id = $2', [w.initiative_id, w.user_id]);
    }
  }
  if (!process.env.NODE_TEST_CONTEXT) {
    const t = setInterval(() => watchTick().catch(err => console.warn('[mercato]', err.message)), 60 * 60000);
    t.unref?.();
  }
  return { watchTick };
}

module.exports = { registerCrmBusinessMercato };
