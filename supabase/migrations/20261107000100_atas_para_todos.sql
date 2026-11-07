-- Pioneiros — Atas para todos (07/11/2026).
--
-- Todos os membros ativos com acesso a «Atas e tarefas» podem escrever atas: escolher o
-- evento, criar um evento simples para a ata, escrever e editar o texto (cada gravação
-- continua a criar uma versão nova; as anteriores ficam no histórico).
-- Mantém-se como estava:
-- * tarefas (criar, editar, mudar estado de tarefas alheias): dirigentes e quem tem
--   «secretaria.redigir»; o responsável muda o estado das suas;
-- * «Reservada aos dirigentes»: só os dirigentes e quem redige a podem escolher;
-- * quem não é dirigente nem redige só escreve atas de eventos da secção ou da sua equipa,
--   e só edita atas que já consegue ver.
-- ata_list e ata_get continuam a devolver can_write (agora: pode escrever atas) e passam a
-- devolver can_manage (gere tarefas e a visibilidade reservada).
-- Não altera nem apaga registos.

-- Quem escreve atas: todos os membros ativos com acesso ao módulo.
create or replace function private.ata_author(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.module_space(p_section, 'secretaria') is not null $$;

-- Pode esta pessoa escrever a ata de um evento com este público?
-- Dirigentes e quem redige: qualquer evento. Os restantes: secção ou a sua equipa.
create or replace function private.ata_event_ok(p_section uuid, p_audience text, p_team uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.ata_writer(p_section) or p_audience is distinct from 'equipa'
      or exists (select 1 from public.memberships m where m.section_id = p_section and m.profile_id = auth.uid()
                  and m.status = 'ativo' and m.team_id = p_team)
$$;

-- Lista de atas visíveis, por data do evento (mais recentes primeiro), com pesquisa.
create or replace function public.ata_list(p_section uuid, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); v_q text := nullif(trim(coalesce(p_search, '')), '');
begin
  return jsonb_build_object(
    'can_write', private.ata_author(p_section),
    'can_manage', private.ata_writer(p_section),
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

-- Eventos que podem receber uma ata: do último ano e dos próximos 60 dias (equipas alheias só
-- para dirigentes e quem redige).
create or replace function public.ata_events(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria');
begin
  return coalesce((
    select jsonb_agg(private.ata_event_json(e.id, p_section, v_space)
             || jsonb_build_object('ata_id', (select d.id from public.sec_meetings m join public.sec_minutes d on d.meeting_id = m.id and d.kind = 'ata'
                                              where m.cal_event_id = e.id and m.status = 'ativa' and m.space = v_space limit 1))
           order by coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date) desc)
      from public.cal_events e
     where e.section_id = p_section and e.space = v_space and e.status = 'ativo'
       and private.ata_event_ok(p_section, e.audience, e.team_id)
       and coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date) between current_date - 400 and current_date + 60), '[]'::jsonb);
end
$$;

-- Criar no calendário um evento simples para a ata (nome, dia, horas opcionais).
-- Fica no espaço do módulo (real quando publicado) e sem lembretes automáticos.
create or replace function public.ata_event_create(p_section uuid, p_title text, p_day date, p_start text default null, p_end text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); v_id uuid; v_title text := nullif(trim(coalesce(p_title, '')), '');
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
  v_write := private.ata_author(p_section);
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
    'can_manage', private.ata_writer(p_section),
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
declare v_space text := private.module_require(p_section, 'secretaria'); e public.cal_events; m public.sec_meetings; d public.sec_minutes;
        v public.sec_minute_versions; v_body text := coalesce(p_body, ''); v_kind text; v_team uuid;
begin
  if length(trim(v_body)) = 0 then raise exception 'Escreve o texto da ata.'; end if;
  if length(v_body) > 50000 then raise exception 'A ata é demasiado longa (máximo 50000 caracteres).'; end if;
  if coalesce(p_scope, 'evento') not in ('evento', 'dirigentes') then raise exception 'Visibilidade inválida.'; end if;
  if p_scope = 'dirigentes' and not private.ata_writer(p_section) then
    raise exception 'Só os dirigentes e quem redige atas podem reservar uma ata aos dirigentes.' using errcode = '42501';
  end if;

  if p_ata is null then
    select * into e from public.cal_events where id = p_event and section_id = p_section and space = v_space and status = 'ativo';
    if e.id is null then raise exception 'Escolhe um evento do calendário.'; end if;
    if not private.ata_event_ok(p_section, e.audience, e.team_id) then
      raise exception 'Só podes escrever atas de eventos da secção ou da tua equipa.' using errcode = '42501';
    end if;
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

revoke all on function private.ata_author(uuid), private.ata_event_ok(uuid, text, uuid) from public, anon;
notify pgrst, 'reload schema';
