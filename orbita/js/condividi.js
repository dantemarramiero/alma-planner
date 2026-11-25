// «Condividi» ovunque (ALM2-87, canvas «Condividi ovunque» approvato da Dante il 24/11/2026).
// Una sola finestra per progetti e schede del CRM (aziende, contatti, nuovi business, opportunità Energy e Impianti):
// con chi, come (avviso in Alma sempre; Teams e/o Email a scelta, ricordati per la prossima volta), messaggio.
// Chi non può aprire la scheda ha il «!» rosso prima dell'invio; dopo l'invio un «!» dice cosa non è partito.
import { h, fill, toast, fmtDate } from './ui.js';
import { get, post } from './api.js';
import { store } from './store.js';
import { peoplePicker } from './people.js';
import { icon } from './icons.js';
import { cvModal } from './crm-v2.js';

const KEY = 'alma.condividi.canali';
const readChannels = () => { try { const x = JSON.parse(localStorage.getItem(KEY) || '{}'); return { teams: Boolean(x.teams), mail: Boolean(x.mail) }; } catch { return { teams: false, mail: false }; } };
const saveChannels = c => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* niente memoria: si riparte da solo avviso */ } };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const time = d => new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
const firstName = n => String(n || '').split(/\s+/)[0];

function sendLabel({ teams, mail }) {
  if (teams && mail) return 'Condividi su Teams e per email';
  if (teams) return 'Condividi su Teams';
  if (mail) return 'Condividi per email';
  return 'Condividi';
}

// Il pulsante della testata: stesso aspetto in tutte le pagine
export function shareButton(kind, id, { small = false, className = '' } = {}) {
  return h(`button.btn.sh-btn${small ? '.btn-sm' : ''}${className ? `.${className}` : ''}`, { type: 'button', on: { click: () => shareDialog({ kind, id }) } },
    icon('share-2', { size: small ? 14 : 16 }), 'Condividi');
}

export async function shareDialog({ kind, id, onSent }) {
  const data = await get(`/api/condividi/${kind}/${id}/persone`);
  const blocked = new Set(data.people.filter(u => !u.ok).map(u => u.id));
  const nameOf = uid => data.people.find(u => u.id === uid)?.name || '';
  const [one, many] = data.blocked_reason || ['non può aprire la scheda', 'non possono aprire la scheda'];
  let ids = [];
  const ch = data.teams ? readChannels() : { teams: false, mail: false };

  const warn = h('div');
  const pickerBox = h('div.sh-pick'); // il menu dei colleghi si apre largo quanto il campo, mai fuori dalla finestra
  const drawWarn = () => {
    const bad = ids.filter(x => blocked.has(x)).map(nameOf);
    fill(warn, bad.length ? h('div.cm-warn', h('span.cm-bang', '!'),
      h('span', `${bad.join(', ')} ${bad.length === 1 ? one : many}: ${bad.length === 1 ? 'riceverebbe' : 'riceverebbero'} il messaggio ma non ${bad.length === 1 ? 'può' : 'possono'} aprire la scheda. ${bad.length === 1 ? 'Toglila' : 'Toglile'}${kind === 'projects' ? ', oppure aggiungila al progetto dal tab Membri' : kind === 'energy' ? ', oppure chiedi alla direzione di dare Alma Energy' : ', oppure chiedi alla direzione di dare il CRM'}.`)) : null);
    pickerBox.querySelectorAll('.person-chip').forEach(chip => {
      const u = data.people.find(x => chip.textContent.includes(x.name));
      chip.classList.toggle('cm-nocrm', Boolean(u && blocked.has(u.id)));
    });
  };
  const picker = peoplePicker({ selected: [], label: '+ Collega', onChange: x => { ids = x.filter(i => i !== store.me.id); drawWarn(); } });
  fill(pickerBox, picker.el);

  const send = h('button.btn.btn-primary', { type: 'button' }, icon('share-2', { size: 15 }), sendLabel(ch));
  const option = (key, ico, title, sub, { locked = false } = {}) => {
    const box = h('input', { type: 'checkbox', checked: locked || ch[key], disabled: locked || !data.teams, 'aria-label': title });
    const el = h('label.sh-ch', { class: (locked || ch[key]) ? 'on' : '' }, h('span.sh-ch-top', icon(ico, { size: 20 }), box), h('b', title), h('small', sub));
    if (locked) el.classList.add('locked');
    box.addEventListener('change', () => { ch[key] = box.checked; el.classList.toggle('on', box.checked); send.lastChild.textContent = sendLabel(ch); });
    return el;
  };
  const channels = h('fieldset.sh-chs',
    h('legend', 'Come glielo mandi'),
    h('div.sh-ch-grid',
      option('alma', 'bell', 'Avviso in Alma', 'Sempre: campanella e notifica', { locked: true }),
      option('teams', 'message', 'Teams', 'Nella vostra chat, a nome tuo'),
      option('mail', 'mail', 'Email', 'Dalla tua casella Outlook')),
    h('small.sh-note', data.teams ? 'Alma ricorda la tua scelta per la prossima volta.' : 'Teams ed email non sono disponibili: Microsoft 365 non è collegato ad Alma.'));

  const msg = h('textarea.input', { rows: 3, maxlength: 1000, placeholder: 'Perché glielo mandi: cosa guardare, cosa fare', 'aria-label': 'Messaggio' });
  const link = `${location.origin}/app#${data.item.link}`;
  const body = h('div.en-form',
    h('div.cv-fld', h('span', 'Con chi'), pickerBox, warn),
    channels,
    h('label.cv-fld', h('span', 'Messaggio · facoltativo'), msg),
    h('div.cv-fld', h('span', 'Cosa condividi'), h('div.cm-what', h('span.cv-mono', data.item.name.slice(0, 2).toUpperCase()),
      h('div', h('b', data.item.name), data.item.summary ? h('div.cv-small.cv-muted', data.item.summary) : null))));

  send.addEventListener('click', async () => {
    if (!ids.length) return toast('Scegli almeno un collega', 'err');
    if (ids.some(x => blocked.has(x))) return toast('Togli chi non può aprire la scheda, poi condividi', 'err');
    send.disabled = true;
    try {
      if (data.teams) saveChannels({ teams: ch.teams, mail: ch.mail });
      const r = await post(`/api/condividi/${kind}/${id}`, { user_ids: ids, message: msg.value, teams: ch.teams, mail: ch.mail });
      const failed = [...r.teams.failed.map(f => ({ ...f, via: 'Teams' })), ...r.mail.failed.map(f => ({ ...f, via: 'Email' }))];
      onSent?.(r);
      if (!failed.length) {
        m.close();
        const via = [ch.teams && 'su Teams', ch.mail && 'per email'].filter(Boolean).join(' e ');
        return toast(`Condivisa con ${plural(r.sent, 'collega', 'colleghi')}${via ? ` ${via}` : ': ricevono l\'avviso in Alma'}`);
      }
      // qualcosa non è partito: l'avviso in Alma sì, il «!» dice cosa manca e come rimediare (canvas C4)
      const reauth = failed.some(f => /rientrare/.test(f.error));
      fill(body, h('div.sh-done',
        h('p', `L'avviso in Alma è arrivato a ${plural(r.sent, 'collega', 'colleghi')}. Non è partito:`),
        failed.map(f => h('div.cm-warn', h('span.cm-bang', '!'), h('span', h('b', `${f.via} a ${f.name}`), ` · ${f.error}.`))),
        reauth ? h('p.cv-small.cv-muted', 'Rientra con Microsoft e condividi di nuovo: il collega ha già l\'avviso in Alma.') : null));
      send.replaceWith(reauth
        ? h('a.btn.btn-primary', { href: `/auth/login?returnTo=${encodeURIComponent(`/app${location.hash}`)}` }, 'Rientra con Microsoft')
        : h('button.btn.btn-primary', { type: 'button', on: { click: () => m.close() } }, 'Chiudi'));
    } catch { send.disabled = false; }
  });

  const m = cvModal({
    size: 'md',
    title: h('div', h('h2', 'Condividi ', h('b', data.item.name)), h('div.cv-subh', 'Il collega riceve il link, dove preferisci tu')),
    body,
    left: [h('button.btn.btn-ghost', { type: 'button', on: { click: async () => { try { await navigator.clipboard.writeText(link); toast('Link copiato'); } catch { toast(link); } } } }, icon('link', { size: 15 }), 'Copia il link')],
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), send],
  });
  m.box.classList.add('sh-dlg');
  return m;
}

// Chi apre una scheda che gli è stata condivisa: la cronologia mostra «l'ha aperta»
export function markShareOpened(kind, id) { post(`/api/condividi/${kind}/${id}/aperta`, {}, { quiet: true }).catch(() => {}); }

// Una persona di una condivisione, in una riga: «Marco · Teams · aperta alle 17:52»
export function sharePersonText(p) {
  const via = [p.teams === 'ok' && 'Teams', p.mail === 'ok' && 'Email'].filter(Boolean).join(' e ') || 'Alma';
  return [firstName(p.name), via, p.opened ? `aperta ${fmtDate(String(p.opened).slice(0, 10))} alle ${time(p.opened)}` : 'non ancora aperta'].join(' · ');
}

// Le persone come pillole (verde se l'ha aperta) e il «!» se Teams o l'email non sono partiti
export function sharePeople(to) {
  return h('span.sh-people', to.map(p => h('span.sh-pp', { class: p.opened ? 'open' : '' }, sharePersonText(p),
    p.error ? h('span.cm-bang', { title: p.error, role: 'img', 'aria-label': `Non partito: ${p.error}` }, '!') : null)));
}

// Le condivisioni di una scheda per «Ultimi aggiornamenti» delle pagine che non hanno la cronologia del CRM
export async function shareHistory(kind, id) {
  const { items } = await get(`/api/condividi/${kind}/${id}/storia`, { quiet: true }).catch(() => ({ items: [] }));
  return items;
}
