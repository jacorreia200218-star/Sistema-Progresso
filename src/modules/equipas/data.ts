// Equipas e cargos: tipos, leitura (uma RPC verificada no servidor) e regras de
// apresentação puras (ano escutista, estado das nomeações, composição por ano).
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api';
import { useActiveSection } from '../../lib/session';
import { formatDay } from '../common';
import { scoutYearBounds, scoutYearFromLabel, scoutYearLabel, scoutYearOf } from '../../lib/anoEscutista';

export type RoleKind = 'guia' | 'subguia' | 'cargo';
export interface EqTeam { id: string; name: string; archived_at: string | null; color: string | null; motto: string | null; emblem: { path: string; file_name: string } | null }
export interface EqMember { membership_id: string; profile_id: string; full_name: string; totem: string | null; function: string | null; status: string; team_id: string | null; since: string | null }
export interface EqRole { id: string; name: string; kind: RoleKind; description: string | null; single: boolean; archived_at: string | null }
export interface EqAppointment {
  id: string; role_id: string; team_id: string; membership_id: string; starts_on: string; ends_on: string | null; end_reason: string | null;
  notes: string | null; remind_days: number | null; cancelled_at: string | null; cancel_reason: string | null; created_at: string;
  created_by_name: string | null; ended_by_name: string | null;
}
export interface EqMove {
  id: string; membership_id: string; on: string; at: string; from_team_id: string | null; to_team_id: string | null; reason: string | null;
  source: 'modulo' | 'gestao'; applied: boolean; by_name: string | null;
}
export interface EqOverview {
  space: 'teste' | 'real'; can_manage: boolean; today: string; year: string; me: string | null;
  teams: EqTeam[]; members: EqMember[]; roles: EqRole[]; appointments: EqAppointment[]; moves: EqMove[];
}

export function useSectionId() {
  return useActiveSection().membership!.section_id;
}

export function useEquipas() {
  const section = useSectionId();
  return useQuery({ queryKey: ['eq-overview', section], queryFn: () => call<EqOverview>('eq_overview', { p_section: section }) });
}

export const ROLE_KIND_LABEL: Record<RoleKind, string> = { guia: 'Guia', subguia: 'Subguia', cargo: 'Outro cargo' };

/** Paleta suave para a cor da equipa (funciona em claro e escuro). */
export const TEAM_COLORS: { value: string; label: string }[] = [
  { value: '#2f6fb5', label: 'Azul' }, { value: '#2f7d4f', label: 'Verde' }, { value: '#b5472f', label: 'Vermelho' },
  { value: '#c28a1b', label: 'Amarelo' }, { value: '#7a4fb5', label: 'Roxo' }, { value: '#1f8a8a', label: 'Verde-água' },
  { value: '#b5577f', label: 'Rosa' }, { value: '#8a5a32', label: 'Castanho' }, { value: '#4a5361', label: 'Cinzento' },
];

// ---------------------------------------------------------------------------
// Ano escutista (setembro a agosto, definido em lib/anoEscutista)
// ---------------------------------------------------------------------------
/** «2026-10-15» → «2026/27»; «2027-08-31» → «2026/27». */
export const scoutYear = (day: string): string => scoutYearLabel(scoutYearOf(day));

/** Limites do ano escutista (fim exclusivo): «2026/27» → [2026-09-01, 2027-09-01). */
export function yearBounds(label: string): [string, string] {
  const start = scoutYearFromLabel(label);
  return [scoutYearBounds(start).from, scoutYearBounds(start + 1).from];
}

/** Anos com registos (do mais recente para o mais antigo), sempre incluindo o atual. */
export function yearOptions(o: Pick<EqOverview, 'today' | 'appointments' | 'moves'>): string[] {
  const days = [o.today, ...o.appointments.map((a) => a.starts_on), ...o.appointments.flatMap((a) => (a.ends_on ? [a.ends_on] : [])), ...o.moves.map((m) => m.on)];
  const starts = days.map((d) => Number(scoutYear(d).slice(0, 4)));
  const min = Math.min(...starts);
  const max = Math.max(...starts);
  const out: string[] = [];
  for (let y = max; y >= min; y--) out.push(scoutYearLabel(y));
  return out;
}

// ---------------------------------------------------------------------------
// Nomeações: período [início, fim) — o dia de fim é o da passagem de testemunho.
// ---------------------------------------------------------------------------
export type AppointmentState = 'ativo' | 'futuro' | 'terminado' | 'anulado';

export function appointmentState(a: Pick<EqAppointment, 'starts_on' | 'ends_on' | 'cancelled_at'>, today: string): AppointmentState {
  if (a.cancelled_at) return 'anulado';
  if (a.ends_on && a.ends_on <= today && a.ends_on >= a.starts_on) return 'terminado';
  if (a.starts_on > today) return 'futuro';
  return 'ativo';
}

export const STATE_LABEL: Record<AppointmentState, string> = { ativo: 'Em funções', futuro: 'A começar', terminado: 'Terminado', anulado: 'Anulado' };
export const STATE_TONE: Record<AppointmentState, 'ok' | 'progress' | 'muted' | 'attention'> = { ativo: 'ok', futuro: 'progress', terminado: 'muted', anulado: 'attention' };

/** A nomeação esteve (em parte) dentro do ano escutista indicado? */
export function inYear(a: Pick<EqAppointment, 'starts_on' | 'ends_on'>, label: string): boolean {
  const [from, to] = yearBounds(label);
  return a.starts_on < to && (a.ends_on ?? '9999-12-31') >= from;
}

export function periodLabel(a: Pick<EqAppointment, 'starts_on' | 'ends_on'>): string {
  return a.ends_on ? `${formatDay(a.starts_on)} a ${formatDay(a.ends_on)}` : `desde ${formatDay(a.starts_on)}`;
}

/** Ordena: em funções primeiro, depois a começar, terminados (mais recentes primeiro), anulados. */
export function sortAppointments<T extends EqAppointment>(list: T[], today: string): T[] {
  const rank: Record<AppointmentState, number> = { ativo: 0, futuro: 1, terminado: 2, anulado: 3 };
  return [...list].sort((a, b) => rank[appointmentState(a, today)] - rank[appointmentState(b, today)] || b.starts_on.localeCompare(a.starts_on));
}

// ---------------------------------------------------------------------------
// Composição de uma equipa num ano escutista, a partir do histórico de mudanças.
// ---------------------------------------------------------------------------
/** Equipa da pessoa em cada período: [{team, from, to}] (to exclusivo; null = até hoje). */
export function teamPeriods(member: Pick<EqMember, 'membership_id' | 'team_id' | 'since'>, moves: EqMove[]) {
  const mine = moves.filter((m) => m.membership_id === member.membership_id)
    .sort((a, b) => a.on.localeCompare(b.on) || a.at.localeCompare(b.at));
  if (!mine.length) return member.team_id ? [{ team: member.team_id, from: member.since ?? '0000-01-01', to: null as string | null }] : [];
  const periods: { team: string; from: string; to: string | null }[] = [];
  if (mine[0].from_team_id) periods.push({ team: mine[0].from_team_id, from: member.since ?? '0000-01-01', to: mine[0].on });
  mine.forEach((m, i) => {
    if (m.to_team_id) periods.push({ team: m.to_team_id, from: m.on, to: mine[i + 1]?.on ?? null });
  });
  // A equipa atual prevalece no último período (p. ex. alteração feita fora do módulo).
  const last = periods[periods.length - 1];
  if (last && last.to === null && member.team_id && last.team !== member.team_id) periods.push({ team: member.team_id, from: last.from, to: null });
  return periods.filter((p) => p.to === null || p.to > p.from);
}

/** Pessoas que pertenceram à equipa durante (parte d)o ano escutista. */
export function membersInYear(teamId: string, label: string, members: EqMember[], moves: EqMove[]): EqMember[] {
  const [from, to] = yearBounds(label);
  return members.filter((m) => teamPeriods(m, moves).some((p) => p.team === teamId && p.from < to && (p.to ?? '9999-12-31') > from));
}

export const functionName = (f: string | null) => (f === 'guia' ? 'Guia (função na app)' : f === 'pioneiro' ? 'Pioneiro' : f === 'dirigente' ? 'Dirigente' : 'Sem função pedagógica');
