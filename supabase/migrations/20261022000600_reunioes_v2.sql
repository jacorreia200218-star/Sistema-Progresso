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
