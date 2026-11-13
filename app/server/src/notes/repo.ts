/** Note persistence (spec §4.2 Notes, §8.3 Note routes). */
import {
  allTasks,
  isDate,
  type LearningPath,
  type NoteBody,
  type NoteMeta,
} from "@learning-tracker/core";
import { bumpEnrollmentVersion, transaction, type Db } from "../db/index.js";
import { notFound } from "../errors.js";

const nowIso = () => new Date().toISOString();

/**
 * Throw 404 unless the Enrollment exists and `target` names something a Note can hang on:
 * a live or tombstoned Task, a real calendar date, or the Enrollment itself.
 */
export function requireTarget(db: Db, id: string, target: string): void {
  const r = db.prepare("SELECT path_json FROM enrollments WHERE id = ?").get(id) as
    { path_json: string } | undefined;
  if (!r) throw notFound(`Enrollment ${id}`);
  if (target === "enrollment") return;
  if (target.startsWith("day:") && isDate(target.slice(4))) return;
  if (target.startsWith("task:")) {
    const taskId = target.slice(5);
    const path = JSON.parse(r.path_json) as LearningPath;
    if (allTasks(path).some((p) => p.task.id === taskId)) return;
    const removed = db
      .prepare("SELECT 1 FROM tombstones WHERE enrollment_id = ? AND task_id = ?")
      .get(id, taskId);
    if (removed) return;
  }
  throw notFound(`Note target ${target}`);
}

export function listNotes(db: Db, id: string): NoteBody[] {
  if (!db.prepare("SELECT 1 FROM enrollments WHERE id = ?").get(id)) {
    throw notFound(`Enrollment ${id}`);
  }
  return db
    .prepare("SELECT target, body FROM notes WHERE enrollment_id = ? ORDER BY target")
    .all(id) as unknown as NoteBody[];
}

function noteMeta(db: Db, id: string, target: string): NoteMeta {
  const n = db
    .prepare(
      `SELECT from_template, length(body) AS length, created_at, updated_at
       FROM notes WHERE enrollment_id = ? AND target = ?`,
    )
    .get(id, target) as {
    from_template: number;
    length: number;
    created_at: string;
    updated_at: string;
  };
  const editedOn = (
    db
      .prepare(
        "SELECT edited_on FROM note_edits WHERE enrollment_id = ? AND target = ? ORDER BY edited_on",
      )
      .all(id, target) as { edited_on: string }[]
  ).map((e) => e.edited_on);
  return {
    target,
    fromTemplate: n.from_template === 1,
    editedOn,
    length: n.length,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  };
}

/**
 * Save a Note's whole body (last write wins). `fromTemplate` is recorded only when this save
 * creates the Note. `editedOn` joins the edit-date trail once.
 */
export function putNote(
  db: Db,
  id: string,
  target: string,
  input: { body: string; editedOn: string; fromTemplate?: boolean | undefined },
): { meta: NoteMeta; stateVersion: number } {
  return transaction(db, () => {
    requireTarget(db, id, target);
    const now = nowIso();
    db.prepare(
      `INSERT INTO notes (enrollment_id, target, body, from_template, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (enrollment_id, target) DO UPDATE SET
         body = excluded.body, updated_at = excluded.updated_at`,
    ).run(id, target, input.body, input.fromTemplate ? 1 : 0, now, now);
    db.prepare(
      "INSERT OR IGNORE INTO note_edits (enrollment_id, target, edited_on) VALUES (?, ?, ?)",
    ).run(id, target, input.editedOn);
    const { stateVersion } = bumpEnrollmentVersion(db, id);
    return { meta: noteMeta(db, id, target), stateVersion };
  });
}

/** Delete a Note and its edit-date trail (spec §13 decision 3). 404 when there is no Note. */
export function deleteNote(db: Db, id: string, target: string): { stateVersion: number } {
  return transaction(db, () => {
    requireTarget(db, id, target);
    const gone = db
      .prepare("DELETE FROM notes WHERE enrollment_id = ? AND target = ?")
      .run(id, target);
    if (gone.changes === 0) throw notFound(`Note ${target}`);
    db.prepare("DELETE FROM note_edits WHERE enrollment_id = ? AND target = ?").run(id, target);
    return { stateVersion: bumpEnrollmentVersion(db, id).stateVersion };
  });
}
