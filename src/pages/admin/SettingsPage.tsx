import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { arabicError } from "../../lib/errors";
import { useAuth } from "../../store/auth";
import ExternalPushSettings from "../../components/ExternalPushSettings";
import AppIcon from "../../components/AppIcon";

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
      setErr(`تعذر تحميل إعدادات تليجرام: ${arabicError(error, "حاول مرة أخرى.")}`);
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
      setMsg("تم حفظ إعدادات تليجرام");
    } catch (error: any) {
      setErr(arabicError(error, "تعذر حفظ إعدادات تليجرام."));
    } finally {
      setBusy(false);
    }
  }

  async function testTg() {
    setErr("");
    setMsg("");
    if (!tgChat.trim()) return setErr("اكتب معرّف المحادثة واحفظه أولًا.");
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("notify-telegram", {
        body: { action: "test" },
      });
      if (error || !data?.ok) throw error ?? new Error("فشل إرسال الاختبار");
      setMsg("تم الإرسال — شوف تليجرام");
    } catch (error: any) {
      setErr(arabicError(error, "فشل إرسال الرسالة التجريبية؛ تحقّق من إعداد خدمة الإرسال وأسرارها."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {err && <div className="alert error">{err}</div>}
      {msg && <div className="alert success" role="status"><span className="icon-label"><AppIcon name="circleCheck" size={17} /><span>{msg}</span></span></div>}
      {profile && <ExternalPushSettings userId={profile.id} />}

      <div className="card">
        <div className="card-title">
          <span className="icon-label"><AppIcon name="bell" size={18} /><span>إشعارات تليجرام (مجانية)</span></span>
        </div>
        <p className="small muted mb">
          احتفظ برمز البوت في الإعدادات السرية للمشروع فقط، ولا تكتبه في التطبيق أو قاعدة البيانات. أدخل معرّف المحادثة أدناه.
        </p>
        <label className="field">
          <span>معرّف المحادثة</span>
          <input
            className="input"
            dir="ltr"
            placeholder="123456789"
            value={tgChat}
            onChange={(e) => setTgChat(e.target.value)}
          />
        </label>
        <div className="flex wrap">
          <button className="btn btn-primary" onClick={saveTg} disabled={busy}>
            حفظ
          </button>
          <button className="btn" onClick={testTg} disabled={busy}>
            إرسال اختبار
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <span className="icon-label"><AppIcon name="calendarCheck" size={18} /><span>التقرير اليومي التلقائي</span></span>
        </div>
        <p className="small muted mb">
          لإرسال التقرير يوميًا إلى تليجرام، يحتاج المطوّر إلى إعداد خدمة الإرسال ومهمة مجدولة في لوحة المشروع. تُحفظ مفاتيح الربط كأسرار، ولا تُكتب في التطبيق أو قاعدة البيانات.
        </p>
      </div>
    </>
  );
}
