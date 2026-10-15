// Ligações entre módulos: uma atividade do Calendário mostra as reservas, o resumo
// financeiro e as reuniões ligadas, só a quem tem acesso a cada módulo no mesmo espaço,
// sem duplicar registos. Publicar um módulo com os dados de teste não deixa registos
// reais ligados a atividades de teste.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, buildWorld, expectDenied, pool, rpc, setupModule, type World } from './helpers';

let w: World;
let ev: string;
let item: string;
const S = () => w.section;
const iso = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const links = (who: string) => rpc<any>(w.users[who], 'cal_event_links', { p_section: S(), p_event: ev });
const count = async (sql: string) => Number((await admin(sql, [S()]))[0].n);

beforeAll(async () => {
  w = await buildWorld('integracao');
  await setupModule(w, 'calendario', 'teste', ['Rui', 'P1']);
  await setupModule(w, 'inventario', 'teste', ['Rui']);
  await setupModule(w, 'tesouraria', 'teste', ['Rui'], [['tesouraria.gerir', 'Rui']]);
  await setupModule(w, 'secretaria', 'teste', ['Rui'], [['secretaria.redigir', 'Rui']]);
  ev = await rpc<string>(w.users.Rui, 'cal_create_event', { p_section: S(), p_data: { title: 'Acampamento', all_day: false, starts_at: iso(72), ends_at: iso(96) } });
  item = await rpc<string>(w.users.Rui, 'inv_item_save', {
    p_section: S(), p_id: null, p_category: null, p_name: 'Tenda', p_description: null, p_unit: 'un.', p_location: null,
    p_tracking: 'quantidade', p_quantity: 4, p_min_quantity: null, p_pieces: null });
  await rpc(w.users.Rui, 'inv_reservation_create', { p_section: S(), p_item: item, p_event: ev, p_quantity: 2, p_starts_at: null, p_ends_at: null });
  const caixa = await rpc<string>(w.users.Rui, 'fin_save_account', { p_section: S(), p_id: null, p_name: 'Caixa', p_kind: 'caixa' });
  await rpc(w.users.Rui, 'fin_create_movement', { p_section: S(), p_kind: 'despesa', p_on: '2026-10-01', p_description: 'Gás',
    p_category: 'Material', p_amount: 1250, p_account: caixa, p_state: 'efetivo', p_activity: ev });
  await rpc(w.users.Rui, 'sec_meeting_save', { p_section: S(), p_meeting: null, p_kind: 'animacao', p_team: null, p_title: 'Preparação',
    p_starts_at: iso(24), p_location: null, p_agenda: '', p_cal_event: ev, p_participants: [], p_share_profiles: [], p_share_teams: [] });
});
afterAll(() => pool.end());

describe('atividade com registos ligados', () => {
  it('quem tem acesso aos módulos vê cada ligação uma vez', async () => {
    const l = await links('Rui');
    expect(l.reservas).toEqual([expect.objectContaining({ item: 'Tenda', quantity: 2 })]);
    expect(l.financas.efetivo).toEqual({ receitas: 0, despesas: 1250, resultado: -1250 });
    expect(l.reunioes).toEqual([expect.objectContaining({ title: 'Preparação' })]);
    // Nada foi copiado: cada registo existe uma vez no seu módulo
    expect(await count(`select count(*) n from public.inv_reservations where section_id = $1`)).toBe(1);
    expect(await count(`select count(*) n from public.fin_movements where section_id = $1`)).toBe(1);
    expect(await count(`select count(*) n from public.sec_meetings where section_id = $1`)).toBe(1);
  });

  it('quem só tem o Calendário não vê dados dos outros módulos; sem acesso é recusado', async () => {
    expect(await links('P1')).toEqual({});
    await expectDenied(links('P2'));
  });
});

describe('publicar com os dados de teste', () => {
  it('registos que passam a reais deixam de estar ligados a atividades de teste, e os lembretes passam com eles', async () => {
    await admin(`insert into public.module_reminders (section_id, module, space, entity, entity_id, kind, profile_id, due_at, title)
                 values ($1, 'inventario', 'teste', 'inv_test', gen_random_uuid(), 'x', $2, now() + interval '1 day', 'Lembrete')`, [S(), w.users.Rui]);
    await rpc(w.users.Ana, 'set_module_status', { p_section: S(), p_module: 'inventario', p_status: 'disponivel', p_move_test_data: true });
    await rpc(w.users.Ana, 'set_module_status', { p_section: S(), p_module: 'secretaria', p_status: 'disponivel', p_move_test_data: true });
    expect(await count(`select count(*) n from public.inv_reservations where section_id = $1 and space = 'real' and event_id is null`)).toBe(1);
    expect(await count(`select count(*) n from public.sec_meetings where section_id = $1 and space = 'real' and cal_event_id is null`)).toBe(1);
    expect(await count(`select count(*) n from public.module_reminders where section_id = $1 and module = 'inventario' and space = 'real'`)).toBe(1);
    // O Calendário continua em teste e intacto
    expect(await count(`select count(*) n from public.cal_events where section_id = $1 and space = 'teste'`)).toBe(1);
    const l = await links('Rui');
    expect(l.reservas).toBeUndefined();
    expect(l.reunioes).toBeUndefined();
  });
});
