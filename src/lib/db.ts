import Dexie, { type Table } from "dexie";

/** عملية مستنية تتنفّذ أول ما النت يرجع */
export interface PendingOp {
  id?: number;
  table: string;
  op: "insert" | "update" | "delete";
  payload: any;
  match?: Record<string, any>;
  created_at: number;
  owner_id?: string;
  blocked?: boolean;
  tries: number;
  last_error?: string;
}

export class AppDB extends Dexie {
  queue!: Table<PendingOp, number>;

  constructor() {
    super("ommal-app");
    this.version(1).stores({
      queue: "++id, table, created_at, tries",
    });
    this.version(2).stores({
      queue: "++id, table, created_at, owner_id, tries",
    });
  }
}

export const db = new AppDB();

export function isConnectionError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "");
  return /failed to fetch|network|offline|timeout|load failed|connection|fetcherror/i.test(message);
}

export async function enqueue(
  table: string,
  op: PendingOp["op"],
  payload: any,
  ownerId: string,
  match?: Record<string, any>
) {
  await db.queue.add({
    table,
    op,
    payload,
    match,
    owner_id: ownerId,
    created_at: Date.now(),
    tries: 0,
  });
}

export async function pendingCount(ownerId?: string): Promise<number> {
  return ownerId
    ? db.queue.where("owner_id").equals(ownerId).count()
    : db.queue.count();
}

export async function queueSummary(ownerId: string) {
  const ops = await db.queue.where("owner_id").equals(ownerId).toArray();
  const blocked = ops.filter((op) => op.blocked);
  return {
    pending: ops.length,
    blocked: blocked.length,
    lastError: blocked.at(-1)?.last_error ?? null,
  };
}

export async function clearBlockedQueue(ownerId: string): Promise<number> {
  return db.queue
    .where("owner_id")
    .equals(ownerId)
    .filter((op) => op.blocked === true)
    .delete();
}
