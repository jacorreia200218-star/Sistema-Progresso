-- Pioneiros — funções de permissões, gatilhos de histórico e políticas RLS.
-- Princípio: o cliente só LÊ (filtrado por RLS). Todas as escritas com efeito
-- pedagógico ou administrativo passam por funções RPC que validam permissões
-- no servidor. A única exceção é o diário pessoal de vivências (experiences).

-- ---------------------------------------------------------------------------
-- Funções auxiliares (SECURITY DEFINER, esquema private, não expostas pela API)
-- ---------------------------------------------------------------------------

-- Membro ativo do utilizador atual numa secção.
create or replace function private.my_active_membership(p_section uuid)
returns public.memberships
language sql stable security definer set search_path = ''
as $$
  select m.* from public.memberships m
  where m.section_id = p_section and m.profile_id = auth.uid() and m.status = 'ativo'
  limit 1
$$;

create or replace function private.is_active_member(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.section_id = p_section and m.profile_id = auth.uid() and m.status = 'ativo'
  )
$$;

create or replace function private.is_dirigente(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.section_id = p_section and m.profile_id = auth.uid()
      and m.status = 'ativo' and m.function = 'dirigente'
  )
$$;

create or replace function private.is_admin(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.section_id = p_section and m.profile_id = auth.uid()
      and m.status = 'ativo' and m.is_admin
  )
$$;

-- Equipa que o utilizador atual guia nesta secção (null se não for guia ativo).
create or replace function private.guia_team(p_section uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select m.team_id from public.memberships m
  where m.section_id = p_section and m.profile_id = auth.uid()
    and m.status = 'ativo' and m.function = 'guia'
  limit 1
$$;

-- Pode ver o percurso/progresso deste membro?
-- O próprio (se ativo), dirigentes ativos da secção, ou o guia ATUAL da equipa
-- ATUAL do membro. Um antigo guia perde o acesso imediatamente.
create or replace function private.can_view_progress(p_membership uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships target
    join public.memberships me
      on me.section_id = target.section_id and me.profile_id = auth.uid() and me.status = 'ativo'
    where target.id = p_membership
      and (
        me.id = target.id
        or me.function = 'dirigente'
        or (me.function = 'guia' and me.team_id is not null
            and me.team_id = target.team_id and target.status = 'ativo')
      )
  )
$$;

-- Pode ver os dados de inscrição (membership) de alguém?
create or replace function private.can_view_membership(p_membership uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships target
    join public.memberships me on me.section_id = target.section_id and me.profile_id = auth.uid()
    where target.id = p_membership
      and (
        me.id = target.id
        or (me.status = 'ativo' and (me.is_admin or me.function = 'dirigente'))
        or (me.status = 'ativo' and target.status = 'ativo' and (
              (me.team_id is not null and me.team_id = target.team_id)
              or target.function = 'dirigente'))
      )
  )
$$;

-- Pode ver o perfil (nome, totem, fotografia) de alguém?
create or replace function private.can_view_profile(p_profile uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_profile = auth.uid() or exists (
    select 1
    from public.memberships target
    where target.profile_id = p_profile
      and private.can_view_membership(target.id)
  )
$$;

create or replace function private.request_membership(p_request uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select membership_id from public.trail_requests where id = p_request $$;

create or replace function private.safe_uuid(p text)
returns uuid language plpgsql immutable set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end
$$;

-- Notificações (só criadas por funções protegidas).
create or replace function private.notify(
  p_profiles uuid[], p_section uuid, p_kind text, p_title text, p_body text, p_link text
) returns void language sql security definer set search_path = ''
as $$
  insert into public.notifications (profile_id, section_id, kind, title, body, link)
  select distinct pid, p_section, p_kind, p_title, p_body, p_link
  from unnest(p_profiles) as pid
  where pid is not null and pid is distinct from auth.uid()
$$;

create or replace function private.section_dirigentes(p_section uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(profile_id), '{}') from public.memberships
  where section_id = p_section and status = 'ativo' and function = 'dirigente'
$$;

create or replace function private.section_admins(p_section uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(profile_id), '{}') from public.memberships
  where section_id = p_section and status = 'ativo' and is_admin
$$;

create or replace function private.team_guias(p_team uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(profile_id), '{}') from public.memberships
  where team_id = p_team and status = 'ativo' and function = 'guia'
$$;

create or replace function private.section_guias(p_section uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(profile_id), '{}') from public.memberships
  where section_id = p_section and status = 'ativo' and function = 'guia'
$$;

create or replace function private.audit(
  p_section uuid, p_action text, p_entity text, p_entity_id text, p_details jsonb
) returns void language sql security definer set search_path = ''
as $$
  insert into public.audit_log (section_id, actor, action, entity, entity_id, details)
  values (p_section, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb))
$$;

-- Chaves de trilhos validados de um membro (equipa ou progresso anterior aprovado).
-- Um trilho só pode ter um pedido ativo, por isso nunca conta duas vezes.
create or replace function private.validated_trail_keys(p_membership uuid)
returns setof text language sql stable security definer set search_path = ''
as $$
  select distinct trail_key from public.trail_requests
  where membership_id = p_membership and status in ('validado_equipa', 'aprovado')
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------------

-- Perfil criado no registo. Só o nome é aceite dos metadados: nenhuma função
-- ou permissão pode ser escolhida no registo.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(trim(new.raw_user_meta_data ->> 'full_name'), ''), 200))
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Histórico de função/equipa/estado/admin.
create or replace function private.log_membership_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.membership_history (membership_id, section_id, changed_by, new_status, new_function, new_team_id, new_is_admin, reason)
    values (new.id, new.section_id, auth.uid(), new.status, new.function, new.team_id, new.is_admin,
            current_setting('pioneiros.reason', true));
  elsif (old.status, old.function, old.team_id, old.is_admin)
        is distinct from (new.status, new.function, new.team_id, new.is_admin) then
    insert into public.membership_history (membership_id, section_id, changed_by,
      old_status, new_status, old_function, new_function, old_team_id, new_team_id, old_is_admin, new_is_admin, reason)
    values (new.id, new.section_id, auth.uid(),
      old.status, new.status, old.function, new.function, old.team_id, new.team_id, old.is_admin, new.is_admin,
      current_setting('pioneiros.reason', true));
    new.updated_at := now();
  end if;
  return new;
end
$$;

create trigger memberships_history_ins after insert on public.memberships
  for each row execute function private.log_membership_change();
create trigger memberships_history_upd before update on public.memberships
  for each row execute function private.log_membership_change();

-- ---------------------------------------------------------------------------
-- Privilégios: leitura via RLS; escrita apenas por RPC.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.experiences to authenticated;

alter table public.groups enable row level security;
alter table public.catalog_versions enable row level security;
alter table public.sections enable row level security;
alter table public.section_settings enable row level security;
alter table public.settings_history enable row level security;
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.memberships enable row level security;
alter table public.membership_history enable row level security;
alter table public.invite_redemptions enable row level security;
alter table public.catalog_stages enable row level security;
alter table public.catalog_areas enable row level security;
alter table public.catalog_trails enable row level security;
alter table public.catalog_objectives enable row level security;
alter table public.adhesions enable row level security;
alter table public.stage_paths enable row level security;
alter table public.stage_choices enable row level security;
alter table public.trail_requests enable row level security;
alter table public.trail_request_versions enable row level security;
alter table public.attachments enable row level security;
alter table public.trail_decisions enable row level security;
alter table public.stage_requests enable row level security;
alter table public.merit_awards enable row level security;
alter table public.experiences enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;

-- Organização
create policy groups_select on public.groups for select to authenticated
  using (exists (select 1 from public.sections s join public.memberships m on m.section_id = s.id
                 where s.group_id = groups.id and m.profile_id = (select auth.uid())));

create policy sections_select on public.sections for select to authenticated
  using (exists (select 1 from public.memberships m
                 where m.section_id = sections.id and m.profile_id = (select auth.uid())));

create policy section_settings_select on public.section_settings for select to authenticated
  using (private.is_active_member(section_id));

create policy settings_history_select on public.settings_history for select to authenticated
  using (private.is_admin(section_id) or private.is_dirigente(section_id));

create policy teams_select on public.teams for select to authenticated
  using (private.is_active_member(section_id));

-- Catálogo: conteúdo pedagógico, legível por qualquer utilizador autenticado.
create policy catalog_versions_select on public.catalog_versions for select to authenticated using (true);
create policy catalog_stages_select on public.catalog_stages for select to authenticated using (true);
create policy catalog_areas_select on public.catalog_areas for select to authenticated using (true);
create policy catalog_trails_select on public.catalog_trails for select to authenticated using (true);
create policy catalog_objectives_select on public.catalog_objectives for select to authenticated using (true);

-- Pessoas
create policy profiles_select on public.profiles for select to authenticated
  using (private.can_view_profile(id));

create policy memberships_select on public.memberships for select to authenticated
  using (private.can_view_membership(id));

create policy membership_history_select on public.membership_history for select to authenticated
  using (private.is_admin(section_id));

create policy invites_select on public.invites for select to authenticated
  using (private.is_admin(section_id));

create policy invite_redemptions_select on public.invite_redemptions for select to authenticated
  using (exists (select 1 from public.invites i where i.id = invite_id and private.is_admin(i.section_id)));

-- Progresso (o administrador técnico não vê progresso, salvo se também for dirigente)
create policy adhesions_select on public.adhesions for select to authenticated
  using (private.can_view_progress(membership_id));
create policy stage_paths_select on public.stage_paths for select to authenticated
  using (private.can_view_progress(membership_id));
create policy stage_choices_select on public.stage_choices for select to authenticated
  using (private.can_view_progress(membership_id));
create policy trail_requests_select on public.trail_requests for select to authenticated
  using (private.can_view_progress(membership_id));
create policy trail_request_versions_select on public.trail_request_versions for select to authenticated
  using (private.can_view_progress(private.request_membership(request_id)));
create policy attachments_select on public.attachments for select to authenticated
  using (private.can_view_progress(private.request_membership(request_id)));
create policy trail_decisions_select on public.trail_decisions for select to authenticated
  using (private.can_view_progress(private.request_membership(request_id)));
create policy stage_requests_select on public.stage_requests for select to authenticated
  using (private.can_view_progress(membership_id));
create policy merit_awards_select on public.merit_awards for select to authenticated
  using (private.can_view_progress(membership_id));

-- Diário de vivências: apenas o próprio, e só enquanto membro ativo pioneiro/guia.
create policy experiences_owner_select on public.experiences for select to authenticated
  using (exists (select 1 from public.memberships m where m.id = membership_id
                 and m.profile_id = (select auth.uid()) and m.status = 'ativo'));
create policy experiences_owner_insert on public.experiences for insert to authenticated
  with check (exists (select 1 from public.memberships m where m.id = membership_id
                      and m.profile_id = (select auth.uid()) and m.status = 'ativo'
                      and m.function in ('pioneiro', 'guia')));
create policy experiences_owner_update on public.experiences for update to authenticated
  using (exists (select 1 from public.memberships m where m.id = membership_id
                 and m.profile_id = (select auth.uid()) and m.status = 'ativo'))
  with check (exists (select 1 from public.memberships m where m.id = membership_id
                      and m.profile_id = (select auth.uid()) and m.status = 'ativo'));
create policy experiences_owner_delete on public.experiences for delete to authenticated
  using (exists (select 1 from public.memberships m where m.id = membership_id
                 and m.profile_id = (select auth.uid()) and m.status = 'ativo'));

create policy notifications_select on public.notifications for select to authenticated
  using (profile_id = (select auth.uid()));

create policy audit_log_select on public.audit_log for select to authenticated
  using (private.is_admin(section_id));
