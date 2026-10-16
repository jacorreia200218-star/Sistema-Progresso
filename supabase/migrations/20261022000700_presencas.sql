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
