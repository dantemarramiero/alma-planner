// Riepilogo del mattino e solleciti.
//
// Riepilogo: nei giorni lavorativi, all'ora scelta (di default 8:00, ora italiana), un'email dalla propria casella
// a sé stessi (Mail.Send, già concesso) con: ticket in ritardo, in scadenza oggi e nei prossimi 5 giorni lavorativi,
// assegnati da ieri, RDA da approvare e RDA decise, e per chi guida un progetto i ticket in ritardo da 2+ giorni.
// Se non c'è niente, non parte. Uno per persona e giorno: il registro (digest_log) si prenota PRIMA di mandare.
//
// Solleciti (notifiche nell'app, una volta sola per ticket/persona/scadenza): il giorno lavorativo prima della
// scadenza a chi ci lavora; dopo 2 giorni lavorativi di ritardo al responsabile del progetto.
const { graph } = require('./graph');
const { loadFunctions, orgOidOf } = require('./functions');
const { romeNow, isWorkday, addWorkdays } = require('./workdays');

const SOON_WORKDAYS = 5;
const LATE_FOR_OWNER = 2;      // giorni lavorativi di ritardo prima di avvisare il responsabile del progetto
const REMIND_WINDOW = 10;      // solleciti solo per i ritardi recenti: niente raffica per i ticket scaduti da mesi
const LAST_MINUTE = 12 * 60 + 30; // dopo le 12:30 il riepilogo del giorno non parte più (es. server fermo la mattina)
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortDate = d => { const [, m, g] = String(d).slice(0, 10).split('-').map(Number); return `${g} ${MONTHS[m - 1]}`; };
const longDate = d => { const x = new Date(`${d}T12:00:00Z`); return `${WEEKDAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`; };
const firstName = n => String(n || '').split(/\s+/)[0];

// Un ticket «vero»: le RDA contano solo se accettate.
const REAL = "(t.rda_state IS NULL OR t.rda_state = 'accepted')";
const ITEM = `t.id, t.title, t.due_date::text AS due_date, t.priority, p.name AS project_name,
  COALESCE((SELECT string_agg(u.name, ', ' ORDER BY u.name) FROM ticket_assignees a JOIN users u ON u.id = a.user_id WHERE a.ticket_id = t.id), '') AS assignees`;

function createDigest({ db, auth, baseUrl, notifier, live }) {
  // ── contenuto ──────────────────────────────────────────────────────────────
  async function build(userId, today, { since } = {}) {
    const soonUntil = addWorkdays(today, SOON_WORKDAYS);
    const lateLimit = addWorkdays(today, -LATE_FOR_OWNER);
    if (!since) {
      // da quando contare le novità: l'ultimo riepilogo (mandato o vuoto), altrimenti 24 ore fa
      const { rows } = await db.query("SELECT at FROM digest_log WHERE user_id = $1 AND day < $2 AND status IN ('sent', 'empty') ORDER BY day DESC LIMIT 1", [userId, today]);
      since = rows[0]?.at || new Date(Date.now() - 24 * 3600 * 1000);
    }
    const mine = `FROM tickets t JOIN ticket_assignees me ON me.ticket_id = t.id AND me.user_id = $1
      LEFT JOIN projects p ON p.id = t.project_id WHERE t.status <> 'done' AND ${REAL}`;
    const q = (sql, params) => db.query(sql, params).then(r => r.rows);
    const [overdue, dueToday, soon, assigned, rdaDecided, projectLate] = await Promise.all([
      q(`SELECT ${ITEM} ${mine} AND t.due_date < $2 ORDER BY t.due_date, t.id`, [userId, today]),
      q(`SELECT ${ITEM} ${mine} AND t.due_date = $2 ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.id`, [userId, today]),
      q(`SELECT ${ITEM} ${mine} AND t.due_date > $2 AND t.due_date <= $3 ORDER BY t.due_date, t.id`, [userId, today, soonUntil]),
      q(`SELECT ${ITEM}, (SELECT name FROM users WHERE id = t.created_by) AS by_name ${mine}
           AND me.assigned_at > $2 AND t.created_by IS DISTINCT FROM $1 ORDER BY me.assigned_at DESC`, [userId, since]),
      q(`SELECT t.id, t.title, t.rda_state, t.rda_function, t.hours_approved, t.rda_reject_reason FROM tickets t
          WHERE t.created_by = $1 AND t.rda_function IS NOT NULL AND t.rda_state <> 'pending' AND t.rda_decided_at > $2
          ORDER BY t.rda_decided_at DESC`, [userId, since]),
      q(`SELECT ${ITEM} FROM tickets t JOIN projects p ON p.id = t.project_id
          WHERE p.owner_id = $1 AND t.status <> 'done' AND ${REAL} AND t.due_date <= $2
            AND NOT EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id AND a.user_id = $1)
          ORDER BY p.name, t.due_date`, [userId, lateLimit]),
    ]);
    // RDA da approvare: per le funzioni che guido
    let rdaToApprove = [];
    const oid = await orgOidOf(db, userId);
    if (oid) {
      const led = (await loadFunctions(db)).filter(f => f.head?.oid === oid).map(f => f.name);
      if (led.length) {
        rdaToApprove = await q(`SELECT t.id, t.title, t.rda_function, t.hours_estimated, (SELECT name FROM users WHERE id = t.created_by) AS by_name
          FROM tickets t WHERE t.rda_state = 'pending' AND t.rda_function = ANY($1::text[]) ORDER BY t.created_at`, [led]);
      }
    }
    // i nuovi assegnati che compaiono già per scadenza restano lì, con «nuovo»; qui solo gli altri
    const newIds = new Set(assigned.map(t => t.id));
    for (const t of [...overdue, ...dueToday, ...soon]) t.is_new = newIds.has(t.id);
    const listed = new Set([...overdue, ...dueToday, ...soon].map(t => t.id));
    const sections = { overdue, dueToday, soon, assigned: assigned.filter(t => !listed.has(t.id)), rdaToApprove, rdaDecided, projectLate };
    const total = Object.values(sections).reduce((n, s) => n + s.length, 0);
    return { today, soonUntil, sections, total };
  }

  // ── email ──────────────────────────────────────────────────────────────────
  function render(user, d) {
    const s = d.sections;
    const link = path => `${baseUrl}/app#${path}`;
    const ticketLine = (t, extra = '') => `<li style="margin:0 0 6px"><a href="${esc(link(`/tickets/${t.id}`))}" style="color:#111;font-weight:600;text-decoration:none">${esc(t.title)}</a>`
      + `${t.project_name ? ` <span style="color:#8a8681">· ${esc(t.project_name)}</span>` : ''}${extra}`
      + `${t.is_new ? ' <span style="background:#FFF1E5;color:#B45309;border-radius:4px;padding:0 5px;font-size:12px">nuovo</span>' : ''}</li>`;
    const block = (title, color, items, line) => (items.length
      ? `<h3 style="font-size:14px;margin:18px 0 8px;color:${color}">${esc(title)} (${items.length})</h3><ul style="padding-left:18px;margin:0">${items.map(line).join('')}</ul>` : '');
    const due = t => (t.due_date ? ` <span style="color:#8a8681">· scade ${shortDate(t.due_date)}</span>` : '');
    const parts = [
      block('In ritardo', '#B42318', s.overdue, t => ticketLine(t, ` <span style="color:#B42318">· scaduto il ${shortDate(t.due_date)}</span>`)),
      block('In scadenza oggi', '#C2410C', s.dueToday, t => ticketLine(t)),
      block('Nei prossimi giorni', '#2C2C2C', s.soon, t => ticketLine(t, due(t))),
      block('Altri assegnati a te da ieri', '#2C2C2C', s.assigned, t => ticketLine(t, `${t.by_name ? ` <span style="color:#8a8681">· da ${esc(t.by_name)}</span>` : ''}${due(t)}`)),
      block('RDA da approvare', '#2C2C2C', s.rdaToApprove, r => `<li style="margin:0 0 6px"><a href="${esc(link('/rda'))}" style="color:#111;font-weight:600;text-decoration:none">${esc(r.title)}</a> <span style="color:#8a8681">· ${esc(r.rda_function)}${r.by_name ? `, da ${esc(r.by_name)}` : ''}${r.hours_estimated ? `, ${Number(r.hours_estimated)} h stimate` : ''}</span></li>`),
      block('Le tue RDA decise', '#2C2C2C', s.rdaDecided, r => `<li style="margin:0 0 6px"><a href="${esc(link('/rda'))}" style="color:#111;font-weight:600;text-decoration:none">${esc(r.title)}</a> <span style="color:${r.rda_state === 'accepted' ? '#1B7A45' : '#B42318'}">· ${r.rda_state === 'accepted' ? `accettata${r.hours_approved ? `, ${Number(r.hours_approved)} h` : ''}` : `rifiutata${r.rda_reject_reason ? `: ${esc(r.rda_reject_reason)}` : ''}`}</span></li>`),
      block('Ritardi nei tuoi progetti', '#B42318', s.projectLate, t => ticketLine(t, ` <span style="color:#8a8681">· ${t.assignees ? esc(t.assignees) : 'nessuno assegnato'}, scaduto il ${shortDate(t.due_date)}</span>`)),
    ].join('');
    const counts = [
      s.overdue.length && `${s.overdue.length} in ritardo`,
      s.dueToday.length && `${s.dueToday.length} in scadenza oggi`,
      s.rdaToApprove.length && `${s.rdaToApprove.length} RDA da approvare`,
    ].filter(Boolean);
    const subject = `Alma Planet · la tua giornata${counts.length ? `: ${counts.join(', ')}` : ''}`;
    const html = `<div style="font-family:Roboto,Segoe UI,Arial,sans-serif;font-size:14px;color:#2C2C2C;max-width:600px">
  <div style="font-size:20px;font-weight:300;margin-bottom:2px">Alma <b style="font-weight:700;color:#FF8A26">Planet</b></div>
  <div style="color:#8a8681;margin-bottom:14px">Buongiorno ${esc(firstName(user.name))}, ecco la tua giornata di ${esc(longDate(d.today))}.</div>
  ${parts}
  <p style="margin:22px 0 0"><a href="${esc(link('/mine'))}" style="display:inline-block;background:#E8731A;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-weight:600">Apri i tuoi ticket</a></p>
  <p style="color:#8a8681;font-size:12px;margin-top:18px">Ricevi questo riepilogo nei giorni lavorativi. Puoi cambiare l'ora o spegnerlo da Alma Planet: Profilo → Modifica profilo.</p>
</div>`;
    return { subject, html };
  }

  async function send(user, d) {
    const { subject, html } = render(user, d);
    const token = await auth.graphToken(user.id);
    await graph(token, 'POST', '/me/sendMail', {
      body: {
        message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: user.email, name: user.name } }] },
        saveToSentItems: false,
      },
    });
  }

  // ── invio programmato ──────────────────────────────────────────────────────
  async function runDigests(day, minute) {
    const { rows: due } = await db.query(
      `SELECT u.id, u.email, u.name FROM users u
        WHERE u.digest_enabled AND u.digest_minute <= $2 AND u.last_login IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM digest_log l WHERE l.user_id = u.id AND l.day = $1)`, [day, minute]);
    let sent = 0;
    for (const user of due) {
      // prenotazione: solo chi riesce a scrivere la riga manda (niente doppioni tra istanze o dopo un riavvio)
      const { rows: booked } = await db.query(
        "INSERT INTO digest_log (user_id, day, status) VALUES ($1, $2, 'sending') ON CONFLICT DO NOTHING RETURNING user_id", [user.id, day]);
      if (!booked[0]) continue;
      let status = 'sent', items = 0, error = null;
      try {
        const d = await build(user.id, day);
        items = d.total;
        if (!d.total) status = 'empty';
        else { await send(user, d); sent++; }
      } catch (err) {
        status = err.code === 'reauth' || err.code === 'ms_not_configured' ? 'no_token' : 'failed';
        error = String(err.message || err).slice(0, 500);
        if (status === 'failed') console.warn(`[riepilogo] ${user.email}: non inviato (${error})`);
      }
      await db.query('UPDATE digest_log SET status = $3, items = $4, error = $5, at = now() WHERE user_id = $1 AND day = $2', [user.id, day, status, items, error]);
    }
    return sent;
  }

  async function runReminders(day) {
    const remind = async (rows, kind) => {
      for (const r of rows) {
        const { rows: fresh } = await db.query(
          'INSERT INTO reminder_log (ticket_id, user_id, kind, due_date) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING ticket_id',
          [r.ticket_id, r.user_id, kind, r.due_date]);
        if (fresh[0]) await notifier.notify({ userIds: [r.user_id], actorId: null, kind, ticketId: r.ticket_id });
      }
    };
    // il giorno lavorativo prima della scadenza (di venerdì anche le scadenze del fine settimana e del lunedì)
    const next = addWorkdays(day, 1);
    const { rows: tomorrow } = await db.query(
      `SELECT t.id AS ticket_id, a.user_id, t.due_date::text AS due_date FROM tickets t JOIN ticket_assignees a ON a.ticket_id = t.id
        WHERE t.status <> 'done' AND ${REAL} AND t.due_date > $1 AND t.due_date <= $2`, [day, next]);
    await remind(tomorrow, 'due_tomorrow');
    // dopo 2 giorni lavorativi di ritardo: al responsabile del progetto (se non ci lavora già lui)
    const { rows: late } = await db.query(
      `SELECT t.id AS ticket_id, p.owner_id AS user_id, t.due_date::text AS due_date FROM tickets t JOIN projects p ON p.id = t.project_id
        WHERE p.owner_id IS NOT NULL AND t.status <> 'done' AND ${REAL} AND t.due_date <= $1
          AND t.due_date >= $2
          AND NOT EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id AND a.user_id = p.owner_id)`, [addWorkdays(day, -LATE_FOR_OWNER), addWorkdays(day, -REMIND_WINDOW)]);
    await remind(late, 'overdue_project');
  }

  // Un giro: chiamato ogni 5 minuti. Solleciti dalle 7:00, riepiloghi dall'ora di ognuno fino alle 12:30.
  let running = false;
  async function tick(now = new Date()) {
    if (running) return;
    running = true;
    try {
      const { day, minute } = romeNow(now);
      if (!isWorkday(day)) return;
      if (minute >= 7 * 60 && minute < 20 * 60) await runReminders(day);
      if (minute <= LAST_MINUTE) await runDigests(day, minute);
    } catch (err) {
      console.warn('[riepilogo] giro non riuscito', err.message);
    } finally {
      running = false;
    }
  }

  function start(intervalMs = 5 * 60 * 1000) {
    setTimeout(() => tick(), 30 * 1000).unref(); // primo giro poco dopo l'avvio
    return setInterval(() => tick(), intervalMs).unref();
  }

  return { build, render, send, tick, start, runDigests, runReminders };
}

module.exports = { createDigest };
