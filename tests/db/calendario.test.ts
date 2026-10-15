// Calendário escutista: acesso, espaço de teste, respostas, prazos, pendências,
// lembretes, notificações e horas em Europe/Lisbon (mudança de hora a 25/10/2026).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, buildWorld, expectDenied, pool, rpc, setupModule, type World } from './helpers';

let w: World;
const S = () => w.section;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const H = 3600e3;
const D = 86400e3;
const day = (ms: number) => iso(ms).slice(0, 10);

const create = (who: string, data: Record<string, unknown>) =>
  rpc<string>(w.users[who], 'cal_create_event', { p_section: S(), p_data: data });
const timed = (title: string, startMs: number, extra: Record<string, unknown> = {}) =>
  ({ title, all_day: false, starts_at: iso(startMs), ends_at: iso(startMs + 2 * H), ...extra });
const get = (who: string, id: string) => rpc<any>(w.users[who], 'cal_event_get', { p_section: S(), p_event: id });
const list = (who: string, from = day(-D), to = day(60 * D)) =>
  rpc<any[]>(w.users[who], 'cal_events_list', { p_section: S(), p_from: from, p_to: to });
const respond = (who: string, id: string, response: string, note: string | null = null, profile: string | null = null) =>
  rpc(w.users[who], 'cal_respond', { p_section: S(), p_event: id, p_response: response, p_note: note, p_profile: profile ? w.users[profile] : null });
const reminders = (id: string, who?: string) =>
  admin<{ kind: string; due_at: Date; sent_at: Date | null; cancelled_at: Date | null; profile_id: string }>(
    `select kind, due_at, sent_at, cancelled_at, profile_id from public.module_reminders where entity = 'cal_event' and entity_id = $1
       and ($2::uuid is null or profile_id = $2) order by kind`, [id, who ? w.users[who] : null]);
const active = <T extends { cancelled_at: Date | null; sent_at: Date | null }>(rows: T[]) => rows.filter((r) => !r.cancelled_at && !r.sent_at);

beforeAll(async () => {
  w = await buildWorld('cal');
  // Testers: Rui (dirigente), Tecnico (admin técnico com «calendario.gerir»), GuiaA, P1, P2. P3 e Ana sem acesso.
  await setupModule(w, 'calendario', 'teste', ['Rui', 'Tecnico', 'GuiaA', 'P1', 'P2'], [['calendario.gerir', 'Tecnico']]);
});
afterAll(() => pool.end());

describe('acesso e permissões', () => {
  it('administração sem ser tester e membro sem acesso são recusados', async () => {
    await expectDenied(list('Ana'), 'não está disponível');
    await expectDenied(list('P3'), 'não está disponível');
    await expectDenied(create('Ana', timed('X', 5 * D)), 'não está disponível');
    await expectDenied(rpc(w.users.P3, 'cal_event_options', { p_section: S() }), 'não está disponível');
  });

  it('tester só consulta vê, mas não cria; tester editor (permissão) e dirigente gerem', async () => {
    expect(await list('P1')).toEqual([]);
    await expectDenied(create('P1', timed('X', 5 * D)), 'permissão');
    await expectDenied(create('GuiaA', timed('X', 5 * D)), 'permissão');
    const a = await create('Tecnico', timed('Reunião de secção', 5 * D, { location: 'Sede' }));
    const b = await create('Rui', { title: 'Acampamento', all_day: true, start_date: day(20 * D), end_date: day(22 * D) });
    const l = await list('P1');
    expect(l.map((e) => e.id)).toEqual([a, b]);
    expect(l[0]).toMatchObject({ title: 'Reunião de secção', location: 'Sede', involved: true, my_response: null });
    expect((await get('P1', a)).can_manage).toBe(false);
    expect((await get('Tecnico', a)).can_manage).toBe(true);
    await expectDenied(rpc(w.users.P1, 'cal_update_event', { p_section: S(), p_event: a, p_data: timed('Y', 5 * D) }), 'permissão');
    await expectDenied(rpc(w.users.P1, 'cal_cancel_event', { p_section: S(), p_event: a, p_reason: null }), 'permissão');
    await expectDenied(rpc(w.users.P1, 'cal_form_options', { p_section: S() }), 'permissão');
    const opts = await rpc<any>(w.users.Tecnico, 'cal_form_options', { p_section: S() });
    expect(opts.teams.map((t: any) => t.name)).toEqual(['Equipa A', 'Equipa B']);
  });

  it('validações claras', async () => {
    await expectDenied(create('Rui', timed('', 5 * D)), 'título');
    await expectDenied(create('Rui', { title: 'X', all_day: false, starts_at: iso(5 * D), ends_at: iso(4 * D) }), 'fim não pode ser antes');
    await expectDenied(create('Rui', { title: 'X', all_day: true, start_date: day(5 * D), end_date: day(3 * D) }), 'fim não pode ser antes');
    await expectDenied(create('Rui', timed('X', 5 * D, { registration_deadline: iso(6 * D) })), 'prazo de inscrição');
    await expectDenied(create('Rui', timed('X', 5 * D, { audience: 'equipa' })), 'Escolhe a equipa');
    await expectDenied(create('Rui', timed('X', 5 * D, { reminder_minutes: [1] })), 'lembretes');
    await expectDenied(create('Rui', timed('X', 5 * D, { responsible_id: '00000000-0000-0000-0000-000000000001' })), 'responsável');
  });
});

describe('respostas (Vou / Não vou / Por confirmar) e prazo', () => {
  it('cada participante altera só a própria resposta e nota; gestores podem responder por outros', async () => {
    const id = await create('Rui', timed('Raid', 7 * D));
    await respond('P1', id, 'vou', 'Levo a tenda');
    await expectDenied(respond('P2', id, 'nao_vou', null, 'P1'), 'própria resposta');
    await expectDenied(respond('P3', id, 'vou'), 'não está disponível');
    await expectDenied(respond('P1', id, 'talvez'), 'Resposta inválida');
    await respond('Rui', id, 'por_confirmar', 'nota do dirigente', 'P1');
    const g = await get('P1', id);
    expect(g.me).toMatchObject({ response: 'por_confirmar', note: 'Levo a tenda' });
    // Notas de outras pessoas não aparecem a participantes; aparecem a quem gere
    const p1asP2 = (await get('P2', id)).participants.find((p: any) => p.profile_id === w.users.P1);
    expect(p1asP2).toMatchObject({ response: 'por_confirmar', note: null, missing: null });
    expect((await get('Rui', id)).participants.find((p: any) => p.profile_id === w.users.P1).note).toBe('Levo a tenda');
    expect((await list('P1')).find((e) => e.id === id).counts).toMatchObject({ por_confirmar: 1, vou: 0 });
  });

  it('atividade de equipa: só o público (ou quem gere) responde', async () => {
    const id = await create('Rui', timed('Reunião Equipa B', 8 * D, { audience: 'equipa', team_id: w.teamB }));
    await expectDenied(respond('P1', id, 'vou'), 'só para a equipa');
    await respond('Rui', id, 'vou'); // dirigente acompanha (participante extra)
    const names = (await get('Rui', id)).participants.map((p: any) => p.profile_id);
    expect(names).toContain(w.users.Rui);
    expect(names).toContain(w.users.P3);
    expect(names).not.toContain(w.users.P1);
  });

  it('inscrição após o prazo recusada, exceto a gestores', async () => {
    const id = await create('Rui', timed('Jogo noturno', 3 * D, { registration_deadline: iso(-H) }));
    await expectDenied(respond('P1', id, 'vou'), 'prazo de inscrição terminou');
    expect((await get('P1', id)).can_respond).toBe(false);
    await respond('Tecnico', id, 'vou', null, 'P2');
    expect((await get('P2', id)).me.response).toBe('vou');
  });

  it('atividade cancelada não aceita respostas nem alterações', async () => {
    const id = await create('Rui', timed('Caminhada', 9 * D));
    await rpc(w.users.Rui, 'cal_cancel_event', { p_section: S(), p_event: id, p_reason: 'Mau tempo' });
    await expectDenied(respond('P1', id, 'vou'), 'cancelada');
    await expectDenied(respond('Rui', id, 'vou', null, 'P1'), 'cancelada');
    await expectDenied(rpc(w.users.Rui, 'cal_update_event', { p_section: S(), p_event: id, p_data: timed('Caminhada', 9 * D) }), 'cancelada');
    await expectDenied(rpc(w.users.Rui, 'cal_cancel_event', { p_section: S(), p_event: id, p_reason: null }), 'já está cancelada');
    expect((await get('P1', id))).toMatchObject({ status: 'cancelado', cancel_reason: 'Mau tempo', can_respond: false });
  });
});

describe('pendências e «O que falta»', () => {
  it('cada pessoa vê o que lhe falta; gestores marcam por participante', async () => {
    const id = await create('Rui', timed('Atividade regional', 12 * D, {
      needs_authorization: true, needs_payment: true, material: 'Saco-cama; lanterna',
    }));
    const mine = async (who: string) => (await rpc<any[]>(w.users[who], 'cal_my_pending', { p_section: S() })).find((e) => e.id === id)?.missing;
    expect(await mine('P1')).toEqual(['resposta', 'autorizacao', 'pagamento', 'material']);
    await respond('P1', id, 'vou');
    expect(await mine('P1')).toEqual(['autorizacao', 'pagamento', 'material']);
    const setP = (who: string, item: string, done: boolean, target = 'P1') =>
      rpc(w.users[who], 'cal_set_pending', { p_section: S(), p_event: id, p_profile: w.users[target], p_item: item, p_done: done });
    await expectDenied(setP('P1', 'autorizacao', true), 'permissão');
    await expectDenied(setP('Tecnico', 'inscricao', true), 'não exige');
    await setP('Tecnico', 'autorizacao', true);
    await setP('Rui', 'pagamento', true);
    expect(await mine('P1')).toEqual(['material']);
    await setP('Rui', 'pagamento', false); // desmarcar volta a faltar
    expect(await mine('P1')).toEqual(['pagamento', 'material']);
    const asRui = (await get('Rui', id)).participants.find((p: any) => p.profile_id === w.users.P1);
    expect(asRui.missing).toEqual(['pagamento', 'material']);
    // Quem responde «Não vou» deixa de ter pendências
    await respond('P2', id, 'nao_vou');
    expect(await mine('P2')).toBeUndefined();
    const audit = await admin(`select count(*)::int as n from public.audit_log where entity_id = $1 and action = 'cal_pendencia'`, [id]);
    expect(audit[0].n).toBe(3);
  });
});

describe('lembretes', () => {
  it('agendados por pessoa, sem duplicados, reagendados, removidos e cancelados', async () => {
    const start = 3 * D;
    const first = timed('Fogo de conselho', start, {
      reminder_minutes: [1440, 60], registration_deadline: iso(2 * D), deadline_reminder_minutes: [1440],
    });
    const id = await create('Rui', first);
    let r = active(await reminders(id, 'P1'));
    expect(r.map((x) => x.kind)).toEqual(['antes_1440', 'antes_60', 'prazo_1440']);
    expect(r[1].due_at.getTime()).toBe(Date.parse(first.starts_at as string) - H);
    const total = (await reminders(id)).length;
    // Alterar a mesma atividade não duplica; reagenda para o novo início
    const data = timed('Fogo de conselho', start + D, { reminder_minutes: [1440, 60], registration_deadline: iso(2 * D), deadline_reminder_minutes: [1440] });
    await rpc(w.users.Rui, 'cal_update_event', { p_section: S(), p_event: id, p_data: data });
    await rpc(w.users.Rui, 'cal_update_event', { p_section: S(), p_event: id, p_data: data });
    expect((await reminders(id)).length).toBe(total);
    r = active(await reminders(id, 'P1'));
    expect(Math.abs(r[1].due_at.getTime() - (Date.parse(data.starts_at as string) - H))).toBeLessThan(1000);
    // Responder «Vou» sem pendências: deixa de receber o lembrete do prazo
    await respond('P1', id, 'vou');
    expect(active(await reminders(id, 'P1')).map((x) => x.kind)).toEqual(['antes_1440', 'antes_60']);
    // «Não vou»: sem lembretes
    await respond('P2', id, 'nao_vou');
    expect(active(await reminders(id, 'P2'))).toEqual([]);
    // Retirar um tipo de lembrete remove-o
    await rpc(w.users.Rui, 'cal_update_event', { p_section: S(), p_event: id, p_data: { ...data, reminder_minutes: [60] } });
    expect(active(await reminders(id, 'P1')).map((x) => x.kind)).toEqual(['antes_60']);
    // Cancelar a atividade cancela todos
    await rpc(w.users.Rui, 'cal_cancel_event', { p_section: S(), p_event: id, p_reason: null });
    expect(active(await reminders(id))).toEqual([]);
  });

  it('lembretes vencidos chegam só a testers, uma vez, com [Teste]', async () => {
    const id = await create('Rui', timed('Hike', 2 * D, { reminder_minutes: [60] }));
    await admin(`update public.module_reminders set due_at = now() - interval '1 minute' where entity_id = $1`, [id]);
    await admin(`delete from public.notifications where section_id = $1 and kind = 'lembrete'`, [S()]);
    await admin(`select private.process_due_reminders()`);
    await admin(`select private.process_due_reminders()`);
    const n = await admin(`select profile_id, title from public.notifications where section_id = $1 and kind = 'lembrete'`, [S()]);
    const who = n.map((x) => x.profile_id);
    expect(who).toContain(w.users.P1);
    expect(who).not.toContain(w.users.P3);
    expect(who).not.toContain(w.users.Ana);
    expect(new Set(who).size).toBe(who.length);
    expect(n.every((x) => x.title === '[Teste] Lembrete: Hike')).toBe(true);
  });
});

describe('notificações de alteração e cancelamento', () => {
  it('no espaço de teste só os testers envolvidos recebem; equipa recebe o que é da equipa', async () => {
    const id = await create('Rui', timed('Reunião Equipa A', 6 * D, { audience: 'equipa', team_id: w.teamA, responsible_id: w.users.Tecnico }));
    await admin(`delete from public.notifications where section_id = $1`, [S()]);
    await rpc(w.users.Rui, 'cal_update_event', { p_section: S(), p_event: id,
      p_data: timed('Reunião Equipa A', 6 * D + H, { audience: 'equipa', team_id: w.teamA, responsible_id: w.users.Tecnico, location: 'Sede' }) });
    let n = await admin(`select profile_id, title, link from public.notifications where section_id = $1 and kind = 'cal_evento_alterado'`, [S()]);
    expect(n.map((x) => x.profile_id).sort()).toEqual([w.users.GuiaA, w.users.P1, w.users.P2, w.users.Tecnico].sort());
    expect(n[0].title).toBe('[Teste] Atividade alterada: Reunião Equipa A');
    expect(n[0].link).toBe(`/calendario/evento/${id}`);
    await rpc(w.users.Tecnico, 'cal_cancel_event', { p_section: S(), p_event: id, p_reason: 'Sem sala' });
    n = await admin(`select profile_id from public.notifications where section_id = $1 and kind = 'cal_evento_cancelado'`, [S()]);
    expect(n.map((x) => x.profile_id).sort()).toEqual([w.users.GuiaA, w.users.P1, w.users.P2].sort()); // quem cancelou não recebe
  });
});

describe('horas em Europe/Lisbon (mudança de hora a 25/10/2026)', () => {
  it('«1 dia antes» mantém a hora de parede; dias inteiros às 09:00', async () => {
    const before = async (ref: string, m: number) =>
      new Date((await admin(`select private.cal_before($1::timestamptz, $2) as t`, [ref, m]))[0].t).toISOString();
    // 25/10 10:00 em Lisboa (WET, UTC+0) → 24/10 10:00 em Lisboa (WEST, UTC+1)
    expect(await before('2026-10-25T10:00:00Z', 1440)).toBe('2026-10-24T09:00:00.000Z');
    expect(await before('2026-10-25T10:00:00Z', 60)).toBe('2026-10-25T09:00:00.000Z');
    // Primavera: 29/03/2026
    expect(await before('2026-03-29T10:00:00Z', 1440)).toBe('2026-03-28T11:00:00.000Z'); // 11:00 WEST → 11:00 WET
  });

  it('dias em Lisboa e lembretes à volta da mudança de hora', async () => {
    const late = await create('Rui', { title: 'Vigília', all_day: false, starts_at: '2026-10-24T22:00:00Z', ends_at: '2026-10-24T22:50:00Z' }); // 23:00–23:50 de 24/10 (WEST)
    const night = await create('Rui', { title: 'Noite longa', all_day: false, starts_at: '2026-10-25T01:30:00Z', ends_at: '2026-10-25T03:00:00Z', reminder_minutes: [1440] });
    const allDay = await create('Rui', { title: 'Dia do agrupamento', all_day: true, start_date: '2026-10-25', end_date: '2026-10-25', reminder_minutes: [1440] });
    const on25 = (await list('P1', '2026-10-25', '2026-10-25')).map((e) => e.id);
    expect(on25).toContain(night);
    expect(on25).toContain(allDay);
    expect(on25).not.toContain(late);
    expect((await list('P1', '2026-10-24', '2026-10-24')).map((e) => e.id)).toContain(late);
    const g = await get('P1', allDay);
    expect(g).toMatchObject({ all_day: true, start_date: '2026-10-25', end_date: '2026-10-25', starts_at: null });
    if (Date.now() < Date.parse('2026-10-24T08:00:00Z')) {
      const rn = active(await reminders(night, 'P1'));
      expect(rn.map((r) => r.due_at.toISOString())).toEqual(['2026-10-24T00:30:00.000Z']); // 01:30 WET → 01:30 WEST da véspera
      const ra = active(await reminders(allDay, 'P1'));
      expect(ra.map((r) => r.due_at.toISOString())).toEqual(['2026-10-24T08:00:00.000Z']); // 09:00 de 24/10 (WEST)
    }
  });
});

describe('isolamento teste/real e contrato para outros módulos', () => {
  it('cal_event_options: id, título, datas e estado; acesso pelo módulo que chama', async () => {
    const opts = await rpc<any[]>(w.users.P1, 'cal_event_options', { p_section: S() });
    expect(opts.length).toBeGreaterThan(0);
    expect(Object.keys(opts[0]).sort()).toEqual(['all_day', 'end_date', 'ends_at', 'id', 'start_date', 'starts_at', 'status', 'title']);
    // P3 sem acesso ao calendário, mas tester do Inventário: vê as atividades do espaço de teste a partir do Inventário
    await setupModule(w, 'inventario', 'teste', ['P3']);
    const viaInv = await rpc<any[]>(w.users.P3, 'cal_event_options', { p_section: S(), p_module: 'inventario' });
    expect(viaInv.map((e) => e.id).sort()).toEqual(opts.map((e) => e.id).sort());
    await expectDenied(rpc(w.users.P2, 'cal_event_options', { p_section: S(), p_module: 'inventario' }), 'não está disponível');
    await expectDenied(rpc(w.users.P3, 'cal_event_options', { p_section: S(), p_module: 'xpto' }), 'Módulo inválido');
  });

  it('ao publicar, o espaço real começa vazio e os dados de teste não aparecem', async () => {
    const testIds = (await rpc<any[]>(w.users.Rui, 'cal_event_options', { p_section: S() })).map((e) => e.id);
    await setupModule(w, 'calendario', 'disponivel');
    expect(await list('P3')).toEqual([]);
    expect(await rpc(w.users.Ana, 'cal_event_options', { p_section: S() })).toEqual([]);
    await expectDenied(get('P3', testIds[0]), 'Registo não encontrado');
    await expectDenied(respond('P1', testIds[0], 'vou'), 'Registo não encontrado');
    await expectDenied(rpc(w.users.Ana, 'cal_set_pending', { p_section: S(), p_event: testIds[0], p_profile: w.users.P1, p_item: 'pagamento', p_done: true }), 'Registo não encontrado');
    const real = await create('Ana', timed('Abertura do ano', 10 * D));
    expect((await list('P3')).map((e) => e.id)).toEqual([real]);
    await admin(`delete from public.notifications where section_id = $1`, [S()]);
    await rpc(w.users.Ana, 'cal_update_event', { p_section: S(), p_event: real, p_data: timed('Abertura do ano', 10 * D + H) });
    const n = await admin(`select title from public.notifications where section_id = $1 and kind = 'cal_evento_alterado'`, [S()]);
    expect(n.length).toBe(7); // todos os membros ativos menos quem alterou; sem [Teste]
    expect(n.every((x) => !x.title.startsWith('[Teste]'))).toBe(true);
    // Voltar a teste: os dados reais não aparecem aos testers e nada se apaga
    await setupModule(w, 'calendario', 'teste');
    const back = (await list('P1', day(-D), day(60 * D))).map((e) => e.id);
    expect(back).not.toContain(real);
    expect((await admin(`select count(*)::int as n from public.cal_events where section_id = $1`, [S()]))[0].n).toBeGreaterThan(testIds.length);
  });

  it('anexos: gestores anexam; participantes não', async () => {
    const id = await create('Rui', timed('Com programa', 15 * D));
    const path = await rpc<string>(w.users.Tecnico, 'module_file_prepare', { p_section: S(), p_module: 'calendario', p_entity: 'cal_event', p_entity_id: id, p_file_name: 'programa.pdf', p_mime: 'application/pdf' });
    expect(path).toContain('/calendario/teste/');
    await expectDenied(rpc(w.users.P1, 'module_file_prepare', { p_section: S(), p_module: 'calendario', p_entity: 'cal_event', p_entity_id: id, p_file_name: 'x.pdf', p_mime: 'application/pdf' }), 'permissão');
    expect(await rpc<any[]>(w.users.P1, 'module_files_of', { p_section: S(), p_module: 'calendario', p_entity: 'cal_event', p_entity_id: id })).toHaveLength(1);
  });
});

describe('publicar passando os dados de teste a reais', () => {
  it('atividades, respostas e lembretes por enviar passam ao espaço real', async () => {
    const v = await buildWorld('calpub');
    await setupModule(v, 'calendario', 'teste', ['Rui', 'P1']);
    const id = await rpc<string>(v.users.Rui, 'cal_create_event', { p_section: v.section, p_data: timed('Atividade de teste', 4 * D, { reminder_minutes: [60] }) });
    await rpc(v.users.P1, 'cal_respond', { p_section: v.section, p_event: id, p_response: 'vou', p_note: null, p_profile: null });
    await rpc(v.users.Ana, 'set_module_status', { p_section: v.section, p_module: 'calendario', p_status: 'disponivel', p_move_test_data: true });
    const ev = await rpc<any>(v.users.P3, 'cal_event_get', { p_section: v.section, p_event: id });
    expect(ev.participants.find((p: any) => p.profile_id === v.users.P1).response).toBe('vou');
    expect(await admin(`select distinct space from public.cal_participants where event_id = $1`, [id])).toEqual([{ space: 'real' }]);
    expect(await admin(`select distinct space from public.module_reminders where entity_id = $1`, [id])).toEqual([{ space: 'real' }]);
    await admin(`update public.module_reminders set due_at = now() - interval '1 minute' where entity_id = $1 and profile_id = $2`, [id, v.users.P3]);
    await admin(`select private.process_due_reminders()`);
    expect(await admin(`select title from public.notifications where profile_id = $1 and kind = 'lembrete'`, [v.users.P3]))
      .toEqual([{ title: 'Lembrete: Atividade de teste' }]);
  });
});
