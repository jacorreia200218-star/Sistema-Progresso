// Eventos como ponto de ligação: «Registar presenças» abre ou cria a sessão ligada ao
// evento (uma só, mesmo com pedidos simultâneos), só para quem regista presenças e só no
// mesmo espaço; cal_event_links indica o que cada pessoa pode ver e fazer em cada módulo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, buildWorld, expectDenied, expectError, pool, rpc, setupModule, today, type World } from './helpers';

let w: World;
const S = () => w.section;
const inDays = (d: number) => new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10);
const create = (title: string, day = inDays(3)) =>
  rpc<string>(w.users.Rui, 'cal_create_event', { p_section: S(), p_data: { title, all_day: true, start_date: day, end_date: day } });
const openSession = (who: string, ev: string) =>
  rpc<{ id: string; created: boolean }>(w.users[who], 'pres_session_for_event', { p_section: S(), p_event: ev });
const links = (who: string, ev: string) => rpc<any>(w.users[who], 'cal_event_links', { p_section: S(), p_event: ev });
const sessions = async (ev: string) =>
  Number((await admin(`select count(*) n from public.pres_sessions where cal_event_id = $1`, [ev]))[0].n);

let ev: string;

beforeAll(async () => {
  w = await buildWorld('eventos-ligacoes');
  const all = ['Ana', 'Rui', 'GuiaA', 'GuiaB', 'P1', 'P3'];
  await setupModule(w, 'calendario', 'teste', [...all, 'P2']);
  // P2 tem o Calendário mas não as Presenças; GuiaA regista presenças por permissão.
  await setupModule(w, 'presencas', 'teste', all, [['presencas.registar', 'GuiaA']]);
  await setupModule(w, 'secretaria', 'teste', all, [['secretaria.redigir', 'GuiaA']]);
  ev = await create('Raide de outono');
});
afterAll(() => pool.end());

describe('pres_session_for_event', () => {
  it('cria a sessão uma vez e depois devolve sempre a mesma (dirigente e quem tem a permissão)', async () => {
    const a = await openSession('Rui', ev);
    expect(a.created).toBe(true);
    const b = await openSession('Rui', ev);
    expect(b).toEqual({ id: a.id, created: false });
    expect(await openSession('GuiaA', ev)).toEqual({ id: a.id, created: false });
    expect(await sessions(ev)).toBe(1);
    const s = (await admin(`select space, title, kind, session_date::text d from public.pres_sessions where id = $1`, [a.id]))[0];
    expect(s).toEqual({ space: 'teste', title: 'Raide de outono', kind: 'atividade', d: inDays(3) });
  });

  it('pedidos simultâneos não criam duplicados', async () => {
    const e2 = await create('Reunião de secção');
    const out = await Promise.all([openSession('Rui', e2), openSession('GuiaA', e2), openSession('Ana', e2), openSession('Rui', e2)]);
    expect(new Set(out.map((o) => o.id)).size).toBe(1);
    expect(out.filter((o) => o.created).length).toBe(1);
    expect(await sessions(e2)).toBe(1);
  });

  it('pioneiros, guias sem permissão e quem não tem Presenças são recusados', async () => {
    const e3 = await create('Atividade sem sessão');
    for (const who of ['P1', 'GuiaB', 'P2']) await expectDenied(openSession(who, e3));
    expect(await sessions(e3)).toBe(0);
  });

  it('teste e real não se misturam', async () => {
    const real = (await admin(
      `insert into public.cal_events (section_id, space, title, all_day, start_date, end_date, created_by)
       values ($1, 'real', 'Evento real', true, $2, $2, $3) returning id`, [S(), today(), w.users.Ana]))[0].id as string;
    await expectError(openSession('Rui', real), 'não encontrada neste espaço');
    expect(await sessions(real)).toBe(0);
    // Outra secção: também não encontrado
    const other = await buildWorld('eventos-ligacoes-2');
    await setupModule(other, 'presencas', 'teste', ['Rui']);
    await expectError(rpc(other.users.Rui, 'pres_session_for_event', { p_section: other.section, p_event: ev }), 'não encontrada');
  });

  it('evento cancelado: abre a sessão que já existe, mas não cria nenhuma', async () => {
    const withSession = await create('Com sessão');
    const s = await openSession('Rui', withSession);
    const without = await create('Sem sessão');
    for (const e of [withSession, without]) {
      await rpc(w.users.Rui, 'cal_cancel_event', { p_section: S(), p_event: e, p_reason: 'Chuva' });
    }
    expect(await openSession('Rui', withSession)).toEqual({ id: s.id, created: false });
    await expectError(openSession('Rui', without), 'cancelada');
    expect(await sessions(without)).toBe(0);
  });
});

describe('cal_event_links: o que cada pessoa pode ver e fazer', () => {
  it('indica quem pode registar presenças; o pioneiro vê só a sua presença', async () => {
    const id = (await openSession('Rui', ev)).id;
    await rpc(w.users.Rui, 'pres_record', { p_section: S(), p_session: id, p_memberships: [w.members.P1], p_status: 'justificada' });
    const rui = await links('Rui', ev);
    expect(rui.pres_can_register).toBe(true);
    expect(rui.presencas).toMatchObject({ id, counts: { presente: 0, justificada: 1, injustificada: 0 } });
    const p1 = await links('P1', ev);
    expect(p1.pres_can_register).toBe(false);
    expect(p1.presencas).toMatchObject({ id, counts: null, mine: 'justificada' });
    // Sem o módulo Presenças: nada de presenças
    const p2 = await links('P2', ev);
    expect(p2.presencas).toBeUndefined();
    expect(p2.pres_can_register).toBeUndefined();
  });

  it('tarefas com responsável, prazo e a ata (só quando visível); uma só ata por evento', async () => {
    expect((await links('GuiaA', ev)).ata_writer).toBe(true);
    expect((await links('P1', ev)).ata_writer).toBe(false);
    const ata = await rpc<string>(w.users.Rui, 'ata_save', { p_section: S(), p_ata: null, p_event: ev, p_body: 'Preparação do raide.', p_scope: 'evento' });
    await rpc(w.users.Rui, 'ata_task_save', { p_section: S(), p_task: null, p_ata: ata, p_text: 'Levar mapas', p_responsible: w.users.P1, p_due: inDays(2) });
    const p1 = await links('P1', ev);
    expect(p1.reunioes).toEqual([expect.objectContaining({ ata_id: ata })]);
    expect(p1.tarefas).toEqual([expect.objectContaining({ title: 'Levar mapas', due_date: inDays(2), ata_id: ata, responsible_name: expect.any(String) })]);

    // Ata reservada aos dirigentes: o pioneiro não vê a ata nem as tarefas dela
    const e4 = await create('Conselho de animação');
    const reservada = await rpc<string>(w.users.Rui, 'ata_save', { p_section: S(), p_ata: null, p_event: e4, p_body: 'Reservado.', p_scope: 'dirigentes' });
    await rpc(w.users.Rui, 'ata_task_save', { p_section: S(), p_task: null, p_ata: reservada, p_text: 'Tarefa reservada', p_responsible: w.users.Rui });
    const p1r = await links('P1', e4);
    expect(p1r.reunioes).toEqual([]);
    expect(p1r.tarefas).toEqual([]);
    const rui = await links('Rui', e4);
    expect(rui.tarefas).toEqual([expect.objectContaining({ title: 'Tarefa reservada', ata_id: reservada })]);
    await expectError(rpc(w.users.GuiaA, 'ata_save', { p_section: S(), p_ata: null, p_event: e4, p_body: 'Outra', p_scope: 'evento' }), 'já tem ata');
  });

  it('Material e Finanças: só com o módulo no mesmo espaço; indica dados e quem gere', async () => {
    expect((await links('Rui', ev)).financas).toBeUndefined();
    await setupModule(w, 'inventario', 'teste', ['Rui', 'P1']);
    await setupModule(w, 'tesouraria', 'teste', ['Rui', 'P1'], [['tesouraria.gerir', 'Rui']]);
    let rui = await links('Rui', ev);
    expect(rui).toMatchObject({ inv_can_manage: true, reservas: [], compras: [], fin_can_manage: true });
    expect(rui.financas.tem_dados).toBe(false);
    let p1 = await links('P1', ev);
    expect(p1).toMatchObject({ inv_can_manage: false, fin_can_manage: false });
    expect(p1.financas.tem_dados).toBe(false);

    const caixa = await rpc<string>(w.users.Rui, 'fin_save_account', { p_section: S(), p_id: null, p_name: 'Caixa', p_kind: 'caixa' });
    await rpc(w.users.Rui, 'fin_create_movement', { p_section: S(), p_kind: 'despesa', p_on: today(), p_description: 'Gás',
      p_category: 'Material', p_amount: 800, p_account: caixa, p_state: 'efetivo', p_activity: ev });
    rui = await links('Rui', ev);
    expect(rui.financas).toMatchObject({ tem_dados: true, efetivo: { despesas: 800, resultado: -800 } });
    p1 = await links('P1', ev);
    expect(p1.financas.tem_dados).toBe(true);
    // Tesouraria publicada (real) com o Calendário em teste: as finanças reais não aparecem no evento de teste
    await rpc(w.users.Ana, 'set_module_status', { p_section: S(), p_module: 'tesouraria', p_status: 'disponivel' });
    expect((await links('Rui', ev)).financas).toBeUndefined();
  });
});
