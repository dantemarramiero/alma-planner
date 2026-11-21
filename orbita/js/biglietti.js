// Biglietti da visita (ALM2-47, canvas CRM v10).
// - #/crm/contatti/biglietti: leggere i biglietti degli altri (foto → Alma, come nella chat) e i contatti lasciati da
//   chi ha inquadrato il mio QR; a destra «Il mio biglietto».
// - #/biglietto: «Il mio biglietto» da solo (Esplora sul telefono, profilo), con «A tutto schermo» per le fiere.
import { h, fill, toast, loading, confirmDialog, isMobile, fmtDateTime } from './ui.js';
import { get, post, patch } from './api.js';
import { ic, pill, title, pageTop, tabsBar, card, emptyState, toggle, seg } from './crm-v2.js';
import { createChat } from './alma.js';

const LOGO = '/brand/almacis/almacis-logo.png';
const svgOf = markup => { const box = h('span.bv-qr'); box.innerHTML = markup; return box; }; // SVG fatto dal server (libreria qrcode)

// ── «Il mio biglietto»: anteprima, QR, azioni, numeri e cosa mostra ───────────────────────────────────
// il biglietto digitale (fronte e retro con il QR), disegnato dal server come nella pagina pubblica (Dante 21/11/2026)
function preview(d) {
  if (d.face) { const box = h('div.bv-face'); box.innerHTML = d.face; box.firstElementChild?.classList.add('bvd-stack'); return box; }
  const x = d.view;
  return h('div.bv-mini',
    h('div.bv-mini-l',
      h('img.bv-mini-logo', { src: LOGO, alt: 'Almacis', width: 806, height: 212 }),
      h('div.bv-mini-name', x.name),
      x.role ? h('div.bv-mini-role', x.role) : h('div.bv-mini-role.bv-faint', 'Ruolo: aggiungilo qui sotto o nel profilo'),
      x.unit ? h('div.bv-mini-unit', x.unit) : null,
      h('div.bv-mini-ct', [x.mobile, x.phone, x.email, 'almacis.it'].filter(Boolean).map(t => h('div', t)))),
    h('div.bv-mini-r', h('div.bv-mini-qr', svgOf(d.qr)), h('small', 'Inquadra per salvare il contatto')));
}

export function openFullscreen(d) {
  let lock = null;
  const close = () => { lock?.release?.().catch(() => {}); el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: `${d.view.name} · Almacis`, url: d.url }); } catch { /* annullato */ } return; }
    await navigator.clipboard?.writeText(d.url).then(() => toast('Link copiato')).catch(() => toast(d.url));
  };
  const el = h('div.bv-full', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Il mio biglietto a tutto schermo' },
    h('div.bv-full-top', h('button.bv-full-x', { type: 'button', 'aria-label': 'Chiudi', on: { click: close } }, ic('x', 20)), h('span.bv-full-lbl', 'Il mio biglietto'), h('span', { style: { width: '44px' } })),
    h('div.bv-full-name', d.view.name),
    d.view.role ? h('div.bv-full-role', `${d.view.role} · Almacis`) : h('div.bv-full-role', 'Almacis'),
    h('div.bv-full-qr', svgOf(d.qr)),
    h('p.bv-full-hint', 'Fai inquadrare con la fotocamera. Lo schermo resta acceso finché questa pagina è aperta.'),
    h('div.bv-full-row', h('button.bv-full-btn', { type: 'button', on: { click: share } }, ic('share', 17), 'Condividi link')));
  document.body.append(el);
  document.addEventListener('keydown', onKey);
  navigator.wakeLock?.request('screen').then(l => { lock = l; }).catch(() => {});
  el.querySelector('.bv-full-x').focus();
}

function myCardPanels(d, redraw) {
  const save = async body => {
    const r = await patch('/api/biglietto', body).catch(() => null);
    if (r) { redraw(r); toast('Biglietto aggiornato'); }
  };
  const copy = () => navigator.clipboard?.writeText(d.url).then(() => toast('Link copiato')).catch(() => toast(d.url));
  const regen = async () => {
    if (!(await confirmDialog('Creare un link nuovo? Il QR di adesso (anche quelli stampati o già mandati) smette di funzionare.', { ok: 'Rigenera il link', danger: true }))) return;
    const r = await post('/api/biglietto/rigenera', {}).catch(() => null);
    if (r) { redraw(r); toast('Link nuovo pronto: ricordati di ristampare il QR'); }
  };
  const main = card({ title: 'Il mio biglietto', icon: 'qr-code', cls: 'bv-mine' },
    h('div.bv-pad',
      preview(d),
      h('div.bv-acts',
        h('button.btn.btn-primary', { type: 'button', on: { click: () => openFullscreen(d) } }, ic('maximize', 15), 'A tutto schermo'),
        h('a.btn', { href: '/api/biglietto/qr.png', download: 'il-mio-biglietto-qr.png' }, ic('download', 15), 'Scarica QR'),
        h('button.btn', { type: 'button', on: { click: copy } }, ic('copy', 15), 'Copia link')),
      h('div.bv-link', ic('link', 15), h('a.bv-url', { href: d.url, target: '_blank', rel: 'noopener', title: 'Apri la pagina che vede chi inquadra' }, d.url.replace(/^https?:\/\//, '')),
        h('button.cv-lnk', { type: 'button', on: { click: regen } }, 'Rigenera')),
      h('div.bv-stats',
        h('div', h('b', String(d.card.scans)), h('small', 'aperture')),
        h('div', h('b', String(d.card.saves)), h('small', 'salvati in rubrica')),
        h('div', h('b', String(d.leads_total)), h('small', 'mi hanno lasciato i dati')))));

  const field = (key, label, placeholder, type = 'text', max = 120) => {
    const input = h('input.input', { type, value: d.card[key] || '', placeholder, maxlength: max, 'aria-label': label,
      on: { change: () => save({ [key]: input.value.trim() }) } });
    return h('label.bv-f', h('span', label), input);
  };
  const sw = (key, label, hintText) => {
    const t = toggle(d.card[key], null, { 'aria-label': label });
    t.input.addEventListener('change', () => save({ [key]: t.input.checked }));
    return h('div.bv-sw', h('span', label, hintText ? h('small', hintText) : null), t.el);
  };
  const what = card({ title: 'Cosa mostra il biglietto', icon: 'id-card' },
    h('div.bv-pad.bv-form',
      field('role', 'Ruolo sul biglietto', d.profile.job_title || 'es. Responsabile commerciale'),
      h('div.bv-two', field('mobile', 'Cellulare', 'es. 333 123 4567', 'tel', 40), field('phone', 'Telefono ufficio', 'es. 085 123 4567', 'tel', 40)),
      field('linkedin', 'LinkedIn', 'linkedin.com/in/…', 'text', 200),
      field('address', 'Sede', 'es. Via …, Pescara', 'text', 200),
      h('p.bv-hint', `Nome ed email vengono dal profilo (${d.profile.email})${d.profile.unit ? `, il reparto dall'organigramma (${d.profile.unit})` : ''}. Se cambiano, il biglietto si aggiorna e il QR resta lo stesso.`),
      sw('show_mobile', 'Mostra il cellulare'),
      sw('show_phone', 'Mostra il telefono dell\'ufficio'),
      sw('show_linkedin', 'Mostra LinkedIn'),
      sw('show_address', 'Mostra la sede'),
      sw('accept_leads', '«Lasciami i tuoi contatti»', 'Chi inquadra può mandarti nome, email e azienda')));
  return [main, what];
}

// ── contatti lasciati dal QR ────────────────────────────────────────────────────────────────────────
function leadCard(l, onDone) {
  const box = h('div.bv-lead');
  const who = [l.first_name, l.last_name].filter(Boolean).join(' ');
  const act = async (path, body, msg) => {
    box.querySelectorAll('button').forEach(b => { b.disabled = true; });
    const r = await post(`/api/biglietto/contatti/${l.id}/${path}`, body || {}).catch(() => null);
    if (!r) { box.querySelectorAll('button').forEach(b => { b.disabled = false; }); return; }
    if (msg || r.message) toast(r.message || msg);
    // appena confermato resta lì con «Apri la scheda» e «Annulla» (10 minuti); il resto ridisegna l'elenco
    if (path === 'conferma') box.replaceWith(leadCard(r, onDone));
    else onDone(r);
  };
  const p = l.preview || {};
  const meta = h('div.bv-lead-meta', ic('qr-code', 13), `Dal mio QR · ${fmtDateTime(l.created_at)}`);
  const head = h('div.bv-lead-head', h('b', who), pill('Dal mio QR', 'dark'), l.company ? pill(l.company, 'line') : null);
  const facts = h('dl.bv-kv', [['Email', l.email], ['Cellulare', l.mobile], ['Ruolo', l.job], ['Messaggio', l.message ? `«${l.message}»` : '']]
    .filter(([, val]) => val).flatMap(([k, val]) => [h('dt', k), h('dd', val)]));
  let body;
  if (l.status === 'confermato') {
    body = h('div.bv-lead-acts', pill('Nel CRM', 'gr'), l.contact_id ? h('a.cv-lnk', { href: `#/crm/contatti/${l.contact_id}` }, 'Apri la scheda') : null,
      l.can_undo ? h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => act('annulla', {}, 'Annullato: è di nuovo da confermare') } }, 'Annulla') : null);
  } else if (l.status === 'saltato') {
    body = h('div.bv-lead-acts', pill('Saltato', 'line'), h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => act('annulla', {}, 'Di nuovo da confermare') } }, 'Rimetti da confermare'));
  } else if (p.choices) {
    body = h('div.bv-lead-choice', h('p', p.choices.question),
      h('div.bv-lead-acts', p.choices.options.map(o => h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
        const r = await post(`/api/biglietto/contatti/${l.id}/anteprima`, { scelta: o.input }).catch(() => null);
        if (r) box.replaceWith(leadCard({ ...r, scelta: o.input }, onDone));
      } } }, o.label, o.sub ? h('small', ` · ${o.sub}`) : null)),
      h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => act('salta') } }, 'Salta')));
  } else if (p.blocked) {
    body = h('div.bv-lead-choice', h('p.bv-hint', p.blocked), h('div.bv-lead-acts', h('button.btn.btn-sm', { type: 'button', on: { click: () => act('salta', {}, 'Tolto dalla lista') } }, 'Già a posto, togli dalla lista')));
  } else {
    const plan = h('dl.bv-kv.bv-plan', (p.fields || []).flatMap(([k, val]) => [h('dt', k), h('dd', val)]));
    body = h('div',
      h('div.bv-plan-t', p.title || 'Nuovo contatto'), plan,
      (p.warnings || []).map(w => h('p.bv-warn', w)),
      h('div.bv-lead-acts',
        h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => act('conferma', l.scelta ? { scelta: l.scelta } : {}) } }, ic('check', 14), p.mode === 'aggiorna' ? 'Aggiorna il contatto' : p.mode === 'nuova' ? 'Conferma contatto e azienda' : 'Conferma contatto'),
        h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => act('salta') } }, 'Salta')));
  }
  // con la proposta pronta i dati sono già nel piano: niente doppioni
  fill(box, meta, head, l.status === 'nuovo' && p.fields ? null : facts, body);
  return box;
}

async function leadsPanel(onCount) {
  const el = h('div');
  let stato = 'nuovo';
  async function draw() {
    fill(el, loading());
    const r = await get(`/api/biglietto/contatti?stato=${stato}`).catch(() => null);
    if (!r) return fill(el);
    const c = r.counts || {};
    onCount?.(c.nuovo || 0);
    const total = (c.nuovo || 0) + (c.confermato || 0) + (c.saltato || 0);
    if (!total) return fill(el);
    const filter = seg([['nuovo', 'Da confermare', c.nuovo || 0], ['confermato', 'Confermati', c.confermato || 0], ['saltato', 'Saltati', c.saltato || 0]], stato, k => { stato = k; draw(); }, { label: 'Contatti dal QR' });
    fill(el, card({ title: 'Dal mio QR', icon: 'qr-code', count: c.nuovo || null, right: filter, cls: 'bv-leads' },
      r.leads.length ? h('div.bv-lead-list', r.leads.map(l => leadCard(l, () => draw())))
        : h('div.bv-pad', emptyState('check', stato === 'nuovo' ? 'Nessun contatto da confermare.' : 'Niente qui.'))));
  }
  await draw();
  return el;
}

// ── pagina in Contatti ──────────────────────────────────────────────────────────────────────────────
export async function bigliettiTab(box) {
  fill(box, loading());
  let d = await get('/api/biglietto');
  const tabs = h('div');
  const drawTabs = n => fill(tabs, tabsBar([['tutti', 'Tutti i contatti'], ['biglietti', 'Biglietti da visita', n || null]], 'biglietti',
    k => { location.hash = k === 'tutti' ? '#/crm/contatti' : '#/crm/contatti/biglietti'; }));
  drawTabs(d.leads_new);
  const side = h('div.cv-stack.bv-side');
  const drawSide = () => fill(side, myCardPanels(d, nd => { d = nd; drawSide(); }));
  drawSide();

  const chat = createChat({
    compact: true,
    drop: true,
    placeholder: 'Dove li hai conosciuti? (facoltativo, va nella nota)',
    welcome: ({ pick, shoot }) => h('div.bv-drop',
      h('span.bv-drop-ico', ic('id-card', 26)),
      h('div.bv-drop-t', h('b', 'Trascina qui le foto dei biglietti'), h('span', 'Più biglietti in una foto vanno bene. Alma li legge, cerca nel CRM e prepara le schede: niente si salva finché non confermi. Le foto non si salvano.')),
      h('div.bv-drop-b',
        h('button.btn', { type: 'button', on: { click: pick } }, ic('paperclip', 15), 'Scegli foto'),
        isMobile() ? h('button.btn', { type: 'button', on: { click: shoot } }, ic('camera', 15), 'Fotografa') : null)),
  });
  const reader = card({ title: 'Leggi i biglietti', icon: 'camera', cls: 'bv-reader' }, chat.el);
  const leads = await leadsPanel(n => drawTabs(n));

  fill(box,
    pageTop({ eyebrow: 'Alma CRM · Contatti', heading: title('', 'Biglietti da visita'), sub: 'Quelli che ricevi diventano contatti, il tuo lo dai con un QR' }),
    tabs,
    h('div.cv-cols.w420.bv-cols', h('div.cv-stack', leads, reader), side));
  await chat.open(null);
  if (/[?&]condivisi=/.test(location.hash)) await takeShared(chat);
}

// «Condividi» da Android (ALM2-48): il service worker ha messo le foto in «alma-condivisi»; qui le passiamo ad Alma
// (restano da mandare, come dopo «Fotografa») e svuotiamo la cache. Il parametro si toglie per non riprenderle.
async function takeShared(chat) {
  history.replaceState(null, '', location.hash.replace(/[?&]condivisi=\d+/, ''));
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('alma-condivisi');
    const info = await cache.match('/condivisi/info').then(r => (r ? r.json() : null));
    if (!info) { toast('Non sono arrivate foto: riprova a condividerle, oppure usa «Fotografa».'); return; }
    const files = [];
    for (let i = 0; i < info.foto; i += 1) {
      const r = await cache.match(`/condivisi/foto/${i}`);
      if (!r) continue;
      const blob = await r.blob();
      files.push(new File([blob], decodeURIComponent(r.headers.get('X-Nome') || `foto-${i + 1}.jpg`), { type: blob.type || 'image/jpeg' }));
    }
    await caches.delete('alma-condivisi');
    if (files.length) await chat.addPhotos(files);
    if (info.testo) chat.setText(info.testo);
    if (files.length || info.testo) chat.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); // sul telefono la chat è sotto la piega
    if (files.length) toast(files.length === 1 ? 'Foto arrivata: tocca Invia e Alma legge il biglietto' : `${files.length} foto arrivate: tocca Invia e Alma legge i biglietti`);
    else if (info.testo) toast('Testo arrivato: tocca Invia e Alma prepara il contatto');
  } catch { toast('Le foto condivise non si riescono ad aprire: usa «Scegli foto».'); }
}

// ── #/biglietto: il mio biglietto da solo ───────────────────────────────────────────────────────────
export async function mioBigliettoView(view) {
  fill(view, loading());
  let d = await get('/api/biglietto');
  const box = h('div.cv.bv-page');
  const draw = () => fill(box,
    pageTop({ eyebrow: 'Il mio biglietto', heading: title('Il mio', 'biglietto'), sub: 'Fallo inquadrare: chi lo scansiona salva il tuo contatto nel telefono',
      actions: [h('a.btn', { href: '#/crm/contatti/biglietti' }, d.leads_new ? `Contatti dal QR · ${d.leads_new}` : 'Biglietti da visita')] }),
    h('div.bv-solo', myCardPanels(d, nd => { d = nd; draw(); })));
  draw();
  fill(view, box);
  if (isMobile() && /[?&]schermo=1/.test(location.hash)) openFullscreen(d);
}
