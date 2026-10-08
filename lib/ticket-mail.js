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
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#111;max-width:560px">
  <p>Ciao ${esc(firstName(to.name))},</p>
  <p><strong>${esc(actor.name)}</strong> ti ha assegnato un ticket in Alma Planner:</p>
  <div style="border:1px solid #E0DDD9;border-left:4px solid #E85A0A;border-radius:8px;padding:14px 16px;margin:14px 0">
    <div style="font-size:17px;font-weight:600;margin-bottom:8px">${esc(ticket.title)}</div>
    <table style="border-collapse:collapse;font-size:13px">
      ${rows.map(([k, val]) => `<tr><td style="color:#8a8681;padding:2px 14px 2px 0">${esc(k)}</td><td style="padding:2px 0${k === 'Priorità' && urgent ? ';color:#B42318;font-weight:600' : ''}">${esc(val)}</td></tr>`).join('')}
    </table>
    ${shortDesc ? `<div style="margin-top:10px;white-space:pre-wrap;color:#555">${esc(shortDesc)}</div>` : ''}
  </div>
  <p><a href="${esc(link)}" style="display:inline-block;background:#E85A0A;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-weight:600">Apri il ticket in Alma Planner</a></p>
  <p style="color:#8a8681;font-size:12px">Ricevi questa email perché ti è stato assegnato un ticket in Alma Planner.</p>
</div>`;
  return {
    subject: `[Alma Planner] ${actor.name} ti ha assegnato: ${ticket.title}`.slice(0, 250),
    html,
  };
}

function createTicketMail({ db, auth, baseUrl }) {
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
  return { notifyAssigned };
}

module.exports = { createTicketMail, buildEmail };
