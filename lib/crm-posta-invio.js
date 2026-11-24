// Invio dalla Posta (ALM2-64, tavola H): Rispondi, Rispondi a tutti e Inoltra con A/Cc scelti, allegati e firma Almacis.
// Come Outlook: si crea la bozza della risposta (o dell'inoltro) nella casella di chi scrive, così la citazione
// dell'email e gli allegati originali (inoltra) li mette Outlook; poi si tolgono gli allegati che non servono, si
// aggiungono i file nuovi e il logo della firma, si scrive testo + firma sopra la citazione e si manda (o si lascia
// tra le bozze). Scrivere nella casella chiede Mail.ReadWrite (consenso amministratore dato il 22/11/2026).
const { HttpError } = require('./http');
const F = require('./firma');

const { sanitize, plain } = require('./posta-html');

const MODES = { rispondi: 'createReply', tutti: 'createReplyAll', inoltra: 'createForward', nuova: null }; // nuova: email nuova (ALM2-68)
const SMALL = 3 * 1024 * 1024;           // fino a 3 MB l'allegato va in una richiesta sola
const MAX_TOTAL = 25 * 1024 * 1024;      // in tutto, come chiede la tavola H
const CHUNK = 320 * 1024 * 10;           // 3,125 MB: multiplo di 320 KiB, come vuole Graph
const EMAIL_RE = /^[^\s"@<>]+@[^\s"@<>]+\.[^\s"@<>]+$/;

const people = list => (Array.isArray(list) ? list : []).slice(0, 50).map(p => ({
  address: String(p?.address || '').trim().toLowerCase(), name: String(p?.name || '').trim().slice(0, 120),
})).filter(p => EMAIL_RE.test(p.address)).filter((p, i, a) => a.findIndex(x => x.address === p.address) === i);
const rcpt = list => list.map(p => ({ emailAddress: { address: p.address, ...(p.name ? { name: p.name } : {}) } }));

function files(list) {
  const out = (Array.isArray(list) ? list : []).slice(0, 20).map(f => {
    const name = String(f?.name || '').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);
    const data = String(f?.data || '').replace(/^data:[^,]*,/, '');
    if (!name || !data) throw new HttpError(400, 'Allegato senza nome o vuoto');
    const buf = Buffer.from(data, 'base64');
    return { name, type: String(f?.type || 'application/octet-stream').slice(0, 120), buf };
  });
  const total = out.reduce((s, f) => s + f.buf.length, 0);
  if (total > MAX_TOTAL) throw new HttpError(413, 'Gli allegati superano 25 MB in tutto: togline qualcuno o mandali con un link di OneDrive');
  return out;
}

// Testo + firma subito dopo <body> della bozza, sopra la citazione
function mergeBody(draftHtml, ours) {
  const src = String(draftHtml || '');
  return /<body[^>]*>/i.test(src) ? src.replace(/<body[^>]*>/i, m => `${m}${ours}`) : `${ours}${src}`;
}

// g(t, method, path, opts) = chiamata a Graph (o alla casella finta); upload(url, buf) = caricamento a pezzi.
async function compose({ g, upload, t, id, mode, to, cc, bcc = [], subject = '', text, html = '', attachments = [], drop = [], signature = null, draft = false }) {
  if (!Object.hasOwn(MODES, mode)) throw new HttpError(400, 'Modo non valido');
  if (!to.length && !draft) throw new HttpError(400, 'Scegli almeno un destinatario');
  const written = html ? plain(html) : String(text || '').trim();
  if (!written && mode !== 'inoltra' && !draft) throw new HttpError(400, mode === 'nuova' ? 'Scrivi il testo dell\'email' : 'Scrivi il testo della risposta');
  if (mode === 'nuova' && !String(subject || '').trim()) throw new HttpError(400, 'Scrivi l\'oggetto');
  const d = mode === 'nuova'
    ? await g(t, 'POST', '/me/messages', { body: { subject: String(subject).slice(0, 250), body: { contentType: 'html', content: '' } } })
    : await g(t, 'POST', `/me/messages/${encodeURIComponent(id)}/${MODES[mode]}`, { body: {} });
  if (!d?.id) throw new HttpError(502, 'Outlook non ha preparato la bozza');
  const did = encodeURIComponent(d.id);
  try {
    // inoltra: via gli allegati originali che non servono (non le immagini dentro le firme)
    if (mode === 'inoltra' && drop.length) {
      const list = await g(t, 'GET', `/me/messages/${did}/attachments?$select=id,name,isInline`);
      for (const a of (list?.value || []).filter(x => !x.isInline && drop.includes(x.name))) await g(t, 'DELETE', `/me/messages/${did}/attachments/${encodeURIComponent(a.id)}`);
    }
    for (const f of attachments) {
      if (f.buf.length <= SMALL) {
        await g(t, 'POST', `/me/messages/${did}/attachments`, { body: { '@odata.type': '#microsoft.graph.fileAttachment', name: f.name, contentType: f.type, contentBytes: f.buf.toString('base64') } });
      } else {
        const s = await g(t, 'POST', `/me/messages/${did}/attachments/createUploadSession`, { body: { AttachmentItem: { attachmentType: 'file', name: f.name, size: f.buf.length, contentType: f.type } } });
        await upload(s.uploadUrl, f.buf);
      }
    }
    if (signature) await g(t, 'POST', `/me/messages/${did}/attachments`, { body: F.logoAttachment() });
    const ours = `${html ? sanitize(html) : F.bodyHtml(text || '')}${signature ? F.html(signature) : ''}<p style="margin:0">&nbsp;</p>`;
    await g(t, 'PATCH', `/me/messages/${did}`, { body: {
      toRecipients: rcpt(to), ccRecipients: rcpt(cc), bccRecipients: rcpt(bcc),
      ...(subject && mode !== 'nuova' ? { subject: String(subject).slice(0, 250) } : {}),
      body: { contentType: 'html', content: mergeBody(d.body?.content, ours) },
    } });
    if (draft) return { draft: true, id: d.id, web_link: d.webLink || null, conversation_id: d.conversationId || null };
    await g(t, 'POST', `/me/messages/${did}/send`, { body: {} });
    return { draft: false, id: d.id, conversation_id: d.conversationId || null };
  } catch (err) {
    // non lasciare bozze a metà tra le Bozze di Outlook
    await g(t, 'DELETE', `/me/messages/${did}`).catch(() => {});
    throw err;
  }
}

// Caricamento a pezzi per gli allegati oltre 3 MB (l'URL di Graph è già firmato: niente token)
async function uploadChunks(url, buf, fetchImpl = fetch) {
  for (let start = 0; start < buf.length; start += CHUNK) {
    const part = buf.subarray(start, Math.min(start + CHUNK, buf.length));
    const r = await fetchImpl(url, { method: 'PUT', headers: { 'Content-Length': String(part.length), 'Content-Range': `bytes ${start}-${start + part.length - 1}/${buf.length}` }, body: part });
    if (!r.ok && r.status !== 201 && r.status !== 202) throw new HttpError(502, `Allegato non caricato su Outlook (${r.status})`);
  }
}

module.exports = { compose, uploadChunks, people, files, mergeBody, MODES, MAX_TOTAL };
