-- Atualização «Convites curtos e datas da adesão» (17/10/2026) para um projeto já instalado com instalar_tudo.sql.
-- Cola no SQL Editor e carrega em «Run» UMA vez. Não apaga nem altera registos existentes.

-- ===== supabase/migrations/20261017000100_convites_curtos.sql =====
-- Pioneiros — convites com código curto (ex.: «AB7K-9M2P»).
--
-- • Os identificadores internos (UUID) mantêm-se; o código é um valor separado,
--   aleatório, gerado no servidor (gen_random_bytes) com verificação de unicidade.
-- • Alfabeto sem caracteres confundíveis (sem O/0, I/1/L): 31 símbolos, 8 caracteres.
-- • Aceita o código com ou sem hífen, espaços e maiúsculas/minúsculas.
-- • Cada tentativa falhada fica registada; ao fim de 8 falhas em 15 minutos a conta
--   fica impedida de tentar durante esse período (impede adivinhar códigos).
-- • O convite só cria um pedido de entrada pendente; nunca concede funções nem
--   permissões. Um convite pode indicar a equipa de destino (é só uma indicação:
--   a administração confirma ao aprovar).
-- • Os convites antigos (código longo, só com hash guardado) continuam a funcionar.

alter table public.invites
  add column if not exists code text unique check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
  add column if not exists team_id uuid references public.teams (id) on delete set null,
  add column if not exists replaced_by uuid references public.invites (id) on delete set null;

-- Tentativas de usar convites (para limitar a adivinhação). Só o servidor lê.
create table if not exists private.invite_attempts (
  id bigint generated always as identity primary key,
  profile_id uuid not null,
  attempted_at timestamptz not null default now(),
  ok boolean not null
);
create index if not exists invite_attempts_recent on private.invite_attempts (profile_id, attempted_at desc);

create or replace function private.invite_code_normalize(p_code text)
returns text language sql immutable set search_path = ''
as $$ select upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')) $$;

create or replace function private.invite_code_new()
returns text language plpgsql volatile set search_path = ''
as $$
declare
  v_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
  i int;
begin
  for attempt in 1..20 loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      -- 248 = 31 × 8: rejeita os bytes acima para não enviesar a distribuição
      while get_byte(v_bytes, i) >= 248 loop
        v_bytes := set_byte(v_bytes, i, get_byte(extensions.gen_random_bytes(1), 0));
      end loop;
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 31) + 1, 1);
    end loop;
    if not exists (select 1 from public.invites where code = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'Não foi possível gerar um código único. Tenta de novo.';
end
$$;

create or replace function private.invite_format(p_code text)
returns text language sql immutable set search_path = ''
as $$ select case when p_code is null then null else substr(p_code, 1, 4) || '-' || substr(p_code, 5, 4) end $$;

-- Falhas recentes da conta (janela de 15 minutos).
create or replace function private.invite_blocked()
returns boolean language sql stable security definer set search_path = ''
as $$
  select count(*) >= 8 from private.invite_attempts
   where profile_id = auth.uid() and not ok and attempted_at > now() - interval '15 minutes'
$$;

-- Procura o convite (código curto ou código antigo) sem revelar nada a quem não o tem.
create or replace function private.invite_lookup(p_code text, p_lock boolean)
returns public.invites language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_norm text := private.invite_code_normalize(p_code);
  v_inv public.invites;
begin
  if v_norm ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$' then
    if p_lock then select * into v_inv from public.invites where code = v_norm for update;
    else select * into v_inv from public.invites where code = v_norm; end if;
  elsif length(trim(coalesce(p_code, ''))) > 8 then
    -- convites antigos: só o hash do código longo está guardado
    if p_lock then select * into v_inv from public.invites where token_hash = extensions.digest(trim(p_code), 'sha256') for update;
    else select * into v_inv from public.invites where token_hash = extensions.digest(trim(p_code), 'sha256'); end if;
  end if;
  return v_inv;
end
$$;

create or replace function private.invite_problem(v_inv public.invites)
returns text language sql stable set search_path = ''
as $$
  select case
    when v_inv.id is null then 'Código de convite inválido. Confirma as letras e os números.'
    when v_inv.revoked_at is not null then 'Este convite foi revogado. Pede um convite novo à tua secção.'
    when v_inv.expires_at <= now() then 'Este convite expirou. Pede um convite novo à tua secção.'
    when v_inv.use_count >= v_inv.max_uses then 'Este convite já atingiu o limite de utilizações.'
  end
$$;

-- Destino do convite, para confirmar antes de entrar. Não altera nada.
create or replace function public.invite_preview(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_inv public.invites;
  v_problem text;
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'Tens de entrar na tua conta primeiro.' using errcode = '42501'; end if;
  if private.invite_blocked() then
    return jsonb_build_object('ok', false, 'error', 'Demasiadas tentativas. Aguarda 15 minutos e tenta de novo.');
  end if;
  v_inv := private.invite_lookup(p_code, false);
  v_problem := private.invite_problem(v_inv);
  insert into private.invite_attempts (profile_id, ok) values (auth.uid(), v_inv.id is not null);
  if v_problem is not null then return jsonb_build_object('ok', false, 'error', v_problem); end if;
  select jsonb_build_object(
    'ok', true,
    'section', s.name,
    'group', g.name,
    'team', t.name,
    'expires_at', v_inv.expires_at,
    'already', exists (select 1 from public.memberships m where m.profile_id = auth.uid() and m.section_id = v_inv.section_id and m.status in ('pendente', 'ativo'))
  ) into v_out
  from public.sections s
  left join public.groups g on g.id = s.group_id
  left join public.teams t on t.id = v_inv.team_id
  where s.id = v_inv.section_id;
  return v_out;
end
$$;

-- Entrada com convite: devolve {ok, membership_id} ou {ok:false, error}. As falhas não
-- lançam exceção, para que a tentativa fique registada (limite contra adivinhação).
create or replace function public.join_section(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_inv public.invites;
  v_problem text;
  v_existing public.memberships;
  v_membership uuid;
begin
  if auth.uid() is null then raise exception 'Tens de entrar na tua conta primeiro.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'Perfil não encontrado.');
  end if;
  if private.invite_blocked() then
    return jsonb_build_object('ok', false, 'error', 'Demasiadas tentativas. Aguarda 15 minutos e tenta de novo.');
  end if;

  v_inv := private.invite_lookup(p_code, true); -- bloqueia a linha: consumo atómico
  v_problem := private.invite_problem(v_inv);
  if v_problem is not null then
    insert into private.invite_attempts (profile_id, ok) values (auth.uid(), v_inv.id is not null);
    return jsonb_build_object('ok', false, 'error', v_problem);
  end if;

  select * into v_existing from public.memberships
   where profile_id = auth.uid() and section_id = v_inv.section_id for update;
  if v_existing.id is not null and v_existing.status in ('pendente', 'ativo') then
    return jsonb_build_object('ok', false, 'error', 'Já tens um pedido ou acesso nesta secção.');
  elsif v_existing.id is not null and v_existing.status = 'suspenso' then
    return jsonb_build_object('ok', false, 'error', 'O teu acesso a esta secção está suspenso. Fala com a administração.');
  end if;
  if exists (select 1 from public.invite_redemptions where invite_id = v_inv.id and profile_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'Já usaste este convite.');
  end if;

  if v_existing.id is not null then
    -- Regresso de quem saiu: volta a pendente, sem função nem permissões.
    perform set_config('pioneiros.reason', 'Novo pedido de entrada por convite', true);
    update public.memberships
       set status = 'pendente', function = null, is_admin = false, team_id = null, requested_team_id = v_inv.team_id,
           invite_id = v_inv.id, requested_at = now(), approved_by = null, approved_at = null
     where id = v_existing.id;
    v_membership := v_existing.id;
  else
    perform set_config('pioneiros.reason', 'Pedido de entrada por convite', true);
    insert into public.memberships (profile_id, section_id, status, invite_id, requested_team_id)
    values (auth.uid(), v_inv.section_id, 'pendente', v_inv.id, v_inv.team_id)
    returning id into v_membership;
  end if;

  insert into public.invite_redemptions (invite_id, profile_id, membership_id) values (v_inv.id, auth.uid(), v_membership);
  update public.invites set use_count = use_count + 1 where id = v_inv.id;
  insert into private.invite_attempts (profile_id, ok) values (auth.uid(), true);

  perform private.notify(private.section_admins(v_inv.section_id), v_inv.section_id, 'pedido_entrada',
    'Novo pedido de entrada', 'Há um novo pedido de entrada na secção a aguardar confirmação.', '/gestao/membros');
  return jsonb_build_object('ok', true, 'membership_id', v_membership);
end
$$;

-- O caminho antigo deixa de estar disponível: as falhas lançavam exceção e não
-- ficavam registadas, o que permitiria contornar o limite de tentativas.
drop function if exists public.redeem_invite(text);

-- Criar convite: devolve o código formatado («AB7K-9M2P»).
drop function if exists public.create_invite(uuid, text, timestamptz, integer);
create or replace function public.create_invite(p_section uuid, p_label text, p_expires_at timestamptz, p_max_uses integer, p_team uuid default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_code text;
begin
  if not private.is_admin(p_section) then
    raise exception 'Só administradores podem criar convites.' using errcode = '42501';
  end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'A validade tem de ser uma data futura.'; end if;
  if p_expires_at > now() + interval '180 days' then raise exception 'A validade máxima é de 180 dias.'; end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 500 then raise exception 'O limite de utilizações deve estar entre 1 e 500.'; end if;
  if p_team is not null and not exists (select 1 from public.teams where id = p_team and section_id = p_section and archived_at is null) then
    raise exception 'Equipa inválida.';
  end if;
  v_code := private.invite_code_new();
  insert into public.invites (section_id, token_hash, code, team_id, label, expires_at, max_uses, created_by)
  values (p_section, extensions.digest(v_code, 'sha256'), v_code, p_team, left(coalesce(trim(p_label), ''), 200), p_expires_at, p_max_uses, auth.uid());
  perform private.audit(p_section, 'convite_criado', 'invite', null,
    jsonb_build_object('label', p_label, 'expires_at', p_expires_at, 'max_uses', p_max_uses, 'team_id', p_team));
  return private.invite_format(v_code);
end
$$;

-- Gerar um convite novo com as mesmas condições e revogar o anterior.
create or replace function public.regenerate_invite(p_invite uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.invites;
  v_code text;
  v_new uuid;
begin
  select * into v_old from public.invites where id = p_invite for update;
  if v_old.id is null or not private.is_admin(v_old.section_id) then
    raise exception 'Convite não encontrado.' using errcode = '42501';
  end if;
  v_code := private.invite_code_new();
  insert into public.invites (section_id, token_hash, code, team_id, label, expires_at, max_uses, created_by)
  values (v_old.section_id, extensions.digest(v_code, 'sha256'), v_code, v_old.team_id, v_old.label,
          greatest(v_old.expires_at, now() + interval '7 days'), v_old.max_uses, auth.uid())
  returning id into v_new;
  update public.invites set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, auth.uid()), replaced_by = v_new
   where id = p_invite;
  perform private.audit(v_old.section_id, 'convite_renovado', 'invite', p_invite::text, jsonb_build_object('novo', v_new));
  return private.invite_format(v_code);
end
$$;

revoke all on table private.invite_attempts from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on function private.invite_code_new() from public, anon, authenticated;
revoke all on function private.invite_lookup(text, boolean) from public, anon, authenticated;
revoke all on function private.invite_blocked() from public, anon, authenticated;

-- ===== supabase/migrations/20261017000200_adesao_datas.sql =====
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

