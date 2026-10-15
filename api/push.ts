// Notificações push: GET devolve a chave pública; POST envia uma notificação
// (chamado pela base de dados). Precisa da variável SUPABASE_SECRET_KEY na Vercel.
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { handleGet, handlePost, type Deps } from './_core.js';

function deps(): Deps {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Falta configurar SUPABASE_SECRET_KEY na Vercel.');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rpc = async <T>(fn: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  };
  return {
    config: (k) => rpc('push_service_config', k ? { p_public_key: k.publicKey, p_private_key: k.privateKey } : {}),
    payload: (id) => rpc('push_notification_payload', { p_id: id }),
    drop: async (endpoints) => { await rpc('push_drop_subscriptions', { p_endpoints: endpoints }); },
    generateKeys: () => webpush.generateVAPIDKeys(),
    send: async (s, data, vapid) => {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data, {
        vapidDetails: vapid, TTL: 24 * 3600, urgency: 'normal',
      });
    },
  };
}

const failure = (e: unknown) =>
  new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'erro' }), { status: 503, headers: { 'Content-Type': 'application/json' } });

export async function GET() {
  try { return await handleGet(deps()); } catch (e) { return failure(e); }
}

export async function POST(request: Request) {
  try { return await handlePost(request, deps()); } catch (e) { return failure(e); }
}
