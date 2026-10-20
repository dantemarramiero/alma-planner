// Email «ti è stato assegnato un ticket»: parte dalla casella di chi assegna (permesso Mail.Send),
// una per persona, senza restare nella sua posta inviata. Mai bloccante: se non parte, si scrive nel log e basta.
const { graph } = require('./graph');

const PRIORITY = { low: 'Bassa', normal: 'Normale', high: 'Alta', urgent: 'Urgente' };
const STATUS = { todo: 'Da fare', doing: 'In corso', review: 'In revisione', done: 'Fatto' };
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const itDate = d => { if (!d) return null; const [y, m, g] = String(d).slice(0, 10).split('-').map(Number); return `${g} ${MONTHS[m - 1]} ${y}`; };
const firstName = name => String(name || '').split(/\s+/)[0];

function buildEmail({ ticket, to, actor, link }) {
  const rows = [
    ['Progetto', ticket.project_name],
    ['Priorità', PRIORITY[ticket.priority]],
    ['Stato', STATUS[ticket.status]],
    ['Inizio', itDate(ticket.start_date)],
    ['Scadenza', itDate(ticket.due_date)],
  ].filter(([, val]) => val);
  const desc = String(ticket.description || '').trim();
  const shortDesc = desc.length > 600 ? `${desc.slice(0, 600).trimEnd()}…` : desc;
  const urgent = ticket.priority === 'urgent' || ticket.priority === 'high';
  // colori in chiaro: le email non leggono i token CSS; sono quelli di orbita/brand/tokens.css
  const html = `<div style="font-family:Roboto,Helvetica Neue,Arial,sans-serif;font-size:14px;line-height:1.5;color:#3F3F3F;max-width:560px">
  <p>Ciao ${esc(firstName(to.name))},</p>
  <p><strong>${esc(actor.name)}</strong> ti ha assegnato un ticket in Alma Planet:</p>
  <div style="border:1px solid #DCDCDA;border-top:4px solid #FF8A26;border-radius:10px;padding:16px;margin:16px 0">
    <div style="font-size:16px;font-weight:500;color:#2C2C2C;margin-bottom:8px">${esc(ticket.title)}</div>
    <table style="border-collapse:collapse;font-size:13px">
      ${rows.map(([k, val]) => `<tr><td style="color:#6B6B6B;padding:2px 16px 2px 0">${esc(k)}</td><td style="padding:2px 0${k === 'Priorità' && urgent ? ';color:#C0392B;font-weight:500' : ''}">${esc(val)}</td></tr>`).join('')}
    </table>
    ${shortDesc ? `<div style="margin-top:10px;white-space:pre-wrap;color:#3F3F3F">${esc(shortDesc)}</div>` : ''}
  </div>
  <p><a href="${esc(link)}" style="display:inline-block;background:#FF8A26;color:#FFFFFF;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:500">Apri il ticket in Alma Planet</a></p>
  <p style="color:#6B6B6B;font-size:12px">Ricevi questa email perché ti è stato assegnato un ticket in Alma Planet.</p>
</div>`;
  return {
    subject: `[Alma Planet] ${actor.name} ti ha assegnato: ${ticket.title}`.slice(0, 250),
    html,
  };
}

// Email «nuova RDA interna per la tua funzione», al responsabile della funzione.
function buildRdaEmail({ ticket, to, actor, link }) {
  const rows = [
    ['Funzione', ticket.rda_function],
    ['Ore stimate', ticket.hours_estimated ? `${Number(ticket.hours_estimated).toLocaleString('it-IT')} h` : null],
    ['Entro il', itDate(ticket.due_date)],
    ['Progetto', ticket.project_name],
    ['Priorità', ticket.priority !== 'normal' ? PRIORITY[ticket.priority] : null],
  ].filter(([, val]) => val);
  const desc = String(ticket.description || '').trim();
  const shortDesc = desc.length > 600 ? `${desc.slice(0, 600).trimEnd()}…` : desc;
  const html = `<div style="font-family:Roboto,Helvetica Neue,Arial,sans-serif;font-size:14px;line-height:1.5;color:#3F3F3F;max-width:560px">
  <p>Ciao ${esc(firstName(to.name))},</p>
  <p><strong>${esc(actor.name)}</strong> ha fatto una richiesta interna alla tua funzione:</p>
  <div style="border:1px solid #DCDCDA;border-top:4px solid #FF8A26;border-radius:10px;padding:16px;margin:16px 0">
    <div style="font-size:16px;font-weight:500;color:#2C2C2C;margin-bottom:8px">${esc(ticket.title)}</div>
    <table style="border-collapse:collapse;font-size:13px">
      ${rows.map(([k, val]) => `<tr><td style="color:#6B6B6B;padding:2px 16px 2px 0">${esc(k)}</td><td style="padding:2px 0">${esc(val)}</td></tr>`).join('')}
    </table>
    ${shortDesc ? `<div style="margin-top:10px;white-space:pre-wrap;color:#555">${esc(shortDesc)}</div>` : ''}
  </div>
  <p>Accettala confermando o correggendo le ore e assegnandola a qualcuno del tuo team, oppure rifiutala.</p>
  <p><a href="${esc(link)}" style="display:inline-block;background:#FF8A26;color:#FFFFFF;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:500">Apri le richieste in Alma Planet</a></p>
  <p style="color:#6B6B6B;font-size:12px">Ricevi questa email perché sei il responsabile della funzione «${esc(ticket.rda_function)}» in Alma Planet.</p>
</div>`;
  return { subject: `[Alma Planet] Richiesta da ${actor.name}: ${ticket.title}`.slice(0, 250), html };
}

// Email «promemoria sul ticket»: il testo lo scrive chi lo manda; sotto, il riquadro del ticket e il link.
function buildReminderEmail({ ticket, to, actor, message, link }) {
  const rows = [
    ['Progetto', ticket.project_name],
    ['Stato', STATUS[ticket.status]],
    ['Scadenza', itDate(ticket.due_date)],
    ['Priorità', ticket.priority !== 'normal' ? PRIORITY[ticket.priority] : null],
  ].filter(([, val]) => val);
  const html = `<div style="font-family:Roboto,Helvetica Neue,Arial,sans-serif;font-size:14px;line-height:1.5;color:#3F3F3F;max-width:560px">
  <p>Ciao ${esc(firstName(to.name))},</p>
  <p><strong>${esc(actor.name)}</strong> ti manda un promemoria su un ticket in Alma Planet:</p>
  <div style="background:#FFF4EA;border-left:4px solid #FF8A26;border-radius:8px;padding:12px 16px;margin:16px 0;white-space:pre-wrap;color:#2C2C2C">${esc(message)}</div>
  <div style="border:1px solid #DCDCDA;border-radius:10px;padding:16px;margin:16px 0">
    <div style="font-size:16px;font-weight:500;color:#2C2C2C;margin-bottom:8px">${esc(ticket.title)}</div>
    <table style="border-collapse:collapse;font-size:13px">
      ${rows.map(([k, val]) => `<tr><td style="color:#6B6B6B;padding:2px 16px 2px 0">${esc(k)}</td><td style="padding:2px 0">${esc(val)}</td></tr>`).join('')}
    </table>
  </div>
  <p><a href="${esc(link)}" style="display:inline-block;background:#FF8A26;color:#FFFFFF;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:500">Apri il ticket in Alma Planet</a></p>
  <p style="color:#6B6B6B;font-size:12px">Ricevi questa email perché lavori a questo ticket in Alma Planet.</p>
</div>`;
  return { subject: `[Alma Planet] Promemoria da ${actor.name}: ${ticket.title}`.slice(0, 250), html };
}

function createTicketMail({ db, auth, baseUrl }) {
  // Una email dalla casella di chi agisce; mai bloccante.
  async function send(actorId, to, { subject, html }, what) {
    try {
      const token = await auth.graphToken(actorId);
      await graph(token, 'POST', '/me/sendMail', {
        body: {
          message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to.email, name: to.name } }] },
          saveToSentItems: false,
        },
      });
      return true;
    } catch (err) {
      if (err.code !== 'ms_not_configured') console.warn(`[email ${what}] → ${to.email}: non inviata (${err.message})`);
      return false;
    }
  }

  // ticket: la RDA appena creata; head: il responsabile della funzione (dall'organigramma, anche se non è mai entrato)
  async function notifyRdaRequest(ticket, head, actor) {
    if (!head?.email || head.user_id === actor.id) return false;
    return send(actor.id, head, buildRdaEmail({ ticket, to: head, actor, link: `${baseUrl}/app#/rda` }), `rda ${ticket.id}`);
  }

  // ticket: la riga completa (con project_name); userIds: i nuovi assegnatari; actor: chi assegna (req.user)
  async function notifyAssigned(ticket, userIds, actor) {
    const ids = [...new Set(userIds || [])].filter(id => id && id !== actor.id);
    if (!ids.length) return 0;
    let sent = 0;
    try {
      const { rows } = await db.query('SELECT id, email, name FROM users WHERE id = ANY($1::int[])', [ids]);
      if (!rows.length) return 0;
      const token = await auth.graphToken(actor.id);
      const link = `${baseUrl}/app#/tickets/${ticket.id}`;
      for (const to of rows) {
        const { subject, html } = buildEmail({ ticket, to, actor, link });
        try {
          await graph(token, 'POST', '/me/sendMail', {
            body: {
              message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to.email, name: to.name } }] },
              saveToSentItems: false,
            },
          });
          sent++;
        } catch (err) {
          console.warn(`[email ticket] ticket ${ticket.id} → ${to.email}: non inviata (${err.message})`);
        }
      }
    } catch (err) {
      // senza Microsoft (in locale) non c'è niente da inviare
      if (err.code !== 'ms_not_configured') console.warn(`[email ticket] ticket ${ticket.id}: email non inviate (${err.message})`);
    }
    return sent;
  }
  // Promemoria: una email per persona dalla casella di chi lo manda. Restituisce quante sono partite.
  async function sendReminder(ticket, recipients, actor, message) {
    let sent = 0;
    const link = `${baseUrl}/app#/tickets/${ticket.id}`;
    for (const to of recipients) {
      if (!to.email) continue;
      if (await send(actor.id, to, buildReminderEmail({ ticket, to, actor, message, link }), `promemoria ticket ${ticket.id}`)) sent++;
    }
    return sent;
  }
  return { notifyAssigned, notifyRdaRequest, sendReminder };
}

module.exports = { createTicketMail, buildEmail, buildRdaEmail, buildReminderEmail };
