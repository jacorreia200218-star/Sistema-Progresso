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
