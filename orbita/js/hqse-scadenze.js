// HQSE fase 4 (ALM2-104): Rinnovi (tavola 7), Cantieri (8, 21), proroga e deroga (22), Reminder (24).
import { h, fill, toast, fmtDate, fmtDateTime, loading } from './ui.js';
import { get, post, put, del } from './api.js';
import { ic, dots, pill, pageTop, title, card, emptyState, cvModal, seg } from './crm-v2.js';

const top = (light, bold, sub, actions) => pageTop({ eyebrow: 'HQSE · Qualifica fornitori', heading: title(light, bold), sub, actions });
const fld = (label, control, hint) => h('label.cv-fld', h('span', label), control, hint ? h('span.cv-hint', hint) : null);
const input = (attrs = {}) => h('input.input', attrs);
const tile = (label, big, sub, acc) => h('div.cv-card.hq-tile', { class: acc ? 'acc' : '' }, h('span.hq-lbl', label), h('span.hq-big', String(big)), h('span.hq-sub', sub));
const cancel = m => h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla');
const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const leftLabel = n => (n < 0 ? `scaduto da ${-n} ${n === -1 ? 'giorno' : 'giorni'}` : n === 0 ? 'scade oggi' : n === 1 ? 'domani' : `tra ${n} giorni`);

// ── Rinnovi (tavola 7) ──────────────────────────────────────────────────────────────────────────
export async function renewalsPage(box) {
  let giorni = '30';
  const list = h('section.cv-card.hq-list', loading());
  const head = h('div');
  const load = async () => {
    const r = await get(`/api/hqse/rinnovi?giorni=${giorni}`);
    const bloc = r.rows.filter(x => x.blocking).length;
    const pend = r.rows.filter(x => x.renewal_pending).length;
    fill(head,
      top(`${r.rows.length} documenti`, giorni === 'scaduti' ? 'scaduti' : `scadono entro ${giorni} giorni`, `Alma manda i reminder da sola: ${r.steps.prima.filter(n => n > 0).join(', ')} giorni prima e il giorno stesso, poi ogni ${r.steps.dopo_ogni} giorni.`,
        [h('a.btn', { href: '#/hqse/reminder' }, ic('settings', 16), 'Reminder')]),
      h('section.hq-tiles',
        tile('In scadenza', r.rows.length, 'nel periodo scelto', true),
        tile('Bloccanti', bloc, 'senza rinnovo il fornitore si ferma'),
        tile('Rinnovo già caricato', pend, 'in verifica: vale ancora il vecchio'),
        tile('Da sollecitare', r.rows.length - pend, 'reminder in automatico')),
      h('div.hq-bar', seg([['30', '30 giorni'], ['60', '60 giorni'], ['90', '90 giorni'], ['scaduti', 'Scaduti']], giorni, k => { giorni = k; load(); }, { label: 'Periodo' })));
    fill(list, r.rows.length ? h('div.hq-scroll', h('table.hq-t',
      h('thead', h('tr', h('th', 'Documento'), h('th', 'Di chi'), h('th', 'Scadenza'), h('th', 'Stato'), h('th', 'Ultimo reminder'), h('th', ''))),
      h('tbody', r.rows.map(x => h('tr', { class: x.left <= 7 ? 'urg' : '' },
        h('td', h('b', x.doc), x.blocking ? h('div.hq-sub', 'bloccante') : null),
        h('td', h('a', { href: `#/hqse/fornitore/${x.supplier_id}` }, x.who)),
        h('td', fmtDate(x.until), h('div.hq-sub', leftLabel(x.left))),
        h('td', x.renewal_pending ? pill('Rinnovo in verifica', 'bl') : x.state === 'scaduto' ? pill('Scaduto', 'rd') : pill('In scadenza', 'am')),
        h('td.hq-sub', x.last_reminder ? fmtDateTime(x.last_reminder) : '—'),
        h('td', x.document_id ? h('button.btn.btn-sm', { type: 'button', on: { click: () => prorogaDialog({ id: x.document_id, name: x.doc, until: x.until }, load) } }, 'Proroga') : null))))))
      : emptyState('calendar-check', giorni === 'scaduti' ? 'Nessun documento scaduto.' : 'Nessun documento in scadenza nel periodo.'));
  };
  fill(box, head, list);
  await load();
}

// proroga di un documento approvato (tavola 22)
export function prorogaDialog(doc, done) {
  const giorni = input({ type: 'number', min: 1, max: 365, value: 15, 'aria-label': 'Giorni di proroga' });
  const reason = h('textarea.input', { rows: 3, placeholder: 'Es. il DURC nuovo è richiesto, arriva entro 10 giorni' });
  const avvisa = h('input', { type: 'checkbox', checked: true });
  const ok = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    ok.disabled = true;
    try {
      const r = await post(`/api/hqse/documenti/${doc.id}/proroga`, { giorni: Number(giorni.value), reason: reason.value, avvisa: avvisa.checked });
      m.close(); toast(`Prorogato fino al ${fmtDate(r.extended_to)}`); done?.();
    } catch (e) { ok.disabled = false; toast(e.message, 'err'); }
  } } }, 'Proroga');
  const m = cvModal({
    title: `Proroga «${doc.name}»`,
    body: h('div.hq-form',
      h('p.hq-sub', `Oggi vale fino al ${fmtDate(doc.until)}. La proroga resta nello storico con il tuo nome, l'ora e il motivo.`),
      fld('Quanti giorni', giorni, 'Al massimo quelli scritti nella regola del documento (30 se non c\'è).'),
      fld('Motivo', reason),
      h('label.hq-check', avvisa, 'Avvisa il fornitore via email')),
    actions: [cancel(m), ok],
  });
}

// deroga di cantiere: entra senza un documento, fino a una data (tavola 22)
function derogaDialog(site, firm, person, blocker, done) {
  const max = new Date(Date.parse(`${todayIso()}T12:00:00Z`) + 30 * 864e5).toISOString().slice(0, 10);
  const until = input({ type: 'date', min: todayIso(), max, value: max });
  const by = input({ placeholder: 'Nome di chi autorizza (direzione)' });
  const reason = h('textarea.input', { rows: 3 });
  const ok = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    ok.disabled = true;
    try {
      await post('/api/hqse/deroghe', { supplier_id: firm.supplier_id, worker_id: person?.worker_id || null, cantiere_id: site.id, doc_type_id: blocker.type_id, until: until.value, reason: reason.value, authorized_by: by.value });
      m.close(); toast('Deroga registrata'); done();
    } catch (e) { ok.disabled = false; toast(e.message, 'err'); }
  } } }, 'Registra la deroga');
  const m = cvModal({
    title: `Deroga su ${site.code}`,
    body: h('div.hq-form',
      h('p', h('b', person ? person.name : firm.name), ` può entrare senza «${blocker.name}» solo in questo cantiere, fino alla data scelta (massimo 30 giorni).`),
      fld('Fino al', until), fld('Autorizzata da', by), fld('Motivo', reason)),
    actions: [cancel(m), ok],
  });
}

// ── Cantieri (tavole 8 e 21) ────────────────────────────────────────────────────────────────────
export async function sitesPage(box) {
  const rows = await get('/api/hqse/cantieri');
  const tot = rows.reduce((a, k) => ({ idonei: a.idonei + (k.counts?.idonei || 0), bloccati: a.bloccati + (k.counts?.bloccati || 0) }), { idonei: 0, bloccati: 0 });
  fill(box,
    top('Chi può entrare', 'in cantiere oggi', 'Per ogni cantiere aperto: fornitori associati, dipendenti idonei e chi è bloccato.'),
    h('section.hq-tiles',
      tile('Cantieri aperti', rows.length, `${rows.filter(k => k.fornitori).length} con fornitori associati`, true),
      tile('Persone idonee', tot.idonei, 'documenti in regola'),
      tile('Persone bloccate', tot.bloccati, 'manca un documento bloccante'),
      tile('Avviso', '07:00', 'il capocommessa riceve i bloccati di domani')),
    rows.length ? h('section.cv-card.hq-list', rows.map(k => h('a.hq-row', { href: `#/hqse/cantieri/${k.id}` },
      h('span.hq-av', { 'aria-hidden': 'true' }, ic('hard-hat', 18)),
      h('span.hq-row-main', h('b', `${k.code} · ${k.name}`), h('span.hq-sub', dots([k.client, k.chief_email]))),
      h('span.hq-sub', k.fornitori ? `${k.fornitori} ${k.fornitori === 1 ? 'fornitore' : 'fornitori'}` : 'nessun fornitore'),
      h('span.hq-row-tags',
        k.counts?.bloccati ? pill(`${k.counts.bloccati} bloccat${k.counts.bloccati === 1 ? 'o' : 'i'}`, 'rd') : null,
        k.counts?.in_scadenza ? pill(`${k.counts.in_scadenza} in scadenza`, 'am') : null,
        k.counts ? pill(`${k.counts.idonei} idone${k.counts.idonei === 1 ? 'o' : 'i'}`, 'gr') : pill('Da associare', 'line')))))
      : emptyState('hard-hat', 'Nessun cantiere aperto: arrivano da BOSS o dalla direzione.'));
}

export async function sitePage(box, id) {
  const s = await get(`/api/hqse/cantieri/${id}`);
  const reload = () => sitePage(box, id);
  const c = s.counts;
  const blockerRow = (firm, person, b) => h('div.hq-ev',
    h('span', pill(b.state === 'scaduto' ? 'Scaduto' : b.state === 'in_verifica' ? 'In verifica' : 'Manca', 'rd'), ' ', b.name),
    h('button.btn.btn-sm', { type: 'button', on: { click: () => derogaDialog(s.site, firm, person, b, reload) } }, 'Deroga'));
  fill(box,
    h('a.cv-crumb', { href: '#/hqse/cantieri' }, ic('chevron-left', 14), 'Cantieri'),
    pageTop({
      eyebrow: dots(['Cantiere', s.site.client, s.site.chief_email && `capocommessa ${s.site.chief_email}`]),
      heading: title(s.site.code, ` · ${s.site.name}`),
      sub: s.checklists_commessa.length ? `Checklist di commessa: ${s.checklists_commessa.map(x => x.name).join(', ')}` : 'Nessuna checklist in più per questa commessa.',
      actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => associaDialog(s.site, reload) } }, ic('plus', 16), 'Associa un fornitore')],
    }),
    h('section.hq-tiles',
      tile('Possono entrare', c.idonei, `su ${c.persone} persone associate`, true),
      tile('Bloccati', c.bloccati, 'manca un documento bloccante'),
      tile('In scadenza', c.in_scadenza, 'entro 7 giorni'),
      tile('Fornitori bloccati', c.fornitori_bloccati, `su ${s.firms.length}`)),
    s.firms.length ? s.firms.map(f => card({
      title: f.name, icon: 'building-2', right: h('span.hq-tags',
        f.ok ? pill('In regola', 'gr') : pill('Bloccato', 'rd'),
        h('a.btn.btn-sm', { href: `#/hqse/fornitore/${f.supplier_id}` }, 'Scheda'),
        h('button.btn.btn-sm', { type: 'button', on: { click: async () => { if (!confirm(`Togliere ${f.name} da ${s.site.code}?`)) return; await del(`/api/hqse/cantieri/${s.site.id}/fornitori/${f.supplier_id}`); toast('Tolto dal cantiere'); reload(); } } }, 'Togli')),
    },
    h('p.hq-sub', dots([f.lavorazione, f.date_from && `dal ${fmtDate(f.date_from)}`, f.date_to && `al ${fmtDate(f.date_to)}`]) || 'Periodo non indicato'),
    f.blockers.map(b => blockerRow(f, null, b)),
    f.warn.map(w => h('div.hq-ev', h('span', pill('In scadenza', 'am'), ' ', w.name), h('span.hq-sub', fmtDate(w.until)))),
    f.people.length ? h('div.hq-people', f.people.map(p => h('div.hq-person', { class: p.ok ? 'ok' : 'ko' },
      h('span.hq-dot', { 'aria-hidden': 'true' }),
      h('span.hq-row-main', h('b', p.name), h('span.hq-sub', p.ok ? (p.warn.length ? `in scadenza: ${p.warn.map(w => w.name).join(', ')}` : 'può entrare') : f.blockers.length && !p.blockers.length ? 'bloccato con l\'azienda' : `manca: ${p.blockers.map(b => b.name).join(', ')}`)),
      p.blockers[0] ? h('button.btn.btn-sm', { type: 'button', on: { click: () => derogaDialog(s.site, f, p, p.blockers[0], reload) } }, 'Deroga') : null)))
      : h('p.hq-sub', 'Nessun dipendente associato.'))) : emptyState('hard-hat', 'Nessun fornitore associato a questo cantiere.'),
    s.waivers.length ? card({ title: 'Deroghe attive', icon: 'shield-alert', count: s.waivers.length },
      s.waivers.map(w => h('div.hq-ev', h('span', h('b', w.supplier), ` · ${w.doc} fino al ${fmtDate(w.until)}`), h('span.hq-sub', dots([`autorizzata da ${w.authorized_by}`, w.reason]))))) : null);
}

// associa un fornitore al cantiere (tavola 21)
export async function associaDialog(site, done, preset = null) {
  const pick = h('select.input', { 'aria-label': 'Fornitore' }, h('option', { value: '' }, 'Scegli il fornitore…'));
  const sups = await get(`/api/hqse/cantieri/${site.id}/candidati`);
  sups.forEach(x => pick.append(h('option', { value: x.id, selected: preset === x.id }, x.name)));
  const from = input({ type: 'date', value: todayIso() });
  const to = input({ type: 'date' });
  const lav = input({ placeholder: 'Es. impianti elettrici, scavi' });
  const people = h('div.hq-people', h('p.hq-sub', 'Scegli il fornitore per vedere i dipendenti.'));
  const chosen = new Set();
  const loadPeople = async () => {
    chosen.clear();
    if (!pick.value) return fill(people, h('p.hq-sub', 'Scegli il fornitore per vedere i dipendenti.'));
    const rows = await get(`/api/hqse/fornitori/${pick.value}/persone-cantiere`);
    fill(people, rows.length ? rows.map(p => {
      const cb = h('input', { type: 'checkbox', on: { change: e => (e.target.checked ? chosen.add(p.id) : chosen.delete(p.id)) } });
      return h('label.hq-person', { class: p.ok ? 'ok' : 'ko' }, cb, h('span.hq-row-main', h('b', p.name), h('span.hq-sub', p.ok ? 'documenti in regola' : `manca: ${p.problem}`)));
    }) : h('p.hq-sub', 'Il fornitore non ha ancora dipendenti nel portale.'));
  };
  pick.addEventListener('change', loadPeople);
  const ok = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    ok.disabled = true;
    try {
      const r = await post(`/api/hqse/cantieri/${site.id}/associa`, { supplier_id: Number(pick.value), date_from: from.value || null, date_to: to.value || null, lavorazione: lav.value, worker_ids: [...chosen] });
      m.close(); toast(r.checklists_aggiunte.length ? `Associato: chiesti anche ${r.checklists_aggiunte.join(', ')}` : 'Associato al cantiere'); done();
    } catch (e) { ok.disabled = false; toast(e.message, 'err'); }
  } } }, 'Associa');
  const m = cvModal({
    title: `Associa un fornitore a ${site.code}`,
    body: h('div.hq-form', fld('Fornitore', pick), h('div.hq-two-f', fld('Dal', from), fld('Al', to)), fld('Lavorazione', lav),
      h('div.cv-fld', h('span', 'Dipendenti che entrano'), people),
      h('p.hq-sub', 'Alma aggiunge la CL7 e le checklist della commessa, e scrive al fornitore cosa caricare.')),
    actions: [cancel(m), ok],
  });
  if (preset) loadPeople();
}

// ── Reminder (tavola 24) ────────────────────────────────────────────────────────────────────────
export async function remindersPage(box) {
  const [s, log] = await Promise.all([get('/api/hqse/reminder'), get('/api/hqse/reminder/registro')]);
  const f = { ...s.fornitore };
  const a = { ...s.almacis };
  const chips = (opts, isOn, toggle) => {
    const el = h('div.hq-chips');
    const draw = () => fill(el, opts.map(([v, l]) => h('button.cv-chip', { type: 'button', class: isOn(v) ? 'on' : '', 'aria-pressed': String(isOn(v)), on: { click: () => { toggle(v); draw(); } } }, l)));
    draw();
    return el;
  };
  const prima = new Set(f.prima);
  const ogg = input({ value: f.oggetto });
  const txt = h('textarea.input', { rows: 5 }, f.testo);
  const dest = input({ value: (a.hqse_destinatari || []).join(', '), placeholder: 'qualifica@almacis.it' });
  const sw = (key, label, sub) => {
    const cb = h('input', { type: 'checkbox', role: 'switch', checked: a[key] !== false, 'aria-label': label, on: { change: e => { a[key] = e.target.checked; } } });
    return h('label.hq-set', h('span.hq-row-main', h('b', label), h('span.hq-sub', sub)), cb);
  };
  const save = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    save.disabled = true;
    try {
      await put('/api/hqse/reminder', { fornitore: { ...f, prima: [...prima], oggetto: ogg.value, testo: txt.value }, almacis: { ...a, hqse_destinatari: dest.value.split(/[,;\s]+/).filter(Boolean) } });
      toast('Reminder salvati');
    } catch (e) { toast(e.message, 'err'); }
    save.disabled = false;
  } } }, 'Salva');
  const prova = h('button.btn', { type: 'button', on: { click: async () => { try { const r = await post('/api/hqse/reminder/prova', {}); toast(`Prova mandata a ${r.to}`); } catch (e) { toast(e.message, 'err'); } } } }, 'Manda una prova a me');
  const KIND = { rinnovo: 'Rinnovo', mancante: 'Mai caricati', respinto: 'Respinto', capocommessa: 'Capocommessa', riepilogo: 'Riepilogo HQSE', bloccato: 'Bloccato', prova: 'Prova' };
  fill(box,
    top('Chi avvisare,', 'e quando', 'Alma fa il giro ogni mattina alle 7 nei giorni feriali. Una sola email per fornitore, a tutti quelli che possono caricare.', [prova, save]),
    h('div.hq-two',
      card({ title: 'Al fornitore', icon: 'send' },
        h('div.hq-form',
          h('div.cv-fld', h('span', 'Prima della scadenza'), chips([[60, '60 giorni'], [30, '30 giorni'], [15, '15 giorni'], [7, '7 giorni'], [3, '3 giorni'], [0, 'il giorno stesso']], v => prima.has(v), v => (prima.has(v) ? prima.delete(v) : prima.add(v)))),
          h('div.cv-fld', h('span', 'Dopo la scadenza, finché non carica'), chips([[3, 'ogni 3 giorni'], [7, 'ogni 7 giorni'], [14, 'ogni 14 giorni']], v => f.dopo_ogni === v, v => { f.dopo_ogni = v; })),
          h('div.cv-fld', h('span', 'Documenti mai caricati'), chips([[3, '3 giorni dopo la registrazione'], [7, '7 giorni dopo']], v => f.mai_caricati_dopo === v, v => { f.mai_caricati_dopo = v; })),
          fld('Oggetto dell\'email', ogg),
          fld('Testo dell\'email', txt, 'Le parole tra « » le riempie Alma: «nome», «numero», «data», «elenco».'),
          h('p.hq-sub', 'Le eccezioni per documento (es. DURF, LUL) si cambiano in Checklist e regole, campo «Reminder prima della scadenza».'))),
      h('div.hq-col',
        card({ title: 'Ad Almacis', icon: 'bell' },
          sw('hqse_giornaliero', 'Riepilogo per HQSE', 'ogni mattina: scadenze, bloccati, documenti da verificare'),
          fld('Chi lo riceve', dest, 'Se vuoto: le persone che vedono il modulo HQSE.'),
          sw('capocommessa_lunedi', 'Riepilogo per i capicommessa', 'ogni lunedì, solo i loro cantieri aperti'),
          sw('bloccato_subito', 'Avviso quando qualcuno si blocca', 'il giorno della scadenza, al capocommessa del cantiere')),
        card({ title: 'Ultimi invii', icon: 'clock', count: log.length },
          log.length ? log.slice(0, 12).map(r => h('div.hq-ev', h('span', h('b', KIND[r.kind] || r.kind), ' · ', r.supplier || r.sent_to), h('span.hq-sub', dots([r.subject, fmtDateTime(r.sent_at)]))))
            : emptyState('send', 'Ancora nessun invio: il primo giro parte domattina alle 7.')))));
}
