import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, buildWorld, confirmAllAreas, expectError, pool, rpc, today, trailsByArea, validateTrail, type World } from './helpers';

let w: World;
let other: World;
let byArea: Awaited<ReturnType<typeof trailsByArea>>;
const pos = async (m: string) => (await admin(`select private.member_position($1) as p`, [m]))[0].p as { milestone: string; state: string };

beforeAll(async () => {
  w = await buildWorld('caminho');
  other = await buildWorld('caminho-outro');
  byArea = await trailsByArea();
});
afterAll(() => pool.end());

describe('posição no caminho (pp. 3, 4–14)', () => {
  let path: string;

  it('Início de Pista: em adesão e depois com perfil traçado', async () => {
    expect(await pos(w.members.P1)).toEqual({ milestone: 'inicio_pista', state: 'em_adesao' });
    await expectError(rpc(w.users.GuiaA, 'record_profile_traced', { p_membership: w.members.P1, p_date: today() }), 'dirigentes');
    await rpc(w.users.Ana, 'record_profile_traced', { p_membership: w.members.P1, p_date: today() });
    expect(await pos(w.members.P1)).toEqual({ milestone: 'inicio_pista', state: 'perfil_tracado' });
  });

  it('a 1.ª etapa só abre depois da Promessa/Investidura (p. 10)', async () => {
    await rpc(w.users.Ana, 'record_adhesion', { p_membership: w.members.P1, p_decided_on: today(), p_commitment_on: null, p_notes: null, p_is_historical: false });
    expect(await pos(w.members.P1)).toEqual({ milestone: 'promessa', state: 'aguarda_promessa' });
    const prof = await admin(`select profile_traced_on is not null as t from public.adhesions where membership_id = $1`, [w.members.P1]);
    expect(prof[0].t).toBe(true); // registar a adesão não apaga o traçado do perfil
    await expectError(rpc(w.users.Ana, 'open_stage', { p_membership: w.members.P1, p_stage_key: 'conhecimento', p_insignia_on: today() }), 'Promessa/Investidura');
    await rpc(w.users.Ana, 'record_adhesion', { p_membership: w.members.P1, p_decided_on: today(), p_commitment_on: today(), p_notes: null, p_is_historical: false });
    expect(await pos(w.members.P1)).toEqual({ milestone: 'promessa', state: 'aguarda_etapa' });
    path = await rpc(w.users.Ana, 'open_stage', { p_membership: w.members.P1, p_stage_key: 'conhecimento', p_insignia_on: today() });
    expect(await pos(w.members.P1)).toEqual({ milestone: 'conhecimento', state: 'em_curso' });
  });

  it('seis trilhos validados quaisquer não cumprem os requisitos da etapa', async () => {
    // Valida 6 trilhos de UMA só área/fora da etapa: não chega.
    for (const t of [byArea.F[0], byArea.F[1], byArea.F[2], byArea.A[0], byArea.A[1], byArea.A[2]]) await validateTrail(w, 'P1', t.id);
    expect(await pos(w.members.P1)).toEqual({ milestone: 'conhecimento', state: 'em_curso' });
  });

  it('requisitos cumpridos → em validação → concluída → reconhecida', async () => {
    const byAreaKeys = await confirmAllAreas(w, 'P1', path, 0);
    for (const t of byAreaKeys.slice(2)) await validateTrail(w, 'P1', t.id); // F e A já validados
    expect(await pos(w.members.P1)).toEqual({ milestone: 'conhecimento', state: 'requisitos_cumpridos' });
    const sr = await rpc<string>(w.users.P1, 'request_stage_validation', { p_stage_path: path });
    expect(await pos(w.members.P1)).toEqual({ milestone: 'conhecimento', state: 'em_validacao' });
    await rpc(w.users.Ana, 'record_council_stage_decision', { p_stage_request: sr, p_decision: 'favoravel', p_date: today(), p_comment: null });
    expect((await pos(w.members.P1)).state).toBe('em_validacao'); // ainda falta a opinião final
    await rpc(w.users.Ana, 'record_final_opinion', { p_stage_request: sr, p_opinion: 'confirmada', p_date: today(), p_comment: null });
    expect(await pos(w.members.P1)).toEqual({ milestone: 'conhecimento', state: 'concluida' });
    await rpc(w.users.Ana, 'record_recognition', { p_stage_path: path, p_date: today(), p_note: null });
    expect(await pos(w.members.P1)).toEqual({ milestone: 'conhecimento', state: 'reconhecida' });
    await rpc(w.users.Ana, 'open_stage', { p_membership: w.members.P1, p_stage_key: 'vontade', p_insignia_on: today() });
    expect(await pos(w.members.P1)).toEqual({ milestone: 'vontade', state: 'em_curso' });
  });
});

describe('compatibilidade com dados existentes', () => {
  it('etapa aberta pela regra antiga (sem Promessa registada) mantém o pioneiro na etapa', async () => {
    await admin(`insert into public.adhesions (membership_id, decided_on, recorded_by) values ($1, current_date, $2)`, [w.members.P3, w.users.Ana]);
    await admin(`insert into public.stage_paths (membership_id, stage_id, stage_key, stage_ordinal, opened_by)
      select $1, cs.id, 'conhecimento', 1, $2 from public.catalog_stages cs where cs.key = 'conhecimento'`, [w.members.P3, w.users.Ana]);
    expect(await pos(w.members.P3)).toEqual({ milestone: 'conhecimento', state: 'em_curso' });
  });
});

describe('reconhecimento na negociação (p. 10)', () => {
  it('exige dirigente e fundamentação; conta como validado; informa a Equipa', async () => {
    await expectError(rpc(w.users.GuiaA, 'recognize_in_negotiation', { p_membership: w.members.P2, p_trail: byArea.S[0].id, p_comment: 'x', p_reference_date: null }), 'dirigentes');
    await expectError(rpc(w.users.Ana, 'recognize_in_negotiation', { p_membership: w.members.P2, p_trail: byArea.S[0].id, p_comment: ' ', p_reference_date: null }), 'Fundamenta');
    // Não depende da opção «progresso anterior»
    await rpc(w.users.Tecnico, 'set_historical_progress', { p_section: w.section, p_enabled: false });
    const r = await rpc<string>(w.users.Ana, 'recognize_in_negotiation', { p_membership: w.members.P2, p_trail: byArea.S[0].id, p_comment: 'Delegado de turma há dois anos; observado nas atividades.', p_reference_date: '2026-06-01' });
    await rpc(w.users.Tecnico, 'set_historical_progress', { p_section: w.section, p_enabled: true });
    const row = (await admin(`select kind, status from public.trail_requests where id = $1`, [r]))[0];
    expect(row).toEqual({ kind: 'negociacao', status: 'aprovado' });
    expect((await rpc(w.users.Ana, 'merit_eligibility', { p_membership: w.members.P2 })).validated).toBe(1);
    await expectError(rpc(w.users.Ana, 'recognize_in_negotiation', { p_membership: w.members.P2, p_trail: byArea.S[0].id, p_comment: 'x', p_reference_date: null }), 'Já existe');
    await expectError(rpc(w.users.P2, 'create_trail_request', { p_membership: w.members.P2, p_trail: byArea.S[0].id, p_kind: 'normal' }), 'Já existe');
    expect((await asUser(w.users.GuiaA, `select 1 from public.notifications where kind = 'reconhecido_negociacao'`)).length).toBe(1);
    // A decisão fica no histórico com a fundamentação
    const d = await asUser(w.users.P2, `select kind, comment from public.trail_decisions where request_id = $1`, [r]);
    expect(d[0].kind).toBe('reconhecido_negociacao');
  });
});

describe('caminho da secção e permissões no servidor', () => {
  it('dirigente vê todos com nomes; guia só a sua equipa; pioneiro só a si próprio', async () => {
    const lead = await rpc(w.users.Ana, 'section_path', { p_section: w.section });
    expect(lead.scope).toBe('seccao');
    expect(lead.total).toBe(5); // GuiaA, GuiaB, P1, P2, P3
    expect(lead.members).toHaveLength(5);
    expect(lead.counts.vontade).toBe(1);
    expect(lead.counts.inicio_pista).toBe(3);
    expect(lead.counts.conhecimento).toBe(1);

    const guia = await rpc(w.users.GuiaA, 'section_path', { p_section: w.section });
    expect(guia.members.map((m: any) => m.membership_id).sort()).toEqual([w.members.GuiaA, w.members.P1, w.members.P2].sort());
    expect(guia.total).toBe(5);

    const pio = await rpc(w.users.P3, 'section_path', { p_section: w.section });
    expect(pio.members).toHaveLength(1);
    expect(pio.members[0]).toMatchObject({ membership_id: w.members.P3, is_me: true, milestone: 'conhecimento' });
    expect(pio.counts).toEqual(lead.counts); // contagens agregadas, sem nomes

    // Nada de conteúdo pessoal nesta vista
    const keys = new Set(lead.members.flatMap((m: any) => Object.keys(m)));
    for (const k of ['reflection', 'experiences', 'notes', 'comment', 'storage_path']) expect(keys.has(k)).toBe(false);
  });

  it('administração técnica sem função pedagógica só vê contagens; outro agrupamento não tem acesso', async () => {
    const t = await rpc(w.users.Tecnico, 'section_path', { p_section: w.section });
    expect(t.members).toHaveLength(0);
    expect(t.total).toBe(5);
    await expectError(rpc(other.users.Ana, 'section_path', { p_section: w.section }), 'Sem acesso');
    await expectError(rpc(null, 'section_path', { p_section: w.section }), 'permission denied');
  });

  it('antigo guia deixa de ver os nomes da equipa no caminho', async () => {
    await rpc(w.users.Ana, 'update_membership', { p_membership: w.members.GuiaA, p_function: 'pioneiro', p_team: w.teamA, p_is_admin: false, p_reason: 'Teste' });
    const g = await rpc(w.users.GuiaA, 'section_path', { p_section: w.section });
    expect(g.members.map((m: any) => m.membership_id)).toEqual([w.members.GuiaA]);
    await rpc(w.users.Ana, 'update_membership', { p_membership: w.members.GuiaA, p_function: 'guia', p_team: w.teamA, p_is_admin: false, p_reason: 'Regresso' });
  });

  it('contadores de pendentes por papel', async () => {
    const req = await rpc<string>(w.users.P2, 'create_trail_request', { p_membership: w.members.P2, p_trail: byArea.I[0].id, p_kind: 'normal' });
    expect((await rpc(w.users.P2, 'my_pending_counts', { p_section: w.section })).pedidos).toBe(1); // rascunho
    await rpc(w.users.P2, 'save_request_draft', { p_request: req, p_reflection: 'r', p_experiences: '', p_period_start: null, p_period_end: null, p_approximate_date: null });
    await rpc(w.users.P2, 'submit_trail_request', { p_request: req });
    expect((await rpc(w.users.GuiaA, 'my_pending_counts', { p_section: w.section })).equipa).toBe(1);
    expect((await rpc(w.users.GuiaB, 'my_pending_counts', { p_section: w.section })).equipa).toBe(0);
    const ana = await rpc(w.users.Ana, 'my_pending_counts', { p_section: w.section });
    expect(ana).toHaveProperty('acompanhamento');
    expect(ana).toHaveProperty('gestao');
    expect(await rpc(w.users.P2, 'my_pending_counts', { p_section: w.section })).not.toHaveProperty('gestao');
  });

  it('atividade recente respeita permissões e não inclui comentários', async () => {
    const lead = await rpc<any[]>(w.users.Ana, 'section_activity', { p_section: w.section, p_limit: 50 });
    expect(lead.length).toBeGreaterThan(5);
    expect(lead.some((e) => e.kind === 'reconhecido_negociacao')).toBe(true);
    expect(lead.every((e) => !('comment' in e))).toBe(true);
    const p3 = await rpc<any[]>(w.users.P3, 'section_activity', { p_section: w.section, p_limit: 50 });
    expect(p3.every((e) => e.membership_id === w.members.P3)).toBe(true);
    const g = await rpc<any[]>(w.users.GuiaB, 'section_activity', { p_section: w.section, p_limit: 50 });
    expect(g.some((e) => e.membership_id === w.members.P1)).toBe(false);
  });
});

describe('pedido com contexto e evidência dos objetivos', () => {
  it('guarda os novos campos, copia-os para nova versão e mantém a chamada antiga', async () => {
    const req = await rpc<string>(w.users.P2, 'create_trail_request', { p_membership: w.members.P2, p_trail: byArea.E[1].id, p_kind: 'normal' });
    // chamada antiga (sem os novos campos) continua a funcionar
    await rpc(w.users.P2, 'save_request_draft', { p_request: req, p_reflection: 'Aprendi', p_experiences: 'Fiz', p_period_start: null, p_period_end: null, p_approximate_date: null });
    await rpc(w.users.P2, 'save_request_draft', { p_request: req, p_reflection: 'Aprendi', p_experiences: 'Fiz', p_period_start: null, p_period_end: null, p_approximate_date: null, p_context: 'No acampamento de equipa', p_evidence: 'E4: rezei todos os dias' });
    await rpc(w.users.P2, 'submit_trail_request', { p_request: req });
    await rpc(w.users.P2, 'withdraw_trail_request', { p_request: req });
    const v = await asUser(w.users.P2, `select version_no, context, evidence from public.trail_request_versions where request_id = $1 order by version_no`, [req]);
    expect(v[1]).toEqual({ version_no: 2, context: 'No acampamento de equipa', evidence: 'E4: rezei todos os dias' });
    await expectError(rpc(w.users.P2, 'create_trail_request', { p_membership: w.members.P2, p_trail: byArea.E[1].id, p_kind: 'normal' }), 'Já existe');
  });
});
