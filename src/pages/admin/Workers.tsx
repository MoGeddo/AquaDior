import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { money } from "../../lib/calc";
import type { Deduction, WorkerBalance } from "../../lib/types";
import { Modal } from "../../components/Modal";
import { useDialog } from "../../components/DialogProvider";
import { useAuth } from "../../store/auth";
import AppIcon from "../../components/AppIcon";
import SearchField from "../../components/SearchField";

export default function Workers() {
  const { profile } = useAuth();
  const { confirm } = useDialog();
  const canResetPassword = profile?.role === "developer";
  const [workers, setWorkers] = useState<WorkerBalance[]>([]);
  const [deletingWorkerId, setDeletingWorkerId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<WorkerBalance | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");
  const [loadError, setLoadError] = useState("");
  async function load() {
    const { data, error } = await supabase.from("worker_balances").select("*").order("full_name");
    setLoadError(error?.message ?? "");
    if (!error) setWorkers((data ?? []) as WorkerBalance[]);
  }

  async function deleteWorker(worker: WorkerBalance) {
    if (!canResetPassword || deletingWorkerId) return;
    const confirmed = await confirm({
      title: `حذف العامل «${worker.full_name}»؟`,
      message: "سيُحذف الحساب نهائيًا. لن يسمح النظام بالحذف إذا كان للعامل حضور أو سحوبات أو خصومات أو تسويات؛ ستظل سجلاته محفوظة ويمكنك إيقاف العامل بدلًا من ذلك.",
      confirmText: "حذف العامل",
      cancelText: "إبقاء العامل",
      tone: "danger",
    });
    if (!confirmed) return;

    setDeleteError("");
    setMsg("");
    setDeletingWorkerId(worker.worker_id);
    try {
      const { data: cardPath, error } = await supabase.rpc("developer_delete_worker", {
        p_worker_id: worker.worker_id,
      });
      if (error) {
        setDeleteError(error.message);
        return;
      }

      let successMessage = `تم حذف العامل «${worker.full_name}» نهائيًا.`;
      if (typeof cardPath === "string" && cardPath) {
        const { error: storageError } = await supabase.storage
          .from("id-cards")
          .remove([cardPath]);
        if (storageError) {
          successMessage += " تعذّر حذف صورة البطاقة من التخزين؛ راجع ملفات id-cards في Supabase.";
        }
      }
      setMsg(successMessage);
      await load();
    } catch (error: any) {
      setDeleteError(error?.message ?? "تعذّر حذف العامل");
    } finally {
      setDeletingWorkerId(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = workers.filter((w) => w.full_name.includes(q) || (w.phone ?? "").includes(q));

  return (
    <>
      <div className="flex-between mb wrap">
        <SearchField
          value={q}
          onChange={setQ}
          maxWidth={280}
          ariaLabel="البحث عن عامل بالاسم أو رقم الموبايل"
          placeholder="ابحث بالاسم أو الموبايل"
        />
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <AppIcon name="userPlus" size={18} />
          إضافة عامل
        </button>
      </div>

      {msg && <div className="alert success">{msg}</div>}
      {deleteError && <div className="alert error" role="alert">{deleteError}</div>}
      {loadError && <div className="alert error" role="alert">تعذر تحميل بعض البيانات: {loadError}</div>}
      {canResetPassword && (
        <div className="alert info" role="note">
          الحذف النهائي للعامل متاح للمطوّر فقط إذا لم توجد له سجلات حضور أو مالية؛ عند وجودها استخدم إيقاف العامل للحفاظ على التاريخ.
        </div>
      )}

      <div className="card">
        <div className="table-wrap" role="region" aria-label="جدول العمال وأرصدتهم" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الموبايل</th>
                <th>اليومية</th>
                <th>أيام</th>
                <th>استحقاق</th>
                <th>خد</th>
                <th>خصومات</th>
                <th>تسويات</th>
                <th>رصيد</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr key={w.worker_id}>
                  <td>
                    {w.full_name}{" "}
                    {!w.is_active && <span className="badge gray">موقوف</span>}
                  </td>
                  <td className="num" dir="ltr">
                    {w.phone ?? "—"}
                  </td>
                  <td className="num">{money(w.daily_wage)}</td>
                  <td className="num">{w.days_worked}</td>
                  <td className="num">{money(w.earned)}</td>
                  <td className="num amber">
                    {money(Number(w.withdrawn_approved) + Number(w.withdrawn_pending))}
                  </td>
                  <td className="num red">{money(Number(w.deducted))}</td>
                  <td className="num">{money(Number(w.settled_paid ?? 0))}</td>
                  <td className="num green">
                    <b>{money(w.balance)}</b>
                  </td>
                  <td>
                    <div className="flex wrap">
                      <button className="btn btn-sm" onClick={() => setEditing(w)}>
                        <AppIcon name="folderOpen" size={16} />
                        تفاصيل
                      </button>
                      {canResetPassword && (
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => void deleteWorker(w)}
                          disabled={Boolean(deletingWorkerId)}
                          aria-label={`حذف العامل ${w.full_name}`}
                        >
                          {deletingWorkerId === w.worker_id ? "جاري الحذف..." : <><AppIcon name="trash2" size={16} /> حذف</>}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="center muted">
                    مفيش عمال
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {adding && (
        <AddWorker
          onClose={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            setMsg("تم إضافة العامل");
            await load();
          }}
        />
      )}

      {editing && (
        <EditWorker
          worker={editing}
          canResetPassword={canResetPassword}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </>
  );
}

/* ============ إضافة عامل ============ */
function AddWorker({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    full_name: "",
    phone: "",
    password: "",
    daily_wage: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setErr("");
    if (!f.full_name.trim()) return setErr("اكتب الاسم");
    if (f.phone.replace(/\D/g, "").length < 10) return setErr("اكتب رقم موبايل صحيح");
    if (f.password.length < 8) return setErr("كلمة السر 8 أحرف على الأقل");

    setBusy(true);
    const { error } = await supabase.rpc("create_worker", {
      p_full_name: f.full_name.trim(),
      p_phone: f.phone.trim(),
      p_password: f.password,
      p_daily_wage: Number(f.daily_wage || 0),
    });
    setBusy(false);
    if (error) return setErr(error.message);
    onDone();
  }

  return (
    <Modal title="إضافة عامل جديد" onClose={onClose}>
      {err && <div className="alert error">{err}</div>}
      <label className="field">
        <span>الاسم بالكامل</span>
        <input
          className="input"
          value={f.full_name}
          onChange={(e) => setF({ ...f, full_name: e.target.value })}
        />
      </label>
      <label className="field">
        <span>رقم الموبايل (هو اسم المستخدم)</span>
        <input
          className="input"
          dir="ltr"
          value={f.phone}
          onChange={(e) => setF({ ...f, phone: e.target.value })}
        />
      </label>
      <label className="field">
        <span>كلمة السر (8 أحرف على الأقل)</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={f.password}
          onChange={(e) => setF({ ...f, password: e.target.value })}
        />
      </label>
      <label className="field">
        <span>اليومية (جنيه)</span>
        <input
          className="input"
          inputMode="decimal"
          value={f.daily_wage}
          onChange={(e) => setF({ ...f, daily_wage: e.target.value })}
        />
      </label>
      <p className="small muted">العامل يختار المشروع أو المشاريع بنفسه عند تسجيل الحضور من المشاريع المفتوحة.</p>
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
        {busy ? "جاري الحفظ..." : "حفظ"}
      </button>
    </Modal>
  );
}

/* ============ تعديل عامل ============ */
function EditWorker({
  worker,
  canResetPassword,
  onClose,
  onDone,
}: {
  worker: WorkerBalance;
  canResetPassword: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { confirm } = useDialog();
  const [tab, setTab] = useState<"info" | "deduct" | "password">("info");
  const [fullName, setFullName] = useState(worker.full_name);
  const [phone, setPhone] = useState(worker.phone ?? "");
  const [wage, setWage] = useState(String(worker.daily_wage));
  const [active, setActive] = useState(worker.is_active);
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [deductionLoadError, setDeductionLoadError] = useState("");
  const [dAmount, setDAmount] = useState("");
  const [dReason, setDReason] = useState("");
  const [newPass, setNewPass] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDeductionLoadError("");
    (async () => {
      const { data, error } = await supabase
        .from("deductions")
        .select("*")
        .eq("worker_id", worker.worker_id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (cancelled) return;
      if (error) setDeductionLoadError(error.message ?? "تعذر تحميل الخصومات");
      else setDeductions((data ?? []) as Deduction[]);
    })().catch((error: any) => {
      if (!cancelled) setDeductionLoadError(error?.message ?? "تعذر تحميل الخصومات");
    });
    return () => { cancelled = true; };
  }, [worker.worker_id]);

  async function saveInfo() {
    setErr("");
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    const dailyWage = Number(wage);
    if (fullName.trim().length < 3) return setErr("اكتب الاسم بالكامل");
    if (cleanPhone.length < 10 || cleanPhone.length > 15) return setErr("رقم الموبايل غير صحيح");
    if (!Number.isFinite(dailyWage) || dailyWage < 0) return setErr("اليومية غير صحيحة");

    setBusy(true);
    const { error } = await supabase.rpc("save_worker_admin_details", {
      p_worker_id: worker.worker_id,
      p_full_name: fullName.trim(),
      p_phone: cleanPhone,
      p_daily_wage: dailyWage,
      p_is_active: active,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setOk("تم الحفظ");
    onDone();
  }

  async function addDeduction() {
    setErr("");
    const v = Number(dAmount);
    if (!Number.isFinite(v) || v <= 0) return setErr("اكتب مبلغ صحيح");
    if (!dReason.trim() || dReason.trim().length > 500) return setErr("اكتب سببًا من 1 إلى 500 حرف");
    const confirmed = await confirm({
      title: "تأكيد تسجيل الخصم",
      message: `سيُخصم ${money(v)} من الحساب العام للعامل «${worker.full_name}».\nالسبب: ${dReason.trim()}`,
      confirmText: "تسجيل الخصم",
      cancelText: "مراجعة البيانات",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    const { error } = await supabase.rpc("add_worker_deduction", {
      p_worker_id: worker.worker_id,
      p_project_id: null,
      p_amount: v,
      p_reason: dReason.trim(),
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setOk("تم الخصم");
    setDAmount("");
    setDReason("");
    onDone();
  }

  async function resetPass() {
    setErr("");
    if (!canResetPassword) return setErr("تغيير كلمات السر متاح للمطوّر النشط فقط");
    if (newPass.length < 8 || newPass.length > 128) return setErr("كلمة السر يجب أن تكون بين 8 و128 حرفًا");
    setBusy(true);
    const { error } = await supabase.rpc("reset_worker_password", {
      p_worker_id: worker.worker_id,
      p_password: newPass,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setOk("تم تغيير كلمة السر");
    setNewPass("");
  }

  return (
    <Modal title={worker.full_name} onClose={onClose}>
      <div className="flex wrap mb">
        <button
          className={`btn btn-sm ${tab === "info" ? "btn-primary" : ""}`}
          onClick={() => setTab("info")}
        >
          البيانات
        </button>
        <button
          className={`btn btn-sm ${tab === "deduct" ? "btn-primary" : ""}`}
          onClick={() => setTab("deduct")}
        >
          خصم
        </button>
        {canResetPassword && (
          <button
            className={`btn btn-sm ${tab === "password" ? "btn-primary" : ""}`}
            onClick={() => setTab("password")}
          >
            كلمة السر
          </button>
        )}
      </div>

      {err && <div className="alert error">{err}</div>}
      {ok && <div className="alert success">{ok}</div>}

      {tab === "info" && (
        <>
          <label className="field">
            <span>الاسم</span>
            <input
              className="input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </label>
          <label className="field">
            <span>الموبايل</span>
            <input
              className="input"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="field">
            <span>اليومية (جنيه)</span>
            <input
              className="input"
              inputMode="decimal"
              value={wage}
              onChange={(e) => setWage(e.target.value)}
            />
          </label>
          <label className="field">
            <span>الحالة</span>
            <select
              className="input"
              value={active ? "1" : "0"}
              onChange={(e) => setActive(e.target.value === "1")}
            >
              <option value="1">شغال</option>
              <option value="0">موقوف</option>
            </select>
          </label>
          <div className="alert info">المشاريع المفتوحة متاحة لكل العمال؛ العامل يختار مشروعه أو مشاريعه وقت تسجيل الحضور.</div>
          <button className="btn btn-primary btn-block" onClick={saveInfo} disabled={busy}>
            حفظ
          </button>
        </>
      )}

      {tab === "deduct" && (
        <>
          <div className="alert info">
            الخصم يُسجّل على حساب العامل العام ولا يتكرر على المشاريع.
          </div>
          <label className="field">
            <span>المبلغ</span>
            <input
              className="input input-big"
              inputMode="decimal"
              value={dAmount}
              onChange={(e) => setDAmount(e.target.value.replace(/[^\d.]/g, ""))}
            />
          </label>
          <div className="flex" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {[50, 100, 200].map((v) => (
              <button
                key={v}
                type="button"
                className="btn btn-sm"
                onClick={() => setDAmount(String(v))}
              >
                {v}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setDReason("نسي يسجّل حضوره")}
            >
              نسي يسجّل
            </button>
          </div>
          <label className="field">
            <span>السبب</span>
            <input
              className="input"
              value={dReason}
              onChange={(e) => setDReason(e.target.value)}
            />
          </label>
          <button className="btn btn-danger btn-block" onClick={addDeduction} disabled={busy}>
            {busy ? "جاري تسجيل الخصم…" : "تأكيد تسجيل الخصم"}
          </button>
          <div className="card-title" style={{ marginTop: 20 }}>آخر الخصومات المسجلة</div>
          {deductionLoadError && <div className="alert error" role="alert">{deductionLoadError}</div>}
          {deductions.length === 0 ? <div className="small muted">لا توجد خصومات سابقة لهذا العامل.</div> : (
            <div className="notification-list">
              {deductions.map((deduction) => (
                <div className="deduction-row" key={deduction.id}>
                  <div className="deduction-amount num">
                    {deduction.voided_at ? <span className="badge gray">ملغي</span> : <>− {money(deduction.amount)}</>}
                  </div>
                  <div className="small muted"><time dateTime={deduction.created_at}>{deduction.created_at?.slice(0, 10)}</time></div>
                  <div className="deduction-reason">{deduction.reason}{deduction.void_reason && <div className="small muted">سبب الإلغاء: {deduction.void_reason}</div>}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "password" && canResetPassword && (
        <>
          <label className="field">
            <span>كلمة السر الجديدة (8 أحرف على الأقل)</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
            />
          </label>
          <button className="btn btn-primary btn-block" onClick={resetPass} disabled={busy}>
            تغيير
          </button>
        </>
      )}
    </Modal>
  );
}
