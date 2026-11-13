/** Enrollment persistence and snapshot assembly (spec §4, §8.3). */
import { randomUUID } from "node:crypto";
import {
  allTasks,
  undoableShift,
  type EnrollmentSummary,
  type LearningPath,
  type NoteMeta,
  type Shift,
  type Snapshot,
  type TaskStateRecord,
  type Tombstone,
} from "@learning-tracker/core";
import {
  bumpAppStateVersion,
  bumpEnrollmentVersion,
  getSettings,
  setActiveEnrollmentId,
  transaction,
  type Db,
} from "../db/index.js";
import { ApiError, notFound } from "../errors.js";

interface EnrollmentRow {
  id: string;
  path_id: string;
  path_json: string;
  path_hash: string;
  start_date: string;
  created_at: string;
  loaded_at: string;
  reloaded_at: string | null;
  state_version: number;
}

const nowIso = () => new Date().toISOString();

function row(db: Db, id: string): EnrollmentRow {
  const r = db.prepare("SELECT * FROM enrollments WHERE id = ?").get(id) as
    EnrollmentRow | undefined;
  if (!r) throw notFound(`Enrollment ${id}`);
  return r;
}

export function enrollmentExists(db: Db, id: string): boolean {
  return db.prepare("SELECT 1 FROM enrollments WHERE id = ?").get(id) !== undefined;
}

/** Create an Enrollment from a loaded path and make it active. */
export function createEnrollment(
  db: Db,
  input: { path: LearningPath; hash: string; startDate: string },
): Snapshot {
  const id = randomUUID();
  const now = nowIso();
  transaction(db, () => {
    db.prepare(
      `INSERT INTO enrollments (id, path_id, path_json, path_hash, start_date, created_at, loaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.path.id, JSON.stringify(input.path), input.hash, input.startDate, now, now);
    setActiveEnrollmentId(db, id);
    bumpEnrollmentVersion(db, id);
  });
  return snapshot(db, id);
}

/** Changing the start date re-anchors every Task; statuses and offsets stay (spec §4.2). */
export function setStartDate(db: Db, id: string, startDate: string): Snapshot {
  transaction(db, () => {
    row(db, id);
    db.prepare("UPDATE enrollments SET start_date = ? WHERE id = ?").run(startDate, id);
    bumpEnrollmentVersion(db, id);
  });
  return snapshot(db, id);
}

/** Delete an Enrollment and everything under it. Deleting the active one leaves none active. */
export function deleteEnrollment(db: Db, id: string): void {
  transaction(db, () => {
    row(db, id);
    db.prepare("DELETE FROM enrollments WHERE id = ?").run(id);
    if (getSettings(db).activeEnrollmentId === id) setActiveEnrollmentId(db, null);
    bumpAppStateVersion(db);
  });
}

export function setActive(db: Db, id: string | null): void {
  transaction(db, () => {
    if (id !== null) row(db, id);
    setActiveEnrollmentId(db, id);
    bumpAppStateVersion(db);
  });
}

/**
 * Set one Task's status (spec §4.2, §8.3). `todo` clears `statusDate` but keeps the record and
 * its offset. A tombstoned Task is frozen (409); an id in neither the path nor the tombstones is
 * a 404.
 */
export function setTaskState(
  db: Db,
  id: string,
  taskId: string,
  status: TaskStateRecord["status"],
  statusDate: string | null,
): { record: TaskStateRecord; stateVersion: number } {
  return transaction(db, () => {
    const r = row(db, id);
    const removed = db
      .prepare("SELECT 1 FROM tombstones WHERE enrollment_id = ? AND task_id = ?")
      .get(id, taskId);
    if (removed)
      throw new ApiError(409, "task-removed", `Task ${taskId} was removed from the path`);
    const path = JSON.parse(r.path_json) as LearningPath;
    if (!allTasks(path).some((p) => p.task.id === taskId)) throw notFound(`Task ${taskId}`);

    const date = status === "todo" ? null : statusDate;
    const updatedAt = nowIso();
    const saved = db
      .prepare(
        `INSERT INTO task_states (enrollment_id, task_id, status, status_date, offset_days, updated_at)
         VALUES (?, ?, ?, ?, 0, ?)
         ON CONFLICT (enrollment_id, task_id) DO UPDATE SET
           status = excluded.status, status_date = excluded.status_date, updated_at = excluded.updated_at
         RETURNING offset_days`,
      )
      .get(id, taskId, status, date, updatedAt) as { offset_days: number };
    const { stateVersion } = bumpEnrollmentVersion(db, id);
    return {
      record: { taskId, status, statusDate: date, offsetDays: saved.offset_days, updatedAt },
      stateVersion,
    };
  });
}

export function listEnrollments(db: Db): EnrollmentSummary[] {
  const rows = db
    .prepare("SELECT * FROM enrollments ORDER BY created_at, id")
    .all() as unknown as EnrollmentRow[];
  return rows.map((r) => {
    const path = JSON.parse(r.path_json) as LearningPath;
    return {
      id: r.id,
      pathId: r.path_id,
      title: path.title,
      startDate: r.start_date,
      createdAt: r.created_at,
      taskCount: allTasks(path).length,
    };
  });
}

/** Assemble the §8.3 snapshot. */
export function snapshot(db: Db, id: string): Snapshot {
  const r = row(db, id);

  const taskStates = (
    db
      .prepare(
        `SELECT task_id, status, status_date, offset_days, updated_at
         FROM task_states WHERE enrollment_id = ? ORDER BY task_id`,
      )
      .all(id) as {
      task_id: string;
      status: TaskStateRecord["status"];
      status_date: string | null;
      offset_days: number;
      updated_at: string;
    }[]
  ).map((s): TaskStateRecord => ({
    taskId: s.task_id,
    status: s.status,
    statusDate: s.status_date,
    offsetDays: s.offset_days,
    updatedAt: s.updated_at,
  }));

  const shiftRows = (
    db
      .prepare(
        "SELECT id, applied_on, days, task_ids, created_at FROM shifts WHERE enrollment_id = ? ORDER BY id",
      )
      .all(id) as {
      id: number;
      applied_on: string;
      days: number;
      task_ids: string;
      created_at: string;
    }[]
  ).map((s) => ({
    id: s.id,
    appliedOn: s.applied_on,
    days: s.days,
    taskIds: JSON.parse(s.task_ids) as string[],
    createdAt: s.created_at,
  }));
  const undoable = undoableShift({ shifts: shiftRows, reloadedAt: r.reloaded_at });
  const shifts: Shift[] = shiftRows.map((s) => ({ ...s, undoable: s.id === undoable?.id }));

  const tombstones = (
    db
      .prepare(
        "SELECT task_id, title, kind, former_day, removed_at FROM tombstones WHERE enrollment_id = ? ORDER BY former_day, task_id",
      )
      .all(id) as {
      task_id: string;
      title: string;
      kind: Tombstone["kind"];
      former_day: number;
      removed_at: string;
    }[]
  ).map((t): Tombstone => ({
    taskId: t.task_id,
    title: t.title,
    kind: t.kind,
    formerDay: t.former_day,
    removedAt: t.removed_at,
  }));

  const edits = new Map<string, string[]>();
  for (const e of db
    .prepare("SELECT target, edited_on FROM note_edits WHERE enrollment_id = ? ORDER BY edited_on")
    .all(id) as { target: string; edited_on: string }[]) {
    const list = edits.get(e.target) ?? [];
    list.push(e.edited_on);
    edits.set(e.target, list);
  }
  const noteMeta = (
    db
      .prepare(
        `SELECT target, from_template, length(body) AS length, created_at, updated_at
         FROM notes WHERE enrollment_id = ? ORDER BY target`,
      )
      .all(id) as {
      target: string;
      from_template: number;
      length: number;
      created_at: string;
      updated_at: string;
    }[]
  ).map((n): NoteMeta => ({
    target: n.target,
    fromTemplate: n.from_template === 1,
    editedOn: edits.get(n.target) ?? [],
    length: n.length,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  }));

  return {
    id: r.id,
    pathId: r.path_id,
    pathHash: r.path_hash,
    startDate: r.start_date,
    createdAt: r.created_at,
    loadedAt: r.loaded_at,
    reloadedAt: r.reloaded_at,
    stateVersion: r.state_version,
    path: JSON.parse(r.path_json) as LearningPath,
    taskStates,
    shifts,
    tombstones,
    noteMeta,
  };
}
