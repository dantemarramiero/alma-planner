// Profilo → Notifiche: per ogni avviso (nuovo post, ticket assegnato, A3) campanella, telefono ed email;
// sotto, le notifiche su questo dispositivo (attiva, prova) e i dispositivi iscritti. Layout del canvas 11/11.
import { h, fill, loading, toast, fmtDate } from './ui.js';
import { get, put, post } from './api.js';
import { pushState, enablePush, disablePush } from './pwa.js';

const COLS = [['bell', 'Campanella'], ['push', 'Telefono'], ['email', 'Email']];

export async function notifSettingsView(container) {
  fill(container, loading());
  const d = await get('/api/notifiche/preferenze');
  const state = d.kinds.map(k => ({ kind: k.kind, bell: k.bell, push: k.push, email: k.email }));
  const save = async () => {
    await put('/api/notifiche/preferenze', { kinds: state }, { quiet: true }).catch(() => toast('Non salvato: riprova', 'err'));
  };

  const table = h('section.card.ns-table',
    h('div.ns-row.ns-head', h('span', 'Quando'), COLS.map(([, l]) => h('span.ns-c', l))),
    d.kinds.map((k, i) => h('div.ns-row',
      h('span.ns-what', h('strong', k.label), h('small', k.hint)),
      COLS.map(([c, l]) => h('label.ns-c', h('input', { type: 'checkbox', checked: state[i][c], 'aria-label': `${k.label}: ${l}`,
        on: { change: e => { state[i][c] = e.target.checked; save(); } } }))))));

  const device = h('section.card.ns-device');
  const drawDevice = async () => {
    const st = await pushState().catch(() => 'unsupported');
    const msg = {
      on: 'Attive su questo dispositivo.',
      off: 'Non ancora attive su questo dispositivo.',
      denied: 'Bloccate dalle impostazioni del telefono o del browser: riattivale da lì.',
      install: 'Su iPhone le notifiche arrivano solo dall\'app: in Safari tocca Condividi → Aggiungi alla schermata Home, poi apri Alma Planet dall\'icona.',
      unsupported: 'Questo browser non riceve notifiche push.',
    }[st];
    fill(device,
      h('span.ns-what', h('strong', 'Notifiche sul telefono'), h('small', msg),
        d.devices.length ? h('small', `Iscritti: ${d.devices.map(x => `${x.device || 'dispositivo'} dal ${fmtDate(String(x.created_at).slice(0, 10))}`).join(' · ')}`) : null),
      h('span.row.ns-actions',
        st === 'on' ? h('button.btn', { type: 'button', on: { click: async () => { try { await post('/api/push/test', {}); toast('Prova inviata'); } catch (e) { toast(e.message, 'err'); } } } }, 'Manda una prova') : null,
        st === 'off' ? h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
          try { await enablePush(); toast('Notifiche attive su questo dispositivo'); } catch (e) { toast(e.message, 'err'); }
          notifSettingsView(container);
        } } }, 'Attiva su questo dispositivo') : null,
        st === 'on' ? h('button.btn.btn-ghost', { type: 'button', on: { click: async () => { await disablePush(); notifSettingsView(container); } } }, 'Disattiva qui') : null));
  };
  drawDevice();

  fill(container,
    h('div.page-head', h('div', h('h1', 'Notifiche'), h('div.sub', 'Scegli dove vuoi saperlo: nella campanella di Alma, sul telefono, per email.')),
      h('a.btn', { href: '#/notifications' }, 'Le mie notifiche')),
    table, device,
    h('p.small.muted', 'Le email partono dalla casella Microsoft di chi fa l\'azione. Le altre notifiche (mi piace, commenti, RDA, mezzi…) restano nella campanella come prima.'));
}
