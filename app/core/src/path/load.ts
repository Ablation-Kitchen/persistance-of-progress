import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Document, type Node } from "yaml";
import schema from "../../schema/learning-path.schema.json" with { type: "json" };
import { pathHash } from "./hash.js";
import { blockRange } from "./helpers.js";
import type { Issue, LearningPath } from "./types.js";

export type LoadResult =
  { ok: true; path: LearningPath; hash: string } | { ok: false; issues: Issue[] };

export interface LoadOptions {
  source: "yaml" | "json";
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile<LearningPath>(schema);

/**
 * The loading pipeline (spec §3.2): parse → normalise → schema → app rules → hash.
 * Any issue rejects the whole file.
 */
export function loadPath(text: string, { source }: LoadOptions): LoadResult {
  const parsed = source === "yaml" ? parseYaml(text) : parseJson(text);
  if (!parsed.ok) return { ok: false, issues: [parsed.issue] };
  const { value, locate } = parsed;

  normalise(value);

  if (!validateSchema(value)) {
    const issues = (validateSchema.errors ?? []).map((e) => schemaIssue(e));
    return { ok: false, issues: dedupe(issues).map(locate) };
  }

  const issues = appRules(value).map(locate);
  if (issues.length > 0) return { ok: false, issues };

  return { ok: true, path: value, hash: pathHash(value) };
}

type Parsed =
  { ok: true; value: unknown; locate: (issue: Issue) => Issue } | { ok: false; issue: Issue };

function parseYaml(text: string): Parsed {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });
  const err = doc.errors[0];
  if (err) {
    const pos = lineCounter.linePos(err.pos[0]);
    return {
      ok: false,
      issue: {
        pointer: "",
        line: pos.line,
        column: pos.col,
        rule: "yaml-syntax",
        message: err.message.split("\n")[0] ?? err.message,
      },
    };
  }
  const value: unknown = doc.toJS();
  return {
    ok: true,
    value,
    locate: (issue) => {
      const offset = offsetOf(doc, issue.pointer);
      if (offset === undefined) return issue;
      const pos = lineCounter.linePos(offset);
      return { ...issue, line: pos.line, column: pos.col };
    },
  };
}

function parseJson(text: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(text) as unknown, locate: (issue) => issue };
  } catch (e) {
    return {
      ok: false,
      issue: { pointer: "", rule: "json-syntax", message: (e as Error).message },
    };
  }
}

/** Lowercase `kind` and `startWeekday` so `Kind: Material` loads. Mutates in place. */
function normalise(value: unknown) {
  if (!isRecord(value)) return;
  if (typeof value.startWeekday === "string") value.startWeekday = value.startWeekday.toLowerCase();
  if (!Array.isArray(value.blocks)) return;
  for (const block of value.blocks) {
    if (!isRecord(block) || !Array.isArray(block.tasks)) continue;
    for (const task of block.tasks) {
      if (isRecord(task) && typeof task.kind === "string") task.kind = task.kind.toLowerCase();
    }
  }
}

function schemaIssue(e: ErrorObject): Issue {
  let pointer = e.instancePath;
  let message = e.message ?? "is invalid";
  if (e.keyword === "additionalProperties") {
    const prop = (e.params as { additionalProperty: string }).additionalProperty;
    pointer = `${pointer}/${escapePointer(prop)}`;
    message = `unknown property "${prop}"`;
  } else if (e.keyword === "enum") {
    const allowed = (e.params as { allowedValues: unknown[] }).allowedValues;
    message = `must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")}`;
  }
  return { pointer, rule: "schema", message: `${pointer || "/"} ${message}` };
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.pointer}\0${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The rules the schema can't express. Runs only on schema-valid input. */
function appRules(path: LearningPath): Issue[] {
  const issues: Issue[] = [];
  const firstSeen = new Map<string, string>();
  let previous: { last: number; index: number } | undefined;

  path.blocks.forEach((block, b) => {
    block.tasks.forEach((task, t) => {
      const at = `/blocks/${b}/tasks/${t}`;
      const other = firstSeen.get(task.id);
      if (other !== undefined) {
        issues.push({
          pointer: `${at}/id`,
          rule: "duplicate-task-id",
          message: `Task id "${task.id}" is already used at ${other}`,
        });
      } else {
        firstSeen.set(task.id, at);
      }
      if (task.day < 1) {
        issues.push({
          pointer: `${at}/day`,
          rule: "day-out-of-range",
          message: `day (${task.day}) must be 1 or more`,
        });
      }
      if (task.dueDay !== undefined && task.dueDay < task.day) {
        issues.push({
          pointer: `${at}/dueDay`,
          rule: "due-before-day",
          message: `dueDay (${task.dueDay}) is before day (${task.day})`,
        });
      }
    });

    const range = blockRange(block);
    if (previous && range.first <= previous.last) {
      const firstIndex = block.tasks.findIndex((task) => task.day === range.first);
      issues.push({
        pointer: `/blocks/${b}/tasks/${firstIndex}/day`,
        rule: "blocks-overlap",
        message: `Block ${b + 1} starts on day ${range.first}, but Block ${previous.index + 1} runs until day ${previous.last}`,
      });
    }
    // Compare against the furthest-reaching Block so far, so a short Block can't mask an overlap.
    if (!previous || range.last > previous.last) previous = { last: range.last, index: b };
  });

  if (path.weekRhythm !== undefined && path.weekRhythm.length !== 7) {
    issues.push({
      pointer: "/weekRhythm",
      rule: "week-rhythm-length",
      message: `weekRhythm has ${path.weekRhythm.length} entries; it needs exactly 7`,
    });
  }
  return issues;
}

/**
 * Source offset for a JSON Pointer, walking the YAML AST. A missing segment falls back to the
 * deepest node that exists. Map entries point at the value for scalars, else at the key.
 */
function offsetOf(doc: Document, pointer: string): number | undefined {
  let node: Node | null | undefined = doc.contents;
  let offset = node?.range?.[0];
  for (const seg of parsePointer(pointer)) {
    if (isMap(node)) {
      const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === seg);
      if (!pair) break;
      const value = pair.value as Node | null;
      const keyStart = (pair.key as Node).range?.[0];
      offset = isScalar(value) ? (value.range?.[0] ?? keyStart) : keyStart;
      node = value;
    } else if (isSeq(node)) {
      const item = node.items[Number(seg)] as Node | undefined;
      if (!item) break;
      offset = item.range?.[0] ?? offset;
      node = item;
    } else {
      break;
    }
  }
  return offset;
}

function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function escapePointer(s: string): string {
  return s.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
