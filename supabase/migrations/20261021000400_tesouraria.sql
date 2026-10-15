-- Pioneiros — Tesouraria: receitas, despesas, saldos, quotas, pagamentos individuais,
-- orçamento por atividade, comprovativos e auditoria.
--
-- • Valores sempre em cêntimos inteiros (bigint), nunca em vírgula flutuante.
-- • Cada movimento tem um estado: «previsto», «pendente» ou «efetivo». O saldo efetivo só
--   conta movimentos efetivos e não anulados.
-- • Um pagamento individual É um movimento (receita com membro). Uma quota apenas o
--   referencia (fin_movements.quota_charge_id): o mesmo pagamento nunca conta duas vezes
--   e não pode ficar ligado a duas quotas. Exceder o valor em falta exige confirmação.
-- • Nada se apaga: anula-se (com motivo) ou corrige-se com um movimento novo ligado ao
--   original (corrects_id / replaced_by). Auditoria com valores antigos e novos (fin_audit).
-- • Só quem tem «tesouraria.gerir» (dado pela administração) cria, altera ou anula. Ser
--   dirigente, administrador ou ter um cargo de equipa (p. ex. tesoureiro) NÃO basta.
--   Os restantes com acesso ao módulo veem resumos (totais por categoria/atividade) e a
--   sua própria situação; nunca pagamentos individuais de outras pessoas.
-- • Comprovativos: anexos da base comum (entidade «movimento»), visíveis só a quem gere e,
--   no seu próprio pagamento, ao próprio membro.
-- • Notificações com texto genérico (sem valores) — aparecem no ecrã bloqueado.
-- Aditivo: não altera dados nem permissões existentes.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.fin_accounts (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  name text not null check (length(trim(name)) between 1 and 80),
  kind text not null default 'conta' check (kind in ('conta', 'caixa')),
  archived_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists fin_accounts_section on public.fin_accounts (section_id, space);

create table if not exists public.fin_quotas (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  name text not null check (length(trim(name)) between 1 and 120),
  period_start date not null,
  period_end date not null,
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  due_date date not null,
  status text not null default 'ativa' check (status in ('ativa', 'anulada')),
  void_reason text,
  voided_at timestamptz,
  voided_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index if not exists fin_quotas_section on public.fin_quotas (section_id, space);

-- Quota aplicada a um membro (valor devido próprio, p. ex. proporcional).
create table if not exists public.fin_quota_charges (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  quota_id uuid not null references public.fin_quotas (id) on delete cascade,
  profile_id uuid not null references public.profiles (id),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  status text not null default 'ativa' check (status in ('ativa', 'isenta')),
  waive_reason text,
  waived_at timestamptz,
  waived_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (quota_id, profile_id)
);
create index if not exists fin_quota_charges_profile on public.fin_quota_charges (section_id, space, profile_id);

create table if not exists public.fin_movements (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  kind text not null check (kind in ('receita', 'despesa')),
  occurred_on date not null,
  description text not null check (length(trim(description)) between 1 and 200),
  category text not null check (length(trim(category)) between 1 and 60),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  account_id uuid not null references public.fin_accounts (id),
  activity_id uuid references public.cal_events (id),
  member_profile_id uuid references public.profiles (id),
  quota_charge_id uuid references public.fin_quota_charges (id),
  state text not null check (state in ('previsto', 'pendente', 'efetivo')),
  notes text check (notes is null or length(notes) <= 1000),
  corrects_id uuid references public.fin_movements (id),
  replaced_by uuid references public.fin_movements (id),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  client_key uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  -- O pagamento de uma quota é sempre uma receita de um membro.
  check (quota_charge_id is null or (kind = 'receita' and member_profile_id is not null)),
  check (voided_at is null or (void_reason is not null and length(trim(void_reason)) > 0))
);
create index if not exists fin_movements_section on public.fin_movements (section_id, space, occurred_on desc);
create index if not exists fin_movements_charge on public.fin_movements (quota_charge_id) where quota_charge_id is not null;
create index if not exists fin_movements_member on public.fin_movements (member_profile_id) where member_profile_id is not null;
create index if not exists fin_movements_activity on public.fin_movements (activity_id) where activity_id is not null;
-- O mesmo envio do formulário nunca regista dois movimentos.
create unique index if not exists fin_movements_client_key on public.fin_movements (section_id, client_key) where client_key is not null;
-- Um movimento só é corrigido uma vez (a correção pode, por sua vez, ser corrigida).
create unique index if not exists fin_movements_one_correction on public.fin_movements (corrects_id) where corrects_id is not null;

-- Orçamento (previsto) por atividade.
create table if not exists public.fin_budget_lines (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  activity_id uuid not null references public.cal_events (id),
  kind text not null check (kind in ('receita', 'despesa')),
  category text not null check (length(trim(category)) between 1 and 60),
  description text not null check (length(trim(description)) between 1 and 200),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists fin_budget_lines_activity on public.fin_budget_lines (section_id, space, activity_id);

-- Auditoria: quem criou, alterou, anulou ou corrigiu, quando, com valores antigos e novos.
create table if not exists public.fin_audit (
  id bigint generated always as identity primary key,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  entity text not null,
  entity_id uuid not null,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  actor uuid,
  at timestamptz not null default now()
);
create index if not exists fin_audit_entity on public.fin_audit (entity_id, id);

alter table public.fin_accounts enable row level security;
alter table public.fin_quotas enable row level security;
alter table public.fin_quota_charges enable row level security;
alter table public.fin_movements enable row level security;
alter table public.fin_budget_lines enable row level security;
alter table public.fin_audit enable row level security;

-- ---------------------------------------------------------------------------
-- Auditoria automática (não depende de cada função se lembrar de registar)
-- ---------------------------------------------------------------------------
create or replace function private.fin_audit_trg()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare o jsonb; n jsonb; k text; vo jsonb := '{}'; vn jsonb := '{}'; v_action text;
begin
  n := to_jsonb(new);
  if tg_op = 'INSERT' then
    insert into public.fin_audit (section_id, space, entity, entity_id, action, old_values, new_values, actor)
    values (new.section_id, new.space, tg_table_name, new.id, 'criado', null,
            n - 'created_at' - 'updated_at' - 'updated_by' - 'section_id' - 'space', auth.uid());
    return new;
  end if;
  o := to_jsonb(old);
  for k in select jsonb_object_keys(n) loop
    if k not in ('updated_at', 'updated_by') and (o -> k) is distinct from (n -> k) then
      vo := vo || jsonb_build_object(k, o -> k);
      vn := vn || jsonb_build_object(k, n -> k);
    end if;
  end loop;
  if vn = '{}'::jsonb then return new; end if;
  v_action := case
    when vn ? 'space' then 'passado_a_real'
    when vn ? 'replaced_by' and o ->> 'replaced_by' is null then 'corrigido'
    when vn ? 'voided_at' and o ->> 'voided_at' is null then 'anulado'
    when tg_table_name = 'fin_quotas' and vn ->> 'status' = 'anulada' then 'anulado'
    when tg_table_name = 'fin_quota_charges' and vn ->> 'status' = 'isenta' then 'isentado'
    when tg_table_name = 'fin_accounts' and vn ? 'archived_at' and o ->> 'archived_at' is null then 'arquivado'
    else 'alterado' end;
  insert into public.fin_audit (section_id, space, entity, entity_id, action, old_values, new_values, actor)
  values (new.section_id, new.space, tg_table_name, new.id, v_action, vo, vn, auth.uid());
  return new;
end
$$;

do $$
declare t text;
begin
  foreach t in array array['fin_accounts', 'fin_quotas', 'fin_quota_charges', 'fin_movements', 'fin_budget_lines'] loop
    execute format('drop trigger if exists fin_audit on public.%I', t);
    execute format('create trigger fin_audit after insert or update on public.%I for each row execute function private.fin_audit_trg()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
-- Só a permissão explícita conta (nem dirigente nem administração nem cargo de equipa).
create or replace function private.fin_can_manage(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.module_can(p_section, 'tesouraria', 'tesouraria.gerir', false)
$$;

create or replace function private.fin_require_manage(p_section uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select private.module_require_can(p_section, 'tesouraria', 'tesouraria.gerir', false)
$$;

create or replace function private.fin_name(p_profile uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select nullif(trim(full_name), '') from public.profiles where id = p_profile
$$;

-- «1234» → «12,34 €» (só para mensagens a quem gere).
create or replace function private.fin_eur(p_cents bigint)
returns text language sql immutable set search_path = ''
as $$
  select case when p_cents < 0 then '−' else '' end || (abs(p_cents) / 100)::text || ','
         || lpad((abs(p_cents) % 100)::text, 2, '0') || ' €'
$$;

-- Fração de um valor em cêntimos, com arredondamento ao cêntimo (meio para cima), só inteiros.
create or replace function private.fin_fraction(p_cents bigint, p_num int, p_den int)
returns bigint language sql immutable set search_path = ''
as $$
  select (p_cents * p_num * 2 + p_den) / (2 * p_den)
$$;

create or replace function private.fin_validate(
  p_section uuid, p_space text, p_kind text, p_on date, p_description text, p_category text, p_amount bigint,
  p_account uuid, p_state text, p_activity uuid, p_member uuid, p_keep_account uuid default null
) returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_kind is null or p_kind not in ('receita', 'despesa') then raise exception 'Indica se é uma receita ou uma despesa.'; end if;
  if p_on is null then raise exception 'Indica a data do movimento.'; end if;
  if p_on < date '2000-01-01' or p_on > current_date + 3660 then raise exception 'A data está fora do intervalo permitido.'; end if;
  if length(trim(coalesce(p_description, ''))) not between 1 and 200 then raise exception 'Escreve uma descrição (até 200 caracteres).'; end if;
  if length(trim(coalesce(p_category, ''))) not between 1 and 60 then raise exception 'Escolhe uma categoria (até 60 caracteres).'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Indica um valor superior a zero.'; end if;
  if p_amount > 100000000000 then raise exception 'O valor é demasiado elevado.'; end if;
  if p_state is null or p_state not in ('previsto', 'pendente', 'efetivo') then raise exception 'Escolhe o estado: previsto, pendente ou efetivo.'; end if;
  if not exists (select 1 from public.fin_accounts a where a.id = p_account and a.section_id = p_section and a.space = p_space
                    and (a.archived_at is null or a.id = p_keep_account)) then
    raise exception 'Escolhe uma conta ou caixa válida.';
  end if;
  if p_activity is not null and not exists (select 1 from public.cal_events e where e.id = p_activity and e.section_id = p_section and e.space = p_space) then
    raise exception 'Atividade não encontrada.';
  end if;
  if p_member is not null and not exists (select 1 from public.memberships m where m.profile_id = p_member and m.section_id = p_section) then
    raise exception 'Membro não encontrado nesta secção.';
  end if;
end
$$;

-- Valida a ligação de um pagamento a uma quota (com a quota bloqueada). Exceder o valor
-- em falta só com confirmação explícita.
create or replace function private.fin_check_charge(
  p_section uuid, p_space text, p_charge uuid, p_member uuid, p_amount bigint, p_exclude uuid, p_allow_excess boolean
) returns void language plpgsql security definer set search_path = ''
as $$
declare c record; v_used bigint;
begin
  select ch.id, ch.profile_id, ch.amount_cents, ch.status, q.status as qstatus into c
    from public.fin_quota_charges ch join public.fin_quotas q on q.id = ch.quota_id
   where ch.id = p_charge and ch.section_id = p_section and ch.space = p_space
   for update of ch;
  if c.id is null then raise exception 'Quota do membro não encontrada.'; end if;
  if c.qstatus <> 'ativa' then raise exception 'Esta quota já foi anulada.'; end if;
  if c.status <> 'ativa' then raise exception 'Este membro está isento desta quota.'; end if;
  if p_member is distinct from c.profile_id then raise exception 'O pagamento de uma quota tem de ser do próprio membro.'; end if;
  select coalesce(sum(amount_cents), 0) into v_used from public.fin_movements
   where quota_charge_id = p_charge and voided_at is null and id is distinct from p_exclude;
  if not coalesce(p_allow_excess, false) then
    if v_used >= c.amount_cents then
      raise exception 'Esta quota já está totalmente paga (possível pagamento duplicado). Confirma para registar um valor em excesso.';
    end if;
    if v_used + p_amount > c.amount_cents then
      raise exception 'O pagamento excede o valor que está em falta na quota (em falta: %). Confirma para registar o excesso.', private.fin_eur(c.amount_cents - v_used);
    end if;
  end if;
end
$$;

-- Lembrete «quota por pagar» na data limite (09:00, Lisboa); cancelado quando paga, isenta ou anulada.
create or replace function private.fin_refresh_charge(p_charge uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare c record; v_paid bigint; v_due timestamptz;
begin
  if p_charge is null then return; end if;
  select ch.*, q.due_date, q.status as qstatus into c
    from public.fin_quota_charges ch join public.fin_quotas q on q.id = ch.quota_id where ch.id = p_charge;
  if c.id is null then return; end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.fin_movements
   where quota_charge_id = p_charge and voided_at is null and state = 'efetivo';
  v_due := (c.due_date + time '09:00') at time zone 'Europe/Lisbon';
  if c.status <> 'ativa' or c.qstatus <> 'ativa' or v_paid >= c.amount_cents or v_due <= now() then
    perform private.cancel_reminders('fin_quota_charge', c.id);
  else
    perform private.schedule_reminder(c.section_id, 'tesouraria', c.space, 'fin_quota_charge', c.id, 'quota_pendente',
      c.profile_id, v_due, 'Quota por pagar', 'Tens uma quota pendente na Tesouraria.', '/tesouraria/minha');
  end if;
end
$$;

-- Avisa o membro quando um pagamento seu passa a efetivo (texto genérico, sem valores).
create or replace function private.fin_after_change(p_new public.fin_movements, p_old_state text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_new.member_profile_id is not null and p_new.state = 'efetivo' and p_new.voided_at is null
     and p_old_state is distinct from 'efetivo' then
    perform private.module_notify(p_new.section_id, 'tesouraria', p_new.space, array[p_new.member_profile_id], 'fin_pagamento',
      'Pagamento registado', 'Foi registado um pagamento na tua situação da Tesouraria.', '/tesouraria/minha');
  end if;
  perform private.fin_refresh_charge(p_new.quota_charge_id);
end
$$;

create or replace function private.fin_movement_json(m public.fin_movements)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'kind', m.kind, 'occurred_on', m.occurred_on, 'description', m.description, 'category', m.category,
    'amount_cents', m.amount_cents, 'state', m.state, 'notes', m.notes,
    'account_id', m.account_id, 'account_name', (select a.name from public.fin_accounts a where a.id = m.account_id),
    'activity_id', m.activity_id, 'activity_title', (select e.title from public.cal_events e where e.id = m.activity_id and e.space = m.space),
    'member_profile_id', m.member_profile_id, 'member_name', private.fin_name(m.member_profile_id),
    'quota_charge_id', m.quota_charge_id,
    'quota_name', (select q.name from public.fin_quota_charges ch join public.fin_quotas q on q.id = ch.quota_id where ch.id = m.quota_charge_id),
    'corrects_id', m.corrects_id, 'replaced_by', m.replaced_by,
    'voided_at', m.voided_at, 'void_reason', m.void_reason, 'voided_by_name', private.fin_name(m.voided_by),
    'created_by_name', private.fin_name(m.created_by), 'created_at', m.created_at,
    'updated_by_name', private.fin_name(m.updated_by), 'updated_at', m.updated_at,
    'files', (select count(*) from public.module_files f where f.module = 'tesouraria' and f.entity = 'movimento'
                and f.entity_id = m.id and f.removed_at is null)
  )
$$;

-- Movimento desta secção e deste espaço (bloqueado para alteração).
create or replace function private.fin_get_movement(p_section uuid, p_space text, p_id uuid)
returns public.fin_movements language plpgsql security definer set search_path = ''
as $$
declare m public.fin_movements;
begin
  select * into m from public.fin_movements where id = p_id and section_id = p_section and space = p_space for update;
  if m.id is null then raise exception 'Registo não encontrado.'; end if;
  return m;
end
$$;

-- Comprovativos: ler — quem gere ou o próprio membro (no seu pagamento); anexar/retirar — só quem gere.
create or replace function private.tesouraria_file_access(p_entity text, p_entity_id uuid, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare m public.fin_movements;
begin
  if p_entity is distinct from 'movimento' then return false; end if;
  select * into m from public.fin_movements where id = p_entity_id;
  if m.id is null then return false; end if;
  if private.module_space(m.section_id, 'tesouraria') is distinct from m.space then return false; end if;
  if private.fin_can_manage(m.section_id) then return not p_write or m.voided_at is null; end if;
  return not p_write and m.member_profile_id = auth.uid();
end
$$;

-- ---------------------------------------------------------------------------
-- Opções (contas, categorias, atividades, membros)
-- ---------------------------------------------------------------------------
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
        union select category from public.fin_budget_lines where section_id = p_section and space = v_space) x)
  );
end
$$;

-- Atividades do Calendário (mesma secção e mesmo espaço).
create or replace function public.fin_activity_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'status', e.status,
      'day', coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date))
      order by coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date) desc, e.title)
    from public.cal_events e where e.section_id = p_section and e.space = v_space), '[]'::jsonb);
end
$$;

create or replace function public.fin_members(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('profile_id', m.profile_id, 'full_name', coalesce(private.fin_name(m.profile_id), 'Sem nome'),
                                                       'function', m.function, 'team_id', m.team_id)
                                    order by private.fin_name(m.profile_id))
                     from public.memberships m where m.section_id = p_section and m.status = 'ativo'), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Contas e caixas
-- ---------------------------------------------------------------------------
create or replace function public.fin_save_account(p_section uuid, p_id uuid, p_name text, p_kind text, p_archived boolean default false)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); v_id uuid;
begin
  if length(trim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'Indica o nome da conta ou caixa (até 80 caracteres).'; end if;
  if p_kind is null or p_kind not in ('conta', 'caixa') then raise exception 'Escolhe se é uma conta ou uma caixa.'; end if;
  if exists (select 1 from public.fin_accounts where section_id = p_section and space = v_space and lower(trim(name)) = lower(trim(p_name))
              and id is distinct from p_id) then
    raise exception 'Já existe uma conta ou caixa com este nome.';
  end if;
  if p_id is null then
    insert into public.fin_accounts (section_id, space, name, kind, created_by) values (p_section, v_space, trim(p_name), p_kind, auth.uid())
    returning id into v_id;
  else
    update public.fin_accounts set name = trim(p_name), kind = p_kind,
           archived_at = case when coalesce(p_archived, false) then coalesce(archived_at, now()) else null end,
           updated_by = auth.uid(), updated_at = now()
     where id = p_id and section_id = p_section and space = v_space returning id into v_id;
    if v_id is null then raise exception 'Registo não encontrado.'; end if;
  end if;
  return v_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Movimentos
-- ---------------------------------------------------------------------------
create or replace function public.fin_create_movement(
  p_section uuid, p_kind text, p_on date, p_description text, p_category text, p_amount bigint, p_account uuid,
  p_state text, p_activity uuid default null, p_member uuid default null, p_notes text default null, p_client_key uuid default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); m public.fin_movements;
begin
  perform private.fin_validate(p_section, v_space, p_kind, p_on, p_description, p_category, p_amount, p_account, p_state, p_activity, p_member);
  if p_client_key is not null and exists (select 1 from public.fin_movements where section_id = p_section and client_key = p_client_key) then
    raise exception 'Este movimento já foi registado (envio repetido).';
  end if;
  insert into public.fin_movements (section_id, space, kind, occurred_on, description, category, amount_cents, account_id, activity_id,
                                    member_profile_id, state, notes, client_key, created_by)
  values (p_section, v_space, p_kind, p_on, trim(p_description), trim(p_category), p_amount, p_account, p_activity,
          p_member, p_state, nullif(trim(coalesce(p_notes, '')), ''), p_client_key, auth.uid())
  returning * into m;
  perform private.fin_after_change(m, null);
  return m.id;
end
$$;

-- Alterar: previstos e pendentes livremente; num efetivo só descrição, categoria, atividade e notas
-- (valor, data, tipo, conta e membro corrigem-se com um movimento de correção).
create or replace function public.fin_update_movement(
  p_section uuid, p_id uuid, p_kind text, p_on date, p_description text, p_category text, p_amount bigint, p_account uuid,
  p_state text, p_activity uuid default null, p_member uuid default null, p_notes text default null, p_allow_excess boolean default false
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); o public.fin_movements; m public.fin_movements;
begin
  o := private.fin_get_movement(p_section, v_space, p_id);
  if o.voided_at is not null then raise exception 'Este movimento está anulado e já não se altera.'; end if;
  perform private.fin_validate(p_section, v_space, p_kind, p_on, p_description, p_category, p_amount, p_account, p_state, p_activity, p_member, o.account_id);
  if o.state = 'efetivo' and (p_kind <> o.kind or p_on <> o.occurred_on or p_amount <> o.amount_cents or p_account <> o.account_id
                              or p_member is distinct from o.member_profile_id or p_state <> 'efetivo') then
    raise exception 'Um movimento efetivo não se altera: usa «Corrigir» (fica ligado ao original) ou anula-o.';
  end if;
  if o.quota_charge_id is not null and (p_kind <> o.kind or p_amount <> o.amount_cents or p_member is distinct from o.member_profile_id) then
    if p_kind <> 'receita' then raise exception 'O pagamento de uma quota é sempre uma receita.'; end if;
    perform private.fin_check_charge(p_section, v_space, o.quota_charge_id, p_member, p_amount, o.id,
                                     p_allow_excess or (p_amount < o.amount_cents and p_member is not distinct from o.member_profile_id));
  end if;
  update public.fin_movements set kind = p_kind, occurred_on = p_on, description = trim(p_description), category = trim(p_category),
         amount_cents = p_amount, account_id = p_account, state = p_state, activity_id = p_activity, member_profile_id = p_member,
         notes = nullif(trim(coalesce(p_notes, '')), ''), updated_by = auth.uid(), updated_at = now()
   where id = o.id returning * into m;
  perform private.fin_after_change(m, o.state);
end
$$;

create or replace function public.fin_void_movement(p_section uuid, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); o public.fin_movements;
begin
  if length(trim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'Indica o motivo da anulação.'; end if;
  o := private.fin_get_movement(p_section, v_space, p_id);
  if o.voided_at is not null then raise exception 'Este movimento já está anulado.'; end if;
  update public.fin_movements set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason),
         updated_by = auth.uid(), updated_at = now()
   where id = o.id;
  perform private.fin_refresh_charge(o.quota_charge_id);
end
$$;

-- Corrigir: o original fica anulado («Corrigido») e ligado ao movimento novo, que o substitui.
create or replace function public.fin_correct_movement(
  p_section uuid, p_id uuid, p_kind text, p_on date, p_description text, p_category text, p_amount bigint, p_account uuid,
  p_state text, p_activity uuid, p_member uuid, p_notes text, p_reason text, p_allow_excess boolean default false
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); o public.fin_movements; m public.fin_movements;
begin
  if length(trim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'Indica o motivo da correção.'; end if;
  o := private.fin_get_movement(p_section, v_space, p_id);
  if o.voided_at is not null then raise exception 'Este movimento já está anulado ou corrigido.'; end if;
  perform private.fin_validate(p_section, v_space, p_kind, p_on, p_description, p_category, p_amount, p_account, p_state, p_activity, p_member, o.account_id);
  if o.quota_charge_id is not null then
    if p_kind <> 'receita' then raise exception 'O pagamento de uma quota é sempre uma receita.'; end if;
    perform private.fin_check_charge(p_section, v_space, o.quota_charge_id, p_member, p_amount, o.id, p_allow_excess);
  end if;
  insert into public.fin_movements (section_id, space, kind, occurred_on, description, category, amount_cents, account_id, activity_id,
                                    member_profile_id, quota_charge_id, state, notes, corrects_id, created_by)
  values (p_section, v_space, p_kind, p_on, trim(p_description), trim(p_category), p_amount, p_account, p_activity,
          p_member, o.quota_charge_id, p_state, nullif(trim(coalesce(p_notes, '')), ''), o.id, auth.uid())
  returning * into m;
  update public.fin_movements set replaced_by = m.id, voided_at = now(), voided_by = auth.uid(),
         void_reason = 'Corrigido: ' || trim(p_reason), updated_by = auth.uid(), updated_at = now()
   where id = o.id;
  perform private.fin_after_change(m, o.state);
  return m.id;
end
$$;

-- Lista de movimentos (inclui pagamentos individuais): só para quem gere.
create or replace function public.fin_list_movements(
  p_section uuid, p_from date default null, p_to date default null, p_category text default null,
  p_activity uuid default null, p_state text default null, p_include_voided boolean default true
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section);
begin
  return coalesce((select jsonb_agg(private.fin_movement_json(m) order by m.occurred_on desc, m.created_at desc)
    from public.fin_movements m
   where m.section_id = p_section and m.space = v_space
     and (p_from is null or m.occurred_on >= p_from) and (p_to is null or m.occurred_on <= p_to)
     and (p_category is null or m.category = p_category) and (p_activity is null or m.activity_id = p_activity)
     and (p_state is null or m.state = p_state)
     and (coalesce(p_include_voided, true) or m.voided_at is null)), '[]'::jsonb);
end
$$;

-- Histórico (auditoria) de um registo da Tesouraria: só para quem gere.
create or replace function public.fin_history(p_section uuid, p_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'entity', a.entity, 'action', a.action, 'old_values', a.old_values,
                                                       'new_values', a.new_values, 'actor_name', private.fin_name(a.actor), 'at', a.at) order by a.id)
                     from public.fin_audit a where a.section_id = p_section and a.space = v_space and a.entity_id = p_entity_id), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Resumos partilhados (totais; nunca pagamentos individuais)
-- ---------------------------------------------------------------------------
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
      -- Saldo atual (efetivo, todos os períodos) de cada conta ou caixa ativa.
      'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind,
                              'saldo', coalesce((select sum(case when m.kind = 'receita' then m.amount_cents else -m.amount_cents end)
                                                   from public.fin_movements m
                                                  where m.account_id = a.id and m.space = v_space and m.voided_at is null and m.state = 'efetivo'), 0))
                              order by a.name)
                         from public.fin_accounts a where a.section_id = p_section and a.space = v_space and a.archived_at is null), '[]'::jsonb),
      'count', (select count(*) from mv)
    ));
end
$$;

-- Orçamento (previsto) vs resultado (efetivo) por atividade. Totais apenas.
create or replace function public.fin_activity_results(p_section uuid, p_activity uuid default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'activity_id', e.id, 'title', e.title, 'status', e.status,
      'day', coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date),
      'orcamento', jsonb_build_object('receitas', b.r, 'despesas', b.d, 'resultado', b.r - b.d),
      'efetivo', jsonb_build_object('receitas', m.r, 'despesas', m.d, 'resultado', m.r - m.d),
      'por_confirmar', jsonb_build_object('receitas', m.pr, 'despesas', m.pd, 'resultado', m.pr - m.pd),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'category', l.category, 'description', l.description,
                                   'amount_cents', l.amount_cents) order by l.kind desc, l.category, l.created_at)
                           from public.fin_budget_lines l
                          where l.activity_id = e.id and l.section_id = p_section and l.space = v_space and l.voided_at is null), '[]'::jsonb),
      'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', c.category, 'kind', c.kind, 'orcamento', c.o, 'efetivo', c.ef)
                                   order by c.kind desc, c.category)
                           from (select category, kind, sum(o) o, sum(ef) ef from (
                                   select category, kind, amount_cents o, 0::bigint ef from public.fin_budget_lines
                                    where activity_id = e.id and section_id = p_section and space = v_space and voided_at is null
                                   union all
                                   select category, kind, 0::bigint, amount_cents from public.fin_movements
                                    where activity_id = e.id and section_id = p_section and space = v_space and voided_at is null and state = 'efetivo'
                                 ) u group by category, kind) c), '[]'::jsonb)
    ) order by coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date) desc, e.title)
    from public.cal_events e
    cross join lateral (select coalesce(sum(amount_cents) filter (where kind = 'receita'), 0) r,
                               coalesce(sum(amount_cents) filter (where kind = 'despesa'), 0) d
                          from public.fin_budget_lines where activity_id = e.id and section_id = p_section and space = v_space and voided_at is null) b
    cross join lateral (select coalesce(sum(amount_cents) filter (where state = 'efetivo' and kind = 'receita'), 0) r,
                               coalesce(sum(amount_cents) filter (where state = 'efetivo' and kind = 'despesa'), 0) d,
                               coalesce(sum(amount_cents) filter (where state <> 'efetivo' and kind = 'receita'), 0) pr,
                               coalesce(sum(amount_cents) filter (where state <> 'efetivo' and kind = 'despesa'), 0) pd,
                               count(*) n
                          from public.fin_movements where activity_id = e.id and section_id = p_section and space = v_space and voided_at is null) m
   where e.section_id = p_section and e.space = v_space and (p_activity is null or e.id = p_activity)
     and (p_activity is not null or m.n > 0 or exists (select 1 from public.fin_budget_lines l where l.activity_id = e.id and l.space = v_space and l.voided_at is null))
  ), '[]'::jsonb);
end
$$;

create or replace function public.fin_save_budget_line(
  p_section uuid, p_id uuid, p_activity uuid, p_kind text, p_category text, p_description text, p_amount bigint
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); v_id uuid;
begin
  if p_kind is null or p_kind not in ('receita', 'despesa') then raise exception 'Indica se é uma receita ou uma despesa.'; end if;
  if length(trim(coalesce(p_category, ''))) not between 1 and 60 then raise exception 'Escolhe uma categoria (até 60 caracteres).'; end if;
  if length(trim(coalesce(p_description, ''))) not between 1 and 200 then raise exception 'Escreve uma descrição (até 200 caracteres).'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then raise exception 'Indica um valor superior a zero.'; end if;
  if not exists (select 1 from public.cal_events e where e.id = p_activity and e.section_id = p_section and e.space = v_space) then
    raise exception 'Atividade não encontrada.';
  end if;
  if p_id is null then
    insert into public.fin_budget_lines (section_id, space, activity_id, kind, category, description, amount_cents, created_by)
    values (p_section, v_space, p_activity, p_kind, trim(p_category), trim(p_description), p_amount, auth.uid()) returning id into v_id;
  else
    update public.fin_budget_lines set kind = p_kind, category = trim(p_category), description = trim(p_description), amount_cents = p_amount,
           activity_id = p_activity, updated_by = auth.uid(), updated_at = now()
     where id = p_id and section_id = p_section and space = v_space and voided_at is null returning id into v_id;
    if v_id is null then raise exception 'Registo não encontrado.'; end if;
  end if;
  return v_id;
end
$$;

create or replace function public.fin_void_budget_line(p_section uuid, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section);
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Indica o motivo da anulação.'; end if;
  update public.fin_budget_lines set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason), updated_by = auth.uid(), updated_at = now()
   where id = p_id and section_id = p_section and space = v_space and voided_at is null;
  if not found then raise exception 'Registo não encontrado.'; end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Quotas
-- ---------------------------------------------------------------------------
create or replace function public.fin_save_quota(
  p_section uuid, p_id uuid, p_name text, p_period_start date, p_period_end date, p_amount bigint, p_due_date date
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); v_id uuid; c uuid;
begin
  if length(trim(coalesce(p_name, ''))) not between 1 and 120 then raise exception 'Indica o nome da quota (até 120 caracteres).'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then raise exception 'Indica um período válido (início e fim).'; end if;
  if p_due_date is null then raise exception 'Indica a data limite de pagamento.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then raise exception 'Indica um valor superior a zero.'; end if;
  if p_id is null then
    insert into public.fin_quotas (section_id, space, name, period_start, period_end, amount_cents, due_date, created_by)
    values (p_section, v_space, trim(p_name), p_period_start, p_period_end, p_amount, p_due_date, auth.uid()) returning id into v_id;
  else
    -- O valor devido por cada membro fica fixado quando a quota lhe é aplicada.
    update public.fin_quotas set name = trim(p_name), period_start = p_period_start, period_end = p_period_end, amount_cents = p_amount,
           due_date = p_due_date, updated_by = auth.uid(), updated_at = now()
     where id = p_id and section_id = p_section and space = v_space and status = 'ativa' returning id into v_id;
    if v_id is null then raise exception 'Registo não encontrado.'; end if;
    for c in select id from public.fin_quota_charges where quota_id = v_id loop perform private.fin_refresh_charge(c); end loop;
  end if;
  return v_id;
end
$$;

create or replace function public.fin_void_quota(p_section uuid, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); c uuid;
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Indica o motivo da anulação.'; end if;
  update public.fin_quotas set status = 'anulada', void_reason = trim(p_reason), voided_at = now(), voided_by = auth.uid(),
         updated_by = auth.uid(), updated_at = now()
   where id = p_id and section_id = p_section and space = v_space and status = 'ativa';
  if not found then raise exception 'Registo não encontrado.'; end if;
  for c in select id from public.fin_quota_charges where quota_id = p_id loop perform private.fin_refresh_charge(c); end loop;
end
$$;

-- Aplica a quota a membros (fração opcional, p. ex. 1/3 para quem entra a meio do período).
create or replace function public.fin_apply_quota(
  p_section uuid, p_quota uuid, p_profiles uuid[], p_num int default 1, p_den int default 1
) returns int language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); q public.fin_quotas; p uuid; v_id uuid; n int := 0; v_new uuid[] := '{}';
begin
  select * into q from public.fin_quotas where id = p_quota and section_id = p_section and space = v_space for update;
  if q.id is null then raise exception 'Registo não encontrado.'; end if;
  if q.status <> 'ativa' then raise exception 'Esta quota já foi anulada.'; end if;
  if p_num is null or p_den is null or p_num < 1 or p_den < 1 or p_num > p_den or p_den > 12 then
    raise exception 'Fração inválida: usa, por exemplo, 1/3 ou 2/3 (até 12 partes).';
  end if;
  if coalesce(cardinality(p_profiles), 0) = 0 then raise exception 'Escolhe pelo menos um membro.'; end if;
  foreach p in array p_profiles loop
    if not exists (select 1 from public.memberships m where m.profile_id = p and m.section_id = p_section and m.status = 'ativo') then
      raise exception 'Só membros ativos da secção podem ter quotas.';
    end if;
    insert into public.fin_quota_charges (section_id, space, quota_id, profile_id, amount_cents, created_by)
    values (p_section, v_space, q.id, p, private.fin_fraction(q.amount_cents, p_num, p_den), auth.uid())
    on conflict (quota_id, profile_id) do nothing returning id into v_id;
    if v_id is not null then
      n := n + 1; v_new := v_new || p;
      perform private.fin_refresh_charge(v_id);
    end if;
    v_id := null;
  end loop;
  if n > 0 then
    perform private.module_notify(p_section, 'tesouraria', v_space, v_new, 'fin_quota', 'Nova quota',
      'Tens uma nova quota na Tesouraria.', '/tesouraria/minha');
  end if;
  return n;
end
$$;

create or replace function public.fin_waive_charge(p_section uuid, p_charge uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section);
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Indica o motivo da isenção.'; end if;
  update public.fin_quota_charges set status = 'isenta', waive_reason = trim(p_reason), waived_at = now(), waived_by = auth.uid(),
         updated_by = auth.uid(), updated_at = now()
   where id = p_charge and section_id = p_section and space = v_space and status = 'ativa';
  if not found then raise exception 'Registo não encontrado.'; end if;
  perform private.fin_refresh_charge(p_charge);
end
$$;

-- Registar o pagamento de uma quota: cria o movimento (receita do membro) já ligado à quota.
create or replace function public.fin_register_payment(
  p_section uuid, p_charge uuid, p_on date, p_account uuid, p_amount bigint, p_state text default 'efetivo',
  p_allow_excess boolean default false, p_client_key uuid default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); c record; m public.fin_movements;
begin
  select ch.profile_id, q.name into c from public.fin_quota_charges ch join public.fin_quotas q on q.id = ch.quota_id
   where ch.id = p_charge and ch.section_id = p_section and ch.space = v_space;
  if c.profile_id is null then raise exception 'Quota do membro não encontrada.'; end if;
  perform private.fin_validate(p_section, v_space, 'receita', p_on, 'Quota: ' || c.name, 'Quotas', p_amount, p_account, p_state, null, c.profile_id);
  if p_client_key is not null and exists (select 1 from public.fin_movements where section_id = p_section and client_key = p_client_key) then
    raise exception 'Este pagamento já foi registado (envio repetido).';
  end if;
  perform private.fin_check_charge(p_section, v_space, p_charge, c.profile_id, p_amount, null, p_allow_excess);
  insert into public.fin_movements (section_id, space, kind, occurred_on, description, category, amount_cents, account_id,
                                    member_profile_id, quota_charge_id, state, notes, client_key, created_by)
  values (p_section, v_space, 'receita', p_on, left('Quota: ' || c.name, 200), 'Quotas', p_amount, p_account,
          c.profile_id, p_charge, p_state, nullif(trim(coalesce(p_notes, '')), ''), p_client_key, auth.uid())
  returning * into m;
  perform private.fin_after_change(m, null);
  return m.id;
end
$$;

-- Ligar um pagamento já registado (receita do membro) a uma quota. Nunca duas vezes.
create or replace function public.fin_link_payment(p_section uuid, p_movement uuid, p_charge uuid, p_allow_excess boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section); o public.fin_movements; m public.fin_movements;
begin
  o := private.fin_get_movement(p_section, v_space, p_movement);
  if o.voided_at is not null then raise exception 'Este movimento está anulado.'; end if;
  if o.quota_charge_id is not null then raise exception 'Este pagamento já está ligado a uma quota: não pode contar duas vezes.'; end if;
  if o.kind <> 'receita' or o.member_profile_id is null then raise exception 'Só uma receita de um membro pode pagar uma quota.'; end if;
  perform private.fin_check_charge(p_section, v_space, p_charge, o.member_profile_id, o.amount_cents, o.id, p_allow_excess);
  update public.fin_movements set quota_charge_id = p_charge, updated_by = auth.uid(), updated_at = now() where id = o.id returning * into m;
  perform private.fin_refresh_charge(p_charge);
end
$$;

create or replace function private.fin_charge_json(ch public.fin_quota_charges, p_with_name boolean)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', ch.id, 'quota_id', ch.quota_id, 'profile_id', ch.profile_id,
    'member_name', case when p_with_name then coalesce(private.fin_name(ch.profile_id), 'Sem nome') end,
    'amount_cents', ch.amount_cents, 'status', ch.status, 'waive_reason', ch.waive_reason,
    'pago', t.ef, 'pendente', t.pe, 'em_falta', case when ch.status = 'ativa' then greatest(ch.amount_cents - t.ef, 0) else 0 end,
    'excesso', greatest(t.ef + t.pe - ch.amount_cents, 0)
  )
  from (select coalesce(sum(amount_cents) filter (where state = 'efetivo'), 0) ef,
               coalesce(sum(amount_cents) filter (where state <> 'efetivo'), 0) pe
          from public.fin_movements where quota_charge_id = ch.id and voided_at is null) t
$$;

create or replace function public.fin_list_quotas(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.fin_require_manage(p_section);
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', q.id, 'name', q.name, 'period_start', q.period_start, 'period_end', q.period_end, 'amount_cents', q.amount_cents,
      'due_date', q.due_date, 'status', q.status, 'void_reason', q.void_reason,
      'charges', coalesce((select jsonb_agg(private.fin_charge_json(ch, true) order by private.fin_name(ch.profile_id))
                             from public.fin_quota_charges ch where ch.quota_id = q.id), '[]'::jsonb)
    ) order by q.status, q.period_start desc, q.name)
    from public.fin_quotas q where q.section_id = p_section and q.space = v_space), '[]'::jsonb);
end
$$;

-- A própria situação: quotas devidas, pagas e pendentes, e os próprios pagamentos.
create or replace function public.fin_my_situation(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria');
begin
  return (
    with ch as (
      select private.fin_charge_json(c, false) || jsonb_build_object('quota_name', q.name, 'period_start', q.period_start,
               'period_end', q.period_end, 'due_date', q.due_date, 'quota_status', q.status) j, q.status qs
        from public.fin_quota_charges c join public.fin_quotas q on q.id = c.quota_id
       where c.section_id = p_section and c.space = v_space and c.profile_id = auth.uid()
    )
    select jsonb_build_object(
      'charges', coalesce((select jsonb_agg(j order by j ->> 'due_date' desc) from ch), '[]'::jsonb),
      'totals', jsonb_build_object(
        'devido', coalesce((select sum((j ->> 'amount_cents')::bigint) from ch where qs = 'ativa' and j ->> 'status' = 'ativa'), 0),
        'pago', coalesce((select sum((j ->> 'pago')::bigint) from ch), 0),
        'pendente', coalesce((select sum((j ->> 'pendente')::bigint) from ch), 0),
        'em_falta', coalesce((select sum((j ->> 'em_falta')::bigint) from ch where qs = 'ativa'), 0)),
      'payments', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'occurred_on', m.occurred_on, 'description', m.description,
                              'category', m.category, 'amount_cents', m.amount_cents, 'state', m.state,
                              'quota_name', (select q.name from public.fin_quota_charges c join public.fin_quotas q on q.id = c.quota_id where c.id = m.quota_charge_id),
                              'files', (select count(*) from public.module_files f where f.module = 'tesouraria' and f.entity = 'movimento'
                                          and f.entity_id = m.id and f.removed_at is null))
                              order by m.occurred_on desc, m.created_at desc)
                         from public.fin_movements m
                        where m.section_id = p_section and m.space = v_space and m.member_profile_id = auth.uid() and m.voided_at is null), '[]'::jsonb)
    ));
end
$$;

-- Publicar com «passar dados de teste a reais»: passa todas as tabelas fin_ e, como as
-- atividades vêm do Calendário (que pode não passar as suas), desliga dos registos reais
-- qualquer atividade que não seja real: movimentos ficam sem atividade, linhas de orçamento
-- são anuladas. Tudo fica na auditoria; nada é apagado.
create or replace function private.tesouraria_publish_move(p_section uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_t text;
begin
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
