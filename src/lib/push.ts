// Notificações push neste dispositivo: suporte, ativar, desativar e teste.
import { call } from './api';

export type PushState = 'indisponivel' | 'instalar' | 'bloqueadas' | 'desativadas' | 'ativas';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Regista o service worker (sem pedir nada à pessoa). */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

async function registration() {
  const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  return reg;
}

export async function pushState(): Promise<PushState> {
  // No iPhone, as notificações só existem com a app adicionada ao ecrã principal.
  if (isIOS() && !isStandalone()) return 'instalar';
  if (!supported()) return 'indisponivel';
  if (Notification.permission === 'denied') return 'bloqueadas';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return 'desativadas';
  return (await call<boolean>('has_push_subscription', { p_endpoint: sub.endpoint })) ? 'ativas' : 'desativadas';
}

function keyBytes(base64url: string) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function enablePush() {
  // O pedido de autorização tem de vir diretamente do toque no botão.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('As notificações não foram autorizadas neste dispositivo.');
  const res = await fetch('/api/push', { cache: 'no-store' });
  const { publicKey, error } = (await res.json().catch(() => ({}))) as { publicKey?: string; error?: string };
  if (!res.ok || !publicKey) throw new Error(error ? `O envio de notificações ainda não está configurado (${error})` : 'O envio de notificações ainda não está configurado.');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const json = sub.toJSON();
  await call('save_push_subscription', {
    p_endpoint: sub.endpoint, p_p256dh: json.keys?.p256dh, p_auth: json.keys?.auth, p_user_agent: navigator.userAgent,
  });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await call('remove_push_subscription', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

export const sendTestNotification = () => call('send_test_notification');
