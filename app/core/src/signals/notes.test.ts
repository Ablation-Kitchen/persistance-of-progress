import { describe, expect, it } from "vitest";
import { addDays } from "../dates/dates.js";
import {
  editNote,
  emptySnapshot,
  FIXTURE_START,
  fixturePath,
  setState,
  tombstone,
} from "../testing/scenarios.js";
import {
  blockOfDate,
  notesByBlock,
  notesStats,
  removedNotes,
  textMatches,
  wordCount,
} from "./notes.js";
import { blockSignals, dateOfDay } from "./signals.js";

const date = (d: number) => addDays(FIXTURE_START, d - 1);
const fresh = () => {
  const { path } = fixturePath();
  return emptySnapshot(structuredClone(path));
};

describe("wordCount, textMatches, notesStats", () => {
  it("counts words without Markdown punctuation", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("## Why\n- one **two** [three](https://x.y)\n| a | b |")).toBe(6);
  });

  it("matches case-insensitively; an empty query matches", () => {
    expect(textMatches("Paged Attention", "attention")).toBe(true);
    expect(textMatches("x", "  ")).toBe(true);
    expect(textMatches("x", "y")).toBe(false);
  });

  it("counts notes, distinct edit days and words", () => {
    const s = fresh();
    editNote(s, "day:2026-09-07", "2026-09-07", "2026-09-08");
    editNote(s, "enrollment", "2026-09-08");
    const st = notesStats(s, [
      { target: "day:2026-09-07", body: "two words" },
      { target: "enrollment", body: "three more words" },
    ]);
    expect(st).toEqual({ notes: 2, daysWithEdit: 2, words: 5 });
  });
});

describe("blockOfDate", () => {
  it("assigns a date to the Block whose effective range holds it", () => {
    const s = fresh();
    const today = date(30);
    for (const b of blockSignals(s, today)) {
      expect(blockOfDate(s, today, b.firstDate)).toBe(b.blockIndex);
      expect(blockOfDate(s, today, b.lastDate)).toBe(b.blockIndex);
    }
    // Before the start → the first Block; after the end → the last.
    expect(blockOfDate(s, today, addDays(FIXTURE_START, -5))).toBe(0);
    expect(blockOfDate(s, today, date(400))).toBe(s.path.blocks.length - 1);
  });

  it("follows the effective (shifted) range, not the authored one", () => {
    const s = fresh();
    const today = date(1);
    const authoredFirst = blockSignals(s, today)[1]!.first;
    // Move Block 2 alone 30 days later (as per-Task offsets do).
    for (const task of s.path.blocks[1]!.tasks) setState(s, task.id, "todo");
    for (const r of s.taskStates) r.offsetDays = 30;
    const shifted = blockSignals(s, today)[1]!;
    expect(shifted.first).toBe(authoredFirst + 30);
    // Block 2's authored first day now falls in Block 1's range or the gap after it → Block 1.
    expect(blockOfDate(s, today, dateOfDay(s, authoredFirst))).toBe(0);
    expect(blockOfDate(s, today, dateOfDay(s, shifted.first))).toBe(1);
  });
});

describe("notesByBlock", () => {
  it("at week 16 lists notes, gaps and future reflections for the story-bank Block", () => {
    const s = fresh();
    const today = date(112);
    editNote(s, "task:story-bank", date(108), date(110));
    s.noteMeta.find((m) => m.target === "task:story-bank")!.fromTemplate = true;
    editNote(s, "day:" + date(108), date(108));
    const bodies = [
      { target: "task:story-bank", body: "| a | b |\n| --- | --- |\n| x | y |" },
      { target: "day:" + date(108), body: "mock interview went fine" },
    ];
    const blocks = notesByBlock(s, today, bodies);
    const last = blocks.at(-1)!;
    const row = (id: string) => last.rows.find((r) => r.view.task.id === id);

    expect(row("story-bank")?.note?.body).toContain("| x | y |");
    expect(row("story-bank")?.gap).toBeNull();
    expect(row("learnings-week-16")?.gap).toBe("not-written");
    expect(row("learnings-week-17")).toMatchObject({ gap: "opens", opensOn: date(118) });
    expect(row("leetcode-week-16")?.gap).toBe("add-note"); // a reached exercise
    expect(row("design-agentic-eval-runner")).toBeUndefined(); // a future exercise
    expect(row("why-evals-answer")).toBeUndefined(); // a checkpoint without a Note

    // Path order.
    const days = last.rows.map((r) => r.view.effDay);
    expect(days).toEqual([...days].sort((a, b) => a - b));

    expect(last.taskNotes).toBe(1);
    expect(last.reflectionsReached).toBe(1);
    expect(last.reflectionsWritten).toBe(0);
    // The Day Note plus today's empty slot.
    expect(last.dayNotes.map((d) => [d.date, d.note !== null])).toEqual([
      [date(108), true],
      [today, false],
    ]);
    expect(last.count).toBe(2);
    expect(blocks[0]!.count).toBe(0);
  });

  it("while searching, counts matches per Block and filters rows and Day Notes", () => {
    const s = fresh();
    const today = date(112);
    editNote(s, "day:" + date(3), date(3));
    editNote(s, "task:learnings-week-16", date(111));
    const bodies = [
      { target: "day:" + date(3), body: "Zanzibar is only here" },
      { target: "task:learnings-week-16", body: "nothing special" },
    ];
    const hits = notesByBlock(s, today, bodies, { q: "zanzibar", scope: "notes" });
    expect(hits[0]!.count).toBe(1);
    expect(hits[0]!.dayNotes.map((d) => d.date)).toEqual([date(3)]);
    expect(hits.at(-1)!.count).toBe(0);
    expect(hits.at(-1)!.rows).toEqual([]);
    expect(hits.at(-1)!.dayNotes).toEqual([]); // no today slot while searching

    // Titles scope also matches Task titles; notes scope doesn't.
    const titles = notesByBlock(s, today, bodies, { q: "story bank", scope: "titles" });
    expect(titles.at(-1)!.rows.map((r) => r.view.task.id)).toEqual(["story-bank"]);
    expect(titles.at(-1)!.count).toBe(1);
    expect(notesByBlock(s, today, bodies, { q: "story bank", scope: "notes" }).at(-1)!.count).toBe(
      0,
    );
  });
});

describe("removedNotes", () => {
  it("lists only tombstoned Tasks that have a Note, filtered by the search", () => {
    const s = fresh();
    const [a, b] = s.path.blocks[1]!.tasks;
    tombstone(s, a!.id, "2026-09-20T00:00:00.000Z");
    tombstone(s, b!.id, "2026-09-20T00:00:00.000Z");
    editNote(s, `task:${a!.id}`, date(10));
    const bodies = [{ target: `task:${a!.id}`, body: "kept after reload" }];
    expect(removedNotes(s, bodies).map((r) => r.tombstone.taskId)).toEqual([a!.id]);
    expect(removedNotes(s, bodies, { q: "reload", scope: "notes" })).toHaveLength(1);
    expect(removedNotes(s, bodies, { q: "nope", scope: "notes" })).toHaveLength(0);
  });
});
