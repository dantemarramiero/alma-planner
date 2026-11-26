/* Widget «Lavora con Almacis» per il sito almacis.it (HQSE fase 2, ALM2-101, tavola 1).
   Si incolla una volta sola in un blocco HTML:
     <div id="alma-fornitori"></div>
     <script src="https://<alma>/fornitori/widget.js" async></script>
   Testi e tipi di appalto arrivano da Alma Space (HQSE → Widget del sito). Chiuso in uno shadow DOM: gli stili del
   sito non lo toccano e lui non tocca il sito. Campo esca nascosto contro i robot. */
(function () {
  var me = document.currentScript;
  var base = me && me.src ? new URL(me.src).origin : '';
  function start() {
    var host = document.getElementById('alma-fornitori');
    if (!host || host.dataset.almaReady) return;
    host.dataset.almaReady = '1';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.innerHTML = '<style>' + CSS + '</style><div class="w"><p class="mut">Un attimo…</p></div>';
    var box = root.querySelector('.w');
    fetch(base + '/fornitori/widget/config').then(function (r) { return r.json(); }).then(function (cfg) { draw(box, cfg); })
      .catch(function () { box.innerHTML = '<p class="err">Il modulo non si è caricato. Riprova più tardi o scrivi a qualifica@almacis.it.</p>'; });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function draw(box, cfg) {
    var tipo = cfg.tipi[0] ? cfg.tipi[0].key : '';
    box.innerHTML =
      '<span class="bar" aria-hidden="true"></span>' +
      '<div class="h"><b>' + esc(cfg.titolo) + '</b></div>' +
      (cfg.testo ? '<p class="mut">' + esc(cfg.testo) + '</p>' : '') +
      '<form novalidate>' +
      '<div class="g2"><label>Ragione sociale<input name="ragione_sociale" autocomplete="organization" required></label>' +
      '<label>Partita IVA<input name="piva" inputmode="numeric" required></label>' +
      '<label>Referente<input name="referente" autocomplete="name" required></label>' +
      '<label>Email del referente<input name="email" type="email" autocomplete="email" required></label></div>' +
      '<fieldset><legend>Per quale tipo di appalto ti qualifichi?</legend><div class="g2 tipi">' +
      cfg.tipi.map(function (t) { return '<button type="button" class="opt" data-k="' + esc(t.key) + '" aria-pressed="false"><b>' + esc(t.label) + '</b><span>' + esc(t.hint) + '</span></button>'; }).join('') +
      '</div></fieldset>' +
      '<label class="ck"><input type="checkbox" name="privacy"> <span>Ho letto l\'<a href="' + esc(cfg.privacy_url) + '" target="_blank" rel="noopener">informativa privacy</a> e acconsento al trattamento dei dati per la qualifica</span></label>' +
      '<input class="hp" name="sito" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<p class="err" role="alert"></p>' +
      '<div class="f"><span class="mut">Hai già un accesso? <a href="' + esc(cfg.portale) + '" target="_blank" rel="noopener">Entra nel portale</a></span><button type="submit" class="pri">Registrati</button></div>' +
      '</form>';
    var form = box.querySelector('form');
    var opts = box.querySelectorAll('.opt');
    function pick(k) { tipo = k; opts.forEach(function (o) { var on = o.dataset.k === k; o.classList.toggle('on', on); o.setAttribute('aria-pressed', String(on)); }); }
    opts.forEach(function (o) { o.addEventListener('click', function () { pick(o.dataset.k); }); });
    pick(tipo);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var err = box.querySelector('.err');
      var send = form.querySelector('.pri');
      var v = function (n) { return form.elements[n].value.trim(); };
      err.textContent = '';
      if (!v('ragione_sociale') || !v('piva') || !v('referente') || !v('email')) { err.textContent = 'Compila tutti i campi.'; return; }
      if (!form.elements.privacy.checked) { err.textContent = 'Serve il consenso al trattamento dei dati.'; return; }
      send.disabled = true; send.textContent = 'Invio…';
      fetch(base + '/fornitori/registrazione', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ragione_sociale: v('ragione_sociale'), piva: v('piva'), referente: v('referente'), email: v('email'), tipo: tipo, privacy: true, sito: v('sito') }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok) throw new Error(x.j.error || 'Invio non riuscito');
          box.innerHTML = '<span class="bar" aria-hidden="true"></span><div class="h"><b>Fatto!</b></div><p>' + esc(x.j.messaggio || cfg.grazie) + '</p><p class="mut">Controlla la posta (anche lo spam): il link vale 7 giorni.</p>';
        })
        .catch(function (ex) { err.textContent = ex.message || 'Invio non riuscito, riprova.'; send.disabled = false; send.textContent = 'Registrati'; });
    });
  }
  var CSS = ':host{all:initial;display:block}' +
    '.w{position:relative;overflow:hidden;font-family:Roboto,"Helvetica Neue",Arial,sans-serif;color:#3F3F3F;background:#fff;border:1px solid #ECEAE6;border-radius:18px;box-shadow:0 1px 2px rgba(28,24,20,.04),0 10px 28px -14px rgba(28,24,20,.18);padding:32px;display:grid;gap:18px;font-size:15px;line-height:1.45}' +
    '.bar{position:absolute;left:0;right:0;top:0;height:4px;background:#FF8A26}.h b{font-size:22px;font-weight:500;color:#2C2C2C}p{margin:0}.mut{color:#6B6B6B;font-size:14px}.err{color:#B42318;font-size:14px;min-height:0}' +
    'form{display:grid;gap:18px}.g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}@media(max-width:560px){.g2{grid-template-columns:1fr}.w{padding:22px}}' +
    'label{display:grid;gap:6px;font-size:13px;font-weight:500}input{height:44px;border:1px solid #E0DDD8;border-radius:12px;padding:0 14px;font:inherit;font-size:15px;font-weight:400;color:#2C2C2C;box-sizing:border-box;width:100%}input:focus{outline:none;border-color:#FF8A26;box-shadow:0 0 0 3px rgba(255,138,38,.25)}' +
    'fieldset{border:0;margin:0;padding:0;display:grid;gap:10px}legend{font-size:13px;font-weight:500;margin-bottom:10px}' +
    '.opt{display:grid;gap:4px;text-align:left;padding:13px 15px;border:1px solid #E0DDD8;border-radius:14px;background:#fff;font:inherit;cursor:pointer}.opt b{font-size:15px;font-weight:500;color:#2C2C2C}.opt span{font-size:13px;color:#6B6B6B;line-height:18px}.opt.on{border:2px solid #FF8A26;background:#FFF6EE;padding:12px 14px}' +
    '.ck{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;font-weight:400;color:#515151}.ck input{width:18px;height:18px;margin-top:2px;flex:none}a{color:#C25E0E}' +
    '.hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}' +
    '.f{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid #F0EEEA;padding-top:18px}' +
    '.pri{height:48px;padding:0 26px;border-radius:12px;border:0;background:#FF8A26;color:#fff;font:inherit;font-size:15px;font-weight:500;cursor:pointer;box-shadow:0 8px 20px -8px rgba(255,138,38,.7)}.pri:disabled{opacity:.6;cursor:default}';
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
