import { supabase } from "./supabase";
import { db } from "./db";

/**
 * ينفّذ العمليات اللي اتسجّلت أوفلاين أول ما النت يرجع.
 * بيتنادى على app start + كل ما الشبكة ترجع + كل 30 ثانية لو فيه عمليات.
 */
export async function flushQueue(): Promise<number> {
  const ops = await db.queue.orderBy("created_at").toArray();
  if (ops.length === 0) return 0;

  let done = 0;

  for (const op of ops) {
    try {
      // عملية RPC (زي register_attendance / register_withdrawal)
      if (op.table === "rpc") {
        const { error } = await supabase.rpc(op.payload.fn, op.payload.args);
        if (error) throw error;
      } else if (op.op === "insert") {
        const { error } = await supabase.from(op.table).insert(op.payload);
        if (error) throw error;
      } else if (op.op === "update") {
        let q = supabase.from(op.table).update(op.payload);
        for (const [k, v] of Object.entries(op.match ?? {})) q = q.eq(k, v);
        const { error } = await q;
        if (error) throw error;
      } else if (op.op === "delete") {
        let q = supabase.from(op.table).delete();
        for (const [k, v] of Object.entries(op.match ?? {})) q = q.eq(k, v);
        const { error } = await q;
        if (error) throw error;
      }
      if (op.id) await db.queue.delete(op.id);
      done++;
    } catch (e: any) {
      await db.queue.update(op.id!, {
        tries: (op.tries ?? 0) + 1,
        last_error: e?.message ?? String(e),
      });
      // لو العملية فشلت بسبب مشكلة شبكة، وقف وخلي الجدولة الجديدة تجرب
      break;
    }
  }

  return done;
}

export function startSyncLoop() {
  const run = async () => {
    if (navigator.onLine) {
      const n = await flushQueue();
      if (n > 0) {
        window.dispatchEvent(new CustomEvent("queue-flushed", { detail: n }));
      }
    }
  };
  window.addEventListener("online", run);
  window.addEventListener("focus", run);
  setInterval(run, 30000);
  run();
}
