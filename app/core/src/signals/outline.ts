/**
 * The Path screen outline (spec §7.4): every Block with its live Tasks grouped by path week, the
 * shift markers and the "moved +Nd by a shift" note per week. Pure in `(snapshot, today)`.
 */
import type { Shift, Snapshot } from "../api/snapshot.js";
import {
  blockSignals,
  dateOfDay,
  dayNumber,
  pathWeek,
  taskViews,
  type BlockSignals,
  type TaskView,
} from "./signals.js";

export interface OutlineWeek {
  /** Path week of the Tasks' effective days. */
  week: number;
  firstDate: string;
  lastDate: string;
  /** Today falls in this week. */
  thisWeek: boolean;
  /** This Block's Tasks whose effective day falls in the week, in path order. */
  tasks: TaskView[];
  /** Distinct positive offsets of those Tasks, ascending: "moved +2d by a shift". */
  movedBy: number[];
  /** Shifts applied in this week. Each shift appears in exactly one week of the outline. */
  shifts: Shift[];
}

export interface OutlineBlock {
  blockIndex: number;
  signals: BlockSignals;
  weeks: OutlineWeek[];
}

/** `optional`, `todo` and past its effective due day: shown muted, still tickable. */
export function isOptionalPast(v: TaskView, t: number): boolean {
  return v.optional && v.status === "todo" && t > v.effDue;
}

export function pathOutline(snapshot: Snapshot, today: string): OutlineBlock[] {
  const t = dayNumber(snapshot, today);
  const views = taskViews(snapshot, today);
  const signals = blockSignals(snapshot, today);
  const blocks: OutlineBlock[] = snapshot.path.blocks.map((_, blockIndex) => {
    const byWeek = new Map<number, TaskView[]>();
    for (const v of views) {
      if (v.blockIndex !== blockIndex) continue; // Tasks stay under their own Block when shifted.
      const w = pathWeek(v.effDay);
      byWeek.set(w, [...(byWeek.get(w) ?? []), v]);
    }
    const weeks = [...byWeek.entries()]
      .sort(([a], [b]) => a - b)
      .map(([week, tasks]): OutlineWeek => ({
        week,
        firstDate: dateOfDay(snapshot, 7 * (week - 1) + 1),
        lastDate: dateOfDay(snapshot, 7 * week),
        thisWeek: week === pathWeek(t),
        tasks,
        movedBy: [...new Set(tasks.map((v) => v.offsetDays).filter((o) => o > 0))].sort(
          (a, b) => a - b,
        ),
        shifts: [],
      }));
    return { blockIndex, signals: signals[blockIndex]!, weeks };
  });

  // Each shift marker goes once: into the first Block (file order) holding its week, else the
  // first outline week after it, else the last week of all.
  const all = blocks.flatMap((b) => b.weeks);
  for (const shift of [...snapshot.shifts].sort((a, b) => a.id - b.id)) {
    const w = pathWeek(dayNumber(snapshot, shift.appliedOn));
    const home =
      all.find((x) => x.week === w) ??
      [...all].sort((a, b) => a.week - b.week).find((x) => x.week > w) ??
      all.at(-1);
    home?.shifts.push(shift);
  }
  return blocks;
}
