import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { Notification } from "../../lib/types";
import { useAuth } from "../../store/auth";
import AppIcon from "../../components/AppIcon";

const LABELS: Record<string, string> = {
  insert: "إضافة",
  update: "تعديل",
  delete: "حذف",
};

export default function AuditLog() {
  const { profile } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"notif" | "audit">("notif");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError("");
    try {
      const [{ data: l, error: logError }, { data: n, error: notificationError }] = await Promise.all([
        supabase
          .from("audit_log")
          .select("*")
          .order("changed_at", { ascending: false })
          .limit(300),
        supabase
          .from("notifications")
          .select("*")
          .eq("user_id", profile.id)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (logError || notificationError) {
        throw new Error(logError?.message ?? notificationError?.message ?? "تعذر تحميل سجل الإدارة");
      }
      setLogs(l ?? []);
      setNotifs((n ?? []) as Notification[]);

      const ids = new Set<string>();
      (l ?? []).forEach((x: any) => x.changed_by && ids.add(x.changed_by));
      if (ids.size) {
        const { data: p, error: profilesError } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", [...ids]);
        if (profilesError) throw profilesError;
        const m: Record<string, string> = {};
        (p ?? []).forEach((x: any) => (m[x.id] = x.full_name));
        setNames(m);
      } else {
        setNames({});
      }
    } catch (caught: any) {
      setError(caught?.message ?? "تعذر تحميل سجل الإدارة");
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function markRead(id: string) {
    if (!profile) return;
    setBusyId(id);
    setError("");
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id)
      .eq("user_id", profile.id)
      .eq("is_read", false);
    if (updateError) setError(updateError.message ?? "تعذر تحديث الإشعار");
    else setNotifs((current) => current.map((item) => item.id === id ? { ...item, is_read: true } : item));
    setBusyId(null);
  }

  async function markAllRead() {
    if (!profile) return;
    setMarkingAll(true);
    setError("");
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", profile.id)
      .eq("is_read", false);
    if (updateError) setError(updateError.message ?? "تعذر تحديث الإشعارات");
    else setNotifs((current) => current.map((item) => ({ ...item, is_read: true })));
    setMarkingAll(false);
  }

  function describe(log: any): string {
    const t = log.table_name;
    const nm = names[log.changed_by] ?? "النظام";
    if (t === "attendance") {
      const d = (log.new_data ?? log.old_data)?.work_date ?? "";
      return `${nm} — ${LABELS[log.action]} حضور بتاريخ ${d}`;
    }
    if (t === "withdrawals") {
      const v = log.new_data ?? log.old_data;
      const name =
        names[v?.worker_id] ?? (v?.worker_id ? "عامل" : "");
      return `${nm} — ${LABELS[log.action]} فلوس (${v?.amount} ج.م) للعامل ${name}`;
    }
    if (t === "deductions") {
      const v = log.new_data ?? log.old_data;
      return `${nm} — ${LABELS[log.action]} خصم (${v?.amount} ج.م): ${v?.reason}`;
    }
    if (t === "profiles") {
      const v = log.new_data ?? log.old_data;
      return `${nm} — ${LABELS[log.action]} بيانات العامل ${v?.full_name}`;
    }
    if (t === "sites") {
      const v = log.new_data ?? log.old_data;
      return `${nm} — ${LABELS[log.action]} موقع قديم ${v?.name}`;
    }
    if (t === "projects") {
      const v = log.new_data ?? log.old_data;
      return `${nm} — ${LABELS[log.action]} مشروع ${v?.name}`;
    }
    return `${nm} — ${LABELS[log.action]} في ${t}`;
  }

  return (
    <>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="flex wrap mb">
        <button
          className={`btn btn-sm ${tab === "notif" ? "btn-primary" : ""}`}
          onClick={() => setTab("notif")}
        >
          <AppIcon name="bell" size={18} />
          الإشعارات
        </button>
        <button
          className={`btn btn-sm ${tab === "audit" ? "btn-primary" : ""}`}
          onClick={() => setTab("audit")}
        >
          <AppIcon name="shieldCheck" size={18} />
          سجل التعديلات الكامل
        </button>
      </div>

      {tab === "notif" && (
        <div className="card">
          <div className="card-title notification-toolbar">
            <span className="icon-label">
              <AppIcon name="bell" size={18} />
              <span>إشعارات حساب الإدارة</span>
            </span>
            <div className="flex notification-toolbar-actions">
              <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>تحديث</button>
              {notifs.some((item) => !item.is_read) && (
                <button className="btn btn-sm btn-ghost" onClick={() => void markAllRead()} disabled={markingAll}>
                  {markingAll ? "جاري التحديث…" : "قراءة الكل"}
                </button>
              )}
            </div>
          </div>
          {loading ? <div className="empty" role="status">جاري تحميل الإشعارات…</div> : notifs.length === 0 ? <div className="empty">مفيش إشعارات</div> : (
            <div className="notification-list">
              {notifs.map((n) => (
                <article className={`notification-item${n.is_read ? "" : " is-unread"}`} key={n.id}>
                  <div className="notification-icon" aria-hidden="true">
                    <AppIcon name="bell" size={19} />
                  </div>
                  <div className="notification-content">
                    <div className="notification-title">{n.title}</div>
                    {n.body && <div className="notification-body">{n.body}</div>}
                    <time className="small muted" dateTime={n.created_at}>{n.created_at?.slice(0, 10)} {n.created_at?.slice(11, 16)}</time>
                  </div>
                  {!n.is_read && <button className="btn btn-sm btn-ghost notification-read" aria-label={`تعليم «${n.title}» كمقروء`} onClick={() => void markRead(n.id)} disabled={busyId === n.id}>{busyId === n.id ? "…" : <AppIcon name="circleCheck" size={18} />}</button>}
                </article>
              ))}
            </div>
          )}
          {notifs.length === 100 && <p className="small muted center mt">يعرض آخر 100 إشعار.</p>}
        </div>
      )}

      {tab === "audit" && (
        <div className="card">
          <div className="card-title">
            <span>كل تعديل اتعمل في النظام — مين وإمتى وقد إيه</span>
          </div>
          <div className="table-wrap" role="region" aria-label="سجل التعديلات" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>العملية</th>
                  <th>التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="num small">
                      {l.changed_at?.slice(0, 10)} {l.changed_at?.slice(11, 16)}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          l.action === "delete"
                            ? "red"
                            : l.action === "update"
                            ? "amber"
                            : "green"
                        }`}
                      >
                        {LABELS[l.action]}
                      </span>
                    </td>
                    <td className="small">{describe(l)}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={3} className="center muted">
                      مفيش تعديلات
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
