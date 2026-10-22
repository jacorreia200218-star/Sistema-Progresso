import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, buildWorld, expectError, pool, rpc, today, trailsByArea, type World } from './helpers';
import { markSubmitted, seedHistorical } from './helpers';

let w: World;
let byArea: Awaited<ReturnType<typeof trailsByArea>>;

const draft = (u: string, req: string, approx = 'Primavera de 2025') =>
  rpc(u, 'save_request_draft', { p_request: req, p_reflection: 'Fiz isto antes da aplicação existir.', p_experiences: 'Acampamento', p_period_start: null, p_period_end: null, p_approximate_date: approx });

beforeAll(async () => {
  w = await buildWorld('historico');
  byArea = await trailsByArea();
});
afterAll(() => pool.end());

describe('progresso anterior', () => {
  let pending: string;
  let openDraft: string;

  it('está ativo por omissão e segue diretamente para os dirigentes', async () => {
    const s = await asUser(w.users.P2, `select historical_progress_enabled from public.section_settings where section_id = $1`, [w.section]);
    expect(s[0].historical_progress_enabled).toBe(true);
    pending = await seedHistorical(w, 'P2', byArea.F[0].id);
    await draft(w.users.P2, pending);
    // O pioneiro já não envia progresso anterior; os pedidos antigos continuam a ser decididos.
    await expectError(rpc(w.users.P2, 'submit_trail_request', { p_request: pending }), 'registado pelos dirigentes');
    await markSubmitted(pending);
    // O guia não revê pedidos históricos
    await expectError(rpc(w.users.GuiaA, 'record_team_decision', { p_request: pending, p_expected_version: 1, p_validated: true, p_meeting_date: today(), p_comment: null }), 'decididos pelos dirigentes');
    await expectError(rpc(w.users.GuiaA, 'mark_request_in_review', { p_request: pending }), 'Sem permissão');
  });

  it('pendentes não contam como trilhos concluídos', async () => {
    const e = await rpc(w.users.P2, 'merit_eligibility', { p_membership: w.members.P2 });
    expect(e.validated).toBe(0);
  });

  it('desligar a opção bloqueia novas submissões, mesmo com o formulário aberto', async () => {
    openDraft = await seedHistorical(w, 'P2', byArea.A[0].id);
    await draft(w.users.P2, openDraft);
    await expectError(rpc(w.users.Rui, 'set_historical_progress', { p_section: w.section, p_enabled: false }), 'administradores');
    await rpc(w.users.Tecnico, 'set_historical_progress', { p_section: w.section, p_enabled: false });
    await expectError(rpc(w.users.P2, 'submit_trail_request', { p_request: openDraft }), 'registado pelos dirigentes');
    // Os pioneiros já não criam pedidos de progresso anterior: é registado pelos dirigentes
    await expectError(rpc(w.users.P2, 'create_trail_request', { p_membership: w.members.P2, p_trail: byArea.C[0].id, p_kind: 'historico' }), 'registado pelos dirigentes');
    // Progresso normal continua disponível
    const normal = await rpc<string>(w.users.P2, 'create_trail_request', { p_membership: w.members.P2, p_trail: byArea.C[0].id, p_kind: 'normal' });
    expect(normal).toBeTruthy();
  });

  it('pedidos já submetidos continuam avaliáveis com a opção desligada', async () => {
    await expectError(rpc(w.users.P2, 'decide_historical_request', { p_request: pending, p_expected_version: 1, p_outcome: 'aprovado', p_comment: null, p_reference_date: null }), 'dirigentes');
    await expectError(rpc(w.users.Ana, 'decide_historical_request', { p_request: pending, p_expected_version: 1, p_outcome: 'recusado', p_comment: '', p_reference_date: null }), 'motivo');
    await rpc(w.users.Ana, 'decide_historical_request', { p_request: pending, p_expected_version: 1, p_outcome: 'aprovado', p_comment: 'Confirmado pelos registos da Equipa de Animação anterior.', p_reference_date: '2025-04-15' });
    const r = await asUser(w.users.P2, `select r.status, r.approved_reference_date::text ref, d.recorded_at::date = current_date same_day
      from public.trail_requests r join public.trail_decisions d on d.request_id = r.id where r.id = $1`, [pending]);
    // A referência temporal fornecida fica separada da data real da decisão
    expect(r[0]).toEqual({ status: 'aprovado', ref: '2025-04-15', same_day: true });
    expect((await rpc(w.users.P2, 'merit_eligibility', { p_membership: w.members.P2 })).validated).toBe(1);
  });

  it('não é possível duplicar o mesmo trilho entre histórico e normal', async () => {
    await expectError(rpc(w.users.P2, 'create_trail_request', { p_membership: w.members.P2, p_trail: byArea.F[0].id, p_kind: 'normal' }), 'Já existe um pedido ativo');
  });

  it('pedido histórico devolvido com a opção desligada não contorna a configuração', async () => {
    await rpc(w.users.Tecnico, 'set_historical_progress', { p_section: w.section, p_enabled: true });
    await markSubmitted(openDraft);
    await rpc(w.users.Tecnico, 'set_historical_progress', { p_section: w.section, p_enabled: false });
    await rpc(w.users.Rui, 'decide_historical_request', { p_request: openDraft, p_expected_version: 1, p_outcome: 'devolvido', p_comment: 'Falta explicar melhor.', p_reference_date: null });
    await expectError(rpc(w.users.P2, 'start_new_version', { p_request: openDraft }), 'registado pelos dirigentes');
    // Alternativa: cancelar e seguir pelo progresso normal
    await rpc(w.users.P2, 'cancel_trail_request', { p_request: openDraft });
    const n = await rpc<string>(w.users.P2, 'create_trail_request', { p_membership: w.members.P2, p_trail: byArea.A[0].id, p_kind: 'normal' });
    expect(n).toBeTruthy();
  });

  it('recusa exige comentário e mantém histórico; reativação regista autor e data', async () => {
    await rpc(w.users.Tecnico, 'set_historical_progress', { p_section: w.section, p_enabled: true });
    const r = await seedHistorical(w, 'P2', byArea.E[0].id);
    await draft(w.users.P2, r);
    await markSubmitted(r);
    await rpc(w.users.Ana, 'decide_historical_request', { p_request: r, p_expected_version: 1, p_outcome: 'recusado', p_comment: 'Não há evidência suficiente; pode seguir pelo progresso normal.', p_reference_date: null });
    const d = await asUser(w.users.P2, `select kind, comment from public.trail_decisions where request_id = $1`, [r]);
    expect(d[0].kind).toBe('recusado_historico');
    // Recusado: pode iniciar progresso normal para o mesmo trilho
    await rpc(w.users.P2, 'create_trail_request', { p_membership: w.members.P2, p_trail: byArea.E[0].id, p_kind: 'normal' });
    const h = await asUser(w.users.Tecnico, `select new_value, changed_by from public.settings_history where section_id = $1 order by changed_at`, [w.section]);
    expect(h.map((x) => x.new_value)).toEqual([false, true, false, true]);
    expect(h.every((x) => x.changed_by === w.users.Tecnico)).toBe(true);
  });

  it('declaração de etapa anterior exige decisão própria e trilhos reconhecidos atribuídos', async () => {
    await rpc(w.users.Ana, 'record_adhesion', { p_membership: w.members.P3, p_decided_on: '2024-11-01', p_commitment_on: '2024-12-01', p_notes: 'Registo anterior', p_is_historical: true });
    const p = await rpc<string>(w.users.Ana, 'open_stage', { p_membership: w.members.P3, p_stage_key: 'conhecimento', p_insignia_on: '2024-12-01' });
    await expectError(rpc(w.users.Ana, 'declare_historical_stage', { p_stage_path: p, p_date: '2025-06-01', p_comment: 'Etapa concluída em 2025' }), 'trilho validado de cada área');
    for (const code of Object.keys(byArea)) {
      const t = byArea[code][0];
      const req = await seedHistorical(w, 'P3', t.id);
      await draft(w.users.P3, req);
      await markSubmitted(req);
      await rpc(w.users.Ana, 'decide_historical_request', { p_request: req, p_expected_version: 1, p_outcome: 'aprovado', p_comment: null, p_reference_date: null });
      const c = await rpc<string>(w.users.P3, 'propose_choice', { p_stage_path: p, p_trail: t.id, p_planned: null, p_replaces: null });
      await rpc(w.users.Ana, 'decide_choice', { p_choice: c, p_accept: true, p_comment: 'Distribuição negociada' });
    }
    // A contagem sozinha não fecha a etapa
    expect((await asUser(w.users.P3, `select status from public.stage_paths where id = $1`, [p]))[0].status).toBe('em_curso');
    await expectError(rpc(w.users.Ana, 'declare_historical_stage', { p_stage_path: p, p_date: '2025-06-01', p_comment: '' }), 'Fundamenta');
    await rpc(w.users.Ana, 'declare_historical_stage', { p_stage_path: p, p_date: '2025-06-01', p_comment: 'Etapa celebrada em junho de 2025 (registo em papel).' });
    const s = await asUser(w.users.P3, `select status, completion_kind from public.stage_paths where id = $1`, [p]);
    expect(s[0]).toEqual({ status: 'concluida', completion_kind: 'historico' });
    // O pedido ao Conselho criado sozinho é substituído pela declaração; a Vontade abre sozinha
    const reqs = await admin(`select kind, status::text from public.stage_requests where stage_path_id = $1 order by requested_at`, [p]);
    expect(reqs).toEqual([{ kind: 'normal', status: 'cancelado' }, { kind: 'historico', status: 'confirmada' }]);
    expect((await admin(`select status from public.stage_paths where membership_id = $1 and stage_key = 'vontade'`, [w.members.P3]))[0].status).toBe('em_curso');
    expect(await admin(`select 1 from public.merit_awards where membership_id = $1`, [w.members.P3])).toHaveLength(0);
  });
});
