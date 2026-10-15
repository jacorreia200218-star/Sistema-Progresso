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
