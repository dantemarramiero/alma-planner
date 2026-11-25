// ALM2-94 «Segnala un'opportunità» (canvas approvato da Dante il 25/11/2026): i messaggi Teams ed email
// a chi deve decidere, con lo screenshot dentro e i pulsanti «Tienila» / «Scartala» che aprono Alma con la scelta pronta.
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const textToHtml = s => escapeHtml(s).replace(/\r?\n/g, '<br>');
const dots = parts => parts.filter(Boolean).join(' · ');

const MAIL_ATTACH_MAX = 3 * 1024 * 1024; // Microsoft Graph accetta fino a ~4 MB per sendMail: il resto si apre in Alma
const TEAMS_IMAGE_MAX = 1024 * 1024;      // lo screenshot dentro il messaggio di Teams
const INLINE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const eur = n => (n === null || n === undefined || n === '' ? '' : Number(n) >= 1e6
  ? `${(Number(n) / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 2 })} M€` : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0 })} €`);
const itDay = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' }) : '');

// link che apre la segnalazione in Alma, con la scelta già pronta
const links = (baseUrl, id) => ({
  open: `${baseUrl}/app#/crm/segnale/${id}`,
  tieni: `${baseUrl}/app#/crm/segnale/${id}?decidi=tieni`,
  scarta: `${baseUrl}/app#/crm/segnale/${id}?decidi=scarta`,
});

function summaryLine(g) {
  return dots([g.subject_name || g.entity, eur(g.amount), g.score !== null && g.score !== undefined ? `punteggio ${g.score}` : '']);
}

// Teams: testo, scheda, screenshot (se c'è e non è troppo grande), elenco allegati, due link
function teamsMessage({ g, message, dueOn, files, baseUrl }) {
  const l = links(baseUrl, g.id);
  const shot = files.find(f => f.screenshot && INLINE_TYPES.includes(f.content_type) && f.size <= TEAMS_IMAGE_MAX && f.data);
  const docs = files.filter(f => !f.screenshot);
  const html = [
    `<p>${message ? textToHtml(message) : 'Ti chiedo di decidere su questa opportunità del Radar.'}</p>`,
    `<p><b>Alma Space · Radar${dueOn ? ` · decidi entro ${escapeHtml(itDay(dueOn))}` : ''}</b><br><b>${escapeHtml(g.title)}</b>${summaryLine(g) ? `<br>${escapeHtml(summaryLine(g))}` : ''}</p>`,
    shot ? '<p><img src="../hostedContents/1/$value" alt="Screenshot" style="max-width:480px"></p>' : '',
    docs.length ? `<p>${docs.length === 1 ? '1 allegato' : `${docs.length} allegati`}: ${docs.map(f => escapeHtml(f.name)).join(', ')} (si aprono in Alma)</p>` : '',
    `<p><a href="${escapeHtml(l.tieni)}"><b>Tienila</b></a> &nbsp;·&nbsp; <a href="${escapeHtml(l.scarta)}">Scartala</a> &nbsp;·&nbsp; <a href="${escapeHtml(l.open)}">Apri in Alma</a></p>`,
  ].join('');
  const hosted = shot ? [{ '@microsoft.graph.temporaryId': '1', contentBytes: Buffer.from(shot.data).toString('base64'), contentType: shot.content_type }] : [];
  return { html, hosted, textOnly: html.replace(/<p><img[^>]*><\/p>/, '') };
}

// Email: dalla casella di chi segnala; screenshot nel corpo, documenti allegati (fino a ~3 MB, il resto in Alma)
function mailMessage({ g, from, message, dueOn, files, baseUrl }) {
  const l = links(baseUrl, g.id);
  const font = 'font-family:Roboto,Segoe UI,Arial,sans-serif';
  let budget = MAIL_ATTACH_MAX;
  const attachments = [];
  const inAlma = [];
  const shots = [];
  for (const f of files) {
    if (!f.data || f.size > budget) { inAlma.push(f.name); continue; }
    budget -= f.size;
    const inline = f.screenshot && INLINE_TYPES.includes(f.content_type);
    const cid = inline ? `shot${f.id}@alma` : undefined;
    if (inline) shots.push(cid);
    attachments.push({ '@odata.type': '#microsoft.graph.fileAttachment', name: f.name, contentType: f.content_type, contentBytes: Buffer.from(f.data).toString('base64'), ...(inline ? { isInline: true, contentId: cid } : {}) });
  }
  const btn = (href, label, primary) => `<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 18px;border-radius:10px;${primary ? 'background:#FF8A26;color:#FFFFFF;' : 'border:1px solid #DCDCDA;color:#3F3F3F;'}text-decoration:none;font-weight:500">${label}</a>`;
  const html = `<div style="${font};font-size:14px;color:#2C2C2C;line-height:1.5">
<p>Ciao,</p>
<p>${message ? textToHtml(message) : 'ti chiedo di decidere su questa opportunità del Radar: la teniamo o la scartiamo?'}</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="border:1px solid #ECEAE6;border-top:4px solid #FF8A26;border-radius:14px;margin:16px 0;width:100%;max-width:560px"><tr><td style="padding:16px 18px">
<div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#B85A0A;font-weight:500">Alma Space · Radar</div>
<div style="font-size:17px;font-weight:700;margin:4px 0">${escapeHtml(g.title)}</div>
${summaryLine(g) ? `<div style="font-size:13px;color:#6B6B6B">${escapeHtml(summaryLine(g))}</div>` : ''}
${g.summary ? `<p style="margin:10px 0 0">${textToHtml(g.summary)}</p>` : ''}
${shots.map(cid => `<p style="margin:12px 0 0"><img src="cid:${cid}" alt="Screenshot" style="max-width:100%;border-radius:8px;border:1px solid #ECEAE6"></p>`).join('')}
<div style="margin-top:14px">${btn(l.tieni, 'Tienila', true)}${btn(l.scarta, 'Scartala', false)}<a href="${escapeHtml(l.open)}" style="color:#B85A0A">Apri in Alma</a></div>
${dueOn ? `<div style="font-size:12px;color:#6B6B6B;margin-top:6px">Rispondi entro ${escapeHtml(itDay(dueOn))}.</div>` : ''}
${inAlma.length ? `<div style="font-size:12px;color:#6B6B6B;margin-top:6px">Troppo grandi per la mail, li trovi in Alma: ${inAlma.map(escapeHtml).join(', ')}</div>` : ''}
</td></tr></table>
<p>${escapeHtml(from.name || '')}</p></div>`;
  const subject = `Da decidere: ${g.title}`.slice(0, 250);
  return { subject, html, attachments };
}

module.exports = { teamsMessage, mailMessage, links, INLINE_TYPES, MAIL_ATTACH_MAX, TEAMS_IMAGE_MAX };
