-- =====================================================================
-- VERIFICAÇÃO DA INSTALAÇÃO (só leitura — não altera nada)
-- Cola no SQL Editor do Supabase e carrega em «Run». Todas as linhas devem
-- dizer OK. Envia o resultado se alguma disser FALHA.
-- =====================================================================
with checks(ordem, verificacao, ok, detalhe) as (
  select 1, 'Catálogo: 6 áreas', (select count(*) from public.catalog_areas) = 6,
         (select count(*) from public.catalog_areas)::text
  union all select 2, 'Catálogo: 18 trilhos', (select count(*) from public.catalog_trails) = 18,
         (select count(*) from public.catalog_trails)::text
  union all select 3, 'Catálogo: 38 objetivos', (select count(*) from public.catalog_objectives) = 38,
         (select count(*) from public.catalog_objectives)::text
  union all select 4, 'Catálogo: 4 etapas (Desprendimento…Construção)', (select count(*) from public.catalog_stages) = 4,
         (select string_agg(name, ', ' order by ordinal) from public.catalog_stages)
  union all select 5, 'RLS ativa em todas as tabelas públicas',
         not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity),
         coalesce((select string_agg(tablename, ', ') from pg_tables where schemaname = 'public' and not rowsecurity), 'todas com RLS')
  union all select 6, 'Visitantes anónimos sem acesso às tabelas',
         not exists (select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'),
         coalesce((select string_agg(distinct table_name, ', ') from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'), 'nenhuma')
  union all select 7, 'Visitantes anónimos não executam funções',
         not has_function_privilege('anon', 'public.redeem_invite(text)', 'execute')
         and not has_function_privilege('anon', 'public.record_team_decision(uuid,integer,boolean,date,text)', 'execute'), ''
  union all select 8, 'Função do 1.º admin inacessível pela API',
         not has_function_privilege('authenticated', 'private.bootstrap_section(text,text,text,boolean)', 'execute'), ''
  union all select 9, 'Gatilho de criação de perfil no registo',
         exists (select 1 from pg_trigger where tgname = 'on_auth_user_created'), ''
  union all select 10, 'Bucket «fotografias» existe e é privado',
         exists (select 1 from storage.buckets where id = 'fotografias' and not public), ''
  union all select 11, 'Bucket «anexos» existe e é privado',
         exists (select 1 from storage.buckets where id = 'anexos' and not public), ''
  union all select 12, 'Políticas de acesso aos ficheiros (7)',
         (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
            and (policyname like 'fotografias:%' or policyname like 'anexos:%')) = 7,
         (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
            and (policyname like 'fotografias:%' or policyname like 'anexos:%'))::text
  union all select 13, 'Secção criada (primeiro_admin.sql)',
         exists (select 1 from public.sections where catalog_version_id is not null),
         coalesce((select string_agg(s.name || ' / ' || g.name, '; ') from public.sections s join public.groups g on g.id = s.group_id), 'nenhuma secção')
  union all select 14, 'Configuração da secção existe',
         (select count(*) from public.sections) > 0
         and not exists (select 1 from public.sections s where not exists (select 1 from public.section_settings x where x.section_id = s.id)), ''
  union all select 15, 'Administrador ativo',
         exists (select 1 from public.memberships where status = 'ativo' and is_admin),
         coalesce((select string_agg(p.full_name || coalesce(' (' || m.function || ')', ''), ', ')
                     from public.memberships m join public.profiles p on p.id = m.profile_id
                    where m.status = 'ativo' and m.is_admin), 'nenhum')
  union all select 16, 'Todas as contas têm perfil',
         not exists (select 1 from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)),
         (select count(*) from auth.users)::text || ' conta(s)'
)
select ordem, verificacao, case when ok then 'OK' else 'FALHA' end as resultado, detalhe
from checks order by ordem;
