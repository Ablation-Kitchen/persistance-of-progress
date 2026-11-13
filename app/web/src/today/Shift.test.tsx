// @vitest-environment jsdom
/** Ticket 09: the Catch up shift control and undo, against the real server at week 4. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { todayColumns, type Snapshot } from "@learning-tracker/core";
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
const catchUp = () => screen.getByRole("region", { name: "Catch up" });
const idsIn = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>("article[data-task]")].map((a) => a.dataset.task);

async function open(url = `/today?today=${WEEK4}`) {
  renderApp(url);
  await screen.findByRole("heading", { level: 1, name: "Today." });
  await waitFor(() => expect(document.querySelector(".today-hero .stats")).not.toBeNull());
}

describe("shift control", () => {
  it("confirms with the open-task count, shifts, updates Catch up, and undoes", async () => {
    const before = await getSnapshot();
    const overdue = todayColumns(before, WEEK4).catchUp;
    const openCount = before.path.blocks.flatMap((b) => b.tasks).length;
    await open();

    const control = within(catchUp()).getByRole("group", { name: "Schedule shift" });
    fireEvent.change(within(control).getByLabelText("shift open tasks by"), {
      target: { value: "2" },
    });
    fireEvent.click(within(control).getByRole("button", { name: "Shift…" }));
    expect(within(control).getByText(`${openCount} open tasks will move +2 days.`)).toBeTruthy();
    fireEvent.click(within(control).getByRole("button", { name: `Move ${openCount} tasks` }));

    const expected = overdue.filter((v) => v.daysOverdue > 2).map((v) => v.task.id);
    await waitFor(() => expect(idsIn(catchUp())).toEqual(expected));
    const shifted = await getSnapshot();
    expect(shifted.shifts).toEqual([
      expect.objectContaining({ days: 2, appliedOn: WEEK4, undoable: true }),
    ]);

    const undo = within(catchUp()).getByRole("button", { name: "Undo +2d" });
    expect(within(catchUp()).getByText(`shifted wed 30 sep · ${openCount} tasks`)).toBeTruthy();
    fireEvent.click(undo);
    await waitFor(() => expect(idsIn(catchUp())).toEqual(overdue.map((v) => v.task.id)));
    expect(within(catchUp()).queryByRole("button", { name: /^Undo/ })).toBeNull();
    expect((await getSnapshot()).taskStates.every((r) => r.offsetDays === 0)).toBe(true);
  });

  it("cancel leaves everything as it was; invalid day counts can't be submitted", async () => {
    await open();
    const control = within(catchUp()).getByRole("group", { name: "Schedule shift" });
    const input = within(control).getByLabelText("shift open tasks by");
    for (const bad of ["0", "366", "1.5", ""]) {
      fireEvent.change(input, { target: { value: bad } });
      expect(within(control).getByRole("button", { name: "Shift…" }).hasAttribute("disabled")).toBe(
        true,
      );
    }
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.click(within(control).getByRole("button", { name: "Shift…" }));
    fireEvent.click(within(control).getByRole("button", { name: "Cancel" }));
    expect(within(control).getByRole("button", { name: "Shift…" })).toBeTruthy();
    expect((await getSnapshot()).shifts).toEqual([]);
  });

  it("shows a spinner while the server confirms", async () => {
    await open();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (init?.method === "POST") await gate;
      return realFetch(input, init);
    };
    try {
      const control = within(catchUp()).getByRole("group", { name: "Schedule shift" });
      fireEvent.click(within(control).getByRole("button", { name: "Shift…" }));
      fireEvent.click(within(control).getByRole("button", { name: /^Move \d+ tasks$/ }));
      expect(await within(control).findByRole("button", { name: "Shifting…" })).toBeTruthy();
      release();
      expect(await within(catchUp()).findByRole("button", { name: "Undo +1d" })).toBeTruthy();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("undo stays available when Catch up is empty", async () => {
    await api("POST", `/api/enrollments/${id}/shifts`, { days: 30, appliedOn: WEEK4 });
    await open();
    expect(idsIn(catchUp())).toEqual([]);
    const control = within(catchUp()).getByRole("group", { name: "Schedule shift" });
    expect(within(control).queryByLabelText("shift open tasks by")).toBeNull();
    fireEvent.click(within(control).getByRole("button", { name: "Undo +30d" }));
    await waitFor(() => expect(idsIn(catchUp()).length).toBeGreaterThan(0));
  });

  it("shows the server's error when undo is refused", async () => {
    await api("POST", `/api/enrollments/${id}/shifts`, { days: 1, appliedOn: WEEK4 });
    await open();
    // Another tab undid it first: the cached snapshot still offers undo, the server says 409.
    await api("DELETE", `/api/enrollments/${id}/shifts/latest`);
    fireEvent.click(within(catchUp()).getByRole("button", { name: "Undo +1d" }));
    expect((await within(catchUp()).findByRole("alert")).textContent).toMatch(/no shift to undo/);
  });
});
