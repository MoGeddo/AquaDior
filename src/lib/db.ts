import Dexie, { type Table } from "dexie";

/** عملية مستنية تتنفّذ أول ما النت يرجع */
export interface PendingOp {
  id?: number;
  table: string;
  op: "insert" | "update" | "delete";
  payload: any;
  match?: Record<string, any>;
  created_at: number;
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
  }
}

export const db = new AppDB();

export async function enqueue(
  table: string,
  op: PendingOp["op"],
  payload: any,
  match?: Record<string, any>
) {
  await db.queue.add({
    table,
    op,
    payload,
    match,
    created_at: Date.now(),
    tries: 0,
  });
}

export async function pendingCount(): Promise<number> {
  return db.queue.count();
}
