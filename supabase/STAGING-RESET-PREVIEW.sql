-- READ-ONLY PREVIEW ONLY — this file performs no INSERT, UPDATE, or DELETE.
-- Run it only in Supabase SQL Editor while the project selector says AquaDior-Staging.
-- It shows the accounts that would be removed (all roles except owner/developer),
-- open projects (status='active'), and related application-row counts.
-- Review these results before preparing/running any cleanup.

-- 1) Accounts to preserve by role, and accounts outside that set.
select
  case when role in ('owner', 'developer') then 'PRESERVE: ' || role
       else 'WOULD REMOVE: ' || role end as disposition,
  count(*) as profile_count
from public.profiles
group by 1
order by 1;

-- 2) Exact account list that would be removed. No passwords or auth metadata shown.
select id, full_name, role, status, is_active
from public.profiles
where role not in ('owner', 'developer')
order by role, full_name;

-- 3) Auth accounts that do not have an owner/developer profile would also be
-- outside the requested keep-set. Count only; no email or auth metadata shown.
select count(*) as auth_accounts_without_owner_or_developer_profile
from auth.users u
where not exists (
  select 1 from public.profiles p
  where p.id = u.id and p.role in ('owner', 'developer')
);

-- 4) Open projects, as represented in this application (status='active').
select id, name, status, created_at
from public.projects
where status = 'active'
order by created_at, name;

-- 5) Approximate affected counts. A non-owner/developer account is included
-- because the request is to leave only owner/developer profiles. Any row tied
-- to an active project is included regardless of who created it.
with
profiles_to_remove as (
  select id from public.profiles where role not in ('owner', 'developer')
),
open_projects as (
  select id from public.projects where status = 'active'
),
open_sites as (
  select id from public.sites where project_id in (select id from open_projects)
),
attendance_to_remove as (
  select distinct a.id
  from public.attendance a
  where a.worker_id in (select id from profiles_to_remove)
     or a.project_id in (select id from open_projects)
     or exists (
       select 1 from public.attendance_projects ap
       where ap.attendance_id = a.id
         and ap.project_id in (select id from open_projects)
     )
     or exists (
       select 1
       from public.attendance_sites ats
       join public.sites s on s.id = ats.site_id
       where ats.attendance_id = a.id
         and s.project_id in (select id from open_projects)
     )
),
notifications_to_remove as (
  select n.id
  from public.notifications n
  where n.user_id in (select id from profiles_to_remove)
     or n.data->>'worker_id' in (select id::text from profiles_to_remove)
     or n.data->>'project_id' in (select id::text from open_projects)
),
affected_counts as (
  select 'profiles except owner/developer' as item, count(*)::bigint as row_count
  from profiles_to_remove
  union all
  select 'open projects', count(*)::bigint from open_projects
  union all
  select 'sites attached to open projects', count(*)::bigint from open_sites
  union all
  select 'worker-project assignments', count(*)::bigint
  from public.worker_projects wp
  where wp.worker_id in (select id from profiles_to_remove)
     or wp.project_id in (select id from open_projects)
  union all
  select 'site-worker assignments', count(*)::bigint
  from public.site_workers sw
  where sw.worker_id in (select id from profiles_to_remove)
     or sw.site_id in (select id from open_sites)
  union all
  select 'attendance rows', count(*)::bigint from attendance_to_remove
  union all
  select 'attendance-project links', count(*)::bigint
  from public.attendance_projects ap
  where ap.attendance_id in (select id from attendance_to_remove)
     or ap.project_id in (select id from open_projects)
  union all
  select 'attendance-site links', count(*)::bigint
  from public.attendance_sites ats
  where ats.attendance_id in (select id from attendance_to_remove)
     or ats.site_id in (select id from open_sites)
  union all
  select 'withdrawals', count(*)::bigint
  from public.withdrawals w
  where w.worker_id in (select id from profiles_to_remove)
     or w.project_id in (select id from open_projects)
  union all
  select 'deductions', count(*)::bigint
  from public.deductions d
  where d.worker_id in (select id from profiles_to_remove)
     or d.project_id in (select id from open_projects)
  union all
  select 'settlements', count(*)::bigint
  from public.settlements s
  where s.worker_id in (select id from profiles_to_remove)
     or s.project_id in (select id from open_projects)
  union all
  select 'notifications', count(*)::bigint from notifications_to_remove
  union all
  select 'audit log total (review: entries may retain old test data)', count(*)::bigint
  from public.audit_log
  union all
  select 'ID-card objects for profiles to remove', count(*)::bigint
  from storage.objects o
  where o.bucket_id = 'id-cards'
    and exists (
      select 1 from profiles_to_remove p
      where o.name = p.id::text || '/card.jpg'
         or o.name like (p.id::text || '/%')
    )
)
select item, row_count
from affected_counts
order by item;

-- 6) Closed-project history belonging to profiles outside owner/developer.
-- Surfaced separately: the request names open projects, so don't accidentally
-- include closed-project history in the cleanup without seeing it first.
select
  p.id,
  p.name,
  (select count(*)
   from public.attendance a
   join public.profiles worker on worker.id = a.worker_id
   where worker.role not in ('owner', 'developer')
     and (a.project_id = p.id or exists (
       select 1 from public.attendance_projects ap
       where ap.attendance_id = a.id and ap.project_id = p.id
     ))) as attendance_rows,
  (select count(*)
   from public.withdrawals w
   join public.profiles worker on worker.id = w.worker_id
   where w.project_id = p.id and worker.role not in ('owner', 'developer')) as withdrawal_rows,
  (select count(*)
   from public.deductions d
   join public.profiles worker on worker.id = d.worker_id
   where d.project_id = p.id and worker.role not in ('owner', 'developer')) as deduction_rows,
  (select count(*)
   from public.settlements s
   join public.profiles worker on worker.id = s.worker_id
   where s.project_id = p.id and worker.role not in ('owner', 'developer')) as settlement_rows
from public.projects p
where p.status = 'closed'
  and (
    exists (
      select 1 from public.attendance a
      join public.profiles worker on worker.id = a.worker_id
      where worker.role not in ('owner', 'developer')
        and (a.project_id = p.id or exists (
          select 1 from public.attendance_projects ap
          where ap.attendance_id = a.id and ap.project_id = p.id
        ))
    )
    or exists (
      select 1 from public.withdrawals w
      join public.profiles worker on worker.id = w.worker_id
      where w.project_id = p.id and worker.role not in ('owner', 'developer')
    )
    or exists (
      select 1 from public.deductions d
      join public.profiles worker on worker.id = d.worker_id
      where d.project_id = p.id and worker.role not in ('owner', 'developer')
    )
    or exists (
      select 1 from public.settlements s
      join public.profiles worker on worker.id = s.worker_id
      where s.project_id = p.id and worker.role not in ('owner', 'developer')
    )
  )
order by p.name;
