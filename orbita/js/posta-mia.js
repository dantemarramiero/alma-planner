// La mia posta nel CRM (ALM2-67, tavola L del canvas «Progetto da email», via di Dante 23/11/2026).
// Scelte solo per sé: se i colleghi possono sapere con chi scrivo (nel riquadro «Chi di noi conosce queste persone»),
// come entrano le risposte nuove nei progetti nuovi, e l'elenco delle mie email entrate nei progetti con «Togli».
import { h, fill, toast, loading, fmtDate } from './ui.js';
import { get, put, del } from './api.js';
import { pageTop, title, card, toggle } from './crm-v2.js';

export async function postaMiaView(view) {
  fill(view, h('div.cv', loading()));
  let p = await get('/api/posta/preferenze');
  const share = toggle(p.share_people, null, { 'aria-label': 'Mostra ai colleghi con chi scrivo' });
  share.input.addEventListener('change', async () => {
    try { p = { ...p, ...(await put('/api/posta/preferenze', { share_people: share.input.checked })) }; toast(share.input.checked ? 'I colleghi vedranno che conosci le persone con cui scrivi' : 'Nessun collega vedrà con chi scrivi'); }
    catch { share.input.checked = !share.input.checked; }
  });
  const seg = h('div.pmy-seg', { role: 'group', 'aria-label': 'Risposte nuove nei progetti nuovi' });
  const drawSeg = () => fill(seg, [['approva', 'Le approvo io'], ['auto', 'Entrano da sole']].map(([k, l]) =>
    h('button.cv-pill', { type: 'button', class: p.new_mode === k ? 'dark' : 'line', 'aria-pressed': String(p.new_mode === k), on: { click: async () => {
      if (p.new_mode === k) return;
      p = { ...p, ...(await put('/api/posta/preferenze', { new_mode: k })) }; drawSeg(); toast('Scelta salvata per i prossimi progetti');
    } } }, l)));
  drawSeg();
  const list = h('div.pmy-list');
  const drawList = () => fill(list, p.emails.length ? p.emails.map(e => h('div.pmy-row',
    h('div.pmy-t', h('b', e.from_name || e.from_address || '—'), h('span', e.subject), h('small.cv-muted', [e.sent_at ? fmtDate(String(e.sent_at).slice(0, 10)) : null, h('a', { href: `#/crm/progetto/${e.project_id}` }, e.project_name)].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x])))),
    h('button.btn.btn-sm', { type: 'button', on: { click: async ev => {
      ev.currentTarget.disabled = true;
      try { await del(`/api/project-emails/${e.id}`); p.emails = p.emails.filter(x => x.id !== e.id); drawList(); toast('Tolta dal progetto: nella tua casella resta'); }
      catch { ev.currentTarget.disabled = false; }
    } } }, 'Togli dal progetto')))
    : h('p.cv-muted', 'Nessuna tua email è entrata in un progetto.'));
  drawList();
  const row = (heading, text, ctrl) => h('div.pmy-opt', h('div.pmy-opt-t', h('b', heading), h('span', text)), ctrl);
  fill(view, h('div.cv.pmy',
    pageTop({ eyebrow: 'Il mio profilo', heading: title('La mia posta', 'nel CRM'), sub: 'La tua casella la vedi solo tu. Le tue email entrano nei progetti e le leggono i colleghi solo quando lo decidi tu.' }),
    card({ title: 'Le mie scelte', icon: 'lock' },
      h('div.pmy-opts',
        row('Mostra ai colleghi con chi scrivo', 'Quando un collega crea un progetto, Alma gli dice che tu conosci quelle persone e quante email vi siete scambiati. Mai oggetti o testi.', share.el),
        row('Risposte nuove nei progetti nuovi', 'La scelta già pronta quando crei un progetto da una email. Ogni progetto poi ha la sua, in Posta › Da approvare o nella scheda.', seg),
        row('Email da approvare', 'Quelle della tua casella che aspettano il tuo sì per entrare in un progetto.', h('a.btn.btn-sm', { href: '#/crm/posta/approvare' }, 'Apri Da approvare')))),
    card({ title: `Le mie email nei progetti · ${p.emails.length} in ${p.projects} ${p.projects === 1 ? 'progetto' : 'progetti'}`, icon: 'mail' }, list)));
}
