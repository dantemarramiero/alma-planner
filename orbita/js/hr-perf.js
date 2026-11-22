// Alma HR, Fase 5: performance e revisione retributiva (ALM2-59; canvas «Alma HR», pagina «Fase 5 · performance»). Pagine:
//   #/hr/valutazioni           elenco: la mia valutazione e le mie persone (tutte per HR)
//   #/hr/valutazione/:id       AH scheda annuale 1–10
//   #/hr/semestre/:id          AI check di luglio
//   #/hr/calibrazione          AJ calibrazione (HR; il responsabile vede le sue persone)
//   #/hr/matrice               AK matrice voto × fascia (HR)
//   #/hr/revisione             AL revisione retributiva (HR in euro, responsabile in %, Direzione e CFO i totali)
//   #/hr/lettere               AM lettere e BOSS
//   #/hr/esito                 AN il mio esito
//   #/hr/ciclo                 AO calendario e avanzamento del ciclo
import { h, fill, toast, modal, confirmDialog, fmtDateTime } from './ui.js';
import { get, post, put, patch } from './api.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { ambitoSelect, ambQs } from './hr.js';

const eur = n => (n == null ? '—' : `${Math.round(n).toLocaleString('it-IT')} €`);
const keur = n => (n == null ? '—' : `${Math.round(n / 1000).toLocaleString('it-IT')} k€`);
const n1 = x => (x == null ? '—' : Number(x).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const pct = x => `${Number(x).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`;
const itDate = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const head = (title, sub, right) => h('div.page-head', h('div', h('div.hr-eyebrow', 'Alma HR · performance'), h('h1', title), sub ? h('div.sub', sub) : null), right || null);
const howTo = (...t) => h('div.hr-howto', h('b', 'Come si legge'), ' · ', ...t);
const field = (label, input) => h('label.field', h('span', label), input);
const SCALA = [[9, 'eccezionale', 'z-ok'], [7, 'sopra le attese', 'z-ok'], [5, 'in linea con il ruolo', ''], [3, 'da migliorare', 'z-warn'], [1, 'insufficiente', 'z-bad']];
const lab = s => (s == null ? null : SCALA.find(([m]) => s >= m) || SCALA[4]);
const labChip = s => { const l = lab(s); return l ? h('span.hr-chip', { class: l[2] }, l[1]) : null; };
const STATUS = { self: ['autovalutazione da fare', 'z-warn'], manager: ['valutazione del responsabile', 'z-info'], closed: ['chiusa', 'z-ok'] };
const yearSel = (year, onChange) => {
  const y0 = new Date().getFullYear();
  const s = h('select.select', [y0 - 2, y0 - 1, y0, y0 + 1].map(y => h('option', { value: y, selected: y === year }, `Ciclo ${y}`)));
  s.addEventListener('change', () => onChange(Number(s.value)));
  return s;
};
const qy = (params, extra = '') => `year=${params.get('year') || ''}${extra}`.replace(/^year=&?/, '');
const askReason = (title, label = 'Motivo') => new Promise(res => {
  const ta = h('textarea.input', { maxlength: 1000, autofocus: true });
  let done = false;
  const m = modal({ title, body: field(label, ta), onClose: () => { if (!done) res(null); }, actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => { if (!ta.value.trim()) return; done = true; m.close(); res(ta.value.trim()); } } }, 'Salva')] });
});

// voto 1–10 a quadratini
function score10(val, { edit = false, onPick, mgr = false } = {}) {
  let cur = val;
  const row = h('span.hr-score10', Array.from({ length: 10 }, (_, i) => h('button', { type: 'button', class: [cur && i < cur ? 'f' : '', mgr ? 'mgr' : ''].join(' '), disabled: !edit, 'aria-label': `voto ${i + 1}`,
    on: { click: () => { cur = i + 1; [...row.children].forEach((b, j) => b.classList.toggle('f', j < cur)); onPick?.(cur); } } }, String(i + 1))));
  return row;
}

// ── elenco valutazioni ──────────────────────────────────────────────────────────────────────────────────────
export async function valutazioniView(c, params) {
  const d = await get(`/api/hr/valutazioni?${qy(params)}`);
  const reload = y => { location.hash = `#/hr/valutazioni?year=${y}`; };
  const amb = d.is_hr ? await ambitoSelect(() => valutazioniView(c, params)) : null;
  const fase = faseBanner(d.ciclo);
  const [st, cl] = STATUS[d.mia.status] || STATUS.self;
  fill(c, head('Valutazioni', `Ciclo ${d.year}: un solo check a luglio e la valutazione di fine anno, sulla scala 1–10.`, h('div.hr-row', amb, yearSel(d.year, reload))),
    fase,
    h('div.card.hr-pad', h('div.hr-row', { style: { justifyContent: 'space-between' } }, h('div', h('div.hr-label', { style: { margin: 0 } }, 'La mia valutazione'), h('span.hr-chip', { class: cl }, st)),
      h('div.hr-row', h('a.btn', { href: `#/hr/semestre/${d.mia.user_id}?year=${d.year}` }, 'Il mio check di luglio'), h('a.btn.btn-primary', { href: `#/hr/valutazione/${d.mia.user_id}?year=${d.year}` }, 'Apri la mia scheda')))),
    d.persone.length ? h('div.card.hr-scroll', h('table.list', h('thead', h('tr', ['Persona', 'Ruolo · area', d.is_hr ? 'Responsabile' : null, 'Check di luglio', 'Valutazione', 'Voto'].filter(Boolean).map(x => h('th', x)))),
      h('tbody', d.persone.map(p => h('tr', h('td', h('a', { href: `#/hr/valutazione/${p.user_id}?year=${d.year}` }, h('b', p.nome))), h('td.small', `${p.ruolo}${p.area ? ` · ${p.area}` : ''}`), d.is_hr ? h('td.small', p.responsabile || '—') : null,
        h('td', h('a.hr-chip', { href: `#/hr/semestre/${p.user_id}?year=${d.year}`, class: p.semestre === 'closed' ? 'z-ok' : '' }, p.semestre === 'closed' ? 'fatto' : 'da fare')),
        h('td', h('span.hr-chip', { class: (STATUS[p.status] || STATUS.self)[1] }, (STATUS[p.status] || STATUS.self)[0])), h('td', p.finale != null ? h('b', n1(p.finale)) : '—')))))) : null,
    !d.is_hr && d.persone.length ? h('div.hr-row', h('a.btn', { href: `#/hr/calibrazione?year=${d.year}` }, 'Calibrazione delle mie persone'), h('a.btn', { href: `#/hr/revisione?year=${d.year}` }, 'Revisione retributiva'), h('a.btn', { href: `#/hr/lettere?year=${d.year}` }, 'Lettere da consegnare')) : null,
    howTo('Gli obiettivi si scrivono e si approvano in Alma Strategy; qui si votano con le competenze del ruolo. Il voto del responsabile la persona lo vede quando la valutazione è chiusa.'));
}
function faseBanner(ciclo) {
  if (!ciclo) return null;
  const today = new Date().toISOString().slice(0, 10);
  const F = [['obiettivi', 'Obiettivi'], ['semestre', 'Check di luglio'], ['valutazione', 'Valutazione'], ['calibrazione', 'Calibrazione'], ['revisione', 'Revisione retributiva']];
  return h('div.hr-chain', { style: { marginBottom: '14px' } }, F.map(([k, l]) => { const f = ciclo.fasi[k]; const on = f && f.apre <= today && today <= f.chiude; const done = f && f.chiude < today;
    return h('div.hr-step', { class: on ? 'now' : done ? 'done' : '' }, h('b', l), h('div.small', f ? `${itDate(f.apre).slice(0, 5)} – ${itDate(f.chiude)}` : '—')); }));
}

// ── AH · scheda annuale ─────────────────────────────────────────────────────────────────────────────────────
export async function schedaView(c, userId, params) {
  const year = params.get('year');
  const d = await get(`/api/hr/valutazione/${userId}${year ? `?year=${year}` : ''}`);
  const r = d.rights;
  const reload = () => schedaView(c, userId, params);
  const canSelf = r.self && d.status === 'self';
  const canMgr = (r.manager || r.hr) && d.status !== 'closed';
  const self = {}; const mgr = {};
  const save = async (extra = {}) => { await patch(`/api/hr/valutazione/${userId}?year=${d.year}`, { ...(Object.keys(self).length ? { self } : {}), ...(Object.keys(mgr).length ? { manager: mgr } : {}), ...extra }); };
  const comm = h('textarea.input', { maxlength: 4000, disabled: !canMgr, placeholder: 'Commento e prossimo passo (lo vede la persona a valutazione chiusa)' }, d.commento || '');
  const cresc = h('input', { type: 'checkbox', checked: d.crescita, disabled: !canMgr });
  const objRows = d.obiettivi.map(o => h('tr', h('td', o.objective || '—', h('div.small.muted', `${o.kpi || ''}${o.target ? ` · target ${o.target}` : ''}`)), h('td', String(o.weight)),
    h('td', o.achievement != null ? `${o.achievement}%` : '—', o.proposto ? h('div.small.muted', `proposto ${o.proposto}`) : null),
    h('td', score10(o.self ?? (canSelf ? o.proposto : null), { edit: canSelf, onPick: x => { self[`obj:${o.id}`] = x; } })),
    h('td', d.voto.manager !== null || canMgr ? score10(o.manager ?? (canMgr ? o.proposto : null), { edit: canMgr, mgr: true, onPick: x => { mgr[`obj:${o.id}`] = x; } }) : h('span.small.muted', 'a valutazione chiusa'))));
  // il voto proposto vale come voto se chi valuta non lo cambia
  if (canSelf) for (const o of d.obiettivi) if (o.self == null && o.proposto) self[`obj:${o.id}`] = o.proposto;
  if (canMgr) for (const o of d.obiettivi) if (o.manager == null && o.proposto) mgr[`obj:${o.id}`] = o.proposto;
  const compRows = d.competenze.map(x => h('tr', h('td', x.nome), h('td', score10(x.self, { edit: canSelf, onPick: v => { self[x.nome] = v; } })),
    h('td', d.voto.manager !== null || canMgr ? score10(x.manager, { edit: canMgr, mgr: true, onPick: v => { mgr[x.nome] = v; } }) : h('span.small.muted', 'a valutazione chiusa'))));
  const actions = [];
  if (canSelf) actions.push(h('button.btn', { type: 'button', on: { click: async () => { await save(); toast('Salvato'); reload(); } } }, 'Salva'),
    h('button.btn.btn-primary', { type: 'button', on: { click: async () => { if (!(await confirmDialog("Inviare l'autovalutazione al responsabile? Dopo non si modifica più.", { ok: 'Invia' }))) return; await save(); await patch(`/api/hr/valutazione/${userId}?year=${d.year}`, { status: 'manager' }); toast('Inviata'); reload(); } } }, "Invia l'autovalutazione"));
  if (canMgr) actions.push(h('button.btn', { type: 'button', on: { click: async () => { await save({ commento: comm.value, crescita: cresc.checked }); toast('Salvato'); reload(); } } }, 'Salva'),
    d.status === 'manager' ? h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await save({ commento: comm.value, crescita: cresc.checked }); await patch(`/api/hr/valutazione/${userId}?year=${d.year}`, { status: 'closed' }); toast('Valutazione chiusa'); reload(); } } }, 'Chiudi la valutazione') : null);
  const fin = d.voto.finale ?? d.voto.self?.final;
  const finLabel = d.voto.finale != null ? (d.voto.calibrato != null ? 'Voto finale (calibrato)' : 'Voto finale proposto') : 'La mia proposta';
  const [st, cl] = STATUS[d.status] || STATUS.self;
  fill(c, h('a.hr-back', { href: `#/hr/valutazioni?year=${d.year}` }, '‹ Valutazioni'),
    head(`${d.persona.nome} · ${d.year}`, `${d.ruolo ? `${d.ruolo.title} (G${d.ruolo.grade})` : 'ruolo da assegnare'}${d.persona.responsabile ? ` · responsabile ${d.persona.responsabile}` : ''}`, h('div.hr-row', h('span.hr-chip', { class: cl }, st), d.scala_originale === 5 ? h('span.hr-chip', { title: 'I voti dati sulla scala 1–5 si vedono ×2' }, 'voti di prima convertiti da 1–5') : null)),
    h('div.hr-grid32',
      h('div.card.hr-pad',
        h('div.hr-label', `Obiettivi (${d.pesi[0]}%) · da Alma Strategy`),
        d.obiettivi.length ? h('table.hr-t', h('tr', ['Obiettivo · KPI', 'Peso', 'Raggiunto', 'Persona', 'Responsabile'].map(x => h('th', x))), objRows) : h('p.small.muted', 'Nessun obiettivo per quest\'anno in Alma Strategy.'),
        h('p.small.muted', 'Il voto proposto nasce dal raggiungimento (100% = 8, 110% e oltre = 10); chi valuta lo può cambiare.'),
        h('div.hr-label', `Competenze del ruolo (${d.pesi[1]}%) · dal mansionario`),
        h('table.hr-t', h('tr', ['Competenza', 'Persona', 'Responsabile'].map(x => h('th', x))), compRows),
        h('div.hr-row', { style: { marginTop: '12px' } }, actions)),
      h('div',
        h('div.card.hr-pad', { style: { textAlign: 'center' } }, h('div.hr-label', finLabel), h('div.hr-bignum', n1(fin)), fin != null ? labChip(fin) : null,
          d.voto.manager?.final != null ? h('p.small.muted', `obiettivi ${n1(d.voto.manager.obj)} × ${d.pesi[0]}% + competenze ${n1(d.voto.manager.comp)} × ${d.pesi[1]}%`) : null,
          d.voto.self?.final != null ? h('p.small.muted', `autovalutazione: ${n1(d.voto.self.final)}`) : null),
        h('div.card.hr-pad', h('div.hr-label', 'La scala'), h('table.hr-t', [['9–10', 'eccezionale: oltre il ruolo'], ['7–8', 'sopra le attese'], ['5–6', 'in linea con il ruolo'], ['3–4', 'da migliorare, con un piano'], ['1–2', 'insufficiente']].map(([a, b]) => h('tr', h('td', h('b', a)), h('td.small', b))))),
        h('div.card.hr-pad', h('div.hr-label', 'Commento e crescita'), comm,
          d.ruolo?.next_criteria ? h('label.hr-row.small', { style: { marginTop: '8px' } }, cresc, `Criterio «come si cresce» raggiunto: ${d.ruolo.next_criteria}`) : null,
          h('p.small.muted', 'I pesi obiettivi/competenze sono quelli del pannello del salary grade per questo grade.')))));
}

// ── AI · check di luglio ────────────────────────────────────────────────────────────────────────────────────
export async function semestreView(c, userId, params) {
  const year = params.get('year');
  const d = await get(`/api/hr/semestre/${userId}${year ? `?year=${year}` : ''}`);
  const edit = (d.rights.manager || d.rights.hr) && (d.status !== 'closed');
  const reload = () => semestreView(c, userId, params);
  const vals = Object.fromEntries(d.obiettivi.map(o => [o.id, { valore: o.valore || '', previsione: o.previsione || 'linea', voto: o.voto ?? null }]));
  const rows = d.obiettivi.map(o => {
    const val = h('input.input', { value: vals[o.id].valore, disabled: !edit, style: { width: '110px' } });
    val.addEventListener('input', () => { vals[o.id].valore = val.value; });
    const prev = h('select.select', { disabled: !edit }, [['linea', 'in linea'], ['rischio', 'a rischio'], ['oltre', 'oltre il target']].map(([k, l]) => h('option', { value: k, selected: vals[o.id].previsione === k }, l)));
    prev.addEventListener('change', () => { vals[o.id].previsione = prev.value; });
    return h('tr', h('td', o.objective, h('div.small.muted', o.target ? `target ${o.target}` : '')), h('td', String(o.weight)), h('td', val), h('td', prev),
      h('td', score10(vals[o.id].voto, { edit, onPick: x => { vals[o.id].voto = x; } })));
  });
  const azioni = h('textarea.input', { disabled: !edit, maxlength: 4000 }, d.azioni);
  const serve = h('textarea.input', { disabled: !edit, maxlength: 2000 }, d.serve);
  const save = () => put(`/api/hr/semestre/${userId}?year=${d.year}`, { values: vals, azioni: azioni.value, serve: serve.value });
  const fissa = () => {
    const q = h('input.input', { type: 'datetime-local' });
    const m = modal({ title: 'Fissa il check di luglio', body: h('div', field('Quando', q), h('p.small.muted', "L'invito Outlook con Teams parte dal tuo calendario.")), actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => { if (!q.value) return; const r = await post(`/api/hr/semestre/${userId}/fissa?year=${d.year}`, { quando: new Date(q.value).toISOString() }); m.close(); toast(r.avviso || 'Invito mandato', r.avviso ? 'err' : 'ok'); reload(); } } }, 'Fissa')] });
  };
  fill(c, h('a.hr-back', { href: `#/hr/valutazioni?year=${d.year}` }, '‹ Valutazioni'),
    head(`Check di luglio · ${d.persona.nome} · ${d.year}`, `con ${d.persona.responsabile || 'il responsabile'} · prende il posto delle revisioni trimestrali`, h('span.hr-chip', { class: d.status === 'closed' ? 'z-ok' : 'z-warn' }, d.status === 'closed' ? 'chiuso' : 'da fare')),
    h('div.hr-grid32',
      h('div.card.hr-pad', d.obiettivi.length ? h('table.hr-t', h('tr', ['Obiettivo', 'Peso', 'A luglio', 'Previsione a fine anno', 'Voto provvisorio'].map(x => h('th', x))), rows) : h('p.small.muted', 'Nessun obiettivo in Alma Strategy.'),
        field('Azioni per il secondo semestre', azioni), field('Cosa serve da noi', serve),
        edit ? h('div.hr-row', { style: { marginTop: '10px' } }, h('button.btn', { type: 'button', on: { click: async () => { await save(); toast('Salvato'); reload(); } } }, 'Salva'),
          h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await save(); await post(`/api/hr/semestre/${userId}/chiudi?year=${d.year}`, {}); toast('Check chiuso'); reload(); } } }, 'Chiudi il check'),
          h('button.btn', { type: 'button', on: { click: fissa } }, 'Fissa l\'incontro (Outlook + Teams)')) : null,
        d.status === 'closed' && d.rights.hr ? h('button.btn.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/hr/semestre/${userId}/chiudi?year=${d.year}`, { riapri: true }); reload(); } } }, 'Riapri') : null),
      h('div',
        h('div.card.hr-pad', h('div.hr-label', 'Voto provvisorio'), h('div.hr-bignum', n1(d.voto)), h('p.small.muted', 'solo per orientarsi: non entra nel voto finale')),
        d.quando ? h('div.card.hr-pad', h('div.hr-label', 'Incontro'), h('p.small', fmtDateTime(d.quando)), d.join_url ? h('a.btn.btn-sm', { href: d.join_url, target: '_blank', rel: 'noopener' }, 'Teams ↗') : null) : null,
        h('div.card.hr-pad', h('div.hr-label', 'Segnali per HR'), d.segnali ? h('div.hr-alert', h('span.hr-adot', { style: { background: 'var(--amber)' } }), h('div.small', 'Voto provvisorio sotto 5 o due obiettivi a rischio: alla chiusura HR riceve l\'avviso.')) : h('p.small.muted', 'Nessun segnale.')))));
}

// ── AJ · calibrazione ───────────────────────────────────────────────────────────────────────────────────────
export async function calibrazioneView(c, params) {
  const d = await get(`/api/hr/calibrazione?${qy(params)}&${ambQs()}`);
  const reload = () => calibrazioneView(c, params);
  const amb = d.is_hr ? await ambitoSelect(reload) : null;
  const max = Math.max(1, ...d.distribuzione.map(x => x.n));
  const ref = [10, 20, 40, 20, 10];
  const tot = d.distribuzione.reduce((s, x) => s + x.n, 0);
  const bars = h('div.hr-dist', d.distribuzione.map((x, i) => h('div.hr-dist-col', h('div.hr-dist-bar', { style: { height: `${Math.max(4, x.n / max * 100)}%` } }, h('span', String(x.n))),
    h('div.hr-dist-ref', { style: { bottom: `${Math.min(100, (ref[i] / 100 * tot) / max * 100)}%` } }), h('div.small', x.label))));
  const edit = (p) => {
    const cal = h('input.input', { type: 'number', step: 0.1, min: 1, max: 10, value: p.calibrato ?? p.proposto ?? '', style: { width: '80px' } });
    const mot = h('input.input', { value: p.motivo || '', maxlength: 500, placeholder: 'motivo (obbligatorio se cambi)' });
    const piano = h('textarea.input', { maxlength: 2000, placeholder: 'Piano di miglioramento (obbligatorio sotto 4)' }, p.piano || '');
    const m = modal({ title: `Calibra · ${p.nome}`, body: h('div.hr-form', h('p.small', `Proposto dal responsabile (${p.manager || '—'}): ${n1(p.proposto)}`), field('Voto calibrato', cal), field('Motivo', mot), field('Piano di miglioramento', piano)),
      actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await put(`/api/hr/calibrazione/${p.user_id}?year=${d.year}`, { calibrato: cal.value, motivo: mot.value, piano: piano.value }); m.close(); reload(); } } }, 'Salva')] });
  };
  fill(c, head('Calibrazione', d.is_hr ? 'Prima che i voti diventino aumenti: un 8 in un\'area deve valere quanto un 8 in un\'altra. Ogni correzione vuole un motivo.' : 'Le tue persone: il voto proposto e quello calibrato dal team HR, con il motivo.',
    h('div.hr-row', amb, d.is_hr ? h('button.btn.btn-primary', { type: 'button', on: { click: async () => { if (!(await confirmDialog('Chiudere la calibrazione dell\'ambito? I voti calibrati vanno nella matrice e nella revisione.', { ok: 'Chiudi' }))) return; const r = await post(`/api/hr/calibrazione/chiudi?year=${d.year}&${ambQs()}`, {}); toast(`${r.chiuse} voti chiusi`); reload(); } } }, 'Chiudi la calibrazione') : null)),
    h('div',
      h('div.card.hr-scroll', h('table.list', h('thead', h('tr', ['Persona · ruolo', d.is_hr ? 'Responsabile' : null, 'Proposto', 'Calibrato', 'Motivo', ''].filter(x => x !== null).map(x => h('th', x)))),
        h('tbody', d.persone.length ? d.persone.map(p => h('tr', h('td', h('b', p.nome), h('div.small.muted', `${p.ruolo}${p.area ? ` · ${p.area}` : ''}`)), d.is_hr ? h('td.small', p.manager || '—') : null,
          h('td', n1(p.proposto)), h('td', p.calibrato != null && p.calibrato !== p.proposto ? h('b.z-hi-t', n1(p.calibrato)) : n1(p.calibrato ?? p.proposto)), h('td.small', p.motivo || (p.piano ? `piano: ${p.piano}` : '—')),
          h('td', d.is_hr && !p.chiusa ? h('button.btn.btn-sm', { type: 'button', on: { click: () => edit(p) } }, 'Calibra') : p.chiusa ? h('span.hr-chip.z-ok', 'chiusa') : null)))
          : h('tr', h('td.empty', { colSpan: 6 }, 'Nessuna valutazione chiusa nell\'ambito.'))))),
      h('div.hr-grid2',
        h('div.card.hr-pad', h('div.hr-label', `Distribuzione dei voti (${tot})`), bars, h('p.small.muted', 'Il tratteggio è un riferimento indicativo (10 · 20 · 40 · 20 · 10%), non una quota obbligatoria.')),
        d.is_hr ? h('div.card.hr-pad', h('div.hr-label', `Come votano i responsabili · media azienda ${n1(d.media_azienda)}`), h('table.hr-t', h('tr', ['Responsabile', 'Persone', 'Media', 'Scarto'].map(x => h('th', x))),
          d.valutatori.map(v => h('tr', h('td', v.nome), h('td', String(v.persone)), h('td', n1(v.media)), h('td', h('span.hr-chip', { class: Math.abs(v.scarto) >= 1 ? 'z-warn' : '' }, `${v.scarto > 0 ? '+' : ''}${n1(v.scarto)}`))))))
          : h('div.card.hr-pad', h('div.hr-label', 'Il tuo metro'), h('p.small', `La tua media: ${n1(d.mia_media)} · media dell'azienda: ${n1(d.media_azienda)}`)))),
    howTo('Si calibrano solo le valutazioni chiuse. Il voto calibrato è quello che va nella matrice e nella revisione. Sotto 4 serve un piano di miglioramento scritto prima della chiusura.'));
}

// ── AK · matrice ────────────────────────────────────────────────────────────────────────────────────────────
export async function matriceView(c, params) {
  const d = await get(`/api/hr/matrice?${qy(params)}&${ambQs()}`);
  const amb = await ambitoSelect(() => matriceView(c, params));
  const cols = ['Ingresso · sotto il 90% del riferimento', 'In linea · 90–110%', 'Alta · oltre il 110%'];
  const k = d.costo;
  const show = cell => modal({ title: `Merito +${cell.pct}%`, wide: true, body: h('table.hr-t', h('tr', ['Persona', 'Voto', 'RAL', 'Proposta', 'Nuova RAL'].map(x => h('th', x))),
    cell.persone.map(p => h('tr', h('td', p.nome, h('div.small.muted', p.ruolo)), h('td', n1(p.voto)), h('td', eur(p.ral)), h('td', p.tipo === 'una_tantum' ? `una tantum ${eur(p.una_tantum)}` : `${p.al_minimo ? `al minimo +${eur(p.al_minimo)} · ` : ''}+${pct(p.merito_pct)}`), h('td', eur(p.nuova_ral))))) });
  fill(c, head('Matrice voto × posizione in fascia', 'Il voto calibrato incrocia la posizione della RAL nella fascia del ruolo; ogni casella dà il merito del pannello del salary grade. Le percentuali si cambiano nel pannello.', h('div.hr-row', amb, h('a.btn', { href: '#/hr/pannello?tab=merito' }, 'Pannello › Merito'))),
    h('div.hr-grid32',
      h('div.card.hr-pad', h('div.hr-mx', h('div'), cols.map(x => h('div.hr-mx-h', x)),
        d.righe.map((r, i) => [h('div.hr-mx-h', h('b', r.replace('-', '–'))), d.celle[i].map(cell => h('button.hr-mx-c', { type: 'button', class: cell.pct >= 5 ? 'hot' : cell.pct > 0 ? 'mid' : 'zero', disabled: !cell.persone.length, on: { click: () => show(cell) } },
          h('b', cell.pct ? `+${pct(cell.pct)}` : '0'), cell.persone.length ? h('span.hr-chip.z-hi', `${cell.persone.length} ${cell.persone.length === 1 ? 'persona' : 'persone'}`) : null))])),
        h('p.small.muted', `Clic su una casella: le persone dentro. ${d.senza_voto ? `${d.senza_voto} persone dell'ambito non hanno ancora un voto calibrato.` : ''}`)),
      h('div',
        h('div.card.hr-pad', h('div.hr-label', 'Costo della proposta di merito'), h('table.hr-t', h('tr', h('td', 'Monte RAL in griglia'), h('td', h('b', keur(k.monte)))), h('tr', h('td', 'Merito dalla matrice'), h('td', h('b', `+${keur(k.merito)}`))),
          h('tr', h('td', 'Portati al minimo di fascia'), h('td', `+${keur(k.al_minimo)} · ${k.al_minimo_n} persone`)), h('tr', h('td', `Budget del pannello (${pct(k.budget_pct)})`), h('td', keur(k.tetto))),
          h('tr', h('td', 'Differenza'), h('td', h('span.hr-chip', { class: k.differenza > 0 ? 'z-bad' : 'z-ok' }, `${k.differenza > 0 ? '+' : ''}${keur(k.differenza)} ${k.differenza > 0 ? 'sopra' : 'sotto'} il budget`))))),
        h('div.card.hr-pad', h('div.hr-label', 'Leggere bene'), h('p.small.muted', `La matrice dà una proposta, non una decisione: nella revisione il responsabile si scosta di ±1 punto con un motivo, oltre decide HR. Costo azienda = RAL × ${k.coeff}.`)),
        h('div.card.hr-pad', h('div.hr-label', 'Revisione'), h('button.btn.btn-primary', { type: 'button', on: { click: async () => { const r = await post(`/api/hr/revisione/genera?${qy(params)}`, {}); toast(`${r.create} proposte create dalla matrice`); location.hash = '#/hr/revisione'; } } }, 'Apri la revisione retributiva')))));
}

// ── AL · revisione retributiva ──────────────────────────────────────────────────────────────────────────────
const STATO_AREA = { aperta: ['proposte dei responsabili', 'z-warn'], inviata: ['controllo HR', 'z-info'], hr: ['alla Direzione', 'z-info'], direzione: ['al CFO (sopra budget)', 'z-warn'], approvata: ['approvata', 'z-ok'] };
export async function revisioneView(c, params) {
  const d = await get(`/api/hr/revisione?${qy(params)}&${ambQs()}`);
  const reload = () => revisioneView(c, params);
  const hr = d.accesso === 'hr';
  const amb = hr ? await ambitoSelect(reload) : null;
  const passo = async (a, p) => { const r = await post(`/api/hr/revisione/area/${a.area_id}/${p}?year=${d.year}`, {}); toast(`Area: ${(STATO_AREA[r.stato] || [r.stato])[0]}`); reload(); };
  const areaCard = a => {
    const st = a.stato?.stato || 'aperta';
    const [l, cl] = STATO_AREA[st] || [st, ''];
    const k = store.me?.ruolo_hr;
    const btn = st === 'aperta' && (d.accesso === 'responsabile' || hr) ? h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => passo(a, 'invia') } }, 'Invia le proposte')
      : st === 'inviata' && hr ? h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => passo(a, 'hr') } }, 'Controllato: alla Direzione')
        : st === 'hr' && (k === 'direzione' || d.accesso === 'direzione') ? h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => passo(a, 'direzione') } }, 'Approva')
          : st === 'direzione' && (k === 'cfo' || d.accesso === 'cfo') ? h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => passo(a, 'cfo') } }, 'Ok del CFO') : null;
    return h('div.hr-li', h('div', h('b', a.nome), h('div.small.muted', `${a.persone} persone · ${a.eccezioni} da guardare`)),
      h('div.hr-row', h('span.small', `budget ${pct(a.budget_pct)} · proposto `, h('b', pct(a.speso_pct))), h('div.hr-pbar', { style: { width: '120px' } }, h('span', { style: { width: `${Math.min(100, a.speso_pct / (a.budget_pct || 1) * 100)}%`, background: a.sopra ? 'var(--amber)' : '' } })),
        a.sopra ? h('span.hr-chip.z-warn', `+${pct(Math.round((a.speso_pct - a.budget_pct) * 10) / 10)} sopra`) : null, h('span.hr-chip', { class: cl }, l), btn, hr && st !== 'aperta' ? h('button.btn.btn-sm', { type: 'button', on: { click: () => passo(a, 'riapri') } }, 'Riapri') : null));
  };
  const stepper = h('div.hr-chain', { style: { marginBottom: '14px' } }, [['1 · Proposte dei responsabili', 'aperta'], ['2 · Controllo HR', 'inviata'], ['3 · Direzione', 'hr'], ['4 · CFO', 'direzione']].map(([t, s]) => {
    const n = d.aree.filter(a => (a.stato?.stato || 'aperta') === s).length;
    return h('div.hr-step', { class: n ? 'now' : '' }, h('b', t), h('div.small', s === 'direzione' ? 'solo per le aree sopra budget' : `${n} ${n === 1 ? 'area' : 'aree'}`));
  }));
  if (d.accesso === 'direzione' || d.accesso === 'cfo') {
    return fill(c, head('Revisione retributiva', d.accesso === 'cfo' ? 'Le aree sopra il budget: serve il tuo ok.' : 'Totali per area e le eccezioni. Le RAL delle persone le vede il team HR.'), stepper,
      h('div.card.hr-pad', h('div.hr-label', 'Aree'), d.aree.length ? d.aree.map(areaCard) : h('p.small.muted', 'Niente da approvare.')),
      h('div.card.hr-pad', h('div.hr-label', `Eccezioni (${d.eccezioni.length})`), d.eccezioni.length ? h('table.hr-t', d.eccezioni.map(e => h('tr', h('td', h('b', e.nome), h('div.small.muted', e.area)), h('td.small', e.tipo === 'promozione' ? 'promozione' : `${pct(e.proposta_pct)}`), h('td', e.controlli.map(x => h('span.hr-chip', { class: x.livello === 'bad' ? 'z-bad' : 'z-warn', style: { marginRight: '4px' } }, x.testo)))))) : h('p.small.muted', 'Nessuna.')));
  }
  const promuovi = async r => {
    const roles = (await get('/api/hr/incarichi')).roles.filter(x => x.grade > (r.grade || 0));
    const sel = h('select.select', roles.map(x => h('option', { value: x.id }, `${x.title} · G${x.grade}`)));
    const mot = h('input.input', { maxlength: 1000, placeholder: 'perché (criterio del mansionario)' });
    const m = modal({ title: `Promozione · ${r.nome}`, body: h('div.hr-form', field('Nuovo ruolo', sel), field('Motivo', mot), h('p.small.muted', 'Nuova RAL = il valore più alto tra RAL + % del pannello e il minimo della nuova fascia. Il ruolo nuovo si mette poi su BOSS.')),
      actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await patch(`/api/hr/revisione/${r.id}?year=${d.year}`, { tipo: 'promozione', nuovo_role_id: Number(sel.value), motivo: mot.value }); m.close(); reload(); } } }, 'Proponi')] });
  };
  const row = r => {
    const pctIn = h('input.input', { type: 'number', step: 0.5, min: 0, value: r.proposta_pct, style: { width: '74px' }, disabled: r.tipo !== 'merito' });
    const salva = async () => {
      const v = Number(pctIn.value);
      let motivo = r.motivo;
      if (Math.abs(v - r.merito_pct) > 0.001 && !motivo) { motivo = await askReason(`Ti scosti dalla matrice (+${pct(r.merito_pct)})`, 'Motivo'); if (!motivo) { pctIn.value = r.proposta_pct; return; } }
      await patch(`/api/hr/revisione/${r.id}?year=${d.year}`, { tipo: 'merito', proposta_pct: v, motivo });
      reload();
    };
    pctIn.addEventListener('change', salva);
    const tipoSel = h('select.select', [['merito', 'merito'], ['promozione', 'promozione'], ['una_tantum', 'una tantum'], ['nessuno', 'nessun aumento']].map(([k, l]) => h('option', { value: k, selected: r.tipo === k }, l)));
    tipoSel.addEventListener('change', async () => {
      if (tipoSel.value === 'promozione') { tipoSel.value = r.tipo; return promuovi(r); }
      if (tipoSel.value === 'una_tantum') { const x = await askReason('Importo una tantum (€)', 'Importo'); if (!x) { tipoSel.value = r.tipo; return; } await patch(`/api/hr/revisione/${r.id}?year=${d.year}`, { tipo: 'una_tantum', una_tantum: Number(String(x).replace(/\D/g, '')) }); return reload(); }
      await patch(`/api/hr/revisione/${r.id}?year=${d.year}`, { tipo: tipoSel.value, proposta_pct: r.merito_pct, motivo: tipoSel.value === 'nessuno' ? (await askReason('Nessun aumento', 'Motivo')) || r.motivo : r.motivo });
      reload();
    });
    return h('tr', h('td', h('b', r.nome), h('div.small.muted', `${r.ruolo}${r.nuovo_ruolo ? ` → ${r.nuovo_ruolo}` : ''}`)), h('td', n1(r.voto)), h('td', r.zona ? h('span.hr-chip', r.zona) : '—'), h('td', `+${pct(r.merito_pct)}`),
      h('td', h('div.hr-row', tipoSel, r.tipo === 'merito' ? pctIn : r.tipo === 'promozione' ? h('span.hr-chip.z-info', `+${pct(r.proposta_pct)}`) : null), r.motivo ? h('div.small.muted', `«${r.motivo}»`) : null),
      hr ? h('td', `${eur(r.ral)} → `, h('b', eur(r.nuova_ral)), r.una_tantum ? h('div.small', `una tantum ${eur(r.una_tantum)}`) : null) : null,
      h('td', r.controlli.length ? r.controlli.map(x => h('div', h('span.hr-chip', { class: x.livello === 'bad' ? 'z-bad' : 'z-warn' }, x.testo))) : h('span.hr-chip.z-ok', 'ok')));
  };
  fill(c, head('Revisione retributiva', hr ? 'Ogni area ha il suo budget (pannello). Il responsabile propone in percentuale partendo dalla matrice; HR controlla fascia ed equità; la Direzione approva; il CFO solo per le aree sopra budget.' : 'Le tue persone: proponi in percentuale dentro il budget dell\'area. Oltre ±1 punto dalla matrice decide il team HR.',
    h('div.hr-row', amb, hr ? h('a.btn', { href: `/api/hr/revisione.xlsx?${qy(params)}&${ambQs()}` }, icon('sheet', { size: 14 }), 'Esporta Excel') : null, hr ? h('a.btn', { href: '#/hr/lettere' }, 'Lettere e BOSS') : null)),
    stepper,
    h('div.card.hr-pad', h('div.hr-label', 'Aree'), d.aree.length ? d.aree.map(areaCard) : h('p.small.muted', hr ? 'Nessuna revisione aperta: si apre dalla matrice, dopo la calibrazione.' : 'Niente da proporre.')),
    d.righe.length ? h('div.card.hr-scroll', h('table.list.hr-nohover', h('thead', h('tr', ['Persona · ruolo', 'Voto', 'Fascia', 'Matrice', 'Proposta', hr ? 'RAL oggi → nuova' : null, 'Controlli'].filter(Boolean).map(x => h('th', x)))), h('tbody', d.righe.map(row)))) : null,
    howTo('«Controlli»: sotto il minimo CCNL, sopra il massimo di fascia (meglio una tantum), scarto donne/uomini a pari ruolo oltre la soglia del pannello, promozione senza il criterio «come si cresce», scostamento dalla matrice senza motivo.'));
}

// ── AM · lettere e BOSS ─────────────────────────────────────────────────────────────────────────────────────
export async function lettereView(c, params) {
  const d = await get(`/api/hr/revisione/lettere?${qy(params)}`);
  const reload = () => lettereView(c, params);
  const esito = r => (r.tipo === 'promozione' ? `${r.nuovo_ruolo || 'promozione'}${d.is_hr ? ` · ${eur(r.nuova_ral)}` : ''}` : r.tipo === 'una_tantum' ? `una tantum${d.is_hr ? ` ${eur(r.una_tantum)}` : ''}` : r.tipo === 'nessuno' ? 'invariata' : `+${pct(r.proposta_pct)}${d.is_hr ? ` · ${eur(r.nuova_ral)}` : ''}`);
  const colloquio = async r => { await post(`/api/hr/revisione/${r.id}/colloquio?year=${d.year}`, { fatto: !r.colloquio_at }); reload(); };
  fill(c, head('Lettere e passaggio a BOSS', `Revisione ${d.year} · decorrenza ${itDate(d.decorrenza)}. La lettera la consegna il responsabile in un colloquio; poi la persona la ritrova in «Il mio percorso».`,
    h('div.hr-row', h('a.btn', { href: `/api/hr/revisione/lettere.docx?${qy(params)}` }, icon('file-text', { size: 14 }), d.is_hr ? 'Tutte le lettere (Word)' : 'Le lettere delle mie persone'), d.is_hr ? h('a.btn', { href: `/api/hr/revisione/consulente.xlsx?${qy(params)}` }, icon('sheet', { size: 14 }), 'File per il consulente') : null)),
    h('div.hr-grid32',
      h('div.card.hr-scroll', h('table.list.hr-nohover', h('thead', h('tr', ['Persona', 'Esito', 'Lettera', 'Colloquio', d.is_hr ? 'Su BOSS' : null].filter(Boolean).map(x => h('th', x)))),
        h('tbody', d.righe.length ? d.righe.map(r => h('tr', h('td', h('b', r.nome), h('div.small.muted', r.area || '')), h('td', esito(r)), h('td', h('a.btn.btn-sm', { href: `/api/hr/revisione/lettere.docx?year=${d.year}&id=${r.id}` }, 'Word')),
          h('td', h('button.btn.btn-sm', { type: 'button', class: r.colloquio_at ? 'btn-primary' : '', on: { click: () => colloquio(r) } }, r.colloquio_at ? `fatto ${itDate(r.colloquio_at)}` : 'Segna fatto')),
          d.is_hr ? h('td', r.boss_at ? h('span.hr-chip.z-ok', `registrata ${itDate(r.boss_at)}`) : r.boss_ral ? h('span.hr-chip.z-bad', `su BOSS ${eur(r.boss_ral)}: diversa`) : r.nuova_ral === r.ral ? h('span.small.muted', r.una_tantum ? 'non tocca la RAL' : '—') : h('span.hr-chip.z-warn', 'in attesa')) : null))
          : h('tr', h('td.empty', { colSpan: 5 }, 'Le lettere arrivano quando la revisione dell\'area è approvata.'))))),
      d.is_hr && d.boss ? h('div', h('div.card.hr-pad', h('div.hr-label', 'Stato su BOSS'), h('table.hr-t', h('tr', h('td', 'Registrate'), h('td', h('b', `${d.boss.registrate} di ${d.boss.da_registrare}`))),
        h('tr', h('td', 'In attesa da oltre 10 giorni'), h('td', h('span.hr-chip', { class: d.boss.in_attesa_10 ? 'z-warn' : '' }, String(d.boss.in_attesa_10)))), h('tr', h('td', 'Diverse da quanto approvato'), h('td', h('span.hr-chip', { class: d.boss.diverse ? 'z-bad' : '' }, String(d.boss.diverse))))),
        h('p.small.muted', 'La RAL nuova la registra su BOSS il consulente (o l\'API). Alma la ritrova con la sincronizzazione e segnala le differenze.'))) : null));
}

// ── AN · il mio esito ───────────────────────────────────────────────────────────────────────────────────────
export async function esitoView(c, params) {
  const d = await get(`/api/hr/esito/mio?${qy(params)}`);
  const e = d.esito;
  fill(c, head('Il mio esito', `Ciclo ${d.year}`),
    h('div.hr-grid32',
      h('div',
        e ? h('div.hr-grid2', h('div.card.hr-pad', { style: { textAlign: 'center' } }, h('div.hr-label', 'Voto finale'), h('div.hr-bignum', n1(e.voto)), labChip(e.voto)),
          h('div.card.hr-pad', h('div.hr-label', `Dal ${itDate(d.decorrenza)}`), e.tipo === 'una_tantum' ? h('p', `RAL ${eur(e.ral)} · una tantum `, h('b', eur(e.una_tantum)))
            : h('p', 'RAL ', h('b', eur(e.nuova_ral)), e.nuova_ral > e.ral ? h('span.hr-chip.z-ok', { style: { marginLeft: '6px' } }, `+${pct(Math.round((e.nuova_ral / e.ral - 1) * 1000) / 10)}`) : null),
          h('div.small.muted', `${e.ruolo}${e.grade ? ` · G${e.grade}` : ''}${e.band ? ` · fascia ${e.band.min}–${e.band.max} k€` : ''}`),
          h('a.btn.btn-sm', { href: `/api/hr/esito/mio/lettera.docx?${qy(params)}`, style: { marginTop: '8px' } }, 'La mia lettera'))) : h('div.card.empty', 'L\'esito del ciclo compare dopo il colloquio con il tuo responsabile.'),
        e?.commento ? h('div.card.hr-pad', h('div.hr-label', 'Cosa ha detto il mio responsabile'), h('p.small', `«${e.commento}»`)) : null,
        d.crescita ? h('div.card.hr-pad', h('div.hr-label', d.crescita.verso ? `Verso ${d.crescita.verso}` : 'Come si cresce'), d.crescita.criteri ? h('p.small', d.crescita.criteri) : null,
          d.crescita.raggiunto ? h('span.hr-chip.z-ok', 'il tuo responsabile lo ha segnato come raggiunto') : h('span.hr-chip', 'da raggiungere')) : null),
      h('div.card.hr-pad', h('div.hr-label', 'Storia'), d.storia.length ? h('table.hr-t', h('tr', ['Anno', 'Voto', 'RAL dal 1/4'].map(x => h('th', x))),
        d.storia.map(s => h('tr', h('td', String(s.year)), h('td', s.voto != null ? h('b', n1(s.voto)) : '—', s.originale != null ? h('span.small.muted', ` (da ${n1(s.originale)} su 5)`) : null), h('td', s.ral ? eur(s.ral) : '—')))) : h('p.small.muted', 'Ancora nessun ciclo chiuso.'),
      h('p.small.muted', 'I voti degli anni sulla scala 1–5 si vedono convertiti (×2) con il valore originale accanto.'))));
}
export async function esitoCard() {
  const d = await get('/api/hr/esito/mio', { quiet: true }).catch(() => null);
  if (!d?.esito) return null;
  return h('a.card.hr-onb-card', { href: '#/hr/esito' }, h('b', `Il mio esito ${d.year}`), h('div.small', `Voto ${n1(d.esito.voto)} · ${d.esito.etichetta}`), h('div.small.muted', 'Apri: voto, commento, lettera e prossimo passo'));
}

// ── AO · calendario e avanzamento ───────────────────────────────────────────────────────────────────────────
export async function cicloView(c, params) {
  const d = await get(`/api/hr/ciclo/avanzamento?${qy(params)}&${ambQs()}`);
  const amb = await ambitoSelect(() => cicloView(c, params));
  const t = d.totali;
  const ciclo = d.ciclo;
  const kpi = (l, a, b, s) => h('div.hr-kpi', h('div.l', l), h('div.v', b ? `${Math.round(a / b * 100)}%` : '—'), h('div.small.muted', s || `${a} di ${b}`));
  const cell = (n, tot) => h('td', { style: { textAlign: 'center' } }, h('span.hr-chip', { class: !tot ? '' : n === tot ? 'z-ok' : n >= tot / 2 ? 'z-warn' : 'z-bad' }, String(n)));
  const editCal = () => {
    const F = [['obiettivi', 'Obiettivi'], ['semestre', 'Check di luglio'], ['valutazione', 'Valutazione'], ['calibrazione', 'Calibrazione'], ['revisione', 'Revisione retributiva']];
    const inputs = Object.fromEntries(F.map(([k]) => [k, [h('input.input', { type: 'date', value: ciclo.fasi[k]?.apre || '' }), h('input.input', { type: 'date', value: ciclo.fasi[k]?.chiude || '' })]]));
    const dec = h('input.input', { type: 'date', value: ciclo.decorrenza || '' });
    const m = modal({ title: `Calendario del ciclo ${ciclo.year}`, wide: true, body: h('div.hr-form', h('table.hr-t', h('tr', ['Fase', 'Apre', 'Chiude'].map(x => h('th', x))), F.map(([k, l]) => h('tr', h('td', l), h('td', inputs[k][0]), h('td', inputs[k][1])))), field('Decorrenza delle nuove RAL', dec)),
      actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await put(`/api/hr/ciclo/${ciclo.year}`, { fasi: Object.fromEntries(F.map(([k]) => [k, { apre: inputs[k][0].value, chiude: inputs[k][1].value }])), decorrenza: dec.value }); m.close(); toast('Calendario salvato'); cicloView(c, params); } } }, 'Salva')] });
  };
  const today = new Date().toISOString().slice(0, 10);
  const aperta = ['valutazione', 'semestre', 'obiettivi'].find(k => ciclo.fasi[k] && ciclo.fasi[k].apre <= today && today <= ciclo.fasi[k].chiude);
  fill(c, head('Avanzamento del ciclo', `Ciclo ${ciclo.year}: chi ha fatto cosa, area per area. Le fasi si aprono una dopo l'altra; chi è ancora in prova entra nel ciclo dopo la conferma.`,
    h('div.hr-row', amb, yearSel(ciclo.year, y => { location.hash = `#/hr/ciclo?year=${y}`; }), d.is_hr ? h('button.btn', { type: 'button', on: { click: editCal } }, 'Calendario') : null,
      d.is_hr && aperta ? h('button.btn.btn-primary', { type: 'button', on: { click: async () => { const r = await post('/api/hr/ciclo/promemoria', { year: ciclo.year, fase: aperta }); toast(`${r.inviati} promemoria inviati`); } } }, 'Promemoria a chi manca') : null)),
    faseBanner(ciclo),
    t ? h('div.hr-grid4', kpi('Obiettivi approvati', t.obiettivi, t.persone), kpi('Check di luglio', t.semestre, t.persone), kpi('Autovalutazioni', t.auto, t.persone), kpi('Valutazioni dei responsabili', t.valutazione, t.persone)) : null,
    h('div.card.hr-scroll', h('table.list.hr-nohover', h('thead', h('tr', ['Area', 'Persone', 'Obiettivi', 'Check luglio', 'Autovalutazione', 'Valutazione', 'Calibrazione', 'Revisione'].map(x => h('th', { style: x === 'Area' ? null : { textAlign: 'center' } }, x)))),
      h('tbody', d.aree.length ? d.aree.map(a => h('tr', h('td', h('b', a.area)), h('td', { style: { textAlign: 'center' } }, String(a.persone)), cell(a.obiettivi, a.persone), cell(a.semestre, a.persone), cell(a.auto, a.persone), cell(a.valutazione, a.persone), cell(a.calibrazione, a.persone), cell(a.revisione, a.persone))) : h('tr', h('td.empty', { colSpan: 8 }, 'Nessuna persona nel ciclo per l\'ambito scelto.'))))),
    d.is_hr ? h('div.hr-row', h('a.btn', { href: '#/hr/valutazioni' }, 'Valutazioni'), h('a.btn', { href: '#/hr/calibrazione' }, 'Calibrazione'), h('a.btn', { href: '#/hr/matrice' }, 'Matrice'), h('a.btn', { href: '#/hr/revisione' }, 'Revisione'), h('a.btn', { href: '#/hr/lettere' }, 'Lettere')) : null,
    howTo('Ogni casella conta le persone che hanno finito quel passo: verde = tutti, giallo = almeno la metà, rosso = meno della metà. I promemoria vanno a chi deve ancora fare il suo passo nella fase aperta.'));
}
