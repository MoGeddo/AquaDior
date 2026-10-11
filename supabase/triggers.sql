-- ============================================================
--  WORKER APP — TRIGGERS
--  1) تسجيل أي تعديل في audit_log
--  2) إشعار المالك والمديرين بأي تغيير
--  شغّل الملف ده بعد policies.sql
-- ============================================================

-- ---------- 1) AUDIT LOG ----------
create or replace function log_audit() returns trigger as $$
declare
  v_record_id text;
  v_old       jsonb;
  v_new       jsonb;
begin
  if (tg_op = 'DELETE') then
    v_record_id := (old.id)::text;
    v_old       := to_jsonb(old);
    v_new       := null;
  elsif (tg_op = 'UPDATE') then
    v_record_id := (new.id)::text;
    v_old       := to_jsonb(old);
    v_new       := to_jsonb(new);
  else
    v_record_id := (new.id)::text;
    v_old       := null;
    v_new       := to_jsonb(new);
  end if;

  insert into audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values (
    tg_table_name,
    v_record_id,
    lower(tg_op),
    v_old,
    v_new,
    auth.uid()
  );

  if (tg_op = 'DELETE') then return old; else return new; end if;
end;
$$ language plpgsql security definer;

-- تركيب الـ trigger على الجداول المهمة
drop trigger if exists trg_audit_profiles    on profiles;
drop trigger if exists trg_audit_attendance  on attendance;
drop trigger if exists trg_audit_withdrawals on withdrawals;
drop trigger if exists trg_audit_deductions  on deductions;
drop trigger if exists trg_audit_sites       on sites;
drop trigger if exists trg_audit_projects    on projects;

create trigger trg_audit_profiles    after insert or update or delete on profiles    for each row execute function log_audit();
create trigger trg_audit_attendance  after insert or update or delete on attendance  for each row execute function log_audit();
create trigger trg_audit_withdrawals after insert or update or delete on withdrawals for each row execute function log_audit();
create trigger trg_audit_deductions  after insert or update or delete on deductions  for each row execute function log_audit();
create trigger trg_audit_sites       after insert or update or delete on sites       for each row execute function log_audit();
create trigger trg_audit_projects    after insert or update or delete on projects    for each row execute function log_audit();

-- ---------- 1b) تسجيل ذاتي: أي مستخدم جديد يبقى "مستني تفعيل" ----------
create or replace function handle_new_user() returns trigger as $$
begin
  insert into profiles (id, full_name, phone, username, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'عامل جديد'),
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'username',
    coalesce(new.raw_user_meta_data->>'role', 'worker'),
    'pending'
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    phone     = excluded.phone,
    username  = excluded.username;

  -- إشعار المالك بطلب تسجيل جديد
  perform notify_admins(
    'registration_new',
    'طلب تسجيل جديد',
    coalesce(new.raw_user_meta_data->>'full_name', 'عامل') ||
      ' سجّل بياناته — مستني موافقتك',
    jsonb_build_object('worker_id', new.id)
  );

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- 1c) إشعار عند تفعيل/رفض حساب ----------
create or replace function notify_registration_decision() returns trigger as $$
begin
  if (old.status is distinct from new.status) then
    if (new.status = 'active' and old.status = 'pending') then
      insert into notifications (user_id, type, title, body, data)
      values (new.id, 'account_approved', 'تم تفعيل حسابك',
              'تقدر دلوقاني تسجّل حضورك وتاخد فلوك', '{}'::jsonb);
    elsif (new.status = 'rejected') then
      insert into notifications (user_id, type, title, body, data)
      values (new.id, 'account_rejected', 'تم رفض حسابك',
              coalesce(new.reject_reason, 'تواصل مع المالك'), '{}'::jsonb);
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notif_registration on profiles;
create trigger trg_notif_registration after update on profiles
  for each row execute function notify_registration_decision();

-- ---------- 2) NOTIFICATIONS ----------
-- دالة عامة: ابعت إشعار لكل المالك والمديرين
create or replace function notify_admins(
  p_type  text,
  p_title text,
  p_body  text,
  p_data  jsonb default '{}'::jsonb
) returns void as $$
begin
  insert into notifications (user_id, type, title, body, data)
  select id, p_type, p_title, p_body, p_data
  from profiles
  where role in ('owner','manager') and is_active;
end;
$$ language plpgsql security definer;

-- ---------- 2a) إشعار عند تسجيل حضور ----------
create or replace function notify_attendance() returns trigger as $$
declare
  v_name text;
  v_date text;
begin
  select full_name into v_name from profiles where id = new.worker_id;
  v_date := to_char(new.work_date, 'YYYY-MM-DD');

  if (tg_op = 'INSERT') then
    perform notify_admins(
      'attendance_new',
      'حضور جديد',
      v_name || ' سجّل حضوره يوم ' || v_date,
      jsonb_build_object('worker_id', new.worker_id, 'work_date', v_date)
    );
  elsif (tg_op = 'UPDATE') then
    perform notify_admins(
      'attendance_edit',
      'تعديل حضور ⚠️',
      v_name || ' عُدّل حضوره يوم ' || v_date,
      jsonb_build_object('worker_id', new.worker_id, 'work_date', v_date, 'old', to_jsonb(old), 'new', to_jsonb(new))
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notif_attendance on attendance;
create trigger trg_notif_attendance after insert or update on attendance
  for each row execute function notify_attendance();

-- ---------- 2b) إشعار عند أخذ فلوس ----------
create or replace function notify_withdrawal() returns trigger as $$
declare
  v_name  text;
  v_limit numeric;
begin
  select full_name into v_name from profiles where id = new.worker_id;
  select (value->>'auto_approve_limit')::numeric into v_limit from settings where key = 'app';

  if (tg_op = 'INSERT') then
    -- تحت السقف → يعدّي لوحده، وفوق السقف → يبقى pending وإشعار للمالك
    if (v_limit is not null and new.amount <= v_limit) then
      new.status := 'approved';
    end if;

    perform notify_admins(
      case when new.status = 'approved' then 'withdrawal_auto' else 'withdrawal_pending' end,
      case when new.status = 'approved' then 'فلوس اتسحبت' else 'مطلوب موافقة ⚠️' end,
      v_name || ' خد ' || new.amount || ' ج.م' ||
        case when new.status = 'approved' then ' (تحت السقف)' else ' — فوق السقف' end,
      jsonb_build_object('worker_id', new.worker_id, 'amount', new.amount, 'id', new.id)
    );
  elsif (tg_op = 'UPDATE' and old.status is distinct from new.status) then
    perform notify_admins(
      'withdrawal_decided',
      'قرار على طلب فلوس',
      v_name || ' — الطلب بقيمة ' || new.amount || ' ج.م بقى ' ||
        case new.status when 'approved' then 'موافق عليه' when 'rejected' then 'مرفوض' else 'معلّق' end,
      jsonb_build_object('worker_id', new.worker_id, 'amount', new.amount, 'status', new.status)
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notif_withdrawal on withdrawals;
create trigger trg_notif_withdrawal before insert or update on withdrawals
  for each row execute function notify_withdrawal();

-- ---------- 2c) إشعار عند خصم ----------
create or replace function notify_deduction() returns trigger as $$
declare
  v_name text;
begin
  select full_name into v_name from profiles where id = new.worker_id;
  perform notify_admins(
    'deduction_new',
    'خصم جديد',
    v_name || ' — خصم ' || new.amount || ' ج.م: ' || new.reason,
    jsonb_build_object('worker_id', new.worker_id, 'amount', new.amount, 'reason', new.reason)
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notif_deduction on deductions;
create trigger trg_notif_deduction after insert on deductions
  for each row execute function notify_deduction();

-- ---------- 3) تحديث updated_at تلقائياً ----------
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_profiles on profiles;
create trigger trg_touch_profiles before update on profiles
  for each row execute function touch_updated_at();

-- ============================================================
--  4) قفل المشروع — بياناته تت archival مش تتمسح
-- ============================================================
create or replace function close_project(p_project_id uuid)
returns void as $$
declare
  r record;
begin
  if not exists (select 1 from projects where id = p_project_id and status = 'active') then
    raise exception 'المشروع مقفول خلاص أو مش موجود';
  end if;

  -- 1) توليد تسويات كل العمال (بيانات جديدة، مفيش مسح)
  for r in
    select
      b.worker_id, b.days_worked, b.daily_wage, b.earned,
      b.withdrawn_approved, b.deducted, b.balance
    from worker_balances b
    where b.worker_id in (
      select worker_id from worker_projects where project_id = p_project_id
    )
  loop
    insert into settlements (
      worker_id, project_id, days_worked, daily_wage,
      total_earned, total_withdrawn, total_deductions, net_amount
    ) values (
      r.worker_id, p_project_id, r.days_worked, r.daily_wage,
      r.earned, r.withdrawn_approved, r.deducted, r.balance
    )
    on conflict (worker_id, project_id) do update set
      days_worked      = excluded.days_worked,
      daily_wage       = excluded.daily_wage,
      total_earned     = excluded.total_earned,
      total_withdrawn  = excluded.total_withdrawn,
      total_deductions = excluded.total_deductions,
      net_amount       = excluded.net_amount;
  end loop;

  -- 2) اقفل المشروع — البيانات كلها بتفضل زي ما هي
  update projects
  set status     = 'closed',
      closed_at  = now(),
      archived_at = now(),
      archived_by = auth.uid()
  where id = p_project_id;

  -- 3) سجّل القفل في سجل التعديلات
  insert into audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values (
    'projects', p_project_id::text, 'update',
    jsonb_build_object('status', 'active'),
    jsonb_build_object('status', 'closed', 'archived_at', now()),
    auth.uid()
  );
end;
$$ language plpgsql security definer;

-- ============================================================
--  5) منع التسجيل في مشروع مقفول
-- ============================================================
create or replace function has_active_project(p_worker_id uuid)
returns boolean as $$
  select exists (
    select 1
    from worker_projects wp
    join projects p on p.id = wp.project_id
    where wp.worker_id = p_worker_id
      and p.status = 'active'
  );
$$ language sql stable;

create or replace function require_active_project(p_worker_id uuid)
returns void as $$
begin
  -- لو عنده مشاريع بس كلها مقفولة → ارفض
  if exists (select 1 from worker_projects where worker_id = p_worker_id)
     and not has_active_project(p_worker_id) then
    raise exception 'مفيش مشروع شغّال — تواصل مع المالك';
  end if;
end;
$$ language plpgsql security definer;
