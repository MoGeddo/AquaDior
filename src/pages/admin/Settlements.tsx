import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { money } from "../../lib/calc";
import type { Settlement, WorkerBalance } from "../../lib/types";
import { Modal } from "../../components/Modal";

type SettlementWorker = { full_name: string; phone: string | null };
type SettlementRow = Settlement & { worker?: SettlementWorker | null };

function newRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (bytes.every((byte) => byte === 0)) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map((byte, index) =>
    `${index === 4 || index === 6 || index === 8 || index === 10 ? "-" : ""}${byte.toString(16).padStart(2, "0")}`
  ).join("");
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function Settlements() {
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [workers, setWorkers] = useState<WorkerBalance[]>([]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyWorkerId, setBusyWorkerId] = useState<string | null>(null);
  const [view, setView] = useState<SettlementRow | null>(null);
  const [confirmWorker, setConfirmWorker] = useState<WorkerBalance | null>(null);
  const requestIds = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [settlementResult, balanceResult] = await Promise.all([
        supabase
          .from("settlements")
          .select("*, worker:profiles!settlements_worker_id_fkey(full_name, phone)")
          .is("project_id", null)
          .order("created_at", { ascending: false }),
        supabase.from("worker_balances").select("*").order("full_name"),
      ]);
      const queryError = settlementResult.error ?? balanceResult.error;
      if (queryError) throw queryError;
      setRows((settlementResult.data ?? []).map((row: any) => ({ ...row, worker: row.worker })) as SettlementRow[]);
      setWorkers((balanceResult.data ?? []) as WorkerBalance[]);
    } catch (caught: any) {
      setError(caught?.message ?? "تعذر تحميل التسويات والأرصدة");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function payBalance(worker: WorkerBalance) {
    if (busyWorkerId) return;
    const amount = Number(worker.balance);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (Number(worker.withdrawn_pending) > 0) {
      setError("احسم طلب الصرف المعلّق للعامل قبل التسوية.");
      return;
    }
    const requestId = requestIds.current[worker.worker_id] ?? newRequestId();
    requestIds.current[worker.worker_id] = requestId;
    setBusyWorkerId(worker.worker_id);
    setError("");
    setMsg("");
    try {
      const { data, error: rpcError } = await supabase.rpc("create_worker_settlement", {
        p_worker_id: worker.worker_id,
        p_request_id: requestId,
      });
      if (rpcError) throw rpcError;
      delete requestIds.current[worker.worker_id];
      setConfirmWorker(null);
      setMsg(`تم تسجيل وصرف ${money(Number(data?.net_amount ?? amount))} للعامل ${worker.full_name}، وتم تحديث رصيده العام.`);
      await load();
    } catch (caught: any) {
      const message = String(caught?.message ?? "");
      if (caught?.code === "PGRST202" || /schema cache/i.test(message)) {
        setError("دالة التسوية غير موجودة أو لم تُحدّث في Supabase Staging. شغّل تحديث SQL الخاص بالتسوية ثم أعد المحاولة؛ لم تُسجّل أي حركة.");
      } else {
        setError(message || "تعذر تسجيل التسوية؛ أعد المحاولة بنفس العملية بعد التحقق من القائمة.");
      }
    } finally {
      setBusyWorkerId(null);
    }
  }

  const totals = useMemo(() => rows.reduce(
    (sum, row) => ({
      earned: sum.earned + Number(row.total_earned || 0),
      withdrawn: sum.withdrawn + Number(row.total_withdrawn || 0),
      deductions: sum.deductions + Number(row.total_deductions || 0),
      net: sum.net + Number(row.net_amount || 0),
    }),
    { earned: 0, withdrawn: 0, deductions: 0, net: 0 }
  ), [rows]);
  const dueWorkers = workers.filter((worker) => Number(worker.balance) > 0);

  return (
    <>
      <div className="flex-between mb" style={{ flexWrap: "wrap" }}>
        <div className="alert info" style={{ margin: 0, flex: "1 1 280px" }}>
          بعد تسليم المبلغ فعليًا، سجّل صرف كامل الرصيد العام للعامل مرة واحدة. التسجيل يخصم المبلغ من رصيده ولا يحوّل أموالًا، ولا تُقسّم التسوية على المشاريع. احسم طلبات الصرف المعلّقة أولًا.
        </div>
        <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>{loading ? "جاري التحديث…" : "تحديث الأرصدة"}</button>
      </div>

      {msg && <div className="alert success" role="status">{msg}</div>}
      {error && !confirmWorker && <div className="alert error" role="alert">{error}</div>}

      <div className="stats">
        <div className="stat"><div className="label">تسويات مسجلة</div><div className="value">{rows.length}</div></div>
        <div className="stat"><div className="label">إجمالي الاستحقاق في السجلات</div><div className="value">{money(totals.earned)}</div></div>
        <div className="stat"><div className="label">المسحوب قبل التسويات</div><div className="value amber">{money(totals.withdrawn)}</div></div>
        <div className="stat"><div className="label">صافي الخصومات بعد التصحيحات</div><div className={`value ${totals.deductions < 0 ? "green" : "red"}`}>{totals.deductions < 0 ? "+ " : "− "}{money(Math.abs(totals.deductions))}</div></div>
        <div className="stat"><div className="label">المصروف بالتسويات</div><div className="value green">{money(totals.net)}</div></div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>صرف المستحقات — الرصيد العام</span>
          <span className="small muted">{dueWorkers.length} عامل لديهم رصيد موجب</span>
        </div>
        {loading && workers.length === 0 ? <div className="empty" role="status">جاري تحميل الأرصدة…</div> : dueWorkers.length === 0 ? (
          <div className="empty">لا يوجد رصيد موجب جاهز للتسوية.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>العامل</th><th>الرصيد العام</th><th>طلبات معلّقة</th><th></th></tr></thead>
              <tbody>
                {dueWorkers.map((worker) => {
                  const pending = Number(worker.withdrawn_pending) > 0;
                  return (
                    <tr key={worker.worker_id}>
                      <td><b>{worker.full_name}</b>{!worker.is_active && <span className="badge gray" style={{ marginInlineStart: 6 }}>موقوف</span>}</td>
                      <td className="num green"><b>{money(worker.balance)}</b></td>
                      <td className="num">{pending ? <span className="badge amber">{money(worker.withdrawn_pending)} معلّقة</span> : <span className="badge green">لا يوجد</span>}</td>
                      <td>
                        <button
                          className="btn btn-sm btn-success"
                          disabled={Boolean(busyWorkerId) || pending}
                          onClick={() => {
                            setError("");
                            setMsg("");
                            setConfirmWorker(worker);
                          }}
                        >
                          {busyWorkerId === worker.worker_id ? "جاري التحقق والصرف…" : pending ? "احسم الطلب أولًا" : "تسجيل صرف الرصيد"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <span>سجل التسويات العامة المصروفة</span>
          <span className="small muted">كل سطر فترة جديدة منذ آخر تسوية؛ التاريخ محفوظ</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>العامل</th><th>تاريخ الصرف</th><th>أيام</th><th>استحقاق الفترة</th><th>خد خلال الفترة</th><th>خصومات / تصحيحات</th><th>المصروف</th><th>الحالة</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><b>{row.worker?.full_name ?? "—"}</b></td>
                  <td className="small">{formatDate(row.paid_at ?? row.created_at)}</td>
                  <td className="num">{row.days_worked}</td>
                  <td className="num">{money(row.total_earned)}</td>
                  <td className="num amber">{money(row.total_withdrawn)}</td>
                  <td className={`num ${Number(row.total_deductions) < 0 ? "green" : "red"}`}>{Number(row.total_deductions) < 0 ? "+ " : "− "}{money(Math.abs(Number(row.total_deductions || 0)))}</td>
                  <td className="num green"><b>{money(row.net_amount)}</b></td>
                  <td>{row.status === "paid" ? <span className="badge green">اتصرف ✓</span> : row.status === "confirmed" ? <span className="badge blue">مؤكد</span> : <span className="badge amber">مسودة</span>}</td>
                  <td><button className="btn btn-sm" onClick={() => setView(row)}>كشف</button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="center muted">لا توجد تسويات عامة مسجلة.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {view && (
        <Modal title={`كشف تسوية ${view.worker?.full_name ?? ""}`} onClose={() => setView(null)}>
          <div className="card" style={{ boxShadow: "none" }}>
            <div className="row"><span>تاريخ الصرف</span><b>{formatDate(view.paid_at ?? view.created_at)}</b></div>
            <div className="row"><span>أيام العمل منذ التسوية السابقة</span><b className="num">{view.days_worked} يوم</b></div>
            <div className="row"><span>اليومية الحالية</span><b className="num">{money(view.daily_wage)}</b></div>
            <div className="row" style={{ borderTop: "2px solid var(--border)" }}><span><b>استحقاق الفترة</b></span><b className="num">{money(view.total_earned)}</b></div>
            <div className="row"><span>ناقص: السحوبات المعتمدة خلال الفترة</span><b className="num red">− {money(view.total_withdrawn)}</b></div>
            <div className="row"><span>{Number(view.total_deductions) < 0 ? "تصحيح خصومات سابقة" : "ناقص: الخصومات خلال الفترة"}</span><b className={`num ${Number(view.total_deductions) < 0 ? "green" : "red"}`}>{Number(view.total_deductions) < 0 ? "+ " : "− "}{money(Math.abs(Number(view.total_deductions || 0)))}</b></div>
            <div className="row" style={{ borderTop: "2px solid var(--border)" }}><span><b>المبلغ المصروف</b></span><b className="num" style={{ fontSize: 22, color: "var(--success)" }}>{money(view.net_amount)}</b></div>
          </div>
          <button className="btn btn-block" onClick={() => window.print()}>🖨️ اطبع</button>
        </Modal>
      )}

      {confirmWorker && (
        <Modal
          title="تأكيد صرف مستحقات العامل"
          onClose={() => {
            if (!busyWorkerId) setConfirmWorker(null);
          }}
        >
          <div className="row"><span>العامل</span><b>{confirmWorker.full_name}</b></div>
          <div className="row"><span>الرصيد الذي سيتم تسجيل صرفه</span><b className="num green">{money(confirmWorker.balance)}</b></div>
          <p className="small muted mb">
            أكّد فقط إذا كنت سلّمت المبلغ للعامل فعليًا. هذا يسجل التسوية ويحدّث الرصيد؛ لا يحوّل الأموال بنفسه.
          </p>
          {error && <div className="alert error" role="alert">{error}</div>}
          <div className="flex">
            <button className="btn" onClick={() => setConfirmWorker(null)} disabled={Boolean(busyWorkerId)}>
              إلغاء
            </button>
            <button
              className="btn btn-success"
              onClick={() => void payBalance(confirmWorker)}
              disabled={Boolean(busyWorkerId)}
            >
              {busyWorkerId === confirmWorker.worker_id ? "جاري التحقق والصرف…" : "تأكيد تسجيل الصرف"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
