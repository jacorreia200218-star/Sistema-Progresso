-- Atualização «Cargos que dão permissões» (31/10/2026) para um projeto já instalado.
-- Cola no SQL Editor e carrega em «Run» UMA vez. Não apaga registos nem muda permissões já dadas:
-- nenhum cargo dá permissões até escolheres em Gestão › Módulos.

-- ===== supabase/migrations/20261102000100_cargos_permissoes.sql =====
-- Pioneiros — Cargos que dão permissões (tesoureiro e guarda do material).
--
-- 1. A administração escolhe, em Gestão › Módulos, que cargos dão cada permissão de alteração:
--    «Tesoureiro autorizado» (tesouraria.gerir) e «Responsável de material» (inventario.gerir).
--    Só estas duas: cargos nunca dão outras permissões (por exemplo, gerir cargos).
-- 2. Quem está nomeado para um desses cargos (nomeação no espaço real, já começada, não terminada
--    nem anulada, membro ativo) tem a permissão enquanto a nomeação durar. Quando a nomeação
--    termina ou é anulada, a permissão acaba sozinha: nada fica para retirar à mão.
-- 3. Os dirigentes não recebem permissões por cargo: a Tesouraria continua a exigir uma
--    autorização explícita da administração, mesmo a dirigentes.
-- 4. As permissões dadas à mão (module_grants) mantêm-se exatamente como estão.
-- Aditivo: nenhum cargo dá permissões até a administração o escolher.

create table if not exists public.module_role_grants (
  section_id uuid not null references public.sections (id) on delete cascade,
  role_id uuid not null references public.eq_roles (id) on delete cascade,
  permission text not null check (permission in ('inventario.gerir', 'tesouraria.gerir')),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (role_id, permission)
);
create index if not exists module_role_grants_section on public.module_role_grants (section_id, permission);
alter table public.module_role_grants enable row level security;
revoke all on public.module_role_grants from anon, authenticated;

-- Quem tem hoje a permissão por cargo (com o cargo e a equipa, para mostrar à administração).
create or replace function private.role_grant_holders(p_section uuid, p_permission text)
returns table (profile_id uuid, role_id uuid, team_id uuid)
language sql stable security definer set search_path = ''
as $$
  select a.profile_id, a.role_id, a.team_id
    from public.module_role_grants g
    join public.eq_roles r on r.id = g.role_id and r.section_id = g.section_id and r.space = 'real' and r.archived_at is null
    join public.eq_appointments a on a.role_id = r.id and a.section_id = g.section_id and a.space = 'real'
    join public.memberships m on m.id = a.membership_id
   where g.section_id = p_section and g.permission = p_permission
     and a.cancelled_at is null
     and a.starts_on <= private.eq_today() and (a.ends_on is null or a.ends_on > private.eq_today())
     and m.section_id = p_section and m.profile_id = a.profile_id and m.status = 'ativo' and m.function <> 'dirigente'
$$;

-- Tem esta pessoa a permissão (à mão ou por cargo)?
create or replace function private.has_grant_as(p_section uuid, p_profile uuid, p_permission text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_profile is not null and (
    exists (select 1 from public.module_grants g
             where g.section_id = p_section and g.permission = p_permission and g.profile_id = p_profile)
    or (p_permission in ('inventario.gerir', 'tesouraria.gerir')
        and exists (select 1 from private.role_grant_holders(p_section, p_permission) h where h.profile_id = p_profile)))
$$;

create or replace function private.has_grant(p_section uuid, p_permission text)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.has_grant_as(p_section, auth.uid(), p_permission) $$;

-- Responsáveis pelo material (avisos de empréstimos, etc.): dirigentes, permissão à mão e por cargo.
create or replace function private.inv_managers(p_section uuid) returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct p), '{}') from (
    select unnest(private.section_dirigentes(p_section)) p
    union select g.profile_id from public.module_grants g where g.section_id = p_section and g.permission = 'inventario.gerir'
    union select h.profile_id from private.role_grant_holders(p_section, 'inventario.gerir') h
  ) x
$$;

create or replace function public.my_modules(p_section uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'module', k,
    'status', private.module_status(p_section, k),
    'space', private.module_space(p_section, k),
    'grants', coalesce((select jsonb_agg(x.permission) from (
                          select g.permission from public.module_grants g
                           where g.section_id = p_section and g.profile_id = auth.uid() and g.permission like k || '.%'
                          union
                          select pr from unnest(array['inventario.gerir', 'tesouraria.gerir']) pr
                           where pr like k || '.%'
                             and exists (select 1 from private.role_grant_holders(p_section, pr) h where h.profile_id = auth.uid())
                        ) x), '[]'::jsonb),
    'dirigente', private.is_dirigente(p_section)
  ) order by k), '[]'::jsonb)
  from unnest(array['calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria', 'presencas']) k
  where private.is_active_member(p_section)
$$;

-- Gestão › Módulos: cargos (reais e ativos), que permissão dá cada um e quem a tem hoje por cargo.
create or replace function public.module_role_grants_overview(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'roles', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.name)
                         from public.eq_roles r
                        where r.section_id = p_section and r.space = 'real' and r.archived_at is null), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(jsonb_build_object('role_id', g.role_id, 'permission', g.permission) order by g.granted_at)
                         from public.module_role_grants g
                         join public.eq_roles r on r.id = g.role_id and r.archived_at is null
                        where g.section_id = p_section), '[]'::jsonb),
    'holders', coalesce((select jsonb_agg(jsonb_build_object(
                           'permission', pr, 'profile_id', h.profile_id,
                           'full_name', (select full_name from public.profiles where id = h.profile_id),
                           'role_name', (select name from public.eq_roles where id = h.role_id),
                           'team_name', (select name from public.teams where id = h.team_id))
                           order by pr, (select full_name from public.profiles where id = h.profile_id))
                          from unnest(array['inventario.gerir', 'tesouraria.gerir']) pr
                          cross join lateral private.role_grant_holders(p_section, pr) h), '[]'::jsonb)
  );
end
$$;

create or replace function public.set_module_role_grant(p_section uuid, p_role uuid, p_permission text, p_on boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_role public.eq_roles;
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  if p_permission not in ('inventario.gerir', 'tesouraria.gerir') then
    raise exception 'Os cargos só podem dar as permissões de Tesouraria e de Inventário.';
  end if;
  select * into v_role from public.eq_roles where id = p_role and section_id = p_section and space = 'real';
  if v_role.id is null then raise exception 'Registo não encontrado.'; end if;
  if p_on then
    if v_role.archived_at is not null then raise exception 'Este cargo está arquivado.'; end if;
    insert into public.module_role_grants (section_id, role_id, permission, granted_by)
    values (p_section, p_role, p_permission, auth.uid())
    on conflict do nothing;
  else
    delete from public.module_role_grants where section_id = p_section and role_id = p_role and permission = p_permission;
  end if;
  perform private.audit(p_section, case when p_on then 'permissao_cargo_concedida' else 'permissao_cargo_retirada' end,
    'module_role_grant', p_permission, jsonb_build_object('role', p_role, 'role_name', v_role.name));
end
$$;

-- Equipas e cargos: que permissões dá cada cargo (para mostrar a todos ao lado do cargo).
create or replace function public.eq_role_grants(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'equipas');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('role_id', g.role_id, 'permission', g.permission) order by g.granted_at)
                     from public.module_role_grants g
                     join public.eq_roles r on r.id = g.role_id and r.space = v_space
                    where g.section_id = p_section), '[]'::jsonb);
end
$$;

-- O texto habitual do Tesoureiro dizia que o cargo nunca dava acesso à Tesouraria; agora depende
-- da escolha da administração. Só se muda o texto quando ainda é exatamente o habitual.
update public.eq_roles
   set description = 'Acompanha as contas da equipa (quotas e despesas de equipa) e presta contas à equipa.'
 where description = 'Acompanha as contas da equipa (quotas e despesas de equipa) e presta contas à equipa. Não dá acesso à tesouraria da secção.';

create or replace function public.eq_seed_roles(p_section uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.eq_require_manage(p_section); v_n int := 0; r record;
begin
  for r in select * from (values
    ('Guia', 'guia', true, 'Anima e representa a equipa; coordena a preparação das atividades e das reuniões de equipa; acompanha cada elemento e leva a voz da equipa ao Conselho de Guias.'),
    ('Subguia', 'subguia', true, 'Apoia o guia em todas as tarefas e substitui-o quando está ausente; ajuda a integrar os novos elementos.'),
    ('Secretário', 'cargo', true, 'Mantém o livro de equipa e os registos das reuniões e atividades; trata da comunicação da equipa.'),
    ('Tesoureiro', 'cargo', true, 'Acompanha as contas da equipa (quotas e despesas de equipa) e presta contas à equipa.'),
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

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;
revoke all on function private.role_grant_holders(uuid, text), private.has_grant_as(uuid, uuid, text) from public, anon;
notify pgrst, 'reload schema';
