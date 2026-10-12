import { useState } from "react";
import { supabase } from "../lib/supabase";
import { enqueue, isConnectionError } from "../lib/db";
import type { AvailableProject } from "../pages/worker/WorkerLayout";
import { Modal } from "./Modal";

export default function ProjectAddModal({
  attendanceId,
  workerId,
  projects,
  existing,
  onClose,
  onDone,
}: {
  attendanceId: string;
  workerId: string;
  projects: AvailableProject[];
  existing: string[];
  onClose: () => void;
  onDone: (queued: boolean) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function add(projectId: string) {
    setError("");
    setBusyId(projectId);
    const args = { p_attendance_id: attendanceId, p_project_id: projectId };
    let queued = false;
    try {
      if (navigator.onLine) {
        const { error: rpcError } = await supabase.rpc("add_attendance_project", args);
        if (rpcError) {
          if (!isConnectionError(rpcError)) throw rpcError;
          await enqueue("rpc", "insert", { fn: "add_attendance_project", args }, workerId);
          queued = true;
        }
      } else {
        await enqueue("rpc", "insert", { fn: "add_attendance_project", args }, workerId);
        queued = true;
      }
      onDone(queued);
      onClose();
    } catch (caught: any) {
      setError(caught?.message ?? "تعذرت إضافة المشروع للحضور");
    } finally {
      setBusyId(null);
    }
  }

  const available = projects.filter((project) => !existing.includes(project.id));

  return (
    <Modal title="إضافة مشروع لحضور اليوم" onClose={onClose}>
      {error && <div className="alert error" role="alert">{error}</div>}
      <p className="small muted">اختار مشروعًا اشتغلت فيه اليوم. اليومية تُحسب مرة واحدة فقط.</p>
      <div className="flex wrap">
        {available.map((project) => (
          <button
            key={project.id}
            className="btn worker-project-choice"
            aria-label={`إضافة ${project.name} إلى حضور اليوم`}
            disabled={busyId !== null}
            onClick={() => void add(project.id)}
          >
            {busyId === project.id ? "جاري الإضافة..." : `+ ${project.name}`}
          </button>
        ))}
        {available.length === 0 && <span className="muted small">كل مشاريعك النشطة مسجلة بالفعل.</span>}
      </div>
    </Modal>
  );
}
