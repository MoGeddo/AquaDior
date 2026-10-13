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

-- Keep automatic approval and admin alerts while notifying the worker both
-- when a request is created and when its status is decided.
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
  v_worker_title text;
  v_worker_body text;
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
      new.decided_by := null;
    end if;
    perform public.notify_admins(
      case when new.status = 'approved' then 'withdrawal_auto' else 'withdrawal_pending' end,
      case when new.status = 'approved' then 'صرف تلقائي' else 'مطلوب موافقة' end,
      coalesce(v_name, 'عامل') || ' طلب ' || new.amount || ' ' || v_currency,
      jsonb_build_object('worker_id', new.worker_id, 'amount', new.amount, 'id', new.id, 'status', new.status)
    );
    v_worker_title := case when new.status = 'approved' then 'تمت الموافقة على طلب السحب' else 'طلب السحب قيد المراجعة' end;
    v_worker_body := case when new.status = 'approved'
      then 'تمت الموافقة تلقائيًا على طلبك بمبلغ ' || new.amount || ' ' || v_currency
      else 'استلمنا طلبك بمبلغ ' || new.amount || ' ' || v_currency || '، وهو بانتظار قرار المالك' end;
    insert into public.notifications (user_id, type, title, body, data)
    values (new.worker_id,
      case when new.status = 'approved' then 'withdrawal_auto' else 'withdrawal_new' end,
      v_worker_title, v_worker_body,
      jsonb_build_object('withdrawal_id', new.id, 'amount', new.amount, 'status', new.status));
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
