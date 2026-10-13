-- Atualização «Entrada com equipa» (16/10/2026) para um projeto já instalado com instalar_tudo.sql.
-- Cola no SQL Editor e carrega em «Run» UMA vez. Não apaga nem altera registos existentes.

-- ===== supabase/migrations/20261016000100_entrada_equipa.sql =====
-- Pioneiros — entrada com equipa indicada pelo próprio e edição do perfil pela administração.
--
-- Quem pede entrada indica o nome (no registo) e a equipa a que pertence. É só uma indicação:
-- a administração confirma (ou corrige) a equipa e atribui a função ao aprovar, e pode alterar
-- depois o nome, a equipa e a função de qualquer membro. A função nunca é escolhida pelo próprio.

alter table public.memberships
  add column if not exists requested_team_id uuid references public.teams (id) on delete set null;

-- Equipas (não arquivadas) das secções onde o utilizador tem um pedido de entrada pendente.
-- Quem está pendente ainda não lê a tabela de equipas (RLS); esta função mostra só nomes.
create or replace function public.join_team_options()
returns table (membership_id uuid, section_id uuid, team_id uuid, team_name text)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.section_id, t.id, t.name
    from public.memberships m
    join public.teams t on t.section_id = m.section_id and t.archived_at is null
   where m.profile_id = auth.uid() and m.status = 'pendente'
   order by t.name
$$;

-- O próprio indica (ou muda) a equipa enquanto o pedido está pendente.
create or replace function public.set_requested_team(p_membership uuid, p_team uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null or v_m.profile_id is distinct from auth.uid() then
    raise exception 'Pedido não encontrado.' using errcode = '42501';
  end if;
  if v_m.status <> 'pendente' then
    raise exception 'A equipa já foi confirmada pela administração. Para mudar, fala com a administração.';
  end if;
  if p_team is not null and not exists (
    select 1 from public.teams t where t.id = p_team and t.section_id = v_m.section_id and t.archived_at is null
  ) then
    raise exception 'Equipa inválida.';
  end if;
  update public.memberships set requested_team_id = p_team, updated_at = now() where id = p_membership;
end
$$;

-- A administração altera o nome (e o totem) de um membro da sua secção. Fica no registo.
create or replace function public.admin_update_profile(p_membership uuid, p_full_name text, p_totem text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership;
  if v_m.id is null or not private.is_admin(v_m.section_id) then
    raise exception 'Inscrição não encontrada.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_full_name, ''))) = 0 then raise exception 'Indica o nome.'; end if;
  update public.profiles
     set full_name = left(trim(p_full_name), 200),
         totem = nullif(left(trim(coalesce(p_totem, '')), 120), ''),
         updated_at = now()
   where id = v_m.profile_id;
  perform private.audit(v_m.section_id, 'perfil_alterado', 'membership', p_membership::text,
    jsonb_build_object('full_name', left(trim(p_full_name), 200)));
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
