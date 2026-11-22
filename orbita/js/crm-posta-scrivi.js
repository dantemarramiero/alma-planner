// Scrivere le email come in Outlook (ALM2-68, tavola N del canvas «Progetto da email», approvata da Dante il 23/11/2026).
// La scrittura prende tutta la parte destra della Posta al posto della lettura:
// - in alto Invia, Salva bozza, Allega, «Scrivi con Alma», IT/EN, Scarta; poi A, Cc, Ccn, Oggetto; per le risposte la
//   barra «Dalla email / Nel CRM» (aggiungi contatto, azienda, opportunità senza uscire);
// - testo con grassetto, corsivo, elenchi; @ propone colleghi e contatti del CRM e aggiunge la persona in A;
// - sotto il testo la firma Almacis com'è davvero (togli o cambia), poi l'email originale chiusa;
// - Alma scrive solo col pulsante «Scrivi la bozza»: legge l'email ricevuta e usa tutte le tue indicazioni (una per riga,
//   Invio va a capo), in italiano o in inglese, col tono che usi con quella persona; «Annulla» rimette il testo di prima;
// - Ctrl+Invio invia; la bozza si tiene da sola in questo browser (se chiudi la ritrovi).
import { h, fill, toast, loading, debounce, fmtDate, confirmDialog } from './ui.js';
import { get, post } from './api.js';
import { store } from './store.js';
import { ic } from './crm-v2.js';

const MAX_FILES = 25 * 1024 * 1024;
const mb = n => `${(n / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`;
const cents = eur => (!(eur > 0) ? '' : eur * 100 < 0.01 ? 'meno di 0,01 cent' : `${(eur * 100).toLocaleString('it-IT', { maximumFractionDigits: eur * 100 < 0.1 ? 2 : 1 })} cent`);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = n => String(n || '').split(' ').filter(w => !/^(ing|arch|geom|dott|avv)\.?$/i.test(w))[0] || '';
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const textToHtml = t => String(t || '').replace(/\r/g, '').split('\n').map(l => `<div>${l ? esc(l) : '<br>'}</div>`).join('');
let firmaCache = null;

// stima del costo della bozza col modello che scrive (gpt-4.1-mini): email ricevuta + conversazione + indicazioni
function guessDraft(e) {
  const words = e ? Math.min(9000, (String(e.body || '').match(/\S+/g) || []).length * Math.max(1, Math.min(e.conversation_count || 1, 4))) : 0;
  const eur = ((words * 1.4 + 1800) * 0.4 + 450 * 1.6) / 1e6 * 0.95;
  return cents(eur) || 'meno di 0,01 cent';
}

export async function openComposer(box, { mode = 'nuova', e = null, crmBar = null, onClose, onSent } = {}) {
  const me = String(store.me?.email || '').toLowerCase();
  const key = `pm-bozza:${mode}:${e?.id || 'nuova'}`;
  // destinatari di partenza come Outlook
  const all = e ? [...new Map([e.from, ...e.to, ...e.cc].filter(p => p.address && p.address !== me).map(p => [p.address, p])).values()] : [];
  const target = e ? (e.from.address !== me ? e.from : (e.to[0] || e.from)) : null;
  const startCc = mode === 'tutti' ? e.cc.filter(p => p.address !== me) : [];
  const people = {
    a: mode === 'rispondi' ? [target] : mode === 'tutti' ? all.filter(p => !startCc.some(c => c.address === p.address)) : [],
    cc: startCc,
    ccn: [],
  };
  const baseSubject = s => String(s || '').replace(/^((re|r|fw|fwd|i|inoltra)\s*:\s*)+/i, '');
  let subject = !e ? '' : mode === 'inoltra' ? `I: ${baseSubject(e.subject)}` : `Re: ${baseSubject(e.subject)}`;
  const files = [];
  const drop = new Set();
  let firmaOn = true;
  let lingua = 'auto';
  let spent = 0;
  let undo = null;
  let sending = false;

  // ── A / Cc / Ccn ──
  const rowsBox = h('div.ps-fields');
  let showCc = people.cc.length > 0;
  let showCcn = false;
  const addPerson = (keyName, p) => {
    const address = String(p.address || '').trim().toLowerCase();
    if (!EMAIL.test(address)) { toast('Indirizzo email non valido', 'err'); return false; }
    if (![...people.a, ...people.cc, ...people.ccn].some(x => x.address === address)) people[keyName].push({ name: p.name || '', address });
    drawRows();
    return true;
  };
  const suggestions = async q => (q.length < 2 ? [] : (await get(`/api/crm/posta/destinatari?q=${encodeURIComponent(q)}`, { quiet: true }).catch(() => ({ people: [] }))).people);
  const row = (keyName, label) => {
    const list = h('div.pm-sugg', { hidden: true });
    const field = h('input.pm-rcpt-i', { placeholder: keyName === 'a' ? 'nome, email o @ nel testo' : '', 'aria-label': label });
    const search = debounce(async () => {
      const opts = (await suggestions(field.value.trim())).filter(p => ![...people.a, ...people.cc, ...people.ccn].some(x => x.address === p.address));
      list.hidden = !opts.length;
      fill(list, opts.map(p => h('button', { type: 'button', on: { mousedown: ev => { ev.preventDefault(); field.value = ''; addPerson(keyName, p); } } },
        h('b', p.name || p.address), h('small', [p.address, p.kind === 'collega' ? 'collega' : p.company || 'contatto del CRM'].filter(Boolean).join(' · ')))));
    }, 200);
    field.addEventListener('input', search);
    field.addEventListener('keydown', ev => {
      if ((ev.key === 'Enter' || ev.key === ',' || ev.key === ';') && field.value.trim()) { ev.preventDefault(); if (addPerson(keyName, { address: field.value.replace(/[,;]/g, '') })) field.value = ''; }
      else if (ev.key === 'Backspace' && !field.value && people[keyName].length) { people[keyName].pop(); drawRows(); }
    });
    field.addEventListener('blur', () => { setTimeout(() => { list.hidden = true; }, 150); if (field.value.includes('@') && addPerson(keyName, { address: field.value })) field.value = ''; });
    return h('div.ps-f', h('span.ps-k', label),
      people[keyName].map(p => h('span.pm-rcpt', { title: p.address }, p.name || p.address,
        h('button', { type: 'button', 'aria-label': `Togli ${p.name || p.address}`, on: { click: () => { people[keyName] = people[keyName].filter(x => x.address !== p.address); drawRows(); } } }, '×'))),
      h('span.pm-rcpt-w', field, list),
      keyName === 'a' && (!showCc || !showCcn) ? h('span.ps-ccl', !showCc ? h('button.cv-lnk', { type: 'button', on: { click: () => { showCc = true; drawRows(); } } }, 'Cc') : null, !showCcn ? h('button.cv-lnk', { type: 'button', on: { click: () => { showCcn = true; drawRows(); } } }, 'Ccn') : null) : null);
  };
  const subjectIn = h('input.ps-subj', { value: subject, placeholder: 'Oggetto', 'aria-label': 'Oggetto', maxlength: 250 });
  subjectIn.addEventListener('input', () => { subject = subjectIn.value; saveLocal(); });
  const drawRows = () => { fill(rowsBox, row('a', 'A'), showCc ? row('cc', 'Cc') : null, showCcn ? row('ccn', 'Ccn') : null, h('div.ps-f', h('span.ps-k', 'Oggetto'), subjectIn)); saveLocal(); };

  // ── testo (editor) con @ ──
  const editor = h('div.ps-editor', { contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Testo dell\'email', 'data-ph': mode === 'inoltra' ? 'Scrivi due righe per chi lo riceve (facoltativo)' : 'Scrivi qui, oppure fatti preparare la bozza da Alma' });
  const mention = h('div.pm-sugg.ps-mention', { hidden: true });
  let mentionState = null; // { node, start, end, opts, sel }
  const caretRect = () => { const s = getSelection(); if (!s.rangeCount) return null; const r = s.getRangeAt(0).cloneRange(); r.collapse(true); const rect = r.getClientRects()[0]; return rect || null; };
  const closeMention = () => { mention.hidden = true; mentionState = null; };
  const pickMention = p => {
    if (!mentionState) return;
    const { node, start, end } = mentionState;
    const range = document.createRange();
    range.setStart(node, start); range.setEnd(node, end);
    range.deleteContents();
    const chip = h('span.mention', { contenteditable: 'false', 'data-address': p.address }, `@${p.name || p.address}`);
    range.insertNode(chip);
    const space = document.createTextNode(' ');
    chip.after(space);
    const s = getSelection(); s.removeAllRanges(); const r2 = document.createRange(); r2.setStartAfter(space); r2.collapse(true); s.addRange(r2);
    if (![...people.a, ...people.cc, ...people.ccn].some(x => x.address === p.address)) { people.a.push({ name: p.name, address: p.address }); drawRows(); toast(`${p.name || p.address} aggiunto in A`); }
    closeMention(); saveLocal();
  };
  const drawMention = () => {
    const { opts, sel } = mentionState;
    if (!opts.length) { mention.hidden = true; return; }
    mention.hidden = false;
    fill(mention, opts.map((p, i) => h('button', { type: 'button', class: i === sel ? 'on' : '', on: { mousedown: ev => { ev.preventDefault(); pickMention(p); } } },
      h('b', p.name || p.address), h('small', [p.address, p.kind === 'collega' ? 'collega' : p.company || 'contatto del CRM'].filter(Boolean).join(' · ')))));
    const rect = caretRect(); const host = wrap.getBoundingClientRect();
    if (rect) { mention.style.left = `${Math.max(8, rect.left - host.left)}px`; mention.style.top = `${rect.bottom - host.top + 6}px`; }
  };
  const checkMention = debounce(async () => {
    const s = getSelection();
    if (!s.rangeCount || !editor.contains(s.anchorNode) || s.anchorNode.nodeType !== 3) return closeMention();
    const node = s.anchorNode; const pos = s.anchorOffset;
    const before = node.textContent.slice(0, pos);
    const m = before.match(/(^|[\s(])@([^\s@]{1,30}(?: [^\s@]{0,20})?)$/);
    if (!m) return closeMention();
    const q = m[2];
    const opts = q.length >= 2 ? await suggestions(q) : store.users.filter(u => u.email && u.id !== store.me?.id && u.name.toLowerCase().startsWith(q.toLowerCase())).slice(0, 6).map(u => ({ name: u.name, address: u.email.toLowerCase(), kind: 'collega' }));
    mentionState = { node, start: pos - q.length - 1, end: pos, opts: opts.slice(0, 8), sel: 0 };
    drawMention();
  }, 120);
  editor.addEventListener('input', () => { checkMention(); saveLocal(); });
  editor.addEventListener('keydown', ev => {
    if (mentionState && !mention.hidden) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); mentionState.sel = (mentionState.sel + 1) % mentionState.opts.length; drawMention(); return; }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); mentionState.sel = (mentionState.sel - 1 + mentionState.opts.length) % mentionState.opts.length; drawMention(); return; }
      if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); pickMention(mentionState.opts[mentionState.sel]); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); closeMention(); return; }
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); send(false); }
  });
  editor.addEventListener('blur', () => setTimeout(closeMention, 150));
  // incolla come testo semplice (niente stili di Word/Outlook dentro)
  editor.addEventListener('paste', ev => { ev.preventDefault(); const t = ev.clipboardData.getData('text/plain'); document.execCommand('insertText', false, t); });
  const fmt = (cmd, label, icon) => h('button.ps-fmt', { type: 'button', title: label, 'aria-label': label, on: { mousedown: ev => { ev.preventDefault(); document.execCommand(cmd); editor.focus(); } } }, icon);

  // ── firma vera sotto il testo ──
  const sigBox = h('div.ps-sig');
  const drawSig = f => {
    if (!f) return fill(sigBox);
    if (!f.enabled) return fill(sigBox, h('div.ps-sig-off', 'Firma spenta · ', h('a', { href: '#/firma' }, 'accendila')));
    const prev = h('div.ps-sig-prev', { class: firmaOn ? '' : 'off' });
    prev.innerHTML = f.html; // costruito dal server con i campi protetti (lib/firma.js)
    fill(sigBox, h('div.ps-sig-bar', h('span', firmaOn ? 'Firma Almacis' : 'Senza firma in questa email'), h('a', { href: '#/firma' }, 'cambia'), h('span', '·'),
      h('button.cv-lnk', { type: 'button', on: { click: () => { firmaOn = !firmaOn; drawSig(f); saveLocal(); } } }, firmaOn ? 'togli' : 'rimettila')), firmaOn ? prev : null);
  };
  (async () => { if (!firmaCache) firmaCache = await get('/api/firma', { quiet: true }).catch(() => null); drawSig(firmaCache); })();

  // ── email originale chiusa ──
  const quote = e ? h('details.ps-quote', h('summary', `Da: ${e.from.name || e.from.address} · ${fmtDate(String(e.date).slice(0, 10))} ${String(e.date).slice(11, 16)} · «${String(e.preview || e.body || '').replace(/\s+/g, ' ').slice(0, 90)}…»`),
    h('div.ps-quote-b', e.body)) : null;

  // ── allegati ──
  const attBox = h('div.ps-atts');
  const picker = h('input', { type: 'file', multiple: true, hidden: true });
  const total = () => files.reduce((s, f) => s + f.size, 0);
  const drawAtts = () => fill(attBox,
    mode === 'inoltra' && e ? e.attachments.filter(a => !drop.has(a.name)).map(a => h('span.pm-file', ic('paperclip', 12), `${a.name} · ${mb(a.size)} · dall'email`,
      h('button', { type: 'button', 'aria-label': `Togli ${a.name}`, on: { click: () => { drop.add(a.name); drawAtts(); } } }, '×'))) : null,
    files.map(f => h('span.pm-file', ic('paperclip', 12), `${f.name} · ${mb(f.size)}`,
      h('button', { type: 'button', 'aria-label': `Togli ${f.name}`, on: { click: () => { files.splice(files.indexOf(f), 1); drawAtts(); } } }, '×'))),
    files.length ? h('small.cv-muted', `${mb(total())} di 25 MB`) : null);
  picker.addEventListener('change', async () => {
    for (const file of picker.files) {
      if (total() + file.size > MAX_FILES) { toast(`«${file.name}» non ci sta: in tutto al massimo 25 MB`, 'err', 6000); continue; }
      const data = await new Promise((ok, ko) => { const rd = new FileReader(); rd.onload = () => ok(String(rd.result).split(',')[1] || ''); rd.onerror = ko; rd.readAsDataURL(file); });
      files.push({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, data });
    }
    picker.value = '';
    drawAtts();
  });

  // ── Alma: parte solo col pulsante ──
  const almaBox = h('div.ps-alma', { hidden: true });
  const ind = h('textarea.ps-ind', { rows: 5, placeholder: mode === 'nuova' ? 'Cosa vuoi dire? Un punto per riga, es.\n- ti mando le referenze dei data center\n- proposta di sentirci giovedì' : 'Cosa vuoi rispondere? Un punto per riga, es.\n- grazie, il progetto ci interessa\n- sopralluogo martedì 1 o giovedì 3 dicembre\n- chiedere il computo in pdf', 'aria-label': 'Indicazioni per Alma' });
  let stile = '';
  const toneLine = h('div.pm-tone');
  const costLine = h('small.cv-muted');
  const chipRow = (label, opts, get_, set_) => {
    const box_ = h('span.ps-chips');
    const draw = () => fill(box_, h('span', label), opts.map(([k, l]) => h('button.cv-pill', { type: 'button', class: get_() === k ? 'dark' : 'line', on: { click: () => { set_(k); draw(); drawLang(); } } }, l)));
    draw();
    return box_;
  };
  const writeBtn = h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => draftWithAlma() } }, ic('sparkles', 14), 'Scrivi la bozza', h('small.pm-est', `≈ ${guessDraft(e)}`));
  const undoBtn = h('button.btn.btn-sm', { type: 'button', hidden: true, on: { click: () => { if (undo !== null) { editor.innerHTML = undo; undo = null; undoBtn.hidden = true; saveLocal(); } } } }, 'Annulla');
  fill(almaBox,
    h('div.ps-alma-h', h('span.kc-k', e ? `Cosa vuoi dire? Alma risponde all'email di ${firstName(e.from.name) || e.from.address} con le tue indicazioni` : 'Cosa vuoi dire? Alma la scrive col tuo tono'), h('small.cv-muted', 'Invio va a capo · non parte da solo')),
    ind,
    h('div.ps-alma-o',
      chipRow('Lingua', e ? [['it', 'Italiano'], ['en', 'English'], ['auto', 'come la conversazione']] : [['it', 'Italiano'], ['en', 'English']], () => lingua, k => { lingua = k; }),
      chipRow('Tono', [['', 'il tuo'], ['formale', 'più formale'], ['breve', 'più breve']], () => stile, k => { stile = k; })),
    toneLine,
    h('div.ps-alma-f', costLine, h('span.pm-sep'), undoBtn, h('button.btn.btn-sm', { type: 'button', on: { click: () => { almaBox.hidden = true; } } }, 'Chiudi'), writeBtn));
  async function draftWithAlma() {
    if (!ind.value.trim() && !e) { ind.focus(); toast('Scrivi almeno un punto: Alma parte dalle tue indicazioni', 'err'); return; }
    writeBtn.disabled = true; almaBox.classList.add('busy');
    try {
      const body = { indicazioni: ind.value, lingua: !e && lingua === 'auto' ? 'it' : lingua, stile, tutti: mode === 'tutti' };
      const x = e ? await post(`/api/crm/posta/${encodeURIComponent(e.id)}/bozza`, body) : await post('/api/crm/posta/nuova/bozza', { ...body, a: people.a, oggetto: subjectIn.value });
      undo = editor.innerHTML; undoBtn.hidden = false;
      editor.innerHTML = textToHtml(x.text);
      spent += x.eur;
      costLine.textContent = x.ai ? `Scritta da Alma · costata ${cents(spent) || 'meno di 0,01 cent'}` : 'senza AI (regole semplici)';
      fill(toneLine, x.tone?.n ? [h('span', `Col tuo tono: dalle tue ultime ${x.tone.n} email a ${firstName(x.target?.name) || 'questa persona'}`), x.tone.chips.map(c => h('span.pm-chip', c))] : h('span', 'Non le hai ancora scritto: tono cortese.'));
      saveLocal();
      editor.focus();
    } catch (err) { toast(err?.message || 'Bozza non riuscita', 'err', 8000); }
    writeBtn.disabled = false; almaBox.classList.remove('busy');
  }

  // ── barra in alto ──
  const status = h('small.ps-status');
  const langBox = h('span.ps-lang');
  const drawLang = () => fill(langBox, [['it', 'IT'], ['en', 'EN']].map(([k, l]) => h('button', { type: 'button', class: (lingua === k || (lingua === 'auto' && k === 'it' && !e)) ? 'on' : '', title: k === 'it' ? 'Alma scrive in italiano' : 'Alma scrive in inglese', on: { click: () => { lingua = k; drawLang(); fill(almaBox.querySelector('.ps-alma-o'), chipRow('Lingua', e ? [['it', 'Italiano'], ['en', 'English'], ['auto', 'come la conversazione']] : [['it', 'Italiano'], ['en', 'English']], () => lingua, k2 => { lingua = k2; }), chipRow('Tono', [['', 'il tuo'], ['formale', 'più formale'], ['breve', 'più breve']], () => stile, k2 => { stile = k2; })); } } }, l)));
  drawLang();
  const sendLabel = mode === 'inoltra' ? 'Inoltra' : mode === 'tutti' ? 'Invia a tutti' : 'Invia';
  const sendBtn = h('button.btn.btn-primary', { type: 'button', title: `${sendLabel} (Ctrl+Invio)`, on: { click: () => send(false) } }, ic(mode === 'inoltra' ? 'forward' : 'send', 14), sendLabel);
  const top = h('div.ps-top',
    sendBtn,
    h('button.btn', { type: 'button', title: 'Salva tra le bozze di Outlook', on: { click: () => send(true) } }, 'Salva bozza'),
    h('button.btn', { type: 'button', on: { click: () => picker.click() } }, ic('paperclip', 14), 'Allega'),
    h('span.ps-div'),
    h('button.btn.pm-aib', { type: 'button', on: { click: () => { almaBox.hidden = !almaBox.hidden; if (!almaBox.hidden) ind.focus(); } } }, ic('sparkles', 14), 'Scrivi con Alma'),
    langBox,
    h('span.pm-sep'),
    status,
    h('button.btn', { type: 'button', title: 'Scarta questa email', on: { click: () => discard() } }, 'Scarta'));

  const wrap = h('section.ps',
    top,
    h('div.ps-title', mode === 'nuova' ? 'Nuova email' : mode === 'inoltra' ? 'Inoltra' : mode === 'tutti' ? 'Rispondi a tutti' : `Rispondi a ${firstName(target?.name) || target?.address || ''}`),
    rowsBox,
    crmBar ? h('div.ps-crm', crmBar()) : null,
    almaBox,
    h('div.ps-fmts', fmt('bold', 'Grassetto', h('b', 'G')), fmt('italic', 'Corsivo', h('i', 'C')), fmt('underline', 'Sottolineato', h('u', 'S')), fmt('insertUnorderedList', 'Elenco puntato', '• ≡'), fmt('insertOrderedList', 'Elenco numerato', '1. ≡'),
      h('small.cv-muted', 'Scrivi @ per aggiungere una persona · Ctrl+Invio per inviare')),
    editor,
    mention,
    sigBox,
    quote,
    attBox, picker);

  // ── bozza tenuta in questo browser ──
  function saveLocal() {
    try { localStorage.setItem(key, JSON.stringify({ html: editor.innerHTML, a: people.a, cc: people.cc, ccn: people.ccn, subject: subjectIn.value, firmaOn, at: Date.now() })); status.textContent = `Bozza tenuta ${new Date().toTimeString().slice(0, 5)}`; } catch { /* niente */ }
  }
  const clearLocal = () => { try { localStorage.removeItem(key); } catch { /* niente */ } };
  try {
    const old = JSON.parse(localStorage.getItem(key) || 'null');
    if (old && Date.now() - old.at < 7 * 864e5 && (old.html || '').replace(/<[^>]+>/g, '').trim()) {
      editor.innerHTML = old.html; Object.assign(people, { a: old.a || people.a, cc: old.cc || [], ccn: old.ccn || [] });
      showCc = people.cc.length > 0; showCcn = people.ccn.length > 0; subjectIn.value = old.subject || subjectIn.value; firmaOn = old.firmaOn !== false;
      setTimeout(() => toast('Ho ripreso la bozza che avevi lasciato'), 100);
    }
  } catch { /* niente */ }

  async function send(draft) {
    if (sending) return;
    if (!draft && !people.a.length) { toast('Scegli almeno un destinatario', 'err'); rowsBox.querySelector('.pm-rcpt-i')?.focus(); return; }
    if (!draft && mode === 'nuova' && !subjectIn.value.trim()) { toast('Scrivi l\'oggetto', 'err'); subjectIn.focus(); return; }
    const html = editor.innerHTML;
    if (!draft && mode !== 'inoltra' && !editor.textContent.trim()) { toast('Scrivi il testo', 'err'); editor.focus(); return; }
    sending = true; wrap.classList.add('busy');
    try {
      const body = { a: people.a, cc: people.cc, ccn: people.ccn, oggetto: subjectIn.value.trim(), html, firma: firmaOn, bozza: draft, allegati: files.map(f => ({ name: f.name, type: f.type, data: f.data })) };
      const x = e ? await post(`/api/crm/posta/${encodeURIComponent(e.id)}/componi`, { ...body, modo: mode, togli: [...drop] }) : await post('/api/crm/posta/nuova', body);
      clearLocal();
      const who = x.to.length === 1 ? (x.to[0].name || x.to[0].address) : `${x.to.length} persone`;
      toast(draft ? 'Salvata tra le bozze di Outlook' : mode === 'inoltra' ? `Inoltrata a ${who}` : mode === 'nuova' ? `Email mandata a ${who}` : `Risposta inviata a ${who}`);
      if (draft && x.web_link) window.open(x.web_link, '_blank', 'noopener');
      onSent?.(); onClose?.();
    } catch (err) { toast(err?.message || 'Non è partita', 'err', 8000); }
    sending = false; wrap.classList.remove('busy');
  }
  async function discard() {
    if (editor.textContent.trim() && !await confirmDialog('Scartare questa email? Il testo si perde.', { ok: 'Scarta', danger: true })) return;
    clearLocal(); onClose?.();
  }

  drawRows();
  drawAtts();
  fill(box, wrap);
  (mode === 'nuova' ? rowsBox.querySelector('.pm-rcpt-i') : mode === 'inoltra' ? rowsBox.querySelector('.pm-rcpt-i') : editor).focus();
  return { wrap };
}
