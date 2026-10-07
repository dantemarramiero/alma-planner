// Messaggi = chat di Microsoft Teams, ed email da Outlook. Tutto a nome dell'utente collegato (permessi
// delegati Chat.ReadWrite e Mail.Send): quello che si scrive qui compare in Teams/Outlook e viceversa.
const { HttpError, v } = require('../lib/http');
const { graph, graphAll } = require('../lib/graph');

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const textToHtml = s => escapeHtml(s).replace(/\r?\n/g, '<br>');

// I messaggi di Teams arrivano in HTML: li riduciamo a testo semplice (niente HTML altrui nella pagina).
function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<attachment[^>]*>.*?<\/attachment>/gis, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mapChat(c, meOid) {
  const members = (c.members || []).map(m => ({ oid: m.userId, name: m.displayName, email: m.email || null }));
  const last = c.lastMessagePreview;
  const lastAt = last?.createdDateTime || c.lastUpdatedDateTime;
  const readAt = c.viewpoint?.lastMessageReadDateTime;
  const lastFromMe = last?.from?.user?.id === meOid;
  return {
    id: c.id,
    type: c.chatType, // oneOnOne | group | meeting
    topic: c.topic || null,
    members,
    webUrl: c.webUrl,
    last: last ? {
      text: htmlToText(last.body?.content).slice(0, 160),
      from: last.from?.user?.displayName || null,
      mine: lastFromMe,
      at: last.createdDateTime,
    } : null,
    updated_at: lastAt,
    unread: Boolean(last && !lastFromMe && (!readAt || readAt < last.createdDateTime)),
  };
}

function mapMessage(m, meOid) {
  return {
    id: m.id,
    at: m.createdDateTime,
    from: m.from?.user ? { oid: m.from.user.id, name: m.from.user.displayName } : null,
    mine: m.from?.user?.id === meOid,
    text: m.deletedDateTime ? '' : htmlToText(m.body?.content),
    deleted: Boolean(m.deletedDateTime),
    system: m.messageType !== 'message',
    files: (m.attachments || []).filter(a => a.contentType === 'reference').map(a => ({ name: a.name, url: a.contentUrl })),
  };
}

function registerTeams(app, { db, auth, tenantId, live }) {
  async function meOid(userId) {
    const { rows } = await db.query('SELECT oid FROM users WHERE id = $1', [userId]);
    if (!rows[0]?.oid) throw new HttpError(400, 'Il tuo account non è collegato a Microsoft 365: esci e rientra');
    return rows[0].oid;
  }

  const chatPath = id => `/me/chats/${encodeURIComponent(v.text(id, 'chat', { max: 300, required: true }))}`;

  // Elenco delle chat, le più recenti in alto.
  app.get('/api/teams/chats', async (req, res) => {
    const [token, me] = await Promise.all([auth.graphToken(req.user.id), meOid(req.user.id)]);
    const chats = await graphAll(token, '/me/chats?$expand=members,lastMessagePreview&$top=50', { max: 200 });
    const list = chats.filter(c => !c.viewpoint?.isHidden).map(c => mapChat(c, me));
    list.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    res.json(list);
  });

  // Quante chat hanno messaggi non letti (per il contatore nel menu).
  app.get('/api/teams/unread', async (req, res) => {
    if (!auth.msConfigured) return res.json({ chats: 0 });
    try {
      const [token, me] = await Promise.all([auth.graphToken(req.user.id), meOid(req.user.id)]);
      const chats = await graphAll(token, '/me/chats?$expand=lastMessagePreview&$top=50', { max: 200 });
      res.json({ chats: chats.filter(c => !c.viewpoint?.isHidden).map(c => mapChat(c, me)).filter(c => c.unread).length });
    } catch {
      res.json({ chats: 0 });
    }
  });

  app.get('/api/teams/chats/:id', async (req, res) => {
    const [token, me] = await Promise.all([auth.graphToken(req.user.id), meOid(req.user.id)]);
    const c = await graph(token, 'GET', `${chatPath(req.params.id)}?$expand=members,lastMessagePreview`);
    res.json(mapChat(c, me));
  });

  // Messaggi di una chat, dal più vecchio al più recente. ?before=<link> per caricare i precedenti.
  app.get('/api/teams/chats/:id/messages', async (req, res) => {
    const [token, me] = await Promise.all([auth.graphToken(req.user.id), meOid(req.user.id)]);
    const next = typeof req.query.before === 'string' && req.query.before.startsWith('https://graph.microsoft.com/') ? req.query.before : null;
    const page = await graph(token, 'GET', next || `${chatPath(req.params.id)}/messages?$top=40`);
    const messages = (page.value || []).map(m => mapMessage(m, me)).reverse();
    res.json({ messages, older: page['@odata.nextLink'] || null });
  });

  app.post('/api/teams/chats/:id/messages', async (req, res) => {
    const text = v.text(req.body?.text, 'messaggio', { max: 20000, required: true });
    const [token, me] = await Promise.all([auth.graphToken(req.user.id), meOid(req.user.id)]);
    const m = await graph(token, 'POST', `/chats/${encodeURIComponent(req.params.id)}/messages`, {
      body: { body: { contentType: 'html', content: textToHtml(text) } },
    });
    res.status(201).json(mapMessage(m, me));
  });

  // Segna la chat come letta anche in Teams.
  app.post('/api/teams/chats/:id/read', async (req, res) => {
    const [token, me] = await Promise.all([auth.graphToken(req.user.id), meOid(req.user.id)]);
    await graph(token, 'POST', `/chats/${encodeURIComponent(req.params.id)}/markChatReadForUser`, {
      body: { user: { id: me, tenantId } },
    }).catch(() => {});
    live?.send([req.user.id], 'badges'); // il contatore di Messaggi nel menu si ricalcola
    res.json({ ok: true });
  });

  // Apre (o ritrova) la chat con una o più persone: con una sola è la chat 1:1 di Teams, sempre la stessa.
  app.post('/api/teams/chats', async (req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.oids) || !b.oids.length || b.oids.length > 50) throw new HttpError(400, 'Scegli almeno una persona');
    const oids = [...new Set(b.oids.map(o => v.text(o, 'persona', { max: 100, required: true })))];
    const [token, me] = await Promise.all([auth.graphToken(req.user.id), meOid(req.user.id)]);
    const others = oids.filter(o => o !== me);
    if (!others.length) throw new HttpError(400, 'Scegli almeno un collega');
    const member = oid => ({
      '@odata.type': '#microsoft.graph.aadUserConversationMember',
      roles: ['owner'],
      'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${oid}')`,
    });
    const body = others.length === 1
      ? { chatType: 'oneOnOne', members: [member(me), member(others[0])] }
      : { chatType: 'group', members: [me, ...others].map(member), ...(b.topic ? { topic: v.text(b.topic, 'nome della chat', { max: 250 }) } : {}) };
    const c = await graph(token, 'POST', '/chats', { body });
    res.status(201).json({ id: c.id });
  });

  // Email dal proprio account Outlook (resta negli Inviati).
  app.post('/api/mail/send', async (req, res) => {
    const b = req.body || {};
    const list = (x, field) => {
      if (x === undefined) return [];
      if (!Array.isArray(x) || x.length > 100) throw new HttpError(400, `Destinatari «${field}» non validi`);
      return x.map(e => {
        const s = v.text(e, field, { max: 300, required: true }).toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw new HttpError(400, `Indirizzo non valido: ${s}`);
        return { emailAddress: { address: s } };
      });
    };
    const to = list(b.to, 'a');
    if (!to.length) throw new HttpError(400, 'Indica almeno un destinatario');
    const subject = v.text(b.subject, 'oggetto', { max: 300, required: true });
    const text = v.text(b.text, 'testo', { max: 50000 }) || '';
    const token = await auth.graphToken(req.user.id);
    await graph(token, 'POST', '/me/sendMail', {
      body: {
        message: {
          subject,
          body: { contentType: 'HTML', content: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">${textToHtml(text)}</div>` },
          toRecipients: to,
          ccRecipients: list(b.cc, 'cc'),
        },
        saveToSentItems: true,
      },
    });
    res.json({ ok: true });
  });
}

module.exports = { registerTeams, htmlToText, textToHtml, mapChat };
