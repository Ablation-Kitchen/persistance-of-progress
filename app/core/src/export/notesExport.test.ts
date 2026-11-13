import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays } from "../dates/dates.js";
import type { NoteBodyLike } from "../signals/notes.js";
import {
  FIXTURE_START,
  applyShift,
  editNote,
  emptySnapshot,
  fixturePath,
  scenario,
  tombstone,
} from "../testing/scenarios.js";
import { demoteHeadings, notesExport } from "./notesExport.js";

const GOLDEN = new URL("./notes-export.golden.md", import.meta.url);

const STORY_BANK = `| Posting bullet | My story (situation, action, result) | Numbers |
| --- | --- | --- |
| Highly reliable, easy-to-use infrastructure | Rebuilt the batch runner so killed workers resume | 0 lost jobs in 3 weeks |
| Collaborating with other teams on internal tooling | Shared eval harness with the data team | 4 teams onboarded |
| Resolving a performance bottleneck | Found decode was memory-bound; batched it | 3.1× tokens/s |
| Large-scale distributed systems |  |  |
| Diving deep into a hard bug at any level of the stack |  |  |
| Capstone: eval platform and benchmark report |  |  |`;

/**
 * The seeded week-16 scenario (spec §12): history up to day 110, a Day Note every 3 days, the
 * story bank half filled from its template, an exercise Note with headings and fenced code, a
 * removed Task with a Note, the Enrollment Note, and a +2 shift applied today.
 */
function week16() {
  const { snapshot: s, today } = scenario("week16");
  const bodies: NoteBodyLike[] = [];
  for (const meta of s.noteMeta) {
    const date = meta.target.slice(4);
    bodies.push({ target: meta.target, body: `Studied for an hour on ${date}.\n` });
  }
  const note = (target: string, body: string, ...dates: string[]) => {
    editNote(s, target, ...dates);
    bodies.push({ target, body });
  };

  note(
    "enrollment",
    "# Why\n\nGet the eval-infra job.\n\n## Rules\n\n- One hour a day, minimum.\n",
  );
  note("task:story-bank", `${STORY_BANK}\n`, addDays(today, -2), today);
  s.noteMeta.find((m) => m.target === "task:story-bank")!.fromTemplate = true;
  note(
    "task:build-gpt-from-scratch",
    "# Takeaways\n\nAttention is a weighted average.\n\n## Numbers\n\n```python\n# not a heading\nloss = 1.47\n```\n",
    "2026-09-08",
  );
  note("task:learnings-week-1", "Good first week.", "2026-09-12");
  // A blank Note is still a Note, but there is nothing to export.
  note("task:intro-to-llms", "   \n", "2026-09-07");

  const removed = s.path.blocks[5]!.tasks.filter((t) => t.day > 112).at(-1)!;
  tombstone(s, removed.id, "2026-12-20T09:00:00.000Z");
  note(`task:${removed.id}`, "Notes on a Task that was later cut.\n", "2026-12-19");
  s.reloadedAt = "2026-12-20T09:00:00.000Z";

  applyShift(s, 2, today, "2026-12-25T09:00:00.000Z");
  return { s, today, bodies, removed };
}

describe("notesExport", () => {
  it("matches the golden file for the seeded week-16 scenario", () => {
    const { s, today, bodies } = week16();
    const { markdown } = notesExport(s, bodies, today);
    if (process.env.UPDATE_GOLDEN) writeFileSync(GOLDEN, markdown);
    expect(markdown).toBe(readFileSync(GOLDEN, "utf8"));
  });

  it("names the file <path-id>_<start>_notes_<today>.md", () => {
    const { s, today, bodies } = week16();
    expect(today).toBe("2026-12-25");
    expect(notesExport(s, bodies, today).filename).toBe(
      "eval-infra-17-weeks_2026-09-07_notes_2026-12-25.md",
    );
  });

  it("keeps the story-bank table byte for byte and marks it from template", () => {
    const { s, today, bodies } = week16();
    const { markdown } = notesExport(s, bodies, today);
    expect(markdown).toContain(`${STORY_BANK}\n`);
    expect(markdown).toMatch(
      /##### Fill in the story bank\n\n_exercise · due day \d+ · .* · from template_\n\n\| Posting bullet/,
    );
  });

  it("leaves out weeks and days without Notes, and blank Notes", () => {
    const { s, today, bodies } = week16();
    const md = notesExport(s, bodies, today).markdown;
    const dated = new Set(
      bodies.filter((b) => b.target.startsWith("day:")).map((b) => b.target.slice(4)),
    );
    for (const m of md.matchAll(/^#### \w{3} (\d{4}-\d{2}-\d{2})/gm)) {
      const date = m[1]!;
      const section = md.slice(m.index).split(/\n#{1,4} /)[0]!;
      expect(dated.has(date) || section.includes("\n##### "), date).toBe(true);
    }
    const blank = s.path.blocks[0]!.tasks.find((t) => t.id === "intro-to-llms")!.title;
    expect(md).not.toContain(blank);
    // Day Notes fall every 3 days, so no exported week is empty.
    for (const w of md.matchAll(/^### Week \d+[^\n]*\n\n(?:_shifted[^\n]*\n\n)?([^\n]*)/gm)) {
      expect(w[1]).toMatch(/^#### /);
    }
  });

  it("puts a shifted Task's Note under its effective day", () => {
    const { path, hash } = fixturePath();
    const s = emptySnapshot(structuredClone(path), FIXTURE_START, hash);
    applyShift(s, 3, "2026-09-07", "2026-09-07T09:00:00.000Z");
    editNote(s, "task:learnings-week-1", "2026-09-15");
    const md = notesExport(
      s,
      [{ target: "task:learnings-week-1", body: "Shifted." }],
      "2026-09-15",
    ).markdown;
    // Authored on day 6 (Sat 2026-09-12); +3 puts it on day 9, Tue 2026-09-15, in week 2.
    // The shift was applied in week 1, which has no Notes, so its line opens week 2.
    expect(md).toContain(
      "### Week 2 · 2026-09-14 – 2026-09-20\n\n_shifted +3d on 2026-09-07_\n\n#### Tue 2026-09-15 · day 9\n\n##### Week 1 review",
    );
    expect(md).not.toContain("2026-09-12");
  });

  it("shows each shift once, under the week it was applied in", () => {
    const { s, today, bodies } = week16();
    const md = notesExport(s, bodies, today).markdown;
    expect(md.match(/_shifted \+2d on 2026-12-25_/g)).toHaveLength(1);
    expect(md).toMatch(/### Week 16 · [^\n]*\n\n_shifted \+2d on 2026-12-25_/);
  });

  it("orders a day's Day Note before its Task Notes, in path order", () => {
    const { path, hash } = fixturePath();
    const s = emptySnapshot(structuredClone(path), FIXTURE_START, hash);
    // Both Tasks are on day 15 (Mon 2026-09-21), in this array order in the file.
    const notes = [
      { target: "task:scaling-book-inference", body: "C" },
      { target: "task:transformer-inference-arithmetic", body: "A" },
      { target: "day:2026-09-21", body: "Day." },
    ];
    const md = notesExport(s, notes, "2026-09-22").markdown;
    const title = path.blocks[0]!.tasks.find(
      (t) => t.id === "transformer-inference-arithmetic",
    )!.title;
    expect(md).toContain(`#### Mon 2026-09-21 · day 15\n\nDay.\n\n##### ${title}`);
    expect(md.indexOf("\nA\n")).toBeLessThan(md.indexOf("\nC\n"));
  });

  it("lists removed Tasks' Notes in a final section", () => {
    const { s, today, bodies, removed } = week16();
    const md = notesExport(s, bodies, today).markdown;
    const section = md.slice(md.indexOf("## Removed tasks"));
    expect(section).toBe(
      `## Removed tasks\n\n##### ${removed.title}\n\n_${removed.kind} · former day ${removed.day} · removed from the path on 2026-12-20_\n\nNotes on a Task that was later cut.\n`,
    );
  });

  it("puts a Day Note outside every Block range under the nearest earlier Block", () => {
    const { path, hash } = fixturePath();
    const s = emptySnapshot(structuredClone(path), FIXTURE_START, hash);
    const after = addDays(FIXTURE_START, 200);
    const md = notesExport(s, [{ target: `day:${after}`, body: "Long after." }], after).markdown;
    expect(md).toContain(`## Block 6 · ${path.blocks[5]!.title}`);
    expect(md).toContain("Long after.");
  });
});

describe("demoteHeadings", () => {
  it("Task Notes: # → ######, ## and deeper → bold", () => {
    expect(demoteHeadings("# Heading\n## Sub\n### Deeper", 6)).toBe(
      "###### Heading\n**Sub**\n**Deeper**",
    );
  });

  it("Day Notes start at #####, the Enrollment Note at ###", () => {
    expect(demoteHeadings("# a\n## b\n### c", 5)).toBe("##### a\n###### b\n**c**");
    expect(demoteHeadings("# a\n## b\n#### d\n##### e", 3)).toBe("### a\n#### b\n###### d\n**e**");
  });

  it("leaves fenced code alone, including tilde fences and longer closers", () => {
    const body = "```\n# kept\n```\n# moved\n~~~~md\n## kept\n~~~\n## still kept\n~~~~~\n## moved";
    expect(demoteHeadings(body, 6)).toBe(
      "```\n# kept\n```\n###### moved\n~~~~md\n## kept\n~~~\n## still kept\n~~~~~\n**moved**",
    );
  });

  it("handles closing hashes, indented headings and non-headings", () => {
    expect(demoteHeadings("  # Title ##\n#hashtag\n    # code", 6)).toBe(
      "###### Title\n#hashtag\n    # code",
    );
  });
});
