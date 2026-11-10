// Alma Planet: Laboratorio delle idee. Ognuno propone innovazioni e miglioramenti, i colleghi le sostengono e le
// commentano; a fine anno il comitato (scelto dagli amministratori in Impostazioni) le vota da 1 a 5 e premia le migliori.
import { h, fill, avatar, timeAgo, loading, modal, toast, confirmDialog } from './ui.js';
import { get, post, patch, put, del } from './api.js';
import { store, userById } from './store.js';
import { icon } from './icons.js';

export const CATEGORIES = {
  innovazione: 'Innovazione', miglioramento: 'Miglioramento', processi: 'Processi',
  sicurezza: 'Sicurezza', persone: 'Persone', sostenibilita: 'Sostenibilità',
};
export const IDEA_STATUS = {
  proposta: 'Proposta', in_valutazione: 'In valutazione', premiata: 'Premiata', realizzata: 'Realizzata', archiviata: 'Archiviata',
};
const fmtScore = n => (n == null ? '–' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: 1 }));
export const statusPill = s => h('span.pill.idea-st', { class: `idea-st-${s}` }, s === 'premiata' ? icon('trophy', { size: 12 }) : h('span.dot'), IDEA_STATUS[s]);
const catPill = c => h('span.pill.idea-cat', CATEGORIES[c] || c);
const nameOf = id => userById(id)?.name || 'Ex collega';

// ── proporre o modificare un'idea ───────────────────────────────────────────
export function openIdeaForm({ idea = null, onSaved } = {}) {
  const title = h('input.input', { maxlength: 160, value: idea?.title || '', placeholder: 'Es. Check-list digitale per i sopralluoghi', autofocus: true });
  const category = h('select.select', Object.entries(CATEGORIES).map(([k, l]) => h('option', { value: k, selected: k === (idea?.category || 'miglioramento') }, l)));
  const area = (value, placeholder) => h('textarea.input', { rows: 3, placeholder }, value || '');
  const problem = area(idea?.problem, 'Cosa non funziona o si può fare meglio oggi?');
  const proposal = area(idea?.proposal, 'Cosa proponi, in concreto?');
  proposal.rows = 5;
  const benefits = area(idea?.benefits, 'Tempo risparmiato, meno errori, più sicurezza, clienti più contenti…');
  const save = async () => {
    if (!title.value.trim()) { toast('Dai un titolo all\'idea', 'err'); title.focus(); return; }
    if (!proposal.value.trim()) { toast('Scrivi cosa proponi', 'err'); proposal.focus(); return; }
    const body = { title: title.value, category: category.value, problem: problem.value, proposal: proposal.value, benefits: benefits.value };
    const r = idea ? await patch(`/api/ideas/${idea.id}`, body) : await post('/api/ideas', body);
    m.close();
    toast(idea ? 'Idea aggiornata' : 'Idea pubblicata nel Laboratorio');
    onSaved?.(idea ? idea.id : r.id);
  };
  const m = modal({
    title: idea ? 'Modifica l\'idea' : 'Proponi un\'idea',
    body: [
      h('label.field', h('span', 'Titolo'), title),
      h('label.field', h('span', 'Tipo'), category),
      h('label.field', h('span', 'Cosa non va oggi'), problem),
      h('label.field', h('span', 'La proposta'), proposal),
      h('label.field', h('span', 'Cosa ci guadagniamo'), benefits),
    ],
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: save } }, idea ? 'Salva' : 'Pubblica'),
    ],
  });
}

function supportButton(idea, onChange) {
  const btn = h('button.btn.btn-sm.idea-support', {
    type: 'button', class: idea.supported ? 'on' : '', 'aria-pressed': String(Boolean(idea.supported)),
    title: idea.supported ? 'Togli il sostegno' : 'Sostieni questa idea',
    on: {
      click: async e => {
        e.stopPropagation();
        if (idea.supported) await del(`/api/ideas/${idea.id}/support`); else await post(`/api/ideas/${idea.id}/support`);
        idea.supported = !idea.supported;
        idea.support_count += idea.supported ? 1 : -1;
        btn.replaceWith(supportButton(idea, onChange));
        onChange?.();
      },
    },
  }, icon('thumbs-up', { size: 16 }), 'Sostengo', h('strong', String(idea.support_count)));
  return btn;
}

// ── scheda dell'idea ────────────────────────────────────────────────────────
export async function openIdea(id, { onChange } = {}) {
  let d;
  try { d = await get(`/api/ideas/${id}`); } catch { return; }
  const me = d.me;
  const mine = d.author_id === store.me.id;
  const changed = () => onChange?.();
  const block = (label, text) => (text ? h('div.idea-block', h('div.idea-label', label), h('p', text)) : null);

  // voto del comitato
  let voteBox = null;
  if (me.committee && d.voting_open && !mine) {
    let score = d.my_vote?.score || 0;
    const note = h('textarea.input', { rows: 2, placeholder: 'Una nota per il comitato (facoltativa)' }, d.my_vote?.note || '');
    const stars = h('div.idea-stars', { role: 'radiogroup', 'aria-label': 'Voto da 1 a 5' });
    const drawStars = () => fill(stars, [1, 2, 3, 4, 5].map(n => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(n === score), 'aria-label': `${n} su 5`,
      class: n <= score ? 'on' : '', on: { click: () => { score = n; drawStars(); } },
    }, icon('star', { size: 22 }))));
    drawStars();
    voteBox = h('div.idea-vote',
      h('div.idea-label', d.my_vote ? 'Il tuo voto (puoi cambiarlo finché la votazione è aperta)' : 'Il tuo voto da membro del comitato'),
      stars, note,
      h('div', h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
        if (!score) { toast('Scegli un voto da 1 a 5', 'err'); return; }
        await put(`/api/ideas/${id}/vote`, { score, note: note.value });
        toast('Voto salvato');
        changed();
      } } }, 'Salva il voto')));
  } else if (me.committee && d.voting_open && mine) {
    voteBox = h('div.idea-vote.muted.small', 'È una tua idea: la votano gli altri membri del comitato.');
  }

  const votes = me.judge && d.votes?.length ? h('div.idea-block',
    h('div.idea-label', `Voti del comitato · media ${fmtScore(d.avg_score)}`),
    h('ul.idea-votes', d.votes.map(x => h('li', h('strong', `${x.score}/5`), ` ${nameOf(x.user_id)}`, x.note ? h('span.muted', ` — ${x.note}`) : null)))) : null;

  // commenti
  const comments = h('div.idea-comments');
  const drawComments = list => fill(comments, list.length ? list.map(c => h('div.idea-comment',
    avatar(userById(c.user_id) || { name: '?' }, 28),
    h('div', h('div.small', h('strong', nameOf(c.user_id)), h('span.muted', ` · ${timeAgo(c.created_at)}`)), h('p', c.body)),
    c.user_id === store.me.id || store.me.is_admin ? h('button.btn.btn-ghost.btn-sm', {
      type: 'button', 'aria-label': 'Cancella il commento',
      on: { click: async () => { await del(`/api/idea-comments/${c.id}`); drawComments(list.filter(x => x.id !== c.id)); changed(); } },
    }, icon('trash', { size: 14 })) : null)) : h('p.muted.small', 'Nessun commento: di\' cosa ne pensi o come la miglioreresti.'));
  drawComments(d.comments);
  const text = h('textarea.input', { rows: 2, placeholder: 'Scrivi un commento…' });
  const send = async () => {
    if (!text.value.trim()) return;
    await post(`/api/ideas/${id}/comments`, { body: text.value });
    text.value = '';
    drawComments((await get(`/api/ideas/${id}`)).comments);
    changed();
  };

  const statusSel = me.judge ? h('select.select.idea-status-sel', {
    'aria-label': 'Stato dell\'idea',
    on: { change: async e => { await patch(`/api/ideas/${id}`, { status: e.target.value }); toast('Stato aggiornato'); changed(); } },
  }, Object.entries(IDEA_STATUS).map(([k, l]) => h('option', { value: k, selected: k === d.status }, l))) : null;

  const canEdit = (mine && d.status === 'proposta') || store.me.is_admin;
  const m = modal({
    wide: true,
    title: h('div.idea-head', h('div.row', catPill(d.category), statusPill(d.status)), h('h2', d.title)),
    body: [
      h('div.idea-author', avatar(userById(d.author_id) || { name: '?' }, 32),
        h('div', h('strong', nameOf(d.author_id)), h('div.small.muted', `Proposta ${timeAgo(d.created_at)} · ${d.year}`))),
      block('Cosa non va oggi', d.problem),
      block('La proposta', d.proposal),
      block('Cosa ci guadagniamo', d.benefits),
      h('div.row', supportButton(d, changed)),
      voteBox,
      votes,
      h('div.idea-block', h('div.idea-label', `Commenti (${d.comments.length})`), comments,
        h('div.idea-comment-new', text, h('button.btn.btn-sm', { type: 'button', on: { click: send } }, 'Commenta'))),
    ],
    left: [
      canEdit ? h('button.btn.btn-sm', { type: 'button', on: { click: () => { m.close(); openIdeaForm({ idea: d, onSaved: () => { changed(); openIdea(id, { onChange }); } }); } } }, icon('pencil', { size: 14 }), 'Modifica') : null,
      mine || store.me.is_admin ? h('button.btn.btn-sm.btn-danger', { type: 'button', on: { click: async () => {
        if (!(await confirmDialog('Cancellare questa idea, con sostegni, commenti e voti?', { ok: 'Cancella', danger: true }))) return;
        await del(`/api/ideas/${id}`);
        m.close();
        toast('Idea cancellata');
        changed();
      } } }, 'Cancella') : null,
    ],
    actions: statusSel ? [h('label.row.small.muted', 'Stato', statusSel)] : [],
  });
}

// ── card dell'elenco ────────────────────────────────────────────────────────
function ideaCard(i, data, reload) {
  return h('article.card.idea-card', {
    tabindex: 0, role: 'button', 'aria-label': `Apri l'idea ${i.title}`,
    on: {
      click: () => openIdea(i.id, { onChange: reload }),
      keydown: e => { if (e.key === 'Enter') openIdea(i.id, { onChange: reload }); },
    },
  },
  h('div.row', catPill(i.category), i.status !== 'proposta' ? statusPill(i.status) : null),
  h('h3', i.title),
  h('p.idea-excerpt', i.proposal),
  h('div.idea-foot',
    h('div.idea-who', avatar(userById(i.author_id) || { name: '?' }, 24), h('span', nameOf(i.author_id)), h('span.muted', `· ${timeAgo(i.created_at)}`)),
    h('div.row',
      data.me.judge && i.vote_count ? h('span.idea-score', { title: `${i.vote_count} voti del comitato` }, icon('star', { size: 14 }), fmtScore(i.avg_score)) : null,
      h('span.idea-count', { title: 'Commenti' }, icon('message', { size: 14 }), String(i.comment_count)),
      supportButton(i))));
}

// ── classifica (comitato e amministratori) ─────────────────────────────────
function ranking(data, reload, category) {
  const rows = data.ideas.filter(i => i.status !== 'archiviata' && (!category || i.category === category))
    .sort((a, b) => (b.avg_score ?? -1) - (a.avg_score ?? -1) || b.vote_count - a.vote_count || b.support_count - a.support_count);
  if (!rows.length) return h('div.card.empty', 'Nessuna idea da valutare in quest\'anno.');
  const n = data.committee.length;
  return h('div.card.table-wrap', h('table.list.idea-rank',
    h('thead', h('tr', h('th', '#'), h('th', 'Idea'), h('th', 'Autore'), h('th', 'Sostegni'), h('th', 'Media'), h('th', 'Voti'), data.me.committee ? h('th', 'Il tuo voto') : null)),
    h('tbody', rows.map((i, k) => h('tr', { on: { click: () => openIdea(i.id, { onChange: reload }) } },
      h('td', String(k + 1)),
      h('td', h('strong', i.title), ' ', i.status !== 'proposta' ? statusPill(i.status) : null),
      h('td', nameOf(i.author_id)),
      h('td', String(i.support_count)),
      h('td', h('strong', fmtScore(i.avg_score))),
      h('td', `${i.vote_count}${n ? `/${n}` : ''}`),
      data.me.committee ? h('td', i.author_id === store.me.id ? h('span.muted', 'tua') : (i.my_score ? `${i.my_score}/5` : h('span.muted', 'da dare'))) : null)))));
}

// ── impostazioni (amministratori): comitato e votazione ────────────────────
function settings(data, reload) {
  const members = new Set(data.committee);
  const chips = h('div.idea-chips');
  const add = h('select.select', { 'aria-label': 'Aggiungi al comitato' });
  const draw = () => {
    fill(chips, members.size ? [...members].map(id => h('span.idea-chip', avatar(userById(id) || { name: '?' }, 22), nameOf(id),
      h('button', { type: 'button', 'aria-label': `Togli ${nameOf(id)} dal comitato`, on: { click: () => { members.delete(id); save(); } } }, icon('x', { size: 14 }))))
      : h('span.muted.small', 'Nessun membro: aggiungi chi valuterà le idee a fine anno.'));
    fill(add, h('option', { value: '' }, 'Aggiungi una persona…'),
      store.users.filter(u => !members.has(u.id)).sort((a, b) => a.name.localeCompare(b.name)).map(u => h('option', { value: String(u.id) }, u.name)));
  };
  const save = async () => {
    await put('/api/ideas-settings', { committee: [...members] });
    data.committee = [...members];
    draw();
    toast('Comitato aggiornato');
  };
  add.addEventListener('change', () => { if (add.value) { members.add(Number(add.value)); save(); } });
  draw();
  const toggle = async () => {
    await put('/api/ideas-settings', { voting_open: !data.voting_open });
    toast(data.voting_open ? 'Votazione chiusa' : 'Votazione aperta: il comitato può votare');
    reload();
  };
  return h('div.idea-settings',
    h('section.card.idea-panel',
      h('h2', 'Comitato di valutazione'),
      h('p.muted', 'Chi ne fa parte vede la classifica con le medie e, a votazione aperta, dà a ogni idea un voto da 1 a 5. Non vota le proprie idee.'),
      chips, add),
    h('section.card.idea-panel',
      h('h2', 'Votazione di fine anno'),
      h('p.muted', data.voting_open
        ? 'La votazione è aperta: i membri del comitato possono votare le idee. Chiudila quando hanno finito, poi segna le idee premiate.'
        : 'La votazione è chiusa. Aprila a fine anno, quando il comitato si riunisce.'),
      h('button.btn', { type: 'button', on: { click: toggle } }, data.voting_open ? 'Chiudi la votazione' : 'Apri la votazione')));
}

// ── pagina ──────────────────────────────────────────────────────────────────
export async function ideasView(view, parts, params) {
  let tab = 'tutte';
  let year = null;
  let category = '';
  const body = h('div.section', loading());
  const tabs = h('div.seg');
  const filters = h('div.row');
  const banner = h('div');
  fill(view, h('div.page-head',
    h('div', h('h1', 'Laboratorio delle idee'), h('div.sub', 'Proponi innovazioni e miglioramenti, sostieni quelle dei colleghi. A fine anno il comitato le vota e premia le migliori.')),
    h('button.btn.btn-primary', { type: 'button', on: { click: () => openIdeaForm({ onSaved: id => { reload(); openIdea(id, { onChange: reload }); } }) } }, icon('lightbulb', { size: 16 }), 'Proponi un\'idea')),
  banner, h('div.spread.idea-toolbar', tabs, filters), body);

  let data;
  async function reload() {
    data = await get(`/api/ideas${year ? `?year=${year}` : ''}`);
    year = data.year;
    draw();
  }
  function draw() {
    const list = [['tutte', 'Tutte'], ['mie', 'Le mie'], ['premiate', 'Premiate']];
    if (data.me.judge) list.push(['classifica', 'Classifica']);
    if (data.me.admin) list.push(['impostazioni', 'Impostazioni']);
    if (!list.some(([k]) => k === tab)) tab = 'tutte';
    fill(tabs, list.map(([k, l]) => h('button', { type: 'button', class: k === tab ? 'on' : '', on: { click: () => { tab = k; draw(); } } }, l)));
    fill(filters,
      tab === 'impostazioni' ? null : h('select.select', { 'aria-label': 'Tipo di idea', on: { change: e => { category = e.target.value; draw(); } } },
        h('option', { value: '' }, 'Tutti i tipi'), Object.entries(CATEGORIES).map(([k, l]) => h('option', { value: k, selected: k === category }, l))),
      data.years.length > 1 ? h('select.select', { 'aria-label': 'Anno', on: { change: e => { year = Number(e.target.value); reload(); } } },
        data.years.map(y => h('option', { value: String(y), selected: y === data.year }, String(y)))) : null);
    fill(banner, data.voting_open ? h('div.card.idea-banner', icon('trophy', { size: 20 }),
      h('div', h('strong', `Votazione ${data.year} aperta`),
        h('div.small', data.me.committee ? 'Sei nel comitato: apri le idee e dai a ciascuna un voto da 1 a 5. Trovi a che punto sei in Classifica.'
          : 'Il comitato sta valutando le idee dell\'anno. Le premiate compariranno qui.'))) : null);

    if (tab === 'impostazioni') return fill(body, settings(data, reload));
    if (tab === 'classifica') return fill(body, ranking(data, reload, category));
    let items = data.ideas;
    if (tab === 'mie') items = items.filter(i => i.author_id === store.me.id);
    if (tab === 'premiate') items = items.filter(i => i.status === 'premiata' || i.status === 'realizzata');
    else if (tab === 'tutte') items = items.filter(i => i.status !== 'archiviata');
    if (category) items = items.filter(i => i.category === category);
    if (!items.length) {
      const msg = tab === 'mie' ? 'Non hai ancora proposto idee. Hai notato qualcosa da migliorare? Proponila.'
        : tab === 'premiate' ? 'Nessuna idea premiata per quest\'anno: il comitato vota a fine anno.'
        : 'Ancora nessuna idea. Proponi la prima: un\'innovazione, un processo più semplice, un rischio da togliere.';
      return fill(body, h('div.card.empty', msg));
    }
    fill(body, h('div.idea-grid', items.map(i => ideaCard(i, data, reload))));
  }

  await reload();
  if (parts[1]) openIdea(Number(parts[1]), { onChange: reload });
  else if (params?.get('new') === '1') openIdeaForm({ onSaved: id => { reload(); openIdea(id, { onChange: reload }); } });
}
