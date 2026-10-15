import type { DecisionKind, MemberFunction, MemberStatus, RequestStatus, StageRequestStatus } from './types';
import type { TrailUiState } from './progress';

export type Tone = 'neutral' | 'progress' | 'ok' | 'attention' | 'muted';

export const trailStateLabel: Record<TrailUiState, { label: string; tone: Tone; icon: string }> = {
  validado: { label: 'Validado', tone: 'ok', icon: 'check' },
  pendente: { label: 'Em validação', tone: 'progress', icon: 'clock' },
  devolvido: { label: 'A rever', tone: 'attention', icon: 'return' },
  rascunho: { label: 'Rascunho', tone: 'neutral', icon: 'pencil' },
  selecionado: { label: 'Selecionado', tone: 'progress', icon: 'compass' },
  proposto: { label: 'Proposto', tone: 'neutral', icon: 'message' },
  por_trabalhar: { label: 'Por trabalhar', tone: 'muted', icon: 'circle' },
};

export const requestStatusLabel: Record<RequestStatus, { label: string; tone: Tone; icon: string }> = {
  rascunho: { label: 'Rascunho', tone: 'neutral', icon: 'pencil' },
  submetido: { label: 'Em validação', tone: 'progress', icon: 'send' },
  em_revisao: { label: 'Em validação', tone: 'progress', icon: 'clock' },
  validado_equipa: { label: 'Validado', tone: 'ok', icon: 'check' },
  devolvido: { label: 'A rever', tone: 'attention', icon: 'return' },
  objetivos_validados: { label: 'Histórico por objetivos', tone: 'muted', icon: 'clock' },
  aprovado: { label: 'Reconhecido', tone: 'ok', icon: 'check' },
  recusado: { label: 'Não reconhecido', tone: 'muted', icon: 'x' },
  cancelado: { label: 'Cancelado', tone: 'muted', icon: 'x' },
};

export const decisionLabel: Record<DecisionKind, string> = {
  em_revisao: 'Colocado em revisão',
  validado_equipa: 'Validado na reunião de Equipa',
  devolvido_equipa: 'Devolvido para revisão pela reunião de Equipa',
  devolvido_conselho: 'Devolvido após o Conselho de Guias',
  revisao_animacao: 'Nota da Equipa de Animação',
  aprovado_historico: 'Progresso anterior reconhecido',
  recusado_historico: 'Progresso anterior não reconhecido',
  devolvido_historico: 'Progresso anterior devolvido para correção',
  reconhecido_negociacao: 'Reconhecido na negociação pela Equipa de Animação',
  objetivos_equipa: 'Objetivos aceites na reunião de Equipa (modelo anterior; não fecha o trilho)',
};

export const stageRequestLabel: Record<StageRequestStatus, { label: string; tone: Tone; icon: string }> = {
  submetido: { label: 'A aguardar Conselho de Guias', tone: 'progress', icon: 'clock' },
  decidido_conselho: { label: 'A aguardar opinião final', tone: 'progress', icon: 'clock' },
  confirmada: { label: 'Etapa concluída', tone: 'ok', icon: 'check' },
  nao_confirmada: { label: 'Etapa não confirmada', tone: 'attention', icon: 'return' },
  cancelado: { label: 'Cancelado', tone: 'muted', icon: 'x' },
};

export const functionLabel: Record<MemberFunction, string> = {
  pioneiro: 'Pioneiro',
  guia: 'Guia',
  dirigente: 'Dirigente',
};

export const memberStatusLabel: Record<MemberStatus, string> = {
  pendente: 'A aguardar confirmação',
  ativo: 'Ativo',
  suspenso: 'Acesso suspenso',
  saiu: 'Saiu da secção',
};

// Datas: sempre DD/MM/AAAA. As datas sem hora («2026-10-10») não passam por Date,
// para não mudarem de dia com o fuso horário; os instantes usam a hora local.
const pad = (n: number) => String(n).padStart(2, '0');
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  const m = DATE_ONLY.exec(d);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Igual a formatDate (mantido para as listas). */
export const formatShortDate = formatDate;

export function formatDateTime(d: string | null | undefined): string {
  if (!d) return '—';
  if (DATE_ONLY.test(d)) return formatDate(d);
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDate(d)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const requestKindLabel: Record<string, string> = {
  normal: '',
  historico: 'Progresso anterior',
  negociacao: 'Reconhecido na negociação',
};

/** Pedido de validação do trilho: campo da justificação conjunta. */
export const JUSTIFICATION_LABEL = 'Como demonstrei que alcancei este trilho?';
export const JUSTIFICATION_HINT = 'Explica o que fizeste, em que situações e como isso demonstra os objetivos acima.';

/** Identificador curto e estável de uma proposta de trilho (a partir do identificador interno). */
export const proposalRef = (c: { id: string }) => `P-${c.id.replace(/-/g, '').slice(-6).toUpperCase()}`;
