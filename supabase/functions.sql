-- ============================================================
--  WORKER APP — RPC FUNCTIONS
--  شغّل الملف ده بعد triggers.sql
--  الدوال دي بتضمن القواعد جوه الداتابيز نفسها
-- ============================================================

-- ---------- تسجيل حضور (يوم واحد + أكتر من موقع) ----------
create or replace function register_attendance(
  p_worker_id  uuid,
  p_work_date  date,
  p_site_ids   uuid[] default null,
  p_lat        numeric default null,
  p_lng        numeric default null,
  p_note       text default null
) returns uuid as $$
declare
  v_id uuid;
begin
  -- ممنوع التسجيل في مشروع مقفول
  perform require_active_project(p_worker_id);

  insert into attendance (worker_id, work_date, source, lat, lng, note, created_by)
  values (p_worker_id, p_work_date, 'worker', p_lat, p_lng, p_note, p_worker_id)
  on conflict (worker_id, work_date) do update set
    lat      = coalesce(excluded.lat, attendance.lat),
    lng      = coalesce(excluded.lng, attendance.lng),
    note     = coalesce(p_note, attendance.note)
  returning id into v_id;

  -- استبدال المواقع المختارة
  delete from attendance_sites where attendance_id = v_id;

  if p_site_ids is not null and array_length(p_site_ids, 1) > 0 then
    insert into attendance_sites (attendance_id, site_id)
    select v_id, unnest(p_site_ids);
  end if;

  return v_id;
end;
$$ language plpgsql security definer;

-- ---------- أخذ فلوس (بيتأكد إنه مش هياخد أكتر من استحقاقه) ----------
create or replace function register_withdrawal(
  p_worker_id uuid,
  p_amount    numeric,
  p_note      text default null
) returns withdrawals as $$
declare
  v_result     withdrawals;
  v_available  numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'المبلغ لازم يكون أكبر من صفر';
  end if;

  select coalesce(earned, 0)
       - coalesce(withdrawn_approved, 0)
       - coalesce(withdrawn_pending, 0)
       - coalesce(deducted, 0)
    into v_available
  from worker_balances
  where worker_id = p_worker_id;

  v_available := coalesce(v_available, 0);

  -- ممنوع أخذ فلوس في مشروع مقفول
  perform require_active_project(p_worker_id);

  if p_amount > v_available then
    raise exception 'مش هتاخد أكتر من اللي اشتغلته — متاح تاخد % جنيه', v_available;
  end if;

  insert into withdrawals (worker_id, amount, note, created_by)
  values (p_worker_id, p_amount, p_note, p_worker_id)
  returning * into v_result;

  return v_result;
end;
$$ language plpgsql security definer;

-- ---------- إضافة موقع على يوم متسجّل (العامل راح مكان تاني بعد كده) ----------
create or replace function add_attendance_site(p_attendance_id uuid, p_site_id uuid)
returns void as $$
begin
  insert into attendance_sites (attendance_id, site_id)
  values (p_attendance_id, p_site_id)
  on conflict (attendance_id, site_id) do nothing;
end;
$$ language plpgsql security definer;

-- ---------- إضافة عامل جديد (بيعمل حساب + بروفايل) ----------
create or replace function create_worker(
  p_full_name  text,
  p_phone      text,
  p_password   text,
  p_daily_wage numeric default 0,
  p_site_ids   uuid[] default null,
  p_project_id uuid default null
) returns uuid as $$
declare
  v_user_id uuid;
  v_email   text;
begin
  v_email := regexp_replace(p_phone, '\D', '', 'g') || '@ommal.app';

  -- إنشاء مستخدم في auth
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    v_email,
    crypt(p_password, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name, 'role', 'worker')
  )
  returning id into v_user_id;

  -- البروفايل (الtrigger handle_new_user بيعمل صف pending، فأحنا بنحدّثه)
  insert into profiles (id, full_name, phone, role, daily_wage, username, status)
  values (v_user_id, p_full_name, p_phone, 'worker', p_daily_wage,
          regexp_replace(p_phone, '\D', '', 'g'), 'active')
  on conflict (id) do update set
    full_name  = excluded.full_name,
    phone      = excluded.phone,
    role       = excluded.role,
    daily_wage = excluded.daily_wage,
    username   = excluded.username,
    status     = 'active';

  -- ربطه بالمواقع
  if p_site_ids is not null and array_length(p_site_ids, 1) > 0 then
    insert into site_workers (site_id, worker_id)
    select unnest(p_site_ids), v_user_id
    on conflict do nothing;
  end if;

  -- ربطه بالمشروع
  if p_project_id is not null then
    insert into worker_projects (worker_id, project_id, daily_wage)
    values (v_user_id, p_project_id, p_daily_wage)
    on conflict do nothing;
  end if;

  return v_user_id;
end;
$$ language plpgsql security definer;

-- ---------- إعادة تعيين كلمة سر عامل ----------
create or replace function reset_worker_password(p_worker_id uuid, p_password text)
returns void as $$
begin
  update auth.users
  set encrypted_password = crypt(p_password, gen_salt('bf')),
      updated_at = now()
  where id = p_worker_id;
end;
$$ language plpgsql security definer;

-- ============================================================
--  التسجيل الذاتي والتفعيل
-- ============================================================

-- العامل بيسجّل بنفسه: موبايل + اسم + يوزر نيم + باسورد
-- الصورة بتترفع على Supabase Storage من التطبيق
create or replace function signup_worker(
  p_phone      text,
  p_full_name  text,
  p_username   text,
  p_password   text,
  p_id_card_path text default null
) returns uuid as $$
declare
  v_user_id uuid;
  v_email   text;
  v_clean   text;
begin
  v_clean := regexp_replace(p_phone, '\D', '', 'g');

  if length(v_clean) < 10 then
    raise exception 'رقم الموبايل مش صحيح';
  end if;
  if p_full_name is null or length(trim(p_full_name)) < 3 then
    raise exception 'اكتب الاسم بالكامل زي ما هو في البطاقة';
  end if;
  if p_username is null or length(trim(p_username)) < 3 then
    raise exception 'اسم المستخدم 3 حروف على الأقل';
  end if;
  if p_password is null or length(p_password) < 4 then
    raise exception 'كلمة السر 4 حروف على الأقل';
  end if;

  -- لو الرقم مسجّل قبل كده
  if exists (select 1 from profiles where phone = v_clean) then
    raise exception 'الرقم ده مسجّل قبل كده — سجّل دخول بدل التسجيل';
  end if;
  if exists (select 1 from profiles where username = lower(trim(p_username))) then
    raise exception 'اسم المستخدم ده محجوز — اختار غيره';
  end if;

  v_email := lower(trim(p_username)) || '@ommal.app';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    v_email,
    crypt(p_password, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'full_name', trim(p_full_name),
      'phone', v_clean,
      'username', lower(trim(p_username)),
      'role', 'worker'
    )
  )
  returning id into v_user_id;

  -- الـ trigger handle_new_user بيعمل صف pending، وأحنا بنحدّث المسار بتاع الصورة
  update profiles
  set id_card_url = p_id_card_path
  where id = v_user_id;

  return v_user_id;
end;
$$ language plpgsql security definer;

-- المالك/المدير يفعّل حساب عامل
create or replace function approve_worker(
  p_worker_id  uuid,
  p_daily_wage numeric default 0,
  p_site_ids   uuid[] default null,
  p_project_id uuid default null
) returns void as $$
begin
  update profiles
  set status      = 'active',
      approved_by = auth.uid(),
      approved_at = now(),
      reject_reason = null,
      daily_wage  = coalesce(p_daily_wage, daily_wage),
      is_active   = true
  where id = p_worker_id;

  if p_site_ids is not null and array_length(p_site_ids, 1) > 0 then
    insert into site_workers (site_id, worker_id)
    select unnest(p_site_ids), p_worker_id
    on conflict do nothing;
  end if;

  if p_project_id is not null then
    insert into worker_projects (worker_id, project_id, daily_wage)
    values (p_worker_id, p_project_id, p_daily_wage)
    on conflict (worker_id, project_id) do nothing;
  end if;
end;
$$ language plpgsql security definer;

-- رفض حساب
create or replace function reject_worker(p_worker_id uuid, p_reason text default null)
returns void as $$
begin
  update profiles
  set status = 'rejected',
      reject_reason = p_reason,
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_worker_id;
end;
$$ language plpgsql security definer;

-- ============================================================
--  أدوات المطوّر (يوزر MostafaGeddo)
-- ============================================================

-- تعديل أي يوزر (الاسم، اسم المستخدم، الدور، الحالة، اليومية)
create or replace function admin_update_user(
  p_user_id     uuid,
  p_full_name   text default null,
  p_username    text default null,
  p_role        text default null,
  p_status      text default null,
  p_daily_wage  numeric default null,
  p_is_active   boolean default null
) returns void as $$
begin
  if not is_developer() then
    raise exception 'مش مسموح — ده للمطوّر بس';
  end if;

  update profiles set
    full_name  = coalesce(nullif(trim(p_full_name), ''), full_name),
    username   = coalesce(nullif(trim(p_username), ''), username),
    role       = coalesce(p_role, role),
    status     = coalesce(p_status, status),
    daily_wage = coalesce(p_daily_wage, daily_wage),
    is_active  = coalesce(p_is_active, is_active),
    updated_at = now()
  where id = p_user_id;
end;
$$ language plpgsql security definer;

-- إحصائيات النظام (للتشخيص)
create or replace function system_stats() returns jsonb as $$
begin
  return (
    select jsonb_build_object(
      'workers',      (select count(*) from profiles where role = 'worker'),
      'admins',       (select count(*) from profiles where role in ('owner','manager','developer')),
      'pending',      (select count(*) from profiles where status = 'pending'),
      'attendance',   (select count(*) from attendance),
      'withdrawals',  (select count(*) from withdrawals),
      'deductions',   (select count(*) from deductions),
      'audit',        (select count(*) from audit_log),
      'notifications',(select count(*) from notifications),
      'settlements',  (select count(*) from settlements)
    )
  );
end;
$$ language plpgsql security definer;

-- كل المستخدمين مع تفاصيلهم (للمطوّر)
create or replace view admin_users as
select
  p.id,
  p.full_name,
  p.phone,
  p.username,
  p.role,
  p.status,
  p.is_active,
  p.daily_wage,
  p.created_at,
  (select count(*) from attendance a where a.worker_id = p.id) as days_worked,
  (select coalesce(sum(amount),0) from withdrawals w where w.worker_id = p.id) as withdrawn,
  (select count(*) from audit_log l where l.changed_by = p.id) as edits_made
from profiles p
order by p.created_at desc;

-- ============================================================
--  تصدير كل بيانات المشروع (للأرشيف — البيانات متتمسحش)
-- ============================================================
create or replace function export_project_data(p_project_id uuid)
returns jsonb as $$
declare
  v jsonb;
begin
  if not is_admin() then
    raise exception 'مش مسموح — للمالك أو المطوّر بس';
  end if;

  select jsonb_build_object(
    'project', (
      select jsonb_build_object(
        'id', p.id, 'name', p.name, 'description', p.description,
        'status', p.status, 'start_date', p.start_date, 'end_date', p.end_date,
        'closed_at', p.closed_at, 'archived_at', p.archived_at,
        'archived_by', p.archived_by,
        'archived_by_name', (select full_name from profiles pr where pr.id = p.archived_by)
      ) from projects p where p.id = p_project_id
    ),
    'workers', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select pr.id, pr.full_name, pr.phone, pr.username,
               pr.daily_wage, wp.daily_wage as project_daily_wage
        from worker_projects wp
        join profiles pr on pr.id = wp.worker_id
        where wp.project_id = p_project_id
      ) t
    ),
    'attendance', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select a.work_date, pr.full_name, aw.wage as daily_wage, a.source, a.created_at
        from attendance a
        join profiles pr on pr.id = a.worker_id
        left join attendance_with_wage aw on aw.id = a.id
        where a.project_id = p_project_id
        order by a.work_date, pr.full_name
      ) t
    ),
    'withdrawals', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select wd.created_at, pr.full_name, wd.amount, wd.note, wd.status
        from withdrawals wd
        join profiles pr on pr.id = wd.worker_id
        where wd.project_id = p_project_id
        order by wd.created_at
      ) t
    ),
    'deductions', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select d.created_at, pr.full_name, d.amount, d.reason
        from deductions d
        join profiles pr on pr.id = d.worker_id
        where d.project_id = p_project_id
        order by d.created_at
      ) t
    ),
    'settlements', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select pr.full_name, s.days_worked, s.daily_wage, s.total_earned,
               s.total_withdrawn, s.total_deductions, s.net_amount, s.status, s.paid_at
        from settlements s
        join profiles pr on pr.id = s.worker_id
        where s.project_id = p_project_id
        order by pr.full_name
      ) t
    )
  ) into v;

  return v;
end;
$$ language plpgsql security definer;

-- ============================================================
--  ملخص الأرشيف — كل المشاريع المقفولة وبياناتها
-- ============================================================
create or replace view project_archive as
select
  p.id            as project_id,
  p.name          as project_name,
  p.start_date,
  p.closed_at,
  p.archived_at,
  (select full_name from profiles pr where pr.id = p.archived_by) as archived_by_name,
  (select count(*) from worker_projects wp where wp.project_id = p.id) as workers_count,
  (select count(*) from attendance a where a.project_id = p.id)         as attendance_count,
  (select coalesce(sum(amount),0) from withdrawals wd where wd.project_id = p.id) as total_withdrawn,
  (select coalesce(sum(amount),0) from deductions d where d.project_id = p.id)    as total_deductions,
  (select coalesce(sum(net_amount),0) from settlements s where s.project_id = p.id) as total_paid
from projects p
where p.status = 'closed'
order by p.closed_at desc;
