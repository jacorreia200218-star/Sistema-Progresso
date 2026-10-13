// Cálculo dos estados mostrados na interface, sempre a partir de registos
// persistidos (pedidos, decisões, escolhas). Nada aqui valida coisa nenhuma:
// as regras são aplicadas no servidor; isto só resume para apresentação.
import type { Catalog, CatalogArea, CatalogTrail, MemberProgress, StageChoice, StagePath, StageRequest, TrailRequest } from './types';

export type TrailUiState = 'validado' | 'pendente' | 'devolvido' | 'rascunho' | 'selecionado' | 'proposto' | 'por_trabalhar';

const INACTIVE: TrailRequest['status'][] = ['recusado', 'cancelado'];

export function activeRequest(requests: TrailRequest[], trailKey: string): TrailRequest | undefined {
  return requests.find((r) => r.trail_key === trailKey && !INACTIVE.includes(r.status));
}

export function isValidated(r: TrailRequest | undefined): boolean {
  return !!r && (r.status === 'validado_equipa' || r.status === 'aprovado');
}

export function validatedKeys(requests: TrailRequest[]): Set<string> {
  return new Set(requests.filter(isValidated).map((r) => r.trail_key));
}

export function openPath(paths: StagePath[]): StagePath | undefined {
  return paths.find((p) => p.status === 'em_curso');
}

/** Etapa a mostrar: a que está em curso ou, se não houver, a última concluída. */
export function focusPath(paths: StagePath[]): StagePath | undefined {
  return openPath(paths) ?? [...paths].sort((a, b) => b.stage_ordinal - a.stage_ordinal)[0];
}

export function activeChoices(choices: StageChoice[], pathId: string | undefined): StageChoice[] {
  if (!pathId) return [];
  return choices.filter((c) => c.stage_path_id === pathId && (c.status === 'confirmada' || c.status === 'proposta'));
}

export function trailState(trail: CatalogTrail, p: MemberProgress): { state: TrailUiState; request?: TrailRequest; choice?: StageChoice } {
  const request = activeRequest(p.requests, trail.key);
  const path = openPath(p.paths);
  const choice = p.choices.find(
    (c) => c.trail_key === trail.key && (c.status === 'confirmada' || c.status === 'proposta'),
  );
  if (request) {
    if (isValidated(request)) return { state: 'validado', request, choice };
    if (request.status === 'submetido' || request.status === 'em_revisao') return { state: 'pendente', request, choice };
    if (request.status === 'devolvido') return { state: 'devolvido', request, choice };
    if (request.status === 'rascunho') return { state: 'rascunho', request, choice };
  }
  if (choice && path && choice.stage_path_id === path.id) {
    return { state: choice.status === 'confirmada' ? 'selecionado' : 'proposto', choice };
  }
  return { state: 'por_trabalhar', choice };
}

export interface AreaSlot {
  area: CatalogArea;
  confirmed?: StageChoice;
  proposed?: StageChoice;
  trail?: CatalogTrail;
  validated: boolean;
  state: TrailUiState;
}

export interface StageSummary {
  path: StagePath;
  slots: AreaSlot[];
  confirmedCount: number;
  validatedCount: number;
  ready: boolean;
  openRequest?: StageRequest;
  lastRequest?: StageRequest;
}

export function stageSummary(path: StagePath, catalog: Catalog, p: MemberProgress): StageSummary {
  const valid = validatedKeys(p.requests);
  const slots: AreaSlot[] = catalog.areas.map((area) => {
    const confirmed = p.choices.find((c) => c.stage_path_id === path.id && c.area_code === area.code && c.status === 'confirmada');
    const proposed = p.choices.find((c) => c.stage_path_id === path.id && c.area_code === area.code && c.status === 'proposta');
    const trail = confirmed ? catalog.trailById.get(confirmed.trail_id) : undefined;
    const validated = !!confirmed && valid.has(confirmed.trail_key);
    const req = confirmed ? activeRequest(p.requests, confirmed.trail_key) : undefined;
    const state: TrailUiState = validated
      ? 'validado'
      : req?.status === 'submetido' || req?.status === 'em_revisao'
        ? 'pendente'
        : req?.status === 'devolvido'
          ? 'devolvido'
          : req?.status === 'rascunho'
            ? 'rascunho'
            : confirmed
              ? 'selecionado'
              : proposed
                ? 'proposto'
                : 'por_trabalhar';
    return { area, confirmed, proposed, trail, validated, state };
  });
  const requests = p.stageRequests.filter((r) => r.stage_path_id === path.id).sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  const openRequest = requests.find((r) => r.status === 'submetido' || r.status === 'decidido_conselho');
  const confirmedCount = slots.filter((s) => s.confirmed).length;
  const validatedCount = slots.filter((s) => s.validated).length;
  return {
    path,
    slots,
    confirmedCount,
    validatedCount,
    ready: path.status === 'em_curso' && validatedCount === catalog.areas.length && !openRequest,
    openRequest,
    lastRequest: requests[0],
  };
}

export interface NextAction {
  title: string;
  detail: string;
  to?: string;
}

export function nextAction(catalog: Catalog, p: MemberProgress): NextAction {
  const name = (key: string) => catalog.trailByKey.get(key)?.name ?? 'trilho';
  const returned = p.requests.find((r) => r.status === 'devolvido');
  if (returned) {
    return { title: `Rever o pedido de «${name(returned.trail_key)}»`, detail: 'Foi devolvido com comentários. Lê-os e prepara uma nova versão quando estiveres pronto.', to: `/pedidos/${returned.id}` };
  }
  const draft = p.requests.find((r) => r.status === 'rascunho');
  if (draft) {
    return { title: `Terminar o pedido de «${name(draft.trail_key)}»`, detail: 'Tens um rascunho guardado. Completa a reflexão e submete quando sentires que alcançaste o trilho.', to: `/pedidos/${draft.id}` };
  }
  if (!p.adhesion) {
    return { title: 'Viver a etapa do Desprendimento', detail: 'A tua adesão ainda não está registada. Conversa com o teu guia e com a Equipa de Animação.' };
  }
  const path = openPath(p.paths);
  if (!path) {
    const done = p.paths.filter((x) => x.status === 'concluida').length;
    if (done >= catalog.stages.filter((s) => s.kind === 'progresso').length) {
      return p.merit
        ? { title: 'Continuar a crescer', detail: 'Concluíste as etapas da secção. Ajuda os teus companheiros no seu caminho.' }
        : { title: 'Etapas concluídas', detail: 'A Equipa de Animação acompanha o reconhecimento final do teu percurso.', to: '/progresso' };
    }
    return { title: 'Aguardar a próxima etapa', detail: 'A Equipa de Animação vai abrir contigo a próxima etapa e entregar a insígnia.' };
  }
  const s = stageSummary(path, catalog, p);
  if (s.openRequest) {
    return { title: 'Etapa em validação', detail: 'O Conselho de Guias e a Equipa de Animação estão a acompanhar a validação da tua etapa.', to: '/progresso' };
  }
  if (s.ready) {
    return { title: 'Pedir a validação da etapa', detail: 'Tens um trilho validado em cada área. Podes pedir a validação da etapa ao Conselho de Guias.', to: '/progresso' };
  }
  const missing = s.slots.find((slot) => !slot.confirmed && !slot.proposed);
  if (missing) {
    return { title: `Escolher um trilho de ${missing.area.name}`, detail: 'Lê os trilhos da área e propõe à Equipa de Animação aquele em que precisas de crescer.', to: `/progresso#area-${missing.area.code}` };
  }
  const toWork = s.slots.find((slot) => slot.confirmed && !slot.validated && !activeRequest(p.requests, slot.confirmed.trail_key));
  if (toWork?.trail) {
    return { title: `Caminhar no trilho «${toWork.trail.name}»`, detail: 'Vive as oportunidades que escolheste. Quando sentires que alcançaste os objetivos, pede a validação.', to: `/progresso/trilho/${toWork.trail.key}` };
  }
  const waitingChoice = s.slots.find((slot) => slot.proposed);
  if (waitingChoice) {
    return { title: 'Proposta em negociação', detail: 'A Equipa de Animação vai conversar contigo sobre a tua proposta de trilho.', to: '/progresso' };
  }
  return { title: 'Pedidos em análise', detail: 'Os teus pedidos aguardam a reunião de Equipa.', to: '/pedidos' };
}
