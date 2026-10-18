// Atas e tarefas (módulo «secretaria» simplificado) e Equipas e cargos para todos:
// ata ligada a um evento, gravação com histórico, visibilidade conforme o evento (secção,
// equipa ou reservada aos dirigentes), tarefas com responsável, «As minhas tarefas»,
// e progresso anterior bloqueado para os pioneiros no servidor.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, buildWorld, expectDenied, expectError, pool, rpc, setupModule, today, trailId, type World } from './helpers';

let w: World;
const S = () => w.section;
const inDays = (d: number) => new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10);
const list = async (who: string, q: string | null = null) => (await rpc<any>(w.users[who], 'ata_list', { p_section: S(), p_search: q })).atas;
const event = (who: string, title = 'Reunião', day = today(), start: string | null = '14:30', end: string | null = '16:00') =>
  rpc<string>(w.users[who], 'ata_event_create', { p_section: S(), p_title: title, p_day: day, p_start: start, p_end: end });
const save = (who: string, args: { ata?: string | null; event?: string | null; body: string; scope?: string; version?: number | null }) =>
  rpc<string>(w.users[who], 'ata_save', {
    p_section: S(), p_ata: args.ata ?? null, p_event: args.event ?? null, p_body: args.body, p_scope: args.scope ?? 'evento',
    p_expected_version: args.version ?? null,
  });
const get = (who: string, id: string, version: number | null = null) => rpc<any>(w.users[who], 'ata_get', { p_section: S(), p_ata: id, p_version: version });

beforeAll(async () => {
  w = await buildWorld('atas');
  // Publicados para todos (como a migração faz em produção); o Calendário fica em teste.
  await setupModule(w, 'secretaria', 'disponivel', [], [['secretaria.redigir', 'GuiaA']]);
  await setupModule(w, 'equipas', 'disponivel');
  await setupModule(w, 'calendario', 'teste', ['Ana']);
});
afterAll(() => pool.end());

let ataSeccao: string, ataReservada: string, ataEquipa: string, ev1: string;

describe('acesso', () => {
  it('todos os membros entram em Atas e tarefas e Equipas e cargos; o Calendário em teste continua fechado', async () => {
    for (const who of ['P1', 'P2', 'P3', 'GuiaB', 'Rui']) {
      expect(await rpc(w.users[who], 'ata_list', { p_section: S() })).toBeTruthy();
      expect(await rpc(w.users[who], 'eq_overview', { p_section: S() })).toBeTruthy();
    }
    await expectDenied(rpc(w.users.P1, 'cal_events_list', { p_section: S(), p_from: today(), p_to: inDays(30) }));
  });

  it('escrevem os dirigentes e quem redige; os pioneiros só consultam', async () => {
    expect((await rpc<any>(w.users.Rui, 'ata_list', { p_section: S() })).can_write).toBe(true);
    expect((await rpc<any>(w.users.GuiaA, 'ata_list', { p_section: S() })).can_write).toBe(true);
    expect((await rpc<any>(w.users.P1, 'ata_list', { p_section: S() })).can_write).toBe(false);
    await expectDenied(event('P1'), 'Só os dirigentes');
    await expectDenied(rpc(w.users.P1, 'ata_events', { p_section: S() }), 'Só os dirigentes');
  });
});

describe('ata ligada a um evento', () => {
  it('criar no calendário e escrever a ata: título e data vêm do evento', async () => {
    ev1 = await event('Rui', 'Reunião de sábado', today());
    const opts = await rpc<any[]>(w.users.Rui, 'ata_events', { p_section: S() });
    expect(opts.find((e) => e.id === ev1)).toMatchObject({ title: 'Reunião de sábado', day: today(), ata_id: null });
    await expectError(save('Rui', { event: ev1, body: '  ' }), 'Escreve o texto');
    ataSeccao = await save('Rui', { event: ev1, body: 'Falámos do acampamento.' });
    const a = await get('P1', ataSeccao);
    expect(a).toMatchObject({ title: 'Reunião de sábado', scope: 'seccao', body: 'Falámos do acampamento.', version: 1, can_write: false });
    expect(a.event).toMatchObject({ id: ev1, day: today() });
    expect(a.updated_by_name).toContain('Rui');
    await expectError(save('GuiaA', { event: ev1, body: 'Outra' }), 'já tem ata');
  });

  it('guardar outra vez cria uma versão nova e mantém a anterior', async () => {
    await expectError(save('GuiaA', { ata: ataSeccao, body: 'x', version: 7 }), 'mudou entretanto');
    await save('GuiaA', { ata: ataSeccao, body: 'Falámos do acampamento e das quotas.', version: 1 });
    const a = await get('P2', ataSeccao);
    expect(a).toMatchObject({ version: 2, current_version: 2, body: 'Falámos do acampamento e das quotas.' });
    expect(a.updated_by_name).toContain('GuiaA');
    expect(a.versions.map((v: any) => v.version)).toEqual([2, 1]);
    expect((await get('P2', ataSeccao, 1)).body).toBe('Falámos do acampamento.');
  });

  it('lista por data com pesquisa no título e no texto', async () => {
    const ev0 = await event('Rui', 'Conselho de Guias', inDays(-7), null, null);
    const old = await save('Rui', { event: ev0, body: 'Planeámos o raid.' });
    const ids = (await list('P3')).map((a: any) => a.id);
    expect(ids).toEqual([ataSeccao, old]);
    expect((await list('P3', 'quotas')).map((a: any) => a.id)).toEqual([ataSeccao]);
    expect((await list('P3', 'conselho')).map((a: any) => a.id)).toEqual([old]);
  });

  it('ata reservada aos dirigentes: os restantes não a veem nem pela pesquisa', async () => {
    const ev = await event('Rui', 'Reunião de dirigentes', inDays(-1));
    ataReservada = await save('Rui', { event: ev, body: 'Assunto reservado sobre um pioneiro.', scope: 'dirigentes' });
    expect((await get('Ana', ataReservada)).scope).toBe('dirigentes');
    for (const who of ['P1', 'P2', 'GuiaB']) {
      expect((await list(who)).map((a: any) => a.id)).not.toContain(ataReservada);
      expect((await list(who, 'reservado')).length).toBe(0);
      await expectError(get(who, ataReservada), 'não encontrado');
    }
    // Quem redige atas também a vê (secretário autorizado).
    expect((await get('GuiaA', ataReservada)).body).toContain('reservado');
  });

  it('ata de um evento de equipa: só essa equipa e os dirigentes', async () => {
    const ev = (await admin(`insert into public.cal_events (section_id, space, title, all_day, start_date, end_date, audience, team_id, created_by)
      values ($1, 'real', 'Reunião da Equipa A', true, current_date, current_date, 'equipa', $2, $3) returning id`, [S(), w.teamA, w.users.Rui]))[0].id;
    ataEquipa = await save('Rui', { event: ev, body: 'Distribuímos tarefas.' });
    expect((await get('P1', ataEquipa)).scope).toBe('equipa');
    await expectError(get('P3', ataEquipa), 'não encontrado');
  });

  it('os dados do teste nunca aparecem nas atas reais', async () => {
    const test = (await admin(`insert into public.cal_events (section_id, space, title, all_day, start_date, end_date, created_by)
      values ($1, 'teste', 'Evento fictício', true, current_date, current_date, $2) returning id`, [S(), w.users.Ana]))[0].id;
    expect((await rpc<any[]>(w.users.Rui, 'ata_events', { p_section: S() })).map((e) => e.id)).not.toContain(test);
    await expectError(save('Rui', { event: test, body: 'x' }), 'Escolhe um evento');
  });
});

let task: string;
describe('tarefas', () => {
  it('criar a partir da ata com responsável real; notifica o responsável', async () => {
    await expectError(rpc(w.users.Rui, 'ata_task_save', { p_section: S(), p_task: null, p_ata: ataSeccao, p_text: 'Comprar gás', p_responsible: null }), 'responsável');
    const outsider = (await admin(`select gen_random_uuid() id`))[0].id;
    await expectError(rpc(w.users.Rui, 'ata_task_save', { p_section: S(), p_task: null, p_ata: ataSeccao, p_text: 'x', p_responsible: outsider }), 'membro ativo');
    await expectDenied(rpc(w.users.P1, 'ata_task_save', { p_section: S(), p_task: null, p_ata: ataSeccao, p_text: 'x', p_responsible: w.users.P1 }), 'Só os dirigentes');
    task = await rpc(w.users.Rui, 'ata_task_save', { p_section: S(), p_task: null, p_ata: ataSeccao, p_text: 'Comprar gás', p_responsible: w.users.P1, p_due: inDays(5) });
    const n = await asUser(w.users.P1, `select title, body, link from public.notifications where kind = 'sec_tarefa'`);
    expect(n[0]).toMatchObject({ title: 'Nova tarefa', link: '/atas-e-tarefas/minhas' });
    expect(n[0].body).toContain('Comprar gás');
    const a = await get('P2', ataSeccao);
    expect(a.tasks[0]).toMatchObject({ id: task, text: 'Comprar gás', status: 'por_fazer', responsible_id: w.users.P1 });
    expect(a.tasks[0].event.id).toBe(ev1);
  });

  it('as minhas tarefas e o estado atualizado pelo responsável (com histórico)', async () => {
    const mine = await rpc<any[]>(w.users.P1, 'ata_my_tasks', { p_section: S() });
    expect(mine.map((t) => t.id)).toEqual([task]);
    expect(mine[0].ata_id).toBe(ataSeccao);
    expect(await rpc<any[]>(w.users.P2, 'ata_my_tasks', { p_section: S() })).toEqual([]);
    await expectDenied(rpc(w.users.P2, 'ata_task_status', { p_section: S(), p_task: task, p_status: 'concluida' }), 'Só o responsável');
    await rpc(w.users.P1, 'ata_task_status', { p_section: S(), p_task: task, p_status: 'em_curso' });
    await rpc(w.users.P1, 'ata_task_status', { p_section: S(), p_task: task, p_status: 'concluida' });
    const h = await admin(`select field, from_value, to_value from public.sec_item_history where item_id = $1 order by changed_at`, [task]);
    expect(h.map((x) => x.field)).toEqual(['criada', 'estado', 'estado']);
    expect((await rpc<any>(w.users.Rui, 'ata_tasks', { p_section: S(), p_filter: 'concluidas' })).tasks.map((t: any) => t.id)).toEqual([task]);
  });

  it('reatribuir avisa o novo responsável; a tarefa de uma ata reservada mostra-se sem a ata', async () => {
    const t2 = await rpc<string>(w.users.Rui, 'ata_task_save', { p_section: S(), p_task: null, p_ata: ataReservada, p_text: 'Falar com os pais', p_responsible: w.users.GuiaB });
    await rpc(w.users.Rui, 'ata_task_save', { p_section: S(), p_task: t2, p_ata: null, p_text: 'Falar com os pais', p_responsible: w.users.P3, p_due: null, p_status: 'por_fazer' });
    const mine = await rpc<any[]>(w.users.P3, 'ata_my_tasks', { p_section: S() });
    expect(mine[0]).toMatchObject({ id: t2, text: 'Falar com os pais', ata_id: null });
    expect((await asUser(w.users.P3, `select 1 from public.notifications where kind = 'sec_tarefa'`)).length).toBe(1);
    expect(await rpc<any[]>(w.users.GuiaB, 'ata_my_tasks', { p_section: S() })).toEqual([]);
    await rpc(w.users.P3, 'ata_task_status', { p_section: S(), p_task: t2, p_status: 'em_curso' });
    // Na lista geral, quem não vê a ata não vê a tarefa.
    expect((await rpc<any>(w.users.P2, 'ata_tasks', { p_section: S(), p_filter: 'todas' })).tasks.map((t: any) => t.id)).not.toContain(t2);
  });

  it('guardar uma ata não exige tarefas', async () => {
    expect((await get('Rui', ataEquipa)).tasks).toEqual([]);
  });
});

describe('equipas e cargos para todos', () => {
  it('todos veem as equipas e os membros de todas as equipas; só quem gere altera', async () => {
    const o = await rpc<any>(w.users.P3, 'eq_overview', { p_section: S() });
    expect(o.can_manage).toBe(false);
    const ids = o.members.map((m: any) => m.membership_id);
    for (const who of ['P1', 'P2', 'P3', 'GuiaA', 'GuiaB']) expect(ids).toContain(w.members[who]);
    expect((await rpc<any>(w.users.Rui, 'eq_overview', { p_section: S() })).can_manage).toBe(true);
    await expectDenied(rpc(w.users.P3, 'eq_seed_roles', { p_section: S() }));
    await rpc(w.users.Rui, 'eq_seed_roles', { p_section: S() });
  });
});

describe('progresso anterior só pelos dirigentes', () => {
  it('o pioneiro não cria nem submete progresso anterior, nem diretamente na base de dados', async () => {
    const t = await trailId('fisico-desempenho');
    await expectError(rpc(w.users.P2, 'create_trail_request', { p_membership: w.members.P2, p_trail: t, p_kind: 'historico' }), 'registado pelos dirigentes');
    const draft = (await admin(`insert into public.trail_requests (membership_id, section_id, trail_id, trail_key, kind, created_by)
      values ($1, $2, $3, 'fisico-desempenho', 'historico', $4) returning id`, [w.members.P2, S(), t, w.users.P2]))[0].id;
    await admin(`insert into public.trail_request_versions (request_id, version_no, reflection) values ($1, 1, 'Fiz isto antes')`, [draft]);
    await expectError(rpc(w.users.P2, 'submit_trail_request', { p_request: draft }), 'registado pelos dirigentes');
    await expect(asUser(w.users.P2, `insert into public.trail_requests (membership_id, section_id, trail_id, trail_key, kind, created_by)
      values ($1, $2, $3, 'fisico-bem-estar-fisico', 'historico', $4)`, [w.members.P2, S(), await trailId('fisico-bem-estar-fisico'), w.users.P2])).rejects.toThrow();
  });

  it('o dirigente regista com fundamentação e data; conta uma vez; o pedido normal continua', async () => {
    const t = await trailId('afetivo-autoestima');
    await rpc(w.users.Rui, 'recognize_in_negotiation', { p_membership: w.members.P2, p_trail: t, p_comment: 'Fez este trilho no agrupamento anterior.', p_reference_date: inDays(-200) });
    const d = await admin(`select d.kind::text, d.comment, d.reference_date::text, d.recorded_by from public.trail_decisions d
      join public.trail_requests r on r.id = d.request_id where r.membership_id = $1 and r.trail_key = 'afetivo-autoestima'`, [w.members.P2]);
    expect(d[0]).toMatchObject({ kind: 'reconhecido_negociacao', comment: 'Fez este trilho no agrupamento anterior.', reference_date: inDays(-200), recorded_by: w.users.Rui });
    await expectError(rpc(w.users.Rui, 'recognize_in_negotiation', { p_membership: w.members.P2, p_trail: t, p_comment: 'Outra vez', p_reference_date: null }), 'Já existe');
    expect((await admin(`select private.validated_trail_keys($1) k`, [w.members.P2])).map((r) => r.k)).toContain('afetivo-autoestima');
    const n = await rpc<string>(w.users.P2, 'create_trail_request', { p_membership: w.members.P2, p_trail: await trailId('carater-autonomia'), p_kind: 'normal' });
    await rpc(w.users.P2, 'submit_trail_validation', { p_request: n, p_expected_version: 1, p_justification: 'Organizei a minha semana sozinho.' });
    expect((await admin(`select status::text from public.trail_requests where id = $1`, [n]))[0].status).toBe('submetido');
  });
});
