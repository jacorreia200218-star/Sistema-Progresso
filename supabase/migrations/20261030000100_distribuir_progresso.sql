-- Pioneiros — distribuir pelas etapas os trilhos já validados (progresso anterior).
--
-- Quem chega com muitos trilhos validados (progresso anterior ou reconhecidos na
-- negociação, p. 10) ficava no Conhecimento com tudo «sem etapa», e o dirigente tinha
-- de propor e confirmar trilho a trilho. Esta função, só para dirigentes, faz isso
-- de uma vez:
--   • na etapa em curso, cada área sem trilho confirmado (nem proposta pendente)
--     recebe um trilho validado dessa área que ainda não está em nenhuma etapa;
--   • se a etapa fica com as 6 áreas validadas, é declarada concluída como etapa
--     anterior (como declare_historical_stage) e a seguinte abre sozinha;
--   • repete até não haver trilhos para completar uma etapa. Os que sobram ficam
--     na etapa em curso.
-- Não toca numa etapa que o Conselho de Guias já decidiu (falta a opinião final).
-- Aditivo: não apaga registos.

-- As escolhas criadas aqui não levam a etapa ao Conselho (é declarada logo).
create or replace function private.stage_choices_auto_stage()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(current_setting('pioneiros.distribuir', true), '') = '1' then return null; end if;
  if new.status = 'confirmada' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.auto_request_stage(new.membership_id);
  end if;
  return null;
end
$$;
revoke all on function private.stage_choices_auto_stage() from public, anon, authenticated;

create or replace function public.place_previous_progress(p_membership uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_m public.memberships;
  v_ad public.adhesions;
  v_p public.stage_paths;
  v_area record;
  v_t public.catalog_trails;
  v_stage text;
  v_done text[] := '{}';
  v_assigned integer := 0;
begin
  v_m := private.progress_member(p_membership);
  perform private.assert_dirigente(v_m.section_id);
  select * into v_ad from public.adhesions where membership_id = p_membership;
  if v_ad.decided_on is null or v_ad.commitment_on is null then
    raise exception 'Regista primeiro a adesão e a Promessa/Investidura.';
  end if;
  perform private.auto_open_next_stage(p_membership);
  perform set_config('pioneiros.distribuir', '1', true);
  loop
    select * into v_p from public.stage_paths where membership_id = p_membership and status = 'em_curso' for update;
    exit when v_p.id is null;
    exit when exists (select 1 from public.stage_requests where stage_path_id = v_p.id and status = 'decidido_conselho');
    for v_area in
      select a.id, a.code from public.catalog_areas a join public.catalog_stages cs on cs.version_id = a.version_id
       where cs.id = v_p.stage_id
         and not exists (select 1 from public.stage_choices c where c.stage_path_id = v_p.id and c.area_code = a.code
                           and c.status in ('confirmada', 'proposta'))
       order by a.position
    loop
      select t.* into v_t from public.catalog_trails t
       where t.area_id = v_area.id
         and t.key in (select private.validated_trail_keys(p_membership))
         and not exists (select 1 from public.stage_choices c where c.membership_id = p_membership and c.trail_key = t.key
                           and c.status in ('confirmada', 'proposta'))
       order by t.position limit 1;
      continue when v_t.id is null;
      insert into public.stage_choices (stage_path_id, membership_id, trail_id, trail_key, area_code, status,
                                        proposed_by, decided_by, decided_at, decision_comment)
      values (v_p.id, p_membership, v_t.id, v_t.key, v_area.code, 'confirmada',
              auth.uid(), auth.uid(), now(), 'Trilho já validado, distribuído pela Equipa de Animação.');
      v_assigned := v_assigned + 1;
    end loop;
    exit when not coalesce(private.stage_ready(v_p.id), false);
    select name into v_stage from public.catalog_stages where id = v_p.stage_id;
    perform public.declare_historical_stage(v_p.id, current_date,
      'Etapa concluída com trilhos já validados (progresso anterior), distribuídos pela Equipa de Animação.');
    v_done := v_done || v_stage;
  end loop;
  perform set_config('pioneiros.distribuir', '', true);
  perform private.auto_request_stage(p_membership);
  perform private.audit(v_m.section_id, 'progresso_distribuido', 'membership', p_membership::text,
    jsonb_build_object('concluidas', v_done, 'atribuidos', v_assigned));
  select cs.name into v_stage from public.stage_paths sp join public.catalog_stages cs on cs.id = sp.stage_id
   where sp.membership_id = p_membership and sp.status = 'em_curso';
  if v_assigned > 0 then
    perform private.notify(array[v_m.profile_id], v_m.section_id, 'etapa_aberta', 'Trilhos distribuídos pelas etapas',
      case when cardinality(v_done) > 0 then 'Concluídas: ' || array_to_string(v_done, ', ') || '. ' else '' end
      || coalesce('Estás na etapa ' || v_stage || '.', 'Todas as etapas estão concluídas.'), '/caminho');
  end if;
  return jsonb_build_object('concluidas', to_jsonb(v_done), 'atribuidos', v_assigned, 'etapa', v_stage);
end
$$;
