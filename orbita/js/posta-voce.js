// Posta in macchina (ALM2-57, canvas «Posta a voce in macchina» approvato da Dante il 22/11/2026): solo per Dante.
// Avvio con le email da persone → chiamata con la voce di Alma (OpenAI Realtime, collegata dal server) che legge chi
// scrive e cosa chiede, scrive la risposta dal dettato e la manda solo dopo il «manda» (controllato dal server) o un
// tocco su Manda. Schermo scuro, scritte grandi, tre pulsanti grossi; lo schermo resta acceso finché la chiamata è aperta.
import { h, fill } from './ui.js';
import { get, post } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';

const API = '/api/posta-voce';
const ic = (n, size = 22) => icon(n, { size });
const when = iso => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' });
};
const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const STATUS = { connect: 'Mi collego…', ascolto: 'Ti ascolto', penso: 'Un attimo…', parla: 'Alma parla', fine: 'Giro finito', error: 'Non riesco a collegarmi' };

export async function postaVocePage(view) {
  if (!store.me.posta_voce) { fill(view, h('div.card.empty', h('p', 'Pagina non trovata.'))); return null; }
  const root = h('div.pvc', { role: 'region', 'aria-label': 'Posta in macchina' });
  fill(view, root);
  document.body.classList.add('pvc-open');
  let call = null;
  const cleanup = () => { call?.hangUp(true); document.body.classList.remove('pvc-open'); };

  // ── 1 · Avvio ──
  async function startScreen() {
    fill(root, h('div.pvc-col', h('p.pvc-muted', 'Cerco le email…')));
    let q;
    try { q = await get(`${API}/coda`); } catch (e) { fill(root, h('div.pvc-col', back(), h('p.pvc-muted', e.message))); return; }
    const list = q.email || [];
    fill(root, h('div.pvc-col',
      h('div.pvc-top', back(), h('span.pvc-eyebrow', 'Solo per te')),
      h('div.pvc-hello', h('h1', 'Posta ', h('b', 'in macchina')),
        h('p', list.length ? `${list.length} ${list.length === 1 ? 'email' : 'email'} da persone, non lette, dalla più recente.` : 'Nessuna email da persone da leggere.')),
      h('div.pvc-list', list.slice(0, 3).map(e => h('div.pvc-row', h('span.pvc-av', initials(e.da)),
        h('div.pvc-row-t', h('strong', e.da), h('small', e.oggetto)), h('span.pvc-time', when(e.quando)))),
      list.length > 3 || q.tolte ? h('p.pvc-muted', [list.length > 3 ? `e altre ${list.length - 3}` : '', q.tolte ? `tolte ${q.tolte} newsletter, avvisi automatici e già risposte` : ''].filter(Boolean).join(' · ')) : null),
      h('div.pvc-grow'),
      h('div.pvc-start',
        h('button.pvc-mic', { type: 'button', 'aria-label': list.length ? 'Inizia il giro della posta' : 'Detta un\'email nuova', disabled: q.voce ? null : true, on: { click: () => { call = startCall(list.length); } } }, ic('mic', 52)),
        h('strong', list.length ? 'Inizia' : 'Scrivi un\'email'),
        h('small.pvc-muted', q.voce ? (list.length ? 'Un tocco e poi parli. Puoi anche dire «scrivi a …» per un\'email nuova. Lo schermo resta acceso finché non dici «stop».' : 'Un tocco e poi di\' «scrivi a …» con quello che vuoi dire.') : 'La voce non è attiva: manca la chiave OpenAI sul server.'))));
  }
  const back = () => h('a.pvc-ib', { href: '#/benvenuto', 'aria-label': 'Indietro' }, ic('chevron-left'));

  // ── 4 · Fine del giro ──
  function endScreen(r, msg) {
    const done = (r && r.inviate) || [], skipped = (r && r.saltate) || [];
    fill(root, h('div.pvc-col',
      h('div.pvc-hello', h('h1', 'Giro ', h('b', 'finito')),
        h('p', msg || `${done.length} ${done.length === 1 ? 'risposta inviata' : 'risposte inviate'}${skipped.length ? ` · ${skipped.length} ${skipped.length === 1 ? 'saltata, resta non letta' : 'saltate, restano non lette'}` : ''}.`)),
      h('div.pvc-list',
        done.map(e => h('div.pvc-row', h('span.pvc-ok', ic('check', 22)), h('div.pvc-row-t', h('strong', e.da), h('small', e.succo || e.oggetto)))),
        skipped.map(e => h('a.pvc-row', { href: e.web_link || '#', target: '_blank', rel: 'noopener' }, h('span.pvc-skip', ic('skip-forward', 22)), h('div.pvc-row-t', h('strong', e.da), h('small', `Saltata: ${e.oggetto}`))))),
      done.length ? h('p.pvc-muted', 'Le risposte sono in Posta inviata di Outlook.') : null,
      h('div.pvc-grow'),
      h('div.pvc-grid2',
        h('button.pvc-btn', { type: 'button', on: { click: () => startScreen() } }, 'Ricomincia'),
        h('a.pvc-btn', { href: '#/benvenuto' }, 'Chiudi'))));
  }

  // ── 2 e 3 · La chiamata ──
  function startCall(total) {
    const st = { mode: 'connect', pc: null, dc: null, mic: null, audio: null, wake: null, email: null, draft: null, sub: '', handled: new Set(), closed: false, total, endT: null, closing: false };
    const els = {};
    function frame() {
      els.count = h('span.pvc-count');
      els.dots = h('div.pvc-dots', { 'aria-hidden': 'true' });
      els.card = h('div.pvc-email');
      els.draft = h('div.pvc-draft', { hidden: true });
      els.status = h('strong.pvc-status');
      els.sub = h('span.pvc-sub', { 'aria-live': 'polite' });
      els.orb = h('div.pvc-orb', h('span', ic('mic', 38)));
      els.btns = h('div.pvc-grid3');
      fill(root, h('div.pvc-col',
        h('div.pvc-top', els.count, els.dots),
        els.card, els.draft,
        h('div.pvc-mid', els.orb, els.status, els.sub),
        els.btns));
    }
    const btn = (label, name, fn, primary) => h(`button.pvc-act${primary ? '.pvc-primary' : ''}`, { type: 'button', on: { click: fn } }, ic(name), label);
    function render() {
      const e = st.email;
      els.count.textContent = e && e.numero ? `Email ${e.numero} di ${e.totale}` : st.total ? `${st.total} email` : '';
      fill(els.dots, Array.from({ length: Math.min(e?.totale || st.total || 0, 12) }, (_, i) => h('span', { class: e && i < e.numero ? 'on' : '' })));
      fill(els.card, e && e.da ? [h('span.pvc-eyebrow', 'Da'), h('h1.pvc-from', e.da), h('span.pvc-meta', [e.azienda, e.quando ? when(e.quando) : ''].filter(Boolean).join(' · ')),
        st.draft ? null : h('div.pvc-ask', h('span.pvc-eyebrow.mut', 'Cosa chiede'), h('p', e.chiede))] : []);
      const d = st.draft;
      if (d && d.nuova) fill(els.card, h('span.pvc-eyebrow', st.email && st.email.da ? `Email nuova · poi torno a ${st.email.da}` : 'Email nuova'));
      else if (d) fill(els.card, h('span.pvc-eyebrow', `Risposta a ${e && e.da ? e.da : ''}${e && e.oggetto ? ` · Re: ${e.oggetto}` : ''}`));
      else if (!e || !e.da) fill(els.card, st.finite ? [h('h1.pvc-from', 'Finite'), h('span.pvc-meta', 'Puoi dettare un\'email nuova («scrivi a …») o dire «stop».')] : []);
      els.draft.hidden = !d;
      if (d) {
        const who = (label, list) => (list && list.length ? h('div.pvc-who', h('span', label), h('strong', list.join(', '))) : null);
        fill(els.draft,
          h('div.pvc-whos', who('A', d.a), who('Cc', d.copia), d.nuova && d.oggetto ? who('Oggetto', [d.oggetto]) : null),
          h('div.pvc-text', h('span.pvc-eyebrow', icon('volume-2', { size: 14 }), st.mode === 'parla' ? ' Alma te la sta leggendo' : ' Il testo che parte'), h('p', d.testo)),
          h('p.pvc-mando', 'Mando?'));
      }
      root.dataset.mode = st.mode;
      els.status.textContent = STATUS[st.mode] || '';
      els.sub.textContent = st.sub ? `«${st.sub}»` : d ? 'Di\' «manda», «cambia …», «metti in copia …»' : '';
      fill(els.btns, d
        ? [btn('Cambia', 'pencil', change), d.nuova ? btn('Lascia', 'x', leave) : btn('Salta', 'skip-forward', skip), btn('Manda', 'send', sendNow, true)]
        : st.email && st.email.da
          ? [btn('Leggila', 'align-left', readAll), btn('Salta', 'skip-forward', skip), btn('Stop', 'square', () => stop())]
          : [btn('Stop', 'square', () => stop())]);
      els.btns.className = d || (st.email && st.email.da) ? 'pvc-grid3' : 'pvc-grid1';
    }
    function show(mode, sub) {
      st.mode = mode;
      if (sub !== undefined) st.sub = sub;
      if (st.mic) st.mic.getTracks().forEach(t => { t.enabled = mode !== 'parla'; }); // mentre Alma parla il microfono non sente l'altoparlante della macchina
      render();
    }
    const send = ev => { if (st.dc && st.dc.readyState === 'open') st.dc.send(JSON.stringify(ev)); };
    const tell = text => { send({ type: 'response.cancel' }); send({ type: 'output_audio_buffer.clear' }); send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }); send({ type: 'response.create' }); };
    function apply(out, stato) {
      if (stato) st.draft = stato.bozza;
      const e = out && (out.prossima || out.torna_a || (out.da ? out : null));
      if (e && e.da) { st.email = e; st.finite = false; if (!stato) st.draft = null; }
      if (e && e.finite) { st.email = null; st.finite = true; } // finite le email: si può ancora scrivere a qualcuno, si chiude con «stop»
      render();
    }
    async function runTools(calls) {
      calls = calls.filter(c => c.call_id && !st.handled.has(c.call_id));
      if (!calls.length) return;
      calls.forEach(c => st.handled.add(c.call_id));
      show('penso', '');
      for (const c of calls) {
        let r;
        try { r = await post(`${API}/strumento`, { name: c.name, arguments: c.arguments }); } catch (e) { r = { output: JSON.stringify({ error: e.message }) }; }
        let out = {};
        try { out = JSON.parse(r.output); } catch { /* niente */ }
        apply(out, r.stato);
        if (r.chiudi) st.closing = true;
        send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: c.call_id, output: r.output } });
      }
      send({ type: 'response.create' });
    }
    function onEvent(ev) {
      switch (ev.type) {
        case 'input_audio_buffer.speech_started': show('ascolto', ''); break;
        case 'input_audio_buffer.speech_stopped': show('penso'); break;
        case 'conversation.item.input_audio_transcription.completed': {
          const t = String(ev.transcript || '').trim();
          if (t) { st.sub = t; render(); post(`${API}/trascritto`, { role: 'user', text: t }).catch(() => {}); }
          break;
        }
        case 'response.output_audio_transcript.done': {
          const t = String(ev.transcript || '').trim();
          if (t) post(`${API}/trascritto`, { role: 'assistant', text: t }).catch(() => {});
          break;
        }
        case 'output_audio_buffer.started': show('parla', ''); break;
        case 'output_audio_buffer.stopped': case 'output_audio_buffer.cleared':
          if (st.closing) { clearTimeout(st.endT); st.endT = setTimeout(() => stop(), 600); } else if (st.mode === 'parla') show('ascolto');
          break;
        case 'response.done': {
          const calls = ((ev.response && ev.response.output) || []).filter(it => it.type === 'function_call');
          if (calls.length) runTools(calls);
          else if (st.closing) { clearTimeout(st.endT); st.endT = setTimeout(() => stop(), 8000); } // se l'audio non dice quando ha finito
          break;
        }
        case 'error': {
          const code = ev.error && ev.error.code;
          if (code === 'conversation_already_has_active_response' || code === 'response_cancel_not_active') break;
          st.sub = (ev.error && ev.error.message) || ''; render();
          break;
        }
        default: break;
      }
    }
    // tocchi
    async function skip() {
      try { const r = await post(`${API}/salta`, {}); apply({ prossima: r.prossima }, r.stato); tell(`[Dallo schermo] Ho saltato l'email. ${r.prossima.finite ? 'Non ce ne sono altre: di\' «Finite. Vuoi scrivere a qualcuno?» e aspetta.' : `Prossima: ${JSON.stringify(r.prossima)}. Presentala come al punto 2.`}`); } catch (e) { st.sub = e.message; render(); }
    }
    async function sendNow() {
      try {
        const r = await post(`${API}/invia`, {});
        const e = r.prossima || r.torna_a;
        apply(r, r.stato);
        tell(`[Dallo schermo] Ho toccato Manda: l'email è partita. ${e.finite ? 'Non ci sono altre email: di\' «Inviata. Finite. Vuoi scrivere a qualcuno?» e aspetta.' : r.torna_a ? `Di' «Inviata. Torniamo a ${e.da}.» e basta.` : `Di' «Inviata.» e presenta la prossima: ${JSON.stringify(e)}.`}`);
      } catch (e) { st.sub = e.message; render(); }
    }
    async function leave() {
      try { const r = await post(`${API}/lascia`, {}); apply(r, r.stato); tell('[Dallo schermo] Ho lasciato stare la bozza: non mandarla. Di\' solo «Lasciata.»'); } catch (e) { st.sub = e.message; render(); }
    }
    const change = () => tell('[Dallo schermo] Voglio cambiare l\'email: chiedimi solo «Cosa cambio?».');
    const readAll = () => tell('[Dallo schermo] Leggimela tutta.');
    async function stop() {
      if (st.closed) return;
      hangUp();
      let r = null;
      try { r = await post(`${API}/fine`, {}); } catch { /* chiusa comunque */ }
      endScreen(r);
    }
    function hangUp(leaving) {
      if (st.closed) return;
      st.closed = true;
      clearTimeout(st.endT);
      try { st.dc && st.dc.close(); } catch { /* chiuso */ }
      try { st.pc && st.pc.close(); } catch { /* chiuso */ }
      if (st.mic) st.mic.getTracks().forEach(t => t.stop());
      if (st.audio) { st.audio.pause(); st.audio.srcObject = null; }
      st.wake?.release?.().catch(() => {});
      if (leaving) post(`${API}/fine`, {}).catch(() => {});
    }
    async function start() {
      frame(); show('connect');
      try { st.wake = await navigator.wakeLock?.request('screen'); } catch { /* lo schermo può spegnersi */ }
      try { await post(`${API}/sessione`, {}); } catch (e) { st.mode = 'error'; st.sub = e.message; render(); return; }
      try { st.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); } catch { st.mode = 'error'; st.sub = 'Il microfono non è permesso: attivalo per questo sito.'; render(); return; }
      if (st.closed) { st.mic.getTracks().forEach(t => t.stop()); return; }
      const pc = st.pc = new RTCPeerConnection();
      st.audio = new Audio(); st.audio.autoplay = true;
      pc.ontrack = e => { st.audio.srcObject = e.streams[0]; st.audio.play().catch(() => {}); };
      pc.addTrack(st.mic.getTracks()[0], st.mic);
      const dc = st.dc = pc.createDataChannel('oai-events');
      dc.addEventListener('message', m => { try { onEvent(JSON.parse(m.data)); } catch { /* evento non leggibile */ } });
      dc.addEventListener('open', () => { show('penso'); send({ type: 'response.create', response: { instructions: 'Chiama subito prossima_email, senza dire niente prima.' } }); });
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const ans = await post(`${API}/collega`, { sdp: offer.sdp });
        await pc.setRemoteDescription({ type: 'answer', sdp: ans.sdp });
      } catch (e) { st.mode = 'error'; st.sub = `Non riesco a collegarmi: ${e.message}`; render(); return; }
      pc.addEventListener('connectionstatechange', () => { if (['failed', 'disconnected'].includes(pc.connectionState) && !st.closed) stop(); });
    }
    if (/^(localhost|127\.)/.test(location.hostname)) window.__pv = { st, onEvent, apply, render, show, runTools };
    start();
    return { hangUp };
  }

  await startScreen();
  return cleanup;
}
