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

-- ---------- Withdrawal auto-approval + notifications ----------
create or replace function public.notify_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_name text;
  v_limit numeric := 0;
  v_limit_text text;
  v_currency text;
begin
  select full_name into v_name from public.profiles where id = new.worker_id;
  select value->>'auto_approve_limit', value->>'currency'
    into v_limit_text, v_currency
  from public.settings where key = 'app';
  if coalesce(v_limit_text, '') ~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' then
    v_limit := v_limit_text::numeric;
  end if;
  if v_limit < 0 or v_limit >= 100000000 then v_limit := 0; end if;
  if v_currency is null or length(v_currency) > 20 then v_currency := 'ج.م'; end if;

  if tg_op = 'INSERT' then
    if new.amount <= v_limit then
      new.status := 'approved';
      new.decided_at := now();
      new.decided_by := null; -- اعتماد آلي من النظام
    end if;
    perform public.notify_admins(
      case when new.status = 'approved' then 'withdrawal_auto' else 'withdrawal_pending' end,
      case when new.status = 'approved' then 'صرف تلقائي' else 'مطلوب موافقة' end,
      coalesce(v_name, 'عامل') || ' طلب ' || new.amount || ' ' || v_currency,
      jsonb_build_object('worker_id', new.worker_id, 'amount', new.amount, 'id', new.id)
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
      jsonb_build_object('worker_id', new.worker_id, 'amount', new.amount, 'status', new.status)
    );
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
  v_active_project_count integer;
  v_daily_wage numeric(10,2);
  v_refresh_snapshot boolean;
begin
  if new.project_id is null then
    select count(*) into v_active_project_count
    from public.worker_projects wp
    join public.projects p on p.id = wp.project_id
    where wp.worker_id = new.worker_id and p.status = 'active';
    if v_active_project_count = 1 then
      select wp.project_id into new.project_id
      from public.worker_projects wp
      join public.projects p on p.id = wp.project_id
      where wp.worker_id = new.worker_id and p.status = 'active'
      order by wp.joined_at desc limit 1;
    end if;
  end if;

  if tg_op = 'INSERT' then
    v_refresh_snapshot := true;
  else
    -- Assignment/link edits must never rewrite a historical daily wage.
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
-- Assignment changes affect future attendance only; they remain editable while the project is active.
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
create trigger trg_guard_worker_project_live
  before insert or update or delete on public.worker_projects
  for each row execute function public.guard_worker_project_live();

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
create trigger trg_guard_site_worker_assignment
  before insert or update or delete on public.site_workers
  for each row execute function public.guard_site_worker_assignment();

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
    select 1
    from public.worker_projects wp
    join public.projects p on p.id = wp.project_id
    where wp.worker_id = p_worker_id and p.status = 'active'
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
  if exists (select 1 from public.worker_projects where worker_id = p_worker_id)
     and not public.has_active_project(p_worker_id) then
    raise exception 'مفيش مشروع شغّال — تواصل مع المالك';
  end if;
end;
$$;
