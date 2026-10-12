-- Read-only structural checks after applying the canonical Supabase SQL files.
-- These checks do not replace JWT/RLS integration tests against a staging project.

select object_name, is_present
from (values
  ('table: profiles', to_regclass('public.profiles') is not null),
  ('table: projects', to_regclass('public.projects') is not null),
  ('table: worker_projects', to_regclass('public.worker_projects') is not null),
  ('table: attendance', to_regclass('public.attendance') is not null),
  ('trigger: new attendance GPS cleared', to_regclass('public.attendance') is not null and exists (select 1 from pg_trigger where tgrelid = to_regclass('public.attendance')::oid and tgname = 'trg_attendance_no_gps' and not tgisinternal)),
  ('setting: attendance GPS disabled', coalesce((select value->>'gps_enabled' from public.settings where key = 'app'), 'false') = 'false'),
  ('table: withdrawals', to_regclass('public.withdrawals') is not null),
  ('table: deductions', to_regclass('public.deductions') is not null),
  ('table: settlements', to_regclass('public.settlements') is not null),
  ('view: worker_balances', to_regclass('public.worker_balances') is not null),
  ('view: worker_project_balances', to_regclass('public.worker_project_balances') is not null),
  ('function: register_attendance', to_regprocedure('public.register_attendance(uuid,date,uuid[],numeric,numeric,text,uuid)') is not null),
  ('function: register_withdrawal', to_regprocedure('public.register_withdrawal(uuid,numeric,text,uuid,uuid)') is not null),
  ('function: add_worker_deduction', to_regprocedure('public.add_worker_deduction(uuid,uuid,numeric,text)') is not null),
  ('function: update_worker_details', to_regprocedure('public.update_worker_details(uuid,text,text,numeric,boolean,uuid[])') is not null),
  ('function: close_project', to_regprocedure('public.close_project(uuid)') is not null),
  ('function: export_project_data', to_regprocedure('public.export_project_data(uuid)') is not null),
  ('function: worker_app_config', to_regprocedure('public.worker_app_config()') is not null),
  ('function: health_check', to_regprocedure('public.health_check()') is not null),
  ('index: profiles pending status', to_regclass('public.idx_profiles_status') is not null)
) as checks(object_name, is_present)
order by object_name;

-- Every business table listed here must have RLS enabled.
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r'
  and c.relname in (
    'profiles', 'projects', 'sites', 'worker_projects', 'site_workers',
    'attendance', 'attendance_sites', 'withdrawals', 'deductions',
    'settlements', 'audit_log', 'notifications', 'settings'
  )
order by c.relname;

-- SECURITY DEFINER routines should pin search_path. Investigate any returned rows.
select n.nspname, p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and not coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
order by p.proname;

-- The Telegram bot token must not remain in the public settings JSON.
select key, coalesce(value ? 'bot_token', false) as bot_token_still_stored
from public.settings
where key = 'telegram';

-- Profile and notification writes must be routed through controlled RPCs.
select
  has_schema_privilege('anon', 'public', 'CREATE') as anon_can_create_public_objects,
  has_schema_privilege('authenticated', 'public', 'CREATE') as authenticated_can_create_public_objects,
  has_table_privilege('authenticated', 'public.profiles', 'INSERT') as profiles_insert_allowed,
  has_table_privilege('authenticated', 'public.profiles', 'UPDATE') as profiles_update_allowed,
  has_table_privilege('authenticated', 'public.profiles', 'DELETE') as profiles_delete_allowed,
  has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') as profile_role_update_allowed,
  has_column_privilege('authenticated', 'public.notifications', 'body', 'UPDATE') as notification_body_update_allowed,
  has_column_privilege('authenticated', 'public.notifications', 'is_read', 'UPDATE') as notification_read_update_allowed;

-- Private storage bucket configuration.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'id-cards';
