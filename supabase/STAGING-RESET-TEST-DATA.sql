-- DESTRUCTIVE ONE-TIME CLEANUP — AquaDior-Staging ONLY.
-- Do not run against production.
--
-- Based on STAGING-RESET-PREVIEW.sql. It proceeds only if the previewed counts
-- still match exactly: 1 non-owner/developer profile, 1 auth account outside the
-- keep-set, 1 open project, 1 attendance row, 1 attendance-project link,
-- 1 withdrawal, 1 settlement, 11 notifications, and 1 ID-card object. The
-- attendance-site, deduction, site, and assignment counts must remain zero.
-- The total audit-log count is not required to be 27; only matching test rows are removed.
--
-- Removes profiles/auth accounts except owner/developer, active projects and
-- their activity, plus all activity belonging to profiles being removed.
-- Clears audit rows linked to the removed test data, then writes one redacted
-- audit summary. Preserves unrelated closed-project activity and all owner/developer accounts.
-- Storage objects must be deleted through Supabase Storage API, not SQL; the
-- final result set reports the object path(s).

begin;

-- Prevent concurrent staging writes while the exact-preview guards and cleanup run.
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
  auth.users
in share row exclusive mode;

do $$
begin
  if to_regclass('public.push_delivery_queue') is not null then
    execute 'lock table public.push_delivery_queue in share row exclusive mode';
  end if;
end;
$$;

create temporary table if not exists _aq_reset_profiles (id uuid primary key);
create temporary table if not exists _aq_reset_auth_users (id uuid primary key);
create temporary table if not exists _aq_reset_projects (id uuid primary key);
create temporary table if not exists _aq_reset_sites (id uuid primary key);
create temporary table if not exists _aq_reset_attendance (id uuid primary key);
create temporary table if not exists _aq_reset_attendance_projects (
  attendance_id uuid not null,
  project_id uuid not null,
  primary key (attendance_id, project_id)
);
create temporary table if not exists _aq_reset_attendance_sites (id uuid primary key);
create temporary table if not exists _aq_reset_worker_projects (id uuid primary key);
create temporary table if not exists _aq_reset_site_workers (
  site_id uuid not null,
  worker_id uuid not null,
  primary key (site_id, worker_id)
);
create temporary table if not exists _aq_reset_withdrawals (id uuid primary key);
create temporary table if not exists _aq_reset_deductions (id uuid primary key);
create temporary table if not exists _aq_reset_settlements (id uuid primary key);
create temporary table if not exists _aq_reset_notifications (id uuid primary key);
create temporary table if not exists _aq_reset_storage_paths (
  bucket_id text not null,
  object_name text not null,
  primary key (bucket_id, object_name)
);
create temporary table if not exists _aq_reset_audit_ids (id bigint primary key);
create temporary table if not exists _aq_reset_trigger_state (
  relid oid not null,
  trigger_name name not null,
  was_enabled "char" not null,
  primary key (relid, trigger_name)
);
create temporary table if not exists _aq_reset_report (
  item text primary key,
  affected_count bigint not null,
  details text
);

truncate table
  pg_temp._aq_reset_profiles,
  pg_temp._aq_reset_auth_users,
  pg_temp._aq_reset_projects,
  pg_temp._aq_reset_sites,
  pg_temp._aq_reset_attendance,
  pg_temp._aq_reset_attendance_projects,
  pg_temp._aq_reset_attendance_sites,
  pg_temp._aq_reset_worker_projects,
  pg_temp._aq_reset_site_workers,
  pg_temp._aq_reset_withdrawals,
  pg_temp._aq_reset_deductions,
  pg_temp._aq_reset_settlements,
  pg_temp._aq_reset_notifications,
  pg_temp._aq_reset_storage_paths,
  pg_temp._aq_reset_audit_ids,
  pg_temp._aq_reset_trigger_state,
  pg_temp._aq_reset_report;

-- Keep every owner and developer account; target all other profile roles.
insert into pg_temp._aq_reset_profiles (id)
select p.id
from public.profiles p
where p.role not in ('owner', 'developer');

-- Include auth users without an owner/developer profile so the postcondition
-- can guarantee that only the requested accounts remain.
insert into pg_temp._aq_reset_auth_users (id)
select u.id
from auth.users u
where not exists (
  select 1 from public.profiles p
  where p.id = u.id and p.role in ('owner', 'developer')
);

insert into pg_temp._aq_reset_projects (id)
select p.id from public.projects p where p.status = 'active';

insert into pg_temp._aq_reset_sites (id)
select s.id
from public.sites s
where s.project_id in (select id from pg_temp._aq_reset_projects);

insert into pg_temp._aq_reset_attendance (id)
select distinct a.id
from public.attendance a
where a.worker_id in (select id from pg_temp._aq_reset_profiles)
   or a.project_id in (select id from pg_temp._aq_reset_projects)
   or exists (
     select 1 from public.attendance_projects ap
     where ap.attendance_id = a.id
       and ap.project_id in (select id from pg_temp._aq_reset_projects)
   )
   or exists (
     select 1
     from public.attendance_sites ats
     join public.sites s on s.id = ats.site_id
     where ats.attendance_id = a.id
       and s.project_id in (select id from pg_temp._aq_reset_projects)
   );

insert into pg_temp._aq_reset_attendance_projects (attendance_id, project_id)
select ap.attendance_id, ap.project_id
from public.attendance_projects ap
where ap.attendance_id in (select id from pg_temp._aq_reset_attendance)
   or ap.project_id in (select id from pg_temp._aq_reset_projects);

insert into pg_temp._aq_reset_attendance_sites (id)
select ats.id
from public.attendance_sites ats
where ats.attendance_id in (select id from pg_temp._aq_reset_attendance)
   or ats.site_id in (select id from pg_temp._aq_reset_sites);

insert into pg_temp._aq_reset_worker_projects (id)
select wp.id
from public.worker_projects wp
where wp.worker_id in (select id from pg_temp._aq_reset_profiles)
   or wp.project_id in (select id from pg_temp._aq_reset_projects);

insert into pg_temp._aq_reset_site_workers (site_id, worker_id)
select sw.site_id, sw.worker_id
from public.site_workers sw
where sw.worker_id in (select id from pg_temp._aq_reset_profiles)
   or sw.site_id in (select id from pg_temp._aq_reset_sites);

insert into pg_temp._aq_reset_withdrawals (id)
select w.id
from public.withdrawals w
where w.worker_id in (select id from pg_temp._aq_reset_profiles)
   or w.project_id in (select id from pg_temp._aq_reset_projects);

insert into pg_temp._aq_reset_deductions (id)
select d.id
from public.deductions d
where d.worker_id in (select id from pg_temp._aq_reset_profiles)
   or d.project_id in (select id from pg_temp._aq_reset_projects);

insert into pg_temp._aq_reset_settlements (id)
select s.id
from public.settlements s
where s.worker_id in (select id from pg_temp._aq_reset_profiles)
   or s.project_id in (select id from pg_temp._aq_reset_projects);

insert into pg_temp._aq_reset_notifications (id)
select n.id
from public.notifications n
where n.user_id in (select id from pg_temp._aq_reset_profiles)
   or n.data->>'worker_id' in (select id::text from pg_temp._aq_reset_profiles)
   or n.data->>'project_id' in (select id::text from pg_temp._aq_reset_projects);

insert into pg_temp._aq_reset_storage_paths (bucket_id, object_name)
select o.bucket_id, o.name
from storage.objects o
where o.bucket_id = 'id-cards'
  and exists (
    select 1 from pg_temp._aq_reset_profiles p
    where o.name = p.id::text || '/card.jpg'
       or o.name like (p.id::text || '/%')
  );

-- Find historical audit rows that would otherwise retain the removed worker or
-- project data. Keep unrelated audit entries; triggers are disabled only inside
-- this transaction so the deletion itself does not recreate that old data.
insert into pg_temp._aq_reset_audit_ids (id)
select distinct l.id
from public.audit_log l
where l.changed_by in (select id from pg_temp._aq_reset_profiles)
   or l.record_id in (
     select id::text from pg_temp._aq_reset_profiles
     union select id::text from pg_temp._aq_reset_projects
     union select id::text from pg_temp._aq_reset_sites
     union select id::text from pg_temp._aq_reset_attendance
     union select id::text from pg_temp._aq_reset_worker_projects
     union select id::text from pg_temp._aq_reset_attendance_sites
     union select id::text from pg_temp._aq_reset_withdrawals
     union select id::text from pg_temp._aq_reset_deductions
     union select id::text from pg_temp._aq_reset_settlements
   )
   or l.old_data->>'id' in (
     select id::text from pg_temp._aq_reset_profiles
     union select id::text from pg_temp._aq_reset_projects
     union select id::text from pg_temp._aq_reset_sites
     union select id::text from pg_temp._aq_reset_attendance
     union select id::text from pg_temp._aq_reset_worker_projects
     union select id::text from pg_temp._aq_reset_attendance_sites
     union select id::text from pg_temp._aq_reset_withdrawals
     union select id::text from pg_temp._aq_reset_deductions
     union select id::text from pg_temp._aq_reset_settlements
   )
   or l.new_data->>'id' in (
     select id::text from pg_temp._aq_reset_profiles
     union select id::text from pg_temp._aq_reset_projects
     union select id::text from pg_temp._aq_reset_sites
     union select id::text from pg_temp._aq_reset_attendance
     union select id::text from pg_temp._aq_reset_worker_projects
     union select id::text from pg_temp._aq_reset_attendance_sites
     union select id::text from pg_temp._aq_reset_withdrawals
     union select id::text from pg_temp._aq_reset_deductions
     union select id::text from pg_temp._aq_reset_settlements
   )
   or l.old_data->>'worker_id' in (select id::text from pg_temp._aq_reset_profiles)
   or l.new_data->>'worker_id' in (select id::text from pg_temp._aq_reset_profiles)
   or l.old_data->>'project_id' in (select id::text from pg_temp._aq_reset_projects)
   or l.new_data->>'project_id' in (select id::text from pg_temp._aq_reset_projects)
   or l.old_data->>'attendance_id' in (select id::text from pg_temp._aq_reset_attendance)
   or l.new_data->>'attendance_id' in (select id::text from pg_temp._aq_reset_attendance)
   or l.old_data->>'site_id' in (select id::text from pg_temp._aq_reset_sites)
   or l.new_data->>'site_id' in (select id::text from pg_temp._aq_reset_sites)
   or l.old_data->>'user_id' in (select id::text from pg_temp._aq_reset_profiles)
   or l.new_data->>'user_id' in (select id::text from pg_temp._aq_reset_profiles)
   or l.old_data->>'created_by' in (select id::text from pg_temp._aq_reset_profiles)
   or l.new_data->>'created_by' in (select id::text from pg_temp._aq_reset_profiles)
   or l.old_data->>'decided_by' in (select id::text from pg_temp._aq_reset_profiles)
   or l.new_data->>'decided_by' in (select id::text from pg_temp._aq_reset_profiles)
   or l.old_data->>'confirmed_by' in (select id::text from pg_temp._aq_reset_profiles)
   or l.new_data->>'confirmed_by' in (select id::text from pg_temp._aq_reset_profiles)
   or l.old_data->>'approved_by' in (select id::text from pg_temp._aq_reset_profiles)
   or l.new_data->>'approved_by' in (select id::text from pg_temp._aq_reset_profiles)
   or l.old_data->>'archived_by' in (select id::text from pg_temp._aq_reset_profiles)
   or l.new_data->>'archived_by' in (select id::text from pg_temp._aq_reset_profiles)
   or l.old_data->>'voided_by' in (select id::text from pg_temp._aq_reset_profiles)
   or l.new_data->>'voided_by' in (select id::text from pg_temp._aq_reset_profiles);

-- Fail closed if the Staging database no longer matches the preview. Nothing is
-- deleted unless every count below matches what was reviewed.
do $$
begin
  if not exists (select 1 from public.profiles where role = 'owner')
     or not exists (select 1 from public.profiles where role = 'developer') then
    raise exception 'Cleanup stopped: an owner and developer profile must both exist';
  end if;
  if (select count(*) from pg_temp._aq_reset_profiles) <> 1
     or (select count(*) from pg_temp._aq_reset_auth_users) <> 1
     or (select count(*) from pg_temp._aq_reset_projects) <> 1
     or (select count(*) from pg_temp._aq_reset_attendance) <> 1
     or (select count(*) from pg_temp._aq_reset_attendance_projects) <> 1
     or (select count(*) from pg_temp._aq_reset_attendance_sites) <> 0
     or (select count(*) from pg_temp._aq_reset_withdrawals) <> 1
     or (select count(*) from pg_temp._aq_reset_deductions) <> 0
     or (select count(*) from pg_temp._aq_reset_settlements) <> 1
     or (select count(*) from pg_temp._aq_reset_notifications) <> 11
     or (select count(*) from pg_temp._aq_reset_sites) <> 0
     or (select count(*) from pg_temp._aq_reset_worker_projects) <> 0
     or (select count(*) from pg_temp._aq_reset_site_workers) <> 0
     or (select count(*) from pg_temp._aq_reset_storage_paths) <> 1 then
    raise exception 'Cleanup stopped: current rows differ from the reviewed Staging preview; no cleanup was performed';
  end if;
end;
$$;

-- Save and temporarily disable only non-internal triggers on affected tables.
-- Foreign-key constraints remain enabled. Original trigger states are restored.
insert into pg_temp._aq_reset_trigger_state (relid, trigger_name, was_enabled)
select t.tgrelid, t.tgname, t.tgenabled
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles', 'projects', 'sites', 'worker_projects', 'site_workers',
    'attendance', 'attendance_sites', 'attendance_projects', 'withdrawals',
    'deductions', 'settlements', 'notifications'
  )
  and not t.tgisinternal;

do $$
declare
  r record;
begin
  for r in select relid::regclass as table_name, trigger_name
           from pg_temp._aq_reset_trigger_state loop
    execute format('alter table %s disable trigger %I', r.table_name, r.trigger_name);
  end loop;
end;
$$;

-- Remove test notifications and financial/attendance rows before deleting the
-- restricted profile/project rows. Child links are explicitly removed first.
delete from public.notifications n
where n.id in (select id from pg_temp._aq_reset_notifications);

delete from public.attendance_projects ap
where (ap.attendance_id, ap.project_id) in (
  select attendance_id, project_id from pg_temp._aq_reset_attendance_projects
);

delete from public.attendance_sites ats
where ats.id in (select id from pg_temp._aq_reset_attendance_sites);

delete from public.attendance a
where a.id in (select id from pg_temp._aq_reset_attendance);

delete from public.withdrawals w
where w.id in (select id from pg_temp._aq_reset_withdrawals);

delete from public.deductions d
where d.id in (select id from pg_temp._aq_reset_deductions);

delete from public.settlements s
where s.id in (select id from pg_temp._aq_reset_settlements);

delete from public.worker_projects wp
where wp.id in (select id from pg_temp._aq_reset_worker_projects);

delete from public.site_workers sw
where (sw.site_id, sw.worker_id) in (
  select site_id, worker_id from pg_temp._aq_reset_site_workers
);

delete from public.sites s
where s.id in (select id from pg_temp._aq_reset_sites);

delete from public.projects p
where p.id in (select id from pg_temp._aq_reset_projects);

-- Clear attribution FKs on any unrelated rows retained in closed projects so
-- deleting the test account cannot leave a dangling creator/approver reference.
update public.profiles p set approved_by = null
where p.approved_by in (select id from pg_temp._aq_reset_profiles);
update public.projects p
set created_by = case when p.created_by in (select id from pg_temp._aq_reset_profiles) then null else p.created_by end,
    archived_by = case when p.archived_by in (select id from pg_temp._aq_reset_profiles) then null else p.archived_by end
where p.created_by in (select id from pg_temp._aq_reset_profiles)
   or p.archived_by in (select id from pg_temp._aq_reset_profiles);
update public.attendance a set created_by = null
where a.created_by in (select id from pg_temp._aq_reset_profiles);
update public.withdrawals w
set created_by = case when w.created_by in (select id from pg_temp._aq_reset_profiles) then null else w.created_by end,
    decided_by = case when w.decided_by in (select id from pg_temp._aq_reset_profiles) then null else w.decided_by end
where w.created_by in (select id from pg_temp._aq_reset_profiles)
   or w.decided_by in (select id from pg_temp._aq_reset_profiles);
update public.deductions d
set created_by = case when d.created_by in (select id from pg_temp._aq_reset_profiles) then null else d.created_by end,
    voided_by = case when d.voided_by in (select id from pg_temp._aq_reset_profiles) then null else d.voided_by end
where d.created_by in (select id from pg_temp._aq_reset_profiles)
   or d.voided_by in (select id from pg_temp._aq_reset_profiles);
update public.settlements s set confirmed_by = null
where s.confirmed_by in (select id from pg_temp._aq_reset_profiles);

-- Remove matching audit history before deleting auth users (whose FK cascade
-- removes the profile). A minimal redacted reset record is added below.
delete from public.audit_log l
where l.id in (select id from pg_temp._aq_reset_audit_ids);

delete from auth.users u
where u.id in (select id from pg_temp._aq_reset_auth_users);

-- Restore every trigger to its exact prior enabled/disabled mode.
do $$
declare
  r record;
begin
  for r in select relid::regclass as table_name, trigger_name, was_enabled
           from pg_temp._aq_reset_trigger_state loop
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

-- Postconditions fail the transaction if anything outside the requested keep-set remains.
do $$
begin
  if exists (select 1 from public.profiles where role not in ('owner', 'developer')) then
    raise exception 'Cleanup stopped: a non-owner/developer profile remains';
  end if;
  if exists (select 1 from auth.users u where not exists (
    select 1 from public.profiles p where p.id = u.id and p.role in ('owner', 'developer')
  )) then
    raise exception 'Cleanup stopped: an auth account outside the owner/developer keep-set remains';
  end if;
  if exists (select 1 from public.projects where status = 'active') then
    raise exception 'Cleanup stopped: an active project remains';
  end if;
  if exists (select 1 from public.attendance where id in (select id from pg_temp._aq_reset_attendance))
     or exists (select 1 from public.withdrawals where id in (select id from pg_temp._aq_reset_withdrawals))
     or exists (select 1 from public.deductions where id in (select id from pg_temp._aq_reset_deductions))
     or exists (select 1 from public.settlements where id in (select id from pg_temp._aq_reset_settlements)) then
    raise exception 'Cleanup stopped: some targeted activity rows remain';
  end if;
end;
$$;

-- Preserve one non-identifying audit summary. SQL Editor does not reliably
-- expose the signed-in developer ID, so changed_by is intentionally NULL.
insert into public.audit_log (table_name, record_id, action, new_data, changed_by)
values (
  'staging_test_data_reset',
  'bulk-reset',
  'delete',
  jsonb_build_object(
    'execution_context', 'manual AquaDior-Staging SQL cleanup',
    'profiles_removed', (select count(*) from pg_temp._aq_reset_profiles),
    'auth_accounts_removed', (select count(*) from pg_temp._aq_reset_auth_users),
    'projects_removed', (select count(*) from pg_temp._aq_reset_projects),
    'attendance_removed', (select count(*) from pg_temp._aq_reset_attendance),
    'withdrawals_removed', (select count(*) from pg_temp._aq_reset_withdrawals),
    'deductions_removed', (select count(*) from pg_temp._aq_reset_deductions),
    'settlements_removed', (select count(*) from pg_temp._aq_reset_settlements),
    'notifications_removed', (select count(*) from pg_temp._aq_reset_notifications),
    'related_audit_rows_cleared', (select count(*) from pg_temp._aq_reset_audit_ids),
    'storage_objects_pending_storage_api_delete', (select count(*) from pg_temp._aq_reset_storage_paths)
  ),
  null
);

insert into pg_temp._aq_reset_report (item, affected_count, details)
values
  ('non-owner/developer profiles removed', (select count(*) from pg_temp._aq_reset_profiles), null),
  ('auth accounts removed', (select count(*) from pg_temp._aq_reset_auth_users), null),
  ('open projects removed', (select count(*) from pg_temp._aq_reset_projects), null),
  ('attendance rows removed', (select count(*) from pg_temp._aq_reset_attendance), null),
  ('withdrawals removed', (select count(*) from pg_temp._aq_reset_withdrawals), null),
  ('deductions removed', (select count(*) from pg_temp._aq_reset_deductions), null),
  ('settlements removed', (select count(*) from pg_temp._aq_reset_settlements), null),
  ('notifications removed', (select count(*) from pg_temp._aq_reset_notifications), null),
  ('related audit rows cleared', (select count(*) from pg_temp._aq_reset_audit_ids), null),
  ('ID-card objects to delete through Storage API',
    (select count(*) from pg_temp._aq_reset_storage_paths),
    (select string_agg(bucket_id || '/' || object_name, ', ')
     from pg_temp._aq_reset_storage_paths));

commit;

-- The one ID-card file cannot be removed with SQL; delete the listed path using
-- Supabase Dashboard > Storage > id-cards, or the Supabase Storage API.
select item, affected_count, details
from pg_temp._aq_reset_report
order by item;
