// Pedido por objetivos: seleção parcial, validação parcial, duplicações,
// reenvio após «A rever», fecho do trilho só com todos os objetivos e
// preservação dos pedidos antigos (por trilho).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, buildWorld, expectError, pool, rpc, today, validateTrail, type World } from './helpers';

let w: World;
let trail: string; // Autoconhecimento (F2, F3)
let f2: string;
let f3: string;

const objectives = async (key: string) =>
  admin<{ id: string; code: string }>(`select o.id, o.code from public.catalog_objectives o join public.catalog_trails t on t.id = o.trail_id where t.key = $1 order by o.position`, [key]);
const status = async (req: string) => (await admin(`select status::text from public.trail_requests where id = $1`, [req]))[0].status as string;
const validatedKeys = async (who: string) => (await admin(`select private.validated_trail_keys($1) k`, [w.members[who]])).map((r) => r.k);
const newRequest = (who: string, t = trail) => rpc<string>(w.users[who], 'create_trail_request', { p_membership: w.members[who], p_trail: t, p_kind: 'normal' });
const send = (who: string, req: string, ids: string[], text = 'No raid ajudei a equipa a adaptar o percurso e aprendi a aceitar os meus limites.', version = 1) =>
  rpc(w.users[who], 'submit_objectives_request', { p_request: req, p_expected_version: version, p_objectives: ids, p_justification: text });
const decide = (who: string, req: string, decisions: { objective_id: string; accepted: boolean; comment?: string }[], comment: string | null = null, version = 1) =>
  rpc<string>(w.users[who], 'record_objectives_decision', { p_request: req, p_expected_version: version, p_meeting_date: today(), p_decisions: JSON.stringify(decisions), p_comment: comment });

beforeAll(async () => {
  w = await buildWorld('objetivos');
  trail = (await admin(`select id from public.catalog_trails where key = 'fisico-autoconhecimento'`))[0].id;
  const o = await objectives('fisico-autoconhecimento');
  expect(o.map((x) => x.code)).toEqual(['F2', 'F3']);
  [f2, f3] = [o[0].id, o[1].id];
});
afterAll(() => pool.end());

describe('envio', () => {
  it('exige objetivos do próprio trilho e justificação; não exige etapa, escolha nem vivências', async () => {
    const req = await newRequest('P1');
    await expectError(send('P1', req, []), 'pelo menos um objetivo');
    const other = (await objectives('fisico-desempenho'))[0].id;
    await expectError(send('P1', req, [f2, other]), 'não pertencem');
    await expectError(send('P1', req, [f2], '   '), 'Explica como');
    await expectError(send('P2', req, [f2]), 'não encontrado');
    await send('P1', req, [f2, f2]); // duplicado na mesma seleção conta uma vez
    expect(await status(req)).toBe('submetido');
    const rows = await asUser(w.users.P1, `select objective_code, decision from public.request_objectives where request_id = $1`, [req]);
    expect(rows).toEqual([{ objective_code: 'F2', decision: null }]);
    const v = await asUser(w.users.P1, `select evidence from public.trail_request_versions where request_id = $1`, [req]);
    expect(v[0].evidence).toContain('raid');
    // Não pode reenviar nem criar outro pedido para o mesmo trilho enquanto está pendente
    await expectError(send('P1', req, [f3]), 'já foi enviado');
    await expectError(newRequest('P1'), 'Já existe um pedido ativo');
    // O envio não valida nada
    expect(await validatedKeys('P1')).toEqual([]);
  });

  it('o próprio não decide; outro guia de outra equipa também não; objetivos de outro pioneiro são invisíveis', async () => {
    const req = (await admin(`select id from public.trail_requests where membership_id = $1`, [w.members.P1]))[0].id;
    await expectError(decide('P1', req, [{ objective_id: f2, accepted: true }]), 'Sem permissão');
    await expectError(decide('GuiaB', req, [{ objective_id: f2, accepted: true }]), 'Sem permissão');
    expect(await asUser(w.users.P3, `select * from public.request_objectives where request_id = $1`, [req])).toHaveLength(0);
    expect(await asUser(w.users.GuiaA, `select * from public.request_objectives where request_id = $1`, [req])).toHaveLength(1);
    await expectError(rpc(w.users.GuiaA, 'record_team_decision', { p_request: req, p_expected_version: 1, p_validated: true, p_meeting_date: today(), p_comment: null }), 'decide cada objetivo');
  });
});

describe('validação parcial', () => {
  it('aceitar F2 não fecha o trilho; F3 pode ser pedido depois; F2 não pode ser pedido de novo', async () => {
    const req = (await admin(`select id from public.trail_requests where membership_id = $1`, [w.members.P1]))[0].id;
    await expectError(decide('GuiaA', req, []), 'Decide todos');
    await expectError(decide('GuiaA', req, [{ objective_id: f3, accepted: true }]), 'não está neste pedido');
    expect(await decide('GuiaA', req, [{ objective_id: f2, accepted: true }])).toBe('objetivos_validados');
    expect(await status(req)).toBe('objetivos_validados');
    expect(await validatedKeys('P1')).toEqual([]); // trilho por fechar
    await expectError(decide('GuiaA', req, [{ objective_id: f2, accepted: true }]), 'já foi decidido');

    const req2 = await newRequest('P1');
    await expectError(send('P1', req2, [f2, f3]), 'já estão validados');
    await send('P1', req2, [f3]);
    expect(await decide('GuiaA', req2, [{ objective_id: f3, accepted: true }])).toBe('validado_equipa');
    expect(await validatedKeys('P1')).toEqual(['fisico-autoconhecimento']);
    await expectError(newRequest('P1'), 'Já existe um pedido ativo');
  });

  it('a rever: comentário obrigatório; reenvio só dos objetivos por aceitar, com histórico', async () => {
    const req = await newRequest('P2');
    await send('P2', req, [f2, f3]);
    await expectError(decide('GuiaA', req, [{ objective_id: f2, accepted: true }, { objective_id: f3, accepted: false }]), 'Explica o que falta');
    expect(await decide('GuiaA', req, [{ objective_id: f2, accepted: true }, { objective_id: f3, accepted: false, comment: 'Falta dar um exemplo concreto do F3.' }])).toBe('devolvido');
    expect(await validatedKeys('P2')).toEqual([]);
    await rpc(w.users.P2, 'start_new_version', { p_request: req });
    const v2 = await asUser(w.users.P2, `select ro.objective_code, ro.decision from public.request_objectives ro join public.trail_request_versions v on v.id = ro.version_id where ro.request_id = $1 and v.version_no = 2`, [req]);
    expect(v2).toEqual([{ objective_code: 'F3', decision: null }]);
    await expectError(send('P2', req, [f2, f3], 'Corrigido', 2), 'já estão validados');
    await expectError(send('P2', req, [f3], 'Corrigido', 1), 'mudou entretanto');
    await send('P2', req, [f3], 'Dei o exemplo da semana da mobilidade.', 2);
    expect(await decide('GuiaA', req, [{ objective_id: f3, accepted: true }], null, 2)).toBe('validado_equipa');
    expect(await validatedKeys('P2')).toEqual(['fisico-autoconhecimento']);
    const hist = await asUser(w.users.P2, `select v.version_no, ro.objective_code, ro.decision, ro.comment from public.request_objectives ro join public.trail_request_versions v on v.id = ro.version_id where ro.request_id = $1 order by 1, 2`, [req]);
    expect(hist.map((h) => `${h.version_no}${h.objective_code}:${h.decision}`)).toEqual(['1F2:aceite', '1F3:rever', '2F3:aceite']);
  });

  it('cancelar um pedido com objetivos aceites mantém os aceites', async () => {
    const req = await newRequest('P3');
    await send('P3', req, [f2, f3]);
    await decide('GuiaB', req, [{ objective_id: f2, accepted: true }, { objective_id: f3, accepted: false, comment: 'Ainda não.' }]);
    await rpc(w.users.P3, 'cancel_trail_request', { p_request: req });
    expect(await status(req)).toBe('objetivos_validados');
    const req2 = await newRequest('P3');
    await expectError(send('P3', req2, [f2]), 'já estão validados');
    await rpc(w.users.P3, 'cancel_trail_request', { p_request: req2 });
    expect(await status(req2)).toBe('cancelado');
  });

  it('devolução do Conselho de Guias volta a pôr os objetivos da versão «a rever»', async () => {
    const req = (await admin(`select id from public.trail_requests where membership_id = $1 and status = 'validado_equipa'`, [w.members.P2]))[0].id;
    await rpc(w.users.Ana, 'record_council_return', { p_request: req, p_meeting_date: today(), p_comment: 'Incoerente com a atitude.' });
    expect(await validatedKeys('P2')).toEqual([]);
    await rpc(w.users.P2, 'start_new_version', { p_request: req });
    const v3 = await admin(`select ro.objective_code from public.request_objectives ro join public.trail_request_versions v on v.id = ro.version_id where ro.request_id = $1 and v.version_no = 3`, [req]);
    expect(v3.map((r) => r.objective_code)).toEqual(['F3']);
  });
});

describe('concorrência', () => {
  it('duas decisões em simultâneo sobre o mesmo pedido: só uma fica registada', async () => {
    const t = (await admin(`select id from public.catalog_trails where key = 'fisico-bem-estar-fisico'`))[0].id;
    const f4 = (await objectives('fisico-bem-estar-fisico'))[0].id;
    const req = await newRequest('P2', t);
    await send('P2', req, [f4]);
    const results = await Promise.allSettled([
      decide('GuiaA', req, [{ objective_id: f4, accepted: true }]),
      decide('Ana', req, [{ objective_id: f4, accepted: false, comment: 'Falta' }]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const n = await admin(`select count(*)::int n from public.trail_decisions where request_id = $1`, [req]);
    expect(n[0].n).toBe(1);
  });

  it('dois envios em simultâneo para o mesmo trilho: só um pedido fica ativo', async () => {
    const t = (await admin(`select id from public.catalog_trails where key = 'social-solidariedade-e-tolerancia'`))[0].id;
    const results = await Promise.allSettled([newRequest('P3', t), newRequest('P3', t)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('pedidos antigos', () => {
  it('pedidos por trilho continuam a ser criados, submetidos e decididos como antes', async () => {
    const t = (await admin(`select id from public.catalog_trails where key = 'afetivo-autoestima'`))[0].id;
    const req = await validateTrail(w, 'P1', t);
    expect(await status(req)).toBe('validado_equipa');
    expect(await admin(`select * from public.request_objectives where request_id = $1`, [req])).toHaveLength(0);
    // Um pedido antigo não pode ser enviado como pedido por objetivos depois de decidido
    await expectError(send('P1', req, [f2]), 'já foi enviado');
  });
});
