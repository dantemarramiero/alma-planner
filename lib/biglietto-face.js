// Il biglietto da visita digitale Almacis (Dante 21/11/2026, «almacis_biglietto_digitale.html»): fronte scuro con il
// logo Almacis (versione con la scritta bianca) e il retro bianco con i contatti della persona. Lo stesso markup serve
// in «Il mio biglietto» (app) e nella pagina pubblica che si apre dal QR; lo stile è in orbita/css/biglietto-digitale.css.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = s => String(s || '').replace(/[^\d+]/g, '');

const COMPANY = 'ALMA – C.I.S. SRL';
const HQ = 'Via Padre U. Frasca · 66013 Chieti Scalo (CH)';
const SITE = 'www.almacis.it';

const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  pin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
  mobile: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  mail: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="m2 7 10 7 10-7"/>',
  web: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2c-7 6-7 14 0 20m0-20c7 6 7 14 0 20"/>',
  in: '<rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/>',
};

// fronte: logo, rete di linee con la «linea di energia» arancione, skyline, foglia, orbita
const FRONT = `<article class="bvd-card bvd-front" aria-label="Biglietto Almacis, lato marchio">
<svg class="bvd-net" preserveAspectRatio="none" viewBox="0 0 590 260" aria-hidden="true"><defs><linearGradient id="bvd-ray" x1="0" x2="1"><stop stop-color="#FF8A26" stop-opacity="0"/><stop offset=".55" stop-color="#FF8A26"/><stop offset="1" stop-color="#FFB16C"/></linearGradient></defs><g stroke="#DFE6ED" stroke-opacity=".25" stroke-width=".8" fill="none"><path d="M0 150 Q135 40 270 145 T590 100M0 190 Q165 55 310 181 T590 125M0 227 Q155 95 320 211 T590 169M0 115 L590 215M0 180 L590 65M0 240 L570 35M15 75 L475 260M125 15 L540 250"/></g><path d="M0 214 Q180 130 300 182 T590 108" stroke="url(#bvd-ray)" stroke-width="2.6" fill="none"/><g fill="#FFFFFF"><circle cx="74" cy="174" r="2.5"/><circle cx="180" cy="155" r="3"/><circle cx="327" cy="179" r="2.5"/><circle cx="449" cy="141" r="2"/></g><g stroke="#DFE6ED" stroke-opacity=".45" stroke-width="1.2" fill="none"><path d="M395 150v-58h22v58m9 0V70h20v80m9 0v-97h20v97m13 0V86h23v64m15 0V112h15v38"/><path d="M376 159h190m-178 0V180m26-21v28m30-28v36m30-36v34m30-34v21"/></g></svg>
<span class="bvd-orbit" aria-hidden="true"></span>
<svg class="bvd-eco" viewBox="0 0 80 80" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M39 63V28C42 9 59 6 69 6c-1 22-10 31-30 32M39 53C34 26 17 23 10 25c2 21 10 29 29 30M39 38L59 19M38 55L20 35"/></svg>
<div class="bvd-front-in">
  <img class="bvd-logo" src="/brand/almacis/almacis-logo-white.png" alt="Almacis · Solving Generation" width="806" height="212">
  <div class="bvd-lower"><small>Innovation · Infrastructure · Energy</small><strong>Building a sustainable future.</strong></div>
</div>
</article>`;

// x = vista pubblica del biglietto (nome, ruolo, reparto, cellulare, telefono, email, linkedin, sede)
// qr = SVG del QR da mettere nell'angolo del retro (nell'app); nella pagina pubblica non serve
function faceHtml(x, { qr = '' } = {}) {
  const li = (icon, text, href) => `<li>${svg(I[icon])}${href ? `<a href="${esc(href)}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}>${esc(text)}</a>` : `<span>${esc(text)}</span>`}</li>`;
  const lines = [
    x.mobile ? li('mobile', x.mobile, `tel:${digits(x.mobile)}`) : '',
    x.phone ? li('phone', x.phone, `tel:${digits(x.phone)}`) : '',
    x.email ? li('mail', x.email, `mailto:${x.email}`) : '',
    x.linkedin ? li('in', x.linkedin.replace(/^https?:\/\/(www\.)?/, ''), x.linkedin) : '',
    li('web', SITE, 'https://www.almacis.it'),
    li('pin', x.address || HQ),
  ].filter(Boolean).join('');
  const role = [x.role, x.unit].filter(Boolean).join(' · ');
  return `<div class="bvd-cards">${FRONT}
<article class="bvd-card bvd-back" aria-label="Biglietto di ${esc(x.name)}, lato contatti">
<div class="bvd-back-in">
  <div class="bvd-head"><div class="bvd-who"><div class="bvd-kicker">Almacis</div><h2 class="bvd-name">${esc(x.name)}</h2>${role ? `<div class="bvd-role">${esc(role)}</div>` : ''}</div>
    ${qr ? `<div class="bvd-qr" title="Inquadra per salvare il contatto">${qr}</div>` : ''}</div>
  <ul class="bvd-lines">${lines}</ul>
  <div class="bvd-foot"><span>${esc(COMPANY)} · Network Utilities · Plants · Building · Energy</span><span class="bvd-est">EST. 1955</span></div>
</div>
</article></div>`;
}

module.exports = { faceHtml, COMPANY, HQ };
