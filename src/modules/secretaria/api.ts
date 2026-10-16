// Reuniões e tarefas: tipos, rótulos e leituras. O servidor decide sempre o que cada pessoa vê.
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { call } from '../../lib/api';
import { useActiveSection } from '../../lib/session';
import type { Tone } from '../../lib/labels';

/** Caminho do módulo (o antigo /secretaria redireciona para aqui). */
export const BASE = '/reunioes-e-tarefas';
export const MODULE_NAME = 'Reuniões e tarefas';

export type MeetingKind = 'equipa' | 'conselho_guias' | 'animacao' | 'geral';
export type MinuteStatus = 'rascunho' | 'em_aprovacao' | 'aprovada';
export type ExecStatus = 'por_fazer' | 'em_curso' | 'concluida' | 'cancelada';
export type ItemKind = 'decisao' | 'tarefa' | 'preparar';
export const BOARD_STATUSES = ['por_fazer', 'em_curso', 'concluida'] as const;

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

export const ITEM_KIND: Record<ItemKind, string> = { decisao: 'Decisão', tarefa: 'Tarefa', preparar: 'Preparativo' };

export const MINUTE_STATUS: Record<MinuteStatus, { label: string; tone: Tone; icon: string }> = {
  rascunho: { label: 'Rascunho', tone: 'neutral', icon: 'pencil' },
  em_aprovacao: { label: 'Em aprovação', tone: 'attention', icon: 'clock' },
  aprovada: { label: 'Aprovada', tone: 'ok', icon: 'check' },
};

export const EXEC_STATUS: Record<ExecStatus, { label: string; tone: Tone }> = {
  por_fazer: { label: 'Por fazer', tone: 'neutral' },
  em_curso: { label: 'Em curso', tone: 'progress' },
  concluida: { label: 'Concluída', tone: 'ok' },
  cancelada: { label: 'Arquivada', tone: 'muted' },
};

export const UNDEFINED = 'Por definir';

export interface EventRef { id: string; title: string; starts_at: string; all_day?: boolean; status?: string }

export interface MeetingRow {
  id: string;
  kind: MeetingKind;
  team_id: string | null;
  team_name: string | null;
  title: string;
  starts_at: string;
  location: string | null;
  status: 'ativa' | 'anulada';
  cal_event: EventRef | null;
  ata: { id: string; status: MinuteStatus; approved_version: number | null; current_version: number } | null;
  summary: { id: string; status: 'rascunho' | 'publicado'; published_version: number | null } | null;
  decisions: number;
  open_tasks: number;
}

export interface Item {
  id: string;
  minute_id: string;
  meeting_id: string;
  kind: ItemKind;
  text: string;
  responsible_id: string | null;
  responsible_name: string | null;
  responsible_team_id: string | null;
  team_name: string | null;
  due_date: string | null;
  reminder_days: number;
  exec_status: ExecStatus;
  status_note: string | null;
  completed_at: string | null;
  overdue: boolean;
  cal_event_id: string | null;
  cal_event: EventRef | null;
  trail_request_id: string | null;
  stage_path_id: string | null;
  link_label: string | null;
}

export interface BoardTask extends Item {
  meeting_title: string;
  meeting_starts_at: string;
  minute_kind: 'ata' | 'aditamento';
  can_manage: boolean;
  can_status: boolean;
}

export interface MineTask {
  id: string;
  kind: 'tarefa' | 'preparar';
  text: string;
  due_date: string | null;
  exec_status: ExecStatus;
  overdue: boolean;
  via: 'pessoal' | 'equipa';
  team_name: string | null;
  cal_event: EventRef | null;
  published: boolean;
  meeting_id: string | null;
  meeting_title: string | null;
}

export interface MeetingDetail {
  meeting: {
    id: string; kind: MeetingKind; team_id: string | null; team_name: string | null; title: string; starts_at: string;
    location: string | null; agenda: string; status: 'ativa' | 'anulada'; cancel_reason: string | null; cal_event_id: string | null;
    cal_event: EventRef | null; created_by_name: string;
  };
  participants: { id: string; name: string }[];
  shares: { profile_id: string | null; team_id: string | null; name: string }[];
  minutes: { id: string; kind: 'ata' | 'aditamento'; status: MinuteStatus; current_version: number; approved_version: number | null; created_at: string }[];
  summary: { id: string; status: 'rascunho' | 'publicado'; current_version: number; published_version: number | null } | null;
  items: Item[];
  can_draft: boolean;
  can_approve: boolean;
  can_manage: boolean;
}

export interface Content {
  title: string;
  kind: MeetingKind;
  team_name: string | null;
  starts_at: string;
  location: string | null;
  agenda: string;
  cal_event_title?: string | null;
  participants: string[];
  items: { kind: ItemKind; text: string; responsible_name: string | null; team_name?: string | null; due_date: string | null; event_title?: string | null; link_label: string | null }[];
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

export interface SummaryEntry {
  item_id: string;
  kind: ItemKind;
  text: string;
  responsible_id: string | null;
  team_id: string | null;
  due_date: string | null;
  cal_event_id: string | null;
  omitted: boolean;
  responsible_name?: string | null;
  team_name?: string | null;
  cal_event?: EventRef | null;
}

export interface SummaryDetail {
  meeting: { id: string; title: string; kind: MeetingKind; starts_at: string; status: 'ativa' | 'anulada'; team_name: string | null; cal_event: EventRef | null };
  ata: { id: string; status: MinuteStatus; approved_version: number | null } | null;
  test: boolean;
  summary: { id: string; status: 'rascunho' | 'publicado'; current_version: number; published_version: number | null } | null;
  version: {
    version_no: number; note: string | null; content: { entries: SummaryEntry[] }; published: boolean; published_at: string | null;
    published_by_name: string | null; created_by_name: string; created_at: string; updated_at: string;
  } | null;
  versions: { version_no: number; note: string | null; created_at: string; created_by_name: string; published_at: string | null; published_by_name: string | null }[];
  missing_items: number;
  item_status: Record<string, ExecStatus>;
  can_prepare: boolean;
  can_manage: boolean;
  can_edit: boolean;
  can_publish: boolean;
  can_revise: boolean;
}

export interface TaskDetail {
  limited: boolean;
  task: Partial<Item> & { id: string; kind: ItemKind; text: string; exec_status: ExecStatus; due_date: string | null; overdue: boolean; cal_event: EventRef | null };
  published_text?: string | null;
  meeting?: { id: string; title: string; kind: MeetingKind; starts_at: string; status: 'ativa' | 'anulada' };
  minute?: { id: string; kind: 'ata' | 'aditamento'; status: MinuteStatus };
  can_manage: boolean;
  can_status: boolean;
  history: { field: string; from: string | null; to: string | null; note: string | null; by: string | null; at: string }[];
}

export interface People {
  people: { id: string; name: string; team_id: string | null; function: string | null }[];
  teams: { id: string; name: string }[];
}

export function useSectionId() {
  return useActiveSection().membership.section_id;
}

/** Parâmetro do endereço (sobrevive ao «voltar»). */
export function useParam(key: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? '';
  const set = (v: string) =>
    setParams(() => {
      const next = new URLSearchParams(window.location.search);
      if (v) next.set(key, v);
      else next.delete(key);
      return next;
    }, { replace: true });
  return [value, set];
}

export interface MeetingFilters { q: string; kind: string; team: string; event: string; from: string; to: string }

export function useMeetings(f: MeetingFilters) {
  const section = useSectionId();
  return useQuery({
    queryKey: ['sec-meetings', section, f],
    queryFn: () => call<{ can_draft: boolean; can_approve: boolean; meetings: MeetingRow[]; teams: { id: string; name: string }[]; events: EventRef[] }>('sec_meetings', {
      p_section: section, p_search: f.q || null, p_kind: f.kind || null, p_team: f.team || null, p_event: f.event || null,
      p_from: f.from || null, p_to: f.to || null,
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

export function useSummary(meetingId: string | undefined, version: number | null) {
  const section = useSectionId();
  return useQuery({
    queryKey: ['sec-summary', section, meetingId, version],
    queryFn: () => call<SummaryDetail>('sec_summary', { p_section: section, p_meeting: meetingId, p_version: version }),
    enabled: !!meetingId,
  });
}

export function usePeople(enabled = true) {
  const section = useSectionId();
  return useQuery({ queryKey: ['sec-people', section], queryFn: () => call<People>('sec_people', { p_section: section }), enabled, staleTime: 60_000 });
}

/** Atividades do Calendário (só para quem redige ou aprova). */
export function useEventOptions(enabled = true) {
  const section = useSectionId();
  return useQuery({
    queryKey: ['sec-events', section],
    queryFn: () => call<EventRef[]>('sec_event_options', { p_section: section }),
    enabled,
    staleTime: 60_000,
  });
}

export const docLabel = (kind: 'ata' | 'aditamento') => (kind === 'ata' ? 'Ata' : 'Aditamento');
