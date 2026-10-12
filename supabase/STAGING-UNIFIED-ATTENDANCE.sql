-- ============================================================
-- STAGING ONLY: unify project/site identity and daily attendance.
-- Review the site-data preflight below before running this script.
-- This transaction never drops legacy tables or financial rows.
-- Do not run on Production.
-- ============================================================

begin;

do $$
declare
  v_table text;
  v_has_rows boolean;
begin
  if to_regclass('public.projects') is null
     or to_regclass('public.attendance') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.worker_projects') is null then
    raise exception 'Required AquaDior tables are missing. Stop; do not run the base/old SQL on this database.';
  end if;

  -- Old sites can contain a second location hierarchy. We will not silently
  -- flatten or duplicate those records: stop and review the data if any exist.
  foreach v_table in array array[
    'public.sites',
    'public.site_workers',
    'public.attendance_sites'
  ] loop
    if to_regclass(v_table) is not null then
      execute format('select exists (select 1 from %s limit 1)', v_table) into v_has_rows;
      if v_has_rows then
        raise exception 'Legacy site rows found in %. Migration stopped without applying changes; inspect/map the old project-site data first.', v_table;
      end if;
    end if;
  end loop;
end;
$$;

alter table public.projects add column if not exists address text;
alter table public.projects add column if not exists lat numeric(10,7);
alter table public.projects add column if not exists lng numeric(10,7);
alter table public.projects add column if not exists closed_at timestamptz;
alter table public.projects add column if not exists archived_at timestamptz;
alter table public.projects add column if not exists archived_by uuid;
alter table public.withdrawals add column if not exists client_request_id uuid;
do $$ begin
  if exists (
    select 1 from public.withdrawals
    where client_request_id is not null
    group by client_request_id having count(*) > 1
  ) then
    raise exception 'Duplicate withdrawal request IDs found. Migration stopped; reconcile duplicate requests before continuing.';
  end if;
end $$;
create unique index if not exists idx_withdrawals_client_request
  on public.withdrawals(client_request_id) where client_request_id is not null;
comment on table public.projects is
  'Canonical active project/worksite; workers choose one or more open projects when recording daily attendance.';
alter table public.attendance add column if not exists daily_wage_snapshot numeric(10,2);

do $$
begin
  if exists (select 1 from public.profiles where daily_wage < 0)
     or exists (select 1 from public.worker_projects where daily_wage < 0)
     or exists (select 1 from public.attendance where daily_wage_snapshot < 0) then
    raise exception 'Negative wage data found. Migration stopped; correct and audit wage records before continuing.';
  end if;
  if exists (
    select 1 from public.attendance a
    join public.projects p on p.id = a.project_id
    where a.daily_wage_snapshot is null and p.status <> 'active'
  ) then
    raise exception 'Closed-project attendance lacks a wage snapshot. Migration stopped; reconcile historical wages before continuing.';
  end if;
end;
$$;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_daily_wage_nonnegative'
  ) then
    alter table public.profiles add constraint profiles_daily_wage_nonnegative
      check (daily_wage >= 0) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.worker_projects'::regclass and conname = 'worker_projects_daily_wage_check'
  ) then
    alter table public.worker_projects add constraint worker_projects_daily_wage_check
      check (daily_wage is null or daily_wage >= 0) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.attendance'::regclass and conname = 'attendance_daily_wage_snapshot_check'
  ) then
    alter table public.attendance add constraint attendance_daily_wage_snapshot_check
      check (daily_wage_snapshot is null or daily_wage_snapshot >= 0) not valid;
  end if;
end $$;

-- Freeze any legacy attendance at the wage already used by the previous
-- project-aware model; subsequent changes use profiles.daily_wage only.
update public.attendance a
set daily_wage_snapshot = coalesce(
  (select wp.daily_wage
   from public.worker_projects wp
   where wp.worker_id = a.worker_id and wp.project_id = a.project_id
     and wp.daily_wage is not null
   limit 1),
  p.daily_wage,
  0
)
from public.profiles p
where p.id = a.worker_id and a.daily_wage_snapshot is null;

create table if not exists public.attendance_projects (
  attendance_id uuid not null references public.attendance(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (attendance_id, project_id)
);
create index if not exists idx_attendance_projects_project
  on public.attendance_projects(project_id, attendance_id);
comment on table public.attendance_projects is
  'Project/activity links for one daily attendance record; never a separate wage or balance.';

-- Preserve each previous single-project attendance as an activity link.
insert into public.attendance_projects (attendance_id, project_id)
select a.id, a.project_id
from public.attendance a
join public.projects p on p.id = a.project_id
where a.project_id is not null
on conflict (attendance_id, project_id) do nothing;

-- A worker can read project names attached to their historical attendance,
-- even when that project is no longer in their active assignment list.
drop policy if exists "projects read" on public.projects;
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

revoke insert, update, delete on table public.worker_projects from public, anon, authenticated;
grant select on table public.worker_projects to authenticated;
revoke insert, update, delete on table public.site_workers from public, anon, authenticated;
revoke insert, update on table public.attendance from public, anon, authenticated;
grant select, delete on table public.attendance to authenticated;

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
drop trigger if exists trg_guard_site_worker_assignment on public.site_workers;
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
  from public.withdrawals group by worker_id
) w on w.worker_id = p.id
left join (
  select worker_id, sum(amount) as deducted
  from public.deductions group by worker_id
) d on d.worker_id = p.id
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
  v_auto_limit numeric := 500;
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

  select coalesce(nullif(s.value->>'auto_approve_limit', '')::numeric, 500)
  into v_auto_limit from public.settings s where s.key = 'app';
  v_auto_limit := coalesce(v_auto_limit, 500);
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
     case when v_amount <= v_auto_limit then 'approved' else 'pending' end,
     case when v_amount <= v_auto_limit then auth.uid() else null end,
     case when v_amount <= v_auto_limit then now() else null end)
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
do $$
begin
  if to_regprocedure('public.register_attendance(uuid,date,uuid[],numeric,numeric,text,uuid)') is not null then
    execute 'revoke all on function public.register_attendance(uuid, date, uuid[], numeric, numeric, text, uuid) from public, anon, authenticated';
  end if;
  if to_regprocedure('public.add_attendance_site(uuid,uuid)') is not null then
    execute 'revoke all on function public.add_attendance_site(uuid, uuid) from public, anon, authenticated';
  end if;
end;
$$;
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


-- GPS is no longer collected. Preserve old attendance rows but reject coordinates on new rows.
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
update public.settings
set value = jsonb_set(
  case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end,
  '{gps_enabled}', 'false'::jsonb, true
), updated_at = now()
where key = 'app';

commit;
