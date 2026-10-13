import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, buildWorld, createUser, expectError, joinWith, pool, rpc, today, trailId, validateTrail, type World } from './helpers';

let w: World;
let other: World;

beforeAll(async () => {
  w = await buildWorld('acesso');
  other = await buildWorld('outro');
});
afterAll(() => pool.end());

describe('registo e convites', () => {
  it('ignora funções privilegiadas indicadas nos metadados do registo', async () => {
    const u = await createUser('Intruso', { role: 'admin', is_admin: true, function: 'dirigente' });
    const profile = await admin(`select * from public.profiles where id = $1`, [u]);
    expect(profile[0].full_name).toBe('Intruso');
    expect(await admin(`select * from public.memberships where profile_id = $1`, [u])).toHaveLength(0);
  });

  it('convite cria inscrição pendente, sem acesso a dados até confirmação', async () => {
    const u = await createUser('Pendente');
    const code = await rpc<string>(w.users.Ana, 'create_invite', {
      p_section: w.section, p_label: 'x', p_expires_at: new Date(Date.now() + 3600e3).toISOString(), p_max_uses: 1,
    });
    const m = await joinWith(u, code);
    const mine = await asUser(u, `select status, function, is_admin from public.memberships where id = $1`, [m]);
    expect(mine[0]).toEqual({ status: 'pendente', function: null, is_admin: false });
    expect(await asUser(u, `select * from public.teams where section_id = $1`, [w.section])).toHaveLength(0);
    expect(await asUser(u, `select * from public.trail_requests`)).toHaveLength(0);
    await expectError(rpc(u, 'create_trail_request', { p_membership: m, p_trail: await trailId('fisico-desempenho'), p_kind: 'normal' }), 'percurso de progresso ativo');
    // Convite de uso único já esgotado
    const u2 = await createUser('Segundo');
    await expectError(joinWith(u2, code), 'limite de utilizações');
  });

  it('quem pede entrada indica a equipa; a administração confirma ou corrige e pode mudar o nome', async () => {
    const u = await createUser('Com Equipa');
    const code = await rpc<string>(w.users.Ana, 'create_invite', {
      p_section: w.section, p_label: 'equipa', p_expires_at: new Date(Date.now() + 3600e3).toISOString(), p_max_uses: 1,
    });
    const m = await joinWith(u, code);
    const opts = await asUser(u, `select * from public.join_team_options()`);
    expect(opts.map((o) => o.team_id).sort()).toEqual([w.teamA, w.teamB].sort());
    expect(await asUser(other.users.P1, `select * from public.join_team_options()`)).toEqual([]); // sem pedidos pendentes, nada
    await expectError(rpc(u, 'set_requested_team', { p_membership: m, p_team: other.teamA }), 'Equipa inválida');
    await expectError(rpc(w.users.P1, 'set_requested_team', { p_membership: m, p_team: w.teamA }), 'não encontrado');
    await rpc(u, 'set_requested_team', { p_membership: m, p_team: w.teamB });
    const row = await asUser(u, `select requested_team_id, team_id, function from public.memberships where id = $1`, [m]);
    expect(row[0]).toEqual({ requested_team_id: w.teamB, team_id: null, function: null }); // só uma indicação
    // A administração muda o nome e aprova noutra equipa
    await expectError(rpc(w.users.P1, 'admin_update_profile', { p_membership: m, p_full_name: 'X', p_totem: null }), 'não encontrada');
    await expectError(rpc(other.users.Ana, 'admin_update_profile', { p_membership: m, p_full_name: 'X', p_totem: null }), 'não encontrada');
    await rpc(w.users.Ana, 'admin_update_profile', { p_membership: m, p_full_name: 'Nome Corrigido', p_totem: 'Lince' });
    expect((await admin(`select full_name, totem from public.profiles where id = $1`, [u]))[0]).toEqual({ full_name: 'Nome Corrigido', totem: 'Lince' });
    await rpc(w.users.Ana, 'approve_membership', { p_membership: m, p_function: 'pioneiro', p_team: w.teamA });
    expect((await admin(`select team_id from public.memberships where id = $1`, [m]))[0].team_id).toBe(w.teamA);
    await expectError(rpc(u, 'set_requested_team', { p_membership: m, p_team: w.teamB }), 'já foi confirmada');
  });

  it('código curto: formato, sem caracteres confundíveis, aceite com ou sem hífen/espaços/minúsculas', async () => {
    const code = await rpc<string>(w.users.Ana, 'create_invite', {
      p_section: w.section, p_label: 'curto', p_expires_at: new Date(Date.now() + 3600e3).toISOString(), p_max_uses: 3, p_team: w.teamB,
    });
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    const u = await createUser('Curto');
    const preview = await rpc<any>(u, 'invite_preview', { p_code: ` ${code.toLowerCase().replace('-', ' ')} ` });
    expect(preview).toMatchObject({ ok: true, team: expect.any(String), already: false });
    expect(preview.section).toBeTruthy();
    const m = await joinWith(u, code.replace('-', '').toLowerCase());
    const row = await admin(`select status, function, is_admin, requested_team_id from public.memberships where id = $1`, [m]);
    expect(row[0]).toEqual({ status: 'pendente', function: null, is_admin: false, requested_team_id: w.teamB }); // nunca dá funções
    await expectError(joinWith(u, code), 'Já tens um pedido');
    expect((await rpc<any>(u, 'invite_preview', { p_code: code })).already).toBe(true);
    // Muitos códigos gerados: todos únicos e só com o alfabeto permitido
    const many = await admin<{ c: string }>(`select private.invite_code_new() as c from generate_series(1, 300)`);
    expect(new Set(many.map((x) => x.c)).size).toBe(300);
    for (const x of many) expect(x.c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it('limite de tentativas: adivinhar códigos fica bloqueado durante 15 minutos', async () => {
    const u = await createUser('Adivinha');
    for (let i = 0; i < 8; i++) await expectError(joinWith(u, `ZZZZ-ZZ${'23456789'[i]}Z`), 'inválido');
    await expectError(joinWith(u, 'ABCD-EFGH'), 'Demasiadas tentativas');
    expect((await rpc<any>(u, 'invite_preview', { p_code: 'ABCD-EFGH' })).error).toMatch(/Demasiadas tentativas/);
    // Mesmo com um código válido, enquanto durar o bloqueio
    const code = await rpc<string>(w.users.Ana, 'create_invite', {
      p_section: w.section, p_label: 'bloq', p_expires_at: new Date(Date.now() + 3600e3).toISOString(), p_max_uses: 3,
    });
    await expectError(joinWith(u, code), 'Demasiadas tentativas');
    expect(await asUser(u, `select * from private.invite_attempts`).catch((e) => String(e))).toMatch(/permission denied/);
  });

  it('gerar um convite novo revoga o anterior; convites antigos (código longo) continuam a funcionar', async () => {
    const code = await rpc<string>(w.users.Ana, 'create_invite', {
      p_section: w.section, p_label: 'renovar', p_expires_at: new Date(Date.now() + 3600e3).toISOString(), p_max_uses: 3,
    });
    const id = (await admin(`select id from public.invites where code = $1`, [code.replace('-', '')]))[0].id;
    await expectError(rpc(w.users.P1, 'regenerate_invite', { p_invite: id }), 'não encontrado');
    const fresh = await rpc<string>(w.users.Ana, 'regenerate_invite', { p_invite: id });
    expect(fresh).not.toBe(code);
    await expectError(joinWith(await createUser('Velho'), code), 'revogado');
    await joinWith(await createUser('Novo'), fresh);
    // Convite antigo: só o hash do código longo guardado
    await admin(`insert into public.invites (section_id, token_hash, label, expires_at, max_uses, created_by)
                 values ($1, extensions.digest('codigo-antigo-muito-longo-123', 'sha256'), 'antigo', now() + interval '1 day', 2, $2)`, [w.section, w.users.Ana]);
    await joinWith(await createUser('Antigo'), 'codigo-antigo-muito-longo-123');
  });

  it('rejeita convites revogados, expirados e inválidos', async () => {
    const code = await rpc<string>(w.users.Ana, 'create_invite', {
      p_section: w.section, p_label: 'revogar', p_expires_at: new Date(Date.now() + 3600e3).toISOString(), p_max_uses: 5,
    });
    const inv = (await admin(`select id from public.invites where label = 'revogar' and section_id = $1`, [w.section]))[0].id;
    await rpc(w.users.Ana, 'revoke_invite', { p_invite: inv });
    const u = await createUser('Tardio');
    await expectError(joinWith(u, code), 'revogado');
    await admin(`update public.invites set revoked_at = null, expires_at = now() - interval '1 minute' where id = $1`, [inv]);
    await expectError(joinWith(u, code), 'expirou');
    await expectError(joinWith(u, 'nao-existe-de-todo'), 'inválido');
  });

  it('consumo de convite de uso único é atómico sob concorrência', async () => {
    const code = await rpc<string>(w.users.Ana, 'create_invite', {
      p_section: w.section, p_label: 'corrida', p_expires_at: new Date(Date.now() + 3600e3).toISOString(), p_max_uses: 1,
    });
    const racers = await Promise.all([1, 2, 3, 4].map((i) => createUser(`Corrida ${i}`)));
    const results = await Promise.allSettled(racers.map((u) => joinWith(u, code)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const inv = await admin(`select use_count from public.invites where label = 'corrida' and section_id = $1`, [w.section]);
    expect(inv[0].use_count).toBe(1);
  });

  it('só administradores criam convites e confirmam membros', async () => {
    await expectError(
      rpc(w.users.Rui, 'create_invite', { p_section: w.section, p_label: 'x', p_expires_at: new Date(Date.now() + 3600e3).toISOString(), p_max_uses: 1 }),
      'administradores',
    );
    await expectError(rpc(w.users.P1, 'update_membership', { p_membership: w.members.P1, p_function: 'dirigente', p_team: null, p_is_admin: true, p_reason: '' }), 'não encontrada');
  });
});

describe('escalada de privilégios e escrita direta', () => {
  it('cliente não pode escrever diretamente em tabelas protegidas', async () => {
    await expectError(asUser(w.users.P1, `update public.memberships set is_admin = true, function = 'dirigente' where id = $1`, [w.members.P1]), 'permission denied');
    await expectError(asUser(w.users.P1, `update public.profiles set full_name = 'x' where id = $1`, [w.users.P1]), 'permission denied');
    await expectError(
      asUser(w.users.P1, `insert into public.trail_requests (membership_id, section_id, trail_id, trail_key, kind, status, created_by)
        values ($1, $2, $3, 'fisico-desempenho', 'normal', 'validado_equipa', $4)`, [w.members.P1, w.section, await trailId('fisico-desempenho'), w.users.P1]),
      'permission denied',
    );
    await expectError(asUser(w.users.P1, `insert into public.trail_decisions (request_id, version_id, kind, recorded_by, recorded_as) values (gen_random_uuid(), gen_random_uuid(), 'validado_equipa', $1, 'guia')`, [w.users.P1]), 'permission denied');
    await expectError(asUser(w.users.Ana, `delete from public.membership_history`), 'permission denied');
    await expectError(asUser(w.users.P1, `select private.notify(array[$1::uuid], null, 'x', 'x', 'x', null)`, [w.users.P2]), 'permission denied');
  });

  it('editar o perfil não altera funções', async () => {
    await rpc(w.users.P1, 'update_my_profile', { p_full_name: 'Pedro Um', p_totem: 'Lince' });
    const m = await admin(`select function, is_admin from public.memberships where id = $1`, [w.members.P1]);
    expect(m[0]).toEqual({ function: 'pioneiro', is_admin: false });
  });

  it('funções RPC não estão disponíveis para visitantes anónimos', async () => {
    await expectError(rpc(null, 'join_section', { p_code: 'x' }), 'permission denied');
  });

  it('a secção mantém sempre um administrador', async () => {
    // Com dois administradores (Ana e Tecnico), Ana pode deixar de ser admin…
    await rpc(w.users.Ana, 'update_membership', { p_membership: w.members.Ana, p_function: 'dirigente', p_team: null, p_is_admin: false, p_reason: 'teste' });
    // …mas o último administrador não pode remover a própria permissão.
    await expectError(rpc(w.users.Tecnico, 'update_membership', { p_membership: w.members.Tecnico, p_function: 'dirigente', p_team: null, p_is_admin: false, p_reason: '' }), 'pelo menos um administrador');
    await expectError(rpc(w.users.Tecnico, 'set_membership_status', { p_membership: w.members.Tecnico, p_status: 'saiu', p_reason: 'x' }), 'pelo menos um administrador');
    await rpc(w.users.Tecnico, 'update_membership', { p_membership: w.members.Ana, p_function: 'dirigente', p_team: null, p_is_admin: true, p_reason: 'repor' });
    // Ana (agora não-admin durante o intervalo) não podia gerir membros
    expect((await asUser(w.users.Ana, `select is_admin from public.memberships where id = $1`, [w.members.Ana]))[0].is_admin).toBe(true);
  });
});

describe('isolamento de dados', () => {
  it('membros de outra equipa ou agrupamento não veem pedidos mesmo conhecendo o ID', async () => {
    const req = await validateTrail(w, 'P1', await trailId('fisico-desempenho'));
    const q = `select id from public.trail_requests where id = $1`;
    expect(await asUser(w.users.P1, q, [req])).toHaveLength(1);
    expect(await asUser(w.users.GuiaA, q, [req])).toHaveLength(1);
    expect(await asUser(w.users.Rui, q, [req])).toHaveLength(1);
    expect(await asUser(w.users.P2, q, [req])).toHaveLength(0); // colega de equipa, não guia
    expect(await asUser(w.users.P3, q, [req])).toHaveLength(0);
    expect(await asUser(w.users.GuiaB, q, [req])).toHaveLength(0);
    expect(await asUser(other.users.Ana, q, [req])).toHaveLength(0); // dirigente de outro agrupamento
    expect(await asUser(w.users.Tecnico, q, [req])).toHaveLength(0); // admin técnico sem função pedagógica
    expect(await asUser(other.users.Ana, `select * from public.trail_decisions where request_id = $1`, [req])).toHaveLength(0);
    expect(await asUser(other.users.Ana, `select * from public.memberships where section_id = $1`, [w.section])).toHaveLength(0);
    expect(await asUser(other.users.Ana, `select * from public.profiles where id = $1`, [w.users.P1])).toHaveLength(0);
    await expectError(rpc(other.users.Ana, 'record_council_return', { p_request: req, p_meeting_date: today(), p_comment: 'x' }), 'dirigentes');
    await expectError(rpc(other.users.Ana, 'export_section', { p_section: w.section }), 'dirigentes');
  });

  it('admin técnico gere membros mas não vê nem decide progresso', async () => {
    expect((await asUser(w.users.Tecnico, `select id from public.memberships where section_id = $1`, [w.section])).length).toBeGreaterThan(5);
    await expectError(rpc(w.users.Tecnico, 'record_adhesion', { p_membership: w.members.P2, p_decided_on: today(), p_commitment_on: null, p_notes: null, p_is_historical: false }), 'dirigentes');
    await rpc(w.users.Tecnico, 'set_historical_progress', { p_section: w.section, p_enabled: true });
  });

  it('antigo guia deixa de ver a equipa assim que a função muda', async () => {
    const req = (await admin(`select id from public.trail_requests where membership_id = $1`, [w.members.P1]))[0].id;
    expect(await asUser(w.users.GuiaA, `select id from public.trail_requests where id = $1`, [req])).toHaveLength(1);
    await rpc(w.users.Ana, 'update_membership', { p_membership: w.members.GuiaA, p_function: 'pioneiro', p_team: w.teamA, p_is_admin: false, p_reason: 'Fim de mandato' });
    expect(await asUser(w.users.GuiaA, `select id from public.trail_requests where id = $1`, [req])).toHaveLength(0);
    const hist = await asUser(w.users.Ana, `select old_function, new_function, reason, changed_by from public.membership_history where membership_id = $1 order by changed_at desc limit 1`, [w.members.GuiaA]);
    expect(hist[0]).toMatchObject({ old_function: 'guia', new_function: 'pioneiro', reason: 'Fim de mandato', changed_by: w.users.Ana });
    // Também ao mudar de equipa
    await rpc(w.users.Ana, 'update_membership', { p_membership: w.members.GuiaA, p_function: 'guia', p_team: w.teamB, p_is_admin: false, p_reason: 'Nova equipa' });
    expect(await asUser(w.users.GuiaA, `select id from public.trail_requests where id = $1`, [req])).toHaveLength(0);
    await rpc(w.users.Ana, 'update_membership', { p_membership: w.members.GuiaA, p_function: 'guia', p_team: w.teamA, p_is_admin: false, p_reason: 'Regresso' });
  });

  it('membro suspenso perde o acesso', async () => {
    await expectError(rpc(w.users.Ana, 'set_membership_status', { p_membership: w.members.P2, p_status: 'suspenso', p_reason: '' }), 'motivo');
    await rpc(w.users.Ana, 'set_membership_status', { p_membership: w.members.P2, p_status: 'suspenso', p_reason: 'Teste' });
    expect(await asUser(w.users.P2, `select * from public.teams`)).toHaveLength(0);
    await expectError(rpc(w.users.P2, 'create_trail_request', { p_membership: w.members.P2, p_trail: await trailId('fisico-desempenho'), p_kind: 'normal' }), 'percurso de progresso ativo');
    await rpc(w.users.Ana, 'set_membership_status', { p_membership: w.members.P2, p_status: 'ativo', p_reason: 'Fim da suspensão' });
  });

  it('notificações são privadas', async () => {
    const mine = await asUser(w.users.P1, `select profile_id from public.notifications`);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((n) => n.profile_id === w.users.P1)).toBe(true);
  });
});
