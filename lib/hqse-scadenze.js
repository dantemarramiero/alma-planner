// HQSE fase 4 (ALM2-104, tavole 7, 8 e 21–24 approvate da Dante il 27/11/2026): scadenze, reminder e cantieri.
// - Idoneità per cantiere: un fornitore entra se tutti i documenti bloccanti delle sue checklist obbligatorie (comprese
//   quelle della commessa di quel cantiere) sono in regola; un dipendente se lo è il fornitore e i suoi documenti
//   bloccanti. Proroghe (extended_to) e deroghe del cantiere contano come «in regola» fino alla loro data.
// - Giro giornaliero (giorni feriali, dalle 7 in Italia, una volta sola): al fornitore UNA email con tutto quello che
//   scade o manca (giorni da «Impostazioni dei reminder»); al capocommessa l'avviso «da domani non entra»; a HQSE il
//   riepilogo del mattino; ai capicommessa il riepilogo del lunedì. send_log evita i doppioni, hqse_reminders è il registro.
const H = require('./hqse');
const S = require('./hqse-stato');
const P = require('./hqse-portale');

const DEFAULTS = {
  fornitore: { prima: [30, 15, 7, 0], dopo_ogni: 7, mai_caricati_dopo: 3, mai_caricati_ogni: 7,
    oggetto: '«numero» documenti da rinnovare o caricare', testo: 'Buongiorno «nome»,\nper continuare a lavorare nei cantieri Almacis servono questi documenti:\n«elenco»' },
  almacis: { hqse_giornaliero: true, hqse_destinatari: [], capocommessa_lunedi: true, bloccato_subito: true },
};
function settingsOf(row) {
  const s = row || {};
  return { fornitore: { ...DEFAULTS.fornitore, ...(s.fornitore || {}) }, almacis: { ...DEFAULTS.almacis, ...(s.almacis || {}) } };
}
async function loadSettings(db) {
  const { rows: [r] } = await db.query('SELECT settings FROM hqse_reminder_settings WHERE id = 1');
  return settingsOf(r?.settings);
}

const days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
const dmy = iso => String(iso).slice(0, 10).split('-').reverse().join('/');
const romeNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { today: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday };
};
async function once(db, key) {
  const { rows } = await db.query('INSERT INTO send_log (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key', [`hqse:${key}`]);
  return Boolean(rows[0]);
}

// ── idoneità per cantiere ──────────────────────────────────────────────────────────────────────────
async function siteStatus(db, cantiereId, today) {
  const { rows: [site] } = await db.query('SELECT id, code, name, client, chief_email, status FROM cantieri WHERE id = $1', [cantiereId]);
  if (!site) return null;
  const { rows: links } = await db.query(`SELECT l.id, l.supplier_id, l.worker_id, l.date_from, l.date_to, l.lavorazione, c.name AS supplier,
      trim(concat_ws(' ', wc.first_name, wc.last_name)) AS worker
     FROM hqse_site_links l JOIN hqse_suppliers q ON q.id = l.supplier_id JOIN crm_subjects c ON c.id = q.subject_id
     LEFT JOIN hqse_workers w ON w.id = l.worker_id LEFT JOIN crm_contacts wc ON wc.id = w.contact_id
     WHERE l.cantiere_id = $1 AND (l.date_to IS NULL OR l.date_to >= $2) ORDER BY lower(c.name), l.worker_id NULLS FIRST`, [cantiereId, today]);
  const ids = [...new Set(links.map(l => l.supplier_id))];
  const st = await S.computeStates(db, ids, today);
  const { rows: waivers } = await db.query('SELECT supplier_id, worker_id, doc_type_id, until FROM hqse_waivers WHERE cantiere_id = $1 AND until >= $2', [cantiereId, today]);
  const waived = (sid, wid, tid) => waivers.some(w => w.supplier_id === sid && (w.worker_id || null) === (wid || null) && w.doc_type_id === tid);
  const forSite = c => !c.optional && (!c.commesse?.length || c.commesse.includes(site.code));
  const firms = ids.map(sid => {
    const s = st[sid];
    const docs = [...new Map(s.checklists.filter(forSite).flatMap(c => c.docs).map(d => [d.type_id, d])).values()];
    const blockers = docs.filter(d => d.blocking && !H.isOk(d.state) && !waived(sid, null, d.type_id)).map(d => ({ name: d.name, state: d.state, type_id: d.type_id }));
    const warn = docs.filter(d => d.state === 'in_scadenza' && d.days <= 7).map(d => ({ name: d.name, until: d.until }));
    const head = links.find(l => l.supplier_id === sid && !l.worker_id) || links.find(l => l.supplier_id === sid);
    const people = links.filter(l => l.supplier_id === sid && l.worker_id).map(l => {
      const wd = s.worker_docs[l.worker_id] || [];
      const own = wd.filter(d => d.blocking && !H.isOk(d.state) && !waived(sid, l.worker_id, d.type_id)).map(d => ({ name: d.name, state: d.state, type_id: d.type_id }));
      const wwarn = wd.filter(d => d.state === 'in_scadenza' && d.days <= 7).map(d => ({ name: d.name, until: d.until }));
      return { worker_id: l.worker_id, name: l.worker, ok: !blockers.length && !own.length, blockers: own, warn: wwarn };
    });
    return { supplier_id: sid, name: head.supplier, lavorazione: head.lavorazione, date_from: head.date_from, date_to: head.date_to, ok: !blockers.length, blockers, warn, people };
  });
  const people = firms.flatMap(f => f.people);
  return { site, firms, counts: { idonei: people.filter(p => p.ok).length, bloccati: people.filter(p => !p.ok).length, in_scadenza: people.filter(p => p.ok && p.warn.length).length, persone: people.length, fornitori_bloccati: firms.filter(f => !f.ok).length } };
}

// ── giro giornaliero ───────────────────────────────────────────────────────────────────────────────
// documenti che chiedono un reminder oggi, per fornitore
function dueItems(s, sup, settings, today) {
  const f = settings.fornitore;
  const out = [];
  const consider = (d, who) => {
    if (d.renewal_pending || d.state === 'in_verifica' || d.state === 'respinto' || d.state === 'integrazione') return;
    const label = who ? `${d.name} (${who})` : d.name;
    if ((d.state === 'approvato' || d.state === 'in_scadenza') && d.until) {
      const left = days(today, d.until);
      const notice = [...new Set([...(d.notice_days?.length ? d.notice_days : f.prima.filter(x => x > 0)), 0])];
      if (notice.includes(left)) out.push({ label, until: d.until, kind: 'rinnovo', left, blocking: d.blocking, type_id: d.type_id });
    } else if (d.state === 'scaduto' && d.until) {
      const since = days(d.until, today);
      if (since > 0 && since % f.dopo_ogni === 0) out.push({ label, until: d.until, kind: 'rinnovo', left: -since, blocking: d.blocking, type_id: d.type_id });
    } else if (d.state === 'da_caricare' && sup.questionario_at) {
      const since = days(String(sup.questionario_at instanceof Date ? sup.questionario_at.toISOString() : sup.questionario_at).slice(0, 10), today);
      if (since === f.mai_caricati_dopo || (since > f.mai_caricati_dopo && (since - f.mai_caricati_dopo) % f.mai_caricati_ogni === 0)) out.push({ label, kind: 'mancante', blocking: d.blocking, type_id: d.type_id });
    }
  };
  const seen = new Set();
  for (const c of s.checklists.filter(x => !x.optional)) for (const d of c.docs) if (!seen.has(d.type_id)) { seen.add(d.type_id); consider(d, null); }
  for (const [wid, docs] of Object.entries(s.worker_docs)) for (const d of docs) consider(d, sup.workers[wid] || 'dipendente');
  for (const [vid, docs] of Object.entries(s.vehicle_docs)) for (const d of docs) consider(d, sup.vehicles[vid] || 'mezzo');
  return out;
}

function fill(tpl, vars) { return String(tpl).replace(/«(numero|data|nome|elenco)»/g, (_, k) => vars[k] ?? ''); }

async function runDaily(db, { mailer, baseUrl = '', today, weekday = null, force = false } = {}) {
  const out = { fornitori: 0, bloccati: 0, hqse: 0, capicommessa: 0 };
  if (!mailer) return out;
  const settings = await loadSettings(db);
  // i fornitori arrivati da Vittoria ricevono reminder solo dal giorno dopo il benvenuto (tavola 27); «mai caricati» conta da lì
  const { rows: sups } = await db.query(`SELECT q.id, q.status, COALESCE(q.questionario_at, q.welcomed_at) AS questionario_at, c.name FROM hqse_suppliers q JOIN crm_subjects c ON c.id = q.subject_id
     WHERE q.status NOT IN ('sospeso', 'terminato') AND NOT (q.from_vittoria AND (q.welcomed_at IS NULL OR (q.welcomed_at AT TIME ZONE 'Europe/Rome')::date >= $1::date))`, [today]);
  const st = await S.computeStates(db, sups.map(s => s.id), today);
  const { rows: names } = await db.query(`SELECT w.id, w.supplier_id, trim(concat_ws(' ', c.first_name, c.last_name)) AS name FROM hqse_workers w JOIN crm_contacts c ON c.id = w.contact_id WHERE w.supplier_id = ANY($1::int[])`, [sups.map(s => s.id)]);
  const { rows: vnames } = await db.query('SELECT id, supplier_id, kind FROM hqse_vehicles WHERE supplier_id = ANY($1::int[])', [sups.map(s => s.id)]);
  const log = (supplierId, kind, to, subject) => db.query('INSERT INTO hqse_reminders (supplier_id, kind, sent_to, subject) VALUES ($1, $2, $3, $4)', [supplierId, kind, to, subject]);

  // 1 · al fornitore: una sola email
  for (const sup of sups) {
    sup.workers = Object.fromEntries(names.filter(n => n.supplier_id === sup.id).map(n => [n.id, n.name]));
    sup.vehicles = Object.fromEntries(vnames.filter(n => n.supplier_id === sup.id).map(n => [n.id, n.kind]));
    const items = dueItems(st[sup.id], sup, settings, today);
    if (!items.length || !(force || await once(db, `fornitore:${sup.id}:${today}`))) continue;
    const { rows: rcpt } = await db.query('SELECT email, name FROM hqse_portal_users WHERE supplier_id = $1 AND active AND can_upload', [sup.id]);
    if (!rcpt.length) continue;
    const first = items.filter(i => i.until).map(i => i.until).sort()[0];
    const elenco = items.map(i => `<li><b>${P.esc(i.label)}</b>${i.until ? (i.left < 0 ? ` · scaduto il ${dmy(i.until)}` : i.left === 0 ? ' · scade oggi' : ` · scade il ${dmy(i.until)}`) : ' · da caricare'}</li>`).join('');
    const subject = fill(settings.fornitore.oggetto, { numero: items.length, data: first ? dmy(first) : '' }).slice(0, 200);
    for (const r of rcpt) {
      const body = P.esc(fill(settings.fornitore.testo, { nome: (r.name || '').split(' ')[0] || '', numero: items.length, data: first ? dmy(first) : '', elenco: '§§' })).replace(/\n/g, '<br>').replace('§§', `</p><ul style="margin:0 0 10px;padding-left:18px">${elenco}</ul><p style="margin:0 0 10px">`);
      await mailer.send({ to: r.email, subject, text: items.map(i => i.label).join(', '), html: P.emailHtml(baseUrl, { righe: [body], bottone: 'Carica i documenti', link: `${baseUrl}/fornitori`, nota: 'Il link ti porta al portale fornitori di Almacis.' }) }).catch(e => console.warn('[hqse] reminder:', e.message));
      await log(sup.id, items.some(i => i.kind === 'rinnovo') ? 'rinnovo' : 'mancante', r.email, subject);
    }
    out.fornitori++;
  }

  // 2 · al capocommessa, subito: chi da domani non entra (documento bloccante che scade oggi)
  if (settings.almacis.bloccato_subito) {
    const { rows: links } = await db.query(`SELECT DISTINCT l.supplier_id, l.worker_id, k.id AS cantiere_id, k.code, k.chief_email FROM hqse_site_links l JOIN cantieri k ON k.id = l.cantiere_id
       WHERE k.status = 'aperto' AND k.chief_email <> '' AND (l.date_to IS NULL OR l.date_to >= $1)`, [today]);
    for (const l of links) {
      const s = st[l.supplier_id];
      if (!s) continue;
      const sup = sups.find(x => x.id === l.supplier_id);
      const docs = l.worker_id ? (s.worker_docs[l.worker_id] || []) : s.checklists.filter(c => !c.optional).flatMap(c => c.docs);
      for (const d of docs.filter(x => x.blocking && x.until && days(today, x.until) === 0 && !x.renewal_pending)) {
        if (!(force || await once(db, `bloccato:${l.cantiere_id}:${l.supplier_id}:${l.worker_id || 0}:${d.type_id}:${today}`))) continue;
        const who = l.worker_id ? (names.find(n => n.id === l.worker_id)?.name || 'un dipendente') : sup.name;
        const subject = `[${l.code}] ${who} non può entrare da domani`;
        await mailer.send({ to: l.chief_email, subject, html: P.emailHtml(baseUrl, { righe: [`Il documento <b>${P.esc(d.name)}</b> di ${P.esc(who)}${l.worker_id ? ` (${P.esc(sup.name)})` : ''} scade oggi e il rinnovo non è ancora arrivato.`, 'Il fornitore ha già ricevuto i reminder. Se serve, chiedi a HQSE una proroga.'], bottone: 'Apri il cantiere', link: `${baseUrl}/app#/hqse/cantieri/${l.cantiere_id}` }) }).catch(() => {});
        await log(l.supplier_id, 'bloccato', l.chief_email, subject);
        out.bloccati++;
      }
    }
  }

  // 3 · a HQSE, ogni mattina: coda, bloccanti, scadenze dei prossimi 30 giorni
  if (settings.almacis.hqse_giornaliero && (force || await once(db, `riepilogo:${today}`))) {
    const { rows: [q] } = await db.query("SELECT COUNT(*)::int AS n FROM hqse_documents WHERE status = 'in_verifica'");
    const soon = Object.values(st).flatMap(s => [...s.checklists.filter(c => !c.optional).flatMap(c => c.docs), ...Object.values(s.worker_docs).flat()]).filter(d => d.until && d.state === 'in_scadenza').length;
    const expired = Object.values(st).flatMap(s => s.checklists.flatMap(c => c.docs)).filter(d => d.state === 'scaduto').length;
    if (q.n || soon || expired) {
      const to = settings.almacis.hqse_destinatari.length ? settings.almacis.hqse_destinatari : String(process.env.HQSE_UTENTI || 'dante.marramiero@almacis.it').split(/[,;\s]+/).filter(P.validEmail);
      const subject = `HQSE oggi: ${q.n} da verificare, ${soon} in scadenza`;
      for (const e of to) {
        await mailer.send({ to: e, subject, html: P.emailHtml(baseUrl, { righe: [`<b>${q.n}</b> documenti da verificare · <b>${soon}</b> in scadenza nei prossimi giorni · <b>${expired}</b> scaduti.`], bottone: 'Apri la coda', link: `${baseUrl}/app#/hqse/verifica` }) }).catch(() => {});
        await log(null, 'riepilogo', e, subject);
      }
      out.hqse = to.length;
    }
  }

  // 4 · ai capicommessa, il lunedì: i loro cantieri aperti
  if (settings.almacis.capocommessa_lunedi && (weekday === 'Mon' || force)) {
    const { rows: sites } = await db.query(`SELECT DISTINCT k.id, k.chief_email FROM cantieri k JOIN hqse_site_links l ON l.cantiere_id = k.id WHERE k.status = 'aperto' AND k.chief_email <> ''`);
    const byChief = {};
    for (const k of sites) (byChief[k.chief_email.toLowerCase()] ||= []).push(k.id);
    for (const [chief, ids] of Object.entries(byChief)) {
      if (!(force || await once(db, `capocommessa:${chief}:${today}`))) continue;
      const parts = [];
      for (const id of ids) {
        const s = await siteStatus(db, id, today);
        parts.push(`<b>${P.esc(s.site.code)} · ${P.esc(s.site.name)}</b>: ${s.counts.idonei} possono entrare${s.counts.bloccati ? `, <b style="color:#B42318">${s.counts.bloccati} bloccati</b>` : ''}${s.counts.in_scadenza ? `, ${s.counts.in_scadenza} con un documento in scadenza` : ''}.`);
      }
      const subject = 'I tuoi cantieri questa settimana';
      await mailer.send({ to: chief, subject, html: P.emailHtml(baseUrl, { righe: parts, bottone: 'Chi può entrare oggi', link: `${baseUrl}/app#/hqse/cantieri` }) }).catch(() => {});
      await log(null, 'capocommessa', chief, subject);
      out.capicommessa++;
    }
  }
  return out;
}

// avvio: ogni 10 minuti controlla se è ora (feriali, dalle 7); il giro parte una volta al giorno
function createScheduler({ db, mailer, baseUrl }) {
  let busy = false;
  const extra = []; // altri giri del mattino (es. secondo invito del benvenuto, fase 5)
  async function tick() {
    const { today, hour, weekday } = romeNow();
    if (busy || hour < 7 || weekday === 'Sat' || weekday === 'Sun') return;
    busy = true;
    try {
      if (await once(db, `giro:${today}`)) {
        const r = await runDaily(db, { mailer, baseUrl, today, weekday });
        console.log(`[hqse] giro delle scadenze: ${r.fornitori} fornitori, ${r.bloccati} avvisi di blocco, ${r.capicommessa} capicommessa`);
        for (const fn of extra) await fn({ today }).catch(err => console.warn('[hqse] giro del mattino', err.message));
      }
    } catch (err) { console.warn('[hqse] giro delle scadenze non riuscito', err.message); } finally { busy = false; }
  }
  return { start: (ms = 10 * 60 * 1000) => setInterval(tick, ms).unref(), tick, addDaily: fn => extra.push(fn), runExtra: async o => { for (const fn of extra) await fn(o); } };
}

module.exports = { DEFAULTS, settingsOf, loadSettings, siteStatus, dueItems, runDaily, createScheduler, romeNow };
