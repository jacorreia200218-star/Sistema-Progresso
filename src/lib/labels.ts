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
  validado_guias: { label: 'Aguarda dirigentes', tone: 'progress', icon: 'clock' },
  validado_equipa: { label: 'Validado', tone: 'ok', icon: 'check' },
  devolvido: { label: 'A rever', tone: 'attention', icon: 'return' },
  objetivos_validados: { label: 'Histórico por objetivos', tone: 'muted', icon: 'clock' },
  aprovado: { label: 'Reconhecido', tone: 'ok', icon: 'check' },
  recusado: { label: 'Não reconhecido', tone: 'muted', icon: 'x' },
  cancelado: { label: 'Cancelado', tone: 'muted', icon: 'x' },
};

export const decisionLabel: Record<DecisionKind, string> = {
  em_revisao: 'Colocado em revisão',
  validado_guias: 'Validado pelos guias na reunião de Equipa',
  validado_equipa: 'Validado',
  devolvido_equipa: 'Devolvido para revisão pela reunião de Equipa',
  devolvido_conselho: 'Devolvido pelos dirigentes',
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

// Datas: sempre DD-MM-AAAA (ver lib/dates.ts, onde a formatação está centralizada).
export { formatDate, formatDateTime, formatTime, todayIso } from './dates';
import { formatDate } from './dates';

/** Igual a formatDate (mantido para as listas). */
export const formatShortDate = formatDate;

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
