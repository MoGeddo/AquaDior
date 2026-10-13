import { useEffect, useState } from "react";
import { supabase, DEMO_MODE } from "../../lib/supabase";
import type { Project } from "../../lib/types";
import { todayStr } from "../../lib/calc";
import { Modal } from "../../components/Modal";
import { useDialog } from "../../components/DialogProvider";
import { useAuth } from "../../store/auth";
import AppIcon from "../../components/AppIcon";

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
    csvRow("=== العمال الذين سجلوا حضورًا بالمشروع ==="),
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
  const { profile } = useAuth();
  const { alert, confirm: confirmInApp } = useDialog();
  const isDeveloper = profile?.role === "developer";
  const [projects, setProjects] = useState<Project[]>([]);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
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

  async function deleteProject(projectId: string, projectName: string) {
    if (!isDeveloper || deletingProjectId) return;
    const confirmed = await confirmInApp({
      title: `حذف المشروع «${projectName}»؟`,
      message: "سيُحذف المشروع نهائيًا إذا لم يرتبط بحضور أو سحوبات أو خصومات أو تسويات. إذا كان له سجل تاريخي، سيرفض الخادم الحذف؛ استخدم الأرشفة للحفاظ على السجلات.",
      confirmText: "حذف المشروع",
      cancelText: "إبقاء المشروع",
      tone: "danger",
    });
    if (!confirmed) return;

    setDeleteError("");
    setMsg("");
    setDeletingProjectId(projectId);
    try {
      const { error } = await supabase.rpc("developer_delete_project", {
        p_project_id: projectId,
      });
      if (error) {
        setDeleteError(error.message);
        return;
      }
      setMsg(`تم حذف المشروع «${projectName}» نهائيًا.`);
      await load();
    } catch (error: any) {
      setDeleteError(error?.message ?? "تعذّر حذف المشروع");
    } finally {
      setDeletingProjectId(null);
    }
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
    setMsg("تمت أرشفة المشروع (البيانات محفوظة في الأرشيف)");
    await load();
  }

  async function exportProject(p: Project) {
    if (DEMO_MODE) {
      await alert({
        title: "التصدير غير متاح في وضع Demo",
        message: "تصدير CSV متاح عند استخدام قاعدة Supabase الحقيقية فقط؛ بيانات Demo تجريبية ومحفوظة محليًا.",
        tone: "info",
      });
      return;
    }
    const { data, error } = await supabase.rpc("export_project_data", {
      p_project_id: p.id,
    });
    if (error) {
      await alert({
        title: "تعذّر تصدير المشروع",
        message: error.message,
        tone: "error",
      });
      return;
    }
    downloadCsv(`مشروع-${p.name}.csv`, data);
    setMsg("تم تحميل الملف.");
  }

  const active = projects.filter((p) => p.status === "active");
  const closed = projects.filter((p) => p.status === "closed");

  return (
    <>
      <div className="flex-between mb wrap project-toolbar">
        <div className="flex wrap project-tabs">
          <button
            className={`btn btn-sm ${tab === "active" ? "btn-primary" : ""}`}
            onClick={() => setTab("active")}
            aria-pressed={tab === "active"}
          >
            <AppIcon name="building2" size={18} />
            شغّالة ({active.length})
          </button>
          <button
            className={`btn btn-sm ${tab === "archive" ? "btn-primary" : ""}`}
            onClick={() => setTab("archive")}
            aria-pressed={tab === "archive"}
          >
            <AppIcon name="archive" size={18} />
            الأرشيف ({closed.length})
          </button>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          + إضافة مشروع/موقع
        </button>
      </div>

      {msg && <div className="alert success">{msg}</div>}
      {deleteError && <div className="alert error" role="alert">{deleteError}</div>}
      {isDeveloper && (
        <div className="alert info" role="note">
          الحذف النهائي للمشروع متاح للمطوّر فقط عندما لا توجد سجلات حضور أو حركات مالية؛ المشاريع ذات التاريخ تُؤرشف ولا تُمحى.
        </div>
      )}

      {/* ===== مشاريع شغّالة ===== */}
      {tab === "active" && (
        <div className="card">
          <div className="card-title">
            <span className="icon-label">
              <AppIcon name="building2" size={18} />
              <span>المشاريع/المواقع الشغّالة</span>
            </span>
          </div>
          <p className="project-scroll-hint small muted">اسحب الجدول أفقيًا لعرض بقية الأعمدة.</p>
          <div className="table-wrap project-table-wrap" role="region" aria-label="جدول المشاريع النشطة" tabIndex={0}>
            <table className="project-table">
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
                      {p.address && (
                        <div className="small muted icon-label project-address">
                          <AppIcon name="mapPin" size={15} />
                          <span>{p.address}</span>
                        </div>
                      )}
                      {p.description && <div className="small muted">{p.description}</div>}
                    </td>
                    <td className="num">{p.start_date ?? "—"}</td>
                    <td>
                      <span className="badge green">شغّال</span>
                    </td>
                    <td>
                      <button
                        className="btn btn-sm"
                        onClick={() => setDetail(p)}
                        aria-label={`فتح تفاصيل المشروع ${p.name}`}
                      >
                        <AppIcon name="folderOpen" size={17} />
                        افتح
                      </button>
                    </td>
                    <td>
                      <button
                        className="btn btn-sm"
                        onClick={() => exportProject(p)}
                        aria-label={`تصدير بيانات المشروع ${p.name} بصيغة CSV`}
                      >
                        <AppIcon name="download" size={17} />
                        CSV
                      </button>
                    </td>
                    <td>
                      <div className="flex wrap project-row-actions">
                        <button
                          className="btn btn-sm"
                          onClick={() => askClose(p)}
                          aria-label={`أرشفة المشروع ${p.name}`}
                        >
                          <AppIcon name="archive" size={17} />
                          أرشفة المشروع
                        </button>
                        {isDeveloper && (
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => void deleteProject(p.id, p.name)}
                            disabled={Boolean(deletingProjectId)}
                            aria-label={`حذف المشروع ${p.name} نهائيًا`}
                          >
                            <AppIcon name="trash2" size={17} />
                            {deletingProjectId === p.id ? "جاري الحذف..." : "حذف نهائي"}
                          </button>
                        )}
                      </div>
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
            <span className="icon-label">
              <AppIcon name="archive" size={18} />
              <span>أرشيف المشاريع/المواقع المؤرشفة — البيانات كلها محفوظة</span>
            </span>
          </div>
          <p className="project-scroll-hint small muted">اسحب الجدول أفقيًا لعرض بقية الأعمدة.</p>
          <div className="table-wrap project-table-wrap" role="region" aria-label="جدول المشاريع المؤرشفة" tabIndex={0}>
            <table className="project-table">
              <thead>
                <tr>
                  <th>المشروع/الموقع</th>
                  <th>أُرشف</th>
                  <th>عمال</th>
                  <th>سجلات حضور</th>
                  <th>تفاصيل العاملين والحضور</th>
                  <th>تصدير</th>
                  {isDeveloper && <th>إدارة</th>}
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
                        aria-label={`فتح تفاصيل المشروع ${a.project_name}`}
                      >
                        <AppIcon name="folderOpen" size={17} />
                        افتح
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
                        aria-label={`تصدير بيانات المشروع ${a.project_name} بصيغة CSV`}
                      >
                        <AppIcon name="download" size={17} />
                        CSV
                      </button>
                    </td>
                    {isDeveloper && (
                      <td>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => void deleteProject(a.project_id, a.project_name)}
                          disabled={Boolean(deletingProjectId)}
                          aria-label={`حذف المشروع ${a.project_name} نهائيًا`}
                        >
                          <AppIcon name="trash2" size={17} />
                          {deletingProjectId === a.project_id ? "جاري الحذف..." : "حذف نهائي"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {archive.length === 0 && (
                  <tr>
                    <td colSpan={isDeveloper ? 7 : 6} className="center muted">
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
        <div className="card-title">
          <span className="icon-label">
            <AppIcon name="lockKeyhole" size={18} />
            <span>إزاي الأرشفة بتشتغل؟</span>
          </span>
        </div>
        <ul className="project-archive-tips">
          <li>
            <AppIcon name="circleCheck" size={18} />
            <span><b>الأرشفة لا تمسح بيانات الحضور.</b></span>
          </li>
          <li>
            <AppIcon name="circleCheck" size={18} />
            <span><b>الرصيد المالي للعامل عام</b> ولا يتغير بأرشفة مشروع؛ اليومية تُحسب مرة واحدة في اليوم مهما تعددت المشاريع.</span>
          </li>
          <li>
            <AppIcon name="circleCheck" size={18} />
            <span><b>لازم كلمة السر</b> لتأكيد الأرشفة.</span>
          </li>
          <li>
            <AppIcon name="circleCheck" size={18} />
            <span>المشروع ينتقل إلى <b>الأرشيف</b> وتظل سجلات حضور العاملين المرتبطة به متاحة للإدارة.</span>
          </li>
        </ul>
      </div>

      {adding && (
        <Modal title="إضافة مشروع/موقع" onClose={() => setAdding(false)}>
          <ProjectForm
            onDone={async () => {
              setAdding(false);
              setMsg("تم الإضافة.");
              await load();
            }}
          />
        </Modal>
      )}

      {/* ===== مودال القفل: تحذير + كلمة السر ===== */}
      {confirm && (
        <Modal centered title={`أرشفة مشروع ${confirm.name}؟`} onClose={() => setConfirm(null)}>
          <div className="alert error" style={{ lineHeight: 1.9 }}>
            <b>متأكد؟ ده إجراء مهم.</b>
            <br />
            عند أرشفة المشروع:
            <br />
            • المشروع سيصبح مؤرشفًا، ولن يظهر ضمن المشاريع النشطة لتسجيل حضور جديد.
          </div>

          <div className="alert success" style={{ lineHeight: 1.9 }}>
            <span className="icon-label">
              <AppIcon name="circleCheck" size={18} />
              <b>البيانات مش هتتمسح خالص.</b>
            </span>
            <br />
            سجلات الحضور وروابط المشاريع محفوظة، ويمكنك فتح الأرشيف وتصدير نشاط المشروع. الرصيد المالي يظل في كشف العامل العام ولا يتكرر هنا.
          </div>

          <label className="field">
            <span className="icon-label">
              <AppIcon name="lockKeyhole" size={17} />
              <span>اكتب كلمة السر لتأكيد الأرشفة</span>
            </span>
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

          <div className="flex wrap mt project-confirm-actions">
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
              لا، اترك المشروع نشطًا
            </button>
            <button
              className="btn btn-danger"
              onClick={() => closeProject(confirm)}
              disabled={busy || !pw.trim()}
            >
              {busy ? (
                "بيتحقق..."
              ) : (
                <>
                  <AppIcon name="lockKeyhole" size={17} />
                  تأكيد الأرشفة
                </>
              )}
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
    <Modal title={project.name} onClose={onClose}>
      {loading && <p className="center muted">بيحمّل البيانات...</p>}
      {err && <div className="alert error">{err}</div>}

      {!loading && !err && (
        <>
          {proj.address && (
            <div className="small muted mb icon-label project-address">
              <AppIcon name="mapPin" size={15} />
              <span>{proj.address}</span>
            </div>
          )}
          <div className="stat-row wrap mb">
            <div className="stat project-detail-stat">
              <span className="icon-label">
                <AppIcon name="hardHat" size={17} />
                <span>عمال سجّلوا حضورًا</span>
              </span>
              <b>{workers.length}</b>
            </div>
            <div className="stat project-detail-stat">
              <span className="icon-label">
                <AppIcon name="calendarCheck" size={17} />
                <span>سجلات الحضور بالمشروع</span>
              </span>
              <b>{attendance.length}</b>
            </div>
          </div>

          {proj.closed_at && (
            <div className="alert" style={{ lineHeight: 1.9 }}>
              <span className="icon-label">
                <AppIcon name="lockKeyhole" size={17} />
                <span>
                  المشروع مؤرشف منذ <b>{(proj.closed_at ?? "").slice(0, 10)}</b>.
                  {proj.archived_at && <> دخل الأرشيف يوم <b>{proj.archived_at.slice(0, 10)}</b>.</>}
                </span>
              </span>
              <br />تظهر هنا أنشطة هذا المشروع فقط؛ الرصيد المالي محفوظ مرة واحدة في كشف العامل العام.
            </div>
          )}

          <div className="flex wrap mb project-detail-tabs">
            <button
              className={`btn btn-sm ${tab === "workers" ? "btn-primary" : ""}`}
              onClick={() => setTab("workers")}
              aria-pressed={tab === "workers"}
            >
              <AppIcon name="hardHat" size={17} />
              العمال ({workers.length})
            </button>
            <button
              className={`btn btn-sm ${tab === "attendance" ? "btn-primary" : ""}`}
              onClick={() => setTab("attendance")}
              aria-pressed={tab === "attendance"}
            >
              <AppIcon name="calendarCheck" size={17} />
              الحضور ({attendance.length})
            </button>
          </div>

          <p className="project-scroll-hint small muted">اسحب الجدول أفقيًا لعرض بقية الأعمدة.</p>
          <div
            className="table-wrap project-detail-table-wrap"
            role="region"
            aria-label={tab === "workers" ? "جدول عمال المشروع" : "جدول حضور المشروع"}
            tabIndex={0}
          >
            {tab === "workers" && (
              <table className="project-detail-table project-detail-table-workers">
                <thead>
                  <tr>
                    <th>العامل الذي عمل بالمشروع</th>
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
                    <tr><td colSpan={2} className="center muted">لم يسجل أي عامل حضورًا بهذا المشروع بعد.</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {tab === "attendance" && (
              <table className="project-detail-table project-detail-table-attendance">
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
