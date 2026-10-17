// Fecho por trilho: o pedido abrange o trilho e todos os seus objetivos, com
// uma justificação conjunta; a reunião de Equipa valida o trilho ou devolve-o
// para revisão. Os dados por objetivo do modelo anterior ficam como histórico.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, buildWorld, expectError, pool, rpc, today, type World } from './helpers';

let w: World;
let autoconhecimento: string; // F2, F3
let desempenho: string; // F1

const trail = async (key: string) => (await admin(`select id from public.catalog_trails where key = $1`, [key]))[0].id as string;
const codes = async (key: string) =>
  (await admin(`select o.code from public.catalog_objectives o join public.catalog_trails t on t.id = o.trail_id where t.key = $1 order by o.position`, [key])).map((r) => r.code);
const status = async (req: string) => (await admin(`select status::text from public.trail_requests where id = $1`, [req]))[0].status as string;
const validatedKeys = async (who: string) => (await admin(`select private.validated_trail_keys($1) k`, [w.members[who]])).map((r) => r.k);
const newRequest = (who: string, t = autoconhecimento) => rpc<string>(w.users[who], 'create_trail_request', { p_membership: w.members[who], p_trail: t, p_kind: 'normal' });
const send = (who: string, req: string, text = 'No raid ajudei a equipa a adaptar o percurso e aprendi a aceitar os meus limites e os dos outros.', version = 1) =>
  rpc(w.users[who], 'submit_trail_validation', { p_request: req, p_expected_version: version, p_justification: text });
const decide = (who: string, req: string, validated: boolean, comment: string | null = null, version = 1, objectiveCodes: string[] | null = null) =>
  rpc(w.users[who], 'record_team_decision', { p_request: req, p_expected_version: version, p_validated: validated, p_meeting_date: today(), p_comment: comment, p_objective_codes: objectiveCodes });

beforeAll(async () => {
  w = await buildWorld('trilhos');
  autoconhecimento = await trail('fisico-autoconhecimento');
  desempenho = await trail('fisico-desempenho');
});
afterAll(() => pool.end());

describe('objetivos do trilho', () => {
  it('Desempenho tem F1; Autoconhecimento tem F2 e F3; Bem-estar físico tem F4', async () => {
    expect(await codes('fisico-desempenho')).toEqual(['F1']);
    expect(await codes('fisico-autoconhecimento')).toEqual(['F2', 'F3']);
    expect(await codes('fisico-bem-estar-fisico')).toEqual(['F4']);
  });
});

describe('pedido do trilho', () => {
  it('exige justificação; não exige etapa, escolha, vivências nem fase intermédia; enviar não fecha o trilho', async () => {
    const req = await newRequest('P1');
    await expectError(send('P1', req, '   '), 'Explica como demonstraste');
    await expectError(send('P2', req), 'não encontrado');
    await expectError(send('P1', req, 'x', 2), 'mudou entretanto');
    await send('P1', req);
    expect(await status(req)).toBe('submetido');
    const v = await asUser(w.users.P1, `select evidence from public.trail_request_versions where request_id = $1`, [req]);
    expect(v[0].evidence).toContain('raid');
    // Sem escolha de objetivos: nenhuma linha por objetivo
    expect(await admin(`select * from public.request_objectives where request_id = $1`, [req])).toHaveLength(0);
    // Não reenvia nem cria pedido duplicado para o mesmo trilho
    await expectError(send('P1', req), 'já foi enviado');
    await expectError(newRequest('P1'), 'Já existe um pedido ativo');
    expect(await validatedKeys('P1')).toEqual([]);
  });

  it('o envio por objetivos deixou de existir', async () => {
    const req = await newRequest('P2', desempenho);
    const f1 = (await admin(`select id from public.catalog_objectives where trail_id = $1`, [desempenho]))[0].id;
    await expectError(rpc(w.users.P2, 'submit_objectives_request', { p_request: req, p_expected_version: 1, p_objectives: [f1], p_justification: 'x' }), 'trilho completo');
    await rpc(w.users.P2, 'cancel_trail_request', { p_request: req });
  });
});

describe('decisão sobre o trilho completo', () => {
  it('ninguém decide o próprio pedido; guia de outra equipa também não', async () => {
    const req = (await admin(`select id from public.trail_requests where membership_id = $1 and status = 'submetido'`, [w.members.P1]))[0].id;
    await expectError(decide('P1', req, true), 'Sem permissão');
    await expectError(decide('GuiaB', req, true), 'Sem permissão');
    await expectError(rpc(w.users.GuiaA, 'record_objectives_decision', { p_request: req, p_expected_version: 1, p_meeting_date: today(), p_decisions: '[]', p_comment: null }), 'trilho completo');
  });

  it('o guia não decide o próprio pedido; um dirigente regista-o e o guia é avisado', async () => {
    // Guia da equipa A faz um pedido
    const req = await newRequest('GuiaA', desempenho);
    await send('GuiaA', req, 'Organizei os treinos da equipa para o raid.');
    await expectError(decide('GuiaA', req, true), 'Sem permissão');
    await decide('Rui', req, true);
    expect(await status(req)).toBe('validado_equipa');
    const d = await admin(`select recorded_as from public.trail_decisions where request_id = $1`, [req]);
    expect(d[0].recorded_as).toBe('dirigente');
  });

  it('dirigente que regista a decisão de um pioneiro avisa o guia da equipa', async () => {
    const req = await newRequest('P2', desempenho);
    await send('P2', req, 'Treinei duas vezes por semana.');
    await decide('Ana', req, true);
    const n = await asUser(w.users.GuiaA, `select title, link from public.notifications where kind = 'registo_animacao'`);
    expect(n).toEqual([{ title: 'Decisão registada pela Equipa de Animação', link: `/revisoes/pedido/${req}` }]);
  });

  it('devolver exige fundamentação e pode indicar objetivos do trilho por demonstrar; corrigir e reenviar mantém o histórico', async () => {
    const req = (await admin(`select id from public.trail_requests where membership_id = $1 and status = 'submetido'`, [w.members.P1]))[0].id;
    await expectError(decide('GuiaA', req, false, '  '), 'Explica o que falta');
    await expectError(decide('GuiaA', req, false, 'Falta.', 1, ['F1']), 'não pertencem');
    await expectError(decide('GuiaA', req, true, null, 1, ['F3']), 'Só uma devolução');
    await decide('GuiaA', req, false, 'Falta um exemplo sobre o respeito pelas necessidades de cada um.', 1, ['F3', 'F3']);
    expect(await status(req)).toBe('devolvido');
    expect(await validatedKeys('P1')).toEqual([]);
    const dec = await asUser(w.users.P1, `select kind::text, objective_codes from public.trail_decisions where request_id = $1`, [req]);
    expect(dec).toEqual([{ kind: 'devolvido_equipa', objective_codes: ['F3'] }]);
    const note = await asUser(w.users.P1, `select title, body from public.notifications where kind = 'decisao_equipa'`);
    expect(note[0].title).toBe('Trilho a rever');
    expect(note[0].body).toContain('por demonstrar: F3');

    await rpc(w.users.P1, 'start_new_version', { p_request: req });
    const v2 = await asUser(w.users.P1, `select evidence from public.trail_request_versions where request_id = $1 and version_no = 2`, [req]);
    expect(v2[0].evidence).toContain('raid'); // a justificação anterior é preservada para corrigir
    await expectError(send('P1', req, 'Corrigido', 1), 'mudou entretanto');
    await send('P1', req, 'No raid ajudei um colega com uma lesão e falámos do que cada um precisava.', 2);
    await decide('GuiaA', req, true, 'Validado em reunião.', 2);
    expect(await status(req)).toBe('validado_guias');
    await rpc(w.users.Rui, 'confirm_trail_validation', { p_request: req, p_comment: null });
    expect(await status(req)).toBe('validado_equipa');
    expect(await validatedKeys('P1')).toEqual(['fisico-autoconhecimento']);
    const hist = await asUser(w.users.P1, `select v.version_no, d.kind::text from public.trail_decisions d join public.trail_request_versions v on v.id = d.version_id where d.request_id = $1 order by v.version_no, d.recorded_at`, [req]);
    expect(hist).toEqual([{ version_no: 1, kind: 'devolvido_equipa' }, { version_no: 2, kind: 'validado_guias' }, { version_no: 2, kind: 'validado_equipa' }]);
  });

  it('duas decisões em simultâneo sobre o mesmo pedido: só uma fica registada', async () => {
    const t = await trail('fisico-bem-estar-fisico');
    const req = await newRequest('P2', t);
    await send('P2', req, 'Mudei a alimentação nos acampamentos.');
    const results = await Promise.allSettled([decide('GuiaA', req, true), decide('Ana', req, false, 'Falta')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const n = await admin(`select count(*)::int n from public.trail_decisions where request_id = $1`, [req]);
    expect(n[0].n).toBe(1);
  });

  it('dois pedidos em simultâneo para o mesmo trilho: só um fica ativo', async () => {
    const t = await trail('social-solidariedade-e-tolerancia');
    const results = await Promise.allSettled([newRequest('P3', t), newRequest('P3', t)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('dados por objetivo do modelo anterior', () => {
  // Simula o que ficou guardado com o modelo anterior (as funções já não o criam).
  async function legacy(who: string, key: string, reqStatus: string, rows: [string, string | null][]) {
    const t = await trail(key);
    const r = (await admin(
      `insert into public.trail_requests (membership_id, section_id, trail_id, trail_key, kind, status, created_by)
       values ($1, $2, $3, $4, 'normal', $5, $6) returning id`, [w.members[who], w.section, t, key, reqStatus, w.users[who]]))[0].id;
    const v = (await admin(`insert into public.trail_request_versions (request_id, version_no, evidence, submitted_at) values ($1, 1, 'Texto antigo', now()) returning id`, [r]))[0].id;
    for (const [code, decision] of rows) {
      await admin(
        `insert into public.request_objectives (request_id, version_id, objective_id, objective_code, decision, decided_at)
         select $1, $2, o.id, o.code, $4, case when $4::text is null then null else now() end from public.catalog_objectives o where o.trail_id = $3 and o.code = $5`,
        [r, v, t, decision, code]);
    }
    return r;
  }

  it('objetivos aceites ficam como histórico e não fecham o trilho; o trilho completo pode ser pedido', async () => {
    const old = await legacy('P3', 'fisico-autoconhecimento', 'objetivos_validados', [['F2', 'aceite']]);
    expect(await validatedKeys('P3')).toEqual([]);
    const req = await newRequest('P3');
    await send('P3', req, 'Agora falo dos dois objetivos.');
    await decide('GuiaB', req, true);
    expect(await validatedKeys('P3')).toEqual([]); // falta a confirmação dos dirigentes
    await rpc(w.users.Ana, 'confirm_trail_validation', { p_request: req, p_comment: null });
    expect(await validatedKeys('P3')).toEqual(['fisico-autoconhecimento']);
    expect(await status(old)).toBe('objetivos_validados');
    const rows = await asUser(w.users.P3, `select objective_code, decision from public.request_objectives where request_id = $1`, [old]);
    expect(rows).toEqual([{ objective_code: 'F2', decision: 'aceite' }]);
  });

  it('um pedido antigo «A rever» reenvia-se como trilho completo; as decisões antigas ficam na versão 1', async () => {
    const old = await legacy('P3', 'fisico-desempenho', 'devolvido', [['F1', 'rever']]);
    await rpc(w.users.P3, 'start_new_version', { p_request: old });
    expect(await admin(`select * from public.request_objectives ro join public.trail_request_versions v on v.id = ro.version_id where ro.request_id = $1 and v.version_no = 2`, [old])).toHaveLength(0);
    await send('P3', old, 'Corrigi o plano de treino.', 2);
    expect(await status(old)).toBe('submetido');
    const rows = await admin(`select objective_code, decision from public.request_objectives where request_id = $1`, [old]);
    expect(rows).toEqual([{ objective_code: 'F1', decision: 'rever' }]);
  });

  it('um pedido antigo parcial ainda pendente é decidido sobre o trilho completo; cancelar não apaga histórico', async () => {
    const old = await legacy('P2', 'afetivo-autoestima', 'submetido', [['A5', null]]);
    await decide('GuiaA', old, false, 'Fala também do A6.', 1, ['A6']);
    expect(await status(old)).toBe('devolvido');
    await rpc(w.users.P2, 'cancel_trail_request', { p_request: old });
    expect(await status(old)).toBe('cancelado');
    expect(await admin(`select * from public.request_objectives where request_id = $1`, [old])).toHaveLength(1);
  });

  it('a devolução do Conselho de Guias não reescreve decisões por objetivo antigas', async () => {
    const old = await legacy('P2', 'carater-coerencia', 'validado_equipa', [['C6', 'aceite'], ['C7', 'aceite']]);
    await rpc(w.users.Ana, 'record_council_return', { p_request: old, p_meeting_date: today(), p_comment: 'Incoerente com a atitude.' });
    expect(await status(old)).toBe('devolvido');
    const rows = await admin(`select decision from public.request_objectives where request_id = $1`, [old]);
    expect(rows.map((r) => r.decision)).toEqual(['aceite', 'aceite']);
  });
});

describe('contadores do Acompanhamento', () => {
  const counts = () => rpc<Record<string, number>>(w.users.Ana, 'my_pending_counts', { p_section: w.section });
  it('cada pendente conta uma vez, no seu tipo, e o total é a soma', async () => {
    const c = await counts();
    const pend = await admin(`select r.kind::text, count(*)::int n from public.trail_requests r join public.memberships m on m.id = r.membership_id
      where r.section_id = $1 and m.status = 'ativo' and m.function in ('pioneiro', 'guia') and r.status::text in ('submetido', 'em_revisao', 'validado_guias') group by r.kind`, [w.section]);
    const normal = pend.find((r) => r.kind === 'normal')?.n ?? 0;
    const hist = pend.find((r) => r.kind === 'historico')?.n ?? 0;
    expect(c.trilhos).toBe(normal);
    expect(c.anterior).toBe(hist);
    expect(c.acompanhamento).toBe(c.negociacao + c.trilhos + c.anterior + c.etapas);
  });

  it('conta os trilhos à espera dos dirigentes e não conta pedidos que a lista não mostra', async () => {
    const before = (await counts()).trilhos;
    const req = await newRequest('P2', await trail('espiritual-descoberta'));
    await send('P2', req, 'Treinei todas as semanas e registei o progresso.');
    expect((await counts()).trilhos).toBe(before + 1);
    await decide('GuiaA', req, true);
    expect((await counts()).trilhos).toBe(before + 1); // validado pelos guias: falta confirmar
    // Quem deixa de ser pioneiro ou guia sai da lista do Acompanhamento e do contador.
    const ofP2 = (await admin(`select count(*)::int n from public.trail_requests where membership_id = $1 and kind = 'normal'
      and status::text in ('submetido', 'em_revisao', 'validado_guias')`, [w.members.P2]))[0].n as number;
    await admin(`update public.memberships set function = 'dirigente', team_id = null where id = $1`, [w.members.P2]);
    expect((await counts()).trilhos).toBe(before + 1 - ofP2);
    await admin(`update public.memberships set function = 'pioneiro', team_id = $2 where id = $1`, [w.members.P2, w.teamA]);
    await rpc(w.users.Rui, 'confirm_trail_validation', { p_request: req, p_comment: 'Confirmado.' });
    expect((await counts()).trilhos).toBe(before);
    const n = await asUser(w.users.P2, `select title, body from public.notifications where kind = 'decisao_equipa' order by created_at desc limit 1`);
    expect(n[0]).toEqual({ title: 'Trilho validado', body: expect.stringContaining('confirmado pelos dirigentes') });
  });

  it('os dirigentes podem devolver um trilho validado pelos guias', async () => {
    const req = await newRequest('P3', await trail('social-interacao-e-cooperacao'));
    await send('P3', req, 'Corri a meia maratona da região.');
    await decide('GuiaB', req, true);
    expect((await asUser(w.users.Rui, `select 1 from public.notifications where kind = 'validacao_guias' and link = $1`, [`/revisoes/pedido/${req}`])).length).toBe(1);
    await rpc(w.users.Rui, 'record_council_return', { p_request: req, p_meeting_date: today(), p_comment: 'Falta falar do treino regular.' });
    expect(await status(req)).toBe('devolvido');
    await expectError(rpc(w.users.Rui, 'confirm_trail_validation', { p_request: req, p_comment: null }), 'confirmação dos dirigentes');
  });
});
