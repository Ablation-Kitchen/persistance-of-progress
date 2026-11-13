// @vitest-environment jsdom
/**
 * Ticket 10 acceptance: the Path screen against the real server, seeded with core's fixture
 * scenarios (week 4; week 4 after a +2 shift with 2 tombstones).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  blockSignals,
  dateOfDay,
  dayNumber,
  isOptionalPast,
  runInfo,
  taskViews,
  tasksOnDay,
  type Snapshot,
} from "@learning-tracker/core";
import { scenario, type ScenarioName } from "../../../core/src/testing/scenarios";
import { api } from "../api";
import { startServer, type TestServer } from "../test/server";
import { renderApp } from "../test/render";

const NOTE_BODY = "BPE merges, byte fallback; see Karpathy's minbpe for the details of it all.";

let server: TestServer;
let id: string;

beforeEach(async () => {
  server = await startServer();
  id = (
    await api<Snapshot>("POST", "/api/enrollments", {
      source: { file: "eval-infra-17-weeks.yaml" },
      startDate: "2026-09-07",
    })
  ).id;
});

afterEach(async () => {
  cleanup();
  await server.close();
});

/** Write a core scenario's state into the server's database for Enrollment `id`. */
function seed(name: ScenarioName): { snapshot: Snapshot; today: string } {
  const { snapshot, today } = scenario(name);
  const db = server.db;
  db.prepare("UPDATE enrollments SET path_json = ?, reloaded_at = ? WHERE id = ?").run(
    JSON.stringify(snapshot.path),
    snapshot.reloadedAt,
    id,
  );
  const state = db.prepare(
    `INSERT INTO task_states (enrollment_id, task_id, status, status_date, offset_days, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const r of snapshot.taskStates)
    state.run(id, r.taskId, r.status, r.statusDate, r.offsetDays, r.updatedAt);
  for (const s of snapshot.shifts)
    db.prepare(
      "INSERT INTO shifts (enrollment_id, applied_on, days, task_ids, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, s.appliedOn, s.days, JSON.stringify(s.taskIds), s.createdAt);
  for (const x of snapshot.tombstones)
    db.prepare(
      `INSERT INTO tombstones (enrollment_id, task_id, title, kind, former_day, removed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, x.taskId, x.title, x.kind, x.formerDay, x.removedAt);
  for (const n of snapshot.noteMeta) {
    db.prepare(
      `INSERT INTO notes (enrollment_id, target, body, from_template, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
    ).run(
      id,
      n.target,
      n.target.startsWith("task:") ? NOTE_BODY : "a day note",
      n.createdAt,
      n.updatedAt,
    );
    for (const d of n.editedOn)
      db.prepare("INSERT INTO note_edits (enrollment_id, target, edited_on) VALUES (?, ?, ?)").run(
        id,
        n.target,
        d,
      );
  }
  return { snapshot, today };
}

/** Until ticket 08's `GET …/notes` exists, answer it from the database. */
function serveNotesFromDb() {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const res = await real(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (res.status !== 404 || !url.endsWith(`/api/enrollments/${id}/notes`)) return res;
    const rows = server.db
      .prepare("SELECT target, body FROM notes WHERE enrollment_id = ? ORDER BY target")
      .all(id);
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

async function open(url: string) {
  renderApp(url);
  await screen.findByRole("heading", { level: 1, name: "The path." });
}

const block = (n: number) => screen.getByRole("region", { name: new RegExp(`^Block ${n}: `) });
const rowIds = (el: ParentNode = document) =>
  [...el.querySelectorAll<HTMLElement>(".path-main .prows li[data-task]")]
    .filter((li) => !li.closest(".removed"))
    .map((li) => li.dataset.task!);
const expandAll = () => fireEvent.click(screen.getByRole("button", { name: "expand all" }));

describe("Path at week 4 after +2 with 2 tombstones", () => {
  it("shows the shift marker once and 'moved +2d by a shift' once per affected week", async () => {
    const { snapshot, today } = seed("week4Shifted");
    await open(`/path?today=${today}`);
    expandAll();

    const markers = document.querySelectorAll(".shiftmark");
    expect(markers).toHaveLength(1);
    expect(markers[0]!.closest("[role=group]")!.getAttribute("aria-label")).toBe("Week 4");
    expect(markers[0]!.textContent).toMatch(/^shifted \+2d on wed 30 sep · \d+ open tasks moved$/);

    // Every week group holding a moved Task says it once in its heading, and only there.
    const moved = new Set(
      taskViews(snapshot, today)
        .filter((v) => v.offsetDays > 0)
        .map((v) => v.task.id),
    );
    const weeks = [...document.querySelectorAll<HTMLElement>(".blk [role=group]")];
    let affected = 0;
    for (const w of weeks) {
      const hasMoved = rowIds(w).some((t) => moved.has(t));
      const notes = w.querySelectorAll(".moved");
      expect(notes.length).toBe(hasMoved ? 1 : 0);
      if (hasMoved) {
        affected++;
        expect(notes[0]!.textContent).toBe("moved +2d by a shift");
        expect(notes[0]!.closest(".wk-h")).not.toBeNull();
      }
    }
    expect(affected).toBeGreaterThan(5);
    expect(screen.getAllByText("moved +2d by a shift")).toHaveLength(affected);

    // An expanded moved row shows its authored day and offset, not the heading's phrase.
    const movedId = rowIds().find((t) => moved.has(t))!;
    const li = document.querySelector<HTMLElement>(`.prows li[data-task="${movedId}"]`)!;
    fireEvent.click(li.querySelector(".title-btn")!);
    expect(within(li).getByText(/^authored day \d+ · offset \+2d$/)).toBeTruthy();
    expect(li.textContent).not.toContain("by a shift");
  });

  it("lists removed Tasks with kind, former day, status and a Note excerpt", async () => {
    serveNotesFromDb();
    const { snapshot, today } = seed("week4Shifted");
    await open(`/path?today=${today}`);
    const removed = screen.getByRole("region", { name: "Removed from the path" });
    const items = within(removed).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    for (const [i, x] of snapshot.tombstones.entries()) {
      expect(items[i]!.textContent).toContain(x.title);
      expect(items[i]!.textContent).toContain(`${x.kind} · was d${x.formerDay} · todo`);
      expect(
        within(items[i]!).getByRole("link", { name: "open note →" }).getAttribute("href"),
      ).toBe(`/notes?block=removed&note=${encodeURIComponent(`task:${x.taskId}`)}`);
    }
    expect(await within(items[0]!).findByText(`note: “${NOTE_BODY.slice(0, 60)}…”`)).toBeTruthy();
    expect(items[1]!.querySelector(".note-excerpt")).toBeNull();
    expect(
      within(removed).getByRole("link", { name: "all their notes →" }).getAttribute("href"),
    ).toBe("/notes?block=removed");
    // Tombstoned Tasks are not in the outline.
    for (const x of snapshot.tombstones) expect(rowIds()).not.toContain(x.taskId);
  });
});

describe("Path at week 4", () => {
  it("opens Block 2 as current; Block 1 shows real done/required; tags follow §5", async () => {
    const { snapshot, today } = seed("week4");
    await open(`/path?today=${today}`);
    const signals = blockSignals(snapshot, today);
    expect(signals[1]!.state).toBe("current");

    const b2 = block(2);
    expect(b2.dataset.state).toBe("current");
    expect(within(b2).getByRole("button", { expanded: true })).toBeTruthy();
    expect(within(block(1)).getByRole("button", { expanded: false })).toBeTruthy();
    expect(
      within(block(1)).getByText(`${signals[0]!.requiredDone}/${signals[0]!.required} required`),
    ).toBeTruthy();
    expect(signals[0]!.requiredDone).toBeGreaterThan(0);
    signals.forEach((s, i) => {
      expect(block(i + 1).dataset.state).toBe(s.state);
      expect(block(i + 1).querySelector(".state-tag")!.textContent).toBe(s.state);
    });
    const run = runInfo(snapshot, today);
    expect(
      screen.getByText(`day 24 of ${run.length} · week 4 of ${run.weeks} · wed 30 sep`),
    ).toBeTruthy();
    expect(within(b2).getByText("this week")).toBeTruthy();

    // Collapse and expand all.
    fireEvent.click(screen.getByRole("button", { name: "collapse" }));
    expect(document.querySelectorAll(".blk:not(.removed) .blk-body")).toHaveLength(0);
    expandAll();
    expect(rowIds()).toHaveLength(taskViews(snapshot, today).length);
  });

  it("filter overdue shows only overdue rows and survives a refresh", async () => {
    const { snapshot, today } = seed("week4");
    const overdue = taskViews(snapshot, today)
      .filter((v) => v.overdue)
      .map((v) => v.task.id);
    expect(overdue.length).toBeGreaterThan(0);

    await open(`/path?today=${today}`);
    fireEvent.click(screen.getByRole("button", { name: "overdue" }));
    expandAll();
    expect(rowIds().sort()).toEqual([...overdue].sort());

    // A refresh (the URL carries the filter) shows the same.
    cleanup();
    await open(`/path?today=${today}&filter=overdue`);
    expect(screen.getByRole("button", { name: "overdue" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expandAll();
    expect(rowIds().sort()).toEqual([...overdue].sort());
  });

  it("'open day 24 in Today' lands on /today?day=<date> with day 24's Tasks", async () => {
    const { snapshot } = seed("week4");
    const today = dateOfDay(snapshot, 22); // so day 24 isn't today
    const day24 = tasksOnDay(snapshot, today, 24);
    await open(`/path?today=${today}`);
    const li = document.querySelector<HTMLElement>(`.prows li[data-task="${day24[0]!.task.id}"]`)!;
    fireEvent.click(li.querySelector(".title-btn")!);
    const link = within(li).getByRole("link", { name: "open day 24 in Today →" });
    expect(link.getAttribute("href")).toBe(`/today?day=2026-09-30&today=${today}`);
    fireEvent.click(link);
    const middle = await screen.findByRole("region", { name: "Wed 30 sep" });
    expect(
      [...middle.querySelectorAll<HTMLElement>("article[data-task]")].map((a) => a.dataset.task),
    ).toEqual(day24.map((v) => v.task.id));
  });

  it("optional-past rows are muted and tickable; ticking reuses the Task state route", async () => {
    const { snapshot, today } = seed("week4");
    const t = dayNumber(snapshot, today);
    const past = taskViews(snapshot, today).find((v) => isOptionalPast(v, t))!;
    await open(`/path?today=${today}`);
    expandAll();
    const li = document.querySelector<HTMLElement>(`.prows li[data-task="${past.task.id}"]`)!;
    expect(li.className).toContain("muted");
    expect(within(li).getByText("optional · past · still tickable")).toBeTruthy();
    fireEvent.click(within(li).getByRole("button", { name: `Mark done: ${past.task.title}` }));
    await waitFor(() =>
      expect(within(li).getByRole("button", { name: /^Mark not done/ })).toBeTruthy(),
    );
    await waitFor(async () => {
      const saved = await api<Snapshot>("GET", `/api/enrollments/${id}`);
      expect(saved.taskStates.find((r) => r.taskId === past.task.id)).toMatchObject({
        status: "done",
        statusDate: today,
      });
    });
  });
});
