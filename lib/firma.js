// Firma Almacis nelle email mandate da Alma (ALM2-64, tavola H approvata da Dante il 22/11/2026).
// - H1 uguale per tutti: logo, indirizzo e sito sono qui (un punto solo); nome, ruolo e telefono sono di ognuno.
// - H2 dal profilo Microsoft (nome visualizzato, ruolo, cellulare/telefono) e dal biglietto da visita; le correzioni
//   salvate in user_signatures restano finché non si preme «Ripristina».
// - H4 il logo viaggia dentro l'email come immagine inline (cid:almacis-logo), come fa Outlook.
// Il modello ricalca la firma di Outlook di Almacis: **Cognome Nome**, ruolo, logo, indirizzo su due righe, Tel., sito.
const fs = require('fs');
const path = require('path');

const COMPANY = {
  address: ['Via P. U. Frasca / Centro Direzionale Dama', '66013 Chieti Scalo (CH) / Italia'],
  site: 'www.almacis.it',
  siteUrl: 'https://www.almacis.it/',
};
const LOGO_CID = 'almacis-logo';
let logoCache = null;
const logo = () => {
  if (!logoCache) logoCache = fs.readFileSync(path.join(__dirname, '..', 'orbita', 'brand', 'almacis', 'almacis-logo.png')).toString('base64');
  return logoCache;
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Dati dal profilo: Microsoft (se raggiungibile) → biglietto da visita → tabella users
async function fromProfile({ db, userId, graphMe }) {
  const { rows: [u] } = await db.query(`SELECT u.name, u.email, u.job_title, b.role AS card_role, b.mobile AS card_mobile, b.phone AS card_phone
                                          FROM users u LEFT JOIN business_cards b ON b.user_id = u.id WHERE u.id = $1`, [userId]);
  let me = null;
  if (graphMe) me = await graphMe().catch(() => null);
  const phones = [me?.mobilePhone, ...(me?.businessPhones || []), u?.card_mobile, u?.card_phone].map(x => String(x || '').trim()).filter(Boolean);
  const uniq = [...new Set(phones)];
  return {
    name: String(me?.displayName || u?.name || '').trim().slice(0, 120),
    role: String(u?.card_role || me?.jobTitle || u?.job_title || '').trim().slice(0, 120),
    phone: (uniq[0] || '').slice(0, 40),
    phone2: (uniq[1] || '').slice(0, 40),
  };
}

// La firma di una persona: quella salvata, altrimenti quella del profilo
async function signatureOf({ db, userId, graphMe }) {
  const { rows: [s] } = await db.query('SELECT enabled, name, role, phone, phone2, updated_at FROM user_signatures WHERE user_id = $1', [userId]);
  const profile = await fromProfile({ db, userId, graphMe: s ? null : graphMe });
  if (!s) return { enabled: true, saved: false, ...profile };
  return { enabled: s.enabled, saved: true, name: s.name || profile.name, role: s.role, phone: s.phone, phone2: s.phone2, updated_at: s.updated_at };
}

// HTML della firma (stile delle email di Outlook: Calibri/Arial 11pt, paragrafi senza margini)
function html(sig, { logoSrc = `cid:${LOGO_CID}` } = {}) {
  const p = (inner, extra = '') => `<p style="margin:0;font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222222;${extra}">${inner}</p>`;
  return [
    '<div class="almacis-firma" style="margin-top:18px">',
    p(`<b>${esc(sig.name)}</b>`),
    sig.role ? p(esc(sig.role), 'color:#555555') : '',
    `<p style="margin:10px 0"><img src="${esc(logoSrc)}" alt="Almacis" width="150" style="width:150px;height:auto;border:0;display:block"></p>`,
    ...COMPANY.address.map(a => p(esc(a))),
    sig.phone ? p(`Tel.&nbsp; ${esc(sig.phone)}${sig.phone2 ? ` &nbsp;/&nbsp; ${esc(sig.phone2)}` : ''}`) : '',
    p(`<a href="${COMPANY.siteUrl}" style="color:#0563C1">${COMPANY.site}</a>`),
    '</div>',
  ].filter(Boolean).join('');
}

// Testo semplice (anteprime, test)
const text = sig => [sig.name, sig.role, ...COMPANY.address, sig.phone ? `Tel. ${sig.phone}${sig.phone2 ? ` / ${sig.phone2}` : ''}` : '', COMPANY.site].filter(Boolean).join('\n');

// Allegato inline del logo per Graph
const logoAttachment = () => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: 'almacis.png', contentType: 'image/png', isInline: true, contentId: LOGO_CID, contentBytes: logo() });

// Testo scritto (textarea) → HTML dell'email
const bodyHtml = t => `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222222">${esc(t).replace(/\r/g, '').split('\n').map(l => l || '&nbsp;').map(l => `<p style="margin:0">${l}</p>`).join('')}</div>`;

module.exports = { COMPANY, LOGO_CID, fromProfile, signatureOf, html, text, logoAttachment, bodyHtml, esc, logoBase64: logo };
