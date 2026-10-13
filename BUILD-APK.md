# بناء APK لأندرويد

يُبنى APK عبر GitHub Actions من `.github/workflows/build-apk.yml`، يدويًا من تبويب **Actions → Build APK → Run workflow** أو عند تحديث `main` أو فرع `arena/**`. يشغّل المسار `npm ci` ثم lint وSmoke Test وTypeScript/production build؛ أي فشل يوقف البناء. بناء الفروع يرفع Artifact للتنزيل فقط ولا يستبدل إصدار Releases.

## إصدار التشغيل الحقيقي

يُبنى APK فقط إذا ضُبط كل من `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY` ضمن **Repository Variables**. عند غياب أي منهما يفشل الـworkflow بدل إنتاج تطبيق تجريبي أو يعرض بيانات وهمية. Demo متاح محليًا للاختبار الصريح فقط.

يولّد الـworkflow أيقونات Android من `assets/icon.svg` قبل Gradle، بالإضافة إلى favicon وPWA icons من `public/`. لا تضع Service Role Key أو Bot Token في متغيرات `VITE_`. إعداد Supabase الحقيقي ومخاطر المصادقة/RLS موضحة في [`README.md`](./README.md).

## سر توقيع Android

مفتاح التوقيع وكلمات مروره لا تُحفظ في Git أو workflow. يمكن بناء **APK تصحيح قابل للتثبيت** بدون هذه الأسرار؛ أما إصدار APK موقّع مناسب للتحديث فوق النسخة المنشورة فيحتاج الأسرار التالية في **GitHub → Settings → Secrets and variables → Actions → Repository secrets**:

- `KEYSTORE_BASE64`: ملف keystore مشفّر Base64.
- `KEYSTORE_PASSWORD`: كلمة مرور keystore.
- `KEYSTORE_ALIAS`: الاسم الذي اخترته للمفتاح.

أنشئ keystore محليًا باستخدام `keytool`، واختر كلمة مرور قوية واستخدم كلمة المرور نفسها للمفتاح والـ keystore (عند سؤال keytool عن كلمة مرور المفتاح اضغط Enter لاستخدام نفسها). احتفظ بنسخة احتياطية آمنة خارج المستودع؛ فقدان المفتاح يمنع تثبيت التحديثات فوق APK السابق.

```bash
keytool -genkeypair -keystore AquaDior-release.keystore -alias aquadior -keyalg RSA -keysize 2048 -validity 10950
```

على Linux/macOS أنشئ قيمة Base64 مثلًا هكذا:

```bash
base64 -w0 AquaDior-release.keystore
```

في PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('AquaDior-release.keystore'))
```

انسخ الناتج إلى Secret `KEYSTORE_BASE64` من واجهة GitHub، ولا تحفظه في ملف داخل المستودع. عند توفر الأسرار يصدر workflow `AquaDior.apk` الموقّع و`AquaDior-debug.apk` منفصلًا، ويتحقق من التوقيع قبل نشر إصدار `main`. عند غيابها، يبني `AquaDior-debug.apk` ويرفعه كـArtifact فقط. نسخة Debug قابلة للتثبيت، لكنها قد تتطلب إزالة النسخة المنشورة أولًا بسبب اختلاف مفتاح التوقيع؛ لا تستخدمها كتحديث فوق نسخة Release.

## ما لم يُختبر

تم اختبار build الويب وSmoke Test داخل بيئة التطوير، لكن بناء APK الفعلي يتطلب أسرار التوقيع وبيئة Android/GitHub Actions؛ لم يتم تشغيله في هذه المراجعة. كذلك إصدار APK متصل بـSupabase يتطلب متغيرات المشروع في GitHub واختبارًا منفصلًا على جهاز حقيقي.
