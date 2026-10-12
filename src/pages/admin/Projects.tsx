import { useEffect, useState } from "react";
import { supabase, DEMO_MODE } from "../../lib/supabase";
import type { Project } from "../../lib/types";
import { todayStr } from "../../lib/calc";
import { Modal } from "../../components/Modal";

/** CSV escaping plus formula-injection protection for user-controlled fields. */
function csvCell(value: unknown): string {
  let text = String(value ?? "");
  const firstSignificant = [...text].find((char) => {
    const code = char.charCodeAt(0);
    return code > 0x20 && !/\s/u.test(char);
  });
  if (firstSignificant && "=+@-".includes(firstSignificant)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvRow(...values: unknown[]): string {
  return values.map(csvCell).join(",");
}

/** يحوّل بيانات المشروع لملف CSV ويحمّله */
function downloadCsv(filename: string, data: any) {
  const proj = data.project ?? {};
  const lines: string[] = [
    csvRow("مشروع/موقع", proj.name),
    csvRow("العنوان", proj.address),
    csvRow("الحالة", proj.status),
    csvRow("أُرشف", proj.closed_at),
    "",
    csvRow("=== العمال المعيّنون ==="),
    csvRow("الاسم", "الموبايل"),
  ];
  (data.workers ?? []).forEach((worker: any) =>
    lines.push(csvRow(worker.full_name, worker.phone))
  );
  lines.push("", csvRow("=== الحضور في المشروع/الموقع ==="), csvRow("التاريخ", "العامل", "المشاريع/المواقع المسجلة", "سجّل الساعة"));
  (data.attendance ?? []).forEach((attendance: any) =>
    lines.push(csvRow(attendance.work_date, attendance.full_name, (attendance.projects ?? []).join("، "), attendance.created_at))
  );

  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState<Project | null>(null);
  const [archive, setArchive] = useState<any[]>([]);
  const [tab, setTab] = useState<"active" | "archive">("active");
  const [detail, setDetail] = useState<Project | null>(null);

  // ===== حالة القفل (تحذير + كلمة السر) =====
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [{ data: p }, { data: a }] = await Promise.all([
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      supabase.from("project_archive").select("*").order("closed_at", { ascending: false }),
    ]);
    setProjects((p ?? []) as Project[]);
    setArchive((a ?? []) as any[]);
  }

  useEffect(() => {
    load();
  }, []);

  /** فتح مودال القفل — بيصفّر الحالة كل مرة */
  function askClose(p: Project) {
    setConfirm(p);
    setPw("");
    setPwErr("");
    setBusy(false);
  }

  /** أرشفة المشروع — بعد التحقق الحقيقي من كلمة السر */
  async function closeProject(p: Project) {
    if (!pw.trim()) {
      setPwErr("اكتب كلمة السر لتأكيد الأرشفة");
      return;
    }
    setBusy(true);
    setPwErr("");

    // تحقق حقيقي: نحاول ندخل بنفس الحساب وكلمة السر المكتوبة
    const { data: u } = await supabase.auth.getUser();
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email: u.user?.email ?? "",
      password: pw,
    });
    if (authErr) {
      setBusy(false);
      setPwErr("كلمة السر غلط — الأرشفة ما تمت. جرّب تاني.");
      setPw("");
      return;
    }

    const { error } = await supabase.rpc("close_project", { p_project_id: p.id });
    setBusy(false);
    if (error) {
      setPwErr(error.message);
      return;
    }
    setConfirm(null);
    setPw("");
    setMsg("تمت أرشفة المشروع ✅ (البيانات محفوظة في الأرشيف)");
    await load();
  }

  async function exportProject(p: Project) {
    if (DEMO_MODE) {
      alert("التصدير شغّال على الداتابيز الحقيقية (Supabase)");
      return;
    }
    const { data, error } = await supabase.rpc("export_project_data", {
      p_project_id: p.id,
    });
    if (error) return alert(error.message);
    downloadCsv(`مشروع-${p.name}.csv`, data);
    setMsg("تم تحميل الملف ✅");
  }

  const active = projects.filter((p) => p.status === "active");
  const closed = projects.filter((p) => p.status === "closed");

  return (
    <>
      <div className="flex-between mb wrap">
        <div className="flex">
          <button
            className={`btn btn-sm ${tab === "active" ? "btn-primary" : ""}`}
            onClick={() => setTab("active")}
          >
            🏗️ شغّالة ({active.length})
          </button>
          <button
            className={`btn btn-sm ${tab === "archive" ? "btn-primary" : ""}`}
            onClick={() => setTab("archive")}
          >
            📦 الأرشيف ({closed.length})
          </button>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          + إضافة مشروع/موقع
        </button>
      </div>

      {msg && <div className="alert success">{msg}</div>}

      {/* ===== مشاريع شغّالة ===== */}
      {tab === "active" && (
        <div className="card">
          <div className="card-title">
            <span>المشاريع/المواقع الشغّالة</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>المشروع/الموقع</th>
                  <th>البداية</th>
                  <th>الحالة</th>
                  <th>تفاصيل</th>
                  <th>تصدير</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {active.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.name}</b>
                      {p.address && <div className="small muted">📍 {p.address}</div>}
                      {p.description && <div className="small muted">{p.description}</div>}
                    </td>
                    <td className="num">{p.start_date ?? "—"}</td>
                    <td>
                      <span className="badge green">شغّال</span>
                    </td>
                    <td>
                      <button className="btn btn-sm" onClick={() => setDetail(p)}>
                        📂 افتح
                      </button>
                    </td>
                    <td>
                      <button className="btn btn-sm" onClick={() => exportProject(p)}>
                        📥 CSV
                      </button>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-danger" onClick={() => askClose(p)}>
                        أرشفة المشروع
                      </button>
                    </td>
                  </tr>
                ))}
                {active.length === 0 && (
                  <tr>
                    <td colSpan={6} className="center muted">
                      مفيش مشاريع شغّالة
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== الأرشيف ===== */}
      {tab === "archive" && (
        <div className="card">
          <div className="card-title">
            <span>📦 أرشيف المشاريع/المواقع المؤرشفة — البيانات كلها محفوظة</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>المشروع/الموقع</th>
                  <th>أُرشف</th>
                  <th>عمال</th>
                  <th>سجلات حضور</th>
                  <th>تفاصيل العاملين والحضور</th>
                  <th>تصدير</th>
                </tr>
              </thead>
              <tbody>
                {archive.map((a) => (
                  <tr key={a.project_id}>
                    <td>
                      <b>{a.project_name}</b>
                    </td>
                    <td className="num small">{(a.closed_at ?? "").slice(0, 10)}</td>
                    <td className="num">{a.workers_count}</td>
                    <td className="num">{a.attendance_count}</td>
                    <td>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() =>
                          setDetail({ id: a.project_id, name: a.project_name } as Project)
                        }
                      >
                        📂 افتح
                      </button>
                    </td>
                    <td>
                      <button
                        className="btn btn-sm"
                        onClick={() =>
                          exportProject({
                            id: a.project_id,
                            name: a.project_name,
                          } as Project)
                        }
                      >
                        📥 CSV
                      </button>
                    </td>
                  </tr>
                ))}
                {archive.length === 0 && (
                  <tr>
                    <td colSpan={6} className="center muted">
                      مفيش مشاريع/مواقع مؤرشفة
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">🔒 إزاي الأرشفة بتشتغل؟</div>
        <p className="small muted" style={{ lineHeight: 1.9 }}>
          ✅ <b>الأرشفة لا تمسح بيانات الحضور.</b>
          <br />✅ <b>الرصيد المالي للعامل عام</b> ولا يتغير بأرشفة مشروع؛ اليومية تُحسب مرة واحدة في اليوم مهما تعددت المشاريع.
          <br />✅ <b>لازم كلمة السر</b> لتأكيد الأرشفة.
          <br />✅ المشروع ينتقل إلى <b>الأرشيف</b> وتظل سجلات حضور العاملين المرتبطة به متاحة للإدارة.
        </p>
      </div>

      {adding && (
        <Modal title="إضافة مشروع/موقع" onClose={() => setAdding(false)}>
          <ProjectForm
            onDone={async () => {
              setAdding(false);
              setMsg("تم الإضافة ✅");
              await load();
            }}
          />
        </Modal>
      )}

      {/* ===== مودال القفل: تحذير + كلمة السر ===== */}
      {confirm && (
        <Modal title={`⚠️ أرشفة مشروع ${confirm.name}؟`} onClose={() => setConfirm(null)}>
          <div className="alert error" style={{ lineHeight: 1.9 }}>
            <b>متأكد؟ ده إجراء مهم.</b>
            <br />
            عند أرشفة المشروع:
            <br />
            • المشروع سيصبح مؤرشفًا، ولن يظهر ضمن المشاريع النشطة لتسجيل حضور جديد.
          </div>

          <div className="alert success" style={{ lineHeight: 1.9 }}>
            ✅ <b>البيانات مش هتتمسح خالص.</b>
            <br />
            سجلات الحضور وروابط المشاريع محفوظة، ويمكنك فتح الأرشيف وتصدير نشاط المشروع. الرصيد المالي يظل في كشف العامل العام ولا يتكرر هنا.
          </div>

          <label className="field">
            <span>🔑 اكتب كلمة السر لتأكيد الأرشفة</span>
            <input
              className="input"
              type="password"
              autoFocus
              placeholder="كلمة السر"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && closeProject(confirm)}
            />
          </label>

          {pwErr && <div className="alert error">{pwErr}</div>}

          <div className="flex gap mt">
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
              لا، اترك المشروع نشطًا
            </button>
            <button
              className="btn btn-danger"
              onClick={() => closeProject(confirm)}
              disabled={busy || !pw.trim()}
            >
              {busy ? "بيتحقق..." : "🔒 تأكيد الأرشفة"}
            </button>
          </div>
        </Modal>
      )}

      {/* ===== صفحة تفاصيل المشروع (شغّال أو مؤرشف) ===== */}
      {detail && <ProjectDetail project={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

type DTab = "workers" | "attendance";

function ProjectDetail({ project, onClose }: { project: Project; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<DTab>("workers");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      const { data, error } = await supabase.rpc("export_project_data", {
        p_project_id: project.id,
      });
      if (cancelled) return;
      if (error) {
        setErr(error.message);
        setLoading(false);
        return;
      }
      setData(data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [project.id]);

  const workers: any[] = data?.workers ?? [];
  const attendance: any[] = data?.attendance ?? [];
  const proj = data?.project ?? {};

  return (
    <Modal title={`📂 ${project.name}`} onClose={onClose}>
      {loading && <p className="center muted">بيحمّل البيانات...</p>}
      {err && <div className="alert error">{err}</div>}

      {!loading && !err && (
        <>
          {proj.address && <div className="small muted mb">📍 {proj.address}</div>}
          <div className="stat-row wrap mb">
            <div className="stat">
              <span>👷 العمال المرتبطون</span>
              <b>{workers.length}</b>
            </div>
            <div className="stat">
              <span>📅 سجلات الحضور بالمشروع</span>
              <b>{attendance.length}</b>
            </div>
          </div>

          {proj.closed_at && (
            <div className="alert" style={{ lineHeight: 1.9 }}>
              🔒 المشروع مؤرشف منذ <b>{(proj.closed_at ?? "").slice(0, 10)}</b>.
              {proj.archived_at && <> دخل الأرشيف يوم <b>{proj.archived_at.slice(0, 10)}</b>.</>}
              <br />تظهر هنا أنشطة هذا المشروع فقط؛ الرصيد المالي محفوظ مرة واحدة في كشف العامل العام.
            </div>
          )}

          <div className="flex wrap mb">
            <button className={`btn btn-sm ${tab === "workers" ? "btn-primary" : ""}`} onClick={() => setTab("workers")}>
              👷 العمال ({workers.length})
            </button>
            <button className={`btn btn-sm ${tab === "attendance" ? "btn-primary" : ""}`} onClick={() => setTab("attendance")}>
              📅 الحضور ({attendance.length})
            </button>
          </div>

          <div className="table-wrap">
            {tab === "workers" && (
              <table>
                <thead>
                  <tr>
                    <th>العامل المرتبط بالمشروع</th>
                    <th>الموبايل</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map((worker, i) => (
                    <tr key={worker.worker_id ?? i}>
                      <td><b>{worker.full_name}</b></td>
                      <td className="num">{worker.phone ?? "—"}</td>
                    </tr>
                  ))}
                  {workers.length === 0 && (
                    <tr><td colSpan={2} className="center muted">لا يوجد عامل مرتبط بهذا المشروع.</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {tab === "attendance" && (
              <table>
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>العامل</th>
                    <th>المشاريع/المواقع في سجل الحضور</th>
                    <th>وقت التسجيل</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.map((row, i) => (
                    <tr key={row.attendance_id ?? i}>
                      <td className="num">{row.work_date}</td>
                      <td>{row.full_name}</td>
                      <td>{(row.projects ?? [project.name]).join("، ")}</td>
                      <td className="num small">{row.created_at ? new Date(row.created_at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    </tr>
                  ))}
                  {attendance.length === 0 && (
                    <tr><td colSpan={4} className="center muted">لا يوجد حضور مرتبط بهذا المشروع.</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function ProjectForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [desc, setDesc] = useState("");
  const [start, setStart] = useState(todayStr);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return setErr("اكتب اسم المشروع");
    setBusy(true);
    const { error } = await supabase.from("projects").insert({
      name: name.trim(),
      address: address.trim() || null,
      description: desc.trim() || null,
      start_date: start,
      created_by: (await supabase.auth.getUser()).data.user?.id,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    onDone();
  }

  return (
    <>
      {err && <div className="alert error">{err}</div>}
      <label className="field">
        <span>اسم المشروع/الموقع</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>العنوان أو وصف الموقع (اختياري)</span>
        <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="field">
        <span>وصف (اختياري)</span>
        <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </label>
      <label className="field">
        <span>تاريخ البداية</span>
        <input
          className="input"
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
        حفظ
      </button>
    </>
  );
}
