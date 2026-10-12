import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../store/auth";
import ExternalPushSettings from "../../components/ExternalPushSettings";

export default function SettingsPage() {
  const { profile } = useAuth();
  const [tgChat, setTgChat] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "telegram")
      .maybeSingle();
    if (error) {
      setErr(`تعذر تحميل إعدادات تليجرام: ${error.message}`);
      return;
    }
    const telegramSettings = data?.value as Record<string, unknown> | null;
    setTgChat(typeof telegramSettings?.chat_id === "string" ? telegramSettings.chat_id : "");
  }

  useEffect(() => {
    load();
  }, []);

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
      {err && <div className="alert error">{err}</div>}
      {msg && <div className="alert success">{msg}</div>}
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
