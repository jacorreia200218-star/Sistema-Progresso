// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { handleGet, handlePost, type Deps } from './_core';

const ID = '11111111-2222-3333-4444-555555555555';
function fake(over: Partial<Deps> = {}) {
  const store = { secret: 's'.repeat(64), public_key: null as string | null, private_key: null as string | null };
  const d: Deps = {
    config: vi.fn(async (k) => {
      if (k && !store.public_key) { store.public_key = k.publicKey; store.private_key = k.privateKey; }
      return { ...store };
    }),
    payload: vi.fn(async () => ({ title: 'Novo pedido', body: 'Trilho X', link: '/revisoes/pedido/1', subscriptions: [
      { endpoint: 'https://a', p256dh: 'p', auth: 'a' }, { endpoint: 'https://b', p256dh: 'p', auth: 'a' }] })),
    drop: vi.fn(async () => {}),
    generateKeys: vi.fn(() => ({ publicKey: 'PUB', privateKey: 'PRIV' })),
    send: vi.fn(async (s) => { if (s.endpoint === 'https://b') throw Object.assign(new Error('gone'), { statusCode: 410 }); }),
    ...over,
  };
  return { d, store };
}
const post = (secret: string, body: unknown) =>
  new Request('https://app.example/api/push', { method: 'POST', headers: { 'x-push-secret': secret }, body: JSON.stringify(body) });

describe('envio push', () => {
  it('cria as chaves VAPID uma vez e devolve a pública', async () => {
    const { d } = fake();
    expect(await (await handleGet(d)).json()).toEqual({ publicKey: 'PUB' });
    await handleGet(d);
    expect(d.generateKeys).toHaveBeenCalledTimes(1);
  });

  it('recusa sem o segredo partilhado', async () => {
    const { d } = fake();
    expect((await handlePost(post('errado', { notification_id: ID }), d)).status).toBe(403);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('envia para cada dispositivo e remove subscrições expiradas', async () => {
    const { d } = fake();
    const r = await handlePost(post('s'.repeat(64), { notification_id: ID }), d);
    expect(await r.json()).toEqual({ sent: 1, expired: 1 });
    const [, data, vapid] = (d.send as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(data)).toEqual({ title: 'Novo pedido', body: 'Trilho X', url: '/revisoes/pedido/1', tag: ID });
    expect(vapid).toEqual({ subject: 'https://app.example', publicKey: 'PUB', privateKey: 'PRIV' });
    expect(d.drop).toHaveBeenCalledWith(['https://b']);
  });

  it('notificação lida, removida ou sem dispositivos: nada a enviar', async () => {
    const { d } = fake({ payload: vi.fn(async () => null) });
    expect(await (await handlePost(post('s'.repeat(64), { notification_id: ID }), d)).json()).toEqual({ sent: 0 });
    expect((await handlePost(post('s'.repeat(64), { notification_id: 'x' }), d)).status).toBe(400);
  });

  it('regista os envios aceites e as falhas que não são expiração', async () => {
    const mark = vi.fn(async () => {});
    const { d } = fake({ mark, send: vi.fn(async (s) => { if (s.endpoint === 'https://b') throw Object.assign(new Error('x'), { statusCode: 403, body: 'BadJwtToken' }); }) });
    const c = await (await handleGet(d)).json();
    void c;
    const res = await handlePost(post('s'.repeat(64), { notification_id: ID }), d);
    expect(await res.json()).toEqual({ sent: 1, expired: 0 });
    expect(mark).toHaveBeenCalledWith(['https://a'], [{ endpoint: 'https://b', error: '403 BadJwtToken' }]);
  });
});
