// Calendário escutista: subscrição do iCloud (só de leitura). Gestão só pela administração,
// link guardado no servidor e mascarado, importação sem notificações, repetição sem
// duplicados, alterações, cancelamentos, remoções com salvaguardas e ligações preservadas.
// Dados FICTÍCIOS só para teste; o link nunca é real.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, buildWorld, expectDenied, expectError, pool, rpc, setupModule, type World } from './helpers';

let w: World;
const S = () => w.section;
const D = 86400e3;
const H = 3600e3;
const day = (offsetDays: number) => new Date(Date.now() + offsetDays * D).toISOString().slice(0, 10);
const at = (offsetDays: number, hourUtc = 13, min = 30) => {
  const d = new Date(Date.now() + offsetDays * D);
  d.setUTCHours(hourUtc, min, 0, 0);
  return d.toISOString();
};
const rid = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const URL_REAL = 'https://p00-caldav.icloud.com/published/2/FICTICIO-real-abcdefghijklmnop1234';
const URL_TESTE = 'https://p00-caldav.icloud.com/published/2/FICTICIO-teste-zyxwvutsrq9876';

/** Chamada como a função /api/icloud (chave secreta do Supabase → papel service_role). */
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
const timed = (uid: string, title: string, start: string, hours = 2, extra: Item = {}): Item =>
  ({ uid, rid: '', title, description: null, location: null, all_day: false, starts_at: start, ends_at: new Date(Date.parse(start) + hours * H).toISOString(), start_date: null, end_date: null, cancelled: false, ...extra });
const allDay = (uid: string, title: string, from: string, to: string, extra: Item = {}): Item =>
  ({ uid, rid: '', title, description: null, location: null, all_day: true, starts_at: null, ends_at: null, start_date: from, end_date: to, cancelled: false, ...extra });
const occ = (uid: string, title: string, start: string, extra: Item = {}) => timed(uid, title, start, 1.5, { rid: rid(start), ...extra });
const feed = (items: Item[], extra: Item = {}) => ({ name: 'Agrupamento (fictício)', complete: true, window_from: day(-400), window_to: day(400), items, ...extra });
const apply = (source: string, items: Item[], extra: Item = {}, force = false) =>
  svc<any>('cal_source_apply', { p_source: source, p_feed: JSON.stringify(feed(items, extra)), p_force: force });
const rows = (source: string) => admin(`select * from public.cal_events where source_id = $1 order by source_uid, source_rid`, [source]);
const byUid = async (source: string, uid: string, r = '') =>
  (await admin(`select * from public.cal_events where source_id = $1 and source_uid = $2 and source_rid = $3`, [source, uid, r]))[0];
const sourceRow = async (id: string) => (await admin(`select * from public.cal_sources where id = $1`, [id]))[0];

// Calendário de base (real): única, dia inteiro de 3 dias e reunião semanal (3 sábados).
const sat = [at(10), at(17), at(24)];
const base = () => [
  timed('raid@icloud', 'Raid de outono', at(5, 9, 0), 6, { location: 'Serra', description: 'Levar lanterna.' }),
  allDay('acamp@icloud', 'Acampamento', day(30), day(32)),
  ...sat.map((s) => occ('reuniao@icloud', 'Reunião', s)),
  // Cancelado e nunca importado: não cria nada.
  timed('fantasma@icloud', 'Cancelado à partida', at(8), 1, { cancelled: true }),
];

let real: string, teste: string;
let raidId: string, ata: string, task: string;

beforeAll(async () => {
  w = await buildWorld('ical');
  await setupModule(w, 'secretaria', 'disponivel');
  await setupModule(w, 'calendario', 'teste', ['Ana', 'Rui', 'P1']);
});
afterAll(() => pool.end());

describe('gestão da fonte', () => {
  it('só a administração gere; as funções de serviço exigem a chave secreta', async () => {
    await expectDenied(rpc(w.users.Rui, 'cal_sources_list', { p_section: S() }), 'Reservado');
    await expectDenied(svc('cal_source_create', { p_profile: w.users.Rui, p_section: S(), p_data: { url: URL_REAL, name: 'X' } }), 'Reservado');
    await expectError(rpc(w.users.Ana, 'cal_source_create', { p_profile: w.users.Ana, p_section: S(), p_data: { url: URL_REAL, name: 'X' } }), /permission denied|Sem permissão/);
    await expectError(rpc(w.users.Ana, 'cal_source_targets', {}), /permission denied|Sem permissão/);
    await expectError(rpc(w.users.Ana, 'cal_icloud_check_secret', { p_secret: 'x' }), /permission denied|Sem permissão/);
    expect(await svc('cal_source_admin_ok', { p_profile: w.users.Ana, p_section: S() })).toBe(true);
    expect(await svc('cal_source_admin_ok', { p_profile: w.users.Rui, p_section: S() })).toBe(false);
  });

  it('guardar: espaço real por omissão, sem lembretes, link nunca devolvido à app', async () => {
    await expectError(svc('cal_source_create', { p_profile: w.users.Ana, p_section: S(), p_data: { url: 'webcal://x/y', name: 'X' } }), 'Link inválido');
    await expectError(svc('cal_source_create', { p_profile: w.users.Ana, p_section: S(), p_data: { url: URL_REAL, name: ' ' } }), 'nome');
    real = await svc('cal_source_create', { p_profile: w.users.Ana, p_section: S(), p_data: { url: URL_REAL, name: 'Agrupamento', calname: 'Agrupamento (fictício)' } });
    await expectError(svc('cal_source_create', { p_profile: w.users.Ana, p_section: S(), p_data: { url: URL_REAL, name: 'Outra vez' } }), 'já está ligado');
    // Teste e real separados: o mesmo calendário pode alimentar o espaço de teste.
    teste = await svc('cal_source_create', { p_profile: w.users.Tecnico, p_section: S(), p_data: { url: URL_TESTE, name: 'Teste', space: 'teste' } });
    const l = await rpc<any>(w.users.Tecnico, 'cal_sources_list', { p_section: S() });
    expect(l.calendar_status).toBe('teste');
    expect(l.auto_sync).toBe(false); // sem pg_cron localmente
    const r = l.sources.find((s: any) => s.id === real);
    expect(r).toMatchObject({ space: 'real', status: 'ativa', audience: 'seccao', reminder_minutes: [], url_mask: 'webcal://p00-caldav.icloud.com/…1234' });
    expect(JSON.stringify(l)).not.toContain('FICTICIO');
    expect(l.sources.find((s: any) => s.id === teste).space).toBe('teste');
    const t = await svc<any[]>('cal_source_targets', {});
    expect(t.map((x) => x.url).sort()).toEqual([URL_REAL, URL_TESTE].sort());
    await expectError(svc('cal_source_targets', { p_source: real, p_profile: w.users.Rui }), 'não encontrado');
    expect((await svc<any[]>('cal_source_targets', { p_source: real, p_profile: w.users.Ana })).map((x) => x.id)).toEqual([real]);
  });
});

describe('importação e sincronização', () => {
  it('primeira importação: atividades normais, sem notificações nem lembretes', async () => {
    const before = (await admin(`select count(*)::int n from public.notifications where section_id = $1`, [S()]))[0].n;
    const st = await apply(real, base());
    expect(st).toMatchObject({ criadas: 5, atualizadas: 0, canceladas: 0, removidas: 0 });
    const r = await rows(real);
    expect(r).toHaveLength(5);
    expect(r.every((e) => e.space === 'real' && e.status === 'ativo' && e.source_state === 'ok' && e.reminder_minutes.length === 0)).toBe(true);
    const ac = await byUid(real, 'acamp@icloud');
    expect(ac.all_day).toBe(true);
    expect((await admin(`select count(*)::int n from public.notifications where section_id = $1`, [S()]))[0].n).toBe(before);
    expect((await admin(`select count(*)::int n from public.module_reminders r join public.cal_events e on e.id = r.entity_id where e.source_id = $1`, [real]))[0].n).toBe(0);
    const s = await sourceRow(real);
    expect(s).toMatchObject({ event_count: 5, failures: 0, last_error: null, calname: 'Agrupamento (fictício)' });
    expect(s.last_success_at).toBeTruthy();
  });

  it('repetir não duplica', async () => {
    const st = await apply(real, base());
    expect(st).toMatchObject({ criadas: 0, atualizadas: 0, sem_alteracao: 5 });
    expect(await rows(real)).toHaveLength(5);
  });

  it('atas e tarefas ligam-se às atividades importadas', async () => {
    raidId = (await byUid(real, 'raid@icloud')).id;
    ata = await rpc(w.users.Rui, 'ata_save', { p_section: S(), p_ata: null, p_event: raidId, p_body: 'Preparação do raid.', p_scope: 'evento', p_expected_version: null });
    task = await rpc(w.users.Rui, 'ata_task_save', { p_section: S(), p_task: null, p_ata: ata, p_text: 'Rever percurso', p_responsible: w.users.P1, p_due: day(3) });
    expect((await rpc<any>(w.users.Rui, 'ata_get', { p_section: S(), p_ata: ata })).event.id).toBe(raidId);
  });

  it('alterações no iCloud atualizam a mesma linha e mantêm as ligações', async () => {
    const items = base();
    items[0] = timed('raid@icloud', 'Raid de outono (novo percurso)', at(6, 8, 0), 8, { location: 'Serra da Estrela', description: 'Levar lanterna e frontal.' });
    const st = await apply(real, items);
    expect(st).toMatchObject({ criadas: 0, atualizadas: 1, sem_alteracao: 4 });
    const raid = await byUid(real, 'raid@icloud');
    expect(raid.id).toBe(raidId);
    expect(raid).toMatchObject({ title: 'Raid de outono (novo percurso)', location: 'Serra da Estrela', status: 'ativo' });
    expect(new Date(raid.starts_at).toISOString()).toBe(at(6, 8, 0));
    const a = await rpc<any>(w.users.Rui, 'ata_get', { p_section: S(), p_ata: ata });
    expect(a.event.id).toBe(raidId);
    expect(a.tasks.map((t: any) => t.id)).toEqual([task]);
  });

  it('recorrência: ocorrência cancelada, ocorrência retirada e série que muda de hora', async () => {
    const meetings = (await rows(real)).filter((e) => e.source_uid === 'reuniao@icloud');
    const ids = meetings.map((m) => m.id);
    // 1.º sábado cancelado (exceção STATUS:CANCELLED / EXDATE); 3.º desaparece do ICS.
    const items = [...base().slice(0, 2), occ('reuniao@icloud', 'Reunião', sat[0], { cancelled: true }), occ('reuniao@icloud', 'Reunião', sat[1])];
    const st = await apply(real, items);
    expect(st).toMatchObject({ canceladas: 1, removidas: 1 });
    const after = (await rows(real)).filter((e) => e.source_uid === 'reuniao@icloud');
    expect(after.map((e) => e.id).sort()).toEqual([...ids].sort()); // nada apagado
    const one = after.find((e) => e.source_rid === rid(sat[0]))!;
    expect(one).toMatchObject({ status: 'cancelado', source_state: 'cancelado', cancel_reason: 'Cancelada no iCloud.' });
    const three = after.find((e) => e.source_rid === rid(sat[2]))!;
    expect(three).toMatchObject({ status: 'cancelado', source_state: 'removido', cancel_reason: 'Removida no iCloud.' });
    expect(three.source_removed_at).toBeTruthy();
    // Volta ao iCloud: reativada, a mesma linha.
    const back = await apply(real, [...base().slice(0, 2), occ('reuniao@icloud', 'Reunião', sat[0], { cancelled: true }), occ('reuniao@icloud', 'Reunião', sat[1]), occ('reuniao@icloud', 'Reunião', sat[2])]);
    expect(back).toMatchObject({ reativadas: 1 });
    expect(await byUid(real, 'reuniao@icloud', rid(sat[2]))).toMatchObject({ id: three.id, status: 'ativo', source_state: 'ok', source_removed_at: null });
    // A série passa das 14:30 para as 15:00: o RECURRENCE-ID muda, mas é a mesma ocorrência do dia.
    const later = sat.map((s) => new Date(Date.parse(s) + 30 * 60e3).toISOString());
    const st2 = await apply(real, [...base().slice(0, 2), occ('reuniao@icloud', 'Reunião', later[0], { cancelled: true }), occ('reuniao@icloud', 'Reunião', later[1]), occ('reuniao@icloud', 'Reunião', later[2])]);
    expect(st2).toMatchObject({ criadas: 0, removidas: 0 });
    const moved = await byUid(real, 'reuniao@icloud', rid(later[1]));
    expect(moved.id).toBe(after.find((e) => e.source_rid === rid(sat[1]))!.id);
    expect(new Date(moved.starts_at).toISOString()).toBe(later[1]);
    expect((await rows(real)).filter((e) => e.source_uid === 'reuniao@icloud')).toHaveLength(3);
  });

  it('resposta vazia ou incompleta nunca retira atividades', async () => {
    const n = (await rows(real)).filter((e) => e.status === 'ativo').length;
    const empty = await apply(real, []);
    expect(empty.removidas).toBe(0);
    expect((await sourceRow(real)).last_warning).toContain('vazio');
    const partial = await apply(real, base().slice(0, 1), { complete: false });
    expect(partial.removidas).toBe(0);
    expect((await sourceRow(real)).last_warning).toContain('não foi completa');
    expect((await rows(real)).filter((e) => e.status === 'ativo').length).toBe(n);
  });

  it('descida brusca fica à espera de confirmação; «Sincronizar agora» com confirmação aplica', async () => {
    const extra = Array.from({ length: 6 }, (_, i) => timed(`extra${i}@icloud`, `Extra ${i}`, at(40 + i)));
    const items = [...base(), ...extra];
    await apply(real, items);
    const n = (await rows(real)).filter((e) => e.status === 'ativo').length;
    const st = await apply(real, items.slice(0, 1));
    expect(st.removidas).toBe(0);
    const s = await sourceRow(real);
    expect(s.pending_removals).toBeGreaterThanOrEqual(5);
    expect(s.last_warning).toContain('nada foi retirado');
    expect((await rows(real)).filter((e) => e.status === 'ativo').length).toBe(n);
    // Fora da janela lida, nada se toca.
    const outside = await apply(real, items.slice(0, 1), { window_from: day(200), window_to: day(400) });
    expect(outside.removidas).toBe(0);
    const forced = await apply(real, items.slice(0, 1), {}, true);
    expect(forced.removidas).toBe(n - 1);
    expect((await sourceRow(real)).pending_removals).toBe(0);
    // A ata e a tarefa continuam ligadas à atividade (que não saiu do iCloud).
    expect((await rpc<any>(w.users.Rui, 'ata_get', { p_section: S(), p_ata: ata })).event.id).toBe(raidId);
    await apply(real, items);
  });

  it('erro de leitura fica registado e não muda nada', async () => {
    const before = await rows(real);
    await svc('cal_source_fail', { p_source: real, p_error: 'O iCloud respondeu com o código 404.' });
    const s = await sourceRow(real);
    expect(s).toMatchObject({ last_error: 'O iCloud respondeu com o código 404.', failures: 1 });
    expect(await rows(real)).toEqual(before);
    await apply(real, [...base(), ...Array.from({ length: 6 }, (_, i) => timed(`extra${i}@icloud`, `Extra ${i}`, at(40 + i)))]);
    expect(await sourceRow(real)).toMatchObject({ last_error: null, failures: 0 });
  });

  it('removida no iCloud com ata ligada: a ata mantém-se e a atividade fica assinalada', async () => {
    const items = [...base().slice(1), ...Array.from({ length: 6 }, (_, i) => timed(`extra${i}@icloud`, `Extra ${i}`, at(40 + i)))];
    await apply(real, items);
    const raid = await byUid(real, 'raid@icloud');
    expect(raid).toMatchObject({ id: raidId, status: 'cancelado', source_state: 'removido' });
    const a = await rpc<any>(w.users.Rui, 'ata_get', { p_section: S(), p_ata: ata });
    expect(a.event.id).toBe(raidId);
    expect(a.body).toBe('Preparação do raid.');
    await apply(real, [...base(), ...Array.from({ length: 6 }, (_, i) => timed(`extra${i}@icloud`, `Extra ${i}`, at(40 + i)))]);
    expect((await byUid(real, 'raid@icloud')).status).toBe('ativo');
  });
});

describe('no calendário (espaço de teste)', () => {
  let ev: string;
  it('as atividades mostram a origem e os dados da origem são só de leitura', async () => {
    await apply(teste, [timed('t1@icloud', 'Reunião de pais', at(12), 1, { description: 'Na sede.' })]);
    const l = await rpc<any[]>(w.users.P1, 'cal_events_list', { p_section: S(), p_from: day(0), p_to: day(60) });
    expect(l).toHaveLength(1); // só o espaço de teste
    expect(l[0].source).toMatchObject({ kind: 'icloud', name: 'Teste', state: 'ok', readonly: true });
    ev = l[0].id;
    const g = await rpc<any>(w.users.Rui, 'cal_event_get', { p_section: S(), p_event: ev });
    expect(g.source.readonly).toBe(true);
    const data = { title: g.title, description: g.description, location: g.location, all_day: false, starts_at: g.starts_at, ends_at: g.ends_at };
    await expectError(rpc(w.users.Rui, 'cal_update_event', { p_section: S(), p_event: ev, p_data: { ...data, title: 'Outro' } }), 'vem do iCloud');
    await expectError(rpc(w.users.Rui, 'cal_update_event', { p_section: S(), p_event: ev, p_data: { ...data, starts_at: at(13) , ends_at: at(13) } }), 'vem do iCloud');
    await rpc(w.users.Rui, 'cal_update_event', { p_section: S(), p_event: ev, p_data: { ...data, needs_payment: true, responsible_id: w.users.Rui } });
    expect(await rpc<any>(w.users.Rui, 'cal_event_get', { p_section: S(), p_event: ev })).toMatchObject({ needs_payment: true, title: 'Reunião de pais' });
    await expectError(rpc(w.users.Rui, 'cal_cancel_event', { p_section: S(), p_event: ev, p_reason: null }), 'vem do iCloud');
    // A sincronização seguinte mantém o que se acrescentou na app.
    await apply(teste, [timed('t1@icloud', 'Reunião de pais (sala 2)', at(12), 1, { description: 'Na sede.' })]);
    expect(await rpc<any>(w.users.Rui, 'cal_event_get', { p_section: S(), p_event: ev })).toMatchObject({ needs_payment: true, title: 'Reunião de pais (sala 2)', responsible_id: w.users.Rui });
  });

  it('alterar público e lembretes da fonte passa às atividades', async () => {
    await expectDenied(rpc(w.users.Rui, 'cal_source_update', { p_section: S(), p_source: teste, p_data: {} }), 'Reservado');
    await expectError(rpc(w.users.Ana, 'cal_source_update', { p_section: S(), p_source: teste, p_data: { audience: 'equipa' } }), 'equipa');
    await rpc(w.users.Ana, 'cal_source_update', { p_section: S(), p_source: teste, p_data: { name: 'Teste', audience: 'equipa', team_id: w.teamA, reminder_minutes: [1440] } });
    const e = (await admin(`select * from public.cal_events where id = $1`, [ev]))[0];
    expect(e).toMatchObject({ audience: 'equipa', team_id: w.teamA, reminder_minutes: [1440] });
    expect((await admin(`select count(*)::int n from public.module_reminders where entity_id = $1 and cancelled_at is null`, [ev]))[0].n).toBeGreaterThan(0);
  });

  it('parar as atualizações: as atividades ficam e passam a ser editáveis', async () => {
    await expectDenied(rpc(w.users.Rui, 'cal_source_disconnect', { p_section: S(), p_source: teste, p_mode: 'parar' }), 'Reservado');
    expect(await rpc(w.users.Ana, 'cal_source_disconnect', { p_section: S(), p_source: teste, p_mode: 'parar' })).toBe(0);
    expect(await apply(teste, [])).toEqual({ skipped: true });
    await expectError(svc('cal_source_targets', { p_source: teste, p_profile: w.users.Ana }), 'paradas');
    const g = await rpc<any>(w.users.Rui, 'cal_event_get', { p_section: S(), p_event: ev });
    expect(g.source).toMatchObject({ readonly: false, source_status: 'parada' });
    await rpc(w.users.Rui, 'cal_update_event', { p_section: S(), p_event: ev, p_data: { title: 'Reunião de pais (app)', all_day: false, starts_at: g.starts_at, ends_at: g.ends_at, audience: 'equipa', team_id: w.teamA } });
    await rpc(w.users.Ana, 'cal_source_resume', { p_section: S(), p_source: teste });
    expect((await sourceRow(teste)).status).toBe('ativa');
  });
});

describe('desligar com arquivo e tarefa de hora a hora', () => {
  it('arquivar cancela as que ainda não terminaram e preserva o passado e as atas', async () => {
    const past = (await admin(`insert into public.cal_events (section_id, space, title, all_day, start_date, end_date, created_by, source_id, source_uid, source_rid, source_state)
      values ($1, 'real', 'Reunião antiga', true, current_date - 20, current_date - 20, $2, $3, 'antiga@icloud', '', 'ok') returning id`, [S(), w.users.Ana, real]))[0].id;
    const active = (await rows(real)).filter((e) => e.status === 'ativo' && e.id !== past).length;
    expect(await rpc(w.users.Ana, 'cal_source_disconnect', { p_section: S(), p_source: real, p_mode: 'arquivar' })).toBe(active);
    expect((await admin(`select status from public.cal_events where id = $1`, [past]))[0].status).toBe('ativo');
    const raid = await byUid(real, 'raid@icloud');
    expect(raid).toMatchObject({ status: 'cancelado', source_state: 'arquivado' });
    expect((await rpc<any>(w.users.Rui, 'ata_get', { p_section: S(), p_ata: ata })).event.id).toBe(raidId);
    expect((await svc<any[]>('cal_source_targets', {})).map((x) => x.id)).toEqual([teste]);
    await expectError(rpc(w.users.Ana, 'cal_source_update', { p_section: S(), p_source: real, p_data: {} }), 'arquivada');
  });

  it('segredo da tarefa e pedido à função /api/icloud', async () => {
    const secret = (await admin(`select secret from private.cal_icloud_config`))[0].secret as string;
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(await svc('cal_icloud_check_secret', { p_secret: 'errado' })).toBe(false);
    expect(await svc('cal_icloud_check_secret', { p_secret: '' })).toBe(false);
    expect(await svc('cal_icloud_check_secret', { p_secret: secret })).toBe(true);
    await admin(`delete from net.test_requests`);
    await admin(`select private.cal_icloud_tick()`);
    const req = await admin(`select url, headers from net.test_requests`);
    expect(req).toHaveLength(1);
    expect(req[0].url).toBe('https://sistema-progresso.vercel.app/api/icloud');
    expect(req[0].headers['x-cron-secret']).toBe(secret);
  });
});
