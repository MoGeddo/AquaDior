import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useAuth } from "../../store/auth";
import { supabase } from "../../lib/supabase";
import { money } from "../../lib/calc";
import type { WorkerBalance, Attendance, Withdrawal, Deduction } from "../../lib/types";

export default function MyStatement() {
  const { profile } = useAuth();
  const ctx = useOutletContext<{ bal: WorkerBalance | null; reload: () => void }>();

  const [att, setAtt] = useState<Attendance[]>([]);
  const [wd, setWd] = useState<Withdrawal[]>([]);
  const [dd, setDd] = useState<Deduction[]>([]);
  const [projectsByAttendance, setProjectsByAttendance] = useState<Record<string, string[]>>({});
  const [tab, setTab] = useState<"att" | "wd" | "dd">("att");

  useEffect(() => {
    if (!profile) return;
    (async () => {
      const [{ data: a }, { data: w }, { data: d }] = await Promise.all([
        supabase
          .from("attendance")
          .select("*")
          .eq("worker_id", profile.id)
          .order("work_date", { ascending: false })
          .limit(200),
        supabase
          .from("withdrawals")
          .select("*")
          .eq("worker_id", profile.id)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("deductions")
          .select("*")
          .eq("worker_id", profile.id)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      const attendanceRows = (a ?? []) as Attendance[];
      setAtt(attendanceRows);
      setWd((w ?? []) as Withdrawal[]);
      setDd((d ?? []) as Deduction[]);
      if (attendanceRows.length) {
        const { data: links } = await supabase
          .from("attendance_projects")
          .select("attendance_id, project_id, project:projects(name)")
          .in("attendance_id", attendanceRows.map((row) => row.id));
        const byAttendance: Record<string, string[]> = {};
        (links ?? []).forEach((link: any) => {
          const names = byAttendance[link.attendance_id] ?? [];
          if (link.project?.name) names.push(link.project.name);
          byAttendance[link.attendance_id] = names;
        });
        setProjectsByAttendance(byAttendance);
      } else {
        setProjectsByAttendance({});
      }
    })();
  }, [profile]);

  const bal = ctx?.bal;
  const statusBadge = (s: string) =>
    s === "approved" ? (
      <span className="badge green">موافق عليه</span>
    ) : s === "pending" ? (
      <span className="badge amber">مستني موافقة</span>
    ) : (
      <span className="badge red">مرفوض</span>
    );

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="label">أيام شغل</div>
          <div className="value blue">{att.length}</div>
        </div>
        <div className="stat">
          <div className="label">استحقاق</div>
          <div className="value">{money(bal?.earned ?? 0)}</div>
        </div>
        <div className="stat">
          <div className="label">خدت</div>
          <div className="value amber">
            {money((bal?.withdrawn_approved ?? 0) + (bal?.withdrawn_pending ?? 0))}
          </div>
        </div>
        <div className="stat">
          <div className="label">رصيدك</div>
          <div className="value green">{money(bal?.balance ?? 0)}</div>
        </div>
      </div>

      <div className="flex mb">
        <button
          className={`btn btn-sm ${tab === "att" ? "btn-primary" : ""}`}
          onClick={() => setTab("att")}
        >
          أيام الشغل ({att.length})
        </button>
        <button
          className={`btn btn-sm ${tab === "wd" ? "btn-primary" : ""}`}
          onClick={() => setTab("wd")}
        >
          الفلوس ({wd.length})
        </button>
        <button
          className={`btn btn-sm ${tab === "dd" ? "btn-primary" : ""}`}
          onClick={() => setTab("dd")}
        >
          خصومات ({dd.length})
        </button>
      </div>

      <div className="card">
        {tab === "att" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المشاريع/المواقع</th>
                  <th>اليومية (مرة واحدة)</th>
                </tr>
              </thead>
              <tbody>
                {att.map((a) => (
                  <tr key={a.id}>
                    <td className="num">{a.work_date}</td>
                    <td className="muted small">{(projectsByAttendance[a.id] ?? []).join("، ") || "—"}</td>
                    <td className="num">{money(a.daily_wage_snapshot ?? bal?.daily_wage ?? 0)}</td>
                  </tr>
                ))}
                {att.length === 0 && (
                  <tr>
                    <td colSpan={3} className="center muted">
                      مفيش أيام متسجّلة
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "wd" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المبلغ</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {wd.map((w) => (
                  <tr key={w.id}>
                    <td className="num">{w.created_at?.slice(0, 10)}</td>
                    <td className="num">{money(w.amount)}</td>
                    <td>{statusBadge(w.status)}</td>
                  </tr>
                ))}
                {wd.length === 0 && (
                  <tr>
                    <td colSpan={3} className="center muted">
                      مفيش فلوس متسجّلة
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "dd" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المبلغ</th>
                  <th>السبب</th>
                </tr>
              </thead>
              <tbody>
                {dd.map((d) => (
                  <tr key={d.id}>
                    <td className="num">{d.created_at?.slice(0, 10)}</td>
                    <td className="num">{money(d.amount)}</td>
                    <td className="muted small">{d.reason}</td>
                  </tr>
                ))}
                {dd.length === 0 && (
                  <tr>
                    <td colSpan={3} className="center muted">
                      مفيش خصومات
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">الملخص النهائي</div>
        <div className="row">
          <span>إجمالي الاستحقاق</span>
          <b className="num">{money(bal?.earned ?? 0)}</b>
        </div>
        <div className="row">
          <span>ناقص: الفلوس اللي خدتها</span>
          <b className="num red">{money(bal?.withdrawn_approved ?? 0)}</b>
        </div>
        {bal?.withdrawn_pending ? (
          <div className="row">
            <span>مستني موافقة</span>
            <b className="num amber">{money(bal.withdrawn_pending)}</b>
          </div>
        ) : null}
        <div className="row">
          <span>ناقص: خصومات</span>
          <b className="num red">{money(bal?.deducted ?? 0)}</b>
        </div>
        <div className="row" style={{ borderTop: "2px solid var(--border)" }}>
          <span>
            <b>المطلوب صرفه لك</b>
          </span>
          <b className="num" style={{ fontSize: 20, color: "var(--success)" }}>
            {money(bal?.balance ?? 0)}
          </b>
        </div>
        <button
          className="btn btn-block mt"
          onClick={() => window.print()}
        >
          🖨️ اطبع الكشف
        </button>
      </div>
    </>
  );
}
