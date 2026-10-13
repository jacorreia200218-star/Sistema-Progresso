// O Caminho: estrutura do Sistema de Progresso tal como o manual a descreve
// (esquemas das pp. 3 e 14; explicações das pp. 4–15, 62–63) e a posição de
// cada pioneiro nele. As regras são aplicadas no servidor; aqui só se calcula
// o que mostrar, com a mesma lógica de private.member_position (SQL).
import type { Catalog, MemberProgress } from './types';
import { activeRequest, openPath, stageSummary, validatedKeys, type StageSummary } from './progress';

export type MilestoneKey =
  | 'sinais_pista' | 'inicio_pista' | 'promessa' | 'conhecimento' | 'vontade' | 'construcao' | 'acampamento' | 'passagem';

export type PositionState =
  | 'em_adesao' | 'perfil_tracado'                       // Início de Pista
  | 'aguarda_promessa' | 'aguarda_etapa'                 // Promessa/Investidura
  | 'em_curso' | 'requisitos_cumpridos' | 'em_validacao' // a viver uma etapa («estar em»)
  | 'concluida' | 'reconhecida'                          // etapa concluída («ter concluído»)
  | 'etapas_concluidas' | 'anilha_atribuida';           // Acampamento

export interface Milestone {
  key: MilestoneKey;
  name: string;
  short: string;
  icon: 'sinais' | 'circulo' | 'promessa' | 'seta' | 'tenda' | 'regresso';
  pages: string;
  /** Marco vivido dentro da aplicação (com pessoas posicionadas) ou apenas informativo. */
  tracked: boolean;
  summary: string;
  needed: string[];
  validation: string;
  advance: string;
  note?: string;
}

export const STAGE_KEYS = ['conhecimento', 'vontade', 'construcao'] as const;

const STAGE_COMMON = {
  needed: [
    'Escolher e negociar com a Equipa de Animação um trilho de cada uma das seis áreas (FACEIS), percebendo os objetivos pelo texto do trilho e pelas palavras-chave (pp. 9–10).',
    'Identificar as oportunidades educativas a viver para cada trilho; o manual sugere pelo menos duas por trilho, como orientação (p. 11).',
    'Viver as oportunidades — no escutismo, em casa, na escola. Realizar uma oportunidade não valida o trilho por si (p. 11).',
    'Trilhos já alcançados podem ser reconhecidos na negociação, quando devidamente fundamentados (p. 10).',
  ],
  validation:
    'Cada trilho é validado na reunião de Equipa, a pedido do pioneiro, e a decisão é comunicada ao Conselho de Guias. Com um trilho validado em cada área, a etapa é validada no Conselho de Guias e o processo termina com a opinião da Equipa de Animação, fundamentada quando contrária (pp. 11–12).',
  advance:
    'A etapa só fica concluída depois da opinião final da Equipa de Animação. Segue-se o reconhecimento público, na celebração (p. 12). A insígnia da etapa seguinte é entregue no início dessa etapa (p. 9).',
};

export const MILESTONES: Milestone[] = [
  {
    key: 'sinais_pista', name: 'Sinais de Pista', short: 'Sinais de Pista', icon: 'sinais', pages: 'pp. 3, 4, 14', tracked: false,
    summary: 'Aproximação entre a secção e o elemento (adesão informal). Acontece no último trimestre do último ano na secção anterior, sem pressões: o elemento continua a viver a sua secção.',
    needed: ['Participar, a convite dos Guias, numa atividade para conhecer as Equipas, os Guias, a Equipa de Animação e o tipo de atividades.', 'Pode haver um momento prévio num Conselho de Guias, onde se apresenta o funcionamento da secção.'],
    validation: 'Não há validação: é um período de descoberta, observando sem tarefas nem responsabilidades.',
    advance: 'A passagem de secção, no início do ano escutista, dá início ao Início de Pista.',
    note: 'Acontece antes de entrar na secção; não é registado nesta aplicação.',
  },
  {
    key: 'inicio_pista', name: 'Início de Pista', short: 'Início de Pista', icon: 'circulo', pages: 'pp. 4–7', tracked: true,
    summary: 'Adesão formal à secção (etapa do Desprendimento). O Noviço/Aspirante recebe a insígnia de adesão e a Equipa de Animação traça o seu perfil, por observação direta, com ajuda do Guia.',
    needed: [
      'Participar no quotidiano da secção, vivendo o Sistema de Equipas e o Empreendimento.',
      'Adquirir os conhecimentos de adesão da III Secção (p. 6) — ver a lista abaixo.',
      'Refletir sobre o compromisso e tomar a iniciativa de comunicar a vontade de fazer a Promessa/Investidura.',
      'Na III Secção, a adesão não deve ultrapassar os 7 meses (p. 5).',
    ],
    validation: 'A decisão sobre a adesão é tomada em Conselho de Guias, com a presença de toda a Equipa de Animação (p. 7).',
    advance: 'Com a adesão decidida, segue-se a Promessa/Investidura.',
  },
  {
    key: 'promessa', name: 'Promessa / Investidura', short: 'Promessa', icon: 'promessa', pages: 'p. 8', tracked: true,
    summary: 'O elemento reconhece que quer assumir o compromisso. A Promessa faz-se uma vez; nas secções seguintes renova-se com a Investidura. Deve haver um momento prévio de reflexão.',
    needed: ['Preparar e compreender a fórmula da Promessa ao longo do Início de Pista.', 'Viver o momento de reflexão prévio.'],
    validation: 'Validada no Conselho de Guias; propõe-se que o elemento não espere mais de 2 meses pelo momento da Promessa (p. 8).',
    advance: 'Depois da Promessa/Investidura faz-se a primeira escolha/negociação e começa a etapa do Conhecimento, com a entrega da insígnia (pp. 9–10).',
  },
  {
    key: 'conhecimento', name: 'Conhecimento', short: 'Conhecimento', icon: 'seta', pages: 'pp. 9–13, 62', tracked: true,
    summary: '1.ª etapa — Saber. Procurar a razão de ser de tudo: o conhecimento do mundo, da experiência dos outros e dos limites do que é possível, ganhando autonomia.',
    ...STAGE_COMMON,
  },
  {
    key: 'vontade', name: 'Vontade', short: 'Vontade', icon: 'seta', pages: 'pp. 9–13, 62–63', tracked: true,
    summary: '2.ª etapa — Querer. O conhecimento aprofunda a vontade de transformar o sonho em realidade, no grupo e com o grupo.',
    ...STAGE_COMMON,
  },
  {
    key: 'construcao', name: 'Construção', short: 'Construção', icon: 'seta', pages: 'pp. 9–13, 63', tracked: true,
    summary: '3.ª etapa — Agir. Em Comunidade, no Empreendimento, o culminar do crescimento na secção: a capacidade de construir os seus sonhos.',
    ...STAGE_COMMON,
  },
  {
    key: 'acampamento', name: 'Acampamento / Anilha de Mérito', short: 'Acampamento', icon: 'tenda', pages: 'p. 13', tracked: true,
    summary: 'Ao terminar a última etapa — todos os trilhos da secção — chega-se ao local de Acampamento. A anilha de mérito é entregue num momento solene, com cerimonial próprio.',
    needed: ['Ter concluído a etapa da Construção (todos os trilhos da secção validados).', 'Não estagnar: dedicar-se às especialidades e a outros projetos e ajudar o progresso dos companheiros.'],
    validation: 'A aplicação calcula a elegibilidade; a atribuição da anilha é um registo próprio da Equipa de Animação, com data. Não é automática.',
    advance: 'Continua na secção até à passagem, que não depende de ter concluído todo o progresso.',
  },
  {
    key: 'passagem', name: 'Passagem de secção / Voltar ao Início de Pista', short: 'Passagem', icon: 'regresso', pages: 'pp. 13–14', tracked: false,
    summary: 'Ao atingir a idade de passagem prevista no Regulamento Geral (o esquema da p. 14 assinala os 17 anos para a III Secção), e se tiver maturidade para a secção seguinte, o elemento volta ao Início de Pista na IV Secção, depois de viver os Sinais de Pista dessa secção.',
    needed: ['Viver os Sinais de Pista da secção seguinte (período de descoberta antes da passagem).', 'Conversa entre os Chefes de Unidade das duas secções.'],
    validation: 'Decisão da Equipa de Animação com bom senso e flexibilidade: não basta atingir a idade, nem é preciso ter concluído todo o progresso (p. 13).',
    advance: 'Começa um novo Início de Pista na secção seguinte.',
    note: 'A passagem pode acontecer em qualquer ponto do caminho; não é automática nem registada como resultado do progresso.',
  },
];

export const milestoneByKey = Object.fromEntries(MILESTONES.map((m) => [m.key, m])) as Record<MilestoneKey, Milestone>;

/** Conhecimentos de adesão da III Secção (p. 6, coluna «III Secção»). */
export const ADHESION_KNOWLEDGE = {
  movimento: [
    'Sabes quando e como surgiu o Escutismo e o CNE?',
    'Sabes como se organiza o teu Agrupamento? E o CNE?',
    'Conheces a vida de Baden-Powell?',
    'Conheces a Lei, os Princípios e a Promessa?',
    'Já sabes rezar a Oração do Escuta?',
    'Conheces o livro “Escutismo para Rapazes”?',
    'Conheces o uniforme e os distintivos de função dos dirigentes?',
    'Conheces a saudação e sabes o que ela significa?',
    'Conheces a fórmula da promessa e o que significa?',
    'Reconheces que o Escutismo é uma fraternidade mundial?',
  ],
  seccao: [
    'Como se organizam os Pioneiros?',
    'Quais são os cargos existentes na Equipa?',
    'Quais os símbolos e qual a Mística dos Pioneiros?',
    'Conheces o Patrono dos Pioneiros e o da tua Equipa?',
    'Já sabes trabalhar e viver em Equipa?',
    'Já participaste num Empreendimento?',
    'Já conheces as Áreas e os Trilhos que terás de escolher na tua Etapa de Conhecimento?',
    'Conheces os projetos existentes para os Pioneiros?',
  ],
  nota: 'Regra geral, a adesão ao movimento é feita pelos Aspirantes (quem entra no escutismo) e a adesão à secção pelos Aspirantes e Noviços (p. 5).',
};

export const STATE_LABEL: Record<PositionState, { label: string; tone: 'neutral' | 'progress' | 'ok' | 'attention' | 'muted'; kind: 'em_curso' | 'requisitos' | 'decisao' | 'concluida' | 'reconhecida' }> = {
  em_adesao: { label: 'A viver a adesão', tone: 'progress', kind: 'em_curso' },
  perfil_tracado: { label: 'Adesão · perfil traçado', tone: 'progress', kind: 'em_curso' },
  aguarda_promessa: { label: 'Adesão decidida · aguarda Promessa', tone: 'progress', kind: 'decisao' },
  aguarda_etapa: { label: 'Promessa feita · etapa por abrir', tone: 'progress', kind: 'decisao' },
  em_curso: { label: 'Em curso', tone: 'progress', kind: 'em_curso' },
  requisitos_cumpridos: { label: 'Requisitos cumpridos · falta pedir a validação', tone: 'attention', kind: 'requisitos' },
  em_validacao: { label: 'Em validação (Conselho de Guias)', tone: 'attention', kind: 'decisao' },
  concluida: { label: 'Concluída · reconhecimento por registar', tone: 'ok', kind: 'concluida' },
  reconhecida: { label: 'Concluída e reconhecida', tone: 'ok', kind: 'reconhecida' },
  etapas_concluidas: { label: 'Etapas concluídas · anilha por registar', tone: 'ok', kind: 'concluida' },
  anilha_atribuida: { label: 'Anilha de mérito atribuída', tone: 'ok', kind: 'reconhecida' },
};

export interface Position {
  milestone: MilestoneKey;
  state: PositionState;
}

/** Mesma regra que private.member_position (SQL). */
export function memberPosition(p: MemberProgress, catalog: Catalog): Position {
  const a = p.adhesion;
  // Etapas já abertas têm prioridade (dados anteriores à exigência da Promessa).
  if (!p.paths.length) {
    if (!a || !a.decided_on) return { milestone: 'inicio_pista', state: a?.profile_traced_on ? 'perfil_tracado' : 'em_adesao' };
    if (!a.commitment_on) return { milestone: 'promessa', state: 'aguarda_promessa' };
  }
  const open = openPath(p.paths);
  if (open) {
    const s = stageSummary(open, catalog, p);
    const state: PositionState = s.openRequest ? 'em_validacao' : s.validatedCount === catalog.areas.length ? 'requisitos_cumpridos' : 'em_curso';
    return { milestone: open.stage_key as MilestoneKey, state };
  }
  const done = p.paths.filter((x) => x.status === 'concluida').sort((x, y) => y.stage_ordinal - x.stage_ordinal);
  if (!done.length) return { milestone: 'promessa', state: 'aguarda_etapa' };
  const last = done[0];
  const max = Math.max(...catalog.stages.filter((s) => s.kind === 'progresso').map((s) => s.ordinal));
  if (last.stage_ordinal >= max) return { milestone: 'acampamento', state: p.merit ? 'anilha_atribuida' : 'etapas_concluidas' };
  return { milestone: last.stage_key as MilestoneKey, state: last.recognized_on ? 'reconhecida' : 'concluida' };
}

export type PhaseStatus = 'feito' | 'atual' | 'por_fazer';
export interface Phase {
  key: 'escolha' | 'desenvolvimento' | 'validacao' | 'reconhecimento';
  label: string;
  status: PhaseStatus;
  detail: string;
}

/** Ciclo de uma etapa (p. 14): Escolha/Negociação → Desenvolvimento → Validação → Reconhecimento. */
export function stageCycle(s: StageSummary | null, areas: number): Phase[] {
  const chosen = s ? s.confirmedCount : 0;
  const validated = s ? s.validatedCount : 0;
  const concluded = s?.path.status === 'concluida';
  const recognized = !!s?.path.recognized_on;
  const done = [chosen === areas, validated === areas, concluded, recognized];
  const firstOpen = s ? done.findIndex((d) => !d) : -1;
  const status = (i: number): PhaseStatus => (!s ? 'por_fazer' : done[i] ? 'feito' : i === firstOpen ? 'atual' : 'por_fazer');
  return [
    { key: 'escolha', label: 'Escolha e negociação', status: status(0), detail: `${chosen} de ${areas} trilhos confirmados` },
    { key: 'desenvolvimento', label: 'Oportunidades educativas', status: status(1), detail: `${validated} de ${areas} trilhos validados na Equipa` },
    {
      key: 'validacao', label: 'Validação da etapa', status: status(2),
      detail: concluded ? 'Validada pelo Conselho de Guias e pela Equipa de Animação'
        : s?.openRequest ? (s.openRequest.status === 'submetido' ? 'Aguarda o Conselho de Guias' : 'Aguarda a opinião final da Equipa de Animação')
        : 'Depois de um trilho validado em cada área',
    },
    { key: 'reconhecimento', label: 'Reconhecimento', status: status(3), detail: recognized ? 'Reconhecimento público registado' : 'Na celebração, depois da etapa concluída' },
  ];
}

function joinPt(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

const areaPhrase = (names: string[]) => (names.length === 1 ? `da área ${names[0]}` : `das áreas ${joinPt(names)}`);

export interface StageNeeds {
  /** O que o pioneiro tem de fazer (requisitos educativos por cumprir). */
  todo: string | null;
  /** O que aguarda uma decisão pedagógica de outros. */
  waiting: string | null;
  /** Trilhos da etapa já validados. */
  done: string[];
}

/** Frases concretas sobre o que falta numa etapa, por área FACEIS. */
export function stageNeeds(s: StageSummary, p: MemberProgress): StageNeeds {
  const toChoose: string[] = [];
  const toDevelop: string[] = [];
  const toFinish: string[] = [];
  const toRevise: string[] = [];
  const negotiation: string[] = [];
  const validation: string[] = [];
  const done: string[] = [];
  for (const slot of s.slots) {
    const area = slot.area.name;
    if (slot.validated) {
      done.push(`${slot.trail?.name} (${area})`);
      continue;
    }
    if (!slot.confirmed) {
      if (slot.proposed) negotiation.push(area);
      else toChoose.push(area);
      continue;
    }
    const req = activeRequest(p.requests, slot.confirmed.trail_key);
    if (!req) toDevelop.push(area);
    else if (req.status === 'rascunho') toFinish.push(area);
    else if (req.status === 'devolvido') toRevise.push(area);
    else validation.push(area);
  }
  const todo: string[] = [];
  if (toChoose.length) todo.push(`escolher o trilho ${areaPhrase(toChoose)}`);
  if (toDevelop.length) todo.push(`desenvolver e pedir a validação do trilho escolhido ${areaPhrase(toDevelop)}`);
  if (toFinish.length) todo.push(`submeter o pedido do trilho ${areaPhrase(toFinish)}`);
  if (toRevise.length) todo.push(`rever o pedido devolvido ${areaPhrase(toRevise)}`);
  const waiting: string[] = [];
  if (negotiation.length) waiting.push(`a negociação do trilho proposto ${areaPhrase(negotiation)}`);
  if (validation.length) waiting.push(`a decisão da reunião de Equipa sobre o trilho ${areaPhrase(validation)}`);
  if (s.openRequest) waiting.push(s.openRequest.status === 'submetido' ? 'a decisão do Conselho de Guias sobre a etapa' : 'a opinião final da Equipa de Animação sobre a etapa');
  return {
    todo: todo.length ? `Falta ${joinPt(todo)}.` : null,
    waiting: waiting.length ? `Aguarda ${joinPt(waiting)}.` : null,
    done,
  };
}

export interface AreaMarker {
  code: string;
  name: string;
  validated: number; // trilhos validados/reconhecidos nesta área (0–3)
  inStages: number; // trilhos desta área atribuídos a etapas concluídas
  total: number;
}

/** Marcos acumulados por área: 1, 2 e 3 trilhos validados (p. 14). */
export function areaMarkers(p: MemberProgress, catalog: Catalog): AreaMarker[] {
  const valid = validatedKeys(p.requests);
  const concluded = new Set(p.paths.filter((x) => x.status === 'concluida').map((x) => x.id));
  return catalog.areas.map((a) => ({
    code: a.code,
    name: a.name,
    validated: a.catalog_trails.filter((t) => valid.has(t.key)).length,
    inStages: p.choices.filter((c) => c.area_code === a.code && c.status === 'confirmada' && concluded.has(c.stage_path_id)).length,
    total: a.catalog_trails.length,
  }));
}

export function stageIndex(key: MilestoneKey): number {
  return MILESTONES.findIndex((m) => m.key === key);
}

/** Resumo de uma etapa para o percurso individual (estado próprio de cada etapa). */
export function stageStatusFor(key: string, p: MemberProgress, catalog: Catalog): { state: PositionState | 'nao_iniciada'; summary: StageSummary | null } {
  const path = p.paths.find((x) => x.stage_key === key);
  if (!path) return { state: 'nao_iniciada', summary: null };
  const s = stageSummary(path, catalog, p);
  if (path.status === 'concluida') return { state: path.recognized_on ? 'reconhecida' : 'concluida', summary: s };
  return { state: s.openRequest ? 'em_validacao' : s.validatedCount === catalog.areas.length ? 'requisitos_cumpridos' : 'em_curso', summary: s };
}
