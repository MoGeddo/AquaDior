-- Repair the global worker-settlement RPC on an existing Staging database.
-- Safe to re-run: it replaces only this function, not settlement data.
begin;

drop function if exists public.create_worker_settlement(uuid, uuid);

create function public.create_worker_settlement(
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

  if exists (
    select 1 from public.withdrawals w
    where w.worker_id = p_worker_id and w.status = 'pending'
  ) then
    raise exception 'احسم طلبات الصرف المعلّقة قبل تسوية رصيد العامل';
  end if;

  select max(coalesce(s.paid_at, s.created_at)) into v_since
  from public.settlements s
  where s.worker_id = p_worker_id
    and s.project_id is null
    and s.status = 'paid';
  v_since := coalesce(v_since, '-infinity'::timestamptz);

  select count(*)::integer, coalesce(sum(aw.wage), 0)
    into v_days, v_earned
  from public.attendance a
  join public.attendance_with_wage aw on aw.id = a.id
  where a.worker_id = p_worker_id and a.created_at > v_since;

  select coalesce(sum(w.amount), 0) into v_withdrawn
  from public.withdrawals w
  where w.worker_id = p_worker_id
    and w.status = 'approved'
    and w.created_at > v_since;

  -- Active deductions in this period reduce the payout. A previously paid
  -- deduction reversed after an earlier payout becomes a carry-forward credit.
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
  from public.worker_balances b
  where b.worker_id = p_worker_id;
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
notify pgrst, 'reload schema';
commit;

select pg_get_function_arguments('public.create_worker_settlement(uuid,uuid)'::regprocedure)
  as registered_parameters;
