/** Request and response contracts for the routes of spec §8.3 (TypeBox, shared by server and web). */
import { Type, type Static } from "typebox";
import { PlainDate, Timestamp } from "./snapshot.js";

/** Version of the JSON Backup format (spec §9.2). */
export const BACKUP_FORMAT_VERSION = 1;

/** Largest accepted upload body (spec §8.3). */
export const UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;

export const IssueSchema = Type.Object({
  pointer: Type.String(),
  line: Type.Optional(Type.Integer()),
  column: Type.Optional(Type.Integer()),
  rule: Type.String(),
  message: Type.String(),
});
/** An issue as it travels over the wire (`rule` is any string). */
export type IssueJson = Static<typeof IssueSchema>;

export type ErrorCode =
  | "bad-request"
  | "not-found"
  | "preview-stale"
  | "path-id-mismatch"
  | "nothing-to-undo"
  | "task-removed"
  | "too-large"
  | "path-invalid"
  | "backup-invalid"
  | "backup-too-new"
  | "internal";

/** The error envelope (spec §8.2). */
export const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    issues: Type.Optional(Type.Array(IssueSchema)),
  }),
});
export type ErrorResponse = Static<typeof ErrorResponse>;

export const AppInfo = Type.Object({
  activeEnrollmentId: Type.Union([Type.String(), Type.Null()]),
  lastBackupAt: Type.Union([Timestamp, Type.Null()]),
  appVersion: Type.String(),
  backupFormatVersion: Type.Integer(),
  appStateVersion: Type.Integer({ minimum: 0 }),
});
export type AppInfo = Static<typeof AppInfo>;

export const SetActiveBody = Type.Object({
  enrollmentId: Type.Union([Type.String(), Type.Null()]),
});
export type SetActiveBody = Static<typeof SetActiveBody>;

/** One `*.yaml`/`*.yml` file in `/paths` (spec §8.5). */
export const PathFile = Type.Object({
  file: Type.String(),
  size: Type.Integer(),
  mtime: Timestamp,
  valid: Type.Boolean(),
  hash: Type.Optional(Type.String()),
  pathId: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  version: Type.Optional(Type.String()),
  /** Not in the §8.3 listing; added so the start-date dialog can show the hint. */
  startWeekday: Type.Optional(Type.String()),
  taskCount: Type.Optional(Type.Integer()),
  issues: Type.Optional(Type.Array(IssueSchema)),
});
export type PathFile = Static<typeof PathFile>;

/** `{file}` names a file in `/paths`; `{filename, yaml}` is an upload. */
export const PathSource = Type.Union([
  Type.Object({ file: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  Type.Object({ filename: Type.String(), yaml: Type.String() }, { additionalProperties: false }),
]);
export type PathSource = Static<typeof PathSource>;

export const EnrollmentSummary = Type.Object({
  id: Type.String(),
  pathId: Type.String(),
  title: Type.String(),
  startDate: PlainDate,
  createdAt: Timestamp,
  taskCount: Type.Integer(),
});
export type EnrollmentSummary = Static<typeof EnrollmentSummary>;

export const CreateEnrollmentBody = Type.Object({ source: PathSource, startDate: PlainDate });
export type CreateEnrollmentBody = Static<typeof CreateEnrollmentBody>;

export const PatchEnrollmentBody = Type.Object({ startDate: PlainDate });
export type PatchEnrollmentBody = Static<typeof PatchEnrollmentBody>;

export const EnrollmentParams = Type.Object({ id: Type.String() });
