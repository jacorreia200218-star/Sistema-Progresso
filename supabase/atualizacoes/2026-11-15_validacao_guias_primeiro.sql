-- Atualização «Validação: guias primeiro» (15-11-2026) para um projeto já instalado.
-- Cola no SQL Editor e carrega em «Run» UMA vez. Não altera nem apaga registos.

-- ===== supabase/migrations/20261115000100_validacao_guias_primeiro.sql =====
-- Pioneiros — validação dos trilhos: primeiro os guias, depois os dirigentes;
-- trilho validado fica logo atribuído à etapa; contagem de pessoas por equipa nas Presenças.
--
-- 1. Guias primeiro. Quando um pioneiro pede para fechar um trilho, o pedido vai para
--    o guia da equipa (reunião de Equipa). Os dirigentes só são avisados, e só o veem
--    como pendente, depois de os guias validarem («Aguarda dirigentes»). Se a equipa
--    não tiver outro guia (pedido do próprio guia ou equipa sem guia), o pedido vai
--    diretamente para os dirigentes, como até aqui.
-- 2. Dirigente valida → fica validado e atribuído. Um dirigente pode continuar a
--    registar a validação diretamente (o trilho fica logo validado, sem segundo passo).
--    Sempre que um trilho fica validado (diretamente pelo dirigente ou quando um
--    dirigente confirma a validação dos guias) é atribuído à etapa em curso: confirma
--    a proposta pendente desse trilho ou, se a área ainda não tiver trilho nessa etapa,
--    passa a ser o trilho dessa área. Não mexe em áreas já ocupadas nem em etapas que
--    o Conselho de Guias já decidiu.
-- 3. Presenças › Resumo › Por equipa: «N pessoas» contava todos os que passaram pela
--    equipa em alguma sessão do período (quem mudou de equipa contava nas duas). Agora
--    cada pessoa conta uma só vez, na equipa da sessão mais recente do período. Os
--    indicadores continuam a ser contados na equipa em que cada pessoa estava em cada data.
-- Aditivo: não apaga nem altera registos existentes.

-- ---------------------------------------------------------------------------
-- 1. Guias primeiro
-- ---------------------------------------------------------------------------

-- Há outro guia ativo na equipa deste membro (alguém que possa decidir o pedido)?
create or replace function private.team_has_other_guia(p_membership uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
      join public.memberships g on g.team_id = m.team_id and g.id <> m.id and g.status = 'ativo' and g.function = 'guia'
     where m.id = p_membership and m.team_id is not null)
$$;
revoke all on function private.team_has_other_guia(uuid) from public, anon, authenticated;

-- Pedido à espera dos dirigentes: validado pelos guias, ou sem guia que o possa decidir.
create or replace function private.request_awaits_dirigentes(p_kind public.request_kind, p_status public.request_status, p_membership uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case
    when p_status::text = 'validado_guias' then true
    when p_status::text not in ('submetido', 'em_revisao') then false
    when p_kind <> 'normal' then true
    else not private.team_has_other_guia(p_membership) end
$$;
revoke all on function private.request_awaits_dirigentes(public.request_kind, public.request_status, uuid) from public, anon, authenticated;

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
  -- Primeiro os guias da equipa (reunião de Equipa). Os dirigentes só recebem o pedido
  -- agora se não houver outro guia que o possa decidir.
  v_guias := array(select x from unnest(private.team_guias(v_m.team_id)) x where x <> v_m.profile_id);
  if cardinality(v_guias) > 0 then
    perform private.notify(v_guias, v_m.section_id, 'pedido_submetido', 'Pedido para fechar um trilho',
      coalesce(v_who, 'Um pioneiro') || ' quer fechar «' || v_trail || '». Fica para a próxima reunião de Equipa.', '/revisoes/pedido/' || p_request);
  else
    perform private.notify(private.section_dirigentes(v_m.section_id), v_m.section_id, 'pedido_submetido', 'Pedido para fechar um trilho',
      coalesce(v_who, 'Um pioneiro') || ' quer fechar «' || v_trail || '». A equipa não tem outro guia: decide a Equipa de Animação.',
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
  v_guias := array(select x from unnest(private.team_guias(v_m.team_id)) x where x <> v_m.profile_id);
  perform private.notify(case when cardinality(v_guias) > 0 then v_guias else private.section_dirigentes(v_m.section_id) end,
    v_m.section_id, 'pedido_submetido', 'Novo pedido de validação',
    'Pedido de validação do trilho ' || v_trail || ' para a próxima reunião de Equipa.', '/revisoes/pedido/' || p_request);
end
$$;

-- Contadores do Acompanhamento: para os dirigentes, os trilhos pendentes são os que
-- os guias já validaram (ou os que não têm guia que os decida).
create or replace function public.my_pending_counts(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_me public.memberships; v_out jsonb := '{}'::jsonb; v_neg int; v_tri int; v_ant int; v_eta int;
begin
  v_me := private.my_active_membership(p_section);
  if v_me.id is null then return v_out; end if;
  if v_me.function in ('pioneiro', 'guia') then
    v_out := v_out || jsonb_build_object('pedidos', (select count(*) from public.trail_requests
      where membership_id = v_me.id and status in ('rascunho', 'devolvido')));
  end if;
  if v_me.function = 'guia' then
    v_out := v_out || jsonb_build_object('equipa', (select count(*) from public.trail_requests r
      join public.memberships m on m.id = r.membership_id
      where m.team_id = v_me.team_id and m.status = 'ativo' and m.id <> v_me.id
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
-- 2. Trilho validado → atribuído à etapa em curso
-- ---------------------------------------------------------------------------
create or replace function private.auto_place_validated_trail(p_request uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.trail_requests; v_m public.memberships; v_p public.stage_paths; v_c public.stage_choices;
  v_area text; v_id uuid;
begin
  select * into v_r from public.trail_requests where id = p_request;
  if v_r.id is null or v_r.kind <> 'normal' or v_r.status::text <> 'validado_equipa' then return null; end if;
  select * into v_m from public.memberships where id = v_r.membership_id;
  select * into v_c from public.stage_choices
   where membership_id = v_r.membership_id and trail_key = v_r.trail_key and status in ('confirmada', 'proposta')
   order by (status = 'confirmada') desc limit 1;
  if v_c.status = 'confirmada' then return null; end if; -- já está numa etapa
  select * into v_p from public.stage_paths where membership_id = v_r.membership_id and status = 'em_curso' for update;
  if v_p.id is null then return null; end if; -- sem etapa em curso: fica «sem etapa», como antes
  if exists (select 1 from public.stage_requests where stage_path_id = v_p.id and status = 'decidido_conselho') then return null; end if;
  select a.code into v_area from public.catalog_trails t join public.catalog_areas a on a.id = t.area_id where t.id = v_r.trail_id;
  if v_area is null then return null; end if;
  -- Área já com trilho confirmado nesta etapa: não se troca nada sozinho.
  if exists (select 1 from public.stage_choices where stage_path_id = v_p.id and area_code = v_area and status = 'confirmada') then
    return null;
  end if;
  if v_c.id is not null then
    -- Proposta pendente deste trilho: só se for desta etapa e não for uma troca.
    if v_c.stage_path_id <> v_p.id or v_c.replaces_choice_id is not null then return null; end if;
    update public.stage_choices set status = 'confirmada', decided_by = auth.uid(), decided_at = now(),
           decision_comment = coalesce(decision_comment, 'Trilho validado: atribuído à etapa.')
     where id = v_c.id;
    v_id := v_c.id;
  else
    -- Outra proposta pendente nesta área: decide-a a Equipa de Animação na negociação.
    if exists (select 1 from public.stage_choices where stage_path_id = v_p.id and area_code = v_area and status = 'proposta') then
      return null;
    end if;
    insert into public.stage_choices (stage_path_id, membership_id, trail_id, trail_key, area_code, status,
                                      proposed_by, decided_by, decided_at, decision_comment)
    values (v_p.id, v_r.membership_id, v_r.trail_id, v_r.trail_key, v_area, 'confirmada',
            coalesce(auth.uid(), v_m.profile_id), auth.uid(), now(), 'Trilho validado: atribuído à etapa em curso.')
    returning id into v_id;
  end if;
  perform private.audit(v_m.section_id, 'trilho_atribuido_etapa', 'stage_choice', v_id::text,
    jsonb_build_object('request', p_request, 'trail', v_r.trail_key, 'stage', v_p.stage_key));
  return v_id;
exception when unique_violation then
  return null; -- corrida com uma decisão manual: fica como a Equipa de Animação decidiu
end
$$;
revoke all on function private.auto_place_validated_trail(uuid) from public, anon, authenticated;

create or replace function private.trail_requests_auto_place()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'normal' and new.status::text = 'validado_equipa'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.auto_place_validated_trail(new.id);
  end if;
  return null;
end
$$;
revoke all on function private.trail_requests_auto_place() from public, anon, authenticated;
drop trigger if exists trail_requests_auto_place on public.trail_requests;
create trigger trail_requests_auto_place after insert or update of status on public.trail_requests
  for each row execute function private.trail_requests_auto_place();

-- ---------------------------------------------------------------------------
-- 3. Presenças: cada pessoa conta uma vez no «Por equipa»
-- ---------------------------------------------------------------------------
create or replace function public.pres_board(p_section uuid, p_from date, p_to date, p_team uuid default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'presencas');
  v_reg boolean := private.pres_can_register(p_section);
  v_me uuid := (select id from public.memberships where section_id = p_section and profile_id = auth.uid());
  v_team uuid := case when private.pres_can_register(p_section) then p_team end;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Indica um período válido.'; end if;
  if p_to - p_from > 800 then raise exception 'Escolhe um período até dois anos.'; end if;
  return (
    with c as materialized (
      select * from private.pres_cells(p_section, v_space, p_from, p_to) x
       where (v_reg or x.membership_id = v_me) and (v_team is null or x.team_id = v_team)
    ),
    ses as (
      select s.*, t.name as team_name, e.title as cal_title, e.status as cal_status
        from public.pres_sessions s
        left join public.teams t on t.id = s.team_id
        left join public.cal_events e on e.id = s.cal_event_id
       where s.section_id = p_section and s.space = v_space and s.session_date between p_from and p_to
         and (case when v_reg then (v_team is null or s.audience = 'seccao' or s.team_id = v_team)
                   else exists (select 1 from c where c.session_id = s.id) end)
    ),
    mem as (
      select m.id, m.status, m.team_id, p.full_name, t.name as team_name
        from public.memberships m
        join public.profiles p on p.id = m.profile_id
        left join public.teams t on t.id = m.team_id
       where m.section_id = p_section
         and (m.id in (select c.membership_id from c)
              or (v_reg and m.status = 'ativo' and m.function in ('pioneiro', 'guia') and (v_team is null or m.team_id = v_team)))
    )
    select jsonb_build_object(
      'can_register', v_reg,
      'today', private.pres_today(),
      'my_membership', v_me,
      'teams', case when v_reg then coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                                               from public.teams t where t.section_id = p_section and t.archived_at is null), '[]'::jsonb)
                    else '[]'::jsonb end,
      'sessions', coalesce((select jsonb_agg(jsonb_build_object(
          'id', s.id, 'date', s.session_date, 'title', s.title, 'kind', s.kind, 'audience', s.audience,
          'team_id', s.team_id, 'team_name', s.team_name, 'cal_event_id', s.cal_event_id, 'cal_title', s.cal_title,
          'status', case when s.status = 'cancelada' or s.cal_status = 'cancelado' then 'cancelada' else 'ativa' end,
          'future', s.session_date > private.pres_today(),
          'applicable', (select count(*) from c where c.session_id = s.id),
          'registered', (select count(*) from c where c.session_id = s.id and c.status is not null)
        ) order by s.session_date, s.title) from ses s), '[]'::jsonb),
      'members', coalesce((select jsonb_agg(jsonb_build_object(
          'membership_id', m.id, 'name', m.full_name, 'team_id', m.team_id, 'team_name', m.team_name,
          'active', m.status = 'ativo',
          'stats', (select private.pres_stats(
              count(*) filter (where c.category = 'presente'), count(*) filter (where c.category = 'presente' and c.partial),
              count(*) filter (where c.category = 'justificada'), count(*) filter (where c.category = 'injustificada'),
              count(*) filter (where c.category = 'por_registar'), count(*) filter (where c.category = 'futura'),
              count(*) filter (where c.category = 'cancelada'))
            from c where c.membership_id = m.id)
        ) order by m.team_name nulls last, m.full_name) from mem m), '[]'::jsonb),
      'cells', coalesce((select jsonb_agg(jsonb_build_object(
          's', c.session_id, 'm', c.membership_id, 'status', c.status, 'partial', c.partial,
          'partial_note', c.partial_note, 'has_justification', c.justification is not null, 'category', c.category))
        from c), '[]'::jsonb),
      'totals', (select private.pres_stats(
              count(*) filter (where c.category = 'presente'), count(*) filter (where c.category = 'presente' and c.partial),
              count(*) filter (where c.category = 'justificada'), count(*) filter (where c.category = 'injustificada'),
              count(*) filter (where c.category = 'por_registar'), count(*) filter (where c.category = 'futura'),
              count(*) filter (where c.category = 'cancelada')) from c),
      'by_team', case when v_reg then coalesce((select jsonb_agg(x.j order by x.team_name nulls last) from (
          select t.name as team_name, jsonb_build_object('team_id', c.team_id, 'team_name', t.name,
              -- Cada pessoa conta uma vez: na equipa da sua sessão mais recente do período.
              'members', (select count(*) from (select distinct on (c2.membership_id) c2.membership_id, c2.team_id
                                                   from c c2 order by c2.membership_id, c2.session_date desc) l
                           where l.team_id is not distinct from c.team_id),
              'stats', private.pres_stats(
                count(*) filter (where c.category = 'presente'), count(*) filter (where c.category = 'presente' and c.partial),
                count(*) filter (where c.category = 'justificada'), count(*) filter (where c.category = 'injustificada'),
                count(*) filter (where c.category = 'por_registar'), count(*) filter (where c.category = 'futura'),
                count(*) filter (where c.category = 'cancelada'))) as j
            from c left join public.teams t on t.id = c.team_id
           group by c.team_id, t.name) x), '[]'::jsonb) else '[]'::jsonb end,
      'by_month', coalesce((select jsonb_agg(x.j order by x.month) from (
          select to_char(c.session_date, 'YYYY-MM') as month, jsonb_build_object('month', to_char(c.session_date, 'YYYY-MM'),
              'sessions', count(distinct c.session_id) filter (where c.category not in ('cancelada', 'futura')),
              'stats', private.pres_stats(
                count(*) filter (where c.category = 'presente'), count(*) filter (where c.category = 'presente' and c.partial),
                count(*) filter (where c.category = 'justificada'), count(*) filter (where c.category = 'injustificada'),
                count(*) filter (where c.category = 'por_registar'), count(*) filter (where c.category = 'futura'),
                count(*) filter (where c.category = 'cancelada'))) as j
            from c group by to_char(c.session_date, 'YYYY-MM')) x), '[]'::jsonb)
    )
  );
end
$$;

notify pgrst, 'reload schema';
