-- Pioneiros — subguias também validam trilhos; Presenças pela equipa atual (15-11-2026).
--
-- 1. Quem decide na reunião de Equipa: o guia (função na app) e quem tem hoje o cargo
--    de guia ou de subguia dessa equipa (Equipas e cargos). Recebem os pedidos, veem o
--    percurso dos companheiros de equipa e registam a validação dos guias; depois segue
--    para os dirigentes, como para o guia.
-- 2. Os pedidos já enviados (à espera da reunião de Equipa) ficam agora com os guias e
--    subguias: cada um recebe um aviso com quantos tem por decidir.
-- 3. Presenças: cada pessoa aparece só na sua equipa atual (no quadro, nos filtros e no
--    resumo por equipa). As sessões de equipa continuam a contar quem estava na equipa
--    nessa data, para não esconder registos já feitos.
-- Aditivo: não apaga nem altera registos existentes.

-- ---------------------------------------------------------------------------
-- 1. Guias e subguias
-- ---------------------------------------------------------------------------

-- Membros (inscrições) que decidem pela equipa: guia ativo ou cargo de guia/subguia em vigor.
create or replace function private.team_decider_members(p_team uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct x.id), '{}') from (
    select m.id from public.memberships m
     where m.team_id = p_team and m.status = 'ativo' and m.function = 'guia'
    union
    select m.id from public.eq_appointments a
      join public.memberships m on m.id = a.membership_id
     where a.team_id = p_team and a.space = 'real' and a.role_kind in ('guia', 'subguia')
       and a.cancelled_at is null
       and a.starts_on <= private.eq_today() and (a.ends_on is null or a.ends_on > private.eq_today())
       and m.status = 'ativo' and m.team_id = p_team and m.function in ('pioneiro', 'guia')
  ) x
$$;
revoke all on function private.team_decider_members(uuid) from public, anon, authenticated;

create or replace function private.team_deciders(p_team uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(m.profile_id), '{}') from public.memberships m
   where m.id = any (private.team_decider_members(p_team))
$$;
revoke all on function private.team_deciders(uuid) from public, anon, authenticated;

-- Equipa que o utilizador atual decide (guia ou subguia), ou null.
create or replace function private.my_decider_team(p_section uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select m.team_id from public.memberships m
   where m.section_id = p_section and m.profile_id = auth.uid() and m.status = 'ativo' and m.team_id is not null
     and m.id = any (private.team_decider_members(m.team_id))
   limit 1
$$;
revoke all on function private.my_decider_team(uuid) from public, anon, authenticated;

create or replace function private.team_has_other_guia(p_membership uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
     where m.id = p_membership and m.team_id is not null
       and exists (select 1 from unnest(private.team_decider_members(m.team_id)) d where d <> m.id))
$$;

-- Para a interface: o meu papel na equipa e, por equipa, quem decide.
create or replace function public.my_team_role(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_me public.memberships := private.my_active_membership(p_section); v_team uuid;
begin
  if v_me.id is null then return null; end if;
  v_team := private.my_decider_team(p_section);
  return jsonb_build_object(
    'decider_team', v_team,
    'role', case when v_team is null then null when v_me.function = 'guia' then 'guia' else 'subguia' end,
    'deciders', case when v_me.function = 'dirigente' or v_team is not null then coalesce((
      select jsonb_agg(jsonb_build_object('team_id', t.id, 'membership_id', d))
        from public.teams t cross join lateral unnest(private.team_decider_members(t.id)) d
       where t.section_id = p_section and t.archived_at is null), '[]'::jsonb) else '[]'::jsonb end);
end
$$;
revoke execute on function public.my_team_role(uuid) from public, anon;
grant execute on function public.my_team_role(uuid) to authenticated;

-- Quem regista a decisão da reunião de Equipa: guia ou subguia da equipa, ou um dirigente.
create or replace function private.team_recorder_role(v_r public.trail_requests)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v_m public.memberships; v_me public.memberships;
begin
  select * into v_m from public.memberships where id = v_r.membership_id;
  v_me := private.my_active_membership(v_m.section_id);
  if v_me.id is null then return null; end if;
  if v_me.id = v_m.id then return null; end if; -- ninguém decide o próprio pedido
  if v_me.function = 'dirigente' then return 'dirigente'; end if;
  if v_m.status = 'ativo' and v_m.team_id is not null and v_me.team_id = v_m.team_id
     and v_me.id = any (private.team_decider_members(v_m.team_id)) then return 'guia'; end if;
  return null;
end
$$;

-- Ver o percurso: também o subguia (ou quem tem o cargo de guia) da equipa atual do membro.
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
        or (me.team_id is not null and me.team_id = target.team_id and target.status = 'ativo'
            and me.id = any (private.team_decider_members(me.team_id)))
      )
  )
$$;

create or replace function public.submit_trail_validation(
  p_request uuid, p_expected_version integer, p_justification text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_v public.trail_request_versions; v_m public.memberships; v_trail text; v_who text; v_guias uuid[];
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.kind <> 'normal' then raise exception 'Este pedido não é um pedido de validação de trilho.'; end if;
  if v_r.status <> 'rascunho' then raise exception 'Este pedido já foi enviado. Atualiza a página.'; end if;
  if p_expected_version is distinct from v_r.current_version then raise exception 'O pedido mudou entretanto. Atualiza a página.'; end if;
  perform private.require_text(p_justification, 'Explica como demonstraste que alcançaste este trilho.');
  if length(p_justification) > 10000 then raise exception 'A justificação é demasiado longa.'; end if;

  select * into v_v from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  delete from public.request_objectives where version_id = v_v.id and decision is null;
  update public.trail_request_versions
     set evidence = trim(p_justification), submitted_at = now(), updated_at = now()
   where id = v_v.id;
  update public.trail_requests set status = 'submetido', updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  select split_part(full_name, ' ', 1) into v_who from public.profiles where id = v_m.profile_id;
  -- Primeiro os guias e subguias da equipa (reunião de Equipa); sem eles, os dirigentes.
  v_guias := array(select x from unnest(private.team_deciders(v_m.team_id)) x where x <> v_m.profile_id);
  if cardinality(v_guias) > 0 then
    perform private.notify(v_guias, v_m.section_id, 'pedido_submetido', 'Pedido para fechar um trilho',
      coalesce(v_who, 'Um pioneiro') || ' quer fechar «' || v_trail || '». Fica para a próxima reunião de Equipa.', '/revisoes/pedido/' || p_request);
  else
    perform private.notify(private.section_dirigentes(v_m.section_id), v_m.section_id, 'pedido_submetido', 'Pedido para fechar um trilho',
      coalesce(v_who, 'Um pioneiro') || ' quer fechar «' || v_trail || '». A equipa não tem guia nem subguia: decide a Equipa de Animação.',
      '/revisoes/pedido/' || p_request);
  end if;
end
$$;

create or replace function public.submit_trail_request(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_v public.trail_request_versions; v_m public.memberships; v_trail text; v_guias uuid[];
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.kind = 'historico' then
    raise exception 'O progresso anterior é registado pelos dirigentes. Fala com a Equipa de Animação.';
  end if;
  if v_r.status <> 'rascunho' then raise exception 'Este pedido não está em rascunho.'; end if;
  select * into v_v from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  if length(trim(v_v.reflection)) = 0 and length(trim(v_v.evidence)) = 0 then
    raise exception 'Escreve a tua reflexão antes de submeter.';
  end if;
  if v_v.period_end > current_date + 1 then raise exception 'As datas das vivências não podem ser futuras.'; end if;
  delete from public.request_objectives where version_id = v_v.id and decision is null;
  update public.trail_request_versions set submitted_at = now() where id = v_v.id;
  update public.trail_requests set status = 'submetido', updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  v_guias := array(select x from unnest(private.team_deciders(v_m.team_id)) x where x <> v_m.profile_id);
  perform private.notify(case when cardinality(v_guias) > 0 then v_guias else private.section_dirigentes(v_m.section_id) end,
    v_m.section_id, 'pedido_submetido', 'Novo pedido de validação',
    'Pedido de validação do trilho ' || v_trail || ' para a próxima reunião de Equipa.', '/revisoes/pedido/' || p_request);
end
$$;

-- Contador «Equipa» também para o subguia.
create or replace function public.my_pending_counts(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_me public.memberships; v_out jsonb := '{}'::jsonb; v_neg int; v_tri int; v_ant int; v_eta int; v_team uuid;
begin
  v_me := private.my_active_membership(p_section);
  if v_me.id is null then return v_out; end if;
  if v_me.function in ('pioneiro', 'guia') then
    v_out := v_out || jsonb_build_object('pedidos', (select count(*) from public.trail_requests
      where membership_id = v_me.id and status in ('rascunho', 'devolvido')));
  end if;
  v_team := private.my_decider_team(p_section);
  if v_team is not null then
    v_out := v_out || jsonb_build_object('equipa', (select count(*) from public.trail_requests r
      join public.memberships m on m.id = r.membership_id
      where m.team_id = v_team and m.status = 'ativo' and m.id <> v_me.id
        and r.kind = 'normal' and r.status in ('submetido', 'em_revisao')));
  end if;
  if v_me.function = 'dirigente' then
    select count(*) into v_neg from public.stage_choices c join public.memberships m on m.id = c.membership_id
     where m.section_id = p_section and m.status = 'ativo' and m.function in ('pioneiro', 'guia') and c.status = 'proposta';
    select count(*) filter (where r.kind = 'normal'), count(*) filter (where r.kind = 'historico') into v_tri, v_ant
      from public.trail_requests r join public.memberships m on m.id = r.membership_id
     where r.section_id = p_section and m.status = 'ativo' and m.function in ('pioneiro', 'guia')
       and r.status::text in ('submetido', 'em_revisao', 'validado_guias')
       and private.request_awaits_dirigentes(r.kind, r.status, r.membership_id);
    select count(*) into v_eta from public.stage_requests s join public.memberships m on m.id = s.membership_id
     where m.section_id = p_section and m.status = 'ativo' and m.function in ('pioneiro', 'guia')
       and s.status in ('submetido', 'decidido_conselho');
    v_out := v_out || jsonb_build_object('acompanhamento', v_neg + v_tri + v_ant + v_eta,
      'negociacao', v_neg, 'trilhos', v_tri, 'anterior', v_ant, 'etapas', v_eta);
  end if;
  if v_me.is_admin then
    v_out := v_out || jsonb_build_object('gestao', (select count(*) from public.memberships
      where section_id = p_section and status = 'pendente'));
  end if;
  return v_out;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Pedidos já enviados: aviso aos guias e subguias
-- ---------------------------------------------------------------------------
do $$
declare v record;
begin
  for v in
    select d.profile_id, m.section_id, count(*) as n
      from public.trail_requests r
      join public.memberships m on m.id = r.membership_id
      cross join lateral unnest(private.team_deciders(m.team_id)) d(profile_id)
     where r.kind = 'normal' and r.status in ('submetido', 'em_revisao') and m.status = 'ativo'
       and d.profile_id <> m.profile_id
     group by d.profile_id, m.section_id
  loop
    perform private.notify(array[v.profile_id], v.section_id, 'pedido_submetido', 'Trilhos para a reunião de Equipa',
      case when v.n = 1 then 'Há 1 pedido para fechar um trilho à espera da reunião de Equipa.'
           else 'Há ' || v.n || ' pedidos para fechar trilhos à espera da reunião de Equipa.' end
        || ' Depois de os validarem, seguem para os dirigentes.', '/equipa');
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Presenças pela equipa atual
-- ---------------------------------------------------------------------------
create or replace function private.pres_applicable(p_section uuid, p_space text, p_from date, p_to date)
returns table (session_id uuid, session_date date, membership_id uuid, team_id uuid)
language sql stable security definer set search_path = ''
as $$
  -- Equipa atual (quem mudou de equipa aparece só na nova); a equipa à data decide o público.
  select s.id, s.session_date, m.id, coalesce(m.team_id, x.team_id)
    from public.pres_sessions s
    join public.memberships m on m.section_id = s.section_id
    left join public.adhesions a on a.membership_id = m.id
    left join lateral (
      select h.new_status, h.new_function, h.new_team_id
        from public.membership_history h
       where h.membership_id = m.id and (h.changed_at at time zone 'Europe/Lisbon')::date <= s.session_date
       order by h.changed_at desc, h.id desc
       limit 1
    ) hs on true
    cross join lateral (
      select
        case when hs.new_status = 'ativo' then hs.new_team_id
             when hs.new_status is null or hs.new_status = 'pendente' then m.team_id end as team_id,
        coalesce(hs.new_function, m.function) as func,
        case
          when hs.new_status = 'ativo' then true
          when hs.new_status in ('saiu', 'suspenso') then false
          -- Adesão registada antes de a entrada constar na aplicação.
          when a.decided_on is not null and a.decided_on <= s.session_date
               and not exists (select 1 from public.membership_history h2
                                where h2.membership_id = m.id and h2.new_status in ('saiu', 'suspenso')
                                  and (h2.changed_at at time zone 'Europe/Lisbon')::date <= s.session_date) then true
          -- Sem histórico (registos antigos): estado atual e data de aprovação.
          when hs.new_status is null and m.status = 'ativo'
               and not exists (select 1 from public.membership_history h3 where h3.membership_id = m.id)
               and (coalesce(m.approved_at, m.requested_at) at time zone 'Europe/Lisbon')::date <= s.session_date then true
          else false end as active
    ) x
   where s.section_id = p_section and s.space = p_space
     and s.session_date between p_from and p_to
     and x.active and x.func in ('pioneiro', 'guia')
     and (s.audience = 'seccao' or x.team_id = s.team_id)
$$;

notify pgrst, 'reload schema';
