import { useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { useAuth } from "../../store/auth";
import MoneyModal from "../../components/MoneyModal";
import AppIcon from "../../components/AppIcon";
import type { WorkerOutletContext } from "./WorkerLayout";

/**
 * الشاشة دي بقت مودال سريع جوه الشاشة الرئيسية،
 * فالصفحة دي بتفتح المودال على طول.
 */
export default function TakeMoney() {
  const { profile } = useAuth();
  const ctx = useOutletContext<WorkerOutletContext>();
  const nav = useNavigate();
  const [open, setOpen] = useState(true);

  return (
    <>
      {open ? (
        <MoneyModal
          workerId={profile!.id}
          balance={ctx?.bal ?? null}
          onClose={() => nav("/worker")}
          onDone={(queued) => {
            if (!queued) ctx?.reload?.();
          }}
        />
      ) : (
        <button className="btn btn-primary btn-block" onClick={() => setOpen(true)}>
          <AppIcon name="banknote" size={19} />
          خدت فلوس
        </button>
      )}
    </>
  );
}
