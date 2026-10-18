// Presenças: a fórmula da taxa com números exatos (sessões passadas, de hoje, futuras,
// canceladas, canceladas no Calendário, de outra equipa e parcialmente preenchidas), a
// resposta do Calendário (Vou/Não vou) separada da presença e o seletor de atividades.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, buildWorld, pool, rpc, setupModule, type World } from './helpers';

let w: World;
let TODAY = '';
const S = () => w.section;
const day = (offset: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const session = (date: string, title: string, extra: Record<string, unknown> = {}) =>
  rpc<string>(w.users.Ana, 'pres_session_save', {
    p_section: S(), p_session: null, p_cal_event: null, p_date: date, p_title: title, p_kind: 'reuniao', p_team: null, p_notes: null, ...extra,
  });
const record = (sessionId: string, names: string[], status: string, extra: Record<string, unknown> = {}) =>
  rpc<number>(w.users.Ana, 'pres_record', {
    p_section: S(), p_session: sessionId, p_memberships: names.map((n) => w.members[n]), p_status: status, ...extra,
  });
const cancel = (id: string, on = true) => rpc(w.users.Ana, 'pres_session_cancel', { p_section: S(), p_session: id, p_cancel: on, p_reason: null });
const member = (who: string, name: string, from = day(-60), to = day(30)) =>
  rpc<any>(w.users[who], 'pres_member', { p_section: S(), p_membership: w.members[name], p_from: from, p_to: to });
const board = (from = day(-60), to = day(30), team: string | null = null) =>
  rpc<any>(w.users.Ana, 'pres_board', { p_section: S(), p_from: from, p_to: to, p_team: team });
const sess = (who: string, id: string) => rpc<any>(w.users[who], 'pres_session', { p_section: S(), p_session: id });
const allDayEvent = async (title: string, date: string) =>
  (await admin(`insert into public.cal_events (section_id, space, title, all_day, start_date, end_date, created_by)
                values ($1, 'teste', $2, true, $3, $3, $4) returning id`, [S(), title, date, w.users.Ana]))[0].id as string;
const timedEvent = async (title: string, startsAt: string, endsAt: string) =>
  (await admin(`insert into public.cal_events (section_id, space, title, all_day, starts_at, ends_at, created_by)
                values ($1, 'teste', $2, false, $3, $4, $5) returning id`, [S(), title, startsAt, endsAt, w.users.Ana]))[0].id as string;
const respond = (event: string, name: string, response: string) =>
  admin(`insert into public.cal_participants (event_id, profile_id, section_id, space, response, responded_at)
         values ($1, $2, $3, 'teste', $4, now())
         on conflict (event_id, profile_id) do update set response = excluded.response`, [event, w.users[name], S(), response]);

const ids: Record<string, string> = {};

beforeAll(async () => {
  w = await buildWorld('presencas-formula');
  TODAY = (await admin(`select (now() at time zone 'Europe/Lisbon')::date::text as d`))[0].d;
  await admin(`update public.membership_history set changed_at = changed_at - interval '400 days' where section_id = $1`, [S()]);
  await admin(`update public.memberships set approved_at = approved_at - interval '400 days' where section_id = $1`, [S()]);
  await setupModule(w, 'presencas', 'teste', ['Ana', 'Rui', 'GuiaA', 'GuiaB', 'P1', 'P2', 'P3']);

  ids.present = await session(day(-10), 'Presente');
  ids.justified = await session(day(-9), 'Falta justificada');
  ids.unjustified = await session(day(-8), 'Falta injustificada');
  ids.partial = await session(day(-7), 'Preenchida em parte');
  ids.empty = await session(day(-6), 'Por preencher');
  ids.teamB = await session(day(-5), 'Só da equipa B', { p_team: w.teamB });
  ids.cancelled = await session(day(-4), 'Cancelada');
  const ev = await allDayEvent('Raide cancelado', day(-3));
  ids.calCancelled = await session(day(-3), 'x', { p_cal_event: ev, p_date: null, p_title: null, p_kind: null });
  ids.today = await session(day(0), 'Hoje');
  ids.future = await session(day(3), 'Futura');

  await record(ids.present, ['P1'], 'presente');
  await record(ids.justified, ['P1'], 'justificada', { p_justification: 'Doença' });
  await record(ids.unjustified, ['P1'], 'injustificada');
  // Sessão parcialmente preenchida: P1 (parcial) e P2 presentes; os restantes ficam por registar.
  await record(ids.partial, ['P1'], 'presente', { p_partial: true, p_partial_note: 'Chegou tarde' });
  await record(ids.partial, ['P2'], 'presente');
  await record(ids.teamB, ['P3'], 'presente');
  await record(ids.cancelled, ['P1'], 'presente');
  await cancel(ids.cancelled);
  await record(ids.calCancelled, ['P1'], 'injustificada');
  await admin(`update public.cal_events set status = 'cancelado' where id = $1`, [ev]);
  await record(ids.today, ['P1'], 'presente');
  await record(ids.future, ['P1'], 'justificada', { p_justification: 'Viagem marcada' });
});
afterAll(() => pool.end());

describe('fórmula da taxa de assiduidade', () => {
  it('conta só sessões até hoje, ativas, aplicáveis e registadas', async () => {
    const m = await member('Ana', 'P1');
    // Presenças: 10 dias, parcial (7 dias) e hoje. Faltas: 1 justificada e 1 injustificada.
    expect(m.stats).toMatchObject({
      presencas: 3, parciais: 1, justificadas: 1, injustificadas: 1, faltas: 2, contadas: 5,
      por_registar: 1, futuras: 1, canceladas: 2,
    });
    expect(Number(m.stats.taxa)).toBe(60);
    // A sessão de outra equipa não se aplica: nem aparece nas datas, nem conta como por registar.
    expect(m.entries.map((e: any) => e.session_id)).not.toContain(ids.teamB);
    expect(m.entries).toHaveLength(9);
    const cat = Object.fromEntries(m.entries.map((e: any) => [e.session_id, e.category]));
    expect(cat[ids.cancelled]).toBe('cancelada');
    expect(cat[ids.calCancelled]).toBe('cancelada');
    expect(cat[ids.future]).toBe('futura');
    expect(cat[ids.empty]).toBe('por_registar');
    expect(cat[ids.today]).toBe('presente');
  });

  it('o quadro dá os mesmos números e não cria células onde a pessoa não conta', async () => {
    const b = await board();
    const p1 = b.members.find((x: any) => x.membership_id === w.members.P1);
    expect(p1.stats).toEqual((await member('Ana', 'P1')).stats);
    expect(b.cells.some((c: any) => c.s === ids.teamB && c.m === w.members.P1)).toBe(false);
    expect(b.cells.some((c: any) => c.m === w.members.Rui)).toBe(false); // dirigentes não contam
    // Sessão preenchida em parte: 2 registadas das 5 pessoas que contam.
    const partial = b.sessions.find((s: any) => s.id === ids.partial);
    expect(partial).toMatchObject({ applicable: 5, registered: 2, future: false, status: 'ativa' });
    const empty = b.sessions.find((s: any) => s.id === ids.empty);
    expect(empty).toMatchObject({ applicable: 5, registered: 0 });
    expect(b.sessions.find((s: any) => s.id === ids.calCancelled).status).toBe('cancelada');
    expect(b.sessions.find((s: any) => s.id === ids.future).future).toBe(true);
    // P3: só a presença da equipa B conta; as sessões de secção sem registo ficam por registar (nunca falta).
    const p3 = b.members.find((x: any) => x.membership_id === w.members.P3);
    expect(p3.stats).toMatchObject({ presencas: 1, faltas: 0, contadas: 1 });
    expect(p3.stats.por_registar).toBe(6);
    expect(Number(p3.stats.taxa)).toBe(100);
    // GuiaA: nada registado → sem taxa (nunca 0 %).
    expect(b.members.find((x: any) => x.membership_id === w.members.GuiaA).stats.taxa).toBeNull();
  });

  it('totais do período = soma das células contadas', async () => {
    const t = (await board()).totals;
    // P1: 3 P, 1 FJ, 1 FI; P2: 1 P; P3: 1 P.
    expect(t).toMatchObject({ presencas: 5, parciais: 1, justificadas: 1, injustificadas: 1, contadas: 7 });
    expect(Number(t.taxa)).toBeCloseTo(71.4, 1);
    // Filtro por equipa B: só P3 e GuiaB.
    const b = await board(day(-60), day(30), w.teamB);
    expect(new Set(b.cells.map((c: any) => c.m))).toEqual(new Set([w.members.P3, w.members.GuiaB]));
    expect(b.totals).toMatchObject({ presencas: 1, contadas: 1 });
  });

  it('período parcial conta só as sessões dentro dele', async () => {
    const m = await member('Ana', 'P1', day(-8), day(-6));
    expect(m.stats).toMatchObject({ presencas: 1, parciais: 1, injustificadas: 1, justificadas: 0, contadas: 2, por_registar: 1 });
    expect(Number(m.stats.taxa)).toBe(50);
  });

  it('desfazer um registo tira-o do denominador; reativar uma sessão volta a contar', async () => {
    await record(ids.justified, ['P1'], 'por_registar', { p_reason: 'Engano' });
    let s = (await member('Ana', 'P1')).stats;
    expect(s).toMatchObject({ presencas: 3, justificadas: 0, contadas: 4, por_registar: 2 });
    expect(Number(s.taxa)).toBe(75);
    await cancel(ids.cancelled, false);
    s = (await member('Ana', 'P1')).stats;
    expect(s).toMatchObject({ presencas: 4, contadas: 5, canceladas: 1 });
    expect(Number(s.taxa)).toBe(80);
    // Repor o estado inicial.
    await cancel(ids.cancelled);
    await record(ids.justified, ['P1'], 'justificada');
  });
});

describe('Calendário: «Vou/Não vou» não é presença', () => {
  let ev: string, sid: string;
  beforeAll(async () => {
    ev = await allDayEvent('Acantonamento', day(-2));
    sid = await session(day(-2), 'x', { p_cal_event: ev, p_date: null, p_title: null, p_kind: null });
    await respond(ev, 'P1', 'vou');
    await respond(ev, 'P2', 'nao_vou');
    await respond(ev, 'P3', 'por_confirmar');
  });

  it('a sessão mostra a resposta do Calendário à parte do estado da presença', async () => {
    const d = await sess('Ana', sid);
    const by = Object.fromEntries(d.members.map((m: any) => [m.membership_id, m]));
    expect(by[w.members.P1]).toMatchObject({ cal_response: 'vou', status: null, category: 'por_registar' });
    expect(by[w.members.P2]).toMatchObject({ cal_response: 'nao_vou', status: null, category: 'por_registar' });
    expect(by[w.members.P3]).toMatchObject({ cal_response: 'por_confirmar' });
    expect(by[w.members.GuiaA].cal_response).toBeNull();
    // Sessões sem atividade ligada não têm resposta.
    expect((await sess('Ana', ids.present)).members.every((m: any) => m.cal_response === null)).toBe(true);
  });

  it('«Vou» sem registo não conta como presença, nem «Não vou» como falta', async () => {
    const before = (await member('Ana', 'P2')).stats;
    expect(before.contadas).toBe(1); // só a presença da sessão parcial
    const p1 = (await member('Ana', 'P1')).stats;
    expect(p1.presencas).toBe(3);
    await record(sid, ['P2'], 'presente', { p_reason: 'Disse que não ia, mas veio' });
    const after = (await member('Ana', 'P2')).stats;
    expect(after).toMatchObject({ presencas: 2, contadas: 2 });
  });

  it('quem não regista vê só a própria resposta', async () => {
    const d = await sess('P1', sid);
    expect(d.members).toHaveLength(1);
    expect(d.members[0]).toMatchObject({ membership_id: w.members.P1, cal_response: 'vou' });
  });
});

describe('opções de atividades', () => {
  it('trazem a hora de início (ou nenhuma nos eventos de dia inteiro)', async () => {
    const timed = await timedEvent('Reunião de pais', `${day(-1)}T17:30:00Z`, `${day(-1)}T19:00:00Z`);
    const allDay = await allDayEvent('Dia do agrupamento', day(-1));
    const opts = await rpc<any[]>(w.users.Ana, 'pres_event_options', { p_section: S() });
    const t = opts.find((o) => o.id === timed);
    expect(t).toMatchObject({ all_day: false, start: day(-1), end: day(-1) });
    expect(new Date(t.starts_at).toISOString()).toBe(new Date(`${day(-1)}T17:30:00Z`).toISOString());
    expect(opts.find((o) => o.id === allDay)).toMatchObject({ all_day: true, starts_at: null });
    // Atividades já ligadas não aparecem.
    expect(opts.some((o) => o.title === 'Acantonamento')).toBe(false);
  });
});
