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


-- ===== 20261021000100_modulos_base.sql =====
-- Pioneiros — base comum dos módulos (Calendário escutista, Inventário, Tesouraria,
-- Equipas e cargos, Secretaria).
--
-- • Cada módulo tem, por secção, um estado: «desenvolvimento» (fechado), «teste»
--   (só testers escolhidos pela administração) ou «disponivel» (todos os membros ativos).
-- • Dois espaços de dados por módulo: «teste» e «real». Os testers trabalham no espaço
--   de teste; ao publicar, o espaço real começa vazio, salvo se a administração escolher
--   explicitamente passar os dados de teste para reais. Desativar nunca apaga dados.
-- • Ser tester só dá acesso ao módulo. Gerir, editar ou aprovar exige uma permissão
--   explícita (module_grants) ou, onde indicado, a função de dirigente. Cargos de equipa
--   nunca concedem permissões técnicas.
-- • Todas as tabelas dos módulos têm RLS sem políticas: lê-se e escreve-se apenas através
--   de funções que verificam o acesso no servidor.
-- • Notificações dos módulos: no espaço de teste só chegam a testers do módulo e levam
--   «[Teste]» no título. Lembretes programados sem duplicados (module_reminders).
-- Aditivo: não altera dados nem permissões existentes e não adiciona testers.

create table if not exists public.module_settings (
  section_id uuid not null references public.sections (id) on delete cascade,
  module text not null check (module in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria')),
  status text not null default 'desenvolvimento' check (status in ('desenvolvimento', 'teste', 'disponivel')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (section_id, module)
);

create table if not exists public.module_testers (
  section_id uuid not null references public.sections (id) on delete cascade,
  module text not null check (module in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria')),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (section_id, module, profile_id)
);

-- Permissões dentro dos módulos (concedidas só pela administração).
create table if not exists public.module_grants (
  section_id uuid not null references public.sections (id) on delete cascade,
  permission text not null check (permission in (
    'calendario.gerir', 'inventario.gerir', 'tesouraria.gerir', 'equipas.gerir',
    'secretaria.redigir', 'secretaria.aprovar')),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (section_id, permission, profile_id)
);

alter table public.module_settings enable row level security;
alter table public.module_testers enable row level security;
alter table public.module_grants enable row level security;

-- ---------------------------------------------------------------------------
-- Acesso
-- ---------------------------------------------------------------------------
create or replace function private.module_status(p_section uuid, p_module text)
returns text language sql stable security definer set search_path = ''
as $$
  select coalesce((select status from public.module_settings where section_id = p_section and module = p_module), 'desenvolvimento')
$$;

-- Espaço de dados a que a pessoa atual tem acesso neste módulo (null = sem acesso).
create or replace function private.module_space(p_section uuid, p_module text)
returns text language sql stable security definer set search_path = ''
as $$
  select case
    when not private.is_active_member(p_section) then null
    when private.module_status(p_section, p_module) = 'disponivel' then 'real'
    when private.module_status(p_section, p_module) = 'teste'
         and exists (select 1 from public.module_testers t
                      where t.section_id = p_section and t.module = p_module and t.profile_id = auth.uid()) then 'teste'
    else null end
$$;

-- Garante acesso e devolve o espaço; caso contrário, erro.
create or replace function private.module_require(p_section uuid, p_module text)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v text := private.module_space(p_section, p_module);
begin
  if v is null then raise exception 'Este módulo ainda não está disponível para ti.' using errcode = '42501'; end if;
  return v;
end
$$;

create or replace function private.has_grant(p_section uuid, p_permission text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.module_grants g
                  where g.section_id = p_section and g.permission = p_permission and g.profile_id = auth.uid())
$$;

-- Pode gerir: acesso ao módulo e (permissão explícita ou, quando permitido, dirigente).
create or replace function private.module_can(p_section uuid, p_module text, p_permission text, p_dirigente_ok boolean)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.module_space(p_section, p_module) is not null
     and (private.has_grant(p_section, p_permission) or (p_dirigente_ok and private.is_dirigente(p_section)))
$$;

create or replace function private.module_require_can(p_section uuid, p_module text, p_permission text, p_dirigente_ok boolean)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v text := private.module_require(p_section, p_module);
begin
  if not private.module_can(p_section, p_module, p_permission, p_dirigente_ok) then
    raise exception 'Não tens permissão para esta ação neste módulo.' using errcode = '42501';
  end if;
  return v;
end
$$;

-- Destinatários de uma notificação de módulo: no espaço de teste, só testers.
create or replace function private.module_recipients(p_section uuid, p_module text, p_space text, p_profiles uuid[])
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct p), '{}') from unnest(coalesce(p_profiles, '{}')) p
   where p is not null
     and exists (select 1 from public.memberships m where m.profile_id = p and m.section_id = p_section and m.status = 'ativo')
     and (p_space = 'real' or exists (select 1 from public.module_testers t
                                       where t.section_id = p_section and t.module = p_module and t.profile_id = p))
$$;

create or replace function private.module_notify(
  p_section uuid, p_module text, p_space text, p_profiles uuid[], p_kind text, p_title text, p_body text, p_link text
) returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.notify(private.module_recipients(p_section, p_module, p_space, p_profiles), p_section, p_kind,
    case when p_space = 'teste' then '[Teste] ' || p_title else p_title end, p_body, p_link);
end
$$;

-- ---------------------------------------------------------------------------
-- Lembretes programados (sem duplicados; cancelados ou reagendados quando muda o evento)
-- ---------------------------------------------------------------------------
create table if not exists public.module_reminders (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  module text not null,
  space text not null check (space in ('teste', 'real')),
  entity text not null,
  entity_id uuid not null,
  kind text not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  due_at timestamptz not null,
  title text not null,
  body text,
  link text,
  sent_at timestamptz,
  cancelled_at timestamptz,
  unique (entity, entity_id, kind, profile_id)
);
create index if not exists module_reminders_due on public.module_reminders (due_at) where sent_at is null and cancelled_at is null;
alter table public.module_reminders enable row level security;

create or replace function private.schedule_reminder(
  p_section uuid, p_module text, p_space text, p_entity text, p_entity_id uuid, p_kind text,
  p_profile uuid, p_due timestamptz, p_title text, p_body text, p_link text
) returns void language sql security definer set search_path = ''
as $$
  insert into public.module_reminders (section_id, module, space, entity, entity_id, kind, profile_id, due_at, title, body, link)
  values (p_section, p_module, p_space, p_entity, p_entity_id, p_kind, p_profile, p_due, p_title, p_body, p_link)
  on conflict (entity, entity_id, kind, profile_id) do update
    set due_at = excluded.due_at, title = excluded.title, body = excluded.body, link = excluded.link,
        cancelled_at = null,
        -- Reagendar para o futuro volta a permitir o envio.
        sent_at = case when excluded.due_at > now() then null else public.module_reminders.sent_at end
$$;

create or replace function private.cancel_reminders(p_entity text, p_entity_id uuid, p_profile uuid default null)
returns void language sql security definer set search_path = ''
as $$
  update public.module_reminders set cancelled_at = now()
   where entity = p_entity and entity_id = p_entity_id and sent_at is null and cancelled_at is null
     and (p_profile is null or profile_id = p_profile)
$$;

-- Envia os lembretes vencidos (chamado pelo agendador a cada 5 minutos).
create or replace function private.process_due_reminders()
returns integer language plpgsql security definer set search_path = ''
as $$
declare r public.module_reminders; n int := 0;
begin
  for r in select * from public.module_reminders
            where sent_at is null and cancelled_at is null and due_at <= now()
            order by due_at limit 500 for update skip locked
  loop
    -- Quem deixou de ter acesso ao módulo (ou ao espaço de teste) não recebe.
    if private.module_status(r.section_id, r.module) <> 'desenvolvimento'
       and (r.space = 'real') = (private.module_status(r.section_id, r.module) = 'disponivel') then
      perform private.module_notify(r.section_id, r.module, r.space, array[r.profile_id], 'lembrete', r.title, r.body, r.link);
    end if;
    update public.module_reminders set sent_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end
$$;

create or replace function public.process_due_reminders()
returns integer language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_service_role() and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return private.process_due_reminders();
end
$$;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('pioneiros-lembretes', '*/5 * * * *', 'select private.process_due_reminders()');
exception when others then
  raise notice 'pg_cron indisponível: ativa-o em Database › Extensions para os lembretes serem enviados.';
end $$;

-- ---------------------------------------------------------------------------
-- Consulta e administração
-- ---------------------------------------------------------------------------
create or replace function public.my_modules(p_section uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'module', k,
    'status', private.module_status(p_section, k),
    'space', private.module_space(p_section, k),
    'grants', coalesce((select jsonb_agg(g.permission) from public.module_grants g
                         where g.section_id = p_section and g.profile_id = auth.uid() and g.permission like k || '.%'), '[]'::jsonb),
    'dirigente', private.is_dirigente(p_section)
  ) order by k), '[]'::jsonb)
  from unnest(array['calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria']) k
  where private.is_active_member(p_section)
$$;

create or replace function public.module_admin_overview(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  return (
    select jsonb_agg(jsonb_build_object(
      'module', k,
      'status', private.module_status(p_section, k),
      'testers', coalesce((select jsonb_agg(t.profile_id order by t.added_at) from public.module_testers t
                            where t.section_id = p_section and t.module = k), '[]'::jsonb),
      'grants', coalesce((select jsonb_agg(jsonb_build_object('permission', g.permission, 'profile_id', g.profile_id) order by g.granted_at)
                           from public.module_grants g where g.section_id = p_section and g.permission like k || '.%'), '[]'::jsonb)
    ) order by k)
    from unnest(array['calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria']) k
  );
end
$$;

-- Tabelas de dados de cada módulo: todas têm section_id e space e começam pelo prefixo
-- do módulo (usadas para passar dados de teste a reais ao publicar).
create or replace function private.module_prefix(p_module text)
returns text language sql immutable set search_path = ''
as $$
  select case p_module when 'calendario' then 'cal_' when 'inventario' then 'inv_' when 'tesouraria' then 'fin_'
                       when 'equipas' then 'eq_' when 'secretaria' then 'sec_' end
$$;

create or replace function private.module_tables(p_module text)
returns text[] language sql stable set search_path = ''
as $$
  select coalesce(array_agg(c.table_name::text order by c.table_name), '{}')
    from information_schema.columns c
    join information_schema.columns s on s.table_schema = c.table_schema and s.table_name = c.table_name and s.column_name = 'section_id'
   where c.table_schema = 'public' and c.column_name = 'space'
     and c.table_name like private.module_prefix(p_module) || '%'
$$;

create or replace function public.set_module_status(p_section uuid, p_module text, p_status text, p_move_test_data boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_old text; v_t text; v_c text;
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  if p_status not in ('desenvolvimento', 'teste', 'disponivel') then raise exception 'Estado inválido.'; end if;
  if p_module not in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria') then raise exception 'Módulo inválido.'; end if;
  v_old := private.module_status(p_section, p_module);
  insert into public.module_settings (section_id, module, status, updated_by, updated_at)
  values (p_section, p_module, p_status, auth.uid(), now())
  on conflict (section_id, module) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = now();
  -- Passar os dados de teste para reais só por escolha explícita, ao publicar.
  if coalesce(p_move_test_data, false) then
    if p_status <> 'disponivel' then raise exception 'Os dados de teste só passam a reais ao publicar.'; end if;
    -- Um módulo pode definir private.<módulo>_publish_move(secção) quando a passagem
    -- precisa de regras próprias (ou não é permitida); senão, passam todas as tabelas.
    if to_regprocedure('private.' || p_module || '_publish_move(uuid)') is not null then
      execute format('select private.%I($1)', p_module || '_publish_move') using p_section;
    else
      foreach v_t in array private.module_tables(p_module) loop
        execute format('update public.%I set space = ''real'' where section_id = $1 and space = ''teste''', v_t) using p_section;
      end loop;
    end if;
    update public.module_files set space = 'real' where section_id = p_section and module = p_module and space = 'teste';
    -- Lembretes ainda por enviar passam com os dados (senão nunca seriam enviados).
    update public.module_reminders set space = 'real'
     where section_id = p_section and module = p_module and space = 'teste' and sent_at is null;
    -- Registos agora reais não ficam ligados a atividades do Calendário que continuam
    -- de teste: a ligação opcional é retirada (o registo mantém-se).
    if to_regclass('public.cal_events') is not null and p_module <> 'calendario' then
      for v_t, v_c in
        select c.conrelid::regclass::text, a.attname::text
          from pg_constraint c
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f' and c.confrelid = 'public.cal_events'::regclass and not a.attnotnull
           and c.conrelid::regclass::text like 'public.' || private.module_prefix(p_module) || '%'
            or c.contype = 'f' and c.confrelid = 'public.cal_events'::regclass and not a.attnotnull
           and c.conrelid::regclass::text like private.module_prefix(p_module) || '%'
      loop
        execute format('update %s t set %I = null where t.section_id = $1 and t.space = ''real'' and t.%I is not null
                          and not exists (select 1 from public.cal_events e where e.id = t.%I and e.space = ''real'')', v_t, v_c, v_c, v_c)
          using p_section;
      end loop;
    end if;
  end if;
  perform private.audit(p_section, 'modulo_estado', 'module', p_module,
    jsonb_build_object('de', v_old, 'para', p_status, 'dados_teste_para_reais', coalesce(p_move_test_data, false)));
end
$$;

create or replace function public.set_module_tester(p_section uuid, p_module text, p_profile uuid, p_on boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  if p_module not in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria') then raise exception 'Módulo inválido.'; end if;
  if p_on then
    if not exists (select 1 from public.memberships where section_id = p_section and profile_id = p_profile and status = 'ativo') then
      raise exception 'Só membros ativos da secção podem testar módulos.';
    end if;
    insert into public.module_testers (section_id, module, profile_id, added_by) values (p_section, p_module, p_profile, auth.uid())
    on conflict do nothing;
  else
    delete from public.module_testers where section_id = p_section and module = p_module and profile_id = p_profile;
  end if;
  perform private.audit(p_section, case when p_on then 'tester_adicionado' else 'tester_removido' end, 'module', p_module,
    jsonb_build_object('profile', p_profile));
end
$$;

create or replace function public.set_module_grant(p_section uuid, p_permission text, p_profile uuid, p_on boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  if p_on then
    if not exists (select 1 from public.memberships where section_id = p_section and profile_id = p_profile and status = 'ativo') then
      raise exception 'Só membros ativos da secção podem receber permissões.';
    end if;
    insert into public.module_grants (section_id, permission, profile_id, granted_by) values (p_section, p_permission, p_profile, auth.uid())
    on conflict do nothing;
  else
    delete from public.module_grants where section_id = p_section and permission = p_permission and profile_id = p_profile;
  end if;
  perform private.audit(p_section, case when p_on then 'permissao_concedida' else 'permissao_retirada' end, 'module_grant', p_permission,
    jsonb_build_object('profile', p_profile));
end
$$;

-- ---------------------------------------------------------------------------
-- Anexos dos módulos (bucket privado «modulos»)
-- 1) module_file_prepare valida a permissão e reserva o caminho; 2) o cliente carrega o
-- ficheiro para esse caminho (a política só aceita caminhos reservados pela própria
-- pessoa); 3) quem pode ler é decidido pelo módulo dono, através de
-- private.<módulo>_file_access(entity, entity_id, write). Anexos nunca se apagam:
-- retiram-se (deixam de estar visíveis), mantendo a rastreabilidade.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('modulos', 'modulos', false, 10 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.module_files (
  path text primary key,
  section_id uuid not null references public.sections (id) on delete cascade,
  module text not null,
  space text not null check (space in ('teste', 'real')),
  entity text not null,
  entity_id uuid not null,
  file_name text not null check (length(file_name) between 1 and 200),
  mime text not null,
  uploaded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid
);
create index if not exists module_files_entity on public.module_files (entity, entity_id);
alter table public.module_files enable row level security;

create or replace function private.module_file_access(p_path text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare f public.module_files; v boolean;
begin
  select * into f from public.module_files where path = p_path;
  if f.path is null or f.removed_at is not null then return false; end if;
  if private.module_space(f.section_id, f.module) is distinct from f.space then return false; end if;
  execute format('select private.%I($1, $2, $3)', f.module || '_file_access') into v using f.entity, f.entity_id, p_write;
  return coalesce(v, false);
exception when undefined_function then
  return false;
end
$$;

create or replace function private.module_file_can_upload(p_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.module_files f where f.path = p_path and f.uploaded_by = auth.uid()
                  and f.removed_at is null and f.created_at > now() - interval '1 hour')
$$;

create or replace function public.module_file_prepare(
  p_section uuid, p_module text, p_entity text, p_entity_id uuid, p_file_name text, p_mime text
) returns text language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, p_module); v_path text; v boolean;
begin
  if p_mime not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'Tipo de ficheiro não permitido. Usa JPG, PNG, WebP ou PDF.';
  end if;
  begin
    execute format('select private.%I($1, $2, true)', p_module || '_file_access') into v using p_entity, p_entity_id;
  exception when undefined_function then v := false;
  end;
  if not coalesce(v, false) then raise exception 'Não tens permissão para anexar ficheiros aqui.' using errcode = '42501'; end if;
  v_path := p_section || '/' || p_module || '/' || v_space || '/' || gen_random_uuid()
            || '-' || regexp_replace(left(coalesce(p_file_name, 'ficheiro'), 80), '[^A-Za-z0-9._-]+', '_', 'g');
  insert into public.module_files (path, section_id, module, space, entity, entity_id, file_name, mime)
  values (v_path, p_section, p_module, v_space, p_entity, p_entity_id, left(p_file_name, 200), p_mime);
  return v_path;
end
$$;

-- Anexos visíveis de uma entidade (só os que a pessoa pode ler).
create or replace function public.module_files_of(p_section uuid, p_module text, p_entity text, p_entity_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('path', f.path, 'file_name', f.file_name, 'mime', f.mime, 'created_at', f.created_at)
                  order by f.created_at), '[]'::jsonb)
    from public.module_files f
   where f.section_id = p_section and f.module = p_module and f.entity = p_entity and f.entity_id = p_entity_id
     and f.removed_at is null and private.module_file_access(f.path, false)
$$;

create or replace function public.module_file_remove(p_path text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.module_file_access(p_path, true) then
    raise exception 'Não tens permissão para retirar este anexo.' using errcode = '42501';
  end if;
  update public.module_files set removed_at = now(), removed_by = auth.uid() where path = p_path;
end
$$;

drop policy if exists "modulos: carregar caminho reservado" on storage.objects;
drop policy if exists "modulos: ler com acesso ao módulo" on storage.objects;
create policy "modulos: carregar caminho reservado" on storage.objects for insert to authenticated
  with check (bucket_id = 'modulos' and private.module_file_can_upload(name));
create policy "modulos: ler com acesso ao módulo" on storage.objects for select to authenticated
  using (bucket_id = 'modulos' and private.module_file_access(name, false));
grant execute on function private.module_file_can_upload(text), private.module_file_access(text, boolean) to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;
grant execute on function public.process_due_reminders() to service_role;


-- ===== 20261021000200_calendario.sql =====
-- Pioneiros — Calendário escutista: atividades, participantes, presenças, pendências,
-- prazos e lembretes. Todas as tabelas têm section_id e space (teste/real) e RLS sem
-- políticas: leitura e escrita só por funções que verificam o acesso no servidor.
-- Horas guardadas como instantes (timestamptz) e mostradas em Europe/Lisbon; eventos de
-- dia inteiro guardados como datas (start_date/end_date, fim inclusivo), sem hora.

create table if not exists public.cal_events (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  title text not null check (length(trim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 5000),
  location text check (location is null or length(location) <= 300),
  all_day boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  start_date date,
  end_date date,
  audience text not null default 'seccao' check (audience in ('seccao', 'equipa')),
  team_id uuid references public.teams (id),
  responsible_id uuid references public.profiles (id),
  registration_deadline timestamptz,
  needs_authorization boolean not null default false,
  needs_payment boolean not null default false,
  needs_registration boolean not null default false,
  material text check (material is null or length(material) <= 2000),
  reminder_minutes integer[] not null default '{1440}',
  deadline_reminder_minutes integer[] not null default '{1440}',
  status text not null default 'ativo' check (status in ('ativo', 'cancelado')),
  cancel_reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (audience <> 'equipa' or team_id is not null),
  check ((all_day and start_date is not null and end_date is not null and end_date >= start_date and starts_at is null and ends_at is null)
      or (not all_day and starts_at is not null and ends_at is not null and ends_at >= starts_at and start_date is null and end_date is null))
);
create index if not exists cal_events_section on public.cal_events (section_id, space);
alter table public.cal_events enable row level security;

-- Anulação: quem cancelou e quando (o evento nunca se apaga).
alter table public.cal_events add column if not exists cancelled_at timestamptz;
alter table public.cal_events add column if not exists cancelled_by uuid;
create index if not exists cal_events_dates on public.cal_events (section_id, space, start_date, starts_at);

-- ---------------------------------------------------------------------------
-- Participantes: resposta (Vou / Não vou / Por confirmar), nota do próprio e
-- pendências resolvidas pelos gestores (autorização, pagamento, inscrição, material).
-- Uma linha por atividade e pessoa; nunca se apaga (as alterações ficam na auditoria).
-- «extra» = pessoa fora do público da atividade (p.ex. dirigente que acompanha).
-- ---------------------------------------------------------------------------
create table if not exists public.cal_participants (
  event_id uuid not null references public.cal_events (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  response text check (response in ('vou', 'nao_vou', 'por_confirmar')),
  note text check (note is null or length(note) <= 500),
  extra boolean not null default false,
  responded_at timestamptz,
  responded_by uuid,
  autorizacao_at timestamptz,
  autorizacao_by uuid,
  pagamento_at timestamptz,
  pagamento_by uuid,
  inscricao_at timestamptz,
  inscricao_by uuid,
  material_at timestamptz,
  material_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, profile_id)
);
create index if not exists cal_participants_section on public.cal_participants (section_id, space);
create index if not exists cal_participants_profile on public.cal_participants (profile_id);
alter table public.cal_participants enable row level security;

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
create or replace function private.cal_can_manage(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.module_can(p_section, 'calendario', 'calendario.gerir', true) $$;

-- Evento desta secção e deste espaço (ou erro «Registo não encontrado.»).
create or replace function private.cal_event_of(p_section uuid, p_space text, p_event uuid, p_lock boolean default false)
returns public.cal_events language plpgsql security definer set search_path = ''
as $$
declare e public.cal_events;
begin
  if p_lock then
    select * into e from public.cal_events where id = p_event and section_id = p_section and space = p_space for update;
  else
    select * into e from public.cal_events where id = p_event and section_id = p_section and space = p_space;
  end if;
  if e.id is null then raise exception 'Registo não encontrado.'; end if;
  return e;
end
$$;

-- Envolvidos: público da atividade (membros ativos da secção ou da equipa), responsável
-- e participantes extra — sempre membros ativos da secção.
create or replace function private.cal_involved(p_event uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct x.p), '{}') from (
    select m.profile_id as p from public.cal_events e
      join public.memberships m on m.section_id = e.section_id and m.status = 'ativo'
     where e.id = p_event and (e.audience = 'seccao' or m.team_id = e.team_id)
    union all
    select e.responsible_id from public.cal_events e where e.id = p_event
    union all
    select c.profile_id from public.cal_participants c where c.event_id = p_event and c.extra
  ) x
  join public.cal_events e2 on e2.id = p_event
  join public.memberships m2 on m2.profile_id = x.p and m2.section_id = e2.section_id and m2.status = 'ativo'
  where x.p is not null
$$;

create or replace function private.cal_in_audience(p_event uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.cal_events e join public.memberships m on m.section_id = e.section_id and m.status = 'ativo'
                  where e.id = p_event and m.profile_id = p_profile
                    and (e.audience = 'seccao' or m.team_id = e.team_id or e.responsible_id = p_profile))
$$;

-- O que a atividade exige a cada participante.
create or replace function private.cal_required(e public.cal_events)
returns text[] language sql immutable set search_path = ''
as $$
  select array_remove(array[
    case when e.needs_authorization then 'autorizacao' end,
    case when e.needs_payment then 'pagamento' end,
    case when e.needs_registration then 'inscricao' end,
    case when coalesce(trim(e.material), '') <> '' then 'material' end], null)
$$;

-- O que falta a uma pessoa (vazio se respondeu «Não vou» ou se a atividade foi cancelada).
create or replace function private.cal_missing(e public.cal_events, c public.cal_participants)
returns text[] language sql immutable set search_path = ''
as $$
  select case when e.status <> 'ativo' or c.response = 'nao_vou' then '{}'::text[] else array_remove(array[
    case when c.response is null or c.response = 'por_confirmar' then 'resposta' end,
    case when e.needs_authorization and c.autorizacao_at is null then 'autorizacao' end,
    case when e.needs_payment and c.pagamento_at is null then 'pagamento' end,
    case when e.needs_registration and c.inscricao_at is null then 'inscricao' end,
    case when coalesce(trim(e.material), '') <> '' and c.material_at is null then 'material' end], null) end
$$;

-- Instante de referência do início: dia inteiro = 09:00 em Lisboa no primeiro dia.
create or replace function private.cal_start_instant(e public.cal_events)
returns timestamptz language sql stable set search_path = ''
as $$
  select case when e.all_day then (e.start_date + time '09:00') at time zone 'Europe/Lisbon' else e.starts_at end
$$;

-- «m minutos antes» em hora de parede de Lisboa (1 dia antes = mesma hora na véspera,
-- mesmo com mudança de hora pelo meio).
create or replace function private.cal_before(p_ref timestamptz, p_minutes integer)
returns timestamptz language sql stable set search_path = ''
as $$
  select ((p_ref at time zone 'Europe/Lisbon') - make_interval(mins => p_minutes)) at time zone 'Europe/Lisbon'
$$;

create or replace function private.cal_when(e public.cal_events)
returns text language sql stable set search_path = ''
as $$
  select case
    when e.all_day and e.start_date = e.end_date then to_char(e.start_date, 'DD/MM/YYYY') || ' (dia inteiro)'
    when e.all_day then to_char(e.start_date, 'DD/MM/YYYY') || ' a ' || to_char(e.end_date, 'DD/MM/YYYY')
    else to_char(e.starts_at at time zone 'Europe/Lisbon', 'DD/MM/YYYY, HH24:MI') end
$$;

-- Lembretes da atividade: antes do início (envolvidos que não responderam «Não vou») e antes
-- do prazo de inscrição (quem ainda não respondeu ou tem pendências). Únicos por pessoa e
-- tipo; reagendados quando a atividade muda e cancelados quando deixam de se aplicar.
create or replace function private.cal_sync_reminders(p_event uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  e public.cal_events; c public.cal_participants; v_p uuid; v_m int; v_due timestamptz;
  v_keys text[] := '{}'; v_link text; v_missing text[];
begin
  select * into e from public.cal_events where id = p_event;
  if e.id is null then return; end if;
  if e.status <> 'ativo' then
    perform private.cancel_reminders('cal_event', e.id);
    return;
  end if;
  v_link := '/calendario/evento/' || e.id;
  foreach v_p in array private.cal_involved(e.id) loop
    c := null;
    select * into c from public.cal_participants where event_id = e.id and profile_id = v_p;
    v_missing := private.cal_missing(e, c);
    if c.response is distinct from 'nao_vou' then
      foreach v_m in array e.reminder_minutes loop
        v_due := private.cal_before(private.cal_start_instant(e), v_m);
        if v_due > now() then
          perform private.schedule_reminder(e.section_id, 'calendario', e.space, 'cal_event', e.id, 'antes_' || v_m, v_p, v_due,
            left('Lembrete: ' || e.title, 220), 'Começa ' || private.cal_when(e) || coalesce(' · ' || e.location, '') || '.', v_link);
          v_keys := v_keys || (v_p::text || '|antes_' || v_m);
        end if;
      end loop;
    end if;
    if e.registration_deadline is not null and cardinality(v_missing) > 0 then
      foreach v_m in array e.deadline_reminder_minutes loop
        v_due := private.cal_before(e.registration_deadline, v_m);
        if v_due > now() then
          perform private.schedule_reminder(e.section_id, 'calendario', e.space, 'cal_event', e.id, 'prazo_' || v_m, v_p, v_due,
            left('Prazo de inscrição: ' || e.title, 220),
            'O prazo termina a ' || to_char(e.registration_deadline at time zone 'Europe/Lisbon', 'DD/MM/YYYY, HH24:MI') || '. Vê o que te falta.', v_link);
          v_keys := v_keys || (v_p::text || '|prazo_' || v_m);
        end if;
      end loop;
    end if;
  end loop;
  update public.module_reminders set cancelled_at = now()
   where entity = 'cal_event' and entity_id = e.id and sent_at is null and cancelled_at is null
     and not ((profile_id::text || '|' || kind) = any (v_keys));
end
$$;

-- Lê e valida os dados de uma atividade (jsonb do formulário).
create or replace function private.cal_from_json(p_section uuid, p_data jsonb)
returns public.cal_events language plpgsql stable security definer set search_path = ''
as $$
declare e public.cal_events; v_start timestamptz;
begin
  e.section_id := p_section;
  e.title := nullif(trim(coalesce(p_data ->> 'title', '')), '');
  if e.title is null then raise exception 'Indica o título da atividade.'; end if;
  if length(e.title) > 200 then raise exception 'O título é demasiado longo (máximo 200 caracteres).'; end if;
  e.description := nullif(trim(coalesce(p_data ->> 'description', '')), '');
  if length(e.description) > 5000 then raise exception 'A descrição é demasiado longa (máximo 5000 caracteres).'; end if;
  e.location := nullif(trim(coalesce(p_data ->> 'location', '')), '');
  if length(e.location) > 300 then raise exception 'O local é demasiado longo (máximo 300 caracteres).'; end if;
  e.material := nullif(trim(coalesce(p_data ->> 'material', '')), '');
  if length(e.material) > 2000 then raise exception 'A lista de material é demasiado longa (máximo 2000 caracteres).'; end if;
  e.all_day := coalesce((p_data ->> 'all_day')::boolean, false);
  begin
    if e.all_day then
      e.start_date := (p_data ->> 'start_date')::date;
      e.end_date := coalesce((p_data ->> 'end_date')::date, e.start_date);
    else
      e.starts_at := (p_data ->> 'starts_at')::timestamptz;
      e.ends_at := coalesce((p_data ->> 'ends_at')::timestamptz, e.starts_at);
    end if;
    e.registration_deadline := nullif(p_data ->> 'registration_deadline', '')::timestamptz;
  exception when others then
    raise exception 'Data inválida. Usa o formato DD/MM/AAAA.';
  end;
  if e.all_day then
    if e.start_date is null then raise exception 'Indica o dia de início.'; end if;
    if e.end_date < e.start_date then raise exception 'O fim não pode ser antes do início.'; end if;
    if e.end_date - e.start_date > 366 then raise exception 'Uma atividade não pode durar mais de um ano.'; end if;
    v_start := (e.start_date + 1)::timestamp at time zone 'Europe/Lisbon';
  else
    if e.starts_at is null then raise exception 'Indica o dia e a hora de início.'; end if;
    if e.ends_at < e.starts_at then raise exception 'O fim não pode ser antes do início.'; end if;
    if e.ends_at - e.starts_at > interval '366 days' then raise exception 'Uma atividade não pode durar mais de um ano.'; end if;
    v_start := e.starts_at;
  end if;
  if e.registration_deadline is not null and e.registration_deadline > v_start then
    raise exception 'O prazo de inscrição tem de terminar antes do início da atividade.';
  end if;
  e.audience := coalesce(nullif(p_data ->> 'audience', ''), 'seccao');
  if e.audience not in ('seccao', 'equipa') then raise exception 'Público inválido.'; end if;
  if e.audience = 'equipa' then
    e.team_id := nullif(p_data ->> 'team_id', '')::uuid;
    if e.team_id is null then raise exception 'Escolhe a equipa.'; end if;
    if not exists (select 1 from public.teams t where t.id = e.team_id and t.section_id = p_section and t.archived_at is null) then
      raise exception 'Equipa não encontrada nesta secção.';
    end if;
  end if;
  e.responsible_id := nullif(p_data ->> 'responsible_id', '')::uuid;
  if e.responsible_id is not null and not exists (
    select 1 from public.memberships m where m.profile_id = e.responsible_id and m.section_id = p_section and m.status = 'ativo') then
    raise exception 'O responsável tem de ser membro ativo da secção.';
  end if;
  e.needs_authorization := coalesce((p_data ->> 'needs_authorization')::boolean, false);
  e.needs_payment := coalesce((p_data ->> 'needs_payment')::boolean, false);
  e.needs_registration := coalesce((p_data ->> 'needs_registration')::boolean, false);
  e.reminder_minutes := case when p_data ? 'reminder_minutes'
    then array(select distinct x::int from jsonb_array_elements_text(p_data -> 'reminder_minutes') x order by 1 desc) else '{1440}' end;
  e.deadline_reminder_minutes := case when p_data ? 'deadline_reminder_minutes'
    then array(select distinct x::int from jsonb_array_elements_text(p_data -> 'deadline_reminder_minutes') x order by 1 desc) else '{1440}' end;
  if cardinality(e.reminder_minutes) > 5 or cardinality(e.deadline_reminder_minutes) > 5 then
    raise exception 'No máximo cinco lembretes de cada tipo.';
  end if;
  if exists (select 1 from unnest(e.reminder_minutes || e.deadline_reminder_minutes) m where m < 5 or m > 43200) then
    raise exception 'Os lembretes têm de ser entre 5 minutos e 30 dias antes.';
  end if;
  return e;
end
$$;

-- Evento em formato JSON (para listas e detalhe).
create or replace function private.cal_event_json(e public.cal_events)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'title', e.title, 'description', e.description, 'location', e.location,
    'all_day', e.all_day, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'start_date', e.start_date, 'end_date', e.end_date,
    'audience', e.audience, 'team_id', e.team_id, 'team_name', (select t.name from public.teams t where t.id = e.team_id),
    'responsible_id', e.responsible_id,
    'responsible_name', (select p.full_name from public.profiles p where p.id = e.responsible_id),
    'registration_deadline', e.registration_deadline,
    'deadline_passed', e.registration_deadline is not null and now() > e.registration_deadline,
    'needs_authorization', e.needs_authorization, 'needs_payment', e.needs_payment, 'needs_registration', e.needs_registration,
    'material', e.material, 'required', to_jsonb(private.cal_required(e)),
    'reminder_minutes', to_jsonb(e.reminder_minutes), 'deadline_reminder_minutes', to_jsonb(e.deadline_reminder_minutes),
    'status', e.status, 'cancel_reason', e.cancel_reason, 'cancelled_at', e.cancelled_at,
    'updated_at', e.updated_at, 'created_at', e.created_at)
$$;

-- ---------------------------------------------------------------------------
-- Consultas
-- ---------------------------------------------------------------------------
-- Atividades que se sobrepõem ao intervalo [p_from, p_to] (dias em Lisboa).
create or replace function public.cal_events_list(p_section uuid, p_from date, p_to date, p_only_mine boolean default false)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'calendario'); v_me uuid := auth.uid();
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Intervalo de datas inválido.'; end if;
  if p_to - p_from > 400 then raise exception 'Intervalo de datas demasiado longo.'; end if;
  return coalesce((
    select jsonb_agg(private.cal_event_json(e) || jsonb_build_object(
      'involved', v_me = any (x.inv),
      'my_response', c.response,
      'my_missing', case when v_me = any (x.inv) then to_jsonb(private.cal_missing(e, c)) else '[]'::jsonb end,
      'counts', (select jsonb_build_object(
          'vou', count(*) filter (where cc.response = 'vou'),
          'nao_vou', count(*) filter (where cc.response = 'nao_vou'),
          'por_confirmar', count(*) filter (where cc.response = 'por_confirmar'),
          'total', cardinality(x.inv))
        from public.cal_participants cc where cc.event_id = e.id and cc.profile_id = any (x.inv)))
      order by coalesce(e.starts_at, e.start_date::timestamp at time zone 'Europe/Lisbon'), e.title)
    from public.cal_events e
    cross join lateral (select private.cal_involved(e.id) as inv) x
    left join public.cal_participants c on c.event_id = e.id and c.profile_id = v_me
    where e.section_id = p_section and e.space = v_space
      and coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date) <= p_to
      and coalesce(e.end_date, (greatest(e.starts_at, e.ends_at - interval '1 microsecond') at time zone 'Europe/Lisbon')::date) >= p_from
      and (not coalesce(p_only_mine, false) or v_me = any (x.inv))
  ), '[]'::jsonb);
end
$$;

-- Detalhe: atividade, a minha participação e a lista de participantes. Notas e pendências
-- de outras pessoas só aparecem a quem gere o calendário e ao responsável da atividade.
create or replace function public.cal_event_get(p_section uuid, p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'calendario'); v_me uuid := auth.uid();
  e public.cal_events; v_manage boolean; v_inv uuid[]; v_see_all boolean; c public.cal_participants;
begin
  e := private.cal_event_of(p_section, v_space, p_event);
  v_manage := private.cal_can_manage(p_section);
  v_inv := private.cal_involved(p_event);
  v_see_all := v_manage or e.responsible_id = v_me;
  select * into c from public.cal_participants where event_id = e.id and profile_id = v_me;
  return private.cal_event_json(e) || jsonb_build_object(
    'can_manage', v_manage,
    'can_see_pending', v_see_all,
    'involved', v_me = any (v_inv),
    'can_respond', e.status = 'ativo' and (v_manage or v_me = any (v_inv))
                   and (v_manage or e.registration_deadline is null or now() <= e.registration_deadline),
    'me', jsonb_build_object('response', c.response, 'note', c.note, 'responded_at', c.responded_at,
                             'missing', case when v_me = any (v_inv) then to_jsonb(private.cal_missing(e, c)) else '[]'::jsonb end),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile_id', p.id, 'name', p.full_name, 'team_name', t.name, 'function', m.function,
        'is_me', p.id = v_me, 'is_responsible', p.id = e.responsible_id,
        'response', pc.response, 'note', case when v_see_all or p.id = v_me then pc.note end,
        'responded_at', pc.responded_at,
        'missing', case when v_see_all or p.id = v_me then to_jsonb(private.cal_missing(e, pc)) end
      ) order by p.full_name)
      from unnest(v_inv) as i(pid)
      join public.profiles p on p.id = i.pid
      join public.memberships m on m.profile_id = p.id and m.section_id = p_section and m.status = 'ativo'
      left join public.teams t on t.id = m.team_id
      left join public.cal_participants pc on pc.event_id = e.id and pc.profile_id = p.id
    ), '[]'::jsonb));
end
$$;

-- O que falta à pessoa atual nas próximas atividades (resumo «O que te falta»).
create or replace function public.cal_my_pending(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'calendario'); v_me uuid := auth.uid();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'all_day', e.all_day, 'starts_at', e.starts_at,
             'ends_at', e.ends_at, 'start_date', e.start_date, 'end_date', e.end_date, 'registration_deadline', e.registration_deadline,
             'deadline_passed', e.registration_deadline is not null and now() > e.registration_deadline,
             'missing', to_jsonb(private.cal_missing(e, c)))
           order by coalesce(e.starts_at, e.start_date::timestamp at time zone 'Europe/Lisbon'))
      from public.cal_events e
      left join public.cal_participants c on c.event_id = e.id and c.profile_id = v_me
     where e.section_id = p_section and e.space = v_space and e.status = 'ativo'
       and coalesce(e.end_date, (greatest(e.starts_at, e.ends_at - interval '1 microsecond') at time zone 'Europe/Lisbon')::date) >= (now() at time zone 'Europe/Lisbon')::date
       and v_me = any (private.cal_involved(e.id))
       and cardinality(private.cal_missing(e, c)) > 0
  ), '[]'::jsonb);
end
$$;

-- Equipas e membros para o formulário (só quem gere).
create or replace function public.cal_form_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
  return jsonb_build_object(
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                         from public.teams t where t.section_id = p_section and t.archived_at is null), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'function', m.function, 'team_id', m.team_id) order by p.full_name)
                           from public.memberships m join public.profiles p on p.id = m.profile_id
                          where m.section_id = p_section and m.status = 'ativo'), '[]'::jsonb));
end
$$;

-- Contrato para outros módulos (Inventário, Tesouraria, Secretaria): lista leve das
-- atividades do espaço atual, para ligar registos a uma atividade. Por omissão exige acesso
-- ao Calendário; com p_module = módulo que chama, exige acesso a ESSE módulo e usa o espaço
-- dele (teste/real) — quem usa o Inventário pode escolher uma atividade sem ter acesso ao
-- Calendário. Devolve só id, título, datas e estado (sem participantes nem pendências).
create or replace function public.cal_event_options(p_section uuid, p_module text default 'calendario')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text;
begin
  if coalesce(p_module, '') not in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria') then
    raise exception 'Módulo inválido.';
  end if;
  v_space := private.module_require(p_section, p_module);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'all_day', e.all_day,
             'starts_at', e.starts_at, 'ends_at', e.ends_at, 'start_date', e.start_date, 'end_date', e.end_date, 'status', e.status)
           order by coalesce(e.starts_at, e.start_date::timestamp at time zone 'Europe/Lisbon') desc)
      from (select * from public.cal_events where section_id = p_section and space = v_space
             order by coalesce(starts_at, start_date::timestamp at time zone 'Europe/Lisbon') desc limit 500) e
  ), '[]'::jsonb);
end
$$;

-- Para funções de outros módulos: a atividade existe nesta secção e neste espaço?
create or replace function private.cal_event_exists(p_section uuid, p_space text, p_event uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.cal_events where id = p_event and section_id = p_section and space = p_space) $$;

-- ---------------------------------------------------------------------------
-- Gestão de atividades (dirigentes ou «calendario.gerir»)
-- ---------------------------------------------------------------------------
create or replace function public.cal_create_event(p_section uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
        e public.cal_events;
begin
  e := private.cal_from_json(p_section, p_data);
  e.id := gen_random_uuid();
  e.space := v_space; e.status := 'ativo';
  e.created_by := auth.uid(); e.created_at := now(); e.updated_by := auth.uid(); e.updated_at := now();
  insert into public.cal_events select e.*;
  perform private.audit(p_section, 'cal_evento_criado', 'cal_event', e.id::text, jsonb_build_object('space', v_space, 'title', e.title));
  perform private.cal_sync_reminders(e.id);
  perform private.module_notify(p_section, 'calendario', v_space, private.cal_involved(e.id), 'cal_evento_novo',
    left('Nova atividade: ' || e.title, 220), private.cal_when(e) || coalesce(' · ' || e.location, ''), '/calendario/evento/' || e.id);
  return e.id;
end
$$;

create or replace function public.cal_update_event(p_section uuid, p_event uuid, p_data jsonb, p_expected_updated_at timestamptz default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
        o public.cal_events; n public.cal_events; v_inv_before uuid[];
begin
  o := private.cal_event_of(p_section, v_space, p_event, true);
  n := private.cal_from_json(p_section, p_data);
  if o.status <> 'ativo' then raise exception 'Esta atividade foi cancelada e já não pode ser alterada.'; end if;
  if p_expected_updated_at is not null and date_trunc('milliseconds', o.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'A atividade foi alterada entretanto por outra pessoa. Atualiza a página e tenta de novo.';
  end if;
  v_inv_before := private.cal_involved(o.id);
  update public.cal_events set
    title = n.title, description = n.description, location = n.location, all_day = n.all_day,
    starts_at = n.starts_at, ends_at = n.ends_at, start_date = n.start_date, end_date = n.end_date,
    audience = n.audience, team_id = n.team_id, responsible_id = n.responsible_id,
    registration_deadline = n.registration_deadline, needs_authorization = n.needs_authorization,
    needs_payment = n.needs_payment, needs_registration = n.needs_registration, material = n.material,
    reminder_minutes = n.reminder_minutes, deadline_reminder_minutes = n.deadline_reminder_minutes,
    updated_by = auth.uid(), updated_at = now()
  where id = o.id returning * into n;
  perform private.audit(p_section, 'cal_evento_alterado', 'cal_event', o.id::text,
    jsonb_build_object('antes', private.cal_event_json(o), 'depois', private.cal_event_json(n)));
  perform private.cal_sync_reminders(o.id);
  -- Quem deixou de estar no público também é avisado da alteração.
  perform private.module_notify(p_section, 'calendario', v_space, v_inv_before || private.cal_involved(o.id), 'cal_evento_alterado',
    left('Atividade alterada: ' || n.title, 220), private.cal_when(n) || coalesce(' · ' || n.location, ''), '/calendario/evento/' || o.id);
end
$$;

create or replace function public.cal_cancel_event(p_section uuid, p_event uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
        e public.cal_events;
begin
  e := private.cal_event_of(p_section, v_space, p_event, true);
  if e.status = 'cancelado' then raise exception 'Esta atividade já está cancelada.'; end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'O motivo é demasiado longo (máximo 500 caracteres).'; end if;
  update public.cal_events set status = 'cancelado', cancel_reason = nullif(trim(coalesce(p_reason, '')), ''),
         cancelled_at = now(), cancelled_by = auth.uid(), updated_by = auth.uid(), updated_at = now()
   where id = e.id returning * into e;
  perform private.audit(p_section, 'cal_evento_cancelado', 'cal_event', e.id::text, jsonb_build_object('motivo', e.cancel_reason));
  perform private.cal_sync_reminders(e.id);
  perform private.module_notify(p_section, 'calendario', v_space, private.cal_involved(e.id), 'cal_evento_cancelado',
    left('Atividade cancelada: ' || e.title, 220), private.cal_when(e) || coalesce(' · ' || e.cancel_reason, ''), '/calendario/evento/' || e.id);
end
$$;

-- ---------------------------------------------------------------------------
-- Respostas e pendências
-- ---------------------------------------------------------------------------
-- Resposta do próprio (p_profile vazio) ou, por quem gere, de outra pessoa.
create or replace function public.cal_respond(p_section uuid, p_event uuid, p_response text, p_note text default null, p_profile uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'calendario'); v_me uuid := auth.uid();
        v_target uuid := coalesce(p_profile, auth.uid()); v_manage boolean := private.cal_can_manage(p_section);
        e public.cal_events; v_aud boolean;
begin
  e := private.cal_event_of(p_section, v_space, p_event, true);
  if coalesce(p_response, '') not in ('vou', 'nao_vou', 'por_confirmar') then raise exception 'Resposta inválida.'; end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'A nota é demasiado longa (máximo 500 caracteres).'; end if;
  if v_target <> v_me and not v_manage then
    raise exception 'Só podes alterar a tua própria resposta.' using errcode = '42501';
  end if;
  if e.status <> 'ativo' then raise exception 'Esta atividade foi cancelada e já não aceita respostas.'; end if;
  if not exists (select 1 from public.memberships m where m.profile_id = v_target and m.section_id = p_section and m.status = 'ativo') then
    raise exception 'Só membros ativos da secção podem participar.';
  end if;
  v_aud := private.cal_in_audience(e.id, v_target);
  if not v_aud and not v_manage and not exists (select 1 from public.cal_participants where event_id = e.id and profile_id = v_target and extra) then
    raise exception 'Esta atividade é só para a equipa indicada.' using errcode = '42501';
  end if;
  if e.registration_deadline is not null and now() > e.registration_deadline and not v_manage then
    raise exception 'O prazo de inscrição terminou a %. Fala com um dirigente.',
      to_char(e.registration_deadline at time zone 'Europe/Lisbon', 'DD/MM/YYYY, HH24:MI');
  end if;
  insert into public.cal_participants as c (event_id, profile_id, section_id, space, response, note, extra, responded_at, responded_by)
  values (e.id, v_target, p_section, v_space, p_response,
          case when v_target = v_me then nullif(trim(coalesce(p_note, '')), '') end, not v_aud, now(), v_me)
  on conflict (event_id, profile_id) do update set
    response = excluded.response,
    -- A nota é do próprio: quem gere não a altera.
    note = case when v_target = v_me then excluded.note else c.note end,
    extra = (c.extra or excluded.extra) and not v_aud,
    responded_at = now(), responded_by = v_me, updated_at = now();
  perform private.audit(p_section, 'cal_resposta', 'cal_event', e.id::text,
    jsonb_build_object('profile', v_target, 'resposta', p_response, 'por', v_me));
  perform private.cal_sync_reminders(e.id);
end
$$;

-- Gestores marcam (ou desmarcam) uma pendência resolvida para um participante.
create or replace function public.cal_set_pending(p_section uuid, p_event uuid, p_profile uuid, p_item text, p_done boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
        e public.cal_events; v_at timestamptz; v_by uuid;
begin
  e := private.cal_event_of(p_section, v_space, p_event, true);
  v_at := case when p_done then now() end;
  v_by := case when p_done then auth.uid() end;
  if coalesce(p_item, '') not in ('autorizacao', 'pagamento', 'inscricao', 'material') then raise exception 'Pendência inválida.'; end if;
  if e.status <> 'ativo' then raise exception 'Esta atividade foi cancelada.'; end if;
  if not (p_item = any (private.cal_required(e))) then raise exception 'Esta atividade não exige esta pendência.'; end if;
  if not (p_profile = any (private.cal_involved(e.id))) then raise exception 'Esta pessoa não participa nesta atividade.'; end if;
  insert into public.cal_participants (event_id, profile_id, section_id, space)
  values (e.id, p_profile, p_section, v_space) on conflict do nothing;
  update public.cal_participants set
    autorizacao_at = case when p_item = 'autorizacao' then v_at else autorizacao_at end,
    autorizacao_by = case when p_item = 'autorizacao' then v_by else autorizacao_by end,
    pagamento_at = case when p_item = 'pagamento' then v_at else pagamento_at end,
    pagamento_by = case when p_item = 'pagamento' then v_by else pagamento_by end,
    inscricao_at = case when p_item = 'inscricao' then v_at else inscricao_at end,
    inscricao_by = case when p_item = 'inscricao' then v_by else inscricao_by end,
    material_at = case when p_item = 'material' then v_at else material_at end,
    material_by = case when p_item = 'material' then v_by else material_by end,
    updated_at = now()
  where event_id = e.id and profile_id = p_profile;
  perform private.audit(p_section, 'cal_pendencia', 'cal_event', e.id::text,
    jsonb_build_object('profile', p_profile, 'item', p_item, 'resolvida', coalesce(p_done, false)));
  perform private.cal_sync_reminders(e.id);
end
$$;

-- Anexos das atividades (programa, autorizações em branco…): lê quem tem acesso ao módulo
-- no espaço da atividade; anexa ou retira quem gere.
create or replace function private.calendario_file_access(p_entity text, p_entity_id uuid, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare e public.cal_events;
begin
  if p_entity <> 'cal_event' then return false; end if;
  select * into e from public.cal_events where id = p_entity_id;
  if e.id is null or private.module_space(e.section_id, 'calendario') is distinct from e.space then return false; end if;
  if p_write then return e.status = 'ativo' and private.cal_can_manage(e.section_id); end if;
  return true;
end
$$;

-- Publicar com «passar dados de teste a reais»: além das tabelas cal_*, os lembretes ainda
-- por enviar destas atividades passam também ao espaço real (senão nunca seriam enviados,
-- porque o envio exige o espaço do estado atual). Os já enviados ficam como estavam.
create or replace function private.calendario_publish_move(p_section uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_t text;
begin
  foreach v_t in array private.module_tables('calendario') loop
    execute format('update public.%I set space = ''real'' where section_id = $1 and space = ''teste''', v_t) using p_section;
  end loop;
  update public.module_reminders set space = 'real'
   where section_id = p_section and module = 'calendario' and space = 'teste' and sent_at is null;
end
$$;

revoke all on function private.calendario_publish_move(uuid) from public, anon, authenticated;
revoke all on function private.cal_sync_reminders(uuid), private.cal_from_json(uuid, jsonb),
  private.cal_event_of(uuid, text, uuid, boolean) from public, anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;


-- ===== 20261021000300_inventario.sql =====
-- Pioneiros — Inventário: material da secção, categorias, peças identificadas,
-- empréstimos (com pedidos sujeitos a aprovação), devoluções totais e parciais,
-- reservas ligadas a atividades do calendário, alertas, lembretes e histórico.
--
-- • Todas as tabelas têm section_id e space (teste/real) e RLS sem políticas: leitura e
--   escrita só através das funções public.inv_*, que verificam o acesso no servidor.
-- • Editar exige ser dirigente ou ter «inventario.gerir». Quem só tem acesso consulta e
--   pode pedir empréstimos, que ficam a aguardar aprovação.
-- • Disponibilidade: capacidade (unidades ou peças utilizáveis) menos o que está
--   comprometido por empréstimos ativos e reservas sobrepostas ao período. Cada operação
--   bloqueia a linha do artigo (select … for update) antes de validar, para que
--   operações simultâneas não ultrapassem o disponível. Nunca há quantidades negativas.
-- • Nada se apaga: artigos retirados ficam arquivados; o histórico de movimentos
--   (inv_movements) regista entradas, saídas, empréstimos, devoluções, reservas,
--   mudanças de estado e ajustes.
-- Aditivo: não altera dados nem permissões existentes.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.inv_categories (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  name text not null check (length(trim(name)) between 1 and 80),
  archived_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create unique index if not exists inv_categories_name on public.inv_categories (section_id, space, lower(trim(name)));
alter table public.inv_categories enable row level security;

create table if not exists public.inv_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  category_id uuid references public.inv_categories (id),
  name text not null check (length(trim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 2000),
  unit text not null default 'un.' check (length(trim(unit)) between 1 and 20),
  location text check (location is null or length(location) <= 120),
  -- «quantidade»: unidades indistintas; «pecas»: cada peça identificada individualmente.
  tracking text not null default 'quantidade' check (tracking in ('quantidade', 'pecas')),
  quantity integer not null default 0 check (quantity >= 0),
  qty_damaged integer not null default 0 check (qty_damaged >= 0),
  qty_repair integer not null default 0 check (qty_repair >= 0),
  min_quantity integer check (min_quantity is null or min_quantity >= 0),
  archived_at timestamptz,
  archived_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (qty_damaged + qty_repair <= quantity),
  check (tracking = 'quantidade' or (quantity = 0 and qty_damaged = 0 and qty_repair = 0))
);
create index if not exists inv_items_section on public.inv_items (section_id, space);
alter table public.inv_items enable row level security;

create table if not exists public.inv_pieces (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  item_id uuid not null references public.inv_items (id),
  code text not null check (length(trim(code)) between 1 and 60),
  serial text check (serial is null or length(serial) <= 80),
  status text not null default 'disponivel' check (status in ('disponivel', 'danificado', 'reparacao', 'retirado')),
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create unique index if not exists inv_pieces_code on public.inv_pieces (item_id, lower(trim(code)));
create index if not exists inv_pieces_item on public.inv_pieces (item_id);
alter table public.inv_pieces enable row level security;

create table if not exists public.inv_reservations (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  item_id uuid not null references public.inv_items (id),
  event_id uuid references public.cal_events (id),
  quantity integer not null check (quantity > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'ativa' check (status in ('ativa', 'cancelada', 'concluida')),
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz,
  close_note text,
  check (ends_at > starts_at)
);
create index if not exists inv_reservations_item on public.inv_reservations (item_id, status);
alter table public.inv_reservations enable row level security;

create table if not exists public.inv_loans (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  item_id uuid not null references public.inv_items (id),
  borrower_id uuid not null references public.profiles (id),
  quantity integer not null check (quantity > 0),
  returned_qty integer not null default 0,
  out_at timestamptz not null,
  due_at timestamptz not null,
  status text not null check (status in ('pedido', 'ativo', 'devolvido', 'recusado', 'cancelado')),
  reservation_id uuid references public.inv_reservations (id),
  notes text check (notes is null or length(notes) <= 500),
  remind_hours integer not null default 24 check (remind_hours between 0 and 336),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  returned_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (returned_qty between 0 and quantity),
  check (due_at > out_at)
);
create index if not exists inv_loans_item on public.inv_loans (item_id, status);
create index if not exists inv_loans_section on public.inv_loans (section_id, space, status);
alter table public.inv_loans enable row level security;

create table if not exists public.inv_loan_pieces (
  loan_id uuid not null references public.inv_loans (id),
  piece_id uuid not null references public.inv_pieces (id),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  returned_at timestamptz,
  returned_status text check (returned_status is null or returned_status in ('disponivel', 'danificado', 'reparacao')),
  primary key (loan_id, piece_id)
);
create index if not exists inv_loan_pieces_piece on public.inv_loan_pieces (piece_id) where returned_at is null;
alter table public.inv_loan_pieces enable row level security;

-- Histórico de movimentos: só se acrescenta, nunca se altera nem apaga.
create table if not exists public.inv_movements (
  id bigint generated always as identity primary key,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  item_id uuid not null references public.inv_items (id),
  piece_id uuid references public.inv_pieces (id),
  loan_id uuid references public.inv_loans (id),
  reservation_id uuid references public.inv_reservations (id),
  kind text not null check (kind in (
    'criacao', 'edicao', 'entrada', 'saida', 'ajuste', 'estado', 'peca',
    'pedido', 'pedido_aprovado', 'pedido_recusado', 'pedido_cancelado',
    'emprestimo', 'devolucao', 'prazo', 'reserva', 'reserva_cancelada', 'reserva_concluida',
    'arquivo', 'reativacao')),
  quantity integer,
  from_state text,
  to_state text,
  note text,
  actor uuid,
  at timestamptz not null default now()
);
create index if not exists inv_movements_item on public.inv_movements (item_id, at desc);
alter table public.inv_movements enable row level security;

create or replace function private.inv_movements_immutable() returns trigger language plpgsql set search_path = ''
as $$
begin
  -- Única alteração permitida: passar dados de teste para reais ao publicar o módulo.
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'space') = (to_jsonb(old) - 'space') and old.space = 'teste' and new.space = 'real' then
    return new;
  end if;
  raise exception 'O histórico do inventário não pode ser alterado nem apagado.';
end
$$;
drop trigger if exists inv_movements_immutable on public.inv_movements;
create trigger inv_movements_immutable before update or delete on public.inv_movements
  for each row execute function private.inv_movements_immutable();

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
create or replace function private.inv_can_manage(p_section uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select private.module_can(p_section, 'inventario', 'inventario.gerir', true) $$;

-- Responsáveis pelo material: dirigentes e quem tem «inventario.gerir».
create or replace function private.inv_managers(p_section uuid) returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct p), '{}') from (
    select unnest(private.section_dirigentes(p_section)) p
    union select g.profile_id from public.module_grants g where g.section_id = p_section and g.permission = 'inventario.gerir'
  ) x
$$;

create or replace function private.inv_log(
  i public.inv_items, p_kind text, p_qty integer, p_from text, p_to text, p_note text,
  p_piece uuid default null, p_loan uuid default null, p_res uuid default null
) returns void language sql security definer set search_path = ''
as $$
  insert into public.inv_movements (section_id, space, item_id, piece_id, loan_id, reservation_id, kind, quantity, from_state, to_state, note, actor)
  values (i.section_id, i.space, i.id, p_piece, p_loan, p_res, p_kind, p_qty, p_from, p_to, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
$$;

-- Artigo da secção e do espaço indicados (com bloqueio da linha, para validar disponibilidade).
create or replace function private.inv_item_locked(p_section uuid, p_space text, p_item uuid) returns public.inv_items
language plpgsql security definer set search_path = ''
as $$
declare i public.inv_items;
begin
  select * into i from public.inv_items where id = p_item and section_id = p_section and space = p_space for update;
  if i.id is null then raise exception 'Registo não encontrado.'; end if;
  return i;
end
$$;

-- Capacidade utilizável (excluindo danificadas, em reparação e retiradas).
create or replace function private.inv_counts(p_item uuid, out total integer, out damaged integer, out repair integer)
language plpgsql stable security definer set search_path = ''
as $$
declare i public.inv_items;
begin
  select * into i from public.inv_items where id = p_item;
  if i.tracking = 'pecas' then
    select count(*) filter (where status <> 'retirado'), count(*) filter (where status = 'danificado'), count(*) filter (where status = 'reparacao')
      into total, damaged, repair from public.inv_pieces where item_id = p_item;
  else
    total := i.quantity; damaged := i.qty_damaged; repair := i.qty_repair;
  end if;
end
$$;

-- Máximo de unidades comprometidas em simultâneo no período [p_from, p_to).
-- Empréstimos ativos ocupam do levantamento ao prazo (se o prazo já passou sem devolução,
-- continuam a ocupar indefinidamente); reservas ativas ocupam o seu período.
create or replace function private.inv_peak(p_item uuid, p_from timestamptz, p_to timestamptz, p_skip_loan uuid default null, p_skip_res uuid default null)
returns integer language sql stable security definer set search_path = ''
as $$
  with c as (
    select l.out_at s, case when l.due_at <= now() then 'infinity'::timestamptz else l.due_at end e, l.quantity - l.returned_qty q
      from public.inv_loans l
     where l.item_id = p_item and l.status = 'ativo' and l.returned_qty < l.quantity and l.id is distinct from p_skip_loan
    union all
    select r.starts_at, r.ends_at, r.quantity from public.inv_reservations r
     where r.item_id = p_item and r.status = 'ativa' and r.id is distinct from p_skip_res
  ), o as (select * from c where c.s < p_to and c.e > p_from),
  pts as (select p_from t union select o.s from o where o.s > p_from)
  select coalesce(max((select coalesce(sum(o.q), 0) from o where o.s <= pts.t and o.e > pts.t)), 0)::int from pts
$$;

-- Máximo de unidades emprestadas em simultâneo de agora em diante (só empréstimos).
create or replace function private.inv_loan_peak(p_item uuid)
returns integer language sql stable security definer set search_path = ''
as $$
  with o as (
    select greatest(l.out_at, now()) s, case when l.due_at <= now() then 'infinity'::timestamptz else l.due_at end e, l.quantity - l.returned_qty q
      from public.inv_loans l where l.item_id = p_item and l.status = 'ativo' and l.returned_qty < l.quantity
  ), pts as (select now() t union select o.s from o)
  select coalesce(max((select coalesce(sum(o.q), 0) from o where o.s <= pts.t and o.e > pts.t)), 0)::int from pts
$$;

create or replace function private.inv_free(p_item uuid, p_from timestamptz, p_to timestamptz, p_skip_loan uuid default null, p_skip_res uuid default null)
returns integer language sql stable security definer set search_path = ''
as $$
  select c.total - c.damaged - c.repair - private.inv_peak(p_item, p_from, p_to, p_skip_loan, p_skip_res)
    from private.inv_counts(p_item) c
$$;

create or replace function private.inv_require_free(i public.inv_items, p_qty integer, p_from timestamptz, p_to timestamptz,
  p_skip_loan uuid default null, p_skip_res uuid default null)
returns void language plpgsql stable security definer set search_path = ''
as $$
declare v_free integer := private.inv_free(i.id, p_from, p_to, p_skip_loan, p_skip_res);
begin
  if p_qty > v_free then
    raise exception 'Quantidade indisponível nesse período: só há % % livre(s) de «%».', greatest(v_free, 0), i.unit, i.name;
  end if;
end
$$;

-- Estado atual de um artigo (contagens e estados presentes).
create or replace function private.inv_stock(p_item uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare c record; v_lent int; v_res_now int; v_res_next int; v_avail int; v_states text[] := '{}';
begin
  select * into c from private.inv_counts(p_item);
  select coalesce(sum(quantity - returned_qty), 0) into v_lent from public.inv_loans
   where item_id = p_item and status = 'ativo' and out_at <= now();
  select coalesce(sum(quantity) filter (where starts_at <= now()), 0), count(*) into v_res_now, v_res_next
    from public.inv_reservations where item_id = p_item and status = 'ativa' and ends_at > now();
  v_avail := greatest(c.total - c.damaged - c.repair - v_lent - v_res_now, 0);
  if v_avail > 0 then v_states := array_append(v_states, 'disponivel'); end if;
  if v_lent > 0 then v_states := array_append(v_states, 'emprestado'); end if;
  if v_res_next > 0 then v_states := array_append(v_states, 'reservado'); end if;
  if c.damaged > 0 then v_states := array_append(v_states, 'danificado'); end if;
  if c.repair > 0 then v_states := array_append(v_states, 'reparacao'); end if;
  return jsonb_build_object('total', c.total, 'damaged', c.damaged, 'repair', c.repair, 'lent', v_lent,
    'reserved', v_res_now, 'reservations', v_res_next, 'available', v_avail, 'states', to_jsonb(v_states));
end
$$;

create or replace function private.inv_name(p_profile uuid) returns text
language sql stable security definer set search_path = ''
as $$ select coalesce(nullif(trim(full_name), ''), 'Sem nome') from public.profiles where id = p_profile $$;

create or replace function private.inv_fmt(p timestamptz) returns text
language sql stable set search_path = ''
as $$ select to_char(p at time zone 'Europe/Lisbon', 'DD/MM/YYYY HH24:MI') $$;

-- Lembretes de devolução ao responsável do empréstimo e aos gestores (sem duplicados).
create or replace function private.inv_schedule_loan_reminders(l public.inv_loans) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_item public.inv_items; v_p uuid; v_body text;
begin
  perform private.cancel_reminders('inv_loan', l.id);
  if l.status <> 'ativo' or l.returned_qty >= l.quantity then return; end if;
  select * into v_item from public.inv_items where id = l.item_id;
  v_body := v_item.name || ' · ' || (l.quantity - l.returned_qty) || ' ' || v_item.unit || ' · prazo ' || private.inv_fmt(l.due_at);
  foreach v_p in array (select array_agg(distinct x) from unnest(private.inv_managers(l.section_id) || l.borrower_id) x) loop
    if l.remind_hours > 0 and l.due_at - make_interval(hours => l.remind_hours) > now() then
      perform private.schedule_reminder(l.section_id, 'inventario', l.space, 'inv_loan', l.id, 'devolucao_antes', v_p,
        l.due_at - make_interval(hours => l.remind_hours), 'Devolução de material em breve', v_body, '/inventario/emprestimos');
    end if;
    perform private.schedule_reminder(l.section_id, 'inventario', l.space, 'inv_loan', l.id, 'devolucao_prazo', v_p,
      l.due_at, 'Prazo de devolução de material', v_body, '/inventario/emprestimos');
  end loop;
end
$$;

-- Período de uma atividade do calendário (dia inteiro: das 00:00 do primeiro dia às 00:00 do dia seguinte ao último).
create or replace function private.inv_event_period(e public.cal_events, out starts_at timestamptz, out ends_at timestamptz)
language plpgsql stable set search_path = ''
as $$
begin
  if e.all_day then
    starts_at := e.start_date::timestamp at time zone 'Europe/Lisbon';
    ends_at := (e.end_date + 1)::timestamp at time zone 'Europe/Lisbon';
  else
    starts_at := e.starts_at;
    ends_at := greatest(e.ends_at, e.starts_at + interval '1 hour');
  end if;
end
$$;

-- Anexos (fotografia do artigo): ler com acesso ao módulo; anexar ou retirar só quem gere.
create or replace function private.inventario_file_access(p_entity text, p_entity_id uuid, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare i public.inv_items;
begin
  if p_entity <> 'item' then return false; end if;
  select * into i from public.inv_items where id = p_entity_id;
  if i.id is null then return false; end if;
  if private.module_space(i.section_id, 'inventario') is distinct from i.space then return false; end if;
  return not p_write or private.inv_can_manage(i.section_id);
end
$$;

-- ---------------------------------------------------------------------------
-- Consulta
-- ---------------------------------------------------------------------------
create or replace function private.inv_item_json(i public.inv_items) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'name', i.name, 'description', i.description, 'unit', i.unit, 'location', i.location,
    'tracking', i.tracking, 'category_id', i.category_id,
    'category', (select c.name from public.inv_categories c where c.id = i.category_id),
    'min_quantity', i.min_quantity, 'archived_at', i.archived_at, 'updated_at', i.updated_at,
    'has_photo', exists (select 1 from public.module_files f where f.module = 'inventario' and f.entity = 'item'
                          and f.entity_id = i.id and f.removed_at is null),
    'stock', private.inv_stock(i.id))
$$;

create or replace function public.inv_overview(p_section uuid, p_archived boolean default false)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'inventario');
begin
  return jsonb_build_object(
    'can_manage', private.inv_can_manage(p_section),
    'me', auth.uid(),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'archived', c.archived_at is not null,
                       'items', (select count(*) from public.inv_items i where i.category_id = c.id and i.archived_at is null))
                     order by lower(c.name)) from public.inv_categories c where c.section_id = p_section and c.space = v_space), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(distinct i.location order by i.location) from public.inv_items i
                     where i.section_id = p_section and i.space = v_space and i.location is not null and i.archived_at is null), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(private.inv_item_json(i) order by lower(i.name)) from public.inv_items i
                where i.section_id = p_section and i.space = v_space
                  and (case when coalesce(p_archived, false) then i.archived_at is not null else i.archived_at is null end)), '[]'::jsonb),
    'pending_requests', (select count(*) from public.inv_loans l where l.section_id = p_section and l.space = v_space and l.status = 'pedido'),
    'overdue', (select count(*) from public.inv_loans l where l.section_id = p_section and l.space = v_space and l.status = 'ativo'
                  and l.returned_qty < l.quantity and l.due_at < now()));
end
$$;

create or replace function private.inv_loan_json(l public.inv_loans) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id, 'item_id', l.item_id, 'item', i.name, 'unit', i.unit, 'tracking', i.tracking,
    'borrower_id', l.borrower_id, 'borrower', private.inv_name(l.borrower_id),
    'quantity', l.quantity, 'returned_qty', l.returned_qty, 'out_at', l.out_at, 'due_at', l.due_at, 'status', l.status,
    'overdue', l.status = 'ativo' and l.returned_qty < l.quantity and l.due_at < now(),
    'notes', l.notes, 'remind_hours', l.remind_hours, 'reservation_id', l.reservation_id,
    'requested_by', private.inv_name(l.requested_by), 'requested_at', l.requested_at,
    'decided_by', case when l.decided_by is not null then private.inv_name(l.decided_by) end, 'decided_at', l.decided_at,
    'decision_note', l.decision_note, 'returned_at', l.returned_at,
    'pieces', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'serial', p.serial,
                 'returned_at', lp.returned_at, 'returned_status', lp.returned_status) order by p.code)
               from public.inv_loan_pieces lp join public.inv_pieces p on p.id = lp.piece_id where lp.loan_id = l.id), '[]'::jsonb))
  from public.inv_items i where i.id = l.item_id
$$;

create or replace function private.inv_res_json(r public.inv_reservations) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'item_id', r.item_id, 'item', i.name, 'unit', i.unit, 'quantity', r.quantity,
    'starts_at', r.starts_at, 'ends_at', r.ends_at, 'status', r.status, 'notes', r.notes,
    'event_id', r.event_id, 'event', e.title, 'event_cancelled', e.status = 'cancelado',
    'created_by', private.inv_name(r.created_by), 'created_at', r.created_at, 'close_note', r.close_note,
    'at_risk', r.status = 'ativa' and r.ends_at > now()
               and private.inv_free(r.item_id, greatest(r.starts_at, now()), r.ends_at, null, r.id) < r.quantity)
  from public.inv_items i left join public.cal_events e on e.id = r.event_id where i.id = r.item_id
$$;

create or replace function public.inv_item(p_section uuid, p_item uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'inventario'); i public.inv_items;
begin
  select * into i from public.inv_items where id = p_item and section_id = p_section and space = v_space;
  if i.id is null then raise exception 'Registo não encontrado.'; end if;
  return private.inv_item_json(i) || jsonb_build_object(
    'can_manage', private.inv_can_manage(p_section),
    'pieces', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'serial', p.serial, 'notes', p.notes,
                  'status', case when p.status = 'disponivel' and exists (select 1 from public.inv_loan_pieces lp join public.inv_loans l on l.id = lp.loan_id
                                   where lp.piece_id = p.id and lp.returned_at is null and l.status = 'ativo') then 'emprestado' else p.status end)
                order by lower(p.code)) from public.inv_pieces p where p.item_id = i.id), '[]'::jsonb),
    'loans', coalesce((select jsonb_agg(private.inv_loan_json(l) order by (l.status in ('pedido', 'ativo')) desc, l.due_at)
               from public.inv_loans l where l.item_id = i.id and (l.status in ('pedido', 'ativo') or l.updated_at > now() - interval '90 days')), '[]'::jsonb),
    'reservations', coalesce((select jsonb_agg(private.inv_res_json(r) order by r.starts_at)
               from public.inv_reservations r where r.item_id = i.id and r.status = 'ativa' and r.ends_at > now()), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'quantity', m.quantity, 'from_state', m.from_state,
                  'to_state', m.to_state, 'note', m.note, 'at', m.at, 'actor', case when m.actor is not null then private.inv_name(m.actor) end,
                  'piece', (select p.code from public.inv_pieces p where p.id = m.piece_id),
                  'borrower', (select private.inv_name(l.borrower_id) from public.inv_loans l where l.id = m.loan_id)) order by m.id desc)
               from (select * from public.inv_movements where item_id = i.id order by id desc limit 200) m), '[]'::jsonb));
end
$$;

-- Empréstimos e pedidos. p_status: null (ativos e pedidos), 'pedido', 'ativo', 'atrasado', 'fechado', 'todos'.
create or replace function public.inv_loans(p_section uuid, p_status text default null, p_mine boolean default false)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'inventario');
begin
  return coalesce((select jsonb_agg(private.inv_loan_json(l) order by
      case l.status when 'pedido' then 0 when 'ativo' then 1 else 2 end,
      case when l.status in ('pedido', 'ativo') then l.due_at end, l.updated_at desc)
    from public.inv_loans l
   where l.section_id = p_section and l.space = v_space
     and (not coalesce(p_mine, false) or l.borrower_id = auth.uid() or l.requested_by = auth.uid())
     and case coalesce(p_status, '')
           when '' then l.status in ('pedido', 'ativo')
           when 'pedido' then l.status = 'pedido'
           when 'ativo' then l.status = 'ativo'
           when 'atrasado' then l.status = 'ativo' and l.due_at < now()
           when 'fechado' then l.status in ('devolvido', 'recusado', 'cancelado')
           else true end), '[]'::jsonb);
end
$$;

create or replace function public.inv_reservations(p_section uuid, p_past boolean default false)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'inventario');
begin
  return coalesce((select jsonb_agg(private.inv_res_json(r) order by r.starts_at)
    from public.inv_reservations r
   where r.section_id = p_section and r.space = v_space
     and case when coalesce(p_past, false) then not (r.status = 'ativa' and r.ends_at > now())
              else r.status = 'ativa' and r.ends_at > now() end), '[]'::jsonb);
end
$$;

-- Atividades do calendário (mesma secção e espaço) a que se podem ligar reservas.
create or replace function public.inv_event_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'inventario');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'all_day', e.all_day,
             'starts_at', p.starts_at, 'ends_at', p.ends_at) order by p.starts_at)
    from public.cal_events e cross join lateral private.inv_event_period(e) p
   where e.section_id = p_section and e.space = v_space and e.status = 'ativo' and p.ends_at > now() - interval '1 day'), '[]'::jsonb);
end
$$;

-- Membros ativos (para escolher o responsável de um empréstimo).
create or replace function public.inv_people(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.module_require(p_section, 'inventario');
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(trim(p.full_name), ''), 'Sem nome'))
                    order by lower(p.full_name))
    from public.memberships m join public.profiles p on p.id = m.profile_id
   where m.section_id = p_section and m.status = 'ativo'), '[]'::jsonb);
end
$$;

-- Quantidade livre de um artigo num período (para orientar o formulário).
create or replace function public.inv_availability(p_section uuid, p_item uuid, p_from timestamptz, p_to timestamptz)
returns integer language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'inventario');
begin
  if not exists (select 1 from public.inv_items where id = p_item and section_id = p_section and space = v_space) then
    raise exception 'Registo não encontrado.';
  end if;
  if p_to is null or p_from is null or p_to <= p_from then raise exception 'O fim tem de ser depois do início.'; end if;
  return greatest(private.inv_free(p_item, p_from, p_to), 0);
end
$$;

-- Alertas: devoluções atrasadas ou próximas, quantidade mínima, reparação, danificados,
-- reservas em risco e pedidos por decidir.
create or replace function public.inv_alerts(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'inventario');
begin
  return jsonb_build_object(
    'overdue', coalesce((select jsonb_agg(private.inv_loan_json(l) order by l.due_at) from public.inv_loans l
        where l.section_id = p_section and l.space = v_space and l.status = 'ativo' and l.returned_qty < l.quantity and l.due_at < now()), '[]'::jsonb),
    'due_soon', coalesce((select jsonb_agg(private.inv_loan_json(l) order by l.due_at) from public.inv_loans l
        where l.section_id = p_section and l.space = v_space and l.status = 'ativo' and l.returned_qty < l.quantity
          and l.due_at >= now() and l.due_at < now() + interval '48 hours'), '[]'::jsonb),
    'low_stock', coalesce((select jsonb_agg(private.inv_item_json(i) order by lower(i.name)) from public.inv_items i
        where i.section_id = p_section and i.space = v_space and i.archived_at is null and i.min_quantity is not null
          and (private.inv_stock(i.id) ->> 'available')::int < i.min_quantity), '[]'::jsonb),
    'repair', coalesce((select jsonb_agg(private.inv_item_json(i) order by lower(i.name)) from public.inv_items i
        where i.section_id = p_section and i.space = v_space and i.archived_at is null
          and ((private.inv_stock(i.id) ->> 'repair')::int > 0)), '[]'::jsonb),
    'damaged', coalesce((select jsonb_agg(private.inv_item_json(i) order by lower(i.name)) from public.inv_items i
        where i.section_id = p_section and i.space = v_space and i.archived_at is null
          and ((private.inv_stock(i.id) ->> 'damaged')::int > 0)), '[]'::jsonb),
    'at_risk', coalesce((select jsonb_agg(x.j order by x.s) from (select private.inv_res_json(r) j, r.starts_at s from public.inv_reservations r
        where r.section_id = p_section and r.space = v_space and r.status = 'ativa' and r.ends_at > now()) x where (x.j ->> 'at_risk')::boolean), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(private.inv_loan_json(l) order by l.requested_at) from public.inv_loans l
        where l.section_id = p_section and l.space = v_space and l.status = 'pedido'), '[]'::jsonb));
end
$$;

-- ---------------------------------------------------------------------------
-- Categorias e artigos (gestão)
-- ---------------------------------------------------------------------------
create or replace function public.inv_category_save(p_section uuid, p_id uuid, p_name text, p_archived boolean default false)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true); v_id uuid;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Indica o nome da categoria.'; end if;
  if exists (select 1 from public.inv_categories where section_id = p_section and space = v_space
              and lower(trim(name)) = lower(trim(p_name)) and id is distinct from p_id) then
    raise exception 'Já existe uma categoria com esse nome.';
  end if;
  if p_id is null then
    insert into public.inv_categories (section_id, space, name, created_by) values (p_section, v_space, trim(p_name), auth.uid())
    returning id into v_id;
  else
    update public.inv_categories set name = trim(p_name), updated_by = auth.uid(), updated_at = now(),
           archived_at = case when coalesce(p_archived, false) then coalesce(archived_at, now()) end
     where id = p_id and section_id = p_section and space = v_space returning id into v_id;
    if v_id is null then raise exception 'Registo não encontrado.'; end if;
  end if;
  return v_id;
end
$$;

create or replace function public.inv_item_save(
  p_section uuid, p_id uuid, p_category uuid, p_name text, p_description text, p_unit text, p_location text,
  p_tracking text default 'quantidade', p_quantity integer default 0, p_min_quantity integer default null, p_pieces jsonb default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true);
  i public.inv_items; v_id uuid; p jsonb; v_changes text[] := '{}';
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Indica o nome do artigo.'; end if;
  if length(trim(coalesce(p_unit, ''))) = 0 then raise exception 'Indica a unidade (por exemplo: un., par, kg).'; end if;
  if p_min_quantity is not null and p_min_quantity < 0 then raise exception 'A quantidade mínima não pode ser negativa.'; end if;
  if p_category is not null and not exists (select 1 from public.inv_categories where id = p_category and section_id = p_section and space = v_space) then
    raise exception 'Categoria não encontrada.';
  end if;
  if p_id is null then
    if coalesce(p_tracking, '') not in ('quantidade', 'pecas') then raise exception 'Tipo de controlo inválido.'; end if;
    if p_tracking = 'quantidade' and (p_quantity is null or p_quantity < 0) then raise exception 'A quantidade não pode ser negativa.'; end if;
    insert into public.inv_items (section_id, space, category_id, name, description, unit, location, tracking, quantity, min_quantity, created_by)
    values (p_section, v_space, p_category, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), trim(p_unit),
            nullif(trim(coalesce(p_location, '')), ''), p_tracking, case when p_tracking = 'quantidade' then p_quantity else 0 end,
            p_min_quantity, auth.uid())
    returning * into i;
    perform private.inv_log(i, 'criacao', case when p_tracking = 'quantidade' then p_quantity end, null, null, null);
    if p_tracking = 'quantidade' and p_quantity > 0 then
      perform private.inv_log(i, 'entrada', p_quantity, null, 'disponivel', 'Quantidade inicial');
    end if;
    if p_tracking = 'pecas' then
      for p in select * from jsonb_array_elements(coalesce(p_pieces, '[]'::jsonb)) loop
        perform public.inv_piece_add(p_section, i.id, p ->> 'code', p ->> 'serial', p ->> 'notes');
      end loop;
    end if;
    return i.id;
  end if;
  i := private.inv_item_locked(p_section, v_space, p_id);
  if p_tracking is not null and p_tracking <> i.tracking then
    raise exception 'O tipo de controlo (quantidade ou peças) não se altera depois de criado o artigo.';
  end if;
  if i.name is distinct from trim(p_name) then v_changes := array_append(v_changes, 'nome'); end if;
  if i.category_id is distinct from p_category then v_changes := array_append(v_changes, 'categoria'); end if;
  if i.location is distinct from nullif(trim(coalesce(p_location, '')), '') then v_changes := array_append(v_changes, ('localização: ' || coalesce(nullif(trim(coalesce(p_location, '')), ''), '—'))); end if;
  if i.unit is distinct from trim(p_unit) then v_changes := array_append(v_changes, 'unidade'); end if;
  if i.description is distinct from nullif(trim(coalesce(p_description, '')), '') then v_changes := array_append(v_changes, 'descrição'); end if;
  if i.min_quantity is distinct from p_min_quantity then v_changes := array_append(v_changes, ('mínimo: ' || coalesce(p_min_quantity::text, '—'))); end if;
  update public.inv_items set category_id = p_category, name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''),
         unit = trim(p_unit), location = nullif(trim(coalesce(p_location, '')), ''), min_quantity = p_min_quantity,
         updated_by = auth.uid(), updated_at = now()
   where id = i.id returning * into i;
  if cardinality(v_changes) > 0 then perform private.inv_log(i, 'edicao', null, null, null, array_to_string(v_changes, ', ')); end if;
  return i.id;
end
$$;

-- Arquivar (retirar do inventário) ou reativar. Nunca apaga.
create or replace function public.inv_item_archive(p_section uuid, p_item uuid, p_archived boolean, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true); i public.inv_items;
begin
  i := private.inv_item_locked(p_section, v_space, p_item);
  if p_archived then
    if i.archived_at is not null then return; end if;
    if exists (select 1 from public.inv_loans where item_id = i.id and status in ('pedido', 'ativo')) then
      raise exception 'Há empréstimos ou pedidos em curso deste artigo. Regista as devoluções ou decide os pedidos primeiro.';
    end if;
    if exists (select 1 from public.inv_reservations where item_id = i.id and status = 'ativa' and ends_at > now()) then
      raise exception 'Há reservas ativas deste artigo. Cancela-as primeiro.';
    end if;
    update public.inv_items set archived_at = now(), archived_by = auth.uid(), updated_by = auth.uid(), updated_at = now() where id = i.id;
    perform private.inv_log(i, 'arquivo', null, null, null, p_note);
  else
    if i.archived_at is null then return; end if;
    update public.inv_items set archived_at = null, archived_by = null, updated_by = auth.uid(), updated_at = now() where id = i.id;
    perform private.inv_log(i, 'reativacao', null, null, null, p_note);
  end if;
end
$$;

-- Entradas, saídas e ajustes de quantidade (artigos por quantidade).
-- «ajuste»: p_quantity é a nova quantidade total contada.
create or replace function public.inv_stock_move(p_section uuid, p_item uuid, p_kind text, p_quantity integer, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true); i public.inv_items; v_new int; v_out int;
begin
  i := private.inv_item_locked(p_section, v_space, p_item);
  if i.archived_at is not null then raise exception 'Este artigo está arquivado.'; end if;
  if i.tracking <> 'quantidade' then raise exception 'Este artigo é controlado por peças: acrescenta ou retira peças individualmente.'; end if;
  if p_quantity is null or p_quantity < 0 or (p_kind <> 'ajuste' and p_quantity = 0) then raise exception 'Indica uma quantidade válida.'; end if;
  v_new := case p_kind when 'entrada' then i.quantity + p_quantity when 'saida' then i.quantity - p_quantity when 'ajuste' then p_quantity
           else null end;
  if v_new is null then raise exception 'Movimento inválido.'; end if;
  if p_kind = 'ajuste' and length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Explica o motivo do ajuste.'; end if;
  if v_new < 0 then raise exception 'A quantidade não pode ficar negativa.'; end if;
  if v_new < i.qty_damaged + i.qty_repair then
    raise exception 'Há % % danificadas ou em reparação: atualiza primeiro o estado dessas unidades.', i.qty_damaged + i.qty_repair, i.unit;
  end if;
  -- O que está emprestado tem de continuar a caber.
  v_out := private.inv_loan_peak(i.id);
  if v_new - i.qty_damaged - i.qty_repair < v_out then
    raise exception 'Há % % emprestadas: a quantidade não pode ficar abaixo disso.', v_out, i.unit;
  end if;
  update public.inv_items set quantity = v_new, updated_by = auth.uid(), updated_at = now() where id = i.id;
  perform private.inv_log(i, p_kind, case when p_kind = 'ajuste' then v_new - i.quantity else p_quantity end,
    i.quantity::text, v_new::text, p_note);
end
$$;

-- Mudança de estado de unidades (artigos por quantidade): disponível ↔ danificado ↔ em reparação.
create or replace function public.inv_set_condition(p_section uuid, p_item uuid, p_from text, p_to text, p_quantity integer, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true); i public.inv_items;
  v_d int; v_r int; v_out int;
begin
  i := private.inv_item_locked(p_section, v_space, p_item);
  if i.tracking <> 'quantidade' then raise exception 'Este artigo é controlado por peças: altera o estado de cada peça.'; end if;
  if p_from not in ('disponivel', 'danificado', 'reparacao') or p_to not in ('disponivel', 'danificado', 'reparacao') or p_from = p_to then
    raise exception 'Estado inválido.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Indica uma quantidade válida.'; end if;
  v_d := i.qty_damaged + case when p_to = 'danificado' then p_quantity when p_from = 'danificado' then -p_quantity else 0 end;
  v_r := i.qty_repair + case when p_to = 'reparacao' then p_quantity when p_from = 'reparacao' then -p_quantity else 0 end;
  if v_d < 0 or v_r < 0 then raise exception 'Não há unidades suficientes nesse estado.'; end if;
  v_out := private.inv_loan_peak(i.id);
  if i.quantity - v_d - v_r < v_out then
    raise exception 'Não há unidades disponíveis suficientes (há % emprestadas). Regista primeiro a devolução.', v_out;
  end if;
  update public.inv_items set qty_damaged = v_d, qty_repair = v_r, updated_by = auth.uid(), updated_at = now() where id = i.id;
  perform private.inv_log(i, 'estado', p_quantity, p_from, p_to, p_note);
end
$$;

-- Peças identificadas individualmente.
create or replace function public.inv_piece_add(p_section uuid, p_item uuid, p_code text, p_serial text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true); i public.inv_items; v_id uuid;
begin
  i := private.inv_item_locked(p_section, v_space, p_item);
  if i.tracking <> 'pecas' then raise exception 'Este artigo é controlado por quantidade.'; end if;
  if i.archived_at is not null then raise exception 'Este artigo está arquivado.'; end if;
  if length(trim(coalesce(p_code, ''))) = 0 then raise exception 'Indica o código da peça.'; end if;
  if exists (select 1 from public.inv_pieces where item_id = i.id and lower(trim(code)) = lower(trim(p_code))) then
    raise exception 'Já existe uma peça com o código «%» neste artigo.', trim(p_code);
  end if;
  insert into public.inv_pieces (section_id, space, item_id, code, serial, notes, created_by)
  values (p_section, v_space, i.id, trim(p_code), nullif(trim(coalesce(p_serial, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_id;
  perform private.inv_log(i, 'peca', 1, null, 'disponivel', 'Peça ' || trim(p_code) || ' acrescentada', v_id);
  return v_id;
end
$$;

create or replace function public.inv_piece_update(
  p_section uuid, p_piece uuid, p_code text, p_serial text, p_status text, p_note text default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true);
  p public.inv_pieces; i public.inv_items;
begin
  select * into p from public.inv_pieces where id = p_piece and section_id = p_section and space = v_space;
  if p.id is null then raise exception 'Registo não encontrado.'; end if;
  i := private.inv_item_locked(p_section, v_space, p.item_id);
  select * into p from public.inv_pieces where id = p_piece for update;
  if p_status not in ('disponivel', 'danificado', 'reparacao', 'retirado') then raise exception 'Estado inválido.'; end if;
  if length(trim(coalesce(p_code, ''))) = 0 then raise exception 'Indica o código da peça.'; end if;
  if exists (select 1 from public.inv_pieces where item_id = p.item_id and id <> p.id and lower(trim(code)) = lower(trim(p_code))) then
    raise exception 'Já existe uma peça com o código «%» neste artigo.', trim(p_code);
  end if;
  if p_status <> p.status then
    if exists (select 1 from public.inv_loan_pieces lp join public.inv_loans l on l.id = lp.loan_id
                where lp.piece_id = p.id and lp.returned_at is null and l.status = 'ativo') then
      raise exception 'Esta peça está emprestada. Regista primeiro a devolução.';
    end if;
  end if;
  update public.inv_pieces set code = trim(p_code), serial = nullif(trim(coalesce(p_serial, '')), ''), status = p_status,
         updated_by = auth.uid(), updated_at = now() where id = p.id;
  if p_status <> p.status then
    perform private.inv_log(i, 'estado', 1, p.status, p_status, p_note, p.id);
  elsif p.code is distinct from trim(p_code) or p.serial is distinct from nullif(trim(coalesce(p_serial, '')), '') then
    perform private.inv_log(i, 'edicao', null, null, null, coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Identificação da peça alterada'), p.id);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Empréstimos
-- ---------------------------------------------------------------------------
-- Ativa um empréstimo já validado: escolhe as peças (se for por peças), confirma a
-- disponibilidade com o artigo bloqueado, regista o movimento, lembretes e aviso.
create or replace function private.inv_activate_loan(l public.inv_loans, i public.inv_items, p_pieces uuid[])
returns public.inv_loans language plpgsql security definer set search_path = ''
as $$
declare v_pieces uuid[]; v_bad int;
begin
  if i.archived_at is not null then raise exception 'Este artigo está arquivado.'; end if;
  perform private.inv_require_free(i, l.quantity, l.out_at, l.due_at, l.id, l.reservation_id);
  if i.tracking = 'pecas' then
    if p_pieces is not null and cardinality(p_pieces) > 0 then
      v_pieces := (select array_agg(distinct x) from unnest(p_pieces) x);
      if cardinality(v_pieces) <> l.quantity then raise exception 'Escolhe exatamente % peça(s).', l.quantity; end if;
      select count(*) into v_bad from unnest(v_pieces) x
       where not exists (select 1 from public.inv_pieces p where p.id = x and p.item_id = i.id and p.status = 'disponivel')
          or exists (select 1 from public.inv_loan_pieces lp join public.inv_loans o on o.id = lp.loan_id
                      where lp.piece_id = x and lp.returned_at is null and o.status = 'ativo');
      if v_bad > 0 then raise exception 'Há peças escolhidas que não estão disponíveis.'; end if;
    else
      v_pieces := array(select p.id from public.inv_pieces p
                         where p.item_id = i.id and p.status = 'disponivel'
                           and not exists (select 1 from public.inv_loan_pieces lp join public.inv_loans o on o.id = lp.loan_id
                                            where lp.piece_id = p.id and lp.returned_at is null and o.status = 'ativo')
                         order by lower(p.code) limit l.quantity);
      if cardinality(v_pieces) < l.quantity then raise exception 'Não há peças disponíveis suficientes.'; end if;
    end if;
    insert into public.inv_loan_pieces (loan_id, piece_id, section_id, space)
    select l.id, x, l.section_id, l.space from unnest(v_pieces) x;
  end if;
  if l.reservation_id is not null then
    update public.inv_reservations set status = 'concluida', closed_by = auth.uid(), closed_at = now(), close_note = 'Material levantado'
     where id = l.reservation_id and status = 'ativa';
    perform private.inv_log(i, 'reserva_concluida', null, null, null, 'Material levantado', null, l.id, l.reservation_id);
  end if;
  update public.inv_loans set status = 'ativo', updated_by = auth.uid(), updated_at = now() where id = l.id returning * into l;
  perform private.inv_log(i, 'emprestimo', l.quantity, 'disponivel', 'emprestado',
    'Para ' || private.inv_name(l.borrower_id) || ' até ' || private.inv_fmt(l.due_at), null, l.id);
  perform private.inv_schedule_loan_reminders(l);
  return l;
end
$$;

create or replace function private.inv_check_loan_input(p_section uuid, p_borrower uuid, p_quantity integer, p_out timestamptz, p_due timestamptz)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_borrower is null or not exists (select 1 from public.memberships where section_id = p_section and profile_id = p_borrower and status = 'ativo') then
    raise exception 'Escolhe como responsável um membro ativo da secção.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Indica uma quantidade válida.'; end if;
  if p_due is null then raise exception 'Indica a data prevista de devolução.'; end if;
  if p_due <= p_out then raise exception 'A devolução tem de ser depois da saída.'; end if;
  if p_due <= now() then raise exception 'A data prevista de devolução já passou.'; end if;
end
$$;

-- Empréstimo registado por quem gere (fica logo ativo). p_reservation: levantamento de uma reserva.
create or replace function public.inv_loan_create(
  p_section uuid, p_item uuid, p_borrower uuid, p_quantity integer, p_out_at timestamptz, p_due_at timestamptz,
  p_pieces uuid[] default null, p_reservation uuid default null, p_notes text default null, p_remind_hours integer default 24
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true);
  i public.inv_items; l public.inv_loans; v_out timestamptz := coalesce(p_out_at, now()); v_qty int;
begin
  i := private.inv_item_locked(p_section, v_space, p_item);
  v_qty := case when i.tracking = 'pecas' and p_pieces is not null and cardinality(p_pieces) > 0 then cardinality(p_pieces) else p_quantity end;
  perform private.inv_check_loan_input(p_section, p_borrower, v_qty, v_out, p_due_at);
  if p_reservation is not null and not exists (select 1 from public.inv_reservations where id = p_reservation and item_id = i.id and status = 'ativa') then
    raise exception 'Reserva não encontrada.';
  end if;
  insert into public.inv_loans (section_id, space, item_id, borrower_id, quantity, out_at, due_at, status, reservation_id, notes,
                                remind_hours, requested_by, decided_by, decided_at)
  values (p_section, v_space, i.id, p_borrower, v_qty, v_out, p_due_at, 'pedido', p_reservation, nullif(trim(coalesce(p_notes, '')), ''),
          coalesce(p_remind_hours, 24), auth.uid(), auth.uid(), now())
  returning * into l;
  l := private.inv_activate_loan(l, i, p_pieces);
  perform private.module_notify(p_section, 'inventario', v_space, array[l.borrower_id], 'inv_emprestimo',
    'Material emprestado', i.name || ' · ' || l.quantity || ' ' || i.unit || ' · devolver até ' || private.inv_fmt(l.due_at), '/inventario/emprestimos');
  return l.id;
end
$$;

-- Pedido de empréstimo (qualquer pessoa com acesso, para si). Fica a aguardar aprovação.
create or replace function public.inv_loan_request(
  p_section uuid, p_item uuid, p_quantity integer, p_out_at timestamptz, p_due_at timestamptz, p_notes text default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'inventario'); i public.inv_items; v_id uuid; v_out timestamptz := coalesce(p_out_at, now());
begin
  i := private.inv_item_locked(p_section, v_space, p_item);
  if i.archived_at is not null then raise exception 'Este artigo está arquivado.'; end if;
  perform private.inv_check_loan_input(p_section, auth.uid(), p_quantity, v_out, p_due_at);
  if v_out < now() - interval '1 hour' then raise exception 'A data de saída já passou.'; end if;
  perform private.inv_require_free(i, p_quantity, v_out, p_due_at);
  if exists (select 1 from public.inv_loans where item_id = i.id and requested_by = auth.uid() and status = 'pedido') then
    raise exception 'Já tens um pedido por decidir para este artigo.';
  end if;
  insert into public.inv_loans (section_id, space, item_id, borrower_id, quantity, out_at, due_at, status, notes, requested_by)
  values (p_section, v_space, i.id, auth.uid(), p_quantity, v_out, p_due_at, 'pedido', nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_id;
  perform private.inv_log(i, 'pedido', p_quantity, null, null, 'Pedido de ' || private.inv_name(auth.uid()), null, v_id);
  perform private.module_notify(p_section, 'inventario', v_space, private.inv_managers(p_section), 'inv_pedido',
    'Novo pedido de empréstimo', private.inv_name(auth.uid()) || ' · ' || i.name || ' · ' || p_quantity || ' ' || i.unit,
    '/inventario/emprestimos?estado=pedido');
  return v_id;
end
$$;

create or replace function public.inv_loan_decide(p_section uuid, p_loan uuid, p_approve boolean, p_note text default null, p_pieces uuid[] default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true); l public.inv_loans; i public.inv_items;
begin
  select * into l from public.inv_loans where id = p_loan and section_id = p_section and space = v_space;
  if l.id is null then raise exception 'Registo não encontrado.'; end if;
  i := private.inv_item_locked(p_section, v_space, l.item_id);
  select * into l from public.inv_loans where id = p_loan for update;
  if l.status <> 'pedido' then raise exception 'Este pedido já foi decidido.'; end if;
  update public.inv_loans set decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''),
         updated_by = auth.uid(), updated_at = now() where id = l.id returning * into l;
  if p_approve then
    if l.due_at <= now() then raise exception 'O prazo de devolução deste pedido já passou. Recusa-o ou pede um novo.'; end if;
    if l.out_at < now() then
      update public.inv_loans set out_at = now() where id = l.id returning * into l;
    end if;
    perform private.inv_log(i, 'pedido_aprovado', l.quantity, null, null, p_note, null, l.id);
    l := private.inv_activate_loan(l, i, p_pieces);
    perform private.module_notify(p_section, 'inventario', v_space, array[l.borrower_id], 'inv_pedido_decidido',
      'Pedido de empréstimo aprovado', i.name || ' · devolver até ' || private.inv_fmt(l.due_at), '/inventario/emprestimos');
  else
    if length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Indica o motivo da recusa.'; end if;
    update public.inv_loans set status = 'recusado' where id = l.id;
    perform private.inv_log(i, 'pedido_recusado', l.quantity, null, null, p_note, null, l.id);
    perform private.module_notify(p_section, 'inventario', v_space, array[l.borrower_id], 'inv_pedido_decidido',
      'Pedido de empréstimo recusado', i.name, '/inventario/emprestimos?estado=fechado');
  end if;
end
$$;

-- Cancelar um pedido ainda por decidir (o próprio ou quem gere).
create or replace function public.inv_loan_cancel(p_section uuid, p_loan uuid, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'inventario'); l public.inv_loans; i public.inv_items;
begin
  select * into l from public.inv_loans where id = p_loan and section_id = p_section and space = v_space;
  if l.id is null then raise exception 'Registo não encontrado.'; end if;
  if l.requested_by <> auth.uid() and not private.inv_can_manage(p_section) then
    raise exception 'Não tens permissão para esta ação neste módulo.' using errcode = '42501';
  end if;
  i := private.inv_item_locked(p_section, v_space, l.item_id);
  select * into l from public.inv_loans where id = p_loan for update;
  if l.status <> 'pedido' then raise exception 'Só se cancelam pedidos ainda por decidir.'; end if;
  update public.inv_loans set status = 'cancelado', updated_by = auth.uid(), updated_at = now(),
         decision_note = nullif(trim(coalesce(p_note, '')), '') where id = l.id;
  perform private.inv_log(i, 'pedido_cancelado', l.quantity, null, null, p_note, null, l.id);
end
$$;

-- Devolução total ou parcial. Por peças: p_pieces indica as peças devolvidas.
-- p_condition: estado em que o material volta (disponível, danificado ou em reparação).
create or replace function public.inv_loan_return(
  p_section uuid, p_loan uuid, p_quantity integer default null, p_pieces uuid[] default null,
  p_condition text default 'disponivel', p_note text default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true);
  l public.inv_loans; i public.inv_items; v_qty int; v_pieces uuid[]; v_cond text := coalesce(p_condition, 'disponivel');
begin
  select * into l from public.inv_loans where id = p_loan and section_id = p_section and space = v_space;
  if l.id is null then raise exception 'Registo não encontrado.'; end if;
  i := private.inv_item_locked(p_section, v_space, l.item_id);
  select * into l from public.inv_loans where id = p_loan for update;
  if l.status <> 'ativo' or l.returned_qty >= l.quantity then raise exception 'Este empréstimo não tem material por devolver.'; end if;
  if v_cond not in ('disponivel', 'danificado', 'reparacao') then raise exception 'Estado inválido.'; end if;
  if i.tracking = 'pecas' then
    if p_pieces is null or cardinality(p_pieces) = 0 then
      v_pieces := array(select piece_id from public.inv_loan_pieces where loan_id = l.id and returned_at is null);
    else
      v_pieces := (select array_agg(distinct x) from unnest(p_pieces) x);
      if exists (select 1 from unnest(v_pieces) x where not exists (
           select 1 from public.inv_loan_pieces lp where lp.loan_id = l.id and lp.piece_id = x and lp.returned_at is null)) then
        raise exception 'Há peças indicadas que não estão por devolver neste empréstimo.';
      end if;
    end if;
    v_qty := cardinality(v_pieces);
    update public.inv_loan_pieces set returned_at = now(), returned_status = v_cond where loan_id = l.id and piece_id = any (v_pieces);
    update public.inv_pieces set status = v_cond, updated_by = auth.uid(), updated_at = now()
     where id = any (v_pieces) and v_cond <> 'disponivel';
  else
    v_qty := coalesce(p_quantity, l.quantity - l.returned_qty);
    if v_qty <= 0 then raise exception 'Indica uma quantidade válida.'; end if;
    if v_qty > l.quantity - l.returned_qty then
      raise exception 'Só faltam devolver % %.', l.quantity - l.returned_qty, i.unit;
    end if;
    if v_cond = 'danificado' then update public.inv_items set qty_damaged = qty_damaged + v_qty where id = i.id;
    elsif v_cond = 'reparacao' then update public.inv_items set qty_repair = qty_repair + v_qty where id = i.id;
    end if;
  end if;
  update public.inv_loans set returned_qty = returned_qty + v_qty, updated_by = auth.uid(), updated_at = now(),
         status = case when returned_qty + v_qty >= quantity then 'devolvido' else status end,
         returned_at = case when returned_qty + v_qty >= quantity then now() end
   where id = l.id returning * into l;
  perform private.inv_log(i, 'devolucao', v_qty, 'emprestado', v_cond,
    concat_ws(' · ', case when l.status = 'devolvido' then 'Devolução total' else 'Devolução parcial' end,
      (select string_agg(p.code, ', ' order by p.code) from public.inv_pieces p where p.id = any (v_pieces)),
      nullif(trim(coalesce(p_note, '')), '')), null, l.id);
  if l.status = 'devolvido' then
    perform private.cancel_reminders('inv_loan', l.id);
  else
    perform private.inv_schedule_loan_reminders(l);
  end if;
end
$$;

-- Alterar o prazo de devolução de um empréstimo ativo (reagenda os lembretes).
create or replace function public.inv_loan_extend(p_section uuid, p_loan uuid, p_due_at timestamptz, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true); l public.inv_loans; i public.inv_items;
  v_old timestamptz;
begin
  select * into l from public.inv_loans where id = p_loan and section_id = p_section and space = v_space;
  if l.id is null then raise exception 'Registo não encontrado.'; end if;
  i := private.inv_item_locked(p_section, v_space, l.item_id);
  select * into l from public.inv_loans where id = p_loan for update;
  if l.status <> 'ativo' then raise exception 'Só se altera o prazo de empréstimos ativos.'; end if;
  if p_due_at is null or p_due_at <= now() or p_due_at <= l.out_at then raise exception 'Indica um novo prazo no futuro.'; end if;
  v_old := l.due_at;
  -- Ocupa o novo período (sem contar consigo próprio): não pode colidir com reservas.
  update public.inv_loans set due_at = p_due_at where id = l.id returning * into l;
  perform private.inv_require_free(i, l.quantity - l.returned_qty, l.out_at, p_due_at, l.id);
  update public.inv_loans set updated_by = auth.uid(), updated_at = now() where id = l.id returning * into l;
  perform private.inv_log(i, 'prazo', l.quantity - l.returned_qty, private.inv_fmt(v_old), private.inv_fmt(p_due_at), p_note, null, l.id);
  perform private.inv_schedule_loan_reminders(l);
  perform private.module_notify(p_section, 'inventario', v_space, array[l.borrower_id], 'inv_emprestimo',
    'Prazo de devolução alterado', i.name || ' · devolver até ' || private.inv_fmt(p_due_at), '/inventario/emprestimos');
end
$$;

-- ---------------------------------------------------------------------------
-- Reservas (ligadas a atividades do calendário; podem herdar o período da atividade)
-- ---------------------------------------------------------------------------
create or replace function public.inv_reservation_create(
  p_section uuid, p_item uuid, p_event uuid, p_quantity integer, p_starts_at timestamptz default null,
  p_ends_at timestamptz default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true);
  i public.inv_items; e public.cal_events; v_s timestamptz := p_starts_at; v_e timestamptz := p_ends_at; v_id uuid; per record;
begin
  i := private.inv_item_locked(p_section, v_space, p_item);
  if i.archived_at is not null then raise exception 'Este artigo está arquivado.'; end if;
  if p_event is not null then
    select * into e from public.cal_events where id = p_event and section_id = p_section and space = v_space;
    if e.id is null then raise exception 'Atividade não encontrada.'; end if;
    if e.status <> 'ativo' then raise exception 'Esta atividade foi cancelada.'; end if;
    select * into per from private.inv_event_period(e);
    v_s := coalesce(v_s, per.starts_at); v_e := coalesce(v_e, per.ends_at);
  end if;
  if v_s is null or v_e is null then raise exception 'Indica o período da reserva ou escolhe uma atividade.'; end if;
  if v_e <= v_s then raise exception 'O fim da reserva tem de ser depois do início.'; end if;
  if v_e <= now() then raise exception 'Esse período já terminou.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Indica uma quantidade válida.'; end if;
  perform private.inv_require_free(i, p_quantity, v_s, v_e);
  insert into public.inv_reservations (section_id, space, item_id, event_id, quantity, starts_at, ends_at, notes, created_by)
  values (p_section, v_space, i.id, p_event, p_quantity, v_s, v_e, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_id;
  perform private.inv_log(i, 'reserva', p_quantity, null, 'reservado',
    concat_ws(' · ', e.title, private.inv_fmt(v_s) || ' – ' || private.inv_fmt(v_e)), null, null, v_id);
  return v_id;
end
$$;

create or replace function public.inv_reservation_cancel(p_section uuid, p_reservation uuid, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true); r public.inv_reservations; i public.inv_items;
begin
  select * into r from public.inv_reservations where id = p_reservation and section_id = p_section and space = v_space;
  if r.id is null then raise exception 'Registo não encontrado.'; end if;
  i := private.inv_item_locked(p_section, v_space, r.item_id);
  if r.status <> 'ativa' then raise exception 'Esta reserva já não está ativa.'; end if;
  update public.inv_reservations set status = 'cancelada', closed_by = auth.uid(), closed_at = now(),
         close_note = nullif(trim(coalesce(p_note, '')), '') where id = r.id;
  perform private.inv_log(i, 'reserva_cancelada', r.quantity, 'reservado', null, p_note, null, null, r.id);
end
$$;

-- ---------------------------------------------------------------------------
-- Publicação com «passar dados de teste a reais»: as categorias de teste com o mesmo nome
-- de uma categoria real juntam-se à real (os artigos passam para ela; a de teste fica
-- arquivada com outro nome, para não colidir). Depois passam todas as tabelas inv_*.
-- ---------------------------------------------------------------------------
create or replace function private.inventario_publish_move(p_section uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare c record; v_t text;
begin
  for c in select t.id test_id, r.id real_id, t.name from public.inv_categories t
             join public.inv_categories r on r.section_id = t.section_id and r.space = 'real' and lower(trim(r.name)) = lower(trim(t.name))
            where t.section_id = p_section and t.space = 'teste'
  loop
    update public.inv_items set category_id = c.real_id where category_id = c.test_id;
    update public.inv_categories set name = left(c.name, 60) || ' (teste ' || left(c.test_id::text, 8) || ')',
           archived_at = coalesce(archived_at, now()), updated_at = now() where id = c.test_id;
  end loop;
  foreach v_t in array private.module_tables('inventario') loop
    execute format('update public.%I set space = ''real'' where section_id = $1 and space = ''teste''', v_t) using p_section;
  end loop;
end
$$;
revoke all on function private.inventario_publish_move(uuid) from public, anon, authenticated;

revoke all on function private.inv_log(public.inv_items, text, integer, text, text, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.inv_activate_loan(public.inv_loans, public.inv_items, uuid[]) from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;
notify pgrst, 'reload schema';


-- ===== 20261021000400_tesouraria.sql =====
-- Pioneiros — Tesouraria: receitas, despesas, saldos, quotas, pagamentos individuais,
-- orçamento por atividade, comprovativos e auditoria.
--
-- • Valores sempre em cêntimos inteiros (bigint), nunca em vírgula flutuante.
-- • Cada movimento tem um estado: «previsto», «pendente» ou «efetivo». O saldo efetivo só
--   conta movimentos efetivos e não anulados.
-- • Um pagamento individual É um movimento (receita com membro). Uma quota apenas o
--   referencia (fin_movements.quota_charge_id): o mesmo pagamento nunca conta duas vezes
--   e não pode ficar ligado a duas quotas. Exceder o valor em falta exige confirmação.
-- • Nada se apaga: anula-se (com motivo) ou corrige-se com um movimento novo ligado ao
--   original (corrects_id / replaced_by). Auditoria com valores antigos e novos (fin_audit).
-- • Só quem tem «tesouraria.gerir» (dado pela administração) cria, altera ou anula. Ser
--   dirigente, administrador ou ter um cargo de equipa (p. ex. tesoureiro) NÃO basta.
--   Os restantes com acesso ao módulo veem resumos (totais por categoria/atividade) e a
--   sua própria situação; nunca pagamentos individuais de outras pessoas.
-- • Comprovativos: anexos da base comum (entidade «movimento»), visíveis só a quem gere e,
--   no seu próprio pagamento, ao próprio membro.
-- • Notificações com texto genérico (sem valores) — aparecem no ecrã bloqueado.
-- Aditivo: não altera dados nem permissões existentes.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.fin_accounts (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  name text not null check (length(trim(name)) between 1 and 80),
  kind text not null default 'conta' check (kind in ('conta', 'caixa')),
  archived_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists fin_accounts_section on public.fin_accounts (section_id, space);

create table if not exists public.fin_quotas (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  name text not null check (length(trim(name)) between 1 and 120),
  period_start date not null,
  period_end date not null,
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  due_date date not null,
  status text not null default 'ativa' check (status in ('ativa', 'anulada')),
  void_reason text,
  voided_at timestamptz,
  voided_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index if not exists fin_quotas_section on public.fin_quotas (section_id, space);

-- Quota aplicada a um membro (valor devido próprio, p. ex. proporcional).
create table if not exists public.fin_quota_charges (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  quota_id uuid not null references public.fin_quotas (id) on delete cascade,
  profile_id uuid not null references public.profiles (id),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  status text not null default 'ativa' check (status in ('ativa', 'isenta')),
  waive_reason text,
  waived_at timestamptz,
  waived_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (quota_id, profile_id)
);
create index if not exists fin_quota_charges_profile on public.fin_quota_charges (section_id, space, profile_id);

create table if not exists public.fin_movements (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  kind text not null check (kind in ('receita', 'despesa')),
  occurred_on date not null,
  description text not null check (length(trim(description)) between 1 and 200),
  category text not null check (length(trim(category)) between 1 and 60),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  account_id uuid not null references public.fin_accounts (id),
  activity_id uuid references public.cal_events (id),
  member_profile_id uuid references public.profiles (id),
  quota_charge_id uuid references public.fin_quota_charges (id),
  state text not null check (state in ('previsto', 'pendente', 'efetivo')),
  notes text check (notes is null or length(notes) <= 1000),
  corrects_id uuid references public.fin_movements (id),
  replaced_by uuid references public.fin_movements (id),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  client_key uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  -- O pagamento de uma quota é sempre uma receita de um membro.
  check (quota_charge_id is null or (kind = 'receita' and member_profile_id is not null)),
  check (voided_at is null or (void_reason is not null and length(trim(void_reason)) > 0))
);
create index if not exists fin_movements_section on public.fin_movements (section_id, space, occurred_on desc);
create index if not exists fin_movements_charge on public.fin_movements (quota_charge_id) where quota_charge_id is not null;
create index if not exists fin_movements_member on public.fin_movements (member_profile_id) where member_profile_id is not null;
create index if not exists fin_movements_activity on public.fin_movements (activity_id) where activity_id is not null;
-- O mesmo envio do formulário nunca regista dois movimentos.
create unique index if not exists fin_movements_client_key on public.fin_movements (section_id, client_key) where client_key is not null;
-- Um movimento só é corrigido uma vez (a correção pode, por sua vez, ser corrigida).
create unique index if not exists fin_movements_one_correction on public.fin_movements (corrects_id) where corrects_id is not null;

-- Orçamento (previsto) por atividade.
create table if not exists public.fin_budget_lines (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  activity_id uuid not null references public.cal_events (id),
  kind text not null check (kind in ('receita', 'despesa')),
  category text not null check (length(trim(category)) between 1 and 60),
  description text not null check (length(trim(description)) between 1 and 200),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists fin_budget_lines_activity on public.fin_budget_lines (section_id, space, activity_id);

-- Auditoria: quem criou, alterou, anulou ou corrigiu, quando, com valores antigos e novos.
create table if not exists public.fin_audit (
  id bigint generated always as identity primary key,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  entity text not null,
  entity_id uuid not null,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  actor uuid,
  at timestamptz not null default now()
);
create index if not exists fin_audit_entity on public.fin_audit (entity_id, id);

alter table public.fin_accounts enable row level security;
alter table public.fin_quotas enable row level security;
alter table public.fin_quota_charges enable row level security;
alter table public.fin_movements enable row level security;
alter table public.fin_budget_lines enable row level security;
alter table public.fin_audit enable row level security;

-- ---------------------------------------------------------------------------
-- Auditoria automática (não depende de cada função se lembrar de registar)
-- ---------------------------------------------------------------------------
create or replace function private.fin_audit_trg()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare o jsonb; n jsonb; k text; vo jsonb := '{}'; vn jsonb := '{}'; v_action text;
begin
  n := to_jsonb(new);
  if tg_op = 'INSERT' then
    insert into public.fin_audit (section_id, space, entity, entity_id, action, old_values, new_values, actor)
    values (new.section_id, new.space, tg_table_name, new.id, 'criado', null,
            n - 'created_at' - 'updated_at' - 'updated_by' - 'section_id' - 'space', auth.uid());
    return new;
  end if;
  o := to_jsonb(old);
  for k in select jsonb_object_keys(n) loop
    if k not in ('updated_at', 'updated_by') and (o -> k) is distinct from (n -> k) then
      vo := vo || jsonb_build_object(k, o -> k);
      vn := vn || jsonb_build_object(k, n -> k);
    end if;
  end loop;
  if vn = '{}'::jsonb then return new; end if;
  v_action := case
    when vn ? 'space' then 'passado_a_real'
    when vn ? 'replaced_by' and o ->> 'replaced_by' is null then 'corrigido'
    when vn ? 'voided_at' and o ->> 'voided_at' is null then 'anulado'
    when tg_table_name = 'fin_quotas' and vn ->> 'status' = 'anulada' then 'anulado'
    when tg_table_name = 'fin_quota_charges' and vn ->> 'status' = 'isenta' then 'isentado'
    when tg_table_name = 'fin_accounts' and vn ? 'archived_at' and o ->> 'archived_at' is null then 'arquivado'
    else 'alterado' end;
  insert into public.fin_audit (section_id, space, entity, entity_id, action, old_values, new_values, actor)
  values (new.section_id, new.space, tg_table_name, new.id, v_action, vo, vn, auth.uid());
  return new;
end
$$;

do $$
declare t text;
begin
  foreach t in array array['fin_accounts', 'fin_quotas', 'fin_quota_charges', 'fin_movements', 'fin_budget_lines'] loop
    execute format('drop trigger if exists fin_audit on public.%I', t);
    execute format('create trigger fin_audit after insert or update on public.%I for each row execute function private.fin_audit_trg()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
-- Só a permissão explícita conta (nem dirigente nem administração nem cargo de equipa).
create or replace function private.fin_can_manage(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.module_can(p_section, 'tesouraria', 'tesouraria.gerir', false)
$$;

create or replace function private.fin_require_manage(p_section uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select private.module_require_can(p_section, 'tesouraria', 'tesouraria.gerir', false)
$$;

create or replace function private.fin_name(p_profile uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select nullif(trim(full_name), '') from public.profiles where id = p_profile
$$;

-- «1234» → «12,34 €» (só para mensagens a quem gere).
create or replace function private.fin_eur(p_cents bigint)
returns text language sql immutable set search_path = ''
as $$
  select case when p_cents < 0 then '−' else '' end || (abs(p_cents) / 100)::text || ','
         || lpad((abs(p_cents) % 100)::text, 2, '0') || ' €'
$$;

-- Fração de um valor em cêntimos, com arredondamento ao cêntimo (meio para cima), só inteiros.
create or replace function private.fin_fraction(p_cents bigint, p_num int, p_den int)
returns bigint language sql immutable set search_path = ''
as $$
  select (p_cents * p_num * 2 + p_den) / (2 * p_den)
$$;

create or replace function private.fin_validate(
  p_section uuid, p_space text, p_kind text, p_on date, p_description text, p_category text, p_amount bigint,
  p_account uuid, p_state text, p_activity uuid, p_member uuid, p_keep_account uuid default null
) returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_kind is null or p_kind not in ('receita', 'despesa') then raise exception 'Indica se é uma receita ou uma despesa.'; end if;
  if p_on is null then raise exception 'Indica a data do movimento.'; end if;
  if p_on < date '2000-01-01' or p_on > current_date + 3660 then raise exception 'A data está fora do intervalo permitido.'; end if;
  if length(trim(coalesce(p_description, ''))) not between 1 and 200 then raise exception 'Escreve uma descrição (até 200 caracteres).'; end if;
  if length(trim(coalesce(p_category, ''))) not between 1 and 60 then raise exception 'Escolhe uma categoria (até 60 caracteres).'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Indica um valor superior a zero.'; end if;
  if p_amount > 100000000000 then raise exception 'O valor é demasiado elevado.'; end if;
  if p_state is null or p_state not in ('previsto', 'pendente', 'efetivo') then raise exception 'Escolhe o estado: previsto, pendente ou efetivo.'; end if;
  if not exists (select 1 from public.fin_accounts a where a.id = p_account and a.section_id = p_section and a.space = p_space
                    and (a.archived_at is null or a.id = p_keep_account)) then
    raise exception 'Escolhe uma conta ou caixa válida.';
  end if;
  if p_activity is not null and not exists (select 1 from public.cal_events e where e.id = p_activity and e.section_id = p_section and e.space = p_space) then
    raise exception 'Atividade não encontrada.';
  end if;
  if p_member is not null and not exists (select 1 from public.memberships m where m.profile_id = p_member and m.section_id = p_section) then
    raise exception 'Membro não encontrado nesta secção.';
  end if;
end
$$;

-- Valida a ligação de um pagamento a uma quota (com a quota bloqueada). Exceder o valor
-- em falta só com confirmação explícita.
create or replace function private.fin_check_charge(
  p_section uuid, p_space text, p_charge uuid, p_member uuid, p_amount bigint, p_exclude uuid, p_allow_excess boolean
) returns void language plpgsql security definer set search_path = ''
as $$
declare c record; v_used bigint;
begin
  select ch.id, ch.profile_id, ch.amount_cents, ch.status, q.status as qstatus into c
    from public.fin_quota_charges ch join public.fin_quotas q on q.id = ch.quota_id
   where ch.id = p_charge and ch.section_id = p_section and ch.space = p_space
   for update of ch;
  if c.id is null then raise exception 'Quota do membro não encontrada.'; end if;
  if c.qstatus <> 'ativa' then raise exception 'Esta quota já foi anulada.'; end if;
  if c.status <> 'ativa' then raise exception 'Este membro está isento desta quota.'; end if;
  if p_member is distinct from c.profile_id then raise exception 'O pagamento de uma quota tem de ser do próprio membro.'; end if;
  select coalesce(sum(amount_cents), 0) into v_used from public.fin_movements
   where quota_charge_id = p_charge and voided_at is null and id is distinct from p_exclude;
  if not coalesce(p_allow_excess, false) then
    if v_used >= c.amount_cents then
      raise exception 'Esta quota já está totalmente paga (possível pagamento duplicado). Confirma para registar um valor em excesso.';
    end if;
    if v_used + p_amount > c.amount_cents then
      raise exception 'O pagamento excede o valor que está em falta na quota (em falta: %). Confirma para registar o excesso.', private.fin_eur(c.amount_cents - v_used);
    end if;
  end if;
end
$$;

-- Lembrete «quota por pagar» na data limite (09:00, Lisboa); cancelado quando paga, isenta ou anulada.
create or replace function private.fin_refresh_charge(p_charge uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare c record; v_paid bigint; v_due timestamptz;
begin
  if p_charge is null then return; end if;
  select ch.*, q.due_date, q.status as qstatus into c
    from public.fin_quota_charges ch join public.fin_quotas q on q.id = ch.quota_id where ch.id = p_charge;
  if c.id is null then return; end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.fin_movements
   where quota_charge_id = p_charge and voided_at is null and state = 'efetivo';
  v_due := (c.due_date + time '09:00') at time zone 'Europe/Lisbon';
  if c.status <> 'ativa' or c.qstatus <> 'ativa' or v_paid >= c.amount_cents or v_due <= now() then
    perform private.cancel_reminders('fin_quota_charge', c.id);
  else
    perform private.schedule_reminder(c.section_id, 'tesouraria', c.space, 'fin_quota_charge', c.id, 'quota_pendente',
      c.profile_id, v_due, 'Quota por pagar', 'Tens uma quota pendente na Tesouraria.', '/tesouraria/minha');
  end if;
end
$$;

-- Avisa o membro quando um pagamento seu passa a efetivo (texto genérico, sem valores).
create or replace function private.fin_after_change(p_new public.fin_movements, p_old_state text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_new.member_profile_id is not null and p_new.state = 'efetivo' and p_new.voided_at is null
     and p_old_state is distinct from 'efetivo' then
    perform private.module_notify(p_new.section_id, 'tesouraria', p_new.space, array[p_new.member_profile_id], 'fin_pagamento',
      'Pagamento registado', 'Foi registado um pagamento na tua situação da Tesouraria.', '/tesouraria/minha');
  end if;
  perform private.fin_refresh_charge(p_new.quota_charge_id);
end
$$;

create or replace function private.fin_movement_json(m public.fin_movements)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'kind', m.kind, 'occurred_on', m.occurred_on, 'description', m.description, 'category', m.category,
    'amount_cents', m.amount_cents, 'state', m.state, 'notes', m.notes,
    'account_id', m.account_id, 'account_name', (select a.name from public.fin_accounts a where a.id = m.account_id),
    'activity_id', m.activity_id, 'activity_title', (select e.title from public.cal_events e where e.id = m.activity_id and e.space = m.space),
    'member_profile_id', m.member_profile_id, 'member_name', private.fin_name(m.member_profile_id),
    'quota_charge_id', m.quota_charge_id,
    'quota_name', (select q.name from public.fin_quota_charges ch join public.fin_quotas q on q.id = ch.quota_id where ch.id = m.quota_charge_id),
    'corrects_id', m.corrects_id, 'replaced_by', m.replaced_by,
    'voided_at', m.voided_at, 'void_reason', m.void_reason, 'voided_by_name', private.fin_name(m.voided_by),
    'created_by_name', private.fin_name(m.created_by), 'created_at', m.created_at,
    'updated_by_name', private.fin_name(m.updated_by), 'updated_at', m.updated_at,
    'files', (select count(*) from public.module_files f where f.module = 'tesouraria' and f.entity = 'movimento'
                and f.entity_id = m.id and f.removed_at is null)
  )
$$;

-- Movimento desta secção e deste espaço (bloqueado para alteração).
create or replace function private.fin_get_movement(p_section uuid, p_space text, p_id uuid)
returns public.fin_movements language plpgsql security definer set search_path = ''
as $$
declare m public.fin_movements;
begin
  select * into m from public.fin_movements where id = p_id and section_id = p_section and space = p_space for update;
  if m.id is null then raise exception 'Registo não encontrado.'; end if;
  return m;
end
$$;

-- Comprovativos: ler — quem gere ou o próprio membro (no seu pagamento); anexar/retirar — só quem gere.
create or replace function private.tesouraria_file_access(p_entity text, p_entity_id uuid, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare m public.fin_movements;
begin
  if p_entity is distinct from 'movimento' then return false; end if;
  select * into m from public.fin_movements where id = p_entity_id;
  if m.id is null then return false; end if;
  if private.module_space(m.section_id, 'tesouraria') is distinct from m.space then return false; end if;
  if private.fin_can_manage(m.section_id) then return not p_write or m.voided_at is null; end if;
  return not p_write and m.member_profile_id = auth.uid();
end
$$;

-- ---------------------------------------------------------------------------
-- Opções (contas, categorias, atividades, membros)
-- ---------------------------------------------------------------------------
create or replace function public.fin_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria');
begin
  return jsonb_build_object(
    'can_manage', private.fin_can_manage(p_section),
    'space', v_space,
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'archived', a.archived_at is not null)
                                   order by a.archived_at nulls first, a.name)
                            from public.fin_accounts a where a.section_id = p_section and a.space = v_space), '[]'::jsonb),
    'categories', (select jsonb_agg(c order by c) from (
        select unnest(array['Quotas', 'Atividades', 'Acampamentos', 'Material', 'Transportes', 'Alimentação', 'Donativos', 'Angariação de fundos', 'Outros']) c
        union select category from public.fin_movements where section_id = p_section and space = v_space
        union select category from public.fin_budget_lines where section_id = p_section and space = v_space) x)
  );
end
$$;

-- Atividades do Calendário (mesma secção e mesmo espaço).
create or replace function public.fin_activity_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'status', e.status,
      'day', coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date))
      order by coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date) desc, e.title)
    from public.cal_events e where e.section_id = p_section and e.space = v_space), '[]'::jsonb);
end
$$;

create or replace function public.fin_members(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('profile_id', m.profile_id, 'full_name', coalesce(private.fin_name(m.profile_id), 'Sem nome'),
                                                       'function', m.function, 'team_id', m.team_id)
                                    order by private.fin_name(m.profile_id))
                     from public.memberships m where m.section_id = p_section and m.status = 'ativo'), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Contas e caixas
-- ---------------------------------------------------------------------------
create or replace function public.fin_save_account(p_section uuid, p_id uuid, p_name text, p_kind text, p_archived boolean default false)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); v_id uuid;
begin
  if length(trim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'Indica o nome da conta ou caixa (até 80 caracteres).'; end if;
  if p_kind is null or p_kind not in ('conta', 'caixa') then raise exception 'Escolhe se é uma conta ou uma caixa.'; end if;
  if exists (select 1 from public.fin_accounts where section_id = p_section and space = v_space and lower(trim(name)) = lower(trim(p_name))
              and id is distinct from p_id) then
    raise exception 'Já existe uma conta ou caixa com este nome.';
  end if;
  if p_id is null then
    insert into public.fin_accounts (section_id, space, name, kind, created_by) values (p_section, v_space, trim(p_name), p_kind, auth.uid())
    returning id into v_id;
  else
    update public.fin_accounts set name = trim(p_name), kind = p_kind,
           archived_at = case when coalesce(p_archived, false) then coalesce(archived_at, now()) else null end,
           updated_by = auth.uid(), updated_at = now()
     where id = p_id and section_id = p_section and space = v_space returning id into v_id;
    if v_id is null then raise exception 'Registo não encontrado.'; end if;
  end if;
  return v_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Movimentos
-- ---------------------------------------------------------------------------
create or replace function public.fin_create_movement(
  p_section uuid, p_kind text, p_on date, p_description text, p_category text, p_amount bigint, p_account uuid,
  p_state text, p_activity uuid default null, p_member uuid default null, p_notes text default null, p_client_key uuid default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); m public.fin_movements;
begin
  perform private.fin_validate(p_section, v_space, p_kind, p_on, p_description, p_category, p_amount, p_account, p_state, p_activity, p_member);
  if p_client_key is not null and exists (select 1 from public.fin_movements where section_id = p_section and client_key = p_client_key) then
    raise exception 'Este movimento já foi registado (envio repetido).';
  end if;
  insert into public.fin_movements (section_id, space, kind, occurred_on, description, category, amount_cents, account_id, activity_id,
                                    member_profile_id, state, notes, client_key, created_by)
  values (p_section, v_space, p_kind, p_on, trim(p_description), trim(p_category), p_amount, p_account, p_activity,
          p_member, p_state, nullif(trim(coalesce(p_notes, '')), ''), p_client_key, auth.uid())
  returning * into m;
  perform private.fin_after_change(m, null);
  return m.id;
end
$$;

-- Alterar: previstos e pendentes livremente; num efetivo só descrição, categoria, atividade e notas
-- (valor, data, tipo, conta e membro corrigem-se com um movimento de correção).
create or replace function public.fin_update_movement(
  p_section uuid, p_id uuid, p_kind text, p_on date, p_description text, p_category text, p_amount bigint, p_account uuid,
  p_state text, p_activity uuid default null, p_member uuid default null, p_notes text default null, p_allow_excess boolean default false
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); o public.fin_movements; m public.fin_movements;
begin
  o := private.fin_get_movement(p_section, v_space, p_id);
  if o.voided_at is not null then raise exception 'Este movimento está anulado e já não se altera.'; end if;
  perform private.fin_validate(p_section, v_space, p_kind, p_on, p_description, p_category, p_amount, p_account, p_state, p_activity, p_member, o.account_id);
  if o.state = 'efetivo' and (p_kind <> o.kind or p_on <> o.occurred_on or p_amount <> o.amount_cents or p_account <> o.account_id
                              or p_member is distinct from o.member_profile_id or p_state <> 'efetivo') then
    raise exception 'Um movimento efetivo não se altera: usa «Corrigir» (fica ligado ao original) ou anula-o.';
  end if;
  if o.quota_charge_id is not null and (p_kind <> o.kind or p_amount <> o.amount_cents or p_member is distinct from o.member_profile_id) then
    if p_kind <> 'receita' then raise exception 'O pagamento de uma quota é sempre uma receita.'; end if;
    perform private.fin_check_charge(p_section, v_space, o.quota_charge_id, p_member, p_amount, o.id,
                                     p_allow_excess or (p_amount < o.amount_cents and p_member is not distinct from o.member_profile_id));
  end if;
  update public.fin_movements set kind = p_kind, occurred_on = p_on, description = trim(p_description), category = trim(p_category),
         amount_cents = p_amount, account_id = p_account, state = p_state, activity_id = p_activity, member_profile_id = p_member,
         notes = nullif(trim(coalesce(p_notes, '')), ''), updated_by = auth.uid(), updated_at = now()
   where id = o.id returning * into m;
  perform private.fin_after_change(m, o.state);
end
$$;

create or replace function public.fin_void_movement(p_section uuid, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); o public.fin_movements;
begin
  if length(trim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'Indica o motivo da anulação.'; end if;
  o := private.fin_get_movement(p_section, v_space, p_id);
  if o.voided_at is not null then raise exception 'Este movimento já está anulado.'; end if;
  update public.fin_movements set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason),
         updated_by = auth.uid(), updated_at = now()
   where id = o.id;
  perform private.fin_refresh_charge(o.quota_charge_id);
end
$$;

-- Corrigir: o original fica anulado («Corrigido») e ligado ao movimento novo, que o substitui.
create or replace function public.fin_correct_movement(
  p_section uuid, p_id uuid, p_kind text, p_on date, p_description text, p_category text, p_amount bigint, p_account uuid,
  p_state text, p_activity uuid, p_member uuid, p_notes text, p_reason text, p_allow_excess boolean default false
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); o public.fin_movements; m public.fin_movements;
begin
  if length(trim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'Indica o motivo da correção.'; end if;
  o := private.fin_get_movement(p_section, v_space, p_id);
  if o.voided_at is not null then raise exception 'Este movimento já está anulado ou corrigido.'; end if;
  perform private.fin_validate(p_section, v_space, p_kind, p_on, p_description, p_category, p_amount, p_account, p_state, p_activity, p_member, o.account_id);
  if o.quota_charge_id is not null then
    if p_kind <> 'receita' then raise exception 'O pagamento de uma quota é sempre uma receita.'; end if;
    perform private.fin_check_charge(p_section, v_space, o.quota_charge_id, p_member, p_amount, o.id, p_allow_excess);
  end if;
  insert into public.fin_movements (section_id, space, kind, occurred_on, description, category, amount_cents, account_id, activity_id,
                                    member_profile_id, quota_charge_id, state, notes, corrects_id, created_by)
  values (p_section, v_space, p_kind, p_on, trim(p_description), trim(p_category), p_amount, p_account, p_activity,
          p_member, o.quota_charge_id, p_state, nullif(trim(coalesce(p_notes, '')), ''), o.id, auth.uid())
  returning * into m;
  update public.fin_movements set replaced_by = m.id, voided_at = now(), voided_by = auth.uid(),
         void_reason = 'Corrigido: ' || trim(p_reason), updated_by = auth.uid(), updated_at = now()
   where id = o.id;
  perform private.fin_after_change(m, o.state);
  return m.id;
end
$$;

-- Lista de movimentos (inclui pagamentos individuais): só para quem gere.
create or replace function public.fin_list_movements(
  p_section uuid, p_from date default null, p_to date default null, p_category text default null,
  p_activity uuid default null, p_state text default null, p_include_voided boolean default true
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section);
begin
  return coalesce((select jsonb_agg(private.fin_movement_json(m) order by m.occurred_on desc, m.created_at desc)
    from public.fin_movements m
   where m.section_id = p_section and m.space = v_space
     and (p_from is null or m.occurred_on >= p_from) and (p_to is null or m.occurred_on <= p_to)
     and (p_category is null or m.category = p_category) and (p_activity is null or m.activity_id = p_activity)
     and (p_state is null or m.state = p_state)
     and (coalesce(p_include_voided, true) or m.voided_at is null)), '[]'::jsonb);
end
$$;

-- Histórico (auditoria) de um registo da Tesouraria: só para quem gere.
create or replace function public.fin_history(p_section uuid, p_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'entity', a.entity, 'action', a.action, 'old_values', a.old_values,
                                                       'new_values', a.new_values, 'actor_name', private.fin_name(a.actor), 'at', a.at) order by a.id)
                     from public.fin_audit a where a.section_id = p_section and a.space = v_space and a.entity_id = p_entity_id), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Resumos partilhados (totais; nunca pagamentos individuais)
-- ---------------------------------------------------------------------------
create or replace function public.fin_summary(
  p_section uuid, p_from date default null, p_to date default null, p_category text default null, p_activity uuid default null
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria');
begin
  return (
    with mv as (
      select m.* from public.fin_movements m
       where m.section_id = p_section and m.space = v_space and m.voided_at is null
         and (p_from is null or m.occurred_on >= p_from) and (p_to is null or m.occurred_on <= p_to)
         and (p_category is null or m.category = p_category) and (p_activity is null or m.activity_id = p_activity)
    )
    select jsonb_build_object(
      'can_manage', private.fin_can_manage(p_section),
      'totals', (select jsonb_object_agg(s.st, jsonb_build_object('receitas', t.r, 'despesas', t.d, 'saldo', t.r - t.d))
                   from unnest(array['efetivo', 'pendente', 'previsto']) s(st)
                   cross join lateral (select coalesce(sum(amount_cents) filter (where kind = 'receita'), 0) r,
                                              coalesce(sum(amount_cents) filter (where kind = 'despesa'), 0) d
                                         from mv where mv.state = s.st) t),
      'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'kind', kind,
                                 'efetivo', ef, 'pendente', pe, 'previsto', pr) order by kind desc, ef desc, category)
                         from (select category, kind,
                                      coalesce(sum(amount_cents) filter (where state = 'efetivo'), 0) ef,
                                      coalesce(sum(amount_cents) filter (where state = 'pendente'), 0) pe,
                                      coalesce(sum(amount_cents) filter (where state = 'previsto'), 0) pr
                                 from mv group by category, kind) c), '[]'::jsonb),
      'by_activity', coalesce((select jsonb_agg(jsonb_build_object('activity_id', x.activity_id, 'title', e.title,
                                 'receitas', x.r, 'despesas', x.d, 'saldo', x.r - x.d, 'pendente_saldo', x.pr - x.pd) order by e.title)
                         from (select activity_id,
                                      coalesce(sum(amount_cents) filter (where state = 'efetivo' and kind = 'receita'), 0) r,
                                      coalesce(sum(amount_cents) filter (where state = 'efetivo' and kind = 'despesa'), 0) d,
                                      coalesce(sum(amount_cents) filter (where state <> 'efetivo' and kind = 'receita'), 0) pr,
                                      coalesce(sum(amount_cents) filter (where state <> 'efetivo' and kind = 'despesa'), 0) pd
                                 from mv where activity_id is not null group by activity_id) x
                         join public.cal_events e on e.id = x.activity_id and e.space = v_space), '[]'::jsonb),
      -- Saldo atual (efetivo, todos os períodos) de cada conta ou caixa ativa.
      'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind,
                              'saldo', coalesce((select sum(case when m.kind = 'receita' then m.amount_cents else -m.amount_cents end)
                                                   from public.fin_movements m
                                                  where m.account_id = a.id and m.space = v_space and m.voided_at is null and m.state = 'efetivo'), 0))
                              order by a.name)
                         from public.fin_accounts a where a.section_id = p_section and a.space = v_space and a.archived_at is null), '[]'::jsonb),
      'count', (select count(*) from mv)
    ));
end
$$;

-- Orçamento (previsto) vs resultado (efetivo) por atividade. Totais apenas.
create or replace function public.fin_activity_results(p_section uuid, p_activity uuid default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'activity_id', e.id, 'title', e.title, 'status', e.status,
      'day', coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date),
      'orcamento', jsonb_build_object('receitas', b.r, 'despesas', b.d, 'resultado', b.r - b.d),
      'efetivo', jsonb_build_object('receitas', m.r, 'despesas', m.d, 'resultado', m.r - m.d),
      'por_confirmar', jsonb_build_object('receitas', m.pr, 'despesas', m.pd, 'resultado', m.pr - m.pd),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'category', l.category, 'description', l.description,
                                   'amount_cents', l.amount_cents) order by l.kind desc, l.category, l.created_at)
                           from public.fin_budget_lines l
                          where l.activity_id = e.id and l.section_id = p_section and l.space = v_space and l.voided_at is null), '[]'::jsonb),
      'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', c.category, 'kind', c.kind, 'orcamento', c.o, 'efetivo', c.ef)
                                   order by c.kind desc, c.category)
                           from (select category, kind, sum(o) o, sum(ef) ef from (
                                   select category, kind, amount_cents o, 0::bigint ef from public.fin_budget_lines
                                    where activity_id = e.id and section_id = p_section and space = v_space and voided_at is null
                                   union all
                                   select category, kind, 0::bigint, amount_cents from public.fin_movements
                                    where activity_id = e.id and section_id = p_section and space = v_space and voided_at is null and state = 'efetivo'
                                 ) u group by category, kind) c), '[]'::jsonb)
    ) order by coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date) desc, e.title)
    from public.cal_events e
    cross join lateral (select coalesce(sum(amount_cents) filter (where kind = 'receita'), 0) r,
                               coalesce(sum(amount_cents) filter (where kind = 'despesa'), 0) d
                          from public.fin_budget_lines where activity_id = e.id and section_id = p_section and space = v_space and voided_at is null) b
    cross join lateral (select coalesce(sum(amount_cents) filter (where state = 'efetivo' and kind = 'receita'), 0) r,
                               coalesce(sum(amount_cents) filter (where state = 'efetivo' and kind = 'despesa'), 0) d,
                               coalesce(sum(amount_cents) filter (where state <> 'efetivo' and kind = 'receita'), 0) pr,
                               coalesce(sum(amount_cents) filter (where state <> 'efetivo' and kind = 'despesa'), 0) pd,
                               count(*) n
                          from public.fin_movements where activity_id = e.id and section_id = p_section and space = v_space and voided_at is null) m
   where e.section_id = p_section and e.space = v_space and (p_activity is null or e.id = p_activity)
     and (p_activity is not null or m.n > 0 or exists (select 1 from public.fin_budget_lines l where l.activity_id = e.id and l.space = v_space and l.voided_at is null))
  ), '[]'::jsonb);
end
$$;

create or replace function public.fin_save_budget_line(
  p_section uuid, p_id uuid, p_activity uuid, p_kind text, p_category text, p_description text, p_amount bigint
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); v_id uuid;
begin
  if p_kind is null or p_kind not in ('receita', 'despesa') then raise exception 'Indica se é uma receita ou uma despesa.'; end if;
  if length(trim(coalesce(p_category, ''))) not between 1 and 60 then raise exception 'Escolhe uma categoria (até 60 caracteres).'; end if;
  if length(trim(coalesce(p_description, ''))) not between 1 and 200 then raise exception 'Escreve uma descrição (até 200 caracteres).'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then raise exception 'Indica um valor superior a zero.'; end if;
  if not exists (select 1 from public.cal_events e where e.id = p_activity and e.section_id = p_section and e.space = v_space) then
    raise exception 'Atividade não encontrada.';
  end if;
  if p_id is null then
    insert into public.fin_budget_lines (section_id, space, activity_id, kind, category, description, amount_cents, created_by)
    values (p_section, v_space, p_activity, p_kind, trim(p_category), trim(p_description), p_amount, auth.uid()) returning id into v_id;
  else
    update public.fin_budget_lines set kind = p_kind, category = trim(p_category), description = trim(p_description), amount_cents = p_amount,
           activity_id = p_activity, updated_by = auth.uid(), updated_at = now()
     where id = p_id and section_id = p_section and space = v_space and voided_at is null returning id into v_id;
    if v_id is null then raise exception 'Registo não encontrado.'; end if;
  end if;
  return v_id;
end
$$;

create or replace function public.fin_void_budget_line(p_section uuid, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section);
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Indica o motivo da anulação.'; end if;
  update public.fin_budget_lines set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason), updated_by = auth.uid(), updated_at = now()
   where id = p_id and section_id = p_section and space = v_space and voided_at is null;
  if not found then raise exception 'Registo não encontrado.'; end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Quotas
-- ---------------------------------------------------------------------------
create or replace function public.fin_save_quota(
  p_section uuid, p_id uuid, p_name text, p_period_start date, p_period_end date, p_amount bigint, p_due_date date
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); v_id uuid; c uuid;
begin
  if length(trim(coalesce(p_name, ''))) not between 1 and 120 then raise exception 'Indica o nome da quota (até 120 caracteres).'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then raise exception 'Indica um período válido (início e fim).'; end if;
  if p_due_date is null then raise exception 'Indica a data limite de pagamento.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then raise exception 'Indica um valor superior a zero.'; end if;
  if p_id is null then
    insert into public.fin_quotas (section_id, space, name, period_start, period_end, amount_cents, due_date, created_by)
    values (p_section, v_space, trim(p_name), p_period_start, p_period_end, p_amount, p_due_date, auth.uid()) returning id into v_id;
  else
    -- O valor devido por cada membro fica fixado quando a quota lhe é aplicada.
    update public.fin_quotas set name = trim(p_name), period_start = p_period_start, period_end = p_period_end, amount_cents = p_amount,
           due_date = p_due_date, updated_by = auth.uid(), updated_at = now()
     where id = p_id and section_id = p_section and space = v_space and status = 'ativa' returning id into v_id;
    if v_id is null then raise exception 'Registo não encontrado.'; end if;
    for c in select id from public.fin_quota_charges where quota_id = v_id loop perform private.fin_refresh_charge(c); end loop;
  end if;
  return v_id;
end
$$;

create or replace function public.fin_void_quota(p_section uuid, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); c uuid;
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Indica o motivo da anulação.'; end if;
  update public.fin_quotas set status = 'anulada', void_reason = trim(p_reason), voided_at = now(), voided_by = auth.uid(),
         updated_by = auth.uid(), updated_at = now()
   where id = p_id and section_id = p_section and space = v_space and status = 'ativa';
  if not found then raise exception 'Registo não encontrado.'; end if;
  for c in select id from public.fin_quota_charges where quota_id = p_id loop perform private.fin_refresh_charge(c); end loop;
end
$$;

-- Aplica a quota a membros (fração opcional, p. ex. 1/3 para quem entra a meio do período).
create or replace function public.fin_apply_quota(
  p_section uuid, p_quota uuid, p_profiles uuid[], p_num int default 1, p_den int default 1
) returns int language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); q public.fin_quotas; p uuid; v_id uuid; n int := 0; v_new uuid[] := '{}';
begin
  select * into q from public.fin_quotas where id = p_quota and section_id = p_section and space = v_space for update;
  if q.id is null then raise exception 'Registo não encontrado.'; end if;
  if q.status <> 'ativa' then raise exception 'Esta quota já foi anulada.'; end if;
  if p_num is null or p_den is null or p_num < 1 or p_den < 1 or p_num > p_den or p_den > 12 then
    raise exception 'Fração inválida: usa, por exemplo, 1/3 ou 2/3 (até 12 partes).';
  end if;
  if coalesce(cardinality(p_profiles), 0) = 0 then raise exception 'Escolhe pelo menos um membro.'; end if;
  foreach p in array p_profiles loop
    if not exists (select 1 from public.memberships m where m.profile_id = p and m.section_id = p_section and m.status = 'ativo') then
      raise exception 'Só membros ativos da secção podem ter quotas.';
    end if;
    insert into public.fin_quota_charges (section_id, space, quota_id, profile_id, amount_cents, created_by)
    values (p_section, v_space, q.id, p, private.fin_fraction(q.amount_cents, p_num, p_den), auth.uid())
    on conflict (quota_id, profile_id) do nothing returning id into v_id;
    if v_id is not null then
      n := n + 1; v_new := v_new || p;
      perform private.fin_refresh_charge(v_id);
    end if;
    v_id := null;
  end loop;
  if n > 0 then
    perform private.module_notify(p_section, 'tesouraria', v_space, v_new, 'fin_quota', 'Nova quota',
      'Tens uma nova quota na Tesouraria.', '/tesouraria/minha');
  end if;
  return n;
end
$$;

create or replace function public.fin_waive_charge(p_section uuid, p_charge uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section);
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Indica o motivo da isenção.'; end if;
  update public.fin_quota_charges set status = 'isenta', waive_reason = trim(p_reason), waived_at = now(), waived_by = auth.uid(),
         updated_by = auth.uid(), updated_at = now()
   where id = p_charge and section_id = p_section and space = v_space and status = 'ativa';
  if not found then raise exception 'Registo não encontrado.'; end if;
  perform private.fin_refresh_charge(p_charge);
end
$$;

-- Registar o pagamento de uma quota: cria o movimento (receita do membro) já ligado à quota.
create or replace function public.fin_register_payment(
  p_section uuid, p_charge uuid, p_on date, p_account uuid, p_amount bigint, p_state text default 'efetivo',
  p_allow_excess boolean default false, p_client_key uuid default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); c record; m public.fin_movements;
begin
  select ch.profile_id, q.name into c from public.fin_quota_charges ch join public.fin_quotas q on q.id = ch.quota_id
   where ch.id = p_charge and ch.section_id = p_section and ch.space = v_space;
  if c.profile_id is null then raise exception 'Quota do membro não encontrada.'; end if;
  perform private.fin_validate(p_section, v_space, 'receita', p_on, 'Quota: ' || c.name, 'Quotas', p_amount, p_account, p_state, null, c.profile_id);
  if p_client_key is not null and exists (select 1 from public.fin_movements where section_id = p_section and client_key = p_client_key) then
    raise exception 'Este pagamento já foi registado (envio repetido).';
  end if;
  perform private.fin_check_charge(p_section, v_space, p_charge, c.profile_id, p_amount, null, p_allow_excess);
  insert into public.fin_movements (section_id, space, kind, occurred_on, description, category, amount_cents, account_id,
                                    member_profile_id, quota_charge_id, state, notes, client_key, created_by)
  values (p_section, v_space, 'receita', p_on, left('Quota: ' || c.name, 200), 'Quotas', p_amount, p_account,
          c.profile_id, p_charge, p_state, nullif(trim(coalesce(p_notes, '')), ''), p_client_key, auth.uid())
  returning * into m;
  perform private.fin_after_change(m, null);
  return m.id;
end
$$;

-- Ligar um pagamento já registado (receita do membro) a uma quota. Nunca duas vezes.
create or replace function public.fin_link_payment(p_section uuid, p_movement uuid, p_charge uuid, p_allow_excess boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); o public.fin_movements; m public.fin_movements;
begin
  o := private.fin_get_movement(p_section, v_space, p_movement);
  if o.voided_at is not null then raise exception 'Este movimento está anulado.'; end if;
  if o.quota_charge_id is not null then raise exception 'Este pagamento já está ligado a uma quota: não pode contar duas vezes.'; end if;
  if o.kind <> 'receita' or o.member_profile_id is null then raise exception 'Só uma receita de um membro pode pagar uma quota.'; end if;
  perform private.fin_check_charge(p_section, v_space, p_charge, o.member_profile_id, o.amount_cents, o.id, p_allow_excess);
  update public.fin_movements set quota_charge_id = p_charge, updated_by = auth.uid(), updated_at = now() where id = o.id returning * into m;
  perform private.fin_refresh_charge(p_charge);
end
$$;

create or replace function private.fin_charge_json(ch public.fin_quota_charges, p_with_name boolean)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', ch.id, 'quota_id', ch.quota_id, 'profile_id', ch.profile_id,
    'member_name', case when p_with_name then coalesce(private.fin_name(ch.profile_id), 'Sem nome') end,
    'amount_cents', ch.amount_cents, 'status', ch.status, 'waive_reason', ch.waive_reason,
    'pago', t.ef, 'pendente', t.pe, 'em_falta', case when ch.status = 'ativa' then greatest(ch.amount_cents - t.ef, 0) else 0 end,
    'excesso', greatest(t.ef + t.pe - ch.amount_cents, 0)
  )
  from (select coalesce(sum(amount_cents) filter (where state = 'efetivo'), 0) ef,
               coalesce(sum(amount_cents) filter (where state <> 'efetivo'), 0) pe
          from public.fin_movements where quota_charge_id = ch.id and voided_at is null) t
$$;

create or replace function public.fin_list_quotas(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section);
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', q.id, 'name', q.name, 'period_start', q.period_start, 'period_end', q.period_end, 'amount_cents', q.amount_cents,
      'due_date', q.due_date, 'status', q.status, 'void_reason', q.void_reason,
      'charges', coalesce((select jsonb_agg(private.fin_charge_json(ch, true) order by private.fin_name(ch.profile_id))
                             from public.fin_quota_charges ch where ch.quota_id = q.id), '[]'::jsonb)
    ) order by q.status, q.period_start desc, q.name)
    from public.fin_quotas q where q.section_id = p_section and q.space = v_space), '[]'::jsonb);
end
$$;

-- A própria situação: quotas devidas, pagas e pendentes, e os próprios pagamentos.
create or replace function public.fin_my_situation(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria');
begin
  return (
    with ch as (
      select private.fin_charge_json(c, false) || jsonb_build_object('quota_name', q.name, 'period_start', q.period_start,
               'period_end', q.period_end, 'due_date', q.due_date, 'quota_status', q.status) j, q.status qs
        from public.fin_quota_charges c join public.fin_quotas q on q.id = c.quota_id
       where c.section_id = p_section and c.space = v_space and c.profile_id = auth.uid()
    )
    select jsonb_build_object(
      'charges', coalesce((select jsonb_agg(j order by j ->> 'due_date' desc) from ch), '[]'::jsonb),
      'totals', jsonb_build_object(
        'devido', coalesce((select sum((j ->> 'amount_cents')::bigint) from ch where qs = 'ativa' and j ->> 'status' = 'ativa'), 0),
        'pago', coalesce((select sum((j ->> 'pago')::bigint) from ch), 0),
        'pendente', coalesce((select sum((j ->> 'pendente')::bigint) from ch), 0),
        'em_falta', coalesce((select sum((j ->> 'em_falta')::bigint) from ch where qs = 'ativa'), 0)),
      'payments', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'occurred_on', m.occurred_on, 'description', m.description,
                              'category', m.category, 'amount_cents', m.amount_cents, 'state', m.state,
                              'quota_name', (select q.name from public.fin_quota_charges c join public.fin_quotas q on q.id = c.quota_id where c.id = m.quota_charge_id),
                              'files', (select count(*) from public.module_files f where f.module = 'tesouraria' and f.entity = 'movimento'
                                          and f.entity_id = m.id and f.removed_at is null))
                              order by m.occurred_on desc, m.created_at desc)
                         from public.fin_movements m
                        where m.section_id = p_section and m.space = v_space and m.member_profile_id = auth.uid() and m.voided_at is null), '[]'::jsonb)
    ));
end
$$;

-- Publicar com «passar dados de teste a reais»: passa todas as tabelas fin_ e, como as
-- atividades vêm do Calendário (que pode não passar as suas), desliga dos registos reais
-- qualquer atividade que não seja real: movimentos ficam sem atividade, linhas de orçamento
-- são anuladas. Tudo fica na auditoria; nada é apagado.
create or replace function private.tesouraria_publish_move(p_section uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_t text;
begin
  foreach v_t in array private.module_tables('tesouraria') loop
    execute format('update public.%I set space = ''real'' where section_id = $1 and space = ''teste''', v_t) using p_section;
  end loop;
  update public.fin_movements m set activity_id = null,
         notes = left(coalesce(m.notes || E'\n', '') || 'Atividade de teste desligada ao publicar.', 1000), updated_at = now()
   where m.section_id = p_section and m.space = 'real' and m.activity_id is not null
     and not exists (select 1 from public.cal_events e where e.id = m.activity_id and e.space = 'real');
  update public.fin_budget_lines l set voided_at = now(), void_reason = 'Atividade de teste não passou a dados reais.', updated_at = now()
   where l.section_id = p_section and l.space = 'real' and l.voided_at is null
     and not exists (select 1 from public.cal_events e where e.id = l.activity_id and e.space = 'real');
end
$$;

revoke all on function private.fin_audit_trg() from public, anon, authenticated;
revoke all on function private.tesouraria_publish_move(uuid) from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Mantém reservado ao agendador o envio de lembretes (a base retira-o a utilizadores).
revoke execute on function public.process_due_reminders() from authenticated;


-- ===== 20261021000500_equipas.sql =====
-- Pioneiros — Equipas e cargos: identidade das equipas (cor, emblema, lema), cargos
-- configuráveis por secção (guia, subguia e outros, com responsabilidades), nomeações com
-- datas de início e de fim, mudanças de equipa e o respetivo histórico, por ano escutista
-- (setembro a agosto).
--
-- • Reutiliza teams, memberships e profiles (sem segundo registo de pessoas ou equipas).
--   A tabela teams não é alterada: a identidade visual fica em eq_team_identity.
-- • Nada se apaga: terminar uma nomeação define a data de fim; um registo errado é anulado
--   (fica visível como anulado, com motivo).
-- • Espaço de teste: uma mudança de equipa fica só no histórico do módulo (space = 'teste')
--   e NUNCA altera memberships.team_id. Espaço real: atualiza memberships.team_id e regista
--   o histórico na mesma transação.
-- • Um cargo nunca dá permissões (não toca em module_grants, is_admin nem function).
-- • Todas as tabelas têm section_id e space e RLS sem políticas: leitura e escrita só por
--   funções que verificam o acesso no servidor.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.eq_team_identity (
  team_id uuid not null references public.teams (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  motto text check (motto is null or length(motto) <= 200),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (team_id, space)
);
alter table public.eq_team_identity enable row level security;

create table if not exists public.eq_roles (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  name text not null check (length(trim(name)) between 1 and 80),
  kind text not null default 'cargo' check (kind in ('guia', 'subguia', 'cargo')),
  description text check (description is null or length(description) <= 2000),
  single boolean not null default false,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (kind = 'cargo' or single)
);
create index if not exists eq_roles_section on public.eq_roles (section_id, space);
create unique index if not exists eq_roles_name on public.eq_roles (section_id, space, lower(name)) where archived_at is null;
create unique index if not exists eq_roles_kind on public.eq_roles (section_id, space, kind) where archived_at is null and kind <> 'cargo';
alter table public.eq_roles enable row level security;

create table if not exists public.eq_appointments (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  role_id uuid not null references public.eq_roles (id),
  role_kind text not null check (role_kind in ('guia', 'subguia', 'cargo')),
  team_id uuid not null references public.teams (id),
  membership_id uuid not null references public.memberships (id),
  profile_id uuid not null references public.profiles (id),
  starts_on date not null,
  ends_on date,
  end_reason text check (end_reason is null or length(end_reason) <= 500),
  notes text check (notes is null or length(notes) <= 1000),
  remind_days integer check (remind_days is null or remind_days between 1 and 60),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  ended_by uuid,
  ended_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  check (ends_on is null or ends_on >= starts_on),
  check (cancelled_at is null or cancel_reason is not null)
);
create index if not exists eq_appointments_section on public.eq_appointments (section_id, space);
create index if not exists eq_appointments_member on public.eq_appointments (membership_id);
-- Garantia extra: no máximo um guia e um subguia em aberto (sem fim) por equipa.
create unique index if not exists eq_appointments_one_open
  on public.eq_appointments (space, team_id, role_kind)
  where ends_on is null and cancelled_at is null and role_kind in ('guia', 'subguia');
alter table public.eq_appointments enable row level security;

create table if not exists public.eq_team_moves (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  membership_id uuid not null references public.memberships (id),
  profile_id uuid not null references public.profiles (id),
  from_team_id uuid references public.teams (id),
  to_team_id uuid not null references public.teams (id),
  effective_on date not null,
  reason text check (reason is null or length(reason) <= 500),
  -- true só quando memberships.team_id foi realmente alterado (espaço real).
  applied boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (from_team_id is distinct from to_team_id)
);
create index if not exists eq_team_moves_member on public.eq_team_moves (membership_id, effective_on);
create index if not exists eq_team_moves_section on public.eq_team_moves (section_id, space);
alter table public.eq_team_moves enable row level security;

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
create or replace function private.eq_today()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'Europe/Lisbon')::date $$;

-- Ano escutista (setembro a agosto): 2026-10-15 → «2026/27».
create or replace function private.eq_scout_year(p_day date)
returns text language sql immutable set search_path = ''
as $$
  select case when extract(month from p_day) >= 9
    then extract(year from p_day)::int || '/' || lpad(((extract(year from p_day)::int + 1) % 100)::text, 2, '0')
    else (extract(year from p_day)::int - 1) || '/' || lpad((extract(year from p_day)::int % 100)::text, 2, '0') end
$$;

-- Gerir: acesso ao módulo e (permissão «equipas.gerir», dirigente ou administração).
create or replace function private.eq_can_manage(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.module_space(p_section, 'equipas') is not null
     and (private.has_grant(p_section, 'equipas.gerir') or private.is_dirigente(p_section) or private.is_admin(p_section))
$$;

create or replace function private.eq_require_manage(p_section uuid)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v text := private.module_require(p_section, 'equipas');
begin
  if not private.eq_can_manage(p_section) then
    raise exception 'Não tens permissão para gerir equipas e cargos.' using errcode = '42501';
  end if;
  return v;
end
$$;

-- Equipa atual de uma inscrição no espaço indicado. No espaço real é memberships.team_id;
-- no espaço de teste, a última mudança registada em teste (se for mais recente do que a
-- última mudança real), senão a equipa real.
create or replace function private.eq_current_team(p_membership uuid, p_space text)
returns uuid language sql stable security definer set search_path = ''
as $$
  select case when p_space = 'real' then m.team_id else coalesce((
    select t.to_team_id from public.eq_team_moves t
     where t.membership_id = m.id and t.space = 'teste'
       and t.created_at > coalesce((select max(h.changed_at) from public.membership_history h
                                     where h.membership_id = m.id and h.old_team_id is distinct from h.new_team_id), '-infinity')
     order by t.effective_on desc, t.created_at desc limit 1), m.team_id) end
  from public.memberships m where m.id = p_membership
$$;

create or replace function private.eq_team_name(p_team uuid)
returns text language sql stable security definer set search_path = ''
as $$ select name from public.teams where id = p_team $$;

create or replace function private.eq_fmt(p_day date)
returns text language sql immutable set search_path = ''
as $$ select to_char(p_day, 'DD/MM/YYYY') $$;

-- Conflitos de uma nomeação (períodos [início, fim) — o fim é o dia da passagem de testemunho).
create or replace function private.eq_check_overlap(
  p_space text, p_section uuid, p_role uuid, p_team uuid, p_membership uuid, p_start date, p_end date, p_exclude uuid
) returns void language plpgsql stable security definer set search_path = ''
as $$
declare v_role public.eq_roles; v_name text; v_kind text;
begin
  select * into v_role from public.eq_roles where id = p_role;
  -- A mesma pessoa não acumula o mesmo cargo em períodos sobrepostos.
  if exists (select 1 from public.eq_appointments a
              where a.space = p_space and a.section_id = p_section and a.role_id = p_role and a.membership_id = p_membership
                and a.cancelled_at is null and a.id is distinct from p_exclude
                and a.starts_on < coalesce(p_end, 'infinity'::date) and p_start < coalesce(a.ends_on, 'infinity'::date)
                and a.starts_on < coalesce(a.ends_on, 'infinity'::date)) then
    raise exception 'Esta pessoa já tem o cargo «%» nesse período.', v_role.name;
  end if;
  -- Guia, subguia e cargos únicos: só uma pessoa por equipa de cada vez.
  if v_role.single then
    select p.full_name into v_name from public.eq_appointments a join public.profiles p on p.id = a.profile_id
     where a.space = p_space and a.section_id = p_section and a.role_id = p_role and a.team_id = p_team
       and a.cancelled_at is null and a.id is distinct from p_exclude
       and a.starts_on < coalesce(p_end, 'infinity'::date) and p_start < coalesce(a.ends_on, 'infinity'::date)
       and a.starts_on < coalesce(a.ends_on, 'infinity'::date)
     limit 1;
    if found then
      raise exception 'A equipa % já tem % nesse período (%). Termina primeiro essa nomeação.',
        private.eq_team_name(p_team), v_role.name, coalesce(nullif(v_name, ''), 'outra pessoa');
    end if;
  end if;
  -- Ninguém é guia e subguia da mesma equipa ao mesmo tempo.
  if v_role.kind in ('guia', 'subguia') then
    v_kind := case v_role.kind when 'guia' then 'subguia' else 'guia' end;
    if exists (select 1 from public.eq_appointments a
                where a.space = p_space and a.section_id = p_section and a.membership_id = p_membership and a.role_kind = v_kind
                  and a.cancelled_at is null and a.id is distinct from p_exclude
                  and a.starts_on < coalesce(p_end, 'infinity'::date) and p_start < coalesce(a.ends_on, 'infinity'::date)) then
      raise exception 'Ninguém pode ser guia e subguia ao mesmo tempo. Termina primeiro o outro cargo.';
    end if;
  end if;
end
$$;

-- Lembrete à pessoa antes do fim de um cargo com data de fim (reagendado ou cancelado
-- quando a nomeação muda).
create or replace function private.eq_schedule_end_reminder(p_app uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare a public.eq_appointments; v_due timestamptz; v_role text;
begin
  select * into a from public.eq_appointments where id = p_app;
  if a.id is null then return; end if;
  if a.cancelled_at is not null or a.ends_on is null or a.remind_days is null then
    perform private.cancel_reminders('eq_appointment', a.id);
    return;
  end if;
  v_due := ((a.ends_on - a.remind_days) + time '09:00') at time zone 'Europe/Lisbon';
  if v_due <= now() then
    perform private.cancel_reminders('eq_appointment', a.id);
    return;
  end if;
  select name into v_role from public.eq_roles where id = a.role_id;
  perform private.schedule_reminder(a.section_id, 'equipas', a.space, 'eq_appointment', a.id, 'fim_cargo', a.profile_id, v_due,
    'Cargo a terminar', 'O teu cargo de ' || v_role || ' termina a ' || private.eq_fmt(a.ends_on) || '.',
    '/equipas-e-cargos/pessoa/' || a.membership_id);
end
$$;

-- Anexos (emblema da equipa): ler com acesso ao módulo; carregar/retirar só quem gere.
create or replace function private.equipas_file_access(p_entity text, p_entity_id uuid, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare v_section uuid;
begin
  if p_entity <> 'equipa' then return false; end if;
  select section_id into v_section from public.teams where id = p_entity_id;
  if v_section is null or private.module_space(v_section, 'equipas') is null then return false; end if;
  return not p_write or private.eq_can_manage(v_section);
end
$$;

-- ---------------------------------------------------------------------------
-- Consulta
-- ---------------------------------------------------------------------------
create or replace function public.eq_overview(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'equipas');
  v_manage boolean := private.eq_can_manage(p_section);
  v_me public.memberships := private.my_active_membership(p_section);
  v_my_team uuid;
  v_visible uuid[];
begin
  v_my_team := private.eq_current_team(v_me.id, v_space);
  -- Quem gere vê todas as pessoas; os restantes veem a própria equipa, a si próprios e
  -- quem tem ou teve cargos (os cargos são públicos na secção).
  select coalesce(array_agg(m.id), '{}') into v_visible
    from public.memberships m
   where m.section_id = p_section
     and (
       (v_manage and (m.status in ('ativo', 'suspenso')
                      or exists (select 1 from public.eq_appointments a where a.membership_id = m.id and a.space = v_space)
                      or exists (select 1 from public.eq_team_moves t where t.membership_id = m.id and t.space = v_space)))
       or m.id = v_me.id
       or (m.status = 'ativo' and v_my_team is not null and private.eq_current_team(m.id, v_space) = v_my_team)
       or exists (select 1 from public.eq_appointments a where a.membership_id = m.id and a.space = v_space
                   and a.section_id = p_section and a.cancelled_at is null)
     );

  return jsonb_build_object(
    'space', v_space,
    'can_manage', v_manage,
    'today', private.eq_today(),
    'year', private.eq_scout_year(private.eq_today()),
    'me', v_me.id,
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'archived_at', t.archived_at,
        'color', i.color, 'motto', i.motto,
        'emblem', (select jsonb_build_object('path', f.path, 'file_name', f.file_name) from public.module_files f
                    where f.section_id = p_section and f.module = 'equipas' and f.space = v_space and f.entity = 'equipa'
                      and f.entity_id = t.id and f.removed_at is null order by f.created_at desc limit 1)
      ) order by t.archived_at nulls first, t.name)
      from public.teams t
      left join public.eq_team_identity i on i.team_id = t.id and i.space = v_space and i.section_id = p_section
      where t.section_id = p_section), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membership_id', m.id, 'profile_id', m.profile_id, 'full_name', p.full_name, 'totem', p.totem,
        'function', m.function, 'status', m.status, 'team_id', private.eq_current_team(m.id, v_space),
        'since', (m.approved_at at time zone 'Europe/Lisbon')::date
      ) order by p.full_name)
      from public.memberships m join public.profiles p on p.id = m.profile_id
      where m.id = any (v_visible)), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'kind', r.kind, 'description', r.description, 'single', r.single, 'archived_at', r.archived_at
      ) order by r.archived_at nulls first, case r.kind when 'guia' then 0 when 'subguia' then 1 else 2 end, r.name)
      from public.eq_roles r where r.section_id = p_section and r.space = v_space), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'role_id', a.role_id, 'team_id', a.team_id, 'membership_id', a.membership_id,
        'starts_on', a.starts_on, 'ends_on', a.ends_on, 'end_reason', a.end_reason,
        'notes', case when v_manage or a.membership_id = v_me.id then a.notes end,
        'remind_days', a.remind_days,
        'cancelled_at', a.cancelled_at, 'cancel_reason', case when v_manage then a.cancel_reason end,
        'created_at', a.created_at,
        'created_by_name', (select full_name from public.profiles where id = a.created_by),
        'ended_by_name', (select full_name from public.profiles where id = a.ended_by)
      ) order by a.starts_on desc, a.created_at desc)
      from public.eq_appointments a
      where a.section_id = p_section and a.space = v_space
        and (a.cancelled_at is null or v_manage or a.membership_id = v_me.id)), '[]'::jsonb),
    -- Histórico de equipas: mudanças registadas neste módulo (no espaço atual) e mudanças
    -- feitas na gestão de membros (histórico real de inscrições).
    'moves', coalesce((
      select jsonb_agg(x order by x->>'on' desc, x->>'at' desc) from (
        select jsonb_build_object('id', t.id, 'membership_id', t.membership_id, 'on', t.effective_on, 'at', t.created_at,
          'from_team_id', t.from_team_id, 'to_team_id', t.to_team_id, 'reason', t.reason, 'source', 'modulo', 'applied', t.applied,
          'by_name', (select full_name from public.profiles where id = t.created_by)) as x
          from public.eq_team_moves t
         where t.section_id = p_section and t.space = v_space and (v_manage or t.membership_id = v_me.id)
        union all
        select jsonb_build_object('id', h.id::text, 'membership_id', h.membership_id,
          'on', (h.changed_at at time zone 'Europe/Lisbon')::date, 'at', h.changed_at,
          'from_team_id', h.old_team_id, 'to_team_id', h.new_team_id, 'reason', null, 'source', 'gestao', 'applied', true,
          'by_name', null)
          from public.membership_history h
         where h.section_id = p_section and h.old_team_id is distinct from h.new_team_id
           and coalesce(h.reason, '') not like 'Equipas e cargos%'
           and (v_manage or h.membership_id = v_me.id)
      ) s), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Identidade das equipas
-- ---------------------------------------------------------------------------
create or replace function public.eq_save_identity(p_section uuid, p_team uuid, p_color text, p_motto text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.eq_require_manage(p_section);
begin
  if not exists (select 1 from public.teams where id = p_team and section_id = p_section) then
    raise exception 'Equipa não encontrada.';
  end if;
  if nullif(trim(coalesce(p_color, '')), '') is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Escolhe uma cor válida.';
  end if;
  if length(coalesce(p_motto, '')) > 200 then raise exception 'O lema pode ter até 200 caracteres.'; end if;
  insert into public.eq_team_identity (team_id, section_id, space, color, motto, updated_by, updated_at)
  values (p_team, p_section, v_space, nullif(trim(coalesce(p_color, '')), ''), nullif(trim(coalesce(p_motto, '')), ''), auth.uid(), now())
  on conflict (team_id, space) do update
    set color = excluded.color, motto = excluded.motto, updated_by = excluded.updated_by, updated_at = now();
  perform private.audit(p_section, 'eq_identidade', 'team', p_team::text,
    jsonb_build_object('space', v_space, 'color', p_color, 'motto', p_motto));
end
$$;

-- ---------------------------------------------------------------------------
-- Cargos (configuráveis por secção)
-- ---------------------------------------------------------------------------
create or replace function public.eq_save_role(
  p_section uuid, p_role uuid, p_name text, p_kind text, p_description text, p_single boolean
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.eq_require_manage(p_section); v_old public.eq_roles; v_id uuid; v_single boolean;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Indica o nome do cargo.'; end if;
  if length(trim(p_name)) > 80 then raise exception 'O nome do cargo pode ter até 80 caracteres.'; end if;
  if length(coalesce(p_description, '')) > 2000 then raise exception 'As responsabilidades podem ter até 2000 caracteres.'; end if;
  if p_role is null then
    if coalesce(p_kind, 'cargo') not in ('guia', 'subguia', 'cargo') then raise exception 'Tipo de cargo inválido.'; end if;
    v_single := coalesce(p_kind, 'cargo') <> 'cargo' or coalesce(p_single, false);
    insert into public.eq_roles (section_id, space, name, kind, description, single, created_by, updated_by)
    values (p_section, v_space, trim(p_name), coalesce(p_kind, 'cargo'), nullif(trim(coalesce(p_description, '')), ''), v_single, auth.uid(), auth.uid())
    returning id into v_id;
    perform private.audit(p_section, 'eq_cargo_criado', 'eq_role', v_id::text, jsonb_build_object('space', v_space, 'name', p_name, 'kind', p_kind));
    return v_id;
  end if;
  select * into v_old from public.eq_roles where id = p_role and section_id = p_section and space = v_space for update;
  if v_old.id is null then raise exception 'Registo não encontrado.'; end if;
  -- O tipo (guia, subguia, outro) não muda depois de criado: protege o histórico.
  update public.eq_roles
     set name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''),
         single = v_old.kind <> 'cargo' or coalesce(p_single, false),
         updated_by = auth.uid(), updated_at = now()
   where id = p_role;
  perform private.audit(p_section, 'eq_cargo_alterado', 'eq_role', p_role::text,
    jsonb_build_object('space', v_space, 'de', v_old.name, 'para', p_name));
  return p_role;
exception when unique_violation then
  raise exception 'Já existe um cargo com esse nome (ou desse tipo) nesta secção.';
end
$$;

create or replace function public.eq_set_role_archived(p_section uuid, p_role uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.eq_require_manage(p_section);
begin
  if not exists (select 1 from public.eq_roles where id = p_role and section_id = p_section and space = v_space) then
    raise exception 'Registo não encontrado.';
  end if;
  update public.eq_roles set archived_at = case when p_archived then coalesce(archived_at, now()) end,
         updated_by = auth.uid(), updated_at = now()
   where id = p_role;
  perform private.audit(p_section, case when p_archived then 'eq_cargo_arquivado' else 'eq_cargo_reativado' end, 'eq_role', p_role::text,
    jsonb_build_object('space', v_space));
exception when unique_violation then
  raise exception 'Já existe um cargo ativo com esse nome (ou desse tipo).';
end
$$;

-- Cria os cargos habituais que ainda não existam (só por escolha explícita de quem gere).
create or replace function public.eq_seed_roles(p_section uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.eq_require_manage(p_section); v_n int := 0; r record;
begin
  for r in select * from (values
    ('Guia', 'guia', true, 'Anima e representa a equipa; coordena a preparação das atividades e das reuniões de equipa; acompanha cada elemento e leva a voz da equipa ao Conselho de Guias.'),
    ('Subguia', 'subguia', true, 'Apoia o guia em todas as tarefas e substitui-o quando está ausente; ajuda a integrar os novos elementos.'),
    ('Secretário', 'cargo', true, 'Mantém o livro de equipa e os registos das reuniões e atividades; trata da comunicação da equipa.'),
    ('Tesoureiro', 'cargo', true, 'Acompanha as contas da equipa (quotas e despesas de equipa) e presta contas à equipa. Não dá acesso à tesouraria da secção.'),
    ('Intendente', 'cargo', true, 'Cuida do material da equipa: inventário, arrumação, manutenção e devolução.'),
    ('Cozinheiro', 'cargo', false, 'Planeia as ementas, as compras e a cozinha em acampamento, com atenção à higiene e à segurança alimentar.'),
    ('Socorrista', 'cargo', false, 'Cuida da caixa de primeiros socorros da equipa e conhece os cuidados básicos e os contactos de emergência.')
  ) as d(name, kind, single, description)
  loop
    if not exists (select 1 from public.eq_roles x where x.section_id = p_section and x.space = v_space and x.archived_at is null
                    and (lower(x.name) = lower(r.name) or (r.kind <> 'cargo' and x.kind = r.kind))) then
      insert into public.eq_roles (section_id, space, name, kind, description, single, created_by, updated_by)
      values (p_section, v_space, r.name, r.kind, r.description, r.single, auth.uid(), auth.uid());
      v_n := v_n + 1;
    end if;
  end loop;
  perform private.audit(p_section, 'eq_cargos_base', 'eq_role', null, jsonb_build_object('space', v_space, 'criados', v_n));
  return v_n;
end
$$;

-- ---------------------------------------------------------------------------
-- Nomeações
-- ---------------------------------------------------------------------------
create or replace function public.eq_appoint(
  p_section uuid, p_role uuid, p_team uuid, p_membership uuid, p_starts_on date,
  p_ends_on date default null, p_notes text default null, p_remind_days integer default 7
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.eq_require_manage(p_section); v_role public.eq_roles; v_m public.memberships; v_id uuid;
begin
  -- Bloqueia o cargo: nomeações do mesmo cargo ficam em fila (um guia de cada vez).
  select * into v_role from public.eq_roles where id = p_role and section_id = p_section and space = v_space for update;
  if v_role.id is null then raise exception 'Registo não encontrado.'; end if;
  if v_role.archived_at is not null then raise exception 'Este cargo está arquivado. Reativa-o antes de nomear alguém.'; end if;
  if not exists (select 1 from public.teams where id = p_team and section_id = p_section and archived_at is null) then
    raise exception 'Equipa inválida para esta secção.';
  end if;
  select * into v_m from public.memberships where id = p_membership and section_id = p_section;
  if v_m.id is null then raise exception 'Registo não encontrado.'; end if;
  if v_m.status <> 'ativo' then raise exception 'Só membros ativos podem ser nomeados.'; end if;
  if private.eq_current_team(v_m.id, v_space) is distinct from p_team then
    raise exception 'Esta pessoa não pertence a esta equipa. Muda-a primeiro de equipa.';
  end if;
  if p_starts_on is null then raise exception 'Indica a data de início.'; end if;
  if p_starts_on < date '2000-01-01' or p_starts_on > private.eq_today() + 366 then raise exception 'Data de início inválida.'; end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then raise exception 'A data de fim não pode ser anterior à de início.'; end if;
  if length(coalesce(p_notes, '')) > 1000 then raise exception 'As notas podem ter até 1000 caracteres.'; end if;
  if p_remind_days is not null and p_remind_days not between 1 and 60 then raise exception 'O lembrete deve ser entre 1 e 60 dias antes.'; end if;
  perform private.eq_check_overlap(v_space, p_section, p_role, p_team, p_membership, p_starts_on, p_ends_on, null);
  insert into public.eq_appointments (section_id, space, role_id, role_kind, team_id, membership_id, profile_id,
    starts_on, ends_on, notes, remind_days, created_by)
  values (p_section, v_space, p_role, v_role.kind, p_team, p_membership, v_m.profile_id,
    p_starts_on, p_ends_on, nullif(trim(coalesce(p_notes, '')), ''), p_remind_days, auth.uid())
  returning id into v_id;
  perform private.eq_schedule_end_reminder(v_id);
  perform private.module_notify(p_section, 'equipas', v_space, array[v_m.profile_id], 'eq_cargo', 'Novo cargo',
    'Foste nomeado(a) ' || v_role.name || ' da equipa ' || private.eq_team_name(p_team) || ' a partir de ' || private.eq_fmt(p_starts_on) || '.',
    '/equipas-e-cargos/pessoa/' || p_membership);
  perform private.audit(p_section, 'eq_nomeacao', 'eq_appointment', v_id::text,
    jsonb_build_object('space', v_space, 'role', v_role.name, 'team', p_team, 'membership', p_membership, 'starts_on', p_starts_on, 'ends_on', p_ends_on));
  return v_id;
exception when unique_violation then
  raise exception 'A equipa já tem % em funções. Termina primeiro essa nomeação.', v_role.name;
end
$$;

-- Terminar (ou antecipar/alterar o fim de) uma nomeação. Nunca apaga.
create or replace function public.eq_end_appointment(p_section uuid, p_appointment uuid, p_ends_on date, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.eq_require_manage(p_section); a public.eq_appointments; v_role public.eq_roles;
begin
  select * into a from public.eq_appointments where id = p_appointment and section_id = p_section and space = v_space;
  if a.id is null then raise exception 'Registo não encontrado.'; end if;
  select * into v_role from public.eq_roles where id = a.role_id for update;
  select * into a from public.eq_appointments where id = p_appointment for update;
  if a.cancelled_at is not null then raise exception 'Esta nomeação foi anulada.'; end if;
  if a.ends_on is not null and a.ends_on <= private.eq_today() then raise exception 'Esta nomeação já terminou.'; end if;
  if p_ends_on is null then raise exception 'Indica a data de fim.'; end if;
  if p_ends_on < a.starts_on then raise exception 'A data de fim não pode ser anterior à de início (%).', private.eq_fmt(a.starts_on); end if;
  if p_ends_on > private.eq_today() + 3660 then raise exception 'Data de fim inválida.'; end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'O motivo pode ter até 500 caracteres.'; end if;
  perform private.eq_check_overlap(v_space, p_section, a.role_id, a.team_id, a.membership_id, a.starts_on, p_ends_on, a.id);
  update public.eq_appointments
     set ends_on = p_ends_on, end_reason = nullif(trim(coalesce(p_reason, '')), ''), ended_by = auth.uid(), ended_at = now()
   where id = a.id;
  perform private.eq_schedule_end_reminder(a.id);
  perform private.module_notify(p_section, 'equipas', v_space, array[a.profile_id], 'eq_cargo_fim', 'Cargo terminado',
    'O teu cargo de ' || v_role.name || ' na equipa ' || private.eq_team_name(a.team_id) || ' termina a ' || private.eq_fmt(p_ends_on) || '.',
    '/equipas-e-cargos/pessoa/' || a.membership_id);
  perform private.audit(p_section, 'eq_nomeacao_terminada', 'eq_appointment', a.id::text,
    jsonb_build_object('space', v_space, 'ends_on', p_ends_on, 'anterior', a.ends_on, 'reason', p_reason));
end
$$;

-- Anular uma nomeação registada por engano (fica no histórico como anulada).
create or replace function public.eq_cancel_appointment(p_section uuid, p_appointment uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.eq_require_manage(p_section); a public.eq_appointments;
begin
  select * into a from public.eq_appointments where id = p_appointment and section_id = p_section and space = v_space for update;
  if a.id is null then raise exception 'Registo não encontrado.'; end if;
  if a.cancelled_at is not null then raise exception 'Esta nomeação já foi anulada.'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Indica o motivo da anulação.'; end if;
  update public.eq_appointments set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = left(trim(p_reason), 500)
   where id = a.id;
  perform private.cancel_reminders('eq_appointment', a.id);
  perform private.audit(p_section, 'eq_nomeacao_anulada', 'eq_appointment', a.id::text,
    jsonb_build_object('space', v_space, 'reason', p_reason));
end
$$;

-- ---------------------------------------------------------------------------
-- Mudanças de equipa
-- ---------------------------------------------------------------------------
create or replace function public.eq_move_member(
  p_section uuid, p_membership uuid, p_to_team uuid, p_effective_on date, p_reason text, p_end_roles boolean default true
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_space text := private.eq_require_manage(p_section);
  v_m public.memberships; v_from uuid; v_id uuid; a public.eq_appointments; v_ended int := 0;
begin
  -- Bloqueia a inscrição (no espaço de teste só para serializar; não é alterada).
  select * into v_m from public.memberships where id = p_membership and section_id = p_section for update;
  if v_m.id is null then raise exception 'Registo não encontrado.'; end if;
  if v_m.status <> 'ativo' then raise exception 'Só membros ativos mudam de equipa.'; end if;
  if v_m.function is distinct from 'pioneiro' and v_m.function is distinct from 'guia' then
    raise exception 'Só pioneiros e guias pertencem a equipas.';
  end if;
  if p_to_team is null or not exists (select 1 from public.teams where id = p_to_team and section_id = p_section and archived_at is null) then
    raise exception 'Escolhe a nova equipa.';
  end if;
  v_from := private.eq_current_team(v_m.id, v_space);
  if v_from = p_to_team then raise exception 'Esta pessoa já pertence a essa equipa.'; end if;
  if p_effective_on is null then raise exception 'Indica a data da mudança.'; end if;
  if p_effective_on > private.eq_today() then raise exception 'A data da mudança não pode ser futura.'; end if;
  if p_effective_on < private.eq_today() - 366 then raise exception 'A data da mudança é demasiado antiga.'; end if;
  if exists (select 1 from public.eq_team_moves t where t.membership_id = v_m.id and t.space = v_space and t.effective_on > p_effective_on) then
    raise exception 'Já há uma mudança de equipa registada depois dessa data.';
  end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'O motivo pode ter até 500 caracteres.'; end if;

  insert into public.eq_team_moves (section_id, space, membership_id, profile_id, from_team_id, to_team_id, effective_on, reason, applied, created_by)
  values (p_section, v_space, v_m.id, v_m.profile_id, v_from, p_to_team, p_effective_on, nullif(trim(coalesce(p_reason, '')), ''),
          v_space = 'real', auth.uid())
  returning id into v_id;

  -- Só no espaço real a equipa da inscrição muda (o histórico de inscrições regista-o também).
  if v_space = 'real' then
    perform set_config('pioneiros.reason', left('Equipas e cargos: ' || coalesce(nullif(trim(p_reason), ''), 'mudança de equipa'), 500), true);
    update public.memberships set team_id = p_to_team where id = v_m.id;
  end if;

  -- Os cargos na equipa anterior terminam na data da mudança.
  if coalesce(p_end_roles, true) and v_from is not null then
    for a in select * from public.eq_appointments x
              where x.membership_id = v_m.id and x.space = v_space and x.team_id = v_from and x.cancelled_at is null
                and (x.ends_on is null or x.ends_on > p_effective_on)
              for update
    loop
      update public.eq_appointments
         set ends_on = greatest(a.starts_on, p_effective_on), end_reason = 'Mudança de equipa', ended_by = auth.uid(), ended_at = now()
       where id = a.id;
      perform private.eq_schedule_end_reminder(a.id);
      v_ended := v_ended + 1;
    end loop;
  end if;

  perform private.module_notify(p_section, 'equipas', v_space, array[v_m.profile_id], 'eq_equipa', 'Mudança de equipa',
    'Passaste para a equipa ' || private.eq_team_name(p_to_team) || ' a partir de ' || private.eq_fmt(p_effective_on) || '.'
      || case when v_ended > 0 then ' Os cargos na equipa anterior terminaram.' else '' end,
    '/equipas-e-cargos/pessoa/' || v_m.id);
  perform private.audit(p_section, 'eq_mudanca_equipa', 'membership', v_m.id::text,
    jsonb_build_object('space', v_space, 'de', v_from, 'para', p_to_team, 'em', p_effective_on, 'cargos_terminados', v_ended));
  return v_id;
end
$$;

-- Ao publicar, as simulações do espaço de teste não passam a reais: as equipas e os
-- membros já são os reais, e nomeações ou mudanças de teste podiam contradizer o
-- que entretanto aconteceu. Ficam guardadas no espaço de teste.
create or replace function private.equipas_publish_move(p_section uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'Em Equipas e cargos os dados de teste não passam a reais. Publica sem essa opção e regista as nomeações no espaço real.';
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;


-- ===== 20261021000600_secretaria.sql =====
-- Pioneiros — Secretaria: reuniões, ordem de trabalhos, atas (com versões e
-- aditamentos), decisões e tarefas, anexos e lembretes.
--
-- Visibilidade (verificada no servidor, por reunião):
--   • «Dirigentes autorizados» = dirigentes ativos da secção (private.is_dirigente) ou
--     quem tem 'secretaria.redigir' ou 'secretaria.aprovar' na secção.
--   • Reunião de Equipa ........ membros ativos dessa equipa + dirigentes autorizados.
--   • Conselho de Guias ........ participantes + dirigentes autorizados.
--   • Equipa de Animação ....... só dirigentes autorizados.
--   • Documento geral .......... só quem o criou e as pessoas/equipas com quem foi
--                                partilhado explicitamente (nem dirigentes sem partilha).
--   Em todos os casos é preciso ter acesso ao módulo nesse espaço (teste/real).
--
-- Quem pode o quê:
--   • Consultar: quem vê a reunião (ser tester só dá acesso ao módulo).
--   • Redigir (criar/alterar reuniões, atas, decisões e tarefas; submeter para aprovação):
--     'secretaria.redigir', só nas reuniões que pode ver.
--   • Aprovar ou devolver a rascunho: 'secretaria.aprovar' ou dirigente, só nas reuniões
--     que pode ver. Quem redigiu não precisa de ser quem aprova.
--   • Estado de execução de uma tarefa: quem redige, quem aprova, ou o próprio responsável.
--
-- Atas: Rascunho → Em aprovação → Aprovada (Em aprovação pode voltar a Rascunho).
-- Cada submissão congela a versão (texto + fotografia da reunião, participantes e
-- decisões). Uma versão congelada nunca muda (gatilho). Depois de aprovada, uma correção
-- cria uma nova versão (a aprovada continua consultável) ou um aditamento separado, com
-- o seu próprio fluxo de aprovação.
--
-- Decisões podem referir um pedido (trail_requests) ou uma etapa (stage_paths) apenas
-- como referência: nada é validado nem alterado nessas tabelas.
-- Notificações sem conteúdo das atas (texto genérico). Aditivo: não altera dados existentes.

create table if not exists public.sec_meetings (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  kind text not null check (kind in ('equipa', 'conselho_guias', 'animacao', 'geral')),
  team_id uuid references public.teams (id),
  title text not null check (length(trim(title)) between 1 and 200),
  starts_at timestamptz not null,
  location text check (location is null or length(location) <= 300),
  agenda text not null default '' check (length(agenda) <= 10000),
  cal_event_id uuid references public.cal_events (id) on delete set null,
  status text not null default 'ativa' check (status in ('ativa', 'anulada')),
  cancel_reason text,
  cancelled_by uuid,
  cancelled_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check ((kind = 'equipa') = (team_id is not null))
);
create index if not exists sec_meetings_section on public.sec_meetings (section_id, space, starts_at desc);
alter table public.sec_meetings enable row level security;

create table if not exists public.sec_participants (
  meeting_id uuid not null references public.sec_meetings (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (meeting_id, profile_id)
);
alter table public.sec_participants enable row level security;

-- Partilhas explícitas (documentos gerais): pessoas ou equipas.
create table if not exists public.sec_shares (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.sec_meetings (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  profile_id uuid references public.profiles (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  added_by uuid,
  added_at timestamptz not null default now(),
  check ((profile_id is null) <> (team_id is null))
);
create unique index if not exists sec_shares_profile on public.sec_shares (meeting_id, profile_id) where profile_id is not null;
create unique index if not exists sec_shares_team on public.sec_shares (meeting_id, team_id) where team_id is not null;
alter table public.sec_shares enable row level security;

-- Documentos: a ata da reunião (uma por reunião) e aditamentos a uma ata aprovada.
create table if not exists public.sec_minutes (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  meeting_id uuid not null references public.sec_meetings (id) on delete cascade,
  kind text not null check (kind in ('ata', 'aditamento')),
  parent_id uuid references public.sec_minutes (id),
  status text not null default 'rascunho' check (status in ('rascunho', 'em_aprovacao', 'aprovada')),
  current_version integer not null default 1,
  approved_version integer,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check ((kind = 'aditamento') = (parent_id is not null)),
  check (status <> 'aprovada' or approved_version = current_version)
);
create unique index if not exists sec_minutes_one_ata on public.sec_minutes (meeting_id) where kind = 'ata';
create index if not exists sec_minutes_section on public.sec_minutes (section_id, space);
alter table public.sec_minutes enable row level security;

create table if not exists public.sec_minute_versions (
  id uuid primary key default gen_random_uuid(),
  minute_id uuid not null references public.sec_minutes (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  version_no integer not null check (version_no >= 1),
  body text not null default '' check (length(body) <= 50000),
  note text check (note is null or length(note) <= 1000),
  snapshot jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  frozen_at timestamptz,
  submitted_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  unique (minute_id, version_no),
  check (frozen_at is not null or (snapshot is null and approved_at is null))
);
alter table public.sec_minute_versions enable row level security;

-- Uma versão congelada (submetida) nunca muda; a aprovação só é registada uma vez.
-- (A mudança de espaço ao publicar o módulo é a única exceção.)
create or replace function private.sec_versions_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.frozen_at is not null then
    if (to_jsonb(new) - 'space' - 'approved_at' - 'approved_by') is distinct from (to_jsonb(old) - 'space' - 'approved_at' - 'approved_by')
       or (old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by)) then
      raise exception 'Esta versão da ata está fechada e não pode ser alterada.';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists sec_versions_guard on public.sec_minute_versions;
create trigger sec_versions_guard before update on public.sec_minute_versions
  for each row execute function private.sec_versions_guard();

create table if not exists public.sec_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  meeting_id uuid not null references public.sec_meetings (id) on delete cascade,
  minute_id uuid not null references public.sec_minutes (id) on delete cascade,
  kind text not null check (kind in ('decisao', 'tarefa')),
  text text not null check (length(trim(text)) between 1 and 2000),
  responsible_id uuid references public.profiles (id),
  due_date date,
  reminder_days integer not null default 2 check (reminder_days between 0 and 60),
  exec_status text not null default 'por_fazer' check (exec_status in ('por_fazer', 'em_curso', 'feita', 'cancelada')),
  status_note text check (status_note is null or length(status_note) <= 1000),
  status_changed_by uuid,
  status_changed_at timestamptz,
  -- Só referência: nada é validado nem alterado no pedido ou na etapa.
  trail_request_id uuid references public.trail_requests (id) on delete set null,
  stage_path_id uuid references public.stage_paths (id) on delete set null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (kind <> 'tarefa' or (responsible_id is not null and due_date is not null))
);
create index if not exists sec_items_meeting on public.sec_items (meeting_id);
create index if not exists sec_items_responsible on public.sec_items (section_id, space, responsible_id);
alter table public.sec_items enable row level security;

-- ---------------------------------------------------------------------------
-- Regras de acesso
-- ---------------------------------------------------------------------------
create or replace function private.sec_authorized_as(p_section uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.memberships m where m.section_id = p_section and m.profile_id = p_profile
                  and m.status = 'ativo' and m.function = 'dirigente')
      or (exists (select 1 from public.memberships m where m.section_id = p_section and m.profile_id = p_profile and m.status = 'ativo')
          and exists (select 1 from public.module_grants g where g.section_id = p_section and g.profile_id = p_profile
                       and g.permission in ('secretaria.redigir', 'secretaria.aprovar')))
$$;

-- Pode esta pessoa ver a reunião (ignora o acesso ao módulo, verificado à parte)?
create or replace function private.sec_can_see_as(p_meeting uuid, p_profile uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare m public.sec_meetings; v_team uuid;
begin
  select * into m from public.sec_meetings where id = p_meeting;
  if m.id is null or p_profile is null then return false; end if;
  select team_id into v_team from public.memberships
   where section_id = m.section_id and profile_id = p_profile and status = 'ativo';
  if not found then return false; end if;
  if m.kind = 'geral' then
    return m.created_by = p_profile
        or exists (select 1 from public.sec_shares s where s.meeting_id = m.id
                    and (s.profile_id = p_profile or (s.team_id is not null and s.team_id = v_team)));
  end if;
  if private.sec_authorized_as(m.section_id, p_profile) then return true; end if;
  return case m.kind
    when 'equipa' then v_team is not distinct from m.team_id and v_team is not null
    when 'conselho_guias' then exists (select 1 from public.sec_participants p where p.meeting_id = m.id and p.profile_id = p_profile)
    else false end;
end
$$;

create or replace function private.sec_can_see(p_meeting uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.sec_meetings m where m.id = p_meeting
                  and private.module_space(m.section_id, 'secretaria') = m.space)
     and private.sec_can_see_as(p_meeting, auth.uid())
$$;

create or replace function private.sec_can_draft(p_meeting uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.sec_can_see(p_meeting)
     and private.has_grant((select section_id from public.sec_meetings where id = p_meeting), 'secretaria.redigir')
$$;

create or replace function private.sec_can_approve_as(p_meeting uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.sec_can_see_as(p_meeting, p_profile)
     and (exists (select 1 from public.module_grants g join public.sec_meetings m on m.section_id = g.section_id
                   where m.id = p_meeting and g.profile_id = p_profile and g.permission = 'secretaria.aprovar')
          or exists (select 1 from public.memberships ms join public.sec_meetings m on m.section_id = ms.section_id
                      where m.id = p_meeting and ms.profile_id = p_profile and ms.status = 'ativo' and ms.function = 'dirigente'))
$$;

create or replace function private.sec_can_approve(p_meeting uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.sec_can_see(p_meeting) and private.sec_can_approve_as(p_meeting, auth.uid())
$$;

-- Reunião desta secção/espaço visível à pessoa atual (senão «Registo não encontrado.»).
create or replace function private.sec_meeting_get(p_section uuid, p_space text, p_meeting uuid, p_lock boolean default false)
returns public.sec_meetings language plpgsql security definer set search_path = ''
as $$
declare m public.sec_meetings;
begin
  if p_lock then
    select * into m from public.sec_meetings where id = p_meeting and section_id = p_section and space = p_space for update;
  else
    select * into m from public.sec_meetings where id = p_meeting and section_id = p_section and space = p_space;
  end if;
  if m.id is null or not private.sec_can_see(m.id) then raise exception 'Registo não encontrado.'; end if;
  return m;
end
$$;

create or replace function private.sec_minute_get(p_section uuid, p_space text, p_minute uuid, p_lock boolean default false)
returns public.sec_minutes language plpgsql security definer set search_path = ''
as $$
declare d public.sec_minutes;
begin
  if p_lock then
    select * into d from public.sec_minutes where id = p_minute and section_id = p_section and space = p_space for update;
  else
    select * into d from public.sec_minutes where id = p_minute and section_id = p_section and space = p_space;
  end if;
  if d.id is null or not private.sec_can_see(d.meeting_id) then raise exception 'Registo não encontrado.'; end if;
  return d;
end
$$;

create or replace function private.sec_require_draft(p_meeting uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.sec_can_draft(p_meeting) then
    raise exception 'Não tens permissão para redigir nesta reunião.' using errcode = '42501';
  end if;
end
$$;

-- Anexos: lê quem vê a reunião; anexa/retira quem redige (num documento, só em rascunho).
create or replace function private.secretaria_file_access(p_entity text, p_entity_id uuid, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare v_meeting uuid; v_status text;
begin
  if p_entity = 'sec_meeting' then
    v_meeting := p_entity_id;
  elsif p_entity = 'sec_minute' then
    select meeting_id, status into v_meeting, v_status from public.sec_minutes where id = p_entity_id;
  else
    return false;
  end if;
  if v_meeting is null then return false; end if;
  if not p_write then return private.sec_can_see(v_meeting); end if;
  if p_entity = 'sec_minute' and v_status = 'aprovada' then return false; end if;
  return private.sec_can_draft(v_meeting)
     and exists (select 1 from public.sec_meetings where id = v_meeting and status = 'ativa');
end
$$;

-- ---------------------------------------------------------------------------
-- Leitura auxiliar
-- ---------------------------------------------------------------------------
create or replace function private.sec_name(p_profile uuid)
returns text language sql stable security definer set search_path = ''
as $$ select coalesce(nullif(trim(full_name), ''), 'Sem nome') from public.profiles where id = p_profile $$;

create or replace function private.sec_link_label(p_request uuid, p_stage uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select 'Pedido: ' || private.sec_name(ms.profile_id) || ' · ' || coalesce(t.name, r.trail_key)
       from public.trail_requests r join public.memberships ms on ms.id = r.membership_id
       left join public.catalog_trails t on t.id = r.trail_id where r.id = p_request),
    (select 'Etapa: ' || private.sec_name(ms.profile_id) || ' · ' || coalesce(st.name, sp.stage_key)
       from public.stage_paths sp join public.memberships ms on ms.id = sp.membership_id
       left join public.catalog_stages st on st.id = sp.stage_id where sp.id = p_stage))
$$;

create or replace function private.sec_item_json(i public.sec_items)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'minute_id', i.minute_id, 'kind', i.kind, 'text', i.text,
    'responsible_id', i.responsible_id, 'responsible_name', private.sec_name(i.responsible_id),
    'due_date', i.due_date, 'reminder_days', i.reminder_days, 'exec_status', i.exec_status, 'status_note', i.status_note,
    'trail_request_id', i.trail_request_id, 'stage_path_id', i.stage_path_id,
    'link_label', private.sec_link_label(i.trail_request_id, i.stage_path_id))
$$;

-- Conteúdo de um documento (ao vivo; congelado como «snapshot» quando é submetido).
create or replace function private.sec_content(p_minute uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'title', m.title, 'kind', m.kind, 'team_name', t.name, 'starts_at', m.starts_at, 'location', m.location, 'agenda', m.agenda,
    'participants', coalesce((select jsonb_agg(private.sec_name(p.profile_id) order by private.sec_name(p.profile_id))
                               from public.sec_participants p where p.meeting_id = m.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'text', i.text,
                                         'responsible_name', private.sec_name(i.responsible_id), 'due_date', i.due_date,
                                         'link_label', private.sec_link_label(i.trail_request_id, i.stage_path_id))
                                       order by i.created_at)
                         from public.sec_items i where i.minute_id = d.id), '[]'::jsonb))
  from public.sec_minutes d join public.sec_meetings m on m.id = d.meeting_id
  left join public.teams t on t.id = m.team_id
  where d.id = p_minute
$$;

-- Destinatários de «há uma ata para aprovar»: quem pode aprovar e vê a reunião.
create or replace function private.sec_approvers(p_meeting uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(ms.profile_id), '{}') from public.memberships ms
    join public.sec_meetings m on m.section_id = ms.section_id
   where m.id = p_meeting and ms.status = 'ativo' and private.sec_can_approve_as(p_meeting, ms.profile_id)
$$;

-- Lembrete antes do prazo de uma tarefa (único por tarefa e responsável).
create or replace function private.sec_schedule_item(i public.sec_items)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_due timestamptz;
begin
  perform private.cancel_reminders('sec_item', i.id);
  if i.kind <> 'tarefa' or i.responsible_id is null or i.due_date is null or i.exec_status in ('feita', 'cancelada')
     or exists (select 1 from public.sec_meetings where id = i.meeting_id and status = 'anulada') then
    return;
  end if;
  v_due := ((i.due_date - i.reminder_days)::timestamp + time '09:00') at time zone 'Europe/Lisbon';
  if i.due_date < (now() at time zone 'Europe/Lisbon')::date then return; end if;
  perform private.schedule_reminder(i.section_id, 'secretaria', i.space, 'sec_item', i.id, 'prazo', i.responsible_id,
    v_due, 'Prazo de tarefa', 'Uma tarefa tua aproxima-se do prazo.', '/secretaria/tarefas');
end
$$;

-- ---------------------------------------------------------------------------
-- Consultas
-- ---------------------------------------------------------------------------
create or replace function public.sec_people(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria');
begin
  return jsonb_build_object(
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', ms.profile_id, 'name', private.sec_name(ms.profile_id),
                                   'team_id', ms.team_id, 'function', ms.function) order by private.sec_name(ms.profile_id))
                         from public.memberships ms where ms.section_id = p_section and ms.status = 'ativo'), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                        from public.teams t where t.section_id = p_section and t.archived_at is null), '[]'::jsonb));
end
$$;

create or replace function public.sec_meetings(p_section uuid, p_search text default null, p_kind text default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); v_q text := nullif(trim(coalesce(p_search, '')), '');
begin
  return jsonb_build_object(
    'can_draft', private.has_grant(p_section, 'secretaria.redigir'),
    'can_approve', private.has_grant(p_section, 'secretaria.aprovar') or private.is_dirigente(p_section),
    'meetings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'team_name', t.name, 'title', m.title, 'starts_at', m.starts_at, 'location', m.location,
        'status', m.status,
        'ata', (select jsonb_build_object('id', d.id, 'status', d.status, 'approved_version', d.approved_version, 'current_version', d.current_version)
                  from public.sec_minutes d where d.meeting_id = m.id and d.kind = 'ata'),
        'open_tasks', (select count(*) from public.sec_items i where i.meeting_id = m.id and i.kind = 'tarefa'
                         and i.exec_status in ('por_fazer', 'em_curso'))
      ) order by m.starts_at desc)
      from public.sec_meetings m left join public.teams t on t.id = m.team_id
      where m.section_id = p_section and m.space = v_space
        and (p_kind is null or m.kind = p_kind)
        and (v_q is null or m.title ilike '%' || v_q || '%' or m.agenda ilike '%' || v_q || '%')
        and private.sec_can_see_as(m.id, auth.uid())), '[]'::jsonb));
end
$$;

create or replace function public.sec_meeting(p_section uuid, p_meeting uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); m public.sec_meetings;
begin
  m := private.sec_meeting_get(p_section, v_space, p_meeting);
  return jsonb_build_object(
    'meeting', to_jsonb(m) || jsonb_build_object(
      'team_name', (select name from public.teams where id = m.team_id),
      'created_by_name', private.sec_name(m.created_by),
      'cal_event', (select jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', coalesce(e.starts_at, e.start_date::timestamptz), 'status', e.status)
                      from public.cal_events e where e.id = m.cal_event_id and e.section_id = p_section and e.space = v_space)),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('id', p.profile_id, 'name', private.sec_name(p.profile_id)) order by private.sec_name(p.profile_id))
                               from public.sec_participants p where p.meeting_id = m.id), '[]'::jsonb),
    'shares', coalesce((select jsonb_agg(jsonb_build_object('profile_id', s.profile_id, 'team_id', s.team_id,
                                  'name', coalesce(private.sec_name(s.profile_id), (select name from public.teams where id = s.team_id))))
                         from public.sec_shares s where s.meeting_id = m.id), '[]'::jsonb),
    'minutes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'status', d.status,
                                   'current_version', d.current_version, 'approved_version', d.approved_version, 'created_at', d.created_at)
                                 order by d.kind = 'aditamento', d.created_at)
                          from public.sec_minutes d where d.meeting_id = m.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(private.sec_item_json(i) order by i.created_at) from public.sec_items i where i.meeting_id = m.id), '[]'::jsonb),
    'can_draft', private.sec_can_draft(m.id),
    'can_approve', private.sec_can_approve(m.id));
end
$$;

-- Documento (ata ou aditamento) com histórico de versões; p_version escolhe a versão a ver.
create or replace function public.sec_minute(p_section uuid, p_minute uuid, p_version integer default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes; v public.sec_minute_versions;
        m public.sec_meetings; v_draft boolean; v_appr boolean;
begin
  d := private.sec_minute_get(p_section, v_space, p_minute);
  select * into m from public.sec_meetings where id = d.meeting_id;
  select * into v from public.sec_minute_versions where minute_id = d.id and version_no = coalesce(p_version, d.current_version);
  if v.id is null then raise exception 'Registo não encontrado.'; end if;
  v_draft := private.sec_can_draft(m.id) and m.status = 'ativa';
  v_appr := private.sec_can_approve(m.id) and m.status = 'ativa';
  return jsonb_build_object(
    'minute', to_jsonb(d) || jsonb_build_object('created_by_name', private.sec_name(d.created_by)),
    'meeting', jsonb_build_object('id', m.id, 'title', m.title, 'kind', m.kind, 'status', m.status, 'starts_at', m.starts_at),
    'test', v_space = 'teste',
    'version', jsonb_build_object('version_no', v.version_no, 'body', v.body, 'note', v.note, 'frozen', v.frozen_at is not null,
                 'frozen_at', v.frozen_at, 'submitted_by_name', private.sec_name(v.submitted_by),
                 'approved_at', v.approved_at, 'approved_by_name', private.sec_name(v.approved_by),
                 'created_by_name', private.sec_name(v.created_by), 'updated_at', v.updated_at,
                 'content', coalesce(v.snapshot, private.sec_content(d.id))),
    'versions', (select jsonb_agg(jsonb_build_object('version_no', x.version_no, 'note', x.note, 'created_at', x.created_at,
                    'created_by_name', private.sec_name(x.created_by), 'frozen_at', x.frozen_at,
                    'approved_at', x.approved_at, 'approved_by_name', private.sec_name(x.approved_by)) order by x.version_no desc)
                  from public.sec_minute_versions x where x.minute_id = d.id),
    'parent', (select jsonb_build_object('id', p.id, 'approved_version', p.approved_version) from public.sec_minutes p where p.id = d.parent_id),
    'addenda', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'status', a.status, 'created_at', a.created_at,
                                 'approved_version', a.approved_version) order by a.created_at)
                          from public.sec_minutes a where a.parent_id = d.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(private.sec_item_json(i) order by i.created_at) from public.sec_items i where i.minute_id = d.id), '[]'::jsonb),
    'can_edit', v_draft and d.status = 'rascunho',
    'can_submit', v_draft and d.status = 'rascunho',
    'can_approve', v_appr and d.status = 'em_aprovacao',
    'can_return', (v_appr or v_draft) and d.status = 'em_aprovacao',
    'can_revise', v_draft and d.status = 'aprovada' and d.kind = 'ata',
    'can_addendum', v_draft and d.kind = 'ata' and d.approved_version is not null,
    'can_track', v_draft or v_appr);
end
$$;

create or replace function public.sec_my_tasks(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria');
begin
  return coalesce((
    select jsonb_agg(private.sec_item_json(i) || jsonb_build_object(
             'meeting_id', case when private.sec_can_see_as(i.meeting_id, auth.uid()) then i.meeting_id end,
             'meeting_title', case when private.sec_can_see_as(i.meeting_id, auth.uid()) then m.title end)
           order by i.exec_status in ('feita', 'cancelada'), i.due_date nulls last)
      from public.sec_items i join public.sec_meetings m on m.id = i.meeting_id
     where i.section_id = p_section and i.space = v_space and i.responsible_id = auth.uid()
       and m.status = 'ativa'), '[]'::jsonb);
end
$$;

-- Atividades do calendário (mesma secção e espaço) para ligar a uma reunião.
create or replace function public.sec_event_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'secretaria', 'secretaria.redigir', false);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title,
                     'starts_at', coalesce(e.starts_at, (e.start_date::timestamp + time '12:00') at time zone 'Europe/Lisbon'),
                     'all_day', e.all_day) order by coalesce(e.starts_at, e.start_date::timestamptz) desc)
                     from public.cal_events e
                    where e.section_id = p_section and e.space = v_space and e.status = 'ativo'
                      and coalesce(e.starts_at, e.start_date::timestamptz) > now() - interval '400 days'), '[]'::jsonb);
end
$$;

-- Pedidos e etapas da secção que podem ser referidos numa decisão (só para quem redige).
create or replace function public.sec_link_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'secretaria', 'secretaria.redigir', false);
begin
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'label', private.sec_link_label(r.id, null), 'status', r.status)
                                   order by r.updated_at desc)
                           from public.trail_requests r join public.memberships ms on ms.id = r.membership_id
                          where r.section_id = p_section and ms.status = 'ativo' and r.status not in ('cancelado')), '[]'::jsonb),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('id', sp.id, 'label', private.sec_link_label(null, sp.id), 'status', sp.status)
                                 order by sp.opened_at desc)
                         from public.stage_paths sp join public.memberships ms on ms.id = sp.membership_id
                        where ms.section_id = p_section and ms.status = 'ativo'), '[]'::jsonb));
end
$$;

-- ---------------------------------------------------------------------------
-- Reuniões
-- ---------------------------------------------------------------------------
create or replace function public.sec_meeting_save(
  p_section uuid, p_meeting uuid, p_kind text, p_team uuid, p_title text, p_starts_at timestamptz,
  p_location text, p_agenda text, p_cal_event uuid,
  p_participants uuid[] default '{}', p_share_profiles uuid[] default '{}', p_share_teams uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'secretaria', 'secretaria.redigir', false);
        m public.sec_meetings; v_id uuid; v_bad int; v_before jsonb;
begin
  if p_kind not in ('equipa', 'conselho_guias', 'animacao', 'geral') then raise exception 'Escolhe o tipo de reunião.'; end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'Indica o título.'; end if;
  if length(trim(p_title)) > 200 then raise exception 'O título é demasiado longo (máximo 200 caracteres).'; end if;
  if p_starts_at is null then raise exception 'Indica a data e a hora.'; end if;
  if length(coalesce(p_agenda, '')) > 10000 then raise exception 'A ordem de trabalhos é demasiado longa.'; end if;
  if length(coalesce(p_location, '')) > 300 then raise exception 'O local é demasiado longo.'; end if;
  if p_kind = 'equipa' then
    if p_team is null then raise exception 'Escolhe a equipa.'; end if;
    if not exists (select 1 from public.teams where id = p_team and section_id = p_section and archived_at is null) then
      raise exception 'Equipa não encontrada.';
    end if;
  end if;
  if p_cal_event is not null and not exists (select 1 from public.cal_events where id = p_cal_event and section_id = p_section and space = v_space) then
    raise exception 'Atividade do calendário não encontrada.';
  end if;
  select count(*) into v_bad from unnest(coalesce(p_participants, '{}') || coalesce(p_share_profiles, '{}')) x
   where not exists (select 1 from public.memberships ms where ms.profile_id = x and ms.section_id = p_section and ms.status = 'ativo');
  if v_bad > 0 then raise exception 'Só podes escolher membros ativos da secção.'; end if;
  if exists (select 1 from unnest(coalesce(p_share_teams, '{}')) x where not exists (select 1 from public.teams t where t.id = x and t.section_id = p_section)) then
    raise exception 'Equipa não encontrada.';
  end if;

  if p_meeting is null then
    insert into public.sec_meetings (section_id, space, kind, team_id, title, starts_at, location, agenda, cal_event_id, created_by, updated_by)
    values (p_section, v_space, p_kind, case when p_kind = 'equipa' then p_team end, trim(p_title), p_starts_at,
            nullif(trim(coalesce(p_location, '')), ''), coalesce(p_agenda, ''), p_cal_event, auth.uid(), auth.uid())
    returning id into v_id;
  else
    m := private.sec_meeting_get(p_section, v_space, p_meeting, true);
    perform private.sec_require_draft(m.id);
    if m.status = 'anulada' then raise exception 'Esta reunião foi anulada.'; end if;
    if m.kind <> p_kind and exists (select 1 from public.sec_minutes where meeting_id = m.id) then
      raise exception 'O tipo de reunião não pode mudar depois de criada a ata.';
    end if;
    v_before := jsonb_build_object('kind', m.kind, 'team', m.team_id, 'title', m.title, 'starts_at', m.starts_at,
      'participants', (select jsonb_agg(profile_id) from public.sec_participants where meeting_id = m.id));
    update public.sec_meetings set kind = p_kind, team_id = case when p_kind = 'equipa' then p_team end, title = trim(p_title),
           starts_at = p_starts_at, location = nullif(trim(coalesce(p_location, '')), ''), agenda = coalesce(p_agenda, ''),
           cal_event_id = p_cal_event, updated_by = auth.uid(), updated_at = now()
     where id = m.id;
    v_id := m.id;
  end if;

  delete from public.sec_participants where meeting_id = v_id and profile_id <> all (coalesce(p_participants, '{}'));
  insert into public.sec_participants (meeting_id, section_id, space, profile_id, added_by)
  select distinct v_id, p_section, v_space, x, auth.uid() from unnest(coalesce(p_participants, '{}')) x
  on conflict do nothing;
  delete from public.sec_shares where meeting_id = v_id;
  if p_kind = 'geral' then
    insert into public.sec_shares (meeting_id, section_id, space, profile_id, added_by)
    select distinct v_id, p_section, v_space, x, auth.uid() from unnest(coalesce(p_share_profiles, '{}')) x;
    insert into public.sec_shares (meeting_id, section_id, space, team_id, added_by)
    select distinct v_id, p_section, v_space, x, auth.uid() from unnest(coalesce(p_share_teams, '{}')) x;
  end if;
  -- Quem cria/altera tem de continuar a ver a reunião (evita documentos órfãos).
  if not private.sec_can_see(v_id) then
    raise exception 'Com estas escolhas deixarias de ver esta reunião. Revê o tipo, a equipa ou os participantes.';
  end if;
  perform private.audit(p_section, case when p_meeting is null then 'sec_reuniao_criada' else 'sec_reuniao_alterada' end,
    'sec_meeting', v_id::text, jsonb_build_object('space', v_space, 'antes', v_before));
  return v_id;
end
$$;

create or replace function public.sec_meeting_cancel(p_section uuid, p_meeting uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); m public.sec_meetings; v_i uuid;
begin
  m := private.sec_meeting_get(p_section, v_space, p_meeting, true);
  perform private.sec_require_draft(m.id);
  if m.status = 'anulada' then raise exception 'Esta reunião já foi anulada.'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Indica o motivo.'; end if;
  if exists (select 1 from public.sec_minutes where meeting_id = m.id and approved_version is not null) then
    raise exception 'Uma reunião com ata aprovada não pode ser anulada.';
  end if;
  update public.sec_meetings set status = 'anulada', cancel_reason = trim(p_reason), cancelled_by = auth.uid(), cancelled_at = now(),
         updated_by = auth.uid(), updated_at = now() where id = m.id;
  for v_i in select id from public.sec_items where meeting_id = m.id loop
    perform private.cancel_reminders('sec_item', v_i);
  end loop;
  perform private.audit(p_section, 'sec_reuniao_anulada', 'sec_meeting', m.id::text, jsonb_build_object('motivo', trim(p_reason)));
end
$$;

-- ---------------------------------------------------------------------------
-- Atas e aditamentos
-- ---------------------------------------------------------------------------
create or replace function public.sec_minute_create(p_section uuid, p_meeting uuid, p_kind text, p_body text default '')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); m public.sec_meetings; v_parent public.sec_minutes; v_id uuid;
begin
  m := private.sec_meeting_get(p_section, v_space, p_meeting, true);
  perform private.sec_require_draft(m.id);
  if m.status = 'anulada' then raise exception 'Esta reunião foi anulada.'; end if;
  if length(coalesce(p_body, '')) > 50000 then raise exception 'O texto é demasiado longo.'; end if;
  if p_kind = 'ata' then
    if exists (select 1 from public.sec_minutes where meeting_id = m.id and kind = 'ata') then
      raise exception 'Esta reunião já tem ata.';
    end if;
  elsif p_kind = 'aditamento' then
    select * into v_parent from public.sec_minutes where meeting_id = m.id and kind = 'ata';
    if v_parent.id is null or v_parent.approved_version is null then
      raise exception 'Só se acrescentam aditamentos a uma ata aprovada.';
    end if;
  else
    raise exception 'Tipo de documento inválido.';
  end if;
  insert into public.sec_minutes (section_id, space, meeting_id, kind, parent_id, created_by, updated_by)
  values (p_section, v_space, m.id, p_kind, v_parent.id, auth.uid(), auth.uid()) returning id into v_id;
  insert into public.sec_minute_versions (minute_id, section_id, space, version_no, body, created_by, updated_by)
  values (v_id, p_section, v_space, 1, coalesce(p_body, ''), auth.uid(), auth.uid());
  perform private.audit(p_section, case when p_kind = 'ata' then 'sec_ata_criada' else 'sec_aditamento_criado' end,
    'sec_minute', v_id::text, jsonb_build_object('meeting', m.id, 'space', v_space));
  return v_id;
end
$$;

create or replace function public.sec_minute_save(p_section uuid, p_minute uuid, p_body text, p_expected_version integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes;
begin
  d := private.sec_minute_get(p_section, v_space, p_minute, true);
  perform private.sec_require_draft(d.meeting_id);
  if d.status = 'aprovada' then
    raise exception 'Uma ata aprovada não pode ser alterada. Cria uma nova versão ou um aditamento.';
  end if;
  if d.status <> 'rascunho' then raise exception 'Esta ata está em aprovação. Volta a rascunho para a alterar.'; end if;
  if p_expected_version is distinct from d.current_version then raise exception 'A ata mudou entretanto. Atualiza a página.'; end if;
  if length(coalesce(p_body, '')) > 50000 then raise exception 'O texto é demasiado longo.'; end if;
  update public.sec_minute_versions set body = coalesce(p_body, ''), updated_by = auth.uid(), updated_at = now()
   where minute_id = d.id and version_no = d.current_version;
  update public.sec_minutes set updated_by = auth.uid(), updated_at = now() where id = d.id;
end
$$;

create or replace function public.sec_minute_submit(p_section uuid, p_minute uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes; v_body text; m public.sec_meetings;
begin
  d := private.sec_minute_get(p_section, v_space, p_minute, true);
  perform private.sec_require_draft(d.meeting_id);
  select * into m from public.sec_meetings where id = d.meeting_id;
  if m.status = 'anulada' then raise exception 'Esta reunião foi anulada.'; end if;
  if d.status <> 'rascunho' then raise exception 'Só uma ata em rascunho pode ser enviada para aprovação.'; end if;
  if p_expected_version is distinct from d.current_version then raise exception 'A ata mudou entretanto. Atualiza a página.'; end if;
  select body into v_body from public.sec_minute_versions where minute_id = d.id and version_no = d.current_version;
  if nullif(trim(v_body), '') is null then raise exception 'Escreve o texto da ata antes de a enviar para aprovação.'; end if;
  update public.sec_minute_versions set snapshot = private.sec_content(d.id), frozen_at = now(), submitted_by = auth.uid()
   where minute_id = d.id and version_no = d.current_version;
  update public.sec_minutes set status = 'em_aprovacao', updated_by = auth.uid(), updated_at = now() where id = d.id;
  perform private.audit(p_section, 'sec_ata_submetida', 'sec_minute', d.id::text, jsonb_build_object('versao', d.current_version));
  perform private.module_notify(p_section, 'secretaria', v_space, private.sec_approvers(d.meeting_id), 'sec_aprovar',
    'Ata para aprovar', 'Há uma ata para aprovar.', '/secretaria/atas/' || d.id);
end
$$;

create or replace function public.sec_minute_return(p_section uuid, p_minute uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes; v public.sec_minute_versions;
begin
  d := private.sec_minute_get(p_section, v_space, p_minute, true);
  if not (private.sec_can_approve(d.meeting_id) or private.sec_can_draft(d.meeting_id)) then
    raise exception 'Não tens permissão para esta ação neste módulo.' using errcode = '42501';
  end if;
  if d.status <> 'em_aprovacao' then raise exception 'Só uma ata em aprovação pode voltar a rascunho.'; end if;
  if length(coalesce(p_reason, '')) > 1000 then raise exception 'O motivo é demasiado longo.'; end if;
  select * into v from public.sec_minute_versions where minute_id = d.id and version_no = d.current_version;
  insert into public.sec_minute_versions (minute_id, section_id, space, version_no, body, note, created_by, updated_by)
  values (d.id, p_section, v_space, d.current_version + 1, v.body,
          'Voltou a rascunho' || coalesce(': ' || nullif(trim(coalesce(p_reason, '')), ''), '.'), auth.uid(), auth.uid());
  update public.sec_minutes set status = 'rascunho', current_version = d.current_version + 1, updated_by = auth.uid(), updated_at = now()
   where id = d.id;
  perform private.audit(p_section, 'sec_ata_devolvida', 'sec_minute', d.id::text, jsonb_build_object('versao', d.current_version, 'motivo', p_reason));
  perform private.module_notify(p_section, 'secretaria', v_space,
    array(select distinct x from unnest(array[d.created_by, v.submitted_by]) x), 'sec_devolvida',
    'Ata em rascunho', 'Uma ata voltou a rascunho.', '/secretaria/atas/' || d.id);
end
$$;

create or replace function public.sec_minute_approve(p_section uuid, p_minute uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes; v public.sec_minute_versions;
begin
  d := private.sec_minute_get(p_section, v_space, p_minute, true);
  if not private.sec_can_approve(d.meeting_id) then
    raise exception 'Não tens permissão para aprovar esta ata.' using errcode = '42501';
  end if;
  if exists (select 1 from public.sec_meetings where id = d.meeting_id and status = 'anulada') then raise exception 'Esta reunião foi anulada.'; end if;
  if d.status <> 'em_aprovacao' then raise exception 'Só uma ata em aprovação pode ser aprovada.'; end if;
  if p_expected_version is distinct from d.current_version then raise exception 'A ata mudou entretanto. Atualiza a página.'; end if;
  select * into v from public.sec_minute_versions where minute_id = d.id and version_no = d.current_version;
  update public.sec_minute_versions set approved_at = now(), approved_by = auth.uid() where id = v.id;
  update public.sec_minutes set status = 'aprovada', approved_version = d.current_version, updated_by = auth.uid(), updated_at = now()
   where id = d.id;
  perform private.audit(p_section, 'sec_ata_aprovada', 'sec_minute', d.id::text, jsonb_build_object('versao', d.current_version));
  perform private.module_notify(p_section, 'secretaria', v_space,
    array(select distinct x from unnest(array[d.created_by, v.submitted_by]) x), 'sec_aprovada',
    'Ata aprovada', 'Uma ata foi aprovada.', '/secretaria/atas/' || d.id);
end
$$;

-- Correção de uma ata aprovada: nova versão em rascunho; a aprovada continua consultável
-- (approved_version mantém-se até a nova versão ser aprovada).
create or replace function public.sec_minute_revise(p_section uuid, p_minute uuid, p_reason text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes; v public.sec_minute_versions;
begin
  d := private.sec_minute_get(p_section, v_space, p_minute, true);
  perform private.sec_require_draft(d.meeting_id);
  if d.kind <> 'ata' then raise exception 'Corrige o aditamento criando outro aditamento.'; end if;
  if d.status <> 'aprovada' then raise exception 'Só uma ata aprovada pode ter uma nova versão de correção.'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Indica o motivo da correção.'; end if;
  if length(p_reason) > 1000 then raise exception 'O motivo é demasiado longo.'; end if;
  select * into v from public.sec_minute_versions where minute_id = d.id and version_no = d.current_version;
  insert into public.sec_minute_versions (minute_id, section_id, space, version_no, body, note, created_by, updated_by)
  values (d.id, p_section, v_space, d.current_version + 1, v.body, 'Correção: ' || trim(p_reason), auth.uid(), auth.uid());
  update public.sec_minutes set status = 'rascunho', current_version = d.current_version + 1, updated_by = auth.uid(), updated_at = now()
   where id = d.id;
  perform private.audit(p_section, 'sec_ata_correcao', 'sec_minute', d.id::text,
    jsonb_build_object('versao_aprovada', d.approved_version, 'nova_versao', d.current_version + 1, 'motivo', trim(p_reason)));
  return d.current_version + 1;
end
$$;

-- ---------------------------------------------------------------------------
-- Decisões e tarefas
-- ---------------------------------------------------------------------------
create or replace function public.sec_item_save(
  p_section uuid, p_item uuid, p_minute uuid, p_kind text, p_text text, p_responsible uuid, p_due date,
  p_reminder_days integer default 2, p_request uuid default null, p_stage_path uuid default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes; i public.sec_items; v_id uuid;
        v_old_resp uuid;
begin
  if p_item is not null then
    select * into i from public.sec_items where id = p_item and section_id = p_section and space = v_space for update;
    if i.id is null then raise exception 'Registo não encontrado.'; end if;
    d := private.sec_minute_get(p_section, v_space, i.minute_id, true);
    v_old_resp := i.responsible_id;
  else
    d := private.sec_minute_get(p_section, v_space, p_minute, true);
  end if;
  perform private.sec_require_draft(d.meeting_id);
  if exists (select 1 from public.sec_meetings where id = d.meeting_id and status = 'anulada') then raise exception 'Esta reunião foi anulada.'; end if;
  if d.status <> 'rascunho' then
    raise exception 'As decisões só se alteram com a ata em rascunho. Numa ata aprovada, cria uma nova versão ou um aditamento.';
  end if;
  if p_kind not in ('decisao', 'tarefa') then raise exception 'Escolhe se é decisão ou tarefa.'; end if;
  if nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'Escreve a decisão ou a tarefa.'; end if;
  if length(trim(p_text)) > 2000 then raise exception 'O texto é demasiado longo (máximo 2000 caracteres).'; end if;
  if p_kind = 'tarefa' and p_responsible is null then raise exception 'Escolhe o responsável da tarefa.'; end if;
  if p_kind = 'tarefa' and p_due is null then raise exception 'Indica o prazo da tarefa.'; end if;
  if coalesce(p_reminder_days, 2) not between 0 and 60 then raise exception 'O lembrete tem de ser entre 0 e 60 dias antes do prazo.'; end if;
  if p_responsible is not null and not exists (select 1 from public.memberships where profile_id = p_responsible and section_id = p_section and status = 'ativo') then
    raise exception 'O responsável tem de ser um membro ativo da secção.';
  end if;
  if p_request is not null and p_stage_path is not null then raise exception 'Liga a decisão a um pedido ou a uma etapa, não aos dois.'; end if;
  if p_request is not null and not exists (select 1 from public.trail_requests where id = p_request and section_id = p_section) then
    raise exception 'Pedido não encontrado.';
  end if;
  if p_stage_path is not null and not exists (select 1 from public.stage_paths sp join public.memberships ms on ms.id = sp.membership_id
                                                where sp.id = p_stage_path and ms.section_id = p_section) then
    raise exception 'Etapa não encontrada.';
  end if;

  if p_item is null then
    insert into public.sec_items (section_id, space, meeting_id, minute_id, kind, text, responsible_id, due_date, reminder_days,
                                  trail_request_id, stage_path_id, created_by, updated_by)
    values (p_section, v_space, d.meeting_id, d.id, p_kind, trim(p_text), p_responsible, p_due, coalesce(p_reminder_days, 2),
            p_request, p_stage_path, auth.uid(), auth.uid())
    returning * into i;
  else
    update public.sec_items set kind = p_kind, text = trim(p_text), responsible_id = p_responsible, due_date = p_due,
           reminder_days = coalesce(p_reminder_days, 2), trail_request_id = p_request, stage_path_id = p_stage_path,
           updated_by = auth.uid(), updated_at = now()
     where id = p_item returning * into i;
  end if;
  v_id := i.id;
  perform private.sec_schedule_item(i);
  -- Notifica o responsável quando passa a sê-lo (texto genérico).
  if p_responsible is not null and p_responsible is distinct from v_old_resp then
    perform private.module_notify(p_section, 'secretaria', v_space, array[p_responsible], 'sec_tarefa',
      case when p_kind = 'tarefa' then 'Nova tarefa' else 'Nova decisão' end,
      'Tens um novo registo atribuído na Secretaria.', '/secretaria/tarefas');
  end if;
  perform private.audit(p_section, case when p_item is null then 'sec_item_criado' else 'sec_item_alterado' end, 'sec_item', v_id::text,
    jsonb_build_object('kind', p_kind, 'responsible', p_responsible, 'due', p_due));
  return v_id;
end
$$;

create or replace function public.sec_item_set_status(p_section uuid, p_item uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); i public.sec_items;
begin
  select * into i from public.sec_items where id = p_item and section_id = p_section and space = v_space for update;
  if i.id is null then raise exception 'Registo não encontrado.'; end if;
  if not (i.responsible_id = auth.uid() or private.sec_can_draft(i.meeting_id) or private.sec_can_approve(i.meeting_id)) then
    if not private.sec_can_see(i.meeting_id) then raise exception 'Registo não encontrado.'; end if;
    raise exception 'Não tens permissão para mudar o estado desta tarefa.' using errcode = '42501';
  end if;
  if exists (select 1 from public.sec_meetings where id = i.meeting_id and status = 'anulada') then raise exception 'Esta reunião foi anulada.'; end if;
  if p_status not in ('por_fazer', 'em_curso', 'feita', 'cancelada') then raise exception 'Estado inválido.'; end if;
  if length(coalesce(p_note, '')) > 1000 then raise exception 'A nota é demasiado longa.'; end if;
  update public.sec_items set exec_status = p_status, status_note = nullif(trim(coalesce(p_note, '')), ''),
         status_changed_by = auth.uid(), status_changed_at = now()
   where id = i.id returning * into i;
  perform private.sec_schedule_item(i);
  perform private.audit(p_section, 'sec_item_estado', 'sec_item', i.id::text, jsonb_build_object('estado', p_status));
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- O envio de lembretes continua reservado ao agendador (a linha anterior voltaria a abri-lo).
revoke execute on function public.process_due_reminders() from authenticated;


-- ===== 20261021000900_modulos_integracao.sql =====
-- Pioneiros — ligações entre módulos.
-- Na página de uma atividade do Calendário mostram-se as reservas de material, o resumo
-- financeiro e as reuniões ligadas a ela, cada parte só quando a pessoa tem acesso ao
-- módulo correspondente NO MESMO ESPAÇO (teste com teste, real com real). Nada é copiado:
-- cada registo continua a existir uma única vez no seu módulo.
-- Aditivo: não altera nem apaga registos existentes.

create or replace function public.cal_event_links(p_section uuid, p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'calendario');
  v_out jsonb := '{}'::jsonb;
  v_fin jsonb;
begin
  if not exists (select 1 from public.cal_events where id = p_event and section_id = p_section and space = v_space) then
    raise exception 'Registo não encontrado.';
  end if;

  if private.module_space(p_section, 'inventario') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('reservas', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'item_id', i.id, 'item', i.name, 'unit', i.unit,
                                          'quantity', r.quantity, 'status', r.status) order by i.name)
        from public.inv_reservations r join public.inv_items i on i.id = r.item_id
       where r.section_id = p_section and r.space = v_space and r.event_id = p_event and r.status <> 'cancelada'), '[]'::jsonb));
  end if;

  if private.module_space(p_section, 'tesouraria') is not distinct from v_space then
    -- Só os totais partilhados (os mesmos que o resumo da Tesouraria mostra a todos).
    v_fin := public.fin_activity_results(p_section, p_event) -> 0;
    v_out := v_out || jsonb_build_object('financas', case when v_fin is null then null else
      jsonb_build_object('orcamento', v_fin -> 'orcamento', 'efetivo', v_fin -> 'efetivo', 'por_confirmar', v_fin -> 'por_confirmar') end);
  end if;

  if private.module_space(p_section, 'secretaria') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('reunioes', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'kind', m.kind, 'starts_at', m.starts_at) order by m.starts_at)
        from public.sec_meetings m
       where m.section_id = p_section and m.space = v_space and m.cal_event_id = p_event and m.status = 'ativa'
         and private.sec_can_see(m.id)), '[]'::jsonb));
  end if;

  return v_out;
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- O envio de lembretes é só para o serviço agendado.
revoke execute on function public.process_due_reminders() from authenticated;


-- ===== 20261022000100_modulos_v2_base.sql =====
-- Pioneiros — módulos, segunda versão: novo módulo «Presenças» (prefixo pres_) e novas
-- permissões. O módulo «secretaria» passa a chamar-se «Reuniões e tarefas» na interface
-- (a chave interna mantém-se, para preservar os dados).
-- Aditivo: não altera dados, estados, testers nem permissões existentes.

alter table public.module_settings drop constraint if exists module_settings_module_check;
alter table public.module_settings add constraint module_settings_module_check
  check (module in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria', 'presencas'));
alter table public.module_testers drop constraint if exists module_testers_module_check;
alter table public.module_testers add constraint module_testers_module_check
  check (module in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria', 'presencas'));
alter table public.module_grants drop constraint if exists module_grants_permission_check;
alter table public.module_grants add constraint module_grants_permission_check check (permission in (
  'calendario.gerir', 'inventario.gerir', 'tesouraria.gerir', 'equipas.gerir',
  'secretaria.redigir', 'secretaria.aprovar', 'presencas.registar'));

create or replace function private.module_prefix(p_module text)
returns text language sql immutable set search_path = ''
as $$
  select case p_module when 'calendario' then 'cal_' when 'inventario' then 'inv_' when 'tesouraria' then 'fin_'
                       when 'equipas' then 'eq_' when 'secretaria' then 'sec_' when 'presencas' then 'pres_' end
$$;

create or replace function public.my_modules(p_section uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'module', k,
    'status', private.module_status(p_section, k),
    'space', private.module_space(p_section, k),
    'grants', coalesce((select jsonb_agg(g.permission) from public.module_grants g
                         where g.section_id = p_section and g.profile_id = auth.uid() and g.permission like k || '.%'), '[]'::jsonb),
    'dirigente', private.is_dirigente(p_section)
  ) order by k), '[]'::jsonb)
  from unnest(array['calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria', 'presencas']) k
  where private.is_active_member(p_section)
$$;

create or replace function public.module_admin_overview(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  return (
    select jsonb_agg(jsonb_build_object(
      'module', k,
      'status', private.module_status(p_section, k),
      'testers', coalesce((select jsonb_agg(t.profile_id order by t.added_at) from public.module_testers t
                            where t.section_id = p_section and t.module = k), '[]'::jsonb),
      'grants', coalesce((select jsonb_agg(jsonb_build_object('permission', g.permission, 'profile_id', g.profile_id) order by g.granted_at)
                           from public.module_grants g where g.section_id = p_section and g.permission like k || '.%'), '[]'::jsonb)
    ) order by k)
    from unnest(array['calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria', 'presencas']) k
  );
end
$$;

create or replace function public.set_module_status(p_section uuid, p_module text, p_status text, p_move_test_data boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_old text; v_t text; v_c text;
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  if p_status not in ('desenvolvimento', 'teste', 'disponivel') then raise exception 'Estado inválido.'; end if;
  if p_module not in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria', 'presencas') then raise exception 'Módulo inválido.'; end if;
  v_old := private.module_status(p_section, p_module);
  insert into public.module_settings (section_id, module, status, updated_by, updated_at)
  values (p_section, p_module, p_status, auth.uid(), now())
  on conflict (section_id, module) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = now();
  -- Passar os dados de teste para reais só por escolha explícita, ao publicar.
  if coalesce(p_move_test_data, false) then
    if p_status <> 'disponivel' then raise exception 'Os dados de teste só passam a reais ao publicar.'; end if;
    -- Um módulo pode definir private.<módulo>_publish_move(secção) quando a passagem
    -- precisa de regras próprias (ou não é permitida); senão, passam todas as tabelas.
    if to_regprocedure('private.' || p_module || '_publish_move(uuid)') is not null then
      execute format('select private.%I($1)', p_module || '_publish_move') using p_section;
    else
      foreach v_t in array private.module_tables(p_module) loop
        execute format('update public.%I set space = ''real'' where section_id = $1 and space = ''teste''', v_t) using p_section;
      end loop;
    end if;
    update public.module_files set space = 'real' where section_id = p_section and module = p_module and space = 'teste';
    -- Lembretes ainda por enviar passam com os dados (senão nunca seriam enviados).
    update public.module_reminders set space = 'real'
     where section_id = p_section and module = p_module and space = 'teste' and sent_at is null;
    -- Registos agora reais não ficam ligados a atividades do Calendário que continuam
    -- de teste: a ligação opcional é retirada (o registo mantém-se).
    if to_regclass('public.cal_events') is not null and p_module <> 'calendario' then
      for v_t, v_c in
        select c.conrelid::regclass::text, a.attname::text
          from pg_constraint c
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f' and c.confrelid = 'public.cal_events'::regclass and not a.attnotnull
           and c.conrelid::regclass::text like 'public.' || private.module_prefix(p_module) || '%'
            or c.contype = 'f' and c.confrelid = 'public.cal_events'::regclass and not a.attnotnull
           and c.conrelid::regclass::text like private.module_prefix(p_module) || '%'
      loop
        execute format('update %s t set %I = null where t.section_id = $1 and t.space = ''real'' and t.%I is not null
                          and not exists (select 1 from public.cal_events e where e.id = t.%I and e.space = ''real'')', v_t, v_c, v_c, v_c)
          using p_section;
      end loop;
    end if;
  end if;
  perform private.audit(p_section, 'modulo_estado', 'module', p_module,
    jsonb_build_object('de', v_old, 'para', p_status, 'dados_teste_para_reais', coalesce(p_move_test_data, false)));
end
$$;

create or replace function public.set_module_tester(p_section uuid, p_module text, p_profile uuid, p_on boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  if p_module not in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria', 'presencas') then raise exception 'Módulo inválido.'; end if;
  if p_on then
    if not exists (select 1 from public.memberships where section_id = p_section and profile_id = p_profile and status = 'ativo') then
      raise exception 'Só membros ativos da secção podem testar módulos.';
    end if;
    insert into public.module_testers (section_id, module, profile_id, added_by) values (p_section, p_module, p_profile, auth.uid())
    on conflict do nothing;
  else
    delete from public.module_testers where section_id = p_section and module = p_module and profile_id = p_profile;
  end if;
  perform private.audit(p_section, case when p_on then 'tester_adicionado' else 'tester_removido' end, 'module', p_module,
    jsonb_build_object('profile', p_profile));
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;


-- ===== 20261022000200_calendario_v2.sql =====
-- Pioneiros — Calendário escutista v2: calendário anual.
-- Acrescenta (sem alterar dados existentes):
--  * cal_special_days: feriado municipal e outros dias relevantes da secção, por espaço
--    (teste/real), num dia único ou recorrentes todos os anos. Nunca se apagam: retirar um
--    dia marca-o como anulado (quem e quando).
--  * cal_settings: configuração por secção e espaço (mês inicial do ano escutista; por
--    omissão setembro).
-- Os feriados nacionais (fixos e móveis) são calculados no cliente e não se guardam.
-- As atividades (cal_events) e as restantes funções da v1 mantêm-se.

create table if not exists public.cal_special_days (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  day date not null,
  name text not null check (length(trim(name)) between 1 and 120),
  kind text not null check (kind in ('municipal', 'relevante')),
  recurring boolean not null default false,
  status text not null default 'ativo' check (status in ('ativo', 'anulado')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  cancelled_by uuid,
  cancelled_at timestamptz
);
create index if not exists cal_special_days_section on public.cal_special_days (section_id, space);
alter table public.cal_special_days enable row level security;

create table if not exists public.cal_settings (
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  year_start_month integer not null default 9 check (year_start_month between 1 and 12),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (section_id, space)
);
alter table public.cal_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Consulta: configuração e dias especiais (todos os que têm acesso ao módulo)
-- ---------------------------------------------------------------------------
create or replace function public.cal_config(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'calendario');
begin
  return jsonb_build_object(
    'year_start_month', coalesce((select s.year_start_month from public.cal_settings s
                                   where s.section_id = p_section and s.space = v_space), 9),
    'can_manage', private.cal_can_manage(p_section),
    'special_days', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'day', d.day, 'name', d.name, 'kind', d.kind, 'recurring', d.recurring)
                       order by d.recurring desc, to_char(d.day, 'MM-DD'), d.day, d.name)
        from public.cal_special_days d
       where d.section_id = p_section and d.space = v_space and d.status = 'ativo'), '[]'::jsonb));
end
$$;

-- ---------------------------------------------------------------------------
-- Gestão (dirigentes ou «calendario.gerir»)
-- ---------------------------------------------------------------------------
create or replace function public.cal_set_year_start(p_section uuid, p_month integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
        v_old integer;
begin
  if p_month is null or p_month < 1 or p_month > 12 then raise exception 'Mês inválido (1 a 12).'; end if;
  select year_start_month into v_old from public.cal_settings where section_id = p_section and space = v_space for update;
  insert into public.cal_settings (section_id, space, year_start_month, updated_by, updated_at)
  values (p_section, v_space, p_month, auth.uid(), now())
  on conflict (section_id, space) do update set year_start_month = excluded.year_start_month,
    updated_by = excluded.updated_by, updated_at = now();
  perform private.audit(p_section, 'cal_ano_escutista', 'cal_settings', p_section::text,
    jsonb_build_object('space', v_space, 'de', coalesce(v_old, 9), 'para', p_month));
end
$$;

-- Cria (p_id vazio) ou corrige um dia especial. p_data: day (AAAA-MM-DD), name, kind
-- ('municipal' | 'relevante'), recurring (todos os anos).
create or replace function public.cal_special_day_save(p_section uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
        v_day date; v_name text; v_kind text; v_rec boolean; o public.cal_special_days; v_id uuid;
begin
  v_name := nullif(trim(coalesce(p_data ->> 'name', '')), '');
  if v_name is null then raise exception 'Indica o nome do dia.'; end if;
  if length(v_name) > 120 then raise exception 'O nome é demasiado longo (máximo 120 caracteres).'; end if;
  begin
    v_day := (p_data ->> 'day')::date;
  exception when others then
    raise exception 'Data inválida. Usa o formato DD/MM/AAAA.';
  end;
  if v_day is null then raise exception 'Indica a data.'; end if;
  v_kind := coalesce(nullif(p_data ->> 'kind', ''), 'relevante');
  if v_kind not in ('municipal', 'relevante') then raise exception 'Tipo de dia inválido.'; end if;
  v_rec := coalesce((p_data ->> 'recurring')::boolean, false);

  if p_id is null then
    insert into public.cal_special_days (section_id, space, day, name, kind, recurring, created_by, updated_by)
    values (p_section, v_space, v_day, v_name, v_kind, v_rec, auth.uid(), auth.uid())
    returning id into v_id;
    perform private.audit(p_section, 'cal_dia_especial_criado', 'cal_special_day', v_id::text,
      jsonb_build_object('space', v_space, 'day', v_day, 'name', v_name, 'kind', v_kind, 'recurring', v_rec));
    return v_id;
  end if;

  select * into o from public.cal_special_days where id = p_id and section_id = p_section and space = v_space for update;
  if o.id is null then raise exception 'Registo não encontrado.'; end if;
  if o.status <> 'ativo' then raise exception 'Este dia foi retirado e já não pode ser alterado.'; end if;
  update public.cal_special_days set day = v_day, name = v_name, kind = v_kind, recurring = v_rec,
         updated_by = auth.uid(), updated_at = now()
   where id = o.id;
  perform private.audit(p_section, 'cal_dia_especial_alterado', 'cal_special_day', o.id::text,
    jsonb_build_object('antes', jsonb_build_object('day', o.day, 'name', o.name, 'kind', o.kind, 'recurring', o.recurring),
                       'depois', jsonb_build_object('day', v_day, 'name', v_name, 'kind', v_kind, 'recurring', v_rec)));
  return o.id;
end
$$;

-- Retirar um dia especial: fica anulado (não se apaga).
create or replace function public.cal_special_day_remove(p_section uuid, p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
        o public.cal_special_days;
begin
  select * into o from public.cal_special_days where id = p_id and section_id = p_section and space = v_space for update;
  if o.id is null then raise exception 'Registo não encontrado.'; end if;
  if o.status <> 'ativo' then raise exception 'Este dia já foi retirado.'; end if;
  update public.cal_special_days set status = 'anulado', cancelled_by = auth.uid(), cancelled_at = now(),
         updated_by = auth.uid(), updated_at = now()
   where id = o.id;
  perform private.audit(p_section, 'cal_dia_especial_retirado', 'cal_special_day', o.id::text,
    jsonb_build_object('day', o.day, 'name', o.name));
end
$$;

-- ---------------------------------------------------------------------------
-- Publicar com «passar dados de teste a reais»: tal como na v1 (atividades, respostas e
-- lembretes por enviar), mais os dias especiais. A configuração de teste só passa a real
-- se o espaço real ainda não tiver configuração própria (a real nunca é substituída).
-- ---------------------------------------------------------------------------
create or replace function private.calendario_publish_move(p_section uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_t text;
begin
  foreach v_t in array private.module_tables('calendario') loop
    continue when v_t = 'cal_settings';
    execute format('update public.%I set space = ''real'' where section_id = $1 and space = ''teste''', v_t) using p_section;
  end loop;
  update public.cal_settings t set space = 'real'
   where t.section_id = p_section and t.space = 'teste'
     and not exists (select 1 from public.cal_settings r where r.section_id = p_section and r.space = 'real');
  update public.module_reminders set space = 'real'
   where section_id = p_section and module = 'calendario' and space = 'teste' and sent_at is null;
end
$$;

revoke all on function private.calendario_publish_move(uuid) from public, anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;


-- ===== 20261022000300_inventario_v2.sql =====
-- Pioneiros — Inventário, segunda versão.
--
-- • Artigos: local exato estruturado (sala, armário, prateleira, caixa), estado de
--   conservação (novo, bom, razoável, mau) separado da disponibilidade, e observações.
--   O texto de localização da v1 passa para «sala» (nada se perde) e a coluna location
--   mantém-se, agora como resumo do local exato (usada em filtros e pesquisa).
-- • Categorias habituais (Campismo, Cozinha, Ferramentas, Jogos, Construções) criadas a
--   pedido de quem gere, sem duplicar as que já existam (nada é inserido nesta migração).
-- • Empréstimos: mostra quem registou a saída e cada devolução (total ou parcial) com o
--   estado à chegada.
-- • Lista «A comprar» (inv_purchases): material existente ou novo, quantidade, motivo,
--   prioridade, estado (por comprar, comprado, cancelado), ligação opcional a uma
--   atividade do calendário. Ao comprar: acrescentar ao inventário (uma só vez) e associar
--   a despesa da Tesouraria — uma despesa existente ou uma nova criada por
--   public.fin_create_movement. A despesa existe uma única vez em fin_movements e
--   fin_movement_id é único: nunca é contada duas vezes.
-- • Resumo: emprestado, devoluções em atraso, em reparação e compras pendentes.
-- Aditivo: não altera nem apaga dados existentes (além de copiar a localização da v1 para
-- «sala»), nem permissões, nem testers.

-- ---------------------------------------------------------------------------
-- Artigos: local exato, conservação e observações
-- ---------------------------------------------------------------------------
alter table public.inv_items
  add column if not exists room text,
  add column if not exists cabinet text,
  add column if not exists shelf text,
  add column if not exists box text,
  add column if not exists condition text,
  add column if not exists notes text;

alter table public.inv_items drop constraint if exists inv_items_room_check;
alter table public.inv_items add constraint inv_items_room_check check (room is null or length(room) <= 120);
alter table public.inv_items drop constraint if exists inv_items_cabinet_check;
alter table public.inv_items add constraint inv_items_cabinet_check check (cabinet is null or length(cabinet) <= 80);
alter table public.inv_items drop constraint if exists inv_items_shelf_check;
alter table public.inv_items add constraint inv_items_shelf_check check (shelf is null or length(shelf) <= 80);
alter table public.inv_items drop constraint if exists inv_items_box_check;
alter table public.inv_items add constraint inv_items_box_check check (box is null or length(box) <= 80);
alter table public.inv_items drop constraint if exists inv_items_condition_check;
alter table public.inv_items add constraint inv_items_condition_check check (condition is null or condition in ('novo', 'bom', 'razoavel', 'mau'));
alter table public.inv_items drop constraint if exists inv_items_notes_check;
alter table public.inv_items add constraint inv_items_notes_check check (notes is null or length(notes) <= 2000);
-- A localização passa a ser o resumo do local exato (pode ser mais longa).
alter table public.inv_items drop constraint if exists inv_items_location_check;
alter table public.inv_items add constraint inv_items_location_check check (location is null or length(location) <= 400);

-- O texto livre da v1 passa a «sala» (só onde ainda não há local estruturado).
update public.inv_items set room = left(trim(location), 120)
 where location is not null and length(trim(location)) > 0
   and room is null and cabinet is null and shelf is null and box is null;

-- ---------------------------------------------------------------------------
-- Lista «A comprar»
-- ---------------------------------------------------------------------------
create table if not exists public.inv_purchases (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  -- Material existente (item_id) ou material novo (name).
  item_id uuid references public.inv_items (id),
  name text check (name is null or length(trim(name)) between 1 and 120),
  category_id uuid references public.inv_categories (id),
  quantity integer not null check (quantity between 1 and 1000000),
  unit text not null default 'un.' check (length(trim(unit)) between 1 and 20),
  reason text check (reason is null or length(reason) <= 500),
  priority text not null default 'media' check (priority in ('baixa', 'media', 'alta')),
  status text not null default 'por_comprar' check (status in ('por_comprar', 'comprado', 'cancelado')),
  needed_by date,
  event_id uuid references public.cal_events (id),
  -- Valor previsto ou pago (cêntimos), só informativo: o valor contabilizado é o da despesa.
  amount_cents bigint check (amount_cents is null or amount_cents between 1 and 100000000000),
  bought_qty integer check (bought_qty is null or bought_qty between 1 and 1000000),
  bought_on date,
  bought_by uuid,
  bought_at timestamptz,
  stock_added_at timestamptz,
  stock_added_by uuid,
  stock_item_id uuid references public.inv_items (id),
  -- Uma despesa só pode estar ligada a uma compra (nunca é contada duas vezes).
  fin_movement_id uuid unique references public.fin_movements (id),
  fin_linked_at timestamptz,
  fin_linked_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (item_id is not null or name is not null),
  check (status <> 'comprado' or bought_at is not null)
);
create index if not exists inv_purchases_section on public.inv_purchases (section_id, space, status);
create index if not exists inv_purchases_item on public.inv_purchases (item_id) where item_id is not null;
alter table public.inv_purchases enable row level security;

-- Movimentos de histórico originados por uma compra.
alter table public.inv_movements add column if not exists purchase_id uuid references public.inv_purchases (id);

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
create or replace function private.inv_clean(p text) returns text
language sql immutable set search_path = ''
as $$ select nullif(trim(coalesce(p, '')), '') $$;

-- Resumo do local exato: «Sede · Armário 2 · Prateleira de cima · Caixa azul».
create or replace function private.inv_loc(p_room text, p_cabinet text, p_shelf text, p_box text) returns text
language sql immutable set search_path = ''
as $$
  select nullif(concat_ws(' · ', private.inv_clean(p_room), private.inv_clean(p_cabinet), private.inv_clean(p_shelf), private.inv_clean(p_box)), '')
$$;

create or replace function private.inv_condition_label(p text) returns text
language sql immutable set search_path = ''
as $$ select case p when 'novo' then 'novo' when 'bom' then 'bom' when 'razoavel' then 'razoável' when 'mau' then 'mau' else '—' end $$;

-- A Tesouraria tem de estar no mesmo espaço (teste/real) e a pessoa tem de a gerir.
create or replace function private.inv_fin_ok(p_section uuid, p_space text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.module_space(p_section, 'tesouraria') is not distinct from p_space and p_space is not null
     and private.has_grant(p_section, 'tesouraria.gerir')
$$;

create or replace function private.inv_fin_require(p_section uuid, p_space text) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.module_space(p_section, 'tesouraria') is distinct from p_space then
    raise exception 'A Tesouraria não está disponível para ti no mesmo ambiente do Inventário (%). A despesa não pode ser associada.',
      case p_space when 'teste' then 'ambiente de teste' else 'dados reais' end using errcode = '42501';
  end if;
  if not private.has_grant(p_section, 'tesouraria.gerir') then
    raise exception 'Associar despesas exige a permissão de tesoureiro autorizado (tesouraria.gerir).' using errcode = '42501';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Consulta (artigos, empréstimos, resumo)
-- ---------------------------------------------------------------------------
create or replace function private.inv_item_json(i public.inv_items) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'name', i.name, 'description', i.description, 'unit', i.unit, 'location', i.location,
    'room', i.room, 'cabinet', i.cabinet, 'shelf', i.shelf, 'box', i.box, 'condition', i.condition, 'notes', i.notes,
    'tracking', i.tracking, 'category_id', i.category_id,
    'category', (select c.name from public.inv_categories c where c.id = i.category_id),
    'min_quantity', i.min_quantity, 'archived_at', i.archived_at, 'updated_at', i.updated_at,
    'has_photo', exists (select 1 from public.module_files f where f.module = 'inventario' and f.entity = 'item'
                          and f.entity_id = i.id and f.removed_at is null),
    'stock', private.inv_stock(i.id))
$$;

create or replace function private.inv_loan_json(l public.inv_loans) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id, 'item_id', l.item_id, 'item', i.name, 'unit', i.unit, 'tracking', i.tracking,
    'borrower_id', l.borrower_id, 'borrower', private.inv_name(l.borrower_id),
    'quantity', l.quantity, 'returned_qty', l.returned_qty, 'out_at', l.out_at, 'due_at', l.due_at, 'status', l.status,
    'overdue', l.status = 'ativo' and l.returned_qty < l.quantity and l.due_at < now(),
    'notes', l.notes, 'remind_hours', l.remind_hours, 'reservation_id', l.reservation_id,
    'requested_by', private.inv_name(l.requested_by), 'requested_at', l.requested_at,
    'decided_by', case when l.decided_by is not null then private.inv_name(l.decided_by) end, 'decided_at', l.decided_at,
    -- Quem registou a saída do material (o empréstimo direto ou a aprovação do pedido).
    'registered_by', case when l.status in ('ativo', 'devolvido') and l.decided_by is not null then private.inv_name(l.decided_by) end,
    'decision_note', l.decision_note, 'returned_at', l.returned_at,
    'pieces', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'serial', p.serial,
                 'returned_at', lp.returned_at, 'returned_status', lp.returned_status) order by p.code)
               from public.inv_loan_pieces lp join public.inv_pieces p on p.id = lp.piece_id where lp.loan_id = l.id), '[]'::jsonb),
    -- Devoluções (totais ou parciais) e estado do material à chegada.
    'returns', coalesce((select jsonb_agg(jsonb_build_object('at', m.at, 'quantity', m.quantity, 'condition', m.to_state, 'note', m.note,
                 'by', case when m.actor is not null then private.inv_name(m.actor) end) order by m.id)
               from public.inv_movements m where m.loan_id = l.id and m.kind = 'devolucao'), '[]'::jsonb))
  from public.inv_items i where i.id = l.item_id
$$;

create or replace function private.inv_summary(p_section uuid, p_space text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'lent_units', (select coalesce(sum(l.quantity - l.returned_qty), 0) from public.inv_loans l
                    where l.section_id = p_section and l.space = p_space and l.status = 'ativo' and l.out_at <= now()),
    'lent_loans', (select count(*) from public.inv_loans l
                    where l.section_id = p_section and l.space = p_space and l.status = 'ativo' and l.returned_qty < l.quantity and l.out_at <= now()),
    'overdue', (select count(*) from public.inv_loans l where l.section_id = p_section and l.space = p_space and l.status = 'ativo'
                  and l.returned_qty < l.quantity and l.due_at < now()),
    'repair_units', (select coalesce(sum(c.repair), 0) from public.inv_items i cross join lateral private.inv_counts(i.id) c
                      where i.section_id = p_section and i.space = p_space and i.archived_at is null),
    'repair_items', (select count(*) from public.inv_items i cross join lateral private.inv_counts(i.id) c
                      where i.section_id = p_section and i.space = p_space and i.archived_at is null and c.repair > 0),
    'purchases_pending', (select count(*) from public.inv_purchases p where p.section_id = p_section and p.space = p_space and p.status = 'por_comprar'),
    'purchases_high', (select count(*) from public.inv_purchases p where p.section_id = p_section and p.space = p_space and p.status = 'por_comprar'
                        and p.priority = 'alta'))
$$;

create or replace function public.inv_overview(p_section uuid, p_archived boolean default false)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'inventario');
begin
  return jsonb_build_object(
    'can_manage', private.inv_can_manage(p_section),
    'fin_ok', private.inv_fin_ok(p_section, v_space),
    'me', auth.uid(),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'archived', c.archived_at is not null,
                       'items', (select count(*) from public.inv_items i where i.category_id = c.id and i.archived_at is null))
                     order by lower(c.name)) from public.inv_categories c where c.section_id = p_section and c.space = v_space), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(distinct i.location order by i.location) from public.inv_items i
                     where i.section_id = p_section and i.space = v_space and i.location is not null and i.archived_at is null), '[]'::jsonb),
    'rooms', coalesce((select jsonb_agg(distinct i.room order by i.room) from public.inv_items i
                     where i.section_id = p_section and i.space = v_space and i.room is not null and i.archived_at is null), '[]'::jsonb),
    'cabinets', coalesce((select jsonb_agg(x order by x ->> 'room', x ->> 'cabinet') from (
                     select distinct jsonb_build_object('room', i.room, 'cabinet', i.cabinet) x from public.inv_items i
                      where i.section_id = p_section and i.space = v_space and i.cabinet is not null and i.archived_at is null) y), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(private.inv_item_json(i) order by lower(i.name)) from public.inv_items i
                where i.section_id = p_section and i.space = v_space
                  and (case when coalesce(p_archived, false) then i.archived_at is not null else i.archived_at is null end)), '[]'::jsonb),
    'pending_requests', (select count(*) from public.inv_loans l where l.section_id = p_section and l.space = v_space and l.status = 'pedido'),
    'overdue', (select count(*) from public.inv_loans l where l.section_id = p_section and l.space = v_space and l.status = 'ativo'
                  and l.returned_qty < l.quantity and l.due_at < now()),
    'summary', private.inv_summary(p_section, v_space));
end
$$;

-- ---------------------------------------------------------------------------
-- Categorias habituais (a pedido; nunca duplica, nem reativa as arquivadas)
-- ---------------------------------------------------------------------------
create or replace function public.inv_category_defaults(p_section uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true); v_n integer;
begin
  insert into public.inv_categories (section_id, space, name, created_by)
  select p_section, v_space, n, auth.uid()
    from unnest(array['Campismo', 'Cozinha', 'Ferramentas', 'Jogos', 'Construções']) n
   where not exists (select 1 from public.inv_categories c where c.section_id = p_section and c.space = v_space
                       and lower(trim(c.name)) = lower(n))
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- ---------------------------------------------------------------------------
-- Artigo: criar ou editar (nova assinatura com local exato, conservação e observações).
-- p_location (v1) continua aceite: sem local estruturado, passa a «sala».
-- ---------------------------------------------------------------------------
drop function if exists public.inv_item_save(uuid, uuid, uuid, text, text, text, text, text, integer, integer, jsonb);

create or replace function public.inv_item_save(
  p_section uuid, p_id uuid, p_category uuid, p_name text, p_description text, p_unit text, p_location text default null,
  p_tracking text default 'quantidade', p_quantity integer default 0, p_min_quantity integer default null, p_pieces jsonb default null,
  p_room text default null, p_cabinet text default null, p_shelf text default null, p_box text default null,
  p_condition text default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true);
  i public.inv_items; p jsonb; v_changes text[] := '{}';
  v_room text := private.inv_clean(p_room); v_cab text := private.inv_clean(p_cabinet);
  v_shelf text := private.inv_clean(p_shelf); v_box text := private.inv_clean(p_box);
  v_loc text; v_cond text := private.inv_clean(p_condition); v_notes text := private.inv_clean(p_notes);
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Indica o nome do artigo.'; end if;
  if length(trim(p_name)) > 120 then raise exception 'O nome é demasiado longo (máximo 120 caracteres).'; end if;
  if length(trim(coalesce(p_unit, ''))) = 0 then raise exception 'Indica a unidade (por exemplo: un., par, kg).'; end if;
  if p_min_quantity is not null and p_min_quantity < 0 then raise exception 'A quantidade mínima não pode ser negativa.'; end if;
  if v_cond is not null and v_cond not in ('novo', 'bom', 'razoavel', 'mau') then raise exception 'Estado de conservação inválido.'; end if;
  if length(coalesce(v_room, '')) > 120 or length(coalesce(v_cab, '')) > 80 or length(coalesce(v_shelf, '')) > 80 or length(coalesce(v_box, '')) > 80 then
    raise exception 'O local é demasiado longo (sala até 120 caracteres; armário, prateleira e caixa até 80).';
  end if;
  if length(coalesce(v_notes, '')) > 2000 then raise exception 'As observações são demasiado longas (máximo 2000 caracteres).'; end if;
  -- Compatibilidade: só a localização em texto livre → sala.
  if v_room is null and v_cab is null and v_shelf is null and v_box is null and private.inv_clean(p_location) is not null then
    v_room := left(private.inv_clean(p_location), 120);
  end if;
  v_loc := private.inv_loc(v_room, v_cab, v_shelf, v_box);
  if p_category is not null and not exists (select 1 from public.inv_categories where id = p_category and section_id = p_section and space = v_space) then
    raise exception 'Categoria não encontrada.';
  end if;
  if p_id is null then
    if coalesce(p_tracking, '') not in ('quantidade', 'pecas') then raise exception 'Tipo de controlo inválido.'; end if;
    if p_tracking = 'quantidade' and (p_quantity is null or p_quantity < 0) then raise exception 'A quantidade não pode ser negativa.'; end if;
    insert into public.inv_items (section_id, space, category_id, name, description, unit, location, room, cabinet, shelf, box,
                                  condition, notes, tracking, quantity, min_quantity, created_by)
    values (p_section, v_space, p_category, trim(p_name), private.inv_clean(p_description), trim(p_unit), v_loc, v_room, v_cab, v_shelf, v_box,
            v_cond, v_notes, p_tracking, case when p_tracking = 'quantidade' then p_quantity else 0 end, p_min_quantity, auth.uid())
    returning * into i;
    perform private.inv_log(i, 'criacao', case when p_tracking = 'quantidade' then p_quantity end, null, null, null);
    if p_tracking = 'quantidade' and p_quantity > 0 then
      perform private.inv_log(i, 'entrada', p_quantity, null, 'disponivel', 'Quantidade inicial');
    end if;
    if p_tracking = 'pecas' then
      for p in select * from jsonb_array_elements(coalesce(p_pieces, '[]'::jsonb)) loop
        perform public.inv_piece_add(p_section, i.id, p ->> 'code', p ->> 'serial', p ->> 'notes');
      end loop;
    end if;
    return i.id;
  end if;
  i := private.inv_item_locked(p_section, v_space, p_id);
  if p_tracking is not null and p_tracking <> i.tracking then
    raise exception 'O tipo de controlo (quantidade ou peças) não se altera depois de criado o artigo.';
  end if;
  if i.name is distinct from trim(p_name) then v_changes := array_append(v_changes, 'nome'); end if;
  if i.category_id is distinct from p_category then v_changes := array_append(v_changes, 'tipo'); end if;
  if i.location is distinct from v_loc then v_changes := array_append(v_changes, ('local: ' || coalesce(v_loc, '—'))); end if;
  if i.unit is distinct from trim(p_unit) then v_changes := array_append(v_changes, 'unidade'); end if;
  if i.description is distinct from private.inv_clean(p_description) then v_changes := array_append(v_changes, 'descrição'); end if;
  if i.condition is distinct from v_cond then v_changes := array_append(v_changes, ('conservação: ' || private.inv_condition_label(v_cond))); end if;
  if i.notes is distinct from v_notes then v_changes := array_append(v_changes, 'observações'); end if;
  if i.min_quantity is distinct from p_min_quantity then v_changes := array_append(v_changes, ('mínimo: ' || coalesce(p_min_quantity::text, '—'))); end if;
  update public.inv_items set category_id = p_category, name = trim(p_name), description = private.inv_clean(p_description),
         unit = trim(p_unit), location = v_loc, room = v_room, cabinet = v_cab, shelf = v_shelf, box = v_box,
         condition = v_cond, notes = v_notes, min_quantity = p_min_quantity,
         updated_by = auth.uid(), updated_at = now()
   where id = i.id returning * into i;
  if cardinality(v_changes) > 0 then perform private.inv_log(i, 'edicao', null, null, null, array_to_string(v_changes, ', ')); end if;
  return i.id;
end
$$;

-- ---------------------------------------------------------------------------
-- Lista «A comprar»
-- ---------------------------------------------------------------------------
create or replace function private.inv_purchase_json(p public.inv_purchases, p_amounts boolean, p_fin boolean) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'item_id', p.item_id, 'new_material', p.item_id is null,
    'name', coalesce(i.name, p.name), 'item_archived', i.archived_at is not null,
    'tracking', i.tracking,
    'category_id', coalesce(i.category_id, p.category_id),
    'category', (select c.name from public.inv_categories c where c.id = coalesce(i.category_id, p.category_id)),
    'quantity', p.quantity, 'unit', coalesce(i.unit, p.unit), 'reason', p.reason, 'priority', p.priority, 'status', p.status,
    'needed_by', p.needed_by,
    'event_id', p.event_id, 'event', (select e.title from public.cal_events e where e.id = p.event_id and e.space = p.space),
    'amount_cents', case when p_amounts then p.amount_cents end,
    'bought_qty', p.bought_qty, 'bought_on', p.bought_on, 'bought_at', p.bought_at,
    'bought_by', case when p.bought_by is not null then private.inv_name(p.bought_by) end,
    'stock_added_at', p.stock_added_at, 'stock_item_id', p.stock_item_id,
    'stock_added_by', case when p.stock_added_by is not null then private.inv_name(p.stock_added_by) end,
    'has_expense', p.fin_movement_id is not null,
    'expense', case when p_fin and p.fin_movement_id is not null then (
        select jsonb_build_object('id', m.id, 'description', m.description, 'occurred_on', m.occurred_on, 'amount_cents', m.amount_cents,
                                  'state', m.state, 'category', m.category, 'voided', m.voided_at is not null,
                                  'account', (select a.name from public.fin_accounts a where a.id = m.account_id))
          from public.fin_movements m where m.id = p.fin_movement_id and m.space = p.space) end,
    'cancelled_at', p.cancelled_at, 'cancel_reason', p.cancel_reason,
    'cancelled_by', case when p.cancelled_by is not null then private.inv_name(p.cancelled_by) end,
    'created_by', private.inv_name(p.created_by), 'created_at', p.created_at, 'updated_at', p.updated_at)
  from (select 1) x left join public.inv_items i on i.id = p.item_id
$$;

-- p_status: null ou 'todos' (todas), 'por_comprar', 'comprado', 'cancelado'.
create or replace function public.inv_purchases(p_section uuid, p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'inventario');
  v_amounts boolean := private.inv_can_manage(p_section) or private.inv_fin_ok(p_section, v_space);
  v_fin boolean := private.inv_fin_ok(p_section, v_space);
begin
  if p_status is not null and p_status not in ('todos', 'por_comprar', 'comprado', 'cancelado') then raise exception 'Estado inválido.'; end if;
  return coalesce((select jsonb_agg(private.inv_purchase_json(p, v_amounts, v_fin) order by
      case p.status when 'por_comprar' then 0 else 1 end,
      case when p.status = 'por_comprar' then case p.priority when 'alta' then 0 when 'media' then 1 else 2 end end,
      case when p.status = 'por_comprar' then p.needed_by end nulls last,
      coalesce(p.bought_at, p.cancelled_at, p.created_at) desc)
    from public.inv_purchases p
   where p.section_id = p_section and p.space = v_space
     and (coalesce(p_status, 'todos') = 'todos' or p.status = p_status)), '[]'::jsonb);
end
$$;

create or replace function private.inv_purchase_locked(p_section uuid, p_space text, p_id uuid) returns public.inv_purchases
language plpgsql security definer set search_path = ''
as $$
declare p public.inv_purchases;
begin
  select * into p from public.inv_purchases where id = p_id and section_id = p_section and space = p_space for update;
  if p.id is null then raise exception 'Registo não encontrado.'; end if;
  return p;
end
$$;

create or replace function public.inv_purchase_save(
  p_section uuid, p_id uuid, p_item uuid, p_name text, p_quantity integer, p_unit text default null, p_reason text default null,
  p_priority text default 'media', p_category uuid default null, p_needed_by date default null, p_event uuid default null,
  p_amount bigint default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true);
  i public.inv_items; p public.inv_purchases; v_unit text; v_id uuid;
begin
  if p_item is not null then
    select * into i from public.inv_items where id = p_item and section_id = p_section and space = v_space;
    if i.id is null then raise exception 'Artigo não encontrado.'; end if;
    if i.archived_at is not null then raise exception 'Este artigo está arquivado.'; end if;
    v_unit := i.unit;
  else
    if private.inv_clean(p_name) is null then raise exception 'Indica o material a comprar (um artigo existente ou o nome do material novo).'; end if;
    if length(trim(p_name)) > 120 then raise exception 'O nome é demasiado longo (máximo 120 caracteres).'; end if;
    v_unit := coalesce(private.inv_clean(p_unit), 'un.');
    if length(v_unit) > 20 then raise exception 'A unidade é demasiado longa.'; end if;
    if p_category is not null and not exists (select 1 from public.inv_categories where id = p_category and section_id = p_section and space = v_space) then
      raise exception 'Categoria não encontrada.';
    end if;
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then raise exception 'Indica uma quantidade igual ou superior a 1.'; end if;
  if coalesce(p_priority, '') not in ('baixa', 'media', 'alta') then raise exception 'Escolhe a prioridade: baixa, média ou alta.'; end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'O motivo é demasiado longo (máximo 500 caracteres).'; end if;
  if p_amount is not null and (p_amount <= 0 or p_amount > 100000000000) then raise exception 'Indica um valor superior a zero.'; end if;
  if p_event is not null and not exists (select 1 from public.cal_events where id = p_event and section_id = p_section and space = v_space) then
    raise exception 'Atividade não encontrada.';
  end if;
  if p_id is null then
    insert into public.inv_purchases (section_id, space, item_id, name, category_id, quantity, unit, reason, priority, needed_by, event_id,
                                      amount_cents, created_by)
    values (p_section, v_space, p_item, case when p_item is null then trim(p_name) end, case when p_item is null then p_category end,
            p_quantity, v_unit, private.inv_clean(p_reason), p_priority, p_needed_by, p_event, p_amount, auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  p := private.inv_purchase_locked(p_section, v_space, p_id);
  if p.status <> 'por_comprar' then raise exception 'Só se alteram compras ainda por comprar.'; end if;
  update public.inv_purchases set item_id = p_item, name = case when p_item is null then trim(p_name) end,
         category_id = case when p_item is null then p_category end, quantity = p_quantity, unit = v_unit,
         reason = private.inv_clean(p_reason), priority = p_priority, needed_by = p_needed_by, event_id = p_event, amount_cents = p_amount,
         updated_by = auth.uid(), updated_at = now()
   where id = p.id;
  return p.id;
end
$$;

-- Cancelar (por comprar → cancelado) ou reabrir (cancelado → por comprar). Nunca apaga.
create or replace function public.inv_purchase_cancel(p_section uuid, p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true); p public.inv_purchases;
begin
  p := private.inv_purchase_locked(p_section, v_space, p_id);
  if p.status <> 'por_comprar' then raise exception 'Só se cancelam compras ainda por comprar.'; end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'O motivo é demasiado longo (máximo 500 caracteres).'; end if;
  update public.inv_purchases set status = 'cancelado', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = private.inv_clean(p_reason),
         updated_by = auth.uid(), updated_at = now() where id = p.id;
end
$$;

create or replace function public.inv_purchase_reopen(p_section uuid, p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true); p public.inv_purchases;
begin
  p := private.inv_purchase_locked(p_section, v_space, p_id);
  if p.status <> 'cancelado' then raise exception 'Só se reabrem compras canceladas.'; end if;
  update public.inv_purchases set status = 'por_comprar', updated_by = auth.uid(), updated_at = now() where id = p.id;
end
$$;

-- Acrescentar ao inventário (uma só vez): soma ao artigo ligado ou cria o material novo
-- (se já houver um artigo ativo com o mesmo nome e unidade, por quantidade, soma-lhe em vez
-- de criar um duplicado). Fica um movimento de entrada no histórico, ligado à compra.
create or replace function private.inv_purchase_stock(p public.inv_purchases, p_category uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare i public.inv_items; v_qty integer := coalesce(p.bought_qty, p.quantity); v_existing uuid; v_cat uuid := coalesce(p_category, p.category_id);
begin
  if p.stock_added_at is not null then return p.stock_item_id; end if;
  if p.status <> 'comprado' then raise exception 'Só se acrescenta ao inventário uma compra marcada como comprada.'; end if;
  if p.item_id is null then
    select id into v_existing from public.inv_items
     where section_id = p.section_id and space = p.space and archived_at is null and tracking = 'quantidade'
       and lower(trim(name)) = lower(trim(p.name)) and lower(trim(unit)) = lower(trim(p.unit))
     order by created_at limit 1;
  end if;
  if coalesce(p.item_id, v_existing) is not null then
    i := private.inv_item_locked(p.section_id, p.space, coalesce(p.item_id, v_existing));
    if i.archived_at is not null then raise exception 'O artigo «%» está arquivado. Reativa-o antes de acrescentar a compra.', i.name; end if;
    if i.tracking = 'pecas' then
      raise exception 'O artigo «%» é controlado por peças: acrescenta as peças compradas na ficha do artigo.', i.name;
    end if;
    update public.inv_items set quantity = quantity + v_qty, updated_by = auth.uid(), updated_at = now() where id = i.id;
    insert into public.inv_movements (section_id, space, item_id, purchase_id, kind, quantity, from_state, to_state, note, actor)
    values (i.section_id, i.space, i.id, p.id, 'entrada', v_qty, i.quantity::text, (i.quantity + v_qty)::text, 'Compra (lista «A comprar»)', auth.uid());
  else
    if v_cat is not null and not exists (select 1 from public.inv_categories where id = v_cat and section_id = p.section_id and space = p.space) then
      raise exception 'Categoria não encontrada.';
    end if;
    insert into public.inv_items (section_id, space, category_id, name, unit, tracking, quantity, condition, created_by)
    values (p.section_id, p.space, v_cat, trim(p.name), p.unit, 'quantidade', v_qty, 'novo', auth.uid())
    returning * into i;
    insert into public.inv_movements (section_id, space, item_id, purchase_id, kind, quantity, note, actor)
    values (i.section_id, i.space, i.id, p.id, 'criacao', v_qty, 'Material novo comprado (lista «A comprar»)', auth.uid());
    insert into public.inv_movements (section_id, space, item_id, purchase_id, kind, quantity, from_state, to_state, note, actor)
    values (i.section_id, i.space, i.id, p.id, 'entrada', v_qty, '0', v_qty::text, 'Compra (lista «A comprar»)', auth.uid());
  end if;
  update public.inv_purchases set stock_added_at = now(), stock_added_by = auth.uid(), stock_item_id = i.id,
         updated_by = auth.uid(), updated_at = now() where id = p.id;
  return i.id;
end
$$;

-- Liga a compra a uma despesa existente da Tesouraria (mesma secção e espaço, por anular,
-- ainda não ligada a outra compra).
create or replace function private.inv_purchase_link(p public.inv_purchases, p_movement uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare m public.fin_movements;
begin
  perform private.inv_fin_require(p.section_id, p.space);
  if p.fin_movement_id is not null then
    if p.fin_movement_id = p_movement then return; end if;
    raise exception 'Esta compra já tem uma despesa associada.';
  end if;
  select * into m from public.fin_movements where id = p_movement and section_id = p.section_id and space = p.space for update;
  if m.id is null then raise exception 'Despesa não encontrada.'; end if;
  if m.kind <> 'despesa' then raise exception 'Escolhe uma despesa (não uma receita).'; end if;
  if m.voided_at is not null then raise exception 'Esta despesa está anulada.'; end if;
  if exists (select 1 from public.inv_purchases where fin_movement_id = m.id and id <> p.id) then
    raise exception 'Esta despesa já está associada a outra compra: uma despesa só pode ser contada uma vez.';
  end if;
  update public.inv_purchases set fin_movement_id = m.id, fin_linked_at = now(), fin_linked_by = auth.uid(),
         updated_by = auth.uid(), updated_at = now() where id = p.id;
end
$$;

-- Cria a despesa na Tesouraria (fin_create_movement verifica «tesouraria.gerir») e liga-a.
create or replace function private.inv_purchase_expense(
  p public.inv_purchases, p_on date, p_description text, p_category text, p_amount bigint, p_account uuid,
  p_state text, p_notes text, p_client_key uuid
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_m uuid; v_name text := coalesce((select name from public.inv_items where id = p.item_id), p.name);
begin
  perform private.inv_fin_require(p.section_id, p.space);
  if p.fin_movement_id is not null then raise exception 'Esta compra já tem uma despesa associada.'; end if;
  v_m := public.fin_create_movement(
    p.section_id, 'despesa', coalesce(p_on, p.bought_on, (now() at time zone 'Europe/Lisbon')::date),
    left(coalesce(private.inv_clean(p_description), 'Compra de material: ' || v_name), 200),
    coalesce(private.inv_clean(p_category), 'Material'), coalesce(p_amount, p.amount_cents), p_account, coalesce(p_state, 'efetivo'),
    p.event_id, null, p_notes, p_client_key);
  update public.inv_purchases set fin_movement_id = v_m, fin_linked_at = now(), fin_linked_by = auth.uid(),
         amount_cents = coalesce(amount_cents, p_amount), updated_by = auth.uid(), updated_at = now() where id = p.id;
  return v_m;
end
$$;

-- Marcar como comprado (uma vez) e, na mesma operação, opcionalmente acrescentar ao
-- inventário e associar a despesa (existente: p_movement; nova: p_expense com account,
-- category, state, description, on, notes, client_key). Tudo ou nada.
create or replace function public.inv_purchase_buy(
  p_section uuid, p_id uuid, p_bought_on date default null, p_quantity integer default null, p_amount bigint default null,
  p_add_stock boolean default false, p_category uuid default null, p_movement uuid default null, p_expense jsonb default null
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true);
  p public.inv_purchases; v_item uuid; v_mov uuid;
begin
  p := private.inv_purchase_locked(p_section, v_space, p_id);
  if p.status = 'comprado' then raise exception 'Esta compra já está marcada como comprada.'; end if;
  if p.status = 'cancelado' then raise exception 'Esta compra foi cancelada. Reabre-a primeiro.'; end if;
  if p_quantity is not null and (p_quantity < 1 or p_quantity > 1000000) then raise exception 'Indica a quantidade comprada (1 ou mais).'; end if;
  if p_amount is not null and (p_amount <= 0 or p_amount > 100000000000) then raise exception 'Indica um valor superior a zero.'; end if;
  if p_bought_on is not null and (p_bought_on > (now() at time zone 'Europe/Lisbon')::date + 1 or p_bought_on < date '2000-01-01') then
    raise exception 'A data da compra não pode ser no futuro.';
  end if;
  if p_movement is not null and p_expense is not null then raise exception 'Escolhe só uma forma de associar a despesa.'; end if;
  update public.inv_purchases set status = 'comprado', bought_qty = coalesce(p_quantity, quantity),
         bought_on = coalesce(p_bought_on, (now() at time zone 'Europe/Lisbon')::date), amount_cents = coalesce(p_amount, amount_cents),
         bought_by = auth.uid(), bought_at = now(), updated_by = auth.uid(), updated_at = now()
   where id = p.id returning * into p;
  if coalesce(p_add_stock, false) then
    v_item := private.inv_purchase_stock(p, p_category);
    select * into p from public.inv_purchases where id = p.id;
  end if;
  if p_movement is not null then
    perform private.inv_purchase_link(p, p_movement);
    v_mov := p_movement;
  elsif p_expense is not null then
    v_mov := private.inv_purchase_expense(p, (p_expense ->> 'on')::date, p_expense ->> 'description', p_expense ->> 'category',
      coalesce((p_expense ->> 'amount')::bigint, p_amount), (p_expense ->> 'account')::uuid, p_expense ->> 'state', p_expense ->> 'notes',
      (p_expense ->> 'client_key')::uuid);
  end if;
  return jsonb_build_object('item_id', v_item, 'movement_id', v_mov);
end
$$;

-- Acrescentar ao inventário depois (idempotente: a segunda chamada não soma de novo).
create or replace function public.inv_purchase_add_stock(p_section uuid, p_id uuid, p_category uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true); p public.inv_purchases;
begin
  p := private.inv_purchase_locked(p_section, v_space, p_id);
  return private.inv_purchase_stock(p, p_category);
end
$$;

create or replace function public.inv_purchase_link_expense(p_section uuid, p_id uuid, p_movement uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true); p public.inv_purchases;
begin
  p := private.inv_purchase_locked(p_section, v_space, p_id);
  if p.status <> 'comprado' then raise exception 'Marca primeiro a compra como comprada.'; end if;
  if p_movement is null then raise exception 'Escolhe a despesa.'; end if;
  perform private.inv_purchase_link(p, p_movement);
end
$$;

create or replace function public.inv_purchase_create_expense(
  p_section uuid, p_id uuid, p_on date, p_description text, p_category text, p_amount bigint, p_account uuid,
  p_state text default 'efetivo', p_notes text default null, p_client_key uuid default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true); p public.inv_purchases;
begin
  p := private.inv_purchase_locked(p_section, v_space, p_id);
  if p.status <> 'comprado' then raise exception 'Marca primeiro a compra como comprada.'; end if;
  return private.inv_purchase_expense(p, p_on, p_description, p_category, p_amount, p_account, p_state, p_notes, p_client_key);
end
$$;

-- Retirar a ligação a uma despesa (engano). A despesa continua na Tesouraria.
create or replace function public.inv_purchase_unlink_expense(p_section uuid, p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'inventario', 'inventario.gerir', true); p public.inv_purchases;
begin
  p := private.inv_purchase_locked(p_section, v_space, p_id);
  perform private.inv_fin_require(p_section, v_space);
  if p.fin_movement_id is null then return; end if;
  update public.inv_purchases set fin_movement_id = null, fin_linked_at = null, fin_linked_by = null,
         updated_by = auth.uid(), updated_at = now() where id = p.id;
end
$$;

-- Contas, categorias e despesas por associar (só para quem gere a Tesouraria no mesmo espaço).
create or replace function public.inv_expense_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'inventario');
begin
  if private.module_space(p_section, 'tesouraria') is distinct from v_space then
    return jsonb_build_object('allowed', false, 'reason', 'A Tesouraria não está disponível para ti no mesmo ambiente do Inventário.');
  end if;
  if not private.has_grant(p_section, 'tesouraria.gerir') then
    return jsonb_build_object('allowed', false, 'reason', 'Associar despesas exige a permissão de tesoureiro autorizado.');
  end if;
  return jsonb_build_object(
    'allowed', true,
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind) order by a.name)
                            from public.fin_accounts a where a.section_id = p_section and a.space = v_space and a.archived_at is null), '[]'::jsonb),
    'categories', (select jsonb_agg(c order by c) from (
        select unnest(array['Material', 'Atividades', 'Acampamentos', 'Alimentação', 'Transportes', 'Outros']) c
        union select category from public.fin_movements where section_id = p_section and space = v_space and kind = 'despesa') x),
    'expenses', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'occurred_on', m.occurred_on, 'description', m.description,
                            'category', m.category, 'amount_cents', m.amount_cents, 'state', m.state) order by m.occurred_on desc, m.created_at desc)
                          from (select * from public.fin_movements m
                                 where m.section_id = p_section and m.space = v_space and m.kind = 'despesa' and m.voided_at is null
                                   and not exists (select 1 from public.inv_purchases p where p.fin_movement_id = m.id)
                                 order by m.occurred_on desc, m.created_at desc limit 200) m), '[]'::jsonb));
end
$$;

-- Ficha do artigo: acrescenta as compras ligadas.
create or replace function public.inv_item(p_section uuid, p_item uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'inventario'); i public.inv_items;
  v_amounts boolean := private.inv_can_manage(p_section) or private.inv_fin_ok(p_section, v_space);
  v_fin boolean := private.inv_fin_ok(p_section, v_space);
begin
  select * into i from public.inv_items where id = p_item and section_id = p_section and space = v_space;
  if i.id is null then raise exception 'Registo não encontrado.'; end if;
  return private.inv_item_json(i) || jsonb_build_object(
    'can_manage', private.inv_can_manage(p_section),
    'pieces', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'serial', p.serial, 'notes', p.notes,
                  'status', case when p.status = 'disponivel' and exists (select 1 from public.inv_loan_pieces lp join public.inv_loans l on l.id = lp.loan_id
                                   where lp.piece_id = p.id and lp.returned_at is null and l.status = 'ativo') then 'emprestado' else p.status end)
                order by lower(p.code)) from public.inv_pieces p where p.item_id = i.id), '[]'::jsonb),
    'loans', coalesce((select jsonb_agg(private.inv_loan_json(l) order by (l.status in ('pedido', 'ativo')) desc, l.due_at)
               from public.inv_loans l where l.item_id = i.id and (l.status in ('pedido', 'ativo') or l.updated_at > now() - interval '90 days')), '[]'::jsonb),
    'reservations', coalesce((select jsonb_agg(private.inv_res_json(r) order by r.starts_at)
               from public.inv_reservations r where r.item_id = i.id and r.status = 'ativa' and r.ends_at > now()), '[]'::jsonb),
    'purchases', coalesce((select jsonb_agg(private.inv_purchase_json(p, v_amounts, v_fin) order by p.created_at desc)
               from public.inv_purchases p where (p.item_id = i.id or p.stock_item_id = i.id)
                 and (p.status = 'por_comprar' or p.updated_at > now() - interval '180 days')), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'quantity', m.quantity, 'from_state', m.from_state,
                  'to_state', m.to_state, 'note', m.note, 'at', m.at, 'actor', case when m.actor is not null then private.inv_name(m.actor) end,
                  'piece', (select p.code from public.inv_pieces p where p.id = m.piece_id),
                  'borrower', (select private.inv_name(l.borrower_id) from public.inv_loans l where l.id = m.loan_id)) order by m.id desc)
               from (select * from public.inv_movements where item_id = i.id order by id desc limit 200) m), '[]'::jsonb));
end
$$;

-- ---------------------------------------------------------------------------
-- Publicação com passagem dos dados de teste: como na v1, e as compras que ficariam
-- ligadas a despesas de teste perdem essa ligação (a despesa de teste nunca conta no real).
-- ---------------------------------------------------------------------------
create or replace function private.inventario_publish_move(p_section uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare c record; v_t text;
begin
  for c in select t.id test_id, r.id real_id, t.name from public.inv_categories t
             join public.inv_categories r on r.section_id = t.section_id and r.space = 'real' and lower(trim(r.name)) = lower(trim(t.name))
            where t.section_id = p_section and t.space = 'teste'
  loop
    update public.inv_items set category_id = c.real_id where category_id = c.test_id;
    update public.inv_purchases set category_id = c.real_id where category_id = c.test_id;
    update public.inv_categories set name = left(c.name, 60) || ' (teste ' || left(c.test_id::text, 8) || ')',
           archived_at = coalesce(archived_at, now()), updated_at = now() where id = c.test_id;
  end loop;
  foreach v_t in array private.module_tables('inventario') loop
    execute format('update public.%I set space = ''real'' where section_id = $1 and space = ''teste''', v_t) using p_section;
  end loop;
  update public.inv_purchases p set fin_movement_id = null, fin_linked_at = null, fin_linked_by = null
   where p.section_id = p_section and p.space = 'real' and p.fin_movement_id is not null
     and not exists (select 1 from public.fin_movements m where m.id = p.fin_movement_id and m.space = 'real');
end
$$;
revoke all on function private.inventario_publish_move(uuid) from public, anon, authenticated;
revoke all on function private.inv_purchase_stock(public.inv_purchases, uuid) from public, anon, authenticated;
revoke all on function private.inv_purchase_link(public.inv_purchases, uuid) from public, anon, authenticated;
revoke all on function private.inv_purchase_expense(public.inv_purchases, date, text, text, bigint, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function private.inv_purchase_locked(uuid, text, uuid) from public, anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;
notify pgrst, 'reload schema';


-- ===== 20261022000400_tesouraria_v2.sql =====
-- Pioneiros — Tesouraria, segunda versão: painel financeiro com saldo inicial explícito,
-- fórmula «Saldo atual = Saldo inicial + Receitas − Despesas», evolução do saldo, filtros
-- por mês / ano escutista / atividade e lista de movimentos partilhados com pesquisa.
--
-- • Saldo inicial (fin_opening_balances): global OU por conta/caixa (nunca os dois ao mesmo
--   tempo), com data de referência. É o saldo no INÍCIO desse dia: já inclui tudo o que
--   aconteceu antes. Por isso, movimentos com data anterior à data de referência (da conta
--   ou global) ficam registados e visíveis, mas não somam outra vez ao saldo atual.
-- • Só contam no saldo os movimentos efetivos e não anulados; pendentes e previstos à parte.
-- • Quem consulta (acesso ao módulo, sem «tesouraria.gerir») vê os movimentos partilhados:
--   data, descrição, categoria, valor, estado e atividade. Nunca vê quem fez um pagamento
--   individual de outra pessoa (a descrição é substituída por «Pagamento individual»), nem
--   observações, nem comprovativos alheios, nem movimentos anulados.
-- • public.fin_create_movement mantém assinatura e comportamento (usada pelo Inventário).
-- Aditivo: não altera nem apaga dados nem permissões existentes.

-- ---------------------------------------------------------------------------
-- Saldo inicial
-- ---------------------------------------------------------------------------
create table if not exists public.fin_opening_balances (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  account_id uuid references public.fin_accounts (id),   -- null = saldo inicial global
  reference_date date not null,
  amount_cents bigint not null check (amount_cents between -100000000000 and 100000000000),
  notes text check (notes is null or length(notes) <= 500),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (voided_at is null or (void_reason is not null and length(trim(void_reason)) > 0))
);
-- Um só saldo inicial ativo por conta/caixa (ou global) em cada espaço.
create unique index if not exists fin_opening_one on public.fin_opening_balances
  (section_id, space, coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid)) where voided_at is null;
alter table public.fin_opening_balances enable row level security;

drop trigger if exists fin_audit on public.fin_opening_balances;
create trigger fin_audit after insert or update on public.fin_opening_balances
  for each row execute function private.fin_audit_trg();

-- ---------------------------------------------------------------------------
-- Regras de cálculo
-- ---------------------------------------------------------------------------
-- Ano escutista (setembro a agosto): devolve o ano em que começa.
create or replace function private.fin_scout_year(p_day date)
returns int language sql immutable set search_path = ''
as $$
  select case when extract(month from p_day) >= 9 then extract(year from p_day)::int else extract(year from p_day)::int - 1 end
$$;

-- O movimento é efetivo e não anulado, mas tem data anterior ao saldo inicial que o cobre
-- (já está incluído nesse saldo): não soma outra vez.
create or replace function private.fin_before_opening(m public.fin_movements)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.fin_opening_balances o
                  where o.section_id = m.section_id and o.space = m.space and o.voided_at is null
                    and (o.account_id is null or o.account_id = m.account_id)
                    and m.occurred_on < o.reference_date)
$$;

-- Movimentos que contam no saldo atual: efetivos, não anulados e não anteriores ao saldo inicial.
create or replace function private.fin_counted(p_section uuid, p_space text)
returns setof public.fin_movements language sql stable security definer set search_path = ''
as $$
  select m.* from public.fin_movements m
   where m.section_id = p_section and m.space = p_space and m.state = 'efetivo' and m.voided_at is null
     and not exists (select 1 from public.fin_opening_balances o
                      where o.section_id = p_section and o.space = p_space and o.voided_at is null
                        and (o.account_id is null or o.account_id = m.account_id)
                        and m.occurred_on < o.reference_date)
$$;

-- Saldo no fim do dia (p_end_of_day) ou no início do dia indicado.
create or replace function private.fin_balance_at(p_section uuid, p_space text, p_day date, p_end_of_day boolean)
returns bigint language sql stable security definer set search_path = ''
as $$
  select coalesce((select sum(o.amount_cents) from public.fin_opening_balances o
                    where o.section_id = p_section and o.space = p_space and o.voided_at is null and o.reference_date <= p_day), 0)::bigint
       + coalesce((select sum(case when c.kind = 'receita' then c.amount_cents else -c.amount_cents end)
                     from private.fin_counted(p_section, p_space) c
                    where c.occurred_on < p_day or (p_end_of_day and c.occurred_on = p_day)), 0)::bigint
$$;

-- Movimento como o vê quem só consulta: sem membro, sem observações, sem conta; a descrição
-- de um pagamento individual de outra pessoa é substituída; comprovativos só nos seus.
create or replace function private.fin_shared_json(m public.fin_movements)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'kind', m.kind, 'occurred_on', m.occurred_on,
    'description', case when m.member_profile_id is null or m.member_profile_id = auth.uid() then m.description else 'Pagamento individual' end,
    'category', m.category, 'amount_cents', m.amount_cents, 'state', m.state,
    'activity_id', m.activity_id, 'activity_title', (select e.title from public.cal_events e where e.id = m.activity_id and e.space = m.space),
    'individual', m.member_profile_id is not null, 'mine', coalesce(m.member_profile_id = auth.uid(), false),
    'voided_at', m.voided_at,
    'files', case when m.member_profile_id = auth.uid() then
               (select count(*) from public.module_files f where f.module = 'tesouraria' and f.entity = 'movimento'
                   and f.entity_id = m.id and f.removed_at is null) else 0 end
  )
$$;

create or replace function private.fin_opening_json(o public.fin_opening_balances, p_manage boolean)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'account_id', o.account_id,
    'account_name', (select a.name from public.fin_accounts a where a.id = o.account_id),
    'reference_date', o.reference_date, 'amount_cents', o.amount_cents)
  || case when p_manage then jsonb_build_object('notes', o.notes,
       'created_by_name', private.fin_name(o.created_by), 'created_at', o.created_at,
       'updated_by_name', private.fin_name(o.updated_by), 'updated_at', o.updated_at) else '{}'::jsonb end
$$;

-- ---------------------------------------------------------------------------
-- Saldo inicial: definir, alterar (auditado) e anular com motivo
-- ---------------------------------------------------------------------------
create or replace function public.fin_save_opening_balance(
  p_section uuid, p_id uuid, p_account uuid, p_reference_date date, p_amount bigint, p_notes text default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); o public.fin_opening_balances; v_id uuid;
begin
  if p_reference_date is null then raise exception 'Indica a data de referência do saldo inicial.'; end if;
  if p_reference_date < date '2000-01-01' or p_reference_date > (now() at time zone 'Europe/Lisbon')::date then
    raise exception 'A data de referência não pode ser futura.';
  end if;
  if p_amount is null then raise exception 'Indica o valor do saldo inicial (pode ser 0,00 €).'; end if;
  if abs(p_amount) > 100000000000 then raise exception 'O valor é demasiado elevado.'; end if;
  if length(coalesce(p_notes, '')) > 500 then raise exception 'As notas têm no máximo 500 caracteres.'; end if;
  if p_account is not null and not exists (select 1 from public.fin_accounts a where a.id = p_account and a.section_id = p_section and a.space = v_space) then
    raise exception 'Escolhe uma conta ou caixa válida.';
  end if;
  -- Evita dois saldos iniciais em simultâneo (global vs. por conta) por pedidos concorrentes.
  perform pg_advisory_xact_lock(hashtext('fin_opening:' || p_section::text || ':' || v_space));
  if p_id is not null then
    select * into o from public.fin_opening_balances where id = p_id and section_id = p_section and space = v_space for update;
    if o.id is null then raise exception 'Registo não encontrado.'; end if;
    if o.voided_at is not null then raise exception 'Este saldo inicial está anulado e já não se altera.'; end if;
    if o.account_id is distinct from p_account then
      raise exception 'Para mudar a conta ou caixa, anula este saldo inicial e define outro.';
    end if;
  end if;
  if p_account is null and exists (select 1 from public.fin_opening_balances where section_id = p_section and space = v_space
                                      and voided_at is null and account_id is not null) then
    raise exception 'Já há saldos iniciais por conta ou caixa. Para usar um saldo inicial global, anula-os primeiro.';
  end if;
  if p_account is not null and exists (select 1 from public.fin_opening_balances where section_id = p_section and space = v_space
                                          and voided_at is null and account_id is null) then
    raise exception 'Já há um saldo inicial global. Para usar saldos por conta ou caixa, anula-o primeiro.';
  end if;
  if exists (select 1 from public.fin_opening_balances where section_id = p_section and space = v_space and voided_at is null
              and account_id is not distinct from p_account and id is distinct from p_id) then
    raise exception 'Já existe um saldo inicial para esta conta ou caixa: altera-o em vez de criar outro.';
  end if;
  if p_id is null then
    insert into public.fin_opening_balances (section_id, space, account_id, reference_date, amount_cents, notes, created_by)
    values (p_section, v_space, p_account, p_reference_date, p_amount, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
    returning id into v_id;
  else
    update public.fin_opening_balances set reference_date = p_reference_date, amount_cents = p_amount,
           notes = nullif(trim(coalesce(p_notes, '')), ''), updated_by = auth.uid(), updated_at = now()
     where id = p_id returning id into v_id;
  end if;
  return v_id;
end
$$;

create or replace function public.fin_void_opening_balance(p_section uuid, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section);
begin
  if length(trim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'Indica o motivo da anulação.'; end if;
  update public.fin_opening_balances set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason),
         updated_by = auth.uid(), updated_at = now()
   where id = p_id and section_id = p_section and space = v_space and voided_at is null;
  if not found then raise exception 'Registo não encontrado.'; end if;
end
$$;

-- Saldos iniciais (ativos e, para quem gere, também os anulados).
create or replace function public.fin_list_opening_balances(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria'); v_manage boolean := private.fin_can_manage(p_section);
begin
  return coalesce((select jsonb_agg(private.fin_opening_json(o, v_manage)
                                    || jsonb_build_object('voided_at', o.voided_at,
                                                          'void_reason', case when v_manage then o.void_reason end)
                                    order by o.voided_at nulls first, o.account_id nulls first, o.reference_date)
                     from public.fin_opening_balances o
                    where o.section_id = p_section and o.space = v_space and (v_manage or o.voided_at is null)), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Painel financeiro
-- ---------------------------------------------------------------------------
create or replace function public.fin_dashboard(
  p_section uuid, p_from date default null, p_to date default null, p_activity uuid default null
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'tesouraria');
  v_manage boolean := private.fin_can_manage(p_section);
  v_today date := (now() at time zone 'Europe/Lisbon')::date;
  v_open bigint; v_mode text; v_ref date; v_rec bigint; v_des bigint; v_first date;
  v_start date; v_end date; v_gran text := null; v_points jsonb := '[]'::jsonb;
begin
  if p_from is not null and p_to is not null and p_to < p_from then raise exception 'O período indicado não é válido.'; end if;

  select coalesce(sum(amount_cents), 0)::bigint, max(reference_date),
         case when count(*) = 0 then 'nenhum' when bool_or(account_id is null) then 'global' else 'conta' end
    into v_open, v_ref, v_mode
    from public.fin_opening_balances where section_id = p_section and space = v_space and voided_at is null;
  select coalesce(sum(amount_cents) filter (where kind = 'receita'), 0)::bigint, coalesce(sum(amount_cents) filter (where kind = 'despesa'), 0)::bigint,
         min(occurred_on)
    into v_rec, v_des, v_first
    from private.fin_counted(p_section, v_space);

  -- Evolução do saldo (de toda a tesouraria): só a partir da data do saldo inicial, quando existe.
  v_end := least(coalesce(p_to, v_today), v_today);
  if v_mode = 'nenhum' then
    v_start := coalesce(p_from, v_first, v_end);
  else
    v_start := greatest(coalesce(p_from, v_ref), v_ref);
  end if;
  if v_start <= v_end then
    if v_end - v_start > 62 then
      v_gran := 'mes';
      select jsonb_agg(jsonb_build_object('date', d, 'kind', k, 'saldo', private.fin_balance_at(p_section, v_space, d, k <> 'inicio')) order by d, k <> 'inicio')
        into v_points
        from (select v_start d, 'inicio' k
              union
              select least((date_trunc('month', g) + interval '1 month - 1 day')::date, v_end), 'mes'
                from generate_series(date_trunc('month', v_start), v_end::timestamp, interval '1 month') g) x;
    else
      v_gran := 'dia';
      select jsonb_agg(jsonb_build_object('date', d, 'kind', k, 'saldo', private.fin_balance_at(p_section, v_space, d, k <> 'inicio')) order by d, k <> 'inicio')
        into v_points
        from (select v_start d, 'inicio' k
              union
              select c.occurred_on, 'dia' from private.fin_counted(p_section, v_space) c where c.occurred_on between v_start and v_end
              union
              select v_end, 'dia') x;
    end if;
  end if;

  return (
    with mv as (
      select m.* from public.fin_movements m
       where m.section_id = p_section and m.space = v_space and m.voided_at is null
         and (p_from is null or m.occurred_on >= p_from) and (p_to is null or m.occurred_on <= p_to)
         and (p_activity is null or m.activity_id = p_activity)
    ), before_open as (
      select m.* from public.fin_movements m
       where m.section_id = p_section and m.space = v_space and m.state = 'efetivo' and m.voided_at is null
         and private.fin_before_opening(m)
    )
    select jsonb_build_object(
      'can_manage', v_manage,
      'space', v_space,
      'today', v_today,
      'opening', jsonb_build_object(
        'mode', v_mode, 'total', v_open, 'reference_date', v_ref,
        'items', coalesce((select jsonb_agg(private.fin_opening_json(o, v_manage) order by o.account_id nulls first, o.reference_date)
                             from public.fin_opening_balances o
                            where o.section_id = p_section and o.space = v_space and o.voided_at is null), '[]'::jsonb)),
      -- Saldo atual = Saldo inicial + Receitas − Despesas (efetivos, não anulados, desde o saldo inicial).
      'current', jsonb_build_object('saldo_inicial', v_open, 'receitas', v_rec, 'despesas', v_des, 'saldo', v_open + v_rec - v_des),
      'before_opening', (select jsonb_build_object('count', count(*),
                                  'receitas', coalesce(sum(amount_cents) filter (where kind = 'receita'), 0),
                                  'despesas', coalesce(sum(amount_cents) filter (where kind = 'despesa'), 0)) from before_open),
      'period', jsonb_build_object('from', p_from, 'to', p_to, 'activity_id', p_activity),
      'totals', (select jsonb_object_agg(s.st, jsonb_build_object('receitas', t.r, 'despesas', t.d, 'saldo', t.r - t.d))
                   from unnest(array['efetivo', 'pendente', 'previsto']) s(st)
                   cross join lateral (select coalesce(sum(amount_cents) filter (where kind = 'receita'), 0) r,
                                              coalesce(sum(amount_cents) filter (where kind = 'despesa'), 0) d
                                         from mv where mv.state = s.st) t),
      'count', (select count(*) from mv),
      'evolution', jsonb_build_object('granularity', v_gran, 'from', case when v_gran is not null then v_start end,
                                      'to', case when v_gran is not null then v_end end, 'points', coalesce(v_points, '[]'::jsonb)),
      'latest', coalesce((select jsonb_agg(j order by d desc, c desc) from (
                   select case when v_manage then private.fin_movement_json(m) else private.fin_shared_json(m) end
                          || jsonb_build_object('before_opening', m.state = 'efetivo' and private.fin_before_opening(m)) j,
                          m.occurred_on d, m.created_at c
                     from public.fin_movements m
                    where m.id in (select id from mv)
                    order by m.occurred_on desc, m.created_at desc limit 6) x), '[]'::jsonb),
      'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'kind', kind,
                                 'efetivo', ef, 'pendente', pe, 'previsto', pr) order by kind desc, ef desc, category)
                         from (select category, kind,
                                      coalesce(sum(amount_cents) filter (where state = 'efetivo'), 0) ef,
                                      coalesce(sum(amount_cents) filter (where state = 'pendente'), 0) pe,
                                      coalesce(sum(amount_cents) filter (where state = 'previsto'), 0) pr
                                 from mv group by category, kind) c), '[]'::jsonb),
      'activity', case when p_activity is not null then public.fin_activity_results(p_section, p_activity) -> 0 end,
      'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'archived', a.archived_at is not null,
                              'opening', (select private.fin_opening_json(o, false) from public.fin_opening_balances o
                                           where o.account_id = a.id and o.space = v_space and o.voided_at is null),
                              'movimentos', t.s,
                              'saldo', t.s + coalesce((select o.amount_cents from public.fin_opening_balances o
                                                         where o.account_id = a.id and o.space = v_space and o.voided_at is null), 0))
                              order by a.archived_at nulls first, a.name)
                         from public.fin_accounts a
                         cross join lateral (select coalesce(sum(case when c.kind = 'receita' then c.amount_cents else -c.amount_cents end), 0)::bigint s
                                               from private.fin_counted(p_section, v_space) c where c.account_id = a.id) t
                        where a.section_id = p_section and a.space = v_space
                          and (a.archived_at is null or t.s <> 0)), '[]'::jsonb),
      'years', (select jsonb_agg(y order by y desc) from (
                  select private.fin_scout_year(v_today) y
                  union select private.fin_scout_year(occurred_on) from public.fin_movements where section_id = p_section and space = v_space
                  union select private.fin_scout_year(reference_date) from public.fin_opening_balances
                         where section_id = p_section and space = v_space and voided_at is null) yy)
    ));
end
$$;

-- ---------------------------------------------------------------------------
-- Movimentos partilhados com pesquisa (todos com acesso; o que se vê depende da permissão)
-- ---------------------------------------------------------------------------
create or replace function public.fin_search_movements(
  p_section uuid, p_from date default null, p_to date default null, p_activity uuid default null, p_category text default null,
  p_state text default null, p_search text default null, p_include_voided boolean default false, p_limit int default 200
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'tesouraria');
  v_manage boolean := private.fin_can_manage(p_section);
  v_q text := lower(nullif(trim(coalesce(p_search, '')), ''));
  v_lim int := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if v_q is not null and length(v_q) > 100 then raise exception 'A pesquisa tem no máximo 100 caracteres.'; end if;
  return (
    with hit as (
      select m from public.fin_movements m
        left join public.cal_events e on e.id = m.activity_id and e.space = m.space
       where m.section_id = p_section and m.space = v_space
         and (m.voided_at is null or (v_manage and coalesce(p_include_voided, false)))
         and (p_from is null or m.occurred_on >= p_from) and (p_to is null or m.occurred_on <= p_to)
         and (p_activity is null or m.activity_id = p_activity) and (p_category is null or m.category = p_category)
         and (p_state is null or m.state = p_state)
         and (v_q is null
              -- Quem só consulta pesquisa apenas no que pode ver (nunca na descrição escondida).
              or strpos(lower(case when v_manage or m.member_profile_id is null or m.member_profile_id = auth.uid()
                                   then m.description else 'Pagamento individual' end), v_q) > 0
              or strpos(lower(m.category), v_q) > 0
              or strpos(lower(coalesce(e.title, '')), v_q) > 0
              or (v_manage and (strpos(lower(coalesce(private.fin_name(m.member_profile_id), '')), v_q) > 0
                                or strpos(lower(coalesce(m.notes, '')), v_q) > 0)))
    )
    select jsonb_build_object(
      'can_manage', v_manage,
      'total', (select count(*) from hit),
      'limit', v_lim,
      'items', coalesce((select jsonb_agg(j order by d desc, c desc) from (
                  select (case when v_manage then private.fin_movement_json(h.m) else private.fin_shared_json(h.m) end)
                         || jsonb_build_object('before_opening', (h.m).state = 'efetivo' and (h.m).voided_at is null and private.fin_before_opening(h.m)) j,
                         (h.m).occurred_on d, (h.m).created_at c
                    from hit h order by (h.m).occurred_on desc, (h.m).created_at desc limit v_lim) x), '[]'::jsonb)
    ));
end
$$;

-- ---------------------------------------------------------------------------
-- Ajustes à v1 (mesmas assinaturas)
-- ---------------------------------------------------------------------------
-- Opções: junta os saldos iniciais ativos (para avisar quando a data é anterior).
create or replace function public.fin_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria');
begin
  return jsonb_build_object(
    'can_manage', private.fin_can_manage(p_section),
    'space', v_space,
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'archived', a.archived_at is not null)
                                   order by a.archived_at nulls first, a.name)
                            from public.fin_accounts a where a.section_id = p_section and a.space = v_space), '[]'::jsonb),
    'categories', (select jsonb_agg(c order by c) from (
        select unnest(array['Quotas', 'Atividades', 'Acampamentos', 'Material', 'Transportes', 'Alimentação', 'Donativos', 'Angariação de fundos', 'Outros']) c
        union select category from public.fin_movements where section_id = p_section and space = v_space
        union select category from public.fin_budget_lines where section_id = p_section and space = v_space) x),
    'opening', coalesce((select jsonb_agg(jsonb_build_object('account_id', o.account_id, 'reference_date', o.reference_date))
                           from public.fin_opening_balances o
                          where o.section_id = p_section and o.space = v_space and o.voided_at is null), '[]'::jsonb)
  );
end
$$;

-- Resumo v1: o saldo de cada conta passa a seguir a regra do saldo inicial.
create or replace function public.fin_summary(
  p_section uuid, p_from date default null, p_to date default null, p_category text default null, p_activity uuid default null
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria');
begin
  return (
    with mv as (
      select m.* from public.fin_movements m
       where m.section_id = p_section and m.space = v_space and m.voided_at is null
         and (p_from is null or m.occurred_on >= p_from) and (p_to is null or m.occurred_on <= p_to)
         and (p_category is null or m.category = p_category) and (p_activity is null or m.activity_id = p_activity)
    )
    select jsonb_build_object(
      'can_manage', private.fin_can_manage(p_section),
      'totals', (select jsonb_object_agg(s.st, jsonb_build_object('receitas', t.r, 'despesas', t.d, 'saldo', t.r - t.d))
                   from unnest(array['efetivo', 'pendente', 'previsto']) s(st)
                   cross join lateral (select coalesce(sum(amount_cents) filter (where kind = 'receita'), 0) r,
                                              coalesce(sum(amount_cents) filter (where kind = 'despesa'), 0) d
                                         from mv where mv.state = s.st) t),
      'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'kind', kind,
                                 'efetivo', ef, 'pendente', pe, 'previsto', pr) order by kind desc, ef desc, category)
                         from (select category, kind,
                                      coalesce(sum(amount_cents) filter (where state = 'efetivo'), 0) ef,
                                      coalesce(sum(amount_cents) filter (where state = 'pendente'), 0) pe,
                                      coalesce(sum(amount_cents) filter (where state = 'previsto'), 0) pr
                                 from mv group by category, kind) c), '[]'::jsonb),
      'by_activity', coalesce((select jsonb_agg(jsonb_build_object('activity_id', x.activity_id, 'title', e.title,
                                 'receitas', x.r, 'despesas', x.d, 'saldo', x.r - x.d, 'pendente_saldo', x.pr - x.pd) order by e.title)
                         from (select activity_id,
                                      coalesce(sum(amount_cents) filter (where state = 'efetivo' and kind = 'receita'), 0) r,
                                      coalesce(sum(amount_cents) filter (where state = 'efetivo' and kind = 'despesa'), 0) d,
                                      coalesce(sum(amount_cents) filter (where state <> 'efetivo' and kind = 'receita'), 0) pr,
                                      coalesce(sum(amount_cents) filter (where state <> 'efetivo' and kind = 'despesa'), 0) pd
                                 from mv where activity_id is not null group by activity_id) x
                         join public.cal_events e on e.id = x.activity_id and e.space = v_space), '[]'::jsonb),
      -- Saldo atual de cada conta ou caixa ativa: saldo inicial da conta + movimentos que contam.
      'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind,
                              'saldo', coalesce((select sum(case when c.kind = 'receita' then c.amount_cents else -c.amount_cents end)
                                                   from private.fin_counted(p_section, v_space) c where c.account_id = a.id), 0)
                                     + coalesce((select o.amount_cents from public.fin_opening_balances o
                                                  where o.account_id = a.id and o.space = v_space and o.voided_at is null), 0))
                              order by a.name)
                         from public.fin_accounts a where a.section_id = p_section and a.space = v_space and a.archived_at is null), '[]'::jsonb),
      'count', (select count(*) from mv)
    ));
end
$$;

-- Publicar com «passar dados de teste a reais» (v1) + saldo inicial: se os dados reais já
-- têm saldo inicial, o de teste é anulado (fica registado) para nunca haver dois.
create or replace function private.tesouraria_publish_move(p_section uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_t text;
begin
  update public.fin_opening_balances t set voided_at = now(), void_reason = 'Os dados reais já tinham saldo inicial.', updated_at = now()
   where t.section_id = p_section and t.space = 'teste' and t.voided_at is null
     and exists (select 1 from public.fin_opening_balances r where r.section_id = p_section and r.space = 'real' and r.voided_at is null);
  foreach v_t in array private.module_tables('tesouraria') loop
    execute format('update public.%I set space = ''real'' where section_id = $1 and space = ''teste''', v_t) using p_section;
  end loop;
  update public.fin_movements m set activity_id = null,
         notes = left(coalesce(m.notes || E'\n', '') || 'Atividade de teste desligada ao publicar.', 1000), updated_at = now()
   where m.section_id = p_section and m.space = 'real' and m.activity_id is not null
     and not exists (select 1 from public.cal_events e where e.id = m.activity_id and e.space = 'real');
  update public.fin_budget_lines l set voided_at = now(), void_reason = 'Atividade de teste não passou a dados reais.', updated_at = now()
   where l.section_id = p_section and l.space = 'real' and l.voided_at is null
     and not exists (select 1 from public.cal_events e where e.id = l.activity_id and e.space = 'real');
end
$$;

revoke all on function private.fin_audit_trg() from public, anon, authenticated;
revoke all on function private.tesouraria_publish_move(uuid) from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Mantém reservado ao agendador o envio de lembretes (a base retira-o a utilizadores).
revoke execute on function public.process_due_reminders() from authenticated;


-- ===== 20261022000600_reunioes_v2.sql =====
-- Pioneiros — «Reuniões e tarefas» (antiga Secretaria; chave interna 'secretaria', prefixo sec_), versão 2.
--
-- O que muda (aditivo; preserva todos os registos da v1):
--   • Registos da ata: decisões, tarefas e «a preparar para a próxima atividade» (novo tipo
--     'preparar'). Tarefas e preparativos podem não ter responsável nem prazo: o que não consta
--     da ata fica «Por definir» (nada é inventado). Podem ter uma equipa responsável e uma
--     atividade do Calendário associada (mesma secção e espaço).
--   • Estados das tarefas: Por fazer, Em curso, Concluída. Os registos v1 «feita» passam a
--     «concluida» (com entrada no histórico); «cancelada» mantém-se como estado arquivado,
--     fora do quadro. Histórico de conclusão e alterações (quem, quando, de/para) em sec_item_history.
--   • Sumário estruturado por reunião (sec_summaries + sec_summary_versions): o rascunho é
--     pré-preenchido só com os elementos registados na ata (decisões, tarefas e preparativos,
--     com responsável/prazo/atividade tal como constam; o que falta fica por definir). Quem
--     redige (ou aprova) revê e edita; publicar é um passo explícito de quem aprova
--     ('secretaria.aprovar' ou dirigente que vê a reunião) e exige a ata aprovada. Uma versão
--     publicada nunca muda (gatilho): rever cria uma nova versão com motivo, que só substitui a
--     publicada quando for publicada. Ao publicar, os responsáveis/prazos/atividades revistos
--     passam para o quadro de tarefas (com histórico).
--   • Quadro de tarefas: tarefas e preparativos das reuniões que a pessoa vê; destaque para
--     atrasos; filtros por responsável, equipa e atividade.
--   • «O que me diz respeito»: tarefas e preparativos atribuídos à pessoa ou à sua equipa.
--     De reuniões que a pessoa não vê, só aparecem os pontos de sumários publicados, e só o
--     título revisto, o prazo, o estado e a atividade — nunca texto da ata nem decisões.
--   • Pesquisa e histórico de reuniões por texto, data, equipa, tipo e atividade.
--   • Notificações internas (private.module_notify) com texto genérico; nada de mensagens externas.
--   • Integração: private.sec_tasks_for_event(secção, espaço, atividade) devolve as tarefas
--     visíveis ao utilizador atual ligadas a uma atividade do Calendário.
-- Mantém-se da v1: visibilidade por tipo de reunião, aprovação de atas, versões e aditamentos.

-- ---------------------------------------------------------------------------
-- 1. Registos da ata (sec_items): novos campos, novo tipo e novos estados
-- ---------------------------------------------------------------------------
alter table public.sec_items add column if not exists responsible_team_id uuid references public.teams (id);
alter table public.sec_items add column if not exists cal_event_id uuid references public.cal_events (id) on delete set null;
alter table public.sec_items add column if not exists completed_at timestamptz;
alter table public.sec_items add column if not exists completed_by uuid;
create index if not exists sec_items_event on public.sec_items (section_id, space, cal_event_id) where cal_event_id is not null;

-- Tarefas já não exigem responsável e prazo (quando não constam da ata ficam por definir).
alter table public.sec_items drop constraint if exists sec_items_check;
alter table public.sec_items drop constraint if exists sec_items_kind_check;
alter table public.sec_items add constraint sec_items_kind_check check (kind in ('decisao', 'tarefa', 'preparar'));
alter table public.sec_items drop constraint if exists sec_items_exec_status_check;

-- Histórico de alterações e conclusão (nunca se apaga nem se altera).
create table if not exists public.sec_item_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.sec_items (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  field text not null check (field in ('criada', 'estado', 'responsavel', 'equipa', 'prazo', 'atividade', 'texto')),
  from_value text,
  to_value text,
  note text check (note is null or length(note) <= 1000),
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists sec_item_history_item on public.sec_item_history (item_id, changed_at);
alter table public.sec_item_history enable row level security;

create or replace function private.sec_history_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  -- Só a mudança de espaço ao publicar o módulo é permitida.
  if (to_jsonb(new) - 'space') is distinct from (to_jsonb(old) - 'space') then
    raise exception 'O histórico das tarefas não pode ser alterado.';
  end if;
  return new;
end
$$;
drop trigger if exists sec_history_guard on public.sec_item_history;
create trigger sec_history_guard before update on public.sec_item_history
  for each row execute function private.sec_history_guard();

-- Migração dos estados v1 (sem perder informação):
--   a) a última mudança de estado registada na v1 entra no histórico;
--   b) «feita» passa a «concluida», com entrada própria no histórico.
insert into public.sec_item_history (item_id, section_id, space, field, from_value, to_value, note, changed_by, changed_at)
select i.id, i.section_id, i.space, 'estado', null, i.exec_status,
       left(coalesce('Registo da versão anterior. ' || i.status_note, 'Registo da versão anterior.'), 1000), i.status_changed_by, i.status_changed_at
  from public.sec_items i
 where i.status_changed_at is not null
   and not exists (select 1 from public.sec_item_history h where h.item_id = i.id and h.note like 'Registo da versão anterior.%');
insert into public.sec_item_history (item_id, section_id, space, field, from_value, to_value, note, changed_by)
select i.id, i.section_id, i.space, 'estado', 'feita', 'concluida', 'Migração: o estado «Feita» passou a chamar-se «Concluída».', null
  from public.sec_items i where i.exec_status = 'feita';
update public.sec_items
   set exec_status = 'concluida',
       completed_at = coalesce(completed_at, status_changed_at, updated_at),
       completed_by = coalesce(completed_by, status_changed_by)
 where exec_status = 'feita';
alter table public.sec_items add constraint sec_items_exec_status_check
  check (exec_status in ('por_fazer', 'em_curso', 'concluida', 'cancelada'));

-- ---------------------------------------------------------------------------
-- 2. Sumário estruturado (por reunião), com versões
-- ---------------------------------------------------------------------------
create table if not exists public.sec_summaries (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  meeting_id uuid not null unique references public.sec_meetings (id) on delete cascade,
  status text not null default 'rascunho' check (status in ('rascunho', 'publicado')),
  current_version integer not null default 1,
  published_version integer,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (status <> 'publicado' or published_version = current_version)
);
create index if not exists sec_summaries_section on public.sec_summaries (section_id, space);
alter table public.sec_summaries enable row level security;

create table if not exists public.sec_summary_versions (
  id uuid primary key default gen_random_uuid(),
  summary_id uuid not null references public.sec_summaries (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  version_no integer not null check (version_no >= 1),
  content jsonb not null default '{"entries": []}'::jsonb,
  note text check (note is null or length(note) <= 1000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid,
  unique (summary_id, version_no)
);
alter table public.sec_summary_versions enable row level security;

-- Uma versão publicada nunca muda (só o espaço, ao publicar o módulo).
create or replace function private.sec_summary_versions_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.published_at is not null and (to_jsonb(new) - 'space') is distinct from (to_jsonb(old) - 'space') then
    raise exception 'Esta versão do sumário está publicada e não pode ser alterada.';
  end if;
  return new;
end
$$;
drop trigger if exists sec_summary_versions_guard on public.sec_summary_versions;
create trigger sec_summary_versions_guard before update on public.sec_summary_versions
  for each row execute function private.sec_summary_versions_guard();

-- ---------------------------------------------------------------------------
-- 3. Regras auxiliares
-- ---------------------------------------------------------------------------
create or replace function private.sec_today()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'Europe/Lisbon')::date $$;

create or replace function private.sec_my_team(p_section uuid, p_profile uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select team_id from public.memberships where section_id = p_section and profile_id = p_profile and status = 'ativo' limit 1
$$;

-- Quem redige ou aprova nesta reunião gere as tarefas (responsável, prazo, atividade, arquivo).
create or replace function private.sec_can_manage(p_meeting uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.sec_can_draft(p_meeting) or private.sec_can_approve(p_meeting) $$;

-- Ponto do sumário publicado (versão em vigor) correspondente a um registo, ou null.
create or replace function private.sec_published_entry(p_item uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select e from public.sec_items i
    join public.sec_summaries s on s.meeting_id = i.meeting_id and s.published_version is not null
    join public.sec_summary_versions v on v.summary_id = s.id and v.version_no = s.published_version
    cross join lateral jsonb_array_elements(v.content -> 'entries') e
   where i.id = p_item and e ->> 'item_id' = p_item::text and not coalesce((e ->> 'omitted')::boolean, false)
   limit 1
$$;

-- A tarefa/preparativo diz respeito a esta pessoa (responsável ou da equipa responsável) e
-- ela pode sabê-lo: vê a reunião, ou o ponto consta de um sumário publicado.
create or replace function private.sec_concerns_as(i public.sec_items, p_profile uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select i.kind in ('tarefa', 'preparar') and p_profile is not null
     and exists (select 1 from public.memberships ms where ms.section_id = i.section_id and ms.profile_id = p_profile and ms.status = 'ativo'
                  and (ms.profile_id = i.responsible_id or (i.responsible_team_id is not null and ms.team_id = i.responsible_team_id)))
     and (private.sec_can_see_as(i.meeting_id, p_profile) or private.sec_published_entry(i.id) is not null)
$$;

-- Pessoas a quem a tarefa diz respeito (para notificações).
create or replace function private.sec_item_audience(i public.sec_items)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(ms.profile_id), '{}') from public.memberships ms
   where i.kind in ('tarefa', 'preparar') and ms.section_id = i.section_id and ms.status = 'ativo'
     and (ms.profile_id = i.responsible_id or (i.responsible_team_id is not null and ms.team_id = i.responsible_team_id))
     and (private.sec_can_see_as(i.meeting_id, ms.profile_id) or private.sec_published_entry(i.id) is not null)
$$;

-- Atividade do Calendário, só se for da mesma secção e do mesmo espaço.
create or replace function private.sec_event_json(p_event uuid, p_section uuid, p_space text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', e.id, 'title', e.title,
           'starts_at', coalesce(e.starts_at, (e.start_date::timestamp + time '12:00') at time zone 'Europe/Lisbon'),
           'all_day', e.all_day, 'status', e.status)
    from public.cal_events e where e.id = p_event and e.section_id = p_section and e.space = p_space
$$;

create or replace function private.sec_status_label(p_status text)
returns text language sql immutable set search_path = ''
as $$
  select case p_status when 'por_fazer' then 'Por fazer' when 'em_curso' then 'Em curso' when 'concluida' then 'Concluída'
                       when 'feita' then 'Feita' when 'cancelada' then 'Arquivada (cancelada)' else p_status end
$$;

create or replace function private.sec_kind_label(p_kind text)
returns text language sql immutable set search_path = ''
as $$
  select case p_kind when 'decisao' then 'Decisão' when 'tarefa' then 'Tarefa' when 'preparar' then 'Preparativo' else p_kind end
$$;

-- Regista no histórico as diferenças entre duas versões do registo (a = antes; null = criado).
create or replace function private.sec_item_log(a public.sec_items, b public.sec_items, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if a.id is null then
    insert into public.sec_item_history (item_id, section_id, space, field, from_value, to_value, note, changed_by)
    values (b.id, b.section_id, b.space, 'criada', null, b.kind, p_note, auth.uid());
    return;
  end if;
  insert into public.sec_item_history (item_id, section_id, space, field, from_value, to_value, note, changed_by)
  select b.id, b.section_id, b.space, f, x, y, p_note, auth.uid()
    from (values
      ('texto', a.text, b.text),
      ('responsavel', a.responsible_id::text, b.responsible_id::text),
      ('equipa', a.responsible_team_id::text, b.responsible_team_id::text),
      ('prazo', a.due_date::text, b.due_date::text),
      ('atividade', a.cal_event_id::text, b.cal_event_id::text),
      ('estado', a.exec_status, b.exec_status)) d(f, x, y)
   where x is distinct from y;
end
$$;

create or replace function private.sec_history_label(p_field text, p_value text, p_section uuid, p_space text)
returns text language sql stable security definer set search_path = ''
as $$
  select case
    when p_value is null then case when p_field in ('responsavel', 'prazo', 'atividade', 'equipa') then 'Por definir' else null end
    when p_field = 'estado' then private.sec_status_label(p_value)
    when p_field = 'criada' then private.sec_kind_label(p_value)
    when p_field = 'responsavel' then coalesce(private.sec_name(p_value::uuid), 'Pessoa removida')
    when p_field = 'equipa' then coalesce((select name from public.teams where id = p_value::uuid), 'Equipa removida')
    when p_field = 'prazo' then to_char(p_value::date, 'DD/MM/YYYY')
    when p_field = 'atividade' then coalesce((private.sec_event_json(p_value::uuid, p_section, p_space)) ->> 'title', 'Atividade indisponível')
    else p_value end
$$;

-- ---------------------------------------------------------------------------
-- 4. Leituras partilhadas (redefinidas com os novos campos)
-- ---------------------------------------------------------------------------
create or replace function private.sec_item_json(i public.sec_items)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'minute_id', i.minute_id, 'meeting_id', i.meeting_id, 'kind', i.kind, 'text', i.text,
    'responsible_id', i.responsible_id, 'responsible_name', private.sec_name(i.responsible_id),
    'responsible_team_id', i.responsible_team_id, 'team_name', (select name from public.teams where id = i.responsible_team_id),
    'due_date', i.due_date, 'reminder_days', i.reminder_days, 'exec_status', i.exec_status, 'status_note', i.status_note,
    'completed_at', i.completed_at,
    'overdue', i.kind in ('tarefa', 'preparar') and i.exec_status in ('por_fazer', 'em_curso') and coalesce(i.due_date < private.sec_today(), false),
    'cal_event_id', i.cal_event_id, 'cal_event', private.sec_event_json(i.cal_event_id, i.section_id, i.space),
    'trail_request_id', i.trail_request_id, 'stage_path_id', i.stage_path_id,
    'link_label', private.sec_link_label(i.trail_request_id, i.stage_path_id))
$$;

-- Conteúdo de um documento (congelado como «snapshot» quando é submetido).
create or replace function private.sec_content(p_minute uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'title', m.title, 'kind', m.kind, 'team_name', t.name, 'starts_at', m.starts_at, 'location', m.location, 'agenda', m.agenda,
    'cal_event_title', (private.sec_event_json(m.cal_event_id, m.section_id, m.space)) ->> 'title',
    'participants', coalesce((select jsonb_agg(private.sec_name(p.profile_id) order by private.sec_name(p.profile_id))
                               from public.sec_participants p where p.meeting_id = m.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'text', i.text,
                                         'responsible_name', private.sec_name(i.responsible_id),
                                         'team_name', (select name from public.teams where id = i.responsible_team_id),
                                         'due_date', i.due_date,
                                         'event_title', (private.sec_event_json(i.cal_event_id, i.section_id, i.space)) ->> 'title',
                                         'link_label', private.sec_link_label(i.trail_request_id, i.stage_path_id))
                                       order by i.created_at)
                         from public.sec_items i where i.minute_id = d.id), '[]'::jsonb))
  from public.sec_minutes d join public.sec_meetings m on m.id = d.meeting_id
  left join public.teams t on t.id = m.team_id
  where d.id = p_minute
$$;

-- Lembrete antes do prazo (único por registo e responsável), só se a pessoa o pode ver.
create or replace function private.sec_schedule_item(i public.sec_items)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_due timestamptz;
begin
  perform private.cancel_reminders('sec_item', i.id);
  if i.kind not in ('tarefa', 'preparar') or i.responsible_id is null or i.due_date is null
     or i.exec_status in ('concluida', 'cancelada')
     or exists (select 1 from public.sec_meetings where id = i.meeting_id and status = 'anulada') then
    return;
  end if;
  if not (private.sec_can_see_as(i.meeting_id, i.responsible_id) or private.sec_published_entry(i.id) is not null) then return; end if;
  if coalesce(i.due_date < private.sec_today(), false) then return; end if;
  v_due := ((i.due_date - i.reminder_days)::timestamp + time '09:00') at time zone 'Europe/Lisbon';
  perform private.schedule_reminder(i.section_id, 'secretaria', i.space, 'sec_item', i.id, 'prazo', i.responsible_id,
    v_due, 'Prazo de tarefa', 'Uma tarefa tua aproxima-se do prazo.', '/reunioes-e-tarefas/o-que-me-diz-respeito');
end
$$;

-- Notifica quem passou a ter a tarefa (texto genérico, sem conteúdo da ata).
create or replace function private.sec_notify_assigned(p_before uuid[], i public.sec_items)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_new uuid[];
begin
  if i.kind = 'decisao' then
    if i.responsible_id is not null and not coalesce(i.responsible_id = any (p_before), false)
       and private.sec_can_see_as(i.meeting_id, i.responsible_id) then
      perform private.module_notify(i.section_id, 'secretaria', i.space, array[i.responsible_id], 'sec_tarefa',
        'Nova decisão', 'Tens um novo registo atribuído em Reuniões e tarefas.', '/reunioes-e-tarefas/reunioes/' || i.meeting_id);
    end if;
    return;
  end if;
  select coalesce(array_agg(x), '{}') into v_new from unnest(private.sec_item_audience(i)) x where not coalesce(x = any (p_before), false);
  if cardinality(v_new) > 0 then
    perform private.module_notify(i.section_id, 'secretaria', i.space, v_new, 'sec_tarefa',
      case when i.kind = 'preparar' then 'Novo preparativo' else 'Nova tarefa' end,
      'Tens um novo registo atribuído em Reuniões e tarefas.', '/reunioes-e-tarefas/o-que-me-diz-respeito');
  end if;
end
$$;

-- Notificações da v1 não mudam; os links antigos (/secretaria/...) continuam a funcionar
-- porque a aplicação redireciona para /reunioes-e-tarefas/...

-- ---------------------------------------------------------------------------
-- 5. Reuniões e atas: pesquisa e histórico (data, equipa, tipo, atividade)
-- ---------------------------------------------------------------------------
drop function if exists public.sec_meetings(uuid, text, text);
create or replace function public.sec_meetings(
  p_section uuid, p_search text default null, p_kind text default null, p_team uuid default null,
  p_event uuid default null, p_from date default null, p_to date default null
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); v_q text := nullif(trim(coalesce(p_search, '')), '');
begin
  return jsonb_build_object(
    'can_draft', private.has_grant(p_section, 'secretaria.redigir'),
    'can_approve', private.has_grant(p_section, 'secretaria.aprovar') or private.is_dirigente(p_section),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                        from public.teams t where t.section_id = p_section and t.archived_at is null), '[]'::jsonb),
    -- Atividades ligadas a reuniões que a pessoa vê (para o filtro).
    'events', coalesce((select jsonb_agg(x.ev order by x.ev ->> 'starts_at' desc) from (
                          select distinct private.sec_event_json(m.cal_event_id, p_section, v_space) ev
                            from public.sec_meetings m
                           where m.section_id = p_section and m.space = v_space and m.cal_event_id is not null
                             and private.sec_can_see_as(m.id, auth.uid())) x where x.ev is not null), '[]'::jsonb),
    'meetings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'team_id', m.team_id, 'team_name', t.name, 'title', m.title, 'starts_at', m.starts_at,
        'location', m.location, 'status', m.status,
        'cal_event', private.sec_event_json(m.cal_event_id, p_section, v_space),
        'ata', (select jsonb_build_object('id', d.id, 'status', d.status, 'approved_version', d.approved_version, 'current_version', d.current_version)
                  from public.sec_minutes d where d.meeting_id = m.id and d.kind = 'ata'),
        'summary', (select jsonb_build_object('id', s.id, 'status', s.status, 'published_version', s.published_version)
                      from public.sec_summaries s where s.meeting_id = m.id),
        'decisions', (select count(*) from public.sec_items i where i.meeting_id = m.id and i.kind = 'decisao'),
        'open_tasks', (select count(*) from public.sec_items i where i.meeting_id = m.id and i.kind in ('tarefa', 'preparar')
                         and i.exec_status in ('por_fazer', 'em_curso'))
      ) order by m.starts_at desc)
      from public.sec_meetings m left join public.teams t on t.id = m.team_id
      where m.section_id = p_section and m.space = v_space
        and (p_kind is null or m.kind = p_kind)
        and (p_team is null or m.team_id = p_team)
        and (p_event is null or m.cal_event_id = p_event)
        and (p_from is null or (m.starts_at at time zone 'Europe/Lisbon')::date >= p_from)
        and (p_to is null or (m.starts_at at time zone 'Europe/Lisbon')::date <= p_to)
        and (v_q is null or m.title ilike '%' || v_q || '%' or m.agenda ilike '%' || v_q || '%'
             or exists (select 1 from public.sec_minutes d join public.sec_minute_versions v on v.minute_id = d.id and v.version_no = d.current_version
                         where d.meeting_id = m.id and v.body ilike '%' || v_q || '%')
             or exists (select 1 from public.sec_items i where i.meeting_id = m.id and i.text ilike '%' || v_q || '%'))
        and private.sec_can_see_as(m.id, auth.uid())), '[]'::jsonb));
end
$$;

create or replace function public.sec_meeting(p_section uuid, p_meeting uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); m public.sec_meetings;
begin
  m := private.sec_meeting_get(p_section, v_space, p_meeting);
  return jsonb_build_object(
    'meeting', to_jsonb(m) || jsonb_build_object(
      'team_name', (select name from public.teams where id = m.team_id),
      'created_by_name', private.sec_name(m.created_by),
      'cal_event', private.sec_event_json(m.cal_event_id, p_section, v_space)),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('id', p.profile_id, 'name', private.sec_name(p.profile_id)) order by private.sec_name(p.profile_id))
                               from public.sec_participants p where p.meeting_id = m.id), '[]'::jsonb),
    'shares', coalesce((select jsonb_agg(jsonb_build_object('profile_id', s.profile_id, 'team_id', s.team_id,
                                  'name', coalesce(private.sec_name(s.profile_id), (select name from public.teams where id = s.team_id))))
                         from public.sec_shares s where s.meeting_id = m.id), '[]'::jsonb),
    'minutes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'status', d.status,
                                   'current_version', d.current_version, 'approved_version', d.approved_version, 'created_at', d.created_at)
                                 order by d.kind = 'aditamento', d.created_at)
                          from public.sec_minutes d where d.meeting_id = m.id), '[]'::jsonb),
    'summary', (select jsonb_build_object('id', s.id, 'status', s.status, 'current_version', s.current_version,
                         'published_version', s.published_version) from public.sec_summaries s where s.meeting_id = m.id),
    'items', coalesce((select jsonb_agg(private.sec_item_json(i) order by i.created_at) from public.sec_items i where i.meeting_id = m.id), '[]'::jsonb),
    'can_draft', private.sec_can_draft(m.id),
    'can_approve', private.sec_can_approve(m.id),
    'can_manage', private.sec_can_manage(m.id));
end
$$;

-- Atividades do calendário (mesma secção e espaço): para quem redige, aprova ou é dirigente.
create or replace function public.sec_event_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria');
begin
  if not (private.has_grant(p_section, 'secretaria.redigir') or private.has_grant(p_section, 'secretaria.aprovar')
          or private.is_dirigente(p_section)) then
    raise exception 'Não tens permissão para esta ação neste módulo.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title,
                     'starts_at', coalesce(e.starts_at, (e.start_date::timestamp + time '12:00') at time zone 'Europe/Lisbon'),
                     'all_day', e.all_day) order by coalesce(e.starts_at, e.start_date::timestamptz) desc)
                     from public.cal_events e
                    where e.section_id = p_section and e.space = v_space and e.status = 'ativo'
                      and coalesce(e.starts_at, e.start_date::timestamptz) > now() - interval '400 days'), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Registos da ata (decisões, tarefas, preparativos)
-- ---------------------------------------------------------------------------
drop function if exists public.sec_item_save(uuid, uuid, uuid, text, text, uuid, date, integer, uuid, uuid);
create or replace function public.sec_item_save(
  p_section uuid, p_item uuid, p_minute uuid, p_kind text, p_text text, p_responsible uuid, p_due date,
  p_reminder_days integer default 2, p_request uuid default null, p_stage_path uuid default null,
  p_team uuid default null, p_event uuid default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes; i public.sec_items;
        v_old public.sec_items; v_before uuid[] := '{}';
begin
  if p_item is not null then
    select * into v_old from public.sec_items where id = p_item and section_id = p_section and space = v_space for update;
    if v_old.id is null then raise exception 'Registo não encontrado.'; end if;
    d := private.sec_minute_get(p_section, v_space, v_old.minute_id, true);
    v_before := array_remove(private.sec_item_audience(v_old) || v_old.responsible_id, null);
  else
    d := private.sec_minute_get(p_section, v_space, p_minute, true);
  end if;
  perform private.sec_require_draft(d.meeting_id);
  if exists (select 1 from public.sec_meetings where id = d.meeting_id and status = 'anulada') then raise exception 'Esta reunião foi anulada.'; end if;
  if d.status <> 'rascunho' then
    raise exception 'As decisões só se alteram com a ata em rascunho. Numa ata aprovada, cria uma nova versão ou um aditamento.';
  end if;
  if p_kind is null or p_kind not in ('decisao', 'tarefa', 'preparar') then raise exception 'Escolhe se é decisão, tarefa ou preparativo.'; end if;
  if nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'Escreve a decisão, a tarefa ou o preparativo.'; end if;
  if length(trim(p_text)) > 2000 then raise exception 'O texto é demasiado longo (máximo 2000 caracteres).'; end if;
  if coalesce(p_reminder_days, 2) not between 0 and 60 then raise exception 'O lembrete tem de ser entre 0 e 60 dias antes do prazo.'; end if;
  if p_responsible is not null and not exists (select 1 from public.memberships where profile_id = p_responsible and section_id = p_section and status = 'ativo') then
    raise exception 'O responsável tem de ser um membro ativo da secção.';
  end if;
  if p_team is not null and not exists (select 1 from public.teams where id = p_team and section_id = p_section and archived_at is null) then
    raise exception 'Equipa não encontrada.';
  end if;
  if p_event is not null and not exists (select 1 from public.cal_events where id = p_event and section_id = p_section and space = v_space) then
    raise exception 'Atividade do calendário não encontrada.';
  end if;
  if p_request is not null and p_stage_path is not null then raise exception 'Liga a decisão a um pedido ou a uma etapa, não aos dois.'; end if;
  if p_request is not null and not exists (select 1 from public.trail_requests where id = p_request and section_id = p_section) then
    raise exception 'Pedido não encontrado.';
  end if;
  if p_stage_path is not null and not exists (select 1 from public.stage_paths sp join public.memberships ms on ms.id = sp.membership_id
                                                where sp.id = p_stage_path and ms.section_id = p_section) then
    raise exception 'Etapa não encontrada.';
  end if;

  if p_item is null then
    insert into public.sec_items (section_id, space, meeting_id, minute_id, kind, text, responsible_id, responsible_team_id, due_date,
                                  reminder_days, cal_event_id, trail_request_id, stage_path_id, created_by, updated_by)
    values (p_section, v_space, d.meeting_id, d.id, p_kind, trim(p_text), p_responsible,
            case when p_kind = 'decisao' then null else p_team end, p_due, coalesce(p_reminder_days, 2), p_event,
            p_request, p_stage_path, auth.uid(), auth.uid())
    returning * into i;
  else
    update public.sec_items set kind = p_kind, text = trim(p_text), responsible_id = p_responsible,
           responsible_team_id = case when p_kind = 'decisao' then null else p_team end, due_date = p_due,
           reminder_days = coalesce(p_reminder_days, 2), cal_event_id = p_event, trail_request_id = p_request, stage_path_id = p_stage_path,
           updated_by = auth.uid(), updated_at = now()
     where id = p_item returning * into i;
  end if;
  perform private.sec_item_log(v_old, i, 'Ata em rascunho.');
  perform private.sec_schedule_item(i);
  perform private.sec_notify_assigned(v_before, i);
  perform private.audit(p_section, case when p_item is null then 'sec_item_criado' else 'sec_item_alterado' end, 'sec_item', i.id::text,
    jsonb_build_object('kind', p_kind, 'responsible', p_responsible, 'team', p_team, 'due', p_due, 'event', p_event));
  return i.id;
end
$$;

-- Estado de execução: Por fazer, Em curso, Concluída (quem gere, o responsável ou alguém da
-- equipa responsável). Arquivar (cancelada) ou tirar do arquivo: só quem redige ou aprova.
create or replace function public.sec_item_set_status(p_section uuid, p_item uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); i public.sec_items; v_old public.sec_items;
        v_manage boolean; v_status text := case when p_status = 'feita' then 'concluida' else p_status end;
begin
  select * into v_old from public.sec_items where id = p_item and section_id = p_section and space = v_space for update;
  if v_old.id is null then raise exception 'Registo não encontrado.'; end if;
  v_manage := private.sec_can_manage(v_old.meeting_id);
  if not (v_manage or private.sec_concerns_as(v_old, auth.uid())) then
    if not private.sec_can_see(v_old.meeting_id) then raise exception 'Registo não encontrado.'; end if;
    raise exception 'Não tens permissão para mudar o estado desta tarefa.' using errcode = '42501';
  end if;
  if exists (select 1 from public.sec_meetings where id = v_old.meeting_id and status = 'anulada') then raise exception 'Esta reunião foi anulada.'; end if;
  if v_old.kind not in ('tarefa', 'preparar') then raise exception 'Só as tarefas e os preparativos têm estado.'; end if;
  if v_status is null or v_status not in ('por_fazer', 'em_curso', 'concluida', 'cancelada') then raise exception 'Estado inválido.'; end if;
  if (v_status = 'cancelada' or v_old.exec_status = 'cancelada') and v_status is distinct from v_old.exec_status and not v_manage then
    raise exception 'Só quem redige ou aprova pode arquivar uma tarefa ou tirá-la do arquivo.' using errcode = '42501';
  end if;
  if length(coalesce(p_note, '')) > 1000 then raise exception 'A nota é demasiado longa.'; end if;
  if v_status = v_old.exec_status then return; end if;
  update public.sec_items set exec_status = v_status, status_note = nullif(trim(coalesce(p_note, '')), ''),
         status_changed_by = auth.uid(), status_changed_at = now(),
         completed_at = case when v_status = 'concluida' then now() end,
         completed_by = case when v_status = 'concluida' then auth.uid() end
   where id = v_old.id returning * into i;
  perform private.sec_item_log(v_old, i, nullif(trim(coalesce(p_note, '')), ''));
  perform private.sec_schedule_item(i);
  perform private.audit(p_section, 'sec_item_estado', 'sec_item', i.id::text, jsonb_build_object('de', v_old.exec_status, 'para', v_status));
end
$$;

-- Gestão de uma tarefa no quadro (responsável, equipa, prazo, atividade), em qualquer altura.
-- Não altera a ata aprovada (a versão congelada guarda o que foi aprovado); fica no histórico.
create or replace function public.sec_task_update(
  p_section uuid, p_item uuid, p_responsible uuid, p_team uuid, p_due date, p_event uuid, p_note text default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); i public.sec_items; v_old public.sec_items; v_before uuid[];
begin
  select * into v_old from public.sec_items where id = p_item and section_id = p_section and space = v_space for update;
  if v_old.id is null or not private.sec_can_see(v_old.meeting_id) then raise exception 'Registo não encontrado.'; end if;
  if not private.sec_can_manage(v_old.meeting_id) then
    raise exception 'Não tens permissão para alterar esta tarefa.' using errcode = '42501';
  end if;
  if exists (select 1 from public.sec_meetings where id = v_old.meeting_id and status = 'anulada') then raise exception 'Esta reunião foi anulada.'; end if;
  if v_old.kind not in ('tarefa', 'preparar') then raise exception 'Só as tarefas e os preparativos estão no quadro.'; end if;
  if p_responsible is not null and not exists (select 1 from public.memberships where profile_id = p_responsible and section_id = p_section and status = 'ativo') then
    raise exception 'O responsável tem de ser um membro ativo da secção.';
  end if;
  if p_team is not null and not exists (select 1 from public.teams where id = p_team and section_id = p_section and archived_at is null) then
    raise exception 'Equipa não encontrada.';
  end if;
  if p_event is not null and not exists (select 1 from public.cal_events where id = p_event and section_id = p_section and space = v_space) then
    raise exception 'Atividade do calendário não encontrada.';
  end if;
  if length(coalesce(p_note, '')) > 1000 then raise exception 'A nota é demasiado longa.'; end if;
  v_before := private.sec_item_audience(v_old);
  update public.sec_items set responsible_id = p_responsible, responsible_team_id = p_team, due_date = p_due, cal_event_id = p_event,
         updated_by = auth.uid(), updated_at = now()
   where id = v_old.id returning * into i;
  perform private.sec_item_log(v_old, i, nullif(trim(coalesce(p_note, '')), ''));
  perform private.sec_schedule_item(i);
  perform private.sec_notify_assigned(v_before, i);
  perform private.audit(p_section, 'sec_tarefa_alterada', 'sec_item', i.id::text,
    jsonb_build_object('responsible', p_responsible, 'team', p_team, 'due', p_due, 'event', p_event));
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Quadro de tarefas, ficha da tarefa e «O que me diz respeito»
-- ---------------------------------------------------------------------------
create or replace function public.sec_board(
  p_section uuid, p_responsible uuid default null, p_team uuid default null, p_event uuid default null, p_archived boolean default false
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); v_me uuid := auth.uid();
begin
  return jsonb_build_object(
    'can_manage', private.has_grant(p_section, 'secretaria.redigir') or private.has_grant(p_section, 'secretaria.aprovar')
                  or private.is_dirigente(p_section),
    'tasks', coalesce((
      select jsonb_agg(private.sec_item_json(i) || jsonb_build_object(
               'meeting_title', m.title, 'meeting_starts_at', m.starts_at,
               'minute_kind', (select kind from public.sec_minutes where id = i.minute_id),
               'can_manage', private.sec_can_manage(m.id),
               'can_status', private.sec_can_manage(m.id) or private.sec_concerns_as(i, v_me))
             order by i.due_date nulls last, i.created_at)
        from public.sec_items i join public.sec_meetings m on m.id = i.meeting_id
       where i.section_id = p_section and i.space = v_space and m.status = 'ativa' and i.kind in ('tarefa', 'preparar')
         and (case when coalesce(p_archived, false) then i.exec_status = 'cancelada' else i.exec_status <> 'cancelada' end)
         and (p_responsible is null or i.responsible_id = p_responsible)
         and (p_team is null or i.responsible_team_id = p_team
              or exists (select 1 from public.memberships ms where ms.section_id = p_section and ms.profile_id = i.responsible_id
                          and ms.status = 'ativo' and ms.team_id = p_team))
         and (p_event is null or i.cal_event_id = p_event)
         and private.sec_can_see_as(m.id, v_me)), '[]'::jsonb),
    -- Atividades com tarefas visíveis (para o filtro).
    'events', coalesce((select jsonb_agg(x.ev order by x.ev ->> 'starts_at' desc) from (
                          select distinct private.sec_event_json(i.cal_event_id, p_section, v_space) ev
                            from public.sec_items i join public.sec_meetings m on m.id = i.meeting_id
                           where i.section_id = p_section and i.space = v_space and i.cal_event_id is not null
                             and m.status = 'ativa' and private.sec_can_see_as(m.id, v_me)) x where x.ev is not null), '[]'::jsonb));
end
$$;

create or replace function public.sec_task(p_section uuid, p_item uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); i public.sec_items; m public.sec_meetings;
        v_see boolean; v_pub jsonb;
begin
  select * into i from public.sec_items where id = p_item and section_id = p_section and space = v_space;
  if i.id is null then raise exception 'Registo não encontrado.'; end if;
  select * into m from public.sec_meetings where id = i.meeting_id;
  v_see := private.sec_can_see(m.id);
  if not v_see then
    -- Só o essencial, e só se lhe diz respeito e consta de um sumário publicado.
    if not private.sec_concerns_as(i, auth.uid()) or i.kind not in ('tarefa', 'preparar') then raise exception 'Registo não encontrado.'; end if;
    v_pub := private.sec_published_entry(i.id);
    return jsonb_build_object('limited', true,
      'task', jsonb_build_object('id', i.id, 'kind', i.kind, 'text', v_pub ->> 'text', 'due_date', i.due_date,
                'exec_status', i.exec_status, 'cal_event', private.sec_event_json(i.cal_event_id, p_section, v_space),
                'overdue', i.exec_status in ('por_fazer', 'em_curso') and coalesce(i.due_date < private.sec_today(), false)),
      'can_status', m.status = 'ativa', 'can_manage', false, 'history', '[]'::jsonb);
  end if;
  return jsonb_build_object('limited', false,
    'task', private.sec_item_json(i),
    'published_text', (private.sec_published_entry(i.id)) ->> 'text',
    'meeting', jsonb_build_object('id', m.id, 'title', m.title, 'kind', m.kind, 'starts_at', m.starts_at, 'status', m.status),
    'minute', (select jsonb_build_object('id', d.id, 'kind', d.kind, 'status', d.status) from public.sec_minutes d where d.id = i.minute_id),
    'can_manage', private.sec_can_manage(m.id) and m.status = 'ativa' and i.kind in ('tarefa', 'preparar'),
    'can_status', m.status = 'ativa' and i.kind in ('tarefa', 'preparar') and (private.sec_can_manage(m.id) or private.sec_concerns_as(i, auth.uid())),
    'history', coalesce((select jsonb_agg(jsonb_build_object('field', h.field,
                            'from', private.sec_history_label(h.field, h.from_value, p_section, v_space),
                            'to', private.sec_history_label(h.field, h.to_value, p_section, v_space),
                            'note', h.note, 'by', private.sec_name(h.changed_by), 'at', h.changed_at) order by h.changed_at desc, h.id)
                          from public.sec_item_history h where h.item_id = i.id), '[]'::jsonb));
end
$$;

-- «O que me diz respeito»: tarefas e preparativos atribuídos à pessoa ou à sua equipa.
-- Reuniões que a pessoa não vê: só pontos de sumários publicados, só título revisto, prazo,
-- estado e atividade. Nunca decisões, texto da ata ou o nome de reuniões reservadas.
create or replace function public.sec_my_tasks(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); v_me uuid := auth.uid();
        v_team uuid := private.sec_my_team(p_section, auth.uid());
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'kind', x.kind, 'text', x.title, 'due_date', x.due_date, 'exec_status', x.exec_status,
             'overdue', x.exec_status in ('por_fazer', 'em_curso') and coalesce(x.due_date < private.sec_today(), false),
             'via', case when x.responsible_id = v_me then 'pessoal' else 'equipa' end,
             'team_name', case when x.responsible_id is distinct from v_me then (select name from public.teams where id = x.responsible_team_id) end,
             'cal_event', private.sec_event_json(x.cal_event_id, p_section, v_space),
             'published', x.pub is not null,
             'meeting_id', case when x.see then x.meeting_id end,
             'meeting_title', case when x.see then x.meeting_title end)
           order by x.exec_status = 'concluida', x.due_date nulls last, x.created_at)
      from (
        select i.*, m.title as meeting_title, s.see, s.pub,
               coalesce(s.pub ->> 'text', case when s.see then i.text end) as title
          from public.sec_items i join public.sec_meetings m on m.id = i.meeting_id
          cross join lateral (select private.sec_can_see_as(m.id, v_me) as see, private.sec_published_entry(i.id) as pub) s
         where i.section_id = p_section and i.space = v_space and m.status = 'ativa'
           and i.kind in ('tarefa', 'preparar') and i.exec_status <> 'cancelada'
           and (i.responsible_id = v_me or (v_team is not null and i.responsible_team_id = v_team))
      ) x
     where x.see or x.pub is not null), '[]'::jsonb);
end
$$;

-- Integração (para quem coordena o Calendário): tarefas visíveis ao utilizador atual ligadas a
-- uma atividade. Devolve '[]' se a pessoa não tiver o módulo nesse espaço.
create or replace function private.sec_tasks_for_event(p_section uuid, p_space text, p_event uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select case when private.module_space(p_section, 'secretaria') is distinct from p_space then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'kind', x.kind, 'title', x.title, 'exec_status', x.exec_status, 'due_date', x.due_date,
             'overdue', x.exec_status in ('por_fazer', 'em_curso') and coalesce(x.due_date < private.sec_today(), false),
             'responsible_name', private.sec_name(x.responsible_id),
             'team_name', (select name from public.teams where id = x.responsible_team_id),
             'meeting_id', case when x.see then x.meeting_id end)
           order by x.due_date nulls last, x.created_at)
      from (
        select i.*, s.see, coalesce(s.pub ->> 'text', case when s.see then i.text end) as title
          from public.sec_items i join public.sec_meetings m on m.id = i.meeting_id
          cross join lateral (select private.sec_can_see_as(m.id, auth.uid()) as see, private.sec_published_entry(i.id) as pub) s
         where i.section_id = p_section and i.space = p_space and i.cal_event_id = p_event and m.status = 'ativa'
           and i.kind in ('tarefa', 'preparar') and i.exec_status <> 'cancelada'
           and (s.see or private.sec_concerns_as(i, auth.uid()))
      ) x where x.title is not null), '[]'::jsonb) end
$$;

-- ---------------------------------------------------------------------------
-- 8. Sumário: preparar, rever, publicar, nova versão
-- ---------------------------------------------------------------------------
create or replace function private.sec_prefill_entry(i public.sec_items)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object('item_id', i.id, 'kind', i.kind, 'text', i.text,
    'responsible_id', case when i.kind <> 'decisao' then i.responsible_id end,
    'team_id', case when i.kind <> 'decisao' then i.responsible_team_id end,
    'due_date', case when i.kind <> 'decisao' then i.due_date end,
    'cal_event_id', case when i.kind <> 'decisao' then i.cal_event_id end,
    'omitted', false)
$$;

-- Acrescenta nomes (pessoa, equipa) e a atividade (só do mesmo espaço) a cada ponto.
create or replace function private.sec_summary_enrich(p_content jsonb, p_section uuid, p_space text, p_names boolean)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('entries', coalesce((
    select jsonb_agg(e
             || case when p_names then jsonb_build_object(
                  'responsible_name', private.sec_name(nullif(e ->> 'responsible_id', '')::uuid),
                  'team_name', (select name from public.teams where id = nullif(e ->> 'team_id', '')::uuid)) else '{}'::jsonb end
             || jsonb_build_object('cal_event', private.sec_event_json(nullif(e ->> 'cal_event_id', '')::uuid, p_section, p_space))
           order by n)
      from jsonb_array_elements(coalesce(p_content -> 'entries', '[]'::jsonb)) with ordinality t(e, n)), '[]'::jsonb))
$$;

create or replace function private.sec_summary_get(p_section uuid, p_space text, p_summary uuid, p_lock boolean default false)
returns public.sec_summaries language plpgsql security definer set search_path = ''
as $$
declare s public.sec_summaries;
begin
  if p_lock then
    select * into s from public.sec_summaries where id = p_summary and section_id = p_section and space = p_space for update;
  else
    select * into s from public.sec_summaries where id = p_summary and section_id = p_section and space = p_space;
  end if;
  if s.id is null or not private.sec_can_see(s.meeting_id) then raise exception 'Registo não encontrado.'; end if;
  return s;
end
$$;

-- Cria o rascunho pré-preenchido com o que está na ata (ou, num rascunho existente,
-- acrescenta os registos da ata que ainda lá não estão). Nada é inventado.
create or replace function public.sec_summary_prepare(p_section uuid, p_meeting uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); m public.sec_meetings; s public.sec_summaries;
        v_entries jsonb;
begin
  m := private.sec_meeting_get(p_section, v_space, p_meeting, true);
  if not private.sec_can_manage(m.id) then
    raise exception 'Não tens permissão para preparar o sumário desta reunião.' using errcode = '42501';
  end if;
  if m.status = 'anulada' then raise exception 'Esta reunião foi anulada.'; end if;
  if not exists (select 1 from public.sec_minutes where meeting_id = m.id and kind = 'ata') then
    raise exception 'Cria primeiro a ata da reunião.';
  end if;
  select * into s from public.sec_summaries where meeting_id = m.id for update;
  if s.id is null then
    insert into public.sec_summaries (section_id, space, meeting_id, created_by, updated_by)
    values (p_section, v_space, m.id, auth.uid(), auth.uid()) returning * into s;
    insert into public.sec_summary_versions (summary_id, section_id, space, version_no, content, note, created_by, updated_by)
    values (s.id, p_section, v_space, 1,
            jsonb_build_object('entries', coalesce((select jsonb_agg(private.sec_prefill_entry(i) order by i.created_at)
                                                       from public.sec_items i where i.meeting_id = m.id), '[]'::jsonb)),
            'Preparado a partir da ata.', auth.uid(), auth.uid());
    perform private.audit(p_section, 'sec_sumario_preparado', 'sec_summary', s.id::text, jsonb_build_object('meeting', m.id));
    return s.id;
  end if;
  if s.status = 'publicado' then
    raise exception 'O sumário está publicado e não muda. Para o rever, cria uma nova versão.';
  end if;
  select content -> 'entries' into v_entries from public.sec_summary_versions where summary_id = s.id and version_no = s.current_version;
  update public.sec_summary_versions
     set content = jsonb_build_object('entries', coalesce(v_entries, '[]'::jsonb) || coalesce((
           select jsonb_agg(private.sec_prefill_entry(i) order by i.created_at) from public.sec_items i
            where i.meeting_id = m.id
              and not exists (select 1 from jsonb_array_elements(coalesce(v_entries, '[]'::jsonb)) e where e ->> 'item_id' = i.id::text)), '[]'::jsonb)),
         updated_by = auth.uid(), updated_at = now()
   where summary_id = s.id and version_no = s.current_version;
  update public.sec_summaries set updated_by = auth.uid(), updated_at = now() where id = s.id;
  return s.id;
end
$$;

-- Guarda a revisão do rascunho. Só pontos que constam da ata; o que não está definido fica por definir.
create or replace function public.sec_summary_save(p_section uuid, p_summary uuid, p_entries jsonb, p_expected_version integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); s public.sec_summaries; e jsonb; i public.sec_items;
        v_out jsonb := '[]'::jsonb; v_seen uuid[] := '{}'; v_text text; v_resp uuid; v_team uuid; v_due date; v_ev uuid;
begin
  s := private.sec_summary_get(p_section, v_space, p_summary, true);
  if not private.sec_can_manage(s.meeting_id) then
    raise exception 'Não tens permissão para rever este sumário.' using errcode = '42501';
  end if;
  if exists (select 1 from public.sec_meetings where id = s.meeting_id and status = 'anulada') then raise exception 'Esta reunião foi anulada.'; end if;
  if s.status = 'publicado' then raise exception 'O sumário publicado não pode ser alterado. Cria uma nova versão.'; end if;
  if p_expected_version is distinct from s.current_version then raise exception 'O sumário mudou entretanto. Atualiza a página.'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then raise exception 'Conteúdo do sumário inválido.'; end if;
  if jsonb_array_length(p_entries) > 500 then raise exception 'O sumário tem demasiados pontos.'; end if;
  for e in select x from jsonb_array_elements(p_entries) x loop
    select * into i from public.sec_items where id = nullif(e ->> 'item_id', '')::uuid and meeting_id = s.meeting_id;
    if i.id is null then raise exception 'O sumário só pode ter pontos que constam da ata.'; end if;
    if i.id = any (v_seen) then raise exception 'Há pontos repetidos no sumário.'; end if;
    v_seen := v_seen || i.id;
    v_text := trim(coalesce(e ->> 'text', ''));
    if v_text = '' then raise exception 'Escreve o texto de cada ponto do sumário.'; end if;
    if length(v_text) > 2000 then raise exception 'O texto de um ponto é demasiado longo (máximo 2000 caracteres).'; end if;
    v_resp := null; v_team := null; v_due := null; v_ev := null;
    if i.kind <> 'decisao' then
      v_resp := nullif(e ->> 'responsible_id', '')::uuid;
      v_team := nullif(e ->> 'team_id', '')::uuid;
      v_due := nullif(e ->> 'due_date', '')::date;
      v_ev := nullif(e ->> 'cal_event_id', '')::uuid;
      if v_resp is not null and not exists (select 1 from public.memberships where profile_id = v_resp and section_id = p_section and status = 'ativo') then
        raise exception 'O responsável tem de ser um membro ativo da secção.';
      end if;
      if v_team is not null and not exists (select 1 from public.teams where id = v_team and section_id = p_section and archived_at is null) then
        raise exception 'Equipa não encontrada.';
      end if;
      if v_ev is not null and not exists (select 1 from public.cal_events where id = v_ev and section_id = p_section and space = v_space) then
        raise exception 'Atividade do calendário não encontrada.';
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('item_id', i.id, 'kind', i.kind, 'text', v_text,
               'responsible_id', v_resp, 'team_id', v_team, 'due_date', v_due, 'cal_event_id', v_ev,
               'omitted', coalesce((e ->> 'omitted')::boolean, false)));
  end loop;
  update public.sec_summary_versions set content = jsonb_build_object('entries', v_out), updated_by = auth.uid(), updated_at = now()
   where summary_id = s.id and version_no = s.current_version;
  update public.sec_summaries set updated_by = auth.uid(), updated_at = now() where id = s.id;
end
$$;

-- Publicar (passo explícito de quem aprova; exige a ata aprovada). A versão fica fechada;
-- os responsáveis/prazos/atividades revistos passam para o quadro; avisos internos genéricos.
create or replace function public.sec_summary_publish(p_section uuid, p_summary uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); s public.sec_summaries; v public.sec_summary_versions;
        e jsonb; i public.sec_items; v_old public.sec_items; v_assignees uuid[] := '{}'; v_viewers uuid[];
        v_before uuid[] := '{}';
begin
  s := private.sec_summary_get(p_section, v_space, p_summary, true);
  if not private.sec_can_approve(s.meeting_id) then
    raise exception 'Não tens permissão para publicar este sumário.' using errcode = '42501';
  end if;
  if exists (select 1 from public.sec_meetings where id = s.meeting_id and status = 'anulada') then raise exception 'Esta reunião foi anulada.'; end if;
  if s.status = 'publicado' then raise exception 'Esta versão do sumário já está publicada.'; end if;
  if p_expected_version is distinct from s.current_version then raise exception 'O sumário mudou entretanto. Atualiza a página.'; end if;
  if not exists (select 1 from public.sec_minutes where meeting_id = s.meeting_id and kind = 'ata' and approved_version is not null) then
    raise exception 'Aprova a ata antes de publicar o sumário.';
  end if;
  select * into v from public.sec_summary_versions where summary_id = s.id and version_no = s.current_version;
  if not exists (select 1 from jsonb_array_elements(v.content -> 'entries') x where not coalesce((x ->> 'omitted')::boolean, false)) then
    raise exception 'O sumário está vazio: inclui pelo menos um ponto.';
  end if;
  -- Quem já tinha estas tarefas (antes desta publicação), para não repetir avisos a mais.
  for e in select x from jsonb_array_elements(v.content -> 'entries') x
            where x ->> 'kind' in ('tarefa', 'preparar') and not coalesce((x ->> 'omitted')::boolean, false) loop
    select * into v_old from public.sec_items where id = (e ->> 'item_id')::uuid and meeting_id = s.meeting_id for update;
    if v_old.id is null then continue; end if;
    v_before := v_before || private.sec_item_audience(v_old);
    update public.sec_items set responsible_id = nullif(e ->> 'responsible_id', '')::uuid,
           responsible_team_id = nullif(e ->> 'team_id', '')::uuid, due_date = nullif(e ->> 'due_date', '')::date,
           cal_event_id = nullif(e ->> 'cal_event_id', '')::uuid, updated_by = auth.uid(), updated_at = now()
     where id = v_old.id
       and (responsible_id, responsible_team_id, due_date, cal_event_id) is distinct from
           (nullif(e ->> 'responsible_id', '')::uuid, nullif(e ->> 'team_id', '')::uuid, nullif(e ->> 'due_date', '')::date, nullif(e ->> 'cal_event_id', '')::uuid)
    returning * into i;
    if found then
      perform private.sec_item_log(v_old, i, 'Definido no sumário publicado (versão ' || s.current_version || ').');
    end if;
  end loop;
  update public.sec_summary_versions
     set content = private.sec_summary_enrich(v.content, p_section, v_space, true), published_at = now(), published_by = auth.uid()
   where id = v.id;
  update public.sec_summaries set status = 'publicado', published_version = s.current_version, updated_by = auth.uid(), updated_at = now()
   where id = s.id;
  -- Agora publicado: lembretes e destinatários (inclui quem só conhece a tarefa pelo sumário).
  for i in select it.* from public.sec_items it
            where it.meeting_id = s.meeting_id and it.kind in ('tarefa', 'preparar')
              and exists (select 1 from jsonb_array_elements(v.content -> 'entries') x
                           where x ->> 'item_id' = it.id::text and not coalesce((x ->> 'omitted')::boolean, false)) loop
    perform private.sec_schedule_item(i);
    v_assignees := v_assignees || private.sec_item_audience(i);
  end loop;
  select coalesce(array_agg(distinct x), '{}') into v_assignees from unnest(v_assignees) x;
  select coalesce(array_agg(ms.profile_id), '{}') into v_viewers from public.memberships ms
   where ms.section_id = p_section and ms.status = 'ativo' and not (ms.profile_id = any (v_assignees))
     and private.sec_can_see_as(s.meeting_id, ms.profile_id);
  perform private.module_notify(p_section, 'secretaria', v_space, v_assignees, 'sec_tarefa',
    'Tarefas atribuídas', 'Tens tarefas ou preparativos atribuídos em Reuniões e tarefas.', '/reunioes-e-tarefas/o-que-me-diz-respeito');
  perform private.module_notify(p_section, 'secretaria', v_space, v_viewers, 'sec_sumario',
    'Sumário publicado', 'Foi publicado o sumário de uma reunião.', '/reunioes-e-tarefas/reunioes/' || s.meeting_id || '/sumario');
  perform private.audit(p_section, 'sec_sumario_publicado', 'sec_summary', s.id::text, jsonb_build_object('versao', s.current_version));
end
$$;

-- Rever um sumário publicado: nova versão em rascunho (com motivo). A publicada continua em
-- vigor e visível até a nova ser publicada.
create or replace function public.sec_summary_revise(p_section uuid, p_summary uuid, p_reason text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); s public.sec_summaries; v public.sec_summary_versions;
begin
  s := private.sec_summary_get(p_section, v_space, p_summary, true);
  if not private.sec_can_manage(s.meeting_id) then
    raise exception 'Não tens permissão para rever este sumário.' using errcode = '42501';
  end if;
  if exists (select 1 from public.sec_meetings where id = s.meeting_id and status = 'anulada') then raise exception 'Esta reunião foi anulada.'; end if;
  if s.status <> 'publicado' then raise exception 'Só um sumário publicado precisa de nova versão.'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Indica o motivo da revisão.'; end if;
  if length(p_reason) > 1000 then raise exception 'O motivo é demasiado longo.'; end if;
  select * into v from public.sec_summary_versions where summary_id = s.id and version_no = s.current_version;
  insert into public.sec_summary_versions (summary_id, section_id, space, version_no, content, note, created_by, updated_by)
  values (s.id, p_section, v_space, s.current_version + 1,
          jsonb_build_object('entries', coalesce((select jsonb_agg(e - 'responsible_name' - 'team_name' - 'cal_event' order by n)
                                                     from jsonb_array_elements(v.content -> 'entries') with ordinality t(e, n)), '[]'::jsonb)),
          'Revisão: ' || trim(p_reason), auth.uid(), auth.uid());
  update public.sec_summaries set status = 'rascunho', current_version = s.current_version + 1, updated_by = auth.uid(), updated_at = now()
   where id = s.id;
  perform private.audit(p_section, 'sec_sumario_revisao', 'sec_summary', s.id::text,
    jsonb_build_object('versao_publicada', s.published_version, 'nova_versao', s.current_version + 1, 'motivo', trim(p_reason)));
  return s.current_version + 1;
end
$$;

-- Sumário de uma reunião (mesma visibilidade da reunião), com versões.
create or replace function public.sec_summary(p_section uuid, p_meeting uuid, p_version integer default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); m public.sec_meetings; s public.sec_summaries;
        v public.sec_summary_versions; ata public.sec_minutes; v_manage boolean; v_active boolean; v_content jsonb;
begin
  m := private.sec_meeting_get(p_section, v_space, p_meeting);
  select * into s from public.sec_summaries where meeting_id = m.id;
  select * into ata from public.sec_minutes where meeting_id = m.id and kind = 'ata';
  v_manage := private.sec_can_manage(m.id);
  v_active := m.status = 'ativa';
  -- Quem não redige nem aprova só vê versões publicadas (o rascunho ainda não foi revisto).
  if s.id is not null then
    if p_version is not null then
      select * into v from public.sec_summary_versions where summary_id = s.id and version_no = p_version
         and (v_manage or published_at is not null);
      if v.id is null then raise exception 'Registo não encontrado.'; end if;
    else
      select * into v from public.sec_summary_versions where summary_id = s.id
         and version_no = case when v_manage then s.current_version else s.published_version end;
    end if;
    if v.id is not null then v_content := private.sec_summary_enrich(v.content, p_section, v_space, v.published_at is null); end if;
  end if;
  return jsonb_build_object(
    'meeting', jsonb_build_object('id', m.id, 'title', m.title, 'kind', m.kind, 'starts_at', m.starts_at, 'status', m.status,
                 'team_name', (select name from public.teams where id = m.team_id),
                 'cal_event', private.sec_event_json(m.cal_event_id, p_section, v_space)),
    'ata', case when ata.id is not null then jsonb_build_object('id', ata.id, 'status', ata.status, 'approved_version', ata.approved_version) end,
    'test', v_space = 'teste',
    'summary', case when s.id is not null then jsonb_build_object('id', s.id, 'status', s.status, 'current_version', s.current_version,
                 'published_version', s.published_version) end,
    'version', case when v.id is not null then jsonb_build_object('version_no', v.version_no, 'note', v.note, 'content', v_content,
                 'published', v.published_at is not null, 'published_at', v.published_at, 'published_by_name', private.sec_name(v.published_by),
                 'created_by_name', private.sec_name(v.created_by), 'created_at', v.created_at, 'updated_at', v.updated_at) end,
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version_no', x.version_no, 'note', x.note, 'created_at', x.created_at,
                    'created_by_name', private.sec_name(x.created_by), 'published_at', x.published_at,
                    'published_by_name', private.sec_name(x.published_by)) order by x.version_no desc)
                  from public.sec_summary_versions x where x.summary_id = s.id and (v_manage or x.published_at is not null)), '[]'::jsonb),
    -- Registos da ata que ainda não estão no rascunho (para «Atualizar a partir da ata»).
    'missing_items', case when v_manage and s.id is not null and s.status = 'rascunho' then (
                       select count(*) from public.sec_items i where i.meeting_id = m.id
                          and not exists (select 1 from public.sec_summary_versions x cross join lateral jsonb_array_elements(x.content -> 'entries') e
                                           where x.summary_id = s.id and x.version_no = s.current_version and e ->> 'item_id' = i.id::text)) else 0 end,
    'item_status', coalesce((select jsonb_object_agg(i.id, i.exec_status) from public.sec_items i where i.meeting_id = m.id), '{}'::jsonb),
    'can_manage', v_manage,
    'can_prepare', v_manage and v_active and ata.id is not null and (s.id is null or s.status = 'rascunho'),
    'can_edit', v_manage and v_active and s.id is not null and s.status = 'rascunho' and v.version_no = s.current_version,
    'can_publish', private.sec_can_approve(m.id) and v_active and s.id is not null and s.status = 'rascunho'
                   and v.version_no = s.current_version and ata.approved_version is not null,
    'can_revise', v_manage and v_active and s.id is not null and s.status = 'publicado');
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- O envio de lembretes continua reservado ao agendador.
revoke execute on function public.process_due_reminders() from authenticated;


-- ===== 20261022000700_presencas.sql =====
-- Pioneiros — módulo «Presenças» (prefixo pres_): sessões (reuniões ou atividades),
-- registos de presença, histórico de correções e indicadores de assiduidade.
--
-- Regras:
-- • Sessão: data, título, tipo (reunião/atividade), público (secção ou uma equipa),
--   ligação opcional a uma atividade do Calendário do MESMO espaço (uma atividade só pode
--   ter uma sessão). Uma sessão cancelada (ou ligada a uma atividade cancelada) não conta.
-- • Estados: presente, falta justificada, falta injustificada; «por registar» = sem
--   registo (ou registo desfeito). Participação parcial só com «presente» (conta como
--   presença e é indicada à parte).
-- • Aplicabilidade (quem conta numa sessão), reconstruída à data da sessão a partir do
--   histórico dos membros (membership_history):
--     – só pioneiros e guias (dirigentes e administração técnica não contam);
--     – ativo na secção nessa data: entrou (aprovado) ou tem adesão registada até essa
--       data e não tinha saído nem estava suspenso (no dia da saída já não conta);
--     – sessão de equipa: pertencia a essa equipa nessa data (equipa registada no
--       histórico; sem histórico, a equipa atual).
-- • Taxa de assiduidade = Presenças ÷ (Presenças + Faltas justificadas + Faltas
--   injustificadas) × 100, só com sessões até hoje, não canceladas, aplicáveis ao membro
--   e com registo. Sem registos contados: sem taxa (null), nunca 0 %.
-- • Registam e corrigem: dirigentes e quem tem «presencas.registar». Os restantes com
--   acesso veem só as próprias presenças e taxa. As justificações só são visíveis para
--   quem regista e para o próprio. Correções ficam em pres_record_history (nunca se apaga).
-- • Sem rankings: listas ordenadas por equipa e nome.
-- Aditivo: tabelas novas; não altera dados existentes.

create table if not exists public.pres_sessions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  session_date date not null,
  title text not null check (length(trim(title)) between 1 and 200),
  kind text not null default 'reuniao' check (kind in ('reuniao', 'atividade')),
  audience text not null default 'seccao' check (audience in ('seccao', 'equipa')),
  team_id uuid references public.teams (id),
  cal_event_id uuid references public.cal_events (id) on delete set null,
  notes text check (notes is null or length(notes) <= 1000),
  status text not null default 'ativa' check (status in ('ativa', 'cancelada')),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 300),
  cancelled_at timestamptz,
  cancelled_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check ((audience = 'equipa') = (team_id is not null))
);
create index if not exists pres_sessions_section on public.pres_sessions (section_id, space, session_date);
-- Uma atividade do Calendário só pode ter uma sessão de presenças.
create unique index if not exists pres_sessions_cal_event on public.pres_sessions (cal_event_id) where cal_event_id is not null;
alter table public.pres_sessions enable row level security;

create table if not exists public.pres_records (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  session_id uuid not null references public.pres_sessions (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  status text check (status in ('presente', 'justificada', 'injustificada')),
  partial boolean not null default false,
  partial_note text check (partial_note is null or length(partial_note) <= 200),
  justification text check (justification is null or length(justification) <= 500),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (session_id, membership_id),
  check (not partial or status = 'presente'),
  check (partial_note is null or partial),
  check (justification is null or status in ('justificada', 'injustificada'))
);
create index if not exists pres_records_section on public.pres_records (section_id, space);
create index if not exists pres_records_membership on public.pres_records (membership_id);
alter table public.pres_records enable row level security;

-- Histórico de correções (cada alteração de um registo; nunca se apaga).
create table if not exists public.pres_record_history (
  id bigint generated always as identity primary key,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  record_id uuid not null references public.pres_records (id) on delete cascade,
  session_id uuid not null,
  membership_id uuid not null,
  old_status text,
  new_status text,
  old_partial boolean,
  new_partial boolean,
  old_partial_note text,
  new_partial_note text,
  old_justification text,
  new_justification text,
  reason text check (reason is null or length(reason) <= 300),
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists pres_record_history_record on public.pres_record_history (record_id, changed_at);
create index if not exists pres_record_history_member on public.pres_record_history (membership_id, changed_at);
create index if not exists pres_record_history_session on public.pres_record_history (session_id, changed_at);
alter table public.pres_record_history enable row level security;

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
create or replace function private.pres_today()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'Europe/Lisbon')::date $$;

create or replace function private.pres_can_register(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.module_can(p_section, 'presencas', 'presencas.registar', true) $$;

create or replace function private.pres_session_of(p_section uuid, p_space text, p_session uuid, p_lock boolean default false)
returns public.pres_sessions language plpgsql security definer set search_path = ''
as $$
declare s public.pres_sessions;
begin
  if p_lock then
    select * into s from public.pres_sessions where id = p_session and section_id = p_section and space = p_space for update;
  else
    select * into s from public.pres_sessions where id = p_session and section_id = p_section and space = p_space;
  end if;
  if s.id is null then raise exception 'Registo não encontrado.'; end if;
  return s;
end
$$;

-- Cancelada por si ou pela atividade do Calendário a que está ligada.
create or replace function private.pres_is_cancelled(p_session uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select s.status = 'cancelada' or coalesce(e.status = 'cancelado', false)
    from public.pres_sessions s left join public.cal_events e on e.id = s.cal_event_id
   where s.id = p_session
$$;

-- Pares (sessão, membro) em que o membro conta, com a equipa do membro nessa data.
create or replace function private.pres_applicable(p_section uuid, p_space text, p_from date, p_to date)
returns table (session_id uuid, session_date date, membership_id uuid, team_id uuid)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.session_date, m.id, x.team_id
    from public.pres_sessions s
    join public.memberships m on m.section_id = s.section_id
    left join public.adhesions a on a.membership_id = m.id
    left join lateral (
      select h.new_status, h.new_function, h.new_team_id
        from public.membership_history h
       where h.membership_id = m.id and (h.changed_at at time zone 'Europe/Lisbon')::date <= s.session_date
       order by h.changed_at desc, h.id desc
       limit 1
    ) hs on true
    cross join lateral (
      select
        case when hs.new_status = 'ativo' then hs.new_team_id
             when hs.new_status is null or hs.new_status = 'pendente' then m.team_id end as team_id,
        coalesce(hs.new_function, m.function) as func,
        case
          when hs.new_status = 'ativo' then true
          when hs.new_status in ('saiu', 'suspenso') then false
          -- Adesão registada antes de a entrada constar na aplicação.
          when a.decided_on is not null and a.decided_on <= s.session_date
               and not exists (select 1 from public.membership_history h2
                                where h2.membership_id = m.id and h2.new_status in ('saiu', 'suspenso')
                                  and (h2.changed_at at time zone 'Europe/Lisbon')::date <= s.session_date) then true
          -- Sem histórico (registos antigos): estado atual e data de aprovação.
          when hs.new_status is null and m.status = 'ativo'
               and not exists (select 1 from public.membership_history h3 where h3.membership_id = m.id)
               and (coalesce(m.approved_at, m.requested_at) at time zone 'Europe/Lisbon')::date <= s.session_date then true
          else false end as active
    ) x
   where s.section_id = p_section and s.space = p_space
     and s.session_date between p_from and p_to
     and x.active and x.func in ('pioneiro', 'guia')
     and (s.audience = 'seccao' or x.team_id = s.team_id)
$$;

-- Células aplicáveis com a categoria que conta para os indicadores.
create or replace function private.pres_cells(p_section uuid, p_space text, p_from date, p_to date)
returns table (session_id uuid, session_date date, membership_id uuid, team_id uuid, status text, partial boolean,
               partial_note text, justification text, category text)
language sql stable security definer set search_path = ''
as $$
  select a.session_id, a.session_date, a.membership_id, a.team_id, r.status, coalesce(r.partial, false), r.partial_note,
         r.justification,
         case when s.status = 'cancelada' or coalesce(e.status = 'cancelado', false) then 'cancelada'
              when a.session_date > private.pres_today() then 'futura'
              when r.status is null then 'por_registar'
              else r.status end
    from private.pres_applicable(p_section, p_space, p_from, p_to) a
    join public.pres_sessions s on s.id = a.session_id
    left join public.cal_events e on e.id = s.cal_event_id
    left join public.pres_records r on r.session_id = a.session_id and r.membership_id = a.membership_id
$$;

-- Indicadores a partir das contagens. Taxa = presenças ÷ (presenças + faltas) × 100.
create or replace function private.pres_stats(p_pres bigint, p_parc bigint, p_just bigint, p_injust bigint,
                                              p_porreg bigint, p_fut bigint, p_canc bigint)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'presencas', p_pres, 'parciais', p_parc, 'justificadas', p_just, 'injustificadas', p_injust,
    'faltas', p_just + p_injust, 'contadas', p_pres + p_just + p_injust,
    'por_registar', p_porreg, 'futuras', p_fut, 'canceladas', p_canc,
    'taxa', case when p_pres + p_just + p_injust = 0 then null
                 else round(100.0 * p_pres / (p_pres + p_just + p_injust), 1) end)
$$;

-- Data a partir da qual o membro conta (entrada ou adesão, a mais antiga).
create or replace function private.pres_entry_date(p_membership uuid)
returns date language sql stable security definer set search_path = ''
as $$
  select nullif(least(
    coalesce((select min((h.changed_at at time zone 'Europe/Lisbon')::date) from public.membership_history h
               where h.membership_id = p_membership and h.new_status = 'ativo'), 'infinity'::date),
    coalesce((select a.decided_on from public.adhesions a where a.membership_id = p_membership), 'infinity'::date),
    coalesce((select (coalesce(m.approved_at, m.requested_at) at time zone 'Europe/Lisbon')::date from public.memberships m
               where m.id = p_membership and m.status = 'ativo'
                 and not exists (select 1 from public.membership_history h where h.membership_id = m.id)), 'infinity'::date)
  ), 'infinity'::date)
$$;

-- ---------------------------------------------------------------------------
-- Leitura
-- ---------------------------------------------------------------------------

-- Quadro: sessões do período, membros, células e indicadores. Quem não regista recebe
-- apenas as próprias presenças (sem resumos de outros membros).
create or replace function public.pres_board(p_section uuid, p_from date, p_to date, p_team uuid default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'presencas');
  v_reg boolean := private.pres_can_register(p_section);
  v_me uuid := (select id from public.memberships where section_id = p_section and profile_id = auth.uid());
  v_team uuid := case when private.pres_can_register(p_section) then p_team end;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Indica um período válido.'; end if;
  if p_to - p_from > 800 then raise exception 'Escolhe um período até dois anos.'; end if;
  return (
    with c as materialized (
      select * from private.pres_cells(p_section, v_space, p_from, p_to) x
       where (v_reg or x.membership_id = v_me) and (v_team is null or x.team_id = v_team)
    ),
    ses as (
      select s.*, t.name as team_name, e.title as cal_title, e.status as cal_status
        from public.pres_sessions s
        left join public.teams t on t.id = s.team_id
        left join public.cal_events e on e.id = s.cal_event_id
       where s.section_id = p_section and s.space = v_space and s.session_date between p_from and p_to
         and (case when v_reg then (v_team is null or s.audience = 'seccao' or s.team_id = v_team)
                   else exists (select 1 from c where c.session_id = s.id) end)
    ),
    mem as (
      select m.id, m.status, m.team_id, p.full_name, t.name as team_name
        from public.memberships m
        join public.profiles p on p.id = m.profile_id
        left join public.teams t on t.id = m.team_id
       where m.section_id = p_section
         and (m.id in (select c.membership_id from c)
              or (v_reg and m.status = 'ativo' and m.function in ('pioneiro', 'guia') and (v_team is null or m.team_id = v_team)))
    )
    select jsonb_build_object(
      'can_register', v_reg,
      'today', private.pres_today(),
      'my_membership', v_me,
      'teams', case when v_reg then coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                                               from public.teams t where t.section_id = p_section and t.archived_at is null), '[]'::jsonb)
                    else '[]'::jsonb end,
      'sessions', coalesce((select jsonb_agg(jsonb_build_object(
          'id', s.id, 'date', s.session_date, 'title', s.title, 'kind', s.kind, 'audience', s.audience,
          'team_id', s.team_id, 'team_name', s.team_name, 'cal_event_id', s.cal_event_id, 'cal_title', s.cal_title,
          'status', case when s.status = 'cancelada' or s.cal_status = 'cancelado' then 'cancelada' else 'ativa' end,
          'future', s.session_date > private.pres_today(),
          'applicable', (select count(*) from c where c.session_id = s.id),
          'registered', (select count(*) from c where c.session_id = s.id and c.status is not null)
        ) order by s.session_date, s.title) from ses s), '[]'::jsonb),
      'members', coalesce((select jsonb_agg(jsonb_build_object(
          'membership_id', m.id, 'name', m.full_name, 'team_id', m.team_id, 'team_name', m.team_name,
          'active', m.status = 'ativo',
          'stats', (select private.pres_stats(
              count(*) filter (where c.category = 'presente'), count(*) filter (where c.category = 'presente' and c.partial),
              count(*) filter (where c.category = 'justificada'), count(*) filter (where c.category = 'injustificada'),
              count(*) filter (where c.category = 'por_registar'), count(*) filter (where c.category = 'futura'),
              count(*) filter (where c.category = 'cancelada'))
            from c where c.membership_id = m.id)
        ) order by m.team_name nulls last, m.full_name) from mem m), '[]'::jsonb),
      'cells', coalesce((select jsonb_agg(jsonb_build_object(
          's', c.session_id, 'm', c.membership_id, 'status', c.status, 'partial', c.partial,
          'partial_note', c.partial_note, 'has_justification', c.justification is not null, 'category', c.category))
        from c), '[]'::jsonb),
      'totals', (select private.pres_stats(
              count(*) filter (where c.category = 'presente'), count(*) filter (where c.category = 'presente' and c.partial),
              count(*) filter (where c.category = 'justificada'), count(*) filter (where c.category = 'injustificada'),
              count(*) filter (where c.category = 'por_registar'), count(*) filter (where c.category = 'futura'),
              count(*) filter (where c.category = 'cancelada')) from c),
      'by_team', case when v_reg then coalesce((select jsonb_agg(x.j order by x.team_name nulls last) from (
          select t.name as team_name, jsonb_build_object('team_id', c.team_id, 'team_name', t.name,
              'members', count(distinct c.membership_id),
              'stats', private.pres_stats(
                count(*) filter (where c.category = 'presente'), count(*) filter (where c.category = 'presente' and c.partial),
                count(*) filter (where c.category = 'justificada'), count(*) filter (where c.category = 'injustificada'),
                count(*) filter (where c.category = 'por_registar'), count(*) filter (where c.category = 'futura'),
                count(*) filter (where c.category = 'cancelada'))) as j
            from c left join public.teams t on t.id = c.team_id
           group by c.team_id, t.name) x), '[]'::jsonb) else '[]'::jsonb end,
      'by_month', coalesce((select jsonb_agg(x.j order by x.month) from (
          select to_char(c.session_date, 'YYYY-MM') as month, jsonb_build_object('month', to_char(c.session_date, 'YYYY-MM'),
              'sessions', count(distinct c.session_id) filter (where c.category not in ('cancelada', 'futura')),
              'stats', private.pres_stats(
                count(*) filter (where c.category = 'presente'), count(*) filter (where c.category = 'presente' and c.partial),
                count(*) filter (where c.category = 'justificada'), count(*) filter (where c.category = 'injustificada'),
                count(*) filter (where c.category = 'por_registar'), count(*) filter (where c.category = 'futura'),
                count(*) filter (where c.category = 'cancelada'))) as j
            from c group by to_char(c.session_date, 'YYYY-MM')) x), '[]'::jsonb)
    )
  );
end
$$;

-- Sessão: dados, membros que contam e respetivos registos. Quem não regista só pode abrir
-- sessões em que conta e só vê o próprio registo.
create or replace function public.pres_session(p_section uuid, p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'presencas');
  v_reg boolean := private.pres_can_register(p_section);
  v_me uuid := (select id from public.memberships where section_id = p_section and profile_id = auth.uid());
  s public.pres_sessions;
begin
  s := private.pres_session_of(p_section, v_space, p_session);
  if not v_reg and not exists (select 1 from private.pres_applicable(p_section, v_space, s.session_date, s.session_date) a
                                where a.session_id = s.id and a.membership_id = v_me) then
    raise exception 'Registo não encontrado.';
  end if;
  return jsonb_build_object(
    'can_register', v_reg,
    'today', private.pres_today(),
    'session', (select jsonb_build_object(
        'id', s.id, 'date', s.session_date, 'title', s.title, 'kind', s.kind, 'audience', s.audience,
        'team_id', s.team_id, 'team_name', t.name, 'notes', s.notes, 'status', s.status,
        'cancel_reason', s.cancel_reason, 'cancelled_at', s.cancelled_at,
        'effective_status', case when private.pres_is_cancelled(s.id) then 'cancelada' else 'ativa' end,
        'future', s.session_date > private.pres_today(),
        'cal_event', case when e.id is null then null else jsonb_build_object(
            'id', e.id, 'title', e.title, 'status', e.status,
            'start', coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date),
            'end', coalesce(e.end_date, (e.ends_at at time zone 'Europe/Lisbon')::date)) end,
        'created_by_name', (select full_name from public.profiles where id = s.created_by),
        'created_at', s.created_at)
      from (select 1) one left join public.teams t on t.id = s.team_id left join public.cal_events e on e.id = s.cal_event_id),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'membership_id', c.membership_id, 'name', p.full_name, 'team_id', c.team_id, 'team_name', t.name,
        'status', c.status, 'partial', c.partial, 'partial_note', c.partial_note,
        'justification', c.justification, 'category', c.category,
        'updated_at', r.updated_at, 'updated_by_name', (select full_name from public.profiles where id = r.updated_by)
      ) order by t.name nulls last, p.full_name)
      from private.pres_cells(p_section, v_space, s.session_date, s.session_date) c
      join public.memberships m on m.id = c.membership_id
      join public.profiles p on p.id = m.profile_id
      left join public.teams t on t.id = c.team_id
      left join public.pres_records r on r.session_id = c.session_id and r.membership_id = c.membership_id
     where c.session_id = s.id and (v_reg or c.membership_id = v_me)), '[]'::jsonb),
    'history', case when v_reg then coalesce((select jsonb_agg(jsonb_build_object(
        'id', h.id, 'membership_id', h.membership_id, 'name', p.full_name,
        'old_status', h.old_status, 'new_status', h.new_status, 'old_partial', h.old_partial, 'new_partial', h.new_partial,
        'justification_changed', h.old_justification is distinct from h.new_justification,
        'reason', h.reason, 'changed_at', h.changed_at,
        'changed_by_name', (select full_name from public.profiles where id = h.changed_by)
      ) order by h.changed_at desc, h.id desc)
      from public.pres_record_history h
      join public.memberships m on m.id = h.membership_id join public.profiles p on p.id = m.profile_id
     where h.session_id = s.id and h.section_id = p_section and h.space = v_space), '[]'::jsonb) else '[]'::jsonb end
  );
end
$$;

-- Detalhe individual: datas, estados e indicadores de um membro (quem regista ou o próprio).
create or replace function public.pres_member(p_section uuid, p_membership uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'presencas');
  v_reg boolean := private.pres_can_register(p_section);
  m public.memberships;
begin
  select * into m from public.memberships where id = p_membership and section_id = p_section;
  if m.id is null or not (v_reg or m.profile_id = auth.uid()) then raise exception 'Registo não encontrado.'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Indica um período válido.'; end if;
  if p_to - p_from > 800 then raise exception 'Escolhe um período até dois anos.'; end if;
  return (
    with c as materialized (
      select * from private.pres_cells(p_section, v_space, p_from, p_to) x where x.membership_id = m.id
    )
    select jsonb_build_object(
      'can_register', v_reg,
      'is_self', m.profile_id = auth.uid(),
      'today', private.pres_today(),
      'member', jsonb_build_object('membership_id', m.id, 'name', (select full_name from public.profiles where id = m.profile_id),
        'team_name', (select name from public.teams where id = m.team_id), 'function', m.function, 'active', m.status = 'ativo',
        'entry_date', private.pres_entry_date(m.id)),
      'stats', (select private.pres_stats(
              count(*) filter (where c.category = 'presente'), count(*) filter (where c.category = 'presente' and c.partial),
              count(*) filter (where c.category = 'justificada'), count(*) filter (where c.category = 'injustificada'),
              count(*) filter (where c.category = 'por_registar'), count(*) filter (where c.category = 'futura'),
              count(*) filter (where c.category = 'cancelada')) from c),
      'entries', coalesce((select jsonb_agg(jsonb_build_object(
          'session_id', s.id, 'date', s.session_date, 'title', s.title, 'kind', s.kind, 'audience', s.audience,
          'team_name', t.name, 'status', c.status, 'partial', c.partial, 'partial_note', c.partial_note,
          'justification', c.justification, 'category', c.category) order by s.session_date desc, s.title)
        from c join public.pres_sessions s on s.id = c.session_id left join public.teams t on t.id = s.team_id), '[]'::jsonb),
      'history', coalesce((select jsonb_agg(jsonb_build_object(
          'id', h.id, 'session_id', h.session_id, 'session_title', s.title, 'session_date', s.session_date,
          'old_status', h.old_status, 'new_status', h.new_status, 'old_partial', h.old_partial, 'new_partial', h.new_partial,
          'justification_changed', h.old_justification is distinct from h.new_justification,
          'reason', h.reason, 'changed_at', h.changed_at,
          'changed_by_name', (select full_name from public.profiles where id = h.changed_by)
        ) order by h.changed_at desc, h.id desc)
        from public.pres_record_history h join public.pres_sessions s on s.id = h.session_id
       where h.membership_id = m.id and h.section_id = p_section and h.space = v_space
         and s.session_date between p_from and p_to), '[]'::jsonb)
    )
  );
end
$$;

-- Atividades do Calendário (mesmo espaço) que ainda não têm sessão de presenças.
create or replace function public.pres_event_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'presencas', 'presencas.registar', true);
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'audience', e.audience, 'team_id', e.team_id, 'team_name', t.name,
      'start', coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date),
      'end', coalesce(e.end_date, (e.ends_at at time zone 'Europe/Lisbon')::date)
    ) order by coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date) desc, e.title)
    from public.cal_events e left join public.teams t on t.id = e.team_id
   where e.section_id = p_section and e.space = v_space and e.status = 'ativo'
     and not exists (select 1 from public.pres_sessions s where s.cal_event_id = e.id)
     and coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date)
         between private.pres_today() - 400 and private.pres_today() + 180), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Escrita (dirigentes ou «presencas.registar»)
-- ---------------------------------------------------------------------------

-- Criar (p_session null) ou alterar uma sessão. Com p_cal_event, a sessão fica ligada a
-- essa atividade (título, data e público por omissão vêm da atividade).
create or replace function public.pres_session_save(
  p_section uuid, p_session uuid, p_cal_event uuid, p_date date, p_title text, p_kind text, p_team uuid, p_notes text
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_space text := private.module_require_can(p_section, 'presencas', 'presencas.registar', true);
  s public.pres_sessions;
  e public.cal_events;
  v_date date := p_date;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_kind text := p_kind;
  v_team uuid := p_team;
  v_start date; v_end date;
  v_id uuid;
begin
  if p_session is not null then
    s := private.pres_session_of(p_section, v_space, p_session, true);
  end if;
  if p_cal_event is not null then
    select * into e from public.cal_events where id = p_cal_event and section_id = p_section and space = v_space;
    if e.id is null then raise exception 'Atividade do Calendário não encontrada neste espaço.'; end if;
    if e.status <> 'ativo' and p_cal_event is distinct from s.cal_event_id then
      raise exception 'Esta atividade foi cancelada no Calendário.';
    end if;
    perform 1 from public.cal_events where id = e.id for update;
    if exists (select 1 from public.pres_sessions x where x.cal_event_id = e.id and x.id is distinct from p_session) then
      raise exception 'Esta atividade já tem uma sessão de presenças.';
    end if;
    v_start := coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date);
    v_end := coalesce(e.end_date, (e.ends_at at time zone 'Europe/Lisbon')::date);
    v_date := coalesce(v_date, v_start);
    if v_date < v_start or v_date > v_end then raise exception 'A data tem de estar dentro das datas da atividade.'; end if;
    v_title := coalesce(v_title, e.title);
    v_kind := coalesce(v_kind, 'atividade');
    if v_team is null and e.audience = 'equipa' then v_team := e.team_id; end if;
  end if;
  v_kind := coalesce(v_kind, 'reuniao');
  if v_date is null then raise exception 'Indica a data da sessão.'; end if;
  if v_title is null then raise exception 'Indica o título da sessão.'; end if;
  if length(v_title) > 200 then raise exception 'O título é demasiado longo (máximo 200 caracteres).'; end if;
  if v_kind not in ('reuniao', 'atividade') then raise exception 'Tipo de sessão inválido.'; end if;
  if length(coalesce(p_notes, '')) > 1000 then raise exception 'As notas são demasiado longas (máximo 1000 caracteres).'; end if;
  if v_date < date '2000-01-01' or v_date > private.pres_today() + 730 then raise exception 'Data fora do intervalo permitido.'; end if;
  if v_team is not null and not exists (select 1 from public.teams where id = v_team and section_id = p_section) then
    raise exception 'Equipa não encontrada.';
  end if;

  if p_session is null then
    insert into public.pres_sessions (section_id, space, session_date, title, kind, audience, team_id, cal_event_id, notes, created_by)
    values (p_section, v_space, v_date, v_title, v_kind, case when v_team is null then 'seccao' else 'equipa' end, v_team,
            p_cal_event, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
    returning id into v_id;
    perform private.audit(p_section, 'presencas_sessao_criada', 'pres_session', v_id::text,
      jsonb_build_object('space', v_space, 'date', v_date, 'cal_event', p_cal_event));
  else
    -- Com presenças já registadas, a data e o público não mudam (mudariam quem conta).
    if (v_date is distinct from s.session_date or v_team is distinct from s.team_id)
       and exists (select 1 from public.pres_records r where r.session_id = s.id and r.status is not null) then
      raise exception 'Esta sessão já tem presenças registadas: não é possível mudar a data nem o público. Cancela-a e cria outra, se necessário.';
    end if;
    update public.pres_sessions
       set session_date = v_date, title = v_title, kind = v_kind,
           audience = case when v_team is null then 'seccao' else 'equipa' end, team_id = v_team,
           cal_event_id = p_cal_event, notes = nullif(trim(coalesce(p_notes, '')), ''),
           updated_by = auth.uid(), updated_at = now()
     where id = s.id;
    v_id := s.id;
    perform private.audit(p_section, 'presencas_sessao_alterada', 'pres_session', v_id::text,
      jsonb_build_object('space', v_space, 'date', v_date, 'cal_event', p_cal_event));
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Esta atividade já tem uma sessão de presenças.';
end
$$;

-- Cancelar (não conta para nada; os registos mantêm-se) ou reativar uma sessão.
create or replace function public.pres_session_cancel(p_section uuid, p_session uuid, p_cancel boolean, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_space text := private.module_require_can(p_section, 'presencas', 'presencas.registar', true);
  s public.pres_sessions;
begin
  s := private.pres_session_of(p_section, v_space, p_session, true);
  if length(coalesce(p_reason, '')) > 300 then raise exception 'O motivo é demasiado longo (máximo 300 caracteres).'; end if;
  if coalesce(p_cancel, true) then
    if s.status = 'cancelada' then raise exception 'A sessão já está cancelada.'; end if;
    update public.pres_sessions set status = 'cancelada', cancel_reason = nullif(trim(coalesce(p_reason, '')), ''),
           cancelled_at = now(), cancelled_by = auth.uid(), updated_by = auth.uid(), updated_at = now()
     where id = s.id;
  else
    if s.status = 'ativa' then raise exception 'A sessão não está cancelada.'; end if;
    update public.pres_sessions set status = 'ativa', cancel_reason = null, cancelled_at = null, cancelled_by = null,
           updated_by = auth.uid(), updated_at = now()
     where id = s.id;
  end if;
  perform private.audit(p_section, case when coalesce(p_cancel, true) then 'presencas_sessao_cancelada' else 'presencas_sessao_reativada' end,
    'pres_session', s.id::text, jsonb_build_object('space', v_space, 'reason', nullif(trim(coalesce(p_reason, '')), '')));
end
$$;

-- Registar ou corrigir o estado de várias pessoas de uma vez (só as indicadas: nada é
-- marcado por omissão). p_status: presente | justificada | injustificada | por_registar.
-- p_justification: null mantém a atual; '' apaga. Cada alteração fica no histórico.
create or replace function public.pres_record(
  p_section uuid, p_session uuid, p_memberships uuid[], p_status text,
  p_partial boolean default false, p_partial_note text default null,
  p_justification text default null, p_reason text default null
) returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_space text := private.module_require_can(p_section, 'presencas', 'presencas.registar', true);
  s public.pres_sessions;
  v_status text := case when p_status = 'por_registar' then null else p_status end;
  v_partial boolean := coalesce(p_partial, false);
  v_pnote text := nullif(trim(coalesce(p_partial_note, '')), '');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_ids uuid[];
  v_mid uuid;
  r public.pres_records;
  v_just text;
  v_n integer := 0;
begin
  if p_status is null or p_status not in ('presente', 'justificada', 'injustificada', 'por_registar') then
    raise exception 'Escolhe o estado a registar.';
  end if;
  s := private.pres_session_of(p_section, v_space, p_session, true);
  if private.pres_is_cancelled(s.id) then raise exception 'Esta sessão foi cancelada: não é possível registar presenças.'; end if;
  if s.session_date > private.pres_today() and p_status not in ('justificada', 'por_registar') then
    raise exception 'A sessão ainda não aconteceu: só é possível registar faltas justificadas antecipadas.';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_memberships, '{}')) x where x is not null;
  if cardinality(v_ids) = 0 then raise exception 'Seleciona pelo menos uma pessoa.'; end if;
  if cardinality(v_ids) > 300 then raise exception 'Demasiadas pessoas de uma vez.'; end if;
  if exists (select 1 from unnest(v_ids) x
              where not exists (select 1 from private.pres_applicable(p_section, v_space, s.session_date, s.session_date) a
                                 where a.session_id = s.id and a.membership_id = x)) then
    raise exception 'Há pessoas selecionadas que não contam nesta sessão (não eram pioneiros ou guias ativos da secção ou da equipa nessa data).';
  end if;
  if v_partial and v_status is distinct from 'presente' then
    raise exception 'A participação parcial só se indica com «Presente».';
  end if;
  if not v_partial then v_pnote := null; end if;
  if length(coalesce(v_pnote, '')) > 200 then raise exception 'A nota da participação parcial é demasiado longa (máximo 200 caracteres).'; end if;
  if length(coalesce(p_justification, '')) > 500 then raise exception 'A justificação é demasiado longa (máximo 500 caracteres).'; end if;
  if nullif(trim(coalesce(p_justification, '')), '') is not null and coalesce(v_status, '') not in ('justificada', 'injustificada') then
    raise exception 'A justificação só se indica numa falta.';
  end if;
  if length(coalesce(v_reason, '')) > 300 then raise exception 'O motivo é demasiado longo (máximo 300 caracteres).'; end if;

  foreach v_mid in array v_ids loop
    select * into r from public.pres_records where session_id = s.id and membership_id = v_mid for update;
    v_just := case
      when v_status is null or v_status = 'presente' then null
      when p_justification is null then r.justification
      else nullif(trim(p_justification), '') end;
    if r.id is null then
      continue when v_status is null;
      insert into public.pres_records (section_id, space, session_id, membership_id, status, partial, partial_note, justification, created_by, updated_by)
      values (p_section, v_space, s.id, v_mid, v_status, v_partial, v_pnote, v_just, auth.uid(), auth.uid())
      returning * into r;
      insert into public.pres_record_history (section_id, space, record_id, session_id, membership_id,
        new_status, new_partial, new_partial_note, new_justification, reason, changed_by)
      values (p_section, v_space, r.id, s.id, v_mid, v_status, v_partial, v_pnote, v_just, v_reason, auth.uid());
      v_n := v_n + 1;
    elsif (r.status, r.partial, r.partial_note, r.justification) is distinct from (v_status, v_partial, v_pnote, v_just) then
      insert into public.pres_record_history (section_id, space, record_id, session_id, membership_id,
        old_status, new_status, old_partial, new_partial, old_partial_note, new_partial_note,
        old_justification, new_justification, reason, changed_by)
      values (p_section, v_space, r.id, s.id, v_mid, r.status, v_status, r.partial, v_partial, r.partial_note, v_pnote,
              r.justification, v_just, v_reason, auth.uid());
      update public.pres_records set status = v_status, partial = v_partial, partial_note = v_pnote, justification = v_just,
             updated_by = auth.uid(), updated_at = now()
       where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;


-- ===== 20261022000900_integracao_v2.sql =====
-- Pioneiros — ligações entre módulos (v2). A atividade do Calendário reúne o que lhe está
-- ligado nos outros módulos: material reservado e a comprar, tarefas, presenças, resumo
-- financeiro e reuniões. Cada parte só aparece a quem tem acesso a esse módulo no mesmo
-- espaço, e respeita as regras de visibilidade do próprio módulo. Nada é copiado.
-- Aditivo: não altera nem apaga registos existentes.

create or replace function public.cal_event_links(p_section uuid, p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'calendario');
  v_out jsonb := '{}'::jsonb;
  v_fin jsonb;
begin
  if not exists (select 1 from public.cal_events where id = p_event and section_id = p_section and space = v_space) then
    raise exception 'Registo não encontrado.';
  end if;

  if private.module_space(p_section, 'inventario') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('reservas', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'item_id', i.id, 'item', i.name, 'unit', i.unit,
                                          'quantity', r.quantity, 'status', r.status) order by i.name)
        from public.inv_reservations r join public.inv_items i on i.id = r.item_id
       where r.section_id = p_section and r.space = v_space and r.event_id = p_event and r.status <> 'cancelada'), '[]'::jsonb));
  end if;

  if private.module_space(p_section, 'inventario') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('compras', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(i.name, p.name), 'quantity', p.quantity,
                                          'unit', coalesce(i.unit, p.unit), 'status', p.status) order by p.created_at)
        from public.inv_purchases p left join public.inv_items i on i.id = p.item_id
       where p.section_id = p_section and p.space = v_space and p.event_id = p_event and p.status <> 'cancelado'), '[]'::jsonb));
  end if;

  if private.module_space(p_section, 'presencas') is not distinct from v_space then
    -- A sessão de presenças da atividade: contagens só para quem regista; os restantes
    -- veem apenas o próprio registo.
    v_out := v_out || jsonb_build_object('presencas', (
      select jsonb_build_object('id', s.id, 'title', s.title, 'date', s.session_date, 'status', s.status,
        'counts', case when private.pres_can_register(p_section) then (
            select jsonb_build_object('presente', count(*) filter (where r.status = 'presente'),
                                      'justificada', count(*) filter (where r.status = 'justificada'),
                                      'injustificada', count(*) filter (where r.status = 'injustificada'))
              from public.pres_records r where r.session_id = s.id) end,
        'mine', (select r.status from public.pres_records r join public.memberships m on m.id = r.membership_id
                  where r.session_id = s.id and m.profile_id = auth.uid() limit 1))
        from public.pres_sessions s
       where s.section_id = p_section and s.space = v_space and s.cal_event_id = p_event));
  end if;

  if private.module_space(p_section, 'tesouraria') is not distinct from v_space then
    -- Só os totais partilhados (os mesmos que o resumo da Tesouraria mostra a todos).
    v_fin := public.fin_activity_results(p_section, p_event) -> 0;
    v_out := v_out || jsonb_build_object('financas', case when v_fin is null then null else
      jsonb_build_object('orcamento', v_fin -> 'orcamento', 'efetivo', v_fin -> 'efetivo', 'por_confirmar', v_fin -> 'por_confirmar') end);
  end if;

  if private.module_space(p_section, 'secretaria') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('reunioes', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'kind', m.kind, 'starts_at', m.starts_at) order by m.starts_at)
        from public.sec_meetings m
       where m.section_id = p_section and m.space = v_space and m.cal_event_id = p_event and m.status = 'ativa'
         and private.sec_can_see(m.id)), '[]'::jsonb));
  end if;

  if private.module_space(p_section, 'secretaria') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('tarefas', private.sec_tasks_for_event(p_section, v_space, p_event));
  end if;

  return v_out;
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;


-- ===== 20261023000100_calendario_semanal.sql =====
-- Pioneiros — Calendário: criar uma atividade que se repete todas as semanas (ex.: a reunião
-- de sábado, 14:30–16:00) até uma data. Cada semana fica uma atividade normal (respostas,
-- pendências e lembretes próprios); os envolvidos recebem UMA notificação para a série.
-- Mantém a hora de Lisboa na mudança de hora e salta as semanas que já têm uma atividade
-- ativa com o mesmo título e o mesmo início (pode correr-se de novo sem duplicar).
-- Aditivo: não altera dados nem outras funções.

create or replace function public.cal_create_weekly(p_section uuid, p_data jsonb, p_until date)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
        base public.cal_events; e public.cal_events;
        v_first date; v_from date; v_last date; v_day date; v_shift interval; v_n integer := 0; v_inv uuid[] := '{}';
begin
  base := private.cal_from_json(p_section, p_data);
  v_first := case when base.all_day then base.start_date else (base.starts_at at time zone 'Europe/Lisbon')::date end;
  if p_until is null then raise exception 'Indica até quando se repete.'; end if;
  if p_until < v_first then raise exception 'A repetição tem de terminar depois da primeira data.'; end if;
  if p_until - v_first > 400 then raise exception 'A repetição não pode durar mais de um ano.'; end if;

  v_day := v_first;
  while v_day <= p_until loop
    e := base;
    v_shift := (v_day - v_first) * interval '1 day';
    if e.all_day then
      e.start_date := base.start_date + (v_day - v_first);
      e.end_date := base.end_date + (v_day - v_first);
    else
      -- Soma os dias na hora local, para as 14:30 continuarem 14:30 depois da mudança de hora.
      e.starts_at := ((base.starts_at at time zone 'Europe/Lisbon') + v_shift) at time zone 'Europe/Lisbon';
      e.ends_at := ((base.ends_at at time zone 'Europe/Lisbon') + v_shift) at time zone 'Europe/Lisbon';
    end if;
    if base.registration_deadline is not null then
      e.registration_deadline := ((base.registration_deadline at time zone 'Europe/Lisbon') + v_shift) at time zone 'Europe/Lisbon';
    end if;
    if not exists (
      select 1 from public.cal_events x
       where x.section_id = p_section and x.space = v_space and x.status = 'ativo' and x.title = e.title
         and x.all_day = e.all_day
         and (case when e.all_day then x.start_date = e.start_date else x.starts_at = e.starts_at end)
    ) then
      e.id := gen_random_uuid();
      e.space := v_space; e.status := 'ativo';
      e.created_by := auth.uid(); e.created_at := now(); e.updated_by := auth.uid(); e.updated_at := now();
      insert into public.cal_events select e.*;
      perform private.audit(p_section, 'cal_evento_criado', 'cal_event', e.id::text,
        jsonb_build_object('space', v_space, 'title', e.title, 'serie', true));
      perform private.cal_sync_reminders(e.id);
      v_inv := v_inv || private.cal_involved(e.id);
      if v_n = 0 then v_from := v_day; end if;
      v_n := v_n + 1;
      v_last := v_day;
    end if;
    v_day := v_day + 7;
  end loop;

  if v_n > 0 then
    perform private.module_notify(p_section, 'calendario', v_space,
      (select coalesce(array_agg(distinct u), '{}') from unnest(v_inv) u), 'cal_evento_novo',
      left('Nova atividade semanal: ' || base.title, 220),
      case when v_n = 1 then to_char(v_last, 'DD/MM/YYYY')
           else v_n || ' semanas, de ' || to_char(v_from, 'DD/MM/YYYY') || ' a ' || to_char(v_last, 'DD/MM/YYYY') end
        || coalesce(' · ' || base.location, ''),
      '/calendario');
  end if;
  return v_n;
end
$$;

revoke execute on function public.cal_create_weekly(uuid, jsonb, date) from public, anon;
grant execute on function public.cal_create_weekly(uuid, jsonb, date) to authenticated;


-- ===== 20261024000100_propostas_e_push.sql =====
-- Pioneiros — propostas de trilho mais claras para os dirigentes e
-- diagnóstico do envio de notificações push por dispositivo.
-- • A notificação de uma proposta diz quem quer fechar que trilho e em que
--   etapa, e abre diretamente o registo da proposta.
-- • Cada subscrição guarda a data do último envio aceite pelo serviço de push
--   e o último erro, para se saber se um aviso saiu do servidor.
-- Aditivo: não apaga nem altera registos existentes.

alter table public.push_subscriptions add column if not exists last_error text;

-- Envios aceites (last_used_at) e falhas (last_error) por subscrição. Só a função /api/push.
create or replace function public.push_mark_results(p_sent text[], p_failed jsonb default '[]'::jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_service_role() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update public.push_subscriptions set last_used_at = now(), last_error = null where endpoint = any (coalesce(p_sent, '{}'));
  update public.push_subscriptions s set last_error = left(f ->> 'error', 300)
    from jsonb_array_elements(coalesce(p_failed, '[]'::jsonb)) f where s.endpoint = f ->> 'endpoint';
end
$$;

-- Estado deste dispositivo para o próprio (Perfil).
create or replace function public.my_push_device(p_endpoint text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('last_sent_at', last_used_at, 'last_error', last_error)
    from public.push_subscriptions where endpoint = p_endpoint and profile_id = auth.uid()
$$;

create or replace function public.propose_choice(p_stage_path uuid, p_trail uuid, p_planned text, p_replaces uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.stage_paths;
  v_m public.memberships;
  v_t public.catalog_trails;
  v_area text;
  v_area_name text;
  v_stage text;
  v_who text;
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
  select code, name into v_area, v_area_name from public.catalog_areas where id = v_t.area_id;

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

  select name into v_stage from public.catalog_stages where id = v_p.stage_id;
  if private.is_owner(v_m.id) then
    select split_part(full_name, ' ', 1) into v_who from public.profiles where id = v_m.profile_id;
    perform private.notify(private.section_dirigentes(v_m.section_id), v_m.section_id, 'escolha_proposta',
      case when p_replaces is null then 'Proposta para fechar um trilho' else 'Proposta de troca de trilho' end,
      coalesce(v_who, 'Um pioneiro') || ' quer fechar «' || v_t.name || '» (' || v_area_name || ') na etapa ' || coalesce(v_stage, '') || '.',
      '/acompanhamento/proposta/' || v_id);
  else
    perform private.notify(array[v_m.profile_id], v_m.section_id, 'escolha_proposta',
      'Proposta de trilho', 'A Equipa de Animação propôs «' || v_t.name || '» para a tua etapa ' || coalesce(v_stage, '') || '.',
      '/meu-progresso/trilho/' || v_t.key);
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Este trilho já está escolhido ou proposto, ou já existe uma proposta pendente nesta área.';
end
$$;

-- Permissões só das funções desta migração (não mexe nas restantes).
revoke execute on function public.push_mark_results(text[], jsonb) from public, anon, authenticated;
grant execute on function public.push_mark_results(text[], jsonb) to service_role;
revoke execute on function public.my_push_device(text) from public, anon;
grant execute on function public.my_push_device(text) to authenticated;
revoke execute on function public.propose_choice(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.propose_choice(uuid, uuid, text, uuid) to authenticated;
notify pgrst, 'reload schema';


-- ===== 20261025000100_trabalhar_e_fechar.sql =====
-- Pioneiros — «trabalhar» e «fechar» um trilho ficam separados e claros.
-- • Propor trabalhar num trilho (escolha para a etapa): os dirigentes recebem
--   «X quer trabalhar em «trilho»» com ligação à proposta.
-- • Pedir para fechar um trilho (pedido de validação): além do guia da equipa,
--   os dirigentes recebem «X quer fechar «trilho»».
-- • O progresso anterior passa a ser registado só pelos dirigentes (reconhecimento
--   na negociação). Os pioneiros deixam de criar pedidos de progresso anterior;
--   os pedidos já existentes continuam a ser decididos como antes.
-- Não apaga nem altera registos existentes.

create or replace function public.create_trail_request(p_membership uuid, p_trail uuid, p_kind public.request_kind)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships; v_t public.catalog_trails; v_id uuid;
begin
  v_m := private.progress_member(p_membership);
  if not private.is_owner(v_m.id) then raise exception 'Só o próprio pode criar pedidos.' using errcode = '42501'; end if;
  if p_kind::text <> 'normal' then
    raise exception 'O progresso anterior é registado pelos dirigentes. Fala com a Equipa de Animação.';
  end if;
  v_t := private.section_trail(v_m.section_id, p_trail);
  insert into public.trail_requests (membership_id, section_id, trail_id, trail_key, kind, created_by)
  values (v_m.id, v_m.section_id, v_t.id, v_t.key, p_kind, auth.uid())
  returning id into v_id;
  insert into public.trail_request_versions (request_id, version_no) values (v_id, 1);
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um pedido ativo ou uma validação para este trilho.';
end
$$;

create or replace function public.submit_trail_validation(
  p_request uuid, p_expected_version integer, p_justification text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_v public.trail_request_versions; v_m public.memberships; v_trail text; v_who text; v_guias uuid[];
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
  select split_part(full_name, ' ', 1) into v_who from public.profiles where id = v_m.profile_id;
  -- Guia da equipa (prepara a reunião de Equipa) e dirigentes (sabem o que cada um quer fechar).
  v_guias := array(select x from unnest(private.team_guias(v_m.team_id)) x where x <> v_m.profile_id);
  perform private.notify(v_guias, v_m.section_id, 'pedido_submetido', 'Pedido para fechar um trilho',
    coalesce(v_who, 'Um pioneiro') || ' quer fechar «' || v_trail || '». Fica para a próxima reunião de Equipa.', '/revisoes/pedido/' || p_request);
  perform private.notify(array(select x from unnest(private.section_dirigentes(v_m.section_id)) x where x <> all (v_guias)),
    v_m.section_id, 'pedido_submetido', 'Pedido para fechar um trilho',
    coalesce(v_who, 'Um pioneiro') || ' quer fechar «' || v_trail || '».', '/revisoes/pedido/' || p_request);
end
$$;

create or replace function public.propose_choice(p_stage_path uuid, p_trail uuid, p_planned text, p_replaces uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.stage_paths;
  v_m public.memberships;
  v_t public.catalog_trails;
  v_area text;
  v_area_name text;
  v_stage text;
  v_who text;
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
  select code, name into v_area, v_area_name from public.catalog_areas where id = v_t.area_id;

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

  select name into v_stage from public.catalog_stages where id = v_p.stage_id;
  if private.is_owner(v_m.id) then
    select split_part(full_name, ' ', 1) into v_who from public.profiles where id = v_m.profile_id;
    perform private.notify(private.section_dirigentes(v_m.section_id), v_m.section_id, 'escolha_proposta',
      case when p_replaces is null then 'Proposta para trabalhar num trilho' else 'Proposta de troca de trilho' end,
      coalesce(v_who, 'Um pioneiro') || ' quer trabalhar em «' || v_t.name || '» (' || v_area_name || ') na etapa ' || coalesce(v_stage, '') || '.',
      '/acompanhamento/proposta/' || v_id);
  else
    perform private.notify(array[v_m.profile_id], v_m.section_id, 'escolha_proposta',
      'Proposta de trilho', 'A Equipa de Animação propôs «' || v_t.name || '» para a tua etapa ' || coalesce(v_stage, '') || '.',
      '/meu-progresso/trilho/' || v_t.key);
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Este trilho já está escolhido ou proposto, ou já existe uma proposta pendente nesta área.';
end
$$;

revoke execute on function public.create_trail_request(uuid, uuid, public.request_kind) from public, anon;
grant execute on function public.create_trail_request(uuid, uuid, public.request_kind) to authenticated;
revoke execute on function public.submit_trail_validation(uuid, integer, text) from public, anon;
grant execute on function public.submit_trail_validation(uuid, integer, text) to authenticated;
revoke execute on function public.propose_choice(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.propose_choice(uuid, uuid, text, uuid) to authenticated;
notify pgrst, 'reload schema';


-- ===== 20261026000100_validacao_dirigentes.sql =====
-- Pioneiros — validação do trilho em dois passos e contadores certos.
--
-- 1. A reunião de Equipa (guias) valida primeiro: o pedido fica «validado_guias»
--    (aguarda os dirigentes) e o trilho AINDA NÃO conta como validado. Um
--    dirigente confirma (→ «validado_equipa», o estado final de sempre) ou
--    devolve com fundamentação (→ «devolvido»). Quando é um dirigente a
--    registar a decisão da Equipa (pedido do próprio guia, equipa sem guia),
--    a validação fica logo concluída.
--    Os trilhos já validados ficam como estão.
-- 2. my_pending_counts conta só pedidos de pioneiros e guias, como a lista
--    do Acompanhamento (antes contava também pedidos de outros membros, que
--    a lista não mostra: aparecia «2» com a lista vazia).
-- Aditivo: não apaga nem converte registos.
--
-- O valor novo do enum é criado aqui e só é usado dentro de funções (em
-- tempo de execução), por isso o ficheiro pode correr numa só transação.

alter type public.request_status add value if not exists 'validado_guias';
alter type public.decision_kind add value if not exists 'validado_guias';

-- Um pedido «validado_guias» continua ativo (não se abre outro para o mesmo
-- trilho). A condição compara o nome do estado (texto) para não usar valores
-- novos do enum na mesma transação (instalação completa ou SQL Editor).
create or replace function private.request_is_active(p_status public.request_status)
returns boolean language plpgsql immutable set search_path = ''
as $$ begin return p_status::text not in ('recusado', 'cancelado', 'objetivos_validados'); end $$;
drop index if exists public.trail_requests_one_active;
create unique index trail_requests_one_active on public.trail_requests (membership_id, trail_key)
  where private.request_is_active(status);

-- Decisão da reunião de Equipa sobre o trilho completo.
create or replace function public.record_team_decision(
  p_request uuid, p_expected_version integer, p_validated boolean, p_meeting_date date, p_comment text,
  p_objective_codes text[] default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.trail_requests; v_role text; v_version uuid; v_m public.memberships; v_trail text; v_codes text[]; v_bad integer;
  v_owner_guias uuid[]; v_status text; v_kind text;
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

  -- Validado por um guia → aguarda os dirigentes; registado por um dirigente → validado.
  if not p_validated then v_status := 'devolvido'; v_kind := 'devolvido_equipa';
  elsif v_role = 'guia' then v_status := 'validado_guias'; v_kind := 'validado_guias';
  else v_status := 'validado_equipa'; v_kind := 'validado_equipa';
  end if;

  perform 1 from public.memberships where id = v_r.membership_id for update;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, objective_codes, recorded_by, recorded_as)
  values (p_request, v_version, v_kind::public.decision_kind, p_meeting_date, nullif(trim(p_comment), ''), v_codes, auth.uid(), v_role);
  update public.trail_requests set status = v_status::public.request_status, updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'decisao_equipa',
    case v_status when 'validado_equipa' then 'Trilho validado'
                  when 'validado_guias' then 'Trilho validado pelos guias'
                  else 'Trilho a rever' end,
    v_trail || case when v_status = 'validado_guias' then ' · falta a confirmação dos dirigentes' else '' end
      || coalesce(' · por demonstrar: ' || array_to_string(v_codes, ', '), '') || coalesce(': ' || nullif(trim(p_comment), ''), ''),
    '/pedidos/' || p_request);
  if v_status = 'validado_guias' then
    perform private.notify(array(select x from unnest(private.section_dirigentes(v_m.section_id)) x where x is distinct from v_m.profile_id),
      v_m.section_id, 'validacao_guias', 'Trilho para confirmar',
      v_trail || ' · validado pelos guias na reunião de Equipa.', '/revisoes/pedido/' || p_request);
  else
    perform private.notify(array(select x from unnest(private.section_dirigentes(v_m.section_id) || private.section_guias(v_m.section_id)) x
                                 where x is distinct from v_m.profile_id),
      v_m.section_id, 'comunicacao_conselho', 'Comunicação ao Conselho de Guias',
      'Decisão da reunião de Equipa sobre o trilho ' || v_trail || '.', '/conselho');
  end if;
  if v_role = 'dirigente' then
    v_owner_guias := array(select x from unnest(private.team_guias(v_m.team_id)) x where x is distinct from v_m.profile_id);
    perform private.notify(v_owner_guias, v_m.section_id, 'registo_animacao', 'Decisão registada pela Equipa de Animação',
      'Foi registada, em nome da reunião de Equipa, a decisão sobre o trilho ' || v_trail || '.', '/revisoes/pedido/' || p_request);
  end if;
exception when unique_violation then
  raise exception 'Já foi registada uma decisão para esta versão do pedido.';
end
$$;

-- Segundo passo: um dirigente confirma a validação dos guias.
create or replace function public.confirm_trail_validation(p_request uuid, p_comment text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_m public.memberships; v_version uuid; v_trail text;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_r.section_id);
  if private.is_owner(v_r.membership_id) then raise exception 'Não é possível decidir o próprio pedido.' using errcode = '42501'; end if;
  if v_r.status::text <> 'validado_guias' then raise exception 'Este pedido não está à espera da confirmação dos dirigentes.'; end if;
  if p_comment is not null and length(p_comment) > 4000 then raise exception 'Comentário demasiado longo.'; end if;

  perform 1 from public.memberships where id = v_r.membership_id for update;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, recorded_by, recorded_as)
  values (p_request, v_version, 'validado_equipa', current_date, nullif(trim(p_comment), ''), auth.uid(), 'dirigente');
  update public.trail_requests set status = 'validado_equipa', updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'decisao_equipa', 'Trilho validado',
    v_trail || ' · confirmado pelos dirigentes' || coalesce(': ' || nullif(trim(p_comment), ''), ''), '/pedidos/' || p_request);
  perform private.notify(array(select x from unnest(private.section_dirigentes(v_m.section_id) || private.section_guias(v_m.section_id)) x
                               where x is distinct from v_m.profile_id),
    v_m.section_id, 'comunicacao_conselho', 'Comunicação ao Conselho de Guias',
    'Trilho ' || v_trail || ' validado pelos guias e confirmado pelos dirigentes.', '/conselho');
exception when unique_violation then
  raise exception 'Já foi registada uma decisão para esta versão do pedido.';
end
$$;

-- Devolução fundamentada pelos dirigentes: antes de confirmarem (validado
-- pelos guias) ou depois (validado), como até aqui.
create or replace function public.record_council_return(p_request uuid, p_meeting_date date, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_m public.memberships; v_version uuid;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_r.section_id);
  if private.is_owner(v_r.membership_id) then raise exception 'Não é possível decidir o próprio pedido.' using errcode = '42501'; end if;
  if v_r.status::text not in ('validado_equipa', 'validado_guias') then
    raise exception 'Só trilhos validados na Equipa podem ser devolvidos pelos dirigentes.';
  end if;
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
    'Trilho devolvido pelos dirigentes', trim(p_comment), '/pedidos/' || p_request);
end
$$;

-- Contadores do Acompanhamento: os mesmos pedidos que a lista mostra
-- (membros ativos que são pioneiros ou guias). Para os dirigentes, os trilhos
-- validados pelos guias também estão pendentes (falta a confirmação).
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
     where m.section_id = p_section and m.status = 'ativo' and m.function in ('pioneiro', 'guia') and c.status = 'proposta';
    select count(*) filter (where r.kind = 'normal'), count(*) filter (where r.kind = 'historico') into v_tri, v_ant
      from public.trail_requests r join public.memberships m on m.id = r.membership_id
     where r.section_id = p_section and m.status = 'ativo' and m.function in ('pioneiro', 'guia')
       and r.status::text in ('submetido', 'em_revisao', 'validado_guias');
    select count(*) into v_eta from public.stage_requests s join public.memberships m on m.id = s.membership_id
     where m.section_id = p_section and m.status = 'ativo' and m.function in ('pioneiro', 'guia')
       and s.status in ('submetido', 'decidido_conselho');
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

revoke execute on function public.confirm_trail_validation(uuid, text) from public, anon;
grant execute on function public.confirm_trail_validation(uuid, text) to authenticated;
notify pgrst, 'reload schema';


-- ===== 20261027000100_atas_tarefas.sql =====
-- Pioneiros — Equipas e cargos e Atas e tarefas disponíveis para toda a secção;
-- progresso anterior registado só pelos dirigentes.
--
-- 1. Publicação: «equipas» e «secretaria» passam a «disponivel» (espaço real) em todas as
--    secções. Os dados de teste ficam no espaço de teste e não passam para o real. Os
--    restantes módulos não mudam.
-- 2. Equipas e cargos: todos os membros veem as equipas, os seus membros e os cargos.
--    Só quem gere (dirigentes, administração ou permissão «equipas.gerir») altera; as
--    notas, os motivos e as mudanças de equipa continuam visíveis só a quem gere.
-- 3. Atas e tarefas (simplificado): uma ata pertence a um evento do Calendário (título e
--    data vêm do evento), guarda-se sem aprovação e cada gravação fica no histórico.
--    Visibilidade conforme o evento: toda a secção, só a equipa do evento, ou reservada
--    aos dirigentes. Escrevem os dirigentes e quem tem «secretaria.redigir».
--    Tarefas com responsável (utilizador real), prazo opcional e estado; o responsável
--    vê e atualiza as suas tarefas mesmo sem ver a ata.
-- 4. Progresso anterior: ninguém o submete como pedido; os pedidos já submetidos
--    continuam a ser decididos pelos dirigentes (nada é apagado nem aprovado sozinho).
-- Aditivo: não apaga registos.

-- ---------------------------------------------------------------------------
-- 1. Publicação
-- ---------------------------------------------------------------------------
insert into public.module_settings (section_id, module, status, updated_at)
select s.id, m.module, 'disponivel', now()
  from public.sections s cross join (values ('equipas'), ('secretaria')) m(module)
on conflict (section_id, module) do update set status = 'disponivel', updated_at = now()
 where public.module_settings.status <> 'disponivel';

-- ---------------------------------------------------------------------------
-- 2. Equipas e cargos: consulta para todos
-- ---------------------------------------------------------------------------
create or replace function public.eq_overview(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'equipas');
  v_manage boolean := private.eq_can_manage(p_section);
  v_me public.memberships := private.my_active_membership(p_section);
  v_visible uuid[];
begin
  -- Todos veem as pessoas da secção (ativas ou suspensas) e quem tem ou teve cargos.
  select coalesce(array_agg(m.id), '{}') into v_visible
    from public.memberships m
   where m.section_id = p_section
     and (m.status in ('ativo', 'suspenso')
          or m.id = v_me.id
          or exists (select 1 from public.eq_appointments a where a.membership_id = m.id and a.space = v_space and a.cancelled_at is null)
          or (v_manage and exists (select 1 from public.eq_team_moves t where t.membership_id = m.id and t.space = v_space)));

  return jsonb_build_object(
    'space', v_space,
    'can_manage', v_manage,
    'today', private.eq_today(),
    'year', private.eq_scout_year(private.eq_today()),
    'me', v_me.id,
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'archived_at', t.archived_at,
        'color', i.color, 'motto', i.motto,
        'emblem', (select jsonb_build_object('path', f.path, 'file_name', f.file_name) from public.module_files f
                    where f.section_id = p_section and f.module = 'equipas' and f.space = v_space and f.entity = 'equipa'
                      and f.entity_id = t.id and f.removed_at is null order by f.created_at desc limit 1)
      ) order by t.archived_at nulls first, t.name)
      from public.teams t
      left join public.eq_team_identity i on i.team_id = t.id and i.space = v_space and i.section_id = p_section
      where t.section_id = p_section), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membership_id', m.id, 'profile_id', m.profile_id, 'full_name', p.full_name, 'totem', p.totem,
        'function', m.function, 'status', m.status, 'team_id', private.eq_current_team(m.id, v_space),
        'since', (m.approved_at at time zone 'Europe/Lisbon')::date
      ) order by p.full_name)
      from public.memberships m join public.profiles p on p.id = m.profile_id
      where m.id = any (v_visible)), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'kind', r.kind, 'description', r.description, 'single', r.single, 'archived_at', r.archived_at
      ) order by r.archived_at nulls first, case r.kind when 'guia' then 0 when 'subguia' then 1 else 2 end, r.name)
      from public.eq_roles r where r.section_id = p_section and r.space = v_space), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'role_id', a.role_id, 'team_id', a.team_id, 'membership_id', a.membership_id,
        'starts_on', a.starts_on, 'ends_on', a.ends_on, 'end_reason', a.end_reason,
        'notes', case when v_manage or a.membership_id = v_me.id then a.notes end,
        'remind_days', a.remind_days,
        'cancelled_at', a.cancelled_at, 'cancel_reason', case when v_manage then a.cancel_reason end,
        'created_at', a.created_at,
        'created_by_name', (select full_name from public.profiles where id = a.created_by),
        'ended_by_name', (select full_name from public.profiles where id = a.ended_by)
      ) order by a.starts_on desc, a.created_at desc)
      from public.eq_appointments a
      where a.section_id = p_section and a.space = v_space
        and (a.cancelled_at is null or v_manage or a.membership_id = v_me.id)), '[]'::jsonb),
    'moves', coalesce((
      select jsonb_agg(x order by x->>'on' desc, x->>'at' desc) from (
        select jsonb_build_object('id', t.id, 'membership_id', t.membership_id, 'on', t.effective_on, 'at', t.created_at,
          'from_team_id', t.from_team_id, 'to_team_id', t.to_team_id, 'reason', t.reason, 'source', 'modulo', 'applied', t.applied,
          'by_name', (select full_name from public.profiles where id = t.created_by)) as x
          from public.eq_team_moves t
         where t.section_id = p_section and t.space = v_space and (v_manage or t.membership_id = v_me.id)
        union all
        select jsonb_build_object('id', h.id::text, 'membership_id', h.membership_id,
          'on', (h.changed_at at time zone 'Europe/Lisbon')::date, 'at', h.changed_at,
          'from_team_id', h.old_team_id, 'to_team_id', h.new_team_id, 'reason', null, 'source', 'gestao', 'applied', true,
          'by_name', null)
          from public.membership_history h
         where h.section_id = p_section and h.old_team_id is distinct from h.new_team_id
           and coalesce(h.reason, '') not like 'Equipas e cargos%'
           and (v_manage or h.membership_id = v_me.id)
      ) s), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Atas e tarefas
-- ---------------------------------------------------------------------------

-- Nova visibilidade «seccao»: toda a secção (atas de eventos abertos a todos).
alter table public.sec_meetings drop constraint if exists sec_meetings_kind_check;
alter table public.sec_meetings add constraint sec_meetings_kind_check
  check (kind in ('equipa', 'conselho_guias', 'animacao', 'geral', 'seccao'));

create or replace function private.sec_can_see_as(p_meeting uuid, p_profile uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare m public.sec_meetings; v_team uuid;
begin
  select * into m from public.sec_meetings where id = p_meeting;
  if m.id is null or p_profile is null then return false; end if;
  select team_id into v_team from public.memberships
   where section_id = m.section_id and profile_id = p_profile and status = 'ativo';
  if not found then return false; end if;
  if m.kind = 'seccao' then return true; end if;
  if m.kind = 'geral' then
    return m.created_by = p_profile
        or exists (select 1 from public.sec_shares s where s.meeting_id = m.id
                    and (s.profile_id = p_profile or (s.team_id is not null and s.team_id = v_team)));
  end if;
  if private.sec_authorized_as(m.section_id, p_profile) then return true; end if;
  return case m.kind
    when 'equipa' then v_team is not distinct from m.team_id and v_team is not null
    when 'conselho_guias' then exists (select 1 from public.sec_participants p where p.meeting_id = m.id and p.profile_id = p_profile)
    else false end;
end
$$;

-- Quem escreve atas e gere tarefas: dirigentes e quem tem «secretaria.redigir».
create or replace function private.ata_writer(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.module_space(p_section, 'secretaria') is not null
     and (private.is_dirigente(p_section) or private.has_grant(p_section, 'secretaria.redigir'))
$$;

create or replace function private.ata_require_writer(p_section uuid)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria');
begin
  if not private.ata_writer(p_section) then
    raise exception 'Só os dirigentes e quem redige atas podem fazer isto.' using errcode = '42501';
  end if;
  return v_space;
end
$$;

-- Visibilidade de uma ata em texto simples.
create or replace function private.ata_scope(m public.sec_meetings)
returns text language sql immutable set search_path = ''
as $$ select case m.kind when 'seccao' then 'seccao' when 'equipa' then 'equipa' else 'dirigentes' end $$;

-- Evento (mesma secção e espaço) com os dados que a ata mostra.
create or replace function private.ata_event_json(p_event uuid, p_section uuid, p_space text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', e.id, 'title', e.title, 'all_day', e.all_day,
           'starts_at', e.starts_at, 'ends_at', e.ends_at, 'start_date', e.start_date, 'end_date', e.end_date,
           'day', coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date),
           'location', e.location, 'audience', e.audience, 'team_id', e.team_id,
           'team_name', (select name from public.teams where id = e.team_id), 'status', e.status)
    from public.cal_events e where e.id = p_event and e.section_id = p_section and e.space = p_space
$$;

create or replace function private.ata_task_json(i public.sec_items, p_see boolean)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', i.id, 'text', i.text, 'responsible_id', i.responsible_id,
    'responsible_name', private.sec_name(i.responsible_id), 'due_date', i.due_date, 'status', i.exec_status,
    'overdue', i.exec_status in ('por_fazer', 'em_curso') and coalesce(i.due_date < private.sec_today(), false),
    'ata_id', case when p_see then i.minute_id end,
    'event', private.ata_event_json(i.cal_event_id, i.section_id, i.space),
    'updated_at', i.updated_at, 'updated_by_name', private.sec_name(coalesce(i.updated_by, i.created_by)))
$$;

-- Lista de atas visíveis, por data do evento (mais recentes primeiro), com pesquisa.
create or replace function public.ata_list(p_section uuid, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); v_q text := nullif(trim(coalesce(p_search, '')), '');
begin
  return jsonb_build_object(
    'can_write', private.ata_writer(p_section),
    'atas', coalesce((
      select jsonb_agg(x.j order by x.day desc, x.at desc) from (
        select jsonb_build_object('id', d.id, 'meeting_id', m.id, 'title', coalesce(e.title, m.title),
                 'day', coalesce(e.start_date, (coalesce(e.starts_at, m.starts_at) at time zone 'Europe/Lisbon')::date),
                 'event_id', e.id, 'scope', private.ata_scope(m), 'team_name', (select name from public.teams where id = m.team_id),
                 'updated_at', d.updated_at, 'updated_by_name', private.sec_name(coalesce(d.updated_by, d.created_by)),
                 'open_tasks', (select count(*) from public.sec_items i where i.minute_id = d.id and i.kind in ('tarefa', 'preparar')
                                  and i.exec_status in ('por_fazer', 'em_curso'))) as j,
               coalesce(e.start_date, (coalesce(e.starts_at, m.starts_at) at time zone 'Europe/Lisbon')::date) as day,
               d.updated_at as at
          from public.sec_minutes d
          join public.sec_meetings m on m.id = d.meeting_id
          left join public.cal_events e on e.id = m.cal_event_id and e.space = m.space
         where d.section_id = p_section and d.space = v_space and d.kind = 'ata' and m.status = 'ativa'
           and private.sec_can_see_as(m.id, auth.uid())
           and (v_q is null or coalesce(e.title, m.title) ilike '%' || v_q || '%'
                or exists (select 1 from public.sec_minute_versions v where v.minute_id = d.id and v.version_no = d.current_version
                            and v.body ilike '%' || v_q || '%'))
      ) x), '[]'::jsonb));
end
$$;

-- Eventos que podem receber uma ata (quem escreve): do último ano e dos próximos 60 dias.
create or replace function public.ata_events(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.ata_require_writer(p_section);
begin
  return coalesce((
    select jsonb_agg(private.ata_event_json(e.id, p_section, v_space)
             || jsonb_build_object('ata_id', (select d.id from public.sec_meetings m join public.sec_minutes d on d.meeting_id = m.id and d.kind = 'ata'
                                              where m.cal_event_id = e.id and m.status = 'ativa' and m.space = v_space limit 1))
           order by coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date) desc)
      from public.cal_events e
     where e.section_id = p_section and e.space = v_space and e.status = 'ativo'
       and coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date) between current_date - 400 and current_date + 60), '[]'::jsonb);
end
$$;

-- Criar no calendário um evento simples para a ata (nome, dia, horas opcionais).
-- Fica no espaço do módulo (real quando publicado) e sem lembretes automáticos.
create or replace function public.ata_event_create(p_section uuid, p_title text, p_day date, p_start text default null, p_end text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.ata_require_writer(p_section); v_id uuid; v_title text := nullif(trim(coalesce(p_title, '')), '');
        v_s time; v_e time;
begin
  if v_title is null then raise exception 'Indica o nome do evento.'; end if;
  if length(v_title) > 200 then raise exception 'O nome é demasiado longo (máximo 200 caracteres).'; end if;
  if p_day is null then raise exception 'Indica a data do evento.'; end if;
  begin
    v_s := nullif(trim(coalesce(p_start, '')), '')::time;
    v_e := coalesce(nullif(trim(coalesce(p_end, '')), '')::time, v_s);
  exception when others then raise exception 'Escreve a hora como 09:30.';
  end;
  if v_s is not null and v_e < v_s then raise exception 'O fim não pode ser antes do início.'; end if;
  insert into public.cal_events (section_id, space, title, all_day, starts_at, ends_at, start_date, end_date,
                                 reminder_minutes, deadline_reminder_minutes, created_by, updated_by)
  values (p_section, v_space, v_title, v_s is null,
          case when v_s is not null then (p_day + v_s) at time zone 'Europe/Lisbon' end,
          case when v_s is not null then (p_day + v_e) at time zone 'Europe/Lisbon' end,
          case when v_s is null then p_day end, case when v_s is null then p_day end,
          '{}', '{}', auth.uid(), auth.uid())
  returning id into v_id;
  perform private.audit(p_section, 'cal_evento_criado', 'cal_event', v_id::text, jsonb_build_object('space', v_space, 'title', v_title, 'origem', 'atas'));
  return v_id;
end
$$;

-- Detalhe da ata (ou de uma versão anterior), com o evento, o histórico e as tarefas.
create or replace function public.ata_get(p_section uuid, p_ata uuid, p_version integer default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes; m public.sec_meetings;
        v public.sec_minute_versions; v_write boolean;
begin
  select * into d from public.sec_minutes where id = p_ata and section_id = p_section and space = v_space and kind = 'ata';
  select * into m from public.sec_meetings where id = d.meeting_id;
  if d.id is null or m.status <> 'ativa' or not private.sec_can_see_as(m.id, auth.uid()) then
    raise exception 'Registo não encontrado.';
  end if;
  select * into v from public.sec_minute_versions where minute_id = d.id and version_no = coalesce(p_version, d.current_version);
  if v.id is null then raise exception 'Versão não encontrada.'; end if;
  v_write := private.ata_writer(p_section);
  return jsonb_build_object(
    'id', d.id, 'meeting_id', m.id, 'title', m.title, 'scope', private.ata_scope(m),
    'team_id', m.team_id, 'team_name', (select name from public.teams where id = m.team_id),
    'event', private.ata_event_json(m.cal_event_id, p_section, v_space),
    'day', (m.starts_at at time zone 'Europe/Lisbon')::date,
    'body', v.body, 'version', v.version_no, 'current_version', d.current_version,
    'updated_at', d.updated_at, 'updated_by_name', private.sec_name(coalesce(d.updated_by, d.created_by)),
    'created_by_name', private.sec_name(d.created_by),
    'versions', (select jsonb_agg(jsonb_build_object('version', x.version_no, 'saved_at', x.updated_at,
                                                     'saved_by_name', private.sec_name(coalesce(x.updated_by, x.created_by))) order by x.version_no desc)
                   from public.sec_minute_versions x where x.minute_id = d.id),
    'can_write', v_write,
    'tasks', coalesce((select jsonb_agg(private.ata_task_json(i, true) order by i.exec_status = 'concluida', i.due_date nulls last, i.created_at)
                         from public.sec_items i where i.minute_id = d.id and i.kind in ('tarefa', 'preparar') and i.exec_status <> 'cancelada'), '[]'::jsonb));
end
$$;

-- Guardar: cria a ata de um evento ou grava uma nova versão (as anteriores ficam no histórico).
-- p_scope: 'evento' (como o evento: secção ou equipa) ou 'dirigentes' (reservada).
create or replace function public.ata_save(
  p_section uuid, p_ata uuid, p_event uuid, p_body text, p_scope text default 'evento', p_expected_version integer default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.ata_require_writer(p_section); e public.cal_events; m public.sec_meetings; d public.sec_minutes;
        v public.sec_minute_versions; v_body text := coalesce(p_body, ''); v_kind text; v_team uuid;
begin
  if length(trim(v_body)) = 0 then raise exception 'Escreve o texto da ata.'; end if;
  if length(v_body) > 50000 then raise exception 'A ata é demasiado longa (máximo 50000 caracteres).'; end if;
  if coalesce(p_scope, 'evento') not in ('evento', 'dirigentes') then raise exception 'Visibilidade inválida.'; end if;

  if p_ata is null then
    select * into e from public.cal_events where id = p_event and section_id = p_section and space = v_space and status = 'ativo';
    if e.id is null then raise exception 'Escolhe um evento do calendário.'; end if;
    if exists (select 1 from public.sec_meetings x join public.sec_minutes y on y.meeting_id = x.id and y.kind = 'ata'
                where x.cal_event_id = e.id and x.space = v_space and x.status = 'ativa') then
      raise exception 'Este evento já tem ata. Abre-a para a editar.';
    end if;
  else
    select * into d from public.sec_minutes where id = p_ata and section_id = p_section and space = v_space and kind = 'ata' for update;
    select * into m from public.sec_meetings where id = d.meeting_id;
    if d.id is null or m.status <> 'ativa' or not private.sec_can_see_as(m.id, auth.uid()) then raise exception 'Registo não encontrado.'; end if;
    if p_expected_version is distinct from d.current_version then raise exception 'A ata mudou entretanto. Atualiza a página.'; end if;
    select * into e from public.cal_events where id = m.cal_event_id and space = v_space;
  end if;

  -- Reservada → só dirigentes; senão, como o evento (equipa do evento ou toda a secção).
  -- Uma ata já existente que não era reservada mantém a visibilidade que tinha.
  if coalesce(p_scope, 'evento') = 'dirigentes' then v_kind := 'animacao'; v_team := null;
  elsif m.id is not null and m.kind <> 'animacao' then v_kind := m.kind; v_team := m.team_id;
  elsif e.id is not null and e.audience = 'equipa' and e.team_id is not null then v_kind := 'equipa'; v_team := e.team_id;
  else v_kind := 'seccao'; v_team := null;
  end if;

  if p_ata is null then
    insert into public.sec_meetings (section_id, space, kind, team_id, title, starts_at, location, cal_event_id, created_by, updated_by)
    values (p_section, v_space, v_kind, v_team, e.title,
            coalesce(e.starts_at, (e.start_date + time '12:00') at time zone 'Europe/Lisbon'), e.location, e.id, auth.uid(), auth.uid())
    returning * into m;
    insert into public.sec_minutes (section_id, space, meeting_id, kind, status, current_version, created_by, updated_by)
    values (p_section, v_space, m.id, 'ata', 'rascunho', 1, auth.uid(), auth.uid())
    returning * into d;
    insert into public.sec_minute_versions (minute_id, section_id, space, version_no, body, created_by, updated_by)
    values (d.id, p_section, v_space, 1, v_body, auth.uid(), auth.uid());
    perform private.audit(p_section, 'ata_criada', 'sec_minute', d.id::text, jsonb_build_object('space', v_space, 'event', e.id));
    return d.id;
  end if;

  select * into v from public.sec_minute_versions where minute_id = d.id and version_no = d.current_version;
  if (m.kind is distinct from v_kind or m.team_id is distinct from v_team) then
    if not private.sec_can_see_as(m.id, auth.uid()) then raise exception 'Registo não encontrado.'; end if;
    update public.sec_meetings set kind = v_kind, team_id = v_team, updated_by = auth.uid(), updated_at = now() where id = m.id;
  end if;
  if v.body is distinct from v_body then
    -- A versão anterior fica fechada no histórico; a nova passa a ser a atual.
    if v.frozen_at is null then update public.sec_minute_versions set frozen_at = now() where id = v.id; end if;
    insert into public.sec_minute_versions (minute_id, section_id, space, version_no, body, created_by, updated_by)
    values (d.id, p_section, v_space, d.current_version + 1, v_body, auth.uid(), auth.uid());
    update public.sec_minutes set current_version = d.current_version + 1,
           status = case when status = 'aprovada' then 'rascunho' else status end,
           updated_by = auth.uid(), updated_at = now()
     where id = d.id;
  elsif m.kind is distinct from v_kind or m.team_id is distinct from v_team then
    update public.sec_minutes set updated_by = auth.uid(), updated_at = now() where id = d.id;
  end if;
  perform private.audit(p_section, 'ata_guardada', 'sec_minute', d.id::text, jsonb_build_object('space', v_space));
  return d.id;
end
$$;

-- Criar ou editar uma tarefa da ata (descrição, responsável, prazo opcional, estado).
create or replace function public.ata_task_save(
  p_section uuid, p_task uuid, p_ata uuid, p_text text, p_responsible uuid, p_due date default null, p_status text default 'por_fazer'
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.ata_require_writer(p_section); d public.sec_minutes; m public.sec_meetings;
        a public.sec_items; b public.sec_items; v_text text := nullif(trim(coalesce(p_text, '')), '');
begin
  if v_text is null then raise exception 'Descreve a tarefa.'; end if;
  if length(v_text) > 2000 then raise exception 'A descrição é demasiado longa (máximo 2000 caracteres).'; end if;
  if p_responsible is null then raise exception 'Escolhe o responsável.'; end if;
  if not exists (select 1 from public.memberships where section_id = p_section and profile_id = p_responsible and status = 'ativo') then
    raise exception 'O responsável tem de ser um membro ativo da secção.';
  end if;
  if coalesce(p_status, 'por_fazer') not in ('por_fazer', 'em_curso', 'concluida') then raise exception 'Estado inválido.'; end if;

  if p_task is not null then
    select * into a from public.sec_items where id = p_task and section_id = p_section and space = v_space for update;
    if a.id is null or not private.sec_can_see_as(a.meeting_id, auth.uid()) then raise exception 'Registo não encontrado.'; end if;
    b := a;
    b.text := v_text; b.responsible_id := p_responsible; b.due_date := p_due; b.exec_status := coalesce(p_status, 'por_fazer');
    if b.exec_status = 'concluida' and a.exec_status <> 'concluida' then b.completed_at := now(); b.completed_by := auth.uid(); end if;
    if b.exec_status <> 'concluida' then b.completed_at := null; b.completed_by := null; end if;
    if b.exec_status is distinct from a.exec_status then b.status_changed_by := auth.uid(); b.status_changed_at := now(); end if;
    b.updated_by := auth.uid(); b.updated_at := now();
    update public.sec_items set text = b.text, responsible_id = b.responsible_id, due_date = b.due_date, exec_status = b.exec_status,
           completed_at = b.completed_at, completed_by = b.completed_by, status_changed_by = b.status_changed_by,
           status_changed_at = b.status_changed_at, updated_by = b.updated_by, updated_at = b.updated_at
     where id = a.id;
    perform private.sec_item_log(a, b, null);
  else
    select * into d from public.sec_minutes where id = p_ata and section_id = p_section and space = v_space and kind = 'ata';
    select * into m from public.sec_meetings where id = d.meeting_id;
    if d.id is null or m.status <> 'ativa' or not private.sec_can_see_as(m.id, auth.uid()) then raise exception 'Registo não encontrado.'; end if;
    insert into public.sec_items (section_id, space, meeting_id, minute_id, kind, text, responsible_id, due_date, exec_status,
                                  cal_event_id, completed_at, completed_by, created_by, updated_by)
    values (p_section, v_space, m.id, d.id, 'tarefa', v_text, p_responsible, p_due, coalesce(p_status, 'por_fazer'), m.cal_event_id,
            case when p_status = 'concluida' then now() end, case when p_status = 'concluida' then auth.uid() end, auth.uid(), auth.uid())
    returning * into b;
    perform private.sec_item_log(null, b, null);
  end if;

  if a.id is null or a.responsible_id is distinct from b.responsible_id then
    perform private.module_notify(p_section, 'secretaria', v_space, array[b.responsible_id], 'sec_tarefa', 'Nova tarefa',
      left(b.text, 160) || coalesce(' · prazo ' || to_char(b.due_date, 'DD/MM/YYYY'), ''), '/atas-e-tarefas/minhas');
  end if;
  perform private.audit(p_section, case when a.id is null then 'tarefa_criada' else 'tarefa_alterada' end, 'sec_item', b.id::text,
    jsonb_build_object('space', v_space));
  return b.id;
end
$$;

-- Estado da tarefa: o responsável ou quem escreve atas.
create or replace function public.ata_task_status(p_section uuid, p_task uuid, p_status text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); a public.sec_items; b public.sec_items;
begin
  if p_status not in ('por_fazer', 'em_curso', 'concluida') then raise exception 'Estado inválido.'; end if;
  select * into a from public.sec_items where id = p_task and section_id = p_section and space = v_space and kind in ('tarefa', 'preparar') for update;
  if a.id is null then raise exception 'Registo não encontrado.'; end if;
  if not (a.responsible_id = auth.uid() or (private.ata_writer(p_section) and private.sec_can_see_as(a.meeting_id, auth.uid()))) then
    raise exception 'Só o responsável ou quem gere as tarefas pode mudar o estado.' using errcode = '42501';
  end if;
  if a.exec_status = p_status then return; end if;
  b := a;
  b.exec_status := p_status; b.status_changed_by := auth.uid(); b.status_changed_at := now();
  b.completed_at := case when p_status = 'concluida' then now() end; b.completed_by := case when p_status = 'concluida' then auth.uid() end;
  update public.sec_items set exec_status = b.exec_status, status_changed_by = b.status_changed_by, status_changed_at = b.status_changed_at,
         completed_at = b.completed_at, completed_by = b.completed_by, updated_by = auth.uid(), updated_at = now()
   where id = a.id;
  perform private.sec_item_log(a, b, null);
end
$$;

-- As minhas tarefas: atribuídas a mim, de atas ativas (a ligação à ata só se a puder ver).
create or replace function public.ata_my_tasks(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria');
begin
  return coalesce((
    select jsonb_agg(private.ata_task_json(i, private.sec_can_see_as(i.meeting_id, auth.uid()))
             order by i.exec_status = 'concluida', i.due_date nulls last, i.created_at)
      from public.sec_items i join public.sec_meetings m on m.id = i.meeting_id
     where i.section_id = p_section and i.space = v_space and i.responsible_id = auth.uid()
       and i.kind in ('tarefa', 'preparar') and i.exec_status <> 'cancelada' and m.status = 'ativa'), '[]'::jsonb);
end
$$;

-- Todas as tarefas das atas que posso ver (com filtro de estado: abertas | concluidas | todas).
create or replace function public.ata_tasks(p_section uuid, p_filter text default 'abertas')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria');
begin
  return jsonb_build_object('can_write', private.ata_writer(p_section), 'tasks', coalesce((
    select jsonb_agg(private.ata_task_json(i, true) order by i.exec_status = 'concluida', i.due_date nulls last, i.created_at)
      from public.sec_items i join public.sec_meetings m on m.id = i.meeting_id
     where i.section_id = p_section and i.space = v_space and i.kind in ('tarefa', 'preparar') and i.exec_status <> 'cancelada'
       and m.status = 'ativa' and private.sec_can_see_as(m.id, auth.uid())
       and (coalesce(p_filter, 'abertas') = 'todas'
            or (p_filter = 'concluidas' and i.exec_status = 'concluida')
            or (coalesce(p_filter, 'abertas') = 'abertas' and i.exec_status in ('por_fazer', 'em_curso')))), '[]'::jsonb));
end
$$;

-- Pessoas para o seletor de responsável (utilizadores reais, membros ativos).
create or replace function public.ata_people(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.profile_id, 'name', private.sec_name(m.profile_id),
                                        'function', m.function, 'team_name', t.name) order by private.sec_name(m.profile_id))
      from public.memberships m left join public.teams t on t.id = m.team_id
     where m.section_id = p_section and m.status = 'ativo'), '[]'::jsonb);
end
$$;

-- Calendário: a ata da reunião aparece no detalhe do evento.
create or replace function public.cal_event_links(p_section uuid, p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'calendario');
  v_out jsonb := '{}'::jsonb;
  v_fin jsonb;
begin
  if not exists (select 1 from public.cal_events where id = p_event and section_id = p_section and space = v_space) then
    raise exception 'Registo não encontrado.';
  end if;

  if private.module_space(p_section, 'inventario') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('reservas', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'item_id', i.id, 'item', i.name, 'unit', i.unit,
                                          'quantity', r.quantity, 'status', r.status) order by i.name)
        from public.inv_reservations r join public.inv_items i on i.id = r.item_id
       where r.section_id = p_section and r.space = v_space and r.event_id = p_event and r.status <> 'cancelada'), '[]'::jsonb));
    v_out := v_out || jsonb_build_object('compras', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(i.name, p.name), 'quantity', p.quantity,
                                          'unit', coalesce(i.unit, p.unit), 'status', p.status) order by p.created_at)
        from public.inv_purchases p left join public.inv_items i on i.id = p.item_id
       where p.section_id = p_section and p.space = v_space and p.event_id = p_event and p.status <> 'cancelado'), '[]'::jsonb));
  end if;

  if private.module_space(p_section, 'presencas') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('presencas', (
      select jsonb_build_object('id', s.id, 'title', s.title, 'date', s.session_date, 'status', s.status,
        'counts', case when private.pres_can_register(p_section) then (
            select jsonb_build_object('presente', count(*) filter (where r.status = 'presente'),
                                      'justificada', count(*) filter (where r.status = 'justificada'),
                                      'injustificada', count(*) filter (where r.status = 'injustificada'))
              from public.pres_records r where r.session_id = s.id) end,
        'mine', (select r.status from public.pres_records r join public.memberships m on m.id = r.membership_id
                  where r.session_id = s.id and m.profile_id = auth.uid() limit 1))
        from public.pres_sessions s
       where s.section_id = p_section and s.space = v_space and s.cal_event_id = p_event));
  end if;

  if private.module_space(p_section, 'tesouraria') is not distinct from v_space then
    v_fin := public.fin_activity_results(p_section, p_event) -> 0;
    v_out := v_out || jsonb_build_object('financas', case when v_fin is null then null else
      jsonb_build_object('orcamento', v_fin -> 'orcamento', 'efetivo', v_fin -> 'efetivo', 'por_confirmar', v_fin -> 'por_confirmar') end);
  end if;

  if private.module_space(p_section, 'secretaria') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('reunioes', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'kind', m.kind, 'starts_at', m.starts_at,
               'ata_id', (select d.id from public.sec_minutes d where d.meeting_id = m.id and d.kind = 'ata')) order by m.starts_at)
        from public.sec_meetings m
       where m.section_id = p_section and m.space = v_space and m.cal_event_id = p_event and m.status = 'ativa'
         and private.sec_can_see(m.id)), '[]'::jsonb),
      'ata_writer', private.ata_writer(p_section));
    v_out := v_out || jsonb_build_object('tarefas', private.sec_tasks_for_event(p_section, v_space, p_event));
  end if;

  return v_out;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Progresso anterior: só os dirigentes registam (recognize_in_negotiation)
-- ---------------------------------------------------------------------------
create or replace function public.submit_trail_request(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_v public.trail_request_versions; v_m public.memberships; v_trail text;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.kind = 'historico' then
    raise exception 'O progresso anterior é registado pelos dirigentes. Fala com a Equipa de Animação.';
  end if;
  if v_r.status <> 'rascunho' then raise exception 'Este pedido não está em rascunho.'; end if;
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
  perform private.notify(private.team_guias(v_m.team_id) || case when v_m.function = 'guia'
           then private.section_dirigentes(v_m.section_id) else '{}'::uuid[] end,
    v_m.section_id, 'pedido_submetido', 'Novo pedido de validação',
    'Pedido de validação do trilho ' || v_trail || ' para a próxima reunião de Equipa.', '/revisoes/pedido/' || p_request);
end
$$;

-- Uma versão nova de um pedido de progresso anterior devolvido já não pode ser enviada.
create or replace function public.start_new_version(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.kind = 'historico' then
    raise exception 'O progresso anterior é registado pelos dirigentes. Fala com a Equipa de Animação.';
  end if;
  if v_r.status <> 'devolvido' then raise exception 'Só pedidos devolvidos podem ter nova versão.'; end if;
  perform private.new_draft_version(p_request, v_r.current_version);
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;
revoke all on function private.ata_writer(uuid), private.ata_require_writer(uuid), private.ata_scope(public.sec_meetings),
  private.ata_event_json(uuid, uuid, text), private.ata_task_json(public.sec_items, boolean) from public, anon;
notify pgrst, 'reload schema';

