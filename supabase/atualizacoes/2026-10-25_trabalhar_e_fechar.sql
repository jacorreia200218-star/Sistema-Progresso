-- Atualização «Trabalhar e fechar trilhos» (17/10/2026). Cola no SQL Editor e carrega em «Run» UMA vez. Não apaga nem altera registos.

-- Pioneiros — «trabalhar» e «fechar» um trilho ficam separados e claros.
-- • Propor trabalhar num trilho (escolha para a etapa): os dirigentes recebem
--   «X quer trabalhar em «trilho»» com ligação à proposta.
-- • Pedir para fechar um trilho (pedido de validação): além do guia da equipa,
--   os dirigentes recebem «X quer fechar «trilho»».
-- • O progresso anterior passa a ser registado só pelos dirigentes (reconhecimento
--   na negociação). Os pioneiros deixam de criar pedidos de progresso anterior;
--   os pedidos já existentes continuam a ser decididos como antes.
-- Não apaga nem altera registos existentes.

create or replace function public.create_trail_request(p_membership uuid, p_trail uuid, p_kind public.request_kind)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships; v_t public.catalog_trails; v_id uuid;
begin
  v_m := private.progress_member(p_membership);
  if not private.is_owner(v_m.id) then raise exception 'Só o próprio pode criar pedidos.' using errcode = '42501'; end if;
  if p_kind::text <> 'normal' then
    raise exception 'O progresso anterior é registado pelos dirigentes. Fala com a Equipa de Animação.';
  end if;
  v_t := private.section_trail(v_m.section_id, p_trail);
  insert into public.trail_requests (membership_id, section_id, trail_id, trail_key, kind, created_by)
  values (v_m.id, v_m.section_id, v_t.id, v_t.key, p_kind, auth.uid())
  returning id into v_id;
  insert into public.trail_request_versions (request_id, version_no) values (v_id, 1);
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um pedido ativo ou uma validação para este trilho.';
end
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
  -- Seleções por objetivo ainda sem decisão nesta versão (modelo anterior) não
  -- são decisões: o pedido passa a abranger o trilho completo.
  delete from public.request_objectives where version_id = v_v.id and decision is null;
  update public.trail_request_versions
     set evidence = trim(p_justification), submitted_at = now(), updated_at = now()
   where id = v_v.id;
  update public.trail_requests set status = 'submetido', updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  select split_part(full_name, ' ', 1) into v_who from public.profiles where id = v_m.profile_id;
  -- Guia da equipa (prepara a reunião de Equipa) e dirigentes (sabem o que cada um quer fechar).
  v_guias := array(select x from unnest(private.team_guias(v_m.team_id)) x where x <> v_m.profile_id);
  perform private.notify(v_guias, v_m.section_id, 'pedido_submetido', 'Pedido para fechar um trilho',
    coalesce(v_who, 'Um pioneiro') || ' quer fechar «' || v_trail || '». Fica para a próxima reunião de Equipa.', '/revisoes/pedido/' || p_request);
  perform private.notify(array(select x from unnest(private.section_dirigentes(v_m.section_id)) x where x <> all (v_guias)),
    v_m.section_id, 'pedido_submetido', 'Pedido para fechar um trilho',
    coalesce(v_who, 'Um pioneiro') || ' quer fechar «' || v_trail || '».', '/revisoes/pedido/' || p_request);
end
$$;

create or replace function public.propose_choice(p_stage_path uuid, p_trail uuid, p_planned text, p_replaces uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.stage_paths;
  v_m public.memberships;
  v_t public.catalog_trails;
  v_area text;
  v_area_name text;
  v_stage text;
  v_who text;
  v_old public.stage_choices;
  v_id uuid;
begin
  select * into v_p from public.stage_paths where id = p_stage_path for update;
  if v_p.id is null then raise exception 'Etapa não encontrada.' using errcode = '42501'; end if;
  v_m := private.progress_member(v_p.membership_id);
  if not (private.is_owner(v_m.id) or private.is_dirigente(v_m.section_id)) then
    raise exception 'Sem permissão para propor escolhas neste percurso.' using errcode = '42501';
  end if;
  if v_p.status <> 'em_curso' then raise exception 'A etapa já está concluída.'; end if;
  if exists (select 1 from public.stage_requests where stage_path_id = v_p.id and status in ('submetido', 'decidido_conselho')) then
    raise exception 'A etapa está em validação; não é possível alterar escolhas agora.';
  end if;
  select t.* into v_t from public.catalog_trails t join public.catalog_stages cs on cs.version_id = t.version_id
   where t.id = p_trail and cs.id = v_p.stage_id;
  if v_t.id is null then raise exception 'Trilho inválido para esta etapa.'; end if;
  select code, name into v_area, v_area_name from public.catalog_areas where id = v_t.area_id;

  if p_replaces is not null then
    select * into v_old from public.stage_choices where id = p_replaces and stage_path_id = v_p.id;
    if v_old.id is null or v_old.status <> 'confirmada' then raise exception 'A escolha a substituir não está confirmada nesta etapa.'; end if;
    if v_old.area_code <> v_area then raise exception 'A troca tem de ser por um trilho da mesma área.'; end if;
  elsif exists (select 1 from public.stage_choices where stage_path_id = v_p.id and area_code = v_area and status = 'confirmada') then
    raise exception 'Já existe um trilho confirmado nesta área. Propõe uma troca.';
  end if;

  if exists (
    select 1 from public.stage_choices c join public.stage_paths sp on sp.id = c.stage_path_id
     where c.membership_id = v_m.id and c.trail_key = v_t.key and c.status = 'confirmada' and sp.id <> v_p.id
  ) then
    raise exception 'Este trilho já está atribuído a outra etapa.';
  end if;

  insert into public.stage_choices (stage_path_id, membership_id, trail_id, trail_key, area_code, planned_opportunities, replaces_choice_id, proposed_by)
  values (v_p.id, v_m.id, v_t.id, v_t.key, v_area, nullif(trim(p_planned), ''), p_replaces, auth.uid())
  returning id into v_id;

  select name into v_stage from public.catalog_stages where id = v_p.stage_id;
  if private.is_owner(v_m.id) then
    select split_part(full_name, ' ', 1) into v_who from public.profiles where id = v_m.profile_id;
    perform private.notify(private.section_dirigentes(v_m.section_id), v_m.section_id, 'escolha_proposta',
      case when p_replaces is null then 'Proposta para trabalhar num trilho' else 'Proposta de troca de trilho' end,
      coalesce(v_who, 'Um pioneiro') || ' quer trabalhar em «' || v_t.name || '» (' || v_area_name || ') na etapa ' || coalesce(v_stage, '') || '.',
      '/acompanhamento/proposta/' || v_id);
  else
    perform private.notify(array[v_m.profile_id], v_m.section_id, 'escolha_proposta',
      'Proposta de trilho', 'A Equipa de Animação propôs «' || v_t.name || '» para a tua etapa ' || coalesce(v_stage, '') || '.',
      '/meu-progresso/trilho/' || v_t.key);
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Este trilho já está escolhido ou proposto, ou já existe uma proposta pendente nesta área.';
end
$$;

revoke execute on function public.create_trail_request(uuid, uuid, public.request_kind) from public, anon;
grant execute on function public.create_trail_request(uuid, uuid, public.request_kind) to authenticated;
revoke execute on function public.submit_trail_validation(uuid, integer, text) from public, anon;
grant execute on function public.submit_trail_validation(uuid, integer, text) to authenticated;
revoke execute on function public.propose_choice(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.propose_choice(uuid, uuid, text, uuid) to authenticated;
notify pgrst, 'reload schema';
