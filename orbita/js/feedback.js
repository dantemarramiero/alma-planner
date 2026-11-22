// Feedback su Alma Space (ALM2-56, artboard approvato in Alma): la finestra «Feedback su Alma Space» (dalla barra
// laterale, sul telefono da Io) e la pagina «I miei feedback» con l'esito che torna da Linear.
// Le foto dello schermo si scelgono o si incollano con Ctrl+V (Cmd+V su Mac): al massimo 3, 5 MB l'una.
import { h, fill, modal, toast, fmtDate, loading, isMobile } from './ui.js';
import { get, post } from './api.js';
import { icon } from './icons.js';

const KINDS = [
  ['tecnico', 'Problema tecnico', 'Qualcosa di Alma Space non funziona, dà errore o mostra dati sbagliati.'],
  ['procedura', 'Suggerimento sulla procedura', 'Un passaggio da cambiare, un modo più semplice di lavorare.'],
];
const KIND_LABEL = Object.fromEntries(KINDS.map(([k, l]) => [k, l]));
const OUTCOME = {
  da_valutare: ['Da valutare', 'st-todo'],
  approvato: ['Approvato', 'st-doing'],
  risolto: ['Risolto', 'st-done'],
  non_accolto: ['Non accolto', 'fb-no'],
  doppione: ['Doppione', 'st-review'],
};
const MAX_IMAGES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

// La pagina da cui si scrive: titolo e indirizzo. Da «Io» sul telefono conta la pagina di prima.
function currentPage() {
  let hash = location.hash || '#/';
  if (/^#\/io\b/.test(hash)) {
    try { const s = JSON.parse(sessionStorage.getItem('alma.backStack')) || []; hash = s[s.length - 2] || hash; } catch { /* niente */ }
  }
  const title = document.querySelector('#view h1')?.textContent?.trim() || document.title;
  return `${title} · ${hash}`.slice(0, 300);
}

const readDataUrl = file => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result));
  r.onerror = () => ko(r.error);
  r.readAsDataURL(file);
});

export function openFeedback() {
  const page = currentPage();
  let kind = 'tecnico';
  const images = []; // { name, mime, dataUrl }

  const hint = h('p.fb-hint');
  const kindBtns = KINDS.map(([k, label]) => h('button.fb-kind', { type: 'button', role: 'radio', 'data-k': k, on: { click: () => setKind(k) } }, label));
  function setKind(k) {
    kind = k;
    for (const b of kindBtns) { const on = b.dataset.k === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
    hint.textContent = KINDS.find(x => x[0] === k)[2];
  }
  const kinds = h('div.fb-kinds', { role: 'radiogroup', 'aria-label': 'Tipo di feedback', on: { keydown: e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const next = KINDS[(KINDS.findIndex(x => x[0] === kind) + 1) % KINDS.length][0];
    setKind(next);
    kindBtns.find(b => b.dataset.k === next).focus();
  } } }, kindBtns);
  setKind(kind);

  const text = h('textarea.input', { rows: 5, maxlength: 5000, autofocus: true, placeholder: 'Racconta cosa è successo o cosa cambieresti.' });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, hidden: true });
  const thumbs = h('div.fb-thumbs');
  const attach = h('button.btn.btn-ghost.btn-sm.fb-attach', { type: 'button', on: { click: () => file.click() } },
    icon('camera', { size: 16 }), h('span', 'Aggiungi una foto dello schermo'));
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const attachHelp = h('span.small.muted', { hidden: isMobile() }, `— o incollala con ${mac ? 'Cmd+V' : 'Ctrl+V'}`);

  async function addFiles(list) {
    for (const f of list) {
      if (images.length >= MAX_IMAGES) { toast(`Puoi aggiungere al massimo ${MAX_IMAGES} foto`, 'err'); break; }
      if (!EXT[f.type]) { toast('La foto dev\'essere un\'immagine PNG, JPG, WebP o GIF', 'err'); continue; }
      if (f.size > MAX_BYTES) { toast('Ogni foto può essere al massimo di 5 MB', 'err'); continue; }
      const n = images.length + 1;
      const name = f.name && f.name !== 'image.png' ? f.name : `foto-schermo${n > 1 ? `-${n}` : ''}.${EXT[f.type]}`;
      images.push({ name, mime: f.type, dataUrl: await readDataUrl(f) });
    }
    drawThumbs();
  }
  function drawThumbs() {
    fill(thumbs, images.map((img, i) => h('figure.fb-thumb',
      h('img', { src: img.dataUrl, alt: `Foto dello schermo ${i + 1}` }),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => { images.splice(i, 1); drawThumbs(); } } }, 'Togli'))));
    attach.hidden = images.length >= MAX_IMAGES;
    attachHelp.hidden = isMobile() || images.length >= MAX_IMAGES;
  }
  file.addEventListener('change', () => { addFiles([...file.files]); file.value = ''; });

  // Ctrl+V con un'immagine negli appunti (Win+Maiusc+S, Stamp): si aggiunge come una foto scelta.
  // Il testo incollato nella casella resta testo.
  function onPaste(e) {
    const items = [...(e.clipboardData?.items || [])];
    const imgs = items.filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
    if (!imgs.length) return;
    const hasText = items.some(i => i.kind === 'string' && i.type === 'text/plain');
    if (hasText && e.target === text) return;
    e.preventDefault();
    addFiles(imgs);
  }
  document.addEventListener('paste', onPaste);

  const send = h('button.btn.btn-primary', { type: 'button', on: { click: submit } }, 'Invia feedback');
  const m = modal({
    title: h('div.fb-head', h('h2', 'Feedback su Alma Space'),
      h('p.fb-sub', 'Per un problema del computer o del telefono c\'è «Segnala un problema» in Alma IT.')),
    body: h('div.fb-form',
      kinds, hint,
      h('label.field', h('span', 'Cosa succede?'), text),
      h('div.fb-attach-row', attach, attachHelp, file),
      thumbs,
      h('p.small.muted.fb-note', 'Pagina e dispositivo li aggiungiamo noi.')),
    left: [h('a.btn.btn-ghost.btn-sm', { href: '#/feedback' }, 'Vedi i miei feedback')],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), send],
    onClose: () => document.removeEventListener('paste', onPaste),
  });
  m.box.classList.add('fb-modal');

  async function submit() {
    const body = text.value.trim();
    if (body.length < 5) { toast('Scrivi in qualche parola cosa succede', 'err'); text.focus(); return; }
    send.disabled = true;
    send.textContent = 'Invio…';
    try {
      const r = await post('/api/feedback', { kind, body, page, images: images.map(i => ({ name: i.name, mime: i.mime, base64: i.dataUrl.split(',')[1] })) });
      m.close();
      toast(r.identifier
        ? `Grazie, feedback ricevuto — è il ticket ${r.identifier}. Quando Dante lo guarda ti arriva una notifica con l'esito.`
        : 'Grazie, feedback ricevuto — lo mandiamo a Dante appena possibile. Quando lo guarda ti arriva una notifica con l\'esito.', 'ok', 8000);
      document.dispatchEvent(new CustomEvent('feedback-sent'));
    } catch {
      send.disabled = false;
      send.textContent = 'Invia feedback';
    }
  }
}

// «I miei feedback»: data, tipo, testo, esito (con il motivo se non accolto) e ticket
export async function feedbackView(view) {
  fill(view, loading());
  const draw = async () => {
    const { feedback } = await get('/api/feedback/mine');
    const outcome = f => {
      const [label, cls] = OUTCOME[f.outcome] || OUTCOME.da_valutare;
      return h('span.pill', { class: cls }, h('span.dot'), label);
    };
    const reason = f => (!f.outcome_reason ? null : f.outcome === 'non_accolto' ? h('div.t-meta.fb-reason', `Motivo: ${f.outcome_reason}`)
      : f.outcome === 'doppione' ? h('div.t-meta.fb-reason', f.outcome_reason) : null);
    const empty = h('div.empty', 'Non hai ancora mandato feedback. ',
      isMobile() ? 'Lo trovi in Io › Feedback su Alma Space.' : 'Usa «Feedback su Alma Space» in fondo alla barra laterale.');
    const list = !feedback.length ? empty : isMobile()
      ? h('div.fb-cards', feedback.map(f => h('article.card.fb-card',
        h('div.fb-card-top', h('span.t-meta', `${fmtDate(f.created_at, { year: true })} · ${KIND_LABEL[f.kind]}`), outcome(f)),
        h('p.fb-text', f.body), reason(f),
        f.linear_identifier ? h('span.t-meta', f.linear_identifier) : null)))
      : h('div.table-wrap', h('table.list.fb-table',
        h('thead', h('tr', ['Data', 'Tipo', 'Cosa hai scritto', 'Esito', 'Ticket'].map(t => h('th', t)))),
        h('tbody', feedback.map(f => h('tr',
          h('td.t-meta', { style: { whiteSpace: 'nowrap' } }, fmtDate(f.created_at, { year: true })),
          h('td', KIND_LABEL[f.kind]),
          h('td.fb-cell', h('div.fb-text', f.body)),
          h('td', outcome(f), reason(f)),
          h('td.t-meta', f.linear_identifier || '—'))))));
    fill(view, h('div.narrow.fb-page',
      h('div.page-head', h('div', h('h1', 'I miei feedback'), h('p.sub', 'Quello che hai segnalato su Alma Space e com\'è andata.')),
        h('button.btn.btn-primary', { type: 'button', on: { click: openFeedback } }, 'Nuovo feedback')),
      h('div.card', list)));
  };
  await draw();
  const again = () => { if (location.hash.startsWith('#/feedback')) draw(); };
  document.addEventListener('feedback-sent', again);
  return () => document.removeEventListener('feedback-sent', again);
}
