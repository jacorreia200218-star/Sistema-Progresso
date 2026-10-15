-- Atualização «Notificações push» (20/10/2026) para um projeto já instalado (com a atualização
-- 2026-10-19_trilhos_notificacoes.sql já aplicada). Cola no SQL Editor e carrega em «Run» UMA vez.
-- Não altera nem apaga registos existentes.

-- ===== supabase/migrations/20261020000100_notificacoes_push.sql =====
-- Pioneiros — notificações push no telemóvel e no computador.
--
-- • Cada pessoa ativa as notificações no seu dispositivo (Perfil); a subscrição
--   do navegador fica em push_subscriptions, só acessível pelas funções abaixo.
-- • Quando é criada uma notificação para alguém com subscrições, a base de
--   dados avisa a função /api/push da app (pg_net), que envia o push. Se o envio
--   falhar, a notificação continua na app: o push nunca bloqueia nada.
-- • A configuração do envio (endereço, segredo partilhado e chaves VAPID) fica
--   no esquema private; as chaves são criadas pela própria função /api/push na
--   primeira utilização. Só a chave secreta do Supabase (service_role) as lê.
-- • «Enviar notificação de teste» cria uma notificação para o próprio.
-- Aditivo: não altera nem apaga registos existentes.

do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net indisponível: as notificações push ficam desligadas até a extensão ser ativada.';
end $$;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists push_subscriptions_profile on public.push_subscriptions (profile_id);
alter table public.push_subscriptions enable row level security;
-- Sem políticas: lê-se e escreve-se só através das funções abaixo.

create table if not exists private.push_config (
  id boolean primary key default true check (id),
  endpoint text,
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  vapid_public_key text,
  vapid_private_key text
);
insert into private.push_config (endpoint) values ('https://sistema-progresso.vercel.app/api/push')
on conflict (id) do nothing;

create or replace function private.is_service_role() returns boolean language sql stable set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;

-- ---------------------------------------------------------------------------
-- Subscrições do próprio
-- ---------------------------------------------------------------------------
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
) returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Tens de entrar na tua conta primeiro.' using errcode = '42501'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'Subscrição inválida.'; end if;
  if coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'Subscrição inválida.'; end if;
  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end
$$;

create or replace function public.remove_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and profile_id = auth.uid()
$$;

create or replace function public.has_push_subscription(p_endpoint text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.push_subscriptions where endpoint = p_endpoint and profile_id = auth.uid())
$$;

create or replace function public.send_test_notification() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Tens de entrar na tua conta primeiro.' using errcode = '42501'; end if;
  if (select count(*) from public.notifications where profile_id = auth.uid() and kind = 'teste'
        and created_at > now() - interval '1 minute') >= 3 then
    raise exception 'Já enviaste várias notificações de teste. Espera um minuto.';
  end if;
  insert into public.notifications (profile_id, section_id, kind, title, body, link)
  values (auth.uid(), null, 'teste', 'Notificação de teste',
          'Se estás a ver isto no telemóvel, as notificações estão a funcionar.', '/notificacoes');
end
$$;

-- ---------------------------------------------------------------------------
-- Funções só para a função /api/push (chave secreta do Supabase)
-- ---------------------------------------------------------------------------
-- Devolve a configuração; guarda as chaves VAPID se ainda não existirem
-- (a função cria-as na primeira utilização). Nunca substitui chaves guardadas.
create or replace function public.push_service_config(p_public_key text default null, p_private_key text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare c private.push_config;
begin
  if not private.is_service_role() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if p_public_key is not null and p_private_key is not null then
    update private.push_config set vapid_public_key = p_public_key, vapid_private_key = p_private_key
     where vapid_public_key is null;
  end if;
  select * into c from private.push_config;
  return jsonb_build_object('secret', c.secret, 'public_key', c.vapid_public_key, 'private_key', c.vapid_private_key);
end
$$;

-- Conteúdo de uma notificação e as subscrições do destinatário.
create or replace function public.push_notification_payload(p_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select case when not private.is_service_role() then null else (
    select jsonb_build_object(
      'title', n.title, 'body', n.body, 'link', n.link,
      'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                                   from public.push_subscriptions s where s.profile_id = n.profile_id), '[]'::jsonb))
    from public.notifications n where n.id = p_id and n.deleted_at is null and n.read_at is null)
  end
$$;

-- Subscrições que o serviço de push deu como expiradas (404/410) são removidas.
create or replace function public.push_drop_subscriptions(p_endpoints text[]) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v int;
begin
  if not private.is_service_role() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  delete from public.push_subscriptions where endpoint = any (p_endpoints);
  get diagnostics v = row_count;
  return v;
end
$$;

-- ---------------------------------------------------------------------------
-- Aviso à função de envio quando é criada uma notificação
-- ---------------------------------------------------------------------------
create or replace function private.push_on_notification() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare c private.push_config;
begin
  if not exists (select 1 from public.push_subscriptions where profile_id = new.profile_id) then return new; end if;
  select * into c from private.push_config;
  if c.endpoint is null then return new; end if;
  perform net.http_post(
    url := c.endpoint,
    body := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', c.secret));
  return new;
exception when others then
  -- O push nunca impede a notificação de ficar guardada na app.
  return new;
end
$$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
for each row execute function private.push_on_notification();

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function public.push_service_config(text, text), public.push_notification_payload(uuid),
  public.push_drop_subscriptions(text[]) to service_role;
