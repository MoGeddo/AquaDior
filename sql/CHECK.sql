-- ============================================================
--  ██  فحص سريع — شغّل الملف ده وقولي اللي طلع  ██
-- ============================================================

select '١. الجداول'            as "الخطوة", count(*)::text as "العدد" from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
union all
select '٢. الصلاحيات (الحماية)', count(*)::text from pg_policies where schemaname='public'
union all
select '٣. الدوال',             count(*)::text from information_schema.routines where routine_schema='public'
union all
select '٤. Triggers',           count(*)::text from information_schema.triggers where trigger_schema='public'
union all
select '٥. العروض (Views)',     count(*)::text from information_schema.views where table_schema='public'
union all
select '٦. حسابات الإدارة',      count(*)::text from public.profiles where role in ('owner','developer')
order by 1;
