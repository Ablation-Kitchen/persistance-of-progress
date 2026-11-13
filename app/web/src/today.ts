import { addDays, localToday, weekday, type Weekday } from "@learning-tracker/core";

/** The browser's local date (spec §5). The only place the web app reads the clock. */
export function useToday(): string {
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

/** The next `day` strictly after `today`. */
export function nextWeekday(today: string, day: Weekday = "monday"): string {
  const diff = (WEEKDAYS.indexOf(day) - weekday(today) + 7) % 7;
  return addDays(today, diff === 0 ? 7 : diff);
}

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
