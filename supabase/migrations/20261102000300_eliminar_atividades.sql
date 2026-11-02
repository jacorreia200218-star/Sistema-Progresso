-- Pioneiros — Eliminar atividades do Calendário.
--
-- Até aqui só se podia cancelar (a atividade ficava marcada como cancelada). Agora quem gere o
-- calendário (calendario.gerir) também pode eliminar uma atividade criada por engano.
-- • «Só esta data» ou «Esta e as seguintes da mesma série». Uma série é o conjunto criado de uma
--   vez com «Repetir todas as semanas» (mesmo título e mesmo instante de criação).
-- • Atividades do iCloud não se eliminam aqui (apagam-se no iCloud).
-- • Se houver movimentos da Tesouraria ou material do Inventário ligados, não elimina nada:
--   nesse caso cancela-se. Presenças, atas e tarefas ligadas ficam, só perdem a ligação.
-- • O registo de auditoria guarda os dados completos de cada atividade eliminada.
-- • Os envolvidos numa atividade ativa e futura são avisados (um aviso por pessoa).
-- • p_dry_run = true só conta quantas atividades seriam eliminadas (para o ecrã de confirmação).
-- Aditivo: só acrescenta uma função.

create or replace function public.cal_delete_event(p_section uuid, p_event uuid, p_following boolean default false, p_dry_run boolean default false)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'calendario', 'calendario.gerir', true);
        e public.cal_events; x public.cal_events;
        v_day date; v_ids uuid[]; v_inv uuid[] := '{}'; v_n integer;
begin
  e := private.cal_event_of(p_section, v_space, p_event, true);
  if private.cal_source_readonly(e) then
    raise exception 'Esta atividade vem do iCloud: apaga-a no iCloud.';
  end if;
  v_day := coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date);

  if coalesce(p_following, false) then
    select array_agg(c.id) into v_ids
      from public.cal_events c
     where c.section_id = e.section_id and c.space = e.space and c.title = e.title and c.created_at = e.created_at
       and coalesce(c.start_date, (c.starts_at at time zone 'Europe/Lisbon')::date) >= v_day
       and not private.cal_source_readonly(c);
  end if;
  v_ids := coalesce(v_ids, array[e.id]);
  if not e.id = any(v_ids) then v_ids := v_ids || e.id; end if;
  v_n := cardinality(v_ids);
  if coalesce(p_dry_run, false) then return v_n; end if;

  for x in select * from public.cal_events where id = any(v_ids) loop
    if x.status = 'ativo' and coalesce(x.ends_at, x.starts_at, (x.end_date + 1)::timestamptz) > now() then
      v_inv := v_inv || private.cal_involved(x.id);
    end if;
    perform private.cancel_reminders('cal_event', x.id);
    perform private.audit(p_section, 'cal_evento_eliminado', 'cal_event', x.id::text,
      jsonb_build_object('space', v_space, 'atividade', private.cal_event_json(x), 'serie', v_n > 1));
  end loop;

  begin
    delete from public.cal_events where id = any(v_ids);
  exception when foreign_key_violation then
    raise exception 'Há movimentos da Tesouraria ou material do Inventário ligados a esta atividade. Cancela-a em vez de a eliminar.';
  end;

  select coalesce(array_agg(distinct p), '{}') into v_inv from unnest(v_inv) p;
  if cardinality(v_inv) > 0 then
    perform private.module_notify(p_section, 'calendario', v_space, v_inv, 'cal_evento_cancelado',
      left('Atividade eliminada: ' || e.title, 220),
      private.cal_when(e) || case when v_n > 1 then ' e as ' || (v_n - 1) || ' datas seguintes' else '' end,
      '/calendario');
  end if;
  return v_n;
end
$$;

revoke execute on function public.cal_delete_event(uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.cal_delete_event(uuid, uuid, boolean, boolean) to authenticated;
