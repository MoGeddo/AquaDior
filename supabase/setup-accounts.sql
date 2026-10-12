-- الحسابات الإدارية تُنشأ وتُدار من Supabase Authentication Dashboard
-- أو عبر خدمة خلفية موثوقة تستخدم Service Role Key.
--
-- هذا الملف متروك عمداً دون أوامر إنشاء/ترقية حسابات:
--   * لا تضع كلمات مرور أو أرقام هواتف حقيقية في Git أو SQL محفوظ.
--   * لا تُدرج صفوفاً مباشرة في auth.users ولا تستخدم كلمة مرور مشتركة.
--   * مشغّل Auth ينشئ حسابات لوحة Supabase كعوامل معلّقين ومعطّلين افتراضيًا.
--   * تهيئة أول مالك تتم يدويًا بعد مطابقة UUID والبريد، حسب الخطوات في README.md.
--   * بعد ذلك، أنشئ الحسابات الإدارية من إجراء نشر داخلي آمن يراجعه مالك قاعدة البيانات.
--
-- بعد التهيئة، افحص الصلاحيات النشطة بهذه القراءة فقط:
select id, username, full_name, role, status, is_active
from public.profiles
where role in ('owner', 'manager', 'developer')
order by role, username;
