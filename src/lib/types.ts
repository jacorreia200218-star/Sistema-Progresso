// Tipos das linhas da base de dados usados pela interface.
export type MemberStatus = 'pendente' | 'ativo' | 'suspenso' | 'saiu';
export type MemberFunction = 'pioneiro' | 'guia' | 'dirigente';
export type RequestKind = 'normal' | 'historico' | 'negociacao';
export type RequestStatus =
  | 'rascunho'
  | 'submetido'
  | 'em_revisao'
  /** Validado pelos guias na reunião de Equipa; falta a confirmação dos dirigentes. */
  | 'validado_guias'
  | 'validado_equipa'
  | 'devolvido'
  | 'aprovado'
  | 'recusado'
  | 'cancelado'
  /** Modelo anterior (histórico): objetivos aceites que não fecharam o trilho. */
  | 'objetivos_validados';
export type DecisionKind =
  | 'em_revisao'
  | 'validado_guias'
  | 'validado_equipa'
  | 'devolvido_equipa'
  | 'devolvido_conselho'
  | 'revisao_animacao'
  | 'aprovado_historico'
  | 'recusado_historico'
  | 'devolvido_historico'
  | 'reconhecido_negociacao'
  | 'objetivos_equipa';
export type ChoiceStatus = 'proposta' | 'confirmada' | 'recusada' | 'retirada' | 'substituida';
export type StageRequestStatus = 'submetido' | 'decidido_conselho' | 'confirmada' | 'nao_confirmada' | 'cancelado';

export interface Profile {
  id: string;
  full_name: string;
  totem: string | null;
  photo_path: string | null;
}

export interface Section {
  id: string;
  name: string;
  kind: string;
  group_id: string;
  catalog_version_id: string | null;
  groups?: { name: string } | null;
}

export interface Membership {
  id: string;
  profile_id: string;
  section_id: string;
  status: MemberStatus;
  function: MemberFunction | null;
  is_admin: boolean;
  team_id: string | null;
  requested_team_id?: string | null;
  requested_at: string;
  approved_at: string | null;
}

export interface Team {
  id: string;
  section_id: string;
  name: string;
  archived_at: string | null;
}

export interface SectionSettings {
  section_id: string;
  historical_progress_enabled: boolean;
  updated_by: string | null;
  updated_at: string;
}

export interface CatalogStage {
  id: string;
  version_id: string;
  key: string;
  name: string;
  kind: 'adesao' | 'progresso';
  ordinal: number;
  source_page: number | null;
  summary: string | null;
}

export interface CatalogObjective {
  id: string;
  trail_id: string;
  code: string;
  text: string;
  position: number;
  pending_note: string | null;
}

export interface CatalogTrail {
  id: string;
  version_id: string;
  area_id: string;
  key: string;
  name: string;
  position: number;
  source_page: number | null;
  framing: string;
  keywords: string[];
  opportunities: string[];
  pending_note: string | null;
  catalog_objectives: CatalogObjective[];
}

export interface CatalogArea {
  id: string;
  version_id: string;
  code: string;
  name: string;
  full_name: string;
  dimension: string | null;
  position: number;
  source_page: number | null;
  catalog_trails: CatalogTrail[];
}

export interface Catalog {
  versionId: string;
  label: string;
  areas: CatalogArea[];
  stages: CatalogStage[];
  trailById: Map<string, CatalogTrail>;
  trailByKey: Map<string, CatalogTrail>;
  areaById: Map<string, CatalogArea>;
}

export interface Adhesion {
  membership_id: string;
  decided_on: string | null;
  commitment_on: string | null;
  profile_traced_on?: string | null;
  notes: string | null;
  is_historical: boolean;
  recorded_at: string;
}

export interface StagePath {
  id: string;
  membership_id: string;
  stage_id: string;
  stage_key: string;
  stage_ordinal: number;
  status: 'em_curso' | 'concluida';
  opened_at: string;
  insignia_delivered_on: string | null;
  completed_on: string | null;
  completion_kind: 'normal' | 'historico' | null;
  recognized_on: string | null;
  recognition_note: string | null;
}

export interface StageChoice {
  id: string;
  stage_path_id: string;
  membership_id: string;
  trail_id: string;
  trail_key: string;
  area_code: string;
  status: ChoiceStatus;
  planned_opportunities: string | null;
  replaces_choice_id: string | null;
  proposed_by: string;
  proposed_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
}

export interface TrailRequest {
  id: string;
  membership_id: string;
  section_id: string;
  trail_id: string;
  trail_key: string;
  kind: RequestKind;
  status: RequestStatus;
  current_version: number;
  approved_reference_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequestVersion {
  id: string;
  request_id: string;
  version_no: number;
  reflection: string;
  experiences: string;
  context?: string;
  evidence?: string;
  period_start: string | null;
  period_end: string | null;
  approximate_date: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  withdrawn_at: string | null;
}

export interface Attachment {
  id: string;
  request_id: string;
  version_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface TrailDecision {
  id: string;
  request_id: string;
  version_id: string;
  kind: DecisionKind;
  meeting_date: string | null;
  comment: string | null;
  reference_date: string | null;
  recorded_by: string;
  recorded_as: 'guia' | 'dirigente';
  recorded_at: string;
  /** Numa devolução: objetivos que ainda precisam de ser demonstrados (informativo). */
  objective_codes?: string[] | null;
}

export interface StageRequest {
  id: string;
  stage_path_id: string;
  membership_id: string;
  kind: 'normal' | 'historico';
  status: StageRequestStatus;
  requested_at: string;
  council_decision: 'favoravel' | 'desfavoravel' | null;
  council_date: string | null;
  council_comment: string | null;
  final_opinion: 'confirmada' | 'nao_confirmada' | null;
  final_date: string | null;
  final_comment: string | null;
}

export interface MeritAward {
  membership_id: string;
  awarded_on: string;
  kind: 'normal' | 'historico';
  comment: string | null;
  recorded_at: string;
}

export interface MeritStatus {
  validated: number;
  total: number;
  last_stage_concluded: boolean;
  eligible: boolean;
}

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface Experience {
  id: string;
  membership_id: string;
  trail_key: string | null;
  title: string;
  description: string;
  occurred_on: string | null;
  created_at: string;
}

export interface Invite {
  id: string;
  code: string | null; // código curto (só os convites antigos não o têm)
  team_id: string | null;
  replaced_by?: string | null;
  label: string;
  expires_at: string;
  max_uses: number;
  use_count: number;
  revoked_at: string | null;
  created_at: string;
}

/** Objetivo de um pedido do modelo anterior (por objetivo), guardado como histórico. */
export interface RequestObjective {
  id: string;
  request_id: string;
  version_id: string;
  objective_id: string;
  objective_code: string;
  decision: 'aceite' | 'rever' | null;
  comment: string | null;
  decided_at: string | null;
  /** Número da versão (preenchido pela interface a partir das versões). */
  version_no?: number;
}

/** Progresso de um membro, carregado de uma vez para cálculo dos estados. */
export interface MemberProgress {
  adhesion: Adhesion | null;
  paths: StagePath[];
  choices: StageChoice[];
  requests: TrailRequest[];
  stageRequests: StageRequest[];
  merit: MeritAward | null;
  /** Decisões de resultado sobre os pedidos (datas e autoria da validação). */
  decisions?: TrailDecision[];
  /** Decisões por objetivo do modelo anterior (histórico; não fecham trilhos). */
  objectives?: RequestObjective[];
}
