// @vitest-environment node
// Pedidos à função /api/icloud, sem rede: a leitura do link e a base de dados são simuladas.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { IcalError } from './_ical';
import { handleIcloud, type IcloudDeps } from './_icloud_core';

const SEC = '11111111-2222-3333-4444-555555555555';
const SRC = '99999999-2222-3333-4444-555555555555';
const LINK = 'webcal://p00-caldav.icloud.com/published/2/FICTICIO';
const ics = readFileSync(path.resolve('tests/fixtures/ical/recorrente.ics'), 'utf8');

function fake(over: Partial<IcloudDeps> = {}, rpcs: Record<string, unknown> = {}) {
  const calls: { fn: string; args: any }[] = [];
  const d: IcloudDeps = {
    fetchText: vi.fn(async () => ics),
    userId: vi.fn(async (t) => (t === 'jwt-admin' ? 'u-admin' : t === 'jwt-membro' ? 'u-membro' : null)),
    rpc: vi.fn(async (fn: string, args: any = {}) => {
      calls.push({ fn, args });
      if (fn in rpcs) return (typeof rpcs[fn] === 'function' ? (rpcs[fn] as any)(args) : rpcs[fn]) as any;
      if (fn === 'cal_source_admin_ok') return args.p_profile === 'u-admin';
      if (fn === 'cal_source_create') return SRC;
      if (fn === 'cal_source_apply') return { criadas: args.p_feed.items.length };
      if (fn === 'cal_source_targets') return [{ id: SRC, section_id: SEC, url: 'https://p00-caldav.icloud.com/published/2/FICTICIO' }];
      if (fn === 'cal_icloud_check_secret') return args.p_secret === 'segredo-certo';
      return null;
    }) as IcloudDeps['rpc'],
    now: () => new Date('2026-10-18T12:00:00Z'),
    ...over,
  };
  return { d, calls };
}
const post = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer jwt-admin' }) =>
  new Request('https://app.example/api/icloud', { method: 'POST', headers, body: JSON.stringify(body) });

describe('/api/icloud', () => {
  it('sem sessão ou sem ser administração: recusa e não lê o link', async () => {
    const { d } = fake();
    expect((await handleIcloud(post({ action: 'preview', section_id: SEC, url: LINK }, {}), d)).status).toBe(401);
    expect((await handleIcloud(post({ action: 'preview', section_id: SEC, url: LINK }, { authorization: 'Bearer jwt-membro' }), d)).status).toBe(403);
    expect(d.fetchText).not.toHaveBeenCalled();
    expect((await handleIcloud(new Request('https://app.example/api/icloud'), d)).status).toBe(405);
  });

  it('pré-visualizar: converte webcal, lê, mostra nome, número e datas; não guarda nada', async () => {
    const { d, calls } = fake();
    const res = await handleIcloud(post({ action: 'preview', section_id: SEC, url: LINK }), d);
    expect(res.status).toBe(200);
    const { preview } = await res.json();
    expect(d.fetchText).toHaveBeenCalledWith('https://p00-caldav.icloud.com/published/2/FICTICIO');
    expect(preview).toMatchObject({ name: 'Reuniões (fictício)', complete: true, first: '2025-09-01', last: '2027-11-30' });
    expect(preview.events).toBeGreaterThan(800);
    expect(calls.map((c) => c.fn)).toEqual(['cal_source_admin_ok']);
  });

  it('link inválido ou fora do iCloud e conteúdo que não é calendário: erro claro', async () => {
    const { d } = fake();
    const bad = await handleIcloud(post({ action: 'preview', section_id: SEC, url: 'https://exemplo.invalid/x.ics' }), d);
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toContain('iCloud');
    const html = fake({ fetchText: async () => '<html>Erro</html>' }).d;
    expect((await (await handleIcloud(post({ action: 'preview', section_id: SEC, url: LINK }), html)).json()).error).toContain('não devolveu um calendário');
    const down = fake({ fetchText: async () => { throw new IcalError('O iCloud respondeu com o código 404.'); } }).d;
    expect((await (await handleIcloud(post({ action: 'preview', section_id: SEC, url: LINK }), down)).json()).error).toContain('404');
  });

  it('ligar: volta a verificar, guarda o link https e importa', async () => {
    const { d, calls } = fake();
    const res = await handleIcloud(post({ action: 'create', section_id: SEC, url: LINK, name: '', space: 'real', audience: 'seccao' }), d);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(SRC);
    const create = calls.find((c) => c.fn === 'cal_source_create')!;
    expect(create.args).toMatchObject({ p_profile: 'u-admin', p_section: SEC, p_data: { url: 'https://p00-caldav.icloud.com/published/2/FICTICIO', name: 'Reuniões (fictício)', space: 'real', reminder_minutes: [] } });
    const apply = calls.find((c) => c.fn === 'cal_source_apply')!;
    expect(apply.args.p_feed).toMatchObject({ complete: true, window_from: '2025-09-01', window_to: '2027-11-30' });
    expect(apply.args.p_feed.warnings).toBeUndefined();
  });

  it('sincronizar agora: falha de leitura fica registada e não aplica nada', async () => {
    const { d, calls } = fake({ fetchText: async () => { throw new IcalError('Não foi possível contactar o iCloud.'); } });
    const res = await handleIcloud(post({ action: 'sync', section_id: SEC, source_id: SRC }), d);
    expect(res.status).toBe(502);
    expect(calls.map((c) => c.fn)).toEqual(['cal_source_admin_ok', 'cal_source_targets', 'cal_source_fail']);
    expect(calls[2].args).toEqual({ p_source: SRC, p_error: 'Não foi possível contactar o iCloud.' });
  });

  it('sincronizar agora com confirmação de remoções', async () => {
    const { d, calls } = fake();
    expect((await handleIcloud(post({ action: 'sync', section_id: SEC, source_id: SRC, force: true }), d)).status).toBe(200);
    expect(calls.find((c) => c.fn === 'cal_source_targets')!.args).toEqual({ p_source: SRC, p_profile: 'u-admin' });
    expect(calls.find((c) => c.fn === 'cal_source_apply')!.args.p_force).toBe(true);
  });

  it('tarefa de hora a hora: exige o segredo e sincroniza todas as fontes ativas', async () => {
    const { d, calls } = fake();
    expect((await handleIcloud(post({}, { 'x-cron-secret': 'errado' }), d)).status).toBe(403);
    expect(calls.some((c) => c.fn === 'cal_source_targets')).toBe(false);
    const ok = await handleIcloud(post({}, { 'x-cron-secret': 'segredo-certo' }), d);
    expect(await ok.json()).toMatchObject({ synced: 1, failed: 0 });
    expect(calls.filter((c) => c.fn === 'cal_source_apply')).toHaveLength(1);
  });
});
