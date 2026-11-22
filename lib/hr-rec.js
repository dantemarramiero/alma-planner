// Alma HR, Fase 3 (ALM2-53; canvas «Alma HR», pagina «Fase 3 · recruitment»): logica pura del recruitment.
// - Catene di approvazione: richiesta (HR + Direzione, CFO se nuova, fuori piano o sopra G6) e offerta (dove cade nella fascia).
// - Bozza dell'annuncio dalla scheda del ruolo e controlli della Direttiva UE 2023/970.
// - Scorecard dal mansionario, voti nascosti finché non hanno votato tutti.
// - Compiti del pre-boarding con le scadenze calcolate sull'ingresso.
// - Lettera d'offerta in Word (.docx) senza dipendenze.
// - Numeri del recruitment (tempo per assumere, imbuto, canali).
const zlib = require('zlib');
const { norm } = require('./hr');

const STAGES = [
  ['nuovi', 'Nuovi'], ['screening', 'Screening'], ['colloquio_hr', 'Colloquio HR'], ['colloquio_tecnico', 'Colloquio tecnico'],
  ['offerta', 'Offerta'], ['accettata', 'Accettata'], ['scartata', 'Scartati'],
];
const FONTI = { pagina: 'Pagina «Lavora con noi»', linkedin: 'LinkedIn', indeed: 'Indeed', referral: 'Referral interno', hr: 'Caricato da HR', altro: 'Altro' };
const CONSERVA_MESI = 24; // Dante 22/11: CV dei non assunti conservati 24 mesi con il consenso

// Richiesta: sempre HR e Direzione; il CFO per posizioni nuove, fuori dal piano o sopra G6.
function reqChain({ tipo, nel_piano: nelPiano, grade }) {
  const out = ['hr', 'direzione'];
  if (tipo === 'nuova' || nelPiano === false || Number(grade) > 6) out.push('cfo');
  return out;
}

// Offerta: fino al riferimento il team HR; fino al massimo anche il Responsabile di BU; fuori fascia la Direzione (con motivo).
function offerChain(ralEuro, band) {
  if (!band) return { chain: ['hr', 'direzione'], zona: 'senza fascia' };
  const k = Number(ralEuro) / 1000;
  if (k < band.min || k > band.max) return { chain: ['hr', 'direzione'], zona: k < band.min ? 'sotto il minimo' : 'sopra il massimo', fuori: true };
  if (k <= band.mid) return { chain: ['hr'], zona: 'fino al riferimento' };
  return { chain: ['hr', 'bu'], zona: 'sopra il riferimento' };
}

const slugify = (s, id) => `${norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}-${id}`;

// La bozza dell'annuncio dalla scheda del ruolo (testi), dalla griglia (fascia) e dalla richiesta (sede, contratto, data).
function postingDraft({ role, band, req, rules, areaName }) {
  const crescita = role?.next_criteria ? `${role.next_criteria}` : '';
  const vb = role?.grade && rules?.variabile?.[role.grade];
  return {
    titolo: `${role?.hr_name || req.posizione}${role?.hr_level ? ` · ${role.hr_level}` : ''}${areaName ? ` · ${areaName}` : ''}`,
    testo: {
      scopo: role?.description || '',
      cosa: (role?.responsibilities || []).join('\n'),
      requisiti: [...(role?.hard_skills || []), ...(role?.requirements || [])].join('\n'),
      crescita,
    },
    ral_min: band ? Math.round(band.min * 1000) : null,
    ral_max: band ? Math.round(band.max * 1000) : null,
    variabile: vb ? `${vb[0]}–${vb[1]}%` : '',
  };
}

// Controlli prima di pubblicare (tavola U). La pagina pubblica non chiede mai la RAL attuale e ha sempre l'informativa.
const GENDERED = /\b(ingegnere|geometra|impiegata|responsabile donna|uomo|ragazzo|ragazza|signore|signora|giovane|max \d+ anni|età)\b/i;
function postingChecks(p) {
  return [
    { ok: Boolean(p.ral_min && p.ral_max), testo: 'Fascia RAL scritta nell\'annuncio' },
    { ok: !GENDERED.test(`${p.titolo} ${p.testo?.requisiti || ''}`), testo: 'Titolo e requisiti senza genere né età' },
    { ok: true, testo: 'Nessuna domanda sulla retribuzione attuale nel modulo' },
    { ok: Boolean((p.testo?.crescita || '').trim()), testo: 'Criteri di crescita del ruolo indicati' },
    { ok: true, testo: 'Informativa privacy e consenso alla conservazione del CV per 24 mesi' },
  ];
}

// Scorecard: le competenze del ruolo (fino a 4) più «valori e squadra» per tutti.
function scorecardItems(role) {
  const fromRole = [...(role?.hard_skills || []), ...(role?.responsibilities || [])].map(s => String(s).trim()).filter(Boolean);
  const uniq = [...new Set(fromRole)].slice(0, 4);
  return [...(uniq.length ? uniq : ['Competenze tecniche del ruolo', 'Organizzazione e autonomia']), 'Valori Almacis e lavoro in squadra'];
}
// Voti di una candidatura: chi non ha ancora votato vede solo i propri.
function scoreView(scores, interviewers, viewer) {
  const voters = [...new Set(interviewers.map(i => norm(i)))];
  const voted = new Set(scores.map(s => norm(s.email)));
  const all = voters.length > 0 && voters.every(v => voted.has(v));
  const canSeeAll = all || !voters.includes(norm(viewer));
  const visible = canSeeAll ? scores : scores.filter(s => norm(s.email) === norm(viewer));
  const byComp = {};
  for (const s of visible) (byComp[s.competenza] ||= []).push(s.voto);
  const medie = Object.fromEntries(Object.entries(byComp).map(([k, v]) => [k, Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10]));
  return { tutti: all, votato: voters.filter(v => voted.has(v)).length, totale: voters.length, visibili: visible, medie: canSeeAll ? medie : null };
}

// Lettura del CV senza AI (testo da .docx/.txt): parole del ruolo trovate. Serve quando il modello non è collegato.
function cvHeuristic(text, role) {
  const t = norm(text);
  if (!t) return null;
  const keys = [...(role?.hard_skills || []), ...(role?.requirements || []), role?.hr_name || ''].map(norm).filter(k => k.length > 3);
  const found = keys.filter(k => t.includes(k));
  const comp = ['c1', 'c2', 'c3', 'c4', 'c5'].filter(c => new RegExp(`\\b${c}\\b`).test(t));
  const pct = keys.length ? Math.round(found.length / keys.length * 100) : null;
  return { pct, note: `Parole del ruolo trovate nel CV: ${found.length ? found.join(', ') : 'nessuna'}${comp.length ? ` · complessità citate: ${comp.join(', ').toUpperCase()}` : ''}. Lettura automatica senza AI: va verificata al colloquio.` };
}

// Compiti del pre-boarding (tavola Y): giorni rispetto all'ingresso.
const PRE_TASKS = [
  ['Documenti dal candidato (identità, codice fiscale, IBAN, titolo di studio)', 'candidato', -20],
  ['Visita medica preassuntiva prenotata', 'hr', -15],
  ['Dati al consulente del lavoro per l\'assunzione e la comunicazione UNILAV', 'consulente', -10],
  ['Crea la persona su BOSS con i dati preparati (poi la sincronizzazione la collega all\'incarico)', 'boss', -7],
  ['PC, account Microsoft e licenze (BOSS, Alma Space)', 'it', -7],
  ['DPI nelle taglie indicate dal candidato', 'magazzino', -5],
  ['Auto aziendale, se prevista', 'mezzi', -5],
  ['Buddy scelto e informato', 'responsabile', -3],
  ['Badge e accessi alla sede', 'hr', -2],
  ['Accoglienza e consegna del piano di onboarding', 'responsabile', 1],
];
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const scadenza = (ingresso, giorni) => addDays(ingresso, giorni < 0 ? giorni : giorni - 1);

// Equità interna: dove entrerebbe l'offerta rispetto alla media di chi ha già lo stesso ruolo.
function equity(ralEuro, peers) {
  if (!peers.length) return null;
  const avg = peers.reduce((a, b) => a + b, 0) / peers.length;
  return { n: peers.length, media: Math.round(avg), scarto_pct: Math.round((ralEuro / avg - 1) * 100) };
}

// Numeri (tavola Z): tempo per assumere (approvazione → «sì»), imbuto, canali, offerte accettate.
function recruitmentStats({ reqs, apps, offers }) {
  const reached = st => apps.filter(a => STAGES.findIndex(([k]) => k === a.max_stage) >= STAGES.findIndex(([k]) => k === st) && a.max_stage !== 'scartata').length;
  const funnel = [
    ['Candidature', apps.length], ['Screening', apps.filter(a => a.passi.includes('screening')).length], ['Colloqui', apps.filter(a => a.passi.includes('colloquio_hr') || a.passi.includes('colloquio_tecnico')).length],
    ['Offerte', apps.filter(a => a.passi.includes('offerta')).length], ['Assunti', apps.filter(a => a.passi.includes('accettata')).length],
  ];
  const canali = {};
  for (const a of apps) { const c = (canali[a.fonte] ||= { candidature: 0, assunti: 0 }); c.candidature++; if (a.passi.includes('accettata')) c.assunti++; }
  const tempi = reqs.filter(r => r.approved_at && r.accepted_at).map(r => Math.round((Date.parse(r.accepted_at) - Date.parse(r.approved_at)) / 86400000)).sort((a, b) => a - b);
  const decise = offers.filter(o => ['accettata', 'rifiutata'].includes(o.stato));
  return {
    funnel, canali: Object.entries(canali).map(([k, v]) => ({ fonte: k, label: FONTI[k] || k, ...v, resa: v.candidature ? Math.round(v.assunti / v.candidature * 100) : 0 })).sort((a, b) => b.resa - a.resa),
    tempo_mediana: tempi.length ? tempi[Math.floor(tempi.length / 2)] : null,
    chiuse: reqs.filter(r => r.stato === 'coperta').length, aperte_vecchie: reqs.filter(r => ['approvata'].includes(r.stato) && r.approved_at && Date.now() - Date.parse(r.approved_at) > 45 * 86400000).length,
    offerte_accettate_pct: decise.length ? Math.round(decise.filter(o => o.stato === 'accettata').length / decise.length * 100) : null,
    rifiuti: decise.filter(o => o.stato === 'rifiutata').map(o => o.motivo_rifiuto).filter(Boolean),
    reached,
  };
}

// ── lettera d'offerta .docx: uno zip con tre file XML ───────────────────────────────────────────────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const xmlEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const eur = n => `${Math.round(n).toLocaleString('it-IT')} €`;
const itDate = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : 'da concordare');
function offerLetterDocx({ candidato, ruolo, area, offerta, firmatario, oggi }) {
  const para = (t, bold) => `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p>`;
  const body = [
    para(`Chieti, ${itDate(oggi)}`), para(''), para(`Gentile ${candidato},`), para(''),
    para(`siamo lieti di proporti di entrare in Almacis come ${ruolo}${area ? `, nell'area ${area}` : ''}.`), para(''),
    para('Le condizioni che ti proponiamo:', true),
    para(`• Retribuzione annua lorda (RAL): ${eur(offerta.ral)}`),
    offerta.variabile ? para(`• Premio variabile target: ${offerta.variabile} della RAL, legato agli obiettivi`) : '',
    para(`• Contratto: ${offerta.contratto === 'TD' ? 'tempo determinato' : offerta.contratto === 'APPR' ? 'apprendistato' : 'tempo indeterminato'}${offerta.ccnl_livello ? ` · ${offerta.ccnl_livello}` : ''}`),
    para(`• Data di ingresso: ${itDate(offerta.ingresso)}`),
    para(`• Periodo di prova: ${offerta.prova_mesi} mesi`),
    offerta.benefit ? para(`• Benefit: ${offerta.benefit}`) : '',
    para(''), para('La proposta resta valida per 7 giorni. Per accettarla basta rispondere a questa email.'), para(''),
    para('Un cordiale saluto,'), para(firmatario || 'Ufficio Risorse Umane'), para('Almacis'),
  ].join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  });
}

module.exports = { STAGES, FONTI, CONSERVA_MESI, reqChain, offerChain, slugify, postingDraft, postingChecks, scorecardItems, scoreView, cvHeuristic, PRE_TASKS, scadenza, addDays, equity, recruitmentStats, offerLetterDocx, zip };
