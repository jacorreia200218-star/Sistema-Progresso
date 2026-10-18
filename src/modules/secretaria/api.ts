// Atas e tarefas: tipos, rótulos e leituras. O servidor decide sempre o que cada pessoa vê.
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { call } from '../../lib/api';
import { useActiveSection } from '../../lib/session';
import type { Tone } from '../../lib/labels';
import { formatDay, formatLisbon, lisbonTime } from '../common';

/** Caminho do módulo (os antigos /reunioes-e-tarefas e /secretaria redirecionam para aqui). */
export const BASE = '/atas-e-tarefas';
export const MODULE_NAME = 'Atas e tarefas';

export type TaskStatus = 'por_fazer' | 'em_curso' | 'concluida';
export type AtaScope = 'seccao' | 'equipa' | 'dirigentes';

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  por_fazer: { label: 'Por fazer', tone: 'neutral' },
  em_curso: { label: 'Em curso', tone: 'progress' },
  concluida: { label: 'Concluída', tone: 'ok' },
};

export interface AtaEvent {
  id: string;
  title: string;
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  day: string;
  location: string | null;
  audience: 'seccao' | 'equipa';
  team_id: string | null;
  team_name: string | null;
  status: 'ativo' | 'cancelado';
  ata_id?: string | null;
}

export interface AtaRow {
  id: string;
  meeting_id: string;
  title: string;
  day: string;
  event_id: string | null;
  scope: AtaScope;
  team_name: string | null;
  updated_at: string;
  updated_by_name: string;
  open_tasks: number;
}

export interface Task {
  id: string;
  text: string;
  responsible_id: string;
  responsible_name: string;
  due_date: string | null;
  status: TaskStatus;
  overdue: boolean;
  ata_id: string | null;
  event: AtaEvent | null;
  updated_at: string;
  updated_by_name: string;
}

export interface Ata {
  id: string;
  meeting_id: string;
  title: string;
  scope: AtaScope;
  team_id: string | null;
  team_name: string | null;
  event: AtaEvent | null;
  day: string;
  body: string;
  version: number;
  current_version: number;
  updated_at: string;
  updated_by_name: string;
  created_by_name: string;
  versions: { version: number; saved_at: string; saved_by_name: string }[];
  can_write: boolean;
  tasks: Task[];
}

export interface Person { id: string; name: string; function: string | null; team_name: string | null }

export function useSectionId() {
  return useActiveSection().membership.section_id;
}

export function useAtas(q: string) {
  const section = useSectionId();
  return useQuery({
    queryKey: ['atas', section, q],
    queryFn: () => call<{ can_write: boolean; atas: AtaRow[] }>('ata_list', { p_section: section, p_search: q || null }),
  });
}

export function useAta(id: string, version: number | null) {
  const section = useSectionId();
  return useQuery({
    queryKey: ['ata', section, id, version],
    queryFn: () => call<Ata>('ata_get', { p_section: section, p_ata: id, p_version: version }),
  });
}

export function usePeople() {
  const section = useSectionId();
  return useQuery({ queryKey: ['ata-people', section], queryFn: () => call<Person[]>('ata_people', { p_section: section }), staleTime: 60_000 });
}

/** «Reunião de sábado · 18/10/2026 · 14:30» a partir do evento. */
export function eventWhen(e: Pick<AtaEvent, 'all_day' | 'starts_at' | 'day'>): string {
  return e.all_day || !e.starts_at ? formatDay(e.day) : formatLisbon(e.starts_at);
}

export function eventLabel(e: AtaEvent): string {
  const end = !e.all_day && e.ends_at && e.starts_at && e.ends_at !== e.starts_at ? `–${lisbonTime(e.ends_at)}` : '';
  return `${e.title} · ${eventWhen(e)}${end}`;
}

export const SCOPE_LABEL: Record<AtaScope, string> = {
  seccao: 'Toda a secção',
  equipa: 'Equipa',
  dirigentes: 'Reservada aos dirigentes',
};

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
