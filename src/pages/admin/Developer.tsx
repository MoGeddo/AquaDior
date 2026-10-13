import { useCallback, useEffect, useState } from "react";
import { supabase, DEMO_MODE } from "../../lib/supabase";
import { db } from "../../lib/db";
import { fmtDateTime, money } from "../../lib/calc";
import { arabicError } from "../../lib/errors";
import { arabicQueueActionLabel, arabicQueueTableLabel, arabicTableLabel } from "../../lib/presentation";
import { Modal } from "../../components/Modal";
import { useDialog } from "../../components/DialogProvider";
import AppIcon from "../../components/AppIcon";
import SearchField from "../../components/SearchField";
import type { Profile } from "../../lib/types";

const ROLE_LABEL: Record<string, string> = {
  owner: "مالك",
  manager: "مدير",
  developer: "مطوّر",
  worker: "عامل",
};

const STATUS_LABEL: Record<string, string> = {
  active: "شغّال",
  pending: "مستني تفعيل",
  rejected: "مرفوض",
  suspended: "موقوف",
};

export default function Developer() {
  const { confirm } = useDialog();
  const [tab, setTab] = useState<"users" | "diag" | "audit">("users");
  const [users, setUsers] = useState<Profile[]>([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Profile | null>(null);
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState<any>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    const userRows = (data ?? []) as Profile[];
    setUsers(userRows);

    if (!DEMO_MODE) {
      const { data: s } = await supabase.rpc("system_stats");
      if (s) setStats(s);
    } else {
      setStats({
        workers: userRows.filter((u) => u.role === "worker").length,
        admins: userRows.filter((u) => u.role !== "worker").length,
        pending: userRows.filter((u) => u.status === "pending").length,
        attendance: 0,
        withdrawals: 0,
        deductions: 0,
        audit: 0,
        notifications: 0,
        settlements: 0,
      });
    }

    setQueue(await db.queue.toArray());

    const { data: l } = await supabase
      .from("audit_log")
      .select("*")
      .order("changed_at", { ascending: false })
      .limit(300);
    setLogs(l ?? []);

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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = users.filter(
    (u) =>
      u.full_name.includes(q) ||
      (u.username ?? "").toLowerCase().includes(q.toLowerCase()) ||
      (u.phone ?? "").includes(q)
  );

  return (
    <>
      <div className="flex mb wrap">
        <button
          className={`btn btn-sm ${tab === "users" ? "btn-primary" : ""}`}
          onClick={() => setTab("users")}
        >
          <AppIcon name="users" size={17} />
          كل المستخدمين ({users.length})
        </button>
        <button
          className={`btn btn-sm ${tab === "diag" ? "btn-primary" : ""}`}
          onClick={() => setTab("diag")}
        >
          <AppIcon name="activity" size={17} />
          التشخيص
        </button>
        <button
          className={`btn btn-sm ${tab === "audit" ? "btn-primary" : ""}`}
          onClick={() => setTab("audit")}
        >
          <AppIcon name="shieldCheck" size={17} />
          سجل التعديلات
        </button>
      </div>

      {msg && <div className="alert success">{msg}</div>}

      {/* ============ كل اليوزرات ============ */}
      {tab === "users" && (
        <>
          <div className="flex-between mb wrap">
            <SearchField
              value={q}
              onChange={setQ}
              maxWidth={300}
              ariaLabel="البحث في حسابات المستخدمين"
              placeholder="ابحث بالاسم أو اسم المستخدم أو الموبايل"
            />
            <span className="badge teal icon-label">
              <AppIcon name="wrench" size={16} />
              مطوّر — تقدر تعدّل أي يوزر
            </span>
          </div>

          <div className="card">
            <div className="table-wrap" role="region" aria-label="جدول حسابات المستخدمين" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>اسم المستخدم</th>
                    <th>الموبايل</th>
                    <th>الدور</th>
                    <th>الحالة</th>
                    <th>اليومية</th>
                    <th>أيام</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <b>{u.full_name}</b>
                      </td>
                      <td className="num" dir="ltr">
                        {u.username ?? "—"}
                      </td>
                      <td className="num" dir="ltr">
                        {u.phone ?? "—"}
                      </td>
                      <td>{ROLE_LABEL[u.role] ?? "غير معروف"}</td>
                      <td>
                        <span
                          className={`badge ${
                            u.status === "active"
                              ? "green"
                              : u.status === "pending"
                              ? "amber"
                              : "red"
                          }`}
                        >
                          {STATUS_LABEL[u.status] ?? "غير معروف"}
                        </span>
                      </td>
                      <td className="num">{money(u.daily_wage)}</td>
                      <td className="num">—</td>
                      <td>
                        <button className="btn btn-sm" onClick={() => setEditing(u)}>
                          <AppIcon name="pencil" size={16} />
                          تعديل
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ============ التشخيص ============ */}
      {tab === "diag" && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="label">عمال</div>
              <div className="value teal">{stats?.workers ?? 0}</div>
            </div>
            <div className="stat">
              <div className="label">حسابات إدارية</div>
              <div className="value blue">{stats?.admins ?? 0}</div>
            </div>
            <div className="stat">
              <div className="label">مستني تفعيل</div>
              <div className="value amber">{stats?.pending ?? 0}</div>
            </div>
            <div className="stat">
              <div className="label">عمليات مستنية رفع</div>
              <div className={`value ${queue.length ? "red" : "green"}`}>
                {queue.length}
              </div>
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-title">
                <span className="icon-label"><AppIcon name="database" size={18} /><span>حجم الداتا</span></span>
              </div>
              <div className="row">
                <span className="muted">سجلات حضور</span>
                <b className="num">{stats?.attendance ?? 0}</b>
              </div>
              <div className="row">
                <span className="muted">عمليات فلوس</span>
                <b className="num">{stats?.withdrawals ?? 0}</b>
              </div>
              <div className="row">
                <span className="muted">خصومات</span>
                <b className="num">{stats?.deductions ?? 0}</b>
              </div>
              <div className="row">
                <span className="muted">تسويات</span>
                <b className="num">{stats?.settlements ?? 0}</b>
              </div>
              <div className="row">
                <span className="muted">إشعارات</span>
                <b className="num">{stats?.notifications ?? 0}</b>
              </div>
              <div className="row">
                <span className="muted">سجل تعديلات</span>
                <b className="num">{stats?.audit ?? 0}</b>
              </div>
            </div>

            <div className="card">
              <div className="card-title">
                <span className="icon-label"><AppIcon name="activity" size={18} /><span>حالة النظام</span></span>
              </div>
              <div className="row">
                <span className="muted">الوضع</span>
                <span className="badge teal">
                  {DEMO_MODE ? "تجريبي" : "قاعدة البيانات الفعلية"}
                </span>
              </div>
              <div className="row">
                <span className="muted">النت</span>
                <span className={`badge ${navigator.onLine ? "green" : "red"}`}>
                  {navigator.onLine ? "متصل" : "مفيش نت"}
                </span>
              </div>
              <div className="row">
                <span className="muted">عمليات مستنية</span>
                <span className={`badge ${queue.length ? "amber" : "green"}`}>
                  {queue.length}
                </span>
              </div>
              {queue.slice(0, 6).map((op) => (
                <div className="row" key={op.id}>
                  <span className="small muted">
                    {arabicQueueTableLabel(op.table)} · {arabicQueueActionLabel(op.op)}
                  </span>
                  <span className="small red">
                    {op.last_error ? arabicError(op.last_error, "تعذر مزامنة العملية.").slice(0, 40) : `محاولة ${op.tries}`}
                  </span>
                </div>
              ))}
              <button
                className="btn btn-block mt"
                onClick={async () => {
                  const accepted = await confirm({
                    title: "مسح طابور المزامنة من هذا الجهاز؟",
                    message: `سيتم حذف ${queue.length} عملية محفوظة محليًا، بما فيها العمليات التي قد تكون ما زالت تنتظر المزامنة. لن تُحذف سجلات سبق حفظها على الخادم.`,
                    confirmText: "مسح العمليات المحلية",
                    cancelText: "إبقاء العمليات",
                    tone: "danger",
                  });
                  if (!accepted) return;
                  await db.queue.clear();
                  await load();
                }}
              >
                <AppIcon name="trash2" size={17} />
                امسح العمليات المستنية
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              <span className="icon-label"><AppIcon name="wrench" size={18} /><span>حلول سريعة</span></span>
            </div>
            <p className="small muted">
              لو حد نسي اسم المستخدم → دور عليه في تبويب <b>كل المستخدمين</b> بالموبايل.
              <br />
              لو حد نسي كلمة السر → افتح حسابه واضغط <b>تعديل</b> → غيّر كلمة السر.
              <br />
              لو عمليات مش بترتفع → شوف <b>آخر خطأ</b> فوق، ولو لسه فيه مشكلة امسح
              العمليات المستنية وخلي المستخدم يسجّل تاني.
            </p>
          </div>
        </>
      )}

      {/* ============ سجل التعديلات ============ */}
      {tab === "audit" && (
        <div className="card">
          <div className="card-title">
            <span>كل تعديل اتعمل في النظام — مين وإمتى</span>
          </div>
          <div className="table-wrap" role="region" aria-label="سجل تعديلات النظام" tabIndex={0}>
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
                      {fmtDateTime(l.changed_at)}
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
                        {l.action === "delete"
                          ? "حذف"
                          : l.action === "update"
                          ? "تعديل"
                          : "إضافة"}
                      </span>
                    </td>
                    <td className="small">
                      {names[l.changed_by] ?? "النظام"} — {arabicTableLabel(l.table_name)}
                    </td>
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

      {editing && (
        <EditUser
          user={editing}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            setMsg("تم الحفظ");
            await load();
          }}
        />
      )}
    </>
  );
}

function EditUser({
  user,
  onClose,
  onDone,
}: {
  user: Profile;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fullName, setFullName] = useState(user.full_name);
  const [username, setUsername] = useState(user.username ?? "");
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [wage, setWage] = useState(String(user.daily_wage || ""));
  const [active, setActive] = useState(user.is_active);
  const [newPass, setNewPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const canResetWorkerPassword = user.role === "worker" && role === "worker";

  async function save() {
    setErr("");
    setBusy(true);
    try {
      if (newPass.trim() && (newPass.trim().length < 8 || newPass.trim().length > 128)) {
        throw new Error("كلمة السر يجب أن تكون بين 8 و128 حرفًا");
      }
      if (newPass.trim() && !canResetWorkerPassword) {
        throw new Error("يمكن تغيير كلمة السر هنا لحساب عامل فقط؛ لا تغيّر كلمة سر حساب إداري من التطبيق");
      }
      if (!DEMO_MODE) {
        const { error } = await supabase.rpc("admin_update_user", {
          p_user_id: user.id,
          p_full_name: fullName,
          p_username: username,
          p_role: role,
          p_status: status,
          p_daily_wage: wage ? Number(wage) : null,
          p_is_active: active,
        });
        if (error) throw error;

        if (newPass.trim().length >= 8) {
          const { error: pErr } = await supabase.rpc("reset_worker_password", {
            p_worker_id: user.id,
            p_password: newPass.trim(),
          });
          if (pErr) throw pErr;
        }
      }
      onDone();
    } catch (e: any) {
      setErr(arabicError(e, "تعذر حفظ التغييرات."));
    }
    setBusy(false);
  }

  return (
    <Modal
      title={<span className="icon-label"><AppIcon name="pencil" size={18} /><span>تعديل {user.full_name}</span></span>}
      onClose={onClose}
    >
      {err && <div className="alert error">{err}</div>}

      <label className="field">
        <span>الاسم</span>
        <input
          className="input"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </label>

      <label className="field">
        <span>اسم المستخدم</span>
        <input
          className="input"
          dir="ltr"
          value={username}
          onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
        />
      </label>

      <div className="grid-2">
        <label className="field">
          <span>الدور</span>
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as any)}
          >
            <option value="worker">عامل</option>
            <option value="owner">مالك</option>
            <option value="manager">مدير</option>
            <option value="developer">مطوّر</option>
          </select>
        </label>

        <label className="field">
          <span>الحالة</span>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
          >
            <option value="active">شغّال</option>
            <option value="pending">مستني تفعيل</option>
            <option value="suspended">موقوف</option>
            <option value="rejected">مرفوض</option>
          </select>
        </label>
      </div>

      <div className="grid-2">
        <label className="field">
          <span>اليومية</span>
          <input
            className="input"
            inputMode="decimal"
            value={wage}
            onChange={(e) => setWage(e.target.value.replace(/[^\d.]/g, ""))}
          />
        </label>

        <label className="field">
          <span>مسموح يدخل؟</span>
          <select
            className="input"
            value={active ? "1" : "0"}
            onChange={(e) => setActive(e.target.value === "1")}
          >
            <option value="1">أيوه</option>
            <option value="0">لأ</option>
          </select>
        </label>
      </div>

      {canResetWorkerPassword && (
        <label className="field">
          <span className="icon-label"><AppIcon name="lockKeyhole" size={16} /><span>كلمة سر عامل جديدة (اختياري؛ 8 أحرف على الأقل)</span></span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            placeholder="8 أحرف على الأقل"
          />
        </label>
      )}

      <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
        {busy ? "جاري الحفظ..." : "حفظ"}
      </button>
    </Modal>
  );
}
