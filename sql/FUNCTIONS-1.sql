-- ============================================================
--  ██  FUNCTIONS 1/2 — الدوال الأساسية  ██
--  شغّل الملف ده الأول
-- ============================================================
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
