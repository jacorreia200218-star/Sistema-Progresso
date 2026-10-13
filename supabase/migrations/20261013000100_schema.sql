-- Pioneiros — esquema base
-- Todas as tabelas ficam no esquema public (expostas via API) com RLS ativa.
-- Funções auxiliares de permissões ficam no esquema private (não exposto).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.section_kind as enum ('lobitos', 'exploradores', 'pioneiros', 'caminheiros');
create type public.member_status as enum ('pendente', 'ativo', 'suspenso', 'saiu');
create type public.member_function as enum ('pioneiro', 'guia', 'dirigente');
create type public.request_kind as enum ('normal', 'historico');
create type public.request_status as enum (
  'rascunho', 'submetido', 'em_revisao', 'validado_equipa', 'devolvido', 'aprovado', 'recusado', 'cancelado'
);
create type public.decision_kind as enum (
  'em_revisao',            -- pedido colocado em análise (reunião de Equipa ou dirigentes)
  'validado_equipa',       -- decisão da reunião de Equipa: validado
  'devolvido_equipa',      -- decisão da reunião de Equipa: continuar a trabalhar
  'devolvido_conselho',    -- devolução fundamentada após comunicação ao Conselho de Guias
  'revisao_animacao',      -- nota de revisão da Equipa de Animação (não altera estado)
  'aprovado_historico',    -- progresso anterior aprovado por dirigente
  'recusado_historico',    -- progresso anterior recusado por dirigente
  'devolvido_historico'    -- progresso anterior devolvido para correção
);
create type public.choice_status as enum ('proposta', 'confirmada', 'recusada', 'retirada', 'substituida');
create type public.stage_path_status as enum ('em_curso', 'concluida');
create type public.stage_request_status as enum ('submetido', 'decidido_conselho', 'confirmada', 'nao_confirmada', 'cancelado');
create type public.council_decision as enum ('favoravel', 'desfavoravel');
create type public.final_opinion as enum ('confirmada', 'nao_confirmada');

-- ---------------------------------------------------------------------------
-- Organização
-- ---------------------------------------------------------------------------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  created_at timestamptz not null default now()
);

create table public.catalog_versions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  section_kind public.section_kind not null,
  label text not null,
  source jsonb not null default '{}'::jsonb,
  status text not null default 'ativo' check (status in ('rascunho', 'ativo', 'arquivado')),
  created_at timestamptz not null default now()
);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete restrict,
  kind public.section_kind not null,
  name text not null check (length(trim(name)) between 1 and 200),
  catalog_version_id uuid references public.catalog_versions (id),
  created_at timestamptz not null default now()
);
create index on public.sections (group_id);

create table public.section_settings (
  section_id uuid primary key references public.sections (id) on delete cascade,
  historical_progress_enabled boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table public.settings_history (
  id bigint generated always as identity primary key,
  section_id uuid not null references public.sections (id) on delete cascade,
  setting text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index on public.settings_history (section_id, changed_at desc);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (section_id, name)
);

-- ---------------------------------------------------------------------------
-- Pessoas e acesso
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (length(full_name) <= 200),
  totem text check (totem is null or length(totem) <= 120),
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  token_hash bytea not null unique,
  label text not null default '' check (length(label) <= 200),
  expires_at timestamptz not null,
  max_uses integer not null check (max_uses between 1 and 500),
  use_count integer not null default 0 check (use_count >= 0),
  revoked_at timestamptz,
  revoked_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (use_count <= max_uses)
);
create index on public.invites (section_id);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  status public.member_status not null default 'pendente',
  function public.member_function,
  is_admin boolean not null default false,
  team_id uuid references public.teams (id),
  invite_id uuid references public.invites (id),
  requested_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (profile_id, section_id),
  check (function is distinct from 'guia' or team_id is not null)
);
create index on public.memberships (section_id, status);
create index on public.memberships (team_id);

create table public.membership_history (
  id bigint generated always as identity primary key,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  section_id uuid not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  old_status public.member_status,
  new_status public.member_status,
  old_function public.member_function,
  new_function public.member_function,
  old_team_id uuid,
  new_team_id uuid,
  old_is_admin boolean,
  new_is_admin boolean,
  reason text
);
create index on public.membership_history (membership_id, changed_at desc);

create table public.invite_redemptions (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.invites (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (invite_id, profile_id)
);

-- ---------------------------------------------------------------------------
-- Catálogo versionado
-- ---------------------------------------------------------------------------
create table public.catalog_stages (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.catalog_versions (id) on delete restrict,
  key text not null,
  name text not null,
  kind text not null check (kind in ('adesao', 'progresso')),
  ordinal integer not null,
  source_page integer,
  summary text,
  unique (version_id, key),
  unique (version_id, ordinal)
);

create table public.catalog_areas (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.catalog_versions (id) on delete restrict,
  code text not null,
  name text not null,
  full_name text not null,
  dimension text,
  position integer not null,
  source_page integer,
  unique (version_id, code)
);

create table public.catalog_trails (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.catalog_versions (id) on delete restrict,
  area_id uuid not null references public.catalog_areas (id) on delete restrict,
  key text not null,
  name text not null,
  position integer not null,
  source_page integer,
  framing text not null,
  keywords text[] not null default '{}',
  opportunities text[] not null default '{}',
  pending_note text,
  unique (version_id, key)
);
create index on public.catalog_trails (area_id);

create table public.catalog_objectives (
  id uuid primary key default gen_random_uuid(),
  trail_id uuid not null references public.catalog_trails (id) on delete restrict,
  code text not null,
  text text not null,
  position integer not null,
  pending_note text,
  unique (trail_id, code)
);

-- ---------------------------------------------------------------------------
-- Progresso
-- ---------------------------------------------------------------------------
-- Adesão (Desprendimento). Decisão do Conselho de Guias com a Equipa de Animação.
create table public.adhesions (
  membership_id uuid primary key references public.memberships (id) on delete cascade,
  decided_on date not null,
  commitment_on date,
  notes text check (notes is null or length(notes) <= 4000),
  is_historical boolean not null default false,
  recorded_by uuid not null,
  recorded_at timestamptz not null default now()
);

-- Percurso de uma etapa de progresso (Conhecimento, Vontade, Construção).
create table public.stage_paths (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  stage_id uuid not null references public.catalog_stages (id),
  stage_key text not null,
  stage_ordinal integer not null,
  status public.stage_path_status not null default 'em_curso',
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  insignia_delivered_on date,
  insignia_recorded_by uuid,
  completed_on date,
  completion_kind text check (completion_kind in ('normal', 'historico')),
  recognized_on date,
  recognition_note text,
  recognized_by uuid,
  unique (membership_id, stage_key),
  check ((status = 'concluida') = (completed_on is not null))
);
create unique index stage_paths_one_open on public.stage_paths (membership_id) where status = 'em_curso';

-- Escolhas negociadas de trilhos para uma etapa.
create table public.stage_choices (
  id uuid primary key default gen_random_uuid(),
  stage_path_id uuid not null references public.stage_paths (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  trail_id uuid not null references public.catalog_trails (id),
  trail_key text not null,
  area_code text not null,
  status public.choice_status not null default 'proposta',
  planned_opportunities text check (planned_opportunities is null or length(planned_opportunities) <= 4000),
  replaces_choice_id uuid references public.stage_choices (id),
  proposed_by uuid not null,
  proposed_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_comment text
);
-- O mesmo trilho não pode estar em duas etapas (nem duas vezes na mesma).
create unique index stage_choices_trail_once on public.stage_choices (membership_id, trail_key)
  where status in ('proposta', 'confirmada');
-- Um trilho confirmado por área em cada etapa; uma proposta pendente por área.
create unique index stage_choices_area_confirmed on public.stage_choices (stage_path_id, area_code)
  where status = 'confirmada';
create unique index stage_choices_area_proposed on public.stage_choices (stage_path_id, area_code)
  where status = 'proposta';

-- Pedidos de validação de trilho (normais ou de progresso anterior).
create table public.trail_requests (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  trail_id uuid not null references public.catalog_trails (id),
  trail_key text not null,
  kind public.request_kind not null,
  status public.request_status not null default 'rascunho',
  current_version integer not null default 1,
  approved_reference_date date,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'historico' or status not in ('aprovado', 'recusado')),
  check (kind = 'normal' or status <> 'validado_equipa')
);
-- Um só pedido ativo (ou validado) por trilho e por membro, seja normal ou histórico:
-- impede pedidos duplicados e contagem dupla do mesmo trilho.
create unique index trail_requests_one_active on public.trail_requests (membership_id, trail_key)
  where status not in ('recusado', 'cancelado');
create index on public.trail_requests (section_id, status);

create table public.trail_request_versions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.trail_requests (id) on delete cascade,
  version_no integer not null,
  reflection text not null default '' check (length(reflection) <= 10000),
  experiences text not null default '' check (length(experiences) <= 10000),
  period_start date,
  period_end date,
  approximate_date text check (approximate_date is null or length(approximate_date) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  withdrawn_at timestamptz,
  unique (request_id, version_no),
  check (period_end is null or period_start is null or period_end >= period_start)
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.trail_requests (id) on delete cascade,
  version_id uuid not null references public.trail_request_versions (id) on delete cascade,
  storage_path text not null,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  uploaded_by uuid not null,
  created_at timestamptz not null default now(),
  unique (version_id, storage_path)
);

create table public.trail_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.trail_requests (id) on delete cascade,
  version_id uuid not null references public.trail_request_versions (id) on delete cascade,
  kind public.decision_kind not null,
  meeting_date date,
  comment text check (comment is null or length(comment) <= 4000),
  reference_date date,
  recorded_by uuid not null,
  recorded_as text not null check (recorded_as in ('guia', 'dirigente')),
  recorded_at timestamptz not null default now()
);
-- Uma única decisão de resultado por versão do pedido (impede decisões contraditórias).
create unique index trail_decisions_one_outcome on public.trail_decisions (version_id)
  where kind in ('validado_equipa', 'devolvido_equipa', 'aprovado_historico', 'recusado_historico', 'devolvido_historico');
create index on public.trail_decisions (request_id, recorded_at);

-- Pedido de validação da etapa (Conselho de Guias + opinião final da Equipa de Animação).
create table public.stage_requests (
  id uuid primary key default gen_random_uuid(),
  stage_path_id uuid not null references public.stage_paths (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  kind text not null default 'normal' check (kind in ('normal', 'historico')),
  status public.stage_request_status not null default 'submetido',
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  council_decision public.council_decision,
  council_date date,
  council_comment text,
  council_recorded_by uuid,
  council_recorded_at timestamptz,
  final_opinion public.final_opinion,
  final_date date,
  final_comment text,
  final_recorded_by uuid,
  final_recorded_at timestamptz
);
create unique index stage_requests_one_open on public.stage_requests (stage_path_id)
  where status in ('submetido', 'decidido_conselho');

-- Anilha de mérito: atribuição efetiva registada por dirigente.
create table public.merit_awards (
  membership_id uuid primary key references public.memberships (id) on delete cascade,
  awarded_on date not null,
  kind text not null check (kind in ('normal', 'historico')),
  comment text,
  recorded_by uuid not null,
  recorded_at timestamptz not null default now()
);

-- Diário pessoal de vivências / oportunidades educativas (não valida nada por si).
create table public.experiences (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  trail_key text,
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 4000),
  occurred_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.experiences (membership_id);

-- ---------------------------------------------------------------------------
-- Notificações e auditoria
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  section_id uuid references public.sections (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (profile_id, created_at desc);

create table public.audit_log (
  id bigint generated always as identity primary key,
  section_id uuid,
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index on public.audit_log (section_id, at desc);
