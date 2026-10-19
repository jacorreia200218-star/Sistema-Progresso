-- Pioneiros — Presenças simplificadas (só funções pres_ de leitura; sem tabelas novas).
--
-- 1. pres_session: cada pessoa traz também a resposta que deu no Calendário
--    («cal_response»: vou, nao_vou, por_confirmar ou null) quando a sessão está ligada a
--    uma atividade. É só informação: confirmar «Vou» não é presença e nunca entra na
--    taxa; a presença continua a ser registada à parte (presente/falta/por registar).
-- 2. pres_event_options: devolve também «all_day» e «starts_at» (instante de início dos
--    eventos com hora) para o seletor de atividades mostrar a hora quando há duas
--    atividades com o mesmo nome no mesmo dia.
-- A fórmula da taxa não muda: Presenças ÷ (Presenças + Faltas justificadas + Faltas
-- injustificadas) × 100, só com sessões até hoje, não canceladas, aplicáveis ao membro e
-- com registo («por registar» fica de fora e é mostrado à parte).
-- Aditivo: não altera dados.

-- 1. Sessão com a resposta do Calendário
create or replace function public.pres_session(p_section uuid, p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'presencas');
  v_reg boolean := private.pres_can_register(p_section);
  v_me uuid := (select id from public.memberships where section_id = p_section and profile_id = auth.uid());
  s public.pres_sessions;
begin
  s := private.pres_session_of(p_section, v_space, p_session);
  if not v_reg and not exists (select 1 from private.pres_applicable(p_section, v_space, s.session_date, s.session_date) a
                                where a.session_id = s.id and a.membership_id = v_me) then
    raise exception 'Registo não encontrado.';
  end if;
  return jsonb_build_object(
    'can_register', v_reg,
    'today', private.pres_today(),
    'session', (select jsonb_build_object(
        'id', s.id, 'date', s.session_date, 'title', s.title, 'kind', s.kind, 'audience', s.audience,
        'team_id', s.team_id, 'team_name', t.name, 'notes', s.notes, 'status', s.status,
        'cancel_reason', s.cancel_reason, 'cancelled_at', s.cancelled_at,
        'effective_status', case when private.pres_is_cancelled(s.id) then 'cancelada' else 'ativa' end,
        'future', s.session_date > private.pres_today(),
        'cal_event', case when e.id is null then null else jsonb_build_object(
            'id', e.id, 'title', e.title, 'status', e.status,
            'start', coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date),
            'end', coalesce(e.end_date, (e.ends_at at time zone 'Europe/Lisbon')::date)) end,
        'created_by_name', (select full_name from public.profiles where id = s.created_by),
        'created_at', s.created_at)
      from (select 1) one left join public.teams t on t.id = s.team_id left join public.cal_events e on e.id = s.cal_event_id),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'membership_id', c.membership_id, 'name', p.full_name, 'team_id', c.team_id, 'team_name', t.name,
        'status', c.status, 'partial', c.partial, 'partial_note', c.partial_note,
        'justification', c.justification, 'category', c.category,
        -- Resposta no Calendário (Vou/Não vou/Por confirmar): intenção, não presença.
        'cal_response', case when s.cal_event_id is null then null
                             else (select cp.response from public.cal_participants cp
                                    where cp.event_id = s.cal_event_id and cp.profile_id = m.profile_id) end,
        'updated_at', r.updated_at, 'updated_by_name', (select full_name from public.profiles where id = r.updated_by)
      ) order by t.name nulls last, p.full_name)
      from private.pres_cells(p_section, v_space, s.session_date, s.session_date) c
      join public.memberships m on m.id = c.membership_id
      join public.profiles p on p.id = m.profile_id
      left join public.teams t on t.id = c.team_id
      left join public.pres_records r on r.session_id = c.session_id and r.membership_id = c.membership_id
     where c.session_id = s.id and (v_reg or c.membership_id = v_me)), '[]'::jsonb),
    'history', case when v_reg then coalesce((select jsonb_agg(jsonb_build_object(
        'id', h.id, 'membership_id', h.membership_id, 'name', p.full_name,
        'old_status', h.old_status, 'new_status', h.new_status, 'old_partial', h.old_partial, 'new_partial', h.new_partial,
        'justification_changed', h.old_justification is distinct from h.new_justification,
        'reason', h.reason, 'changed_at', h.changed_at,
        'changed_by_name', (select full_name from public.profiles where id = h.changed_by)
      ) order by h.changed_at desc, h.id desc)
      from public.pres_record_history h
      join public.memberships m on m.id = h.membership_id join public.profiles p on p.id = m.profile_id
     where h.session_id = s.id and h.section_id = p_section and h.space = v_space), '[]'::jsonb) else '[]'::jsonb end
  );
end
$$;

-- 2. Atividades do Calendário para ligar (com hora)
create or replace function public.pres_event_options(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require_can(p_section, 'presencas', 'presencas.registar', true);
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'audience', e.audience, 'team_id', e.team_id, 'team_name', t.name,
      'start', coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date),
      'end', coalesce(e.end_date, (e.ends_at at time zone 'Europe/Lisbon')::date),
      'all_day', e.all_day, 'starts_at', e.starts_at
    ) order by coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date) desc, e.title)
    from public.cal_events e left join public.teams t on t.id = e.team_id
   where e.section_id = p_section and e.space = v_space and e.status = 'ativo'
     and not exists (select 1 from public.pres_sessions s where s.cal_event_id = e.id)
     and coalesce(e.start_date, (e.starts_at at time zone 'Europe/Lisbon')::date)
         between private.pres_today() - 400 and private.pres_today() + 180), '[]'::jsonb);
end
$$;

revoke execute on function public.pres_session(uuid, uuid) from public, anon;
grant execute on function public.pres_session(uuid, uuid) to authenticated;
revoke execute on function public.pres_event_options(uuid) from public, anon;
grant execute on function public.pres_event_options(uuid) to authenticated;
