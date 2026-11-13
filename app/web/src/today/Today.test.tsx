// @vitest-environment jsdom
/**
 * Ticket 07 acceptance: the Today screen against the real server, at fixed `today`s through the
 * dev-only `?today=` override. The fixture starts on Monday 2026-09-07, so 2026-09-30 is day 24
 * (week 4, a Wednesday).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  addDays,
  stats,
  todayColumns,
  type Snapshot,
  type TaskStateResponse,
} from "@learning-tracker/core";
import { api } from "../api";
import { startServer, type TestServer } from "../test/server";
import { renderApp } from "../test/render";

const START = "2026-09-07";
const WEEK4 = "2026-09-30"; // day 24

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

const getSnapshot = () => api<Snapshot>("GET", `/api/enrollments/${id}`);
const putState = (taskId: string, status: string, statusDate: string | null) =>
  api<TaskStateResponse>("PUT", `/api/enrollments/${id}/tasks/${taskId}/state`, {
    status,
    statusDate,
  });

async function open(url: string) {
  renderApp(url);
  await screen.findByRole("heading", { level: 1 });
  // Wait for the snapshot, not just the shell.
  await waitFor(() => expect(document.querySelector(".today-hero .stats")).not.toBeNull());
}

const column = (name: string | RegExp) => screen.getByRole("region", { name });
const idsIn = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>("article[data-task]")].map((a) => a.dataset.task);
const stat = (label: string) =>
  [...document.querySelectorAll(".stats div")]
    .find((d) => d.querySelector("dt")?.textContent === label)
    ?.querySelector("dd")?.textContent;
const dotOf = (taskId: string) =>
  document.querySelector(`.week i[data-task="${taskId}"]`)?.className;
const checkOf = (el: HTMLElement, taskId: string) =>
  el.querySelector<HTMLButtonElement>(`article[data-task="${taskId}"] .check`)!;

describe("Today at week 4", () => {
  it("shows core's columns; a tick moves the card, updates stats and strip, and persists", async () => {
    await putState("intro-to-llms", "done", "2026-09-07");
    const before = await getSnapshot();
    const expected = todayColumns(before, WEEK4);
    expect(expected.catchUp.length).toBeGreaterThan(0);
    expect(expected.today.length).toBeGreaterThan(0);

    await open(`/today?today=${WEEK4}`);
    expect(screen.getByRole("heading", { level: 1, name: "Today." })).toBeTruthy();
    expect(screen.getByText(/^day 24 · week 4 of 17 · wed 30 sep/)).toBeTruthy();
    expect(idsIn(column("Catch up"))).toEqual(expected.catchUp.map((v) => v.task.id));
    expect(idsIn(column("Today"))).toEqual(expected.today.map((v) => v.task.id));
    expect(idsIn(column("In progress"))).toEqual(expected.inProgress.map((v) => v.task.id));
    expect(stat("day streak")).toBe("0");

    // Tick a Task scheduled today: its check and strip dot flip, the streak starts.
    const todayTask = expected.today[0]!.task.id;
    expect(dotOf(todayTask)).toBe("open");
    fireEvent.click(checkOf(column("Today"), todayTask));
    await waitFor(() =>
      expect(checkOf(column("Today"), todayTask).getAttribute("aria-pressed")).toBe("true"),
    );
    expect(dotOf(todayTask)).toBe("done");
    expect(stat("day streak")).toBe("1");

    // Tick the oldest overdue Task: it leaves Catch up.
    const overdue = expected.catchUp[0]!.task.id;
    fireEvent.click(checkOf(column("Catch up"), overdue));
    await waitFor(() => expect(idsIn(column("Catch up"))).not.toContain(overdue));

    // Both writes reach the server, and the screen agrees with core on the saved state.
    await waitFor(async () => {
      const saved = await getSnapshot();
      expect(saved.taskStates.filter((r) => r.status === "done")).toHaveLength(3);
    });
    const after = await getSnapshot();
    const s = stats(after, WEEK4);
    expect(stat("required done")).toBe(`${s.percent}%`);
    expect(s.requiredDone).toBe(stats(before, WEEK4).requiredDone + 2);

    // A refresh shows the same state.
    cleanup();
    await open(`/today?today=${WEEK4}`);
    expect(checkOf(column("Today"), todayTask).getAttribute("aria-pressed")).toBe("true");
    expect(idsIn(column("Catch up"))).not.toContain(overdue);
    expect(stat("day streak")).toBe("1");
    // The per-Block bars add up to the required Tasks done.
    const bars = within(screen.getByRole("list", { name: "Required tasks done per block" }));
    const doneInBars = bars
      .getAllByRole("listitem")
      .map((li) => Number(/: (\d+) of/.exec(li.getAttribute("aria-label")!)![1]))
      .reduce((a, b) => a + b, 0);
    expect(doneInBars).toBe(s.requiredDone);
  });

  it("rolls a tick back and shows a toast when the server is unreachable", async () => {
    await open(`/today?today=${WEEK4}`);
    const taskId = idsIn(column("Today"))[0]!;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (input, init) =>
      init?.method === "PUT"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : realFetch(input, init);
    try {
      fireEvent.click(checkOf(column("Today"), taskId));
      expect(await screen.findByText("Couldn't save, try again")).toBeTruthy();
      expect(checkOf(column("Today"), taskId).getAttribute("aria-pressed")).toBe("false");
      expect(dotOf(taskId)).toBe("open");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect((await getSnapshot()).taskStates).toEqual([]);
  });

  it("rolls back a failed untick of a Task that already has a state record", async () => {
    await open(`/today?today=${WEEK4}`);
    const taskId = idsIn(column("Today"))[0]!;
    fireEvent.click(checkOf(column("Today"), taskId));
    await waitFor(async () =>
      expect((await getSnapshot()).taskStates.map((r) => r.status)).toEqual(["done"]),
    );
    const realFetch = globalThis.fetch;
    globalThis.fetch = (input, init) =>
      init?.method === "PUT"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : realFetch(input, init);
    try {
      fireEvent.click(checkOf(column("Today"), taskId));
      expect(await screen.findByText("Couldn't save, try again")).toBeTruthy();
      expect(checkOf(column("Today"), taskId).getAttribute("aria-pressed")).toBe("true");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("skip and unskip from a card", async () => {
    await open(`/today?today=${WEEK4}`);
    const today = column("Today");
    const taskId = idsIn(today)[0]!;
    const card = today.querySelector<HTMLElement>(`article[data-task="${taskId}"]`)!;
    fireEvent.click(within(card).getByRole("button", { name: "skip" }));
    expect(await within(card).findByText("skipped")).toBeTruthy();
    expect(dotOf(taskId)).toBe("skipped");
    fireEvent.click(within(card).getByRole("button", { name: "unskip" }));
    await waitFor(async () =>
      expect((await getSnapshot()).taskStates[0]).toMatchObject({
        status: "todo",
        statusDate: null,
      }),
    );
  });

  it("more/less expands a card's description", async () => {
    await open(`/today?today=${WEEK4}`);
    const more = within(column("Today")).getAllByRole("button", { name: "more +" })[0]!;
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(more.textContent).toBe("less −");
  });

  it("?day= shows another date's Tasks, labelled past and tickable", async () => {
    const past = "2026-09-28"; // day 22, Monday of week 4
    const expected = todayColumns(await getSnapshot(), past).today;
    await open(`/today?today=${WEEK4}&day=${past}`);
    const middle = column("Mon 28 sep");
    expect(within(middle).getByText(/· past$/)).toBeTruthy();
    expect(idsIn(middle)).toEqual(expected.map((v) => v.task.id));
    const strip = screen.getByRole("group", { name: "Week 4" });
    expect(
      within(strip)
        .getByRole("button", { name: /^mon 28 sep/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    const taskId = expected[0]!.task.id;
    fireEvent.click(checkOf(middle, taskId));
    await waitFor(async () =>
      expect((await getSnapshot()).taskStates[0]).toMatchObject({
        taskId,
        status: "done",
        statusDate: WEEK4,
      }),
    );

    // Back to today; a date in an earlier week moves the strip to that week.
    fireEvent.click(within(middle).getByRole("button", { name: "← back to today" }));
    expect(column("Today")).toBeTruthy();
    cleanup();
    await open(`/today?today=${WEEK4}&day=2026-09-08`);
    expect(screen.getByRole("group", { name: "Week 1" })).toBeTruthy();
    expect(column("Tue 8 sep")).toBeTruthy();
  });

  it("clicking a strip day selects it; clicking it again returns to today", async () => {
    await open(`/today?today=${WEEK4}`);
    const strip = screen.getByRole("group", { name: "Week 4" });
    fireEvent.click(within(strip).getByRole("button", { name: /^thu 1 oct/ }));
    const ahead = column("Thu 1 oct");
    expect(within(ahead).getByText(/· ahead$/)).toBeTruthy();
    fireEvent.click(within(strip).getByRole("button", { name: /^thu 1 oct/ }));
    expect(column("Today")).toBeTruthy();
  });

  it("back-dating Done to yesterday sets statusDate and the streak counts it", async () => {
    const yesterday = addDays(WEEK4, -1);
    await open(`/today?today=${WEEK4}`);
    const today = column("Today");
    const taskId = idsIn(today)[0]!;
    fireEvent.click(today.querySelector<HTMLElement>(`article[data-task="${taskId}"] .title-btn`)!);
    const pane = screen.getByRole("complementary", { name: "Details and notes" });
    fireEvent.change(within(pane).getByLabelText("did it on"), { target: { value: yesterday } });
    fireEvent.click(within(pane).getByRole("button", { name: /^(Done|Yes, I can)$/ }));

    await waitFor(async () =>
      expect((await getSnapshot()).taskStates[0]).toMatchObject({
        taskId,
        status: "done",
        statusDate: yesterday,
      }),
    );
    expect(stat("day streak")).toBe("1");
    expect(within(pane).getByText(/^done tue 29 sep/)).toBeTruthy();
    expect(within(pane).getByRole("button", { name: "Mark not done" })).toBeTruthy();
  });
});

describe("edges of the run", () => {
  it("before the start: Almost ready, a countdown and a tickable day 1, no strip", async () => {
    const day1 = todayColumns(await getSnapshot(), START).today;
    await open(`/today?today=${addDays(START, -3)}`);
    expect(screen.getByRole("heading", { level: 1, name: "Almost ready." })).toBeTruthy();
    expect(screen.getByText(/^starts mon 7 sep · in 3 days$/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: /^Week/ })).toBeNull();
    const col = column("Day 1");
    expect(idsIn(col)).toEqual(day1.map((v) => v.task.id));
    fireEvent.click(checkOf(col, day1[0]!.task.id));
    await waitFor(async () =>
      expect((await getSnapshot()).taskStates[0]).toMatchObject({ status: "done" }),
    );
  });

  it("after the end: You finished it, the summary and Still open", async () => {
    const end = "2027-02-01";
    const snap = await getSnapshot();
    const leftover = todayColumns(snap, end).catchUp;
    await open(`/today?today=${end}`);
    expect(screen.getByRole("heading", { level: 1, name: "You finished it." })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /^Week/ })).toBeNull();
    expect(stat("longest streak")).toBe("0");
    expect(stat("required done")).toBe("0%");
    const s = stats(snap, end);
    expect(screen.getByRole("heading", { level: 2, name: `0 of ${s.required}` })).toBeTruthy();
    expect(idsIn(column("Still open"))).toEqual(leftover.map((v) => v.task.id));
  });
});
