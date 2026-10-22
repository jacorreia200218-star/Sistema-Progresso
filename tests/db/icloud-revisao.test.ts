// Calendário do iCloud com «Rever antes de publicar»: a sincronização só propõe mudanças;
// a administração aprova (podendo corrigir título, local e descrição) ou rejeita, e só então
// o Calendário muda. Rejeitar lembra a versão rejeitada. Dados e link FICTÍCIOS.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, buildWorld, expectDenied, pool, rpc, setupModule, type World } from './helpers';

let w: World;
const S = () => w.section;
const D = 86400e3;
const H = 3600e3;
const day = (offsetDays: number) => new Date(Date.now() + offsetDays * D).toISOString().slice(0, 10);
const at = (offsetDays: number, hourUtc = 13) => {
  const d = new Date(Date.now() + offsetDays * D);
  d.setUTCHours(hourUtc, 30, 0, 0);
  return d.toISOString();
};
const URL = 'https://p00-caldav.icloud.com/published/2/FICTICIO-revisao-abcdefghijklmnop';

async function svc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role service_role');
    await client.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    const keys = Object.keys(args);
    const res = await client.query(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as result`, keys.map((k) => args[k]));
    await client.query('commit');
    return res.rows[0]?.result as T;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

type Item = Record<string, unknown>;
const timed = (uid: string, title: string, start: string, extra: Item = {}): Item =>
  ({ uid, rid: '', title, description: null, location: null, all_day: false, starts_at: start, ends_at: new Date(Date.parse(start) + 2 * H).toISOString(), start_date: null, end_date: null, cancelled: false, ...extra });
const allDay = (uid: string, title: string, from: string, to: string, extra: Item = {}): Item =>
  ({ uid, rid: '', title, description: null, location: null, all_day: true, starts_at: null, ends_at: null, start_date: from, end_date: to, cancelled: false, ...extra });
const apply = (source: string, items: Item[]) =>
  svc<any>('cal_source_apply', { p_source: source, p_feed: JSON.stringify({ name: 'Agrupamento', complete: true, window_from: day(-400), window_to: day(400), items }) });
const events = (source: string) => admin(`select * from public.cal_events where source_id = $1 order by source_uid`, [source]);
const inbox = () => rpc<any[]>(w.users.Ana, 'cal_source_inbox_list', { p_section: S() });
const decide = (ids: string[], decision: 'aprovar' | 'rejeitar', edits: Item | null = null) =>
  rpc<number>(w.users.Ana, 'cal_source_inbox_decide', { p_section: S(), p_ids: ids, p_decision: decision, p_edits: edits ? JSON.stringify(edits) : null });

const raid = () => timed('raid@icloud', 'Raid', at(5), { location: 'Serra' });
const acamp = () => allDay('acamp@icloud', 'Acampamento', day(30), day(32));
const festa = () => timed('festa@icloud', 'Festa de Natal', at(60));

let src: string;

beforeAll(async () => {
  w = await buildWorld('icrev');
  await setupModule(w, 'calendario', 'disponivel');
  src = await svc('cal_source_create', { p_profile: w.users.Ana, p_section: S(), p_data: { url: URL, name: 'Agrupamento' } });
});
afterAll(() => pool.end());

describe('rever antes de publicar', () => {
  it('ligado por omissão: a sincronização só propõe, o Calendário não muda', async () => {
    const st = await apply(src, [raid(), acamp(), festa(), timed('fantasma@icloud', 'Cancelado', at(8), { cancelled: true })]);
    expect(st).toMatchObject({ por_rever: 3 });
    expect(await events(src)).toHaveLength(0);
    const l = await inbox();
    expect(l.map((x) => [x.kind, x.item.title])).toEqual([['nova', 'Raid'], ['nova', 'Acampamento'], ['nova', 'Festa de Natal']]);
    const list = await rpc<any>(w.users.Ana, 'cal_sources_list', { p_section: S() });
    expect(list.sources[0]).toMatchObject({ review: true, pending_review: 3 });
    // Membros não veem nada ainda
    expect(await rpc<any[]>(w.users.P1, 'cal_events_list', { p_section: S(), p_from: day(-1), p_to: day(90) })).toHaveLength(0);
  });

  it('só a administração vê e decide', async () => {
    await expectDenied(rpc(w.users.Rui, 'cal_source_inbox_list', { p_section: S() }), 'Reservado');
    const [x] = await inbox();
    await expectDenied(rpc(w.users.Rui, 'cal_source_inbox_decide', { p_section: S(), p_ids: [x.id], p_decision: 'aprovar' }), 'Reservado');
    await expectDenied(rpc(w.users.P1, 'cal_source_set_review', { p_section: S(), p_source: src, p_on: false }), 'Reservado');
  });

  it('aprovar, com ou sem correções, publica; rejeitar lembra a versão', async () => {
    const l = await inbox();
    const id = (t: string) => l.find((x) => x.item.title === t)!.id;
    await expect(decide([id('Raid'), id('Festa de Natal')], 'aprovar', { title: 'X' })).rejects.toThrow(/uma atividade/);
    expect(await decide([id('Raid')], 'aprovar', { title: 'Raid de outono', location: 'Serra da Estrela', description: 'Levar lanterna.' })).toBe(1);
    expect(await decide([id('Acampamento')], 'aprovar')).toBe(1);
    expect(await decide([id('Festa de Natal')], 'rejeitar')).toBe(1);
    const ev = await events(src);
    expect(ev.map((e) => [e.title, e.location, e.description])).toEqual([
      ['Acampamento', null, null],
      ['Raid de outono', 'Serra da Estrela', 'Levar lanterna.'],
    ]);
    expect(await inbox()).toHaveLength(0);
    // A mesma versão rejeitada não volta; a correção feita na app aparece como alteração para rever
    let st = await apply(src, [raid(), acamp(), festa()]);
    let pend = await inbox();
    expect(pend.map((x) => [x.kind, x.item.title])).toEqual([['alterada', 'Raid']]);
    expect(pend[0].current).toMatchObject({ title: 'Raid de outono', location: 'Serra da Estrela' });
    await decide([pend[0].id], 'rejeitar');
    st = await apply(src, [raid(), acamp(), festa()]);
    expect(st).toMatchObject({ por_rever: 0 });
    // Mudou no iCloud: volta para rever
    await apply(src, [raid(), acamp(), timed('festa@icloud', 'Festa de Natal', at(61))]);
    pend = await inbox();
    expect(pend.map((x) => [x.kind, x.item.title])).toEqual([['nova', 'Festa de Natal']]);
  });

  it('alterações, cancelamentos e remoções esperam aprovação', async () => {
    await apply(src, [raid(), allDay('acamp@icloud', 'Acampamento de Natal', day(31), day(33))]);
    let pend = await inbox();
    const kinds = Object.fromEntries(pend.map((x) => [x.item.title ?? x.current?.title, x.kind]));
    expect(kinds).toMatchObject({ 'Acampamento de Natal': 'alterada' });
    // Ainda não mudou no Calendário
    expect((await events(src)).find((e) => e.source_uid === 'acamp@icloud').title).toBe('Acampamento');
    await decide([pend.find((x) => x.kind === 'alterada')!.id], 'aprovar');
    const ac = (await events(src)).find((e) => e.source_uid === 'acamp@icloud');
    expect(ac.title).toBe('Acampamento de Natal');

    // Cancelado no iCloud e removido do iCloud
    await apply(src, [{ ...raid(), cancelled: true }]);
    pend = await inbox();
    expect(pend.filter((x) => x.kind !== 'nova').map((x) => [x.kind, x.current.title]).sort()).toEqual([
      ['cancelada', 'Raid de outono'], ['removida', 'Acampamento de Natal'],
    ]);
    expect((await events(src)).every((e) => e.status === 'ativo')).toBe(true);
    await decide(pend.filter((x) => x.kind !== 'nova').map((x) => x.id), 'aprovar');
    const ev = await events(src);
    expect(ev.map((e) => [e.title, e.status, e.source_state])).toEqual([
      ['Acampamento de Natal', 'cancelado', 'removido'],
      ['Raid de outono', 'cancelado', 'cancelado'],
    ]);
  });

  it('desligar a revisão limpa o que estava por rever e volta à sincronização direta', async () => {
    await rpc(w.users.Ana, 'cal_source_set_review', { p_section: S(), p_source: src, p_on: false });
    expect(await inbox()).toHaveLength(0);
    const st = await apply(src, [raid(), festa()]);
    expect(st).toMatchObject({ criadas: 1, reativadas: 1 });
    expect((await events(src)).filter((e) => e.status === 'ativo').map((e) => e.title).sort()).toEqual(['Festa de Natal', 'Raid']);
  });
});
