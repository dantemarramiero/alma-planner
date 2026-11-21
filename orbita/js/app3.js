// Alma Space 3.0 sul telefono (canvas «Alma Space · app 3.0 telefono», approvato da Dante il 20/11/2026).
// Sul telefono contano Alma Agorà e il CRM; le azioni frequenti sono: aggiungere un contatto o un lead, scrivere una
// nota, dare un compito, mostrare il proprio biglietto e scansionare quello degli altri. Barra in basso:
// Agorà · CRM · + · Compiti · Avvisi. Tutto il resto (Esplora, Io) si apre dalla foto in alto.
// Usa solo API che esistono già (contatti, aziende, note e passi del CRM, ticket, biglietto, Alma per leggere i biglietti).
import { h, fill, avatar, loading, toast, toISODate, addDays, debounce, timeAgo } from './ui.js';
import { get, post, patch } from './api.js';
import { store, userById, firstName, activeProjects } from './store.js';
import { icon } from './icons.js';
import { homeView } from './feed.js';
import { fotoButton, siteStories } from './cantieri.js';
import { sheet, swipeRow, ticketSheet, ticketDone, ticketLater, openPlusAltro, hoshinPulse } from './app2.js';

const ic = (name, size = 20) => icon(name, { size });
const todayISO = () => toISODate(new Date());
const hhmm = s => String(s || '').slice(11, 16);
const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const itDay = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
const shortDay = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' });
function nextWorkday(iso = todayISO()) {
  let d = addDays(iso, 1);
  while ([0, 6].includes(new Date(`${d}T12:00:00`).getDay())) d = addDays(d, 1);
  return d;
}
function nextFriday(iso = todayISO()) {
  let d = addDays(iso, 1);
  while (new Date(`${d}T12:00:00`).getDay() !== 5) d = addDays(d, 1);
  return d;
}
const initialsOf = name => String(name || '?').replace(/^(ing|arch|dott|geom|avv|prof|sig|dr)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
const contactName = c => [c.title, c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.email || 'Contatto';
const ROLE = { lead: ['Lead', 'or'], cliente: ['Cliente', 'gr'], fornitore: ['Fornitore', 'bl'], partner: ['Partner', 'pu'], concorrente: ['Concorrente', 'gy'] };
const roleOf = roles => ROLE[(roles || []).find(r => ROLE[r])] || null;
const store3 = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save3 = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* niente */ } };

// foto «Io» in alto a destra (profilo, impostazioni, tutte le funzioni)
const meBtn = () => h('a.a3-me', { href: '#/io', 'aria-label': 'Io: profilo, impostazioni e tutte le funzioni' }, avatar(store.me, 44));
const roundLink = (href, label, name) => h('a.a3-round', { href, 'aria-label': label }, ic(name));
const kicker = (text, cls = '') => h('span.a3-kicker', { class: cls }, text);

// badge del posto «Compiti» (scaduti + oggi), calcolato dove servono già i dati
function setCompitiBadge(n) {
  for (const el of document.querySelectorAll('[data-badge3="compiti"]')) { el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n); }
}

// dettatura: registra dal microfono e restituisce il testo (stessa trascrizione di Alma)
export function voiceButton({ onText, label = 'Tocca e parla', big = false }) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return null;
  let rec = null;
  const txt = h('span', label);
  const btn = h('button.a3-voice', { type: 'button', class: big ? 'big' : '' }, h('span.a3-voice-ico', ic('mic', big ? 30 : 20)), txt);
  btn.addEventListener('click', async () => {
    if (rec && rec.state === 'recording') { rec.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { toast('Per dettare serve il permesso del microfono.', 'err'); return; }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    const chunks = [];
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const t0 = Date.now();
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      btn.classList.remove('rec');
      txt.textContent = 'Trascrivo…';
      const blob = new Blob(chunks, { type: (rec.mimeType || type || 'audio/webm').split(';')[0] });
      try {
        const res = await fetch(`/api/alma/voce/trascrivi?secondi=${Math.max(1, Math.round((Date.now() - t0) / 1000))}`,
          { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': blob.type, 'X-Alma': '1' }, body: blob });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
        if (data.text) onText(String(data.text).trim());
      } catch (err) { toast(err.message || 'Non sono riuscito a trascrivere', 'err'); }
      txt.textContent = label;
    };
    rec.start();
    btn.classList.add('rec');
    txt.textContent = 'Tocca per finire';
    setTimeout(() => { if (rec?.state === 'recording') rec.stop(); }, 120000);
  });
  return btn;
}

// ═══ Agorà come piazza (controproposta approvata da Dante il 21/11/2026, artboard AgoraB/AgoraB2) ═════════════
// In alto: saluto, il mio QR, una riga sottile per il lavoro, storie, filtri che restano in alto, la news in evidenza
// grande e «Oggi in Almacis» (compleanni, nuovi arrivi, anniversari con un pulsante); poi il sondaggio e la bacheca.
const AGORA_FILTERS = [['', 'Per te'], ['news', 'News'], ['cantieri', 'Dai cantieri'], ['grazie', 'Grazie']];
export function agoraView(view, params) {
  const filter = AGORA_FILTERS.some(([k]) => k && k === params.get('filtro')) ? params.get('filtro') : '';
  const cleanup = homeView(view, filter ? new URLSearchParams({ filtro: filter }) : new URLSearchParams());
  view.querySelector('.bacheca')?.classList.add('a3-agora');
  view.querySelector('.m-today')?.remove();
  view.querySelector('.composer-v2')?.remove(); // per scrivere c'è il + («Post in Agorà»)
  const date = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
  const head = h('header.a3-head',
    h('div.a3-head-t', h('span.a3-eyebrow', `ALMA AGORÀ · ${date}`), h('h1.a3-hello', 'Ciao, ', h('strong', firstName(store.me)))),
    h('div.a3-head-r', roundLink('#/biglietto', 'Il mio biglietto da visita', 'qr-code'), meBtn()));
  const today = h('a.a3-oggi', { href: '#/compiti' }, h('span.a3-oggi-dot'), h('span.a3-oggi-t', '…'), h('span.a3-oggi-n'));
  const pills = h('nav.a3-pills.a3-sticky', { 'aria-label': 'Filtro' },
    AGORA_FILTERS.map(([k, l]) => h('a.a3-pill', { href: k ? `#/benvenuto?filtro=${k}` : '#/benvenuto', class: k === filter ? 'on' : '', 'aria-current': k === filter ? 'page' : null }, l)),
    h('a.a3-pill', { href: '#/persone' }, 'Persone'));
  const top = h('div.a3-piazza');
  const col = view.querySelector('.feed-col');
  const stories = col?.querySelector('.stories, .stories-bar, .story-bar') || null;
  col?.prepend(head, today, fotoButton()); // «Foto dal cantiere» (storie dai cantieri, C1)
  siteStories(stories); // le storie dei cantieri davanti a quelle delle persone
  if (stories) stories.after(pills); else today.after(pills);
  pills.after(top);
  const pinned = col?.querySelectorAll('.feed-list')[0];

  // riga del lavoro: prossimo incontro e compiti di oggi
  (async () => {
    const day = todayISO();
    const [cal, tickets, steps] = await Promise.all([
      get(`/api/calendar?start=${day}T00:00:00&end=${day}T23:59:59`, { quiet: true }).catch(() => null),
      get('/api/tickets?assignee=me&status=open', { quiet: true }).catch(() => []),
      store.me.crm ? get('/api/crm/steps?di=me', { quiet: true }).catch(() => null) : null,
    ]);
    const now = new Date();
    const next = (cal?.events || []).filter(e => !e.allDay && new Date(e.end || e.start) > now).sort((a, b) => String(a.start).localeCompare(String(b.start)))[0];
    const due = t => String(t.due_date || '').slice(0, 10);
    const n = (tickets || []).filter(t => (!t.rda_state || t.rda_state === 'accepted') && due(t) && due(t) <= day).length
      + (steps?.steps || []).filter(s => s.due_date <= day).length;
    const late = (tickets || []).some(t => due(t) && due(t) < day) || (steps?.steps || []).some(s => s.late);
    fill(today.querySelector('.a3-oggi-t'), next ? [h('strong', hhmm(next.start)), ` ${next.title || 'Incontro'}`] : (cal && !cal.outlookError ? 'Nessun incontro oggi' : 'La mia giornata'));
    const nEl = today.querySelector('.a3-oggi-n');
    nEl.textContent = n ? `${n} ${n === 1 ? 'compito' : 'compiti'} ›` : 'Tutto fatto ›';
    nEl.classList.toggle('red', late);
    setCompitiBadge(n);
  })();

  // in evidenza, oggi in Almacis, sondaggio (solo su «Per te»)
  if (!filter) (async () => {
    const [home, hk] = await Promise.all([
      get('/api/welcome/home', { quiet: true }).catch(() => null),
      get(`/api/strategy?year=${new Date().getFullYear()}`, { quiet: true }).catch(() => null), // riga dell'Hoshin Kanri
    ]);
    if (!home || !top.isConnected) return;
    const [{ mediaUrl }, { openPost, openComposer }] = await Promise.all([import('./media.js'), import('./feed.js')]);
    // senza post fissati dalla direzione: gli ultimi post con foto (la piazza non resta mai vuota)
    const pinnedNews = home.news || [];
    const news = pinnedNews.length ? pinnedNews : (home.posts || []).filter(p => p.media_id).slice(0, 3);
    const fromFeed = !pinnedNews.length;
    let hero = null;
    if (news.length) {
      if (pinned && !fromFeed) pinned.hidden = true; // i post in evidenza sono già nel riquadro grande
      const track = h('div.a3-hero-track');
      const dots = h('span.a3-dots', { 'aria-hidden': 'true' }, news.map((_, i) => h('i', { class: i ? '' : 'on' })));
      for (const p of news) {
        const author = userById(p.author_id);
        const text = String(p.body || '').replace(/\s+/g, ' ').trim();
        track.append(h('button.a3-hero', { type: 'button', on: { click: () => openPost(p.id) } },
          h('span.a3-hero-img', p.media_id ? h('img', { src: mediaUrl(p.media_id), alt: '', loading: 'lazy' }) : ic('megaphone', 28), h('span.a3-hero-badge', fromFeed ? 'DALLA BACHECA' : 'IN EVIDENZA')),
          h('span.a3-hero-b',
            kicker([fromFeed ? (p.kind === 'grazie' ? 'GRAZIE A…' : p.kind === 'cantiere' ? 'DAI CANTIERI' : 'POST') : 'NEWS AZIENDALE', p.kind === 'cantiere' ? null : author?.name?.toUpperCase(), timeAgo(p.created_at).toUpperCase()].filter(Boolean).join(' · '), 'or'),
            h('strong', text.length > 110 ? `${text.slice(0, 110)}…` : text),
            h('small', `${p.likes || 0} mi piace · ${p.comments || 0} ${p.comments === 1 ? 'commento' : 'commenti'}`))));
      }
      track.addEventListener('scroll', () => {
        const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
      }, { passive: true });
      hero = h('section.a3-hero-wrap', track, news.length > 1 ? dots : null);
    }
    const handle = id => userById(id)?.handle || String(userById(id)?.email || '').split('@')[0];
    const ppl = home.people || {};
    const card = (p, tag, cls, sub, cta, text) => h('div.a3-pcard',
      h('div.a3-pcard-top', h('a', { href: `#/u/${p.id}` }, avatar(userById(p.id) || p, 40)), h('span.a3-tag', { class: cls }, tag)),
      h('a.a3-pcard-t', { href: `#/u/${p.id}` }, h('strong', p.name), h('small', sub)),
      h('button.a3-btn.a3-pcard-b', { type: 'button', on: { click: () => openComposer({ text, onCreated: () => rerender() }) } }, cta));
    // oggi prima; poi i prossimi 7 giorni, i nuovi arrivi del mese e gli eventi aziendali, così c'è sempre qualcosa
    const when = d => (d === 0 ? 'Oggi' : d === 1 ? 'Domani' : `Tra ${d} giorni`);
    const day = todayISO();
    const cards = [
      ...(ppl.birthdays || []).map(p => card(p, 'Compleanno', 'or', when(p.in_days), p.in_days === 0 ? 'Fai gli auguri' : 'Scrivigli', p.in_days === 0 ? `Tanti auguri @${handle(p.id)}! ` : `@${handle(p.id)} `)),
      ...(ppl.arrivals || []).slice(0, 4).map(p => card(p, 'Benvenuto', 'gr', p.job_title || 'Nuovo in Almacis', 'Saluta', `Benvenuto in Almacis @${handle(p.id)}! `)),
      ...(ppl.anniversaries || []).map(p => card(p, `${p.years} ${p.years === 1 ? 'anno' : 'anni'}`, 'bl', p.in_days === 0 ? 'In Almacis da oggi' : `${when(p.in_days)} in Almacis`, 'Complimenti', `Complimenti @${handle(p.id)} per i ${p.years} anni in Almacis! `)),
      ...(home.events || []).slice(0, 3).map(e => h('div.a3-pcard',
        h('div.a3-pcard-top', h('span.a3-ini.pu', ic('calendar', 18)), h('span.a3-tag.pu', 'Evento')),
        h('span.a3-pcard-t', h('strong', e.title), h('small', [e.starts_on === day ? 'Oggi' : itDay(e.starts_on), e.place].filter(Boolean).join(' · '))))),
    ];
    const anyToday = (ppl.birthdays || []).some(p => p.in_days === 0) || (ppl.anniversaries || []).some(p => p.in_days === 0);
    const people = cards.length ? h('section.a3-sec', h('span.a3-sec-t', anyToday ? 'OGGI IN ALMACIS' : 'QUESTA SETTIMANA IN ALMACIS'), h('div.a3-prow', cards)) : null;
    const poll = home.poll ? pollCard(home.poll) : null;
    fill(top, hero, hoshinPulse(hk, todayISO()), people, poll);
  })();
  return cleanup;
}

// sondaggio aperto: si vota con un tocco, poi le percentuali
function pollCard(first) {
  const box = h('section.a3-card.a3-poll');
  const draw = p => {
    const voted = p.my_vote !== null && p.my_vote !== undefined;
    fill(box, kicker(p.open === false ? 'SONDAGGIO · CHIUSO' : 'SONDAGGIO', 'blue'), h('strong.a3-poll-q', p.question),
      p.options.map((o, i) => {
        const pct = p.total ? Math.round(p.counts[i] * 100 / p.total) : 0;
        return h('button.a3-opt', { type: 'button', disabled: p.open === false, class: p.my_vote === i ? 'on' : '', 'aria-pressed': String(p.my_vote === i),
          on: { click: async () => draw(await post(`/api/welcome/polls/${p.id}/vote`, { choice: i })) } },
        voted ? h('i', { style: { width: `${pct}%` } }) : null, h('span', o), voted ? h('b', `${pct}%`) : null);
      }),
      h('small.a3-muted', `${p.total} ${p.total === 1 ? 'risposta' : 'risposte'}${voted ? ' · hai votato' : ''}`));
  };
  draw(first);
  return box;
}

// ═══ «+»: le quattro azioni grandi ═══════════════════════════════════════════════════════════════════════
export function openPlus() {
  const big = (label, sub, ico, cls, run) => h('button.a3-big', { type: 'button', class: cls, on: { click: () => { close(); run(); } } },
    h('span.a3-big-ico', ic(ico, 26)), h('span.a3-big-t', h('strong', label), h('small', sub)));
  const small = (label, ico, cls, run) => h('button.a3-small', { type: 'button', on: { click: () => { close(); run(); } } }, h('span', { class: cls }, ic(ico, 20)), label);
  const contactOk = Boolean(store.me.crm);
  const close = sheet(h('div.a3-plus',
    h('div.a3-sheet-head', h('h2', 'Cosa vuoi fare?'), h('button.a3-round', { type: 'button', 'aria-label': 'Chiudi', on: { click: () => close() } }, ic('x', 20))),
    h('a.a3-cfoto', { href: '#/cantieri/foto', on: { click: () => close() } }, h('span.a3-cfoto-ico', ic('camera', 22)), h('span.a3-cfoto-t', h('strong', 'Foto dal cantiere'), h('small', 'Va nella storia e nel diario del cantiere')), h('span', { 'aria-hidden': 'true' }, '›')),
    h('div.a3-grid2',
      contactOk ? big('Contatto o lead', 'Nome, azienda, telefono', 'user-plus', 'dark', () => contactSheet()) : null,
      contactOk ? big('Scansiona biglietto', 'Alma lo legge per te', 'scan-line', 'tint', () => { location.hash = '#/crm/scansiona'; }) : null,
      big('Nota', contactOk ? 'Scritta o a voce, su un contatto' : 'Su un contatto del CRM', 'pencil', 'white pu', () => noteSheet()),
      big('Compito', 'A te o a un collega', 'square-check', 'white gr', () => taskSheet())),
    h('div.a3-grid2',
      small('Il mio biglietto', 'qr-code', 'or', () => { location.hash = '#/biglietto'; }),
      small('Post in Agorà', 'camera', 'bl', async () => { const { openComposer } = await import('./feed.js'); openComposer({ onCreated: () => { location.hash = '#/benvenuto'; rerender(); } }); })),
    h('button.a3-more', { type: 'button', on: { click: () => { close(); openPlusAltro(); } } }, 'Ticket, RDA, mezzo, segnalazione IT ›')), { label: 'Crea' });
}

// ═══ CRM ═════════════════════════════════════════════════════════════════════════════════════════════════
const RECENT = 'alma.crm.recenti';
const rememberContact = c => save3(RECENT, [{ id: c.id, name: contactName(c), org: c.links?.[0]?.name || '', roles: c.links?.[0]?.roles || [] },
  ...store3(RECENT, []).filter(x => x.id !== c.id)].slice(0, 12));

function personRow(p) {
  const r = roleOf(p.roles);
  return h('a.a3-row', { href: `#/crm/persona/${p.id}` },
    h('span.a3-ini', { class: r?.[1] || 'gy' }, initialsOf(p.name)),
    h('span.a3-row-t', h('strong', p.name), p.org ? h('small', p.org) : null),
    r ? h('span.a3-tag', { class: r[1] }, r[0]) : null);
}
function companyRow(s) {
  const r = roleOf(s.roles);
  return h('a.a3-row', { href: `#/crm/scheda/${s.id}` },
    h('span.a3-ini.sq', { class: r?.[1] || 'gy' }, ic('building', 18)),
    h('span.a3-row-t', h('strong', s.name), h('small', [s.city, s.owner_name].filter(Boolean).join(' · ') || ' ')),
    r ? h('span.a3-tag', { class: r[1] }, r[0]) : null);
}
function stepRow(st, reload) {
  const done = async () => { await post(`/api/crm/steps/${st.id}/done`, {}); toast('Passo fatto'); reload(); };
  const tel = null;
  return h('div.a3-row.a3-step',
    h('button.a3-check', { type: 'button', 'aria-label': `Segna fatto: ${st.title}`, on: { click: done } }),
    h('a.a3-row-t', { href: st.contact_id ? `#/crm/persona/${st.contact_id}` : `#/crm/scheda/${st.subject_id}` },
      h('strong', st.title), h('small', [st.contact_name, st.subject_name].filter(Boolean).join(' · '))),
    st.late ? h('span.a3-due.red', itDay(st.due_date)) : tel);
}

export async function crmHome(view, params) {
  if (!store.me.crm) {
    fill(view, h('div.a3-page', h('header.a3-head', h('h1.a3-title', 'CRM'), meBtn()),
      h('div.a3-empty', ic('contact', 26), h('strong', 'Il CRM non è ancora acceso per te'), h('small', 'Chiedi alla direzione di aggiungerti a una ASA.'))));
    return;
  }
  const tab = ['persone', 'aziende', 'lead', 'passi'].includes(params.get('vista')) ? params.get('vista') : 'persone';
  const list = h('div.a3-list-wrap');
  const q = h('input.a3-search-in', { type: 'search', placeholder: 'Persona, azienda, P. IVA…', 'aria-label': 'Cerca nel CRM', autocomplete: 'off' });
  const reload = () => crmHome(view, params);
  const mic = voiceButton({ label: '', onText: t => { q.value = t; search(); } });
  if (mic) { mic.classList.add('a3-mic'); mic.setAttribute('aria-label', 'Cerca a voce'); }

  const section = (title, rows, cls = '') => rows.length ? h('section.a3-sec', h('span.a3-sec-t', { class: cls }, title), h('div.a3-card.a3-list', rows)) : null;
  async function draw() {
    fill(list, loading());
    const today = todayISO();
    if (tab === 'persone') {
      const [mine, steps] = await Promise.all([
        get(`/api/crm/contacts?owner=${store.me.id}`, { quiet: true }).catch(() => ({ contacts: [] })),
        get('/api/crm/steps?di=me', { quiet: true }).catch(() => ({ steps: [] })),
      ]);
      const recent = store3(RECENT, []);
      const todaySteps = steps.steps.filter(s => s.due_date <= today);
      const others = mine.contacts.filter(c => !recent.some(r => r.id === c.id)).slice(0, 30)
        .map(c => ({ id: c.id, name: contactName(c), org: c.links?.[0]?.name || '', roles: c.links?.[0]?.roles || [] }));
      fill(list,
        section(todaySteps.some(s => s.late) ? 'PROSSIMI PASSI · IN RITARDO E OGGI' : 'PROSSIMI PASSI · OGGI', todaySteps.slice(0, 5).map(s => stepRow(s, reload))),
        section('VISTI DI RECENTE', recent.slice(0, 8).map(personRow)),
        section('I MIEI CONTATTI', others.map(personRow)),
        !recent.length && !others.length ? h('div.a3-empty', ic('user-plus', 26), h('strong', 'Ancora nessun contatto tuo'), h('small', 'Aggiungilo con «Nuovo contatto» o scansiona un biglietto.')) : null);
    } else if (tab === 'aziende' || tab === 'lead') {
      const d = await get(`/api/crm/subjects?owner=${store.me.id}${tab === 'lead' ? '&role=lead' : ''}`, { quiet: true }).catch(() => ({ subjects: [] }));
      fill(list, section(tab === 'lead' ? 'I MIEI LEAD' : 'LE MIE AZIENDE', d.subjects.slice(0, 60).map(companyRow))
        || h('div.a3-empty', ic('building', 26), h('strong', 'Niente qui'), h('small', 'Cerca sopra per vedere tutte le aziende del CRM.')));
    } else {
      const d = await get('/api/crm/steps?di=me', { quiet: true }).catch(() => ({ steps: [] }));
      fill(list, section('I MIEI PROSSIMI PASSI', d.steps.map(s => stepRow(s, reload)))
        || h('div.a3-empty', ic('check', 26), h('strong', 'Nessun passo aperto'), h('small', 'Dai un compito da un contatto: finisce qui.')));
    }
  }
  const search = debounce(async () => {
    const term = q.value.trim();
    if (term.length < 2) { draw(); return; }
    fill(list, loading());
    const [c, s] = await Promise.all([
      get(`/api/crm/contacts?q=${encodeURIComponent(term)}`, { quiet: true }).catch(() => ({ contacts: [] })),
      get(`/api/crm/subjects?q=${encodeURIComponent(term)}`, { quiet: true }).catch(() => ({ subjects: [] })),
    ]);
    if (q.value.trim() !== term) return;
    const people = c.contacts.slice(0, 20).map(x => personRow({ id: x.id, name: contactName(x), org: x.links?.[0]?.name || '', roles: x.links?.[0]?.roles || [] }));
    const firms = s.subjects.slice(0, 20).map(companyRow);
    fill(list, section('PERSONE', people), section('AZIENDE', firms),
      !people.length && !firms.length ? h('div.a3-empty', ic('search', 26), h('strong', `Nessun risultato per «${term}»`),
        h('button.a3-btn', { type: 'button', on: { click: () => contactSheet({ name: term }) } }, 'Crealo come contatto')) : null);
  }, 250);
  q.addEventListener('input', search);

  const pill = (key, label) => h('a.a3-pill', { href: key === 'persone' ? '#/crm' : `#/crm?vista=${key}`, class: tab === key ? 'on' : '', 'aria-current': tab === key ? 'page' : null }, label);
  fill(view, h('div.a3-page.a3-crm',
    h('header.a3-head', h('h1.a3-title', 'CRM'), h('div.a3-head-r', meBtn())),
    h('label.a3-search', ic('search', 20), q, mic),
    h('div.a3-grid2',
      h('a.a3-act.dark', { href: '#/crm/scansiona' }, ic('scan-line', 20), 'Scansiona biglietto'),
      h('button.a3-act', { type: 'button', on: { click: () => contactSheet() } }, ic('user-plus', 20), 'Nuovo contatto')),
    h('nav.a3-pills', { 'aria-label': 'Elenco' }, pill('persone', 'Persone'), pill('aziende', 'Aziende'), pill('lead', 'Lead'), pill('passi', 'I miei passi')),
    list));
  await draw();
}

// ── scegli un'azienda (cerca nel CRM o creala al volo) ──────────────────────────────────────────────────────
function companyPicker({ initial = '', onPick }) {
  const input = h('input.a3-in', { value: initial, placeholder: 'Scrivi il nome…', autocomplete: 'off', 'aria-label': 'Azienda' });
  const box = h('div.a3-suggest', { hidden: true });
  let chosen = null;
  const choose = s => { chosen = s; input.value = s.name; box.hidden = true; onPick?.(s); };
  const run = debounce(async () => {
    const term = input.value.trim();
    chosen = null; onPick?.(null);
    if (term.length < 2) { box.hidden = true; return; }
    const d = await get(`/api/crm/subjects?q=${encodeURIComponent(term)}`, { quiet: true }).catch(() => ({ subjects: [] }));
    if (input.value.trim() !== term) return;
    const exact = d.subjects.some(s => s.name.toLowerCase() === term.toLowerCase());
    fill(box, d.subjects.slice(0, 4).map(s => {
      const r = roleOf(s.roles);
      return h('button.a3-sug', { type: 'button', on: { click: () => choose(s) } }, ic('building', 18), h('span', s.name), r ? h('small.a3-tag', { class: r[1] }, `${r[0]} · già nel CRM`) : null);
    }), exact ? null : h('button.a3-sug.new', { type: 'button', on: { click: () => choose({ id: null, name: term, roles: [] }) } }, ic('plus', 18), h('span', `Crea «${term}»`)));
    box.hidden = false;
  }, 220);
  input.addEventListener('input', run);
  return { el: h('div.a3-picker', input, box), get value() { return chosen || (input.value.trim() ? { id: null, name: input.value.trim(), roles: [] } : null); } };
}

// ═══ Nuovo contatto (o modifica) ═════════════════════════════════════════════════════════════════════════
export function contactSheet({ name = '', contact = null, onSaved } = {}) {
  const editing = Boolean(contact);
  const link = contact?.links?.[0] || null;
  const f = (label, input) => h('label.a3-f', h('span', label), input);
  const nome = h('input.a3-in', { value: editing ? [contact.title, contact.first_name, contact.last_name].filter(Boolean).join(' ') : name, autocomplete: 'off' });
  const tel = h('input.a3-in', { type: 'tel', value: contact?.mobile || contact?.phone || '', placeholder: '333…' });
  const mail = h('input.a3-in', { type: 'email', value: contact?.email || '', placeholder: 'nome@…', autocapitalize: 'off' });
  const job = h('input.a3-in', { value: link?.job || '', placeholder: 'Es. Direttore tecnico, RUP…' });
  const state = { role: 'lead', company: link ? { id: link.subject_id, name: link.name, roles: link.roles } : null };
  const roleBox = h('fieldset.a3-roles', { hidden: true });
  const drawRoles = () => fill(roleBox, h('legend', 'La nuova azienda è un'), h('div.a3-chips',
    [['lead', 'Lead'], ['cliente', 'Cliente'], ['fornitore', 'Fornitore'], ['partner', 'Partner']].map(([k, l]) =>
      h('button.a3-chip', { type: 'button', class: state.role === k ? 'on' : '', 'aria-pressed': String(state.role === k), on: { click: () => { state.role = k; drawRoles(); } } }, l))));
  drawRoles();
  const picker = companyPicker({ initial: state.company?.name || '', onPick: s => { state.company = s; roleBox.hidden = !(s && !s.id); } });
  let busy = false;
  const saveBtn = h('button.a3-btn.primary.wide', { type: 'button' }, editing ? 'Salva' : 'Salva contatto');
  const save = async () => {
    if (busy) return;
    if (!nome.value.trim() && !mail.value.trim()) { nome.focus(); toast('Serve almeno il nome o l\'email', 'err'); return; }
    busy = true; saveBtn.disabled = true;
    try {
      let company = picker.value;
      if (company && !company.id) {
        const s = await post('/api/crm/subjects/rapida', { name: company.name });
        if (!s.existing && state.role !== 'lead') await post(`/api/crm/subjects/${s.id}/roles`, { mode: 'set', roles: [state.role] }, { quiet: true }).catch(() => toast('L\'azienda resta lead: il ruolo lo cambia la direzione', 'err'));
        company = s;
      }
      const isMob = /^\+?3/.test(tel.value.replace(/\s/g, '')) || !tel.value.trim();
      const body = { email: mail.value.trim(), [isMob ? 'mobile' : 'phone']: tel.value.trim(),
        links: company ? [{ subject_id: company.id, job: job.value.trim(), is_primary: true }] : (editing ? undefined : []) };
      let c;
      if (editing) {
        const n = nome.value.trim();
        c = await patch(`/api/crm/contacts/${contact.id}`, { ...body, ...(n !== contactName(contact) ? splitForPatch(n) : {}) });
      } else {
        if (body.email) {
          const m = await get(`/api/crm/contacts/check?email=${encodeURIComponent(body.email)}`, { quiet: true }).catch(() => ({ matches: [] }));
          if (m.matches?.[0]) { close(); toast('C\'è già: ti apro la sua scheda'); location.hash = `#/crm/persona/${m.matches[0].id}`; return; }
        }
        c = await post('/api/crm/contacts', { nome: nome.value.trim(), ...body });
      }
      close();
      toast(editing ? 'Contatto aggiornato' : 'Contatto salvato');
      onSaved?.(c);
      if (!editing) location.hash = `#/crm/persona/${c.id}`;
    } catch (err) { toast(err.message || 'Non salvato', 'err'); } finally { busy = false; saveBtn.disabled = false; }
  };
  saveBtn.addEventListener('click', save);
  const close = sheet(h('div.a3-form',
    h('div.a3-sheet-head', h('button.a3-textbtn', { type: 'button', on: { click: () => close() } }, 'Annulla'), h('h2', editing ? 'Modifica contatto' : 'Nuovo contatto'),
      h('button.a3-textbtn.strong', { type: 'button', on: { click: save } }, 'Salva')),
    editing ? null : h('a.a3-dictate', { href: '#/crm/scansiona?voce=1', on: { click: () => close() } },
      h('span.a3-dictate-ico', ic('mic', 20)), h('span', h('strong', 'Dettalo ad Alma'), h('small', '«Marco Ferri, Studio Ferri, 333 12 34 567»'))),
    f('Nome e cognome', nome),
    h('div.a3-f', h('span', 'Azienda'), picker.el),
    roleBox,
    f('Ruolo (facoltativo)', job),
    h('div.a3-grid2', f('Telefono', tel), f('Email', mail)),
    editing ? null : h('a.a3-link', { href: '#/crm/scansiona', on: { click: () => close() } }, ic('scan-line', 18), 'Hai il biglietto? Scansionalo'),
    saveBtn), { label: editing ? 'Modifica contatto' : 'Nuovo contatto', tall: true });
  setTimeout(() => nome.focus(), 60);
}
function splitForPatch(full) {
  const m = String(full).trim().match(/^((?:ing|arch|dott|geom|avv|prof|sig|dr)\.?)\s+(.*)$/i);
  const rest = (m ? m[2] : full).trim().split(/\s+/);
  const last = rest.length > 1 ? rest.pop() : rest[0];
  return { title: m ? m[1].replace(/\.?$/, '.').replace(/^./, x => x.toUpperCase()) : undefined, first_name: rest.length && rest[0] !== last ? rest.join(' ') : '', last_name: last };
}

// ═══ Scheda del contatto ═════════════════════════════════════════════════════════════════════════════════
export async function contactPage(view, id) {
  fill(view, loading());
  const c = await get(`/api/crm/contacts/${id}`).catch(() => null);
  if (!c) { fill(view, h('div.a3-page', h('div.a3-empty', h('strong', 'Contatto non trovato')))); return; }
  rememberContact(c);
  const link = c.links?.[0] || null;
  const r = roleOf(link?.roles);
  const reload = () => contactPage(view, id);
  const phone = c.mobile || c.phone || '';
  const digits = phone.replace(/[^\d+]/g, '').replace(/^00/, '+');
  const wa = c.mobile ? `https://wa.me/${digits.replace(/^\+/, '').replace(/^(?=3)/, '39')}` : null;
  const vcard = () => {
    const v = ['BEGIN:VCARD', 'VERSION:3.0', `N:${c.last_name || ''};${c.first_name || ''};;${c.title || ''};`, `FN:${contactName(c)}`,
      link ? `ORG:${link.name}` : '', link?.job ? `TITLE:${link.job}` : '', c.mobile ? `TEL;TYPE=CELL:${c.mobile}` : '', c.phone ? `TEL;TYPE=WORK:${c.phone}` : '',
      c.email ? `EMAIL:${c.email}` : '', 'END:VCARD'].filter(Boolean).join('\r\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([v], { type: 'text/vcard' })), download: `${contactName(c).replace(/[^\w]+/g, '-')}.vcf` });
    document.body.append(a); a.click(); a.remove();
  };
  const quick = (label, ico, cls, attrs) => h(attrs.href ? 'a.a3-q' : 'button.a3-q', { ...(attrs.href ? attrs : { type: 'button', ...attrs }), class: attrs.href || attrs.on ? '' : 'off' },
    h('span', { class: cls }, ic(ico, 20)), label);
  const [steps, tl] = await Promise.all([
    link ? get(`/api/crm/subjects/${link.subject_id}/steps`, { quiet: true }).catch(() => null) : null,
    get(`/api/crm/contacts/${id}/timeline`, { quiet: true }).catch(() => null),
  ]);
  const step = (steps?.open || []).find(s => s.contact_id === c.id) || (steps?.open || [])[0];
  const items = (tl?.items || []).slice(0, 12);
  const dotOf = k => ({ note: 'pu', email: 'bl', meeting: 'gr' }[k] || 'or');
  const LABEL = { note: 'Nota', email: 'Email', meeting: 'Incontro' };
  const ctx = { target: 'contacts', id: c.id, label: contactName(c), company: link, contactId: c.id, subjectId: link?.subject_id || null };
  fill(view, h('div.a3-page.a3-scheda',
    h('header.a3-bar', h('a.a3-back', { href: '#/crm' }, ic('chevron-left', 22), 'CRM'),
      h('button.a3-textbtn.strong', { type: 'button', on: { click: () => contactSheet({ contact: c, onSaved: reload }) } }, 'Modifica')),
    h('div.a3-who',
      h('span.a3-ini.xl', { class: r?.[1] || 'gy' }, initialsOf(contactName(c))),
      h('div.a3-who-t', h('h1', contactName(c)),
        link ? h('span.a3-muted', link.job ? `${link.job} · ` : '', h('a', { href: `#/crm/scheda/${link.subject_id}` }, link.name)) : h('span.a3-muted', 'Senza azienda'),
        r ? h('span.a3-tag', { class: r[1] }, `${r[0]}${c.owner_name ? ` · di ${firstName({ id: c.owner_id, name: c.owner_name })}` : ''}`) : null)),
    h('nav.a3-quick', { 'aria-label': 'Contatta' },
      quick('Chiama', 'phone', 'gr', phone ? { href: `tel:${digits}` } : {}),
      quick('WhatsApp', 'message', 'gr', wa ? { href: wa, target: '_blank', rel: 'noopener' } : {}),
      quick('Email', 'mail', 'bl', c.email ? { href: `mailto:${c.email}` } : {}),
      quick('In rubrica', 'user-plus', 'wh', { on: { click: vcard } })),
    h('div.a3-grid3',
      h('button.a3-tile', { type: 'button', on: { click: () => noteSheet({ ...ctx, onSaved: reload }) } }, h('span.pu', ic('pencil', 22)), 'Nota'),
      h('button.a3-tile', { type: 'button', on: { click: () => taskSheet({ ...ctx, onSaved: reload }) } }, h('span.gr', ic('square-check', 22)), 'Compito'),
      h('button.a3-tile', { type: 'button', on: { click: () => meetingSheet({ ...ctx, email: c.email, onSaved: reload }) } }, h('span.bl', ic('calendar', 22)), 'Incontro')),
    step ? h('div.a3-next',
      h('div', kicker(`PROSSIMO PASSO · ${step.due_date && String(step.due_date).slice(0, 10) <= todayISO() ? 'OGGI' : itDay(String(step.due_date).slice(0, 10)).toUpperCase()}`, 'lt'), h('strong', step.title)),
      h('button.a3-btn.light', { type: 'button', on: { click: async () => { await post(`/api/crm/steps/${step.id}/done`, {}); toast('Passo fatto'); reload(); } } }, 'Fatto')) : null,
    items.length ? h('section.a3-sec', h('span.a3-sec-t', 'STORIA'), h('div.a3-card.a3-log', items.map(e => h('div.a3-log-i',
      h('span.a3-dot', { class: dotOf(e.type) }),
      h('span', h('strong', [LABEL[e.type], e.title].filter(Boolean).join(': ')),
        h('small', [e.type === 'note' ? userById(e.author_id)?.name : e.meta, e.date ? itDay(String(e.date).slice(0, 10)) : null].filter(Boolean).join(' · '))))))) : null,
    h('a.a3-link.center', { href: `#/crm/contatti/${c.id}` }, 'Apri la scheda completa')));
}

// ═══ Nota veloce ═════════════════════════════════════════════════════════════════════════════════════════
// Senza un contatto (dal «+»): prima si sceglie su chi.
function whoPicker({ onPick, placeholder = 'Su chi? Cerca persona o azienda…' }) {
  const input = h('input.a3-in', { placeholder, autocomplete: 'off', 'aria-label': 'Su chi' });
  const box = h('div.a3-suggest', { hidden: true });
  const recent = store3(RECENT, []).slice(0, 4);
  const drawRecent = () => {
    if (!recent.length) { box.hidden = true; return; }
    fill(box, recent.map(p => h('button.a3-sug', { type: 'button', on: { click: () => onPick({ target: 'contacts', id: p.id, label: p.name, contactId: p.id }) } }, ic('user', 18), h('span', p.name), p.org ? h('small', p.org) : null)));
    box.hidden = false;
  };
  const run = debounce(async () => {
    const t = input.value.trim();
    if (t.length < 2) { drawRecent(); return; }
    const [c, s] = await Promise.all([
      get(`/api/crm/contacts?q=${encodeURIComponent(t)}`, { quiet: true }).catch(() => ({ contacts: [] })),
      get(`/api/crm/subjects?q=${encodeURIComponent(t)}`, { quiet: true }).catch(() => ({ subjects: [] })),
    ]);
    if (input.value.trim() !== t) return;
    fill(box,
      c.contacts.slice(0, 5).map(x => h('button.a3-sug', { type: 'button', on: { click: () => onPick({ target: 'contacts', id: x.id, label: contactName(x), contactId: x.id, company: x.links?.[0] || null, subjectId: x.links?.[0]?.subject_id || null }) } },
        ic('user', 18), h('span', contactName(x)), x.links?.[0] ? h('small', x.links[0].name) : null)),
      s.subjects.slice(0, 5).map(x => h('button.a3-sug', { type: 'button', on: { click: () => onPick({ target: 'subjects', id: x.id, label: x.name, subjectId: x.id }) } },
        ic('building', 18), h('span', x.name))));
    box.hidden = !box.childElementCount;
  }, 220);
  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (!input.value.trim()) drawRecent(); });
  return h('div.a3-picker', input, box);
}

export function noteSheet(ctx = {}) {
  const state = { ...ctx };
  const text = h('textarea.a3-note', { rows: 6, placeholder: 'Cosa vi siete detti, cosa c\'è da ricordare…', 'aria-label': 'Testo della nota', maxlength: 20000 });
  const who = h('div.a3-who-row');
  const drawWho = () => fill(who, state.id
    ? [h('button.a3-chip.on.x', { type: 'button', on: { click: () => { Object.assign(state, { id: null, target: null, label: '', company: null }); drawWho(); } } }, state.label, ic('x', 14)),
      state.company && state.target === 'contacts' ? h('span.a3-chip.soft', `anche su ${state.company.name}`) : null]
    : whoPicker({ onPick: p => { Object.assign(state, p); drawWho(); text.focus(); } }));
  drawWho();
  const voice = voiceButton({ big: true, onText: t => { text.value = text.value.trim() ? `${text.value.trim()} ${t}` : t; } });
  const saveBtn = h('button.a3-btn.primary.wide', { type: 'button' }, 'Salva nota');
  saveBtn.addEventListener('click', async () => {
    if (!state.id) { toast('Scegli su chi è la nota', 'err'); return; }
    if (!text.value.trim()) { text.focus(); return; }
    saveBtn.disabled = true;
    try {
      await post(`/api/crm/${state.target}/${state.id}/notes`, { kind: 'nota', body: text.value.trim() });
      close(); toast('Nota salvata'); ctx.onSaved?.();
    } catch (err) { toast(err.message || 'Nota non salvata', 'err'); saveBtn.disabled = false; }
  });
  const close = sheet(h('div.a3-form',
    h('div.a3-sheet-head', h('h2', 'Nota'), h('button.a3-textbtn', { type: 'button', on: { click: () => close() } }, 'Annulla')),
    who, text, voice ? h('div.a3-voice-wrap', voice) : null, saveBtn), { label: 'Nota', tall: true });
  setTimeout(() => (state.id ? text : who.querySelector('input'))?.focus(), 60);
}

// ═══ Dai un compito: con un contatto/azienda è un passo del CRM, altrimenti un ticket ══════════════════════
const ASSIGNEES = 'alma.compiti.persone';
export function taskSheet(ctx = {}) {
  const state = { ...ctx, owner: store.me.id, due: nextWorkday(), project: null };
  const title = h('input.a3-in', { placeholder: 'Es. Mandare l\'offerta', maxlength: 300, 'aria-label': 'Cosa c\'è da fare' });
  const people = () => {
    const ids = [store.me.id, ...store3(ASSIGNEES, []).filter(i => i !== store.me.id && userById(i))].slice(0, 4);
    if (!ids.includes(state.owner)) ids.splice(3, 1, state.owner);
    return ids.map(userById).filter(Boolean);
  };
  const whoBox = h('div.a3-people');
  const search = h('div.a3-picker', { hidden: true });
  const drawWho = () => fill(whoBox, people().map(u => h('button.a3-person', { type: 'button', class: state.owner === u.id ? 'on' : '', 'aria-pressed': String(state.owner === u.id),
    on: { click: () => { state.owner = u.id; drawWho(); drawSave(); } } }, avatar(u, 48), u.id === store.me.id ? 'Io' : firstName(u))),
  h('button.a3-person.more', { type: 'button', 'aria-label': 'Cerca un collega', on: { click: () => { search.hidden = !search.hidden; search.querySelector('input')?.focus(); } } },
    h('span.a3-person-more', ic('search', 20)), 'Altri'));
  const sIn = h('input.a3-in', { placeholder: 'Nome del collega…', autocomplete: 'off', 'aria-label': 'Cerca un collega' });
  const sBox = h('div.a3-suggest', { hidden: true });
  sIn.addEventListener('input', () => {
    const t = sIn.value.trim().toLowerCase();
    const found = t.length < 2 ? [] : store.users.filter(u => u.name?.toLowerCase().includes(t)).slice(0, 6);
    fill(sBox, found.map(u => h('button.a3-sug', { type: 'button', on: { click: () => { state.owner = u.id; save3(ASSIGNEES, [u.id, ...store3(ASSIGNEES, []).filter(i => i !== u.id)].slice(0, 8)); search.hidden = true; sIn.value = ''; drawWho(); drawSave(); } } },
      avatar(u, 26), h('span', u.name), u.job_title ? h('small', u.job_title) : null)));
    sBox.hidden = !found.length;
  });
  search.append(sIn, sBox);

  const cap = s => s.replace(/^./, x => x.toUpperCase());
  const DUES = () => [[todayISO(), 'Oggi'], [nextWorkday(), nextWorkday() === addDays(todayISO(), 1) ? 'Domani' : cap(shortDay(nextWorkday()))], [nextFriday(), cap(shortDay(nextFriday()))]];
  const dueBox = h('div.a3-chips');
  const dateIn = h('input.a3-in.a3-date', { type: 'date', 'aria-label': 'Altra data', on: { change: e => { if (e.target.value) { state.due = e.target.value; drawDue(); } } } });
  const drawDue = () => fill(dueBox, DUES().filter(([d], i, a) => a.findIndex(x => x[0] === d) === i).map(([d, l]) => h('button.a3-chip', { type: 'button', class: state.due === d ? 'on' : '', on: { click: () => { state.due = d; drawDue(); } } }, l)),
    h('label.a3-chip', { class: DUES().some(([d]) => d === state.due) ? '' : 'on' }, ic('calendar', 16), DUES().some(([d]) => d === state.due) ? 'Altro' : shortDay(state.due), dateIn),
    state.subjectId ? null : h('button.a3-chip', { type: 'button', class: state.due ? '' : 'on', on: { click: () => { state.due = null; drawDue(); } } }, 'Senza data'));
  drawDue();

  const linkBox = h('div.a3-chips');
  const drawLink = () => fill(linkBox,
    state.subjectId
      ? h('button.a3-chip.on.x', { type: 'button', on: { click: () => { Object.assign(state, { subjectId: null, contactId: null, label: '', company: null }); drawLink(); drawDue(); } } },
        [state.label, state.company && state.target === 'contacts' ? state.company.name : null].filter(Boolean).join(' · '), ic('x', 14))
      : [store.me.crm ? whoPicker({ placeholder: 'Contatto o azienda del CRM (facoltativo)', onPick: p => {
          if (!p.subjectId) { toast('Questo contatto non ha un\'azienda: collegalo prima a un\'azienda', 'err'); return; }
          Object.assign(state, p); drawLink(); drawDue(); } }) : null,
        h('select.a3-in', { 'aria-label': 'Progetto', on: { change: e => { state.project = Number(e.target.value) || null; } } },
          h('option', { value: '' }, 'Nessun progetto'), activeProjects().map(p => h('option', { value: String(p.id) }, p.name)))]);
  drawLink();

  const saveBtn = h('button.a3-btn.primary.wide', { type: 'button' });
  const drawSave = () => { saveBtn.textContent = state.owner === store.me.id ? 'Salva per me' : `Assegna a ${firstName(userById(state.owner))}`; };
  drawSave();
  saveBtn.addEventListener('click', async () => {
    if (!title.value.trim()) { title.focus(); toast('Scrivi cosa c\'è da fare', 'err'); return; }
    saveBtn.disabled = true;
    try {
      if (state.subjectId) {
        await post(`/api/crm/subjects/${state.subjectId}/steps`, { title: title.value.trim(), due_date: state.due || nextWorkday(), owner_id: state.owner, contact_id: state.contactId || null });
      } else {
        await post('/api/tickets', { title: title.value.trim(), assignee_ids: [state.owner], due_date: state.due, project_id: state.project });
      }
      if (state.owner !== store.me.id) save3(ASSIGNEES, [state.owner, ...store3(ASSIGNEES, []).filter(i => i !== state.owner)].slice(0, 8));
      close();
      toast(state.owner === store.me.id ? 'Compito salvato' : `Compito dato a ${firstName(userById(state.owner))}: riceve l'avviso`);
      ctx.onSaved?.();
      if (location.hash.startsWith('#/compiti')) rerender();
    } catch (err) { toast(err.message || 'Non salvato', 'err'); saveBtn.disabled = false; }
  });
  drawWho();
  const close = sheet(h('div.a3-form',
    h('div.a3-sheet-head', h('h2', 'Compito'), h('button.a3-textbtn', { type: 'button', on: { click: () => close() } }, 'Annulla')),
    h('label.a3-f', h('span', 'Cosa c\'è da fare'), title),
    h('div.a3-f', h('span', 'A chi'), whoBox, search),
    h('div.a3-f', h('span', 'Entro'), dueBox),
    h('div.a3-f', h('span', 'Collegato a'), linkBox),
    saveBtn), { label: 'Compito', tall: true });
  setTimeout(() => title.focus(), 60);
}

// ── incontro con il contatto (evento in Outlook collegato alla scheda) ───────────────────────────────────────
function meetingSheet(ctx) {
  const t = h('input.a3-in', { value: `Incontro con ${ctx.label}`, maxlength: 255 });
  const day = h('input.a3-in', { type: 'date', value: nextWorkday() });
  const at = h('input.a3-in', { type: 'time', value: '10:00', step: 900 });
  const dur = h('select.a3-in', [['30', '30 minuti'], ['60', '1 ora'], ['90', '1 ora e mezza'], ['120', '2 ore']].map(([v, l]) => h('option', { value: v, selected: v === '60' }, l)));
  const online = h('input', { type: 'checkbox' });
  const btn = h('button.a3-btn.primary.wide', { type: 'button' }, 'Metti in calendario');
  btn.addEventListener('click', async () => {
    const start = `${day.value}T${at.value}:00`;
    const end = new Date(new Date(start).getTime() + Number(dur.value) * 60000);
    const pad = n => String(n).padStart(2, '0');
    const endS = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}:00`;
    btn.disabled = true;
    try {
      await post(`/api/crm/${ctx.target}/${ctx.id}/meetings/new`, { title: t.value.trim(), start, end: endS, online: online.checked, attendees: ctx.email ? [ctx.email] : [] });
      close(); toast('Incontro in calendario'); ctx.onSaved?.();
    } catch (err) { toast(err.message || 'Non salvato', 'err'); btn.disabled = false; }
  });
  const close = sheet(h('div.a3-form',
    h('div.a3-sheet-head', h('h2', 'Incontro'), h('button.a3-textbtn', { type: 'button', on: { click: () => close() } }, 'Annulla')),
    h('label.a3-f', h('span', 'Titolo'), t),
    h('div.a3-grid2', h('label.a3-f', h('span', 'Giorno'), day), h('label.a3-f', h('span', 'Ora'), at)),
    h('label.a3-f', h('span', 'Durata'), dur),
    h('label.a3-toggle', h('span', ctx.email ? `Riunione Teams, invita ${ctx.email}` : 'Riunione Teams'), online),
    btn), { label: 'Incontro', tall: true });
}

// ═══ Scansiona un biglietto (o dettalo): fotocamera, poi Alma legge e propone la scheda da confermare ══════
export async function scanPage(view, params) {
  document.body.classList.add('a3-dark');
  const voiceMode = params.get('voce') === '1';
  let stream = null;
  const stop = () => { stream?.getTracks().forEach(t => t.stop()); stream = null; };
  const leave = () => { stop(); document.body.classList.remove('a3-dark'); };
  const video = h('video.a3-cam-video', { autoplay: true, playsInline: true, muted: true });
  video.setAttribute('playsinline', '');
  const pick = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const native = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const flashBtn = h('button.a3-cam-round', { type: 'button', 'aria-label': 'Flash', style: { visibility: 'hidden' } }, ic('flash', 22));
  let torch = false;
  flashBtn.addEventListener('click', async () => {
    torch = !torch;
    try { await stream?.getVideoTracks()[0].applyConstraints({ advanced: [{ torch }] }); flashBtn.classList.toggle('on', torch); } catch { flashBtn.style.visibility = 'hidden'; }
  });

  const shrinkFrom = (src, w, hgt) => {
    const k = Math.min(1, 1600 / Math.max(w, hgt));
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * k); cv.height = Math.round(hgt * k);
    cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.85);
  };
  // FileReader → data: (la CSP della pagina non permette le immagini blob:)
  const fileToData = f => new Promise((ok, ko) => {
    const fr = new FileReader();
    fr.onerror = ko;
    fr.onload = () => {
      const img = new Image();
      img.onload = () => ok(shrinkFrom(img, img.naturalWidth, img.naturalHeight));
      img.onerror = ko;
      img.src = fr.result;
    };
    fr.readAsDataURL(f);
  });
  const shots = [];
  const shoot = () => {
    if (!video.videoWidth) { native.click(); return; }
    shots.push(shrinkFrom(video, video.videoWidth, video.videoHeight));
    reader();
  };
  const fromFiles = async files => {
    for (const f of [...files].slice(0, 5)) { try { shots.push(await fileToData(f)); } catch { toast('Questa foto non si apre', 'err'); } }
    if (shots.length) reader();
  };
  pick.addEventListener('change', () => fromFiles(pick.files));
  native.addEventListener('change', () => fromFiles(native.files));

  // dopo la foto (o subito, per dettare): dove vi siete conosciuti, poi Alma legge e propone
  async function reader() {
    stop();
    document.body.classList.remove('a3-dark');
    const { createChat } = await import('./alma.js');
    const PLACES = ['Fiera', 'Cantiere', 'Riunione', 'Gara'];
    const st = { where: null };
    const chips = h('div.a3-chips');
    const drawChips = () => fill(chips, PLACES.map(p => h('button.a3-chip', { type: 'button', class: st.where === p ? 'on' : '', 'aria-pressed': String(st.where === p), on: { click: () => { st.where = st.where === p ? null : p; drawChips(); } } }, p)));
    drawChips();
    const chat = createChat({ compact: true, welcome: () => h('span'), placeholder: voiceMode && !shots.length ? 'Tocca il microfono e di\' nome, azienda, telefono…' : 'Vuoi aggiungere qualcosa?' });
    const go = h('button.a3-btn.primary.wide', { type: 'button' }, ic('sparkles', 18), 'Leggi con Alma');
    const intro = h('div.a3-scan-intro',
      h('div.a3-scan-thumbs', shots.map(src => h('img', { src, alt: 'Biglietto fotografato' })),
        h('button.a3-scan-add', { type: 'button', 'aria-label': 'Aggiungi un\'altra foto', on: { click: () => native.click() } }, ic('plus', 22))),
      h('span.a3-sec-t', 'DOVE VI SIETE CONOSCIUTI? (FACOLTATIVO, DIVENTA LA PRIMA NOTA)'), chips, go);
    go.addEventListener('click', async () => {
      intro.remove();
      const text = `${shots.length === 1 ? 'Crea il contatto da questo biglietto da visita.' : 'Crea i contatti da questi biglietti da visita.'}${st.where ? ` Ci siamo conosciuti: ${st.where.toLowerCase()}.` : ''}`;
      await chat.send(text, { images: shots.slice() });
    });
    fill(view, h('div.a3-page.a3-reader',
      h('header.a3-bar', h('a.a3-back', { href: '#/crm' }, ic('chevron-left', 22), 'CRM'), h('strong', shots.length ? 'Biglietto' : 'Dettalo ad Alma'), h('span')),
      shots.length ? intro : h('p.a3-muted', 'Di\' o scrivi nome, azienda, telefono ed email: Alma prepara la scheda e tu la confermi.'),
      h('div.a3-chat', chat.el)));
    await chat.open(null);
    if (!shots.length) chat.focus();
  }

  if (voiceMode) { await reader(); return leave; }
  fill(view, h('div.a3-cam',
    h('header.a3-cam-top', h('a.a3-cam-round', { href: '#/crm', 'aria-label': 'Chiudi' }, ic('x', 22)), h('strong', 'Inquadra il biglietto'), flashBtn),
    h('div.a3-cam-view', video, h('div.a3-cam-frame', h('i'), h('i'), h('i'), h('i')), h('span.a3-cam-hint', 'Anche più biglietti insieme · fronte e retro')),
    h('div.a3-cam-bottom',
      h('button.a3-cam-side', { type: 'button', on: { click: () => pick.click() } }, ic('image', 22), 'Galleria'),
      h('button.a3-shutter', { type: 'button', 'aria-label': 'Scatta la foto', on: { click: shoot } }, h('span')),
      h('button.a3-cam-side', { type: 'button', on: { click: () => { leave(); contactSheet(); } } }, ic('pencil', 22), 'A mano')),
    pick, native));
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    video.srcObject = stream;
    const caps = stream.getVideoTracks()[0].getCapabilities?.() || {};
    flashBtn.style.visibility = caps.torch ? 'visible' : 'hidden';
  } catch {
    // niente fotocamera dal browser (permesso negato, iPhone vecchio…): si usa la fotocamera del telefono
    fill(view.querySelector('.a3-cam-view'), h('button.a3-cam-fallback', { type: 'button', on: { click: () => native.click() } }, ic('camera', 34), 'Tocca per fotografare il biglietto'));
  }
  return leave;
}

// ═══ Il mio biglietto: QR grande, condividi, WhatsApp ════════════════════════════════════════════════════
export async function mioBiglietto(view) {
  fill(view, loading());
  const d = await get('/api/biglietto');
  document.body.classList.add('a3-orange');
  let lock = null;
  try { lock = await navigator.wakeLock?.request('screen'); } catch { /* lo schermo può spegnersi */ }
  const qr = h('div.a3-qr', { role: 'img', 'aria-label': 'Codice QR del mio biglietto' });
  qr.innerHTML = d.qr; // SVG generato dal server (lib qrcode), non testo di utenti
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: `${d.profile.name} · Almacis`, text: 'Il mio biglietto da visita', url: d.url });
      else { await navigator.clipboard.writeText(d.url); toast('Link copiato'); }
    } catch { /* annullato */ }
  };
  const role = [d.card.role || d.profile.job_title, d.profile.unit].filter(Boolean).join(' · ') || 'Almacis';
  fill(view, h('div.a3-page.a3-mio',
    h('header.a3-bar.light', h('button.a3-cam-round', { type: 'button', 'aria-label': 'Chiudi', on: { click: () => document.getElementById('back')?.click() } }, ic('x', 22)),
      h('strong', 'Il mio biglietto'), h('a.a3-textbtn.light', { href: '#/biglietto?modifica=1' }, 'Modifica')),
    h('div.a3-mio-card',
      h('div.a3-mio-who', avatar(store.me, 54), h('div', h('strong', d.profile.name), h('span', role))),
      qr,
      h('span.a3-muted.center', 'Fallo inquadrare con la fotocamera: salva il tuo contatto e può lasciarti il suo.')),
    h('div.a3-grid2',
      h('button.a3-btn.primary', { type: 'button', on: { click: share } }, ic('share', 18), 'Condividi'),
      h('a.a3-btn', { href: `https://wa.me/?text=${encodeURIComponent(`Il mio biglietto da visita: ${d.url}`)}`, target: '_blank', rel: 'noopener' }, ic('message', 18), 'WhatsApp')),
    h('a.a3-mio-leads', { href: '#/crm/contatti/biglietti' }, h('b', String(d.leads_new || 0)), h('span', d.leads_new === 1 ? 'contatto lasciato dal tuo QR' : 'contatti lasciati dal tuo QR'), h('span', '›'))));
  return () => { document.body.classList.remove('a3-orange'); lock?.release?.().catch(() => {}); };
}

// ═══ Compiti: ticket, passi del CRM e RDA in una lista sola ═══════════════════════════════════════════════
export async function compitiView(view, params) {
  fill(view, loading());
  const dati = params.get('vista') === 'dati';
  const today = todayISO();
  const due = x => (x ? String(x).slice(0, 10) : null);
  const [mine, steps, rda, given, stepsGiven] = await Promise.all([
    get('/api/tickets?assignee=me&status=open'),
    store.me.crm ? get('/api/crm/steps?di=me', { quiet: true }).catch(() => ({ steps: [] })) : { steps: [] },
    get('/api/rda', { quiet: true }).catch(() => ({ inbox: [] })),
    get('/api/tickets?creator=me&status=open', { quiet: true }).catch(() => []),
    store.me.crm ? get('/api/crm/steps?di=dati', { quiet: true }).catch(() => ({ steps: [] })) : { steps: [] },
  ]);
  const reload = () => compitiView(view, params);
  const liveMine = mine.filter(t => !t.rda_state || t.rda_state === 'accepted');
  const givenT = given.filter(t => (t.assignee_ids || []).some(i => i !== store.me.id) && !(t.assignee_ids || []).includes(store.me.id));
  const items = dati
    ? [...givenT.map(t => ({ kind: 't', t, due: due(t.due_date), title: t.title, meta: `a ${(t.assignee_ids || []).map(i => firstName(userById(i))).filter(Boolean).join(', ')}` })),
      ...stepsGiven.steps.map(s => ({ kind: 's', s, due: s.due_date, title: s.title, meta: `a ${firstName({ id: s.owner_id, name: s.owner_name })} · ${s.subject_name}` }))]
    : [...liveMine.map(t => ({ kind: 't', t, due: due(t.due_date), title: t.title, meta: [t.project, t.created_by && t.created_by !== store.me.id ? `da ${firstName(userById(t.created_by))}` : null].filter(Boolean).join(' · ') || 'Ticket' })),
      ...steps.steps.map(s => ({ kind: 's', s, due: s.due_date, title: s.title, meta: `CRM · ${[s.contact_name, s.subject_name].filter(Boolean).join(' · ')}` })),
      ...(rda.inbox || []).map(t => ({ kind: 'r', t, due: today, title: `RDA: ${t.title}`, meta: `da decidere · ${userById(t.created_by)?.name || 'un collega'}` }))];
  const nMine = liveMine.length + steps.steps.length + (rda.inbox || []).length;
  const nGiven = givenT.length + stepsGiven.steps.length;
  if (!dati) setCompitiBadge(items.filter(x => x.due && x.due <= today).length);

  const doneOf = x => async () => {
    if (x.kind === 't') await ticketDone(x.t, reload);
    else if (x.kind === 's') { await post(`/api/crm/steps/${x.s.id}/done`, {}); toast(`«${x.title}» fatto`); reload(); }
    else location.hash = '#/inbox';
  };
  const laterOf = x => async () => {
    if (x.kind === 't') await ticketLater(x.t, reload);
    else if (x.kind === 's') { const to = nextWorkday(x.due && x.due > today ? x.due : today); await patch(`/api/crm/steps/${x.s.id}`, { due_date: to }); toast(`Rimandato a ${itDay(to)}`); reload(); }
  };
  const openOf = x => () => {
    if (x.kind === 't') ticketSheet(x.t.id, reload);
    else if (x.kind === 's') location.hash = x.s.contact_id ? `#/crm/persona/${x.s.contact_id}` : `#/crm/scheda/${x.s.subject_id}`;
    else location.hash = '#/inbox';
  };
  const row = x => {
    const late = x.due && x.due < today;
    const inner = h('div.a3-row.a3-task',
      h('button.a3-check', { type: 'button', class: late ? 'red' : '', 'aria-label': `Segna fatto: ${x.title}`, on: { click: e => { e.stopPropagation(); doneOf(x)(); } } }),
      h('span.a3-row-t', h('strong', x.title), h('small', x.meta)),
      x.due ? h('span.a3-due', { class: late ? 'red' : '' }, x.due === today ? 'oggi' : x.due === addDays(today, -1) ? 'ieri' : shortDay(x.due)) : null);
    return x.kind === 'r' || dati ? h('div.a3-tap', { on: { click: openOf(x) } }, inner)
      : swipeRow(inner, { right: { label: '✓ Fatto', run: doneOf(x) }, left: { label: 'Rimanda', run: laterOf(x) }, onTap: openOf(x) });
  };
  const byDue = (a, b) => String(a.due || '9').localeCompare(String(b.due || '9'));
  const groups = [
    ['IN RITARDO', items.filter(x => x.due && x.due < today), 'red'],
    ['OGGI', items.filter(x => x.due === today), 'ink'],
    ['PROSSIMI GIORNI', items.filter(x => x.due && x.due > today).sort(byDue), ''],
    ['SENZA DATA', items.filter(x => !x.due), ''],
  ].filter(([, l]) => l.length);
  fill(view, h('div.a3-page.a3-compiti',
    h('header.a3-head', h('h1.a3-title', 'Compiti'), h('div.a3-head-r', meBtn())),
    h('nav.a3-seg', { 'aria-label': 'Di chi' },
      h('a', { href: '#/compiti', class: dati ? '' : 'on', 'aria-current': dati ? null : 'page' }, `Per me · ${nMine}`),
      h('a', { href: '#/compiti?vista=dati', class: dati ? 'on' : '', 'aria-current': dati ? 'page' : null }, `Dati da me · ${nGiven}`)),
    h('button.a3-add', { type: 'button', on: { click: () => taskSheet({ onSaved: reload }) } }, ic('plus', 20), 'Aggiungi un compito…'),
    groups.length ? groups.map(([label, list, cls]) => h('section.a3-sec', h('span.a3-sec-t', { class: cls }, `${label} · ${list.length}`), h('div.a3-card.a3-list', list.slice(0, 60).map(row))))
      : h('div.a3-empty', ic('check', 26), h('strong', 'Tutto fatto'), h('small', dati ? 'Non hai compiti aperti dati ad altri.' : 'Niente in programma.')),
    dati ? null : h('p.a3-hint', 'Scorri a destra per «fatto», a sinistra per rimandare a domani.'),
    h('nav.a3-more-links', h('a', { href: '#/lavoro' }, 'Settimana e calendario'), h('a', { href: '#/tickets?di=tutti' }, 'Ticket di tutti'), h('a', { href: '#/projects' }, 'Progetti'))));
}
