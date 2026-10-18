-- Tesouraria (simplificação): o seletor de atividades distingue atividades com o mesmo nome no
-- mesmo dia. fin_activity_options passa a devolver também a hora de início em Lisboa («time»,
-- null nos eventos de dia inteiro) e o nome da equipa («team_name»). Os campos existentes
-- (id, title, status, day), a ordem e as permissões ficam iguais.
create or replace function public.fin_activity_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'tesouraria');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'status', e.status,
      'day', coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date),
      'time', case when e.all_day or e.starts_at is null then null
                   else to_char(e.starts_at at time zone 'Europe/Lisbon', 'HH24:MI') end,
      'team_name', (select t.name from public.teams t where t.id = e.team_id))
      order by coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date) desc, e.title)
    from public.cal_events e where e.section_id = p_section and e.space = v_space), '[]'::jsonb);
end
$$;

notify pgrst, 'reload schema';
