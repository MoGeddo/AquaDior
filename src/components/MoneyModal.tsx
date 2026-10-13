import { useState } from "react";
import { supabase } from "../lib/supabase";
import { enqueue, isConnectionError } from "../lib/db";
import { money } from "../lib/calc";
import { arabicError } from "../lib/errors";
import { Modal } from "./Modal";
import type { WorkerBalance } from "../lib/types";
import AppIcon from "./AppIcon";

function newRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (bytes.every((byte) => byte === 0)) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map((byte, index) =>
    `${index === 4 || index === 6 || index === 8 || index === 10 ? "-" : ""}${byte.toString(16).padStart(2, "0")}`
  ).join("");
}

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
  onDone: (queued?: boolean) => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [requestId] = useState(newRequestId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const avail = balance?.available ?? 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setOk("");
    const val = Number(amount);
    if (!Number.isFinite(val) || val <= 0) return setErr("اكتب مبلغ أكبر من صفر");
    if (val > avail)
      return setErr(`متاح تاخد ${money(avail)} بس — مش هتاخد أكتر من اللي اشتغلته`);

    setBusy(true);
    let queued = false;
    const args = {
      p_worker_id: workerId,
      p_amount: val,
      p_note: note || null,
      p_project_id: null,
      p_request_id: requestId,
    };
    try {
      if (navigator.onLine) {
        const { error } = await supabase.rpc("register_withdrawal", args);
        if (error) {
          if (!isConnectionError(error)) throw error;
          await enqueue("rpc", "insert", { fn: "register_withdrawal", args }, workerId);
          queued = true;
        }
      } else {
        await enqueue("rpc", "insert", { fn: "register_withdrawal", args }, workerId);
        queued = true;
      }
      onDone(queued);
      onClose();
    } catch (e: any) {
      setErr(arabicError(e, "تعذر تسجيل طلب الصرف."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={<span className="icon-label"><AppIcon name="banknote" size={19} /><span>خدت فلوس</span></span>}
      onClose={onClose}
    >
      {err && <div className="alert error">{err}</div>}
      {ok && <div className="alert success">{ok}</div>}

      <div className="alert info" role="note">
        كل طلب يذهب للمالك للموافقة. المبلغ المعلّق محجوز من المتاح فقط لمنع تجاوز الرصيد، ولا يُسجَّل خصمًا فعليًا إلا بعد الموافقة؛ وإذا رُفض الطلب يعود متاحًا.
      </div>

      <div className="center mb">
        <div className="small muted">المتاح للتقديم بعد الطلبات المعلّقة</div>
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
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "جاري إرسال الطلب…" : "إرسال طلب للمالك"}
        </button>
      </form>
    </Modal>
  );
}
