-- AquaDior: safe, developer-only hard deletion for empty workers/projects.
-- Run this additive migration on the existing Supabase project; do not rerun
-- ALL-IN-ONE.sql just to enable these RPCs.
begin;

create or replace function public.developer_delete_worker(p_worker_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_role text;
  v_card_path text;
  v_deleted_id uuid;
begin
  if auth.uid() is null or not public.is_developer() then
    raise exception 'غير مسموح — حذف العامل متاح للمطوّر النشط فقط';
  end if;
  if p_worker_id is null or p_worker_id = auth.uid() then
    raise exception 'معرّف العامل غير صالح';
  end if;

  select p.role, p.id_card_url
    into v_role, v_card_path
  from public.profiles p
  where p.id = p_worker_id
  for update;

  if not found then
    raise exception 'العامل غير موجود';
  end if;
  if v_role <> 'worker' then
    raise exception 'يمكن حذف حساب عامل فقط من هذه الشاشة';
  end if;

  -- Keep every attendance, payroll, withdrawal, deduction, and settlement row.
  if exists (select 1 from public.attendance a where a.worker_id = p_worker_id)
     or exists (select 1 from public.withdrawals w where w.worker_id = p_worker_id)
     or exists (select 1 from public.deductions d where d.worker_id = p_worker_id)
     or exists (select 1 from public.settlements s where s.worker_id = p_worker_id) then
    raise exception 'لا يمكن حذف العامل لوجود حضور أو سجلات مالية/تسويات مرتبطة به؛ أوقف العامل بدلًا من حذف سجله';
  end if;

  -- Avoid breaking profile attribution and audit relationships on other records.
  if exists (select 1 from public.profiles p where p.approved_by = p_worker_id)
     or exists (select 1 from public.projects p where p.created_by = p_worker_id or p.archived_by = p_worker_id)
     or exists (select 1 from public.attendance a where a.created_by = p_worker_id)
     or exists (select 1 from public.withdrawals w where w.created_by = p_worker_id or w.decided_by = p_worker_id)
     or exists (select 1 from public.deductions d where d.created_by = p_worker_id)
     or exists (select 1 from public.settlements s where s.confirmed_by = p_worker_id) then
    raise exception 'لا يمكن حذف العامل لوجود سجلات أُنشئت أو اعتُمدت بحسابه؛ احتفظ بالحساب وأوقفه بدلًا من ذلك';
  end if;

  -- These are current assignments only, not attendance or financial history.
  delete from public.worker_projects where worker_id = p_worker_id;
  delete from public.site_workers where worker_id = p_worker_id;

  -- Auth owns the profile lifecycle; its FK cascade removes the profile while
  -- audit triggers retain a deletion record. Return the private card path so
  -- the authenticated client can remove the object through Supabase Storage API.
  delete from auth.users where id = p_worker_id
  returning id into v_deleted_id;
  if v_deleted_id is null then
    raise exception 'حساب المصادقة غير موجود؛ لم يتم حذف العامل';
  end if;

  return v_card_path;
end;
$$;

create or replace function public.developer_delete_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if auth.uid() is null or not public.is_developer() then
    raise exception 'غير مسموح — حذف المشروع متاح للمطوّر النشط فقط';
  end if;
  if p_project_id is null then
    raise exception 'معرّف المشروع غير صالح';
  end if;

  -- Serialize deletion against new activity and lock the project row first.
  perform 1 from public.projects p where p.id = p_project_id for update;
  if not found then
    raise exception 'المشروع غير موجود';
  end if;

  -- A linked attendance or any financial record is historical data: preserve it.
  if exists (select 1 from public.attendance a where a.project_id = p_project_id)
     or exists (select 1 from public.attendance_projects ap where ap.project_id = p_project_id)
     or exists (
       select 1
       from public.attendance_sites ats
       join public.sites s on s.id = ats.site_id
       where s.project_id = p_project_id
     )
     or exists (select 1 from public.withdrawals w where w.project_id = p_project_id)
     or exists (select 1 from public.deductions d where d.project_id = p_project_id)
     or exists (select 1 from public.settlements s where s.project_id = p_project_id) then
    raise exception 'لا يمكن حذف المشروع لوجود حضور أو حركات مالية/تسويات مرتبطة به؛ استخدم الأرشفة للحفاظ على السجلات';
  end if;

  -- Worker/project and legacy site links are assignments, not historical rows.
  delete from public.worker_projects where project_id = p_project_id;
  delete from public.site_workers sw
  using public.sites s
  where sw.site_id = s.id and s.project_id = p_project_id;
  delete from public.sites where project_id = p_project_id;
  delete from public.projects where id = p_project_id;
end;
$$;

-- The app deletes a worker's ID-card object through Storage's supported API.
-- No direct writes to the platform-owned storage table are performed here.
drop policy if exists "developer deletes worker cards" on storage.objects;
create policy "developer deletes worker cards" on storage.objects for delete to authenticated
  using (bucket_id = 'id-cards' and auth.uid() is not null and public.is_developer());

revoke all on function public.developer_delete_worker(uuid) from public, anon, authenticated;
revoke all on function public.developer_delete_project(uuid) from public, anon, authenticated;
grant execute on function public.developer_delete_worker(uuid) to authenticated;
grant execute on function public.developer_delete_project(uuid) to authenticated;

commit;
