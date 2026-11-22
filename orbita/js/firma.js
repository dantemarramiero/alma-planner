// La mia firma (ALM2-64, tavola H del canvas «Progetto da email», approvata da Dante il 22/11/2026).
// Firma Almacis uguale per tutti (logo, indirizzo, sito) con nome, ruolo e telefono di ognuno: dal profilo Microsoft,
// correggibili qui, con l'anteprima di come la vede chi riceve. La usano Rispondi, Rispondi a tutti e Inoltra della Posta.
import { h, fill, toast, loading } from './ui.js';
import { get, put, del } from './api.js';
import { pageTop, title, card, toggle, ic } from './crm-v2.js';

export async function firmaView(view) {
  fill(view, h('div.cv', loading()));
  let sig = await get('/api/firma');
  const input = (value, attrs = {}) => h('input.input', { value: value || '', ...attrs });
  const name = input(sig.name, { maxlength: 120, 'aria-label': 'Nome come appare' });
  const role = input(sig.role, { maxlength: 120, placeholder: 'dal tuo profilo Microsoft', 'aria-label': 'Ruolo' });
  const phone = input(sig.phone, { maxlength: 40, placeholder: '+39 …', 'aria-label': 'Telefono' });
  const phone2 = input(sig.phone2, { maxlength: 40, placeholder: 'es. fisso dell\'ufficio', 'aria-label': 'Secondo telefono' });
  const on = toggle(sig.enabled, 'Metti la firma nelle email che mando da Alma');
  const preview = h('div.fm-prev');
  const sample = h('div.fm-sample', h('p', 'Ciao Luca,'), h('p', ' '), h('p', 'ok per giovedì, ci vediamo lì.'), h('p', ' '), h('p', 'A presto,'), h('p', 'Dante'));
  const state = h('span.cv-small.cv-muted');
  const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  // stessa forma della firma vera (lib/firma.js html()), col logo servito da Alma
  const build = x => {
    const p = (inner, extra = "") => `<p style="margin:0;font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222222;${extra}">${inner}</p>`;
    return [`<div class="almacis-firma">`, p(`<b>${esc(x.name)}</b>`), x.role ? p(esc(x.role), "color:#555555") : "",
      `<p style="margin:10px 0"><img src="/brand/almacis/almacis-logo.png" alt="Almacis" width="150" style="width:150px;height:auto;display:block"></p>`,
      ...sig.company.address.map(a => p(esc(a))),
      x.phone ? p(`Tel.&nbsp; ${esc(x.phone)}${x.phone2 ? ` &nbsp;/&nbsp; ${esc(x.phone2)}` : ""}`) : "",
      p(`<a href="${sig.company.siteUrl}" style="color:#0563C1">${sig.company.site}</a>`), "</div>"].join("");
  };
  const draw = () => {
    preview.innerHTML = build({ name: name.value.trim(), role: role.value.trim(), phone: phone.value.trim(), phone2: phone2.value.trim() });
    preview.classList.toggle("off", !on.input.checked);
    state.textContent = sig.saved ? "Corretta da te: resta così anche se il profilo Microsoft cambia." : "Presa dal tuo profilo Microsoft.";
  };
  const live = draw;
  for (const el of [name, role, phone, phone2]) el.addEventListener('input', live);
  on.input.addEventListener('change', live);
  const save = async () => {
    if (!name.value.trim()) { toast('Serve il nome', 'err'); name.focus(); return; }
    sig = await put('/api/firma', { enabled: on.input.checked, name: name.value.trim(), role: role.value.trim(), phone: phone.value.trim(), phone2: phone2.value.trim() });
    draw(); toast('Firma salvata');
  };
  const reset = async () => {
    sig = await del('/api/firma');
    name.value = sig.name; role.value = sig.role; phone.value = sig.phone; phone2.value = sig.phone2; on.input.checked = sig.enabled;
    draw(); toast('Firma ripresa dal profilo Microsoft');
  };
  const fld = (label, el) => h('label.fm-fld', h('span', label), el);
  fill(view, h('div.cv.fm',
    pageTop({ eyebrow: 'Il mio profilo', heading: title('La mia', 'firma'), sub: 'Uguale per tutti in Almacis, con i tuoi dati. Va in fondo alle email che mandi dalla Posta di Alma.' }),
    h('div.fm-grid',
      card({ title: 'I miei dati', icon: 'pencil' },
        h('div.fm-form',
          fld('Nome come appare', name),
          fld('Ruolo', role),
          h('div.fm-two', fld('Telefono', phone), fld('Secondo telefono (facoltativo)', phone2)),
          h('div.fm-on', on.el),
          state,
          h('div.fm-act',
            h('button.btn', { type: 'button', on: { click: reset } }, 'Ripristina dal profilo Microsoft'),
            h('button.btn.btn-primary', { type: 'button', on: { click: save } }, 'Salva')))),
      card({ title: 'Anteprima · come la vede chi riceve', icon: 'mail' }, h('div.fm-mail', sample, preview),
        h('p.cv-small.cv-muted.fm-note', 'Logo, indirizzo e sito sono di Almacis e uguali per tutti. Il logo viaggia dentro l\'email, come in Outlook.')))));
  draw();
}
