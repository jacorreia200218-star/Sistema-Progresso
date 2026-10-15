-- Pioneiros — base comum dos módulos (Calendário escutista, Inventário, Tesouraria,
-- Equipas e cargos, Secretaria).
--
-- • Cada módulo tem, por secção, um estado: «desenvolvimento» (fechado), «teste»
--   (só testers escolhidos pela administração) ou «disponivel» (todos os membros ativos).
-- • Dois espaços de dados por módulo: «teste» e «real». Os testers trabalham no espaço
--   de teste; ao publicar, o espaço real começa vazio, salvo se a administração escolher
--   explicitamente passar os dados de teste para reais. Desativar nunca apaga dados.
-- • Ser tester só dá acesso ao módulo. Gerir, editar ou aprovar exige uma permissão
--   explícita (module_grants) ou, onde indicado, a função de dirigente. Cargos de equipa
--   nunca concedem permissões técnicas.
-- • Todas as tabelas dos módulos têm RLS sem políticas: lê-se e escreve-se apenas através
--   de funções que verificam o acesso no servidor.
-- • Notificações dos módulos: no espaço de teste só chegam a testers do módulo e levam
--   «[Teste]» no título. Lembretes programados sem duplicados (module_reminders).
-- Aditivo: não altera dados nem permissões existentes e não adiciona testers.

create table if not exists public.module_settings (
  section_id uuid not null references public.sections (id) on delete cascade,
  module text not null check (module in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria')),
  status text not null default 'desenvolvimento' check (status in ('desenvolvimento', 'teste', 'disponivel')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (section_id, module)
);

create table if not exists public.module_testers (
  section_id uuid not null references public.sections (id) on delete cascade,
  module text not null check (module in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria')),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (section_id, module, profile_id)
);

-- Permissões dentro dos módulos (concedidas só pela administração).
create table if not exists public.module_grants (
  section_id uuid not null references public.sections (id) on delete cascade,
  permission text not null check (permission in (
    'calendario.gerir', 'inventario.gerir', 'tesouraria.gerir', 'equipas.gerir',
    'secretaria.redigir', 'secretaria.aprovar')),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (section_id, permission, profile_id)
);

alter table public.module_settings enable row level security;
alter table public.module_testers enable row level security;
alter table public.module_grants enable row level security;

-- ---------------------------------------------------------------------------
-- Acesso
-- ---------------------------------------------------------------------------
create or replace function private.module_status(p_section uuid, p_module text)
returns text language sql stable security definer set search_path = ''
as $$
  select coalesce((select status from public.module_settings where section_id = p_section and module = p_module), 'desenvolvimento')
$$;

-- Espaço de dados a que a pessoa atual tem acesso neste módulo (null = sem acesso).
create or replace function private.module_space(p_section uuid, p_module text)
returns text language sql stable security definer set search_path = ''
as $$
  select case
    when not private.is_active_member(p_section) then null
    when private.module_status(p_section, p_module) = 'disponivel' then 'real'
    when private.module_status(p_section, p_module) = 'teste'
         and exists (select 1 from public.module_testers t
                      where t.section_id = p_section and t.module = p_module and t.profile_id = auth.uid()) then 'teste'
    else null end
$$;

-- Garante acesso e devolve o espaço; caso contrário, erro.
create or replace function private.module_require(p_section uuid, p_module text)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v text := private.module_space(p_section, p_module);
begin
  if v is null then raise exception 'Este módulo ainda não está disponível para ti.' using errcode = '42501'; end if;
  return v;
end
$$;

create or replace function private.has_grant(p_section uuid, p_permission text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.module_grants g
                  where g.section_id = p_section and g.permission = p_permission and g.profile_id = auth.uid())
$$;

-- Pode gerir: acesso ao módulo e (permissão explícita ou, quando permitido, dirigente).
create or replace function private.module_can(p_section uuid, p_module text, p_permission text, p_dirigente_ok boolean)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.module_space(p_section, p_module) is not null
     and (private.has_grant(p_section, p_permission) or (p_dirigente_ok and private.is_dirigente(p_section)))
$$;

create or replace function private.module_require_can(p_section uuid, p_module text, p_permission text, p_dirigente_ok boolean)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v text := private.module_require(p_section, p_module);
begin
  if not private.module_can(p_section, p_module, p_permission, p_dirigente_ok) then
    raise exception 'Não tens permissão para esta ação neste módulo.' using errcode = '42501';
  end if;
  return v;
end
$$;

-- Destinatários de uma notificação de módulo: no espaço de teste, só testers.
create or replace function private.module_recipients(p_section uuid, p_module text, p_space text, p_profiles uuid[])
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct p), '{}') from unnest(coalesce(p_profiles, '{}')) p
   where p is not null
     and exists (select 1 from public.memberships m where m.profile_id = p and m.section_id = p_section and m.status = 'ativo')
     and (p_space = 'real' or exists (select 1 from public.module_testers t
                                       where t.section_id = p_section and t.module = p_module and t.profile_id = p))
$$;

create or replace function private.module_notify(
  p_section uuid, p_module text, p_space text, p_profiles uuid[], p_kind text, p_title text, p_body text, p_link text
) returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.notify(private.module_recipients(p_section, p_module, p_space, p_profiles), p_section, p_kind,
    case when p_space = 'teste' then '[Teste] ' || p_title else p_title end, p_body, p_link);
end
$$;

-- ---------------------------------------------------------------------------
-- Lembretes programados (sem duplicados; cancelados ou reagendados quando muda o evento)
-- ---------------------------------------------------------------------------
create table if not exists public.module_reminders (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  module text not null,
  space text not null check (space in ('teste', 'real')),
  entity text not null,
  entity_id uuid not null,
  kind text not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  due_at timestamptz not null,
  title text not null,
  body text,
  link text,
  sent_at timestamptz,
  cancelled_at timestamptz,
  unique (entity, entity_id, kind, profile_id)
);
create index if not exists module_reminders_due on public.module_reminders (due_at) where sent_at is null and cancelled_at is null;
alter table public.module_reminders enable row level security;

create or replace function private.schedule_reminder(
  p_section uuid, p_module text, p_space text, p_entity text, p_entity_id uuid, p_kind text,
  p_profile uuid, p_due timestamptz, p_title text, p_body text, p_link text
) returns void language sql security definer set search_path = ''
as $$
  insert into public.module_reminders (section_id, module, space, entity, entity_id, kind, profile_id, due_at, title, body, link)
  values (p_section, p_module, p_space, p_entity, p_entity_id, p_kind, p_profile, p_due, p_title, p_body, p_link)
  on conflict (entity, entity_id, kind, profile_id) do update
    set due_at = excluded.due_at, title = excluded.title, body = excluded.body, link = excluded.link,
        cancelled_at = null,
        -- Reagendar para o futuro volta a permitir o envio.
        sent_at = case when excluded.due_at > now() then null else public.module_reminders.sent_at end
$$;

create or replace function private.cancel_reminders(p_entity text, p_entity_id uuid, p_profile uuid default null)
returns void language sql security definer set search_path = ''
as $$
  update public.module_reminders set cancelled_at = now()
   where entity = p_entity and entity_id = p_entity_id and sent_at is null and cancelled_at is null
     and (p_profile is null or profile_id = p_profile)
$$;

-- Envia os lembretes vencidos (chamado pelo agendador a cada 5 minutos).
create or replace function private.process_due_reminders()
returns integer language plpgsql security definer set search_path = ''
as $$
declare r public.module_reminders; n int := 0;
begin
  for r in select * from public.module_reminders
            where sent_at is null and cancelled_at is null and due_at <= now()
            order by due_at limit 500 for update skip locked
  loop
    -- Quem deixou de ter acesso ao módulo (ou ao espaço de teste) não recebe.
    if private.module_status(r.section_id, r.module) <> 'desenvolvimento'
       and (r.space = 'real') = (private.module_status(r.section_id, r.module) = 'disponivel') then
      perform private.module_notify(r.section_id, r.module, r.space, array[r.profile_id], 'lembrete', r.title, r.body, r.link);
    end if;
    update public.module_reminders set sent_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end
$$;

create or replace function public.process_due_reminders()
returns integer language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_service_role() and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return private.process_due_reminders();
end
$$;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('pioneiros-lembretes', '*/5 * * * *', 'select private.process_due_reminders()');
exception when others then
  raise notice 'pg_cron indisponível: ativa-o em Database › Extensions para os lembretes serem enviados.';
end $$;

-- ---------------------------------------------------------------------------
-- Consulta e administração
-- ---------------------------------------------------------------------------
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
  from unnest(array['calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria']) k
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
    from unnest(array['calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria']) k
  );
end
$$;

-- Tabelas de dados de cada módulo: todas têm section_id e space e começam pelo prefixo
-- do módulo (usadas para passar dados de teste a reais ao publicar).
create or replace function private.module_prefix(p_module text)
returns text language sql immutable set search_path = ''
as $$
  select case p_module when 'calendario' then 'cal_' when 'inventario' then 'inv_' when 'tesouraria' then 'fin_'
                       when 'equipas' then 'eq_' when 'secretaria' then 'sec_' end
$$;

create or replace function private.module_tables(p_module text)
returns text[] language sql stable set search_path = ''
as $$
  select coalesce(array_agg(c.table_name::text order by c.table_name), '{}')
    from information_schema.columns c
    join information_schema.columns s on s.table_schema = c.table_schema and s.table_name = c.table_name and s.column_name = 'section_id'
   where c.table_schema = 'public' and c.column_name = 'space'
     and c.table_name like private.module_prefix(p_module) || '%'
$$;

create or replace function public.set_module_status(p_section uuid, p_module text, p_status text, p_move_test_data boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_old text; v_t text; v_c text;
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  if p_status not in ('desenvolvimento', 'teste', 'disponivel') then raise exception 'Estado inválido.'; end if;
  if p_module not in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria') then raise exception 'Módulo inválido.'; end if;
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
  if p_module not in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria') then raise exception 'Módulo inválido.'; end if;
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

create or replace function public.set_module_grant(p_section uuid, p_permission text, p_profile uuid, p_on boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  if p_on then
    if not exists (select 1 from public.memberships where section_id = p_section and profile_id = p_profile and status = 'ativo') then
      raise exception 'Só membros ativos da secção podem receber permissões.';
    end if;
    insert into public.module_grants (section_id, permission, profile_id, granted_by) values (p_section, p_permission, p_profile, auth.uid())
    on conflict do nothing;
  else
    delete from public.module_grants where section_id = p_section and permission = p_permission and profile_id = p_profile;
  end if;
  perform private.audit(p_section, case when p_on then 'permissao_concedida' else 'permissao_retirada' end, 'module_grant', p_permission,
    jsonb_build_object('profile', p_profile));
end
$$;

-- ---------------------------------------------------------------------------
-- Anexos dos módulos (bucket privado «modulos»)
-- 1) module_file_prepare valida a permissão e reserva o caminho; 2) o cliente carrega o
-- ficheiro para esse caminho (a política só aceita caminhos reservados pela própria
-- pessoa); 3) quem pode ler é decidido pelo módulo dono, através de
-- private.<módulo>_file_access(entity, entity_id, write). Anexos nunca se apagam:
-- retiram-se (deixam de estar visíveis), mantendo a rastreabilidade.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('modulos', 'modulos', false, 10 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.module_files (
  path text primary key,
  section_id uuid not null references public.sections (id) on delete cascade,
  module text not null,
  space text not null check (space in ('teste', 'real')),
  entity text not null,
  entity_id uuid not null,
  file_name text not null check (length(file_name) between 1 and 200),
  mime text not null,
  uploaded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid
);
create index if not exists module_files_entity on public.module_files (entity, entity_id);
alter table public.module_files enable row level security;

create or replace function private.module_file_access(p_path text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare f public.module_files; v boolean;
begin
  select * into f from public.module_files where path = p_path;
  if f.path is null or f.removed_at is not null then return false; end if;
  if private.module_space(f.section_id, f.module) is distinct from f.space then return false; end if;
  execute format('select private.%I($1, $2, $3)', f.module || '_file_access') into v using f.entity, f.entity_id, p_write;
  return coalesce(v, false);
exception when undefined_function then
  return false;
end
$$;

create or replace function private.module_file_can_upload(p_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.module_files f where f.path = p_path and f.uploaded_by = auth.uid()
                  and f.removed_at is null and f.created_at > now() - interval '1 hour')
$$;

create or replace function public.module_file_prepare(
  p_section uuid, p_module text, p_entity text, p_entity_id uuid, p_file_name text, p_mime text
) returns text language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, p_module); v_path text; v boolean;
begin
  if p_mime not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'Tipo de ficheiro não permitido. Usa JPG, PNG, WebP ou PDF.';
  end if;
  begin
    execute format('select private.%I($1, $2, true)', p_module || '_file_access') into v using p_entity, p_entity_id;
  exception when undefined_function then v := false;
  end;
  if not coalesce(v, false) then raise exception 'Não tens permissão para anexar ficheiros aqui.' using errcode = '42501'; end if;
  v_path := p_section || '/' || p_module || '/' || v_space || '/' || gen_random_uuid()
            || '-' || regexp_replace(left(coalesce(p_file_name, 'ficheiro'), 80), '[^A-Za-z0-9._-]+', '_', 'g');
  insert into public.module_files (path, section_id, module, space, entity, entity_id, file_name, mime)
  values (v_path, p_section, p_module, v_space, p_entity, p_entity_id, left(p_file_name, 200), p_mime);
  return v_path;
end
$$;

-- Anexos visíveis de uma entidade (só os que a pessoa pode ler).
create or replace function public.module_files_of(p_section uuid, p_module text, p_entity text, p_entity_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('path', f.path, 'file_name', f.file_name, 'mime', f.mime, 'created_at', f.created_at)
                  order by f.created_at), '[]'::jsonb)
    from public.module_files f
   where f.section_id = p_section and f.module = p_module and f.entity = p_entity and f.entity_id = p_entity_id
     and f.removed_at is null and private.module_file_access(f.path, false)
$$;

create or replace function public.module_file_remove(p_path text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.module_file_access(p_path, true) then
    raise exception 'Não tens permissão para retirar este anexo.' using errcode = '42501';
  end if;
  update public.module_files set removed_at = now(), removed_by = auth.uid() where path = p_path;
end
$$;

drop policy if exists "modulos: carregar caminho reservado" on storage.objects;
drop policy if exists "modulos: ler com acesso ao módulo" on storage.objects;
create policy "modulos: carregar caminho reservado" on storage.objects for insert to authenticated
  with check (bucket_id = 'modulos' and private.module_file_can_upload(name));
create policy "modulos: ler com acesso ao módulo" on storage.objects for select to authenticated
  using (bucket_id = 'modulos' and private.module_file_access(name, false));
grant execute on function private.module_file_can_upload(text), private.module_file_access(text, boolean) to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;
grant execute on function public.process_due_reminders() to service_role;
