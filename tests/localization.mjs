import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  configFile: false,
  root,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
});

try {
  const [
    { arabicError },
    { fmtDateOnly, fmtDateTime, fmtTime, todayStr },
    { arabicTableLabel, localizeDateText },
    { arabicWeekdays, formatArabicCalendarDate, formatArabicMonthName, formatArabicMonthTitle, monthStartOffset },
  ] = await Promise.all([
    vite.ssrLoadModule("/src/lib/errors.ts"),
    vite.ssrLoadModule("/src/lib/calc.ts"),
    vite.ssrLoadModule("/src/lib/presentation.ts"),
    vite.ssrLoadModule("/src/lib/arabicCalendar.ts"),
  ]);

  assert.match(arabicError({ message: "Failed to fetch" }, "تعذر التنفيذ."), /تعذر الاتصال/);
  assert.equal(arabicError({ message: "Unknown English service failure" }, "تعذر التنفيذ."), "تعذر التنفيذ.");
  assert.equal(arabicError({ message: "الاسم مسجل بالفعل" }, "تعذر التنفيذ."), "الاسم مسجل بالفعل");

  assert.match(fmtDateOnly("2026-10-13"), /١٣/);
  assert.equal(fmtDateOnly("not-a-date"), "تاريخ غير صالح");
  assert.match(fmtTime("2026-10-13T09:05:00.000Z"), /صباحًا|مساءً/);
  assert.match(fmtDateTime("2026-10-13T09:05:00.000Z"), /صباحًا|مساءً/);
  assert.match(todayStr(), /^\d{4}-\d{2}-\d{2}$/);

  const localizedNotification = localizeDateText("تم تسجيل الحضور يوم 2026-10-13");
  assert.match(localizedNotification, /[٠-٩]/);
  assert.doesNotMatch(localizedNotification, /2026-10-13/);
  assert.equal(localizeDateText(null), "");
  assert.equal(arabicTableLabel("owner_attendance"), "حضور المالك");

  assert.deepEqual(
    Array.from({ length: 12 }, (_, index) => formatArabicMonthName(index + 1)),
    ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
  );
  assert.equal(formatArabicMonthTitle(2026, 10), "أكتوبر ٢٠٢٦");
  assert.equal(formatArabicCalendarDate("2026-10-13"), "١٣ أكتوبر ٢٠٢٦");
  assert.deepEqual(arabicWeekdays(), ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"]);
  assert.equal(monthStartOffset(2026, 10), 5);

  console.log("نجحت اختبارات التعريب والتاريخ والوقت والتقويم: 17/17");
} finally {
  await vite.close();
}
