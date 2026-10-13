-- Atualização «Meu progresso» (15/10/2026) para um projeto já instalado com instalar_tudo.sql.
-- Cola no SQL Editor e carrega em «Run» UMA vez. Acrescenta os campos «contexto» e «como demonstrei os objetivos» aos pedidos; não apaga registos.

-- ===== supabase/migrations/20261015000100_pedido_campos.sql =====
-- Pioneiros — campos adicionais do pedido de validação de trilho:
-- «em que contexto» e «como demonstrei os objetivos do trilho».
-- Aditivo: não altera registos existentes; as chamadas antigas continuam válidas.

alter table public.trail_request_versions add column if not exists context text not null default ''
  check (length(context) <= 10000);
alter table public.trail_request_versions add column if not exists evidence text not null default ''
  check (length(evidence) <= 10000);

-- Substitui a função de rascunho por uma versão com os novos campos (opcionais).
drop function if exists public.save_request_draft(uuid, text, text, date, date, text);
create or replace function public.save_request_draft(
  p_request uuid, p_reflection text, p_experiences text, p_period_start date, p_period_end date, p_approximate_date text,
  p_context text default null, p_evidence text default null
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
         context = case when p_context is null then context else left(p_context, 10000) end,
         evidence = case when p_evidence is null then evidence else left(p_evidence, 10000) end,
         period_start = p_period_start, period_end = p_period_end,
         approximate_date = nullif(left(trim(coalesce(p_approximate_date, '')), 100), ''),
         updated_at = now()
   where request_id = p_request and version_no = v_r.current_version and submitted_at is null;
  update public.trail_requests set updated_at = now() where id = p_request;
end
$$;

-- Nova versão (retirar / após devolução) copia também os novos campos.
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

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on function private.new_draft_version(uuid, integer) from public, anon, authenticated;
