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
