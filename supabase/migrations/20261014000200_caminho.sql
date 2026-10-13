-- Pioneiros — Caminho: posição de cada pioneiro no percurso, traçado do perfil,
-- Promessa/Investidura antes da 1.ª etapa, reconhecimento na negociação,
-- contadores de pendentes e atividade recente.
-- Não apaga nem altera registos existentes.

-- ---------------------------------------------------------------------------
-- Início de Pista: o traçado do perfil pela Equipa de Animação (pp. 4 e 7)
-- pode ser registado antes da decisão sobre a adesão.
-- ---------------------------------------------------------------------------
alter table public.adhesions alter column decided_on drop not null;
alter table public.adhesions add column if not exists profile_traced_on date;
alter table public.adhesions add column if not exists profile_recorded_by uuid;
alter table public.adhesions add constraint adhesions_has_date check (decided_on is not null or profile_traced_on is not null);

-- Pedidos «reconhecido na negociação» (kind = negociacao) ficam sempre aprovados.
alter table public.trail_requests drop constraint if exists trail_requests_check;
alter table public.trail_requests add constraint trail_requests_status_by_kind
  check (kind = 'historico' or kind::text = 'negociacao' or status not in ('aprovado', 'recusado'));
alter table public.trail_requests add constraint trail_requests_negociacao_aprovado
  check (kind::text <> 'negociacao' or status = 'aprovado');

create or replace function public.record_profile_traced(p_membership uuid, p_date date)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  v_m := private.progress_member(p_membership);
  perform private.assert_dirigente(v_m.section_id);
  if p_date is null or p_date > current_date then raise exception 'Indica uma data válida.'; end if;
  insert into public.adhesions (membership_id, profile_traced_on, profile_recorded_by, recorded_by)
  values (p_membership, p_date, auth.uid(), auth.uid())
  on conflict (membership_id) do update set profile_traced_on = excluded.profile_traced_on, profile_recorded_by = excluded.profile_recorded_by;
end
$$;

-- A abertura da 1.ª etapa passa a exigir a Promessa/Investidura (p. 10: a
-- primeira Escolha/Negociação acontece «após a Promessa/Investidura»).
create or replace function public.open_stage(p_membership uuid, p_stage_key text, p_insignia_on date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_m public.memberships;
  v_stage public.catalog_stages;
  v_ad public.adhesions;
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

-- Reconhecimento, na negociação, de um trilho já demonstrado (p. 10).
-- Decisão do dirigente, com fundamentação obrigatória; a Equipa é informada.
-- Não depende da opção «progresso anterior» (são processos diferentes).
create or replace function public.recognize_in_negotiation(p_membership uuid, p_trail uuid, p_comment text, p_reference_date date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships; v_t public.catalog_trails; v_id uuid; v_version uuid;
begin
  v_m := private.progress_member(p_membership);
  perform private.assert_dirigente(v_m.section_id);
  if private.is_owner(v_m.id) then raise exception 'Não é possível decidir sobre o próprio percurso.' using errcode = '42501'; end if;
  v_t := private.section_trail(v_m.section_id, p_trail);
  perform private.require_text(p_comment, 'Fundamenta o reconhecimento: o que demonstra que o trilho já foi alcançado?');
  if p_reference_date > current_date then raise exception 'A data de referência não pode ser futura.'; end if;
  insert into public.trail_requests (membership_id, section_id, trail_id, trail_key, kind, status, approved_reference_date, created_by)
  values (v_m.id, v_m.section_id, v_t.id, v_t.key, 'negociacao', 'aprovado', p_reference_date, auth.uid())
  returning id into v_id;
  insert into public.trail_request_versions (request_id, version_no, submitted_at)
  values (v_id, 1, now()) returning id into v_version;
  insert into public.trail_decisions (request_id, version_id, kind, comment, reference_date, recorded_by, recorded_as)
  values (v_id, v_version, 'reconhecido_negociacao', trim(p_comment), p_reference_date, auth.uid(), 'dirigente');
  perform private.notify(array[v_m.profile_id] || private.team_guias(v_m.team_id), v_m.section_id, 'reconhecido_negociacao',
    'Trilho reconhecido na negociação', v_t.name || ': ' || trim(p_comment), '/pedidos/' || v_id);
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um pedido ativo ou uma validação para este trilho.';
end
$$;

-- ---------------------------------------------------------------------------
-- Posição no caminho
-- ---------------------------------------------------------------------------
-- Marco atual de um pioneiro e o estado nesse marco. «Estar em» uma etapa
-- (em_curso, requisitos_cumpridos, em_validacao) é distinto de «ter concluído»
-- (concluida, reconhecida). Etapas: pp. 9–13; esquema: pp. 3 e 14.
create or replace function private.member_position(p_membership uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_a public.adhesions;
  v_open public.stage_paths;
  v_last public.stage_paths;
  v_max integer;
  v_state text;
begin
  select * into v_a from public.adhesions where membership_id = p_membership;
  -- Etapas já abertas têm prioridade (inclui dados criados antes de a Promessa
  -- ser exigida para abrir a 1.ª etapa).
  if not exists (select 1 from public.stage_paths where membership_id = p_membership) then
    if v_a.membership_id is null or v_a.decided_on is null then
      return jsonb_build_object('milestone', 'inicio_pista',
        'state', case when v_a.profile_traced_on is not null then 'perfil_tracado' else 'em_adesao' end);
    end if;
    if v_a.commitment_on is null then
      return jsonb_build_object('milestone', 'promessa', 'state', 'aguarda_promessa');
    end if;
  end if;
  select * into v_open from public.stage_paths where membership_id = p_membership and status = 'em_curso';
  if v_open.id is not null then
    if exists (select 1 from public.stage_requests where stage_path_id = v_open.id and status in ('submetido', 'decidido_conselho')) then
      v_state := 'em_validacao';
    elsif coalesce(private.stage_ready(v_open.id), false) then
      v_state := 'requisitos_cumpridos';
    else
      v_state := 'em_curso';
    end if;
    return jsonb_build_object('milestone', v_open.stage_key, 'state', v_state);
  end if;
  select * into v_last from public.stage_paths
   where membership_id = p_membership and status = 'concluida' order by stage_ordinal desc limit 1;
  if v_last.id is null then
    return jsonb_build_object('milestone', 'promessa', 'state', 'aguarda_etapa');
  end if;
  select max(cs.ordinal) into v_max from public.catalog_stages cs
   where cs.kind = 'progresso' and cs.version_id = (select version_id from public.catalog_stages where id = v_last.stage_id);
  if v_last.stage_ordinal >= v_max then
    return jsonb_build_object('milestone', 'acampamento',
      'state', case when exists (select 1 from public.merit_awards where membership_id = p_membership)
                    then 'anilha_atribuida' else 'etapas_concluidas' end);
  end if;
  return jsonb_build_object('milestone', v_last.stage_key,
    'state', case when v_last.recognized_on is not null then 'reconhecida' else 'concluida' end);
end
$$;

-- Caminho da secção. Contagens por marco para qualquer membro ativo; nomes,
-- avatares e equipa só dos pioneiros cujo percurso o utilizador já pode ver
-- (o próprio; o guia atual da sua equipa; os dirigentes). Nunca devolve
-- reflexões, anexos, comentários ou observações.
create or replace function public.section_path(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_me public.memberships;
begin
  v_me := private.my_active_membership(p_section);
  if v_me.id is null then raise exception 'Sem acesso a esta secção.' using errcode = '42501'; end if;
  return (
    with members as (
      select m.id, m.team_id, m.function, p.full_name, p.totem, p.photo_path,
             private.member_position(m.id) as pos,
             private.can_view_progress(m.id) as visible
        from public.memberships m join public.profiles p on p.id = m.profile_id
       where m.section_id = p_section and m.status = 'ativo' and m.function in ('pioneiro', 'guia')
    )
    select jsonb_build_object(
      'scope', case when v_me.function = 'dirigente' then 'seccao' when v_me.function = 'guia' then 'equipa' else 'proprio' end,
      'total', (select count(*) from members),
      'counts', coalesce((select jsonb_object_agg(k, n) from (select pos ->> 'milestone' k, count(*) n from members group by 1) c), '{}'::jsonb),
      'members', coalesce((select jsonb_agg(jsonb_build_object(
          'membership_id', id, 'full_name', full_name, 'totem', totem, 'photo_path', photo_path,
          'team_id', team_id, 'function', function,
          'milestone', pos ->> 'milestone', 'state', pos ->> 'state', 'is_me', id = v_me.id)
          order by full_name) from members where visible), '[]'::jsonb)
    )
  );
end
$$;

-- Contadores para a navegação (só o que cabe a cada papel).
create or replace function public.my_pending_counts(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_me public.memberships; v_out jsonb := '{}'::jsonb;
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
    v_out := v_out || jsonb_build_object('acompanhamento',
      (select count(*) from public.stage_choices c join public.memberships m on m.id = c.membership_id
        where m.section_id = p_section and m.status = 'ativo' and c.status = 'proposta')
      + (select count(*) from public.stage_requests s join public.memberships m on m.id = s.membership_id
        where m.section_id = p_section and m.status = 'ativo' and s.status in ('submetido', 'decidido_conselho'))
      + (select count(*) from public.trail_requests r join public.memberships m on m.id = r.membership_id
        where r.section_id = p_section and m.status = 'ativo' and r.status in ('submetido', 'em_revisao')
          and (r.kind = 'historico' or m.function = 'guia')));
  end if;
  if v_me.is_admin then
    v_out := v_out || jsonb_build_object('gestao', (select count(*) from public.memberships
      where section_id = p_section and status = 'pendente'));
  end if;
  return v_out;
end
$$;

-- Atividade recente (sem comentários nem reflexões), limitada ao que o
-- utilizador pode ver do percurso de cada pioneiro.
create or replace function public.section_activity(p_section uuid, p_limit integer default 15)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_active_member(p_section) then raise exception 'Sem acesso a esta secção.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(e order by e.at desc) from (
      select * from (
        select d.recorded_at as at, d.kind::text as kind, r.membership_id, p.full_name as member, t.name as subject, r.id::text as ref
          from public.trail_decisions d
          join public.trail_requests r on r.id = d.request_id
          join public.catalog_trails t on t.id = r.trail_id
          join public.memberships m on m.id = r.membership_id
          join public.profiles p on p.id = m.profile_id
         where r.section_id = p_section and d.kind not in ('em_revisao')
        union all
        select s.council_recorded_at, 'conselho_' || s.council_decision::text, s.membership_id, p.full_name, cs.name, s.id::text
          from public.stage_requests s join public.stage_paths sp on sp.id = s.stage_path_id
          join public.catalog_stages cs on cs.id = sp.stage_id
          join public.memberships m on m.id = s.membership_id join public.profiles p on p.id = m.profile_id
         where m.section_id = p_section and s.council_recorded_at is not null
        union all
        select s.final_recorded_at, 'etapa_' || s.final_opinion::text, s.membership_id, p.full_name, cs.name, s.id::text
          from public.stage_requests s join public.stage_paths sp on sp.id = s.stage_path_id
          join public.catalog_stages cs on cs.id = sp.stage_id
          join public.memberships m on m.id = s.membership_id join public.profiles p on p.id = m.profile_id
         where m.section_id = p_section and s.final_recorded_at is not null
        union all
        select sp.opened_at, 'etapa_aberta', sp.membership_id, p.full_name, cs.name, sp.id::text
          from public.stage_paths sp join public.catalog_stages cs on cs.id = sp.stage_id
          join public.memberships m on m.id = sp.membership_id join public.profiles p on p.id = m.profile_id
         where m.section_id = p_section
        union all
        select ma.recorded_at, 'merito', ma.membership_id, p.full_name, null, ma.membership_id::text
          from public.merit_awards ma join public.memberships m on m.id = ma.membership_id
          join public.profiles p on p.id = m.profile_id
         where m.section_id = p_section
      ) x
      where private.can_view_progress(x.membership_id)
      order by x.at desc
      limit greatest(1, least(coalesce(p_limit, 15), 50))
    ) e
  ), '[]'::jsonb);
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_active_member(uuid),
  private.is_dirigente(uuid),
  private.is_admin(uuid),
  private.can_view_progress(uuid),
  private.can_view_membership(uuid),
  private.can_view_profile(uuid),
  private.request_membership(uuid),
  private.safe_uuid(text),
  private.can_upload_attachment(text),
  private.can_read_attachment(text),
  private.can_delete_attachment(text, text)
to authenticated;
