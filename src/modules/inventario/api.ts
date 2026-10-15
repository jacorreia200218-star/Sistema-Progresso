// Inventário: tipos, leituras (RPC inv_*) e etiquetas. O servidor verifica o acesso
// e as permissões em cada chamada; aqui só se decide o que mostrar.
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api';
import { useActiveSection } from '../../lib/session';
import type { Tone } from '../../lib/labels';
import { formatLisbon } from '../common';

export type ItemState = 'disponivel' | 'emprestado' | 'reservado' | 'danificado' | 'reparacao';
export type Condition = 'disponivel' | 'danificado' | 'reparacao';

export const STATE_LABEL: Record<ItemState, string> = {
  disponivel: 'Disponível', emprestado: 'Emprestado', reservado: 'Reservado', danificado: 'Danificado', reparacao: 'Em reparação',
};
export const STATE_TONE: Record<ItemState, Tone> = {
  disponivel: 'ok', emprestado: 'progress', reservado: 'neutral', danificado: 'attention', reparacao: 'attention',
};
export const CONDITION_LABEL: Record<Condition, string> = { disponivel: 'Em bom estado', danificado: 'Danificado', reparacao: 'Em reparação' };
export const PIECE_LABEL: Record<string, string> = { ...STATE_LABEL, retirado: 'Retirada' };
export const PIECE_TONE: Record<string, Tone> = { ...STATE_TONE, retirado: 'muted' };

export const LOAN_LABEL: Record<Loan['status'], { label: string; tone: Tone }> = {
  pedido: { label: 'Pedido por decidir', tone: 'attention' },
  ativo: { label: 'Emprestado', tone: 'progress' },
  devolvido: { label: 'Devolvido', tone: 'ok' },
  recusado: { label: 'Recusado', tone: 'muted' },
  cancelado: { label: 'Cancelado', tone: 'muted' },
};

export const MOVEMENT_LABEL: Record<string, string> = {
  criacao: 'Artigo registado', edicao: 'Dados alterados', entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste de quantidade',
  estado: 'Mudança de estado', peca: 'Peça acrescentada', pedido: 'Pedido de empréstimo', pedido_aprovado: 'Pedido aprovado',
  pedido_recusado: 'Pedido recusado', pedido_cancelado: 'Pedido cancelado', emprestimo: 'Empréstimo', devolucao: 'Devolução',
  prazo: 'Prazo alterado', reserva: 'Reserva', reserva_cancelada: 'Reserva cancelada', reserva_concluida: 'Reserva levantada',
  arquivo: 'Arquivado', reativacao: 'Reativado',
};

export type Stock = {
  total: number; damaged: number; repair: number; lent: number; reserved: number; reservations: number; available: number; states: ItemState[];
};
export type Item = {
  id: string; name: string; description: string | null; unit: string; location: string | null; tracking: 'quantidade' | 'pecas';
  category_id: string | null; category: string | null; min_quantity: number | null; archived_at: string | null; updated_at: string;
  has_photo: boolean; stock: Stock;
};
export type Category = { id: string; name: string; archived: boolean; items: number };
export type Overview = {
  can_manage: boolean; me: string; categories: Category[]; locations: string[]; items: Item[]; pending_requests: number; overdue: number;
};
export type LoanPiece = { id: string; code: string; serial: string | null; returned_at: string | null; returned_status: Condition | null };
export type Loan = {
  id: string; item_id: string; item: string; unit: string; tracking: Item['tracking']; borrower_id: string; borrower: string;
  quantity: number; returned_qty: number; out_at: string; due_at: string; status: 'pedido' | 'ativo' | 'devolvido' | 'recusado' | 'cancelado';
  overdue: boolean; notes: string | null; remind_hours: number; reservation_id: string | null; requested_by: string; requested_at: string;
  decided_by: string | null; decided_at: string | null; decision_note: string | null; returned_at: string | null; pieces: LoanPiece[];
};
export type Reservation = {
  id: string; item_id: string; item: string; unit: string; quantity: number; starts_at: string; ends_at: string;
  status: 'ativa' | 'cancelada' | 'concluida'; notes: string | null; event_id: string | null; event: string | null; event_cancelled: boolean | null;
  created_by: string; created_at: string; close_note: string | null; at_risk: boolean;
};
export type Piece = { id: string; code: string; serial: string | null; notes: string | null; status: ItemState | 'retirado' };
export type Movement = {
  id: number; kind: string; quantity: number | null; from_state: string | null; to_state: string | null; note: string | null;
  at: string; actor: string | null; piece: string | null; borrower: string | null;
};
export type ItemDetail = Item & { can_manage: boolean; pieces: Piece[]; loans: Loan[]; reservations: Reservation[]; movements: Movement[] };
export type Alerts = {
  overdue: Loan[]; due_soon: Loan[]; low_stock: Item[]; repair: Item[]; damaged: Item[]; at_risk: Reservation[]; requests: Loan[];
};
export type EventOption = { id: string; title: string; all_day: boolean; starts_at: string; ends_at: string };
export type Person = { id: string; name: string };

export function useSectionId() {
  return useActiveSection().membership.section_id;
}

export function useOverview(archived = false) {
  const s = useSectionId();
  return useQuery({ queryKey: ['inv', 'overview', s, archived], queryFn: () => call<Overview>('inv_overview', { p_section: s, p_archived: archived }) });
}
export function useItem(id: string | undefined) {
  const s = useSectionId();
  return useQuery({ queryKey: ['inv', 'item', s, id], queryFn: () => call<ItemDetail>('inv_item', { p_section: s, p_item: id }), enabled: !!id });
}
export function useLoans(status: string, mine: boolean) {
  const s = useSectionId();
  return useQuery({
    queryKey: ['inv', 'loans', s, status, mine],
    queryFn: () => call<Loan[]>('inv_loans', { p_section: s, p_status: status || null, p_mine: mine }),
  });
}
export function useReservations(past: boolean) {
  const s = useSectionId();
  return useQuery({ queryKey: ['inv', 'reservations', s, past], queryFn: () => call<Reservation[]>('inv_reservations', { p_section: s, p_past: past }) });
}
export function useAlerts() {
  const s = useSectionId();
  return useQuery({ queryKey: ['inv', 'alerts', s], queryFn: () => call<Alerts>('inv_alerts', { p_section: s }) });
}
export function useEventOptions(enabled = true) {
  const s = useSectionId();
  return useQuery({ queryKey: ['inv', 'events', s], queryFn: () => call<EventOption[]>('inv_event_options', { p_section: s }), enabled });
}
export function usePeople(enabled = true) {
  const s = useSectionId();
  return useQuery({ queryKey: ['inv', 'people', s], queryFn: () => call<Person[]>('inv_people', { p_section: s }), enabled, staleTime: 60_000 });
}

/** «3 un.» / «1 par» */
export const qty = (n: number, unit: string) => `${n} ${unit}`;
export const when = (iso: string) => formatLisbon(iso);

/** Texto sem acentos e em minúsculas (pesquisa). */
export const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
