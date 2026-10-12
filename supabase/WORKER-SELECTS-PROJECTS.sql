-- AquaDior: workers choose open projects when recording attendance.
-- Additive migration for an installation that already has the unified
-- attendance_projects model. Take a database backup and review the target first.
-- This file is not executed by the app and has not been applied remotely.
begin;

do $$
declare
  v_required text;
  v_table_name text;
  v_column_name text;
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.projects') is null
     or to_regclass('public.attendance') is null
     or to_regclass('public.attendance_projects') is null
     or to_regclass('public.withdrawals') is null
     or to_regclass('public.deductions') is null
     or to_regclass('public.settlements') is null
     or to_regclass('public.notifications') is null
     or to_regprocedure('public.notify_admins(text,text,text,jsonb)') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regprocedure('public.update_worker_details(uuid,text,text,numeric,boolean,uuid[])') is null then
    raise exception 'Unified attendance, payroll, or notification objects are missing; stop and review the target database before applying this migration.';
  end if;

  foreach v_required in array array[
    'profiles.id', 'profiles.role', 'profiles.status', 'profiles.is_active',
    'profiles.full_name', 'profiles.daily_wage',
    'projects.id', 'projects.name', 'projects.status', 'projects.address',
    'projects.description', 'projects.start_date', 'projects.closed_at',
    'projects.archived_at', 'projects.archived_by',
    'attendance.id', 'attendance.worker_id', 'attendance.project_id',
    'attendance.work_date', 'attendance.source', 'attendance.lat', 'attendance.lng',
    'attendance.note', 'attendance.daily_wage_snapshot', 'attendance.created_by',
    'attendance_projects.attendance_id', 'attendance_projects.project_id',
    'withdrawals.project_id', 'withdrawals.amount',
    'deductions.project_id', 'deductions.amount', 'deductions.voided_at',
    'settlements.project_id', 'settlements.net_amount',
    'notifications.user_id', 'notifications.type', 'notifications.title',
    'notifications.body', 'notifications.data'
  ] loop
    v_table_name := split_part(v_required, '.', 1);
    v_column_name := split_part(v_required, '.', 2);
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = v_table_name
        and column_name = v_column_name
    ) then
      raise exception 'Required unified schema column public.%.% is missing; migration stopped.',
        v_table_name, v_column_name;
    end if;
  end loop;
end;
$$;

-- Preserve every existing primary project as an activity link before any
-- worker can add several projects to the same daily attendance row.
insert into public.attendance_projects (attendance_id, project_id)
select a.id, a.project_id
from public.attendance a
join public.projects p on p.id = a.project_id
where a.project_id is not null
on conflict (attendance_id, project_id) do nothing;

-- Every active worker may read all open projects. Past attendance remains
-- readable for its worker; worker_projects is not used for availability.
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

-- Historical assignment tables are kept for reads/history only. Reject any
-- legacy SECURITY DEFINER RPC or direct DML that tries to create new assignments.
create or replace function public.reject_legacy_worker_project_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'تعيين المشاريع للعاملين متوقف؛ العامل يختار المشاريع المفتوحة عند تسجيل الحضور';
end;
$$;
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
revoke all on function public.reject_legacy_site_worker_assignment() from public, anon, authenticated;

-- Historical worker_projects rows are no longer assignments and must not
-- generate misleading per-worker assignment/unassignment notifications.
create or replace function public.notify_worker_project_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
do $$
begin
  if to_regclass('public.worker_projects') is not null then
    execute 'drop trigger if exists trg_notif_worker_projects on public.worker_projects';
    execute 'drop trigger if exists trg_guard_activity_worker_projects on public.worker_projects';
    execute 'drop trigger if exists trg_guard_worker_project_live on public.worker_projects';
    execute 'drop policy if exists "wp write" on public.worker_projects';
    execute 'revoke insert, update, delete on table public.worker_projects from public, anon, authenticated';
    execute 'grant select on table public.worker_projects to authenticated';
    execute 'alter table public.worker_projects enable row level security';
    execute 'drop policy if exists "wp read" on public.worker_projects';
    execute 'create policy "wp read" on public.worker_projects for select using (auth.uid() = worker_id or public.is_admin())';
    execute 'drop trigger if exists trg_reject_legacy_worker_project_assignment on public.worker_projects';
    execute 'create trigger trg_reject_legacy_worker_project_assignment before insert or update on public.worker_projects for each row execute function public.reject_legacy_worker_project_assignment()';
  end if;
  if to_regclass('public.site_workers') is not null then
    execute 'drop trigger if exists trg_guard_site_worker_assignment on public.site_workers';
    execute 'drop policy if exists "sw write" on public.site_workers';
    execute 'revoke insert, update, delete on table public.site_workers from public, anon, authenticated';
    execute 'grant select on table public.site_workers to authenticated';
    execute 'alter table public.site_workers enable row level security';
    execute 'drop policy if exists "sw read" on public.site_workers';
    execute 'create policy "sw read" on public.site_workers for select using (auth.uid() = worker_id or public.is_admin())';
    execute 'drop trigger if exists trg_reject_legacy_site_worker_assignment on public.site_workers';
    execute 'create trigger trg_reject_legacy_site_worker_assignment before insert or update on public.site_workers for each row execute function public.reject_legacy_site_worker_assignment()';
  end if;
  if to_regclass('public.sites') is not null then
    execute 'drop policy if exists "sites insert" on public.sites';
    execute 'drop policy if exists "sites update" on public.sites';
    execute 'revoke insert, update, delete on table public.sites from public, anon, authenticated';
  end if;
end;
$$;
revoke all on function public.notify_worker_project_assignment() from public, anon, authenticated;

-- Notify every active worker when a project is opened, not just legacy assignees.
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
revoke all on function public.notify_project_event() from public, anon, authenticated;
revoke all on function public.reject_legacy_worker_project_assignment() from public, anon, authenticated;
revoke all on function public.reject_legacy_site_worker_assignment() from public, anon, authenticated;

-- Do not let a legacy helper block active workers because their old assignment
-- rows point only at closed projects (or because they have no such rows).
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

-- Legacy availability helper now reports whether an active worker can see at
-- least one active project, without requiring a worker_projects row.
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

-- Snapshot one daily wage, never a project-specific wage or assignment.
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
    v_refresh_snapshot := new.daily_wage_snapshot is null;
  end if;
  if v_refresh_snapshot then
    select coalesce(p.daily_wage, 0) into v_daily_wage
    from public.profiles p where p.id = new.worker_id;
    new.daily_wage_snapshot := coalesce(v_daily_wage, 0);
  end if;
  if new.project_id is not null then
    perform 1 from public.projects
    where id = new.project_id and status = 'active'
    for share;
    if not found then raise exception 'المشروع مقفول؛ لا يمكن تعديل سجلاته المالية'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_snapshot_attendance_wage on public.attendance;
create trigger trg_snapshot_attendance_wage
  before insert or update on public.attendance
  for each row execute function public.snapshot_attendance_wage();

-- One daily attendance row per worker; its project links may contain any
-- number of active projects selected by the worker. GPS parameters remain in
-- the signature only for compatibility and are ignored; new coordinates are
-- always inserted as NULL.
create or replace function public.register_attendance_multi(
  p_worker_id uuid,
  p_work_date date,
  p_project_ids uuid[] default '{}'::uuid[],
  p_lat numeric default null,
  p_lng numeric default null,
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

-- Replace the worker create/approval RPCs as well: retain old optional
-- assignment parameters for PostgREST clients, but intentionally ignore them.
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


-- Keep the legacy RPC signature, but reject old site/project assignment arrays
-- and update only the worker profile fields.
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
    raise exception 'تعيين المواقع القديمة متوقف؛ العامل يختار المشروع/الموقع عند تسجيل الحضور';
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

-- Owner profile edits update worker details only. Keep the old named project
-- argument optional for PostgREST schema compatibility; do not create, delete,
-- or alter worker_projects assignments from this RPC.
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
  perform public.update_worker_details(
    p_worker_id, p_full_name, p_phone, p_daily_wage, p_is_active, null
  );
end;
$$;

-- Attendance no longer collects or accepts GPS. Keep historical rows intact,
-- but force NULL coordinates on every new insert.
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

-- Project archives count workers and days from attendance links, including
-- secondary project selections; worker_projects is not used for totals.
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
  (select coalesce(sum(wd.amount), 0)
   from public.withdrawals wd where wd.project_id = p.id) as total_withdrawn,
  (select coalesce(sum(d.amount), 0)
   from public.deductions d where d.project_id = p.id and d.voided_at is null) as total_deductions,
  (select coalesce(sum(s.net_amount), 0)
   from public.settlements s where s.project_id = p.id) as total_paid
from public.projects p
where p.status = 'closed'
order by p.closed_at desc;

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
        where exists (
          select 1 from public.attendance_projects ap
          join public.attendance a on a.id = ap.attendance_id
          where ap.project_id = p_project_id and a.worker_id = pr.id
        )
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

comment on table public.projects is
  'Canonical active project/worksite; workers choose one or more open projects when recording daily attendance.';

revoke all on function public.require_active_project(uuid) from public, anon, authenticated;
revoke all on function public.has_active_project(uuid) from public, anon, authenticated;
revoke all on function public.snapshot_attendance_wage() from public, anon, authenticated;
revoke all on function public.clear_new_attendance_gps() from public, anon, authenticated;
revoke all on function public.notify_project_event() from public, anon, authenticated;
revoke all on function public.register_attendance_multi(uuid, date, uuid[], numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.admin_register_attendance_multi(uuid, date, uuid[]) from public, anon, authenticated;
revoke all on function public.add_attendance_project(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_worker_admin_details(uuid, text, text, numeric, boolean, uuid[]) from public, anon, authenticated;
revoke all on function public.create_worker(text, text, text, numeric, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.approve_worker(uuid, numeric, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.update_worker_details(uuid, text, text, numeric, boolean, uuid[]) from public, anon, authenticated;
revoke all on function public.export_project_data(uuid) from public, anon, authenticated;
grant execute on function public.register_attendance_multi(uuid, date, uuid[], numeric, numeric, text) to authenticated;
grant execute on function public.admin_register_attendance_multi(uuid, date, uuid[]) to authenticated;
grant execute on function public.add_attendance_project(uuid, uuid) to authenticated;
grant execute on function public.save_worker_admin_details(uuid, text, text, numeric, boolean, uuid[]) to authenticated;
grant execute on function public.create_worker(text, text, text, numeric, uuid[], uuid) to authenticated;
grant execute on function public.approve_worker(uuid, numeric, uuid[], uuid) to authenticated;
grant execute on function public.update_worker_details(uuid, text, text, numeric, boolean, uuid[]) to authenticated;
grant execute on function public.export_project_data(uuid) to authenticated;
grant select on public.projects, public.project_archive to authenticated;
revoke all on public.project_archive from anon;

commit;
notify pgrst, 'reload schema';
