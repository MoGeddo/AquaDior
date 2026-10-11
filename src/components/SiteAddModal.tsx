import { useState } from "react";
import { supabase } from "../lib/supabase";
import { enqueue } from "../lib/db";
import { Modal } from "./Modal";
import type { Site } from "../lib/types";

/** مودال سريع: العامل راح موقع جديد بعد ما كان في موقع تاني */
export default function SiteAddModal({
  attendanceId,
  sites,
  existing,
  onClose,
  onDone,
}: {
  attendanceId: string;
  sites: Site[];
  existing: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const available = sites.filter((s) => !existing.includes(s.id));

  async function pick(siteId: string) {
    setBusy(true);
    setErr("");
    try {
      if (navigator.onLine) {
        const { error } = await supabase.rpc("add_attendance_site", {
          p_attendance_id: attendanceId,
          p_site_id: siteId,
        });
        if (error) throw new Error(error.message);
      } else {
        await enqueue("rpc", "insert", {
          fn: "add_attendance_site",
          args: { p_attendance_id: attendanceId, p_site_id: siteId },
        });
      }
      onDone();
      onClose();
    } catch (e: any) {
      setErr(e.message ?? "حصل خطأ");
    }
    setBusy(false);
  }

  return (
    <Modal title="📍 رحت موقع تاني" onClose={onClose}>
      {err && <div className="alert error">{err}</div>}
      <p className="small muted mb">
        اختار الموقع اللي روحته النهاردة — اليومية بتتحسب مرة واحدة.
      </p>
      {available.map((s) => (
        <button
          key={s.id}
          className="btn btn-block mb"
          onClick={() => pick(s.id)}
          disabled={busy}
        >
          {s.name}
        </button>
      ))}
      {available.length === 0 && (
        <div className="empty">سجّلت كل المواقع المتاحة خلاص ✓</div>
      )}
    </Modal>
  );
}
