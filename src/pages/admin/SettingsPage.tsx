import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { AppSettings } from "../../lib/types";
import { DEFAULT_SETTINGS } from "../../lib/types";

export default function SettingsPage() {
  const [app, setApp] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [tgToken, setTgToken] = useState("");
  const [tgChat, setTgChat] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase.from("settings").select("*");
    (data ?? []).forEach((r: any) => {
      if (r.key === "app") setApp({ ...DEFAULT_SETTINGS, ...r.value });
      if (r.key === "telegram") {
        setTgToken(r.value?.bot_token ?? "");
        setTgChat(r.value?.chat_id ?? "");
      }
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function saveApp() {
    setErr("");
    setBusy(true);
    const { error } = await supabase
      .from("settings")
      .update({ value: app, updated_at: new Date().toISOString() })
      .eq("key", "app");
    setBusy(false);
    if (error) return setErr(error.message);
    setMsg("تم حفظ الإعدادات ✅");
  }

  async function saveTg() {
    setErr("");
    setBusy(true);
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "telegram")
      .single();
    const { error } = await supabase
      .from("settings")
      .update({
        value: { ...(data?.value ?? {}), bot_token: tgToken.trim(), chat_id: tgChat.trim() },
        updated_at: new Date().toISOString(),
      })
      .eq("key", "telegram");
    setBusy(false);
    if (error) return setErr(error.message);
    setMsg("تم حفظ إعدادات تليجرام ✅");
  }

  async function testTg() {
    setErr("");
    setMsg("");
    if (!tgToken.trim() || !tgChat.trim())
      return setErr("اكتب التوكن والـ chat id الأول");
    setBusy(true);
    try {
      const r = await fetch(
        `https://api.telegram.org/bot${tgToken.trim()}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: tgChat.trim(),
            text: "✅ اختبار من تطبيق أكوا ديور للمقاولات — الإشعارات شغالة!",
          }),
        }
      );
      const j = await r.json();
      if (!j.ok) return setErr("فشل: " + (j.description ?? "خطأ غير معروف"));
      setMsg("تم الإرسال ✅ — شوف تليجرام");
    } catch (e: any) {
      setErr("فشل الإرسال: " + e.message);
    }
    setBusy(false);
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
            <span>خصم نسيان التسجيل (جنيه)</span>
            <input
              className="input"
              inputMode="decimal"
              value={app.absence_deduction}
              onChange={(e) =>
                setApp({ ...app, absence_deduction: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>العملة</span>
            <input
              className="input"
              value={app.currency}
              onChange={(e) => setApp({ ...app, currency: e.target.value })}
            />
          </label>
          <label className="field">
            <span>التحقق بالموقع (GPS)</span>
            <select
              className="input"
              value={app.gps_enabled ? "1" : "0"}
              onChange={(e) =>
                setApp({ ...app, gps_enabled: e.target.value === "1" })
              }
            >
              <option value="1">مفعّل (يسجّل المكان للمراجعة)</option>
              <option value="0">متوقف</option>
            </select>
          </label>
        </div>

        <p className="small muted mb">
          أي مبلغ فوق السقف بيحتاج موافقتك، واللي تحته بيعدّي لوحده.
        </p>

        <button className="btn btn-primary" onClick={saveApp} disabled={busy}>
          حفظ الإعدادات
        </button>
      </div>

      <div className="card">
        <div className="card-title">إشعارات تليجرام (مجانية)</div>
        <p className="small muted mb">
          اعمل Bot من <b>@BotFather</b> على تليجرام، انسخ التوكن، وبعدين ابعتله
          أي رسالة وخد الـ chat id من <code>@userinfobot</code>.
        </p>
        <label className="field">
          <span>Bot Token</span>
          <input
            className="input"
            dir="ltr"
            placeholder="123456:ABC-DEF..."
            value={tgToken}
            onChange={(e) => setTgToken(e.target.value)}
          />
        </label>
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
{`supabase functions deploy notify-telegram

# جدول التقرير اليومي (كل يوم 9 مساءً)
# Supabase Dashboard → Edge Functions → Cron
# 0 18 * * *  →  notify-telegram?action=daily`}
        </pre>
      </div>
    </>
  );
}
