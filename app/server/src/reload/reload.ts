/** Reload an Enrollment's path copy (spec §6, §8.4). */
import {
  diffReload,
  type LearningPath,
  type ReloadPreviewResponse,
  type Snapshot,
} from "@learning-tracker/core";
import { bumpEnrollmentVersion, transaction, type Db } from "../db/index.js";
import { snapshot } from "../enrollments/repo.js";
import { ApiError } from "../errors.js";

export interface LoadedSource {
  path: LearningPath;
  hash: string;
}

function requireSamePath(current: Snapshot, next: LearningPath) {
  if (next.id !== current.pathId) {
    throw new ApiError(
      409,
      "path-id-mismatch",
      `This file is for path "${next.id}", but the enrollment follows "${current.pathId}".`,
    );
  }
}

/** Stateless preview: the diff, the source hash and the current `stateVersion`. Writes nothing. */
export function previewReload(db: Db, id: string, source: LoadedSource): ReloadPreviewResponse {
  const current = snapshot(db, id);
  requireSamePath(current, source.path);
  if (source.hash === current.pathHash) return { unchanged: true };
  return {
    diff: diffReload(current, source.path),
    sourceHash: source.hash,
    stateVersion: current.stateVersion,
  };
}

/**
 * Apply a reload in one transaction. The diff is recomputed here; if the file or the Enrollment
 * changed since the preview, nothing is written and the client gets 409 `preview-stale`.
 */
export function applyReload(
  db: Db,
  id: string,
  source: LoadedSource,
  expected: { sourceHash: string; stateVersion: number },
): Snapshot {
  transaction(db, () => {
    const current = snapshot(db, id);
    requireSamePath(current, source.path);
    if (source.hash !== expected.sourceHash || current.stateVersion !== expected.stateVersion) {
      throw new ApiError(
        409,
        "preview-stale",
        "Something changed since the preview. Review the reload again.",
      );
    }
    if (source.hash === current.pathHash) return; // "No changes": nothing to write.

    const { plan } = diffReload(current, source.path);
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE enrollments SET path_json = ?, path_hash = ?, reloaded_at = ? WHERE id = ?",
    ).run(JSON.stringify(source.path), source.hash, now, id);

    const stone = db.prepare(
      `INSERT OR REPLACE INTO tombstones (enrollment_id, task_id, title, kind, former_day, removed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const t of plan.newTombstones) stone.run(id, t.taskId, t.title, t.kind, t.formerDay, now);

    const unstone = db.prepare("DELETE FROM tombstones WHERE enrollment_id = ? AND task_id = ?");
    for (const taskId of plan.restoredIds) unstone.run(id, taskId);

    const drop = db.prepare("DELETE FROM task_states WHERE enrollment_id = ? AND task_id = ?");
    for (const taskId of plan.droppedRecordIds) drop.run(id, taskId);

    if (plan.addedOffset > 0) {
      const record = db.prepare(
        `INSERT INTO task_states (enrollment_id, task_id, status, status_date, offset_days, updated_at)
         VALUES (?, ?, 'todo', NULL, ?, ?) ON CONFLICT (enrollment_id, task_id) DO NOTHING`,
      );
      for (const taskId of plan.addedIds) record.run(id, taskId, plan.addedOffset, now);
    }
    bumpEnrollmentVersion(db, id);
  });
  return snapshot(db, id);
}
