-- Remove device GPS collection from attendance, without deleting historical coordinates.
-- Review the target project and take a backup before applying. This script is not run by the app.
begin;

do $$
begin
  if to_regclass('public.attendance') is null then
    raise exception 'public.attendance is missing; migration stopped.';
  end if;
  if to_regclass('public.settings') is null then
    raise exception 'public.settings is missing; migration stopped.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance' and column_name = 'lat'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance' and column_name = 'lng'
  ) then
    raise exception 'Attendance coordinate columns are missing; review this database schema before applying.';
  end if;
end;
$$;

-- This keeps legacy attendance RPCs (which still have optional lat/lng parameters) accepting
-- coordinate-free requests. The old setting row may be absent; the RPC defaults to false.
update public.settings
set value = jsonb_set(
  case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end,
  '{gps_enabled}', 'false'::jsonb, true
), updated_at = now()
where key = 'app';

-- Defend the database boundary against older clients that still send coordinates.
-- INSERT-only is intentional: historical attendance rows are not changed on updates.
create or replace function public.clear_new_attendance_gps()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.lat := null;
  new.lng := null;
  return new;
end;
$$;

drop trigger if exists trg_attendance_no_gps on public.attendance;
create trigger trg_attendance_no_gps
  before insert on public.attendance
  for each row execute function public.clear_new_attendance_gps();
revoke all on function public.clear_new_attendance_gps() from public, anon, authenticated;

commit;
