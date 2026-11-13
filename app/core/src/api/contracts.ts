/** Request and response contracts for the routes of spec §8.3 (TypeBox, shared by server and web). */
import { Type, type Static } from "typebox";
import { NoteMeta, PlainDate, TaskStateRecord, TaskStatus, Timestamp } from "./snapshot.js";
import type { ReloadDiff } from "../reload/reload.js";

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

export const TaskStateParams = Type.Object({ id: Type.String(), taskId: Type.String() });
export type TaskStateParams = Static<typeof TaskStateParams>;

/** `todo` clears `statusDate`; `done` and `skipped` require it (spec §8.3). */
export const SetTaskStateBody = Type.Object(
  { status: TaskStatus, statusDate: Type.Optional(Type.Union([PlainDate, Type.Null()])) },
  { additionalProperties: false },
);
export type SetTaskStateBody = Static<typeof SetTaskStateBody>;

export const TaskStateResponse = Type.Object({
  record: TaskStateRecord,
  stateVersion: Type.Integer({ minimum: 0 }),
});
export type TaskStateResponse = Static<typeof TaskStateResponse>;

/** A Schedule Shift: move every live `todo` Task forward 1–365 days (spec §8.3, §13.6). */
export const ShiftBody = Type.Object(
  { days: Type.Integer({ minimum: 1, maximum: 365 }), appliedOn: PlainDate },
  { additionalProperties: false },
);
export type ShiftBody = Static<typeof ShiftBody>;
// ---------------------------------------------------------------- Notes (ticket 08)

/**
 * `:target` is URL-encoded and checked by the server (a live or tombstoned Task, a real date,
 * or `enrollment`); anything else is a 404, so the param is a plain string here.
 */
export const NoteParams = Type.Object({ id: Type.String(), target: Type.String() });
export type NoteParams = Static<typeof NoteParams>;

export const NoteBody = Type.Object({ target: Type.String(), body: Type.String() });
export type NoteBody = Static<typeof NoteBody>;

export const PutNoteBody = Type.Object(
  {
    body: Type.String(),
    /** The learner's local date of this edit; added to the Note's edit-date trail. */
    editedOn: PlainDate,
    /** Honoured only when the save creates the Note. */
    fromTemplate: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type PutNoteBody = Static<typeof PutNoteBody>;

export const PutNoteResponse = Type.Object({
  meta: NoteMeta,
  stateVersion: Type.Integer({ minimum: 0 }),
});
export type PutNoteResponse = Static<typeof PutNoteResponse>;

export const DeleteNoteResponse = Type.Object({ stateVersion: Type.Integer({ minimum: 0 }) });
export type DeleteNoteResponse = Static<typeof DeleteNoteResponse>;

// ---------------------------------------------------------------- Reload (ticket 13)

export const ReloadPreviewBody = Type.Object(
  { source: PathSource },
  { additionalProperties: false },
);
export type ReloadPreviewBody = Static<typeof ReloadPreviewBody>;

/** The diff is built by `diffReload`; an empty schema keeps Fastify's serializer from dropping fields. */
const ReloadDiffJson = Type.Unsafe<ReloadDiff>({});

export const ReloadPreviewResponse = Type.Union([
  Type.Object({ unchanged: Type.Literal(true) }),
  Type.Object({
    diff: ReloadDiffJson,
    sourceHash: Type.String(),
    stateVersion: Type.Integer({ minimum: 0 }),
  }),
]);
export type ReloadPreviewResponse = Static<typeof ReloadPreviewResponse>;

export const ReloadBody = Type.Object(
  {
    source: PathSource,
    expectedSourceHash: Type.String(),
    expectedStateVersion: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ReloadBody = Static<typeof ReloadBody>;
