// Tesouraria: tipos e leituras (todas por RPC; o servidor decide o que cada pessoa vê).
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api';
import { useActiveSection } from '../../lib/session';
import { formatDay } from '../common';

export type Kind = 'receita' | 'despesa';
export type MovState = 'previsto' | 'pendente' | 'efetivo';
export type Totals = { receitas: number; despesas: number; saldo: number };

export type Account = { id: string; name: string; kind: 'conta' | 'caixa'; archived: boolean };
export type Options = { can_manage: boolean; space: 'teste' | 'real'; accounts: Account[]; categories: string[] };
export type ActivityOption = { id: string; title: string; status: string; day: string | null };
export type Member = { profile_id: string; full_name: string; function: string | null; team_id: string | null };

export type Summary = {
  can_manage: boolean;
  totals: Record<MovState, Totals>;
  by_category: { category: string; kind: Kind; efetivo: number; pendente: number; previsto: number }[];
  by_activity: { activity_id: string; title: string; receitas: number; despesas: number; saldo: number; pendente_saldo: number }[];
  accounts: { id: string; name: string; kind: string; saldo: number }[];
  count: number;
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

/** Filtros partilhados (no URL): período, categoria, atividade e estado. */
export type Filters = { de: string | null; ate: string | null; categoria: string | null; atividade: string | null; estado: string | null };
export function filtersFrom(params: URLSearchParams): Filters {
  const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const estado = params.get('estado');
  return {
    de: day(params.get('de')), ate: day(params.get('ate')), categoria: params.get('categoria') || null,
    atividade: params.get('atividade') || null, estado: estado && ['previsto', 'pendente', 'efetivo'].includes(estado) ? estado : null,
  };
}
export const filterArgs = (f: Filters) => ({ p_from: f.de, p_to: f.ate, p_category: f.categoria, p_activity: f.atividade });

export function periodLabel(f: Filters) {
  if (f.de && f.ate) return `${formatDay(f.de)} a ${formatDay(f.ate)}`;
  if (f.de) return `desde ${formatDay(f.de)}`;
  if (f.ate) return `até ${formatDay(f.ate)}`;
  return 'todo o período';
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
export function useSummary(f: Filters) {
  const s = useSectionId();
  return useQuery({ queryKey: ['fin', 'summary', s, f], queryFn: () => call<Summary>('fin_summary', { p_section: s, ...filterArgs(f) }) });
}
export function useMovements(f: Filters, enabled = true) {
  const s = useSectionId();
  return useQuery({
    queryKey: ['fin', 'movements', s, f], enabled,
    queryFn: () => call<Movement[]>('fin_list_movements', { p_section: s, ...filterArgs(f), p_state: f.estado, p_include_voided: true }),
  });
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
