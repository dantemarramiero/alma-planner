// Casella Outlook finta per Alma Procurement in locale e nei test (senza Microsoft 365 collegato).
// Stessa forma delle risposte di Graph che usano routes/procurement.js e lib/crm-posta-invio.js:
// - posta inviata con qualche email passata a «Marco» (Stradaioli): da qui Alma legge il tono (tu, «Ciao Marco,»);
// - bozza → PATCH → send: l'email finisce tra le inviate con il suo conversationId;
// - arrive(): una risposta del fornitore nella stessa conversazione (nei test a comando, in locale da sola dopo un po').
let seq = 0;
const nid = p => `${p}-${Date.now().toString(36)}-${(seq += 1)}`;
const at = days => new Date(Date.now() - days * 864e5).toISOString();
const P = (name, address) => ({ emailAddress: { name, address } });
const ME = P('Ufficio acquisti', 'direzione@almacis.it');

// risposte d'esempio in locale (indirizzo → testo); chi non c'è non risponde
const REPLIES = {
  'marco@stradaiolicalcestruzzi.it': 'Ciao,\nper Roma Sud ti facciamo 96 €/m³ franco cantiere, pompa a parte 12 €/m³. Consegna dal 15 gennaio senza problemi.\nPagamento 60 gg DFFM.\n\nA presto\nMarco',
  'commerciale@heidelberg-esempio.it': 'Buongiorno,\nla nostra migliore offerta è 104,00 € al m³ pompa inclusa, disponibilità dal 22 gennaio. Pagamento 90 gg data fattura.\nIn allegato il certificato FPC.\n\nCordiali saluti',
};

function createProcurementFake({ autoReplyMs = 0 } = {}) {
  const sent = [
    { id: 'pf-old-1', conversationId: 'pf-c-old-1', subject: 'Getto AL1001', toRecipients: [P('Marco', 'marco@stradaiolicalcestruzzi.it')], from: ME, sentDateTime: at(12),
      body: { content: 'Ciao Marco,\nmi confermi il getto di giovedì alle 7? Servono 40 m³.\n\nGrazie, a presto\nUfficio acquisti' } },
    { id: 'pf-old-2', conversationId: 'pf-c-old-2', subject: 'Fattura ottobre', toRecipients: [P('Marco', 'marco@stradaiolicalcestruzzi.it')], from: ME, sentDateTime: at(30),
      body: { content: 'Ciao Marco,\nti giro la contestazione sulla bolla 1182, ci sentiamo domani.\n\nA presto\nUfficio acquisti' } },
    { id: 'pf-old-3', conversationId: 'pf-c-old-3', subject: 'Richiesta documenti', toRecipients: [P('Ufficio commerciale', 'info@ariccia-esempio.it')], from: ME, sentDateTime: at(40),
      body: { content: 'Gentili,\nvi chiediamo cortesemente il DURC aggiornato.\n\nCordiali saluti\nUfficio acquisti' } },
  ];
  const drafts = new Map();
  const inbox = [];
  const timers = [];

  function arrive(conversationId, { from, text }) {
    const m = { id: nid('pf-in'), conversationId, subject: 'Re: richiesta di quotazione', from: P(from.split('@')[0], from), toRecipients: [ME],
      receivedDateTime: new Date().toISOString(), bodyPreview: text.slice(0, 250), body: { contentType: 'text', content: text } };
    inbox.push(m);
    return m;
  }

  async function graph(_t, method, path, opts = {}) {
    const url = new URL(`https://graph.invalid/v1.0${path}`);
    const p = url.pathname.replace('/v1.0', '');
    if (method === 'GET' && p === '/me/mailFolders/sentitems/messages') {
      const s = (url.searchParams.get('$search') || '').replace(/"/g, '').replace(/^to:/, '').toLowerCase();
      return { value: sent.filter(m => !s || m.toRecipients.some(r => r.emailAddress.address === s)) };
    }
    if (method === 'GET' && p === '/me/messages') {
      const f = url.searchParams.get('$filter') || '';
      const conv = (f.match(/conversationId eq '([^']+)'/) || [])[1];
      return { value: inbox.filter(m => !conv || m.conversationId === conv) };
    }
    if (method === 'GET' && p === '/me') return { displayName: 'Ufficio acquisti', jobTitle: '', mobilePhone: '', businessPhones: [] };
    if (method === 'POST' && p === '/me/messages') {
      const d = { id: nid('pf-d'), conversationId: nid('pf-c'), subject: opts.body?.subject || '', body: { content: '' }, toRecipients: [], webLink: 'https://outlook.office.com/mail/' };
      drafts.set(d.id, d);
      return d;
    }
    const mm = p.match(/^\/me\/messages\/([^/]+)(?:\/(.+))?$/);
    if (mm) {
      const id = decodeURIComponent(mm[1]);
      const d = drafts.get(id);
      if (method === 'PATCH' && d) { Object.assign(d, opts.body || {}); return d; }
      if (method === 'POST' && mm[2] === 'attachments' && d) return { id: nid('att') };
      if (method === 'POST' && mm[2] === 'createReply') {
        const orig = sent.find(m => m.id === id);
        const r = { id: nid('pf-d'), conversationId: orig?.conversationId || nid('pf-c'), subject: `Re: ${orig?.subject || ''}`, body: { content: '' }, toRecipients: [] };
        drafts.set(r.id, r);
        return r;
      }
      if (method === 'DELETE') { drafts.delete(id); return {}; }
      if (method === 'POST' && mm[2] === 'send' && d) {
        drafts.delete(id);
        const msg = { ...d, from: ME, sentDateTime: new Date().toISOString() };
        sent.unshift(msg);
        const to = msg.toRecipients?.[0]?.emailAddress?.address;
        if (autoReplyMs && REPLIES[to]) timers.push(setTimeout(() => arrive(msg.conversationId, { from: to, text: REPLIES[to] }), autoReplyMs).unref?.());
        return {};
      }
    }
    throw Object.assign(new Error(`Casella finta: ${method} ${p} non previsto`), { status: 400 });
  }
  return { graph, upload: async () => ({}), arrive, sent, inbox, stop: () => timers.forEach(t => t && clearTimeout(t)) };
}

module.exports = { createProcurementFake, REPLIES };
