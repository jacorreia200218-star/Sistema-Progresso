// Equipas e cargos: acesso, cargos configuráveis, nomeações (guia único), histórico,
// mudanças de equipa e isolamento entre o espaço de teste e o real.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, buildWorld, expectDenied, expectError, pool, rpc, setupModule, type World } from './helpers';

let w: World;
const S = () => ({ p_section: w.section });
const ov = (who: string) => rpc<any>(w.users[who], 'eq_overview', S());
const roleId = async (who: string, kind: string) => (await ov(who)).roles.find((r: any) => r.kind === kind && !r.archived_at).id as string;
const roleByName = async (who: string, name: string) => (await ov(who)).roles.find((r: any) => r.name === name).id as string;
const todayLx = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date());
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const appoint = (who: string, role: string, team: string, member: string, start = todayLx(), extra: Record<string, unknown> = {}) =>
  rpc<string>(w.users[who], 'eq_appoint', { ...S(), p_role: role, p_team: team, p_membership: w.members[member], p_starts_on: start, ...extra });
const teamOf = async (member: string) => (await admin(`select team_id from public.memberships where id = $1`, [w.members[member]]))[0].team_id;

let grantsBefore: number;
let pedagogicalBefore: number;

beforeAll(async () => {
  w = await buildWorld('equipas');
  // Testers: Ana (admin+dirigente), Rui (dirigente), P1 (editor com equipas.gerir), P2 e GuiaA (só consulta).
  await setupModule(w, 'equipas', 'teste', ['Ana', 'Rui', 'P1', 'P2', 'GuiaA'], [['equipas.gerir', 'P1']]);
  grantsBefore = Number((await admin(`select count(*) from public.module_grants where section_id = $1`, [w.section]))[0].count);
  pedagogicalBefore = Number((await admin(`select (select count(*) from public.trail_requests where section_id = $1) + (select count(*) from public.trail_decisions d join public.trail_requests r on r.id = d.request_id where r.section_id = $1) as n`, [w.section]))[0].n);
});
afterAll(() => pool.end());

describe('acesso', () => {
  it('membro sem acesso e admin não tester são recusados no servidor', async () => {
    await expectDenied(ov('P3'));
    await expectDenied(ov('Tecnico'));
    await expectDenied(rpc(w.users.P3, 'eq_seed_roles', S()));
  });

  it('tester só de consulta vê, mas não gere', async () => {
    const o = await ov('P2');
    expect(o).toMatchObject({ space: 'teste', can_manage: false });
    await expectDenied(rpc(w.users.P2, 'eq_seed_roles', S()), 'permissão');
    await expectDenied(rpc(w.users.P2, 'eq_save_identity', { ...S(), p_team: w.teamA, p_color: '#336699', p_motto: 'x' }), 'permissão');
    await expectDenied(rpc(w.users.P2, 'eq_move_member', { ...S(), p_membership: w.members.P2, p_to_team: w.teamB, p_effective_on: todayLx(), p_reason: null }), 'permissão');
  });

  it('tester editor (equipas.gerir), dirigente e administração gerem', async () => {
    expect((await ov('P1')).can_manage).toBe(true);
    expect((await ov('Rui')).can_manage).toBe(true);
    expect((await ov('Ana')).can_manage).toBe(true);
    expect(await rpc(w.users.P1, 'eq_seed_roles', S())).toBe(7);
    expect(await rpc(w.users.Ana, 'eq_seed_roles', S())).toBe(0); // sem duplicados
  });
});

describe('equipas e cargos configuráveis', () => {
  it('identidade da equipa sem alterar teams', async () => {
    await rpc(w.users.Rui, 'eq_save_identity', { ...S(), p_team: w.teamA, p_color: '#2f7d4f', p_motto: 'Sempre alerta' });
    await expectError(rpc(w.users.Rui, 'eq_save_identity', { ...S(), p_team: w.teamA, p_color: 'verde', p_motto: '' }), 'cor válida');
    const t = (await ov('P2')).teams.find((x: any) => x.id === w.teamA);
    expect(t).toMatchObject({ name: 'Equipa A', color: '#2f7d4f', motto: 'Sempre alerta', emblem: null });
  });

  it('cargos com responsabilidades; tipo fixo; nomes únicos', async () => {
    const id = await rpc<string>(w.users.P1, 'eq_save_role', { ...S(), p_role: null, p_name: 'Guarda-livros', p_kind: 'cargo', p_description: 'Mantém o livro de equipa.', p_single: true });
    await rpc(w.users.P1, 'eq_save_role', { ...S(), p_role: id, p_name: 'Cronista', p_kind: 'guia', p_description: 'Escreve a crónica.', p_single: false });
    const r = (await ov('P2')).roles.find((x: any) => x.id === id);
    expect(r).toMatchObject({ name: 'Cronista', kind: 'cargo', description: 'Escreve a crónica.', single: false });
    await expectError(rpc(w.users.P1, 'eq_save_role', { ...S(), p_role: null, p_name: 'Outro guia', p_kind: 'guia', p_description: null, p_single: false }), 'Já existe');
    await expectError(rpc(w.users.P1, 'eq_save_role', { ...S(), p_role: null, p_name: 'cronista', p_kind: 'cargo', p_description: null, p_single: false }), 'Já existe');
    await rpc(w.users.P1, 'eq_set_role_archived', { ...S(), p_role: id, p_archived: true });
    await expectError(appoint('P1', id, w.teamA, 'P2'), 'arquivado');
  });
});

describe('nomeações e histórico de cargos', () => {
  it('guia único por equipa, validado no servidor; passagem de testemunho no mesmo dia', async () => {
    const guia = await roleId('Ana', 'guia');
    const sub = await roleId('Ana', 'subguia');
    const start = addDays(todayLx(), -40);
    const a1 = await appoint('Ana', guia, w.teamA, 'GuiaA', start);
    await expectError(appoint('Ana', guia, w.teamA, 'P2', addDays(todayLx(), -10)), 'já tem Guia');
    await expectError(appoint('Ana', guia, w.teamA, 'P3'), 'não pertence a esta equipa');
    await expectError(appoint('Ana', sub, w.teamA, 'GuiaA'), 'guia e subguia');
    const s1 = await appoint('Ana', sub, w.teamA, 'P2', start);
    await expectError(appoint('P2', sub, w.teamA, 'P1'), 'permissão');
    // Terminar: define a data de fim, nunca apaga
    await expectError(rpc(w.users.Ana, 'eq_end_appointment', { ...S(), p_appointment: a1, p_ends_on: addDays(start, -1), p_reason: null }), 'anterior à de início');
    await rpc(w.users.Ana, 'eq_end_appointment', { ...S(), p_appointment: a1, p_ends_on: todayLx(), p_reason: 'Fim de mandato' });
    await expectError(rpc(w.users.Ana, 'eq_end_appointment', { ...S(), p_appointment: a1, p_ends_on: todayLx(), p_reason: null }), 'já terminou');
    await expectError(appoint('Ana', guia, w.teamA, 'P2'), 'guia e subguia');
    await rpc(w.users.Ana, 'eq_end_appointment', { ...S(), p_appointment: s1, p_ends_on: todayLx(), p_reason: 'Passa a guia' });
    await appoint('Ana', guia, w.teamA, 'P2');
    const hist = (await ov('Ana')).appointments.filter((a: any) => a.team_id === w.teamA && a.role_id === guia);
    expect(hist.map((a: any) => [a.membership_id, a.ends_on])).toEqual([[w.members.P2, null], [w.members.GuiaA, todayLx()]]);
    expect(hist[1]).toMatchObject({ end_reason: 'Fim de mandato', ended_by_name: expect.stringContaining('Ana') });
    expect(Number((await admin(`select count(*) from public.eq_appointments where section_id = $1`, [w.section]))[0].count)).toBe(3);
  });

  it('nomeações em simultâneo para guia: só uma é aceite', async () => {
    const guia = await roleId('Ana', 'guia');
    const res = await Promise.allSettled([appoint('Ana', guia, w.teamB, 'GuiaB'), appoint('Rui', guia, w.teamB, 'P3')]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(String((res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.message)).toMatch(/já tem Guia|em funções/);
  });

  it('anular regista o motivo e mantém o registo; lembretes antes do fim sem duplicados', async () => {
    const sec = await roleByName('Ana', 'Secretário');
    await expectError(appoint('Ana', sec, w.teamA, 'P1', todayLx(), { p_ends_on: addDays(todayLx(), -1) }), 'anterior à de início');
    const id = await appoint('Ana', sec, w.teamA, 'P1', todayLx(), { p_ends_on: addDays(todayLx(), 30), p_remind_days: 7 });
    let rem = await admin(`select due_at, cancelled_at, space from public.module_reminders where entity_id = $1`, [id]);
    expect(rem).toHaveLength(1);
    expect(rem[0]).toMatchObject({ cancelled_at: null, space: 'teste' });
    await rpc(w.users.Ana, 'eq_end_appointment', { ...S(), p_appointment: id, p_ends_on: addDays(todayLx(), 20), p_reason: null });
    rem = await admin(`select due_at, cancelled_at from public.module_reminders where entity_id = $1`, [id]);
    expect(rem).toHaveLength(1);
    await expectError(rpc(w.users.Ana, 'eq_cancel_appointment', { ...S(), p_appointment: id, p_reason: ' ' }), 'motivo');
    await rpc(w.users.Ana, 'eq_cancel_appointment', { ...S(), p_appointment: id, p_reason: 'Registado por engano' });
    expect((await admin(`select cancelled_at from public.module_reminders where entity_id = $1`, [id]))[0].cancelled_at).not.toBeNull();
    expect((await ov('Ana')).appointments.find((a: any) => a.id === id)).toMatchObject({ cancel_reason: 'Registado por engano' });
    expect((await ov('P1')).appointments.find((a: any) => a.id === id)).toBeTruthy(); // o próprio vê
    expect((await ov('GuiaA')).appointments.find((a: any) => a.id === id)).toBeUndefined(); // os outros não veem anuladas
  });

  it('notifica a pessoa nomeada (no teste só testers, com [Teste])', async () => {
    const n = await admin(`select profile_id, title from public.notifications where section_id = $1 and kind = 'eq_cargo'`, [w.section]);
    expect(n.some((x) => x.profile_id === w.users.GuiaA && x.title === '[Teste] Novo cargo')).toBe(true);
    expect(n.some((x) => x.profile_id === w.users.GuiaB || x.profile_id === w.users.P3)).toBe(false); // não testers
  });

  it('um cargo nunca dá permissões (grants, admin ou função)', async () => {
    expect(Number((await admin(`select count(*) from public.module_grants where section_id = $1`, [w.section]))[0].count)).toBe(grantsBefore);
    const m = await admin(`select function, is_admin from public.memberships where id = $1`, [w.members.P2]);
    expect(m[0]).toEqual({ function: 'pioneiro', is_admin: false });
    const mods = await rpc<any[]>(w.users.P2, 'my_modules', S());
    expect(mods.every((x) => x.grants.length === 0)).toBe(true);
    expect((await ov('P2')).can_manage).toBe(false); // P2 é guia (cargo) mas continua só de consulta
    await expectDenied(rpc(w.users.P2, 'set_module_grant', { ...S(), p_permission: 'tesouraria.gerir', p_profile: w.users.P2, p_on: true }), 'Reservado');
  });

  it('quem não gere vê todas as equipas e pessoas, mas não as mudanças dos outros', async () => {
    const names = (await ov('GuiaA')).members.map((m: any) => m.membership_id);
    expect(names).toEqual(expect.arrayContaining([w.members.GuiaA, w.members.P1, w.members.P2, w.members.P3, w.members.Rui]));
    expect((await ov('GuiaA')).moves.every((x: any) => x.membership_id === w.members.GuiaA)).toBe(true);
    expect((await ov('Ana')).members.length).toBeGreaterThanOrEqual(8);
  });

  it('emblema: só quem gere anexa', async () => {
    await expectDenied(rpc(w.users.P2, 'module_file_prepare', { ...S(), p_module: 'equipas', p_entity: 'equipa', p_entity_id: w.teamA, p_file_name: 'emblema.png', p_mime: 'image/png' }), 'anexar');
    const path = await rpc<string>(w.users.P1, 'module_file_prepare', { ...S(), p_module: 'equipas', p_entity: 'equipa', p_entity_id: w.teamA, p_file_name: 'emblema.png', p_mime: 'image/png' });
    expect(path).toContain('/equipas/teste/');
    expect((await ov('P2')).teams.find((t: any) => t.id === w.teamA).emblem).toMatchObject({ path, file_name: 'emblema.png' });
  });
});

describe('mudanças de equipa e isolamento teste/real', () => {
  it('no teste, a mudança fica só no histórico do módulo e NÃO toca memberships', async () => {
    const histBefore = Number((await admin(`select count(*) from public.membership_history where membership_id = $1`, [w.members.P2]))[0].count);
    await expectError(rpc(w.users.P1, 'eq_move_member', { ...S(), p_membership: w.members.P2, p_to_team: w.teamA, p_effective_on: todayLx(), p_reason: null }), 'já pertence');
    await expectError(rpc(w.users.P1, 'eq_move_member', { ...S(), p_membership: w.members.Rui, p_to_team: w.teamA, p_effective_on: todayLx(), p_reason: null }), 'pioneiros e guias');
    await expectError(rpc(w.users.P1, 'eq_move_member', { ...S(), p_membership: w.members.P2, p_to_team: w.teamB, p_effective_on: addDays(todayLx(), 2), p_reason: null }), 'futura');
    await rpc(w.users.P1, 'eq_move_member', { ...S(), p_membership: w.members.P2, p_to_team: w.teamB, p_effective_on: todayLx(), p_reason: 'Equilíbrio das equipas' });
    expect(await teamOf('P2')).toBe(w.teamA);
    expect(Number((await admin(`select count(*) from public.membership_history where membership_id = $1`, [w.members.P2]))[0].count)).toBe(histBefore);
    const o = await ov('Ana');
    expect(o.members.find((m: any) => m.membership_id === w.members.P2).team_id).toBe(w.teamB);
    expect(o.moves.find((m: any) => m.source === 'modulo' && m.membership_id === w.members.P2)).toMatchObject({ from_team_id: w.teamA, to_team_id: w.teamB, applied: false, reason: 'Equilíbrio das equipas' });
    // O cargo de guia na equipa anterior terminou com a mudança
    const guia = o.roles.find((r: any) => r.kind === 'guia').id;
    expect(o.appointments.find((a: any) => a.membership_id === w.members.P2 && a.role_id === guia)).toMatchObject({ ends_on: todayLx(), end_reason: 'Mudança de equipa' });
    const n = await admin(`select title from public.notifications where profile_id = $1 and kind = 'eq_equipa'`, [w.users.P2]);
    expect(n).toEqual([{ title: '[Teste] Mudança de equipa' }]);
  });

  it('publicar sem passar dados: o espaço real começa vazio e a equipa real não mudou', async () => {
    await setupModule(w, 'equipas', 'disponivel');
    const o = await ov('Tecnico'); // administração técnica gere no espaço real
    expect(o).toMatchObject({ space: 'real', can_manage: true, roles: [], appointments: [] });
    expect(o.teams.find((t: any) => t.id === w.teamA)).toMatchObject({ color: null, motto: null, emblem: null });
    expect(o.members.find((m: any) => m.membership_id === w.members.P2).team_id).toBe(w.teamA);
    expect(o.moves.every((m: any) => m.source === 'gestao')).toBe(true);
    expect((await ov('P3')).can_manage).toBe(false);
  });

  it('no real, a mudança atualiza memberships.team_id e o histórico na mesma transação', async () => {
    await rpc(w.users.Rui, 'eq_seed_roles', S());
    const guia = await roleId('Rui', 'guia');
    await appoint('Rui', guia, w.teamA, 'P1', addDays(todayLx(), -5));
    await rpc(w.users.Rui, 'eq_move_member', { ...S(), p_membership: w.members.P1, p_to_team: w.teamB, p_effective_on: todayLx(), p_reason: 'Pedido do próprio' });
    expect(await teamOf('P1')).toBe(w.teamB);
    const h = await admin(`select old_team_id, new_team_id, reason from public.membership_history where membership_id = $1 order by changed_at desc limit 1`, [w.members.P1]);
    expect(h[0]).toEqual({ old_team_id: w.teamA, new_team_id: w.teamB, reason: 'Equipas e cargos: Pedido do próprio' });
    const o = await ov('Rui');
    const mv = o.moves.filter((m: any) => m.membership_id === w.members.P1 && m.to_team_id === w.teamB);
    expect(mv).toEqual([expect.objectContaining({ source: 'modulo', applied: true })]); // sem duplicado
    expect(o.appointments.find((a: any) => a.membership_id === w.members.P1)).toMatchObject({ ends_on: todayLx(), end_reason: 'Mudança de equipa' });
    expect(Number((await admin(`select count(*) from public.eq_team_moves where membership_id = $1 and space = 'real'`, [w.members.P1]))[0].count)).toBe(1);
    // Os registos de teste continuam separados
    expect(Number((await admin(`select count(*) from public.eq_team_moves where section_id = $1 and space = 'teste'`, [w.section]))[0].count)).toBe(1);
  });

  it('falha numa mudança real não deixa histórico a meio', async () => {
    await expectError(rpc(w.users.Rui, 'eq_move_member', { ...S(), p_membership: w.members.P3, p_to_team: w.teamA, p_effective_on: todayLx(), p_reason: 'x'.repeat(600) }), 'até 500');
    expect(await teamOf('P3')).toBe(w.teamB);
    expect(Number((await admin(`select count(*) from public.eq_team_moves where membership_id = $1`, [w.members.P3]))[0].count)).toBe(0);
  });

  it('não altera o histórico pedagógico nem as permissões', async () => {
    const n = Number((await admin(`select (select count(*) from public.trail_requests where section_id = $1) + (select count(*) from public.trail_decisions d join public.trail_requests r on r.id = d.request_id where r.section_id = $1) as n`, [w.section]))[0].n);
    expect(n).toBe(pedagogicalBefore);
    expect(Number((await admin(`select count(*) from public.module_grants where section_id = $1`, [w.section]))[0].count)).toBe(grantsBefore);
  });

  it('ao publicar, as simulações de teste não passam a reais', async () => {
    await expectError(rpc(w.users.Ana, 'set_module_status', { ...S(), p_module: 'equipas', p_status: 'disponivel', p_move_test_data: true }), 'não passam a reais');
    expect(Number((await admin(`select count(*) from public.eq_team_moves where section_id = $1 and space = 'teste'`, [w.section]))[0].count)).toBe(1);
  });

  it('desativar não apaga dados', async () => {
    await setupModule(w, 'equipas', 'desenvolvimento');
    await expectDenied(ov('Ana'));
    expect(Number((await admin(`select count(*) from public.eq_appointments where section_id = $1`, [w.section]))[0].count)).toBeGreaterThan(0);
  });
});
