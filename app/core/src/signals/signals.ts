/**
 * Derived signals (spec §5). Every function is pure in `(snapshot, today)`; none reads a clock.
 * "Live" Tasks are the Tasks in the current path copy. Tombstoned Tasks count only towards the
 * Note-edit part of the streak.
 */
import type { Shift, Snapshot, TaskStatus } from "../api/snapshot.js";
import { addDays, daysBetween, parseDate } from "../dates/dates.js";
import type { Task } from "../path/types.js";

export interface TaskView {
  task: Task;
  blockIndex: number;
  /** Position in the Block's `tasks` array. */
  taskIndex: number;
  status: TaskStatus;
  statusDate: string | null;
  offsetDays: number;
  effDay: number;
  effDue: number;
  effDate: string;
  effDueDate: string;
  optional: boolean;
  /** `todo` and `effDay ≤ t ≤ effDue`. */
  open: boolean;
  /** Required, `todo`, `t > effDue`. Optional Tasks are never overdue. */
  overdue: boolean;
  /** `t − effDue` when overdue, else 0. */
  daysOverdue: number;
  /** `done` with `statusDate` after the effective due date. */
  doneLate: boolean;
}

/** Day number `t` of `today`: 1 on the start date, ≤ 0 before it. */
export function dayNumber(snapshot: Pick<Snapshot, "startDate">, today: string): number {
  return daysBetween(snapshot.startDate, today) + 1;
}

/** The calendar date of path day `d` (shifted or not). */
export function dateOfDay(snapshot: Pick<Snapshot, "startDate">, d: number): string {
  return addDays(snapshot.startDate, d - 1);
}

/** Path week of day `d`: `ceil(d / 7)`. */
export function pathWeek(d: number): number {
  return Math.ceil(d / 7);
}

/** The rhythm label of day `d`, by day number (never shifted). `""` for none. */
export function rhythmLabel(snapshot: Pick<Snapshot, "path">, d: number): string {
  const rhythm = snapshot.path.weekRhythm;
  if (!rhythm) return "";
  return rhythm[(((d - 1) % 7) + 7) % 7] ?? "";
}

/** Every live Task with its state and derived fields, in path order (§5 Ordering). */
export function taskViews(snapshot: Snapshot, today: string): TaskView[] {
  const t = dayNumber(snapshot, today);
  const states = new Map(snapshot.taskStates.map((s) => [s.taskId, s]));
  const views = snapshot.path.blocks.flatMap((block, blockIndex) =>
    block.tasks.map((task, taskIndex): TaskView => {
      const state = states.get(task.id);
      const status = state?.status ?? "todo";
      const statusDate = state?.statusDate ?? null;
      const offsetDays = state?.offsetDays ?? 0;
      const effDay = task.day + offsetDays;
      const effDue = (task.dueDay ?? task.day) + offsetDays;
      const effDueDate = dateOfDay(snapshot, effDue);
      const optional = task.optional === true;
      const overdue = !optional && status === "todo" && t > effDue;
      return {
        task,
        blockIndex,
        taskIndex,
        status,
        statusDate,
        offsetDays,
        effDay,
        effDue,
        effDate: dateOfDay(snapshot, effDay),
        effDueDate,
        optional,
        open: status === "todo" && effDay <= t && t <= effDue,
        overdue,
        daysOverdue: overdue ? t - effDue : 0,
        doneLate: status === "done" && statusDate !== null && statusDate > effDueDate,
      };
    }),
  );
  return views.sort(byPathOrder);
}

/** `(effective day, Block index, array index)`. */
export function byPathOrder(a: TaskView, b: TaskView): number {
  return a.effDay - b.effDay || a.blockIndex - b.blockIndex || a.taskIndex - b.taskIndex;
}

/** Oldest effective due day first, then path order. */
function byDueThenPathOrder(a: TaskView, b: TaskView): number {
  return a.effDue - b.effDue || byPathOrder(a, b);
}

// ---------------------------------------------------------------- per path

export interface RunInfo {
  /** Day number `t`. */
  day: number;
  /** Run length `M`: the largest effective due day over live Tasks. */
  length: number;
  /** `ceil(M / 7)`. */
  weeks: number;
  /** Path week of today; meaningful only while `0 < t ≤ M`. */
  week: number;
  /** Rhythm label of today. */
  rhythm: string;
  beforeStart: boolean;
  /** `t > M`. Shown only, never stored. */
  finished: boolean;
}

export function runInfo(snapshot: Snapshot, today: string): RunInfo {
  return runInfoOf(snapshot, today, taskViews(snapshot, today));
}

function runInfoOf(snapshot: Snapshot, today: string, views: TaskView[]): RunInfo {
  const day = dayNumber(snapshot, today);
  const length = views.reduce((m, v) => Math.max(m, v.effDue), 0);
  return {
    day,
    length,
    weeks: Math.ceil(length / 7),
    week: pathWeek(day),
    rhythm: rhythmLabel(snapshot, day),
    beforeStart: day <= 0,
    finished: day > length,
  };
}

// ---------------------------------------------------------------- stats

export interface Stats {
  requiredDone: number;
  required: number;
  /** `requiredDone / required` as 0–100, floored so 100 means all done. `null` = no required Tasks ("—"). */
  percent: number | null;
  /** Done optional Tasks. */
  bonus: number;
  checkpointsPassed: number;
  checkpoints: number;
  blocksComplete: number;
  streak: number;
  longestStreak: number;
}

export function stats(snapshot: Snapshot, today: string): Stats {
  const views = taskViews(snapshot, today);
  const required = views.filter((v) => !v.optional);
  const requiredDone = required.filter((v) => v.status === "done").length;
  const checkpoints = views.filter((v) => v.task.kind === "checkpoint");
  const { current, longest } = streaks(snapshot, today, views);
  return {
    requiredDone,
    required: required.length,
    percent: required.length === 0 ? null : Math.floor((100 * requiredDone) / required.length),
    bonus: views.filter((v) => v.optional && v.status === "done").length,
    checkpointsPassed: checkpoints.filter((v) => v.status === "done").length,
    checkpoints: checkpoints.length,
    blocksComplete: blockSignalsOf(snapshot, today, views).filter((b) => b.complete).length,
    streak: current,
    longestStreak: longest,
  };
}

// ---------------------------------------------------------------- streak

/**
 * Activity on date D: a live Task done with `statusDate = D`, or any Note (any target, removed
 * Tasks included) with D in its edit trail. A date is scheduled when a live Task's effective day
 * falls on it. Skipped Tasks never count.
 */
function streaks(
  snapshot: Snapshot,
  today: string,
  views: TaskView[],
): { current: number; longest: number } {
  const activity = new Set<string>();
  for (const v of views) if (v.status === "done" && v.statusDate) activity.add(v.statusDate);
  for (const note of snapshot.noteMeta) for (const d of note.editedOn) activity.add(d);
  const scheduled = new Set(views.map((v) => v.effDate));

  const past = [...activity].filter((d) => d <= today).sort();
  const earliest = past[0];
  if (earliest === undefined) return { current: 0, longest: 0 };

  // Walk back from today. Today never breaks the streak.
  let current = activity.has(today) ? 1 : 0;
  for (let d = addDays(today, -1); d >= earliest; d = addDays(d, -1)) {
    if (activity.has(d)) current++;
    else if (scheduled.has(d)) break;
  }

  // Walk forward from the earliest activity date under the same rules.
  let longest = 0;
  let run = 0;
  const end = parseDate(today);
  for (let n = parseDate(earliest), d = earliest; n <= end; n++, d = addDays(d, 1)) {
    if (activity.has(d)) longest = Math.max(longest, ++run);
    else if (scheduled.has(d) && d !== today) run = 0;
  }
  return { current, longest };
}

// ---------------------------------------------------------------- per Block

export type BlockState = "complete" | "behind" | "current" | "upcoming";

export interface BlockSignals {
  blockIndex: number;
  requiredDone: number;
  required: number;
  bonus: number;
  checkpointsPassed: number;
  checkpoints: number;
  overdue: number;
  /** Effective range: first effective day through last effective due day. */
  first: number;
  last: number;
  firstDate: string;
  lastDate: string;
  /** Every required Task done. */
  complete: boolean;
  state: BlockState;
}

export function blockSignals(snapshot: Snapshot, today: string): BlockSignals[] {
  return blockSignalsOf(snapshot, today, taskViews(snapshot, today));
}

function blockSignalsOf(snapshot: Snapshot, today: string, views: TaskView[]): BlockSignals[] {
  const t = dayNumber(snapshot, today);
  return snapshot.path.blocks.map((_, blockIndex) => {
    const own = views.filter((v) => v.blockIndex === blockIndex);
    const required = own.filter((v) => !v.optional);
    const checkpoints = own.filter((v) => v.task.kind === "checkpoint");
    const first = Math.min(...own.map((v) => v.effDay));
    const last = Math.max(...own.map((v) => v.effDue));
    const requiredDone = required.filter((v) => v.status === "done").length;
    const overdue = own.filter((v) => v.overdue).length;
    const complete = requiredDone === required.length;
    const state: BlockState = complete
      ? "complete"
      : overdue > 0 || t > last
        ? "behind"
        : t >= first
          ? "current"
          : "upcoming";
    return {
      blockIndex,
      requiredDone,
      required: required.length,
      bonus: own.filter((v) => v.optional && v.status === "done").length,
      checkpointsPassed: checkpoints.filter((v) => v.status === "done").length,
      checkpoints: checkpoints.length,
      overdue,
      first,
      last,
      firstDate: dateOfDay(snapshot, first),
      lastDate: dateOfDay(snapshot, last),
      complete,
      state,
    };
  });
}

/**
 * The Block the hero shows for day `t`: the one whose effective range contains `t`, else the
 * last one that has started, else the first.
 */
export function currentBlockIndex(snapshot: Snapshot, today: string): number {
  const t = dayNumber(snapshot, today);
  const blocks = blockSignals(snapshot, today);
  const inside = blocks.find((b) => b.first <= t && t <= b.last);
  if (inside) return inside.blockIndex;
  const started = blocks.filter((b) => b.first <= t);
  return started.at(-1)?.blockIndex ?? 0;
}

// ---------------------------------------------------------------- Today screen

export interface TodayColumns {
  /** Overdue Tasks, oldest effective due day first. */
  catchUp: TaskView[];
  /** Tasks whose effective day is today, any status. */
  today: TaskView[];
  /** Open Tasks that started on an earlier day. */
  inProgress: TaskView[];
}

export function todayColumns(snapshot: Snapshot, today: string): TodayColumns {
  const t = dayNumber(snapshot, today);
  const views = taskViews(snapshot, today);
  return {
    catchUp: views.filter((v) => v.overdue).sort(byDueThenPathOrder),
    today: views.filter((v) => v.effDay === t),
    inProgress: views.filter((v) => v.open && v.effDay < t),
  };
}

/** The Tasks whose effective day is `d`, in path order (the `?day=` view). */
export function tasksOnDay(snapshot: Snapshot, today: string, d: number): TaskView[] {
  return taskViews(snapshot, today).filter((v) => v.effDay === d);
}

/** One dot per Task. `open` here means `todo` and not overdue, including future Tasks. */
export type Dot = "done" | "skipped" | "overdue" | "open";

export interface StripDay {
  day: number;
  date: string;
  rhythm: string;
  isToday: boolean;
  dots: { taskId: string; dot: Dot }[];
}

/** The 7-day strip for path week `week` (defaults to today's week). */
export function weekStrip(snapshot: Snapshot, today: string, week?: number): StripDay[] {
  const t = dayNumber(snapshot, today);
  const w = week ?? pathWeek(t);
  const views = taskViews(snapshot, today);
  return Array.from({ length: 7 }, (_, i) => {
    const day = 7 * (w - 1) + i + 1;
    return {
      day,
      date: dateOfDay(snapshot, day),
      rhythm: rhythmLabel(snapshot, day),
      isToday: day === t,
      dots: views
        .filter((v) => v.effDay === day)
        .map((v) => ({ taskId: v.task.id, dot: dotOf(v) })),
    };
  });
}

function dotOf(v: TaskView): Dot {
  if (v.status === "done") return "done";
  if (v.status === "skipped") return "skipped";
  return v.overdue ? "overdue" : "open";
}

// ---------------------------------------------------------------- shifts

/**
 * The shift that can be undone (spec §4.2): the most recent one, and only if it was created
 * after the last reload. `null` when none is.
 */
export function undoableShift<S extends Omit<Shift, "undoable">>(snapshot: {
  shifts: readonly S[];
  reloadedAt: string | null;
}): S | null {
  const latest = snapshot.shifts.reduce<S | null>(
    (best, s) => (best === null || s.id > best.id ? s : best),
    null,
  );
  if (!latest) return null;
  if (
    snapshot.reloadedAt !== null &&
    !(Date.parse(latest.createdAt) > Date.parse(snapshot.reloadedAt))
  ) {
    return null;
  }
  return latest;
}
