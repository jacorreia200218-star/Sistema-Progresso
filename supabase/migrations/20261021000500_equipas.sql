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

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;
