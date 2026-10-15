-- Pioneiros — fecho por trilho, remoção de notificações e ligações atuais.
--
-- 1. A unidade de validação volta a ser o TRILHO. O pedido abrange o trilho e
--    todos os seus objetivos, com uma justificação conjunta; a reunião de
--    Equipa valida o trilho ou devolve-o para revisão (com fundamentação, que
--    pode indicar os objetivos ainda por demonstrar). Isto substitui a
--    validação formal objetivo a objetivo.
--    Os dados por objetivo já registados ficam como HISTÓRICO: não são apagados
--    nem convertidos em trilhos validados. Um pedido «objetivos_validados»
--    continua inativo e o trilho continua «Por fechar» até a reunião de
--    Equipa validar o trilho completo.
-- 2. Notificações: remoção recuperável (deleted_at), só do próprio
--    destinatário, sem tocar em pedidos, decisões ou histórico.
-- 3. O mesmo evento não é criado duas vezes para o mesmo destinatário e as
--    ligações das notificações apontam para as rotas atuais.
-- Aditivo: não apaga registos; as chamadas antigas continuam válidas ou
-- devolvem uma mensagem clara.

-- ---------------------------------------------------------------------------
-- 1. Pedido e decisão por trilho
-- ---------------------------------------------------------------------------

-- Objetivos que a fundamentação de uma devolução identifica como ainda por
-- demonstrar (só informativo: a decisão formal é sobre o trilho completo).
alter table public.trail_decisions add column if not exists objective_codes text[];

-- Pedir validação do trilho: guarda a justificação conjunta na versão em
-- rascunho e envia. Não fecha o trilho nem a etapa.
create or replace function public.submit_trail_validation(
  p_request uuid, p_expected_version integer, p_justification text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_r public.trail_requests; v_v public.trail_request_versions; v_m public.memberships; v_trail text;
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
  perform private.notify(private.team_guias(v_m.team_id) || case when v_m.function = 'guia'
           then private.section_dirigentes(v_m.section_id) else '{}'::uuid[] end,
    v_m.section_id, 'pedido_submetido', 'Novo pedido de validação',
    'Pedido de validação do trilho ' || v_trail || ' para a próxima reunião de Equipa.', '/revisoes/pedido/' || p_request);
end
$$;

-- O envio por objetivos foi substituído pelo pedido do trilho completo.
create or replace function public.submit_objectives_request(
  p_request uuid, p_expected_version integer, p_objectives uuid[], p_justification text
) returns void language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'A validação é feita por trilho completo. Atualiza a página e usa «Pedir validação do trilho».';
end
$$;

create or replace function public.record_objectives_decision(
  p_request uuid, p_expected_version integer, p_meeting_date date, p_decisions jsonb, p_comment text
) returns text language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'A decisão é sobre o trilho completo. Atualiza a página para validar o trilho ou devolvê-lo para revisão.';
end
$$;

-- Submissão com os campos de reflexão (progresso anterior e pedidos antigos).
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
  if length(trim(v_v.reflection)) = 0 and length(trim(v_v.evidence)) = 0 then
    raise exception 'Escreve a tua reflexão antes de submeter.';
  end if;
  if v_v.period_end > current_date + 1 then raise exception 'As datas das vivências não podem ser futuras.'; end if;
  delete from public.request_objectives where version_id = v_v.id and decision is null;
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

-- Nova versão (retirar / corrigir após «A rever»): copia o texto e os anexos.
-- As seleções e decisões por objetivo ficam só nas versões em que foram feitas.
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
  update public.trail_requests set current_version = p_from + 1, status = 'rascunho', updated_at = now() where id = p_request;
end
$$;

-- Cancelar: o pedido fica cancelado; as decisões por objetivo já registadas
-- continuam guardadas como histórico (não fecham o trilho).
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

-- Decisão da reunião de Equipa sobre o trilho completo: validado, ou a rever
-- com fundamentação (pode identificar objetivos ainda por demonstrar).
-- Um dirigente pode registá-la em nome da reunião (regra L1, ex.: pedido do
-- próprio guia); quando a equipa tem guia, este é avisado do registo.
drop function if exists public.record_team_decision(uuid, integer, boolean, date, text);
create or replace function public.record_team_decision(
  p_request uuid, p_expected_version integer, p_validated boolean, p_meeting_date date, p_comment text,
  p_objective_codes text[] default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.trail_requests; v_role text; v_version uuid; v_m public.memberships; v_trail text; v_codes text[]; v_bad integer;
  v_owner_guias uuid[];
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

  -- Serializa decisões sobre o mesmo membro.
  perform 1 from public.memberships where id = v_r.membership_id for update;
  select id into v_version from public.trail_request_versions where request_id = p_request and version_no = v_r.current_version;
  insert into public.trail_decisions (request_id, version_id, kind, meeting_date, comment, objective_codes, recorded_by, recorded_as)
  values (p_request, v_version, case when p_validated then 'validado_equipa' else 'devolvido_equipa' end::public.decision_kind,
          p_meeting_date, nullif(trim(p_comment), ''), v_codes, auth.uid(), v_role);
  update public.trail_requests set status = case when p_validated then 'validado_equipa' else 'devolvido' end::public.request_status,
         updated_at = now()
   where id = p_request;

  select * into v_m from public.memberships where id = v_r.membership_id;
  select name into v_trail from public.catalog_trails where id = v_r.trail_id;
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'decisao_equipa',
    case when p_validated then 'Trilho validado na Equipa' else 'Trilho a rever' end,
    v_trail || coalesce(' · por demonstrar: ' || array_to_string(v_codes, ', '), '') || coalesce(': ' || nullif(trim(p_comment), ''), ''),
    '/pedidos/' || p_request);
  -- Comunicação ao Conselho de Guias (sem repetir o aviso ao próprio pioneiro).
  perform private.notify(array(select x from unnest(private.section_dirigentes(v_m.section_id) || private.section_guias(v_m.section_id)) x
                               where x is distinct from v_m.profile_id),
    v_m.section_id, 'comunicacao_conselho', 'Comunicação ao Conselho de Guias',
    'Decisão da reunião de Equipa sobre o trilho ' || v_trail || '.', '/conselho');
  -- Registo por um dirigente: o guia da equipa fica a saber (não substitui a reunião em silêncio).
  if v_role = 'dirigente' then
    v_owner_guias := array(select x from unnest(private.team_guias(v_m.team_id)) x where x is distinct from v_m.profile_id);
    perform private.notify(v_owner_guias, v_m.section_id, 'registo_animacao', 'Decisão registada pela Equipa de Animação',
      'Foi registada, em nome da reunião de Equipa, a decisão sobre o trilho ' || v_trail || '.', '/revisoes/pedido/' || p_request);
  end if;
exception when unique_violation then
  raise exception 'Já foi registada uma decisão para esta versão do pedido.';
end
$$;

-- Devolução fundamentada pelo Conselho de Guias. As decisões por objetivo de
-- versões anteriores ficam como estão (histórico).
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

-- ---------------------------------------------------------------------------
-- 2. Notificações: remoção recuperável
-- ---------------------------------------------------------------------------
alter table public.notifications add column if not exists deleted_at timestamptz;
create index if not exists notifications_visible on public.notifications (profile_id, created_at desc) where deleted_at is null;

-- As removidas deixam de ser lidas (não reaparecem ao atualizar a página).
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (profile_id = (select auth.uid()) and deleted_at is null);

create or replace function public.mark_notifications_read(p_ids uuid[])
returns void language sql security definer set search_path = ''
as $$
  update public.notifications set read_at = now()
   where profile_id = auth.uid() and read_at is null and deleted_at is null and (p_ids is null or id = any (p_ids))
$$;

-- Remove (de forma recuperável) notificações do próprio utilizador.
--   p_scope = 'ids'   → as indicadas em p_ids
--   p_scope = 'lidas' → todas as já lidas
--   p_scope = 'todas' → todas
-- Devolve os identificadores removidos (para «Desfazer»). Nunca toca em
-- pedidos, decisões, justificações ou histórico pedagógico.
create or replace function public.remove_notifications(p_scope text, p_ids uuid[] default null)
returns uuid[] language plpgsql security definer set search_path = ''
as $$
declare v_ids uuid[];
begin
  if auth.uid() is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if p_scope not in ('ids', 'lidas', 'todas') then raise exception 'Opção inválida.'; end if;
  if p_scope = 'ids' and coalesce(cardinality(p_ids), 0) = 0 then return '{}'; end if;
  with removed as (
    update public.notifications set deleted_at = now()
     where profile_id = auth.uid() and deleted_at is null
       and (p_scope = 'todas' or (p_scope = 'lidas' and read_at is not null) or (p_scope = 'ids' and id = any (p_ids)))
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from removed;
  return v_ids;
end
$$;

-- Desfazer: repõe notificações removidas do próprio utilizador.
create or replace function public.restore_notifications(p_ids uuid[])
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  update public.notifications set deleted_at = null
   where profile_id = auth.uid() and deleted_at is not null and id = any (coalesce(p_ids, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Ligações atuais e notificações sem duplicados
-- ---------------------------------------------------------------------------

-- Destino atual de uma ligação (endereços antigos de «Dirigentes» e dos seis
-- separadores do Acompanhamento), adaptado a quem a recebe.
create or replace function private.notification_link(p_kind text, p_link text, p_profile uuid, p_section uuid)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v_dir boolean; v_path text := split_part(coalesce(p_link, ''), '?', 1);
begin
  if p_link is null then return null; end if;
  v_dir := exists (select 1 from public.memberships m where m.profile_id = p_profile and m.section_id = p_section
                    and m.status = 'ativo' and m.function = 'dirigente');
  v_path := regexp_replace(v_path, '^/dirigentes', '/acompanhamento');
  return case
    when v_path = '/conselho' then
      case when v_dir then '/acompanhamento/etapas' || case when p_kind = 'comunicacao_conselho' then '?ver=trilhos' else '' end
           else '/equipa' end
    when v_path = '/acompanhamento/negociacao' then '/acompanhamento/pedidos?tipo=negociacao'
    when v_path = '/acompanhamento/historico' then '/acompanhamento/pedidos?tipo=anterior'
    when v_path = '/acompanhamento/pedidos' and position('?' in p_link) = 0 then '/acompanhamento/pedidos?tipo=trilhos'
    when v_path = '/acompanhamento/conselho' then '/acompanhamento/etapas'
    when v_path = '/acompanhamento/merito' then '/acompanhamento/seccao?ver=merito'
    when v_path = '/acompanhamento' then '/acompanhamento/seccao'
    when v_path = '/pedidos' then '/meu-progresso?vista=pedidos'
    when v_path = '/progresso' then '/meu-progresso'
    when p_link ~ '^/dirigentes' then regexp_replace(p_link, '^/dirigentes', '/acompanhamento')
    else p_link
  end;
end
$$;

-- Cria uma notificação por destinatário (nunca para quem fez a ação). Se o
-- mesmo destinatário ainda tem por ler o mesmo aviso (tipo, ligação e texto),
-- esse aviso sobe para o topo em vez de ser repetido.
create or replace function private.notify(
  p_profiles uuid[], p_section uuid, p_kind text, p_title text, p_body text, p_link text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_pid uuid; v_link text;
begin
  for v_pid in select distinct x from unnest(coalesce(p_profiles, '{}')) x where x is not null and x is distinct from auth.uid()
  loop
    v_link := private.notification_link(p_kind, p_link, v_pid, p_section);
    update public.notifications n set created_at = now()
     where n.profile_id = v_pid and n.kind = p_kind and n.link is not distinct from v_link
       and n.title = p_title and n.body is not distinct from p_body and n.read_at is null and n.deleted_at is null;
    if not found then
      insert into public.notifications (profile_id, section_id, kind, title, body, link)
      values (v_pid, p_section, p_kind, p_title, p_body, v_link);
    end if;
  end loop;
end
$$;

-- Notificações já guardadas passam a apontar para as rotas atuais.
update public.notifications n
   set link = private.notification_link(n.kind, n.link, n.profile_id, n.section_id)
 where n.link is distinct from private.notification_link(n.kind, n.link, n.profile_id, n.section_id);

-- ---------------------------------------------------------------------------
-- 4. Contadores do Acompanhamento (cada pedido conta uma vez, num só tipo)
-- ---------------------------------------------------------------------------
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
     where m.section_id = p_section and m.status = 'ativo' and c.status = 'proposta';
    select count(*) filter (where r.kind = 'normal'), count(*) filter (where r.kind = 'historico') into v_tri, v_ant
      from public.trail_requests r join public.memberships m on m.id = r.membership_id
     where r.section_id = p_section and m.status = 'ativo' and r.status in ('submetido', 'em_revisao');
    select count(*) into v_eta from public.stage_requests s join public.memberships m on m.id = s.membership_id
     where m.section_id = p_section and m.status = 'ativo' and s.status in ('submetido', 'decidido_conselho');
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

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on function private.new_draft_version(uuid, integer) from public, anon, authenticated;
revoke all on function private.notify(uuid[], uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function private.notification_link(text, text, uuid, uuid) from public, anon, authenticated;
notify pgrst, 'reload schema';
