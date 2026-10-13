-- DESTRUCTIVE FULL DATA RESET — AquaDior-Staging ONLY.
-- Do not run against Production.
-- Before running, confirm the Supabase Dashboard project selector says
-- AquaDior-Staging. This removes every non-owner/developer account and all
-- application activity, projects, notifications, and audit history.
-- Owner and developer accounts remain. App settings are reset to their initial
-- defaults; database schema/functions, Storage bucket definitions, and static
-- app assets are preserved.
--
-- Storage files are NOT deleted by SQL (Supabase Storage is API-managed).
-- This script returns every Storage object path; delete those files afterward
-- using Supabase Dashboard > Storage or the Storage API.
--
-- This script intentionally clears ALL notifications, including admin inboxes,
-- and ALL audit rows. It does not touch Production or external OneSignal history.

begin;

-- Reduce the chance of concurrent Staging writes while reset/postcondition checks run.
lock table
  public.profiles,
  public.projects,
  public.sites,
  public.worker_projects,
  public.site_workers,
  public.attendance,
  public.attendance_sites,
  public.attendance_projects,
  public.withdrawals,
  public.deductions,
  public.settlements,
  public.notifications,
  public.audit_log,
  public.settings,
  auth.users
in share row exclusive mode;

do $$
begin
  if to_regclass('public.push_delivery_queue') is not null then
    execute 'lock table public.push_delivery_queue in share row exclusive mode';
  end if;
end;
$$;

create temporary table if not exists _aq_full_reset_profiles (
  id uuid primary key
) on commit preserve rows;
create temporary table if not exists _aq_full_reset_auth_users (
  id uuid primary key
) on commit preserve rows;
create temporary table if not exists _aq_full_reset_keep_profiles (
  id uuid primary key,
  role text not null
) on commit preserve rows;
create temporary table if not exists _aq_full_reset_storage_objects (
  bucket_id text not null,
  object_name text not null,
  primary key (bucket_id, object_name)
) on commit preserve rows;
create temporary table if not exists _aq_full_reset_trigger_state (
  relid oid not null,
  trigger_name name not null,
  was_enabled "char" not null,
  primary key (relid, trigger_name)
) on commit preserve rows;
create temporary table if not exists _aq_full_reset_report (
  item text primary key,
  affected_count bigint not null,
  details text
) on commit preserve rows;

truncate table
  pg_temp._aq_full_reset_profiles,
  pg_temp._aq_full_reset_auth_users,
  pg_temp._aq_full_reset_keep_profiles,
  pg_temp._aq_full_reset_storage_objects,
  pg_temp._aq_full_reset_trigger_state,
  pg_temp._aq_full_reset_report;

insert into pg_temp._aq_full_reset_keep_profiles (id, role)
select p.id, p.role
from public.profiles p
where p.role in ('owner', 'developer');

-- Fail closed unless at least one owner and one developer are present to keep.
do $$
begin
  if not exists (select 1 from pg_temp._aq_full_reset_keep_profiles where role = 'owner') then
    raise exception 'Reset stopped: no owner profile exists to preserve';
  end if;
  if not exists (select 1 from pg_temp._aq_full_reset_keep_profiles where role = 'developer') then
    raise exception 'Reset stopped: no developer profile exists to preserve';
  end if;
  if exists (
    select 1
    from pg_temp._aq_full_reset_keep_profiles kp
    where not exists (select 1 from auth.users u where u.id = kp.id)
  ) then
    raise exception 'Reset stopped: an owner/developer profile has no matching Auth account';
  end if;
end;
$$;

-- Every other profile role (including managers) and every Auth user outside the
-- owner/developer keep-set will be removed.
insert into pg_temp._aq_full_reset_profiles (id)
select p.id
from public.profiles p
where p.role not in ('owner', 'developer');

insert into pg_temp._aq_full_reset_auth_users (id)
select u.id
from auth.users u
where not exists (
  select 1
  from pg_temp._aq_full_reset_keep_profiles kp
  where kp.id = u.id
);

-- Capture every Supabase Storage object before removing profiles. Storage files
-- must later be deleted through the Storage API/Dashboard, not SQL.
insert into pg_temp._aq_full_reset_storage_objects (bucket_id, object_name)
select o.bucket_id, o.name
from storage.objects o;

-- Record pre-reset counts for the result set returned at the end.
insert into pg_temp._aq_full_reset_report (item, affected_count, details)
select 'owner profiles preserved', count(*), null
from pg_temp._aq_full_reset_keep_profiles where role = 'owner'
union all
select 'developer profiles preserved', count(*), null
from pg_temp._aq_full_reset_keep_profiles where role = 'developer'
union all
select 'other profiles removed', count(*), null
from pg_temp._aq_full_reset_profiles
union all
select 'Auth accounts removed', count(*), null
from pg_temp._aq_full_reset_auth_users
union all
select 'projects removed (active and closed)', count(*), null
from public.projects
union all
select 'legacy sites removed', count(*)::bigint, null
from public.sites
union all
select 'worker-project links removed', count(*)::bigint, null
from public.worker_projects
union all
select 'site-worker links removed', count(*)::bigint, null
from public.site_workers
union all
select 'attendance-project links removed', count(*)::bigint, null
from public.attendance_projects
union all
select 'attendance-site links removed', count(*)::bigint, null
from public.attendance_sites
union all
select 'attendance rows removed', count(*)::bigint, null
from public.attendance
union all
select 'withdrawals removed', count(*)::bigint, null
from public.withdrawals
union all
select 'deductions removed', count(*)::bigint, null
from public.deductions
union all
select 'settlements removed', count(*)::bigint, null
from public.settlements
union all
select 'notifications removed (including owner/developer inboxes)', count(*)::bigint, null
from public.notifications
union all
select 'audit-log rows removed', count(*)::bigint, null
from public.audit_log
union all
select 'profile ID-card URLs cleared', count(*)::bigint, null
from public.profiles where id_card_url is not null
union all
select 'Storage objects pending Storage API deletion', count(*)::bigint,
       'Use the object paths listed below in Supabase Dashboard > Storage'
from pg_temp._aq_full_reset_storage_objects
union all
select 'settings rows reset to initial defaults', count(*)::bigint, null
from public.settings;

do $$
begin
  if to_regclass('public.push_delivery_queue') is not null then
    execute $sql$
      insert into pg_temp._aq_full_reset_report (item, affected_count, details)
      select 'external push queue rows removed', count(*)::bigint, null
      from public.push_delivery_queue
    $sql$;
  else
    insert into pg_temp._aq_full_reset_report (item, affected_count, details)
    values ('external push queue rows removed', 0, 'Queue table is not installed');
  end if;
end;
$$;

-- Save and disable only user-defined triggers on the affected application
-- tables. Internal foreign-key triggers remain enabled. Transaction rollback
-- restores the original trigger states automatically if anything fails.
insert into pg_temp._aq_full_reset_trigger_state (relid, trigger_name, was_enabled)
select t.tgrelid, t.tgname, t.tgenabled
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname::text = any (array[
    'profiles', 'projects', 'sites', 'worker_projects', 'site_workers',
    'attendance', 'attendance_sites', 'attendance_projects', 'withdrawals',
    'deductions', 'settlements', 'notifications', 'audit_log', 'settings',
    'push_delivery_queue'
  ])
  and not t.tgisinternal;

do $$
declare
  r record;
begin
  for r in
    select relid::regclass as table_name, trigger_name
    from pg_temp._aq_full_reset_trigger_state
  loop
    execute format('alter table %s disable trigger %I', r.table_name, r.trigger_name);
  end loop;
end;
$$;

-- Remove notification and push queue history for every account.
do $$
begin
  if to_regclass('public.push_delivery_queue') is not null then
    execute 'delete from public.push_delivery_queue';
  end if;
end;
$$;
delete from public.notifications;

-- Remove every project-linked or worker-linked record, including closed-project history.
delete from public.attendance_projects;
delete from public.attendance_sites;
delete from public.attendance;
delete from public.withdrawals;
delete from public.deductions;
delete from public.settlements;
delete from public.worker_projects;
delete from public.site_workers;
delete from public.sites;
delete from public.projects;

-- Remove references from the kept profiles to accounts that are about to be deleted,
-- and clear all stored card-image URLs, including any on owner/developer profiles.
update public.profiles p
set approved_by = null
where p.approved_by in (select id from pg_temp._aq_full_reset_profiles);
update public.profiles
set id_card_url = null
where id_card_url is not null;

-- Delete all non-owner/developer Auth accounts. Their profiles are removed by
-- the profiles.id -> auth.users.id ON DELETE CASCADE constraint.
delete from auth.users u
using pg_temp._aq_full_reset_auth_users doomed
where u.id = doomed.id;

-- The request is a clean test reset, so remove the entire audit history and
-- restore application settings to the schema's initial values.
delete from public.audit_log;
delete from public.settings;
insert into public.settings (key, value)
values
  ('app', '{"absence_deduction":50,"day_lock_time":"00:00","gps_enabled":false,"currency":"ج.م"}'::jsonb),
  ('telegram', '{"chat_id":""}'::jsonb);

-- Restore every trigger to its exact prior enabled/disabled mode.
do $$
declare
  r record;
begin
  for r in
    select relid::regclass as table_name, trigger_name, was_enabled
    from pg_temp._aq_full_reset_trigger_state
  loop
    if r.was_enabled = 'O' then
      execute format('alter table %s enable trigger %I', r.table_name, r.trigger_name);
    elsif r.was_enabled = 'R' then
      execute format('alter table %s enable replica trigger %I', r.table_name, r.trigger_name);
    elsif r.was_enabled = 'A' then
      execute format('alter table %s enable always trigger %I', r.table_name, r.trigger_name);
    end if;
  end loop;
end;
$$;

-- Postconditions fail and roll back the whole transaction if the reset is incomplete
-- or if any owner/developer account was accidentally removed.
do $$
declare
  v_push_queue_has_rows boolean;
begin
  if exists (
    select 1 from pg_temp._aq_full_reset_keep_profiles kp
    where not exists (select 1 from public.profiles p where p.id = kp.id and p.role = kp.role)
  ) then
    raise exception 'Reset stopped: a preserved owner/developer profile is missing or changed';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.role not in ('owner', 'developer')
  ) then
    raise exception 'Reset stopped: a non-owner/developer profile remains';
  end if;
  if exists (
    select 1 from auth.users u
    where not exists (
      select 1 from pg_temp._aq_full_reset_keep_profiles kp where kp.id = u.id
    )
  ) then
    raise exception 'Reset stopped: an Auth account outside the owner/developer keep-set remains';
  end if;
  if exists (select 1 from public.projects)
     or exists (select 1 from public.sites)
     or exists (select 1 from public.worker_projects)
     or exists (select 1 from public.site_workers)
     or exists (select 1 from public.attendance_projects)
     or exists (select 1 from public.attendance_sites)
     or exists (select 1 from public.attendance)
     or exists (select 1 from public.withdrawals)
     or exists (select 1 from public.deductions)
     or exists (select 1 from public.settlements)
     or exists (select 1 from public.notifications)
     or exists (select 1 from public.audit_log)
     or exists (select 1 from public.profiles where id_card_url is not null)
     or (select count(*) from public.settings) <> 2
     or not exists (
       select 1 from public.settings
       where key = 'app'
         and value = '{"absence_deduction":50,"day_lock_time":"00:00","gps_enabled":false,"currency":"ج.م"}'::jsonb
     )
     or not exists (
       select 1 from public.settings
       where key = 'telegram' and value = '{"chat_id":""}'::jsonb
     ) then
    raise exception 'Reset stopped: application data remains after cleanup';
  end if;
  if to_regclass('public.push_delivery_queue') is not null then
    execute 'select exists (select 1 from public.push_delivery_queue)'
      into v_push_queue_has_rows;
    if v_push_queue_has_rows then
      raise exception 'Reset stopped: external push queue rows remain';
    end if;
  end if;
end;
$$;

commit;

-- Summary and all Storage paths are returned after the database reset commits.
-- Delete these objects separately through Supabase Storage Dashboard/API.
select 'summary'::text as section,
       item,
       affected_count,
       details
from pg_temp._aq_full_reset_report
union all
select 'storage object'::text as section,
       bucket_id || '/' || object_name as item,
       null::bigint as affected_count,
       'Delete via Supabase Storage Dashboard/API'::text as details
from pg_temp._aq_full_reset_storage_objects
order by section, item;
