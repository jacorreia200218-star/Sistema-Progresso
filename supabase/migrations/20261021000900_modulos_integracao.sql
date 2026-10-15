-- Pioneiros — ligações entre módulos.
-- Na página de uma atividade do Calendário mostram-se as reservas de material, o resumo
-- financeiro e as reuniões ligadas a ela, cada parte só quando a pessoa tem acesso ao
-- módulo correspondente NO MESMO ESPAÇO (teste com teste, real com real). Nada é copiado:
-- cada registo continua a existir uma única vez no seu módulo.
-- Aditivo: não altera nem apaga registos existentes.

create or replace function public.cal_event_links(p_section uuid, p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_space text := private.module_require(p_section, 'calendario');
  v_out jsonb := '{}'::jsonb;
  v_fin jsonb;
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
  end if;

  if private.module_space(p_section, 'tesouraria') is not distinct from v_space then
    -- Só os totais partilhados (os mesmos que o resumo da Tesouraria mostra a todos).
    v_fin := public.fin_activity_results(p_section, p_event) -> 0;
    v_out := v_out || jsonb_build_object('financas', case when v_fin is null then null else
      jsonb_build_object('orcamento', v_fin -> 'orcamento', 'efetivo', v_fin -> 'efetivo', 'por_confirmar', v_fin -> 'por_confirmar') end);
  end if;

  if private.module_space(p_section, 'secretaria') is not distinct from v_space then
    v_out := v_out || jsonb_build_object('reunioes', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'kind', m.kind, 'starts_at', m.starts_at) order by m.starts_at)
        from public.sec_meetings m
       where m.section_id = p_section and m.space = v_space and m.cal_event_id = p_event and m.status = 'ativa'
         and private.sec_can_see(m.id)), '[]'::jsonb));
  end if;

  return v_out;
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- O envio de lembretes é só para o serviço agendado.
revoke execute on function public.process_due_reminders() from authenticated;
