// Tesouraria: tipos e leituras (todas por RPC; o servidor decide o que cada pessoa vê).
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api';
import { useActiveSection } from '../../lib/session';
import { MONTHS, todayLisbon } from '../common';

export type Kind = 'receita' | 'despesa';
export type MovState = 'previsto' | 'pendente' | 'efetivo';
export type Totals = { receitas: number; despesas: number; saldo: number };

export type Account = { id: string; name: string; kind: 'conta' | 'caixa'; archived: boolean };
export type Options = {
  can_manage: boolean; space: 'teste' | 'real'; accounts: Account[]; categories: string[];
  opening: { account_id: string | null; reference_date: string }[];
};
export type ActivityOption = { id: string; title: string; status: string; day: string | null };
export type Member = { profile_id: string; full_name: string; function: string | null; team_id: string | null };

export type Opening = {
  id: string; account_id: string | null; account_name: string | null; reference_date: string; amount_cents: number;
  notes?: string | null; created_by_name?: string | null; created_at?: string; updated_by_name?: string | null; updated_at?: string;
  voided_at?: string | null; void_reason?: string | null;
};

/** Movimento como aparece na lista partilhada (quem gere recebe o Movement completo). */
export type SharedMovement = {
  id: string; kind: Kind; occurred_on: string; description: string; category: string; amount_cents: number; state: MovState;
  activity_id: string | null; activity_title: string | null; voided_at: string | null; files: number;
  individual?: boolean; mine?: boolean; before_opening?: boolean;
  member_name?: string | null; account_name?: string | null; replaced_by?: string | null; notes?: string | null;
};
export type SearchResult = { can_manage: boolean; total: number; limit: number; items: SharedMovement[] };

export type EvolutionPoint = { date: string; kind: 'inicio' | 'mes' | 'dia'; saldo: number };
export type Dashboard = {
  can_manage: boolean; space: 'teste' | 'real'; today: string;
  opening: { mode: 'nenhum' | 'global' | 'conta'; total: number; reference_date: string | null; items: Opening[] };
  current: { saldo_inicial: number; receitas: number; despesas: number; saldo: number };
  before_opening: { count: number; receitas: number; despesas: number };
  totals: Record<MovState, Totals>;
  count: number;
  evolution: { granularity: 'mes' | 'dia' | null; from: string | null; to: string | null; points: EvolutionPoint[] };
  latest: SharedMovement[];
  by_category: { category: string; kind: Kind; efetivo: number; pendente: number; previsto: number }[];
  activity: ActivityResult | null;
  accounts: { id: string; name: string; kind: 'conta' | 'caixa'; archived: boolean; opening: Opening | null; movimentos: number; saldo: number }[];
  years: number[];
};

export type Movement = {
  id: string; kind: Kind; occurred_on: string; description: string; category: string; amount_cents: number; state: MovState;
  notes: string | null; account_id: string; account_name: string | null; activity_id: string | null; activity_title: string | null;
  member_profile_id: string | null; member_name: string | null; quota_charge_id: string | null; quota_name: string | null;
  corrects_id: string | null; replaced_by: string | null; voided_at: string | null; void_reason: string | null; voided_by_name: string | null;
  created_by_name: string | null; created_at: string; updated_by_name: string | null; updated_at: string; files: number;
};

export type Charge = {
  id: string; quota_id: string; profile_id: string; member_name: string | null; amount_cents: number; status: 'ativa' | 'isenta';
  waive_reason: string | null; pago: number; pendente: number; em_falta: number; excesso: number;
};
export type Quota = {
  id: string; name: string; period_start: string; period_end: string; amount_cents: number; due_date: string;
  status: 'ativa' | 'anulada'; void_reason: string | null; charges: Charge[];
};

export type MyCharge = Charge & { quota_name: string; period_start: string; period_end: string; due_date: string; quota_status: string };
export type MySituation = {
  charges: MyCharge[];
  totals: { devido: number; pago: number; pendente: number; em_falta: number };
  payments: { id: string; occurred_on: string; description: string; category: string; amount_cents: number; state: MovState; quota_name: string | null; files: number }[];
};

export type ActivityResult = {
  activity_id: string; title: string; status: string; day: string | null;
  orcamento: { receitas: number; despesas: number; resultado: number };
  efetivo: { receitas: number; despesas: number; resultado: number };
  por_confirmar: { receitas: number; despesas: number; resultado: number };
  lines: { id: string; kind: Kind; category: string; description: string; amount_cents: number }[];
  by_category: { category: string; kind: Kind; orcamento: number; efetivo: number }[];
};

export type HistoryRow = { id: number; entity: string; action: string; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null; actor_name: string | null; at: string };

export const STATE_LABEL: Record<MovState, string> = { previsto: 'Previsto', pendente: 'Pendente', efetivo: 'Efetivo' };
export const STATE_TONE: Record<MovState, 'muted' | 'attention' | 'ok'> = { previsto: 'muted', pendente: 'attention', efetivo: 'ok' };
export const KIND_LABEL: Record<Kind, string> = { receita: 'Receita', despesa: 'Despesa' };

export function useSectionId() {
  return useActiveSection().membership.section_id;
}

/** Ano escutista (setembro a agosto) a que pertence um dia: devolve o ano em que começa. */
export function scoutYearOf(day: string): number {
  const [y, m] = day.split('-').map(Number);
  return m >= 9 ? y : y - 1;
}
export const scoutYearLabel = (y: number) => `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
/** Meses de um ano escutista, de setembro a agosto, como «AAAA-MM». */
export function scoutMonths(y: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((8 + i) % 12) + 1;
    return `${m >= 9 ? y : y + 1}-${String(m).padStart(2, '0')}`;
  });
}
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;
const lastDay = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/**
 * Filtros partilhados (no URL): ano escutista («ano», por omissão o atual; «todos» = todo o
 * período), mês («mes» = AAAA-MM), atividade, categoria, estado e pesquisa («q»).
 */
export type Filters = {
  ano: number | 'todos'; mes: string | null; atividade: string | null; categoria: string | null; estado: string | null; q: string | null;
  de: string | null; ate: string | null;
};
export function filtersFrom(params: URLSearchParams, today = todayLisbon()): Filters {
  const anoRaw = params.get('ano');
  const ano: number | 'todos' = anoRaw === 'todos' ? 'todos' : anoRaw && /^\d{4}$/.test(anoRaw) ? Number(anoRaw) : scoutYearOf(today);
  const mesRaw = params.get('mes');
  const mes = ano !== 'todos' && mesRaw && /^\d{4}-(0[1-9]|1[0-2])$/.test(mesRaw) && scoutMonths(ano).includes(mesRaw) ? mesRaw : null;
  const estado = params.get('estado');
  const q = (params.get('q') ?? '').trim();
  const de = mes ? `${mes}-01` : ano === 'todos' ? null : `${ano}-09-01`;
  const ate = mes ? lastDay(mes) : ano === 'todos' ? null : `${ano + 1}-08-31`;
  return {
    ano, mes, de, ate, atividade: params.get('atividade') || null, categoria: params.get('categoria') || null,
    estado: estado && ['previsto', 'pendente', 'efetivo'].includes(estado) ? estado : null, q: q ? q.slice(0, 100) : null,
  };
}
export const filterArgs = (f: Filters) => ({ p_from: f.de, p_to: f.ate, p_activity: f.atividade });

export function periodLabel(f: Filters) {
  if (f.mes) return monthLabel(f.mes);
  if (f.ano === 'todos') return 'todo o período';
  return `ano escutista ${scoutYearLabel(f.ano)}`;
}

export function useOptions() {
  const s = useSectionId();
  return useQuery({ queryKey: ['fin', 'options', s], queryFn: () => call<Options>('fin_options', { p_section: s }) });
}
export function useActivities() {
  const s = useSectionId();
  return useQuery({ queryKey: ['fin', 'activities', s], queryFn: () => call<ActivityOption[]>('fin_activity_options', { p_section: s }) });
}
export function useMembersFin(enabled: boolean) {
  const s = useSectionId();
  return useQuery({ queryKey: ['fin', 'members', s], queryFn: () => call<Member[]>('fin_members', { p_section: s }), enabled });
}
export function useDashboard(f: Filters) {
  const s = useSectionId();
  return useQuery({ queryKey: ['fin', 'dashboard', s, f.de, f.ate, f.atividade], queryFn: () => call<Dashboard>('fin_dashboard', { p_section: s, ...filterArgs(f) }) });
}
/** Lista partilhada com pesquisa (quem gere recebe também os dados privados e os anulados). */
export function useSearchMovements(f: Filters, includeVoided: boolean) {
  const s = useSectionId();
  return useQuery({
    queryKey: ['fin', 'search', s, f, includeVoided],
    queryFn: () => call<SearchResult>('fin_search_movements', {
      p_section: s, ...filterArgs(f), p_category: f.categoria, p_state: f.estado, p_search: f.q, p_include_voided: includeVoided, p_limit: 300,
    }),
  });
}
/** Todos os movimentos com os dados privados (só quem gere). */
export function useAllMovements(enabled = true) {
  const s = useSectionId();
  return useQuery({
    queryKey: ['fin', 'movements', s], enabled,
    queryFn: () => call<Movement[]>('fin_list_movements', { p_section: s, p_include_voided: true }),
  });
}
export function useOpeningBalances() {
  const s = useSectionId();
  return useQuery({ queryKey: ['fin', 'opening', s], queryFn: () => call<Opening[]>('fin_list_opening_balances', { p_section: s }) });
}
export function useQuotas(enabled = true) {
  const s = useSectionId();
  return useQuery({ queryKey: ['fin', 'quotas', s], queryFn: () => call<Quota[]>('fin_list_quotas', { p_section: s }), enabled });
}
export function useMySituation() {
  const s = useSectionId();
  return useQuery({ queryKey: ['fin', 'mine', s], queryFn: () => call<MySituation>('fin_my_situation', { p_section: s }) });
}
export function useActivityResults() {
  const s = useSectionId();
  return useQuery({ queryKey: ['fin', 'results', s], queryFn: () => call<ActivityResult[]>('fin_activity_results', { p_section: s, p_activity: null }) });
}
export function useHistory(id: string) {
  const s = useSectionId();
  return useQuery({ queryKey: ['fin', 'history', s, id], queryFn: () => call<HistoryRow[]>('fin_history', { p_section: s, p_entity_id: id }) });
}

/** Identificador do envio (evita registar duas vezes o mesmo formulário). */
export function newClientKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Valor em cêntimos para CSV (sem símbolo, vírgula decimal). */
export function csvEuros(cents: number) {
  const neg = cents < 0;
  const a = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`;
}
