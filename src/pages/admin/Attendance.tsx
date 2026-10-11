import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { todayStr, fmtDate } from "../../lib/calc";
import type { Profile, Attendance, Project } from "../../lib/types";

interface Row {
  worker: Profile;
  att: Attendance | null;
  siteNames: string[];
}

export default function Attendance() {
  const [date, setDate] = useState(todayStr());
  const [rows, setRows] = useState<Row[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    const [{ data: workers }, { data: sitesData }, { data: projData }] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("role", "worker").order("full_name"),
        supabase.from("sites").select("*"),
        supabase.from("projects").select("*"),
      ]);
    setProjects((projData ?? []) as Project[]);

    const { data: att } = await supabase
      .from("attendance")
      .select("*")
      .eq("work_date", date);
    const attList = (att ?? []) as Attendance[];
    const byWorker = new Map(attList.map((a) => [a.worker_id, a]));

    const { data: as } = await supabase
      .from("attendance_sites")
      .select("attendance_id, site_id");
    const siteMap = new Map<string, string[]>();
    (as ?? []).forEach((r: any) => {
      const arr = siteMap.get(r.attendance_id) ?? [];
      arr.push(r.site_id);
      siteMap.set(r.attendance_id, arr);
    });
    const siteName = (id: string) =>
      sitesData?.find((s: any) => s.id === id)?.name ?? "?";

    let list: Row[] = (workers ?? []).map((w: any) => {
      const a = byWorker.get(w.id) ?? null;
      return {
        worker: w,
        att: a,
        siteNames: a ? (siteMap.get(a.id) ?? []).map(siteName) : [],
      };
    });

    if (projectFilter) {
      const { data: wp } = await supabase
        .from("worker_projects")
        .select("worker_id")
        .eq("project_id", projectFilter);
      const ids = new Set((wp ?? []).map((r: any) => r.worker_id));
      list = list.filter((r) => ids.has(r.worker.id));
    }

    setRows(list);
  }

  useEffect(() => {
    load();
  }, [date, projectFilter]);

  async function addAttendance(workerId: string) {
    setBusy(true);
    const me = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await supabase.from("attendance").insert({
      worker_id: workerId,
      work_date: date,
      source: "admin",
      note: "أضافه الإدارة",
      created_by: me,
    });
    setBusy(false);
    if (error) return setMsg("خطأ: " + error.message);
    setMsg("تم إضافة الحضور ✅");
    await load();
  }

  async function removeAttendance(id: string) {
    if (!confirm("متأكد إنك عايز تحذف الحضور ده؟")) return;
    const { error } = await supabase.from("attendance").delete().eq("id", id);
    if (error) return setMsg("خطأ: " + error.message);
    setMsg("تم الحذف ✅");
    await load();
  }

  const present = rows.filter((r) => r.att).length;

  return (
    <>
      <div className="flex-between mb" style={{ flexWrap: "wrap" }}>
        <div className="flex">
          <label className="field" style={{ margin: 0 }}>
            <span>التاريخ</span>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>المشروع</span>
            <select
              className="input"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
            >
              <option value="">الكل</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex">
          <span className="badge green">حاضر: {present}</span>
          <span className="badge red">غايب: {rows.length - present}</span>
        </div>
      </div>

      {msg && <div className="alert success">{msg}</div>}

      <div className="card">
        <div className="card-title">{fmtDate(date)}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>العامل</th>
                <th>الحالة</th>
                <th>المواقع</th>
                <th>سجّل الساعة</th>
                <th>المصدر</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.worker.id}>
                  <td>
                    <b>{r.worker.full_name}</b>
                    <div className="small muted">{r.worker.phone}</div>
                  </td>
                  <td>
                    {r.att ? (
                      <span className="badge green">✓ نزل</span>
                    ) : (
                      <span className="badge red">غايب</span>
                    )}
                  </td>
                  <td className="small muted">
                    {r.siteNames.length ? r.siteNames.join("، ") : "—"}
                  </td>
                  <td className="num small">
                    {r.att ? r.att.created_at?.slice(11, 16) : "—"}
                  </td>
                  <td>
                    {r.att?.source === "admin" ? (
                      <span className="badge blue">إدارة</span>
                    ) : (
                      <span className="badge gray">العامل</span>
                    )}
                  </td>
                  <td>
                    {r.att ? (
                      <button
                        className="btn btn-sm btn-ghost"
                        disabled={busy}
                        onClick={() => removeAttendance(r.att!.id)}
                      >
                        🗑
                      </button>
                    ) : (
                      <button
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() => addAttendance(r.worker.id)}
                      >
                        + سجّل
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
