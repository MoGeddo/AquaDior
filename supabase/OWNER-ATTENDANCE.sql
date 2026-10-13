-- سجل حضور مستقل للمالك؛ لا يدخل في أجور العمال أو أرصدتهم.
-- شغّل بعد schema.sql وpolicies.sql وtriggers.sql وfunctions.sql على Staging أولًا.
-- Migration additive/idempotent: لا تعدّل أو تحذف سجلات الحضور أو الحركات المالية.
begin;

create table if not exists public.owner_attendance (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete restrict,
  work_date  date not null,
  created_at timestamptz not null default now(),
  unique (owner_id, work_date)
);

create index if not exists idx_owner_attendance_owner_date
  on public.owner_attendance(owner_id, work_date desc);

comment on table public.owner_attendance is
  'تسجيل أيام حضور المالك في سجل مستقل لا يؤثر في أجور أو مستحقات العمال.';

alter table public.owner_attendance enable row level security;
drop policy if exists "owner attendance read self or admin" on public.owner_attendance;
create policy "owner attendance read self or admin"
  on public.owner_attendance for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- قراءة السجل فقط؛ الإضافة تتم حصريًا عبر RPC يتحقق من هوية المالك.
revoke all on table public.owner_attendance from public, anon, authenticated;
grant select on table public.owner_attendance to authenticated;

create or replace function public.register_owner_attendance()
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_owner_id uuid := auth.uid();
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_attendance_id uuid;
begin
  if v_owner_id is null then
    raise exception 'يجب تسجيل الدخول أولًا';
  end if;

  perform 1
  from public.profiles p
  where p.id = v_owner_id
    and p.role = 'owner'
    and p.status = 'active'
    and p.is_active = true
  for update;
  if not found then
    raise exception 'تسجيل الحضور متاح لحساب المالك النشط فقط';
  end if;

  insert into public.owner_attendance (owner_id, work_date)
  values (v_owner_id, v_today)
  on conflict (owner_id, work_date) do nothing
  returning id into v_attendance_id;

  if v_attendance_id is null then
    select oa.id into v_attendance_id
    from public.owner_attendance oa
    where oa.owner_id = v_owner_id and oa.work_date = v_today;
  end if;

  if v_attendance_id is null then
    raise exception 'تعذر تأكيد سجل حضور اليوم؛ حاول مرة أخرى';
  end if;
  return v_attendance_id;
end;
$$;

revoke all on function public.register_owner_attendance() from public, anon, authenticated;
grant execute on function public.register_owner_attendance() to authenticated;

drop trigger if exists trg_audit_owner_attendance on public.owner_attendance;
create trigger trg_audit_owner_attendance
  after insert or update or delete on public.owner_attendance
  for each row execute function public.log_audit();

commit;
