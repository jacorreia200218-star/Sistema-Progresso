// Inventário: acesso, permissões, espaço de teste, disponibilidade (empréstimos, reservas,
// peças), pedidos com aprovação, devoluções parciais, alertas, lembretes e histórico.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, buildWorld, expectDenied, expectError, pool, rpc, setupModule, type World } from './helpers';

let w: World;
const S = () => ({ p_section: w.section });
const h = (hours: number) => new Date(Date.now() + hours * 3600e3).toISOString();
const item = (who: string, id: string) => rpc<any>(w.users[who], 'inv_item', { ...S(), p_item: id });
const newItem = (who: string, args: Record<string, unknown>) => rpc<string>(w.users[who], 'inv_item_save', {
  ...S(), p_id: null, p_category: null, p_description: null, p_unit: 'un.', p_location: null, p_tracking: 'quantidade',
  p_quantity: 0, p_min_quantity: null, p_pieces: null, ...args,
});
const loan = (who: string, itemId: string, qty: number, from: number, to: number, extra: Record<string, unknown> = {}) =>
  rpc<string>(w.users[who], 'inv_loan_create', {
    ...S(), p_item: itemId, p_borrower: w.users.P2, p_quantity: qty, p_out_at: h(from), p_due_at: h(to), ...extra,
  });
const reserve = (who: string, itemId: string, qty: number, from: number | null, to: number | null, event: string | null = null) =>
  rpc<string>(w.users[who], 'inv_reservation_create', {
    ...S(), p_item: itemId, p_event: event, p_quantity: qty, p_starts_at: from == null ? null : h(from), p_ends_at: to == null ? null : h(to),
  });

let tendas: string;

beforeAll(async () => {
  w = await buildWorld('inventario');
  // Testers: Ana (dirigente), GuiaA (com «inventario.gerir»), P1 e P2 (só acesso). Rui é dirigente mas não é tester.
  await setupModule(w, 'inventario', 'teste', ['Ana', 'GuiaA', 'P1', 'P2'], [['inventario.gerir', 'GuiaA']]);
});
afterAll(() => pool.end());

describe('acesso e permissões', () => {
  it('membro sem acesso (e dirigente que não é tester) é recusado em tudo', async () => {
    for (const who of ['P3', 'Rui']) {
      await expectDenied(rpc(w.users[who], 'inv_overview', S()));
      await expectDenied(rpc(w.users[who], 'inv_loans', S()));
      await expectDenied(rpc(w.users[who], 'inv_alerts', S()));
      await expectDenied(rpc(w.users[who], 'inv_event_options', S()));
      await expectDenied(newItem(who, { p_name: 'Fogão' }));
    }
  });

  it('administração (dirigente tester) e tester com permissão editam', async () => {
    const cat = await rpc<string>(w.users.Ana, 'inv_category_save', { ...S(), p_id: null, p_name: 'Campismo' });
    await expectError(rpc(w.users.GuiaA, 'inv_category_save', { ...S(), p_id: null, p_name: ' campismo ' }), 'Já existe');
    tendas = await newItem('Ana', { p_category: cat, p_name: 'Tenda 4 pessoas', p_unit: 'un.', p_location: 'Arrecadação', p_quantity: 5, p_min_quantity: 2 });
    const id = await newItem('GuiaA', { p_name: 'Cordas', p_unit: 'm', p_quantity: 100, p_location: 'Armário 2' });
    await rpc(w.users.GuiaA, 'inv_item_save', { ...S(), p_id: id, p_category: cat, p_name: 'Corda de sisal', p_description: 'Rolo',
      p_unit: 'm', p_location: 'Armário 3', p_tracking: null, p_quantity: null, p_min_quantity: 10, p_pieces: null });
    const it1 = await item('P1', id);
    expect(it1).toMatchObject({ name: 'Corda de sisal', location: 'Armário 3', category: 'Campismo', can_manage: false });
    expect(it1.stock).toMatchObject({ total: 100, available: 100, states: ['disponivel'] });
    const ov = await rpc<any>(w.users.Ana, 'inv_overview', S());
    expect(ov.can_manage).toBe(true);
    expect(ov.items.map((x: any) => x.name)).toEqual(['Corda de sisal', 'Tenda 4 pessoas']);
    expect(ov.locations).toEqual(['Armário 3', 'Arrecadação']);
  });

  it('tester só de consulta vê, mas não edita (pode pedir empréstimos)', async () => {
    expect((await rpc<any>(w.users.P1, 'inv_overview', S())).items).toHaveLength(2);
    await expectDenied(newItem('P1', { p_name: 'X' }));
    await expectDenied(rpc(w.users.P1, 'inv_stock_move', { ...S(), p_item: tendas, p_kind: 'entrada', p_quantity: 1 }));
    await expectDenied(rpc(w.users.P1, 'inv_item_archive', { ...S(), p_item: tendas, p_archived: true }));
    await expectDenied(loan('P1', tendas, 1, 0, 24));
    await expectDenied(reserve('P1', tendas, 1, 1, 5));
    await expectDenied(rpc(w.users.P1, 'inv_category_save', { ...S(), p_id: null, p_name: 'Cozinha' }));
    // Anexos: pode ver, não pode anexar
    await expectDenied(rpc(w.users.P1, 'module_file_prepare', { ...S(), p_module: 'inventario', p_entity: 'item', p_entity_id: tendas, p_file_name: 'f.jpg', p_mime: 'image/jpeg' }));
    const path = await rpc<string>(w.users.GuiaA, 'module_file_prepare', { ...S(), p_module: 'inventario', p_entity: 'item', p_entity_id: tendas, p_file_name: 'tenda.jpg', p_mime: 'image/jpeg' });
    expect(path).toContain('/inventario/teste/');
    expect(await rpc(w.users.P1, 'module_files_of', { ...S(), p_module: 'inventario', p_entity: 'item', p_entity_id: tendas })).toHaveLength(1);
    expect(await rpc(w.users.P3, 'module_files_of', { ...S(), p_module: 'inventario', p_entity: 'item', p_entity_id: tendas })).toHaveLength(0);
    await expectDenied(rpc(w.users.P1, 'module_file_remove', { p_path: path }));
    expect((await item('P1', tendas)).has_photo).toBe(true);
  });
});

describe('quantidades, estados e histórico', () => {
  it('sem quantidades negativas; entradas, saídas e ajustes ficam no histórico', async () => {
    await expectError(rpc(w.users.Ana, 'inv_stock_move', { ...S(), p_item: tendas, p_kind: 'saida', p_quantity: 6 }), 'negativa');
    await expectError(newItem('Ana', { p_name: 'Mal', p_quantity: -1 }), 'negativa');
    await rpc(w.users.Ana, 'inv_stock_move', { ...S(), p_item: tendas, p_kind: 'entrada', p_quantity: 1, p_note: 'Compra' });
    await expectError(rpc(w.users.Ana, 'inv_stock_move', { ...S(), p_item: tendas, p_kind: 'ajuste', p_quantity: 6 }), 'motivo');
    await rpc(w.users.Ana, 'inv_stock_move', { ...S(), p_item: tendas, p_kind: 'ajuste', p_quantity: 6, p_note: 'Contagem anual' });
    await rpc(w.users.Ana, 'inv_set_condition', { ...S(), p_item: tendas, p_from: 'disponivel', p_to: 'reparacao', p_quantity: 1, p_note: 'Fecho partido' });
    await expectError(rpc(w.users.Ana, 'inv_set_condition', { ...S(), p_item: tendas, p_from: 'danificado', p_to: 'disponivel', p_quantity: 1 }), 'suficientes');
    const it1 = await item('Ana', tendas);
    expect(it1.stock).toMatchObject({ total: 6, repair: 1, available: 5 });
    expect(it1.stock.states).toEqual(['disponivel', 'reparacao']);
    expect(it1.movements.map((m: any) => m.kind)).toEqual(['estado', 'ajuste', 'entrada', 'entrada', 'criacao']);
  });

  it('o histórico não se apaga nem se altera', async () => {
    await expectError(admin(`delete from public.inv_movements where section_id = $1`, [w.section]), 'não pode ser alterado');
    await expectError(admin(`update public.inv_movements set note = 'x' where section_id = $1`, [w.section]), 'não pode ser alterado');
  });
});

describe('empréstimos, devoluções e pedidos', () => {
  let l1: string;
  it('empréstimo com responsável existente, sem exceder o disponível', async () => {
    const outsider = (await admin(`insert into auth.users (email) values ('fora.inv.${Date.now()}@teste.invalid') returning id`))[0].id;
    await expectError(loan('Ana', tendas, 1, 0, 24, { p_borrower: outsider }), 'membro ativo');
    await expectError(loan('Ana', tendas, 6, 0, 24), 'indisponível');
    await expectError(loan('Ana', tendas, 1, 0, -1), 'depois da saída');
    l1 = await loan('GuiaA', tendas, 4, 0, 48);
    const it1 = await item('Ana', tendas);
    expect(it1.stock).toMatchObject({ lent: 4, available: 1 });
    expect(it1.stock.states).toContain('emprestado');
    // Notificação ao responsável (espaço de teste: [Teste]) e lembretes ao responsável e aos gestores
    const n = await admin(`select title from public.notifications where profile_id = $1 and kind = 'inv_emprestimo'`, [w.users.P2]);
    expect(n[0].title).toBe('[Teste] Material emprestado');
    const rem = await admin(`select kind, profile_id from public.module_reminders where entity = 'inv_loan' and entity_id = $1 and cancelled_at is null`, [l1]);
    expect(rem.filter((r) => r.kind === 'devolucao_prazo').map((r) => r.profile_id)).toEqual(expect.arrayContaining([w.users.P2, w.users.GuiaA, w.users.Ana]));
    expect(rem.some((r) => r.kind === 'devolucao_antes')).toBe(true);
    // Não se reduz a quantidade abaixo do emprestado
    await expectError(rpc(w.users.Ana, 'inv_stock_move', { ...S(), p_item: tendas, p_kind: 'saida', p_quantity: 2 }), 'emprestadas');
  });

  it('devoluções parciais e totais; material pode voltar danificado', async () => {
    await expectDenied(rpc(w.users.P2, 'inv_loan_return', { ...S(), p_loan: l1, p_quantity: 1 }));
    await expectError(rpc(w.users.Ana, 'inv_loan_return', { ...S(), p_loan: l1, p_quantity: 5 }), 'Só faltam devolver 4');
    await rpc(w.users.Ana, 'inv_loan_return', { ...S(), p_loan: l1, p_quantity: 1 });
    await rpc(w.users.Ana, 'inv_loan_return', { ...S(), p_loan: l1, p_quantity: 1, p_condition: 'danificado', p_note: 'Vareta torta' });
    let l = (await rpc<any[]>(w.users.Ana, 'inv_loans', S())).find((x) => x.id === l1);
    expect(l).toMatchObject({ status: 'ativo', returned_qty: 2, quantity: 4 });
    expect((await item('Ana', tendas)).stock).toMatchObject({ lent: 2, damaged: 1, repair: 1, available: 2 });
    await rpc(w.users.Ana, 'inv_loan_return', { ...S(), p_loan: l1 });
    l = (await rpc<any[]>(w.users.Ana, 'inv_loans', { ...S(), p_status: 'fechado' })).find((x) => x.id === l1);
    expect(l).toMatchObject({ status: 'devolvido', returned_qty: 4 });
    await expectError(rpc(w.users.Ana, 'inv_loan_return', { ...S(), p_loan: l1, p_quantity: 1 }), 'não tem material por devolver');
    const rem = await admin(`select count(*)::int n from public.module_reminders where entity_id = $1 and cancelled_at is null and sent_at is null`, [l1]);
    expect(rem[0].n).toBe(0);
    const kinds = (await item('Ana', tendas)).movements.filter((m: any) => m.kind === 'devolucao');
    expect(kinds).toHaveLength(3);
    expect(kinds[0].note).toContain('Devolução total');
  });

  it('pedido de empréstimo por quem só consulta: aprovado ou recusado, com notificações', async () => {
    await expectError(rpc(w.users.P1, 'inv_loan_request', { ...S(), p_item: tendas, p_quantity: 9, p_out_at: h(1), p_due_at: h(30) }), 'indisponível');
    await admin(`delete from public.notifications where section_id = $1`, [w.section]);
    const req = await rpc<string>(w.users.P1, 'inv_loan_request', { ...S(), p_item: tendas, p_quantity: 2, p_out_at: h(1), p_due_at: h(30), p_notes: 'Acampamento de patrulha' });
    await expectError(rpc(w.users.P1, 'inv_loan_request', { ...S(), p_item: tendas, p_quantity: 1, p_out_at: h(1), p_due_at: h(30) }), 'Já tens um pedido');
    const toManagers = await admin(`select profile_id, title from public.notifications where section_id = $1 and kind = 'inv_pedido'`, [w.section]);
    expect(toManagers.map((n) => n.profile_id).sort()).toEqual([w.users.Ana, w.users.GuiaA].sort()); // Rui não é tester
    expect(toManagers[0].title).toBe('[Teste] Novo pedido de empréstimo');
    // Pedido ainda não ocupa material; o próprio não pode aprovar
    expect((await item('P1', tendas)).stock.lent).toBe(0);
    await expectDenied(rpc(w.users.P1, 'inv_loan_decide', { ...S(), p_loan: req, p_approve: true }));
    await rpc(w.users.GuiaA, 'inv_loan_decide', { ...S(), p_loan: req, p_approve: true, p_note: 'Bom acampamento' });
    await expectError(rpc(w.users.GuiaA, 'inv_loan_decide', { ...S(), p_loan: req, p_approve: false, p_note: 'x' }), 'já foi decidido');
    const mine = await rpc<any[]>(w.users.P1, 'inv_loans', { ...S(), p_mine: true });
    expect(mine[0]).toMatchObject({ id: req, status: 'ativo', borrower_id: w.users.P1 });
    expect((await admin(`select title from public.notifications where profile_id = $1 and kind = 'inv_pedido_decidido'`, [w.users.P1]))[0].title)
      .toBe('[Teste] Pedido de empréstimo aprovado');
    // Recusa exige motivo; cancelamento pelo próprio
    const req2 = await rpc<string>(w.users.P2, 'inv_loan_request', { ...S(), p_item: tendas, p_quantity: 1, p_out_at: h(1), p_due_at: h(5) });
    await expectError(rpc(w.users.Ana, 'inv_loan_decide', { ...S(), p_loan: req2, p_approve: false }), 'motivo');
    await rpc(w.users.Ana, 'inv_loan_decide', { ...S(), p_loan: req2, p_approve: false, p_note: 'Material reservado' });
    const req3 = await rpc<string>(w.users.P2, 'inv_loan_request', { ...S(), p_item: tendas, p_quantity: 1, p_out_at: h(1), p_due_at: h(5) });
    await expectDenied(rpc(w.users.P1, 'inv_loan_cancel', { ...S(), p_loan: req3 }));
    await rpc(w.users.P2, 'inv_loan_cancel', { ...S(), p_loan: req3 });
    const closed = await rpc<any[]>(w.users.P2, 'inv_loans', { ...S(), p_status: 'fechado', p_mine: true });
    expect(closed.filter((x) => [req2, req3].includes(x.id)).map((x) => x.status).sort()).toEqual(['cancelado', 'recusado']);
    await rpc(w.users.Ana, 'inv_loan_return', { ...S(), p_loan: req });
  });

  it('aprovação volta a verificar a disponibilidade', async () => {
    const r = await rpc<string>(w.users.P1, 'inv_loan_request', { ...S(), p_item: tendas, p_quantity: 2, p_out_at: h(2), p_due_at: h(10) });
    const blocker = await loan('Ana', tendas, 3, 1, 12); // entretanto, o material saiu
    await expectError(rpc(w.users.Ana, 'inv_loan_decide', { ...S(), p_loan: r, p_approve: true }), 'indisponível');
    await rpc(w.users.Ana, 'inv_loan_decide', { ...S(), p_loan: r, p_approve: false, p_note: 'Sem material' });
    await rpc(w.users.Ana, 'inv_loan_return', { ...S(), p_loan: blocker });
  });
});

describe('reservas e atividades do calendário', () => {
  let evento: string; let eventoReal: string;
  beforeAll(async () => {
    const mk = async (space: string, title: string) => (await admin(
      `insert into public.cal_events (section_id, space, title, all_day, starts_at, ends_at, created_by)
       values ($1, $2, $3, false, now() + interval '3 days', now() + interval '5 days', $4) returning id`,
      [w.section, space, title, w.users.Ana]))[0].id;
    evento = await mk('teste', 'Acampamento de Outono');
    eventoReal = await mk('real', 'Atividade real');
  });

  it('opções de atividades: só do mesmo espaço, ativas', async () => {
    const ops = await rpc<any[]>(w.users.P1, 'inv_event_options', S());
    expect(ops.map((o) => o.title)).toEqual(['Acampamento de Outono']);
    await expectError(reserve('Ana', tendas, 1, null, null, eventoReal), 'Atividade não encontrada');
  });

  it('reserva herda o período da atividade; sobreposições acima do disponível são recusadas', async () => {
    // Capacidade: 6 − 1 danificada − 1 em reparação = 4
    const r1 = await reserve('Ana', tendas, 3, null, null, evento);
    const res = await rpc<any[]>(w.users.P1, 'inv_reservations', S());
    expect(res[0]).toMatchObject({ id: r1, event: 'Acampamento de Outono', quantity: 3 });
    expect(new Date(res[0].starts_at).getTime()).toBeGreaterThan(Date.now() + 71 * 3600e3);
    await expectError(reserve('Ana', tendas, 2, 80, 90), 'indisponível'); // sobrepõe-se
    await reserve('Ana', tendas, 1, 80, 90); // cabe
    await reserve('Ana', tendas, 4, 200, 210); // depois da atividade: livre
    // Empréstimo que atravessa a reserva também é recusado
    await expectError(loan('Ana', tendas, 1, 0, 100), 'indisponível');
    expect(await rpc(w.users.P1, 'inv_availability', { ...S(), p_item: tendas, p_from: h(70), p_to: h(130) })).toBe(0);
    expect(await rpc(w.users.P1, 'inv_availability', { ...S(), p_item: tendas, p_from: h(0), p_to: h(24) })).toBe(4);
    // Levantar a reserva: o empréstimo substitui-a
    const l = await loan('Ana', tendas, 3, 73, 119, { p_reservation: r1 });
    expect((await rpc<any[]>(w.users.Ana, 'inv_reservations', S())).some((x) => x.id === r1)).toBe(false);
    await expectError(rpc(w.users.Ana, 'inv_reservation_cancel', { ...S(), p_reservation: r1 }), 'já não está ativa');
    const mv = (await item('Ana', tendas)).movements.map((m: any) => m.kind);
    expect(mv).toEqual(expect.arrayContaining(['reserva', 'reserva_concluida', 'emprestimo']));
    expect((await item('Ana', tendas)).stock.states).toContain('reservado');
    await rpc(w.users.Ana, 'inv_loan_return', { ...S(), p_loan: l });
  });

  it('reservas concorrentes: só uma passa quando não há para ambas', async () => {
    const results = await Promise.allSettled([
      reserve('Ana', tendas, 3, 300, 310), reserve('GuiaA', tendas, 3, 305, 315),
      reserve('Ana', tendas, 2, 302, 303),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBeLessThanOrEqual(2);
    expect(ok).toBeGreaterThanOrEqual(1);
    for (const r of results) if (r.status === 'rejected') expect(String(r.reason.message)).toContain('indisponível');
    // Nunca acima da capacidade (4) em nenhum momento
    const peak = await admin(`select private.inv_peak($1, now() + interval '300 hours', now() + interval '315 hours') as n`, [tendas]);
    expect(peak[0].n).toBeLessThanOrEqual(4);
    // Empréstimos concorrentes para o mesmo período
    const loans = await Promise.allSettled([loan('Ana', tendas, 3, 400, 410), loan('GuiaA', tendas, 3, 400, 410)]);
    const done = loans.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled');
    expect(done).toHaveLength(1);
    await rpc(w.users.Ana, 'inv_loan_return', { ...S(), p_loan: done[0].value });
  });
});

describe('peças identificadas individualmente', () => {
  let lanternas: string; let pieces: any[];
  it('cada peça com código e estado próprio', async () => {
    lanternas = await newItem('GuiaA', { p_name: 'Lanterna frontal', p_tracking: 'pecas',
      p_pieces: JSON.stringify([{ code: 'LF-01', serial: 'SN100' }, { code: 'LF-02' }, { code: 'LF-03' }]) });
    await expectError(rpc(w.users.GuiaA, 'inv_piece_add', { ...S(), p_item: lanternas, p_code: 'lf-01' }), 'Já existe');
    await rpc(w.users.GuiaA, 'inv_piece_add', { ...S(), p_item: lanternas, p_code: 'LF-04', p_serial: 'SN104' });
    await expectError(rpc(w.users.GuiaA, 'inv_stock_move', { ...S(), p_item: lanternas, p_kind: 'entrada', p_quantity: 1 }), 'peças');
    pieces = (await item('P1', lanternas)).pieces;
    expect(pieces.map((p: any) => p.code)).toEqual(['LF-01', 'LF-02', 'LF-03', 'LF-04']);
    const p4 = pieces[3].id;
    await rpc(w.users.GuiaA, 'inv_piece_update', { ...S(), p_piece: p4, p_code: 'LF-04', p_serial: 'SN104', p_status: 'reparacao', p_note: 'Interruptor' });
    const it1 = await item('P1', lanternas);
    expect(it1.stock).toMatchObject({ total: 4, repair: 1, available: 3 });
    await expectDenied(rpc(w.users.P1, 'inv_piece_update', { ...S(), p_piece: p4, p_code: 'LF-04', p_serial: null, p_status: 'disponivel' }));
  });

  it('empréstimo de peças concretas, devolução parcial por peça', async () => {
    const [a, b, c, d] = pieces.map((p: any) => p.id);
    await expectError(loan('Ana', lanternas, 1, 0, 24, { p_pieces: [d] }), 'não estão disponíveis');
    const l = await loan('Ana', lanternas, 0, 0, 24, { p_pieces: [a, b] });
    let it1 = await item('Ana', lanternas);
    expect(it1.pieces.filter((p: any) => p.status === 'emprestado').map((p: any) => p.code)).toEqual(['LF-01', 'LF-02']);
    await expectError(loan('Ana', lanternas, 0, 0, 24, { p_pieces: [a] }), /indisponível|não estão disponíveis/);
    await expectError(rpc(w.users.Ana, 'inv_piece_update', { ...S(), p_piece: a, p_code: 'LF-01', p_serial: 'SN100', p_status: 'danificado' }), 'emprestada');
    await expectError(rpc(w.users.Ana, 'inv_loan_return', { ...S(), p_loan: l, p_pieces: [c] }), 'não estão por devolver');
    await rpc(w.users.Ana, 'inv_loan_return', { ...S(), p_loan: l, p_pieces: [b], p_condition: 'danificado' });
    it1 = await item('Ana', lanternas);
    expect(Object.fromEntries(it1.pieces.map((p: any) => [p.code, p.status]))).toEqual({ 'LF-01': 'emprestado', 'LF-02': 'danificado', 'LF-03': 'disponivel', 'LF-04': 'reparacao' });
    expect(it1.loans[0]).toMatchObject({ status: 'ativo', returned_qty: 1 });
    // Pedido aprovado por peças: escolha automática da peça livre
    const r = await rpc<string>(w.users.P1, 'inv_loan_request', { ...S(), p_item: lanternas, p_quantity: 1, p_out_at: h(0), p_due_at: h(5) });
    await rpc(w.users.Ana, 'inv_loan_decide', { ...S(), p_loan: r, p_approve: true });
    const got = (await rpc<any[]>(w.users.P1, 'inv_loans', { ...S(), p_mine: true })).find((x) => x.id === r);
    expect(got.pieces.map((p: any) => p.code)).toEqual(['LF-03']);
    await rpc(w.users.Ana, 'inv_loan_return', { ...S(), p_loan: r });
    await rpc(w.users.Ana, 'inv_loan_return', { ...S(), p_loan: l });
    expect((await item('Ana', lanternas)).stock).toMatchObject({ total: 4, damaged: 1, repair: 1, lent: 0, available: 2 });
  });
});

describe('alertas, lembretes e arquivo', () => {
  it('alertas: atrasos, mínimos, reparação e pedidos', async () => {
    const l = await loan('Ana', tendas, 1, 0, 2);
    await admin(`update public.inv_loans set out_at = now() - interval '3 days', due_at = now() - interval '1 day' where id = $1`, [l]);
    await rpc<string>(w.users.P2, 'inv_loan_request', { ...S(), p_item: tendas, p_quantity: 1, p_out_at: h(500), p_due_at: h(510) });
    const a = await rpc<any>(w.users.P1, 'inv_alerts', S());
    expect(a.overdue.map((x: any) => x.id)).toEqual([l]);
    expect(a.overdue[0].overdue).toBe(true);
    expect(a.repair.map((x: any) => x.name)).toEqual(expect.arrayContaining(['Tenda 4 pessoas', 'Lanterna frontal']));
    expect(a.low_stock.map((x: any) => x.name)).toEqual([]);
    expect(a.requests).toHaveLength(1);
    // Atraso ocupa o artigo indefinidamente: reservas futuras contam com isso
    expect(await rpc(w.users.P1, 'inv_availability', { ...S(), p_item: tendas, p_from: h(1000), p_to: h(1010) })).toBe(3);
    await rpc(w.users.Ana, 'inv_set_condition', { ...S(), p_item: tendas, p_from: 'disponivel', p_to: 'danificado', p_quantity: 2 });
    expect((await rpc<any>(w.users.P1, 'inv_alerts', S())).low_stock.map((x: any) => x.name)).toEqual(['Tenda 4 pessoas']);
    expect((await rpc<any>(w.users.P1, 'inv_overview', S())).overdue).toBe(1);
  });

  it('lembretes de devolução são enviados uma vez, ao responsável e aos gestores', async () => {
    const l = await loan('GuiaA', tendas, 1, 0, 1, { p_remind_hours: 0 });
    await admin(`update public.module_reminders set due_at = now() - interval '1 minute' where entity_id = $1`, [l]);
    await admin(`delete from public.notifications where section_id = $1 and kind = 'lembrete'`, [w.section]);
    await admin(`select private.process_due_reminders()`);
    const n = await admin(`select profile_id, title from public.notifications where section_id = $1 and kind = 'lembrete'`, [w.section]);
    expect(n.map((x) => x.profile_id)).toEqual(expect.arrayContaining([w.users.P2, w.users.Ana]));
    expect(n.every((x) => x.title === '[Teste] Prazo de devolução de material')).toBe(true);
    // Mudar o prazo reagenda (sem duplicar)
    await rpc(w.users.GuiaA, 'inv_loan_extend', { ...S(), p_loan: l, p_due_at: h(20) });
    const rem = await admin(`select count(*)::int n from public.module_reminders where entity_id = $1 and kind = 'devolucao_prazo' and profile_id = $2`, [l, w.users.P2]);
    expect(rem[0].n).toBe(1);
    await rpc(w.users.GuiaA, 'inv_loan_return', { ...S(), p_loan: l });
  });

  it('arquivar não apaga e exige empréstimos e reservas fechados', async () => {
    const id = await newItem('Ana', { p_name: 'Panela velha', p_quantity: 1 });
    await reserve('Ana', id, 1, 10, 20);
    await expectError(rpc(w.users.Ana, 'inv_item_archive', { ...S(), p_item: id, p_archived: true }), 'reservas ativas');
    const r = (await rpc<any[]>(w.users.Ana, 'inv_reservations', S())).find((x) => x.item_id === id);
    await rpc(w.users.Ana, 'inv_reservation_cancel', { ...S(), p_reservation: r.id, p_note: 'Já não vai' });
    await rpc(w.users.Ana, 'inv_item_archive', { ...S(), p_item: id, p_archived: true, p_note: 'Furada' });
    expect((await rpc<any>(w.users.Ana, 'inv_overview', S())).items.some((x: any) => x.id === id)).toBe(false);
    expect((await rpc<any>(w.users.Ana, 'inv_overview', { ...S(), p_archived: true })).items.map((x: any) => x.id)).toEqual([id]);
    await expectError(loan('Ana', id, 1, 0, 5), 'arquivado');
    expect((await item('Ana', id)).movements.map((m: any) => m.kind)).toEqual(['arquivo', 'reserva_cancelada', 'reserva', 'entrada', 'criacao']);
  });
});

describe('isolamento teste/real', () => {
  it('dados de teste nunca aparecem no espaço real, nem ids de teste são aceites', async () => {
    await setupModule(w, 'inventario', 'disponivel');
    const ov = await rpc<any>(w.users.P3, 'inv_overview', S());
    expect(ov).toMatchObject({ items: [], categories: [], pending_requests: 0, overdue: 0 });
    expect(await rpc(w.users.P3, 'inv_loans', { ...S(), p_status: 'todos' })).toEqual([]);
    expect((await rpc<any[]>(w.users.P3, 'inv_event_options', S())).map((e) => e.title)).toEqual(['Atividade real']);
    await expectError(item('Ana', tendas), 'Registo não encontrado');
    await expectError(rpc(w.users.Ana, 'inv_stock_move', { ...S(), p_item: tendas, p_kind: 'entrada', p_quantity: 1 }), 'Registo não encontrado');
    await expectDenied(rpc(w.users.P3, 'module_file_prepare', { ...S(), p_module: 'inventario', p_entity: 'item', p_entity_id: tendas, p_file_name: 'f.jpg', p_mime: 'image/jpeg' }));
    expect(await rpc(w.users.Ana, 'module_files_of', { ...S(), p_module: 'inventario', p_entity: 'item', p_entity_id: tendas })).toHaveLength(0);
    // No espaço real, Rui (dirigente) gere; P3 só consulta e pede
    const real = await newItem('Rui', { p_name: 'Fogareiro', p_quantity: 2 });
    await expectDenied(newItem('P3', { p_name: 'X' }));
    await rpc(w.users.P3, 'inv_loan_request', { ...S(), p_item: real, p_quantity: 1, p_out_at: h(1), p_due_at: h(4) });
    const n = await admin(`select title from public.notifications where section_id = $1 and kind = 'inv_pedido' and profile_id = $2 order by created_at desc limit 1`, [w.section, w.users.Rui]);
    expect(n[0].title).toBe('Novo pedido de empréstimo');
    // Voltar a teste: os dados reais não se misturam
    await setupModule(w, 'inventario', 'teste');
    expect((await rpc<any>(w.users.Ana, 'inv_overview', S())).items.map((x: any) => x.name)).not.toContain('Fogareiro');
    const counts = await admin(`select space, count(*)::int n from public.inv_items where section_id = $1 group by space order by space`, [w.section]);
    expect(counts).toEqual([{ space: 'real', n: 1 }, { space: 'teste', n: 4 }]);
  });
});

describe('publicar com passagem dos dados de teste', () => {
  it('passa tudo para real, junta categorias com o mesmo nome e mantém o histórico', async () => {
    // Módulo em teste; já há uma categoria real com o mesmo nome de uma de teste.
    await admin(`insert into public.inv_categories (section_id, space, name, created_by) values ($1, 'real', 'campismo', $2)`, [w.section, w.users.Ana]);
    const before = await admin(`select count(*)::int n from public.inv_movements where section_id = $1 and space = 'teste'`, [w.section]);
    await rpc(w.users.Ana, 'set_module_status', { ...S(), p_module: 'inventario', p_status: 'disponivel', p_move_test_data: true });
    expect(await admin(`select count(*)::int n from public.inv_items where section_id = $1 and space = 'teste'`, [w.section])).toEqual([{ n: 0 }]);
    const after = await admin(`select count(*)::int n from public.inv_movements where section_id = $1 and space = 'real'`, [w.section]);
    expect(after[0].n).toBeGreaterThanOrEqual(before[0].n);
    const ov = await rpc<any>(w.users.P3, 'inv_overview', S());
    const tenda = ov.items.find((x: any) => x.name === 'Tenda 4 pessoas');
    expect(tenda.category).toBe('campismo');
    expect(ov.categories.filter((c: any) => !c.archived).map((c: any) => c.name)).toEqual(['campismo']);
    expect((await item('P3', tenda.id)).movements.length).toBeGreaterThan(5);
    expect(await rpc(w.users.P3, 'module_files_of', { ...S(), p_module: 'inventario', p_entity: 'item', p_entity_id: tenda.id })).toHaveLength(1);
  });
});
