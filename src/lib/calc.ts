import type { AppSettings, WorkerBalance } from "./types";

export function money(n: number, currency = "ج.م"): string {
  return `${Number(n || 0).toLocaleString("ar-EG", {
    maximumFractionDigits: 2,
  })} ${currency}`;
}

/** الرصيد العام: الاستحقاق − السحوبات − الخصومات − التسويات المصروفة */
export function netAmount(b: WorkerBalance): number {
  return (b.earned || 0) - (b.withdrawn_approved || 0) - (b.deducted || 0) - (b.settled_paid || 0);
}

/** اللي يقدر ياخده دلوقتي (بنستقعد المعلّق كمان) */
export function availableNow(b: WorkerBalance): number {
  return (
    (b.earned || 0) -
    (b.withdrawn_approved || 0) -
    (b.withdrawn_pending || 0) -
    (b.deducted || 0) -
    (b.settled_paid || 0)
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

/** كل طلبات الصرف تحتاج موافقة المالك، مهما كان المبلغ. */
export function needsApproval(_amount: number, _settings: AppSettings): boolean {
  return true;
}

const CAIRO_TIME_ZONE = "Africa/Cairo";

function parseCalendarDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  // Date-only values are calendar dates, not UTC timestamps. Noon UTC keeps
  // them on the same Cairo calendar day while avoiding midnight DST edges.
  if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Date(value);
}

export function todayStr(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** تاريخ عربي واضح للتواريخ المخزّنة كتاريخ فقط أو كتوقيت كامل. */
export function fmtDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    const date = parseCalendarDate(value);
    if (Number.isNaN(date.getTime())) return "تاريخ غير صالح";
    return new Intl.DateTimeFormat("ar-EG", {
      timeZone: CAIRO_TIME_ZONE,
      dateStyle: "medium",
    }).format(date);
  } catch {
    return "تاريخ غير صالح";
  }
}

function formatArabicTwelveHour(date: Date, options: Intl.DateTimeFormatOptions): string {
  const formatter = new Intl.DateTimeFormat("ar-EG", options);
  const parts = formatter.formatToParts(date);
  const dayPeriodIndex = parts.findIndex((part) => part.type === "dayPeriod");
  if (dayPeriodIndex < 0) return formatter.format(date);

  const marker = parts[dayPeriodIndex].value;
  const period = marker.includes("ص") || /am/i.test(marker) ? "صباحًا" : "مساءً";
  const before = parts.slice(0, dayPeriodIndex).map((part) => part.value).join("").trimEnd();
  const after = parts.slice(dayPeriodIndex + 1).map((part) => part.value).join("").trim();
  return `${before} ${period}${after ? ` ${after}` : ""}`;
}

/** الوقت دائمًا بتوقيت القاهرة وبصياغة عربية صريحة لنظام ١٢ ساعة. */
export function fmtTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return formatArabicTwelveHour(date, {
      timeZone: CAIRO_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "—";
  }
}

/** التاريخ والوقت معًا، باللغة العربية وتوقيت القاهرة وصيغة ١٢ ساعة. */
export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fmtDateOnly(value);
    return formatArabicTwelveHour(date, {
      timeZone: CAIRO_TIME_ZONE,
      dateStyle: "medium",
      timeStyle: "short",
      hour12: true,
    });
  } catch {
    return fmtDateOnly(value);
  }
}

export function fmtDate(d: string): string {
  try {
    return new Intl.DateTimeFormat("ar-EG", {
      timeZone: CAIRO_TIME_ZONE,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(parseCalendarDate(d));
  } catch {
    return "تاريخ غير صالح";
  }
}
