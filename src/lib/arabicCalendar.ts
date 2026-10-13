const ARABIC_GREGORIAN_LOCALE = "ar-EG-u-ca-gregory-nu-arab";

export type CalendarValueMode = "date" | "month";
export interface CalendarParts {
  year: number;
  month: number;
  day?: number;
}

export function parseCalendarValue(value: string, mode: CalendarValueMode): CalendarParts | null {
  const match = mode === "date"
    ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    : /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = mode === "date" ? Number(match[3]) : undefined;
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  if (day !== undefined && (day < 1 || day > daysInMonth(year, month))) return null;
  return { year, month, ...(day === undefined ? {} : { day }) };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The app's calendar starts on Saturday, the first day of the local work week. */
export function monthStartOffset(year: number, month: number): number {
  const sundayBasedDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return (sundayBasedDay + 1) % 7;
}

export function makeDateValue(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function makeMonthValue(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function formatArabicNumber(value: number): string {
  return new Intl.NumberFormat(ARABIC_GREGORIAN_LOCALE, { useGrouping: false }).format(value);
}

export function formatArabicMonthName(month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) return "";
  return new Intl.DateTimeFormat(ARABIC_GREGORIAN_LOCALE, {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, month - 1, 1)));
}

export function formatArabicMonthTitle(year: number, month: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return "";
  return new Intl.DateTimeFormat(ARABIC_GREGORIAN_LOCALE, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function formatArabicCalendarDate(value: string): string {
  const parts = parseCalendarValue(value, "date");
  if (!parts?.day) return "اختر التاريخ";
  return new Intl.DateTimeFormat(ARABIC_GREGORIAN_LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}

export function formatArabicCalendarMonth(value: string): string {
  const parts = parseCalendarValue(value, "month");
  if (!parts) return "اختر الشهر";
  return formatArabicMonthTitle(parts.year, parts.month);
}

export function arabicWeekdays(): string[] {
  const saturday = Date.UTC(2026, 0, 3);
  const formatter = new Intl.DateTimeFormat(ARABIC_GREGORIAN_LOCALE, {
    weekday: "short",
    timeZone: "UTC",
  });
  return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(saturday + index * 86_400_000)));
}

/** Compact display labels for a narrow seven-column mobile calendar. */
export function arabicWeekdayAbbreviations(): string[] {
  return ["سبت", "أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة"];
}
