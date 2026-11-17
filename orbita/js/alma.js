// Alma, l'assistente di Alma Planet (canvas V5-Alma, V5-Ovunque, V5-Impostazioni del 17/11/2026).
// - Pagina #/alma: conversazioni a sinistra, chat a destra (risposta in diretta, passi, numeri con ricevuta, cifre,
//   domande suggerite, piede copia/riprova/utile/non utile, proposta arancione Conferma/Cambia/Annulla).
// - Pannello laterale da ogni pagina (tasto Alma in basso a destra): sa da quale pagina chiedi («Stai guardando: …»).
//   Sul telefono è a schermo intero, sopra la barra in basso; tema scuro come il resto dell'app.
// - #/alma/impostazioni (amministratori): accesa/spenta, quote, proposte, Risposte (tracce con utile/non utile), Regole.
// Voce, file e grafici arrivano nella fase 2: qui non ci sono.
import { h, fill, clear, toast, loading, confirmDialog, promptDialog, isMobile, fmtDateTime } from './ui.js';
import { get, post, put, patch, del } from './api.js';
import { icon } from './icons.js';
import { pill, toggle, seg, emptyState } from './crm-v2.js';

const ic = (name, size = 16) => icon(name, { size });
const ava = (size = 36) => h('span.al-ava', { style: { width: `${size}px`, height: `${size}px` }, 'aria-hidden': 'true' }, ic('sparkles', Math.round(size / 2)));
let status = null; // GET /api/alma/status, riletto a ogni apertura
const loadStatus = async () => (status = await get('/api/alma/status', { quiet: true }).catch(() => null));

// ── testo della risposta: Markdown semplice in nodi (niente HTML iniettato) ─────────────────────────
// I numeri in grassetto con le cifre prendono, in ordine, il controllo del server (ricevute.numeri): verde con la
// ricevuta al clic, rosso se il numero non è nei risultati. Le graffe {f2} non si mostrano.
function numberRenderer(ricevute) {
  const queue = [...((ricevute && ricevute.numeri) || [])];
  const fonti = new Map(((ricevute && ricevute.fonti) || []).map(f => [f.id, f]));
  return (inner) => {
    const text = inner.replace(/\{f\d+\}/g, '');
    if (!/\d/.test(text) || !queue.length) return h('b', text);
    const n = queue.shift();
    if (!n.ok) return h('b.al-n.bad', { title: 'Numero senza ricevuta: non l\'ho trovato nei dati' }, text);
    const f = n.fonte ? fonti.get(n.fonte) : null;
    if (!f) return h('b.al-n', text);
    return h('button.al-n', { type: 'button', title: 'Apri la ricevuta', on: { click: e => { e.stopPropagation(); openReceipt(e.currentTarget, text, f); } } }, text);
  };
}
function inline(str, num) {
  const out = [];
  const re = /\*\*([^*\n]+)\*\*(\{f\d+\})?|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0, m;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push(str.slice(last, m.index).replace(/\{f\d+\}/g, ''));
    if (m[1] !== undefined) out.push(num(m[1]));
    else {
      const href = m[4].replace(/^\/app(?=#\/)/, '');
      out.push(/^#\//.test(href) ? h('a', { href, on: { click: () => closePanelOnPhone() } }, m[3]) : m[3]);
    }
    last = re.lastIndex;
  }
  if (last < str.length) out.push(str.slice(last).replace(/\{f\d+\}/g, ''));
  return out;
}
function markdown(text, num) {
  const root = h('div.al-md');
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let list = null, para = [];
  const flushPara = () => { if (para.length) { root.append(h('p', inline(para.join(' '), num))); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line)) { // tabella
      flushPara(); list = null;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
      i--;
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const body = rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      const [head, ...rest] = body;
      root.append(h('div.al-tbl-wrap', h('table.al-tbl', head ? h('thead', h('tr', cells(head).map(c => h('th', inline(c, num))))) : null,
        h('tbody', rest.map(r => h('tr', cells(r).map(c => h('td', inline(c, num)))))))));
      continue;
    }
    const li = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (li) { flushPara(); if (!list) { list = h('ul'); root.append(list); } list.append(h('li', inline(li[1], num))); continue; }
    if (!line.trim()) { flushPara(); list = null; continue; }
    const hd = line.match(/^#{1,4}\s+(.*)$/);
    if (hd) { flushPara(); list = null; root.append(h('p.al-hd', inline(hd[1], num))); continue; }
    list = null;
    para.push(line.trim());
  }
  flushPara();
  return root;
}

// Ricevuta del numero: da dove viene, periodo, filtri, righe, link alla pagina con gli stessi filtri.
let receiptEl = null;
function closeReceipt() { receiptEl?.remove(); receiptEl = null; document.removeEventListener('mousedown', outside, true); }
function outside(e) { if (receiptEl && !receiptEl.contains(e.target)) closeReceipt(); }
function openReceipt(anchor, value, f) {
  closeReceipt();
  const row = (k, v) => (v ? h('div.al-rc-row', h('span.al-muted', k), h('span', v)) : null);
  receiptEl = h('div.al-receipt', { role: 'dialog', 'aria-label': `Ricevuta di ${value}` },
    h('div.al-rc-head', h('span.al-ib.gr', ic('receipt', 15)), h('div.al-grow', h('div.al-t5', `Ricevuta · ${value}`), h('div.al-small.al-muted', f.titolo)),
      h('button.btn.btn-ghost.btn-sm.al-icobtn', { type: 'button', 'aria-label': 'Chiudi', on: { click: closeReceipt } }, ic('x', 14))),
    row('Da', f.titolo), row('Periodo', f.periodo), row('Filtri', (f.filtri || []).join(' · ')), row('Righe', f.righe), row('Dati', f.aggiornato),
    f.link ? h('a.al-lnk', { href: f.link, on: { click: () => { closeReceipt(); closePanelOnPhone(); } } }, ic('link', 12), 'Apri la pagina con questi filtri') : null);
  document.body.append(receiptEl);
  const r = anchor.getBoundingClientRect();
  const w = Math.min(380, window.innerWidth - 24);
  receiptEl.style.width = `${w}px`;
  receiptEl.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - w - 12))}px`;
  const below = r.bottom + 8;
  receiptEl.style.top = `${below + 260 > window.innerHeight ? Math.max(12, r.top - 8 - receiptEl.offsetHeight) : below}px`;
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
}

function shrink(file, max = 1600) {
  return new Promise((resolve, reject) => {
    // FileReader → data: (la CSP della pagina non permette le immagini blob:)
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('foto'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('foto'));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

let playing = null; // { audio, btn }
async function listenTo(text, btn) {
  if (playing) { playing.audio.pause(); playing.btn.classList.remove('on'); const same = playing.btn === btn; playing = null; if (same) return; }
  btn.classList.add('on');
  try {
    const res = await fetch('/api/alma/voce/ascolta', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Alma': '1' }, body: JSON.stringify({ text }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Errore ${res.status}`); }
    const url = URL.createObjectURL(await res.blob()); // media-src 'self' blob: nella CSP
    const audio = new Audio(url);
    playing = { audio, btn };
    audio.onended = () => { btn.classList.remove('on'); URL.revokeObjectURL(url); if (playing && playing.audio === audio) playing = null; };
    await audio.play();
  } catch (e) { btn.classList.remove('on'); playing = null; toast(e.message || 'La voce non è disponibile adesso.'); }
}

// ── grafici (canvas V5-Alma): barre, linee, tabella, torta; «Aggiungi alla dashboard»; Excel ──
const SERIE_COLORS = ['var(--cv-orange)', 'var(--cv-ink)', 'var(--cv-or-mid)', 'var(--cv-muted)'];
const TIPO_LABEL = { barre: 'Barre', linee: 'Linee', tabella: 'Tabella', torta: 'Torta' };
const SVGNS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k != null) el.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return el;
}
function fmtVal(v, unita, short = false) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  let s;
  if (short && Math.abs(n) >= 1e6) s = (n / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' M';
  else if (short && Math.abs(n) >= 1e4) s = (n / 1e3).toLocaleString('it-IT', { maximumFractionDigits: 0 }) + ' k';
  else s = n.toLocaleString('it-IT', { maximumFractionDigits: Number.isInteger(n) ? 0 : 1 });
  return unita === '€' ? '€ ' + s : unita === '%' ? s + '%' : unita === 'ore' ? s + ' h' : s;
}
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(x => x >= v) || v;
}
function drawChart(c) {
  const narrow = window.innerWidth < 600; // sul telefono un riquadro più stretto: le scritte dell'asse restano leggibili
  const W = narrow ? 360 : 640, H = narrow ? 230 : 240, L = narrow ? 44 : 56, R = 10, T = 12, B = 34;
  const n = c.etichette.length, pw = W - L - R, ph = H - T - B;
  const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'al-chart-svg', role: 'img', 'aria-label': c.titolo });
  if (c.tipo === 'torta') {
    const vals = c.serie[0].valori.map(v => Math.max(0, Number(v) || 0));
    const tot = vals.reduce((a, b) => a + b, 0) || 1;
    let a0 = -Math.PI / 2;
    const cx = W / 2, cy = H / 2, r = 96;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / tot) * Math.PI * 2;
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const d = v >= tot ? 'M ' + cx + ' ' + (cy - r) + ' A ' + r + ' ' + r + ' 0 1 1 ' + (cx - 0.01) + ' ' + (cy - r) + ' Z'
        : 'M ' + cx + ' ' + cy + ' L ' + (cx + r * Math.cos(a0)) + ' ' + (cy + r * Math.sin(a0)) + ' A ' + r + ' ' + r + ' 0 ' + big + ' 1 ' + (cx + r * Math.cos(a1)) + ' ' + (cy + r * Math.sin(a1)) + ' Z';
      svg.append(sv('path', { d, style: 'fill:' + ['var(--cv-orange)', 'var(--cv-ink)', 'var(--cv-or-mid)', 'var(--cv-muted)', 'var(--cv-line-strong)', 'var(--cv-or-t)'][i % 6], stroke: 'var(--cv-card)', 'stroke-width': 2 },
        sv('title', {}, c.etichette[i] + ': ' + fmtVal(v, c.unita) + ' (' + Math.round(v / tot * 100) + '%)')));
      a0 = a1;
    });
    return svg;
  }
  const all = c.serie.flatMap(s => s.valori).filter(v => v !== null && v !== undefined).map(Number);
  const top = niceMax(Math.max(0, ...all)), bot = Math.min(0, ...all);
  const y = v => T + ph - ((Number(v) - bot) / (top - bot || 1)) * ph;
  // righe della griglia: con numeri interi tacche intere (5 → 0,1,2,3,4,5 invece di 1,3 e 3,8)
  const ints = all.every(v => Number.isInteger(v));
  const span = top - bot;
  const ticks = ints && span <= 10 ? Math.max(1, span) : [4, 5, 3].find(k => Number.isInteger(span / k) || !ints) || 4;
  for (let i = 0; i <= ticks; i++) {
    const v = bot + (span * i) / ticks;
    svg.append(sv('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'al-grid' }), sv('text', { x: L - 6, y: y(v) + 4, class: 'al-ax', 'text-anchor': 'end' }, fmtVal(v, c.unita, true)));
  }
  const step = pw / Math.max(1, n);
  const every = Math.max(1, Math.ceil(n / (narrow ? 6 : 12)));
  c.etichette.forEach((l, i) => { if (i % every === 0) svg.append(sv('text', { x: L + step * i + step / 2, y: H - 12, class: 'al-ax', 'text-anchor': 'middle' }, l.length > 11 ? l.slice(0, 10) + '…' : l)); });
  if (c.tipo === 'linee') {
    c.serie.forEach((s, k) => {
      const pts = s.valori.map((v, i) => (v === null || v === undefined ? null : [L + step * i + step / 2, y(v)])).filter(Boolean);
      svg.append(sv('polyline', { points: pts.map(p => p.join(',')).join(' '), fill: 'none', style: 'stroke:' + SERIE_COLORS[k], 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
      s.valori.forEach((v, i) => { if (v !== null && v !== undefined) svg.append(sv('circle', { cx: L + step * i + step / 2, cy: y(v), r: 3.5, style: 'fill:' + SERIE_COLORS[k] }, sv('title', {}, c.etichette[i] + ' · ' + s.nome + ': ' + fmtVal(v, c.unita)))); });
    });
  } else {
    const bw = Math.min(28, (step * 0.78) / c.serie.length);
    c.serie.forEach((s, k) => s.valori.forEach((v, i) => {
      if (v === null || v === undefined) return;
      const x = L + step * i + (step - bw * c.serie.length) / 2 + bw * k;
      const y0 = y(Math.max(0, bot)), y1 = y(v);
      svg.append(sv('rect', { x, y: Math.min(y0, y1), width: Math.max(1, bw - 2), height: Math.max(1, Math.abs(y0 - y1)), rx: 3, style: 'fill:' + SERIE_COLORS[k] }, sv('title', {}, c.etichette[i] + ' · ' + s.nome + ': ' + fmtVal(v, c.unita))));
    }));
  }
  return svg;
}
function chartTable(c) {
  return h('div.al-ctable-wrap', h('table.al-ctable', h('thead', h('tr', h('th', ''), c.serie.map(s => h('th', s.nome)))),
    h('tbody', c.etichette.map((l, i) => h('tr', h('td', l), c.serie.map(s => h('td', fmtVal(s.valori[i], c.unita))))))));
}
function chartCsv(c) {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const num = v => (v === null || v === undefined ? '' : String(v).replace('.', ','));
  const rows = [[q(''), ...c.serie.map(s => q(s.nome))].join(';'), ...c.etichette.map((l, i) => [q(l), ...c.serie.map(s => num(s.valori[i]))].join(';'))];
  const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: (c.titolo || 'grafico').replace(/[^\w\- àèéìòù]+/gi, '').trim().slice(0, 60) + '.csv' });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
// opts: { messageId } per «Aggiungi alla dashboard»; { onType, actions } per la dashboard.
function chartEl(c, opts = {}) {
  let cur = { ...c };
  const box = h('section.al-chart');
  const tipi = ['barre', 'linee', 'tabella', ...(c.serie.length === 1 && c.etichette.length <= 6 ? ['torta'] : [])];
  const draw = () => {
    const seg = h('div.al-seg', tipi.map(t => h('button', { type: 'button', class: t === cur.tipo ? 'on' : '', on: { click: () => { cur = { ...cur, tipo: t }; draw(); opts.onType?.(t); } } }, TIPO_LABEL[t])));
    const legend = cur.tipo !== 'tabella' && (cur.serie.length > 1 || cur.tipo === 'torta')
      ? h('div.al-legend', (cur.tipo === 'torta' ? cur.etichette : cur.serie.map(s => s.nome)).map((nm, i) => h('span', h('i', { style: { background: (cur.tipo === 'torta' ? ['var(--cv-orange)', 'var(--cv-ink)', 'var(--cv-or-mid)', 'var(--cv-muted)', 'var(--cv-line-strong)', 'var(--cv-or-t)'] : SERIE_COLORS)[i % 6] } }), nm))) : null;
    const add = opts.messageId && c.id ? h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: async () => {
      const r = await post('/api/alma/dashboard', { message_id: opts.messageId, chart_id: c.id }).catch(() => null);
      if (r) toast('Aggiunto alla tua dashboard di Alma');
    } } }, ic('plus', 14), 'Aggiungi alla dashboard') : null;
    const xls = h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => chartCsv(cur) } }, ic('download', 14), 'Excel');
    fill(box, h('div.al-row.al-chead', h('span.al-t5.al-grow', cur.titolo), seg),
      cur.tipo === 'tabella' ? chartTable(cur) : drawChart(cur), legend,
      cur.troncato ? h('div.al-small.al-muted', 'Mostrate le prime 40 voci su ' + cur.troncato + '.') : null,
      h('div.al-row.al-wrap', { style: { gap: '8px' } }, add, xls, ...(opts.actions || [])));
  };
  draw();
  return box;
}

// ── la chat (pagina e pannello usano la stessa) ────────────────────────────────────────────────────
// opts: { compact, context(): { route, label } | null, onConversation(id, title), suggestions() }
function createChat(opts = {}) {
  let convId = null;
  let busy = null; // AbortController della risposta in corso
  let lastQuestion = '';
  const msgs = h('div.al-msgs', { 'aria-live': 'polite' });
  const scroller = h('div.al-scroll', msgs);
  const input = h('textarea.al-input', { rows: 1, placeholder: opts.placeholder || 'Chiedi ad Alma… (progetti, ticket, ore delle RDA, CRM, gare, mezzi)', 'aria-label': 'Domanda per Alma' });
  const sendBtn = h('button.al-send', { type: 'button', 'aria-label': 'Invia' }, ic('send', 16));
  const hint = h('span.al-small.al-muted.al-grow.al-hintkeys', opts.compact ? '' : 'Invio per mandare, Maiusc+Invio per andare a capo');
  // Foto (biglietti da visita): rimpicciolite qui (lato lungo 1600 px, JPEG), al massimo 5; non si salvano.
  let photos = [];
  const MAX_PHOTOS = 5;
  const placeholder = input.placeholder;
  const photoRow = h('div.al-photos');
  const pickFile = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const takePhoto = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const clipBtn = h('button.al-tool', { type: 'button', title: 'Allega foto (biglietti da visita)', 'aria-label': 'Allega foto' }, ic('paperclip', 16));
  const micBtn = h('button.al-tool.al-mic', { type: 'button', title: 'Detta la domanda', 'aria-label': 'Detta la domanda', hidden: true }, ic('mic', 16));
  const micTime = h('span.al-small.al-mictime', { hidden: true });
  let rec = null;
  const stopRec = () => { if (rec && rec.state === 'recording') rec.stop(); };
  micBtn.addEventListener('click', async () => {
    if (rec && rec.state === 'recording') return stopRec();
    if (busy) return;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { toast('Per dettare serve il permesso del microfono.'); return; }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    const chunks = [];
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const t0 = Date.now();
    const tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); micTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · tocca per mandare`; if (s >= 120) stopRec(); }, 250);
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      clearInterval(tick); stream.getTracks().forEach(t => t.stop());
      micBtn.classList.remove('rec'); micTime.hidden = false; micTime.textContent = 'Trascrivo…';
      const blob = new Blob(chunks, { type: (rec.mimeType || type || 'audio/webm').split(';')[0] });
      const secondi = Math.max(1, Math.round((Date.now() - t0) / 1000));
      try {
        const res = await fetch(`/api/alma/voce/trascrivi?secondi=${secondi}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': blob.type, 'X-Alma': '1' }, body: blob });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
        const said = String(data.text || '').trim();
        if (!said) toast('Non ho sentito niente: riprova.');
        else { input.value = [input.value.trim(), said].filter(Boolean).join(' '); grow(); send(); }
      } catch (e) { toast(e.message || 'La trascrizione non è riuscita.'); }
      finally { micTime.hidden = true; rec = null; }
    };
    rec.start();
    micBtn.classList.add('rec'); micTime.hidden = false; micTime.textContent = '0:00 · tocca per mandare';
  });
  loadStatus().then(st => { micBtn.hidden = !(st && st.voce && navigator.mediaDevices && window.MediaRecorder); }).catch(() => {});
  const camBtn = h('button.btn.btn-sm.btn-primary.al-camera', { type: 'button', 'aria-label': 'Fotografa un biglietto' }, ic('camera', 15), 'Fotografa');
  clipBtn.addEventListener('click', () => pickFile.click());
  camBtn.addEventListener('click', () => takePhoto.click());
  const drawPhotos = () => {
    fill(photoRow, photos.map((src, i) => h('span.al-photo', h('img', { src, alt: `Foto ${i + 1}` }),
      h('button', { type: 'button', 'aria-label': 'Togli la foto', on: { click: () => { photos.splice(i, 1); drawPhotos(); } } }, ic('x', 12)))));
    photoRow.hidden = !photos.length;
    input.placeholder = photos.length ? 'Dove li hai conosciuti? (facoltativo)' : placeholder;
  };
  const addFiles = async files => {
    for (const f of [...files]) {
      if (photos.length >= MAX_PHOTOS) { toast(`Al massimo ${MAX_PHOTOS} foto per domanda.`); break; }
      if (!/^image\//.test(f.type)) { toast('Si possono allegare solo foto.'); continue; }
      try { photos.push(await shrink(f)); } catch { toast('Questa foto non si riesce ad aprire: prova a fotografarla di nuovo.'); }
    }
    drawPhotos();
    input.focus({ preventScroll: true });
  };
  pickFile.addEventListener('change', () => { addFiles(pickFile.files); pickFile.value = ''; });
  takePhoto.addEventListener('change', () => { addFiles(takePhoto.files); takePhoto.value = ''; });
  drawPhotos();
  const composer = h('div.al-composer', photoRow, input, h('div.al-row', camBtn, clipBtn, micBtn, micTime, hint, sendBtn), pickFile, takePhoto);
  const el = h('div.al-chat', { class: opts.compact ? 'compact' : '' }, scroller, composer);
  const scrollDown = () => { scroller.scrollTop = scroller.scrollHeight; };
  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(160, input.scrollHeight)}px`; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  sendBtn.addEventListener('click', () => (busy ? busy.abort() : send()));
  const setBusy = ctrl => {
    busy = ctrl;
    fill(sendBtn, ic(ctrl ? 'square' : 'send', 16));
    sendBtn.setAttribute('aria-label', ctrl ? 'Ferma' : 'Invia');
    sendBtn.classList.toggle('stop', Boolean(ctrl));
  };

  function welcome() {
    const sugg = (opts.suggestions ? opts.suggestions() : null) || ['Quali ticket ho in ritardo?', 'Cosa ho questa settimana nel CRM?', 'Come stiamo andando con le gare negli ultimi 12 mesi?'];
    fill(msgs, h('div.al-welcome', ava(44), h('div.al-t5.al-big', 'Ciao, sono Alma'),
      h('p.al-muted', 'Rispondo con i dati di Alma Planet che vedi tu: ticket, progetti, ore delle RDA, CRM, radar, gare, persone e mezzi. Posso preparare ticket, note, passi e contatti: niente si salva senza la tua conferma.'),
      h('div.al-sugg', sugg.map(s => h('button', { type: 'button', on: { click: () => send(s) } }, s)))));
  }
  function blocked(text) {
    fill(msgs, h('div.al-welcome', ava(44), h('div.al-t5.al-big', 'Alma'), h('p.al-muted', text)));
    input.disabled = true; sendBtn.disabled = true;
  }

  const question = (text, foto = []) => h('div.al-qbox', foto.length ? h('div.al-qphotos', foto.map(src => (typeof src === 'string' ? h('img', { src, alt: 'Foto allegata' }) : null)),
    foto.some(x => typeof x !== 'string') ? h('span.al-small.al-muted', ic('image', 13), `${foto.length} foto (non salvate)`) : null) : null, h('div.al-q', text));
  function answerShell() {
    const steps = h('div.al-steps');
    const body = h('div.al-tx');
    const extra = h('div.al-extra');
    const node = h('div.al-a', ava(), h('div.al-a-main', steps, body, extra));
    return { node, steps, body, extra };
  }
  const stepChip = label => h('span', ic('search', 11), label);

  // Una risposta finita: testo, cifre, elenco, azioni, domande, proposte, piede.
  function renderAnswer(shell, m) {
    const num = numberRenderer(m.ricevute);
    const b = m.blocchi || {};
    const cifre = b.cifre ? h('div.al-cifre', b.cifre.map(c => h('div', h('div.al-cv', inline(c.valore, num)), h('div.al-small.al-muted', c.etichetta), c.diff ? h('div.al-small.al-diff', c.diff) : null))) : null;
    fill(shell.steps, (m.steps || []).map(stepChip));
    fill(shell.body, m.text ? markdown(m.text, num) : null, m.stopped ? h('div.al-small.al-muted', 'Risposta fermata.') : null);
    const elenco = b.elenco ? h('div.al-list', b.elenco.titolo ? h('div.al-lbl', b.elenco.titolo) : null,
      b.elenco.voci.map(v => (v.link ? h('a.al-li', { href: v.link, on: { click: closePanelOnPhone } }, h('span.al-t5', v.nome), v.dettaglio ? h('span.al-small.al-muted', v.dettaglio) : null)
        : h('div.al-li', h('span.al-t5', v.nome), v.dettaglio ? h('span.al-small.al-muted', v.dettaglio) : null)))) : null;
    const azioni = b.azioni ? h('div.al-row.al-wrap', b.azioni.map(a => (a.tipo === 'apri'
      ? h('a.btn.btn-sm', { href: a.link, on: { click: closePanelOnPhone } }, ic('external', 14), a.testo)
      : h('button.btn.btn-sm', { type: 'button', on: { click: () => send(a.chiedi) } }, ic('plus', 14), a.testo)))) : null;
    const domande = b.domande ? h('div.al-sugg', b.domande.map(d => h('button', { type: 'button', on: { click: () => send(d) } }, d))) : null;
    const props = (m.proposals || []).map(p => proposalCard(p));
    const charts = (m.charts || []).map(c => chartEl(c, { messageId: m.message_id || m.id }));
    fill(shell.extra, cifre, charts, elenco, props, azioni, domande, footer(m));
    syncAll(shell.extra);
  }
  function footer(m) {
    if (!m.text) return null;
    let rating = m.rating ?? null;
    const up = h('button.al-fb', { type: 'button', title: 'Utile', 'aria-label': 'Risposta utile' }, ic('thumbs-up', 15));
    const down = h('button.al-fb', { type: 'button', title: 'Non utile', 'aria-label': 'Risposta non utile' }, ic('thumbs-down', 15));
    const paint = () => { up.classList.toggle('on', rating === 1); down.classList.toggle('on', rating === -1); };
    const vote = async (v, comment) => {
      if (!m.trace_id) return;
      const next = rating === v ? 0 : v;
      await post(`/api/alma/tracce/${m.trace_id}/voto`, { voto: next, commento: comment || '' });
      rating = next || null; paint();
      if (next) toast(next === 1 ? 'Grazie: risposta segnata come utile' : 'Grazie: lo guardiamo');
    };
    up.addEventListener('click', () => vote(1));
    down.addEventListener('click', async () => {
      if (rating === -1) return vote(-1);
      const c = await promptDialog('Cosa non andava?', { label: 'Due parole aiutano a migliorare Alma (facoltativo)', ok: 'Manda' });
      if (c !== null) vote(-1, c); else vote(-1);
    });
    paint();
    const copy = h('button.al-fb', { type: 'button', title: 'Copia', 'aria-label': 'Copia la risposta', on: { click: async () => {
      await navigator.clipboard?.writeText(String(m.text).replace(/\*\*/g, '').replace(/\{f\d+\}/g, '')); toast('Risposta copiata');
    } } }, ic('copy', 15));
    const retry = m.question ? h('button.al-fb', { type: 'button', title: 'Riprova', 'aria-label': 'Riprova', on: { click: () => send(m.question, { retry: false }) } }, ic('refresh', 15)) : null;
    const listen = status?.voce ? h('button.al-fb', { type: 'button', title: 'Ascolta', 'aria-label': 'Ascolta la risposta', on: { click: () => listenTo(m.text, listen) } }, ic('volume-2', 15)) : null;
    return h('div.al-foot', copy, listen, retry, m.trace_id ? up : null, m.trace_id ? down : null);
  }

  // ── proposta arancione ──
  function proposalCard(p) {
    const box = h('div.al-prop', { 'data-id': p.id });
    const draw = q => {
      p = q;
      const card = p.icon === 'id-card'; // biglietto da visita: un campo per riga, come nel canvas V6-Biglietti
      const mail = p.icon === 'mail'; // email (canvas V7-Email): campi in righe, gruppo con le spunte
      const open = p.status === 'proposta' && !p.choices;
      const summary = card || mail ? '' : (p.fields || []).filter(([k]) => !['Ticket', 'Nota', 'Persona', 'Cosa'].includes(k) || (p.fields || []).length <= 2).map(([k, v]) => `${k}: ${v}`).join(' · ');
      const unsure = card ? ((p.warnings || []).join(' ').match(/letti male dalla foto: ([^.]+)/) || [, ''])[1].split(',').map(x => x.trim().toLowerCase()).filter(Boolean) : [];
      const rows = card ? h('div.al-frows', (p.fields || []).filter(([k]) => k !== 'Persona').map(([k, v]) => h('div.al-frow', { class: unsure.includes(k.toLowerCase()) ? 'unsure' : '' },
        h('span.al-muted', k), h('span', v), unsure.includes(k.toLowerCase()) ? h('span.al-small.al-unsure', 'da controllare') : null)))
        : mail ? h('div.al-frows', (p.fields || []).map(([k, v]) => h('div.al-frow', { class: k === 'Testo' ? 'al-mtext' : '' }, h('span.al-muted', k), h('span', v)))) : null;
      const items = mail && p.items ? h('div.al-mitems', p.items.map(it => mailItem(it, open))) : null;
      const head = h('div.al-row', { style: { alignItems: 'flex-start' } }, h('span.al-ib.or', ic(p.icon || 'sparkles', 15)),
        h('div.al-grow', h('div.al-t5', p.title), summary ? h('div.al-small.al-muted', summary) : null,
          (p.changed || []).length ? h('div.al-small.al-chg', `Cambiato: ${p.changed.map(c => `${c.label} (prima ${c.before})`).join(', ')}`) : null,
          p.dai_dati ? h('div.al-small.al-muted', 'Suggerita dai dati: controlla bene.') : null),
        statusPill(p));
      box.dataset.open = p.status === 'proposta' && !p.choices ? '1' : '';
      const warns = (p.warnings || []).filter(w => !(card && /letti male dalla foto/.test(w))); // sul biglietto lo dice già la riga arancione
      const warn = warns.length ? h('div.al-warn', warns.map(w => h('div', ic('alert-triangle', 13), w))) : null;
      let actions = null;
      if (p.status === 'proposta' && p.choices) {
        actions = h('div.al-choices', h('div.al-small.al-t5', p.choices.question),
          p.choices.options.map((o, i) => h('button.al-opt', { type: 'button', on: { click: () => act('scegli', { indice: i }) } }, h('span.al-t5', o.label), o.sub ? h('span.al-small.al-muted', o.sub) : null)),
          h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => act('annulla') } }, 'Annulla'));
      } else if (p.status === 'proposta' && mail) {
        const when = ((p.fields || []).find(([k]) => k === 'Quando') || [])[1] || 'subito';
        const now = when.startsWith('subito');
        const n = p.items ? p.items.filter(x => x.incluso).length : 1;
        const editable = (p.edit || []).filter(f => !f.hidden && (!p.items || !['oggetto', 'testo'].includes(f.key)));
        actions = h('div.al-row.al-wrap', { style: { gap: '8px' } },
          h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => act('conferma', { solo: true }) } }, ic(now ? 'send' : 'clock', 14),
            now ? (n > 1 ? `Invia le ${n} spuntate` : 'Invia ora') : (n > 1 ? `Programma le ${n}` : 'Programma')),
          h('button.btn.btn-sm', { type: 'button', on: { click: () => scheduleForm() } }, ic('clock', 14), now ? 'Programma per…' : 'Cambia ora'),
          editable.some(f => f.key !== 'quando') ? h('button.btn.btn-sm', { type: 'button', on: { click: () => editForm() } }, 'Cambia') : null,
          h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => act('annulla', { solo: true }) } }, 'Annulla'));
      } else if (p.status === 'proposta') {
        actions = h('div.al-row', { style: { gap: '8px' } },
          h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => act('conferma', { solo: true }) } }, ic('check', 15), p.title.startsWith('Aggiorna ·') ? 'Aggiorna' : 'Conferma'),
          (p.edit || []).length ? h('button.btn.btn-sm', { type: 'button', on: { click: () => editForm() } }, 'Cambia') : null,
          h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => act('annulla', { solo: true }) } }, p.icon === 'id-card' ? (p.title.startsWith('Aggiorna ·') ? 'Lascia così' : 'Salta') : 'Annulla'));
      } else if (p.status === 'fatta') {
        actions = h('div.al-row.al-wrap', { style: { gap: '8px' } }, p.link ? h('a.btn.btn-sm', { href: p.link, on: { click: closePanelOnPhone } }, ic('external', 14), 'Apri') : null,
          p.undo_until ? h('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Per 10 minuti dal salvataggio', on: { click: () => act('disfa') } }, ic('rotate-ccw', 14), 'Annulla il salvataggio') : null);
      } else if (p.status === 'errore') actions = h('div.al-small.al-bad', p.error);
      fill(box, head, rows, items, warn, actions);
      box.classList.toggle('done', p.status !== 'proposta');
    };
    // Una email del gruppo: spunta (toglie o rimette), a chi, oggetto, testo (si apre al clic).
    const mailItem = (it, open) => {
      const text = h('div.al-small.al-mbody', it.testo);
      text.addEventListener('click', () => text.classList.toggle('full'));
      const toggle = async () => {
        const off = (p.items || []).filter(x => (x.n === it.n ? x.incluso : !x.incluso)).map(x => x.n);
        const r = await post(`/api/alma/azioni/${p.id}/modifica`, { campi: { escludi: off.join(',') } }).catch(() => null);
        if (r) { draw(r.proposal); if (box.parentNode) syncAll(box.parentNode); }
      };
      return h('div.al-mitem', { class: it.incluso ? '' : 'off' },
        h('div.al-row', { style: { gap: '8px' } },
          open ? h('button.al-chk', { type: 'button', class: it.incluso ? 'on' : '', 'aria-pressed': String(it.incluso), title: it.incluso ? 'Togli questa email' : 'Rimetti questa email', on: { click: toggle } }, it.incluso ? ic('check', 12) : null) : null,
          h('span.al-t5.al-small.al-grow', it.nome, it.azienda ? h('span.al-muted', ` · ${it.azienda}`) : null), h('span.al-small.al-muted', it.email)),
        h('div.al-small', h('b', it.oggetto)), it.incluso ? text : h('div.al-small.al-muted', 'tolta: non parte'));
    };
    // «Programma per…»: data e ora (ora italiana); «Invia subito» toglie l'ora.
    const scheduleForm = () => {
      const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
      const inp = h('input.input', { type: 'datetime-local', value: `${tomorrow}T08:30` });
      const go = async quando => {
        const r = await post(`/api/alma/azioni/${p.id}/modifica`, { campi: { quando } }).catch(() => null);
        if (r) draw(r.proposal);
      };
      fill(box, h('div.al-t5', p.title), h('label.al-fld', h('span', 'Quando partire (ora italiana)'), inp),
        h('div.al-row.al-wrap', { style: { gap: '8px' } }, h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => go(String(inp.value).replace('T', ' ')) } }, ic('clock', 14), 'Programma'),
          h('button.btn.btn-sm', { type: 'button', on: { click: () => go('') } }, 'Invia subito'),
          h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => draw(p) } }, 'Lascia com\'è')));
    };
    const editForm = () => {
      const inputs = {};
      const form = h('form.al-edit', { on: { submit: async e => {
        e.preventDefault();
        const campi = Object.fromEntries(Object.entries(inputs).map(([k, x]) => [k, x.value]));
        const r = await post(`/api/alma/azioni/${p.id}/modifica`, { campi }).catch(() => null);
        if (r) draw(r.proposal);
      } } },
      (p.edit || []).filter(f => !f.hidden && f.key !== 'quando' && !(p.items && ['oggetto', 'testo'].includes(f.key))).map(f => {
        const ctl = f.type === 'textarea' ? h('textarea.input', { rows: p.icon === 'mail' ? 8 : 3 }, f.value)
          : f.type === 'enum' ? h('select.select', f.options.map(o => h('option', { value: o, selected: o === f.value }, o)))
          : h('input.input', { type: f.type === 'date' ? 'date' : 'text', value: f.value, placeholder: f.type === 'people' ? 'Nomi separati da virgola' : '' });
        inputs[f.key] = ctl;
        return h('label.al-fld', h('span', f.label), ctl);
      }),
      h('div.al-row', { style: { gap: '8px' } }, h('button.btn.btn-sm.btn-primary', { type: 'submit' }, 'Aggiorna la proposta'),
        h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => draw(p) } }, 'Lascia com\'è')));
      fill(box, h('div.al-t5', p.title), form);
    };
    const act = async (what, body) => {
      const r = await post(`/api/alma/azioni/${p.id}/${what}`, body || {}).catch(() => null);
      if (!r) return;
      const mine = (r.proposals || []).find(x => x.id === p.id);
      if (mine) draw(mine);
      if (box.parentNode) syncAll(box.parentNode);
      if (r.reply) appendNote(r.reply, r.proposals?.filter(x => x.id !== p.id));
    };
    draw(p);
    return box;
  }
  // Due o più proposte aperte nella stessa risposta → «Conferma tutti (N)» sotto l'ultima.
  function syncAll(container) {
    const open = [...container.querySelectorAll(':scope > .al-prop[data-open="1"]')];
    let bar = container.querySelector(':scope > .al-allbar');
    if (open.length < 2) { if (bar) bar.remove(); return; }
    if (!bar) bar = h('div.al-row.al-allbar');
    const cards = [...container.querySelectorAll(':scope > .al-prop')];
    cards[cards.length - 1].after(bar);
    const all = h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async () => {
      all.disabled = true;
      const r = await post(`/api/alma/azioni/${open[0].dataset.id}/conferma`, {}).catch(() => null);
      all.disabled = false;
      if (!r) return;
      for (const x of r.proposals || []) { const old = container.querySelector(`:scope > .al-prop[data-id="${x.id}"]`); if (old) old.replaceWith(proposalCard(x)); }
      syncAll(container);
      if (r.reply) appendNote(r.reply);
    } } }, ic('check', 15), `Conferma tutti (${open.length})`);
    fill(bar, all, h('span.al-small.al-muted', 'niente si salva finché non confermi'));
  }
  function statusPill(p) {
    if (p.status === 'proposta' && p.icon === 'mail') return pill('bozza', 'or');
    if (p.status === 'proposta' && p.icon === 'id-card') {
      return p.title.startsWith('Aggiorna ·') ? pill('già nel CRM', '') : p.title.includes('nuova azienda') ? pill('azienda nuova', 'or') : pill('azienda trovata', 'gr');
    }
    const map = { fatta: ['Salvato', 'gr'], annullata: ['Annullata', ''], superata: ['Sostituita', ''], errore: ['Non salvato', 'rd'], disfatta: ['Tolto dopo il salvataggio', ''] };
    const s = map[p.status];
    return s ? pill(s[0], s[1]) : pill(p.label, 'or');
  }
  function appendNote(text, proposals = []) {
    const shell = answerShell();
    msgs.append(shell.node);
    renderAnswer(shell, { text, proposals });
    scrollDown();
  }

  // ── invio con risposta in diretta (Server-Sent Events) ──
  async function send(textArg, { retry = false, images = null } = {}) {
    if (busy) return;
    const imgs = images || (textArg ? [] : photos.slice());
    const typed = String(textArg ?? input.value).trim();
    const text = typed || (imgs.length ? (imgs.length === 1 ? 'Crea il contatto da questo biglietto da visita.' : 'Crea i contatti da questi biglietti da visita.') : '');
    if (!text) return;
    if (!textArg) { input.value = ''; grow(); photos = []; drawPhotos(); }
    if (msgs.querySelector('.al-welcome')) clear(msgs);
    lastQuestion = text;
    if (!retry) msgs.append(question(text, imgs));
    const shell = answerShell();
    shell.body.append(h('span.al-dots', h('i'), h('i'), h('i')));
    msgs.append(shell.node);
    scrollDown();
    const ctrl = new AbortController();
    setBusy(ctrl);
    let draft = '';
    let finished = false;
    const showError = (msg, canRetry = true) => {
      fill(shell.body, h('div.al-err', ic('alert-triangle', 14), msg));
      if (canRetry) shell.extra.append(h('button.btn.btn-sm', { type: 'button', on: { click: () => { shell.node.remove(); send(text, { retry: true, images: imgs }); } } }, ic('refresh', 14), 'Riprova'));
    };
    try {
      const res = await fetch('/api/alma/chat/stream', { method: 'POST', credentials: 'same-origin', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'X-Alma': '1' },
        body: JSON.stringify({ text, conversation_id: convId || undefined, context: opts.context ? opts.context() : undefined, retry: retry || undefined, images: imgs.length ? imgs : undefined }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showError(data.error || `Errore ${res.status}`, !['daily_limit', 'month_limit', 'not_configured', 'disabled'].includes(data.code));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const handle = (event, data) => {
        if (event === 'start') { const isNew = !convId; convId = data.conversation_id; if (isNew) opts.onConversation?.(convId, data.title); }
        else if (event === 'step') shell.steps.append(stepChip(data.label));
        else if (event === 'delta') { draft += data.text; fill(shell.body, markdown(draft.split('```blocchi')[0], t => h('b', t.replace(/\{f\d+\}/g, '')))); scrollDown(); }
        else if (event === 'reset') { draft = ''; fill(shell.body, h('span.al-dots', h('i'), h('i'), h('i'))); }
        else if (event === 'chart') { shell.extra.append(chartEl(data.chart)); scrollDown(); }
        else if (event === 'proposal') {
          const old = shell.extra.querySelector(`.al-prop[data-id="${data.proposal.id}"]`);
          const card = proposalCard(data.proposal);
          if (old) old.replaceWith(card); else shell.extra.append(card);
          syncAll(shell.extra);
          scrollDown();
        } else if (event === 'done') { finished = true; renderAnswer(shell, { ...data, text: data.reply, question: text }); scrollDown(); opts.onConversation?.(convId, data.title, true); }
        else if (event === 'error') { finished = true; showError(data.error, !['daily_limit', 'month_limit'].includes(data.code)); }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (chunk.match(/^event: (.*)$/m) || [])[1];
          const data = (chunk.match(/^data: (.*)$/m) || [])[1];
          if (ev && data) handle(ev, JSON.parse(data));
        }
      }
      if (!finished) showError('La risposta si è interrotta.');
    } catch (e) {
      if (e.name === 'AbortError') {
        const said = draft.split('```blocchi')[0];
        fill(shell.body, said ? markdown(said, t => h('b', t.replace(/\{f\d+\}/g, ''))) : null, h('div.al-small.al-muted', 'Risposta fermata.'));
        shell.extra.append(h('button.btn.btn-sm', { type: 'button', on: { click: () => { shell.node.remove(); send(text, { retry: true, images: imgs }); } } }, ic('refresh', 14), 'Riprova'));
      } else showError('Non riesco a raggiungere Alma: controlla la connessione e riprova.');
    } finally { setBusy(null); input.focus({ preventScroll: true }); }
  }

  async function open(id) {
    if (busy) busy.abort();
    convId = id || null;
    input.disabled = false; sendBtn.disabled = false;
    if (!status) await loadStatus();
    if (!status) return blocked('Non riesco a raggiungere Alma adesso.');
    if (!status.configured) return blocked(status.admin ? 'Alma è spenta: manca la chiave OPENAI_API_KEY su Railway.' : 'Alma non è ancora attiva.');
    if (!status.enabled) return blocked(status.admin ? 'Alma è spenta. Si riaccende in Impostazioni → Alma.' : 'Alma è spenta in questo momento.');
    if (!convId) return welcome();
    fill(msgs, loading());
    const c = await get(`/api/alma/conversations/${convId}`).catch(() => null);
    if (!c) { convId = null; return welcome(); }
    clear(msgs);
    let q = '';
    for (const m of c.messages) {
      if (m.role === 'user') { q = m.text; msgs.append(question(m.text, Array.from({ length: m.foto || 0 }, () => null))); continue; }
      const shell = answerShell();
      msgs.append(shell.node);
      renderAnswer(shell, { ...m, question: q });
    }
    scrollDown();
  }
  return { el, open, send, focus: () => input.focus(), get id() { return convId; }, get lastQuestion() { return lastQuestion; } };
}

// ── pagina #/alma/dashboard: i grafici tenuti, rifatti con i dati di oggi (canvas V5-Alma) ─────────────────
async function dashboardView(view) {
  document.body.classList.remove('on-alma');
  const grid = h('div.al-dgrid');
  fill(view, h('div.al-epage.al-dpage',
    h('div.cv-top', h('div', h('div.cv-eyebrow', 'Alma'), h('h1.cv-h1', 'Dashboard di Alma'),
      h('p.cv-sub', 'I grafici che hai tenuto dalle risposte di Alma. Si rifanno con i dati di oggi ogni volta che apri la pagina. La vedi solo tu.')),
      h('div.cv-top-r', h('a.btn', { href: '#/alma' }, ic('sparkles', 15), 'Chiedi ad Alma'))),
    grid));
  fill(grid, loading());
  const { grafici = [] } = await get('/api/alma/dashboard');
  if (!grafici.length) return fill(grid, emptyState('bar-chart-3', 'Ancora nessun grafico. Chiedi ad Alma, per esempio «win ratio per BU in un grafico», poi «Aggiungi alla dashboard».'));
  const card = g => {
    const wrap = h('div.al-dcard');
    const paint = x => {
      const when = h('span.al-small.al-muted', x.errore ? 'Non aggiornato: ' + x.errore : 'aggiornato ' + fmtDateTime(x.aggiornato));
      const rename = h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: async () => { const t = await promptDialog('Titolo del grafico', { value: x.titolo, ok: 'Salva' }); if (t) { const r = await patch('/api/alma/dashboard/' + x.id, { titolo: t }).catch(() => null); if (r) paint(r); } } } }, 'Rinomina');
      const remove = h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: async () => { if (await confirmDialog('Togliere questo grafico dalla dashboard?', { ok: 'Togli' })) { await del('/api/alma/dashboard/' + x.id); wrap.remove(); } } } }, 'Togli');
      fill(wrap, chartEl(x.chart, { onType: t => patch('/api/alma/dashboard/' + x.id, { tipo: t }).catch(() => {}), actions: [rename, remove] }), when);
    };
    paint(g);
    post('/api/alma/dashboard/' + g.id + '/aggiorna', {}).then(paint).catch(() => {});
    return wrap;
  };
  fill(grid, grafici.map(card));
}

// ── pagina #/alma/email: email programmate e inviate da Alma (canvas V7-Email) ─────────────────────────────
const EMAIL_STATE = { inviata: ['inviata', 'gr'], errore: ['non partita', 'rd'], annullata: ['annullata', ''], invio: ['in partenza', 'or'] };
async function emailView(view) {
  document.body.classList.remove('on-alma');
  const box = h('div.al-email');
  fill(view, h('div.al-epage',
    h('div.cv-top', h('div', h('div.cv-eyebrow', 'Alma'), h('h1.cv-h1', 'Email di Alma'),
      h('p.cv-sub', 'Le email che Alma ha preparato e tu hai confermato: partono dalla tua casella Outlook. Le vedi solo tu.')),
      h('div.cv-top-r', h('a.btn', { href: '#/alma' }, ic('sparkles', 15), 'Chiedi ad Alma'))),
    box));
  const draw = async () => {
    fill(box, loading());
    const { programmate = [], recenti = [] } = await get('/api/alma/email');
    const card = e => {
      const body = h('div.al-small.al-mbody', e.testo);
      body.addEventListener('click', () => body.classList.toggle('full'));
      const done = async (pr, ok) => { const r = await pr.catch(() => null); if (r) { if (ok) toast(ok); draw(); } };
      const editForm = () => {
        const subj = h('input.input', { type: 'text', value: e.oggetto });
        const text = h('textarea.input', { rows: 8 }, e.testo);
        const at = new Date(e.quando).toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 16).replace(' ', 'T');
        const when = h('input.input', { type: 'datetime-local', value: at });
        fill(c, h('label.al-fld', h('span', 'Oggetto'), subj), h('label.al-fld', h('span', 'Testo'), text), h('label.al-fld', h('span', 'Quando (ora italiana)'), when),
          h('div.al-row', { style: { gap: '8px' } }, h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => done(patch(`/api/alma/email/${e.id}`, { oggetto: subj.value, testo: text.value, quando: String(when.value).replace('T', ' ') }), 'Email cambiata') } }, 'Salva'),
            h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => draw() } }, 'Lascia com\'è')));
      };
      const c = h('div.al-mcard',
        h('div.al-row', { style: { gap: '8px', alignItems: 'flex-start' } }, h('span.al-ib.or', ic('mail', 15)),
          h('div.al-grow', h('div.al-t5', e.a), h('div.al-small.al-muted', e.email)),
          e.stato === 'programmata' ? pill(e.quando_label, 'or') : pill(...(EMAIL_STATE[e.stato] || [e.stato, '']))),
        h('div.al-small', h('b', e.oggetto)), body,
        e.errore ? h('div.al-small.al-bad', e.errore) : null,
        e.stato === 'programmata' ? h('div.al-row.al-wrap', { style: { gap: '8px' } },
          h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => done(post(`/api/alma/email/${e.id}/invia-ora`, {}), 'Email inviata') } }, ic('send', 14), 'Invia ora'),
          h('button.btn.btn-sm', { type: 'button', on: { click: editForm } }, 'Cambia'),
          h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: async () => { if (await confirmDialog('Annullare questa email? Non partirà.', { ok: 'Annulla l\'email' })) done(post(`/api/alma/email/${e.id}/annulla`, {}), 'Email annullata'); } } }, 'Annulla'))
          : h('div.al-small.al-muted', [e.inviata ? `inviata ${fmtDateTime(e.inviata)}` : null, e.subject_id ? h('a', { href: `#/crm/scheda/${e.subject_id}` }, 'scheda CRM') : null].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x]))));
      return c;
    };
    fill(box,
      h('div.al-lbl', { style: { marginTop: '18px' } }, `Programmate (${programmate.length})`),
      programmate.length ? h('div.al-mlist', programmate.map(card)) : h('p.al-small.al-muted', 'Nessuna email programmata. Chiedi ad Alma, per esempio: «scrivi domani alle 9 all\'ing. Rossi per il sopralluogo».'),
      h('div.al-lbl', { style: { marginTop: '20px' } }, 'Ultimi 60 giorni'),
      recenti.length ? h('div.al-mlist', recenti.map(card)) : h('p.al-small.al-muted', 'Ancora nessuna email mandata con Alma.'));
  };
  await draw();
}

// ── pagina #/alma ───────────────────────────────────────────────────────────────────────────────────
function groupOf(iso) {
  const d = new Date(iso), now = new Date();
  const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
  return days <= 0 ? 'Oggi' : days < 7 ? 'Questa settimana' : 'Prima';
}
function timeOf(iso) {
  const d = new Date(iso);
  return groupOf(iso) === 'Oggi' ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    : groupOf(iso) === 'Questa settimana' ? d.toLocaleDateString('it-IT', { weekday: 'short' }) : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

export async function almaView(view, parts = [], params = new URLSearchParams()) {
  await loadStatus();
  if (parts[1] === 'impostazioni') return settingsView(view);
  if (parts[1] === 'email') return emailView(view);
  if (parts[1] === 'dashboard') return dashboardView(view);
  document.body.classList.add('on-alma');
  const list = h('div.al-convlist');
  const side = h('aside.al-conv',
    h('button.btn.btn-primary.al-new', { type: 'button', on: { click: () => { chat.open(null); history.replaceState(null, '', '#/alma'); drawList(); if (isMobile()) side.classList.remove('open'); } } }, ic('plus', 15), 'Nuova conversazione'),
    list,
    h('a.al-setlink', { href: '#/alma/dashboard' }, ic('layout-dashboard', 15), 'Dashboard di Alma'),
    h('a.al-setlink', { href: '#/alma/email' }, ic('mail', 15), 'Email di Alma'),
    status?.admin ? h('a.al-setlink', { href: '#/alma/impostazioni' }, ic('settings', 15), 'Impostazioni di Alma') : null);
  const chat = createChat({
    onConversation: (id, title, done) => { if (!done) history.replaceState(null, '', `#/alma?c=${id}`); drawList(); },
  });
  const head = h('div.al-mhead', h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => side.classList.toggle('open') } }, ic('list', 16), 'Conversazioni'));
  async function drawList() {
    const { conversations = [] } = (await get('/api/alma/conversations', { quiet: true }).catch(() => ({}))) || {};
    if (!conversations.length) return fill(list, h('p.al-small.al-muted', { style: { padding: '6px 12px' } }, 'Le tue conversazioni compaiono qui. Le vedi solo tu.'));
    let g = null;
    const out = [];
    for (const c of conversations) {
      const grp = groupOf(c.updated_at);
      if (grp !== g) { g = grp; out.push(h('div.al-lbl', { style: { padding: '10px 12px 4px' } }, grp)); }
      out.push(h('div.al-ci', { class: c.id === chat.id ? 'on' : '' },
        h('button.al-ci-main', { type: 'button', on: { click: () => { history.replaceState(null, '', `#/alma?c=${c.id}`); chat.open(c.id); drawList(); side.classList.remove('open'); } } },
          h('span.al-ell', c.title || 'Conversazione'), h('small', timeOf(c.updated_at))),
        h('span.al-ci-acts',
          h('button.al-fb', { type: 'button', title: 'Rinomina', 'aria-label': 'Rinomina', on: { click: async () => {
            const t = await promptDialog('Rinomina la conversazione', { label: 'Titolo', value: c.title });
            if (t) { await patch(`/api/alma/conversations/${c.id}`, { title: t }); drawList(); }
          } } }, ic('pencil', 14)),
          h('button.al-fb', { type: 'button', title: 'Cancella', 'aria-label': 'Cancella', on: { click: async () => {
            if (!(await confirmDialog(`Cancellare «${c.title}»? Non si può recuperare.`, { ok: 'Cancella', danger: true }))) return;
            await del(`/api/alma/conversations/${c.id}`);
            if (chat.id === c.id) { chat.open(null); history.replaceState(null, '', '#/alma'); }
            drawList();
          } } }, ic('trash', 14)))));
    }
    fill(list, out);
  }
  fill(view, h('div.al-page', side, h('div.al-pmain', head, chat.el)));
  const id = Number(params.get('c')) || null;
  await chat.open(id);
  drawList();
  const q = params.get('q');
  if (q && !id) chat.send(q);
  else chat.focus();
  return () => document.body.classList.remove('on-alma');
}

// ── pannello laterale da ogni pagina ──────────────────────────────────────────────────────────────
let panel = null;
function pageContext() {
  const route = (location.hash || '#/').split('?')[0];
  const h1 = document.querySelector('#view h1');
  const label = h1 ? h1.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  return { route, label };
}
function suggestionsFor(ctx) {
  if (/^#\/projects\/\d+/.test(ctx.route)) return ['Riassumi questo progetto: ritardi, ticket aperti, ore', 'Chi ha più ticket aperti qui?', 'Crea un ticket in questo progetto'];
  if (/^#\/crm\/scheda\/\d+/.test(ctx.route)) return ['Riassumi questa azienda: passi, contatti, note', 'Chi di noi la conosce meglio?', 'Aggiungi un passo: richiamare entro venerdì'];
  if (/^#\/tickets\/\d+/.test(ctx.route)) return ['Riassumi questo ticket', 'Cosa manca per chiuderlo?'];
  if (/^#\/crm/.test(ctx.route)) return ['Cosa ho questa settimana nel CRM?', 'Win ratio degli ultimi 12 mesi', 'Segnali del radar in evidenza'];
  return null;
}
export function closePanelOnPhone() { if (panel && isMobile()) panel.close(); }

function buildPanel() {
  let ctx = pageContext();
  const where = h('div.al-where');
  const chat = createChat({ compact: true, context: () => ctx, suggestions: () => suggestionsFor(ctx), placeholder: 'Chiedi ad Alma…' });
  const drawWhere = () => fill(where, ctx.label || ctx.route !== '#/' ? [ic('map-pin', 12), h('span.al-ell', `Stai guardando: ${ctx.label || 'questa pagina'}`)] : null);
  const box = h('aside.al-panel', { role: 'dialog', 'aria-label': 'Alma, l\'assistente', hidden: true },
    h('div.al-ph', ava(32), h('div.al-grow', h('div.al-t5', 'Alma'), where),
      h('button.btn.btn-ghost.btn-sm.al-icobtn', { type: 'button', title: 'Nuova conversazione', 'aria-label': 'Nuova conversazione', on: { click: () => { ctx = pageContext(); drawWhere(); chat.open(null); } } }, ic('plus', 16)),
      h('a.btn.btn-ghost.btn-sm.al-icobtn', { href: '#/alma', title: 'Apri a tutta pagina', 'aria-label': 'Apri a tutta pagina', on: { click: e => { e.preventDefault(); const id = chat.id; close(); location.hash = id ? `#/alma?c=${id}` : '#/alma'; } } }, ic('expand', 16)),
      h('button.btn.btn-ghost.btn-sm.al-icobtn', { type: 'button', 'aria-label': 'Chiudi', on: { click: () => close() } }, ic('x', 16))),
    chat.el);
  document.body.append(box);
  const onKey = e => { if (e.key === 'Escape' && !box.hidden && !document.getElementById('overlay-root').childElementCount) close(); };
  document.addEventListener('keydown', onKey);
  async function open() {
    ctx = pageContext();
    drawWhere();
    box.hidden = false;
    document.body.classList.add('al-panel-open');
    await loadStatus();
    if (!chat.id) await chat.open(null);
    chat.focus();
  }
  function close() { box.hidden = true; document.body.classList.remove('al-panel-open'); closeReceipt(); }
  // cambiando pagina il pannello resta aperto e sa dove sei
  window.addEventListener('hashchange', () => {
    if ((location.hash || '').startsWith('#/alma')) return close();
    setTimeout(() => { ctx = pageContext(); drawWhere(); }, 400);
  });
  return { open, close, get isOpen() { return !box.hidden; } };
}

// Tasto «Alma» in basso a destra su ogni pagina (sopra la barra in basso sul telefono).
export function setupAlma() {
  const fab = h('button.al-fab', { type: 'button', 'aria-label': 'Chiedi ad Alma', title: 'Chiedi ad Alma' }, ic('sparkles', 20), h('span', 'Alma'));
  fab.addEventListener('click', () => { panel = panel || buildPanel(); panel.open(); });
  document.body.append(fab);
  const sync = () => { fab.hidden = (location.hash || '').startsWith('#/alma'); };
  window.addEventListener('hashchange', sync);
  sync();
}

// ── Impostazioni → Alma (amministratori) ──────────────────────────────────────────────────────────
async function settingsView(view) {
  if (!status?.admin) { fill(view, h('div.card.empty', 'Le impostazioni di Alma le gestiscono gli amministratori.')); return; }
  const s = await get('/api/alma/settings');
  const eur = n => (n === null || n === undefined ? '—' : `${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
  const money = v => h('input.input.al-money', { type: 'text', inputmode: 'decimal', value: String(v).replace('.', ',') });
  const on = toggle(s.enabled, null, { 'aria-label': 'Alma accesa' });
  const acts = toggle(s.actions, null, { 'aria-label': 'Può preparare ticket, note e contatti' });
  const voice = toggle(s.voice, null, { 'aria-label': 'Voce' });
  const monthly = money(s.monthly_eur), daily = money(s.daily_eur);
  const mode = h('select.select', Object.entries(s.modes).map(([k, l]) => h('option', { value: k, selected: k === s.model_mode }, l)));
  const line = (title, sub, ctl) => h('div.al-setrow', h('div.al-grow', h('div.al-t5', title), sub ? h('div.al-small.al-muted', sub) : null), ctl);
  const st = s.stats;
  const save = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    const r = await put('/api/alma/settings', { enabled: on.input.checked, actions: acts.input.checked, voice: voice.input.checked, model_mode: mode.value,
      monthly_eur: monthly.value.replace(',', '.'), daily_eur: daily.value.replace(',', '.') }).catch(() => null);
    if (r) { toast('Impostazioni di Alma salvate'); status = null; }
  } } }, 'Salva');
  const general = h('section.cv-card.al-setcard', h('div.al-lbl', 'Generale'),
    !s.configured ? h('div.al-warn', h('div', ic('alert-triangle', 13), 'Manca la chiave OPENAI_API_KEY su Railway: finché non c\'è, Alma resta spenta per tutti.')) : null,
    s.fake ? h('div.al-warn', h('div', ic('info', 13), 'Modalità finta (solo in locale): Alma risponde senza OpenAI.')) : null,
    line('Alma accesa', 'per tutti gli utenti di Alma Planet', on.el),
    line('Quota del mese', 'si ferma da sola quando è finita', h('span.al-eur', monthly, '€')),
    line('Per persona al giorno', null, h('span.al-eur', daily, '€')),
    line('Può preparare ticket, note, passi e contatti', 'sempre da confermare', acts.el),
    line('Voce', 'dettatura con il microfono e «Ascolta» (OpenAI)', voice.el),
    line('Modelli', 'Uno veloce per le domande semplici, uno più forte per le analisi', mode),
    h('div.al-row', { style: { marginTop: '12px' } }, save),
    h('p.al-hint', `Questo mese: ${eur(st.month.cost_eur)} · ${st.month.answers} risposte${st.month.avg_cent !== null ? ` · ${String(st.month.avg_cent).replace('.', ',')} cent l'una` : ''} · ${st.month.users} persone`),
    st.by_model.length ? h('p.al-hint', st.by_model.map(m => `${m.label}: ${eur(m.cost_eur)} (${m.calls} chiamate)`).join(' · ')) : null);

  // Risposte: tracce con utile / non utile
  const rlist = h('div');
  let filter = '';
  const drawRisposte = async () => {
    fill(rlist, loading());
    const { risposte = [] } = await get(`/api/alma/risposte${filter ? `?voto=${filter}` : ''}`);
    if (!risposte.length) return fill(rlist, emptyState('message', 'Nessuna risposta qui.'));
    fill(rlist, risposte.map(r => h('div.al-rr',
      h('div.al-row', { style: { gap: '6px', alignItems: 'flex-start' } }, h('span.al-t5.al-small.al-grow', r.question),
        r.rating === 1 ? pill('utile', 'gr') : r.rating === -1 ? pill('non utile', 'rd') : r.status === 'errore' || r.numbers_unverified ? pill('da vedere', 'am') : null),
      h('div.al-small.al-muted', [r.ricerche.length ? `${r.ricerche.length} ${r.ricerche.length === 1 ? 'ricerca' : 'ricerche'}` : 'nessuna ricerca', `${String(r.cost_cent).replace('.', ',')} cent`,
        `${Math.round(r.latency_ms / 100) / 10} s`, r.numbers_unverified ? `${r.numbers_unverified} ${r.numbers_unverified === 1 ? 'numero' : 'numeri'} senza ricevuta (${(r.unverified_numbers || []).join(', ')})` : null,
        r.status === 'errore' ? `errore: ${r.error}` : null, r.user_name, fmtDateTime(r.created_at)].filter(Boolean).join(' · ')),
      r.rating_comment ? h('div.al-small', `«${r.rating_comment}»`) : null)));
  };
  const q = st.quality;
  const risposte = h('section.cv-card.al-setcard', h('div.al-lbl', 'Risposte'),
    h('div.al-small.al-muted', `${q.up} utili · ${q.down} non utili · ${q.errors} errori · ${q.unverified} con numeri senza ricevuta${q.avg_seconds ? ` · tempo medio ${String(q.avg_seconds).replace('.', ',')} s` : ''}`),
    seg([['', 'Tutte'], ['su', 'Utili'], ['giu', 'Non utili'], ['problemi', 'Da vedere']], '', k => { filter = k; drawRisposte(); }, { label: 'Filtra le risposte' }),
    rlist);

  // Regole
  const rules = h('div');
  const drawRules = async () => {
    const { regole = [] } = await get('/api/alma/regole');
    fill(rules, regole.length ? regole.map(r => {
      const t = toggle(r.active, null, { 'aria-label': 'Regola attiva', on: { change: e => patch(`/api/alma/regole/${r.id}`, { active: e.target.checked }) } });
      return h('div.al-rule', h('span.al-grow', r.text), t.el, h('button.al-fb', { type: 'button', 'aria-label': 'Togli la regola', title: 'Togli', on: { click: async () => { await del(`/api/alma/regole/${r.id}`); drawRules(); } } }, ic('trash', 14)));
    }) : h('p.al-small.al-muted', 'Nessuna regola. Esempio: «Quando dico gare intendo i segnali dell\'ufficio gare».'));
  };
  const newRule = h('input.input.al-grow', { placeholder: 'Una frase che Alma segue sempre…', maxlength: 500 });
  const addRule = async () => { if (!newRule.value.trim()) return; const r = await post('/api/alma/regole', { text: newRule.value }).catch(() => null); if (r) { newRule.value = ''; drawRules(); } };
  newRule.addEventListener('keydown', e => { if (e.key === 'Enter') addRule(); });
  const regole = h('section.cv-card.al-setcard', h('div.al-lbl', 'Regole'), h('div.al-small.al-muted', 'Valgono per tutti, in ogni risposta.'), rules,
    h('div.al-row', { style: { gap: '8px' } }, newRule, h('button.btn', { type: 'button', on: { click: addRule } }, ic('plus', 15), 'Aggiungi')));

  fill(view, h('div.cv',
    h('div.cv-top', h('div.cv-top-l', h('div.cv-eyebrow', 'Impostazioni · amministratori'), h('h1.cv-h1', h('b', 'Alma'), ', l\'assistente'),
      h('p.cv-sub', 'Quanto può spendere, cosa può fare, come risponde.')),
      h('div.cv-top-r', h('a.btn', { href: '#/alma' }, ic('sparkles', 15), 'Apri Alma'))),
    h('div.al-setgrid', general, risposte, regole)));
  drawRisposte();
  drawRules();
}
