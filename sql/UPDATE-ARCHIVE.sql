-- ============================================================
--  ██  UPDATE ARCHIVE — مين قفل المشروع  ██
--  شغّل الملف ده في SQL Editor واعمل Run
-- ============================================================

-- 1) نمسح الـ view القديمة ونعيد إنشاءها (الترتيب اتغيّر)
drop view if exists project_archive cascade;

create view project_archive as
select
  p.id            as project_id,
  p.name          as project_name,
  p.start_date,
  p.closed_at,
  p.archived_at,
  (select full_name from profiles pr where pr.id = p.archived_by) as archived_by_name,
  (select count(*) from worker_projects wp where wp.project_id = p.id) as workers_count,
  (select count(*) from attendance a where a.project_id = p.id)         as attendance_count,
  (select coalesce(sum(amount),0) from withdrawals wd where wd.project_id = p.id) as total_withdrawn,
  (select coalesce(sum(amount),0) from deductions d where d.project_id = p.id)    as total_deductions,
  (select coalesce(sum(net_amount),0) from settlements s where s.project_id = p.id) as total_paid
from projects p
where p.status = 'closed'
order by p.closed_at desc;

-- 2) الدالة بتاعة تصدير بيانات المشروع (بتضيف "مين قفل")
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
        'closed_at', p.closed_at, 'archived_at', p.archived_at,
        'archived_by', p.archived_by,
        'archived_by_name', (select full_name from profiles pr where pr.id = p.archived_by)
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
