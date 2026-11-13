// Alma Planet 2.0 sul telefono (canvas «app 2.0 per il telefono», approvato da Dante il 13/11/2026).
// Cinque posti fissi in basso: Oggi · Lavoro · + · Inbox · Esplora. Oggi risponde a «cosa devo fare adesso?» nel
// primo schermo; Lavoro mette insieme ticket, incontri e RDA; Inbox ha in cima le cose da decidere; Esplora sostituisce
// il cambio modulo; «Io» si apre dalla foto in alto. Sul computer non cambia niente.
import { h, fill, avatar, timeAgo, loading, toast, toISODate, addDays, STATUS } from './ui.js';
import { get, post, patch } from './api.js';
import { store, userById, firstName, projectById, activeProjects } from './store.js';
import { icon } from './icons.js';
import { openTicket } from './tickets.js';
import { openComposer, openPost } from './feed.js';
import { openRdaForm, openAccept, openReject } from './rda.js';
import { openGrazie } from './grazie.js';
import { mediaUrl } from './media.js';
import { placeOf } from './settimana.js';
import { sentence, open as openNotification, withoutName } from './notifications.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const todayISO = () => toISODate(new Date());
const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const go = hash => { if (location.hash === hash) rerender(); else location.hash = hash; };
const hhmm = s => String(s || '').slice(11, 16);
const dayShort = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' });
const itDay = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
// prossimo giorno lavorativo (il venerdì rimanda a lunedì)
function nextWorkday(iso = todayISO()) {
  let d = addDays(iso, 1);
  while ([0, 6].includes(new Date(`${d}T12:00:00`).getDay())) d = addDays(d, 1);
  return d;
}

// ── foglio dal basso (si chiude toccando fuori, con Esc, trascinando giù o cambiando pagina) ─────────
export function sheet(content, { label = 'Foglio', dark = false, tall = false } = {}) {
  const root = document.getElementById('overlay-root');
  root.querySelector(':scope > .sheet-backdrop')?._close();
  const prev = document.activeElement;
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    prev?.focus?.({ preventScroll: true });
  };
  const onKey = e => { if (e.key === 'Escape' && root.lastElementChild === backdrop) close(); };
  const grip = h('div.sheet-grip');
  const box = h('div.sheet.a2-sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label, class: `${dark ? 'dark' : ''} ${tall ? 'tall' : ''}`, tabIndex: -1 }, grip, content);
  const backdrop = h('div.sheet-backdrop', box);
  backdrop._close = close;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  // trascina giù dalla maniglia (o dalla cima del foglio) per chiudere
  let y0 = null, dy = 0;
  box.addEventListener('touchstart', e => { if (box.scrollTop <= 0 && e.touches.length === 1) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  box.addEventListener('touchmove', e => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    box.style.transform = dy ? `translateY(${dy}px)` : '';
  }, { passive: true });
  box.addEventListener('touchend', () => {
    if (y0 === null) return;
    y0 = null; box.style.transform = '';
    if (dy > 90) close();
  });
  document.addEventListener('keydown', onKey);
  root.append(backdrop);
  setTimeout(() => box.focus({ preventScroll: true }), 0);
  return close;
}

// ── riga che si scorre: a destra «Fatto», a sinistra «Rimanda» ───────────────────────────────────────
export function swipeRow(inner, { right, left, onTap }) {
  const fg = h('div.a2-swipe-fg', inner);
  const row = h('div.a2-swipe', h('span.a2-swipe-r', right?.label || ''), h('span.a2-swipe-l', left?.label || ''), fg);
  let x0 = null, y0 = null, dx = 0, horiz = null;
  fg.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; horiz = null; }, { passive: true });
  fg.addEventListener('touchmove', e => {
    if (x0 === null) return;
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (horiz === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) horiz = Math.abs(mx) > Math.abs(my);
    if (!horiz) return;
    dx = Math.max(left ? -140 : 0, Math.min(right ? 140 : 0, mx));
    fg.style.transform = `translateX(${dx}px)`;
    row.classList.toggle('to-right', dx > 0);
    row.classList.toggle('to-left', dx < 0);
  }, { passive: true });
  fg.addEventListener('touchend', () => {
    if (x0 === null) return;
    x0 = null;
    fg.style.transition = 'transform .18s ease';
    fg.style.transform = '';
    setTimeout(() => { fg.style.transition = ''; }, 200);
    if (dx > 90) right?.run();
    else if (dx < -90) left?.run();
    dx = 0;
  });
  fg.addEventListener('click', () => { if (!horiz) onTap?.(); });
  fg.tabIndex = 0;
  fg.setAttribute('role', 'button');
  fg.addEventListener('keydown', e => { if (e.key === 'Enter') onTap?.(); });
  return row;
}

// avviso in basso con «Annulla» (4 secondi)
function undoToast(text, undo) {
  const box = document.getElementById('toasts');
  const el = h('div.toast.a2-undo', h('span', text), h('button', { type: 'button', on: { click: async () => { el.remove(); await undo(); } } }, 'Annulla'));
  box.append(el);
  setTimeout(() => el.remove(), 4000);
}

// ── azioni sui ticket ────────────────────────────────────────────────────────────────────────────────
async function ticketDone(t, after) {
  const before = t.status;
  await patch(`/api/tickets/${t.id}`, { status: 'done' });
  after?.();
  undoToast(`«${t.title}» fatto`, async () => { await patch(`/api/tickets/${t.id}`, { status: before === 'done' ? 'todo' : before }); after?.(); });
}
async function ticketLater(t, after) {
  const before = t.due_date ? String(t.due_date).slice(0, 10) : null;
  const to = nextWorkday(before && before > todayISO() ? before : todayISO());
  await patch(`/api/tickets/${t.id}`, { due_date: to });
  after?.();
  undoToast(`Rimandato a ${itDay(to)}`, async () => { await patch(`/api/tickets/${t.id}`, { due_date: before }); after?.(); });
}

// ── scheda del ticket dal basso: tre azioni grandi, i campi come righe, i commenti ────────────────────
export async function ticketSheet(id, onChange) {
  const body = h('div.a2-ts', loading());
  const close = sheet(body, { label: 'Ticket', tall: true });
  const t = await get(`/api/tickets/${id}`).catch(() => null);
  if (!t) { close(); return; }
  const due = t.due_date ? String(t.due_date).slice(0, 10) : null;
  const late = due && due < todayISO() && t.status !== 'done';
  const kicker = t.status === 'done' ? 'TICKET · FATTO' : late ? `TICKET · SCADUTO ${due === addDays(todayISO(), -1) ? 'IERI' : `IL ${itDay(due).toUpperCase()}`}`
    : due === todayISO() ? 'TICKET · SCADE OGGI' : 'TICKET';
  const proj = projectById(t.project_id);
  const after = () => { close(); onChange?.(); };
  const full = () => { close(); openTicket(id, { onSaved: onChange }); };
  const people = (t.assignee_ids || []).map(userById).filter(Boolean);
  const comment = h('input.input.a2-ts-comment', { placeholder: 'Scrivi un commento…', maxlength: 4000,
    on: { keydown: async e => {
      if (e.key !== 'Enter' || !comment.value.trim()) return;
      await post(`/api/tickets/${id}/comments`, { body: comment.value.trim() });
      toast('Commento aggiunto'); close(); ticketSheet(id, onChange);
    } } });
  const field = (label, value, cls = '') => h('button.a2-ts-row', { type: 'button', on: { click: full } }, h('span', label), h('strong', { class: cls }, value, ' ›'));
  fill(body,
    h('div.a2-ts-head',
      h('span.a2-kicker', { class: late ? 'ko' : '' }, kicker),
      h('h2', t.title),
      h('span.a2-muted', [proj?.name, t.created_by ? `da ${userById(t.created_by)?.name || 'un collega'}` : null].filter(Boolean).join(' · '))),
    h('div.a2-ts-actions',
      t.status === 'done'
        ? h('button.a2-btn', { type: 'button', on: { click: async () => { await patch(`/api/tickets/${id}`, { status: 'todo' }); after(); } } }, 'Riapri')
        : h('button.a2-btn.ok', { type: 'button', on: { click: () => ticketDone(t, after) } }, 'Fatto'),
      h('button.a2-btn', { type: 'button', on: { click: () => ticketLater(t, after) } }, 'Rimanda'),
      h('button.a2-btn', { type: 'button', on: { click: full } }, 'Assegna')),
    h('div.a2-card.a2-ts-fields',
      field('Stato', STATUS[t.status] || t.status),
      field('Scadenza', due ? itDay(due) : 'nessuna', late ? 'ko' : ''),
      field('Persone', people.length ? people.map(u => u.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()).join(' · ') : 'nessuno'),
      t.hours_estimated ? field('Ore', `${Number(t.hours_estimated).toLocaleString('it-IT')} h`) : null),
    t.description ? h('p.a2-ts-desc', t.description) : null,
    (t.comments || []).length ? [h('strong.a2-ts-sub', 'Attività'),
      h('div.a2-ts-log', (t.comments || []).slice(-3).reverse().map(c => h('span', h('strong', c.user_name || 'Qualcuno'), `: «${c.body.length > 140 ? `${c.body.slice(0, 140)}…` : c.body}» · ${timeAgo(c.created_at)}`)))] : null,
    h('button.a2-link', { type: 'button', on: { click: full } }, 'Apri il ticket intero'),
    comment);
}

// ═══ «+»: crea qualsiasi cosa, da qualsiasi schermata ═══════════════════════════════════════════════
const PLUS = [
  ['ticket', 'Ticket', '#FFF1E5', '#B54E0A', 'square-check'],
  ['rda', 'RDA', '#FFF7DB', '#8A6500', 'arrows'],
  ['it', 'Segnala IT', '#E8F0F7', '#2F6FA3', 'life-buoy'],
  ['post', 'Post', '#E7F5EC', '#1F6A41', 'pencil'],
  ['mezzo', 'Prenota mezzo', '#F1EFEB', '#2C2C2C', 'car'],
  ['idea', 'Idea', '#F3ECFA', '#6A4A96', 'lightbulb'],
];
export function openPlus() {
  const pid = Number((location.hash.match(/^#\/projects\/(\d+)/) || [])[1]) || null; // dentro un progetto: già scelto
  const state = { due: nextWorkday(), project: pid };
  const DUES = [[todayISO(), 'Oggi'], [nextWorkday(), 'Domani'], [null, 'Senza data']];
  const title = h('input.input.a2-quick-in', { placeholder: 'Scrivi una cosa da fare…', maxlength: 200, 'aria-label': 'Titolo del ticket' });
  const duePill = h('button.a2-chip', { type: 'button' });
  const drawDue = () => { duePill.textContent = (DUES.find(([d]) => d === state.due) || [null, itDay(state.due)])[1]; };
  duePill.addEventListener('click', () => { const i = DUES.findIndex(([d]) => d === state.due); state.due = DUES[(i + 1) % DUES.length][0]; drawDue(); });
  drawDue();
  const projSel = h('select.a2-chip.a2-chip-sel', { 'aria-label': 'Progetto', on: { change: e => { state.project = Number(e.target.value) || null; } } },
    h('option', { value: '' }, 'Nessun progetto'),
    activeProjects().map(p => h('option', { value: String(p.id), selected: p.id === pid }, p.name)));
  const create = async () => {
    if (!title.value.trim()) { title.focus(); return; }
    const t = await post('/api/tickets', { title: title.value.trim(), assignee_ids: [store.me.id], due_date: state.due, project_id: state.project });
    close();
    toast('Ticket creato');
    if (location.hash.startsWith('#/lavoro') || location.hash.startsWith('#/benvenuto')) rerender();
    return t;
  };
  title.addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
  const act = key => {
    close();
    if (key === 'ticket') openTicket(null, { defaults: { assignee_ids: [store.me.id], ...(pid ? { project_id: pid } : {}) }, onSaved: rerender });
    if (key === 'rda') openRdaForm({ onDone: rerender });
    if (key === 'it') go('#/it/strumenti?azione=segnala');
    if (key === 'post') openComposer({ onCreated: () => go('#/') });
    if (key === 'mezzo') go('#/mezzi/prenota');
    if (key === 'idea') go('#/idee?new=1');
  };
  const close = sheet(h('div.a2-plus',
    h('h2.a2-sheet-title', 'Crea'),
    h('div.a2-plus-grid', PLUS.map(([key, label, bg, fg, ico]) => h('button.a2-plus-opt', { type: 'button', on: { click: () => act(key) } },
      h('span.a2-plus-ico', { style: { background: bg, color: fg } }, icon(ico, { size: 20 })), label))),
    h('span.a2-section', 'Ticket veloce'),
    h('div.a2-card.a2-quick', title, h('div.a2-chips', h('span.a2-chip.on', 'Per me'), duePill, projSel)),
    h('button.a2-btn.primary.wide', { type: 'button', on: { click: create } }, 'Crea ticket')), { label: 'Crea' });
}

// ═══ Oggi ═══════════════════════════════════════════════════════════════════════════════════════════
function greeting() {
  const hr = new Date().getHours();
  return hr < 13 ? 'Buongiorno' : hr < 18 ? 'Buon pomeriggio' : 'Buonasera';
}
function progressAt(p, iso) {
  let act = 0, exp = 0;
  for (const t of p.tasks || []) {
    if (t.closed_date && t.closed_date <= iso) act += t.weight;
    if (t.due_date && t.due_date <= iso) exp += t.weight;
  }
  return { act, exp, ok: act >= exp };
}
const surname = n => String(n || '').trim().split(/\s+/).pop().toLowerCase();

// intestazione grande comune ai cinque posti: titolo e, a destra, cerca e la mia foto («Io»)
function bigHead(title, { kicker, right } = {}) {
  return h('header.a2-head',
    h('div.a2-head-t', kicker ? h('span.a2-eyebrow', kicker) : null, h('h1.a2-title', title)),
    h('div.a2-head-r', right || null,
      h('a.a2-round', { href: '#/search', 'aria-label': 'Cerca' }, icon('search', { size: 18 })),
      h('a.a2-me', { href: '#/io', 'aria-label': 'Io: profilo e impostazioni' }, avatar(store.me, 38))));
}

export async function oggiView(view) {
  fill(view, loading());
  const today = todayISO();
  const year = new Date().getFullYear();
  const [home, hk, rda, invites, cal] = await Promise.all([
    get('/api/welcome/home'),
    get(`/api/strategy?year=${year}`, { quiet: true }).catch(() => null),
    get('/api/rda', { quiet: true }).catch(() => ({ inbox: [] })),
    get('/api/strategy/invites', { quiet: true }).catch(() => []),
    get(`/api/calendar?start=${today}T00:00:00&end=${today}T23:59:59`, { quiet: true }).catch(() => null),
  ]);
  const reload = () => oggiView(view);
  const my = home.my;
  const dateLabel = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();

  // prossimo incontro
  const now = new Date();
  const meetings = (cal?.events || []).filter(e => !e.allDay).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const nextIdx = meetings.findIndex(e => new Date(e.end || e.start) > now);
  const next = nextIdx >= 0 ? meetings[nextIdx] : null;
  let meetCard = null;
  if (next) {
    const mins = Math.round((new Date(next.start) - now) / 60000);
    const when = mins <= 0 ? `IN CORSO · ${hhmm(next.start)}` : mins < 60 ? `TRA ${mins} MINUTI · ${hhmm(next.start)}` : `ALLE ${hhmm(next.start)}`;
    const rest = meetings.length - nextIdx - 1;
    meetCard = h('section.a2-card.a2-meet',
      h('span.a2-kicker.blue', when),
      h('strong.a2-meet-t', next.title || 'Incontro'),
      h('div.a2-meet-row',
        h('span.a2-muted', [next.onlineUrl ? 'Riunione Teams' : placeOf(next.location) || null, rest ? `poi ${plural(rest, 'altro incontro', 'altri incontri')}` : null].filter(Boolean).join(' · ')),
        next.onlineUrl ? h('a.a2-pill-btn.blue', { href: next.onlineUrl, target: '_blank', rel: 'noopener' }, 'Entra') : h('a.a2-pill-btn.ghost', { href: '#/settimana' }, 'Apri')));
  } else if (cal && !cal.outlookError) {
    meetCard = h('section.a2-card.a2-meet.calm', h('span.a2-kicker.blue', 'OGGI'), h('strong.a2-meet-t', meetings.length ? 'Incontri finiti per oggi' : 'Nessun incontro oggi'));
  }

  // da fare ora: ticket scaduti o in scadenza oggi, RDA da decidere, inviti agli A3
  const now3 = [];
  for (const t of my.tickets.filter(x => x.due_date && String(x.due_date).slice(0, 10) <= today)) {
    const due = String(t.due_date).slice(0, 10);
    now3.push(h('div.a2-now', { class: 'red' },
      h('span.a2-kicker.ko', due < today ? 'IN RITARDO · TICKET' : 'SCADE OGGI · TICKET'),
      h('button.a2-now-t', { type: 'button', on: { click: () => ticketSheet(t.id, reload) } }, t.title),
      h('span.a2-muted.small', t.project || 'Senza progetto'),
      h('span.a2-now-btns',
        h('button.a2-btn.ok.sm', { type: 'button', on: { click: () => ticketDone(t, reload) } }, 'Fatto'),
        h('button.a2-btn.sm', { type: 'button', on: { click: () => ticketLater(t, reload) } }, 'Domani'))));
  }
  for (const t of rda.inbox || []) {
    now3.push(h('a.a2-now', { class: 'amber', href: '#/inbox' },
      h('span.a2-kicker.amber', 'DA DECIDERE · RDA'), h('strong.a2-now-t', t.title),
      h('span.a2-muted.small', [`da ${userById(t.created_by)?.name || 'un collega'}`, t.hours_estimated ? `${Number(t.hours_estimated).toLocaleString('it-IT')} h` : null].filter(Boolean).join(' · '))));
  }
  for (const i of invites || []) {
    now3.push(h('a.a2-now', { class: 'orange', href: `#/strategy/invito/${i.id}` },
      h('span.a2-kicker.orange', 'INVITO · A3'), h('strong.a2-now-t', i.a3_name), h('span.a2-muted.small', i.invited_by_name ? `da ${i.invited_by_name}` : '')));
  }
  const total = my.open + (rda.inbox || []).length + (invites || []).length;
  const nowBlock = h('section.a2-block',
    h('div.a2-row-head', h('h2', 'Da fare ora'), h('a', { href: '#/lavoro' }, `Tutto (${total})`)),
    now3.length ? h('div.a2-carousel', now3.slice(0, 6))
      : h('div.a2-card.a2-calm', h('span.a2-ok-ico', icon('check', { size: 18 })), h('span', h('strong', 'Niente in scadenza oggi'), h('small.a2-muted', my.open ? `${plural(my.open, 'ticket aperto', 'ticket aperti')} in Lavoro` : 'Tutto fatto')))) ;

  // azioni rapide
  const pillars = hk?.pillars || [];
  const quick = (label, ico, on) => h(typeof on === 'string' ? 'a.a2-qa' : 'button.a2-qa', typeof on === 'string' ? { href: on } : { type: 'button', on: { click: on } },
    h('span.a2-qa-ico', icon(ico, { size: 22 })), h('span', label));
  const quickRow = h('nav.a2-qas', { 'aria-label': 'Azioni rapide' },
    quick('Segnala IT', 'life-buoy', '#/it/strumenti?azione=segnala'),
    quick('Nuova RDA', 'arrows', () => openRdaForm({ onDone: reload })),
    quick('Prenota mezzo', 'car', '#/mezzi/prenota'),
    quick('Ringrazia', 'heart', () => openGrazie(pillars, reload)));

  // polso della strategia: una riga; toccandola sale il foglio con True North, pillar e i miei A3
  let pulse = null;
  if (hk?.projects?.length || hk?.true_north) {
    const st = (hk.projects || []).map(p => progressAt(p, home.today));
    const okN = st.filter(x => x.ok).length;
    const avg = st.length ? Math.round(st.reduce((s, x) => s + x.act, 0) / st.length) : 0;
    const mine = (hk.projects || []).filter(p => surname(p.owner) && surname(p.owner) === surname(store.me.name));
    const mineLate = mine.filter(p => !progressAt(p, home.today).ok).length;
    const openTN = () => sheet(h('div.a2-tn',
      h('span.a2-kicker.orange', `TRUE NORTH · HOSHIN KANRI ${hk.year || year}`),
      h('p.a2-tn-text', hk.true_north ? `“${hk.true_north}”` : 'Il True North non è ancora scritto.'),
      h('div.a2-tn-pillars', pillars.map(p => h('span', { style: { '--pc': p.color || '#FF8A26' } }, p.name))),
      h('div.a2-tn-nums',
        h('span', h('small', 'A3 in linea'), h('strong.ok', `${okN} su ${st.length}`)),
        h('span', h('small', 'Avanzamento'), h('strong', `${avg}%`)),
        h('span', h('small', 'I miei A3'), h('strong.orange', mine.length ? `${mine.length}${mineLate ? ` · ${mineLate} in ritardo` : ''}` : '—'))),
      h('a.a2-btn.orange.wide', { href: '#/strategy/hoshin' }, 'Apri l’Hoshin Kanri')), { label: 'True North', dark: true });
    pulse = h('button.a2-pulse', { type: 'button', on: { click: openTN } },
      h('span.a2-pulse-t', h('span.a2-kicker.orange', `HOSHIN KANRI ${hk.year || year}`), h('span', h('strong', `${okN} su ${st.length}`), ' A3 in linea · ', h('strong', `${avg}%`))),
      h('span.a2-pulse-bar', h('i', { style: { width: `${Math.min(100, avg)}%` } })),
      h('span', { 'aria-hidden': 'true' }, '›'));
  }

  // scorrendo: la giornata, una news, le persone di oggi, il sondaggio
  const dayItems = [
    ...meetings.map(e => ({ at: hhmm(e.start), title: e.title || 'Incontro', sub: e.onlineUrl ? 'Teams' : placeOf(e.location) || '', kind: 'meet' })),
    ...my.tickets.filter(t => t.due_date && String(t.due_date).slice(0, 10) === today).map(t => ({ at: '18:00', title: t.title, sub: t.project || '', kind: 'due', id: t.id })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const dayBox = dayItems.length ? h('section.a2-card.a2-day', h('strong', 'La giornata'),
    h('div.a2-day-list', dayItems.map(x => [h('strong.a2-day-h', { class: x.kind === 'due' ? 'ko' : '' }, x.kind === 'due' ? 'scade' : x.at),
      h('span', h('strong', x.title), x.sub ? h('small.a2-muted', x.sub) : null)]))) : null;
  const news = home.news[0];
  const newsBox = news ? h('button.a2-card.a2-news', { type: 'button', on: { click: () => openPost(news.id) } },
    news.media_id ? h('img', { src: mediaUrl(news.media_id), alt: '', loading: 'lazy' }) : null,
    h('span.a2-news-b', h('span.a2-kicker.orange', 'NEWS AZIENDALE'), h('strong', news.body.length > 120 ? `${news.body.slice(0, 120)}…` : news.body),
      h('small.a2-muted', `♡ ${news.likes || 0} · ${plural(news.comments || 0, 'commento', 'commenti')}`))) : null;
  const ppl = home.people;
  const chips = [
    ...ppl.birthdays.filter(p => p.in_days === 0).map(p => h('a.a2-pchip.orange', { href: `#/u/${p.id}` }, `Compleanno: ${p.name}`)),
    ...ppl.arrivals.slice(0, 3).map(p => h('a.a2-pchip.green', { href: `#/u/${p.id}` }, `Benvenuto: ${p.name}`)),
    ...ppl.anniversaries.filter(p => p.in_days === 0).map(p => h('a.a2-pchip.blue', { href: `#/u/${p.id}` }, `${plural(p.years, 'anno', 'anni')}: ${p.name}`)),
  ];
  const peopleBox = chips.length ? h('section.a2-card', h('strong', 'Persone oggi'), h('div.a2-pchips', chips)) : null;
  const pollBox = h('section.a2-card.a2-poll');
  const drawPoll = poll => {
    if (!poll) { pollBox.remove(); return; }
    const voted = poll.my_vote !== null;
    fill(pollBox, h('strong', poll.question), poll.options.map((o, i) => {
      const pct = poll.total ? Math.round(poll.counts[i] * 100 / poll.total) : 0;
      return h('button.a2-opt', { type: 'button', disabled: !poll.open, class: poll.my_vote === i ? 'on' : '', 'aria-pressed': String(poll.my_vote === i),
        on: { click: async () => drawPoll(await post(`/api/welcome/polls/${poll.id}/vote`, { choice: i })) } },
      voted ? h('i', { style: { width: `${pct}%` } }) : null, h('span', o), voted ? h('b', `${pct}%`) : null);
    }), h('small.a2-muted', plural(poll.total, 'risposta', 'risposte')));
  };
  drawPoll(home.poll);

  fill(view, h('div.a2-page.a2-oggi',
    bigHead(h('span', `${greeting()}, `, h('strong', firstName(store.me))), { kicker: dateLabel }),
    meetCard, nowBlock, quickRow, pulse,
    h('div.a2-more', dayBox, newsBox, peopleBox, home.poll ? pollBox : null)));
}

// ═══ Lavoro ═════════════════════════════════════════════════════════════════════════════════════════
const WORK_PILLS = [['', 'Miei'], ['#/settimana', 'Settimana'], ['#/tickets?di=tutti', 'Di tutti'], ['#/rda', 'RDA'], ['#/projects', 'Progetti'], ['#/mezzi', 'Mezzi'], ['#/calendar', 'Calendario']];
export async function lavoroView(view, params) {
  fill(view, loading());
  const today = todayISO();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('giorno') || '') ? params.get('giorno') : today;
  const dow = (new Date(`${today}T12:00:00`).getDay() + 6) % 7;
  const monday = addDays(today, -dow);
  const week = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(monday, i));
  const [tickets, rda, cal] = await Promise.all([
    get('/api/tickets?assignee=me&status=open'),
    get('/api/rda', { quiet: true }).catch(() => ({ inbox: [] })),
    get(`/api/calendar?start=${day}T00:00:00&end=${day}T23:59:59`, { quiet: true }).catch(() => null),
  ]);
  const reload = () => lavoroView(view, params);
  const live = tickets.filter(t => !t.rda_state || t.rda_state === 'accepted');
  const dueOf = t => (t.due_date ? String(t.due_date).slice(0, 10) : null);
  const row = t => {
    const due = dueOf(t);
    const proj = projectById(t.project_id);
    return swipeRow(h('div.a2-item', { class: due && due < today ? 'late' : '' },
      h('span.a2-item-t', h('strong', t.title), h('small.a2-muted', [proj?.name, due ? (due < today ? `scaduto ${itDay(due)}` : due === today ? 'oggi' : itDay(due)) : null].filter(Boolean).join(' · '))),
      t.status === 'doing' ? h('span.a2-st.orange', 'In corso') : t.status === 'review' ? h('span.a2-st.blue', 'In revisione') : null), {
      right: { label: '✓ Fatto', run: () => ticketDone(t, reload) },
      left: { label: 'Rimanda', run: () => ticketLater(t, reload) },
      onTap: () => ticketSheet(t.id, reload),
    });
  };
  const meetRow = e => h('a.a2-item', { href: e.onlineUrl || '#/settimana', ...(e.onlineUrl ? { target: '_blank', rel: 'noopener' } : {}) },
    h('span.a2-item-t', h('strong', e.title || 'Incontro'), h('small.blue', `Incontro · ${hhmm(e.start)}`)), h('small.a2-muted', e.onlineUrl ? 'Teams' : placeOf(e.location) || ''));
  const rdaRow = t => h('a.a2-item', { href: '#/inbox' },
    h('span.a2-item-t', h('strong', t.title), h('small.a2-muted', 'RDA · aspetta te')), h('span.a2-st.amber', 'Da decidere'));
  const group = (label, rows, cls = '') => rows.length ? [h('span.a2-section', { class: cls }, `${label} · ${rows.length}`), h('div.a2-list', rows)] : [];
  const meetings = (cal?.events || []).filter(e => !e.allDay).sort((a, b) => String(a.start).localeCompare(String(b.start)));

  let lists;
  if (day === today) {
    const late = live.filter(t => dueOf(t) && dueOf(t) < today);
    const now = live.filter(t => dueOf(t) === today);
    const nextDays = live.filter(t => dueOf(t) && dueOf(t) > today).sort((a, b) => dueOf(a).localeCompare(dueOf(b)));
    const noDate = live.filter(t => !dueOf(t));
    lists = [
      ...group('In ritardo', late.map(row), 'ko'),
      ...group('Oggi', [...meetings.map(meetRow), ...now.map(row), ...(rda.inbox || []).map(rdaRow)]),
      ...group('Prossimi giorni', nextDays.slice(0, 30).map(row)),
      ...group('Senza data', noDate.slice(0, 30).map(row)),
    ];
  } else {
    lists = group(itDay(day), [...meetings.map(meetRow), ...live.filter(t => dueOf(t) === day).map(row)]);
  }
  if (!lists.length) lists = [h('div.a2-empty', h('span.a2-ok-ico', icon('check', { size: 22 })), h('strong', 'Tutto fatto'), h('small.a2-muted', 'Niente in programma qui.'))];

  fill(view, h('div.a2-page.a2-lavoro',
    bigHead('Lavoro'),
    h('nav.a2-pills', { 'aria-label': 'Viste del lavoro' }, WORK_PILLS.map(([href, label]) => href
      ? h('a.a2-pill', { href }, label)
      : h('a.a2-pill.on', { href: '#/lavoro', 'aria-current': 'page' }, `${label} · ${live.length}`))),
    h('nav.a2-days', { 'aria-label': 'Giorno' }, week.map(d => h('a.a2-dayb', {
      href: d === today ? '#/lavoro' : `#/lavoro?giorno=${d}`, class: `${d === day ? 'on' : ''} ${d < today ? 'past' : ''} ${[5, 6].includes(week.indexOf(d)) ? 'we' : ''}`,
      'aria-current': d === day ? 'date' : null,
    }, h('small', ['L', 'M', 'M', 'G', 'V', 'S', 'D'][week.indexOf(d)]), h('strong', String(Number(d.slice(8))))))),
    h('p.a2-hint', 'Scorri a destra per «fatto», a sinistra per rimandare.'),
    lists));
}

// ═══ Inbox ══════════════════════════════════════════════════════════════════════════════════════════
export async function inboxView(view) {
  fill(view, loading());
  const [rda, invites, notes, itReqs] = await Promise.all([
    get('/api/rda', { quiet: true }).catch(() => ({ inbox: [] })),
    get('/api/strategy/invites', { quiet: true }).catch(() => []),
    get('/api/notifications'),
    store.me.software ? get('/api/software/requests?status=da_rispondere', { quiet: true }).catch(() => []) : [],
  ]);
  const reload = () => { document.dispatchEvent(new Event('badges-changed')); inboxView(view); };
  const decide = [];
  const card = (who, title, sub, buttons, href) => h(href ? 'a.a2-card.a2-dec' : 'div.a2-card.a2-dec', href ? { href } : {},
    h('div.a2-dec-top', who, h('span.a2-item-t', h('strong', title), sub ? h('small.a2-muted', sub) : null), href ? h('span.a2-link-t', 'Entra') : null),
    buttons ? h('div.a2-dec-btns', buttons) : null);
  for (const t of rda.inbox || []) {
    const u = userById(t.created_by);
    decide.push(card(avatar(u || { name: '?' }, 36), `RDA: ${t.title}`,
      [u?.name, t.hours_estimated ? `${Number(t.hours_estimated).toLocaleString('it-IT')} h` : null, t.rda_function].filter(Boolean).join(' · '),
      [h('button.a2-btn.ok.sm', { type: 'button', on: { click: () => openAccept(t, reload) } }, 'Accetta'),
        h('button.a2-btn.sm', { type: 'button', on: { click: () => openReject(t, reload) } }, 'Rifiuta')]));
  }
  for (const r of itReqs || []) {
    const answer = async ok => { await post(`/api/software/requests/${r.id}/${ok ? 'accept' : 'reject'}`, { answer: '' }); toast(ok ? 'Richiesta approvata' : 'Richiesta rifiutata'); reload(); };
    decide.push(card(h('span.a2-dot-ico.blue', icon('monitor', { size: 16 })), `Richiesta IT: ${r.software_name || r.plan_software || 'software'}`,
      [r.person_name || r.user_name, r.job_title].filter(Boolean).join(' · '),
      [h('button.a2-btn.ok.sm', { type: 'button', on: { click: () => answer(true) } }, 'Approva'),
        h('button.a2-btn.sm', { type: 'button', on: { click: () => answer(false) } }, 'Rifiuta')]));
  }
  for (const i of invites || []) {
    decide.push(card(h('span.a2-dot-ico.orange', 'A3'), `Invito all’A3 ${i.a3_name}`, i.invited_by_name ? `da ${i.invited_by_name}` : '', null, `#/strategy/invito/${i.id}`));
  }

  // notifiche per giorno
  const today = todayISO(), yesterday = addDays(today, -1);
  const groups = new Map();
  for (const n of notes) {
    const d = toISODate(new Date(n.created_at));
    const key = d === today ? 'Oggi' : d === yesterday ? 'Ieri' : 'Prima';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  const nRow = n => {
    const u = userById(n.actor_id);
    const text = withoutName(sentence(n), u?.name);
    return h('button.a2-note', { type: 'button', class: n.read_at ? '' : 'new', on: { click: () => openNotification(n) } },
      h('span.a2-note-dot'),
      h('span.a2-note-t', u ? [h('strong', u.name), ' '] : null, text || n.body || '', h('small', timeAgo(n.created_at))));
  };
  const unread = notes.some(n => !n.read_at);
  fill(view, h('div.a2-page.a2-inbox',
    bigHead('Inbox', { right: unread ? h('button.a2-textbtn', { type: 'button', on: { click: async () => { await post('/api/notifications/read', {}); reload(); } } }, 'Segna tutto letto') : null }),
    decide.length ? [h('span.a2-section.amber', `Da decidere · ${decide.length}`), h('div.a2-list', decide)] : null,
    [...groups].map(([k, list]) => [h('span.a2-section', k), h('div.a2-card.a2-notes', list.slice(0, 40).map(nRow))]),
    !decide.length && !notes.length ? h('div.a2-empty', h('span.a2-ok-ico', icon('check', { size: 22 })), h('strong', 'Tutto letto'), h('small.a2-muted', 'Qui arrivano le cose da decidere e le notifiche.')) : null,
    h('a.a2-link.center', { href: '#/notifiche/impostazioni' }, 'Quali notifiche ricevo')));
}

// ═══ Esplora ════════════════════════════════════════════════════════════════════════════════════════
const RECENT_KEY = 'alma.recent';
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
// gli ultimi aperti: progetti, A3, persone, opportunità, idee (il titolo è l'h1 della pagina)
export function trackRecent() {
  const hash = location.hash;
  if (!/^#\/(projects\/\d+|strategy\/a3\/\d+|u\/\d+|energy\/opportunita\/\d+|idee\/\d+|crm\/scheda\/)/.test(hash)) return;
  setTimeout(() => {
    const label = document.querySelector('#view h1')?.textContent?.trim() || document.querySelector('#view h2')?.textContent?.trim();
    if (!label) return;
    const base = hash.replace(/^(#\/projects\/\d+).*$/, '$1');
    const list = [{ hash: base, label: label.slice(0, 60) }, ...readRecent().filter(x => x.hash !== base)].slice(0, 6);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* niente */ }
  }, 900);
}

export function esploraView(view) {
  const q = h('input.input.a2-search-in', { type: 'search', placeholder: 'Cerca persone, progetti, ticket, file…', 'aria-label': 'Cerca',
    on: { keydown: e => { if (e.key === 'Enter' && q.value.trim()) location.hash = `#/search?q=${encodeURIComponent(q.value.trim())}`; } } });
  const tile = (href, label, ico, bg, fg) => h('a.a2-tile', { href }, h('span.a2-tile-ico', { style: { background: bg, color: fg } }, icon(ico, { size: 20 })), label);
  const line = (href, label, ico, ext) => h('a.a2-line', { href, ...(ext ? { target: '_blank', rel: 'noopener' } : {}) }, h('span.a2-line-ico', icon(ico, { size: 18 })), h('span', label), h('span.a2-muted', ext ? '↗' : '›'));
  const recent = readRecent();
  fill(view, h('div.a2-page.a2-esplora',
    bigHead('Esplora'),
    h('label.a2-search', icon('search', { size: 16 }), q),
    h('span.a2-section', 'Almacis'),
    h('nav.a2-tiles',
      tile('#/', 'Bacheca', 'layout-dashboard', '#FFF1E5', '#B54E0A'),
      tile('#/persone', 'Persone', 'users', '#E8F0F7', '#2F6FA3'),
      tile('#/idee', 'Idee', 'lightbulb', '#F3ECFA', '#6A4A96'),
      tile('#/strategy/hoshin', 'Strategy', 'target', '#2C2C2C', '#FFB27A'),
      tile('#/projects', 'Progetti', 'folder', '#E7F5EC', '#1F6A41'),
      tile('#/mezzi', 'Mezzi', 'car', '#F1EFEB', '#2C2C2C')),
    h('span.a2-section', 'Strumenti'),
    h('nav.a2-card.a2-lines',
      store.me.energy ? line('#/energy/vicino', 'Alma Energy', 'zap') : null,
      store.me.crm ? line('#/crm/lead', 'CRM', 'contact') : null,
      line('#/strategy/a3', 'I miei A3 e obiettivi', 'file-text'),
      line('#/it/strumenti', 'IT e software', 'monitor'),
      line('#/calendar', 'Calendario', 'calendar'),
      line('#/drive', 'OneDrive', 'cloud'),
      line('#/direct', 'Chat (Teams)', 'message')),
    recent.length ? [h('span.a2-section', 'Aperti di recente'), h('div.a2-pchips', recent.map(r => h('a.a2-pchip', { href: r.hash }, r.label)))] : null));
}

// ═══ Io ═════════════════════════════════════════════════════════════════════════════════════════════
const THEME_KEY = 'alma.theme';
const THEMES = [['auto', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']];
export function applyTheme() {
  let t = 'auto';
  try { t = localStorage.getItem(THEME_KEY) || 'auto'; } catch { /* niente */ }
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  return t;
}

export async function ioView(view) {
  fill(view, loading());
  const today = todayISO();
  const dow = (new Date(`${today}T12:00:00`).getDay() + 6) % 7;
  const mon = addDays(today, -dow), sun = addDays(mon, 6);
  const [home, cal, push] = await Promise.all([
    get('/api/welcome/home'),
    get(`/api/calendar?start=${mon}T00:00:00&end=${sun}T23:59:59`, { quiet: true }).catch(() => null),
    import('./pwa.js').then(m => m.pushState()).catch(() => 'unsupported'),
  ]);
  const me = userById(store.me.id) || store.me;
  const grazie = home.grazie.filter(g => g.thanked_id === store.me.id).length;
  const meets = (cal?.events || []).filter(e => !e.allDay).length;
  const PUSH = { on: ['Notifiche attive', 'ok'], off: ['Da attivare', ''], denied: ['Bloccate nel telefono', 'ko'], install: ['Aggiungi l’app alla Home', ''], unsupported: ['Non disponibili qui', ''] };
  const [pushLabel, pushCls] = PUSH[push] || PUSH.unsupported;
  const theme = applyTheme();
  const themeBtn = h('button.a2-line', { type: 'button', on: { click: () => {
    const i = THEMES.findIndex(([k]) => k === applyTheme());
    const next = THEMES[(i + 1) % THEMES.length][0];
    try { localStorage.setItem(THEME_KEY, next); } catch { /* niente */ }
    applyTheme();
    themeVal.textContent = `${THEMES.find(([k]) => k === next)[1]} ›`;
  } } }, h('span.a2-line-ico', icon('settings', { size: 18 })), h('span', 'Tema'));
  const themeVal = h('span.a2-muted', `${THEMES.find(([k]) => k === theme)[1]} ›`);
  themeBtn.append(themeVal);
  const line = (href, label, ico, right) => h('a.a2-line', { href }, h('span.a2-line-ico', icon(ico, { size: 18 })), h('span', label), right || h('span.a2-muted', '›'));
  fill(view, h('div.a2-page.a2-io',
    h('button.a2-textbtn', { type: 'button', style: { alignSelf: 'flex-start' }, on: { click: () => document.getElementById('back').click() } }, '‹ Indietro'),
    h('div.a2-io-top', avatar(me, 84), h('strong', me.name), h('span.a2-muted', [me.job_title, me.department].filter(Boolean).join(' · ') || me.email)),
    h('div.a2-nums',
      h('a', { href: '#/lavoro' }, h('strong', String(home.my.open)), h('small', 'ticket aperti')),
      h('a', { href: '#/settimana' }, h('strong', cal ? String(meets) : '–'), h('small', 'incontri questa settimana')),
      h('span', h('strong.orange', String(grazie)), h('small', 'grazie in 30 giorni'))),
    h('nav.a2-card.a2-lines',
      line(`#/u/${store.me.id}`, 'Il mio profilo', 'user'),
      line('#/strategy/obiettivi', 'Il mio contributo', 'target'),
      line('#/notifiche/impostazioni', 'Le mie notifiche', 'bell'),
      line('#/notifiche/impostazioni', 'Il mio telefono', 'phone', h('span', { class: `a2-st ${pushCls === 'ok' ? 'green' : pushCls === 'ko' ? 'red' : 'grey'}` }, pushLabel)),
      themeBtn),
    h('nav.a2-card.a2-lines',
      h('button.a2-line.danger', { type: 'button', on: { click: async () => { await post('/auth/logout'); location.href = '/'; } } }, h('span.a2-line-ico', icon('log-out', { size: 18 })), h('span', 'Esci')))));
}

// ═══ barra in basso e barra in alto ═════════════════════════════════════════════════════════════════
const ROOTS = { benvenuto: 'oggi', lavoro: 'lavoro', inbox: 'inbox', esplora: 'esplora', io: 'io' };
const WORK = new Set(['lavoro', 'settimana', 'tickets', 'mine', 'rda', 'projects', 'gantt', 'calendar', 'mezzi']);
export function placeOfSection(section) {
  if (section === 'benvenuto') return 'oggi';
  if (WORK.has(section)) return 'lavoro';
  if (section === 'inbox' || section === 'notifications') return 'inbox';
  if (section === 'io') return '';
  return 'esplora';
}
export const isRoot = section => Boolean(ROOTS[section]);

export function drawBar() {
  const bar = document.getElementById('m-tabs');
  if (!bar || bar.dataset.v2) return;
  bar.dataset.v2 = '1';
  bar.setAttribute('aria-label', 'Alma Planet');
  const tab = (href, key, ico, label, badge) => h('a.m-tab', { href, 'data-place': key, on: { click: e => {
    if (location.hash === href) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); rerender(); }
  } } }, h('span.m-tab-ico', icon(ico, { size: 23 }), badge || null), h('span', label));
  bar.style.setProperty('--n', '5');
  bar.replaceChildren(
    tab('#/benvenuto', 'oggi', 'house', 'Oggi'),
    tab('#/lavoro', 'lavoro', 'square-check', 'Lavoro'),
    h('button.m-tab.m-plus2', { type: 'button', 'aria-label': 'Crea', on: { click: openPlus } }, h('span', icon('plus', { size: 26 }))),
    tab('#/inbox', 'inbox', 'inbox', 'Inbox', h('span.nav-badge.a2-badge', { 'data-badge': 'decide', hidden: true })),
    tab('#/esplora', 'esplora', 'grid-3x3', 'Esplora'));
}
export function markPlace(section) {
  const p = placeOfSection(section);
  for (const a of document.querySelectorAll('#m-tabs [data-place]')) a.classList.toggle('active', a.dataset.place === p);
  document.body.classList.toggle('a2-root', isRoot(section) || location.hash.startsWith('#/energy/vicino'));
  const t = document.getElementById('m-title');
  if (t) t.textContent = '';
}

// barra in alto nascosta scorrendo giù, la barra in basso pure; tornano scorrendo su
export function setupScrollBars() {
  let last = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (Math.abs(y - last) < 8) return;
    document.body.classList.toggle('a2-scrolled-down', y > last && y > 120);
    document.body.classList.toggle('a2-scrolled', y > 40);
    last = y;
  }, { passive: true });
}

// ═══ A3 in dieci secondi (telefono): chiudi una contromisura, dai lo stato del mese ════════════════════
const CHECK = [['in_linea', 'In linea'], ['a_rischio', 'A rischio'], ['fuori', 'Fuori']];
export function a3QuickBox(p, onChange, today = todayISO(), container = null) {
  let act = 0, exp = 0;
  for (const t of p.tasks || []) {
    if (t.closed_date && t.closed_date <= today) act += t.weight;
    if (t.due_date && t.due_date <= today) exp += t.weight;
  }
  const ok = act >= exp;
  const closed = (p.tasks || []).filter(t => t.closed_date).length;
  const nextDue = (p.tasks || []).filter(t => !t.closed_date && t.due_date).map(t => t.due_date).sort()[0];
  const cm = t => {
    const done = Boolean(t.closed_date);
    const late = !done && t.due_date && t.due_date < today;
    return h('button.a2-cm', { type: 'button', class: `${done ? 'done' : ''} ${late ? 'late' : ''}`, disabled: !p.can_edit, 'aria-pressed': String(done),
      on: { click: async () => {
        await patch(`/api/strategy/tasks/${t.id}`, { closed_date: done ? null : today });
        toast(done ? 'Contromisura riaperta' : 'Contromisura chiusa');
        onChange?.();
      } } },
    h('span.a2-cm-c', done ? icon('check', { size: 14 }) : null),
    h('span.a2-cm-t', h('span', t.activity || 'Contromisura'),
      h('small', [t.owner, t.due_date ? (late ? `in ritardo dal ${itDay(t.due_date)}` : itDay(t.due_date)) : null].filter(Boolean).join(' · '))));
  };
  const state = { status: null };
  const btns = h('div.a2-a3-st');
  const note = h('input.input', { maxlength: 500, placeholder: 'Una riga per il team (facoltativa)…', 'aria-label': 'Nota per il team' });
  const last = h('span.a2-a3-last');
  const drawBtns = () => fill(btns, CHECK.map(([k, l]) => h('button', { type: 'button', class: `${k} ${state.status === k ? 'on' : ''}`, 'aria-pressed': String(state.status === k), on: { click: () => { state.status = k; drawBtns(); } } }, l)));
  drawBtns();
  get(`/api/strategy/projects/${p.id}/checkins`, { quiet: true }).then(list => {
    const c = list?.[0];
    if (!c) { last.textContent = 'Nessun aggiornamento ancora.'; return; }
    state.status = state.status || c.status; drawBtns();
    last.textContent = `Ultimo: ${CHECK.find(([k]) => k === c.status)?.[1].toLowerCase()} · ${c.user_name || 'qualcuno'} · ${timeAgo(c.created_at)}${c.note ? ` · «${c.note}»` : ''}`;
  }).catch(() => {});
  const send = async () => {
    if (!state.status) { toast('Scegli lo stato del mese', 'err'); return; }
    await post(`/api/strategy/projects/${p.id}/checkins`, { status: state.status, note: note.value.trim() });
    toast('Aggiornamento inviato al team');
    note.value = '';
    onChange?.();
  };
  const tasks = [...(p.tasks || [])].sort((a, b) => (a.closed_date ? 1 : 0) - (b.closed_date ? 1 : 0) || String(a.due_date || '9').localeCompare(String(b.due_date || '9')));
  const deg = Math.round(Math.min(100, act) * 3.6);
  return h('div.a2-a3',
    h('section.a2-card.a2-a3-ring',
      h('span.a2-ring', { style: { background: `conic-gradient(${ok ? 'var(--a2-green)' : 'var(--a2-red)'} 0 ${deg}deg, var(--a2-soft) ${deg}deg 360deg)` } }, h('b', `${act}%`)),
      h('span', h('strong', { class: ok ? 'ok' : 'ko' }, ok ? 'In linea' : `In ritardo di ${exp - act} punti`),
        h('small.a2-muted', `${closed} di ${(p.tasks || []).length} contromisure chiuse${nextDue ? ` · prossima ${itDay(nextDue)}` : ''}`))),
    tasks.length ? [h('span.a2-section', p.can_edit ? 'Contromisure · tocca per chiudere' : 'Contromisure'), h('div.a2-card', { style: { padding: '0 14px', gap: '0' } }, tasks.map(cm))] : null,
    p.can_edit ? [h('span.a2-section', 'Aggiornamento del mese'), btns, note,
      h('button.a2-btn.primary.wide', { type: 'button', on: { click: send } }, 'Invia aggiornamento')] : null,
    last,
    container ? h('button.a2-btn.wide', { type: 'button', on: { click: e => { container.classList.toggle('a2-a3-full'); e.target.textContent = container.classList.contains('a2-a3-full') ? 'Chiudi l’A3 intero' : 'Apri l’A3 intero'; } } }, 'Apri l’A3 intero') : null);
}
