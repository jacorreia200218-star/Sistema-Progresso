-- GERADO por scripts/bundle-migrations.mjs — não editar à mão.
-- Instalação completa num projeto Supabase NOVO: cola tudo no SQL Editor e carrega em «Run».
-- Corre uma única vez. Para atualizações futuras usa as migrações individuais (supabase db push).

-- ===== 20261013000100_schema.sql =====
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


-- ===== 20261013000200_access.sql =====
-- Pioneiros — funções de permissões, gatilhos de histórico e políticas RLS.
-- Princípio: o cliente só LÊ (filtrado por RLS). Todas as escritas com efeito
-- pedagógico ou administrativo passam por funções RPC que validam permissões
-- no servidor. A única exceção é o diário pessoal de vivências (experiences).

-- ---------------------------------------------------------------------------
-- Funções auxiliares (SECURITY DEFINER, esquema private, não expostas pela API)
-- ---------------------------------------------------------------------------

-- Membro ativo do utilizador atual numa secção.
create or replace function private.my_active_membership(p_section uuid)
returns public.memberships
language sql stable security definer set search_path = ''
as $$
  select m.* from public.memberships m
  where m.section_id = p_section and m.profile_id = auth.uid() and m.status = 'ativo'
  limit 1
$$;

create or replace function private.is_active_member(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.section_id = p_section and m.profile_id = auth.uid() and m.status = 'ativo'
  )
$$;

create or replace function private.is_dirigente(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.section_id = p_section and m.profile_id = auth.uid()
      and m.status = 'ativo' and m.function = 'dirigente'
  )
$$;

create or replace function private.is_admin(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.section_id = p_section and m.profile_id = auth.uid()
      and m.status = 'ativo' and m.is_admin
  )
$$;

-- Equipa que o utilizador atual guia nesta secção (null se não for guia ativo).
create or replace function private.guia_team(p_section uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select m.team_id from public.memberships m
  where m.section_id = p_section and m.profile_id = auth.uid()
    and m.status = 'ativo' and m.function = 'guia'
  limit 1
$$;

-- Pode ver o percurso/progresso deste membro?
-- O próprio (se ativo), dirigentes ativos da secção, ou o guia ATUAL da equipa
-- ATUAL do membro. Um antigo guia perde o acesso imediatamente.
create or replace function private.can_view_progress(p_membership uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships target
    join public.memberships me
      on me.section_id = target.section_id and me.profile_id = auth.uid() and me.status = 'ativo'
    where target.id = p_membership
      and (
        me.id = target.id
        or me.function = 'dirigente'
        or (me.function = 'guia' and me.team_id is not null
            and me.team_id = target.team_id and target.status = 'ativo')
      )
  )
$$;

-- Pode ver os dados de inscrição (membership) de alguém?
create or replace function private.can_view_membership(p_membership uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships target
    join public.memberships me on me.section_id = target.section_id and me.profile_id = auth.uid()
    where target.id = p_membership
      and (
        me.id = target.id
        or (me.status = 'ativo' and (me.is_admin or me.function = 'dirigente'))
        or (me.status = 'ativo' and target.status = 'ativo' and (
              (me.team_id is not null and me.team_id = target.team_id)
              or target.function = 'dirigente'))
      )
  )
$$;

-- Pode ver o perfil (nome, totem, fotografia) de alguém?
create or replace function private.can_view_profile(p_profile uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_profile = auth.uid() or exists (
    select 1
    from public.memberships target
    where target.profile_id = p_profile
      and private.can_view_membership(target.id)
  )
$$;

create or replace function private.request_membership(p_request uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select membership_id from public.trail_requests where id = p_request $$;

create or replace function private.safe_uuid(p text)
returns uuid language plpgsql immutable set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end
$$;

-- Notificações (só criadas por funções protegidas).
create or replace function private.notify(
  p_profiles uuid[], p_section uuid, p_kind text, p_title text, p_body text, p_link text
) returns void language sql security definer set search_path = ''
as $$
  insert into public.notifications (profile_id, section_id, kind, title, body, link)
  select distinct pid, p_section, p_kind, p_title, p_body, p_link
  from unnest(p_profiles) as pid
  where pid is not null and pid is distinct from auth.uid()
$$;

create or replace function private.section_dirigentes(p_section uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(profile_id), '{}') from public.memberships
  where section_id = p_section and status = 'ativo' and function = 'dirigente'
$$;

create or replace function private.section_admins(p_section uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(profile_id), '{}') from public.memberships
  where section_id = p_section and status = 'ativo' and is_admin
$$;

create or replace function private.team_guias(p_team uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(profile_id), '{}') from public.memberships
  where team_id = p_team and status = 'ativo' and function = 'guia'
$$;

create or replace function private.section_guias(p_section uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(profile_id), '{}') from public.memberships
  where section_id = p_section and status = 'ativo' and function = 'guia'
$$;

create or replace function private.audit(
  p_section uuid, p_action text, p_entity text, p_entity_id text, p_details jsonb
) returns void language sql security definer set search_path = ''
as $$
  insert into public.audit_log (section_id, actor, action, entity, entity_id, details)
  values (p_section, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb))
$$;

-- Chaves de trilhos validados de um membro (equipa ou progresso anterior aprovado).
-- Um trilho só pode ter um pedido ativo, por isso nunca conta duas vezes.
create or replace function private.validated_trail_keys(p_membership uuid)
returns setof text language sql stable security definer set search_path = ''
as $$
  select distinct trail_key from public.trail_requests
  where membership_id = p_membership and status in ('validado_equipa', 'aprovado')
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------------

-- Perfil criado no registo. Só o nome é aceite dos metadados: nenhuma função
-- ou permissão pode ser escolhida no registo.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(trim(new.raw_user_meta_data ->> 'full_name'), ''), 200))
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Histórico de função/equipa/estado/admin.
create or replace function private.log_membership_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.membership_history (membership_id, section_id, changed_by, new_status, new_function, new_team_id, new_is_admin, reason)
    values (new.id, new.section_id, auth.uid(), new.status, new.function, new.team_id, new.is_admin,
            current_setting('pioneiros.reason', true));
  elsif (old.status, old.function, old.team_id, old.is_admin)
        is distinct from (new.status, new.function, new.team_id, new.is_admin) then
    insert into public.membership_history (membership_id, section_id, changed_by,
      old_status, new_status, old_function, new_function, old_team_id, new_team_id, old_is_admin, new_is_admin, reason)
    values (new.id, new.section_id, auth.uid(),
      old.status, new.status, old.function, new.function, old.team_id, new.team_id, old.is_admin, new.is_admin,
      current_setting('pioneiros.reason', true));
    new.updated_at := now();
  end if;
  return new;
end
$$;

create trigger memberships_history_ins after insert on public.memberships
  for each row execute function private.log_membership_change();
create trigger memberships_history_upd before update on public.memberships
  for each row execute function private.log_membership_change();

-- ---------------------------------------------------------------------------
-- Privilégios: leitura via RLS; escrita apenas por RPC.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.experiences to authenticated;

alter table public.groups enable row level security;
alter table public.catalog_versions enable row level security;
alter table public.sections enable row level security;
alter table public.section_settings enable row level security;
alter table public.settings_history enable row level security;
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.memberships enable row level security;
alter table public.membership_history enable row level security;
alter table public.invite_redemptions enable row level security;
alter table public.catalog_stages enable row level security;
alter table public.catalog_areas enable row level security;
alter table public.catalog_trails enable row level security;
alter table public.catalog_objectives enable row level security;
alter table public.adhesions enable row level security;
alter table public.stage_paths enable row level security;
alter table public.stage_choices enable row level security;
alter table public.trail_requests enable row level security;
alter table public.trail_request_versions enable row level security;
alter table public.attachments enable row level security;
alter table public.trail_decisions enable row level security;
alter table public.stage_requests enable row level security;
alter table public.merit_awards enable row level security;
alter table public.experiences enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;

-- Organização
create policy groups_select on public.groups for select to authenticated
  using (exists (select 1 from public.sections s join public.memberships m on m.section_id = s.id
                 where s.group_id = groups.id and m.profile_id = (select auth.uid())));

create policy sections_select on public.sections for select to authenticated
  using (exists (select 1 from public.memberships m
                 where m.section_id = sections.id and m.profile_id = (select auth.uid())));

create policy section_settings_select on public.section_settings for select to authenticated
  using (private.is_active_member(section_id));

create policy settings_history_select on public.settings_history for select to authenticated
  using (private.is_admin(section_id) or private.is_dirigente(section_id));

create policy teams_select on public.teams for select to authenticated
  using (private.is_active_member(section_id));

-- Catálogo: conteúdo pedagógico, legível por qualquer utilizador autenticado.
create policy catalog_versions_select on public.catalog_versions for select to authenticated using (true);
create policy catalog_stages_select on public.catalog_stages for select to authenticated using (true);
create policy catalog_areas_select on public.catalog_areas for select to authenticated using (true);
create policy catalog_trails_select on public.catalog_trails for select to authenticated using (true);
create policy catalog_objectives_select on public.catalog_objectives for select to authenticated using (true);

-- Pessoas
create policy profiles_select on public.profiles for select to authenticated
  using (private.can_view_profile(id));

create policy memberships_select on public.memberships for select to authenticated
  using (private.can_view_membership(id));

create policy membership_history_select on public.membership_history for select to authenticated
  using (private.is_admin(section_id));

create policy invites_select on public.invites for select to authenticated
  using (private.is_admin(section_id));

create policy invite_redemptions_select on public.invite_redemptions for select to authenticated
  using (exists (select 1 from public.invites i where i.id = invite_id and private.is_admin(i.section_id)));

-- Progresso (o administrador técnico não vê progresso, salvo se também for dirigente)
create policy adhesions_select on public.adhesions for select to authenticated
  using (private.can_view_progress(membership_id));
create policy stage_paths_select on public.stage_paths for select to authenticated
  using (private.can_view_progress(membership_id));
create policy stage_choices_select on public.stage_choices for select to authenticated
  using (private.can_view_progress(membership_id));
create policy trail_requests_select on public.trail_requests for select to authenticated
  using (private.can_view_progress(membership_id));
create policy trail_request_versions_select on public.trail_request_versions for select to authenticated
  using (private.can_view_progress(private.request_membership(request_id)));
create policy attachments_select on public.attachments for select to authenticated
  using (private.can_view_progress(private.request_membership(request_id)));
create policy trail_decisions_select on public.trail_decisions for select to authenticated
  using (private.can_view_progress(private.request_membership(request_id)));
create policy stage_requests_select on public.stage_requests for select to authenticated
  using (private.can_view_progress(membership_id));
create policy merit_awards_select on public.merit_awards for select to authenticated
  using (private.can_view_progress(membership_id));

-- Diário de vivências: apenas o próprio, e só enquanto membro ativo pioneiro/guia.
create policy experiences_owner_select on public.experiences for select to authenticated
  using (exists (select 1 from public.memberships m where m.id = membership_id
                 and m.profile_id = (select auth.uid()) and m.status = 'ativo'));
create policy experiences_owner_insert on public.experiences for insert to authenticated
  with check (exists (select 1 from public.memberships m where m.id = membership_id
                      and m.profile_id = (select auth.uid()) and m.status = 'ativo'
                      and m.function in ('pioneiro', 'guia')));
create policy experiences_owner_update on public.experiences for update to authenticated
  using (exists (select 1 from public.memberships m where m.id = membership_id
                 and m.profile_id = (select auth.uid()) and m.status = 'ativo'))
  with check (exists (select 1 from public.memberships m where m.id = membership_id
                      and m.profile_id = (select auth.uid()) and m.status = 'ativo'));
create policy experiences_owner_delete on public.experiences for delete to authenticated
  using (exists (select 1 from public.memberships m where m.id = membership_id
                 and m.profile_id = (select auth.uid()) and m.status = 'ativo'));

create policy notifications_select on public.notifications for select to authenticated
  using (profile_id = (select auth.uid()));

create policy audit_log_select on public.audit_log for select to authenticated
  using (private.is_admin(section_id));


-- ===== 20261013000300_rpc_membership.sql =====
-- Pioneiros — operações de conta, convites e gestão (RPC).
-- Todas as funções são SECURITY DEFINER e validam permissões explicitamente.

-- ---------------------------------------------------------------------------
-- Perfil
-- ---------------------------------------------------------------------------
create or replace function public.update_my_profile(p_full_name text, p_totem text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_full_name, ''))) = 0 then raise exception 'Indica o teu nome.'; end if;
  update public.profiles
     set full_name = left(trim(p_full_name), 200),
         totem = nullif(left(trim(coalesce(p_totem, '')), 120), ''),
         updated_at = now()
   where id = auth.uid();
end
$$;

-- Guarda o caminho da fotografia já carregada (pasta própria no bucket privado).
create or replace function public.set_my_photo(p_path text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if p_path is not null then
    if split_part(p_path, '/', 1) <> auth.uid()::text then
      raise exception 'Caminho de fotografia inválido.' using errcode = '42501';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'fotografias' and o.name = p_path) then
      raise exception 'A fotografia ainda não foi carregada.';
    end if;
  end if;
  update public.profiles set photo_path = p_path, updated_at = now() where id = auth.uid();
end
$$;

-- ---------------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------------
create or replace function public.create_invite(p_section uuid, p_label text, p_expires_at timestamptz, p_max_uses integer)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_code text;
begin
  if not private.is_admin(p_section) then
    raise exception 'Só administradores podem criar convites.' using errcode = '42501';
  end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'A validade tem de ser uma data futura.'; end if;
  if p_expires_at > now() + interval '180 days' then raise exception 'A validade máxima é de 180 dias.'; end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 500 then raise exception 'O limite de usos deve estar entre 1 e 500.'; end if;
  v_code := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');
  insert into public.invites (section_id, token_hash, label, expires_at, max_uses, created_by)
  values (p_section, extensions.digest(v_code, 'sha256'), left(coalesce(trim(p_label), ''), 200), p_expires_at, p_max_uses, auth.uid());
  perform private.audit(p_section, 'convite_criado', 'invite', null,
    jsonb_build_object('label', p_label, 'expires_at', p_expires_at, 'max_uses', p_max_uses));
  return v_code; -- devolvido uma única vez; só o hash fica guardado
end
$$;

create or replace function public.revoke_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_section uuid;
begin
  select section_id into v_section from public.invites where id = p_invite;
  if v_section is null or not private.is_admin(v_section) then
    raise exception 'Convite não encontrado.' using errcode = '42501';
  end if;
  update public.invites set revoked_at = now(), revoked_by = auth.uid()
   where id = p_invite and revoked_at is null;
  perform private.audit(v_section, 'convite_revogado', 'invite', p_invite::text, '{}');
end
$$;

-- Consumo atómico do convite: bloqueia a linha, valida e cria a inscrição pendente.
create or replace function public.redeem_invite(p_code text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_inv public.invites;
  v_existing public.memberships;
  v_membership uuid;
begin
  if auth.uid() is null then raise exception 'Tens de entrar na tua conta primeiro.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Perfil não encontrado.';
  end if;

  select * into v_inv from public.invites
   where token_hash = extensions.digest(trim(coalesce(p_code, '')), 'sha256')
   for update;
  if v_inv.id is null then raise exception 'Convite inválido.'; end if;
  if v_inv.revoked_at is not null then raise exception 'Este convite foi revogado.'; end if;
  if v_inv.expires_at <= now() then raise exception 'Este convite expirou.'; end if;
  if v_inv.use_count >= v_inv.max_uses then raise exception 'Este convite já atingiu o limite de usos.'; end if;

  select * into v_existing from public.memberships
   where profile_id = auth.uid() and section_id = v_inv.section_id
   for update;

  if v_existing.id is not null then
    if v_existing.status in ('pendente', 'ativo') then
      raise exception 'Já tens um pedido ou acesso nesta secção.';
    elsif v_existing.status = 'suspenso' then
      raise exception 'O teu acesso a esta secção está suspenso. Fala com a administração.';
    end if;
    -- Regresso de quem saiu: volta a pendente, sem função nem permissões.
    perform set_config('pioneiros.reason', 'Novo pedido de entrada por convite', true);
    update public.memberships
       set status = 'pendente', function = null, is_admin = false, team_id = null,
           invite_id = v_inv.id, requested_at = now(), approved_by = null, approved_at = null
     where id = v_existing.id;
    v_membership := v_existing.id;
  else
    perform set_config('pioneiros.reason', 'Pedido de entrada por convite', true);
    insert into public.memberships (profile_id, section_id, status, invite_id)
    values (auth.uid(), v_inv.section_id, 'pendente', v_inv.id)
    returning id into v_membership;
  end if;

  if exists (select 1 from public.invite_redemptions where invite_id = v_inv.id and profile_id = auth.uid()) then
    raise exception 'Já usaste este convite.';
  end if;
  insert into public.invite_redemptions (invite_id, profile_id, membership_id)
  values (v_inv.id, auth.uid(), v_membership);
  update public.invites set use_count = use_count + 1 where id = v_inv.id;

  perform private.notify(private.section_admins(v_inv.section_id), v_inv.section_id, 'pedido_entrada',
    'Novo pedido de entrada', 'Há um novo pedido de entrada na secção a aguardar confirmação.', '/gestao/membros');
  return v_membership;
end
$$;

-- ---------------------------------------------------------------------------
-- Gestão de membros (administração)
-- ---------------------------------------------------------------------------
create or replace function private.assert_team_in_section(p_team uuid, p_section uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_team is not null and not exists (
    select 1 from public.teams where id = p_team and section_id = p_section and archived_at is null
  ) then
    raise exception 'Equipa inválida para esta secção.';
  end if;
end
$$;

create or replace function private.active_admin_count(p_section uuid)
returns integer language sql stable security definer set search_path = ''
as $$ select count(*)::int from public.memberships where section_id = p_section and status = 'ativo' and is_admin $$;

create or replace function public.approve_membership(p_membership uuid, p_function public.member_function, p_team uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null or not private.is_admin(v_m.section_id) then
    raise exception 'Inscrição não encontrada.' using errcode = '42501';
  end if;
  if v_m.status <> 'pendente' then raise exception 'Esta inscrição já não está pendente.'; end if;
  if p_function is null then raise exception 'Escolhe a função do membro.'; end if;
  if p_function in ('pioneiro', 'guia') and p_team is null then raise exception 'Pioneiros e guias precisam de uma equipa.'; end if;
  perform private.assert_team_in_section(p_team, v_m.section_id);
  perform set_config('pioneiros.reason', 'Entrada confirmada pela administração', true);
  update public.memberships
     set status = 'ativo', function = p_function,
         team_id = case when p_function = 'dirigente' then null else p_team end,
         approved_by = auth.uid(), approved_at = now()
   where id = p_membership;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'entrada_confirmada',
    'Entrada confirmada', 'A tua entrada na secção foi confirmada.', '/');
end
$$;

create or replace function public.update_membership(
  p_membership uuid, p_function public.member_function, p_team uuid, p_is_admin boolean, p_reason text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null or not private.is_admin(v_m.section_id) then
    raise exception 'Inscrição não encontrada.' using errcode = '42501';
  end if;
  if v_m.status not in ('ativo', 'suspenso') then raise exception 'Só é possível alterar membros ativos ou suspensos.'; end if;
  if p_function is null and not coalesce(p_is_admin, false) then
    raise exception 'Um membro sem função pedagógica tem de ser administrador.';
  end if;
  if p_function in ('pioneiro', 'guia') and p_team is null then raise exception 'Pioneiros e guias precisam de uma equipa.'; end if;
  perform private.assert_team_in_section(p_team, v_m.section_id);
  if v_m.is_admin and not coalesce(p_is_admin, false) and v_m.status = 'ativo'
     and private.active_admin_count(v_m.section_id) <= 1 then
    raise exception 'A secção tem de manter pelo menos um administrador ativo.';
  end if;
  perform set_config('pioneiros.reason', left(coalesce(p_reason, ''), 500), true);
  update public.memberships
     set function = p_function,
         team_id = case when p_function in ('pioneiro', 'guia') then p_team else null end,
         is_admin = coalesce(p_is_admin, false)
   where id = p_membership;
  perform private.audit(v_m.section_id, 'membro_alterado', 'membership', p_membership::text,
    jsonb_build_object('function', p_function, 'team_id', p_team, 'is_admin', p_is_admin));
end
$$;

-- Suspender, reativar ou registar saída. Rejeitar pedido pendente = 'saiu'.
create or replace function public.set_membership_status(p_membership uuid, p_status public.member_status, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null or not private.is_admin(v_m.section_id) then
    raise exception 'Inscrição não encontrada.' using errcode = '42501';
  end if;
  if p_status = 'pendente' then raise exception 'Estado inválido.'; end if;
  if p_status = 'ativo' and v_m.status <> 'suspenso' then
    raise exception 'Só é possível reativar membros suspensos. Pedidos pendentes confirmam-se em «Aprovar».';
  end if;
  if v_m.is_admin and v_m.status = 'ativo' and p_status <> 'ativo'
     and private.active_admin_count(v_m.section_id) <= 1 then
    raise exception 'A secção tem de manter pelo menos um administrador ativo.';
  end if;
  if p_status in ('suspenso', 'saiu') and length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Indica o motivo.';
  end if;
  perform set_config('pioneiros.reason', left(coalesce(p_reason, ''), 500), true);
  update public.memberships set status = p_status where id = p_membership;
  perform private.audit(v_m.section_id, 'estado_membro', 'membership', p_membership::text,
    jsonb_build_object('from', v_m.status, 'to', p_status, 'reason', p_reason));
end
$$;

-- ---------------------------------------------------------------------------
-- Equipas
-- ---------------------------------------------------------------------------
create or replace function public.create_team(p_section uuid, p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not private.is_admin(p_section) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Indica o nome da equipa.'; end if;
  insert into public.teams (section_id, name) values (p_section, trim(p_name)) returning id into v_id;
  perform private.audit(p_section, 'equipa_criada', 'team', v_id::text, jsonb_build_object('name', p_name));
  return v_id;
exception when unique_violation then
  raise exception 'Já existe uma equipa com esse nome.';
end
$$;

create or replace function public.rename_team(p_team uuid, p_name text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_section uuid;
begin
  select section_id into v_section from public.teams where id = p_team;
  if v_section is null or not private.is_admin(v_section) then raise exception 'Equipa não encontrada.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Indica o nome da equipa.'; end if;
  update public.teams set name = trim(p_name) where id = p_team;
  perform private.audit(v_section, 'equipa_renomeada', 'team', p_team::text, jsonb_build_object('name', p_name));
exception when unique_violation then
  raise exception 'Já existe uma equipa com esse nome.';
end
$$;

create or replace function public.archive_team(p_team uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_section uuid;
begin
  select section_id into v_section from public.teams where id = p_team;
  if v_section is null or not private.is_admin(v_section) then raise exception 'Equipa não encontrada.' using errcode = '42501'; end if;
  if exists (select 1 from public.memberships where team_id = p_team and status in ('ativo', 'suspenso')) then
    raise exception 'Muda primeiro os membros desta equipa para outra equipa.';
  end if;
  update public.teams set archived_at = now() where id = p_team;
  perform private.audit(v_section, 'equipa_arquivada', 'team', p_team::text, '{}');
end
$$;

-- ---------------------------------------------------------------------------
-- Configuração: progresso anterior
-- ---------------------------------------------------------------------------
create or replace function public.set_historical_progress(p_section uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_old boolean;
begin
  if not private.is_admin(p_section) then raise exception 'Só administradores podem alterar esta configuração.' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'Valor inválido.'; end if;
  select historical_progress_enabled into v_old from public.section_settings where section_id = p_section for update;
  if v_old is null then
    insert into public.section_settings (section_id, historical_progress_enabled, updated_by) values (p_section, p_enabled, auth.uid());
  elsif v_old = p_enabled then
    return;
  else
    update public.section_settings set historical_progress_enabled = p_enabled, updated_by = auth.uid(), updated_at = now()
     where section_id = p_section;
  end if;
  insert into public.settings_history (section_id, setting, old_value, new_value, changed_by)
  values (p_section, 'historical_progress_enabled', to_jsonb(v_old), to_jsonb(p_enabled), auth.uid());
  perform private.audit(p_section, 'configuracao', 'section_settings', p_section::text,
    jsonb_build_object('historical_progress_enabled', p_enabled));
end
$$;

-- ---------------------------------------------------------------------------
-- Notificações
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[])
returns void language sql security definer set search_path = ''
as $$
  update public.notifications set read_at = now()
   where profile_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids))
$$;


-- ===== 20261013000400_rpc_progress.sql =====
-- Pioneiros — operações pedagógicas (RPC): adesão, etapas, escolhas, pedidos,
-- decisões, validação da etapa, mérito.

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------

-- Membro que pode ter percurso (pioneiro ou guia ativo).
create or replace function private.progress_member(p_membership uuid)
returns public.memberships language plpgsql stable security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership;
  if v_m.id is null then raise exception 'Membro não encontrado.' using errcode = '42501'; end if;
  if v_m.status <> 'ativo' or v_m.function not in ('pioneiro', 'guia') then
    raise exception 'Este membro não tem percurso de progresso ativo.';
  end if;
  return v_m;
end
$$;

create or replace function private.assert_dirigente(p_section uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_dirigente(p_section) then
    raise exception 'Esta ação está reservada aos dirigentes (Equipa de Animação).' using errcode = '42501';
  end if;
end
$$;

-- É o próprio membro (ativo, pioneiro/guia)?
create or replace function private.is_owner(p_membership uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.memberships m where m.id = p_membership
    and m.profile_id = auth.uid() and m.status = 'ativo' and m.function in ('pioneiro', 'guia'))
$$;

create or replace function private.historical_enabled(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select historical_progress_enabled from public.section_settings where section_id = p_section), true) $$;

create or replace function private.require_text(p_text text, p_message text)
returns void language plpgsql immutable set search_path = ''
as $$ begin if length(trim(coalesce(p_text, ''))) = 0 then raise exception '%', p_message; end if; end $$;

-- Trilho da versão de catálogo ativa da secção.
create or replace function private.section_trail(p_section uuid, p_trail uuid)
returns public.catalog_trails language plpgsql stable security definer set search_path = ''
as $$
declare v_t public.catalog_trails;
begin
  select t.* into v_t from public.catalog_trails t
    join public.sections s on s.catalog_version_id = t.version_id
   where s.id = p_section and t.id = p_trail;
  if v_t.id is null then raise exception 'Trilho não pertence ao catálogo desta secção.'; end if;
  return v_t;
end
$$;

-- ---------------------------------------------------------------------------
-- Adesão (Desprendimento)
-- ---------------------------------------------------------------------------
create or replace function public.record_adhesion(
  p_membership uuid, p_decided_on date, p_commitment_on date, p_notes text, p_is_historical boolean
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  v_m := private.progress_member(p_membership);
  perform private.assert_dirigente(v_m.section_id);
  if p_decided_on is null then raise exception 'Indica a data da decisão do Conselho de Guias.'; end if;
  if p_decided_on > current_date or p_commitment_on > current_date then raise exception 'As datas não podem ser futuras.'; end if;
  insert into public.adhesions (membership_id, decided_on, commitment_on, notes, is_historical, recorded_by)
  values (p_membership, p_decided_on, p_commitment_on, nullif(trim(p_notes), ''), coalesce(p_is_historical, false), auth.uid())
  on conflict (membership_id) do update
    set decided_on = excluded.decided_on, commitment_on = excluded.commitment_on, notes = excluded.notes,
        is_historical = excluded.is_historical, recorded_by = excluded.recorded_by, recorded_at = now();
  perform private.audit(v_m.section_id, 'adesao_registada', 'adhesion', p_membership::text,
    jsonb_build_object('decided_on', p_decided_on, 'commitment_on', p_commitment_on, 'historical', p_is_historical));
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'adesao', 'Adesão registada',
    'A tua adesão (Desprendimento) foi registada.', '/progresso');
end
$$;

-- ---------------------------------------------------------------------------
-- Etapas
-- ---------------------------------------------------------------------------
create or replace function public.open_stage(p_membership uuid, p_stage_key text, p_insignia_on date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_m public.memberships;
  v_stage public.catalog_stages;
  v_id uuid;
begin
  v_m := private.progress_member(p_membership);
  perform private.assert_dirigente(v_m.section_id);
  select cs.* into v_stage from public.catalog_stages cs
    join public.sections s on s.catalog_version_id = cs.version_id
   where s.id = v_m.section_id and cs.key = p_stage_key and cs.kind = 'progresso';
  if v_stage.id is null then raise exception 'Etapa inválida.'; end if;
  -- Regra local L2: adesão registada e etapa anterior concluída.
  if not exists (select 1 from public.adhesions where membership_id = p_membership) then
    raise exception 'Regista primeiro a adesão (Desprendimento).';
  end if;
  if v_stage.ordinal > 1 and not exists (
    select 1 from public.stage_paths where membership_id = p_membership
       and stage_ordinal = v_stage.ordinal - 1 and status = 'concluida'
  ) then
    raise exception 'A etapa anterior ainda não está concluída.';
  end if;
  if p_insignia_on > current_date then raise exception 'A data da insígnia não pode ser futura.'; end if;
  insert into public.stage_paths (membership_id, stage_id, stage_key, stage_ordinal, opened_by, insignia_delivered_on, insignia_recorded_by)
  values (p_membership, v_stage.id, v_stage.key, v_stage.ordinal, auth.uid(), p_insignia_on,
          case when p_insignia_on is not null then auth.uid() end)
  returning id into v_id;
  perform private.audit(v_m.section_id, 'etapa_aberta', 'stage_path', v_id::text, jsonb_build_object('stage', p_stage_key));
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'etapa_aberta', 'Nova etapa',
    'Começou a etapa ' || v_stage.name || '. Escolhe e negoceia um trilho de cada área.', '/progresso');
  return v_id;
exception when unique_violation then
  raise exception 'Esta etapa já foi aberta ou existe outra etapa em curso.';
end
$$;

-- Entrega da insígnia (no início da etapa; nunca automática no fim).
create or replace function public.record_insignia(p_stage_path uuid, p_date date)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_p public.stage_paths; v_section uuid;
begin
  select * into v_p from public.stage_paths where id = p_stage_path for update;
  select section_id into v_section from public.memberships where id = v_p.membership_id;
  if v_p.id is null then raise exception 'Etapa não encontrada.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_section);
  if p_date is null or p_date > current_date then raise exception 'Indica uma data válida.'; end if;
  update public.stage_paths set insignia_delivered_on = p_date, insignia_recorded_by = auth.uid() where id = p_stage_path;
end
$$;

-- Reconhecimento público (celebração), separado da conclusão.
create or replace function public.record_recognition(p_stage_path uuid, p_date date, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_p public.stage_paths; v_section uuid;
begin
  select * into v_p from public.stage_paths where id = p_stage_path for update;
  select section_id into v_section from public.memberships where id = v_p.membership_id;
  if v_p.id is null then raise exception 'Etapa não encontrada.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_section);
  if v_p.status <> 'concluida' then raise exception 'Só etapas concluídas podem ser reconhecidas.'; end if;
  if p_date is null or p_date > current_date then raise exception 'Indica uma data válida.'; end if;
  update public.stage_paths set recognized_on = p_date, recognition_note = nullif(trim(p_note), ''), recognized_by = auth.uid()
   where id = p_stage_path;
end
$$;

-- ---------------------------------------------------------------------------
-- Escolhas negociadas
-- ---------------------------------------------------------------------------
create or replace function public.propose_choice(p_stage_path uuid, p_trail uuid, p_planned text, p_replaces uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.stage_paths;
  v_m public.memberships;
  v_t public.catalog_trails;
  v_area text;
  v_old public.stage_choices;
  v_id uuid;
begin
  select * into v_p from public.stage_paths where id = p_stage_path for update;
  if v_p.id is null then raise exception 'Etapa não encontrada.' using errcode = '42501'; end if;
  v_m := private.progress_member(v_p.membership_id);
  if not (private.is_owner(v_m.id) or private.is_dirigente(v_m.section_id)) then
    raise exception 'Sem permissão para propor escolhas neste percurso.' using errcode = '42501';
  end if;
  if v_p.status <> 'em_curso' then raise exception 'A etapa já está concluída.'; end if;
  if exists (select 1 from public.stage_requests where stage_path_id = v_p.id and status in ('submetido', 'decidido_conselho')) then
    raise exception 'A etapa está em validação; não é possível alterar escolhas agora.';
  end if;
  select t.* into v_t from public.catalog_trails t join public.catalog_stages cs on cs.version_id = t.version_id
   where t.id = p_trail and cs.id = v_p.stage_id;
  if v_t.id is null then raise exception 'Trilho inválido para esta etapa.'; end if;
  select code into v_area from public.catalog_areas where id = v_t.area_id;

  if p_replaces is not null then
    select * into v_old from public.stage_choices where id = p_replaces and stage_path_id = v_p.id;
    if v_old.id is null or v_old.status <> 'confirmada' then raise exception 'A escolha a substituir não está confirmada nesta etapa.'; end if;
    if v_old.area_code <> v_area then raise exception 'A troca tem de ser por um trilho da mesma área.'; end if;
  elsif exists (select 1 from public.stage_choices where stage_path_id = v_p.id and area_code = v_area and status = 'confirmada') then
    raise exception 'Já existe um trilho confirmado nesta área. Propõe uma troca.';
  end if;

  if exists (
    select 1 from public.stage_choices c join public.stage_paths sp on sp.id = c.stage_path_id
     where c.membership_id = v_m.id and c.trail_key = v_t.key and c.status = 'confirmada' and sp.id <> v_p.id
  ) then
    raise exception 'Este trilho já está atribuído a outra etapa.';
  end if;

  insert into public.stage_choices (stage_path_id, membership_id, trail_id, trail_key, area_code, planned_opportunities, replaces_choice_id, proposed_by)
  values (v_p.id, v_m.id, v_t.id, v_t.key, v_area, nullif(trim(p_planned), ''), p_replaces, auth.uid())
  returning id into v_id;

  if private.is_owner(v_m.id) then
    perform private.notify(private.section_dirigentes(v_m.section_id), v_m.section_id, 'escolha_proposta',
      'Proposta de trilho', 'Há uma proposta de escolha de trilho para negociar.', '/dirigentes/negociacao');
  else
    perform private.notify(array[v_m.profile_id], v_m.section_id, 'escolha_proposta',
      'Proposta de trilho', 'A Equipa de Animação propôs um trilho para a tua etapa.', '/progresso');
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Este trilho já está escolhido ou proposto, ou já existe uma proposta pendente nesta área.';
end
$$;

create or replace function public.decide_choice(p_choice uuid, p_accept boolean, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_c public.stage_choices; v_m public.memberships; v_p public.stage_paths;
begin
  select * into v_c from public.stage_choices where id = p_choice for update;
  if v_c.id is null then raise exception 'Escolha não encontrada.' using errcode = '42501'; end if;
  select * into v_m from public.memberships where id = v_c.membership_id;
  perform private.assert_dirigente(v_m.section_id);
  select * into v_p from public.stage_paths where id = v_c.stage_path_id for update;
  if v_c.status <> 'proposta' then raise exception 'Esta proposta já foi decidida.'; end if;
  if v_p.status <> 'em_curso' then raise exception 'A etapa já está concluída.'; end if;
  if not p_accept then
    perform private.require_text(p_comment, 'Indica o motivo para não aceitar a proposta.');
    update public.stage_choices set status = 'recusada', decided_by = auth.uid(), decided_at = now(), decision_comment = trim(p_comment)
     where id = p_choice;
  else
    if v_c.replaces_choice_id is not null then
      update public.stage_choices set status = 'substituida', decided_by = auth.uid(), decided_at = now()
       where id = v_c.replaces_choice_id and status = 'confirmada';
      if not found then raise exception 'A escolha a substituir já não está confirmada.'; end if;
    end if;
    update public.stage_choices set status = 'confirmada', decided_by = auth.uid(), decided_at = now(),
           decision_comment = nullif(trim(p_comment), '')
     where id = p_choice;
  end if;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'escolha_decidida',
    case when p_accept then 'Trilho confirmado' else 'Proposta de trilho não aceite' end,
    coalesce(nullif(trim(p_comment), ''), 'A Equipa de Animação decidiu a tua proposta.'), '/progresso');
exception when unique_violation then
  raise exception 'Já existe um trilho confirmado nesta área ou este trilho está noutra etapa.';
end
$$;

create or replace function public.withdraw_choice(p_choice uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_c public.stage_choices;
begin
  select * into v_c from public.stage_choices where id = p_choice for update;
  if v_c.id is null or not private.is_owner(v_c.membership_id) and not private.is_dirigente(
       (select section_id from public.memberships where id = v_c.membership_id)) then
    raise exception 'Escolha não encontrada.' using errcode = '42501';
  end if;
  if v_c.status <> 'proposta' then raise exception 'Só propostas pendentes podem ser retiradas.'; end if;
  update public.stage_choices set status = 'retirada', decided_by = auth.uid(), decided_at = now() where id = p_choice;
end
$$;

create or replace function public.update_choice_plan(p_choice uuid, p_planned text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_c public.stage_choices;
begin
  select * into v_c from public.stage_choices where id = p_choice for update;
  if v_c.id is null or not private.is_owner(v_c.membership_id) then
    raise exception 'Escolha não encontrada.' using errcode = '42501';
  end if;
  if v_c.status not in ('proposta', 'confirmada') then raise exception 'Esta escolha já não está ativa.'; end if;
  update public.stage_choices set planned_opportunities = nullif(trim(p_planned), '') where id = p_choice;
end
$$;

-- ---------------------------------------------------------------------------
-- Pedidos de validação de trilho
-- ---------------------------------------------------------------------------
create or replace function public.create_trail_request(p_membership uuid, p_trail uuid, p_kind public.request_kind)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships; v_t public.catalog_trails; v_id uuid;
begin
  v_m := private.progress_member(p_membership);
  if not private.is_owner(v_m.id) then raise exception 'Só o próprio pode criar pedidos.' using errcode = '42501'; end if;
  v_t := private.section_trail(v_m.section_id, p_trail);
  if p_kind = 'historico' and not private.historical_enabled(v_m.section_id) then
    raise exception 'O registo de progresso anterior está desativado nesta secção.';
  end if;
  insert into public.trail_requests (membership_id, section_id, trail_id, trail_key, kind, created_by)
  values (v_m.id, v_m.section_id, v_t.id, v_t.key, p_kind, auth.uid())
  returning id into v_id;
  insert into public.trail_request_versions (request_id, version_no) values (v_id, 1);
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um pedido ativo ou uma validação para este trilho.';
end
$$;

create or replace function private.lock_owned_request(p_request uuid)
returns public.trail_requests language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null or not private.is_owner(v_r.membership_id) then
    raise exception 'Pedido não encontrado.' using errcode = '42501';
  end if;
  return v_r;
end
$$;

create or replace function public.save_request_draft(
  p_request uuid, p_reflection text, p_experiences text, p_period_start date, p_period_end date, p_approximate_date text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status <> 'rascunho' then
    raise exception 'O pedido já foi submetido. Para alterar o conteúdo, retira-o ou cria uma nova versão.';
  end if;
  update public.trail_request_versions
     set reflection = left(coalesce(p_reflection, ''), 10000),
         experiences = left(coalesce(p_experiences, ''), 10000),
         period_start = p_period_start, period_end = p_period_end,
         approximate_date = nullif(left(trim(coalesce(p_approximate_date, '')), 100), ''),
         updated_at = now()
   where request_id = p_request and version_no = v_r.current_version and submitted_at is null;
  update public.trail_requests set updated_at = now() where id = p_request;
end
$$;

create or replace function public.submit_trail_request(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_v public.trail_request_versions; v_m public.memberships; v_trail text;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status <> 'rascunho' then raise exception 'Este pedido não está em rascunho.'; end if;
  -- O servidor impede novas submissões históricas com a opção desligada,
  -- mesmo que o formulário estivesse aberto ou a chamada seja direta à API.
  if v_r.kind = 'historico' and not private.historical_enabled(v_r.section_id) then
    raise exception 'O registo de progresso anterior foi desativado. Podes cancelar este pedido e usar o progresso normal, ou aguardar a reativação.';
  end if;
  select * into v_v from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  if length(trim(v_v.reflection)) = 0 then raise exception 'Escreve a tua reflexão antes de submeter.'; end if;
  if v_v.period_end > current_date + 1 then raise exception 'As datas das vivências não podem ser futuras.'; end if;
  update public.trail_request_versions set submitted_at = now() where id = v_v.id;
  update public.trail_requests set status = 'submetido', updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  if v_r.kind = 'normal' then
    perform private.notify(private.team_guias(v_m.team_id) || case when v_m.function = 'guia'
             then private.section_dirigentes(v_m.section_id) else '{}'::uuid[] end,
      v_m.section_id, 'pedido_submetido', 'Novo pedido de validação',
      'Pedido de validação do trilho ' || v_trail || ' para a próxima reunião de Equipa.', '/revisoes/pedido/' || p_request);
  else
    perform private.notify(private.section_dirigentes(v_m.section_id), v_m.section_id, 'pedido_historico',
      'Progresso anterior', 'Novo pedido de progresso anterior: ' || v_trail || '.', '/revisoes/pedido/' || p_request);
  end if;
end
$$;

-- Retirar um pedido submetido (ainda sem decisão) para voltar a editar: a
-- versão submetida fica no histórico e cria-se nova versão em rascunho.
create or replace function private.new_draft_version(p_request uuid, p_from integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_new uuid; v_old uuid;
begin
  select id into v_old from public.trail_request_versions where request_id = p_request and version_no = p_from;
  insert into public.trail_request_versions (request_id, version_no, reflection, experiences, period_start, period_end, approximate_date)
  select request_id, p_from + 1, reflection, experiences, period_start, period_end, approximate_date
    from public.trail_request_versions where id = v_old
  returning id into v_new;
  insert into public.attachments (request_id, version_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  select request_id, v_new, storage_path, file_name, mime_type, size_bytes, uploaded_by
    from public.attachments where version_id = v_old;
  update public.trail_requests set current_version = p_from + 1, status = 'rascunho', updated_at = now() where id = p_request;
end
$$;

create or replace function public.withdraw_trail_request(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status not in ('submetido', 'em_revisao') then raise exception 'Só pedidos submetidos e ainda sem decisão podem ser retirados.'; end if;
  update public.trail_request_versions set withdrawn_at = now()
   where request_id = p_request and version_no = v_r.current_version;
  perform private.new_draft_version(p_request, v_r.current_version);
end
$$;

-- Depois de uma devolução, preparar nova versão (mantém histórico e comentários).
create or replace function public.start_new_version(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status <> 'devolvido' then raise exception 'Só pedidos devolvidos podem ter nova versão.'; end if;
  perform private.new_draft_version(p_request, v_r.current_version);
end
$$;

create or replace function public.cancel_trail_request(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status not in ('rascunho', 'submetido', 'em_revisao', 'devolvido') then
    raise exception 'Este pedido já foi decidido e não pode ser cancelado.';
  end if;
  update public.trail_requests set status = 'cancelado', updated_at = now() where id = p_request;
end
$$;

-- Anexos: o ficheiro é carregado para o bucket privado «anexos» em
-- <request_id>/<nome>; esta função regista-o na versão em rascunho.
create or replace function public.add_attachment(p_request uuid, p_path text, p_file_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_obj record; v_version uuid; v_id uuid;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status <> 'rascunho' then raise exception 'Só é possível juntar anexos a pedidos em rascunho.'; end if;
  if split_part(p_path, '/', 1) <> p_request::text then raise exception 'Caminho de anexo inválido.'; end if;
  select o.name, o.owner_id, o.metadata into v_obj from storage.objects o where o.bucket_id = 'anexos' and o.name = p_path;
  if v_obj.name is null then raise exception 'O ficheiro ainda não foi carregado.'; end if;
  if v_obj.owner_id is distinct from auth.uid()::text then raise exception 'Ficheiro inválido.' using errcode = '42501'; end if;
  if (select count(*) from public.attachments a join public.trail_request_versions v on v.id = a.version_id
       where a.request_id = p_request and v.version_no = v_r.current_version) >= 10 then
    raise exception 'Máximo de 10 anexos por pedido.';
  end if;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.attachments (request_id, version_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (p_request, v_version, p_path, left(coalesce(nullif(trim(p_file_name), ''), 'anexo'), 200),
          coalesce(v_obj.metadata ->> 'mimetype', 'application/octet-stream'),
          greatest(coalesce((v_obj.metadata ->> 'size')::int, 1), 1), auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.remove_attachment(p_attachment uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_a public.attachments; v_r public.trail_requests; v_v public.trail_request_versions;
begin
  select * into v_a from public.attachments where id = p_attachment;
  if v_a.id is null then raise exception 'Anexo não encontrado.' using errcode = '42501'; end if;
  v_r := private.lock_owned_request(v_a.request_id);
  select * into v_v from public.trail_request_versions where id = v_a.version_id;
  if v_r.status <> 'rascunho' or v_v.submitted_at is not null then
    raise exception 'Só é possível remover anexos de um rascunho.';
  end if;
  delete from public.attachments where id = p_attachment;
end
$$;

-- ---------------------------------------------------------------------------
-- Decisões sobre pedidos
-- ---------------------------------------------------------------------------

-- Quem pode registar a decisão da reunião de Equipa: o guia ATUAL da equipa do
-- membro (nunca sobre o próprio pedido) ou um dirigente (regra local L1).
create or replace function private.team_recorder_role(v_r public.trail_requests)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v_m public.memberships; v_me public.memberships;
begin
  select * into v_m from public.memberships where id = v_r.membership_id;
  v_me := private.my_active_membership(v_m.section_id);
  if v_me.id is null then return null; end if;
  if v_me.id = v_m.id then return null; end if; -- ninguém decide o próprio pedido
  if v_me.function = 'dirigente' then return 'dirigente'; end if;
  if v_me.function = 'guia' and v_me.team_id = v_m.team_id and v_m.status = 'ativo' then return 'guia'; end if;
  return null;
end
$$;

create or replace function public.mark_request_in_review(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_role text; v_version uuid;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  if v_r.kind = 'normal' then v_role := private.team_recorder_role(v_r);
  elsif private.is_dirigente(v_r.section_id) and not private.is_owner(v_r.membership_id) then v_role := 'dirigente';
  end if;
  if v_role is null then raise exception 'Sem permissão para analisar este pedido.' using errcode = '42501'; end if;
  if v_r.status <> 'submetido' then raise exception 'O pedido não está à espera de análise.'; end if;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  update public.trail_requests set status = 'em_revisao', updated_at = now() where id = p_request;
  insert into public.trail_decisions (request_id, version_id, kind, recorded_by, recorded_as)
  values (p_request, v_version, 'em_revisao', auth.uid(), v_role);
end
$$;

-- Registo da decisão tomada na reunião de Equipa.
create or replace function public.record_team_decision(
  p_request uuid, p_expected_version integer, p_validated boolean, p_meeting_date date, p_comment text
) returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.trail_requests; v_role text; v_version uuid; v_m public.memberships; v_trail text;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  if v_r.kind <> 'normal' then raise exception 'Pedidos de progresso anterior são decididos pelos dirigentes.'; end if;
  v_role := private.team_recorder_role(v_r);
  if v_role is null then
    raise exception 'Sem permissão para registar a decisão deste pedido (não é possível decidir o próprio pedido).' using errcode = '42501';
  end if;
  if v_r.status not in ('submetido', 'em_revisao') then
    raise exception 'Este pedido já foi decidido ou não está submetido.';
  end if;
  if p_expected_version is distinct from v_r.current_version then
    raise exception 'O pedido mudou entretanto. Atualiza a página.';
  end if;
  if p_meeting_date is null or p_meeting_date > current_date then raise exception 'Indica a data da reunião de Equipa.'; end if;
  if not p_validated then perform private.require_text(p_comment, 'Explica o que falta trabalhar.'); end if;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, recorded_by, recorded_as)
  values (p_request, v_version, case when p_validated then 'validado_equipa' else 'devolvido_equipa' end::public.decision_kind,
          p_meeting_date, nullif(trim(p_comment), ''), auth.uid(), v_role);
  update public.trail_requests set status = case when p_validated then 'validado_equipa' else 'devolvido' end::public.request_status,
         updated_at = now()
   where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'decisao_equipa',
    case when p_validated then 'Trilho validado na Equipa' else 'Pedido devolvido para continuar a trabalhar' end,
    v_trail || coalesce(': ' || nullif(trim(p_comment), ''), ''), '/pedidos/' || p_request);
  -- Comunicação ao Conselho de Guias.
  perform private.notify(private.section_dirigentes(v_m.section_id) || private.section_guias(v_m.section_id), v_m.section_id,
    'comunicacao_conselho', 'Comunicação ao Conselho de Guias',
    'Decisão da reunião de Equipa sobre o trilho ' || v_trail || '.', '/conselho');
exception when unique_violation then
  raise exception 'Já foi registada uma decisão para esta versão do pedido.';
end
$$;

-- Devolução fundamentada após comunicação ao Conselho de Guias (validação manifestamente incoerente).
create or replace function public.record_council_return(p_request uuid, p_meeting_date date, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_m public.memberships; v_version uuid;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_r.section_id);
  if private.is_owner(v_r.membership_id) then raise exception 'Não é possível decidir o próprio pedido.' using errcode = '42501'; end if;
  if v_r.status <> 'validado_equipa' then raise exception 'Só trilhos validados na Equipa podem ser devolvidos pelo Conselho de Guias.'; end if;
  perform private.require_text(p_comment, 'A devolução tem de ser fundamentada.');
  if p_meeting_date is null or p_meeting_date > current_date then raise exception 'Indica a data do Conselho de Guias.'; end if;
  -- Regra local L3: não reabrir trilhos de etapas concluídas.
  if exists (select 1 from public.stage_choices c join public.stage_paths p on p.id = c.stage_path_id
              where c.membership_id = v_r.membership_id and c.trail_key = v_r.trail_key
                and c.status = 'confirmada' and p.status = 'concluida') then
    raise exception 'Este trilho faz parte de uma etapa já concluída.';
  end if;
  if exists (select 1 from public.stage_choices c join public.stage_requests sr on sr.stage_path_id = c.stage_path_id
              where c.membership_id = v_r.membership_id and c.trail_key = v_r.trail_key and c.status = 'confirmada'
                and sr.status in ('submetido', 'decidido_conselho')) then
    raise exception 'A etapa deste trilho está em validação. Regista a decisão da etapa primeiro.';
  end if;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, recorded_by, recorded_as)
  values (p_request, v_version, 'devolvido_conselho', p_meeting_date, trim(p_comment), auth.uid(), 'dirigente');
  update public.trail_requests set status = 'devolvido', updated_at = now() where id = p_request;
  select * into v_m from public.memberships where id = v_r.membership_id;
  perform private.notify(array[v_m.profile_id] || private.team_guias(v_m.team_id), v_m.section_id, 'devolucao_conselho',
    'Trilho devolvido pelo Conselho de Guias', trim(p_comment), '/pedidos/' || p_request);
end
$$;

-- Nota de revisão da Equipa de Animação (não altera o estado nem é obrigatória).
create or replace function public.record_animation_review(p_request uuid, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_version uuid; v_m public.memberships;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_r.section_id);
  if v_r.status in ('rascunho', 'cancelado') then raise exception 'O pedido ainda não foi submetido.'; end if;
  perform private.require_text(p_comment, 'Escreve a nota de revisão.');
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, comment, recorded_by, recorded_as)
  values (p_request, v_version, 'revisao_animacao', trim(p_comment), auth.uid(), 'dirigente');
  select * into v_m from public.memberships where id = v_r.membership_id;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'revisao_animacao',
    'Nota da Equipa de Animação', trim(p_comment), '/pedidos/' || p_request);
end
$$;

-- Decisão de dirigente sobre progresso anterior. Continua possível mesmo com a
-- opção desligada (pedidos já submetidos continuam avaliáveis).
create or replace function public.decide_historical_request(
  p_request uuid, p_expected_version integer, p_outcome text, p_comment text, p_reference_date date
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_version uuid; v_m public.memberships; v_trail text;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_r.section_id);
  if private.is_owner(v_r.membership_id) then raise exception 'Não é possível decidir o próprio pedido.' using errcode = '42501'; end if;
  if v_r.kind <> 'historico' then raise exception 'Este pedido não é de progresso anterior.'; end if;
  if v_r.status not in ('submetido', 'em_revisao') then raise exception 'Este pedido já foi decidido ou não está submetido.'; end if;
  if p_expected_version is distinct from v_r.current_version then raise exception 'O pedido mudou entretanto. Atualiza a página.'; end if;
  if p_outcome not in ('aprovado', 'recusado', 'devolvido') then raise exception 'Decisão inválida.'; end if;
  if p_outcome in ('recusado', 'devolvido') then perform private.require_text(p_comment, 'Indica o motivo da decisão.'); end if;
  if p_reference_date > current_date then raise exception 'A data de referência não pode ser futura.'; end if;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, comment, reference_date, recorded_by, recorded_as)
  values (p_request, v_version, (p_outcome || '_historico')::public.decision_kind, nullif(trim(p_comment), ''),
          case when p_outcome = 'aprovado' then p_reference_date end, auth.uid(), 'dirigente');
  update public.trail_requests
     set status = p_outcome::public.request_status,
         approved_reference_date = case when p_outcome = 'aprovado' then p_reference_date end,
         updated_at = now()
   where id = p_request;
  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'decisao_historico',
    case p_outcome when 'aprovado' then 'Progresso anterior reconhecido'
                   when 'recusado' then 'Progresso anterior não reconhecido'
                   else 'Progresso anterior devolvido para correção' end,
    v_trail || coalesce(': ' || nullif(trim(p_comment), ''), ''), '/pedidos/' || p_request);
exception when unique_violation then
  raise exception 'Já foi registada uma decisão para esta versão do pedido.';
end
$$;

-- ---------------------------------------------------------------------------
-- Validação da etapa
-- ---------------------------------------------------------------------------

-- Trilhos confirmados da etapa e se estão validados.
create or replace function private.stage_ready(p_stage_path uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select count(*) = (select count(*) from public.catalog_areas a join public.catalog_stages cs on cs.version_id = a.version_id
                      join public.stage_paths sp on sp.stage_id = cs.id where sp.id = p_stage_path)
     and bool_and(c.trail_key in (select private.validated_trail_keys(c.membership_id)))
  from public.stage_choices c
  where c.stage_path_id = p_stage_path and c.status = 'confirmada'
$$;

create or replace function public.request_stage_validation(p_stage_path uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_p public.stage_paths; v_m public.memberships; v_me public.memberships; v_id uuid;
begin
  select * into v_p from public.stage_paths where id = p_stage_path for update;
  if v_p.id is null then raise exception 'Etapa não encontrada.' using errcode = '42501'; end if;
  v_m := private.progress_member(v_p.membership_id);
  v_me := private.my_active_membership(v_m.section_id);
  if not (v_me.id = v_m.id or v_me.function = 'dirigente'
          or (v_me.function = 'guia' and v_me.team_id = v_m.team_id)) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if v_p.status <> 'em_curso' then raise exception 'A etapa já está concluída.'; end if;
  if not coalesce(private.stage_ready(p_stage_path), false) then
    raise exception 'Faltam trilhos confirmados e validados (um de cada área) para pedir a validação da etapa.';
  end if;
  insert into public.stage_requests (stage_path_id, membership_id, requested_by)
  values (p_stage_path, v_m.id, auth.uid()) returning id into v_id;
  perform private.notify(private.section_dirigentes(v_m.section_id) || private.section_guias(v_m.section_id), v_m.section_id,
    'pedido_etapa', 'Validação de etapa', 'Há uma etapa pronta para o Conselho de Guias.', '/conselho');
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um pedido de validação desta etapa em curso.';
end
$$;

create or replace function public.record_council_stage_decision(
  p_stage_request uuid, p_decision public.council_decision, p_date date, p_comment text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_s public.stage_requests; v_m public.memberships;
begin
  select * into v_s from public.stage_requests where id = p_stage_request for update;
  if v_s.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  select * into v_m from public.memberships where id = v_s.membership_id;
  perform private.assert_dirigente(v_m.section_id);
  if v_s.status <> 'submetido' then raise exception 'A decisão do Conselho de Guias já foi registada.'; end if;
  if p_date is null or p_date > current_date then raise exception 'Indica a data do Conselho de Guias.'; end if;
  if p_decision = 'desfavoravel' then perform private.require_text(p_comment, 'Fundamenta a decisão do Conselho de Guias.'); end if;
  update public.stage_requests
     set status = 'decidido_conselho', council_decision = p_decision, council_date = p_date,
         council_comment = nullif(trim(p_comment), ''), council_recorded_by = auth.uid(), council_recorded_at = now()
   where id = p_stage_request;
end
$$;

-- Opinião final da Equipa de Animação: só após esta confirmação a etapa fica concluída.
create or replace function public.record_final_opinion(
  p_stage_request uuid, p_opinion public.final_opinion, p_date date, p_comment text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_s public.stage_requests; v_m public.memberships; v_stage text;
begin
  select * into v_s from public.stage_requests where id = p_stage_request for update;
  if v_s.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  select * into v_m from public.memberships where id = v_s.membership_id;
  perform private.assert_dirigente(v_m.section_id);
  if v_s.status <> 'decidido_conselho' then raise exception 'Regista primeiro a decisão do Conselho de Guias.'; end if;
  if p_date is null or p_date > current_date then raise exception 'Indica a data.'; end if;
  if (p_opinion = 'confirmada' and v_s.council_decision = 'desfavoravel')
     or (p_opinion = 'nao_confirmada' and v_s.council_decision = 'favoravel') then
    perform private.require_text(p_comment, 'A opinião diverge do Conselho de Guias: a fundamentação é obrigatória.');
  end if;
  if p_opinion = 'nao_confirmada' then perform private.require_text(p_comment, 'Fundamenta a opinião.'); end if;
  perform 1 from public.stage_paths where id = v_s.stage_path_id for update;
  if p_opinion = 'confirmada' and not coalesce(private.stage_ready(v_s.stage_path_id), false) then
    raise exception 'Os trilhos da etapa já não estão todos validados.';
  end if;
  update public.stage_requests
     set status = p_opinion::text::public.stage_request_status, final_opinion = p_opinion, final_date = p_date,
         final_comment = nullif(trim(p_comment), ''), final_recorded_by = auth.uid(), final_recorded_at = now()
   where id = p_stage_request;
  if p_opinion = 'confirmada' then
    update public.stage_paths set status = 'concluida', completed_on = p_date, completion_kind = 'normal'
     where id = v_s.stage_path_id;
  end if;
  select cs.name into v_stage from public.stage_paths sp join public.catalog_stages cs on cs.id = sp.stage_id where sp.id = v_s.stage_path_id;
  perform private.notify(array[v_m.profile_id] || private.team_guias(v_m.team_id), v_m.section_id, 'etapa_decidida',
    case when p_opinion = 'confirmada' then 'Etapa ' || v_stage || ' concluída' else 'Etapa ' || v_stage || ' ainda não concluída' end,
    nullif(trim(p_comment), ''), '/progresso');
end
$$;

-- Declaração de etapa anterior (decisão própria do dirigente, com fundamentação).
create or replace function public.declare_historical_stage(p_stage_path uuid, p_date date, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_p public.stage_paths; v_m public.memberships;
begin
  select * into v_p from public.stage_paths where id = p_stage_path for update;
  if v_p.id is null then raise exception 'Etapa não encontrada.' using errcode = '42501'; end if;
  select * into v_m from public.memberships where id = v_p.membership_id;
  perform private.assert_dirigente(v_m.section_id);
  if v_p.status <> 'em_curso' then raise exception 'A etapa já está concluída.'; end if;
  perform private.require_text(p_comment, 'Fundamenta a declaração da etapa anterior.');
  if p_date is null or p_date > current_date then raise exception 'Indica uma data válida.'; end if;
  if not coalesce(private.stage_ready(p_stage_path), false) then
    raise exception 'Atribui primeiro a esta etapa um trilho validado de cada área.';
  end if;
  if exists (select 1 from public.stage_requests where stage_path_id = p_stage_path and status in ('submetido', 'decidido_conselho')) then
    raise exception 'Existe um pedido de validação desta etapa em curso.';
  end if;
  insert into public.stage_requests (stage_path_id, membership_id, kind, status, requested_by, final_opinion, final_date,
                                     final_comment, final_recorded_by, final_recorded_at)
  values (p_stage_path, v_m.id, 'historico', 'confirmada', auth.uid(), 'confirmada', p_date, trim(p_comment), auth.uid(), now());
  update public.stage_paths set status = 'concluida', completed_on = p_date, completion_kind = 'historico' where id = p_stage_path;
end
$$;

-- ---------------------------------------------------------------------------
-- Anilha de mérito
-- ---------------------------------------------------------------------------
create or replace function private.merit_status(p_membership uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with m as (select * from public.memberships where id = p_membership),
  total as (
    select count(*)::int n from public.catalog_trails t join public.sections s on s.catalog_version_id = t.version_id
     join m on m.section_id = s.id
  ),
  validated as (
    select count(*)::int n from (select private.validated_trail_keys(p_membership) k) v
     where v.k in (select t.key from public.catalog_trails t join public.sections s on s.catalog_version_id = t.version_id
                    join m on m.section_id = s.id)
  ),
  last_stage as (
    select exists (
      select 1 from public.stage_paths sp
       where sp.membership_id = p_membership and sp.status = 'concluida'
         and sp.stage_ordinal = (select max(cs.ordinal) from public.catalog_stages cs
                                   join public.sections s on s.catalog_version_id = cs.version_id
                                   join m on m.section_id = s.id where cs.kind = 'progresso')
    ) done
  )
  select jsonb_build_object(
    'validated', validated.n, 'total', total.n, 'last_stage_concluded', last_stage.done,
    'eligible', validated.n = total.n and total.n > 0 and last_stage.done)
  from total, validated, last_stage
$$;

create or replace function public.merit_eligibility(p_membership uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_view_progress(p_membership) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  return private.merit_status(p_membership);
end
$$;

create or replace function public.award_merit(p_membership uuid, p_awarded_on date, p_historical boolean, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships; v_status jsonb;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null then raise exception 'Membro não encontrado.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_m.section_id);
  if v_m.function not in ('pioneiro', 'guia') then raise exception 'Só pioneiros e guias recebem a anilha de mérito.'; end if;
  if p_awarded_on is null or p_awarded_on > current_date then raise exception 'Indica a data de atribuição.'; end if;
  v_status := private.merit_status(p_membership);
  if not (v_status ->> 'eligible')::boolean then
    if not coalesce(p_historical, false) then
      raise exception 'Ainda não cumpre os critérios: todos os trilhos da secção validados e a última etapa concluída.';
    end if;
    perform private.require_text(p_comment, 'Uma declaração de mérito anterior exige fundamentação.');
  end if;
  insert into public.merit_awards (membership_id, awarded_on, kind, comment, recorded_by)
  values (p_membership, p_awarded_on,
          case when (v_status ->> 'eligible')::boolean then 'normal' else 'historico' end,
          nullif(trim(p_comment), ''), auth.uid());
  perform private.audit(v_m.section_id, 'anilha_merito', 'membership', p_membership::text, v_status);
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'merito', 'Anilha de mérito',
    'Foi registada a atribuição da tua anilha de mérito.', '/progresso');
exception when unique_violation then
  raise exception 'A anilha de mérito já foi registada para este membro.';
end
$$;

-- ---------------------------------------------------------------------------
-- Exportação (dirigentes): dados pedagógicos da secção em JSON.
-- ---------------------------------------------------------------------------
create or replace function public.export_section(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_dirigente(p_section);
  return jsonb_build_object(
    'exported_at', now(),
    'section', (select to_jsonb(s) from public.sections s where s.id = p_section),
    'settings', (select to_jsonb(x) from public.section_settings x where x.section_id = p_section),
    'teams', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.teams t where t.section_id = p_section),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('membership', to_jsonb(m) - 'invite_id',
                  'profile', jsonb_build_object('full_name', p.full_name, 'totem', p.totem))), '[]')
                from public.memberships m join public.profiles p on p.id = m.profile_id where m.section_id = p_section),
    'adhesions', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.adhesions a
                  join public.memberships m on m.id = a.membership_id where m.section_id = p_section),
    'stage_paths', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.stage_paths x
                    join public.memberships m on m.id = x.membership_id where m.section_id = p_section),
    'stage_choices', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.stage_choices x
                      join public.memberships m on m.id = x.membership_id where m.section_id = p_section),
    'trail_requests', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.trail_requests x where x.section_id = p_section),
    'trail_request_versions', (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from public.trail_request_versions v
                               join public.trail_requests r on r.id = v.request_id where r.section_id = p_section),
    'attachments', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.attachments a
                    join public.trail_requests r on r.id = a.request_id where r.section_id = p_section),
    'trail_decisions', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from public.trail_decisions d
                        join public.trail_requests r on r.id = d.request_id where r.section_id = p_section),
    'stage_requests', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.stage_requests x
                       join public.memberships m on m.id = x.membership_id where m.section_id = p_section),
    'merit_awards', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.merit_awards x
                     join public.memberships m on m.id = x.membership_id where m.section_id = p_section)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Privilégios das funções: apenas utilizadores autenticados.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;


-- ===== 20261013000500_storage.sql =====
-- Pioneiros — armazenamento privado (Supabase Storage) e respetivas políticas.
-- Fotografias: bucket «fotografias», caminho <profile_id>/<ficheiro>.
-- Anexos: bucket «anexos», caminho <request_id>/<ficheiro>.
-- Nenhum bucket é público: o acesso é feito com URLs temporários (signed URLs).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('fotografias', 'fotografias', false, 2 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp']),
  ('anexos', 'anexos', false, 10 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- O dono do pedido pode carregar anexos enquanto o pedido está em rascunho.
create or replace function private.can_upload_attachment(p_folder text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.trail_requests r
    join public.memberships m on m.id = r.membership_id
    where r.id = private.safe_uuid(p_folder) and r.status = 'rascunho'
      and m.profile_id = auth.uid() and m.status = 'ativo'
  )
$$;

create or replace function private.can_read_attachment(p_folder text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.trail_requests r
    where r.id = private.safe_uuid(p_folder) and private.can_view_progress(r.membership_id)
  )
$$;

-- Só se apaga um ficheiro que não esteja ligado a nenhuma versão já submetida.
create or replace function private.can_delete_attachment(p_folder text, p_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.can_upload_attachment(p_folder) and not exists (
    select 1 from public.attachments a join public.trail_request_versions v on v.id = a.version_id
    where a.storage_path = p_name and v.submitted_at is not null
  )
$$;

create policy "fotografias: carregar na própria pasta" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotografias' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fotografias: atualizar a própria" on storage.objects for update to authenticated
  using (bucket_id = 'fotografias' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'fotografias' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fotografias: apagar a própria" on storage.objects for delete to authenticated
  using (bucket_id = 'fotografias' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fotografias: ver perfis autorizados" on storage.objects for select to authenticated
  using (bucket_id = 'fotografias' and private.can_view_profile(private.safe_uuid((storage.foldername(name))[1])));

create policy "anexos: carregar em rascunho próprio" on storage.objects for insert to authenticated
  with check (bucket_id = 'anexos' and private.can_upload_attachment((storage.foldername(name))[1]));
create policy "anexos: ver com permissão sobre o pedido" on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and private.can_read_attachment((storage.foldername(name))[1]));
create policy "anexos: apagar de rascunho próprio" on storage.objects for delete to authenticated
  using (bucket_id = 'anexos' and private.can_delete_attachment((storage.foldername(name))[1], name));

-- Execução das funções privadas: só as usadas diretamente em políticas RLS.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_active_member(uuid),
  private.is_dirigente(uuid),
  private.is_admin(uuid),
  private.can_view_progress(uuid),
  private.can_view_membership(uuid),
  private.can_view_profile(uuid),
  private.request_membership(uuid),
  private.safe_uuid(text),
  private.can_upload_attachment(text),
  private.can_read_attachment(text),
  private.can_delete_attachment(text, text)
to authenticated;


-- ===== 20261013000600_catalog_pioneiros_v1.sql =====
-- GERADO AUTOMATICAMENTE por scripts/generate-catalog-sql.mjs a partir de catalog/pioneiros-v1.json.
-- Não editar à mão. Ver catalog/RELATORIO_IMPORTACAO.md.
do $catalog$
declare v_version uuid; v_area uuid; v_trail uuid;
begin
  insert into public.catalog_versions (key, section_kind, label, source, status) values ('pioneiros-manual-v1', 'pioneiros', 'III Secção — Manual do Dirigente, Sistema de Progresso (importação v1)', '{"file":"docs/fonte/Manual_do_Dirigente_Sistema_de_Progresso.pdf","sha256":"79114757a5e129de7f8405a7db396b344118dccad075ef54b42c789585a836d6","pages_note":"Numeração impressa do manual (coincide com a numeração do ficheiro PDF).","catalog_pages":"41-46","stages_pages":"9, 62-63","mechanics_pages":"4-15"}'::jsonb, 'ativo') returning id into v_version;
  insert into public.catalog_stages (version_id, key, name, kind, ordinal, source_page, summary) values (v_version, 'desprendimento', 'Desprendimento', 'adesao', 0, 6, 'Etapa de adesão (Início de Pista). A decisão sobre a adesão é tomada em Conselho de Guias, com a presença de toda a Equipa de Animação.');
  insert into public.catalog_stages (version_id, key, name, kind, ordinal, source_page, summary) values (v_version, 'conhecimento', 'Conhecimento', 'progresso', 1, 9, '1.ª etapa de progresso — Saber.');
  insert into public.catalog_stages (version_id, key, name, kind, ordinal, source_page, summary) values (v_version, 'vontade', 'Vontade', 'progresso', 2, 9, '2.ª etapa de progresso — Querer.');
  insert into public.catalog_stages (version_id, key, name, kind, ordinal, source_page, summary) values (v_version, 'construcao', 'Construção', 'progresso', 3, 9, '3.ª etapa de progresso — Agir.');
  insert into public.catalog_areas (version_id, code, name, full_name, dimension, position, source_page) values (v_version, 'F', 'Físico', 'Desenvolvimento Físico', 'o corpo', 1, 41) returning id into v_area;
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'fisico-desempenho', 'Desempenho', 1, 41, 'Pretende-se que o Pioneiro tenha consciência dos cuidados a ter com o seu corpo, no que concerne à alimentação e ao esforço físico, praticando regularmente exercício físico.', array['Testar Limites', 'Capacidade', 'Destreza', 'Desafio-me', 'Sou capaz ou não', 'Testo limites']::text[], array['Programar e executar um raid para a sua Equipa e/ou Comunidade planeamento da gestão de esforço, descanso e alimentação em raid;', 'Promover uma palestra sobre atividade desportiva saúde e bem-estar;', 'Praticar atividade física regular e crio um plano de treino ou objetivos a atingir dentro dessa atividade;', 'Organização de torneio de provas desportivas;', 'Fazer uma avaliação das suas limitações físicas e organizar uma atividade de Equipa que o ajude a superar novos desafios;', 'Inscrever-se numa atividade nova, que nunca fez, que o faça sair da minha zona de conforto;']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'F1', 'Tenho preocupação com o meu desempenho físico. Pratico atividades que contribuem para o meu desenvolvimento equilibrado.', 1, null);
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'fisico-autoconhecimento', 'Autoconhecimento', 2, 41, 'O Pioneiro deve aceitar-se como é, reconhecendo e respeitando as diferenças físicas. Deve também respeitar o sexo oposto, tendo consciência das diferenças hormonais existentes entre ambos.', array['Aceitação', 'Respeito', 'Corpo', 'Aceito como sou', 'Aceito como és']::text[], array['Na sua vida diária, tentar arranjar soluções para a inclusão de pessoas com deficiência (ex.: apoiar à dinamização da implementação de acessibilidades a pessoas de mobilidade reduzida, participação em ações e campanhas de sensibilização e apoio nos serviços de acessibilidades, promoção de sinalética sonora das vias, frequência de um curso de língua gestual, para auxiliar a tradução (cerimónias, eventos, celebrações);', 'Promover um debate/campanha de sensibilização/palestra/exposição sobre tipos de bullying de fragilidade humana/ etnia/ orientação sexual/ pessoa com deficiência/ obesidade, etc.;', 'Fazer uma pesquisa sobre a coeducação e aplicar os conhecimentos na preparação e realização de uma atividade;', 'Elaborar uma análise SWOT pessoal, das suas competências físicas, fraquezas, oportunidades e ameaças. Usar este plano para se desafiar e conhecer os seus limites;', 'Organizar a semana da mobilidade na sua escola, Agrupamento ou grupo de jovens;', 'Fazer um guião de campo que possa ser referência sobre as dificuldades que um Escuteiro com mobilidade reduzida possa ter em atividades escutistas e como superá-las;']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'F2', 'Aceito-me como sou e respeito as diferenças físicas entre as pessoas.', 1, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'F3', 'Reconheço e respeito as diferenças entre homens e mulheres e as necessidades de cada um, agindo sempre em conformidade.', 2, null);
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'fisico-bem-estar-fisico', 'Bem-estar físico', 3, 41, 'Pretende-se que o Pioneiro faça escolhas de vida saudáveis (alimentação, hábitos de higiene, acompanhamento médico,…), tendo consciência dos malefícios físicos e psicológicos de uma alimentação excessiva ou insuficiente. Deve procurar estar informado dos riscos que corre com más escolhas e experiências, conhecendo as suas consequências para a saúde física e mental, evitando-os.', array['Escolhas saudáveis', 'Atividade física', 'Nutrição', 'Escolho ser saudável', 'Sou ativo']::text[], array['Praticar atividade física regular;', 'Planear e ser responsável pelas refeições de, pelo menos, um fim de semana de atividade, planeando-as tendo em conta a roda dos alimentos, com valores nutricionais adequados à atividade;', 'Elaborar um manual de boas práticas e alimentação saudável em campo;', 'Promover ações de sensibilização, debates/conferências/exposições/workshops que promovam a qualidade de vida: higiene diária (saúde oral, cuidados dermatológicos, higiene corporal...);', 'Promover ações de sensibilização, debates/conferências/exposições/workshops de prevenção de comportamentos de risco, na e para a comunidade, como por exemplo, Consumos aditivos (alcoolismo, drogas, ...);Uso abusivo (tecnologia); Perturbações alimentares (bulimia, anorexia, prevenção à obesidade);']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'F4', 'Rejo-me por um estilo de vida saudável, preocupando-me com a minha apresentação, alimentação e repouso, evitando comportamentos e substâncias de risco.', 1, null);
  insert into public.catalog_areas (version_id, code, name, full_name, dimension, position, source_page) values (v_version, 'A', 'Afetivo', 'Desenvolvimento Afetivo', 'os sentimentos e as emoções', 2, 42) returning id into v_area;
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'afetivo-relacionamento-e-sensibilidade', 'Relacionamento e sensibilidade', 1, 42, 'Pretende-se que o Pioneiro respeite os outros nas várias relações que tem na sua vida (família, amigos, colegas, namorada/o, …), encarando a família como o pilar da sua vida. Deve encarar o seu crescimento com naturalidade, respeitando-se a si próprio. Deve ter conhecimento de várias formas de expressão artística, transmitindo a sua opinião pessoal, respeitando as opiniões dos outros.', array['Gestão de Conflitos', 'Valores', 'Conheço-me', 'Estou atento']::text[], array['Promover momentos de discussão na Comunidade de situações que conheça ou tenha assistido (violência no namoro, bullying, relação com os pais, autoestima, etc.), procurando, em conjunto, procurar respostas e auxílios;', 'Fazer um diário das suas vivências e o que sentiu ao vivê-las, procurando perceber e/ou procurar ajuda para perceber;', 'Convidar a sua família para momentos importantes da minha vida (escutista, escolar, desportiva, etc.);', 'Planear um momento de vivência e convívio aberto à família e/ou amigos;']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'A1', 'Reconheço o valor das minhas relações afetivas e da minha sexualidade, respeitando os outros.', 1, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'A2', 'Reconheço o valor da família e comprometo-me com o bem-estar da mesma. Tenho presente a importância da mesma nas minhas opções de vida.', 2, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'A3', 'Demonstro maturidade perante os conflitos e reconheço diferentes sensibilidades e gostos.', 3, null);
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'afetivo-equilibrio-emocional', 'Equilíbrio emocional', 2, 42, 'Pretende-se que o Pioneiro saiba gerir os sentimentos dos seus pares, respeitando-os, e que saiba autoavaliar-se, sabendo apontar onde erra de modo a que possa corrigir o seu comportamento.', array['Autocontrolo', 'Otimismo/Pessimismo', 'Maturidade', 'Respeito-me', 'Respeito-te']::text[], array['Escrever um diário de emoções e experiências do último mês, reflitir sobre o que sentiu, como atuou e adequar o seu comportamento de acordo com o que quer ser;', 'Organizar um momento de debate com a sua Equipa ou Comunidade. No final do debate, fazer uma análise da forma como lidou face a alguém que teve uma opinião diferente da sua;', 'Organizar uma atividade role play para a sua Equipa ou Comunidade, na qual se façam colidir propositadamente opiniões e situações. Avaliar, no final, a forma como reagiu e aceitou as situações que lhe forem impostas;', 'Criar pontos de esforço concretos durante um período de tempo que o façam avaliar as suas atitudes;']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'A4', 'Ajo de forma ponderada, respeitando o sentimento dos outros e esforço-me por corrigir quando me excedo.', 1, null);
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'afetivo-autoestima', 'Autoestima', 3, 42, 'O Pioneiro deve aceitar a sua personalidade, saber aceitar também as características menos positivas e demonstrar um trabalho pessoal contínuo na alteração destas.', array['Valorização Pessoal', 'Eu Sou/Eu Não sou', 'Eu Quero/Eu não Quero Ser', 'Quero saber mais']::text[], array['Fazer o seu teste de personalidade e promover que a sua Equipa o faça. Dinamizar uma discussão sobre os tipos de personalidades diferentes e como lidar com cada um;', 'Fazer testes psicotécnicos e traçar um plano de formação que tenha em conta o que quer ser no futuro, e como deve trabalhar para isso;', 'Fazer uma autoavaliação dos seus conhecimentos técnicos e organizar um atelier para a Comunidade numa área importante para o momento do grupo;', 'Elaborar uma carta de compromisso de atitudes e valores que quero por em prática na minha vida, em momentos concretos;']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'A5', 'Reconheço as características da minha personalidade, trabalhando sempre para corrigir as menos positivas.', 1, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'A6', 'Procuro desenvolver continuamente as minhas aptidões e esforço-me para melhorar as minhas limitações.', 2, null);
  insert into public.catalog_areas (version_id, code, name, full_name, dimension, position, source_page) values (v_version, 'C', 'Caráter', 'Desenvolvimento do Caráter', 'a atitude', 3, 43) returning id into v_area;
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'carater-autonomia', 'Autonomia', 1, 43, 'Pretende-se que o Pioneiro defina metas para o seu crescimento, estabelecendo para si padrões de vida, conhecendo as implicações/consequências das suas escolhas.', array['Independência', 'Referências', 'Opção', 'Penso por mim', 'Sei optar', 'Crio prioridades']::text[], array['Participar ativamente na discussão do Empreendimento;', 'Definir um objetivo (especialidade, conhecimento técnico, estratégia para o seu cargo...) e traçar um plano para o cumprir;', 'Ser capaz de decidir uma área de estudos no seu percurso formativo;', 'Participar dentro da sua Equipa na eleição de um novo guia;', 'Fazer uma avaliação dos momentos da minha vida em que ainda dependo muito dos meus pais, e crio soluções para me tornar mais independente - por exemplo, boleias, semanadas e mesadas, tarefas de casa;']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'C1', 'Sou capaz de fazer opções, de acordo com as minha referência de valores fundamentais, aceitando as suas implicações.', 1, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'C2', 'Estabeleço para mim, com regularidade, metas a atingir em várias áreas da minha vida.', 2, null);
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'carater-responsabilidade', 'Responsabilidade', 2, 43, 'O Pioneiro deve demonstrar responsabilidade no desempenho das suas tarefas, assumindo-as de forma consciente, encarando os resultados que advêm dessa responsabilidade. Deve ser persistente na resolução dos problemas, aprendendo com os mesmos.', array['Perseverança', 'Compromisso', 'Consequência', 'Assumo decisões', 'Aceito consequências', 'Sou empenhado']::text[], array['Assumir as tarefas e criar momentos formativos relativos à fase de preparação do Empreendimento;', 'Organizar uma atividade sobre cargos ou um momento de partilha e aprendizagem para a sua Equipa ou Comunidade;', 'Como guia, assumir as consequências das suas decisões para a sua Equipa;', 'Criar 3 objetivos da sua vida pessoal que impliquem decisões. Por exemplo: decidir ir trabalhar no Verão, assumir uma nova tarefa em casa, ou um cargo novo na Equipa, etc.);', 'Assumir o cargo de delegado de turma;']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'C3', 'Reconheço a importância das tarefas que me foram atribuídas, estabeleço prioridades e respeito-as, correspondendo à confiança em mim depositada.', 1, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'C4', 'Ajo cada dia de acordo com as minhas convicções de referências, tendo consciência que sou exemplo para os outros.', 2, 'P1: O texto impresso de C4 e de C7 é idêntico. Pode tratar-se de uma gralha no manual (C4 em falta). Importado tal como está; aguarda confirmação por fonte oficial.');
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'C5', 'Reconheço que as minhas ações/decisões têm influência nos grupos de que faço parte.', 3, null);
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'carater-coerencia', 'Coerência', 3, 43, 'Pretende-se que o Pioneiro seja coerente ao apresentar, de forma consciente, as suas ideias e valores, vivendo em conformidade com os mesmos.', array['Partilha de valores', 'Defender Ideias', 'Convicção', 'Sou Exemplo', 'Dou Testemunho']::text[], array['Criar pontos de esforço para o mês - boas-ações, momentos em que que afirma o que é e quem é - e põe-no em prática;', 'Dinamizar uma atividade sobre escutismo na escola ou junto de algum grupo em que esteja envolvido;', 'Organizar uma dinâmica que implique a reflexão sobre os valores de cada um e a sua ligação com os valores universais;', 'Identificar nas suas vivências 10 momentos (ou mais) em que mostrou viver a lei do escuta;', 'Partilhar com a minha família e amigos os valores que o definem - enquanto pessoa, enquanto Escuteiro, podendo partilhar nas redes sociais, fazer um vídeo ou um poster.', 'Pedir para participar num momento particular de avaliação do Agrupamento e trazer inputs importantes para esse momento;']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'C6', 'Partilho e defendo aquilo em que acredito de forma serena e fundamentada.', 1, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'C7', 'Ajo cada dia de acordo com as minhas convicções de referências, tendo consciência que sou exemplo para os outros.', 2, 'P1: O texto impresso de C4 e de C7 é idêntico. Pode tratar-se de uma gralha no manual (C4 em falta). Importado tal como está; aguarda confirmação por fonte oficial.');
  insert into public.catalog_areas (version_id, code, name, full_name, dimension, position, source_page) values (v_version, 'E', 'Espiritual', 'Desenvolvimento Espiritual', 'o sentido de Deus', 4, 44) returning id into v_area;
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'espiritual-descoberta', 'Descoberta', 1, 44, 'O Pioneiro deverá conhecer o modo como Deus se deu a conhecer aos principais profetas, estabelecendo com eles uma relação de confiança. Deve compreender que Jesus formou uma Comunidade com os seus Apóstolos, a quem se revelou ao longo do tempo, e que essa Comunidade é o fundamento da Igreja dos dias de hoje. Pretende-se que seja membro ativo da Comunidade Paroquial, compreendendo a diversidade de carismas existentes.', array['Procurar', 'Saber', 'Viver', 'Sou curioso', 'Faço Perguntas', 'Procuro Respostas']::text[], array['Organizar um raid com um imaginário bíblico;', 'Escolher ter EMRC na escola;', 'Organizar uma atividade de animação da fé para a Comunidade;', 'Ajudar a dinamizar a vivência de Advento ou Quaresma da sua Comunidade ou Agrupamento;', 'Organizar um ciclo de conversas sobre o que significa ser católico;']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'E1', 'Conheço e compreendo a vida dos principais profetas e a sua relação com Deus.', 1, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'E2', 'Conheço a forma como Jesus se deu progressivamente a conhecer aos Apóstolos e a vivência deles em comunidade.', 2, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'E3', 'Reconheço que na igreja todos os membros são diferentes e que, unidos nas diferenças, tornamos a comunidade mais rica.', 3, null);
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'espiritual-aprofundamento', 'Aprofundamento', 2, 44, 'Pretende-se que o Pioneiro compreenda a relação que estabelece com Deus na oração, procurando encontrar a sua forma pessoal de oração e participando conscientemente na Eucaristia, como expressão máxima da oração cristã. Deve conhecer a posição da Igreja sobre temas fundamentais e atuais, dialogando sobre os mesmos, à Luz do Evangelho.

O Pioneiro deve ainda conhecer as diferentes religiões e confissões cristãs, aprofundando a escolha da fé católica.', array['Diálogo Inter-religioso', 'Comunidade', 'Testemunho', 'Sei', 'Escolho', 'Participo']::text[], array['Dinamizar uma discussão sobre a realidade ecuménica mundial;', 'Fazer o Crisma;', 'Ler uma homília do Papa e debatê-la na sua comunidade;', 'Ir à catequese ou dinamizar um grupo de jovens da Paróquia;', 'Organizar uma atividade de visita a locais de referência para outras religiões;']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'E4', 'Aprofundo os hábitos de oração diários e participo nas celebrações comunitárias.', 1, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'E5', 'Conheço o ponto de vista da Igreja sobre os temas principais e que os mesmos estão fundamentados na Bíblia.', 2, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'E6', 'Aprofundo a minha identidade católica no contacto com as outras religiões.', 3, null);
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'espiritual-servico', 'Serviço', 3, 44, 'O Pioneiro deve reconhecer a riqueza que Deus nos deu de sermos responsáveis pela Criação, não atentando contra Ela, nem contra si próprio. Deve ser veículo de consciência global contra os atentados da vida humana (fome, guerra, escravatura, pena de morte, eutanásia, aborto, …). Deve, ainda, assumir-se como cristão em todos os grupos onde se insere.', array['Dar mais', 'Construir', 'Evangelização', 'Tenho Valor', 'Reconheço o valor do/no outro']::text[], array['Ser catequista; ser leitor da comunidade; ser acólito;', 'Participar na passagem da Luz da Paz de Belém na minha localidade;', 'Dinamizar uma atividade de animação espiritual junto de uma comunidade isolada;', 'Sendo o seu corpo uma dádiva de Deus, organizar um workshop sobre os malefícios do consumo de álcool e drogas;', 'Dinamizar ações concretas para diminuir a pegada ecológica da minha sede;']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'E7', 'Protejo a Natureza e a vida humana como obra de Deus, defendendo a última como valor absoluto.', 1, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'E8', 'Ponho-me ao serviço dos outros, marcando positivamente, como cristão, todos os grupos onde me insiro.', 2, null);
  insert into public.catalog_areas (version_id, code, name, full_name, dimension, position, source_page) values (v_version, 'I', 'Intelectual', 'Desenvolvimento Intelectual', 'a inteligência', 5, 45) returning id into v_area;
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'intelectual-procura-do-conhecimento', 'Procura do conhecimento', 1, 45, 'Pretende-se que o Pioneiro invista na sua formação, demonstrando uma maior aquisição de conhecimentos, partilhando com os outros as suas ideias. Como consequência, deve saber adequar as suas aptidões a atividades/dinâmicas em que se sente à vontade e que domine.', array['Autoaprendizagem', 'Iniciativa', 'Procura', 'Quero Aprender mais', 'Quero saber mais', 'Sou Capaz']::text[], array['Dinamizar uma oficina e dar formação;', 'Fazer um folheto com informação sobre a área profissional que sonha seguir;', 'Desafiar a sua Comunidade a organizar uma feira de artes/ofícios;', 'Procurar participar em atividades que o colocam à prova em novas áreas técnicas;', 'Inscrever-se numa formação para jovens que o seu município ou freguesia disponibilizem (ou ao qual tenha acesso de outra forma);', 'Criar uma plataforma informática interativa de preparação para o Empreendimento;']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'I1', 'Procuro sempre aumentar os meus conhecimentos, sabendo utilizar as várias ferramentas de informação que tenho ao meu dispor.', 1, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'I2', 'Reconheço as minhas aptidões e faço as minhas opções na área profissional ou de estudos.', 2, null);
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'intelectual-resolucao-de-problemas', 'Resolução de problemas', 2, 45, 'O Pioneiro deve procurar e utilizar novos conhecimentos, experiências e realidades, de forma a conseguir fazer comparações e saber escolher o seu percurso. Deve desenvolver capacidade crítica pessoal e externa de forma construtiva, contribuindo sempre para o bem comum.', array['Capacidade de análise', 'Uso de recursos', 'Capacidade de síntese', 'Desenrasco-me', 'Sou versátil']::text[], array['Assumir uma função que nunca teve para a preparação do próximo Empreendimento;', 'Criar um momento de avaliação criativo e dinâmico para uma atividade de Comunidade;', 'Dinamizar uma atividade em Comunidade de brainstorming de soluções para atingir os objetivos de desenvolvimento sustentável dentro do meu Agrupamento.', 'Identificar 5 ou mais melhorias que a sua sede pode sofrer e colocá-las em prática, procurando ajuda para tal;', 'Organizar atividades de manutenção de material de campo - aprender como reparar material e partilhar com a Comunidade;', 'Criar um plano de emergência para a sua Sede e organizar um simulacro;']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'I3', 'Sei avaliar as experiências que vivo e utiliza-as de forma criativa nas novas situações que me apresentam.', 1, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'I4', 'Consigo analisar problemas, propor soluções e escolher a mais adequada.', 2, null);
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'intelectual-criatividade-e-expressao', 'Criatividade e expressão', 3, 45, 'Pretende-se que o Pioneiro crie novas propostas para a sua vivência, aplicando técnicas de apresentação e comunicação.', array['Inovação', 'Criar ideias', 'Projetos', 'Penso Diferente', 'Exploro novos meios', 'Chego-me à frente']::text[], array['Organizar uma exposição fotográfica ou artística na sua sede;', 'Dinamizar o Livro de Ouro da Equipa ou o painel de Empreendimento;', 'Fazer o plano da construção, uma maquete, para o próximo acampamento;', 'Preparar uma peça de Fogo de Conselho ou animar o Fogo de Conselho de Comunidade;', 'Dinamizar novos momentos de oração dentro da Comunidade;', 'Participar sozinho ou com a sua Equipa num concurso para insígnia ou inovação no CNE;']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'I5', 'Desafio-me a criar ideias e projetos inovadores, de acordo com os meus conhecimentos e gostos.', 1, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'I6', 'Exploro diferentes técnicas, ideias e meios e apresento-as de forma criativa e adequada aos outros.', 2, null);
  insert into public.catalog_areas (version_id, code, name, full_name, dimension, position, source_page) values (v_version, 'S', 'Social', 'Desenvolvimento Social', 'a integração social', 6, 46) returning id into v_area;
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'social-exercer-ativamente-cidadania', 'Exercer ativamente cidadania', 1, 46, 'O Pioneiro deve conhecer os seus direitos e deveres em todos os espaços onde se insere, dinamizando projetos de interesse comum. Deve ser motivado a ter um papel ativo na sua comunidade.

Pretende-se, ainda, que respeite as posições tomadas pelo grupo, tomando-as como suas.', array['Democracia', 'Direitos', 'Deveres', 'Sou/estou na comunidade', 'Promotor de causas']::text[], array['Participar ativamente na associação de estudantes ou momento de cidadania participativa local;', 'Estar atento ao OP jovem e procurar formas de se envolver ativamente num projeto;', 'Fazer voluntariado numa instituição local;', 'Desenvolver uma campanha de sensibilização sobre uma situação emergente da atualidade;']::text[], null) returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'S1', 'Promovo ativamente o conhecimento dos meus deveres e direitos por todos os que me rodeiam.', 1, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'S2', 'Participo ativamente nas comunidades em que me inseres intervindo na promoção de causas comuns.', 2, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'S3', 'Aceito a decisão de uma votação e ainda que perca, trabalho no sentido do todo.', 3, null);
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'social-solidariedade-e-tolerancia', 'Solidariedade e tolerância', 2, 46, 'Pretende-se que o Pioneiro esteja atento ao mundo que o rodeia, a sua comunidade, de modo a identificar situações onde pode ser útil. O Pioneiro deve ser interventivo, capaz de ter voz ativa, expondo as suas ideias.', array['Aceitação', 'Respeito pela diferença', 'Interajuda', 'Sou tolerante', 'Sou Útil', 'Participo']::text[], array['Dinamizar uma atividade de impacto na comunidade;', 'Identificar 3 situações de exclusão social na sua comunidade e construir pontes para diminuir estas situações;', 'Dinamizar um fórum de partilha de ideias e diversidade social;', 'Organizar uma exposição para a sua sede ou escola sobre o que fazer em situações de bullying, exclusão social ou racismo;']::text[], 'P2: O enquadramento impresso dos dois trilhos é idêntico. Importado tal como está; aguarda confirmação por fonte oficial.') returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'S4', 'Identifico situações em que posso ser útil (sozinho ou em Equipa), na resolução ou minimização de um problema social.', 1, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'S5', 'Sei expor as minhas ideias, mantendo um diálogo de respeito para com as ideias dos outros.', 2, null);
  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, 'social-interacao-e-cooperacao', 'Interação e cooperação', 3, 46, 'Pretende-se que o Pioneiro esteja atento ao mundo que o rodeia, a sua comunidade, de modo a identificar situações onde pode ser útil. O Pioneiro deve ser interventivo, capaz de ter voz ativa, expondo as suas ideias.', array['Espírito de Equipa', 'Desempenho tarefas', 'Assertividade', 'Sou confiável', 'Trabalho para/Trabalho com']::text[], array['Escolher objetivos sustentáveis para o desenvolvimento, aplicáveis na minha comunidade, e ativar ações para ajudar a colmatá-los;', 'Desempenhar a função para o Empreendimento que lhe é atribuída com responsabilidade e energia;', 'Desempenhar o seu cargo de Equipa e criar objetivos concretos para a sua execução;', 'Reconhecer que a sua família também é uma Equipa e identificar os seus papéis, tarefas e responsabilidades, que assume no seu seio., criando objetivos e ações para os cumprir;']::text[], 'P2: O enquadramento impresso dos dois trilhos é idêntico. Importado tal como está; aguarda confirmação por fonte oficial.') returning id into v_trail;
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'S6', 'Reconheço a importância das diferentes funções num grupo e desempenho o melhor possível aquelas que me são confiadas.', 1, null);
  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, 'S7', 'Trabalho para e com o grupo respeitando as suas necessidades não sobrepondo a minha própria vontade.', 2, null);
end
$catalog$;


-- ===== 20261013000700_bootstrap.sql =====
-- Pioneiros — criação segura da secção e do primeiro administrador.
-- Esta função NÃO está acessível pela API: só pode ser executada por quem tem
-- acesso de proprietário à base de dados (ex.: SQL Editor do painel Supabase).
-- Ver supabase/bootstrap/primeiro_admin.sql e o README.
create or replace function private.bootstrap_section(p_group_name text, p_section_name text, p_admin_email text, p_admin_is_dirigente boolean default true)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid; v_group uuid; v_section uuid; v_version uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(trim(p_admin_email));
  if v_user is null then
    raise exception 'Não existe conta com o email %. Cria primeiro a conta na aplicação e confirma o email.', p_admin_email;
  end if;
  select id into v_version from public.catalog_versions where key = 'pioneiros-manual-v1';
  if v_version is null then raise exception 'Catálogo dos Pioneiros não encontrado (migração em falta).'; end if;

  select id into v_group from public.groups where name = trim(p_group_name);
  if v_group is null then
    insert into public.groups (name) values (trim(p_group_name)) returning id into v_group;
  end if;
  select id into v_section from public.sections where group_id = v_group and name = trim(p_section_name);
  if v_section is null then
    insert into public.sections (group_id, kind, name, catalog_version_id)
    values (v_group, 'pioneiros', trim(p_section_name), v_version) returning id into v_section;
    insert into public.section_settings (section_id) values (v_section);
  end if;

  insert into public.profiles (id) values (v_user) on conflict (id) do nothing;
  perform set_config('pioneiros.reason', 'Primeiro administrador (bootstrap)', true);
  insert into public.memberships (profile_id, section_id, status, function, is_admin, approved_at)
  values (v_user, v_section, 'ativo', case when p_admin_is_dirigente then 'dirigente'::public.member_function end, true, now())
  on conflict (profile_id, section_id) do update
    set status = 'ativo', is_admin = true,
        function = coalesce(case when p_admin_is_dirigente then 'dirigente'::public.member_function end, public.memberships.function),
        team_id = case when p_admin_is_dirigente then null else public.memberships.team_id end;
  return v_section;
end
$$;
revoke all on function private.bootstrap_section(text, text, text, boolean) from public, anon, authenticated;


-- ===== 20261014000100_caminho_tipos.sql =====
-- Pioneiros — novos valores de enumeração para o reconhecimento na negociação
-- (Manual do Dirigente, p. 10: «Aquando da primeira Escolha/Negociação, após a
-- Promessa/Investidura, a Equipa de Animação deverá validar os trilhos que o
-- elemento demonstre já ter atingido, desde que devidamente fundamentados.»)
-- Ficheiro separado: um valor novo de enum só pode ser usado depois de confirmado.
alter type public.request_kind add value if not exists 'negociacao';
alter type public.decision_kind add value if not exists 'reconhecido_negociacao';


-- ===== 20261014000200_caminho.sql =====
-- Pioneiros — Caminho: posição de cada pioneiro no percurso, traçado do perfil,
-- Promessa/Investidura antes da 1.ª etapa, reconhecimento na negociação,
-- contadores de pendentes e atividade recente.
-- Não apaga nem altera registos existentes.

-- ---------------------------------------------------------------------------
-- Início de Pista: o traçado do perfil pela Equipa de Animação (pp. 4 e 7)
-- pode ser registado antes da decisão sobre a adesão.
-- ---------------------------------------------------------------------------
alter table public.adhesions alter column decided_on drop not null;
alter table public.adhesions add column if not exists profile_traced_on date;
alter table public.adhesions add column if not exists profile_recorded_by uuid;
alter table public.adhesions add constraint adhesions_has_date check (decided_on is not null or profile_traced_on is not null);

-- Pedidos «reconhecido na negociação» (kind = negociacao) ficam sempre aprovados.
alter table public.trail_requests drop constraint if exists trail_requests_check;
alter table public.trail_requests add constraint trail_requests_status_by_kind
  check (kind = 'historico' or kind::text = 'negociacao' or status not in ('aprovado', 'recusado'));
alter table public.trail_requests add constraint trail_requests_negociacao_aprovado
  check (kind::text <> 'negociacao' or status = 'aprovado');

create or replace function public.record_profile_traced(p_membership uuid, p_date date)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  v_m := private.progress_member(p_membership);
  perform private.assert_dirigente(v_m.section_id);
  if p_date is null or p_date > current_date then raise exception 'Indica uma data válida.'; end if;
  insert into public.adhesions (membership_id, profile_traced_on, profile_recorded_by, recorded_by)
  values (p_membership, p_date, auth.uid(), auth.uid())
  on conflict (membership_id) do update set profile_traced_on = excluded.profile_traced_on, profile_recorded_by = excluded.profile_recorded_by;
end
$$;

-- A abertura da 1.ª etapa passa a exigir a Promessa/Investidura (p. 10: a
-- primeira Escolha/Negociação acontece «após a Promessa/Investidura»).
create or replace function public.open_stage(p_membership uuid, p_stage_key text, p_insignia_on date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_m public.memberships;
  v_stage public.catalog_stages;
  v_ad public.adhesions;
  v_id uuid;
begin
  v_m := private.progress_member(p_membership);
  perform private.assert_dirigente(v_m.section_id);
  select cs.* into v_stage from public.catalog_stages cs
    join public.sections s on s.catalog_version_id = cs.version_id
   where s.id = v_m.section_id and cs.key = p_stage_key and cs.kind = 'progresso';
  if v_stage.id is null then raise exception 'Etapa inválida.'; end if;
  select * into v_ad from public.adhesions where membership_id = p_membership;
  if v_ad.decided_on is null then raise exception 'Regista primeiro a adesão (Desprendimento).'; end if;
  if v_ad.commitment_on is null then raise exception 'Regista primeiro a Promessa/Investidura: a primeira escolha/negociação acontece depois dela.'; end if;
  if v_stage.ordinal > 1 and not exists (
    select 1 from public.stage_paths where membership_id = p_membership
       and stage_ordinal = v_stage.ordinal - 1 and status = 'concluida'
  ) then
    raise exception 'A etapa anterior ainda não está concluída.';
  end if;
  if p_insignia_on > current_date then raise exception 'A data da insígnia não pode ser futura.'; end if;
  insert into public.stage_paths (membership_id, stage_id, stage_key, stage_ordinal, opened_by, insignia_delivered_on, insignia_recorded_by)
  values (p_membership, v_stage.id, v_stage.key, v_stage.ordinal, auth.uid(), p_insignia_on,
          case when p_insignia_on is not null then auth.uid() end)
  returning id into v_id;
  perform private.audit(v_m.section_id, 'etapa_aberta', 'stage_path', v_id::text, jsonb_build_object('stage', p_stage_key));
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'etapa_aberta', 'Nova etapa',
    'Começou a etapa ' || v_stage.name || '. Escolhe e negoceia um trilho de cada área.', '/caminho');
  return v_id;
exception when unique_violation then
  raise exception 'Esta etapa já foi aberta ou existe outra etapa em curso.';
end
$$;

-- Reconhecimento, na negociação, de um trilho já demonstrado (p. 10).
-- Decisão do dirigente, com fundamentação obrigatória; a Equipa é informada.
-- Não depende da opção «progresso anterior» (são processos diferentes).
create or replace function public.recognize_in_negotiation(p_membership uuid, p_trail uuid, p_comment text, p_reference_date date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships; v_t public.catalog_trails; v_id uuid; v_version uuid;
begin
  v_m := private.progress_member(p_membership);
  perform private.assert_dirigente(v_m.section_id);
  if private.is_owner(v_m.id) then raise exception 'Não é possível decidir sobre o próprio percurso.' using errcode = '42501'; end if;
  v_t := private.section_trail(v_m.section_id, p_trail);
  perform private.require_text(p_comment, 'Fundamenta o reconhecimento: o que demonstra que o trilho já foi alcançado?');
  if p_reference_date > current_date then raise exception 'A data de referência não pode ser futura.'; end if;
  insert into public.trail_requests (membership_id, section_id, trail_id, trail_key, kind, status, approved_reference_date, created_by)
  values (v_m.id, v_m.section_id, v_t.id, v_t.key, 'negociacao', 'aprovado', p_reference_date, auth.uid())
  returning id into v_id;
  insert into public.trail_request_versions (request_id, version_no, submitted_at)
  values (v_id, 1, now()) returning id into v_version;
  insert into public.trail_decisions (request_id, version_id, kind, comment, reference_date, recorded_by, recorded_as)
  values (v_id, v_version, 'reconhecido_negociacao', trim(p_comment), p_reference_date, auth.uid(), 'dirigente');
  perform private.notify(array[v_m.profile_id] || private.team_guias(v_m.team_id), v_m.section_id, 'reconhecido_negociacao',
    'Trilho reconhecido na negociação', v_t.name || ': ' || trim(p_comment), '/pedidos/' || v_id);
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um pedido ativo ou uma validação para este trilho.';
end
$$;

-- ---------------------------------------------------------------------------
-- Posição no caminho
-- ---------------------------------------------------------------------------
-- Marco atual de um pioneiro e o estado nesse marco. «Estar em» uma etapa
-- (em_curso, requisitos_cumpridos, em_validacao) é distinto de «ter concluído»
-- (concluida, reconhecida). Etapas: pp. 9–13; esquema: pp. 3 e 14.
create or replace function private.member_position(p_membership uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_a public.adhesions;
  v_open public.stage_paths;
  v_last public.stage_paths;
  v_max integer;
  v_state text;
begin
  select * into v_a from public.adhesions where membership_id = p_membership;
  -- Etapas já abertas têm prioridade (inclui dados criados antes de a Promessa
  -- ser exigida para abrir a 1.ª etapa).
  if not exists (select 1 from public.stage_paths where membership_id = p_membership) then
    if v_a.membership_id is null or v_a.decided_on is null then
      return jsonb_build_object('milestone', 'inicio_pista',
        'state', case when v_a.profile_traced_on is not null then 'perfil_tracado' else 'em_adesao' end);
    end if;
    if v_a.commitment_on is null then
      return jsonb_build_object('milestone', 'promessa', 'state', 'aguarda_promessa');
    end if;
  end if;
  select * into v_open from public.stage_paths where membership_id = p_membership and status = 'em_curso';
  if v_open.id is not null then
    if exists (select 1 from public.stage_requests where stage_path_id = v_open.id and status in ('submetido', 'decidido_conselho')) then
      v_state := 'em_validacao';
    elsif coalesce(private.stage_ready(v_open.id), false) then
      v_state := 'requisitos_cumpridos';
    else
      v_state := 'em_curso';
    end if;
    return jsonb_build_object('milestone', v_open.stage_key, 'state', v_state);
  end if;
  select * into v_last from public.stage_paths
   where membership_id = p_membership and status = 'concluida' order by stage_ordinal desc limit 1;
  if v_last.id is null then
    return jsonb_build_object('milestone', 'promessa', 'state', 'aguarda_etapa');
  end if;
  select max(cs.ordinal) into v_max from public.catalog_stages cs
   where cs.kind = 'progresso' and cs.version_id = (select version_id from public.catalog_stages where id = v_last.stage_id);
  if v_last.stage_ordinal >= v_max then
    return jsonb_build_object('milestone', 'acampamento',
      'state', case when exists (select 1 from public.merit_awards where membership_id = p_membership)
                    then 'anilha_atribuida' else 'etapas_concluidas' end);
  end if;
  return jsonb_build_object('milestone', v_last.stage_key,
    'state', case when v_last.recognized_on is not null then 'reconhecida' else 'concluida' end);
end
$$;

-- Caminho da secção. Contagens por marco para qualquer membro ativo; nomes,
-- avatares e equipa só dos pioneiros cujo percurso o utilizador já pode ver
-- (o próprio; o guia atual da sua equipa; os dirigentes). Nunca devolve
-- reflexões, anexos, comentários ou observações.
create or replace function public.section_path(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_me public.memberships;
begin
  v_me := private.my_active_membership(p_section);
  if v_me.id is null then raise exception 'Sem acesso a esta secção.' using errcode = '42501'; end if;
  return (
    with members as (
      select m.id, m.team_id, m.function, p.full_name, p.totem, p.photo_path,
             private.member_position(m.id) as pos,
             private.can_view_progress(m.id) as visible
        from public.memberships m join public.profiles p on p.id = m.profile_id
       where m.section_id = p_section and m.status = 'ativo' and m.function in ('pioneiro', 'guia')
    )
    select jsonb_build_object(
      'scope', case when v_me.function = 'dirigente' then 'seccao' when v_me.function = 'guia' then 'equipa' else 'proprio' end,
      'total', (select count(*) from members),
      'counts', coalesce((select jsonb_object_agg(k, n) from (select pos ->> 'milestone' k, count(*) n from members group by 1) c), '{}'::jsonb),
      'members', coalesce((select jsonb_agg(jsonb_build_object(
          'membership_id', id, 'full_name', full_name, 'totem', totem, 'photo_path', photo_path,
          'team_id', team_id, 'function', function,
          'milestone', pos ->> 'milestone', 'state', pos ->> 'state', 'is_me', id = v_me.id)
          order by full_name) from members where visible), '[]'::jsonb)
    )
  );
end
$$;

-- Contadores para a navegação (só o que cabe a cada papel).
create or replace function public.my_pending_counts(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_me public.memberships; v_out jsonb := '{}'::jsonb;
begin
  v_me := private.my_active_membership(p_section);
  if v_me.id is null then return v_out; end if;
  if v_me.function in ('pioneiro', 'guia') then
    v_out := v_out || jsonb_build_object('pedidos', (select count(*) from public.trail_requests
      where membership_id = v_me.id and status in ('rascunho', 'devolvido')));
  end if;
  if v_me.function = 'guia' then
    v_out := v_out || jsonb_build_object('equipa', (select count(*) from public.trail_requests r
      join public.memberships m on m.id = r.membership_id
      where m.team_id = v_me.team_id and m.status = 'ativo' and m.id <> v_me.id
        and r.kind = 'normal' and r.status in ('submetido', 'em_revisao')));
  end if;
  if v_me.function = 'dirigente' then
    v_out := v_out || jsonb_build_object('acompanhamento',
      (select count(*) from public.stage_choices c join public.memberships m on m.id = c.membership_id
        where m.section_id = p_section and m.status = 'ativo' and c.status = 'proposta')
      + (select count(*) from public.stage_requests s join public.memberships m on m.id = s.membership_id
        where m.section_id = p_section and m.status = 'ativo' and s.status in ('submetido', 'decidido_conselho'))
      + (select count(*) from public.trail_requests r join public.memberships m on m.id = r.membership_id
        where r.section_id = p_section and m.status = 'ativo' and r.status in ('submetido', 'em_revisao')
          and (r.kind = 'historico' or m.function = 'guia')));
  end if;
  if v_me.is_admin then
    v_out := v_out || jsonb_build_object('gestao', (select count(*) from public.memberships
      where section_id = p_section and status = 'pendente'));
  end if;
  return v_out;
end
$$;

-- Atividade recente (sem comentários nem reflexões), limitada ao que o
-- utilizador pode ver do percurso de cada pioneiro.
create or replace function public.section_activity(p_section uuid, p_limit integer default 15)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_active_member(p_section) then raise exception 'Sem acesso a esta secção.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(e order by e.at desc) from (
      select * from (
        select d.recorded_at as at, d.kind::text as kind, r.membership_id, p.full_name as member, t.name as subject, r.id::text as ref
          from public.trail_decisions d
          join public.trail_requests r on r.id = d.request_id
          join public.catalog_trails t on t.id = r.trail_id
          join public.memberships m on m.id = r.membership_id
          join public.profiles p on p.id = m.profile_id
         where r.section_id = p_section and d.kind not in ('em_revisao')
        union all
        select s.council_recorded_at, 'conselho_' || s.council_decision::text, s.membership_id, p.full_name, cs.name, s.id::text
          from public.stage_requests s join public.stage_paths sp on sp.id = s.stage_path_id
          join public.catalog_stages cs on cs.id = sp.stage_id
          join public.memberships m on m.id = s.membership_id join public.profiles p on p.id = m.profile_id
         where m.section_id = p_section and s.council_recorded_at is not null
        union all
        select s.final_recorded_at, 'etapa_' || s.final_opinion::text, s.membership_id, p.full_name, cs.name, s.id::text
          from public.stage_requests s join public.stage_paths sp on sp.id = s.stage_path_id
          join public.catalog_stages cs on cs.id = sp.stage_id
          join public.memberships m on m.id = s.membership_id join public.profiles p on p.id = m.profile_id
         where m.section_id = p_section and s.final_recorded_at is not null
        union all
        select sp.opened_at, 'etapa_aberta', sp.membership_id, p.full_name, cs.name, sp.id::text
          from public.stage_paths sp join public.catalog_stages cs on cs.id = sp.stage_id
          join public.memberships m on m.id = sp.membership_id join public.profiles p on p.id = m.profile_id
         where m.section_id = p_section
        union all
        select ma.recorded_at, 'merito', ma.membership_id, p.full_name, null, ma.membership_id::text
          from public.merit_awards ma join public.memberships m on m.id = ma.membership_id
          join public.profiles p on p.id = m.profile_id
         where m.section_id = p_section
      ) x
      where private.can_view_progress(x.membership_id)
      order by x.at desc
      limit greatest(1, least(coalesce(p_limit, 15), 50))
    ) e
  ), '[]'::jsonb);
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_active_member(uuid),
  private.is_dirigente(uuid),
  private.is_admin(uuid),
  private.can_view_progress(uuid),
  private.can_view_membership(uuid),
  private.can_view_profile(uuid),
  private.request_membership(uuid),
  private.safe_uuid(text),
  private.can_upload_attachment(text),
  private.can_read_attachment(text),
  private.can_delete_attachment(text, text)
to authenticated;


-- ===== 20261015000100_pedido_campos.sql =====
-- Pioneiros — campos adicionais do pedido de validação de trilho:
-- «em que contexto» e «como demonstrei os objetivos do trilho».
-- Aditivo: não altera registos existentes; as chamadas antigas continuam válidas.

alter table public.trail_request_versions add column if not exists context text not null default ''
  check (length(context) <= 10000);
alter table public.trail_request_versions add column if not exists evidence text not null default ''
  check (length(evidence) <= 10000);

-- Substitui a função de rascunho por uma versão com os novos campos (opcionais).
drop function if exists public.save_request_draft(uuid, text, text, date, date, text);
create or replace function public.save_request_draft(
  p_request uuid, p_reflection text, p_experiences text, p_period_start date, p_period_end date, p_approximate_date text,
  p_context text default null, p_evidence text default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status <> 'rascunho' then
    raise exception 'O pedido já foi submetido. Para alterar o conteúdo, retira-o ou cria uma nova versão.';
  end if;
  update public.trail_request_versions
     set reflection = left(coalesce(p_reflection, ''), 10000),
         experiences = left(coalesce(p_experiences, ''), 10000),
         context = case when p_context is null then context else left(p_context, 10000) end,
         evidence = case when p_evidence is null then evidence else left(p_evidence, 10000) end,
         period_start = p_period_start, period_end = p_period_end,
         approximate_date = nullif(left(trim(coalesce(p_approximate_date, '')), 100), ''),
         updated_at = now()
   where request_id = p_request and version_no = v_r.current_version and submitted_at is null;
  update public.trail_requests set updated_at = now() where id = p_request;
end
$$;

-- Nova versão (retirar / após devolução) copia também os novos campos.
create or replace function private.new_draft_version(p_request uuid, p_from integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_new uuid; v_old uuid;
begin
  select id into v_old from public.trail_request_versions where request_id = p_request and version_no = p_from;
  insert into public.trail_request_versions (request_id, version_no, reflection, experiences, context, evidence, period_start, period_end, approximate_date)
  select request_id, p_from + 1, reflection, experiences, context, evidence, period_start, period_end, approximate_date
    from public.trail_request_versions where id = v_old
  returning id into v_new;
  insert into public.attachments (request_id, version_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  select request_id, v_new, storage_path, file_name, mime_type, size_bytes, uploaded_by
    from public.attachments where version_id = v_old;
  update public.trail_requests set current_version = p_from + 1, status = 'rascunho', updated_at = now() where id = p_request;
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on function private.new_draft_version(uuid, integer) from public, anon, authenticated;


-- ===== 20261016000100_entrada_equipa.sql =====
-- Pioneiros — entrada com equipa indicada pelo próprio e edição do perfil pela administração.
--
-- Quem pede entrada indica o nome (no registo) e a equipa a que pertence. É só uma indicação:
-- a administração confirma (ou corrige) a equipa e atribui a função ao aprovar, e pode alterar
-- depois o nome, a equipa e a função de qualquer membro. A função nunca é escolhida pelo próprio.

alter table public.memberships
  add column if not exists requested_team_id uuid references public.teams (id) on delete set null;

-- Equipas (não arquivadas) das secções onde o utilizador tem um pedido de entrada pendente.
-- Quem está pendente ainda não lê a tabela de equipas (RLS); esta função mostra só nomes.
create or replace function public.join_team_options()
returns table (membership_id uuid, section_id uuid, team_id uuid, team_name text)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.section_id, t.id, t.name
    from public.memberships m
    join public.teams t on t.section_id = m.section_id and t.archived_at is null
   where m.profile_id = auth.uid() and m.status = 'pendente'
   order by t.name
$$;

-- O próprio indica (ou muda) a equipa enquanto o pedido está pendente.
create or replace function public.set_requested_team(p_membership uuid, p_team uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null or v_m.profile_id is distinct from auth.uid() then
    raise exception 'Pedido não encontrado.' using errcode = '42501';
  end if;
  if v_m.status <> 'pendente' then
    raise exception 'A equipa já foi confirmada pela administração. Para mudar, fala com a administração.';
  end if;
  if p_team is not null and not exists (
    select 1 from public.teams t where t.id = p_team and t.section_id = v_m.section_id and t.archived_at is null
  ) then
    raise exception 'Equipa inválida.';
  end if;
  update public.memberships set requested_team_id = p_team, updated_at = now() where id = p_membership;
end
$$;

-- A administração altera o nome (e o totem) de um membro da sua secção. Fica no registo.
create or replace function public.admin_update_profile(p_membership uuid, p_full_name text, p_totem text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership;
  if v_m.id is null or not private.is_admin(v_m.section_id) then
    raise exception 'Inscrição não encontrada.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_full_name, ''))) = 0 then raise exception 'Indica o nome.'; end if;
  update public.profiles
     set full_name = left(trim(p_full_name), 200),
         totem = nullif(left(trim(coalesce(p_totem, '')), 120), ''),
         updated_at = now()
   where id = v_m.profile_id;
  perform private.audit(v_m.section_id, 'perfil_alterado', 'membership', p_membership::text,
    jsonb_build_object('full_name', left(trim(p_full_name), 200)));
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;


-- ===== 20261017000100_convites_curtos.sql =====
-- Pioneiros — convites com código curto (ex.: «AB7K-9M2P»).
--
-- • Os identificadores internos (UUID) mantêm-se; o código é um valor separado,
--   aleatório, gerado no servidor (gen_random_bytes) com verificação de unicidade.
-- • Alfabeto sem caracteres confundíveis (sem O/0, I/1/L): 31 símbolos, 8 caracteres.
-- • Aceita o código com ou sem hífen, espaços e maiúsculas/minúsculas.
-- • Cada tentativa falhada fica registada; ao fim de 8 falhas em 15 minutos a conta
--   fica impedida de tentar durante esse período (impede adivinhar códigos).
-- • O convite só cria um pedido de entrada pendente; nunca concede funções nem
--   permissões. Um convite pode indicar a equipa de destino (é só uma indicação:
--   a administração confirma ao aprovar).
-- • Os convites antigos (código longo, só com hash guardado) continuam a funcionar.

alter table public.invites
  add column if not exists code text unique check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
  add column if not exists team_id uuid references public.teams (id) on delete set null,
  add column if not exists replaced_by uuid references public.invites (id) on delete set null;

-- Tentativas de usar convites (para limitar a adivinhação). Só o servidor lê.
create table if not exists private.invite_attempts (
  id bigint generated always as identity primary key,
  profile_id uuid not null,
  attempted_at timestamptz not null default now(),
  ok boolean not null
);
create index if not exists invite_attempts_recent on private.invite_attempts (profile_id, attempted_at desc);

create or replace function private.invite_code_normalize(p_code text)
returns text language sql immutable set search_path = ''
as $$ select upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')) $$;

create or replace function private.invite_code_new()
returns text language plpgsql volatile set search_path = ''
as $$
declare
  v_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
  i int;
begin
  for attempt in 1..20 loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      -- 248 = 31 × 8: rejeita os bytes acima para não enviesar a distribuição
      while get_byte(v_bytes, i) >= 248 loop
        v_bytes := set_byte(v_bytes, i, get_byte(extensions.gen_random_bytes(1), 0));
      end loop;
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 31) + 1, 1);
    end loop;
    if not exists (select 1 from public.invites where code = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'Não foi possível gerar um código único. Tenta de novo.';
end
$$;

create or replace function private.invite_format(p_code text)
returns text language sql immutable set search_path = ''
as $$ select case when p_code is null then null else substr(p_code, 1, 4) || '-' || substr(p_code, 5, 4) end $$;

-- Falhas recentes da conta (janela de 15 minutos).
create or replace function private.invite_blocked()
returns boolean language sql stable security definer set search_path = ''
as $$
  select count(*) >= 8 from private.invite_attempts
   where profile_id = auth.uid() and not ok and attempted_at > now() - interval '15 minutes'
$$;

-- Procura o convite (código curto ou código antigo) sem revelar nada a quem não o tem.
create or replace function private.invite_lookup(p_code text, p_lock boolean)
returns public.invites language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_norm text := private.invite_code_normalize(p_code);
  v_inv public.invites;
begin
  if v_norm ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$' then
    if p_lock then select * into v_inv from public.invites where code = v_norm for update;
    else select * into v_inv from public.invites where code = v_norm; end if;
  elsif length(trim(coalesce(p_code, ''))) > 8 then
    -- convites antigos: só o hash do código longo está guardado
    if p_lock then select * into v_inv from public.invites where token_hash = extensions.digest(trim(p_code), 'sha256') for update;
    else select * into v_inv from public.invites where token_hash = extensions.digest(trim(p_code), 'sha256'); end if;
  end if;
  return v_inv;
end
$$;

create or replace function private.invite_problem(v_inv public.invites)
returns text language sql stable set search_path = ''
as $$
  select case
    when v_inv.id is null then 'Código de convite inválido. Confirma as letras e os números.'
    when v_inv.revoked_at is not null then 'Este convite foi revogado. Pede um convite novo à tua secção.'
    when v_inv.expires_at <= now() then 'Este convite expirou. Pede um convite novo à tua secção.'
    when v_inv.use_count >= v_inv.max_uses then 'Este convite já atingiu o limite de utilizações.'
  end
$$;

-- Destino do convite, para confirmar antes de entrar. Não altera nada.
create or replace function public.invite_preview(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_inv public.invites;
  v_problem text;
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'Tens de entrar na tua conta primeiro.' using errcode = '42501'; end if;
  if private.invite_blocked() then
    return jsonb_build_object('ok', false, 'error', 'Demasiadas tentativas. Aguarda 15 minutos e tenta de novo.');
  end if;
  v_inv := private.invite_lookup(p_code, false);
  v_problem := private.invite_problem(v_inv);
  insert into private.invite_attempts (profile_id, ok) values (auth.uid(), v_inv.id is not null);
  if v_problem is not null then return jsonb_build_object('ok', false, 'error', v_problem); end if;
  select jsonb_build_object(
    'ok', true,
    'section', s.name,
    'group', g.name,
    'team', t.name,
    'expires_at', v_inv.expires_at,
    'already', exists (select 1 from public.memberships m where m.profile_id = auth.uid() and m.section_id = v_inv.section_id and m.status in ('pendente', 'ativo'))
  ) into v_out
  from public.sections s
  left join public.groups g on g.id = s.group_id
  left join public.teams t on t.id = v_inv.team_id
  where s.id = v_inv.section_id;
  return v_out;
end
$$;

-- Entrada com convite: devolve {ok, membership_id} ou {ok:false, error}. As falhas não
-- lançam exceção, para que a tentativa fique registada (limite contra adivinhação).
create or replace function public.join_section(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_inv public.invites;
  v_problem text;
  v_existing public.memberships;
  v_membership uuid;
begin
  if auth.uid() is null then raise exception 'Tens de entrar na tua conta primeiro.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'Perfil não encontrado.');
  end if;
  if private.invite_blocked() then
    return jsonb_build_object('ok', false, 'error', 'Demasiadas tentativas. Aguarda 15 minutos e tenta de novo.');
  end if;

  v_inv := private.invite_lookup(p_code, true); -- bloqueia a linha: consumo atómico
  v_problem := private.invite_problem(v_inv);
  if v_problem is not null then
    insert into private.invite_attempts (profile_id, ok) values (auth.uid(), v_inv.id is not null);
    return jsonb_build_object('ok', false, 'error', v_problem);
  end if;

  select * into v_existing from public.memberships
   where profile_id = auth.uid() and section_id = v_inv.section_id for update;
  if v_existing.id is not null and v_existing.status in ('pendente', 'ativo') then
    return jsonb_build_object('ok', false, 'error', 'Já tens um pedido ou acesso nesta secção.');
  elsif v_existing.id is not null and v_existing.status = 'suspenso' then
    return jsonb_build_object('ok', false, 'error', 'O teu acesso a esta secção está suspenso. Fala com a administração.');
  end if;
  if exists (select 1 from public.invite_redemptions where invite_id = v_inv.id and profile_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'Já usaste este convite.');
  end if;

  if v_existing.id is not null then
    -- Regresso de quem saiu: volta a pendente, sem função nem permissões.
    perform set_config('pioneiros.reason', 'Novo pedido de entrada por convite', true);
    update public.memberships
       set status = 'pendente', function = null, is_admin = false, team_id = null, requested_team_id = v_inv.team_id,
           invite_id = v_inv.id, requested_at = now(), approved_by = null, approved_at = null
     where id = v_existing.id;
    v_membership := v_existing.id;
  else
    perform set_config('pioneiros.reason', 'Pedido de entrada por convite', true);
    insert into public.memberships (profile_id, section_id, status, invite_id, requested_team_id)
    values (auth.uid(), v_inv.section_id, 'pendente', v_inv.id, v_inv.team_id)
    returning id into v_membership;
  end if;

  insert into public.invite_redemptions (invite_id, profile_id, membership_id) values (v_inv.id, auth.uid(), v_membership);
  update public.invites set use_count = use_count + 1 where id = v_inv.id;
  insert into private.invite_attempts (profile_id, ok) values (auth.uid(), true);

  perform private.notify(private.section_admins(v_inv.section_id), v_inv.section_id, 'pedido_entrada',
    'Novo pedido de entrada', 'Há um novo pedido de entrada na secção a aguardar confirmação.', '/gestao/membros');
  return jsonb_build_object('ok', true, 'membership_id', v_membership);
end
$$;

-- O caminho antigo deixa de estar disponível: as falhas lançavam exceção e não
-- ficavam registadas, o que permitiria contornar o limite de tentativas.
drop function if exists public.redeem_invite(text);

-- Criar convite: devolve o código formatado («AB7K-9M2P»).
drop function if exists public.create_invite(uuid, text, timestamptz, integer);
create or replace function public.create_invite(p_section uuid, p_label text, p_expires_at timestamptz, p_max_uses integer, p_team uuid default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_code text;
begin
  if not private.is_admin(p_section) then
    raise exception 'Só administradores podem criar convites.' using errcode = '42501';
  end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'A validade tem de ser uma data futura.'; end if;
  if p_expires_at > now() + interval '180 days' then raise exception 'A validade máxima é de 180 dias.'; end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 500 then raise exception 'O limite de utilizações deve estar entre 1 e 500.'; end if;
  if p_team is not null and not exists (select 1 from public.teams where id = p_team and section_id = p_section and archived_at is null) then
    raise exception 'Equipa inválida.';
  end if;
  v_code := private.invite_code_new();
  insert into public.invites (section_id, token_hash, code, team_id, label, expires_at, max_uses, created_by)
  values (p_section, extensions.digest(v_code, 'sha256'), v_code, p_team, left(coalesce(trim(p_label), ''), 200), p_expires_at, p_max_uses, auth.uid());
  perform private.audit(p_section, 'convite_criado', 'invite', null,
    jsonb_build_object('label', p_label, 'expires_at', p_expires_at, 'max_uses', p_max_uses, 'team_id', p_team));
  return private.invite_format(v_code);
end
$$;

-- Gerar um convite novo com as mesmas condições e revogar o anterior.
create or replace function public.regenerate_invite(p_invite uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.invites;
  v_code text;
  v_new uuid;
begin
  select * into v_old from public.invites where id = p_invite for update;
  if v_old.id is null or not private.is_admin(v_old.section_id) then
    raise exception 'Convite não encontrado.' using errcode = '42501';
  end if;
  v_code := private.invite_code_new();
  insert into public.invites (section_id, token_hash, code, team_id, label, expires_at, max_uses, created_by)
  values (v_old.section_id, extensions.digest(v_code, 'sha256'), v_code, v_old.team_id, v_old.label,
          greatest(v_old.expires_at, now() + interval '7 days'), v_old.max_uses, auth.uid())
  returning id into v_new;
  update public.invites set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, auth.uid()), replaced_by = v_new
   where id = p_invite;
  perform private.audit(v_old.section_id, 'convite_renovado', 'invite', p_invite::text, jsonb_build_object('novo', v_new));
  return private.invite_format(v_code);
end
$$;

revoke all on table private.invite_attempts from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on function private.invite_code_new() from public, anon, authenticated;
revoke all on function private.invite_lookup(text, boolean) from public, anon, authenticated;
revoke all on function private.invite_blocked() from public, anon, authenticated;


-- ===== 20261017000200_adesao_datas.sql =====
-- Pioneiros — datas da adesão e da Promessa.
--
-- • A Promessa/Investidura acontece depois da decisão sobre a adesão (Manual, pp. 7 e 10).
--   Um registo com a Promessa antes da decisão só é aceite com fundamentação nas notas
--   (por exemplo, um registo retroativo de datas aproximadas).
-- • Um registo de adesão anterior à aplicação (retroativo) exige fundamentação.
-- • A data do acontecimento (decided_on, commitment_on) é distinta da data em que foi
--   registado (recorded_at), que já existe e passa a ser mostrada.
-- • Não altera dados existentes: os registos antigos fora de ordem são assinalados na
--   interface para revisão, nunca corrigidos automaticamente.
create or replace function public.record_adhesion(
  p_membership uuid, p_decided_on date, p_commitment_on date, p_notes text, p_is_historical boolean
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  v_m := private.progress_member(p_membership);
  perform private.assert_dirigente(v_m.section_id);
  if p_decided_on is null then raise exception 'Indica a data da decisão do Conselho de Guias.'; end if;
  if p_decided_on > current_date or p_commitment_on > current_date then raise exception 'As datas não podem ser futuras.'; end if;
  if p_commitment_on is not null and p_commitment_on < p_decided_on and length(trim(coalesce(p_notes, ''))) = 0 then
    raise exception 'A Promessa / Investidura é posterior à decisão sobre a adesão. Corrige as datas ou explica nas notas por que razão o registo é assim.';
  end if;
  if coalesce(p_is_historical, false) and length(trim(coalesce(p_notes, ''))) = 0 then
    raise exception 'Um registo retroativo precisa de fundamentação nas notas.';
  end if;
  insert into public.adhesions (membership_id, decided_on, commitment_on, notes, is_historical, recorded_by)
  values (p_membership, p_decided_on, p_commitment_on, nullif(trim(p_notes), ''), coalesce(p_is_historical, false), auth.uid())
  on conflict (membership_id) do update
    set decided_on = excluded.decided_on, commitment_on = excluded.commitment_on, notes = excluded.notes,
        is_historical = excluded.is_historical, recorded_by = excluded.recorded_by, recorded_at = now();
  perform private.audit(v_m.section_id, 'adesao_registada', 'adhesion', p_membership::text,
    jsonb_build_object('decided_on', p_decided_on, 'commitment_on', p_commitment_on, 'historical', p_is_historical));
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'adesao', 'Adesão registada',
    'A tua adesão (Desprendimento) foi registada.', '/meu-progresso?vista=caminho');
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;


-- ===== 20261018000100_objetivos_tipos.sql =====
-- Pioneiros — pedidos por objetivos (1/2): novos valores de enumeração.
-- Ficam num ficheiro próprio porque um valor novo só pode ser usado depois de
-- a transação que o cria terminar.
--   objetivos_validados: todos os objetivos do pedido foram aceites, mas o trilho
--     ainda tem objetivos por validar (o trilho NÃO fica concluído).
--   objetivos_equipa: decisão da reunião de Equipa com esse resultado.
alter type public.request_status add value if not exists 'objetivos_validados';
alter type public.decision_kind add value if not exists 'objetivos_equipa';


-- ===== 20261018000200_objetivos.sql =====
-- Pioneiros — pedidos por objetivos (2/2).
-- O pioneiro escolhe, dentro de um trilho, os objetivos que considera ter
-- atingido e justifica-os num texto comum. A reunião de Equipa decide cada
-- objetivo (aceite / a rever, com comentário). O trilho só fica «Validado»
-- quando todos os seus objetivos oficiais estiverem aceites; aceitar um
-- objetivo não conclui o trilho. As regras de fecho da etapa não mudam
-- (continuam a depender de trilhos validados).
-- Aditivo: os pedidos antigos (por trilho, sem objetivos) continuam a ser
-- decididos como antes e não são reinterpretados.

create table if not exists public.request_objectives (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.trail_requests (id) on delete cascade,
  version_id uuid not null references public.trail_request_versions (id) on delete cascade,
  objective_id uuid not null references public.catalog_objectives (id),
  objective_code text not null,
  decision text check (decision in ('aceite', 'rever')),
  comment text check (comment is null or length(comment) <= 4000),
  decided_by uuid,
  decided_at timestamptz,
  unique (version_id, objective_id),
  check ((decision is null) = (decided_at is null))
);
create index if not exists request_objectives_request on public.request_objectives (request_id);

alter table public.request_objectives enable row level security;
revoke all on public.request_objectives from anon, authenticated;
grant select on public.request_objectives to authenticated;
drop policy if exists request_objectives_select on public.request_objectives;
create policy request_objectives_select on public.request_objectives for select to authenticated
  using (private.can_view_progress(private.request_membership(request_id)));

-- Um pedido cujos objetivos foram todos aceites sem fechar o trilho deixa de
-- ser «ativo»: pode seguir-se outro pedido para os restantes objetivos.
-- (A condição lista os estados ativos em vez do novo: na instalação completa,
-- que corre numa só transação, o valor novo do enum ainda não pode ser usado.)
drop index if exists public.trail_requests_one_active;
create unique index trail_requests_one_active on public.trail_requests (membership_id, trail_key)
  where status in ('rascunho', 'submetido', 'em_revisao', 'validado_equipa', 'devolvido', 'aprovado');
-- Uma decisão por versão: record_objectives_decision bloqueia o pedido (for update)
-- e só decide pedidos «submetido»/«em_revisao» — a decisão muda logo o estado.

-- Objetivos já aceites de um membro (em pedidos que não foram cancelados).
create or replace function private.accepted_objectives(p_membership uuid)
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select distinct ro.objective_id
    from public.request_objectives ro join public.trail_requests r on r.id = ro.request_id
   where r.membership_id = p_membership and ro.decision = 'aceite' and r.status not in ('cancelado', 'recusado')
$$;

-- Enviar para validação: guarda os objetivos escolhidos e a justificação na
-- versão em rascunho e submete. Não fecha objetivos, trilhos nem etapas.
create or replace function public.submit_objectives_request(
  p_request uuid, p_expected_version integer, p_objectives uuid[], p_justification text
) returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.trail_requests; v_v public.trail_request_versions; v_m public.memberships; v_trail text;
  v_ids uuid[]; v_bad integer;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.kind <> 'normal' then raise exception 'Este pedido não é por objetivos.'; end if;
  if v_r.status <> 'rascunho' then raise exception 'Este pedido já foi enviado. Atualiza a página.'; end if;
  if p_expected_version is distinct from v_r.current_version then raise exception 'O pedido mudou entretanto. Atualiza a página.'; end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_objectives, '{}')) x where x is not null;
  if coalesce(cardinality(v_ids), 0) = 0 then raise exception 'Escolhe pelo menos um objetivo.'; end if;
  select count(*) into v_bad from unnest(v_ids) x
   where not exists (select 1 from public.catalog_objectives o where o.id = x and o.trail_id = v_r.trail_id);
  if v_bad > 0 then raise exception 'Há objetivos que não pertencem a este trilho.'; end if;
  if exists (select 1 from unnest(v_ids) x where x in (select private.accepted_objectives(v_r.membership_id))) then
    raise exception 'Há objetivos que já estão validados. Atualiza a página.';
  end if;
  perform private.require_text(p_justification, 'Explica como demonstraste que atingiste estes objetivos.');
  if length(p_justification) > 10000 then raise exception 'A justificação é demasiado longa.'; end if;

  select * into v_v from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  delete from public.request_objectives where version_id = v_v.id;
  insert into public.request_objectives (request_id, version_id, objective_id, objective_code)
  select p_request, v_v.id, o.id, o.code from public.catalog_objectives o where o.id = any (v_ids);
  update public.trail_request_versions
     set evidence = trim(p_justification), submitted_at = now(), updated_at = now()
   where id = v_v.id;
  update public.trail_requests set status = 'submetido', updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  perform private.notify(private.team_guias(v_m.team_id) || case when v_m.function = 'guia'
           then private.section_dirigentes(v_m.section_id) else '{}'::uuid[] end,
    v_m.section_id, 'pedido_submetido', 'Novo pedido de validação',
    'Pedido de validação de objetivos do trilho ' || v_trail || ' para a próxima reunião de Equipa.', '/revisoes/pedido/' || p_request);
end
$$;

-- Os pedidos por objetivos são enviados com submit_objectives_request (que exige a justificação).
create or replace function public.submit_trail_request(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_v public.trail_request_versions; v_m public.memberships; v_trail text;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status <> 'rascunho' then raise exception 'Este pedido não está em rascunho.'; end if;
  if v_r.kind = 'historico' and not private.historical_enabled(v_r.section_id) then
    raise exception 'O registo de progresso anterior foi desativado. Podes cancelar este pedido e usar o progresso normal, ou aguardar a reativação.';
  end if;
  select * into v_v from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  if exists (select 1 from public.request_objectives where request_id = p_request) then
    raise exception 'Este pedido é por objetivos: escolhe os objetivos e envia a justificação.';
  end if;
  if length(trim(v_v.reflection)) = 0 then raise exception 'Escreve a tua reflexão antes de submeter.'; end if;
  if v_v.period_end > current_date + 1 then raise exception 'As datas das vivências não podem ser futuras.'; end if;
  update public.trail_request_versions set submitted_at = now() where id = v_v.id;
  update public.trail_requests set status = 'submetido', updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  if v_r.kind = 'normal' then
    perform private.notify(private.team_guias(v_m.team_id) || case when v_m.function = 'guia'
             then private.section_dirigentes(v_m.section_id) else '{}'::uuid[] end,
      v_m.section_id, 'pedido_submetido', 'Novo pedido de validação',
      'Pedido de validação do trilho ' || v_trail || ' para a próxima reunião de Equipa.', '/revisoes/pedido/' || p_request);
  else
    perform private.notify(private.section_dirigentes(v_m.section_id), v_m.section_id, 'pedido_historico',
      'Progresso anterior', 'Novo pedido de progresso anterior: ' || v_trail || '.', '/revisoes/pedido/' || p_request);
  end if;
end
$$;

-- Nova versão (retirar / corrigir após «A rever»): copia o texto, os anexos e
-- os objetivos que ainda não foram aceites. Os aceites ficam na versão anterior.
create or replace function private.new_draft_version(p_request uuid, p_from integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_new uuid; v_old uuid;
begin
  select id into v_old from public.trail_request_versions where request_id = p_request and version_no = p_from;
  insert into public.trail_request_versions (request_id, version_no, reflection, experiences, context, evidence, period_start, period_end, approximate_date)
  select request_id, p_from + 1, reflection, experiences, context, evidence, period_start, period_end, approximate_date
    from public.trail_request_versions where id = v_old
  returning id into v_new;
  insert into public.attachments (request_id, version_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  select request_id, v_new, storage_path, file_name, mime_type, size_bytes, uploaded_by
    from public.attachments where version_id = v_old;
  insert into public.request_objectives (request_id, version_id, objective_id, objective_code)
  select request_id, v_new, objective_id, objective_code
    from public.request_objectives where version_id = v_old and decision is distinct from 'aceite';
  update public.trail_requests set current_version = p_from + 1, status = 'rascunho', updated_at = now() where id = p_request;
end
$$;

-- Cancelar: se já houver objetivos aceites neste pedido, esses mantêm-se
-- (o pedido fica como «objetivos validados»); o resto é abandonado.
create or replace function public.cancel_trail_request(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status not in ('rascunho', 'submetido', 'em_revisao', 'devolvido') then
    raise exception 'Este pedido já foi decidido e não pode ser cancelado.';
  end if;
  if exists (select 1 from public.request_objectives where request_id = p_request and decision = 'aceite') then
    update public.trail_requests set status = 'objetivos_validados', updated_at = now() where id = p_request;
  else
    update public.trail_requests set status = 'cancelado', updated_at = now() where id = p_request;
  end if;
end
$$;

-- Decisão da reunião de Equipa objetivo a objetivo.
-- p_decisions: [{"objective_id": "...", "accepted": true|false, "comment": "..."}]
-- Todos os objetivos da versão têm de ser decididos; «a rever» exige comentário
-- (no objetivo ou geral). Resultado:
--   algum a rever                         → pedido «devolvido» (A rever)
--   todos aceites e trilho completo       → «validado_equipa» (trilho validado)
--   todos aceites, trilho ainda incompleto→ «objetivos_validados»
create or replace function public.record_objectives_decision(
  p_request uuid, p_expected_version integer, p_meeting_date date, p_decisions jsonb, p_comment text
) returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.trail_requests; v_role text; v_version uuid; v_m public.memberships; v_trail text;
  v_d record; v_total integer; v_given integer; v_review integer; v_missing integer; v_status text; v_kind text;
  v_codes_ok text; v_codes_rev text;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  if v_r.kind <> 'normal' then raise exception 'Pedidos de progresso anterior são decididos pelos dirigentes.'; end if;
  v_role := private.team_recorder_role(v_r);
  if v_role is null then
    raise exception 'Sem permissão para registar a decisão deste pedido (não é possível decidir o próprio pedido).' using errcode = '42501';
  end if;
  if v_r.status not in ('submetido', 'em_revisao') then raise exception 'Este pedido já foi decidido ou não está submetido.'; end if;
  if p_expected_version is distinct from v_r.current_version then raise exception 'O pedido mudou entretanto. Atualiza a página.'; end if;
  if p_meeting_date is null or p_meeting_date > current_date then raise exception 'Indica a data da reunião de Equipa.'; end if;
  -- Serializa decisões sobre o mesmo membro (dois pedidos do mesmo trilho em paralelo).
  perform 1 from public.memberships where id = v_r.membership_id for update;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  select count(*) into v_total from public.request_objectives where version_id = v_version;
  if v_total = 0 then raise exception 'Este pedido não tem objetivos: regista a decisão do trilho.'; end if;
  if jsonb_typeof(p_decisions) is distinct from 'array' then raise exception 'Decisões inválidas.'; end if;

  v_given := 0; v_review := 0;
  for v_d in
    select (e ->> 'objective_id')::uuid as objective_id, coalesce((e ->> 'accepted')::boolean, false) as accepted,
           nullif(trim(coalesce(e ->> 'comment', '')), '') as comment
      from jsonb_array_elements(p_decisions) e
  loop
    if not exists (select 1 from public.request_objectives where version_id = v_version and objective_id = v_d.objective_id) then
      raise exception 'Há uma decisão para um objetivo que não está neste pedido.';
    end if;
    if v_d.comment is not null and length(v_d.comment) > 4000 then raise exception 'Comentário demasiado longo.'; end if;
    if not v_d.accepted and v_d.comment is null and nullif(trim(coalesce(p_comment, '')), '') is null then
      raise exception 'Explica o que falta trabalhar nos objetivos a rever.';
    end if;
    update public.request_objectives
       set decision = case when v_d.accepted then 'aceite' else 'rever' end,
           comment = v_d.comment, decided_by = auth.uid(), decided_at = now()
     where version_id = v_version and objective_id = v_d.objective_id and decision is null;
    if not found then raise exception 'O mesmo objetivo foi decidido duas vezes.'; end if;
    v_given := v_given + 1;
    if not v_d.accepted then v_review := v_review + 1; end if;
  end loop;
  if v_given <> v_total then raise exception 'Decide todos os objetivos do pedido (aceite ou a rever).'; end if;

  select count(*) into v_missing from public.catalog_objectives o
   where o.trail_id = v_r.trail_id and o.id not in (select private.accepted_objectives(v_r.membership_id));
  if v_review > 0 then v_status := 'devolvido'; v_kind := 'devolvido_equipa';
  elsif v_missing = 0 then v_status := 'validado_equipa'; v_kind := 'validado_equipa';
  else v_status := 'objetivos_validados'; v_kind := 'objetivos_equipa';
  end if;

  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, recorded_by, recorded_as)
  values (p_request, v_version, v_kind::public.decision_kind, p_meeting_date, nullif(trim(p_comment), ''), auth.uid(), v_role);
  update public.trail_requests set status = v_status::public.request_status, updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  select string_agg(objective_code, ', ' order by objective_code) filter (where decision = 'aceite'),
         string_agg(objective_code, ', ' order by objective_code) filter (where decision = 'rever')
    into v_codes_ok, v_codes_rev
    from public.request_objectives where version_id = v_version;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'decisao_equipa',
    case v_status when 'validado_equipa' then 'Trilho validado na Equipa'
                  when 'objetivos_validados' then 'Objetivos validados na Equipa'
                  else 'Pedido a rever' end,
    v_trail || coalesce(' · aceites: ' || v_codes_ok, '') || coalesce(' · a rever: ' || v_codes_rev, ''), '/pedidos/' || p_request);
  perform private.notify(private.section_dirigentes(v_m.section_id) || private.section_guias(v_m.section_id), v_m.section_id,
    'comunicacao_conselho', 'Comunicação ao Conselho de Guias',
    'Decisão da reunião de Equipa sobre o trilho ' || v_trail || '.', '/conselho');
  return v_status;
exception when unique_violation then
  raise exception 'Já foi registada uma decisão para esta versão do pedido.';
end
$$;

-- A decisão por trilho mantém-se para os pedidos antigos (sem objetivos).
create or replace function public.record_team_decision(
  p_request uuid, p_expected_version integer, p_validated boolean, p_meeting_date date, p_comment text
) returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.trail_requests; v_role text; v_version uuid; v_m public.memberships; v_trail text;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  if v_r.kind <> 'normal' then raise exception 'Pedidos de progresso anterior são decididos pelos dirigentes.'; end if;
  v_role := private.team_recorder_role(v_r);
  if v_role is null then
    raise exception 'Sem permissão para registar a decisão deste pedido (não é possível decidir o próprio pedido).' using errcode = '42501';
  end if;
  if v_r.status not in ('submetido', 'em_revisao') then
    raise exception 'Este pedido já foi decidido ou não está submetido.';
  end if;
  if p_expected_version is distinct from v_r.current_version then
    raise exception 'O pedido mudou entretanto. Atualiza a página.';
  end if;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  if exists (select 1 from public.request_objectives where version_id = v_version) then
    raise exception 'Este pedido é por objetivos: decide cada objetivo.';
  end if;
  if p_meeting_date is null or p_meeting_date > current_date then raise exception 'Indica a data da reunião de Equipa.'; end if;
  if not p_validated then perform private.require_text(p_comment, 'Explica o que falta trabalhar.'); end if;
  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, recorded_by, recorded_as)
  values (p_request, v_version, case when p_validated then 'validado_equipa' else 'devolvido_equipa' end::public.decision_kind,
          p_meeting_date, nullif(trim(p_comment), ''), auth.uid(), v_role);
  update public.trail_requests set status = case when p_validated then 'validado_equipa' else 'devolvido' end::public.request_status,
         updated_at = now()
   where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'decisao_equipa',
    case when p_validated then 'Trilho validado na Equipa' else 'Pedido devolvido para continuar a trabalhar' end,
    v_trail || coalesce(': ' || nullif(trim(p_comment), ''), ''), '/pedidos/' || p_request);
  perform private.notify(private.section_dirigentes(v_m.section_id) || private.section_guias(v_m.section_id), v_m.section_id,
    'comunicacao_conselho', 'Comunicação ao Conselho de Guias',
    'Decisão da reunião de Equipa sobre o trilho ' || v_trail || '.', '/conselho');
exception when unique_violation then
  raise exception 'Já foi registada uma decisão para esta versão do pedido.';
end
$$;

-- Devolução fundamentada pelo Conselho de Guias: os objetivos aceites nesta versão
-- voltam a «a rever» (a decisão da Equipa fica no histórico de decisões).
create or replace function public.record_council_return(p_request uuid, p_meeting_date date, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_m public.memberships; v_version uuid;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_r.section_id);
  if private.is_owner(v_r.membership_id) then raise exception 'Não é possível decidir o próprio pedido.' using errcode = '42501'; end if;
  if v_r.status <> 'validado_equipa' then raise exception 'Só trilhos validados na Equipa podem ser devolvidos pelo Conselho de Guias.'; end if;
  perform private.require_text(p_comment, 'A devolução tem de ser fundamentada.');
  if p_meeting_date is null or p_meeting_date > current_date then raise exception 'Indica a data do Conselho de Guias.'; end if;
  -- Regra local L3: não reabrir trilhos de etapas concluídas.
  if exists (select 1 from public.stage_choices c join public.stage_paths p on p.id = c.stage_path_id
              where c.membership_id = v_r.membership_id and c.trail_key = v_r.trail_key
                and c.status = 'confirmada' and p.status = 'concluida') then
    raise exception 'Este trilho faz parte de uma etapa já concluída.';
  end if;
  if exists (select 1 from public.stage_choices c join public.stage_requests sr on sr.stage_path_id = c.stage_path_id
              where c.membership_id = v_r.membership_id and c.trail_key = v_r.trail_key and c.status = 'confirmada'
                and sr.status in ('submetido', 'decidido_conselho')) then
    raise exception 'A etapa deste trilho está em validação. Regista a decisão da etapa primeiro.';
  end if;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, recorded_by, recorded_as)
  values (p_request, v_version, 'devolvido_conselho', p_meeting_date, trim(p_comment), auth.uid(), 'dirigente');
  update public.request_objectives
     set decision = 'rever', comment = left('Conselho de Guias: ' || trim(p_comment), 4000), decided_by = auth.uid(), decided_at = now()
   where version_id = v_version and decision = 'aceite';
  update public.trail_requests set status = 'devolvido', updated_at = now() where id = p_request;
  select * into v_m from public.memberships where id = v_r.membership_id;
  perform private.notify(array[v_m.profile_id] || private.team_guias(v_m.team_id), v_m.section_id, 'devolucao_conselho',
    'Trilho devolvido pelo Conselho de Guias', trim(p_comment), '/pedidos/' || p_request);
end
$$;


revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on function private.new_draft_version(uuid, integer) from public, anon, authenticated;
notify pgrst, 'reload schema';


-- ===== 20261019000100_trilhos_notificacoes.sql =====
-- Pioneiros — fecho por trilho, remoção de notificações e ligações atuais.
--
-- 1. A unidade de validação volta a ser o TRILHO. O pedido abrange o trilho e
--    todos os seus objetivos, com uma justificação conjunta; a reunião de
--    Equipa valida o trilho ou devolve-o para revisão (com fundamentação, que
--    pode indicar os objetivos ainda por demonstrar). Isto substitui a
--    validação formal objetivo a objetivo.
--    Os dados por objetivo já registados ficam como HISTÓRICO: não são apagados
--    nem convertidos em trilhos validados. Um pedido «objetivos_validados»
--    continua inativo e o trilho continua «Por fechar» até a reunião de
--    Equipa validar o trilho completo.
-- 2. Notificações: remoção recuperável (deleted_at), só do próprio
--    destinatário, sem tocar em pedidos, decisões ou histórico.
-- 3. O mesmo evento não é criado duas vezes para o mesmo destinatário e as
--    ligações das notificações apontam para as rotas atuais.
-- Aditivo: não apaga registos; as chamadas antigas continuam válidas ou
-- devolvem uma mensagem clara.

-- ---------------------------------------------------------------------------
-- 1. Pedido e decisão por trilho
-- ---------------------------------------------------------------------------

-- Objetivos que a fundamentação de uma devolução identifica como ainda por
-- demonstrar (só informativo: a decisão formal é sobre o trilho completo).
alter table public.trail_decisions add column if not exists objective_codes text[];

-- Pedir validação do trilho: guarda a justificação conjunta na versão em
-- rascunho e envia. Não fecha o trilho nem a etapa.
create or replace function public.submit_trail_validation(
  p_request uuid, p_expected_version integer, p_justification text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_v public.trail_request_versions; v_m public.memberships; v_trail text;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.kind <> 'normal' then raise exception 'Este pedido não é um pedido de validação de trilho.'; end if;
  if v_r.status <> 'rascunho' then raise exception 'Este pedido já foi enviado. Atualiza a página.'; end if;
  if p_expected_version is distinct from v_r.current_version then raise exception 'O pedido mudou entretanto. Atualiza a página.'; end if;
  perform private.require_text(p_justification, 'Explica como demonstraste que alcançaste este trilho.');
  if length(p_justification) > 10000 then raise exception 'A justificação é demasiado longa.'; end if;

  select * into v_v from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  -- Seleções por objetivo ainda sem decisão nesta versão (modelo anterior) não
  -- são decisões: o pedido passa a abranger o trilho completo.
  delete from public.request_objectives where version_id = v_v.id and decision is null;
  update public.trail_request_versions
     set evidence = trim(p_justification), submitted_at = now(), updated_at = now()
   where id = v_v.id;
  update public.trail_requests set status = 'submetido', updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  perform private.notify(private.team_guias(v_m.team_id) || case when v_m.function = 'guia'
           then private.section_dirigentes(v_m.section_id) else '{}'::uuid[] end,
    v_m.section_id, 'pedido_submetido', 'Novo pedido de validação',
    'Pedido de validação do trilho ' || v_trail || ' para a próxima reunião de Equipa.', '/revisoes/pedido/' || p_request);
end
$$;

-- O envio por objetivos foi substituído pelo pedido do trilho completo.
create or replace function public.submit_objectives_request(
  p_request uuid, p_expected_version integer, p_objectives uuid[], p_justification text
) returns void language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'A validação é feita por trilho completo. Atualiza a página e usa «Pedir validação do trilho».';
end
$$;

create or replace function public.record_objectives_decision(
  p_request uuid, p_expected_version integer, p_meeting_date date, p_decisions jsonb, p_comment text
) returns text language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'A decisão é sobre o trilho completo. Atualiza a página para validar o trilho ou devolvê-lo para revisão.';
end
$$;

-- Submissão com os campos de reflexão (progresso anterior e pedidos antigos).
create or replace function public.submit_trail_request(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_v public.trail_request_versions; v_m public.memberships; v_trail text;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status <> 'rascunho' then raise exception 'Este pedido não está em rascunho.'; end if;
  if v_r.kind = 'historico' and not private.historical_enabled(v_r.section_id) then
    raise exception 'O registo de progresso anterior foi desativado. Podes cancelar este pedido e usar o progresso normal, ou aguardar a reativação.';
  end if;
  select * into v_v from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  if length(trim(v_v.reflection)) = 0 and length(trim(v_v.evidence)) = 0 then
    raise exception 'Escreve a tua reflexão antes de submeter.';
  end if;
  if v_v.period_end > current_date + 1 then raise exception 'As datas das vivências não podem ser futuras.'; end if;
  delete from public.request_objectives where version_id = v_v.id and decision is null;
  update public.trail_request_versions set submitted_at = now() where id = v_v.id;
  update public.trail_requests set status = 'submetido', updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  if v_r.kind = 'normal' then
    perform private.notify(private.team_guias(v_m.team_id) || case when v_m.function = 'guia'
             then private.section_dirigentes(v_m.section_id) else '{}'::uuid[] end,
      v_m.section_id, 'pedido_submetido', 'Novo pedido de validação',
      'Pedido de validação do trilho ' || v_trail || ' para a próxima reunião de Equipa.', '/revisoes/pedido/' || p_request);
  else
    perform private.notify(private.section_dirigentes(v_m.section_id), v_m.section_id, 'pedido_historico',
      'Progresso anterior', 'Novo pedido de progresso anterior: ' || v_trail || '.', '/revisoes/pedido/' || p_request);
  end if;
end
$$;

-- Nova versão (retirar / corrigir após «A rever»): copia o texto e os anexos.
-- As seleções e decisões por objetivo ficam só nas versões em que foram feitas.
create or replace function private.new_draft_version(p_request uuid, p_from integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_new uuid; v_old uuid;
begin
  select id into v_old from public.trail_request_versions where request_id = p_request and version_no = p_from;
  insert into public.trail_request_versions (request_id, version_no, reflection, experiences, context, evidence, period_start, period_end, approximate_date)
  select request_id, p_from + 1, reflection, experiences, context, evidence, period_start, period_end, approximate_date
    from public.trail_request_versions where id = v_old
  returning id into v_new;
  insert into public.attachments (request_id, version_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  select request_id, v_new, storage_path, file_name, mime_type, size_bytes, uploaded_by
    from public.attachments where version_id = v_old;
  update public.trail_requests set current_version = p_from + 1, status = 'rascunho', updated_at = now() where id = p_request;
end
$$;

-- Cancelar: o pedido fica cancelado; as decisões por objetivo já registadas
-- continuam guardadas como histórico (não fecham o trilho).
create or replace function public.cancel_trail_request(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status not in ('rascunho', 'submetido', 'em_revisao', 'devolvido') then
    raise exception 'Este pedido já foi decidido e não pode ser cancelado.';
  end if;
  update public.trail_requests set status = 'cancelado', updated_at = now() where id = p_request;
end
$$;

-- Decisão da reunião de Equipa sobre o trilho completo: validado, ou a rever
-- com fundamentação (pode identificar objetivos ainda por demonstrar).
-- Um dirigente pode registá-la em nome da reunião (regra L1, ex.: pedido do
-- próprio guia); quando a equipa tem guia, este é avisado do registo.
drop function if exists public.record_team_decision(uuid, integer, boolean, date, text);
create or replace function public.record_team_decision(
  p_request uuid, p_expected_version integer, p_validated boolean, p_meeting_date date, p_comment text,
  p_objective_codes text[] default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.trail_requests; v_role text; v_version uuid; v_m public.memberships; v_trail text; v_codes text[]; v_bad integer;
  v_owner_guias uuid[];
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  if v_r.kind <> 'normal' then raise exception 'Pedidos de progresso anterior são decididos pelos dirigentes.'; end if;
  v_role := private.team_recorder_role(v_r);
  if v_role is null then
    raise exception 'Sem permissão para registar a decisão deste pedido (não é possível decidir o próprio pedido).' using errcode = '42501';
  end if;
  if v_r.status not in ('submetido', 'em_revisao') then raise exception 'Este pedido já foi decidido ou não está submetido.'; end if;
  if p_expected_version is distinct from v_r.current_version then raise exception 'O pedido mudou entretanto. Atualiza a página.'; end if;
  if p_meeting_date is null or p_meeting_date > current_date then raise exception 'Indica a data da reunião de Equipa.'; end if;
  if not coalesce(p_validated, false) then perform private.require_text(p_comment, 'Explica o que falta demonstrar.'); end if;
  if p_comment is not null and length(p_comment) > 4000 then raise exception 'Comentário demasiado longo.'; end if;

  select array_agg(distinct c order by c) into v_codes from unnest(coalesce(p_objective_codes, '{}')) c where nullif(trim(c), '') is not null;
  if v_codes is not null then
    if p_validated then raise exception 'Só uma devolução indica objetivos por demonstrar.'; end if;
    select count(*) into v_bad from unnest(v_codes) c
     where not exists (select 1 from public.catalog_objectives o where o.trail_id = v_r.trail_id and o.code = c);
    if v_bad > 0 then raise exception 'Há objetivos que não pertencem a este trilho.'; end if;
  end if;

  -- Serializa decisões sobre o mesmo membro.
  perform 1 from public.memberships where id = v_r.membership_id for update;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, objective_codes, recorded_by, recorded_as)
  values (p_request, v_version, case when p_validated then 'validado_equipa' else 'devolvido_equipa' end::public.decision_kind,
          p_meeting_date, nullif(trim(p_comment), ''), v_codes, auth.uid(), v_role);
  update public.trail_requests set status = case when p_validated then 'validado_equipa' else 'devolvido' end::public.request_status,
         updated_at = now()
   where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'decisao_equipa',
    case when p_validated then 'Trilho validado na Equipa' else 'Trilho a rever' end,
    v_trail || coalesce(' · por demonstrar: ' || array_to_string(v_codes, ', '), '') || coalesce(': ' || nullif(trim(p_comment), ''), ''),
    '/pedidos/' || p_request);
  -- Comunicação ao Conselho de Guias (sem repetir o aviso ao próprio pioneiro).
  perform private.notify(array(select x from unnest(private.section_dirigentes(v_m.section_id) || private.section_guias(v_m.section_id)) x
                               where x is distinct from v_m.profile_id),
    v_m.section_id, 'comunicacao_conselho', 'Comunicação ao Conselho de Guias',
    'Decisão da reunião de Equipa sobre o trilho ' || v_trail || '.', '/conselho');
  -- Registo por um dirigente: o guia da equipa fica a saber (não substitui a reunião em silêncio).
  if v_role = 'dirigente' then
    v_owner_guias := array(select x from unnest(private.team_guias(v_m.team_id)) x where x is distinct from v_m.profile_id);
    perform private.notify(v_owner_guias, v_m.section_id, 'registo_animacao', 'Decisão registada pela Equipa de Animação',
      'Foi registada, em nome da reunião de Equipa, a decisão sobre o trilho ' || v_trail || '.', '/revisoes/pedido/' || p_request);
  end if;
exception when unique_violation then
  raise exception 'Já foi registada uma decisão para esta versão do pedido.';
end
$$;

-- Devolução fundamentada pelo Conselho de Guias. As decisões por objetivo de
-- versões anteriores ficam como estão (histórico).
create or replace function public.record_council_return(p_request uuid, p_meeting_date date, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_m public.memberships; v_version uuid;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_r.section_id);
  if private.is_owner(v_r.membership_id) then raise exception 'Não é possível decidir o próprio pedido.' using errcode = '42501'; end if;
  if v_r.status <> 'validado_equipa' then raise exception 'Só trilhos validados na Equipa podem ser devolvidos pelo Conselho de Guias.'; end if;
  perform private.require_text(p_comment, 'A devolução tem de ser fundamentada.');
  if p_meeting_date is null or p_meeting_date > current_date then raise exception 'Indica a data do Conselho de Guias.'; end if;
  -- Regra local L3: não reabrir trilhos de etapas concluídas.
  if exists (select 1 from public.stage_choices c join public.stage_paths p on p.id = c.stage_path_id
              where c.membership_id = v_r.membership_id and c.trail_key = v_r.trail_key
                and c.status = 'confirmada' and p.status = 'concluida') then
    raise exception 'Este trilho faz parte de uma etapa já concluída.';
  end if;
  if exists (select 1 from public.stage_choices c join public.stage_requests sr on sr.stage_path_id = c.stage_path_id
              where c.membership_id = v_r.membership_id and c.trail_key = v_r.trail_key and c.status = 'confirmada'
                and sr.status in ('submetido', 'decidido_conselho')) then
    raise exception 'A etapa deste trilho está em validação. Regista a decisão da etapa primeiro.';
  end if;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, recorded_by, recorded_as)
  values (p_request, v_version, 'devolvido_conselho', p_meeting_date, trim(p_comment), auth.uid(), 'dirigente');
  update public.trail_requests set status = 'devolvido', updated_at = now() where id = p_request;
  select * into v_m from public.memberships where id = v_r.membership_id;
  perform private.notify(array[v_m.profile_id] || private.team_guias(v_m.team_id), v_m.section_id, 'devolucao_conselho',
    'Trilho devolvido pelo Conselho de Guias', trim(p_comment), '/pedidos/' || p_request);
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Notificações: remoção recuperável
-- ---------------------------------------------------------------------------
alter table public.notifications add column if not exists deleted_at timestamptz;
create index if not exists notifications_visible on public.notifications (profile_id, created_at desc) where deleted_at is null;

-- As removidas deixam de ser lidas (não reaparecem ao atualizar a página).
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (profile_id = (select auth.uid()) and deleted_at is null);

create or replace function public.mark_notifications_read(p_ids uuid[])
returns void language sql security definer set search_path = ''
as $$
  update public.notifications set read_at = now()
   where profile_id = auth.uid() and read_at is null and deleted_at is null and (p_ids is null or id = any (p_ids))
$$;

-- Remove (de forma recuperável) notificações do próprio utilizador.
--   p_scope = 'ids'   → as indicadas em p_ids
--   p_scope = 'lidas' → todas as já lidas
--   p_scope = 'todas' → todas
-- Devolve os identificadores removidos (para «Desfazer»). Nunca toca em
-- pedidos, decisões, justificações ou histórico pedagógico.
create or replace function public.remove_notifications(p_scope text, p_ids uuid[] default null)
returns uuid[] language plpgsql security definer set search_path = ''
as $$
declare v_ids uuid[];
begin
  if auth.uid() is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if p_scope not in ('ids', 'lidas', 'todas') then raise exception 'Opção inválida.'; end if;
  if p_scope = 'ids' and coalesce(cardinality(p_ids), 0) = 0 then return '{}'; end if;
  with removed as (
    update public.notifications set deleted_at = now()
     where profile_id = auth.uid() and deleted_at is null
       and (p_scope = 'todas' or (p_scope = 'lidas' and read_at is not null) or (p_scope = 'ids' and id = any (p_ids)))
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from removed;
  return v_ids;
end
$$;

-- Desfazer: repõe notificações removidas do próprio utilizador.
create or replace function public.restore_notifications(p_ids uuid[])
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  update public.notifications set deleted_at = null
   where profile_id = auth.uid() and deleted_at is not null and id = any (coalesce(p_ids, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Ligações atuais e notificações sem duplicados
-- ---------------------------------------------------------------------------

-- Destino atual de uma ligação (endereços antigos de «Dirigentes» e dos seis
-- separadores do Acompanhamento), adaptado a quem a recebe.
create or replace function private.notification_link(p_kind text, p_link text, p_profile uuid, p_section uuid)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v_dir boolean; v_path text := split_part(coalesce(p_link, ''), '?', 1);
begin
  if p_link is null then return null; end if;
  v_dir := exists (select 1 from public.memberships m where m.profile_id = p_profile and m.section_id = p_section
                    and m.status = 'ativo' and m.function = 'dirigente');
  v_path := regexp_replace(v_path, '^/dirigentes', '/acompanhamento');
  return case
    when v_path = '/conselho' then
      case when v_dir then '/acompanhamento/etapas' || case when p_kind = 'comunicacao_conselho' then '?ver=trilhos' else '' end
           else '/equipa' end
    when v_path = '/acompanhamento/negociacao' then '/acompanhamento/pedidos?tipo=negociacao'
    when v_path = '/acompanhamento/historico' then '/acompanhamento/pedidos?tipo=anterior'
    when v_path = '/acompanhamento/pedidos' and position('?' in p_link) = 0 then '/acompanhamento/pedidos?tipo=trilhos'
    when v_path = '/acompanhamento/conselho' then '/acompanhamento/etapas'
    when v_path = '/acompanhamento/merito' then '/acompanhamento/seccao?ver=merito'
    when v_path = '/acompanhamento' then '/acompanhamento/seccao'
    when v_path = '/pedidos' then '/meu-progresso?vista=pedidos'
    when v_path = '/progresso' then '/meu-progresso'
    when p_link ~ '^/dirigentes' then regexp_replace(p_link, '^/dirigentes', '/acompanhamento')
    else p_link
  end;
end
$$;

-- Cria uma notificação por destinatário (nunca para quem fez a ação). Se o
-- mesmo destinatário ainda tem por ler o mesmo aviso (tipo, ligação e texto),
-- esse aviso sobe para o topo em vez de ser repetido.
create or replace function private.notify(
  p_profiles uuid[], p_section uuid, p_kind text, p_title text, p_body text, p_link text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_pid uuid; v_link text;
begin
  for v_pid in select distinct x from unnest(coalesce(p_profiles, '{}')) x where x is not null and x is distinct from auth.uid()
  loop
    v_link := private.notification_link(p_kind, p_link, v_pid, p_section);
    update public.notifications n set created_at = now()
     where n.profile_id = v_pid and n.kind = p_kind and n.link is not distinct from v_link
       and n.title = p_title and n.body is not distinct from p_body and n.read_at is null and n.deleted_at is null;
    if not found then
      insert into public.notifications (profile_id, section_id, kind, title, body, link)
      values (v_pid, p_section, p_kind, p_title, p_body, v_link);
    end if;
  end loop;
end
$$;

-- Notificações já guardadas passam a apontar para as rotas atuais.
update public.notifications n
   set link = private.notification_link(n.kind, n.link, n.profile_id, n.section_id)
 where n.link is distinct from private.notification_link(n.kind, n.link, n.profile_id, n.section_id);

-- ---------------------------------------------------------------------------
-- 4. Contadores do Acompanhamento (cada pedido conta uma vez, num só tipo)
-- ---------------------------------------------------------------------------
create or replace function public.my_pending_counts(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_me public.memberships; v_out jsonb := '{}'::jsonb; v_neg int; v_tri int; v_ant int; v_eta int;
begin
  v_me := private.my_active_membership(p_section);
  if v_me.id is null then return v_out; end if;
  if v_me.function in ('pioneiro', 'guia') then
    v_out := v_out || jsonb_build_object('pedidos', (select count(*) from public.trail_requests
      where membership_id = v_me.id and status in ('rascunho', 'devolvido')));
  end if;
  if v_me.function = 'guia' then
    v_out := v_out || jsonb_build_object('equipa', (select count(*) from public.trail_requests r
      join public.memberships m on m.id = r.membership_id
      where m.team_id = v_me.team_id and m.status = 'ativo' and m.id <> v_me.id
        and r.kind = 'normal' and r.status in ('submetido', 'em_revisao')));
  end if;
  if v_me.function = 'dirigente' then
    select count(*) into v_neg from public.stage_choices c join public.memberships m on m.id = c.membership_id
     where m.section_id = p_section and m.status = 'ativo' and c.status = 'proposta';
    select count(*) filter (where r.kind = 'normal'), count(*) filter (where r.kind = 'historico') into v_tri, v_ant
      from public.trail_requests r join public.memberships m on m.id = r.membership_id
     where r.section_id = p_section and m.status = 'ativo' and r.status in ('submetido', 'em_revisao');
    select count(*) into v_eta from public.stage_requests s join public.memberships m on m.id = s.membership_id
     where m.section_id = p_section and m.status = 'ativo' and s.status in ('submetido', 'decidido_conselho');
    v_out := v_out || jsonb_build_object('acompanhamento', v_neg + v_tri + v_ant + v_eta,
      'negociacao', v_neg, 'trilhos', v_tri, 'anterior', v_ant, 'etapas', v_eta);
  end if;
  if v_me.is_admin then
    v_out := v_out || jsonb_build_object('gestao', (select count(*) from public.memberships
      where section_id = p_section and status = 'pendente'));
  end if;
  return v_out;
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on function private.new_draft_version(uuid, integer) from public, anon, authenticated;
revoke all on function private.notify(uuid[], uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function private.notification_link(text, text, uuid, uuid) from public, anon, authenticated;
notify pgrst, 'reload schema';


-- ===== 20261020000100_notificacoes_push.sql =====
-- Pioneiros — notificações push no telemóvel e no computador.
--
-- • Cada pessoa ativa as notificações no seu dispositivo (Perfil); a subscrição
--   do navegador fica em push_subscriptions, só acessível pelas funções abaixo.
-- • Quando é criada uma notificação para alguém com subscrições, a base de
--   dados avisa a função /api/push da app (pg_net), que envia o push. Se o envio
--   falhar, a notificação continua na app: o push nunca bloqueia nada.
-- • A configuração do envio (endereço, segredo partilhado e chaves VAPID) fica
--   no esquema private; as chaves são criadas pela própria função /api/push na
--   primeira utilização. Só a chave secreta do Supabase (service_role) as lê.
-- • «Enviar notificação de teste» cria uma notificação para o próprio.
-- Aditivo: não altera nem apaga registos existentes.

do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net indisponível: as notificações push ficam desligadas até a extensão ser ativada.';
end $$;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists push_subscriptions_profile on public.push_subscriptions (profile_id);
alter table public.push_subscriptions enable row level security;
-- Sem políticas: lê-se e escreve-se só através das funções abaixo.

create table if not exists private.push_config (
  id boolean primary key default true check (id),
  endpoint text,
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  vapid_public_key text,
  vapid_private_key text
);
insert into private.push_config (endpoint) values ('https://sistema-progresso.vercel.app/api/push')
on conflict (id) do nothing;

create or replace function private.is_service_role() returns boolean language sql stable set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;

-- ---------------------------------------------------------------------------
-- Subscrições do próprio
-- ---------------------------------------------------------------------------
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
) returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Tens de entrar na tua conta primeiro.' using errcode = '42501'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'Subscrição inválida.'; end if;
  if coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'Subscrição inválida.'; end if;
  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end
$$;

create or replace function public.remove_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and profile_id = auth.uid()
$$;

create or replace function public.has_push_subscription(p_endpoint text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.push_subscriptions where endpoint = p_endpoint and profile_id = auth.uid())
$$;

create or replace function public.send_test_notification() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Tens de entrar na tua conta primeiro.' using errcode = '42501'; end if;
  if (select count(*) from public.notifications where profile_id = auth.uid() and kind = 'teste'
        and created_at > now() - interval '1 minute') >= 3 then
    raise exception 'Já enviaste várias notificações de teste. Espera um minuto.';
  end if;
  insert into public.notifications (profile_id, section_id, kind, title, body, link)
  values (auth.uid(), null, 'teste', 'Notificação de teste',
          'Se estás a ver isto no telemóvel, as notificações estão a funcionar.', '/notificacoes');
end
$$;

-- ---------------------------------------------------------------------------
-- Funções só para a função /api/push (chave secreta do Supabase)
-- ---------------------------------------------------------------------------
-- Devolve a configuração; guarda as chaves VAPID se ainda não existirem
-- (a função cria-as na primeira utilização). Nunca substitui chaves guardadas.
create or replace function public.push_service_config(p_public_key text default null, p_private_key text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare c private.push_config;
begin
  if not private.is_service_role() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if p_public_key is not null and p_private_key is not null then
    update private.push_config set vapid_public_key = p_public_key, vapid_private_key = p_private_key
     where vapid_public_key is null;
  end if;
  select * into c from private.push_config;
  return jsonb_build_object('secret', c.secret, 'public_key', c.vapid_public_key, 'private_key', c.vapid_private_key);
end
$$;

-- Conteúdo de uma notificação e as subscrições do destinatário.
create or replace function public.push_notification_payload(p_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select case when not private.is_service_role() then null else (
    select jsonb_build_object(
      'title', n.title, 'body', n.body, 'link', n.link,
      'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                                   from public.push_subscriptions s where s.profile_id = n.profile_id), '[]'::jsonb))
    from public.notifications n where n.id = p_id and n.deleted_at is null and n.read_at is null)
  end
$$;

-- Subscrições que o serviço de push deu como expiradas (404/410) são removidas.
create or replace function public.push_drop_subscriptions(p_endpoints text[]) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v int;
begin
  if not private.is_service_role() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  delete from public.push_subscriptions where endpoint = any (p_endpoints);
  get diagnostics v = row_count;
  return v;
end
$$;

-- ---------------------------------------------------------------------------
-- Aviso à função de envio quando é criada uma notificação
-- ---------------------------------------------------------------------------
create or replace function private.push_on_notification() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare c private.push_config;
begin
  if not exists (select 1 from public.push_subscriptions where profile_id = new.profile_id) then return new; end if;
  select * into c from private.push_config;
  if c.endpoint is null then return new; end if;
  perform net.http_post(
    url := c.endpoint,
    body := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', c.secret));
  return new;
exception when others then
  -- O push nunca impede a notificação de ficar guardada na app.
  return new;
end
$$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
for each row execute function private.push_on_notification();

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function public.push_service_config(text, text), public.push_notification_payload(uuid),
  public.push_drop_subscriptions(text[]) to service_role;

