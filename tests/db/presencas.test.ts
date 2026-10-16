// Presenças: permissões, isolamento teste/real, aplicabilidade (data de entrada, equipa e
// saída à data da sessão), sessões futuras/canceladas/por registar fora da taxa, fórmula
// com casos limite, histórico de correções, justificações restritas e uma sessão por atividade.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, buildWorld, createUser, expectDenied, expectError, pool, rpc, setupModule, type World } from './helpers';

let w: World;
const S = () => w.section;
const NOT_FOUND = 'Registo não encontrado';
let TODAY = '';
const day = (offset: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

/** Membro extra (pioneiro) com entrada há `daysAgo` dias (histórico recuado). */
async function addMember(name: string, team: string | null, daysAgo: number, fn = 'pioneiro') {
  const uid = await createUser(`${name} presencas`);
  const id = (await admin(
    `insert into public.memberships (profile_id, section_id, status, function, team_id, approved_at)
     values ($1, $2, 'ativo', $3, $4, now() - make_interval(days => $5)) returning id`,
    [uid, S(), fn, team, daysAgo],
  ))[0].id as string;
  await admin(`update public.membership_history set changed_at = now() - make_interval(days => $2) where membership_id = $1`, [id, daysAgo]);
  w.users[name] = uid;
  w.members[name] = id;
  return id;
}

/** Altera o membro (como a administração faria) com a data do histórico recuada. */
async function changeMember(name: string, set: string, daysAgo: number) {
  await admin(`update public.memberships set ${set} where id = $1`, [w.members[name]]);
  await admin(
    `update public.membership_history set changed_at = now() - make_interval(days => $2)
      where id = (select max(id) from public.membership_history where membership_id = $1)`,
    [w.members[name], daysAgo],
  );
}

const session = (who: string, extra: Record<string, unknown> = {}) =>
  rpc<string>(w.users[who], 'pres_session_save', {
    p_section: S(), p_session: null, p_cal_event: null, p_date: day(-1), p_title: 'Reunião de secção', p_kind: 'reuniao',
    p_team: null, p_notes: null, ...extra,
  });
const record = (who: string, sessionId: string, names: string[], status: string, extra: Record<string, unknown> = {}) =>
  rpc<number>(w.users[who], 'pres_record', {
    p_section: S(), p_session: sessionId, p_memberships: names.map((n) => w.members[n]), p_status: status, ...extra,
  });
const board = (who: string, from = day(-200), to = day(60), team: string | null = null) =>
  rpc<any>(w.users[who], 'pres_board', { p_section: S(), p_from: from, p_to: to, p_team: team });
const member = (who: string, name: string, from = day(-200), to = day(60)) =>
  rpc<any>(w.users[who], 'pres_member', { p_section: S(), p_membership: w.members[name], p_from: from, p_to: to });
const sess = (who: string, id: string) => rpc<any>(w.users[who], 'pres_session', { p_section: S(), p_session: id });
const calEvent = async (space: string, start: string, end = start, extra = '') =>
  (await admin(
    `insert into public.cal_events (section_id, space, title, all_day, start_date, end_date, created_by ${extra ? ', audience, team_id' : ''})
     values ($1, $2, 'Raide de outono', true, $3, $4, $5 ${extra ? ', $6, $7' : ''}) returning id`,
    extra ? [S(), space, start, end, w.users.Ana, 'equipa', extra] : [S(), space, start, end, w.users.Ana],
  ))[0].id as string;

beforeAll(async () => {
  w = await buildWorld('presencas');
  TODAY = (await admin(`select (now() at time zone 'Europe/Lisbon')::date::text as d`))[0].d;
  // Todos os membros entraram há mais de um ano.
  await admin(`update public.membership_history set changed_at = changed_at - interval '400 days' where section_id = $1`, [S()]);
  await admin(`update public.memberships set approved_at = approved_at - interval '400 days' where section_id = $1`, [S()]);
  // Testers: todos menos P2 (sem acesso). GuiaA tem «presencas.registar»; Tecnico (admin sem função) não.
  await setupModule(w, 'presencas', 'teste', ['Ana', 'Rui', 'Tecnico', 'GuiaA', 'GuiaB', 'P1', 'P3'], [['presencas.registar', 'GuiaA']]);
});
afterAll(() => pool.end());

describe('acesso e permissões', () => {
  it('membro sem acesso é recusado em tudo', async () => {
    await expectDenied(board('P2'));
    await expectDenied(member('P2', 'P2'));
    await expectDenied(rpc(w.users.P2, 'pres_event_options', { p_section: S() }));
    await expectDenied(session('P2'));
  });

  it('só dirigentes ou quem tem «presencas.registar» criam sessões e registam', async () => {
    await expectDenied(session('P1'), 'permissão');
    await expectDenied(session('Tecnico'), 'permissão');
    await expectDenied(session('GuiaB'), 'permissão');
    const s1 = await session('Rui');
    const s2 = await session('GuiaA', { p_title: 'Outra reunião' });
    expect(s1).toBeTruthy();
    await expectDenied(record('P1', s1, ['P1'], 'presente'), 'permissão');
    await expectDenied(record('Tecnico', s1, ['P1'], 'presente'), 'permissão');
    expect(await record('GuiaA', s2, ['P1'], 'presente')).toBe(1);
    await expectDenied(rpc(w.users.P1, 'pres_session_cancel', { p_section: S(), p_session: s1, p_cancel: true, p_reason: null }), 'permissão');
    await rpc(w.users.Rui, 'pres_session_cancel', { p_section: S(), p_session: s1, p_cancel: true, p_reason: 'Duplicada' });
    await rpc(w.users.Rui, 'pres_session_cancel', { p_section: S(), p_session: s2, p_cancel: true, p_reason: 'Teste de permissões' });
  });

  it('quem não regista vê só as próprias presenças', async () => {
    const b = await board('P1');
    expect(b.can_register).toBe(false);
    expect(b.members.map((m: any) => m.membership_id)).toEqual([w.members.P1]);
    expect(new Set(b.cells.map((c: any) => c.m))).toEqual(new Set([w.members.P1]));
    expect(b.by_team).toEqual([]);
    await expectError(member('P1', 'P3'), NOT_FOUND);
    await expectError(member('GuiaB', 'P3'), NOT_FOUND);
    const mine = await member('P1', 'P1');
    expect(mine.is_self).toBe(true);
  });
});

describe('aplicabilidade e fórmula', () => {
  let sOld: string, sRecent: string, sTeamA: string, sTeamB: string, sFuture: string, sCancel: string;

  beforeAll(async () => {
    await addMember('Novo', w.teamA, 1);            // entrou ontem
    await addMember('Mudou', w.teamA, 300);         // mudou da equipa A para a B há 20 dias
    await changeMember('Mudou', `team_id = '${w.teamB}'`, 20);
    await addMember('Saiu', w.teamB, 300);          // saiu há 5 dias
    await changeMember('Saiu', `status = 'saiu'`, 5);
    await addMember('Promovido', w.teamB, 300);     // pioneiro que passou a dirigente há 10 dias
    await changeMember('Promovido', `function = 'dirigente', team_id = null`, 10);
    sOld = await session('Ana', { p_date: day(-30), p_title: 'Reunião há 30 dias' });
    sRecent = await session('Ana', { p_date: day(-2), p_title: 'Reunião há 2 dias' });
    sTeamA = await session('Ana', { p_date: day(-25), p_title: 'Equipa A há 25 dias', p_team: w.teamA });
    sTeamB = await session('Ana', { p_date: day(-8), p_title: 'Equipa B há 8 dias', p_team: w.teamB });
    sFuture = await session('Ana', { p_date: day(7), p_title: 'Reunião futura' });
    sCancel = await session('Ana', { p_date: day(-15), p_title: 'Reunião cancelada' });
  });

  const who = async (id: string) => {
    const d = await sess('Ana', id);
    return d.members.map((m: any) => m.name.split(' ')[0]).sort();
  };

  it('conta só pioneiros e guias ativos à data da sessão (data de entrada, saída e função)', async () => {
    expect(await who(sOld)).toEqual(['GuiaA', 'GuiaB', 'Mudou', 'P1', 'P2', 'P3', 'Promovido', 'Saiu']);
    // Novo ainda não tinha entrado; Saiu ainda não tinha saído; Promovido já é dirigente.
    expect(await who(sRecent)).toEqual(['GuiaA', 'GuiaB', 'Mudou', 'P1', 'P2', 'P3']);
    // Entrada registada na aplicação só ontem, mas com adesão decidida há 60 dias: conta desde a adesão.
    await addMember('Adesao', null, 1);
    await admin(`insert into public.adhesions (membership_id, decided_on, recorded_by) values ($1, $2, $3)`, [w.members.Adesao, day(-60), w.users.Ana]);
    expect(await who(sOld)).toContain('Adesao');
    expect((await member('Ana', 'Adesao')).member.entry_date).toBe(day(-60));
    const today = await session('Ana', { p_date: day(0), p_title: 'Reunião de hoje' });
    expect(await who(today)).toContain('Novo');
    expect(await who(today)).not.toContain('Saiu');
  });

  it('sessões de equipa contam a equipa à data da sessão', async () => {
    expect(await who(sTeamA)).toEqual(['GuiaA', 'Mudou', 'P1', 'P2']);
    expect(await who(sTeamB)).toEqual(['GuiaB', 'Mudou', 'P3', 'Saiu']);
  });

  it('não regista quem não conta na sessão', async () => {
    await expectError(record('Ana', sRecent, ['Novo'], 'presente'), 'não contam');
    await expectError(record('Ana', sRecent, ['Rui'], 'presente'), 'não contam');
    await expectError(record('Ana', sTeamA, ['P3'], 'presente'), 'não contam');
    await expectError(record('Ana', sRecent, [], 'presente'), 'Seleciona pelo menos uma pessoa');
  });

  it('registo rápido só altera as pessoas selecionadas', async () => {
    expect(await record('GuiaA', sOld, ['P1', 'P2'], 'presente')).toBe(2);
    const d = await sess('Ana', sOld);
    const st = Object.fromEntries(d.members.map((m: any) => [m.name.split(' ')[0], m.category]));
    expect(st.P1).toBe('presente');
    expect(st.P3).toBe('por_registar');
    expect(st.GuiaA).toBe('por_registar');
  });

  it('futuras, canceladas e por registar não contam; parcial conta como presença', async () => {
    // P3: presente (parcial) há 30 dias, falta justificada há 8 dias (equipa B), injustificada há 2 dias.
    await record('Ana', sOld, ['P3'], 'presente', { p_partial: true, p_partial_note: 'Saiu às 16h' });
    await record('Ana', sTeamB, ['P3'], 'justificada', { p_justification: 'Doença' });
    await record('Ana', sRecent, ['P3'], 'injustificada');
    // Presente numa sessão que depois é cancelada: não conta.
    await record('Ana', sCancel, ['P3'], 'presente');
    await rpc(w.users.Ana, 'pres_session_cancel', { p_section: S(), p_session: sCancel, p_cancel: true, p_reason: 'Chuva' });
    // Falta justificada antecipada numa sessão futura: não conta ainda.
    await record('Ana', sFuture, ['P3'], 'justificada', { p_justification: 'Viagem' });
    await expectError(record('Ana', sFuture, ['P3'], 'presente'), 'ainda não aconteceu');
    await expectError(record('Ana', sCancel, ['P3'], 'presente'), 'cancelada');

    const m = await member('Ana', 'P3');
    expect(m.stats).toMatchObject({ presencas: 1, parciais: 1, justificadas: 1, injustificadas: 1, faltas: 2, contadas: 3, futuras: 1 });
    expect(m.stats.canceladas).toBeGreaterThanOrEqual(1);
    expect(Number(m.stats.taxa)).toBeCloseTo(33.3, 1);
    expect(m.stats.por_registar).toBeGreaterThanOrEqual(0);
    // P2: só uma presença registada (as outras sessões passadas estão por registar) → 100 %.
    const p2 = (await board('Ana')).members.find((x: any) => x.membership_id === w.members.P2);
    expect(p2.stats.presencas).toBe(1);
    expect(p2.stats.por_registar).toBeGreaterThan(0);
    expect(Number(p2.stats.taxa)).toBe(100);
  });

  it('sem registos contados a taxa fica vazia (nunca 0 %)', async () => {
    const b = await board('Ana');
    const guiaB = b.members.find((x: any) => x.membership_id === w.members.GuiaB);
    expect(guiaB.stats.contadas).toBe(0);
    expect(guiaB.stats.taxa).toBeNull();
    const novo = b.members.find((x: any) => x.membership_id === w.members.Novo);
    expect(novo.stats.taxa).toBeNull();
    // Só faltas → 0 %, que é diferente de «sem dados».
    await record('Ana', sRecent, ['GuiaB'], 'injustificada');
    const g2 = (await member('Ana', 'GuiaB')).stats;
    expect(Number(g2.taxa)).toBe(0);
    await record('Ana', sRecent, ['GuiaB'], 'por_registar', { p_reason: 'Registo por engano' });
    expect((await member('Ana', 'GuiaB')).stats.taxa).toBeNull();
  });

  it('atividade cancelada no Calendário cancela a sessão ligada', async () => {
    const ev = await calEvent('teste', day(-4));
    const s = await session('Ana', { p_cal_event: ev, p_date: null, p_title: null, p_kind: null });
    await record('Ana', s, ['P1'], 'presente');
    const before = (await member('Ana', 'P1')).stats.presencas;
    await admin(`update public.cal_events set status = 'cancelado' where id = $1`, [ev]);
    expect((await member('Ana', 'P1')).stats.presencas).toBe(before - 1);
    expect((await sess('Ana', s)).session.effective_status).toBe('cancelada');
  });

  it('resumos por equipa e por mês, sem ordenação por taxa', async () => {
    const b = await board('Ana');
    expect(b.by_team.map((t: any) => t.team_name)).toEqual(['Equipa A', 'Equipa B', null]); // «Sem equipa» no fim
    expect(b.by_month.length).toBeGreaterThan(0);
    const teams = b.members.map((m: any) => m.team_name ?? 'zzz');
    expect(teams).toEqual([...teams].sort());
    const inA = b.members.filter((m: any) => m.team_name === 'Equipa A').map((m: any) => m.name);
    expect(inA).toEqual([...inA].sort());
    // Filtro por equipa: só membros e sessões dessa equipa (e de secção).
    const a = await board('Ana', day(-200), day(60), w.teamA);
    expect(a.sessions.some((s: any) => s.id === sTeamB)).toBe(false);
    expect(a.cells.every((c: any) => c.m !== w.members.P3)).toBe(true);
  });

  it('a data e o público não mudam depois de haver registos', async () => {
    await expectError(rpc(w.users.Ana, 'pres_session_save', {
      p_section: S(), p_session: sOld, p_cal_event: null, p_date: day(-31), p_title: 'Reunião há 30 dias', p_kind: 'reuniao', p_team: null, p_notes: null,
    }), 'não é possível mudar a data');
    await rpc(w.users.Ana, 'pres_session_save', {
      p_section: S(), p_session: sOld, p_cal_event: null, p_date: day(-30), p_title: 'Reunião de secção (corrigido)', p_kind: 'reuniao', p_team: null, p_notes: 'Sede',
    });
  });

  it('histórico de correções e justificações restritas', async () => {
    await record('Ana', sRecent, ['P1'], 'injustificada');
    await record('GuiaA', sRecent, ['P1'], 'justificada', { p_justification: 'Consulta médica', p_reason: 'Encarregado avisou' });
    await record('Rui', sRecent, ['P1'], 'presente', { p_reason: 'Chegou mais tarde' });
    const d = await sess('Ana', sRecent);
    const h = d.history.filter((x: any) => x.membership_id === w.members.P1);
    expect(h.map((x: any) => x.new_status)).toEqual(['presente', 'justificada', 'injustificada']);
    expect(h[0]).toMatchObject({ old_status: 'justificada', reason: 'Chegou mais tarde', justification_changed: true });
    expect(h[0].changed_by_name).toMatch(/^Rui/);
    // A justificação foi retirada com «presente», mas fica no histórico (nunca se apaga).
    const raw = await admin(`select count(*)::int as n from public.pres_record_history where session_id = $1 and new_justification = 'Consulta médica'`, [sRecent]);
    expect(raw[0].n).toBe(1);

    // Justificação de P3 (equipa B): visível para quem regista e para o próprio; não para outros.
    const forReg = (await sess('Ana', sTeamB)).members.find((m: any) => m.membership_id === w.members.P3);
    expect(forReg.justification).toBe('Doença');
    const own = await member('P3', 'P3');
    expect(own.entries.find((e: any) => e.session_id === sTeamB).justification).toBe('Doença');
    const p1view = await sess('P1', sOld);
    expect(p1view.members.map((m: any) => m.membership_id)).toEqual([w.members.P1]);
    expect(p1view.history).toEqual([]);
    expect(JSON.stringify(await board('P1'))).not.toContain('Doença');
    await expectError(sess('P1', sTeamB), NOT_FOUND);
    // No quadro, mesmo quem regista só recebe a indicação (não o texto).
    expect(JSON.stringify(await board('Ana'))).not.toContain('Doença');
    // Justificação só em faltas; parcial só com presente.
    await expectError(record('Ana', sRecent, ['P2'], 'presente', { p_justification: 'x' }), 'só se indica numa falta');
    await expectError(record('Ana', sRecent, ['P2'], 'injustificada', { p_partial: true }), 'parcial');
  });

  it('justificação mantém-se quando não é indicada e apaga-se com texto vazio', async () => {
    await record('Ana', sTeamB, ['P3'], 'injustificada', { p_reason: 'Afinal não avisou' });
    let r = (await sess('Ana', sTeamB)).members.find((m: any) => m.membership_id === w.members.P3);
    expect(r).toMatchObject({ status: 'injustificada', justification: 'Doença' });
    await record('Ana', sTeamB, ['P3'], 'justificada', { p_justification: '' });
    r = (await sess('Ana', sTeamB)).members.find((m: any) => m.membership_id === w.members.P3);
    expect(r.justification).toBeNull();
  });
});

describe('Calendário e espaços', () => {
  it('uma atividade só tem uma sessão; opções sem duplicados', async () => {
    const ev = await calEvent('teste', day(-12), day(-11), w.teamB);
    let opts = await rpc<any[]>(w.users.GuiaA, 'pres_event_options', { p_section: S() });
    expect(opts.some((o) => o.id === ev)).toBe(true);
    const s = await session('GuiaA', { p_cal_event: ev, p_date: null, p_title: null, p_kind: null });
    const d = await sess('GuiaA', s);
    expect(d.session).toMatchObject({ title: 'Raide de outono', kind: 'atividade', audience: 'equipa', team_id: w.teamB, date: day(-12) });
    await expectError(session('Rui', { p_cal_event: ev, p_date: day(-11), p_title: null, p_kind: null }), 'já tem uma sessão');
    await expectError(session('Rui', { p_cal_event: await calEvent('teste', day(-3)), p_date: day(-10) }), 'dentro das datas');
    opts = await rpc<any[]>(w.users.GuiaA, 'pres_event_options', { p_section: S() });
    expect(opts.some((o) => o.id === ev)).toBe(false);
  });

  it('não liga atividades de outro espaço nem de outra secção', async () => {
    const real = await calEvent('real', day(-6));
    await expectError(session('Ana', { p_cal_event: real }), 'não encontrada neste espaço');
    const opts = await rpc<any[]>(w.users.Ana, 'pres_event_options', { p_section: S() });
    expect(opts.some((o) => o.id === real)).toBe(false);
  });

  it('isolamento teste/real: o espaço real começa vazio e não vê os dados de teste', async () => {
    const testSessions = (await board('Ana')).sessions.length;
    expect(testSessions).toBeGreaterThan(0);
    const anyTest = (await board('Ana')).sessions[0].id;
    await rpc(w.users.Ana, 'set_module_status', { p_section: S(), p_module: 'presencas', p_status: 'disponivel' });
    const real = await board('Ana');
    expect(real.sessions).toEqual([]);
    expect(real.cells).toEqual([]);
    await expectError(sess('Ana', anyTest), NOT_FOUND);
    await expectError(record('Ana', anyTest, ['P1'], 'presente'), NOT_FOUND);
    // P2 (sem ser tester) passa a ter acesso no espaço real, só às suas presenças.
    const p2 = await board('P2');
    expect(p2.can_register).toBe(false);
    // Voltar a teste: os dados de teste continuam lá (nada se apaga).
    await rpc(w.users.Ana, 'set_module_status', { p_section: S(), p_module: 'presencas', p_status: 'teste' });
    expect((await board('Ana')).sessions.length).toBe(testSessions);
  });

  it('ao publicar com os dados de teste, ligações a atividades de teste são retiradas', async () => {
    const ev = await calEvent('teste', day(-9));
    const s = await session('Ana', { p_cal_event: ev, p_date: null, p_title: null, p_kind: null });
    await rpc(w.users.Ana, 'set_module_status', { p_section: S(), p_module: 'presencas', p_status: 'disponivel', p_move_test_data: true });
    const row = (await admin(`select space, cal_event_id from public.pres_sessions where id = $1`, [s]))[0];
    expect(row).toEqual({ space: 'real', cal_event_id: null });
    const h = await admin(`select count(*)::int as n from public.pres_record_history where section_id = $1 and space = 'teste'`, [S()]);
    expect(h[0].n).toBe(0);
  });
});
