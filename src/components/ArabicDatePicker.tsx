import { useEffect, useMemo, useRef, useState } from "react";
import AppIcon from "./AppIcon";
import { todayStr } from "../lib/calc";
import {
  arabicWeekdayAbbreviations,
  arabicWeekdays,
  daysInMonth,
  formatArabicCalendarDate,
  formatArabicCalendarMonth,
  formatArabicMonthName,
  formatArabicMonthTitle,
  formatArabicNumber,
  makeDateValue,
  makeMonthValue,
  monthStartOffset,
  parseCalendarValue,
  type CalendarValueMode,
} from "../lib/arabicCalendar";

type ArabicDatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  mode?: CalendarValueMode;
  disabled?: boolean;
};

function currentCalendarParts(value: string, mode: CalendarValueMode): { year: number; month: number } {
  const parsed = parseCalendarValue(value, mode) ?? parseCalendarValue(todayStr(), "date");
  const today = parseCalendarValue(todayStr(), "date");
  return {
    year: parsed?.year ?? today?.year ?? 2026,
    month: parsed?.month ?? today?.month ?? 1,
  };
}

export default function ArabicDatePicker({
  value,
  onChange,
  ariaLabel,
  mode = "date",
  disabled = false,
}: ArabicDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(() => currentCalendarParts(value, mode));
  const rootRef = useRef<HTMLDivElement>(null);
  const today = todayStr();
  const weekdays = useMemo(() => arabicWeekdays(), []);
  const weekdayLabels = useMemo(() => arabicWeekdayAbbreviations(), []);
  const dayCount = daysInMonth(visible.year, visible.month);
  const firstDayOffset = monthStartOffset(visible.year, visible.month);
  const dateCells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstDayOffset + 1;
    return day >= 1 && day <= dayCount ? day : null;
  });
  const displayValue = mode === "month"
    ? formatArabicCalendarMonth(value)
    : formatArabicCalendarDate(value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function showCalendar() {
    setVisible(currentCalendarParts(value, mode));
    setOpen((current) => !current);
  }

  function shiftVisibleMonth(amount: number) {
    const shifted = new Date(Date.UTC(visible.year, visible.month - 1 + amount, 1));
    setVisible({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 });
  }

  function selectToday() {
    onChange(mode === "month" ? today.slice(0, 7) : today);
    setOpen(false);
  }

  return (
    <div className="arabic-date-picker" ref={rootRef} dir="rtl">
      <button
        type="button"
        className="input arabic-date-trigger"
        aria-label={`${ariaLabel}: ${displayValue}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={showCalendar}
      >
        <span dir="auto">{displayValue}</span>
        <AppIcon name="calendarCheck" size={17} />
      </button>

      {open && (
        <div
          className="arabic-calendar-popover"
          role="dialog"
          aria-label={mode === "month" ? "اختيار شهر باللغة العربية" : "اختيار تاريخ باللغة العربية"}
          dir="rtl"
        >
          {mode === "date" ? (
            <>
              <div className="arabic-calendar-toolbar">
                <button
                  type="button"
                  className="arabic-calendar-nav"
                  aria-label="الشهر السابق"
                  onClick={() => shiftVisibleMonth(-1)}
                >
                  <span aria-hidden="true">‹</span>
                </button>
                <h3 aria-live="polite">{formatArabicMonthTitle(visible.year, visible.month)}</h3>
                <button
                  type="button"
                  className="arabic-calendar-nav"
                  aria-label="الشهر التالي"
                  onClick={() => shiftVisibleMonth(1)}
                >
                  <span aria-hidden="true">›</span>
                </button>
              </div>
              <div className="arabic-calendar-grid" aria-label="أيام الأسبوع والتاريخ">
                {weekdays.map((weekday, index) => (
                  <span className="arabic-calendar-weekday" key={weekday} aria-label={weekday} title={weekday}>
                    {weekdayLabels[index]}
                  </span>
                ))}
                {dateCells.map((day, index) => {
                  if (day === null) {
                    return <span className="arabic-calendar-empty" aria-hidden="true" key={`empty-${index}`} />;
                  }
                  const dateValue = makeDateValue(visible.year, visible.month, day);
                  const isToday = dateValue === today;
                  const isSelected = dateValue === value;
                  return (
                    <button
                      type="button"
                      className={`arabic-calendar-day${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}`}
                      key={dateValue}
                      aria-label={formatArabicCalendarDate(dateValue)}
                      aria-pressed={isSelected}
                      aria-current={isToday ? "date" : undefined}
                      onClick={() => {
                        onChange(dateValue);
                        setOpen(false);
                      }}
                    >
                      {formatArabicNumber(day)}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="arabic-calendar-toolbar arabic-calendar-year-toolbar">
                <button
                  type="button"
                  className="arabic-calendar-nav"
                  aria-label="السنة السابقة"
                  onClick={() => setVisible((current) => ({ ...current, year: current.year - 1 }))}
                >
                  <span aria-hidden="true">‹</span>
                </button>
                <h3 aria-live="polite">{formatArabicNumber(visible.year)}</h3>
                <button
                  type="button"
                  className="arabic-calendar-nav"
                  aria-label="السنة التالية"
                  onClick={() => setVisible((current) => ({ ...current, year: current.year + 1 }))}
                >
                  <span aria-hidden="true">›</span>
                </button>
              </div>
              <div className="arabic-calendar-month-grid">
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
                  const selected = value === makeMonthValue(visible.year, month);
                  const thisMonth = today.startsWith(makeMonthValue(visible.year, month));
                  return (
                    <button
                      type="button"
                      className={`arabic-calendar-month${selected ? " is-selected" : ""}${thisMonth ? " is-today" : ""}`}
                      key={month}
                      aria-label={`اختيار شهر ${formatArabicMonthName(month)}`}
                      aria-pressed={selected}
                      onClick={() => {
                        onChange(makeMonthValue(visible.year, month));
                        setOpen(false);
                      }}
                    >
                      {formatArabicMonthName(month)}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="arabic-calendar-footer">
            <button type="button" className="arabic-calendar-today" onClick={selectToday}>
              {mode === "month" ? "هذا الشهر" : "اليوم"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
