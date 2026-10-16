// Reuniões e tarefas (antiga Secretaria; chave interna 'secretaria'): visibilidade por tipo de
// reunião, permissões (redigir/aprovar), fluxo das atas, versões e aditamentos, sumário
// estruturado (pré-preenchido sem inventar, revisto, publicado, versões), quadro de tarefas com
// estados e histórico, «O que me diz respeito» sem conteúdo reservado, integração com o
// Calendário, anexos, migração dos estados v1 e isolamento entre o espaço de teste e o real.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, buildWorld, expectDenied, pool, rpc, setupModule, trailId, type World } from './helpers';

let w: World;
const S = () => w.section;
const NOT_FOUND = 'Registo não encontrado';
const inDays = (d: number) => new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10);

async function meeting(who: string, kind: string, extra: Record<string, unknown> = {}) {
  return rpc<string>(w.users[who], 'sec_meeting_save', {
    p_section: S(), p_meeting: null, p_kind: kind, p_team: null, p_title: `Reunião ${kind}`,
    p_starts_at: new Date().toISOString(), p_location: 'Sede', p_agenda: '1. Ponto único', p_cal_event: null,
    p_participants: [], p_share_profiles: [], p_share_teams: [], ...extra,
  });
}
const seen = async (who: string) => (await rpc<any>(w.users[who], 'sec_meetings', { p_section: S() })).meetings.map((m: any) => m.id);
const minute = (who: string, id: string, version?: number) =>
  rpc<any>(w.users[who], 'sec_minute', { p_section: S(), p_minute: id, p_version: version ?? null });

let mEquipa: string, mConselho: string, mAnimacao: string, mGeral: string;

beforeAll(async () => {
  w = await buildWorld('secretaria');
  // Testers: todos menos P2 (membro sem acesso). GuiaA redige; GuiaB aprova; P1 e P3 só consultam.
  await setupModule(w, 'secretaria', 'teste', ['Ana', 'Rui', 'Tecnico', 'GuiaA', 'GuiaB', 'P1', 'P3'],
    [['secretaria.redigir', 'GuiaA'], ['secretaria.aprovar', 'GuiaB']]);
});
afterAll(() => pool.end());

describe('acesso e permissões', () => {
  it('membro sem acesso (não tester) é recusado em tudo', async () => {
    await expectDenied(rpc(w.users.P2, 'sec_meetings', { p_section: S() }));
    await expectDenied(rpc(w.users.P2, 'sec_people', { p_section: S() }));
    await expectDenied(rpc(w.users.P2, 'sec_my_tasks', { p_section: S() }));
  });

  it('tester só de consulta e administração sem permissão não criam reuniões', async () => {
    await expectDenied(meeting('P1', 'equipa', { p_team: w.teamA }), 'permissão');
    await expectDenied(meeting('Tecnico', 'animacao'), 'permissão'); // administração técnica, tester, sem permissão
    await expectDenied(meeting('Rui', 'animacao'), 'permissão'); // dirigente aprova, mas não redige sem permissão
    await expectDenied(meeting('GuiaB', 'animacao'), 'permissão');
    await expectDenied(rpc(w.users.P1, 'sec_link_options', { p_section: S() }), 'permissão');
  });

  it('administração configura, mas não ganha acesso por ser administração', async () => {
    const ov = await rpc<any[]>(w.users.Ana, 'module_admin_overview', { p_section: S() });
    expect(ov.find((m) => m.module === 'secretaria').grants).toHaveLength(2);
    await expectDenied(rpc(w.users.Rui, 'set_module_grant', { p_section: S(), p_permission: 'secretaria.aprovar', p_profile: w.users.P1, p_on: true }), 'Reservado');
  });

  it('o redator cria reuniões dos quatro tipos, com validação clara', async () => {
    await expectDenied(meeting('GuiaA', 'equipa'), 'Escolhe a equipa');
    await expectDenied(meeting('GuiaA', 'equipa', { p_team: w.teamA, p_title: '  ' }), 'título');
    await expectDenied(meeting('GuiaA', 'conselho_guias', { p_participants: [w.users.P2, '00000000-0000-0000-0000-000000000001'] }), 'membros ativos');
    mEquipa = await meeting('GuiaA', 'equipa', { p_team: w.teamA, p_participants: [w.users.P1, w.users.P2] });
    mConselho = await meeting('GuiaA', 'conselho_guias', { p_participants: [w.users.P3] });
    mAnimacao = await meeting('GuiaA', 'animacao');
    mGeral = await meeting('GuiaA', 'geral', { p_share_profiles: [w.users.P1], p_share_teams: [w.teamB] });
  });
});

describe('visibilidade por tipo', () => {
  it('Reunião de Equipa: essa equipa + dirigentes autorizados', async () => {
    for (const who of ['P1', 'Rui', 'Ana', 'GuiaA', 'GuiaB']) expect(await seen(who)).toContain(mEquipa);
    for (const who of ['P3', 'Tecnico']) {
      expect(await seen(who)).not.toContain(mEquipa);
      await expectDenied(rpc(w.users[who], 'sec_meeting', { p_section: S(), p_meeting: mEquipa }), NOT_FOUND);
    }
  });

  it('Conselho de Guias: participantes + dirigentes autorizados', async () => {
    for (const who of ['P3', 'Rui', 'GuiaA', 'GuiaB']) expect(await seen(who)).toContain(mConselho);
    for (const who of ['P1', 'Tecnico']) expect(await seen(who)).not.toContain(mConselho);
  });

  it('Equipa de Animação: só dirigentes autorizados', async () => {
    for (const who of ['Ana', 'Rui', 'GuiaA', 'GuiaB']) expect(await seen(who)).toContain(mAnimacao);
    for (const who of ['P1', 'P3', 'Tecnico']) expect(await seen(who)).not.toContain(mAnimacao);
  });

  it('Documento geral: só quem o criou e as pessoas/equipas com partilha explícita', async () => {
    for (const who of ['GuiaA', 'P1', 'P3', 'GuiaB']) expect(await seen(who)).toContain(mGeral); // P3 e GuiaB pela equipa B
    for (const who of ['Ana', 'Rui', 'Tecnico']) expect(await seen(who)).not.toContain(mGeral); // nem dirigentes sem partilha
    // Retirar a partilha da equipa B tira o acesso
    await rpc(w.users.GuiaA, 'sec_meeting_save', {
      p_section: S(), p_meeting: mGeral, p_kind: 'geral', p_team: null, p_title: 'Documento geral', p_starts_at: new Date().toISOString(),
      p_location: null, p_agenda: '', p_cal_event: null, p_participants: [], p_share_profiles: [w.users.P1], p_share_teams: [],
    });
    expect(await seen('P3')).not.toContain(mGeral);
    expect(await seen('P1')).toContain(mGeral);
  });

  it('o redator só redige no seu âmbito (o que não vê não existe)', async () => {
    const outro = await rpc<string>(w.users.Ana, 'create_team', { p_section: S(), p_name: 'Equipa C' });
    // GuiaA não pode criar um documento geral que deixaria de ver… (é sempre o criador, por isso vê)
    const g2 = await meeting('GuiaA', 'geral', { p_share_teams: [outro] });
    expect(await seen('GuiaA')).toContain(g2);
    // …e um documento geral de outra pessoa não partilhado com ele é invisível e intocável
    await admin(`update public.sec_meetings set created_by = $1 where id = $2`, [w.users.Ana, g2]);
    await expectDenied(rpc(w.users.GuiaA, 'sec_minute_create', { p_section: S(), p_meeting: g2, p_kind: 'ata', p_body: '' }), NOT_FOUND);
    await expectDenied(rpc(w.users.GuiaA, 'sec_meeting_cancel', { p_section: S(), p_meeting: g2, p_reason: 'x' }), NOT_FOUND);
  });
});

describe('atas: aprovação, versões e aditamentos', () => {
  let ata: string;
  let task: string;
  let request: string;
  let stagePath: string;
  let before: any[];

  it('redator cria a ata; consulta e aprovador não redigem', async () => {
    await expectDenied(rpc(w.users.P1, 'sec_minute_create', { p_section: S(), p_meeting: mEquipa, p_kind: 'ata', p_body: '' }), 'permissão');
    await expectDenied(rpc(w.users.GuiaB, 'sec_minute_create', { p_section: S(), p_meeting: mEquipa, p_kind: 'ata', p_body: '' }), 'permissão');
    ata = await rpc<string>(w.users.GuiaA, 'sec_minute_create', { p_section: S(), p_meeting: mEquipa, p_kind: 'ata', p_body: 'Texto confidencial v1' });
    await expectDenied(rpc(w.users.GuiaA, 'sec_minute_create', { p_section: S(), p_meeting: mEquipa, p_kind: 'ata', p_body: '' }), 'já tem ata');
    await expectDenied(rpc(w.users.GuiaA, 'sec_minute_create', { p_section: S(), p_meeting: mEquipa, p_kind: 'aditamento', p_body: '' }), 'ata aprovada');
    await expectDenied(rpc(w.users.P1, 'sec_minute_save', { p_section: S(), p_minute: ata, p_body: 'x', p_expected_version: 1 }), 'permissão');
    await rpc(w.users.GuiaA, 'sec_minute_save', { p_section: S(), p_minute: ata, p_body: 'Texto confidencial da ata', p_expected_version: 1 });
    const d = await minute('P1', ata);
    expect(d.version.body).toBe('Texto confidencial da ata');
    expect(d).toMatchObject({ can_edit: false, can_approve: false, test: true });
    expect((await minute('GuiaA', ata)).can_edit).toBe(true);
    await expectDenied(minute('P3', ata), NOT_FOUND);
  });

  it('decisão ligada a um pedido e tarefa com responsável, sem validar progresso', async () => {
    request = await rpc<string>(w.users.P1, 'create_trail_request', { p_membership: w.members.P1, p_trail: await trailId((await admin(`select key from public.catalog_trails order by position limit 1`))[0].key), p_kind: 'normal' });
    const st = (await admin(`select id, key, ordinal from public.catalog_stages where kind = 'progresso' order by ordinal limit 1`))[0];
    stagePath = (await admin(`insert into public.stage_paths (membership_id, stage_id, stage_key, stage_ordinal, opened_by) values ($1, $2, $3, $4, $5) returning id`,
      [w.members.P3, st.id, st.key, st.ordinal, w.users.Ana]))[0].id;
    const snap = () => admin(`select to_jsonb(r) as r from public.trail_requests r where membership_id = $1 union all select to_jsonb(p) from public.stage_paths p where membership_id in ($1, $2) union all select to_jsonb(d) from public.trail_decisions d join public.trail_requests r on r.id = d.request_id where r.membership_id = $1`,
      [w.members.P1, w.members.P3]);
    before = await snap();

    const opts = await rpc<any>(w.users.GuiaA, 'sec_link_options', { p_section: S() });
    expect(opts.requests.map((r: any) => r.id)).toContain(request);
    expect(opts.stages.map((r: any) => r.id)).toContain(stagePath);

    const dec = await rpc<string>(w.users.GuiaA, 'sec_item_save', {
      p_section: S(), p_item: null, p_minute: ata, p_kind: 'decisao', p_text: 'Pedido analisado em reunião', p_responsible: null, p_due: null,
      p_reminder_days: 2, p_request: request, p_stage_path: null,
    });
    await rpc(w.users.GuiaA, 'sec_item_save', {
      p_section: S(), p_item: null, p_minute: ata, p_kind: 'decisao', p_text: 'Etapa discutida', p_responsible: null, p_due: null,
      p_reminder_days: 2, p_request: null, p_stage_path: stagePath,
    });
    // Tarefa sem responsável nem prazo na ata: aceite, fica «por definir» (nada é inventado)
    const undefinedTask = await rpc<string>(w.users.GuiaA, 'sec_item_save', {
      p_section: S(), p_item: null, p_minute: ata, p_kind: 'tarefa', p_text: 'Sem responsável', p_responsible: null, p_due: null,
      p_reminder_days: 2, p_request: null, p_stage_path: null,
    });
    expect(await admin(`select responsible_id, due_date, exec_status from public.sec_items where id = $1`, [undefinedTask]))
      .toEqual([{ responsible_id: null, due_date: null, exec_status: 'por_fazer' }]);
    expect(await admin(`select count(*)::int as n from public.module_reminders where entity_id = $1`, [undefinedTask])).toEqual([{ n: 0 }]);
    await expectDenied(rpc(w.users.GuiaA, 'sec_item_save', {
      p_section: S(), p_item: null, p_minute: ata, p_kind: 'inventado', p_text: 'x', p_responsible: null, p_due: null,
    }), 'Escolhe se é decisão');
    await expectDenied(rpc(w.users.P1, 'sec_item_save', {
      p_section: S(), p_item: dec, p_minute: null, p_kind: 'decisao', p_text: 'x', p_responsible: null, p_due: null,
      p_reminder_days: 2, p_request: null, p_stage_path: null,
    }), 'permissão');
    await admin(`delete from public.notifications where section_id = $1`, [S()]);
    task = await rpc<string>(w.users.GuiaA, 'sec_item_save', {
      p_section: S(), p_item: null, p_minute: ata, p_kind: 'tarefa', p_text: 'Comprar material confidencial', p_responsible: w.users.P1,
      p_due: inDays(10), p_reminder_days: 3, p_request: null, p_stage_path: null,
    });
    const n = await admin(`select title, body from public.notifications where profile_id = $1 and kind = 'sec_tarefa'`, [w.users.P1]);
    expect(n).toEqual([{ title: '[Teste] Nova tarefa', body: 'Tens um novo registo atribuído em Reuniões e tarefas.' }]);
    const r = await admin(`select profile_id, due_at, body, link from public.module_reminders where entity = 'sec_item' and entity_id = $1 and cancelled_at is null`, [task]);
    expect(r).toHaveLength(1);
    expect(r[0].profile_id).toBe(w.users.P1);
    expect(r[0].body).not.toContain('material');
    expect(r[0].link).toBe('/reunioes-e-tarefas/o-que-me-diz-respeito');
    const due = new Date(r[0].due_at).getTime();
    expect(Math.abs(due - (Date.parse(inDays(7)) + 8 * 3600e3)) < 2 * 3600e3).toBe(true); // 09:00 em Lisboa, 3 dias antes

    // Mudar o responsável reagenda o lembrete para a nova pessoa
    await rpc(w.users.GuiaA, 'sec_item_save', {
      p_section: S(), p_item: task, p_minute: null, p_kind: 'tarefa', p_text: 'Comprar material confidencial', p_responsible: w.users.P3,
      p_due: inDays(10), p_reminder_days: 3, p_request: null, p_stage_path: null,
    });
    await rpc(w.users.GuiaA, 'sec_item_save', {
      p_section: S(), p_item: task, p_minute: null, p_kind: 'tarefa', p_text: 'Comprar material confidencial', p_responsible: w.users.P1,
      p_due: inDays(10), p_reminder_days: 3, p_request: null, p_stage_path: null,
    });
    expect(await admin(`select profile_id from public.module_reminders where entity_id = $1 and cancelled_at is null and sent_at is null`, [task]))
      .toEqual([{ profile_id: w.users.P1 }]);
  });

  it('o responsável acompanha a sua tarefa; outros não', async () => {
    const mine = await rpc<any[]>(w.users.P1, 'sec_my_tasks', { p_section: S() });
    expect(mine.map((t) => t.id)).toContain(task);
    await rpc(w.users.P1, 'sec_item_set_status', { p_section: S(), p_item: task, p_status: 'em_curso', p_note: null });
    await expectDenied(rpc(w.users.P3, 'sec_item_set_status', { p_section: S(), p_item: task, p_status: 'feita', p_note: null }), NOT_FOUND);
    await expectDenied(rpc(w.users.P1, 'sec_item_set_status', { p_section: S(), p_item: task, p_status: 'inventado', p_note: null }), 'Estado inválido');
  });

  it('submeter: congela a versão e avisa quem aprova, sem conteúdo da ata', async () => {
    await admin(`delete from public.notifications where section_id = $1`, [S()]);
    await expectDenied(rpc(w.users.P1, 'sec_minute_submit', { p_section: S(), p_minute: ata, p_expected_version: 1 }), 'permissão');
    await rpc(w.users.GuiaA, 'sec_minute_submit', { p_section: S(), p_minute: ata, p_expected_version: 1 });
    const n = await admin(`select profile_id, title, body from public.notifications where section_id = $1 and kind = 'sec_aprovar'`, [S()]);
    expect(n.map((x) => x.profile_id).sort()).toEqual([w.users.Ana, w.users.Rui, w.users.GuiaB].sort());
    for (const x of n) expect(x).toMatchObject({ title: '[Teste] Ata para aprovar', body: 'Há uma ata para aprovar.' });
    await expectDenied(rpc(w.users.GuiaA, 'sec_minute_save', { p_section: S(), p_minute: ata, p_body: 'x', p_expected_version: 1 }), 'em aprovação');
    await expectDenied(admin(`update public.sec_minute_versions set body = 'adulterado' where minute_id = $1 and version_no = 1`, [ata]), 'fechada');
  });

  it('quem só redige ou só consulta não aprova; o aprovador devolve a rascunho', async () => {
    await expectDenied(rpc(w.users.GuiaA, 'sec_minute_approve', { p_section: S(), p_minute: ata, p_expected_version: 1 }), 'permissão');
    await expectDenied(rpc(w.users.P1, 'sec_minute_approve', { p_section: S(), p_minute: ata, p_expected_version: 1 }), 'permissão');
    await expectDenied(rpc(w.users.Tecnico, 'sec_minute_approve', { p_section: S(), p_minute: ata, p_expected_version: 1 }), NOT_FOUND);
    await rpc(w.users.GuiaB, 'sec_minute_return', { p_section: S(), p_minute: ata, p_reason: 'Rever ponto 2' });
    const d = await minute('GuiaA', ata);
    expect(d.minute).toMatchObject({ status: 'rascunho', current_version: 2 });
    expect(d.versions.map((v: any) => v.version_no)).toEqual([2, 1]);
    expect(d.version.note).toContain('Rever ponto 2');
    expect((await minute('GuiaA', ata, 1)).version).toMatchObject({ frozen: true, body: 'Texto confidencial da ata' });
  });

  it('aprovação por outra pessoa (dirigente), com versão esperada', async () => {
    await rpc(w.users.GuiaA, 'sec_minute_save', { p_section: S(), p_minute: ata, p_body: 'Texto final aprovado', p_expected_version: 2 });
    await rpc(w.users.GuiaA, 'sec_minute_submit', { p_section: S(), p_minute: ata, p_expected_version: 2 });
    await expectDenied(rpc(w.users.Rui, 'sec_minute_approve', { p_section: S(), p_minute: ata, p_expected_version: 1 }), 'mudou');
    await admin(`delete from public.notifications where section_id = $1`, [S()]);
    await rpc(w.users.Rui, 'sec_minute_approve', { p_section: S(), p_minute: ata, p_expected_version: 2 });
    const d = await minute('P1', ata);
    expect(d.minute).toMatchObject({ status: 'aprovada', approved_version: 2 });
    expect(d.version.content.items.map((i: any) => i.text)).toContain('Comprar material confidencial');
    expect(d.version.approved_by_name).toMatch(/Rui/);
    const n = await admin(`select body from public.notifications where section_id = $1 and kind = 'sec_aprovada'`, [S()]);
    expect(n).toEqual([{ body: 'Uma ata foi aprovada.' }]);
  });

  it('ata aprovada nunca é alterada: edição recusada, inclusive decisões e anexos', async () => {
    await expectDenied(rpc(w.users.GuiaA, 'sec_minute_save', { p_section: S(), p_minute: ata, p_body: 'mudança', p_expected_version: 2 }), 'aprovada não pode ser alterada');
    await expectDenied(rpc(w.users.GuiaA, 'sec_item_save', {
      p_section: S(), p_item: task, p_minute: null, p_kind: 'tarefa', p_text: 'Outro texto', p_responsible: w.users.P1,
      p_due: inDays(10), p_reminder_days: 3, p_request: null, p_stage_path: null,
    }), 'rascunho');
    await expectDenied(admin(`update public.sec_minute_versions set approved_by = $2 where minute_id = $1 and version_no = 2`, [ata, w.users.Ana]), 'fechada');
    await expectDenied(rpc(w.users.GuiaA, 'module_file_prepare', { p_section: S(), p_module: 'secretaria', p_entity: 'sec_minute', p_entity_id: ata, p_file_name: 'a.pdf', p_mime: 'application/pdf' }), 'permissão');
    await expectDenied(rpc(w.users.GuiaA, 'sec_meeting_cancel', { p_section: S(), p_meeting: mEquipa, p_reason: 'x' }), 'ata aprovada');
    // O estado de execução das tarefas continua a poder ser acompanhado
    // «feita» (nome v1) continua a ser aceite e passa a «concluida»
    await rpc(w.users.P1, 'sec_item_set_status', { p_section: S(), p_item: task, p_status: 'feita', p_note: 'Comprado' });
    expect(await admin(`select exec_status from public.sec_items where id = $1`, [task])).toEqual([{ exec_status: 'concluida' }]);
    expect(await admin(`select count(*)::int as n from public.module_reminders where entity_id = $1 and cancelled_at is null and sent_at is null`, [task])).toEqual([{ n: 0 }]);
  });

  it('correção cria nova versão; a aprovada continua consultável até haver outra aprovada', async () => {
    await expectDenied(rpc(w.users.P1, 'sec_minute_revise', { p_section: S(), p_minute: ata, p_reason: 'x' }), 'permissão');
    await expectDenied(rpc(w.users.GuiaA, 'sec_minute_revise', { p_section: S(), p_minute: ata, p_reason: ' ' }), 'motivo');
    expect(await rpc(w.users.GuiaA, 'sec_minute_revise', { p_section: S(), p_minute: ata, p_reason: 'Nome mal escrito' })).toBe(3);
    await rpc(w.users.GuiaA, 'sec_minute_save', { p_section: S(), p_minute: ata, p_body: 'Texto corrigido', p_expected_version: 3 });
    const d = await minute('P1', ata);
    expect(d.minute).toMatchObject({ status: 'rascunho', current_version: 3, approved_version: 2 });
    const v2 = await minute('P1', ata, 2);
    expect(v2.version).toMatchObject({ body: 'Texto final aprovado', frozen: true });
    expect(v2.version.approved_at).toBeTruthy();
    await rpc(w.users.GuiaA, 'sec_minute_submit', { p_section: S(), p_minute: ata, p_expected_version: 3 });
    await rpc(w.users.GuiaB, 'sec_minute_approve', { p_section: S(), p_minute: ata, p_expected_version: 3 });
    const after = await minute('P1', ata);
    expect(after.minute).toMatchObject({ status: 'aprovada', approved_version: 3 });
    expect(after.versions.filter((v: any) => v.approved_at).map((v: any) => v.version_no)).toEqual([3, 2]);
    expect((await minute('P1', ata, 2)).version.body).toBe('Texto final aprovado');
  });

  it('aditamento a uma ata aprovada, com aprovação própria', async () => {
    const ad = await rpc<string>(w.users.GuiaA, 'sec_minute_create', { p_section: S(), p_meeting: mEquipa, p_kind: 'aditamento', p_body: 'Acrescenta-se…' });
    await rpc(w.users.GuiaA, 'sec_minute_submit', { p_section: S(), p_minute: ad, p_expected_version: 1 });
    await rpc(w.users.GuiaB, 'sec_minute_approve', { p_section: S(), p_minute: ad, p_expected_version: 1 });
    expect((await minute('P1', ata)).addenda).toEqual([expect.objectContaining({ id: ad, status: 'aprovada' })]);
    expect((await minute('P1', ad)).parent.id).toBe(ata);
    await expectDenied(rpc(w.users.GuiaA, 'sec_minute_revise', { p_section: S(), p_minute: ad, p_reason: 'x' }), 'aditamento');
  });

  it('a ligação a pedidos e etapas é só referência: nada muda nessas tabelas', async () => {
    const snap = await admin(`select to_jsonb(r) as r from public.trail_requests r where membership_id = $1 union all select to_jsonb(p) from public.stage_paths p where membership_id in ($1, $2) union all select to_jsonb(d) from public.trail_decisions d join public.trail_requests r on r.id = d.request_id where r.membership_id = $1`,
      [w.members.P1, w.members.P3]);
    expect(snap).toEqual(before);
    const items = (await rpc<any>(w.users.P1, 'sec_meeting', { p_section: S(), p_meeting: mEquipa })).items;
    expect(items.find((i: any) => i.trail_request_id === request).link_label).toMatch(/^Pedido:/);
    expect((await admin(`select status from public.trail_requests where id = $1`, [request]))[0].status).toBe('rascunho');
  });
});

describe('anexos', () => {
  it('mesma visibilidade da reunião; só quem redige anexa', async () => {
    await expectDenied(rpc(w.users.P1, 'module_file_prepare', { p_section: S(), p_module: 'secretaria', p_entity: 'sec_meeting', p_entity_id: mEquipa, p_file_name: 'x.pdf', p_mime: 'application/pdf' }), 'permissão');
    const path = await rpc<string>(w.users.GuiaA, 'module_file_prepare', { p_section: S(), p_module: 'secretaria', p_entity: 'sec_meeting', p_entity_id: mEquipa, p_file_name: 'ordem.pdf', p_mime: 'application/pdf' });
    expect(path).toContain('/secretaria/teste/');
    const files = (who: string) => rpc<any[]>(w.users[who], 'module_files_of', { p_section: S(), p_module: 'secretaria', p_entity: 'sec_meeting', p_entity_id: mEquipa });
    expect((await files('P1')).map((f) => f.path)).toEqual([path]);
    expect(await files('P3')).toEqual([]);
    expect(await files('Tecnico')).toEqual([]);
    await expectDenied(rpc(w.users.P1, 'module_file_remove', { p_path: path }), 'permissão');
    // Animação: anexo invisível para quem não é dirigente autorizado
    const p2 = await rpc<string>(w.users.GuiaA, 'module_file_prepare', { p_section: S(), p_module: 'secretaria', p_entity: 'sec_meeting', p_entity_id: mAnimacao, p_file_name: 'n.pdf', p_mime: 'application/pdf' });
    expect((await rpc<any[]>(w.users.Rui, 'module_files_of', { p_section: S(), p_module: 'secretaria', p_entity: 'sec_meeting', p_entity_id: mAnimacao })).map((f) => f.path)).toEqual([p2]);
    expect(await rpc<any[]>(w.users.P1, 'module_files_of', { p_section: S(), p_module: 'secretaria', p_entity: 'sec_meeting', p_entity_id: mAnimacao })).toEqual([]);
    await rpc(w.users.GuiaA, 'module_file_remove', { p_path: p2 });
    expect(await rpc<any[]>(w.users.Rui, 'module_files_of', { p_section: S(), p_module: 'secretaria', p_entity: 'sec_meeting', p_entity_id: mAnimacao })).toEqual([]);
  });
});

const ev = async (space: string, title: string) => (await admin(`insert into public.cal_events (section_id, space, title, starts_at, ends_at, created_by)
  values ($1, $2, $3, now() + interval '3 days', now() + interval '3 days 2 hours', $4) returning id`, [S(), space, title, w.users.Ana]))[0].id as string;
const item = (who: string, minuteId: string, kind: string, text: string, extra: Record<string, unknown> = {}) =>
  rpc<string>(w.users[who], 'sec_item_save', {
    p_section: S(), p_item: null, p_minute: minuteId, p_kind: kind, p_text: text, p_responsible: null, p_due: null,
    p_reminder_days: 2, p_request: null, p_stage_path: null, p_team: null, p_event: null, ...extra,
  });
const summary = (who: string, meetingId: string, version?: number) =>
  rpc<any>(w.users[who], 'sec_summary', { p_section: S(), p_meeting: meetingId, p_version: version ?? null });
const myTasks = (who: string) => rpc<any[]>(w.users[who], 'sec_my_tasks', { p_section: S() });
const board = (who: string, f: Record<string, unknown> = {}) =>
  rpc<any>(w.users[who], 'sec_board', { p_section: S(), p_responsible: null, p_team: null, p_event: null, p_archived: false, ...f });

describe('sumário estruturado: pré-preenchido, revisto, publicado e com versões', () => {
  let mAn: string, ataAn: string, sum: string, evAn: string;
  let tTransporte: string, tMapas: string, pTendas: string, dec: string;

  it('a ata regista decisões, tarefas e preparativos; quem não vê a reunião não é avisado', async () => {
    evAn = await ev('teste', 'Raide de novembro');
    mAn = await meeting('GuiaA', 'animacao', { p_title: 'Reunião reservada de animação', p_cal_event: evAn });
    ataAn = await rpc<string>(w.users.GuiaA, 'sec_minute_create', { p_section: S(), p_meeting: mAn, p_kind: 'ata', p_body: 'Texto reservado: orçamento do raide.' });
    await admin(`delete from public.notifications where section_id = $1`, [S()]);
    dec = await item('GuiaA', ataAn, 'decisao', 'Decisão reservada sobre o orçamento');
    tTransporte = await item('GuiaA', ataAn, 'tarefa', 'Reservar autocarro com a empresa X', { p_responsible: w.users.P3, p_due: inDays(7), p_event: evAn });
    tMapas = await item('GuiaA', ataAn, 'tarefa', 'Comprar mapas');
    pTendas = await item('GuiaA', ataAn, 'preparar', 'Levar tendas', { p_team: w.teamB });
    await expectDenied(item('GuiaA', ataAn, 'tarefa', 'x', { p_event: '00000000-0000-0000-0000-000000000001' }), 'Atividade do calendário não encontrada');
    // GuiaB (equipa B) vê a reunião (aprovador): é avisado do preparativo da equipa; P3 não vê a reunião: não
    const n = await admin(`select profile_id from public.notifications where section_id = $1`, [S()]);
    expect(n.map((x) => x.profile_id)).not.toContain(w.users.P3);
    expect(await admin(`select count(*)::int as n from public.module_reminders where entity_id = $1 and cancelled_at is null`, [tTransporte])).toEqual([{ n: 0 }]);
    expect((await myTasks('P3')).map((t) => t.id)).not.toContain(tTransporte);
  });

  it('preparar: só quem redige ou aprova; rascunho com o que consta da ata, o resto por definir', async () => {
    await expectDenied(rpc(w.users.P1, 'sec_summary_prepare', { p_section: S(), p_meeting: mAn }), NOT_FOUND);
    await expectDenied(rpc(w.users.P2, 'sec_summary_prepare', { p_section: S(), p_meeting: mAn }));
    sum = await rpc<string>(w.users.GuiaA, 'sec_summary_prepare', { p_section: S(), p_meeting: mAn });
    const d = await summary('GuiaA', mAn);
    expect(d.summary).toMatchObject({ status: 'rascunho', current_version: 1, published_version: null });
    const e = d.version.content.entries;
    expect(e.map((x: any) => [x.kind, x.text])).toEqual([
      ['decisao', 'Decisão reservada sobre o orçamento'], ['tarefa', 'Reservar autocarro com a empresa X'],
      ['tarefa', 'Comprar mapas'], ['preparar', 'Levar tendas']]);
    expect(e[1]).toMatchObject({ responsible_id: w.users.P3, due_date: inDays(7), cal_event_id: evAn });
    expect(e[1].cal_event.title).toBe('Raide de novembro');
    // Nada inventado: o que não consta fica vazio (por definir)
    expect(e[2]).toMatchObject({ responsible_id: null, team_id: null, due_date: null, cal_event_id: null, responsible_name: null });
    expect(e[3]).toMatchObject({ responsible_id: null, team_id: w.teamB, due_date: null, team_name: 'Equipa B' });
    expect(e[0]).toMatchObject({ responsible_id: null, due_date: null });
    expect(d).toMatchObject({ can_edit: true, can_publish: false, missing_items: 0 });
    expect((await summary('GuiaB', mAn)).can_publish).toBe(false); // ata ainda não aprovada
    await expectDenied(rpc(w.users.GuiaB, 'sec_summary_publish', { p_section: S(), p_summary: sum, p_expected_version: 1 }), 'Aprova a ata');
    // Um registo novo na ata entra ao «atualizar a partir da ata», sem duplicar
    const extra = await item('GuiaA', ataAn, 'decisao', 'Segunda decisão');
    expect((await summary('GuiaA', mAn)).missing_items).toBe(1);
    await rpc(w.users.GuiaA, 'sec_summary_prepare', { p_section: S(), p_meeting: mAn });
    await rpc(w.users.GuiaA, 'sec_summary_prepare', { p_section: S(), p_meeting: mAn });
    const after = (await summary('GuiaA', mAn)).version.content.entries;
    expect(after.filter((x: any) => x.item_id === extra)).toHaveLength(1);
    expect(after).toHaveLength(5);
  });

  it('rever: edita títulos, omite pontos; não aceita pontos inventados', async () => {
    const entries = (await summary('GuiaA', mAn)).version.content.entries.map((x: any) => ({ ...x }));
    entries[1].text = 'Tratar do transporte';
    entries[4].omitted = true;
    await expectDenied(rpc(w.users.P1, 'sec_summary_save', { p_section: S(), p_summary: sum, p_entries: JSON.stringify(entries), p_expected_version: 1 }), NOT_FOUND);
    await expectDenied(rpc(w.users.GuiaA, 'sec_summary_save', { p_section: S(), p_summary: sum, p_entries: JSON.stringify(entries), p_expected_version: 2 }), 'mudou');
    await expectDenied(rpc(w.users.GuiaA, 'sec_summary_save', { p_section: S(), p_summary: sum,
      p_entries: JSON.stringify([...entries, { item_id: '00000000-0000-0000-0000-000000000009', kind: 'decisao', text: 'Inventada' }]), p_expected_version: 1 }), 'constam da ata');
    await expectDenied(rpc(w.users.GuiaA, 'sec_summary_save', { p_section: S(), p_summary: sum,
      p_entries: JSON.stringify([entries[0], entries[0]]), p_expected_version: 1 }), 'repetidos');
    await expectDenied(rpc(w.users.GuiaA, 'sec_summary_save', { p_section: S(), p_summary: sum,
      p_entries: JSON.stringify([{ ...entries[1], text: ' ' }]), p_expected_version: 1 }), 'texto');
    // Uma decisão não ganha responsável nem prazo no sumário
    entries[0].responsible_id = w.users.P1;
    await rpc(w.users.GuiaA, 'sec_summary_save', { p_section: S(), p_summary: sum, p_entries: JSON.stringify(entries), p_expected_version: 1 });
    const e = (await summary('GuiaA', mAn)).version.content.entries;
    expect(e[0].responsible_id).toBeNull();
    expect(e[1].text).toBe('Tratar do transporte');
    expect(e[4].omitted).toBe(true);
    // O registo da ata não muda por se rever o sumário
    expect((await admin(`select text from public.sec_items where id = $1`, [tTransporte]))[0].text).toBe('Reservar autocarro com a empresa X');
  });

  it('publicar: só quem aprova, com a ata aprovada; avisos genéricos aos destinatários', async () => {
    await rpc(w.users.GuiaA, 'sec_minute_submit', { p_section: S(), p_minute: ataAn, p_expected_version: 1 });
    await rpc(w.users.GuiaB, 'sec_minute_approve', { p_section: S(), p_minute: ataAn, p_expected_version: 1 });
    await expectDenied(rpc(w.users.GuiaA, 'sec_summary_publish', { p_section: S(), p_summary: sum, p_expected_version: 1 }), 'permissão');
    await expectDenied(rpc(w.users.P3, 'sec_summary_publish', { p_section: S(), p_summary: sum, p_expected_version: 1 }), NOT_FOUND);
    await admin(`delete from public.notifications where section_id = $1`, [S()]);
    await rpc(w.users.GuiaB, 'sec_summary_publish', { p_section: S(), p_summary: sum, p_expected_version: 1 });
    const d = await summary('Rui', mAn);
    expect(d.summary).toMatchObject({ status: 'publicado', published_version: 1 });
    expect(d.version).toMatchObject({ published: true });
    expect(d.version.published_by_name).toMatch(/GuiaB/);
    expect(d.version.content.entries[1].responsible_name).toMatch(/P3/);
    const n = await admin(`select profile_id, kind, title, body, link from public.notifications where section_id = $1 order by kind`, [S()]);
    // P3: responsável (e da equipa B); GuiaB (equipa B) publica e não é avisado; Ana, Rui e GuiaA veem a reunião
    expect(n.filter((x) => x.kind === 'sec_tarefa').map((x) => x.profile_id)).toEqual([w.users.P3]);
    expect(n.filter((x) => x.kind === 'sec_sumario').map((x) => x.profile_id).sort()).toEqual([w.users.Ana, w.users.Rui, w.users.GuiaA].sort());
    for (const x of n) {
      expect(JSON.stringify(x)).not.toMatch(/autocarro|orçamento|transporte|tendas|reservada/i);
      expect(x.title.startsWith('[Teste] ')).toBe(true);
    }
    // Agora publicado, o lembrete do prazo é programado para P3
    expect(await admin(`select profile_id from public.module_reminders where entity_id = $1 and cancelled_at is null`, [tTransporte])).toEqual([{ profile_id: w.users.P3 }]);
  });

  it('«O que me diz respeito» não revela conteúdo reservado', async () => {
    const mine = await myTasks('P3');
    const rows = mine.filter((t) => [tTransporte, tMapas, pTendas, dec].includes(t.id));
    expect(rows.map((t) => [t.text, t.via])).toEqual([['Tratar do transporte', 'pessoal'], ['Levar tendas', 'equipa']]);
    expect(rows[0]).toMatchObject({ due_date: inDays(7), exec_status: 'por_fazer', meeting_id: null, meeting_title: null, published: true });
    expect(rows[0].cal_event.title).toBe('Raide de novembro');
    expect(rows[1].team_name).toBe('Equipa B');
    expect(JSON.stringify(mine)).not.toMatch(/autocarro|orçamento|Decisão reservada|Reunião reservada|Texto reservado/);
    // Ficha limitada, sem histórico; sumário, reunião e quadro continuam inacessíveis
    const t = await rpc<any>(w.users.P3, 'sec_task', { p_section: S(), p_item: tTransporte });
    expect(t).toMatchObject({ limited: true, history: [], can_manage: false });
    expect(t.task.text).toBe('Tratar do transporte');
    expect(JSON.stringify(t)).not.toMatch(/autocarro|reservada/i);
    await expectDenied(rpc(w.users.P3, 'sec_task', { p_section: S(), p_item: dec }), NOT_FOUND);
    await expectDenied(rpc(w.users.P3, 'sec_task', { p_section: S(), p_item: tMapas }), NOT_FOUND);
    await expectDenied(summary('P3', mAn), NOT_FOUND);
    expect((await board('P3')).tasks.map((x: any) => x.id)).not.toContain(tTransporte);
    // P1 (equipa A) não tem nada desta reunião
    expect((await myTasks('P1')).map((x) => x.id)).not.toContain(pTendas);
    // O responsável muda o estado; não arquiva
    await rpc(w.users.P3, 'sec_item_set_status', { p_section: S(), p_item: tTransporte, p_status: 'em_curso', p_note: null });
    await expectDenied(rpc(w.users.P3, 'sec_item_set_status', { p_section: S(), p_item: tTransporte, p_status: 'cancelada', p_note: null }), 'arquivar');
    await expectDenied(rpc(w.users.P1, 'sec_item_set_status', { p_section: S(), p_item: tTransporte, p_status: 'concluida', p_note: null }), NOT_FOUND);
    await expectDenied(rpc(w.users.P3, 'sec_item_set_status', { p_section: S(), p_item: dec, p_status: 'concluida', p_note: null }), NOT_FOUND);
  });

  it('o sumário publicado nunca muda em silêncio: nova versão com motivo', async () => {
    await expectDenied(admin(`update public.sec_summary_versions set content = '{"entries": []}' where summary_id = $1 and version_no = 1`, [sum]), 'publicada');
    await expectDenied(rpc(w.users.GuiaA, 'sec_summary_save', { p_section: S(), p_summary: sum, p_entries: '[]', p_expected_version: 1 }), 'nova versão');
    await expectDenied(rpc(w.users.GuiaA, 'sec_summary_prepare', { p_section: S(), p_meeting: mAn }), 'nova versão');
    await expectDenied(rpc(w.users.GuiaA, 'sec_summary_revise', { p_section: S(), p_summary: sum, p_reason: ' ' }), 'motivo');
    expect(await rpc(w.users.GuiaA, 'sec_summary_revise', { p_section: S(), p_summary: sum, p_reason: 'Faltava o responsável dos mapas' })).toBe(2);
    const d = await summary('GuiaA', mAn);
    expect(d.summary).toMatchObject({ status: 'rascunho', current_version: 2, published_version: 1 });
    expect(d.version.note).toBe('Revisão: Faltava o responsável dos mapas');
    // Enquanto a revisão não é publicada, continua em vigor a versão 1
    expect((await myTasks('P3')).find((t) => t.id === tTransporte).text).toBe('Tratar do transporte');
    const entries = d.version.content.entries.map((x: any) => ({ ...x }));
    entries[2].responsible_id = w.users.GuiaA;
    entries[2].due_date = inDays(-2);
    await rpc(w.users.GuiaA, 'sec_summary_save', { p_section: S(), p_summary: sum, p_entries: JSON.stringify(entries), p_expected_version: 2 });
    await rpc(w.users.Rui, 'sec_summary_publish', { p_section: S(), p_summary: sum, p_expected_version: 2 });
    const v = await summary('GuiaB', mAn);
    expect(v.versions.map((x: any) => [x.version_no, !!x.published_at])).toEqual([[2, true], [1, true]]);
    expect((await summary('GuiaB', mAn, 1)).version.content.entries[2].responsible_id).toBeNull();
    // A revisão publicada passou para o quadro, com histórico
    expect(await admin(`select responsible_id, due_date::text as due from public.sec_items where id = $1`, [tMapas]))
      .toEqual([{ responsible_id: w.users.GuiaA, due: inDays(-2) }]);
    const t = await rpc<any>(w.users.GuiaA, 'sec_task', { p_section: S(), p_item: tMapas });
    const h = t.history.filter((x: any) => x.field !== 'criada');
    expect(h.map((x: any) => [x.field, x.from])).toEqual(expect.arrayContaining([['responsavel', 'Por definir'], ['prazo', 'Por definir']]));
    expect(h[0].note).toBe('Definido no sumário publicado (versão 2).');
    expect(t.task.overdue).toBe(true);
  });
});

describe('quadro de tarefas: estados, atraso, filtros e histórico', () => {
  let mB: string, ataB: string, t1: string, t2: string, evB: string;

  it('mostra só tarefas e preparativos de reuniões visíveis, com destaque para atrasos', async () => {
    evB = await ev('teste', 'Acampamento de equipa');
    mB = await meeting('GuiaA', 'equipa', { p_team: w.teamA, p_title: 'Reunião da equipa A (quadro)' });
    ataB = await rpc<string>(w.users.GuiaA, 'sec_minute_create', { p_section: S(), p_meeting: mB, p_kind: 'ata', p_body: 'Texto' });
    t1 = await item('GuiaA', ataB, 'tarefa', 'Tarefa atrasada', { p_responsible: w.users.P1, p_due: inDays(-1) });
    t2 = await item('GuiaA', ataB, 'preparar', 'Preparar jogos', { p_team: w.teamA, p_event: evB });
    await item('GuiaA', ataB, 'decisao', 'Decisão não vai para o quadro');
    const b = await board('P1');
    const ids = b.tasks.map((x: any) => x.id);
    expect(ids).toEqual(expect.arrayContaining([t1, t2]));
    expect(b.tasks.some((x: any) => x.kind === 'decisao')).toBe(false);
    expect(b.tasks.find((x: any) => x.id === t1)).toMatchObject({ overdue: true, exec_status: 'por_fazer', minute_id: ataB, meeting_id: mB, can_status: true, can_manage: false });
    expect(b.tasks.find((x: any) => x.id === t2)).toMatchObject({ overdue: false, team_name: 'Equipa A', responsible_id: null, can_status: true });
    expect(b.can_manage).toBe(false);
    expect(b.events.map((e: any) => e.id)).toContain(evB);
    // O rascunho do sumário (ainda não revisto) não é mostrado a quem só consulta
    await rpc(w.users.GuiaA, 'sec_summary_prepare', { p_section: S(), p_meeting: mB });
    const draft = await summary('P1', mB);
    expect(draft).toMatchObject({ version: null, versions: [], can_edit: false, can_publish: false, can_manage: false });
    expect(draft.summary.status).toBe('rascunho');
    await expectDenied(summary('P1', mB, 1), NOT_FOUND);
    expect((await summary('GuiaA', mB)).version.content.entries).toHaveLength(3);
    // Quem não vê a reunião não a vê no quadro
    expect((await board('P3')).tasks.map((x: any) => x.id)).not.toContain(t1);
    expect((await board('Tecnico')).tasks.map((x: any) => x.id)).not.toContain(t1);
  });

  it('filtros: responsável, equipa, atividade e arquivo', async () => {
    expect((await board('GuiaA', { p_responsible: w.users.P1 })).tasks.map((x: any) => x.id)).toContain(t1);
    expect((await board('GuiaA', { p_responsible: w.users.P1 })).tasks.map((x: any) => x.id)).not.toContain(t2);
    const teamA = (await board('GuiaA', { p_team: w.teamA })).tasks.map((x: any) => x.id);
    expect(teamA).toEqual(expect.arrayContaining([t1, t2])); // P1 é da equipa A; t2 é da equipa A
    expect((await board('GuiaA', { p_team: w.teamB })).tasks.map((x: any) => x.id)).not.toContain(t1);
    expect((await board('GuiaA', { p_event: evB })).tasks.map((x: any) => x.id)).toEqual([t2]);
  });

  it('estados Por fazer → Em curso → Concluída, com histórico de conclusão', async () => {
    await rpc(w.users.P1, 'sec_item_set_status', { p_section: S(), p_item: t1, p_status: 'em_curso', p_note: null });
    await expectDenied(rpc(w.users.P2, 'sec_item_set_status', { p_section: S(), p_item: t2, p_status: 'em_curso', p_note: null })); // sem acesso em teste
    await rpc(w.users.P1, 'sec_item_set_status', { p_section: S(), p_item: t2, p_status: 'concluida', p_note: 'Jogos prontos' }); // equipa responsável
    await rpc(w.users.P1, 'sec_item_set_status', { p_section: S(), p_item: t1, p_status: 'concluida', p_note: 'Feito' });
    const t = await rpc<any>(w.users.GuiaA, 'sec_task', { p_section: S(), p_item: t1 });
    expect(t.task).toMatchObject({ exec_status: 'concluida', overdue: false });
    expect(t.task.completed_at).toBeTruthy();
    expect(t.history.filter((h: any) => h.field === 'estado').map((h: any) => [h.from, h.to])).toEqual([
      ['Em curso', 'Concluída'], ['Por fazer', 'Em curso']]);
    expect(t.history[0].by).toMatch(/P1/);
    expect(t.history[0].note).toBe('Feito');
    expect(t.history.at(-1).field).toBe('criada');
    expect(t).toMatchObject({ limited: false, meeting: { id: mB }, minute: { id: ataB } });
    // Reabrir limpa a conclusão
    await rpc(w.users.P1, 'sec_item_set_status', { p_section: S(), p_item: t1, p_status: 'por_fazer', p_note: null });
    expect(await admin(`select completed_at from public.sec_items where id = $1`, [t1])).toEqual([{ completed_at: null }]);
  });

  it('gerir no quadro (responsável, prazo, atividade) só quem redige ou aprova; arquivar sai do quadro', async () => {
    await expectDenied(rpc(w.users.P1, 'sec_task_update', { p_section: S(), p_item: t1, p_responsible: w.users.P1, p_team: null, p_due: inDays(3), p_event: null, p_note: null }), 'permissão');
    await expectDenied(rpc(w.users.P3, 'sec_task_update', { p_section: S(), p_item: t1, p_responsible: null, p_team: null, p_due: null, p_event: null, p_note: null }), NOT_FOUND);
    await admin(`delete from public.notifications where section_id = $1`, [S()]);
    await rpc(w.users.Rui, 'sec_task_update', { p_section: S(), p_item: t1, p_responsible: w.users.P2, p_team: null, p_due: inDays(5), p_event: evB, p_note: 'Troca combinada' });
    const t = await rpc<any>(w.users.GuiaA, 'sec_task', { p_section: S(), p_item: t1 });
    expect(t.history.slice(0, 3).map((h: any) => [h.field, h.note])).toEqual(expect.arrayContaining([
      ['responsavel', 'Troca combinada'], ['prazo', 'Troca combinada'], ['atividade', 'Troca combinada']]));
    expect(t.history.find((h: any) => h.field === 'atividade')).toMatchObject({ from: 'Por definir', to: 'Acampamento de equipa' });
    // P2 vê a reunião (equipa A), mas não é tester em teste: não recebe avisos
    expect(await admin(`select count(*)::int as n from public.notifications where section_id = $1 and profile_id = $2`, [S(), w.users.P2])).toEqual([{ n: 0 }]);
    // Arquivar (cancelada) tira do quadro e do «O que me diz respeito»; continua consultável no arquivo
    await rpc(w.users.GuiaA, 'sec_item_set_status', { p_section: S(), p_item: t2, p_status: 'cancelada', p_note: 'Já não é preciso' });
    expect((await board('GuiaA')).tasks.map((x: any) => x.id)).not.toContain(t2);
    expect((await board('GuiaA', { p_archived: true })).tasks.map((x: any) => x.id)).toContain(t2);
    expect((await myTasks('P1')).map((x) => x.id)).not.toContain(t2);
    await expectDenied(rpc(w.users.GuiaA, 'sec_task_update', { p_section: S(), p_item: t1, p_responsible: null, p_team: null, p_due: null,
      p_event: '00000000-0000-0000-0000-000000000001', p_note: null }), 'Atividade');
  });

  it('integração: tarefas ligadas a uma atividade, respeitando a visibilidade', async () => {
    const forEvent = async (who: string, space: string, e: string) =>
      (await asUser(w.users[who], `select private.sec_tasks_for_event($1, $2, $3) as r`, [S(), space, e]))[0].r as any[];
    expect((await forEvent('GuiaA', 'teste', evB)).map((x) => x.id)).toEqual([t1]);
    expect((await forEvent('GuiaA', 'teste', evB))[0]).toMatchObject({ title: 'Tarefa atrasada', exec_status: 'por_fazer', meeting_id: mB });
    expect(await forEvent('GuiaA', 'real', evB)).toEqual([]); // outro espaço
    expect(await forEvent('P2', 'teste', evB)).toEqual([]); // sem acesso ao módulo em teste
    expect(await forEvent('P3', 'teste', evB)).toEqual([]); // não vê a reunião da equipa A
    // P3 só vê a sua tarefa publicada da reunião reservada, com o título revisto
    const evAn = (await admin(`select id from public.cal_events where title = 'Raide de novembro' and section_id = $1`, [S()]))[0].id;
    const r = await forEvent('P3', 'teste', evAn);
    expect(r.map((x) => x.title)).toEqual(['Tratar do transporte']);
    expect(r[0].meeting_id).toBeNull();
  });
});

describe('pesquisa e histórico de reuniões', () => {
  const find = (who: string, f: Record<string, unknown>) =>
    rpc<any>(w.users[who], 'sec_meetings', { p_section: S(), p_search: null, p_kind: null, p_team: null, p_event: null, p_from: null, p_to: null, ...f })
      .then((r) => r.meetings.map((m: any) => m.title));

  it('por texto da ata, data, equipa e atividade — só nas reuniões que a pessoa vê', async () => {
    expect(await find('Rui', { p_search: 'orçamento do raide' })).toEqual(['Reunião reservada de animação']);
    expect(await find('P3', { p_search: 'orçamento do raide' })).toEqual([]);
    expect(await find('GuiaA', { p_search: 'Preparar jogos' })).toEqual(['Reunião da equipa A (quadro)']);
    expect(await find('GuiaA', { p_from: inDays(2) })).toEqual([]);
    expect(await find('GuiaA', { p_to: inDays(1) })).toContain('Reunião da equipa A (quadro)');
    expect(await find('GuiaA', { p_team: w.teamB })).toEqual([]);
    expect(await find('GuiaA', { p_team: w.teamA })).toContain('Reunião da equipa A (quadro)');
    const evAn = (await admin(`select id from public.cal_events where title = 'Raide de novembro' and section_id = $1`, [S()]))[0].id;
    expect(await find('GuiaA', { p_event: evAn })).toEqual(['Reunião reservada de animação']);
    const r = await rpc<any>(w.users.GuiaA, 'sec_meetings', { p_section: S() });
    expect(r.events.map((e: any) => e.title)).toContain('Raide de novembro');
    expect(r.meetings.find((m: any) => m.title === 'Reunião reservada de animação').summary).toMatchObject({ status: 'publicado' });
    expect(r.teams.map((t: any) => t.name)).toEqual(expect.arrayContaining(['Equipa A', 'Equipa B']));
  });
});

describe('calendário, anulação e isolamento teste/real', () => {
  let evTest: string, evReal: string;

  it('liga a uma atividade do calendário só da mesma secção e espaço', async () => {
    const ins = (space: string, title: string) => admin(`insert into public.cal_events (section_id, space, title, starts_at, ends_at, created_by)
      values ($1, $2, $3, now() + interval '1 day', now() + interval '1 day 2 hours', $4) returning id`, [S(), space, title, w.users.Ana]);
    evTest = (await ins('teste', 'Atividade de teste'))[0].id;
    evReal = (await ins('real', 'Atividade real'))[0].id;
    const opts = await rpc<any[]>(w.users.GuiaA, 'sec_event_options', { p_section: S() });
    expect(opts.map((e) => e.id)).toContain(evTest);
    expect(opts.map((e) => e.id)).not.toContain(evReal);
    await expectDenied(meeting('GuiaA', 'animacao', { p_cal_event: evReal }), 'Atividade do calendário não encontrada');
    const m = await meeting('GuiaA', 'animacao', { p_cal_event: evTest });
    expect((await rpc<any>(w.users.Rui, 'sec_meeting', { p_section: S(), p_meeting: m })).meeting.cal_event.title).toBe('Atividade de teste');
  });

  it('anular uma reunião não apaga nada e exige motivo', async () => {
    await expectDenied(rpc(w.users.GuiaA, 'sec_meeting_cancel', { p_section: S(), p_meeting: mConselho, p_reason: '' }), 'motivo');
    await rpc(w.users.GuiaA, 'sec_meeting_cancel', { p_section: S(), p_meeting: mConselho, p_reason: 'Adiada' });
    const d = await rpc<any>(w.users.P3, 'sec_meeting', { p_section: S(), p_meeting: mConselho });
    expect(d.meeting).toMatchObject({ status: 'anulada', cancel_reason: 'Adiada' });
    await expectDenied(rpc(w.users.GuiaA, 'sec_minute_create', { p_section: S(), p_meeting: mConselho, p_kind: 'ata', p_body: '' }), 'anulada');
  });

  it('dados de teste nunca aparecem no espaço real (e vice-versa)', async () => {
    await setupModule(w, 'secretaria', 'disponivel');
    expect((await rpc<any>(w.users.P1, 'sec_meetings', { p_section: S() })).meetings).toEqual([]);
    await expectDenied(rpc(w.users.P1, 'sec_meeting', { p_section: S(), p_meeting: mEquipa }), NOT_FOUND);
    await expectDenied(rpc(w.users.Rui, 'sec_minute', { p_section: S(), p_minute: (await admin(`select id from public.sec_minutes where meeting_id = $1 and kind = 'ata'`, [mEquipa]))[0].id }), NOT_FOUND);
    expect(await rpc<any[]>(w.users.P1, 'sec_my_tasks', { p_section: S() })).toEqual([]);
    expect(await rpc<any[]>(w.users.P3, 'sec_my_tasks', { p_section: S() })).toEqual([]);
    expect((await rpc<any>(w.users.GuiaA, 'sec_board', { p_section: S() })).tasks).toEqual([]);
    expect((await rpc<any>(w.users.GuiaA, 'sec_board', { p_section: S(), p_archived: true })).tasks).toEqual([]);
    expect((await asUser(w.users.GuiaA, `select private.sec_tasks_for_event($1, 'teste', $2) as r`, [S(), evTest]))[0].r).toEqual([]);
    expect((await rpc<any[]>(w.users.GuiaA, 'sec_event_options', { p_section: S() })).map((e) => e.id)).toEqual([evReal]);
    // Agora no real, P2 (não tester) já tem acesso de consulta à reunião da sua equipa
    const real = await rpc<string>(w.users.GuiaA, 'sec_meeting_save', {
      p_section: S(), p_meeting: null, p_kind: 'equipa', p_team: w.teamA, p_title: 'Reunião real', p_starts_at: new Date().toISOString(),
      p_location: null, p_agenda: '', p_cal_event: evReal, p_participants: [], p_share_profiles: [], p_share_teams: [],
    });
    expect(await seen('P2')).toEqual([real]);
    // Ficheiros de teste ficam inacessíveis no espaço real
    expect(await rpc<any[]>(w.users.P1, 'module_files_of', { p_section: S(), p_module: 'secretaria', p_entity: 'sec_meeting', p_entity_id: mEquipa })).toEqual([]);
    // De volta a teste: os dados de teste continuam lá e o real não aparece
    await setupModule(w, 'secretaria', 'teste');
    const ids = await seen('Rui');
    expect(ids).toContain(mEquipa);
    expect(ids).not.toContain(real);
    expect(await admin(`select space from public.sec_meetings where id = $1`, [real])).toEqual([{ space: 'real' }]);
  });

  it('em teste só testers recebem lembretes e avisos', async () => {
    const recips = await admin(`select private.module_recipients($1, 'secretaria', 'teste', array[$2, $3]::uuid[]) as r`, [S(), w.users.P1, w.users.P2]);
    expect(recips[0].r).toEqual([w.users.P1]);
  });

  it('publicar passando os dados de teste a reais mantém versões fechadas intactas', async () => {
    const ata = (await admin(`select id from public.sec_minutes where meeting_id = $1 and kind = 'ata'`, [mEquipa]))[0].id;
    const before = await admin(`select version_no, body, snapshot, approved_at from public.sec_minute_versions where minute_id = $1 order by version_no`, [ata]);
    const sumBefore = await admin(`select v.version_no, v.content, v.published_at from public.sec_summary_versions v order by v.summary_id, v.version_no`);
    const histBefore = await admin(`select count(*)::int as n from public.sec_item_history where section_id = $1`, [S()]);
    await rpc(w.users.Ana, 'set_module_status', { p_section: S(), p_module: 'secretaria', p_status: 'disponivel', p_move_test_data: true });
    expect(await admin(`select count(*)::int as n from public.sec_minute_versions where section_id = $1 and space = 'teste'`, [S()])).toEqual([{ n: 0 }]);
    expect(await admin(`select version_no, body, snapshot, approved_at from public.sec_minute_versions where minute_id = $1 order by version_no`, [ata])).toEqual(before);
    expect(await seen('Rui')).toContain(mEquipa);
    // Sumários publicados e histórico passam intactos
    expect(await admin(`select v.version_no, v.content, v.published_at from public.sec_summary_versions v order by v.summary_id, v.version_no`)).toEqual(sumBefore);
    for (const t of ['sec_summaries', 'sec_summary_versions', 'sec_item_history']) {
      expect(await admin(`select count(*)::int as n from public.${t} where section_id = $1 and space = 'teste'`, [S()])).toEqual([{ n: 0 }]);
    }
    expect(await admin(`select count(*)::int as n from public.sec_item_history where section_id = $1`, [S()])).toEqual(histBefore);
    // Tarefas reais não ficam ligadas a atividades do Calendário que continuam de teste
    expect(await admin(`select count(*)::int as n from public.sec_items i join public.cal_events e on e.id = i.cal_event_id
                         where i.section_id = $1 and e.space = 'teste'`, [S()])).toEqual([{ n: 0 }]);
    expect((await rpc<any[]>(w.users.P3, 'sec_my_tasks', { p_section: S() })).map((t) => t.text)).toContain('Tratar do transporte');
    expect((await minute('P1', ata, 2)).version.body).toBe('Texto final aprovado');
    await expectDenied(rpc(w.users.GuiaA, 'sec_minute_save', { p_section: S(), p_minute: ata, p_body: 'x', p_expected_version: 3 }), 'aprovada não pode ser alterada');
  });
});
