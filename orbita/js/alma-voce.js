// Alma · modalità voce in tempo reale (18/11/2026, canvas «v5 · Alma da ogni pagina, telefono e voce», tavola del
// telefono scuro «Modalità voce»; porting della voce di Bacco, CAN-176/202). Sfera arancione che ascolta, pensa e parla,
// sottotitoli dei due lati, numeri controllati dal server con la loro fonte, scheda da confermare (tocco o «sì» detto),
// microfono e chiusura. Il server crea la chiamata (/voce/sessione), si collega a OpenAI Realtime con la chiave
// temporanea (/voce/collega: il browser non la vede), misura tempo e costo (battito ogni 15 s) ed esegue ricerche e
// proposte con la tua sessione (/voce/strumento). Una proposta si salva solo con un «sì» controllato o con Conferma.
import { icon } from './icons.js';

const API = '/api/alma';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (n, size = 20) => icon(n, { size }).outerHTML; // le icone come testo dentro i modelli HTML
async function post(path, body) {
  const res = await fetch(API + path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Alma': '1' }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Errore ${res.status}`), { status: res.status });
  return data;
}
const MODES = {
  connect: { status: 'Mi preparo', doing: 'Consenti il microfono se il browser lo chiede', main: 'Attendi', orb: '' },
  ascolto: { status: 'Ti ascolto', doing: 'Parla pure: quando ti fermi rispondo', main: 'Spegni il microfono', orb: 'listen' },
  penso: { status: 'Sto cercando', doing: '', main: 'Interrompi', orb: 'think' },
  parla: { status: 'Alma sta rispondendo…', doing: 'Tocca per interrompere', main: 'Interrompi', orb: 'speak' },
  muto: { status: 'Microfono spento', doing: 'Alma non ti sente', main: 'Riaccendi', orb: '' },
  fine: { status: 'Chiamata chiusa', doing: '', main: 'Richiama Alma', orb: '' },
  error: { status: 'Non riesco a collegarmi', doing: '', main: 'Riprova', orb: '' },
};
const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const voiceSupported = () => !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// opts: { chatId (conversazione scritta da cui si parte, per il contesto), onClose(convId) }
export function openVoice(opts = {}) {
  if (document.getElementById('av-root')) return null;
  const root = document.createElement('div');
  root.id = 'av-root'; root.className = 'av';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Parla con Alma');
  root.innerHTML = `<div class="av-col">
    <header class="av-head">
      <button type="button" class="av-ib" data-x aria-label="Chiudi la voce">${ic('x')}</button>
      <div class="av-title"><b>Modalità voce</b><span data-time>0:00</span></div>
      <button type="button" class="av-ib" data-spk aria-label="Silenzia la voce di Alma" aria-pressed="false">${ic('volume-2')}</button>
    </header>
    <div class="av-orbwrap"><div class="av-orb" data-orb><i></i></div></div>
    <div class="av-state"><span class="av-status" data-status></span><small class="av-doing" data-doing></small></div>
    <div class="av-subs" data-subs>
      <div class="av-lines" data-lines aria-live="polite" aria-label="Sottotitoli"></div>
      <section class="av-nums" data-nums hidden></section>
      <section class="av-card" data-card hidden></section>
      <section class="av-end" data-end role="status" hidden></section>
    </div>
    <footer class="av-foot">
      <button type="button" class="av-round" data-main>${ic('mic', 22)}</button>
      <button type="button" class="av-round av-stop" data-close aria-label="Chiudi la chiamata">${ic('x', 22)}</button>
    </footer>
    <small class="av-main-l" data-main-l></small></div>`;
  document.body.appendChild(root);
  document.body.classList.add('av-open');
  const $ = s => root.querySelector(s);
  const st = { mode: 'connect', conv: null, pc: null, dc: null, mic: null, audio: null, remote: null, ctx: null, raf: null, t0: 0, tick: null, beat: null, maxT: null, backT: null,
    micOn: true, spkOn: true, handled: new Set(), closed: false, ended: false, finished: false, maxSec: 900, lines: [], cur: { user: null, assistant: null }, heard: null };

  function show(mode, doing) {
    st.mode = mode;
    if (st.mic) st.mic.getTracks().forEach(t => { t.enabled = st.micOn && mode !== 'parla'; }); // mentre Alma parla non si interrompe da sola
    const m = MODES[mode] || MODES.ascolto;
    root.dataset.mode = mode;
    $('[data-orb]').dataset.state = m.orb;
    $('[data-status]').textContent = m.status;
    $('[data-doing]').textContent = doing !== undefined ? doing : m.doing;
    const main = $('[data-main]');
    main.innerHTML = mode === 'penso' || mode === 'parla' ? ic('square', 22) : mode === 'muto' || (mode === 'ascolto' && !st.micOn) ? ic('mic-off', 22) : ic('mic', 22);
    main.setAttribute('aria-label', m.main);
    main.disabled = mode === 'connect';
    $('[data-main-l]').textContent = m.main;
  }
  const fail = msg => show('error', msg);
  function draw() {
    const box = $('[data-lines]');
    box.innerHTML = st.lines.slice(-20).map((l, i, arr) => `<div class="av-l av-${l.role === 'user' ? 'u' : 'a'}${i === arr.length - 1 ? ' av-last' : ''}"><small>${l.role === 'user' ? 'Tu' : 'Alma'}</small><p>${esc(l.text)}</p></div>`).join('');
    const subs = $('[data-subs]'); subs.scrollTop = subs.scrollHeight;
  }
  function say(role, text, done) {
    let l = st.cur[role];
    if (!l) { l = { role, text: '' }; st.lines.push(l); st.cur[role] = l; }
    l.text = String(text || '').replace(/[*_#`]/g, '');
    if (done) st.cur[role] = null;
    draw();
  }
  const add = (role, delta) => say(role, ((st.cur[role] && st.cur[role].text) || '') + (delta || ''), false);
  function numbers(list, fonti) {
    const box = $('[data-nums]');
    const ok = (list || []).filter(n => n && n.testo);
    if (!ok.length) { box.hidden = true; box.innerHTML = ''; return; }
    const src = (fonti || [])[0];
    box.hidden = false;
    box.innerHTML = `<div class="av-nums-g">${ok.map(n => `<div class="av-num${n.ok ? '' : ' av-unver'}"><b>${esc(n.testo)}</b><small>${esc(n.etichetta)}${n.ok ? '' : ' · non verificato'}</small></div>`).join('')}</div>
      ${src ? `<small class="av-src">${ic('receipt', 13)} Da: ${esc([src.titolo, src.periodo].filter(Boolean).join(', '))}</small>` : ''}`;
  }
  // Scheda da confermare: tutte le proposte della risposta; Conferma/Annulla le decidono insieme.
  function card(list) {
    const c = $('[data-card]');
    const rows = (list || []).filter(Boolean);
    if (!rows.length) { c.hidden = true; c.innerHTML = ''; return; }
    const open = rows.some(x => x.status === 'proposta' && !x.choices);
    const done = rows.find(x => x.status === 'fatta');
    c.hidden = false;
    c.innerHTML = rows.map(p => `<div class="av-prop"><div class="av-prop-h"><span class="av-badge ${p.status === 'fatta' ? 'ok' : ''}">${p.status === 'fatta' ? 'Salvato' : p.status === 'annullata' ? 'Annullata' : p.status === 'errore' ? 'Non salvato' : 'Da confermare'}</span><b>${esc(p.title)}</b></div>
      <small>${esc((p.fields || []).filter(([k]) => !['Ticket', 'Nota', 'Persona'].includes(k)).map(([k, v]) => `${k}: ${v}`).join(' · '))}</small>${p.error ? `<small class="av-bad">${esc(p.error)}</small>` : ''}</div>`).join('')
      + (open ? `<div class="av-act"><button type="button" class="btn btn-sm btn-primary" data-ok="${rows[0].id}">Conferma</button><button type="button" class="btn btn-sm" data-no="${rows[0].id}">Annulla</button></div>
        <small class="av-note">${st.heard ? `Ho sentito «${esc(st.heard)}»: non salvo finché non tocchi Conferma o dici solo «sì».` : '…oppure rispondi «sì» a voce. Senza un sì chiaro non salvo.'}</small>` : '')
      + (done && !open ? '<small class="av-note av-ok">Salvato. Lo ritrovi anche nella chat.</small>' : '');
  }
  const send = ev => { if (st.dc && st.dc.readyState === 'open') st.dc.send(JSON.stringify(ev)); };
  $('[data-card]').addEventListener('click', async e => {
    const b = e.target.closest('[data-ok],[data-no]');
    if (!b) return;
    const ok = !!b.dataset.ok;
    b.disabled = true;
    try {
      const r = await post(`/azioni/${b.dataset.ok || b.dataset.no}/${ok ? 'conferma' : 'annulla'}`, {});
      st.heard = null;
      card(r.proposals);
      send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `[Dallo schermo] Ho ${ok ? 'confermato' : 'annullato'} la proposta. Esito: ${r.reply}. Dimmelo in una frase.` }] } });
      send({ type: 'response.create' });
    } catch (err) { b.disabled = false; show(st.mode, err.message); }
  });
  // La sfera segue il volume (microfono mentre ascolta, voce di Alma mentre parla).
  function meters() {
    try {
      st.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const mk = stream => { const an = st.ctx.createAnalyser(); an.fftSize = 256; st.ctx.createMediaStreamSource(stream).connect(an); return an; };
      const anIn = st.mic ? mk(st.mic) : null;
      let anOut = null;
      const orb = $('[data-orb]');
      const data = new Uint8Array(128);
      const tick = () => {
        if (!anOut && st.remote) anOut = mk(st.remote);
        const an = st.mode === 'parla' ? anOut : st.mode === 'ascolto' && st.micOn ? anIn : null;
        let avg = 0;
        if (an) { an.getByteFrequencyData(data); for (let i = 2; i < 40; i++) avg += data[i] / 255; avg /= 38; }
        orb.style.setProperty('--vol', String(Math.min(1, avg * 2.2)));
        st.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* senza animazione del volume */ }
  }
  async function runTools(calls) {
    calls = calls.filter(c => c.call_id && !st.handled.has(c.call_id));
    if (!calls.length) return;
    calls.forEach(c => st.handled.add(c.call_id));
    if (calls.some(c => c.name !== 'mostra_numeri')) show('penso', 'Un attimo che guardo…');
    const gruppo = `r${Date.now()}`;
    const outs = await Promise.all(calls.map(async c => {
      try {
        const r = await post('/voce/strumento', { conversation_id: st.conv, name: c.name, arguments: c.arguments, gruppo });
        if (r.voce && r.voce.closed) serverClosed(r.voce);
        if (r.label) $('[data-doing]').textContent = r.label;
        if (r.yes_missing) { try { st.heard = (JSON.parse(r.output).error.match(/ho sentito: «([^»]*)»/) || [])[1] || null; } catch { st.heard = null; } }
        else if (c.name === 'conferma_proposta') st.heard = null;
        if ((r.proposals || []).length) card(r.proposals);
        if (r.numeri) numbers(r.numeri, r.fonti);
        return { c, out: r.output, silent: !!r.silent };
      } catch (e) { return { c, out: JSON.stringify({ error: e.message }) }; }
    }));
    for (const { c, out } of outs) send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: c.call_id, output: out } });
    if (outs.some(o => !o.silent)) send({ type: 'response.create' }); else backToListen();
  }
  function backToListen() {
    clearTimeout(st.backT);
    const text = (st.lines[st.lines.length - 1] || {}).text || '';
    st.backT = setTimeout(() => { if (st.mode === 'parla' || st.mode === 'penso') show(st.micOn ? 'ascolto' : 'muto'); }, Math.max(1500, text.length * 70));
  }
  function onEvent(ev) {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        if (st.mode !== 'ascolto') show('ascolto');
        if (!st.cur.user) { say('user', '…'); st.cur.user.text = ''; }
        numbers([]);
        break;
      case 'input_audio_buffer.speech_stopped': show('penso', ''); break;
      case 'conversation.item.input_audio_transcription.delta': add('user', ev.delta); break;
      case 'conversation.item.input_audio_transcription.completed': {
        const t = String(ev.transcript || '').trim();
        if (t) { say('user', t, true); post('/voce/trascritto', { conversation_id: st.conv, role: 'user', text: t }).catch(() => {}); }
        else if (st.cur.user) { st.lines = st.lines.filter(l => l !== st.cur.user); st.cur.user = null; draw(); }
        break;
      }
      case 'response.output_audio_transcript.delta': if (st.mode !== 'parla') show('parla'); add('assistant', ev.delta); break;
      case 'response.output_audio_transcript.done': {
        const t = String(ev.transcript || (st.cur.assistant && st.cur.assistant.text) || '').trim();
        say('assistant', t, true);
        if (t) post('/voce/trascritto', { conversation_id: st.conv, role: 'assistant', text: t }).catch(() => {});
        break;
      }
      case 'output_audio_buffer.started': clearTimeout(st.backT); show('parla'); break;
      case 'output_audio_buffer.stopped': case 'output_audio_buffer.cleared': if (st.mode === 'parla') show(st.micOn ? 'ascolto' : 'muto'); break;
      case 'response.done': {
        const calls = ((ev.response && ev.response.output) || []).filter(it => it.type === 'function_call');
        if (calls.length) runTools(calls); else backToListen();
        break;
      }
      case 'error': {
        const code = ev.error && ev.error.code;
        if (code === 'conversation_already_has_active_response' || code === 'response_cancel_not_active') break;
        show(st.mode, (ev.error && ev.error.message) || 'Qualcosa non va: riprova.');
        break;
      }
      default: break;
    }
  }
  function clockTick() {
    const s = st.t0 ? Math.min(st.maxSec, (Date.now() - st.t0) / 1000) : 0;
    const left = st.maxSec - s;
    $('[data-time]').textContent = st.ended ? 'massimo raggiunto' : left <= 60 ? `${clock(s)} · manca 1 minuto` : `${clock(s)} di ${clock(st.maxSec)}`;
  }
  function serverClosed(v) {
    if (st.ended || st.closed) return;
    st.ended = true;
    hangUp();
    const min = Math.max(1, Math.round((v && v.seconds ? v.seconds : st.maxSec) / 60));
    const end = $('[data-end]');
    end.hidden = false;
    end.innerHTML = v && v.reason === 'limite'
      ? `<b>Abbiamo parlato ${min} ${min === 1 ? 'minuto' : 'minuti'}</b><span>È il massimo per una chiamata: ho chiuso io. La conversazione è nella chat.</span>`
      : '<b>La chiamata è finita</b><span>La conversazione è nella chat: puoi rileggerla o richiamarmi.</span>';
    show('fine');
    clockTick();
  }
  async function start() {
    show('connect');
    say('assistant', 'Un attimo, mi collego…', true);
    let sess;
    try { sess = await post('/voce/sessione', opts.chatId ? { chat_id: opts.chatId } : {}); } catch (e) { return fail(e.message); }
    if (st.closed) { post('/voce/fine', { conversation_id: sess.conversation_id }).catch(() => {}); return; }
    st.conv = sess.conversation_id; st.maxSec = sess.max_seconds || 900;
    clockTick();
    try { st.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); } catch { return fail('Il microfono non è permesso: attivalo nelle impostazioni del browser per questo sito.'); }
    if (st.closed) { st.mic.getTracks().forEach(t => t.stop()); return; }
    const pc = st.pc = new RTCPeerConnection();
    st.audio = new Audio(); st.audio.autoplay = true; st.audio.muted = !st.spkOn;
    pc.ontrack = e => { st.remote = e.streams[0]; st.audio.srcObject = e.streams[0]; st.audio.play().catch(() => {}); };
    pc.addTrack(st.mic.getTracks()[0], st.mic);
    const dc = st.dc = pc.createDataChannel('oai-events');
    dc.addEventListener('message', m => { try { onEvent(JSON.parse(m.data)); } catch { /* evento non leggibile */ } });
    dc.addEventListener('open', () => {
      st.lines = []; st.cur = { user: null, assistant: null }; draw();
      show('ascolto');
      send({ type: 'response.create', response: { instructions: 'In italiano: saluta in una frase breve e cordiale da Alma e chiedi cosa serve. Non presentarti a lungo.' } });
      st.t0 = Date.now();
      st.tick = setInterval(clockTick, 500);
      st.beat = setInterval(() => { post('/voce/battito', { conversation_id: st.conv }).then(v => { if (v.closed) serverClosed(v); }).catch(() => {}); }, sess.beat_ms || 15000);
      st.maxT = setTimeout(() => serverClosed({ reason: 'limite', seconds: st.maxSec }), st.maxSec * 1000 + 2000);
    });
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const ans = await post('/voce/collega', { conversation_id: st.conv, sdp: offer.sdp });
      await pc.setRemoteDescription({ type: 'answer', sdp: ans.sdp });
    } catch (e) { return fail(`Non riesco a collegarmi alla voce: ${e.message}`); }
    pc.addEventListener('connectionstatechange', () => { if (['failed', 'disconnected'].includes(pc.connectionState) && !st.closed && !st.ended) serverClosed({ reason: 'rete' }); });
    meters();
  }
  function hangUp() {
    clearInterval(st.tick); clearInterval(st.beat); clearTimeout(st.maxT); clearTimeout(st.backT); if (st.raf) cancelAnimationFrame(st.raf); st.raf = null;
    try { st.dc && st.dc.close(); } catch { /* chiuso */ }
    try { st.pc && st.pc.close(); } catch { /* chiuso */ }
    st.dc = null; st.pc = null;
    if (st.mic) { st.mic.getTracks().forEach(t => t.stop()); st.mic = null; }
    if (st.audio) { st.audio.pause(); st.audio.srcObject = null; }
    if (st.ctx) { st.ctx.close().catch(() => {}); st.ctx = null; }
    if (st.conv && !st.finished) { st.finished = true; post('/voce/fine', { conversation_id: st.conv }).catch(() => {}); }
  }
  function close() {
    if (st.closed) return;
    st.closed = true;
    hangUp();
    root.remove();
    document.body.classList.remove('av-open');
    document.removeEventListener('keydown', onKey);
    if (opts.onClose) opts.onClose(st.lines.length ? st.conv : null);
  }
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('[data-x]').addEventListener('click', close);
  $('[data-close]').addEventListener('click', close);
  $('[data-main]').addEventListener('click', () => {
    if (st.mode === 'fine' || st.mode === 'error') { close(); openVoice(opts); return; }
    if (st.mode === 'parla' || st.mode === 'penso') { send({ type: 'response.cancel' }); send({ type: 'output_audio_buffer.clear' }); show(st.micOn ? 'ascolto' : 'muto'); return; }
    st.micOn = !st.micOn;
    if (st.mic) st.mic.getTracks().forEach(t => { t.enabled = st.micOn; });
    show(st.micOn ? 'ascolto' : 'muto');
  });
  $('[data-spk]').addEventListener('click', e => {
    st.spkOn = !st.spkOn;
    if (st.audio) st.audio.muted = !st.spkOn;
    e.currentTarget.innerHTML = st.spkOn ? ic('volume-2') : ic('volume-x');
    e.currentTarget.setAttribute('aria-pressed', String(!st.spkOn));
  });
  if (/^(localhost|127\.)/.test(location.hostname)) window.__av = { st, onEvent, serverClosed, card, numbers, show };
  start();
  return { close };
}
