import { fmtDateOnly } from "./calc";

const DATABASE_TABLE_LABELS: Record<string, string> = {
  profiles: "الحسابات",
  attendance: "سجلات الحضور",
  attendance_projects: "روابط الحضور بالمشاريع",
  withdrawals: "طلبات السحب",
  deductions: "سجل الخصومات",
  settlements: "التسويات",
  projects: "المشاريع",
  sites: "المواقع",
  settings: "الإعدادات",
  notifications: "الإشعارات",
  audit_log: "سجل التعديلات",
};

const QUEUE_ACTION_LABELS: Record<string, string> = {
  insert: "إضافة",
  update: "تعديل",
  delete: "حذف",
};

/** Names for internal database tables are never exposed as English UI labels. */
export function arabicTableLabel(value: unknown): string {
  if (typeof value !== "string") return "سجلات النظام";
  return DATABASE_TABLE_LABELS[value] ?? "سجلات النظام";
}

export function arabicQueueTableLabel(value: unknown): string {
  return value === "rpc" ? "عملية محفوظة للخادم" : arabicTableLabel(value);
}

export function arabicQueueActionLabel(value: unknown): string {
  if (typeof value !== "string") return "عملية";
  return QUEUE_ACTION_LABELS[value] ?? "عملية";
}

/** Localize ISO calendar dates embedded in Arabic server-generated messages. */
export function localizeDateText(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => fmtDateOnly(date));
}
