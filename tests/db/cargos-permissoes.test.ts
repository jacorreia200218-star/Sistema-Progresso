// Cargos que dão permissões: a administração liga um cargo (p. ex. Tesoureiro) a uma permissão
// de alteração; quem está nomeado tem-na enquanto a nomeação durar e perde-a quando termina.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, buildWorld, expectDenied, expectError, pool, rpc, type World } from './helpers';

let w: World;
const S = () => ({ p_section: w.section });
const todayLx = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date());
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const roleByName = async (name: string) => (await rpc<any>(w.users.Ana, 'eq_overview', S())).roles.find((r: any) => r.name === name).id as string;
const grantsOf = async (who: string, module: string) =>
  ((await rpc<any[]>(w.users[who], 'my_modules', S())).find((m) => m.module === module)?.grants ?? []) as string[];
const listMovements = (who: string) => rpc(w.users[who], 'fin_list_movements', S());
const link = (role: string, perm: string, on = true, who = 'Ana') =>
  rpc(w.users[who], 'set_module_role_grant', { ...S(), p_role: role, p_permission: perm, p_on: on });

let tesoureiro: string;
let intendente: string;
let guia: string;
let manualBefore: number;

beforeAll(async () => {
  w = await buildWorld('cargosperm');
  for (const m of ['equipas', 'tesouraria', 'inventario']) {
    await rpc(w.users.Ana, 'set_module_status', { ...S(), p_module: m, p_status: 'disponivel' });
  }
  await rpc(w.users.Ana, 'eq_seed_roles', S());
  tesoureiro = await roleByName('Tesoureiro');
  intendente = await roleByName('Intendente');
  guia = await roleByName('Guia');
  manualBefore = Number((await admin(`select count(*) from public.module_grants where section_id = $1`, [w.section]))[0].count);
});
afterAll(() => pool.end());

describe('cargos que dão permissões', () => {
  it('por omissão nenhum cargo dá permissões', async () => {
    await rpc(w.users.Ana, 'eq_appoint', { ...S(), p_role: tesoureiro, p_team: w.teamA, p_membership: w.members.P1, p_starts_on: todayLx() });
    await expectDenied(listMovements('P1'), 'permissão');
    expect(await grantsOf('P1', 'tesouraria')).toEqual([]);
  });

  it('só a administração liga cargos a permissões, e só Tesouraria e Inventário', async () => {
    await expectDenied(link(tesoureiro, 'tesouraria.gerir', true, 'Rui'), 'Reservado');
    await expectDenied(link(tesoureiro, 'tesouraria.gerir', true, 'P1'), 'Reservado');
    await expectError(link(tesoureiro, 'equipas.gerir'), 'só podem dar');
    await expectDenied(rpc(w.users.Rui, 'module_role_grants_overview', S()), 'Reservado');
  });

  it('o tesoureiro nomeado passa a mexer na Tesouraria; o resto da equipa não', async () => {
    await link(tesoureiro, 'tesouraria.gerir');
    await listMovements('P1');
    expect(await grantsOf('P1', 'tesouraria')).toEqual(['tesouraria.gerir']);
    await expectDenied(listMovements('P2'), 'permissão');
    const ov = await rpc<any>(w.users.Ana, 'module_role_grants_overview', S());
    expect(ov.links).toEqual([{ role_id: tesoureiro, permission: 'tesouraria.gerir' }]);
    expect(ov.holders).toEqual([expect.objectContaining({ permission: 'tesouraria.gerir', profile_id: w.users.P1, role_name: 'Tesoureiro', team_name: 'Equipa A' })]);
    expect(await rpc(w.users.P2, 'eq_role_grants', S())).toEqual([{ role_id: tesoureiro, permission: 'tesouraria.gerir' }]);
  });

  it('o intendente passa a gerir o material e a receber os avisos de responsável', async () => {
    await link(intendente, 'inventario.gerir');
    await rpc(w.users.Ana, 'eq_appoint', { ...S(), p_role: intendente, p_team: w.teamB, p_membership: w.members.P3, p_starts_on: todayLx() });
    expect((await rpc<any>(w.users.P3, 'inv_overview', S())).can_manage).toBe(true);
    expect((await rpc<any>(w.users.P2, 'inv_overview', S())).can_manage).toBe(false);
    const managers = (await admin(`select private.inv_managers($1) as m`, [w.section]))[0].m as string[];
    expect(managers).toContain(w.users.P3);
  });

  it('uma nomeação futura ainda não dá a permissão', async () => {
    await rpc(w.users.Ana, 'eq_appoint', { ...S(), p_role: intendente, p_team: w.teamA, p_membership: w.members.P2, p_starts_on: addDays(todayLx(), 5) });
    expect((await rpc<any>(w.users.P2, 'inv_overview', S())).can_manage).toBe(false);
  });

  it('quando a nomeação termina ou é anulada, a permissão acaba sozinha', async () => {
    const appt = (await admin(`select id from public.eq_appointments where membership_id = $1 and role_id = $2`, [w.members.P1, tesoureiro]))[0].id;
    await rpc(w.users.Ana, 'eq_end_appointment', { ...S(), p_appointment: appt, p_ends_on: todayLx(), p_reason: 'Fim do mandato' });
    await expectDenied(listMovements('P1'), 'permissão');
    const appt3 = (await admin(`select id from public.eq_appointments where membership_id = $1 and role_id = $2`, [w.members.P3, intendente]))[0].id;
    await rpc(w.users.Ana, 'eq_cancel_appointment', { ...S(), p_appointment: appt3, p_reason: 'Engano' });
    expect((await rpc<any>(w.users.P3, 'inv_overview', S())).can_manage).toBe(false);
  });

  it('dirigentes não recebem a Tesouraria por cargo', async () => {
    // Rui passa a dirigente de uma equipa e é nomeado tesoureiro: continua sem acesso.
    await admin(`update public.memberships set team_id = $1 where id = $2`, [w.teamB, w.members.Rui]);
    await rpc(w.users.Ana, 'eq_appoint', { ...S(), p_role: tesoureiro, p_team: w.teamB, p_membership: w.members.Rui, p_starts_on: todayLx() });
    await expectDenied(listMovements('Rui'), 'permissão');
  });

  it('desligar o cargo retira a permissão; as permissões dadas à mão não mudam', async () => {
    await rpc(w.users.Ana, 'eq_appoint', { ...S(), p_role: tesoureiro, p_team: w.teamA, p_membership: w.members.P2, p_starts_on: addDays(todayLx(), 1) });
    await link(guia, 'tesouraria.gerir');
    await rpc(w.users.Ana, 'eq_appoint', { ...S(), p_role: guia, p_team: w.teamA, p_membership: w.members.GuiaA, p_starts_on: todayLx() });
    await listMovements('GuiaA');
    await link(guia, 'tesouraria.gerir', false);
    await expectDenied(listMovements('GuiaA'), 'permissão');
    expect(Number((await admin(`select count(*) from public.module_grants where section_id = $1`, [w.section]))[0].count)).toBe(manualBefore);
  });
});
