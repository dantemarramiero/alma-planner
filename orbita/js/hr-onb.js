// Alma HR, Fase 4: onboarding (ALM2-54; canvas «Alma HR», pagina «Fase 4 · onboarding», tavole AA–AG). Pagine:
//   #/hr/onboarding           AG cruscotto (team HR) · le mie persone in inserimento (responsabile, buddy)
//   #/hr/onboarding/:id       AA piano della persona
//   #/hr/inserimento          AB «Il mio inserimento» (nuovo assunto)
//   #/hr/incontro/:id/:tappa  AD incontro dei 30/60/90 giorni
//   #/hr/fineprova/:id        AE fine del periodo di prova
//   #/hr/formazione           AC formazione obbligatoria (team HR e QHSE)
//   #/hr/modelli              AF modelli di inserimento e documenti da leggere (team HR)
import { h, fill, toast, modal, confirmDialog, fmtDateTime } from './ui.js';
import { get, post, put, patch } from './api.js';
import { icon } from './icons.js';
import { ambitoSelect, ambQs } from './hr.js';

const eur = n => (n == null ? '—' : `${Math.round(n).toLocaleString('it-IT')} €`);
const itDate = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const head = (title, sub, right) => h('div.page-head', h('div', h('div.hr-eyebrow', 'Alma HR · onboarding'), h('h1', title), sub ? h('div.sub', sub) : null), right || null);
const howTo = (...t) => h('div.hr-howto', h('b', 'Come si legge'), ' · ', ...t);
const field = (label, input) => h('label.field', h('span', label), input);
const initials = n => String(n || '').split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
const prog = (a, b) => h('div.hr-pbar', h('span', { style: { width: `${b ? Math.round(a / b * 100) : 0}%` } }));
const chiChip = t => h('span.hr-chip', t);
const readFile = f => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok({ nome: f.name, mime: f.type || 'application/pdf', base64: String(r.result).split(',')[1] }); r.onerror = ko; r.readAsDataURL(f); });
const STATO_C = { ok: ['z-ok', s => (s.scade ? `✓ ${s.scade.slice(0, 4)}` : '✓')], scade: ['z-warn', s => `scade ${itDate(s.scade).slice(3)}`], scaduto: ['z-bad', s => `scaduto ${itDate(s.scade).slice(3)}`], manca: ['', () => 'da fare'] };
const corsoChip = s => {
  if (s.stato === 'manca' && s.nel_piano) return h('span.hr-chip', { class: s.in_ritardo ? 'z-bad' : 'z-warn' }, s.in_ritardo ? 'in ritardo' : `entro ${itDate(s.nel_piano).slice(0, 5)}`);
  const [cl, txt] = STATO_C[s.stato] || ['', () => s.stato];
  return h('span.hr-chip', { class: cl }, txt(s));
};
const pickPerson = async (title, current) => {
  const people = (await get('/api/users', { quiet: true }).catch(() => [])) || [];
  const list = Array.isArray(people) ? people : people.users || [];
  const sel = h('select.select', h('option', { value: '' }, 'Nessuno'), list.filter(u => u.email).map(u => h('option', { value: u.email.toLowerCase(), selected: u.email.toLowerCase() === current }, `${u.name}${u.job_title ? ` · ${u.job_title}` : ''}`)));
  return new Promise(res => { let done = false; const m = modal({ title, body: field('Persona', sel), onClose: () => { if (!done) res(undefined); },
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => { done = true; m.close(); res(sel.value); } } }, 'Salva')] }); });
};

// ── AG · cruscotto ──────────────────────────────────────────────────────────────────────────────────────────
export async function cruscottoView(c, params) {
  const d = await get(`/api/hr/onboarding?${ambQs()}`);
  const amb = d.is_hr ? await ambitoSelect(() => cruscottoView(c, params)) : null;
  const aperti = d.onboarding.filter(o => o.stato === 'aperto');
  const avvia = d.is_hr ? h('button.btn.btn-primary', { type: 'button', on: { click: () => avviaModal() } }, icon('plus', { size: 16 }), 'Avvia un inserimento') : null;
  const row = o => h('tr', { class: 'clickable', on: { click: () => { location.hash = `#/hr/onboarding/${o.id}`; } } },
    h('td', h('b', o.nome)), h('td.small', `${o.ruolo || '—'}${o.area ? ` · ${o.area}` : ''}`), h('td', o.stato === 'aperto' ? String(o.giorno) : '—'),
    h('td', { style: { minWidth: '110px' } }, prog(o.fatti, o.compiti), h('div.small.muted', `${o.fatti} di ${o.compiti}${o.ritardo ? ` · ${o.ritardo} in ritardo` : ''}`)),
    h('td', o.formazione ? h('span.hr-chip', { class: o.formazione.scaduti ? 'z-bad' : o.formazione.fatti === o.formazione.totale ? 'z-ok' : 'z-warn' }, `${o.formazione.fatti} di ${o.formazione.totale}${o.formazione.scaduti ? ` · ${o.formazione.scaduti} in ritardo` : ''}`) : '—'),
    h('td', (o.incontri || []).map(m => h('span.hr-chip', { class: m.fatto ? 'z-ok' : '', style: { marginRight: '3px' } }, `${m.tappa}${m.fatto ? ' ✓' : ''}`))),
    h('td', o.pulse_media != null ? h('span.hr-chip', { class: o.pulse_media < 3 ? 'z-warn' : '' }, String(o.pulse_media).replace('.', ',')) : '—'),
    h('td', o.prova?.decisione ? h('span.hr-chip', { class: o.prova.decisione === 'conferma' ? 'z-ok' : 'z-bad' }, o.prova.decisione === 'conferma' ? (o.prova.hr_at ? 'confermata' : 'confermata · visto HR') : 'non superata')
      : o.fine_prova ? h('span.small', { class: o.stato === 'aperto' && (Date.parse(o.fine_prova) - Date.now()) / 86400000 <= 30 ? 'z-hi-t' : '' }, itDate(o.fine_prova)) : '—'));
  const table = list => h('div.card.hr-scroll', h('table.list', h('thead', h('tr', ['Persona', 'Ruolo · area', 'Giorno', 'Piano', 'Formazione', 'Incontri', 'Pulse', 'Fine prova'].map(x => h('th', x)))),
    h('tbody', list.length ? list.map(row) : h('tr', h('td.empty', { colSpan: 8 }, d.is_hr ? 'Nessuno in inserimento.' : 'Nessuna persona in inserimento con te come responsabile o buddy.')))));
  if (!d.is_hr) return fill(c, head('Persone in inserimento', 'Le persone che riportano a te o di cui sei buddy: piano, incontri e fine prova.'), table(d.onboarding));
  const k = d.kpi;
  const kpi = (l, v, s, cl) => h('div.hr-kpi', h('div.l', l), h('div.v', { class: cl || '' }, v), s ? h('div.small.muted', s) : null);
  const minQ = Object.entries(k.pulse_q || {}).filter(([, x]) => x != null).sort((a, b) => a[1] - b[1])[0];
  fill(c, head('Cruscotto dell\'onboarding', 'Tutti i nuovi assunti: piano, ritardi, come si sentono, quando scade la prova. Con lo stesso «Ambito» delle altre analisi.', h('div.hr-row', amb, avvia)),
    h('div.hr-grid4', kpi('In inserimento', String(k.aperti), `${k.cantiere} in cantiere, ${k.aperti - k.cantiere} in ufficio`),
      kpi('Compiti in ritardo', String(k.ritardo), 'sommati su tutti i piani aperti', k.ritardo ? 'z-bad-t' : ''),
      kpi('Pulse medio', k.pulse != null ? String(k.pulse).replace('.', ',') : '—', minQ ? `su 5 · «${minQ[0]}» il più basso (${String(minQ[1]).replace('.', ',')})` : 'nessuna risposta ancora'),
      kpi('Prove in scadenza (30 gg)', String(k.prove), k.prove_senza ? `${k.prove_senza} senza decisione` : 'tutte decise')),
    table(aperti),
    h('div.hr-grid2',
      h('div.card.hr-pad', h('div.hr-label', 'Dove si inceppa l\'inserimento (12 mesi)'), d.inceppa.length ? h('table.hr-t', h('tr', h('th', 'Compito'), h('th', 'In ritardo')), d.inceppa.map(x => h('tr', h('td', x.titolo), h('td', String(x.n))))) : h('p.small.muted', 'Nessun ritardo negli ultimi 12 mesi.')),
      h('div.card.hr-pad', h('div.hr-label', 'Come finisce (12 mesi)'), h('table.hr-t', h('tr', h('td', 'Prova superata'), h('td', String(d.esiti.superata))), h('tr', h('td', 'Non superata'), h('td', String(d.esiti.non_superata))),
        h('tr', h('td', 'Uscite durante la prova'), h('td', String(d.esiti.uscite)))))),
    d.onboarding.some(o => o.stato !== 'aperto') ? h('details.card.hr-pad', h('summary.hr-label', 'Inserimenti chiusi'), table(d.onboarding.filter(o => o.stato !== 'aperto'))) : null,
    howTo('Una riga per persona in inserimento; la barra è la quota di compiti del piano già fatti. Pulse = media delle 3 domande dell\'ultimo giro, da 1 a 5; giallo sotto 3. «Dove si inceppa» conta i compiti finiti in ritardo negli ultimi 12 mesi: dice cosa cambiare nei modelli.'));
}
async function avviaModal() {
  const d = await get('/api/hr/onboarding/da-avviare');
  const sel = h('select.select', d.persone.length ? d.persone.map(p => h('option', { value: p.key }, `${p.nome} ${p.cognome} · assunto il ${itDate(p.data_assunzione)}${p.qualifica ? ` · ${p.qualifica}` : ''}`)) : h('option', { value: '' }, 'Nessuna persona assunta negli ultimi 120 giorni senza piano'));
  const inizio = h('input.input', { type: 'date' });
  const sede = h('select.select', h('option', { value: '' }, 'Dal ruolo'), h('option', { value: 'cantiere' }, 'Cantiere'), h('option', { value: 'ufficio' }, 'Ufficio'));
  const mesi = h('input.input', { type: 'number', min: 0, max: 12, placeholder: '6' });
  const m = modal({ title: 'Avvia un inserimento', body: h('div.hr-form', field('Persona (da BOSS)', sel), h('div.hr-grid2', field('Primo giorno (vuoto = data di assunzione su BOSS)', inizio), field('Sede', sede), field('Mesi di prova', mesi)),
    h('p.small.muted', 'Chi arriva da una selezione in Alma parte da solo quando il pre-boarding lo trova su BOSS. Qui si avvia a mano per chi è entrato in altro modo.')),
  actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    if (!sel.value) return;
    const r = await post('/api/hr/onboarding', { person_key: sel.value, inizio: inizio.value || null, sede: sede.value || undefined, prova_mesi: mesi.value ? Number(mesi.value) : null });
    m.close(); location.hash = `#/hr/onboarding/${r.id}`;
  } } }, 'Avvia')] });
}

// ── AA · piano della persona ────────────────────────────────────────────────────────────────────────────────
export async function pianoView(c, id) {
  const d = await get(`/api/hr/onboarding/${id}`);
  const o = d.onboarding;
  const acc = d.accesso;
  const reload = () => pianoView(c, id);
  const tasks = d.compiti;
  const fatti = tasks.filter(t => t.fatto).length;
  const late = tasks.filter(t => t.in_ritardo).length;
  const tick = async t => { await patch(`/api/hr/onboarding/${id}/compiti/${t.id}`, { fatto: !t.fatto }); reload(); };
  const phase = name => {
    const list = tasks.filter(t => t.fase === name);
    if (!list.length) return null;
    const done = list.every(t => t.fatto);
    const now = !done && list.some(t => t.giorno <= o.giorno);
    return h('div.hr-phase', { class: done ? 'done' : now ? 'now' : '' },
      h('h5', name, done ? h('span.hr-chip.z-ok', 'fatto') : now ? h('span.hr-chip.z-hi', 'in corso') : null),
      list.map(t => h('div.hr-ptask',
        h('button.hr-task-ck', { type: 'button', class: t.fatto ? 'on' : '', disabled: !t.posso, title: t.posso ? '' : 'Lo segna chi lo deve fare', 'aria-label': t.fatto ? 'Segna da fare' : 'Segna fatto', on: { click: () => t.posso && tick(t) } }, t.fatto ? icon('check', { size: 14 }) : ''),
        h('span.hr-ptitle', h('span', { class: t.fatto ? 'muted' : '' }, t.titolo),
          t.in_ritardo ? h('span.z-bad-t.small', ` · scaduto il ${itDate(t.scadenza)}`) : !t.fatto ? h('span.small.muted', ` · ${itDate(t.scadenza)}`) : null),
        t.tipo === 'incontro' && ['hr', 'responsabile'].includes(acc) ? h('a.btn.btn-sm', { href: `#/hr/incontro/${id}/${t.ref}`, style: { marginLeft: '6px' } }, 'Apri') : null,
        t.tipo === 'prova' && ['hr', 'responsabile', 'direzione'].includes(acc) ? h('a.btn.btn-sm', { href: `#/hr/fineprova/${id}`, style: { marginLeft: '6px' } }, 'Apri') : null,
        t.tipo === 'obiettivi' && ['hr', 'responsabile'].includes(acc) ? h('button.btn.btn-sm', { type: 'button', style: { marginLeft: '6px' }, on: { click: () => editGoals(id, d.obiettivi, reload) } }, 'Scrivi') : null,
        chiChip(t.chi_label))));
  };
  const goals = acc === 'qhse' ? null : h('div.card.hr-pad', h('div.hr-row', { style: { justifyContent: 'space-between' } }, h('div.hr-label', 'Obiettivi di inserimento'),
    ['hr', 'responsabile'].includes(acc) ? h('button.btn.btn-sm', { type: 'button', on: { click: () => editGoals(id, d.obiettivi, reload) } }, 'Modifica') : null),
  h('div.small.muted', 'Dalla scheda del ruolo: autonomia per complessità di commessa'),
  d.obiettivi.map(g => h('div.hr-li', h('span.small', g.titolo), h('span.hr-chip', { class: g.stato === 'fatto' ? 'z-ok' : g.stato === 'meta' ? 'z-warn' : '' }, { fatto: 'fatto', meta: 'a metà', da_fare: 'da fare' }[g.stato]))),
  h('div.hr-li', h('span.small', 'Formazione obbligatoria del ruolo'), h('span.hr-chip', { class: d.formazione.corsi.every(x => x.stato === 'ok' || x.stato === 'scade') ? 'z-ok' : 'z-bad' }, `${d.formazione.corsi.filter(x => x.stato === 'ok' || x.stato === 'scade').length} di ${d.formazione.corsi.length}`)));
  const dot = l => ({ alto: 'var(--red)', medio: 'var(--amber)', info: 'var(--blue)' }[l]);
  const passi = h('div.card.hr-pad', h('div.hr-label', 'Prossimi passi'), d.passi.length ? d.passi.map(p => h('div.hr-alert', h('span.hr-adot', { style: { background: dot(p.livello) } }), h('div.small', h('b', p.testo), ` · ${p.nota}`))) : h('p.small.muted', 'Tutto in regola.'));
  const pp = d.persone;
  const buddyBtn = ['hr', 'responsabile'].includes(acc) ? h('button.btn.btn-sm', { type: 'button', on: { click: async () => { const e = await pickPerson('Scegli il buddy', pp.buddy?.email); if (e === undefined) return; await patch(`/api/hr/onboarding/${id}`, { buddy_email: e || null }); toast(e ? 'Buddy scelto' : 'Buddy tolto'); reload(); } } }, pp.buddy ? 'Cambia' : 'Scegli il buddy') : null;
  const persone = h('div.card.hr-pad', h('div.hr-label', 'Persone del piano'),
    h('div.hr-li', h('span', h('span.hr-av', initials(pp.responsabile?.nome)), pp.responsabile?.nome || 'responsabile da BOSS'), h('span.small.muted', 'responsabile')),
    h('div.hr-li', h('span', h('span.hr-av', initials(pp.buddy?.nome || '?')), pp.buddy?.nome || h('span.z-hi-t', 'buddy da scegliere')), h('span.hr-row', h('span.small.muted', `buddy${pp.buddy?.qualifica ? ` · ${pp.buddy.qualifica}` : ''}`), buddyBtn)),
    h('div.hr-li', h('span', h('span.hr-av', 'HR'), 'Team HR'), h('span.small.muted', 'HR')), h('div.hr-li', h('span', h('span.hr-av', 'QH'), 'QHSE'), h('span.small.muted', 'formazione')));
  const hrEdit = acc === 'hr' ? h('button.btn', { type: 'button', on: { click: () => editOnb(id, o, reload) } }, 'Date e sede') : null;
  fill(c, h('a.hr-back', { href: '#/hr/onboarding' }, '‹ Onboarding'),
    h('div.page-head', h('div.hr-row', h('div.hr-avatar', initials(o.nome)), h('div', h('div.hr-eyebrow', 'Alma HR · piano di inserimento'), h('h1', `${o.nome}${o.ruolo ? ` · ${o.ruolo}${o.grade ? ` (G${o.grade})` : ''}` : ''}`),
      h('div.sub', `${o.area || '—'} · ${o.sede} · ${o.giorno > 0 ? `in azienda da ${o.giorno} ${o.giorno === 1 ? 'giorno' : 'giorni'}` : `entra il ${itDate(o.inizio)}`} · fine prova ${itDate(o.fine_prova)}${o.stato !== 'aperto' ? ` · ${o.stato}` : ''}`))),
    h('div.hr-row', hrEdit, o.boss_url ? h('a.btn', { href: o.boss_url, target: '_blank', rel: 'noopener' }, 'Scheda su BOSS ↗') : null)),
    h('div.hr-row', { style: { marginBottom: '12px' } }, h('div', { style: { flex: 1 } }, prog(fatti, tasks.length)), h('span.small.muted', `${fatti} di ${tasks.length} compiti${late ? ` · ${late} in ritardo` : ''}`)),
    h('div.hr-grid32', h('div.card.hr-pad', d.fasi.map(phase)), h('div', goals, passi, persone,
      d.formazione.corsi.length ? h('div.card.hr-pad', h('div.hr-label', 'Formazione del ruolo'), d.formazione.corsi.map(s => h('div.hr-li', h('span.small', s.course.nome, s.course.blocca_cantiere ? h('span.small.muted', ' · blocca il cantiere') : null), corsoChip({ ...s, nel_piano: s.stato === 'manca' ? addDays(o.inizio, s.course.giorno) : null, in_ritardo: s.stato === 'manca' && addDays(o.inizio, s.course.giorno) < d.today }))),
        h('p.small', d.formazione.cantiere.ok ? h('span.z-ok-t', 'Può lavorare da solo in cantiere') : h('span.z-bad-t', `Non da solo in cantiere: manca ${d.formazione.cantiere.mancano.join(', ')}`))) : null)),
    howTo('I compiti nascono dai modelli (base, famiglia del ruolo, sede) con le date calcolate dal primo giorno: se la data cambia, il piano si sposta. Ognuno spunta i suoi; il team HR tutti. I corsi si chiudono da soli quando QHSE carica l\'attestato.'));
}
const addDays = (iso, n) => { const x = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + Number(n)); return x.toISOString().slice(0, 10); };
function editGoals(id, goals, reload) {
  const rows = h('div');
  const add = (g = { titolo: '', stato: 'da_fare' }) => {
    const t = h('input.input', { value: g.titolo, maxlength: 300, style: { flex: 1 } });
    const s = h('select.select', [['da_fare', 'da fare'], ['meta', 'a metà'], ['fatto', 'fatto']].map(([k, l]) => h('option', { value: k, selected: g.stato === k }, l)));
    rows.append(h('div.hr-row', { style: { marginBottom: '6px' } }, t, s));
  };
  (goals.length ? goals : [{}]).forEach(add);
  const m = modal({ title: 'Obiettivi di inserimento', wide: true, body: h('div', rows, h('button.btn.btn-sm', { type: 'button', on: { click: () => add() } }, '+ Obiettivo'), h('p.small.muted', 'Concreti e verificabili entro 90 giorni. Si rivedono negli incontri dei 30, 60 e 90 giorni.')),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const list = [...rows.children].map(r => ({ titolo: r.querySelector('input').value.trim(), stato: r.querySelector('select').value })).filter(g => g.titolo);
      await put(`/api/hr/onboarding/${id}/obiettivi`, { obiettivi: list, confermati: true }); m.close(); toast('Obiettivi salvati'); reload();
    } } }, 'Salva')] });
}
function editOnb(id, o, reload) {
  const inizio = h('input.input', { type: 'date', value: o.inizio });
  const fine = h('input.input', { type: 'date', value: o.fine_prova || '' });
  const sede = h('select.select', ['ufficio', 'cantiere'].map(s => h('option', { value: s, selected: o.sede === s }, s)));
  const stato = h('select.select', [['aperto', 'aperto'], ['chiuso', 'chiuso'], ['annullato', 'annullato (es. uscita)']].map(([k, l]) => h('option', { value: k, selected: o.stato === k }, l)));
  const m = modal({ title: 'Date, sede e stato', body: h('div.hr-form', field('Primo giorno', inizio), field('Fine del periodo di prova', fine), field('Sede', sede), field('Stato', stato),
    h('p.small.muted', `Fine prova da: ${{ offerta: 'mesi di prova dell\'offerta', ccnl: '6 mesi dal primo giorno', hr: 'data scritta dal team HR', boss: 'BOSS' }[o.prova_fonte] || o.prova_fonte}. Se il primo giorno cambia, le scadenze del piano si spostano.`)),
  actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await patch(`/api/hr/onboarding/${id}`, { inizio: inizio.value, fine_prova: fine.value || undefined, sede: sede.value, stato: stato.value }); m.close(); reload(); } } }, 'Salva')] });
}

// ── AB · «Il mio inserimento» ───────────────────────────────────────────────────────────────────────────────
export async function mioView(c) {
  const d = await get('/api/hr/inserimento/mio');
  if (!d.onboarding) return fill(c, head('Il mio inserimento'), h('div.card.empty', 'Non hai un piano di inserimento aperto. Il tuo percorso è in «Il mio percorso».'), h('a.btn', { href: '#/hr/percorso' }, 'Il mio percorso'));
  const o = d.onboarding;
  const reload = () => mioView(c);
  const pct = d.progresso.totale ? Math.round(d.progresso.fatti / d.progresso.totale * 100) : 0;
  const tick = async t => { await patch(`/api/hr/onboarding/${o.id}/compiti/${t.id}`, { fatto: true }); toast('Fatto'); reload(); };
  const leggi = doc => {
    const q = h('input.input', { maxlength: 1000, placeholder: 'Una domanda sul documento (facoltativa)' });
    const m = modal({ title: doc.titolo, body: h('div', doc.link ? h('p', h('a', { href: doc.link, target: doc.link.startsWith('#') ? null : '_blank', rel: 'noopener' }, 'Apri il documento ↗')) : null,
      h('p.small.muted', 'Letto e capito? Se qualcosa non torna, scrivilo: arriva al tuo responsabile. Si registrano data e ora.'), q),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await post(`/api/hr/onboarding/${o.id}/documenti/${encodeURIComponent(doc.key)}/letto`, { domanda: q.value }); m.close(); toast('Presa visione registrata'); reload(); } } }, 'Ho letto · confermo')] });
  };
  const pulse = () => {
    const Q = [['q1', 'Hai quello che ti serve per lavorare (PC, accessi, DPI, auto)?'], ['q2', 'Sai cosa ci si aspetta da te nei prossimi 30 giorni?'], ['q3', 'Ti senti accolto dalla squadra?']];
    const val = {};
    const body = h('div', Q.map(([k, l]) => { const row = h('div.hr-row', [1, 2, 3, 4, 5].map(n => h('button.hr-pill', { type: 'button', on: { click: e => { val[k] = n; [...row.children].forEach(b => b.classList.toggle('on', b === e.currentTarget)); } } }, String(n))));
      return h('div', { style: { marginBottom: '12px' } }, h('div.small', { style: { marginBottom: '4px' } }, l), row); }), h('p.small.muted', '1 = per niente, 5 = del tutto. Il responsabile vede le risposte all\'incontro; HR vede l\'andamento.'));
    const m = modal({ title: `Prima dell'incontro dei ${d.incontro.tappa} giorni`, body, actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      if (Q.some(([k]) => !val[k])) return toast('Rispondi alle tre domande', 'err');
      await put(`/api/hr/onboarding/${o.id}/pulse/${d.incontro.tappa}`, val); m.close(); toast('Grazie!'); reload();
    } } }, 'Invia')] });
  };
  const b = d.persone.buddy;
  const inc = d.incontro;
  fill(c, head(`Ciao ${o.nome}`, `Giorno ${Math.max(o.giorno, 0)} di ${o.giorni} · ${o.ruolo}`),
    h('div.hr-grid32',
      h('div',
        h('div.card.hr-pad', h('div.hr-row', { style: { justifyContent: 'space-between' } }, h('div.hr-label', 'Il mio inserimento'), h('span.small.muted', `${pct}%`)), prog(d.progresso.fatti, d.progresso.totale),
          h('div.hr-label', { style: { marginTop: '14px' } }, 'Questa settimana'),
          d.settimana.length ? d.settimana.map(t => h('div.hr-ptask', t.mio ? h('button.hr-task-ck', { type: 'button', 'aria-label': 'Segna fatto', on: { click: () => tick(t) } }) : h('span.hr-task-ck', { style: { opacity: 0.4 } }),
            h('span.hr-ptitle', h('span', t.titolo), t.in_ritardo ? h('span.z-bad-t.small', ' · da fare') : h('span.small.muted', ` · ${itDate(t.scadenza)}`)), chiChip(t.mio ? 'tu' : t.chi))) : h('p.small.muted', 'Niente in scadenza questa settimana.')),
        h('div.card.hr-pad', h('div.hr-label', 'Da leggere'), d.documenti.map(doc => h('div.hr-li', h('span.small', doc.letto ? h('span.z-ok-t', '✓ ') : null, doc.titolo), doc.letto ? h('span.small.muted', itDate(doc.letto)) : h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => leggi(doc) } }, 'Leggi')))),
        d.formazione.corsi.length ? h('div.card.hr-pad', h('div.hr-label', 'I miei corsi'), d.formazione.corsi.map(s => h('div.hr-li', h('span.small', s.course.nome), corsoChip(s))), h('p.small.muted', 'Li prenota e registra QHSE: se un corso ti manca, chiedi a loro.')) : null),
      h('div',
        h('div.card.hr-pad', h('div.hr-label', 'Il tuo buddy'), b ? h('div.hr-row', h('span.hr-av', initials(b.nome)), h('div', h('b', b.nome), h('div.small.muted', b.qualifica || '')), h('a.btn.btn-sm', { href: `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(b.email)}`, target: '_blank', rel: 'noopener', style: { marginLeft: 'auto' } }, 'Scrivi')) : h('p.small.muted', 'Lo sceglie il tuo responsabile nei primi giorni.')),
        h('div.card.hr-pad', h('div.hr-label', 'Prossimo incontro'), inc ? h('div', h('div.small', `Incontro dei ${inc.tappa} giorni · ${inc.quando ? fmtDateTime(inc.quando) : `entro il ${itDate(inc.data)}`}${d.persone.responsabile ? ` · con ${d.persone.responsabile.nome}` : ''}`),
          inc.join_url ? h('a.btn.btn-sm', { href: inc.join_url, target: '_blank', rel: 'noopener', style: { marginTop: '6px' } }, 'Teams ↗') : null,
          inc.pulse_fatto ? h('p.small.z-ok-t', 'Hai già risposto alle 3 domande.') : h('div', h('p.small.muted', 'Prima rispondi a 3 domande (2 minuti).'), h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: pulse } }, 'Rispondi'))) : h('p.small.muted', 'Gli incontri dei 30, 60 e 90 giorni sono fatti.')),
        h('div.card.hr-pad', h('div.hr-label', 'Il tuo responsabile'), h('p.small', d.persone.responsabile?.nome || '—')))),
    howTo('Questa pagina resta in cima alla Home finché il piano non è finito. Spunti i compiti segnati «tu»; gli altri li fanno le persone indicate. Le notifiche arrivano anche sul telefono.'));
}

// card sulla Home (AB): progresso, prossimo passo, buddy
export async function homeCard() {
  const d = await get('/api/hr/inserimento/mio', { quiet: true }).catch(() => null);
  if (!d?.onboarding) return null;
  const pct = d.progresso.totale ? Math.round(d.progresso.fatti / d.progresso.totale * 100) : 0;
  const next = d.settimana.find(t => t.mio) || d.settimana[0];
  return h('a.card.hr-onb-card', { href: '#/hr/inserimento' },
    h('div.hr-row', { style: { justifyContent: 'space-between' } }, h('b', 'Il mio inserimento'), h('span.small.muted', `giorno ${Math.max(d.onboarding.giorno, 0)} di ${d.onboarding.giorni} · ${pct}%`)), prog(d.progresso.fatti, d.progresso.totale),
    next ? h('div.small', `Prossimo: ${next.titolo}`) : null,
    h('div.small.muted', d.persone.buddy ? `Il tuo buddy: ${d.persone.buddy.nome}` : 'Il buddy lo sceglie il tuo responsabile'),
    d.incontro && !d.incontro.pulse_fatto ? h('div.small.z-hi-t', `Prima dell'incontro dei ${d.incontro.tappa} giorni: rispondi a 3 domande`) : null);
}

// ── AD · incontro 30/60/90 ──────────────────────────────────────────────────────────────────────────────────
export async function incontroView(c, id, tappa) {
  const d = await get(`/api/hr/onboarding/${id}/incontri/${tappa}`);
  const m = d.incontro;
  const edit = ['hr', 'responsabile'].includes(d.accesso);
  const reload = () => incontroView(c, id, tappa);
  const score = (label, cur) => {
    let val = cur || null;
    const row = h('div.hr-score10', Array.from({ length: 10 }, (_, i) => h('button', { type: 'button', class: val && i < val ? 'f' : '', disabled: !edit, on: { click: () => { val = i + 1; [...row.children].forEach((b, j) => b.classList.toggle('f', j < val)); } } }, String(i + 1))));
    return { el: h('tr', h('td', label), h('td', row)), get: () => val };
  };
  const s1 = score(h('div', 'Obiettivi di inserimento: a che punto siamo?', h('div.small.muted', d.obiettivi.map(g => g.titolo).join(' · '))), m.voto_obiettivi);
  const s2 = score('Come lavora con la squadra e con i committenti', m.voto_squadra);
  const serve = h('input.input', { value: m.serve, maxlength: 1000, disabled: !edit, style: { width: '100%' } });
  const prossimo = h('input.input', { value: m.prossimo, maxlength: 1000, disabled: !edit, style: { width: '100%' } });
  const note = h('textarea.input', { maxlength: 3000, disabled: !edit }, m.note);
  const goalSel = d.obiettivi.map(g => ({ g, sel: h('select.select', { disabled: !edit }, [['da_fare', 'da fare'], ['meta', 'a metà'], ['fatto', 'fatto']].map(([k, l]) => h('option', { value: k, selected: g.stato === k }, l))) }));
  const save = async segnala => {
    const r = await put(`/api/hr/onboarding/${id}/incontri/${tappa}`, { voto_obiettivi: s1.get(), voto_squadra: s2.get(), serve: serve.value, prossimo: prossimo.value, note: note.value, segnala, obiettivi: goalSel.map(x => ({ titolo: x.g.titolo, stato: x.sel.value })) });
    toast(r.segnali?.length ? `Salvato · segnalato a HR: ${r.segnali.join(', ')}` : 'Incontro salvato'); reload();
  };
  const fissa = () => {
    const nxt = d.tutti.find(x => !x.fatto_at && x.tappa !== m.tappa) || m;
    const q = h('input.input', { type: 'datetime-local' });
    const mm = modal({ title: `Fissa l'incontro dei ${nxt.tappa} giorni`, body: h('div', field(`Quando (entro il ${itDate(nxt.data)})`, q), h('p.small.muted', 'L\'invito Outlook con il link di Teams parte dal tuo calendario.')),
      actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => { if (!q.value) return; const r = await post(`/api/hr/onboarding/${id}/incontri/${nxt.tappa}/fissa`, { quando: new Date(q.value).toISOString() }); mm.close(); toast(r.avviso || 'Invito mandato', r.avviso ? 'err' : 'ok'); reload(); } } }, 'Fissa')] });
  };
  const P = d.pulse;
  const pr = (k, l) => { const a = P.prima?.[k]; const b = P.attuale?.[k]; return h('tr', h('td', l), h('td', b != null ? h('b', a != null ? `${a} → ${b}` : String(b)) : '—'), h('td', a != null && b != null ? h('span.hr-chip', { class: b < a ? 'z-warn' : b > a ? 'z-ok' : '' }, b < a ? 'giù' : b > a ? 'su' : 'uguale') : null)); };
  fill(c, h('a.hr-back', { href: `#/hr/onboarding/${id}` }, `‹ ${d.onboarding.nome}`),
    head(`Incontro dei ${tappa} giorni · ${d.onboarding.nome}`, `${d.onboarding.ruolo}${d.persone.responsabile ? ` · con ${d.persone.responsabile.nome}` : ''} · stessa scala 1–10 della valutazione annuale`),
    h('div.hr-chain', d.tutti.map(x => h('div.hr-step', { class: x.fatto_at ? 'done' : x.tappa === m.tappa ? 'now' : '' }, h('b', `${x.tappa} giorni · ${itDate(x.data)}`),
      h('div.small', x.fatto_at ? `fatto · voto ${x.voto_obiettivi}` : x.quando ? `fissato ${fmtDateTime(x.quando)}` : 'da fissare'))),
    h('div.hr-step', h('b', `Fine prova · ${itDate(d.onboarding.fine_prova)}`), h('div.small', 'decisione'))),
    h('div.hr-grid32', { style: { marginTop: '14px' } },
      h('div.card.hr-pad', h('table.hr-t', h('tr', h('th', 'Traccia'), h('th', 'Voto 1–10')), s1.el, s2.el,
        h('tr', h('td', 'Cosa gli serve da noi (strumenti, formazione, tempo del buddy)'), h('td', serve)), h('tr', h('td', 'Prossimi 30 giorni: un obiettivo concreto'), h('td', prossimo))),
        goalSel.length ? h('div', h('div.hr-label', 'Obiettivi'), goalSel.map(x => h('div.hr-li', h('span.small', x.g.titolo), x.sel))) : null,
        field('Note (le vedono la persona, il responsabile e HR)', note),
        edit ? h('div.hr-row', { style: { marginTop: '12px' } }, h('button.btn.btn-primary', { type: 'button', on: { click: () => save(false) } }, 'Salva l\'incontro'), h('button.btn', { type: 'button', on: { click: fissa } }, 'Fissa un incontro (Outlook + Teams)'), h('button.btn', { type: 'button', on: { click: () => save(true) } }, 'Segnala a HR')) : null),
      h('div',
        h('div.card.hr-pad', h('div.hr-label', `Il pulse di ${d.onboarding.nome.split(' ')[0]} (prima dell'incontro)`), P.attuale ? h('table.hr-t', pr('q1', 'Ha quello che gli serve'), pr('q2', 'Sa cosa ci si aspetta'), pr('q3', 'Si sente accolto')) : h('p.small.muted', 'Non ha ancora risposto: glielo ricorda «Il mio inserimento».')),
        h('div.card.hr-pad', h('div.hr-label', 'Segnali per HR'), d.segnali.length ? d.segnali.map(s => h('div.hr-alert', h('span.hr-adot', { style: { background: 'var(--amber)' } }), h('div.small', s))) : h('p.small.muted', 'Nessun segnale.'),
          h('p.small.muted', 'Pulse sotto 3 su una domanda o voto sotto 6: HR riceve l\'avviso e può chiedere un incontro a tre.')))));
}

// ── AE · fine prova ─────────────────────────────────────────────────────────────────────────────────────────
export async function provaView(c, id) {
  const d = await get(`/api/hr/onboarding/${id}`);
  const o = d.onboarding;
  const p = d.prova;
  if (!p) return fill(c, head('Fine del periodo di prova'), h('div.card.empty', 'La vedono il responsabile, il team HR e (da G6) la Direzione.'));
  const reload = () => provaView(c, id);
  const giorni = Math.round((Date.parse(o.fine_prova) - Date.now()) / 86400000);
  const voti = d.incontri.map(m => m.voto_obiettivi ?? '—').join(' · ');
  const corsiOk = d.formazione.corsi.filter(x => x.stato === 'ok' || x.stato === 'scade').length;
  let dec = p.decisione || 'conferma';
  const opt = (k, t, s) => h('button.hr-choice', { type: 'button', class: dec === k ? 'on' : '', disabled: !['hr', 'responsabile'].includes(d.accesso), on: { click: e => { dec = k; e.currentTarget.parentElement.querySelectorAll('.hr-choice').forEach(b => b.classList.toggle('on', b === e.currentTarget)); } } }, h('b', t), h('div.small.muted', s));
  const motivo = h('textarea.input', { maxlength: 3000, disabled: !['hr', 'responsabile'].includes(d.accesso) }, p.motivo || '');
  const send = async (passo, extra = {}) => { const r = await post(`/api/hr/onboarding/${id}/prova`, { passo, decisione: dec, motivo: motivo.value, ...extra }); toast(r.completa ? 'Fine prova completata' : 'Fatto'); reload(); };
  const rev = h('input.input', { type: 'number', step: 500, value: p.revisione_ral || '', placeholder: 'es. 49000' });
  const stepTxt = [['Responsabile', p.deciso_at], ['Visto HR', p.hr_at], ...(p.catena.includes('direzione') ? [['Direzione', p.dir_at]] : [])];
  fill(c, h('a.hr-back', { href: `#/hr/onboarding/${id}` }, `‹ ${o.nome}`),
    head(`${o.nome} · fine prova il ${itDate(o.fine_prova)}`, 'La decisione si registra su BOSS dal consulente del lavoro: qui è il promemoria firmato.', h('div.hr-row', h('span.hr-chip', { class: giorni <= 10 ? 'z-bad' : giorni <= 30 ? 'z-warn' : '' }, giorni >= 0 ? `tra ${giorni} giorni` : `scaduta da ${-giorni} giorni`), h('span.hr-chip', `G${o.grade || '?'} · ${p.catena.map(x => ({ responsabile: 'responsabile', hr: 'HR', direzione: 'Direzione' }[x])).join(' + ')}`))),
    h('div.hr-grid32',
      h('div',
        h('div.hr-grid3', h('div.hr-kpi', h('div.l', 'Incontri'), h('div.v', voti), h('div.small.muted', '30 · 60 · 90 giorni (1–10)')),
          h('div.hr-kpi', h('div.l', 'Obiettivi di inserimento'), h('div.v', `${d.obiettivi.filter(g => g.stato === 'fatto').length} di ${d.obiettivi.length}`)),
          h('div.hr-kpi', h('div.l', 'Formazione obbligatoria'), h('div.v', `${corsiOk} di ${d.formazione.corsi.length}`), h('div.small.muted', d.formazione.cantiere.ok ? 'può lavorare da solo in cantiere' : 'non ancora da solo in cantiere'))),
        h('div.card.hr-pad', h('div.hr-label', 'Decisione del responsabile'), h('div.hr-row', opt('conferma', 'Confermo', 'la prova è superata'), opt('non_superata', 'Non superata', 'serve il motivo scritto; HR parla prima con la persona')),
          field('Motivo / note per HR', motivo),
          h('div.hr-row', { style: { marginTop: '10px' } }, ['hr', 'responsabile'].includes(d.accesso) ? h('button.btn.btn-primary', { type: 'button', on: { click: () => send('responsabile') } }, p.decisione ? 'Aggiorna la decisione' : 'Invia a HR') : null,
            d.accesso === 'hr' && p.decisione && !p.hr_at ? h('button.btn', { type: 'button', on: { click: () => send('hr', { revisione_ral: rev.value ? Number(rev.value) : null }) } }, 'Metti il visto HR') : null,
            (d.accesso === 'direzione' || d.accesso === 'hr') && p.catena.includes('direzione') && p.hr_at && !p.dir_at ? h('button.btn', { type: 'button', on: { click: () => send('direzione') } }, 'Ok della Direzione') : null))),
      h('div',
        h('div.card.hr-pad', h('div.hr-label', 'Chi decide'), stepTxt.map(([l, at]) => h('div.hr-li', h('span.small', l), at ? h('span.hr-chip.z-ok', itDate(at)) : h('span.hr-chip', 'in attesa')))),
        d.accesso === 'hr' ? h('div.card.hr-pad', h('div.hr-label', 'Revisione promessa nell\'offerta (solo HR)'),
          p.offerta ? h('p.small', `Offerta accettata: ${eur(p.offerta.ral)}${p.offerta.benefit ? ` · ${p.offerta.benefit}` : ''}${p.offerta.motivo ? ` · «${p.offerta.motivo}»` : ''}`) : h('p.small.muted', 'Entrato senza una selezione in Alma: nessuna offerta registrata.'),
          field('RAL dopo la prova (€)', rev), h('p.small.muted', 'Si registra con il visto; passa dal pannello del salary grade come ogni revisione.')) : null,
        h('div.card.hr-pad', h('div.hr-label', 'Dopo la decisione'), h('ul.small', h('li', 'Confermata: il piano si chiude e la persona entra nel ciclo annuale di valutazione (Fase 5).'), h('li', 'Non superata: HR prepara la comunicazione con il consulente; su BOSS si chiude il rapporto.'), h('li', 'Avvisi: 30 giorni prima al responsabile, 10 a HR, il giorno prima a HR e Direzione.'))))));
}

// ── AC · formazione ─────────────────────────────────────────────────────────────────────────────────────────
export async function formazioneView(c, params) {
  const d = await get(`/api/hr/formazione?${ambQs()}`);
  const amb = await ambitoSelect(() => formazioneView(c, params));
  const reload = () => formazioneView(c, params);
  const tab = ['persone', 'catalogo', 'ruoli'].includes(params.get('tab')) ? params.get('tab') : 'persone';
  const used = d.corsi.filter(cc => cc.attivo && d.persone.some(p => p.corsi.some(x => x.course_id === cc.id)));
  const k = d.kpi;
  const kpi = (l, v, s, cl) => h('div.hr-kpi', h('div.l', l), h('div.v', { class: cl || '' }, v), s ? h('div.small.muted', s) : null);
  const carica = (personKey, courseId) => {
    const pers = h('select.select', d.persone.map(p => h('option', { value: p.key, selected: p.key === personKey }, p.nome)));
    const corso = h('select.select', d.corsi.filter(x => x.attivo).map(x => h('option', { value: x.id, selected: x.id === courseId }, x.nome)));
    const data = h('input.input', { type: 'date' });
    const ente = h('input.input', { maxlength: 200 });
    const file = h('input', { type: 'file', accept: '.pdf,image/png,image/jpeg' });
    const m = modal({ title: 'Carica attestato', body: h('div.hr-form', field('Persona', pers), field('Corso', corso), h('div.hr-grid2', field('Data del corso', data), field('Ente', ente)), field('Attestato (PDF)', file),
      h('p.small.muted', 'La scadenza la calcola Alma dalla validità del corso. Se la persona è in inserimento, il compito del piano si chiude da solo.')),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      if (!data.value) return toast('Data del corso', 'err');
      const f = file.files[0];
      const r = await post('/api/hr/formazione/attestati', { person_key: pers.value, course_id: Number(corso.value), data: data.value, ente: ente.value, file: f ? await readFile(f) : undefined });
      m.close(); toast(r.scade ? `Valido fino al ${itDate(r.scade)}` : 'Attestato registrato'); reload();
    } } }, 'Salva')] });
  };
  const tabs = h('div.hr-tabs', [['persone', 'Persone'], ['catalogo', 'Catalogo dei corsi'], ['ruoli', 'Corsi per ruolo']].map(([t, l]) => h('a', { href: `#/hr/formazione?tab=${t}`, class: tab === t ? 'on' : '' }, l)));
  let body;
  if (tab === 'persone') {
    body = h('div.card.hr-scroll', h('table.list.hr-nohover', h('thead', h('tr', h('th', 'Persona'), h('th', 'Area'), used.map(cc => h('th', { style: { textAlign: 'center' } }, cc.nome.replace('Formazione ', ''))), h('th', 'Cantiere'))),
      h('tbody', d.persone.filter(p => p.corsi.length).map(p => h('tr', h('td', h('b', p.nome), p.nuovo ? h('span.hr-chip.z-info', { style: { marginLeft: '4px' } }, 'nuovo') : null), h('td.small', p.area),
        used.map(cc => { const s = p.corsi.find(x => x.course_id === cc.id); return h('td', { style: { textAlign: 'center' } }, s ? h('button.hr-cellbtn', { type: 'button', title: 'Carica attestato', on: { click: () => carica(p.key, cc.id) } }, corsoChip(s)) : h('span.muted', '—')); }),
        h('td', p.cantiere.ok ? h('span.hr-chip.z-ok', 'sì') : h('span.hr-chip.z-bad', { title: p.cantiere.mancano.join(', ') }, 'non da solo')))))));
  } else if (tab === 'catalogo') {
    const editCourse = (x = {}) => {
      const nome = h('input.input', { value: x.nome || '', maxlength: 160 });
      const ore = h('input.input', { type: 'number', step: 0.5, value: x.ore ?? '' });
      const val = h('input.input', { type: 'number', value: x.validita_mesi ?? '', placeholder: 'vuoto = non scade' });
      const giorno = h('input.input', { type: 'number', min: 0, max: 90, value: x.giorno ?? 30 });
      const blocca = h('input', { type: 'checkbox', checked: Boolean(x.blocca_cantiere) });
      const attivo = h('input', { type: 'checkbox', checked: x.attivo !== false });
      const m = modal({ title: x.id ? 'Modifica corso' : 'Nuovo corso', body: h('div.hr-form', field('Nome', nome), h('div.hr-grid2', field('Ore', ore), field('Validità (mesi)', val), field('Entro il giorno (nel piano)', giorno)),
        h('label.hr-row.small', blocca, 'Senza questo corso non si lavora da soli in cantiere'), x.id ? h('label.hr-row.small', attivo, 'Attivo') : null),
      actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        const b = { nome: nome.value, ore: ore.value || null, validita_mesi: val.value ? Number(val.value) : null, giorno: Number(giorno.value || 30), blocca_cantiere: blocca.checked, ...(x.id ? { attivo: attivo.checked } : {}) };
        if (x.id) await patch(`/api/hr/formazione/corsi/${x.id}`, b); else await post('/api/hr/formazione/corsi', b);
        m.close(); reload();
      } } }, 'Salva')] });
    };
    body = h('div.card.hr-pad', h('div.hr-row', { style: { justifyContent: 'flex-end' } }, h('button.btn.btn-sm', { type: 'button', on: { click: () => editCourse() } }, '+ Corso')),
      h('table.hr-t', h('tr', ['Corso', 'Ore', 'Validità', 'Nel piano entro', 'Cantiere', ''].map(x => h('th', x))),
        d.corsi.map(x => h('tr', { style: { opacity: x.attivo ? 1 : 0.5 } }, h('td', x.nome), h('td', x.ore ? String(Number(x.ore)).replace('.', ',') : '—'), h('td', x.validita_mesi ? `${x.validita_mesi} mesi` : 'non scade'), h('td', `giorno ${x.giorno}`),
          h('td', x.blocca_cantiere ? h('span.hr-chip.z-bad', 'blocca') : '—'), h('td', h('button.btn.btn-sm', { type: 'button', on: { click: () => editCourse(x) } }, 'Modifica'))))));
  } else {
    body = h('div.card.hr-scroll', h('table.list.hr-nohover', h('thead', h('tr', h('th', 'Ruolo del mansionario'), d.corsi.filter(x => x.attivo).map(x => h('th', { style: { textAlign: 'center' } }, x.nome.replace('Formazione ', ''))))),
      h('tbody', d.ruoli.map(r => h('tr', h('td', r.title), d.corsi.filter(x => x.attivo).map(x => { const cb = h('input', { type: 'checkbox', checked: r.corsi.includes(x.id), on: { change: async () => {
        const ids = new Set(r.corsi); if (cb.checked) ids.add(x.id); else ids.delete(x.id); r.corsi = [...ids]; await put(`/api/hr/formazione/ruoli/${r.id}`, { corsi: r.corsi }); toast('Salvato');
      } } }); return h('td', { style: { textAlign: 'center' } }, cb); }))))));
  }
  fill(c, head('Formazione obbligatoria', 'Ogni ruolo del mansionario dice quali corsi servono e quali bloccano il cantiere. In BOSS questi dati non ci sono: per ora stanno in Alma.',
    h('div.hr-row', amb, h('button.btn', { type: 'button', on: { click: () => carica() } }, 'Carica attestato'), h('a.btn', { href: '/api/hr/formazione.xlsx' }, icon('sheet', { size: 14 }), 'Esporta Excel'))),
  h('div.hr-grid4', kpi('Corsi in regola', k.richiesti ? `${Math.round(k.in_regola / k.richiesti * 100)}%` : '—', `${k.in_regola} di ${k.richiesti} attestati richiesti`),
    kpi('Scaduti', String(k.scaduti), `${k.bloccano} persone bloccate in cantiere`, k.scaduti ? 'z-bad-t' : ''), kpi('In scadenza (60 gg)', String(k.in_scadenza)), kpi('Nuovi assunti da formare', String(k.nuovi))),
  tabs, body,
  howTo('Le colonne sono i corsi che servono ad almeno un ruolo dell\'ambito; «—» = non serve a quel ruolo. Verde con anno = valido fino a; giallo = in scadenza o da fare nel piano; rosso = scaduto o in ritardo. Clic su una cella: carica l\'attestato. «Cantiere» dice se la persona può lavorare da sola in cantiere.'));
}

// ── AF · modelli e documenti ────────────────────────────────────────────────────────────────────────────────
export async function modelliView(c, params) {
  const d = await get('/api/hr/onboarding-modelli');
  const reload = () => modelliView(c, params);
  const chiave = params.get('m') || 'base';
  const cur = d.modelli.find(m => m.chiave === chiave) || d.modelli[0];
  const items = cur.items.map(x => ({ ...x }));
  const list = h('tbody');
  const chiOpts = v => Object.entries(d.chi).map(([k, l]) => h('option', { value: k, selected: k === v }, l));
  const draw = () => fill(list, items.map((it, i) => h('tr',
    h('td', h('input.input', { type: 'number', min: 0, max: 90, value: it.giorno, style: { width: '74px' }, on: { input: e => { it.giorno = Number(e.target.value); } } })),
    h('td', h('input.input', { value: it.titolo, maxlength: 300, style: { width: '100%' }, on: { input: e => { it.titolo = e.target.value; } } })),
    h('td', h('select.select', { on: { change: e => { it.chi = e.target.value; } } }, chiOpts(it.chi))),
    h('td', h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Togli', on: { click: () => { items.splice(i, 1); draw(); } } }, '×')))));
  draw();
  const preview = h('div');
  const roleSel = h('select.select', h('option', { value: '' }, 'Anteprima su un ruolo…'), d.ruoli.map(r => h('option', { value: r.id }, r.title)));
  roleSel.addEventListener('change', async () => {
    if (!roleSel.value) return fill(preview);
    const a = await get(`/api/hr/onboarding-modelli/anteprima?role_id=${roleSel.value}`);
    fill(preview, h('div.card.hr-pad', h('div.hr-label', `Piano composto · sede ${a.sede} · ${a.modelli.join(' + ')}`), h('table.hr-t', a.piano.map(t => h('tr', h('td.small', t.giorno === 0 ? 'giorno 1' : `giorno ${t.giorno + 1}`), h('td.small', t.titolo), h('td', chiChip(d.chi[t.chi] || t.chi))))),
      h('div.hr-label', 'Obiettivi di inserimento'), h('ul.small', a.obiettivi.map(g => h('li', g)))));
  });
  const docs = h('div.card.hr-pad', h('div.hr-row', { style: { justifyContent: 'space-between' } }, h('div.hr-label', 'Documenti da leggere (oltre al mansionario del ruolo)'), h('button.btn.btn-sm', { type: 'button', on: { click: () => editDoc(reload) } }, '+ Documento')),
    d.documenti.length ? d.documenti.map(x => h('div.hr-li', { style: { opacity: x.attivo ? 1 : 0.5 } }, h('span.small', x.titolo, h('span.muted', ` · v${x.version}${x.has_file ? ' · PDF' : x.url ? ' · link' : ''}`)),
      h('span.hr-row', h('button.btn.btn-sm', { type: 'button', on: { click: () => editDoc(reload, x) } }, 'Nuova versione'), h('button.btn.btn-sm', { type: 'button', on: { click: async () => { await patch(`/api/hr/documenti/${x.id}`, { attivo: !x.attivo }); reload(); } } }, x.attivo ? 'Togli' : 'Rimetti'))))
      : h('p.small.muted', 'Nessun documento: aggiungi regolamento, codice etico, informativa privacy.'));
  fill(c, head('Modelli di inserimento', 'Un modello base per tutti, più un pezzo per famiglia del mansionario, per la sede cantiere e per i responsabili. Il piano di ogni persona si compone da solo: base + famiglia + sede + corsi del ruolo.'),
    h('div.hr-grid-side',
      h('div', d.modelli.map(m => h('a.hr-mod', { href: `#/hr/modelli?m=${encodeURIComponent(m.chiave)}`, class: m.chiave === cur.chiave ? 'on' : '' }, h('b', m.nome), h('div.small.muted', `${m.items.length} compiti · v${m.version} · ${m.ruoli} ruoli`)))),
      h('div',
        h('div.card.hr-pad', h('div.hr-row', { style: { justifyContent: 'space-between' } }, h('div.hr-label', `${cur.nome} · v${cur.version}`), roleSel),
          h('table.hr-t', h('thead', h('tr', h('th', 'Giorno (0 = primo)'), h('th', 'Compito'), h('th', 'Chi'), h('th', ''))), list),
          h('div.hr-row', { style: { marginTop: '10px' } }, h('button.btn', { type: 'button', on: { click: () => { items.push({ giorno: 0, titolo: '', chi: 'hr' }); draw(); } } }, '+ Compito'),
            h('button.btn.btn-primary', { type: 'button', on: { click: async () => { const r = await put(`/api/hr/onboarding-modelli/${encodeURIComponent(cur.chiave)}`, { items: items.filter(x => x.titolo.trim()) }); toast(`Salvato come v${r.version}`); reload(); } } }, `Salva come v${cur.version + 1}`),
            h('span.small.muted', 'I piani già partiti restano sulla versione con cui sono nati. Corsi, documenti, obiettivi e incontri si aggiungono da soli.'))),
        preview, docs)));
}
function editDoc(reload, x) {
  const titolo = h('input.input', { value: x?.titolo || '', maxlength: 200, disabled: Boolean(x) });
  const url = h('input.input', { value: x?.url || '', placeholder: 'https://…', maxlength: 500 });
  const file = h('input', { type: 'file', accept: '.pdf' });
  const m = modal({ title: x ? `Nuova versione · ${x.titolo}` : 'Nuovo documento da leggere', body: h('div.hr-form', field('Titolo', titolo), field('Link (SharePoint o intranet)', url), field('Oppure il PDF', file),
    x ? h('p.small.muted', 'Con una versione nuova, chi è in inserimento la deve rileggere.') : null),
  actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    const f = file.files[0];
    const b = { titolo: titolo.value, url: url.value || null, file: f ? await readFile(f) : undefined };
    if (x) await patch(`/api/hr/documenti/${x.id}`, b); else await post('/api/hr/documenti', b);
    m.close(); reload();
  } } }, 'Salva')] });
}
