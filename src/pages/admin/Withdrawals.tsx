import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { money } from "../../lib/calc";
import type { Withdrawal, Profile } from "../../lib/types";

type Tab = "pending" | "all" | "approved" | "rejected";

export default function Withdrawals() {
  const [rows, setRows] = useState<(Withdrawal & { worker?: Profile })[]>([]);
  const [tab, setTab] = useState<Tab>("pending");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    let query = supabase
      .from("withdrawals")
      .select("*, worker:profiles!withdrawals_worker_id_fkey(full_name, phone)")
      .order("created_at", { ascending: false })
      .limit(300);

    if (tab !== "all") query = query.eq("status", tab);

    const { data } = await query;
    setRows(
      (data ?? []).map((r: any) => ({ ...r, worker: r.worker }))
    );
  }

  useEffect(() => {
    load();
  }, [tab]);

  const filtered = rows.filter(
    (r) =>
      (r.worker?.full_name ?? "").includes(q) ||
      (r.worker?.phone ?? "").includes(q) ||
      String(r.amount).includes(q)
  );

  async function decide(id: string, status: "approved" | "rejected") {
    setBusy(true);
    const me = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await supabase
      .from("withdrawals")
      .update({
        status,
        decided_by: me,
        decided_at: new Date().toISOString(),
      })
      .eq("id", id);
    setBusy(false);
    if (error) return setMsg("خطأ: " + error.message);
    setMsg(status === "approved" ? "تمت الموافقة ✅" : "تم الرفض ✅");
    await load();
  }

  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <>
      <div className="flex-between mb" style={{ flexWrap: "wrap" }}>
        <div className="flex">
          {(
            [
              ["pending", `مستني موافقة ${pendingCount ? `(${pendingCount})` : ""}`],
              ["all", "الكل"],
              ["approved", "موافق عليها"],
              ["rejected", "مرفوضة"],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              className={`btn btn-sm ${tab === k ? "btn-primary" : ""}`}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="input"
          style={{ maxWidth: 240 }}
          placeholder="🔍 بحث"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {msg && <div className="alert success">{msg}</div>}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>العامل</th>
                <th>التاريخ</th>
                <th>المبلغ</th>
                <th>ملاحظة</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.worker?.full_name ?? "—"}</b>
                    <div className="small muted" dir="ltr">
                      {r.worker?.phone}
                    </div>
                  </td>
                  <td className="num">{r.created_at?.slice(0, 10)}</td>
                  <td className="num">
                    <b>{money(r.amount)}</b>
                  </td>
                  <td className="small muted">{r.note ?? "—"}</td>
                  <td>
                    {r.status === "approved" ? (
                      <span className="badge green">موافق</span>
                    ) : r.status === "rejected" ? (
                      <span className="badge red">مرفوض</span>
                    ) : (
                      <span className="badge amber">مستني</span>
                    )}
                  </td>
                  <td>
                    {r.status === "pending" && (
                      <div className="flex">
                        <button
                          className="btn btn-sm btn-success"
                          disabled={busy}
                          onClick={() => decide(r.id, "approved")}
                        >
                          ✓
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={busy}
                          onClick={() => decide(r.id, "rejected")}
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="center muted">
                    مفيش حاجة
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
