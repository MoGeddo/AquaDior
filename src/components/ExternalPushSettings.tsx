import { useEffect, useMemo, useState } from "react";
import {
  disableExternalPush,
  enableExternalPush,
  externalPushConfigured,
  externalPushEnabledLocally,
  externalPushIsNative,
  getExternalPushEnabled,
  prepareExternalPush,
} from "../lib/push";
import AppIcon from "./AppIcon";

function isIosBrowser() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isInstalledPwa() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export default function ExternalPushSettings({ userId }: { userId: string }) {
  const configured = externalPushConfigured();
  const native = externalPushIsNative();
  const needsIosInstall = useMemo(() => !native && isIosBrowser() && !isInstalledPwa(), [native]);
  const [enabled, setEnabled] = useState(() => configured && externalPushEnabledLocally(userId));
  const [checking, setChecking] = useState(configured);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!configured) {
      setChecking(false);
      setEnabled(false);
      return;
    }
    void Promise.all([
      prepareExternalPush().catch(() => undefined),
      getExternalPushEnabled(userId),
    ]).then(([, isEnabled]) => {
      if (!active) return;
      setEnabled(isEnabled ?? externalPushEnabledLocally(userId));
      setChecking(false);
    });
    return () => { active = false; };
  }, [configured, userId]);

  async function turnOn() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await enableExternalPush(userId);
      setEnabled(true);
      setMessage("تم تفعيل الإشعارات على هذا الجهاز");
    } catch (reason: any) {
      setError(reason?.message ?? "تعذر تفعيل الإشعارات. تحقق من إذن الإشعارات ثم أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await disableExternalPush(userId);
      setEnabled(false);
      setMessage("تم إيقاف الإشعارات الخارجية على هذا الجهاز.");
    } catch (reason: any) {
      setError(reason?.message ?? "تعذر إيقاف الإشعارات.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card external-push-settings" aria-labelledby="external-push-title">
      <div className="card-title" id="external-push-title">
        <span className="icon-label"><AppIcon name="bell" size={18} /><span>إشعارات الهاتف الخارجية</span></span>
      </div>
      <p className="small muted mb">
        استقبل تنبيهًا على الهاتف عند وصول إشعار جديد حتى لو كان التطبيق مغلقًا. يُستخدم معرّف حسابك لتوجيهه لجهازك، ولا تظهر تفاصيل الحساب أو المبالغ على شاشة القفل.
      </p>
      {!configured ? (
        <div className="alert info" role="status">
          الإشعارات جاهزة في التطبيق، لكنها تنتظر ربط حساب OneSignal وإعداد مفاتيح الإرسال.
        </div>
      ) : needsIosInstall ? (
        <div className="alert info" role="status">
          على iPhone من المتصفح (iOS 16.4 فأحدث)، أضف التطبيق أولًا إلى الشاشة الرئيسية من Safari، أو استخدم نسخة TestFlight عند تجهيزها، ثم فعّل الإشعارات.
        </div>
      ) : (
        <div className="flex" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <span className="small muted" aria-live="polite">
            {checking ? "جاري التحقق من الإذن…" : enabled ? "مفعّلة على هذا الجهاز" : "غير مفعّلة على هذا الجهاز"}
          </span>
          {enabled ? (
            <button className="btn btn-ghost" onClick={() => void turnOff()} disabled={busy || checking}>
              {busy ? "جاري الإيقاف…" : "إيقاف الإشعارات"}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void turnOn()} disabled={busy || checking}>
              {busy ? "جاري التفعيل…" : "تفعيل إشعارات الهاتف"}
            </button>
          )}
        </div>
      )}
      {message && <div className="alert success mt" role="status"><span className="icon-label"><AppIcon name="circleCheck" size={17} /><span>{message}</span></span></div>}
      {error && <div className="alert error mt" role="alert">{error}</div>}
    </section>
  );
}
