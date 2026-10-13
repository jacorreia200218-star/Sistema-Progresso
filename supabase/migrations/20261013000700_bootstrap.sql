-- Pioneiros — criação segura da secção e do primeiro administrador.
-- Esta função NÃO está acessível pela API: só pode ser executada por quem tem
-- acesso de proprietário à base de dados (ex.: SQL Editor do painel Supabase).
-- Ver supabase/bootstrap/primeiro_admin.sql e o README.
create or replace function private.bootstrap_section(p_group_name text, p_section_name text, p_admin_email text, p_admin_is_dirigente boolean default true)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid; v_group uuid; v_section uuid; v_version uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(trim(p_admin_email));
  if v_user is null then
    raise exception 'Não existe conta com o email %. Cria primeiro a conta na aplicação e confirma o email.', p_admin_email;
  end if;
  select id into v_version from public.catalog_versions where key = 'pioneiros-manual-v1';
  if v_version is null then raise exception 'Catálogo dos Pioneiros não encontrado (migração em falta).'; end if;

  select id into v_group from public.groups where name = trim(p_group_name);
  if v_group is null then
    insert into public.groups (name) values (trim(p_group_name)) returning id into v_group;
  end if;
  select id into v_section from public.sections where group_id = v_group and name = trim(p_section_name);
  if v_section is null then
    insert into public.sections (group_id, kind, name, catalog_version_id)
    values (v_group, 'pioneiros', trim(p_section_name), v_version) returning id into v_section;
    insert into public.section_settings (section_id) values (v_section);
  end if;

  insert into public.profiles (id) values (v_user) on conflict (id) do nothing;
  perform set_config('pioneiros.reason', 'Primeiro administrador (bootstrap)', true);
  insert into public.memberships (profile_id, section_id, status, function, is_admin, approved_at)
  values (v_user, v_section, 'ativo', case when p_admin_is_dirigente then 'dirigente'::public.member_function end, true, now())
  on conflict (profile_id, section_id) do update
    set status = 'ativo', is_admin = true,
        function = coalesce(case when p_admin_is_dirigente then 'dirigente'::public.member_function end, public.memberships.function),
        team_id = case when p_admin_is_dirigente then null else public.memberships.team_id end;
  return v_section;
end
$$;
revoke all on function private.bootstrap_section(text, text, text, boolean) from public, anon, authenticated;
