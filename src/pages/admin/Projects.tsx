import { useEffect, useState } from "react";
import { supabase, DEMO_MODE } from "../../lib/supabase";
import type { Project } from "../../lib/types";
import { Modal } from "../../components/Modal";

/** يحوّل بيانات المشروع لملف CSV ويحمّله */
function downloadCsv(filename: string, data: any) {
  const proj = data.project ?? {};
  const lines: string[] = [];
  lines.push(`"مشروع","${proj.name ?? ""}"`);
  lines.push(`"الحالة","${proj.status ?? ""}"`);
  lines.push(`"اتقفل","${proj.closed_at ?? ""}"`);
  lines.push("");

  lines.push("=== العمال ===");
  lines.push("الاسم,الموبايل,اليومية");
  (data.workers ?? []).forEach((w: any) =>
    lines.push(`"${w.full_name}","${w.phone ?? ""}",${w.project_daily_wage ?? w.daily_wage ?? 0}`)
  );
  lines.push("");

  lines.push("=== الحضور ===");
  lines.push("التاريخ,العامل,اليومية,سجّل الساعة");
  (data.attendance ?? []).forEach((a: any) =>
    lines.push(`${a.work_date},"${a.full_name}",${a.daily_wage ?? 0},${a.created_at ?? ""}`)
  );
  lines.push("");

  lines.push("=== الفلوس ===");
  lines.push("التاريخ,العامل,المبلغ,ملاحظة,الحالة");
  (data.withdrawals ?? []).forEach((w: any) =>
    lines.push(`${(w.created_at ?? "").slice(0, 10)},"${w.full_name}",${w.amount},"${w.note ?? ""}",${w.status}`)
  );
  lines.push("");

  lines.push("=== الخصومات ===");
  lines.push("التاريخ,العامل,المبلغ,السبب");
  (data.deductions ?? []).forEach((d: any) =>
    lines.push(`${(d.created_at ?? "").slice(0, 10)},"${d.full_name}",${d.amount},"${d.reason}"`)
  );
  lines.push("");

  lines.push("=== التسويات ===");
  lines.push("العامل,أيام,اليومية,استحقاق,مسحوب,خصومات,الصافي,الحالة");
  (data.settlements ?? []).forEach((s: any) =>
    lines.push(`"${s.full_name}",${s.days_worked},${s.daily_wage},${s.total_earned},${s.total_withdrawn},${s.total_deductions},${s.net_amount},${s.status}`)
  );

  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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

  /** قفل المشروع — بعد التحقق الحقيقي من كلمة السر */
  async function closeProject(p: Project) {
    if (!pw.trim()) {
      setPwErr("اكتب كلمة السر عشان تقفل المشروع");
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
      setPwErr("كلمة السر غلط — القفل ماتنفّذش. جرّب تاني.");
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
    setMsg("تم قفل المشروع ✅ (البيانات كلها اتحفظت في الأرشيف)");
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
          + إضافة مشروع
        </button>
      </div>

      {msg && <div className="alert success">{msg}</div>}

      {/* ===== مشاريع شغّالة ===== */}
      {tab === "active" && (
        <div className="card">
          <div className="card-title">
            <span>المشاريع الشغّالة</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>المشروع</th>
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
                        قفل المشروع
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
            <span>📦 أرشيف المشاريع المقفولة — البيانات كلها محفوظة</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>المشروع</th>
                  <th>اتقفل</th>
                  <th>عمال</th>
                  <th>سجلات حضور</th>
                  <th>فلوس</th>
                  <th>خصومات</th>
                  <th>تفاصيل</th>
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
                    <td className="num amber">{a.total_withdrawn}</td>
                    <td className="num red">{a.total_deductions}</td>
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
                    <td colSpan={8} className="center muted">
                      مفيش مشاريع مقفولة
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">🔒 إزاي القفل بيشتغل؟</div>
        <p className="small muted" style={{ lineHeight: 1.9 }}>
          ✅ <b>القفل ما بيمسحش أي بيانات.</b> كل سجلات الحضور والفلوس والخصومات
          بتفضل في الداتابيز للأبد.
          <br />✅ <b>لازم كلمة السر</b> عشان تقفل — عشان محدش يقفل بالغلط.
          <br />✅ القفل بيقفل حسابات العمال في المشروع ده بس (ما يسجّلوش فيه تاني).
          <br />✅ بيولّد <b>تسوية نهائية</b> لكل عامل (استحقاق − مسحوب − خصومات).
          <br />✅ المشروع بيتنقل لـ <b>الأرشيف</b> وتقدر تفتحه وتصدّره CSV في أي وقت.
        </p>
      </div>

      {adding && (
        <Modal title="إضافة مشروع" onClose={() => setAdding(false)}>
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
        <Modal title={`⚠️ قفل مشروع ${confirm.name}؟`} onClose={() => setConfirm(null)}>
          <div className="alert error" style={{ lineHeight: 1.9 }}>
            <b>متأكد؟ ده إجراء مهم.</b>
            <br />
            لما تقفل المشروع:
            <br />
            • كل العمال <b>ما يقدروش يسجّلوا</b> حضور أو ياخدوا فلوس في المشروع ده تاني
            <br />
            • هيتم <b>توليد تسوية نهائية</b> لكل عامل
          </div>

          <div className="alert success" style={{ lineHeight: 1.9 }}>
            ✅ <b>البيانات مش هتتمسح خالص.</b>
            <br />
            كل الحضور والفلوس والخصومات هتتحوّل للأرشيف وتفضل متاحة للأبد —
            تقدر تفتح المشروع وتصدّره CSV في أي وقت.
          </div>

          <label className="field">
            <span>🔑 اكتب كلمة السر عشان تأكد القفل</span>
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
              لا، سيب المشروع شغّال
            </button>
            <button
              className="btn btn-danger"
              onClick={() => closeProject(confirm)}
              disabled={busy || !pw.trim()}
            >
              {busy ? "بيتحقق..." : "🔒 تأكيد القفل"}
            </button>
          </div>
        </Modal>
      )}

      {/* ===== صفحة تفاصيل المشروع (شغّال أو مؤرشف) ===== */}
      {detail && <ProjectDetail project={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

type DTab = "workers" | "attendance" | "money" | "ded" | "settle";

function ProjectDetail({ project, onClose }: { project: Project; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<DTab>("workers");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      const { data, error } = await supabase.rpc("export_project_data", {
        p_project_id: project.id,
      });
      if (error) {
        setErr(error.message);
        setLoading(false);
        return;
      }
      setData(data);
      setLoading(false);
    })();
  }, [project.id]);

  const workers: any[] = data?.workers ?? [];
  const attendance: any[] = data?.attendance ?? [];
  const money: any[] = data?.withdrawals ?? [];
  const ded: any[] = data?.deductions ?? [];
  const settle: any[] = data?.settlements ?? [];
  const proj = data?.project ?? {};

  return (
    <Modal title={`📂 ${project.name}`} onClose={onClose}>
      {loading && <p className="center muted">بيحمّل البيانات...</p>}
      {err && <div className="alert error">{err}</div>}

      {!loading && !err && (
        <>
          {/* ===== ملخص ===== */}
          <div className="stat-row wrap mb">
            <div className="stat">
              <span>👷 عمال</span>
              <b>{workers.length}</b>
            </div>
            <div className="stat">
              <span>📅 حضور</span>
              <b>{attendance.length}</b>
            </div>
            <div className="stat">
              <span>💸 فلوس</span>
              <b className="amber">{money.reduce((s, x) => s + (+x.amount || 0), 0)}</b>
            </div>
            <div className="stat">
              <span>➖ خصومات</span>
              <b className="red">{ded.reduce((s, x) => s + (+x.amount || 0), 0)}</b>
            </div>
          </div>

          {proj.closed_at && (
            <div className="alert" style={{ lineHeight: 1.9 }}>
              🔒 المشروع ده <b>مقفول</b> — اتقفل يوم{" "}
              <b>{(proj.closed_at ?? "").slice(0, 10)}</b>
              {proj.archived_at && <> ودخل الأرشيف يوم <b>{proj.archived_at.slice(0, 10)}</b></>}.
              <br />
              البيانات كلها محفوظة ومتاحة للعرض والتصدير.
            </div>
          )}

          {/* ===== تبويبات ===== */}
          <div className="flex wrap mb">
            <button className={`btn btn-sm ${tab === "workers" ? "btn-primary" : ""}`} onClick={() => setTab("workers")}>
              👷 العمال ({workers.length})
            </button>
            <button className={`btn btn-sm ${tab === "attendance" ? "btn-primary" : ""}`} onClick={() => setTab("attendance")}>
              📅 الحضور ({attendance.length})
            </button>
            <button className={`btn btn-sm ${tab === "money" ? "btn-primary" : ""}`} onClick={() => setTab("money")}>
              💸 الفلوس ({money.length})
            </button>
            <button className={`btn btn-sm ${tab === "ded" ? "btn-primary" : ""}`} onClick={() => setTab("ded")}>
              ➖ الخصومات ({ded.length})
            </button>
            <button className={`btn btn-sm ${tab === "settle" ? "btn-primary" : ""}`} onClick={() => setTab("settle")}>
              📋 التسويات ({settle.length})
            </button>
          </div>

          <div className="table-wrap">
            {tab === "workers" && (
              <table>
                <thead>
                  <tr>
                    <th>العامل</th>
                    <th>الموبايل</th>
                    <th>اليومية</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map((w, i) => (
                    <tr key={i}>
                      <td>
                        <b>{w.full_name}</b>
                      </td>
                      <td className="num">{w.phone ?? "—"}</td>
                      <td className="num">{w.project_daily_wage ?? w.daily_wage ?? 0}</td>
                    </tr>
                  ))}
                  {workers.length === 0 && (
                    <tr>
                      <td colSpan={3} className="center muted">مفيش عمال</td>
                    </tr>
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
                    <th>اليومية</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.map((a, i) => (
                    <tr key={i}>
                      <td className="num">{a.work_date}</td>
                      <td>{a.full_name}</td>
                      <td className="num">{a.daily_wage ?? 0}</td>
                    </tr>
                  ))}
                  {attendance.length === 0 && (
                    <tr>
                      <td colSpan={3} className="center muted">مفيش حضور</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {tab === "money" && (
              <table>
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>العامل</th>
                    <th>المبلغ</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {money.map((w, i) => (
                    <tr key={i}>
                      <td className="num small">{(w.created_at ?? "").slice(0, 10)}</td>
                      <td>{w.full_name}</td>
                      <td className="num red">{w.amount}</td>
                      <td>
                        <span className={`badge ${w.status === "approved" ? "green" : "amber"}`}>
                          {w.status === "approved" ? "معتمد" : "معلّق"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {money.length === 0 && (
                    <tr>
                      <td colSpan={4} className="center muted">مفيش فلوس</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {tab === "ded" && (
              <table>
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>العامل</th>
                    <th>المبلغ</th>
                    <th>السبب</th>
                  </tr>
                </thead>
                <tbody>
                  {ded.map((d, i) => (
                    <tr key={i}>
                      <td className="num small">{(d.created_at ?? "").slice(0, 10)}</td>
                      <td>{d.full_name}</td>
                      <td className="num red">{d.amount}</td>
                      <td className="small">{d.reason ?? "—"}</td>
                    </tr>
                  ))}
                  {ded.length === 0 && (
                    <tr>
                      <td colSpan={4} className="center muted">مفيش خصومات</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {tab === "settle" && (
              <table>
                <thead>
                  <tr>
                    <th>العامل</th>
                    <th>أيام</th>
                    <th>استحقاق</th>
                    <th>مسحوب</th>
                    <th>خصومات</th>
                    <th>الصافي</th>
                  </tr>
                </thead>
                <tbody>
                  {settle.map((s, i) => (
                    <tr key={i}>
                      <td>
                        <b>{s.full_name}</b>
                      </td>
                      <td className="num">{s.days_worked}</td>
                      <td className="num">{s.total_earned}</td>
                      <td className="num red">{s.total_withdrawn}</td>
                      <td className="num red">{s.total_deductions}</td>
                      <td className="num green">
                        <b>{s.net_amount}</b>
                      </td>
                    </tr>
                  ))}
                  {settle.length === 0 && (
                    <tr>
                      <td colSpan={6} className="center muted">
                        مفيش تسويات — التسويات بتتولد وقت القفل
                      </td>
                    </tr>
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
  const [desc, setDesc] = useState("");
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return setErr("اكتب اسم المشروع");
    setBusy(true);
    const { error } = await supabase.from("projects").insert({
      name: name.trim(),
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
        <span>اسم المشروع</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
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
