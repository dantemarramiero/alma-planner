// App sul telefono: Alma Planet si aggiunge alla schermata Home da Safari (o Chrome) con il logo Almacis,
// si apre a tutto schermo e riceve le notifiche push. Qui: service worker, avviso «Aggiungi alla schermata Home»
// su iPhone e iscrizione del dispositivo alle notifiche.
import { h } from './ui.js';
import { get, post } from './api.js';

const HINT_KEY = 'alma.pwa.hint';
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function startPwa() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    navigator.serviceWorker.addEventListener?.('message', e => { if (e.data?.type === 'open' && e.data.url) location.href = e.data.url; });
  }
  installHint();
}

// iPhone in Safari: un riquadro spiega come aggiungere l'app; si chiude con «Più tardi» (per 14 giorni).
function installHint() {
  if (!isIos() || isStandalone()) return;
  let until = 0;
  try { until = Number(localStorage.getItem(HINT_KEY) || 0); } catch { /* niente memoria: si mostra */ }
  if (until > Date.now()) return;
  const box = h('div.pwa-hint', { role: 'dialog', 'aria-label': 'Aggiungi Alma Planet al telefono' },
    h('img', { src: '/brand/almacis/app-icon-180.png', alt: '' }),
    h('div',
      h('strong', 'Aggiungi Alma Planet al telefono'),
      h('span', 'Tocca ', h('strong', 'Condividi'), ' in basso, poi ', h('strong', 'Aggiungi alla schermata Home'), '. Si apre come un\'app e ti avvisa dei ticket e dei post nuovi.'),
      h('button', { type: 'button', on: { click: () => {
        try { localStorage.setItem(HINT_KEY, String(Date.now() + 14 * 86400000)); } catch { /* ok */ }
        box.remove();
      } } }, 'Più tardi')));
  document.body.append(box);
}

const b64 = s => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};

// stato delle notifiche su questo dispositivo: 'on' | 'off' | 'denied' | 'install' (iPhone: prima va aggiunta) | 'unsupported'
export async function pushState() {
  if (isIos() && !isStandalone()) return 'install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permesso negato: riattivalo dalle impostazioni del telefono');
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const { key } = await get('/api/push/key');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
  const device = isIos() ? 'iPhone' : /android/i.test(navigator.userAgent) ? 'Android' : /mac/i.test(navigator.userAgent) ? 'Mac' : /windows/i.test(navigator.userAgent) ? 'Computer Windows' : 'Dispositivo';
  await post('/api/push/subscribe', { subscription: sub.toJSON(), device: isStandalone() ? `${device} (app)` : device });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await post('/api/push/unsubscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}
