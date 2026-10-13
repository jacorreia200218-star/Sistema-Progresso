// Lógica do «Meu progresso»: categorias para os filtros, checklist da etapa
// com mensagens concretas e informação de validação de cada trilho.
// Tudo calculado a partir de registos persistidos; nada aqui valida trilhos.
import type { Catalog, CatalogArea, CatalogTrail, MemberProgress, StageChoice, TrailDecision, TrailRequest } from './types';
import { activeRequest, isValidated, openPath, stageSummary, type StageSummary } from './progress';

export type TrailCategory = 'por_iniciar' | 'em_desenvolvimento' | 'aguarda' | 'revisao' | 'validado';

export const CATEGORY_FILTERS: { key: 'todos' | TrailCategory; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'por_iniciar', label: 'Por iniciar' },
  { key: 'em_desenvolvimento', label: 'Em desenvolvimento' },
  { key: 'aguarda', label: 'A aguardar validação' },
  { key: 'revisao', label: 'Precisa de revisão' },
  { key: 'validado', label: 'Validados' },
];

export const CATEGORY_LABEL: Record<TrailCategory, { label: string; tone: 'muted' | 'progress' | 'attention' | 'ok' | 'neutral'; icon: string }> = {
  por_iniciar: { label: 'Por iniciar', tone: 'muted', icon: 'circle' },
  em_desenvolvimento: { label: 'Em desenvolvimento', tone: 'progress', icon: 'compass' },
  aguarda: { label: 'A aguardar validação', tone: 'neutral', icon: 'clock' },
  revisao: { label: 'Precisa de revisão', tone: 'attention', icon: 'return' },
  validado: { label: 'Validado', tone: 'ok', icon: 'check' },
};

/** Escolha ativa (proposta ou confirmada) de um trilho, em qualquer etapa. */
export function activeChoice(p: MemberProgress, trailKey: string): StageChoice | undefined {
  return p.choices.find((c) => c.trail_key === trailKey && (c.status === 'confirmada' || c.status === 'proposta'));
}

/**
 * Categoria de um trilho. «Validado» só depois da decisão pedagógica; submeter
 * não é concluir. Ter vivências registadas ou uma escolha conta como «em
 * desenvolvimento».
 */
export function trailCategory(trail: CatalogTrail, p: MemberProgress, experiencesByTrail?: Record<string, number>): TrailCategory {
  const r = activeRequest(p.requests, trail.key);
  if (r) {
    if (isValidated(r)) return 'validado';
    if (r.status === 'submetido' || r.status === 'em_revisao') return 'aguarda';
    if (r.status === 'devolvido') return 'revisao';
    return 'em_desenvolvimento'; // rascunho
  }
  if (activeChoice(p, trail.key) || (experiencesByTrail?.[trail.key] ?? 0) > 0) return 'em_desenvolvimento';
  return 'por_iniciar';
}

const OUTCOME_KINDS = ['validado_equipa', 'aprovado_historico', 'reconhecido_negociacao'];

/** Decisão que validou o trilho (data e tipo), se existir. */
export function validationInfo(r: TrailRequest | undefined, decisions: TrailDecision[] = []): { date: string; label: string } | null {
  if (!r || !isValidated(r)) return null;
  const d = decisions.find((x) => x.request_id === r.id && OUTCOME_KINDS.includes(x.kind));
  const label = r.kind === 'negociacao' ? 'Reconhecido na negociação' : r.kind === 'historico' ? 'Progresso anterior reconhecido' : 'Validado na reunião de Equipa';
  return { date: d?.meeting_date ?? d?.recorded_at ?? r.updated_at, label };
}

/** Último feedback (comentário) dado a um pedido. */
export function lastFeedback(r: TrailRequest | undefined, decisions: TrailDecision[] = []): TrailDecision | undefined {
  if (!r) return undefined;
  return decisions.find((x) => x.request_id === r.id && !!x.comment);
}

export type ChecklistStatus = 'por_escolher' | 'em_negociacao' | 'por_concluir' | 'submetido' | 'revisao' | 'validado';

export interface ChecklistRow {
  area: CatalogArea;
  trail?: CatalogTrail;
  status: ChecklistStatus;
  text: string;
}

export interface StageChecklist {
  summary: StageSummary;
  rows: ChecklistRow[];
  stageValidation: 'por_pedir' | 'nao_disponivel' | 'conselho' | 'opiniao_final' | 'validada';
  recognition: 'pendente' | 'realizado' | 'nao_aplicavel';
  headline: string;
  details: string[];
}

const STATUS_TEXT: Record<ChecklistStatus, string> = {
  por_escolher: 'Por escolher',
  em_negociacao: 'Proposta em negociação',
  por_concluir: 'Por concluir',
  submetido: 'Submetido · aguarda a reunião de Equipa',
  revisao: 'Devolvido · precisa de revisão',
  validado: 'Validado',
};

function joinPt(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

/** Checklist das seis áreas da etapa em curso (ou da última) com mensagens concretas. */
export function stageChecklist(catalog: Catalog, p: MemberProgress): StageChecklist | null {
  const path = openPath(p.paths) ?? [...p.paths].sort((a, b) => b.stage_ordinal - a.stage_ordinal)[0];
  if (!path) return null;
  const s = stageSummary(path, catalog, p);
  const rows: ChecklistRow[] = s.slots.map((slot) => {
    let status: ChecklistStatus;
    if (slot.validated) status = 'validado';
    else if (!slot.confirmed) status = slot.proposed ? 'em_negociacao' : 'por_escolher';
    else {
      const r = activeRequest(p.requests, slot.confirmed.trail_key);
      status = !r || r.status === 'rascunho' ? 'por_concluir' : r.status === 'devolvido' ? 'revisao' : 'submetido';
    }
    const trail = slot.trail ?? (slot.proposed ? catalog.trailById.get(slot.proposed.trail_id) : undefined);
    return { area: slot.area, trail, status, text: STATUS_TEXT[status] };
  });

  const concluded = path.status === 'concluida';
  const stageValidation: StageChecklist['stageValidation'] = concluded
    ? 'validada'
    : s.openRequest
      ? s.openRequest.status === 'submetido' ? 'conselho' : 'opiniao_final'
      : s.validatedCount === catalog.areas.length ? 'por_pedir' : 'nao_disponivel';
  const recognition: StageChecklist['recognition'] = !concluded ? 'nao_aplicavel' : path.recognized_on ? 'realizado' : 'pendente';

  const names = (st: ChecklistStatus) => rows.filter((r) => r.status === st).map((r) => r.area.name);
  const details: string[] = [];
  let headline: string;
  if (concluded) {
    headline = recognition === 'realizado' ? 'Etapa concluída e reconhecida.' : 'Etapa concluída; falta o reconhecimento público.';
  } else if (stageValidation === 'conselho') {
    headline = 'Os seis trilhos estão validados; a etapa aguarda o Conselho de Guias.';
  } else if (stageValidation === 'opiniao_final') {
    headline = 'Os seis trilhos estão validados; a etapa aguarda a opinião final da Equipa de Animação.';
  } else if (stageValidation === 'por_pedir') {
    headline = 'Os seis trilhos estão validados; falta pedir a validação da etapa ao Conselho de Guias.';
  } else {
    const choose = names('por_escolher');
    const validate = names('por_concluir');
    const revise = names('revisao');
    const negotiation = names('em_negociacao');
    const waiting = names('submetido');
    if (choose.length) details.push(`Falta escolher o trilho de ${joinPt(choose)}.`);
    if (validate.length) details.push(`Falta validar o trilho de ${joinPt(validate)}.`);
    if (revise.length) details.push(`O trilho de ${joinPt(revise)} precisa de revisão.`);
    if (negotiation.length) details.push(`A proposta de ${joinPt(negotiation)} aguarda negociação com a Equipa de Animação.`);
    if (waiting.length) details.push(`O trilho de ${joinPt(waiting)} aguarda a reunião de Equipa.`);
    headline = details[0] ?? 'Etapa em curso.';
  }
  return { summary: s, rows, stageValidation, recognition, headline, details };
}

export interface ProgressCounts {
  /** Trilhos validados ou reconhecidos, em qualquer etapa (histórico reconhecido). */
  validated: number;
  /** Dos validados, os que vieram de progresso anterior ou de reconhecimento na negociação. */
  recognized: number;
  /** Validados que ainda não estão associados a nenhuma etapa (podem ser propostos na negociação). */
  unassigned: CatalogTrail[];
  inDevelopment: number;
  inValidation: number;
  /** Etapa atual: trilhos confirmados e validados nesta etapa (um por área). */
  stage: { name: string; validated: number; confirmed: number; areas: number } | null;
}

/**
 * Contadores do resumo. A etapa só conta os trilhos confirmados para ela na
 * negociação (regra do servidor: request_stage_validation); por isso o histórico
 * reconhecido e a etapa atual são números diferentes e mostram-se separados.
 */
export function progressCounts(catalog: Catalog, p: MemberProgress): ProgressCounts {
  const trails = catalog.areas.flatMap((a) => a.catalog_trails);
  const cats = trails.map((t) => trailCategory(t, p));
  const validatedReqs = p.requests.filter(isValidated);
  const assigned = new Set(p.choices.filter((c) => c.status === 'confirmada').map((c) => c.trail_key));
  const path = openPath(p.paths);
  const s = path ? stageSummary(path, catalog, p) : null;
  return {
    validated: cats.filter((c) => c === 'validado').length,
    recognized: validatedReqs.filter((r) => r.kind === 'historico' || r.kind === 'negociacao').length,
    unassigned: trails.filter((t) => validatedReqs.some((r) => r.trail_key === t.key) && !assigned.has(t.key)),
    inDevelopment: cats.filter((c) => c === 'em_desenvolvimento').length,
    inValidation: cats.filter((c) => c === 'aguarda').length,
    stage: path && s ? { name: catalog.stages.find((x) => x.key === path.stage_key)?.name ?? path.stage_key, validated: s.validatedCount, confirmed: s.confirmedCount, areas: catalog.areas.length } : null,
  };
}
