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
