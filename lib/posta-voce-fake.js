// Casella Outlook finta per «Posta in macchina» (ALM2-57) in locale e nei test: le email del canvas più una
// newsletter, un noreply e una conversazione a cui hai già risposto, che non devono entrare nel giro.
const { HttpError } = require('./http');

const ago = h => new Date(Date.now() - h * 36e5).toISOString();
const P = (name, address) => ({ emailAddress: { name, address } });
const ME = P('Marramiero Dante', 'dante.marramiero@almacis.it');

function createPostaVoceFake() {
  const inbox = [
    { id: 'pv-1', conversationId: 'c-snam', subject: 'Sopralluogo centrale Chieti', from: P('Marco Di Pietro', 'marco.dipietro@snam.it'), toRecipients: [ME], ccRecipients: [], receivedDateTime: ago(1), isRead: false,
      body: 'Ciao Dante,\nper il sopralluogo alla centrale di Chieti giovedì va bene per voi? Noi saremmo liberi dalle 9 alle 12.\n\nGrazie\nMarco Di Pietro\nSnam S.p.A. · Manutenzione impianti Centro Italia\nCell. 335 000 1122' },
    { id: 'pv-2', conversationId: 'c-asl', subject: 'Offerta manutenzione ASL: le cifre', from: P('Giulia Russo', 'giulia.russo@studiorusso.it'), toRecipients: [ME], ccRecipients: [P('Luca Ferri', 'luca.ferri@almacis.it')], receivedDateTime: ago(3), isRead: false,
      body: 'Buongiorno Dante,\nci mandate le cifre aggiornate dell\'offerta per la manutenzione ASL entro venerdì? Il RUP le chiede per la riunione di lunedì.\n\nCordiali saluti\nGiulia Russo' },
    { id: 'pv-news', conversationId: 'c-news', subject: 'Le novità di novembre', from: P('Edilizia Oggi', 'news@ediliziaoggi.it'), toRecipients: [ME], receivedDateTime: ago(2), isRead: false,
      internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '<mailto:unsubscribe@ediliziaoggi.it>' }], body: 'Newsletter' },
    { id: 'pv-noreply', conversationId: 'c-nr', subject: 'Il tuo documento è pronto', from: P('DocuSign', 'noreply@docusign.net'), toRecipients: [ME], receivedDateTime: ago(4), isRead: false, body: 'Documento pronto' },
    { id: 'pv-old', conversationId: 'c-ortona', subject: 'Documenti per la gara', from: P('Paolo Lanci', 'p.lanci@comune.ortona.ch.it'), toRecipients: [ME], receivedDateTime: ago(30), isRead: false,
      body: 'Gentile ing. Marramiero,\nle chiedo di inviarci la documentazione per la gara del palazzo comunale: DURC, visura, attestazione SOA OG1, e la dichiarazione sui requisiti. Le ricordo che la scadenza è il 5 dicembre.\n\nDistinti saluti\nPaolo Lanci\nUfficio tecnico · Comune di Ortona' },
    { id: 'pv-replied', conversationId: 'c-done', subject: 'Re: riunione', from: P('Sara Marini', 's.marini@studiotecnicorossi.it'), toRecipients: [ME], receivedDateTime: ago(10), isRead: false, body: 'Ok, ci vediamo alle 15.' },
  ];
  const sent = [
    { id: 's-1', conversationId: 'c-done', sentDateTime: ago(9), to: 's.marini@studiotecnicorossi.it', body: { content: 'Ciao Sara,\nperfetto, a dopo.\n\nDante' } },
    { id: 's-2', conversationId: 'c-snam-old', sentDateTime: ago(60), to: 'marco.dipietro@snam.it', body: { content: 'Ciao Marco,\nti giro il cronoprogramma aggiornato.\n\nUn saluto,\nDante' } },
  ];
  const drafts = new Map();
  const outbox = [];
  const strip = ({ body, ...m }) => ({ ...m, bodyPreview: String(body || '').slice(0, 200), isDraft: false });

  async function graphFake(_t, method, path, opts = {}) {
    const p = decodeURIComponent(path);
    if (method === 'GET' && p.startsWith('/me/mailFolders/inbox/messages')) {
      const since = Date.parse((p.match(/receivedDateTime ge ([^ &]+)/) || [])[1] || 0) || 0;
      return { value: inbox.filter(m => !m.isRead && Date.parse(m.receivedDateTime) >= since).map(strip) };
    }
    if (method === 'GET' && p.startsWith('/me/mailFolders/sentitems/messages')) {
      const to = (p.match(/to:([^"]+)"/) || [])[1];
      const list = to ? sent.filter(s => s.to === to) : sent;
      return { value: list.map(s => ({ ...s, bodyPreview: s.body.content.slice(0, 200) })) };
    }
    if (method === 'POST' && p === '/me/sendMail') {
      const msg = opts.body?.message || {};
      outbox.push({ id: `n-${outbox.length + 1}`, nuova: true, subject: msg.subject, toRecipients: msg.toRecipients || [], ccRecipients: msg.ccRecipients || [], body: msg.body });
      return null;
    }
    let m = p.match(/^\/me\/messages\/([^/?]+)\/(createReply|createReplyAll)$/);
    if (m && method === 'POST') {
      const orig = inbox.find(x => x.id === m[1]);
      if (!orig) throw new HttpError(404, 'Elemento non trovato su Microsoft 365');
      const id = `r-${orig.id}-${drafts.size + 1}`;
      const d = { id, replyTo: orig.id, all: m[2] === 'createReplyAll', to: [orig.from, ...(m[2] === 'createReplyAll' ? orig.ccRecipients || [] : [])], body: { contentType: 'HTML', content: `<hr><p>Da: ${orig.from.emailAddress.name}</p><p>${orig.body}</p>` } };
      drafts.set(id, d);
      return d;
    }
    m = p.match(/^\/me\/messages\/([^/?]+)\/send$/);
    if (m && method === 'POST') {
      const d = drafts.get(m[1]);
      if (!d) throw new HttpError(404, 'Elemento non trovato su Microsoft 365');
      drafts.delete(m[1]);
      outbox.push(d);
      const orig = inbox.find(x => x.id === d.replyTo);
      sent.push({ id: d.id, conversationId: orig?.conversationId, sentDateTime: new Date().toISOString(), to: orig?.from.emailAddress.address, body: { content: d.body.content } });
      return null;
    }
    m = p.match(/^\/me\/messages\/([^/?]+)(\?.*)?$/);
    if (m && method === 'PATCH') {
      if (drafts.has(m[1])) { Object.assign(drafts.get(m[1]), opts.body || {}); return drafts.get(m[1]); }
      const orig = inbox.find(x => x.id === m[1]);
      if (!orig) throw new HttpError(404, 'Elemento non trovato su Microsoft 365');
      Object.assign(orig, opts.body || {});
      return orig;
    }
    if (m && method === 'GET') {
      const orig = inbox.find(x => x.id === m[1]);
      if (!orig) throw new HttpError(404, 'Elemento non trovato su Microsoft 365');
      return { ...orig, body: { contentType: 'text', content: orig.body } };
    }
    throw new HttpError(501, `Casella finta: ${method} ${p} non previsto`);
  }
  return { graph: graphFake, inbox, sent, outbox };
}

module.exports = { createPostaVoceFake };
