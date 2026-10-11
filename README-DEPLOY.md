# 🚀 النشر على Cloudflare Pages — خطوة بخطوة

## 1️⃣ ارفع الكود على GitHub

| # | اعمل إيه |
|---|---|
| 1 | افتح https://github.com/new |
| 2 | اسم الـ repo: `worker-app` |
| 3 | خليه **Private** |
| 4 | دوس **Create repository** |
| 5 | في صفحة الـ repo دوس: **uploading an existing file** |
| 6 | **اسحب ملف `worker-app-upload.zip`** — أو افتحه وارفع الملفات اللي جوه |
| 7 | دوس **Commit changes** |

> ⚠️ **مترفعش** `.env` ولا `node_modules` ولا `dist` — دول بيتعملوا لوحدهم.

---

## 2️⃣ اربط Cloudflare Pages بـ GitHub

| # | اعمل إيه |
|---|---|
| 1 | افتح https://dash.cloudflare.com |
| 2 | من القائمة: **Workers & Pages** |
| 3 | دوس **Create** → **Pages** → **Connect to Git** |
| 4 | اختار repo: **worker-app** |
| 5 | املا الإعدادات: |

| الإعداد | القيمة |
|---|---|
| **Framework preset** | `Vite` |
| **Build command** | `npm run build` |
| **Build output directory** | `dist` |
| **Root directory** | `/` (سيبها فاضية) |

### Environment variables (مهم جدًا!)

دوس **Add variable** وضيف الاتنين دول:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://cgqwzwnxhbayghramabo.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | الـ anon key بتاعتك |

> ⚠️ دوس **Save and Deploy** — استنى دقيقة وجاهز ✅

---

## 3️⃣ اللينك جاهز

```
https://worker-app.pages.dev
```

**ابعت اللينك ده للعمال على الواتساب** 📲

---

# 🔄 بعد كده — أي تعديل

```bash
git add .
git commit -m "تعديل"
git push
```

**Cloudflare هينشر لوحده في دقيقة** ✅

---

# 🔑 لو عايز تستخدم GitHub Actions بدل Connect to Git

الملف `.github/workflows/deploy.yml` جاهز. بس محتاج تضيف 4 Secrets في:
`GitHub → Settings → Secrets and variables → Actions → New repository secret`

| Secret | منين |
|---|---|
| `VITE_SUPABASE_URL` | `https://cgqwzwnxhbayghramabo.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | الـ anon key |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare → Workers & Pages (مكتوب في اليمين) |

