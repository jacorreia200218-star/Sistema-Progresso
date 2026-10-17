// Notificações push: subscrições só do próprio, aviso à função de envio e
// funções reservadas à chave secreta do Supabase.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, buildWorld, pool, rpc, type World } from './helpers';

let w: World;
const sub = (n: string) => ({ p_endpoint: `https://push.example.invalid/${n}`, p_p256dh: 'BKey', p_auth: 'auth', p_user_agent: 'teste' });

/** Executa como a função /api/push (role service_role no JWT). */
async function asService<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role service_role');
    await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows as T[];
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const requests = async () => admin(`select url, body, headers from net.test_requests order by id`);

beforeAll(async () => {
  w = await buildWorld('push');
  await admin(`delete from net.test_requests`);
});
afterAll(() => pool.end());

describe('notificações push', () => {
  it('cada pessoa gere só as suas subscrições', async () => {
    await rpc(w.users.P1, 'save_push_subscription', sub('p1'));
    expect(await rpc(w.users.P1, 'has_push_subscription', { p_endpoint: sub('p1').p_endpoint })).toBe(true);
    expect(await rpc(w.users.P2, 'has_push_subscription', { p_endpoint: sub('p1').p_endpoint })).toBe(false);
    await rpc(w.users.P2, 'remove_push_subscription', { p_endpoint: sub('p1').p_endpoint });
    expect(await rpc(w.users.P1, 'has_push_subscription', { p_endpoint: sub('p1').p_endpoint })).toBe(true);
    await expect(rpc(w.users.P1, 'save_push_subscription', { ...sub('x'), p_endpoint: 'http://inseguro' })).rejects.toThrow('Subscrição inválida');
    await expect(rpc(null, 'save_push_subscription', sub('anon'))).rejects.toThrow();
    // Ninguém lê a tabela diretamente
    const direct = await asUser(w.users.P1, `select * from public.push_subscriptions`).catch(() => []);
    expect(direct).toEqual([]);
  });

  it('nova notificação avisa a função de envio só para quem tem subscrição', async () => {
    await admin(`delete from net.test_requests`);
    await rpc(w.users.P1, 'send_test_notification');
    await rpc(w.users.P2, 'send_test_notification');
    const reqs = await requests();
    expect(reqs).toHaveLength(1);
    expect(reqs[0].url).toBe('https://sistema-progresso.vercel.app/api/push');
    const n = (await admin(`select id from public.notifications where profile_id = $1 and kind = 'teste'`, [w.users.P1]))[0];
    expect(reqs[0].body).toEqual({ notification_id: n.id });
    const secret = (await admin(`select secret from private.push_config`))[0].secret;
    expect(reqs[0].headers['x-push-secret']).toBe(secret);
    expect(secret).toHaveLength(64);
  });

  it('a notificação fica guardada mesmo que o aviso falhe', async () => {
    await admin(`alter function net.http_post(text, jsonb, jsonb, jsonb, integer) rename to http_post_ok`);
    try {
      await admin(`delete from public.notifications where profile_id = $1 and kind = 'teste'`, [w.users.P1]);
      await rpc(w.users.P1, 'send_test_notification');
      expect(await admin(`select 1 from public.notifications where profile_id = $1 and kind = 'teste'`, [w.users.P1])).toHaveLength(1);
    } finally {
      await admin(`alter function net.http_post_ok(text, jsonb, jsonb, jsonb, integer) rename to http_post`);
    }
  });

  it('limita as notificações de teste', async () => {
    await admin(`delete from public.notifications where profile_id = $1 and kind = 'teste'`, [w.users.P3]);
    for (let i = 0; i < 3; i++) await rpc(w.users.P3, 'send_test_notification');
    await expect(rpc(w.users.P3, 'send_test_notification')).rejects.toThrow('Espera um minuto');
  });

  it('configuração, conteúdo e limpeza só com a chave secreta', async () => {
    await expect(rpc(w.users.Ana, 'push_service_config')).rejects.toThrow('Sem permissão');
    await expect(rpc(w.users.Ana, 'push_drop_subscriptions', { p_endpoints: [sub('p1').p_endpoint] })).rejects.toThrow('Sem permissão');
    const n = (await admin(`select id from public.notifications where profile_id = $1 and kind = 'teste'`, [w.users.P1]))[0].id;
    expect(await rpc(w.users.P1, 'push_notification_payload', { p_id: n })).toBeNull();

    // Chaves guardadas na primeira utilização e nunca substituídas
    const [first] = await asService(`select public.push_service_config('PUB1', 'PRIV1') as r`);
    expect(first.r).toMatchObject({ public_key: 'PUB1', private_key: 'PRIV1' });
    const [second] = await asService(`select public.push_service_config('PUB2', 'PRIV2') as r`);
    expect(second.r.public_key).toBe('PUB1');

    const [p] = await asService(`select public.push_notification_payload($1) as r`, [n]);
    expect(p.r).toMatchObject({ title: 'Notificação de teste', link: '/notificacoes' });
    expect(p.r.subscriptions).toEqual([{ endpoint: sub('p1').p_endpoint, p256dh: 'BKey', auth: 'auth' }]);

    const [d] = await asService(`select public.push_drop_subscriptions($1) as r`, [[sub('p1').p_endpoint]]);
    expect(d.r).toBe(1);
    expect(await rpc(w.users.P1, 'has_push_subscription', { p_endpoint: sub('p1').p_endpoint })).toBe(false);
  });

  it('regista o último envio e o último erro por dispositivo; cada um só vê o seu', async () => {
    await rpc(w.users.P2, 'save_push_subscription', sub('p2'));
    await expect(rpc(w.users.P2, 'push_mark_results', { p_sent: [sub('p2').p_endpoint] })).rejects.toThrow(/permission denied|Sem permissão/);
    await asService(`select public.push_mark_results($1, '[]'::jsonb)`, [[sub('p2').p_endpoint]]);
    const ok = await rpc(w.users.P2, 'my_push_device', { p_endpoint: sub('p2').p_endpoint });
    expect(ok.last_sent_at).toBeTruthy();
    expect(ok.last_error).toBeNull();
    await asService(`select public.push_mark_results('{}', $1::jsonb)`, [JSON.stringify([{ endpoint: sub('p2').p_endpoint, error: '403 BadJwtToken' }])]);
    expect((await rpc(w.users.P2, 'my_push_device', { p_endpoint: sub('p2').p_endpoint })).last_error).toBe('403 BadJwtToken');
    expect(await rpc(w.users.P1, 'my_push_device', { p_endpoint: sub('p2').p_endpoint })).toBeNull();
  });
});
