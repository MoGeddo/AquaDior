import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useAuth } from "../../store/auth";
import { supabase } from "../../lib/supabase";
import { enqueue, isConnectionError } from "../../lib/db";
import { money, todayStr, fmtDate } from "../../lib/calc";
import type { Attendance, AttendanceProject } from "../../lib/types";
import type { WorkerOutletContext } from "./WorkerLayout";
import MoneyModal from "../../components/MoneyModal";
import ProjectAddModal from "../../components/ProjectAddModal";
import AppIcon from "../../components/AppIcon";

export default function WorkerHome() {
  const { profile } = useAuth();
  const ctx = useOutletContext<WorkerOutletContext>();
  const reloadWorkerData = ctx.reload;
  const [pickedProjectIds, setPickedProjectIds] = useState<string[]>([]);
  const [today, setToday] = useState<Attendance | null>(null);
  const [todayProjects, setTodayProjects] = useState<AttendanceProject[]>([]);
  const [attendanceQueued, setAttendanceQueued] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "info" | "error"; text: string } | null>(null);
  const [showMoney, setShowMoney] = useState(false);
  const [showProject, setShowProject] = useState(false);
  const loadToday = useCallback(async () => {
    if (!profile) return false;
    const { data, error } = await supabase
      .from("attendance")
      .select("*")
      .eq("worker_id", profile.id)
      .eq("work_date", todayStr())
      .maybeSingle();
    if (error) {
      setMsg({ type: "error", text: `تعذر تحميل حضور اليوم: ${error.message}` });
      return false;
    }
    const record = (data as Attendance | null) ?? null;
    setToday(record);
    if (!record) {
      setTodayProjects([]);
      return false;
    }
    const { data: links, error: linksError } = await supabase
      .from("attendance_projects")
      .select("attendance_id, project_id, project:projects(id, name, status)")
      .eq("attendance_id", record.id);
    if (linksError) {
      setMsg({ type: "error", text: `تعذر تحميل مشاريع حضور اليوم: ${linksError.message}` });
      return true;
    }
    setTodayProjects((links ?? []) as unknown as AttendanceProject[]);
    return true;
  }, [profile]);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  useEffect(() => {
    setPickedProjectIds((current) => {
      const valid = current.filter((id) => ctx.projects.some((project) => project.id === id));
      if (valid.length) return valid;
      return ctx.projects.length === 1 ? [ctx.projects[0].id] : [];
    });
  }, [ctx.projects]);

  useEffect(() => {
    const reloadAfterSync = () => {
      void loadToday().then((found) => {
        if (found) {
          setAttendanceQueued(false);
          reloadWorkerData();
        }
      });
    };
    window.addEventListener("queue-flushed", reloadAfterSync);
    return () => window.removeEventListener("queue-flushed", reloadAfterSync);
  }, [loadToday, reloadWorkerData]);

  async function register() {
    if (!profile) return;
    if (ctx.loading || ctx.loadError) {
      setMsg({ type: "error", text: "بيانات حسابك لم تكتمل؛ أعد المحاولة قبل تسجيل الحضور" });
      return;
    }
    if (ctx.projects.length === 0) {
      setMsg({ type: "error", text: "لا توجد مشاريع مفتوحة حاليًا؛ اطلب من المالك فتح مشروع قبل تسجيل الحضور" });
      return;
    }
    if (pickedProjectIds.length === 0) {
      setMsg({ type: "error", text: "اختار مشروعًا واحدًا على الأقل اشتغلت فيه اليوم" });
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const args = {
        p_worker_id: profile.id,
        p_work_date: todayStr(),
        p_project_ids: pickedProjectIds,
        p_note: null,
      };
      let queued = false;
      if (navigator.onLine) {
        const { error } = await supabase.rpc("register_attendance_multi", args);
        if (error) {
          if (!isConnectionError(error)) throw new Error(error.message);
          await enqueue("rpc", "insert", { fn: "register_attendance_multi", args }, profile.id);
          queued = true;
        }
      } else {
        await enqueue("rpc", "insert", { fn: "register_attendance_multi", args }, profile.id);
        queued = true;
      }
      if (queued) {
        setAttendanceQueued(true);
        setTodayProjects(ctx.projects
          .filter((project) => pickedProjectIds.includes(project.id))
          .map((project) => ({ attendance_id: "queued", project_id: project.id, project: { id: project.id, name: project.name, status: project.status } })));
        setMsg({ type: "info", text: "الحضور محفوظ على الجهاز وبانتظار تحقق الخادم عند عودة الاتصال" });
      } else {
        setMsg({ type: "success", text: "اتسجّل حضورك النهاردة" });
        await loadToday();
        ctx.reload();
      }
    } catch (error: any) {
      setMsg({ type: "error", text: error?.message ?? "حصل خطأ أثناء تسجيل الحضور" });
    } finally {
      setBusy(false);
    }
  }

  const balance = ctx.bal;
  const done = Boolean(today) || attendanceQueued;
  const existingProjectIds = todayProjects.map((record) => record.project_id);

  return (
    <>
      {msg && <div className={`alert ${msg.type}`} role="status">{msg.text}</div>}

      <div className="card worker-attendance-card">
        <div className="card-title">
          <span>{fmtDate(todayStr())}</span>
          {attendanceQueued && !today ? <span className="badge amber">بانتظار المزامنة</span> : done ? <span className="badge green icon-label"><AppIcon name="circleCheck" size={15} />نزلت</span> : <span className="badge amber">لسه مسجّلتش</span>}
        </div>

        {!done ? (
          <>
            <div className="card-title" style={{ marginTop: 2 }}>
              <span>اشتغلت في أنهي مشاريع/مواقع النهاردة؟</span>
              <span className="small muted">اختار كل المشاريع؛ اليومية تُحسب مرة واحدة</span>
            </div>
            {ctx.projects.length > 0 ? (
              <div className="flex wrap worker-project-choices">
                {ctx.projects.map((project) => {
                  const selected = pickedProjectIds.includes(project.id);
                  return (
                    <button
                      key={project.id}
                      type="button"
                      className={`btn worker-project-choice ${selected ? "btn-primary" : ""}`}
                      aria-pressed={selected}
                      disabled={busy || ctx.loading || Boolean(ctx.loadError)}
                      onClick={() => setPickedProjectIds((current) => selected ? current.filter((id) => id !== project.id) : [...current, project.id])}
                    >
                      {selected && <AppIcon name="circleCheck" size={16} />}
                      {project.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="alert info">
                لا توجد مشاريع مفتوحة حاليًا. اطلب من المالك فتح المشروع المطلوب، ثم اختره هنا عند تسجيل الحضور.
              </div>
            )}
            <div className="mt">
              <button
                className="btn-hero primary"
                onClick={() => void register()}
                disabled={busy || ctx.loading || Boolean(ctx.loadError) || ctx.projects.length === 0 || pickedProjectIds.length === 0}
              >
                <span className="btn-hero-label">
                  {!busy && <AppIcon name="calendarCheck" size={22} />}
                  {busy ? "جاري تسجيل الحضور…" : ctx.projects.length === 0 ? "لا توجد مشاريع مفتوحة" : "نزلت النهاردة"}
                </span>
                <small>{busy ? "انتظر لحظات ولا تضغط مرة ثانية" : pickedProjectIds.length ? `في ${pickedProjectIds.length} مشروع` : "اختار مشروعًا أو أكثر"}</small>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="card-title" style={{ marginTop: 2 }}>
              <span>المشاريع المسجلة لحضور اليوم</span>
              {today && <button className="btn btn-sm worker-project-choice" onClick={() => setShowProject(true)}>+ مشروع</button>}
            </div>
            <div className="flex wrap worker-project-choices">
              {todayProjects.length === 0 ? <span className="muted small">لم يُربط حضورك بمشروع؛ اليومية احتُسبت مرة واحدة.</span> : todayProjects.map((record) => (
                <span key={record.project_id} className="site-pill">
                  <AppIcon name="mapPin" size={16} />
                  <span>{record.project?.name ?? "مشروع"}</span>
                </span>
              ))}
            </div>
            <div className="mt">
              <button className="btn-hero money" onClick={() => setShowMoney(true)}>
                <span className="btn-hero-label">
                  <AppIcon name="banknote" size={22} />
                  خدت فلوس
                </span>
                <small>يتخصم من رصيدك العام</small>
              </button>
            </div>
            {(balance?.withdrawn_pending ?? 0) > 0 && <div className="alert info mt">عندك {money(balance?.withdrawn_pending ?? 0)} مستنية موافقة المالك</div>}
          </>
        )}
      </div>

      <div className="card" style={{ background: "linear-gradient(160deg, #0f766e, #134e4a)", border: "none", color: "#fff", boxShadow: "0 10px 28px rgba(15,118,110,0.28)" }}>
        <div style={{ fontSize: 12.5, opacity: 0.85, fontWeight: 700 }}>متاح تاخد دلوقتي — من رصيدك العام</div>
        <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-1px", lineHeight: 1.2, margin: "2px 0" }}>
          {money(balance?.available ?? 0)}
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.85 }}>رصيدك بعد كل حاجة: <b>{money(balance?.balance ?? 0)}</b></div>
      </div>

      <div className="stats">
        <div className="stat"><div className="label">أيام الشغل</div><div className="value teal">{balance?.days_worked ?? 0}</div></div>
        <div className="stat"><div className="label">استحقاقك</div><div className="value">{money(balance?.earned ?? 0)}</div></div>
        <div className="stat"><div className="label">خدت</div><div className="value amber">{money((balance?.withdrawn_approved ?? 0) + (balance?.withdrawn_pending ?? 0))}</div></div>
        <div className="stat"><div className="label">يوميتك الثابتة</div><div className="value blue">{money(balance?.daily_wage ?? 0)}</div></div>
      </div>

      {showMoney && profile && <MoneyModal workerId={profile.id} balance={balance} onClose={() => setShowMoney(false)} onDone={(queued) => {
        if (!queued) ctx.reload();
        setMsg({ type: queued ? "info" : "success", text: queued ? "طلب الصرف محفوظ محليًا وبانتظار المزامنة" : "اتسجّل" });
      }} />}

      {showProject && today && profile && <ProjectAddModal attendanceId={today.id} workerId={profile.id} projects={ctx.projects} existing={existingProjectIds} onClose={() => setShowProject(false)} onDone={(queued) => {
        if (!queued) { void loadToday(); ctx.reload(); }
        setMsg({ type: queued ? "info" : "success", text: queued ? "المشروع محفوظ محليًا وبانتظار المزامنة" : "تم إضافة المشروع للحضور" });
      }} />}
    </>
  );
}
