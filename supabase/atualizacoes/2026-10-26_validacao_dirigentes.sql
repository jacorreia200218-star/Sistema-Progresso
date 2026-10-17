-- Atualização «Validação em dois passos e contador de pedidos» (17/10/2026) para um projeto já instalado.
-- Cola no SQL Editor e carrega em «Run» UMA vez. Não apaga nem converte registos: os trilhos já validados ficam validados.
-- Depois disto, um trilho validado pelos guias só conta quando um dirigente confirma.

-- ===== supabase/migrations/20261026000100_validacao_dirigentes.sql =====
-- Pioneiros — validação do trilho em dois passos e contadores certos.
--
-- 1. A reunião de Equipa (guias) valida primeiro: o pedido fica «validado_guias»
--    (aguarda os dirigentes) e o trilho AINDA NÃO conta como validado. Um
--    dirigente confirma (→ «validado_equipa», o estado final de sempre) ou
--    devolve com fundamentação (→ «devolvido»). Quando é um dirigente a
--    registar a decisão da Equipa (pedido do próprio guia, equipa sem guia),
--    a validação fica logo concluída.
--    Os trilhos já validados ficam como estão.
-- 2. my_pending_counts conta só pedidos de pioneiros e guias, como a lista
--    do Acompanhamento (antes contava também pedidos de outros membros, que
--    a lista não mostra: aparecia «2» com a lista vazia).
-- Aditivo: não apaga nem converte registos.
--
-- O valor novo do enum é criado aqui e só é usado dentro de funções (em
-- tempo de execução), por isso o ficheiro pode correr numa só transação.

alter type public.request_status add value if not exists 'validado_guias';
alter type public.decision_kind add value if not exists 'validado_guias';

-- Um pedido «validado_guias» continua ativo (não se abre outro para o mesmo
-- trilho). A condição compara o nome do estado (texto) para não usar valores
-- novos do enum na mesma transação (instalação completa ou SQL Editor).
create or replace function private.request_is_active(p_status public.request_status)
returns boolean language plpgsql immutable set search_path = ''
as $$ begin return p_status::text not in ('recusado', 'cancelado', 'objetivos_validados'); end $$;
drop index if exists public.trail_requests_one_active;
create unique index trail_requests_one_active on public.trail_requests (membership_id, trail_key)
  where private.request_is_active(status);

-- Decisão da reunião de Equipa sobre o trilho completo.
create or replace function public.record_team_decision(
  p_request uuid, p_expected_version integer, p_validated boolean, p_meeting_date date, p_comment text,
  p_objective_codes text[] default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.trail_requests; v_role text; v_version uuid; v_m public.memberships; v_trail text; v_codes text[]; v_bad integer;
  v_owner_guias uuid[]; v_status text; v_kind text;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  if v_r.kind <> 'normal' then raise exception 'Pedidos de progresso anterior são decididos pelos dirigentes.'; end if;
  v_role := private.team_recorder_role(v_r);
  if v_role is null then
    raise exception 'Sem permissão para registar a decisão deste pedido (não é possível decidir o próprio pedido).' using errcode = '42501';
  end if;
  if v_r.status not in ('submetido', 'em_revisao') then raise exception 'Este pedido já foi decidido ou não está submetido.'; end if;
  if p_expected_version is distinct from v_r.current_version then raise exception 'O pedido mudou entretanto. Atualiza a página.'; end if;
  if p_meeting_date is null or p_meeting_date > current_date then raise exception 'Indica a data da reunião de Equipa.'; end if;
  if not coalesce(p_validated, false) then perform private.require_text(p_comment, 'Explica o que falta demonstrar.'); end if;
  if p_comment is not null and length(p_comment) > 4000 then raise exception 'Comentário demasiado longo.'; end if;

  select array_agg(distinct c order by c) into v_codes from unnest(coalesce(p_objective_codes, '{}')) c where nullif(trim(c), '') is not null;
  if v_codes is not null then
    if p_validated then raise exception 'Só uma devolução indica objetivos por demonstrar.'; end if;
    select count(*) into v_bad from unnest(v_codes) c
     where not exists (select 1 from public.catalog_objectives o where o.trail_id = v_r.trail_id and o.code = c);
    if v_bad > 0 then raise exception 'Há objetivos que não pertencem a este trilho.'; end if;
  end if;

  -- Validado por um guia → aguarda os dirigentes; registado por um dirigente → validado.
  if not p_validated then v_status := 'devolvido'; v_kind := 'devolvido_equipa';
  elsif v_role = 'guia' then v_status := 'validado_guias'; v_kind := 'validado_guias';
  else v_status := 'validado_equipa'; v_kind := 'validado_equipa';
  end if;

  perform 1 from public.memberships where id = v_r.membership_id for update;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, objective_codes, recorded_by, recorded_as)
  values (p_request, v_version, v_kind::public.decision_kind, p_meeting_date, nullif(trim(p_comment), ''), v_codes, auth.uid(), v_role);
  update public.trail_requests set status = v_status::public.request_status, updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'decisao_equipa',
    case v_status when 'validado_equipa' then 'Trilho validado'
                  when 'validado_guias' then 'Trilho validado pelos guias'
                  else 'Trilho a rever' end,
    v_trail || case when v_status = 'validado_guias' then ' · falta a confirmação dos dirigentes' else '' end
      || coalesce(' · por demonstrar: ' || array_to_string(v_codes, ', '), '') || coalesce(': ' || nullif(trim(p_comment), ''), ''),
    '/pedidos/' || p_request);
  if v_status = 'validado_guias' then
    perform private.notify(array(select x from unnest(private.section_dirigentes(v_m.section_id)) x where x is distinct from v_m.profile_id),
      v_m.section_id, 'validacao_guias', 'Trilho para confirmar',
      v_trail || ' · validado pelos guias na reunião de Equipa.', '/revisoes/pedido/' || p_request);
  else
    perform private.notify(array(select x from unnest(private.section_dirigentes(v_m.section_id) || private.section_guias(v_m.section_id)) x
                                 where x is distinct from v_m.profile_id),
      v_m.section_id, 'comunicacao_conselho', 'Comunicação ao Conselho de Guias',
      'Decisão da reunião de Equipa sobre o trilho ' || v_trail || '.', '/conselho');
  end if;
  if v_role = 'dirigente' then
    v_owner_guias := array(select x from unnest(private.team_guias(v_m.team_id)) x where x is distinct from v_m.profile_id);
    perform private.notify(v_owner_guias, v_m.section_id, 'registo_animacao', 'Decisão registada pela Equipa de Animação',
      'Foi registada, em nome da reunião de Equipa, a decisão sobre o trilho ' || v_trail || '.', '/revisoes/pedido/' || p_request);
  end if;
exception when unique_violation then
  raise exception 'Já foi registada uma decisão para esta versão do pedido.';
end
$$;

-- Segundo passo: um dirigente confirma a validação dos guias.
create or replace function public.confirm_trail_validation(p_request uuid, p_comment text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_m public.memberships; v_version uuid; v_trail text;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_r.section_id);
  if private.is_owner(v_r.membership_id) then raise exception 'Não é possível decidir o próprio pedido.' using errcode = '42501'; end if;
  if v_r.status::text <> 'validado_guias' then raise exception 'Este pedido não está à espera da confirmação dos dirigentes.'; end if;
  if p_comment is not null and length(p_comment) > 4000 then raise exception 'Comentário demasiado longo.'; end if;

  perform 1 from public.memberships where id = v_r.membership_id for update;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, recorded_by, recorded_as)
  values (p_request, v_version, 'validado_equipa', current_date, nullif(trim(p_comment), ''), auth.uid(), 'dirigente');
  update public.trail_requests set status = 'validado_equipa', updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'decisao_equipa', 'Trilho validado',
    v_trail || ' · confirmado pelos dirigentes' || coalesce(': ' || nullif(trim(p_comment), ''), ''), '/pedidos/' || p_request);
  perform private.notify(array(select x from unnest(private.section_dirigentes(v_m.section_id) || private.section_guias(v_m.section_id)) x
                               where x is distinct from v_m.profile_id),
    v_m.section_id, 'comunicacao_conselho', 'Comunicação ao Conselho de Guias',
    'Trilho ' || v_trail || ' validado pelos guias e confirmado pelos dirigentes.', '/conselho');
exception when unique_violation then
  raise exception 'Já foi registada uma decisão para esta versão do pedido.';
end
$$;

-- Devolução fundamentada pelos dirigentes: antes de confirmarem (validado
-- pelos guias) ou depois (validado), como até aqui.
create or replace function public.record_council_return(p_request uuid, p_meeting_date date, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_m public.memberships; v_version uuid;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_r.section_id);
  if private.is_owner(v_r.membership_id) then raise exception 'Não é possível decidir o próprio pedido.' using errcode = '42501'; end if;
  if v_r.status::text not in ('validado_equipa', 'validado_guias') then
    raise exception 'Só trilhos validados na Equipa podem ser devolvidos pelos dirigentes.';
  end if;
  perform private.require_text(p_comment, 'A devolução tem de ser fundamentada.');
  if p_meeting_date is null or p_meeting_date > current_date then raise exception 'Indica a data do Conselho de Guias.'; end if;
  -- Regra local L3: não reabrir trilhos de etapas concluídas.
  if exists (select 1 from public.stage_choices c join public.stage_paths p on p.id = c.stage_path_id
              where c.membership_id = v_r.membership_id and c.trail_key = v_r.trail_key
                and c.status = 'confirmada' and p.status = 'concluida') then
    raise exception 'Este trilho faz parte de uma etapa já concluída.';
  end if;
  if exists (select 1 from public.stage_choices c join public.stage_requests sr on sr.stage_path_id = c.stage_path_id
              where c.membership_id = v_r.membership_id and c.trail_key = v_r.trail_key and c.status = 'confirmada'
                and sr.status in ('submetido', 'decidido_conselho')) then
    raise exception 'A etapa deste trilho está em validação. Regista a decisão da etapa primeiro.';
  end if;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, recorded_by, recorded_as)
  values (p_request, v_version, 'devolvido_conselho', p_meeting_date, trim(p_comment), auth.uid(), 'dirigente');
  update public.trail_requests set status = 'devolvido', updated_at = now() where id = p_request;
  select * into v_m from public.memberships where id = v_r.membership_id;
  perform private.notify(array[v_m.profile_id] || private.team_guias(v_m.team_id), v_m.section_id, 'devolucao_conselho',
    'Trilho devolvido pelos dirigentes', trim(p_comment), '/pedidos/' || p_request);
end
$$;

-- Contadores do Acompanhamento: os mesmos pedidos que a lista mostra
-- (membros ativos que são pioneiros ou guias). Para os dirigentes, os trilhos
-- validados pelos guias também estão pendentes (falta a confirmação).
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
       and r.status::text in ('submetido', 'em_revisao', 'validado_guias');
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

revoke execute on function public.confirm_trail_validation(uuid, text) from public, anon;
grant execute on function public.confirm_trail_validation(uuid, text) to authenticated;
notify pgrst, 'reload schema';
