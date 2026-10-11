import { useState } from "react";
import { supabase } from "../lib/supabase";
import { enqueue } from "../lib/db";
import { money } from "../lib/calc";
import { Modal } from "./Modal";
import type { WorkerBalance } from "../lib/types";

/**
 * مودال سريع: العامل خد فلوس.
 * بيستعمل من الشاشة الرئيسية (ضغطة واحدة) ومش شاشة تانية.
 */
export default function MoneyModal({
  workerId,
  balance,
  onClose,
  onDone,
}: {
  workerId: string;
  balance: WorkerBalance | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const avail = balance?.available ?? 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setOk("");
    const val = Number(amount);
    if (!val || val <= 0) return setErr("اكتب مبلغ أكبر من صفر");
    if (val > avail)
      return setErr(`متاح تاخد ${money(avail)} بس — مش هتاخد أكتر من اللي اشتغلته`);

    setBusy(true);
    try {
      if (navigator.onLine) {
        const { error } = await supabase.rpc("register_withdrawal", {
          p_worker_id: workerId,
          p_amount: val,
          p_note: note || null,
        });
        if (error) throw new Error(error.message);
      } else {
        await enqueue("rpc", "insert", {
          fn: "register_withdrawal",
          args: { p_worker_id: workerId, p_amount: val, p_note: note || null },
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
    <Modal title="💵 خدت فلوس" onClose={onClose}>
      {err && <div className="alert error">{err}</div>}
      {ok && <div className="alert success">{ok}</div>}

      <div className="center mb">
        <div className="small muted">متاح تاخد دلوقتي</div>
        <div style={{ fontSize: 30, fontWeight: 800, color: "var(--success)" }}>
          {money(avail)}
        </div>
      </div>

      <form onSubmit={submit}>
        <input
          className="input input-big"
          inputMode="decimal"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          autoFocus
        />

        <div className="flex" style={{ flexWrap: "wrap", gap: 8, margin: "12px 0" }}>
          {[100, 200, 500, 1000].map((v) => (
            <button
              key={v}
              type="button"
              className="btn btn-sm"
              onClick={() => setAmount(String(v))}
            >
              +{v}
            </button>
          ))}
          {avail > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setAmount(String(Math.floor(avail)))}
            >
              الكل
            </button>
          )}
        </div>

        <input
          className="input mb"
          placeholder="ملاحظة (اختياري)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "جاري التسجيل..." : "تم"}
        </button>
      </form>
    </Modal>
  );
}
