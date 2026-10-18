-- Pioneiros — Eventos como ponto de ligação entre módulos.
--
-- O detalhe de uma reunião ou atividade do Calendário mostra, com o mesmo id do evento:
-- Detalhes · Presenças · Ata e tarefas · Material · Finanças (estes dois só quando o
-- módulo está acessível no mesmo espaço e há dados ou a pessoa pode agir).
--
-- 1. public.pres_session_for_event: abre ou cria a sessão de presenças ligada ao evento.
--    Idempotente: devolve sempre a mesma sessão (o índice único pres_sessions_cal_event
--    já garante uma sessão por evento; a linha do evento fica bloqueada durante a criação).
--    Só para quem regista presenças (private.pres_can_register) e só no espaço do módulo
--    Presenças (teste e real nunca se misturam).
-- 2. public.cal_event_links: mantém as chaves anteriores e junta o que o detalhe precisa
--    para decidir o que mostrar (quem pode registar presenças, gerir material ou finanças,
--    se há dados financeiros e o id da ata de cada tarefa, quando visível).
--    Cada registo continua a viver no seu módulo e com as suas permissões.
-- Aditivo: não altera nem apaga dados.

-- ---------------------------------------------------------------------------
-- 1. Abrir ou criar a sessão de presenças de um evento
-- ---------------------------------------------------------------------------
create or replace function public.pres_session_for_event(p_section uuid, p_event uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_space text := private.module_require_can(p_section, 'presencas', 'presencas.registar', true);
  e public.cal_events;
  v_id uuid;
begin
  -- Bloqueia o evento: pedidos simultâneos esperam e encontram a sessão já criada.
  select * into e from public.cal_events
   where id = p_event and section_id = p_section and space = v_space for update;
  if e.id is null then raise exception 'Atividade do Calendário não encontrada neste espaço.'; end if;

  select s.id into v_id from public.pres_sessions s
   where s.cal_event_id = e.id and s.section_id = p_section and s.space = v_space;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', false);
  end if;

  if e.status <> 'ativo' then raise exception 'Esta atividade foi cancelada no Calendário.'; end if;
  begin
    v_id := public.pres_session_save(p_section, null, e.id, null, null, null, null, null);
  exception when others then
    -- Outro pedido criou-a entretanto: devolve essa.
    select s.id into v_id from public.pres_sessions s
     where s.cal_event_id = e.id and s.section_id = p_section and s.space = v_space;
    if v_id is null then raise; end if;
    return jsonb_build_object('id', v_id, 'created', false);
  end;
  return jsonb_build_object('id', v_id, 'created', true);
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Ligações do evento
-- ---------------------------------------------------------------------------
create or replace function public.cal_event_links(p_section uuid, p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'calendario');
  v_out jsonb := '{}'::jsonb;
  v_fin jsonb;
  v_tasks jsonb;
begin
  if not exists (select 1 from public.cal_events where id = p_event and section_id = p_section and space = v_space) then
    raise exception 'Registo não encontrado.';
  end if;

  if private.module_space(p_section, 'inventario') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('reservas', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'item_id', i.id, 'item', i.name, 'unit', i.unit,
                                          'quantity', r.quantity, 'status', r.status) order by i.name)
        from public.inv_reservations r join public.inv_items i on i.id = r.item_id
       where r.section_id = p_section and r.space = v_space and r.event_id = p_event and r.status <> 'cancelada'), '[]'::jsonb));
    v_out := v_out || jsonb_build_object('compras', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(i.name, p.name), 'quantity', p.quantity,
                                          'unit', coalesce(i.unit, p.unit), 'status', p.status) order by p.created_at)
        from public.inv_purchases p left join public.inv_items i on i.id = p.item_id
       where p.section_id = p_section and p.space = v_space and p.event_id = p_event and p.status <> 'cancelado'), '[]'::jsonb));
    v_out := v_out || jsonb_build_object('inv_can_manage', private.inv_can_manage(p_section));
  end if;

  if private.module_space(p_section, 'presencas') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('presencas', (
      select jsonb_build_object('id', s.id, 'title', s.title, 'date', s.session_date, 'status', s.status,
        'counts', case when private.pres_can_register(p_section) then (
            select jsonb_build_object('presente', count(*) filter (where r.status = 'presente'),
                                      'justificada', count(*) filter (where r.status = 'justificada'),
                                      'injustificada', count(*) filter (where r.status = 'injustificada'))
              from public.pres_records r where r.session_id = s.id) end,
        'mine', (select r.status from public.pres_records r join public.memberships m on m.id = r.membership_id
                  where r.session_id = s.id and m.profile_id = auth.uid() limit 1))
        from public.pres_sessions s
       where s.section_id = p_section and s.space = v_space and s.cal_event_id = p_event),
      'pres_can_register', private.pres_can_register(p_section));
  end if;

  if private.module_space(p_section, 'tesouraria') is not distinct from v_space then
    v_fin := public.fin_activity_results(p_section, p_event) -> 0;
    v_out := v_out || jsonb_build_object('financas', case when v_fin is null then null else
      jsonb_build_object('orcamento', v_fin -> 'orcamento', 'efetivo', v_fin -> 'efetivo', 'por_confirmar', v_fin -> 'por_confirmar',
        'tem_dados', exists (select 1 from public.fin_budget_lines l where l.activity_id = p_event and l.section_id = p_section
                               and l.space = v_space and l.voided_at is null)
                     or exists (select 1 from public.fin_movements m where m.activity_id = p_event and m.section_id = p_section
                               and m.space = v_space and m.voided_at is null)) end,
      'fin_can_manage', private.fin_can_manage(p_section));
  end if;

  if private.module_space(p_section, 'secretaria') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('reunioes', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'kind', m.kind, 'starts_at', m.starts_at,
               'ata_id', (select d.id from public.sec_minutes d where d.meeting_id = m.id and d.kind = 'ata')) order by m.starts_at)
        from public.sec_meetings m
       where m.section_id = p_section and m.space = v_space and m.cal_event_id = p_event and m.status = 'ativa'
         and private.sec_can_see(m.id)), '[]'::jsonb),
      'ata_writer', private.ata_writer(p_section));
    -- Tarefas: a ata de cada uma só quando a pessoa a pode ver (meeting_id já vem filtrado).
    v_tasks := private.sec_tasks_for_event(p_section, v_space, p_event);
    v_out := v_out || jsonb_build_object('tarefas', coalesce((
      select jsonb_agg(t || jsonb_build_object('ata_id',
               (select d.id from public.sec_minutes d where d.meeting_id = nullif(t ->> 'meeting_id', '')::uuid and d.kind = 'ata'))
             order by o)
        from jsonb_array_elements(v_tasks) with ordinality x(t, o)), '[]'::jsonb));
  end if;

  return v_out;
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;
notify pgrst, 'reload schema';
