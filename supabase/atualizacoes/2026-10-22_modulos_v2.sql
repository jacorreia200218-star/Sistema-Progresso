-- Atualização «Módulos v2» (22/10/2026) para um projeto já instalado (com a atualização
-- 2026-10-21_modulos.sql já aplicada). Cola no SQL Editor e carrega em «Run» UMA vez.
-- Calendário anual, Inventário com «A comprar», Tesouraria com painel e saldo inicial,
-- «Reuniões e tarefas» (sumários e quadro de tarefas) e o novo módulo Presenças.
-- Não altera o estado dos módulos, os testers nem as permissões, e preserva os dados existentes.

-- ===== supabase/migrations/20261022000100_modulos_v2_base.sql =====
-- Pioneiros — módulos, segunda versão: novo módulo «Presenças» (prefixo pres_) e novas
-- permissões. O módulo «secretaria» passa a chamar-se «Reuniões e tarefas» na interface
-- (a chave interna mantém-se, para preservar os dados).
-- Aditivo: não altera dados, estados, testers nem permissões existentes.

alter table public.module_settings drop constraint if exists module_settings_module_check;
alter table public.module_settings add constraint module_settings_module_check
  check (module in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria', 'presencas'));
alter table public.module_testers drop constraint if exists module_testers_module_check;
alter table public.module_testers add constraint module_testers_module_check
  check (module in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria', 'presencas'));
alter table public.module_grants drop constraint if exists module_grants_permission_check;
alter table public.module_grants add constraint module_grants_permission_check check (permission in (
  'calendario.gerir', 'inventario.gerir', 'tesouraria.gerir', 'equipas.gerir',
  'secretaria.redigir', 'secretaria.aprovar', 'presencas.registar'));

create or replace function private.module_prefix(p_module text)
returns text language sql immutable set search_path = ''
as $$
  select case p_module when 'calendario' then 'cal_' when 'inventario' then 'inv_' when 'tesouraria' then 'fin_'
                       when 'equipas' then 'eq_' when 'secretaria' then 'sec_' when 'presencas' then 'pres_' end
$$;

create or replace function public.my_modules(p_section uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'module', k,
    'status', private.module_status(p_section, k),
    'space', private.module_space(p_section, k),
    'grants', coalesce((select jsonb_agg(g.permission) from public.module_grants g
                         where g.section_id = p_section and g.profile_id = auth.uid() and g.permission like k || '.%'), '[]'::jsonb),
    'dirigente', private.is_dirigente(p_section)
  ) order by k), '[]'::jsonb)
  from unnest(array['calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria', 'presencas']) k
  where private.is_active_member(p_section)
$$;

create or replace function public.module_admin_overview(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  return (
    select jsonb_agg(jsonb_build_object(
      'module', k,
      'status', private.module_status(p_section, k),
      'testers', coalesce((select jsonb_agg(t.profile_id order by t.added_at) from public.module_testers t
                            where t.section_id = p_section and t.module = k), '[]'::jsonb),
      'grants', coalesce((select jsonb_agg(jsonb_build_object('permission', g.permission, 'profile_id', g.profile_id) order by g.granted_at)
                           from public.module_grants g where g.section_id = p_section and g.permission like k || '.%'), '[]'::jsonb)
    ) order by k)
    from unnest(array['calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria', 'presencas']) k
  );
end
$$;

create or replace function public.set_module_status(p_section uuid, p_module text, p_status text, p_move_test_data boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_old text; v_t text; v_c text;
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  if p_status not in ('desenvolvimento', 'teste', 'disponivel') then raise exception 'Estado inválido.'; end if;
  if p_module not in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria', 'presencas') then raise exception 'Módulo inválido.'; end if;
  v_old := private.module_status(p_section, p_module);
  insert into public.module_settings (section_id, module, status, updated_by, updated_at)
  values (p_section, p_module, p_status, auth.uid(), now())
  on conflict (section_id, module) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = now();
  -- Passar os dados de teste para reais só por escolha explícita, ao publicar.
  if coalesce(p_move_test_data, false) then
    if p_status <> 'disponivel' then raise exception 'Os dados de teste só passam a reais ao publicar.'; end if;
    -- Um módulo pode definir private.<módulo>_publish_move(secção) quando a passagem
    -- precisa de regras próprias (ou não é permitida); senão, passam todas as tabelas.
    if to_regprocedure('private.' || p_module || '_publish_move(uuid)') is not null then
      execute format('select private.%I($1)', p_module || '_publish_move') using p_section;
    else
      foreach v_t in array private.module_tables(p_module) loop
        execute format('update public.%I set space = ''real'' where section_id = $1 and space = ''teste''', v_t) using p_section;
      end loop;
    end if;
    update public.module_files set space = 'real' where section_id = p_section and module = p_module and space = 'teste';
    -- Lembretes ainda por enviar passam com os dados (senão nunca seriam enviados).
    update public.module_reminders set space = 'real'
     where section_id = p_section and module = p_module and space = 'teste' and sent_at is null;
    -- Registos agora reais não ficam ligados a atividades do Calendário que continuam
    -- de teste: a ligação opcional é retirada (o registo mantém-se).
    if to_regclass('public.cal_events') is not null and p_module <> 'calendario' then
      for v_t, v_c in
        select c.conrelid::regclass::text, a.attname::text
          from pg_constraint c
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f' and c.confrelid = 'public.cal_events'::regclass and not a.attnotnull
           and c.conrelid::regclass::text like 'public.' || private.module_prefix(p_module) || '%'
            or c.contype = 'f' and c.confrelid = 'public.cal_events'::regclass and not a.attnotnull
           and c.conrelid::regclass::text like private.module_prefix(p_module) || '%'
      loop
        execute format('update %s t set %I = null where t.section_id = $1 and t.space = ''real'' and t.%I is not null
                          and not exists (select 1 from public.cal_events e where e.id = t.%I and e.space = ''real'')', v_t, v_c, v_c, v_c)
          using p_section;
      end loop;
    end if;
  end if;
  perform private.audit(p_section, 'modulo_estado', 'module', p_module,
    jsonb_build_object('de', v_old, 'para', p_status, 'dados_teste_para_reais', coalesce(p_move_test_data, false)));
end
$$;

create or replace function public.set_module_tester(p_section uuid, p_module text, p_profile uuid, p_on boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  if p_module not in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria', 'presencas') then raise exception 'Módulo inválido.'; end if;
  if p_on then
    if not exists (select 1 from public.memberships where section_id = p_section and profile_id = p_profile and status = 'ativo') then
      raise exception 'Só membros ativos da secção podem testar módulos.';
    end if;
    insert into public.module_testers (section_id, module, profile_id, added_by) values (p_section, p_module, p_profile, auth.uid())
    on conflict do nothing;
  else
    delete from public.module_testers where section_id = p_section and module = p_module and profile_id = p_profile;
  end if;
  perform private.audit(p_section, case when p_on then 'tester_adicionado' else 'tester_removido' end, 'module', p_module,
    jsonb_build_object('profile', p_profile));
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;

-- ===== supabase/migrations/20261022000200_calendario_v2.sql =====
-- Pioneiros — Calendário escutista v2: calendário anual.
-- Acrescenta (sem alterar dados existentes):
--  * cal_special_days: feriado municipal e outros dias relevantes da secção, por espaço
--    (teste/real), num dia único ou recorrentes todos os anos. Nunca se apagam: retirar um
--    dia marca-o como anulado (quem e quando).
--  * cal_settings: configuração por secção e espaço (mês inicial do ano escutista; por
--    omissão setembro).
-- Os feriados nacionais (fixos e móveis) são calculados no cliente e não se guardam.
-- As atividades (cal_events) e as restantes funções da v1 mantêm-se.

create table if not exists public.cal_special_days (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  day date not null,
  name text not null check (length(trim(name)) between 1 and 120),
  kind text not null check (kind in ('municipal', 'relevante')),
  recurring boolean not null default false,
  status text not null default 'ativo' check (status in ('ativo', 'anulado')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  cancelled_by uuid,
  cancelled_at timestamptz
);
create index if not exists cal_special_days_section on public.cal_special_days (section_id, space);
alter table public.cal_special_days enable row level security;

create table if not exists public.cal_settings (
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  year_start_month integer not null default 9 check (year_start_month between 1 and 12),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (section_id, space)
);
alter table public.cal_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Consulta: configuração e dias especiais (todos os que têm acesso ao módulo)
-- ---------------------------------------------------------------------------
create or replace function public.cal_config(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'calendario');
begin
  return jsonb_build_object(
    'year_start_month', coalesce((select s.year_start_month from public.cal_settings s
                                   where s.section_id = p_section and s.space = v_space), 9),
    'can_manage', private.cal_can_manage(p_section),
    'special_days', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'day', d.day, 'name', d.name, 'kind', d.kind, 'recurring', d.recurring)
                       order by d.recurring desc, to_char(d.day, 'MM-DD'), d.day, d.name)
        from public.cal_special_days d
       where d.section_id = p_section and d.space = v_space and d.status = 'ativo'), '[]'::jsonb));
end
$$;

-- ---------------------------------------------------------------------------
-- Gestão (dirigentes ou «calendario.gerir»)
-- ---------------------------------------------------------------------------
create or replace function public.cal_set_year_start(p_section uuid, p_month integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
        v_old integer;
begin
  if p_month is null or p_month < 1 or p_month > 12 then raise exception 'Mês inválido (1 a 12).'; end if;
  select year_start_month into v_old from public.cal_settings where section_id = p_section and space = v_space for update;
  insert into public.cal_settings (section_id, space, year_start_month, updated_by, updated_at)
  values (p_section, v_space, p_month, auth.uid(), now())
  on conflict (section_id, space) do update set year_start_month = excluded.year_start_month,
    updated_by = excluded.updated_by, updated_at = now();
  perform private.audit(p_section, 'cal_ano_escutista', 'cal_settings', p_section::text,
    jsonb_build_object('space', v_space, 'de', coalesce(v_old, 9), 'para', p_month));
end
$$;

-- Cria (p_id vazio) ou corrige um dia especial. p_data: day (AAAA-MM-DD), name, kind
-- ('municipal' | 'relevante'), recurring (todos os anos).
create or replace function public.cal_special_day_save(p_section uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
        v_day date; v_name text; v_kind text; v_rec boolean; o public.cal_special_days; v_id uuid;
begin
  v_name := nullif(trim(coalesce(p_data ->> 'name', '')), '');
  if v_name is null then raise exception 'Indica o nome do dia.'; end if;
  if length(v_name) > 120 then raise exception 'O nome é demasiado longo (máximo 120 caracteres).'; end if;
  begin
    v_day := (p_data ->> 'day')::date;
  exception when others then
    raise exception 'Data inválida. Usa o formato DD/MM/AAAA.';
  end;
  if v_day is null then raise exception 'Indica a data.'; end if;
  v_kind := coalesce(nullif(p_data ->> 'kind', ''), 'relevante');
  if v_kind not in ('municipal', 'relevante') then raise exception 'Tipo de dia inválido.'; end if;
  v_rec := coalesce((p_data ->> 'recurring')::boolean, false);

  if p_id is null then
    insert into public.cal_special_days (section_id, space, day, name, kind, recurring, created_by, updated_by)
    values (p_section, v_space, v_day, v_name, v_kind, v_rec, auth.uid(), auth.uid())
    returning id into v_id;
    perform private.audit(p_section, 'cal_dia_especial_criado', 'cal_special_day', v_id::text,
      jsonb_build_object('space', v_space, 'day', v_day, 'name', v_name, 'kind', v_kind, 'recurring', v_rec));
    return v_id;
  end if;

  select * into o from public.cal_special_days where id = p_id and section_id = p_section and space = v_space for update;
  if o.id is null then raise exception 'Registo não encontrado.'; end if;
  if o.status <> 'ativo' then raise exception 'Este dia foi retirado e já não pode ser alterado.'; end if;
  update public.cal_special_days set day = v_day, name = v_name, kind = v_kind, recurring = v_rec,
         updated_by = auth.uid(), updated_at = now()
   where id = o.id;
  perform private.audit(p_section, 'cal_dia_especial_alterado', 'cal_special_day', o.id::text,
    jsonb_build_object('antes', jsonb_build_object('day', o.day, 'name', o.name, 'kind', o.kind, 'recurring', o.recurring),
                       'depois', jsonb_build_object('day', v_day, 'name', v_name, 'kind', v_kind, 'recurring', v_rec)));
  return o.id;
end
$$;

-- Retirar um dia especial: fica anulado (não se apaga).
create or replace function public.cal_special_day_remove(p_section uuid, p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
        o public.cal_special_days;
begin
  select * into o from public.cal_special_days where id = p_id and section_id = p_section and space = v_space for update;
  if o.id is null then raise exception 'Registo não encontrado.'; end if;
  if o.status <> 'ativo' then raise exception 'Este dia já foi retirado.'; end if;
  update public.cal_special_days set status = 'anulado', cancelled_by = auth.uid(), cancelled_at = now(),
         updated_by = auth.uid(), updated_at = now()
   where id = o.id;
  perform private.audit(p_section, 'cal_dia_especial_retirado', 'cal_special_day', o.id::text,
    jsonb_build_object('day', o.day, 'name', o.name));
end
$$;

-- ---------------------------------------------------------------------------
-- Publicar com «passar dados de teste a reais»: tal como na v1 (atividades, respostas e
-- lembretes por enviar), mais os dias especiais. A configuração de teste só passa a real
-- se o espaço real ainda não tiver configuração própria (a real nunca é substituída).
-- ---------------------------------------------------------------------------
create or replace function private.calendario_publish_move(p_section uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_t text;
begin
  foreach v_t in array private.module_tables('calendario') loop
    continue when v_t = 'cal_settings';
    execute format('update public.%I set space = ''real'' where section_id = $1 and space = ''teste''', v_t) using p_section;
  end loop;
  update public.cal_settings t set space = 'real'
   where t.section_id = p_section and t.space = 'teste'
     and not exists (select 1 from public.cal_settings r where r.section_id = p_section and r.space = 'real');
  update public.module_reminders set space = 'real'
   where section_id = p_section and module = 'calendario' and space = 'teste' and sent_at is null;
end
$$;

revoke all on function private.calendario_publish_move(uuid) from public, anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;

-- ===== supabase/migrations/20261022000300_inventario_v2.sql =====
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

-- ===== supabase/migrations/20261022000400_tesouraria_v2.sql =====
-- Pioneiros — Tesouraria, segunda versão: painel financeiro com saldo inicial explícito,
-- fórmula «Saldo atual = Saldo inicial + Receitas − Despesas», evolução do saldo, filtros
-- por mês / ano escutista / atividade e lista de movimentos partilhados com pesquisa.
--
-- • Saldo inicial (fin_opening_balances): global OU por conta/caixa (nunca os dois ao mesmo
--   tempo), com data de referência. É o saldo no INÍCIO desse dia: já inclui tudo o que
--   aconteceu antes. Por isso, movimentos com data anterior à data de referência (da conta
--   ou global) ficam registados e visíveis, mas não somam outra vez ao saldo atual.
-- • Só contam no saldo os movimentos efetivos e não anulados; pendentes e previstos à parte.
-- • Quem consulta (acesso ao módulo, sem «tesouraria.gerir») vê os movimentos partilhados:
--   data, descrição, categoria, valor, estado e atividade. Nunca vê quem fez um pagamento
--   individual de outra pessoa (a descrição é substituída por «Pagamento individual»), nem
--   observações, nem comprovativos alheios, nem movimentos anulados.
-- • public.fin_create_movement mantém assinatura e comportamento (usada pelo Inventário).
-- Aditivo: não altera nem apaga dados nem permissões existentes.

-- ---------------------------------------------------------------------------
-- Saldo inicial
-- ---------------------------------------------------------------------------
create table if not exists public.fin_opening_balances (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  account_id uuid references public.fin_accounts (id),   -- null = saldo inicial global
  reference_date date not null,
  amount_cents bigint not null check (amount_cents between -100000000000 and 100000000000),
  notes text check (notes is null or length(notes) <= 500),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (voided_at is null or (void_reason is not null and length(trim(void_reason)) > 0))
);
-- Um só saldo inicial ativo por conta/caixa (ou global) em cada espaço.
create unique index if not exists fin_opening_one on public.fin_opening_balances
  (section_id, space, coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid)) where voided_at is null;
alter table public.fin_opening_balances enable row level security;

drop trigger if exists fin_audit on public.fin_opening_balances;
create trigger fin_audit after insert or update on public.fin_opening_balances
  for each row execute function private.fin_audit_trg();

-- ---------------------------------------------------------------------------
-- Regras de cálculo
-- ---------------------------------------------------------------------------
-- Ano escutista (setembro a agosto): devolve o ano em que começa.
create or replace function private.fin_scout_year(p_day date)
returns int language sql immutable set search_path = ''
as $$
  select case when extract(month from p_day) >= 9 then extract(year from p_day)::int else extract(year from p_day)::int - 1 end
$$;

-- O movimento é efetivo e não anulado, mas tem data anterior ao saldo inicial que o cobre
-- (já está incluído nesse saldo): não soma outra vez.
create or replace function private.fin_before_opening(m public.fin_movements)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.fin_opening_balances o
                  where o.section_id = m.section_id and o.space = m.space and o.voided_at is null
                    and (o.account_id is null or o.account_id = m.account_id)
                    and m.occurred_on < o.reference_date)
$$;

-- Movimentos que contam no saldo atual: efetivos, não anulados e não anteriores ao saldo inicial.
create or replace function private.fin_counted(p_section uuid, p_space text)
returns setof public.fin_movements language sql stable security definer set search_path = ''
as $$
  select m.* from public.fin_movements m
   where m.section_id = p_section and m.space = p_space and m.state = 'efetivo' and m.voided_at is null
     and not exists (select 1 from public.fin_opening_balances o
                      where o.section_id = p_section and o.space = p_space and o.voided_at is null
                        and (o.account_id is null or o.account_id = m.account_id)
                        and m.occurred_on < o.reference_date)
$$;

-- Saldo no fim do dia (p_end_of_day) ou no início do dia indicado.
create or replace function private.fin_balance_at(p_section uuid, p_space text, p_day date, p_end_of_day boolean)
returns bigint language sql stable security definer set search_path = ''
as $$
  select coalesce((select sum(o.amount_cents) from public.fin_opening_balances o
                    where o.section_id = p_section and o.space = p_space and o.voided_at is null and o.reference_date <= p_day), 0)::bigint
       + coalesce((select sum(case when c.kind = 'receita' then c.amount_cents else -c.amount_cents end)
                     from private.fin_counted(p_section, p_space) c
                    where c.occurred_on < p_day or (p_end_of_day and c.occurred_on = p_day)), 0)::bigint
$$;

-- Movimento como o vê quem só consulta: sem membro, sem observações, sem conta; a descrição
-- de um pagamento individual de outra pessoa é substituída; comprovativos só nos seus.
create or replace function private.fin_shared_json(m public.fin_movements)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'kind', m.kind, 'occurred_on', m.occurred_on,
    'description', case when m.member_profile_id is null or m.member_profile_id = auth.uid() then m.description else 'Pagamento individual' end,
    'category', m.category, 'amount_cents', m.amount_cents, 'state', m.state,
    'activity_id', m.activity_id, 'activity_title', (select e.title from public.cal_events e where e.id = m.activity_id and e.space = m.space),
    'individual', m.member_profile_id is not null, 'mine', coalesce(m.member_profile_id = auth.uid(), false),
    'voided_at', m.voided_at,
    'files', case when m.member_profile_id = auth.uid() then
               (select count(*) from public.module_files f where f.module = 'tesouraria' and f.entity = 'movimento'
                   and f.entity_id = m.id and f.removed_at is null) else 0 end
  )
$$;

create or replace function private.fin_opening_json(o public.fin_opening_balances, p_manage boolean)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'account_id', o.account_id,
    'account_name', (select a.name from public.fin_accounts a where a.id = o.account_id),
    'reference_date', o.reference_date, 'amount_cents', o.amount_cents)
  || case when p_manage then jsonb_build_object('notes', o.notes,
       'created_by_name', private.fin_name(o.created_by), 'created_at', o.created_at,
       'updated_by_name', private.fin_name(o.updated_by), 'updated_at', o.updated_at) else '{}'::jsonb end
$$;

-- ---------------------------------------------------------------------------
-- Saldo inicial: definir, alterar (auditado) e anular com motivo
-- ---------------------------------------------------------------------------
create or replace function public.fin_save_opening_balance(
  p_section uuid, p_id uuid, p_account uuid, p_reference_date date, p_amount bigint, p_notes text default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); o public.fin_opening_balances; v_id uuid;
begin
  if p_reference_date is null then raise exception 'Indica a data de referência do saldo inicial.'; end if;
  if p_reference_date < date '2000-01-01' or p_reference_date > (now() at time zone 'Europe/Lisbon')::date then
    raise exception 'A data de referência não pode ser futura.';
  end if;
  if p_amount is null then raise exception 'Indica o valor do saldo inicial (pode ser 0,00 €).'; end if;
  if abs(p_amount) > 100000000000 then raise exception 'O valor é demasiado elevado.'; end if;
  if length(coalesce(p_notes, '')) > 500 then raise exception 'As notas têm no máximo 500 caracteres.'; end if;
  if p_account is not null and not exists (select 1 from public.fin_accounts a where a.id = p_account and a.section_id = p_section and a.space = v_space) then
    raise exception 'Escolhe uma conta ou caixa válida.';
  end if;
  -- Evita dois saldos iniciais em simultâneo (global vs. por conta) por pedidos concorrentes.
  perform pg_advisory_xact_lock(hashtext('fin_opening:' || p_section::text || ':' || v_space));
  if p_id is not null then
    select * into o from public.fin_opening_balances where id = p_id and section_id = p_section and space = v_space for update;
    if o.id is null then raise exception 'Registo não encontrado.'; end if;
    if o.voided_at is not null then raise exception 'Este saldo inicial está anulado e já não se altera.'; end if;
    if o.account_id is distinct from p_account then
      raise exception 'Para mudar a conta ou caixa, anula este saldo inicial e define outro.';
    end if;
  end if;
  if p_account is null and exists (select 1 from public.fin_opening_balances where section_id = p_section and space = v_space
                                      and voided_at is null and account_id is not null) then
    raise exception 'Já há saldos iniciais por conta ou caixa. Para usar um saldo inicial global, anula-os primeiro.';
  end if;
  if p_account is not null and exists (select 1 from public.fin_opening_balances where section_id = p_section and space = v_space
                                          and voided_at is null and account_id is null) then
    raise exception 'Já há um saldo inicial global. Para usar saldos por conta ou caixa, anula-o primeiro.';
  end if;
  if exists (select 1 from public.fin_opening_balances where section_id = p_section and space = v_space and voided_at is null
              and account_id is not distinct from p_account and id is distinct from p_id) then
    raise exception 'Já existe um saldo inicial para esta conta ou caixa: altera-o em vez de criar outro.';
  end if;
  if p_id is null then
    insert into public.fin_opening_balances (section_id, space, account_id, reference_date, amount_cents, notes, created_by)
    values (p_section, v_space, p_account, p_reference_date, p_amount, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
    returning id into v_id;
  else
    update public.fin_opening_balances set reference_date = p_reference_date, amount_cents = p_amount,
           notes = nullif(trim(coalesce(p_notes, '')), ''), updated_by = auth.uid(), updated_at = now()
     where id = p_id returning id into v_id;
  end if;
  return v_id;
end
$$;

create or replace function public.fin_void_opening_balance(p_section uuid, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section);
begin
  if length(trim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'Indica o motivo da anulação.'; end if;
  update public.fin_opening_balances set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason),
         updated_by = auth.uid(), updated_at = now()
   where id = p_id and section_id = p_section and space = v_space and voided_at is null;
  if not found then raise exception 'Registo não encontrado.'; end if;
end
$$;

-- Saldos iniciais (ativos e, para quem gere, também os anulados).
create or replace function public.fin_list_opening_balances(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria'); v_manage boolean := private.fin_can_manage(p_section);
begin
  return coalesce((select jsonb_agg(private.fin_opening_json(o, v_manage)
                                    || jsonb_build_object('voided_at', o.voided_at,
                                                          'void_reason', case when v_manage then o.void_reason end)
                                    order by o.voided_at nulls first, o.account_id nulls first, o.reference_date)
                     from public.fin_opening_balances o
                    where o.section_id = p_section and o.space = v_space and (v_manage or o.voided_at is null)), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Painel financeiro
-- ---------------------------------------------------------------------------
create or replace function public.fin_dashboard(
  p_section uuid, p_from date default null, p_to date default null, p_activity uuid default null
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'tesouraria');
  v_manage boolean := private.fin_can_manage(p_section);
  v_today date := (now() at time zone 'Europe/Lisbon')::date;
  v_open bigint; v_mode text; v_ref date; v_rec bigint; v_des bigint; v_first date;
  v_start date; v_end date; v_gran text := null; v_points jsonb := '[]'::jsonb;
begin
  if p_from is not null and p_to is not null and p_to < p_from then raise exception 'O período indicado não é válido.'; end if;

  select coalesce(sum(amount_cents), 0)::bigint, max(reference_date),
         case when count(*) = 0 then 'nenhum' when bool_or(account_id is null) then 'global' else 'conta' end
    into v_open, v_ref, v_mode
    from public.fin_opening_balances where section_id = p_section and space = v_space and voided_at is null;
  select coalesce(sum(amount_cents) filter (where kind = 'receita'), 0)::bigint, coalesce(sum(amount_cents) filter (where kind = 'despesa'), 0)::bigint,
         min(occurred_on)
    into v_rec, v_des, v_first
    from private.fin_counted(p_section, v_space);

  -- Evolução do saldo (de toda a tesouraria): só a partir da data do saldo inicial, quando existe.
  v_end := least(coalesce(p_to, v_today), v_today);
  if v_mode = 'nenhum' then
    v_start := coalesce(p_from, v_first, v_end);
  else
    v_start := greatest(coalesce(p_from, v_ref), v_ref);
  end if;
  if v_start <= v_end then
    if v_end - v_start > 62 then
      v_gran := 'mes';
      select jsonb_agg(jsonb_build_object('date', d, 'kind', k, 'saldo', private.fin_balance_at(p_section, v_space, d, k <> 'inicio')) order by d, k <> 'inicio')
        into v_points
        from (select v_start d, 'inicio' k
              union
              select least((date_trunc('month', g) + interval '1 month - 1 day')::date, v_end), 'mes'
                from generate_series(date_trunc('month', v_start), v_end::timestamp, interval '1 month') g) x;
    else
      v_gran := 'dia';
      select jsonb_agg(jsonb_build_object('date', d, 'kind', k, 'saldo', private.fin_balance_at(p_section, v_space, d, k <> 'inicio')) order by d, k <> 'inicio')
        into v_points
        from (select v_start d, 'inicio' k
              union
              select c.occurred_on, 'dia' from private.fin_counted(p_section, v_space) c where c.occurred_on between v_start and v_end
              union
              select v_end, 'dia') x;
    end if;
  end if;

  return (
    with mv as (
      select m.* from public.fin_movements m
       where m.section_id = p_section and m.space = v_space and m.voided_at is null
         and (p_from is null or m.occurred_on >= p_from) and (p_to is null or m.occurred_on <= p_to)
         and (p_activity is null or m.activity_id = p_activity)
    ), before_open as (
      select m.* from public.fin_movements m
       where m.section_id = p_section and m.space = v_space and m.state = 'efetivo' and m.voided_at is null
         and private.fin_before_opening(m)
    )
    select jsonb_build_object(
      'can_manage', v_manage,
      'space', v_space,
      'today', v_today,
      'opening', jsonb_build_object(
        'mode', v_mode, 'total', v_open, 'reference_date', v_ref,
        'items', coalesce((select jsonb_agg(private.fin_opening_json(o, v_manage) order by o.account_id nulls first, o.reference_date)
                             from public.fin_opening_balances o
                            where o.section_id = p_section and o.space = v_space and o.voided_at is null), '[]'::jsonb)),
      -- Saldo atual = Saldo inicial + Receitas − Despesas (efetivos, não anulados, desde o saldo inicial).
      'current', jsonb_build_object('saldo_inicial', v_open, 'receitas', v_rec, 'despesas', v_des, 'saldo', v_open + v_rec - v_des),
      'before_opening', (select jsonb_build_object('count', count(*),
                                  'receitas', coalesce(sum(amount_cents) filter (where kind = 'receita'), 0),
                                  'despesas', coalesce(sum(amount_cents) filter (where kind = 'despesa'), 0)) from before_open),
      'period', jsonb_build_object('from', p_from, 'to', p_to, 'activity_id', p_activity),
      'totals', (select jsonb_object_agg(s.st, jsonb_build_object('receitas', t.r, 'despesas', t.d, 'saldo', t.r - t.d))
                   from unnest(array['efetivo', 'pendente', 'previsto']) s(st)
                   cross join lateral (select coalesce(sum(amount_cents) filter (where kind = 'receita'), 0) r,
                                              coalesce(sum(amount_cents) filter (where kind = 'despesa'), 0) d
                                         from mv where mv.state = s.st) t),
      'count', (select count(*) from mv),
      'evolution', jsonb_build_object('granularity', v_gran, 'from', case when v_gran is not null then v_start end,
                                      'to', case when v_gran is not null then v_end end, 'points', coalesce(v_points, '[]'::jsonb)),
      'latest', coalesce((select jsonb_agg(j order by d desc, c desc) from (
                   select case when v_manage then private.fin_movement_json(m) else private.fin_shared_json(m) end
                          || jsonb_build_object('before_opening', m.state = 'efetivo' and private.fin_before_opening(m)) j,
                          m.occurred_on d, m.created_at c
                     from public.fin_movements m
                    where m.id in (select id from mv)
                    order by m.occurred_on desc, m.created_at desc limit 6) x), '[]'::jsonb),
      'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'kind', kind,
                                 'efetivo', ef, 'pendente', pe, 'previsto', pr) order by kind desc, ef desc, category)
                         from (select category, kind,
                                      coalesce(sum(amount_cents) filter (where state = 'efetivo'), 0) ef,
                                      coalesce(sum(amount_cents) filter (where state = 'pendente'), 0) pe,
                                      coalesce(sum(amount_cents) filter (where state = 'previsto'), 0) pr
                                 from mv group by category, kind) c), '[]'::jsonb),
      'activity', case when p_activity is not null then public.fin_activity_results(p_section, p_activity) -> 0 end,
      'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'archived', a.archived_at is not null,
                              'opening', (select private.fin_opening_json(o, false) from public.fin_opening_balances o
                                           where o.account_id = a.id and o.space = v_space and o.voided_at is null),
                              'movimentos', t.s,
                              'saldo', t.s + coalesce((select o.amount_cents from public.fin_opening_balances o
                                                         where o.account_id = a.id and o.space = v_space and o.voided_at is null), 0))
                              order by a.archived_at nulls first, a.name)
                         from public.fin_accounts a
                         cross join lateral (select coalesce(sum(case when c.kind = 'receita' then c.amount_cents else -c.amount_cents end), 0)::bigint s
                                               from private.fin_counted(p_section, v_space) c where c.account_id = a.id) t
                        where a.section_id = p_section and a.space = v_space
                          and (a.archived_at is null or t.s <> 0)), '[]'::jsonb),
      'years', (select jsonb_agg(y order by y desc) from (
                  select private.fin_scout_year(v_today) y
                  union select private.fin_scout_year(occurred_on) from public.fin_movements where section_id = p_section and space = v_space
                  union select private.fin_scout_year(reference_date) from public.fin_opening_balances
                         where section_id = p_section and space = v_space and voided_at is null) yy)
    ));
end
$$;

-- ---------------------------------------------------------------------------
-- Movimentos partilhados com pesquisa (todos com acesso; o que se vê depende da permissão)
-- ---------------------------------------------------------------------------
create or replace function public.fin_search_movements(
  p_section uuid, p_from date default null, p_to date default null, p_activity uuid default null, p_category text default null,
  p_state text default null, p_search text default null, p_include_voided boolean default false, p_limit int default 200
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'tesouraria');
  v_manage boolean := private.fin_can_manage(p_section);
  v_q text := lower(nullif(trim(coalesce(p_search, '')), ''));
  v_lim int := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if v_q is not null and length(v_q) > 100 then raise exception 'A pesquisa tem no máximo 100 caracteres.'; end if;
  return (
    with hit as (
      select m from public.fin_movements m
        left join public.cal_events e on e.id = m.activity_id and e.space = m.space
       where m.section_id = p_section and m.space = v_space
         and (m.voided_at is null or (v_manage and coalesce(p_include_voided, false)))
         and (p_from is null or m.occurred_on >= p_from) and (p_to is null or m.occurred_on <= p_to)
         and (p_activity is null or m.activity_id = p_activity) and (p_category is null or m.category = p_category)
         and (p_state is null or m.state = p_state)
         and (v_q is null
              -- Quem só consulta pesquisa apenas no que pode ver (nunca na descrição escondida).
              or strpos(lower(case when v_manage or m.member_profile_id is null or m.member_profile_id = auth.uid()
                                   then m.description else 'Pagamento individual' end), v_q) > 0
              or strpos(lower(m.category), v_q) > 0
              or strpos(lower(coalesce(e.title, '')), v_q) > 0
              or (v_manage and (strpos(lower(coalesce(private.fin_name(m.member_profile_id), '')), v_q) > 0
                                or strpos(lower(coalesce(m.notes, '')), v_q) > 0)))
    )
    select jsonb_build_object(
      'can_manage', v_manage,
      'total', (select count(*) from hit),
      'limit', v_lim,
      'items', coalesce((select jsonb_agg(j order by d desc, c desc) from (
                  select (case when v_manage then private.fin_movement_json(h.m) else private.fin_shared_json(h.m) end)
                         || jsonb_build_object('before_opening', (h.m).state = 'efetivo' and (h.m).voided_at is null and private.fin_before_opening(h.m)) j,
                         (h.m).occurred_on d, (h.m).created_at c
                    from hit h order by (h.m).occurred_on desc, (h.m).created_at desc limit v_lim) x), '[]'::jsonb)
    ));
end
$$;

-- ---------------------------------------------------------------------------
-- Ajustes à v1 (mesmas assinaturas)
-- ---------------------------------------------------------------------------
-- Opções: junta os saldos iniciais ativos (para avisar quando a data é anterior).
create or replace function public.fin_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria');
begin
  return jsonb_build_object(
    'can_manage', private.fin_can_manage(p_section),
    'space', v_space,
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'archived', a.archived_at is not null)
                                   order by a.archived_at nulls first, a.name)
                            from public.fin_accounts a where a.section_id = p_section and a.space = v_space), '[]'::jsonb),
    'categories', (select jsonb_agg(c order by c) from (
        select unnest(array['Quotas', 'Atividades', 'Acampamentos', 'Material', 'Transportes', 'Alimentação', 'Donativos', 'Angariação de fundos', 'Outros']) c
        union select category from public.fin_movements where section_id = p_section and space = v_space
        union select category from public.fin_budget_lines where section_id = p_section and space = v_space) x),
    'opening', coalesce((select jsonb_agg(jsonb_build_object('account_id', o.account_id, 'reference_date', o.reference_date))
                           from public.fin_opening_balances o
                          where o.section_id = p_section and o.space = v_space and o.voided_at is null), '[]'::jsonb)
  );
end
$$;

-- Resumo v1: o saldo de cada conta passa a seguir a regra do saldo inicial.
create or replace function public.fin_summary(
  p_section uuid, p_from date default null, p_to date default null, p_category text default null, p_activity uuid default null
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria');
begin
  return (
    with mv as (
      select m.* from public.fin_movements m
       where m.section_id = p_section and m.space = v_space and m.voided_at is null
         and (p_from is null or m.occurred_on >= p_from) and (p_to is null or m.occurred_on <= p_to)
         and (p_category is null or m.category = p_category) and (p_activity is null or m.activity_id = p_activity)
    )
    select jsonb_build_object(
      'can_manage', private.fin_can_manage(p_section),
      'totals', (select jsonb_object_agg(s.st, jsonb_build_object('receitas', t.r, 'despesas', t.d, 'saldo', t.r - t.d))
                   from unnest(array['efetivo', 'pendente', 'previsto']) s(st)
                   cross join lateral (select coalesce(sum(amount_cents) filter (where kind = 'receita'), 0) r,
                                              coalesce(sum(amount_cents) filter (where kind = 'despesa'), 0) d
                                         from mv where mv.state = s.st) t),
      'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'kind', kind,
                                 'efetivo', ef, 'pendente', pe, 'previsto', pr) order by kind desc, ef desc, category)
                         from (select category, kind,
                                      coalesce(sum(amount_cents) filter (where state = 'efetivo'), 0) ef,
                                      coalesce(sum(amount_cents) filter (where state = 'pendente'), 0) pe,
                                      coalesce(sum(amount_cents) filter (where state = 'previsto'), 0) pr
                                 from mv group by category, kind) c), '[]'::jsonb),
      'by_activity', coalesce((select jsonb_agg(jsonb_build_object('activity_id', x.activity_id, 'title', e.title,
                                 'receitas', x.r, 'despesas', x.d, 'saldo', x.r - x.d, 'pendente_saldo', x.pr - x.pd) order by e.title)
                         from (select activity_id,
                                      coalesce(sum(amount_cents) filter (where state = 'efetivo' and kind = 'receita'), 0) r,
                                      coalesce(sum(amount_cents) filter (where state = 'efetivo' and kind = 'despesa'), 0) d,
                                      coalesce(sum(amount_cents) filter (where state <> 'efetivo' and kind = 'receita'), 0) pr,
                                      coalesce(sum(amount_cents) filter (where state <> 'efetivo' and kind = 'despesa'), 0) pd
                                 from mv where activity_id is not null group by activity_id) x
                         join public.cal_events e on e.id = x.activity_id and e.space = v_space), '[]'::jsonb),
      -- Saldo atual de cada conta ou caixa ativa: saldo inicial da conta + movimentos que contam.
      'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind,
                              'saldo', coalesce((select sum(case when c.kind = 'receita' then c.amount_cents else -c.amount_cents end)
                                                   from private.fin_counted(p_section, v_space) c where c.account_id = a.id), 0)
                                     + coalesce((select o.amount_cents from public.fin_opening_balances o
                                                  where o.account_id = a.id and o.space = v_space and o.voided_at is null), 0))
                              order by a.name)
                         from public.fin_accounts a where a.section_id = p_section and a.space = v_space and a.archived_at is null), '[]'::jsonb),
      'count', (select count(*) from mv)
    ));
end
$$;

-- Publicar com «passar dados de teste a reais» (v1) + saldo inicial: se os dados reais já
-- têm saldo inicial, o de teste é anulado (fica registado) para nunca haver dois.
create or replace function private.tesouraria_publish_move(p_section uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_t text;
begin
  update public.fin_opening_balances t set voided_at = now(), void_reason = 'Os dados reais já tinham saldo inicial.', updated_at = now()
   where t.section_id = p_section and t.space = 'teste' and t.voided_at is null
     and exists (select 1 from public.fin_opening_balances r where r.section_id = p_section and r.space = 'real' and r.voided_at is null);
  foreach v_t in array private.module_tables('tesouraria') loop
    execute format('update public.%I set space = ''real'' where section_id = $1 and space = ''teste''', v_t) using p_section;
  end loop;
  update public.fin_movements m set activity_id = null,
         notes = left(coalesce(m.notes || E'\n', '') || 'Atividade de teste desligada ao publicar.', 1000), updated_at = now()
   where m.section_id = p_section and m.space = 'real' and m.activity_id is not null
     and not exists (select 1 from public.cal_events e where e.id = m.activity_id and e.space = 'real');
  update public.fin_budget_lines l set voided_at = now(), void_reason = 'Atividade de teste não passou a dados reais.', updated_at = now()
   where l.section_id = p_section and l.space = 'real' and l.voided_at is null
     and not exists (select 1 from public.cal_events e where e.id = l.activity_id and e.space = 'real');
end
$$;

revoke all on function private.fin_audit_trg() from public, anon, authenticated;
revoke all on function private.tesouraria_publish_move(uuid) from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Mantém reservado ao agendador o envio de lembretes (a base retira-o a utilizadores).
revoke execute on function public.process_due_reminders() from authenticated;

-- ===== supabase/migrations/20261022000600_reunioes_v2.sql =====
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

-- ===== supabase/migrations/20261022000700_presencas.sql =====
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

-- ===== supabase/migrations/20261022000900_integracao_v2.sql =====
-- Pioneiros — ligações entre módulos (v2). A atividade do Calendário reúne o que lhe está
-- ligado nos outros módulos: material reservado e a comprar, tarefas, presenças, resumo
-- financeiro e reuniões. Cada parte só aparece a quem tem acesso a esse módulo no mesmo
-- espaço, e respeita as regras de visibilidade do próprio módulo. Nada é copiado.
-- Aditivo: não altera nem apaga registos existentes.

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
  end if;

  if private.module_space(p_section, 'inventario') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('compras', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(i.name, p.name), 'quantity', p.quantity,
                                          'unit', coalesce(i.unit, p.unit), 'status', p.status) order by p.created_at)
        from public.inv_purchases p left join public.inv_items i on i.id = p.item_id
       where p.section_id = p_section and p.space = v_space and p.event_id = p_event and p.status <> 'cancelado'), '[]'::jsonb));
  end if;

  if private.module_space(p_section, 'presencas') is not distinct from v_space then
    -- A sessão de presenças da atividade: contagens só para quem regista; os restantes
    -- veem apenas o próprio registo.
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
    -- Só os totais partilhados (os mesmos que o resumo da Tesouraria mostra a todos).
    v_fin := public.fin_activity_results(p_section, p_event) -> 0;
    v_out := v_out || jsonb_build_object('financas', case when v_fin is null then null else
      jsonb_build_object('orcamento', v_fin -> 'orcamento', 'efetivo', v_fin -> 'efetivo', 'por_confirmar', v_fin -> 'por_confirmar') end);
  end if;

  if private.module_space(p_section, 'secretaria') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('reunioes', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'kind', m.kind, 'starts_at', m.starts_at) order by m.starts_at)
        from public.sec_meetings m
       where m.section_id = p_section and m.space = v_space and m.cal_event_id = p_event and m.status = 'ativa'
         and private.sec_can_see(m.id)), '[]'::jsonb));
  end if;

  if private.module_space(p_section, 'secretaria') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('tarefas', private.sec_tasks_for_event(p_section, v_space, p_event));
  end if;

  return v_out;
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;
