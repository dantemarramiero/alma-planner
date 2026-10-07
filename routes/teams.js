// Messaggi = chat di Microsoft Teams, ed email da Outlook. Tutto a nome dell'utente collegato (permessi
// delegati Chat.ReadWrite e Mail.Send): quello che si scrive qui compare in Teams/Outlook e viceversa.
const { HttpError, v } = require('../lib/http');
const { graph } = require('../lib/graph');

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

  // Le 50 chat più recenti in una sola richiesta a Graph (con i partecipanti è la parte lenta, qualche secondo).
  // Tenute 20 s per utente: elenco e contatore del menu le condividono, e richieste uguali in volo si uniscono.
  // Si azzera quando l'utente scrive, legge o apre una chat.
  const CHATS_TTL = 20000;
  const chatCache = new Map(); // userId → { at, promise }
  function recentChats(userId) {
    const hit = chatCache.get(userId);
    if (hit && Date.now() - hit.at < CHATS_TTL) return hit.promise;
    const promise = (async () => {
      const [token, me] = await Promise.all([auth.graphToken(userId), meOid(userId)]);
      const page = await graph(token, 'GET', '/me/chats?$expand=members,lastMessagePreview&$orderby=lastMessagePreview/createdDateTime desc&$top=50');
      const list = (page.value || []).filter(c => !c.viewpoint?.isHidden).map(c => mapChat(c, me));
      list.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
      return list;
    })();
    chatCache.set(userId, { at: Date.now(), promise });
    promise.catch(() => chatCache.delete(userId)); // un errore non resta in memoria
    return promise;
  }
  const forget = userId => chatCache.delete(userId);

  // Elenco delle chat, le più recenti in alto.
  app.get('/api/teams/chats', async (req, res) => {
    if (req.query.fresh === '1') forget(req.user.id);
    res.json(await recentChats(req.user.id));
  });

  // Quante chat hanno messaggi non letti (per il contatore nel menu).
  app.get('/api/teams/unread', async (req, res) => {
    if (!auth.msConfigured) return res.json({ chats: 0 });
    try {
      res.json({ chats: (await recentChats(req.user.id)).filter(c => c.unread).length });
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
    forget(req.user.id);
    res.status(201).json(mapMessage(m, me));
  });

  // Segna la chat come letta anche in Teams.
  app.post('/api/teams/chats/:id/read', async (req, res) => {
    const [token, me] = await Promise.all([auth.graphToken(req.user.id), meOid(req.user.id)]);
    await graph(token, 'POST', `/chats/${encodeURIComponent(req.params.id)}/markChatReadForUser`, {
      body: { user: { id: me, tenantId } },
    }).catch(() => {});
    forget(req.user.id);
    live?.send([req.user.id], 'badges'); // il contatore di Messaggi nel menu si ricalcola
    res.json({ ok: true });
  });

  // id Microsoft di un collega partendo dall'email (UPN o indirizzo di posta).
  async function oidByEmail(token, email) {
    const u = await graph(token, 'GET', `/users/${encodeURIComponent(email)}?$select=id`).catch(() => null);
    if (u?.id) return u.id;
    const found = await graph(token, 'GET', `/users?$filter=${encodeURIComponent(`mail eq '${email.replace(/'/g, "''")}'`)}&$select=id`);
    if (!found.value?.[0]) throw new HttpError(404, `${email} non è un account Microsoft 365 di Almacis`);
    return found.value[0].id;
  }

  // Apre (o ritrova) la chat con una o più persone, indicate per id Microsoft (oids) o per email (emails):
  // con una sola è la chat 1:1 di Teams, sempre la stessa.
  app.post('/api/teams/chats', async (req, res) => {
    const b = req.body || {};
    const listed = [...(Array.isArray(b.oids) ? b.oids : []), ...(Array.isArray(b.emails) ? b.emails : [])];
    if (!listed.length || listed.length > 50) throw new HttpError(400, 'Scegli almeno una persona');
    const [token, me] = await Promise.all([auth.graphToken(req.user.id), meOid(req.user.id)]);
    const fromEmails = await Promise.all((Array.isArray(b.emails) ? b.emails : [])
      .map(e => oidByEmail(token, v.text(e, 'email', { max: 300, required: true }).toLowerCase())));
    const oids = [...new Set([...(Array.isArray(b.oids) ? b.oids : []).map(o => v.text(o, 'persona', { max: 100, required: true })), ...fromEmails])];
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
    forget(req.user.id);
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
