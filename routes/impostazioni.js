// Impostazioni uniche di Alma Space (canvas «Alma Space · Impostazioni», approvato da Dante il 19/11/2026).
// Solo amministratori, tranne Costi AI per chi ha «Costi AI: Tutto» nella privacy.
// /api/impostazioni/panoramica · organigramma (+ sync, ruoli, assegna) · utenti (+ sospendi, riattiva, invita)
// · costi · privacy (+ eccezioni, prova) · registro (+ .csv) · integrazioni (+ prova Microsoft)
const { HttpError, v } = require('../lib/http');
const { graph } = require('../lib/graph');
const { getSetting, saveSetting } = require('../lib/settings');
const { AREAS, LEVELS, RULES, ADMIN_EDITABLE } = require('../lib/impostazioni');
const { syncOrg } = require('./org');
const QUOTA = require('../lib/alma-quota');

const BASE = '/api/impostazioni';
const ALMA_SETTING = 'alma.settings';
const ALMA_DEFAULTS = { monthly_eur: 150, daily_eur: 1, usd_eur: 0.92 };
const ACCESS_ACTIONS = ['login', 'login_refused', 'logout', 'logout_all', 'session_revoked'];
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const romeDay = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const norm = s => String(s || '').trim().toLowerCase();

// Funzione AI dal nome del modello registrato in assistant_usage
function featureOf(model) {
  const m = norm(model);
  if (/transcrib|whisper/.test(m)) return 'trascrizioni';
  if (/realtime|tts|audio/.test(m)) return 'voce';
  return 'scritto';
}
const FEATURES = { scritto: 'Alma per scritto', voce: 'Alma a voce', trascrizioni: 'Trascrizioni', crm: 'Ricerche AI del CRM' };

// Registro: modulo e frase leggibile da «METODO /api/percorso»
const MODULES = { tickets: 'Alma Project', projects: 'Alma Project', areas: 'Alma Project', notes: 'Alma Project', calendar: 'Alma Project', feed: 'Alma Agorà', posts: 'Alma Agorà', stories: 'Alma Agorà',
  media: 'Alma Agorà', drive: 'Documenti', crm: 'Alma CRM', mezzi: 'Mezzi', energy: 'Alma Energy', alma: 'Alma', strategy: 'Alma Strategy', performance: 'Alma Strategy',
  software: 'Alma IT', it: 'Alma IT', rda: 'Alma Project', impostazioni: 'Impostazioni', org: 'Persone', users: 'Persone', me: 'Profilo', alerts: 'Notifiche', notifications: 'Notifiche', ideas: 'Alma Agorà' };
const NOUNS = { tickets: 'un ticket', projects: 'un progetto', notes: 'una nota', posts: 'un post', crm: 'il CRM', mezzi: 'i mezzi', energy: 'Alma Energy', drive: 'un documento',
  alma: 'Alma', impostazioni: 'le impostazioni', calendar: 'il calendario', rda: 'una RDA', strategy: 'Alma Strategy', ideas: 'un\'idea', org: 'l\'organigramma', me: 'il suo profilo' };
function describe(row) {
  const d = row.detail || {};
  const access = { login: 'Accesso', login_refused: 'Accesso rifiutato', logout: 'Uscita', logout_all: 'Uscita da tutti i dispositivi', session_revoked: 'Sessione chiusa da Microsoft' };
  if (access[row.action]) return { what: access[row.action], module: 'Accesso', target: d.target || '', kind: 'accessi' };
  const m = /^(POST|PUT|PATCH|DELETE) \/api\/([a-z0-9-]+)(\/[^ ]*)?$/i.exec(row.action || '');
  if (!m) return { what: row.action, module: '', target: d.target || '', kind: 'modifiche' };
  const [, method, seg] = m;
  const verb = { POST: 'Ha creato o mandato', PUT: 'Ha cambiato', PATCH: 'Ha modificato', DELETE: 'Ha eliminato' }[method.toUpperCase()];
  return { what: d.label || `${verb} ${NOUNS[seg] || seg}`, module: MODULES[seg] || seg, target: d.target || '', kind: seg === 'impostazioni' ? 'impostazioni' : 'modifiche' };
}

function registerImpostazioni(app, { db, auth, gov, notifier, config }) {
  const adminOnly = req => { if (!gov.isAdmin(req)) throw new HttpError(403, 'Le impostazioni le gestiscono gli amministratori'); };
  const audit = (req, label, target, before, after) => { req.auditDetail = { label, target, before, after }; };
  const one = async (sql, p) => (await db.query(sql, p)).rows[0];

  // ── Panoramica ─────────────────────────────────────────────────────────────────────────────────
  app.get(`${BASE}/panoramica`, async (req, res) => {
    adminOnly(req);
    const [sync, users, depts, cost, refused, exc] = await Promise.all([
      one('SELECT synced_at, people FROM org_sync WHERE id = 1'),
      one(`SELECT COUNT(*) FILTER (WHERE last_login IS NOT NULL)::int AS entered,
                  COUNT(*) FILTER (WHERE suspended_at IS NOT NULL)::int AS suspended FROM users`),
      one(`SELECT COUNT(*)::int AS never FROM org_people o WHERE NOT EXISTS (
             SELECT 1 FROM users u WHERE (u.oid = o.oid OR lower(u.email) = o.email) AND u.last_login IS NOT NULL)`),
      costSummary(),
      one(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'login_refused' AND created_at >= date_trunc('day', now())`),
      one('SELECT COUNT(*)::int AS n FROM privacy_exceptions WHERE until IS NULL OR until >= CURRENT_DATE'),
    ]);
    res.json({
      org: sync || null, users: { ...users, never: depts.never }, cost: { month_eur: cost.month_eur, cap_eur: cost.cap_eur },
      refused_today: refused.n, roles: gov.state.roles.length, exceptions: exc.n, microsoft: Boolean(auth.msConfigured),
    });
  });

  // ── Organigramma e ruoli ───────────────────────────────────────────────────────────────────────
  app.get(`${BASE}/organigramma`, async (req, res) => {
    adminOnly(req);
    const [sync, people, manual] = await Promise.all([
      one('SELECT s.*, u.name AS synced_by_name FROM org_sync s LEFT JOIN users u ON u.id = s.synced_by WHERE s.id = 1'),
      db.query('SELECT oid, name, lower(email) AS email, job_title, department, manager_oid FROM org_people ORDER BY name'),
      db.query(`SELECT a.email, a.role_key, a.assigned_at, b.name AS assigned_by_name,
                       COALESCE(o.name, u.name, a.email) AS name
                  FROM role_assignments a LEFT JOIN users b ON b.id = a.assigned_by
                  LEFT JOIN org_people o ON lower(o.email) = a.email LEFT JOIN users u ON lower(u.email) = a.email
                 ORDER BY name`),
    ]);
    const list = people.rows;
    const byManager = new Map();
    for (const p of list) if (p.manager_oid) byManager.set(p.manager_oid, (byManager.get(p.manager_oid) || 0) + 1);
    const ids = new Set(list.map(p => p.oid));
    // vertici: chi non ha responsabile ma ha collaboratori; poi i loro diretti
    const tops = list.filter(p => !p.manager_oid && byManager.has(p.oid));
    const team = oid => { // persone sotto, a ogni livello
      let n = 0; const stack = [oid];
      while (stack.length) { const cur = stack.pop(); for (const p of list) if (p.manager_oid === cur) { n += 1; stack.push(p.oid); } }
      return n;
    };
    const node = p => ({ oid: p.oid, name: p.name, job_title: p.job_title, department: p.department, team: team(p.oid) });
    const tree = tops.map(t => ({ ...node(t), children: list.filter(p => p.manager_oid === t.oid).map(c => ({ ...node(c), children: list.filter(g => g.manager_oid === c.oid && byManager.has(g.oid)).map(node) })) }));
    const counts = {};
    const roleKey = email => (gov.isAdminEmail(email) ? 'admin' : gov.roleOf(email).key);
    for (const p of list) { const k = roleKey(p.email); counts[k] = (counts[k] || 0) + 1; }
    // chi è entrato senza essere nell'organigramma (ospiti, account fuori da Entra)
    const outside = (await db.query('SELECT lower(email) AS email FROM users WHERE last_login IS NOT NULL')).rows.filter(u => !list.some(p => p.email === u.email));
    for (const u of outside) { const k = roleKey(u.email); counts[k] = (counts[k] || 0) + 1; }
    for (const e of gov.envAdmins) if (!list.some(p => p.email === e) && !outside.some(u => u.email === e)) counts.admin = (counts.admin || 0) + 1;
    res.json({
      sync: sync || null,
      people: list.length,
      departments: new Set(list.map(p => p.department).filter(Boolean)).size,
      without_manager: list.filter(p => !p.manager_oid || !ids.has(p.manager_oid)).filter(p => !tops.includes(p)).map(p => ({ name: p.name, email: p.email, job_title: p.job_title })),
      tree,
      roles: gov.state.roles.map(r => ({ ...r, rule_label: RULES[r.rule], people: counts[r.key] || 0 })),
      rules: RULES,
      manual: manual.rows.map(m => ({ ...m, rule_role: gov.ruleRole(m.email), differs: gov.ruleRole(m.email) !== m.role_key })),
      env_admins: [...gov.envAdmins],
      directory: list.map(p => ({ email: p.email, name: p.name, role: gov.roleOf(p.email) })),
    });
  });

  app.post(`${BASE}/organigramma/sync`, async (req, res) => {
    adminOnly(req);
    audit(req, 'Ha aggiornato l\'organigramma da Microsoft', 'Microsoft Entra');
    res.json(await syncOrg({ db, auth, notifier, gov, actorId: req.user.id }));
  });

  const RULE_KEYS = Object.keys(RULES);
  const slug = s => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  app.post(`${BASE}/ruoli`, async (req, res) => {
    adminOnly(req);
    const b = req.body || {};
    const label = v.text(b.label, 'nome del ruolo', { max: 60, required: true });
    const rule = v.oneOf(b.rule || 'manual', 'regola', RULE_KEYS);
    if (rule === 'default' || rule === 'guest') throw new HttpError(400, 'Questa regola ce l\'ha già un ruolo di sistema');
    const key = slug(label);
    if (!key) throw new HttpError(400, 'Nome del ruolo non valido');
    const ruleValue = ['job_title', 'department'].includes(rule) ? v.text(b.rule_value, 'testo della regola', { max: 100, required: true }) : null;
    const position = v.int(b.position, 'ordine', { min: 1, max: 89 }) ?? 50;
    const exists = await one('SELECT 1 FROM roles WHERE key = $1', [key]);
    if (exists) throw new HttpError(409, 'C\'è già un ruolo con questo nome');
    await db.query('INSERT INTO roles (key, label, rule, rule_value, position) VALUES ($1, $2, $3, $4, $5)', [key, label, rule, ruleValue, position]);
    audit(req, 'Ha creato un ruolo', label, null, { regola: RULES[rule], testo: ruleValue });
    await gov.reload();
    res.status(201).json({ key });
  });

  app.patch(`${BASE}/ruoli/:key`, async (req, res) => {
    adminOnly(req);
    const role = await one('SELECT * FROM roles WHERE key = $1', [req.params.key]);
    if (!role) throw new HttpError(404, 'Ruolo non trovato');
    const b = req.body || {};
    const label = b.label !== undefined ? v.text(b.label, 'nome del ruolo', { max: 60, required: true }) : role.label;
    let rule = role.rule, ruleValue = role.rule_value, position = role.position;
    if (!role.system) {
      if (b.rule !== undefined) rule = v.oneOf(b.rule, 'regola', RULE_KEYS.filter(k => !['default', 'guest'].includes(k)));
      if (b.rule_value !== undefined || b.rule !== undefined) ruleValue = ['job_title', 'department'].includes(rule) ? v.text(b.rule_value ?? role.rule_value, 'testo della regola', { max: 100, required: true }) : null;
      if (b.position !== undefined) position = v.int(b.position, 'ordine', { min: 1, max: 89 });
    }
    await db.query('UPDATE roles SET label = $2, rule = $3, rule_value = $4, position = $5 WHERE key = $1', [role.key, label, rule, ruleValue, position]);
    audit(req, 'Ha cambiato un ruolo', label, { nome: role.label, regola: RULES[role.rule], testo: role.rule_value }, { nome: label, regola: RULES[rule], testo: ruleValue });
    await gov.reload();
    res.json({ ok: true });
  });

  app.delete(`${BASE}/ruoli/:key`, async (req, res) => {
    adminOnly(req);
    const role = await one('SELECT * FROM roles WHERE key = $1', [req.params.key]);
    if (!role) throw new HttpError(404, 'Ruolo non trovato');
    if (role.system) throw new HttpError(400, 'I ruoli di sistema non si eliminano');
    await db.query('DELETE FROM roles WHERE key = $1', [role.key]);
    audit(req, 'Ha eliminato un ruolo', role.label, { nome: role.label }, null);
    await gov.reload();
    res.json({ ok: true });
  });

  // Ruolo dato a mano (role_key null = torna alla regola). Non ci si toglie da soli il ruolo di amministratore.
  app.put(`${BASE}/ruoli-assegnati`, async (req, res) => {
    adminOnly(req);
    const b = req.body || {};
    const email = norm(v.text(b.email, 'email', { max: 300, required: true }));
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, 'Email non valida');
    const before = gov.roleOf(email);
    const roleKey = b.role_key ? v.oneOf(b.role_key, 'ruolo', gov.state.roles.map(r => r.key)) : null;
    if (email === norm(req.user.email) && before.key === 'admin' && roleKey !== 'admin' && !gov.envAdmins.has(email)) {
      throw new HttpError(400, 'Non puoi toglierti da solo il ruolo di amministratore: chiedilo a un altro amministratore');
    }
    if (roleKey) {
      await db.query(`INSERT INTO role_assignments (email, role_key, assigned_by) VALUES ($1, $2, $3)
                      ON CONFLICT (email) DO UPDATE SET role_key = EXCLUDED.role_key, assigned_by = EXCLUDED.assigned_by, assigned_at = now()`, [email, roleKey, req.user.id]);
    } else {
      await db.query('DELETE FROM role_assignments WHERE email = $1', [email]);
    }
    await gov.reload();
    const after = gov.roleOf(email);
    const label = k => gov.state.roles.find(r => r.key === k)?.label || k;
    audit(req, 'Ha cambiato il ruolo di una persona', email, { ruolo: label(before.key) }, { ruolo: label(after.key), da: after.source === 'manual' ? 'a mano' : 'regola' });
    res.json({ role: after });
  });

  // ── Utenti ─────────────────────────────────────────────────────────────────────────────────────
  app.get(`${BASE}/utenti`, async (req, res) => {
    adminOnly(req);
    const label = k => gov.state.roles.find(r => r.key === k)?.label || k;
    const users = (await db.query(
      `SELECT u.id, u.name, lower(u.email) AS email, u.first_login, u.last_login, u.suspended_at, s.name AS suspended_by_name,
              o.department, o.job_title,
              (SELECT COUNT(*)::int FROM sessions x WHERE x.user_id = u.id AND x.expires_at > now()) AS sessions
         FROM users u LEFT JOIN users s ON s.id = u.suspended_by
         LEFT JOIN org_people o ON o.oid = u.oid OR lower(o.email) = lower(u.email)
        ORDER BY u.last_login DESC NULLS LAST, u.name`)).rows;
    const seen = new Set();
    const list = users.filter(u => !seen.has(u.id) && seen.add(u.id)).map(u => {
      const role = gov.isAdminEmail(u.email) ? 'admin' : gov.roleOf(u.email).key;
      return { ...u, role, role_label: label(role) };
    });
    const never = (await db.query(
      `SELECT o.name, lower(o.email) AS email, o.department, o.job_title FROM org_people o
        WHERE o.email IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE (u.oid = o.oid OR lower(u.email) = lower(o.email)) AND u.last_login IS NOT NULL)
        ORDER BY o.name`)).rows.map(p => ({ ...p, role_label: label(gov.roleOf(p.email).key) }));
    const weekAgo = Date.now() - 7 * 86400000;
    res.json({
      kpi: {
        entered: list.filter(u => u.last_login).length,
        active_7d: list.filter(u => u.last_login && new Date(u.last_login).getTime() >= weekAgo).length,
        never: never.length,
        suspended: list.filter(u => u.suspended_at).length,
      },
      users: list.filter(u => u.last_login || u.suspended_at),
      never,
      roles: gov.state.roles.map(r => ({ key: r.key, label: r.label })),
    });
  });

  app.post(`${BASE}/utenti/:id/sospendi`, async (req, res) => {
    adminOnly(req);
    const id = v.int(req.params.id, 'utente', { min: 1 });
    if (id === req.user.id) throw new HttpError(400, 'Non puoi sospendere te stesso');
    const u = await one('SELECT id, name, email FROM users WHERE id = $1', [id]);
    if (!u) throw new HttpError(404, 'Utente non trovato');
    if (gov.envAdmins.has(norm(u.email))) throw new HttpError(400, 'Questo amministratore è nella chiave di riserva su Railway (ADMIN_EMAILS): toglilo da lì prima');
    await db.query('UPDATE users SET suspended_at = now(), suspended_by = $2 WHERE id = $1', [id, req.user.id]);
    await auth.revokeUser(id); // esce subito da tutti i dispositivi
    audit(req, 'Ha sospeso un utente', u.name, { stato: 'attivo' }, { stato: 'sospeso' });
    res.json({ ok: true });
  });

  app.post(`${BASE}/utenti/:id/riattiva`, async (req, res) => {
    adminOnly(req);
    const id = v.int(req.params.id, 'utente', { min: 1 });
    const u = await one('SELECT id, name FROM users WHERE id = $1', [id]);
    if (!u) throw new HttpError(404, 'Utente non trovato');
    await db.query('UPDATE users SET suspended_at = NULL, suspended_by = NULL WHERE id = $1', [id]);
    audit(req, 'Ha riattivato un utente', u.name, { stato: 'sospeso' }, { stato: 'attivo' });
    res.json({ ok: true });
  });

  // Invito a chi è in Entra ma non è mai entrato: email dalla casella Outlook di chi invita (max 50 per volta).
  app.post(`${BASE}/utenti/invita`, async (req, res) => {
    adminOnly(req);
    const emails = [...new Set((Array.isArray(req.body?.emails) ? req.body.emails : []).map(norm).filter(e => /^[^@\s]+@[^@\s]+$/.test(e)))].slice(0, 50);
    if (!emails.length) throw new HttpError(400, 'Scegli almeno una persona');
    const people = (await db.query('SELECT name, lower(email) AS email FROM org_people WHERE lower(email) = ANY($1::text[])', [emails])).rows;
    if (!people.length) throw new HttpError(400, 'Nessuna di queste persone è nell\'organigramma di Microsoft');
    const token = await auth.graphToken(req.user.id);
    const link = `${config?.baseUrl || ''}/app`;
    let sent = 0;
    for (const p of people) {
      const html = `<div style="font-family:Roboto,Arial,sans-serif;font-size:15px;color:#3F3F3F;line-height:1.5">
  <p>Ciao ${escapeHtml(p.name.split(' ')[0])},</p>
  <p>${escapeHtml(req.user.name)} ti invita su <b>Alma Space</b>, la intranet di Almacis: progetti, ticket, persone, mezzi e Alma, l'assistente.</p>
  <p>Si entra con il tuo account Microsoft di lavoro, senza password nuove.</p>
  <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#FF8A26;color:#FFFFFF;text-decoration:none;padding:10px 16px;border-radius:12px;font-weight:500">Entra in Alma Space</a></p>
</div>`;
      try {
        await graph(token, 'POST', '/me/sendMail', { body: { message: { subject: 'Ti aspettiamo su Alma Space', body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: p.email, name: p.name } }] }, saveToSentItems: true } });
        sent += 1;
      } catch (err) {
        console.warn(`[impostazioni] invito a ${p.email} non mandato: ${err.message}`);
      }
    }
    audit(req, `Ha invitato ${sent} ${sent === 1 ? 'persona' : 'persone'}`, people.map(p => p.name).join(', ').slice(0, 300));
    res.json({ sent, asked: emails.length });
  });

  // ── Costi AI ───────────────────────────────────────────────────────────────────────────────────
  async function almaSettings() {
    const s = (await getSetting(db, ALMA_SETTING, {})) || {};
    return {
      raw: s,
      monthly_eur: Number(s.monthly_eur) > 0 ? Number(s.monthly_eur) : ALMA_DEFAULTS.monthly_eur,
      daily_eur: Number(s.daily_eur) > 0 ? Number(s.daily_eur) : ALMA_DEFAULTS.daily_eur,
      usd_eur: Number(s.usd_eur) > 0 ? Number(s.usd_eur) : ALMA_DEFAULTS.usd_eur,
    };
  }
  async function costSummary(month = romeDay().slice(0, 7)) {
    const s = await almaSettings();
    const from = `${month}-01`;
    const { rows: [t] } = await db.query(`SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM assistant_usage WHERE to_char(day, 'YYYY-MM') = $1`, [month]);
    const crm = await one(`SELECT COALESCE((SELECT SUM(eur) FROM crm_radar_spend WHERE month = $1), 0) + COALESCE((SELECT SUM(eur) FROM crm_initiative_spend WHERE month = $1), 0) + COALESCE((SELECT SUM(eur) FROM crm_mail_spend WHERE month = $1), 0) AS eur`, [month]);
    return { month, from, settings: s, month_eur: r2(Number(t.usd) * s.usd_eur + Number(crm.eur)), alma_eur: r2(Number(t.usd) * s.usd_eur), crm_eur: r2(crm.eur), cap_eur: s.monthly_eur };
  }

  app.get(`${BASE}/costi`, async (req, res) => {
    if (!gov.isAdmin(req) && req.privacy?.costi_ai !== 'all') throw new HttpError(403, 'I costi AI li vedono gli amministratori');
    const month = /^\d{4}-\d{2}$/.test(String(req.query.mese || '')) ? String(req.query.mese) : romeDay().slice(0, 7);
    const sum = await costSummary(month);
    const s = sum.settings;
    const byModel = (await db.query(`SELECT model, SUM(cost_usd) AS usd FROM assistant_usage WHERE to_char(day, 'YYYY-MM') = $1 GROUP BY model`, [month])).rows;
    const features = { scritto: 0, voce: 0, trascrizioni: 0, crm: sum.crm_eur };
    for (const m of byModel) features[featureOf(m.model)] += Number(m.usd) * s.usd_eur;
    const today = romeDay();
    const people = (await db.query(
      `SELECT u.id, u.name, u.email, SUM(a.cost_usd) AS usd,
              SUM(a.cost_usd) FILTER (WHERE a.day = $2::date) AS today_usd,
              (SELECT COUNT(*)::int FROM assistant_traces t WHERE t.user_id = u.id AND to_char(t.created_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM') = $1) AS questions
         FROM assistant_usage a JOIN users u ON u.id = a.user_id
        WHERE to_char(a.day, 'YYYY-MM') = $1 GROUP BY u.id, u.name, u.email ORDER BY usd DESC`, [month, today])).rows;
    const capDays = (await db.query(
      `SELECT user_id, COUNT(*)::int AS n FROM (SELECT user_id, day, SUM(cost_usd) AS usd FROM assistant_usage
         WHERE to_char(day, 'YYYY-MM') = $1 AND user_id IS NOT NULL GROUP BY user_id, day) d WHERE d.usd * $2 >= $3 GROUP BY user_id`, [month, s.usd_eur, s.daily_eur])).rows;
    const months = (await db.query(
      `SELECT to_char(day, 'YYYY-MM') AS month, SUM(cost_usd) AS usd FROM assistant_usage WHERE day >= (date_trunc('month', now()) - interval '5 months')
        GROUP BY 1 ORDER BY 1`)).rows.map(m => ({ month: m.month, eur: r2(Number(m.usd) * s.usd_eur) }));
    // previsione: spesa fino a oggi ÷ giorni passati × giorni del mese (solo per il mese in corso)
    const [y, mo] = month.split('-').map(Number);
    const daysIn = new Date(y, mo, 0).getDate();
    const isCurrent = month === today.slice(0, 7);
    const dayNow = isCurrent ? Number(today.slice(8, 10)) : daysIn;
    const forecast = isCurrent && dayNow ? r2(sum.month_eur / dayNow * daysIn) : sum.month_eur;
    const alertPct = Number(await getSetting(db, 'planet.ai_alert_pct', 80)) || 80;
    // Quota al giorno di ognuno (ALM2-62): eccezione della persona, amministratori senza limite, poi quella di tutti.
    const quotaOf = u => QUOTA.quotaFor(s.raw, { userId: u.id, admin: gov.isAdminEmail(u.email), daily: s.daily_eur });
    const overrides = Object.keys((s.raw && s.raw.user_daily) || {}).map(Number).filter(Boolean);
    const users = gov.isAdmin(req) ? (await db.query('SELECT id, name, email FROM users WHERE suspended_at IS NULL ORDER BY name')).rows : [];
    const quotas = users.filter(u => overrides.includes(u.id)).map(u => ({ id: u.id, name: u.name, value: QUOTA.overrideOf(s.raw, u.id) }));
    res.json({
      admins_unlimited: s.raw.admins_unlimited !== false, quotas, users: users.map(u => ({ id: u.id, name: u.name, admin: gov.isAdminEmail(u.email) })),
      month, month_eur: sum.month_eur, cap_eur: s.monthly_eur, daily_eur: s.daily_eur, usd_eur: s.usd_eur, alert_pct: alertPct,
      pct: s.monthly_eur ? Math.round(sum.month_eur / s.monthly_eur * 100) : 0, forecast_eur: forecast, is_current: isCurrent,
      features: Object.entries(features).map(([k, eur]) => ({ key: k, label: FEATURES[k], eur: r2(eur) })),
      people: people.map(p => ({ id: p.id, name: p.name, questions: p.questions, eur: r2(Number(p.usd) * s.usd_eur), today_eur: r2(Number(p.today_usd || 0) * s.usd_eur), quota: quotaOf(p), cap_days: capDays.find(c => c.user_id === p.id)?.n || 0 })),
      months, can_edit: gov.isAdmin(req),
    });
  });

  app.put(`${BASE}/costi`, async (req, res) => {
    adminOnly(req);
    const b = req.body || {};
    const s = await almaSettings();
    const monthly = Number(b.monthly_eur), daily = Number(b.daily_eur), pct = v.int(b.alert_pct, 'avviso', { min: 10, max: 100 }) ?? 80;
    if (!(monthly > 0 && monthly <= 100000)) throw new HttpError(400, 'Tetto mensile non valido');
    if (!(daily > 0 && daily <= 1000)) throw new HttpError(400, 'Tetto giornaliero non valido');
    const before = { mese: s.monthly_eur, giorno: s.daily_eur, avviso: Number(await getSetting(db, 'planet.ai_alert_pct', 80)) || 80 };
    const adminsUnlimited = b.admins_unlimited === undefined ? s.raw.admins_unlimited !== false : Boolean(b.admins_unlimited);
    await saveSetting(db, ALMA_SETTING, { ...s.raw, monthly_eur: r2(monthly), daily_eur: r2(daily), admins_unlimited: adminsUnlimited }, req.user.id);
    await saveSetting(db, 'planet.ai_alert_pct', pct, req.user.id);
    audit(req, 'Ha cambiato i tetti di spesa AI', 'Costi AI', { ...before, amministratori_senza_limite: s.raw.admins_unlimited !== false }, { mese: r2(monthly), giorno: r2(daily), avviso: pct, amministratori_senza_limite: adminsUnlimited });
    res.json({ ok: true });
  });
  // Quota di Alma al giorno per una persona (ALM2-62): { quota: euro | 'unlimited' | null (= come tutti) }.
  app.put(`${BASE}/costi/persona/:id`, async (req, res) => {
    adminOnly(req);
    const id = Number(req.params.id);
    const u = await one('SELECT id, name FROM users WHERE id = $1', [id]);
    if (!u) throw new HttpError(404, 'Persona non trovata');
    const value = QUOTA.parseOverride(req.body?.quota);
    if (value === undefined) throw new HttpError(400, 'Quota al giorno: un importo da 0,01 a 1000 €, oppure «senza limite».');
    const s = await almaSettings();
    const map = { ...((s.raw && s.raw.user_daily) || {}) };
    const before = map[String(id)] ?? 'come tutti';
    if (value === null) delete map[String(id)]; else map[String(id)] = value;
    await saveSetting(db, ALMA_SETTING, { ...s.raw, user_daily: map }, req.user.id);
    audit(req, `Ha cambiato la quota AI di ${u.name}`, 'Costi AI', { quota: before }, { quota: value ?? 'come tutti' });
    res.json({ ok: true, value });
  });

  // ── Privacy e visibilità ───────────────────────────────────────────────────────────────────────
  app.get(`${BASE}/privacy`, async (req, res) => {
    adminOnly(req);
    const exc = (await db.query(
      `SELECT e.id, e.email, e.area, e.level, e.until::text AS until, e.note, e.created_at, e.reviewed_at,
              c.name AS created_by_name, r.name AS reviewed_by_name, COALESCE(o.name, u.name, e.email) AS name, o.department
         FROM privacy_exceptions e LEFT JOIN users c ON c.id = e.created_by LEFT JOIN users r ON r.id = e.reviewed_by
         LEFT JOIN org_people o ON lower(o.email) = e.email LEFT JOIN users u ON lower(u.email) = e.email
        ORDER BY e.created_at DESC`)).rows;
    const st = gov.state;
    res.json({
      areas: AREAS, levels: LEVELS, admin_editable: [...ADMIN_EDITABLE],
      roles: st.roles.map(r => ({ key: r.key, label: r.label })),
      matrix: st.matrix,
      exceptions: exc.map(e => {
        const role = gov.roleOf(e.email).key;
        const due = new Date(e.reviewed_at || e.created_at).getTime() + 90 * 86400000 < Date.now();
        return { ...e, role_level: st.matrix[role]?.[e.area], expired: Boolean(e.until && e.until < romeDay()), review_due: due };
      }),
      directory: [...st.people.values()].map(p => ({ email: p.email })),
    });
  });

  app.put(`${BASE}/privacy`, async (req, res) => {
    adminOnly(req);
    const input = req.body?.matrix || {};
    const before = gov.state.matrix;
    const next = {};
    const changes = [];
    for (const r of gov.state.roles) {
      next[r.key] = { ...before[r.key] };
      for (const a of AREAS) {
        const val = input[r.key]?.[a.key];
        if (val === undefined || val === before[r.key]?.[a.key]) continue;
        if (a.fixed || (r.key === 'admin' && !ADMIN_EDITABLE.has(a.key))) throw new HttpError(400, `«${a.label}» per ${r.label} non si cambia`);
        if (!a.levels.includes(val)) throw new HttpError(400, `Livello non valido per «${a.label}»`);
        changes.push(`${r.label} · ${a.label}: ${LEVELS[before[r.key][a.key]]} → ${LEVELS[val]}`);
        next[r.key][a.key] = val;
      }
    }
    await saveSetting(db, 'planet.privacy', next, req.user.id);
    await gov.reload();
    audit(req, changes.length === 1 ? 'Ha cambiato un permesso' : `Ha cambiato ${changes.length} permessi`, 'Privacy e visibilità',
      changes.map(c => c.split(': ')[0] + ': ' + c.split(': ')[1].split(' → ')[0]), changes.map(c => c.split(': ')[0] + ': ' + c.split(' → ')[1]));
    res.json({ ok: true, changes: changes.length });
  });

  app.post(`${BASE}/privacy/eccezioni`, async (req, res) => {
    adminOnly(req);
    const b = req.body || {};
    const email = norm(v.text(b.email, 'persona', { max: 300, required: true }));
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, 'Persona non valida');
    const area = AREAS.find(a => a.key === b.area);
    if (!area || area.fixed) throw new HttpError(400, 'Area non valida');
    const level = v.oneOf(b.level, 'livello', area.levels);
    const until = b.until ? v.date(b.until, 'scadenza') : null;
    const note = v.text(b.note, 'nota', { max: 300 }) || null;
    await db.query(`INSERT INTO privacy_exceptions (email, area, level, until, note, created_by) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (email, area) DO UPDATE SET level = EXCLUDED.level, until = EXCLUDED.until, note = EXCLUDED.note,
                      created_by = EXCLUDED.created_by, created_at = now(), reviewed_at = NULL, reviewed_by = NULL`, [email, area.key, level, until, note, req.user.id]);
    audit(req, 'Ha dato un\'eccezione di privacy', email, { [area.label]: LEVELS[gov.levelsFor(email)[area.key]] }, { [area.label]: LEVELS[level], fino_al: until || 'senza scadenza' });
    await gov.reload();
    res.status(201).json({ ok: true });
  });

  app.post(`${BASE}/privacy/eccezioni/:id/conferma`, async (req, res) => {
    adminOnly(req);
    const id = v.int(req.params.id, 'eccezione', { min: 1 });
    const e = await one('UPDATE privacy_exceptions SET reviewed_at = now(), reviewed_by = $2 WHERE id = $1 RETURNING email, area', [id, req.user.id]);
    if (!e) throw new HttpError(404, 'Eccezione non trovata');
    audit(req, 'Ha riconfermato un\'eccezione di privacy', `${e.email} · ${AREAS.find(a => a.key === e.area)?.label || e.area}`);
    res.json({ ok: true });
  });

  app.delete(`${BASE}/privacy/eccezioni/:id`, async (req, res) => {
    adminOnly(req);
    const id = v.int(req.params.id, 'eccezione', { min: 1 });
    const e = await one('DELETE FROM privacy_exceptions WHERE id = $1 RETURNING email, area, level', [id]);
    if (!e) throw new HttpError(404, 'Eccezione non trovata');
    const area = AREAS.find(a => a.key === e.area);
    audit(req, 'Ha tolto un\'eccezione di privacy', e.email, { [area?.label || e.area]: LEVELS[e.level] }, null);
    await gov.reload();
    res.json({ ok: true });
  });

  // «Prova come…»: cosa vede una persona (ruolo + eccezioni)
  app.get(`${BASE}/privacy/prova`, async (req, res) => {
    adminOnly(req);
    const email = norm(v.text(req.query.email, 'persona', { max: 300, required: true }));
    const role = gov.isAdminEmail(email) ? { key: 'admin', source: gov.envAdmins.has(email) ? 'env' : gov.roleOf(email).source } : gov.roleOf(email);
    res.json({ email, role, role_label: gov.state.roles.find(r => r.key === role.key)?.label, levels: gov.levelsFor(email) });
  });

  // ── Registro accessi e azioni ──────────────────────────────────────────────────────────────────
  function registroQuery(q) {
    const where = [];
    const p = [];
    const add = (sql, val) => { p.push(val); where.push(sql.replace('?', `$${p.length}`)); };
    const kind = String(q.tipo || '');
    if (kind === 'accessi') add('a.action = ANY(?::text[])', ACCESS_ACTIONS);
    else if (kind === 'impostazioni') where.push("a.action LIKE '% /api/impostazioni%'");
    else if (kind === 'modifiche') where.push("a.action ~ '^(POST|PUT|PATCH|DELETE) /api/' AND a.action NOT LIKE '% /api/impostazioni%'");
    else if (kind === 'rifiutati') where.push("(a.action = 'login_refused' OR a.status >= 400)");
    const user = v.int(q.persona, 'persona', { min: 1 });
    if (user) add('a.user_id = ?', user);
    const days = v.int(q.giorni, 'giorni', { min: 1, max: 730 }) || 7;
    add("a.created_at >= now() - make_interval(days => ?)", days);
    const mod = String(q.modulo || '');
    const segs = Object.entries(MODULES).filter(([, label]) => label === mod).map(([k]) => k);
    if (mod === 'Accesso') add('a.action = ANY(?::text[])', ACCESS_ACTIONS);
    else if (segs.length) add("substring(a.action from '^[A-Z]+ /api/([a-z0-9-]+)') = ANY(?::text[])", segs);
    return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', p };
  }

  app.get(`${BASE}/registro`, async (req, res) => {
    adminOnly(req);
    const { where, p } = registroQuery(req.query);
    const before = v.int(req.query.prima, 'da', { min: 1 });
    const limit = 100;
    const cond = before ? `${where ? `${where} AND` : 'WHERE'} a.id < ${Number(before)}` : where;
    const [rows, total] = await Promise.all([
      db.query(`SELECT a.id, a.created_at, a.action, a.status, a.ip, a.user_id, a.detail, u.name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
                 ${cond} ORDER BY a.id DESC LIMIT ${limit + 1}`, p),
      one(`SELECT COUNT(*)::int AS n FROM audit_log a ${where}`, p),
    ]);
    const list = rows.rows.slice(0, limit).map(r => ({ ...r, ...describe(r) }));
    const people = (await db.query('SELECT id, name FROM users WHERE last_login IS NOT NULL ORDER BY name')).rows;
    res.json({ rows: list, total: total.n, more: rows.rows.length > limit, people, modules: [...new Set(['Accesso', ...Object.values(MODULES)])].sort() });
  });

  app.get(`${BASE}/registro.csv`, async (req, res) => {
    adminOnly(req);
    const { where, p } = registroQuery(req.query);
    const { rows } = await db.query(`SELECT a.created_at, a.action, a.status, a.ip, a.detail, u.name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${where} ORDER BY a.id DESC LIMIT 20000`, p);
    const cell = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const lines = [['Quando', 'Chi', 'Azione', 'Su cosa', 'Modulo', 'Esito', 'IP', 'Prima', 'Dopo'].map(cell).join(';')];
    for (const r of rows) {
      const d = describe(r);
      lines.push([new Date(r.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }), r.name || (r.action === 'login_refused' ? 'sconosciuto' : 'Sistema'), d.what, d.target, d.module,
        r.status ?? '', r.ip ?? '', r.detail?.before ? JSON.stringify(r.detail.before) : '', r.detail?.after ? JSON.stringify(r.detail.after) : ''].map(cell).join(';'));
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="registro-alma-planet-${romeDay()}.csv"`);
    res.send(`﻿${lines.join('\r\n')}`);
  });

  // ── Integrazioni ───────────────────────────────────────────────────────────────────────────────
  app.get(`${BASE}/integrazioni`, async (req, res) => {
    adminOnly(req);
    const [sync, tokens, lastLogin, radar, expires] = await Promise.all([
      one('SELECT synced_at, people FROM org_sync WHERE id = 1'),
      one('SELECT COUNT(*)::int AS n FROM users WHERE token_cache IS NOT NULL'),
      one("SELECT MAX(created_at) AS at FROM audit_log WHERE action = 'login'"),
      one('SELECT MAX(at) AS at FROM crm_radar_runs').catch(() => ({ at: null })),
      getSetting(db, 'planet.ms_secret_expires', '2028-10'),
    ]);
    res.json({
      microsoft: {
        configured: Boolean(auth.msConfigured), tenant_id: config?.tenantId || null,
        org: sync || null, users_with_tokens: tokens.n, last_login: lastLogin.at,
        secret_expires: expires, token_key: Boolean(config?.tokenKey),
      },
      openai: Boolean(config?.openaiKey),
      radar_last_run: radar?.at || null,
    });
  });

  app.post(`${BASE}/integrazioni/microsoft/prova`, async (req, res) => {
    adminOnly(req);
    const t0 = Date.now();
    const token = await auth.graphToken(req.user.id);
    const org = await graph(token, 'GET', '/organization?$select=displayName,verifiedDomains');
    const o = org.value?.[0] || {};
    res.json({ ok: true, ms: Date.now() - t0, name: o.displayName || null, domain: (o.verifiedDomains || []).find(d => d.isDefault)?.name || null });
  });
}

// Organigramma ogni notte alle 3 (ora italiana), con il token Microsoft di chi l'ha aggiornato l'ultima volta o di
// un amministratore che è entrato di recente. Se nessun token funziona si riprova la notte dopo.
function startOrgNightly({ db, auth, gov, notifier = null }) {
  let running = false;
  const tick = async () => {
    const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }));
    if (hour !== 3 || running || !auth.msConfigured) return;
    const last = (await db.query('SELECT synced_at, synced_by FROM org_sync WHERE id = 1')).rows[0];
    if (last && Date.now() - new Date(last.synced_at).getTime() < 20 * 3600 * 1000) return;
    running = true;
    try {
      const users = (await db.query("SELECT id, email FROM users WHERE token_cache IS NOT NULL AND suspended_at IS NULL ORDER BY last_login DESC NULLS LAST LIMIT 50")).rows;
      const candidates = [last?.synced_by, ...users.filter(u => gov.isAdminEmail(u.email)).map(u => u.id)].filter(Boolean);
      for (const actorId of [...new Set(candidates)]) {
        try {
          const r = await syncOrg({ db, auth, notifier, gov, actorId });
          console.log(`[organigramma] aggiornato di notte: ${r.people} persone, ${r.new_people} nuove`);
          return;
        } catch (err) {
          console.warn(`[organigramma] giro notturno con l'utente ${actorId} non riuscito: ${err.message}`);
        }
      }
    } finally {
      running = false;
    }
  };
  const t = setInterval(() => tick().catch(err => console.warn('[organigramma] giro notturno', err.message)), 10 * 60 * 1000);
  t.unref?.();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { registerImpostazioni, startOrgNightly, featureOf, describe };
