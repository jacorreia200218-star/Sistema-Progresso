// Presenças: tipos, rótulos, leituras e períodos (ano escutista de setembro a agosto).
// Os indicadores vêm calculados do servidor; aqui só se formatam e se escolhem períodos.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api';
import { useActiveSection } from '../../lib/session';

export type PresStatus = 'presente' | 'justificada' | 'injustificada';
export type Category = PresStatus | 'por_registar' | 'futura' | 'cancelada';

export interface Stats {
  presencas: number; parciais: number; justificadas: number; injustificadas: number; faltas: number; contadas: number;
  por_registar: number; futuras: number; canceladas: number; taxa: number | string | null;
}
export interface SessionRow {
  id: string; date: string; title: string; kind: 'reuniao' | 'atividade'; audience: 'seccao' | 'equipa';
  team_id: string | null; team_name: string | null; cal_event_id: string | null; cal_title: string | null;
  status: 'ativa' | 'cancelada'; future: boolean; applicable: number; registered: number;
}
export interface MemberRow { membership_id: string; name: string; team_id: string | null; team_name: string | null; active: boolean; stats: Stats }
export interface Cell {
  s: string; m: string; status: PresStatus | null; partial: boolean; partial_note: string | null; has_justification: boolean; category: Category;
}
export interface Board {
  can_register: boolean; today: string; my_membership: string | null;
  teams: { id: string; name: string }[];
  sessions: SessionRow[]; members: MemberRow[]; cells: Cell[]; totals: Stats;
  by_team: { team_id: string | null; team_name: string | null; members: number; stats: Stats }[];
  by_month: { month: string; sessions: number; stats: Stats }[];
}
export interface SessionMember {
  membership_id: string; name: string; team_id: string | null; team_name: string | null;
  status: PresStatus | null; partial: boolean; partial_note: string | null; justification: string | null; category: Category;
  updated_at: string | null; updated_by_name: string | null;
}
export interface HistoryRow {
  id: number; membership_id?: string; name?: string; session_id?: string; session_title?: string; session_date?: string;
  old_status: PresStatus | null; new_status: PresStatus | null; old_partial: boolean | null; new_partial: boolean | null;
  justification_changed: boolean; reason: string | null; changed_at: string; changed_by_name: string | null;
}
export interface SessionDetail {
  can_register: boolean; today: string;
  session: {
    id: string; date: string; title: string; kind: 'reuniao' | 'atividade'; audience: 'seccao' | 'equipa'; team_id: string | null;
    team_name: string | null; notes: string | null; status: 'ativa' | 'cancelada'; cancel_reason: string | null;
    effective_status: 'ativa' | 'cancelada'; future: boolean;
    cal_event: { id: string; title: string; status: string; start: string; end: string } | null;
    created_by_name: string | null;
  };
  members: SessionMember[];
  history: HistoryRow[];
}
export interface MemberDetail {
  can_register: boolean; is_self: boolean; today: string;
  member: { membership_id: string; name: string; team_name: string | null; function: string | null; active: boolean; entry_date: string | null };
  stats: Stats;
  entries: { session_id: string; date: string; title: string; kind: string; audience: string; team_name: string | null;
    status: PresStatus | null; partial: boolean; partial_note: string | null; justification: string | null; category: Category }[];
  history: HistoryRow[];
}
export interface EventOption { id: string; title: string; audience: string; team_id: string | null; team_name: string | null; start: string; end: string }

export const STATUS_LABEL: Record<PresStatus | 'por_registar', string> = {
  presente: 'Presente', justificada: 'Falta justificada', injustificada: 'Falta injustificada', por_registar: 'Por registar',
};
export const CATEGORY_LABEL: Record<Category, string> = {
  ...STATUS_LABEL, futura: 'Sessão futura', cancelada: 'Sessão cancelada',
};
export const KIND_LABEL = { reuniao: 'Reunião', atividade: 'Atividade' } as const;

export const useSectionId = () => useActiveSection().membership.section_id;

export function useBoard(from: string, to: string, team: string) {
  const section = useSectionId();
  return useQuery({
    queryKey: ['pres-board', section, from, to, team],
    queryFn: () => call<Board>('pres_board', { p_section: section, p_from: from, p_to: to, p_team: team || null }),
    enabled: !!from && !!to,
  });
}

export * from './period';

/** Ecrã estreito (telemóvel): vistas em lista em vez do quadro largo. */
export function useNarrow(query = '(max-width: 759px)') {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}
