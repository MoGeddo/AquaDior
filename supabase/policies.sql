-- ============================================================
--  WORKER APP — ROW LEVEL SECURITY
--  شغّل الملف ده بعد schema.sql
-- ============================================================

-- دالة مساعدة: هل المستخدم الحالي مالك أو مدير أو مطوّر؟
create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('owner','manager','developer')
  );
$$ language sql security definer stable;

-- دالة: هل المستخدم هو المطوّر؟ (بيقدر يعدّل أي يوزر)
create or replace function is_developer()
returns boolean as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'developer'
  );
$$ language sql security definer stable;

-- ---------- PROFILES ----------
alter table profiles enable row level security;

drop policy if exists "own profile read"   on profiles;
drop policy if exists "admin read all"     on profiles;
drop policy if exists "own profile update" on profiles;
drop policy if exists "admin update all"   on profiles;
drop policy if exists "admin insert"       on profiles;
drop policy if exists "admin delete"       on profiles;

create policy "own profile read"   on profiles for select using (auth.uid() = id);
create policy "admin read all"     on profiles for select using (is_admin());
create policy "own profile update" on profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "admin update all"   on profiles for update using (is_admin());
create policy "admin insert"       on profiles for insert with check (is_admin() or auth.uid() = id);
create policy "admin delete"       on profiles for delete using (is_admin());

-- ---------- PROJECTS ----------
alter table projects enable row level security;

drop policy if exists "projects read"      on projects;
drop policy if exists "projects insert"    on projects;
drop policy if exists "projects update"    on projects;
drop policy if exists "projects delete"    on projects;

create policy "projects read"   on projects for select using (auth.uid() is not null);
create policy "projects insert" on projects for insert with check (is_admin());
create policy "projects update" on projects for update using (is_admin());
create policy "projects delete" on projects for delete using (is_admin());

-- ---------- SITES ----------
alter table sites enable row level security;

drop policy if exists "sites read"   on sites;
drop policy if exists "sites write"  on sites;

create policy "sites read"  on sites for select using (auth.uid() is not null);
create policy "sites write" on sites for all    using (is_admin()) with check (is_admin());

-- ---------- WORKER_PROJECTS ----------
alter table worker_projects enable row level security;

drop policy if exists "wp read"  on worker_projects;
drop policy if exists "wp write" on worker_projects;

create policy "wp read"  on worker_projects for select using (auth.uid() = worker_id or is_admin());
create policy "wp write" on worker_projects for all    using (is_admin()) with check (is_admin());

-- ---------- SITE_WORKERS ----------
alter table site_workers enable row level security;

drop policy if exists "sw read"  on site_workers;
drop policy if exists "sw write" on site_workers;

create policy "sw read"  on site_workers for select using (auth.uid() = worker_id or is_admin());
create policy "sw write" on site_workers for all    using (is_admin()) with check (is_admin());

-- ---------- ATTENDANCE ----------
alter table attendance enable row level security;

drop policy if exists "att own read"   on attendance;
drop policy if exists "att admin read" on attendance;
drop policy if exists "att own insert" on attendance;
drop policy if exists "att admin all"  on attendance;
drop policy if exists "att own update" on attendance;
drop policy if exists "att own delete" on attendance;

create policy "att own read"   on attendance for select using (auth.uid() = worker_id);
create policy "att admin read" on attendance for select using (is_admin());
-- العامل يسجّل حضوره بنفسه
create policy "att own insert" on attendance for insert with check (auth.uid() = worker_id and auth.uid() = created_by);
-- العامل يعدّل في نفس اليوم بس
create policy "att own update" on attendance for update
  using (auth.uid() = worker_id and work_date = current_date)
  with check (auth.uid() = worker_id and work_date = current_date);
create policy "att own delete" on attendance for delete
  using (auth.uid() = worker_id and work_date = current_date);
-- المالك والمدير: كل حاجة
create policy "att admin all"  on attendance for all using (is_admin()) with check (is_admin());

-- ---------- ATTENDANCE_SITES ----------
alter table attendance_sites enable row level security;

drop policy if exists "asites own"  on attendance_sites;
drop policy if exists "asites admin" on attendance_sites;

create policy "asites own"  on attendance_sites for all
  using (exists (select 1 from attendance a where a.id = attendance_id and a.worker_id = auth.uid()))
  with check (exists (select 1 from attendance a where a.id = attendance_id and a.worker_id = auth.uid()));
create policy "asites admin" on attendance_sites for all using (is_admin()) with check (is_admin());

-- ---------- WITHDRAWALS ----------
alter table withdrawals enable row level security;

drop policy if exists "wd own read"   on withdrawals;
drop policy if exists "wd admin read" on withdrawals;
drop policy if exists "wd own insert" on withdrawals;
drop policy if exists "wd admin all"  on withdrawals;

create policy "wd own read"   on withdrawals for select using (auth.uid() = worker_id);
create policy "wd admin read" on withdrawals for select using (is_admin());
create policy "wd own insert" on withdrawals for insert
  with check (auth.uid() = worker_id and auth.uid() = created_by);
create policy "wd admin all"  on withdrawals for all using (is_admin()) with check (is_admin());

-- ---------- DEDUCTIONS ----------
alter table deductions enable row level security;

drop policy if exists "ded read"  on deductions;
drop policy if exists "ded write" on deductions;

create policy "ded read"  on deductions for select using (auth.uid() = worker_id or is_admin());
create policy "ded write" on deductions for all    using (is_admin()) with check (is_admin());

-- ---------- SETTLEMENTS ----------
alter table settlements enable row level security;

drop policy if exists "st read"  on settlements;
drop policy if exists "st write" on settlements;

create policy "st read"  on settlements for select using (auth.uid() = worker_id or is_admin());
create policy "st write" on settlements for all    using (is_admin()) with check (is_admin());

-- ---------- AUDIT_LOG ----------
alter table audit_log enable row level security;

drop policy if exists "audit read"  on audit_log;
drop policy if exists "audit write" on audit_log;

create policy "audit read"  on audit_log for select using (is_admin());
create policy "audit write" on audit_log for insert with check (true);

-- ---------- NOTIFICATIONS ----------
alter table notifications enable row level security;

drop policy if exists "notif own read"  on notifications;
drop policy if exists "notif own update" on notifications;
drop policy if exists "notif admin read" on notifications;
drop policy if exists "notif insert"    on notifications;

create policy "notif own read"   on notifications for select using (auth.uid() = user_id);
create policy "notif own update" on notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notif admin read" on notifications for select using (is_admin());
create policy "notif insert"     on notifications for insert with check (true);

-- ---------- SETTINGS ----------
alter table settings enable row level security;

drop policy if exists "settings read"  on settings;
drop policy if exists "settings write" on settings;

create policy "settings read"  on settings for select using (is_admin());
create policy "settings write" on settings for all    using (is_admin()) with check (is_admin());

-- ---------- STORAGE: صور البطاقات ----------
drop policy if exists "worker uploads own card" on storage.objects;
drop policy if exists "worker reads own card"  on storage.objects;
drop policy if exists "admin reads all cards"   on storage.objects;

create policy "worker uploads own card" on storage.objects for insert
  with check (
    bucket_id = 'id-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "worker reads own card" on storage.objects for select
  using (
    bucket_id = 'id-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "admin reads all cards" on storage.objects for select
  using (bucket_id = 'id-cards' and is_admin());

-- ---------- PROFILES: تسجيل ذاتي ----------
drop policy if exists "self signup" on profiles;
create policy "self signup" on profiles for insert
  with check (auth.uid() = id);
