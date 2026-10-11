-- ============================================================
--  حسابات الإدارة — الملاك + المطوّر
--  شغّل الملف ده بعد schema → policies → triggers → functions
-- ============================================================

do $$
declare
  v_password text := 'Qn&112233#Do';   -- كلمة السر المشتركة
begin

  -- ============ 1) المالك: عابدين يونس ============
  if not exists (select 1 from profiles where phone = '01111663393') then
    perform create_worker(
      'عابدين يونس'::text, '01111663393'::text, v_password, 0::numeric, null::uuid[], null::uuid
    );
  end if;

  update profiles set
    role = 'owner', username = 'abden.younes', full_name = 'عابدين يونس',
    status = 'active', is_active = true, daily_wage = 0::numeric,
    approved_at = now()
  where phone = '01111663393';

  -- ⚠️ مهم: خلّي إيميل الدخول = اليوزر نيم
  update auth.users set
    email = 'abden.younes@ommal.app', email_confirmed_at = now()
  where id = (select id from profiles where phone = '01111663393');


  -- ============ 2) المالك: محمود عبدين ============
  if not exists (select 1 from profiles where phone = '01100613051') then
    perform create_worker(
      'محمود عبدين'::text, '01100613051'::text, v_password, 0::numeric, null::uuid[], null::uuid
    );
  end if;

  update profiles set
    role = 'owner', username = 'mahmoud.abdin', full_name = 'محمود عبدين',
    status = 'active', is_active = true, daily_wage = 0::numeric,
    approved_at = now()
  where phone = '01100613051';

  update auth.users set
    email = 'mahmoud.abdin@ommal.app', email_confirmed_at = now()
  where id = (select id from profiles where phone = '01100613051');


  -- ============ 3) المطوّر: Mostafa Geddo ============
  if not exists (select 1 from profiles where phone = '01124965576') then
    perform create_worker(
      'Mostafa Geddo'::text, '01124965576'::text, v_password, 0::numeric, null::uuid[], null::uuid
    );
  end if;

  update profiles set
    role = 'developer', username = 'MostafaGeddo', full_name = 'Mostafa Geddo',
    status = 'active', is_active = true, daily_wage = 0::numeric,
    approved_at = now()
  where phone = '01124965576';

  update auth.users set
    email = 'mostafageddo@ommal.app', email_confirmed_at = now()
  where id = (select id from profiles where phone = '01124965576');


  raise notice 'تم إنشاء حسابات الملاك والمطور بالأرقام الحقيقية';
end $$;

-- ============================================================
--  التحقق — لازم تشوف 3 صفوف
-- ============================================================
select phone, username, full_name, role, status from profiles
where role in ('owner','developer') order by role, username;
