// Alma HR, Fase 4: onboarding (ALM2-54; canvas «Alma HR», pagina «Fase 4 · onboarding», tavole AA–AG).
//   /api/hr/onboarding[...]          piano della persona (AA), cruscotto con l'ambito (AG), avvio, compiti, obiettivi, buddy
//   /api/hr/inserimento/mio          «Il mio inserimento» del nuovo assunto (AB): compiti, buddy, documenti, pulse
//   /api/hr/onboarding/:id/incontri  incontri 30/60/90 con voto 1–10 e pulse 1–5 (AD)
//   /api/hr/onboarding/:id/prova     fine del periodo di prova: responsabile + visto HR, Direzione da G6 (AE)
//   /api/hr/formazione[...]          catalogo, corsi per ruolo, attestati e scadenze (AC) — HR e QHSE
//   /api/hr/onboarding-modelli · /api/hr/documenti   modelli per ruolo con versioni e documenti da leggere (AF)
// Persone, incarichi e contratti restano su BOSS: Alma legge e ricorda, la decisione di fine prova va al consulente.
const express = require('express');
const { HttpError, v } = require('../lib/http');
const H = require('../lib/hr');
const O = require('../lib/hr-onb');

const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const hrMod = () => require('./hr');
const MAX_FILE = 8 * 1024 * 1024;
const readFile = (f, what = 'file') => {
  if (!f || !f.base64) return null;
  const mime = String(f.mime || '').toLowerCase();
  if (!/^(application\/pdf|image\/(png|jpeg)|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/.test(mime)) throw new HttpError(400, `Il ${what} deve essere PDF, Word o immagine`);
  const data = Buffer.from(String(f.base64), 'base64');
  if (!data.length || data.length > MAX_FILE) throw new HttpError(400, `Il ${what} supera 8 MB o è vuoto`);
  return { nome: String(f.nome || 'file').slice(0, 200), mime, data };
};

// ── dati di partenza: modelli e catalogo della formazione (una volta sola) ──
async function ensureOnbSeed(db) {
  const { rows: [t] } = await db.query('SELECT count(*)::int AS n FROM hr_onb_templates');
  if (!t.n) for (const m of O.DEFAULT_TEMPLATES) await db.query('INSERT INTO hr_onb_templates (chiave, nome, items) VALUES ($1, $2, $3)', [m.chiave, m.nome, JSON.stringify(m.items)]);
  const { rows: [c] } = await db.query('SELECT count(*)::int AS n FROM hr_courses');
  if (!c.n) {
    const ids = {};
    for (const [i, k] of O.DEFAULT_COURSES.entries()) {
      const { rows: [r] } = await db.query('INSERT INTO hr_courses (nome, ore, validita_mesi, blocca_cantiere, giorno, ordine) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [k.nome, k.ore, k.validita_mesi, k.blocca_cantiere, k.giorno, i + 1]);
      ids[k.k] = r.id;
    }
    await hrMod().ensureSeed(db);
    const { rows: roles } = await db.query('SELECT id, hr_family, hr_name, grade FROM pm_roles WHERE hr_family IS NOT NULL');
    for (const r of roles) for (const k of O.defaultCoursesFor(r)) await db.query('INSERT INTO hr_role_courses (role_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [r.id, ids[k]]);
  }
}
const latestTemplates = async db => (await db.query('SELECT DISTINCT ON (chiave) * FROM hr_onb_templates ORDER BY chiave, version DESC')).rows;

// ── avvio di un inserimento (dal pre-boarding arrivato, o dal team HR) ──
async function createOnboarding(db, { personKey, inizio, sede, preboardingId = null, provaMesi = null, by = null, notifier = null }) {
  await ensureOnbSeed(db);
  const { rows: [p] } = await db.query('SELECT key, nome, cognome, lower(email) AS email, data_assunzione::text AS data_assunzione, role_id FROM hr_people WHERE key = $1', [personKey]);
  if (!p) throw new HttpError(404, 'Persona non trovata tra quelle di BOSS');
  const { rows: [dup] } = await db.query("SELECT id FROM hr_onboardings WHERE person_key = $1 AND stato = 'aperto'", [personKey]);
  if (dup) return dup.id;
  const start = inizio || p.data_assunzione || todayIso();
  const { rows: [inc] } = p.email ? await db.query(`SELECT i.id, r.role_id, lower(s.ricoperto_da) AS resp FROM org_incarichi i LEFT JOIN hr_incarico_roles r ON r.incarico_id = i.id
    LEFT JOIN org_incarichi s ON s.id = i.riporta_a_id WHERE i.attivo AND lower(i.ricoperto_da) = $1 ORDER BY r.role_id IS NULL, i.id LIMIT 1`, [p.email]) : { rows: [] };
  const roleId = inc?.role_id || p.role_id || null;
  const { rows: [role] } = roleId ? await db.query('SELECT * FROM pm_roles WHERE id = $1', [roleId]) : { rows: [] };
  const where = sede || O.sedeFor(role);
  const tpl = await latestTemplates(db);
  const keys = O.templateKeys(role, where);
  const used = tpl.filter(t => keys.includes(t.chiave));
  // corsi del ruolo, tranne quelli che la persona ha già validi
  const { rows: courses } = roleId ? await db.query(`SELECT c.* FROM hr_role_courses rc JOIN hr_courses c ON c.id = rc.course_id WHERE rc.role_id = $1 AND c.attivo ORDER BY c.ordine`, [roleId]) : { rows: [] };
  const { rows: certs } = await db.query('SELECT DISTINCT ON (course_id) course_id, scade::text AS scade FROM hr_certificates WHERE person_key = $1 ORDER BY course_id, data DESC', [personKey]);
  const valid = new Set(certs.filter(c => !c.scade || c.scade >= todayIso()).map(c => c.course_id));
  const { rows: docs } = await db.query('SELECT id, titolo FROM hr_documents WHERE attivo ORDER BY ordine, id');
  const docList = [...(role ? [{ titolo: `mansionario ${H.roleTitle(role)}` }] : []), ...docs];
  const fine = O.fineProva(start, provaMesi || O.PROVA_MESI);
  const plan = O.composePlan({ templates: used, courses: courses.filter(c => !valid.has(c.id)), docs: docList, fineProvaGiorno: O.daysBetween(start, fine) });
  return db.tx(async q => {
    const { rows: [o] } = await q.query(`INSERT INTO hr_onboardings (person_key, email, nome, incarico_id, role_id, inizio, sede, resp_email, fine_prova, prova_fonte, preboarding_id, modelli)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [p.key, p.email, `${p.nome} ${p.cognome || ''}`.trim(), inc?.id || null, roleId, start, where, inc?.resp || null, fine, provaMesi ? 'offerta' : 'ccnl', preboardingId,
        JSON.stringify(Object.fromEntries(used.map(t => [t.chiave, t.version])))]);
    for (const t of plan) await q.query('INSERT INTO hr_onb_tasks (onb_id, ordine, giorno, titolo, chi, tipo, ref) VALUES ($1,$2,$3,$4,$5,$6,$7)', [o.id, t.ordine, t.giorno, t.titolo, t.chi, t.tipo, t.ref]);
    for (const [i, g] of O.goalsFor(role).entries()) await q.query('INSERT INTO hr_onb_goals (onb_id, ordine, titolo) VALUES ($1, $2, $3)', [o.id, i + 1, g]);
    for (const tp of O.TAPPE) await q.query('INSERT INTO hr_onb_meetings (onb_id, tappa) VALUES ($1, $2)', [o.id, tp]);
    await q.query('INSERT INTO hr_probation (onb_id) VALUES ($1)', [o.id]);
    await q.query("INSERT INTO hr_log (user_id, kind, action, person_key) VALUES ($1, 'modifica', 'inserimento avviato', $2)", [by, p.key]);
    return o.id;
  }).then(async id => {
    if (notifier) {
      const { rows: us } = await db.query('SELECT id, lower(email) AS email FROM users WHERE lower(email) = ANY($1)', [[p.email, inc?.resp].filter(Boolean)]);
      const resp = us.find(u => u.email === inc?.resp);
      const me = us.find(u => u.email === p.email);
      if (resp) await notifier.notify({ userIds: [resp.id], actorId: by, kind: 'hr', body: `è partito l'inserimento di ${p.nome}: scegli il buddy e scrivi gli obiettivi.`, link: `/hr/onboarding/${id}` }).catch(() => {});
      if (me) await notifier.notify({ userIds: [me.id], actorId: by, kind: 'hr', body: 'benvenuto in Almacis! Il tuo inserimento è in «Il mio inserimento».', link: '/hr/inserimento' }).catch(() => {});
    }
    return id;
  });
}

function registerHrOnb(app, { db, gov, notifier, auth }) {
  const roleKey = req => gov.roleOf(req.user.email).key;
  const isHr = req => roleKey(req) === 'hr';
  const isQhse = req => roleKey(req) === 'qhse';
  const me = req => req.user.email.toLowerCase();
  const hrOnly = req => { if (!isHr(req)) throw new HttpError(403, 'Riservato al team HR'); };
  const hrOrQhse = req => { if (!isHr(req) && !isQhse(req)) throw new HttpError(403, 'Riservato al team HR e a QHSE'); };
  const usersByRole = async key => {
    const { rows } = await db.query('SELECT id, lower(email) AS email FROM users WHERE email IS NOT NULL AND suspended_at IS NULL');
    return rows.filter(u => gov.roleOf(u.email).key === key).map(u => u.id);
  };
  const userIdsByEmail = async emails => (await db.query('SELECT id FROM users WHERE lower(email) = ANY($1)', [emails.filter(Boolean).map(e => e.toLowerCase())])).rows.map(r => r.id);
  const notify = (ids, actor, body, link) => (ids.length ? notifier?.notify({ userIds: [...new Set(ids)], actorId: actor, kind: 'hr', body, link }).catch(() => {}) : null);
  const hrLog = (req, action, person) => db.query("INSERT INTO hr_log (user_id, kind, action, person_key) VALUES ($1, 'modifica', $2, $3)", [req.user.id, action, person || null]);

  async function onbRow(id) {
    const { rows: [o] } = await db.query(`SELECT o.*, o.inizio::text AS inizio, o.fine_prova::text AS fine_prova, r.title AS role_title, r.hr_name, r.hr_level, r.hr_family, r.grade, r.autonomy, r.version AS role_version,
        i.nome AS incarico, a.id AS area_id, a.nome AS area, a.tipo AS area_tipo, hp.boss_url
      FROM hr_onboardings o LEFT JOIN pm_roles r ON r.id = o.role_id LEFT JOIN org_incarichi i ON i.id = o.incarico_id LEFT JOIN org_aree a ON a.id = i.area_id
      LEFT JOIN hr_people hp ON hp.key = o.person_key WHERE o.id = $1`, [id]);
    if (!o) throw new HttpError(404, 'Inserimento non trovato');
    return o;
  }
  function accessOf(req, o) {
    if (isHr(req)) return 'hr';
    const e = me(req);
    if (o.email && e === o.email) return 'nuovo';
    if (o.resp_email && e === o.resp_email) return 'responsabile';
    if (o.buddy_email && e === o.buddy_email) return 'buddy';
    if (isQhse(req)) return 'qhse';
    if (roleKey(req) === 'direzione' && Number(o.grade) >= 6) return 'direzione';
    return null;
  }
  const mustSee = (req, o) => { const a = accessOf(req, o); if (!a) throw new HttpError(403, 'Non puoi vedere questo inserimento'); return a; };
  const dueOf = (o, t) => O.addDays(o.inizio, t.giorno);
  const roleTitle = o => (o.hr_name ? `${o.hr_name}${o.hr_level ? ` ${o.hr_level}` : ''}` : o.role_title || '');

  // stato della formazione di una persona per i corsi del suo ruolo
  async function trainingOf(personKey, roleId) {
    const { rows: courses } = roleId ? await db.query('SELECT c.* FROM hr_role_courses rc JOIN hr_courses c ON c.id = rc.course_id WHERE rc.role_id = $1 AND c.attivo ORDER BY c.ordine', [roleId]) : { rows: [] };
    const { rows: certs } = await db.query('SELECT DISTINCT ON (course_id) id, course_id, data::text AS data, scade::text AS scade, ente FROM hr_certificates WHERE person_key = $1 ORDER BY course_id, data DESC', [personKey]);
    const by = new Map(certs.map(c => [c.course_id, c]));
    const st = courses.map(c => ({ course: c, cert_id: by.get(c.id)?.id || null, ...O.certStatus(by.get(c.id), c, todayIso()) }));
    return { corsi: st, cantiere: O.siteStatus(st) };
  }
  async function people(o) {
    const emails = [o.resp_email, o.buddy_email].filter(Boolean);
    const { rows } = emails.length ? await db.query('SELECT lower(email) AS email, name FROM users WHERE lower(email) = ANY($1)', [emails]) : { rows: [] };
    const { rows: hp } = emails.length ? await db.query('SELECT email, nome, cognome, qualifica FROM hr_people WHERE email = ANY($1)', [emails]) : { rows: [] };
    const name = e => rows.find(r => r.email === e)?.name || (hp.find(x => x.email === e) ? `${hp.find(x => x.email === e).nome} ${hp.find(x => x.email === e).cognome}` : e);
    return { responsabile: o.resp_email ? { email: o.resp_email, nome: name(o.resp_email) } : null, buddy: o.buddy_email ? { email: o.buddy_email, nome: name(o.buddy_email), qualifica: hp.find(x => x.email === o.buddy_email)?.qualifica || '' } : null };
  }
  async function docsOf(o) {
    const { rows: docs } = await db.query('SELECT id, titolo, url, version, (file IS NOT NULL) AS has_file FROM hr_documents WHERE attivo ORDER BY ordine, id');
    const { rows: reads } = await db.query('SELECT doc_key, version, read_at FROM hr_doc_reads WHERE onb_id = $1', [o.id]);
    const r = new Map(reads.map(x => [x.doc_key, x]));
    const list = [];
    if (o.role_id) list.push({ key: `mansionario:${o.role_id}`, titolo: `Mansionario · ${roleTitle(o)} · v${o.role_version || 1}`, link: `#/hr/mansionario?ruolo=${o.role_id}`, version: o.role_version || 1 });
    for (const d of docs) list.push({ key: `doc:${d.id}`, titolo: d.titolo, link: d.has_file ? `/api/hr/documenti/${d.id}/file` : d.url, version: d.version });
    return list.map(d => ({ ...d, letto: r.get(d.key) && r.get(d.key).version >= d.version ? r.get(d.key).read_at : null }));
  }

  // ── cruscotto e avvio (AG) ──
  app.get('/api/hr/onboarding', async (req, res) => {
    await ensureOnbSeed(db);
    const hr = isHr(req);
    const ambito = hrMod().ambitoOf(req);
    const { rows } = await db.query(`SELECT o.id, o.person_key, o.nome, o.email, o.inizio::text AS inizio, o.fine_prova::text AS fine_prova, o.stato, o.sede, o.resp_email, o.buddy_email, o.role_id,
        r.hr_name, r.hr_level, r.title AS role_title, r.grade, a.id AS area_id, a.nome AS area, a.tipo AS area_tipo,
        (SELECT count(*)::int FROM hr_onb_tasks t WHERE t.onb_id = o.id) AS compiti, (SELECT count(*)::int FROM hr_onb_tasks t WHERE t.onb_id = o.id AND t.fatto) AS fatti,
        (SELECT count(*)::int FROM hr_onb_tasks t WHERE t.onb_id = o.id AND NOT t.fatto AND o.inizio + t.giorno < current_date) AS ritardo,
        (SELECT json_agg(json_build_object('tappa', m.tappa, 'fatto', m.fatto_at IS NOT NULL, 'quando', m.quando) ORDER BY m.tappa) FROM hr_onb_meetings m WHERE m.onb_id = o.id) AS incontri,
        (SELECT row_to_json(p) FROM (SELECT q1, q2, q3 FROM hr_onb_pulse WHERE onb_id = o.id ORDER BY tappa DESC LIMIT 1) p) AS pulse,
        (SELECT row_to_json(x) FROM (SELECT decisione, hr_at, dir_at FROM hr_probation WHERE onb_id = o.id) x) AS prova
      FROM hr_onboardings o LEFT JOIN pm_roles r ON r.id = o.role_id LEFT JOIN org_incarichi i ON i.id = o.incarico_id LEFT JOIN org_aree a ON a.id = i.area_id
      ORDER BY o.stato = 'aperto' DESC, o.inizio DESC`);
    const e = me(req);
    const mine = rows.filter(o => hr || o.resp_email === e || o.buddy_email === e);
    const scoped = hr ? mine.filter(o => !ambito || hrMod().inScope({ id: o.area_id, tipo: o.area_tipo }, ambito)) : mine;
    const out = [];
    for (const o of scoped) {
      const tr = o.stato === 'aperto' && o.role_id ? await trainingOf(o.person_key, o.role_id) : null;
      out.push({ ...o, ruolo: o.hr_name ? `${o.hr_name}${o.hr_level ? ` ${o.hr_level}` : ''}` : o.role_title, giorno: O.daysBetween(o.inizio, todayIso()) + 1,
        formazione: tr ? { fatti: tr.corsi.filter(c => c.stato === 'ok' || c.stato === 'scade').length, totale: tr.corsi.length, scaduti: tr.corsi.filter(c => c.stato === 'scaduto' || (c.stato === 'manca' && O.addDays(o.inizio, c.course.giorno) < todayIso())).length, cantiere: tr.cantiere.ok } : null,
        pulse_media: O.pulseAvg(o.pulse) });
    }
    let extra = {};
    if (hr) {
      const aperti = out.filter(o => o.stato === 'aperto');
      const { rows: late } = await db.query(`SELECT t.titolo, count(*)::int AS n FROM hr_onb_tasks t JOIN hr_onboardings o ON o.id = t.onb_id
        WHERE o.inizio > current_date - 365 AND ((t.fatto AND t.fatto_at::date > o.inizio + t.giorno) OR (NOT t.fatto AND o.inizio + t.giorno < current_date)) GROUP BY 1 ORDER BY 2 DESC LIMIT 5`);
      const { rows: esiti } = await db.query(`SELECT p.decisione, o.stato, (SELECT bool_or(h.attivo) FROM hr_people h WHERE h.key = o.person_key) AS attivo, o.inizio::text AS inizio
        FROM hr_onboardings o LEFT JOIN hr_probation p ON p.onb_id = o.id WHERE o.inizio > current_date - 365`);
      const pulses = aperti.filter(o => o.pulse);
      const avgQ = k => (pulses.length ? Math.round(pulses.reduce((s, o) => s + o.pulse[k], 0) / pulses.length * 10) / 10 : null);
      extra = {
        kpi: { aperti: aperti.length, cantiere: aperti.filter(o => o.sede === 'cantiere').length, ritardo: aperti.reduce((s, o) => s + o.ritardo, 0),
          pulse: pulses.length ? Math.round(pulses.reduce((s, o) => s + O.pulseAvg(o.pulse), 0) / pulses.length * 10) / 10 : null,
          pulse_q: { strumenti: avgQ('q1'), aspettative: avgQ('q2'), accoglienza: avgQ('q3') },
          prove: aperti.filter(o => o.fine_prova && O.daysBetween(todayIso(), o.fine_prova) <= 30).length,
          prove_senza: aperti.filter(o => o.fine_prova && O.daysBetween(todayIso(), o.fine_prova) <= 30 && !o.prova?.decisione).length },
        inceppa: late,
        esiti: { superata: esiti.filter(x => x.decisione === 'conferma').length, non_superata: esiti.filter(x => x.decisione === 'non_superata').length,
          uscite: esiti.filter(x => !x.decisione && x.attivo === false).length },
      };
    }
    res.json({ onboarding: out, is_hr: hr, ...extra });
  });

  // persone entrate da poco senza inserimento (per l'avvio a mano)
  app.get('/api/hr/onboarding/da-avviare', async (req, res) => {
    hrOnly(req);
    const { rows } = await db.query(`SELECT h.key, h.nome, h.cognome, h.data_assunzione::text AS data_assunzione, h.qualifica FROM hr_people h
      WHERE h.attivo AND h.esclusione IS NULL AND h.data_assunzione >= current_date - 120 AND NOT EXISTS (SELECT 1 FROM hr_onboardings o WHERE o.person_key = h.key) ORDER BY h.data_assunzione DESC`);
    res.json({ persone: rows });
  });
  app.post('/api/hr/onboarding', async (req, res) => {
    hrOnly(req);
    const personKey = v.text(req.body.person_key, 'persona', { max: 200, required: true });
    const id = await createOnboarding(db, { personKey, inizio: v.date(req.body.inizio, 'primo giorno') || null, sede: v.oneOf(req.body.sede, 'sede', ['ufficio', 'cantiere']),
      provaMesi: v.int(req.body.prova_mesi, 'mesi di prova', { min: 0, max: 12, nullable: true }) || null, by: req.user.id, notifier });
    res.json({ id });
  });

  // ── piano della persona (AA) ──
  app.get('/api/hr/onboarding/:id', async (req, res) => {
    const o = await onbRow(v.int(req.params.id, 'id', { min: 1 }));
    const acc = mustSee(req, o);
    const today = todayIso();
    const { rows: tasks } = await db.query('SELECT * FROM hr_onb_tasks WHERE onb_id = $1 ORDER BY ordine', [o.id]);
    const { rows: goals } = await db.query('SELECT * FROM hr_onb_goals WHERE onb_id = $1 ORDER BY ordine', [o.id]);
    const { rows: meetings } = await db.query('SELECT id, tappa, quando, join_url, voto_obiettivi, voto_squadra, fatto_at FROM hr_onb_meetings WHERE onb_id = $1 ORDER BY tappa', [o.id]);
    const { rows: pulse } = ['hr', 'responsabile', 'nuovo'].includes(acc) ? await db.query('SELECT * FROM hr_onb_pulse WHERE onb_id = $1 ORDER BY tappa', [o.id]) : { rows: [] };
    const { rows: [prova] } = await db.query('SELECT * FROM hr_probation WHERE onb_id = $1', [o.id]);
    const tr = await trainingOf(o.person_key, o.role_id);
    const ppl = await people(o);
    const docs = await docsOf(o);
    const tk = tasks.map(t => ({ ...t, scadenza: dueOf(o, t), in_ritardo: !t.fatto && dueOf(o, t) < today, fase: O.phaseOf(t.giorno), chi_label: O.CHI[t.chi] || t.chi, posso: canTick(acc, t) }));
    // prossimi passi
    const passi = [];
    for (const c of tr.corsi.filter(c => c.course.blocca_cantiere && (c.stato === 'scaduto' || (c.stato === 'manca' && O.addDays(o.inizio, c.course.giorno) < today)))) passi.push({ livello: 'alto', testo: `${c.course.nome} ${c.stato === 'scaduto' ? 'scaduto' : 'non fatto nei tempi'}`, nota: 'senza, non può entrare in cantiere da solo' });
    for (const t of tk.filter(x => x.in_ritardo && x.tipo !== 'corso').slice(0, 4)) passi.push({ livello: 'medio', testo: `${t.titolo}`, nota: `in ritardo dal ${t.scadenza.split('-').reverse().join('/')} · ${t.chi_label}` });
    const next = meetings.find(m => !m.fatto_at);
    if (next) passi.push({ livello: 'info', testo: `Incontro dei ${next.tappa} giorni`, nota: next.quando ? `fissato il ${new Date(next.quando).toLocaleDateString('it-IT')}` : `entro il ${O.addDays(o.inizio, next.tappa).split('-').reverse().join('/')}, invito da mandare` });
    const seeProva = ['hr', 'responsabile', 'direzione'].includes(acc);
    const { rows: [offerta] } = acc === 'hr' && o.preboarding_id ? await db.query('SELECT f.ral, f.motivo, f.benefit FROM hr_preboarding p JOIN hr_offers f ON f.app_id = p.app_id WHERE p.id = $1 ORDER BY f.id DESC LIMIT 1', [o.preboarding_id]) : { rows: [] };
    res.json({
      accesso: acc, today,
      onboarding: { id: o.id, nome: o.nome, email: acc === 'qhse' ? undefined : o.email, inizio: o.inizio, giorno: O.daysBetween(o.inizio, today) + 1, sede: o.sede, stato: o.stato, ruolo: roleTitle(o), grade: o.grade,
        area: o.area, incarico: o.incarico, boss_url: o.boss_url, fine_prova: o.fine_prova, prova_fonte: o.prova_fonte, modelli: o.modelli, person_key: o.person_key },
      persone: ppl, compiti: tk, fasi: O.PHASES, obiettivi: acc === 'qhse' ? [] : goals, documenti: docs, formazione: tr,
      incontri: ['hr', 'responsabile', 'nuovo'].includes(acc) ? meetings : meetings.map(m => ({ id: m.id, tappa: m.tappa, quando: m.quando, fatto_at: m.fatto_at })),
      pulse, passi,
      prova: seeProva ? { ...prova, revisione_ral: acc === 'hr' ? prova.revisione_ral : undefined, catena: O.probationChain(o.grade), offerta: offerta || null } : null,
    });
  });
  function canTick(acc, t) {
    if (acc === 'hr') return true;
    if (acc === 'responsabile') return ['responsabile', 'buddy'].includes(t.chi) && !['incontro', 'prova', 'obiettivi'].includes(t.tipo);
    if (acc === 'buddy') return t.chi === 'buddy';
    if (acc === 'nuovo') return t.chi === 'nuovo' && t.tipo === 'compito';
    if (acc === 'qhse') return t.chi === 'qhse';
    return false;
  }
  app.patch('/api/hr/onboarding/:id', async (req, res) => {
    const o = await onbRow(v.int(req.params.id, 'id', { min: 1 }));
    const acc = mustSee(req, o);
    const b = req.body || {};
    if (b.buddy_email !== undefined) {
      if (!['hr', 'responsabile'].includes(acc)) throw new HttpError(403, 'Il buddy lo sceglie il responsabile');
      const email = (v.text(b.buddy_email, 'buddy', { max: 200 }) || '').toLowerCase() || null;
      if (email && email === o.email) throw new HttpError(400, 'Il buddy non può essere la persona stessa');
      await db.query('UPDATE hr_onboardings SET buddy_email = $1 WHERE id = $2', [email, o.id]);
      if (email) await notify(await userIdsByEmail([email]), req.user.id, `ti ha scelto come buddy di ${o.nome} per l'inserimento.`, `/hr/onboarding/${o.id}`);
    }
    if (acc === 'hr') {
      const sede = v.oneOf(b.sede, 'sede', ['ufficio', 'cantiere']);
      const inizio = v.date(b.inizio, 'primo giorno');
      const fine = v.date(b.fine_prova, 'fine prova');
      const stato = v.oneOf(b.stato, 'stato', ['aperto', 'chiuso', 'annullato']);
      if (sede) await db.query('UPDATE hr_onboardings SET sede = $1 WHERE id = $2', [sede, o.id]);
      if (inizio) {
        // le scadenze del piano sono relative al primo giorno: si spostano da sole; la fine prova si sposta con lui (se non l'ha scritta HR)
        await db.query('UPDATE hr_onboardings SET inizio = $1 WHERE id = $2', [inizio, o.id]);
        if (!fine && o.fine_prova && o.prova_fonte !== 'hr') await db.query('UPDATE hr_onboardings SET fine_prova = $1 WHERE id = $2', [O.addDays(o.fine_prova, O.daysBetween(o.inizio, inizio)), o.id]);
      }
      if (fine) await db.query("UPDATE hr_onboardings SET fine_prova = $1, prova_fonte = 'hr' WHERE id = $2", [fine, o.id]);
      if (stato) await db.query("UPDATE hr_onboardings SET stato = $1, closed_at = CASE WHEN $1 = 'aperto' THEN NULL ELSE now() END WHERE id = $2", [stato, o.id]);
      if (sede || inizio || fine || stato) await hrLog(req, 'inserimento modificato', o.person_key);
    } else if (['sede', 'inizio', 'fine_prova', 'stato'].some(k => b[k] !== undefined)) throw new HttpError(403, 'Date e stato li cambia il team HR');
    res.json({ ok: true });
  });
  app.patch('/api/hr/onboarding/:id/compiti/:tid', async (req, res) => {
    const o = await onbRow(v.int(req.params.id, 'id', { min: 1 }));
    const acc = mustSee(req, o);
    const { rows: [t] } = await db.query('SELECT * FROM hr_onb_tasks WHERE id = $1 AND onb_id = $2', [v.int(req.params.tid, 'compito', { min: 1 }), o.id]);
    if (!t) throw new HttpError(404, 'Compito non trovato');
    if (!canTick(acc, t)) throw new HttpError(403, 'Questo compito lo segna chi lo deve fare (o il team HR)');
    const fatto = Boolean(req.body.fatto);
    await db.query('UPDATE hr_onb_tasks SET fatto = $1, fatto_at = CASE WHEN $1 THEN now() END, fatto_by = CASE WHEN $1 THEN $2::int END WHERE id = $3', [fatto, req.user.id, t.id]);
    res.json({ ok: true });
  });
  app.put('/api/hr/onboarding/:id/obiettivi', async (req, res) => {
    const o = await onbRow(v.int(req.params.id, 'id', { min: 1 }));
    const acc = mustSee(req, o);
    if (!['hr', 'responsabile'].includes(acc)) throw new HttpError(403, 'Gli obiettivi li scrive il responsabile');
    const list = (Array.isArray(req.body.obiettivi) ? req.body.obiettivi : []).slice(0, 8).map((g, i) => ({ titolo: v.text(String(g.titolo || ''), 'obiettivo', { max: 300 }), stato: ['da_fare', 'meta', 'fatto'].includes(g.stato) ? g.stato : 'da_fare', ordine: i + 1 })).filter(g => g.titolo);
    if (!list.length) throw new HttpError(400, 'Scrivi almeno un obiettivo');
    await db.tx(async q => {
      await q.query('DELETE FROM hr_onb_goals WHERE onb_id = $1', [o.id]);
      for (const g of list) await q.query('INSERT INTO hr_onb_goals (onb_id, ordine, titolo, stato) VALUES ($1, $2, $3, $4)', [o.id, g.ordine, g.titolo, g.stato]);
      if (acc === 'responsabile' || req.body.confermati) await q.query("UPDATE hr_onb_tasks SET fatto = true, fatto_at = now(), fatto_by = $2 WHERE onb_id = $1 AND tipo = 'obiettivi' AND NOT fatto", [o.id, req.user.id]);
    });
    res.json({ ok: true });
  });

  // ── «Il mio inserimento» (AB) ──
  app.get('/api/hr/inserimento/mio', async (req, res) => {
    const { rows: [x] } = await db.query("SELECT id FROM hr_onboardings WHERE email = $1 AND stato = 'aperto' ORDER BY id DESC LIMIT 1", [me(req)]);
    if (!x) return res.json({ onboarding: null });
    const o = await onbRow(x.id);
    const today = todayIso();
    const { rows: tasks } = await db.query('SELECT * FROM hr_onb_tasks WHERE onb_id = $1 ORDER BY ordine', [o.id]);
    const { rows: meetings } = await db.query('SELECT tappa, quando, join_url, fatto_at FROM hr_onb_meetings WHERE onb_id = $1 ORDER BY tappa', [o.id]);
    const { rows: pulse } = await db.query('SELECT tappa FROM hr_onb_pulse WHERE onb_id = $1', [o.id]);
    const next = meetings.find(m => !m.fatto_at) || null;
    const giorno = O.daysBetween(o.inizio, today) + 1;
    const settimana = tasks.filter(t => !t.fatto && t.giorno <= Math.max(giorno + 7, 7)).slice(0, 6);
    res.json({
      onboarding: { id: o.id, nome: o.nome.split(' ')[0], giorno, giorni: O.PIANO_GIORNI, ruolo: roleTitle(o), inizio: o.inizio, sede: o.sede },
      progresso: { fatti: tasks.filter(t => t.fatto).length, totale: tasks.length },
      settimana: settimana.map(t => ({ id: t.id, titolo: t.titolo, chi: O.CHI[t.chi] || t.chi, mio: t.chi === 'nuovo' && t.tipo === 'compito', scadenza: dueOf(o, t), in_ritardo: dueOf(o, t) < today, tipo: t.tipo })),
      persone: await people(o), documenti: await docsOf(o),
      formazione: await trainingOf(o.person_key, o.role_id).then(tr => ({ ...tr, corsi: tr.corsi.map(x => (x.stato === 'manca' ? { ...x, nel_piano: dueOf(o, { giorno: x.course.giorno }), in_ritardo: dueOf(o, { giorno: x.course.giorno }) < today } : x)) })),
      incontro: next ? { ...next, data: O.addDays(o.inizio, next.tappa), pulse_fatto: pulse.some(p => p.tappa === next.tappa) } : null,
    });
  });
  app.post('/api/hr/onboarding/:id/documenti/:key/letto', async (req, res) => {
    const o = await onbRow(v.int(req.params.id, 'id', { min: 1 }));
    if (accessOf(req, o) !== 'nuovo') throw new HttpError(403, 'La presa visione la fa la persona');
    const key = String(req.params.key);
    const doc = (await docsOf(o)).find(d => d.key === key);
    if (!doc) throw new HttpError(404, 'Documento non trovato');
    const domanda = v.text(req.body.domanda, 'domanda', { max: 1000 }) || '';
    await db.query(`INSERT INTO hr_doc_reads (onb_id, doc_key, version, domanda) VALUES ($1, $2, $3, $4)
      ON CONFLICT (onb_id, doc_key) DO UPDATE SET version = EXCLUDED.version, domanda = EXCLUDED.domanda, read_at = now()`, [o.id, key, doc.version, domanda]);
    if (key.startsWith('mansionario:')) await db.query('INSERT INTO hr_role_acks (role_id, email, version) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [o.role_id, me(req), doc.version]);
    if ((await docsOf(o)).every(d => d.letto)) await db.query("UPDATE hr_onb_tasks SET fatto = true, fatto_at = now(), fatto_by = $2 WHERE onb_id = $1 AND tipo = 'documento' AND NOT fatto", [o.id, req.user.id]);
    if (domanda && o.resp_email) await notify(await userIdsByEmail([o.resp_email]), req.user.id, `ha una domanda su «${doc.titolo}»: ${domanda.slice(0, 160)}`, `/hr/onboarding/${o.id}`);
    res.json({ ok: true });
  });
  app.put('/api/hr/onboarding/:id/pulse/:tappa', async (req, res) => {
    const o = await onbRow(v.int(req.params.id, 'id', { min: 1 }));
    if (accessOf(req, o) !== 'nuovo') throw new HttpError(403, 'Il pulse lo compila la persona');
    const tappa = v.oneOf(Number(req.params.tappa), 'tappa', O.TAPPE);
    const q = k => v.int(req.body[k], 'risposta', { min: 1, max: 5 });
    const p = { q1: q('q1'), q2: q('q2'), q3: q('q3') };
    if ([p.q1, p.q2, p.q3].some(x => x == null)) throw new HttpError(400, 'Rispondi alle tre domande');
    await db.query(`INSERT INTO hr_onb_pulse (onb_id, tappa, q1, q2, q3) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (onb_id, tappa) DO UPDATE SET q1 = EXCLUDED.q1, q2 = EXCLUDED.q2, q3 = EXCLUDED.q3, at = now()`, [o.id, tappa, p.q1, p.q2, p.q3]);
    const f = O.flags({ pulse: p });
    if (f.length) await notify(await usersByRole('hr'), null, `segnale nell'inserimento di ${o.nome}: ${f.join(', ')}.`, `/hr/onboarding/${o.id}`);
    res.json({ ok: true });
  });

  // ── incontri 30/60/90 (AD) ──
  app.get('/api/hr/onboarding/:id/incontri/:tappa', async (req, res) => {
    const o = await onbRow(v.int(req.params.id, 'id', { min: 1 }));
    const acc = mustSee(req, o);
    if (!['hr', 'responsabile', 'nuovo'].includes(acc)) throw new HttpError(403, 'Note e voti li vedono la persona, il responsabile e HR');
    const tappa = v.oneOf(Number(req.params.tappa), 'tappa', O.TAPPE);
    const { rows: [m] } = await db.query('SELECT * FROM hr_onb_meetings WHERE onb_id = $1 AND tappa = $2', [o.id, tappa]);
    const { rows: pulse } = await db.query('SELECT * FROM hr_onb_pulse WHERE onb_id = $1 ORDER BY tappa', [o.id]);
    const { rows: goals } = await db.query('SELECT titolo, stato FROM hr_onb_goals WHERE onb_id = $1 ORDER BY ordine', [o.id]);
    const { rows: all } = await db.query('SELECT tappa, fatto_at, quando, voto_obiettivi, voto_squadra FROM hr_onb_meetings WHERE onb_id = $1 ORDER BY tappa', [o.id]);
    const cur = pulse.find(p => p.tappa === tappa) || null;
    const prev = pulse.filter(p => p.tappa < tappa).pop() || null;
    res.json({ accesso: acc, onboarding: { id: o.id, nome: o.nome, ruolo: roleTitle(o), inizio: o.inizio, fine_prova: o.fine_prova }, incontro: { ...m, data: O.addDays(o.inizio, tappa) },
      tutti: all.map(x => ({ ...x, data: O.addDays(o.inizio, x.tappa) })), obiettivi: goals, pulse: { attuale: cur, prima: prev }, segnali: O.flags({ pulse: cur, meeting: m.fatto_at ? m : null }),
      persone: await people(o) });
  });
  app.put('/api/hr/onboarding/:id/incontri/:tappa', async (req, res) => {
    const o = await onbRow(v.int(req.params.id, 'id', { min: 1 }));
    const acc = mustSee(req, o);
    if (!['hr', 'responsabile'].includes(acc)) throw new HttpError(403, 'L\'incontro lo scrive il responsabile');
    const tappa = v.oneOf(Number(req.params.tappa), 'tappa', O.TAPPE);
    const b = req.body || {};
    const m = { voto_obiettivi: v.int(b.voto_obiettivi, 'voto obiettivi', { min: 1, max: 10 }), voto_squadra: v.int(b.voto_squadra, 'voto squadra', { min: 1, max: 10 }),
      serve: v.text(b.serve, 'cosa serve', { max: 1000 }) || '', prossimo: v.text(b.prossimo, 'prossimo obiettivo', { max: 1000 }) || '', note: v.text(b.note, 'note', { max: 3000 }) || '' };
    if (m.voto_obiettivi == null || m.voto_squadra == null) throw new HttpError(400, 'Dai i due voti da 1 a 10');
    await db.query(`UPDATE hr_onb_meetings SET voto_obiettivi = $1, voto_squadra = $2, serve = $3, prossimo = $4, note = $5, fatto_at = now(), fatto_by = $6 WHERE onb_id = $7 AND tappa = $8`,
      [m.voto_obiettivi, m.voto_squadra, m.serve, m.prossimo, m.note, req.user.id, o.id, tappa]);
    await db.query("UPDATE hr_onb_tasks SET fatto = true, fatto_at = now(), fatto_by = $3 WHERE onb_id = $1 AND tipo = 'incontro' AND ref = $2", [o.id, String(tappa), req.user.id]);
    if (Array.isArray(b.obiettivi)) for (const g of b.obiettivi) if (['da_fare', 'meta', 'fatto'].includes(g.stato)) await db.query('UPDATE hr_onb_goals SET stato = $1 WHERE onb_id = $2 AND titolo = $3', [g.stato, o.id, String(g.titolo || '')]);
    const { rows: [p] } = await db.query('SELECT * FROM hr_onb_pulse WHERE onb_id = $1 AND tappa = $2', [o.id, tappa]);
    const f = O.flags({ pulse: p, meeting: m });
    if (f.length || b.segnala) await notify(await usersByRole('hr'), req.user.id, `incontro dei ${tappa} giorni di ${o.nome}: ${f.length ? f.join(', ') : 'chiede di parlarne con HR'}.`, `/hr/onboarding/${o.id}`);
    res.json({ ok: true, segnali: f });
  });
  app.post('/api/hr/onboarding/:id/incontri/:tappa/fissa', async (req, res) => {
    const o = await onbRow(v.int(req.params.id, 'id', { min: 1 }));
    const acc = mustSee(req, o);
    if (!['hr', 'responsabile'].includes(acc)) throw new HttpError(403, 'L\'incontro lo fissa il responsabile');
    const tappa = v.oneOf(Number(req.params.tappa), 'tappa', O.TAPPE);
    const quando = new Date(String(req.body.quando || ''));
    if (isNaN(quando)) throw new HttpError(400, 'Data dell\'incontro non valida');
    let outlookId = null, joinUrl = null, avviso = null;
    if (auth?.msConfigured) {
      try {
        const { graph, TIMEZONE } = require('../lib/graph');
        const token = await auth.graphToken(req.user.id);
        const local = d => d.toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace(' ', 'T');
        const ev = await graph(token, 'POST', '/me/events', { headers: { Prefer: `outlook.timezone="${TIMEZONE}"` }, body: {
          subject: `Incontro dei ${tappa} giorni · ${o.nome}`, start: { dateTime: local(quando), timeZone: TIMEZONE }, end: { dateTime: local(new Date(quando.getTime() + 30 * 60000)), timeZone: TIMEZONE },
          attendees: [o.email].filter(Boolean).map(x => ({ type: 'required', emailAddress: { address: x } })), isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } });
        outlookId = ev.id; joinUrl = ev.onlineMeeting?.joinUrl || null;
      } catch (err) { avviso = `Invito Outlook non creato: ${err.message}`; }
    } else avviso = 'Microsoft non è collegato: invito Outlook non creato.';
    await db.query('UPDATE hr_onb_meetings SET quando = $1, outlook_id = $2, join_url = $3 WHERE onb_id = $4 AND tappa = $5', [quando, outlookId, joinUrl, o.id, tappa]);
    if (o.email) await notify(await userIdsByEmail([o.email]), req.user.id, `ha fissato l'incontro dei ${tappa} giorni: prima rispondi alle 3 domande in «Il mio inserimento».`, '/hr/inserimento');
    res.json({ ok: true, avviso, join_url: joinUrl });
  });

  // ── fine prova (AE) ──
  app.post('/api/hr/onboarding/:id/prova', async (req, res) => {
    const o = await onbRow(v.int(req.params.id, 'id', { min: 1 }));
    const acc = mustSee(req, o);
    const b = req.body || {};
    const step = v.oneOf(b.passo || 'responsabile', 'passo', ['responsabile', 'hr', 'direzione']);
    const { rows: [p] } = await db.query('SELECT * FROM hr_probation WHERE onb_id = $1', [o.id]);
    if (step === 'responsabile') {
      if (!['hr', 'responsabile'].includes(acc)) throw new HttpError(403, 'La decisione la prende il responsabile');
      const decisione = v.oneOf(b.decisione, 'decisione', ['conferma', 'non_superata']);
      const motivo = v.text(b.motivo, 'motivo', { max: 3000 }) || '';
      if (!decisione) throw new HttpError(400, 'Scegli: confermo o non superata');
      if (decisione === 'non_superata' && !motivo) throw new HttpError(400, 'Serve il motivo scritto');
      await db.query('UPDATE hr_probation SET decisione = $1, motivo = $2, deciso_by = $3, deciso_at = now(), hr_by = NULL, hr_at = NULL, dir_by = NULL, dir_at = NULL WHERE onb_id = $4', [decisione, motivo, req.user.id, o.id]);
      await notify(await usersByRole('hr'), req.user.id, `ha deciso la fine prova di ${o.nome} (${decisione === 'conferma' ? 'confermata' : 'non superata'}): serve il visto di HR.`, `/hr/onboarding/${o.id}`);
    } else if (step === 'hr') {
      if (acc !== 'hr') throw new HttpError(403, 'Il visto lo mette il team HR');
      if (!p.decisione) throw new HttpError(400, 'Prima la decisione del responsabile');
      const rev = v.int(b.revisione_ral, 'revisione', { min: 10000, max: 400000, nullable: true });
      await db.query('UPDATE hr_probation SET hr_by = $1, hr_at = now(), revisione_ral = COALESCE($2, revisione_ral) WHERE onb_id = $3', [req.user.id, rev ?? null, o.id]);
      if (Number(o.grade) >= 6) await notify(await usersByRole('direzione'), req.user.id, `fine prova di ${o.nome} (G${o.grade}): manca l'ok della Direzione.`, `/hr/onboarding/${o.id}`);
    } else {
      if (!(acc === 'direzione' || (acc === 'hr' && !(await usersByRole('direzione')).length))) throw new HttpError(403, 'Questo passo è della Direzione');
      if (!p.hr_at) throw new HttpError(400, 'Prima il visto di HR');
      await db.query('UPDATE hr_probation SET dir_by = $1, dir_at = now() WHERE onb_id = $2', [req.user.id, o.id]);
    }
    const { rows: [n] } = await db.query('SELECT * FROM hr_probation WHERE onb_id = $1', [o.id]);
    const done = n.decisione && n.hr_at && (Number(o.grade) < 6 || n.dir_at);
    if (done) {
      await db.query("UPDATE hr_onb_tasks SET fatto = true, fatto_at = now() WHERE onb_id = $1 AND tipo = 'prova' AND NOT fatto", [o.id]);
      if (n.decisione === 'conferma') await db.query("UPDATE hr_onboardings SET stato = 'chiuso', closed_at = now() WHERE id = $1", [o.id]);
    }
    await hrLog(req, `fine prova: ${step}`, o.person_key);
    res.json({ ok: true, completa: Boolean(done) });
  });

  // ── formazione (AC) ──
  app.get('/api/hr/formazione', async (req, res) => {
    hrOrQhse(req);
    await ensureOnbSeed(db);
    const ambito = hrMod().ambitoOf(req);
    const { rows: courses } = await db.query('SELECT * FROM hr_courses ORDER BY attivo DESC, ordine, id');
    const { rows: rc } = await db.query('SELECT role_id, course_id FROM hr_role_courses');
    const { rows: certs } = await db.query('SELECT DISTINCT ON (person_key, course_id) id, person_key, course_id, data::text AS data, scade::text AS scade, ente, (file IS NOT NULL) AS has_file FROM hr_certificates ORDER BY person_key, course_id, data DESC');
    const people = (await hrMod().loadPeople(db)).filter(p => !p.esclusione && hrMod().inScope(p.area, ambito));
    const { rows: onb } = await db.query("SELECT person_key, inizio::text AS inizio FROM hr_onboardings WHERE stato = 'aperto'");
    const onbBy = new Map(onb.map(x => [x.person_key, x.inizio]));
    const roleCourses = new Map();
    for (const r of rc) (roleCourses.get(r.role_id) || roleCourses.set(r.role_id, new Set()).get(r.role_id)).add(r.course_id);
    const certBy = new Map(certs.map(c => [`${c.person_key}|${c.course_id}`, c]));
    const today = todayIso();
    const active = courses.filter(c => c.attivo);
    const rows = people.map(p => {
      const need = roleCourses.get(p.role_id) || new Set();
      const st = active.filter(c => need.has(c.id)).map(c => {
        const cert = certBy.get(`${p.key}|${c.id}`);
        const s = O.certStatus(cert, c, today);
        const inizio = onbBy.get(p.key);
        const nelPiano = s.stato === 'manca' && inizio ? O.addDays(inizio, c.giorno) : null;
        return { course_id: c.id, ...s, cert_id: cert?.id || null, has_file: cert?.has_file || false, nel_piano: nelPiano, in_ritardo: nelPiano ? nelPiano < today : false, course: c };
      });
      return { key: p.key, nome: `${p.nome} ${p.cognome}`, ruolo_id: p.role_id, area: p.area?.nome || p.bu || '', nuovo: onbBy.has(p.key),
        corsi: st.map(({ course, ...x }) => x), cantiere: O.siteStatus(st) };
    });
    const all = rows.flatMap(r => r.corsi);
    const { rows: roles } = await db.query('SELECT id, title, hr_name, hr_level, hr_family, grade FROM pm_roles WHERE hr_family IS NOT NULL AND merged_into IS NULL ORDER BY hr_order, id');
    res.json({
      corsi: courses, persone: rows, ruoli: roles.map(r => ({ id: r.id, title: H.roleTitle(r), family: r.hr_family, corsi: [...(roleCourses.get(r.id) || [])] })),
      kpi: { in_regola: all.filter(c => c.stato === 'ok' || c.stato === 'scade').length, richiesti: all.length, scaduti: all.filter(c => c.stato === 'scaduto').length,
        bloccano: rows.filter(r => !r.cantiere.ok && r.corsi.some(c => c.stato === 'scaduto')).length, in_scadenza: all.filter(c => c.stato === 'scade').length,
        nuovi: rows.filter(r => r.nuovo && r.corsi.some(c => c.stato === 'manca')).length },
      is_hr: isHr(req),
    });
  });
  app.post('/api/hr/formazione/attestati', express.json({ limit: '12mb' }), async (req, res) => {
    hrOrQhse(req);
    const personKey = v.text(req.body.person_key, 'persona', { max: 200, required: true });
    const courseId = v.int(req.body.course_id, 'corso', { min: 1 });
    const data = v.date(req.body.data, 'data');
    if (!courseId || !data) throw new HttpError(400, 'Corso e data dell\'attestato');
    const { rows: [c] } = await db.query('SELECT * FROM hr_courses WHERE id = $1', [courseId]);
    if (!c) throw new HttpError(404, 'Corso non trovato');
    const f = readFile(req.body.file, 'attestato');
    const scade = O.expiryOf(data, c);
    const { rows: [r] } = await db.query('INSERT INTO hr_certificates (person_key, course_id, data, scade, ente, file_nome, file_mime, file, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [personKey, courseId, data, scade, v.text(req.body.ente, 'ente', { max: 200 }) || '', f?.nome || null, f?.mime || null, f?.data || null, req.user.id]);
    if (!scade || scade >= todayIso()) await db.query(`UPDATE hr_onb_tasks t SET fatto = true, fatto_at = now(), fatto_by = $3 FROM hr_onboardings o
      WHERE o.id = t.onb_id AND o.person_key = $1 AND o.stato = 'aperto' AND t.tipo = 'corso' AND t.ref = $2 AND NOT t.fatto`, [personKey, String(courseId), req.user.id]);
    await hrLog(req, `attestato: ${c.nome}`, personKey);
    res.json({ id: r.id, scade });
  });
  app.get('/api/hr/formazione/attestati/:id/file', async (req, res) => {
    const { rows: [c] } = await db.query('SELECT c.*, o.id AS onb FROM hr_certificates c LEFT JOIN hr_onboardings o ON o.person_key = c.person_key AND o.email = $2 WHERE c.id = $1', [v.int(req.params.id, 'id', { min: 1 }), me(req)]);
    if (!c || !c.file) throw new HttpError(404, 'File non trovato');
    if (!isHr(req) && !isQhse(req) && !c.onb) throw new HttpError(403, 'Riservato');
    res.set('Content-Type', c.file_mime).set('Content-Disposition', `inline; filename="${encodeURIComponent(c.file_nome || 'attestato')}"`).set('Cache-Control', 'no-store').send(c.file);
  });
  app.post('/api/hr/formazione/corsi', async (req, res) => {
    hrOrQhse(req);
    const b = req.body || {};
    const nome = v.text(b.nome, 'nome', { max: 160, required: true });
    const { rows: [r] } = await db.query('INSERT INTO hr_courses (nome, ore, validita_mesi, blocca_cantiere, giorno, ordine) VALUES ($1,$2,$3,$4,$5,(SELECT COALESCE(max(ordine),0)+1 FROM hr_courses)) RETURNING id',
      [nome, b.ore ? Number(b.ore) : null, v.int(b.validita_mesi, 'validità', { min: 1, max: 240, nullable: true }) || null, Boolean(b.blocca_cantiere), v.int(b.giorno ?? 30, 'giorno', { min: 0, max: 90 })]);
    res.json({ id: r.id });
  });
  app.patch('/api/hr/formazione/corsi/:id', async (req, res) => {
    hrOrQhse(req);
    const id = v.int(req.params.id, 'id', { min: 1 });
    const b = req.body || {};
    const f = {};
    if (b.nome !== undefined) f.nome = v.text(b.nome, 'nome', { max: 160, required: true });
    if (b.ore !== undefined) f.ore = b.ore === null || b.ore === '' ? null : Number(b.ore);
    if (b.validita_mesi !== undefined) f.validita_mesi = v.int(b.validita_mesi, 'validità', { min: 1, max: 240, nullable: true });
    if (b.blocca_cantiere !== undefined) f.blocca_cantiere = Boolean(b.blocca_cantiere);
    if (b.giorno !== undefined) f.giorno = v.int(b.giorno, 'giorno', { min: 0, max: 90 });
    if (b.attivo !== undefined) f.attivo = Boolean(b.attivo);
    const k = Object.keys(f);
    if (!k.length) throw new HttpError(400, 'Niente da cambiare');
    await db.query(`UPDATE hr_courses SET ${k.map((x, i) => `${x} = $${i + 1}`).join(', ')} WHERE id = $${k.length + 1}`, [...k.map(x => f[x]), id]);
    res.json({ ok: true });
  });
  app.put('/api/hr/formazione/ruoli/:roleId', async (req, res) => {
    hrOrQhse(req);
    const roleId = v.int(req.params.roleId, 'ruolo', { min: 1 });
    const ids = (Array.isArray(req.body.corsi) ? req.body.corsi : []).map(Number).filter(Number.isInteger);
    await db.tx(async q => {
      await q.query('DELETE FROM hr_role_courses WHERE role_id = $1', [roleId]);
      for (const c of ids) await q.query('INSERT INTO hr_role_courses (role_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [roleId, c]);
    });
    res.json({ ok: true });
  });
  app.get('/api/hr/formazione.xlsx', async (req, res) => {
    hrOrQhse(req);
    const { rows } = await db.query(`SELECT h.nome, h.cognome, c.nome AS corso, x.data::text AS data, x.scade::text AS scade, x.ente FROM hr_certificates x
      JOIN hr_courses c ON c.id = x.course_id LEFT JOIN hr_people h ON h.key = x.person_key ORDER BY h.cognome, c.ordine, x.data DESC`);
    const today = todayIso();
    const { writeXlsx } = require('../lib/xlsx');
    const sheet = [['Cognome', 'Nome', 'Corso', 'Data', 'Scade', 'Stato', 'Ente'], ...rows.map(r => [r.cognome || '', r.nome || '', r.corso, r.data, r.scade || 'non scade', !r.scade ? 'valido' : r.scade < today ? 'scaduto' : 'valido', r.ente])];
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', 'attachment; filename="formazione-obbligatoria.xlsx"').send(writeXlsx({ Attestati: sheet }));
  });

  // ── modelli e documenti (AF) ──
  app.get('/api/hr/onboarding-modelli', async (req, res) => {
    hrOnly(req);
    await ensureOnbSeed(db);
    const tpl = await latestTemplates(db);
    const { rows: roles } = await db.query('SELECT id, title, hr_name, hr_level, hr_family, grade, description, autonomy FROM pm_roles WHERE hr_family IS NOT NULL AND merged_into IS NULL ORDER BY hr_order, id');
    const uses = t => roles.filter(r => O.templateKeys(r, O.sedeFor(r)).includes(t.chiave)).length; // con la sede di partenza del ruolo
    const { rows: docs } = await db.query('SELECT id, titolo, url, version, attivo, ordine, (file IS NOT NULL) AS has_file, file_nome FROM hr_documents ORDER BY attivo DESC, ordine, id');
    res.json({ modelli: tpl.map(t => ({ ...t, ruoli: uses(t) })), ruoli: roles.map(r => ({ id: r.id, title: H.roleTitle(r), family: r.hr_family, grade: r.grade })), documenti: docs, chi: O.CHI });
  });
  app.put('/api/hr/onboarding-modelli/:chiave', async (req, res) => {
    hrOnly(req);
    const chiave = String(req.params.chiave);
    if (!/^(base|resp|fam:[a-z]+|sede:[a-z]+)$/.test(chiave)) throw new HttpError(400, 'Modello non valido');
    const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 60).map(it => ({ giorno: v.int(it.giorno, 'giorno', { min: 0, max: 90 }) ?? 0, titolo: v.text(String(it.titolo || ''), 'compito', { max: 300 }), chi: Object.keys(O.CHI).includes(it.chi) ? it.chi : 'hr' })).filter(it => it.titolo);
    const nome = v.text(req.body.nome, 'nome', { max: 120 });
    const { rows: [cur] } = await db.query('SELECT nome, version FROM hr_onb_templates WHERE chiave = $1 ORDER BY version DESC LIMIT 1', [chiave]);
    const { rows: [r] } = await db.query('INSERT INTO hr_onb_templates (chiave, nome, version, items, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING version',
      [chiave, nome || cur?.nome || chiave, (cur?.version || 0) + 1, JSON.stringify(items), req.user.id]);
    await hrLog(req, `modello di inserimento ${chiave} v${r.version}`);
    res.json({ version: r.version });
  });
  app.get('/api/hr/onboarding-modelli/anteprima', async (req, res) => {
    hrOnly(req);
    const roleId = v.int(req.query.role_id, 'ruolo', { min: 1 });
    const { rows: [role] } = await db.query('SELECT * FROM pm_roles WHERE id = $1', [roleId]);
    if (!role) throw new HttpError(404, 'Ruolo non trovato');
    const sede = req.query.sede === 'cantiere' || req.query.sede === 'ufficio' ? req.query.sede : O.sedeFor(role);
    const tpl = (await latestTemplates(db)).filter(t => O.templateKeys(role, sede).includes(t.chiave));
    const { rows: courses } = await db.query('SELECT c.* FROM hr_role_courses rc JOIN hr_courses c ON c.id = rc.course_id WHERE rc.role_id = $1 AND c.attivo ORDER BY c.ordine', [roleId]);
    const { rows: docs } = await db.query('SELECT titolo FROM hr_documents WHERE attivo ORDER BY ordine, id');
    res.json({ sede, modelli: tpl.map(t => `${t.nome} v${t.version}`), piano: O.composePlan({ templates: tpl, courses, docs: [{ titolo: `mansionario ${H.roleTitle(role)}` }, ...docs], fineProvaGiorno: O.daysBetween('2027-01-01', O.fineProva('2027-01-01')) }), obiettivi: O.goalsFor(role) });
  });
  app.post('/api/hr/documenti', express.json({ limit: '12mb' }), async (req, res) => {
    hrOnly(req);
    const titolo = v.text(req.body.titolo, 'titolo', { max: 200, required: true });
    const url = v.text(req.body.url, 'link', { max: 500 }) || null;
    const f = readFile(req.body.file, 'documento');
    if (!url && !f) throw new HttpError(400, 'Serve un link o un file');
    if (url && !/^https:\/\//.test(url)) throw new HttpError(400, 'Il link deve iniziare con https://');
    const { rows: [r] } = await db.query('INSERT INTO hr_documents (titolo, url, file_nome, file_mime, file, ordine) VALUES ($1,$2,$3,$4,$5,(SELECT COALESCE(max(ordine),0)+1 FROM hr_documents)) RETURNING id',
      [titolo, url, f?.nome || null, f?.mime || null, f?.data || null]);
    res.json({ id: r.id });
  });
  app.patch('/api/hr/documenti/:id', express.json({ limit: '12mb' }), async (req, res) => {
    hrOnly(req);
    const id = v.int(req.params.id, 'id', { min: 1 });
    const b = req.body || {};
    if (b.attivo !== undefined) await db.query('UPDATE hr_documents SET attivo = $1, updated_at = now() WHERE id = $2', [Boolean(b.attivo), id]);
    const f = readFile(b.file, 'documento');
    const url = v.text(b.url, 'link', { max: 500 });
    if (url && !/^https:\/\//.test(url)) throw new HttpError(400, 'Il link deve iniziare con https://');
    if (f || url) await db.query('UPDATE hr_documents SET url = COALESCE($1, url), file_nome = COALESCE($2, file_nome), file_mime = COALESCE($3, file_mime), file = COALESCE($4, file), version = version + 1, updated_at = now() WHERE id = $5',
      [url || null, f?.nome || null, f?.mime || null, f?.data || null, id]); // versione nuova: chi l'aveva letto la rilegge
    res.json({ ok: true });
  });
  app.get('/api/hr/documenti/:id/file', async (req, res) => {
    const { rows: [d] } = await db.query('SELECT file, file_mime, file_nome FROM hr_documents WHERE id = $1', [v.int(req.params.id, 'id', { min: 1 })]);
    if (!d?.file) throw new HttpError(404, 'File non trovato');
    res.set('Content-Type', d.file_mime).set('Content-Disposition', `inline; filename="${encodeURIComponent(d.file_nome || 'documento')}"`).send(d.file);
  });
}

// Promemoria del giorno (compiti in ritardo, formazione in scadenza, fine prova): una volta al giorno dal server.
async function remindOnboarding(db, gov, notifier, today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })) {
  const { rows: users } = await db.query('SELECT id, lower(email) AS email FROM users WHERE email IS NOT NULL AND suspended_at IS NULL');
  const byRole = k => users.filter(u => gov.roleOf(u.email).key === k).map(u => u.id);
  const byEmail = e => users.filter(u => u.email === e).map(u => u.id);
  const send = (ids, body, link) => (ids.length ? notifier.notify({ userIds: [...new Set(ids)], actorId: null, kind: 'hr', body, link }).catch(() => {}) : null);
  let n = 0;
  // compiti in ritardo: a chi li deve fare, poi dopo 3 giorni anche a HR
  const { rows: late } = await db.query(`SELECT t.id, t.titolo, t.chi, t.giorno, o.id AS onb, o.nome, o.email, o.resp_email, o.buddy_email, o.inizio::text AS inizio
    FROM hr_onb_tasks t JOIN hr_onboardings o ON o.id = t.onb_id WHERE o.stato = 'aperto' AND NOT t.fatto AND o.inizio + t.giorno < $1::date
      AND (t.reminded_at IS NULL OR t.reminded_at < now() - interval '20 hours')`, [today]);
  for (const t of late) {
    const ritardo = O.daysBetween(O.addDays(t.inizio, t.giorno), today);
    const who = { nuovo: byEmail(t.email), responsabile: byEmail(t.resp_email), buddy: byEmail(t.buddy_email), qhse: byRole('qhse').length ? byRole('qhse') : byRole('hr') }[t.chi] || byRole('hr');
    await send([...who, ...(ritardo >= 3 ? byRole('hr') : [])], `inserimento di ${t.nome}: «${t.titolo}» è in ritardo di ${ritardo} ${ritardo === 1 ? 'giorno' : 'giorni'}.`, `/hr/onboarding/${t.onb}`);
    await db.query('UPDATE hr_onb_tasks SET reminded_at = now() WHERE id = $1', [t.id]);
    n++;
  }
  // formazione: 60 e 30 giorni prima, e il giorno dopo la scadenza
  const { rows: cert } = await db.query(`SELECT DISTINCT ON (x.person_key, x.course_id) x.person_key, x.course_id, x.scade::text AS scade, c.nome AS corso, c.blocca_cantiere, h.nome, h.cognome, h.email
    FROM hr_certificates x JOIN hr_courses c ON c.id = x.course_id LEFT JOIN hr_people h ON h.key = x.person_key WHERE c.attivo AND h.attivo ORDER BY x.person_key, x.course_id, x.data DESC`);
  for (const c of cert.filter(x => x.scade)) {
    const d = O.daysBetween(today, c.scade);
    if (![60, 30, -1].includes(d)) continue;
    const { rows: [resp] } = c.email ? await db.query('SELECT lower(s.ricoperto_da) AS e FROM org_incarichi i JOIN org_incarichi s ON s.id = i.riporta_a_id WHERE i.attivo AND lower(i.ricoperto_da) = $1 LIMIT 1', [c.email]) : { rows: [] };
    await send([...byRole('qhse'), ...(resp ? byEmail(resp.e) : []), ...(byRole('qhse').length ? [] : byRole('hr'))],
      d < 0 ? `«${c.corso}» di ${c.nome} ${c.cognome} è scaduto${c.blocca_cantiere ? ': non può lavorare da solo in cantiere' : ''}.` : `«${c.corso}» di ${c.nome} ${c.cognome} scade tra ${d} giorni.`, '/hr/formazione');
    n++;
  }
  // fine prova: 30 giorni al responsabile, 10 a HR, 1 a HR e Direzione
  const { rows: prove } = await db.query(`SELECT o.id, o.nome, o.resp_email, o.fine_prova::text AS fine, p.reminded FROM hr_onboardings o JOIN hr_probation p ON p.onb_id = o.id
    WHERE o.stato = 'aperto' AND o.fine_prova IS NOT NULL AND p.hr_at IS NULL AND o.fine_prova >= $1::date`, [today]);
  for (const p of prove) {
    const rem = p.reminded || {};
    for (const a of O.probationAlerts(p.fine, today)) {
      if (rem[a.soglia]) continue;
      const ids = a.a.flatMap(x => (x === 'responsabile' ? byEmail(p.resp_email) : byRole(x)));
      await send(ids, `la prova di ${p.nome} finisce il ${p.fine.split('-').reverse().join('/')}: ${a.soglia === 30 ? 'la scheda per decidere è pronta' : 'manca ancora la decisione'}.`, `/hr/onboarding/${p.id}`);
      rem[a.soglia] = today;
      n++;
    }
    await db.query('UPDATE hr_probation SET reminded = $1 WHERE onb_id = $2', [JSON.stringify(rem), p.id]);
  }
  return n;
}

module.exports = { registerHrOnb, createOnboarding, ensureOnbSeed, remindOnboarding };
