-- Pioneiros — Mapa do caminho para todos (31/10/2026).
--
-- Todos os elementos ativos da secção veem o mapa completo do caminho no Início: o nome,
-- a fotografia, a equipa e o marco em que está cada pioneiro e guia.
-- 1. section_path devolve todas as pessoas; can_open diz se quem pergunta pode abrir o
--    percurso (o próprio, o guia da equipa e os dirigentes, como antes). O estado dentro do
--    marco só vai a quem pode abrir o percurso.
-- 2. can_view_profile: os elementos ativos da mesma secção veem o nome, o totem e a
--    fotografia uns dos outros (o perfil só tem estes campos). Inscrições, percursos,
--    reflexões, anexos e comentários continuam com as mesmas regras.
-- Não altera nem apaga registos.

create or replace function private.can_view_profile(p_profile uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_profile = auth.uid() or exists (
    select 1
    from public.memberships target
    where target.profile_id = p_profile
      and private.can_view_membership(target.id)
  ) or exists (
    select 1
    from public.memberships target
    join public.memberships me
      on me.section_id = target.section_id and me.profile_id = auth.uid() and me.status = 'ativo'
    where target.profile_id = p_profile and target.status = 'ativo'
  )
$$;

create or replace function public.section_path(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_me public.memberships;
begin
  v_me := private.my_active_membership(p_section);
  if v_me.id is null then raise exception 'Sem acesso a esta secção.' using errcode = '42501'; end if;
  return (
    with members as (
      select m.id, m.team_id, m.function, p.full_name, p.totem, p.photo_path,
             private.member_position(m.id) as pos,
             private.can_view_progress(m.id) as visible
        from public.memberships m join public.profiles p on p.id = m.profile_id
       where m.section_id = p_section and m.status = 'ativo' and m.function in ('pioneiro', 'guia')
    )
    select jsonb_build_object(
      'scope', case when v_me.function = 'dirigente' then 'seccao' when v_me.function = 'guia' then 'equipa' else 'proprio' end,
      'total', (select count(*) from members),
      'counts', coalesce((select jsonb_object_agg(k, n) from (select pos ->> 'milestone' k, count(*) n from members group by 1) c), '{}'::jsonb),
      'members', coalesce((select jsonb_agg(jsonb_build_object(
          'membership_id', id, 'full_name', full_name, 'totem', totem, 'photo_path', photo_path,
          'team_id', team_id, 'function', function,
          'milestone', pos ->> 'milestone',
          'state', case when visible then pos ->> 'state' end,
          'can_open', visible, 'is_me', id = v_me.id)
          order by full_name) from members), '[]'::jsonb)
    )
  );
end
$$;
