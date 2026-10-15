// Envio de notificações push. Separado do ponto de entrada para poder ser
// testado sem rede: as dependências (base de dados e envio) são injetadas.

export type Subscription = { endpoint: string; p256dh: string; auth: string };
export type Config = { secret: string; public_key: string | null; private_key: string | null };
export type Payload = { title: string; body: string | null; link: string | null; subscriptions: Subscription[] } | null;

export type Deps = {
  config: (keys?: { publicKey: string; privateKey: string }) => Promise<Config>;
  payload: (id: string) => Promise<Payload>;
  drop: (endpoints: string[]) => Promise<void>;
  generateKeys: () => { publicKey: string; privateKey: string };
  send: (sub: Subscription, data: string, vapid: { subject: string; publicKey: string; privateKey: string }) => Promise<void>;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** Chaves VAPID: criadas na primeira utilização e guardadas na base de dados. */
export async function vapidKeys(deps: Deps) {
  let c = await deps.config();
  if (!c.public_key || !c.private_key) c = await deps.config(deps.generateKeys());
  return c as Config & { public_key: string; private_key: string };
}

/** GET: devolve a chave pública que o navegador usa para subscrever. */
export async function handleGet(deps: Deps) {
  const c = await vapidKeys(deps);
  return json({ publicKey: c.public_key });
}

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** POST: chamado pela base de dados quando é criada uma notificação. */
export async function handlePost(request: Request, deps: Deps) {
  const c = await vapidKeys(deps);
  if (!sameSecret(request.headers.get('x-push-secret') ?? '', c.secret)) return json({ error: 'forbidden' }, 403);
  const body = (await request.json().catch(() => null)) as { notification_id?: unknown } | null;
  const id = typeof body?.notification_id === 'string' ? body.notification_id : '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'notification_id' }, 400);

  const p = await deps.payload(id);
  if (!p || p.subscriptions.length === 0) return json({ sent: 0 });
  const data = JSON.stringify({ title: p.title, body: p.body ?? '', url: p.link || '/notificacoes', tag: id });
  const vapid = { subject: new URL(request.url).origin, publicKey: c.public_key, privateKey: c.private_key };
  const expired: string[] = [];
  let sent = 0;
  await Promise.all(p.subscriptions.map(async (s) => {
    try {
      await deps.send(s, data, vapid);
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) expired.push(s.endpoint);
    }
  }));
  if (expired.length) await deps.drop(expired);
  return json({ sent, expired: expired.length });
}
