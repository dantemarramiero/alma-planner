// Feedback su Alma Space (ALM2-56): testo dell'issue per Linear, invio (anche rimandato se Linear non risponde)
// ed esito che torna da Linear, con la notifica a chi ha scritto il feedback (una volta per esito).
const linear = require('./linear');

const KIND_LABEL = { tecnico: 'Problema tecnico', procedura: 'Suggerimento sulla procedura' };
const FINAL = ['risolto', 'non_accolto', 'doppione']; // dopo questi l'esito non cambia più

// «Chrome su Windows», «Safari su iPhone»: browser e sistema dal user agent, quanto basta per capirsi
function deviceOf(ua = '') {
  const s = String(ua);
  if (!s) return 'Non indicato';
  const browser = /Edg(e|A|iOS)?\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet'
    : /CriOS|Chrome\//.test(s) ? 'Chrome' : /FxiOS|Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : null;
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows'
    : /Macintosh|Mac OS X/.test(s) ? 'Mac' : /CrOS/.test(s) ? 'Chromebook' : /Linux/.test(s) ? 'Linux' : null;
  if (browser && os) return `${browser} su ${os}`;
  return browser || os || s.slice(0, 60);
}

// dd/mm/yyyy hh:mm, ora italiana
function fmtRome(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(d)).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

// Titolo e descrizione dell'issue. images: indirizzi delle foto già caricate su Linear.
function buildIssue({ kind, body, page, userAgent, user, createdAt, images = [] }) {
  const line = String(body).replace(/\s+/g, ' ').trim();
  const title = `[Feedback] ${line.length > 80 ? `${line.slice(0, 80).trimEnd()}…` : line}`;
  const description = [
    String(body).trim(),
    ...images.map(url => `\n![foto dello schermo](${url})`),
    '',
    '---',
    '',
    `**Da:** ${user.name} (${user.email})`,
    `**Tipo:** ${KIND_LABEL[kind]}`,
    '**App:** Alma Space',
    `**Pagina:** ${page || 'non indicata'}`,
    `**Dispositivo:** ${deviceOf(userAgent)}`,
    `**Inviato:** ${fmtRome(createdAt)}`,
  ].join('\n');
  return { title, description };
}

// Esito dall'issue di Linear, con le stesse regole di MyWinery e del giro dei feedback (skill /feedback):
// stato Duplicate o collegamento «duplicate» = doppione («Doppione di ALM2-xx»); annullata = non accolto (il motivo
// dall'ultimo commento che inizia con «Motivo:»); completata = risolto; altrimenti approvato quando l'etichetta
// «Da valutare» non c'è più.
function outcomeOf(issue) {
  const type = issue.state?.type;
  const dup = (issue.relations?.nodes || []).find(r => r.type === 'duplicate');
  if (type === 'duplicate' || dup) {
    const of = dup?.relatedIssue?.identifier;
    return { outcome: 'doppione', reason: of ? `Doppione di ${of}` : null };
  }
  if (type === 'canceled') {
    const motivo = (issue.comments?.nodes || [])
      .filter(c => /^\s*Motivo:/i.test(c.body || ''))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    return { outcome: 'non_accolto', reason: motivo ? motivo.body.replace(/^\s*Motivo:\s*/i, '').trim().slice(0, 1000) || null : null };
  }
  if (type === 'completed') return { outcome: 'risolto', reason: null };
  const daValutare = (issue.labels?.nodes || []).some(l => l.name.toLowerCase() === 'da valutare');
  return { outcome: daValutare ? 'da_valutare' : 'approvato', reason: null };
}

const short = s => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > 60 ? `${t.slice(0, 60).trimEnd()}…` : t; };
function outcomeSentence(outcome, { body, identifier, reason }) {
  const q = `«${short(body)}»`;
  const id = identifier ? ` (${identifier})` : '';
  if (outcome === 'approvato') return `Il tuo feedback ${q} è stato approvato: lo mettiamo in lista${id}.`;
  if (outcome === 'risolto') return `Il tuo feedback ${q} è risolto${id}. Grazie!`;
  if (outcome === 'non_accolto') return `Il tuo feedback ${q} non è stato accolto${reason ? `: ${reason}` : ''}${id}.`;
  if (outcome === 'doppione') return `Il tuo feedback ${q} era già stato segnalato${reason ? ` (${reason.replace(/^Doppione di /, 'è uguale a ')})` : ''}: lo seguiamo lì.`;
  return null;
}

// Manda un feedback salvato a Linear: prima le foto, poi l'issue. Le foto caricate si tolgono dal database.
async function sendToLinear(db, feedbackId, doFetch) {
  const { rows: [f] } = await db.query(
    `SELECT f.*, u.name AS user_name, u.email AS user_email FROM feedback f JOIN users u ON u.id = f.user_id WHERE f.id = $1`, [feedbackId]);
  if (!f || f.linear_id) return f || null;
  const { rows: imgs } = await db.query('SELECT id, name, mime, data FROM feedback_images WHERE feedback_id = $1 ORDER BY id', [feedbackId]);
  const images = [];
  for (const img of imgs) images.push(await linear.uploadFile({ data: Buffer.from(img.data), contentType: img.mime, filename: img.name }, doFetch));
  const { title, description } = buildIssue({ kind: f.kind, body: f.body, page: f.page, userAgent: f.user_agent,
    user: { name: f.user_name, email: f.user_email }, createdAt: f.created_at, images });
  const issue = await linear.createFeedbackIssue({ title, description, kind: f.kind }, doFetch);
  const { rows: [saved] } = await db.query(
    `UPDATE feedback SET linear_id = $2, linear_identifier = $3, linear_url = $4, updated_at = now() WHERE id = $1 RETURNING *`,
    [feedbackId, issue.id, issue.identifier, issue.url]);
  await db.query('DELETE FROM feedback_images WHERE feedback_id = $1', [feedbackId]);
  return saved;
}

// Giro di allineamento: rimanda i feedback non ancora su Linear, poi legge l'esito di quelli aperti.
// Restituisce quanti esiti sono cambiati.
async function syncFeedback(db, notifier, doFetch) {
  if (!linear.configured()) return 0;
  const { rows: unsent } = await db.query('SELECT id FROM feedback WHERE linear_id IS NULL ORDER BY id LIMIT 20');
  for (const r of unsent) {
    try { await sendToLinear(db, r.id, doFetch); } catch (err) { console.warn(`[feedback] ${r.id} non mandato a Linear: ${err.message}`); break; }
  }
  const { rows } = await db.query(
    `SELECT id, user_id, body, linear_id, linear_identifier, outcome, outcome_reason, notified_outcome FROM feedback
      WHERE linear_id IS NOT NULL AND outcome <> ALL($1::text[])`, [FINAL]);
  if (!rows.length) return 0;
  const issues = new Map((await linear.feedbackIssues(rows.map(r => r.linear_id), doFetch)).map(i => [i.id, i]));
  let changed = 0;
  for (const f of rows) {
    const i = issues.get(f.linear_id);
    if (!i) continue;
    const { outcome, reason } = outcomeOf(i);
    if (outcome === f.outcome && (reason || null) === (f.outcome_reason || null)) continue;
    changed++;
    const notify = outcome !== 'da_valutare' && outcome !== f.notified_outcome;
    await db.query(
      `UPDATE feedback SET outcome = $2, outcome_reason = $3, linear_identifier = COALESCE($4, linear_identifier), updated_at = now(),
              notified_outcome = CASE WHEN $5 THEN $2 ELSE notified_outcome END WHERE id = $1`,
      [f.id, outcome, reason, i.identifier || null, notify]);
    if (notify) {
      const body = outcomeSentence(outcome, { body: f.body, identifier: i.identifier || f.linear_identifier, reason });
      await notifier?.notify({ userIds: [f.user_id], actorId: null, kind: 'feedback', body, link: '/feedback' }).catch(() => {});
    }
  }
  return changed;
}

module.exports = { KIND_LABEL, deviceOf, fmtRome, buildIssue, outcomeOf, outcomeSentence, sendToLinear, syncFeedback };
