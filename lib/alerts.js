// I tre avvisi scelti da ognuno in Profilo → Notifiche: nuovo post in bacheca, ticket assegnato a me, aggiornamento
// su un mio A3. Per ogni persona: campanella (notifica in Alma), telefono (push) ed email (dalla casella Microsoft di
// chi fa l'azione, come le email dei ticket). Senza preferenze salvate valgono i DEFAULTS.
const { graph } = require('./graph');

const KINDS = ['new_post', 'ticket_assigned', 'a3_update'];
const DEFAULTS = {
  new_post: { bell: true, push: true, email: false },
  ticket_assigned: { bell: true, push: true, email: true },
  a3_update: { bell: true, push: true, email: true },
};
const LABELS = {
  new_post: ['Nuovo post in bacheca', 'Un collega pubblica un post o una news aziendale'],
  ticket_assigned: ['Nuovo ticket assegnato a me', 'Anche le RDA e le attività di progetto'],
  a3_update: ['Aggiornamento su un mio A3', 'Contromisura nuova, chiusa o spostata, A3 modificato: sugli A3 di cui sono owner o nel team'],
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function emailHtml({ baseUrl, to, text, link, button }) {
  return `<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;color:#3F3F3F;font-size:15px;line-height:1.5;max-width:560px">
<img src="${baseUrl}/brand/almacis/almacis-logo.png" alt="Almacis" style="height:34px;margin-bottom:16px">
<p>Ciao ${esc(String(to.name || '').split(' ')[0])},</p>
<p>${text}</p>
<p><a href="${link}" style="display:inline-block;background:#B54E0A;color:#FFFFFF;text-decoration:none;border-radius:12px;padding:10px 16px;font-weight:600">${esc(button)}</a></p>
<p style="color:#6B6B6B;font-size:12px">Non vuoi più queste email? Cambia le tue notifiche in Alma Planet → Profilo → Notifiche.</p>
</div>`;
}

async function prefsFor(db, userIds, kind) {
  const { rows } = await db.query('SELECT user_id, bell, push, email FROM notification_prefs WHERE kind = $1 AND user_id = ANY($2::int[])', [kind, userIds]);
  const saved = new Map(rows.map(r => [r.user_id, r]));
  return userIds.map(id => ({ id, ...(saved.get(id) || DEFAULTS[kind]) }));
}

function createAlerts({ db, auth, notifier, push, ticketMail, baseUrl }) {
  // Email a più persone dalla casella di chi agisce; mai bloccante.
  async function mail(actorId, ids, { subject, text, link, button }) {
    if (!actorId || !ids.length) return 0;
    let token;
    try { token = await auth.graphToken(actorId); } catch (err) {
      if (err.code !== 'ms_not_configured') console.warn(`[email avvisi] casella di ${actorId} non disponibile (${err.message})`);
      return 0;
    }
    const { rows } = await db.query("SELECT id, name, email FROM users WHERE id = ANY($1::int[]) AND email <> ''", [ids]);
    let sent = 0;
    for (const to of rows) {
      try {
        await graph(token, 'POST', '/me/sendMail', { body: {
          message: { subject, body: { contentType: 'HTML', content: emailHtml({ baseUrl, to, text, link: `${baseUrl}${link}`, button }) },
            toRecipients: [{ emailAddress: { address: to.email, name: to.name } }] },
          saveToSentItems: false,
        } });
        sent++;
      } catch (err) {
        console.warn(`[email avvisi] → ${to.email}: non inviata (${err.message})`);
      }
    }
    return sent;
  }

  // kind: uno dei KINDS; userIds: a chi; actorId: chi fa l'azione (non riceve niente); bell: campi della notifica in
  // Alma; pushMsg: { title, body, url }; email: { subject, text (HTML già sicuro), link (/app#…), button } oppure
  // emailFn(ids) che manda lei (ticket: l'email dei ticket che c'era già).
  async function dispatch({ kind, userIds, actorId, bell = {}, pushMsg, email, emailFn }) {
    const ids = [...new Set(userIds || [])].filter(id => id && id !== actorId);
    if (!ids.length) return { bell: 0, push: 0, email: 0 };
    const prefs = await prefsFor(db, ids, kind);
    const bellIds = prefs.filter(p => p.bell).map(p => p.id);
    const pushIds = prefs.filter(p => p.push).map(p => p.id);
    const mailIds = prefs.filter(p => p.email).map(p => p.id);
    if (bellIds.length) await notifier.notify({ userIds: bellIds, actorId, kind, ...bell }).catch(err => console.warn('[avvisi] campanella', err.message));
    const pushed = pushMsg && pushIds.length ? await push.send(pushIds, pushMsg).catch(() => 0) : 0;
    let mailed = 0;
    if (mailIds.length) mailed = emailFn ? await emailFn(mailIds).catch(() => 0) : email ? await mail(actorId, mailIds, email) : 0;
    return { bell: bellIds.length, push: pushed, email: mailed };
  }

  // ── i tre avvisi ───────────────────────────────────────────────────────────
  async function newPost(post, actor, { except = [] } = {}) {
    const { rows } = await db.query("SELECT id FROM users WHERE last_login IS NOT NULL AND id <> $1 AND NOT (id = ANY($2::int[]))", [actor.id, except]);
    const preview = String(post.body || '').replace(/\s+/g, ' ').trim().slice(0, 140) || 'una foto';
    return dispatch({
      kind: 'new_post', userIds: rows.map(r => r.id), actorId: actor.id,
      bell: { postId: post.id, body: `ha pubblicato in bacheca: «${preview}»` },
      pushMsg: { title: `${actor.name} in bacheca`, body: preview, url: `/app#/p/${post.id}`, tag: `post-${post.id}` },
      email: { subject: `Alma Planet · ${actor.name} ha pubblicato in bacheca`, text: `<strong>${esc(actor.name)}</strong> ha pubblicato in bacheca: «${esc(preview)}».`, link: `/app#/p/${post.id}`, button: 'Apri il post' },
    });
  }

  async function ticketAssigned(ticket, userIds, actor) {
    const what = ticket.rda_state ? 'una RDA' : 'un ticket';
    return dispatch({
      kind: 'ticket_assigned', userIds, actorId: actor.id,
      bell: { ticketId: ticket.id, body: `ti ha assegnato ${what}: «${ticket.title}»` },
      pushMsg: { title: `Ti ha assegnato ${what}`, body: `${actor.name}: «${ticket.title}»${ticket.due_date ? ` · entro il ${ticket.due_date.split('-').reverse().join('/')}` : ''}`, url: `/app#/tickets/${ticket.id}`, tag: `ticket-${ticket.id}` },
      emailFn: ids => ticketMail.notifyAssigned(ticket, ids, actor),
    });
  }

  // A3: chi è nel suo progetto (responsabile e membri) o, se non è collegato, il suo owner per nome.
  async function a3Members(hkId) {
    const { rows: [p] } = await db.query('SELECT id, name, owner, project_id FROM hk_projects WHERE id = $1', [hkId]);
    if (!p) return { p: null, ids: [] };
    let ids = [];
    if (p.project_id) {
      const { rows } = await db.query('SELECT owner_id AS id FROM projects WHERE id = $1 UNION SELECT user_id FROM project_members WHERE project_id = $1', [p.project_id]);
      ids = rows.map(r => r.id).filter(Boolean);
    }
    if (!ids.length && p.owner) {
      const { rows } = await db.query("SELECT id FROM users WHERE lower(name) = lower($1) AND name <> ''", [p.owner.trim()]);
      ids = rows.map(r => r.id);
    }
    return { p, ids };
  }

  async function a3Update(hkId, actor, what) {
    const { p, ids } = await a3Members(hkId);
    if (!p || !ids.length) return null;
    const link = `/app#/strategy/a3/${hkId}`;
    return dispatch({
      kind: 'a3_update', userIds: ids, actorId: actor.id,
      bell: { body: `ha aggiornato l'A3 «${p.name}»: ${what}`, link: `/strategy/a3/${hkId}` },
      pushMsg: { title: `A3 «${p.name}»`, body: `${actor.name}: ${what}`, url: link, tag: `a3-${hkId}` },
      email: { subject: `Alma Planet · aggiornato l'A3 «${p.name}»`, text: `<strong>${esc(actor.name)}</strong> ha aggiornato l'A3 <strong>${esc(p.name)}</strong>: ${esc(what)}.`, link, button: "Apri l'A3" },
    });
  }

  return { dispatch, newPost, ticketAssigned, a3Update };
}

module.exports = { createAlerts, KINDS, DEFAULTS, LABELS, prefsFor };
