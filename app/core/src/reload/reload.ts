/**
 * Reload reconciliation (spec §6). `diffReload` is pure in `(snapshot, newPath)` and drives both
 * the preview and the apply: the categories the learner sees and the plan of record changes.
 */
import type { Snapshot } from "../api/snapshot.js";
import { daysBetween } from "../dates/dates.js";
import { allTasks, type PlacedTask } from "../path/helpers.js";
import type { Block, LearningPath, Task, TaskKind } from "../path/types.js";
import { canonicalJson } from "../path/hash.js";

export interface ReloadTaskRef {
  taskId: string;
  title: string;
  kind: TaskKind;
}

export interface AddedTask extends ReloadTaskRef {
  day: number;
  dueDay: number;
  optional: boolean;
}

export interface RemovedTask extends ReloadTaskRef {
  formerDay: number;
  /**
   * It has progress (a status other than `todo`) or a Note, so it becomes a tombstone ("will be
   * kept hidden"). A `todo` record that only holds a shift offset is not progress.
   */
  keptHidden: boolean;
}

export interface MovedTask extends ReloadTaskRef {
  from: { day: number; dueDay: number };
  to: { day: number; dueDay: number };
}

export type TaskField =
  "title" | "description" | "kind" | "optional" | "links" | "noteTemplate" | "block";

export interface ChangedTask extends ReloadTaskRef {
  fields: TaskField[];
}

export type PathField =
  "title" | "version" | "description" | "weekRhythm" | "startWeekday" | "resources" | "blocks";

export interface PathChange {
  field: PathField;
  /** A short human summary, e.g. `"v1" → "v2"` or `6 → 7 blocks`. */
  detail: string;
}

export interface ReloadDiff {
  added: AddedTask[];
  removed: RemovedTask[];
  restored: ReloadTaskRef[];
  moved: MovedTask[];
  changed: ChangedTask[];
  pathChanges: PathChange[];
  /** The plan of record changes the apply makes. */
  plan: {
    /** Removed Tasks with a record or Note: written as tombstones. */
    newTombstones: { taskId: string; title: string; kind: TaskKind; formerDay: number }[];
    /** Tombstones deleted because their id is back; their saved state takes effect again. */
    restoredIds: string[];
    /** Removed Tasks whose only record is a `todo` one (a shift offset): deleted with the Task. */
    droppedRecordIds: string[];
    /** Added Tasks get a record with this offset when it is > 0: the sum of all logged shifts. */
    addedOffset: number;
    addedIds: string[];
  };
}

const ref = (t: Task): ReloadTaskRef => ({ taskId: t.id, title: t.title, kind: t.kind });
const dueOf = (t: Task) => t.dueDay ?? t.day;
const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

export function diffReload(snapshot: Snapshot, newPath: LearningPath): ReloadDiff {
  const oldTasks = new Map<string, PlacedTask>(allTasks(snapshot.path).map((p) => [p.task.id, p]));
  const newTasks = allTasks(newPath);
  const newIds = new Set(newTasks.map((p) => p.task.id));
  const tombstoned = new Set(snapshot.tombstones.map((t) => t.taskId));
  const records = new Map(snapshot.taskStates.map((r) => [r.taskId, r]));
  const hasProgress = (id: string) => (records.get(id)?.status ?? "todo") !== "todo";
  const hasNote = new Set(
    snapshot.noteMeta.filter((n) => n.target.startsWith("task:")).map((n) => n.target.slice(5)),
  );
  const addedOffset = snapshot.shifts.reduce((sum, s) => sum + s.days, 0);

  const added: AddedTask[] = [];
  const restored: ReloadTaskRef[] = [];
  const moved: MovedTask[] = [];
  const changed: ChangedTask[] = [];

  for (const { task, blockIndex } of newTasks) {
    const old = oldTasks.get(task.id);
    if (!old) {
      if (tombstoned.has(task.id)) restored.push(ref(task));
      else
        added.push({
          ...ref(task),
          day: task.day,
          dueDay: dueOf(task),
          optional: task.optional === true,
        });
      continue;
    }
    const o = old.task;
    if (o.day !== task.day || dueOf(o) !== dueOf(task)) {
      moved.push({
        ...ref(task),
        from: { day: o.day, dueDay: dueOf(o) },
        to: { day: task.day, dueDay: dueOf(task) },
      });
    }
    const fields: TaskField[] = [];
    if (o.title !== task.title) fields.push("title");
    if (!same(o.description, task.description)) fields.push("description");
    if (o.kind !== task.kind) fields.push("kind");
    if ((o.optional === true) !== (task.optional === true)) fields.push("optional");
    if (!same(o.links, task.links)) fields.push("links");
    if (!same(o.noteTemplate, task.noteTemplate)) fields.push("noteTemplate");
    if (old.blockIndex !== blockIndex) fields.push("block");
    if (fields.length) changed.push({ ...ref(task), fields });
  }

  const removed: RemovedTask[] = [];
  for (const { task } of allTasks(snapshot.path)) {
    if (newIds.has(task.id)) continue;
    removed.push({
      ...ref(task),
      formerDay: task.day,
      keptHidden: hasProgress(task.id) || hasNote.has(task.id),
    });
  }

  return {
    added,
    removed,
    restored,
    moved,
    changed,
    pathChanges: pathChanges(snapshot.path, newPath),
    plan: {
      newTombstones: removed
        .filter((r) => r.keptHidden)
        .map(({ taskId, title, kind, formerDay }) => ({ taskId, title, kind, formerDay })),
      restoredIds: restored.map((r) => r.taskId),
      droppedRecordIds: removed
        .filter((r) => !r.keptHidden && records.has(r.taskId))
        .map((r) => r.taskId),
      addedOffset,
      addedIds: added.map((a) => a.taskId),
    },
  };
}

function quote(v: unknown): string {
  return v === undefined || v === null ? "none" : `“${String(v)}”`;
}

function pathChanges(a: LearningPath, b: LearningPath): PathChange[] {
  const out: PathChange[] = [];
  const scalar = (field: "title" | "version" | "description" | "startWeekday") => {
    if (a[field] !== b[field])
      out.push({ field, detail: `${quote(a[field])} → ${quote(b[field])}` });
  };
  scalar("title");
  scalar("version");
  if (a.description !== b.description) out.push({ field: "description", detail: "edited" });
  if (!same(a.weekRhythm, b.weekRhythm)) {
    out.push({
      field: "weekRhythm",
      detail: `${(a.weekRhythm ?? []).join(", ") || "none"} → ${(b.weekRhythm ?? []).join(", ") || "none"}`,
    });
  }
  scalar("startWeekday");
  if (!same(a.resources, b.resources)) {
    const n = (p: LearningPath) => p.resources?.length ?? 0;
    out.push({
      field: "resources",
      detail: n(a) === n(b) ? `${n(b)} resources, edited` : `${n(a)} → ${n(b)} resources`,
    });
  }
  out.push(...blockChanges(a.blocks, b.blocks));
  return out;
}

function blockChanges(a: Block[], b: Block[]): PathChange[] {
  const out: PathChange[] = [];
  if (a.length !== b.length)
    out.push({ field: "blocks", detail: `${a.length} → ${b.length} blocks` });
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.title !== y.title)
      out.push({
        field: "blocks",
        detail: `block ${i + 1} title ${quote(x.title)} → ${quote(y.title)}`,
      });
    if (x.goal !== y.goal) out.push({ field: "blocks", detail: `block ${i + 1} goal edited` });
  }
  return out;
}

/** True when the diff holds nothing to show (a hash change from formatting alone). */
export function isEmptyDiff(d: ReloadDiff): boolean {
  return (
    !d.added.length &&
    !d.removed.length &&
    !d.restored.length &&
    !d.moved.length &&
    !d.changed.length &&
    !d.pathChanges.length
  );
}

/**
 * How many added Tasks would be overdue on `today` once added (required, past their due day
 * shifted by the added offset). Needs `today`, so the client computes it (spec §8.1).
 */
export function addedOverdueCount(
  snapshot: Pick<Snapshot, "startDate">,
  diff: ReloadDiff,
  today: string,
): number {
  const t = daysBetween(snapshot.startDate, today) + 1;
  return diff.added.filter((a) => !a.optional && t > a.dueDay + diff.plan.addedOffset).length;
}
