/**
 * The JSON Backup (spec §9.2): its schema, building it from stored state, validating a file
 * before a restore (with the format-migration chain), and the restore-preview summary. Pure.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { IssueJson } from "../api/contracts.js";
import { BACKUP_FORMAT_VERSION } from "../api/contracts.js";
import {
  NoteTarget,
  PlainDate,
  TaskKindSchema,
  TaskStatus,
  Timestamp,
  type NoteMeta,
  type Snapshot,
} from "../api/snapshot.js";
import { isDate } from "../dates/dates.js";
import { allTasks } from "../path/helpers.js";
import { loadPath } from "../path/load.js";
import type { LearningPath } from "../path/types.js";
import { stats, undoableShift } from "../signals/signals.js";

export const BACKUP_FORMAT = "learning-tracker-backup";

/** The path copy is checked by `loadPath`, not by this schema. */
const PathCopy = Type.Unsafe<LearningPath>({});

export const BackupTaskState = Type.Object({
  taskId: Type.String({ minLength: 1 }),
  status: TaskStatus,
  statusDate: Type.Union([PlainDate, Type.Null()]),
  offsetDays: Type.Integer(),
  updatedAt: Timestamp,
});

export const BackupShift = Type.Object({
  appliedOn: PlainDate,
  days: Type.Integer({ minimum: 1, maximum: 365 }),
  taskIds: Type.Array(Type.String({ minLength: 1 })),
  createdAt: Timestamp,
});

export const BackupNote = Type.Object({
  target: NoteTarget,
  body: Type.String(),
  fromTemplate: Type.Boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  editedOn: Type.Array(PlainDate),
});
export type BackupNote = Static<typeof BackupNote>;

export const BackupTombstone = Type.Object({
  taskId: Type.String({ minLength: 1 }),
  title: Type.String(),
  kind: TaskKindSchema,
  formerDay: Type.Integer(),
  removedAt: Timestamp,
});

export const BackupEnrollment = Type.Object({
  id: Type.String({ minLength: 1 }),
  createdAt: Timestamp,
  startDate: PlainDate,
  loadedAt: Timestamp,
  reloadedAt: Type.Union([Timestamp, Type.Null()]),
  path: PathCopy,
  pathHash: Type.String(),
  taskStates: Type.Array(BackupTaskState),
  shifts: Type.Array(BackupShift),
  notes: Type.Array(BackupNote),
  tombstones: Type.Array(BackupTombstone),
});
export type BackupEnrollment = Static<typeof BackupEnrollment>;

/** Format version 1. Unknown extra fields are ignored. */
export const Backup = Type.Object({
  format: Type.Literal(BACKUP_FORMAT),
  formatVersion: Type.Literal(BACKUP_FORMAT_VERSION),
  exportedAt: Timestamp,
  appVersion: Type.String(),
  activeEnrollmentId: Type.Union([Type.String(), Type.Null()]),
  enrollments: Type.Array(BackupEnrollment),
});
export type Backup = Static<typeof Backup>;

// ---------------------------------------------------------------- build

export interface BackupInput {
  exportedAt: string;
  appVersion: string;
  activeEnrollmentId: string | null;
  enrollments: BackupEnrollment[];
}

const byKey =
  <T>(key: (t: T) => string) =>
  (a: T, b: T) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

/** A Backup from stored state, with every list in a stable order so equal data gives equal files. */
export function buildBackup(input: BackupInput): Backup {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: input.exportedAt,
    appVersion: input.appVersion,
    activeEnrollmentId: input.activeEnrollmentId,
    enrollments: input.enrollments.map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      startDate: e.startDate,
      loadedAt: e.loadedAt,
      reloadedAt: e.reloadedAt,
      path: e.path,
      pathHash: e.pathHash,
      taskStates: [...e.taskStates].sort(byKey((s) => s.taskId)),
      shifts: e.shifts.map((s) => ({ ...s, taskIds: [...s.taskIds] })),
      notes: [...e.notes]
        .sort(byKey((n) => n.target))
        .map((n) => ({ ...n, editedOn: [...new Set(n.editedOn)].sort() })),
      tombstones: [...e.tombstones].sort(byKey((t) => t.taskId)),
    })),
  };
}

/** Pretty-printed, as the downloaded file. */
export const backupJson = (backup: Backup): string => `${JSON.stringify(backup, null, 2)}\n`;

export const backupFilename = (today: string) => `learning-tracker-backup_${today}.json`;

/** SHA-256 (hex) of a Backup file's text: the restore preview's `sourceHash` (spec §8.4). */
export const backupSourceHash = (text: string): string => bytesToHex(sha256(utf8ToBytes(text)));

// ---------------------------------------------------------------- validate

/**
 * Format migrations: `backupMigrations[v]` turns a version-v Backup into version v+1. Empty while
 * the format is at version 1; a v2 adds `{1: (b) => …}` and bumps `BACKUP_FORMAT_VERSION`.
 */
export const backupMigrations: Record<number, (backup: Record<string, unknown>) => unknown> = {};

export type BackupCheck =
  | { ok: true; backup: Backup; migratedFrom: number | null }
  | {
      ok: false;
      code: "backup-invalid" | "backup-too-new";
      message: string;
      issues: IssueJson[];
    };

const invalid = (issues: IssueJson[]): BackupCheck => ({
  ok: false,
  code: "backup-invalid",
  message:
    issues.length === 1 ? "The backup has 1 problem." : `The backup has ${issues.length} problems.`,
  issues,
});

const issue = (pointer: string, rule: string, message: string): IssueJson => ({
  pointer,
  rule,
  message,
});

/**
 * Everything a restore checks before writing anything (spec §9.2): format and version (older
 * versions are migrated forward), structure, every path copy against the current validator,
 * every reference, and the active id. Any problem refuses the whole file.
 */
export function validateBackup(
  text: string,
  migrations: Record<number, (b: Record<string, unknown>) => unknown> = backupMigrations,
  current: number = BACKUP_FORMAT_VERSION,
): BackupCheck {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return invalid([issue("", "json-syntax", `Not JSON: ${(e as Error).message}`)]);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalid([issue("", "backup-format", "A backup is a JSON object.")]);
  }
  let doc = value as Record<string, unknown>;
  if (doc.format !== BACKUP_FORMAT) {
    return invalid([
      issue(
        "/format",
        "backup-format",
        `Not a learning tracker backup (format must be "${BACKUP_FORMAT}").`,
      ),
    ]);
  }
  const version = doc.formatVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return invalid([
      issue("/formatVersion", "backup-format", "formatVersion must be a positive integer."),
    ]);
  }
  if (version > current) {
    return {
      ok: false,
      code: "backup-too-new",
      message: `This backup was made by a newer version of the app (format ${version}; this app reads up to ${current}).`,
      issues: [
        issue(
          "/formatVersion",
          "backup-too-new",
          `formatVersion ${version} is newer than ${current}.`,
        ),
      ],
    };
  }
  for (let v = version; v < current; v++) {
    const step = migrations[v];
    if (!step) {
      return invalid([
        issue("/formatVersion", "backup-format", `No migration from format ${v} to ${v + 1}.`),
      ]);
    }
    doc = step(doc) as Record<string, unknown>;
  }

  const structure = Value.Errors(Backup, doc).map((e) =>
    issue(e.instancePath, "schema", e.message ?? "invalid"),
  );
  if (structure.length > 0) return invalid(dedupe(structure));

  const backup = doc as unknown as Backup;
  const issues = [...checkEnrollments(backup)];
  if (issues.length > 0) return invalid(issues);
  return { ok: true, backup, migratedFrom: version < current ? version : null };
}

function dedupe(issues: IssueJson[]): IssueJson[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.pointer} ${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function* checkEnrollments(backup: Backup): Generator<IssueJson> {
  const ids = new Set<string>();
  for (const [i, e] of backup.enrollments.entries()) {
    const at = `/enrollments/${i}`;
    if (ids.has(e.id)) yield issue(`${at}/id`, "duplicate", `Enrollment id ${e.id} appears twice.`);
    ids.add(e.id);
    yield* checkEnrollment(e, at);
  }
  if (backup.activeEnrollmentId !== null && !ids.has(backup.activeEnrollmentId)) {
    yield issue(
      "/activeEnrollmentId",
      "reference",
      `activeEnrollmentId ${backup.activeEnrollmentId} names no enrollment in the backup.`,
    );
  }
}

function* checkEnrollment(e: BackupEnrollment, at: string): Generator<IssueJson> {
  if (!isDate(e.startDate))
    yield issue(`${at}/startDate`, "date", `${e.startDate} is not a calendar date.`);
  for (const [field, ts] of [
    ["createdAt", e.createdAt],
    ["loadedAt", e.loadedAt],
    ["reloadedAt", e.reloadedAt],
  ] as const) {
    if (ts !== null && Number.isNaN(Date.parse(ts))) {
      yield issue(`${at}/${field}`, "timestamp", `${ts} is not a timestamp.`);
    }
  }

  const loaded = loadPath(JSON.stringify(e.path), { source: "json" });
  if (!loaded.ok) {
    for (const p of loaded.issues) {
      yield { ...issue(`${at}/path${p.pointer}`, p.rule, p.message) };
    }
    return; // References can't be checked against an invalid path.
  }
  if (loaded.hash !== e.pathHash) {
    yield issue(`${at}/pathHash`, "path-hash", "pathHash doesn't match the path copy.");
  }

  const live = new Set(allTasks(loaded.path).map((p) => p.task.id));
  const removed = new Set<string>();
  for (const [j, t] of e.tombstones.entries()) {
    if (removed.has(t.taskId)) {
      yield issue(
        `${at}/tombstones/${j}/taskId`,
        "duplicate",
        `Removed task ${t.taskId} appears twice.`,
      );
    }
    if (live.has(t.taskId)) {
      yield issue(
        `${at}/tombstones/${j}/taskId`,
        "reference",
        `Task ${t.taskId} is marked removed but is still in the path.`,
      );
    }
    removed.add(t.taskId);
  }
  const known = (id: string) => live.has(id) || removed.has(id);

  const states = new Set<string>();
  for (const [j, s] of e.taskStates.entries()) {
    const p = `${at}/taskStates/${j}`;
    if (states.has(s.taskId))
      yield issue(`${p}/taskId`, "duplicate", `Task ${s.taskId} has two states.`);
    states.add(s.taskId);
    if (!known(s.taskId)) yield issue(`${p}/taskId`, "reference", `Unknown task ${s.taskId}.`);
    if (s.status === "todo" && s.statusDate !== null) {
      yield issue(`${p}/statusDate`, "status-date", "A todo task has no statusDate.");
    }
    if (s.status !== "todo" && (s.statusDate === null || !isDate(s.statusDate))) {
      yield issue(
        `${p}/statusDate`,
        "status-date",
        `A ${s.status} task needs a calendar statusDate.`,
      );
    }
  }

  for (const [j, s] of e.shifts.entries()) {
    const p = `${at}/shifts/${j}`;
    if (!isDate(s.appliedOn))
      yield issue(`${p}/appliedOn`, "date", `${s.appliedOn} is not a calendar date.`);
    if (Number.isNaN(Date.parse(s.createdAt))) {
      yield issue(`${p}/createdAt`, "timestamp", `${s.createdAt} is not a timestamp.`);
    }
    for (const [k, id] of s.taskIds.entries()) {
      if (!known(id)) yield issue(`${p}/taskIds/${k}`, "reference", `Unknown task ${id}.`);
    }
  }

  const targets = new Set<string>();
  for (const [j, n] of e.notes.entries()) {
    const p = `${at}/notes/${j}`;
    if (targets.has(n.target)) yield issue(`${p}/target`, "duplicate", `Two notes on ${n.target}.`);
    targets.add(n.target);
    if (n.target.startsWith("task:") && !known(n.target.slice(5))) {
      yield issue(`${p}/target`, "reference", `Note on unknown task ${n.target.slice(5)}.`);
    }
    if (n.target.startsWith("day:") && !isDate(n.target.slice(4))) {
      yield issue(`${p}/target`, "date", `${n.target.slice(4)} is not a calendar date.`);
    }
    for (const [k, d] of n.editedOn.entries()) {
      if (!isDate(d)) yield issue(`${p}/editedOn/${k}`, "date", `${d} is not a calendar date.`);
    }
  }
}

// ---------------------------------------------------------------- summary

/** The snapshot a restored Enrollment will have (shift ids are assigned in order). */
export function snapshotFromBackup(e: BackupEnrollment): Snapshot {
  const shiftRows = e.shifts.map((s, i) => ({ id: i + 1, ...s }));
  const undoable = undoableShift({ shifts: shiftRows, reloadedAt: e.reloadedAt });
  return {
    id: e.id,
    pathId: e.path.id,
    pathHash: e.pathHash,
    startDate: e.startDate,
    createdAt: e.createdAt,
    loadedAt: e.loadedAt,
    reloadedAt: e.reloadedAt,
    stateVersion: 0,
    path: e.path,
    taskStates: e.taskStates,
    shifts: shiftRows.map((s) => ({ ...s, undoable: s.id === undoable?.id })),
    tombstones: e.tombstones,
    noteMeta: e.notes.map((n): NoteMeta => ({
      target: n.target,
      fromTemplate: n.fromTemplate,
      editedOn: [...new Set(n.editedOn)].sort(),
      length: n.body.length,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
  };
}

export interface EnrollmentSummaryLine {
  id: string;
  title: string;
  startDate: string;
  /** Derived percent at `today`; `null` = no required Tasks. */
  percent: number | null;
  notes: number;
  active: boolean;
}

export interface BackupSummary {
  exportedAt: string;
  appVersion: string;
  enrollments: EnrollmentSummaryLine[];
}

/** For the restore preview: each Enrollment's path title, start date, percent and Note count. */
export function backupSummary(backup: Backup, today: string): BackupSummary {
  return {
    exportedAt: backup.exportedAt,
    appVersion: backup.appVersion,
    enrollments: backup.enrollments.map((e) => ({
      id: e.id,
      title: e.path.title,
      startDate: e.startDate,
      percent: stats(snapshotFromBackup(e), today).percent,
      notes: e.notes.length,
      active: e.id === backup.activeEnrollmentId,
    })),
  };
}
