// Storie dai cantieri sul telefono (canvas app 3.0, righe C1–C5, Dante 21/11/2026). I cantieri sono le commesse
// di BOSS (BSAL-1725): finché BOSS non le manda, la direzione le inserisce qui. Una foto va nella storia del cantiere
// (24 ore), nel post del giorno del cantiere in «Dai cantieri» e nel diario (per sempre).
import { h, fill, loading, toast } from './ui.js';
import { get, post, patch } from './api.js';
import { store, firstName } from './store.js';
import { icon } from './icons.js';
import { mediaUrl } from './media.js';
import { sheet } from './app2.js';
import { voiceButton } from './app3.js';

const ic = (name, size = 20) => icon(name, { size });
const itDay = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const ago = iso => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? 'ora' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} g`;
};
const meters = m => (m == null ? '' : m < 1000 ? `${m} m` : `${(m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km`);
const nameOf = p => firstName({ id: p.author_id, name: p.author_name }); // nome di battesimo (vedi lib/nome.js)

// posizione del telefono (senza bloccare: 4 secondi al massimo, poi si va avanti senza)
export function where() {
  return new Promise(ok => {
    if (!navigator.geolocation) { ok(null); return; }
    const t = setTimeout(() => ok(null), 4000);
    navigator.geolocation.getCurrentPosition(p => { clearTimeout(t); ok({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      () => { clearTimeout(t); ok(null); }, { enableHighAccuracy: true, maximumAge: 120000, timeout: 4000 });
  });
}
export async function nearbySites(pos) {
  const q = pos ? `?lat=${pos.lat.toFixed(6)}&lng=${pos.lng.toFixed(6)}` : '';
  return get(`/api/cantieri${q}`, { quiet: true }).catch(() => ({ cantieri: [], here: null }));
}
const siteIcon = (size = 20) => ic('hard-hat', size);
function dataToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg' });
}

// ═══ C1 · il pulsante grande in Agorà ══════════════════════════════════════════════════════════════════════
export function fotoButton() {
  const sub = h('small', 'Scegli il cantiere e scatta');
  const btn = h('a.a3-cfoto', { href: '#/cantieri/foto', hidden: true },
    h('span.a3-cfoto-ico', ic('camera', 22)), h('span.a3-cfoto-t', h('strong', 'Foto dal cantiere'), sub), h('span', { 'aria-hidden': 'true' }, '›'));
  (async () => {
    const first = await nearbySites(null);
    if (!first.cantieri.length) return; // nessun cantiere ancora: il pulsante non serve
    btn.hidden = false;
    const pos = await where();
    if (!pos) return;
    const d = await nearbySites(pos);
    const here = d.cantieri.find(c => c.id === d.here);
    if (here) sub.textContent = `Sei al cantiere ${here.name}`;
  })();
  return btn;
}

// storie dei cantieri, davanti a quelle delle persone nella fila delle storie
export function siteStories(bar) {
  if (!bar) return;
  const box = h('div.a3-site-stories');
  const place = () => { if (box.parentNode !== bar || bar.firstElementChild?.nextElementSibling !== box) bar.firstElementChild ? bar.firstElementChild.after(box) : bar.prepend(box); };
  new MutationObserver(() => { if (box.childElementCount) place(); }).observe(bar, { childList: true });
  get('/api/cantieri/storie', { quiet: true }).then(d => {
    const list = d?.storie || [];
    fill(box, list.map((s, i) => h('button.story-item.a3-site-story', { type: 'button', on: { click: () => openSiteStories(list, i) } },
      h('span.a3-site-ring', h('span', siteIcon(24))), h('span.story-name', s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name))));
    if (list.length) place();
  }).catch(() => {});
}

// ═══ C4 · storia del cantiere a schermo intero ════════════════════════════════════════════════════════════
export function openSiteStories(list, start = 0, { photoIndex = 0 } = {}) {
  let si = start, pi = photoIndex, timer = null;
  const root = h('div.a3-story', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Storia del cantiere' });
  const close = () => { clearTimeout(timer); root.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); };
  const step = d => {
    pi += d;
    if (pi >= list[si].photos.length) { si++; pi = 0; }
    if (pi < 0) { si--; pi = si >= 0 ? list[si].photos.length - 1 : 0; }
    if (si < 0 || si >= list.length) { close(); return; }
    draw();
  };
  function draw() {
    clearTimeout(timer);
    const s = list[si], p = s.photos[pi];
    fill(root,
      h('img.a3-story-img', { src: mediaUrl(p.media_id), alt: p.caption || `Foto del cantiere ${s.name}` }),
      h('div.a3-story-bars', s.photos.map((_, j) => h('span', h('i', { class: j < pi ? 'full' : j === pi ? 'run' : '' })))),
      h('header.a3-story-head',
        h('span.a3-story-site', siteIcon(22)),
        h('span.a3-story-who', h('strong', s.name), h('small', `foto di ${p.author_name || 'un collega'} · ${ago(p.created_at)}`)),
        h('button.a3-story-x', { type: 'button', 'aria-label': 'Chiudi', on: { click: close } }, ic('x', 24))),
      h('button.a3-story-prev', { type: 'button', 'aria-label': 'Foto precedente', on: { click: () => step(-1) } }),
      h('button.a3-story-next', { type: 'button', 'aria-label': 'Foto successiva', on: { click: () => step(1) } }),
      h('div.a3-story-foot',
        p.caption ? h('p', p.caption) : null,
        h('small', `${pi + 1} di ${s.photos.length} foto · ${[...new Set(s.photos.map(x => nameOf(x)))].filter(Boolean).join(', ')}`),
        h('div.a3-story-btns',
          h('a.a3-btn.light.wide', { href: `#/cantieri/${s.id}`, on: { click: close } }, ic('file-text', 18), 'Apri il diario'))));
    timer = setTimeout(() => step(1), 6000);
  }
  document.addEventListener('keydown', onKey);
  document.getElementById('overlay-root').append(root);
  draw();
}

// ═══ C2 + C3 · fotocamera con il cantiere già scelto, poi «Pubblica» ═══════════════════════════════════════
export async function fotoPage(view) {
  document.body.classList.add('a3-dark');
  let stream = null, pos = null;
  const stop = () => { stream?.getTracks().forEach(t => t.stop()); stream = null; };
  const leave = () => { stop(); document.body.classList.remove('a3-dark'); };
  const state = { sites: [], site: null, shots: [] };
  const video = h('video.a3-cam-video', { autoplay: true, playsInline: true, muted: true });
  video.setAttribute('playsinline', '');
  const pick = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const native = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const chip = h('button.a3-cam-chip', { type: 'button', on: { click: () => chooseSite(() => drawChip()) } });
  const drawChip = () => fill(chip, ic('map-pin', 18), state.site ? `${state.site.name}${state.site.distance != null ? ` · ${meters(state.site.distance)}` : ''}` : 'Scegli il cantiere', ic('chevron-down', 16));
  drawChip();

  const shrink = (src, w, hh) => {
    const k = Math.min(1, 1920 / Math.max(w, hh));
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * k); cv.height = Math.round(hh * k);
    cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.85);
  };
  // FileReader → data: (la CSP della pagina non permette le immagini blob:)
  const fileToData = f => new Promise((ok, ko) => {
    const fr = new FileReader();
    fr.onerror = ko;
    fr.onload = () => { const img = new Image(); img.onload = () => ok(shrink(img, img.naturalWidth, img.naturalHeight)); img.onerror = ko; img.src = fr.result; };
    fr.readAsDataURL(f);
  });
  const fromFiles = async files => {
    for (const f of [...files].slice(0, 10 - state.shots.length)) { try { state.shots.push(await fileToData(f)); } catch { toast('Questa foto non si apre', 'err'); } }
    if (state.shots.length) publishStep();
  };
  pick.addEventListener('change', () => { fromFiles(pick.files); pick.value = ''; });
  native.addEventListener('change', () => { fromFiles(native.files); native.value = ''; });
  const shoot = () => {
    if (!video.videoWidth) { native.click(); return; }
    state.shots.push(shrink(video, video.videoWidth, video.videoHeight));
    publishStep();
  };

  function chooseSite(after) {
    const close = sheet(h('div.a3-form',
      h('div.a3-sheet-head', h('h2', 'Quale cantiere?')),
      h('div.a3-card.a3-list', state.sites.map(c => h('button.a3-row.a3-site-row', { type: 'button', on: { click: () => { state.site = c; close(); after?.(); } } },
        h('span.a3-ini.sq.or', siteIcon(18)),
        h('span.a3-row-t', h('strong', c.name), h('small', [c.code, c.distance != null ? meters(c.distance) : null, c.mine ? 'la mia squadra' : null].filter(Boolean).join(' · '))),
        state.site?.id === c.id ? ic('check', 18) : null))),
      store.me.is_admin ? h('a.a3-link.center', { href: '#/cantieri', on: { click: () => close() } }, 'Gestisci i cantieri') : null), { label: 'Quale cantiere?', tall: true });
  }

  // C3: anteprima, cantiere, frase (anche dettata) e un solo pulsante
  function publishStep() {
    stop();
    document.body.classList.remove('a3-dark');
    const caption = h('input.a3-search-in', { placeholder: 'Cosa si vede? (facoltativo)', maxlength: 500, 'aria-label': 'Didascalia' });
    const voice = voiceButton({ label: '', onText: t => { caption.value = caption.value ? `${caption.value} ${t}` : t; } });
    if (voice) { voice.classList.add('a3-mic', 'a3-mic-or'); voice.setAttribute('aria-label', 'Detta'); }
    const chips = h('div.a3-chips.a3-site-chips');
    const drawChips = () => fill(chips, state.sites.slice(0, 6).map(c => h('button.a3-chip', { type: 'button', class: state.site?.id === c.id ? 'on' : '', 'aria-pressed': String(state.site?.id === c.id),
      on: { click: () => { state.site = c; drawChips(); } } }, state.site?.id === c.id ? siteIcon(16) : null, c.name, c.distance != null && c.distance <= 500 ? ' · qui' : '')),
    state.sites.length > 6 ? h('button.a3-chip', { type: 'button', on: { click: () => chooseSite(drawChips) } }, 'Altri…') : null);
    drawChips();
    const thumbs = h('div.a3-pub-thumbs');
    const drawThumbs = () => fill(thumbs, state.shots.map((src, i) => h('span.a3-pub-thumb', h('img', { src, alt: `Foto ${i + 1}` }),
      h('button', { type: 'button', 'aria-label': 'Togli', on: { click: () => { state.shots.splice(i, 1); if (!state.shots.length) { location.hash = '#/benvenuto'; return; } drawThumbs(); } } }, ic('x', 14)))),
    state.shots.length < 10 ? h('button.a3-pub-add', { type: 'button', 'aria-label': 'Altra foto', on: { click: () => native.click() } }, ic('plus', 22)) : null);
    drawThumbs();
    const go = h('button.a3-btn.a3-pub-go', { type: 'button' }, state.shots.length > 1 ? `Pubblica ${state.shots.length} foto` : 'Pubblica');
    go.addEventListener('click', async () => {
      if (!state.site) { toast('Scegli il cantiere', 'err'); return; }
      go.disabled = true; go.textContent = 'Pubblico…';
      try {
        for (const [i, src] of state.shots.entries()) {
          const blob = dataToBlob(src); // non fetch(data:…): la CSP della pagina lo blocca
          const img = await new Promise(ok => { const m = new Image(); m.onload = () => ok(m); m.onerror = () => ok(null); m.src = src; });
          const res = await fetch(`/api/media${img ? `?w=${img.naturalWidth}&h=${img.naturalHeight}` : ''}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg', 'X-Alma': '1' }, body: blob });
          const media = await res.json();
          if (!res.ok) throw new Error(media.error || 'Foto non caricata');
          await post(`/api/cantieri/${state.site.id}/foto`, { media_id: media.id, caption: i === 0 ? caption.value.trim() : '', ...(pos ? { lat: pos.lat, lng: pos.lng } : {}) });
        }
        toast(`Pubblicata nel cantiere ${state.site.name}`);
        location.hash = '#/benvenuto';
      } catch (err) { toast(err.message || 'Non pubblicata', 'err'); go.disabled = false; go.textContent = 'Riprova'; }
    });
    const when = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    fill(view, h('div.a3-page.a3-pub',
      h('div.a3-pub-img', h('img', { src: state.shots[0], alt: 'Foto scattata' }),
        h('button.a3-cam-round.a3-pub-back', { type: 'button', 'aria-label': 'Rifai la foto', on: { click: () => { state.shots = []; fotoPage(view); } } }, ic('chevron-left', 22)),
        h('span.a3-pub-when', `Oggi ${when}${pos ? ' · posizione salvata' : ''}`)),
      thumbs,
      h('div.a3-f', h('span', 'Quale cantiere?'), chips),
      h('label.a3-search', caption, voice),
      h('div.a3-card.a3-pub-info',
        h('span', ic('check', 18), 'Nella storia del cantiere per 24 ore'),
        h('span', ic('check', 18), 'In «Dai cantieri» e nel diario, per sempre')),
      go, pick, native));
  }

  fill(view, h('div.a3-cam',
    h('header.a3-cam-top', h('a.a3-cam-round', { href: '#/benvenuto', 'aria-label': 'Chiudi', on: { click: leave } }, ic('x', 22)), chip, h('span', { style: { width: '44px' } })),
    h('div.a3-cam-view', video, h('span.a3-cam-hint', 'Il cantiere lo trova il telefono: se è un altro, toccalo in alto')),
    h('div.a3-cam-bottom',
      h('button.a3-cam-side', { type: 'button', on: { click: () => pick.click() } }, ic('image', 22), 'Galleria'),
      h('button.a3-shutter', { type: 'button', 'aria-label': 'Scatta la foto', on: { click: shoot } }, h('span')),
      h('span.a3-cam-side')),
    pick, native));
  // cantiere: il più vicino (o della mia squadra), mentre la fotocamera si accende
  (async () => {
    const first = await nearbySites(null);
    state.sites = first.cantieri; state.site = state.site || first.cantieri[0] || null; drawChip();
    if (!first.cantieri.length) toast('Non ci sono ancora cantieri: li aggiunge la direzione (poi arriveranno da BOSS)', 'err');
    pos = await where();
    if (pos) { const d = await nearbySites(pos); state.sites = d.cantieri; if (d.here) state.site = d.cantieri.find(c => c.id === d.here); else if (!state.site) state.site = d.cantieri[0]; drawChip(); }
  })();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    video.srcObject = stream;
  } catch {
    fill(view.querySelector('.a3-cam-view'), h('button.a3-cam-fallback', { type: 'button', on: { click: () => native.click() } }, ic('camera', 34), 'Tocca per fotografare'));
  }
  return leave;
}

// ═══ C5 · diario del cantiere ═════════════════════════════════════════════════════════════════════════════
export async function diarioPage(view, id, params) {
  fill(view, loading());
  const vista = ['giorni', 'prima', 'video'].includes(params.get('vista')) ? params.get('vista') : 'giorni';
  const d = await get(`/api/cantieri/${id}/diario`).catch(() => null);
  if (!d) { fill(view, h('div.a3-page', h('div.a3-empty', h('strong', 'Cantiere non trovato')))); return null; }
  const c = d.cantiere, st = d.stats;
  const days = st.first_day ? Math.max(1, Math.round((Date.now() - new Date(`${st.first_day}T12:00:00`)) / 86400000) + 1) : 0;
  const reload = () => diarioPage(view, id, params);
  const body = h('div.a3-diario-body');
  const seg = (k, l) => h('a', { href: `#/cantieri/${id}${k === 'giorni' ? '' : `?vista=${k}`}`, class: vista === k ? 'on' : '', 'aria-current': vista === k ? 'page' : null }, l);
  const zip = () => { location.href = `/api/cantieri/${id}/zip`; };
  let cleanup = null;
  fill(view, h('div.a3-page.a3-diario',
    h('header.a3-bar', h('a.a3-back', { href: '#/benvenuto?filtro=cantieri' }, ic('chevron-left', 22), 'Agorà'),
      st.photos ? h('button.a3-chip', { type: 'button', on: { click: zip } }, ic('download', 16), 'Scarica per il SAL') : null),
    h('div.a3-who',
      h('span.a3-ini.xl.sq.or', siteIcon(28)),
      h('div.a3-who-t', h('h1', c.name), h('span.a3-muted', [c.address, c.code ? `commessa ${c.code}` : null, c.chief_email ? `capo cantiere ${c.chief_email.split('@')[0].split(/[._-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}` : null].filter(Boolean).join(' · ')))),
    h('div.a3-card.a3-nums3',
      h('span', h('strong', String(days)), h('small', days === 1 ? 'giorno' : 'giorni')),
      h('span', h('strong', String(st.photos)), h('small', 'foto')),
      h('span', h('strong', String(st.people)), h('small', st.people === 1 ? 'persona' : 'persone'))),
    h('nav.a3-seg.a3-seg3', { 'aria-label': 'Vista' }, seg('giorni', 'Per giorno'), seg('prima', 'Prima / dopo'), seg('video', 'Video')),
    body));
  if (!st.photos) {
    fill(body, h('div.a3-empty', ic('camera', 26), h('strong', 'Ancora nessuna foto'), h('a.a3-btn.primary', { href: '#/cantieri/foto' }, 'Foto dal cantiere')));
    return null;
  }
  if (vista === 'giorni') {
    const flat = d.days.flatMap(x => x.photos);
    const story = startId => openSiteStories([{ id: c.id, name: c.name, photos: flat }], 0, { photoIndex: flat.findIndex(p => p.id === startId) });
    const hideBtn = p => (d.can_hide_all || p.author_id === store.me.id)
      ? h('button.a3-dhide', { type: 'button', 'aria-label': 'Nascondi la foto', on: { click: async e => {
        e.stopPropagation();
        if (!confirm('Nascondere questa foto? Sparisce da storia, bacheca e diario.')) return;
        await post(`/api/cantieri/foto/${p.id}/nascondi`, {}); toast('Foto nascosta'); reload();
      } } }, ic('x', 12)) : null;
    fill(body, d.days.map(day => h('section.a3-sec',
      h('div.a3-dday', h('span.a3-sec-t', itDay(day.day).toUpperCase()), h('small.a3-muted', [...new Set(day.photos.map(p => nameOf(p)))].filter(Boolean).join(', '))),
      h('div.a3-dgrid', day.photos.map(p => h('button.a3-dph', { type: 'button', 'aria-label': p.caption || 'Apri la foto', on: { click: () => story(p.id) } },
        h('img', { src: mediaUrl(p.media_id), alt: '', loading: 'lazy' }), hideBtn(p)))))),
    d.more ? h('p.a3-hint', 'Le foto più vecchie arrivano scorrendo nelle prossime versioni.') : null);
  } else {
    const line = (await get(`/api/cantieri/${id}/linea`)).line;
    if (vista === 'prima') {
      // prima / dopo: la prima foto del primo giorno e quella dell'ultimo, con un cursore
      const a = line[0], b = line[line.length - 1];
      const range = h('input.a3-pd-range', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Sposta tra prima e dopo' });
      const after = h('div.a3-pd-after', h('img', { src: mediaUrl(b.media_id), alt: `Dopo, ${itDay(b.day)}` }));
      range.addEventListener('input', () => { after.style.clipPath = `inset(0 0 0 ${range.value}%)`; });
      after.style.clipPath = 'inset(0 0 0 50%)';
      fill(body, line.length < 2 ? h('div.a3-empty', h('strong', 'Serve almeno un secondo giorno di foto')) : [
        h('div.a3-pd', h('img', { src: mediaUrl(a.media_id), alt: `Prima, ${itDay(a.day)}` }), after,
          h('span.a3-pd-l', itDay(a.day)), h('span.a3-pd-r', itDay(b.day))),
        range]);
    } else {
      // video: una foto per giorno, in ordine, come un filmato dell'avanzamento
      let i = 0, playing = true;
      const img = h('img', { src: mediaUrl(line[0].media_id), alt: '' });
      const label = h('span.a3-pd-l', itDay(line[0].day));
      const bar = h('i');
      const playBtn = h('button.a3-btn', { type: 'button' }, 'Pausa');
      const tick = () => { i = (i + 1) % line.length; img.src = mediaUrl(line[i].media_id); label.textContent = itDay(line[i].day); bar.style.width = `${((i + 1) / line.length) * 100}%`; };
      let t = setInterval(tick, 900);
      playBtn.addEventListener('click', () => { playing = !playing; playBtn.textContent = playing ? 'Pausa' : 'Riproduci'; clearInterval(t); if (playing) t = setInterval(tick, 900); });
      cleanup = () => clearInterval(t);
      fill(body, h('div.a3-pd', img, label), h('span.a3-vbar', bar), h('div.a3-grid2', playBtn, h('span.a3-muted.center', `${line.length} giorni di cantiere`)));
    }
  }
  return cleanup;
}

// ═══ elenco e gestione dei cantieri (la direzione, finché BOSS non li manda) ═══════════════════════════════
export async function cantieriPage(view) {
  fill(view, loading());
  const d = await get('/api/cantieri?tutti=1');
  const reload = () => cantieriPage(view);
  const edit = (c = {}) => {
    const f = (label, el) => h('label.a3-f', h('span', label), el);
    const inp = (k, ph, type = 'text') => h('input.a3-in', { type, value: c[k] ?? '', placeholder: ph || '' });
    const code = inp('code', '2026-041'), name = inp('name', 'Scuola Via Roma'), client = inp('client'), address = inp('address');
    const lat = inp('lat', '42.51', 'number'), lng = inp('lng', '14.14', 'number');
    lat.step = lng.step = 'any';
    const chief = inp('chief_email', 'nome.cognome@almacis.it', 'email');
    const team = h('textarea.a3-note', { rows: 3, placeholder: 'Un\'email per riga' }); team.value = (c.member_emails || []).join('\n');
    const status = h('select.a3-in', h('option', { value: 'aperto', selected: c.status !== 'chiuso' }, 'Aperto'), h('option', { value: 'chiuso', selected: c.status === 'chiuso' }, 'Chiuso'));
    const here = h('button.a3-chip', { type: 'button', on: { click: async () => { const p = await where(); if (!p) { toast('Posizione non disponibile', 'err'); return; } lat.value = p.lat.toFixed(6); lng.value = p.lng.toFixed(6); } } }, ic('map-pin', 16), 'Sono qui');
    const save = h('button.a3-btn.primary.wide', { type: 'button' }, c.id ? 'Salva' : 'Aggiungi il cantiere');
    save.addEventListener('click', async () => {
      const b = { code: code.value.trim(), name: name.value.trim(), client: client.value.trim(), address: address.value.trim(), lat: lat.value || null, lng: lng.value || null,
        chief_email: chief.value.trim(), member_emails: team.value.split(/[\s,;]+/).filter(Boolean), status: status.value };
      try { if (c.id) await patch(`/api/cantieri/${c.id}`, b); else await post('/api/cantieri', b); close(); toast('Cantiere salvato'); reload(); }
      catch (err) { toast(err.message || 'Non salvato', 'err'); }
    });
    const fromBoss = c.source === 'boss';
    const close = sheet(h('div.a3-form',
      h('div.a3-sheet-head', h('h2', c.id ? c.name : 'Nuovo cantiere'), h('button.a3-textbtn', { type: 'button', on: { click: () => close() } }, 'Annulla')),
      fromBoss ? h('p.a3-muted', 'Arriva da BOSS: codice, nome, squadra e stato si cambiano in BOSS. Qui puoi completare indirizzo e posizione.') : null,
      fromBoss ? null : f('Codice commessa BOSS', code), fromBoss ? null : f('Nome', name), fromBoss ? null : f('Committente', client),
      f('Indirizzo', address),
      h('div.a3-f', h('span', 'Posizione (per proporre il cantiere più vicino)'), h('div.a3-grid2', lat, lng), here),
      fromBoss ? null : f('Capo cantiere (email)', chief), fromBoss ? null : f('Squadra', team), fromBoss ? null : f('Stato', status),
      save), { label: 'Cantiere', tall: true });
  };
  const open = d.cantieri.filter(c => c.status === 'aperto'), closed = d.cantieri.filter(c => c.status !== 'aperto');
  const row = c => h('a.a3-row', { href: `#/cantieri/${c.id}` },
    h('span.a3-ini.sq.or', siteIcon(18)),
    h('span.a3-row-t', h('strong', c.name), h('small', [c.code, `${c.photos} foto`, c.source === 'boss' ? 'da BOSS' : null, c.lat == null ? 'senza posizione' : null].filter(Boolean).join(' · '))),
    d.can_manage ? h('button.a3-chip', { type: 'button', on: { click: e => { e.preventDefault(); e.stopPropagation(); edit(c); } } }, 'Modifica') : null);
  fill(view, h('div.a3-page',
    h('header.a3-bar', h('a.a3-back', { href: '#/benvenuto' }, ic('chevron-left', 22), 'Agorà'),
      d.can_manage ? h('button.a3-textbtn.strong', { type: 'button', on: { click: () => edit() } }, '+ Cantiere') : null),
    h('h1.a3-title', 'Cantieri'),
    h('p.a3-muted', 'Sono le commesse di BOSS: arriveranno da lì in automatico. Finché non c\'è il collegamento, li aggiunge la direzione con il codice commessa.'),
    open.length ? h('section.a3-sec', h('span.a3-sec-t', `APERTI · ${open.length}`), h('div.a3-card.a3-list', open.map(row))) : h('div.a3-empty', ic('hard-hat', 26), h('strong', 'Nessun cantiere ancora')),
    closed.length ? h('section.a3-sec', h('span.a3-sec-t', `CHIUSI · ${closed.length}`), h('div.a3-card.a3-list', closed.map(row))) : null,
    h('a.a3-btn.primary.wide', { href: '#/cantieri/foto' }, ic('camera', 18), 'Foto dal cantiere')));
}
