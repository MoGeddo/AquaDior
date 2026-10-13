-- Worker cash requests must always wait for an owner/admin decision.
-- Apply to the STAGING Supabase project after reviewing this file.
-- Do not run against Production without separate approval.
-- Safe for existing financial records: no existing withdrawal is rewritten.

begin;

drop function if exists public.register_withdrawal(uuid, numeric, text);

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
  if p_request_id is null then
    raise exception 'رقم العملية مطلوب لإتمام الطلب بأمان';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'الملاحظة طويلة أكثر من اللازم';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount <= 0 or v_amount >= 100000000 then
    raise exception 'المبلغ بعد التقريب خارج الحدود المسموحة';
  end if;

  -- Serialize new requests with approvals, deductions, attendance and settlement.
  perform 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'worker'
    and p.status = 'active' and p.is_active = true
  for update;
  if not found then
    raise exception 'الحساب غير مفعّل';
  end if;

  select * into v_result
  from public.withdrawals w
  where w.client_request_id = p_request_id
  for update;
  if found then
    if v_result.worker_id <> auth.uid()
       or v_result.amount <> v_amount
       or v_result.project_id is not null then
      raise exception 'رقم العملية مستخدم لطلب مختلف';
    end if;
    return v_result;
  end if;

  -- Pending requests reserve available funds to prevent duplicate/over-limit
  -- requests, but do not reduce the posted balance until the owner approves.
  select coalesce(b.available, 0) into v_available
  from public.worker_balances b
  where b.worker_id = auth.uid();
  v_available := greatest(coalesce(v_available, 0), 0);
  if v_amount > v_available then
    raise exception 'المتاح من رصيدك العام % جنيه فقط', v_available;
  end if;

  insert into public.withdrawals
    (worker_id, project_id, amount, note, created_by, client_request_id,
     status, decided_by, decided_at)
  values
    (auth.uid(), null, v_amount, p_note, auth.uid(), p_request_id,
     'pending', null, null)
  returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.register_withdrawal(uuid, numeric, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.register_withdrawal(uuid, numeric, text, uuid, uuid)
  to authenticated;

-- This BEFORE trigger overrides legacy clients/functions too: every INSERT is
-- pending regardless of amount or the old auto_approve_limit setting.
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
  select full_name into v_name
  from public.profiles where id = new.worker_id;
  select value->>'currency' into v_currency
  from public.settings where key = 'app';
  if v_currency is null or length(v_currency) > 20 then
    v_currency := 'ج.م';
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.decided_at := null;
    new.decided_by := null;
    new.decision_note := null;
    perform public.notify_admins(
      'withdrawal_pending', 'طلب سحب جديد',
      coalesce(v_name, 'عامل') || ' طلب ' || new.amount || ' ' || v_currency
        || ' — بانتظار موافقة المالك',
      jsonb_build_object(
        'worker_id', new.worker_id,
        'amount', new.amount,
        'id', new.id,
        'status', new.status
      )
    );
    insert into public.notifications (user_id, type, title, body, data)
    values (
      new.worker_id,
      'withdrawal_new',
      'طلب السحب بانتظار موافقة المالك',
      'استلمنا طلبك بمبلغ ' || new.amount || ' ' || v_currency
        || '؛ لن يُخصم من رصيدك إلا بعد موافقة المالك',
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
      jsonb_build_object(
        'worker_id', new.worker_id,
        'amount', new.amount,
        'status', new.status,
        'id', new.id
      )
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
    values (
      new.worker_id,
      'withdrawal_decision',
      v_worker_title,
      v_worker_body,
      jsonb_build_object('withdrawal_id', new.id, 'amount', new.amount, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

revoke all on function public.notify_withdrawal() from public, anon, authenticated;
drop trigger if exists trg_notif_withdrawal on public.withdrawals;
create trigger trg_notif_withdrawal
  before insert or update on public.withdrawals
  for each row execute function public.notify_withdrawal();

-- Keep pending amounts out of the posted balance, while reserving them from
-- the next request's available balance until approved or rejected.
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
  coalesce(e.earned, 0) - coalesce(w.approved, 0)
    - coalesce(d.deducted, 0) - coalesce(st.paid, 0) as balance,
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

-- The old limit is no longer used; remove it from the app setting if present.
update public.settings
set value = coalesce(value, '{}'::jsonb) - 'auto_approve_limit'
where key = 'app' and value ? 'auto_approve_limit';

commit;
