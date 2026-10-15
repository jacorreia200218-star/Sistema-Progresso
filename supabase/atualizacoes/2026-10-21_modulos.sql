-- Atualização «Módulos» (21/10/2026) para um projeto já instalado (com a atualização
-- 2026-10-20_notificacoes_push.sql já aplicada). Cola no SQL Editor e carrega em «Run» UMA vez.
-- Cria os cinco módulos (Calendário, Inventário, Tesouraria, Equipas e cargos, Secretaria),
-- todos no estado «Em desenvolvimento»: ninguém os vê até a administração os ativar.
-- Não altera nem apaga registos existentes nem permissões de utilizadores.

-- ===== supabase/migrations/20261021000100_modulos_base.sql =====
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

-- ===== supabase/migrations/20261021000200_calendario.sql =====
-- Pioneiros — Calendário escutista: atividades, participantes, presenças, pendências,
-- prazos e lembretes. Todas as tabelas têm section_id e space (teste/real) e RLS sem
-- políticas: leitura e escrita só por funções que verificam o acesso no servidor.
-- Horas guardadas como instantes (timestamptz) e mostradas em Europe/Lisbon; eventos de
-- dia inteiro guardados como datas (start_date/end_date, fim inclusivo), sem hora.

create table if not exists public.cal_events (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  title text not null check (length(trim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 5000),
  location text check (location is null or length(location) <= 300),
  all_day boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  start_date date,
  end_date date,
  audience text not null default 'seccao' check (audience in ('seccao', 'equipa')),
  team_id uuid references public.teams (id),
  responsible_id uuid references public.profiles (id),
  registration_deadline timestamptz,
  needs_authorization boolean not null default false,
  needs_payment boolean not null default false,
  needs_registration boolean not null default false,
  material text check (material is null or length(material) <= 2000),
  reminder_minutes integer[] not null default '{1440}',
  deadline_reminder_minutes integer[] not null default '{1440}',
  status text not null default 'ativo' check (status in ('ativo', 'cancelado')),
  cancel_reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (audience <> 'equipa' or team_id is not null),
  check ((all_day and start_date is not null and end_date is not null and end_date >= start_date and starts_at is null and ends_at is null)
      or (not all_day and starts_at is not null and ends_at is not null and ends_at >= starts_at and start_date is null and end_date is null))
);
create index if not exists cal_events_section on public.cal_events (section_id, space);
alter table public.cal_events enable row level security;

-- Anulação: quem cancelou e quando (o evento nunca se apaga).
alter table public.cal_events add column if not exists cancelled_at timestamptz;
alter table public.cal_events add column if not exists cancelled_by uuid;
create index if not exists cal_events_dates on public.cal_events (section_id, space, start_date, starts_at);

-- ---------------------------------------------------------------------------
-- Participantes: resposta (Vou / Não vou / Por confirmar), nota do próprio e
-- pendências resolvidas pelos gestores (autorização, pagamento, inscrição, material).
-- Uma linha por atividade e pessoa; nunca se apaga (as alterações ficam na auditoria).
-- «extra» = pessoa fora do público da atividade (p.ex. dirigente que acompanha).
-- ---------------------------------------------------------------------------
create table if not exists public.cal_participants (
  event_id uuid not null references public.cal_events (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  response text check (response in ('vou', 'nao_vou', 'por_confirmar')),
  note text check (note is null or length(note) <= 500),
  extra boolean not null default false,
  responded_at timestamptz,
  responded_by uuid,
  autorizacao_at timestamptz,
  autorizacao_by uuid,
  pagamento_at timestamptz,
  pagamento_by uuid,
  inscricao_at timestamptz,
  inscricao_by uuid,
  material_at timestamptz,
  material_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, profile_id)
);
create index if not exists cal_participants_section on public.cal_participants (section_id, space);
create index if not exists cal_participants_profile on public.cal_participants (profile_id);
alter table public.cal_participants enable row level security;

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
create or replace function private.cal_can_manage(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.module_can(p_section, 'calendario', 'calendario.gerir', true) $$;

-- Evento desta secção e deste espaço (ou erro «Registo não encontrado.»).
create or replace function private.cal_event_of(p_section uuid, p_space text, p_event uuid, p_lock boolean default false)
returns public.cal_events language plpgsql security definer set search_path = ''
as $$
declare e public.cal_events;
begin
  if p_lock then
    select * into e from public.cal_events where id = p_event and section_id = p_section and space = p_space for update;
  else
    select * into e from public.cal_events where id = p_event and section_id = p_section and space = p_space;
  end if;
  if e.id is null then raise exception 'Registo não encontrado.'; end if;
  return e;
end
$$;

-- Envolvidos: público da atividade (membros ativos da secção ou da equipa), responsável
-- e participantes extra — sempre membros ativos da secção.
create or replace function private.cal_involved(p_event uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct x.p), '{}') from (
    select m.profile_id as p from public.cal_events e
      join public.memberships m on m.section_id = e.section_id and m.status = 'ativo'
     where e.id = p_event and (e.audience = 'seccao' or m.team_id = e.team_id)
    union all
    select e.responsible_id from public.cal_events e where e.id = p_event
    union all
    select c.profile_id from public.cal_participants c where c.event_id = p_event and c.extra
  ) x
  join public.cal_events e2 on e2.id = p_event
  join public.memberships m2 on m2.profile_id = x.p and m2.section_id = e2.section_id and m2.status = 'ativo'
  where x.p is not null
$$;

create or replace function private.cal_in_audience(p_event uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.cal_events e join public.memberships m on m.section_id = e.section_id and m.status = 'ativo'
                  where e.id = p_event and m.profile_id = p_profile
                    and (e.audience = 'seccao' or m.team_id = e.team_id or e.responsible_id = p_profile))
$$;

-- O que a atividade exige a cada participante.
create or replace function private.cal_required(e public.cal_events)
returns text[] language sql immutable set search_path = ''
as $$
  select array_remove(array[
    case when e.needs_authorization then 'autorizacao' end,
    case when e.needs_payment then 'pagamento' end,
    case when e.needs_registration then 'inscricao' end,
    case when coalesce(trim(e.material), '') <> '' then 'material' end], null)
$$;

-- O que falta a uma pessoa (vazio se respondeu «Não vou» ou se a atividade foi cancelada).
create or replace function private.cal_missing(e public.cal_events, c public.cal_participants)
returns text[] language sql immutable set search_path = ''
as $$
  select case when e.status <> 'ativo' or c.response = 'nao_vou' then '{}'::text[] else array_remove(array[
    case when c.response is null or c.response = 'por_confirmar' then 'resposta' end,
    case when e.needs_authorization and c.autorizacao_at is null then 'autorizacao' end,
    case when e.needs_payment and c.pagamento_at is null then 'pagamento' end,
    case when e.needs_registration and c.inscricao_at is null then 'inscricao' end,
    case when coalesce(trim(e.material), '') <> '' and c.material_at is null then 'material' end], null) end
$$;

-- Instante de referência do início: dia inteiro = 09:00 em Lisboa no primeiro dia.
create or replace function private.cal_start_instant(e public.cal_events)
returns timestamptz language sql stable set search_path = ''
as $$
  select case when e.all_day then (e.start_date + time '09:00') at time zone 'Europe/Lisbon' else e.starts_at end
$$;

-- «m minutos antes» em hora de parede de Lisboa (1 dia antes = mesma hora na véspera,
-- mesmo com mudança de hora pelo meio).
create or replace function private.cal_before(p_ref timestamptz, p_minutes integer)
returns timestamptz language sql stable set search_path = ''
as $$
  select ((p_ref at time zone 'Europe/Lisbon') - make_interval(mins => p_minutes)) at time zone 'Europe/Lisbon'
$$;

create or replace function private.cal_when(e public.cal_events)
returns text language sql stable set search_path = ''
as $$
  select case
    when e.all_day and e.start_date = e.end_date then to_char(e.start_date, 'DD/MM/YYYY') || ' (dia inteiro)'
    when e.all_day then to_char(e.start_date, 'DD/MM/YYYY') || ' a ' || to_char(e.end_date, 'DD/MM/YYYY')
    else to_char(e.starts_at at time zone 'Europe/Lisbon', 'DD/MM/YYYY, HH24:MI') end
$$;

-- Lembretes da atividade: antes do início (envolvidos que não responderam «Não vou») e antes
-- do prazo de inscrição (quem ainda não respondeu ou tem pendências). Únicos por pessoa e
-- tipo; reagendados quando a atividade muda e cancelados quando deixam de se aplicar.
create or replace function private.cal_sync_reminders(p_event uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  e public.cal_events; c public.cal_participants; v_p uuid; v_m int; v_due timestamptz;
  v_keys text[] := '{}'; v_link text; v_missing text[];
begin
  select * into e from public.cal_events where id = p_event;
  if e.id is null then return; end if;
  if e.status <> 'ativo' then
    perform private.cancel_reminders('cal_event', e.id);
    return;
  end if;
  v_link := '/calendario/evento/' || e.id;
  foreach v_p in array private.cal_involved(e.id) loop
    c := null;
    select * into c from public.cal_participants where event_id = e.id and profile_id = v_p;
    v_missing := private.cal_missing(e, c);
    if c.response is distinct from 'nao_vou' then
      foreach v_m in array e.reminder_minutes loop
        v_due := private.cal_before(private.cal_start_instant(e), v_m);
        if v_due > now() then
          perform private.schedule_reminder(e.section_id, 'calendario', e.space, 'cal_event', e.id, 'antes_' || v_m, v_p, v_due,
            left('Lembrete: ' || e.title, 220), 'Começa ' || private.cal_when(e) || coalesce(' · ' || e.location, '') || '.', v_link);
          v_keys := v_keys || (v_p::text || '|antes_' || v_m);
        end if;
      end loop;
    end if;
    if e.registration_deadline is not null and cardinality(v_missing) > 0 then
      foreach v_m in array e.deadline_reminder_minutes loop
        v_due := private.cal_before(e.registration_deadline, v_m);
        if v_due > now() then
          perform private.schedule_reminder(e.section_id, 'calendario', e.space, 'cal_event', e.id, 'prazo_' || v_m, v_p, v_due,
            left('Prazo de inscrição: ' || e.title, 220),
            'O prazo termina a ' || to_char(e.registration_deadline at time zone 'Europe/Lisbon', 'DD/MM/YYYY, HH24:MI') || '. Vê o que te falta.', v_link);
          v_keys := v_keys || (v_p::text || '|prazo_' || v_m);
        end if;
      end loop;
    end if;
  end loop;
  update public.module_reminders set cancelled_at = now()
   where entity = 'cal_event' and entity_id = e.id and sent_at is null and cancelled_at is null
     and not ((profile_id::text || '|' || kind) = any (v_keys));
end
$$;

-- Lê e valida os dados de uma atividade (jsonb do formulário).
create or replace function private.cal_from_json(p_section uuid, p_data jsonb)
returns public.cal_events language plpgsql stable security definer set search_path = ''
as $$
declare e public.cal_events; v_start timestamptz;
begin
  e.section_id := p_section;
  e.title := nullif(trim(coalesce(p_data ->> 'title', '')), '');
  if e.title is null then raise exception 'Indica o título da atividade.'; end if;
  if length(e.title) > 200 then raise exception 'O título é demasiado longo (máximo 200 caracteres).'; end if;
  e.description := nullif(trim(coalesce(p_data ->> 'description', '')), '');
  if length(e.description) > 5000 then raise exception 'A descrição é demasiado longa (máximo 5000 caracteres).'; end if;
  e.location := nullif(trim(coalesce(p_data ->> 'location', '')), '');
  if length(e.location) > 300 then raise exception 'O local é demasiado longo (máximo 300 caracteres).'; end if;
  e.material := nullif(trim(coalesce(p_data ->> 'material', '')), '');
  if length(e.material) > 2000 then raise exception 'A lista de material é demasiado longa (máximo 2000 caracteres).'; end if;
  e.all_day := coalesce((p_data ->> 'all_day')::boolean, false);
  begin
    if e.all_day then
      e.start_date := (p_data ->> 'start_date')::date;
      e.end_date := coalesce((p_data ->> 'end_date')::date, e.start_date);
    else
      e.starts_at := (p_data ->> 'starts_at')::timestamptz;
      e.ends_at := coalesce((p_data ->> 'ends_at')::timestamptz, e.starts_at);
    end if;
    e.registration_deadline := nullif(p_data ->> 'registration_deadline', '')::timestamptz;
  exception when others then
    raise exception 'Data inválida. Usa o formato DD/MM/AAAA.';
  end;
  if e.all_day then
    if e.start_date is null then raise exception 'Indica o dia de início.'; end if;
    if e.end_date < e.start_date then raise exception 'O fim não pode ser antes do início.'; end if;
    if e.end_date - e.start_date > 366 then raise exception 'Uma atividade não pode durar mais de um ano.'; end if;
    v_start := (e.start_date + 1)::timestamp at time zone 'Europe/Lisbon';
  else
    if e.starts_at is null then raise exception 'Indica o dia e a hora de início.'; end if;
    if e.ends_at < e.starts_at then raise exception 'O fim não pode ser antes do início.'; end if;
    if e.ends_at - e.starts_at > interval '366 days' then raise exception 'Uma atividade não pode durar mais de um ano.'; end if;
    v_start := e.starts_at;
  end if;
  if e.registration_deadline is not null and e.registration_deadline > v_start then
    raise exception 'O prazo de inscrição tem de terminar antes do início da atividade.';
  end if;
  e.audience := coalesce(nullif(p_data ->> 'audience', ''), 'seccao');
  if e.audience not in ('seccao', 'equipa') then raise exception 'Público inválido.'; end if;
  if e.audience = 'equipa' then
    e.team_id := nullif(p_data ->> 'team_id', '')::uuid;
    if e.team_id is null then raise exception 'Escolhe a equipa.'; end if;
    if not exists (select 1 from public.teams t where t.id = e.team_id and t.section_id = p_section and t.archived_at is null) then
      raise exception 'Equipa não encontrada nesta secção.';
    end if;
  end if;
  e.responsible_id := nullif(p_data ->> 'responsible_id', '')::uuid;
  if e.responsible_id is not null and not exists (
    select 1 from public.memberships m where m.profile_id = e.responsible_id and m.section_id = p_section and m.status = 'ativo') then
    raise exception 'O responsável tem de ser membro ativo da secção.';
  end if;
  e.needs_authorization := coalesce((p_data ->> 'needs_authorization')::boolean, false);
  e.needs_payment := coalesce((p_data ->> 'needs_payment')::boolean, false);
  e.needs_registration := coalesce((p_data ->> 'needs_registration')::boolean, false);
  e.reminder_minutes := case when p_data ? 'reminder_minutes'
    then array(select distinct x::int from jsonb_array_elements_text(p_data -> 'reminder_minutes') x order by 1 desc) else '{1440}' end;
  e.deadline_reminder_minutes := case when p_data ? 'deadline_reminder_minutes'
    then array(select distinct x::int from jsonb_array_elements_text(p_data -> 'deadline_reminder_minutes') x order by 1 desc) else '{1440}' end;
  if cardinality(e.reminder_minutes) > 5 or cardinality(e.deadline_reminder_minutes) > 5 then
    raise exception 'No máximo cinco lembretes de cada tipo.';
  end if;
  if exists (select 1 from unnest(e.reminder_minutes || e.deadline_reminder_minutes) m where m < 5 or m > 43200) then
    raise exception 'Os lembretes têm de ser entre 5 minutos e 30 dias antes.';
  end if;
  return e;
end
$$;

-- Evento em formato JSON (para listas e detalhe).
create or replace function private.cal_event_json(e public.cal_events)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'title', e.title, 'description', e.description, 'location', e.location,
    'all_day', e.all_day, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'start_date', e.start_date, 'end_date', e.end_date,
    'audience', e.audience, 'team_id', e.team_id, 'team_name', (select t.name from public.teams t where t.id = e.team_id),
    'responsible_id', e.responsible_id,
    'responsible_name', (select p.full_name from public.profiles p where p.id = e.responsible_id),
    'registration_deadline', e.registration_deadline,
    'deadline_passed', e.registration_deadline is not null and now() > e.registration_deadline,
    'needs_authorization', e.needs_authorization, 'needs_payment', e.needs_payment, 'needs_registration', e.needs_registration,
    'material', e.material, 'required', to_jsonb(private.cal_required(e)),
    'reminder_minutes', to_jsonb(e.reminder_minutes), 'deadline_reminder_minutes', to_jsonb(e.deadline_reminder_minutes),
    'status', e.status, 'cancel_reason', e.cancel_reason, 'cancelled_at', e.cancelled_at,
    'updated_at', e.updated_at, 'created_at', e.created_at)
$$;

-- ---------------------------------------------------------------------------
-- Consultas
-- ---------------------------------------------------------------------------
-- Atividades que se sobrepõem ao intervalo [p_from, p_to] (dias em Lisboa).
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
        from public.cal_participants cc where cc.event_id = e.id and cc.profile_id = any (x.inv)))
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

-- Detalhe: atividade, a minha participação e a lista de participantes. Notas e pendências
-- de outras pessoas só aparecem a quem gere o calendário e ao responsável da atividade.
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

-- O que falta à pessoa atual nas próximas atividades (resumo «O que te falta»).
create or replace function public.cal_my_pending(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'calendario'); v_me uuid := auth.uid();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'all_day', e.all_day, 'starts_at', e.starts_at,
             'ends_at', e.ends_at, 'start_date', e.start_date, 'end_date', e.end_date, 'registration_deadline', e.registration_deadline,
             'deadline_passed', e.registration_deadline is not null and now() > e.registration_deadline,
             'missing', to_jsonb(private.cal_missing(e, c)))
           order by coalesce(e.starts_at, e.start_date::timestamp at time zone 'Europe/Lisbon'))
      from public.cal_events e
      left join public.cal_participants c on c.event_id = e.id and c.profile_id = v_me
     where e.section_id = p_section and e.space = v_space and e.status = 'ativo'
       and coalesce(e.end_date, (greatest(e.starts_at, e.ends_at - interval '1 microsecond') at time zone 'Europe/Lisbon')::date) >= (now() at time zone 'Europe/Lisbon')::date
       and v_me = any (private.cal_involved(e.id))
       and cardinality(private.cal_missing(e, c)) > 0
  ), '[]'::jsonb);
end
$$;

-- Equipas e membros para o formulário (só quem gere).
create or replace function public.cal_form_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
  return jsonb_build_object(
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                         from public.teams t where t.section_id = p_section and t.archived_at is null), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'function', m.function, 'team_id', m.team_id) order by p.full_name)
                           from public.memberships m join public.profiles p on p.id = m.profile_id
                          where m.section_id = p_section and m.status = 'ativo'), '[]'::jsonb));
end
$$;

-- Contrato para outros módulos (Inventário, Tesouraria, Secretaria): lista leve das
-- atividades do espaço atual, para ligar registos a uma atividade. Por omissão exige acesso
-- ao Calendário; com p_module = módulo que chama, exige acesso a ESSE módulo e usa o espaço
-- dele (teste/real) — quem usa o Inventário pode escolher uma atividade sem ter acesso ao
-- Calendário. Devolve só id, título, datas e estado (sem participantes nem pendências).
create or replace function public.cal_event_options(p_section uuid, p_module text default 'calendario')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text;
begin
  if coalesce(p_module, '') not in ('calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria') then
    raise exception 'Módulo inválido.';
  end if;
  v_space := private.module_require(p_section, p_module);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'all_day', e.all_day,
             'starts_at', e.starts_at, 'ends_at', e.ends_at, 'start_date', e.start_date, 'end_date', e.end_date, 'status', e.status)
           order by coalesce(e.starts_at, e.start_date::timestamp at time zone 'Europe/Lisbon') desc)
      from (select * from public.cal_events where section_id = p_section and space = v_space
             order by coalesce(starts_at, start_date::timestamp at time zone 'Europe/Lisbon') desc limit 500) e
  ), '[]'::jsonb);
end
$$;

-- Para funções de outros módulos: a atividade existe nesta secção e neste espaço?
create or replace function private.cal_event_exists(p_section uuid, p_space text, p_event uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.cal_events where id = p_event and section_id = p_section and space = p_space) $$;

-- ---------------------------------------------------------------------------
-- Gestão de atividades (dirigentes ou «calendario.gerir»)
-- ---------------------------------------------------------------------------
create or replace function public.cal_create_event(p_section uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
        e public.cal_events;
begin
  e := private.cal_from_json(p_section, p_data);
  e.id := gen_random_uuid();
  e.space := v_space; e.status := 'ativo';
  e.created_by := auth.uid(); e.created_at := now(); e.updated_by := auth.uid(); e.updated_at := now();
  insert into public.cal_events select e.*;
  perform private.audit(p_section, 'cal_evento_criado', 'cal_event', e.id::text, jsonb_build_object('space', v_space, 'title', e.title));
  perform private.cal_sync_reminders(e.id);
  perform private.module_notify(p_section, 'calendario', v_space, private.cal_involved(e.id), 'cal_evento_novo',
    left('Nova atividade: ' || e.title, 220), private.cal_when(e) || coalesce(' · ' || e.location, ''), '/calendario/evento/' || e.id);
  return e.id;
end
$$;

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
-- Respostas e pendências
-- ---------------------------------------------------------------------------
-- Resposta do próprio (p_profile vazio) ou, por quem gere, de outra pessoa.
create or replace function public.cal_respond(p_section uuid, p_event uuid, p_response text, p_note text default null, p_profile uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'calendario'); v_me uuid := auth.uid();
        v_target uuid := coalesce(p_profile, auth.uid()); v_manage boolean := private.cal_can_manage(p_section);
        e public.cal_events; v_aud boolean;
begin
  e := private.cal_event_of(p_section, v_space, p_event, true);
  if coalesce(p_response, '') not in ('vou', 'nao_vou', 'por_confirmar') then raise exception 'Resposta inválida.'; end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'A nota é demasiado longa (máximo 500 caracteres).'; end if;
  if v_target <> v_me and not v_manage then
    raise exception 'Só podes alterar a tua própria resposta.' using errcode = '42501';
  end if;
  if e.status <> 'ativo' then raise exception 'Esta atividade foi cancelada e já não aceita respostas.'; end if;
  if not exists (select 1 from public.memberships m where m.profile_id = v_target and m.section_id = p_section and m.status = 'ativo') then
    raise exception 'Só membros ativos da secção podem participar.';
  end if;
  v_aud := private.cal_in_audience(e.id, v_target);
  if not v_aud and not v_manage and not exists (select 1 from public.cal_participants where event_id = e.id and profile_id = v_target and extra) then
    raise exception 'Esta atividade é só para a equipa indicada.' using errcode = '42501';
  end if;
  if e.registration_deadline is not null and now() > e.registration_deadline and not v_manage then
    raise exception 'O prazo de inscrição terminou a %. Fala com um dirigente.',
      to_char(e.registration_deadline at time zone 'Europe/Lisbon', 'DD/MM/YYYY, HH24:MI');
  end if;
  insert into public.cal_participants as c (event_id, profile_id, section_id, space, response, note, extra, responded_at, responded_by)
  values (e.id, v_target, p_section, v_space, p_response,
          case when v_target = v_me then nullif(trim(coalesce(p_note, '')), '') end, not v_aud, now(), v_me)
  on conflict (event_id, profile_id) do update set
    response = excluded.response,
    -- A nota é do próprio: quem gere não a altera.
    note = case when v_target = v_me then excluded.note else c.note end,
    extra = (c.extra or excluded.extra) and not v_aud,
    responded_at = now(), responded_by = v_me, updated_at = now();
  perform private.audit(p_section, 'cal_resposta', 'cal_event', e.id::text,
    jsonb_build_object('profile', v_target, 'resposta', p_response, 'por', v_me));
  perform private.cal_sync_reminders(e.id);
end
$$;

-- Gestores marcam (ou desmarcam) uma pendência resolvida para um participante.
create or replace function public.cal_set_pending(p_section uuid, p_event uuid, p_profile uuid, p_item text, p_done boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
        e public.cal_events; v_at timestamptz; v_by uuid;
begin
  e := private.cal_event_of(p_section, v_space, p_event, true);
  v_at := case when p_done then now() end;
  v_by := case when p_done then auth.uid() end;
  if coalesce(p_item, '') not in ('autorizacao', 'pagamento', 'inscricao', 'material') then raise exception 'Pendência inválida.'; end if;
  if e.status <> 'ativo' then raise exception 'Esta atividade foi cancelada.'; end if;
  if not (p_item = any (private.cal_required(e))) then raise exception 'Esta atividade não exige esta pendência.'; end if;
  if not (p_profile = any (private.cal_involved(e.id))) then raise exception 'Esta pessoa não participa nesta atividade.'; end if;
  insert into public.cal_participants (event_id, profile_id, section_id, space)
  values (e.id, p_profile, p_section, v_space) on conflict do nothing;
  update public.cal_participants set
    autorizacao_at = case when p_item = 'autorizacao' then v_at else autorizacao_at end,
    autorizacao_by = case when p_item = 'autorizacao' then v_by else autorizacao_by end,
    pagamento_at = case when p_item = 'pagamento' then v_at else pagamento_at end,
    pagamento_by = case when p_item = 'pagamento' then v_by else pagamento_by end,
    inscricao_at = case when p_item = 'inscricao' then v_at else inscricao_at end,
    inscricao_by = case when p_item = 'inscricao' then v_by else inscricao_by end,
    material_at = case when p_item = 'material' then v_at else material_at end,
    material_by = case when p_item = 'material' then v_by else material_by end,
    updated_at = now()
  where event_id = e.id and profile_id = p_profile;
  perform private.audit(p_section, 'cal_pendencia', 'cal_event', e.id::text,
    jsonb_build_object('profile', p_profile, 'item', p_item, 'resolvida', coalesce(p_done, false)));
  perform private.cal_sync_reminders(e.id);
end
$$;

-- Anexos das atividades (programa, autorizações em branco…): lê quem tem acesso ao módulo
-- no espaço da atividade; anexa ou retira quem gere.
create or replace function private.calendario_file_access(p_entity text, p_entity_id uuid, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare e public.cal_events;
begin
  if p_entity <> 'cal_event' then return false; end if;
  select * into e from public.cal_events where id = p_entity_id;
  if e.id is null or private.module_space(e.section_id, 'calendario') is distinct from e.space then return false; end if;
  if p_write then return e.status = 'ativo' and private.cal_can_manage(e.section_id); end if;
  return true;
end
$$;

-- Publicar com «passar dados de teste a reais»: além das tabelas cal_*, os lembretes ainda
-- por enviar destas atividades passam também ao espaço real (senão nunca seriam enviados,
-- porque o envio exige o espaço do estado atual). Os já enviados ficam como estavam.
create or replace function private.calendario_publish_move(p_section uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_t text;
begin
  foreach v_t in array private.module_tables('calendario') loop
    execute format('update public.%I set space = ''real'' where section_id = $1 and space = ''teste''', v_t) using p_section;
  end loop;
  update public.module_reminders set space = 'real'
   where section_id = p_section and module = 'calendario' and space = 'teste' and sent_at is null;
end
$$;

revoke all on function private.calendario_publish_move(uuid) from public, anon, authenticated;
revoke all on function private.cal_sync_reminders(uuid), private.cal_from_json(uuid, jsonb),
  private.cal_event_of(uuid, text, uuid, boolean) from public, anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;

-- ===== supabase/migrations/20261021000300_inventario.sql =====
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

-- ===== supabase/migrations/20261021000400_tesouraria.sql =====
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

-- ===== supabase/migrations/20261021000500_equipas.sql =====
-- Pioneiros — Equipas e cargos: identidade das equipas (cor, emblema, lema), cargos
-- configuráveis por secção (guia, subguia e outros, com responsabilidades), nomeações com
-- datas de início e de fim, mudanças de equipa e o respetivo histórico, por ano escutista
-- (setembro a agosto).
--
-- • Reutiliza teams, memberships e profiles (sem segundo registo de pessoas ou equipas).
--   A tabela teams não é alterada: a identidade visual fica em eq_team_identity.
-- • Nada se apaga: terminar uma nomeação define a data de fim; um registo errado é anulado
--   (fica visível como anulado, com motivo).
-- • Espaço de teste: uma mudança de equipa fica só no histórico do módulo (space = 'teste')
--   e NUNCA altera memberships.team_id. Espaço real: atualiza memberships.team_id e regista
--   o histórico na mesma transação.
-- • Um cargo nunca dá permissões (não toca em module_grants, is_admin nem function).
-- • Todas as tabelas têm section_id e space e RLS sem políticas: leitura e escrita só por
--   funções que verificam o acesso no servidor.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.eq_team_identity (
  team_id uuid not null references public.teams (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  motto text check (motto is null or length(motto) <= 200),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (team_id, space)
);
alter table public.eq_team_identity enable row level security;

create table if not exists public.eq_roles (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  name text not null check (length(trim(name)) between 1 and 80),
  kind text not null default 'cargo' check (kind in ('guia', 'subguia', 'cargo')),
  description text check (description is null or length(description) <= 2000),
  single boolean not null default false,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (kind = 'cargo' or single)
);
create index if not exists eq_roles_section on public.eq_roles (section_id, space);
create unique index if not exists eq_roles_name on public.eq_roles (section_id, space, lower(name)) where archived_at is null;
create unique index if not exists eq_roles_kind on public.eq_roles (section_id, space, kind) where archived_at is null and kind <> 'cargo';
alter table public.eq_roles enable row level security;

create table if not exists public.eq_appointments (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  role_id uuid not null references public.eq_roles (id),
  role_kind text not null check (role_kind in ('guia', 'subguia', 'cargo')),
  team_id uuid not null references public.teams (id),
  membership_id uuid not null references public.memberships (id),
  profile_id uuid not null references public.profiles (id),
  starts_on date not null,
  ends_on date,
  end_reason text check (end_reason is null or length(end_reason) <= 500),
  notes text check (notes is null or length(notes) <= 1000),
  remind_days integer check (remind_days is null or remind_days between 1 and 60),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  ended_by uuid,
  ended_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  check (ends_on is null or ends_on >= starts_on),
  check (cancelled_at is null or cancel_reason is not null)
);
create index if not exists eq_appointments_section on public.eq_appointments (section_id, space);
create index if not exists eq_appointments_member on public.eq_appointments (membership_id);
-- Garantia extra: no máximo um guia e um subguia em aberto (sem fim) por equipa.
create unique index if not exists eq_appointments_one_open
  on public.eq_appointments (space, team_id, role_kind)
  where ends_on is null and cancelled_at is null and role_kind in ('guia', 'subguia');
alter table public.eq_appointments enable row level security;

create table if not exists public.eq_team_moves (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  membership_id uuid not null references public.memberships (id),
  profile_id uuid not null references public.profiles (id),
  from_team_id uuid references public.teams (id),
  to_team_id uuid not null references public.teams (id),
  effective_on date not null,
  reason text check (reason is null or length(reason) <= 500),
  -- true só quando memberships.team_id foi realmente alterado (espaço real).
  applied boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (from_team_id is distinct from to_team_id)
);
create index if not exists eq_team_moves_member on public.eq_team_moves (membership_id, effective_on);
create index if not exists eq_team_moves_section on public.eq_team_moves (section_id, space);
alter table public.eq_team_moves enable row level security;

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
create or replace function private.eq_today()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'Europe/Lisbon')::date $$;

-- Ano escutista (setembro a agosto): 2026-10-15 → «2026/27».
create or replace function private.eq_scout_year(p_day date)
returns text language sql immutable set search_path = ''
as $$
  select case when extract(month from p_day) >= 9
    then extract(year from p_day)::int || '/' || lpad(((extract(year from p_day)::int + 1) % 100)::text, 2, '0')
    else (extract(year from p_day)::int - 1) || '/' || lpad((extract(year from p_day)::int % 100)::text, 2, '0') end
$$;

-- Gerir: acesso ao módulo e (permissão «equipas.gerir», dirigente ou administração).
create or replace function private.eq_can_manage(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.module_space(p_section, 'equipas') is not null
     and (private.has_grant(p_section, 'equipas.gerir') or private.is_dirigente(p_section) or private.is_admin(p_section))
$$;

create or replace function private.eq_require_manage(p_section uuid)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v text := private.module_require(p_section, 'equipas');
begin
  if not private.eq_can_manage(p_section) then
    raise exception 'Não tens permissão para gerir equipas e cargos.' using errcode = '42501';
  end if;
  return v;
end
$$;

-- Equipa atual de uma inscrição no espaço indicado. No espaço real é memberships.team_id;
-- no espaço de teste, a última mudança registada em teste (se for mais recente do que a
-- última mudança real), senão a equipa real.
create or replace function private.eq_current_team(p_membership uuid, p_space text)
returns uuid language sql stable security definer set search_path = ''
as $$
  select case when p_space = 'real' then m.team_id else coalesce((
    select t.to_team_id from public.eq_team_moves t
     where t.membership_id = m.id and t.space = 'teste'
       and t.created_at > coalesce((select max(h.changed_at) from public.membership_history h
                                     where h.membership_id = m.id and h.old_team_id is distinct from h.new_team_id), '-infinity')
     order by t.effective_on desc, t.created_at desc limit 1), m.team_id) end
  from public.memberships m where m.id = p_membership
$$;

create or replace function private.eq_team_name(p_team uuid)
returns text language sql stable security definer set search_path = ''
as $$ select name from public.teams where id = p_team $$;

create or replace function private.eq_fmt(p_day date)
returns text language sql immutable set search_path = ''
as $$ select to_char(p_day, 'DD/MM/YYYY') $$;

-- Conflitos de uma nomeação (períodos [início, fim) — o fim é o dia da passagem de testemunho).
create or replace function private.eq_check_overlap(
  p_space text, p_section uuid, p_role uuid, p_team uuid, p_membership uuid, p_start date, p_end date, p_exclude uuid
) returns void language plpgsql stable security definer set search_path = ''
as $$
declare v_role public.eq_roles; v_name text; v_kind text;
begin
  select * into v_role from public.eq_roles where id = p_role;
  -- A mesma pessoa não acumula o mesmo cargo em períodos sobrepostos.
  if exists (select 1 from public.eq_appointments a
              where a.space = p_space and a.section_id = p_section and a.role_id = p_role and a.membership_id = p_membership
                and a.cancelled_at is null and a.id is distinct from p_exclude
                and a.starts_on < coalesce(p_end, 'infinity'::date) and p_start < coalesce(a.ends_on, 'infinity'::date)
                and a.starts_on < coalesce(a.ends_on, 'infinity'::date)) then
    raise exception 'Esta pessoa já tem o cargo «%» nesse período.', v_role.name;
  end if;
  -- Guia, subguia e cargos únicos: só uma pessoa por equipa de cada vez.
  if v_role.single then
    select p.full_name into v_name from public.eq_appointments a join public.profiles p on p.id = a.profile_id
     where a.space = p_space and a.section_id = p_section and a.role_id = p_role and a.team_id = p_team
       and a.cancelled_at is null and a.id is distinct from p_exclude
       and a.starts_on < coalesce(p_end, 'infinity'::date) and p_start < coalesce(a.ends_on, 'infinity'::date)
       and a.starts_on < coalesce(a.ends_on, 'infinity'::date)
     limit 1;
    if found then
      raise exception 'A equipa % já tem % nesse período (%). Termina primeiro essa nomeação.',
        private.eq_team_name(p_team), v_role.name, coalesce(nullif(v_name, ''), 'outra pessoa');
    end if;
  end if;
  -- Ninguém é guia e subguia da mesma equipa ao mesmo tempo.
  if v_role.kind in ('guia', 'subguia') then
    v_kind := case v_role.kind when 'guia' then 'subguia' else 'guia' end;
    if exists (select 1 from public.eq_appointments a
                where a.space = p_space and a.section_id = p_section and a.membership_id = p_membership and a.role_kind = v_kind
                  and a.cancelled_at is null and a.id is distinct from p_exclude
                  and a.starts_on < coalesce(p_end, 'infinity'::date) and p_start < coalesce(a.ends_on, 'infinity'::date)) then
      raise exception 'Ninguém pode ser guia e subguia ao mesmo tempo. Termina primeiro o outro cargo.';
    end if;
  end if;
end
$$;

-- Lembrete à pessoa antes do fim de um cargo com data de fim (reagendado ou cancelado
-- quando a nomeação muda).
create or replace function private.eq_schedule_end_reminder(p_app uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare a public.eq_appointments; v_due timestamptz; v_role text;
begin
  select * into a from public.eq_appointments where id = p_app;
  if a.id is null then return; end if;
  if a.cancelled_at is not null or a.ends_on is null or a.remind_days is null then
    perform private.cancel_reminders('eq_appointment', a.id);
    return;
  end if;
  v_due := ((a.ends_on - a.remind_days) + time '09:00') at time zone 'Europe/Lisbon';
  if v_due <= now() then
    perform private.cancel_reminders('eq_appointment', a.id);
    return;
  end if;
  select name into v_role from public.eq_roles where id = a.role_id;
  perform private.schedule_reminder(a.section_id, 'equipas', a.space, 'eq_appointment', a.id, 'fim_cargo', a.profile_id, v_due,
    'Cargo a terminar', 'O teu cargo de ' || v_role || ' termina a ' || private.eq_fmt(a.ends_on) || '.',
    '/equipas-e-cargos/pessoa/' || a.membership_id);
end
$$;

-- Anexos (emblema da equipa): ler com acesso ao módulo; carregar/retirar só quem gere.
create or replace function private.equipas_file_access(p_entity text, p_entity_id uuid, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare v_section uuid;
begin
  if p_entity <> 'equipa' then return false; end if;
  select section_id into v_section from public.teams where id = p_entity_id;
  if v_section is null or private.module_space(v_section, 'equipas') is null then return false; end if;
  return not p_write or private.eq_can_manage(v_section);
end
$$;

-- ---------------------------------------------------------------------------
-- Consulta
-- ---------------------------------------------------------------------------
create or replace function public.eq_overview(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'equipas');
  v_manage boolean := private.eq_can_manage(p_section);
  v_me public.memberships := private.my_active_membership(p_section);
  v_my_team uuid;
  v_visible uuid[];
begin
  v_my_team := private.eq_current_team(v_me.id, v_space);
  -- Quem gere vê todas as pessoas; os restantes veem a própria equipa, a si próprios e
  -- quem tem ou teve cargos (os cargos são públicos na secção).
  select coalesce(array_agg(m.id), '{}') into v_visible
    from public.memberships m
   where m.section_id = p_section
     and (
       (v_manage and (m.status in ('ativo', 'suspenso')
                      or exists (select 1 from public.eq_appointments a where a.membership_id = m.id and a.space = v_space)
                      or exists (select 1 from public.eq_team_moves t where t.membership_id = m.id and t.space = v_space)))
       or m.id = v_me.id
       or (m.status = 'ativo' and v_my_team is not null and private.eq_current_team(m.id, v_space) = v_my_team)
       or exists (select 1 from public.eq_appointments a where a.membership_id = m.id and a.space = v_space
                   and a.section_id = p_section and a.cancelled_at is null)
     );

  return jsonb_build_object(
    'space', v_space,
    'can_manage', v_manage,
    'today', private.eq_today(),
    'year', private.eq_scout_year(private.eq_today()),
    'me', v_me.id,
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'archived_at', t.archived_at,
        'color', i.color, 'motto', i.motto,
        'emblem', (select jsonb_build_object('path', f.path, 'file_name', f.file_name) from public.module_files f
                    where f.section_id = p_section and f.module = 'equipas' and f.space = v_space and f.entity = 'equipa'
                      and f.entity_id = t.id and f.removed_at is null order by f.created_at desc limit 1)
      ) order by t.archived_at nulls first, t.name)
      from public.teams t
      left join public.eq_team_identity i on i.team_id = t.id and i.space = v_space and i.section_id = p_section
      where t.section_id = p_section), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membership_id', m.id, 'profile_id', m.profile_id, 'full_name', p.full_name, 'totem', p.totem,
        'function', m.function, 'status', m.status, 'team_id', private.eq_current_team(m.id, v_space),
        'since', (m.approved_at at time zone 'Europe/Lisbon')::date
      ) order by p.full_name)
      from public.memberships m join public.profiles p on p.id = m.profile_id
      where m.id = any (v_visible)), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'kind', r.kind, 'description', r.description, 'single', r.single, 'archived_at', r.archived_at
      ) order by r.archived_at nulls first, case r.kind when 'guia' then 0 when 'subguia' then 1 else 2 end, r.name)
      from public.eq_roles r where r.section_id = p_section and r.space = v_space), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'role_id', a.role_id, 'team_id', a.team_id, 'membership_id', a.membership_id,
        'starts_on', a.starts_on, 'ends_on', a.ends_on, 'end_reason', a.end_reason,
        'notes', case when v_manage or a.membership_id = v_me.id then a.notes end,
        'remind_days', a.remind_days,
        'cancelled_at', a.cancelled_at, 'cancel_reason', case when v_manage then a.cancel_reason end,
        'created_at', a.created_at,
        'created_by_name', (select full_name from public.profiles where id = a.created_by),
        'ended_by_name', (select full_name from public.profiles where id = a.ended_by)
      ) order by a.starts_on desc, a.created_at desc)
      from public.eq_appointments a
      where a.section_id = p_section and a.space = v_space
        and (a.cancelled_at is null or v_manage or a.membership_id = v_me.id)), '[]'::jsonb),
    -- Histórico de equipas: mudanças registadas neste módulo (no espaço atual) e mudanças
    -- feitas na gestão de membros (histórico real de inscrições).
    'moves', coalesce((
      select jsonb_agg(x order by x->>'on' desc, x->>'at' desc) from (
        select jsonb_build_object('id', t.id, 'membership_id', t.membership_id, 'on', t.effective_on, 'at', t.created_at,
          'from_team_id', t.from_team_id, 'to_team_id', t.to_team_id, 'reason', t.reason, 'source', 'modulo', 'applied', t.applied,
          'by_name', (select full_name from public.profiles where id = t.created_by)) as x
          from public.eq_team_moves t
         where t.section_id = p_section and t.space = v_space and (v_manage or t.membership_id = v_me.id)
        union all
        select jsonb_build_object('id', h.id::text, 'membership_id', h.membership_id,
          'on', (h.changed_at at time zone 'Europe/Lisbon')::date, 'at', h.changed_at,
          'from_team_id', h.old_team_id, 'to_team_id', h.new_team_id, 'reason', null, 'source', 'gestao', 'applied', true,
          'by_name', null)
          from public.membership_history h
         where h.section_id = p_section and h.old_team_id is distinct from h.new_team_id
           and coalesce(h.reason, '') not like 'Equipas e cargos%'
           and (v_manage or h.membership_id = v_me.id)
      ) s), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Identidade das equipas
-- ---------------------------------------------------------------------------
create or replace function public.eq_save_identity(p_section uuid, p_team uuid, p_color text, p_motto text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.eq_require_manage(p_section);
begin
  if not exists (select 1 from public.teams where id = p_team and section_id = p_section) then
    raise exception 'Equipa não encontrada.';
  end if;
  if nullif(trim(coalesce(p_color, '')), '') is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Escolhe uma cor válida.';
  end if;
  if length(coalesce(p_motto, '')) > 200 then raise exception 'O lema pode ter até 200 caracteres.'; end if;
  insert into public.eq_team_identity (team_id, section_id, space, color, motto, updated_by, updated_at)
  values (p_team, p_section, v_space, nullif(trim(coalesce(p_color, '')), ''), nullif(trim(coalesce(p_motto, '')), ''), auth.uid(), now())
  on conflict (team_id, space) do update
    set color = excluded.color, motto = excluded.motto, updated_by = excluded.updated_by, updated_at = now();
  perform private.audit(p_section, 'eq_identidade', 'team', p_team::text,
    jsonb_build_object('space', v_space, 'color', p_color, 'motto', p_motto));
end
$$;

-- ---------------------------------------------------------------------------
-- Cargos (configuráveis por secção)
-- ---------------------------------------------------------------------------
create or replace function public.eq_save_role(
  p_section uuid, p_role uuid, p_name text, p_kind text, p_description text, p_single boolean
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.eq_require_manage(p_section); v_old public.eq_roles; v_id uuid; v_single boolean;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Indica o nome do cargo.'; end if;
  if length(trim(p_name)) > 80 then raise exception 'O nome do cargo pode ter até 80 caracteres.'; end if;
  if length(coalesce(p_description, '')) > 2000 then raise exception 'As responsabilidades podem ter até 2000 caracteres.'; end if;
  if p_role is null then
    if coalesce(p_kind, 'cargo') not in ('guia', 'subguia', 'cargo') then raise exception 'Tipo de cargo inválido.'; end if;
    v_single := coalesce(p_kind, 'cargo') <> 'cargo' or coalesce(p_single, false);
    insert into public.eq_roles (section_id, space, name, kind, description, single, created_by, updated_by)
    values (p_section, v_space, trim(p_name), coalesce(p_kind, 'cargo'), nullif(trim(coalesce(p_description, '')), ''), v_single, auth.uid(), auth.uid())
    returning id into v_id;
    perform private.audit(p_section, 'eq_cargo_criado', 'eq_role', v_id::text, jsonb_build_object('space', v_space, 'name', p_name, 'kind', p_kind));
    return v_id;
  end if;
  select * into v_old from public.eq_roles where id = p_role and section_id = p_section and space = v_space for update;
  if v_old.id is null then raise exception 'Registo não encontrado.'; end if;
  -- O tipo (guia, subguia, outro) não muda depois de criado: protege o histórico.
  update public.eq_roles
     set name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''),
         single = v_old.kind <> 'cargo' or coalesce(p_single, false),
         updated_by = auth.uid(), updated_at = now()
   where id = p_role;
  perform private.audit(p_section, 'eq_cargo_alterado', 'eq_role', p_role::text,
    jsonb_build_object('space', v_space, 'de', v_old.name, 'para', p_name));
  return p_role;
exception when unique_violation then
  raise exception 'Já existe um cargo com esse nome (ou desse tipo) nesta secção.';
end
$$;

create or replace function public.eq_set_role_archived(p_section uuid, p_role uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.eq_require_manage(p_section);
begin
  if not exists (select 1 from public.eq_roles where id = p_role and section_id = p_section and space = v_space) then
    raise exception 'Registo não encontrado.';
  end if;
  update public.eq_roles set archived_at = case when p_archived then coalesce(archived_at, now()) end,
         updated_by = auth.uid(), updated_at = now()
   where id = p_role;
  perform private.audit(p_section, case when p_archived then 'eq_cargo_arquivado' else 'eq_cargo_reativado' end, 'eq_role', p_role::text,
    jsonb_build_object('space', v_space));
exception when unique_violation then
  raise exception 'Já existe um cargo ativo com esse nome (ou desse tipo).';
end
$$;

-- Cria os cargos habituais que ainda não existam (só por escolha explícita de quem gere).
create or replace function public.eq_seed_roles(p_section uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.eq_require_manage(p_section); v_n int := 0; r record;
begin
  for r in select * from (values
    ('Guia', 'guia', true, 'Anima e representa a equipa; coordena a preparação das atividades e das reuniões de equipa; acompanha cada elemento e leva a voz da equipa ao Conselho de Guias.'),
    ('Subguia', 'subguia', true, 'Apoia o guia em todas as tarefas e substitui-o quando está ausente; ajuda a integrar os novos elementos.'),
    ('Secretário', 'cargo', true, 'Mantém o livro de equipa e os registos das reuniões e atividades; trata da comunicação da equipa.'),
    ('Tesoureiro', 'cargo', true, 'Acompanha as contas da equipa (quotas e despesas de equipa) e presta contas à equipa. Não dá acesso à tesouraria da secção.'),
    ('Intendente', 'cargo', true, 'Cuida do material da equipa: inventário, arrumação, manutenção e devolução.'),
    ('Cozinheiro', 'cargo', false, 'Planeia as ementas, as compras e a cozinha em acampamento, com atenção à higiene e à segurança alimentar.'),
    ('Socorrista', 'cargo', false, 'Cuida da caixa de primeiros socorros da equipa e conhece os cuidados básicos e os contactos de emergência.')
  ) as d(name, kind, single, description)
  loop
    if not exists (select 1 from public.eq_roles x where x.section_id = p_section and x.space = v_space and x.archived_at is null
                    and (lower(x.name) = lower(r.name) or (r.kind <> 'cargo' and x.kind = r.kind))) then
      insert into public.eq_roles (section_id, space, name, kind, description, single, created_by, updated_by)
      values (p_section, v_space, r.name, r.kind, r.description, r.single, auth.uid(), auth.uid());
      v_n := v_n + 1;
    end if;
  end loop;
  perform private.audit(p_section, 'eq_cargos_base', 'eq_role', null, jsonb_build_object('space', v_space, 'criados', v_n));
  return v_n;
end
$$;

-- ---------------------------------------------------------------------------
-- Nomeações
-- ---------------------------------------------------------------------------
create or replace function public.eq_appoint(
  p_section uuid, p_role uuid, p_team uuid, p_membership uuid, p_starts_on date,
  p_ends_on date default null, p_notes text default null, p_remind_days integer default 7
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.eq_require_manage(p_section); v_role public.eq_roles; v_m public.memberships; v_id uuid;
begin
  -- Bloqueia o cargo: nomeações do mesmo cargo ficam em fila (um guia de cada vez).
  select * into v_role from public.eq_roles where id = p_role and section_id = p_section and space = v_space for update;
  if v_role.id is null then raise exception 'Registo não encontrado.'; end if;
  if v_role.archived_at is not null then raise exception 'Este cargo está arquivado. Reativa-o antes de nomear alguém.'; end if;
  if not exists (select 1 from public.teams where id = p_team and section_id = p_section and archived_at is null) then
    raise exception 'Equipa inválida para esta secção.';
  end if;
  select * into v_m from public.memberships where id = p_membership and section_id = p_section;
  if v_m.id is null then raise exception 'Registo não encontrado.'; end if;
  if v_m.status <> 'ativo' then raise exception 'Só membros ativos podem ser nomeados.'; end if;
  if private.eq_current_team(v_m.id, v_space) is distinct from p_team then
    raise exception 'Esta pessoa não pertence a esta equipa. Muda-a primeiro de equipa.';
  end if;
  if p_starts_on is null then raise exception 'Indica a data de início.'; end if;
  if p_starts_on < date '2000-01-01' or p_starts_on > private.eq_today() + 366 then raise exception 'Data de início inválida.'; end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then raise exception 'A data de fim não pode ser anterior à de início.'; end if;
  if length(coalesce(p_notes, '')) > 1000 then raise exception 'As notas podem ter até 1000 caracteres.'; end if;
  if p_remind_days is not null and p_remind_days not between 1 and 60 then raise exception 'O lembrete deve ser entre 1 e 60 dias antes.'; end if;
  perform private.eq_check_overlap(v_space, p_section, p_role, p_team, p_membership, p_starts_on, p_ends_on, null);
  insert into public.eq_appointments (section_id, space, role_id, role_kind, team_id, membership_id, profile_id,
    starts_on, ends_on, notes, remind_days, created_by)
  values (p_section, v_space, p_role, v_role.kind, p_team, p_membership, v_m.profile_id,
    p_starts_on, p_ends_on, nullif(trim(coalesce(p_notes, '')), ''), p_remind_days, auth.uid())
  returning id into v_id;
  perform private.eq_schedule_end_reminder(v_id);
  perform private.module_notify(p_section, 'equipas', v_space, array[v_m.profile_id], 'eq_cargo', 'Novo cargo',
    'Foste nomeado(a) ' || v_role.name || ' da equipa ' || private.eq_team_name(p_team) || ' a partir de ' || private.eq_fmt(p_starts_on) || '.',
    '/equipas-e-cargos/pessoa/' || p_membership);
  perform private.audit(p_section, 'eq_nomeacao', 'eq_appointment', v_id::text,
    jsonb_build_object('space', v_space, 'role', v_role.name, 'team', p_team, 'membership', p_membership, 'starts_on', p_starts_on, 'ends_on', p_ends_on));
  return v_id;
exception when unique_violation then
  raise exception 'A equipa já tem % em funções. Termina primeiro essa nomeação.', v_role.name;
end
$$;

-- Terminar (ou antecipar/alterar o fim de) uma nomeação. Nunca apaga.
create or replace function public.eq_end_appointment(p_section uuid, p_appointment uuid, p_ends_on date, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.eq_require_manage(p_section); a public.eq_appointments; v_role public.eq_roles;
begin
  select * into a from public.eq_appointments where id = p_appointment and section_id = p_section and space = v_space;
  if a.id is null then raise exception 'Registo não encontrado.'; end if;
  select * into v_role from public.eq_roles where id = a.role_id for update;
  select * into a from public.eq_appointments where id = p_appointment for update;
  if a.cancelled_at is not null then raise exception 'Esta nomeação foi anulada.'; end if;
  if a.ends_on is not null and a.ends_on <= private.eq_today() then raise exception 'Esta nomeação já terminou.'; end if;
  if p_ends_on is null then raise exception 'Indica a data de fim.'; end if;
  if p_ends_on < a.starts_on then raise exception 'A data de fim não pode ser anterior à de início (%).', private.eq_fmt(a.starts_on); end if;
  if p_ends_on > private.eq_today() + 3660 then raise exception 'Data de fim inválida.'; end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'O motivo pode ter até 500 caracteres.'; end if;
  perform private.eq_check_overlap(v_space, p_section, a.role_id, a.team_id, a.membership_id, a.starts_on, p_ends_on, a.id);
  update public.eq_appointments
     set ends_on = p_ends_on, end_reason = nullif(trim(coalesce(p_reason, '')), ''), ended_by = auth.uid(), ended_at = now()
   where id = a.id;
  perform private.eq_schedule_end_reminder(a.id);
  perform private.module_notify(p_section, 'equipas', v_space, array[a.profile_id], 'eq_cargo_fim', 'Cargo terminado',
    'O teu cargo de ' || v_role.name || ' na equipa ' || private.eq_team_name(a.team_id) || ' termina a ' || private.eq_fmt(p_ends_on) || '.',
    '/equipas-e-cargos/pessoa/' || a.membership_id);
  perform private.audit(p_section, 'eq_nomeacao_terminada', 'eq_appointment', a.id::text,
    jsonb_build_object('space', v_space, 'ends_on', p_ends_on, 'anterior', a.ends_on, 'reason', p_reason));
end
$$;

-- Anular uma nomeação registada por engano (fica no histórico como anulada).
create or replace function public.eq_cancel_appointment(p_section uuid, p_appointment uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.eq_require_manage(p_section); a public.eq_appointments;
begin
  select * into a from public.eq_appointments where id = p_appointment and section_id = p_section and space = v_space for update;
  if a.id is null then raise exception 'Registo não encontrado.'; end if;
  if a.cancelled_at is not null then raise exception 'Esta nomeação já foi anulada.'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Indica o motivo da anulação.'; end if;
  update public.eq_appointments set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = left(trim(p_reason), 500)
   where id = a.id;
  perform private.cancel_reminders('eq_appointment', a.id);
  perform private.audit(p_section, 'eq_nomeacao_anulada', 'eq_appointment', a.id::text,
    jsonb_build_object('space', v_space, 'reason', p_reason));
end
$$;

-- ---------------------------------------------------------------------------
-- Mudanças de equipa
-- ---------------------------------------------------------------------------
create or replace function public.eq_move_member(
  p_section uuid, p_membership uuid, p_to_team uuid, p_effective_on date, p_reason text, p_end_roles boolean default true
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_space text := private.eq_require_manage(p_section);
  v_m public.memberships; v_from uuid; v_id uuid; a public.eq_appointments; v_ended int := 0;
begin
  -- Bloqueia a inscrição (no espaço de teste só para serializar; não é alterada).
  select * into v_m from public.memberships where id = p_membership and section_id = p_section for update;
  if v_m.id is null then raise exception 'Registo não encontrado.'; end if;
  if v_m.status <> 'ativo' then raise exception 'Só membros ativos mudam de equipa.'; end if;
  if v_m.function is distinct from 'pioneiro' and v_m.function is distinct from 'guia' then
    raise exception 'Só pioneiros e guias pertencem a equipas.';
  end if;
  if p_to_team is null or not exists (select 1 from public.teams where id = p_to_team and section_id = p_section and archived_at is null) then
    raise exception 'Escolhe a nova equipa.';
  end if;
  v_from := private.eq_current_team(v_m.id, v_space);
  if v_from = p_to_team then raise exception 'Esta pessoa já pertence a essa equipa.'; end if;
  if p_effective_on is null then raise exception 'Indica a data da mudança.'; end if;
  if p_effective_on > private.eq_today() then raise exception 'A data da mudança não pode ser futura.'; end if;
  if p_effective_on < private.eq_today() - 366 then raise exception 'A data da mudança é demasiado antiga.'; end if;
  if exists (select 1 from public.eq_team_moves t where t.membership_id = v_m.id and t.space = v_space and t.effective_on > p_effective_on) then
    raise exception 'Já há uma mudança de equipa registada depois dessa data.';
  end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'O motivo pode ter até 500 caracteres.'; end if;

  insert into public.eq_team_moves (section_id, space, membership_id, profile_id, from_team_id, to_team_id, effective_on, reason, applied, created_by)
  values (p_section, v_space, v_m.id, v_m.profile_id, v_from, p_to_team, p_effective_on, nullif(trim(coalesce(p_reason, '')), ''),
          v_space = 'real', auth.uid())
  returning id into v_id;

  -- Só no espaço real a equipa da inscrição muda (o histórico de inscrições regista-o também).
  if v_space = 'real' then
    perform set_config('pioneiros.reason', left('Equipas e cargos: ' || coalesce(nullif(trim(p_reason), ''), 'mudança de equipa'), 500), true);
    update public.memberships set team_id = p_to_team where id = v_m.id;
  end if;

  -- Os cargos na equipa anterior terminam na data da mudança.
  if coalesce(p_end_roles, true) and v_from is not null then
    for a in select * from public.eq_appointments x
              where x.membership_id = v_m.id and x.space = v_space and x.team_id = v_from and x.cancelled_at is null
                and (x.ends_on is null or x.ends_on > p_effective_on)
              for update
    loop
      update public.eq_appointments
         set ends_on = greatest(a.starts_on, p_effective_on), end_reason = 'Mudança de equipa', ended_by = auth.uid(), ended_at = now()
       where id = a.id;
      perform private.eq_schedule_end_reminder(a.id);
      v_ended := v_ended + 1;
    end loop;
  end if;

  perform private.module_notify(p_section, 'equipas', v_space, array[v_m.profile_id], 'eq_equipa', 'Mudança de equipa',
    'Passaste para a equipa ' || private.eq_team_name(p_to_team) || ' a partir de ' || private.eq_fmt(p_effective_on) || '.'
      || case when v_ended > 0 then ' Os cargos na equipa anterior terminaram.' else '' end,
    '/equipas-e-cargos/pessoa/' || v_m.id);
  perform private.audit(p_section, 'eq_mudanca_equipa', 'membership', v_m.id::text,
    jsonb_build_object('space', v_space, 'de', v_from, 'para', p_to_team, 'em', p_effective_on, 'cargos_terminados', v_ended));
  return v_id;
end
$$;

-- Ao publicar, as simulações do espaço de teste não passam a reais: as equipas e os
-- membros já são os reais, e nomeações ou mudanças de teste podiam contradizer o
-- que entretanto aconteceu. Ficam guardadas no espaço de teste.
create or replace function private.equipas_publish_move(p_section uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'Em Equipas e cargos os dados de teste não passam a reais. Publica sem essa opção e regista as nomeações no espaço real.';
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;

-- ===== supabase/migrations/20261021000600_secretaria.sql =====
-- Pioneiros — Secretaria: reuniões, ordem de trabalhos, atas (com versões e
-- aditamentos), decisões e tarefas, anexos e lembretes.
--
-- Visibilidade (verificada no servidor, por reunião):
--   • «Dirigentes autorizados» = dirigentes ativos da secção (private.is_dirigente) ou
--     quem tem 'secretaria.redigir' ou 'secretaria.aprovar' na secção.
--   • Reunião de Equipa ........ membros ativos dessa equipa + dirigentes autorizados.
--   • Conselho de Guias ........ participantes + dirigentes autorizados.
--   • Equipa de Animação ....... só dirigentes autorizados.
--   • Documento geral .......... só quem o criou e as pessoas/equipas com quem foi
--                                partilhado explicitamente (nem dirigentes sem partilha).
--   Em todos os casos é preciso ter acesso ao módulo nesse espaço (teste/real).
--
-- Quem pode o quê:
--   • Consultar: quem vê a reunião (ser tester só dá acesso ao módulo).
--   • Redigir (criar/alterar reuniões, atas, decisões e tarefas; submeter para aprovação):
--     'secretaria.redigir', só nas reuniões que pode ver.
--   • Aprovar ou devolver a rascunho: 'secretaria.aprovar' ou dirigente, só nas reuniões
--     que pode ver. Quem redigiu não precisa de ser quem aprova.
--   • Estado de execução de uma tarefa: quem redige, quem aprova, ou o próprio responsável.
--
-- Atas: Rascunho → Em aprovação → Aprovada (Em aprovação pode voltar a Rascunho).
-- Cada submissão congela a versão (texto + fotografia da reunião, participantes e
-- decisões). Uma versão congelada nunca muda (gatilho). Depois de aprovada, uma correção
-- cria uma nova versão (a aprovada continua consultável) ou um aditamento separado, com
-- o seu próprio fluxo de aprovação.
--
-- Decisões podem referir um pedido (trail_requests) ou uma etapa (stage_paths) apenas
-- como referência: nada é validado nem alterado nessas tabelas.
-- Notificações sem conteúdo das atas (texto genérico). Aditivo: não altera dados existentes.

create table if not exists public.sec_meetings (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  kind text not null check (kind in ('equipa', 'conselho_guias', 'animacao', 'geral')),
  team_id uuid references public.teams (id),
  title text not null check (length(trim(title)) between 1 and 200),
  starts_at timestamptz not null,
  location text check (location is null or length(location) <= 300),
  agenda text not null default '' check (length(agenda) <= 10000),
  cal_event_id uuid references public.cal_events (id) on delete set null,
  status text not null default 'ativa' check (status in ('ativa', 'anulada')),
  cancel_reason text,
  cancelled_by uuid,
  cancelled_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check ((kind = 'equipa') = (team_id is not null))
);
create index if not exists sec_meetings_section on public.sec_meetings (section_id, space, starts_at desc);
alter table public.sec_meetings enable row level security;

create table if not exists public.sec_participants (
  meeting_id uuid not null references public.sec_meetings (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (meeting_id, profile_id)
);
alter table public.sec_participants enable row level security;

-- Partilhas explícitas (documentos gerais): pessoas ou equipas.
create table if not exists public.sec_shares (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.sec_meetings (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  profile_id uuid references public.profiles (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  added_by uuid,
  added_at timestamptz not null default now(),
  check ((profile_id is null) <> (team_id is null))
);
create unique index if not exists sec_shares_profile on public.sec_shares (meeting_id, profile_id) where profile_id is not null;
create unique index if not exists sec_shares_team on public.sec_shares (meeting_id, team_id) where team_id is not null;
alter table public.sec_shares enable row level security;

-- Documentos: a ata da reunião (uma por reunião) e aditamentos a uma ata aprovada.
create table if not exists public.sec_minutes (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  meeting_id uuid not null references public.sec_meetings (id) on delete cascade,
  kind text not null check (kind in ('ata', 'aditamento')),
  parent_id uuid references public.sec_minutes (id),
  status text not null default 'rascunho' check (status in ('rascunho', 'em_aprovacao', 'aprovada')),
  current_version integer not null default 1,
  approved_version integer,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check ((kind = 'aditamento') = (parent_id is not null)),
  check (status <> 'aprovada' or approved_version = current_version)
);
create unique index if not exists sec_minutes_one_ata on public.sec_minutes (meeting_id) where kind = 'ata';
create index if not exists sec_minutes_section on public.sec_minutes (section_id, space);
alter table public.sec_minutes enable row level security;

create table if not exists public.sec_minute_versions (
  id uuid primary key default gen_random_uuid(),
  minute_id uuid not null references public.sec_minutes (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  version_no integer not null check (version_no >= 1),
  body text not null default '' check (length(body) <= 50000),
  note text check (note is null or length(note) <= 1000),
  snapshot jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  frozen_at timestamptz,
  submitted_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  unique (minute_id, version_no),
  check (frozen_at is not null or (snapshot is null and approved_at is null))
);
alter table public.sec_minute_versions enable row level security;

-- Uma versão congelada (submetida) nunca muda; a aprovação só é registada uma vez.
-- (A mudança de espaço ao publicar o módulo é a única exceção.)
create or replace function private.sec_versions_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.frozen_at is not null then
    if (to_jsonb(new) - 'space' - 'approved_at' - 'approved_by') is distinct from (to_jsonb(old) - 'space' - 'approved_at' - 'approved_by')
       or (old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by)) then
      raise exception 'Esta versão da ata está fechada e não pode ser alterada.';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists sec_versions_guard on public.sec_minute_versions;
create trigger sec_versions_guard before update on public.sec_minute_versions
  for each row execute function private.sec_versions_guard();

create table if not exists public.sec_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  meeting_id uuid not null references public.sec_meetings (id) on delete cascade,
  minute_id uuid not null references public.sec_minutes (id) on delete cascade,
  kind text not null check (kind in ('decisao', 'tarefa')),
  text text not null check (length(trim(text)) between 1 and 2000),
  responsible_id uuid references public.profiles (id),
  due_date date,
  reminder_days integer not null default 2 check (reminder_days between 0 and 60),
  exec_status text not null default 'por_fazer' check (exec_status in ('por_fazer', 'em_curso', 'feita', 'cancelada')),
  status_note text check (status_note is null or length(status_note) <= 1000),
  status_changed_by uuid,
  status_changed_at timestamptz,
  -- Só referência: nada é validado nem alterado no pedido ou na etapa.
  trail_request_id uuid references public.trail_requests (id) on delete set null,
  stage_path_id uuid references public.stage_paths (id) on delete set null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (kind <> 'tarefa' or (responsible_id is not null and due_date is not null))
);
create index if not exists sec_items_meeting on public.sec_items (meeting_id);
create index if not exists sec_items_responsible on public.sec_items (section_id, space, responsible_id);
alter table public.sec_items enable row level security;

-- ---------------------------------------------------------------------------
-- Regras de acesso
-- ---------------------------------------------------------------------------
create or replace function private.sec_authorized_as(p_section uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.memberships m where m.section_id = p_section and m.profile_id = p_profile
                  and m.status = 'ativo' and m.function = 'dirigente')
      or (exists (select 1 from public.memberships m where m.section_id = p_section and m.profile_id = p_profile and m.status = 'ativo')
          and exists (select 1 from public.module_grants g where g.section_id = p_section and g.profile_id = p_profile
                       and g.permission in ('secretaria.redigir', 'secretaria.aprovar')))
$$;

-- Pode esta pessoa ver a reunião (ignora o acesso ao módulo, verificado à parte)?
create or replace function private.sec_can_see_as(p_meeting uuid, p_profile uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare m public.sec_meetings; v_team uuid;
begin
  select * into m from public.sec_meetings where id = p_meeting;
  if m.id is null or p_profile is null then return false; end if;
  select team_id into v_team from public.memberships
   where section_id = m.section_id and profile_id = p_profile and status = 'ativo';
  if not found then return false; end if;
  if m.kind = 'geral' then
    return m.created_by = p_profile
        or exists (select 1 from public.sec_shares s where s.meeting_id = m.id
                    and (s.profile_id = p_profile or (s.team_id is not null and s.team_id = v_team)));
  end if;
  if private.sec_authorized_as(m.section_id, p_profile) then return true; end if;
  return case m.kind
    when 'equipa' then v_team is not distinct from m.team_id and v_team is not null
    when 'conselho_guias' then exists (select 1 from public.sec_participants p where p.meeting_id = m.id and p.profile_id = p_profile)
    else false end;
end
$$;

create or replace function private.sec_can_see(p_meeting uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.sec_meetings m where m.id = p_meeting
                  and private.module_space(m.section_id, 'secretaria') = m.space)
     and private.sec_can_see_as(p_meeting, auth.uid())
$$;

create or replace function private.sec_can_draft(p_meeting uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.sec_can_see(p_meeting)
     and private.has_grant((select section_id from public.sec_meetings where id = p_meeting), 'secretaria.redigir')
$$;

create or replace function private.sec_can_approve_as(p_meeting uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.sec_can_see_as(p_meeting, p_profile)
     and (exists (select 1 from public.module_grants g join public.sec_meetings m on m.section_id = g.section_id
                   where m.id = p_meeting and g.profile_id = p_profile and g.permission = 'secretaria.aprovar')
          or exists (select 1 from public.memberships ms join public.sec_meetings m on m.section_id = ms.section_id
                      where m.id = p_meeting and ms.profile_id = p_profile and ms.status = 'ativo' and ms.function = 'dirigente'))
$$;

create or replace function private.sec_can_approve(p_meeting uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.sec_can_see(p_meeting) and private.sec_can_approve_as(p_meeting, auth.uid())
$$;

-- Reunião desta secção/espaço visível à pessoa atual (senão «Registo não encontrado.»).
create or replace function private.sec_meeting_get(p_section uuid, p_space text, p_meeting uuid, p_lock boolean default false)
returns public.sec_meetings language plpgsql security definer set search_path = ''
as $$
declare m public.sec_meetings;
begin
  if p_lock then
    select * into m from public.sec_meetings where id = p_meeting and section_id = p_section and space = p_space for update;
  else
    select * into m from public.sec_meetings where id = p_meeting and section_id = p_section and space = p_space;
  end if;
  if m.id is null or not private.sec_can_see(m.id) then raise exception 'Registo não encontrado.'; end if;
  return m;
end
$$;

create or replace function private.sec_minute_get(p_section uuid, p_space text, p_minute uuid, p_lock boolean default false)
returns public.sec_minutes language plpgsql security definer set search_path = ''
as $$
declare d public.sec_minutes;
begin
  if p_lock then
    select * into d from public.sec_minutes where id = p_minute and section_id = p_section and space = p_space for update;
  else
    select * into d from public.sec_minutes where id = p_minute and section_id = p_section and space = p_space;
  end if;
  if d.id is null or not private.sec_can_see(d.meeting_id) then raise exception 'Registo não encontrado.'; end if;
  return d;
end
$$;

create or replace function private.sec_require_draft(p_meeting uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.sec_can_draft(p_meeting) then
    raise exception 'Não tens permissão para redigir nesta reunião.' using errcode = '42501';
  end if;
end
$$;

-- Anexos: lê quem vê a reunião; anexa/retira quem redige (num documento, só em rascunho).
create or replace function private.secretaria_file_access(p_entity text, p_entity_id uuid, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare v_meeting uuid; v_status text;
begin
  if p_entity = 'sec_meeting' then
    v_meeting := p_entity_id;
  elsif p_entity = 'sec_minute' then
    select meeting_id, status into v_meeting, v_status from public.sec_minutes where id = p_entity_id;
  else
    return false;
  end if;
  if v_meeting is null then return false; end if;
  if not p_write then return private.sec_can_see(v_meeting); end if;
  if p_entity = 'sec_minute' and v_status = 'aprovada' then return false; end if;
  return private.sec_can_draft(v_meeting)
     and exists (select 1 from public.sec_meetings where id = v_meeting and status = 'ativa');
end
$$;

-- ---------------------------------------------------------------------------
-- Leitura auxiliar
-- ---------------------------------------------------------------------------
create or replace function private.sec_name(p_profile uuid)
returns text language sql stable security definer set search_path = ''
as $$ select coalesce(nullif(trim(full_name), ''), 'Sem nome') from public.profiles where id = p_profile $$;

create or replace function private.sec_link_label(p_request uuid, p_stage uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select 'Pedido: ' || private.sec_name(ms.profile_id) || ' · ' || coalesce(t.name, r.trail_key)
       from public.trail_requests r join public.memberships ms on ms.id = r.membership_id
       left join public.catalog_trails t on t.id = r.trail_id where r.id = p_request),
    (select 'Etapa: ' || private.sec_name(ms.profile_id) || ' · ' || coalesce(st.name, sp.stage_key)
       from public.stage_paths sp join public.memberships ms on ms.id = sp.membership_id
       left join public.catalog_stages st on st.id = sp.stage_id where sp.id = p_stage))
$$;

create or replace function private.sec_item_json(i public.sec_items)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'minute_id', i.minute_id, 'kind', i.kind, 'text', i.text,
    'responsible_id', i.responsible_id, 'responsible_name', private.sec_name(i.responsible_id),
    'due_date', i.due_date, 'reminder_days', i.reminder_days, 'exec_status', i.exec_status, 'status_note', i.status_note,
    'trail_request_id', i.trail_request_id, 'stage_path_id', i.stage_path_id,
    'link_label', private.sec_link_label(i.trail_request_id, i.stage_path_id))
$$;

-- Conteúdo de um documento (ao vivo; congelado como «snapshot» quando é submetido).
create or replace function private.sec_content(p_minute uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'title', m.title, 'kind', m.kind, 'team_name', t.name, 'starts_at', m.starts_at, 'location', m.location, 'agenda', m.agenda,
    'participants', coalesce((select jsonb_agg(private.sec_name(p.profile_id) order by private.sec_name(p.profile_id))
                               from public.sec_participants p where p.meeting_id = m.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'text', i.text,
                                         'responsible_name', private.sec_name(i.responsible_id), 'due_date', i.due_date,
                                         'link_label', private.sec_link_label(i.trail_request_id, i.stage_path_id))
                                       order by i.created_at)
                         from public.sec_items i where i.minute_id = d.id), '[]'::jsonb))
  from public.sec_minutes d join public.sec_meetings m on m.id = d.meeting_id
  left join public.teams t on t.id = m.team_id
  where d.id = p_minute
$$;

-- Destinatários de «há uma ata para aprovar»: quem pode aprovar e vê a reunião.
create or replace function private.sec_approvers(p_meeting uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(ms.profile_id), '{}') from public.memberships ms
    join public.sec_meetings m on m.section_id = ms.section_id
   where m.id = p_meeting and ms.status = 'ativo' and private.sec_can_approve_as(p_meeting, ms.profile_id)
$$;

-- Lembrete antes do prazo de uma tarefa (único por tarefa e responsável).
create or replace function private.sec_schedule_item(i public.sec_items)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_due timestamptz;
begin
  perform private.cancel_reminders('sec_item', i.id);
  if i.kind <> 'tarefa' or i.responsible_id is null or i.due_date is null or i.exec_status in ('feita', 'cancelada')
     or exists (select 1 from public.sec_meetings where id = i.meeting_id and status = 'anulada') then
    return;
  end if;
  v_due := ((i.due_date - i.reminder_days)::timestamp + time '09:00') at time zone 'Europe/Lisbon';
  if i.due_date < (now() at time zone 'Europe/Lisbon')::date then return; end if;
  perform private.schedule_reminder(i.section_id, 'secretaria', i.space, 'sec_item', i.id, 'prazo', i.responsible_id,
    v_due, 'Prazo de tarefa', 'Uma tarefa tua aproxima-se do prazo.', '/secretaria/tarefas');
end
$$;

-- ---------------------------------------------------------------------------
-- Consultas
-- ---------------------------------------------------------------------------
create or replace function public.sec_people(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria');
begin
  return jsonb_build_object(
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', ms.profile_id, 'name', private.sec_name(ms.profile_id),
                                   'team_id', ms.team_id, 'function', ms.function) order by private.sec_name(ms.profile_id))
                         from public.memberships ms where ms.section_id = p_section and ms.status = 'ativo'), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                        from public.teams t where t.section_id = p_section and t.archived_at is null), '[]'::jsonb));
end
$$;

create or replace function public.sec_meetings(p_section uuid, p_search text default null, p_kind text default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); v_q text := nullif(trim(coalesce(p_search, '')), '');
begin
  return jsonb_build_object(
    'can_draft', private.has_grant(p_section, 'secretaria.redigir'),
    'can_approve', private.has_grant(p_section, 'secretaria.aprovar') or private.is_dirigente(p_section),
    'meetings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'team_name', t.name, 'title', m.title, 'starts_at', m.starts_at, 'location', m.location,
        'status', m.status,
        'ata', (select jsonb_build_object('id', d.id, 'status', d.status, 'approved_version', d.approved_version, 'current_version', d.current_version)
                  from public.sec_minutes d where d.meeting_id = m.id and d.kind = 'ata'),
        'open_tasks', (select count(*) from public.sec_items i where i.meeting_id = m.id and i.kind = 'tarefa'
                         and i.exec_status in ('por_fazer', 'em_curso'))
      ) order by m.starts_at desc)
      from public.sec_meetings m left join public.teams t on t.id = m.team_id
      where m.section_id = p_section and m.space = v_space
        and (p_kind is null or m.kind = p_kind)
        and (v_q is null or m.title ilike '%' || v_q || '%' or m.agenda ilike '%' || v_q || '%')
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
      'cal_event', (select jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', coalesce(e.starts_at, e.start_date::timestamptz), 'status', e.status)
                      from public.cal_events e where e.id = m.cal_event_id and e.section_id = p_section and e.space = v_space)),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('id', p.profile_id, 'name', private.sec_name(p.profile_id)) order by private.sec_name(p.profile_id))
                               from public.sec_participants p where p.meeting_id = m.id), '[]'::jsonb),
    'shares', coalesce((select jsonb_agg(jsonb_build_object('profile_id', s.profile_id, 'team_id', s.team_id,
                                  'name', coalesce(private.sec_name(s.profile_id), (select name from public.teams where id = s.team_id))))
                         from public.sec_shares s where s.meeting_id = m.id), '[]'::jsonb),
    'minutes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'status', d.status,
                                   'current_version', d.current_version, 'approved_version', d.approved_version, 'created_at', d.created_at)
                                 order by d.kind = 'aditamento', d.created_at)
                          from public.sec_minutes d where d.meeting_id = m.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(private.sec_item_json(i) order by i.created_at) from public.sec_items i where i.meeting_id = m.id), '[]'::jsonb),
    'can_draft', private.sec_can_draft(m.id),
    'can_approve', private.sec_can_approve(m.id));
end
$$;

-- Documento (ata ou aditamento) com histórico de versões; p_version escolhe a versão a ver.
create or replace function public.sec_minute(p_section uuid, p_minute uuid, p_version integer default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes; v public.sec_minute_versions;
        m public.sec_meetings; v_draft boolean; v_appr boolean;
begin
  d := private.sec_minute_get(p_section, v_space, p_minute);
  select * into m from public.sec_meetings where id = d.meeting_id;
  select * into v from public.sec_minute_versions where minute_id = d.id and version_no = coalesce(p_version, d.current_version);
  if v.id is null then raise exception 'Registo não encontrado.'; end if;
  v_draft := private.sec_can_draft(m.id) and m.status = 'ativa';
  v_appr := private.sec_can_approve(m.id) and m.status = 'ativa';
  return jsonb_build_object(
    'minute', to_jsonb(d) || jsonb_build_object('created_by_name', private.sec_name(d.created_by)),
    'meeting', jsonb_build_object('id', m.id, 'title', m.title, 'kind', m.kind, 'status', m.status, 'starts_at', m.starts_at),
    'test', v_space = 'teste',
    'version', jsonb_build_object('version_no', v.version_no, 'body', v.body, 'note', v.note, 'frozen', v.frozen_at is not null,
                 'frozen_at', v.frozen_at, 'submitted_by_name', private.sec_name(v.submitted_by),
                 'approved_at', v.approved_at, 'approved_by_name', private.sec_name(v.approved_by),
                 'created_by_name', private.sec_name(v.created_by), 'updated_at', v.updated_at,
                 'content', coalesce(v.snapshot, private.sec_content(d.id))),
    'versions', (select jsonb_agg(jsonb_build_object('version_no', x.version_no, 'note', x.note, 'created_at', x.created_at,
                    'created_by_name', private.sec_name(x.created_by), 'frozen_at', x.frozen_at,
                    'approved_at', x.approved_at, 'approved_by_name', private.sec_name(x.approved_by)) order by x.version_no desc)
                  from public.sec_minute_versions x where x.minute_id = d.id),
    'parent', (select jsonb_build_object('id', p.id, 'approved_version', p.approved_version) from public.sec_minutes p where p.id = d.parent_id),
    'addenda', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'status', a.status, 'created_at', a.created_at,
                                 'approved_version', a.approved_version) order by a.created_at)
                          from public.sec_minutes a where a.parent_id = d.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(private.sec_item_json(i) order by i.created_at) from public.sec_items i where i.minute_id = d.id), '[]'::jsonb),
    'can_edit', v_draft and d.status = 'rascunho',
    'can_submit', v_draft and d.status = 'rascunho',
    'can_approve', v_appr and d.status = 'em_aprovacao',
    'can_return', (v_appr or v_draft) and d.status = 'em_aprovacao',
    'can_revise', v_draft and d.status = 'aprovada' and d.kind = 'ata',
    'can_addendum', v_draft and d.kind = 'ata' and d.approved_version is not null,
    'can_track', v_draft or v_appr);
end
$$;

create or replace function public.sec_my_tasks(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria');
begin
  return coalesce((
    select jsonb_agg(private.sec_item_json(i) || jsonb_build_object(
             'meeting_id', case when private.sec_can_see_as(i.meeting_id, auth.uid()) then i.meeting_id end,
             'meeting_title', case when private.sec_can_see_as(i.meeting_id, auth.uid()) then m.title end)
           order by i.exec_status in ('feita', 'cancelada'), i.due_date nulls last)
      from public.sec_items i join public.sec_meetings m on m.id = i.meeting_id
     where i.section_id = p_section and i.space = v_space and i.responsible_id = auth.uid()
       and m.status = 'ativa'), '[]'::jsonb);
end
$$;

-- Atividades do calendário (mesma secção e espaço) para ligar a uma reunião.
create or replace function public.sec_event_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'secretaria', 'secretaria.redigir', false);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title,
                     'starts_at', coalesce(e.starts_at, (e.start_date::timestamp + time '12:00') at time zone 'Europe/Lisbon'),
                     'all_day', e.all_day) order by coalesce(e.starts_at, e.start_date::timestamptz) desc)
                     from public.cal_events e
                    where e.section_id = p_section and e.space = v_space and e.status = 'ativo'
                      and coalesce(e.starts_at, e.start_date::timestamptz) > now() - interval '400 days'), '[]'::jsonb);
end
$$;

-- Pedidos e etapas da secção que podem ser referidos numa decisão (só para quem redige).
create or replace function public.sec_link_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'secretaria', 'secretaria.redigir', false);
begin
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'label', private.sec_link_label(r.id, null), 'status', r.status)
                                   order by r.updated_at desc)
                           from public.trail_requests r join public.memberships ms on ms.id = r.membership_id
                          where r.section_id = p_section and ms.status = 'ativo' and r.status not in ('cancelado')), '[]'::jsonb),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('id', sp.id, 'label', private.sec_link_label(null, sp.id), 'status', sp.status)
                                 order by sp.opened_at desc)
                         from public.stage_paths sp join public.memberships ms on ms.id = sp.membership_id
                        where ms.section_id = p_section and ms.status = 'ativo'), '[]'::jsonb));
end
$$;

-- ---------------------------------------------------------------------------
-- Reuniões
-- ---------------------------------------------------------------------------
create or replace function public.sec_meeting_save(
  p_section uuid, p_meeting uuid, p_kind text, p_team uuid, p_title text, p_starts_at timestamptz,
  p_location text, p_agenda text, p_cal_event uuid,
  p_participants uuid[] default '{}', p_share_profiles uuid[] default '{}', p_share_teams uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'secretaria', 'secretaria.redigir', false);
        m public.sec_meetings; v_id uuid; v_bad int; v_before jsonb;
begin
  if p_kind not in ('equipa', 'conselho_guias', 'animacao', 'geral') then raise exception 'Escolhe o tipo de reunião.'; end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'Indica o título.'; end if;
  if length(trim(p_title)) > 200 then raise exception 'O título é demasiado longo (máximo 200 caracteres).'; end if;
  if p_starts_at is null then raise exception 'Indica a data e a hora.'; end if;
  if length(coalesce(p_agenda, '')) > 10000 then raise exception 'A ordem de trabalhos é demasiado longa.'; end if;
  if length(coalesce(p_location, '')) > 300 then raise exception 'O local é demasiado longo.'; end if;
  if p_kind = 'equipa' then
    if p_team is null then raise exception 'Escolhe a equipa.'; end if;
    if not exists (select 1 from public.teams where id = p_team and section_id = p_section and archived_at is null) then
      raise exception 'Equipa não encontrada.';
    end if;
  end if;
  if p_cal_event is not null and not exists (select 1 from public.cal_events where id = p_cal_event and section_id = p_section and space = v_space) then
    raise exception 'Atividade do calendário não encontrada.';
  end if;
  select count(*) into v_bad from unnest(coalesce(p_participants, '{}') || coalesce(p_share_profiles, '{}')) x
   where not exists (select 1 from public.memberships ms where ms.profile_id = x and ms.section_id = p_section and ms.status = 'ativo');
  if v_bad > 0 then raise exception 'Só podes escolher membros ativos da secção.'; end if;
  if exists (select 1 from unnest(coalesce(p_share_teams, '{}')) x where not exists (select 1 from public.teams t where t.id = x and t.section_id = p_section)) then
    raise exception 'Equipa não encontrada.';
  end if;

  if p_meeting is null then
    insert into public.sec_meetings (section_id, space, kind, team_id, title, starts_at, location, agenda, cal_event_id, created_by, updated_by)
    values (p_section, v_space, p_kind, case when p_kind = 'equipa' then p_team end, trim(p_title), p_starts_at,
            nullif(trim(coalesce(p_location, '')), ''), coalesce(p_agenda, ''), p_cal_event, auth.uid(), auth.uid())
    returning id into v_id;
  else
    m := private.sec_meeting_get(p_section, v_space, p_meeting, true);
    perform private.sec_require_draft(m.id);
    if m.status = 'anulada' then raise exception 'Esta reunião foi anulada.'; end if;
    if m.kind <> p_kind and exists (select 1 from public.sec_minutes where meeting_id = m.id) then
      raise exception 'O tipo de reunião não pode mudar depois de criada a ata.';
    end if;
    v_before := jsonb_build_object('kind', m.kind, 'team', m.team_id, 'title', m.title, 'starts_at', m.starts_at,
      'participants', (select jsonb_agg(profile_id) from public.sec_participants where meeting_id = m.id));
    update public.sec_meetings set kind = p_kind, team_id = case when p_kind = 'equipa' then p_team end, title = trim(p_title),
           starts_at = p_starts_at, location = nullif(trim(coalesce(p_location, '')), ''), agenda = coalesce(p_agenda, ''),
           cal_event_id = p_cal_event, updated_by = auth.uid(), updated_at = now()
     where id = m.id;
    v_id := m.id;
  end if;

  delete from public.sec_participants where meeting_id = v_id and profile_id <> all (coalesce(p_participants, '{}'));
  insert into public.sec_participants (meeting_id, section_id, space, profile_id, added_by)
  select distinct v_id, p_section, v_space, x, auth.uid() from unnest(coalesce(p_participants, '{}')) x
  on conflict do nothing;
  delete from public.sec_shares where meeting_id = v_id;
  if p_kind = 'geral' then
    insert into public.sec_shares (meeting_id, section_id, space, profile_id, added_by)
    select distinct v_id, p_section, v_space, x, auth.uid() from unnest(coalesce(p_share_profiles, '{}')) x;
    insert into public.sec_shares (meeting_id, section_id, space, team_id, added_by)
    select distinct v_id, p_section, v_space, x, auth.uid() from unnest(coalesce(p_share_teams, '{}')) x;
  end if;
  -- Quem cria/altera tem de continuar a ver a reunião (evita documentos órfãos).
  if not private.sec_can_see(v_id) then
    raise exception 'Com estas escolhas deixarias de ver esta reunião. Revê o tipo, a equipa ou os participantes.';
  end if;
  perform private.audit(p_section, case when p_meeting is null then 'sec_reuniao_criada' else 'sec_reuniao_alterada' end,
    'sec_meeting', v_id::text, jsonb_build_object('space', v_space, 'antes', v_before));
  return v_id;
end
$$;

create or replace function public.sec_meeting_cancel(p_section uuid, p_meeting uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); m public.sec_meetings; v_i uuid;
begin
  m := private.sec_meeting_get(p_section, v_space, p_meeting, true);
  perform private.sec_require_draft(m.id);
  if m.status = 'anulada' then raise exception 'Esta reunião já foi anulada.'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Indica o motivo.'; end if;
  if exists (select 1 from public.sec_minutes where meeting_id = m.id and approved_version is not null) then
    raise exception 'Uma reunião com ata aprovada não pode ser anulada.';
  end if;
  update public.sec_meetings set status = 'anulada', cancel_reason = trim(p_reason), cancelled_by = auth.uid(), cancelled_at = now(),
         updated_by = auth.uid(), updated_at = now() where id = m.id;
  for v_i in select id from public.sec_items where meeting_id = m.id loop
    perform private.cancel_reminders('sec_item', v_i);
  end loop;
  perform private.audit(p_section, 'sec_reuniao_anulada', 'sec_meeting', m.id::text, jsonb_build_object('motivo', trim(p_reason)));
end
$$;

-- ---------------------------------------------------------------------------
-- Atas e aditamentos
-- ---------------------------------------------------------------------------
create or replace function public.sec_minute_create(p_section uuid, p_meeting uuid, p_kind text, p_body text default '')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); m public.sec_meetings; v_parent public.sec_minutes; v_id uuid;
begin
  m := private.sec_meeting_get(p_section, v_space, p_meeting, true);
  perform private.sec_require_draft(m.id);
  if m.status = 'anulada' then raise exception 'Esta reunião foi anulada.'; end if;
  if length(coalesce(p_body, '')) > 50000 then raise exception 'O texto é demasiado longo.'; end if;
  if p_kind = 'ata' then
    if exists (select 1 from public.sec_minutes where meeting_id = m.id and kind = 'ata') then
      raise exception 'Esta reunião já tem ata.';
    end if;
  elsif p_kind = 'aditamento' then
    select * into v_parent from public.sec_minutes where meeting_id = m.id and kind = 'ata';
    if v_parent.id is null or v_parent.approved_version is null then
      raise exception 'Só se acrescentam aditamentos a uma ata aprovada.';
    end if;
  else
    raise exception 'Tipo de documento inválido.';
  end if;
  insert into public.sec_minutes (section_id, space, meeting_id, kind, parent_id, created_by, updated_by)
  values (p_section, v_space, m.id, p_kind, v_parent.id, auth.uid(), auth.uid()) returning id into v_id;
  insert into public.sec_minute_versions (minute_id, section_id, space, version_no, body, created_by, updated_by)
  values (v_id, p_section, v_space, 1, coalesce(p_body, ''), auth.uid(), auth.uid());
  perform private.audit(p_section, case when p_kind = 'ata' then 'sec_ata_criada' else 'sec_aditamento_criado' end,
    'sec_minute', v_id::text, jsonb_build_object('meeting', m.id, 'space', v_space));
  return v_id;
end
$$;

create or replace function public.sec_minute_save(p_section uuid, p_minute uuid, p_body text, p_expected_version integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes;
begin
  d := private.sec_minute_get(p_section, v_space, p_minute, true);
  perform private.sec_require_draft(d.meeting_id);
  if d.status = 'aprovada' then
    raise exception 'Uma ata aprovada não pode ser alterada. Cria uma nova versão ou um aditamento.';
  end if;
  if d.status <> 'rascunho' then raise exception 'Esta ata está em aprovação. Volta a rascunho para a alterar.'; end if;
  if p_expected_version is distinct from d.current_version then raise exception 'A ata mudou entretanto. Atualiza a página.'; end if;
  if length(coalesce(p_body, '')) > 50000 then raise exception 'O texto é demasiado longo.'; end if;
  update public.sec_minute_versions set body = coalesce(p_body, ''), updated_by = auth.uid(), updated_at = now()
   where minute_id = d.id and version_no = d.current_version;
  update public.sec_minutes set updated_by = auth.uid(), updated_at = now() where id = d.id;
end
$$;

create or replace function public.sec_minute_submit(p_section uuid, p_minute uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes; v_body text; m public.sec_meetings;
begin
  d := private.sec_minute_get(p_section, v_space, p_minute, true);
  perform private.sec_require_draft(d.meeting_id);
  select * into m from public.sec_meetings where id = d.meeting_id;
  if m.status = 'anulada' then raise exception 'Esta reunião foi anulada.'; end if;
  if d.status <> 'rascunho' then raise exception 'Só uma ata em rascunho pode ser enviada para aprovação.'; end if;
  if p_expected_version is distinct from d.current_version then raise exception 'A ata mudou entretanto. Atualiza a página.'; end if;
  select body into v_body from public.sec_minute_versions where minute_id = d.id and version_no = d.current_version;
  if nullif(trim(v_body), '') is null then raise exception 'Escreve o texto da ata antes de a enviar para aprovação.'; end if;
  update public.sec_minute_versions set snapshot = private.sec_content(d.id), frozen_at = now(), submitted_by = auth.uid()
   where minute_id = d.id and version_no = d.current_version;
  update public.sec_minutes set status = 'em_aprovacao', updated_by = auth.uid(), updated_at = now() where id = d.id;
  perform private.audit(p_section, 'sec_ata_submetida', 'sec_minute', d.id::text, jsonb_build_object('versao', d.current_version));
  perform private.module_notify(p_section, 'secretaria', v_space, private.sec_approvers(d.meeting_id), 'sec_aprovar',
    'Ata para aprovar', 'Há uma ata para aprovar.', '/secretaria/atas/' || d.id);
end
$$;

create or replace function public.sec_minute_return(p_section uuid, p_minute uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes; v public.sec_minute_versions;
begin
  d := private.sec_minute_get(p_section, v_space, p_minute, true);
  if not (private.sec_can_approve(d.meeting_id) or private.sec_can_draft(d.meeting_id)) then
    raise exception 'Não tens permissão para esta ação neste módulo.' using errcode = '42501';
  end if;
  if d.status <> 'em_aprovacao' then raise exception 'Só uma ata em aprovação pode voltar a rascunho.'; end if;
  if length(coalesce(p_reason, '')) > 1000 then raise exception 'O motivo é demasiado longo.'; end if;
  select * into v from public.sec_minute_versions where minute_id = d.id and version_no = d.current_version;
  insert into public.sec_minute_versions (minute_id, section_id, space, version_no, body, note, created_by, updated_by)
  values (d.id, p_section, v_space, d.current_version + 1, v.body,
          'Voltou a rascunho' || coalesce(': ' || nullif(trim(coalesce(p_reason, '')), ''), '.'), auth.uid(), auth.uid());
  update public.sec_minutes set status = 'rascunho', current_version = d.current_version + 1, updated_by = auth.uid(), updated_at = now()
   where id = d.id;
  perform private.audit(p_section, 'sec_ata_devolvida', 'sec_minute', d.id::text, jsonb_build_object('versao', d.current_version, 'motivo', p_reason));
  perform private.module_notify(p_section, 'secretaria', v_space,
    array(select distinct x from unnest(array[d.created_by, v.submitted_by]) x), 'sec_devolvida',
    'Ata em rascunho', 'Uma ata voltou a rascunho.', '/secretaria/atas/' || d.id);
end
$$;

create or replace function public.sec_minute_approve(p_section uuid, p_minute uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes; v public.sec_minute_versions;
begin
  d := private.sec_minute_get(p_section, v_space, p_minute, true);
  if not private.sec_can_approve(d.meeting_id) then
    raise exception 'Não tens permissão para aprovar esta ata.' using errcode = '42501';
  end if;
  if exists (select 1 from public.sec_meetings where id = d.meeting_id and status = 'anulada') then raise exception 'Esta reunião foi anulada.'; end if;
  if d.status <> 'em_aprovacao' then raise exception 'Só uma ata em aprovação pode ser aprovada.'; end if;
  if p_expected_version is distinct from d.current_version then raise exception 'A ata mudou entretanto. Atualiza a página.'; end if;
  select * into v from public.sec_minute_versions where minute_id = d.id and version_no = d.current_version;
  update public.sec_minute_versions set approved_at = now(), approved_by = auth.uid() where id = v.id;
  update public.sec_minutes set status = 'aprovada', approved_version = d.current_version, updated_by = auth.uid(), updated_at = now()
   where id = d.id;
  perform private.audit(p_section, 'sec_ata_aprovada', 'sec_minute', d.id::text, jsonb_build_object('versao', d.current_version));
  perform private.module_notify(p_section, 'secretaria', v_space,
    array(select distinct x from unnest(array[d.created_by, v.submitted_by]) x), 'sec_aprovada',
    'Ata aprovada', 'Uma ata foi aprovada.', '/secretaria/atas/' || d.id);
end
$$;

-- Correção de uma ata aprovada: nova versão em rascunho; a aprovada continua consultável
-- (approved_version mantém-se até a nova versão ser aprovada).
create or replace function public.sec_minute_revise(p_section uuid, p_minute uuid, p_reason text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes; v public.sec_minute_versions;
begin
  d := private.sec_minute_get(p_section, v_space, p_minute, true);
  perform private.sec_require_draft(d.meeting_id);
  if d.kind <> 'ata' then raise exception 'Corrige o aditamento criando outro aditamento.'; end if;
  if d.status <> 'aprovada' then raise exception 'Só uma ata aprovada pode ter uma nova versão de correção.'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Indica o motivo da correção.'; end if;
  if length(p_reason) > 1000 then raise exception 'O motivo é demasiado longo.'; end if;
  select * into v from public.sec_minute_versions where minute_id = d.id and version_no = d.current_version;
  insert into public.sec_minute_versions (minute_id, section_id, space, version_no, body, note, created_by, updated_by)
  values (d.id, p_section, v_space, d.current_version + 1, v.body, 'Correção: ' || trim(p_reason), auth.uid(), auth.uid());
  update public.sec_minutes set status = 'rascunho', current_version = d.current_version + 1, updated_by = auth.uid(), updated_at = now()
   where id = d.id;
  perform private.audit(p_section, 'sec_ata_correcao', 'sec_minute', d.id::text,
    jsonb_build_object('versao_aprovada', d.approved_version, 'nova_versao', d.current_version + 1, 'motivo', trim(p_reason)));
  return d.current_version + 1;
end
$$;

-- ---------------------------------------------------------------------------
-- Decisões e tarefas
-- ---------------------------------------------------------------------------
create or replace function public.sec_item_save(
  p_section uuid, p_item uuid, p_minute uuid, p_kind text, p_text text, p_responsible uuid, p_due date,
  p_reminder_days integer default 2, p_request uuid default null, p_stage_path uuid default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); d public.sec_minutes; i public.sec_items; v_id uuid;
        v_old_resp uuid;
begin
  if p_item is not null then
    select * into i from public.sec_items where id = p_item and section_id = p_section and space = v_space for update;
    if i.id is null then raise exception 'Registo não encontrado.'; end if;
    d := private.sec_minute_get(p_section, v_space, i.minute_id, true);
    v_old_resp := i.responsible_id;
  else
    d := private.sec_minute_get(p_section, v_space, p_minute, true);
  end if;
  perform private.sec_require_draft(d.meeting_id);
  if exists (select 1 from public.sec_meetings where id = d.meeting_id and status = 'anulada') then raise exception 'Esta reunião foi anulada.'; end if;
  if d.status <> 'rascunho' then
    raise exception 'As decisões só se alteram com a ata em rascunho. Numa ata aprovada, cria uma nova versão ou um aditamento.';
  end if;
  if p_kind not in ('decisao', 'tarefa') then raise exception 'Escolhe se é decisão ou tarefa.'; end if;
  if nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'Escreve a decisão ou a tarefa.'; end if;
  if length(trim(p_text)) > 2000 then raise exception 'O texto é demasiado longo (máximo 2000 caracteres).'; end if;
  if p_kind = 'tarefa' and p_responsible is null then raise exception 'Escolhe o responsável da tarefa.'; end if;
  if p_kind = 'tarefa' and p_due is null then raise exception 'Indica o prazo da tarefa.'; end if;
  if coalesce(p_reminder_days, 2) not between 0 and 60 then raise exception 'O lembrete tem de ser entre 0 e 60 dias antes do prazo.'; end if;
  if p_responsible is not null and not exists (select 1 from public.memberships where profile_id = p_responsible and section_id = p_section and status = 'ativo') then
    raise exception 'O responsável tem de ser um membro ativo da secção.';
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
    insert into public.sec_items (section_id, space, meeting_id, minute_id, kind, text, responsible_id, due_date, reminder_days,
                                  trail_request_id, stage_path_id, created_by, updated_by)
    values (p_section, v_space, d.meeting_id, d.id, p_kind, trim(p_text), p_responsible, p_due, coalesce(p_reminder_days, 2),
            p_request, p_stage_path, auth.uid(), auth.uid())
    returning * into i;
  else
    update public.sec_items set kind = p_kind, text = trim(p_text), responsible_id = p_responsible, due_date = p_due,
           reminder_days = coalesce(p_reminder_days, 2), trail_request_id = p_request, stage_path_id = p_stage_path,
           updated_by = auth.uid(), updated_at = now()
     where id = p_item returning * into i;
  end if;
  v_id := i.id;
  perform private.sec_schedule_item(i);
  -- Notifica o responsável quando passa a sê-lo (texto genérico).
  if p_responsible is not null and p_responsible is distinct from v_old_resp then
    perform private.module_notify(p_section, 'secretaria', v_space, array[p_responsible], 'sec_tarefa',
      case when p_kind = 'tarefa' then 'Nova tarefa' else 'Nova decisão' end,
      'Tens um novo registo atribuído na Secretaria.', '/secretaria/tarefas');
  end if;
  perform private.audit(p_section, case when p_item is null then 'sec_item_criado' else 'sec_item_alterado' end, 'sec_item', v_id::text,
    jsonb_build_object('kind', p_kind, 'responsible', p_responsible, 'due', p_due));
  return v_id;
end
$$;

create or replace function public.sec_item_set_status(p_section uuid, p_item uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria'); i public.sec_items;
begin
  select * into i from public.sec_items where id = p_item and section_id = p_section and space = v_space for update;
  if i.id is null then raise exception 'Registo não encontrado.'; end if;
  if not (i.responsible_id = auth.uid() or private.sec_can_draft(i.meeting_id) or private.sec_can_approve(i.meeting_id)) then
    if not private.sec_can_see(i.meeting_id) then raise exception 'Registo não encontrado.'; end if;
    raise exception 'Não tens permissão para mudar o estado desta tarefa.' using errcode = '42501';
  end if;
  if exists (select 1 from public.sec_meetings where id = i.meeting_id and status = 'anulada') then raise exception 'Esta reunião foi anulada.'; end if;
  if p_status not in ('por_fazer', 'em_curso', 'feita', 'cancelada') then raise exception 'Estado inválido.'; end if;
  if length(coalesce(p_note, '')) > 1000 then raise exception 'A nota é demasiado longa.'; end if;
  update public.sec_items set exec_status = p_status, status_note = nullif(trim(coalesce(p_note, '')), ''),
         status_changed_by = auth.uid(), status_changed_at = now()
   where id = i.id returning * into i;
  perform private.sec_schedule_item(i);
  perform private.audit(p_section, 'sec_item_estado', 'sec_item', i.id::text, jsonb_build_object('estado', p_status));
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- O envio de lembretes continua reservado ao agendador (a linha anterior voltaria a abri-lo).
revoke execute on function public.process_due_reminders() from authenticated;

-- ===== supabase/migrations/20261021000900_modulos_integracao.sql =====
-- Pioneiros — ligações entre módulos.
-- Na página de uma atividade do Calendário mostram-se as reservas de material, o resumo
-- financeiro e as reuniões ligadas a ela, cada parte só quando a pessoa tem acesso ao
-- módulo correspondente NO MESMO ESPAÇO (teste com teste, real com real). Nada é copiado:
-- cada registo continua a existir uma única vez no seu módulo.
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

  return v_out;
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- O envio de lembretes é só para o serviço agendado.
revoke execute on function public.process_due_reminders() from authenticated;
