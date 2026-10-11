-- ============================================================
--  ██  قائمة كل الدوال الموجودة فعلاً  ██
-- ============================================================
select proname as "اسم الدالة",
       pg_get_function_identity_arguments(oid) as "الباراميترات"
from pg_proc
where pronamespace = 'public'::regnamespace
order by proname;
