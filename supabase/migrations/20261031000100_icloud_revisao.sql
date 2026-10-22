-- Pioneiros — Calendário do iCloud: rever antes de publicar.
--
-- • Cada ligação ao iCloud tem «Rever antes de publicar» (ligado por omissão, também nas
--   ligações que já existem). Com a revisão ligada, a sincronização não mexe no Calendário:
--   o que é novo, alterado, cancelado ou removido no iCloud fica numa caixa de revisão
--   (cal_source_inbox) que só a administração vê em Gestão › Calendário iCloud.
-- • Aprovar aplica a mudança (como a sincronização direta fazia). Numa atividade nova ou
--   alterada, o título, o local e a descrição podem ser corrigidos antes de aprovar.
-- • Rejeitar guarda a decisão: a mesma versão não volta a aparecer; se o iCloud a mudar
--   outra vez, aparece de novo para rever.
-- • Com a revisão desligada, tudo funciona como antes (private.cal_source_apply_direct).
-- Aditivo: não altera atividades já publicadas.

alter table public.cal_sources add column if not exists review boolean not null default true;
update public.cal_sources set review = true where not review;

create table if not exists public.cal_source_inbox (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  source_id uuid not null references public.cal_sources (id) on delete cascade,
  source_uid text not null,
  source_rid text not null default '',
  event_id uuid references public.cal_events (id) on delete cascade,
  kind text not null check (kind in ('nova', 'alterada', 'cancelada', 'removida')),
  item jsonb not null default '{}'::jsonb,
  status text not null default 'pendente' check (status in ('pendente', 'rejeitada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  unique (source_id, source_uid, source_rid)
);
create index if not exists cal_source_inbox_pending on public.cal_source_inbox (section_id, status);
alter table public.cal_source_inbox enable row level security;
revoke all on public.cal_source_inbox from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sincronização direta (sem revisão): exatamente o comportamento anterior.
-- ---------------------------------------------------------------------------
create or replace function private.cal_source_apply_direct(p_source uuid, p_feed jsonb, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  s public.cal_sources; e public.cal_events; it record;
  v_keys text[]; v_from date; v_to date; v_complete boolean; v_title text; v_desc text; v_loc text;
  v_created int := 0; v_updated int := 0; v_cancelled int := 0; v_removed int := 0; v_reactivated int := 0;
  v_same int := 0; v_invalid int := 0; v_missing int; v_active int; v_warning text; v_pending int := 0;
  v_now timestamptz := now(); v_changed boolean; v_back boolean; v_stats jsonb;
begin
  if not private.is_service_role() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into s from public.cal_sources where id = p_source for update;
  if s.id is null then raise exception 'Registo não encontrado.'; end if;
  if s.status <> 'ativa' then return jsonb_build_object('skipped', true); end if;
  if jsonb_typeof(p_feed -> 'items') is distinct from 'array' then raise exception 'Conteúdo inválido.'; end if;
  v_from := (p_feed ->> 'window_from')::date;
  v_to := (p_feed ->> 'window_to')::date;
  v_complete := coalesce((p_feed ->> 'complete')::boolean, false) and v_from is not null and v_to is not null;
  v_keys := array(select coalesce(x ->> 'uid', '') || '|' || coalesce(x ->> 'rid', '') from jsonb_array_elements(p_feed -> 'items') x);

  for it in select * from jsonb_to_recordset(p_feed -> 'items') as x(
      uid text, rid text, title text, description text, location text, all_day boolean,
      starts_at timestamptz, ends_at timestamptz, start_date date, end_date date, cancelled boolean) loop
    it.rid := coalesce(it.rid, '');
    if coalesce(it.uid, '') = '' or length(it.uid) > 1000 or length(it.rid) > 100
       or (coalesce(it.all_day, false) and (it.start_date is null or it.end_date is null or it.end_date < it.start_date))
       or (not coalesce(it.all_day, false) and (it.starts_at is null or it.ends_at is null or it.ends_at < it.starts_at)) then
      v_invalid := v_invalid + 1;
      continue;
    end if;
    v_title := left(coalesce(nullif(trim(it.title), ''), '(Sem título)'), 200);
    v_desc := left(nullif(trim(it.description), ''), 5000);
    v_loc := left(nullif(trim(it.location), ''), 300);

    e := null;
    select * into e from public.cal_events where source_id = s.id and source_uid = it.uid and source_rid = it.rid for update;
    -- A série mudou de hora: a ocorrência do mesmo dia mantém-se (e as ligações com ela).
    if e.id is null and it.rid <> '' then
      select * into e from public.cal_events x
       where x.source_id = s.id and x.source_uid = it.uid and x.source_rid <> '' and left(x.source_rid, 8) = left(it.rid, 8)
         and not ((x.source_uid || '|' || x.source_rid) = any (v_keys))
       order by x.created_at limit 1 for update;
    end if;

    if e.id is null then
      if coalesce(it.cancelled, false) then continue; end if;
      insert into public.cal_events (section_id, space, title, description, location, all_day, starts_at, ends_at, start_date, end_date,
        audience, team_id, reminder_minutes, deadline_reminder_minutes, status, created_by, created_at, updated_at,
        source_id, source_uid, source_rid, source_state, source_synced_at)
      values (s.section_id, s.space, v_title, v_desc, v_loc, it.all_day,
        case when it.all_day then null else it.starts_at end, case when it.all_day then null else it.ends_at end,
        case when it.all_day then it.start_date end, case when it.all_day then it.end_date end,
        s.audience, s.team_id, s.reminder_minutes, '{}', 'ativo', s.created_by, v_now, v_now,
        s.id, it.uid, it.rid, 'ok', v_now)
      returning * into e;
      if cardinality(s.reminder_minutes) > 0 then perform private.cal_sync_reminders(e.id); end if;
      v_created := v_created + 1;
      continue;
    end if;

    if coalesce(it.cancelled, false) then
      if e.status = 'ativo' then
        update public.cal_events set status = 'cancelado', cancel_reason = 'Cancelada no iCloud.', cancelled_at = v_now,
               cancelled_by = null, source_state = 'cancelado', source_rid = it.rid, source_synced_at = v_now, updated_at = v_now
         where id = e.id;
        perform private.cal_sync_reminders(e.id);
        v_cancelled := v_cancelled + 1;
      else
        update public.cal_events set source_synced_at = v_now, source_rid = it.rid where id = e.id;
        v_same := v_same + 1;
      end if;
      continue;
    end if;

    v_changed := (e.title, e.description, e.location, e.all_day, e.starts_at, e.ends_at, e.start_date, e.end_date, e.source_rid)
      is distinct from (v_title, v_desc, v_loc, it.all_day,
        case when it.all_day then null else it.starts_at end, case when it.all_day then null else it.ends_at end,
        case when it.all_day then it.start_date end, case when it.all_day then it.end_date end, it.rid);
    -- Volta a existir no iCloud: reativa só o que a sincronização tinha cancelado.
    v_back := e.status = 'cancelado' and e.cancelled_by is null and coalesce(e.source_state, 'ok') <> 'ok';
    if v_changed or v_back then
      update public.cal_events set
        title = v_title, description = v_desc, location = v_loc, all_day = it.all_day,
        starts_at = case when it.all_day then null else it.starts_at end, ends_at = case when it.all_day then null else it.ends_at end,
        start_date = case when it.all_day then it.start_date end, end_date = case when it.all_day then it.end_date end,
        source_rid = it.rid, source_synced_at = v_now, updated_at = v_now,
        status = case when v_back then 'ativo' else status end,
        cancel_reason = case when v_back then null else cancel_reason end,
        cancelled_at = case when v_back then null else cancelled_at end,
        source_state = case when v_back then 'ok' else source_state end,
        source_removed_at = case when v_back then null else source_removed_at end
      where id = e.id;
      perform private.cal_sync_reminders(e.id);
      if v_back then v_reactivated := v_reactivated + 1; else v_updated := v_updated + 1; end if;
    else
      update public.cal_events set source_synced_at = v_now where id = e.id;
      v_same := v_same + 1;
    end if;
  end loop;

  -- Atividades que deixaram de vir do iCloud (só dentro da janela lida e com leitura completa).
  if v_invalid > 0 then v_complete := false; end if;
  if not v_complete then
    v_warning := 'A leitura não foi completa: nenhuma atividade foi retirada.';
  elsif jsonb_array_length(p_feed -> 'items') = 0 then
    v_warning := 'O calendário veio vazio: por segurança, nenhuma atividade foi retirada.';
  else
    select count(*) filter (where not ((x.source_uid || '|' || x.source_rid) = any (v_keys))), count(*)
      into v_missing, v_active
      from public.cal_events x
     where x.source_id = s.id and x.status = 'ativo'
       and private.cal_first_day(x) <= v_to and private.cal_last_day(x) >= v_from;
    if v_missing > 0 and not coalesce(p_force, false) and v_missing >= 5 and v_missing * 2 > v_active then
      v_pending := v_missing;
      v_warning := v_missing || ' atividades deixaram de aparecer no iCloud (de ' || v_active || '). Por segurança, nada foi retirado: confirma em «Sincronizar agora».';
    elsif v_missing > 0 then
      for e in select * from public.cal_events x
                where x.source_id = s.id and x.status = 'ativo' and not ((x.source_uid || '|' || x.source_rid) = any (v_keys))
                  and private.cal_first_day(x) <= v_to and private.cal_last_day(x) >= v_from
                for update loop
        update public.cal_events set status = 'cancelado', cancel_reason = 'Removida no iCloud.', cancelled_at = v_now,
               cancelled_by = null, source_state = 'removido', source_removed_at = v_now, updated_at = v_now
         where id = e.id;
        perform private.cal_sync_reminders(e.id);
        v_removed := v_removed + 1;
      end loop;
    end if;
  end if;

  v_stats := jsonb_build_object('criadas', v_created, 'atualizadas', v_updated, 'canceladas', v_cancelled,
    'removidas', v_removed, 'reativadas', v_reactivated, 'sem_alteracao', v_same, 'ignoradas', v_invalid);
  update public.cal_sources x set
    calname = coalesce(left(nullif(trim(p_feed ->> 'name'), ''), 200), x.calname),
    last_attempt_at = v_now, last_success_at = v_now, last_error = null, last_error_at = null, failures = 0,
    last_stats = v_stats, last_warning = v_warning, pending_removals = v_pending,
    event_count = (select count(*) from public.cal_events c where c.source_id = s.id and c.status = 'ativo'),
    range_from = (select min(private.cal_first_day(c)) from public.cal_events c where c.source_id = s.id and c.status = 'ativo'),
    range_to = (select max(private.cal_last_day(c)) from public.cal_events c where c.source_id = s.id and c.status = 'ativo')
  where x.id = s.id;
  if v_created + v_updated + v_cancelled + v_removed + v_reactivated > 0 then
    perform private.cal_source_audit(s.section_id, null, 'cal_icloud_sincronizado', s.id, v_stats);
  end if;
  return v_stats;
end
$$;

-- Item do iCloud normalizado (o que se guarda na revisão e o que se compara com a atividade).
create or replace function private.cal_inbox_item(it jsonb)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'rid', coalesce(it ->> 'rid', ''),
    'title', left(coalesce(nullif(trim(it ->> 'title'), ''), '(Sem título)'), 200),
    'description', left(nullif(trim(it ->> 'description'), ''), 5000),
    'location', left(nullif(trim(it ->> 'location'), ''), 300),
    'all_day', coalesce((it ->> 'all_day')::boolean, false),
    'starts_at', case when coalesce((it ->> 'all_day')::boolean, false) then null else (it ->> 'starts_at')::timestamptz end,
    'ends_at', case when coalesce((it ->> 'all_day')::boolean, false) then null else (it ->> 'ends_at')::timestamptz end,
    'start_date', case when coalesce((it ->> 'all_day')::boolean, false) then (it ->> 'start_date')::date end,
    'end_date', case when coalesce((it ->> 'all_day')::boolean, false) then (it ->> 'end_date')::date end)
$$;

-- Propõe uma mudança (ou deixa-a como está, se a mesma versão já foi rejeitada).
create or replace function private.cal_inbox_propose(s public.cal_sources, p_uid text, p_rid text, p_event uuid, p_kind text, p_item jsonb)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare r public.cal_source_inbox;
begin
  select * into r from public.cal_source_inbox where source_id = s.id and source_uid = p_uid and source_rid = p_rid for update;
  if r.id is not null and r.status = 'rejeitada' and r.kind = p_kind and r.item = p_item then return false; end if;
  if r.id is not null and r.status = 'pendente' and r.kind = p_kind and r.item = p_item and r.event_id is not distinct from p_event then
    return true;
  end if;
  insert into public.cal_source_inbox (section_id, source_id, source_uid, source_rid, event_id, kind, item)
  values (s.section_id, s.id, p_uid, p_rid, p_event, p_kind, p_item)
  on conflict (source_id, source_uid, source_rid) do update set event_id = excluded.event_id, kind = excluded.kind, item = excluded.item,
     status = 'pendente', updated_at = now(), decided_by = null, decided_at = null;
  return true;
end
$$;

-- ---------------------------------------------------------------------------
-- Sincronização: com revisão, só propõe; sem revisão, aplica logo (como antes).
-- ---------------------------------------------------------------------------
create or replace function public.cal_source_apply(p_source uuid, p_feed jsonb, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  s public.cal_sources; e public.cal_events; it record; v_item jsonb; v_kind text;
  v_keys text[]; v_from date; v_to date; v_complete boolean; v_invalid int := 0; v_same int := 0;
  v_now timestamptz := now(); v_warning text; v_stats jsonb; v_pending int;
begin
  if not private.is_service_role() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into s from public.cal_sources where id = p_source for update;
  if s.id is null then raise exception 'Registo não encontrado.'; end if;
  if not s.review then return private.cal_source_apply_direct(p_source, p_feed, p_force); end if;
  if s.status <> 'ativa' then return jsonb_build_object('skipped', true); end if;
  if jsonb_typeof(p_feed -> 'items') is distinct from 'array' then raise exception 'Conteúdo inválido.'; end if;
  v_from := (p_feed ->> 'window_from')::date;
  v_to := (p_feed ->> 'window_to')::date;
  v_complete := coalesce((p_feed ->> 'complete')::boolean, false) and v_from is not null and v_to is not null;
  v_keys := array(select coalesce(x ->> 'uid', '') || '|' || coalesce(x ->> 'rid', '') from jsonb_array_elements(p_feed -> 'items') x);

  for it in select x as raw, x ->> 'uid' as uid, coalesce(x ->> 'rid', '') as rid, coalesce((x ->> 'all_day')::boolean, false) as all_day,
                   (x ->> 'starts_at')::timestamptz as starts_at, (x ->> 'ends_at')::timestamptz as ends_at,
                   (x ->> 'start_date')::date as start_date, (x ->> 'end_date')::date as end_date,
                   coalesce((x ->> 'cancelled')::boolean, false) as cancelled
              from jsonb_array_elements(p_feed -> 'items') x loop
    if coalesce(it.uid, '') = '' or length(it.uid) > 1000 or length(it.rid) > 100
       or (it.all_day and (it.start_date is null or it.end_date is null or it.end_date < it.start_date))
       or (not it.all_day and (it.starts_at is null or it.ends_at is null or it.ends_at < it.starts_at)) then
      v_invalid := v_invalid + 1;
      continue;
    end if;
    v_item := private.cal_inbox_item(it.raw);

    e := null;
    select * into e from public.cal_events where source_id = s.id and source_uid = it.uid and source_rid = it.rid;
    if e.id is null and it.rid <> '' then
      select * into e from public.cal_events x
       where x.source_id = s.id and x.source_uid = it.uid and x.source_rid <> '' and left(x.source_rid, 8) = left(it.rid, 8)
         and not ((x.source_uid || '|' || x.source_rid) = any (v_keys))
       order by x.created_at limit 1;
    end if;

    v_kind := null;
    if e.id is null then
      if not it.cancelled then v_kind := 'nova'; end if;
    elsif it.cancelled then
      if e.status = 'ativo' then v_kind := 'cancelada'; end if;
    elsif (e.title, e.description, e.location, e.all_day, e.starts_at, e.ends_at, e.start_date, e.end_date, e.source_rid)
          is distinct from (v_item ->> 'title', v_item ->> 'description', v_item ->> 'location', it.all_day,
            (v_item ->> 'starts_at')::timestamptz, (v_item ->> 'ends_at')::timestamptz,
            (v_item ->> 'start_date')::date, (v_item ->> 'end_date')::date, it.rid)
       or (e.status = 'cancelado' and e.cancelled_by is null and coalesce(e.source_state, 'ok') <> 'ok') then
      v_kind := 'alterada';
    end if;

    if v_kind is null then
      delete from public.cal_source_inbox where source_id = s.id and source_uid = it.uid and source_rid = it.rid and status = 'pendente';
      if e.id is not null then update public.cal_events set source_synced_at = v_now where id = e.id; end if;
      v_same := v_same + 1;
    else
      perform private.cal_inbox_propose(s, it.uid, it.rid, e.id, v_kind, v_item);
    end if;
  end loop;

  if v_invalid > 0 then v_complete := false; end if;
  if not v_complete then
    v_warning := 'A leitura não foi completa: nada foi proposto para retirar.';
  elsif jsonb_array_length(p_feed -> 'items') = 0 then
    v_warning := 'O calendário veio vazio: por segurança, nada foi proposto para retirar.';
  else
    -- Novas ainda por rever que já não vêm do iCloud deixam de interessar.
    delete from public.cal_source_inbox i
     where i.source_id = s.id and i.kind = 'nova' and not ((i.source_uid || '|' || i.source_rid) = any (v_keys));
    for e in select * from public.cal_events x
              where x.source_id = s.id and x.status = 'ativo' and not ((x.source_uid || '|' || x.source_rid) = any (v_keys))
                and private.cal_first_day(x) <= v_to and private.cal_last_day(x) >= v_from loop
      perform private.cal_inbox_propose(s, e.source_uid, e.source_rid, e.id, 'removida', '{}'::jsonb);
    end loop;
  end if;

  select count(*) into v_pending from public.cal_source_inbox where source_id = s.id and status = 'pendente';
  v_stats := jsonb_build_object('por_rever', v_pending, 'sem_alteracao', v_same, 'ignoradas', v_invalid);
  update public.cal_sources x set
    calname = coalesce(left(nullif(trim(p_feed ->> 'name'), ''), 200), x.calname),
    last_attempt_at = v_now, last_success_at = v_now, last_error = null, last_error_at = null, failures = 0,
    last_stats = v_stats, last_warning = v_warning, pending_removals = 0
  where x.id = s.id;
  return v_stats;
end
$$;

-- ---------------------------------------------------------------------------
-- Revisão (só administração)
-- ---------------------------------------------------------------------------
create or replace function public.cal_source_inbox_list(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', i.id, 'source_id', i.source_id, 'source_name', s.name, 'kind', i.kind, 'item', i.item, 'updated_at', i.updated_at,
        'current', case when e.id is null then null else jsonb_build_object(
          'id', e.id, 'title', e.title, 'description', e.description, 'location', e.location, 'all_day', e.all_day,
          'starts_at', e.starts_at, 'ends_at', e.ends_at, 'start_date', e.start_date, 'end_date', e.end_date, 'status', e.status) end)
      order by coalesce(i.item ->> 'start_date', ((i.item ->> 'starts_at')::timestamptz at time zone 'Europe/Lisbon')::date::text,
                        e.start_date::text, (e.starts_at at time zone 'Europe/Lisbon')::date::text), i.created_at)
      from public.cal_source_inbox i
      join public.cal_sources s on s.id = i.source_id
      left join public.cal_events e on e.id = i.event_id
     where i.section_id = p_section and i.status = 'pendente' and s.status = 'ativa'), '[]'::jsonb);
end
$$;

-- Aprova ou rejeita propostas. p_edits (só numa proposta nova ou alterada): title, location, description.
create or replace function public.cal_source_inbox_decide(p_section uuid, p_ids uuid[], p_decision text, p_edits jsonb default null)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  r public.cal_source_inbox; s public.cal_sources; e public.cal_events; v jsonb; v_n int := 0; v_now timestamptz := now(); v_back boolean;
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  if coalesce(p_decision, '') not in ('aprovar', 'rejeitar') then raise exception 'Decisão inválida.'; end if;
  if p_edits is not null and cardinality(p_ids) <> 1 then raise exception 'Só se pode editar uma atividade de cada vez.'; end if;
  for r in select * from public.cal_source_inbox where id = any (p_ids) and section_id = p_section and status = 'pendente' for update loop
    select * into s from public.cal_sources where id = r.source_id;
    if s.status <> 'ativa' then continue; end if;
    if p_decision = 'rejeitar' then
      update public.cal_source_inbox set status = 'rejeitada', decided_by = auth.uid(), decided_at = v_now where id = r.id;
      v_n := v_n + 1;
      continue;
    end if;

    v := r.item;
    if p_edits is not null and r.kind in ('nova', 'alterada') then
      if p_edits ? 'title' then
        if nullif(trim(p_edits ->> 'title'), '') is null then raise exception 'Indica o título.'; end if;
        v := v || jsonb_build_object('title', left(trim(p_edits ->> 'title'), 200));
      end if;
      if p_edits ? 'location' then v := v || jsonb_build_object('location', left(nullif(trim(p_edits ->> 'location'), ''), 300)); end if;
      if p_edits ? 'description' then v := v || jsonb_build_object('description', left(nullif(trim(p_edits ->> 'description'), ''), 5000)); end if;
    end if;

    e := null;
    if r.event_id is not null then select * into e from public.cal_events where id = r.event_id for update; end if;
    if r.kind = 'nova' and e.id is null then
      insert into public.cal_events (section_id, space, title, description, location, all_day, starts_at, ends_at, start_date, end_date,
        audience, team_id, reminder_minutes, deadline_reminder_minutes, status, created_by, created_at, updated_at,
        source_id, source_uid, source_rid, source_state, source_synced_at)
      values (s.section_id, s.space, v ->> 'title', v ->> 'description', v ->> 'location', (v ->> 'all_day')::boolean,
        (v ->> 'starts_at')::timestamptz, (v ->> 'ends_at')::timestamptz, (v ->> 'start_date')::date, (v ->> 'end_date')::date,
        s.audience, s.team_id, s.reminder_minutes, '{}', 'ativo', s.created_by, v_now, v_now,
        s.id, r.source_uid, r.source_rid, 'ok', v_now)
      on conflict do nothing
      returning * into e;
      if e.id is not null and cardinality(s.reminder_minutes) > 0 then perform private.cal_sync_reminders(e.id); end if;
    elsif r.kind in ('nova', 'alterada') and e.id is not null then
      v_back := e.status = 'cancelado' and e.cancelled_by is null and coalesce(e.source_state, 'ok') <> 'ok';
      update public.cal_events set
        title = v ->> 'title', description = v ->> 'description', location = v ->> 'location', all_day = (v ->> 'all_day')::boolean,
        starts_at = (v ->> 'starts_at')::timestamptz, ends_at = (v ->> 'ends_at')::timestamptz,
        start_date = (v ->> 'start_date')::date, end_date = (v ->> 'end_date')::date,
        source_rid = r.source_rid, source_synced_at = v_now, updated_at = v_now,
        status = case when v_back then 'ativo' else status end,
        cancel_reason = case when v_back then null else cancel_reason end,
        cancelled_at = case when v_back then null else cancelled_at end,
        source_state = case when v_back then 'ok' else source_state end,
        source_removed_at = case when v_back then null else source_removed_at end
      where id = e.id;
      perform private.cal_sync_reminders(e.id);
    elsif r.kind = 'cancelada' and e.id is not null and e.status = 'ativo' then
      update public.cal_events set status = 'cancelado', cancel_reason = 'Cancelada no iCloud.', cancelled_at = v_now,
             cancelled_by = null, source_state = 'cancelado', source_synced_at = v_now, updated_at = v_now
       where id = e.id;
      perform private.cal_sync_reminders(e.id);
    elsif r.kind = 'removida' and e.id is not null and e.status = 'ativo' then
      update public.cal_events set status = 'cancelado', cancel_reason = 'Removida no iCloud.', cancelled_at = v_now,
             cancelled_by = null, source_state = 'removido', source_removed_at = v_now, updated_at = v_now
       where id = e.id;
      perform private.cal_sync_reminders(e.id);
    end if;
    delete from public.cal_source_inbox where id = r.id;
    v_n := v_n + 1;
  end loop;

  if v_n > 0 then
    update public.cal_sources x set
      event_count = (select count(*) from public.cal_events c where c.source_id = x.id and c.status = 'ativo'),
      range_from = (select min(private.cal_first_day(c)) from public.cal_events c where c.source_id = x.id and c.status = 'ativo'),
      range_to = (select max(private.cal_last_day(c)) from public.cal_events c where c.source_id = x.id and c.status = 'ativo')
    where x.section_id = p_section and x.status = 'ativa';
    perform private.audit(p_section, case when p_decision = 'aprovar' then 'cal_icloud_aprovado' else 'cal_icloud_rejeitado' end,
      'cal_source_inbox', null, jsonb_build_object('n', v_n, 'editado', p_edits is not null));
  end if;
  return v_n;
end
$$;

-- Lista da gestão: inclui «rever antes de publicar» e quantas mudanças esperam revisão.
create or replace function private.cal_source_json(s public.cal_sources)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'space', s.space, 'kind', s.kind, 'name', s.name, 'calname', s.calname, 'url_mask', s.url_mask,
    'audience', s.audience, 'team_id', s.team_id, 'team_name', (select t.name from public.teams t where t.id = s.team_id),
    'reminder_minutes', to_jsonb(s.reminder_minutes), 'status', s.status, 'review', s.review,
    'created_at', s.created_at, 'created_by_name', (select p.full_name from public.profiles p where p.id = s.created_by),
    'stopped_at', s.stopped_at,
    'last_attempt_at', s.last_attempt_at, 'last_success_at', s.last_success_at,
    'last_error', s.last_error, 'last_error_at', s.last_error_at, 'failures', s.failures,
    'last_stats', s.last_stats, 'last_warning', s.last_warning, 'pending_removals', s.pending_removals,
    'pending_review', (select count(*) from public.cal_source_inbox i where i.source_id = s.id and i.status = 'pendente'),
    'event_count', s.event_count, 'range_from', s.range_from, 'range_to', s.range_to,
    'cancelled_count', (select count(*) from public.cal_events e where e.source_id = s.id and e.status = 'cancelado'),
    'removed_count', (select count(*) from public.cal_events e where e.source_id = s.id and e.source_state = 'removido'))
$$;

-- «Rever antes de publicar» por ligação. Ao desligar, o que estava por rever deixa de esperar:
-- a próxima sincronização aplica tudo diretamente.
create or replace function public.cal_source_set_review(p_section uuid, p_source uuid, p_on boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.cal_sources;
begin
  if not private.is_admin(p_section) then raise exception 'Reservado à administração.' using errcode = '42501'; end if;
  select * into s from public.cal_sources where id = p_source and section_id = p_section for update;
  if s.id is null then raise exception 'Registo não encontrado.'; end if;
  update public.cal_sources set review = coalesce(p_on, true), updated_by = auth.uid(), updated_at = now() where id = s.id;
  if not coalesce(p_on, true) then delete from public.cal_source_inbox where source_id = s.id; end if;
  perform private.cal_source_audit(p_section, null, 'cal_icloud_revisao', s.id, jsonb_build_object('rever', coalesce(p_on, true)));
end
$$;

revoke all on function private.cal_source_apply_direct(uuid, jsonb, boolean), private.cal_inbox_item(jsonb),
  private.cal_inbox_propose(public.cal_sources, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.cal_source_inbox_list(uuid), public.cal_source_inbox_decide(uuid, uuid[], text, jsonb),
  public.cal_source_set_review(uuid, uuid, boolean) from public, anon;
grant execute on function public.cal_source_inbox_list(uuid), public.cal_source_inbox_decide(uuid, uuid[], text, jsonb),
  public.cal_source_set_review(uuid, uuid, boolean) to authenticated;
revoke execute on function public.cal_source_apply(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.cal_source_apply(uuid, jsonb, boolean) to service_role;
