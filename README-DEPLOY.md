# نشر AquaDior على Cloudflare Pages

## قبل النشر

1. جهّز Supabase staging، وطبّق SQL القانوني بعد نسخة احتياطية. اتبع إعداد المصادقة وأول مالك في [`README.md`](./README.md).
2. شغّل محليًا:

```bash
npm ci
npm run lint
npm run build
npm run test:smoke
```

3. اختبر تسجيل الدخول والأدوار وسياسات RLS في staging؛ Smoke Test وحده لا يختبر قاعدة حقيقية.

## إعداد Cloudflare Pages

1. افتح **Workers & Pages → Create → Pages → Connect to Git**، ثم اختر مستودع AquaDior.
2. اضبط:

| الإعداد | القيمة |
|---|---|
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` |

3. أضف متغيرات البناء في **Settings → Environment variables** لكل من Production وPreview:

| المتغير | القيمة |
|---|---|
| `VITE_SUPABASE_URL` | عنوان مشروع Supabase الخاص بك |
| `VITE_SUPABASE_ANON_KEY` | المفتاح العام anon/publishable للمشروع |
| `VITE_DEMO_MODE` | `0` أو اتركه غير مضبوط عند النشر الحقيقي |

لا تضف Service Role Key أو كلمة مرور أو Bot Token إلى متغير يبدأ بـ `VITE_`؛ كل ما يبدأ به يُضمّن في ملفات المتصفح. يسمح `VITE_DEMO_MODE=1` بتشغيل بيانات وهمية محلية فقط، ولا يصلح لنشر الإنتاج أو حفظ بيانات حقيقية.

4. نفّذ النشر، ثم اختبر صفحة الدخول والتسجيل ومسارات التطبيق على رابط HTTPS النهائي. أعد ضبط `APP_ORIGIN` في أسرار Edge Function إلى نفس أصل الموقع إذا كنت تستخدم Telegram.

## PWA وSPA

المستودع يتضمن `public/_redirects` لإعادة توجيه مسارات SPA إلى `index.html`. ملفات الواجهة الثابتة تُخزّن عبر Service Worker، لكن بيانات Supabase لا تُخزّن في كاش PWA. طابور IndexedDB لا يغني عن اختبار سيناريوهات الاتصال الفعلية.

## ملاحظة

الـ workflow الموجود في `.github/workflows/build-apk.yml` خاص ببناء APK فقط؛ لا يوجد workflow نشر تلقائي إلى Cloudflare في هذا المستودع. Cloudflare Pages يبني عند ربطه مباشرةً بـ GitHub.
