-- Pioneiros — Calendário escutista: atividades, participantes, presenças, pendências,
-- prazos e lembretes. Todas as tabelas têm section_id e space (teste/real) e RLS sem
-- políticas: leitura e escrita só por funções que verificam o acesso no servidor.
-- Horas guardadas como instantes (timestamptz) e mostradas em Europe/Lisbon; eventos de
-- dia inteiro guardados como datas (start_date/end_date, fim inclusivo), sem hora.

create table if not exists public.cal_events (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  space text not null check (space in ('teste', 'real')),
  title text not null check (length(trim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 5000),
  location text check (location is null or length(location) <= 300),
  all_day boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  start_date date,
  end_date date,
  audience text not null default 'seccao' check (audience in ('seccao', 'equipa')),
  team_id uuid references public.teams (id),
  responsible_id uuid references public.profiles (id),
  registration_deadline timestamptz,
  needs_authorization boolean not null default false,
  needs_payment boolean not null default false,
  needs_registration boolean not null default false,
  material text check (material is null or length(material) <= 2000),
  reminder_minutes integer[] not null default '{1440}',
  deadline_reminder_minutes integer[] not null default '{1440}',
  status text not null default 'ativo' check (status in ('ativo', 'cancelado')),
  cancel_reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (audience <> 'equipa' or team_id is not null),
  check ((all_day and start_date is not null and end_date is not null and end_date >= start_date and starts_at is null and ends_at is null)
      or (not all_day and starts_at is not null and ends_at is not null and ends_at >= starts_at and start_date is null and end_date is null))
);
create index if not exists cal_events_section on public.cal_events (section_id, space);
alter table public.cal_events enable row level security;
