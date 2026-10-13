-- Pioneiros — pedidos por objetivos (2/2).
-- O pioneiro escolhe, dentro de um trilho, os objetivos que considera ter
-- atingido e justifica-os num texto comum. A reunião de Equipa decide cada
-- objetivo (aceite / a rever, com comentário). O trilho só fica «Validado»
-- quando todos os seus objetivos oficiais estiverem aceites; aceitar um
-- objetivo não conclui o trilho. As regras de fecho da etapa não mudam
-- (continuam a depender de trilhos validados).
-- Aditivo: os pedidos antigos (por trilho, sem objetivos) continuam a ser
-- decididos como antes e não são reinterpretados.

create table if not exists public.request_objectives (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.trail_requests (id) on delete cascade,
  version_id uuid not null references public.trail_request_versions (id) on delete cascade,
  objective_id uuid not null references public.catalog_objectives (id),
  objective_code text not null,
  decision text check (decision in ('aceite', 'rever')),
  comment text check (comment is null or length(comment) <= 4000),
  decided_by uuid,
  decided_at timestamptz,
  unique (version_id, objective_id),
  check ((decision is null) = (decided_at is null))
);
create index if not exists request_objectives_request on public.request_objectives (request_id);

alter table public.request_objectives enable row level security;
revoke all on public.request_objectives from anon, authenticated;
grant select on public.request_objectives to authenticated;
drop policy if exists request_objectives_select on public.request_objectives;
create policy request_objectives_select on public.request_objectives for select to authenticated
  using (private.can_view_progress(private.request_membership(request_id)));

-- Um pedido cujos objetivos foram todos aceites sem fechar o trilho deixa de
-- ser «ativo»: pode seguir-se outro pedido para os restantes objetivos.
-- (A condição lista os estados ativos em vez do novo: na instalação completa,
-- que corre numa só transação, o valor novo do enum ainda não pode ser usado.)
drop index if exists public.trail_requests_one_active;
create unique index trail_requests_one_active on public.trail_requests (membership_id, trail_key)
  where status in ('rascunho', 'submetido', 'em_revisao', 'validado_equipa', 'devolvido', 'aprovado');
-- Uma decisão por versão: record_objectives_decision bloqueia o pedido (for update)
-- e só decide pedidos «submetido»/«em_revisao» — a decisão muda logo o estado.

-- Objetivos já aceites de um membro (em pedidos que não foram cancelados).
create or replace function private.accepted_objectives(p_membership uuid)
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select distinct ro.objective_id
    from public.request_objectives ro join public.trail_requests r on r.id = ro.request_id
   where r.membership_id = p_membership and ro.decision = 'aceite' and r.status not in ('cancelado', 'recusado')
$$;

-- Enviar para validação: guarda os objetivos escolhidos e a justificação na
-- versão em rascunho e submete. Não fecha objetivos, trilhos nem etapas.
create or replace function public.submit_objectives_request(
  p_request uuid, p_expected_version integer, p_objectives uuid[], p_justification text
) returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.trail_requests; v_v public.trail_request_versions; v_m public.memberships; v_trail text;
  v_ids uuid[]; v_bad integer;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.kind <> 'normal' then raise exception 'Este pedido não é por objetivos.'; end if;
  if v_r.status <> 'rascunho' then raise exception 'Este pedido já foi enviado. Atualiza a página.'; end if;
  if p_expected_version is distinct from v_r.current_version then raise exception 'O pedido mudou entretanto. Atualiza a página.'; end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_objectives, '{}')) x where x is not null;
  if coalesce(cardinality(v_ids), 0) = 0 then raise exception 'Escolhe pelo menos um objetivo.'; end if;
  select count(*) into v_bad from unnest(v_ids) x
   where not exists (select 1 from public.catalog_objectives o where o.id = x and o.trail_id = v_r.trail_id);
  if v_bad > 0 then raise exception 'Há objetivos que não pertencem a este trilho.'; end if;
  if exists (select 1 from unnest(v_ids) x where x in (select private.accepted_objectives(v_r.membership_id))) then
    raise exception 'Há objetivos que já estão validados. Atualiza a página.';
  end if;
  perform private.require_text(p_justification, 'Explica como demonstraste que atingiste estes objetivos.');
  if length(p_justification) > 10000 then raise exception 'A justificação é demasiado longa.'; end if;

  select * into v_v from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  delete from public.request_objectives where version_id = v_v.id;
  insert into public.request_objectives (request_id, version_id, objective_id, objective_code)
  select p_request, v_v.id, o.id, o.code from public.catalog_objectives o where o.id = any (v_ids);
  update public.trail_request_versions
     set evidence = trim(p_justification), submitted_at = now(), updated_at = now()
   where id = v_v.id;
  update public.trail_requests set status = 'submetido', updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  perform private.notify(private.team_guias(v_m.team_id) || case when v_m.function = 'guia'
           then private.section_dirigentes(v_m.section_id) else '{}'::uuid[] end,
    v_m.section_id, 'pedido_submetido', 'Novo pedido de validação',
    'Pedido de validação de objetivos do trilho ' || v_trail || ' para a próxima reunião de Equipa.', '/revisoes/pedido/' || p_request);
end
$$;

-- Os pedidos por objetivos são enviados com submit_objectives_request (que exige a justificação).
create or replace function public.submit_trail_request(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_v public.trail_request_versions; v_m public.memberships; v_trail text;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status <> 'rascunho' then raise exception 'Este pedido não está em rascunho.'; end if;
  if v_r.kind = 'historico' and not private.historical_enabled(v_r.section_id) then
    raise exception 'O registo de progresso anterior foi desativado. Podes cancelar este pedido e usar o progresso normal, ou aguardar a reativação.';
  end if;
  select * into v_v from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  if exists (select 1 from public.request_objectives where request_id = p_request) then
    raise exception 'Este pedido é por objetivos: escolhe os objetivos e envia a justificação.';
  end if;
  if length(trim(v_v.reflection)) = 0 then raise exception 'Escreve a tua reflexão antes de submeter.'; end if;
  if v_v.period_end > current_date + 1 then raise exception 'As datas das vivências não podem ser futuras.'; end if;
  update public.trail_request_versions set submitted_at = now() where id = v_v.id;
  update public.trail_requests set status = 'submetido', updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  if v_r.kind = 'normal' then
    perform private.notify(private.team_guias(v_m.team_id) || case when v_m.function = 'guia'
             then private.section_dirigentes(v_m.section_id) else '{}'::uuid[] end,
      v_m.section_id, 'pedido_submetido', 'Novo pedido de validação',
      'Pedido de validação do trilho ' || v_trail || ' para a próxima reunião de Equipa.', '/revisoes/pedido/' || p_request);
  else
    perform private.notify(private.section_dirigentes(v_m.section_id), v_m.section_id, 'pedido_historico',
      'Progresso anterior', 'Novo pedido de progresso anterior: ' || v_trail || '.', '/revisoes/pedido/' || p_request);
  end if;
end
$$;

-- Nova versão (retirar / corrigir após «A rever»): copia o texto, os anexos e
-- os objetivos que ainda não foram aceites. Os aceites ficam na versão anterior.
create or replace function private.new_draft_version(p_request uuid, p_from integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_new uuid; v_old uuid;
begin
  select id into v_old from public.trail_request_versions where request_id = p_request and version_no = p_from;
  insert into public.trail_request_versions (request_id, version_no, reflection, experiences, context, evidence, period_start, period_end, approximate_date)
  select request_id, p_from + 1, reflection, experiences, context, evidence, period_start, period_end, approximate_date
    from public.trail_request_versions where id = v_old
  returning id into v_new;
  insert into public.attachments (request_id, version_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  select request_id, v_new, storage_path, file_name, mime_type, size_bytes, uploaded_by
    from public.attachments where version_id = v_old;
  insert into public.request_objectives (request_id, version_id, objective_id, objective_code)
  select request_id, v_new, objective_id, objective_code
    from public.request_objectives where version_id = v_old and decision is distinct from 'aceite';
  update public.trail_requests set current_version = p_from + 1, status = 'rascunho', updated_at = now() where id = p_request;
end
$$;

-- Cancelar: se já houver objetivos aceites neste pedido, esses mantêm-se
-- (o pedido fica como «objetivos validados»); o resto é abandonado.
create or replace function public.cancel_trail_request(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status not in ('rascunho', 'submetido', 'em_revisao', 'devolvido') then
    raise exception 'Este pedido já foi decidido e não pode ser cancelado.';
  end if;
  if exists (select 1 from public.request_objectives where request_id = p_request and decision = 'aceite') then
    update public.trail_requests set status = 'objetivos_validados', updated_at = now() where id = p_request;
  else
    update public.trail_requests set status = 'cancelado', updated_at = now() where id = p_request;
  end if;
end
$$;

-- Decisão da reunião de Equipa objetivo a objetivo.
-- p_decisions: [{"objective_id": "...", "accepted": true|false, "comment": "..."}]
-- Todos os objetivos da versão têm de ser decididos; «a rever» exige comentário
-- (no objetivo ou geral). Resultado:
--   algum a rever                         → pedido «devolvido» (A rever)
--   todos aceites e trilho completo       → «validado_equipa» (trilho validado)
--   todos aceites, trilho ainda incompleto→ «objetivos_validados»
create or replace function public.record_objectives_decision(
  p_request uuid, p_expected_version integer, p_meeting_date date, p_decisions jsonb, p_comment text
) returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.trail_requests; v_role text; v_version uuid; v_m public.memberships; v_trail text;
  v_d record; v_total integer; v_given integer; v_review integer; v_missing integer; v_status text; v_kind text;
  v_codes_ok text; v_codes_rev text;
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
  -- Serializa decisões sobre o mesmo membro (dois pedidos do mesmo trilho em paralelo).
  perform 1 from public.memberships where id = v_r.membership_id for update;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  select count(*) into v_total from public.request_objectives where version_id = v_version;
  if v_total = 0 then raise exception 'Este pedido não tem objetivos: regista a decisão do trilho.'; end if;
  if jsonb_typeof(p_decisions) is distinct from 'array' then raise exception 'Decisões inválidas.'; end if;

  v_given := 0; v_review := 0;
  for v_d in
    select (e ->> 'objective_id')::uuid as objective_id, coalesce((e ->> 'accepted')::boolean, false) as accepted,
           nullif(trim(coalesce(e ->> 'comment', '')), '') as comment
      from jsonb_array_elements(p_decisions) e
  loop
    if not exists (select 1 from public.request_objectives where version_id = v_version and objective_id = v_d.objective_id) then
      raise exception 'Há uma decisão para um objetivo que não está neste pedido.';
    end if;
    if v_d.comment is not null and length(v_d.comment) > 4000 then raise exception 'Comentário demasiado longo.'; end if;
    if not v_d.accepted and v_d.comment is null and nullif(trim(coalesce(p_comment, '')), '') is null then
      raise exception 'Explica o que falta trabalhar nos objetivos a rever.';
    end if;
    update public.request_objectives
       set decision = case when v_d.accepted then 'aceite' else 'rever' end,
           comment = v_d.comment, decided_by = auth.uid(), decided_at = now()
     where version_id = v_version and objective_id = v_d.objective_id and decision is null;
    if not found then raise exception 'O mesmo objetivo foi decidido duas vezes.'; end if;
    v_given := v_given + 1;
    if not v_d.accepted then v_review := v_review + 1; end if;
  end loop;
  if v_given <> v_total then raise exception 'Decide todos os objetivos do pedido (aceite ou a rever).'; end if;

  select count(*) into v_missing from public.catalog_objectives o
   where o.trail_id = v_r.trail_id and o.id not in (select private.accepted_objectives(v_r.membership_id));
  if v_review > 0 then v_status := 'devolvido'; v_kind := 'devolvido_equipa';
  elsif v_missing = 0 then v_status := 'validado_equipa'; v_kind := 'validado_equipa';
  else v_status := 'objetivos_validados'; v_kind := 'objetivos_equipa';
  end if;

  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, recorded_by, recorded_as)
  values (p_request, v_version, v_kind::public.decision_kind, p_meeting_date, nullif(trim(p_comment), ''), auth.uid(), v_role);
  update public.trail_requests set status = v_status::public.request_status, updated_at = now() where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  select string_agg(objective_code, ', ' order by objective_code) filter (where decision = 'aceite'),
         string_agg(objective_code, ', ' order by objective_code) filter (where decision = 'rever')
    into v_codes_ok, v_codes_rev
    from public.request_objectives where version_id = v_version;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'decisao_equipa',
    case v_status when 'validado_equipa' then 'Trilho validado na Equipa'
                  when 'objetivos_validados' then 'Objetivos validados na Equipa'
                  else 'Pedido a rever' end,
    v_trail || coalesce(' · aceites: ' || v_codes_ok, '') || coalesce(' · a rever: ' || v_codes_rev, ''), '/pedidos/' || p_request);
  perform private.notify(private.section_dirigentes(v_m.section_id) || private.section_guias(v_m.section_id), v_m.section_id,
    'comunicacao_conselho', 'Comunicação ao Conselho de Guias',
    'Decisão da reunião de Equipa sobre o trilho ' || v_trail || '.', '/conselho');
  return v_status;
exception when unique_violation then
  raise exception 'Já foi registada uma decisão para esta versão do pedido.';
end
$$;

-- A decisão por trilho mantém-se para os pedidos antigos (sem objetivos).
create or replace function public.record_team_decision(
  p_request uuid, p_expected_version integer, p_validated boolean, p_meeting_date date, p_comment text
) returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.trail_requests; v_role text; v_version uuid; v_m public.memberships; v_trail text;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  if v_r.kind <> 'normal' then raise exception 'Pedidos de progresso anterior são decididos pelos dirigentes.'; end if;
  v_role := private.team_recorder_role(v_r);
  if v_role is null then
    raise exception 'Sem permissão para registar a decisão deste pedido (não é possível decidir o próprio pedido).' using errcode = '42501';
  end if;
  if v_r.status not in ('submetido', 'em_revisao') then
    raise exception 'Este pedido já foi decidido ou não está submetido.';
  end if;
  if p_expected_version is distinct from v_r.current_version then
    raise exception 'O pedido mudou entretanto. Atualiza a página.';
  end if;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  if exists (select 1 from public.request_objectives where version_id = v_version) then
    raise exception 'Este pedido é por objetivos: decide cada objetivo.';
  end if;
  if p_meeting_date is null or p_meeting_date > current_date then raise exception 'Indica a data da reunião de Equipa.'; end if;
  if not p_validated then perform private.require_text(p_comment, 'Explica o que falta trabalhar.'); end if;
  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, recorded_by, recorded_as)
  values (p_request, v_version, case when p_validated then 'validado_equipa' else 'devolvido_equipa' end::public.decision_kind,
          p_meeting_date, nullif(trim(p_comment), ''), auth.uid(), v_role);
  update public.trail_requests set status = case when p_validated then 'validado_equipa' else 'devolvido' end::public.request_status,
         updated_at = now()
   where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'decisao_equipa',
    case when p_validated then 'Trilho validado na Equipa' else 'Pedido devolvido para continuar a trabalhar' end,
    v_trail || coalesce(': ' || nullif(trim(p_comment), ''), ''), '/pedidos/' || p_request);
  perform private.notify(private.section_dirigentes(v_m.section_id) || private.section_guias(v_m.section_id), v_m.section_id,
    'comunicacao_conselho', 'Comunicação ao Conselho de Guias',
    'Decisão da reunião de Equipa sobre o trilho ' || v_trail || '.', '/conselho');
exception when unique_violation then
  raise exception 'Já foi registada uma decisão para esta versão do pedido.';
end
$$;

-- Devolução fundamentada pelo Conselho de Guias: os objetivos aceites nesta versão
-- voltam a «a rever» (a decisão da Equipa fica no histórico de decisões).
create or replace function public.record_council_return(p_request uuid, p_meeting_date date, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_m public.memberships; v_version uuid;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_r.section_id);
  if private.is_owner(v_r.membership_id) then raise exception 'Não é possível decidir o próprio pedido.' using errcode = '42501'; end if;
  if v_r.status <> 'validado_equipa' then raise exception 'Só trilhos validados na Equipa podem ser devolvidos pelo Conselho de Guias.'; end if;
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
  update public.request_objectives
     set decision = 'rever', comment = left('Conselho de Guias: ' || trim(p_comment), 4000), decided_by = auth.uid(), decided_at = now()
   where version_id = v_version and decision = 'aceite';
  update public.trail_requests set status = 'devolvido', updated_at = now() where id = p_request;
  select * into v_m from public.memberships where id = v_r.membership_id;
  perform private.notify(array[v_m.profile_id] || private.team_guias(v_m.team_id), v_m.section_id, 'devolucao_conselho',
    'Trilho devolvido pelo Conselho de Guias', trim(p_comment), '/pedidos/' || p_request);
end
$$;


revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on function private.new_draft_version(uuid, integer) from public, anon, authenticated;
notify pgrst, 'reload schema';
