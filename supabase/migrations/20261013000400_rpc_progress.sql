-- Pioneiros — operações pedagógicas (RPC): adesão, etapas, escolhas, pedidos,
-- decisões, validação da etapa, mérito.

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------

-- Membro que pode ter percurso (pioneiro ou guia ativo).
create or replace function private.progress_member(p_membership uuid)
returns public.memberships language plpgsql stable security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership;
  if v_m.id is null then raise exception 'Membro não encontrado.' using errcode = '42501'; end if;
  if v_m.status <> 'ativo' or v_m.function not in ('pioneiro', 'guia') then
    raise exception 'Este membro não tem percurso de progresso ativo.';
  end if;
  return v_m;
end
$$;

create or replace function private.assert_dirigente(p_section uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_dirigente(p_section) then
    raise exception 'Esta ação está reservada aos dirigentes (Equipa de Animação).' using errcode = '42501';
  end if;
end
$$;

-- É o próprio membro (ativo, pioneiro/guia)?
create or replace function private.is_owner(p_membership uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.memberships m where m.id = p_membership
    and m.profile_id = auth.uid() and m.status = 'ativo' and m.function in ('pioneiro', 'guia'))
$$;

create or replace function private.historical_enabled(p_section uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select historical_progress_enabled from public.section_settings where section_id = p_section), true) $$;

create or replace function private.require_text(p_text text, p_message text)
returns void language plpgsql immutable set search_path = ''
as $$ begin if length(trim(coalesce(p_text, ''))) = 0 then raise exception '%', p_message; end if; end $$;

-- Trilho da versão de catálogo ativa da secção.
create or replace function private.section_trail(p_section uuid, p_trail uuid)
returns public.catalog_trails language plpgsql stable security definer set search_path = ''
as $$
declare v_t public.catalog_trails;
begin
  select t.* into v_t from public.catalog_trails t
    join public.sections s on s.catalog_version_id = t.version_id
   where s.id = p_section and t.id = p_trail;
  if v_t.id is null then raise exception 'Trilho não pertence ao catálogo desta secção.'; end if;
  return v_t;
end
$$;

-- ---------------------------------------------------------------------------
-- Adesão (Desprendimento)
-- ---------------------------------------------------------------------------
create or replace function public.record_adhesion(
  p_membership uuid, p_decided_on date, p_commitment_on date, p_notes text, p_is_historical boolean
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships;
begin
  v_m := private.progress_member(p_membership);
  perform private.assert_dirigente(v_m.section_id);
  if p_decided_on is null then raise exception 'Indica a data da decisão do Conselho de Guias.'; end if;
  if p_decided_on > current_date or p_commitment_on > current_date then raise exception 'As datas não podem ser futuras.'; end if;
  insert into public.adhesions (membership_id, decided_on, commitment_on, notes, is_historical, recorded_by)
  values (p_membership, p_decided_on, p_commitment_on, nullif(trim(p_notes), ''), coalesce(p_is_historical, false), auth.uid())
  on conflict (membership_id) do update
    set decided_on = excluded.decided_on, commitment_on = excluded.commitment_on, notes = excluded.notes,
        is_historical = excluded.is_historical, recorded_by = excluded.recorded_by, recorded_at = now();
  perform private.audit(v_m.section_id, 'adesao_registada', 'adhesion', p_membership::text,
    jsonb_build_object('decided_on', p_decided_on, 'commitment_on', p_commitment_on, 'historical', p_is_historical));
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'adesao', 'Adesão registada',
    'A tua adesão (Desprendimento) foi registada.', '/progresso');
end
$$;

-- ---------------------------------------------------------------------------
-- Etapas
-- ---------------------------------------------------------------------------
create or replace function public.open_stage(p_membership uuid, p_stage_key text, p_insignia_on date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_m public.memberships;
  v_stage public.catalog_stages;
  v_id uuid;
begin
  v_m := private.progress_member(p_membership);
  perform private.assert_dirigente(v_m.section_id);
  select cs.* into v_stage from public.catalog_stages cs
    join public.sections s on s.catalog_version_id = cs.version_id
   where s.id = v_m.section_id and cs.key = p_stage_key and cs.kind = 'progresso';
  if v_stage.id is null then raise exception 'Etapa inválida.'; end if;
  -- Regra local L2: adesão registada e etapa anterior concluída.
  if not exists (select 1 from public.adhesions where membership_id = p_membership) then
    raise exception 'Regista primeiro a adesão (Desprendimento).';
  end if;
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
    'Começou a etapa ' || v_stage.name || '. Escolhe e negoceia um trilho de cada área.', '/progresso');
  return v_id;
exception when unique_violation then
  raise exception 'Esta etapa já foi aberta ou existe outra etapa em curso.';
end
$$;

-- Entrega da insígnia (no início da etapa; nunca automática no fim).
create or replace function public.record_insignia(p_stage_path uuid, p_date date)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_p public.stage_paths; v_section uuid;
begin
  select * into v_p from public.stage_paths where id = p_stage_path for update;
  select section_id into v_section from public.memberships where id = v_p.membership_id;
  if v_p.id is null then raise exception 'Etapa não encontrada.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_section);
  if p_date is null or p_date > current_date then raise exception 'Indica uma data válida.'; end if;
  update public.stage_paths set insignia_delivered_on = p_date, insignia_recorded_by = auth.uid() where id = p_stage_path;
end
$$;

-- Reconhecimento público (celebração), separado da conclusão.
create or replace function public.record_recognition(p_stage_path uuid, p_date date, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_p public.stage_paths; v_section uuid;
begin
  select * into v_p from public.stage_paths where id = p_stage_path for update;
  select section_id into v_section from public.memberships where id = v_p.membership_id;
  if v_p.id is null then raise exception 'Etapa não encontrada.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_section);
  if v_p.status <> 'concluida' then raise exception 'Só etapas concluídas podem ser reconhecidas.'; end if;
  if p_date is null or p_date > current_date then raise exception 'Indica uma data válida.'; end if;
  update public.stage_paths set recognized_on = p_date, recognition_note = nullif(trim(p_note), ''), recognized_by = auth.uid()
   where id = p_stage_path;
end
$$;

-- ---------------------------------------------------------------------------
-- Escolhas negociadas
-- ---------------------------------------------------------------------------
create or replace function public.propose_choice(p_stage_path uuid, p_trail uuid, p_planned text, p_replaces uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.stage_paths;
  v_m public.memberships;
  v_t public.catalog_trails;
  v_area text;
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
  select code into v_area from public.catalog_areas where id = v_t.area_id;

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

  if private.is_owner(v_m.id) then
    perform private.notify(private.section_dirigentes(v_m.section_id), v_m.section_id, 'escolha_proposta',
      'Proposta de trilho', 'Há uma proposta de escolha de trilho para negociar.', '/dirigentes/negociacao');
  else
    perform private.notify(array[v_m.profile_id], v_m.section_id, 'escolha_proposta',
      'Proposta de trilho', 'A Equipa de Animação propôs um trilho para a tua etapa.', '/progresso');
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Este trilho já está escolhido ou proposto, ou já existe uma proposta pendente nesta área.';
end
$$;

create or replace function public.decide_choice(p_choice uuid, p_accept boolean, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_c public.stage_choices; v_m public.memberships; v_p public.stage_paths;
begin
  select * into v_c from public.stage_choices where id = p_choice for update;
  if v_c.id is null then raise exception 'Escolha não encontrada.' using errcode = '42501'; end if;
  select * into v_m from public.memberships where id = v_c.membership_id;
  perform private.assert_dirigente(v_m.section_id);
  select * into v_p from public.stage_paths where id = v_c.stage_path_id for update;
  if v_c.status <> 'proposta' then raise exception 'Esta proposta já foi decidida.'; end if;
  if v_p.status <> 'em_curso' then raise exception 'A etapa já está concluída.'; end if;
  if not p_accept then
    perform private.require_text(p_comment, 'Indica o motivo para não aceitar a proposta.');
    update public.stage_choices set status = 'recusada', decided_by = auth.uid(), decided_at = now(), decision_comment = trim(p_comment)
     where id = p_choice;
  else
    if v_c.replaces_choice_id is not null then
      update public.stage_choices set status = 'substituida', decided_by = auth.uid(), decided_at = now()
       where id = v_c.replaces_choice_id and status = 'confirmada';
      if not found then raise exception 'A escolha a substituir já não está confirmada.'; end if;
    end if;
    update public.stage_choices set status = 'confirmada', decided_by = auth.uid(), decided_at = now(),
           decision_comment = nullif(trim(p_comment), '')
     where id = p_choice;
  end if;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'escolha_decidida',
    case when p_accept then 'Trilho confirmado' else 'Proposta de trilho não aceite' end,
    coalesce(nullif(trim(p_comment), ''), 'A Equipa de Animação decidiu a tua proposta.'), '/progresso');
exception when unique_violation then
  raise exception 'Já existe um trilho confirmado nesta área ou este trilho está noutra etapa.';
end
$$;

create or replace function public.withdraw_choice(p_choice uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_c public.stage_choices;
begin
  select * into v_c from public.stage_choices where id = p_choice for update;
  if v_c.id is null or not private.is_owner(v_c.membership_id) and not private.is_dirigente(
       (select section_id from public.memberships where id = v_c.membership_id)) then
    raise exception 'Escolha não encontrada.' using errcode = '42501';
  end if;
  if v_c.status <> 'proposta' then raise exception 'Só propostas pendentes podem ser retiradas.'; end if;
  update public.stage_choices set status = 'retirada', decided_by = auth.uid(), decided_at = now() where id = p_choice;
end
$$;

create or replace function public.update_choice_plan(p_choice uuid, p_planned text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_c public.stage_choices;
begin
  select * into v_c from public.stage_choices where id = p_choice for update;
  if v_c.id is null or not private.is_owner(v_c.membership_id) then
    raise exception 'Escolha não encontrada.' using errcode = '42501';
  end if;
  if v_c.status not in ('proposta', 'confirmada') then raise exception 'Esta escolha já não está ativa.'; end if;
  update public.stage_choices set planned_opportunities = nullif(trim(p_planned), '') where id = p_choice;
end
$$;

-- ---------------------------------------------------------------------------
-- Pedidos de validação de trilho
-- ---------------------------------------------------------------------------
create or replace function public.create_trail_request(p_membership uuid, p_trail uuid, p_kind public.request_kind)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships; v_t public.catalog_trails; v_id uuid;
begin
  v_m := private.progress_member(p_membership);
  if not private.is_owner(v_m.id) then raise exception 'Só o próprio pode criar pedidos.' using errcode = '42501'; end if;
  v_t := private.section_trail(v_m.section_id, p_trail);
  if p_kind = 'historico' and not private.historical_enabled(v_m.section_id) then
    raise exception 'O registo de progresso anterior está desativado nesta secção.';
  end if;
  insert into public.trail_requests (membership_id, section_id, trail_id, trail_key, kind, created_by)
  values (v_m.id, v_m.section_id, v_t.id, v_t.key, p_kind, auth.uid())
  returning id into v_id;
  insert into public.trail_request_versions (request_id, version_no) values (v_id, 1);
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um pedido ativo ou uma validação para este trilho.';
end
$$;

create or replace function private.lock_owned_request(p_request uuid)
returns public.trail_requests language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null or not private.is_owner(v_r.membership_id) then
    raise exception 'Pedido não encontrado.' using errcode = '42501';
  end if;
  return v_r;
end
$$;

create or replace function public.save_request_draft(
  p_request uuid, p_reflection text, p_experiences text, p_period_start date, p_period_end date, p_approximate_date text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status <> 'rascunho' then
    raise exception 'O pedido já foi submetido. Para alterar o conteúdo, retira-o ou cria uma nova versão.';
  end if;
  update public.trail_request_versions
     set reflection = left(coalesce(p_reflection, ''), 10000),
         experiences = left(coalesce(p_experiences, ''), 10000),
         period_start = p_period_start, period_end = p_period_end,
         approximate_date = nullif(left(trim(coalesce(p_approximate_date, '')), 100), ''),
         updated_at = now()
   where request_id = p_request and version_no = v_r.current_version and submitted_at is null;
  update public.trail_requests set updated_at = now() where id = p_request;
end
$$;

create or replace function public.submit_trail_request(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_v public.trail_request_versions; v_m public.memberships; v_trail text;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status <> 'rascunho' then raise exception 'Este pedido não está em rascunho.'; end if;
  -- O servidor impede novas submissões históricas com a opção desligada,
  -- mesmo que o formulário estivesse aberto ou a chamada seja direta à API.
  if v_r.kind = 'historico' and not private.historical_enabled(v_r.section_id) then
    raise exception 'O registo de progresso anterior foi desativado. Podes cancelar este pedido e usar o progresso normal, ou aguardar a reativação.';
  end if;
  select * into v_v from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
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

-- Retirar um pedido submetido (ainda sem decisão) para voltar a editar: a
-- versão submetida fica no histórico e cria-se nova versão em rascunho.
create or replace function private.new_draft_version(p_request uuid, p_from integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_new uuid; v_old uuid;
begin
  select id into v_old from public.trail_request_versions where request_id = p_request and version_no = p_from;
  insert into public.trail_request_versions (request_id, version_no, reflection, experiences, period_start, period_end, approximate_date)
  select request_id, p_from + 1, reflection, experiences, period_start, period_end, approximate_date
    from public.trail_request_versions where id = v_old
  returning id into v_new;
  insert into public.attachments (request_id, version_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  select request_id, v_new, storage_path, file_name, mime_type, size_bytes, uploaded_by
    from public.attachments where version_id = v_old;
  update public.trail_requests set current_version = p_from + 1, status = 'rascunho', updated_at = now() where id = p_request;
end
$$;

create or replace function public.withdraw_trail_request(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status not in ('submetido', 'em_revisao') then raise exception 'Só pedidos submetidos e ainda sem decisão podem ser retirados.'; end if;
  update public.trail_request_versions set withdrawn_at = now()
   where request_id = p_request and version_no = v_r.current_version;
  perform private.new_draft_version(p_request, v_r.current_version);
end
$$;

-- Depois de uma devolução, preparar nova versão (mantém histórico e comentários).
create or replace function public.start_new_version(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status <> 'devolvido' then raise exception 'Só pedidos devolvidos podem ter nova versão.'; end if;
  perform private.new_draft_version(p_request, v_r.current_version);
end
$$;

create or replace function public.cancel_trail_request(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status not in ('rascunho', 'submetido', 'em_revisao', 'devolvido') then
    raise exception 'Este pedido já foi decidido e não pode ser cancelado.';
  end if;
  update public.trail_requests set status = 'cancelado', updated_at = now() where id = p_request;
end
$$;

-- Anexos: o ficheiro é carregado para o bucket privado «anexos» em
-- <request_id>/<nome>; esta função regista-o na versão em rascunho.
create or replace function public.add_attachment(p_request uuid, p_path text, p_file_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_obj record; v_version uuid; v_id uuid;
begin
  v_r := private.lock_owned_request(p_request);
  if v_r.status <> 'rascunho' then raise exception 'Só é possível juntar anexos a pedidos em rascunho.'; end if;
  if split_part(p_path, '/', 1) <> p_request::text then raise exception 'Caminho de anexo inválido.'; end if;
  select o.name, o.owner_id, o.metadata into v_obj from storage.objects o where o.bucket_id = 'anexos' and o.name = p_path;
  if v_obj.name is null then raise exception 'O ficheiro ainda não foi carregado.'; end if;
  if v_obj.owner_id is distinct from auth.uid()::text then raise exception 'Ficheiro inválido.' using errcode = '42501'; end if;
  if (select count(*) from public.attachments a join public.trail_request_versions v on v.id = a.version_id
       where a.request_id = p_request and v.version_no = v_r.current_version) >= 10 then
    raise exception 'Máximo de 10 anexos por pedido.';
  end if;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.attachments (request_id, version_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (p_request, v_version, p_path, left(coalesce(nullif(trim(p_file_name), ''), 'anexo'), 200),
          coalesce(v_obj.metadata ->> 'mimetype', 'application/octet-stream'),
          greatest(coalesce((v_obj.metadata ->> 'size')::int, 1), 1), auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.remove_attachment(p_attachment uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_a public.attachments; v_r public.trail_requests; v_v public.trail_request_versions;
begin
  select * into v_a from public.attachments where id = p_attachment;
  if v_a.id is null then raise exception 'Anexo não encontrado.' using errcode = '42501'; end if;
  v_r := private.lock_owned_request(v_a.request_id);
  select * into v_v from public.trail_request_versions where id = v_a.version_id;
  if v_r.status <> 'rascunho' or v_v.submitted_at is not null then
    raise exception 'Só é possível remover anexos de um rascunho.';
  end if;
  delete from public.attachments where id = p_attachment;
end
$$;

-- ---------------------------------------------------------------------------
-- Decisões sobre pedidos
-- ---------------------------------------------------------------------------

-- Quem pode registar a decisão da reunião de Equipa: o guia ATUAL da equipa do
-- membro (nunca sobre o próprio pedido) ou um dirigente (regra local L1).
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
  if v_me.function = 'guia' and v_me.team_id = v_m.team_id and v_m.status = 'ativo' then return 'guia'; end if;
  return null;
end
$$;

create or replace function public.mark_request_in_review(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_role text; v_version uuid;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  if v_r.kind = 'normal' then v_role := private.team_recorder_role(v_r);
  elsif private.is_dirigente(v_r.section_id) and not private.is_owner(v_r.membership_id) then v_role := 'dirigente';
  end if;
  if v_role is null then raise exception 'Sem permissão para analisar este pedido.' using errcode = '42501'; end if;
  if v_r.status <> 'submetido' then raise exception 'O pedido não está à espera de análise.'; end if;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  update public.trail_requests set status = 'em_revisao', updated_at = now() where id = p_request;
  insert into public.trail_decisions (request_id, version_id, kind, recorded_by, recorded_as)
  values (p_request, v_version, 'em_revisao', auth.uid(), v_role);
end
$$;

-- Registo da decisão tomada na reunião de Equipa.
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
  if p_meeting_date is null or p_meeting_date > current_date then raise exception 'Indica a data da reunião de Equipa.'; end if;
  if not p_validated then perform private.require_text(p_comment, 'Explica o que falta trabalhar.'); end if;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
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
  -- Comunicação ao Conselho de Guias.
  perform private.notify(private.section_dirigentes(v_m.section_id) || private.section_guias(v_m.section_id), v_m.section_id,
    'comunicacao_conselho', 'Comunicação ao Conselho de Guias',
    'Decisão da reunião de Equipa sobre o trilho ' || v_trail || '.', '/conselho');
exception when unique_violation then
  raise exception 'Já foi registada uma decisão para esta versão do pedido.';
end
$$;

-- Devolução fundamentada após comunicação ao Conselho de Guias (validação manifestamente incoerente).
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
  update public.trail_requests set status = 'devolvido', updated_at = now() where id = p_request;
  select * into v_m from public.memberships where id = v_r.membership_id;
  perform private.notify(array[v_m.profile_id] || private.team_guias(v_m.team_id), v_m.section_id, 'devolucao_conselho',
    'Trilho devolvido pelo Conselho de Guias', trim(p_comment), '/pedidos/' || p_request);
end
$$;

-- Nota de revisão da Equipa de Animação (não altera o estado nem é obrigatória).
create or replace function public.record_animation_review(p_request uuid, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_version uuid; v_m public.memberships;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_r.section_id);
  if v_r.status in ('rascunho', 'cancelado') then raise exception 'O pedido ainda não foi submetido.'; end if;
  perform private.require_text(p_comment, 'Escreve a nota de revisão.');
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, comment, recorded_by, recorded_as)
  values (p_request, v_version, 'revisao_animacao', trim(p_comment), auth.uid(), 'dirigente');
  select * into v_m from public.memberships where id = v_r.membership_id;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'revisao_animacao',
    'Nota da Equipa de Animação', trim(p_comment), '/pedidos/' || p_request);
end
$$;

-- Decisão de dirigente sobre progresso anterior. Continua possível mesmo com a
-- opção desligada (pedidos já submetidos continuam avaliáveis).
create or replace function public.decide_historical_request(
  p_request uuid, p_expected_version integer, p_outcome text, p_comment text, p_reference_date date
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_version uuid; v_m public.memberships; v_trail text;
begin
  select * into v_r from public.trail_requests where id = p_request for update;
  if v_r.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_r.section_id);
  if private.is_owner(v_r.membership_id) then raise exception 'Não é possível decidir o próprio pedido.' using errcode = '42501'; end if;
  if v_r.kind <> 'historico' then raise exception 'Este pedido não é de progresso anterior.'; end if;
  if v_r.status not in ('submetido', 'em_revisao') then raise exception 'Este pedido já foi decidido ou não está submetido.'; end if;
  if p_expected_version is distinct from v_r.current_version then raise exception 'O pedido mudou entretanto. Atualiza a página.'; end if;
  if p_outcome not in ('aprovado', 'recusado', 'devolvido') then raise exception 'Decisão inválida.'; end if;
  if p_outcome in ('recusado', 'devolvido') then perform private.require_text(p_comment, 'Indica o motivo da decisão.'); end if;
  if p_reference_date > current_date then raise exception 'A data de referência não pode ser futura.'; end if;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, comment, reference_date, recorded_by, recorded_as)
  values (p_request, v_version, (p_outcome || '_historico')::public.decision_kind, nullif(trim(p_comment), ''),
          case when p_outcome = 'aprovado' then p_reference_date end, auth.uid(), 'dirigente');
  update public.trail_requests
     set status = p_outcome::public.request_status,
         approved_reference_date = case when p_outcome = 'aprovado' then p_reference_date end,
         updated_at = now()
   where id = p_request;
  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'decisao_historico',
    case p_outcome when 'aprovado' then 'Progresso anterior reconhecido'
                   when 'recusado' then 'Progresso anterior não reconhecido'
                   else 'Progresso anterior devolvido para correção' end,
    v_trail || coalesce(': ' || nullif(trim(p_comment), ''), ''), '/pedidos/' || p_request);
exception when unique_violation then
  raise exception 'Já foi registada uma decisão para esta versão do pedido.';
end
$$;

-- ---------------------------------------------------------------------------
-- Validação da etapa
-- ---------------------------------------------------------------------------

-- Trilhos confirmados da etapa e se estão validados.
create or replace function private.stage_ready(p_stage_path uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select count(*) = (select count(*) from public.catalog_areas a join public.catalog_stages cs on cs.version_id = a.version_id
                      join public.stage_paths sp on sp.stage_id = cs.id where sp.id = p_stage_path)
     and bool_and(c.trail_key in (select private.validated_trail_keys(c.membership_id)))
  from public.stage_choices c
  where c.stage_path_id = p_stage_path and c.status = 'confirmada'
$$;

create or replace function public.request_stage_validation(p_stage_path uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_p public.stage_paths; v_m public.memberships; v_me public.memberships; v_id uuid;
begin
  select * into v_p from public.stage_paths where id = p_stage_path for update;
  if v_p.id is null then raise exception 'Etapa não encontrada.' using errcode = '42501'; end if;
  v_m := private.progress_member(v_p.membership_id);
  v_me := private.my_active_membership(v_m.section_id);
  if not (v_me.id = v_m.id or v_me.function = 'dirigente'
          or (v_me.function = 'guia' and v_me.team_id = v_m.team_id)) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if v_p.status <> 'em_curso' then raise exception 'A etapa já está concluída.'; end if;
  if not coalesce(private.stage_ready(p_stage_path), false) then
    raise exception 'Faltam trilhos confirmados e validados (um de cada área) para pedir a validação da etapa.';
  end if;
  insert into public.stage_requests (stage_path_id, membership_id, requested_by)
  values (p_stage_path, v_m.id, auth.uid()) returning id into v_id;
  perform private.notify(private.section_dirigentes(v_m.section_id) || private.section_guias(v_m.section_id), v_m.section_id,
    'pedido_etapa', 'Validação de etapa', 'Há uma etapa pronta para o Conselho de Guias.', '/conselho');
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um pedido de validação desta etapa em curso.';
end
$$;

create or replace function public.record_council_stage_decision(
  p_stage_request uuid, p_decision public.council_decision, p_date date, p_comment text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_s public.stage_requests; v_m public.memberships;
begin
  select * into v_s from public.stage_requests where id = p_stage_request for update;
  if v_s.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  select * into v_m from public.memberships where id = v_s.membership_id;
  perform private.assert_dirigente(v_m.section_id);
  if v_s.status <> 'submetido' then raise exception 'A decisão do Conselho de Guias já foi registada.'; end if;
  if p_date is null or p_date > current_date then raise exception 'Indica a data do Conselho de Guias.'; end if;
  if p_decision = 'desfavoravel' then perform private.require_text(p_comment, 'Fundamenta a decisão do Conselho de Guias.'); end if;
  update public.stage_requests
     set status = 'decidido_conselho', council_decision = p_decision, council_date = p_date,
         council_comment = nullif(trim(p_comment), ''), council_recorded_by = auth.uid(), council_recorded_at = now()
   where id = p_stage_request;
end
$$;

-- Opinião final da Equipa de Animação: só após esta confirmação a etapa fica concluída.
create or replace function public.record_final_opinion(
  p_stage_request uuid, p_opinion public.final_opinion, p_date date, p_comment text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_s public.stage_requests; v_m public.memberships; v_stage text;
begin
  select * into v_s from public.stage_requests where id = p_stage_request for update;
  if v_s.id is null then raise exception 'Pedido não encontrado.' using errcode = '42501'; end if;
  select * into v_m from public.memberships where id = v_s.membership_id;
  perform private.assert_dirigente(v_m.section_id);
  if v_s.status <> 'decidido_conselho' then raise exception 'Regista primeiro a decisão do Conselho de Guias.'; end if;
  if p_date is null or p_date > current_date then raise exception 'Indica a data.'; end if;
  if (p_opinion = 'confirmada' and v_s.council_decision = 'desfavoravel')
     or (p_opinion = 'nao_confirmada' and v_s.council_decision = 'favoravel') then
    perform private.require_text(p_comment, 'A opinião diverge do Conselho de Guias: a fundamentação é obrigatória.');
  end if;
  if p_opinion = 'nao_confirmada' then perform private.require_text(p_comment, 'Fundamenta a opinião.'); end if;
  perform 1 from public.stage_paths where id = v_s.stage_path_id for update;
  if p_opinion = 'confirmada' and not coalesce(private.stage_ready(v_s.stage_path_id), false) then
    raise exception 'Os trilhos da etapa já não estão todos validados.';
  end if;
  update public.stage_requests
     set status = p_opinion::text::public.stage_request_status, final_opinion = p_opinion, final_date = p_date,
         final_comment = nullif(trim(p_comment), ''), final_recorded_by = auth.uid(), final_recorded_at = now()
   where id = p_stage_request;
  if p_opinion = 'confirmada' then
    update public.stage_paths set status = 'concluida', completed_on = p_date, completion_kind = 'normal'
     where id = v_s.stage_path_id;
  end if;
  select cs.name into v_stage from public.stage_paths sp join public.catalog_stages cs on cs.id = sp.stage_id where sp.id = v_s.stage_path_id;
  perform private.notify(array[v_m.profile_id] || private.team_guias(v_m.team_id), v_m.section_id, 'etapa_decidida',
    case when p_opinion = 'confirmada' then 'Etapa ' || v_stage || ' concluída' else 'Etapa ' || v_stage || ' ainda não concluída' end,
    nullif(trim(p_comment), ''), '/progresso');
end
$$;

-- Declaração de etapa anterior (decisão própria do dirigente, com fundamentação).
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
  if exists (select 1 from public.stage_requests where stage_path_id = p_stage_path and status in ('submetido', 'decidido_conselho')) then
    raise exception 'Existe um pedido de validação desta etapa em curso.';
  end if;
  insert into public.stage_requests (stage_path_id, membership_id, kind, status, requested_by, final_opinion, final_date,
                                     final_comment, final_recorded_by, final_recorded_at)
  values (p_stage_path, v_m.id, 'historico', 'confirmada', auth.uid(), 'confirmada', p_date, trim(p_comment), auth.uid(), now());
  update public.stage_paths set status = 'concluida', completed_on = p_date, completion_kind = 'historico' where id = p_stage_path;
end
$$;

-- ---------------------------------------------------------------------------
-- Anilha de mérito
-- ---------------------------------------------------------------------------
create or replace function private.merit_status(p_membership uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with m as (select * from public.memberships where id = p_membership),
  total as (
    select count(*)::int n from public.catalog_trails t join public.sections s on s.catalog_version_id = t.version_id
     join m on m.section_id = s.id
  ),
  validated as (
    select count(*)::int n from (select private.validated_trail_keys(p_membership) k) v
     where v.k in (select t.key from public.catalog_trails t join public.sections s on s.catalog_version_id = t.version_id
                    join m on m.section_id = s.id)
  ),
  last_stage as (
    select exists (
      select 1 from public.stage_paths sp
       where sp.membership_id = p_membership and sp.status = 'concluida'
         and sp.stage_ordinal = (select max(cs.ordinal) from public.catalog_stages cs
                                   join public.sections s on s.catalog_version_id = cs.version_id
                                   join m on m.section_id = s.id where cs.kind = 'progresso')
    ) done
  )
  select jsonb_build_object(
    'validated', validated.n, 'total', total.n, 'last_stage_concluded', last_stage.done,
    'eligible', validated.n = total.n and total.n > 0 and last_stage.done)
  from total, validated, last_stage
$$;

create or replace function public.merit_eligibility(p_membership uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_view_progress(p_membership) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  return private.merit_status(p_membership);
end
$$;

create or replace function public.award_merit(p_membership uuid, p_awarded_on date, p_historical boolean, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_m public.memberships; v_status jsonb;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null then raise exception 'Membro não encontrado.' using errcode = '42501'; end if;
  perform private.assert_dirigente(v_m.section_id);
  if v_m.function not in ('pioneiro', 'guia') then raise exception 'Só pioneiros e guias recebem a anilha de mérito.'; end if;
  if p_awarded_on is null or p_awarded_on > current_date then raise exception 'Indica a data de atribuição.'; end if;
  v_status := private.merit_status(p_membership);
  if not (v_status ->> 'eligible')::boolean then
    if not coalesce(p_historical, false) then
      raise exception 'Ainda não cumpre os critérios: todos os trilhos da secção validados e a última etapa concluída.';
    end if;
    perform private.require_text(p_comment, 'Uma declaração de mérito anterior exige fundamentação.');
  end if;
  insert into public.merit_awards (membership_id, awarded_on, kind, comment, recorded_by)
  values (p_membership, p_awarded_on,
          case when (v_status ->> 'eligible')::boolean then 'normal' else 'historico' end,
          nullif(trim(p_comment), ''), auth.uid());
  perform private.audit(v_m.section_id, 'anilha_merito', 'membership', p_membership::text, v_status);
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'merito', 'Anilha de mérito',
    'Foi registada a atribuição da tua anilha de mérito.', '/progresso');
exception when unique_violation then
  raise exception 'A anilha de mérito já foi registada para este membro.';
end
$$;

-- ---------------------------------------------------------------------------
-- Exportação (dirigentes): dados pedagógicos da secção em JSON.
-- ---------------------------------------------------------------------------
create or replace function public.export_section(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_dirigente(p_section);
  return jsonb_build_object(
    'exported_at', now(),
    'section', (select to_jsonb(s) from public.sections s where s.id = p_section),
    'settings', (select to_jsonb(x) from public.section_settings x where x.section_id = p_section),
    'teams', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.teams t where t.section_id = p_section),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('membership', to_jsonb(m) - 'invite_id',
                  'profile', jsonb_build_object('full_name', p.full_name, 'totem', p.totem))), '[]')
                from public.memberships m join public.profiles p on p.id = m.profile_id where m.section_id = p_section),
    'adhesions', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.adhesions a
                  join public.memberships m on m.id = a.membership_id where m.section_id = p_section),
    'stage_paths', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.stage_paths x
                    join public.memberships m on m.id = x.membership_id where m.section_id = p_section),
    'stage_choices', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.stage_choices x
                      join public.memberships m on m.id = x.membership_id where m.section_id = p_section),
    'trail_requests', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.trail_requests x where x.section_id = p_section),
    'trail_request_versions', (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from public.trail_request_versions v
                               join public.trail_requests r on r.id = v.request_id where r.section_id = p_section),
    'attachments', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.attachments a
                    join public.trail_requests r on r.id = a.request_id where r.section_id = p_section),
    'trail_decisions', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from public.trail_decisions d
                        join public.trail_requests r on r.id = d.request_id where r.section_id = p_section),
    'stage_requests', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.stage_requests x
                       join public.memberships m on m.id = x.membership_id where m.section_id = p_section),
    'merit_awards', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.merit_awards x
                     join public.memberships m on m.id = x.membership_id where m.section_id = p_section)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Privilégios das funções: apenas utilizadores autenticados.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
