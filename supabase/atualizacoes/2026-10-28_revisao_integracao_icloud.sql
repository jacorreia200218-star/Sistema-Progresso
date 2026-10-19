-- Atualização «Revisão de integração e calendário iCloud» (18/10/2026) para um projeto já instalado.
-- Antes: em Database › Extensions, ativa «pg_cron» e «pg_net» (sincronização de hora a hora do iCloud).
--   Sem elas a atualização aplica-se na mesma e fica só «Sincronizar agora»; podes ativá-las depois e voltar a correr isto.
-- Cola no SQL Editor e carrega em «Run» UMA vez (pode repetir-se sem estragar nada). Não apaga registos:
-- atividades, atas, tarefas, presenças, material e movimentos ficam como estão. Não publica nenhum módulo.

-- ===== supabase/migrations/20261028000200_eventos_ligacoes.sql =====
-- Pioneiros — Eventos como ponto de ligação entre módulos.
--
-- O detalhe de uma reunião ou atividade do Calendário mostra, com o mesmo id do evento:
-- Detalhes · Presenças · Ata e tarefas · Material · Finanças (estes dois só quando o
-- módulo está acessível no mesmo espaço e há dados ou a pessoa pode agir).
--
-- 1. public.pres_session_for_event: abre ou cria a sessão de presenças ligada ao evento.
--    Idempotente: devolve sempre a mesma sessão (o índice único pres_sessions_cal_event
--    já garante uma sessão por evento; a linha do evento fica bloqueada durante a criação).
--    Só para quem regista presenças (private.pres_can_register) e só no espaço do módulo
--    Presenças (teste e real nunca se misturam).
-- 2. public.cal_event_links: mantém as chaves anteriores e junta o que o detalhe precisa
--    para decidir o que mostrar (quem pode registar presenças, gerir material ou finanças,
--    se há dados financeiros e o id da ata de cada tarefa, quando visível).
--    Cada registo continua a viver no seu módulo e com as suas permissões.
-- Aditivo: não altera nem apaga dados.

-- ---------------------------------------------------------------------------
-- 1. Abrir ou criar a sessão de presenças de um evento
-- ---------------------------------------------------------------------------
create or replace function public.pres_session_for_event(p_section uuid, p_event uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_space text := private.module_require_can(p_section, 'presencas', 'presencas.registar', true);
  e public.cal_events;
  v_id uuid;
begin
  -- Bloqueia o evento: pedidos simultâneos esperam e encontram a sessão já criada.
  select * into e from public.cal_events
   where id = p_event and section_id = p_section and space = v_space for update;
  if e.id is null then raise exception 'Atividade do Calendário não encontrada neste espaço.'; end if;

  select s.id into v_id from public.pres_sessions s
   where s.cal_event_id = e.id and s.section_id = p_section and s.space = v_space;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', false);
  end if;

  if e.status <> 'ativo' then raise exception 'Esta atividade foi cancelada no Calendário.'; end if;
  begin
    v_id := public.pres_session_save(p_section, null, e.id, null, null, null, null, null);
  exception when others then
    -- Outro pedido criou-a entretanto: devolve essa.
    select s.id into v_id from public.pres_sessions s
     where s.cal_event_id = e.id and s.section_id = p_section and s.space = v_space;
    if v_id is null then raise; end if;
    return jsonb_build_object('id', v_id, 'created', false);
  end;
  return jsonb_build_object('id', v_id, 'created', true);
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Ligações do evento
-- ---------------------------------------------------------------------------
create or replace function public.cal_event_links(p_section uuid, p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'calendario');
  v_out jsonb := '{}'::jsonb;
  v_fin jsonb;
  v_tasks jsonb;
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
    v_out := v_out || jsonb_build_object('inv_can_manage', private.inv_can_manage(p_section));
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
       where s.section_id = p_section and s.space = v_space and s.cal_event_id = p_event),
      'pres_can_register', private.pres_can_register(p_section));
  end if;

  if private.module_space(p_section, 'tesouraria') is not distinct from v_space then
    v_fin := public.fin_activity_results(p_section, p_event) -> 0;
    v_out := v_out || jsonb_build_object('financas', case when v_fin is null then null else
      jsonb_build_object('orcamento', v_fin -> 'orcamento', 'efetivo', v_fin -> 'efetivo', 'por_confirmar', v_fin -> 'por_confirmar',
        'tem_dados', exists (select 1 from public.fin_budget_lines l where l.activity_id = p_event and l.section_id = p_section
                               and l.space = v_space and l.voided_at is null)
                     or exists (select 1 from public.fin_movements m where m.activity_id = p_event and m.section_id = p_section
                               and m.space = v_space and m.voided_at is null)) end,
      'fin_can_manage', private.fin_can_manage(p_section));
  end if;

  if private.module_space(p_section, 'secretaria') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('reunioes', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'kind', m.kind, 'starts_at', m.starts_at,
               'ata_id', (select d.id from public.sec_minutes d where d.meeting_id = m.id and d.kind = 'ata')) order by m.starts_at)
        from public.sec_meetings m
       where m.section_id = p_section and m.space = v_space and m.cal_event_id = p_event and m.status = 'ativa'
         and private.sec_can_see(m.id)), '[]'::jsonb),
      'ata_writer', private.ata_writer(p_section));
    -- Tarefas: a ata de cada uma só quando a pessoa a pode ver (meeting_id já vem filtrado).
    v_tasks := private.sec_tasks_for_event(p_section, v_space, p_event);
    v_out := v_out || jsonb_build_object('tarefas', coalesce((
      select jsonb_agg(t || jsonb_build_object('ata_id',
               (select d.id from public.sec_minutes d where d.meeting_id = nullif(t ->> 'meeting_id', '')::uuid and d.kind = 'ata'))
             order by o)
        from jsonb_array_elements(v_tasks) with ordinality x(t, o)), '[]'::jsonb));
  end if;

  return v_out;
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;
notify pgrst, 'reload schema';

-- ===== supabase/migrations/20261028000400_tesouraria_simples.sql =====
-- Tesouraria (simplificação): o seletor de atividades distingue atividades com o mesmo nome no
-- mesmo dia. fin_activity_options passa a devolver também a hora de início em Lisboa («time»,
-- null nos eventos de dia inteiro) e o nome da equipa («team_name»). Os campos existentes
-- (id, title, status, day), a ordem e as permissões ficam iguais.
create or replace function public.fin_activity_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'status', e.status,
      'day', coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date),
      'time', case when e.all_day or e.starts_at is null then null
                   else to_char(e.starts_at at time zone 'Europe/Lisbon', 'HH24:MI') end,
      'team_name', (select t.name from public.teams t where t.id = e.team_id))
      order by coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date) desc, e.title)
    from public.cal_events e where e.section_id = p_section and e.space = v_space), '[]'::jsonb);
end
$$;

notify pgrst, 'reload schema';

-- ===== supabase/migrations/20261028000500_presencas_simples.sql =====
-- Pioneiros — Presenças simplificadas (só funções pres_ de leitura; sem tabelas novas).
--
-- 1. pres_session: cada pessoa traz também a resposta que deu no Calendário
--    («cal_response»: vou, nao_vou, por_confirmar ou null) quando a sessão está ligada a
--    uma atividade. É só informação: confirmar «Vou» não é presença e nunca entra na
--    taxa; a presença continua a ser registada à parte (presente/falta/por registar).
-- 2. pres_event_options: devolve também «all_day» e «starts_at» (instante de início dos
--    eventos com hora) para o seletor de atividades mostrar a hora quando há duas
--    atividades com o mesmo nome no mesmo dia.
-- A fórmula da taxa não muda: Presenças ÷ (Presenças + Faltas justificadas + Faltas
-- injustificadas) × 100, só com sessões até hoje, não canceladas, aplicáveis ao membro e
-- com registo («por registar» fica de fora e é mostrado à parte).
-- Aditivo: não altera dados.

-- 1. Sessão com a resposta do Calendário
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
        -- Resposta no Calendário (Vou/Não vou/Por confirmar): intenção, não presença.
        'cal_response', case when s.cal_event_id is null then null
                             else (select cp.response from public.cal_participants cp
                                    where cp.event_id = s.cal_event_id and cp.profile_id = m.profile_id) end,
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

-- 2. Atividades do Calendário para ligar (com hora)
create or replace function public.pres_event_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'presencas', 'presencas.registar', true);
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'audience', e.audience, 'team_id', e.team_id, 'team_name', t.name,
      'start', coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date),
      'end', coalesce(e.end_date, (e.ends_at at time zone 'Europe/Lisbon')::date),
      'all_day', e.all_day, 'starts_at', e.starts_at
    ) order by coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date) desc, e.title)
    from public.cal_events e left join public.teams t on t.id = e.team_id
   where e.section_id = p_section and e.space = v_space and e.status = 'ativo'
     and not exists (select 1 from public.pres_sessions s where s.cal_event_id = e.id)
     and coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date)
         between private.pres_today() - 400 and private.pres_today() + 180), '[]'::jsonb);
end
$$;

revoke execute on function public.pres_session(uuid, uuid) from public, anon;
grant execute on function public.pres_session(uuid, uuid) to authenticated;
revoke execute on function public.pres_event_options(uuid) from public, anon;
grant execute on function public.pres_event_options(uuid) to authenticated;

-- ===== supabase/migrations/20261028000700_calendario_icloud.sql =====
-- Pioneiros — Calendário escutista: subscrição de um calendário do iCloud (ICS/webcal),
-- só de leitura.
--
-- • A administração cola o link webcal:// do calendário partilhado. A função /api/icloud
--   da app (Vercel) converte-o em https://, lê o ICS, valida-o e mostra uma pré-visualização
--   (nome, número de atividades e intervalo de datas). Só ao confirmar a fonte fica guardada.
-- • O link completo fica no esquema private (cal_source_urls) e nunca é devolvido à app:
--   a gestão mostra só uma versão mascarada. Só a chave secreta do Supabase (service_role)
--   o lê, para sincronizar.
-- • Cada fonte alimenta um espaço (real ou teste; por omissão real) e define o público
--   (secção ou equipa) e os lembretes (por omissão nenhum). As atividades importadas são
--   linhas normais de cal_events (com source_id, UID e RECURRENCE-ID), por isso podem ligar-se
--   a atas, tarefas, presenças, material e movimentos — e essas ligações mantêm-se, porque
--   a sincronização atualiza sempre a mesma linha (chave única fonte + UID + RECURRENCE-ID).
-- • Sincronização no servidor, de hora a hora (pg_cron + pg_net chamam /api/icloud com um
--   segredo guardado em private.cal_icloud_config) e «Sincronizar agora» na gestão.
-- • Nada se apaga: atividades canceladas ou retiradas do iCloud ficam «cancelado» com a
--   indicação «cancelada/removida no iCloud». Uma resposta vazia ou incompleta nunca retira
--   atividades; uma descida brusca (mais de metade, pelo menos 5) fica à espera de confirmação.
-- • Título, datas, local e descrição das atividades importadas só mudam no iCloud; nunca se
--   escreve no iCloud. A importação e as atualizações não enviam notificações.
-- Aditivo: não altera dados existentes.

-- ---------------------------------------------------------------------------
-- Fontes
-- ---------------------------------------------------------------------------
create table if not exists public.cal_sources (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  kind text not null default 'icloud' check (kind in ('icloud')),
  name text not null check (length(trim(name)) between 1 and 120),
  calname text,
  url_mask text not null,
  audience text not null default 'seccao' check (audience in ('seccao', 'equipa')),
  team_id uuid references public.teams (id),
  reminder_minutes integer[] not null default '{}',
  status text not null default 'ativa' check (status in ('ativa', 'parada', 'arquivada')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  stopped_at timestamptz,
  stopped_by uuid,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  failures integer not null default 0,
  last_stats jsonb,
  last_warning text,
  pending_removals integer not null default 0,
  event_count integer not null default 0,
  range_from date,
  range_to date,
  check (audience <> 'equipa' or team_id is not null)
);
create index if not exists cal_sources_section on public.cal_sources (section_id, space);
alter table public.cal_sources enable row level security;
revoke all on public.cal_sources from anon, authenticated;

-- O link completo (privado): só as funções abaixo o leem.
create table if not exists private.cal_source_urls (
  source_id uuid primary key references public.cal_sources (id) on delete cascade,
  url text not null check (url ~ '^https://' and length(url) <= 2000)
);
revoke all on private.cal_source_urls from public, anon, authenticated;

-- Atividades importadas: origem, UID, RECURRENCE-ID ('' se não se repete) e estado na origem.
alter table public.cal_events add column if not exists source_id uuid references public.cal_sources (id);
alter table public.cal_events add column if not exists source_uid text;
alter table public.cal_events add column if not exists source_rid text;
alter table public.cal_events add column if not exists source_state text
  check (source_state is null or source_state in ('ok', 'cancelado', 'removido', 'arquivado'));
alter table public.cal_events add column if not exists source_removed_at timestamptz;
alter table public.cal_events add column if not exists source_synced_at timestamptz;
create unique index if not exists cal_events_source_key on public.cal_events (source_id, source_uid, source_rid)
  where source_id is not null;

-- Configuração da sincronização automática (endereço e segredo partilhado com /api/icloud).
create table if not exists private.cal_icloud_config (
  id boolean primary key default true check (id),
  endpoint text,
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into private.cal_icloud_config (endpoint) values ('https://sistema-progresso.vercel.app/api/icloud')
on conflict (id) do nothing;
revoke all on private.cal_icloud_config from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
-- Pode ser chamada sem auth.uid() (função /api/icloud): verifica a pessoa indicada.
create or replace function private.cal_profile_is_admin(p_profile uuid, p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.memberships m where m.profile_id = p_profile and m.section_id = p_section
                    and m.status = 'ativo' and m.is_admin)
$$;

create or replace function private.cal_source_audit(p_section uuid, p_actor uuid, p_action text, p_source uuid, p_details jsonb)
returns void language sql security definer set search_path = ''
as $$
  insert into public.audit_log (section_id, actor, action, entity, entity_id, details)
  values (p_section, coalesce(p_actor, auth.uid()), p_action, 'cal_source', p_source::text, coalesce(p_details, '{}'::jsonb))
$$;

-- Primeiro e último dia (Lisboa) de uma atividade.
create or replace function private.cal_first_day(e public.cal_events)
returns date language sql stable set search_path = ''
as $$ select coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date) $$;
create or replace function private.cal_last_day(e public.cal_events)
returns date language sql stable set search_path = ''
as $$ select coalesce(e.end_date, (greatest(e.starts_at, e.ends_at - interval '1 microsecond') at time zone 'Europe/Lisbon')::date) $$;

-- Atividade importada de uma fonte ainda ativa: título, datas, local e descrição só mudam na origem.
create or replace function private.cal_source_readonly(e public.cal_events)
returns boolean language sql stable security definer set search_path = ''
as $$
  select e.source_id is not null and exists (select 1 from public.cal_sources s where s.id = e.source_id and s.status = 'ativa')
$$;

-- Origem de uma atividade (para listas e detalhe); null nas atividades criadas na app.
create or replace function private.cal_source_info(e public.cal_events)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select case when e.source_id is null then null else (
    select jsonb_build_object('id', s.id, 'kind', s.kind, 'name', s.name, 'state', coalesce(e.source_state, 'ok'),
             'removed_at', e.source_removed_at, 'synced_at', e.source_synced_at, 'source_status', s.status,
             'readonly', s.status = 'ativa')
      from public.cal_sources s where s.id = e.source_id) end
$$;

create or replace function private.cal_valid_reminders(p jsonb)
returns integer[] language plpgsql immutable set search_path = ''
as $$
declare v integer[];
begin
  if p is null or jsonb_typeof(p) <> 'array' then return '{}'; end if;
  v := array(select distinct x::int from jsonb_array_elements_text(p) x order by 1 desc);
  if cardinality(v) > 5 then raise exception 'No máximo cinco lembretes.'; end if;
  if exists (select 1 from unnest(v) m where m < 5 or m > 43200) then
    raise exception 'Os lembretes têm de ser entre 5 minutos e 30 dias antes.';
  end if;
  return v;
end
$$;

-- Público da fonte (secção ou equipa desta secção).
create or replace function private.cal_source_audience(p_section uuid, p_data jsonb, out audience text, out team_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
begin
  audience := coalesce(nullif(p_data ->> 'audience', ''), 'seccao');
  if audience not in ('seccao', 'equipa') then raise exception 'Público inválido.'; end if;
  team_id := null;
  if audience = 'equipa' then
    team_id := nullif(p_data ->> 'team_id', '')::uuid;
    if team_id is null then raise exception 'Escolhe a equipa.'; end if;
    if not exists (select 1 from public.teams t where t.id = team_id and t.section_id = p_section and t.archived_at is null) then
      raise exception 'Equipa não encontrada nesta secção.';
    end if;
  end if;
end
$$;

create or replace function private.cal_mask_url(p_url text)
returns text language sql immutable set search_path = ''
as $$
  select 'webcal://' || coalesce(substring(p_url from '^https://([^/?#]+)'), '?') || '/…' || right(p_url, 4)
$$;

-- ---------------------------------------------------------------------------
-- Gestão (só administração da secção)
-- ---------------------------------------------------------------------------
create or replace function private.cal_source_json(s public.cal_sources)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'space', s.space, 'kind', s.kind, 'name', s.name, 'calname', s.calname, 'url_mask', s.url_mask,
    'audience', s.audience, 'team_id', s.team_id, 'team_name', (select t.name from public.teams t where t.id = s.team_id),
    'reminder_minutes', to_jsonb(s.reminder_minutes), 'status', s.status,
    'created_at', s.created_at, 'created_by_name', (select p.full_name from public.profiles p where p.id = s.created_by),
    'stopped_at', s.stopped_at,
    'last_attempt_at', s.last_attempt_at, 'last_success_at', s.last_success_at,
    'last_error', s.last_error, 'last_error_at', s.last_error_at, 'failures', s.failures,
    'last_stats', s.last_stats, 'last_warning', s.last_warning, 'pending_removals', s.pending_removals,
    'event_count', s.event_count, 'range_from', s.range_from, 'range_to', s.range_to,
    'cancelled_count', (select count(*) from public.cal_events e where e.source_id = s.id and e.status = 'cancelado'),
    'removed_count', (select count(*) from public.cal_events e where e.source_id = s.id and e.source_state = 'removido'))
$$;

create or replace function public.cal_sources_list(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_auto boolean := false;
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  begin
    if to_regclass('cron.job') is not null then
      execute 'select exists (select 1 from cron.job where jobname = ''pioneiros-icloud'' and active)' into v_auto;
    end if;
  exception when others then v_auto := false;
  end;
  return jsonb_build_object(
    'calendar_status', private.module_status(p_section, 'calendario'),
    'auto_sync', v_auto,
    'sources', coalesce((select jsonb_agg(private.cal_source_json(s) order by s.status = 'arquivada', s.created_at)
                           from public.cal_sources s where s.section_id = p_section), '[]'::jsonb));
end
$$;

-- Nome, público e lembretes. O público e os lembretes passam também às atividades já
-- importadas (os lembretes só às que ainda não começaram).
create or replace function public.cal_source_update(p_section uuid, p_source uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.cal_sources; v_name text; v_aud record; v_rem integer[]; e public.cal_events;
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  select * into s from public.cal_sources where id = p_source and section_id = p_section for update;
  if s.id is null then raise exception 'Registo não encontrado.'; end if;
  if s.status = 'arquivada' then raise exception 'Esta ligação foi arquivada.'; end if;
  v_name := coalesce(nullif(trim(coalesce(p_data ->> 'name', '')), ''), s.name);
  if length(v_name) > 120 then raise exception 'O nome é demasiado longo (máximo 120 caracteres).'; end if;
  select * into v_aud from private.cal_source_audience(p_section, p_data);
  v_rem := case when p_data ? 'reminder_minutes' then private.cal_valid_reminders(p_data -> 'reminder_minutes') else s.reminder_minutes end;
  update public.cal_sources set name = v_name, audience = v_aud.audience, team_id = v_aud.team_id, reminder_minutes = v_rem,
         updated_by = auth.uid(), updated_at = now()
   where id = s.id;
  if (s.audience, s.team_id, s.reminder_minutes) is distinct from (v_aud.audience, v_aud.team_id, v_rem) then
    for e in select * from public.cal_events x where x.source_id = s.id and x.status = 'ativo' loop
      update public.cal_events set audience = v_aud.audience, team_id = v_aud.team_id,
             reminder_minutes = case when private.cal_start_instant(e) > now() then v_rem else reminder_minutes end,
             updated_at = now()
       where id = e.id;
      if private.cal_last_day(e) >= (now() at time zone 'Europe/Lisbon')::date then perform private.cal_sync_reminders(e.id); end if;
    end loop;
  end if;
  perform private.cal_source_audit(p_section, null, 'cal_icloud_alterado', s.id,
    jsonb_build_object('name', v_name, 'audience', v_aud.audience, 'team_id', v_aud.team_id, 'reminder_minutes', v_rem));
end
$$;

-- Desligar: «parar» deixa as atividades como estão (passam a ser editáveis na app);
-- «arquivar» também cancela as que ainda não terminaram. Atas, tarefas, presenças e
-- restantes registos ligados mantêm-se sempre. Nada se apaga.
create or replace function public.cal_source_disconnect(p_section uuid, p_source uuid, p_mode text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare s public.cal_sources; e public.cal_events; v_n integer := 0;
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  if coalesce(p_mode, '') not in ('parar', 'arquivar') then raise exception 'Escolhe como desligar.'; end if;
  select * into s from public.cal_sources where id = p_source and section_id = p_section for update;
  if s.id is null then raise exception 'Registo não encontrado.'; end if;
  if s.status = 'arquivada' then raise exception 'Esta ligação já foi arquivada.'; end if;
  update public.cal_sources set status = case when p_mode = 'parar' then 'parada' else 'arquivada' end,
         stopped_at = now(), stopped_by = auth.uid(), updated_by = auth.uid(), updated_at = now()
   where id = s.id;
  if p_mode = 'arquivar' then
    for e in select * from public.cal_events x where x.source_id = s.id and x.status = 'ativo'
                and private.cal_last_day(x) >= (now() at time zone 'Europe/Lisbon')::date loop
      update public.cal_events set status = 'cancelado', cancel_reason = 'Calendário do iCloud desligado (arquivado).',
             cancelled_at = now(), cancelled_by = null, source_state = 'arquivado', updated_at = now()
       where id = e.id;
      perform private.cal_sync_reminders(e.id);
      v_n := v_n + 1;
    end loop;
  end if;
  perform private.cal_source_audit(p_section, null, 'cal_icloud_desligado', s.id, jsonb_build_object('modo', p_mode, 'canceladas', v_n));
  return v_n;
end
$$;

-- Retomar as atualizações (a próxima sincronização volta a acertar tudo, sem duplicar).
create or replace function public.cal_source_resume(p_section uuid, p_source uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.cal_sources;
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  select * into s from public.cal_sources where id = p_source and section_id = p_section for update;
  if s.id is null then raise exception 'Registo não encontrado.'; end if;
  if s.status = 'ativa' then return; end if;
  if exists (select 1 from public.cal_sources o join private.cal_source_urls u on u.source_id = o.id
              where o.id <> s.id and o.section_id = s.section_id and o.space = s.space and o.status <> 'arquivada'
                and u.url = (select url from private.cal_source_urls where source_id = s.id)) then
    raise exception 'Este calendário já está ligado noutra fonte.';
  end if;
  update public.cal_sources set status = 'ativa', stopped_at = null, stopped_by = null, updated_by = auth.uid(), updated_at = now()
   where id = s.id;
  perform private.cal_source_audit(p_section, null, 'cal_icloud_retomado', s.id, '{}'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Funções só para a função /api/icloud (chave secreta do Supabase)
-- ---------------------------------------------------------------------------
create or replace function public.cal_icloud_check_secret(p_secret text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare c private.cal_icloud_config;
begin
  if not private.is_service_role() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into c from private.cal_icloud_config;
  return c.secret is not null and coalesce(p_secret, '') <> '' and p_secret = c.secret;
end
$$;

create or replace function public.cal_source_admin_ok(p_profile uuid, p_section uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_service_role() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  return private.cal_profile_is_admin(p_profile, p_section);
end
$$;

-- Fontes a sincronizar, com o link completo: todas as ativas (tarefa de hora a hora) ou
-- uma (com p_profile: «Sincronizar agora», só para a administração da secção).
create or replace function public.cal_source_targets(p_source uuid default null, p_profile uuid default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare s public.cal_sources;
begin
  if not private.is_service_role() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if p_source is not null then
    select * into s from public.cal_sources where id = p_source;
    if s.id is null or (p_profile is not null and not private.cal_profile_is_admin(p_profile, s.section_id)) then
      raise exception 'Registo não encontrado.' using errcode = '42501';
    end if;
    if s.status <> 'ativa' then raise exception 'As atualizações desta ligação estão paradas. Retoma-as primeiro.'; end if;
  elsif p_profile is not null then
    raise exception 'Indica a fonte.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'section_id', x.section_id, 'url', u.url) order by x.last_attempt_at nulls first)
      from public.cal_sources x join private.cal_source_urls u on u.source_id = x.id
     where x.status = 'ativa' and (p_source is null or x.id = p_source)), '[]'::jsonb);
end
$$;

-- Guarda uma fonte nova (depois de a função /api/icloud ter lido e validado o calendário).
-- p_data: url (https://), name, space ('real' | 'teste'), audience, team_id, reminder_minutes.
create or replace function public.cal_source_create(p_profile uuid, p_section uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_url text; v_name text; v_space text; v_aud record; v_rem integer[]; v_id uuid;
begin
  if not private.is_service_role() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if not private.cal_profile_is_admin(p_profile, p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  v_url := trim(coalesce(p_data ->> 'url', ''));
  if v_url !~ '^https://[^/?#@]+/' or length(v_url) > 2000 then raise exception 'Link inválido.'; end if;
  v_name := nullif(trim(coalesce(p_data ->> 'name', '')), '');
  if v_name is null then raise exception 'Indica o nome do calendário.'; end if;
  v_name := left(v_name, 120);
  v_space := coalesce(nullif(p_data ->> 'space', ''), 'real');
  if v_space not in ('real', 'teste') then raise exception 'Espaço inválido.'; end if;
  select * into v_aud from private.cal_source_audience(p_section, p_data);
  v_rem := private.cal_valid_reminders(p_data -> 'reminder_minutes');
  perform pg_advisory_xact_lock(hashtext('cal_source:' || p_section::text));
  if exists (select 1 from public.cal_sources s join private.cal_source_urls u on u.source_id = s.id
              where s.section_id = p_section and s.space = v_space and s.status <> 'arquivada' and u.url = v_url) then
    raise exception 'Este calendário já está ligado.';
  end if;
  insert into public.cal_sources (section_id, space, name, calname, url_mask, audience, team_id, reminder_minutes, created_by, updated_by)
  values (p_section, v_space, v_name, left(nullif(trim(coalesce(p_data ->> 'calname', '')), ''), 200), private.cal_mask_url(v_url),
          v_aud.audience, v_aud.team_id, v_rem, p_profile, p_profile)
  returning id into v_id;
  insert into private.cal_source_urls (source_id, url) values (v_id, v_url);
  perform private.cal_source_audit(p_section, p_profile, 'cal_icloud_ligado', v_id,
    jsonb_build_object('space', v_space, 'name', v_name, 'audience', v_aud.audience));
  return v_id;
end
$$;

-- Erro ao ler o calendário: fica registado; as atividades e as ligações não mudam.
create or replace function public.cal_source_fail(p_source uuid, p_error text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_service_role() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update public.cal_sources set last_attempt_at = now(), last_error = left(coalesce(nullif(trim(p_error), ''), 'Erro desconhecido.'), 500),
         last_error_at = now(), failures = failures + 1
   where id = p_source;
end
$$;

-- Aplica o conteúdo lido do iCloud. p_feed: { name, complete, window_from, window_to, items: [
--   { uid, rid, title, description, location, all_day, starts_at, ends_at, start_date, end_date, cancelled } ] }.
-- Cria, atualiza, cancela ou reativa pela chave fonte + UID + RECURRENCE-ID (sem duplicar e
-- mantendo as ligações). Só retira (marca «removida no iCloud») atividades que faltam se a
-- leitura foi completa e não vazia, dentro da janela lida, e — salvo p_force — se não forem
-- mais de metade (com pelo menos 5). Nunca apaga linhas e não envia notificações.
create or replace function public.cal_source_apply(p_source uuid, p_feed jsonb, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  s public.cal_sources; e public.cal_events; it record;
  v_keys text[]; v_from date; v_to date; v_complete boolean; v_title text; v_desc text; v_loc text;
  v_created int := 0; v_updated int := 0; v_cancelled int := 0; v_removed int := 0; v_reactivated int := 0;
  v_same int := 0; v_invalid int := 0; v_missing int; v_active int; v_warning text; v_pending int := 0;
  v_now timestamptz := now(); v_changed boolean; v_back boolean; v_stats jsonb;
begin
  if not private.is_service_role() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into s from public.cal_sources where id = p_source for update;
  if s.id is null then raise exception 'Registo não encontrado.'; end if;
  if s.status <> 'ativa' then return jsonb_build_object('skipped', true); end if;
  if jsonb_typeof(p_feed -> 'items') is distinct from 'array' then raise exception 'Conteúdo inválido.'; end if;
  v_from := (p_feed ->> 'window_from')::date;
  v_to := (p_feed ->> 'window_to')::date;
  v_complete := coalesce((p_feed ->> 'complete')::boolean, false) and v_from is not null and v_to is not null;
  v_keys := array(select coalesce(x ->> 'uid', '') || '|' || coalesce(x ->> 'rid', '') from jsonb_array_elements(p_feed -> 'items') x);

  for it in select * from jsonb_to_recordset(p_feed -> 'items') as x(
      uid text, rid text, title text, description text, location text, all_day boolean,
      starts_at timestamptz, ends_at timestamptz, start_date date, end_date date, cancelled boolean) loop
    it.rid := coalesce(it.rid, '');
    if coalesce(it.uid, '') = '' or length(it.uid) > 1000 or length(it.rid) > 100
       or (coalesce(it.all_day, false) and (it.start_date is null or it.end_date is null or it.end_date < it.start_date))
       or (not coalesce(it.all_day, false) and (it.starts_at is null or it.ends_at is null or it.ends_at < it.starts_at)) then
      v_invalid := v_invalid + 1;
      continue;
    end if;
    v_title := left(coalesce(nullif(trim(it.title), ''), '(Sem título)'), 200);
    v_desc := left(nullif(trim(it.description), ''), 5000);
    v_loc := left(nullif(trim(it.location), ''), 300);

    e := null;
    select * into e from public.cal_events where source_id = s.id and source_uid = it.uid and source_rid = it.rid for update;
    -- A série mudou de hora: a ocorrência do mesmo dia mantém-se (e as ligações com ela).
    if e.id is null and it.rid <> '' then
      select * into e from public.cal_events x
       where x.source_id = s.id and x.source_uid = it.uid and x.source_rid <> '' and left(x.source_rid, 8) = left(it.rid, 8)
         and not ((x.source_uid || '|' || x.source_rid) = any (v_keys))
       order by x.created_at limit 1 for update;
    end if;

    if e.id is null then
      if coalesce(it.cancelled, false) then continue; end if;
      insert into public.cal_events (section_id, space, title, description, location, all_day, starts_at, ends_at, start_date, end_date,
        audience, team_id, reminder_minutes, deadline_reminder_minutes, status, created_by, created_at, updated_at,
        source_id, source_uid, source_rid, source_state, source_synced_at)
      values (s.section_id, s.space, v_title, v_desc, v_loc, it.all_day,
        case when it.all_day then null else it.starts_at end, case when it.all_day then null else it.ends_at end,
        case when it.all_day then it.start_date end, case when it.all_day then it.end_date end,
        s.audience, s.team_id, s.reminder_minutes, '{}', 'ativo', s.created_by, v_now, v_now,
        s.id, it.uid, it.rid, 'ok', v_now)
      returning * into e;
      if cardinality(s.reminder_minutes) > 0 then perform private.cal_sync_reminders(e.id); end if;
      v_created := v_created + 1;
      continue;
    end if;

    if coalesce(it.cancelled, false) then
      if e.status = 'ativo' then
        update public.cal_events set status = 'cancelado', cancel_reason = 'Cancelada no iCloud.', cancelled_at = v_now,
               cancelled_by = null, source_state = 'cancelado', source_rid = it.rid, source_synced_at = v_now, updated_at = v_now
         where id = e.id;
        perform private.cal_sync_reminders(e.id);
        v_cancelled := v_cancelled + 1;
      else
        update public.cal_events set source_synced_at = v_now, source_rid = it.rid where id = e.id;
        v_same := v_same + 1;
      end if;
      continue;
    end if;

    v_changed := (e.title, e.description, e.location, e.all_day, e.starts_at, e.ends_at, e.start_date, e.end_date, e.source_rid)
      is distinct from (v_title, v_desc, v_loc, it.all_day,
        case when it.all_day then null else it.starts_at end, case when it.all_day then null else it.ends_at end,
        case when it.all_day then it.start_date end, case when it.all_day then it.end_date end, it.rid);
    -- Volta a existir no iCloud: reativa só o que a sincronização tinha cancelado.
    v_back := e.status = 'cancelado' and e.cancelled_by is null and coalesce(e.source_state, 'ok') <> 'ok';
    if v_changed or v_back then
      update public.cal_events set
        title = v_title, description = v_desc, location = v_loc, all_day = it.all_day,
        starts_at = case when it.all_day then null else it.starts_at end, ends_at = case when it.all_day then null else it.ends_at end,
        start_date = case when it.all_day then it.start_date end, end_date = case when it.all_day then it.end_date end,
        source_rid = it.rid, source_synced_at = v_now, updated_at = v_now,
        status = case when v_back then 'ativo' else status end,
        cancel_reason = case when v_back then null else cancel_reason end,
        cancelled_at = case when v_back then null else cancelled_at end,
        source_state = case when v_back then 'ok' else source_state end,
        source_removed_at = case when v_back then null else source_removed_at end
      where id = e.id;
      perform private.cal_sync_reminders(e.id);
      if v_back then v_reactivated := v_reactivated + 1; else v_updated := v_updated + 1; end if;
    else
      update public.cal_events set source_synced_at = v_now where id = e.id;
      v_same := v_same + 1;
    end if;
  end loop;

  -- Atividades que deixaram de vir do iCloud (só dentro da janela lida e com leitura completa).
  if v_invalid > 0 then v_complete := false; end if;
  if not v_complete then
    v_warning := 'A leitura não foi completa: nenhuma atividade foi retirada.';
  elsif jsonb_array_length(p_feed -> 'items') = 0 then
    v_warning := 'O calendário veio vazio: por segurança, nenhuma atividade foi retirada.';
  else
    select count(*) filter (where not ((x.source_uid || '|' || x.source_rid) = any (v_keys))), count(*)
      into v_missing, v_active
      from public.cal_events x
     where x.source_id = s.id and x.status = 'ativo'
       and private.cal_first_day(x) <= v_to and private.cal_last_day(x) >= v_from;
    if v_missing > 0 and not coalesce(p_force, false) and v_missing >= 5 and v_missing * 2 > v_active then
      v_pending := v_missing;
      v_warning := v_missing || ' atividades deixaram de aparecer no iCloud (de ' || v_active || '). Por segurança, nada foi retirado: confirma em «Sincronizar agora».';
    elsif v_missing > 0 then
      for e in select * from public.cal_events x
                where x.source_id = s.id and x.status = 'ativo' and not ((x.source_uid || '|' || x.source_rid) = any (v_keys))
                  and private.cal_first_day(x) <= v_to and private.cal_last_day(x) >= v_from
                for update loop
        update public.cal_events set status = 'cancelado', cancel_reason = 'Removida no iCloud.', cancelled_at = v_now,
               cancelled_by = null, source_state = 'removido', source_removed_at = v_now, updated_at = v_now
         where id = e.id;
        perform private.cal_sync_reminders(e.id);
        v_removed := v_removed + 1;
      end loop;
    end if;
  end if;

  v_stats := jsonb_build_object('criadas', v_created, 'atualizadas', v_updated, 'canceladas', v_cancelled,
    'removidas', v_removed, 'reativadas', v_reactivated, 'sem_alteracao', v_same, 'ignoradas', v_invalid);
  update public.cal_sources x set
    calname = coalesce(left(nullif(trim(p_feed ->> 'name'), ''), 200), x.calname),
    last_attempt_at = v_now, last_success_at = v_now, last_error = null, last_error_at = null, failures = 0,
    last_stats = v_stats, last_warning = v_warning, pending_removals = v_pending,
    event_count = (select count(*) from public.cal_events c where c.source_id = s.id and c.status = 'ativo'),
    range_from = (select min(private.cal_first_day(c)) from public.cal_events c where c.source_id = s.id and c.status = 'ativo'),
    range_to = (select max(private.cal_last_day(c)) from public.cal_events c where c.source_id = s.id and c.status = 'ativo')
  where x.id = s.id;
  if v_created + v_updated + v_cancelled + v_removed + v_reactivated > 0 then
    perform private.cal_source_audit(s.section_id, null, 'cal_icloud_sincronizado', s.id, v_stats);
  end if;
  return v_stats;
end
$$;

-- ---------------------------------------------------------------------------
-- Calendário: origem nas listas e no detalhe; dados da origem só de leitura
-- ---------------------------------------------------------------------------
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
        from public.cal_participants cc where cc.event_id = e.id and cc.profile_id = any (x.inv)),
      'source', private.cal_source_info(e))
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
    'source', private.cal_source_info(e),
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

-- Como na v1; nas atividades importadas (fonte ativa) o título, as datas, o local e a
-- descrição não se alteram na app — o resto (público, responsável, pendências, lembretes) sim.
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
  if private.cal_source_readonly(o) then
    if (n.title, n.description, n.location, n.all_day, date_trunc('minute', n.starts_at), date_trunc('minute', n.ends_at), n.start_date, n.end_date)
       is distinct from (o.title, o.description, o.location, o.all_day, date_trunc('minute', o.starts_at), date_trunc('minute', o.ends_at), o.start_date, o.end_date) then
      raise exception 'Esta atividade vem do iCloud: o título, as datas, o local e a descrição alteram-se no iCloud.';
    end if;
    n.title := o.title; n.description := o.description; n.location := o.location; n.all_day := o.all_day;
    n.starts_at := o.starts_at; n.ends_at := o.ends_at; n.start_date := o.start_date; n.end_date := o.end_date;
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
  if private.cal_source_readonly(e) then
    raise exception 'Esta atividade vem do iCloud: cancela-a ou apaga-a no iCloud.';
  end if;
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
-- Sincronização de hora a hora: pg_cron chama /api/icloud (pg_net) com o segredo.
-- Sem as extensões, a migração aplica-se na mesma e fica só «Sincronizar agora».
-- ---------------------------------------------------------------------------
create or replace function private.cal_icloud_tick()
returns void language plpgsql security definer set search_path = ''
as $$
declare c private.cal_icloud_config;
begin
  if not exists (select 1 from public.cal_sources where status = 'ativa') then return; end if;
  select * into c from private.cal_icloud_config;
  if c.endpoint is null then return; end if;
  perform net.http_post(
    url := c.endpoint,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', c.secret),
    timeout_milliseconds := 55000);
exception when others then
  raise notice 'Sincronização do iCloud não pedida: %', sqlerrm;
end
$$;
revoke all on function private.cal_icloud_tick() from public, anon, authenticated;

do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net indisponível: a sincronização automática do iCloud fica desligada (usa «Sincronizar agora»).';
end $$;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('pioneiros-icloud', '17 * * * *', 'select private.cal_icloud_tick()');
exception when others then
  raise notice 'pg_cron indisponível: ativa-o em Database › Extensions e volta a correr esta migração para a sincronização de hora a hora.';
end $$;

revoke all on function private.cal_source_audit(uuid, uuid, text, uuid, jsonb), private.cal_profile_is_admin(uuid, uuid)
  from public, anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;
revoke execute on function public.cal_icloud_check_secret(text), public.cal_source_admin_ok(uuid, uuid),
  public.cal_source_targets(uuid, uuid), public.cal_source_create(uuid, uuid, jsonb), public.cal_source_fail(uuid, text),
  public.cal_source_apply(uuid, jsonb, boolean) from authenticated;
grant execute on function public.cal_icloud_check_secret(text), public.cal_source_admin_ok(uuid, uuid),
  public.cal_source_targets(uuid, uuid), public.cal_source_create(uuid, uuid, jsonb), public.cal_source_fail(uuid, text),
  public.cal_source_apply(uuid, jsonb, boolean) to service_role;
