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
