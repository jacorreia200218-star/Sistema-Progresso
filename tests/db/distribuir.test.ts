import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, buildWorld, expectError, pool, rpc, today, trailsByArea, type World } from './helpers';

let w: World;
let byArea: Awaited<ReturnType<typeof trailsByArea>>;
const pos = async (m: string) => (await admin(`select private.member_position($1) as p`, [m]))[0].p as { milestone: string; state: string };

beforeAll(async () => {
  w = await buildWorld('distribuir');
  byArea = await trailsByArea();
});
afterAll(() => pool.end());

const recognize = (who: string, trail: string) =>
  rpc(w.users.Ana, 'recognize_in_negotiation', { p_membership: w.members[who], p_trail: trail, p_comment: 'Demonstrado antes da aplicação.', p_reference_date: null });

describe('distribuir trilhos já validados pelas etapas', () => {
  it('conclui as etapas completas e deixa o resto na etapa em curso', async () => {
    await rpc(w.users.Ana, 'record_adhesion', { p_membership: w.members.P1, p_decided_on: today(), p_commitment_on: today(), p_notes: null, p_is_historical: false });
    // 16 trilhos validados: faltam o 2.º do Afetivo e o 2.º do Intelectual (como o Duarte).
    for (const code of Object.keys(byArea)) {
      for (const [i, t] of byArea[code].entries()) {
        if ((code === 'A' || code === 'I') && i === 1) continue;
        await recognize('P1', t.id);
      }
    }
    expect(await pos(w.members.P1)).toEqual({ milestone: 'conhecimento', state: 'em_curso' });
    await expectError(rpc(w.users.GuiaA, 'place_previous_progress', { p_membership: w.members.P1 }), 'dirigentes');

    const r = await rpc(w.users.Ana, 'place_previous_progress', { p_membership: w.members.P1 });
    expect(r).toEqual({ concluidas: ['Conhecimento', 'Vontade'], atribuidos: 16, etapa: 'Construção' });
    expect(await pos(w.members.P1)).toEqual({ milestone: 'construcao', state: 'em_curso' });

    const paths = await admin(`select stage_key, status::text, completion_kind from public.stage_paths where membership_id = $1 order by stage_ordinal`, [w.members.P1]);
    expect(paths).toEqual([
      { stage_key: 'conhecimento', status: 'concluida', completion_kind: 'historico' },
      { stage_key: 'vontade', status: 'concluida', completion_kind: 'historico' },
      { stage_key: 'construcao', status: 'em_curso', completion_kind: null },
    ]);
    const open = await admin(`select c.area_code from public.stage_choices c join public.stage_paths p on p.id = c.stage_path_id
      where c.membership_id = $1 and p.status = 'em_curso' and c.status = 'confirmada' order by c.area_code`, [w.members.P1]);
    expect(open.map((x) => x.area_code)).toEqual(['C', 'E', 'F', 'S']);
    // Nenhum pedido ao Conselho ficou aberto e os dirigentes não foram notificados
    expect(await admin(`select 1 from public.stage_requests where membership_id = $1 and status in ('submetido', 'decidido_conselho')`, [w.members.P1])).toHaveLength(0);
    expect(await admin(`select 1 from public.notifications where profile_id = $1 and kind = 'pedido_etapa'`, [w.users.Rui])).toHaveLength(0);

    // Correr de novo não muda nada
    expect(await rpc(w.users.Ana, 'place_previous_progress', { p_membership: w.members.P1 })).toEqual({ concluidas: [], atribuidos: 0, etapa: 'Construção' });
  });

  it('exige a Promessa', async () => {
    await expectError(rpc(w.users.Ana, 'place_previous_progress', { p_membership: w.members.P2 }), 'Promessa');
  });
});
