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
