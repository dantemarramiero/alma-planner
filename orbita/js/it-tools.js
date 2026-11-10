// Alma IT · I miei strumenti (per tutti): le licenze che ho, come entrarci, cosa posso chiedere al team IT
// («Richiedi un software», anche uno che non è nel censimento), «Non mi serve più» e le mie richieste.
import { h, fill, modal, toast, fmtDate, loading } from './ui.js';
import { get, post } from './api.js';
import { icon } from './icons.js';

const STATE = { da_rispondere: ['In attesa del team IT', 'it-st-wait'], accettata: ['Accettata', 'it-st-ok'], rifiutata: ['Non accettata', 'it-st-no'], annullata: ['Annullata', 'it-st-off'] };
const KIND = { software: 'Richiesta', nuovo: 'Software nuovo', rilascio: 'Non mi serve più' };
const vendorOf = l => (l.vendor || '').trim() || l.software_name;
const monogram = v => { const w = String(v).match(/[A-Za-z0-9]+/g) || ['?']; return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase(); };
// «Licenza» e «Utenti collegati» (app di Entra) non aggiungono niente al nome del software
const label = x => (['Licenza', 'Utenti collegati', x.software_name].includes(x.plan_name) ? x.software_name : `${x.software_name} · ${x.plan_name}`);

export async function myToolsView(container) {
  fill(container, loading());
  const d = await get('/api/it/mine');
  const reload = () => myToolsView(container);

  const cards = d.licences.length ? h('div.it-cards', d.licences.map(l => h('article.card.it-card',
    h('div.it-card-head', h('span.it-mono', monogram(vendorOf(l))),
      h('span.grow', h('strong', label(l)), h('span.small.muted', [vendorOf(l),
        l.external_id === 'collegati' ? 'accesso con l\'account Microsoft' : null,
        l.package ? (l.package.on_request ? 'su richiesta' : `di base per «${l.package.package_name}»`) : null].filter(Boolean).join(' · ')))),
    l.software_notes ? h('p.small.it-card-note', l.software_notes.length > 180 ? `${l.software_notes.slice(0, 180)}…` : l.software_notes) : null,
    h('div.row',
      l.website ? h('a.btn.btn-sm', { href: l.website, target: '_blank', rel: 'noopener' }, `Apri ${l.software_name}`, icon('external', { size: 14 })) : null,
      h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => release(l, reload) } }, 'Non mi serve più')))))
    : h('div.card.empty', d.person ? 'Nel censimento non risultano licenze a tuo nome.' : 'Non ti trovo nell\'organigramma di Microsoft: chiedi al team IT di controllare il tuo account.');

  const reqs = d.requests.length ? h('div.it-reqs', d.requests.map(r => {
    const [st, cls] = STATE[r.status] || [r.status, ''];
    return h('div.it-req',
      h('span.grow', h('strong', r.software_name), h('span.small.muted', ` ${KIND[r.kind]} · ${fmtDate(r.created_at.slice(0, 10), { year: true })}`),
        r.answer ? h('div.small', `Risposta: ${r.answer}`) : null),
      h('span.pill', { class: cls }, st),
      r.status === 'da_rispondere' ? h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => {
        await post(`/api/it/requests/${r.id}/cancel`, {});
        toast('Richiesta annullata');
        reload();
      } } }, 'Annulla') : null);
  })) : h('p.muted', 'Nessuna richiesta finora.');

  fill(container,
    h('div.page-head',
      h('div', h('h1', 'I miei strumenti'), h('div.sub', 'I software che hai, come entrarci, e cosa puoi chiedere al team IT.')),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => requestSoftware(d.catalog, reload) } }, icon('plus', { size: 16 }), 'Richiedi un software')),
    h('section.it-section', h('h2', 'Le mie licenze'), cards),
    h('section.card.it-section.it-pad', h('div.spread', h('h2', 'Le mie richieste'),
      h('button.btn.btn-sm', { type: 'button', on: { click: () => requestSoftware(d.catalog, reload) } }, 'Nuova richiesta')), reqs));
}

function field(lab, input, hint) {
  return h('label.field', h('span', lab), input, hint ? h('small.muted', hint) : null);
}

// Richiedi un software: dal censimento, oppure uno che non c'è scrivendone il nome.
function requestSoftware(catalog, onDone) {
  const groups = new Map();
  for (const c of catalog) {
    const v = (c.vendor || '').trim() || c.software_name;
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(c);
  }
  const pick = h('select.select',
    h('option', { value: '' }, 'Scegli dal censimento…'),
    [...groups.entries()].map(([v, list]) => h('optgroup', { label: v }, list.map(c => h('option', { value: String(c.plan_id) },
      `${label(c)}${c.package ? (c.package.on_request ? ' · su richiesta per il tuo ruolo' : ' · di base per il tuo ruolo') : ''}`)))),
    h('option', { value: 'nuovo' }, 'Non è in elenco: lo scrivo io'));
  const name = h('input.input', { maxlength: 160, placeholder: 'Nome del software' });
  const nameBox = field('Quale software', name);
  nameBox.hidden = true;
  pick.addEventListener('change', () => { nameBox.hidden = pick.value !== 'nuovo'; if (!nameBox.hidden) name.focus(); });
  const reason = h('textarea.input', { rows: 3, maxlength: 1000, placeholder: 'A cosa ti serve? Es. disegni esecutivi per il cantiere di…' });
  const due = h('input.input', { type: 'date' });
  const m = modal({
    title: 'Richiedi un software',
    body: [field('Cosa ti serve', pick), nameBox, field('Perché', reason), field('Entro il (facoltativo)', due),
      h('p.small.muted', 'La richiesta arriva al team IT, che ti risponde qui e con una notifica.')],
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        const body = { reason: reason.value, due_date: due.value || null };
        if (pick.value === 'nuovo') body.name = name.value;
        else if (pick.value) body.plan_id = Number(pick.value);
        else return toast('Scegli un software o scrivi il suo nome', 'err');
        await post('/api/it/requests', body);
        m.close();
        toast('Richiesta inviata al team IT');
        onDone();
      } } }, 'Invia al team IT'),
    ],
  });
}

function release(l, onDone) {
  const reason = h('textarea.input', { rows: 2, maxlength: 1000, placeholder: 'Facoltativo: es. ho cambiato ruolo' });
  const m = modal({
    title: `Non ti serve più «${label(l)}»?`,
    body: [h('p', 'Il team IT la toglie e la licenza può andare a un collega.'), field('Motivo', reason)],
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        await post('/api/it/release', { assignment_id: l.assignment_id, reason: reason.value });
        m.close();
        toast('Segnalato al team IT');
        onDone();
      } } }, 'Segnala al team IT'),
    ],
  });
}
