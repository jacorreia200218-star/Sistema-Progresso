// Base dos módulos: estados, testers, permissões, espaço de teste, notificações e lembretes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, buildWorld, expectDenied, pool, rpc, setupModule, type World } from './helpers';

let w: World;
const mods = async (who: string) => Object.fromEntries((await rpc<any[]>(w.users[who], 'my_modules', { p_section: w.section })).map((m) => [m.module, m]));

beforeAll(async () => { w = await buildWorld('modulos'); });
afterAll(() => pool.end());

describe('estados e testers', () => {
  it('começa tudo em desenvolvimento, sem acesso para ninguém (nem administração)', async () => {
    const m = await mods('Ana');
    expect(m.calendario).toMatchObject({ status: 'desenvolvimento', space: null });
    expect(m.presencas).toMatchObject({ status: 'desenvolvimento', space: null });
    expect(await rpc(w.users.Ana, 'module_admin_overview', { p_section: w.section })).toHaveLength(6);
  });

  it('só a administração muda estados, testers e permissões', async () => {
    await expectDenied(rpc(w.users.Rui, 'set_module_status', { p_section: w.section, p_module: 'calendario', p_status: 'teste' }), 'Reservado');
    await expectDenied(rpc(w.users.Rui, 'set_module_tester', { p_section: w.section, p_module: 'calendario', p_profile: w.users.Rui, p_on: true }), 'Reservado');
    await expectDenied(rpc(w.users.P1, 'set_module_grant', { p_section: w.section, p_permission: 'tesouraria.gerir', p_profile: w.users.P1, p_on: true }), 'Reservado');
    await expectDenied(rpc(w.users.Rui, 'module_admin_overview', { p_section: w.section }), 'Reservado');
  });

  it('em teste: só testers entram, no espaço de teste; ser tester não dá permissões', async () => {
    await setupModule(w, 'calendario', 'teste', ['P1', 'Rui']);
    expect((await mods('P1')).calendario).toMatchObject({ status: 'teste', space: 'teste', grants: [] });
    expect((await mods('P2')).calendario).toMatchObject({ status: 'teste', space: null });
    expect((await mods('Ana')).calendario.space).toBeNull(); // administração não é tester automaticamente
    expect((await mods('P1')).inventario.space).toBeNull();
  });

  it('permissões só por atribuição explícita e só a membros ativos', async () => {
    await setupModule(w, 'tesouraria', 'teste', ['Rui'], [['tesouraria.gerir', 'Rui']]);
    expect((await mods('Rui')).tesouraria.grants).toEqual(['tesouraria.gerir']);
    const outsider = (await admin(`insert into auth.users (email) values ('fora.${Date.now()}@teste.invalid') returning id`))[0].id;
    await expectDenied(rpc(w.users.Ana, 'set_module_tester', { p_section: w.section, p_module: 'calendario', p_profile: outsider, p_on: true }), 'membros ativos');
  });

  it('publicar: dados reais vazios por omissão; dados de teste só passam com escolha explícita; desativar não apaga', async () => {
    await setupModule(w, 'inventario', 'disponivel');
    expect((await mods('P3')).inventario).toMatchObject({ status: 'disponivel', space: 'real' });
    await setupModule(w, 'inventario', 'desenvolvimento');
    expect((await mods('P3')).inventario.space).toBeNull();
    await expectDenied(rpc(w.users.Ana, 'set_module_status', { p_section: w.section, p_module: 'inventario', p_status: 'teste', p_move_test_data: true }), 'só passam a reais ao publicar');
    const log = await admin(`select details from public.audit_log where section_id = $1 and action = 'modulo_estado' order by id`, [w.section]);
    expect(log.length).toBeGreaterThanOrEqual(3);
  });
});

describe('notificações e lembretes', () => {
  it('no espaço de teste só testers recebem, com [Teste] no título', async () => {
    await admin(`delete from public.notifications where section_id = $1`, [w.section]);
    await admin(`select private.module_notify($1, 'calendario', 'teste', array[$2, $3]::uuid[], 'teste_mod', 'Atividade', 'x', '/calendario')`,
      [w.section, w.users.P1, w.users.P2]);
    const n = await admin(`select profile_id, title from public.notifications where section_id = $1 and kind = 'teste_mod'`, [w.section]);
    expect(n).toEqual([{ profile_id: w.users.P1, title: '[Teste] Atividade' }]);
  });

  it('lembretes: sem duplicados, reagendados, cancelados e enviados uma vez', async () => {
    const ent = '00000000-0000-0000-0000-00000000aa01';
    const sched = (due: string) => admin(`select private.schedule_reminder($1, 'calendario', 'teste', 'evento', $2, 'antes', $3, $4::timestamptz, 'Lembrete', 'corpo', '/calendario')`,
      [w.section, ent, w.users.P1, due]);
    await sched(new Date(Date.now() + 3600e3).toISOString());
    await sched(new Date(Date.now() - 60e3).toISOString()); // reagendado (mesmo lembrete)
    expect(await admin(`select count(*)::int as n from public.module_reminders where entity_id = $1`, [ent])).toEqual([{ n: 1 }]);
    await admin(`delete from public.notifications where section_id = $1`, [w.section]);
    expect((await admin(`select private.process_due_reminders() as n`))[0].n).toBeGreaterThanOrEqual(1);
    expect((await admin(`select private.process_due_reminders() as n`))[0].n).toBe(0);
    expect(await admin(`select title from public.notifications where profile_id = $1 and kind = 'lembrete'`, [w.users.P1])).toEqual([{ title: '[Teste] Lembrete' }]);
    // Reagendar para o futuro e cancelar: não volta a enviar
    await sched(new Date(Date.now() + 7200e3).toISOString());
    await admin(`select private.cancel_reminders('evento', $1)`, [ent]);
    await admin(`update public.module_reminders set due_at = now() - interval '1 minute' where entity_id = $1`, [ent]);
    expect((await admin(`select private.process_due_reminders() as n`))[0].n).toBe(0);
  });

  it('o envio de lembretes não está disponível a utilizadores', async () => {
    await expectDenied(rpc(w.users.Ana, 'process_due_reminders'), /permission denied|Sem permissão/);
  });
});
