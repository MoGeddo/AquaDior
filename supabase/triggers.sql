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
drop trigger if exists trg_audit_owner_attendance on public.owner_attendance;
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
create trigger trg_audit_owner_attendance after insert or update or delete on public.owner_attendance
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
