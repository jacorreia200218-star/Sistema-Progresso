// Tesouraria: permissões (só «tesouraria.gerir»), resumos partilhados, situação própria,
// cêntimos exatos, quotas e pagamentos sem duplicados, correções, anulações, auditoria,
// comprovativos e isolamento entre o espaço de teste e o real.
// v2: painel com saldo inicial e fórmula, evolução do saldo, período / ano escutista /
// atividade, movimentos partilhados com pesquisa (sem dados pessoais para quem consulta).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { admin, asUser, buildWorld, expectDenied, expectError, pool, rpc, setupModule, type World } from './helpers';

let w: World;
let S: string;
const u = (n: string) => w.users[n];
let caixa: string;
let banco: string;
let acamp: string; // atividade (cal_events) no espaço de teste
let realEvent: string; // atividade no espaço real

async function calEvent(space: 'teste' | 'real', title: string, day: string) {
  return (await admin(
    `insert into public.cal_events (section_id, space, title, all_day, start_date, end_date, created_by)
     values ($1, $2, $3, true, $4, $4, $5) returning id`, [S, space, title, day, u('Ana')]))[0].id as string;
}

const mov = (who: string, extra: Record<string, unknown> = {}) => rpc<string>(u(who), 'fin_create_movement', {
  p_section: S, p_kind: 'receita', p_on: '2026-10-01', p_description: 'Venda de rifas', p_category: 'Angariação de fundos',
  p_amount: 1000, p_account: caixa, p_state: 'efetivo', ...extra,
});
const summary = (who: string, extra: Record<string, unknown> = {}) => rpc<any>(u(who), 'fin_summary', { p_section: S, ...extra });

beforeAll(async () => {
  w = await buildWorld('tesouraria');
  S = w.section;
  // Testers: Ana (administração), Rui (dirigente), GuiaA (tesoureiro autorizado), P1 e P2 (só consulta). P3 sem acesso.
  await setupModule(w, 'tesouraria', 'teste', ['Ana', 'Rui', 'GuiaA', 'P1', 'P2'], [['tesouraria.gerir', 'GuiaA']]);
  acamp = await calEvent('teste', 'Acampamento de outono', '2026-10-20');
  realEvent = await calEvent('real', 'Atividade real', '2026-11-05');
});
afterAll(() => pool.end());

describe('permissões', () => {
  it('só quem tem tesouraria.gerir cria contas e movimentos', async () => {
    caixa = await rpc(u('GuiaA'), 'fin_save_account', { p_section: S, p_id: null, p_name: 'Caixa', p_kind: 'caixa' });
    banco = await rpc(u('GuiaA'), 'fin_save_account', { p_section: S, p_id: null, p_name: 'Conta bancária', p_kind: 'conta' });
    expect(await mov('GuiaA')).toMatch(/[0-9a-f-]{36}/);
  });

  it('dirigente sem autorização é recusado na escrita (ser dirigente não basta)', async () => {
    await expectDenied(mov('Rui'), 'permissão');
    await expectDenied(rpc(u('Rui'), 'fin_save_account', { p_section: S, p_id: null, p_name: 'X', p_kind: 'caixa' }), 'permissão');
    await expectDenied(rpc(u('Rui'), 'fin_list_movements', { p_section: S }), 'permissão');
  });

  it('administração sem a permissão também não escreve; ao conceder-se, passa a poder', async () => {
    await expectDenied(mov('Ana'), 'permissão');
    await rpc(u('Ana'), 'set_module_grant', { p_section: S, p_permission: 'tesouraria.gerir', p_profile: u('Ana'), p_on: true });
    const id = await mov('Ana', { p_description: 'Teste de permissão', p_amount: 1 });
    await rpc(u('Ana'), 'fin_void_movement', { p_section: S, p_id: id, p_reason: 'Só para testar a permissão' });
    await rpc(u('Ana'), 'set_module_grant', { p_section: S, p_permission: 'tesouraria.gerir', p_profile: u('Ana'), p_on: false });
    await expectDenied(mov('Ana'), 'permissão');
  });

  it('um cargo de equipa (p. ex. tesoureiro) não dá acesso: só a permissão da administração', async () => {
    // Guia de equipa e tester, mas sem permissão
    await setupModule(w, 'tesouraria', 'teste', ['GuiaB']);
    await expectDenied(mov('GuiaB'), 'permissão');
    const m = await rpc<any[]>(u('GuiaB'), 'my_modules', { p_section: S });
    expect(m.find((x) => x.module === 'tesouraria').grants).toEqual([]);
    // Cargo «Tesoureiro» de equipa (módulo Equipas) também não dá permissão
    await setupModule(w, 'equipas', 'teste', ['Ana'], [['equipas.gerir', 'Ana']]);
    await rpc(u('Ana'), 'eq_seed_roles', { p_section: S });
    const role = (await admin(`select id from public.eq_roles where section_id = $1 and name = 'Tesoureiro'`, [S]))[0].id;
    await rpc(u('Ana'), 'eq_appoint', { p_section: S, p_role: role, p_team: w.teamA, p_membership: w.members.P1, p_starts_on: new Date().toISOString().slice(0, 10) });
    await expectDenied(mov('P1'), 'permissão');
    await expectDenied(rpc(u('P1'), 'fin_list_movements', { p_section: S }), 'permissão');
  });

  it('membro sem acesso ao módulo é recusado em tudo', async () => {
    for (const fn of ['fin_summary', 'fin_my_situation', 'fin_options', 'fin_activity_options', 'fin_activity_results']) {
      await expectDenied(rpc(u('P3'), fn, { p_section: S }), 'não está disponível');
    }
    await expectDenied(mov('P3'), 'não está disponível');
  });

  it('tester só de consulta vê resumos, mas nunca a lista de movimentos, quotas ou histórico', async () => {
    const s = await summary('P1');
    expect(s.can_manage).toBe(false);
    expect(s.totals.efetivo.receitas).toBeGreaterThan(0);
    expect(s.by_category.length).toBeGreaterThan(0);
    await expectDenied(rpc(u('P1'), 'fin_list_movements', { p_section: S }), 'permissão');
    await expectDenied(rpc(u('P1'), 'fin_list_quotas', { p_section: S }), 'permissão');
    await expectDenied(rpc(u('P1'), 'fin_members', { p_section: S }), 'permissão');
    await expectDenied(rpc(u('P1'), 'fin_history', { p_section: S, p_entity_id: caixa }), 'permissão');
    // v2: mas vê a lista partilhada de movimentos (sem dados pessoais)
    const shared = await rpc<any>(u('P1'), 'fin_search_movements', { p_section: S });
    expect(shared.can_manage).toBe(false);
    expect(shared.items.length).toBeGreaterThan(0);
    expect(shared.items[0]).not.toHaveProperty('notes');
    expect(shared.items[0]).not.toHaveProperty('member_name');
  });
});

describe('valores exatos e saldos', () => {
  it('0,10 + 0,20 = 0,30 exatamente; saldo efetivo só com efetivos não anulados', async () => {
    const before = (await summary('GuiaA', { p_category: 'Arredondamentos' })).totals;
    expect(before.efetivo.saldo).toBe(0);
    await mov('GuiaA', { p_category: 'Arredondamentos', p_amount: 10 });
    await mov('GuiaA', { p_category: 'Arredondamentos', p_amount: 20 });
    await mov('GuiaA', { p_category: 'Arredondamentos', p_amount: 500, p_state: 'pendente' });
    await mov('GuiaA', { p_category: 'Arredondamentos', p_amount: 700, p_state: 'previsto', p_kind: 'despesa' });
    const anulado = await mov('GuiaA', { p_category: 'Arredondamentos', p_amount: 9999 });
    await rpc(u('GuiaA'), 'fin_void_movement', { p_section: S, p_id: anulado, p_reason: 'Registado por engano' });
    const t = (await summary('P2', { p_category: 'Arredondamentos' })).totals;
    expect(t.efetivo).toEqual({ receitas: 30, despesas: 0, saldo: 30 });
    expect(t.pendente).toEqual({ receitas: 500, despesas: 0, saldo: 500 });
    expect(t.previsto).toEqual({ receitas: 0, despesas: 700, saldo: -700 });
  });

  it('valores inválidos são recusados (zero, negativos, não inteiros)', async () => {
    await expectError(mov('GuiaA', { p_amount: 0 }), 'superior a zero');
    await expectError(mov('GuiaA', { p_amount: -5 }), 'superior a zero');
    await expectError(mov('GuiaA', { p_amount: '12.5' }), /bigint/);
    await expectError(mov('GuiaA', { p_description: '  ' }), 'descrição');
    await expectError(mov('GuiaA', { p_account: randomUUID() }), 'conta ou caixa');
  });

  it('saldo por conta; atividades e categorias agregadas; filtros por período/atividade', async () => {
    await mov('GuiaA', { p_kind: 'despesa', p_amount: 4550, p_category: 'Alimentação', p_activity: acamp, p_account: banco, p_on: '2026-10-19' });
    await mov('GuiaA', { p_amount: 6000, p_category: 'Atividades', p_activity: acamp, p_account: banco, p_on: '2026-10-18' });
    const s = await summary('P1', { p_activity: acamp });
    expect(s.totals.efetivo).toEqual({ receitas: 6000, despesas: 4550, saldo: 1450 });
    expect(s.by_activity).toEqual([expect.objectContaining({ title: 'Acampamento de outono', receitas: 6000, despesas: 4550, saldo: 1450 })]);
    const b = (await summary('P1')).accounts.find((a: any) => a.id === banco);
    expect(b.saldo).toBe(1450);
    const oct18 = await summary('P1', { p_from: '2026-10-18', p_to: '2026-10-18' });
    expect(oct18.totals.efetivo.receitas).toBe(6000);
    // Atividade de outro espaço não é aceite
    await expectError(mov('GuiaA', { p_activity: realEvent }), 'Atividade não encontrada');
    const opts = await rpc<any[]>(u('P1'), 'fin_activity_options', { p_section: S });
    expect(opts.map((o) => o.title)).toEqual(['Acampamento de outono']);
  });

  it('envio repetido do mesmo formulário não duplica o movimento', async () => {
    const key = randomUUID();
    await mov('GuiaA', { p_client_key: key, p_category: 'Donativos' });
    await expectError(mov('GuiaA', { p_client_key: key, p_category: 'Donativos' }), 'já foi registado');
  });
});

describe('orçamento e resultado por atividade', () => {
  it('previsto (orçamento) vs efetivo, visível em totais a quem consulta', async () => {
    await rpc(u('GuiaA'), 'fin_save_budget_line', { p_section: S, p_id: null, p_activity: acamp, p_kind: 'despesa', p_category: 'Alimentação', p_description: 'Refeições', p_amount: 5000 });
    await rpc(u('GuiaA'), 'fin_save_budget_line', { p_section: S, p_id: null, p_activity: acamp, p_kind: 'receita', p_category: 'Atividades', p_description: 'Inscrições', p_amount: 6000 });
    const line = await rpc<string>(u('GuiaA'), 'fin_save_budget_line', { p_section: S, p_id: null, p_activity: acamp, p_kind: 'despesa', p_category: 'Transportes', p_description: 'Autocarro', p_amount: 3000 });
    await rpc(u('GuiaA'), 'fin_void_budget_line', { p_section: S, p_id: line, p_reason: 'Vamos a pé' });
    await expectDenied(rpc(u('Rui'), 'fin_save_budget_line', { p_section: S, p_id: null, p_activity: acamp, p_kind: 'despesa', p_category: 'X', p_description: 'Y', p_amount: 1 }), 'permissão');
    const [r] = await rpc<any[]>(u('P2'), 'fin_activity_results', { p_section: S, p_activity: acamp });
    expect(r.orcamento).toEqual({ receitas: 6000, despesas: 5000, resultado: 1000 });
    expect(r.efetivo).toEqual({ receitas: 6000, despesas: 4550, resultado: 1450 });
    expect(r.lines).toHaveLength(2);
    expect(r.by_category).toContainEqual({ category: 'Alimentação', kind: 'despesa', orcamento: 5000, efetivo: 4550 });
  });
});

describe('quotas e pagamentos individuais', () => {
  let quota: string;
  let chargeP1: string;
  let chargeP2: string;

  it('define quota, aplica a membros (1/3 arredondado ao cêntimo) e notifica sem valores', async () => {
    await admin(`delete from public.notifications where section_id = $1`, [S]);
    quota = await rpc(u('GuiaA'), 'fin_save_quota', { p_section: S, p_id: null, p_name: 'Quota 2026/27', p_period_start: '2026-09-01', p_period_end: '2027-08-31', p_amount: 1000, p_due_date: '2099-12-31' });
    expect(await rpc(u('GuiaA'), 'fin_apply_quota', { p_section: S, p_quota: quota, p_profiles: [u('P1')] })).toBe(1);
    expect(await rpc(u('GuiaA'), 'fin_apply_quota', { p_section: S, p_quota: quota, p_profiles: [u('P2')], p_num: 1, p_den: 3 })).toBe(1);
    // Aplicar de novo não duplica
    expect(await rpc(u('GuiaA'), 'fin_apply_quota', { p_section: S, p_quota: quota, p_profiles: [u('P1'), u('P2')] })).toBe(0);
    const qs = await rpc<any[]>(u('GuiaA'), 'fin_list_quotas', { p_section: S });
    const q = qs.find((x) => x.id === quota);
    const c1 = q.charges.find((c: any) => c.profile_id === u('P1'));
    const c2 = q.charges.find((c: any) => c.profile_id === u('P2'));
    chargeP1 = c1.id; chargeP2 = c2.id;
    expect(c1.amount_cents).toBe(1000);
    expect(c2.amount_cents).toBe(333); // 10,00 € × 1/3 = 3,33 €
    const n = await admin(`select profile_id, title, body from public.notifications where section_id = $1 and kind = 'fin_quota' order by title`, [S]);
    expect(n).toHaveLength(2);
    for (const x of n) {
      expect(x.title).toBe('[Teste] Nova quota');
      expect(x.body).not.toMatch(/\d|€/);
    }
    // Lembrete único por membro na data limite
    expect(await admin(`select count(*)::int n from public.module_reminders where entity = 'fin_quota_charge' and entity_id = any($1::uuid[]) and cancelled_at is null`, [[chargeP1, chargeP2]])).toEqual([{ n: 2 }]);
  });

  it('três pagamentos de 3,33/3,33/3,34 liquidam 10,00 exatamente; o pagamento é o movimento (conta uma vez)', async () => {
    await admin(`delete from public.notifications where section_id = $1`, [S]);
    const before = (await summary('GuiaA', { p_category: 'Quotas' })).totals.efetivo.receitas;
    for (const a of [333, 333, 334]) {
      await rpc(u('GuiaA'), 'fin_register_payment', { p_section: S, p_charge: chargeP1, p_on: '2026-10-05', p_account: caixa, p_amount: a });
    }
    const c1 = (await rpc<any[]>(u('GuiaA'), 'fin_list_quotas', { p_section: S })).find((x) => x.id === quota).charges.find((c: any) => c.id === chargeP1);
    expect(c1).toMatchObject({ pago: 1000, em_falta: 0, excesso: 0 });
    expect((await summary('GuiaA', { p_category: 'Quotas' })).totals.efetivo.receitas - before).toBe(1000);
    // Paga: lembrete cancelado; notificações genéricas
    expect(await admin(`select count(*)::int n from public.module_reminders where entity_id = $1 and cancelled_at is null and sent_at is null`, [chargeP1])).toEqual([{ n: 0 }]);
    const n = await admin(`select title, body from public.notifications where profile_id = $1 and kind = 'fin_pagamento'`, [u('P1')]);
    expect(n.length).toBe(1); // avisos iguais por ler juntam-se num só
    expect(n[0]).toEqual({ title: '[Teste] Pagamento registado', body: 'Foi registado um pagamento na tua situação da Tesouraria.' });
  });

  it('pagamento duplicado ou em excesso é recusado sem confirmação', async () => {
    await expectError(rpc(u('GuiaA'), 'fin_register_payment', { p_section: S, p_charge: chargeP1, p_on: '2026-10-06', p_account: caixa, p_amount: 1000 }), 'totalmente paga');
    await expectError(rpc(u('GuiaA'), 'fin_register_payment', { p_section: S, p_charge: chargeP2, p_on: '2026-10-06', p_account: caixa, p_amount: 500 }), 'em falta: 3,33 €');
    // Com confirmação explícita, o excesso fica registado e visível
    await rpc(u('GuiaA'), 'fin_register_payment', { p_section: S, p_charge: chargeP2, p_on: '2026-10-06', p_account: caixa, p_amount: 500, p_allow_excess: true });
    const c2 = (await rpc<any[]>(u('GuiaA'), 'fin_list_quotas', { p_section: S })).find((x) => x.id === quota).charges.find((c: any) => c.id === chargeP2);
    expect(c2).toMatchObject({ pago: 500, em_falta: 0, excesso: 167 });
  });

  it('o mesmo pagamento não pode ser ligado duas vezes nem a quota de outro membro', async () => {
    const q2 = await rpc<string>(u('GuiaA'), 'fin_save_quota', { p_section: S, p_id: null, p_name: 'Quota extra', p_period_start: '2026-09-01', p_period_end: '2026-12-31', p_amount: 200, p_due_date: '2099-12-31' });
    await rpc(u('GuiaA'), 'fin_apply_quota', { p_section: S, p_quota: q2, p_profiles: [u('P1'), u('P2')] });
    const charges = (await rpc<any[]>(u('GuiaA'), 'fin_list_quotas', { p_section: S })).find((x) => x.id === q2).charges;
    const cP1 = charges.find((c: any) => c.profile_id === u('P1')).id;
    const cP2 = charges.find((c: any) => c.profile_id === u('P2')).id;
    const pay = await mov('GuiaA', { p_member: u('P1'), p_amount: 200, p_category: 'Quotas', p_description: 'Pagamento em numerário' });
    await expectError(rpc(u('GuiaA'), 'fin_link_payment', { p_section: S, p_movement: pay, p_charge: cP2 }), 'do próprio membro');
    await rpc(u('GuiaA'), 'fin_link_payment', { p_section: S, p_movement: pay, p_charge: cP1 });
    await expectError(rpc(u('GuiaA'), 'fin_link_payment', { p_section: S, p_movement: pay, p_charge: cP1 }), 'não pode contar duas vezes');
    await expectError(rpc(u('GuiaA'), 'fin_link_payment', { p_section: S, p_movement: pay, p_charge: chargeP1 }), 'não pode contar duas vezes');
  });

  it('cada membro vê a sua própria situação, e só a sua', async () => {
    const me = await rpc<any>(u('P2'), 'fin_my_situation', { p_section: S });
    expect(me.charges.every((c: any) => c.profile_id === u('P2'))).toBe(true);
    expect(me.charges.find((c: any) => c.id === chargeP2)).toMatchObject({ quota_name: 'Quota 2026/27', amount_cents: 333, pago: 500, member_name: null });
    expect(me.totals).toMatchObject({ devido: 533, pago: 500, em_falta: 200 });
    expect(me.payments.length).toBe(1);
    const p1 = await rpc<any>(u('P1'), 'fin_my_situation', { p_section: S });
    expect(p1.payments.length).toBe(4);
    expect(JSON.stringify(p1)).not.toContain(u('P2'));
    // Quem não tem quotas vê uma situação vazia
    expect((await rpc<any>(u('Rui'), 'fin_my_situation', { p_section: S })).charges).toEqual([]);
  });

  it('pendente não conta como pago; ao passar a efetivo conta e notifica', async () => {
    const q3 = await rpc<string>(u('GuiaA'), 'fin_save_quota', { p_section: S, p_id: null, p_name: 'Quota acampamento', p_period_start: '2026-10-01', p_period_end: '2026-10-31', p_amount: 1500, p_due_date: '2099-12-31' });
    await rpc(u('GuiaA'), 'fin_apply_quota', { p_section: S, p_quota: q3, p_profiles: [u('P2')] });
    const ch = (await rpc<any[]>(u('GuiaA'), 'fin_list_quotas', { p_section: S })).find((x) => x.id === q3).charges[0].id;
    const pay = await rpc<string>(u('GuiaA'), 'fin_register_payment', { p_section: S, p_charge: ch, p_on: '2026-10-07', p_account: banco, p_amount: 1500, p_state: 'pendente' });
    let mine = (await rpc<any>(u('P2'), 'fin_my_situation', { p_section: S })).charges.find((c: any) => c.id === ch);
    expect(mine).toMatchObject({ pago: 0, pendente: 1500, em_falta: 1500 });
    await admin(`delete from public.notifications where section_id = $1`, [S]);
    await rpc(u('GuiaA'), 'fin_update_movement', { p_section: S, p_id: pay, p_kind: 'receita', p_on: '2026-10-07', p_description: 'Quota: Quota acampamento', p_category: 'Quotas', p_amount: 1500, p_account: banco, p_state: 'efetivo', p_activity: null, p_member: u('P2'), p_notes: null });
    mine = (await rpc<any>(u('P2'), 'fin_my_situation', { p_section: S })).charges.find((c: any) => c.id === ch);
    expect(mine).toMatchObject({ pago: 1500, pendente: 0, em_falta: 0 });
    expect(await admin(`select count(*)::int n from public.notifications where profile_id = $1 and kind = 'fin_pagamento'`, [u('P2')])).toEqual([{ n: 1 }]);
  });

  it('isentar e anular quotas cancelam lembretes; nada é apagado', async () => {
    const q4 = await rpc<string>(u('GuiaA'), 'fin_save_quota', { p_section: S, p_id: null, p_name: 'Quota a anular', p_period_start: '2026-10-01', p_period_end: '2026-10-31', p_amount: 100, p_due_date: '2099-12-31' });
    await rpc(u('GuiaA'), 'fin_apply_quota', { p_section: S, p_quota: q4, p_profiles: [u('P1'), u('P2')] });
    const cs = (await rpc<any[]>(u('GuiaA'), 'fin_list_quotas', { p_section: S })).find((x) => x.id === q4).charges;
    await rpc(u('GuiaA'), 'fin_waive_charge', { p_section: S, p_charge: cs[0].id, p_reason: 'Isenção social' });
    await rpc(u('GuiaA'), 'fin_void_quota', { p_section: S, p_id: q4, p_reason: 'Criada por engano' });
    expect(await admin(`select count(*)::int n from public.module_reminders where entity_id = any($1::uuid[]) and cancelled_at is null`, [cs.map((c: any) => c.id)])).toEqual([{ n: 0 }]);
    const q = (await rpc<any[]>(u('GuiaA'), 'fin_list_quotas', { p_section: S })).find((x) => x.id === q4);
    expect(q).toMatchObject({ status: 'anulada', void_reason: 'Criada por engano' });
    expect(q.charges).toHaveLength(2);
    await expectError(rpc(u('GuiaA'), 'fin_register_payment', { p_section: S, p_charge: cs[1].id, p_on: '2026-10-07', p_account: banco, p_amount: 100 }), 'anulada');
  });
});

describe('correções, anulações e auditoria', () => {
  it('um efetivo não se altera: corrige-se com movimento ligado ao original; anula-se com motivo', async () => {
    const id = await mov('GuiaA', { p_amount: 1234, p_category: 'Material', p_kind: 'despesa', p_description: 'Cordas' });
    const upd = { p_section: S, p_id: id, p_kind: 'despesa', p_on: '2026-10-01', p_description: 'Cordas', p_category: 'Material', p_amount: 1243, p_account: caixa, p_state: 'efetivo', p_activity: null, p_member: null, p_notes: null };
    await expectError(rpc(u('GuiaA'), 'fin_update_movement', upd), 'Corrigir');
    // Descrição pode ser ajustada
    await rpc(u('GuiaA'), 'fin_update_movement', { ...upd, p_amount: 1234, p_description: 'Cordas de sisal' });
    await expectError(rpc(u('GuiaA'), 'fin_correct_movement', { ...upd, p_reason: '' }), 'motivo');
    const fix = await rpc<string>(u('GuiaA'), 'fin_correct_movement', { ...upd, p_description: 'Cordas de sisal', p_reason: 'Valor trocado na fatura' });
    const list = await rpc<any[]>(u('GuiaA'), 'fin_list_movements', { p_section: S, p_category: 'Material' });
    const orig = list.find((m) => m.id === id);
    const corr = list.find((m) => m.id === fix);
    expect(orig).toMatchObject({ replaced_by: fix, void_reason: 'Corrigido: Valor trocado na fatura' });
    expect(orig.voided_at).not.toBeNull();
    expect(corr).toMatchObject({ corrects_id: id, amount_cents: 1243, voided_at: null });
    expect((await summary('GuiaA', { p_category: 'Material' })).totals.efetivo.despesas).toBe(1243);
    // Não se corrige duas vezes o mesmo original nem se altera um anulado
    await expectError(rpc(u('GuiaA'), 'fin_correct_movement', { ...upd, p_reason: 'Outra vez' }), 'anulado ou corrigido');
    await expectError(rpc(u('GuiaA'), 'fin_update_movement', { ...upd, p_amount: 1234 }), 'anulado');
    await expectError(rpc(u('GuiaA'), 'fin_void_movement', { p_section: S, p_id: fix, p_reason: '' }), 'motivo');
    await rpc(u('GuiaA'), 'fin_void_movement', { p_section: S, p_id: fix, p_reason: 'Devolvido ao fornecedor' });
    await expectError(rpc(u('GuiaA'), 'fin_void_movement', { p_section: S, p_id: fix, p_reason: 'De novo' }), 'já está anulado');
    expect((await summary('GuiaA', { p_category: 'Material' })).totals.efetivo.despesas).toBe(0);
    expect(await admin(`select count(*)::int n from public.fin_movements where id = any($1::uuid[])`, [[id, fix]])).toEqual([{ n: 2 }]);

    // Auditoria: quem, quando, valores antigos e novos
    const h = await rpc<any[]>(u('GuiaA'), 'fin_history', { p_section: S, p_entity_id: id });
    expect(h.map((x) => x.action)).toEqual(['criado', 'alterado', 'corrigido']);
    expect(h[1]).toMatchObject({ old_values: { description: 'Cordas' }, new_values: { description: 'Cordas de sisal' } });
    expect(h[0].actor_name).toMatch(/GuiaA/);
    expect(h[2].new_values.replaced_by).toBe(fix);
    const h2 = await rpc<any[]>(u('GuiaA'), 'fin_history', { p_section: S, p_entity_id: fix });
    expect(h2.map((x) => x.action)).toEqual(['criado', 'anulado']);
    expect(h2[1].new_values.void_reason).toBe('Devolvido ao fornecedor');
    expect(h2[1].at).toBeTruthy();
  });

  it('corrigir um pagamento de quota mantém a ligação e não duplica', async () => {
    const q = await rpc<string>(u('GuiaA'), 'fin_save_quota', { p_section: S, p_id: null, p_name: 'Quota de correção', p_period_start: '2026-10-01', p_period_end: '2026-10-31', p_amount: 800, p_due_date: '2099-12-31' });
    await rpc(u('GuiaA'), 'fin_apply_quota', { p_section: S, p_quota: q, p_profiles: [u('P1')] });
    const ch = (await rpc<any[]>(u('GuiaA'), 'fin_list_quotas', { p_section: S })).find((x) => x.id === q).charges[0].id;
    const pay = await rpc<string>(u('GuiaA'), 'fin_register_payment', { p_section: S, p_charge: ch, p_on: '2026-10-08', p_account: caixa, p_amount: 700 });
    await rpc(u('GuiaA'), 'fin_correct_movement', { p_section: S, p_id: pay, p_kind: 'receita', p_on: '2026-10-08', p_description: 'Quota: Quota de correção', p_category: 'Quotas', p_amount: 800, p_account: caixa, p_state: 'efetivo', p_activity: null, p_member: u('P1'), p_notes: null, p_reason: 'Valor certo é 8,00' });
    const c = (await rpc<any[]>(u('GuiaA'), 'fin_list_quotas', { p_section: S })).find((x) => x.id === q).charges[0];
    expect(c).toMatchObject({ pago: 800, em_falta: 0, excesso: 0 });
  });
});

describe('comprovativos', () => {
  it('só quem gere e o próprio membro (no seu pagamento) acedem; ninguém mais', async () => {
    const pay = await mov('GuiaA', { p_member: u('P1'), p_amount: 300, p_category: 'Atividades', p_description: 'Inscrição do P1' });
    const other = await mov('GuiaA', { p_amount: 300, p_kind: 'despesa', p_category: 'Material', p_description: 'Fatura' });
    const path = await rpc<string>(u('GuiaA'), 'module_file_prepare', { p_section: S, p_module: 'tesouraria', p_entity: 'movimento', p_entity_id: pay, p_file_name: 'recibo.pdf', p_mime: 'application/pdf' });
    const path2 = await rpc<string>(u('GuiaA'), 'module_file_prepare', { p_section: S, p_module: 'tesouraria', p_entity: 'movimento', p_entity_id: other, p_file_name: 'fatura.pdf', p_mime: 'application/pdf' });
    expect(path).toContain('/tesouraria/teste/');
    const files = (who: string, id: string) => rpc<any[]>(u(who), 'module_files_of', { p_section: S, p_module: 'tesouraria', p_entity: 'movimento', p_entity_id: id });
    expect(await files('GuiaA', pay)).toHaveLength(1);
    expect(await files('P1', pay)).toHaveLength(1);
    expect(await files('P2', pay)).toHaveLength(0);
    expect(await files('Rui', pay)).toHaveLength(0);
    expect(await files('Ana', pay)).toHaveLength(0);
    expect(await files('P1', other)).toHaveLength(0);
    // Ler pelo armazenamento usa a mesma regra
    const can = async (who: string, p: string) => (await asUser(u(who), `select private.module_file_access($1, false) as ok`, [p]))[0].ok;
    expect(await can('P1', path)).toBe(true);
    expect(await can('P2', path)).toBe(false);
    expect(await can('P1', path2)).toBe(false);
    // Anexar/retirar só quem gere
    await expectDenied(rpc(u('P1'), 'module_file_prepare', { p_section: S, p_module: 'tesouraria', p_entity: 'movimento', p_entity_id: pay, p_file_name: 'x.pdf', p_mime: 'application/pdf' }), 'permissão');
    await expectDenied(rpc(u('P1'), 'module_file_remove', { p_path: path }), 'permissão');
    const me = await rpc<any>(u('P1'), 'fin_my_situation', { p_section: S });
    expect(me.payments.find((p: any) => p.id === pay).files).toBe(1);
  });
});

describe('isolamento teste/real', () => {
  it('ao publicar, o espaço real começa vazio e os dados de teste não entram nos saldos reais', async () => {
    const testTotals = (await summary('GuiaA')).totals.efetivo;
    expect(testTotals.receitas).toBeGreaterThan(0);
    await setupModule(w, 'tesouraria', 'disponivel');
    const real = await summary('P3');
    expect(real.totals.efetivo).toEqual({ receitas: 0, despesas: 0, saldo: 0 });
    expect(real.accounts).toEqual([]);
    expect((await rpc<any>(u('P1'), 'fin_my_situation', { p_section: S })).charges).toEqual([]);
    expect((await rpc<any[]>(u('P1'), 'fin_activity_options', { p_section: S })).map((o) => o.title)).toEqual(['Atividade real']);
    // Registos de teste não são aceites no espaço real
    await expectError(rpc(u('GuiaA'), 'fin_void_movement', { p_section: S, p_id: (await admin(`select id from public.fin_movements where section_id = $1 and space = 'teste' and voided_at is null limit 1`, [S]))[0].id, p_reason: 'Teste de isolamento' }), 'Registo não encontrado');
    await expectError(mov('GuiaA', { p_account: caixa }), 'conta ou caixa');
    // Dados reais ficam no espaço real
    const caixaReal = await rpc<string>(u('GuiaA'), 'fin_save_account', { p_section: S, p_id: null, p_name: 'Caixa', p_kind: 'caixa' });
    await mov('GuiaA', { p_account: caixaReal, p_amount: 250, p_activity: realEvent });
    expect((await summary('P3')).totals.efetivo.receitas).toBe(250);
    // Voltar a teste: os testers continuam a ver só os dados de teste
    await setupModule(w, 'tesouraria', 'teste');
    expect((await summary('GuiaA')).totals.efetivo).toEqual(testTotals);
    const n = await admin(`select space, count(*)::int n from public.fin_movements where section_id = $1 group by space order by space`, [S]);
    expect(n.find((r) => r.space === 'real').n).toBe(1);
    // Notificações em teste só para testers
    expect(await admin(`select count(*)::int n from public.notifications where section_id = $1 and kind like 'fin_%' and profile_id = $2`, [S, u('P3')])).toEqual([{ n: 0 }]);
  });

  it('passar os dados de teste a reais só por escolha explícita da administração (com auditoria)', async () => {
    const testTotals = (await summary('GuiaA')).totals.efetivo;
    await rpc(u('Ana'), 'set_module_status', { p_section: S, p_module: 'tesouraria', p_status: 'disponivel', p_move_test_data: true });
    const real = (await summary('P3')).totals.efetivo;
    expect(real.receitas).toBe(testTotals.receitas + 250);
    expect(await admin(`select count(*)::int n from public.fin_movements where section_id = $1 and space = 'teste'`, [S])).toEqual([{ n: 0 }]);
    expect((await admin(`select count(*)::int n from public.fin_audit where section_id = $1 and action = 'passado_a_real'`, [S]))[0].n).toBeGreaterThan(0);
    // A atividade de teste do Calendário não passou: os registos reais deixam de lhe estar ligados
    expect(await admin(`select count(*)::int n from public.fin_movements where activity_id = $1`, [acamp])).toEqual([{ n: 0 }]);
    expect(await admin(`select count(*)::int n from public.fin_budget_lines where activity_id = $1 and voided_at is null`, [acamp])).toEqual([{ n: 0 }]);
    expect((await rpc<any[]>(u('P3'), 'fin_activity_results', { p_section: S })).map((a) => a.title)).toEqual(['Atividade real']);
    // A atividade real continua ligada
    expect((await summary('P3', { p_activity: realEvent })).totals.efetivo.receitas).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// v2: painel financeiro (secção própria, para valores exatos)
// ---------------------------------------------------------------------------
describe('v2 — painel, saldo inicial e movimentos partilhados', () => {
  let w2: World;
  let S2: string;
  const v = (n: string) => w2.users[n];
  let cx: string; // caixa
  let bk: string; // conta bancária
  let ev: string; // atividade (teste)
  let globalOpening: string;
  let payP2: string;

  const m2 = (extra: Record<string, unknown> = {}) => rpc<string>(v('GuiaA'), 'fin_create_movement', {
    p_section: S2, p_kind: 'receita', p_on: '2025-09-10', p_description: 'Movimento', p_category: 'Outros',
    p_amount: 100, p_account: cx, p_state: 'efetivo', ...extra,
  });
  const dash = (who: string, extra: Record<string, unknown> = {}) => rpc<any>(v(who), 'fin_dashboard', { p_section: S2, ...extra });
  const opening = (who: string, extra: Record<string, unknown> = {}) => rpc<string>(v(who), 'fin_save_opening_balance', {
    p_section: S2, p_id: null, p_account: null, p_reference_date: '2025-09-01', p_amount: 10000, p_notes: 'Transitado do ano anterior', ...extra,
  });

  beforeAll(async () => {
    w2 = await buildWorld('tesouraria-v2');
    S2 = w2.section;
    await setupModule(w2, 'tesouraria', 'teste', ['Ana', 'Rui', 'GuiaA', 'P1', 'P2'], [['tesouraria.gerir', 'GuiaA']]);
    cx = await rpc(v('GuiaA'), 'fin_save_account', { p_section: S2, p_id: null, p_name: 'Caixa', p_kind: 'caixa' });
    bk = await rpc(v('GuiaA'), 'fin_save_account', { p_section: S2, p_id: null, p_name: 'Banco', p_kind: 'conta' });
    ev = (await admin(`insert into public.cal_events (section_id, space, title, all_day, start_date, end_date, created_by)
                       values ($1, 'teste', 'Raide', true, '2025-10-04', '2025-10-05', $2) returning id`, [S2, v('Ana')]))[0].id;
  });

  it('a assinatura de fin_create_movement (usada pelo Inventário) mantém-se', async () => {
    const r = await admin(`select pg_get_function_identity_arguments('public.fin_create_movement'::regproc) a`);
    expect(r[0].a).toBe('p_section uuid, p_kind text, p_on date, p_description text, p_category text, p_amount bigint, p_account uuid, p_state text, p_activity uuid, p_member uuid, p_notes text, p_client_key uuid');
  });

  it('sem saldo inicial: saldo atual = receitas − despesas (só efetivos não anulados)', async () => {
    const d = await dash('P1');
    expect(d.opening).toMatchObject({ mode: 'nenhum', total: 0, items: [] });
    expect(d.current).toEqual({ saldo_inicial: 0, receitas: 0, despesas: 0, saldo: 0 });
    expect(d.can_manage).toBe(false);
  });

  it('saldo inicial global: fórmula com os números que a compõem; anteriores à data não contam duas vezes', async () => {
    globalOpening = await opening('GuiaA');
    await m2({ p_on: '2025-08-20', p_amount: 5000, p_description: 'Antes do saldo inicial' }); // já incluído no saldo inicial
    await m2({ p_on: '2025-09-10', p_amount: 2000 });
    await m2({ p_on: '2025-10-05', p_amount: 750, p_kind: 'despesa', p_activity: ev, p_category: 'Alimentação' });
    await m2({ p_on: '2025-10-04', p_amount: 1200, p_activity: ev, p_category: 'Atividades', p_account: bk });
    await m2({ p_on: '2025-10-06', p_amount: 300, p_state: 'pendente' });
    await m2({ p_on: '2025-10-06', p_amount: 400, p_state: 'previsto', p_kind: 'despesa' });
    const anul = await m2({ p_on: '2025-10-07', p_amount: 9999 });
    await rpc(v('GuiaA'), 'fin_void_movement', { p_section: S2, p_id: anul, p_reason: 'Registado por engano' });
    for (const who of ['GuiaA', 'P1']) {
      const d = await dash(who);
      expect(d.opening).toMatchObject({ mode: 'global', total: 10000, reference_date: '2025-09-01' });
      expect(d.opening.items).toHaveLength(1);
      expect(d.current).toEqual({ saldo_inicial: 10000, receitas: 3200, despesas: 750, saldo: 12450 });
      expect(d.before_opening).toEqual({ count: 1, receitas: 5000, despesas: 0 });
    }
    // Quem consulta não vê as notas nem quem registou o saldo inicial
    expect((await dash('P1')).opening.items[0]).not.toHaveProperty('notes');
    expect((await dash('GuiaA')).opening.items[0].notes).toBe('Transitado do ano anterior');
    // A lista assinala o movimento anterior ao saldo inicial
    const list = await rpc<any>(v('GuiaA'), 'fin_search_movements', { p_section: S2, p_search: 'antes do saldo' });
    expect(list.items).toHaveLength(1);
    expect(list.items[0].before_opening).toBe(true);
  });

  it('período, ano escutista (setembro–agosto), mês e atividade', async () => {
    const ano = await dash('P1', { p_from: '2025-09-01', p_to: '2026-08-31' });
    expect(ano.totals.efetivo).toEqual({ receitas: 3200, despesas: 750, saldo: 2450 });
    expect(ano.totals.pendente).toEqual({ receitas: 300, despesas: 0, saldo: 300 });
    expect(ano.totals.previsto).toEqual({ receitas: 0, despesas: 400, saldo: -400 });
    // O saldo atual não depende do filtro
    expect(ano.current.saldo).toBe(12450);
    // Evolução mensal desde a data do saldo inicial
    expect(ano.evolution.granularity).toBe('mes');
    expect(ano.evolution.points[0]).toEqual({ date: '2025-09-01', kind: 'inicio', saldo: 10000 });
    expect(ano.evolution.points[1]).toEqual({ date: '2025-09-30', kind: 'mes', saldo: 12000 });
    expect(ano.evolution.points[2]).toEqual({ date: '2025-10-31', kind: 'mes', saldo: 12450 });
    expect(ano.evolution.points.at(-1)).toMatchObject({ date: '2026-08-31', saldo: 12450 });
    expect(ano.years).toEqual(expect.arrayContaining([2025, 2024]));
    // Ano escutista anterior: o movimento de agosto aparece nos totais do período, mas a evolução
    // só começa no saldo inicial (não há pontos antes dele)
    const anterior = await dash('P1', { p_from: '2024-09-01', p_to: '2025-08-31' });
    expect(anterior.totals.efetivo.receitas).toBe(5000);
    expect(anterior.evolution.points).toEqual([]);
    // Mês de outubro: evolução diária
    const out = await dash('P1', { p_from: '2025-10-01', p_to: '2025-10-31' });
    expect(out.totals.efetivo).toEqual({ receitas: 1200, despesas: 750, saldo: 450 });
    expect(out.evolution.granularity).toBe('dia');
    expect(out.evolution.points).toEqual([
      { date: '2025-10-01', kind: 'inicio', saldo: 12000 },
      { date: '2025-10-04', kind: 'dia', saldo: 13200 },
      { date: '2025-10-05', kind: 'dia', saldo: 12450 },
      { date: '2025-10-31', kind: 'dia', saldo: 12450 },
    ]);
    // Atividade: totais e resultado da atividade
    const act = await dash('P1', { p_activity: ev });
    expect(act.totals.efetivo).toEqual({ receitas: 1200, despesas: 750, saldo: 450 });
    expect(act.activity).toMatchObject({ title: 'Raide', efetivo: { receitas: 1200, despesas: 750, resultado: 450 } });
    expect(act.latest.every((m: any) => m.activity_id === ev)).toBe(true);
    await expectError(dash('P1', { p_from: '2025-10-31', p_to: '2025-10-01' }), 'período');
  });

  it('saldo inicial por conta: exclusivo com o global, um por conta, alterações auditadas', async () => {
    await expectError(opening('GuiaA', { p_account: cx }), 'saldo inicial global');
    await expectError(opening('GuiaA'), 'altera-o');
    await expectError(rpc(v('GuiaA'), 'fin_void_opening_balance', { p_section: S2, p_id: globalOpening, p_reason: '' }), 'motivo');
    await rpc(v('GuiaA'), 'fin_void_opening_balance', { p_section: S2, p_id: globalOpening, p_reason: 'Passamos a saldo por conta' });
    const oc = await opening('GuiaA', { p_account: cx, p_reference_date: '2025-10-01', p_amount: 500, p_notes: null });
    await expectError(opening('GuiaA'), 'por conta ou caixa');
    await expectError(opening('GuiaA', { p_account: cx }), 'altera-o');
    // Caixa: só conta o que é a partir de 01/10/2025; banco (sem saldo inicial): tudo
    let d = await dash('P1');
    expect(d.opening.mode).toBe('conta');
    expect(d.current).toEqual({ saldo_inicial: 500, receitas: 1200, despesas: 750, saldo: 950 });
    expect(d.before_opening).toEqual({ count: 2, receitas: 7000, despesas: 0 });
    expect(d.accounts.find((a: any) => a.id === cx)).toMatchObject({ saldo: -250, movimentos: -750, opening: { amount_cents: 500, reference_date: '2025-10-01' } });
    expect(d.accounts.find((a: any) => a.id === bk)).toMatchObject({ saldo: 1200, opening: null });
    // O resumo v1 usa a mesma regra por conta
    const s = await rpc<any>(v('P1'), 'fin_summary', { p_section: S2 });
    expect(s.accounts.find((a: any) => a.id === cx).saldo).toBe(-250);
    // Alterar (auditado, com valores antigos e novos); mudar de conta não
    await rpc(v('GuiaA'), 'fin_save_opening_balance', { p_section: S2, p_id: oc, p_account: cx, p_reference_date: '2025-10-01', p_amount: 650, p_notes: 'Contagem da caixa' });
    await expectError(rpc(v('GuiaA'), 'fin_save_opening_balance', { p_section: S2, p_id: oc, p_account: bk, p_reference_date: '2025-10-01', p_amount: 650 }), 'mudar a conta');
    await expectError(opening('GuiaA', { p_account: bk, p_reference_date: '2099-01-01' }), 'futura');
    d = await dash('P1');
    expect(d.current.saldo).toBe(1100);
    const h = await rpc<any[]>(v('GuiaA'), 'fin_history', { p_section: S2, p_entity_id: oc });
    expect(h.map((x) => x.action)).toEqual(['criado', 'alterado']);
    expect(h[1]).toMatchObject({ old_values: { amount_cents: 500, notes: null }, new_values: { amount_cents: 650, notes: 'Contagem da caixa' } });
    const hg = await rpc<any[]>(v('GuiaA'), 'fin_history', { p_section: S2, p_entity_id: globalOpening });
    expect(hg.map((x) => x.action)).toEqual(['criado', 'anulado']);
    // Lista para quem gere inclui anulados; quem consulta só vê os ativos
    expect(await rpc<any[]>(v('GuiaA'), 'fin_list_opening_balances', { p_section: S2 })).toHaveLength(2);
    const pub = await rpc<any[]>(v('P1'), 'fin_list_opening_balances', { p_section: S2 });
    expect(pub).toHaveLength(1);
    expect(pub[0]).not.toHaveProperty('notes');
  });

  it('só quem tem tesouraria.gerir define o saldo inicial (dirigente e administração sem autorização não)', async () => {
    for (const who of ['Rui', 'Ana', 'P1']) {
      await expectDenied(opening(who, { p_account: bk }), 'permissão');
      await expectDenied(rpc(v(who), 'fin_void_opening_balance', { p_section: S2, p_id: globalOpening, p_reason: 'Tentativa' }), 'permissão');
      await expectDenied(rpc(v(who), 'fin_create_movement', { p_section: S2, p_kind: 'receita', p_on: '2025-10-01', p_description: 'X', p_category: 'Outros', p_amount: 1, p_account: cx, p_state: 'efetivo' }), 'permissão');
    }
    for (const fn of ['fin_dashboard', 'fin_search_movements', 'fin_list_opening_balances']) {
      await expectDenied(rpc(v('P3'), fn, { p_section: S2 }), 'não está disponível');
    }
  });

  it('movimentos partilhados: quem consulta nunca vê o membro, as observações nem comprovativos alheios', async () => {
    payP2 = await m2({ p_on: '2025-10-08', p_amount: 1500, p_member: v('P2'), p_category: 'Atividades',
                       p_description: 'Inscrição paga por P2 tesouraria-v2', p_notes: 'Nota privada sobre a família' });
    await rpc(v('GuiaA'), 'module_file_prepare', { p_section: S2, p_module: 'tesouraria', p_entity: 'movimento', p_entity_id: payP2, p_file_name: 'recibo.pdf', p_mime: 'application/pdf' });
    const voided = await m2({ p_on: '2025-10-09', p_amount: 42, p_description: 'Anulado com motivo pessoal' });
    await rpc(v('GuiaA'), 'fin_void_movement', { p_section: S2, p_id: voided, p_reason: 'Motivo com nome de pessoa' });

    const p1 = await rpc<any>(v('P1'), 'fin_search_movements', { p_section: S2 });
    const row = p1.items.find((x: any) => x.id === payP2);
    expect(row).toMatchObject({ description: 'Pagamento individual', category: 'Atividades', amount_cents: 1500, individual: true, mine: false, files: 0 });
    for (const k of ['member_profile_id', 'member_name', 'notes', 'account_name', 'created_by_name', 'quota_name']) expect(row).not.toHaveProperty(k);
    const txt = JSON.stringify(p1);
    expect(txt).not.toContain(v('P2'));
    expect(txt).not.toContain('P2 tesouraria-v2');
    expect(txt).not.toContain('Nota privada');
    expect(txt).not.toContain('Anulado com motivo');
    // Pedir anulados sem permissão não os mostra
    expect(JSON.stringify(await rpc(v('P1'), 'fin_search_movements', { p_section: S2, p_include_voided: true }))).not.toContain(voided);
    // A pesquisa de quem consulta não encontra pelo que está escondido
    expect((await rpc<any>(v('P1'), 'fin_search_movements', { p_section: S2, p_search: 'P2 tesouraria' })).items).toEqual([]);
    expect((await rpc<any>(v('P1'), 'fin_search_movements', { p_section: S2, p_search: 'família' })).items).toEqual([]);
    expect((await rpc<any>(v('P1'), 'fin_search_movements', { p_section: S2, p_search: 'aliment' })).items).toHaveLength(1);
    expect((await rpc<any>(v('P1'), 'fin_search_movements', { p_section: S2, p_search: 'raide' })).items).toHaveLength(2);
    // Os últimos movimentos do painel seguem a mesma regra
    expect(JSON.stringify(await dash('P1'))).not.toContain('P2 tesouraria-v2');
    // O próprio vê o seu pagamento e o comprovativo
    const p2 = (await rpc<any>(v('P2'), 'fin_search_movements', { p_section: S2 })).items.find((x: any) => x.id === payP2);
    expect(p2).toMatchObject({ description: 'Inscrição paga por P2 tesouraria-v2', mine: true, files: 1 });
    expect(p2).not.toHaveProperty('notes');
    // Quem gere vê tudo, pesquisa pelo nome e pelas observações e pode incluir anulados
    const g = await rpc<any>(v('GuiaA'), 'fin_search_movements', { p_section: S2, p_search: 'família' });
    expect(g.items).toHaveLength(1);
    expect(g.items[0]).toMatchObject({ member_name: 'P2 tesouraria-v2', notes: 'Nota privada sobre a família', files: 1 });
    expect((await rpc<any>(v('GuiaA'), 'fin_search_movements', { p_section: S2, p_include_voided: true })).items.some((x: any) => x.id === voided)).toBe(true);
    expect((await rpc<any>(v('GuiaA'), 'fin_search_movements', { p_section: S2 })).items.some((x: any) => x.id === voided)).toBe(false);
    // Filtros de período e estado
    expect((await rpc<any>(v('P1'), 'fin_search_movements', { p_section: S2, p_from: '2025-10-06', p_to: '2025-10-06' })).total).toBe(2);
    expect((await rpc<any>(v('P1'), 'fin_search_movements', { p_section: S2, p_state: 'pendente' })).total).toBe(1);
  });

  it('isolamento: o espaço real tem o seu próprio saldo inicial; ao publicar nunca ficam dois', async () => {
    const testSaldo = (await dash('GuiaA')).current.saldo;
    await setupModule(w2, 'tesouraria', 'disponivel');
    let real = await dash('P3');
    expect(real.opening.mode).toBe('nenhum');
    expect(real.current).toEqual({ saldo_inicial: 0, receitas: 0, despesas: 0, saldo: 0 });
    expect((await rpc<any>(v('P3'), 'fin_search_movements', { p_section: S2 })).items).toEqual([]);
    await opening('GuiaA', { p_reference_date: '2026-09-01', p_amount: 777 });
    expect((await dash('P3')).current.saldo).toBe(777);
    await setupModule(w2, 'tesouraria', 'teste');
    expect((await dash('GuiaA')).current.saldo).toBe(testSaldo);
    // Passar os dados de teste a reais: o saldo inicial de teste é anulado (registado), o real mantém-se
    await rpc(v('Ana'), 'set_module_status', { p_section: S2, p_module: 'tesouraria', p_status: 'disponivel', p_move_test_data: true });
    real = await dash('P3');
    expect(real.opening.mode).toBe('global');
    expect(real.opening.total).toBe(777);
    expect(await admin(`select count(*)::int n from public.fin_opening_balances where section_id = $1 and space = 'real' and voided_at is null`, [S2])).toEqual([{ n: 1 }]);
    expect(await admin(`select count(*)::int n from public.fin_opening_balances where section_id = $1 and space = 'teste'`, [S2])).toEqual([{ n: 0 }]);
  });
});
