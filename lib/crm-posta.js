// Progetto commerciale da una email (ALM2-55, canvas «Progetto da email» approvato da Dante il 22/11/2026).
// Qui la parte che non dipende dalle route: messaggi di Outlook in forma comune, cosa ha capito Alma della
// conversazione (OpenAI se c'è la chiave, altrimenti regole semplici), lo stato della trattativa (a chi tocca,
// termometro, prossima mossa, impegni presi nelle email, chi conta) e i legami nel CRM.
const S = require('./crm-scrivo');

const MODEL = process.env.OPENAI_MAIL_MODEL || process.env.OPENAI_BUSINESS_MODEL || 'gpt-4.1-mini';
const PRICE = { in: Number(process.env.OPENAI_PRICE_IN || 0.4), out: Number(process.env.OPENAI_PRICE_OUT || 1.6) };
const USD_EUR = 0.95;
const STEPS_TRATTATIVA = ['Seguo', 'Primo incontro', 'Sopralluogo e richiesta', 'Offerta', 'Esito'];
const STOP = new Set(('della delle dello degli dalla dalle dagli nella nelle negli sulla sulle questo questa quello quella come sono siamo essere avere hanno anche ancora perché quindi però oppure mentre dopo prima sempre molto tutti tutte ogni nostro nostra vostro vostra loro buongiorno buonasera saluti cordiali grazie gentile allegato allegati ciao settimana prossima possiamo potete vorrei vogliamo inviare invio mandare mando stesso stessa').split(' '));
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

const person = r => ({ name: r?.emailAddress?.name || '', address: (r?.emailAddress?.address || '').toLowerCase() });
const clean = s => String(s || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
const baseSubject = s => clean(s).replace(/^((re|r|fw|fwd|i|inoltra|rif)\s*:\s*)+/i, '').trim();
const romeDay = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

// Messaggio di Graph → forma comune
function normMsg(m) {
  return {
    id: m.id, conversation_id: m.conversationId || '', internet_message_id: m.internetMessageId || `outlook:${m.id}`,
    subject: m.subject || '(senza oggetto)', from: person(m.from), to: (m.toRecipients || []).map(person), cc: (m.ccRecipients || []).map(person),
    date: m.receivedDateTime || m.sentDateTime || null, preview: clean(m.bodyPreview || '').slice(0, 240),
    body: String(m.body?.content || ''), has_attachments: Boolean(m.hasAttachments), web_link: m.webLink || null,
  };
}

// La parte nuova del testo (senza la citazione delle email di prima)
const ownText = text => S.ownPart(String(text || ''));

// ── cosa ha capito Alma: regole semplici (senza chiave, nei test e come rete di sicurezza) ──────────
function amountOf(text) {
  const m = String(text).match(/(\d+(?:[.,]\d+)?)\s*(milioni|mln|mio|m€|mila|k€|k)\b/i) || String(text).match(/€\s?(\d{1,3}(?:\.\d{3})+(?:,\d+)?)/);
  if (!m) return { value: null, text: '' };
  if (m[2]) {
    const n = Number(m[1].replace(',', '.'));
    const mult = /^(milioni|mln|mio|m€)$/i.test(m[2]) ? 1e6 : 1e3;
    return { value: Math.round(n * mult), text: m[0] };
  }
  return { value: Number(m[1].replace(/\./g, '').replace(',', '.')), text: m[0] };
}
// «entro fine gennaio», «entro il 31/01/2027», «entro gennaio» → data AAAA-MM-GG dopo oggi
function deadlineOf(text, today = romeDay()) {
  const t = String(text).toLowerCase();
  let m = t.match(/entro (?:il |la |fine )?(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
  if (m) {
    let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(today.slice(0, 4));
    const d = `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    if (!m[3] && d < today) y += 1;
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  m = t.match(/entro (?:la |il )?(fine |metà |inizio )?(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?: (\d{4}))?/);
  if (m) {
    const mo = MONTHS.indexOf(m[2]) + 1;
    let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const dd = m[1] === 'metà ' ? 15 : m[1] === 'inizio ' ? 10 : last;
    let d = `${y}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    if (!m[3] && d < today) { y += 1; d = `${y}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`; }
    return d;
  }
  return null;
}
const sentences = text => String(text).replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).map(clean).filter(s => s.length > 8);
function themesOf(subject, text) {
  const words = `${baseSubject(subject)} ${baseSubject(subject)} ${String(text).slice(0, 1500)}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter(w => w.length >= 5 && !STOP.has(w) && !/^\d+$/.test(w));
  const count = new Map();
  for (const w of words) count.set(w, (count.get(w) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);
}
function placeOf(text) {
  const m = String(text).match(/\b(?:a|di|in|nell'area(?: industriale)? di|zona)\s+([A-Z][a-zà-ù']+(?:\s+(?:[A-Z][a-zà-ù']+|di|del|sul))*?(?:\s+[A-Z][a-zà-ù']+)?)(?=[\s,.;:)]|$)/);
  return m ? m[1].trim() : '';
}

function heuristicExtract(messages, { asaList = [], internal = () => false, today = romeDay() } = {}) {
  const sorted = messages.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const first = sorted[0] || {};
  const outside = sorted.filter(m => !internal(m.from.address));
  // senza saluti in apertura e senza firma: restano le frasi che contano
  const body = t => ownText(t).replace(/^\s*(buongiorno|buonasera|buon pomeriggio|ciao|salve|gentil\w*|egregi\w*|caro|cara)\b[^\n]*\n/i, '')
    .split(/\n\s*(cordiali saluti|distinti saluti|saluti|un saluto|grazie|a presto)\b/i)[0];
  const texts = sorted.map(m => body(m.body || m.preview));
  const all = texts.join('\n');
  const theirs = outside.map(m => body(m.body || m.preview)).join('\n') || all;
  const subject = baseSubject(first.subject || '');
  const sent = sentences(all);
  const sentTheirs = sentences(theirs);
  const amount = amountOf(all);
  const deadline = deadlineOf(all, today);
  const next = sent.slice().reverse().find(s => /\?|sopralluogo|incontr|vederci|call|riunione|appuntamento/i.test(s)) || '';
  const tempi = sent.filter(s => /entro|partire|inizio lavori|consegna|scadenza|maggio|giugno|gennaio|febbraio/i.test(s)).slice(0, 2).join(' ');
  // cosa: la frase che descrive il lavoro (nuovo…, realizzare…) e quella che dice cosa serve, dalle email di chi ci scrive
  const what = sentTheirs.find(s => /nuov|realizz|definendo|costruir|ampliament|progett/i.test(s));
  const need = sentTheirs.find(s => /\b(serve|servono|cerchiamo|cerca|vi chiediamo|richiesta)\b/i.test(s) && s !== what);
  const cosa = [what, need].filter(Boolean).join(' ') || sentTheirs.find(s => /lavori|impiant|opere/i.test(s)) || sent[0] || subject;
  // solo un nome vero (con la maiuscola) dopo «il nostro cliente», «per conto di», «committente è»…
  const per = ((all.match(/(?:[Ii]l nostro cliente|[Pp]er conto di|[Cc]ommittente(?: è| sarà)?|[Ll]a società|[Ll]'azienda)\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*)*(?:\s+(?:s\.?r\.?l\.?|s\.?p\.?a\.?|srl|spa))?)/) || [])[1] || '').replace(/\.$/, '');
  const tipo = /\b(gara|bando|cig|appalto|procedura negoziata|rdo|mepa)\b/i.test(all) ? 'gara' : 'trattativa';
  const themes = themesOf(subject, all);
  // BU: la ASA le cui parole compaiono di più
  let bu = '', best = 0;
  for (const a of asaList) {
    const words = [...(a.keywords || []), ...(a.works || []), a.label || ''].join(' ').toLowerCase().split(/[^a-zà-ù0-9]+/).filter(w => w.length >= 5);
    const score = words.filter(w => all.toLowerCase().includes(w)).length;
    if (score > best) { best = score; bu = a.key; }
  }
  return {
    title: subject.slice(0, 160) || 'Nuovo progetto dalla email',
    cosa: clean(cosa).replace(/^(come (anticipato|da telefonata|d'accordo|detto)[^,]*,\s*)/i, '').replace(/^./, c => c.toUpperCase()).slice(0, 300), dove: placeOf(all).slice(0, 120),
    per_chi: per ? per.slice(0, 160) : /\b(il nostro|un nostro|il loro) cliente\b/i.test(all) ? 'Un cliente di chi scrive (nome non scritto)' : '',
    importo: amount.value, importo_testo: amount.text, tempi: clean(tempi).slice(0, 300), scadenza: deadline,
    prossimo_passo: clean(next).slice(0, 200), tipo, bu, temi: themes, committente: per || '',
  };
}

// ── OpenAI (Responses API) con risposta in JSON; restituisce { data, eur } o null ───────────────────
async function askJson({ key, fetchImpl, system, input, maxTokens = 1200 }) {
  if (!key) return null;
  const r = await (fetchImpl || fetch)('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_output_tokens: maxTokens, text: { format: { type: 'json_object' } },
      input: [{ role: 'system', content: system }, { role: 'user', content: input }] }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}`);
  const j = await r.json();
  const text = j.output_text || (j.output || []).flatMap(o => o.content || []).map(c => c.text || '').join('');
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  const u = j.usage || {};
  const eur = ((Number(u.input_tokens) || 0) * PRICE.in + (Number(u.output_tokens) || 0) * PRICE.out) / 1e6 * USD_EUR;
  return { data: JSON.parse(m[0]), eur };
}

const thread = (messages, max = 14000) => messages.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
  .map(m => `--- ${String(m.date || '').slice(0, 16)} · da ${m.from.name || ''} <${m.from.address}> · a ${m.to.map(x => x.address).join(', ')}${m.cc.length ? ` · cc ${m.cc.map(x => x.address).join(', ')}` : ''}\nOggetto: ${m.subject}\n${ownText(m.body || m.preview).slice(0, 4000)}`)
  .join('\n\n').slice(-max);

async function extract(messages, ctx = {}) {
  const base = heuristicExtract(messages, ctx);
  const ai = await askJson({
    key: ctx.key, fetchImpl: ctx.fetchImpl,
    system: [
      'Sei l\'analista commerciale di Almacis, impresa italiana di costruzioni e impianti. Leggi una conversazione email',
      'e capisci se parla di un possibile lavoro. Rispondi SOLO con un oggetto JSON con queste chiavi:',
      'title (titolo breve del progetto, es. «Data center Chieti Scalo · impianti e opere civili»), cosa, dove, per_chi',
      '(il committente finale se è scritto, altrimenti chi scrive e per chi), importo (numero in euro o null), importo_testo,',
      'tempi, scadenza (AAAA-MM-GG della consegna offerte o null), prossimo_passo, tipo («gara» se si parla di gara/bando/CIG,',
      'altrimenti «trattativa»), bu (una delle chiavi date o ""), temi (3-6 parole chiave del tema, minuscole), committente',
      '(nome dell\'azienda o ente committente se scritto, altrimenti ""). Non inventare: se un dato non c\'è, stringa vuota o null.',
      `Oggi è il ${ctx.today || romeDay()}.`,
    ].join(' '),
    input: `BU disponibili: ${(ctx.asaList || []).map(a => `${a.key} = ${a.label}`).join('; ') || 'nessuna'}\n\n${thread(messages)}`,
  }).catch(err => { console.warn('[posta] lettura AI non riuscita:', err.message); return null; });
  if (!ai) return { fields: base, eur: 0, ai: false };
  const d = ai.data || {};
  const pick = (k, max = 300) => (typeof d[k] === 'string' && d[k].trim() ? d[k].trim().slice(0, max) : base[k]);
  const fields = {
    title: pick('title', 160), cosa: pick('cosa'), dove: pick('dove', 120), per_chi: pick('per_chi', 160),
    importo: Number.isFinite(Number(d.importo)) && Number(d.importo) > 0 ? Math.round(Number(d.importo)) : base.importo,
    importo_testo: pick('importo_testo', 80), tempi: pick('tempi'), prossimo_passo: pick('prossimo_passo', 200),
    scadenza: /^\d{4}-\d{2}-\d{2}$/.test(String(d.scadenza || '')) ? d.scadenza : base.scadenza,
    tipo: d.tipo === 'gara' ? 'gara' : d.tipo === 'trattativa' ? 'trattativa' : base.tipo,
    bu: (ctx.asaList || []).some(a => a.key === d.bu) ? d.bu : base.bu,
    temi: Array.isArray(d.temi) && d.temi.length ? d.temi.map(x => String(x).toLowerCase().slice(0, 40)).slice(0, 6) : base.temi,
    committente: pick('committente', 160) || '',
  };
  return { fields, eur: ai.eur, ai: true };
}

// ── stato della trattativa ──────────────────────────────────────────────────────────────────────────
// emails: [{ from_address, from_name, sent_at, subject, body_text }] del progetto; internal(address) = collega.
const isoEmails = list => (list || []).map(e => ({ ...e, sent_at: e.sent_at ? new Date(e.sent_at).toISOString() : null }));
function ball(emails, internal) {
  emails = isoEmails(emails);
  const last = emails.filter(e => e.sent_at).sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
  if (!last) return null;
  const ours = internal(last.from_address);
  return { who: ours ? 'loro' : 'noi', since: last.sent_at, from: last.from_name || last.from_address, subject: last.subject };
}
const hoursBetween = (a, b) => Math.abs(Date.parse(b) - Date.parse(a)) / 36e5;
function temperature(emails, meetings, internal, now = new Date()) {
  emails = isoEmails(emails);
  const sorted = emails.filter(e => e.sent_at).sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));
  const theirs = sorted.filter(e => !internal(e.from_address));
  // tempo di risposta: da una nostra email alla loro risposta successiva
  const waits = [];
  for (let i = 1; i < sorted.length; i++) if (internal(sorted[i - 1].from_address) && !internal(sorted[i].from_address)) waits.push(hoursBetween(sorted[i - 1].sent_at, sorted[i].sent_at));
  const lastTheirs = theirs[theirs.length - 1];
  const daysQuiet = lastTheirs ? (now - Date.parse(lastTheirs.sent_at)) / 864e5 : null;
  const upcoming = (meetings || []).some(m => Date.parse(m.start_at) >= now.getTime() - 36e5);
  const recent = theirs.filter(e => (now - Date.parse(e.sent_at)) / 864e5 <= 7).length;
  const avgWait = waits.length ? waits.reduce((s, x) => s + x, 0) / waits.length : null;
  const b = ball(emails, internal);
  if (daysQuiet !== null && daysQuiet > 14 && b?.who === 'loro') return { level: 'freddo', label: 'Si raffredda', why: `nessuna risposta da ${Math.round(daysQuiet)} giorni` };
  if (upcoming || recent >= 2 || (avgWait !== null && avgWait <= 24)) {
    return { level: 'caldo', label: 'Si scalda', why: [avgWait !== null ? `risposte in ${avgWait < 1 ? 'meno di un\'ora' : `${Math.round(avgWait)} ore`}` : null, upcoming ? 'incontro fissato' : null, recent >= 2 ? `${recent} email in 7 giorni` : null].filter(Boolean).join(', ') };
  }
  if (!theirs.length) return { level: 'nuovo', label: 'Appena nata', why: 'ancora nessuna risposta da loro' };
  return { level: 'stabile', label: 'Stabile', why: daysQuiet !== null ? `ultima risposta ${Math.round(daysQuiet)} giorni fa` : '' };
}

// Impegni, prossima mossa, chi conta e committente: regole semplici (con OpenAI se c'è la chiave)
function heuristicDeal({ emails, internal, concept = {}, meetings = [], people = [] }) {
  emails = isoEmails(emails);
  const sorted = emails.filter(e => e.sent_at).sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));
  const commitments = [];
  for (const e of sorted) {
    const ours = internal(e.from_address);
    for (const s of sentences(ownText(e.body_text).replace(/^\s*(buongiorno|buonasera|buon pomeriggio|ciao|salve)\b[^\n]*\n/i, ''))) {
      if (/\bconferm\w*\b.*(lunedì|martedì|mercoledì|giovedì|venerdì|sabato|\d{1,2}[/.]\d{1,2}).*\b(alle|ore)\s*\d{1,2}/i.test(s)) {
        commitments.push({ who: 'fissato', text: s.slice(0, 200), by: e.from_name || e.from_address, date: String(e.sent_at).slice(0, 10) });
      } else if (/\b(vi|ti|le) (mando|mandiamo|invio|inviamo|invierò|invieremo|manderò|manderemo|giro|faccio avere|preparo)\b|\b(mander|invier)(ò|emo)\b/i.test(s)) {
        commitments.push({ who: ours ? 'noi' : 'loro', text: s.slice(0, 200), by: e.from_name || e.from_address, date: String(e.sent_at).slice(0, 10) });
      }
    }
  }
  const b = ball(emails, internal);
  let next = null;
  const fixed = commitments.filter(c => c.who === 'fissato').pop();
  if (fixed && !meetings.some(m => String(m.start_at).slice(0, 10) >= String(fixed.date))) {
    next = { text: `${fixed.by} ha scritto: «${fixed.text}». Metti l'incontro in calendario e rispondi dicendo chi viene.`, kind: 'incontro' };
  } else if (b?.who === 'noi') {
    next = { text: `Rispondi a ${b.from}: «${b.subject}».`, kind: 'risposta' };
  } else if (concept.prossimo_passo) {
    next = { text: concept.prossimo_passo, kind: 'compito' };
  }
  const ourPromises = commitments.filter(c => c.who === 'noi');
  if (next && ourPromises.length) next.text += ` Ricorda: avevi promesso «${ourPromises[ourPromises.length - 1].text}».`;
  // il committente scritto in una email («il committente è Adriatica Data srl»)
  const all = sorted.map(e => ownText(e.body_text)).join('\n');
  const found = (all.match(/committente (?:è|sarà|finale è)\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*)*(?:\s+(?:s\.?r\.?l\.?|s\.?p\.?a\.?|srl|spa))?)/) || [])[1]?.replace(/\.$/, '') || '';
  const committente = concept.committente || found;
  const stakeholders = [];
  if (committente) stakeholders.push({ role: 'decide', name: committente, why: 'committente' });
  for (const p of people) {
    const job = String(p.job || '').toLowerCase();
    const role = /amministratore|titolare|ceo|direttore generale|presidente|acquisti|procurement/.test(job) ? 'decide'
      : /direttore|responsabile|progettist|ingegner|rup|tecnico/.test(job) || p.first ? 'influenza' : 'operativa';
    stakeholders.push({ role, name: p.name, email: p.email, contact_id: p.contact_id || null, why: p.job || (p.first ? 'ha aperto la conversazione' : 'nella conversazione') });
  }
  // in breve: la prima frase del concetto, il committente se c'è, la prima frase sui tempi
  const first = t => (sentences(t || '')[0] || String(t || '')).slice(0, 220);
  const summary = [first(concept.cosa), committente ? `Committente: ${committente}.` : null, first(concept.tempi)].filter(Boolean).join(' ').slice(0, 450);
  return { summary, next_move: next, commitments: commitments.slice(-8), stakeholders: stakeholders.slice(0, 8), client: committente };
}

async function dealState(input, ctx = {}) {
  input = { ...input, emails: isoEmails(input.emails) };
  const base = heuristicDeal(input);
  const ai = await askJson({
    key: ctx.key, fetchImpl: ctx.fetchImpl, maxTokens: 1500,
    system: [
      'Sei l\'assistente commerciale di Almacis (costruzioni e impianti). Leggi la trattativa (email, note, incontri) e',
      'rispondi SOLO con un JSON: summary (2-3 frasi «in breve»: chi, cosa, scadenze, rischi), next_move ({text, kind}: la',
      'cosa più utile da fare adesso, kind = «incontro» | «risposta» | «compito»), commitments (array di {who: «noi» | «loro» |',
      '«fissato», text, by, due (AAAA-MM-GG o "")}: promesse e appuntamenti presi nelle email), stakeholders (array di {role:',
      '«decide» | «influenza» | «operativa», name, email, why}), client (nome del committente finale se compare, altrimenti "").',
      'Non inventare: usa solo quello che c\'è nel testo.',
    ].join(' '),
    input: [
      `Progetto: ${input.title || ''}`, `Concetto: ${JSON.stringify(input.concept || {})}`,
      `Note: ${(input.notes || []).slice(0, 10).map(n => `${String(n.note_date).slice(0, 10)} ${n.body}`).join(' | ').slice(0, 3000)}`,
      `Incontri: ${(input.meetings || []).map(m => `${String(m.start_at).slice(0, 16)} ${m.subject}`).join(' | ')}`,
      thread((input.emails || []).map(e => ({ date: e.sent_at, from: { name: e.from_name, address: e.from_address }, to: e.to_list || [], cc: e.cc_list || [], subject: e.subject, body: e.body_text })), 12000),
    ].join('\n'),
  }).catch(err => { console.warn('[posta] stato della trattativa non letto dall\'AI:', err.message); return null; });
  if (!ai) return { ...base, eur: 0, ai: false };
  const d = ai.data || {};
  const okWho = w => ['noi', 'loro', 'fissato'].includes(w);
  const okRole = r => ['decide', 'influenza', 'operativa'].includes(r);
  return {
    summary: typeof d.summary === 'string' && d.summary.trim() ? d.summary.trim().slice(0, 600) : base.summary,
    next_move: d.next_move?.text ? { text: String(d.next_move.text).slice(0, 400), kind: ['incontro', 'risposta', 'compito'].includes(d.next_move.kind) ? d.next_move.kind : 'compito' } : base.next_move,
    commitments: Array.isArray(d.commitments) ? d.commitments.filter(c => c && okWho(c.who) && c.text).slice(0, 8).map(c => ({ who: c.who, text: String(c.text).slice(0, 200), by: String(c.by || '').slice(0, 120), due: /^\d{4}-\d{2}-\d{2}$/.test(String(c.due || '')) ? c.due : '' })) : base.commitments,
    stakeholders: Array.isArray(d.stakeholders) ? d.stakeholders.filter(s => s && okRole(s.role) && s.name).slice(0, 8).map(s => ({ role: s.role, name: String(s.name).slice(0, 120), email: String(s.email || '').toLowerCase().slice(0, 200), why: String(s.why || '').slice(0, 160) })) : base.stakeholders,
    client: typeof d.client === 'string' ? d.client.trim().slice(0, 160) : base.client,
    eur: ai.eur, ai: true,
  };
}

// La bozza di risposta per «Prepara la risposta»
async function draftReply({ title, emails, concept, nextMove, me }, ctx = {}) {
  emails = isoEmails(emails);
  const last = emails.filter(e => e.sent_at).sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
  const first = (last?.from_name || '').split(' ').filter(w => !/^(ing|arch|geom|dott|avv)\.?$/i.test(w))[0] || '';
  const fallback = `Buongiorno${first ? ` ${first}` : ''},\n\ngrazie del messaggio. ${nextMove?.kind === 'incontro' ? 'Confermo la nostra presenza: saremo io e un collega.' : 'Vi rispondo a breve con quanto richiesto.'}\n\nCordiali saluti\n${me || ''}`;
  const ai = await askJson({
    key: ctx.key, fetchImpl: ctx.fetchImpl, maxTokens: 700,
    system: 'Scrivi in italiano una risposta email breve, cortese e concreta, firmata con il nome dato. Rispondi SOLO con JSON {"text": "..."}. Non promettere prezzi o date che non sono nelle email.',
    input: `Firma: ${me}\nProgetto: ${title}\nProssima mossa: ${nextMove?.text || ''}\nConcetto: ${JSON.stringify(concept || {})}\n\n${thread(emails.map(e => ({ date: e.sent_at, from: { name: e.from_name, address: e.from_address }, to: e.to_list || [], cc: e.cc_list || [], subject: e.subject, body: e.body_text })), 8000)}`,
  }).catch(() => null);
  return { text: ai?.data?.text ? String(ai.data.text).slice(0, 5000) : fallback, eur: ai?.eur || 0, to: last ? [last.from_address] : [], subject: last ? `Re: ${baseSubject(last.subject)}` : `Re: ${title}` };
}

// Un'email di un'altra conversazione parla del progetto? (parole del tema nell'oggetto o nell'anteprima)
function talksAbout(msg, themes) {
  const t = `${msg.subject} ${msg.preview || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hits = (themes || []).filter(w => w && t.includes(w));
  return hits.length ? hits : null;
}

module.exports = { normMsg, baseSubject, heuristicExtract, extract, ball, temperature, heuristicDeal, dealState, draftReply, talksAbout, amountOf, deadlineOf, themesOf, STEPS_TRATTATIVA, romeDay };
