import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { AppSettings } from "../../lib/types";
import { DEFAULT_SETTINGS } from "../../lib/types";
import { useAuth } from "../../store/auth";
import ExternalPushSettings from "../../components/ExternalPushSettings";

export default function SettingsPage() {
  const { profile } = useAuth();
  const [app, setApp] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [tgChat, setTgChat] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase.from("settings").select("*");
    if (error) {
      setErr(`تعذر تحميل الإعدادات: ${error.message}`);
      return;
    }
    (data ?? []).forEach((r: any) => {
      if (r.key === "app") setApp({ ...DEFAULT_SETTINGS, ...r.value });
      if (r.key === "telegram") setTgChat(r.value?.chat_id ?? "");
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function saveApp() {
    setErr("");
    setMsg("");
    const limit = Number(app.auto_approve_limit);
    if (!Number.isFinite(limit) || limit < 0 || limit >= 100000000) {
      setErr("سقف الموافقة يجب أن يكون بين صفر و 99,999,999.99");
      return;
    }
    if (typeof app.currency !== "string" || app.currency.trim().length > 20) {
      setErr("رمز العملة طويل جدًا أو غير صحيح");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from("settings").upsert(
        {
          key: "app",
          value: { ...app, auto_approve_limit: limit, currency: app.currency.trim() || "ج.م" },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );
      if (error) throw error;
      setApp((current) => ({ ...current, auto_approve_limit: limit, currency: current.currency.trim() || "ج.م" }));
      setMsg("تم حفظ الإعدادات ✅");
    } catch (error: any) {
      setErr(error?.message ?? "تعذر حفظ الإعدادات");
    } finally {
      setBusy(false);
    }
  }

  async function saveTg() {
    setErr("");
    setMsg("");
    setBusy(true);
    try {
      const { data, error: readError } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "telegram")
        .maybeSingle();
      if (readError) throw readError;
      const value = { ...(data?.value ?? {}), chat_id: tgChat.trim() };
      delete value.bot_token;
      const { error } = await supabase.from("settings").upsert(
        { key: "telegram", value, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
      if (error) throw error;
      setMsg("تم حفظ إعدادات تليجرام ✅");
    } catch (error: any) {
      setErr(error?.message ?? "تعذر حفظ إعدادات تليجرام");
    } finally {
      setBusy(false);
    }
  }

  async function testTg() {
    setErr("");
    setMsg("");
    if (!tgChat.trim()) return setErr("اكتب الـ chat id واحفظه أولاً");
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("notify-telegram", {
        body: { action: "test" },
      });
      if (error || !data?.ok) throw error ?? new Error("فشل إرسال الاختبار");
      setMsg("تم الإرسال ✅ — شوف تليجرام");
    } catch (error: any) {
      setErr(error?.message ?? "فشل إرسال الاختبار؛ تحقق من نشر Edge Function وإعداد أسرارها");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-title">الإعدادات العامة</div>
        {err && <div className="alert error">{err}</div>}
        {msg && <div className="alert success">{msg}</div>}

        <div className="grid-2">
          <label className="field">
            <span>سقف الأخذ التلقائي (جنيه)</span>
            <input
              className="input"
              inputMode="decimal"
              value={app.auto_approve_limit}
              onChange={(e) =>
                setApp({ ...app, auto_approve_limit: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>عملة إشعارات وتقارير تليجرام</span>
            <input
              className="input"
              maxLength={20}
              value={app.currency}
              onChange={(e) => setApp({ ...app, currency: e.target.value })}
            />
          </label>
          <label className="field">
            <span>تسجيل موقع الحضور (GPS)</span>
            <select
              className="input"
              value={app.gps_enabled ? "1" : "0"}
              onChange={(e) =>
                setApp({ ...app, gps_enabled: e.target.value === "1" })
              }
            >
              <option value="1">مفعّل — يحفظ الإحداثيات للمراجعة فقط</option>
              <option value="0">متوقف — لا يطلب الموقع</option>
            </select>
          </label>
        </div>

        <p className="small muted mb">
          أي مبلغ فوق السقف بيحتاج موافقتك، واللي تحته بيعدّي لوحده. رمز العملة يخص رسائل تليجرام فقط؛ عرض المبالغ داخل التطبيق بالجنيه المصري.
        </p>
        <div className="alert info mb">
          خصم الغياب الآلي وموعد قفل اليوم غير مفعّلين في هذه النسخة؛ الحضور لا يُخصم تلقائيًا بسبب الغياب.
        </div>

        <button className="btn btn-primary" onClick={saveApp} disabled={busy}>
          حفظ الإعدادات
        </button>
      </div>

      {profile && <ExternalPushSettings userId={profile.id} />}

      <div className="card">
        <div className="card-title">إشعارات تليجرام (مجانية)</div>
        <p className="small muted mb">
          احتفظ بتوكن البوت كسرّ في إعدادات Supabase Edge Functions فقط، ولا تضعه في التطبيق أو قاعدة البيانات.
          حدّد <code>TELEGRAM_BOT_TOKEN</code> عبر Supabase CLI، ثم أدخل Chat ID هنا.
        </p>
        <label className="field">
          <span>Chat ID</span>
          <input
            className="input"
            dir="ltr"
            placeholder="123456789"
            value={tgChat}
            onChange={(e) => setTgChat(e.target.value)}
          />
        </label>
        <div className="flex">
          <button className="btn btn-primary" onClick={saveTg} disabled={busy}>
            حفظ
          </button>
          <button className="btn" onClick={testTg} disabled={busy}>
            إرسال اختبار
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">التقرير اليومي التلقائي</div>
        <p className="small muted mb">
          عشان التقرير يوصل كل يوم على تليجرام، نشر الـ Edge Function:
        </p>
        <pre
          dir="ltr"
          style={{
            background: "#0f172a",
            color: "#e2e8f0",
            padding: 14,
            borderRadius: 12,
            fontSize: 13,
            overflowX: "auto",
          }}
        >
{`# خزّن الأسرار خارج التطبيق/قاعدة البيانات
supabase secrets set TELEGRAM_BOT_TOKEN='YOUR_BOT_TOKEN' TELEGRAM_CRON_SECRET='LONG_RANDOM_SECRET' APP_ORIGIN='https://your-app.example'
supabase functions deploy notify-telegram

# أعدّ مجدولاً يرسل POST إلى:
# https://YOUR_PROJECT.supabase.co/functions/v1/notify-telegram?action=daily
# مع الترويسة x-cron-secret: LONG_RANDOM_SECRET
# لا تضع السر في مستودع Git أو في واجهة التطبيق.`}
        </pre>
      </div>
    </>
  );
}
