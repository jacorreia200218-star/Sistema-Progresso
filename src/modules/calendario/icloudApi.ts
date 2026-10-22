// Pedidos à função /api/icloud (a leitura do iCloud é feita no servidor, nunca no navegador).
// A sessão vai no cabeçalho; o servidor confirma que a pessoa é da administração.
import { supabase } from '../../lib/supabase';

export interface IcloudPreview {
  name: string | null;
  events: number;
  cancelled: number;
  first: string | null;
  last: string | null;
  complete: boolean;
  warnings: string[];
  sample: { title: string; day: string; all_day: boolean; starts_at: string | null }[];
}

export type SyncStats = Partial<Record<'criadas' | 'atualizadas' | 'canceladas' | 'removidas' | 'reativadas' | 'sem_alteracao' | 'ignoradas' | 'por_rever', number>>;

export interface IcloudSource {
  id: string;
  space: 'real' | 'teste';
  kind: 'icloud';
  name: string;
  calname: string | null;
  url_mask: string;
  audience: 'seccao' | 'equipa';
  team_id: string | null;
  team_name: string | null;
  reminder_minutes: number[];
  status: 'ativa' | 'parada' | 'arquivada';
  review: boolean;
  pending_review: number;
  created_at: string;
  created_by_name: string | null;
  stopped_at: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  failures: number;
  last_stats: SyncStats | null;
  last_warning: string | null;
  pending_removals: number;
  event_count: number;
  range_from: string | null;
  range_to: string | null;
  cancelled_count: number;
  removed_count: number;
}

export interface IcloudOverview {
  calendar_status: 'desenvolvimento' | 'teste' | 'disponivel';
  auto_sync: boolean;
  sources: IcloudSource[];
}

export async function icloudRequest<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Tens de entrar na tua conta primeiro.');
  let res: Response;
  try {
    res = await fetch('/api/icloud', {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Sem ligação ao servidor. Verifica a internet e tenta de novo.');
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !json) throw new Error(json?.error || `O servidor não respondeu como esperado (${res.status}).`);
  return json;
}

const PARTS: [keyof SyncStats, string, string][] = [
  ['criadas', 'nova', 'novas'], ['atualizadas', 'alterada', 'alteradas'], ['canceladas', 'cancelada', 'canceladas'],
  ['removidas', 'removida', 'removidas'], ['reativadas', 'reativada', 'reativadas'], ['por_rever', 'por rever', 'por rever'],
];

/** «3 novas, 1 alterada» ou «sem alterações». */
export function statsLabel(s: SyncStats | null | undefined): string {
  if (!s) return '—';
  const out = PARTS.filter(([k]) => (s[k] ?? 0) > 0).map(([k, one, many]) => `${s[k]} ${s[k] === 1 ? one : many}`);
  return out.length ? out.join(', ') : 'sem alterações';
}
