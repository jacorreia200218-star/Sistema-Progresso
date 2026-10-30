-- Pioneiros — Tarefas com título, «O que fazer», responsável e participantes.
--
-- 1. Título curto (opcional no servidor: as tarefas antigas não o têm e continuam a mostrar o
--    texto). O texto que já existia passa a ser «O que fazer».
-- 2. Participantes: membros ativos da secção que ajudam na tarefa, distintos do responsável
--    (o responsável nunca fica também como participante). Ao editar, p_participants = null
--    mantém os participantes; uma lista substitui-os.
-- 3. «As minhas tarefas» mostra as tarefas de que sou responsável ou participante. Participar
--    não dá acesso à ata: a ligação à ata só aparece a quem já a pode ver, e só o
--    responsável (ou quem gere as tarefas) muda o estado.
-- 4. Os novos participantes recebem o aviso «Nova tarefa», como o responsável.
-- Aditivo: não apaga registos nem obriga a preencher os campos novos nas tarefas antigas.

-- (Chama-se task_title e não title para não ficar ambíguo nas funções antigas que juntam
-- sec_items com reuniões e eventos, que também têm «title».)
alter table public.sec_items add column if not exists task_title text;
alter table public.sec_items drop constraint if exists sec_items_task_title_check;
alter table public.sec_items add constraint sec_items_task_title_check
  check (task_title is null or length(trim(task_title)) between 1 and 120);

create table if not exists public.sec_item_participants (
  item_id uuid not null references public.sec_items (id) on delete cascade,
  profile_id uuid not null references public.profiles (id),
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (item_id, profile_id)
);
-- O histórico passa a registar também o título e os participantes.
alter table public.sec_item_history drop constraint if exists sec_item_history_field_check;
alter table public.sec_item_history add constraint sec_item_history_field_check
  check (field in ('criada', 'estado', 'responsavel', 'equipa', 'prazo', 'atividade', 'texto', 'titulo', 'participantes'));

create index if not exists sec_item_participants_profile on public.sec_item_participants (profile_id);
-- Só pelas funções abaixo (sem políticas: ninguém lê nem escreve diretamente).
alter table public.sec_item_participants enable row level security;

-- Uma tarefa em JSON: título, «O que fazer», responsável, participantes, prazo, estado e evento.
create or replace function private.ata_task_json(i public.sec_items, p_see boolean)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', i.id, 'title', i.task_title, 'text', i.text, 'responsible_id', i.responsible_id,
    'responsible_name', private.sec_name(i.responsible_id),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.profile_id, 'name', private.sec_name(p.profile_id),
               'team_name', (select t.name from public.memberships m join public.teams t on t.id = m.team_id
                              where m.section_id = i.section_id and m.profile_id = p.profile_id and m.status = 'ativo' limit 1))
             order by private.sec_name(p.profile_id))
        from public.sec_item_participants p where p.item_id = i.id), '[]'::jsonb),
    'due_date', i.due_date, 'status', i.exec_status,
    'overdue', i.exec_status in ('por_fazer', 'em_curso') and coalesce(i.due_date < private.sec_today(), false),
    'ata_id', case when p_see then i.minute_id end,
    'event', private.ata_event_json(i.cal_event_id, i.section_id, i.space),
    'updated_at', i.updated_at, 'updated_by_name', private.sec_name(coalesce(i.updated_by, i.created_by)))
$$;

-- Nomes dos participantes, por ordem (para o histórico); null sem participantes.
create or replace function private.ata_participant_names(p_item uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select string_agg(private.sec_name(profile_id), ', ' order by private.sec_name(profile_id))
    from public.sec_item_participants where item_id = p_item
$$;

-- Substitui os participantes (sem o responsável) e devolve quem entrou de novo.
create or replace function private.ata_set_participants(p_item public.sec_items, p_people uuid[])
returns uuid[] language plpgsql security definer set search_path = ''
as $$
declare v_new uuid[];
begin
  if p_people is null then return '{}'; end if;
  if (select count(*) from unnest(p_people) x) > 100 then raise exception 'Demasiados participantes (máximo 100).'; end if;
  if exists (select 1 from unnest(p_people) x(id)
              where x.id is null or not exists (select 1 from public.memberships m
                where m.section_id = p_item.section_id and m.profile_id = x.id and m.status = 'ativo')) then
    raise exception 'Os participantes têm de ser membros ativos da secção.';
  end if;
  select coalesce(array_agg(distinct x.id), '{}') into v_new from unnest(p_people) x(id)
   where x.id is distinct from p_item.responsible_id
     and not exists (select 1 from public.sec_item_participants p where p.item_id = p_item.id and p.profile_id = x.id);
  delete from public.sec_item_participants p
   where p.item_id = p_item.id and (p.profile_id = p_item.responsible_id or not (p.profile_id = any (p_people)));
  insert into public.sec_item_participants (item_id, profile_id, added_by)
  select p_item.id, x, auth.uid() from unnest(v_new) x
  on conflict do nothing;
  return v_new;
end
$$;

-- A assinatura muda (título e participantes): remove-se a antiga para não haver duas versões.
drop function if exists public.ata_task_save(uuid, uuid, uuid, text, uuid, date, text);

-- Criar ou editar uma tarefa da ata.
create or replace function public.ata_task_save(
  p_section uuid, p_task uuid, p_ata uuid, p_text text, p_responsible uuid, p_due date default null, p_status text default 'por_fazer',
  p_title text default null, p_participants uuid[] default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_space text := private.ata_require_writer(p_section); d public.sec_minutes; m public.sec_meetings;
        a public.sec_items; b public.sec_items; v_text text := nullif(trim(coalesce(p_text, '')), '');
        v_title text := nullif(trim(coalesce(p_title, '')), ''); v_added uuid[]; v_notify uuid[]; v_before text; v_after text;
begin
  if v_text is null then raise exception 'Descreve o que é preciso fazer.'; end if;
  if length(v_text) > 2000 then raise exception 'A descrição é demasiado longa (máximo 2000 caracteres).'; end if;
  if length(v_title) > 120 then raise exception 'O título é demasiado longo (máximo 120 caracteres).'; end if;
  if p_responsible is null then raise exception 'Escolhe o responsável.'; end if;
  if not exists (select 1 from public.memberships where section_id = p_section and profile_id = p_responsible and status = 'ativo') then
    raise exception 'O responsável tem de ser um membro ativo da secção.';
  end if;
  if coalesce(p_status, 'por_fazer') not in ('por_fazer', 'em_curso', 'concluida') then raise exception 'Estado inválido.'; end if;

  if p_task is not null then
    select * into a from public.sec_items where id = p_task and section_id = p_section and space = v_space for update;
    if a.id is null or not private.sec_can_see_as(a.meeting_id, auth.uid()) then raise exception 'Registo não encontrado.'; end if;
    b := a;
    -- Uma tarefa antiga sem título continua sem título se o formulário o deixar vazio.
    b.task_title := v_title;
    b.text := v_text; b.responsible_id := p_responsible; b.due_date := p_due; b.exec_status := coalesce(p_status, 'por_fazer');
    if b.exec_status = 'concluida' and a.exec_status <> 'concluida' then b.completed_at := now(); b.completed_by := auth.uid(); end if;
    if b.exec_status <> 'concluida' then b.completed_at := null; b.completed_by := null; end if;
    if b.exec_status is distinct from a.exec_status then b.status_changed_by := auth.uid(); b.status_changed_at := now(); end if;
    b.updated_by := auth.uid(); b.updated_at := now();
    update public.sec_items set task_title = b.task_title, text = b.text, responsible_id = b.responsible_id, due_date = b.due_date,
           exec_status = b.exec_status, completed_at = b.completed_at, completed_by = b.completed_by,
           status_changed_by = b.status_changed_by, status_changed_at = b.status_changed_at, updated_by = b.updated_by,
           updated_at = b.updated_at
     where id = a.id;
    perform private.sec_item_log(a, b, null);
    if a.task_title is distinct from b.task_title then
      insert into public.sec_item_history (item_id, section_id, space, field, from_value, to_value, note, changed_by)
      values (b.id, b.section_id, b.space, 'titulo', a.task_title, b.task_title, null, auth.uid());
    end if;
    -- O responsável novo deixa de ser participante, mesmo sem lista nova.
    v_before := private.ata_participant_names(b.id);
    v_added := private.ata_set_participants(b, coalesce(p_participants,
      array(select profile_id from public.sec_item_participants where item_id = b.id)));
    v_after := private.ata_participant_names(b.id);
    if v_before is distinct from v_after then
      insert into public.sec_item_history (item_id, section_id, space, field, from_value, to_value, note, changed_by)
      values (b.id, b.section_id, b.space, 'participantes', v_before, v_after, null, auth.uid());
    end if;
  else
    select * into d from public.sec_minutes where id = p_ata and section_id = p_section and space = v_space and kind = 'ata';
    select * into m from public.sec_meetings where id = d.meeting_id;
    if d.id is null or m.status <> 'ativa' or not private.sec_can_see_as(m.id, auth.uid()) then raise exception 'Registo não encontrado.'; end if;
    insert into public.sec_items (section_id, space, meeting_id, minute_id, kind, task_title, text, responsible_id, due_date, exec_status,
                                  cal_event_id, completed_at, completed_by, created_by, updated_by)
    values (p_section, v_space, m.id, d.id, 'tarefa', v_title, v_text, p_responsible, p_due, coalesce(p_status, 'por_fazer'), m.cal_event_id,
            case when p_status = 'concluida' then now() end, case when p_status = 'concluida' then auth.uid() end, auth.uid(), auth.uid())
    returning * into b;
    perform private.sec_item_log(null, b, null);
    v_added := private.ata_set_participants(b, coalesce(p_participants, '{}'));
  end if;

  v_notify := v_added;
  if a.id is null or a.responsible_id is distinct from b.responsible_id then v_notify := array_append(v_notify, b.responsible_id); end if;
  v_notify := array(select distinct x from unnest(v_notify) x where x is distinct from auth.uid());
  if cardinality(v_notify) > 0 then
    perform private.module_notify(p_section, 'secretaria', v_space, v_notify, 'sec_tarefa', 'Nova tarefa',
      left(coalesce(b.task_title, b.text), 160) || coalesce(' · prazo ' || to_char(b.due_date, 'DD-MM-YYYY'), ''), '/atas-e-tarefas/minhas');
  end if;
  perform private.audit(p_section, case when a.id is null then 'tarefa_criada' else 'tarefa_alterada' end, 'sec_item', b.id::text,
    jsonb_build_object('space', v_space, 'participantes_novos', coalesce(cardinality(v_added), 0)));
  return b.id;
end
$$;

-- As minhas tarefas: sou responsável ou participante (a ligação à ata só se a puder ver).
create or replace function public.ata_my_tasks(p_section uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_space text := private.module_require(p_section, 'secretaria');
begin
  return coalesce((
    select jsonb_agg(private.ata_task_json(i, private.sec_can_see_as(i.meeting_id, auth.uid()))
             || jsonb_build_object('my_role', case when i.responsible_id = auth.uid() then 'responsavel' else 'participante' end)
             order by i.exec_status = 'concluida', i.due_date nulls last, i.created_at)
      from public.sec_items i join public.sec_meetings m on m.id = i.meeting_id
     where i.section_id = p_section and i.space = v_space
       and (i.responsible_id = auth.uid()
            or exists (select 1 from public.sec_item_participants p where p.item_id = i.id and p.profile_id = auth.uid()))
       and i.kind in ('tarefa', 'preparar') and i.exec_status <> 'cancelada' and m.status = 'ativa'), '[]'::jsonb);
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.process_due_reminders() from authenticated;
revoke all on function private.ata_task_json(public.sec_items, boolean), private.ata_set_participants(public.sec_items, uuid[]),
  private.ata_participant_names(uuid) from public, anon;
revoke all on public.sec_item_participants from anon, authenticated;
notify pgrst, 'reload schema';
