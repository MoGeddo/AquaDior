-- READ-ONLY preview for a full AquaDior Staging data reset.
-- Run only with the Supabase dashboard project selector on AquaDior-Staging.
-- This file performs no INSERT, UPDATE, DELETE, TRUNCATE, or DDL.
-- Owners and developers are the only accounts retained by the matching reset script.

select current_database() as database_name;

with
profiles_to_remove as (
  select id from public.profiles where role not in ('owner', 'developer')
),
auth_users_to_remove as (
  select u.id
  from auth.users u
  where not exists (
    select 1 from public.profiles p
    where p.id = u.id and p.role in ('owner', 'developer')
  )
),
counts as (
  select 'owner profiles to preserve'::text as item, count(*)::bigint as row_count
  from public.profiles where role = 'owner'
  union all
  select 'developer profiles to preserve', count(*)::bigint
  from public.profiles where role = 'developer'
  union all
  select 'all other profiles to remove', count(*)::bigint from profiles_to_remove
  union all
  select 'auth users to remove (not linked to owner/developer)', count(*)::bigint
  from auth_users_to_remove
  union all
  select 'projects to remove (active and closed)', count(*)::bigint from public.projects
  union all
  select 'legacy sites to remove', count(*)::bigint from public.sites
  union all
  select 'worker-project links to remove', count(*)::bigint from public.worker_projects
  union all
  select 'site-worker links to remove', count(*)::bigint from public.site_workers
  union all
  select 'attendance-project links to remove', count(*)::bigint from public.attendance_projects
  union all
  select 'attendance-site links to remove', count(*)::bigint from public.attendance_sites
  union all
  select 'attendance records to remove', count(*)::bigint from public.attendance
  union all
  select 'withdrawals to remove', count(*)::bigint from public.withdrawals
  union all
  select 'deductions to remove', count(*)::bigint from public.deductions
  union all
  select 'settlements to remove', count(*)::bigint from public.settlements
  union all
  select 'notifications to remove (including owner/developer inboxes)', count(*)::bigint
  from public.notifications
  union all
  select 'audit-log rows to remove', count(*)::bigint from public.audit_log
  union all
  select 'profiles with stored ID-card URL to clear', count(*)::bigint
  from public.profiles where id_card_url is not null
  union all
  select 'settings rows to reset to initial defaults', count(*)::bigint from public.settings
)
select item, row_count
from counts
order by item;

-- All Storage objects are included in the cleanup request. The cleanup SQL
-- cannot delete these through Postgres; use the Storage API/Dashboard after
-- running it. This preview groups objects by bucket without exposing filenames.
select bucket_id, count(*)::bigint as storage_objects_to_delete
from storage.objects
group by bucket_id
order by bucket_id;

-- Optional external-push queue; absent if PUSH-NOTIFICATIONS.sql was not installed.
select to_regclass('public.push_delivery_queue') as push_delivery_queue_table;
