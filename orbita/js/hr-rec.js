// Alma HR, Fase 3: recruitment (ALM2-53; canvas «Alma HR», pagina «Fase 3 · recruitment», tavole S–Z). Pagine:
//   #/hr/richieste            S  richieste di personale (HR tutte, il responsabile le sue) · ?nuova=<incarico>
//   #/hr/richieste/:id        T  approvazione · U annuncio · V pipeline dei candidati
//   #/hr/candidato/:id        W  scheda e scorecard · X offerta
//   #/hr/preboarding[/:id]    Y  dal «sì» al primo giorno (la persona si crea su BOSS)
//   #/hr/recruitment          Z  numeri con l'ambito (solo team HR)
import { h, fill, toast, modal, confirmDialog, fmtDateTime } from './ui.js';
import { get, post, put, patch, del } from './api.js';
import { icon } from './icons.js';
import { ambitoSelect, ambQs } from './hr.js';

const eur = n => (n == null ? '—' : `${Math.round(n).toLocaleString('it-IT')} €`);
const k1 = n => Number(n).toLocaleString('it-IT', { maximumFractionDigits: 1 });
const days = iso => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86400000)) : null);
const itDate = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const head = (title, sub, right) => h('div.page-head', h('div', h('div.hr-eyebrow', 'Alma HR · recruitment'), h('h1', title), sub ? h('div.sub', sub) : null), right || null);
const howTo = (...t) => h('div.hr-howto', h('b', 'Come si legge'), ' · ', ...t);
const field = (label, input) => h('label.field', h('span', label), input);
const bandTxt = b => (b ? `${k1(b.min)} – ${k1(b.max)} k€ · riferimento ${k1(b.mid)} k€` : 'senza fascia: manca il ruolo');
const CONTRATTI = { TI: 'Tempo indeterminato', TD: 'Tempo determinato', APPR: 'Apprendistato', STAFF_LEASING: 'Staff leasing', TIROCINIO: 'Tirocinio' };
const TIPI = { sostituzione: 'Sostituzione', nuova: 'Nuova posizione', temporanea: 'Temporanea' };
const STATO = {
  bozza: ['bozza', ''], approvazione: ['in approvazione', 'z-warn'], modifica: ['modifica richiesta', 'z-warn'], approvata: ['approvata', 'z-ok'],
  rifiutata: ['rifiutata', 'z-bad'], coperta: ['coperta', 'z-ok'], chiusa: ['chiusa', ''],
};
const statoChip = (r) => {
  if (r.stato === 'approvata') return h('span.hr-chip.z-ok', r.pubblicato ? `annuncio online · ${days(r.published_at)} gg` : 'approvata · annuncio da pubblicare');
  if (r.stato === 'approvazione') return h('span.hr-chip.z-warn', `da approvare${r.passo ? ` · ${r.passo}` : ''}`);
  const [t, cl] = STATO[r.stato] || [r.stato, ''];
  return h('span.hr-chip', { class: cl }, t);
};
// un motivo scritto (rifiuto, modifica, scarto): finestra di Alma, non il prompt del browser
const askReason = (title, label = 'Motivo', placeholder = '') => new Promise(res => {
  const ta = h('textarea.input', { maxlength: 2000, autofocus: true, placeholder });
  let done = false;
  const m = modal({ title, body: field(label, ta), onClose: () => { if (!done) res(null); },
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => { if (!ta.value.trim()) return; done = true; const v = ta.value.trim(); m.close(); res(v); } } }, 'Invia')] });
});
const readFile = f => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok({ nome: f.name, mime: f.type || 'application/pdf', base64: String(r.result).split(',')[1] }); r.onerror = ko; r.readAsDataURL(f); });

// ── S · Richieste di personale ──────────────────────────────────────────────────────────────────────────────
export async function richiesteView(c, params) {
  const d = await get(`/api/hr/richieste?${ambQs()}`);
  const amb = d.is_hr ? await ambitoSelect(() => richiesteView(c, params)) : null;
  const tab = ['aperte', 'approvare', 'chiuse'].includes(params.get('tab')) ? params.get('tab') : 'aperte';
  const aperte = d.richieste.filter(r => ['bozza', 'approvazione', 'modifica', 'approvata'].includes(r.stato));
  const approvare = d.richieste.filter(r => r.da_approvare);
  const chiuse = d.richieste.filter(r => ['rifiutata', 'coperta', 'chiusa'].includes(r.stato));
  const list = { aperte, approvare, chiuse }[tab];
  const tabs = h('div.hr-tabs', [['aperte', `Aperte · ${aperte.length}`], ['approvare', `Da approvare · ${approvare.length}`], ['chiuse', `Chiuse · ${chiuse.length}`]]
    .map(([k, l]) => h('a', { href: `#/hr/richieste?tab=${k}`, class: tab === k ? 'on' : '' }, l)));
  const nuova = h('button.btn.btn-primary', { type: 'button', on: { click: () => nuovaRichiesta(d) } }, icon('plus', { size: 16 }), 'Nuova richiesta');
  fill(c, head('Richieste di personale', d.is_hr ? 'Tutte le richieste. Una richiesta nasce da un incarico vacante dell\'organigramma di BOSS: ruolo, grade, fascia e area arrivano da lì.'
    : 'Le tue richieste e quelle che devi approvare. Si aprono dagli incarichi vacanti sotto i tuoi.', h('div.hr-row', amb, d.is_hr || d.vacanti.length ? nuova : null)),
  tabs,
  h('div.card.hr-scroll', h('table.list', h('thead', h('tr', ['Posizione', 'Area', 'Ruolo · grade', 'Da quando', 'Stato', 'Candidati'].map(x => h('th', x)))),
    h('tbody', list.length ? list.map(r => h('tr', { class: 'clickable', on: { click: () => { location.hash = `#/hr/richieste/${r.id}`; } } },
      h('td', h('b', r.posizione), h('div.small.muted', `${TIPI[r.tipo] || r.tipo}${r.richiedente ? ` · ${r.richiedente}` : ''}`)), h('td', r.area_nome || '—'),
      h('td', r.ruolo ? `${r.ruolo} · G${r.grade}` : h('span.hr-chip.z-warn', 'senza ruolo')), h('td', r.da_quando || '—'), h('td', statoChip(r)), h('td', r.candidati || '—')))
      : h('tr', h('td.empty', { colSpan: 6 }, tab === 'approvare' ? 'Niente da approvare.' : 'Nessuna richiesta.'))))),
  d.vacanti.length ? h('div.card.hr-pad', h('div.hr-label', `Incarichi vacanti senza richiesta (${d.vacanti.length})`),
    d.vacanti.slice(0, 12).map(v => h('div.hr-li', h('div', h('b', v.nome), h('div.small.muted', `${v.area || 'senza area'}${v.ruolo ? ` · ${v.ruolo} G${v.grade}` : ''}${v.vacante_dal ? ` · vacante da ${days(v.vacante_dal)} giorni` : ''}`)),
      h('button.btn.btn-sm', { type: 'button', on: { click: () => nuovaRichiesta(d, v.id) } }, 'Apri richiesta')))) : null,
  howTo('Una riga per posizione. «Da approvare» sono quelle in cui tocca a te il prossimo passo. Clic su una riga: approvazione, annuncio e candidati.'));
  const pre = Number(params.get('nuova'));
  const gia = pre ? d.richieste.find(x => x.incarico_id === pre && !['rifiutata', 'chiusa'].includes(x.stato)) : null;
  if (gia) { toast("Per questo incarico c'è già una richiesta"); location.hash = `#/hr/richieste/${gia.id}`; } else if (pre) nuovaRichiesta(d, pre);
}

function nuovaRichiesta(d, incaricoId) {
  const vac = d.vacanti;
  const inc = h('select.select', h('option', { value: '' }, d.is_hr ? 'Nessuno: l\'incarico va creato su BOSS' : 'Scegli l\'incarico vacante'),
    vac.map(v => h('option', { value: v.id, selected: v.id === incaricoId }, `${v.nome}${v.area ? ` · ${v.area}` : ''}`)));
  const posizione = h('input.input', { maxlength: 160, placeholder: 'Per una posizione nuova: come si chiama' });
  const role = h('select.select', h('option', { value: '' }, 'Ruolo del mansionario'), d.roles.map(r => h('option', { value: r.id }, `${r.title} · G${r.grade}`)));
  const area = h('select.select', h('option', { value: '' }, 'Area'), d.aree.map(a => h('option', { value: a.id }, a.nome)));
  const motivo = h('textarea.input', { maxlength: 2000, placeholder: 'Perché serve: zona scoperta, cantieri in partenza, nuova commessa…' });
  const tipo = h('select.select', Object.entries(TIPI).map(([k, l]) => h('option', { value: k }, l)));
  const da = h('input.input', { maxlength: 60, placeholder: 'subito, 02/2027…' });
  const contr = h('select.select', Object.entries(CONTRATTI).map(([k, l]) => h('option', { value: k }, l)));
  const sede = h('input.input', { maxlength: 120, placeholder: 'Chieti, Bari…' });
  const piano = h('input', { type: 'checkbox', checked: true });
  const info = h('div.hr-dark-soft');
  const extra = h('div', d.is_hr ? h('div.hr-grid2', field('Posizione', posizione), field('Ruolo', role), field('Area', area)) : null);
  const refresh = () => {
    const v = vac.find(x => String(x.id) === inc.value);
    const r = v ? { band: v.band, title: v.ruolo, grade: v.grade } : d.roles.find(x => String(x.id) === role.value);
    extra.hidden = Boolean(v);
    const b = r?.band;
    fill(info, v ? h('div.small', h('b', v.nome), ` · ${v.area || 'senza area'} · dall'incarico vacante di BOSS`) : null,
      h('div.small', r?.title ? `${r.title} · G${r.grade} · ${bandTxt(b)}` : 'Ruolo, grade e fascia arrivano dall\'incarico (o dal ruolo scelto).'),
      b ? h('div.small', h('b', 'Budget'), ` · riferimento della fascia ${eur(b.mid * 1000)} · costo azienda stimato ${eur(b.mid * 1000 * d.coeff)}`) : null,
      h('div.small.muted', ['nuova'].includes(tipo.value) || !piano.checked || Number(r?.grade) > 6 ? 'Approvano: Team HR → Direzione → CFO' : 'Approvano: Team HR → Direzione'));
  };
  for (const el of [inc, role, tipo, piano]) el.addEventListener('change', refresh);
  const save = async invia => {
    const body = { incarico_id: inc.value ? Number(inc.value) : null, posizione: posizione.value || undefined, role_id: role.value ? Number(role.value) : null, area_id: area.value ? Number(area.value) : null,
      motivo: motivo.value, tipo: tipo.value, da_quando: da.value, contratto: contr.value, sede: sede.value, nel_piano: piano.checked };
    if (!body.incarico_id && !d.is_hr) return toast('Scegli l\'incarico vacante', 'err');
    const r = await post('/api/hr/richieste', body);
    if (invia) await post(`/api/hr/richieste/${r.id}/invia`);
    m.close();
    toast(invia ? 'Richiesta inviata per approvazione' : 'Bozza salvata');
    location.hash = `#/hr/richieste/${r.id}`;
  };
  const m = modal({ title: 'Nuova richiesta di personale', wide: true, body: h('div.hr-form',
    field('Dall\'incarico vacante (BOSS)', inc), extra, info, field('Perché serve', motivo),
    h('div.hr-grid2', field('Tipo', tipo), field('Da quando', da), field('Contratto', contr), field('Sede', sede)),
    h('label.hr-row.small', piano, 'Prevista nel piano del personale')),
  actions: [h('button.btn', { type: 'button', on: { click: () => save(false) } }, 'Salva bozza'), h('button.btn.btn-primary', { type: 'button', on: { click: () => save(true) } }, 'Invia per approvazione')] });
  refresh();
}

// ── T · U · V: una richiesta ────────────────────────────────────────────────────────────────────────────────
export async function richiestaView(c, id) {
  const d = await get(`/api/hr/richieste/${id}`);
  const r = d.richiesta;
  const reload = () => richiestaView(c, id);
  const right = h('div.hr-row',
    d.puo_modificare ? h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await post(`/api/hr/richieste/${id}/invia`); toast('Inviata per approvazione'); reload(); } } }, r.stato === 'modifica' ? 'Rimanda per approvazione' : 'Invia per approvazione') : null,
    d.is_hr && ['approvata', 'approvazione', 'modifica', 'bozza'].includes(r.stato) ? h('button.btn', { type: 'button', on: { click: async () => { if (await confirmDialog('Chiudere la richiesta? L\'annuncio esce dalla pagina «Lavora con noi».', { ok: 'Chiudi' })) { await post(`/api/hr/richieste/${id}/chiudi`); reload(); } } } }, 'Chiudi') : null);
  fill(c, h('a.hr-back', { href: '#/hr/richieste' }, '‹ Richieste di personale'),
    head(r.posizione, `${r.area_nome || 'senza area'}${d.ruolo ? ` · ${d.ruolo.title} · G${d.ruolo.grade}` : ''} · ${TIPI[r.tipo] || r.tipo}${r.richiedente ? ` · aperta da ${r.richiedente} il ${itDate(r.created_at)}` : ''}`, right),
    h('div.hr-row', { style: { marginBottom: '12px' } }, statoChip({ ...r, pubblicato: d.annuncio?.pubblicato, published_at: d.annuncio?.published_at, passo: d.passo?.label })),
    approvazione(d, reload),
    d.annuncio ? annuncio(d, reload) : null,
    ['approvata', 'coperta', 'chiusa'].includes(r.stato) || d.candidature.length ? pipeline(d, reload) : null);
}

function approvazione(d, reload) {
  const r = d.richiesta;
  const steps = [h('div.hr-step.done', h('b', '1 · Responsabile'), h('div.small', `${r.richiedente || '—'} · ha aperto la richiesta il ${itDate(r.created_at)}`))];
  const chain = d.catena.length ? d.catena : d.catena_prevista.map((label, i) => ({ label, ordine: i + 1 }));
  for (const s of chain) {
    const now = d.passo && d.passo.id === s.id;
    steps.push(h('span.hr-step-ar', '→'), h('div.hr-step', { class: s.decisione === 'ok' ? 'done' : now ? 'now' : s.decisione === 'no' ? 'no' : '' },
      h('b', `${s.ordine + 1} · ${s.label}`),
      h('div.small', s.decisione ? `${s.chi || ''} · ${s.decisione === 'ok' ? 'ok' : s.decisione === 'no' ? 'no' : 'modifica chiesta'} il ${itDate(s.decided_at)}${s.commento ? ` · «${s.commento}»` : ''}` : now ? 'tocca a questo passo' : d.catena.length ? 'in attesa' : 'dopo l\'invio')));
  }
  if (!chain.some(s => (s.ruolo || '') === 'cfo' || s.label === 'CFO')) {
    steps.push(h('span.hr-step-ar', '→'), h('div.hr-step', { style: { opacity: 0.55 } }, h('b', `${chain.length + 2} · CFO`), h('div.small', 'solo per posizioni nuove, fuori dal piano o sopra G6: qui non serve')));
  }
  const decidi = async decisione => {
    let commento = '';
    if (decisione !== 'ok') {
      const ta = h('textarea.input', { maxlength: 2000, autofocus: true });
      commento = await new Promise(res => { const m = modal({ title: decisione === 'no' ? 'Rifiuta con motivo' : 'Chiedi una modifica', body: field('Motivo', ta), onClose: () => res(null),
        actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => { if (!ta.value.trim()) return; const v = ta.value; m.close(); res(v); } } }, 'Invia')] }); });
      if (!commento) return;
    }
    await post(`/api/hr/richieste/${r.id}/decidi`, { decisione, commento });
    toast('Fatto');
    reload();
  };
  return h('div.hr-grid32',
    h('div.card.hr-pad', h('div.hr-label', 'Approvazione'), h('div.hr-chain', steps),
      d.passo?.tocca_a_me ? h('div.hr-row', { style: { marginTop: '14px' } }, h('button.btn.btn-primary', { type: 'button', on: { click: () => decidi('ok') } }, 'Approva'),
        h('button.btn', { type: 'button', on: { click: () => decidi('modifica') } }, 'Chiedi una modifica'), h('button.btn', { type: 'button', on: { click: () => decidi('no') } }, 'Rifiuta con motivo')) : null,
      h('p.small.muted', 'La catena si sceglie da sola: sostituzione nel piano HR → Direzione; nuova posizione, fuori dal piano o sopra G6 anche il CFO. «Chiedi una modifica» torna al responsabile senza perdere gli ok già dati.')),
    h('div.card.hr-pad', h('div.hr-label', 'Cosa vede chi approva'),
      h('table.hr-t', h('tr', h('td', 'Ruolo · grade'), h('td', d.ruolo ? `${d.ruolo.title} · G${d.ruolo.grade}` : '—')), h('tr', h('td', 'Fascia'), h('td', bandTxt(d.band))),
        h('tr', h('td', 'Costo azienda stimato (al riferimento)'), h('td', d.costo ? `${eur(d.costo.azienda)}/anno` : '—')), h('tr', h('td', 'Piano del personale'), h('td', r.nel_piano ? 'previsto' : 'fuori dal piano')),
        h('tr', h('td', 'Motivo'), h('td', r.motivo || '—')), h('tr', h('td', 'Da quando · contratto · sede'), h('td', `${r.da_quando || '—'} · ${CONTRATTI[r.contratto] || r.contratto} · ${r.sede || '—'}`))),
      h('p.small.muted', 'Chi approva vede fascia e costo della posizione, mai le RAL delle persone.')));
}

function annuncio(d, reload) {
  const a = d.annuncio;
  const r = d.richiesta;
  const url = `${location.origin}/lavora-con-noi/${a.slug}`;
  const t = a.testo || {};
  const plain = () => `${a.titolo}\nAlmacis · ${r.sede || ''} · ${CONTRATTI[r.contratto] || ''}\nRAL ${eur(a.ral_min)} – ${eur(a.ral_max)} lordi annui${a.variabile ? ` · premio variabile ${a.variabile}` : ''}\n\nIl ruolo\n${t.scopo || ''}\n\nCosa farai\n${t.cosa || ''}\n\nCosa cerchiamo\n${t.requisiti || ''}\n\nCome crescerai\n${t.crescita || ''}\n\nCandidati: ${url}`;
  const copy = async canale => { try { await navigator.clipboard.writeText(plain()); toast(`Testo per ${canale} copiato: incollalo nell'annuncio`); } catch { toast('Copia non riuscita', 'err'); } };
  const edit = () => {
    const titolo = h('input.input', { value: a.titolo, maxlength: 200 });
    const areas = Object.fromEntries([['scopo', 'Il ruolo'], ['cosa', 'Cosa farai'], ['requisiti', 'Cosa cerchiamo'], ['crescita', 'Come crescerai']].map(([k, l]) => [k, [l, h('textarea.input', { maxlength: 5000 }, t[k] || '')]]));
    const m = modal({ title: 'Modifica l\'annuncio', wide: true, body: h('div.hr-form', field('Titolo', titolo), Object.values(areas).map(([l, ta]) => field(l, ta)),
      h('p.small.muted', `La fascia (${eur(a.ral_min)} – ${eur(a.ral_max)}) viene dal pannello del salary grade e non si modifica qui.`)),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await put(`/api/hr/richieste/${r.id}/annuncio`, { titolo: titolo.value, testo: Object.fromEntries(Object.entries(areas).map(([k, [, ta]]) => [k, ta.value])) }); m.close(); reload(); } } }, 'Salva')] });
  };
  const pubblica = async on => { const res = await post(`/api/hr/richieste/${r.id}/annuncio/pubblica`, { pubblicato: on }); toast(on ? 'Annuncio online su «Lavora con noi»' : 'Annuncio ritirato'); if (res) reload(); };
  const perFonte = f => d.candidature.filter(x => x.fonte === f).length;
  return h('div.hr-grid32',
    h('div.card.hr-pad', h('div.hr-row', { style: { justifyContent: 'space-between' } }, h('div.hr-label', 'Annuncio'),
      h('div.hr-row', a.pubblicato ? h('span.hr-chip.z-ok', `pubblicato da ${days(a.published_at)} giorni`) : h('span.hr-chip', 'bozza'),
        a.pubblicato ? h('a.btn.btn-sm', { href: url, target: '_blank', rel: 'noopener' }, 'Anteprima pubblica ↗') : null,
        d.is_hr ? h('button.btn.btn-sm', { type: 'button', on: { click: edit } }, 'Modifica') : null)),
      h('h3', { style: { margin: '6px 0 2px' } }, a.titolo), h('div.small.muted', `Almacis · ${r.sede || '—'} · ${CONTRATTI[r.contratto] || r.contratto}${r.da_quando ? ` · ingresso ${r.da_quando}` : ''}`),
      h('div.hr-row', { style: { margin: '8px 0' } }, h('span.hr-chip.z-hi', `RAL ${eur(a.ral_min)} – ${eur(a.ral_max)} lordi annui`), a.variabile ? h('span.hr-chip', `premio variabile ${a.variabile}`) : null),
      [['scopo', 'Il ruolo'], ['cosa', 'Cosa farai'], ['requisiti', 'Cosa cerchiamo'], ['crescita', 'Come crescerai']].map(([k, l]) => (t[k] ? h('div', h('b.small', l), h('p.small', { style: { whiteSpace: 'pre-wrap', margin: '2px 0 8px' } }, t[k])) : null)),
      d.is_hr && r.stato === 'approvata' ? h('div.hr-row', a.pubblicato ? h('button.btn', { type: 'button', on: { click: () => pubblica(false) } }, 'Ritira dalla pagina')
        : h('button.btn.btn-primary', { type: 'button', on: { click: () => pubblica(true) } }, 'Pubblica su «Lavora con noi»')) : null),
    h('div',
      h('div.card.hr-pad', h('div.hr-label', 'Canali'),
        h('div.hr-li', h('span', 'Pagina «Lavora con noi»'), h('span.small', `${perFonte('pagina')} candidature`)),
        h('div.hr-li', h('span', 'LinkedIn'), d.is_hr ? h('button.btn.btn-sm', { type: 'button', on: { click: () => copy('LinkedIn') } }, 'Copia il testo') : h('span.small', perFonte('linkedin'))),
        h('div.hr-li', h('span', 'Indeed'), d.is_hr ? h('button.btn.btn-sm', { type: 'button', on: { click: () => copy('Indeed') } }, 'Copia il testo') : h('span.small', perFonte('indeed'))),
        h('div.hr-li', h('span', 'Referral interno'), h('span.small', `${perFonte('referral')} candidature`))),
      h('div.card.hr-pad', h('div.hr-label', 'Controlli automatici (Direttiva UE 2023/970)'),
        a.controlli.map(x => h('div.small', { style: { padding: '3px 0' } }, x.ok ? h('span.z-ok-t', '✓ ') : h('span.z-bad-t', '✕ '), x.testo)),
        h('p.small.muted', 'Senza tutti i ✓ non si pubblica. La fascia la legge dal pannello del salary grade alla pubblicazione.'))));
}

// V · pipeline: una colonna per passo, si trascina la scheda
function pipeline(d, reload) {
  const r = d.richiesta;
  const cols = d.stages;
  const moveTo = async (appId, stage) => {
    let motivo = '';
    if (stage === 'scartata') {
      const ta = h('input.input', { maxlength: 500, autofocus: true, placeholder: 'esperienza non adatta, sede, RAL attesa…' });
      motivo = await new Promise(res => { const m = modal({ title: 'Scarta con motivo', body: field('Motivo (resta nella storia e nei numeri)', ta), onClose: () => res(null),
        actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => { if (!ta.value.trim()) return; const v = ta.value; m.close(); res(v); } } }, 'Scarta')] }); });
      if (!motivo) return;
    }
    if (stage === 'offerta' || stage === 'accettata') { location.hash = `#/hr/candidato/${appId}`; return; }
    const res = await patch(`/api/hr/candidature/${appId}`, { stage, motivo_scarto: motivo });
    if (res?.risposta) rispostaGentile(res.risposta);
    reload();
  };
  const board = h('div.hr-kanban', cols.map(([k, label]) => {
    const items = d.candidature.filter(a => a.stage === k);
    const col = h('div.hr-kcol', { 'data-stage': k }, h('h5', h('span', label), h('span', String(items.length))),
      items.map(a => h('a.hr-kcard', { href: `#/hr/candidato/${a.id}`, draggable: d.is_hr ? 'true' : 'false', 'data-id': a.id },
        h('b', `${a.nome} ${String(a.cognome || '').slice(0, 1)}.`), a.fonte ? h('div.small.muted', { 'data-fonte': a.fonte }, `${{ pagina: 'Lavora con noi', linkedin: 'LinkedIn', indeed: 'Indeed', referral: 'referral', hr: 'caricato da HR', altro: 'altro' }[a.fonte]} · ${itDate(a.created_at)}`) : null,
        a.colloquio && ['colloquio_hr', 'colloquio_tecnico'].includes(a.stage) ? h('div.small', `${a.colloquio.tipo === 'hr' ? 'HR' : 'tecnico'} con ${a.colloquio.chi}${a.colloquio.quando ? ` · ${itDate(a.colloquio.quando)}` : ''}`) : null,
        a.votanti ? h('div.small.muted', `scorecard: ${a.votanti} ${a.votanti === 1 ? 'voto' : 'voti'}`) : null,
        a.offerta && a.stage === 'offerta' ? h('div.small', h('span.hr-chip', { class: a.offerta === 'approvazione' ? 'z-warn' : 'z-ok' }, a.offerta === 'approvazione' ? 'in approvazione' : a.offerta)) : null,
        a.stage === 'scartata' && a.motivo_scarto ? h('div.small.muted', a.motivo_scarto) : null,
        a.match_pct != null ? h('div.small', h('span.hr-chip.z-ai', `✦ corrispondenza ${a.match_pct}%`)) : null)),
      k === 'accettata' && !items.length ? h('div.small.muted', 'da qui parte il pre-boarding') : null,
      k === 'scartata' ? h('div.small.muted', 'con il motivo; restano 24 mesi se c\'è il consenso') : null);
    if (d.is_hr) {
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', e => { e.preventDefault(); col.classList.remove('over'); const idd = Number(e.dataTransfer.getData('text/plain')); if (idd) moveTo(idd, k); });
    }
    return col;
  }));
  board.addEventListener('dragstart', e => { const card = e.target.closest?.('.hr-kcard'); if (card) e.dataTransfer.setData('text/plain', card.dataset.id); });
  const addBtn = d.is_hr && r.stato === 'approvata' ? h('button.btn.btn-sm', { type: 'button', on: { click: () => nuovoCandidato(r.id, reload) } }, icon('plus', { size: 14 }), 'Candidato') : null;
  return h('div.card.hr-pad', h('div.hr-row', { style: { justifyContent: 'space-between' } }, h('div.hr-label', `Candidati · ${d.candidature.length}`), addBtn), board,
    howTo('Una colonna per passo. Il team HR trascina la scheda da un passo all\'altro; «Scartati» chiede il motivo e prepara una risposta gentile. Offerta e accettazione si fanno dalla scheda del candidato. ✦ = lettura del CV di Alma: ordina e spiega, non scarta nessuno.'));
}

function rispostaGentile(testo) {
  const ta = h('textarea.input', { rows: 9 }, testo);
  modal({ title: 'Risposta al candidato (bozza)', body: h('div', ta, h('p.small.muted', 'Copiala e inviala dalla tua casella: Alma non scrive ai candidati da sola.')),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => { try { await navigator.clipboard.writeText(ta.value); toast('Copiata'); } catch { toast('Copia non riuscita', 'err'); } } } }, 'Copia')] });
}

function nuovoCandidato(reqId, reload) {
  const nome = h('input.input', { maxlength: 80, autofocus: true });
  const cognome = h('input.input', { maxlength: 80 });
  const email = h('input.input', { type: 'email', maxlength: 200 });
  const tel = h('input.input', { maxlength: 40 });
  const fonte = h('select.select', [['linkedin', 'LinkedIn'], ['indeed', 'Indeed'], ['referral', 'Referral interno'], ['hr', 'Caricato da HR'], ['altro', 'Altro']].map(([k, l]) => h('option', { value: k }, l)));
  const cv = h('input', { type: 'file', accept: '.pdf,.doc,.docx,.txt' });
  const conserva = h('input', { type: 'checkbox' });
  const m = modal({ title: 'Aggiungi un candidato', body: h('div.hr-form', h('div.hr-grid2', field('Nome', nome), field('Cognome', cognome), field('Email', email), field('Telefono', tel)),
    field('Da dove arriva', fonte), field('CV (PDF o Word, al massimo 5 MB)', cv), h('label.hr-row.small', conserva, 'Ha dato il consenso a conservare il CV per 24 mesi')),
  actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    if (!nome.value.trim() || !cognome.value.trim()) return toast('Nome e cognome', 'err');
    const f = cv.files[0];
    if (f && f.size > 5 * 1024 * 1024) return toast('Il CV supera 5 MB', 'err');
    await post(`/api/hr/richieste/${reqId}/candidati`, { nome: nome.value, cognome: cognome.value, email: email.value || null, telefono: tel.value || null, fonte: fonte.value, conserva: conserva.checked, cv: f ? await readFile(f) : undefined });
    m.close(); toast('Candidato aggiunto'); reload();
  } } }, 'Aggiungi')] });
}

// ── W · X: scheda del candidato e offerta ───────────────────────────────────────────────────────────────────
const domande = comp => [`Raccontami un caso concreto legato a «${comp}»: cosa hai fatto tu, con quali numeri, e com'è finita?`, `Su «${comp}», cosa faresti diversamente oggi rispetto a qualche anno fa?`];
export async function candidatoView(c, id) {
  const d = await get(`/api/hr/candidature/${id}`);
  const a = d.candidatura;
  const p = d.candidato;
  const hr = d.accesso === 'hr';
  const reload = () => candidatoView(c, id);
  const sc = d.scorecard;
  const initials = `${p.nome[0] || ''}${(p.cognome || '')[0] || ''}`;
  // scorecard: una colonna per intervistatore, la media quando hanno votato tutti
  const voters = [...new Set(d.colloqui.map(x => x.interviewer_email.toLowerCase()))];
  const nameOf = e => d.colloqui.find(x => x.interviewer_email.toLowerCase() === e)?.name || e;
  const vote = (e, comp) => sc.visibili.find(s => s.email.toLowerCase() === e && s.competenza === comp)?.voto;
  const myVotes = {};
  const scoreTable = h('table.hr-t', h('tr', h('th', 'Competenza'), voters.map(e => h('th', nameOf(e))), h('th', 'Media')),
    sc.voci.map(comp => h('tr', h('td', comp), voters.map(e => h('td', vote(e, comp) != null ? h('span.hr-score', [1, 2, 3, 4, 5].map(n => h('i', { class: n <= vote(e, comp) ? 'f' : '' }))) : '—')),
      h('td', sc.medie?.[comp] != null ? h('b', k1(sc.medie[comp])) : '—'))));
  const voteForm = sc.posso_votare ? h('div', h('div.hr-label', 'Il tuo voto (1–5)'), sc.voci.map(comp => {
    const mine = vote(sc.io, comp);
    if (mine) myVotes[comp] = mine;
    const sel = h('select.select', h('option', { value: '' }, '—'), [1, 2, 3, 4, 5].map(n => h('option', { value: n, selected: n === mine }, n)));
    sel.addEventListener('change', () => { myVotes[comp] = Number(sel.value); });
    return h('div.hr-li', h('span.small', comp), sel);
  }), h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: async () => {
    const voti = Object.entries(myVotes).filter(([, v]) => v).map(([competenza, voto]) => ({ competenza, voto }));
    if (!voti.length) return toast('Dai almeno un voto', 'err');
    await put(`/api/hr/candidature/${id}/voti`, { voti }); toast('Voti salvati'); reload();
  } } }, 'Salva i voti')) : null;
  const colloquio = () => {
    const tipo = h('select.select', h('option', { value: 'hr' }, 'Colloquio HR'), h('option', { value: 'tecnico' }, 'Colloquio tecnico'));
    const chi = h('input.input', { type: 'email', placeholder: 'email di chi intervista', maxlength: 200 });
    const quando = h('input.input', { type: 'datetime-local' });
    const m = modal({ title: 'Fissa un colloquio', body: h('div.hr-form', field('Tipo', tipo), field('Chi intervista', chi), field('Quando', quando),
      h('p.small.muted', 'Se Microsoft è collegato, l\'invito Outlook con il link di Teams parte dal tuo calendario a chi intervista e al candidato.')),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      if (!chi.value.trim()) return toast('Chi intervista?', 'err');
      const res = await post(`/api/hr/candidature/${id}/colloqui`, { tipo: tipo.value, interviewer_email: chi.value, quando: quando.value ? new Date(quando.value).toISOString() : null });
      m.close(); toast(res.avviso || 'Colloquio fissato', res.avviso ? 'err' : 'ok'); reload();
    } } }, 'Fissa')] });
  };
  const scarta = async () => {
    const ta = h('input.input', { maxlength: 500, autofocus: true });
    const motivo = await new Promise(res => { const m = modal({ title: 'Scarta con motivo', body: field('Motivo', ta), onClose: () => res(null),
      actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => { if (!ta.value.trim()) return; const v = ta.value; m.close(); res(v); } } }, 'Scarta')] }); });
    if (!motivo) return;
    const r = await patch(`/api/hr/candidature/${id}`, { stage: 'scartata', motivo_scarto: motivo });
    if (r?.risposta) rispostaGentile(r.risposta);
    reload();
  };
  const rileggi = async () => { const r = await post(`/api/hr/candidature/${id}/match`); toast(`Corrispondenza ${r.pct ?? '—'}%`); reload(); };
  const domandeBox = sc.voci.length ? h('div.card.hr-pad', h('div.hr-label', 'Domande suggerite (stesse per tutti i candidati del ruolo)'),
    sc.voci.slice(0, 2).map(comp => h('div', h('b.small', comp), h('ul.small', domande(comp).map(q => h('li', q)))))) : null;

  fill(c, h('a.hr-back', { href: `#/hr/richieste/${a.req_id}` }, `‹ ${a.posizione}`),
    h('div.page-head', h('div.hr-row', h('div.hr-avatar', initials.toUpperCase()), h('div', h('div.hr-eyebrow', 'Alma HR · candidato'), h('h1', `${p.nome} ${p.cognome || ''}`),
      h('div.sub', `candidato a ${d.ruolo?.title || a.posizione} · da ${a.fonte_label || a.fonte} il ${itDate(a.created_at)}`))),
    hr ? h('div.hr-row', h('span.hr-chip', (d.stages.find(s => s[0] === a.stage) || [, a.stage])[1]), h('button.btn', { type: 'button', on: { click: colloquio } }, 'Fissa un colloquio'),
      a.stage !== 'scartata' && a.stage !== 'accettata' ? h('button.btn', { type: 'button', on: { click: scarta } }, 'Scarta con motivo') : null) : null),
    h('div.hr-grid32',
      h('div',
        h('div.card.hr-pad', h('div.hr-row', { style: { justifyContent: 'space-between' } }, h('div.hr-label', `✦ Corrispondenza al ruolo${a.match_pct != null ? ` · ${a.match_pct}%` : ''}`),
          hr && d.files.some(f => f.tipo === 'cv') ? h('button.btn.btn-sm', { type: 'button', on: { click: rileggi } }, 'Rileggi il CV') : null),
          a.match_note ? h('p.small', { style: { whiteSpace: 'pre-wrap' } }, a.match_note) : h('p.small.muted', 'Nessuna lettura del CV ancora.'),
          h('p.small.muted', 'Alma propone, non decide: è una lettura del CV da verificare al colloquio.')),
        h('div.card.hr-pad', h('div.hr-label', `Scorecard · ${sc.votato} di ${sc.totale} intervistatori hanno votato`),
          voters.length ? scoreTable : h('p.small.muted', 'Nessun colloquio fissato.'), !sc.tutti && sc.totale ? h('p.small.muted', 'La media e i voti degli altri si vedono quando hanno votato tutti.') : null, voteForm),
        domandeBox,
        hr || d.accesso === 'approvatore' ? offertaBox(d, id, reload) : d.offerta ? h('div.card.hr-pad', h('div.hr-label', 'Offerta'), h('p.small', `${d.offerta.stato} · ${d.offerta.zona}`), h('p.small.muted', 'La cifra la vedono il team HR e chi la deve approvare.')) : null),
      h('div',
        hr ? h('div.card.hr-pad', h('div.hr-label', 'Contatti e consenso'), h('table.hr-t', h('tr', h('td', 'Email'), h('td', p.email || '—')), h('tr', h('td', 'Telefono'), h('td', p.telefono || '—')),
          h('tr', h('td', 'Conservare il CV'), h('td', p.conserva ? `sì${p.conservare_fino ? `, fino al ${itDate(p.conservare_fino)}` : ''}` : 'no: si cancella 30 giorni dopo la chiusura della selezione'))),
          a.stage !== 'accettata' ? h('button.btn.btn-sm', { type: 'button', style: { marginTop: '8px' }, on: { click: async () => { if (!(await confirmDialog("Cancellare subito tutti i dati e i file del candidato, su sua richiesta? Non si può annullare.", { ok: 'Cancella', danger: true }))) return; const r = await del(`/api/hr/candidature/${id}/candidato`); toast('Dati del candidato cancellati'); location.hash = `#/hr/richieste/${r.req_id}`; } } }, 'Cancella i dati su richiesta') : null) : null,
        d.files.length ? h('div.card.hr-pad', h('div.hr-label', 'Documenti'), d.files.map(f => h('div.hr-li', h('a', { href: `/api/hr/file/${f.id}`, target: '_blank', rel: 'noopener' }, icon('file-text', { size: 14 }), ` ${f.nome}`), h('span.small.muted', f.tipo)))) : null,
        d.colloqui.length ? h('div.card.hr-pad', h('div.hr-label', 'Colloqui'), d.colloqui.map(x => h('div.hr-li', h('div', h('b.small', x.tipo === 'hr' ? 'Colloquio HR' : 'Colloquio tecnico'), h('div.small.muted', `${x.name || x.interviewer_email}${x.quando ? ` · ${fmtDateTime(x.quando)}` : ''}`)),
          x.join_url ? h('a.btn.btn-sm', { href: x.join_url, target: '_blank', rel: 'noopener' }, 'Teams ↗') : null))) : null,
        d.storia.length ? h('div.card.hr-pad', h('div.hr-label', 'Storia'), d.storia.map(e => h('div.small', { style: { padding: '3px 0' } }, h('b', itDate(e.at)), ` ${e.testo}${e.chi ? ` · ${e.chi}` : ''}`))) : null,
        d.preboarding_id ? h('a.btn.btn-primary', { href: `#/hr/preboarding/${d.preboarding_id}` }, 'Apri il pre-boarding') : null)));
}

function offertaBox(d, appId, reload) {
  const o = d.offerta;
  const band = d.band;
  const hr = d.accesso === 'hr';
  const editable = hr && (!o || ['bozza', 'respinta', 'rifiutata'].includes(o.stato)) && !['scartata', 'accettata'].includes(d.candidatura.stage);
  if (editable) {
    const ral = h('input.input', { type: 'number', step: 500, value: o?.ral || (band ? Math.round(band.mid * 1000) : '') });
    const ingresso = h('input.input', { type: 'date', value: o?.ingresso ? String(o.ingresso).slice(0, 10) : '' });
    const contr = h('select.select', Object.entries(CONTRATTI).map(([k, l]) => h('option', { value: k, selected: (o?.contratto || 'TI') === k }, l)));
    const ccnl = h('input.input', { value: o?.ccnl_livello || '', maxlength: 80, placeholder: 'Metalmeccanico B2, Edilizia 4…' });
    const benefit = h('input.input', { value: o?.benefit || '', maxlength: 500, placeholder: 'auto aziendale, buoni pasto…' });
    const prova = h('input.input', { type: 'number', min: 0, max: 12, value: o?.prova_mesi ?? 6 });
    const motivo = h('textarea.input', { maxlength: 2000, placeholder: 'Obbligatorio fuori fascia: perché' }, o?.motivo || '');
    const check = h('div');
    const bar = h('div');
    const draw = res => {
      const k = Number(ral.value) / 1000;
      fill(bar, band ? h('div.hr-offbar', h('div.hr-offbar-fill'), h('div.hr-offbar-mid', { style: { left: `${(band.mid - band.min) / (band.max - band.min) * 100}%` } }), h('div.hr-offbar-me', { style: { left: `${Math.max(-2, Math.min(102, (k - band.min) / (band.max - band.min) * 100))}%` } }, h('span', `${k1(k)} k`)),
        h('div.hr-zbar-legend', h('span', `${k1(band.min)} k min`), h('span', `${k1(band.mid)} k riferimento`), h('span', `${k1(band.max)} k max`))) : h('p.small.muted', 'Senza ruolo non c\'è fascia: l\'offerta va alla Direzione.'));
      if (!res) return;
      const alt = res.equita && res.equita.scarto_pct > 5 ? Math.round(Math.max(band?.mid * 1000 || 0, res.equita.media) / 500) * 500 : null;
      fill(check, h('p.small', h('b', res.fuori ? 'Fuori fascia' : `Zona: ${res.zona}`), ` · approvano: ${res.catena.join(' → ')}`),
        res.equita ? h('p.small', h('b', 'Equità interna'), ` · ${res.equita.n === 1 ? `l'unica persona con lo stesso ruolo guadagna ${eur(res.equita.media)}` : `le ${res.equita.n} persone con lo stesso ruolo guadagnano in media ${eur(res.equita.media)}`}: la nuova entrerebbe ${res.equita.scarto_pct > 0 ? `il ${res.equita.scarto_pct}% sopra` : res.equita.scarto_pct < 0 ? `il ${-res.equita.scarto_pct}% sotto` : 'in linea'}.`) : h('p.small.muted', 'Nessuno in azienda ha oggi lo stesso ruolo: niente confronto.'),
        alt ? h('p.small', h('span.hr-chip.z-ai', '✦ Alternative'), ` ${eur(alt)} + un benefit, oppure ${eur(alt)} con revisione a fine periodo di prova.`) : null);
    };
    const body = () => ({ ral: Number(ral.value), ingresso: ingresso.value || null, contratto: contr.value, ccnl_livello: ccnl.value, benefit: benefit.value, prova_mesi: Number(prova.value), motivo: motivo.value });
    const salva = async () => { const r = await post(`/api/hr/candidature/${appId}/offerta`, body()); draw(r); return r; };
    ral.addEventListener('input', () => draw());
    draw();
    return h('div.card.hr-pad', h('div.hr-label', `Offerta${o ? ` · ${o.stato}` : ''}`), bar,
      h('div.hr-grid2.hr-form', field('RAL proposta (€)', ral), field('Ingresso', ingresso), field('Contratto', contr), field('CCNL · livello', ccnl), field('Benefit', benefit), field('Periodo di prova (mesi)', prova)),
      d.variabile ? h('p.small', h('b', 'Premio variabile target'), ` · ${d.variabile} (dal pannello del salary grade)`) : null,
      field('Motivo', motivo), check,
      h('div.hr-row', h('button.btn', { type: 'button', on: { click: async () => { await salva(); toast('Bozza salvata'); } } }, 'Salva e controlla'),
        h('button.btn.btn-primary', { type: 'button', on: { click: async () => { const r = await salva(); await post(`/api/hr/offerte/${r.id}/invia`); toast('Offerta inviata'); reload(); } } }, 'Invia per approvazione')),
      h('p.small.muted', 'Fino al riferimento: team HR. Fino al massimo: team HR + responsabile. Fuori fascia: Direzione, con motivo scritto (regole del pannello).'));
  }
  if (!o) return null;
  const decide = async decisione => {
    let commento = '';
    if (decisione !== 'ok') { commento = await askReason(decisione === 'no' ? "Respingi l'offerta" : "Chiedi una modifica all'offerta"); if (!commento) return; }
    await post(`/api/hr/offerte/${o.id}/decidi`, { decisione, commento }); reload();
  };
  const esito = async e => {
    let motivo = '';
    if (e === 'rifiutata') { motivo = await askReason('Il candidato ha rifiutato', 'Perché? (serve ai numeri)', 'RAL, sede, altra offerta…'); if (!motivo) return; }
    const r = await post(`/api/hr/offerte/${o.id}/esito`, { esito: e, motivo });
    if (r.preboarding_id) { toast(`Accettata: parte il pre-boarding${r.da_avvisare.length ? ` · ${r.da_avvisare.length} candidati da avvisare` : ''}`); location.hash = `#/hr/preboarding/${r.preboarding_id}`; } else reload();
  };
  return h('div.card.hr-pad', h('div.hr-label', `Offerta · ${o.stato}`),
    h('table.hr-t', h('tr', h('td', 'RAL'), h('td', h('b', eur(o.ral)), ` · ${o.zona}`)), h('tr', h('td', 'Ingresso'), h('td', itDate(o.ingresso))), h('tr', h('td', 'Contratto · CCNL'), h('td', `${CONTRATTI[o.contratto] || o.contratto} · ${o.ccnl_livello || '—'}`)),
      h('tr', h('td', 'Benefit · prova'), h('td', `${o.benefit || '—'} · ${o.prova_mesi} mesi`)), o.motivo ? h('tr', h('td', 'Motivo'), h('td', o.motivo)) : null,
      o.equita ? h('tr', h('td', 'Equità interna'), h('td', `${o.equita.scarto_pct > 0 ? '+' : ''}${o.equita.scarto_pct}% sulla media di ${o.equita.n} pari ruolo`)) : null),
    o.catena?.length ? h('div.small', { style: { margin: '8px 0' } }, o.catena.map(s => `${s.label}: ${s.decisione || 'in attesa'}`).join(' → ')) : null,
    o.passo?.tocca_a_me ? h('div.hr-row', h('button.btn.btn-primary', { type: 'button', on: { click: () => decide('ok') } }, 'Approva'), h('button.btn', { type: 'button', on: { click: () => decide('modifica') } }, 'Chiedi una modifica'),
      h('button.btn', { type: 'button', on: { click: () => decide('no') } }, 'Respingi')) : null,
    hr && ['approvata', 'inviata'].includes(o.stato) ? h('div.hr-row', h('a.btn', { href: `/api/hr/offerte/${o.id}/lettera.docx` }, icon('file-text', { size: 14 }), 'Lettera d\'offerta (Word)'),
      o.stato === 'approvata' ? h('button.btn', { type: 'button', on: { click: () => esito('inviata') } }, 'Segna come inviata') : null,
      h('button.btn.btn-primary', { type: 'button', on: { click: () => esito('accettata') } }, 'Ha accettato'), h('button.btn', { type: 'button', on: { click: () => esito('rifiutata') } }, 'Ha rifiutato')) : null);
}

// ── Y · pre-boarding ────────────────────────────────────────────────────────────────────────────────────────
const CHI = { candidato: 'candidato', hr: 'HR', consulente: 'HR · consulente', boss: 'HR · BOSS', it: 'IT', magazzino: 'magazzino', mezzi: 'mezzi', responsabile: 'responsabile' };
export async function preboardingView(c, id) {
  if (!id) {
    const d = await get('/api/hr/preboarding');
    return fill(c, head('Pre-boarding', 'Dal «sì» del candidato al primo giorno. La persona si crea su BOSS: Alma prepara i dati e la ritrova con la sincronizzazione.'),
      h('div.card.hr-scroll', h('table.list', h('thead', h('tr', ['Persona', 'Posizione', 'Ingresso', 'Compiti', 'Stato'].map(x => h('th', x)))),
        h('tbody', d.preboarding.length ? d.preboarding.map(p => h('tr', { class: 'clickable', on: { click: () => { location.hash = `#/hr/preboarding/${p.id}`; } } },
          h('td', h('b', `${p.nome} ${p.cognome}`)), h('td', p.posizione), h('td', itDate(p.ingresso)), h('td', `${p.fatti} di ${p.compiti}`),
          h('td', h('span.hr-chip', { class: p.stato === 'arrivato' ? 'z-ok' : p.stato === 'annullato' ? '' : 'z-warn' }, p.stato))))
          : h('tr', h('td.empty', { colSpan: 5 }, 'Nessun ingresso in arrivo.'))))));
  }
  const d = await get(`/api/hr/preboarding/${id}`);
  const p = d.preboarding;
  const reload = () => preboardingView(c, id);
  const fatti = d.compiti.filter(t => t.fatto).length;
  const bossBtn = () => {
    const b = d.boss;
    const rows = [['Nome', b.nome], ['Cognome', b.cognome], ['Email', b.email], ['Telefono', b.telefono], ['Incarico', b.incarico], ['Area', b.area], ['Contratto', CONTRATTI[b.contratto] || b.contratto], ['CCNL · livello', b.ccnl_livello], ['Data di assunzione', itDate(b.ingresso)], ['RAL', eur(b.ral)]];
    const txt = rows.map(([k, v]) => `${k}: ${v || '—'}`).join('\n');
    modal({ title: 'Dati per creare la persona su BOSS', body: h('div', h('table.hr-t', rows.map(([k, v]) => h('tr', h('td', k), h('td', v || '—')))),
      h('p.small.muted', 'Su BOSS crea la persona e mettila sull\'incarico: alla prossima sincronizzazione Alma la trova e spunta il compito da sola.')),
    actions: [h('button.btn', { type: 'button', on: { click: async () => { try { await navigator.clipboard.writeText(txt); toast('Dati copiati'); } catch { toast('Copia non riuscita', 'err'); } } } }, 'Copia i dati'),
      b.url ? h('a.btn.btn-primary', { href: b.url, target: '_blank', rel: 'noopener' }, 'Apri BOSS ↗') : null] });
  };
  const toggle = async t => { await patch(`/api/hr/preboarding/${id}/compiti/${t.id}`, { fatto: !t.fatto }); reload(); };
  const spostaData = async () => {
    const inp = h('input.input', { type: 'date', value: p.ingresso });
    const m = modal({ title: 'Sposta la data d\'ingresso', body: h('div', field('Primo giorno', inp), h('p.small.muted', 'Le scadenze dei compiti si spostano con la data.')),
      actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await patch(`/api/hr/preboarding/${id}`, { ingresso: inp.value }); m.close(); reload(); } } }, 'Salva')] });
  };
  const copyLink = async () => { try { await navigator.clipboard.writeText(d.link_candidato); toast('Link copiato: mandalo al nuovo assunto'); } catch { toast('Copia non riuscita', 'err'); } };
  const ingressoTxt = new Date(`${p.ingresso}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  fill(c, h('a.hr-back', { href: '#/hr/preboarding' }, '‹ Pre-boarding'),
    head(`${p.nome} ${p.cognome} · ingresso ${ingressoTxt}`, `${p.posizione} · ${fatti} di ${d.compiti.length} fatti`,
      h('div.hr-row', p.stato === 'arrivato' ? h('span.hr-chip.z-ok', 'arrivato: trovato su BOSS') : null, d.is_hr ? h('button.btn', { type: 'button', on: { click: spostaData } }, 'Sposta la data') : null,
        h('a.btn', { href: `#/hr/candidato/${p.app_id}` }, 'Scheda del candidato'))),
    h('div.hr-grid32',
      h('div.card.hr-pad', d.compiti.map(t => h('div.hr-task', { class: t.in_ritardo ? 'late' : '' },
        h('button.hr-task-ck', { type: 'button', 'aria-label': t.fatto ? 'Segna da fare' : 'Segna fatto', class: t.fatto ? 'on' : '', on: { click: () => toggle(t) } }, t.fatto ? icon('check', { size: 14 }) : ''),
        h('div.hr-task-w', h('div.small', t.giorni === 0 ? 'giorno 1' : t.giorni > 0 ? `giorno ${t.giorni + 1}` : `${t.giorni} giorni`), h('div.small.muted', itDate(t.scadenza))),
        h('div', { style: { flex: 1 } }, h('span', { class: t.fatto ? 'muted' : '' }, t.titolo), t.in_ritardo ? h('span.hr-chip.z-bad', { style: { marginLeft: '6px' } }, 'in ritardo') : null),
        t.chi === 'boss' && d.is_hr && !t.fatto ? h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: bossBtn } }, 'Crea su BOSS ↗') : null,
        h('span.hr-chip', CHI[t.chi] || t.chi))),
      howTo('Scadenze calcolate sulla data d\'ingresso: se la data si sposta, si sposta tutto. «Crea su BOSS» si spunta da solo quando la sincronizzazione trova la persona; il giorno 1, se è anche sull\'incarico, il pre-boarding è chiuso e parte l\'onboarding.')),
      h('div',
        d.link_candidato ? h('div.card.hr-pad.hr-dark', h('div.hr-label', `Benvenuto in Almacis, ${p.nome}`), h('p.small', 'Pagina riservata senza account: documenti per l\'assunzione e taglie dei DPI. Scade il giorno dopo l\'ingresso.'),
          h('button.btn.btn-sm', { type: 'button', on: { click: copyLink } }, 'Copia il link per il candidato')) : null,
        h('div.card.hr-pad', h('div.hr-label', 'Documenti ricevuti'), d.documenti.length ? d.documenti.map(f => h('div.small', d.is_hr ? h('a', { href: `/api/hr/file/${f.id}`, target: '_blank', rel: 'noopener' }, f.nome) : f.nome)) : h('p.small.muted', 'Ancora nessuno.')),
        h('div.card.hr-pad', h('div.hr-label', 'Taglie DPI'), Object.values(p.taglie || {}).some(Boolean) ? h('p.small', Object.entries(p.taglie).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ')) : h('p.small.muted', 'Le indica il candidato dalla sua pagina.')))));
}

// ── Z · numeri del recruitment ──────────────────────────────────────────────────────────────────────────────
export async function numeriView(c, params) {
  const mesi = Number(params.get('mesi')) || 12;
  const dal = new Date(Date.now() - mesi * 30.4 * 86400000).toISOString().slice(0, 10);
  const d = await get(`/api/hr/recruitment/numeri?dal=${dal}&${ambQs()}`);
  const amb = await ambitoSelect(() => numeriView(c, params));
  const per = h('select.select', [[6, 'Ultimi 6 mesi'], [12, 'Ultimi 12 mesi'], [24, 'Ultimi 24 mesi']].map(([v, l]) => h('option', { value: v, selected: v === mesi }, l)));
  per.addEventListener('change', () => { location.hash = `#/hr/recruitment?mesi=${per.value}`; });
  const max = Math.max(1, d.funnel[0][1]);
  const kpi = (l, v, s) => h('div.hr-kpi', h('div.l', l), h('div.v', v), s ? h('div.small.muted', s) : null);
  const rif = d.rifiuti.length ? `${d.rifiuti.length} rifiutate: ${[...new Set(d.rifiuti)].slice(0, 3).join(', ')}` : 'nessun rifiuto';
  fill(c, head('Numeri del recruitment', 'Quanto ci mettiamo ad assumere, da dove arrivano i candidati migliori, dove si perdono. Con lo stesso «Ambito» delle altre analisi.', h('div.hr-row', amb, per, h('a.btn', { href: `/api/hr/recruitment/numeri.xlsx?dal=${dal}&${ambQs()}` }, icon('sheet', { size: 14 }), 'Esporta Excel'))),
    h('div.hr-grid4',
      kpi('Tempo per assumere', d.tempo_mediana != null ? `${d.tempo_mediana} gg` : '—', 'dalla richiesta approvata al sì · mediana'),
      kpi('Posizioni chiuse', String(d.chiuse), d.aperte_vecchie ? `${d.aperte_vecchie} ancora aperte da oltre 45 giorni` : 'nessuna aperta da oltre 45 giorni'),
      kpi('Offerte accettate', d.offerte_accettate_pct != null ? `${d.offerte_accettate_pct}%` : '—', rif),
      kpi('Ancora qui dopo 6 mesi', d.ancora_qui ? `${Math.round(d.ancora_qui.attivi / d.ancora_qui.su * 100)}%` : '—', d.ancora_qui ? `${d.ancora_qui.attivi} di ${d.ancora_qui.su} ingressi` : 'ancora nessun ingresso di 6 mesi fa')),
    h('div.hr-grid2',
      h('div.card.hr-pad', h('div.hr-label', 'Dove si perdono i candidati'), d.funnel.map(([l, n]) => h('div.hr-funnel', { style: { width: `${Math.max(n / max * 100, 18)}%` } }, `${l} · ${n}`))),
      h('div.card.hr-pad', h('div.hr-label', 'Da dove arrivano gli assunti'),
        h('table.hr-t', h('tr', ['Canale', 'Candidature', 'Assunti', 'Resa'].map(x => h('th', x))),
          d.canali.length ? d.canali.map(x => h('tr', h('td', x.label), h('td', x.candidature), h('td', x.assunti), h('td', h('b', `${x.resa}%`)))) : h('tr', h('td.muted', { colSpan: 4 }, 'Ancora nessuna candidatura'))))),
    h('div.card.hr-pad', h('div.hr-label', 'Equità delle offerte (donne e uomini, stesso ruolo)'),
      d.equita.length ? d.equita.map(e => h('div.hr-li', h('span', `${e.ruolo} · ${e.f} offerte a donne, ${e.m} a uomini`), h('span.hr-chip', { class: Math.abs(e.gap) > 5 ? 'z-bad' : 'z-ok' }, `${e.gap > 0 ? '+' : ''}${k1(e.gap)}%`)))
        : h('p.small.muted', 'Servono offerte a donne e uomini sullo stesso ruolo per il confronto (il genere nel modulo è facoltativo).')),
    howTo('Ogni barra è un passo: la lunghezza è quanti candidati ci arrivano rispetto alle candidature. «Resa» = assunti ÷ candidature del canale. Il tempo per assumere parte dall\'approvazione della richiesta, non dalla pubblicazione. Soglia di equità: 5%, come nella mappatura.'),
    h('div.card.hr-pad', h('div.hr-label', 'Privacy dei candidati'), h('ul.small',
      h('li', 'Informativa e consenso nel modulo di candidatura; nessuna domanda su età, stato civile o RAL attuale.'),
      h('li', 'CV dei non assunti: 24 mesi con il consenso, altrimenti 30 giorni dopo la chiusura della selezione; poi si cancellano da soli.'),
      h('li', 'Ogni apertura della scheda o di un file del candidato da parte di chi non è HR finisce nel registro.'))));
}

