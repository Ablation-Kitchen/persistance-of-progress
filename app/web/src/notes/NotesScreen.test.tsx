// @vitest-environment jsdom
/**
 * Ticket 12 acceptance: the Notes screen against the real server. The fixture starts Monday
 * 2026-09-07; 2026-12-27 is day 112 (week 16), inside Block 6 "Interview prep", which holds the
 * story bank (day 106), a reached reflection (day 111) and a future one (day 118).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { NoteBody, PutNoteBody, Snapshot } from "@learning-tracker/core";
import { api } from "../api";
import { startServer, type TestServer } from "../test/server";
import { renderApp } from "../test/render";

const START = "2026-09-07";
const WEEK16 = "2026-12-27"; // day 112

let server: TestServer;
let id: string;

beforeEach(async () => {
  server = await startServer();
  id = (
    await api<Snapshot>("POST", "/api/enrollments", {
      source: { file: "eval-infra-17-weeks.yaml" },
      startDate: START,
    })
  ).id;
});

afterEach(async () => {
  cleanup();
  await server.close();
});

const putNote = (target: string, body: string, editedOn: string, fromTemplate?: boolean) =>
  api("PUT", `/api/enrollments/${id}/notes/${encodeURIComponent(target)}`, {
    body,
    editedOn,
    ...(fromTemplate !== undefined && { fromTemplate }),
  } satisfies PutNoteBody);
const getNotes = () => api<NoteBody[]>("GET", `/api/enrollments/${id}/notes`);

const HALF_BANK = [
  "| Posting bullet | My story (situation, action, result) | Numbers |",
  "| --- | --- | --- |",
  "| Highly reliable, easy-to-use infrastructure | Rebuilt the deploy pipeline | 99.95% |",
  "| Resolving a performance bottleneck | Cut p95 by batching writes | 4x |",
  "| Large-scale distributed systems |  |  |",
].join("\n");

async function open(url: string) {
  renderApp(url);
  await screen.findByRole("heading", { level: 1, name: "Notes, by block." });
}
const chip = (name: RegExp) =>
  within(screen.getByRole("group", { name: "Blocks" })).getByRole("button", { name });
const row = (target: string) =>
  document.querySelector<HTMLElement>(`.trow[data-target="${target}"]`);

describe("Notes at week 16", () => {
  it("shows the written story bank, unwritten reached reflections and future ones", async () => {
    await putNote("task:story-bank", HALF_BANK, "2026-12-22", true);
    await putNote("day:2026-12-23", "Mock interview went fine.", "2026-12-23");
    await open(`/notes?today=${WEEK16}`);

    // Block 6 is current and selected.
    expect(chip(/^06 Interview prep/).getAttribute("aria-pressed")).toBe("true");
    const main = screen.getByRole("region", { name: "Block 6" });
    expect(within(main).getByText(/1 task note · reflections 0\/1 written so far/)).toBeTruthy();

    // The written table, with its trail and the from-template tag.
    const bank = row("task:story-bank")!;
    expect(bank.querySelector("table")).not.toBeNull();
    expect(within(bank).getByText("Cut p95 by batching writes")).toBeTruthy();
    expect(within(bank).getByText("from template")).toBeTruthy();
    expect(within(bank).getByText(/edited on tue 22 dec/)).toBeTruthy();
    expect(within(bank).getByRole("button", { name: "more +" })).toBeTruthy();

    // A reached reflection without a Note: a dashed "not written yet" gap with Write.
    const due = row("task:learnings-week-16")!;
    expect(due.querySelector(".gap.due")?.textContent).toContain("not written yet");
    expect(within(due).getByRole("button", { name: "Write" })).toBeTruthy();

    // A future reflection: "opens <date>", nothing to write yet.
    const future = row("task:learnings-week-17")!;
    expect(future.querySelector(".gap")?.textContent).toContain("opens sat 2 jan");
    expect(within(future).queryByRole("button", { name: "Write" })).toBeNull();

    // A reached exercise gets "+ note"; future exercises are hidden.
    expect(
      within(row("task:leetcode-week-16")!).getByRole("button", { name: "+ note" }),
    ).toBeTruthy();
    expect(row("task:design-agentic-eval-runner")).toBeNull();

    // Day Notes: the written one and today's slot.
    const days = screen.getByRole("complementary", { name: "Day notes" });
    expect(within(days).getByText("Mock interview went fine.")).toBeTruthy();
    expect(within(days).getByText(/sun 27 dec · today/)).toBeTruthy();
    expect(within(days).getByRole("button", { name: "+ write" })).toBeTruthy();

    // Header stats.
    const stat = (label: string) =>
      [...document.querySelectorAll(".stats div")]
        .find((d) => d.querySelector("dt")?.textContent === label)
        ?.querySelector("dd")?.textContent;
    expect(stat("notes")).toBe("2");
    expect(stat("days with an edit")).toBe("2");
  });

  it("Write on a gap opens the drawer with the Task's description as the prompt", async () => {
    await open(`/notes?today=${WEEK16}`);
    fireEvent.click(within(row("task:learnings-week-16")!).getByRole("button", { name: "Write" }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("heading", { level: 2 }).textContent).toBeTruthy();
    expect(drawer.querySelector(".drawer-prompt")).not.toBeNull();
    fireEvent.change(within(drawer).getByRole("textbox"), { target: { value: "Learned a lot." } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    await waitFor(async () =>
      expect(await getNotes()).toContainEqual({
        target: "task:learnings-week-16",
        body: "Learned a lot.",
      }),
    );
    // The row now shows the written Note instead of the gap.
    await waitFor(() => expect(row("task:learnings-week-16")?.querySelector(".gap")).toBeNull());
  });

  it("a word found only in another Block's Note shows a match count on that Block's chip", async () => {
    await putNote("day:2026-09-09", "Zanzibar keeps coming up.", "2026-09-09");
    await putNote("task:story-bank", HALF_BANK, "2026-12-22", true);
    await open(`/notes?today=${WEEK16}`);
    expect(chip(/^01 /).textContent).toMatch(/ 1$/);
    expect(chip(/^06 /).textContent).toMatch(/ 1$/);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search notes" }), {
      target: { value: "zanzibar" },
    });
    await waitFor(() => expect(chip(/^06 /).textContent).toMatch(/ 0$/));
    expect(chip(/^01 /).textContent).toMatch(/ 1$/);
    expect(
      within(screen.getByRole("region", { name: "Block 6" })).getByText("no matches in this block"),
    ).toBeTruthy();

    fireEvent.click(chip(/^01 /));
    const days = screen.getByRole("complementary", { name: "Day notes" });
    expect(days.querySelector("mark")?.textContent).toBe("Zanzibar");
  });

  it("the scope toggle decides whether Task titles match; state lives in the URL", async () => {
    await open(`/notes?today=${WEEK16}&q=story%20bank`);
    expect(row("task:story-bank")?.querySelector("mark")?.textContent).toBe("story bank");
    fireEvent.click(screen.getByRole("button", { name: "note text" }));
    await waitFor(() => expect(row("task:story-bank")).toBeNull());
    expect(screen.getByRole("button", { name: "note text" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    cleanup();
    await open(`/notes?today=${WEEK16}&q=story%20bank&scope=notes&block=6`);
    expect(row("task:story-bank")).toBeNull();
    expect(
      (screen.getByRole("searchbox", { name: "Search notes" }) as HTMLInputElement).value,
    ).toBe("story bank");
  });
});

describe("URL and edge cases", () => {
  it("/notes?note=day:2026-12-09 opens the drawer on that Day Note", async () => {
    await putNote("day:2026-12-09", "Slow session.", "2026-12-09");
    await open(`/notes?today=${WEEK16}&note=${encodeURIComponent("day:2026-12-09")}`);
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("heading", { level: 2, name: "wed 9 dec" })).toBeTruthy();
    expect(((await within(drawer).findByRole("textbox")) as HTMLTextAreaElement).value).toBe(
      "Slow session.",
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("an unknown note target opens nothing", async () => {
    await open(`/notes?today=${WEEK16}&note=${encodeURIComponent("task:no-such-task")}`);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the Removed tasks chip lists tombstoned Tasks with Notes, and they can be edited", async () => {
    for (const [task, title] of [
      ["gone-task", "A task that was removed"],
      ["gone-quiet", "Removed without a note"],
    ] as const)
      server.db
        .prepare(
          `INSERT INTO tombstones (enrollment_id, task_id, title, kind, former_day, removed_at)
           VALUES (?, ?, ?, 'reflection', 12, '2026-10-01T00:00:00.000Z')`,
        )
        .run(id, task, title);
    await putNote("task:gone-task", "Kept after the reload.", "2026-09-18");

    await open(`/notes?today=${WEEK16}&block=removed`);
    const removedChip = chip(/^Removed tasks/);
    expect(removedChip.getAttribute("aria-pressed")).toBe("true");
    expect(removedChip.textContent).toMatch(/ 1$/);
    const panel = screen.getByRole("region", { name: "Removed tasks" });
    expect(within(panel).getByText("A task that was removed")).toBeTruthy();
    expect(within(panel).queryByText("Removed without a note")).toBeNull();
    expect(within(panel).getByText(/was day 12/)).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    const drawer = await screen.findByRole("dialog");
    expect(drawer.querySelector(".drawer-top .mono")?.textContent).toBe(
      "reflection · was day 12 · removed",
    );
    fireEvent.change(await within(drawer).findByRole("textbox"), {
      target: { value: "Kept, and edited later." },
    });
    fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    await waitFor(async () =>
      expect(await getNotes()).toContainEqual({
        target: "task:gone-task",
        body: "Kept, and edited later.",
      }),
    );
  });

  it("the Enrollment Note card renders the Note and opens it for editing", async () => {
    await putNote("enrollment", "## Why\nClose the gap.", "2026-09-07");
    await open(`/notes?today=${WEEK16}`);
    const card = screen.getByRole("region", { name: "About this run" });
    expect(within(card).getByText("Close the gap.")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("heading", { level: 2, name: "About this run" })).toBeTruthy();
  });
});
