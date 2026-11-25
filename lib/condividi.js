// «Condividi» ovunque (ALM2-87, canvas «Condividi ovunque» approvato da Dante il 24/11/2026).
// Una scheda (azienda, contatto, progetto, nuovo business, opportunità Energy o Impianti) mandata a uno o più colleghi:
// l'avviso in Alma parte sempre; Teams (chat 1:1 a nome di chi condivide) ed email (dalla sua casella) se li sceglie.
// Qui: cosa si può condividere, chi può aprirlo, e il testo che arriva su Teams e per email.
const { HttpError } = require('./http');
const { graph } = require('./graph');
const { ROLES } = require('./crm');

const KIND_LABEL = { subjects: 'Azienda', contacts: 'Contatto', projects: 'Progetto', business: 'Nuovo business', energy: 'Opportunità Energy', impianti: 'Opportunità Impianti' };
const STATUS_LABEL = { active: 'in corso', paused: 'in pausa', done: 'concluso', archived: 'archiviato' };

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const textToHtml = s => escapeHtml(s).replace(/\r?\n/g, '<br>');
const dots = parts => parts.filter(Boolean).join(' · ');
const firstName = name => String(name || '').trim().split(/\s+/)[0] || '';

// Le schede che si condividono. load(req, id) controlla che chi condivide la veda e dice nome, riga di sintesi e link;
// canOpen(user, item) dice se il collega potrà aprirla (altrimenti il «!» rosso prima dell'invio).
function createKinds({ db, access, crmAccess, energyAccess, gov }) {
  // la richiesta «come se» la facesse il collega: serve alle stesse regole di visibilità di Alma
  const asUser = u => ({ user: { id: u.id, email: u.email }, privacy: gov ? gov.levelsFor(u.email) : {}, method: 'GET' });
  const seesCrm = async u => !u.suspended_at && (!crmAccess || crmAccess.canUse(asUser(u)));
  const crmGate = async req => { if (crmAccess && !(await crmAccess.canUse(req))) throw new HttpError(403, 'Il CRM non è tra le cose che puoi vedere'); };

  const kinds = {
    subjects: {
      noCrm: ['non vede il CRM', 'non vedono il CRM'],
      async load(req, id) {
        await crmGate(req);
        const { rows: [s] } = await db.query('SELECT id, name, roles, city, merged_into FROM crm_subjects WHERE id = $1', [id]);
        if (!s) throw new HttpError(404, 'Anagrafica non trovata');
        return { id, name: s.name, summary: dots(['Azienda', ...(s.roles || []).map(r => ROLES[r] || r), s.city]), link: `/crm/scheda/${id}` };
      },
      canOpen: u => seesCrm(u),
    },
    contacts: {
      noCrm: ['non vede il CRM', 'non vedono il CRM'],
      async load(req, id) {
        await crmGate(req);
        const { rows: [c] } = await db.query(
          `SELECT c.id, c.title, c.first_name, c.last_name, c.email, l.job, s.name AS company FROM crm_contacts c
             LEFT JOIN crm_contact_links l ON l.contact_id = c.id AND l.date_to IS NULL AND l.is_primary
             LEFT JOIN crm_subjects s ON s.id = l.subject_id WHERE c.id = $1 LIMIT 1`, [id]);
        if (!c) throw new HttpError(404, 'Contatto non trovato');
        const name = [c.title, c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Contatto';
        return { id, name, summary: dots(['Contatto', c.job, c.company]), link: `/crm/contatti/${id}` };
      },
      canOpen: u => seesCrm(u),
    },
    projects: {
      noCrm: ['non fa parte del progetto', 'non fanno parte del progetto'],
      async load(req, id) {
        if (!(await access.projectRole(req, id))) throw new HttpError(404, 'Progetto non trovato');
        const { rows: [p] } = await db.query(
          `SELECT p.id, p.name, p.status, p.crm_kind, o.name AS owner_name,
                  (SELECT count(*)::int FROM tickets t WHERE t.project_id = p.id AND t.status <> 'done' AND (t.rda_state IS NULL OR t.rda_state = 'accepted')) AS open
             FROM projects p LEFT JOIN users o ON o.id = p.owner_id WHERE p.id = $1`, [id]);
        const crm = Boolean(p.crm_kind);
        return {
          id, name: p.name, crm,
          summary: dots([crm ? 'Progetto del CRM' : 'Progetto', p.owner_name ? `Responsabile ${p.owner_name}` : '', STATUS_LABEL[p.status], p.open ? `${p.open} ticket aperti` : '']),
          link: crm ? `/crm/progetto/${id}` : `/projects/${id}`,
        };
      },
      // i progetti del CRM si aprono in sola lettura da chi vede il CRM; gli altri solo da responsabile e membri
      async canOpen(u, item) {
        if (u.suspended_at) return false;
        if (item.crm && !(await seesCrm(u))) return false;
        return Boolean(await access.projectRole(asUser(u), item.id));
      },
    },
    business: {
      noCrm: ['non vede il CRM', 'non vedono il CRM'],
      async load(req, id) {
        await crmGate(req);
        const { rows: [i] } = await db.query(
          'SELECT i.id, i.name, i.phase, o.name AS owner_name FROM crm_initiatives i LEFT JOIN users o ON o.id = i.owner_id WHERE i.id = $1', [id]);
        if (!i) throw new HttpError(404, 'Iniziativa non trovata');
        return { id, name: i.name, summary: dots(['Nuovo business', i.owner_name ? `Responsabile ${i.owner_name}` : '', i.phase]), link: `/crm/business/${id}` };
      },
      canOpen: u => seesCrm(u),
    },
    energy: {
      noCrm: ['non vede Alma Energy', 'non vedono Alma Energy'],
      async load(req, id) {
        if (energyAccess && !(await energyAccess.canUse(req))) throw new HttpError(403, 'Alma Energy è riservato alla BU Energy');
        const { rows: [o] } = await db.query(
          `SELECT o.id, o.title, o.stage, c.name AS company_name, u.name AS owner_name FROM energy_opportunities o
             LEFT JOIN energy_companies c ON c.id = o.company_id LEFT JOIN users u ON u.id = o.owner_id WHERE o.id = $1`, [id]);
        if (!o) throw new HttpError(404, 'Opportunità non trovata');
        return { id, name: o.title, summary: dots(['Opportunità Energy', o.company_name, o.owner_name ? `segue ${o.owner_name}` : '']), link: `/energy/opportunita/${id}` };
      },
      canOpen: async u => !u.suspended_at && (!energyAccess || energyAccess.canUse(asUser(u))),
    },
    impianti: {
      noCrm: ['non vede il CRM', 'non vedono il CRM'],
      async load(req, id) {
        await crmGate(req);
        const { rows: [g] } = await db.query(
          `SELECT g.id, g.title, g.region, s.name AS site_name, u.name AS owner_name FROM crm_signals g
             LEFT JOIN crm_subjects s ON s.id = g.subject_id LEFT JOIN users u ON u.id = g.decided_by WHERE g.id = $1 AND g.bu = 'impianti'`, [id]);
        if (!g) throw new HttpError(404, 'Opportunità non trovata');
        return { id, name: g.title, summary: dots(['Opportunità Impianti', g.site_name, g.region, g.owner_name ? `segue ${g.owner_name}` : '']), link: `/impianti/opportunita/${id}` };
      },
      canOpen: u => seesCrm(u),
    },
  };
  return kinds;
}

// ── il messaggio ─────────────────────────────────────────────────────────────────────────────
function teamsHtml({ from, item, message, url, kind }) {
  return [
    message ? `<p>${textToHtml(message)}</p>` : `<p>Ti ho condiviso questa scheda di Alma Space.</p>`,
    `<p><b>${escapeHtml(KIND_LABEL[kind] || 'Alma Space')} · ${escapeHtml(item.name)}</b>${item.summary ? `<br>${escapeHtml(item.summary)}` : ''}</p>`,
    `<p><a href="${escapeHtml(url)}">Apri in Alma Space</a></p>`,
  ].join('');
}

function mailHtml({ from, to, item, message, url, kind }) {
  const font = 'font-family:Roboto,Segoe UI,Arial,sans-serif';
  return `<div style="${font};font-size:14px;color:#2C2C2C;line-height:1.5">
<p>Ciao ${escapeHtml(firstName(to.name))},</p>
${message ? `<p>${textToHtml(message)}</p>` : '<p>ti ho condiviso questa scheda di Alma Space.</p>'}
<table role="presentation" cellspacing="0" cellpadding="0" style="border:1px solid #ECEAE6;border-top:4px solid #FF8A26;border-radius:14px;margin:16px 0;width:100%;max-width:520px"><tr><td style="padding:16px 18px">
<div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#B85A0A;font-weight:500">Alma Space · ${escapeHtml(KIND_LABEL[kind] || '')}</div>
<div style="font-size:17px;font-weight:700;margin:4px 0">${escapeHtml(item.name)}</div>
${item.summary ? `<div style="font-size:13px;color:#6B6B6B">${escapeHtml(item.summary)}</div>` : ''}
<a href="${escapeHtml(url)}" style="display:inline-block;margin-top:12px;padding:10px 16px;border-radius:12px;background:#FF8A26;color:#FFFFFF;text-decoration:none;font-weight:500">Apri in Alma Space</a>
</td></tr></table>
<p>${escapeHtml(from.name || '')}</p></div>`;
}

const mailSubject = ({ from, item }) => `${firstName(from.name) || 'Un collega'} ti ha condiviso «${item.name}»`.slice(0, 300);

// Spiega in italiano perché Teams o la posta non sono partiti (va nel «!» rosso)
function reason(err) {
  if (err?.code === 'reauth' || err?.status === 401) return 'Microsoft chiede di rientrare';
  if (err?.code === 'ms_not_configured' || err?.status === 503) return 'Microsoft 365 non è collegato ad Alma';
  return String(err?.message || 'errore di Microsoft 365').slice(0, 200);
}

// Invio vero, con Microsoft Graph a nome di chi condivide.
function createGraphSender({ auth }) {
  async function oidOf(token, u) {
    if (u.oid) return u.oid;
    const found = await graph(token, 'GET', `/users/${encodeURIComponent(u.email)}?$select=id`).catch(() => null);
    if (!found?.id) throw new HttpError(404, `${u.name} non ha un account Microsoft 365`);
    return found.id;
  }
  const member = oid => ({ '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: ['owner'], 'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${oid}')` });
  return {
    // hosted: immagini dentro il messaggio (ALM2-94, screenshot della segnalazione); se Teams le rifiuta, parte il testo
    async teams(from, to, html, { hosted = [], fallbackHtml = null } = {}) {
      const token = await auth.graphToken(from.id);
      const [me, other] = await Promise.all([oidOf(token, from), oidOf(token, to)]);
      // oneOnOne: Microsoft restituisce la chat che c'è già tra i due, o la crea
      const chat = await graph(token, 'POST', '/chats', { body: { chatType: 'oneOnOne', members: [member(me), member(other)] } });
      const path = `/chats/${encodeURIComponent(chat.id)}/messages`;
      if (!hosted.length) { await graph(token, 'POST', path, { body: { body: { contentType: 'html', content: html } } }); return; }
      try {
        await graph(token, 'POST', path, { body: { body: { contentType: 'html', content: html }, hostedContents: hosted } });
      } catch (err) {
        if (err?.status === 401 || err?.code === 'reauth') throw err;
        await graph(token, 'POST', path, { body: { body: { contentType: 'html', content: fallbackHtml || html } } });
      }
    },
    async mail(from, to, subject, html, { attachments = [] } = {}) {
      const token = await auth.graphToken(from.id);
      await graph(token, 'POST', '/me/sendMail', {
        body: { message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to.email, name: to.name } }], ...(attachments.length ? { attachments } : {}) }, saveToSentItems: true },
      });
    },
  };
}

// In locale senza Microsoft 365 (DEV_LOGIN): niente parte davvero, si scrive nel terminale cosa sarebbe partito.
function createFakeSender({ log = console.log } = {}) {
  const sent = [];
  return {
    sent,
    async teams(from, to, html, opts = {}) { sent.push({ via: 'teams', from: from.email, to: to.email, html, hosted: opts.hosted || [] }); log(`[condividi] Teams (finto) ${from.email} → ${to.email}${opts.hosted?.length ? ' con screenshot' : ''}`); },
    async mail(from, to, subject, html, opts = {}) { sent.push({ via: 'mail', from: from.email, to: to.email, subject, html, attachments: opts.attachments || [] }); log(`[condividi] Email (finta) ${from.email} → ${to.email}: ${subject}${opts.attachments?.length ? ` + ${opts.attachments.length} allegati` : ''}`); },
  };
}

module.exports = { createKinds, createGraphSender, createFakeSender, teamsHtml, mailHtml, mailSubject, reason, KIND_LABEL };
