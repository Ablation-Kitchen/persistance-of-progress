import { describe, expect, it } from "vitest";
import type { LearningPath, Task } from "../path/types.js";
import {
  applyShift,
  editNote,
  emptySnapshot,
  fixturePath,
  setState,
  tombstone,
} from "../testing/scenarios.js";
import { addedOverdueCount, diffReload, isEmptyDiff } from "./reload.js";

const { path: fixture } = fixturePath();
const clone = (p: LearningPath): LearningPath => structuredClone(p);

function remove(p: LearningPath, id: string): void {
  for (const b of p.blocks) {
    const i = b.tasks.findIndex((t) => t.id === id);
    if (i >= 0) b.tasks.splice(i, 1);
  }
}
function find(p: LearningPath, id: string): Task {
  for (const b of p.blocks) for (const t of b.tasks) if (t.id === id) return t;
  throw new Error(id);
}

describe("diffReload", () => {
  it("an identical path is an empty diff", () => {
    const d = diffReload(emptySnapshot(clone(fixture)), clone(fixture));
    expect(isEmptyDiff(d)).toBe(true);
    expect(d.plan.newTombstones).toEqual([]);
  });

  it("lists added, removed (kept hidden or not), moved and changed Tasks", () => {
    const s = emptySnapshot(clone(fixture));
    setState(s, "intro-to-llms", "done", "2026-09-07");
    editNote(s, "task:intro-to-llms", "2026-09-07");
    const next = clone(fixture);
    next.blocks[0]!.tasks.push(
      { id: "new-one", day: 3, kind: "material", title: "New one" },
      { id: "new-two", day: 4, dueDay: 5, kind: "exercise", title: "New two", optional: true },
    );
    remove(next, "intro-to-llms"); // done + Note → kept hidden
    remove(next, "attention-is-all-you-need"); // untouched → just gone
    find(next, "learnings-week-1").day = 7;
    find(next, "go-brrr").title = "Go brrr, retitled";

    const d = diffReload(s, next);
    expect(d.added.map((a) => a.taskId)).toEqual(["new-one", "new-two"]);
    expect(d.added[1]).toMatchObject({ day: 4, dueDay: 5, optional: true });
    expect(d.removed).toEqual([
      expect.objectContaining({ taskId: "intro-to-llms", keptHidden: true, formerDay: 1 }),
      expect.objectContaining({ taskId: "attention-is-all-you-need", keptHidden: false }),
    ]);
    expect(d.moved).toEqual([
      expect.objectContaining({
        taskId: "learnings-week-1",
        from: { day: 6, dueDay: 6 },
        to: { day: 7, dueDay: 7 },
      }),
    ]);
    expect(d.changed).toEqual([expect.objectContaining({ taskId: "go-brrr", fields: ["title"] })]);
    expect(d.restored).toEqual([]);
    expect(d.pathChanges).toEqual([]);
    expect(d.plan.newTombstones).toEqual([
      { taskId: "intro-to-llms", title: expect.any(String), kind: "material", formerDay: 1 },
    ]);
    expect(d.plan.addedIds).toEqual(["new-one", "new-two"]);
  });

  it("a removed Task with only a shift's todo record is not kept hidden; the record is dropped", () => {
    const s = emptySnapshot(clone(fixture));
    applyShift(s, 2, "2026-09-10", "2026-09-10T10:00:00.000Z");
    setState(s, "learnings-week-1", "skipped", "2026-09-12");
    const next = clone(fixture);
    remove(next, "attention-is-all-you-need");
    remove(next, "learnings-week-1");
    const d = diffReload(s, next);
    expect(d.removed.map((r) => [r.taskId, r.keptHidden])).toEqual([
      ["learnings-week-1", true],
      ["attention-is-all-you-need", false],
    ]);
    expect(d.plan.droppedRecordIds).toEqual(["attention-is-all-you-need"]);
  });

  it("a removed Task with only a Note (no record) is kept hidden", () => {
    const s = emptySnapshot(clone(fixture));
    editNote(s, "task:attention-is-all-you-need", "2026-09-10");
    const next = clone(fixture);
    remove(next, "attention-is-all-you-need");
    expect(diffReload(s, next).removed[0]?.keptHidden).toBe(true);
  });

  it("an id coming back from a tombstone is restored, not added", () => {
    const s = emptySnapshot(clone(fixture));
    setState(s, "intro-to-llms", "done", "2026-09-07");
    tombstone(s, "intro-to-llms", "2026-09-20T00:00:00.000Z");
    const d = diffReload(s, clone(fixture));
    expect(d.restored).toEqual([expect.objectContaining({ taskId: "intro-to-llms" })]);
    expect(d.added).toEqual([]);
    expect(d.plan.restoredIds).toEqual(["intro-to-llms"]);
  });

  it("flags every content field and a Block move as changed", () => {
    const s = emptySnapshot(clone(fixture));
    const next = clone(fixture);
    const t = find(next, "go-brrr");
    t.description = "new words";
    t.kind = "exercise";
    t.optional = true;
    t.links = [{ title: "x", url: "https://example.com" }];
    t.noteTemplate = "## template";
    // Move a Task to the next Block (same day stays valid only if ranges allow; the diff doesn't care).
    const moving = next.blocks[0]!.tasks.pop()!;
    next.blocks[1]!.tasks.unshift(moving);
    const d = diffReload(s, next);
    expect(d.changed.find((c) => c.taskId === "go-brrr")?.fields).toEqual([
      "description",
      "kind",
      "optional",
      "links",
      "noteTemplate",
    ]);
    expect(d.changed.find((c) => c.taskId === moving.id)?.fields).toEqual(["block"]);
  });

  it("reports path-level changes", () => {
    const s = emptySnapshot(clone(fixture));
    const next = clone(fixture);
    next.title = "New title";
    next.version = "2026-12-01";
    next.description = "x";
    next.weekRhythm = ["A", "B", "C", "D", "E", "F", ""];
    next.resources = next.resources!.slice(1);
    next.blocks[0]!.goal = "A new goal";
    const fields = diffReload(s, next).pathChanges.map((c) => c.field);
    expect(fields).toEqual([
      "title",
      "version",
      "description",
      "weekRhythm",
      "resources",
      "blocks",
    ]);
    expect(diffReload(s, next).pathChanges[1]?.detail).toBe("“2026-11-09” → “2026-12-01”");
  });

  it("added Tasks take the sum of all shifts; the overdue count uses that offset", () => {
    const s = emptySnapshot(clone(fixture));
    applyShift(s, 2, "2026-09-20", "2026-09-20T10:00:00.000Z");
    applyShift(s, 1, "2026-09-25", "2026-09-25T10:00:00.000Z");
    const next = clone(fixture);
    next.blocks[0]!.tasks.push(
      { id: "past-a", day: 2, kind: "material", title: "Past A" },
      { id: "past-b", day: 10, kind: "material", title: "Past B" },
      { id: "past-opt", day: 2, kind: "material", title: "Optional", optional: true },
      { id: "future", day: 30, kind: "material", title: "Future" },
    );
    const d = diffReload(s, next);
    expect(d.plan.addedOffset).toBe(3);
    // Day 14 (2026-09-20): past-a is due day 2+3=5 → overdue; past-b due 13 → overdue;
    // optional never; future no.
    expect(addedOverdueCount(s, d, "2026-09-20")).toBe(2);
    // Day 13: past-b due 13 is still open.
    expect(addedOverdueCount(s, d, "2026-09-19")).toBe(1);
  });
});
