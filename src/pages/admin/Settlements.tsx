import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { money } from "../../lib/calc";
import type { Settlement, Project, Profile } from "../../lib/types";
import { Modal } from "../../components/Modal";

export default function Settlements() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [rows, setRows] = useState<(Settlement & { worker?: Profile })[]>([]);
  const [projectId, setProjectId] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<(Settlement & { worker?: Profile }) | null>(null);

  async function load() {
    const { data: p } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    setProjects((p ?? []) as Project[]);

    let query = supabase
      .from("settlements")
      .select("*, worker:profiles!settlements_worker_id_fkey(full_name, phone)")
      .order("created_at", { ascending: false });

    if (projectId) query = query.eq("project_id", projectId);

    const { data } = await query;
    setRows((data ?? []).map((r: any) => ({ ...r, worker: r.worker })));
  }

  useEffect(() => {
    load();
  }, [projectId]);

  async function markPaid(s: Settlement) {
    setBusy(true);
    const { error } = await supabase
      .from("settlements")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        worker_ack_at: new Date().toISOString(),
      })
      .eq("id", s.id);
    setBusy(false);
    if (error) return setMsg("خطأ: " + error.message);
    setMsg("تم تأكيد الصرف ✅");
    await load();
  }

  const totals = rows.reduce(
    (a, r) => ({
      earned: a.earned + Number(r.total_earned),
      wd: a.wd + Number(r.total_withdrawn),
      dd: a.dd + Number(r.total_deductions),
      net: a.net + Number(r.net_amount),
    }),
    { earned: 0, wd: 0, dd: 0, net: 0 }
  );

  return (
    <>
      <div className="flex-between mb" style={{ flexWrap: "wrap" }}>
        <label className="field" style={{ margin: 0, minWidth: 220 }}>
          <span>المشروع</span>
          <select
            className="input"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">كل المشاريع</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.status === "closed" ? "(مقفول)" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="flex">
          <span className="badge green">
            المطلوب صرفه: {money(totals.net)}
          </span>
        </div>
      </div>

      {msg && <div className="alert success">{msg}</div>}

      <div className="stats">
        <div className="stat">
          <div className="label">إجمالي الاستحقاقات</div>
          <div className="value">{money(totals.earned)}</div>
        </div>
        <div className="stat">
          <div className="label">إجمالي المسحوب</div>
          <div className="value amber">{money(totals.wd)}</div>
        </div>
        <div className="stat">
          <div className="label">إجمالي الخصومات</div>
          <div className="value red">{money(totals.dd)}</div>
        </div>
        <div className="stat">
          <div className="label">صافي المطلوب</div>
          <div className="value green">{money(totals.net)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>كشوف التسوية</span>
          <span className="small muted">
            التسويات بتتولّد أوتوماتيك لما تقفل المشروع
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>العامل</th>
                <th>أيام</th>
                <th>اليومية</th>
                <th>استحقاق</th>
                <th>خد</th>
                <th>خصومات</th>
                <th>الصافي</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.worker?.full_name ?? "—"}</b>
                  </td>
                  <td className="num">{r.days_worked}</td>
                  <td className="num">{money(r.daily_wage)}</td>
                  <td className="num">{money(r.total_earned)}</td>
                  <td className="num amber">{money(r.total_withdrawn)}</td>
                  <td className="num red">{money(r.total_deductions)}</td>
                  <td className="num green">
                    <b>{money(r.net_amount)}</b>
                  </td>
                  <td>
                    {r.status === "paid" ? (
                      <span className="badge green">اتصرف ✓</span>
                    ) : r.status === "confirmed" ? (
                      <span className="badge blue">مؤكد</span>
                    ) : (
                      <span className="badge amber">مسودة</span>
                    )}
                  </td>
                  <td>
                    <div className="flex">
                      <button className="btn btn-sm" onClick={() => setView(r)}>
                        كشف
                      </button>
                      {r.status !== "paid" && (
                        <button
                          className="btn btn-sm btn-success"
                          disabled={busy}
                          onClick={() => markPaid(r)}
                        >
                          صرف
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="center muted">
                    مفيش تسويات — اقفل مشروع الأول من صفحة المشاريع
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {view && (
        <Modal title={`كشف حساب ${view.worker?.full_name ?? ""}`} onClose={() => setView(null)}>
          <div className="card" style={{ boxShadow: "none" }}>
            <div className="row">
              <span>عدد أيام الشغل</span>
              <b className="num">{view.days_worked} يوم</b>
            </div>
            <div className="row">
              <span>اليومية</span>
              <b className="num">{money(view.daily_wage)}</b>
            </div>
            <div className="row" style={{ borderTop: "2px solid var(--border)" }}>
              <span>
                <b>إجمالي الاستحقاق</b>
              </span>
              <b className="num">{money(view.total_earned)}</b>
            </div>
            <div className="row">
              <span>ناقص: الفلوس اللي خدها</span>
              <b className="num red">− {money(view.total_withdrawn)}</b>
            </div>
            <div className="row">
              <span>ناقص: خصومات</span>
              <b className="num red">− {money(view.total_deductions)}</b>
            </div>
            <div className="row" style={{ borderTop: "2px solid var(--border)" }}>
              <span>
                <b>المطلوب صرفه</b>
              </span>
              <b className="num" style={{ fontSize: 22, color: "var(--success)" }}>
                {money(view.net_amount)}
              </b>
            </div>
          </div>
          <button className="btn btn-block" onClick={() => window.print()}>
            🖨️ اطبع
          </button>
        </Modal>
      )}
    </>
  );
}
