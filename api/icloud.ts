// Calendário do iCloud (só leitura): POST com sessão de administração (pré-visualizar,
// ligar, sincronizar agora) ou com o segredo da tarefa de hora a hora (pg_cron + pg_net).
// Precisa das variáveis SUPABASE_URL e SUPABASE_SECRET_KEY na Vercel (as mesmas do push).
// Opcional: ICAL_ALLOWED_HOSTS (domínios extra além de icloud.com, separados por vírgulas).
import { createClient } from '@supabase/supabase-js';
import { IcalError, toHttpsUrl } from './_ical.js';
import { handleIcloud, type IcloudDeps } from './_icloud_core.js';

const MAX_BYTES = 10 * 1024 * 1024;
const extraHosts = (process.env.ICAL_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);

/** Lê o link (seguindo até 4 redirecionamentos, sempre para endereços do iCloud). */
async function fetchText(url: string): Promise<string> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1', 'User-Agent': 'Pioneiros-Calendario/1.0 (+leitura)' },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new IcalError(timeout ? 'O iCloud demorou demasiado a responder. Tenta de novo mais tarde.' : 'Não foi possível contactar o iCloud. Tenta de novo mais tarde.');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = toHttpsUrl(new URL(res.headers.get('location')!, current).toString(), extraHosts);
      continue;
    }
    if (res.status === 404 || res.status === 403 || res.status === 410) {
      throw new IcalError(`O iCloud respondeu com o código ${res.status}: confirma que o calendário continua partilhado como calendário público.`);
    }
    if (!res.ok) throw new IcalError(`O iCloud respondeu com o código ${res.status}. Tenta de novo mais tarde.`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) throw new IcalError('O calendário é demasiado grande (mais de 10 MB).');
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new IcalError('O calendário é demasiado grande (mais de 10 MB).');
    return new TextDecoder('utf-8').decode(buf);
  }
  throw new IcalError('Demasiados redirecionamentos ao ler o calendário.');
}

function deps(): IcloudDeps {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Falta configurar SUPABASE_SECRET_KEY na Vercel.');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    fetchText,
    extraHosts,
    userId: async (token) => {
      const { data, error } = await db.auth.getUser(token);
      return error ? null : data.user?.id ?? null;
    },
    rpc: async <T>(fn: string, args: Record<string, unknown> = {}) => {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw new Error(error.message);
      return data as T;
    },
  };
}

export async function POST(request: Request) {
  try {
    return await handleIcloud(request, deps());
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'erro' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}
