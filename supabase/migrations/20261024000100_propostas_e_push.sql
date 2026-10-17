-- Pioneiros — propostas de trilho mais claras para os dirigentes e
-- diagnóstico do envio de notificações push por dispositivo.
-- • A notificação de uma proposta diz quem quer fechar que trilho e em que
--   etapa, e abre diretamente o registo da proposta.
-- • Cada subscrição guarda a data do último envio aceite pelo serviço de push
--   e o último erro, para se saber se um aviso saiu do servidor.
-- Aditivo: não apaga nem altera registos existentes.

alter table public.push_subscriptions add column if not exists last_error text;

-- Envios aceites (last_used_at) e falhas (last_error) por subscrição. Só a função /api/push.
create or replace function public.push_mark_results(p_sent text[], p_failed jsonb default '[]'::jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_service_role() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update public.push_subscriptions set last_used_at = now(), last_error = null where endpoint = any (coalesce(p_sent, '{}'));
  update public.push_subscriptions s set last_error = left(f ->> 'error', 300)
    from jsonb_array_elements(coalesce(p_failed, '[]'::jsonb)) f where s.endpoint = f ->> 'endpoint';
end
$$;

-- Estado deste dispositivo para o próprio (Perfil).
create or replace function public.my_push_device(p_endpoint text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('last_sent_at', last_used_at, 'last_error', last_error)
    from public.push_subscriptions where endpoint = p_endpoint and profile_id = auth.uid()
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
      case when p_replaces is null then 'Proposta para fechar um trilho' else 'Proposta de troca de trilho' end,
      coalesce(v_who, 'Um pioneiro') || ' quer fechar «' || v_t.name || '» (' || v_area_name || ') na etapa ' || coalesce(v_stage, '') || '.',
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

-- Permissões só das funções desta migração (não mexe nas restantes).
revoke execute on function public.push_mark_results(text[], jsonb) from public, anon, authenticated;
grant execute on function public.push_mark_results(text[], jsonb) to service_role;
revoke execute on function public.my_push_device(text) from public, anon;
grant execute on function public.my_push_device(text) to authenticated;
revoke execute on function public.propose_choice(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.propose_choice(uuid, uuid, text, uuid) to authenticated;
notify pgrst, 'reload schema';
