-- ============================================================
--  ██  WORKER APP — DATABASE SETUP (ملف واحد)  ██
--  شغّل الملف ده مرة واحدة في Supabase → SQL Editor
-- ============================================================


-- ============================================================
--  ██  SCHEMA (الجداول)  ██
-- ============================================================
-- ============================================================
--  WORKER APP — SCHEMA
--  تطبيق حضور ومصاريف العمال
--  شغّل الملف ده في Supabase → SQL Editor
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- 1. PROFILES (كل المستخدمين) ----------
create table if not exists profiles (
  id            uuid primary key references auth.users on delete cascade,
  full_name     text not null,
  phone         text unique,
  username      text unique,
  role          text not null default 'worker' check (role in ('owner','manager','developer','worker')),
  daily_wage    numeric(10,2) not null default 0,
  default_site_id uuid,
  is_active     boolean not null default true,
  -- ===== حقول التسجيل الأولى =====
  status        text not null default 'active'
                  check (status in ('pending','active','rejected','suspended')),
  id_card_url   text,                 -- صورة البطاقة (Supabase Storage)
  approved_by   uuid references profiles(id),
  approved_at   timestamptz,
  reject_reason text,
  -- ===================================
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_profiles_status on profiles(status) where status = 'pending';

-- ---------- Storage: صور البطاقات ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('id-cards', 'id-cards', false, 5242880)
on conflict (id) do nothing;

-- ---------- 2. PROJECTS (المشاريع) ----------
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  status      text not null default 'active' check (status in ('active','closed')),
  start_date  date,
  end_date    date,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,
  -- الأرشيف: المشروع يتقفل بس بياناته تفضل في الداتابيز للأبد
  archived_at timestamptz,
  archived_by uuid references profiles(id)
);

-- ---------- 3. SITES (المواقع) ----------
create table if not exists sites (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  name       text not null,
  address    text,
  lat        numeric(10,7),
  lng        numeric(10,7),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table profiles
  drop constraint if exists profiles_default_site_fkey;
alter table profiles
  add constraint profiles_default_site_fkey
  foreign key (default_site_id) references sites(id) on delete set null;

-- ---------- 4. WORKER-PROJECTS (اليومية ممكن تختلف بين المشاريع) ----------
create table if not exists worker_projects (
  id         uuid primary key default gen_random_uuid(),
  worker_id  uuid not null references profiles(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  daily_wage numeric(10,2),                     -- لو فاضي → profiles.daily_wage
  joined_at  timestamptz not null default now(),
  unique (worker_id, project_id)
);

-- ---------- 5. SITE-WORKERS (العمال المرتبطين بموقع) ----------
create table if not exists site_workers (
  site_id     uuid references sites(id) on delete cascade,
  worker_id   uuid references profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (site_id, worker_id)
);

-- ---------- 6. ATTENDANCE (الحضور — سجل واحد لليوم) ----------
create table if not exists attendance (
  id         uuid primary key default gen_random_uuid(),
  worker_id  uuid not null references profiles(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  work_date  date not null default current_date,
  source     text not null default 'worker' check (source in ('worker','admin')),
  lat        numeric(10,7),
  lng        numeric(10,7),
  note       text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (worker_id, work_date)
);
create index if not exists idx_attendance_worker_date on attendance(worker_id, work_date desc);

-- ---------- 7. ATTENDANCE-SITES (أكتر من موقع في نفس اليوم = يومية واحدة) ----------
create table if not exists attendance_sites (
  id            uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references attendance(id) on delete cascade,
  site_id       uuid not null references sites(id) on delete cascade,
  unique (attendance_id, site_id)
);

-- ---------- 8. WITHDRAWALS (الفلوس اللي العمال خدوها) ----------
create table if not exists withdrawals (
  id            uuid primary key default gen_random_uuid(),
  worker_id     uuid not null references profiles(id) on delete cascade,
  project_id    uuid references projects(id) on delete set null,
  amount        numeric(10,2) not null check (amount > 0),
  note          text,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by    uuid references profiles(id),
  decided_at    timestamptz,
  decision_note text,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_withdrawals_worker on withdrawals(worker_id, created_at desc);
create index if not exists idx_withdrawals_status on withdrawals(status) where status = 'pending';

-- ---------- 9. DEDUCTIONS (خصومات يدوية) ----------
create table if not exists deductions (
  id         uuid primary key default gen_random_uuid(),
  worker_id  uuid not null references profiles(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  amount     numeric(10,2) not null check (amount <> 0),
  reason     text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- 10. SETTLEMENTS (تسوية نهاية المشروع) ----------
create table if not exists settlements (
  id               uuid primary key default gen_random_uuid(),
  worker_id        uuid not null references profiles(id) on delete cascade,
  project_id       uuid references projects(id) on delete cascade,
  days_worked      int not null default 0,
  daily_wage       numeric(10,2) not null default 0,
  total_earned     numeric(10,2) not null default 0,
  total_withdrawn  numeric(10,2) not null default 0,
  total_deductions numeric(10,2) not null default 0,
  net_amount       numeric(10,2) not null default 0,
  status           text not null default 'draft' check (status in ('draft','confirmed','paid')),
  worker_ack_at    timestamptz,
  confirmed_by     uuid references profiles(id),
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),
  unique (worker_id, project_id)
);

-- ---------- 11. AUDIT LOG (سجل التعديلات) ----------
create table if not exists audit_log (
  id         bigserial primary key,
  table_name text not null,
  record_id  text,
  action     text not null check (action in ('insert','update','delete')),
  old_data   jsonb,
  new_data   jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists idx_audit_time on audit_log(changed_at desc);

-- ---------- 12. NOTIFICATIONS (إشعارات جوه الأبليكيشن) ----------
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  data       jsonb,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_user on notifications(user_id, created_at desc);

-- ---------- 13. SETTINGS (إعدادات التطبيق) ----------
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into settings (key, value) values
  ('app',      '{"auto_approve_limit":500,"absence_deduction":50,"day_lock_time":"00:00","gps_enabled":true,"currency":"ج.م"}'::jsonb),
  ('telegram', '{"bot_token":"","chat_id":""}'::jsonb)
on conflict (key) do nothing;

-- ============================================================
--  VIEWS — الحسابات
-- ============================================================

-- أجر كل يوم حضور (اليومية ممكن تكون مختلفة حسب المشروع)
create or replace view attendance_with_wage as
select
  a.id,
  a.worker_id,
  a.project_id,
  a.work_date,
  coalesce(wp.daily_wage, p.daily_wage, 0) as wage
from attendance a
join profiles p on p.id = a.worker_id
left join lateral (
  select w.daily_wage
  from worker_projects w
  where w.worker_id = a.worker_id
    and w.project_id = a.project_id
    and w.daily_wage is not null
  limit 1
) wp on true;

-- رصيد كل عامل (المعادلة الأساسية)
create or replace view worker_balances as
select
  p.id                                        as worker_id,
  p.full_name,
  p.phone,
  p.role,
  p.daily_wage,
  p.is_active,
  coalesce(e.days_worked, 0)::int             as days_worked,
  coalesce(e.earned, 0)                       as earned,
  coalesce(w.approved, 0)                     as withdrawn_approved,
  coalesce(w.pending, 0)                      as withdrawn_pending,
  coalesce(d.deducted, 0)                     as deducted,
  -- الرصيد الحقيقي (المعتمد بس)
  coalesce(e.earned, 0)
    - coalesce(w.approved, 0)
    - coalesce(d.deducted, 0)                 as balance,
  -- المتاح للأخذ (بنستقعد المعلّق كمان عشان مايكدسش طلبات)
  coalesce(e.earned, 0)
    - coalesce(w.approved, 0)
    - coalesce(w.pending, 0)
    - coalesce(d.deducted, 0)                 as available
from profiles p
left join (
  select worker_id, count(*) as days_worked, sum(wage) as earned
  from attendance_with_wage group by worker_id
) e on e.worker_id = p.id
left join (
  select worker_id,
         sum(amount) filter (where status = 'approved') as approved,
         sum(amount) filter (where status = 'pending')  as pending
  from withdrawals group by worker_id
) w on w.worker_id = p.id
left join (
  select worker_id, sum(amount) as deducted
  from deductions group by worker_id
) d on d.worker_id = p.id
where p.role = 'worker';

-- ملخص يومي (للداشبورد)
create or replace view daily_summary as
select
  current_date                                            as day,
  (select count(*) from profiles where role='worker' and is_active) as total_workers,
  (select count(distinct worker_id) from attendance where work_date = current_date) as present_today,
  (select count(*) from profiles where role='worker' and is_active
     and id not in (select worker_id from attendance where work_date = current_date)) as absent_today,
  (select coalesce(sum(amount),0) from withdrawals where created_at::date = current_date) as withdrawn_today,
  (select coalesce(sum(wage),0) from attendance_with_wage where work_date = current_date) as earned_today;

-- ============================================================
--  ██  POLICIES (الصلاحيات)  ██
-- ============================================================
-- ============================================================
--  WORKER APP — ROW LEVEL SECURITY
--  شغّل الملف ده بعد schema.sql
-- ============================================================

-- دالة مساعدة: هل المستخدم الحالي مالك أو مدير أو مطوّر؟
create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('owner','manager','developer')
  );
$$ language sql security definer stable;

-- دالة: هل المستخدم هو المطوّر؟ (بيقدر يعدّل أي يوزر)
create or replace function is_developer()
returns boolean as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'developer'
  );
$$ language sql security definer stable;

-- ---------- PROFILES ----------
alter table profiles enable row level security;

drop policy if exists "own profile read"   on profiles;
drop policy if exists "admin read all"     on profiles;
drop policy if exists "own profile update" on profiles;
drop policy if exists "admin update all"   on profiles;
drop policy if exists "admin insert"       on profiles;
drop policy if exists "admin delete"       on profiles;

create policy "own profile read"   on profiles for select using (auth.uid() = id);
create policy "admin read all"     on profiles for select using (is_admin());
create policy "own profile update" on profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "admin update all"   on profiles for update using (is_admin());
create policy "admin insert"       on profiles for insert with check (is_admin() or auth.uid() = id);
create policy "admin delete"       on profiles for delete using (is_admin());

-- ---------- PROJECTS ----------
alter table projects enable row level security;

drop policy if exists "projects read"      on projects;
drop policy if exists "projects insert"    on projects;
drop policy if exists "projects update"    on projects;
drop policy if exists "projects delete"    on projects;

create policy "projects read"   on projects for select using (auth.uid() is not null);
create policy "projects insert" on projects for insert with check (is_admin());
create policy "projects update" on projects for update using (is_admin());
create policy "projects delete" on projects for delete using (is_admin());

-- ---------- SITES ----------
alter table sites enable row level security;

drop policy if exists "sites read"   on sites;
drop policy if exists "sites write"  on sites;

create policy "sites read"  on sites for select using (auth.uid() is not null);
create policy "sites write" on sites for all    using (is_admin()) with check (is_admin());

-- ---------- WORKER_PROJECTS ----------
alter table worker_projects enable row level security;

drop policy if exists "wp read"  on worker_projects;
drop policy if exists "wp write" on worker_projects;

create policy "wp read"  on worker_projects for select using (auth.uid() = worker_id or is_admin());
create policy "wp write" on worker_projects for all    using (is_admin()) with check (is_admin());

-- ---------- SITE_WORKERS ----------
alter table site_workers enable row level security;

drop policy if exists "sw read"  on site_workers;
drop policy if exists "sw write" on site_workers;

create policy "sw read"  on site_workers for select using (auth.uid() = worker_id or is_admin());
create policy "sw write" on site_workers for all    using (is_admin()) with check (is_admin());

-- ---------- ATTENDANCE ----------
alter table attendance enable row level security;

drop policy if exists "att own read"   on attendance;
drop policy if exists "att admin read" on attendance;
drop policy if exists "att own insert" on attendance;
drop policy if exists "att admin all"  on attendance;
drop policy if exists "att own update" on attendance;
drop policy if exists "att own delete" on attendance;

create policy "att own read"   on attendance for select using (auth.uid() = worker_id);
create policy "att admin read" on attendance for select using (is_admin());
-- العامل يسجّل حضوره بنفسه
create policy "att own insert" on attendance for insert with check (auth.uid() = worker_id and auth.uid() = created_by);
-- العامل يعدّل في نفس اليوم بس
create policy "att own update" on attendance for update
  using (auth.uid() = worker_id and work_date = current_date)
  with check (auth.uid() = worker_id and work_date = current_date);
create policy "att own delete" on attendance for delete
  using (auth.uid() = worker_id and work_date = current_date);
-- المالك والمدير: كل حاجة
create policy "att admin all"  on attendance for all using (is_admin()) with check (is_admin());

-- ---------- ATTENDANCE_SITES ----------
alter table attendance_sites enable row level security;

drop policy if exists "asites own"  on attendance_sites;
drop policy if exists "asites admin" on attendance_sites;

create policy "asites own"  on attendance_sites for all
  using (exists (select 1 from attendance a where a.id = attendance_id and a.worker_id = auth.uid()))
  with check (exists (select 1 from attendance a where a.id = attendance_id and a.worker_id = auth.uid()));
create policy "asites admin" on attendance_sites for all using (is_admin()) with check (is_admin());

-- ---------- WITHDRAWALS ----------
alter table withdrawals enable row level security;

drop policy if exists "wd own read"   on withdrawals;
drop policy if exists "wd admin read" on withdrawals;
drop policy if exists "wd own insert" on withdrawals;
drop policy if exists "wd admin all"  on withdrawals;

create policy "wd own read"   on withdrawals for select using (auth.uid() = worker_id);
create policy "wd admin read" on withdrawals for select using (is_admin());
create policy "wd own insert" on withdrawals for insert
  with check (auth.uid() = worker_id and auth.uid() = created_by);
create policy "wd admin all"  on withdrawals for all using (is_admin()) with check (is_admin());

-- ---------- DEDUCTIONS ----------
alter table deductions enable row level security;

drop policy if exists "ded read"  on deductions;
drop policy if exists "ded write" on deductions;

create policy "ded read"  on deductions for select using (auth.uid() = worker_id or is_admin());
create policy "ded write" on deductions for all    using (is_admin()) with check (is_admin());

-- ---------- SETTLEMENTS ----------
alter table settlements enable row level security;

drop policy if exists "st read"  on settlements;
drop policy if exists "st write" on settlements;

create policy "st read"  on settlements for select using (auth.uid() = worker_id or is_admin());
create policy "st write" on settlements for all    using (is_admin()) with check (is_admin());

-- ---------- AUDIT_LOG ----------
alter table audit_log enable row level security;

drop policy if exists "audit read"  on audit_log;
drop policy if exists "audit write" on audit_log;

create policy "audit read"  on audit_log for select using (is_admin());
create policy "audit write" on audit_log for insert with check (true);

-- ---------- NOTIFICATIONS ----------
alter table notifications enable row level security;

drop policy if exists "notif own read"  on notifications;
drop policy if exists "notif own update" on notifications;
drop policy if exists "notif admin read" on notifications;
drop policy if exists "notif insert"    on notifications;

create policy "notif own read"   on notifications for select using (auth.uid() = user_id);
create policy "notif own update" on notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notif admin read" on notifications for select using (is_admin());
create policy "notif insert"     on notifications for insert with check (true);

-- ---------- SETTINGS ----------
alter table settings enable row level security;

drop policy if exists "settings read"  on settings;
drop policy if exists "settings write" on settings;

create policy "settings read"  on settings for select using (is_admin());
create policy "settings write" on settings for all    using (is_admin()) with check (is_admin());

-- ---------- STORAGE: صور البطاقات ----------
drop policy if exists "worker uploads own card" on storage.objects;
drop policy if exists "worker reads own card"  on storage.objects;
drop policy if exists "admin reads all cards"   on storage.objects;

create policy "worker uploads own card" on storage.objects for insert
  with check (
    bucket_id = 'id-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "worker reads own card" on storage.objects for select
  using (
    bucket_id = 'id-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "admin reads all cards" on storage.objects for select
  using (bucket_id = 'id-cards' and is_admin());

-- ---------- PROFILES: تسجيل ذاتي ----------
drop policy if exists "self signup" on profiles;
create policy "self signup" on profiles for insert
  with check (auth.uid() = id);

-- ============================================================
--  ██  TRIGGERS  ██
-- ============================================================
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

-- ============================================================
--  ██  FUNCTIONS (الدوال)  ██
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
        'closed_at', p.closed_at, 'archived_at', p.archived_at
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
  (select count(*) from worker_projects wp where wp.project_id = p.id) as workers_count,
  (select count(*) from attendance a where a.project_id = p.id)         as attendance_count,
  (select coalesce(sum(amount),0) from withdrawals wd where wd.project_id = p.id) as total_withdrawn,
  (select coalesce(sum(amount),0) from deductions d where d.project_id = p.id)    as total_deductions,
  (select coalesce(sum(net_amount),0) from settlements s where s.project_id = p.id) as total_paid
from projects p
where p.status = 'closed'
order by p.closed_at desc;

-- ============================================================
--  ██  ACCOUNTS (حسابات الملاك والمطوّر)  ██
-- ============================================================
-- ============================================================
--  حسابات الإدارة — الملاك + المطوّر
--  شغّل الملف ده بعد schema → policies → triggers → functions
-- ============================================================

do $$
declare
  v_password text := 'Qn&112233#Do';   -- كلمة السر المشتركة
begin

  -- ============ 1) المالك: عابدين يونس ============
  if not exists (select 1 from profiles where phone = '01111663393') then
    perform create_worker('عابدين يونس', '01111663393', v_password, 0, null, null);
  end if;

  update profiles set
    role = 'owner', username = 'abden.younes', full_name = 'عابدين يونس',
    status = 'active', is_active = true, daily_wage = 0,
    approved_at = now()
  where phone = '01111663393';

  -- ⚠️ مهم: خلّي إيميل الدخول = اليوزر نيم
  update auth.users set
    email = 'abden.younes@ommal.app', email_confirmed_at = now()
  where id = (select id from profiles where phone = '01111663393');


  -- ============ 2) المالك: محمود عبدين ============
  if not exists (select 1 from profiles where phone = '01100613051') then
    perform create_worker('محمود عبدين', '01100613051', v_password, 0, null, null);
  end if;

  update profiles set
    role = 'owner', username = 'mahmoud.abdin', full_name = 'محمود عبدين',
    status = 'active', is_active = true, daily_wage = 0,
    approved_at = now()
  where phone = '01100613051';

  update auth.users set
    email = 'mahmoud.abdin@ommal.app', email_confirmed_at = now()
  where id = (select id from profiles where phone = '01100613051');


  -- ============ 3) المطوّر: Mostafa Geddo ============
  if not exists (select 1 from profiles where phone = '01124965576') then
    perform create_worker('Mostafa Geddo', '01124965576', v_password, 0, null, null);
  end if;

  update profiles set
    role = 'developer', username = 'MostafaGeddo', full_name = 'Mostafa Geddo',
    status = 'active', is_active = true, daily_wage = 0,
    approved_at = now()
  where phone = '01124965576';

  update auth.users set
    email = 'mostafageddo@ommal.app', email_confirmed_at = now()
  where id = (select id from profiles where phone = '01124965576');


  raise notice 'تم إنشاء حسابات الملاك والمطور بالأرقام الحقيقية';
end $$;

-- ============================================================
--  التحقق — لازم تشوف 3 صفوف
-- ============================================================
select phone, username, full_name, role, status from profiles
where role in ('owner','developer') order by role, username;
