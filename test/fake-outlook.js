// Casella Outlook finta per i test e per l'azienda simulata: risponde come Microsoft Graph alle chiamate
// sulla posta (/me/messages, /me/mailFolders/*/messages, allegati). Il token finto «fake:<userId>» sceglie la casella.
// Le stesse email (stesso internetMessageId) possono stare nelle caselle di più persone, come nella realtà.
const GRAPH = 'https://graph.microsoft.com/v1.0';

const OGGETTI = ['Verbale riunione di avanzamento', 'Offerta economica aggiornata', 'Richiesta chiarimenti capitolato', 'Planimetrie definitive',
  'Conferma sopralluogo', 'Fattura acconto lavori', 'Cronoprogramma rivisto', 'Documentazione sicurezza cantiere', 'Convocazione collaudo', 'Varianti in corso d\'opera'];
const MITTENTI = [['Ing. Paolo Verdi', 'p.verdi@regione.abruzzo.it'], ['Studio Rossi Architetti', 'info@studiorossi.it'], ['Ufficio Gare ASL', 'gare@asl.example.it'],
  ['Marta Bianchi', 'm.bianchi@fornitore.example.com'], ['Comune di Teramo', 'protocollo@comune.teramo.example.it']];

function buildMailbox(seed, count = 60) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const k = (seed * 7 + i) % OGGETTI.length;
    const [name, address] = MITTENTI[(seed + i) % MITTENTI.length];
    const shared = i % 5 === 0; // una email su cinque arriva a tutti: stesso internetMessageId
    const imid = shared ? `<condivisa-${i}@example.it>` : `<u${seed}-${i}@example.it>`;
    const when = new Date(Date.UTC(2026, 9, 7, 9) - i * 3 * 3600 * 1000).toISOString();
    const withFiles = i % 3 === 0;
    out.push({
      id: `msg-${seed}-${i}`,
      subject: `${OGGETTI[k]}${i > 9 ? ` (${i})` : ''}`,
      from: { emailAddress: { name, address } },
      toRecipients: [{ emailAddress: { name: 'Team Almacis', address: 'team@almacis.it' } }],
      ccRecipients: i % 4 === 0 ? [{ emailAddress: { name: 'Direzione', address: 'direzione@almacis.it' } }] : [],
      receivedDateTime: when, sentDateTime: when,
      bodyPreview: `Buongiorno, in allegato quanto richiesto per ${OGGETTI[k].toLowerCase()}.`,
      body: { contentType: 'text', content: `Buongiorno,\n\nin allegato quanto richiesto per ${OGGETTI[k].toLowerCase()}.\nRestiamo a disposizione per chiarimenti.\n\nCordiali saluti\n${name}` },
      hasAttachments: withFiles, internetMessageId: imid, isDraft: false, folder: i % 4 === 3 ? 'sentitems' : 'inbox',
      webLink: `https://outlook.office.com/mail/id/msg-${seed}-${i}`,
      attachments: withFiles ? [
        { id: 'a1', name: `${OGGETTI[k]}.pdf`, contentType: 'application/pdf', isInline: false, data: Buffer.from(`%PDF-1.4 finto ${i}`) },
        { id: 'a2', name: 'logo.png', contentType: 'image/png', isInline: true, data: Buffer.from('png') },
      ] : [],
    });
  }
  return out;
}

function installFakeOutlook({ auth, mailboxSize = 60, denyMailRead = false } = {}) {
  const boxes = new Map();
  const sentMail = []; // email mandate con /me/sendMail (riepilogo del mattino, email di assegnazione)
  const box = uid => { if (!boxes.has(uid)) boxes.set(uid, buildMailbox(uid, mailboxSize)); return boxes.get(uid); };
  auth.graphToken = async userId => `fake:${userId}`;
  const realFetch = global.fetch;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.startsWith(`${GRAPH}/me/`)) return realFetch(url, opts);
    const authz = opts.headers?.Authorization || '';
    const uid = Number(authz.replace('Bearer fake:', ''));
    if (denyMailRead) return json(403, { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } });
    if (u === `${GRAPH}/me/sendMail`) { sentMail.push({ from: uid, ...JSON.parse(opts.body) }); return new Response(null, { status: 202 }); }
    const parsed = new URL(u);
    const path = parsed.pathname.replace('/v1.0', '');
    const mails = box(uid);
    let m;
    if ((m = path.match(/^\/me\/(?:mailFolders\/(\w+)\/)?messages$/))) {
      let list = m[1] ? mails.filter(x => x.folder === m[1]) : mails;
      const q = (parsed.searchParams.get('$search') || '').replace(/"/g, '').toLowerCase();
      if (q) list = list.filter(x => `${x.subject} ${x.from.emailAddress.name} ${x.body.content}`.toLowerCase().includes(q));
      const top = Number(parsed.searchParams.get('$top') || 10), skip = Number(parsed.searchParams.get('$skip') || 0);
      const page = list.slice(skip, skip + top).map(({ attachments, body, folder, ...x }) => x);
      const next = skip + top < list.length ? (() => { const n = new URL(u); n.searchParams.set('$skip', String(skip + top)); return n.toString(); })() : undefined;
      return json(200, { value: page, ...(next ? { '@odata.nextLink': next } : {}) });
    }
    if ((m = path.match(/^\/me\/messages\/([^/]+)\/attachments\/([^/]+)\/\$value$/))) {
      const a = mails.find(x => x.id === decodeURIComponent(m[1]))?.attachments.find(x => x.id === decodeURIComponent(m[2]));
      return a ? new Response(a.data, { status: 200 }) : json(404, { error: { message: 'Not found' } });
    }
    if ((m = path.match(/^\/me\/messages\/([^/]+)\/attachments$/))) {
      const x = mails.find(y => y.id === decodeURIComponent(m[1]));
      if (!x) return json(404, { error: { message: 'Not found' } });
      return json(200, { value: x.attachments.map(a => ({ '@odata.type': '#microsoft.graph.fileAttachment', id: a.id, name: a.name, contentType: a.contentType, size: a.data.length, isInline: a.isInline })) });
    }
    if ((m = path.match(/^\/me\/messages\/([^/]+)$/))) {
      const x = mails.find(y => y.id === decodeURIComponent(m[1]));
      if (!x) return json(404, { error: { message: 'Not found' } });
      const { attachments, folder, ...rest } = x;
      return json(200, rest);
    }
    return json(404, { error: { message: `Finto Graph: ${path} non previsto` } });
  };
  return { mailbox: box, sentMail, restore: () => { global.fetch = realFetch; } };
}

module.exports = { installFakeOutlook };
