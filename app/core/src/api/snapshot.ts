import { Type, type Static } from "typebox";
import type { LearningPath } from "../path/types.js";

/** Plain local date, `YYYY-MM-DD` (spec §8.1). Calendar validity is checked separately. */
export const PlainDate = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
/** UTC ISO-8601 timestamp. */
export const Timestamp = Type.String();

export const TaskStatus = Type.Union([
  Type.Literal("todo"),
  Type.Literal("done"),
  Type.Literal("skipped"),
]);
export type TaskStatus = Static<typeof TaskStatus>;

export const TaskKindSchema = Type.Union([
  Type.Literal("material"),
  Type.Literal("exercise"),
  Type.Literal("checkpoint"),
  Type.Literal("reflection"),
]);

export const TaskStateRecord = Type.Object({
  taskId: Type.String(),
  status: TaskStatus,
  statusDate: Type.Union([PlainDate, Type.Null()]),
  offsetDays: Type.Integer(),
  updatedAt: Timestamp,
});
export type TaskStateRecord = Static<typeof TaskStateRecord>;

export const Shift = Type.Object({
  id: Type.Integer(),
  appliedOn: PlainDate,
  days: Type.Integer({ minimum: 1, maximum: 365 }),
  taskIds: Type.Array(Type.String()),
  createdAt: Timestamp,
  undoable: Type.Boolean(),
});
export type Shift = Static<typeof Shift>;

export const Tombstone = Type.Object({
  taskId: Type.String(),
  title: Type.String(),
  kind: TaskKindSchema,
  formerDay: Type.Integer(),
  removedAt: Timestamp,
});
export type Tombstone = Static<typeof Tombstone>;

/** `task:<id>` | `day:YYYY-MM-DD` | `enrollment`. */
export const NoteTarget = Type.String({
  pattern: "^(task:[a-z0-9]+(-[a-z0-9]+)*|day:\\d{4}-\\d{2}-\\d{2}|enrollment)$",
});

export const NoteMeta = Type.Object({
  target: NoteTarget,
  fromTemplate: Type.Boolean(),
  /** The edit-date trail: local dates on which the Note was saved. */
  editedOn: Type.Array(PlainDate),
  length: Type.Integer({ minimum: 0 }),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type NoteMeta = Static<typeof NoteMeta>;

/**
 * The path copy is validated by `loadPath` (spec §3.2), not here. An empty schema keeps
 * Fastify's serializer from dropping its fields.
 */
const PathCopy = Type.Unsafe<LearningPath>({});

/** An Enrollment snapshot (spec §8.3): everything the client derives signals from. */
export const Snapshot = Type.Object({
  id: Type.String(),
  pathId: Type.String(),
  pathHash: Type.String(),
  startDate: PlainDate,
  createdAt: Timestamp,
  loadedAt: Timestamp,
  reloadedAt: Type.Union([Timestamp, Type.Null()]),
  stateVersion: Type.Integer({ minimum: 0 }),
  path: PathCopy,
  taskStates: Type.Array(TaskStateRecord),
  shifts: Type.Array(Shift),
  tombstones: Type.Array(Tombstone),
  noteMeta: Type.Array(NoteMeta),
});
export type Snapshot = Static<typeof Snapshot>;
