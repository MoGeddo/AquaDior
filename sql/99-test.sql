-- ============================================================
--  ██  اختبار سريع بعد تشغيل ALL-IN-ONE.sql  ██
--  شغّل الملف ده. لازم كل سطر يطلع Success.
-- ============================================================

-- 1) الجداول الأساسية (لازم ترجع 10)
select count(*) as "عدد الجداول (المفروض 10)" from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE';

-- 2) الحسابات الإدارية (المفروض 3: مالكين + مطوّر)
select username, full_name, role, is_active from public.profiles
order by role desc, username;

-- 3) صلاحيات العامل (لازم يلاقي row)
select count(*) as "عدد الصلاحيات (المفروض > 0)" from pg_policies
where schemaname = 'public';

-- 4) الدوال (المفروض 8+)
select routine_name from information_schema.routines
where routine_schema = 'public' order by routine_name;

-- 5) العروض (المفروض admin_users + project_archive)
select table_name from information_schema.views where table_schema = 'public';

-- 6) الـ triggers
select trigger_name, event_object_table from information_schema.triggers
where trigger_schema = 'public' order by event_object_table, trigger_name;

-- 7) الـ storage bucket للبطاقات
select id, name, public from storage.buckets where id = 'id-cards';

-- 8) الإعدادات
select key, value from public.settings;
