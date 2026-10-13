import type { DecisionKind, MemberFunction, MemberStatus, RequestStatus, StageRequestStatus } from './types';
import type { TrailUiState } from './progress';

export type Tone = 'neutral' | 'progress' | 'ok' | 'attention' | 'muted';

export const trailStateLabel: Record<TrailUiState, { label: string; tone: Tone; icon: string }> = {
  validado: { label: 'Validado', tone: 'ok', icon: 'check' },
  pendente: { label: 'Pendente', tone: 'progress', icon: 'clock' },
  devolvido: { label: 'Devolvido', tone: 'attention', icon: 'return' },
  rascunho: { label: 'Rascunho', tone: 'neutral', icon: 'pencil' },
  selecionado: { label: 'Selecionado', tone: 'progress', icon: 'compass' },
  proposto: { label: 'Proposto', tone: 'neutral', icon: 'message' },
  por_trabalhar: { label: 'Por trabalhar', tone: 'muted', icon: 'circle' },
};

export const requestStatusLabel: Record<RequestStatus, { label: string; tone: Tone; icon: string }> = {
  rascunho: { label: 'Rascunho', tone: 'neutral', icon: 'pencil' },
  submetido: { label: 'Submetido', tone: 'progress', icon: 'send' },
  em_revisao: { label: 'Em revisão', tone: 'progress', icon: 'clock' },
  validado_equipa: { label: 'Validado na equipa', tone: 'ok', icon: 'check' },
  devolvido: { label: 'Devolvido', tone: 'attention', icon: 'return' },
  aprovado: { label: 'Reconhecido', tone: 'ok', icon: 'check' },
  recusado: { label: 'Não reconhecido', tone: 'muted', icon: 'x' },
  cancelado: { label: 'Cancelado', tone: 'muted', icon: 'x' },
};

export const decisionLabel: Record<DecisionKind, string> = {
  em_revisao: 'Colocado em revisão',
  validado_equipa: 'Validado na reunião de Equipa',
  devolvido_equipa: 'Devolvido pela reunião de Equipa',
  devolvido_conselho: 'Devolvido após o Conselho de Guias',
  revisao_animacao: 'Nota da Equipa de Animação',
  aprovado_historico: 'Progresso anterior reconhecido',
  recusado_historico: 'Progresso anterior não reconhecido',
  devolvido_historico: 'Progresso anterior devolvido para correção',
  reconhecido_negociacao: 'Reconhecido na negociação pela Equipa de Animação',
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

export function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  const date = d.length === 10 ? new Date(`${d}T12:00:00`) : new Date(d);
  return date.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateTime(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
