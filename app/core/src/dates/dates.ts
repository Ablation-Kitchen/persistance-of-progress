/**
 * Plain-date utilities (spec §5). A date is a local `YYYY-MM-DD` string. Arithmetic goes
 * through integer UTC day counts, never local `Date` objects, so it is free of DST errors.
 */

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 for a `YYYY-MM-DD` string. Throws on a malformed or unreal date. */
export function parseDate(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`not a YYYY-MM-DD date: ${JSON.stringify(date)}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new RangeError(`not a calendar date: ${date}`);
  }
  return ms / DAY_MS;
}

/** True when `date` is a well-formed, real calendar date (spec §8.1). */
export function isDate(date: string): boolean {
  try {
    parseDate(date);
    return true;
  } catch {
    return false;
  }
}

/** `YYYY-MM-DD` for a UTC day count. */
export function formatDate(dayCount: number): string {
  return new Date(dayCount * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return formatDate(parseDate(date) + days);
}

/** `to − from` in whole days. */
export function daysBetween(from: string, to: string): number {
  return parseDate(to) - parseDate(from);
}

export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 0 = Monday … 6 = Sunday. */
export function weekday(date: string): WeekdayIndex {
  // 1970-01-01 was a Thursday (index 3).
  return ((((parseDate(date) + 3) % 7) + 7) % 7) as WeekdayIndex;
}

/**
 * The local calendar date of `now`, from `getFullYear/getMonth/getDate`. Browser only:
 * the server never decides what day it is (spec §8.1). The caller passes the current time.
 */
export function localToday(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
