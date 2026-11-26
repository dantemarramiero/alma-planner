// Portale del fornitore (HQSE fase 2, ALM2-101; tavole 3, 4, 10–15 approvate da Dante il 27/11/2026).
// Pagina a sé (orbita/portale.html, servita su /fornitori): niente login di Microsoft, niente password.
// Senza sessione: «Mandami il codice» → 6 cifre via email. Primo accesso: questionario dell'azienda. Poi le schede
// Cosa ti manca · Dipendenti · Mezzi e cantieri · Azienda. Caricando un documento si scrive la data: la scadenza la
// calcola Alma (la lettura automatica del documento arriva con la fase 3).

// ── pezzi comuni ─────────────────────────────────────────────────────────────────────────────────
function h(tag, attrs, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name);
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, val] of Object.entries(attrs || {})) {
    if (val === null || val === undefined || val === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(val)) el.addEventListener(ev, fn);
    else if (k === 'class') el.className = [el.className, val].filter(Boolean).join(' ');
    else if (k === 'style' && typeof val === 'object') Object.assign(el.style, val);
    else if (k in el && k !== 'list' && typeof val !== 'string') el[k] = val;
    else el.setAttribute(k, val === true ? '' : val);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const fill = (el, ...kids) => { el.replaceChildren(); for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : String(k)); return el; };
const $ = id => document.getElementById(id);
const app = $('app');
const dmy = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const ini = s => String(s || '?').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
function toast(text, err = false) {
  const t = $('toast');
  t.textContent = text; t.className = `pf-toast${err ? ' err' : ''}`; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500);
}
class NeedLogin extends Error {}
async function api(method, path, body) {
  const res = await fetch(`/fornitori/api${path}`, { method, headers: { 'X-Portale': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new NeedLogin(data.error);
  if (!res.ok) throw new Error(data.error || 'Qualcosa non è andato, riprova');
  return data;
}
const STATE = { da_caricare: ['Da caricare', ''], in_verifica: ['In verifica', 'bl'], respinto: ['Respinto', 'rd'], integrazione: ['Da completare', 'rd'], approvato: ['Approvato', 'gr'], in_scadenza: ['In scadenza', 'am'], scaduto: ['Scaduto', 'rd'] };
const statePill = d => {
  if (d.state === 'in_scadenza' && d.days !== undefined) return h('span.pf-pill.am', d.days === 0 ? 'Scade oggi' : `Scade tra ${d.days} ${d.days === 1 ? 'giorno' : 'giorni'}`);
  const [label, tone] = STATE[d.state] || [d.state, ''];
  return h(`span.pf-pill${tone ? `.${tone}` : ''}`, d.renewal_pending ? `${label} · rinnovo in verifica` : label);
};
const needsAction = d => ['da_caricare', 'respinto', 'integrazione', 'scaduto', 'in_scadenza'].includes(d.state) && !d.renewal_pending;
const btn = (text, onClick, cls = '') => h(`button.pf-btn${cls}`, { type: 'button', on: { click: onClick } }, text);
const field = (label, input, hint) => h('label.pf-fld', label, input, hint ? h('span.pf-sub', hint) : null);

let ctx = null; // { me, supplier, tipi, checklists, docs, workers }

// ── avvio e navigazione ──────────────────────────────────────────────────────────────────────────
async function route() {
  try {
    ctx = await api('GET', '/stato');
  } catch (e) {
    if (e instanceof NeedLogin) return loginPage();
    fill(app, h('div.pf-card', h('b', 'Il portale non risponde'), h('span.pf-sub', e.message)));
    return;
  }
  drawTop();
  if (!ctx.supplier.questionario_at) return questionnaire();
  const [page, id] = location.hash.replace(/^#\/?/, '').split('/');
  window.scrollTo(0, 0);
  if (page === 'dipendenti') return id === 'nuovo' ? workerForm(null) : workersPage(Number(id) || null);
  if (page === 'mezzi') return vehiclesPage();
  if (page === 'azienda') return companyPage();
  return todoPage();
}
window.addEventListener('hashchange', route);

function drawTop() {
  const page = location.hash.replace(/^#\/?/, '').split('/')[0] || '';
  const todo = ctx.checklists.flatMap(c => c.docs).filter(d => needsAction(d) && !c_opt(d)).length;
  const tabs = [['', 'Cosa ti manca', todo], ['dipendenti', 'Dipendenti', ctx.workers.missing], ['mezzi', 'Mezzi e cantieri'], ['azienda', 'Azienda']];
  const nav = $('tabs');
  nav.hidden = !ctx.supplier.questionario_at;
  fill(nav, tabs.map(([k, l, n]) => h('a', { href: `#/${k}`, 'aria-current': page === k ? 'page' : null }, l, n ? h('span.pf-n', String(n)) : null)));
  fill($('who'), h('span', ctx.supplier.name, h('span.pf-muted', ` · ${ctx.me.name || ctx.me.email}`)),
    h('button.pf-link', { type: 'button', on: { click: async () => { await api('POST', '/esci', {}); location.hash = ''; route(); } } }, 'Esci'));
}
// i documenti delle checklist facoltative (punteggi aggiuntivi) non sono «da fare»
const optionalTypes = () => new Set(ctx.checklists.filter(c => c.optional).flatMap(c => c.docs.map(d => d.type_id)));
const requiredTypes = () => new Set(ctx.checklists.filter(c => !c.optional).flatMap(c => c.docs.map(d => d.type_id)));
function c_opt(d) { return optionalTypes().has(d.type_id) && !requiredTypes().has(d.type_id); }

// ── accesso (tavola 10) ──────────────────────────────────────────────────────────────────────────
function loginPage() {
  $('tabs').hidden = true;
  fill($('who'));
  const expired = new URLSearchParams(location.search).get('link') === 'scaduto';
  const email = h('input', { type: 'email', autocomplete: 'email', placeholder: 'nome@azienda.it', required: true });
  const msg = h('p.pf-err', { role: 'alert' });
  const send = btn('Mandami il codice', async () => {
    msg.textContent = '';
    send.disabled = true;
    try { await api('POST', '/codice', { email: email.value }); codePage(email.value.trim().toLowerCase()); } catch (e) { msg.textContent = e.message; send.disabled = false; }
  }, '.pri.big');
  email.addEventListener('keydown', e => { if (e.key === 'Enter') send.click(); });
  fill(app, h('section.pf-card.acc.pf-login',
    h('h1.pf-h1', 'Entra nel ', h('b', 'portale fornitori')),
    h('p.pf-sub', expired ? 'Il link dell\'email è scaduto o è già stato usato. Scrivi la tua email: ti mandiamo un codice di 6 cifre.' : 'Scrivi l\'email con cui hai registrato l\'azienda: ti mandiamo un codice di 6 cifre. Niente password.'),
    h('div', { style: { width: '100%', display: 'grid', gap: '14px', textAlign: 'left' } }, field('La tua email', email), msg, send),
    h('p.pf-sub', 'Non sei ancora registrato? Registrati dal sito ', h('a', { href: 'https://www.almacis.it' }, 'almacis.it'), '.')));
  email.focus();
}

function codePage(email) {
  const boxes = Array.from({ length: 6 }, (_, i) => h('input', { inputmode: 'numeric', maxlength: 1, 'aria-label': `Cifra ${i + 1}`, autocomplete: i ? 'off' : 'one-time-code' }));
  const msg = h('p.pf-err', { role: 'alert' });
  const go = async () => {
    const codice = boxes.map(b => b.value).join('');
    if (codice.length !== 6) return;
    msg.textContent = '';
    try { await api('POST', '/accedi', { email, codice }); history.replaceState(null, '', '/fornitori'); route(); } catch (e) { msg.textContent = e.message; boxes.forEach(b => { b.value = ''; }); boxes[0].focus(); }
  };
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => {
      const d = b.value.replace(/\D/g, '');
      if (d.length > 1) { d.slice(0, 6).split('').forEach((c, j) => { if (boxes[j]) boxes[j].value = c; }); go(); return; }
      b.value = d;
      if (d && boxes[i + 1]) boxes[i + 1].focus();
      if (boxes.every(x => x.value)) go();
    });
    b.addEventListener('keydown', e => { if (e.key === 'Backspace' && !b.value && boxes[i - 1]) boxes[i - 1].focus(); });
  });
  fill(app, h('section.pf-card.acc.pf-login',
    h('h1.pf-h1', 'Ti abbiamo mandato ', h('b', 'un codice')),
    h('p.pf-sub', 'Scrivi le 6 cifre arrivate a ', h('b', email), '. Il codice vale 10 minuti.'),
    h('div.pf-digits', { role: 'group', 'aria-label': 'Codice di accesso' }, boxes), msg,
    btn('Entra', go, '.pri.big'),
    h('p.pf-sub', 'Non è arrivato? ', h('button.pf-link', { type: 'button', on: { click: async () => { await api('POST', '/codice', { email }); toast('Codice rimandato'); } } }, 'Mandamelo di nuovo'),
      ' · ', h('button.pf-link', { type: 'button', on: { click: loginPage } }, 'Usa un\'altra email'))));
  boxes[0].focus();
}

// ── primo accesso: il questionario dell'azienda (tavola 11) ──────────────────────────────────────
async function questionnaire() {
  let tipo = ctx.supplier.tipo_appalto || 'lavori';
  let whitelist = ctx.supplier.whitelist;
  const isRef = ctx.me.role === 'referente';
  const opts = h('div', { style: { display: 'grid', gap: '10px' } });
  const wl = h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } });
  const side = h('aside.pf-card');
  const drawSide = async () => {
    const p = await api('GET', `/questionario/anteprima?tipo=${tipo}`);
    fill(side, h('span.pf-lbl', `Con «${ctx.tipi.find(t => t.key === tipo)?.label}» ti chiederemo`),
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px' } }, h('span', { style: { fontSize: '48px', fontWeight: 300, color: 'var(--cv-ink)', lineHeight: 1 } }, String(p.total)), h('span', p.total === 1 ? 'documento dell\'azienda' : 'documenti dell\'azienda')),
      p.total ? h('div', p.docs.slice(0, 6).map(d => h('div.pf-row', h('span', d.name), h('span.pf-sub', d.validity))), p.total > 6 ? h('div.pf-row.pf-sub', `e altri ${p.total - 6}`) : null) : h('p.pf-sub', 'Per chi fornisce solo materiali basta l\'anagrafica.'),
      tipo === 'materiali' ? null : h('div.pf-note', 'Poi, per ogni dipendente che entra nei cantieri, qualche domanda veloce: ti chiediamo solo gli attestati che servono.'),
      h('span.pf-sub', 'Puoi fermarti quando vuoi: quello che carichi resta salvato.'));
  };
  const drawOpts = () => {
    fill(opts, ctx.tipi.map(t => h('button.pf-opt', { type: 'button', class: t.key === tipo ? 'on' : '', 'aria-pressed': String(t.key === tipo), on: { click: () => { tipo = t.key; drawOpts(); drawSide(); } } }, h('b', t.label), h('span', t.hint))));
    fill(wl, [[true, 'Sì'], [false, 'No']].map(([k, l]) => h('button.pf-opt', { type: 'button', class: whitelist === k ? 'on' : '', 'aria-pressed': String(whitelist === k), style: { minWidth: '90px' }, on: { click: () => { whitelist = k; drawOpts(); } } }, h('b', l))));
  };
  drawOpts();
  const save = btn('Avanti', async () => {
    if (whitelist === null || whitelist === undefined) return toast('Dicci se l\'azienda è iscritta alla whitelist', true);
    save.disabled = true;
    try { await api('POST', '/questionario', { tipo, whitelist }); toast('Fatto: ecco cosa ti serve'); location.hash = '#/'; route(); } catch (e) { save.disabled = false; toast(e.message, true); }
  }, '.pri.big');
  fill(app,
    h('div', h('div.pf-eyebrow', 'Benvenuto · 2 minuti, poi carichi i documenti'), h('h1.pf-h1', 'Raccontaci ', h('b', 'che lavori fai'))),
    h('nav.pf-steps', { 'aria-label': 'Passi' }, h('div.pf-step.ok', h('i', '✓'), 'Registrazione'), h('div.pf-step.on', { 'aria-current': 'step' }, h('i', '2'), 'Tipo di appalto'), h('div.pf-step', h('i', '3'), 'I documenti')),
    isRef ? h('div.pf-two',
      h('section.pf-card.acc', h('h2.pf-h2', 'Per quale tipo di appalto ti qualifichi?'), opts,
        h('h2.pf-h2', { style: { marginTop: '10px' } }, 'L\'azienda è iscritta alla Whitelist della Prefettura?'), wl,
        h('span.pf-sub', 'È obbligatoria per inerti, calcestruzzo e bitume, noli a freddo e a caldo, ferro lavorato, autotrasporto, guardiania.'),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--cv-line)', paddingTop: '18px' } }, save)),
      side)
      : h('section.pf-card', h('b', 'Il questionario lo compila il referente dell\'azienda.'), h('span.pf-sub', 'Appena l\'ha fatto, qui trovi i documenti da caricare.')));
  if (isRef) await drawSide();
}

// ── Cosa ti manca (tavola 3) ─────────────────────────────────────────────────────────────────────
function todoPage() {
  const opt = optionalTypes();
  const req = requiredTypes();
  const all = [...new Map(ctx.checklists.flatMap(c => c.docs.map(d => ({ ...d, checklist: c.name, optional: opt.has(d.type_id) && !req.has(d.type_id) }))).map(d => [d.type_id, d])).values()];
  const todo = all.filter(d => !d.optional && needsAction(d)).sort((a, b) => ['respinto', 'integrazione', 'scaduto', 'in_scadenza', 'da_caricare'].indexOf(a.state) - ['respinto', 'integrazione', 'scaduto', 'in_scadenza', 'da_caricare'].indexOf(b.state));
  const waiting = all.filter(d => d.state === 'in_verifica' || d.renewal_pending);
  const extra = all.filter(d => d.optional);
  const d = ctx.docs;
  const pct = d.total ? Math.round((d.ok / d.total) * 100) : 100;
  const missing = d.total - d.ok - d.in_verifica;
  fill(app,
    h('section.pf-card.acc', { style: { gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'center' } },
      h('div', { style: { display: 'grid', gap: '8px' } },
        h('span.pf-eyebrow', `La tua qualifica · ${ctx.supplier.tipo_label}`),
        h('h1.pf-h1', missing > 0 ? ['Ti mancano ', h('b', `${missing} ${missing === 1 ? 'documento' : 'documenti'}`)] : d.in_verifica ? ['Documenti ', h('b', 'in verifica')] : ['Sei ', h('b', 'in regola')]),
        h('span.pf-sub', missing > 0 ? 'Quando li approviamo tutti puoi entrare nei cantieri Almacis.' : d.in_verifica ? 'Li stiamo controllando: di solito entro 2 giorni lavorativi.' : 'Ti avvisiamo noi prima che qualcosa scada.'),
        h('div.pf-bar', { 'aria-hidden': 'true' }, h('i', { style: { width: `${pct}%` } })),
        h('span.pf-sub', [`${d.ok} di ${d.total} approvati`, d.in_verifica && `${d.in_verifica} in verifica`, ctx.workers.missing && `${ctx.workers.missing} ${ctx.workers.missing === 1 ? 'dipendente' : 'dipendenti'} con documenti da caricare`].filter(Boolean).join(' · '))),
      h('span.pf-pill.am', { style: { fontSize: '14px', padding: '6px 14px' } }, { registrato: 'Registrato', in_qualifica: 'In qualifica', attivo: 'Qualificato', sospeso: 'Sospeso' }[ctx.supplier.status] || ctx.supplier.status)),
    todo.length ? h('section', { style: { display: 'grid', gap: '12px' } }, h('span.pf-lbl', 'Da fare adesso'),
      todo.map(x => h('div.pf-card.pf-todo',
        h('div', { style: { display: 'grid', gap: '6px' } },
          h('div.pf-todo-t', h('b', x.name), statePill(x), h('span.pf-pill', x.checklist)),
          (x.state === 'respinto' || x.state === 'integrazione') && x.reason ? h('span', { style: { fontSize: '14px', lineHeight: '20px' } }, h('b', { style: { fontWeight: 500 } }, x.state === 'integrazione' ? 'Cosa manca: ' : 'Perché: '), x.reason) : h('span.pf-sub', [x.instructions, x.validity !== 'Data sul documento' && x.validity !== 'Non scade' ? `Vale ${x.validity.toLowerCase()}.` : ''].filter(Boolean).join(' '))),
        ctx.me.can_upload ? btn(x.state === 'respinto' || x.state === 'integrazione' ? 'Ricarica' : x.state === 'in_scadenza' || x.state === 'scaduto' ? 'Carica il rinnovo' : 'Carica', () => upload(x), '.pri') : null))) : null,
    ctx.workers.missing ? h('a.pf-card', { href: '#/dipendenti', style: { padding: '18px 24px', display: 'flex', justifyContent: 'space-between', textDecoration: 'none', color: 'var(--cv-ink)' } },
      h('span', h('b', { style: { fontWeight: 500 } }, `${ctx.workers.missing} ${ctx.workers.missing === 1 ? 'dipendente ha' : 'dipendenti hanno'}`), ' documenti da caricare'), h('span', { style: { color: 'var(--cv-or-ink)', fontWeight: 500 } }, 'Vai ai dipendenti →')) : null,
    waiting.length ? h('section', { style: { display: 'grid', gap: '10px' } }, h('span.pf-lbl', 'In verifica da Almacis'),
      h('div.pf-card', { style: { padding: '4px 24px', gap: 0 } }, waiting.map(x => h('div.pf-row', h('span', x.name), h('span.pf-sub', x.renewal_pending ? 'rinnovo caricato: vale ancora il precedente' : 'caricato'))))) : null,
    extra.length ? h('section', { style: { display: 'grid', gap: '10px' } }, h('span.pf-lbl', 'Facoltativi: danno punti alla qualifica'),
      h('div.pf-card', { style: { padding: '4px 24px', gap: 0 } }, extra.map(x => h('div.pf-doc', h('span', x.name), statePill(x), ctx.me.can_upload && x.state !== 'in_verifica' ? h('button.pf-link', { type: 'button', on: { click: () => upload(x) } }, x.state === 'approvato' ? 'Aggiorna' : 'Carica') : h('span'))))) : null);
}

// ── caricare un documento (tavola 12) ────────────────────────────────────────────────────────────
function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
function upload(doc, target = {}) {
  const rule = doc.validity_rule;
  const needsIssued = ['firma', 'rilascio', 'attestato'].includes(rule);
  const file = h('input', { type: 'file', accept: 'application/pdf,image/*,.doc,.docx', required: true });
  const issued = h('input', { type: 'date', max: new Date().toISOString().slice(0, 10) });
  const until = h('input', { type: 'date' });
  const calc = h('input', { type: 'text', readOnly: true, value: '—', style: { background: 'var(--cv-bg)' } });
  issued.addEventListener('input', () => { calc.value = issued.value && doc.validity_months ? dmy(addMonths(issued.value, doc.validity_months)) : '—'; });
  const msg = h('p.pf-err', { role: 'alert' });
  const label = { firma: 'Data della firma', rilascio: 'Data di rilascio', attestato: 'Data dell\'attestato' }[rule];
  const close = () => box.remove();
  // appena scelto il file, l'AI lo legge (tavola 12): tipo, intestatario, date; il fornitore controlla e invia
  const readBox = h('div');
  const toBase64 = f => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(f); });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    fill(readBox);
    if (!f || f.size > 8 * 1024 * 1024) return;
    fill(readBox, h('div.pf-note', 'Stiamo leggendo il documento…'));
    try {
      const r = await api('POST', '/leggi', { doc_type_id: doc.type_id, worker_id: target.worker_id || null, vehicle_id: target.vehicle_id || null, file: { nome: f.name, mime: f.type || 'application/pdf', base64: await toBase64(f) } });
      if (r.status !== 'fatto') { fill(readBox); return; }
      if (r.data_documento && needsIssued && !issued.value) { issued.value = r.data_documento; issued.dispatchEvent(new Event('input')); }
      if (r.scadenza && rule === 'documento' && !until.value) until.value = r.scadenza;
      const ok = [r.tipo_ok === true && `È un «${doc.name}»`, r.intestatario && `Intestato a ${r.intestatario}`, r.data_documento && `Data del documento: ${dmy(r.data_documento)}`, r.scadenza && `Scadenza scritta: ${dmy(r.scadenza)}`].filter(Boolean);
      fill(readBox, h('div.pf-note', { style: { display: 'grid', gap: '6px', background: r.problemi.length ? 'var(--cv-or-t)' : 'var(--cv-gr-t)' } },
        h('b', { style: { fontWeight: 500, color: 'var(--cv-ink)' } }, r.problemi.length ? 'Abbiamo letto il documento: controlla' : 'Abbiamo letto il documento'),
        ok.map(t => h('span', `✓ ${t}`)),
        r.problemi.map(p => h('span', { style: { color: 'var(--cv-rd)' } }, `✕ ${p.text}${p.nota ? `: ${p.nota}` : ''}`)),
        r.problemi.length ? h('span.pf-sub', 'Se è il file sbagliato scegline un altro; se pensi sia giusto, invialo lo stesso: lo guarda una persona.') : h('span.pf-sub', 'Le date le abbiamo messe noi: controlla che siano giuste.')));
    } catch { fill(readBox); }
  });
  const send = btn('Invia ad Almacis', async () => {
    msg.textContent = '';
    const f = file.files[0];
    if (!f) { msg.textContent = 'Scegli il file'; return; }
    if (f.size > 8 * 1024 * 1024) { msg.textContent = 'Il file supera 8 MB'; return; }
    send.disabled = true;
    try {
      const base64 = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(f); });
      await api('POST', '/documenti', { doc_type_id: doc.type_id, worker_id: target.worker_id || null, vehicle_id: target.vehicle_id || null,
        issued_on: needsIssued ? issued.value || null : null, valid_to: rule === 'documento' ? until.value || null : null,
        file: { nome: f.name, mime: f.type || 'application/pdf', base64 } });
      close();
      toast('Inviato: lo controlliamo e ti facciamo sapere');
      route();
    } catch (e) { msg.textContent = e.message; send.disabled = false; }
  }, '.pri.big');
  const box = h('div.pf-backdrop', { on: { mousedown: e => { if (e.target === box) close(); } } },
    h('section.pf-dlg', { role: 'dialog', 'aria-modal': 'true', 'aria-label': doc.name },
      h('div.pf-dlg-h', h('div', { style: { display: 'grid', gap: '2px' } }, h('span.pf-eyebrow', [doc.checklist, target.who].filter(Boolean).join(' · ') || 'Documento'), h('b', { style: { fontSize: '20px', fontWeight: 500, color: 'var(--cv-ink)' } }, doc.name)),
        h('button.pf-x', { type: 'button', 'aria-label': 'Chiudi', on: { click: close } }, '×')),
      h('div.pf-dlg-b',
        doc.instructions ? h('div.pf-note', doc.instructions) : null,
        (doc.state === 'respinto' || doc.state === 'integrazione') && doc.reason ? h('div.pf-note', { style: { background: 'var(--cv-rd-t)' } }, h('b', { style: { fontWeight: 500 } }, 'L\'ultima volta: '), doc.reason) : null,
        field('File (PDF, foto o Word, al massimo 8 MB)', file),
        readBox,
        needsIssued ? h('div.pf-grid2', field(label, issued), field('Vale fino al', calc)) : null,
        rule === 'documento' ? field('Vale fino al (la data scritta sul documento)', until) : null,
        needsIssued ? h('span.pf-sub', `Vale ${doc.validity.toLowerCase()}: la scadenza la calcoliamo noi e ti avvisiamo 30 giorni prima.`) : rule === 'nessuna' ? h('span.pf-sub', 'Questo documento non scade: se cambia, ricaricalo.') : null,
        h('div.pf-note', h('b', { style: { fontWeight: 500 } }, 'Cosa succede adesso. '), 'Il documento passa ad Almacis per la verifica, di solito entro 2 giorni lavorativi. Se c\'è qualcosa da sistemare ti scriviamo il motivo.'),
        msg),
      h('div.pf-dlg-f', btn('Annulla', close), send)));
  $('overlay').append(box);
  file.focus();
}

// ── dipendenti (tavole 4 e 13) ───────────────────────────────────────────────────────────────────
const GROUPS = [
  ['Ruolo ed emergenze', [['preposto', 'Preposto di cantiere'], ['primo_soccorso', 'Addetto al primo soccorso'], ['antincendio', 'Addetto antincendio']]],
  ['Macchine che conduce', [['mmt', 'Macchine movimento terra'], ['gru_torre', 'Gru a torre'], ['gru_autocarro', 'Gru su autocarro'], ['gru_ruote', 'Gru su ruote'], ['carrelli', 'Carrelli elevatori'], ['pompe', 'Pompe per calcestruzzo'], ['perforazione', 'Macchine per perforazione'], ['ple', 'Piattaforme elevabili (PLE)']]],
  ['Lavori speciali', [['elettrici', 'Lavori elettrici (PES/PEI)'], ['confinati', 'Spazi confinati'], ['anticaduta', 'DPI anticaduta 3ª cat.'], ['ponteggi', 'Montaggio ponteggi'], ['saldatura_acciaio', 'Saldatura acciaio'], ['saldatura_pe', 'Saldatura polietilene'], ['segnaletica', 'Segnaletica stradale'], ['amianto', 'Rimozione amianto']]],
  ['Salute', [['chimico', 'Esposto a rischio chimico'], ['vaccini', 'Servono vaccinazioni']]],
];
const RAPPORTO = [['dipendente', 'Dipendente'], ['distaccato', 'Distaccato'], ['datore_lavoratore', 'Datore di lavoro']];

async function workersPage(selected) {
  const list = await api('GET', '/dipendenti');
  const cur = list.find(w => w.id === selected) || list[0];
  const missing = list.filter(w => w.missing).length;
  const head = h('div.pf-head',
    h('div', h('div.pf-eyebrow', 'Dipendenti'), h('h1.pf-h1', h('b', `${list.length} ${list.length === 1 ? 'persona' : 'persone'}`), missing ? `, ${missing} con documenti da caricare` : '')),
    ctx.me.can_upload ? h('a.pf-btn.pri', { href: '#/dipendenti/nuovo' }, 'Aggiungi dipendente') : null);
  if (!list.length) {
    fill(app, head, h('section.pf-card', h('b', 'Nessun dipendente ancora'), h('span.pf-sub', 'Aggiungi chi entrerà nei cantieri Almacis: per ognuno qualche domanda su cosa fa, e ti chiediamo solo gli attestati che servono.')));
    return;
  }
  const yes = Object.fromEntries(GROUPS.flatMap(([, items]) => items));
  fill(app, head, h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,340px) minmax(0,1fr)', gap: '24px', alignItems: 'start' }, class: 'pf-workers' },
    h('section.pf-card.pf-people', { 'aria-label': 'Elenco' }, list.map(w => h('button.pf-person', { type: 'button', class: w.id === cur.id ? 'on' : '', on: { click: () => { location.hash = `#/dipendenti/${w.id}`; } } },
      h('span.pf-av', ini(`${w.first_name} ${w.last_name}`)),
      h('span', { style: { display: 'grid', gap: '2px', minWidth: 0 } }, h('b', { style: { fontWeight: 500, color: 'var(--cv-ink)' } }, `${w.first_name} ${w.last_name}`),
        h('span.pf-sub', Object.entries(w.answers || {}).filter(([k, x]) => x === true && yes[k]).map(([k]) => yes[k]).slice(0, 3).join(' · ') || RAPPORTO.find(r => r[0] === (w.answers?.rapporto || 'dipendente'))[1])),
      h(`span.pf-pill.${w.missing ? 'am' : 'gr'}`, w.missing ? 'Da completare' : 'In regola')))),
    h('section.pf-card.acc',
      h('div.pf-head', h('div', { style: { display: 'grid', gap: '4px' } }, h('b', { style: { fontSize: '26px', fontWeight: 500, color: 'var(--cv-ink)' } }, `${cur.first_name} ${cur.last_name}`),
        h('span.pf-sub', [RAPPORTO.find(r => r[0] === (cur.answers?.rapporto || 'dipendente'))[1], cur.hired_on && `dal ${dmy(cur.hired_on)}`, cur.tax_code].filter(Boolean).join(' · '))),
        ctx.me.can_upload ? h('div', { style: { display: 'flex', gap: '8px' } }, btn('Rivedi le risposte', () => workerForm(cur)),
          btn('Non lavora più con voi', async () => { if (!confirm(`${cur.first_name} ${cur.last_name} non lavora più con voi?`)) return; await api('DELETE', `/dipendenti/${cur.id}`); location.hash = '#/dipendenti'; route(); })) : null),
      h('div', cur.docs.map(x => h('div.pf-doc',
        h('span', x.name, h('span.pf-sub', [x.checklist, x.until ? `fino al ${dmy(x.until)}` : x.validity, x.state === 'respinto' && x.reason ? `perché: ${x.reason}` : ''].filter(Boolean).join(' · '))),
        statePill(x),
        ctx.me.can_upload && needsAction(x) ? btn('Carica', () => upload({ ...x }, { worker_id: cur.id, who: `${cur.first_name} ${cur.last_name}` }), '.pri') : h('span')))))));
}

function workerForm(w) {
  const answers = { rapporto: 'dipendente', ...(w?.answers || {}) };
  const first = h('input', { value: w?.first_name || '', autocomplete: 'off' });
  const last = h('input', { value: w?.last_name || '', autocomplete: 'off' });
  const cf = h('input', { value: w?.tax_code || '', maxlength: 16, style: { textTransform: 'uppercase' } });
  const hired = h('input', { type: 'date', value: w?.hired_on ? String(w.hired_on).slice(0, 10) : '' });
  const seg = h('span.pf-seg', { role: 'group', 'aria-label': 'Rapporto di lavoro' });
  const groups = h('div', { style: { display: 'grid', gap: '20px' } });
  const draw = () => {
    fill(seg, RAPPORTO.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(answers.rapporto === k), on: { click: () => { answers.rapporto = k; draw(); } } }, l)));
    fill(groups, GROUPS.map(([name, items]) => {
      const n = items.filter(([k]) => answers[k] === true).length;
      return h('div.pf-grp', h('div.pf-grp-h', h('span', name), h('span.pf-sub', n ? `${n} sì` : '')),
        h('div.pf-tiles', { role: 'group', 'aria-label': name }, items.map(([k, l]) => h('button.pf-tile', { type: 'button', class: answers[k] === true ? 'on' : '', 'aria-pressed': String(answers[k] === true),
          on: { click: () => { answers[k] = answers[k] !== true; draw(); } } }, h('span.pf-box', { 'aria-hidden': 'true' }, answers[k] === true ? '✓' : ''), l))));
    }));
  };
  draw();
  const save = btn(w ? 'Salva' : 'Salva e carica i documenti', async () => {
    save.disabled = true;
    const body = { first_name: first.value, last_name: last.value, tax_code: cf.value, hired_on: hired.value || null, answers };
    try {
      const r = w ? await api('PUT', `/dipendenti/${w.id}`, body) : await api('POST', '/dipendenti', body);
      toast('Salvato');
      location.hash = `#/dipendenti/${w ? w.id : r.id}`;
    } catch (e) { save.disabled = false; toast(e.message, true); }
  }, '.pri.big');
  fill(app,
    h('div', h('a', { href: '#/dipendenti', style: { fontSize: '13.5px', fontWeight: 500, textDecoration: 'none' } }, '‹ Dipendenti'), h('h1.pf-h1', w ? ['Rivedi ', h('b', `${w.first_name} ${w.last_name}`)] : ['Nuovo ', h('b', 'dipendente')])),
    h('div.pf-two',
      h('div', { style: { display: 'grid', gap: '24px' } },
        h('section.pf-card', h('h2.pf-h2', 'Chi è'), h('div.pf-grid2', field('Nome', first), field('Cognome', last), field('Codice fiscale', cf), field('Assunto il', hired))),
        h('section.pf-card.acc', h('div', { style: { display: 'grid', gap: '4px' } }, h('h2.pf-h2', 'Cosa fa in cantiere'), h('span.pf-sub', 'Tocca quello che fa: un tocco è «sì», tutto il resto resta «no».')),
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px', flexWrap: 'wrap', padding: '14px 16px', borderRadius: '14px', background: 'var(--cv-bg)' } }, h('span', 'Con la vostra azienda è'), seg),
          groups)),
      h('aside.pf-card', { style: { position: 'sticky', top: '20px' } },
        h('span.pf-lbl', 'Poi'),
        h('p', { style: { margin: 0, lineHeight: '22px' } }, 'Ti chiediamo i documenti che servono per quello che fa: documento d\'identità, formazione, idoneità sanitaria e gli attestati delle attività che hai segnato.'),
        h('div.pf-note', 'Hai già gli attestati? Dopo il salvataggio li carichi dalla scheda del dipendente.'),
        save)));
  first.focus();
}

// ── mezzi e cantieri (tavola 14) ─────────────────────────────────────────────────────────────────
async function vehiclesPage() {
  const [vehicles, sites] = await Promise.all([api('GET', '/mezzi'), api('GET', '/cantieri')]);
  const kind = h('input', { placeholder: 'Es. Autocarro con gru' });
  const plate = h('input', { placeholder: 'Targa o matricola' });
  const add = btn('Aggiungi', async () => {
    try { await api('POST', '/mezzi', { kind: kind.value, plate: plate.value }); toast('Mezzo aggiunto'); route(); } catch (e) { toast(e.message, true); }
  }, '.pri');
  const todo = vehicles.filter(m => m.docs.some(needsAction)).length;
  fill(app, h('div.pf-half',
    h('section', { style: { display: 'grid', gap: '18px' } },
      h('div', h('div.pf-eyebrow', 'Mezzi e attrezzature'), h('h1.pf-h1', h('b', `${vehicles.length} ${vehicles.length === 1 ? 'mezzo' : 'mezzi'}`), todo ? `, ${todo} da completare` : '')),
      vehicles.map(m => h('div.pf-card', { class: m.docs.some(needsAction) ? 'acc' : '' },
        h('div.pf-head', h('b', { style: { fontSize: '17px', fontWeight: 500, color: 'var(--cv-ink)' } }, m.kind, m.plate ? h('span', { style: { fontWeight: 400, color: 'var(--cv-muted)' } }, ` · ${m.plate}`) : null),
          ctx.me.can_upload ? h('button.pf-link', { type: 'button', on: { click: async () => { if (!confirm(`Togliere ${m.kind}?`)) return; await api('DELETE', `/mezzi/${m.id}`); route(); } } }, 'Togli') : null),
        h('div', m.docs.map(x => h('div.pf-doc', h('span', x.name, h('span.pf-sub', x.until ? `fino al ${dmy(x.until)}` : x.validity)), statePill(x),
          ctx.me.can_upload && needsAction(x) ? btn('Carica', () => upload(x, { vehicle_id: m.id, who: m.kind }), '.pri') : h('span')))))),
      ctx.me.can_upload ? h('div.pf-card', h('h2.pf-h2', 'Aggiungi un mezzo'), h('div.pf-grid2', field('Mezzo', kind), field('Targa o matricola', plate)), h('div', add)) : null),
    h('section', { style: { display: 'grid', gap: '18px' } },
      h('div', h('div.pf-eyebrow', 'Cantieri Almacis'), h('h1.pf-h1', sites.length ? ['Lavori in ', h('b', `${sites.length} ${sites.length === 1 ? 'cantiere' : 'cantieri'}`)] : ['Nessun ', h('b', 'cantiere'), ' ancora'])),
      sites.length ? sites.map(s => h('div.pf-card', h('b', { style: { fontSize: '17px', fontWeight: 500, color: 'var(--cv-ink)' } }, `${s.code} · ${s.name}`),
        h('span.pf-sub', [s.date_from && `dal ${dmy(s.date_from)}`, s.date_to && `al ${dmy(s.date_to)}`].filter(Boolean).join(' ') || 'date da definire')))
        : h('div.pf-card', h('span.pf-sub', 'Quando Almacis ti associa a un cantiere lo trovi qui, con i documenti in più che servono per quel committente.')))));
}

// ── azienda e colleghi (tavola 15) ───────────────────────────────────────────────────────────────
async function companyPage() {
  const a = await api('GET', '/azienda');
  const isRef = ctx.me.role === 'referente';
  const inputs = {};
  const kv = (label, key, value, hint) => {
    if (!isRef || !key) return h('div.pf-doc', h('span.pf-sub', label), h('span', { style: { color: 'var(--cv-ink)' } }, value || '—'), hint ? h('span.pf-sub', hint) : h('span'));
    inputs[key] = h('input', { value: value || '' });
    return field(label, inputs[key]);
  };
  const saveData = isRef ? btn('Salva i dati', async () => {
    try { await api('PATCH', '/azienda', Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]))); toast('Dati salvati'); } catch (e) { toast(e.message, true); }
  }, '.pri') : null;
  const email = h('input', { type: 'email', placeholder: 'nome@azienda.it' });
  const name = h('input', { placeholder: 'Nome e cognome' });
  const role = h('select', h('option', { value: 'si' }, 'Caricare documenti'), h('option', { value: 'no' }, 'Solo vedere'));
  const invite = btn('Invita', async () => {
    try { await api('POST', '/colleghi', { email: email.value, name: name.value, can_upload: role.value === 'si' }); toast('Invito mandato'); route(); } catch (e) { toast(e.message, true); }
  }, '.pri');
  fill(app,
    h('div', h('div.pf-eyebrow', 'Azienda'), h('h1.pf-h1', h('b', a.name))),
    h('div.pf-half',
      h('section.pf-card',
        h('div.pf-head', h('h2.pf-h2', 'Dati dell\'azienda'), h('span.pf-pill', `${a.tipo_label} · Whitelist: ${a.whitelist === true ? 'sì' : a.whitelist === false ? 'no' : '—'}`)),
        kv('Partita IVA', null, a.vat, 'non si cambia'),
        h('div.pf-grid2', kv('Sede', 'address', a.address), kv('PEC', 'pec', a.pec), kv('Telefono', 'phone', a.phone), kv('CCNL applicato', 'ccnl', a.ccnl)),
        kv('Medico competente', 'medico', a.medico),
        h('span.pf-sub', 'Medico competente e CCNL servono per controllare idoneità sanitarie e UNILAV dei dipendenti.'),
        isRef ? h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
          h('button.pf-link', { type: 'button', on: { click: () => { ctx.supplier.questionario_at = null; questionnaire(); } } }, 'Rifai il questionario'), saveData) : null),
      h('section.pf-card.acc',
        h('div.pf-head', h('h2.pf-h2', 'Chi entra nel portale'), h('span.pf-sub', `${a.people.length} ${a.people.length === 1 ? 'persona' : 'persone'}`)),
        h('div', a.people.map(p => h('div', { style: { display: 'grid', gridTemplateColumns: '40px minmax(0,1fr) auto auto', gap: '12px', alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--cv-line)' } },
          h('span.pf-av', ini(p.name || p.email)),
          h('span', { style: { display: 'grid', gap: '2px', minWidth: 0 } }, h('b', { style: { fontWeight: 500, color: 'var(--cv-ink)' } }, p.name || p.email), h('span.pf-sub', [p.email, p.last_login ? `ultimo accesso ${dmy(p.last_login)}` : 'invito mandato'].join(' · '))),
          h(`span.pf-pill${p.role === 'referente' ? '.dark' : p.last_login ? '' : '.am'}`, p.role === 'referente' ? 'Referente' : p.can_upload ? (p.last_login ? 'Collega' : 'Invitato') : 'Solo vedere'),
          isRef && p.role !== 'referente' ? h('button.pf-link', { type: 'button', on: { click: async () => { await api('DELETE', `/colleghi/${p.id}`); route(); } } }, 'Togli') : h('span')))),
        isRef ? h('div', { style: { display: 'grid', gap: '12px', padding: '18px', borderRadius: '14px', background: 'var(--cv-bg)' } },
          h('b', { style: { fontWeight: 500, color: 'var(--cv-ink)' } }, 'Invita un collega o il tuo consulente'),
          h('div.pf-grid2', field('Email', email), field('Nome', name)), h('div', { style: { display: 'flex', gap: '10px', alignItems: 'end', flexWrap: 'wrap' } }, field('Cosa può fare', role), invite),
          h('span.pf-sub', 'Riceve un link per entrare. I reminder delle scadenze vanno a tutti quelli che possono caricare.')) : null)));
}

route();
