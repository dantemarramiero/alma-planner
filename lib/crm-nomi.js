// Nomi delle persone e domini delle email per il CRM (18/11/2026, canvas «v8 · Contatto nuovo con un vocale»).
// - splitName("Ing. Mario Rossi") → { title: 'Ing.', first: 'Mario', last: 'Rossi' }; «Maria Grazia De Luca» →
//   nome «Maria Grazia», cognome «De Luca» (le particelle de, di, del, della, lo, la, van, von, d' vanno col cognome).
//   Un nome solo («Rossi») diventa il cognome. «Rossi Mario» resta nome «Rossi», cognome «Mario»: si corregge con un tocco.
// - domainOf(email) → il dominio aziendale (null per gmail, libero, pec…): serve a trovare l'azienda dall'email.
const TITLES = ['Ing.', 'Arch.', 'Geom.', 'Dott.', 'Dott.ssa', 'Avv.', 'Per. Ind.', 'Rag.', 'Prof.', 'Sig.', 'Sig.ra'];
const TITLE_WORDS = { ing: 'Ing.', ingegner: 'Ing.', ingegnere: 'Ing.', arch: 'Arch.', architetto: 'Arch.', architetta: 'Arch.', geom: 'Geom.', geometra: 'Geom.',
  dott: 'Dott.', dottor: 'Dott.', dottore: 'Dott.', dottssa: 'Dott.ssa', dottoressa: 'Dott.ssa', avv: 'Avv.', avvocato: 'Avv.', avvocata: 'Avv.',
  perind: 'Per. Ind.', perito: 'Per. Ind.', rag: 'Rag.', ragioniere: 'Rag.', prof: 'Prof.', professore: 'Prof.', professoressa: 'Prof.', sig: 'Sig.', signor: 'Sig.', signore: 'Sig.', sigra: 'Sig.ra', signora: 'Sig.ra' };
const PARTICLES = new Set(['de', 'di', 'del', 'della', 'dello', 'dei', 'degli', 'da', 'dal', 'dalla', 'lo', 'la', 'le', 'li', 'van', 'von', 'mc', 'mac']);
const GENERIC = new Set(['gmail.com', 'googlemail.com', 'libero.it', 'hotmail.com', 'hotmail.it', 'outlook.com', 'outlook.it', 'live.com', 'live.it', 'yahoo.com', 'yahoo.it',
  'icloud.com', 'me.com', 'virgilio.it', 'alice.it', 'tiscali.it', 'tin.it', 'fastwebnet.it', 'email.it', 'inwind.it', 'aruba.it', 'pec.it', 'legalmail.it', 'postecert.it', 'pecmail.it', 'proton.me', 'protonmail.com']);

const cap = w => (w === w.toLowerCase() || w === w.toUpperCase() ? w.split(/([-'’])/).map(p => (p.length > 1 ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p)).join('') : w);

function splitName(raw) {
  let words = String(raw || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  let title = '';
  while (words.length) {
    const k = words[0].toLowerCase().replace(/[.\s]/g, '');
    if (TITLE_WORDS[k]) { title = title || TITLE_WORDS[k]; words.shift(); continue; }
    if (k === 'per' && words[1] && words[1].toLowerCase().replace('.', '') === 'ind') { title = title || 'Per. Ind.'; words.splice(0, 2); continue; }
    break;
  }
  words = words.map(cap);
  if (!words.length) return { title, first: '', last: '' };
  if (words.length === 1) return { title, first: '', last: words[0] };
  // il cognome: l'ultima parola, più le particelle subito prima («De Luca», «Della Rovere»)
  let i = words.length - 1;
  while (i > 1 && PARTICLES.has(words[i - 1].toLowerCase().replace(/['’]$/, ''))) i--;
  if (/^d['’]/i.test(words[i])) words[i] = `D'${cap(words[i].slice(2))}`;
  return { title, first: words.slice(0, i).join(' '), last: words.slice(i).join(' ') };
}

function domainOf(email) {
  const m = /@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(String(email || '').trim());
  if (!m) return null;
  const d = m[1].toLowerCase();
  return GENERIC.has(d) ? null : d;
}
// «elettrosud» da «m.rossi@elettrosud.it» o da «mail.elettrosud.com»: la parola che conta del dominio.
function domainWord(domain) {
  const parts = String(domain || '').toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) return null;
  const w = parts[parts.length - 2];
  return ['co', 'com', 'gov', 'it'].includes(w) && parts.length > 2 ? parts[parts.length - 3] : w;
}

module.exports = { TITLES, splitName, domainOf, domainWord };
