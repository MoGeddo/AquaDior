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
