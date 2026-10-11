import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { money } from "../../lib/calc";
import type { Site, Project, WorkerBalance } from "../../lib/types";
import { Modal } from "../../components/Modal";

export default function Workers() {
  const [workers, setWorkers] = useState<WorkerBalance[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<WorkerBalance | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    const [{ data: w }, { data: s }, { data: p }] = await Promise.all([
      supabase.from("worker_balances").select("*").order("full_name"),
      supabase.from("sites").select("*").eq("is_active", true).order("name"),
      supabase.from("projects").select("*").eq("status", "active").order("name"),
    ]);
    setWorkers((w ?? []) as WorkerBalance[]);
    setSites((s ?? []) as Site[]);
    setProjects((p ?? []) as Project[]);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = workers.filter((w) => w.full_name.includes(q) || (w.phone ?? "").includes(q));

  return (
    <>
      <div className="flex-between mb">
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="🔍 ابحث بالاسم أو الموبايل"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          + إضافة عامل
        </button>
      </div>

      {msg && <div className="alert success">{msg}</div>}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الموبايل</th>
                <th>اليومية</th>
                <th>أيام</th>
                <th>استحقاق</th>
                <th>خد</th>
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
                  <td className="num green">
                    <b>{money(w.balance)}</b>
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => setEditing(w)}>
                      تفاصيل
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="center muted">
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
          sites={sites}
          projects={projects}
          onClose={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            setMsg("تم إضافة العامل ✅");
            await load();
          }}
        />
      )}

      {editing && (
        <EditWorker
          worker={editing}
          sites={sites}
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
  sites,
  projects,
  onClose,
  onDone,
}: {
  sites: Site[];
  projects: Project[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    full_name: "",
    phone: "",
    password: "",
    daily_wage: "",
  });
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setErr("");
    if (!f.full_name.trim()) return setErr("اكتب الاسم");
    if (f.phone.replace(/\D/g, "").length < 10) return setErr("اكتب رقم موبايل صحيح");
    if (f.password.length < 4) return setErr("كلمة السر 4 حروف على الأقل");

    setBusy(true);
    const { error } = await supabase.rpc("create_worker", {
      p_full_name: f.full_name.trim(),
      p_phone: f.phone.trim(),
      p_password: f.password,
      p_daily_wage: Number(f.daily_wage || 0),
      p_site_ids: siteIds.length ? siteIds : null,
      p_project_id: projectId || null,
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
        <span>كلمة السر</span>
        <input
          className="input"
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
      <label className="field">
        <span>المشروع</span>
        <select
          className="input"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">— من غير مشروع —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span>المواقع</span>
        <div className="flex" style={{ flexWrap: "wrap", gap: 8 }}>
          {sites.map((s) => {
            const on = siteIds.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={`btn btn-sm ${on ? "btn-primary" : ""}`}
                onClick={() =>
                  setSiteIds((p) =>
                    on ? p.filter((x) => x !== s.id) : [...p, s.id]
                  )
                }
              >
                {on ? "✓ " : ""}
                {s.name}
              </button>
            );
          })}
        </div>
      </div>
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
        {busy ? "جاري الحفظ..." : "حفظ"}
      </button>
    </Modal>
  );
}

/* ============ تعديل عامل ============ */
function EditWorker({
  worker,
  sites,
  onClose,
  onDone,
}: {
  worker: WorkerBalance;
  sites: Site[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<"info" | "deduct" | "password">("info");
  const [fullName, setFullName] = useState(worker.full_name);
  const [phone, setPhone] = useState(worker.phone ?? "");
  const [wage, setWage] = useState(String(worker.daily_wage));
  const [active, setActive] = useState(worker.is_active);
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [dAmount, setDAmount] = useState("");
  const [dReason, setDReason] = useState("");
  const [newPass, setNewPass] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("site_workers")
        .select("site_id")
        .eq("worker_id", worker.worker_id);
      setSiteIds((data ?? []).map((r: any) => r.site_id));
    })();
  }, [worker.worker_id]);

  async function saveInfo() {
    setErr("");
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        phone: phone.trim(),
        daily_wage: Number(wage || 0),
        is_active: active,
      })
      .eq("id", worker.worker_id);

    if (!error) {
      await supabase
        .from("site_workers")
        .delete()
        .eq("worker_id", worker.worker_id);
      if (siteIds.length) {
        await supabase
          .from("site_workers")
          .insert(siteIds.map((s) => ({ site_id: s, worker_id: worker.worker_id })));
      }
    }
    setBusy(false);
    if (error) return setErr(error.message);
    setOk("تم الحفظ ✅");
    onDone();
  }

  async function addDeduction() {
    setErr("");
    const v = Number(dAmount);
    if (!v || v <= 0) return setErr("اكتب مبلغ صحيح");
    if (!dReason.trim()) return setErr("اكتب السبب");
    setBusy(true);
    const { error } = await supabase.from("deductions").insert({
      worker_id: worker.worker_id,
      amount: v,
      reason: dReason.trim(),
      created_by: (await supabase.auth.getUser()).data.user?.id,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setOk("تم الخصم ✅");
    setDAmount("");
    setDReason("");
    onDone();
  }

  async function resetPass() {
    setErr("");
    if (newPass.length < 4) return setErr("كلمة السر 4 حروف على الأقل");
    setBusy(true);
    const { error } = await supabase.rpc("reset_worker_password", {
      p_worker_id: worker.worker_id,
      p_password: newPass,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setOk("تم تغيير كلمة السر ✅");
    setNewPass("");
  }

  return (
    <Modal title={worker.full_name} onClose={onClose}>
      <div className="flex mb">
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
        <button
          className={`btn btn-sm ${tab === "password" ? "btn-primary" : ""}`}
          onClick={() => setTab("password")}
        >
          كلمة السر
        </button>
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
          <div className="field">
            <span>المواقع</span>
            <div className="flex" style={{ flexWrap: "wrap", gap: 8 }}>
              {sites.map((s) => {
                const on = siteIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`btn btn-sm ${on ? "btn-primary" : ""}`}
                    onClick={() =>
                      setSiteIds((p) =>
                        on ? p.filter((x) => x !== s.id) : [...p, s.id]
                      )
                    }
                  >
                    {on ? "✓ " : ""}
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
          <button className="btn btn-primary btn-block" onClick={saveInfo} disabled={busy}>
            حفظ
          </button>
        </>
      )}

      {tab === "deduct" && (
        <>
          <div className="alert info">
            الخصم هيتحسب من استحقاق العامل في التسوية النهائية
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
            خصم
          </button>
        </>
      )}

      {tab === "password" && (
        <>
          <label className="field">
            <span>كلمة السر الجديدة</span>
            <input
              className="input"
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
