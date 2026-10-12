-- ============================================================
--  WORKER APP — SCHEMA
--  شغّل الملف ده أولاً في Supabase → SQL Editor
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- 1. PROFILES ----------
create table if not exists public.profiles (
  id              uuid primary key references auth.users on delete cascade,
  full_name       text not null,
  phone           text unique,
  username        text unique,
  role            text not null default 'worker'
                    check (role in ('owner','manager','developer','worker')),
  daily_wage      numeric(10,2) not null default 0 check (daily_wage >= 0),
  default_site_id uuid,
  is_active       boolean not null default true,
  status          text not null default 'active'
                    constraint profiles_status_valid
                    check (status in ('pending','active','rejected','suspended')),
  id_card_url     text,
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  reject_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Upgrade-safe columns/constraints for installations created by older versions.
alter table public.profiles
  add column if not exists status text not null default 'active';
alter table public.profiles
  add column if not exists id_card_url text;
alter table public.profiles
  add column if not exists approved_by uuid references public.profiles(id);
alter table public.profiles
  add column if not exists approved_at timestamptz;
alter table public.profiles
  add column if not exists reject_reason text;
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_status_valid'
  ) then
    alter table public.profiles
      add constraint profiles_status_valid
      check (status in ('pending','active','rejected','suspended')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_daily_wage_nonnegative'
  ) then
    alter table public.profiles
      add constraint profiles_daily_wage_nonnegative check (daily_wage >= 0) not valid;
  end if;
end $$;
create index if not exists idx_profiles_status
  on public.profiles(status) where status = 'pending';

-- ---------- Storage: private ID-card images ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('id-cards', 'id-cards', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------- 2. PROJECTS ----------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  status      text not null default 'active' check (status in ('active','closed')),
  start_date  date,
  end_date    date,
  address     text,
  lat         numeric(10,7),
  lng         numeric(10,7),
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,
  archived_at timestamptz,
  archived_by uuid references public.profiles(id)
);
alter table public.projects add column if not exists address text;
alter table public.projects add column if not exists lat numeric(10,7);
alter table public.projects add column if not exists lng numeric(10,7);
alter table public.projects add column if not exists closed_at timestamptz;
alter table public.projects add column if not exists archived_at timestamptz;
alter table public.projects add column if not exists archived_by uuid;
comment on table public.projects is
  'Canonical project/worksite entity used for assignment and activity reporting.';

-- ---------- 3. LEGACY SITES (retained for a guarded migration; not used by the app) ----------
create table if not exists public.sites (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete restrict,
  name       text not null,
  address    text,
  lat        numeric(10,7),
  lng        numeric(10,7),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.sites is
  'Deprecated legacy location table. No new application activity is written here.';

alter table public.profiles drop constraint if exists profiles_default_site_fkey;
alter table public.profiles
  add constraint profiles_default_site_fkey
  foreign key (default_site_id) references public.sites(id) on delete set null;

-- ---------- 4. WORKER_PROJECTS ----------
create table if not exists public.worker_projects (
  id         uuid primary key default gen_random_uuid(),
  worker_id  uuid not null references public.profiles(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  daily_wage numeric(10,2) check (daily_wage is null or daily_wage >= 0),
  joined_at  timestamptz not null default now(),
  unique (worker_id, project_id)
);

-- ---------- 5. SITE_WORKERS ----------
create table if not exists public.site_workers (
  site_id     uuid not null references public.sites(id) on delete restrict,
  worker_id   uuid not null references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (site_id, worker_id)
);

-- ---------- 6. ATTENDANCE ----------
create table if not exists public.attendance (
  id                   uuid primary key default gen_random_uuid(),
  worker_id            uuid not null references public.profiles(id) on delete restrict,
  project_id           uuid references public.projects(id) on delete set null,
  work_date            date not null default current_date,
  source               text not null default 'worker' check (source in ('worker','admin')),
  lat                  numeric(10,7),
  lng                  numeric(10,7),
  note                 text,
  daily_wage_snapshot  numeric(10,2) check (daily_wage_snapshot is null or daily_wage_snapshot >= 0),
  created_by           uuid references public.profiles(id),
  created_at           timestamptz not null default now(),
  unique (worker_id, work_date)
);

alter table public.attendance
  add column if not exists daily_wage_snapshot numeric(10,2);
create index if not exists idx_attendance_worker_date
  on public.attendance(worker_id, work_date desc);

-- Snapshot old rows at the wage currently used by the old view, so later wage
-- changes cannot silently rewrite historical pay. Ambiguous old project links
-- still need review before closing those projects.
update public.attendance a
set daily_wage_snapshot = coalesce(
  (select wp.daily_wage
   from public.worker_projects wp
   where wp.worker_id = a.worker_id
     and wp.project_id = a.project_id
     and wp.daily_wage is not null
   limit 1),
  (select p.daily_wage from public.profiles p where p.id = a.worker_id),
  0
)
where a.daily_wage_snapshot is null;

-- ---------- 7. ATTENDANCE_SITES ----------
create table if not exists public.attendance_sites (
  id            uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.attendance(id) on delete cascade,
  site_id       uuid not null references public.sites(id) on delete restrict,
  unique (attendance_id, site_id)
);

-- One attendance record (and one wage snapshot) can be linked to any number of projects.
create table if not exists public.attendance_projects (
  attendance_id uuid not null references public.attendance(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete restrict,
  created_at    timestamptz not null default now(),
  primary key (attendance_id, project_id)
);
create index if not exists idx_attendance_projects_project
  on public.attendance_projects(project_id, attendance_id);
comment on table public.attendance_projects is
  'Project/activity links for one daily attendance record; never a separate wage or balance.';
insert into public.attendance_projects (attendance_id, project_id)
select a.id, a.project_id
from public.attendance a
join public.projects p on p.id = a.project_id
where a.project_id is not null
on conflict (attendance_id, project_id) do nothing;

-- ---------- 8. WITHDRAWALS ----------
create table if not exists public.withdrawals (
  id               uuid primary key default gen_random_uuid(),
  worker_id        uuid not null references public.profiles(id) on delete restrict,
  project_id       uuid references public.projects(id) on delete set null,
  amount           numeric(10,2) not null check (amount > 0),
  note             text,
  status           text not null default 'pending'
                     check (status in ('pending','approved','rejected')),
  decided_by       uuid references public.profiles(id),
  decided_at       timestamptz,
  decision_note    text,
  created_by       uuid references public.profiles(id),
  client_request_id uuid,
  created_at       timestamptz not null default now()
);

alter table public.withdrawals
  add column if not exists client_request_id uuid;
create unique index if not exists idx_withdrawals_client_request
  on public.withdrawals(client_request_id) where client_request_id is not null;
create index if not exists idx_withdrawals_worker
  on public.withdrawals(worker_id, created_at desc);
create index if not exists idx_withdrawals_status
  on public.withdrawals(status) where status = 'pending';

-- ---------- 9. DEDUCTIONS ----------
create table if not exists public.deductions (
  id         uuid primary key default gen_random_uuid(),
  worker_id  uuid not null references public.profiles(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  amount     numeric(10,2) not null check (amount > 0),
  reason     text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deductions'::regclass
      and conname = 'deductions_amount_positive'
  ) then
    alter table public.deductions
      add constraint deductions_amount_positive check (amount > 0) not valid;
  end if;
end $$;

-- ---------- 10. SETTLEMENTS ----------
create table if not exists public.settlements (
  id               uuid primary key default gen_random_uuid(),
  worker_id        uuid not null references public.profiles(id) on delete restrict,
  project_id       uuid not null references public.projects(id) on delete restrict,
  days_worked      int not null default 0 check (days_worked >= 0),
  daily_wage       numeric(10,2) not null default 0 check (daily_wage >= 0),
  total_earned     numeric(10,2) not null default 0,
  total_withdrawn  numeric(10,2) not null default 0,
  total_deductions numeric(10,2) not null default 0,
  net_amount       numeric(10,2) not null default 0,
  status           text not null default 'draft' check (status in ('draft','confirmed','paid')),
  worker_ack_at    timestamptz,
  confirmed_by     uuid references public.profiles(id),
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),
  unique (worker_id, project_id)
);

-- ---------- 11. AUDIT_LOG ----------
create table if not exists public.audit_log (
  id         bigserial primary key,
  table_name text not null,
  record_id  text,
  action     text not null check (action in ('insert','update','delete')),
  old_data   jsonb,
  new_data   jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists idx_audit_time on public.audit_log(changed_at desc);

-- ---------- 12. NOTIFICATIONS ----------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  data       jsonb,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_user
  on public.notifications(user_id, created_at desc);

-- ---------- 13. SETTINGS ----------
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value) values
  ('app', '{"auto_approve_limit":500,"absence_deduction":50,"day_lock_time":"00:00","gps_enabled":true,"currency":"ج.م"}'::jsonb),
  ('telegram', '{"chat_id":""}'::jsonb)
on conflict (key) do nothing;
-- Telegram bot tokens must never be stored in the client-readable settings table.
update public.settings
set value = coalesce(value, '{}'::jsonb) - 'bot_token'
where key = 'telegram' and value ? 'bot_token';

-- ---------- VIEWS ----------
-- Views execute under the caller's privileges and therefore inherit table RLS.
create or replace view public.attendance_with_wage
with (security_invoker = true) as
select
  a.id,
  a.worker_id,
  a.project_id,
  a.work_date,
  coalesce(a.daily_wage_snapshot, p.daily_wage, 0) as wage
from public.attendance a
join public.profiles p on p.id = a.worker_id;

-- All-project balance for the worker and admin overview.
create or replace view public.worker_balances
with (security_invoker = true) as
select
  p.id as worker_id,
  p.full_name,
  p.phone,
  p.role,
  p.daily_wage,
  p.is_active,
  coalesce(e.days_worked, 0)::int as days_worked,
  coalesce(e.earned, 0) as earned,
  coalesce(w.approved, 0) as withdrawn_approved,
  coalesce(w.pending, 0) as withdrawn_pending,
  coalesce(d.deducted, 0) as deducted,
  coalesce(e.earned, 0) - coalesce(w.approved, 0) - coalesce(d.deducted, 0) as balance,
  coalesce(e.earned, 0) - coalesce(w.approved, 0)
    - coalesce(w.pending, 0) - coalesce(d.deducted, 0) as available
from public.profiles p
left join (
  select worker_id, count(*) as days_worked, sum(wage) as earned
  from public.attendance_with_wage
  group by worker_id
) e on e.worker_id = p.id
left join (
  select worker_id,
         sum(amount) filter (where status = 'approved') as approved,
         sum(amount) filter (where status = 'pending') as pending
  from public.withdrawals
  group by worker_id
) w on w.worker_id = p.id
left join (
  select worker_id, sum(amount) as deducted
  from public.deductions
  group by worker_id
) d on d.worker_id = p.id
where p.role = 'worker';

-- Project-scoped financial balances are intentionally not exposed. A worker's
-- wages, withdrawals and deductions belong to the global worker account.

-- Daily counts use the company's Cairo business date, not the database host's UTC date.
create or replace view public.daily_summary
with (security_invoker = true) as
select
  (now() at time zone 'Africa/Cairo')::date as day,
  (select count(*) from public.profiles where role = 'worker' and is_active and status = 'active') as total_workers,
  (select count(distinct worker_id) from public.attendance
    where work_date = (now() at time zone 'Africa/Cairo')::date) as present_today,
  (select count(*) from public.profiles where role = 'worker' and is_active and status = 'active'
    and id not in (select worker_id from public.attendance
      where work_date = (now() at time zone 'Africa/Cairo')::date)) as absent_today,
  (select coalesce(sum(amount), 0) from public.withdrawals
    where (created_at at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date
      and status = 'approved') as withdrawn_today,
  (select coalesce(sum(wage), 0) from public.attendance_with_wage
    where work_date = (now() at time zone 'Africa/Cairo')::date) as earned_today;
