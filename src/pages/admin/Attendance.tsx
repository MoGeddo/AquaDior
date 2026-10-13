import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { fmtDate, fmtDateOnly, fmtTime, money, todayStr } from "../../lib/calc";
import { arabicError } from "../../lib/errors";
import type { Profile, Attendance, Project } from "../../lib/types";
import { useDialog } from "../../components/DialogProvider";
import AppIcon from "../../components/AppIcon";

type ViewMode = "all" | "day" | "month" | "range";

interface AttendanceRecord extends Attendance {
  projectIds: string[];
  projectNames: string[];
}

interface DailyRow {
  worker: Profile;
  att: AttendanceRecord | null;
}

interface PeriodRow {
  worker: Profile;
  days: number;
  earned: number;
  projects: string[];
}

const PAGE_SIZE = 1000;
const LINK_PAGE_SIZE = 500;

function monthBounds(month: string): { from: string; to: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    const today = todayStr();
    return { from: `${today.slice(0, 7)}-01`, to: today };
  }
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) {
    const today = todayStr();
    return { from: `${today.slice(0, 7)}-01`, to: today };
  }
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, "0")}`,
  };
}

async function fetchWorkers(includeHistorical: boolean): Promise<Profile[]> {
  const workers: Profile[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from("profiles")
      .select("*")
      .eq("role", "worker")
      .order("full_name", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (!includeHistorical) query = query.eq("status", "active").eq("is_active", true);
    const { data, error } = await query;
    if (error) throw new Error(`تعذر تحميل العمال: ${arabicError(error, "حاول مرة أخرى.")}`);
    const page = (data ?? []) as Profile[];
    workers.push(...page);
    if (page.length < PAGE_SIZE) return workers;
  }
}

async function fetchAttendance(from?: string, to?: string): Promise<Attendance[]> {
  const records: Attendance[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from("attendance")
      .select("*")
      .order("work_date", { ascending: true })
      .order("id", { ascending: true });
    if (from) query = query.gte("work_date", from);
    if (to) query = query.lte("work_date", to);
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`تعذر تحميل الحضور: ${arabicError(error, "حاول مرة أخرى.")}`);
    const page = (data ?? []) as Attendance[];
    records.push(...page);
    if (page.length < PAGE_SIZE) return records;
  }
}

async function fetchAttendanceProjectLinks(attendanceIds: string[]): Promise<any[]> {
  const uniqueIds = [...new Set(attendanceIds)];
  const chunks: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += LINK_PAGE_SIZE) {
    chunks.push(uniqueIds.slice(index, index + LINK_PAGE_SIZE));
  }
  const pages = await Promise.all(chunks.map(async (chunk) => {
    const links: any[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("attendance_projects")
        .select("attendance_id, project_id")
        .in("attendance_id", chunk)
        .order("attendance_id", { ascending: true })
        .order("project_id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`تعذر تحميل مشاريع الحضور: ${arabicError(error, "حاول مرة أخرى.")}`);
      const page = data ?? [];
      links.push(...page);
      if (page.length < PAGE_SIZE) return links;
    }
  }));
  return pages.flat();
}

export default function Attendance() {
  const { confirm } = useDialog();
  const today = todayStr();
  const [mode, setMode] = useState<ViewMode>("day");
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [fromDate, setFromDate] = useState(`${today.slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(today);
  const [reportProjectId, setReportProjectId] = useState("");
  const [entryProjectId, setEntryProjectId] = useState("");
  const [workers, setWorkers] = useState<Profile[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const period = useMemo(() => {
    if (mode === "all") return { from: "", to: "" };
    if (mode === "day") return { from: date, to: date };
    if (mode === "month") return monthBounds(month);
    return { from: fromDate, to: toDate };
  }, [date, fromDate, mode, month, toDate]);
  const invalidRange = mode === "range" && (!period.from || !period.to || period.from > period.to);

  const load = useCallback(async () => {
    if (invalidRange) {
      setWorkers([]);
      setRecords([]);
      setMsg("تاريخ البداية يجب أن يكون قبل تاريخ النهاية أو مساويًا له.");
      return;
    }
    setLoading(true);
    setMsg("");
    try {
      const [workerRows, { data: projectRows, error: projectError }, attendanceRows] = await Promise.all([
        fetchWorkers(true),
        supabase.from("projects").select("*").order("name", { ascending: true }),
        fetchAttendance(period.from || undefined, period.to || undefined),
      ]);
      if (projectError) throw new Error(`تعذر تحميل المشاريع: ${arabicError(projectError, "حاول مرة أخرى.")}`);
      const allProjects = (projectRows ?? []) as Project[];
      const projectById = new Map(allProjects.map((project) => [project.id, project]));
      const projectIdsByAttendance = new Map<string, Set<string>>();

      // project_id is retained as a fallback for older attendance rows. The
      // many-to-many links are the source of truth for current multi-project days.
      for (const attendance of attendanceRows) {
        if (!attendance.project_id) continue;
        const ids = projectIdsByAttendance.get(attendance.id) ?? new Set<string>();
        ids.add(attendance.project_id);
        projectIdsByAttendance.set(attendance.id, ids);
      }
      const links = await fetchAttendanceProjectLinks(attendanceRows.map((record) => record.id));
      for (const link of links) {
        const ids = projectIdsByAttendance.get(link.attendance_id) ?? new Set<string>();
        ids.add(link.project_id);
        projectIdsByAttendance.set(link.attendance_id, ids);
      }

      const recordsWithProjects: AttendanceRecord[] = attendanceRows.map((attendance) => {
        const projectIds = [...(projectIdsByAttendance.get(attendance.id) ?? new Set<string>())];
        const projectNames = projectIds
          .map((projectId) => projectById.get(projectId)?.name)
          .filter((name): name is string => Boolean(name));
        return { ...attendance, projectIds, projectNames };
      });

      const attendanceWorkerIds = new Set(recordsWithProjects.map((record) => record.worker_id));
      const workersForView = mode === "day"
        ? workerRows.filter((worker) =>
          (worker.status === "active" && worker.is_active)
          || attendanceWorkerIds.has(worker.id)
        )
        : workerRows;
      setWorkers(workersForView);
      setProjects(allProjects);
      setRecords(recordsWithProjects);
    } catch (error: any) {
      setWorkers([]);
      setRecords([]);
      setMsg(arabicError(error, "تعذر تحميل بيانات الحضور."));
    } finally {
      setLoading(false);
    }
  }, [invalidRange, mode, period.from, period.to]);

  useEffect(() => { void load(); }, [load]);

  const uniqueDayRecords = useMemo(() => {
    const byWorkerAndDate = new Map<string, AttendanceRecord>();
    for (const record of records) {
      const key = `${record.worker_id}\u0000${record.work_date}`;
      const existing = byWorkerAndDate.get(key);
      if (!existing) {
        byWorkerAndDate.set(key, record);
        continue;
      }
      byWorkerAndDate.set(key, {
        ...existing,
        daily_wage_snapshot: existing.daily_wage_snapshot ?? record.daily_wage_snapshot,
        projectIds: [...new Set([...existing.projectIds, ...record.projectIds])],
        projectNames: [...new Set([...existing.projectNames, ...record.projectNames])],
      });
    }
    return [...byWorkerAndDate.values()];
  }, [records]);

  const dailyRows = useMemo<DailyRow[]>(() => {
    const attendanceByWorker = new Map(uniqueDayRecords.map((record) => [record.worker_id, record]));
    return workers.map((worker) => ({
      worker,
      att: attendanceByWorker.get(worker.id) ?? null,
    }));
  }, [uniqueDayRecords, workers]);

  const periodRows = useMemo<PeriodRow[]>(() => {
    const grouped = new Map<string, { recordsByDate: Map<string, AttendanceRecord>; projects: Set<string> }>();
    const workerById = new Map(workers.map((worker) => [worker.id, worker]));
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const matchingRecords = records.filter((record) =>
      !reportProjectId || record.projectIds.includes(reportProjectId)
    );

    for (const record of matchingRecords) {
      const worker = workerById.get(record.worker_id);
      if (!worker) continue;
      const group = grouped.get(record.worker_id) ?? { recordsByDate: new Map(), projects: new Set<string>() };
      // One attendance row is one worker-day, even when several project links exist.
      if (!group.recordsByDate.has(record.work_date)) group.recordsByDate.set(record.work_date, record);
      record.projectIds.forEach((projectId) => {
        if (reportProjectId && projectId !== reportProjectId) return;
        const projectName = projectById.get(projectId)?.name;
        if (projectName) group.projects.add(projectName);
      });
      grouped.set(record.worker_id, group);
    }

    return [...grouped.entries()]
      .map(([workerId, group]) => {
        const worker = workerById.get(workerId)!;
        const uniqueDays = [...group.recordsByDate.values()];
        const earned = uniqueDays.reduce(
          (sum, record) => sum + Number(record.daily_wage_snapshot ?? worker.daily_wage ?? 0),
          0
        );
        return { worker, days: uniqueDays.length, earned, projects: [...group.projects].sort((a, b) => a.localeCompare(b, "ar")) };
      })
      .sort((a, b) => a.worker.full_name.localeCompare(b.worker.full_name, "ar"));
  }, [projects, records, reportProjectId, workers]);

  const selectedProject = projects.find((project) => project.id === reportProjectId);
  const activeProjects = projects.filter((project) => project.status === "active");
  const matchingDayRecords = uniqueDayRecords.filter((record) =>
    !reportProjectId || record.projectIds.includes(reportProjectId)
  );
  const dayPresent = dailyRows.filter((row) => row.att).length;
  const dayPresentForProject = dailyRows.filter((row) => row.att?.projectIds.includes(reportProjectId)).length;
  const dayPresentElsewhere = reportProjectId
    ? dailyRows.filter((row) => row.att && !row.att.projectIds.includes(reportProjectId)).length
    : 0;
  const dailyWorkerById = new Map(workers.map((worker) => [worker.id, worker]));
  const dayEarned = matchingDayRecords.reduce((sum, record) => {
    const worker = dailyWorkerById.get(record.worker_id);
    return sum + Number(record.daily_wage_snapshot ?? worker?.daily_wage ?? 0);
  }, 0);
  const periodAttendanceDays = periodRows.reduce((sum, row) => sum + row.days, 0);
  const periodEarned = periodRows.reduce((sum, row) => sum + row.earned, 0);
  const periodTitle = mode === "all"
    ? "ملخص كل سجلات الحضور"
    : mode === "month"
      ? `ملخص شهر ${new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric", timeZone: "Africa/Cairo" }).format(new Date(`${period.from}T12:00:00Z`))}`
      : `ملخص الفترة من ${fmtDateOnly(period.from)} إلى ${fmtDateOnly(period.to)}`;

  async function addAttendance(workerId: string) {
    if (!entryProjectId) {
      setMsg("اختار مشروع التسجيل أولًا؛ الحضور اليومي الواحد يقدر يرتبط بأكثر من مشروع.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const { data, error } = await supabase.rpc("admin_register_attendance_multi", {
        p_worker_id: workerId,
        p_work_date: date,
        p_project_ids: [entryProjectId],
      });
      if (error) throw error;
      if (!data) throw new Error("لم يرجع الخادم سجل الحضور؛ حدّث القائمة للتحقق.");
      setMsg("تم تسجيل/تحديث حضور اليوم وربطه بالمشروع مرة واحدة.");
      await load();
    } catch (error: any) {
      setMsg(`خطأ: ${arabicError(error, "تعذر تسجيل الحضور.")}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeAttendance(row: DailyRow) {
    if (!row.att) return;
    const accepted = await confirm({
      title: "حذف سجل الحضور؟",
      message: `سيُحذف سجل حضور «${row.worker.full_name}» بتاريخ ${fmtDateOnly(date)} من اليوم كله، بما في ذلك ارتباطاته بكل المشاريع. لا يمكن التراجع عن هذا الإجراء.`,
      confirmText: "حذف سجل اليوم",
      cancelText: "إلغاء",
      tone: "danger",
    });
    if (!accepted) return;
    setBusy(true);
    const { error } = await supabase.from("attendance").delete().eq("id", row.att.id);
    setBusy(false);
    if (error) return setMsg(`خطأ: ${arabicError(error, "تعذر حذف سجل الحضور.")}`);
    setMsg("تم حذف سجل اليوم.");
    await load();
  }

  return (
    <>
      <div className="card mb">
        <div className="flex wrap attendance-mode-tabs" role="group" aria-label="طريقة عرض الحضور">
          {([
            ["all", "الكل"],
            ["day", "اليوم المحدد"],
            ["month", "الشهر"],
            ["range", "فترة مخصصة"],
          ] as [ViewMode, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`btn btn-sm ${mode === value ? "btn-primary" : ""}`}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex wrap attendance-filters mt">
          {mode === "all" ? (
            <div className="field" style={{ margin: 0 }}>
              <span>نطاق التقرير</span>
              <div className="input" aria-label="مدى سجلات الحضور">من أول سجل حضور حتى الآن</div>
            </div>
          ) : mode === "day" ? (
            <label className="field" style={{ margin: 0 }}>
              <span>التاريخ</span>
              <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
          ) : mode === "month" ? (
            <label className="field" style={{ margin: 0 }}>
              <span>الشهر</span>
              <input className="input" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
            </label>
          ) : (
            <>
              <label className="field" style={{ margin: 0 }}>
                <span>من تاريخ</span>
                <input className="input" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span>إلى تاريخ</span>
                <input className="input" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
              </label>
            </>
          )}
          <label className="field" style={{ margin: 0 }}>
            <span>تصفية حسب المشروع/الموقع</span>
            <select
              className="input"
              aria-label="فلترة الحضور حسب المشروع"
              value={reportProjectId}
              onChange={(event) => setReportProjectId(event.target.value)}
            >
              <option value="">كل المشاريع/المواقع</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}{project.status === "closed" ? " (مغلق)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {msg && <div className={`alert ${msg.startsWith("خطأ") || msg.startsWith("تعذر") || invalidRange ? "error" : "success"}`} role="status">{msg}</div>}
      {loading && <div className="empty" role="status">جاري تحميل سجلات الحضور…</div>}

      {mode === "day" ? (
        <>
          {reportProjectId ? (
            <div className="flex wrap mb">
              <span className="badge green">مسجل على المشروع: {dayPresentForProject}</span>
              <span className="badge blue">حاضر بمشروع آخر: {dayPresentElsewhere}</span>
              <span className="badge">الاستحقاق المسجل: {money(dayEarned)}</span>
            </div>
          ) : (
            <div className="flex wrap mb">
              <span className="badge green">حاضر: {dayPresent}</span>
              <span className="badge red">لا يوجد حضور مسجل: {Math.max(0, workers.length - dayPresent)}</span>
              <span className="badge">استحقاق اليوم: {money(dayEarned)}</span>
            </div>
          )}

          <div className="card mb">
            <div className="flex-between wrap">
              <div>
                <div className="card-title">{fmtDate(date)}</div>
                {reportProjectId && <div className="small muted">اختيار مشروع في الفلتر لا يعني أن العامل مكلّف به؛ لذلك لا نعتبر عدم التسجيل عليه غيابًا.</div>}
              </div>
              <label className="field" style={{ margin: 0 }}>
                <span>المشروع عند تسجيل الحضور</span>
                <select
                  className="input"
                  aria-label="المشروع المراد ربط الحضور به"
                  value={entryProjectId}
                  onChange={(event) => setEntryProjectId(event.target.value)}
                >
                  <option value="">اختار مشروعًا نشطًا</option>
                  {activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
            </div>
            <div className="table-wrap" role="region" aria-label="جدول حضور العمال" tabIndex={0}>
              <table>
                <thead><tr><th>العامل</th><th>الحالة</th><th>المشاريع/المواقع</th><th>استحقاق اليوم</th><th>سجّل الساعة</th><th>المصدر</th><th></th></tr></thead>
                <tbody>
                  {dailyRows.map((row) => {
                    const matchesReportProject = !reportProjectId || Boolean(row.att?.projectIds.includes(reportProjectId));
                    const linkedToEntryProject = Boolean(entryProjectId && row.att?.projectIds.includes(entryProjectId));
                    return (
                      <tr key={row.worker.id}>
                        <td><b>{row.worker.full_name}</b><div className="small muted">{row.worker.phone}</div></td>
                        <td>
                          {row.att ? (
                            matchesReportProject
                              ? <span className="badge green icon-label"><AppIcon name="circleCheck" size={15} />حاضر</span>
                              : <span className="badge blue">حاضر بمشروع آخر</span>
                          ) : reportProjectId ? (
                            <span className="badge gray">لا يوجد تسجيل على المشروع</span>
                          ) : <span className="badge red">لا يوجد حضور مسجل</span>}
                        </td>
                        <td className="small muted">{row.att?.projectNames.length ? row.att.projectNames.join("، ") : "—"}</td>
                        <td className="num">{row.att ? money(row.att.daily_wage_snapshot ?? row.worker.daily_wage) : "—"}</td>
                        <td className="num small">{row.att ? fmtTime(row.att.created_at) : "—"}</td>
                        <td>{row.att?.source === "admin" ? <span className="badge blue">إدارة</span> : row.att ? <span className="badge gray">العامل</span> : "—"}</td>
                        <td>
                          {row.att ? (
                            <div className="flex wrap">
                              {entryProjectId && !linkedToEntryProject && (
                                <button
                                  className="btn btn-sm"
                                  disabled={busy}
                                  onClick={() => void addAttendance(row.worker.id)}
                                  aria-label={`إضافة حضور ${row.worker.full_name} إلى المشروع المختار`}
                                >
                                  <AppIcon name="mapPin" size={16} />
                                  أضف للمشروع
                                </button>
                              )}
                              <button
                                className="btn btn-sm btn-ghost"
                                disabled={busy}
                                onClick={() => void removeAttendance(row)}
                                aria-label={`حذف سجل حضور ${row.worker.full_name}`}
                                title="حذف سجل اليوم من كل المشاريع"
                              >
                                <AppIcon name="trash2" size={17} />
                              </button>
                            </div>
                          ) : (
                            <button
                              className="btn btn-sm"
                              disabled={busy || !entryProjectId}
                              onClick={() => void addAttendance(row.worker.id)}
                              aria-label={`تسجيل حضور ${row.worker.full_name}`}
                              title={!entryProjectId ? "اختار مشروع التسجيل أولًا" : "تسجيل الحضور"}
                            >
                              <AppIcon name="calendarCheck" size={16} />
                              سجّل
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {dailyRows.length === 0 && <tr><td colSpan={7} className="center muted">لا يوجد عمال نشطون</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="alert info" role="note">
            نحتسب صف الحضور اليومي مرة واحدة لكل عامل، حتى لو ارتبط اليوم بأكثر من مشروع. التقرير يعرض الأيام المسجلة فقط؛ لا نستنتج أيام الغياب من غير تحديد جدول أيام العمل.
          </div>
          <div className="stats">
            <div className="stat"><div className="label">عمال لهم حضور</div><div className="value teal">{periodRows.length}</div></div>
            <div className="stat"><div className="label">أيام حضور مسجلة</div><div className="value blue">{periodAttendanceDays}</div></div>
            <div className="stat"><div className="label">إجمالي الاستحقاق المسجل</div><div className="value green">{money(periodEarned)}</div></div>
            <div className="stat"><div className="label">متوسط اليومية المسجلة</div><div className="value">{money(periodAttendanceDays ? periodEarned / periodAttendanceDays : 0)}</div></div>
          </div>

          <div className="card">
            <div className="card-title">{periodTitle}{selectedProject ? ` — ${selectedProject.name}` : " — كل المشاريع/المواقع"}</div>
            <div className="table-wrap" role="region" aria-label="ملخص الحضور حسب العامل" tabIndex={0}>
              <table>
                <thead><tr><th>العامل</th><th>أيام الحضور</th><th>إجمالي الاستحقاق</th><th>المشاريع/المواقع المسجل بها</th></tr></thead>
                <tbody>
                  {periodRows.map((row) => (
                    <tr key={row.worker.id}>
                      <td><b>{row.worker.full_name}</b><div className="small muted">{row.worker.phone}</div>{!row.worker.is_active && <span className="badge gray">موقوف حاليًا</span>}</td>
                      <td className="num">{row.days}</td>
                      <td className="num"><b>{money(row.earned)}</b></td>
                      <td className="small muted">{row.projects.length ? row.projects.join("، ") : "—"}</td>
                    </tr>
                  ))}
                  {periodRows.length === 0 && <tr><td colSpan={4} className="center muted">لا توجد سجلات حضور في هذه الفترة أو للمشروع المختار.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
