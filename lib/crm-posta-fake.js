// Casella Outlook finta per «Posta» e «Progetto da email» in locale e nei test (senza Microsoft 365 collegato).
// Stessa forma delle risposte di Graph usate da routes/crm-posta.js. La conversazione del data center è quella del
// canvas «Progetto da email»; due risposte arrivano dopo (arrive() nei test, da sole dopo 2 minuti in locale).
const { HttpError } = require('./http');

const at = (days, hh = 9, mm = 0) => { const d = new Date(Date.now() - days * 864e5); d.setUTCHours(hh - 1, mm, 0, 0); return d.toISOString(); };
const P = (name, address) => ({ emailAddress: { name, address } });
const ME = P('Dante Marramiero', 'direzione@almacis.it');
const MARCO = P('Marco Bianchi', 'marco.bianchi@almacis.it');
const ROSSI = P('Luca Rossi', 'l.rossi@studiotecnicorossi.it');
const SARA = P('Sara Marini', 's.marini@studiotecnicorossi.it');
const PACE = P('Andrea Pace', 'andrea.pace@studiopace-ing.com');
const VERDI = P('Giulia Verdi', 'g.verdi@adriatica-advisors.it');
const DC = 'conv-datacenter';
const FIRMA_ROSSI = '\n\nCordiali saluti\nIng. Luca Rossi · Direttore tecnico\nStudio Tecnico Rossi s.r.l. · Via Roma 12, 65121 Pescara (PE)\nTel. 085 123 4567 · Cell. 333 765 4321';
const FIRMA_SARA = '\n\nSaluti\nSara Marini\nUfficio tecnico · Studio Tecnico Rossi s.r.l.\nCell. 340 221 0098';

function base() {
  return [
    { id: 'm-dc-1', conversationId: DC, subject: 'Data center Chieti Scalo, impianti', from: ME, toRecipients: [ROSSI], ccRecipients: [MARCO], receivedDateTime: at(1, 18, 30), hasAttachments: false,
      body: 'Buonasera Luca,\ncome da telefonata, siamo interessati al data center. Mi mandi il computo quando ce l\'hai? Vi mando io le referenze sui data center che abbiamo fatto.\n\nDante' },
    { id: 'm-dc-2', conversationId: DC, subject: 'Re: Data center Chieti Scalo, impianti', from: ROSSI, toRecipients: [ME], ccRecipients: [SARA, MARCO], receivedDateTime: at(0, 9, 12), hasAttachments: true,
      body: `Buongiorno Dante,\ncome anticipato al telefono, il nostro cliente sta definendo il nuovo data center nell'area industriale di Chieti Scalo: circa 4 MW IT in prima fase, edificio nuovo su lotto già acquistato. Ci serve un'impresa per impianti elettrici, raffrescamento e opere civili.\nVi allego il computo preliminare (circa 18 milioni). L'obiettivo è chiudere le offerte entro fine gennaio e partire con i lavori a maggio. Possiamo vederci la settimana prossima per un sopralluogo?${FIRMA_ROSSI}` },
    // email passate a Luca (ALM2-61: da qui Alma legge il tono: tu, «Ciao Luca,», «A presto, Dante»)
    { id: 'm-old-1', conversationId: 'conv-referenze', subject: 'Referenze impianti', from: ME, toRecipients: [ROSSI], ccRecipients: [], receivedDateTime: at(12, 17, 10), hasAttachments: false,
      body: 'Ciao Luca,\nti giro le referenze che ti dicevo: due data center e il polo logistico di Ortona.\nFammi sapere se ti serve altro.\n\nA presto,\nDante' },
    { id: 'm-old-2', conversationId: 'conv-cena', subject: 'Venerdì', from: ME, toRecipients: [ROSSI], ccRecipients: [], receivedDateTime: at(25, 19, 0), hasAttachments: false,
      body: 'Ciao Luca,\nconfermato venerdì, ci vediamo lì alle 20.\n\nA presto,\nDante' },
    { id: 'm-mn-1', conversationId: 'conv-manut', subject: 'Contratto quadro manutenzioni', from: SARA, toRecipients: [ME], ccRecipients: [], receivedDateTime: at(1, 16, 0), hasAttachments: false,
      body: `Buongiorno,\nvi giro la bozza del contratto quadro per le manutenzioni 2026.${FIRMA_SARA}` },
    // ALM2-78: proposta di un impianto in vendita, per «+ Opportunità» → pipeline di Alma Energy
    { id: 'm-fv-1', conversationId: 'conv-fv-lanciano', subject: 'Cessione impianto FV 1,8 MWp Lanciano', from: VERDI, toRecipients: [ME], ccRecipients: [], receivedDateTime: at(0, 16, 40), hasAttachments: false,
      body: 'Buongiorno,\nun nostro cliente cede un impianto fotovoltaico a terra da 1,8 MWp a Lanciano (CH), in esercizio dal 2012, con convenzione GSE fino al 2032. Se siete interessati vi mandiamo i dati di produzione degli ultimi tre anni.\n\nCordiali saluti\nGiulia Verdi\nAdvisor · Adriatica Energy Advisors s.r.l.\nCell. 335 600 1122' },
    { id: 'm-pc-1', conversationId: 'conv-pace', subject: 'Sopralluogo capannone Val Pescara', from: PACE, toRecipients: [ME], ccRecipients: [], receivedDateTime: at(3, 11, 0), hasAttachments: false,
      body: 'Ciao,\nok per giovedì per il sopralluogo al capannone.\n\nSaluti\nAndrea Pace\nResponsabile progettazione\nStudio Pace Ingegneria\nCell. 347 112 2334' },
    { id: 'm-rf-1', conversationId: 'conv-raffresc', subject: 'Preventivo raffrescamento', from: ROSSI, toRecipients: [ME], ccRecipients: [], receivedDateTime: at(0, 8, 0), hasAttachments: false,
      body: `Dante,\nper il data center di Chieti ci serve anche un vostro preventivo indicativo sul raffrescamento a parte.${FIRMA_ROSSI}` },
  ];
}
// le due risposte che arrivano dopo la creazione del progetto
function later() {
  return [
    { id: 'm-dc-3', conversationId: DC, subject: 'Re: Data center Chieti Scalo, impianti', from: MARCO, toRecipients: [ROSSI], ccRecipients: [ME, SARA], receivedDateTime: new Date(Date.now() - 3 * 36e5).toISOString(), hasAttachments: false,
      body: 'Giovedì ci sono anch\'io.\n\nMarco' },
    { id: 'm-dc-4', conversationId: DC, subject: 'Re: Data center Chieti Scalo, impianti', from: SARA, toRecipients: [ME], ccRecipients: [ROSSI, MARCO], receivedDateTime: new Date(Date.now() - 1 * 36e5).toISOString(), hasAttachments: false,
      body: `Buongiorno,\nconfermo il sopralluogo giovedì 27 alle 10, ingresso dal lotto 7. Il committente è Adriatica Data srl.${FIRMA_SARA}` },
  ];
}

function createPostaFake({ autoArriveMs = 0 } = {}) {
  const box = base();
  let arrived = false;
  const started = Date.now();
  const arrive = () => { if (!arrived) { arrived = true; box.push(...later()); } };
  const visible = () => { if (autoArriveMs && Date.now() - started > autoArriveMs) arrive(); return box; };
  // cartelle (ALM2-60): id → cartella; di default In arrivo o Inviate secondo chi scrive
  const where = new Map();
  const FOLDERS = [
    { id: 'f-inbox', displayName: 'Posta in arrivo', wk: 'inbox', parent: null }, { id: 'f-clienti', displayName: 'Clienti', parent: 'f-inbox' }, { id: 'f-fornitori', displayName: 'Fornitori', parent: 'f-inbox' },
    { id: 'f-sent', displayName: 'Posta inviata', wk: 'sentitems', parent: null }, { id: 'f-archive', displayName: 'Archivio', wk: 'archive', parent: null },
    { id: 'f-deleted', displayName: 'Posta eliminata', wk: 'deleteditems', parent: null }, { id: 'f-drafts', displayName: 'Bozze', wk: 'drafts', parent: null }, { id: 'f-gare', displayName: 'Gare', parent: null },
  ];
  const fid = x => FOLDERS.find(y => y.id === x || y.wk === x)?.id || null;
  const folderOf = m => where.get(m.id) || (m.from.emailAddress.address === ME.emailAddress.address ? 'f-sent' : 'f-inbox');
  const withIds = m => ({ ...m, parentFolderId: folderOf(m), internetMessageId: `<${m.id}@fake>`, isDraft: false, bodyPreview: m.body.replace(/\s+/g, ' ').slice(0, 200), body: { contentType: 'text', content: m.body }, webLink: `https://outlook.office.com/mail/${m.id}` });
  const sorted = list => list.slice().sort((a, b) => String(b.receivedDateTime).localeCompare(String(a.receivedDateTime))).map(withIds);
  const sent = [];
  const drafts = []; // bozze salvate in Outlook (ALM2-61)
  return {
    arrive,
    // una risposta nuova in una conversazione (test di ALM2-78)
    reply(conversationId, { id, from = 'verdi', body }) {
      const who = { verdi: VERDI, me: ME }[from] || VERDI;
      const orig = box.find(m => m.conversationId === conversationId);
      box.push({ id, conversationId, subject: `Re: ${orig.subject}`, from: who, toRecipients: [ME], ccRecipients: [], receivedDateTime: new Date().toISOString(), hasAttachments: false, body });
    },
    sent,
    drafts,
    where,
    uploads: [],
    async upload(url, buf) { this.uploads.push({ url, size: buf.length }); },
    async graph(_t, method, path, opts = {}) {
      const p = decodeURIComponent(path);
      const rp = p.match(/^\/me\/messages\/([^/?]+)\/(reply|replyAll)$/);
      if (method === 'POST' && rp) {
        const orig = visible().find(m => m.id === rp[1]);
        if (!orig) throw new HttpError(404, 'Email non trovata');
        const msg = opts.body?.message || {};
        const reply = { id: `m-sent-${sent.length + 1}`, conversationId: orig.conversationId, subject: `Re: ${orig.subject.replace(/^Re:\s*/i, '')}`, from: ME, toRecipients: msg.toRecipients || [orig.from], ccRecipients: msg.ccRecipients || (rp[2] === 'replyAll' ? orig.ccRecipients : []), receivedDateTime: new Date().toISOString(), hasAttachments: false, body: opts.body?.comment || '', kind: rp[2] };
        box.push(reply); sent.push(reply);
        return null;
      }
      // Bozze di risposta/inoltro (ALM2-64): createReply/ReplyAll/Forward → allegati → PATCH → send
      const cr = p.match(/^\/me\/messages\/([^/?]+)\/(createReply|createReplyAll|createForward)$/);
      if (method === 'POST' && cr) {
        const orig = visible().find(x => x.id === cr[1]);
        if (!orig) throw new HttpError(404, 'Email non trovata');
        const kind = { createReply: 'reply', createReplyAll: 'replyAll', createForward: 'forward' }[cr[2]];
        const d = { id: `d-${drafts.length + 1}`, reply_to: cr[1], kind, all: kind === 'replyAll', orig, deleted: false, sent: false, patch: null,
          attachments: kind === 'forward' && orig.hasAttachments ? [{ id: 'fa1', name: 'Computo_preliminare_DC.pdf', isInline: false, size: 2400000 }] : [] };
        drafts.push(d);
        return { id: d.id, webLink: `https://outlook.office.com/mail/drafts/${d.id}`, body: { contentType: 'html', content: `<html><head></head><body><hr><p>Da: ${orig.from.emailAddress.name}</p><p>${orig.body.replace(/\n/g, '<br>')}</p></body></html>` } };
      }
      // email nuova (ALM2-68): bozza vuota con l'oggetto
      if (method === 'POST' && p === '/me/messages') {
        const d = { id: `d-${drafts.length + 1}`, reply_to: null, kind: 'new', all: false, orig: { conversationId: `conv-new-${drafts.length + 1}`, subject: opts.body?.subject || '' }, subject: opts.body?.subject || '', deleted: false, sent: false, patch: null, attachments: [] };
        drafts.push(d);
        return { id: d.id, webLink: `https://outlook.office.com/mail/drafts/${d.id}`, body: { contentType: 'html', content: '' } };
      }
      const dr = p.match(/^\/me\/messages\/(d-\d+)(\/.*)?$/);
      if (dr) {
        const d = drafts.find(x => x.id === dr[1]);
        if (!d || d.deleted) throw new HttpError(404, 'Elemento non trovato su Microsoft 365');
        const rest = (dr[2] || '').split('?')[0];
        if (method === 'DELETE' && !rest) { d.deleted = true; return null; }
        if (method === 'PATCH' && !rest) { d.patch = opts.body; d.to = (opts.body.toRecipients || []).map(r => r.emailAddress.address); return { id: d.id }; }
        if (method === 'GET' && rest === '/attachments') return { value: d.attachments };
        if (method === 'POST' && rest === '/attachments') { const a = { id: `na${d.attachments.length + 1}`, ...opts.body }; d.attachments.push(a); return a; }
        if (method === 'POST' && rest === '/attachments/createUploadSession') { const it = opts.body.AttachmentItem; d.attachments.push({ id: `big${d.attachments.length + 1}`, name: it.name, size: it.size, isInline: false }); return { uploadUrl: `fake-upload://${d.id}/${it.name}` }; }
        const da = rest.match(/^\/attachments\/([^/]+)$/);
        if (method === 'DELETE' && da) { d.attachments = d.attachments.filter(a => a.id !== da[1]); return null; }
        if (method === 'POST' && rest === '/send') {
          d.sent = true;
          const msg = { id: `m-sent-${sent.length + 1}`, conversationId: d.orig.conversationId, subject: d.kind === 'new' ? d.subject : d.patch?.subject || `${d.kind === 'forward' ? 'I' : 'Re'}: ${d.orig.subject.replace(/^Re:\s*/i, '')}`, from: ME, bccRecipients: d.patch?.bccRecipients || [],
            toRecipients: d.patch?.toRecipients || [], ccRecipients: d.patch?.ccRecipients || [], receivedDateTime: new Date().toISOString(), hasAttachments: d.attachments.some(a => !a.isInline),
            body: d.patch?.body?.content || '', kind: d.kind, attachments: d.attachments };
          box.push(msg); sent.push(msg);
          return null;
        }
      }
      const mv = p.match(/^\/me\/messages\/([^/?]+)\/move$/);
      if (method === 'POST' && mv) {
        const one = visible().find(x => x.id === mv[1]);
        const to = fid(opts.body?.destinationId);
        if (!one || !to) throw new HttpError(404, 'Elemento non trovato su Microsoft 365');
        where.set(one.id, to);
        return withIds(one);
      }
      const wk = p.match(/^\/me\/mailFolders\/([a-z]+)\?\$select=id$/);
      if (wk) {
        const f = FOLDERS.find(y => y.wk === wk[1]);
        if (!f) throw new HttpError(404, 'Elemento non trovato su Microsoft 365');
        return { id: f.id };
      }
      const cf = p.match(/^\/me\/mailFolders(?:\/([^/?]+)\/childFolders)?\?/);
      if (method === 'GET' && cf) {
        const parent = cf[1] ? fid(cf[1]) : null;
        const n = id => visible().filter(x => folderOf(x) === id).length;
        return { value: FOLDERS.filter(f => f.parent === parent).map(f => ({ id: f.id, displayName: f.displayName, parentFolderId: f.parent, childFolderCount: FOLDERS.filter(k => k.parent === f.id).length, totalItemCount: n(f.id), unreadItemCount: 0 })) };
      }
      if (method === 'POST' && p.startsWith('/me/sendMail')) { sent.push(opts.body); return null; }
      let m = p.match(/^\/me\/messages\/([^/?]+)\/attachments\/[^/]+\/\$value/);
      if (m) return Buffer.from('%PDF-1.4 computo preliminare finto');
      m = p.match(/^\/me\/messages\/([^/?]+)\/attachments/);
      if (m) return { value: m[1] === 'm-dc-2' ? [{ '@odata.type': '#microsoft.graph.fileAttachment', id: 'a1', name: 'Computo_preliminare_DC.pdf', contentType: 'application/pdf', size: 2400000, isInline: false }] : [] };
      m = p.match(/^\/me\/messages\/([^/?]+)(\?|$)/);
      if (m) {
        const one = visible().find(x => x.id === m[1]);
        if (!one) throw new HttpError(404, 'Email non trovata');
        return withIds(one);
      }
      const filter = (p.match(/\$filter=([^&]+)/) || [])[1] || '';
      const search = ((p.match(/\$search="([^"]*)"/) || [])[1] || '').toLowerCase();
      let list = visible();
      const conv = filter.match(/conversationId eq '([^']+)'/);
      if (conv) list = list.filter(x => x.conversationId === conv[1]);
      const imid = filter.match(/internetMessageId eq '([^']+)'/);
      if (imid) list = list.filter(x => `<${x.id}@fake>` === imid[1]);
      if (search.startsWith('to:')) {
        const a = search.slice(3);
        list = list.filter(x => (x.toRecipients || []).some(r => r.emailAddress.address.toLowerCase() === a));
      } else if (search) {
        const q = search.replace(/^from:/, '');
        list = list.filter(x => [x.subject, x.body, x.from.emailAddress.address, x.from.emailAddress.name].some(s => String(s).toLowerCase().includes(q)));
      }
      const inF = p.match(/\/mailFolders\/([^/]+)\/messages/);
      if (inF) { const id = fid(inF[1]); list = list.filter(x => folderOf(x) === id); }
      return { value: sorted(list) };
    },
  };
}

module.exports = { createPostaFake, DC };
