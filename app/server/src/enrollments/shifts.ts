/** Schedule Shift and undo (spec §4.2, §8.3). */
import { allTasks, undoableShift, type LearningPath, type Snapshot } from "@learning-tracker/core";
import { bumpEnrollmentVersion, transaction, type Db } from "../db/index.js";
import { ApiError, notFound } from "../errors.js";
import { snapshot } from "./repo.js";

interface ShiftRow {
  id: number;
  applied_on: string;
  days: number;
  task_ids: string;
  created_at: string;
}

function pathOf(db: Db, id: string): { path: LearningPath; reloadedAt: string | null } {
  const r = db.prepare("SELECT path_json, reloaded_at FROM enrollments WHERE id = ?").get(id) as
    { path_json: string; reloaded_at: string | null } | undefined;
  if (!r) throw notFound(`Enrollment ${id}`);
  return { path: JSON.parse(r.path_json) as LearningPath, reloadedAt: r.reloaded_at };
}

/**
 * Move every live `todo` Task (overdue, future and optional alike) forward `days`, creating
 * records where needed, and log the shift with the ids it moved.
 */
export function applyShift(db: Db, id: string, days: number, appliedOn: string): Snapshot {
  transaction(db, () => {
    const { path } = pathOf(db, id);
    const status = new Map(
      (
        db.prepare("SELECT task_id, status FROM task_states WHERE enrollment_id = ?").all(id) as {
          task_id: string;
          status: string;
        }[]
      ).map((r) => [r.task_id, r.status]),
    );
    const moved = allTasks(path)
      .map((p) => p.task.id)
      .filter((taskId) => (status.get(taskId) ?? "todo") === "todo");
    const now = new Date().toISOString();
    const upsert = db.prepare(
      `INSERT INTO task_states (enrollment_id, task_id, status, status_date, offset_days, updated_at)
       VALUES (?, ?, 'todo', NULL, ?, ?)
       ON CONFLICT (enrollment_id, task_id) DO UPDATE SET
         offset_days = offset_days + excluded.offset_days, updated_at = excluded.updated_at`,
    );
    for (const taskId of moved) upsert.run(id, taskId, days, now);
    db.prepare(
      "INSERT INTO shifts (enrollment_id, applied_on, days, task_ids, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, appliedOn, days, JSON.stringify(moved), now);
    bumpEnrollmentVersion(db, id);
  });
  return snapshot(db, id);
}

/**
 * Undo the latest shift if it is undoable: subtract its `days` from the offsets of its `taskIds`,
 * whatever their status now, and delete its row. Statuses never change.
 */
export function undoLatestShift(db: Db, id: string): Snapshot {
  transaction(db, () => {
    const { reloadedAt } = pathOf(db, id);
    const rows = (
      db
        .prepare(
          "SELECT id, applied_on, days, task_ids, created_at FROM shifts WHERE enrollment_id = ?",
        )
        .all(id) as unknown as ShiftRow[]
    ).map((r) => ({
      id: r.id,
      appliedOn: r.applied_on,
      days: r.days,
      taskIds: JSON.parse(r.task_ids) as string[],
      createdAt: r.created_at,
    }));
    const latest = undoableShift({ shifts: rows, reloadedAt });
    if (!latest) throw new ApiError(409, "nothing-to-undo", "There is no shift to undo.");
    const now = new Date().toISOString();
    const update = db.prepare(
      `UPDATE task_states SET offset_days = offset_days - ?, updated_at = ?
       WHERE enrollment_id = ? AND task_id = ?`,
    );
    for (const taskId of latest.taskIds) {
      update.run(latest.days, now, id, taskId);
    }
    db.prepare("DELETE FROM shifts WHERE id = ?").run(latest.id);
    bumpEnrollmentVersion(db, id);
  });
  return snapshot(db, id);
}
