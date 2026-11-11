// Alma Planet: pagina di benvenuto (proposta E). Saluto e azioni rapide, scorciatoie, strategia (True North, A3,
// revisione), storie in evidenza (persone, eventi, idee, «Grazie a…», novità dagli A3), bacheca e le mie cose.
import { h, fill, avatar, timeAgo, loading, modal, toast } from './ui.js';
import { get, put, post, del } from './api.js';
import { store, userById, firstName } from './store.js';
import { icon } from './icons.js';
import { openPost, openComposer } from './feed.js';
import { openGrazie } from './grazie.js';
import { mediaUrl } from './media.js';
import { openRdaForm } from './rda.js';
import { CATEGORIES, statusPill } from './ideas.js';

const ICONS = { clock: 'Orologio', 'hard-hat': 'Cantiere', gift: 'Regalo', headset: 'Assistenza', external: 'Link esterno', link: 'Link',
  calendar: 'Calendario', mail: 'Posta', 'file-text': 'Documento', users: 'Persone', building: 'Azienda', cloud: 'Cloud', package: 'Pacchetto', car: 'Auto' };
const nameOf = id => userById(id)?.name || 'Ex collega';
const excerpt = (s, n) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

function greeting() {
  const hr = new Date().getHours();
  return hr < 13 ? 'Buongiorno' : hr < 18 ? 'Buon pomeriggio' : 'Buonasera';
}

// «Ticket sistema azienda» (assistenza IT): ora porta ad Alma IT, dove si segnala un problema
const IT_SHORTCUT = /ticket.*sistem|assistenza\s*it|help\s*desk/i;
function shortcutCard(s, canEdit, edit) {
  if (IT_SHORTCUT.test(s.label || '')) s = { ...s, url: '#/it/strumenti', hint: 'Assistenza IT: ora porta ad Alma IT', icon: s.icon || 'life-buoy' };
  const inner = [h('span.wl-ico', icon(s.icon || 'external', { size: 22 })),
    h('span.wl-text', h('strong', s.label), h('span.small.muted', s.url ? s.hint : (canEdit ? 'Indirizzo da impostare' : 'In arrivo')))];
  if (!s.url) return h(canEdit ? 'button.card.wl-shortcut.is-off' : 'div.card.wl-shortcut.is-off', canEdit ? { type: 'button', on: { click: edit } } : {}, inner);
  const external = /^https?:/i.test(s.url);
  return h('a.card.wl-shortcut', { href: s.url, ...(external ? { target: '_blank', rel: 'noopener' } : {}) },
    inner, external ? h('span.wl-out', icon('external', { size: 14 })) : null);
}

// Editor delle scorciatoie (amministratori).
function editShortcuts(list, onSaved) {
  const rows = h('div.wl-edit');
  const items = list.map(s => ({ ...s }));
  const draw = () => fill(rows, items.map((s, i) => h('div.wl-edit-row',
    h('div.grid-2',
      h('label.field', h('span', 'Nome'), h('input.input', { value: s.label, maxlength: 60, on: { input: e => { s.label = e.target.value; } } })),
      h('label.field', h('span', 'Icona'), h('select.select', { on: { change: e => { s.icon = e.target.value; } } },
        Object.entries(ICONS).map(([k, l]) => h('option', { value: k, selected: k === s.icon }, l))))),
    h('label.field', h('span', 'Descrizione'), h('input.input', { value: s.hint, maxlength: 120, on: { input: e => { s.hint = e.target.value; } } })),
    h('label.field', h('span', 'Indirizzo'), h('input.input', { value: s.url, type: 'url', placeholder: 'https://…', on: { input: e => { s.url = e.target.value; } } })),
    h('div.row-actions',
      i > 0 ? h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => { items.splice(i - 1, 0, items.splice(i, 1)[0]); draw(); } } }, 'Sposta su') : null,
      h('button.btn.btn-ghost.btn-sm.btn-danger', { type: 'button', on: { click: () => { items.splice(i, 1); draw(); } } }, 'Togli')))));
  draw();
  const m = modal({
    title: 'Scorciatoie della pagina di benvenuto',
    wide: true,
    body: [h('p.muted.small', 'Le vedono tutti in cima alla pagina di benvenuto. Senza indirizzo la scorciatoia resta in grigio.'), rows],
    left: [h('button.btn.btn-sm', { type: 'button', on: { click: () => { items.push({ label: '', hint: '', url: '', icon: 'external' }); draw(); } } }, icon('plus', { size: 14 }), 'Aggiungi scorciatoia')],
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (items.some(s => !s.label.trim())) { toast('Ogni scorciatoia ha bisogno di un nome', 'err'); return; }
        const r = await put('/api/welcome/shortcuts', { shortcuts: items });
        m.close();
        toast('Scorciatoie salvate');
        onSaved(r.shortcuts);
      } } }, 'Salva'),
    ],
  });
}

// ═══ La pagina di benvenuto (proposta E: strategia e bacheca) ═══════════════════════════════════════
// In alto saluto e azioni rapide, scorciatoie, il riquadro della strategia (True North, pillar, A3, revisione),
// le «storie» in evidenza; al centro la bacheca (idee, news, novità dagli A3, «Grazie a…»); a destra le mie cose.
const MONTHS_SHORT = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
const itDate = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const surname = n => String(n || '').trim().split(/\s+/).pop().toLowerCase();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const kb = n => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const inDays = d => (d === 0 ? 'oggi' : d === 1 ? 'domani' : `fra ${d} giorni`);
function progressAt(p, iso) {
  let act = 0, exp = 0;
  for (const t of p.tasks || []) {
    if (t.closed_date && t.closed_date <= iso) act += t.weight;
    if (t.due_date && t.due_date <= iso) exp += t.weight;
  }
  return { act, exp, ok: act >= exp };
}


function newPoll(onDone) {
  const q = h('input.input', { maxlength: 200, placeholder: 'Es. Dove facciamo la cena di Natale?' });
  const opts = [0, 1, 2, 3].map(i => h('input.input', { maxlength: 120, placeholder: `Risposta ${i + 1}${i > 1 ? ' (facoltativa)' : ''}` }));
  const closes = h('input.input', { type: 'date' });
  const m = modal({
    title: 'Nuovo sondaggio della settimana',
    body: [h('label.field', h('span', 'Domanda'), q), h('div.wl-poll-edit', opts), h('label.field', h('span', 'Chiude il (facoltativo)'), closes),
      h('p.muted.small', 'Un sondaggio alla volta: quello aperto si chiude.')],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        await post('/api/welcome/polls', { question: q.value, options: opts.map(o => o.value.trim()).filter(Boolean), closes_on: closes.value || null });
        m.close(); toast('Sondaggio pubblicato'); onDone?.();
      } } }, 'Pubblica')],
  });
}

// elenco di una «storia»: persone, eventi, ringraziamenti, novità dagli A3
function storyModal(title, items, extra) {
  const m = modal({ title, body: [items.length ? h('div.wl-list', items) : h('p.muted', 'Niente da mostrare per ora.'), extra || null],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi')] });
  return m;
}
const personRow = (p, note) => h('a.wl-person', { href: `#/u/${p.id}` }, avatar(userById(p.id) || p, 40),
  h('span', h('strong', p.name), h('small', note || p.job_title || '')));

export async function welcomeView(view) {
  fill(view, loading());
  const year = new Date().getFullYear();
  const [d, home, hk] = await Promise.all([get('/api/welcome'), get('/api/welcome/home'),
    get(`/api/strategy?year=${year}`, { quiet: true }).catch(() => null)]);
  const reload = () => welcomeView(view);
  const my = home.my;
  const today = home.today;
  const dateLabel = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

  // ── intestazione e azioni rapide ──
  const approvals = my.approvals.scheda + my.approvals.rda;
  const quick = h('div.wl-quick',
    h('a.wl-qbtn', { href: '#/tickets' }, my.due ? `${plural(my.due, 'ticket', 'ticket')} da chiudere oggi` : 'I miei ticket', my.late ? h('span.wl-qlate', `${my.late} in ritardo`) : null),
    approvals ? h('a.wl-qbtn', { href: my.approvals.scheda ? '#/strategy/scheda' : '#/rda' }, `${approvals} da approvare`) : null,
    my.scheda === 'missing' ? h('a.wl-qbtn.wl-qmain', { href: '#/strategy/scheda' }, 'Compila la tua scheda') : null);

  // ── scorciatoie ──
  const shortcuts = h('nav.wl-sc', { 'aria-label': 'Scorciatoie' });
  const edit = () => editShortcuts(d.shortcuts, list => { d.shortcuts = list; drawShortcuts(); });
  const drawShortcuts = () => fill(shortcuts, d.shortcuts.map(s => shortcutCard(s, d.can_edit, edit)),
    d.can_edit ? h('button.card.wl-shortcut.wl-sc-add', { type: 'button', on: { click: edit } },
      h('span.wl-ico', icon('pencil', { size: 20 })), h('span.wl-text', h('strong', 'Modifica'), h('span.small.muted', 'Solo per gli amministratori'))) : null);
  drawShortcuts();

  // ── strategia ──
  let strategy = null;
  if (hk?.true_north || hk?.projects?.length) {
    const st = hk.projects.map(p => progressAt(p, today));
    const okN = st.filter(x => x.ok).length;
    const avg = k => (st.length ? Math.round(st.reduce((s, x) => s + x[k], 0) / st.length) : 0);
    const rv = home.review;
    strategy = h('section.wl-strat',
      h('div.wl-strat-main',
        h('span.wl-strat-k', `True North · Hoshin Kanri ${hk.year || year}`),
        h('p.wl-strat-tn', hk.true_north ? `“${hk.true_north}”` : 'Il True North non è ancora scritto.'),
        h('div.wl-strat-pillars', (hk.pillars || []).map(p => h('span.wl-pillar', { style: { '--pc': p.color } }, p.name)))),
      h('div.wl-strat-nums',
        h('div', h('span', 'A3 in linea'), h('strong.ok', `${okN} su ${st.length}`)),
        h('div', h('span', 'Avanzamento'), h('strong', `${avg('act')}%`), h('small', `atteso ${avg('exp')}%`)),
        rv.people ? h('div', h('span', `Revisione Q${rv.quarter}`), h('strong.warn', itDate(rv.deadline).slice(0, 5)), h('small', `${rv.closed} su ${rv.people} chiuse`)) : null,
        h('a', { href: '#/strategy/hoshin' }, 'Hoshin Kanri →')));
  }

  // ── storie in evidenza ──
  const ppl = home.people;
  const story = (label, inner, { ring = 'var(--orange)', badge, mini, onClick } = {}) =>
    h('button.wl-story', { type: 'button', on: { click: onClick } },
      h('span.wl-ring', { style: { '--rc': ring } }, inner, badge ? h('span.wl-badge', String(badge)) : null, mini ? h('span.wl-mini', mini) : null),
      h('span.wl-story-l', label));
  const face = p => h('span.wl-face', avatar(userById(p.id) || p, 58));
  const iconIn = (name, bg, fg) => h('span.wl-in', { style: { background: bg, color: fg } }, icon(name, { size: 26 }));
  const peopleStory = (label, list, mini, note) => story(label,
    list.length ? face(list[0]) : iconIn(mini, 'var(--rf-soft, #F1EFEB)', 'var(--muted)'),
    { ring: list.length ? 'var(--orange)' : '#E0DDD8', badge: list.length > 1 ? list.length : null, mini: list.length ? icon(mini, { size: 14 }) : null,
      onClick: () => storyModal(label, list.map(p => personRow(p, note(p)))) });
  const eventsList = () => home.events.map(e => h('div.wl-event', h('span.wl-day', h('strong', e.starts_on.slice(8, 10)), h('small', MONTHS_SHORT[Number(e.starts_on.slice(5, 7)) - 1])),
    h('span', h('strong', e.title), e.place ? h('small', e.place) : null),
    home.can_admin ? h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => { await del(`/api/welcome/events/${e.id}`); toast('Evento tolto'); reload(); } } }, 'Togli') : null));
  const addEvent = () => {
    const t = h('input.input', { maxlength: 160, placeholder: 'Es. Formazione sicurezza' });
    const dt = h('input.input', { type: 'date' });
    const pl = h('input.input', { maxlength: 160, placeholder: 'Facoltativo' });
    const m = modal({ title: 'Nuovo evento aziendale', body: [h('label.field', h('span', 'Titolo'), t), h('label.field', h('span', 'Data'), dt), h('label.field', h('span', 'Luogo'), pl)],
      actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
        h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await post('/api/welcome/events', { title: t.value, starts_on: dt.value, place: pl.value }); m.close(); toast('Evento aggiunto'); reload(); } } }, 'Aggiungi')] });
  };
  const pillars = hk?.pillars || [];
  const stories = h('nav.card.wl-stories', { 'aria-label': 'In evidenza' },
    peopleStory('Nuovi arrivi', ppl.arrivals, 'sprout', p => `Arrivato il ${itDate(p.hired_on)}${p.job_title ? ` · ${p.job_title}` : ''}`),
    peopleStory('Compleanni', ppl.birthdays, 'cake', p => `Compie gli anni ${inDays(p.in_days)}`),
    peopleStory('Anniversari', ppl.anniversaries, 'star', p => `${plural(p.years, 'anno', 'anni')} in azienda ${inDays(p.in_days)}`),
    story('Eventi', iconIn('calendar', '#E9F1FB', '#24658C'), { ring: '#4E9FCF', badge: home.events.length || null,
      onClick: () => storyModal('Prossimi eventi', eventsList(), home.can_admin ? h('button.btn.btn-sm', { type: 'button', on: { click: addEvent } }, icon('plus', { size: 14 }), 'Aggiungi evento') : null) }),
    story('Laboratorio idee', iconIn('lightbulb', '#F3E6F2', '#8A3A83'), { ring: '#BF62B6', badge: home.ideas.month || null, onClick: () => { location.hash = '#/idee'; } }),
    story('Grazie a…', iconIn('heart', '#E7F5EC', '#1F6A41'), { ring: '#2E8B57', badge: home.grazie.length || null,
      onClick: () => storyModal('Grazie a…', home.grazie.map(g => h('button.wl-person', { type: 'button', on: { click: () => openPost(g.id) } }, avatar(userById(g.author_id) || { name: '?' }, 40),
        h('span', h('strong', `${userById(g.author_id)?.name || 'Un collega'} → ${userById(g.thanked_id)?.name || 'un collega'}`), h('small', g.body.replace(/^Grazie a @\S+:\s*/, '')))) ),
        h('button.btn.btn-sm', { type: 'button', on: { click: () => openGrazie(pillars, reload) } }, icon('heart', { size: 14 }), 'Ringrazia un collega')) }),
    story('Novità dagli A3', iconIn('target', '#FBF1BF', '#6E5C00'), { ring: '#E3BE00', badge: home.a3.length || null,
      onClick: () => storyModal('Novità dagli A3 · ultime due settimane', home.a3.map(t => h('a.wl-person', { href: `#/strategy/a3/${t.project_id}` },
        h('span.wl-a3dot', { style: { background: t.color || '#E3BE00' } }), h('span', h('strong', `Chiusa «${t.activity}»`), h('small', `${t.project} · ${t.function_name || ''} · ${itDate(t.closed_date)}`))))) }),
    story('Pubblica', iconIn('plus', '#F7F6F3', '#5E5A55'), { ring: '#E0DDD8', onClick: () => openComposer({ onCreated: reload }) }));

  // ── colonna centrale: la bacheca ──
  const composer = h('section.card.wl-compose',
    avatar(store.me, 40),
    h('button.wl-compose-in', { type: 'button', on: { click: () => openComposer({ onCreated: reload }) } }, 'Condividi una novità con i colleghi'),
    h('button.btn.btn-sm', { type: 'button', on: { click: () => openGrazie(pillars, reload) } }, icon('heart', { size: 14 }), 'Ringrazia'));

  const ideaColor = { innovazione: ['#F3E6F2', '#8A3A83'], sostenibilita: ['#E7F5EC', '#1F6A41'], sicurezza: ['#FCEBE9', '#A3261B'], persone: ['#E9F1FB', '#24658C'] };
  const lab = h('section.card.wl-sum',
    h('div.wl-sum-head', h('h2', 'Laboratorio delle idee'), h('a', { href: '#/idee?new=1' }, 'Proponi un’idea →')),
    d.ideas.length ? h('div.wl-sum-grid.two', d.ideas.slice(0, 2).map(i => {
      const [, fg] = ideaColor[i.category] || ['#F1EFEB', '#5E5A55'];
      return h('a.wl-sum-tile.wl-idea', { href: `#/idee/${i.id}` },
        h('span.small', { style: { color: fg } }, `${CATEGORIES[i.category] || i.category} · ${String(statusPill(i.status).textContent || '').toLowerCase()}`),
        h('strong', i.title), h('span.small.muted', `${nameOf(i.author_id)} · ${plural(i.support_count, 'sostegno', 'sostegni')}`));
    })) : h('p.muted.small', 'Ancora nessuna idea: proponi la prima.'));

  const newsCard = p => h('article.card.wl-newscard',
    p.media_id ? h('button.wl-news-img', { type: 'button', on: { click: () => openPost(p.id) } }, h('img', { src: mediaUrl(p.media_id), alt: '', loading: 'lazy' }))
      : h('button.wl-news-cover', { type: 'button', on: { click: () => openPost(p.id) }, 'aria-label': 'Apri la news' },
        h('span.wl-news-cover-ico', icon('megaphone', { size: 28 })), h('span.wl-news-cover-k', `News aziendale · ${nameOf(p.author_id)}`)),
    h('div.wl-newscard-body',
      h('span.small.muted', h('span.pill.wl-newspill', 'News aziendale'), ` ${timeAgo(p.pinned_at || p.created_at)}`),
      h('button.wl-news-text-btn', { type: 'button', on: { click: () => openPost(p.id) } }, excerpt(p.body, 320)),
      h('span.small.muted', `${plural(p.likes || 0, 'mi piace', 'mi piace')} · ${plural(p.comments || 0, 'commento', 'commenti')}`)));

  const a3Card = home.a3.length ? h('article.card.wl-a3card',
    h('div.spread', h('span.row', h('span.wl-a3ico', icon('target', { size: 18 })), h('h2', 'Novità dagli A3')), h('a.small', { href: '#/strategy/dashboard' }, 'Dashboard A3')),
    home.a3.slice(0, 3).map(t => {
      const p = hk?.projects?.find(x => x.id === t.project_id);
      const s = p ? progressAt(p, today) : null;
      return h('a.wl-a3row', { href: `#/strategy/a3/${t.project_id}` },
        h('span.wl-a3row-t', h('strong', t.project), h('small', `Chiusa «${t.activity}» · ${t.function_name || ''} · ${itDate(t.closed_date)}`)),
        s ? h('span.wl-a3row-p', { class: s.ok ? 'ok' : 'ko' }, `${s.act}% / ${s.exp}%`) : null);
    })) : null;

  const postCardSmall = p => h('article.card.wl-postcard',
    h('div.row', avatar(userById(p.author_id) || { name: '?' }, 40), h('span.wl-post-who', h('strong', nameOf(p.author_id)), h('small', timeAgo(p.created_at)))),
    h('button.wl-news-text-btn', { type: 'button', on: { click: () => openPost(p.id) } }, excerpt(p.body, 260)),
    p.kind === 'grazie' ? h('span.pill.wl-grazie', `Grazie a…${p.pillar ? ` · ${p.pillar}` : ''}`) : null,
    p.media_id ? h('button.wl-post-img', { type: 'button', on: { click: () => openPost(p.id) } }, h('img', { src: mediaUrl(p.media_id), alt: '', loading: 'lazy' })) : null);

  const postTile = p => h('button.wl-sum-tile', { type: 'button', on: { click: () => openPost(p.id) } },
    h('strong', p.kind === 'grazie' ? `${nameOf(p.author_id)} → ${nameOf(p.thanked_id)}` : nameOf(p.author_id)),
    h('span.wl-sum-text', excerpt(p.kind === 'grazie' ? p.body.replace(/^Grazie a @\S+:\s*/, '') : p.body, 110)),
    h('span.small.muted', p.kind === 'grazie' ? '«Grazie a…»' : [p.likes ? plural(p.likes, 'mi piace', 'mi piace') : null, p.comments ? plural(p.comments, 'commento', 'commenti') : null].filter(Boolean).join(' · ') || timeAgo(p.created_at)));
  const fromFeed = h('section.card.wl-sum',
    h('div.wl-sum-head', h('h2', 'Dalla Bacheca'), h('a', { href: '#/' }, 'Vai alla Bacheca →')),
    home.posts.length ? h('div.wl-sum-grid', home.posts.slice(0, 3).map(postTile)) : h('p.muted.small', 'Ancora nessun post: scrivi il primo dalla Bacheca.'));

  void composer; void a3Card; void postCardSmall; // la Home del layout 11/11 non li mostra (A3 nelle storie, post in Bacheca)
  const feed = h('main.wl-feed',
    home.news.length ? home.news.slice(0, 1).map(newsCard) : (store.me.is_admin ? h('div.card.wl-empty', 'Nessuna news: metti in evidenza un post della bacheca (menu «…» del post) e comparirà qui.') : null),
    fromFeed, lab);

  // ── colonna di destra: le mie cose ──
  const mine = hk?.projects?.filter(p => surname(p.owner) && surname(p.owner) === surname(store.me.name)) || [];
  const mineOk = mine.filter(p => progressAt(p, today).ok).length;
  const contrib = h('section.card.wl-box',
    h('h2', 'Il mio contributo'),
    my.objectives ? h('div.wl-kv', h('span', 'Obiettivi raggiunti (pesato)'), h('strong', { class: my.objectives.achievement === null ? 'muted small' : my.objectives.achievement >= 90 ? 'ok' : my.objectives.achievement >= 70 ? 'warn' : 'ko' },
      my.objectives.achievement === null ? 'da misurare' : `${my.objectives.achievement}%`)) : h('div.wl-kv', h('span', 'Obiettivi dell’anno'), h('a', { href: '#/strategy/obiettivi' }, 'Scrivili')),
    mine.length ? h('div.wl-kv', h('span', 'I miei A3'), h('strong.small', `${mineOk} in linea · ${mine.length - mineOk} in ritardo`)) : null,
    my.scheda === 'missing' ? h('a.wl-cta', { href: '#/strategy/scheda' }, 'La tua scheda è da compilare →')
      : my.scheda === 'pending' ? h('div.wl-kv', h('span', 'La mia scheda'), h('span.pill.wl-wait', 'in approvazione'))
        : h('a.small', { href: '#/strategy/scheda' }, 'Apri la mia scheda →'));

  // «La mia giornata»: incontri di oggi (Outlook), i miei ticket, cosa aspetta me; il dettaglio è in Alma Project
  const agenda = h('div.wl-agenda', h('p.muted.small', 'Carico gli incontri di oggi…'));
  get(`/api/calendar?start=${today}T00:00:00&end=${today}T23:59:59`, { quiet: true }).then(cal => {
    const events = (cal?.events || []).filter(e => !e.allDay).sort((x, y) => String(x.start).localeCompare(String(y.start))).slice(0, 4);
    fill(agenda, events.length ? events.map(e => h('a.wl-meet', { href: '#/calendar' },
      h('span.wl-meet-h', String(e.start).slice(11, 16)), h('span.wl-meet-t', h('strong', { title: e.title || '' }, e.title || 'Incontro'), e.location ? h('small', { title: e.location }, /^https?:\/\//i.test(e.location) ? 'Collegamento alla riunione' : e.location) : null)))
      : h('p.muted.small', cal?.outlookError ? 'Calendario Outlook non raggiungibile.' : 'Nessun incontro oggi.'));
  }).catch(() => fill(agenda, h('p.muted.small', 'Calendario Outlook non raggiungibile.')));
  const itWaiting = h('strong', '…');
  get('/api/it/mine', { quiet: true }).then(it => { itWaiting.textContent = String((it?.requests || []).filter(r => r.status === 'da_rispondere').length + (it?.tickets || []).filter(t => ['nuovo', 'in_corso', 'linear'].includes(t.status)).length); }).catch(() => { itWaiting.textContent = '–'; });
  const dayBox = h('section.card.wl-box',
    h('div.spread', h('h2', 'La mia giornata'), h('a.small', { href: '#/settimana' }, 'La settimana →')),
    agenda,
    h('div.wl-daylist',
      h('a.wl-kv', { href: '#/tickets' }, h('span', 'Ticket in scadenza oggi'), h('strong', { class: my.due ? 'ko' : '' }, String(my.due || 0))),
      h('a.wl-kv', { href: '#/tickets' }, h('span', 'Ticket aperti'), h('strong', String(my.open ?? my.tickets.length))),
      h('a.wl-kv', { href: '#/rda' }, h('span', 'RDA da accettare'), h('strong', String(my.approvals.rda || 0))),
      h('a.wl-kv', { href: '#/it/strumenti' }, h('span', 'Richieste IT in corso'), itWaiting)));

  const eventsBox = home.events.length ? h('section.card.wl-box',
    h('div.spread', h('h2', 'Prossimi eventi'), h('button.link-btn.small', { type: 'button', on: { click: () => storyModal('Prossimi eventi', eventsList(),
      home.can_admin ? h('button.btn.btn-sm', { type: 'button', on: { click: addEvent } }, icon('plus', { size: 14 }), 'Aggiungi evento') : null) } }, 'Tutti')),
    eventsList().slice(0, 3)) : null;

  const pollBox = h('section.card.wl-box');
  const drawPoll = poll => {
    const voted = poll && poll.my_vote !== null;
    fill(pollBox,
      h('div.spread', h('h2', 'Sondaggio della settimana'), home.can_admin ? h('button.link-btn.small', { type: 'button', on: { click: () => newPoll(reload) } }, 'Nuovo') : null),
      poll ? [h('strong.wl-poll-q', poll.question),
        poll.options.map((o, i) => {
          const pct = poll.total ? Math.round(poll.counts[i] * 100 / poll.total) : 0;
          return h('button.wl-opt', { type: 'button', disabled: !poll.open, class: poll.my_vote === i ? 'on' : '', 'aria-pressed': String(poll.my_vote === i),
            on: { click: async () => drawPoll(await post(`/api/welcome/polls/${poll.id}/vote`, { choice: i })) } },
          voted || !poll.open ? h('span.wl-opt-bar', { style: { width: `${pct}%` } }) : null, h('span.wl-opt-t', o), voted || !poll.open ? h('span.wl-opt-n', `${pct}%`) : null);
        }),
        h('span.small.muted', [plural(poll.total, 'risposta', 'risposte'), poll.closes_on ? `chiude il ${itDate(poll.closes_on)}` : null, voted ? 'puoi cambiare la risposta' : null].filter(Boolean).join(' · ')),
        home.can_admin && poll.open ? h('button.link-btn.small', { type: 'button', on: { click: async () => { await post(`/api/welcome/polls/${poll.id}/close`); reload(); } } }, 'Chiudi il sondaggio') : null]
        : h('p.muted.small', home.can_admin ? 'Nessun sondaggio aperto: creane uno con «Nuovo».' : 'Nessun sondaggio aperto in questo momento.'));
  };
  drawPoll(home.poll);

  const side = h('aside.wl-side2', dayBox, contrib, pollBox, eventsBox); // «Il mio contributo» rimesso da Dante l'11/11

  fill(view, h('div.wl2',
    h('div.page-head.wl-head',
      h('div', h('span.wl-eyebrow', dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)), h('h1.wl-title', `${greeting()}, `, h('strong', firstName(store.me)))),
      quick),
    shortcuts, strategy, stories,
    h('div.wl-cols2', feed, side)));
}

// anteprima disegnata dell'organigramma (il PDF vero si apre con un clic)
function orgPreview() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 260 110');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<rect x="105" y="6" width="50" height="20" rx="4" fill="#FFF1E4" stroke="#FFC48F"/>'
    + '<path d="M130 26v12M40 38h180M40 38v10M100 38v10M160 38v10M220 38v10" stroke="#C9C4BE" stroke-width="1.5" fill="none"/>'
    + [18, 78, 138, 198].map(x => `<rect x="${x}" y="48" width="44" height="18" rx="4" fill="#FFF" stroke="#E0DDD8"/>`).join('')
    + '<path d="M40 66v10M30 76h20M30 76v8M50 76v8M100 66v18M160 66v10M150 76h20M150 76v8M170 76v8M220 66v18" stroke="#C9C4BE" stroke-width="1.5" fill="none"/>'
    + [20, 42, 90, 140, 162, 210].map(x => `<rect x="${x}" y="84" width="20" height="12" rx="3" fill="#F1EFEB"/>`).join('');
  return svg;
}

// Organigramma in PDF (lo carica un amministratore, lo vedono tutti): nella pagina Persone.
export function orgChartBox(home, reload) {
  const oc = home.orgchart;
  const upload = h('input', { type: 'file', accept: 'application/pdf', hidden: true, on: { change: async e => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) { toast('PDF troppo grande (massimo 15 MB)', 'err'); return; }
    const res = await fetch(`/api/welcome/orgchart?name=${encodeURIComponent(f.name)}`, { method: 'PUT', headers: { 'X-Alma': '1', 'Content-Type': 'application/pdf' }, body: f });
    if (!res.ok) { toast((await res.json().catch(() => ({}))).error || 'Caricamento non riuscito', 'err'); return; }
    toast('Organigramma aggiornato'); reload();
  } } });
  return h('section.card.wl-box',
    h('div.spread', h('h2', 'Organigramma'), oc ? h('span.small.muted', `aggiornato al ${itDate(oc.updated_at.slice(0, 10))}`) : null),
    oc ? [h('a.wl-org-prev', { href: '/api/welcome/orgchart', target: '_blank', rel: 'noopener', 'aria-label': 'Apri l’organigramma in PDF' }, orgPreview()),
      h('div.wl-org-file', h('span.wl-pdf', 'PDF'), h('span', oc.name), h('small.muted', kb(oc.size))),
      h('div.wl-two', h('a.btn.btn-sm.wl-dark', { href: '/api/welcome/orgchart', target: '_blank', rel: 'noopener' }, 'Apri'), h('a.btn.btn-sm', { href: '/api/welcome/orgchart?download=1' }, 'Scarica'))]
      : h('p.muted.small', home.can_admin ? 'Carica il PDF dell’organigramma: lo vedranno tutti qui.' : 'L’organigramma non è ancora stato caricato.'),
    home.can_admin ? [upload, h('button.link-btn.small', { type: 'button', on: { click: () => upload.click() } }, oc ? 'Carica una nuova versione' : 'Carica il PDF')] : null);

}
