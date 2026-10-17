import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, buildWorld, confirmAllAreas, expectError, pool, rpc, today, trailsByArea, validateTrail, type World } from './helpers';

let w: World;
let byArea: Awaited<ReturnType<typeof trailsByArea>>;
let path1: string;

beforeAll(async () => {
  w = await buildWorld('percurso');
  byArea = await trailsByArea();
});
afterAll(() => pool.end());

describe('catálogo', () => {
  it('tem 6 áreas, 18 trilhos e 38 objetivos com códigos do manual', async () => {
    const areas = await asUser(w.users.P1, `select code from public.catalog_areas order by position`);
    expect(areas.map((a) => a.code)).toEqual(['F', 'A', 'C', 'E', 'I', 'S']);
    expect(await asUser(w.users.P1, `select id from public.catalog_trails`)).toHaveLength(18);
    const obj = await asUser(w.users.P1, `select code from public.catalog_objectives`);
    expect(obj).toHaveLength(38);
    const pending = await asUser(w.users.P1, `select code from public.catalog_objectives where pending_note is not null order by code`);
    expect(pending.map((p) => p.code)).toEqual(['C4', 'C7']);
    const stages = await asUser(w.users.P1, `select key from public.catalog_stages order by ordinal`);
    expect(stages.map((s) => s.key)).toEqual(['desprendimento', 'conhecimento', 'vontade', 'construcao']);
  });
});

describe('adesão e abertura de etapa', () => {
  it('não abre etapa sem adesão; dirigente regista adesão e abre Conhecimento com insígnia', async () => {
    await expectError(rpc(w.users.Ana, 'open_stage', { p_membership: w.members.P1, p_stage_key: 'conhecimento', p_insignia_on: today() }), 'adesão');
    await expectError(rpc(w.users.GuiaA, 'record_adhesion', { p_membership: w.members.P1, p_decided_on: today(), p_commitment_on: today(), p_notes: null, p_is_historical: false }), 'dirigentes');
    await rpc(w.users.Ana, 'record_adhesion', { p_membership: w.members.P1, p_decided_on: today(), p_commitment_on: today(), p_notes: 'Promessa', p_is_historical: false });
    await expectError(rpc(w.users.Ana, 'open_stage', { p_membership: w.members.P1, p_stage_key: 'vontade', p_insignia_on: null }), 'etapa anterior');
    path1 = await rpc(w.users.Ana, 'open_stage', { p_membership: w.members.P1, p_stage_key: 'conhecimento', p_insignia_on: today() });
    const p = await asUser(w.users.P1, `select status, insignia_delivered_on is not null as insignia from public.stage_paths where id = $1`, [path1]);
    expect(p[0]).toEqual({ status: 'em_curso', insignia: true });
  });
});

describe('negociação de escolhas', () => {
  it('pioneiro propõe, dirigente confirma; regras de área e de trilho único', async () => {
    const f0 = byArea.F[0];
    const c = await rpc<string>(w.users.P1, 'propose_choice', { p_stage_path: path1, p_trail: f0.id, p_planned: 'Raid; plano de treino', p_replaces: null });
    // Os dirigentes sabem quem quer fechar que trilho e abrem a proposta diretamente
    const note = (await admin(`select title, body, link from public.notifications where profile_id = $1 and kind = 'escolha_proposta' order by created_at desc limit 1`, [w.users.Ana]))[0];
    expect(note.title).toBe('Proposta para trabalhar num trilho');
    expect(note.body).toMatch(/quer trabalhar em «.+» \(Físico\) na etapa Conhecimento\./);
    expect(note.link).toBe(`/acompanhamento/proposta/${c}`);
    // Segunda proposta na mesma área enquanto há uma pendente
    await expectError(rpc(w.users.P1, 'propose_choice', { p_stage_path: path1, p_trail: byArea.F[1].id, p_planned: null, p_replaces: null }), 'proposta pendente');
    // Guia não confirma escolhas
    await expectError(rpc(w.users.GuiaA, 'decide_choice', { p_choice: c, p_accept: true, p_comment: null }), 'dirigentes');
    await expectError(rpc(w.users.Ana, 'decide_choice', { p_choice: c, p_accept: false, p_comment: '' }), 'motivo');
    await rpc(w.users.Ana, 'decide_choice', { p_choice: c, p_accept: true, p_comment: 'Boa escolha' });
    await expectError(rpc(w.users.P1, 'propose_choice', { p_stage_path: path1, p_trail: byArea.F[1].id, p_planned: null, p_replaces: null }), 'Propõe uma troca');
    // Outro pioneiro não mexe neste percurso
    await expectError(rpc(w.users.P2, 'propose_choice', { p_stage_path: path1, p_trail: byArea.A[0].id, p_planned: null, p_replaces: null }), 'Sem permissão');
  });

  it('troca negociada preserva histórico', async () => {
    const old = (await admin(`select id from public.stage_choices where stage_path_id = $1 and status = 'confirmada' and area_code = 'F'`, [path1]))[0].id;
    await expectError(rpc(w.users.P1, 'propose_choice', { p_stage_path: path1, p_trail: byArea.A[1].id, p_planned: null, p_replaces: old }), 'mesma área');
    const swap = await rpc<string>(w.users.P1, 'propose_choice', { p_stage_path: path1, p_trail: byArea.F[1].id, p_planned: 'Nova oportunidade', p_replaces: old });
    await rpc(w.users.Ana, 'decide_choice', { p_choice: swap, p_accept: true, p_comment: 'Troca aceite' });
    const all = await asUser(w.users.P1, `select status, trail_key from public.stage_choices where stage_path_id = $1 and area_code = 'F' order by proposed_at`, [path1]);
    expect(all.map((r) => r.status)).toEqual(['substituida', 'confirmada']);
    // Voltar ao trilho inicial (para o resto do teste)
    const cur = (await admin(`select id from public.stage_choices where stage_path_id = $1 and status = 'confirmada' and area_code = 'F'`, [path1]))[0].id;
    const back = await rpc<string>(w.users.P1, 'propose_choice', { p_stage_path: path1, p_trail: byArea.F[0].id, p_planned: 'Raid', p_replaces: cur });
    await rpc(w.users.Ana, 'decide_choice', { p_choice: back, p_accept: true, p_comment: null });
  });

  it('confirma as restantes áreas', async () => {
    for (const code of ['A', 'C', 'E', 'I', 'S']) {
      const c = await rpc<string>(w.users.P1, 'propose_choice', { p_stage_path: path1, p_trail: byArea[code][0].id, p_planned: 'Duas oportunidades', p_replaces: null });
      await rpc(w.users.Rui, 'decide_choice', { p_choice: c, p_accept: true, p_comment: null });
    }
    const n = await asUser(w.users.P1, `select count(*)::int n from public.stage_choices where stage_path_id = $1 and status = 'confirmada'`, [path1]);
    expect(n[0].n).toBe(6);
  });
});

describe('pedido de validação de trilho', () => {
  let req: string;

  it('rascunho, submissão e bloqueio de edição após submissão', async () => {
    req = await rpc(w.users.P1, 'create_trail_request', { p_membership: w.members.P1, p_trail: byArea.F[0].id, p_kind: 'normal' });
    await expectError(rpc(w.users.P1, 'create_trail_request', { p_membership: w.members.P1, p_trail: byArea.F[0].id, p_kind: 'normal' }), 'Já existe um pedido ativo');
    await expectError(rpc(w.users.P1, 'submit_trail_request', { p_request: req }), 'reflexão');
    await rpc(w.users.P1, 'save_request_draft', { p_request: req, p_reflection: 'Aprendi a gerir o esforço.', p_experiences: 'Raid de outubro', p_period_start: '2026-09-01', p_period_end: '2026-10-01', p_approximate_date: null });
    // Ninguém mais edita o rascunho
    await expectError(rpc(w.users.GuiaA, 'save_request_draft', { p_request: req, p_reflection: 'x', p_experiences: '', p_period_start: null, p_period_end: null, p_approximate_date: null }), 'não encontrado');
    // Guia não decide rascunhos
    await expectError(rpc(w.users.GuiaA, 'record_team_decision', { p_request: req, p_expected_version: 1, p_validated: true, p_meeting_date: today(), p_comment: null }), 'não está submetido');
    await rpc(w.users.P1, 'submit_trail_request', { p_request: req });
    await expectError(rpc(w.users.P1, 'save_request_draft', { p_request: req, p_reflection: 'mudança', p_experiences: '', p_period_start: null, p_period_end: null, p_approximate_date: null }), 'retira-o ou cria uma nova versão');
    const notes = await asUser(w.users.GuiaA, `select kind from public.notifications where kind = 'pedido_submetido'`);
    expect(notes.length).toBeGreaterThan(0);
  });

  it('retirar volta a rascunho com nova versão e mantém a anterior', async () => {
    await rpc(w.users.P1, 'withdraw_trail_request', { p_request: req });
    const v = await asUser(w.users.P1, `select version_no, submitted_at is not null s, withdrawn_at is not null w from public.trail_request_versions where request_id = $1 order by version_no`, [req]);
    expect(v).toEqual([{ version_no: 1, s: true, w: true }, { version_no: 2, s: false, w: false }]);
    await rpc(w.users.P1, 'save_request_draft', { p_request: req, p_reflection: 'Aprendi a gerir o esforço (revisto).', p_experiences: 'Raid', p_period_start: null, p_period_end: null, p_approximate_date: null });
    await rpc(w.users.P1, 'submit_trail_request', { p_request: req });
  });

  it('só o guia atual da equipa (ou dirigente) regista a decisão; outros não', async () => {
    await expectError(rpc(w.users.GuiaB, 'record_team_decision', { p_request: req, p_expected_version: 2, p_validated: true, p_meeting_date: today(), p_comment: null }), 'Sem permissão');
    await expectError(rpc(w.users.P2, 'record_team_decision', { p_request: req, p_expected_version: 2, p_validated: true, p_meeting_date: today(), p_comment: null }), 'Sem permissão');
    await expectError(rpc(w.users.P1, 'record_team_decision', { p_request: req, p_expected_version: 2, p_validated: true, p_meeting_date: today(), p_comment: null }), 'Sem permissão');
    await expectError(rpc(w.users.GuiaA, 'record_team_decision', { p_request: req, p_expected_version: 1, p_validated: true, p_meeting_date: today(), p_comment: null }), 'mudou entretanto');
  });

  it('devolução exige comentário, mantém histórico e permite nova versão', async () => {
    await rpc(w.users.GuiaA, 'mark_request_in_review', { p_request: req });
    await expectError(rpc(w.users.GuiaA, 'record_team_decision', { p_request: req, p_expected_version: 2, p_validated: false, p_meeting_date: today(), p_comment: ' ' }), 'Explica');
    await rpc(w.users.GuiaA, 'record_team_decision', { p_request: req, p_expected_version: 2, p_validated: false, p_meeting_date: today(), p_comment: 'Falta mostrar regularidade.' });
    await expectError(rpc(w.users.GuiaA, 'record_team_decision', { p_request: req, p_expected_version: 2, p_validated: true, p_meeting_date: today(), p_comment: null }), 'já foi decidido');
    expect((await asUser(w.users.P1, `select status from public.trail_requests where id = $1`, [req]))[0].status).toBe('devolvido');
    await rpc(w.users.P1, 'start_new_version', { p_request: req });
    await rpc(w.users.P1, 'save_request_draft', { p_request: req, p_reflection: 'Treinei todas as semanas.', p_experiences: 'Plano de treino', p_period_start: null, p_period_end: null, p_approximate_date: null });
    await rpc(w.users.P1, 'submit_trail_request', { p_request: req });
    await rpc(w.users.GuiaA, 'record_team_decision', { p_request: req, p_expected_version: 3, p_validated: true, p_meeting_date: today(), p_comment: 'Validado na reunião.' });
    const d = await asUser(w.users.P1, `select kind, recorded_as, comment from public.trail_decisions where request_id = $1 order by recorded_at`, [req]);
    expect(d.map((x) => x.kind)).toEqual(['em_revisao', 'devolvido_equipa', 'validado_equipa']);
    expect(d.every((x) => x.recorded_as === 'guia')).toBe(true);
    // Validação na equipa é comunicada ao Conselho de Guias
    expect((await asUser(w.users.Rui, `select 1 from public.notifications where kind = 'comunicacao_conselho'`)).length).toBeGreaterThan(0);
  });

  it('nota de revisão da Equipa de Animação não altera o estado', async () => {
    await rpc(w.users.Rui, 'record_animation_review', { p_request: req, p_comment: 'Revisto, de acordo.' });
    expect((await asUser(w.users.P1, `select status from public.trail_requests where id = $1`, [req]))[0].status).toBe('validado_equipa');
  });

  it('o guia não regista decisão sobre o próprio pedido; um dirigente pode (regra L1)', async () => {
    await rpc(w.users.Ana, 'record_adhesion', { p_membership: w.members.GuiaA, p_decided_on: today(), p_commitment_on: today(), p_notes: null, p_is_historical: false });
    const own = await rpc<string>(w.users.GuiaA, 'create_trail_request', { p_membership: w.members.GuiaA, p_trail: byArea.S[2].id, p_kind: 'normal' });
    await rpc(w.users.GuiaA, 'save_request_draft', { p_request: own, p_reflection: 'Cargo de guia', p_experiences: '', p_period_start: null, p_period_end: null, p_approximate_date: null });
    await rpc(w.users.GuiaA, 'submit_trail_request', { p_request: own });
    await expectError(rpc(w.users.GuiaA, 'record_team_decision', { p_request: own, p_expected_version: 1, p_validated: true, p_meeting_date: today(), p_comment: null }), 'próprio pedido');
    await expectError(rpc(w.users.GuiaA, 'mark_request_in_review', { p_request: own }), 'Sem permissão');
    await rpc(w.users.Ana, 'record_team_decision', { p_request: own, p_expected_version: 1, p_validated: true, p_meeting_date: today(), p_comment: 'Registado pela Equipa de Animação em nome da reunião de Equipa.' });
    const d = await asUser(w.users.GuiaA, `select recorded_as from public.trail_decisions where request_id = $1 and kind = 'validado_equipa'`, [own]);
    expect(d[0].recorded_as).toBe('dirigente');
  });
});

describe('validação da etapa', () => {
  it('não se pede validação da etapa só pela contagem: os trilhos têm de estar validados', async () => {
    await expectError(rpc(w.users.P1, 'request_stage_validation', { p_stage_path: path1 }), 'Faltam trilhos');
    for (const code of ['A', 'C', 'E', 'I', 'S']) await validateTrail(w, 'P1', byArea[code][0].id);
  });

  it('devolução fundamentada pelo Conselho de Guias reabre um trilho', async () => {
    const r = (await admin(`select id from public.trail_requests where membership_id = $1 and trail_key = $2`, [w.members.P1, byArea.S[0].key]))[0].id;
    await expectError(rpc(w.users.GuiaA, 'record_council_return', { p_request: r, p_meeting_date: today(), p_comment: 'x' }), 'dirigentes');
    await expectError(rpc(w.users.Ana, 'record_council_return', { p_request: r, p_meeting_date: today(), p_comment: '' }), 'fundamentada');
    await rpc(w.users.Ana, 'record_council_return', { p_request: r, p_meeting_date: today(), p_comment: 'Atitude ainda incoerente com o trilho.' });
    await expectError(rpc(w.users.P1, 'request_stage_validation', { p_stage_path: path1 }), 'Faltam trilhos');
    await rpc(w.users.P1, 'start_new_version', { p_request: r });
    await rpc(w.users.P1, 'save_request_draft', { p_request: r, p_reflection: 'Trabalhei a atitude.', p_experiences: '', p_period_start: null, p_period_end: null, p_approximate_date: null });
    await rpc(w.users.P1, 'submit_trail_request', { p_request: r });
    const v = (await admin(`select current_version from public.trail_requests where id = $1`, [r]))[0].current_version;
    await rpc(w.users.GuiaA, 'record_team_decision', { p_request: r, p_expected_version: v, p_validated: true, p_meeting_date: today(), p_comment: null });
  });

  let sr: string;
  it('pedido separado, decisão do Conselho de Guias e opinião final', async () => {
    sr = await rpc(w.users.GuiaA, 'request_stage_validation', { p_stage_path: path1 });
    await expectError(rpc(w.users.P1, 'request_stage_validation', { p_stage_path: path1 }), 'Já existe um pedido');
    // Escolhas bloqueadas durante a validação
    await expectError(rpc(w.users.P1, 'propose_choice', { p_stage_path: path1, p_trail: byArea.A[2].id, p_planned: null, p_replaces: null }), 'em validação');
    await expectError(rpc(w.users.Ana, 'record_final_opinion', { p_stage_request: sr, p_opinion: 'confirmada', p_date: today(), p_comment: null }), 'Regista primeiro a decisão do Conselho');
    await expectError(rpc(w.users.GuiaA, 'record_council_stage_decision', { p_stage_request: sr, p_decision: 'favoravel', p_date: today(), p_comment: null }), 'dirigentes');
    await rpc(w.users.Ana, 'record_council_stage_decision', { p_stage_request: sr, p_decision: 'desfavoravel', p_date: today(), p_comment: 'O Conselho entende que falta consolidar.' });
    // Divergência exige fundamentação
    await expectError(rpc(w.users.Rui, 'record_final_opinion', { p_stage_request: sr, p_opinion: 'confirmada', p_date: today(), p_comment: '' }), 'diverge');
    expect((await asUser(w.users.P1, `select status from public.stage_paths where id = $1`, [path1]))[0].status).toBe('em_curso');
    await rpc(w.users.Rui, 'record_final_opinion', { p_stage_request: sr, p_opinion: 'confirmada', p_date: today(), p_comment: 'A Equipa de Animação observou progresso consistente; explicado ao Conselho.' });
    const p = await asUser(w.users.P1, `select status, completion_kind, completed_on is not null done from public.stage_paths where id = $1`, [path1]);
    expect(p[0]).toEqual({ status: 'concluida', completion_kind: 'normal', done: true });
  });

  it('trilhos de etapa concluída não podem ser devolvidos; reconhecimento é separado', async () => {
    const r = (await admin(`select id from public.trail_requests where membership_id = $1 and trail_key = $2`, [w.members.P1, byArea.A[0].key]))[0].id;
    await expectError(rpc(w.users.Ana, 'record_council_return', { p_request: r, p_meeting_date: today(), p_comment: 'x' }), 'etapa já concluída');
    expect((await asUser(w.users.P1, `select recognized_on from public.stage_paths where id = $1`, [path1]))[0].recognized_on).toBeNull();
    await rpc(w.users.Ana, 'record_recognition', { p_stage_path: path1, p_date: today(), p_note: 'Fogo de Conselho' });
  });

  it('o mesmo trilho não pode ser atribuído a outra etapa', async () => {
    const path2 = await rpc<string>(w.users.Ana, 'open_stage', { p_membership: w.members.P1, p_stage_key: 'vontade', p_insignia_on: today() });
    await expectError(rpc(w.users.P1, 'propose_choice', { p_stage_path: path2, p_trail: byArea.F[0].id, p_planned: null, p_replaces: null }), 'outra etapa');
  });
});

describe('anilha de mérito', () => {
  it('elegibilidade calculada separada da atribuição; não se atribui sem critérios', async () => {
    const e = await rpc(w.users.P1, 'merit_eligibility', { p_membership: w.members.P1 });
    expect(e).toMatchObject({ eligible: false, total: 18, last_stage_concluded: false });
    expect(e.validated).toBe(6);
    await expectError(rpc(w.users.P2, 'merit_eligibility', { p_membership: w.members.P1 }), 'Sem permissão');
    await expectError(rpc(w.users.Ana, 'award_merit', { p_membership: w.members.P1, p_awarded_on: today(), p_historical: false, p_comment: null }), 'critérios');
  });

  it('percurso completo até à Construção torna o membro elegível', async () => {
    const path2 = (await admin(`select id from public.stage_paths where membership_id = $1 and stage_key = 'vontade'`, [w.members.P1]))[0].id;
    const chosen2 = await confirmAllAreas(w, 'P1', path2, 1);
    for (const t of chosen2) await validateTrail(w, 'P1', t.id);
    let sr = await rpc<string>(w.users.P1, 'request_stage_validation', { p_stage_path: path2 });
    await rpc(w.users.Ana, 'record_council_stage_decision', { p_stage_request: sr, p_decision: 'favoravel', p_date: today(), p_comment: null });
    await rpc(w.users.Ana, 'record_final_opinion', { p_stage_request: sr, p_opinion: 'confirmada', p_date: today(), p_comment: null });

    const path3 = await rpc<string>(w.users.Ana, 'open_stage', { p_membership: w.members.P1, p_stage_key: 'construcao', p_insignia_on: today() });
    const chosen3 = await confirmAllAreas(w, 'P1', path3, 2);
    for (const t of chosen3) await validateTrail(w, 'P1', t.id);
    sr = await rpc(w.users.P1, 'request_stage_validation', { p_stage_path: path3 });
    expect((await rpc(w.users.Ana, 'merit_eligibility', { p_membership: w.members.P1 })).eligible).toBe(false); // última etapa ainda não confirmada
    await rpc(w.users.Ana, 'record_council_stage_decision', { p_stage_request: sr, p_decision: 'favoravel', p_date: today(), p_comment: null });
    await rpc(w.users.Ana, 'record_final_opinion', { p_stage_request: sr, p_opinion: 'confirmada', p_date: today(), p_comment: null });
    const e = await rpc(w.users.Ana, 'merit_eligibility', { p_membership: w.members.P1 });
    expect(e).toMatchObject({ eligible: true, validated: 18, total: 18, last_stage_concluded: true });
    // Elegível não significa atribuída
    expect(await asUser(w.users.P1, `select * from public.merit_awards where membership_id = $1`, [w.members.P1])).toHaveLength(0);
    await rpc(w.users.Ana, 'award_merit', { p_membership: w.members.P1, p_awarded_on: today(), p_historical: false, p_comment: null });
    await expectError(rpc(w.users.Ana, 'award_merit', { p_membership: w.members.P1, p_awarded_on: today(), p_historical: false, p_comment: null }), 'já foi registada');
    const a = await asUser(w.users.P1, `select kind, awarded_on is not null d from public.merit_awards where membership_id = $1`, [w.members.P1]);
    expect(a[0]).toEqual({ kind: 'normal', d: true });
  });

  it('mérito anterior exige declaração fundamentada', async () => {
    await expectError(rpc(w.users.Ana, 'award_merit', { p_membership: w.members.P3, p_awarded_on: today(), p_historical: true, p_comment: '' }), 'fundamentação');
    await rpc(w.users.Ana, 'award_merit', { p_membership: w.members.P3, p_awarded_on: '2025-06-01', p_historical: true, p_comment: 'Anilha recebida em 2025, registo em papel.' });
    expect((await asUser(w.users.Ana, `select kind from public.merit_awards where membership_id = $1`, [w.members.P3]))[0].kind).toBe('historico');
  });
});

describe('exportação', () => {
  it('dirigente exporta os dados pedagógicos da secção', async () => {
    const out = await rpc(w.users.Ana, 'export_section', { p_section: w.section });
    expect(out.trail_requests.length).toBeGreaterThan(15);
    expect(out.members.length).toBeGreaterThan(5);
    await expectError(rpc(w.users.Tecnico, 'export_section', { p_section: w.section }), 'dirigentes');
  });
});
