import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { todayStr, fmtDate } from "../../lib/calc";
import type { Profile, Attendance, Project } from "../../lib/types";

interface Row {
  worker: Profile;
  att: Attendance | null;
  projectNames: string[];
}

export default function Attendance() {
  const [date, setDate] = useState(todayStr());
  const [rows, setRows] = useState<Row[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [{ data: workers, error: workersError }, { data: projectRows, error: projectError }] = await Promise.all([
      supabase.from("profiles").select("*").eq("role", "worker").eq("status", "active").eq("is_active", true).order("full_name"),
      supabase.from("projects").select("*").eq("status", "active").order("name"),
    ]);
    if (workersError || projectError) {
      setMsg(`تعذر تحميل البيانات: ${(workersError ?? projectError)?.message ?? "خطأ غير معروف"}`);
      return;
    }
    const allProjects = (projectRows ?? []) as Project[];
    setProjects(allProjects);

    const { data: attendanceRows, error: attendanceError } = await supabase
      .from("attendance")
      .select("*")
      .eq("work_date", date);
    if (attendanceError) {
      setMsg(`تعذر تحميل الحضور: ${attendanceError.message}`);
      return;
    }
    const attendance = (attendanceRows ?? []) as Attendance[];
    const attendanceByWorker = new Map(attendance.map((record) => [record.worker_id, record]));
    const attendanceIds = attendance.map((record) => record.id);
    let linkRows: any[] = [];
    if (attendanceIds.length) {
      const { data: links, error: linkError } = await supabase
        .from("attendance_projects")
        .select("attendance_id, project_id")
        .in("attendance_id", attendanceIds);
      if (linkError) {
        setMsg(`تعذر تحميل مشاريع الحضور: ${linkError.message}`);
        return;
      }
      linkRows = links ?? [];
    }
    const namesByAttendance = new Map<string, string[]>();
    for (const link of linkRows) {
      const name = allProjects.find((project) => project.id === link.project_id)?.name;
      if (!name) continue;
      const names = namesByAttendance.get(link.attendance_id) ?? [];
      names.push(name);
      namesByAttendance.set(link.attendance_id, names);
    }

    let workerRows = (workers ?? []) as Profile[];
    if (projectFilter) {
      const { data: assignments, error: assignmentError } = await supabase
        .from("worker_projects")
        .select("worker_id")
        .eq("project_id", projectFilter);
      if (assignmentError) {
        setMsg(`تعذر تحميل تعيينات المشروع: ${assignmentError.message}`);
        return;
      }
      const ids = new Set((assignments ?? []).map((assignment: any) => assignment.worker_id));
      const attendanceIdToWorker = new Map(attendance.map((record) => [record.id, record.worker_id]));
      for (const link of linkRows) {
        if (link.project_id === projectFilter) {
          const workerId = attendanceIdToWorker.get(link.attendance_id);
          if (workerId) ids.add(workerId);
        }
      }
      workerRows = workerRows.filter((worker) => ids.has(worker.id));
    }

    setRows(workerRows.map((worker) => {
      const att = attendanceByWorker.get(worker.id) ?? null;
      return {
        worker,
        att,
        projectNames: att ? namesByAttendance.get(att.id) ?? [] : [],
      };
    }));
    setMsg("");
  }, [date, projectFilter]);

  useEffect(() => { void load(); }, [load]);

  async function addAttendance(workerId: string) {
    if (!projectFilter) return setMsg("اختار المشروع/الموقع أولًا حتى يرتبط الحضور بمكان العمل.");
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_register_attendance_multi", {
      p_worker_id: workerId,
      p_work_date: date,
      p_project_ids: [projectFilter],
    });
    setBusy(false);
    if (error) return setMsg(`خطأ: ${error.message}`);
    if (!data) return setMsg("لم يرجع الخادم سجل الحضور؛ حدّث القائمة للتحقق.");
    setMsg("تم إضافة الحضور ✅");
    await load();
  }

  async function removeAttendance(id: string) {
    if (!window.confirm("متأكد إنك عايز تحذف الحضور ده؟")) return;
    const { error } = await supabase.from("attendance").delete().eq("id", id);
    if (error) return setMsg(`خطأ: ${error.message}`);
    setMsg("تم الحذف ✅");
    await load();
  }

  const present = rows.filter((row) => row.att).length;

  return (
    <>
      <div className="flex-between mb" style={{ flexWrap: "wrap" }}>
        <div className="flex">
          <label className="field" style={{ margin: 0 }}>
            <span>التاريخ</span>
            <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>المشروع/الموقع</span>
            <select className="input" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
              <option value="">الكل</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        </div>
        <div className="flex">
          <span className="badge green">حاضر: {present}</span>
          <span className="badge red">غايب: {rows.length - present}</span>
        </div>
      </div>

      {msg && <div className={`alert ${msg.startsWith("خطأ") || msg.startsWith("تعذر") ? "error" : "success"}`} role="status">{msg}</div>}

      <div className="card">
        <div className="card-title">{fmtDate(date)}</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>العامل</th><th>الحالة</th><th>المشاريع/المواقع</th><th>سجّل الساعة</th><th>المصدر</th><th></th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.worker.id}>
                  <td><b>{row.worker.full_name}</b><div className="small muted">{row.worker.phone}</div></td>
                  <td>{row.att ? <span className="badge green">✓ نزل</span> : <span className="badge red">غايب</span>}</td>
                  <td className="small muted">{row.projectNames.length ? row.projectNames.join("، ") : "—"}</td>
                  <td className="num small">{row.att ? row.att.created_at?.slice(11, 16) : "—"}</td>
                  <td>{row.att?.source === "admin" ? <span className="badge blue">إدارة</span> : <span className="badge gray">العامل</span>}</td>
                  <td>{row.att ? <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void removeAttendance(row.att!.id)}>🗑</button> : <button className="btn btn-sm" disabled={busy} onClick={() => void addAttendance(row.worker.id)}>+ سجّل</button>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="center muted">مفيش عمال</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
