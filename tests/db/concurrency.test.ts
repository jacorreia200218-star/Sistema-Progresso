import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, buildWorld, pool, rpc, today, trailsByArea, type World } from './helpers';
import { seedHistorical } from './helpers';

let w: World;
let byArea: Awaited<ReturnType<typeof trailsByArea>>;

beforeAll(async () => {
  w = await buildWorld('concorrencia');
  byArea = await trailsByArea();
});
afterAll(() => pool.end());

async function submitted(who: string, trail: string) {
  const req = await rpc<string>(w.users[who], 'create_trail_request', { p_membership: w.members[who], p_trail: trail, p_kind: 'normal' });
  await rpc(w.users[who], 'save_request_draft', { p_request: req, p_reflection: 'r', p_experiences: '', p_period_start: null, p_period_end: null, p_approximate_date: null });
  await rpc(w.users[who], 'submit_trail_request', { p_request: req });
  return req;
}

describe('concorrência', () => {
  it('decisões contraditórias em simultâneo: só uma é registada', async () => {
    const req = await submitted('P1', byArea.F[0].id);
    const results = await Promise.allSettled([
      rpc(w.users.GuiaA, 'record_team_decision', { p_request: req, p_expected_version: 1, p_validated: true, p_meeting_date: today(), p_comment: null }),
      rpc(w.users.Ana, 'record_team_decision', { p_request: req, p_expected_version: 1, p_validated: false, p_meeting_date: today(), p_comment: 'Devolver' }),
      rpc(w.users.Rui, 'record_team_decision', { p_request: req, p_expected_version: 1, p_validated: true, p_meeting_date: today(), p_comment: null }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const d = await admin(`select kind from public.trail_decisions where request_id = $1 and kind <> 'em_revisao'`, [req]);
    expect(d).toHaveLength(1);
  });

  it('pedidos duplicados criados em simultâneo: só um fica ativo', async () => {
    const results = await Promise.allSettled(
      [1, 2, 3].map(() => rpc(w.users.P2, 'create_trail_request', { p_membership: w.members.P2, p_trail: byArea.A[0].id, p_kind: 'normal' })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('pedidos normal e histórico simultâneos para o mesmo trilho: só um', async () => {
    const results = await Promise.allSettled([
      rpc(w.users.P2, 'create_trail_request', { p_membership: w.members.P2, p_trail: byArea.C[0].id, p_kind: 'normal' }),
      seedHistorical(w, 'P2', byArea.C[0].id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('decisão histórica e retirada em simultâneo não deixam estado incoerente', async () => {
    const req = await seedHistorical(w, 'P3', byArea.S[0].id);
    await rpc(w.users.P3, 'save_request_draft', { p_request: req, p_reflection: 'r', p_experiences: '', p_period_start: null, p_period_end: null, p_approximate_date: '2024' });
    await rpc(w.users.P3, 'submit_trail_request', { p_request: req });
    const results = await Promise.allSettled([
      rpc(w.users.P3, 'withdraw_trail_request', { p_request: req }),
      rpc(w.users.Ana, 'decide_historical_request', { p_request: req, p_expected_version: 1, p_outcome: 'aprovado', p_comment: null, p_reference_date: null }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const r = (await admin(`select status, current_version from public.trail_requests where id = $1`, [req]))[0];
    expect([['aprovado', 1], ['rascunho', 2]]).toContainEqual([r.status, r.current_version]);
  });
});
