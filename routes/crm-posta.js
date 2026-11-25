// Posta e «Progetto da email» (ALM2-55, canvas «Progetto da email» approvato da Dante il 22/11/2026).
// - Posta (tavola A): la propria casella di Outlook nel CRM; su ogni email «Crea progetto commerciale» o, se la sua
//   conversazione è già in un progetto, il link al progetto.
// - Proposta (tavola B): Alma legge la conversazione e propone concetto, azienda, BU, tipo, persone da collegare, email
//   che entrano e i legami nel CRM. Niente si salva finché non si preme «Salva solo nel Radar» o «Avanti».
// - Creazione: nasce un'opportunità del Radar (source «email») con la conversazione collegata; «Avanti» porta alla sala
//   di lancio (routes/crm-progetti.js), che crea il progetto (trattativa privata o gara) e ci copia le email.
// - Dopo (tavola D): ogni 30 minuti in orario di lavoro e all'apertura della scheda si leggono le email nuove della
//   conversazione (entrano da sole), si suggeriscono le altre email delle persone collegate che parlano del progetto e
//   si aggiorna lo stato della trattativa: in breve, a chi tocca, termometro, prossima mossa, impegni, chi conta.
// Regole (tavola E): D2 da sole solo le risposte nella stessa conversazione; D3 si legge solo la casella di chi ha
// collegato la conversazione (un collega può collegarla dalla sua); le email nel progetto le vede chi vede il progetto.
const { HttpError, v } = require('../lib/http');
const { graph } = require('../lib/graph');
const S = require('../lib/crm-scrivo');
const P = require('../lib/crm-posta');
const A = require('../lib/crm-posta-ai');
const I = require('../lib/crm-posta-invio');
const F = require('../lib/firma');
const { loadSettings } = require('../lib/crm-commerciale');
const { relationsFor, pathsOf } = require('../lib/crm-relazioni');
const { addDays } = require('../lib/workdays');
const E = require('../lib/energy-posta');
const { KINDS, stageKeys } = require('../lib/energy');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const PAGE = 30;
const SELECT = 'id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,hasAttachments,internetMessageId,isDraft,webLink,parentFolderId';
const FULL = `${SELECT},body`;
const TEXT = { Prefer: 'outlook.body-content-type="text"' };
const MAX_ATTACHMENT = 20 * 1024 * 1024;
const MAX_EMAIL_ATTACHMENTS = 50 * 1024 * 1024;
const SYNC_EVERY = 30 * 60 * 1000;
const STALE = 2 * 60 * 1000;
const iso = d => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const month = () => P.romeDay().slice(0, 7);
const q1 = s => String(s).replace(/'/g, "''");
const FOLDER_ID = /^[A-Za-z0-9_\-=+\/.]{1,500}$/;
// Cartelle di Outlook che non servono nella Posta del CRM (bozze, posta in uscita, cronologia conversazioni…)
const HIDDEN_FOLDERS = new Set(['drafts', 'outbox', 'conversationhistory', 'syncissues', 'scheduled']);
const EMAIL_RE = /^[^\s"@]+@[^\s"@]+\.[^\s"@]+$/;

function registerCrmPosta(app, { db, auth, alerts, notifier, radarFetch, mailFake, energyAccess, energyAssign }) {
  const aiKey = () => process.env.OPENAI_API_KEY || '';
  const ai = () => ({ key: aiKey(), fetchImpl: radarFetch || fetch });
  const g = (t, method, path, opts) => (mailFake ? mailFake.graph(t, method, path, opts) : graph(t, method, path, opts));
  const token = async uid => (mailFake ? 'fake' : auth.graphToken(uid));
  // Spostare ed eliminare (ALM2-60) chiede Mail.ReadWrite, con il consenso amministratore in Entra: non sta nei permessi
  // dell'accesso, così se manca si ferma solo questo e non il login di tutti.
  async function writeToken(uid) {
    if (mailFake) return 'fake';
    try { return await auth.graphTokenFor(uid, ['Mail.ReadWrite']); } catch (err) {
      if (err.status === 403 || err.code === 'consent') throw new HttpError(403, 'Per spostare ed eliminare le email serve il permesso «Mail.ReadWrite» di Microsoft: un amministratore deve approvarlo in Entra per l’app Alma Planner, poi esci e rientra', 'mail_write');
      throw err;
    }
  }
  async function mail(t, method, path, opts) {
    try { return await g(t, method, path, opts); } catch (err) {
      if (err.status === 403) throw new HttpError(403, 'Per leggere la posta serve il permesso «Mail.Read» di Microsoft: chiedi all\'amministratore di approvarlo', 'mail_read');
      throw err;
    }
  }
  async function binary(t, path) {
    if (mailFake) return mailFake.graph(t, 'GET', path);
    const res = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) throw new HttpError(502, `Allegato non scaricato da Outlook (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  async function spend(eur) {
    if (!eur) return;
    await db.query('INSERT INTO crm_mail_spend (month, eur) VALUES ($1, $2) ON CONFLICT (month) DO UPDATE SET eur = crm_mail_spend.eur + EXCLUDED.eur', [month(), eur]).catch(() => {});
  }
  // colleghi: indirizzi e domini delle persone di Alma Space
  async function internalFn() {
    const { rows } = await db.query('SELECT id, name, email FROM users');
    const emails = new Map(rows.filter(u => u.email).map(u => [u.email.toLowerCase(), u]));
    const domains = new Set([...emails.keys()].map(e => e.split('@')[1]).filter(d => d && !S.isPersonal(d)));
    const fn = addr => { const a = String(addr || '').toLowerCase(); return emails.has(a) || domains.has(a.split('@')[1]); };
    fn.user = addr => emails.get(String(addr || '').toLowerCase()) || null;
    fn.users = rows;
    return fn;
  }
  async function conversation(t, convId) {
    const filter = `conversationId eq '${q1(convId)}'`;
    const data = await mail(t, 'GET', `/me/messages?$filter=${encodeURIComponent(filter)}&$select=${FULL}&$top=50`, { headers: TEXT });
    return (data.value || []).filter(m => !m.isDraft).map(P.normMsg).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  // dove sta già una conversazione (progetto o opportunità) e dove stanno già le email (progetti)
  async function placesOf(convIds, imids) {
    const [{ rows: th }, { rows: pe }, { rows: en }] = await Promise.all([
      db.query(`SELECT t.conversation_id, t.project_id, t.signal_id, p.name AS project_name, g.title AS signal_title
                  FROM crm_mail_threads t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN crm_signals g ON g.id = t.signal_id
                 WHERE t.conversation_id = ANY($1::text[])`, [convIds.filter(Boolean)]),
      db.query(`SELECT e.internet_message_id, p.id, p.name FROM project_emails e JOIN projects p ON p.id = e.project_id
                 WHERE e.internet_message_id = ANY($1::text[]) AND p.status <> 'archived'`, [imids.filter(Boolean)]),
      // ALM2-89: conversazioni già diventate un'opportunità di Alma Energy
      db.query(`SELECT t.conversation_id, o.id, o.title FROM energy_mail_threads t JOIN energy_opportunities o ON o.id = t.opportunity_id
                 WHERE t.conversation_id = ANY($1::text[]) ORDER BY t.id`, [convIds.filter(Boolean)]),
    ]);
    const energyOf = c => { const r = en.find(x => x.conversation_id === c); return r ? { energy: { id: r.id, title: r.title } } : null; };
    return {
      byConv: c => { const r = th.find(x => x.conversation_id === c && x.project_id) || th.find(x => x.conversation_id === c); return r ? (r.project_id ? { project: { id: r.project_id, name: r.project_name } } : { signal: { id: r.signal_id, title: r.signal_title } }) : energyOf(c); },
      byImid: i => { const r = pe.find(x => x.internet_message_id === i); return r ? { project: { id: r.id, name: r.name } } : null; },
    };
  }

  // ── privacy della posta (ALM2-67, tavole J–M) ─────────────────────────────────────────────────────
  // Le email di una persona le vede l'azienda solo dopo il suo sì: quelle che aspettano stanno in crm_mail_suggestions
  // (kind 'risposta' = della conversazione collegata, 'suggerita' = altra conversazione) e le vede e decide solo owner_id.
  const MODES = ['approva', 'auto'];
  async function prefsOf(uid) {
    const { rows: [r] } = await db.query('SELECT share_people, new_mode FROM user_mail_prefs WHERE user_id = $1', [uid]);
    return { share_people: Boolean(r?.share_people), new_mode: r?.new_mode || 'approva' };
  }
  // mette un'email della casella del proprietario fra quelle da approvare (o già scartata, status 'scartata');
  // niente se è già nel progetto o se c'è già (un «Non c'entra» resta tale)
  async function queue(projectId, ownerId, m, kind, why, status = 'nuova') {
    const { rowCount } = await db.query(
      `INSERT INTO crm_mail_suggestions (project_id, owner_id, internet_message_id, outlook_id, subject, from_name, from_address, sent_at, preview, why, kind, status, decided_at)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text, CASE WHEN $12::text = 'nuova' THEN NULL ELSE now() END
        WHERE NOT EXISTS (SELECT 1 FROM project_emails WHERE project_id = $1 AND internet_message_id = $3)
       ON CONFLICT (project_id, internet_message_id) DO NOTHING`,
      [projectId, ownerId, m.internet_message_id, m.id, String(m.subject || '').slice(0, 500), m.from?.name || '', m.from?.address || '', m.date || null, String(m.preview || '').slice(0, 300), why, kind, status]);
    return rowCount;
  }
  // campanella (e tab Avvisi sul telefono) al proprietario quando entrano email nuove da approvare
  async function notifyPending(ownerId, projectId, n, actorId = null) {
    if (!n || !notifier) return;
    const { rows: [p] } = await db.query('SELECT name FROM projects WHERE id = $1', [projectId]);
    await notifier.notify({ userIds: [ownerId], actorId, kind: 'crm', body: `${n === 1 ? 'Un\'email' : `${n} email`} della tua casella su «${p?.name || 'un progetto'}» ${n === 1 ? 'aspetta' : 'aspettano'} il tuo sì prima di entrare nel progetto`, link: '/crm/posta/approvare' })
      .catch(err => console.warn('[posta] avviso non mandato', err.message));
  }

  // ── Posta (tavola A) ─────────────────────────────────────────────────────────────────────────────
  app.get('/api/crm/posta', async (req, res) => {
    const c = String(req.query.cartella || '');
    const folder = c === 'inviate' ? 'sentitems' : !c || c === 'arrivo' ? 'inbox' : FOLDER_ID.test(c) ? encodeURIComponent(c) : 'inbox';
    const q = String(req.query.q || '').replace(/"/g, '').trim().slice(0, 200);
    const t = await token(req.user.id);
    const next = typeof req.query.next === 'string' ? req.query.next : '';
    let path;
    if (next) {
      if (!next.startsWith(`${GRAPH}/me/`)) throw new HttpError(400, 'Pagina non valida');
      path = next.slice(GRAPH.length);
    } else {
      const params = new URLSearchParams({ $select: SELECT, $top: String(PAGE) });
      if (q) params.set('$search', `"${q}"`); else params.set('$orderby', 'receivedDateTime desc');
      path = `/me/mailFolders/${folder}/messages?${params}`;
    }
    const data = await mail(t, 'GET', path);
    const items = (data.value || []).filter(m => !m.isDraft).map(P.normMsg);
    const where = await placesOf(items.map(m => m.conversation_id), items.map(m => m.internet_message_id));
    // quante email per conversazione (nella pagina) per dire «6 email»
    const per = new Map();
    for (const m of items) per.set(m.conversation_id, (per.get(m.conversation_id) || 0) + 1);
    res.json({
      messages: items.map(m => ({ id: m.id, conversation_id: m.conversation_id, subject: m.subject, from: m.from, to: m.to, date: m.date, preview: m.preview,
        has_attachments: m.has_attachments, folder_id: m.folder_id, in_page: per.get(m.conversation_id) || 1, ...(where.byConv(m.conversation_id) || where.byImid(m.internet_message_id) || {}) })),
      next: data['@odata.nextLink'] || null,
      pending: (await db.query("SELECT count(*)::int AS n FROM crm_mail_suggestions s JOIN projects p ON p.id = s.project_id WHERE s.owner_id = $1 AND s.status = 'nuova' AND p.status <> 'archived'", [req.user.id])).rows[0].n,
    });
  });

  // ── Da approvare (tavola J): le email della mia casella che aspettano il mio sì, per progetto ─────────
  app.get('/api/crm/posta/da-approvare', async (req, res) => {
    const me = req.user.id;
    const { rows } = await db.query(
      `SELECT s.id, s.project_id, p.name AS project_name, s.kind, s.subject, s.from_name, s.from_address, s.sent_at, s.preview, s.why
         FROM crm_mail_suggestions s JOIN projects p ON p.id = s.project_id
        WHERE s.owner_id = $1 AND s.status = 'nuova' AND p.status <> 'archived'
        ORDER BY p.name, s.sent_at DESC NULLS LAST`, [me]);
    const ids = [...new Set(rows.map(r => r.project_id))];
    const [{ rows: team }, { rows: modes }] = ids.length ? await Promise.all([
      db.query(`SELECT m.project_id, u.name FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ANY($1::int[])
                UNION SELECT p.id, u.name FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = ANY($1::int[])`, [ids]),
      db.query('SELECT project_id, new_mode FROM crm_mail_threads WHERE project_id = ANY($1::int[]) AND owner_id = $2', [ids, me]),
    ]) : [{ rows: [] }, { rows: [] }];
    res.json({
      projects: ids.map(id => ({
        id, name: rows.find(r => r.project_id === id).project_name,
        team: [...new Set(team.filter(t => t.project_id === id).map(t => t.name.split(' ')[0]))],
        new_mode: modes.find(m => m.project_id === id)?.new_mode || null,
        emails: rows.filter(r => r.project_id === id).map(({ project_id, project_name, ...r }) => r),
      })),
      total: rows.length,
    });
  });

  // ── La mia posta nel CRM (tavola L): scelte personali ed email che ho fatto entrare nei progetti ─────
  const myEmails = uid => db.query(
    `SELECT e.id, e.project_id, p.name AS project_name, e.subject, e.from_name, e.from_address, e.sent_at
       FROM project_emails e JOIN projects p ON p.id = e.project_id
      WHERE e.assigned_by = $1 AND p.crm_kind <> '' AND p.status <> 'archived' ORDER BY e.sent_at DESC NULLS LAST LIMIT 300`, [uid]);
  app.get('/api/posta/preferenze', async (req, res) => {
    const [prefs, { rows }] = await Promise.all([prefsOf(req.user.id), myEmails(req.user.id)]);
    res.json({ ...prefs, emails: rows, projects: new Set(rows.map(r => r.project_id)).size });
  });
  app.put('/api/posta/preferenze', async (req, res) => {
    const b = req.body || {};
    const before = await prefsOf(req.user.id);
    const next = {
      share_people: b.share_people === undefined ? before.share_people : Boolean(b.share_people),
      new_mode: b.new_mode === undefined ? before.new_mode : v.oneOf(b.new_mode, 'risposte nuove', MODES),
    };
    await db.query(`INSERT INTO user_mail_prefs (user_id, share_people, new_mode) VALUES ($1, $2, $3)
                    ON CONFLICT (user_id) DO UPDATE SET share_people = EXCLUDED.share_people, new_mode = EXCLUDED.new_mode, updated_at = now()`,
    [req.user.id, next.share_people, next.new_mode]);
    req.auditDetail = { label: 'Ha cambiato le scelte sulla sua posta nel CRM', target: 'La mia posta nel CRM',
      before: { condivide_con_chi_scrive: before.share_people, risposte_nuove: before.new_mode }, after: { condivide_con_chi_scrive: next.share_people, risposte_nuove: next.new_mode } };
    res.json(next);
  });

  // Cartelle di Outlook (ALM2-60): quelle di primo livello e le sottocartelle, fino a 3 livelli, per aprirle e spostarci le email.
  app.get('/api/crm/posta/cartelle', async (req, res) => {
    const t = await token(req.user.id);
    const sel = '$select=id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount&$top=100';
    const [top, ...wk] = await Promise.all([mail(t, 'GET', `/me/mailFolders?${sel}`),
      ...['inbox', 'sentitems', 'deleteditems', 'archive', 'junkemail', ...HIDDEN_FOLDERS].map(n => g(t, 'GET', `/me/mailFolders/${n}?$select=id`).then(r => [n, r.id]).catch(() => null))]);
    const known = new Map(wk.filter(Boolean).map(([n, id]) => [id, n]));
    const out = [];
    async function walk(list, depth, parent) {
      for (const f of list) {
        const wkName = known.get(f.id) || null;
        if (wkName && HIDDEN_FOLDERS.has(wkName)) continue;
        if (out.length >= 300) return;
        out.push({ id: f.id, name: f.displayName, parent, depth, well_known: wkName, total: f.totalItemCount || 0, unread: f.unreadItemCount || 0 });
        if (f.childFolderCount && depth < 2) {
          const kids = await mail(t, 'GET', `/me/mailFolders/${encodeURIComponent(f.id)}/childFolders?${sel}`).catch(() => ({ value: [] }));
          await walk((kids.value || []).sort((a, b) => a.displayName.localeCompare(b.displayName, 'it')), depth + 1, f.id);
        }
      }
    }
    const order = ['inbox', 'sentitems', 'archive', 'deleteditems', 'junkemail'];
    const rank = f => { const i = order.indexOf(known.get(f.id)); return i < 0 ? 99 : i; };
    await walk((top.value || []).sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName, 'it')), 0, null);
    res.json({ folders: out });
  });

  // Sposta in una cartella o elimina (= «Posta eliminata» di Outlook, recuperabile). Più email insieme.
  // Outlook dà un id nuovo all'email spostata: torna indietro l'id nuovo, per «Annulla».
  app.post('/api/crm/posta/sposta', async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 100).map(x => v.text(x, 'email', { max: 500, required: true })) : [];
    if (!ids.length) throw new HttpError(400, 'Nessuna email scelta');
    const del = req.body?.elimina === true;
    const dest = del ? 'deleteditems' : v.text(req.body?.cartella, 'cartella', { max: 500, required: true });
    if (!del && !FOLDER_ID.test(dest)) throw new HttpError(400, 'Cartella non valida');
    const t = await writeToken(req.user.id);
    const moved = [];
    const failed = [];
    for (const id of ids) {
      try {
        const r = await g(t, 'POST', `/me/messages/${encodeURIComponent(id)}/move`, { body: { destinationId: dest } });
        moved.push({ old_id: id, id: r?.id || id });
      } catch (err) {
        if (err.status === 403) throw new HttpError(403, 'Per spostare ed eliminare le email serve il permesso «Mail.ReadWrite» di Microsoft: un amministratore deve approvarlo in Entra per l’app Alma Planner, poi esci e rientra', 'mail_write');
        failed.push({ id, error: err.message });
      }
    }
    res.json({ moved, failed });
  });

  // ── Riassunto e bozza col tuo tono (ALM2-61, tavola G) ──────────────────────────────────────────
  async function messageAndThread(t, id) {
    const m = P.normMsg(await mail(t, 'GET', `/me/messages/${encodeURIComponent(id)}?$select=${FULL}`, { headers: TEXT }));
    const conv = m.conversation_id ? await conversation(t, m.conversation_id).catch(() => [m]) : [m];
    return { m, conv: conv.length ? conv : [m] };
  }
  // Le ultime email mandate a quella persona (Posta inviata): servono solo qui, non si salvano.
  async function sentTo(t, address) {
    const params = new URLSearchParams({ $search: `"to:${address.replace(/"/g, '')}"`, $top: '10', $select: 'body,toRecipients,sentDateTime,subject' });
    const data = await mail(t, 'GET', `/me/mailFolders/sentitems/messages?${params}`, { headers: TEXT }).catch(() => ({ value: [] }));
    return (data.value || []).filter(x => (x.toRecipients || []).some(r => r.emailAddress?.address?.toLowerCase() === address))
      .sort((a, b) => String(b.sentDateTime).localeCompare(String(a.sentDateTime))).map(x => String(x.body?.content || ''));
  }

  app.post('/api/crm/posta/:id/riassunto', async (req, res) => {
    const id = v.text(req.params.id, 'email', { max: 500, required: true });
    const t = await token(req.user.id);
    const { conv } = await messageAndThread(t, id);
    const r = await A.summarize(conv, { ...ai(), me: req.user.email, meName: req.user.name });
    await spend(r.eur);
    res.json({ ...r, emails: conv.length, words: conv.reduce((s, x) => s + (String(x.body || '').match(/\S+/g) || []).length, 0) });
  });

  // Rispondi / Rispondi a tutti (Dante 22/11, «come su Outlook»): sempre all'email aperta. A chi: chi l'ha scritta (se
  // l'ho scritta io, il primo destinatario); a tutti = anche destinatari e copie, senza di me.
  function recipients(m, me, tutti) {
    const target = m.from.address !== me ? m.from : (m.to[0] || m.from);
    const all = [...new Map([m.from, ...m.to, ...m.cc].filter(p => p.address && p.address !== me).map(p => [p.address, p])).values()];
    return { target, to: tutti ? all : [target] };
  }

  app.post('/api/crm/posta/:id/bozza', async (req, res, next) => {
    if (req.params.id === 'nuova') return next(); // /api/crm/posta/nuova/bozza è più sotto
    const id = v.text(req.params.id, 'email', { max: 500, required: true });
    const istruzione = v.text(req.body?.istruzione, 'istruzione', { max: 600 }) || '';
    const indicazioni = v.text(req.body?.indicazioni, 'indicazioni', { max: 4000 }) || '';
    const lingua = ['it', 'en', 'auto'].includes(req.body?.lingua) ? req.body.lingua : 'auto';
    const stile = Object.hasOwn(A.STILI, req.body?.stile) ? req.body.stile : '';
    const attuale = v.text(req.body?.attuale, 'bozza', { max: 8000 }) || '';
    const tutti = req.body?.tutti !== false;
    const t = await token(req.user.id);
    const { m, conv } = await messageAndThread(t, id);
    const me = String(req.user.email || '').toLowerCase();
    const { target, to } = recipients(m, me, tutti);
    const samples = target?.address ? await sentTo(t, target.address) : [];
    const tone = A.toneOf(samples, { name: target?.name });
    const r = await A.toneDraft({ messages: conv, reply: m, tutti, target, tone, samples: samples.map(x => S.ownPart(x)).slice(0, 6), meName: req.user.name, me, istruzione, indicazioni, lingua, stile, attuale }, ai());
    await spend(r.eur);
    res.json({ text: r.text, eur: r.eur, ai: r.ai, model: r.model, tone: { n: tone.n, chips: tone.chips }, target, to, tutti, subject: `Re: ${A.subjectOf(m.subject)}` });
  });

  // ── Rispondi, Rispondi a tutti, Inoltra con A/Cc, allegati e firma Almacis (ALM2-64, tavola H) ──────
  const graphMe = uid => (mailFake ? null : async () => g(await token(uid), 'GET', '/me?$select=displayName,jobTitle,mobilePhone,businessPhones'));
  const upload = (url, buf) => (mailFake ? mailFake.upload(url, buf) : I.uploadChunks(url, buf));
  async function sendFrom(req, id, { mode, to, cc, bcc = [], subject = '', text, html = '', attachments = [], drop = [], firma = true, draft = false }) {
    const signature = firma ? await F.signatureOf({ db, userId: req.user.id, graphMe: graphMe(req.user.id) }) : null;
    const t = await writeToken(req.user.id);
    try {
      return await I.compose({ g, upload, t, id, mode, to, cc, bcc, subject, text, html, attachments, drop, signature: signature?.enabled ? signature : null, draft });
    } catch (err) {
      if (err.status === 403) throw new HttpError(403, 'Per mandare con firma e allegati serve il permesso «Mail.ReadWrite» di Microsoft: esci e rientra in Alma Space', 'mail_write');
      throw err;
    }
  }

  // Compatibile con la prima versione (ALM2-61): risposta senza scegliere A/Cc né allegati
  app.post('/api/crm/posta/:id/rispondi', async (req, res) => {
    const id = v.text(req.params.id, 'email', { max: 500, required: true });
    const text = v.text(req.body?.testo, 'testo', { max: 20000, required: true });
    const tutti = req.body?.tutti !== false;
    const me = String(req.user.email || '').toLowerCase();
    const m = P.normMsg(await mail(await token(req.user.id), 'GET', `/me/messages/${encodeURIComponent(id)}?$select=${SELECT}`));
    const { to } = recipients(m, me, tutti);
    if (!to.length) throw new HttpError(400, 'Non c\'è nessuno a cui rispondere');
    const ccSet = tutti ? m.cc.filter(c => c.address !== me) : [];
    const r = await sendFrom(req, id, { mode: tutti ? 'tutti' : 'rispondi', to: to.filter(p => !ccSet.some(c => c.address === p.address)), cc: ccSet, text, draft: req.body?.bozza === true });
    res.json({ ok: true, draft: r.draft, to, web_link: r.web_link || null });
  });

  // Il riquadro completo: modo, A, Cc, testo, allegati nuovi, allegati originali da togliere (inoltra), firma sì/no
  app.post('/api/crm/posta/:id/componi', async (req, res) => {
    const id = v.text(req.params.id, 'email', { max: 500, required: true });
    const b = req.body || {};
    const mode = Object.hasOwn(I.MODES, b.modo) ? b.modo : null;
    if (!mode) throw new HttpError(400, 'Modo non valido: rispondi, tutti o inoltra');
    if (mode === 'nuova') throw new HttpError(400, 'L\'email nuova parte da /api/crm/posta/nuova');
    const to = I.people(b.a);
    const cc = I.people(b.cc).filter(p => !to.some(x => x.address === p.address));
    const bcc = I.people(b.ccn).filter(p => ![...to, ...cc].some(x => x.address === p.address));
    const text = typeof b.testo === 'string' ? b.testo.slice(0, 20000) : '';
    const html = typeof b.html === 'string' ? b.html.slice(0, 200000) : '';
    const subject = typeof b.oggetto === 'string' ? b.oggetto.trim().slice(0, 250) : '';
    const r = await sendFrom(req, id, { mode, to, cc, bcc, subject, text, html, attachments: I.files(b.allegati), drop: (Array.isArray(b.togli) ? b.togli : []).map(String).slice(0, 50), firma: b.firma !== false, draft: b.bozza === true });
    res.json({ ok: true, draft: r.draft, to, cc, web_link: r.web_link || null });
  });

  // Email nuova (ALM2-68, tavola N): A/Cc/Ccn, oggetto, testo (HTML dell'editor), allegati, firma; manda o bozza
  app.post('/api/crm/posta/nuova', async (req, res) => {
    const b = req.body || {};
    const to = I.people(b.a);
    const cc = I.people(b.cc).filter(p => !to.some(x => x.address === p.address));
    const bcc = I.people(b.ccn).filter(p => ![...to, ...cc].some(x => x.address === p.address));
    const r = await sendFrom(req, null, { mode: 'nuova', to, cc, bcc, subject: String(b.oggetto || '').trim().slice(0, 250),
      text: typeof b.testo === 'string' ? b.testo.slice(0, 20000) : '', html: typeof b.html === 'string' ? b.html.slice(0, 200000) : '',
      attachments: I.files(b.allegati), firma: b.firma !== false, draft: b.bozza === true });
    res.json({ ok: true, draft: r.draft, to, cc, web_link: r.web_link || null });
  });

  // Bozza di Alma per un'email nuova: le indicazioni, il tono che usi con il primo destinatario, la lingua
  app.post('/api/crm/posta/nuova/bozza', async (req, res) => {
    const b = req.body || {};
    const to = I.people(b.a);
    const indicazioni = v.text(b.indicazioni, 'indicazioni', { max: 4000 }) || '';
    if (!indicazioni.trim() && !b.attuale) throw new HttpError(400, 'Scrivi cosa vuoi dire: Alma parte dalle tue indicazioni');
    const lingua = ['it', 'en'].includes(b.lingua) ? b.lingua : 'it';
    const stile = Object.hasOwn(A.STILI, b.stile) ? b.stile : '';
    const t = await token(req.user.id);
    const target = to[0] || null;
    const samples = target ? await sentTo(t, target.address) : [];
    const tone = A.toneOf(samples, { name: target?.name });
    const r = await A.toneDraft({ messages: [], reply: null, target, tone, samples: samples.map(x => S.ownPart(x)).slice(0, 6), meName: req.user.name, me: req.user.email,
      indicazioni, lingua, stile, attuale: v.text(b.attuale, 'bozza', { max: 8000 }) || '', oggetto: v.text(b.oggetto, 'oggetto', { max: 250 }) || '' }, ai());
    await spend(r.eur);
    res.json({ text: r.text, eur: r.eur, ai: r.ai, model: r.model, tone: { n: tone.n, chips: tone.chips }, target });
  });

  // A e Cc: colleghi di Alma Space e contatti del CRM con l'email
  app.get('/api/crm/posta/destinatari', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q.length < 2) return res.json({ people: [] });
    const like = `%${q.toLowerCase()}%`;
    const [{ rows: us }, { rows: cs }] = await Promise.all([
      db.query(`SELECT name, email FROM users WHERE email IS NOT NULL AND (lower(name) LIKE $1 OR lower(email) LIKE $1) ORDER BY name LIMIT 8`, [like]),
      db.query(`SELECT c.first_name, c.last_name, c.email, s.name AS company
                  FROM crm_contacts c
                  LEFT JOIN LATERAL (SELECT sb.name FROM crm_contact_links l JOIN crm_subjects sb ON sb.id = l.subject_id WHERE l.contact_id = c.id ORDER BY l.id DESC LIMIT 1) s ON true
                 WHERE c.email <> '' AND (lower(c.first_name || ' ' || c.last_name) LIKE $1 OR lower(c.last_name || ' ' || c.first_name) LIKE $1 OR lower(c.email) LIKE $1)
                 ORDER BY c.last_name LIMIT 8`, [like]),
    ]);
    const out = [...us.map(u => ({ name: u.name, address: u.email.toLowerCase(), kind: 'collega' })),
      ...cs.map(c => ({ name: `${c.first_name} ${c.last_name}`.trim(), address: c.email.toLowerCase(), kind: 'contatto', company: c.company || '' }))];
    res.json({ people: out.filter((p, i, a) => a.findIndex(x => x.address === p.address) === i).slice(0, 12) });
  });

  // La mia firma (pagina #/firma e «Modifica» nel riquadro)
  app.get('/api/firma', async (req, res) => {
    const sig = await F.signatureOf({ db, userId: req.user.id, graphMe: graphMe(req.user.id) });
    res.json({ ...sig, company: F.COMPANY, html: F.html(sig, { logoSrc: '/brand/almacis/almacis-logo.png' }) });
  });
  app.put('/api/firma', async (req, res) => {
    const b = req.body || {};
    const cur = await F.signatureOf({ db, userId: req.user.id, graphMe: graphMe(req.user.id) });
    const val = (k, max) => (b[k] === undefined ? cur[k] : v.text(b[k], k, { max }) || '');
    const row = { enabled: b.enabled === undefined ? cur.enabled : b.enabled !== false, name: val('name', 120), role: val('role', 120), phone: val('phone', 40), phone2: val('phone2', 40) };
    if (!row.name) throw new HttpError(400, 'Serve il nome');
    await db.query(`INSERT INTO user_signatures (user_id, enabled, name, role, phone, phone2) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, name = EXCLUDED.name, role = EXCLUDED.role, phone = EXCLUDED.phone, phone2 = EXCLUDED.phone2, updated_at = now()`,
    [req.user.id, row.enabled, row.name, row.role, row.phone, row.phone2]);
    const sig = await F.signatureOf({ db, userId: req.user.id });
    res.json({ ...sig, company: F.COMPANY, html: F.html(sig, { logoSrc: '/brand/almacis/almacis-logo.png' }) });
  });
  // Ripristina dal profilo Microsoft
  app.delete('/api/firma', async (req, res) => {
    await db.query('DELETE FROM user_signatures WHERE user_id = $1', [req.user.id]);
    const sig = await F.signatureOf({ db, userId: req.user.id, graphMe: graphMe(req.user.id) });
    res.json({ ...sig, company: F.COMPANY, html: F.html(sig, { logoSrc: '/brand/almacis/almacis-logo.png' }) });
  });

  app.get('/api/crm/posta/:id', async (req, res) => {
    const id = v.text(req.params.id, 'email', { max: 500, required: true });
    const t = await token(req.user.id);
    const m = P.normMsg(await mail(t, 'GET', `/me/messages/${encodeURIComponent(id)}?$select=${FULL}`, { headers: TEXT }));
    let attachments = [];
    if (m.has_attachments) {
      const list = await mail(t, 'GET', `/me/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline`).catch(() => ({ value: [] }));
      attachments = (list.value || []).filter(a => !a.isInline).map(a => ({ name: a.name, size: a.size }));
    }
    const conv = m.conversation_id ? await conversation(t, m.conversation_id).catch(() => [m]) : [m];
    const where = await placesOf([m.conversation_id], conv.map(x => x.internet_message_id));
    const place = where.byConv(m.conversation_id) || conv.map(x => where.byImid(x.internet_message_id)).find(Boolean) || {};
    res.json({ ...m, attachments, conversation_count: conv.length, ...place, crm: await fromMail(conv, req.user.email, place) });
  });

  // «Dalla email» (ALM2-58, tavola F): persone, azienda e opportunità dell'email, e cosa c'è già nel CRM.
  // Solo regole (firma, dominio, testo): niente AI finché non si apre «Aggiungi opportunità».
  async function fromMail(conv, myEmail, place) {
    const internal = await internalFn();
    const seen = new Map();
    const rank = { 'ha scritto': 3, destinatario: 2, 'in copia': 1 };
    const add = (pp, role) => {
      if (!pp.address || pp.address === String(myEmail || '').toLowerCase() || S.isAuto(pp.address) || internal(pp.address)) return;
      const cur = seen.get(pp.address);
      if (!cur) seen.set(pp.address, { email: pp.address, name: pp.name, role });
      else { if (rank[role] > rank[cur.role]) cur.role = role; if (!cur.name && pp.name) cur.name = pp.name; }
    };
    for (const x of conv) { add(x.from, 'ha scritto'); x.to.forEach(y => add(y, 'destinatario')); x.cc.forEach(y => add(y, 'in copia')); }
    const list = [...seen.values()];
    const { rows: known } = list.length ? await db.query(
      `SELECT c.id, lower(c.email) AS email, trim(concat_ws(' ', c.title, c.first_name, c.last_name)) AS name,
              (SELECT json_build_object('id', s.id, 'name', s.name, 'job', l.job) FROM crm_contact_links l JOIN crm_subjects s ON s.id = l.subject_id
                WHERE l.contact_id = c.id AND l.date_to IS NULL ORDER BY l.is_primary DESC, l.id LIMIT 1) AS subject
         FROM crm_contacts c WHERE lower(c.email) = ANY($1::text[])`, [list.map(p => p.email)]) : { rows: [] };
    const byDomain = await S.subjectsByDomain(db, list.map(p => S.domainOf(p.email)));
    const people = list.map(p => {
      const c = known.find(k => k.email === p.email);
      const last = conv.slice().reverse().find(x => x.from.address === p.email);
      const sig = last ? S.fromSignature(last.body, { name: p.name, email: p.email }) : {};
      return c ? { ...p, kind: 'crm', contact_id: c.id, name: c.name, job: c.subject?.job || sig.job || '', subject: c.subject?.name || '' }
        : { ...p, kind: 'nuova', name: [sig.first_name, sig.last_name].filter(Boolean).join(' ') || p.name || p.email, job: sig.job || '', company_hint: (sig.company || '').replace(/\s*·.*$/, ''), city: sig.city || '' };
    }).sort((a, b) => rank[b.role] - rank[a.role]);
    // azienda: dal dominio di chi ha scritto (nel CRM) o dalla firma (nuova)
    const lead = people.find(p => p.role === 'ha scritto') || people[0];
    let company = null;
    if (lead) {
      const c = S.companyOf(lead.email, byDomain);
      if (c.kind === 'crm') company = { kind: 'crm', subject_id: c.subject_id, name: c.name, domain: c.domain };
      else if (c.kind === 'nuova') company = { kind: 'nuova', name: (lead.company_hint || c.name).slice(0, 200), domain: c.domain, city: lead.city || '' };
      else company = { kind: 'personale', domain: c.domain };
    }
    // opportunità: già nel Radar o in un progetto, altrimenti quella che si legge dal testo
    const asaList = (await db.query('SELECT key, label FROM crm_asa ORDER BY sort, label')).rows;
    const guess = P.heuristicExtract(conv, { internal, asaList: [] });
    const opportunity = place.project ? { project: place.project } : place.signal ? { signal: place.signal }
      : { title: guess.title, importo: guess.importo, scadenza: guess.scadenza, tipo: guess.tipo };
    return { people, company, opportunity, asa: asaList };
  }

  // ── legami nel CRM (tavola B a destra, tavola D «Legami nel CRM») ──────────────────────────────────
  async function legami({ subjectIds = [], emails = [], themes = [], excludeProject = null, excludeSignal = null, me = null }) {
    const out = [];
    const ids = [...new Set(subjectIds.filter(Boolean).map(Number))];
    const likes = themes.filter(w => w && w.length >= 4).slice(0, 6).map(w => `%${w}%`);
    if (ids.length) {
      const [{ rows: projs }, { rows: outs }, { rows: subs }] = await Promise.all([
        db.query(`SELECT DISTINCT p.id, p.name, p.status, l.subject_id FROM crm_project_links l JOIN projects p ON p.id = l.project_id
                   WHERE l.subject_id = ANY($1::int[]) AND p.id IS DISTINCT FROM $2 ORDER BY p.id DESC LIMIT 6`, [ids, excludeProject]),
        db.query(`SELECT title, result, reason, decided_on, our_discount, winner_discount, subject_id FROM crm_outcomes WHERE subject_id = ANY($1::int[]) ORDER BY decided_on DESC LIMIT 4`, [ids]),
        db.query('SELECT id, name FROM crm_subjects WHERE id = ANY($1::int[])', [ids]),
      ]);
      for (const s of subs) {
        const ps = projs.filter(p => p.subject_id === s.id);
        const os = outs.filter(o => o.subject_id === s.id);
        if (!ps.length && !os.length) continue;
        const txt = [
          ...os.map(o => `${o.title}: ${o.result === 'vinta' ? 'vinta' : o.result === 'persa' ? `persa${o.reason ? ` (${o.reason})` : ''}${o.our_discount != null && o.winner_discount != null ? `, ${Number(o.winner_discount) - Number(o.our_discount) > 0 ? '−' : ''}${Math.abs(Number(o.winner_discount) - Number(o.our_discount)).toLocaleString('it-IT')}% dal primo` : ''}` : 'non partecipato'} nel ${String(o.decided_on).slice(0, 4)}`),
          ...ps.filter(p => !os.some(o => o.title === p.name)).map(p => `${p.name}: ${p.status === 'active' ? 'in corso' : p.status === 'done' ? 'chiuso' : p.status}`)];
        out.push({ kind: 'azienda', title: `${s.name} in ${ps.length + os.length} ${ps.length + os.length === 1 ? 'progetto' : 'progetti'}`, text: txt.join('. '), link: `#/crm/scheda/${s.id}`, link_label: 'Apri l\'azienda' });
        const lostPrice = os.find(o => o.result === 'persa' && /prezz|ribass|economic/i.test(o.reason || ''));
        if (lostPrice) out.push({ kind: 'attenzione', title: 'Da guardare', text: `Nell'offerta «${lostPrice.title}» con ${s.name} il prezzo ha deciso: mettere l'ufficio gare in squadra da subito.` });
      }
    }
    if (likes.length) {
      const [{ rows: sigs }, { rows: inits }, { rows: sim }, { rows: [anac] }] = await Promise.all([
        db.query(`SELECT id, title, status, published_on, project_id FROM crm_signals WHERE id IS DISTINCT FROM $2 AND source <> 'email' AND status NOT IN ('scartato', 'gara_scartata')
                   AND (lower(title) LIKE ANY($1::text[]) OR lower(summary) LIKE ANY($1::text[])) ORDER BY created_at DESC LIMIT 3`, [likes, excludeSignal]),
        db.query(`SELECT id, name, phase FROM crm_initiatives WHERE lower(name) LIKE ANY($1::text[]) OR lower(COALESCE(description, '')) LIKE ANY($1::text[]) ORDER BY id DESC LIMIT 2`, [likes]),
        db.query(`SELECT id, name, status, crm_kind FROM projects WHERE crm_kind <> '' AND id IS DISTINCT FROM $2 AND lower(name) LIKE ANY($1::text[]) ORDER BY id DESC LIMIT 3`, [likes, excludeProject]),
        db.query(`SELECT count(*)::int AS n, count(DISTINCT region)::int AS regions,
                         (SELECT string_agg(DISTINCT w->>'name', ', ') FROM (SELECT winners FROM crm_anac_awards WHERE lower(object) LIKE ANY($1::text[]) AND awarded_on >= now() - interval '24 months' LIMIT 20) a, jsonb_array_elements(a.winners) w) AS winners
                    FROM crm_anac_awards WHERE lower(object) LIKE ANY($1::text[]) AND awarded_on >= now() - interval '24 months'`, [likes]).catch(() => ({ rows: [{ n: 0 }] })),
      ]);
      for (const s of sigs) out.push({ kind: 'radar', title: 'Nel Radar: stesso tema', text: `«${s.title}»${s.published_on ? ` · ${new Date(s.published_on).toLocaleDateString('it-IT')}` : ''}, ${s.project_id ? 'già in un progetto' : s.status === 'interessa' ? 'interessa' : 'stato Nuovo'}.${s.project_id ? '' : ' Si collega a questo progetto e passa a «in corso».'}`, signal_id: s.project_id ? null : s.id, link: '#/crm/radar', link_label: 'Apri il Radar' });
      const simil = [
        ...inits.map(i => `Nuovi business: iniziativa «${i.name}», ${i.phase}`),
        ...sim.map(p => `Progetto «${p.name}» (${p.status === 'active' ? 'in corso' : p.status === 'done' ? 'chiuso' : p.status})`),
        anac?.n ? `Gare ANAC sullo stesso tema: ${anac.n} in 24 mesi${anac.winners ? `, vinte da ${anac.winners.split(', ').slice(0, 3).join(', ')}` : ''}` : null].filter(Boolean);
      if (simil.length) out.push({ kind: 'simili', title: 'Progetti simili', text: `${simil.join('. ')}.` });
    }
    // chi di noi conosce le persone: email scambiate (Persone con cui mi scrivo) e relazioni con le aziende
    const ext = [...new Set(emails.map(e => String(e).toLowerCase()))].slice(0, 20);
    const know = [];
    if (ext.length) {
      // ALM2-67: i colleghi compaiono solo se hanno acceso «Mostra ai colleghi con chi scrivo»; per sé sempre
      const { rows } = await db.query(`SELECT u.id, u.name, p.email, p.name AS who, p.received + p.sent AS n FROM crm_mail_people p JOIN users u ON u.id = p.user_id
                                        LEFT JOIN user_mail_prefs mp ON mp.user_id = p.user_id
                                        WHERE p.email = ANY($1::text[]) AND (p.received + p.sent) >= 3 AND (p.user_id = $2 OR mp.share_people)
                                        ORDER BY n DESC LIMIT 6`, [ext, Number(me) || 0]);
      for (const r of rows) know.push(`${r.name}${r.id === me ? ' (tu)' : ''} scrive con ${r.who || r.email} (${r.n} email)`);
    }
    if (ids.length) {
      const settings = await loadSettings(db);
      const rel = await relationsFor(db, ids, settings.relazioni);
      for (const sid of ids) for (const pth of pathsOf(rel[sid]).slice(0, 2)) if (!know.some(k => k.startsWith(pth.us.name))) know.push(`${pth.us.name} conosce ${pth.contact}${pth.job ? ` (${pth.job})` : ''}, rapporto ${pth.level || 'debole'}`);
    }
    if (know.length) out.splice(out.findIndex(x => x.kind === 'simili') >= 0 ? out.findIndex(x => x.kind === 'simili') : out.length, 0, { kind: 'conosce', title: 'Chi conosce le persone', text: `${know.slice(0, 3).join('. ')}.` });
    return out;
  }

  // ── Proposta (tavola B) ──────────────────────────────────────────────────────────────────────────
  async function asaList() {
    const [{ rows }, settings] = await Promise.all([db.query('SELECT key, label FROM crm_asa ORDER BY sort, label'), loadSettings(db)]);
    return rows.map(a => ({ ...a, keywords: settings.profiles[a.key]?.keywords || [], works: settings.profiles[a.key]?.works || [] }));
  }
  app.post('/api/crm/posta/proposta', async (req, res) => {
    const uid = req.user.id;
    const t = await token(uid);
    // dalla scheda di un contatto o di un'azienda arriva l'id internet dell'email: la si cerca nella propria casella
    let id = req.body?.message_id ? v.text(req.body.message_id, 'email', { max: 500, required: true }) : null;
    if (!id && req.body?.internet_message_id) {
      const imid = v.text(req.body.internet_message_id, 'email', { max: 1000, required: true });
      const found = await mail(t, 'GET', `/me/messages?$filter=${encodeURIComponent(`internetMessageId eq '${q1(imid)}'`)}&$select=id&$top=1`);
      id = (found.value || [])[0]?.id || null;
      if (!id) throw new HttpError(404, 'Questa email non è nella tua casella: la può trasformare in progetto chi l\'ha ricevuta');
    }
    if (!id) throw new HttpError(400, 'Scegli un\'email');
    const first = P.normMsg(await mail(t, 'GET', `/me/messages/${encodeURIComponent(id)}?$select=${FULL}`, { headers: TEXT }));
    const msgs = first.conversation_id ? await conversation(t, first.conversation_id) : [first];
    if (!msgs.some(m => m.id === first.id)) msgs.push(first);
    const { rows: [thread] } = await db.query('SELECT signal_id, project_id FROM crm_mail_threads WHERE conversation_id = $1 ORDER BY project_id NULLS LAST LIMIT 1', [first.conversation_id]);
    if (thread) return res.json({ already: thread.project_id ? { project_id: thread.project_id } : { signal_id: thread.signal_id } });
    const internal = await internalFn();
    const asas = await asaList();
    const { fields, eur } = await P.extract(msgs, { ...ai(), asaList: asas, internal, today: P.romeDay() });
    await spend(eur);

    // persone: chi ha scritto, destinatari e copia (io fuori; colleghi → squadra; esterni → CRM o nuovi dalla firma)
    const seen = new Map();
    const add = (pp, role) => {
      if (!pp.address || pp.address === String(req.user.email || '').toLowerCase() || S.isAuto(pp.address)) return;
      const cur = seen.get(pp.address);
      const rank = { 'ha scritto': 3, 'in copia': 1, destinatario: 2 };
      if (!cur) seen.set(pp.address, { email: pp.address, name: pp.name, role });
      else { if (rank[role] > rank[cur.role]) cur.role = role; if (!cur.name && pp.name) cur.name = pp.name; }
    };
    for (const m of msgs) { add(m.from, 'ha scritto'); m.to.forEach(x => add(x, 'destinatario')); m.cc.forEach(x => add(x, 'in copia')); }
    const list = [...seen.values()];
    const { rows: known } = list.length ? await db.query(
      `SELECT c.id, lower(c.email) AS email, trim(concat_ws(' ', c.title, c.first_name, c.last_name)) AS name,
              (SELECT json_build_object('id', s.id, 'name', s.name, 'job', l.job) FROM crm_contact_links l JOIN crm_subjects s ON s.id = l.subject_id
                WHERE l.contact_id = c.id AND l.date_to IS NULL ORDER BY l.is_primary DESC, l.id LIMIT 1) AS subject
         FROM crm_contacts c WHERE lower(c.email) = ANY($1::text[])`, [list.map(p => p.email)]) : { rows: [] };
    const byDomain = await S.subjectsByDomain(db, list.map(p => S.domainOf(p.email)));
    const people = list.map(p => {
      const colleague = internal.user(p.email);
      if (colleague) return { ...p, kind: 'collega', user_id: colleague.id, name: colleague.name, on: true };
      if (internal(p.email)) return null;
      const c = known.find(k => k.email === p.email);
      if (c) return { ...p, kind: 'crm', contact_id: c.id, name: c.name, job: c.subject?.job || '', subject: c.subject?.name || '', subject_id: c.subject?.id || null, on: true };
      const last = msgs.slice().reverse().find(m => m.from.address === p.email);
      const sig = last ? S.fromSignature(last.body, { name: p.name, email: p.email }) : {};
      const nm = [sig.first_name, sig.last_name].filter(Boolean).join(' ') || p.name || p.email;
      return { ...p, kind: 'nuova', name: nm, title: sig.title || '', first_name: sig.first_name || '', last_name: sig.last_name || p.name || p.email.split('@')[0],
        job: sig.job || '', mobile: sig.mobile || '', phone: sig.phone || '', company_hint: sig.company || '', company: S.companyOf(p.email, byDomain), on: !S.isPersonal(S.domainOf(p.email)) || p.role === 'ha scritto' };
    }).filter(Boolean).sort((a, b) => ({ 'ha scritto': 0, destinatario: 1, 'in copia': 2 }[a.role] - { 'ha scritto': 0, destinatario: 1, 'in copia': 2 }[b.role]) || (a.kind === 'collega') - (b.kind === 'collega'));

    // azienda: quella del primo esterno che ha scritto (nel CRM per dominio, altrimenti nuova dalla firma)
    const lead = people.find(p => p.kind !== 'collega' && p.role === 'ha scritto') || people.find(p => p.kind !== 'collega');
    let company = null;
    if (lead) {
      const c = S.companyOf(lead.email, byDomain);
      if (lead.subject_id) company = { kind: 'crm', subject_id: lead.subject_id, name: lead.subject };
      else if (c.kind === 'crm') company = { kind: 'crm', subject_id: c.subject_id, name: c.name };
      else if (c.kind === 'nuova') company = { kind: 'nuova', name: (lead.company_hint || c.name).replace(/\s*·.*$/, '').slice(0, 200), domain: c.domain };
    }
    const options = [...new Map(people.filter(p => p.subject_id).map(p => [p.subject_id, { subject_id: p.subject_id, name: p.subject }])).values()];
    for (const [, s] of byDomain) if (!options.some(o => o.subject_id === s.id)) options.push({ subject_id: s.id, name: s.name });

    // altre email delle persone che hanno scritto che parlano dello stesso tema (non della conversazione)
    const extra = [];
    for (const p of people.filter(x => x.kind !== 'collega' && x.role === 'ha scritto').slice(0, 2)) {
      const data = await mail(t, 'GET', `/me/messages?$search=${encodeURIComponent(`"from:${p.email}"`)}&$select=${SELECT}&$top=25`).catch(() => ({ value: [] }));
      for (const m of (data.value || []).map(P.normMsg)) {
        if (m.conversation_id === first.conversation_id || extra.some(x => x.id === m.id)) continue;
        const hits = P.talksAbout(m, fields.temi);
        if (hits) extra.push({ id: m.id, subject: m.subject, date: m.date, from: m.from, why: `parla di ${hits.slice(0, 2).join(', ')}` });
      }
    }
    const atts = [];
    for (const m of msgs.filter(x => x.has_attachments)) {
      const l = await mail(t, 'GET', `/me/messages/${encodeURIComponent(m.id)}/attachments?$select=id,name,size,isInline`).catch(() => ({ value: [] }));
      for (const a of l.value || []) if (!a.isInline) atts.push(a.name);
    }
    const insights = await legami({ subjectIds: [company?.subject_id, ...people.map(p => p.subject_id)], emails: people.filter(p => p.kind !== 'collega').map(p => p.email), themes: fields.temi, me: uid });
    res.json({
      conversation_id: first.conversation_id, message_id: first.id, subject: P.baseSubject(first.subject),
      messages: msgs.map(m => ({ id: m.id, date: m.date, from: m.from, subject: m.subject })), attachments: atts,
      fields, asa: asas.map(a => ({ key: a.key, label: a.label })), company, company_options: options, people, extra: extra.slice(0, 5), insights,
      new_mode: (await prefsOf(uid)).new_mode, // ALM2-67: scelta già pronta per le risposte nuove
    });
  });

  // ── Creazione: opportunità del Radar con la conversazione (poi la sala di lancio) ─────────────────
  app.post('/api/crm/posta/crea', async (req, res) => {
    const b = req.body || {};
    const uid = req.user.id;
    const convId = v.text(b.conversation_id, 'conversazione', { max: 500, required: true });
    const f = b.fields || {};
    const title = v.text(f.title, 'titolo', { max: 200, required: true });
    const asas = (await db.query('SELECT key FROM crm_asa')).rows.map(r => r.key);
    const bu = asas.includes(f.bu) ? f.bu : null;
    const tipo = f.tipo === 'gara' ? 'gara' : f.tipo === 'settore' ? 'settore' : 'trattativa';
    const concept = {
      cosa: v.text(f.cosa, 'cosa', { max: 400 }) || '', dove: v.text(f.dove, 'dove', { max: 200 }) || '', per_chi: v.text(f.per_chi, 'per chi', { max: 200 }) || '',
      importo_testo: v.text(f.importo_testo, 'importo', { max: 100 }) || '', tempi: v.text(f.tempi, 'tempi', { max: 400 }) || '',
      prossimo_passo: v.text(f.prossimo_passo, 'prossimo passo', { max: 300 }) || '', tipo, committente: v.text(f.committente, 'committente', { max: 200 }) || '',
      temi: (Array.isArray(f.temi) ? f.temi : []).map(x => String(x).toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 6),
      extra_ids: (Array.isArray(b.extra_ids) ? b.extra_ids : []).map(x => String(x).slice(0, 500)).slice(0, 10),
      // ALM2-67: email della conversazione che il proprietario ha tolto (non entrano, nemmeno dopo)
      skip_ids: (Array.isArray(b.skip_ids) ? b.skip_ids : []).map(x => String(x).slice(0, 500)).slice(0, 50),
      link_signal_ids: (Array.isArray(b.link_signal_ids) ? b.link_signal_ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 5),
      from_email: true,
    };
    const amount = Number(f.importo) > 0 ? Math.round(Number(f.importo)) : null;
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(f.scadenza || '')) ? f.scadenza : null;
    const people = (Array.isArray(b.people) ? b.people : []).slice(0, 40).filter(p => p && p.on !== false && EMAIL_RE.test(String(p.email || '')));
    const myAsa = (req.crm?.asas || []).find(k => asas.includes(k)) || asas[0];
    const newMode = MODES.includes(b.new_mode) ? b.new_mode : (await prefsOf(uid)).new_mode;
    const out = await db.tx(async q => {
      const { rows: [dup] } = await q.query('SELECT signal_id, project_id FROM crm_mail_threads WHERE conversation_id = $1 LIMIT 1', [convId]);
      if (dup) throw new HttpError(409, dup.project_id ? 'Questa conversazione è già in un progetto' : 'Questa conversazione è già nel Radar');
      // azienda: del CRM o nuova come lead
      let subjectId = null, subjectName = '';
      if (b.company?.subject_id) {
        const { rows: [s] } = await q.query('SELECT id, name FROM crm_subjects WHERE id = $1 AND merged_into IS NULL', [Number(b.company.subject_id)]);
        if (s) { subjectId = s.id; subjectName = s.name; }
      } else if (b.company?.new?.name) {
        const name = String(b.company.new.name).replace(/\s+/g, ' ').trim().slice(0, 200);
        const { rows: [ex] } = await q.query('SELECT id, name FROM crm_subjects WHERE merged_into IS NULL AND lower(name) = lower($1) LIMIT 1', [name]);
        if (ex) { subjectId = ex.id; subjectName = ex.name; } else {
          const dom = String(b.company.new.domain || '').toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 120);
          const { rows: [n] } = await q.query(`INSERT INTO crm_subjects (name, roles, asa, owner_id, lead_why, origin, created_by, created_quick, website)
                                               VALUES ($1, '{lead}', $2, $3, $4, 'Email', $3, true, $5) RETURNING id, name, lead_stage`,
          [name, [bu || myAsa].filter(Boolean), uid, `Da una email: ${title}`.slice(0, 1000), dom || null]);
          await q.query('INSERT INTO crm_stage_history (subject_id, from_stage, to_stage, note, user_id) VALUES ($1, NULL, $2, $3, $4)', [n.id, n.lead_stage, 'creata da una email', uid]);
          subjectId = n.id; subjectName = n.name;
        }
      }
      // persone nuove nel CRM (con la spunta), collegate all'azienda se hanno lo stesso dominio
      const contactIds = [];
      const colleagues = [];
      const subjDomain = String(b.company?.new?.domain || b.company?.domain || '').toLowerCase();
      for (const p of people) {
        if (p.kind === 'collega') { if (Number(p.user_id)) colleagues.push(Number(p.user_id)); continue; }
        if (p.kind === 'crm' && Number(p.contact_id)) { contactIds.push({ id: Number(p.contact_id), job: String(p.job || '').slice(0, 120) }); continue; }
        const email = String(p.email).toLowerCase();
        const { rows: [ex] } = await q.query('SELECT id FROM crm_contacts WHERE lower(email) = $1 LIMIT 1', [email]);
        let cid = ex?.id;
        if (!cid) {
          const last = String(p.last_name || '').trim().slice(0, 120) || email.split('@')[0].slice(0, 120);
          const { rows: [c] } = await q.query(`INSERT INTO crm_contacts (title, first_name, last_name, email, mobile, phone, owner_id, created_by, notes)
                                               VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8) RETURNING id`,
          [String(p.title || '').slice(0, 30), String(p.first_name || '').slice(0, 120), last, email, String(p.mobile || '').slice(0, 40), String(p.phone || '').slice(0, 40), uid, `Dalla email «${title}»`.slice(0, 500)]);
          cid = c.id;
          const sameDomain = subjectId && (S.domainOf(email) === subjDomain || (p.company?.kind === 'crm' && Number(p.company.subject_id) === subjectId) || (!subjDomain && people.find(x => x.kind !== 'collega')?.email && S.domainOf(email) === S.domainOf(people.find(x => x.kind !== 'collega').email)));
          const sid = sameDomain ? subjectId : (p.company?.kind === 'crm' ? Number(p.company.subject_id) : null);
          if (sid) await q.query('INSERT INTO crm_contact_links (contact_id, subject_id, job, is_primary) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING', [cid, sid, String(p.job || '').slice(0, 120)]);
        }
        contactIds.push({ id: cid, job: String(p.job || '').slice(0, 120) });
      }
      const { rows: [sg] } = await q.query(
        `INSERT INTO crm_signals (source, external_id, kind, bu, title, summary, why, entity, subject_id, amount, place, deadline, status, decided_by, decided_at, created_by, concept)
         VALUES ('email', $1, 'cliente', $2, $3, $4, $5, $6, $7, $8, $9, $10, 'interessa', $11, now(), $11, $12) RETURNING id`,
        [`${convId}`.slice(0, 500), bu, title, concept.cosa, concept.prossimo_passo ? `Prossimo passo: ${concept.prossimo_passo}` : '', subjectName || concept.per_chi || '', subjectId, amount, concept.dove, deadline, uid, JSON.stringify(concept)]);
      if (subjectId) await q.query("INSERT INTO crm_signal_links (signal_id, subject_id, role, linked_by) VALUES ($1, $2, 'cliente', $3) ON CONFLICT DO NOTHING", [sg.id, subjectId, uid]);
      for (const c of contactIds) await q.query('INSERT INTO crm_signal_links (signal_id, contact_id, role, linked_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [sg.id, c.id, c.job, uid]);
      await q.query(`INSERT INTO crm_mail_threads (signal_id, owner_id, conversation_id, subject, colleague_ids, themes, new_mode) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sg.id, uid, convId, title.slice(0, 300), [...new Set(colleagues)], concept.temi, newMode]);
      return { signal_id: sg.id, subject_id: subjectId, contacts: contactIds.length };
    });
    res.status(201).json(out);
  });

  // ── email della conversazione dentro il progetto ──────────────────────────────────────────────────
  async function copyToProject(t, projectId, msgId, assignedBy, { auto = false } = {}) {
    const enc = encodeURIComponent(msgId);
    const m = await mail(t, 'GET', `/me/messages/${enc}?$select=subject,from,toRecipients,ccRecipients,sentDateTime,receivedDateTime,body,internetMessageId,hasAttachments,webLink`, { headers: TEXT });
    const imid = m.internetMessageId || `outlook:${msgId}`;
    const { rows: [dupe] } = await db.query('SELECT 1 FROM project_emails WHERE project_id = $1 AND internet_message_id = $2', [projectId, imid]);
    if (dupe) return false;
    const files = [];
    if (m.hasAttachments) {
      const list = await mail(t, 'GET', `/me/messages/${enc}/attachments?$select=id,name,contentType,size,isInline`).catch(() => ({ value: [] }));
      let total = 0;
      for (const a of list.value || []) {
        if (a['@odata.type'] !== '#microsoft.graph.fileAttachment' || a.isInline) continue;
        if (a.size > MAX_ATTACHMENT || total + a.size > MAX_EMAIL_ATTACHMENTS) continue;
        const data = await binary(t, `/me/messages/${enc}/attachments/${encodeURIComponent(a.id)}/$value`).catch(() => null);
        if (!data) continue;
        total += data.length;
        files.push({ name: a.name || 'allegato', type: a.contentType || 'application/octet-stream', data });
      }
    }
    const person = r => ({ name: r?.emailAddress?.name || '', address: (r?.emailAddress?.address || '').toLowerCase() });
    return db.tx(async q => {
      const { rows } = await q.query(
        `INSERT INTO project_emails (project_id, internet_message_id, subject, from_name, from_address, to_list, cc_list, sent_at, body_text, assigned_by, outlook_id, web_link, auto_added)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (project_id, internet_message_id) DO NOTHING RETURNING id`,
        [projectId, imid, (m.subject || '(senza oggetto)').slice(0, 1000), person(m.from).name || null, person(m.from).address || null,
          JSON.stringify((m.toRecipients || []).map(person)), JSON.stringify((m.ccRecipients || []).map(person)), m.sentDateTime || m.receivedDateTime || null,
          String(m.body?.content || '').slice(0, 500000), assignedBy, msgId, m.webLink || null, auto]);
      if (!rows[0]) return false;
      for (const fl of files) await q.query('INSERT INTO project_email_attachments (email_id, name, content_type, size, data) VALUES ($1, $2, $3, $4, $5)', [rows[0].id, fl.name.slice(0, 300), fl.type.slice(0, 200), fl.data.length, fl.data]);
      return true;
    });
  }

  // Legge le email nuove della conversazione (entrano da sole), cerca quelle da suggerire e aggiorna lo stato.
  const syncing = new Map();
  async function syncProject(projectId, { force = false } = {}) {
    if (syncing.has(projectId)) return syncing.get(projectId);
    const job = (async () => {
      const { rows: threads } = await db.query('SELECT * FROM crm_mail_threads WHERE project_id = $1', [projectId]);
      if (!threads.length) return { added: 0 };
      let added = 0, suggested = 0;
      const internal = await internalFn();
      const newPeople = [];
      const waiting = new Map(); // proprietario → email nuove da approvare (per l'avviso)
      for (const th of threads) {
        let pendingNew = 0;
        if (!force && th.checked_at && Date.now() - new Date(th.checked_at).getTime() < STALE) continue;
        let t;
        try { t = await token(th.owner_id); } catch { continue; }
        try {
          const msgs = await conversation(t, th.conversation_id);
          // ALM2-67: entrano da sole solo se il proprietario l'ha scelto; altrimenti aspettano il suo sì in «Da approvare».
          // Quelle a cui ha detto «Non c'entra» (o tolte alla creazione) non tornano mai.
          const { rows: declined } = await db.query("SELECT internet_message_id FROM crm_mail_suggestions WHERE project_id = $1 AND status = 'scartata'", [projectId]);
          const no = new Set(declined.map(r => r.internet_message_id));
          for (const m of msgs) {
            if (no.has(m.internet_message_id)) continue;
            if (th.new_mode === 'auto') { if (await copyToProject(t, projectId, m.id, th.owner_id, { auto: true })) added++; }
            else pendingNew += await queue(projectId, th.owner_id, m, 'risposta', 'risposta nella conversazione collegata');
          }
          // persone nuove che scrivono nella conversazione e non sono nel CRM: solo dalle email già entrate (ALM2-67),
          // così chi non è il proprietario non vede indirizzi di email non approvate
          const { rows: inProj } = await db.query('SELECT internet_message_id FROM project_emails WHERE project_id = $1', [projectId]);
          const inSet = new Set(inProj.map(r => r.internet_message_id));
          const seenMsgs = msgs.filter(m => inSet.has(m.internet_message_id));
          const addrs = [...new Set(seenMsgs.flatMap(m => [m.from, ...m.to, ...m.cc]).map(x => x.address).filter(a => a && !internal(a) && !S.isAuto(a)))];
          if (addrs.length) {
            const { rows: known } = await db.query('SELECT lower(email) AS email FROM crm_contacts WHERE lower(email) = ANY($1::text[])', [addrs]);
            for (const a of addrs) if (!known.some(k => k.email === a)) {
              const m = seenMsgs.slice().reverse().find(x => x.from.address === a) || seenMsgs.find(x => [...x.to, ...x.cc].some(y => y.address === a));
              newPeople.push({ email: a, name: [m?.from, ...(m?.to || []), ...(m?.cc || [])].find(y => y?.address === a)?.name || '' });
            }
          }
          // D2: altre email delle persone collegate che parlano del progetto → suggerite
          const { rows: emails } = await db.query(`SELECT DISTINCT lower(c.email) AS email FROM crm_project_links l JOIN crm_contacts c ON c.id = l.contact_id
                                                    WHERE l.project_id = $1 AND c.email <> '' LIMIT 6`, [projectId]);
          for (const { email } of emails) {
            const data = await mail(t, 'GET', `/me/messages?$search=${encodeURIComponent(`"from:${email}"`)}&$select=${SELECT}&$top=15`).catch(() => ({ value: [] }));
            for (const m of (data.value || []).map(P.normMsg)) {
              if (m.conversation_id === th.conversation_id) continue;
              const hits = P.talksAbout(m, th.themes);
              if (!hits) continue;
              const n = await queue(projectId, th.owner_id, m, 'suggerita', `è un'altra conversazione ma parla di ${hits.slice(0, 2).join(', ')}`);
              suggested += n; pendingNew += n;
            }
          }
          await db.query('UPDATE crm_mail_threads SET checked_at = now() WHERE id = $1', [th.id]);
        } catch (err) {
          console.warn(`[posta] progetto ${projectId}: email non lette (${err.message})`);
        }
        if (pendingNew) waiting.set(th.owner_id, (waiting.get(th.owner_id) || 0) + pendingNew);
      }
      for (const [owner, n] of waiting) await notifyPending(owner, projectId, n);
      const pending = [...waiting.values()].reduce((a, b) => a + b, 0);
      const { rows: [p] } = await db.query('SELECT crm_deal FROM projects WHERE id = $1', [projectId]);
      const deal = p?.crm_deal || {};
      const ignored = new Set(deal.people_ignored || []);
      const fresh = newPeople.filter(x => !ignored.has(x.email));
      if (added || force || !deal.updated_at || JSON.stringify(fresh) !== JSON.stringify(deal.new_people || [])) await refreshDeal(projectId, { newPeople: fresh });
      return { added, suggested, pending };
    })().finally(() => syncing.delete(projectId));
    syncing.set(projectId, job);
    return job;
  }

  // Stato della trattativa (in breve, prossima mossa, impegni, chi conta, committente nuovo)
  async function refreshDeal(projectId, { newPeople } = {}) {
    const [{ rows: [p] }, { rows: emails }, { rows: notes }, { rows: meetings }, { rows: [sig] }, { rows: contacts }] = await Promise.all([
      db.query('SELECT id, name, crm_deal FROM projects WHERE id = $1', [projectId]),
      db.query('SELECT subject, from_name, from_address, to_list, cc_list, sent_at, body_text FROM project_emails WHERE project_id = $1 ORDER BY sent_at', [projectId]),
      db.query('SELECT body, note_date FROM notes WHERE project_id = $1 AND deleted_at IS NULL ORDER BY note_date DESC, id DESC LIMIT 10', [projectId]),
      db.query("SELECT subject, to_char(start_at, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS start_at FROM project_meetings WHERE project_id = $1", [projectId]).catch(() => ({ rows: [] })),
      db.query('SELECT concept FROM crm_signals WHERE project_id = $1', [projectId]),
      db.query(`SELECT c.id, lower(c.email) AS email, trim(concat_ws(' ', c.title, c.first_name, c.last_name)) AS name, l.role,
                       (SELECT cl.job FROM crm_contact_links cl WHERE cl.contact_id = c.id AND cl.date_to IS NULL ORDER BY cl.is_primary DESC LIMIT 1) AS job
                  FROM crm_project_links l JOIN crm_contacts c ON c.id = l.contact_id WHERE l.project_id = $1`, [projectId]),
    ]);
    if (!p) return null;
    const internal = await internalFn();
    const concept = sig?.concept || p.crm_deal?.concept || {};
    const firstFrom = emails.find(e => !internal(e.from_address))?.from_address;
    const people = contacts.map(c => ({ name: c.name, email: c.email, contact_id: c.id, job: c.job || c.role || '', first: c.email === firstFrom }));
    const st = await P.dealState({ title: p.name, emails, notes, meetings, concept, internal, people }, ai());
    await spend(st.eur);
    const old = p.crm_deal || {};
    const keyOf = c => `${c.who}|${String(c.text).slice(0, 60).toLowerCase()}`;
    const states = new Map((old.commitments || []).map(c => [keyOf(c), c]));
    const commitments = st.commitments.map(c => ({ ...c, ...(states.get(keyOf(c)) ? { state: states.get(keyOf(c)).state, ticket_id: states.get(keyOf(c)).ticket_id } : {}) }));
    // committente nuovo: compare nelle email e non è nel CRM (né rimandato)
    let client = null;
    if (st.client && st.client.toLowerCase() !== String(old.client_dismissed || '').toLowerCase()) {
      const { rows: [s] } = await db.query('SELECT id, name FROM crm_subjects WHERE merged_into IS NULL AND lower(name) = lower($1) LIMIT 1', [st.client]);
      const { rows: [linked] } = s ? await db.query('SELECT 1 FROM crm_project_links WHERE project_id = $1 AND subject_id = $2', [projectId, s.id]) : { rows: [] };
      if (!linked) client = { name: st.client, subject_id: s?.id || null };
    }
    const nextSame = old.next_move && st.next_move && old.next_move.text === st.next_move.text;
    const deal = { ...old, concept, summary: st.summary, next_move: st.next_move ? { ...st.next_move, done_at: nextSame ? old.next_move.done_at || null : null } : null,
      commitments, stakeholders: st.stakeholders, client, new_people: newPeople ?? old.new_people ?? [], ai: st.ai, updated_at: new Date().toISOString() };
    await db.query('UPDATE projects SET crm_deal = $2 WHERE id = $1', [projectId, JSON.stringify(deal)]);
    return deal;
  }

  async function project(req, id, { write = false } = {}) {
    const { rows: [p] } = await db.query(
      `SELECT id, name, owner_id, crm_kind, crm_goal, crm_deal, status, EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = $1 AND m.user_id = $2) AS member
         FROM projects WHERE id = $1`, [id, req.user.id]);
    if (!p || !p.crm_kind) throw new HttpError(404, 'Non è un progetto del CRM');
    if (write && !req.crm?.admin && p.owner_id !== req.user.id && !p.member) throw new HttpError(403, 'Solo chi è nel progetto può farlo');
    return p;
  }
  const saveDeal = (id, deal) => db.query('UPDATE projects SET crm_deal = $2 WHERE id = $1', [id, JSON.stringify(deal)]);

  // ── tavola D: la trattativa ───────────────────────────────────────────────────────────────────────
  app.get('/api/crm/progetti/:id/trattativa', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    let p = await project(req, id);
    const { rows: threads } = await db.query('SELECT conversation_id, owner_id, subject, checked_at, new_mode FROM crm_mail_threads WHERE project_id = $1', [id]);
    if (threads.length && (req.query.aggiorna === '1' || threads.some(t => !t.checked_at || Date.now() - new Date(t.checked_at).getTime() > STALE))) {
      await Promise.race([syncProject(id), new Promise(r => setTimeout(r, 15000))]).catch(() => {});
      p = await project(req, id);
    }
    const internal = await internalFn();
    const [{ rows: emails }, { rows: meetings }, { rows: sug }, { rows: [sig] }, { rows: tk }, { rows: links }] = await Promise.all([
      db.query('SELECT from_name, from_address, sent_at, subject, auto_added, assigned_at FROM project_emails WHERE project_id = $1', [id]),
      db.query("SELECT to_char(start_at, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS start_at FROM project_meetings WHERE project_id = $1", [id]).catch(() => ({ rows: [] })),
      // ALM2-67: le email in attesa le vede con oggetto e mittente solo il proprietario della casella
      db.query("SELECT id, kind, subject, from_name, from_address, sent_at, why FROM crm_mail_suggestions WHERE project_id = $1 AND status = 'nuova' AND owner_id = $2 ORDER BY sent_at DESC LIMIT 10", [id, req.user.id]),
      db.query('SELECT id, deadline, concept, subject_id FROM crm_signals WHERE project_id = $1', [id]),
      db.query('SELECT COALESCE(SUM(hours_actual), 0) AS h FROM tickets WHERE project_id = $1', [id]),
      db.query('SELECT subject_id FROM crm_project_links WHERE project_id = $1 AND subject_id IS NOT NULL', [id]),
    ]);
    const deal = p.crm_deal || {};
    const { rows: waiting } = await db.query(`SELECT u.name, count(*)::int AS n FROM crm_mail_suggestions s JOIN users u ON u.id = s.owner_id
                                               WHERE s.project_id = $1 AND s.status = 'nuova' AND s.owner_id <> $2 GROUP BY u.name ORDER BY u.name`, [id, req.user.id]);
    const mine = threads.find(t => t.owner_id === req.user.id);
    const deadline = iso(sig?.deadline);
    const today = P.romeDay();
    const days = deadline ? Math.round((Date.parse(`${deadline}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5) : null;
    const themes = (deal.concept?.temi || sig?.concept?.temi || []);
    const ext = [...new Set(emails.filter(e => !internal(e.from_address)).map(e => e.from_address))];
    const insights = await legami({ subjectIds: [sig?.subject_id, ...links.map(l => l.subject_id)], emails: ext, themes, excludeProject: id, excludeSignal: sig?.id, me: req.user.id });
    const linkedSignals = deal.linked_signals?.length ? (await db.query('SELECT id, title FROM crm_signals WHERE id = ANY($1::int[])', [deal.linked_signals])).rows : [];
    res.json({
      has_mail: threads.length > 0, thread: threads[0] ? { subject: threads[0].subject, checked_at: threads[0].checked_at } : null,
      emails: emails.length, new_emails: emails.filter(e => e.auto_added && Date.now() - new Date(e.assigned_at).getTime() < 24 * 36e5).length,
      ball: P.ball(emails, internal), temperature: emails.length ? P.temperature(emails, meetings, internal) : null,
      deadline, days_to_offer: days, hours: Math.round(Number(tk[0].h) * 10) / 10, hours_goal: Number(p.crm_goal?.hours) || 0,
      summary: deal.summary || '', next_move: deal.next_move && !deal.next_move.done_at ? deal.next_move : null,
      commitments: (deal.commitments || []).map((c, i) => ({ ...c, i })), stakeholders: deal.stakeholders || [], client: deal.client || null,
      new_people: deal.new_people || [], suggestions: sug, linked_signals: linkedSignals,
      waiting, my_new_mode: mine ? mine.new_mode : null,
      insights: [...linkedSignals.map(s => ({ kind: 'radar', title: 'Radar', text: `«${s.title}» collegata, ora «in corso».`, link: '#/crm/radar', link_label: 'Apri il Radar' })), ...insights.filter(x => !(x.kind === 'radar' && linkedSignals.some(s => s.id === x.signal_id)))],
      updated_at: deal.updated_at || null,
    });
  });

  app.post('/api/crm/progetti/:id/posta/aggiorna', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    await project(req, id);
    res.json(await syncProject(id, { force: true }));
  });

  // Cronologia unica: email, note e incontri del progetto
  app.get('/api/crm/progetti/:id/cronologia', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    await project(req, id);
    const [{ rows: emails }, { rows: notes }, { rows: meetings }] = await Promise.all([
      db.query(`SELECT id, subject, from_name, from_address, sent_at, auto_added, left(regexp_replace(body_text, '\\s+', ' ', 'g'), 400) AS body,
                       (SELECT count(*)::int FROM project_email_attachments a WHERE a.email_id = e.id) AS files
                  FROM project_emails e WHERE project_id = $1 ORDER BY sent_at DESC NULLS LAST LIMIT 80`, [id]),
      db.query(`SELECT n.id, n.kind, n.title, n.body, n.note_date, n.created_at, n.author_id, (SELECT count(*)::int FROM note_files f WHERE f.note_id = n.id) AS files
                  FROM notes n WHERE n.project_id = $1 AND n.deleted_at IS NULL ORDER BY n.created_at DESC LIMIT 80`, [id]),
      db.query(`SELECT id, subject, to_char(start_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS start_at, location FROM project_meetings WHERE project_id = $1 ORDER BY start_at DESC LIMIT 40`, [id]).catch(() => ({ rows: [] })),
          ]);
        const items = [
      ...emails.map(e => ({ type: 'email', id: e.id, at: e.sent_at, who: e.from_name || e.from_address, title: e.subject, body: P.baseSubject(String(e.body || '')).slice(0, 300), files: e.files,
        auto: e.auto_added })),
      ...notes.map(n => ({ type: 'note', id: n.id, at: n.created_at, author_id: n.author_id, kind: n.kind, title: n.title, body: n.body, files: n.files })),
      ...meetings.map(m => ({ type: 'meeting', id: m.id, at: m.start_at, title: m.subject, body: m.location || '' })),
    ].sort((a, b) => (new Date(b.at).getTime() || 0) - (new Date(a.at).getTime() || 0)); // per data vera: le date di pg come testo («Sun Nov 22…») si ordinavano per giorno della settimana
    res.json({ items });
  });

  // «Fatto» sulla prossima mossa
  app.post('/api/crm/progetti/:id/mossa', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    const p = await project(req, id, { write: true });
    const deal = p.crm_deal || {};
    if (deal.next_move) deal.next_move.done_at = new Date().toISOString();
    await saveDeal(id, deal);
    res.json({ ok: true });
  });

  // Impegni presi nelle email: diventano un compito, un promemoria o si segnano fatti / in calendario
  app.post('/api/crm/progetti/:id/impegni/:i', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    const i = v.int(req.params.i, 'impegno', { min: 0, max: 50 });
    const p = await project(req, id, { write: true });
    const action = v.oneOf(req.body?.azione, 'azione', ['compito', 'ricorda', 'fatto', 'calendario']);
    const deal = p.crm_deal || {};
    const c = (deal.commitments || [])[i];
    if (!c) throw new HttpError(404, 'Impegno non trovato');
    let ticketId = null;
    if (action === 'compito' || action === 'ricorda') {
      const due = c.due || addDays(P.romeDay(), action === 'compito' ? 3 : 7);
      const title = (action === 'ricorda' ? `Sollecitare: ${c.text}` : c.text).replace(/\s+/g, ' ').slice(0, 200);
      const { rows: [{ pos }] } = await db.query('SELECT COALESCE(MAX(position), 0) AS pos FROM tickets');
      const { rows: [tk] } = await db.query(`INSERT INTO tickets (project_id, title, description, status, due_date, position, created_by)
                                            VALUES ($1, $2, $3, 'todo', $4, $5, $6) RETURNING id, title, due_date`,
      [id, title, `Dalle email del progetto${c.by ? ` · ${c.by}` : ''}${c.date ? ` · ${c.date}` : ''}`, due, Number(pos) + 1, req.user.id]);
      await db.query('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [tk.id, req.user.id]);
      ticketId = tk.id;
    }
    deal.commitments[i] = { ...c, state: { compito: 'compito', ricorda: 'promemoria', fatto: 'fatto', calendario: 'in_calendario' }[action], ticket_id: ticketId || c.ticket_id || null };
    await saveDeal(id, deal);
    res.json({ ok: true, ticket_id: ticketId });
  });

  // «Prepara la risposta» (bozza) e invio come risposta a tutti nella conversazione, dalla propria casella
  app.post('/api/crm/progetti/:id/risposta/bozza', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    const p = await project(req, id, { write: true });
    const { rows: emails } = await db.query('SELECT subject, from_name, from_address, to_list, cc_list, sent_at, body_text, internet_message_id FROM project_emails WHERE project_id = $1 ORDER BY sent_at', [id]);
    if (!emails.length) throw new HttpError(400, 'Nel progetto non ci sono email a cui rispondere');
    const d = await P.draftReply({ title: p.name, emails, concept: p.crm_deal?.concept, nextMove: p.crm_deal?.next_move, me: req.user.name || '' }, ai());
    await spend(d.eur);
    const last = emails[emails.length - 1];
    res.json({ text: d.text, to: [last.from_address, ...(last.to_list || []).map(x => x.address), ...(last.cc_list || []).map(x => x.address)].filter((a, k, all) => a && a !== String(req.user.email).toLowerCase() && all.indexOf(a) === k), subject: d.subject });
  });
  app.post('/api/crm/progetti/:id/risposta', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    await project(req, id, { write: true });
    const text = v.text(req.body?.text, 'testo', { max: 20000, required: true });
    const { rows: [last] } = await db.query('SELECT internet_message_id FROM project_emails WHERE project_id = $1 ORDER BY sent_at DESC NULLS LAST LIMIT 1', [id]);
    if (!last) throw new HttpError(400, 'Nel progetto non ci sono email a cui rispondere');
    const t = await token(req.user.id);
    const filter = `internetMessageId eq '${q1(last.internet_message_id)}'`;
    const found = await mail(t, 'GET', `/me/messages?$filter=${encodeURIComponent(filter)}&$select=id&$top=1`);
    const mine = (found.value || [])[0];
    if (!mine) throw new HttpError(409, 'L\'ultima email non è nella tua casella: rispondi da Outlook o chiedi a chi l\'ha ricevuta');
    // a tutti, con la firma Almacis (ALM2-64)
    const me = String(req.user.email || '').toLowerCase();
    const m = P.normMsg(await mail(t, 'GET', `/me/messages/${encodeURIComponent(mine.id)}?$select=${SELECT}`));
    const { to } = recipients(m, me, true);
    const cc = m.cc.filter(c => c.address !== me);
    await sendFrom(req, mine.id, { mode: 'tutti', to: to.filter(p => !cc.some(c => c.address === p.address)), cc, text });
    syncProject(id, { force: true }).catch(() => {});
    res.json({ ok: true });
  });

  // Email suggerite: «Aggiungi» (entra nel progetto) o «Non c'entra»
  app.post('/api/crm/progetti/:id/suggerite/:sid', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    const sid = v.int(req.params.sid, 'email', { min: 1 });
    await project(req, id);
    const action = v.oneOf(req.body?.azione, 'azione', ['aggiungi', 'scarta']);
    const { rows: [s] } = await db.query("SELECT * FROM crm_mail_suggestions WHERE id = $1 AND project_id = $2 AND status = 'nuova'", [sid, id]);
    // ALM2-67: è un'email della casella di qualcuno: decide solo lui (non la squadra, la direzione o gli amministratori),
    // e a chi non è il proprietario non si dice nemmeno che c'è
    if (!s || s.owner_id !== req.user.id) throw new HttpError(s ? 403 : 404, s ? "È un'email della casella di un collega: la fa entrare solo lui" : 'Email da approvare non trovata');
    await decide(req, id, [s], action);
    res.json({ ok: true });
  });

  // Nuovi business (ALM2-79): le email della MIA casella che aspettano il mio sì su questo progetto (solo le mie)
  app.get('/api/crm/progetti/:id/suggerite', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    await project(req, id);
    const { rows } = await db.query(
      `SELECT id, kind, subject, from_name, from_address, sent_at, preview, why FROM crm_mail_suggestions
        WHERE project_id = $1 AND owner_id = $2 AND status = 'nuova' ORDER BY sent_at DESC NULLS LAST LIMIT 30`, [id, req.user.id]);
    res.json({ suggestions: rows });
  });
  // «Cerca nella mia posta»: Alma cerca nella casella di chi chiede le email delle persone collegate (e delle aziende
  // collegate) e quelle che parlano dell'iniziativa; finiscono fra le suggerite, entrano solo con il suo sì (ALM2-67)
  app.post('/api/crm/progetti/:id/cerca-email', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    const p = await project(req, id);
    const { rows: [ini] } = await db.query('SELECT name, description FROM crm_initiatives WHERE project_id = $1', [id]);
    const themes = P.themesOf(ini?.name || p.name, ini?.description || '').filter(w => w.length >= 6).slice(0, 2);
    const { rows: people } = await db.query(
      `SELECT DISTINCT ON (lower(c.email)) lower(c.email) AS email, trim(concat_ws(' ', c.first_name, c.last_name)) AS name, s.name AS company
         FROM crm_contacts c
         LEFT JOIN crm_contact_links cl ON cl.contact_id = c.id AND cl.date_to IS NULL
         LEFT JOIN crm_subjects s ON s.id = cl.subject_id
        WHERE c.email <> '' AND (c.id IN (SELECT contact_id FROM crm_project_links WHERE project_id = $1 AND contact_id IS NOT NULL)
           OR cl.subject_id IN (SELECT subject_id FROM crm_project_links WHERE project_id = $1 AND subject_id IS NOT NULL))
        ORDER BY lower(c.email) LIMIT 12`, [id]);
    let t;
    try { t = await token(req.user.id); } catch { throw new HttpError(400, 'Per cercare nella tua posta serve l\'accesso con Microsoft: esci e rientra'); }
    const search = async q => ((await mail(t, 'GET', `/me/messages?$search=${encodeURIComponent(`"${q}"`)}&$select=${SELECT}&$top=10`).catch(() => ({ value: [] }))).value || [])
      .filter(m => !m.isDraft).map(P.normMsg);
    let found = 0;
    for (const x of people) {
      const who = `${x.name || x.email}${x.company ? ` (${x.company})` : ''}`;
      for (const m of await search(`from:${x.email}`)) found += await queue(id, req.user.id, m, 'suggerita', `ti scrive ${who}`);
      for (const m of await search(`to:${x.email}`)) found += await queue(id, req.user.id, m, 'suggerita', `hai scritto a ${who}`);
    }
    for (const w of themes) for (const m of await search(w)) found += await queue(id, req.user.id, m, 'suggerita', `parla di «${w}»`);
    req.auditDetail = { label: 'Ha cercato nella sua posta le email di un\'iniziativa', target: `progetto #${id}`, before: null, after: { trovate: found } };
    res.json({ found, people: people.length, themes });
  });

  // «Entrano tutte»: tutte le email della mia casella in attesa su questo progetto
  app.post('/api/crm/progetti/:id/suggerite', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    await project(req, id);
    const action = v.oneOf(req.body?.azione, 'azione', ['aggiungi', 'scarta']);
    const { rows } = await db.query("SELECT * FROM crm_mail_suggestions WHERE project_id = $1 AND owner_id = $2 AND status = 'nuova'", [id, req.user.id]);
    await decide(req, id, rows, action);
    res.json({ ok: true, n: rows.length });
  });

  async function decide(req, id, rows, action) {
    if (!rows.length) return;
    if (action === 'aggiungi') {
      const t = await token(req.user.id);
      for (const s of rows) await copyToProject(t, id, s.outlook_id, req.user.id);
    }
    await db.query('UPDATE crm_mail_suggestions SET status = $2, decided_by = $3, decided_at = now() WHERE id = ANY($1::int[])', [rows.map(s => s.id), action === 'aggiungi' ? 'aggiunta' : 'scartata', req.user.id]);
    req.auditDetail = { label: action === 'aggiungi' ? `Ha fatto entrare ${rows.length === 1 ? "un'email" : `${rows.length} email`} della sua casella in un progetto` : `Ha lasciato fuori ${rows.length === 1 ? "un'email" : `${rows.length} email`} della sua casella`,
      target: `progetto #${id}`, before: null, after: { email: rows.map(s => s.subject).slice(0, 10) } };
    if (action === 'aggiungi') refreshDeal(id).catch(() => {});
  }

  // Risposte nuove della mia conversazione su questo progetto: «approva» (le approvo io) o «auto» (entrano da sole)
  app.put('/api/crm/progetti/:id/posta/modo', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    await project(req, id);
    const mode = v.oneOf(req.body?.modo, 'risposte nuove', MODES);
    const { rowCount } = await db.query('UPDATE crm_mail_threads SET new_mode = $3 WHERE project_id = $1 AND owner_id = $2', [id, req.user.id, mode]);
    if (!rowCount) throw new HttpError(403, "Su questo progetto non c'è una conversazione della tua casella");
    req.auditDetail = { label: 'Ha cambiato come entrano le risposte nuove', target: `progetto #${id}`, before: null, after: { risposte_nuove: mode === 'auto' ? 'entrano da sole' : 'le approva lui' } };
    res.json({ ok: true, new_mode: mode });
  });

  // Committente nuovo trovato nelle email: «Aggiungila al CRM» (lead collegato al progetto) o «Più tardi»
  app.post('/api/crm/progetti/:id/committente', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    const p = await project(req, id, { write: true });
    const action = v.oneOf(req.body?.azione, 'azione', ['aggiungi', 'dopo']);
    const deal = p.crm_deal || {};
    if (!deal.client?.name) throw new HttpError(404, 'Nessun committente da aggiungere');
    if (action === 'dopo') { deal.client_dismissed = deal.client.name; deal.client = null; await saveDeal(id, deal); return res.json({ ok: true }); }
    let sid = deal.client.subject_id;
    if (!sid) {
      const { rows: [sg] } = await db.query('SELECT bu FROM crm_signals WHERE project_id = $1', [id]);
      const { rows: [asa] } = await db.query('SELECT key FROM crm_asa ORDER BY sort LIMIT 1');
      const { rows: [n] } = await db.query(`INSERT INTO crm_subjects (name, roles, asa, owner_id, lead_why, origin, created_by, created_quick)
                                           VALUES ($1, '{lead}', $2, $3, $4, 'Email', $3, true) RETURNING id, lead_stage`,
      [deal.client.name.slice(0, 200), [sg?.bu || (req.crm?.asas || [])[0] || asa?.key].filter(Boolean), req.user.id, `Committente del progetto «${p.name}»`.slice(0, 1000)]);
      await db.query('INSERT INTO crm_stage_history (subject_id, from_stage, to_stage, note, user_id) VALUES ($1, NULL, $2, $3, $4)', [n.id, n.lead_stage, 'committente trovato nelle email', req.user.id]);
      sid = n.id;
    }
    await db.query("INSERT INTO crm_project_links (project_id, subject_id, linked_by, role) VALUES ($1, $2, $3, 'committente') ON CONFLICT DO NOTHING", [id, sid, req.user.id]);
    deal.stakeholders = (deal.stakeholders || []).map(s => (s.role === 'decide' && s.name === deal.client.name ? { ...s, subject_id: sid } : s));
    deal.client = null;
    await saveDeal(id, deal);
    res.json({ ok: true, subject_id: sid });
  });

  // Persona nuova che scrive nella conversazione: «Aggiungi al CRM» (dalla firma) o «Non serve»
  app.post('/api/crm/progetti/:id/persone-nuove', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    const p = await project(req, id, { write: true });
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email non valida');
    const action = v.oneOf(req.body?.azione, 'azione', ['aggiungi', 'ignora']);
    const deal = p.crm_deal || {};
    deal.new_people = (deal.new_people || []).filter(x => x.email !== email);
    if (action === 'ignora') { deal.people_ignored = [...new Set([...(deal.people_ignored || []), email])]; await saveDeal(id, deal); return res.json({ ok: true }); }
    const { rows: [last] } = await db.query('SELECT from_name, body_text FROM project_emails WHERE project_id = $1 AND from_address = $2 ORDER BY sent_at DESC LIMIT 1', [id, email]);
    const sig = S.fromSignature(last?.body_text || '', { name: last?.from_name || req.body?.name || '', email });
    const byDomain = await S.subjectsByDomain(db, [S.domainOf(email)]);
    const comp = S.companyOf(email, byDomain);
    const cid = await db.tx(async q => {
      const { rows: [ex] } = await q.query('SELECT id FROM crm_contacts WHERE lower(email) = $1 LIMIT 1', [email]);
      let c = ex?.id;
      if (!c) {
        ({ rows: [{ id: c }] } = await q.query(`INSERT INTO crm_contacts (title, first_name, last_name, email, mobile, phone, owner_id, created_by, notes)
                                                VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8) RETURNING id`,
        [sig.title || '', sig.first_name || '', sig.last_name || last?.from_name || email.split('@')[0], email, sig.mobile || '', sig.phone || '', req.user.id, `Dalla conversazione del progetto «${p.name}»`.slice(0, 500)]));
        if (comp.kind === 'crm') await q.query('INSERT INTO crm_contact_links (contact_id, subject_id, job, is_primary) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING', [c, comp.subject_id, sig.job || '']);
      }
      await q.query('INSERT INTO crm_project_links (project_id, contact_id, linked_by, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [id, c, req.user.id, sig.job || '']);
      return c;
    });
    await saveDeal(id, deal);
    res.json({ ok: true, contact_id: cid });
  });

  // ── la sala di lancio (routes/crm-progetti.js) chiama questi due ──────────────────────────────────
  async function afterLaunch(signalId, projectId, userId) {
    const { rows: [th] } = await db.query('SELECT * FROM crm_mail_threads WHERE signal_id = $1', [signalId]);
    if (!th) return null;
    await db.query('UPDATE crm_mail_threads SET project_id = $2 WHERE id = $1', [th.id, projectId]);
    const { rows: [sig] } = await db.query('SELECT concept FROM crm_signals WHERE id = $1', [signalId]);
    const concept = sig?.concept || {};
    const linked = (concept.link_signal_ids || []).filter(n => n !== signalId);
    if (linked.length) {
      await db.query(`UPDATE crm_signals SET status = CASE WHEN status = 'nuovo' THEN 'interessa' ELSE status END, note = trim(concat_ws(' · ', NULLIF(note, ''), $2::text)),
                        decided_by = COALESCE(decided_by, $3), decided_at = COALESCE(decided_at, now()) WHERE id = ANY($1::int[]) AND project_id IS NULL`,
      [linked, `In corso nel progetto #${projectId}`, userId]);
    }
    await db.query('UPDATE projects SET crm_deal = $2 WHERE id = $1', [projectId, JSON.stringify({ concept, linked_signals: linked })]);
    let copied = 0, pending = 0, error = '';
    try {
      // ALM2-67: le email sono della casella del proprietario. Se lancia lui entrano quelle che ha scelto nella proposta;
      // se lancia un collega (dal Radar) aspettano tutte il sì del proprietario in «Da approvare».
      const own = userId === th.owner_id;
      const t = await token(th.owner_id);
      const msgs = await conversation(t, th.conversation_id);
      const skip = new Set(concept.skip_ids || []);
      for (const m of msgs) {
        if (skip.has(m.id)) { await queue(projectId, th.owner_id, m, 'risposta', 'tolta da te alla creazione', 'scartata'); continue; }
        if (own) { if (await copyToProject(t, projectId, m.id, th.owner_id)) copied++; }
        else pending += await queue(projectId, th.owner_id, m, 'risposta', 'della conversazione da cui è nato il progetto');
      }
      for (const mid of concept.extra_ids || []) {
        if (own) { if (await copyToProject(t, projectId, mid, th.owner_id).catch(() => false)) copied++; continue; }
        const m = await mail(t, 'GET', `/me/messages/${encodeURIComponent(mid)}?$select=${SELECT}`).then(P.normMsg).catch(() => null);
        if (m) pending += await queue(projectId, th.owner_id, m, 'suggerita', "l'avevi scelta nella proposta del progetto");
      }
      await db.query('UPDATE crm_mail_threads SET checked_at = now() WHERE id = $1', [th.id]);
      if (pending) await notifyPending(th.owner_id, projectId, pending, userId);
    } catch (err) { error = err.message; console.warn(`[posta] email non copiate nel progetto ${projectId}: ${err.message}`); }
    refreshDeal(projectId).catch(err => console.warn('[posta] stato della trattativa non calcolato', err.message));
    return { copied, pending, error };
  }
  async function threadOfSignal(signalId) {
    const { rows: [th] } = await db.query('SELECT owner_id, colleague_ids, subject, new_mode FROM crm_mail_threads WHERE signal_id = $1', [signalId]);
    return th || null;
  }

  // ogni 30 minuti, nei giorni lavorativi dalle 8 alle 19: le email nuove di tutti i progetti nati da una email
  // ═══ Dalla email alla pipeline di Alma Energy (ALM2-78, tavola «Dalla email») ═══════════════════════════════════
  // «+ Opportunità» chiede dove salvarla: Radar del CRM (come sopra) o pipeline di Alma Energy, solo per i membri del
  // modulo. Alma propone nome, tipo, MW e luogo; l'azienda di chi scrive si collega o si crea; la conversazione resta
  // collegata all'opportunità e le risposte nuove entrano da sole o aspettano il sì di chi l'ha collegata (come ALM2-67).
  const canEnergy = async req => Boolean(energyAccess && await energyAccess.canUse(req));
  async function energyOnly(req) {
    if (!(await canEnergy(req))) throw new HttpError(403, 'La pipeline di Alma Energy è riservata ai membri del modulo');
  }
  const ROLE_BY_KIND = { ppa_onsite: 'cliente', revamping: 'proprietario', fv_classico: 'sviluppatore' };

  async function energyFromMail(req, messageId) {
    const t = await token(req.user.id);
    const first = P.normMsg(await mail(t, 'GET', `/me/messages/${encodeURIComponent(messageId)}?$select=${FULL}`, { headers: TEXT }));
    const msgs = first.conversation_id ? await conversation(t, first.conversation_id) : [first];
    if (!msgs.some(m => m.id === first.id)) msgs.push(first);
    return { first, msgs };
  }
  // chi ha scritto da fuori (l'ultimo) e la sua azienda nel CRM di Alma Energy
  async function energyPeople(msgs, fields) {
    const internal = await internalFn();
    const ext = msgs.slice().reverse().find(m => m.from.address && !internal(m.from.address) && !S.isAuto(m.from.address));
    if (!ext) return { person: null, company: null };
    const addr = ext.from.address.toLowerCase();
    const sig = S.fromSignature(ext.body, { name: ext.from.name, email: addr });
    const { rows: [known] } = await db.query(
      `SELECT p.id, trim(concat_ws(' ', p.first_name, p.last_name)) AS name,
              (SELECT x.company_id FROM energy_person_companies x WHERE x.person_id = p.id LIMIT 1) AS company_id
         FROM energy_people p WHERE lower(p.email) = $1 LIMIT 1`, [addr]);
    const person = known ? { kind: 'crm', id: known.id, name: known.name, email: addr }
      : { kind: 'nuova', email: addr, name: [sig.first_name, sig.last_name].filter(Boolean).join(' ') || ext.from.name || addr,
        first_name: sig.first_name || '', last_name: sig.last_name || ext.from.name || addr.split('@')[0], title: sig.title || '',
        phone: sig.phone || '', mobile: sig.mobile || '', job: sig.job || '' };
    const domain = S.domainOf(addr);
    const personal = S.isPersonal(domain);
    const hint = String(sig.company || fields.azienda || '').replace(/\s*·.*$/, '').trim();
    let row = known?.company_id ? (await db.query('SELECT id, name FROM energy_companies WHERE id = $1', [known.company_id])).rows[0] : null;
    if (!row && !personal) row = (await db.query('SELECT id, name FROM energy_companies WHERE lower(website) LIKE $1 ORDER BY id LIMIT 1', [`%${domain}%`])).rows[0];
    if (!row && hint) row = (await db.query('SELECT id, name FROM energy_companies WHERE lower(name) = lower($1) ORDER BY id LIMIT 1', [hint])).rows[0];
    const company = row ? { kind: 'crm', id: row.id, name: row.name }
      : hint || !personal ? { kind: 'nuova', name: (hint || S.nameFromDomain(domain) || domain).slice(0, 200), website: personal ? '' : domain } : null;
    return { person, company };
  }

  app.get('/api/crm/posta-energia', async (req, res) => {
    res.json({ can: await canEnergy(req) });
  });

  app.post('/api/crm/posta-energia/proposta', async (req, res) => {
    await energyOnly(req);
    const id = v.text(req.body?.message_id, 'email', { max: 500, required: true });
    const { first, msgs } = await energyFromMail(req, id);
    if (first.conversation_id) {
      const { rows: [th] } = await db.query('SELECT opportunity_id FROM energy_mail_threads WHERE conversation_id = $1 ORDER BY id LIMIT 1', [first.conversation_id]);
      if (th) return res.json({ already: { opportunity_id: th.opportunity_id } });
    }
    const { fields, eur, ai: byAi } = await E.extractEnergy(msgs, ai());
    await spend(eur);
    const { person, company } = await energyPeople(msgs, fields);
    res.json({ message_id: first.id, subject: first.subject, messages: msgs.length, fields, ai: byAi, person, company,
      new_mode: (await prefsOf(req.user.id)).new_mode, kinds: KINDS });
  });

  app.post('/api/crm/posta-energia/crea', async (req, res) => {
    await energyOnly(req);
    const uid = req.user.id;
    const b = req.body || {};
    const id = v.text(b.message_id, 'email', { max: 500, required: true });
    const kind = v.oneOf(b.kind, 'Tipo', Object.keys(KINDS));
    if (!kind) throw new HttpError(400, 'Scegli il tipo di opportunità');
    const title = v.text(b.title, 'Nome', { max: 200, required: true });
    const mwRaw = b.mw === null || b.mw === '' || b.mw === undefined ? null : Number(String(b.mw).replace(',', '.'));
    if (mwRaw !== null && (!Number.isFinite(mwRaw) || mwRaw < 0 || mwRaw > 100000)) throw new HttpError(400, 'Il campo «MW» non è valido');
    const place = { city: v.text(b.city, 'Comune', { max: 100 }) || '', province: v.text(b.province, 'Provincia', { max: 60 }) || '', region: v.text(b.region, 'Regione', { max: 60 }) || '' };
    const ownerId = b.owner_id === undefined ? uid : v.int(b.owner_id, 'Responsabile', { min: 1, nullable: true }) ?? null;
    if (ownerId !== uid) await energyAssign.checkOwner(ownerId);
    const newMode = MODES.includes(b.new_mode) ? b.new_mode : (await prefsOf(uid)).new_mode;
    const { first, msgs } = await energyFromMail(req, id);
    const { person, company } = await energyPeople(msgs, { azienda: '' });
    const useCompany = b.company === false ? null : company;
    const usePerson = b.person === false ? null : person;
    const opp = await db.tx(async q => {
      if (first.conversation_id) {
        const { rows: [dup] } = await q.query('SELECT opportunity_id FROM energy_mail_threads WHERE conversation_id = $1 LIMIT 1', [first.conversation_id]);
        if (dup) throw new HttpError(409, 'Questa conversazione è già collegata a un\'opportunità di Alma Energy');
      }
      let companyId = null;
      if (useCompany?.kind === 'crm') companyId = useCompany.id;
      else if (useCompany?.kind === 'nuova') {
        const { rows: [c] } = await q.query(`INSERT INTO energy_companies (name, website, city, province, region, source, owner_id, created_by)
                                               VALUES ($1, $2, '', '', '', 'Email', $3, $4) RETURNING id`, [useCompany.name, useCompany.website || '', ownerId || uid, uid]);
        companyId = c.id;
      }
      const stage = stageKeys(kind)[0];
      const { rows: [o] } = await q.query(
        `INSERT INTO energy_opportunities (kind, title, stage, mw, city, province, region, company_id, owner_id, created_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [kind, title, stage, mwRaw, place.city, place.province, place.region, companyId, ownerId, uid, `Dall'email «${first.subject}»`.slice(0, 5000)]);
      await q.query("INSERT INTO energy_stage_history (opportunity_id, from_stage, to_stage, note, user_id) VALUES ($1, NULL, $2, 'creata da una email', $3)", [o.id, stage, uid]);
      if (companyId) await q.query('INSERT INTO energy_links (opportunity_id, company_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [o.id, companyId, ROLE_BY_KIND[kind]]);
      if (usePerson) {
        let personId = usePerson.kind === 'crm' ? usePerson.id : null;
        if (!personId) {
          const { rows: [p] } = await q.query(
            `INSERT INTO energy_people (first_name, last_name, title, email, phone, mobile, channel, owner_id, source, data_source, data_date, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, 'email', $7, 'Email', 'Firma dell''email', CURRENT_DATE, $8) RETURNING id`,
            [usePerson.first_name.slice(0, 120), (usePerson.last_name || usePerson.email).slice(0, 120), usePerson.title.slice(0, 40), usePerson.email,
              usePerson.phone.slice(0, 40), usePerson.mobile.slice(0, 40), ownerId || uid, uid]);
          personId = p.id;
        }
        if (companyId) await q.query('INSERT INTO energy_person_companies (person_id, company_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [personId, companyId, (usePerson.job || '').slice(0, 120)]);
        await q.query("INSERT INTO energy_links (opportunity_id, person_id, role) VALUES ($1, $2, 'referente') ON CONFLICT DO NOTHING", [o.id, personId]);
      }
      if (first.conversation_id) {
        await q.query('INSERT INTO energy_mail_threads (opportunity_id, owner_id, conversation_id, subject, new_mode, checked_at) VALUES ($1, $2, $3, $4, $5, now())',
          [o.id, uid, first.conversation_id, first.subject.slice(0, 1000), newMode]);
      }
      for (const m of msgs) await saveEnergyMail(q, o.id, uid, m, 'in', false);
      return o;
    });
    await energyAssign.notifyAssigned(opp.owner_id, [opp], req.user);
    res.status(201).json({ id: opp.id });
  });

  async function saveEnergyMail(q, oppId, ownerId, m, status, auto) {
    const { rows } = await q.query(
      `INSERT INTO energy_opportunity_emails (opportunity_id, owner_id, internet_message_id, outlook_id, subject, from_name, from_address, sent_at, body_text, web_link, status, auto_added)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (opportunity_id, internet_message_id) DO NOTHING RETURNING id`,
      [oppId, ownerId, m.internet_message_id, m.id || '', String(m.subject || '').slice(0, 1000), m.from.name || '', m.from.address || '', m.date || null,
        String(m.body || '').slice(0, 200000), m.web_link || null, status, auto]);
    return rows.length;
  }

  // Risposte nuove nella conversazione collegata: all'apertura della pagina (se non lette da 2 minuti) e ogni 30 minuti.
  const energySyncing = new Map();
  function syncEnergy(oppId, { force = false } = {}) {
    if (energySyncing.has(oppId)) return energySyncing.get(oppId);
    const job = (async () => {
      const { rows: threads } = await db.query(
        'SELECT t.*, o.title FROM energy_mail_threads t JOIN energy_opportunities o ON o.id = t.opportunity_id WHERE t.opportunity_id = $1', [oppId]);
      for (const th of threads) {
        if (!force && th.checked_at && Date.now() - new Date(th.checked_at).getTime() < STALE) continue;
        let t;
        try { t = await token(th.owner_id); } catch { continue; }
        try {
          const auto = th.new_mode === 'auto';
          let pending = 0;
          for (const m of await conversation(t, th.conversation_id)) pending += await saveEnergyMail(db, oppId, th.owner_id, m, auto ? 'in' : 'da_approvare', auto);
          await db.query('UPDATE energy_mail_threads SET checked_at = now() WHERE id = $1', [th.id]);
          if (pending && !auto) {
            await notifier.notify({ userIds: [th.owner_id], actorId: null, kind: 'energy', link: `/energy/opportunita/${oppId}`,
              body: `${pending === 1 ? 'Una risposta nuova' : `${pending} risposte nuove`} da approvare in «${th.title}»` });
          }
        } catch (err) { console.warn(`[posta energy] opportunità ${oppId}: email non lette (${err.message})`); }
      }
    })().finally(() => energySyncing.delete(oppId));
    energySyncing.set(oppId, job);
    return job;
  }

  app.get('/api/energy/opportunities/:id/emails', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await syncEnergy(id).catch(() => {});
    const [{ rows: emails }, { rows: threads }] = await Promise.all([
      db.query(`SELECT id, subject, from_name, from_address, sent_at, status, auto_added, left(body_text, 600) AS preview,
                       CASE WHEN owner_id = $2 THEN web_link END AS web_link
                  FROM energy_opportunity_emails WHERE opportunity_id = $1 AND (status = 'in' OR (status = 'da_approvare' AND owner_id = $2))
                 ORDER BY sent_at DESC NULLS LAST, id DESC LIMIT 200`, [id, req.user.id]),
      db.query(`SELECT t.owner_id, t.subject, t.new_mode, u.name AS owner_name FROM energy_mail_threads t LEFT JOIN users u ON u.id = t.owner_id
                 WHERE t.opportunity_id = $1 ORDER BY t.id`, [id]),
    ]);
    res.json({ emails, threads, mine: threads.find(th => th.owner_id === req.user.id) || null });
  });

  // «Aggiungi» / «Non c'entra» su una risposta da approvare: solo chi ha collegato la conversazione
  app.post('/api/energy/opportunities/:id/emails/:emailId', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const emailId = v.int(req.params.emailId, 'email', { min: 1 });
    const status = req.body?.ok ? 'in' : 'scartata';
    const { rowCount } = await db.query("UPDATE energy_opportunity_emails SET status = $4 WHERE id = $1 AND opportunity_id = $2 AND owner_id = $3 AND status = 'da_approvare'",
      [emailId, id, req.user.id, status]);
    if (!rowCount) throw new HttpError(404, 'Email non trovata tra quelle da approvare');
    res.json({ ok: true, status });
  });

  app.patch('/api/energy/opportunities/:id/emails', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const mode = v.oneOf(req.body?.new_mode, 'risposte nuove', MODES);
    if (!mode) throw new HttpError(400, 'Scegli come entrano le risposte nuove');
    const { rowCount } = await db.query('UPDATE energy_mail_threads SET new_mode = $3 WHERE opportunity_id = $1 AND owner_id = $2', [id, req.user.id, mode]);
    if (!rowCount) throw new HttpError(404, 'Non hai collegato tu questa conversazione');
    res.json({ ok: true, new_mode: mode });
  });

  function startSync() {
    if (process.env.NODE_TEST_CONTEXT) return;
    setInterval(async () => {
      const now = new Date();
      const h = Number(now.toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }));
      const wd = now.toLocaleDateString('en-GB', { timeZone: 'Europe/Rome', weekday: 'short' });
      if (h < 8 || h >= 19 || wd === 'Sat' || wd === 'Sun') return;
      const { rows } = await db.query(`SELECT DISTINCT t.project_id FROM crm_mail_threads t JOIN projects p ON p.id = t.project_id WHERE p.status = 'active'`).catch(() => ({ rows: [] }));
      for (const r of rows) await syncProject(r.project_id, { force: true }).catch(err => console.warn('[posta] sincronizzazione non riuscita', err.message));
      // ALM2-78: conversazioni collegate alle opportunità di Alma Energy ancora aperte
      const { rows: opps } = await db.query(`SELECT DISTINCT t.opportunity_id FROM energy_mail_threads t JOIN energy_opportunities o ON o.id = t.opportunity_id
                                              WHERE o.stage NOT IN ('perso', 'scartato')`).catch(() => ({ rows: [] }));
      for (const r of opps) await syncEnergy(r.opportunity_id, { force: true }).catch(err => console.warn('[posta energy] sincronizzazione non riuscita', err.message));
    }, SYNC_EVERY).unref();
  }
  startSync();

  return { afterLaunch, threadOfSignal, syncProject, refreshDeal, legami };
}

module.exports = { registerCrmPosta };
