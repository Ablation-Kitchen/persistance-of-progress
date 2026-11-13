import { useLocation } from "react-router";
import { addDays, isDate, localToday, weekday, type Weekday } from "@learning-tracker/core";

/**
 * The browser's local date (spec §5). The only place the web app reads the clock. Dev builds
 * (and tests) accept a `?today=YYYY-MM-DD` override so a run can be viewed at any point.
 */
export function useToday(): string {
  const { search } = useLocation();
  if (import.meta.env.DEV) {
    const override = new URLSearchParams(search).get("today");
    if (override && isDate(override)) return override;
  }
  return localToday(new Date());
}

const WEEKDAYS: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The next `day` strictly after `today`. */
export function nextWeekday(today: string, day: Weekday = "monday"): string {
  const diff = (WEEKDAYS.indexOf(day) - weekday(today) + 7) % 7;
  return addDays(today, diff === 0 ? 7 : diff);
}

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** `wed` for a `YYYY-MM-DD` date. */
export const weekdayShort = (date: string) => WEEKDAYS[weekday(date)]!.slice(0, 3);

/** `wed 30 sep` for a `YYYY-MM-DD` date. Locale-free, so it matches in every browser. */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${weekdayShort(date)} ${d} ${MONTHS[m! - 1]}`;
}
