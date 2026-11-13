/** JSON Backup and restore (spec §9.2, §8.4, §8.6). The format and checks live in `core`. */
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  backupJson,
  backupSourceHash,
  backupSummary,
  buildBackup,
  validateBackup,
  type Backup,
  type BackupEnrollment,
  type LearningPath,
  type RestorePreviewResponse,
} from "@learning-tracker/core";
import {
  bumpAppStateVersion,
  getSettings,
  setActiveEnrollmentId,
  setLastBackupAt,
  transaction,
  type Db,
} from "../db/index.js";
import { snapshot } from "../enrollments/repo.js";
import { ApiError } from "../errors.js";

/** Everything in the database as a Backup. */
export function readBackup(db: Db, appVersion: string, now = new Date()): Backup {
  const ids = (
    db.prepare("SELECT id FROM enrollments ORDER BY created_at, id").all() as { id: string }[]
  ).map((r) => r.id);
  const enrollments = ids.map((id): BackupEnrollment => {
    const s = snapshot(db, id);
    const notes = db.prepare("SELECT target, body FROM notes WHERE enrollment_id = ?").all(id) as {
      target: string;
      body: string;
    }[];
    const bodies = new Map(notes.map((n) => [n.target, n.body]));
    return {
      id: s.id,
      createdAt: s.createdAt,
      startDate: s.startDate,
      loadedAt: s.loadedAt,
      reloadedAt: s.reloadedAt,
      path: s.path,
      pathHash: s.pathHash,
      taskStates: s.taskStates,
      shifts: s.shifts.map(({ appliedOn, days, taskIds, createdAt }) => ({
        appliedOn,
        days,
        taskIds,
        createdAt,
      })),
      notes: s.noteMeta.map((n) => ({
        target: n.target,
        body: bodies.get(n.target) ?? "",
        fromTemplate: n.fromTemplate,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        editedOn: n.editedOn,
      })),
      tombstones: s.tombstones,
    };
  });
  return buildBackup({
    exportedAt: now.toISOString(),
    appVersion,
    activeEnrollmentId: getSettings(db).activeEnrollmentId,
    enrollments,
  });
}

/** `lastBackupAt` is set once the download has been fully sent (spec §8.6). */
export function markBackedUp(db: Db, at = new Date()): void {
  transaction(db, () => {
    setLastBackupAt(db, at.toISOString());
    bumpAppStateVersion(db);
  });
}

/** Validate a Backup's text, or throw 422 with every issue. Writes nothing. */
function validOrThrow(text: string): Backup {
  const check = validateBackup(text);
  if (!check.ok) throw new ApiError(422, check.code, check.message, check.issues);
  return check.backup;
}

/** Stateless preview: the Backup beside the current data, both at `today`. */
export function previewRestore(
  db: Db,
  text: string,
  today: string,
  appVersion: string,
): RestorePreviewResponse {
  const backup = validOrThrow(text);
  return {
    summary: {
      backup: backupSummary(backup, today),
      current: backupSummary(readBackup(db, appVersion), today),
    },
    sourceHash: backupSourceHash(text),
    stateVersion: getSettings(db).appStateVersion,
  };
}

const COPY_PATTERN = /^pre-restore-(\d{8}T\d{9}Z)\.json$/;
const stamp = (d: Date) => d.toISOString().replace(/[-:.]/g, "");

/**
 * Write the current data as a Backup to `<dataDir>/pre-restore-<timestamp>.json` and keep the
 * newest `keep` (spec §9.2, §13.7). Names are unique: a clash moves the stamp on by 1 ms.
 */
export function writeRestoreSafetyCopy(
  db: Db,
  dataDir: string,
  appVersion: string,
  { keep = 3, now = new Date() }: { keep?: number; now?: Date } = {},
): string {
  let t = now.getTime();
  let file = path.join(dataDir, `pre-restore-${stamp(new Date(t))}.json`);
  while (existsSync(file)) file = path.join(dataDir, `pre-restore-${stamp(new Date(++t))}.json`);
  writeFileSync(file, backupJson(readBackup(db, appVersion, now)));

  const copies = readdirSync(dataDir)
    .filter((name) => COPY_PATTERN.test(name))
    .sort()
    .reverse();
  for (const old of copies.slice(keep)) rmSync(path.join(dataDir, old), { force: true });
  return file;
}

/**
 * Restore (spec §9.2): validate, check the preview's expectations (409 `preview-stale`), write
 * the pre-restore Safety Copy, then replace everything in one transaction. Any failure in the
 * transaction leaves the old data as it was.
 */
export function applyRestore(
  db: Db,
  dataDir: string,
  text: string,
  expected: { sourceHash: string; stateVersion: number },
  appVersion: string,
): void {
  const backup = validOrThrow(text);
  if (
    backupSourceHash(text) !== expected.sourceHash ||
    getSettings(db).appStateVersion !== expected.stateVersion
  ) {
    throw new ApiError(
      409,
      "preview-stale",
      "Something changed since the preview. Review the restore again.",
    );
  }

  writeRestoreSafetyCopy(db, dataDir, appVersion);

  transaction(db, () => {
    db.exec("DELETE FROM enrollments"); // Child rows go with it (ON DELETE CASCADE).
    const enroll = db.prepare(
      `INSERT INTO enrollments (id, path_id, path_json, path_hash, start_date, created_at, loaded_at, reloaded_at, state_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    );
    const state = db.prepare(
      `INSERT INTO task_states (enrollment_id, task_id, status, status_date, offset_days, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const shift = db.prepare(
      `INSERT INTO shifts (enrollment_id, applied_on, days, task_ids, created_at) VALUES (?, ?, ?, ?, ?)`,
    );
    const note = db.prepare(
      `INSERT INTO notes (enrollment_id, target, body, from_template, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const edit = db.prepare(
      "INSERT OR IGNORE INTO note_edits (enrollment_id, target, edited_on) VALUES (?, ?, ?)",
    );
    const stone = db.prepare(
      `INSERT INTO tombstones (enrollment_id, task_id, title, kind, former_day, removed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    for (const e of backup.enrollments) {
      const p: LearningPath = e.path;
      enroll.run(
        e.id,
        p.id,
        JSON.stringify(p),
        e.pathHash,
        e.startDate,
        e.createdAt,
        e.loadedAt,
        e.reloadedAt,
      );
      for (const s of e.taskStates) {
        state.run(e.id, s.taskId, s.status, s.statusDate, s.offsetDays, s.updatedAt);
      }
      // In order, so ids (and with them "the most recent shift") keep the Backup's order.
      for (const s of e.shifts) {
        shift.run(e.id, s.appliedOn, s.days, JSON.stringify(s.taskIds), s.createdAt);
      }
      for (const n of e.notes) {
        note.run(e.id, n.target, n.body, n.fromTemplate ? 1 : 0, n.createdAt, n.updatedAt);
        for (const d of n.editedOn) edit.run(e.id, n.target, d);
      }
      for (const t of e.tombstones) {
        stone.run(e.id, t.taskId, t.title, t.kind, t.formerDay, t.removedAt);
      }
    }
    setActiveEnrollmentId(db, backup.activeEnrollmentId);
    setLastBackupAt(db, backup.exportedAt);
    bumpAppStateVersion(db);
  });
}
