-- Pioneiros — datas da adesão e da Promessa.
--
-- • A Promessa/Investidura acontece depois da decisão sobre a adesão (Manual, pp. 7 e 10).
--   Um registo com a Promessa antes da decisão só é aceite com fundamentação nas notas
--   (por exemplo, um registo retroativo de datas aproximadas).
-- • Um registo de adesão anterior à aplicação (retroativo) exige fundamentação.
-- • A data do acontecimento (decided_on, commitment_on) é distinta da data em que foi
--   registado (recorded_at), que já existe e passa a ser mostrada.
-- • Não altera dados existentes: os registos antigos fora de ordem são assinalados na
--   interface para revisão, nunca corrigidos automaticamente.
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
  if p_commitment_on is not null and p_commitment_on < p_decided_on and length(trim(coalesce(p_notes, ''))) = 0 then
    raise exception 'A Promessa / Investidura é posterior à decisão sobre a adesão. Corrige as datas ou explica nas notas por que razão o registo é assim.';
  end if;
  if coalesce(p_is_historical, false) and length(trim(coalesce(p_notes, ''))) = 0 then
    raise exception 'Um registo retroativo precisa de fundamentação nas notas.';
  end if;
  insert into public.adhesions (membership_id, decided_on, commitment_on, notes, is_historical, recorded_by)
  values (p_membership, p_decided_on, p_commitment_on, nullif(trim(p_notes), ''), coalesce(p_is_historical, false), auth.uid())
  on conflict (membership_id) do update
    set decided_on = excluded.decided_on, commitment_on = excluded.commitment_on, notes = excluded.notes,
        is_historical = excluded.is_historical, recorded_by = excluded.recorded_by, recorded_at = now();
  perform private.audit(v_m.section_id, 'adesao_registada', 'adhesion', p_membership::text,
    jsonb_build_object('decided_on', p_decided_on, 'commitment_on', p_commitment_on, 'historical', p_is_historical));
  perform private.notify(array[v_m.profile_id], v_m.section_id, 'adesao', 'Adesão registada',
    'A tua adesão (Desprendimento) foi registada.', '/meu-progresso?vista=caminho');
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
