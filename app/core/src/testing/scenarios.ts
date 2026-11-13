/**
 * Test-only scenario builder (ticket 04): Enrollment snapshots of the 17-week fixture at
 * different points in the run. Deterministic: history is seeded from a hash of each Task id.
 */
import { readFileSync } from "node:fs";
import type { NoteMeta, Shift, Snapshot, TaskStateRecord, Tombstone } from "../api/snapshot.js";
import { addDays } from "../dates/dates.js";
import { allTasks, dueDayOf } from "../path/helpers.js";
import { loadPath } from "../path/load.js";
import type { LearningPath } from "../path/types.js";

export const FIXTURE_START = "2026-09-07"; // a Monday

export function fixturePath(): { path: LearningPath; hash: string } {
  const text = readFileSync(
    new URL("../../../paths/eval-infra-17-weeks.yaml", import.meta.url),
    "utf8",
  );
  const result = loadPath(text, { source: "yaml" });
  if (!result.ok) throw new Error("fixture must load");
  return { path: result.path, hash: result.hash };
}

const TS = "2026-09-01T09:00:00.000Z";

/** A snapshot with no progress. */
export function emptySnapshot(
  path: LearningPath,
  startDate = FIXTURE_START,
  hash = "0".repeat(64),
): Snapshot {
  return {
    id: "enrollment-1",
    pathId: path.id,
    pathHash: hash,
    startDate,
    createdAt: TS,
    loadedAt: TS,
    reloadedAt: null,
    stateVersion: 0,
    path,
    taskStates: [],
    shifts: [],
    tombstones: [],
    noteMeta: [],
  };
}

export function setState(
  s: Snapshot,
  taskId: string,
  status: TaskStateRecord["status"],
  statusDate: string | null = null,
): void {
  const existing = s.taskStates.find((r) => r.taskId === taskId);
  const record: TaskStateRecord = {
    taskId,
    status,
    statusDate: status === "todo" ? null : statusDate,
    offsetDays: existing?.offsetDays ?? 0,
    updatedAt: TS,
  };
  if (existing) Object.assign(existing, record);
  else s.taskStates.push(record);
}

export function editNote(s: Snapshot, target: NoteMeta["target"], ...dates: string[]): void {
  let meta = s.noteMeta.find((n) => n.target === target);
  if (!meta) {
    meta = { target, fromTemplate: false, editedOn: [], length: 1, createdAt: TS, updatedAt: TS };
    s.noteMeta.push(meta);
  }
  for (const d of dates) if (!meta.editedOn.includes(d)) meta.editedOn.push(d);
}

/** Shift every live `todo` Task forward `days` (spec §8.3), logging it. */
export function applyShift(s: Snapshot, days: number, appliedOn: string, createdAt: string): Shift {
  const status = new Map(s.taskStates.map((r) => [r.taskId, r]));
  const taskIds: string[] = [];
  for (const { task } of allTasks(s.path)) {
    const r = status.get(task.id);
    if (r && r.status !== "todo") continue;
    if (r) r.offsetDays += days;
    else
      s.taskStates.push({
        taskId: task.id,
        status: "todo",
        statusDate: null,
        offsetDays: days,
        updatedAt: createdAt,
      });
    taskIds.push(task.id);
  }
  const shift: Shift = {
    id: s.shifts.length + 1,
    appliedOn,
    days,
    taskIds,
    createdAt,
    undoable: false,
  };
  s.shifts.push(shift);
  return shift;
}

/** Remove a Task from the path copy, keeping a tombstone (as a reload would). */
export function tombstone(s: Snapshot, taskId: string, removedAt: string): Tombstone {
  for (const block of s.path.blocks) {
    const i = block.tasks.findIndex((t) => t.id === taskId);
    const task = block.tasks[i];
    if (!task) continue;
    block.tasks.splice(i, 1);
    const stone: Tombstone = {
      taskId,
      title: task.title,
      kind: task.kind,
      formerDay: task.day,
      removedAt,
    };
    s.tombstones.push(stone);
    return stone;
  }
  throw new Error(`no Task ${taskId}`);
}

function hash(s: string): number {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 100;
}

/**
 * Seed plausible history up to (not including) day `t`: most required Tasks done on their due
 * day, a few skipped or left overdue, some optional ones done, and a Day Note every 3 days.
 */
function seedHistory(s: Snapshot, t: number): void {
  const date = (d: number) => addDays(s.startDate, d - 1);
  for (const { task } of allTasks(s.path)) {
    if (task.day >= t) continue;
    const h = hash(task.id);
    const due = dueDayOf(task);
    if (task.optional) {
      if (h < 45) setState(s, task.id, "done", date(Math.min(due, t - 1)));
    } else if (due >= t) {
      if (h < 25) setState(s, task.id, "done", date(t - 1));
    } else if (h < 90) setState(s, task.id, "done", date(due));
    else if (h < 94) setState(s, task.id, "skipped", date(task.day));
    // else: left todo, so overdue
  }
  for (let d = 1; d < t; d += 3) editNote(s, `day:${date(d)}`, date(d));
}

export type ScenarioName =
  "beforeStart" | "week4" | "week4Shifted" | "week12" | "week16" | "afterEnd";

export interface Scenario {
  snapshot: Snapshot;
  today: string;
}

/** Day number of `today` in each scenario. */
export const SCENARIO_DAY: Record<ScenarioName, number> = {
  beforeStart: -2,
  week4: 24,
  week4Shifted: 24,
  week12: 80,
  week16: 110,
  afterEnd: 125,
};

export function scenario(name: ScenarioName): Scenario {
  const { path, hash: pathHash } = fixturePath();
  const snapshot = emptySnapshot(structuredClone(path), FIXTURE_START, pathHash);
  const t = SCENARIO_DAY[name];
  const today = addDays(FIXTURE_START, t - 1);
  if (t > 1) seedHistory(snapshot, Math.min(t, 119));

  if (name === "week4Shifted") {
    // A reload removed two Tasks; one of them had a Note. Then a +2 shift today.
    const [first, second] = snapshot.path.blocks[1]!.tasks.filter((x) => x.day > t);
    tombstone(snapshot, first!.id, "2026-09-29T08:00:00.000Z");
    tombstone(snapshot, second!.id, "2026-09-29T08:00:00.000Z");
    editNote(snapshot, `task:${first!.id}`, addDays(today, -1));
    snapshot.reloadedAt = "2026-09-29T08:00:00.000Z";
    applyShift(snapshot, 2, today, "2026-09-30T08:00:00.000Z");
  }
  return { snapshot, today };
}
