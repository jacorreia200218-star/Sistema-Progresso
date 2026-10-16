-- Pioneiros — Calendário: criar uma atividade que se repete todas as semanas (ex.: a reunião
-- de sábado, 14:30–16:00) até uma data. Cada semana fica uma atividade normal (respostas,
-- pendências e lembretes próprios); os envolvidos recebem UMA notificação para a série.
-- Mantém a hora de Lisboa na mudança de hora e salta as semanas que já têm uma atividade
-- ativa com o mesmo título e o mesmo início (pode correr-se de novo sem duplicar).
-- Aditivo: não altera dados nem outras funções.

create or replace function public.cal_create_weekly(p_section uuid, p_data jsonb, p_until date)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
        base public.cal_events; e public.cal_events;
        v_first date; v_from date; v_last date; v_day date; v_shift interval; v_n integer := 0; v_inv uuid[] := '{}';
begin
  base := private.cal_from_json(p_section, p_data);
  v_first := case when base.all_day then base.start_date else (base.starts_at at time zone 'Europe/Lisbon')::date end;
  if p_until is null then raise exception 'Indica até quando se repete.'; end if;
  if p_until < v_first then raise exception 'A repetição tem de terminar depois da primeira data.'; end if;
  if p_until - v_first > 400 then raise exception 'A repetição não pode durar mais de um ano.'; end if;

  v_day := v_first;
  while v_day <= p_until loop
    e := base;
    v_shift := (v_day - v_first) * interval '1 day';
    if e.all_day then
      e.start_date := base.start_date + (v_day - v_first);
      e.end_date := base.end_date + (v_day - v_first);
    else
      -- Soma os dias na hora local, para as 14:30 continuarem 14:30 depois da mudança de hora.
      e.starts_at := ((base.starts_at at time zone 'Europe/Lisbon') + v_shift) at time zone 'Europe/Lisbon';
      e.ends_at := ((base.ends_at at time zone 'Europe/Lisbon') + v_shift) at time zone 'Europe/Lisbon';
    end if;
    if base.registration_deadline is not null then
      e.registration_deadline := ((base.registration_deadline at time zone 'Europe/Lisbon') + v_shift) at time zone 'Europe/Lisbon';
    end if;
    if not exists (
      select 1 from public.cal_events x
       where x.section_id = p_section and x.space = v_space and x.status = 'ativo' and x.title = e.title
         and x.all_day = e.all_day
         and (case when e.all_day then x.start_date = e.start_date else x.starts_at = e.starts_at end)
    ) then
      e.id := gen_random_uuid();
      e.space := v_space; e.status := 'ativo';
      e.created_by := auth.uid(); e.created_at := now(); e.updated_by := auth.uid(); e.updated_at := now();
      insert into public.cal_events select e.*;
      perform private.audit(p_section, 'cal_evento_criado', 'cal_event', e.id::text,
        jsonb_build_object('space', v_space, 'title', e.title, 'serie', true));
      perform private.cal_sync_reminders(e.id);
      v_inv := v_inv || private.cal_involved(e.id);
      if v_n = 0 then v_from := v_day; end if;
      v_n := v_n + 1;
      v_last := v_day;
    end if;
    v_day := v_day + 7;
  end loop;

  if v_n > 0 then
    perform private.module_notify(p_section, 'calendario', v_space,
      (select coalesce(array_agg(distinct u), '{}') from unnest(v_inv) u), 'cal_evento_novo',
      left('Nova atividade semanal: ' || base.title, 220),
      case when v_n = 1 then to_char(v_last, 'DD/MM/YYYY')
           else v_n || ' semanas, de ' || to_char(v_from, 'DD/MM/YYYY') || ' a ' || to_char(v_last, 'DD/MM/YYYY') end
        || coalesce(' · ' || base.location, ''),
      '/calendario');
  end if;
  return v_n;
end
$$;

revoke execute on function public.cal_create_weekly(uuid, jsonb, date) from public, anon;
grant execute on function public.cal_create_weekly(uuid, jsonb, date) to authenticated;
