// «Persone con cui mi scrivo» (ALM2-46, canvas CRM v10 · V10-Scrivo): logica senza Express.
// - scan: legge dalla casella Outlook di chi chiede le ricevute (mittenti) e le inviate (destinatari) degli ultimi 12
//   mesi e conta per indirizzo. Restano fuori i colleghi (stesso dominio), i no-reply, le newsletter e le liste.
// - companyOf: l'azienda dal dominio (già nel CRM → ci va dentro; nuova → si propone come Lead; personale → la scegli).
// - fromSignature: nome, ruolo e telefoni dalla firma dell'ultima email (regole semplici; Alma le migliora se c'è).

const MONTHS = 12;
const MAX_IN = 6000;   // messaggi ricevuti letti al massimo
const MAX_OUT = 3000;  // messaggi inviati letti al massimo

// domini di posta personale e PEC: niente azienda dal dominio
const PERSONAL = new Set(['gmail.com', 'googlemail.com', 'libero.it', 'hotmail.com', 'hotmail.it', 'outlook.com', 'outlook.it', 'live.com', 'live.it',
  'msn.com', 'yahoo.com', 'yahoo.it', 'icloud.com', 'me.com', 'mac.com', 'virgilio.it', 'tiscali.it', 'alice.it', 'tim.it', 'fastwebnet.it',
  'email.it', 'inwind.it', 'aruba.it', 'pec.it', 'legalmail.it', 'postacert.it', 'pec.aruba.it', 'arubapec.it', 'gigapec.it', 'pecveneto.it',
  'proton.me', 'protonmail.com', 'gmx.com', 'gmx.it', 'tin.it', 'katamail.com', 'poste.it', 'postecert.it', 'cert.legalmail.it']);
const isPersonal = d => PERSONAL.has(d) || /(^|\.)pec\./.test(d) || /\.pec\.it$/.test(d) || /legalmail|postacert|arubapec/.test(d);

// indirizzi automatici: no-reply, notifiche, newsletter, liste
const AUTO_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|noreply\d*|mailer-daemon|postmaster|bounce[s]?|notification[s]?|notifiche|notify|alert[s]?|newsletter[s]?|news|marketing|mailer|automated|system|daemon|calendar|list|lists|listserv|majordomo|unsubscribe|support-noreply)([.+_-].*)?$/i;
const AUTO_DOMAIN = /(^|\.)(mailchimp|mcsv|mcdlv|sendgrid|amazonses|mailgun|sparkpost|hubspot(email)?|salesforce|exacttarget|mktomail|constantcontact|sendinblue|brevo|mailjet|substack|linkedin|facebookmail|google|youtube|microsoft|office365|sharepointonline|teams\.mail|zoom\.us|docusign|dropbox|slack|atlassian|github|notion|calendly)\.(com|net|io|us|it)$/i;

const domainOf = email => String(email || '').toLowerCase().split('@')[1] || '';
const isAuto = email => { const [l, d] = String(email || '').toLowerCase().split('@'); return !d || AUTO_LOCAL.test(l) || AUTO_DOMAIN.test(d); };

// «studiotecnicorossi.it» → «Studiotecnicorossi»; «pace-ing.com» → «Pace Ing»
function nameFromDomain(d) {
  const parts = String(d || '').split('.');
  const base = parts.length > 2 && ['co', 'com', 'gov', 'org'].includes(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[parts.length - 2] || parts[0];
  return String(base || '').split(/[-_]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// Legge la posta (ricevute + inviate) e restituisce le persone contate per indirizzo.
async function readMailbox(token, { graphAll, ownEmail, since = new Date(Date.now() - MONTHS * 30.5 * 864e5) } = {}) {
  const iso = since.toISOString().slice(0, 19) + 'Z';
  const own = String(ownEmail || '').toLowerCase();
  const ownDomain = domainOf(own);
  const people = new Map();
  const touch = (r, dir, when) => {
    const email = String(r?.emailAddress?.address || '').toLowerCase().trim();
    if (!email || !email.includes('@') || email === own) return;
    const d = domainOf(email);
    if ((ownDomain && d === ownDomain) || d === 'almacis.it' || isAuto(email)) return;
    const p = people.get(email) || { email, name: '', received: 0, sent: 0, last_at: null };
    const name = String(r?.emailAddress?.name || '').trim();
    if (name && !name.includes('@') && name.toLowerCase() !== email) p.name = p.name || name;
    p[dir]++;
    if (when && (!p.last_at || when > p.last_at)) p.last_at = when;
    people.set(email, p);
  };
  const inbox = await graphAll(token, `/me/mailFolders/inbox/messages?$select=from,receivedDateTime&$filter=receivedDateTime ge ${iso}&$orderby=receivedDateTime desc&$top=500`, { max: MAX_IN });
  for (const m of inbox) touch(m.from, 'received', m.receivedDateTime);
  const sent = await graphAll(token, `/me/mailFolders/sentitems/messages?$select=toRecipients,ccRecipients,sentDateTime&$filter=sentDateTime ge ${iso}&$orderby=sentDateTime desc&$top=500`, { max: MAX_OUT });
  for (const m of sent) {
    const seen = new Set();
    for (const r of [...(m.toRecipients || []), ...(m.ccRecipients || [])]) {
      const a = String(r?.emailAddress?.address || '').toLowerCase();
      if (seen.has(a)) continue;
      seen.add(a);
      touch(r, 'sent', m.sentDateTime);
    }
  }
  return { people: [...people.values()], messages: inbox.length + sent.length };
}

// Salva il risultato della lettura: i conteggi si rinnovano, «ignorata» resta.
async function saveScan(db, userId, { people, messages }) {
  await db.tx(async q => {
    await q.query('UPDATE crm_mail_people SET received = 0, sent = 0, replied = false WHERE user_id = $1', [userId]);
    for (let i = 0; i < people.length; i += 200) {
      const part = people.slice(i, i + 200);
      const vals = [];
      const rows = part.map((p, k) => {
        vals.push(p.email.slice(0, 320), p.name.slice(0, 200), p.received, p.sent, p.received > 0 && p.sent > 0, p.last_at);
        const b = k * 6;
        return `($1, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, now())`;
      });
      await q.query(`INSERT INTO crm_mail_people (user_id, email, name, received, sent, replied, last_at, updated_at) VALUES ${rows.join(', ')}
        ON CONFLICT (user_id, email) DO UPDATE SET name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE crm_mail_people.name END,
          received = EXCLUDED.received, sent = EXCLUDED.sent, replied = EXCLUDED.replied, last_at = EXCLUDED.last_at, updated_at = now()`, [userId, ...vals]);
    }
    await q.query(`INSERT INTO crm_mail_scans (user_id, scanned_at, messages, error) VALUES ($1, now(), $2, '')
      ON CONFLICT (user_id) DO UPDATE SET scanned_at = now(), messages = EXCLUDED.messages, error = ''`, [userId, messages]);
  });
}

// Aziende del CRM per dominio: sito, email della scheda o email dei suoi contatti attivi.
async function subjectsByDomain(db, domains) {
  const list = [...new Set(domains.filter(d => d && !isPersonal(d)))];
  if (!list.length) return new Map();
  const { rows } = await db.query(`
    SELECT d.dom, s.id, s.name, s.roles FROM unnest($1::text[]) AS d(dom)
      JOIN LATERAL (SELECT s.id, s.name, s.roles FROM crm_subjects s WHERE s.merged_into IS NULL AND (
          lower(COALESCE(s.email, '')) LIKE '%@' || d.dom
          OR regexp_replace(lower(COALESCE(s.website, '')), '^(https?://)?(www\\.)?', '') LIKE d.dom || '%'
          OR EXISTS (SELECT 1 FROM crm_contact_links l JOIN crm_contacts c ON c.id = l.contact_id
                      WHERE l.subject_id = s.id AND l.date_to IS NULL AND lower(c.email) LIKE '%@' || d.dom))
        ORDER BY s.id LIMIT 1) s ON true`, [list]);
  return new Map(rows.map(r => [r.dom, { id: r.id, name: r.name, roles: r.roles }]));
}

function companyOf(email, byDomain) {
  const d = domainOf(email);
  if (isPersonal(d)) return { kind: 'personale', domain: d };
  const s = byDomain.get(d);
  if (s) return { kind: 'crm', domain: d, subject_id: s.id, name: s.name, roles: s.roles };
  return { kind: 'nuova', domain: d, name: nameFromDomain(d) };
}

// ── firma ────────────────────────────────────────────────────────────────────
const TITLES = ['Ing.', 'Arch.', 'Geom.', 'Dott.ssa', 'Dott.', 'Avv.', 'Prof.ssa', 'Prof.', 'Rag.', 'Per. Ind.', 'P.I.', 'Sig.ra', 'Sig.'];
const ROLE_WORDS = /\b(direttore|direttrice|responsabile|manager|amministratore|titolare|socio|ceo|cfo|cto|coo|presidente|ufficio|area|project|sales|account|commerciale|tecnico|ingegnere|architetto|geometra|buyer|acquisti|segreteria|rup|dirigente|funzionario|coordinatore|coordinatrice|consulente|partner|founder|head|specialist|engineer|assistente)\b/i;
const COMPANY_WORDS = /\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|soc\.|societ[àa]|studio|group|gruppo|consorzio|cooperativa|coop|comune|provincia|regione|azienda|ente|spa|srl|ltd|gmbh|inc)\b/i;

// Taglia il testo dell'ultima email alla sola parte nuova (prima di «Il giorno … ha scritto», «From:», «-----Original»)
function ownPart(text) {
  const t = String(text || '').replace(/\r/g, '');
  const cut = t.search(/\n\s*(-{2,}\s*(Messaggio originale|Original Message)|Da:\s|From:\s|Il giorno .{5,80} ha scritto|On .{5,80} wrote:|_{5,})/i);
  return (cut > 0 ? t.slice(0, cut) : t).trim();
}

// Regole semplici sulle ultime righe del messaggio. Restituisce i campi trovati e il blocco della firma.
function fromSignature(text, { name = '', email = '' } = {}) {
  const lines = ownPart(text).split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const tail = lines.slice(-14);
  const out = { title: '', first_name: '', last_name: '', job: '', mobile: '', phone: '', company: '', city: '', signature: '' };
  // da dove parte la firma: «Cordiali saluti», «Saluti», «Best regards»… oppure le ultime righe
  let start = tail.findIndex(l => /^(cordiali saluti|distinti saluti|saluti|un saluto|best regards|kind regards|regards|grazie|buona giornata|a presto)[,.!]?$/i.test(l));
  const sig = start >= 0 ? tail.slice(start + 1) : tail.slice(-8);
  out.signature = sig.join('\n').slice(0, 800);
  const phones = [];
  for (const l of sig.flatMap(x => x.split(/\s[·|•]\s|\s{2,}|;\s/))) {
    const nums = l.match(/(\+?\d[\d\s./-]{6,}\d)/g) || [];
    for (const n of nums) {
      const clean = n.replace(/[^\d+]/g, '');
      if (clean.replace('+', '').length < 8 || clean.length > 15) continue;
      const mobile = /cell|mob|\bm\b/i.test(l) || (!/tel|fax|uff/i.test(l) && /^(\+39)?3\d{8,9}$/.test(clean));
      phones.push({ n: n.trim(), mobile });
    }
  }
  out.mobile = phones.find(p => p.mobile)?.n || '';
  out.phone = phones.find(p => !p.mobile)?.n || '';
  // nome: la riga che contiene il nome dell'intestazione, altrimenti la prima riga breve senza numeri
  const hdr = String(name || '').trim();
  const nameLine = sig.find(l => hdr && l.toLowerCase().includes(hdr.split(' ').slice(-1)[0].toLowerCase()) && l.length < 60)
    || sig.find(l => l.length < 40 && !/\d|@|www|http/i.test(l) && /^[A-ZÀ-Ü]/.test(l) && l.split(' ').length <= 5 && !ROLE_WORDS.test(l) && !COMPANY_WORDS.test(l));
  let who = (nameLine || hdr).split(/[·|,–-]/)[0].trim();
  const title = TITLES.find(t => who.toLowerCase().startsWith(t.toLowerCase()));
  if (title) { out.title = title; who = who.slice(title.length).trim(); }
  const words = who.split(' ').filter(Boolean);
  if (words.length >= 2) { out.first_name = words.slice(0, -1).join(' '); out.last_name = words[words.length - 1]; } else if (words.length) out.last_name = words[0];
  // ruolo: dopo il nome sulla stessa riga, o una riga con parole da ruolo
  const sameLine = nameLine && nameLine.split(/[·|,–]/).slice(1).map(s => s.trim()).find(s => ROLE_WORDS.test(s));
  out.job = (sameLine || sig.find(l => ROLE_WORDS.test(l) && !/\d{4,}|@/.test(l) && l.length < 70) || '').split(/[·|]/)[0].trim().slice(0, 120);
  // azienda e città
  const coLine = sig.find(l => COMPANY_WORDS.test(l) && !/@/.test(l) && l.length < 90);
  if (coLine) out.company = coLine.split(/[·|]/).find(s => COMPANY_WORDS.test(s))?.trim().slice(0, 200) || '';
  const addr = sig.find(l => /\b(via|viale|piazza|corso|p\.zza|largo|strada|contrada)\b/i.test(l));
  const city = addr && (addr.match(/\d{5}\s+([A-ZÀ-Ü][\wÀ-ü' ]+?)(\s*\(|,|$)/) || addr.match(/,\s*([A-ZÀ-Ü][\wÀ-ü' ]+?)(\s*\(|$)/));
  if (city) out.city = city[1].trim().slice(0, 80);
  if (!out.last_name && email) out.last_name = String(email).split('@')[0];
  return out;
}

module.exports = { readMailbox, saveScan, subjectsByDomain, companyOf, fromSignature, ownPart, isAuto, isPersonal, domainOf, nameFromDomain, MONTHS };
