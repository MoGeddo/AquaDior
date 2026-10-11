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
