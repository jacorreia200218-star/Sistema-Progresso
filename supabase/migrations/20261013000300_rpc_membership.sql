-- Pioneiros — operações de conta, convites e gestão (RPC).
-- Todas as funções são SECURITY DEFINER e validam permissões explicitamente.

-- ---------------------------------------------------------------------------
-- Perfil
-- ---------------------------------------------------------------------------
create or replace function public.update_my_profile(p_full_name text, p_totem text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_full_name, ''))) = 0 then raise exception 'Indica o teu nome.'; end if;
  update public.profiles
     set full_name = left(trim(p_full_name), 200),
         totem = nullif(left(trim(coalesce(p_totem, '')), 120), ''),
         updated_at = now()
   where id = auth.uid();
end
$$;

-- Guarda o caminho da fotografia já carregada (pasta própria no bucket privado).
create or replace function public.set_my_photo(p_path text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if p_path is not null then
    if split_part(p_path, '/', 1) <> auth.uid()::text then
      raise exception 'Caminho de fotografia inválido.' using errcode = '42501';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'fotografias' and o.name = p_path) then
      raise exception 'A fotografia ainda não foi carregada.';
    end if;
  end if;
  update public.profiles set photo_path = p_path, updated_at = now() where id = auth.uid();
end
$$;

-- ---------------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------------
create or replace function public.create_invite(p_section uuid, p_label text, p_expires_at timestamptz, p_max_uses integer)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_code text;
begin
  if not private.is_admin(p_section) then
    raise exception 'Só administradores podem criar convites.' using errcode = '42501';
  end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'A validade tem de ser uma data futura.'; end if;
  if p_expires_at > now() + interval '180 days' then raise exception 'A validade máxima é de 180 dias.'; end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 500 then raise exception 'O limite de usos deve estar entre 1 e 500.'; end if;
  v_code := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');
  insert into public.invites (section_id, token_hash, label, expires_at, max_uses, created_by)
  values (p_section, extensions.digest(v_code, 'sha256'), left(coalesce(trim(p_label), ''), 200), p_expires_at, p_max_uses, auth.uid());
  perform private.audit(p_section, 'convite_criado', 'invite', null,
    jsonb_build_object('label', p_label, 'expires_at', p_expires_at, 'max_uses', p_max_uses));
  return v_code; -- devolvido uma única vez; só o hash fica guardado
end
$$;

create or replace function public.revoke_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_section uuid;
begin
  select section_id into v_section from public.invites where id = p_invite;
  if v_section is null or not private.is_admin(v_section) then
    raise exception 'Convite não encontrado.' using errcode = '42501';
  end if;
  update public.invites set revoked_at = now(), revoked_by = auth.uid()
   where id = p_invite and revoked_at is null;
  perform private.audit(v_section, 'convite_revogado', 'invite', p_invite::text, '{}');
end
$$;

-- Consumo atómico do convite: bloqueia a linha, valida e cria a inscrição pendente.
create or replace function public.redeem_invite(p_code text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_inv public.invites;
  v_existing public.memberships;
  v_membership uuid;
begin
  if auth.uid() is null then raise exception 'Tens de entrar na tua conta primeiro.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Perfil não encontrado.';
  end if;

  select * into v_inv from public.invites
   where token_hash = extensions.digest(trim(coalesce(p_code, '')), 'sha256')
   for update;
  if v_inv.id is null then raise exception 'Convite inválido.'; end if;
  if v_inv.revoked_at is not null then raise exception 'Este convite foi revogado.'; end if;
  if v_inv.expires_at <= now() then raise exception 'Este convite expirou.'; end if;
  if v_inv.use_count >= v_inv.max_uses then raise exception 'Este convite já atingiu o limite de usos.'; end if;

  select * into v_existing from public.memberships
   where profile_id = auth.uid() and section_id = v_inv.section_id
   for update;

  if v_existing.id is not null then
    if v_existing.status in ('pendente', 'ativo') then
      raise exception 'Já tens um pedido ou acesso nesta secção.';
    elsif v_existing.status = 'suspenso' then
      raise exception 'O teu acesso a esta secção está suspenso. Fala com a administração.';
    end if;
    -- Regresso de quem saiu: volta a pendente, sem função nem permissões.
    perform set_config('pioneiros.reason', 'Novo pedido de entrada por convite', true);
    update public.memberships
       set status = 'pendente', function = null, is_admin = false, team_id = null,
           invite_id = v_inv.id, requested_at = now(), approved_by = null, approved_at = null
     where id = v_existing.id;
    v_membership := v_existing.id;
  else
    perform set_config('pioneiros.reason', 'Pedido de entrada por convite', true);
    insert into public.memberships (profile_id, section_id, status, invite_id)
    values (auth.uid(), v_inv.section_id, 'pendente', v_inv.id)
    returning id into v_membership;
  end if;

  if exists (select 1 from public.invite_redemptions where invite_id = v_inv.id and profile_id = auth.uid()) then
    raise exception 'Já usaste este convite.';
  end if;
  insert into public.invite_redemptions (invite_id, profile_id, membership_id)
  values (v_inv.id, auth.uid(), v_membership);
  update public.invites set use_count = use_count + 1 where id = v_inv.id;

  perform private.notify(private.section_admins(v_inv.section_id), v_inv.section_id, 'pedido_entrada',
    'Novo pedido de entrada', 'Há um novo pedido de entrada na secção a aguardar confirmação.', '/gestao/membros');
  return v_membership;
end
$$;

-- ---------------------------------------------------------------------------
-- Gestão de membros (administração)
-- ---------------------------------------------------------------------------
create or replace function private.assert_team_in_section(p_team uuid, p_section uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_team is not null and not exists (
    select 1 from public.teams where id = p_team and section_id = p_section and archived_at is null
  ) then
    raise exception 'Equipa inválida para esta secção.';
  end if;
end
$$;

create or replace function private.active_admin_count(p_section uuid)
returns integer language sql stable security definer set search_path = ''
as $$ select count(*)::int from public.memberships where section_id = p_section and status = 'ativo' and is_admin $$;

create or replace function public.approve_membership(p_membership uuid, p_function public.member_function, p_team uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null or not private.is_admin(v_m.section_id) then
    raise exception 'Inscrição não encontrada.' using errcode = '42501';
  end if;
  if v_m.status <> 'pendente' then raise exception 'Esta inscrição já não está pendente.'; end if;
  if p_function is null then raise exception 'Escolhe a função do membro.'; end if;
  if p_function in ('pioneiro', 'guia') and p_team is null then raise exception 'Pioneiros e guias precisam de uma equipa.'; end if;
  perform private.assert_team_in_section(p_team, v_m.section_id);
  perform set_config('pioneiros.reason', 'Entrada confirmada pela administração', true);
  update public.memberships
     set status = 'ativo', function = p_function,
         team_id = case when p_function = 'dirigente' then null else p_team end,
         approved_by = auth.uid(), approved_at = now()
   where id = p_membership;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'entrada_confirmada',
    'Entrada confirmada', 'A tua entrada na secção foi confirmada.', '/');
end
$$;

create or replace function public.update_membership(
  p_membership uuid, p_function public.member_function, p_team uuid, p_is_admin boolean, p_reason text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null or not private.is_admin(v_m.section_id) then
    raise exception 'Inscrição não encontrada.' using errcode = '42501';
  end if;
  if v_m.status not in ('ativo', 'suspenso') then raise exception 'Só é possível alterar membros ativos ou suspensos.'; end if;
  if p_function is null and not coalesce(p_is_admin, false) then
    raise exception 'Um membro sem função pedagógica tem de ser administrador.';
  end if;
  if p_function in ('pioneiro', 'guia') and p_team is null then raise exception 'Pioneiros e guias precisam de uma equipa.'; end if;
  perform private.assert_team_in_section(p_team, v_m.section_id);
  if v_m.is_admin and not coalesce(p_is_admin, false) and v_m.status = 'ativo'
     and private.active_admin_count(v_m.section_id) <= 1 then
    raise exception 'A secção tem de manter pelo menos um administrador ativo.';
  end if;
  perform set_config('pioneiros.reason', left(coalesce(p_reason, ''), 500), true);
  update public.memberships
     set function = p_function,
         team_id = case when p_function in ('pioneiro', 'guia') then p_team else null end,
         is_admin = coalesce(p_is_admin, false)
   where id = p_membership;
  perform private.audit(v_m.section_id, 'membro_alterado', 'membership', p_membership::text,
    jsonb_build_object('function', p_function, 'team_id', p_team, 'is_admin', p_is_admin));
end
$$;

-- Suspender, reativar ou registar saída. Rejeitar pedido pendente = 'saiu'.
create or replace function public.set_membership_status(p_membership uuid, p_status public.member_status, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null or not private.is_admin(v_m.section_id) then
    raise exception 'Inscrição não encontrada.' using errcode = '42501';
  end if;
  if p_status = 'pendente' then raise exception 'Estado inválido.'; end if;
  if p_status = 'ativo' and v_m.status <> 'suspenso' then
    raise exception 'Só é possível reativar membros suspensos. Pedidos pendentes confirmam-se em «Aprovar».';
  end if;
  if v_m.is_admin and v_m.status = 'ativo' and p_status <> 'ativo'
     and private.active_admin_count(v_m.section_id) <= 1 then
    raise exception 'A secção tem de manter pelo menos um administrador ativo.';
  end if;
  if p_status in ('suspenso', 'saiu') and length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Indica o motivo.';
  end if;
  perform set_config('pioneiros.reason', left(coalesce(p_reason, ''), 500), true);
  update public.memberships set status = p_status where id = p_membership;
  perform private.audit(v_m.section_id, 'estado_membro', 'membership', p_membership::text,
    jsonb_build_object('from', v_m.status, 'to', p_status, 'reason', p_reason));
end
$$;

-- ---------------------------------------------------------------------------
-- Equipas
-- ---------------------------------------------------------------------------
create or replace function public.create_team(p_section uuid, p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not private.is_admin(p_section) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Indica o nome da equipa.'; end if;
  insert into public.teams (section_id, name) values (p_section, trim(p_name)) returning id into v_id;
  perform private.audit(p_section, 'equipa_criada', 'team', v_id::text, jsonb_build_object('name', p_name));
  return v_id;
exception when unique_violation then
  raise exception 'Já existe uma equipa com esse nome.';
end
$$;

create or replace function public.rename_team(p_team uuid, p_name text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_section uuid;
begin
  select section_id into v_section from public.teams where id = p_team;
  if v_section is null or not private.is_admin(v_section) then raise exception 'Equipa não encontrada.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Indica o nome da equipa.'; end if;
  update public.teams set name = trim(p_name) where id = p_team;
  perform private.audit(v_section, 'equipa_renomeada', 'team', p_team::text, jsonb_build_object('name', p_name));
exception when unique_violation then
  raise exception 'Já existe uma equipa com esse nome.';
end
$$;

create or replace function public.archive_team(p_team uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_section uuid;
begin
  select section_id into v_section from public.teams where id = p_team;
  if v_section is null or not private.is_admin(v_section) then raise exception 'Equipa não encontrada.' using errcode = '42501'; end if;
  if exists (select 1 from public.memberships where team_id = p_team and status in ('ativo', 'suspenso')) then
    raise exception 'Muda primeiro os membros desta equipa para outra equipa.';
  end if;
  update public.teams set archived_at = now() where id = p_team;
  perform private.audit(v_section, 'equipa_arquivada', 'team', p_team::text, '{}');
end
$$;

-- ---------------------------------------------------------------------------
-- Configuração: progresso anterior
-- ---------------------------------------------------------------------------
create or replace function public.set_historical_progress(p_section uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_old boolean;
begin
  if not private.is_admin(p_section) then raise exception 'Só administradores podem alterar esta configuração.' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'Valor inválido.'; end if;
  select historical_progress_enabled into v_old from public.section_settings where section_id = p_section for update;
  if v_old is null then
    insert into public.section_settings (section_id, historical_progress_enabled, updated_by) values (p_section, p_enabled, auth.uid());
  elsif v_old = p_enabled then
    return;
  else
    update public.section_settings set historical_progress_enabled = p_enabled, updated_by = auth.uid(), updated_at = now()
     where section_id = p_section;
  end if;
  insert into public.settings_history (section_id, setting, old_value, new_value, changed_by)
  values (p_section, 'historical_progress_enabled', to_jsonb(v_old), to_jsonb(p_enabled), auth.uid());
  perform private.audit(p_section, 'configuracao', 'section_settings', p_section::text,
    jsonb_build_object('historical_progress_enabled', p_enabled));
end
$$;

-- ---------------------------------------------------------------------------
-- Notificações
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[])
returns void language sql security definer set search_path = ''
as $$
  update public.notifications set read_at = now()
   where profile_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids))
$$;
