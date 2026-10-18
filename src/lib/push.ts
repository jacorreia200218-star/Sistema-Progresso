// Notificações push neste dispositivo: suporte, ativar, desativar e teste.
import { call } from './api';

/** Estado das notificações neste dispositivo, como é mostrado no Perfil. */
export type PushState = 'indisponivel' | 'por_autorizar' | 'bloqueado' | 'ativo';
/** Tipo de dispositivo, para dar as instruções certas. */
export type PushDevice = 'iphone' | 'android' | 'computador';

export interface PushInfo {
  device: PushDevice;
  state: PushState;
  /** App aberta a partir do ecrã principal (modo autónomo). */
  standalone: boolean;
  /** Porque está indisponível: no iPhone, falta pôr a app no ecrã principal. */
  reason?: 'instalar' | 'navegador';
  /** O navegador já autorizou (por autorizar só na app: foi desativado aqui). */
  granted?: boolean;
}

export interface PushEnv {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone: boolean;
  supported: boolean;
  permission: NotificationPermission | null;
  subscribed: boolean;
}

export function detectDevice(userAgent: string, platform = '', maxTouchPoints = 0): PushDevice {
  // O iPad com iPadOS identifica-se como Mac, mas tem ecrã tátil.
  if (/iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'iphone';
  if (/Android/i.test(userAgent)) return 'android';
  return 'computador';
}

/** Classificação pura (testável) a partir do que o navegador indica. */
export function classifyPush(env: PushEnv): PushInfo {
  const device = detectDevice(env.userAgent, env.platform, env.maxTouchPoints);
  const base = { device, standalone: env.standalone };
  // No iPhone, os avisos só existem com a app adicionada ao ecrã principal.
  if (device === 'iphone' && !env.standalone) return { ...base, state: 'indisponivel', reason: 'instalar' };
  if (!env.supported || !env.permission) return { ...base, state: 'indisponivel', reason: 'navegador' };
  if (env.permission === 'denied') return { ...base, state: 'bloqueado' };
  if (env.permission === 'granted' && env.subscribed) return { ...base, state: 'ativo' };
  return { ...base, state: 'por_autorizar', granted: env.permission === 'granted' };
}

const isStandalone = () =>
  !!window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
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

export async function pushState(): Promise<PushInfo> {
  const ok = supported();
  const env: PushEnv = {
    userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints,
    standalone: isStandalone(), supported: ok, permission: ok ? Notification.permission : null, subscribed: false,
  };
  const first = classifyPush(env);
  if (first.state !== 'por_autorizar' || env.permission !== 'granted') return first;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  // Só conta como ativo se o servidor tiver este dispositivo registado.
  const subscribed = !!sub && (await call<boolean>('has_push_subscription', { p_endpoint: sub.endpoint }));
  return classifyPush({ ...env, subscribed });
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

/** Último envio aceite pelo serviço de push para este dispositivo (e o último erro). */
export async function pushDeviceStatus(): Promise<{ last_sent_at: string | null; last_error: string | null } | null> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return null;
  return call('my_push_device', { p_endpoint: sub.endpoint });
}
