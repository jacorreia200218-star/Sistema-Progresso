-- Pioneiros — armazenamento privado (Supabase Storage) e respetivas políticas.
-- Fotografias: bucket «fotografias», caminho <profile_id>/<ficheiro>.
-- Anexos: bucket «anexos», caminho <request_id>/<ficheiro>.
-- Nenhum bucket é público: o acesso é feito com URLs temporários (signed URLs).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('fotografias', 'fotografias', false, 2 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp']),
  ('anexos', 'anexos', false, 10 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- O dono do pedido pode carregar anexos enquanto o pedido está em rascunho.
create or replace function private.can_upload_attachment(p_folder text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.trail_requests r
    join public.memberships m on m.id = r.membership_id
    where r.id = private.safe_uuid(p_folder) and r.status = 'rascunho'
      and m.profile_id = auth.uid() and m.status = 'ativo'
  )
$$;

create or replace function private.can_read_attachment(p_folder text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.trail_requests r
    where r.id = private.safe_uuid(p_folder) and private.can_view_progress(r.membership_id)
  )
$$;

-- Só se apaga um ficheiro que não esteja ligado a nenhuma versão já submetida.
create or replace function private.can_delete_attachment(p_folder text, p_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.can_upload_attachment(p_folder) and not exists (
    select 1 from public.attachments a join public.trail_request_versions v on v.id = a.version_id
    where a.storage_path = p_name and v.submitted_at is not null
  )
$$;

create policy "fotografias: carregar na própria pasta" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotografias' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fotografias: atualizar a própria" on storage.objects for update to authenticated
  using (bucket_id = 'fotografias' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'fotografias' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fotografias: apagar a própria" on storage.objects for delete to authenticated
  using (bucket_id = 'fotografias' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fotografias: ver perfis autorizados" on storage.objects for select to authenticated
  using (bucket_id = 'fotografias' and private.can_view_profile(private.safe_uuid((storage.foldername(name))[1])));

create policy "anexos: carregar em rascunho próprio" on storage.objects for insert to authenticated
  with check (bucket_id = 'anexos' and private.can_upload_attachment((storage.foldername(name))[1]));
create policy "anexos: ver com permissão sobre o pedido" on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and private.can_read_attachment((storage.foldername(name))[1]));
create policy "anexos: apagar de rascunho próprio" on storage.objects for delete to authenticated
  using (bucket_id = 'anexos' and private.can_delete_attachment((storage.foldername(name))[1], name));

-- Execução das funções privadas: só as usadas diretamente em políticas RLS.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_active_member(uuid),
  private.is_dirigente(uuid),
  private.is_admin(uuid),
  private.can_view_progress(uuid),
  private.can_view_membership(uuid),
  private.can_view_profile(uuid),
  private.request_membership(uuid),
  private.safe_uuid(text),
  private.can_upload_attachment(text),
  private.can_read_attachment(text),
  private.can_delete_attachment(text, text)
to authenticated;
