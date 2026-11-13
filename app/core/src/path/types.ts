/** Types for a loaded, validated Learning Path (spec §3.1). They mirror the canonical schema. */

export type TaskKind = "material" | "exercise" | "checkpoint" | "reflection";

export type Weekday =
  "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export interface Link {
  title: string;
  url?: string;
}

export interface Resource {
  title: string;
  url?: string;
  note?: string;
}

export interface Task {
  id: string;
  day: number;
  dueDay?: number;
  kind: TaskKind;
  optional?: boolean;
  title: string;
  description?: string;
  links?: Link[];
  noteTemplate?: string;
}

export interface Block {
  title: string;
  goal: string;
  description?: string;
  tasks: Task[];
}

export interface LearningPath {
  schemaVersion: 1;
  id: string;
  version?: string;
  title: string;
  description: string;
  startWeekday?: Weekday;
  weekRhythm?: string[];
  resources?: Resource[];
  blocks: Block[];
}

/** One problem found while loading a path, a reload or a restore (spec §3.2, §8.2). */
export interface Issue {
  /** JSON Pointer into the document, e.g. `/blocks/2/tasks/5/day`. `""` is the root. */
  pointer: string;
  /** 1-based, for YAML/JSON-text input when the location is known. */
  line?: number;
  column?: number;
  rule: IssueRule;
  message: string;
}

export type IssueRule =
  | "yaml-syntax"
  | "json-syntax"
  | "schema"
  | "duplicate-task-id"
  | "day-out-of-range"
  | "due-before-day"
  | "blocks-overlap"
  | "week-rhythm-length";
