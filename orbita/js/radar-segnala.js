// ALM2-94 «Segnala un'opportunità» (canvas approvato da Dante il 25/11/2026, tavole S1–S4).
// S1 la finestra: «Cosa è successo» con gli screenshot incollati (Ctrl+V) o trascinati, ente, link, allegati, dettagli
//    chiusi, «Chi deve decidere» (colleghi, Teams/Email, messaggio, entro quando). Il pulsante dice cosa succede.
// S3/S4 nel riquadro della segnalazione: la richiesta «Tienila / Scartala», chi deve decidere con le risposte, allegati.
import { h, fill, toast, fmtDate, initials } from './ui.js';
import { get, post, del, api } from './api.js';
import { store, loadUsers } from './store.js';
import { peoplePicker } from './people.js';
import { ic, pill, cvModal, choiceChips } from './crm-v2.js';

const FILE_MAX = 20 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const KINDS = { notizia: 'Notizia', investimento: 'Investimento privato', permesso: 'Permesso o piano attuativo', opera_finanziata: 'Opera pubblica finanziata',
  scadenza: 'Contratto in scadenza', nuovo_gestore: 'Nuovo gestore o proprietà', cliente: 'Notizia su un cliente', indiscrezione: 'Indiscrezione' };
const KEY = 'alma.radar.chiedi.canali';
const readChannels = () => { try { const x = JSON.parse(localStorage.getItem(KEY) || 'null'); return x ? { teams: Boolean(x.teams), mail: Boolean(x.mail) } : { teams: true, mail: true }; } catch { return { teams: true, mail: true }; } };
const saveChannels = c => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* niente memoria: la prossima volta di nuovo entrambi */ } };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmtSize = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const day = d => (d ? fmtDate(String(d).slice(0, 10)) : '');
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const plusDays = n => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const time = d => new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
const when = d => (String(d).slice(0, 10) === today() ? `oggi ${time(d)}` : `${day(d)} ${time(d)}`);
const ext = name => (String(name).split('.').pop() || '').slice(0, 4).toUpperCase();
const EXT_TONE = { PDF: 'rd', XLS: 'gr', XLSX: 'gr', CSV: 'gr', DOC: 'bl', DOCX: 'bl', PNG: 'pu', JPG: 'pu', JPEG: 'pu' };
const fileTag = name => h(`span.rs-ext.${EXT_TONE[ext(name)] || 'gy'}`, ext(name) || 'FILE');

async function uploadFile(signalId, file, { screenshot = false } = {}) {
  if (file.size > FILE_MAX) { toast(`«${file.name}» supera 20 MB: non caricato`, 'err'); return null; }
  return api('POST', `/api/crm/radar/signals/${signalId}/files?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || 'application/octet-stream')}${screenshot ? '&screenshot=1' : ''}`, file,
    { raw: true, headers: { 'Content-Type': 'application/octet-stream' } }).catch(() => null);
}
// le immagini incollate arrivano senza nome: «Screenshot 1.png», «Screenshot 2.png»…
const named = (file, n) => (file.name && file.name !== 'image.png' ? file : new File([file], `Screenshot ${n}.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: file.type }));

// ── S1 · la finestra ───────────────────────────────────────────────────────────────────────────
export async function newSignalDialog(data, onDone, { open = false } = {}) {
  data = data || store.crmData || await get('/api/crm');
  if (!store.users.length) await loadUsers().catch(() => {}); // i colleghi per «Chi deve decidere»
  const shots = [];   // { file, url }
  const docs = [];    // File
  let ids = [];
  const ch = readChannels();
  let due = plusDays(2);

  const titleIn = h('textarea.rs-cosa-in', { rows: 3, maxlength: 500, id: 'rs-cosa', placeholder: '«Rossi Logistica ottiene 8 M€ per un polo a San Salvo»', 'aria-label': 'Cosa è successo' });
  const shotsBox = h('div.rs-shots');
  const cosa = h('div.rs-cosa', titleIn, shotsBox);
  const drawShots = () => fill(shotsBox, shots.map((s, i) => h('figure.rs-shot',
    h('img', { src: s.url, alt: `Screenshot ${i + 1}` }),
    h('figcaption', h('span', `${s.file.name} · incollato`), h('button', { type: 'button', 'aria-label': `Togli ${s.file.name}`, on: { click: () => { shots.splice(i, 1); drawShots(); drawFoot(); } } }, ic('x', 14))))),
  h('div.rs-shot-hint', ic('image', 20), h('span', h('b', 'Ctrl+V'), ' per incollare', h('br'), 'uno screenshot qui')));
  drawShots();
  const addShot = file => { if (file.size > FILE_MAX) return toast('Lo screenshot supera 20 MB', 'err'); const f = named(file, shots.length + 1); const s = { file: f, url: '' }; shots.push(s); drawFoot();
    // anteprima come data: (la regola di sicurezza delle immagini non ammette blob:)
    const rd = new FileReader(); rd.onload = () => { s.url = String(rd.result); drawShots(); }; rd.readAsDataURL(f); };

  const entity = h('input.input', { placeholder: 'Ente o azienda', maxlength: 300, 'aria-label': 'Ente o azienda', list: 'rs-subjects' });
  const names = h('datalist', { id: 'rs-subjects' });
  get('/api/crm/subjects', { quiet: true }).then(r => fill(names, r.subjects.slice(0, 2000).map(s => h('option', { value: s.name })))).catch(() => {});
  const inCrm = h('span');
  entity.addEventListener('input', () => fill(inCrm, [...names.children].some(o => o.value.toLowerCase() === entity.value.trim().toLowerCase()) ? pill('nel CRM', 'gr') : null));
  const url = h('input.input', { type: 'url', placeholder: 'https://…', 'aria-label': 'Link alla fonte' });

  const fileIn = h('input', { type: 'file', multiple: true, hidden: true, on: { change: () => { for (const f of fileIn.files) addDoc(f); fileIn.value = ''; } } });
  const docsBox = h('div.rs-docs');
  const addDoc = f => { if (f.size > FILE_MAX) return toast(`«${f.name}» supera 20 MB`, 'err'); docs.push(f); drawDocs(); drawFoot(); };
  const drawDocs = () => fill(docsBox, docs.map((f, i) => h('span.rs-doc', fileTag(f.name), h('span.rs-doc-n', f.name), h('small', fmtSize(f.size)),
    h('button', { type: 'button', 'aria-label': `Togli ${f.name}`, on: { click: () => { docs.splice(i, 1); drawDocs(); drawFoot(); } } }, ic('x', 14)))),
  h('button.rs-attach', { type: 'button', on: { click: () => fileIn.click() } }, ic('paperclip', 15), 'Allega o trascina qui'), fileIn);
  drawDocs();

  const kind = h('select.select', { 'aria-label': 'Tipo' }, Object.entries(KINDS).map(([k, l]) => h('option', { value: k }, l)));
  const bu = h('select.select', { 'aria-label': 'BU' }, h('option', { value: '' }, 'La sceglie il radar dal profilo'), (data.asa || []).map(a => h('option', { value: a.key }, a.label)));
  const amount = h('input.input', { placeholder: 'es. 1.200.000', inputmode: 'decimal', 'aria-label': 'Importo (€)' });
  const deadline = h('input.input', { type: 'date', 'aria-label': 'Quando' });
  const summary = h('textarea.input', { rows: 3, placeholder: 'Dettagli (facoltativi)', 'aria-label': 'Dettagli' });
  const detSum = h('span.rs-det-sum');
  const drawDet = () => fill(detSum, ['tipo ' + KINDS[kind.value], bu.value ? (data.asa.find(a => a.key === bu.value)?.label || bu.value) : 'BU dal radar', amount.value ? `importo ${amount.value} €` : 'importo', deadline.value ? day(deadline.value) : 'data'].join(' · '));
  [kind, bu, amount, deadline].forEach(x => x.addEventListener('input', drawDet));
  drawDet();
  const fld = (label, control) => h('label.cv-fld', h('span', label), control);
  const details = h('details.rs-det', h('summary', h('span', 'Dettagli · facoltativi'), detSum),
    h('div.rs-det-body', h('div.cv-grid2', fld('Tipo', kind), fld('BU', bu)), h('div.cv-grid2', fld('Importo (€)', amount), fld('Quando (gara o lavori)', deadline)), fld('Dettagli', summary)));

  // chi deve decidere
  const askRest = h('div.rs-ask-rest', { hidden: true });
  const picker = peoplePicker({ selected: [], label: '+ Aggiungi un collega', onChange: x => { ids = x.filter(i => i !== store.me.id); askRest.hidden = !ids.length; drawFoot(); } });
  const chan = (key, label) => {
    const box = h('input', { type: 'checkbox', checked: ch[key] });
    const el = h('label.rs-chan', { class: ch[key] ? 'on' : '' }, box, label);
    box.addEventListener('change', () => { ch[key] = box.checked; el.classList.toggle('on', box.checked); });
    return el;
  };
  const msg = h('input.input', { maxlength: 1000, placeholder: 'Per voi ha senso? Il quadro economico è nell\'Excel.', 'aria-label': 'Messaggio per loro' });
  const dues = choiceChips([[plusDays(2), '2 giorni'], [plusDays(7), '1 settimana'], ['', 'Nessuna scadenza']], due, { label: 'Risposta entro', onChange: v => { due = v; } });
  fill(askRest,
    h('div.rs-row', h('span.cv-small', 'Mandala anche'), chan('teams', 'Teams'), chan('mail', 'Email'), h('small.cv-muted', 'L\'avviso in Alma parte sempre.')),
    h('label.cv-fld', h('span', 'Messaggio per loro · facoltativo'), msg),
    h('div.rs-row', h('span.cv-small', 'Risposta entro'), dues.el));
  const ask = h('div.rs-ask', h('div.rs-ask-head', h('b', 'Chi deve decidere'), h('span.cv-small.cv-muted', 'facoltativo · ognuno risponde Tienila o Scartala')),
    h('div.sh-pick', picker.el), askRest);

  const counter = h('span.cv-small.cv-muted');
  const save = h('button.btn.btn-primary', { type: 'button' });
  const drawFoot = () => {
    fill(counter, [shots.length ? plural(shots.length, 'screenshot', 'screenshot') : '', docs.length ? plural(docs.length, 'allegato', 'allegati') : ''].filter(Boolean).join(' · '));
    save.textContent = ids.length ? `Salva e manda a ${plural(ids.length, 'collega', 'colleghi')}` : 'Salva il segnale';
  };
  drawFoot();

  const body = h('div.en-form.rs-form',
    h('div.cv-fld', h('label', { for: 'rs-cosa' }, h('span', 'Cosa è successo')), cosa),
    h('div.cv-grid2', h('label.cv-fld', h('span', 'Ente o azienda'), h('div.rs-ent', entity, inCrm), names), fld('Link alla fonte', url)),
    h('div.cv-fld', h('span', 'Allegati'), docsBox, h('span.cv-hint', 'PDF, Word, Excel, immagini · fino a 20 MB l\'uno')),
    details, h('hr.rs-hr'), ask);

  save.addEventListener('click', async () => {
    if (!titleIn.value.trim()) { titleIn.focus(); return toast('Scrivi cosa è successo', 'err'); }
    save.disabled = true;
    let g;
    try {
      g = await post('/api/crm/radar/signals', { title: titleIn.value.trim(), entity: entity.value, kind: kind.value, bu: bu.value || null, amount: amount.value || null, deadline: deadline.value || null, url: url.value.trim(), summary: summary.value });
    } catch { save.disabled = false; return; }
    save.textContent = 'Carico i file…';
    let lost = 0;
    for (const s of shots) if (!(await uploadFile(g.id, s.file, { screenshot: true }))) lost++;
    for (const f of docs) if (!(await uploadFile(g.id, f))) lost++;
    let r = null;
    if (ids.length) {
      saveChannels(ch);
      r = await post(`/api/crm/radar/signals/${g.id}/chiedi`, { user_ids: ids, message: msg.value, due_on: due || null, teams: ch.teams, mail: ch.mail }).catch(() => null);
    }
    m.close();
    const failed = r ? [...r.teams.failed.map(f => `Teams a ${f.name}`), ...r.mail.failed.map(f => `email a ${f.name}`)] : [];
    toast(r ? `Segnale salvato (punteggio ${g.score}) e mandato a ${plural(r.sent, 'collega', 'colleghi')}${failed.length ? `; non partito: ${failed.join(', ')}` : ''}`
      : `Segnale salvato: punteggio ${g.score}${g.bu ? '' : ' (nessuna BU adatta)'}`, failed.length || lost ? 'err' : 'ok', failed.length ? 8000 : 0);
    if (lost) toast(`${plural(lost, 'file non caricato', 'file non caricati')}: riprova dalla segnalazione`, 'err');
    onDone?.(g);
    if (open) {
      if (!location.hash.startsWith('#/crm/radar')) location.hash = '#/crm/radar';
      (await import('./crm-radar.js')).openSignal(g.id, null, store.crmData || data);
    }
  });

  const m = cvModal({
    size: 'lg',
    title: h('div', h('div.cv-lbl.rs-eyebrow', 'Radar'), h('h2', 'Segnala un\'', h('b', 'opportunità')), h('div.cv-subh', 'Il radar sceglie la BU e calcola il punteggio. Se vuoi, la fai decidere a un collega.')),
    body,
    left: [counter],
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), save],
  });
  m.box.classList.add('rs-dlg');
  // incolla: le immagini diventano screenshot (dove che sia il cursore nella finestra), il testo resta testo
  m.box.addEventListener('paste', e => {
    const imgs = [...(e.clipboardData?.items || [])].filter(it => it.kind === 'file' && IMAGE_TYPES.includes(it.type)).map(it => it.getAsFile()).filter(Boolean);
    if (!imgs.length) return;
    e.preventDefault();
    imgs.forEach(addShot);
  });
  // trascina: immagini su «Cosa è successo» → screenshot; il resto → allegati
  m.box.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); m.box.classList.add('rs-drop'); } });
  m.box.addEventListener('dragleave', e => { if (e.target === m.box) m.box.classList.remove('rs-drop'); });
  m.box.addEventListener('drop', e => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    m.box.classList.remove('rs-drop');
    const onCosa = Boolean(e.target.closest?.('.rs-cosa'));
    for (const f of e.dataTransfer.files) (onCosa && IMAGE_TYPES.includes(f.type) ? addShot : addDoc)(f);
  });
  setTimeout(() => titleIn.focus(), 50);
  return m;
}

// ── S3 · Tienila / Scartala ─────────────────────────────────────────────────────────────────────
export async function decide(g, decision, after) {
  if (decision === 'scarta') return scartaDialog(g, after);
  const r = await post(`/api/crm/radar/signals/${g.id}/decidi`, { decision: 'tieni' });
  toast(r.was_decided ? 'Risposta registrata: la segnalazione era già stata decisa'
    : `L'hai tenuta: ora è nel Radar${r.bu ? ` di ${r.bu}` : ''} con il piano d'azione da approvare`, 'ok', 6000);
  after?.(r);
}
function scartaDialog(g, after) {
  const asker = g.my_ask?.asked_by_name || '';
  const reason = choiceChips((g.discardReasons?.length ? g.discardReasons : ['Fuori dalla nostra BU', 'Troppo piccola', 'La conosciamo già', 'Altro']).map(r => [r, r]), '', { label: 'Perché' });
  const note = h('textarea.input', { rows: 2, maxlength: 2000, 'aria-label': 'Due parole', placeholder: 'Es. «È logistica pura, per Impianti non c\'è nulla. Girala a Edilizia.»' });
  const go = h('button.btn.rs-dark', { type: 'button', on: { click: async () => {
    if (!reason.value) return toast('Scegli il motivo', 'err');
    go.disabled = true;
    try {
      const r = await post(`/api/crm/radar/signals/${g.id}/decidi`, { decision: 'scarta', reason: reason.value, note: note.value });
      m.close();
      toast(r.was_decided ? 'Risposta registrata: la segnalazione era già stata decisa' : r.outcome === 'scartata' ? 'Scartata: va tra le Scartate con i motivi' : 'Scartata: lo sapranno chi l\'ha segnalata e gli altri che decidono');
      after?.(r);
    } catch { go.disabled = false; }
  } } }, 'Scartala');
  const m = cvModal({
    size: 'sm',
    title: h('div', h('h2', 'La ', h('b', 'scarti'), '?'), h('div.cv-subh.cv-clamp', [g.subject_name || g.entity, g.title, asker ? `segnalata da ${asker}` : ''].filter(Boolean).join(' · '))),
    body: h('div.en-form', h('div.cv-fld', h('span', 'Perché'), reason.el), h('label.cv-fld', h('span', `Due parole${asker ? ` per ${asker}` : ''} · facoltativo`), note)),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), go],
  });
  m.box.classList.add('rs-light');
}

// La richiesta in cima al riquadro, per chi deve decidere e non ha ancora risposto
export function askBanner(g, after) {
  const k = g.my_ask;
  if (!k) return null;
  if (k.decision) return h('div.rs-mine.done', ic(k.decision === 'tieni' ? 'check' : 'x', 16), h('span', `Hai risposto: ${k.decision === 'tieni' ? 'Tienila' : `Scartala (${k.reason})`} · ${when(k.decided_at)}`));
  return h('div.rs-mine',
    h('div.rs-mine-t', h('b', `${k.asked_by_name || 'Un collega'} ti chiede di decidere`), k.due_on ? h('span.cv-small.cv-muted', `entro ${day(k.due_on)}`) : null),
    k.message ? h('div.rs-quote', `«${k.message}»`) : null,
    h('div.rs-mine-acts',
      h('button.btn', { type: 'button', on: { click: () => decide(g, 'scarta', after) } }, 'Scartala'),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => decide(g, 'tieni', after) } }, ic('check', 15), 'Tienila')));
}

// ── S4 · chi deve decidere, con le risposte ────────────────────────────────────────────────────
const AV_TONES = ['#2E7D4F', '#5B6B8C', '#8A4307', '#6A4A96', '#2F6FA3'];
export function asksBox(g, refresh) {
  if (!g.asks?.length && !g.can_ask) return null;
  const due = g.asks.find(k => k.due_on)?.due_on;
  const chans = k => [k.teams === 'ok' ? 'Teams' : null, k.mail === 'ok' ? 'email' : null].filter(Boolean).join(' ed ') || 'avviso in Alma';
  const row = k => {
    const state = k.decision === 'tieni' ? pill('Tenuta', 'gr') : k.decision === 'scarta' ? h('span.rs-pill-dark', 'Scartata') : pill('In attesa', 'or');
    return h('div.rs-who',
      h('span.rs-av', { style: { background: AV_TONES[k.user_id % AV_TONES.length] } }, initials(k.name)),
      h('div.rs-who-b',
        h('span', k.name, h('small.cv-muted', ` · ${chans(k)} · ${k.decided_at ? `ha risposto ${when(k.decided_at)}` : k.opened_at ? `aperta ${when(k.opened_at)}` : 'non ancora aperta'}`)),
        k.decision && (k.note || k.reason) ? h('div.rs-quote', [k.note ? `«${k.note}»` : '', k.reason].filter(Boolean).join(' · ')) : null,
        k.error ? h('div.cm-warn', h('span.cm-bang', '!'), h('span', `Non partito: ${k.error}`)) : null),
      !k.decision && g.can_ask && g.status === 'nuovo' ? h('button.btn.btn-sm', { type: 'button', on: { click: async e => { e.target.disabled = true; await post(`/api/crm/radar/signals/${g.id}/ricorda`, { user_id: k.user_id }).catch(() => {}); toast(`Promemoria mandato a ${k.name}`); refresh(); } } }, 'Ricordaglielo') : null,
      state);
  };
  return h('section.rs-asks',
    h('div.rs-asks-head', h('b', 'Chi deve decidere'), due ? h('span.cv-small.cv-muted', `entro ${day(due)}`) : null, h('span.cv-grow'),
      g.can_ask ? h('button.cv-lnk', { type: 'button', on: { click: () => askDialog(g, refresh) } }, ic('plus', 13), 'Aggiungi un collega') : null),
    g.asks.length ? g.asks.map(row) : h('p.cv-small.cv-muted', { style: { margin: 0 } }, 'Nessuno per ora: puoi farla decidere a un collega.'));
}
async function askDialog(g, refresh) {
  if (!store.users.length) await loadUsers().catch(() => {});
  let ids = [];
  const ch = readChannels();
  let due = plusDays(2);
  const picker = peoplePicker({ selected: [], label: '+ Collega', onChange: x => { ids = x.filter(i => i !== store.me.id); } });
  const chan = (key, label) => { const box = h('input', { type: 'checkbox', checked: ch[key] }); const el = h('label.rs-chan', { class: ch[key] ? 'on' : '' }, box, label); box.addEventListener('change', () => { ch[key] = box.checked; el.classList.toggle('on', box.checked); }); return el; };
  const msg = h('input.input', { maxlength: 1000, 'aria-label': 'Messaggio', placeholder: 'Facoltativo' });
  const dues = choiceChips([[plusDays(2), '2 giorni'], [plusDays(7), '1 settimana'], ['', 'Nessuna scadenza']], due, { label: 'Risposta entro', onChange: v => { due = v; } });
  const go = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    if (!ids.length) return toast('Scegli almeno un collega', 'err');
    go.disabled = true;
    try {
      saveChannels(ch);
      const r = await post(`/api/crm/radar/signals/${g.id}/chiedi`, { user_ids: ids, message: msg.value, due_on: due || null, teams: ch.teams, mail: ch.mail });
      m.close();
      const failed = [...r.teams.failed.map(f => `Teams a ${f.name}`), ...r.mail.failed.map(f => `email a ${f.name}`)];
      toast(`Mandata a ${plural(r.sent, 'collega', 'colleghi')}${failed.length ? `; non partito: ${failed.join(', ')}` : ''}`, failed.length ? 'err' : 'ok');
      refresh();
    } catch { go.disabled = false; }
  } } }, 'Manda');
  const m = cvModal({
    size: 'md',
    title: h('div', h('h2', 'Chi deve ', h('b', 'decidere')), h('div.cv-subh.cv-clamp', g.title)),
    body: h('div.en-form', h('div.cv-fld', h('span', 'Colleghi'), h('div.sh-pick', picker.el)),
      h('div.rs-row', h('span.cv-small', 'Mandala anche'), chan('teams', 'Teams'), chan('mail', 'Email')),
      h('label.cv-fld', h('span', 'Messaggio · facoltativo'), msg), h('div.rs-row', h('span.cv-small', 'Risposta entro'), dues.el)),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), go],
  });
  m.box.classList.add('rs-light');
}

// Screenshot (anteprime che si aprono grandi) e allegati; chi vede la segnalazione può aggiungerne
export function filesBox(g, refresh) {
  const files = g.files || [];
  const shots = files.filter(f => f.screenshot);
  const docs = files.filter(f => !f.screenshot);
  const canDel = f => f.added_by === store.me.id || g.created_by === store.me.id || store.me.is_admin;
  const remove = async f => { await del(`/api/crm/radar/files/${f.id}`); refresh(); };
  const fileIn = h('input', { type: 'file', multiple: true, hidden: true, on: { change: async () => {
    for (const f of fileIn.files) await uploadFile(g.id, f, { screenshot: IMAGE_TYPES.includes(f.type) && /^screenshot|^image/i.test(f.name) });
    refresh();
  } } });
  const box = h('section.rs-files', { tabindex: '-1' },
    shots.length ? h('div.rs-shots.big', shots.map(f => h('div.rs-shot-v',
      h('a', { href: `/api/crm/radar/files/${f.id}?inline=1`, target: '_blank', rel: 'noopener', 'aria-label': `Apri ${f.name} a tutto schermo` }, h('img', { src: `/api/crm/radar/files/${f.id}?inline=1`, alt: f.name, loading: 'lazy' })),
      canDel(f) ? h('button.rs-x', { type: 'button', 'aria-label': `Togli ${f.name}`, on: { click: () => remove(f) } }, ic('x', 13)) : null))) : null,
    h('div.rs-asks-head', h('b', 'Allegati'), h('span.cv-grow'), h('button.cv-lnk', { type: 'button', on: { click: () => fileIn.click() } }, ic('paperclip', 13), 'Allega'), fileIn),
    docs.length ? docs.map(f => h('div.rs-file', h('a', { href: `/api/crm/radar/files/${f.id}`, download: f.name }, fileTag(f.name), h('span.rs-doc-n', f.name), h('span.cv-grow'), h('small.cv-muted', [fmtSize(f.size), f.added_by_name].filter(Boolean).join(' · '))),
      canDel(f) ? h('button.rs-x', { type: 'button', 'aria-label': `Togli ${f.name}`, on: { click: () => remove(f) } }, ic('x', 13)) : null))
      : h('p.cv-small.cv-muted', { style: { margin: 0 } }, 'Nessun allegato. Puoi incollare qui uno screenshot con Ctrl+V.'),
    h('small.cv-muted', 'Chi decide può aggiungere allegati e screenshot anche dopo.'));
  // Ctrl+V sul riquadro: lo screenshot si aggiunge alla segnalazione
  box.addEventListener('paste', async e => {
    const imgs = [...(e.clipboardData?.items || [])].filter(it => it.kind === 'file' && IMAGE_TYPES.includes(it.type)).map(it => it.getAsFile()).filter(Boolean);
    if (!imgs.length) return;
    e.preventDefault();
    for (const [i, f] of imgs.entries()) await uploadFile(g.id, named(f, shots.length + i + 1), { screenshot: true });
    refresh();
  });
  return box;
}

// Nella riga del Radar: «1 di 2 hanno risposto»
export const asksPill = sig => (sig.asks_total ? pill(`${sig.asks_done} di ${sig.asks_total} ${sig.asks_done === 1 ? 'ha' : 'hanno'} risposto`, sig.asks_done === sig.asks_total ? 'gr' : 'or') : null);
