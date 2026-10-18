-- Atualização «Equipas e cargos, Atas e tarefas e progresso anterior» (18/10/2026) para um projeto já instalado.
-- Cola no SQL Editor e carrega em «Run» UMA vez. Não apaga registos: atas, tarefas, pedidos e decisões anteriores ficam guardados.
-- Depois disto, Equipas e cargos e Atas e tarefas ficam disponíveis para todos os membros, e só os dirigentes registam progresso anterior.

-- ===== supabase/migrations/20261027000100_atas_tarefas.sql =====
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
