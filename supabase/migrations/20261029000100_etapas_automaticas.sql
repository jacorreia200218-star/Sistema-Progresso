-- Pioneiros — etapas que avançam sozinhas (manual, pp. 9–12).
--
-- O que é administrativo passa a ser automático. As decisões pedagógicas continuam
-- a ser registadas por pessoas.
--
-- 1. Abertura das etapas. A 1.ª etapa (Conhecimento) começa depois da Promessa (p. 10)
--    e cada etapa seguinte começa quando a anterior fica concluída (p. 9). A etapa
--    abre sozinha quando se regista a Promessa e quando a opinião final da Equipa de
--    Animação (ou a declaração de etapa anterior) conclui a etapa em curso. A data da
--    insígnia fica por registar, como antes. open_stage continua a funcionar: se a
--    etapa já estiver aberta, devolve-a (e regista a insígnia, se vier).
-- 2. Pedido ao Conselho de Guias. Quando a etapa em curso fica com um trilho
--    confirmado e validado em cada área (os dois passos: guias + dirigente), o pedido
--    de validação da etapa é criado sozinho. O Conselho de Guias decide e a Equipa de
--    Animação dá a opinião final, como antes: 6 trilhos não concluem a etapa.
-- 3. Enquanto o Conselho ainda não decidiu a etapa, um dirigente pode devolver um
--    trilho dela: o pedido da etapa é cancelado e volta a ser criado quando o trilho
--    for validado de novo. A declaração de etapa anterior substitui um pedido que
--    ainda não foi decidido.
-- 4. Acerto dos registos atuais: quem já tem a Promessa (ou etapa concluída) fica
--    com a etapa seguinte aberta, e etapas já prontas seguem para o Conselho.
-- Aditivo: não apaga registos.

-- ---------------------------------------------------------------------------
-- Abrir a etapa seguinte
-- ---------------------------------------------------------------------------
create or replace function private.auto_open_next_stage(p_membership uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_m public.memberships;
  v_ad public.adhesions;
  v_next integer;
  v_stage public.catalog_stages;
  v_id uuid;
begin
  select * into v_m from public.memberships where id = p_membership;
  if v_m.id is null or v_m.status <> 'ativo' then return null; end if;
  select * into v_ad from public.adhesions where membership_id = p_membership;
  if v_ad.decided_on is null or v_ad.commitment_on is null then return null; end if;
  if exists (select 1 from public.stage_paths where membership_id = p_membership and status = 'em_curso') then return null; end if;
  select coalesce(max(stage_ordinal), 0) + 1 into v_next
    from public.stage_paths where membership_id = p_membership and status = 'concluida';
  select cs.* into v_stage from public.catalog_stages cs
    join public.sections s on s.catalog_version_id = cs.version_id
   where s.id = v_m.section_id and cs.kind = 'progresso' and cs.ordinal = v_next;
  if v_stage.id is null then return null; end if; -- última etapa concluída: Acampamento
  if exists (select 1 from public.stage_paths where membership_id = p_membership and stage_key = v_stage.key) then return null; end if;
  insert into public.stage_paths (membership_id, stage_id, stage_key, stage_ordinal, opened_by)
  values (p_membership, v_stage.id, v_stage.key, v_stage.ordinal, coalesce(auth.uid(), v_ad.recorded_by))
  returning id into v_id;
  perform private.audit(v_m.section_id, 'etapa_aberta', 'stage_path', v_id::text,
    jsonb_build_object('stage', v_stage.key, 'automatica', true));
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'etapa_aberta', 'Nova etapa',
    'Começou a etapa ' || v_stage.name || '. Escolhe e negoceia um trilho de cada área.', '/caminho');
  return v_id;
end
$$;

create or replace function private.adhesions_auto_stage()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.decided_on is not null and new.commitment_on is not null then
    perform private.auto_open_next_stage(new.membership_id);
  end if;
  return null;
end
$$;
drop trigger if exists adhesions_auto_stage on public.adhesions;
create trigger adhesions_auto_stage after insert or update of decided_on, commitment_on on public.adhesions
  for each row execute function private.adhesions_auto_stage();

create or replace function private.stage_paths_auto_next()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'concluida' and old.status <> 'concluida' then
    perform private.auto_open_next_stage(new.membership_id);
  end if;
  return null;
end
$$;
drop trigger if exists stage_paths_auto_next on public.stage_paths;
create trigger stage_paths_auto_next after update of status on public.stage_paths
  for each row execute function private.stage_paths_auto_next();

-- Um membro reativado retoma o percurso com a etapa seguinte aberta.
create or replace function private.memberships_auto_stage()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'ativo' and old.status is distinct from 'ativo' then
    perform private.auto_open_next_stage(new.id);
  end if;
  return null;
end
$$;
drop trigger if exists memberships_auto_stage on public.memberships;
create trigger memberships_auto_stage after update of status on public.memberships
  for each row execute function private.memberships_auto_stage();

-- Abrir à mão continua possível; se a etapa já abriu sozinha, devolve-a.
create or replace function public.open_stage(p_membership uuid, p_stage_key text, p_insignia_on date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_m public.memberships;
  v_stage public.catalog_stages;
  v_ad public.adhesions;
  v_open public.stage_paths;
  v_id uuid;
begin
  v_m := private.progress_member(p_membership);
  perform private.assert_dirigente(v_m.section_id);
  select cs.* into v_stage from public.catalog_stages cs
    join public.sections s on s.catalog_version_id = cs.version_id
   where s.id = v_m.section_id and cs.key = p_stage_key and cs.kind = 'progresso';
  if v_stage.id is null then raise exception 'Etapa inválida.'; end if;
  select * into v_ad from public.adhesions where membership_id = p_membership;
  if v_ad.decided_on is null then raise exception 'Regista primeiro a adesão (Desprendimento).'; end if;
  if v_ad.commitment_on is null then raise exception 'Regista primeiro a Promessa/Investidura: a primeira escolha/negociação acontece depois dela.'; end if;
  if v_stage.ordinal > 1 and not exists (
    select 1 from public.stage_paths where membership_id = p_membership
       and stage_ordinal = v_stage.ordinal - 1 and status = 'concluida'
  ) then
    raise exception 'A etapa anterior ainda não está concluída.';
  end if;
  if p_insignia_on > current_date then raise exception 'A data da insígnia não pode ser futura.'; end if;
  select * into v_open from public.stage_paths
   where membership_id = p_membership and stage_key = p_stage_key and status = 'em_curso' for update;
  if v_open.id is not null then
    if p_insignia_on is not null and v_open.insignia_delivered_on is null then
      update public.stage_paths set insignia_delivered_on = p_insignia_on, insignia_recorded_by = auth.uid() where id = v_open.id;
    end if;
    return v_open.id;
  end if;
  insert into public.stage_paths (membership_id, stage_id, stage_key, stage_ordinal, opened_by, insignia_delivered_on, insignia_recorded_by)
  values (p_membership, v_stage.id, v_stage.key, v_stage.ordinal, auth.uid(), p_insignia_on,
          case when p_insignia_on is not null then auth.uid() end)
  returning id into v_id;
  perform private.audit(v_m.section_id, 'etapa_aberta', 'stage_path', v_id::text, jsonb_build_object('stage', p_stage_key));
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'etapa_aberta', 'Nova etapa',
    'Começou a etapa ' || v_stage.name || '. Escolhe e negoceia um trilho de cada área.', '/caminho');
  return v_id;
exception when unique_violation then
  raise exception 'Esta etapa já foi aberta ou existe outra etapa em curso.';
end
$$;

-- ---------------------------------------------------------------------------
-- Levar a etapa ao Conselho de Guias quando fica pronta
-- ---------------------------------------------------------------------------
create or replace function private.auto_request_stage(p_membership uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_p public.stage_paths; v_m public.memberships; v_id uuid;
begin
  select * into v_p from public.stage_paths where membership_id = p_membership and status = 'em_curso' for update;
  if v_p.id is null then return null; end if;
  if exists (select 1 from public.stage_requests where stage_path_id = v_p.id and status in ('submetido', 'decidido_conselho')) then
    return null;
  end if;
  if not coalesce(private.stage_ready(v_p.id), false) then return null; end if;
  select * into v_m from public.memberships where id = p_membership;
  insert into public.stage_requests (stage_path_id, membership_id, requested_by)
  values (v_p.id, p_membership, coalesce(auth.uid(), v_m.profile_id)) returning id into v_id;
  perform private.notify(private.section_dirigentes(v_m.section_id) || private.section_guias(v_m.section_id), v_m.section_id,
    'pedido_etapa', 'Validação de etapa', 'Há uma etapa pronta para o Conselho de Guias.', '/conselho');
  return v_id;
end
$$;

create or replace function private.trail_requests_auto_stage()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status::text in ('validado_equipa', 'aprovado')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.auto_request_stage(new.membership_id);
  end if;
  return null;
end
$$;
drop trigger if exists trail_requests_auto_stage on public.trail_requests;
create trigger trail_requests_auto_stage after insert or update of status on public.trail_requests
  for each row execute function private.trail_requests_auto_stage();

create or replace function private.stage_choices_auto_stage()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'confirmada' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.auto_request_stage(new.membership_id);
  end if;
  return null;
end
$$;
drop trigger if exists stage_choices_auto_stage on public.stage_choices;
create trigger stage_choices_auto_stage after insert or update of status on public.stage_choices
  for each row execute function private.stage_choices_auto_stage();

-- Devolução de um trilho pelos dirigentes: se o Conselho ainda não decidiu a etapa,
-- o pedido da etapa é cancelado (volta a ser criado quando o trilho for validado).
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
                and sr.status = 'decidido_conselho') then
    raise exception 'A etapa deste trilho está em validação. Regista a decisão da etapa primeiro.';
  end if;
  update public.stage_requests sr set status = 'cancelado'
   where sr.status = 'submetido' and sr.stage_path_id in (
     select c.stage_path_id from public.stage_choices c
      where c.membership_id = v_r.membership_id and c.trail_key = v_r.trail_key and c.status = 'confirmada');
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, recorded_by, recorded_as)
  values (p_request, v_version, 'devolvido_conselho', p_meeting_date, trim(p_comment), auth.uid(), 'dirigente');
  update public.trail_requests set status = 'devolvido', updated_at = now() where id = p_request;
  select * into v_m from public.memberships where id = v_r.membership_id;
  perform private.notify(array[v_m.profile_id] || private.team_guias(v_m.team_id), v_m.section_id, 'devolucao_conselho',
    'Trilho devolvido pelos dirigentes', trim(p_comment), '/pedidos/' || p_request);
end
$$;

-- Declaração de etapa anterior: substitui um pedido criado sozinho que o Conselho
-- ainda não decidiu.
create or replace function public.declare_historical_stage(p_stage_path uuid, p_date date, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_p public.stage_paths; v_m public.memberships;
begin
  select * into v_p from public.stage_paths where id = p_stage_path for update;
  if v_p.id is null then raise exception 'Etapa não encontrada.' using errcode = '42501'; end if;
  select * into v_m from public.memberships where id = v_p.membership_id;
  perform private.assert_dirigente(v_m.section_id);
  if v_p.status <> 'em_curso' then raise exception 'A etapa já está concluída.'; end if;
  perform private.require_text(p_comment, 'Fundamenta a declaração da etapa anterior.');
  if p_date is null or p_date > current_date then raise exception 'Indica uma data válida.'; end if;
  if not coalesce(private.stage_ready(p_stage_path), false) then
    raise exception 'Atribui primeiro a esta etapa um trilho validado de cada área.';
  end if;
  if exists (select 1 from public.stage_requests where stage_path_id = p_stage_path and status = 'decidido_conselho') then
    raise exception 'Existe um pedido de validação desta etapa em curso.';
  end if;
  update public.stage_requests set status = 'cancelado' where stage_path_id = p_stage_path and status = 'submetido';
  insert into public.stage_requests (stage_path_id, membership_id, kind, status, requested_by, final_opinion, final_date,
                                     final_comment, final_recorded_by, final_recorded_at)
  values (p_stage_path, v_m.id, 'historico', 'confirmada', auth.uid(), 'confirmada', p_date, trim(p_comment), auth.uid(), now());
  update public.stage_paths set status = 'concluida', completed_on = p_date, completion_kind = 'historico' where id = p_stage_path;
end
$$;

-- Só os gatilhos e as funções do servidor as usam.
revoke all on function private.auto_open_next_stage(uuid), private.auto_request_stage(uuid),
  private.adhesions_auto_stage(), private.stage_paths_auto_next(), private.memberships_auto_stage(),
  private.trail_requests_auto_stage(), private.stage_choices_auto_stage() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Acerto dos registos atuais
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  for v_id in select m.id from public.memberships m join public.adhesions a on a.membership_id = m.id
               where m.status = 'ativo' and a.commitment_on is not null
  loop
    perform private.auto_open_next_stage(v_id);
    perform private.auto_request_stage(v_id);
  end loop;
end
$$;
