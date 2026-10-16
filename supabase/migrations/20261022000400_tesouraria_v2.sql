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
