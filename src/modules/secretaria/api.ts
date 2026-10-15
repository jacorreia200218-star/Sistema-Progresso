// Secretaria: tipos, rótulos e leituras. O servidor decide sempre o que cada pessoa vê.
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api';
import { useActiveSection } from '../../lib/session';
import type { Tone } from '../../lib/labels';

export type MeetingKind = 'equipa' | 'conselho_guias' | 'animacao' | 'geral';
export type MinuteStatus = 'rascunho' | 'em_aprovacao' | 'aprovada';
export type ExecStatus = 'por_fazer' | 'em_curso' | 'feita' | 'cancelada';

export const KIND_LABEL: Record<MeetingKind, string> = {
  equipa: 'Reunião de Equipa',
  conselho_guias: 'Conselho de Guias',
  animacao: 'Equipa de Animação',
  geral: 'Documento geral',
};

export const KIND_AUDIENCE: Record<MeetingKind, string> = {
  equipa: 'Veem: os membros dessa equipa e os dirigentes autorizados.',
  conselho_guias: 'Veem: os participantes e os dirigentes autorizados.',
  animacao: 'Veem: só os dirigentes autorizados.',
  geral: 'Veem: só quem o criou e as pessoas e equipas com quem for partilhado.',
};

export const MINUTE_STATUS: Record<MinuteStatus, { label: string; tone: Tone; icon: string }> = {
  rascunho: { label: 'Rascunho', tone: 'neutral', icon: 'pencil' },
  em_aprovacao: { label: 'Em aprovação', tone: 'attention', icon: 'clock' },
  aprovada: { label: 'Aprovada', tone: 'ok', icon: 'check' },
};

export const EXEC_STATUS: Record<ExecStatus, { label: string; tone: Tone }> = {
  por_fazer: { label: 'Por fazer', tone: 'neutral' },
  em_curso: { label: 'Em curso', tone: 'progress' },
  feita: { label: 'Feita', tone: 'ok' },
  cancelada: { label: 'Cancelada', tone: 'muted' },
};

export interface MeetingRow {
  id: string;
  kind: MeetingKind;
  team_name: string | null;
  title: string;
  starts_at: string;
  location: string | null;
  status: 'ativa' | 'anulada';
  ata: { id: string; status: MinuteStatus; approved_version: number | null; current_version: number } | null;
  open_tasks: number;
}

export interface Item {
  id: string;
  minute_id: string;
  kind: 'decisao' | 'tarefa';
  text: string;
  responsible_id: string | null;
  responsible_name: string | null;
  due_date: string | null;
  reminder_days: number;
  exec_status: ExecStatus;
  status_note: string | null;
  trail_request_id: string | null;
  stage_path_id: string | null;
  link_label: string | null;
  meeting_id?: string | null;
  meeting_title?: string | null;
}

export interface MeetingDetail {
  meeting: {
    id: string; kind: MeetingKind; team_id: string | null; team_name: string | null; title: string; starts_at: string;
    location: string | null; agenda: string; status: 'ativa' | 'anulada'; cancel_reason: string | null; cal_event_id: string | null;
    cal_event: { id: string; title: string; starts_at: string; status: string } | null; created_by_name: string;
  };
  participants: { id: string; name: string }[];
  shares: { profile_id: string | null; team_id: string | null; name: string }[];
  minutes: { id: string; kind: 'ata' | 'aditamento'; status: MinuteStatus; current_version: number; approved_version: number | null; created_at: string }[];
  items: Item[];
  can_draft: boolean;
  can_approve: boolean;
}

export interface Content {
  title: string;
  kind: MeetingKind;
  team_name: string | null;
  starts_at: string;
  location: string | null;
  agenda: string;
  participants: string[];
  items: { kind: 'decisao' | 'tarefa'; text: string; responsible_name: string | null; due_date: string | null; link_label: string | null }[];
}

export interface MinuteDetail {
  minute: { id: string; kind: 'ata' | 'aditamento'; status: MinuteStatus; current_version: number; approved_version: number | null; meeting_id: string; parent_id: string | null };
  meeting: { id: string; title: string; kind: MeetingKind; status: 'ativa' | 'anulada'; starts_at: string };
  test: boolean;
  version: {
    version_no: number; body: string; note: string | null; frozen: boolean; frozen_at: string | null; submitted_by_name: string | null;
    approved_at: string | null; approved_by_name: string | null; created_by_name: string; updated_at: string; content: Content;
  };
  versions: { version_no: number; note: string | null; created_at: string; created_by_name: string; frozen_at: string | null; approved_at: string | null; approved_by_name: string | null }[];
  parent: { id: string; approved_version: number | null } | null;
  addenda: { id: string; status: MinuteStatus; created_at: string; approved_version: number | null }[];
  items: Item[];
  can_edit: boolean;
  can_submit: boolean;
  can_approve: boolean;
  can_return: boolean;
  can_revise: boolean;
  can_addendum: boolean;
  can_track: boolean;
}

export interface People {
  people: { id: string; name: string; team_id: string | null; function: string | null }[];
  teams: { id: string; name: string }[];
}

export function useSectionId() {
  return useActiveSection().membership.section_id;
}

export function useMeetings(q: string, kind: string) {
  const section = useSectionId();
  return useQuery({
    queryKey: ['sec-meetings', section, q, kind],
    queryFn: () => call<{ can_draft: boolean; can_approve: boolean; meetings: MeetingRow[] }>('sec_meetings', {
      p_section: section, p_search: q || null, p_kind: kind || null,
    }),
  });
}

export function useMeeting(id: string | undefined) {
  const section = useSectionId();
  return useQuery({
    queryKey: ['sec-meeting', section, id],
    queryFn: () => call<MeetingDetail>('sec_meeting', { p_section: section, p_meeting: id }),
    enabled: !!id,
  });
}

export function useMinute(id: string | undefined, version: number | null) {
  const section = useSectionId();
  return useQuery({
    queryKey: ['sec-minute', section, id, version],
    queryFn: () => call<MinuteDetail>('sec_minute', { p_section: section, p_minute: id, p_version: version }),
    enabled: !!id,
  });
}

export function usePeople(enabled = true) {
  const section = useSectionId();
  return useQuery({ queryKey: ['sec-people', section], queryFn: () => call<People>('sec_people', { p_section: section }), enabled, staleTime: 60_000 });
}

export const docLabel = (kind: 'ata' | 'aditamento') => (kind === 'ata' ? 'Ata' : 'Aditamento');
