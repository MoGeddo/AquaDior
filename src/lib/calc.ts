import type { AppSettings, WorkerBalance } from "./types";

export function money(n: number, currency = "ج.م"): string {
  return `${Number(n || 0).toLocaleString("ar-EG", {
    maximumFractionDigits: 2,
  })} ${currency}`;
}

/** المعادلة الأساسية: استحقاق − مسحوب − خصومات */
export function netAmount(b: WorkerBalance): number {
  return (b.earned || 0) - (b.withdrawn_approved || 0) - (b.deducted || 0);
}

/** اللي يقدر ياخده دلوقتي (بنستقعد المعلّق كمان) */
export function availableNow(b: WorkerBalance): number {
  return (
    (b.earned || 0) -
    (b.withdrawn_approved || 0) -
    (b.withdrawn_pending || 0) -
    (b.deducted || 0)
  );
}

/** هل المبلغ ده مسموح بيه؟ */
export function checkWithdrawal(
  amount: number,
  balance: WorkerBalance,
  settings: AppSettings
): { ok: boolean; reason?: string } {
  if (!amount || amount <= 0) return { ok: false, reason: "اكتب مبلغ أكبر من صفر" };
  const avail = availableNow(balance);
  if (amount > avail) {
    return {
      ok: false,
      reason: `متاح تاخد ${money(avail, settings.currency)} بس — مش هتاخد أكتر من اللي اشتغلته`,
    };
  }
  return { ok: true };
}

/** هيعدّي لوحده ولا يحتاج موافقة؟ */
export function needsApproval(amount: number, settings: AppSettings): boolean {
  return amount > (settings.auto_approve_limit ?? 500);
}

export function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function fmtDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString("ar-EG", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch {
    return d;
  }
}
