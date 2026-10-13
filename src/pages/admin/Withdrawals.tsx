import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { fmtDateOnly, money } from "../../lib/calc";
import { arabicError } from "../../lib/errors";
import type { Withdrawal, Profile } from "../../lib/types";
import { useDialog } from "../../components/DialogProvider";
import AppIcon from "../../components/AppIcon";
import SearchField from "../../components/SearchField";

type Tab = "pending" | "all" | "approved" | "rejected";
const isoNow = () => new Date().toISOString();

export default function Withdrawals() {
  const { confirm } = useDialog();
  const [rows, setRows] = useState<(Withdrawal & { worker?: Profile })[]>([]);
  const [tab, setTab] = useState<Tab>("pending");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
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
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = rows.filter(
    (r) =>
      (r.worker?.full_name ?? "").includes(q) ||
      (r.worker?.phone ?? "").includes(q) ||
      String(r.amount).includes(q)
  );

  async function decide(row: Withdrawal & { worker?: Profile }, status: "approved" | "rejected") {
    if (busy) return;
    const workerName = row.worker?.full_name ?? "العامل";
    const approved = status === "approved";
    const accepted = await confirm({
      title: approved ? "اعتماد طلب السحب؟" : "رفض طلب السحب؟",
      message: approved
        ? `سيُعتمد صرف ${money(row.amount)} للعامل «${workerName}». تأكد من مراجعة الطلب قبل تسجيل القرار.`
        : `سيُرفض طلب ${money(row.amount)} المقدم من «${workerName}». لن يتم تسجيل صرف لهذا الطلب.`,
      confirmText: approved ? "اعتماد الطلب" : "رفض الطلب",
      cancelText: "مراجعة الطلب",
      tone: approved ? "primary" : "danger",
    });
    if (!accepted) return;
    setBusy(true);
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("انتهت الجلسة؛ سجّل الدخول مرة أخرى");
      const { data, error } = await supabase
        .from("withdrawals")
        .update({
          status,
          decided_by: auth.user.id,
          decided_at: isoNow(),
        })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        setMsg("تم التعامل مع هذا الطلب من جلسة أخرى؛ أُعيد تحميل القائمة.");
        await load();
        return;
      }
      setMsg(status === "approved" ? "تمت الموافقة" : "تم الرفض");
      await load();
    } catch (error: any) {
      setMsg("خطأ: " + arabicError(error, "تعذر تحديث الطلب."));
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <>
      <div className="flex-between mb wrap">
        <div className="flex wrap">
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
        <SearchField
          value={q}
          onChange={setQ}
          maxWidth={240}
          ariaLabel="البحث في طلبات السحب"
          placeholder="ابحث بالاسم أو الموبايل أو المبلغ"
        />
      </div>

      {msg && <div className="alert success">{msg}</div>}

      <div className="card">
        <div className="table-wrap" role="region" aria-label="جدول طلبات السحب" tabIndex={0}>
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
                  <td className="num">{fmtDateOnly(r.created_at)}</td>
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
                          onClick={() => void decide(r, "approved")}
                          aria-label={`اعتماد سحب ${money(r.amount)} للعامل ${r.worker?.full_name ?? ""}`}
                        >
                          <AppIcon name="circleCheck" size={16} />
                          موافقة
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={busy}
                          onClick={() => void decide(r, "rejected")}
                          aria-label={`رفض سحب ${money(r.amount)} للعامل ${r.worker?.full_name ?? ""}`}
                        >
                          <AppIcon name="circleX" size={16} />
                          رفض
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
