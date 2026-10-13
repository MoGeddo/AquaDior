-- GENERATED CONSOLIDATED SCRIPT — source files: schema.sql, policies.sql, triggers.sql, functions.sql.
-- Keep this file synchronized with those sources; do not add credentials or account passwords.
-- This is the unified project/worksite attendance model. Legacy site tables are retained only for guarded transition.
-- Intended for a new/empty Staging project; never run on Production or over an existing database.
-- ============================================================


-- ==================== BEGIN schema.sql ===================

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
  'Canonical active project/worksite; workers choose one or more open projects when recording daily attendance.';

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

-- GPS has been removed from attendance capture. Keep lat/lng columns for old rows,
-- but force all newly inserted attendance rows to store NULL coordinates.
create or replace function public.clear_new_attendance_gps()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.lat := null;
  new.lng := null;
  return new;
end;
$$;

drop trigger if exists trg_attendance_no_gps on public.attendance;
create trigger trg_attendance_no_gps
  before insert on public.attendance
  for each row execute function public.clear_new_attendance_gps();
revoke all on function public.clear_new_attendance_gps() from public, anon, authenticated;

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
  created_at timestamptz not null default now(),
  voided_at  timestamptz,
  voided_by  uuid references public.profiles(id),
  void_reason text
);
alter table public.deductions add column if not exists voided_at timestamptz;
alter table public.deductions add column if not exists voided_by uuid references public.profiles(id);
alter table public.deductions add column if not exists void_reason text;
create index if not exists idx_deductions_worker_active
  on public.deductions(worker_id, created_at desc) where voided_at is null;
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
  project_id       uuid references public.projects(id) on delete restrict,
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
  client_request_id uuid,
  created_at       timestamptz not null default now(),
  unique (worker_id, project_id)
);
alter table public.settlements add column if not exists client_request_id uuid;
create unique index if not exists idx_settlements_client_request
  on public.settlements(client_request_id) where client_request_id is not null;

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
  ('app', '{"absence_deduction":50,"day_lock_time":"00:00","gps_enabled":false,"currency":"ج.م"}'::jsonb),
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
  coalesce(e.earned, 0) - coalesce(w.approved, 0) - coalesce(d.deducted, 0) - coalesce(st.paid, 0) as balance,
  coalesce(e.earned, 0) - coalesce(w.approved, 0)
    - coalesce(w.pending, 0) - coalesce(d.deducted, 0) - coalesce(st.paid, 0) as available,
  coalesce(st.paid, 0) as settled_paid
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
  where voided_at is null
  group by worker_id
) d on d.worker_id = p.id
left join (
  select worker_id, sum(net_amount) as paid
  from public.settlements
  where project_id is null and status = 'paid'
  group by worker_id
) st on st.worker_id = p.id
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

-- ==================== END schema.sql ===================


-- ==================== BEGIN policies.sql ===================

-- ============================================================
--  WORKER APP — ROW LEVEL SECURITY (fail-closed)
--  شغّل الملف ده بعد schema.sql
-- ============================================================

-- RLS helper functions: لا تعتبر الحساب الإداري صالحاً إلا لو مفعّل.
-- SECURITY DEFINER مطلوب لتفادي recursion في profiles policies.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth, extensions
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('owner', 'manager', 'developer')
      and p.status = 'active'
      and p.is_active = true
  );
$$;

create or replace function public.is_developer()
returns boolean
language sql
stable
security definer
set search_path = public, auth, extensions
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'developer'
      and p.status = 'active'
      and p.is_active = true
  );
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_developer() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_developer() to authenticated;

-- Prevent untrusted clients from adding shadow routines/objects to SECURITY DEFINER search paths.
revoke create on schema public from public, anon, authenticated;

-- ---------- PROFILES ----------
alter table public.profiles enable row level security;

drop policy if exists "own profile read" on public.profiles;
drop policy if exists "admin read all" on public.profiles;
drop policy if exists "own profile update" on public.profiles;
drop policy if exists "admin update all" on public.profiles;
drop policy if exists "admin insert" on public.profiles;
drop policy if exists "admin delete" on public.profiles;
drop policy if exists "self signup" on public.profiles;

-- Profile mutations are RPC-only. Removing table DML privileges is essential:
-- RLS policies cannot restrict which columns an administrator may update.
revoke all on table public.profiles from public, anon, authenticated;
revoke insert (
  id, full_name, phone, username, role, daily_wage, default_site_id,
  is_active, status, id_card_url, approved_by, approved_at, reject_reason,
  created_at, updated_at
) on public.profiles from public, anon, authenticated;
revoke update (
  id, full_name, phone, username, role, daily_wage, default_site_id,
  is_active, status, id_card_url, approved_by, approved_at, reject_reason,
  created_at, updated_at
) on public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;

create policy "own profile read" on public.profiles
  for select using (auth.uid() = id);
create policy "admin read all" on public.profiles
  for select using (public.is_admin());
-- Role/status/wage/activation/profile changes go through narrowly validated RPCs.

-- ---------- PROJECTS ----------
alter table public.projects enable row level security;

drop policy if exists "projects read" on public.projects;
drop policy if exists "projects insert" on public.projects;
drop policy if exists "projects update" on public.projects;
drop policy if exists "projects delete" on public.projects;

create policy "projects read" on public.projects for select
  using (
    public.is_admin()
    or (
      projects.status = 'active'
      and exists (
        select 1 from public.profiles worker
        where worker.id = auth.uid() and worker.role = 'worker'
          and worker.status = 'active' and worker.is_active = true
      )
    )
    or exists (
      select 1 from public.attendance_projects ap
      join public.attendance a on a.id = ap.attendance_id
      where ap.project_id = projects.id and a.worker_id = auth.uid()
    )
  );
create policy "projects insert" on public.projects for insert
  with check (public.is_admin());
-- Project status changes must go through close_project(); no direct UPDATE policy.
-- لا يوجد حذف مباشر للمشاريع؛ الحذف الآمن للمطوّر فقط عبر RPC مقيّد بمنع فقدان أي سجل تاريخي.

-- ---------- SITES ----------
alter table public.sites enable row level security;

drop policy if exists "sites read" on public.sites;
drop policy if exists "sites write" on public.sites;

create policy "sites read" on public.sites for select
  using (
    public.is_admin()
    or (
      sites.is_active = true
      and (sites.project_id is null or exists (
        select 1 from public.projects project
        where project.id = sites.project_id and project.status = 'active'
      ))
      and exists (
        select 1 from public.profiles worker
        where worker.id = auth.uid() and worker.role = 'worker'
          and worker.status = 'active' and worker.is_active = true
      )
    )
    or exists (
      select 1 from public.attendance_sites ats
      join public.attendance a on a.id = ats.attendance_id
      where ats.site_id = sites.id and a.worker_id = auth.uid()
    )
  );
-- The unified app manages sites as projects. Legacy site rows are read-only.
revoke insert, update, delete on table public.sites from public, anon, authenticated;

-- ---------- WORKER_PROJECTS ----------
alter table public.worker_projects enable row level security;

drop policy if exists "wp read" on public.worker_projects;
drop policy if exists "wp write" on public.worker_projects;

create policy "wp read" on public.worker_projects for select
  using (auth.uid() = worker_id or public.is_admin());
-- Legacy worker-project rows are readable for compatibility only; no assignment writes.
revoke insert, update, delete on table public.worker_projects from public, anon, authenticated;
grant select on table public.worker_projects to authenticated;

-- ---------- SITE_WORKERS ----------
alter table public.site_workers enable row level security;

drop policy if exists "sw read" on public.site_workers;
drop policy if exists "sw write" on public.site_workers;

create policy "sw read" on public.site_workers for select
  using (auth.uid() = worker_id or public.is_admin());
-- Legacy site-worker assignments are read-only; current projects are self-selected.
revoke insert, update, delete on table public.site_workers from public, anon, authenticated;

-- ---------- ATTENDANCE ----------
alter table public.attendance enable row level security;

drop policy if exists "att own read" on public.attendance;
drop policy if exists "att admin read" on public.attendance;
drop policy if exists "att own insert" on public.attendance;
drop policy if exists "att admin all" on public.attendance;
drop policy if exists "att own update" on public.attendance;
drop policy if exists "att own delete" on public.attendance;

create policy "att own read" on public.attendance for select
  using (auth.uid() = worker_id);
create policy "att admin read" on public.attendance for select
  using (public.is_admin());
-- كتابة الحضور للعامل تمر حصراً عبر register_attendance RPC المحمية.
create policy "att admin insert" on public.attendance for insert
  with check (public.is_admin());
create policy "att admin update" on public.attendance for update
  using (public.is_admin()) with check (public.is_admin());
create policy "att admin delete" on public.attendance for delete
  using (public.is_admin());
-- Attendance rows are inserted by the single-record RPC; assignments are never duplicated.
revoke all on table public.attendance from public, anon, authenticated;
grant select, delete on table public.attendance to authenticated;

-- ---------- ATTENDANCE_SITES ----------
alter table public.attendance_sites enable row level security;

drop policy if exists "asites own" on public.attendance_sites;
drop policy if exists "asites admin" on public.attendance_sites;
drop policy if exists "asites own read" on public.attendance_sites;
drop policy if exists "asites admin all" on public.attendance_sites;

create policy "asites own read" on public.attendance_sites for select
  using (
    exists (
      select 1 from public.attendance a
      where a.id = attendance_sites.attendance_id and a.worker_id = auth.uid()
    )
  );
create policy "asites admin all" on public.attendance_sites for all
  using (public.is_admin()) with check (public.is_admin());
-- Legacy site links are retained only for historical data.

-- ---------- ATTENDANCE_PROJECTS ----------
alter table public.attendance_projects enable row level security;
drop policy if exists "ap read" on public.attendance_projects;
drop policy if exists "ap admin write" on public.attendance_projects;
create policy "ap read" on public.attendance_projects for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.attendance a
      where a.id = attendance_projects.attendance_id and a.worker_id = auth.uid()
    )
  );
create policy "ap admin write" on public.attendance_projects for all
  using (public.is_admin()) with check (public.is_admin());
revoke all on table public.attendance_projects from public, anon, authenticated;
grant select on table public.attendance_projects to authenticated;

-- ---------- WITHDRAWALS ----------
alter table public.withdrawals enable row level security;

drop policy if exists "wd own read" on public.withdrawals;
drop policy if exists "wd admin read" on public.withdrawals;
drop policy if exists "wd own insert" on public.withdrawals;
drop policy if exists "wd admin all" on public.withdrawals;

create policy "wd own read" on public.withdrawals for select
  using (auth.uid() = worker_id);
create policy "wd admin read" on public.withdrawals for select
  using (public.is_admin());
-- العامل لا يستطيع إدخال مبلغ/status مباشرة؛ register_withdrawal هو المسار الوحيد.
create policy "wd admin all" on public.withdrawals for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------- DEDUCTIONS ----------
alter table public.deductions enable row level security;

drop policy if exists "ded read" on public.deductions;
drop policy if exists "ded write" on public.deductions;

create policy "ded read" on public.deductions for select
  using (auth.uid() = worker_id or public.is_admin());
-- Financial deductions are append-only. RPCs may add or void them; clients cannot rewrite ledger rows.
revoke insert, update, delete on table public.deductions from public, anon, authenticated;
grant select on table public.deductions to authenticated;

-- ---------- SETTLEMENTS ----------
alter table public.settlements enable row level security;

drop policy if exists "st read" on public.settlements;
drop policy if exists "st write" on public.settlements;

create policy "st read" on public.settlements for select
  using (auth.uid() = worker_id or public.is_admin());
-- Settlement and payout snapshots are created only through the atomic RPC.
revoke insert, update, delete on table public.settlements from public, anon, authenticated;
grant select on table public.settlements to authenticated;

-- ---------- AUDIT_LOG ----------
alter table public.audit_log enable row level security;

drop policy if exists "audit read" on public.audit_log;
drop policy if exists "audit write" on public.audit_log;

create policy "audit read" on public.audit_log for select
  using (public.is_admin());
-- الإضافة تتم بواسطة trigger داخلي فقط؛ لا نقبل audit مزيف من العميل.

-- ---------- NOTIFICATIONS ----------
alter table public.notifications enable row level security;

drop policy if exists "notif own read" on public.notifications;
drop policy if exists "notif own update" on public.notifications;
drop policy if exists "notif admin read" on public.notifications;
drop policy if exists "notif insert" on public.notifications;

create policy "notif own read" on public.notifications for select
  using (auth.uid() = user_id);
create policy "notif own update" on public.notifications for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Prevent clients from changing notification contents or ownership; only read-state is editable.
revoke update on table public.notifications from public, anon, authenticated;
revoke update (
  id, user_id, type, title, body, data, created_at
) on public.notifications from public, anon, authenticated;
grant update (is_read) on public.notifications to authenticated;
-- إشعارات الإدارة تُنشأ كسجلات فردية بواسطة notify_admins؛ لا يُسمح للإدارة بقراءة صندوق عامل آخر.
-- الإضافة تتم بواسطة trigger داخلي فقط.

-- ---------- SETTINGS ----------
alter table public.settings enable row level security;

drop policy if exists "settings read" on public.settings;
drop policy if exists "settings write" on public.settings;

create policy "settings read" on public.settings for select
  using (public.is_admin());
create policy "settings write" on public.settings for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------- STORAGE: صور البطاقات ----------
-- Supabase enables RLS on storage.objects; do not ALTER this platform-owned table.
-- Apply only the app-specific policies below.

drop policy if exists "worker uploads own card" on storage.objects;
drop policy if exists "worker updates own card" on storage.objects;
drop policy if exists "worker reads own card" on storage.objects;
drop policy if exists "admin reads all cards" on storage.objects;

create policy "worker uploads own card" on storage.objects for insert
  with check (
    bucket_id = 'id-cards'
    and name = (auth.uid()::text || '/card.jpg')
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'worker'
        and p.status = 'pending' and p.is_active = false
    )
  );
create policy "worker updates own card" on storage.objects for update
  using (
    bucket_id = 'id-cards'
    and name = (auth.uid()::text || '/card.jpg')
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'worker'
        and p.status = 'pending' and p.is_active = false
    )
  )
  with check (
    bucket_id = 'id-cards'
    and name = (auth.uid()::text || '/card.jpg')
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'worker'
        and p.status = 'pending' and p.is_active = false
    )
  );
create policy "worker reads own card" on storage.objects for select
  using (
    bucket_id = 'id-cards'
    and name = (auth.uid()::text || '/card.jpg')
  );
create policy "admin reads all cards" on storage.objects for select
  using (bucket_id = 'id-cards' and public.is_admin());

-- Views must obey the caller's RLS, not the view owner's privileges.
alter view public.attendance_with_wage set (security_invoker = true);
alter view public.worker_balances set (security_invoker = true);
alter view public.daily_summary set (security_invoker = true);

-- ==================== END policies.sql ===================


-- ==================== BEGIN triggers.sql ===================

-- ============================================================
--  WORKER APP — AUDIT, NOTIFICATION & BUSINESS TRIGGERS
--  شغّل بعد policies.sql
-- ============================================================

-- ---------- Audit log ----------
create or replace function public.log_audit()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_record_id text;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_new := null;
    v_record_id := coalesce(v_old->>'id', nullif(concat_ws(':',
      v_old->>'key', v_old->>'worker_id', v_old->>'project_id',
      v_old->>'site_id', v_old->>'attendance_id'), ''));
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_record_id := coalesce(v_new->>'id', nullif(concat_ws(':',
      v_new->>'key', v_new->>'worker_id', v_new->>'project_id',
      v_new->>'site_id', v_new->>'attendance_id'), ''));
  else
    v_old := null;
    v_new := to_jsonb(new);
    v_record_id := coalesce(v_new->>'id', nullif(concat_ws(':',
      v_new->>'key', v_new->>'worker_id', v_new->>'project_id',
      v_new->>'site_id', v_new->>'attendance_id'), ''));
  end if;

  insert into public.audit_log
    (table_name, record_id, action, old_data, new_data, changed_by)
  values (tg_table_name, v_record_id, lower(tg_op), v_old, v_new, auth.uid());

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_profiles on public.profiles;
drop trigger if exists trg_audit_attendance on public.attendance;
drop trigger if exists trg_audit_withdrawals on public.withdrawals;
drop trigger if exists trg_audit_deductions on public.deductions;
drop trigger if exists trg_audit_sites on public.sites;
drop trigger if exists trg_audit_projects on public.projects;
drop trigger if exists trg_audit_attendance_sites on public.attendance_sites;
drop trigger if exists trg_audit_attendance_projects on public.attendance_projects;
drop trigger if exists trg_audit_worker_projects on public.worker_projects;
drop trigger if exists trg_audit_site_workers on public.site_workers;
drop trigger if exists trg_audit_settlements on public.settlements;
create trigger trg_audit_profiles after insert or update or delete on public.profiles
  for each row execute function public.log_audit();
create trigger trg_audit_attendance after insert or update or delete on public.attendance
  for each row execute function public.log_audit();
create trigger trg_audit_withdrawals after insert or update or delete on public.withdrawals
  for each row execute function public.log_audit();
create trigger trg_audit_deductions after insert or update or delete on public.deductions
  for each row execute function public.log_audit();
create trigger trg_audit_sites after insert or update or delete on public.sites
  for each row execute function public.log_audit();
create trigger trg_audit_projects after insert or update or delete on public.projects
  for each row execute function public.log_audit();
create trigger trg_audit_attendance_sites after insert or update or delete on public.attendance_sites
  for each row execute function public.log_audit();
create trigger trg_audit_attendance_projects after insert or update or delete on public.attendance_projects
  for each row execute function public.log_audit();
create trigger trg_audit_worker_projects after insert or update or delete on public.worker_projects
  for each row execute function public.log_audit();
create trigger trg_audit_site_workers after insert or update or delete on public.site_workers
  for each row execute function public.log_audit();
create trigger trg_audit_settlements after insert or update or delete on public.settlements
  for each row execute function public.log_audit();

-- ---------- New Auth users always start as disabled workers ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_username text := lower(trim(coalesce(new.raw_user_meta_data->>'username', '')));
  v_full_name text := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), '');
  v_phone text := regexp_replace(coalesce(new.raw_user_meta_data->>'phone', ''), '[^0-9]', '', 'g');
begin
  -- Dashboard-created bootstrap accounts may have no registration metadata.
  -- Keep every Auth-created profile disabled and incomplete in that case; the
  -- trusted owner bootstrap procedure must promote it explicitly.
  if length(v_full_name) < 3 or length(v_full_name) > 120 then
    v_full_name := 'حساب غير مكتمل';
  end if;
  if length(v_phone) < 10 or length(v_phone) > 15 then
    v_phone := null;
  end if;
  if v_username !~ '^[a-z0-9._-]{3,32}$' then
    v_username := null;
  end if;

  insert into public.profiles
    (id, full_name, phone, username, role, status, is_active)
  values (
    new.id,
    v_full_name,
    nullif(v_phone, ''),
    nullif(v_username, ''),
    'worker',
    'pending',
    false
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    phone = excluded.phone,
    username = excluded.username,
    role = 'worker',
    status = 'pending',
    is_active = false;

  perform public.notify_admins(
    'registration_new',
    'طلب تسجيل جديد',
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'عامل')
      || ' سجّل بياناته — مستني موافقتك',
    jsonb_build_object('worker_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Registration decision notification ----------
create or replace function public.notify_registration_decision()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if old.status is distinct from new.status then
    if new.status = 'active' and old.status = 'pending' then
      insert into public.notifications (user_id, type, title, body, data)
      values (new.id, 'account_approved', 'تم تفعيل حسابك',
              'تقدر دلوقتي تسجّل حضورك وتتابع حسابك', '{}'::jsonb);
    elsif new.status = 'rejected' and old.status <> 'rejected' then
      insert into public.notifications (user_id, type, title, body, data)
      values (new.id, 'account_rejected', 'تم رفض حسابك',
              coalesce(new.reject_reason, 'تواصل مع المالك'), '{}'::jsonb);
    elsif new.status = 'suspended' and old.status <> 'suspended' then
      insert into public.notifications (user_id, type, title, body, data)
      values (new.id, 'account_suspended', 'تم إيقاف حسابك',
              'تواصل مع الإدارة لمعرفة التفاصيل', '{}'::jsonb);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notif_registration on public.profiles;
create trigger trg_notif_registration after update on public.profiles
  for each row execute function public.notify_registration_decision();

-- ---------- Admin notifications (internal helper only) ----------
create or replace function public.notify_admins(
  p_type text,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  insert into public.notifications (user_id, type, title, body, data)
  select id, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb)
  from public.profiles
  where role in ('owner','manager','developer')
    and status = 'active' and is_active = true;
end;
$$;

-- ---------- Attendance notifications ----------
create or replace function public.notify_attendance()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_name text;
  v_date text;
begin
  select full_name into v_name from public.profiles where id = new.worker_id;
  v_date := to_char(new.work_date, 'YYYY-MM-DD');
  if tg_op = 'INSERT' then
    perform public.notify_admins(
      'attendance_new', 'حضور جديد',
      coalesce(v_name, 'عامل') || ' سجّل حضوره يوم ' || v_date,
      jsonb_build_object('worker_id', new.worker_id, 'work_date', v_date)
    );
  elsif tg_op = 'UPDATE' then
    perform public.notify_admins(
      'attendance_edit', 'تعديل حضور',
      coalesce(v_name, 'عامل') || ' تم تعديل حضوره يوم ' || v_date,
      jsonb_build_object('worker_id', new.worker_id, 'work_date', v_date)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notif_attendance on public.attendance;
create trigger trg_notif_attendance after insert or update on public.attendance
  for each row execute function public.notify_attendance();

-- ---------- Withdrawal requests always require owner approval ----------
create or replace function public.notify_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_name text;
  v_currency text;
  v_worker_title text;
  v_worker_body text;
begin
  select full_name into v_name from public.profiles where id = new.worker_id;
  select value->>'currency' into v_currency
  from public.settings where key = 'app';
  if v_currency is null or length(v_currency) > 20 then v_currency := 'ج.م'; end if;

  if tg_op = 'INSERT' then
    -- A new request is never approved by a trigger, regardless of amount or
    -- any legacy auto_approve_limit value still present in settings.
    new.status := 'pending';
    new.decided_at := null;
    new.decided_by := null;
    new.decision_note := null;
    perform public.notify_admins(
      'withdrawal_pending', 'طلب سحب جديد',
      coalesce(v_name, 'عامل') || ' طلب ' || new.amount || ' ' || v_currency || ' — بانتظار موافقة المالك',
      jsonb_build_object('worker_id', new.worker_id, 'amount', new.amount, 'id', new.id, 'status', new.status)
    );
    insert into public.notifications (user_id, type, title, body, data)
    values (
      new.worker_id,
      'withdrawal_new',
      'طلب السحب بانتظار موافقة المالك',
      'استلمنا طلبك بمبلغ ' || new.amount || ' ' || v_currency || '؛ لن يُخصم من رصيدك إلا بعد موافقة المالك',
      jsonb_build_object('withdrawal_id', new.id, 'amount', new.amount, 'status', new.status)
    );
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    perform public.notify_admins(
      'withdrawal_decided', 'قرار على طلب صرف',
      coalesce(v_name, 'عامل') || ' — الطلب بقيمة ' || new.amount || ' ' || v_currency
        || ' أصبح ' || case new.status
          when 'approved' then 'موافقاً عليه'
          when 'rejected' then 'مرفوضاً'
          else 'معلّقاً'
        end,
      jsonb_build_object('worker_id', new.worker_id, 'amount', new.amount, 'status', new.status, 'id', new.id)
    );
    v_worker_title := case new.status
      when 'approved' then 'تمت الموافقة على طلب السحب'
      when 'rejected' then 'تم رفض طلب السحب'
      else 'تغيّرت حالة طلب السحب'
    end;
    v_worker_body := coalesce(nullif(trim(new.decision_note), ''),
      case new.status
        when 'approved' then 'وافق المالك على طلبك بمبلغ ' || new.amount || ' ' || v_currency
        when 'rejected' then 'رفض المالك طلبك بمبلغ ' || new.amount || ' ' || v_currency
        else 'تغيّرت حالة طلبك بمبلغ ' || new.amount || ' ' || v_currency
      end);
    insert into public.notifications (user_id, type, title, body, data)
    values (new.worker_id, 'withdrawal_decision', v_worker_title, v_worker_body,
      jsonb_build_object('withdrawal_id', new.id, 'amount', new.amount, 'status', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notif_withdrawal on public.withdrawals;
create trigger trg_notif_withdrawal before insert or update on public.withdrawals
  for each row execute function public.notify_withdrawal();

-- ---------- Deduction notification ----------
create or replace function public.notify_deduction()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_name text;
  v_currency text;
begin
  select full_name into v_name from public.profiles where id = new.worker_id;
  select coalesce(value->>'currency', 'ج.م') into v_currency
  from public.settings where key = 'app';
  perform public.notify_admins(
    'deduction_new', 'خصم جديد',
    coalesce(v_name, 'عامل') || ' — خصم ' || new.amount || ' '
      || coalesce(v_currency, 'ج.م') || ': ' || new.reason,
    jsonb_build_object('worker_id', new.worker_id, 'amount', new.amount, 'reason', new.reason)
  );
  return new;
end;
$$;

drop trigger if exists trg_notif_deduction on public.deductions;
create trigger trg_notif_deduction after insert on public.deductions
  for each row execute function public.notify_deduction();

-- ---------- Update timestamps ----------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, auth, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_profiles on public.profiles;
create trigger trg_touch_profiles before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------- Freeze each attendance wage as a financial snapshot ----------
create or replace function public.snapshot_attendance_wage()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_daily_wage numeric(10,2);
  v_refresh_snapshot boolean;
begin
  if tg_op = 'INSERT' then
    v_refresh_snapshot := true;
  else
    -- Project selections never alter an already-recorded daily wage.
    v_refresh_snapshot := new.daily_wage_snapshot is null;
  end if;

  if v_refresh_snapshot then
    select coalesce(p.daily_wage, 0)
      into v_daily_wage
    from public.profiles p
    where p.id = new.worker_id;
    new.daily_wage_snapshot := coalesce(v_daily_wage, 0);
  end if;

  if new.project_id is not null then
    perform 1 from public.projects
    where id = new.project_id and status = 'active'
    for share;
    if not found then
      raise exception 'المشروع مقفول؛ لا يمكن تعديل سجلاته المالية';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_snapshot_attendance_wage on public.attendance;
create trigger trg_snapshot_attendance_wage
  before insert or update on public.attendance
  for each row execute function public.snapshot_attendance_wage();

-- ---------- Lock active projects while financial/assignment rows change ----------
create or replace function public.guard_active_project_activity()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_old_project_id uuid;
  v_new_project_id uuid;
  v_old_worker_id uuid;
  v_new_worker_id uuid;
  v_worker_id uuid;
  v_project_id uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_project_id := (to_jsonb(old)->>'project_id')::uuid;
    v_old_worker_id := (to_jsonb(old)->>'worker_id')::uuid;
  end if;
  if tg_op <> 'DELETE' then
    v_new_project_id := (to_jsonb(new)->>'project_id')::uuid;
    v_new_worker_id := (to_jsonb(new)->>'worker_id')::uuid;
  end if;

  -- Keep balance-changing writes serialized with worker withdrawals.
  for v_worker_id in
    select distinct ids.worker_id
    from unnest(array[v_old_worker_id, v_new_worker_id]) as ids(worker_id)
    where ids.worker_id is not null
    order by ids.worker_id
  loop
    perform 1 from public.profiles where id = v_worker_id for update;
  end loop;

  for v_project_id in
    select distinct ids.project_id
    from unnest(array[v_old_project_id, v_new_project_id]) as ids(project_id)
    where ids.project_id is not null
    order by ids.project_id
  loop
    perform 1 from public.projects
    where id = v_project_id and status = 'active'
    for share;
    if not found then
      raise exception 'المشروع مقفول؛ لا يمكن تعديل سجلاته أو تعييناته';
    end if;
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_activity_attendance on public.attendance;
create trigger trg_guard_activity_attendance
  before insert or update or delete on public.attendance
  for each row execute function public.guard_active_project_activity();
drop trigger if exists trg_guard_activity_withdrawals on public.withdrawals;
create trigger trg_guard_activity_withdrawals
  before insert or update or delete on public.withdrawals
  for each row execute function public.guard_active_project_activity();
drop trigger if exists trg_guard_activity_deductions on public.deductions;
create trigger trg_guard_activity_deductions
  before insert or update or delete on public.deductions
  for each row execute function public.guard_active_project_activity();
drop trigger if exists trg_guard_activity_sites on public.sites;
create trigger trg_guard_activity_sites
  before insert or update or delete on public.sites
  for each row execute function public.guard_active_project_activity();
-- Legacy guard helper retained for compatibility; assignment writes are rejected below and old guards are detached.
create or replace function public.guard_worker_project_live()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_worker_id uuid;
  v_status text;
begin
  if tg_op = 'INSERT' then
    perform 1 from public.profiles where id = new.worker_id for update;
  elsif tg_op = 'DELETE' then
    perform 1 from public.profiles where id = old.worker_id for update;
  else
    for v_worker_id in
      select distinct ids.worker_id
      from unnest(array[old.worker_id, new.worker_id]) as ids(worker_id)
      where ids.worker_id is not null
      order by ids.worker_id
    loop
      perform 1 from public.profiles where id = v_worker_id for update;
    end loop;
  end if;

  if tg_op <> 'INSERT' then
    select p.status into v_status from public.projects p
    where p.id = old.project_id for share;
    if not found or v_status <> 'active' then
      raise exception 'المشروع مؤرشف؛ لا يمكن تغيير تعييناته';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    select p.status into v_status from public.projects p
    where p.id = new.project_id for share;
    if not found or v_status <> 'active' then
      raise exception 'يمكن تعيين العامل إلى مشروع نشط فقط';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_activity_worker_projects on public.worker_projects;
drop trigger if exists trg_guard_worker_project_live on public.worker_projects;
-- Legacy assignment deletions are allowed for cleanup; writes are rejected below.

-- Keep legacy assignment rows for history, but never create or edit them again.
create or replace function public.reject_legacy_worker_project_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'تعيين المشاريع للعاملين متوقف؛ العامل يختار المشاريع المفتوحة عند تسجيل الحضور';
end;
$$;
drop trigger if exists trg_reject_legacy_worker_project_assignment on public.worker_projects;
create trigger trg_reject_legacy_worker_project_assignment
  before insert or update on public.worker_projects
  for each row execute function public.reject_legacy_worker_project_assignment();
revoke all on function public.reject_legacy_worker_project_assignment() from public, anon, authenticated;

create or replace function public.reject_legacy_site_worker_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'تعيين العمال للمواقع القديمة متوقف؛ العامل يختار الموقع المفتوح عند تسجيل الحضور';
end;
$$;
drop trigger if exists trg_reject_legacy_site_worker_assignment on public.site_workers;
create trigger trg_reject_legacy_site_worker_assignment
  before insert or update on public.site_workers
  for each row execute function public.reject_legacy_site_worker_assignment();
revoke all on function public.reject_legacy_site_worker_assignment() from public, anon, authenticated;

-- A project link may be added/removed only while that project is active. The
-- attendance row and its wage snapshot remain single/global across all links.
create or replace function public.guard_attendance_project_link()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_attendance_id uuid;
  v_project_id uuid;
  v_worker_id uuid;
  v_project_status text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'رابط الحضور غير قابل للنقل؛ احذف الرابط النشط ثم أضف الرابط الصحيح';
  end if;
  if tg_op = 'DELETE' then
    v_attendance_id := old.attendance_id;
    v_project_id := old.project_id;
  else
    v_attendance_id := new.attendance_id;
    v_project_id := new.project_id;
  end if;

  select a.worker_id into v_worker_id
  from public.attendance a where a.id = v_attendance_id;
  if not found then raise exception 'سجل الحضور غير موجود'; end if;

  perform 1 from public.profiles where id = v_worker_id for update;
  select p.status into v_project_status
  from public.projects p where p.id = v_project_id for share;
  if not found or v_project_status <> 'active' then
    raise exception 'المشروع مؤرشف؛ لا يمكن تعديل رابط الحضور';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_attendance_project_link on public.attendance_projects;
create trigger trg_guard_attendance_project_link
  before insert or update or delete on public.attendance_projects
  for each row execute function public.guard_attendance_project_link();

-- Keep legacy attendance-site links within one live project and freeze them after closure.
create or replace function public.guard_attendance_site()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_attendance_id uuid;
  v_att_project_id uuid;
  v_site_project_id uuid;
  v_site_active boolean;
  v_project_id uuid;
begin
  if tg_op = 'DELETE' then
    v_attendance_id := old.attendance_id;
  else
    v_attendance_id := new.attendance_id;
  end if;

  select a.project_id into v_att_project_id
  from public.attendance a where a.id = v_attendance_id;
  if not found then raise exception 'سجل الحضور غير موجود'; end if;

  if tg_op <> 'DELETE' then
    select s.project_id, s.is_active into v_site_project_id, v_site_active
    from public.sites s where s.id = new.site_id;
    if not found or not v_site_active then
      raise exception 'الموقع غير موجود أو غير مفعّل';
    end if;
    if v_site_project_id is not null
       and v_site_project_id is distinct from v_att_project_id then
      raise exception 'الموقع لا يتبع مشروع الحضور';
    end if;
  else
    select s.project_id into v_site_project_id
    from public.sites s where s.id = old.site_id;
  end if;

  for v_project_id in
    select distinct ids.project_id
    from unnest(array[v_att_project_id, v_site_project_id]) as ids(project_id)
    where ids.project_id is not null
    order by ids.project_id
  loop
    perform 1 from public.projects
    where id = v_project_id and status = 'active'
    for share;
    if not found then
      raise exception 'المشروع مقفول؛ لا يمكن تعديل مواقع الحضور';
    end if;
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_attendance_site on public.attendance_sites;
create trigger trg_guard_attendance_site
  before insert or update or delete on public.attendance_sites
  for each row execute function public.guard_attendance_site();

create or replace function public.guard_site_worker_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_site_id uuid;
  v_worker_id uuid;
  v_project_id uuid;
begin
  if tg_op = 'DELETE' then
    v_site_id := old.site_id;
    v_worker_id := old.worker_id;
  else
    v_site_id := new.site_id;
    v_worker_id := new.worker_id;
  end if;
  perform 1 from public.profiles where id = v_worker_id for update;
  if not found then raise exception 'العامل غير موجود'; end if;
  select s.project_id into v_project_id
  from public.sites s where s.id = v_site_id;
  if not found then raise exception 'الموقع غير موجود'; end if;
  if v_project_id is not null then
    perform 1 from public.projects
    where id = v_project_id and status = 'active'
    for share;
    if not found then
      raise exception 'المشروع مقفول؛ لا يمكن تعديل تعيينات الموقع';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_site_worker_assignment on public.site_workers;
-- Legacy site-assignment deletions are allowed for cleanup; writes are rejected above.

-- Project closure + final, project-scoped settlement
create or replace function public.close_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  r record;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'مش مسموح — قفل المشاريع للإدارة النشطة فقط';
  end if;

  select status into v_status
  from public.projects
  where id = p_project_id
  for update;
  if not found or v_status <> 'active' then
    raise exception 'المشروع مقفول بالفعل أو غير موجود';
  end if;
  if exists (
    select 1 from public.withdrawals w
    where w.project_id = p_project_id and w.status = 'pending'
  ) then
    raise exception 'لا يمكن قفل المشروع قبل حسم طلبات الصرف المعلّقة';
  end if;

  for r in
    select b.worker_id, b.days_worked, b.daily_wage, b.earned,
           b.withdrawn_approved, b.deducted, b.balance
    from public.worker_project_balances b
    where b.project_id = p_project_id
  loop
    insert into public.settlements as existing_settlement (
      worker_id, project_id, days_worked, daily_wage,
      total_earned, total_withdrawn, total_deductions, net_amount
    ) values (
      r.worker_id, p_project_id, r.days_worked, r.daily_wage,
      r.earned, r.withdrawn_approved, r.deducted, r.balance
    )
    on conflict (worker_id, project_id) do update set
      days_worked = excluded.days_worked,
      daily_wage = excluded.daily_wage,
      total_earned = excluded.total_earned,
      total_withdrawn = excluded.total_withdrawn,
      total_deductions = excluded.total_deductions,
      net_amount = excluded.net_amount
    where existing_settlement.status = 'draft';
  end loop;

  update public.projects
  set status = 'closed', closed_at = now(), archived_at = now(), archived_by = auth.uid()
  where id = p_project_id;
end;
$$;

-- ---------- Project eligibility helpers (internal RPC helpers only) ----------
create or replace function public.has_active_project(p_worker_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, extensions
as $$
  select exists (
    select 1 from public.profiles worker
    where worker.id = p_worker_id and worker.role = 'worker'
      and worker.status = 'active' and worker.is_active = true
  ) and exists (
    select 1 from public.projects project
    where project.status = 'active'
  );
$$;

create or replace function public.require_active_project(p_worker_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_worker_id and p.role = 'worker'
      and p.status = 'active' and p.is_active = true
  ) then
    raise exception 'الحساب غير مفعّل';
  end if;
end;
$$;

-- ==================== END triggers.sql ===================


-- ==================== BEGIN functions.sql ===================

-- ============================================================
--  WORKER APP — SECURITY-HARDENED RPC FUNCTIONS
--  شغّل بعد triggers.sql
-- ============================================================

-- Remove unsafe/obsolete overloads before creating hardened signatures.
drop function if exists public.register_attendance(uuid, date, uuid[], numeric, numeric, text);
drop function if exists public.register_withdrawal(uuid, numeric, text);
drop function if exists public.signup_worker(text, text, text, text, text);

-- ---------- تسجيل حضور العامل (هوية + يوم القاهرة + مشروع/مواقع مخصصة) ----------
create or replace function public.register_attendance(
  p_worker_id  uuid,
  p_work_date  date,
  p_site_ids   uuid[] default null,
  p_lat        numeric default null, -- Legacy RPC parameter; ignored.
  p_lng        numeric default null, -- Legacy RPC parameter; ignored.
  p_note       text default null,
  p_project_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_id                 uuid;
  v_project_id         uuid := p_project_id;
  v_site_project_id    uuid;
  v_today              date := (now() at time zone 'Africa/Cairo')::date;
begin
  if auth.uid() is null or auth.uid() <> p_worker_id then
    raise exception 'غير مسموح بتسجيل حضور مستخدم آخر';
  end if;
  perform 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'worker'
    and p.status = 'active' and p.is_active = true
  for update;
  if not found then
    raise exception 'الحساب غير مفعّل';
  end if;
  if p_work_date is distinct from v_today then
    raise exception 'تسجيل الحضور متاح لتاريخ اليوم فقط';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'الملاحظة طويلة أكثر من اللازم';
  end if;

  -- العامل يظل مقفولًا حتى تنتهي العملية؛ هذا ينسّقها مع الصرف وتغيير الحالة.
  if p_site_ids is not null and cardinality(p_site_ids) > 0 then
    if array_position(p_site_ids, null) is not null then
      raise exception 'قائمة المواقع غير صحيحة';
    end if;
    if exists (
      select 1
      from (select distinct unnest(p_site_ids) as site_id) chosen
      left join public.sites s on s.id = chosen.site_id
      where s.id is null or not s.is_active
        or (s.project_id is not null and not exists (
          select 1 from public.projects pr
          where pr.id = s.project_id and pr.status = 'active'
        ))
    ) then
      raise exception 'فيه موقع غير مفعّل أو تابع لمشروع مغلق';
    end if;

    if (select count(distinct s.project_id)
        from public.sites s where s.id = any(p_site_ids)) > 1 then
      raise exception 'سجّل مواقع من مشروع واحد في اليوم';
    end if;

    select s.project_id into v_site_project_id
    from public.sites s
    where s.id = any(p_site_ids)
    order by s.project_id nulls last
    limit 1;

    if v_project_id is not null
       and v_site_project_id is not null
       and v_project_id <> v_site_project_id then
      raise exception 'المواقع المختارة لا تتبع المشروع المحدد';
    end if;
    v_project_id := coalesce(v_project_id, v_site_project_id);
  end if;

  if v_project_id is null then
    raise exception 'اختار مشروعًا نشطًا واحدًا على الأقل';
  end if;

  if v_project_id is not null then
    perform 1 from public.projects
    where id = v_project_id and status = 'active'
    for share;
    if not found then
      raise exception 'المشروع غير نشط أو غير موجود';
    end if;
  end if;

  insert into public.attendance
    (worker_id, project_id, work_date, source, lat, lng, note, created_by)
  values
    (auth.uid(), v_project_id, v_today, 'worker', null, null, p_note, auth.uid())
  on conflict (worker_id, work_date) do update set
    project_id = coalesce(public.attendance.project_id, excluded.project_id),
    lat = coalesce(excluded.lat, public.attendance.lat),
    lng = coalesce(excluded.lng, public.attendance.lng),
    note = coalesce(excluded.note, public.attendance.note)
  where public.attendance.project_id is null
     or excluded.project_id is null
     or public.attendance.project_id = excluded.project_id
  returning id into v_id;

  if v_id is null then
    raise exception 'تم تسجيل حضورك في مشروع مختلف اليوم؛ تواصل مع الإدارة للتعديل';
  end if;

  delete from public.attendance_sites where attendance_id = v_id;
  if p_site_ids is not null and cardinality(p_site_ids) > 0 then
    insert into public.attendance_sites (attendance_id, site_id)
    select v_id, chosen.site_id
    from (select distinct unnest(p_site_ids) as site_id) chosen;
  end if;

  return v_id;
end;
$$;

-- ---------- صرف/طلب فلوس: حساب العامل، الرصيد، التزامن و idempotency ----------
create or replace function public.register_withdrawal(
  p_worker_id uuid,
  p_amount numeric,
  p_note text default null,
  p_project_id uuid default null,
  p_request_id uuid default null
) returns public.withdrawals
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_result public.withdrawals;
  v_amount numeric;
  v_available numeric;
begin
  if auth.uid() is null or auth.uid() <> p_worker_id then
    raise exception 'غير مسموح بطلب فلوس لحساب آخر';
  end if;
  if p_project_id is not null then
    raise exception 'السحب يُسجّل على الرصيد العام فقط؛ حدّث التطبيق وحاول مجددًا';
  end if;
  if p_amount is null or p_amount <= 0
     or p_amount::text in ('NaN', 'Infinity', '-Infinity')
     or p_amount >= 100000000 then
    raise exception 'المبلغ لازم يكون رقمًا موجبًا وصحيحًا';
  end if;
  if p_request_id is null then raise exception 'رقم العملية مطلوب لإتمام الطلب بأمان'; end if;
  if p_note is not null and length(p_note) > 500 then raise exception 'الملاحظة طويلة أكثر من اللازم'; end if;
  v_amount := round(p_amount, 2);
  if v_amount <= 0 or v_amount >= 100000000 then raise exception 'المبلغ بعد التقريب خارج الحدود المسموحة'; end if;

  perform 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'worker'
    and p.status = 'active' and p.is_active = true
  for update;
  if not found then raise exception 'الحساب غير مفعّل'; end if;

  select * into v_result
  from public.withdrawals w where w.client_request_id = p_request_id
  for update;
  if found then
    if v_result.worker_id <> auth.uid() or v_result.amount <> v_amount or v_result.project_id is not null then
      raise exception 'رقم العملية مستخدم لطلب مختلف';
    end if;
    return v_result;
  end if;

  select coalesce(b.available, 0) into v_available
  from public.worker_balances b where b.worker_id = auth.uid();
  v_available := greatest(coalesce(v_available, 0), 0);
  if v_amount > v_available then
    raise exception 'المتاح من رصيدك العام % جنيه فقط', v_available;
  end if;

  insert into public.withdrawals
    (worker_id, project_id, amount, note, created_by, client_request_id, status, decided_by, decided_at)
  values
    (auth.uid(), null, v_amount, p_note, auth.uid(), p_request_id,
     'pending', null, null)
  returning * into v_result;
  return v_result;
end;
$$;

-- ---------- إضافة موقع لليوم: نفس العامل، نفس الحضور، نفس المشروع ----------
create or replace function public.add_attendance_site(p_attendance_id uuid, p_site_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_att public.attendance;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً';
  end if;
  perform 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'worker'
    and p.status = 'active' and p.is_active = true
  for update;
  if not found then
    raise exception 'الحساب غير مفعّل';
  end if;

  select * into v_att
  from public.attendance a
  where a.id = p_attendance_id
    and a.worker_id = auth.uid()
    and a.work_date = v_today
  for update;
  if not found then
    raise exception 'الحضور غير موجود أو ليس حضور اليوم';
  end if;
  perform public.require_active_project(auth.uid());
  if v_att.project_id is not null then
    perform 1 from public.projects
    where id = v_att.project_id and status = 'active'
    for share;
    if not found then
      raise exception 'المشروع مقفول؛ لا يمكن تعديل مواقع الحضور';
    end if;
  end if;
  if not exists (
    select 1 from public.sites s
    where s.id = p_site_id and s.is_active
      and (s.project_id is null or s.project_id = v_att.project_id)
      and (s.project_id is null or exists (
        select 1 from public.projects p
        where p.id = s.project_id and p.status = 'active'
      ))
  ) then
    raise exception 'الموقع غير مفعّل أو لا يتبع مشروعًا مفتوحًا';
  end if;

  insert into public.attendance_sites (attendance_id, site_id)
  values (v_att.id, p_site_id)
  on conflict (attendance_id, site_id) do nothing;
end;
$$;

-- Harmless endpoint used by the pre-login connectivity diagnostic.
create or replace function public.health_check()
returns text
language sql
immutable
parallel safe
as $$
  select 'ok'::text;
$$;

-- Compatibility endpoint for older apps; active workers are always told attendance GPS is disabled.
create or replace function public.worker_app_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, extensions
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'worker'
      and p.status = 'active' and p.is_active = true
  ) then
    raise exception 'غير مسموح';
  end if;
  return jsonb_build_object('gps_enabled', false);
end;
$$;

-- ---------- ربط صورة البطاقة بحساب المستخدم نفسه ----------
create or replace function public.set_my_id_card(p_path text)
returns void
language plpgsql
security definer
set search_path = public, auth, storage, extensions
as $$
begin
  if auth.uid() is null
     or p_path is distinct from auth.uid()::text || '/card.jpg' then
    raise exception 'مسار صورة البطاقة غير مسموح';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'id-cards' and o.name = p_path
  ) then
    raise exception 'ارفع صورة البطاقة أولاً';
  end if;
  update public.profiles
  set id_card_url = p_path
  where id = auth.uid() and role = 'worker' and status = 'pending';
  if not found then
    raise exception 'لا يمكن تحديث صورة هذا الحساب';
  end if;
end;
$$;

-- ---------- إنشاء حساب عامل للإدارة فقط ----------
create or replace function public.create_worker(
  p_full_name  text,
  p_phone      text,
  p_password   text,
  p_daily_wage numeric default 0,
  p_site_ids   uuid[] default null,
  p_project_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid;
  v_email text;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if not public.is_admin() then
    raise exception 'مش مسموح — إضافة العمال للإدارة فقط';
  end if;
  if p_full_name is null or length(trim(p_full_name)) < 3 or length(trim(p_full_name)) > 120 then
    raise exception 'الاسم يجب أن يكون بين 3 و120 حرفًا';
  end if;
  if length(v_phone) < 10 or length(v_phone) > 15 then
    raise exception 'رقم الموبايل غير صحيح';
  end if;
  if p_password is null or length(p_password) < 8 or length(p_password) > 128 then
    raise exception 'كلمة السر يجب أن تكون بين 8 و128 حرفًا';
  end if;
  if coalesce(p_daily_wage, 0) < 0
     or coalesce(p_daily_wage, 0)::text in ('NaN', 'Infinity', '-Infinity')
     or coalesce(p_daily_wage, 0) >= 100000000 then
    raise exception 'اليومية غير صحيحة أو خارج الحدود المسموحة';
  end if;

  v_email := v_phone || '@ommal.app';
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
    'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'full_name', trim(p_full_name), 'phone', v_phone,
      'username', v_phone, 'role', 'worker'
    )
  ) returning id into v_user_id;

  insert into public.profiles
    (id, full_name, phone, username, role, daily_wage, status, is_active)
  values
    (v_user_id, trim(p_full_name), v_phone, v_phone, 'worker', coalesce(p_daily_wage, 0), 'active', true)
  on conflict (id) do update set
    full_name = excluded.full_name,
    phone = excluded.phone,
    username = excluded.username,
    role = 'worker',
    daily_wage = excluded.daily_wage,
    status = 'active',
    is_active = true;

  return v_user_id;
end;
$$;

-- ---------- تغيير كلمة سر عامل للإدارة فقط ----------
create or replace function public.reset_worker_password(p_worker_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.is_developer() then
    raise exception 'مش مسموح — تغيير كلمات السر للمطوّر النشط فقط';
  end if;
  if p_password is null or length(p_password) < 8 or length(p_password) > 128 then
    raise exception 'كلمة السر يجب أن تكون بين 8 و128 حرفًا';
  end if;
  perform 1 from public.profiles p
  where p.id = p_worker_id and p.role = 'worker'
  for update;
  if not found then
    raise exception 'لا يمكن تغيير كلمة السر إلا لحساب عامل';
  end if;
  update auth.users
  set encrypted_password = crypt(p_password, gen_salt('bf')),
      updated_at = now()
  where id = p_worker_id;
  if not found then
    raise exception 'الحساب غير موجود';
  end if;
end;
$$;

-- ---------- اعتماد طلب عامل ----------
create or replace function public.approve_worker(
  p_worker_id  uuid,
  p_daily_wage numeric default 0,
  p_site_ids   uuid[] default null,
  p_project_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'مش مسموح — تفعيل الحسابات للإدارة فقط';
  end if;
  if coalesce(p_daily_wage, 0) < 0
     or coalesce(p_daily_wage, 0)::text in ('NaN', 'Infinity', '-Infinity')
     or coalesce(p_daily_wage, 0) >= 100000000 then
    raise exception 'اليومية غير صحيحة أو خارج الحدود المسموحة';
  end if;
  perform 1
  from public.profiles p
  where p.id = p_worker_id and p.role = 'worker' and p.status = 'pending'
    and p.phone is not null and p.username is not null
    and p.id_card_url is not null
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'id-cards' and o.name = p.id_card_url
    )
  for update;
  if not found then
    raise exception 'طلب التسجيل غير موجود أو لم يكتمل برقم الهاتف واسم المستخدم وصورة البطاقة';
  end if;

  update public.profiles
  set status = 'active',
      approved_by = auth.uid(),
      approved_at = now(),
      reject_reason = null,
      daily_wage = coalesce(p_daily_wage, daily_wage),
      is_active = true
  where id = p_worker_id and role = 'worker' and status = 'pending';
  if not found then
    raise exception 'طلب التسجيل تم التعامل معه بالفعل';
  end if;

end;
$$;

-- ---------- رفض طلب عامل ----------
create or replace function public.reject_worker(p_worker_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'مش مسموح — رفض الحسابات للإدارة فقط';
  end if;
  perform 1 from public.profiles p
  where p.id = p_worker_id and p.role = 'worker' and p.status = 'pending'
  for update;
  if not found then
    raise exception 'طلب التسجيل غير موجود أو تم التعامل معه';
  end if;
  update public.profiles
  set status = 'rejected',
      is_active = false,
      reject_reason = left(nullif(trim(p_reason), ''), 500),
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_worker_id and role = 'worker' and status = 'pending';
  if not found then
    raise exception 'طلب التسجيل تم التعامل معه بالفعل';
  end if;
end;
$$;

-- ---------- إضافة خصم مربوط بالمشروع الصحيح ----------
create or replace function public.add_worker_deduction(
  p_worker_id uuid,
  p_project_id uuid,
  p_amount numeric,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_id uuid;
  v_amount numeric;
begin
  if not public.is_admin() then raise exception 'مش مسموح — إضافة الخصومات للإدارة النشطة فقط'; end if;
  if p_project_id is not null then raise exception 'الخصم يُسجّل على حساب العامل العام فقط'; end if;
  if p_amount is null or p_amount <= 0
     or p_amount::text in ('NaN', 'Infinity', '-Infinity') or p_amount >= 100000000 then
    raise exception 'مبلغ الخصم غير صحيح';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount <= 0 or v_amount >= 100000000 then raise exception 'مبلغ الخصم بعد التقريب غير صحيح'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 or length(p_reason) > 500 then
    raise exception 'اكتب سببًا صحيحًا (حتى 500 حرف)';
  end if;
  perform 1 from public.profiles p where p.id = p_worker_id and p.role = 'worker' for update;
  if not found then raise exception 'العامل غير موجود'; end if;

  insert into public.deductions (worker_id, project_id, amount, reason, created_by)
  values (p_worker_id, null, v_amount, trim(p_reason), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- تعديل بيانات العامل وأجر المشاريع النشطة بشكل ذري ----------
create or replace function public.update_worker_details(
  p_worker_id uuid,
  p_full_name text,
  p_phone text,
  p_daily_wage numeric,
  p_is_active boolean,
  p_site_ids uuid[] default null
) returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_old_phone text;
  v_old_username text;
  v_old_auth_email text;
  v_phone_is_login boolean := false;
begin
  if not public.is_admin() then
    raise exception 'مش مسموح — تعديل العمال للإدارة النشطة فقط';
  end if;
  if p_full_name is null or length(trim(p_full_name)) < 3 or length(trim(p_full_name)) > 120 then
    raise exception 'الاسم يجب أن يكون بين 3 و120 حرفًا';
  end if;
  if length(v_phone) < 10 or length(v_phone) > 15 then
    raise exception 'رقم الموبايل غير صحيح';
  end if;
  if p_daily_wage is null or p_daily_wage < 0
     or p_daily_wage::text in ('NaN', 'Infinity', '-Infinity')
     or p_daily_wage >= 100000000 then
    raise exception 'اليومية غير صحيحة';
  end if;
  select p.phone, p.username, u.email
    into v_old_phone, v_old_username, v_old_auth_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_worker_id and p.role = 'worker'
  for update of p;
  if not found then
    raise exception 'العامل غير موجود';
  end if;
  v_old_phone := regexp_replace(coalesce(v_old_phone, ''), '[^0-9]', '', 'g');
  if v_old_username is not null
     and v_old_username = v_old_phone
     and v_old_phone <> v_phone
     and v_old_auth_email = v_old_username || '@ommal.app' then
    v_phone_is_login := true;
    update auth.users
    set email = v_phone || '@ommal.app',
        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
          || jsonb_build_object('phone', v_phone, 'username', v_phone),
        updated_at = now()
    where id = p_worker_id;
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      phone = v_phone,
      username = case when v_phone_is_login then v_phone else username end,
      daily_wage = p_daily_wage,
      is_active = coalesce(p_is_active, is_active)
  where id = p_worker_id and role = 'worker';
  if not found then
    raise exception 'العامل لم يعد متاحًا للتعديل';
  end if;

end;
$$;

-- ---------- أدوات المطوّر ----------
create or replace function public.admin_update_user(
  p_user_id     uuid,
  p_full_name   text default null,
  p_username    text default null,
  p_role        text default null,
  p_status      text default null,
  p_daily_wage  numeric default null,
  p_is_active   boolean default null
) returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_old_username text;
  v_new_username text;
begin
  if not public.is_developer() then
    raise exception 'مش مسموح — ده للمطوّر النشط فقط';
  end if;
  if p_role is not null and p_role not in ('owner','manager','developer','worker') then
    raise exception 'الدور غير صحيح';
  end if;
  if p_status is not null and p_status not in ('pending','active','rejected','suspended') then
    raise exception 'الحالة غير صحيحة';
  end if;
  if p_full_name is not null and trim(p_full_name) <> ''
     and (length(trim(p_full_name)) < 3 or length(trim(p_full_name)) > 120) then
    raise exception 'الاسم يجب أن يكون بين 3 و120 حرفًا';
  end if;
  if p_username is not null and trim(p_username) <> ''
     and lower(trim(p_username)) !~ '^[a-z0-9._-]{3,32}$' then
    raise exception 'اسم المستخدم غير صحيح';
  end if;
  if p_daily_wage is not null and (p_daily_wage < 0
     or p_daily_wage::text in ('NaN', 'Infinity', '-Infinity')
     or p_daily_wage >= 100000000) then
    raise exception 'اليومية غير صحيحة أو خارج الحدود المسموحة';
  end if;
  select p.username into v_old_username
  from public.profiles p
  where p.id = p_user_id
  for update;
  if not found then
    raise exception 'الحساب غير موجود';
  end if;
  v_new_username := coalesce(nullif(lower(trim(p_username)), ''), v_old_username);
  if v_new_username is distinct from v_old_username then
    update auth.users
    set email = v_new_username || '@ommal.app',
        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
          || jsonb_build_object('username', v_new_username),
        updated_at = now()
    where id = p_user_id;
    if not found then
      raise exception 'حساب المصادقة غير موجود';
    end if;
  end if;

  update public.profiles set
    full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
    username = v_new_username,
    role = coalesce(p_role, role),
    status = coalesce(p_status, status),
    daily_wage = coalesce(p_daily_wage, daily_wage),
    is_active = coalesce(p_is_active, is_active),
    updated_at = now()
  where id = p_user_id;
  if not found then
    raise exception 'الحساب غير موجود';
  end if;
end;
$$;

create or replace function public.system_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'مش مسموح';
  end if;
  return (
    select jsonb_build_object(
      'workers',       (select count(*) from public.profiles where role = 'worker'),
      'admins',        (select count(*) from public.profiles where role in ('owner','manager','developer')),
      'pending',       (select count(*) from public.profiles where status = 'pending'),
      'attendance',    (select count(*) from public.attendance),
      'withdrawals',   (select count(*) from public.withdrawals),
      'deductions',    (select count(*) from public.deductions),
      'audit',         (select count(*) from public.audit_log),
      'notifications', (select count(*) from public.notifications),
      'settlements',   (select count(*) from public.settlements)
    )
  );
end;
$$;

create or replace view public.admin_users
with (security_invoker = true) as
select
  p.id, p.full_name, p.phone, p.username, p.role, p.status, p.is_active,
  p.daily_wage, p.created_at,
  (select count(*) from public.attendance a where a.worker_id = p.id) as days_worked,
  (select coalesce(sum(w.amount), 0) from public.withdrawals w where w.worker_id = p.id) as withdrawn,
  (select count(*) from public.audit_log l where l.changed_by = p.id) as edits_made
from public.profiles p
order by p.created_at desc;

-- ---------- تصدير بيانات مشروع (الإدارة فقط، لا يسمح بمشروع غير موجود) ----------
create or replace function public.export_project_data(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'مش مسموح — للمالك/المدير/المطوّر النشط فقط';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'المشروع غير موجود';
  end if;

  select jsonb_build_object(
    'project', (
      select jsonb_build_object(
        'id', p.id, 'name', p.name, 'description', p.description,
        'status', p.status, 'start_date', p.start_date, 'end_date', p.end_date,
        'closed_at', p.closed_at, 'archived_at', p.archived_at,
        'archived_by', p.archived_by,
        'archived_by_name', (select pr.full_name from public.profiles pr where pr.id = p.archived_by)
      ) from public.projects p where p.id = p_project_id
    ),
    'workers', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select pr.id, pr.full_name, pr.phone, pr.username,
               pr.daily_wage, wp.daily_wage as project_daily_wage
        from public.profiles pr
        where exists (
          select 1 from public.attendance_projects ap
          join public.attendance a on a.id = ap.attendance_id
          where ap.project_id = p_project_id and a.worker_id = pr.id
        )
        order by pr.full_name
      ) t
    ),
    'attendance', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select a.work_date, pr.full_name, aw.wage as daily_wage, a.source, a.created_at
        from public.attendance a
        join public.profiles pr on pr.id = a.worker_id
        left join public.attendance_with_wage aw on aw.id = a.id
        join public.attendance_projects ap on ap.attendance_id = a.id
        where ap.project_id = p_project_id
        order by a.work_date, pr.full_name
      ) t
    ),
    'withdrawals', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select wd.created_at, pr.full_name, wd.amount, wd.note, wd.status
        from public.withdrawals wd
        join public.profiles pr on pr.id = wd.worker_id
        where wd.project_id = p_project_id
        order by wd.created_at
      ) t
    ),
    'deductions', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select d.created_at, pr.full_name, d.amount, d.reason
        from public.deductions d
        join public.profiles pr on pr.id = d.worker_id
        where d.project_id = p_project_id
        order by d.created_at
      ) t
    ),
    'settlements', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select pr.full_name, s.days_worked, s.daily_wage, s.total_earned,
               s.total_withdrawn, s.total_deductions, s.net_amount, s.status, s.paid_at
        from public.settlements s
        join public.profiles pr on pr.id = s.worker_id
        where s.project_id = p_project_id
        order by pr.full_name
      ) t
    )
  ) into v;
  return v;
end;
$$;

create or replace view public.project_archive
with (security_invoker = true) as
select
  p.id as project_id,
  p.name as project_name,
  p.start_date,
  p.closed_at,
  p.archived_at,
  (select pr.full_name from public.profiles pr where pr.id = p.archived_by) as archived_by_name,
  (select count(distinct a.worker_id)
   from public.attendance_projects ap
   join public.attendance a on a.id = ap.attendance_id
   where ap.project_id = p.id) as workers_count,
  (select count(distinct ap.attendance_id)
   from public.attendance_projects ap where ap.project_id = p.id) as attendance_count,
  (select coalesce(sum(wd.amount), 0) from public.withdrawals wd where wd.project_id = p.id) as total_withdrawn,
  (select coalesce(sum(d.amount), 0) from public.deductions d where d.project_id = p.id and d.voided_at is null) as total_deductions,
  (select coalesce(sum(s.net_amount), 0) from public.settlements s where s.project_id = p.id) as total_paid
from public.projects p
where p.status = 'closed'
order by p.closed_at desc;

-- ---------- Least-privilege RPC grants ----------
revoke all on function public.register_attendance(uuid, date, uuid[], numeric, numeric, text, uuid) from public, anon;
revoke all on function public.register_withdrawal(uuid, numeric, text, uuid, uuid) from public, anon;
revoke all on function public.add_attendance_site(uuid, uuid) from public, anon;
revoke all on function public.set_my_id_card(text) from public, anon;
revoke all on function public.create_worker(text, text, text, numeric, uuid[], uuid) from public, anon;
revoke all on function public.reset_worker_password(uuid, text) from public, anon;
revoke all on function public.approve_worker(uuid, numeric, uuid[], uuid) from public, anon;
revoke all on function public.reject_worker(uuid, text) from public, anon;
revoke all on function public.admin_update_user(uuid, text, text, text, text, numeric, boolean) from public, anon;
revoke all on function public.system_stats() from public, anon;
revoke all on function public.export_project_data(uuid) from public, anon;
revoke all on function public.worker_app_config() from public, anon;
revoke all on function public.health_check() from public;
revoke all on function public.update_worker_details(uuid, text, text, numeric, boolean, uuid[]) from public, anon;
revoke all on function public.add_worker_deduction(uuid, uuid, numeric, text) from public, anon;
revoke all on function public.close_project(uuid) from public, anon;
revoke all on function public.has_active_project(uuid) from public, anon, authenticated;
revoke all on function public.require_active_project(uuid) from public, anon, authenticated;

-- RPCs used by signed-in users; every SECURITY DEFINER body checks role/identity.
grant execute on function public.register_attendance(uuid, date, uuid[], numeric, numeric, text, uuid) to authenticated;
grant execute on function public.register_withdrawal(uuid, numeric, text, uuid, uuid) to authenticated;
grant execute on function public.add_attendance_site(uuid, uuid) to authenticated;
grant execute on function public.set_my_id_card(text) to authenticated;
grant execute on function public.create_worker(text, text, text, numeric, uuid[], uuid) to authenticated;
grant execute on function public.reset_worker_password(uuid, text) to authenticated;
grant execute on function public.approve_worker(uuid, numeric, uuid[], uuid) to authenticated;
grant execute on function public.reject_worker(uuid, text) to authenticated;
grant execute on function public.admin_update_user(uuid, text, text, text, text, numeric, boolean) to authenticated;
grant execute on function public.system_stats() to authenticated;
grant execute on function public.export_project_data(uuid) to authenticated;
grant execute on function public.worker_app_config() to authenticated;
grant execute on function public.health_check() to anon, authenticated;
grant execute on function public.update_worker_details(uuid, text, text, numeric, boolean, uuid[]) to authenticated;
grant execute on function public.add_worker_deduction(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.close_project(uuid) to authenticated;

-- Trigger-only SECURITY DEFINER functions are never callable over PostgREST.
revoke all on function public.log_audit() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.notify_registration_decision() from public, anon, authenticated;
revoke all on function public.notify_admins(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.notify_attendance() from public, anon, authenticated;
revoke all on function public.notify_withdrawal() from public, anon, authenticated;
revoke all on function public.notify_deduction() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.snapshot_attendance_wage() from public, anon, authenticated;
revoke all on function public.guard_active_project_activity() from public, anon, authenticated;
revoke all on function public.guard_worker_project_live() from public, anon, authenticated;
revoke all on function public.guard_attendance_project_link() from public, anon, authenticated;
revoke all on function public.guard_attendance_site() from public, anon, authenticated;
revoke all on function public.guard_site_worker_assignment() from public, anon, authenticated;

revoke all on table public.worker_balances from anon;
revoke all on table public.attendance_with_wage from anon;
revoke all on table public.daily_summary from anon;
revoke all on table public.admin_users from anon;
revoke all on table public.project_archive from anon;
grant select on public.worker_balances,
  public.attendance_with_wage, public.daily_summary,
  public.admin_users, public.project_archive to authenticated;

-- ============================================================
-- Unified project/location + single daily attendance account
-- The old `sites` tables are retained as legacy data only; the application
-- now uses `projects` and `attendance_projects` exclusively.
-- ============================================================

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
  coalesce(e.earned, 0) - coalesce(w.approved, 0) - coalesce(d.deducted, 0) - coalesce(st.paid, 0) as balance,
  coalesce(e.earned, 0) - coalesce(w.approved, 0)
    - coalesce(w.pending, 0) - coalesce(d.deducted, 0) - coalesce(st.paid, 0) as available,
  coalesce(st.paid, 0) as settled_paid
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
  from public.withdrawals group by worker_id
) w on w.worker_id = p.id
left join (
  select worker_id, sum(amount) as deducted
  from public.deductions where voided_at is null group by worker_id
) d on d.worker_id = p.id
left join (
  select worker_id, sum(net_amount) as paid
  from public.settlements
  where project_id is null and status = 'paid'
  group by worker_id
) st on st.worker_id = p.id
where p.role = 'worker';

-- Project archives are activity-only; financial totals belong to worker_balances.
drop view if exists public.project_archive;
create view public.project_archive
with (security_invoker = true) as
select
  p.id as project_id,
  p.name as project_name,
  p.start_date,
  p.closed_at,
  p.archived_at,
  (select pr.full_name from public.profiles pr where pr.id = p.archived_by) as archived_by_name,
  (select count(distinct a.worker_id)
   from public.attendance_projects ap
   join public.attendance a on a.id = ap.attendance_id
   where ap.project_id = p.id) as workers_count,
  (select count(distinct ap.attendance_id)
   from public.attendance_projects ap where ap.project_id = p.id) as attendance_count
from public.projects p
where p.status = 'closed'
order by p.closed_at desc;

alter view public.attendance_with_wage set (security_invoker = true);
alter view public.worker_balances set (security_invoker = true);
alter view public.project_archive set (security_invoker = true);

create or replace function public.register_attendance_multi(
  p_worker_id uuid,
  p_work_date date,
  p_project_ids uuid[] default '{}'::uuid[],
  p_lat numeric default null, -- Legacy RPC parameter; ignored.
  p_lng numeric default null, -- Legacy RPC parameter; ignored.
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_ids uuid[] := coalesce(p_project_ids, '{}'::uuid[]);
  v_attendance_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_worker_id then
    raise exception 'غير مسموح بتسجيل حضور مستخدم آخر';
  end if;
  if p_work_date is distinct from v_today then
    raise exception 'تسجيل الحضور متاح لتاريخ اليوم فقط';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'الملاحظة طويلة أكثر من اللازم';
  end if;
  if cardinality(v_ids) = 0 or array_position(v_ids, null) is not null
     or cardinality(v_ids) <> (select count(distinct x.project_id) from unnest(v_ids) x(project_id)) then
    raise exception 'اختار مشروعًا مفتوحًا واحدًا على الأقل، وتأكد من عدم تكرار الاختيارات';
  end if;

  perform 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'worker'
    and p.status = 'active' and p.is_active = true
  for update;
  if not found then raise exception 'الحساب غير مفعّل'; end if;

  if exists (
    select 1
    from unnest(v_ids) chosen(project_id)
    left join public.projects pr on pr.id = chosen.project_id
    where pr.id is null or pr.status <> 'active'
  ) then
    raise exception 'يمكن اختيار المشاريع المفتوحة فقط';
  end if;

  insert into public.attendance
    (worker_id, project_id, work_date, source, lat, lng, note, daily_wage_snapshot, created_by)
  values
    (auth.uid(), v_ids[1], v_today, 'worker', null, null, p_note,
     (select p.daily_wage from public.profiles p where p.id = auth.uid()), auth.uid())
  on conflict (worker_id, work_date) do nothing
  returning id into v_attendance_id;
  if v_attendance_id is null then
    select a.id into v_attendance_id
    from public.attendance a
    where a.worker_id = auth.uid() and a.work_date = v_today
    for update;
    if not found then raise exception 'تعذر استعادة سجل حضور اليوم؛ أعد المحاولة'; end if;
  end if;

  insert into public.attendance_projects (attendance_id, project_id)
  select v_attendance_id, chosen.project_id
  from unnest(v_ids) chosen(project_id)
  on conflict (attendance_id, project_id) do nothing;

  return v_attendance_id;
end;
$$;

create or replace function public.admin_register_attendance_multi(
  p_worker_id uuid,
  p_work_date date,
  p_project_ids uuid[]
) returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_ids uuid[] := coalesce(p_project_ids, '{}'::uuid[]);
  v_attendance_id uuid;
  v_profile public.profiles;
begin
  if not public.is_admin() then raise exception 'مش مسموح — تسجيل الحضور للإدارة النشطة فقط'; end if;
  if p_work_date is null or p_work_date > (now() at time zone 'Africa/Cairo')::date then
    raise exception 'تاريخ الحضور غير صحيح';
  end if;
  if cardinality(v_ids) = 0 or array_position(v_ids, null) is not null
     or cardinality(v_ids) <> (select count(distinct x.project_id) from unnest(v_ids) x(project_id)) then
    raise exception 'اختار مشروعًا/موقعًا نشطًا واحدًا على الأقل';
  end if;

  select * into v_profile
  from public.profiles p
  where p.id = p_worker_id and p.role = 'worker'
    and p.status = 'active' and p.is_active = true
  for update;
  if not found then raise exception 'العامل غير نشط'; end if;

  if exists (
    select 1
    from unnest(v_ids) chosen(project_id)
    left join public.projects pr on pr.id = chosen.project_id
    where pr.id is null or pr.status <> 'active'
  ) then
    raise exception 'اختر مشاريع مفتوحة فقط';
  end if;

  insert into public.attendance
    (worker_id, project_id, work_date, source, daily_wage_snapshot, created_by)
  values
    (p_worker_id, v_ids[1], p_work_date, 'admin', v_profile.daily_wage, auth.uid())
  on conflict (worker_id, work_date) do nothing
  returning id into v_attendance_id;
  if v_attendance_id is null then
    select a.id into v_attendance_id
    from public.attendance a
    where a.worker_id = p_worker_id and a.work_date = p_work_date
    for update;
    if not found then raise exception 'تعذر استعادة سجل الحضور؛ أعد المحاولة'; end if;
  end if;

  insert into public.attendance_projects (attendance_id, project_id)
  select v_attendance_id, chosen.project_id
  from unnest(v_ids) chosen(project_id)
  on conflict (attendance_id, project_id) do nothing;
  return v_attendance_id;
end;
$$;

-- Compatibility name for already-installed admin clients; always global attendance.
create or replace function public.admin_register_attendance(
  p_worker_id uuid,
  p_work_date date,
  p_project_ids uuid[] default '{}'::uuid[]
) returns uuid
language sql
security definer
set search_path = public, auth, extensions
as $$
  select public.admin_register_attendance_multi(p_worker_id, p_work_date, p_project_ids);
$$;

create or replace function public.add_attendance_project(
  p_attendance_id uuid,
  p_project_id uuid
) returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_attendance public.attendance;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولاً'; end if;
  perform 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'worker'
    and p.status = 'active' and p.is_active = true
  for update;
  if not found then raise exception 'الحساب غير مفعّل'; end if;

  select * into v_attendance
  from public.attendance a
  where a.id = p_attendance_id and a.worker_id = auth.uid() and a.work_date = v_today
  for update;
  if not found then raise exception 'الحضور غير موجود أو ليس حضور اليوم'; end if;
  perform 1 from public.projects where id = p_project_id and status = 'active' for share;
  if not found then raise exception 'المشروع غير نشط أو غير موجود'; end if;

  insert into public.attendance_projects (attendance_id, project_id)
  values (v_attendance.id, p_project_id)
  on conflict (attendance_id, project_id) do nothing;
end;
$$;

-- Global cash request: project_id is rejected (not guessed from assignments).
create or replace function public.register_withdrawal(
  p_worker_id uuid,
  p_amount numeric,
  p_note text default null,
  p_project_id uuid default null,
  p_request_id uuid default null
) returns public.withdrawals
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_result public.withdrawals;
  v_amount numeric;
  v_available numeric;
begin
  if auth.uid() is null or auth.uid() <> p_worker_id then
    raise exception 'غير مسموح بطلب فلوس لحساب آخر';
  end if;
  if p_project_id is not null then
    raise exception 'السحب يُسجّل على الرصيد العام فقط؛ حدّث التطبيق وحاول مجددًا';
  end if;
  if p_amount is null or p_amount <= 0
     or p_amount::text in ('NaN', 'Infinity', '-Infinity')
     or p_amount >= 100000000 then
    raise exception 'المبلغ لازم يكون رقمًا موجبًا وصحيحًا';
  end if;
  if p_request_id is null then raise exception 'رقم العملية مطلوب لإتمام الطلب بأمان'; end if;
  if p_note is not null and length(p_note) > 500 then raise exception 'الملاحظة طويلة أكثر من اللازم'; end if;
  v_amount := round(p_amount, 2);
  if v_amount <= 0 or v_amount >= 100000000 then raise exception 'المبلغ بعد التقريب خارج الحدود المسموحة'; end if;

  perform 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'worker'
    and p.status = 'active' and p.is_active = true
  for update;
  if not found then raise exception 'الحساب غير مفعّل'; end if;

  select * into v_result
  from public.withdrawals w where w.client_request_id = p_request_id
  for update;
  if found then
    if v_result.worker_id <> auth.uid() or v_result.amount <> v_amount or v_result.project_id is not null then
      raise exception 'رقم العملية مستخدم لطلب مختلف';
    end if;
    return v_result;
  end if;

  select coalesce(b.available, 0) into v_available
  from public.worker_balances b where b.worker_id = auth.uid();
  v_available := greatest(coalesce(v_available, 0), 0);
  if v_amount > v_available then
    raise exception 'المتاح من رصيدك العام % جنيه فقط', v_available;
  end if;

  insert into public.withdrawals
    (worker_id, project_id, amount, note, created_by, client_request_id, status, decided_by, decided_at)
  values
    (auth.uid(), null, v_amount, p_note, auth.uid(), p_request_id,
     'pending', null, null)
  returning * into v_result;
  return v_result;
end;
$$;

-- Keep the legacy signature for callers, but never edit per-project wages/sites.
create or replace function public.update_worker_details(
  p_worker_id uuid,
  p_full_name text,
  p_phone text,
  p_daily_wage numeric,
  p_is_active boolean,
  p_site_ids uuid[] default null
) returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_old_phone text;
  v_old_username text;
  v_old_auth_email text;
  v_phone_is_login boolean := false;
begin
  if not public.is_admin() then raise exception 'مش مسموح — تعديل العمال للإدارة النشطة فقط'; end if;
  if p_full_name is null or length(trim(p_full_name)) < 3 or length(trim(p_full_name)) > 120 then
    raise exception 'الاسم يجب أن يكون بين 3 و120 حرفًا';
  end if;
  if length(v_phone) < 10 or length(v_phone) > 15 then raise exception 'رقم الموبايل غير صحيح'; end if;
  if p_daily_wage is null or p_daily_wage < 0
     or p_daily_wage::text in ('NaN', 'Infinity', '-Infinity') or p_daily_wage >= 100000000 then
    raise exception 'اليومية غير صحيحة';
  end if;
  if p_site_ids is not null and cardinality(p_site_ids) > 0 then
    raise exception 'تعيين المواقع القديمة متوقف؛ عيّن العامل إلى المشاريع/المواقع من الشاشة الجديدة';
  end if;

  select p.phone, p.username, u.email into v_old_phone, v_old_username, v_old_auth_email
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = p_worker_id and p.role = 'worker'
  for update of p;
  if not found then raise exception 'العامل غير موجود'; end if;
  v_old_phone := regexp_replace(coalesce(v_old_phone, ''), '[^0-9]', '', 'g');
  if v_old_username is not null and v_old_username = v_old_phone and v_old_phone <> v_phone
     and v_old_auth_email = v_old_username || '@ommal.app' then
    v_phone_is_login := true;
    update auth.users
    set email = v_phone || '@ommal.app',
        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
          || jsonb_build_object('phone', v_phone, 'username', v_phone),
        updated_at = now()
    where id = p_worker_id;
  end if;

  update public.profiles
  set full_name = trim(p_full_name), phone = v_phone,
      username = case when v_phone_is_login then v_phone else username end,
      daily_wage = p_daily_wage, is_active = coalesce(p_is_active, is_active), updated_at = now()
  where id = p_worker_id and role = 'worker';
  if not found then raise exception 'العامل لم يعد متاحًا للتعديل'; end if;
end;
$$;

create or replace function public.save_worker_admin_details(
  p_worker_id uuid,
  p_full_name text,
  p_phone text,
  p_daily_wage numeric,
  p_is_active boolean,
  p_project_ids uuid[] default null
) returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'مش مسموح — تعديل العمال للإدارة النشطة فقط';
  end if;

  -- p_project_ids is retained for PostgREST compatibility only. Workers
  -- choose their projects at attendance; profile edits never change links.
  perform public.update_worker_details(
    p_worker_id, p_full_name, p_phone, p_daily_wage, p_is_active, null
  );
end;
$$;

create or replace function public.add_worker_deduction(
  p_worker_id uuid,
  p_project_id uuid,
  p_amount numeric,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_id uuid;
  v_amount numeric;
begin
  if not public.is_admin() then raise exception 'مش مسموح — إضافة الخصومات للإدارة النشطة فقط'; end if;
  if p_project_id is not null then raise exception 'الخصم يُسجّل على حساب العامل العام فقط'; end if;
  if p_amount is null or p_amount <= 0
     or p_amount::text in ('NaN', 'Infinity', '-Infinity') or p_amount >= 100000000 then
    raise exception 'مبلغ الخصم غير صحيح';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount <= 0 or v_amount >= 100000000 then raise exception 'مبلغ الخصم بعد التقريب غير صحيح'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 or length(p_reason) > 500 then
    raise exception 'اكتب سببًا صحيحًا (حتى 500 حرف)';
  end if;
  perform 1 from public.profiles p where p.id = p_worker_id and p.role = 'worker' for update;
  if not found then raise exception 'العامل غير موجود'; end if;

  insert into public.deductions (worker_id, project_id, amount, reason, created_by)
  values (p_worker_id, null, v_amount, trim(p_reason), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.close_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.is_admin() then raise exception 'مش مسموح — أرشفة المشاريع للإدارة النشطة فقط'; end if;
  update public.projects
  set status = 'closed', end_date = coalesce(end_date, (now() at time zone 'Africa/Cairo')::date),
      closed_at = coalesce(closed_at, now()), archived_at = coalesce(archived_at, now()), archived_by = auth.uid()
  where id = p_project_id and status = 'active';
  if not found then raise exception 'المشروع مؤرشف بالفعل أو غير موجود'; end if;
end;
$$;

create or replace function public.export_project_data(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then raise exception 'مش مسموح — تصدير الأرشيف للإدارة النشطة فقط'; end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'المشروع غير موجود';
  end if;

  select jsonb_build_object(
    'project', (
      select jsonb_build_object(
        'id', p.id, 'name', p.name, 'description', p.description, 'address', p.address,
        'status', p.status, 'start_date', p.start_date, 'end_date', p.end_date,
        'closed_at', p.closed_at, 'archived_at', p.archived_at,
        'archived_by', p.archived_by,
        'archived_by_name', (select pr.full_name from public.profiles pr where pr.id = p.archived_by)
      ) from public.projects p where p.id = p_project_id
    ),
    'workers', (
      select coalesce(jsonb_agg(t order by t.full_name), '[]'::jsonb) from (
        select pr.id as worker_id, pr.full_name, pr.phone
        from public.profiles pr
        where exists (select 1 from public.attendance_projects ap
                      join public.attendance a on a.id = ap.attendance_id
                      where ap.project_id = p_project_id and a.worker_id = pr.id)
      ) t
    ),
    'attendance', (
      select coalesce(jsonb_agg(t order by t.work_date, t.full_name), '[]'::jsonb) from (
        select a.id as attendance_id, a.work_date, pr.full_name, a.source, a.created_at,
               coalesce((
                 select jsonb_agg(p.name order by p.name)
                 from public.attendance_projects all_ap
                 join public.projects p on p.id = all_ap.project_id
                 where all_ap.attendance_id = a.id
               ), '[]'::jsonb) as projects
        from public.attendance_projects target_ap
        join public.attendance a on a.id = target_ap.attendance_id
        join public.profiles pr on pr.id = a.worker_id
        where target_ap.project_id = p_project_id
      ) t
    )
  ) into v;
  return v;
end;
$$;

-- Old per-project finance was a derived view, not a ledger, and is no longer exposed.
drop view if exists public.worker_project_balances;

-- New tables and reports are read-only to clients; mutations go through the RPCs.
revoke all on function public.register_attendance(uuid, date, uuid[], numeric, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.add_attendance_site(uuid, uuid) from public, anon, authenticated;
revoke all on function public.register_attendance_multi(uuid, date, uuid[], numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.admin_register_attendance_multi(uuid, date, uuid[]) from public, anon, authenticated;
revoke all on function public.admin_register_attendance(uuid, date, uuid[]) from public, anon, authenticated;
revoke all on function public.add_attendance_project(uuid, uuid) from public, anon, authenticated;
revoke all on function public.register_withdrawal(uuid, numeric, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_worker_admin_details(uuid, text, text, numeric, boolean, uuid[]) from public, anon, authenticated;
revoke all on function public.update_worker_details(uuid, text, text, numeric, boolean, uuid[]) from public, anon, authenticated;
revoke all on function public.add_worker_deduction(uuid, uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.close_project(uuid) from public, anon, authenticated;
revoke all on function public.export_project_data(uuid) from public, anon, authenticated;
revoke all on table public.attendance_projects from public, anon, authenticated;
grant select on table public.attendance_projects to authenticated;
revoke all on table public.worker_balances from anon;
revoke all on table public.project_archive from anon;

grant execute on function public.register_attendance_multi(uuid, date, uuid[], numeric, numeric, text) to authenticated;
grant execute on function public.admin_register_attendance_multi(uuid, date, uuid[]) to authenticated;
grant execute on function public.admin_register_attendance(uuid, date, uuid[]) to authenticated;
grant execute on function public.add_attendance_project(uuid, uuid) to authenticated;
grant execute on function public.register_withdrawal(uuid, numeric, text, uuid, uuid) to authenticated;
grant execute on function public.save_worker_admin_details(uuid, text, text, numeric, boolean, uuid[]) to authenticated;
grant execute on function public.update_worker_details(uuid, text, text, numeric, boolean, uuid[]) to authenticated;
grant execute on function public.add_worker_deduction(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.close_project(uuid) to authenticated;
grant execute on function public.export_project_data(uuid) to authenticated;
grant select on public.worker_balances, public.attendance_with_wage,
  public.daily_summary, public.admin_users, public.project_archive to authenticated;

revoke all on function public.guard_worker_project_live() from public, anon, authenticated;
revoke all on function public.guard_attendance_project_link() from public, anon, authenticated;
revoke all on function public.register_attendance_multi(uuid, date, uuid[], numeric, numeric, text) from anon;
revoke all on function public.admin_register_attendance_multi(uuid, date, uuid[]) from anon;
revoke all on function public.add_attendance_project(uuid, uuid) from anon;
revoke all on function public.save_worker_admin_details(uuid, text, text, numeric, boolean, uuid[]) from anon;

-- ==================== END functions.sql ===================

-- ============================================================
-- Developer-only, history-safe hard deletion RPCs
-- Apply supabase/DEVELOPER-DELETE.sql on existing installations.
-- ============================================================
-- AquaDior: safe, developer-only hard deletion for empty workers/projects.

create or replace function public.developer_delete_worker(p_worker_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_role text;
  v_card_path text;
  v_deleted_id uuid;
begin
  if auth.uid() is null or not public.is_developer() then
    raise exception 'غير مسموح — حذف العامل متاح للمطوّر النشط فقط';
  end if;
  if p_worker_id is null or p_worker_id = auth.uid() then
    raise exception 'معرّف العامل غير صالح';
  end if;

  select p.role, p.id_card_url
    into v_role, v_card_path
  from public.profiles p
  where p.id = p_worker_id
  for update;

  if not found then
    raise exception 'العامل غير موجود';
  end if;
  if v_role <> 'worker' then
    raise exception 'يمكن حذف حساب عامل فقط من هذه الشاشة';
  end if;

  -- Keep every attendance, payroll, withdrawal, deduction, and settlement row.
  if exists (select 1 from public.attendance a where a.worker_id = p_worker_id)
     or exists (select 1 from public.withdrawals w where w.worker_id = p_worker_id)
     or exists (select 1 from public.deductions d where d.worker_id = p_worker_id)
     or exists (select 1 from public.settlements s where s.worker_id = p_worker_id) then
    raise exception 'لا يمكن حذف العامل لوجود حضور أو سجلات مالية/تسويات مرتبطة به؛ أوقف العامل بدلًا من حذف سجله';
  end if;

  -- Avoid breaking profile attribution and audit relationships on other records.
  if exists (select 1 from public.profiles p where p.approved_by = p_worker_id)
     or exists (select 1 from public.projects p where p.created_by = p_worker_id or p.archived_by = p_worker_id)
     or exists (select 1 from public.attendance a where a.created_by = p_worker_id)
     or exists (select 1 from public.withdrawals w where w.created_by = p_worker_id or w.decided_by = p_worker_id)
     or exists (select 1 from public.deductions d where d.created_by = p_worker_id)
     or exists (select 1 from public.settlements s where s.confirmed_by = p_worker_id) then
    raise exception 'لا يمكن حذف العامل لوجود سجلات أُنشئت أو اعتُمدت بحسابه؛ احتفظ بالحساب وأوقفه بدلًا من ذلك';
  end if;

  -- These are current assignments only, not attendance or financial history.
  delete from public.worker_projects where worker_id = p_worker_id;
  delete from public.site_workers where worker_id = p_worker_id;

  -- Auth owns the profile lifecycle; its FK cascade removes the profile while
  -- audit triggers retain a deletion record. Return the private card path so
  -- the authenticated client can remove the object through Supabase Storage API.
  delete from auth.users where id = p_worker_id
  returning id into v_deleted_id;
  if v_deleted_id is null then
    raise exception 'حساب المصادقة غير موجود؛ لم يتم حذف العامل';
  end if;

  return v_card_path;
end;
$$;

create or replace function public.developer_delete_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if auth.uid() is null or not public.is_developer() then
    raise exception 'غير مسموح — حذف المشروع متاح للمطوّر النشط فقط';
  end if;
  if p_project_id is null then
    raise exception 'معرّف المشروع غير صالح';
  end if;

  -- Serialize deletion against new activity and lock the project row first.
  perform 1 from public.projects p where p.id = p_project_id for update;
  if not found then
    raise exception 'المشروع غير موجود';
  end if;

  -- A linked attendance or any financial record is historical data: preserve it.
  if exists (select 1 from public.attendance a where a.project_id = p_project_id)
     or exists (select 1 from public.attendance_projects ap where ap.project_id = p_project_id)
     or exists (
       select 1
       from public.attendance_sites ats
       join public.sites s on s.id = ats.site_id
       where s.project_id = p_project_id
     )
     or exists (select 1 from public.withdrawals w where w.project_id = p_project_id)
     or exists (select 1 from public.deductions d where d.project_id = p_project_id)
     or exists (select 1 from public.settlements s where s.project_id = p_project_id) then
    raise exception 'لا يمكن حذف المشروع لوجود حضور أو حركات مالية/تسويات مرتبطة به؛ استخدم الأرشفة للحفاظ على السجلات';
  end if;

  -- Worker/project and legacy site links are assignments, not historical rows.
  delete from public.worker_projects where project_id = p_project_id;
  delete from public.site_workers sw
  using public.sites s
  where sw.site_id = s.id and s.project_id = p_project_id;
  delete from public.sites where project_id = p_project_id;
  delete from public.projects where id = p_project_id;
end;
$$;

-- The app deletes a worker's ID-card object through Storage's supported API.
-- No direct writes to the platform-owned storage table are performed here.
drop policy if exists "developer deletes worker cards" on storage.objects;
create policy "developer deletes worker cards" on storage.objects for delete to authenticated
  using (bucket_id = 'id-cards' and auth.uid() is not null and public.is_developer());

revoke all on function public.developer_delete_worker(uuid) from public, anon, authenticated;
revoke all on function public.developer_delete_project(uuid) from public, anon, authenticated;
grant execute on function public.developer_delete_worker(uuid) to authenticated;
grant execute on function public.developer_delete_project(uuid) to authenticated;

-- ============================================================
-- Operational notifications v2 (additive, idempotent)
-- Apply once in the Supabase SQL Editor after the current ALL-IN-ONE.sql.
-- Does not delete business records. Owners/admins only see their own inbox;
-- worker messages stay private to that worker.
-- ============================================================

begin;

-- Keep financial correction auditable: voiding adds metadata to a deduction row
-- instead of deleting or rewriting its amount/reason.
alter table public.deductions add column if not exists voided_at timestamptz;
alter table public.deductions add column if not exists voided_by uuid references public.profiles(id);
alter table public.deductions add column if not exists void_reason text;
create index if not exists idx_deductions_worker_active
  on public.deductions(worker_id, created_at desc) where voided_at is null;

alter table public.deductions enable row level security;
drop policy if exists "ded write" on public.deductions;
drop policy if exists "ded read" on public.deductions;
create policy "ded read" on public.deductions for select
  using (auth.uid() = worker_id or public.is_admin());
revoke insert, update, delete on table public.deductions from public, anon, authenticated;
grant select on table public.deductions to authenticated;

-- Each trigger writes a separate notification row for each recipient. Admins
-- therefore do not need a policy that exposes every worker's private inbox.
alter table public.notifications enable row level security;
drop policy if exists "notif admin read" on public.notifications;
drop policy if exists "notif own read" on public.notifications;
create policy "notif own read" on public.notifications for select
  using (auth.uid() = user_id);
drop policy if exists "notif own update" on public.notifications;
create policy "notif own update" on public.notifications for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke update on table public.notifications from public, anon, authenticated;
revoke update (id, user_id, type, title, body, data, created_at)
  on public.notifications from public, anon, authenticated;
grant update (is_read) on public.notifications to authenticated;
create index if not exists idx_notifications_user_read_created
  on public.notifications (user_id, is_read, created_at desc);

-- Global settlements are explicit disbursements from the worker's general
-- balance. Legacy project-scoped rows are preserved unchanged.
alter table public.settlements alter column project_id drop not null;
alter table public.settlements add column if not exists client_request_id uuid;
create unique index if not exists idx_settlements_client_request
  on public.settlements (client_request_id) where client_request_id is not null;
create index if not exists idx_settlements_worker_global_paid
  on public.settlements (worker_id, paid_at desc)
  where project_id is null and status = 'paid';

drop policy if exists "st write" on public.settlements;
drop policy if exists "st read" on public.settlements;
create policy "st read" on public.settlements for select
  using (auth.uid() = worker_id or public.is_admin());
revoke insert, update, delete on table public.settlements from public, anon, authenticated;
grant select on table public.settlements to authenticated;

-- A paid settlement is a financial movement: it reduces the worker's global
-- balance once, while retaining the earned/withdrawn/deduction components.
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
  coalesce(e.earned, 0) - coalesce(w.approved, 0) - coalesce(d.deducted, 0) - coalesce(st.paid, 0) as balance,
  coalesce(e.earned, 0) - coalesce(w.approved, 0) - coalesce(w.pending, 0)
    - coalesce(d.deducted, 0) - coalesce(st.paid, 0) as available,
  coalesce(st.paid, 0) as settled_paid
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
  where voided_at is null
  group by worker_id
) d on d.worker_id = p.id
left join (
  select worker_id, sum(net_amount) as paid
  from public.settlements
  where project_id is null and status = 'paid'
  group by worker_id
) st on st.worker_id = p.id
where p.role = 'worker';
alter view public.worker_balances set (security_invoker = true);
grant select on public.worker_balances to authenticated;

-- Reverse a mistaken deduction without deleting financial history. The
-- immutable amount/reason and the audit-log before/after image are preserved.
create or replace function public.reverse_worker_deduction(
  p_deduction_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_deduction public.deductions%rowtype;
  v_worker_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'إلغاء الخصم متاح للإدارة النشطة فقط';
  end if;
  if p_deduction_id is null then
    raise exception 'معرّف الخصم غير صالح';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'اكتب سببًا واضحًا من 3 إلى 500 حرف';
  end if;

  select d.worker_id into v_worker_id
  from public.deductions d where d.id = p_deduction_id;
  if not found then
    raise exception 'الخصم غير موجود';
  end if;
  -- Serialize with settlement, withdrawal and deduction creation for this worker.
  perform 1 from public.profiles p
  where p.id = v_worker_id and p.role = 'worker'
  for update;
  if not found then
    raise exception 'العامل غير موجود';
  end if;

  select * into v_deduction
  from public.deductions
  where id = p_deduction_id
  for update;
  if not found then
    raise exception 'الخصم غير موجود';
  end if;
  if v_deduction.voided_at is not null then
    if v_deduction.voided_by = auth.uid() and v_deduction.void_reason = v_reason then
      return;
    end if;
    raise exception 'تم إلغاء هذا الخصم بالفعل';
  end if;

  update public.deductions
  set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
  where id = v_deduction.id;
end;
$$;
revoke all on function public.reverse_worker_deduction(uuid, text) from public, anon, authenticated;
grant execute on function public.reverse_worker_deduction(uuid, text) to authenticated;

-- Lock the worker's account, include all ledger activity since the previous
-- global payout, and create one idempotent paid snapshot. Pending withdrawals
-- block payout so an outstanding request cannot later overdraw the balance.
create or replace function public.create_worker_settlement(
  p_worker_id uuid,
  p_request_id uuid
) returns public.settlements
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_result public.settlements;
  v_role text;
  v_daily_wage numeric;
  v_since timestamptz;
  v_days integer := 0;
  v_earned numeric := 0;
  v_withdrawn numeric := 0;
  v_deducted numeric := 0;
  v_balance numeric := 0;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'صرف التسوية متاح للإدارة النشطة فقط';
  end if;
  if p_worker_id is null or p_request_id is null then
    raise exception 'بيانات التسوية غير مكتملة؛ حدّث الصفحة وحاول مجددًا';
  end if;

  select * into v_result
  from public.settlements s
  where s.client_request_id = p_request_id
  for update;
  if found then
    if v_result.worker_id <> p_worker_id or v_result.project_id is not null or v_result.status <> 'paid' then
      raise exception 'رقم العملية مستخدم لتسوية مختلفة';
    end if;
    return v_result;
  end if;

  select p.role, p.daily_wage into v_role, v_daily_wage
  from public.profiles p
  where p.id = p_worker_id
  for update;
  if not found or v_role <> 'worker' then
    raise exception 'العامل غير موجود';
  end if;

  -- Recheck after taking the same per-worker lock used by attendance, deductions
  -- and withdrawals, so a concurrent retry returns the committed receipt.
  select * into v_result
  from public.settlements s
  where s.client_request_id = p_request_id
  for update;
  if found then
    if v_result.worker_id <> p_worker_id or v_result.project_id is not null or v_result.status <> 'paid' then
      raise exception 'رقم العملية مستخدم لتسوية مختلفة';
    end if;
    return v_result;
  end if;

  if exists (select 1 from public.withdrawals w
             where w.worker_id = p_worker_id and w.status = 'pending') then
    raise exception 'احسم طلبات الصرف المعلّقة قبل تسوية رصيد العامل';
  end if;

  select max(coalesce(s.paid_at, s.created_at)) into v_since
  from public.settlements s
  where s.worker_id = p_worker_id and s.project_id is null and s.status = 'paid';
  v_since := coalesce(v_since, '-infinity'::timestamptz);

  select count(*)::integer, coalesce(sum(aw.wage), 0)
    into v_days, v_earned
  from public.attendance a
  join public.attendance_with_wage aw on aw.id = a.id
  where a.worker_id = p_worker_id and a.created_at > v_since;

  select coalesce(sum(w.amount), 0) into v_withdrawn
  from public.withdrawals w
  where w.worker_id = p_worker_id and w.status = 'approved' and w.created_at > v_since;

  -- Active deductions from this period reduce the payout. A prior deduction
  -- reversed after an earlier payout becomes a positive carry-forward credit.
  select coalesce(sum(
    case
      when d.created_at > v_since and d.voided_at is null then d.amount
      when d.created_at <= v_since and d.voided_at > v_since then -d.amount
      else 0
    end
  ), 0) into v_deducted
  from public.deductions d
  where d.worker_id = p_worker_id
    and ((d.created_at > v_since and d.voided_at is null)
      or (d.created_at <= v_since and d.voided_at > v_since));

  select coalesce(b.balance, 0) into v_balance
  from public.worker_balances b where b.worker_id = p_worker_id;
  if v_balance <= 0 then
    raise exception 'مفيش رصيد موجب مستحق للتسوية';
  end if;
  if round(v_earned - v_withdrawn - v_deducted, 2) <> round(v_balance, 2) then
    raise exception 'تغيّر سجل الحساب ويحتاج مراجعة قبل الصرف؛ أعد تحميل الصفحة';
  end if;

  insert into public.settlements (
    worker_id, project_id, days_worked, daily_wage,
    total_earned, total_withdrawn, total_deductions, net_amount,
    status, confirmed_by, paid_at, client_request_id
  ) values (
    p_worker_id, null, v_days, coalesce(v_daily_wage, 0),
    round(v_earned, 2), round(v_withdrawn, 2), round(v_deducted, 2), round(v_balance, 2),
    'paid', auth.uid(), now(), p_request_id
  ) returning * into v_result;
  return v_result;
end;
$$;
revoke all on function public.create_worker_settlement(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_worker_settlement(uuid, uuid) to authenticated;

-- Admins receive attendance activity. A worker also receives a message when an
-- admin records or changes attendance on their behalf; self-entry is not noisy.
create or replace function public.notify_attendance()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_name text;
  v_date text;
begin
  select full_name into v_name from public.profiles where id = new.worker_id;
  v_date := to_char(new.work_date, 'YYYY-MM-DD');
  if tg_op = 'INSERT' then
    perform public.notify_admins(
      'attendance_new', 'حضور جديد',
      coalesce(v_name, 'عامل') || ' سجّل حضوره يوم ' || v_date,
      jsonb_build_object('worker_id', new.worker_id, 'work_date', v_date, 'attendance_id', new.id)
    );
    if new.created_by is distinct from new.worker_id then
      insert into public.notifications (user_id, type, title, body, data)
      values (new.worker_id, 'attendance_new', 'تم تسجيل حضورك',
        'سجّلت الإدارة حضورك يوم ' || v_date,
        jsonb_build_object('attendance_id', new.id, 'work_date', v_date));
    end if;
  elsif tg_op = 'UPDATE' then
    perform public.notify_admins(
      'attendance_edit', 'تعديل حضور',
      coalesce(v_name, 'عامل') || ' تم تعديل حضوره يوم ' || v_date,
      jsonb_build_object('worker_id', new.worker_id, 'work_date', v_date, 'attendance_id', new.id)
    );
    if new.created_by is distinct from new.worker_id
       and (old.work_date is distinct from new.work_date
         or old.daily_wage_snapshot is distinct from new.daily_wage_snapshot
         or old.note is distinct from new.note) then
      insert into public.notifications (user_id, type, title, body, data)
      values (new.worker_id, 'attendance_edit', 'تم تعديل سجل حضورك',
        'عدّلت الإدارة سجل حضورك بتاريخ ' || v_date,
        jsonb_build_object('attendance_id', new.id, 'work_date', v_date));
    end if;
  end if;
  return new;
end;
$$;

-- Keep owner approval mandatory while notifying the worker and admins both
-- when a request is created and when its status is decided.
create or replace function public.notify_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_name text;
  v_currency text;
  v_worker_title text;
  v_worker_body text;
begin
  select full_name into v_name from public.profiles where id = new.worker_id;
  select value->>'currency' into v_currency
  from public.settings where key = 'app';
  if v_currency is null or length(v_currency) > 20 then v_currency := 'ج.م'; end if;

  if tg_op = 'INSERT' then
    -- A new request is never approved by a trigger, regardless of amount or
    -- any legacy auto_approve_limit value still present in settings.
    new.status := 'pending';
    new.decided_at := null;
    new.decided_by := null;
    new.decision_note := null;
    perform public.notify_admins(
      'withdrawal_pending', 'طلب سحب جديد',
      coalesce(v_name, 'عامل') || ' طلب ' || new.amount || ' ' || v_currency || ' — بانتظار موافقة المالك',
      jsonb_build_object('worker_id', new.worker_id, 'amount', new.amount, 'id', new.id, 'status', new.status)
    );
    insert into public.notifications (user_id, type, title, body, data)
    values (
      new.worker_id,
      'withdrawal_new',
      'طلب السحب بانتظار موافقة المالك',
      'استلمنا طلبك بمبلغ ' || new.amount || ' ' || v_currency || '؛ لن يُخصم من رصيدك إلا بعد موافقة المالك',
      jsonb_build_object('withdrawal_id', new.id, 'amount', new.amount, 'status', new.status)
    );
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    perform public.notify_admins(
      'withdrawal_decided', 'قرار على طلب صرف',
      coalesce(v_name, 'عامل') || ' — الطلب بقيمة ' || new.amount || ' ' || v_currency
        || ' أصبح ' || case new.status
          when 'approved' then 'موافقاً عليه'
          when 'rejected' then 'مرفوضاً'
          else 'معلّقاً'
        end,
      jsonb_build_object('worker_id', new.worker_id, 'amount', new.amount, 'status', new.status, 'id', new.id)
    );
    v_worker_title := case new.status
      when 'approved' then 'تمت الموافقة على طلب السحب'
      when 'rejected' then 'تم رفض طلب السحب'
      else 'تغيّرت حالة طلب السحب'
    end;
    v_worker_body := coalesce(nullif(trim(new.decision_note), ''),
      case new.status
        when 'approved' then 'وافق المالك على طلبك بمبلغ ' || new.amount || ' ' || v_currency
        when 'rejected' then 'رفض المالك طلبك بمبلغ ' || new.amount || ' ' || v_currency
        else 'تغيّرت حالة طلبك بمبلغ ' || new.amount || ' ' || v_currency
      end);
    insert into public.notifications (user_id, type, title, body, data)
    values (new.worker_id, 'withdrawal_decision', v_worker_title, v_worker_body,
      jsonb_build_object('withdrawal_id', new.id, 'amount', new.amount, 'status', new.status));
  end if;
  return new;
end;
$$;

-- A deduction is part of the worker's general account, never duplicated by
-- project. New deductions and auditable voids notify both the worker and admins.
create or replace function public.notify_deduction()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_name text;
  v_currency text;
begin
  select full_name into v_name from public.profiles where id = new.worker_id;
  select coalesce(value->>'currency', 'ج.م') into v_currency
  from public.settings where key = 'app';
  v_currency := coalesce(nullif(v_currency, ''), 'ج.م');

  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, type, title, body, data)
    values (new.worker_id, 'deduction_new', 'تم تسجيل خصم على حسابك',
      'المبلغ: ' || new.amount || ' ' || v_currency || ' — السبب: ' || new.reason,
      jsonb_build_object('deduction_id', new.id, 'amount', new.amount, 'reason', new.reason));
    perform public.notify_admins(
      'deduction_new', 'خصم جديد',
      coalesce(v_name, 'عامل') || ' — خصم ' || new.amount || ' '
        || v_currency || ': ' || new.reason,
      jsonb_build_object('worker_id', new.worker_id, 'amount', new.amount, 'reason', new.reason, 'deduction_id', new.id)
    );
  elsif old.voided_at is null and new.voided_at is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (new.worker_id, 'deduction_reversed', 'تم إلغاء خصم من حسابك',
      'أُلغي خصم بقيمة ' || new.amount || ' ' || v_currency || ' — السبب: ' || new.void_reason,
      jsonb_build_object('deduction_id', new.id, 'amount', new.amount, 'reason', new.void_reason));
    perform public.notify_admins(
      'deduction_reversed', 'تم إلغاء خصم',
      coalesce(v_name, 'عامل') || ' — إلغاء خصم ' || new.amount || ' '
        || v_currency || ': ' || new.void_reason,
      jsonb_build_object('worker_id', new.worker_id, 'amount', new.amount, 'reason', new.void_reason, 'deduction_id', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notif_deduction on public.deductions;
create trigger trg_notif_deduction after insert or update on public.deductions
  for each row execute function public.notify_deduction();

-- Historical worker_projects rows are no longer worker assignments. Do not send
-- misleading assigned/unassigned notifications when legacy rows are edited.
drop trigger if exists trg_notif_worker_projects on public.worker_projects;
drop function if exists public.notify_worker_project_assignment();

-- Project creation, archiving and deletion are visible to all admin inboxes.
-- Workers with attendance linked to an archived project are notified as well.
create or replace function public.notify_project_event()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_opened boolean := false;
begin
  if tg_op = 'INSERT' then
    perform public.notify_admins('project_created', 'تم إنشاء مشروع جديد',
      'تمت إضافة مشروع ' || new.name,
      jsonb_build_object('project_id', new.id, 'project_name', new.name));
    v_opened := new.status = 'active';
  elsif tg_op = 'DELETE' then
    perform public.notify_admins('project_deleted', 'تم حذف مشروع',
      'تم حذف مشروع ' || old.name,
      jsonb_build_object('project_id', old.id, 'project_name', old.name));
    return old;
  else
    v_opened := old.status is distinct from new.status and new.status = 'active';
  end if;

  if v_opened then
    if tg_op = 'UPDATE' then
      perform public.notify_admins('project_opened', 'تم فتح مشروع',
        'أصبح مشروع ' || new.name || ' متاحًا للعاملين',
        jsonb_build_object('project_id', new.id, 'project_name', new.name));
    end if;
    insert into public.notifications (user_id, type, title, body, data)
    select p.id, 'project_opened', 'مشروع مفتوح للعاملين',
      'المشروع ' || new.name || ' متاح لكل العمال عند تسجيل الحضور',
      jsonb_build_object('project_id', new.id, 'project_name', new.name)
    from public.profiles p
    where p.role = 'worker' and p.status = 'active' and p.is_active = true;
  elsif tg_op = 'UPDATE'
     and old.status is distinct from new.status and new.status = 'closed' then
    perform public.notify_admins('project_archived', 'تمت أرشفة مشروع',
      'تم إغلاق مشروع ' || new.name,
      jsonb_build_object('project_id', new.id, 'project_name', new.name));
    insert into public.notifications (user_id, type, title, body, data)
    select distinct p.id, 'project_archived', 'تم إغلاق المشروع',
      'تم إغلاق مشروع ' || new.name || '؛ سجلات حضورك السابقة محفوظة في كشفك',
      jsonb_build_object('project_id', new.id, 'project_name', new.name)
    from public.attendance_projects ap
    join public.attendance a on a.id = ap.attendance_id
    join public.profiles p on p.id = a.worker_id
    where ap.project_id = new.id and p.role = 'worker'
      and p.status = 'active' and p.is_active = true;
  elsif tg_op = 'UPDATE'
     and (old.name is distinct from new.name
       or old.address is distinct from new.address
       or old.description is distinct from new.description
       or old.start_date is distinct from new.start_date) then
    perform public.notify_admins('project_updated', 'تم تعديل بيانات مشروع',
      'تم تعديل بيانات مشروع ' || new.name,
      jsonb_build_object('project_id', new.id, 'project_name', new.name));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notif_project_events on public.projects;
create trigger trg_notif_project_events after insert or update or delete on public.projects
  for each row execute function public.notify_project_event();

-- Inform workers when a global settlement is marked paid.
create or replace function public.notify_settlement_paid()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'paid' then
      insert into public.notifications (user_id, type, title, body, data)
      values (new.worker_id, 'settlement_paid', 'تم تسجيل صرف مستحقاتك',
        'تم تسجيل صرف مبلغ ' || new.net_amount || ' ج.م',
        jsonb_build_object('settlement_id', new.id, 'amount', new.net_amount));
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status = 'paid' and old.status is distinct from new.status then
    insert into public.notifications (user_id, type, title, body, data)
    values (new.worker_id, 'settlement_paid', 'تم تسجيل صرف مستحقاتك',
      'تم تسجيل صرف مبلغ ' || new.net_amount || ' ج.م',
      jsonb_build_object('settlement_id', new.id, 'amount', new.net_amount));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notif_settlement_paid on public.settlements;
create trigger trg_notif_settlement_paid after insert or update on public.settlements
  for each row execute function public.notify_settlement_paid();

commit;

-- ==================== END operational notifications v2 ====================
