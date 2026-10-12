import { supabase } from "./supabase";
import { db } from "./db";

const ALLOWED_QUEUE_RPCS = new Set([
  "register_attendance_multi",
  "register_withdrawal",
  "add_attendance_project",
]);

let flushPromise: Promise<number> | null = null;
let loopStarted = false;
let loopTimer: number | null = null;
let loopHandler: (() => void) | null = null;

/** Replay only for the same authenticated account that created the operation. */
export async function flushQueue(): Promise<number> {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    const { data: auth, error: authError } = await supabase.auth.getSession();
    const sessionUserId = auth.session?.user?.id;
    if (authError || !sessionUserId) return 0;

    const ops = await db.queue.orderBy("created_at").toArray();
    if (ops.length === 0) return 0;
    let done = 0;

    for (const op of ops) {
      // Upgrade an old queued RPC only if its payload explicitly names this user.
      const legacyOwner = op.payload?.args?.p_worker_id;
      if (!op.owner_id && legacyOwner === sessionUserId && op.id) {
        await db.queue.update(op.id, { owner_id: sessionUserId });
        op.owner_id = sessionUserId;
      }
      if (op.owner_id !== sessionUserId || op.blocked) continue;

      try {
        if (op.table === "rpc") {
          const fn = op.payload?.fn;
          if (!ALLOWED_QUEUE_RPCS.has(fn)) {
            throw new Error("عملية مزامنة غير معروفة — لم يتم تنفيذها");
          }
          const { error } = await supabase.rpc(fn, op.payload.args);
          if (error) throw error;
        } else if (op.op === "insert") {
          const { error } = await supabase.from(op.table).insert(op.payload);
          if (error) throw error;
        } else if (op.op === "update") {
          let query = supabase.from(op.table).update(op.payload);
          for (const [key, value] of Object.entries(op.match ?? {})) query = query.eq(key, value);
          const { error } = await query;
          if (error) throw error;
        } else if (op.op === "delete") {
          let query = supabase.from(op.table).delete();
          for (const [key, value] of Object.entries(op.match ?? {})) query = query.eq(key, value);
          const { error } = await query;
          if (error) throw error;
        } else {
          throw new Error("نوع عملية المزامنة غير معروف — لم يتم تنفيذها");
        }

        if (op.id) await db.queue.delete(op.id);
        done++;
      } catch (error: any) {
        const status = Number(error?.status ?? 0);
        const message = String(error?.message ?? error ?? "Sync failed").slice(0, 500);
        const retryable = !navigator.onLine || status === 429 || status >= 500 ||
          /network|fetch|timeout|offline|temporar|service unavailable/i.test(message);
        if (op.id) {
          await db.queue.update(op.id, {
            tries: (op.tries ?? 0) + 1,
            last_error: message,
            blocked: !retryable,
          });
        }
        // Transient connectivity/server failures preserve queue order; rejected
        // business/auth operations are held for user review and are not retried forever.
        if (retryable) break;
      }
    }
    return done;
  })();

  try {
    return await flushPromise;
  } finally {
    flushPromise = null;
  }
}

export function startSyncLoop(): () => void {
  if (loopStarted) return stopSyncLoop;
  loopStarted = true;

  const run = async () => {
    if (!navigator.onLine) return;
    try {
      const count = await flushQueue();
      if (count > 0) {
        window.dispatchEvent(new CustomEvent("queue-flushed", { detail: count }));
      }
    } catch (error) {
      console.error("Queue sync failed", error);
    } finally {
      window.dispatchEvent(new Event("queue-updated"));
    }
  };
  loopHandler = () => void run();
  window.addEventListener("online", loopHandler);
  window.addEventListener("focus", loopHandler);
  loopTimer = window.setInterval(() => void run(), 30_000);
  void run();
  return stopSyncLoop;
}

export function stopSyncLoop() {
  if (!loopStarted) return;
  loopStarted = false;
  if (loopHandler) {
    window.removeEventListener("online", loopHandler);
    window.removeEventListener("focus", loopHandler);
  }
  if (loopTimer !== null) window.clearInterval(loopTimer);
  loopHandler = null;
  loopTimer = null;
}
