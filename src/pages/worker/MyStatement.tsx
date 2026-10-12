import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useAuth } from "../../store/auth";
import { supabase } from "../../lib/supabase";
import { money } from "../../lib/calc";
import type { WorkerBalance, Attendance, Withdrawal, Deduction, Settlement } from "../../lib/types";

const PAGE_SIZE = 50;

export default function MyStatement() {
  const { profile } = useAuth();
  const ctx = useOutletContext<{ bal: WorkerBalance | null; reload: () => void }>();

  const [att, setAtt] = useState<Attendance[]>([]);
  const [wd, setWd] = useState<Withdrawal[]>([]);
  const [dd, setDd] = useState<Deduction[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [projectsByAttendance, setProjectsByAttendance] = useState<Record<string, string[]>>({});
  const [tab, setTab] = useState<"att" | "wd" | "dd" | "st">("att");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const loadPage = useCallback(async (from = 0) => {
    if (!profile) return;
    const firstPage = from === 0;
    if (firstPage) {
      setLoading(true);
      setError("");
    } else {
      setLoadingMore(true);
    }
    try {
      const [attendanceResult, withdrawalResult, deductionResult, settlementResult] = await Promise.all([
        supabase
          .from("attendance")
          .select("*")
          .eq("worker_id", profile.id)
          .order("work_date", { ascending: false })
          .range(from, from + PAGE_SIZE - 1),
        supabase
          .from("withdrawals")
          .select("*")
          .eq("worker_id", profile.id)
          .order("created_at", { ascending: false })
          .range(from, from + PAGE_SIZE - 1),
        supabase
          .from("deductions")
          .select("*")
          .eq("worker_id", profile.id)
          .order("created_at", { ascending: false })
          .range(from, from + PAGE_SIZE - 1),
        supabase
          .from("settlements")
          .select("*")
          .eq("worker_id", profile.id)
          .is("project_id", null)
          .order("created_at", { ascending: false })
          .range(from, from + PAGE_SIZE - 1),
      ]);
      const queryError = attendanceResult.error ?? withdrawalResult.error ?? deductionResult.error ?? settlementResult.error;
      if (queryError) throw queryError;

      const attendanceRows = (attendanceResult.data ?? []) as Attendance[];
      const withdrawalRows = (withdrawalResult.data ?? []) as Withdrawal[];
      const deductionRows = (deductionResult.data ?? []) as Deduction[];
      const settlementRows = (settlementResult.data ?? []) as Settlement[];
      let pageProjects: Record<string, string[]> = {};
      if (attendanceRows.length) {
        const { data: links, error: linksError } = await supabase
          .from("attendance_projects")
          .select("attendance_id, project_id, project:projects(name)")
          .in("attendance_id", attendanceRows.map((row) => row.id));
        if (linksError) throw linksError;
        (links ?? []).forEach((link: any) => {
          const names = pageProjects[link.attendance_id] ?? [];
          if (link.project?.name) names.push(link.project.name);
          pageProjects[link.attendance_id] = names;
        });
      }

      const mergeRows = <T extends { id: string },>(previous: T[], next: T[]) => {
        const seen = new Set(previous.map((row) => row.id));
        return [...previous, ...next.filter((row) => !seen.has(row.id))];
      };
      setAtt((previous) => firstPage ? attendanceRows : mergeRows(previous, attendanceRows));
      setWd((previous) => firstPage ? withdrawalRows : mergeRows(previous, withdrawalRows));
      setDd((previous) => firstPage ? deductionRows : mergeRows(previous, deductionRows));
      setSettlements((previous) => firstPage ? settlementRows : mergeRows(previous, settlementRows));
      setProjectsByAttendance((previous) => firstPage ? pageProjects : { ...previous, ...pageProjects });
      setHasMore(attendanceRows.length === PAGE_SIZE || withdrawalRows.length === PAGE_SIZE || deductionRows.length === PAGE_SIZE || settlementRows.length === PAGE_SIZE);
      setOffset(from + PAGE_SIZE);
      setError("");
    } catch (caught: any) {
      setError(caught?.message ?? "تعذر تحميل كشف الحساب");
    } finally {
      if (firstPage) setLoading(false);
      else setLoadingMore(false);
    }
  }, [profile]);

  useEffect(() => {
    void loadPage(0);
  }, [loadPage]);

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
      {error && <div className="alert error" role="alert">{error} <button className="btn btn-sm" onClick={() => void loadPage(0)}>إعادة المحاولة</button></div>}
      {loading && <div className="empty" role="status">جاري تحميل كشف الحساب…</div>}
      <div className="stats">
        <div className="stat">
          <div className="label">أيام شغل</div>
          <div className="value blue">{bal?.days_worked ?? att.length}</div>
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
          أيام الشغل ({bal?.days_worked ?? att.length})
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
        <button
          className={`btn btn-sm ${tab === "st" ? "btn-primary" : ""}`}
          onClick={() => setTab("st")}
        >
          تسويات ({settlements.length})
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
                    <td className="num">
                      {d.voided_at ? <span className="badge gray">ملغي</span> : <>{money(d.amount)} <span className="small muted">ج.م</span></>}
                    </td>
                    <td className="muted small">
                      {d.reason}
                      {d.void_reason && <div style={{ marginTop: 4 }}>سبب الإلغاء: {d.void_reason}</div>}
                    </td>
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

        {tab === "st" && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>تاريخ الصرف</th><th>أيام الفترة</th><th>الاستحقاق</th><th>السحوبات</th><th>خصومات / تصحيح</th><th>المصروف</th><th>الحالة</th></tr></thead>
              <tbody>
                {settlements.map((settlement) => (
                  <tr key={settlement.id}>
                    <td className="num">{settlement.paid_at?.slice(0, 10) ?? settlement.created_at?.slice(0, 10)}</td>
                    <td className="num">{settlement.days_worked}</td>
                    <td className="num">{money(settlement.total_earned)}</td>
                    <td className="num amber">{money(settlement.total_withdrawn)}</td>
                    <td className={`num ${Number(settlement.total_deductions) < 0 ? "green" : "red"}`}>{Number(settlement.total_deductions) < 0 ? "+ " : "− "}{money(Math.abs(Number(settlement.total_deductions || 0)))}</td>
                    <td className="num green">{money(settlement.net_amount)}</td>
                    <td>{settlement.status === "paid" ? <span className="badge green">اتصرف ✓</span> : <span className="badge amber">قيد المراجعة</span>}</td>
                  </tr>
                ))}
                {settlements.length === 0 && <tr><td colSpan={7} className="center muted">مفيش تسويات مصروفة مسجلة.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {hasMore && (
        <button className="btn btn-block mb" onClick={() => void loadPage(offset)} disabled={loadingMore}>
          {loadingMore ? "جاري تحميل السجلات…" : "تحميل سجلات أقدم"}
        </button>
      )}

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
        {(bal?.settled_paid ?? 0) > 0 && (
          <div className="row">
            <span>ناقص: تسويات سابقة مصروفة</span>
            <b className="num red">{money(bal?.settled_paid ?? 0)}</b>
          </div>
        )}
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
