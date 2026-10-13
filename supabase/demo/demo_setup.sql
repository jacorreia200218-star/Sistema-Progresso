-- =====================================================================
-- APENAS PARA O PROJETO DE DEMONSTRAÇÃO — NUNCA EXECUTAR EM PRODUÇÃO
-- =====================================================================
-- Organiza contas de teste (criadas previamente através da aplicação, com
-- emails de teste) numa secção claramente identificada como demonstração.
-- Não cria progresso: o progresso de demonstração deve ser criado usando a
-- própria aplicação, para exercitar as mesmas regras de produção.
--
-- Proteção: recusa correr se já existir alguma secção cujo nome não contenha
-- «DEMONSTRAÇÃO» (ou seja, num projeto que já tenha dados reais).
do $$
declare
  v_section uuid;
  v_team uuid;
begin
  if exists (select 1 from public.sections where name not ilike '%DEMONSTRAÇÃO%') then
    raise exception 'Este projeto tem secções reais. O script de demonstração só corre num projeto separado.';
  end if;
  -- Substitui pelos emails das contas de teste:
  v_section := private.bootstrap_section('Agrupamento DEMONSTRAÇÃO', 'Pioneiros — DEMONSTRAÇÃO', 'dirigente.demo@exemplo.invalid', true);
  insert into public.teams (section_id, name) values (v_section, 'Equipa Demonstração') on conflict do nothing;
  select id into v_team from public.teams where section_id = v_section and name = 'Equipa Demonstração';
  insert into public.memberships (profile_id, section_id, status, function, team_id, approved_at)
  select u.id, v_section, 'ativo', x.fn::public.member_function, v_team, now()
    from (values ('guia.demo@exemplo.invalid', 'guia'), ('pioneiro.demo@exemplo.invalid', 'pioneiro')) as x(email, fn)
    join auth.users u on lower(u.email) = x.email
  on conflict (profile_id, section_id) do nothing;
end $$;
