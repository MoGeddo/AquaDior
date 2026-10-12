import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Notification } from "../lib/types";
import { Modal } from "./Modal";
import ExternalPushSettings from "./ExternalPushSettings";

const ICONS: Record<string, string> = {
  account_approved: "✅",
  account_rejected: "⚠️",
  account_suspended: "⛔",
  project_assigned: "🏗️",
  project_unassigned: "📍",
  project_archived: "📦",
  project_created: "🏗️",
  project_deleted: "🗑️",
  project_assignment: "👷",
  deduction_new: "📉",
  deduction_reversed: "↩️",
  withdrawal_new: "💵",
  withdrawal_decision: "💳",
  attendance_new: "📅",
  settlement_paid: "🧾",
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function NotificationCenter({
  userId,
  unreadCount,
  onClose,
  onUnreadChange,
}: {
  userId: string;
  unreadCount: number;
  onClose: () => void;
  onUnreadChange: (change: number | "refresh") => void;
}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: queryError } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (queryError) {
      setError(queryError.message ?? "تعذر تحميل الإشعارات");
      setItems([]);
    } else {
      setItems((data ?? []) as Notification[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    setBusyId(id);
    setError("");
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("is_read", false);
    if (updateError) {
      setError(updateError.message ?? "تعذر تحديث الإشعار");
      setBusyId(null);
      return;
    }
    setItems((current) => current.map((item) => item.id === id ? { ...item, is_read: true } : item));
    onUnreadChange(-1);
    setBusyId(null);
  }

  async function markAllRead() {
    setMarkingAll(true);
    setError("");
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);
    if (updateError) {
      setError(updateError.message ?? "تعذر تحديث الإشعارات");
    } else {
      setItems((current) => current.map((item) => ({ ...item, is_read: true })));
      onUnreadChange("refresh");
    }
    setMarkingAll(false);
  }

  const unreadInFeed = items.filter((item) => !item.is_read).length;

  return (
    <Modal title="إشعاراتك" onClose={onClose}>
      <ExternalPushSettings userId={userId} />

      <div className="flex-between mb">
        <span className="small muted" aria-live="polite">
          {unreadCount ? `${unreadCount} غير مقروء إجمالًا` : "كل الإشعارات مقروءة"} · آخر 100 إشعار{unreadInFeed > 0 && unreadInFeed !== unreadCount ? `، ${unreadInFeed} منها في القائمة` : ""}
        </span>
        <div className="flex" style={{ gap: 8 }}>
          <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
            تحديث
          </button>
          {unreadCount > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={() => void markAllRead()} disabled={markingAll}>
              {markingAll ? "جاري التحديث…" : "قراءة الكل"}
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}
      {loading ? (
        <div className="empty" role="status">جاري تحميل الإشعارات…</div>
      ) : items.length === 0 ? (
        <div className="empty">مفيش إشعارات لحد دلوقتي.</div>
      ) : (
        <div className="notification-list" aria-live="polite">
          {items.map((item) => (
            <article
              className={`notification-item${item.is_read ? "" : " is-unread"}`}
              key={item.id}
            >
              <div className="notification-icon" aria-hidden="true">{ICONS[item.type] ?? "🔔"}</div>
              <div className="notification-content">
                <div className="notification-title">{item.title}</div>
                {item.body && <div className="notification-body">{item.body}</div>}
                <time className="small muted" dateTime={item.created_at}>{formatDate(item.created_at)}</time>
              </div>
              {!item.is_read && (
                <button
                  className="btn btn-sm btn-ghost notification-read"
                  aria-label={`تعليم «${item.title}» كمقروء`}
                  title="تعليم كمقروء"
                  onClick={() => void markRead(item.id)}
                  disabled={busyId === item.id}
                >
                  {busyId === item.id ? "…" : "✓"}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      {items.length === 100 && <p className="small muted center mt">لرؤية الأحدث اضغط «تحديث»؛ يُعرض آخر 100 إشعار.</p>}
    </Modal>
  );
}
