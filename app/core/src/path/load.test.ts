import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { allTasks, blockRange, pathLength } from "./helpers.js";
import { canonicalJson, pathHash } from "./hash.js";
import { loadPath, type LoadResult } from "./load.js";
import type { Issue } from "./types.js";

const fixture = readFileSync(
  new URL("../../../paths/eval-infra-17-weeks.yaml", import.meta.url),
  "utf8",
);

function loaded(text: string) {
  const result = loadPath(text, { source: "yaml" });
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.issues, null, 2)}`);
  return result;
}

function issuesOf(result: LoadResult): Issue[] {
  if (result.ok) throw new Error("expected issues, got ok");
  return result.issues;
}

/** Replace `find` (which must occur once) and return the text plus the 1-based line of the edit. */
function breakFixture(find: string, replace: string) {
  const at = fixture.indexOf(find);
  expect(at, `"${find}" not in fixture`).toBeGreaterThanOrEqual(0);
  expect(fixture.indexOf(find, at + 1), `"${find}" occurs twice`).toBe(-1);
  const text = fixture.slice(0, at) + replace + fixture.slice(at + find.length);
  const lineOf = (needle: string) => {
    const i = text.indexOf(needle, at);
    return text.slice(0, i).split("\n").length;
  };
  return { text, lineOf };
}

describe("loadPath on the 17-week fixture", () => {
  it("loads with 0 issues, 123 Tasks and length 118", () => {
    const { path, hash } = loaded(fixture);
    expect(allTasks(path)).toHaveLength(123);
    expect(path.blocks).toHaveLength(6);
    expect(pathLength(path)).toBe(118);
    // Day 118 is week 17, Saturday (Monday = day 1).
    expect(Math.ceil(118 / 7)).toBe(17);
    expect((118 - 1) % 7).toBe(5);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("derives Block ranges from first day to last due day", () => {
    const { path } = loaded(fixture);
    expect(path.blocks.map(blockRange)).toEqual([
      { first: 1, last: 20 },
      { first: 22, last: 41 },
      { first: 43, last: 62 },
      { first: 64, last: 90 },
      { first: 92, last: 104 },
      { first: 106, last: 118 },
    ]);
  });
});

describe("app rules: each broken copy yields exactly that rule", () => {
  it("duplicate-task-id", () => {
    const { text, lineOf } = breakFixture("- id: 3blue1brown-transformers", "- id: intro-to-llms");
    const issues = issuesOf(loadPath(text, { source: "yaml" }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: "duplicate-task-id",
      pointer: "/blocks/0/tasks/2/id",
      line: lineOf("intro-to-llms"),
      column: 13,
    });
  });

  it("day-out-of-range", () => {
    const { text, lineOf } = breakFixture(
      "- id: intro-to-llms\n        day: 1\n",
      "- id: intro-to-llms\n        day: 0\n",
    );
    const issues = issuesOf(loadPath(text, { source: "yaml" }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: "day-out-of-range",
      pointer: "/blocks/0/tasks/0/day",
      line: lineOf("day: 0"),
      column: 14,
    });
  });

  it("due-before-day", () => {
    const { text, lineOf } = breakFixture("dueDay: 12\n", "dueDay: 1\n");
    const issues = issuesOf(loadPath(text, { source: "yaml" }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: "due-before-day",
      pointer: "/blocks/0/tasks/1/dueDay",
      line: lineOf("dueDay: 1\n"),
      message: "dueDay (1) is before day (2)",
    });
  });

  it("blocks-overlap", () => {
    const { text, lineOf } = breakFixture(
      "- id: asyncio-book\n        day: 22\n",
      "- id: asyncio-book\n        day: 20\n",
    );
    const issues = issuesOf(loadPath(text, { source: "yaml" }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: "blocks-overlap",
      pointer: "/blocks/1/tasks/0/day",
      line: lineOf("day: 20"),
    });
  });

  it("week-rhythm-length", () => {
    const { text, lineOf } = breakFixture(
      'weekRhythm: ["Study", "Build", "Study", "Build", "Build", "Review", ""]',
      'weekRhythm: ["Study", "Build", "Study", "Build", "Build", "Review"]',
    );
    const issues = issuesOf(loadPath(text, { source: "yaml" }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: "week-rhythm-length",
      pointer: "/weekRhythm",
      line: lineOf("weekRhythm"),
    });
  });
});

describe("schema and syntax", () => {
  it("lowercases kind and startWeekday", () => {
    const { text } = breakFixture(
      "- id: intro-to-llms\n        day: 1\n        kind: material",
      "- id: intro-to-llms\n        day: 1\n        Kind: Material",
    );
    // `Kind` (capital key) is an unknown property; the ticket's case is the value.
    expect(issuesOf(loadPath(text, { source: "yaml" }))[0]?.rule).toBe("schema");

    const { text: valueCase } = breakFixture(
      "- id: intro-to-llms\n        day: 1\n        kind: material",
      "- id: intro-to-llms\n        day: 1\n        kind: Material",
    );
    const withWeekday = valueCase.replace("startWeekday: monday", "startWeekday: Monday");
    const { path } = loaded(withWeekday);
    expect(path.blocks[0]?.tasks[0]?.kind).toBe("material");
    expect(path.startWeekday).toBe("monday");
  });

  it("a YAML syntax error yields one yaml-syntax issue with a line", () => {
    const { text, lineOf } = breakFixture(
      'title: "17-Week Plan: Eval Infrastructure Engineer"',
      'title: "17-Week Plan: Eval Infrastructure Engineer',
    );
    const issues = issuesOf(loadPath(text, { source: "yaml" }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe("yaml-syntax");
    expect(issues[0]?.line).toBeGreaterThanOrEqual(lineOf("title:"));
  });

  it("schema failures carry a pointer and line", () => {
    const { text, lineOf } = breakFixture(
      "- id: intro-to-llms\n        day: 1\n        kind: material",
      "- id: intro-to-llms\n        day: 1\n        kind: lecture",
    );
    const issues = issuesOf(loadPath(text, { source: "yaml" }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: "schema",
      pointer: "/blocks/0/tasks/0/kind",
      line: lineOf("kind: lecture"),
    });
    expect(issues[0]?.message).toContain('"material"');
  });

  it("an unknown property points at its line", () => {
    const { text, lineOf } = breakFixture(
      "startWeekday: monday\n",
      "startWeekday: monday\nauthor: me\n",
    );
    const issues = issuesOf(loadPath(text, { source: "yaml" }));
    expect(issues).toEqual([
      expect.objectContaining({
        rule: "schema",
        pointer: "/author",
        line: lineOf("author"),
        column: 9,
      }),
    ]);
  });

  it("app rules don't run while the schema fails", () => {
    const { text } = breakFixture("dueDay: 12\n", 'dueDay: "12"\n');
    const issues = issuesOf(loadPath(text, { source: "yaml" }));
    expect(issues.map((i) => i.rule)).toEqual(["schema"]);
  });

  it("loads JSON input without line numbers", () => {
    const json = JSON.stringify(loaded(fixture).path);
    const result = loadPath(json, { source: "json" });
    expect(result.ok).toBe(true);
    const bad = issuesOf(loadPath("{", { source: "json" }));
    expect(bad).toEqual([expect.objectContaining({ rule: "json-syntax", pointer: "" })]);
  });
});

describe("hash", () => {
  it("ignores formatting and comments, but not content", () => {
    const base = loaded(fixture).hash;
    const reformatted = stringify(loaded(fixture).path, { indent: 4, lineWidth: 0 });
    expect(loaded(`# a comment\n${reformatted}`).hash).toBe(base);
    expect(loaded(fixture.replace("# Week 1\n", "# Week one, re-commented\n")).hash).toBe(base);
    expect(loadPath(JSON.stringify(loaded(fixture).path), { source: "json" })).toMatchObject({
      hash: base,
    });

    const retitled = fixture.replace(
      'title: "Watch: Intro to Large Language Models (Karpathy, 1 hr)"',
      'title: "Watch: Intro to LLMs (Karpathy, 1 hr)"',
    );
    expect(loaded(retitled).hash).not.toBe(base);
  });

  it("canonicalJson sorts keys recursively and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
    expect(pathHash({ a: 1, b: 2 })).toBe(pathHash({ b: 2, a: 1 }));
  });
});

describe("allTasks order", () => {
  it("sorts a day's Tasks by (day, Block index, array index), not file order", () => {
    // Move week 1's first Task (day 1) to the end of Block 0, so file order ≠ day order.
    const { path } = loaded(fixture);
    const block = path.blocks[0]!;
    const first = block.tasks.shift()!;
    block.tasks.push(first);

    const ordered = allTasks(path);
    expect(ordered[0]).toMatchObject({ task: { id: "intro-to-llms", day: 1 }, taskIndex: 17 });
    const days = ordered.map((p) => p.task.day);
    expect(days).toEqual([...days].sort((a, b) => a - b));
  });

  it("orders same-day Tasks by array index", () => {
    const { path } = loaded(fixture);
    const byDay = new Map<number, number[]>();
    for (const p of allTasks(path)) {
      byDay.set(p.task.day, [...(byDay.get(p.task.day) ?? []), p.taskIndex]);
    }
    for (const indexes of byDay.values())
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });
});
