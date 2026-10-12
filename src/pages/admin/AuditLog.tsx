import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { Notification } from "../../lib/types";
import { useAuth } from "../../store/auth";

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

  async function load() {
    const [{ data: l }, { data: n }] = await Promise.all([
      supabase
        .from("audit_log")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(300),
      supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    setLogs(l ?? []);
    setNotifs((n ?? []) as Notification[]);

    const ids = new Set<string>();
    (l ?? []).forEach((x: any) => x.changed_by && ids.add(x.changed_by));
    if (ids.size) {
      const { data: p } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", [...ids]);
      const m: Record<string, string> = {};
      (p ?? []).forEach((x: any) => (m[x.id] = x.full_name));
      setNames(m);
    }
  }

  useEffect(() => {
    load();
    // علّم إشعاراتي كمقروءة
    if (profile) {
      supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", profile.id)
        .eq("is_read", false)
        .then(() => {});
    }
  }, [profile]);

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
      <div className="flex mb">
        <button
          className={`btn btn-sm ${tab === "notif" ? "btn-primary" : ""}`}
          onClick={() => setTab("notif")}
        >
          🔔 الإشعارات
        </button>
        <button
          className={`btn btn-sm ${tab === "audit" ? "btn-primary" : ""}`}
          onClick={() => setTab("audit")}
        >
          🛡️ سجل التعديلات الكامل
        </button>
      </div>

      {tab === "notif" && (
        <div className="card">
          <div className="card-title">كل الإشعارات</div>
          {notifs.length === 0 && <div className="empty">مفيش إشعارات</div>}
          {notifs.map((n) => (
            <div className="row" key={n.id}>
              <div>
                <div className="main">{n.title}</div>
                <div className="meta">{n.body}</div>
              </div>
              <span className="small muted">
                {n.created_at?.slice(0, 10)} {n.created_at?.slice(11, 16)}
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "audit" && (
        <div className="card">
          <div className="card-title">
            <span>كل تعديل اتعمل في النظام — مين وإمتى وقد إيه</span>
          </div>
          <div className="table-wrap">
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
