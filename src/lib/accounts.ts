/**
 * الحسابات والأدوار محفوظة في Supabase فقط.
 * لا تضع كلمات مرور أو بيانات إدارة في متغيرات Vite أو في كود الواجهة؛
 * أي VITE_* value تُضمّن في ملفات المتصفح وتصبح عامة.
 */
export type AccountKind = "owner" | "developer";

export interface AccountDef {
  kind: AccountKind;
  label: string;
  icon: string;
  name: string;
  username: string;
}

// لا توجد حسابات إدارية افتراضية داخل الواجهة.
export const ACCOUNTS: AccountDef[] = [];
