import type { Db } from "./db.js";

/** The `settings` table (spec §4.1). A missing row means the default (`null` / 0). */
export interface Settings {
  activeEnrollmentId: string | null;
  lastBackupAt: string | null;
  appStateVersion: number;
}

type Key = keyof Settings;

function read(db: Db, key: Key): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    { value: string } | undefined;
  return row?.value;
}

function write(db: Db, key: Key, value: string | null) {
  if (value === null) db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  else {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    ).run(key, value);
  }
}

export function getSettings(db: Db): Settings {
  return {
    activeEnrollmentId: read(db, "activeEnrollmentId") ?? null,
    lastBackupAt: read(db, "lastBackupAt") ?? null,
    appStateVersion: Number(read(db, "appStateVersion") ?? 0),
  };
}

export function setActiveEnrollmentId(db: Db, id: string | null) {
  write(db, "activeEnrollmentId", id);
}

export function setLastBackupAt(db: Db, iso: string | null) {
  write(db, "lastBackupAt", iso);
}

/**
 * Every write anywhere bumps `appStateVersion` (spec §4.2). Call inside the write's transaction.
 * Returns the new value.
 */
export function bumpAppStateVersion(db: Db): number {
  const row = db
    .prepare(
      `INSERT INTO settings (key, value) VALUES ('appStateVersion', '1')
       ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
       RETURNING value`,
    )
    .get() as { value: string };
  return Number(row.value);
}

/**
 * A write to an Enrollment bumps its `state_version` and `appStateVersion` together. Call inside
 * the write's transaction. Throws if the Enrollment doesn't exist.
 */
export function bumpEnrollmentVersion(
  db: Db,
  enrollmentId: string,
): { stateVersion: number; appStateVersion: number } {
  const row = db
    .prepare(
      "UPDATE enrollments SET state_version = state_version + 1 WHERE id = ? RETURNING state_version",
    )
    .get(enrollmentId) as { state_version: number } | undefined;
  if (!row) throw new Error(`Unknown enrollment ${enrollmentId}`);
  return { stateVersion: row.state_version, appStateVersion: bumpAppStateVersion(db) };
}
