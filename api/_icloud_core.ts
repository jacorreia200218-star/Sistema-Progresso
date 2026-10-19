// Calendário do iCloud: pedidos da gestão (pré-visualizar, ligar, sincronizar agora) e da
// tarefa de hora a hora da base de dados. Separado do ponto de entrada para ser testado
// sem rede: a leitura do link, a verificação da sessão e as funções da base de dados são
// injetadas. Nunca escreve no iCloud.
import { IcalError, parseIcs, summarize, toHttpsUrl, type IcalFeed } from './_ical.js';

export type IcloudDeps = {
  /** Lê o conteúdo do link (https), com limites de tempo e tamanho. Lança IcalError com a explicação. */
  fetchText: (url: string) => Promise<string>;
  /** Pessoa da sessão (JWT do Supabase) ou null. */
  userId: (token: string) => Promise<string | null>;
  rpc: <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;
  extraHosts?: string[];
  now?: () => Date;
};

type Target = { id: string; section_id: string; url: string };
export type SyncResult = { id: string; ok: boolean; stats?: Record<string, unknown>; error?: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const fail = (error: string, status = 400) => json({ error }, status);

const message = (e: unknown) => (e instanceof Error ? e.message : 'Erro desconhecido.');

async function read(url: string, deps: IcloudDeps): Promise<IcalFeed> {
  const text = await deps.fetchText(url);
  return parseIcs(text, { now: deps.now?.() });
}

/** Payload para a base de dados (sem avisos nem campos a mais). */
const feedPayload = (f: IcalFeed) => ({ name: f.name, complete: f.complete, window_from: f.window_from, window_to: f.window_to, items: f.items });

/** Lê e aplica uma fonte. Uma falha fica registada na fonte e não muda as atividades. */
export async function syncOne(t: Target, deps: IcloudDeps, force = false): Promise<SyncResult> {
  let feed: IcalFeed;
  try {
    feed = await read(toHttpsUrl(t.url, deps.extraHosts), deps);
  } catch (e) {
    const error = message(e);
    await deps.rpc('cal_source_fail', { p_source: t.id, p_error: error }).catch(() => undefined);
    return { id: t.id, ok: false, error };
  }
  try {
    const stats = await deps.rpc<Record<string, unknown>>('cal_source_apply', { p_source: t.id, p_feed: feedPayload(feed), p_force: force });
    return { id: t.id, ok: true, stats };
  } catch (e) {
    const error = `Não foi possível guardar: ${message(e)}`;
    await deps.rpc('cal_source_fail', { p_source: t.id, p_error: error }).catch(() => undefined);
    return { id: t.id, ok: false, error };
  }
}

function sameSecret(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Tarefa de hora a hora: todas as fontes ativas, uma a uma, dentro do tempo disponível. */
async function cron(secret: string, deps: IcloudDeps) {
  if (!(await deps.rpc<boolean>('cal_icloud_check_secret', { p_secret: secret }))) return fail('forbidden', 403);
  const targets = await deps.rpc<Target[]>('cal_source_targets', {});
  const started = Date.now();
  const results: SyncResult[] = [];
  for (const t of targets) {
    if (Date.now() - started > 45_000) break; // as restantes ficam para a hora seguinte
    results.push(await syncOne(t, deps));
  }
  return json({ synced: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results: results.map(({ id, ok }) => ({ id, ok })) });
}

type Body = {
  action?: string; section_id?: string; url?: string; source_id?: string; force?: boolean;
  name?: string; space?: string; audience?: string; team_id?: string | null; reminder_minutes?: number[];
};

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

export async function handleIcloud(request: Request, deps: IcloudDeps): Promise<Response> {
  if (request.method !== 'POST') return fail('Método não permitido.', 405);
  const secret = request.headers.get('x-cron-secret');
  if (secret !== null) return cron(secret, deps);

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const user = token ? await deps.userId(token).catch(() => null) : null;
  if (!user) return fail('Tens de entrar na tua conta primeiro.', 401);
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== 'object') return fail('Pedido inválido.');
  const section = body.section_id;
  if (!isUuid(section)) return fail('Pedido inválido.');
  if (!(await deps.rpc<boolean>('cal_source_admin_ok', { p_profile: user, p_section: section }))) {
    return fail('Reservado à administração.', 403);
  }

  try {
    if (body.action === 'preview' || body.action === 'create') {
      const url = toHttpsUrl(String(body.url ?? ''), deps.extraHosts);
      const feed = await read(url, deps);
      const preview = summarize(feed, deps.now?.());
      if (body.action === 'preview') return json({ preview });
      const id = await deps.rpc<string>('cal_source_create', {
        p_profile: user, p_section: section,
        p_data: {
          url, name: (body.name ?? '').trim() || feed.name || 'Calendário do iCloud', calname: feed.name,
          space: body.space ?? 'real', audience: body.audience ?? 'seccao', team_id: body.team_id ?? null,
          reminder_minutes: Array.isArray(body.reminder_minutes) ? body.reminder_minutes : [],
        },
      });
      const stats = await deps.rpc<Record<string, unknown>>('cal_source_apply', { p_source: id, p_feed: feedPayload(feed), p_force: false });
      return json({ id, stats, preview });
    }
    if (body.action === 'sync') {
      if (!isUuid(body.source_id)) return fail('Pedido inválido.');
      const targets = await deps.rpc<Target[]>('cal_source_targets', { p_source: body.source_id, p_profile: user });
      if (!targets.length) return fail('Registo não encontrado.', 404);
      const r = await syncOne(targets[0], deps, body.force === true);
      return r.ok ? json({ stats: r.stats }) : fail(r.error ?? 'Erro desconhecido.', 502);
    }
    return fail('Ação desconhecida.');
  } catch (e) {
    return fail(message(e), e instanceof IcalError ? 422 : 400);
  }
}
