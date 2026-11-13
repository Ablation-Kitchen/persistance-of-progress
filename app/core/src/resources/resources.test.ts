import { describe, expect, it } from "vitest";
import type { LearningPath } from "../path/types.js";
import { emptySnapshot, fixturePath } from "../testing/scenarios.js";
import {
  normaliseTitle,
  normaliseUrl,
  resourceIndex,
  resourceMatches,
  resourcePasses,
  type ResourceEntry,
} from "./resources.js";

const TODAY = "2026-09-30";
const { path } = fixturePath();

describe("normalisation", () => {
  it("drops scheme and trailing slashes from URLs and lowercases them", () => {
    expect(normaliseUrl("HTTPS://Example.com/Docs///")).toBe("example.com/docs");
    expect(normaliseUrl("http://example.com/docs")).toBe("example.com/docs");
  });

  it("drops (…) parts and punctuation from titles and lowercases them", () => {
    expect(normaliseTitle("Designing Data-Intensive Applications (Martin Kleppmann)")).toBe(
      "designing data intensive applications",
    );
    expect(normaliseTitle("Designing Data-Intensive Applications (Kleppmann)")).toBe(
      "designing data intensive applications",
    );
  });
});

describe("the 17-week fixture", () => {
  const index = resourceIndex(emptySnapshot(path), TODAY);
  const find = (title: string) => index.find((e) => e.title.startsWith(title))!;

  it("has 49 entries from 5 core resources and 50 links, 4 core ones used by Tasks", () => {
    expect(path.resources).toHaveLength(5);
    expect(path.blocks.flatMap((b) => b.tasks).flatMap((t) => t.links ?? [])).toHaveLength(50);
    expect(index).toHaveLength(49);
    expect(index.filter((e) => e.isCore)).toHaveLength(5);
    expect(index.filter((e) => e.isCore && e.uses.length > 0)).toHaveLength(4);
  });

  it("merges the two Kleppmann spellings under the core title", () => {
    const ddia = index.filter((e) => e.title.includes("Designing Data-Intensive"));
    expect(ddia).toHaveLength(1);
    expect(ddia[0]).toMatchObject({
      title: "Designing Data-Intensive Applications (Martin Kleppmann)",
      isCore: true,
      isBook: true,
      otherSpellings: ["Designing Data-Intensive Applications (Kleppmann)"],
    });
    expect(ddia[0]!.uses.map((u) => u.taskId)).toEqual([
      "ddia-distributed-trouble",
      "ddia-stream-processing",
    ]);
  });

  it("keeps the core note and marks Karpathy's channel as a whole-path reference", () => {
    expect(find("AI Engineering").note).toBe("Evaluation and inference chapters.");
    const karpathy = find("Andrej Karpathy");
    expect(karpathy).toMatchObject({ isCore: true, uses: [], blockIndex: null });
    expect(karpathy.firstUse).toBe(Infinity);
  });

  it("orders by first use, unused entries last in core order", () => {
    const days = index.map((e) => e.firstUse);
    expect(days).toEqual([...days].sort((a, b) => a - b));
    expect(index.at(-1)!.title).toBe("Andrej Karpathy's YouTube lectures");
  });

  it("uses follow shifted effective days and done status", () => {
    const s = emptySnapshot(path);
    s.taskStates.push({
      taskId: "ddia-distributed-trouble",
      status: "done",
      statusDate: TODAY,
      offsetDays: 3,
      updatedAt: "x",
    });
    const ddia = resourceIndex(s, TODAY).find(
      (e) => e.key === "book:designing data intensive applications",
    )!;
    expect(ddia.uses[0]).toMatchObject({
      taskId: "ddia-distributed-trouble",
      effDay: 34,
      done: true,
    });
  });
});

describe("filters and search", () => {
  const entry = (over: Partial<ResourceEntry>): ResourceEntry => ({
    key: "k",
    title: "T",
    isBook: false,
    isCore: false,
    coreIndex: null,
    otherSpellings: [],
    uses: [],
    firstUse: Infinity,
    blockIndex: null,
    ...over,
  });
  const use = (status: "todo" | "done" | "skipped", title = "A task") => ({
    taskId: "t",
    title,
    blockIndex: 0,
    effDay: 1,
    done: status === "done",
    status,
  });

  it("still to use keeps entries with a todo Task and hides the rest", () => {
    expect(resourcePasses(entry({ uses: [use("done"), use("todo")] }), "todo")).toBe(true);
    expect(resourcePasses(entry({ uses: [use("done"), use("done")] }), "todo")).toBe(false);
    expect(resourcePasses(entry({ uses: [use("skipped")] }), "todo")).toBe(false);
    expect(resourcePasses(entry({ uses: [] }), "todo")).toBe(false);
  });

  it("core and books chips", () => {
    expect(resourcePasses(entry({ isCore: true }), "core")).toBe(true);
    expect(resourcePasses(entry({}), "core")).toBe(false);
    expect(resourcePasses(entry({ isBook: true }), "books")).toBe(true);
  });

  it("search covers titles, other spellings, notes, URLs and using Task titles", () => {
    const e = entry({
      title: "Main",
      otherSpellings: ["Alias"],
      note: "a note",
      url: "https://x.dev/page",
      uses: [use("todo", "Build the thing")],
    });
    for (const q of ["main", "ALIAS", "note", "x.dev", "build the"])
      expect(resourceMatches(e, q)).toBe(true);
    expect(resourceMatches(e, "nothing")).toBe(false);
    expect(resourceMatches(e, "  ")).toBe(true);
  });

  it("searching a fixture Task title finds the resources that Task uses", () => {
    const task = path.blocks.flatMap((b) => b.tasks).find((t) => (t.links?.length ?? 0) > 1)!;
    const hits = resourceIndex(emptySnapshot(path), TODAY).filter((e) =>
      resourceMatches(e, task.title),
    );
    for (const l of task.links!)
      expect(hits.some((h) => h.title === l.title || h.otherSpellings.includes(l.title))).toBe(
        true,
      );
  });

  it("a core resource listed twice keeps the first one's title", () => {
    const p: LearningPath = {
      ...path,
      resources: [
        { title: "Book (First ed)", note: "one" },
        { title: "Book (Second ed)", note: "two" },
      ],
    };
    const e = resourceIndex(emptySnapshot(p), TODAY).find((x) => x.key === "book:book")!;
    expect(e).toMatchObject({
      title: "Book (First ed)",
      note: "one",
      otherSpellings: ["Book (Second ed)"],
    });
  });
});
