// Cálculo dos estados mostrados na interface, sempre a partir de registos
// persistidos (pedidos, decisões, escolhas). Nada aqui valida coisa nenhuma:
// as regras são aplicadas no servidor; isto só resume para apresentação.
import type { Catalog, CatalogArea, CatalogTrail, MemberProgress, StageChoice, StagePath, StageRequest, TrailRequest } from './types';

export type TrailUiState = 'validado' | 'pendente' | 'devolvido' | 'rascunho' | 'selecionado' | 'proposto' | 'por_trabalhar';

// «objetivos_validados» (modelo anterior, por objetivos): histórico inativo; não fecha o trilho.
const INACTIVE: TrailRequest['status'][] = ['recusado', 'cancelado', 'objetivos_validados'];

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
  /** Frase curta, no infinitivo, válida para o próprio e para quem acompanha. */
  title: string;
  detail?: string;
  to?: string;
  /** Texto do botão, quando há uma ação disponível para quem está a ver. */
  label?: string;
}

/** Quem está a ver: o próprio pioneiro, um dirigente, o guia da equipa ou outra pessoa. */
export type Viewer = { kind: 'self' } | { kind: 'dirigente' | 'guia' | 'outro'; membershipId: string };

function joinPt(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

/**
 * Próximo passo, calculado a partir dos registos reais. Nunca associa nem valida
 * nada: só indica a ação seguinte e, quando existe, o caminho para a fazer, de
 * acordo com o papel de quem está a ver (negociação e validação mantêm-se).
 */
export function nextAction(catalog: Catalog, p: MemberProgress, viewer: Viewer = { kind: 'self' }): NextAction {
  const self = viewer.kind === 'self';
  const leader = viewer.kind === 'dirigente';
  const memberTo = (tab: string) => (viewer.kind === 'self' ? undefined : `/membros/${viewer.membershipId}?separador=${tab}`);
  const q = viewer.kind === 'self' ? '' : `pioneiro=${viewer.membershipId}`;
  const progress = (vista: string, extra = '') => `/meu-progresso?vista=${vista}${extra}${q ? `&${q}` : ''}`;
  const trailTo = (key: string, hash = '') => `/meu-progresso/trilho/${key}${q ? `?${q}` : ''}${hash}`;
  const name = (key: string) => catalog.trailByKey.get(key)?.name ?? 'trilho';

  const returned = p.requests.find((r) => r.status === 'devolvido');
  if (returned) return { title: `Rever o pedido de «${name(returned.trail_key)}»`, to: trailTo(returned.trail_key, '#pedido'), label: self ? 'Rever pedido' : 'Ver pedido' };
  const draft = p.requests.find((r) => r.status === 'rascunho');
  if (draft) return { title: `Terminar o pedido de «${name(draft.trail_key)}»`, to: trailTo(draft.trail_key, '#pedido'), label: self ? 'Continuar' : 'Ver pedido' };
  if (!p.adhesion?.decided_on) return { title: 'Viver o Início de Pista', to: leader ? memberTo('historico') : progress('caminho'), label: leader ? 'Registar adesão' : undefined };
  if (!p.adhesion.commitment_on) return { title: 'Preparar a Promessa / Investidura', to: leader ? memberTo('historico') : progress('caminho'), label: leader ? 'Registar Promessa' : undefined };

  const path = openPath(p.paths);
  if (!path) {
    const done = p.paths.filter((x) => x.status === 'concluida').length;
    if (done >= catalog.stages.filter((st) => st.kind === 'progresso').length) {
      return p.merit ? { title: 'Continuar a crescer e ajudar os outros' } : { title: 'Etapas concluídas · falta o reconhecimento final', to: leader ? memberTo('historico') : undefined };
    }
    return { title: 'Abrir a próxima etapa', detail: 'A Equipa de Animação abre a etapa e entrega a insígnia.', to: leader ? memberTo('etapa') : undefined, label: leader ? 'Abrir etapa' : undefined };
  }
  const s = stageSummary(path, catalog, p);
  if (s.openRequest) return { title: s.openRequest.status === 'submetido' ? 'Etapa no Conselho de Guias' : 'Etapa a aguardar a opinião final', to: leader ? '/acompanhamento/etapas' : undefined, label: leader ? 'Acompanhar' : undefined };
  if (s.ready) return { title: 'Pedir a validação da etapa', to: leader ? memberTo('etapa') : progress('caminho'), label: 'Pedir validação' };

  // Trilhos já validados/reconhecidos que ainda não estão em nenhuma etapa e que
  // podem ocupar uma área sem escolha: só contam depois de negociados.
  const assigned = new Set(p.choices.filter((c) => c.status === 'confirmada' || c.status === 'proposta').map((c) => c.trail_key));
  const openAreas = new Set(s.slots.filter((slot) => !slot.confirmed && !slot.proposed).map((slot) => slot.area.code));
  const usable = p.requests.filter(isValidated).map((r) => catalog.trailByKey.get(r.trail_key)).filter((t): t is CatalogTrail => !!t && !assigned.has(t.key))
    .filter((t) => openAreas.has(catalog.areaById.get(t.area_id)?.code ?? ''));
  if (usable.length) {
    return {
      title: usable.length === 1 ? `Associar «${usable[0].name}» à etapa` : `Associar ${usable.length} trilhos reconhecidos à etapa`,
      detail: 'Já estão validados mas ainda não contam para a etapa: a associação faz-se na negociação com a Equipa de Animação.',
      to: leader ? memberTo('etapa') : self ? progress('validado') : undefined,
      label: leader ? 'Rever e propor' : self ? 'Ver trilhos reconhecidos' : undefined,
    };
  }

  const missing = s.slots.filter((slot) => !slot.confirmed && !slot.proposed);
  if (missing.length) {
    return {
      title: missing.length === catalog.areas.length ? 'Escolher um trilho em cada área' : `Escolher trilho em ${joinPt(missing.map((m) => m.area.name))}`,
      to: progress('areas', missing.length === 1 ? `&area=${missing[0].area.code}` : ''),
      label: 'Ver áreas',
    };
  }
  const proposed = s.slots.filter((slot) => slot.proposed && !slot.confirmed);
  if (proposed.length) return { title: 'Negociar as propostas de trilho', to: leader ? '/acompanhamento/pedidos?tipo=negociacao' : undefined, label: leader ? 'Negociar' : undefined };
  const revise = s.slots.find((slot) => slot.state === 'devolvido');
  if (revise?.trail) return { title: `Rever o pedido de «${revise.trail.name}»`, to: trailTo(revise.trail.key, '#pedido'), label: 'Ver pedido' };
  const toWork = s.slots.filter((slot) => slot.confirmed && !slot.validated && !activeRequest(p.requests, slot.confirmed.trail_key));
  if (toWork.length === 1 && toWork[0].trail) return { title: `Fechar o trilho «${toWork[0].trail.name}»`, to: trailTo(toWork[0].trail.key), label: 'Abrir trilho' };
  if (toWork.length > 1) return { title: `Fechar os trilhos de ${joinPt(toWork.map((x) => x.area.name))}`, to: progress('areas'), label: 'Ver áreas' };
  return { title: 'Aguardar a reunião de Equipa', to: progress('pedidos', '&pfiltro=aguarda'), label: 'Ver pedidos' };
}
