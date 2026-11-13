// @vitest-environment jsdom
/**
 * Ticket 11 acceptance: the Resource Index on the Path screen, against the real server with the
 * 17-week fixture (start Monday 2026-09-07, viewed at week 4 through the dev `?today=` override).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { resourceIndex, type Snapshot, type TaskStateResponse } from "@learning-tracker/core";
import { api } from "../api";
import { startServer, type TestServer } from "../test/server";
import { renderApp } from "../test/render";

const TODAY = "2026-09-30";
const DDIA = "book:designing data intensive applications";

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

const done = (taskId: string) =>
  api<TaskStateResponse>("PUT", `/api/enrollments/${id}/tasks/${taskId}/state`, {
    status: "done",
    statusDate: TODAY,
  });

async function open() {
  renderApp(`/path?today=${TODAY}`);
  await screen.findByRole("heading", { level: 1, name: "The path." });
  return screen.getByRole("complementary", { name: "Resource index" });
}

const entries = (side: HTMLElement) => [...side.querySelectorAll<HTMLElement>("li.res-entry")];
const keys = (side: HTMLElement) => entries(side).map((li) => li.dataset.key);
const entry = (side: HTMLElement, key: string) =>
  side.querySelector<HTMLElement>(`li.res-entry[data-key="${key}"]`)!;

describe("Resource Index", () => {
  it("lists 49 entries from 5 core + 50 task links; Karpathy is a whole-path reference", async () => {
    const side = await open();
    expect(within(side).getByText(/^49 entries · from 5 core \+ 50 task links$/)).toBeTruthy();
    expect(entries(side)).toHaveLength(49);
    expect(side.querySelectorAll(".tag.core")).toHaveLength(5);
    const karpathy = entries(side).find((li) => li.textContent!.includes("Karpathy's YouTube"))!;
    expect(
      within(karpathy).getByText("not linked from a task · whole-path reference"),
    ).toBeTruthy();
    expect(within(karpathy).getByRole("link").getAttribute("target")).toBe("_blank");
  });

  it("merges the Kleppmann spellings under the core title, with the other spelling listed", async () => {
    const side = await open();
    const ddia = entry(side, DDIA);
    expect(ddia.querySelector(".res-title")!.textContent).toContain(
      "Designing Data-Intensive Applications (Martin Kleppmann)",
    );
    expect(within(ddia).getByText("book")).toBeTruthy();
    expect(within(ddia).getByText("core")).toBeTruthy();
    expect(
      within(ddia).getByText("also listed as “Designing Data-Intensive Applications (Kleppmann)”"),
    ).toBeTruthy();
    expect(
      within(ddia)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["d31", "d38"]);
    expect(
      entries(side).filter((li) => li.textContent!.includes("Designing Data-Intensive")),
    ).toHaveLength(1);
  });

  it("searching a Task title finds the resources that Task uses", async () => {
    const snapshot = await api<Snapshot>("GET", `/api/enrollments/${id}`);
    const index = resourceIndex(snapshot, TODAY);
    const task = snapshot.path.blocks
      .flatMap((b) => b.tasks)
      .find((t) => t.id === "ddia-stream-processing")!;
    const expected = index
      .filter((e) => e.uses.some((u) => u.taskId === task.id))
      .map((e) => e.key);

    const side = await open();
    fireEvent.change(within(side).getByRole("searchbox", { name: "Search resources" }), {
      target: { value: task.title },
    });
    expect(keys(side)).toEqual(expect.arrayContaining(expected));
    expect(keys(side)).toContain(DDIA);
    expect(within(side).getByText(new RegExp(`^${keys(side).length} of 49 `))).toBeTruthy();

    fireEvent.change(within(side).getByRole("searchbox"), { target: { value: "zzz-nothing" } });
    expect(within(side).getByText("no resources match “zzz-nothing”")).toBeTruthy();
  });

  it("still to use hides entries whose using Tasks are all done", async () => {
    await done("ddia-distributed-trouble");
    await done("ddia-stream-processing");
    const side = await open();
    const ddia = entry(side, DDIA);
    expect(
      within(ddia)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["d31 ✓", "d38 ✓"]);
    fireEvent.click(within(side).getByRole("button", { name: "still to use" }));
    expect(keys(side)).not.toContain(DDIA);
    expect(entries(side).every((li) => li.querySelector(".use:not(.done)"))).toBe(true);

    fireEvent.click(within(side).getByRole("button", { name: "core" }));
    expect(entries(side)).toHaveLength(5);
    fireEvent.click(within(side).getByRole("button", { name: "books" }));
    expect(entries(side).every((li) => li.querySelector(".tag")?.textContent === "book")).toBe(
      true,
    );
  });

  it("orders by first use (default), by Block with whole-path references first, and A–Z", async () => {
    const snapshot = await api<Snapshot>("GET", `/api/enrollments/${id}`);
    const index = resourceIndex(snapshot, TODAY);
    const side = await open();
    expect(keys(side)).toEqual(index.map((e) => e.key));

    fireEvent.click(within(side).getByRole("button", { name: "by block" }));
    const groups = [...side.querySelectorAll("section")].map((s) => s.getAttribute("aria-label"));
    expect(groups[0]).toBe("Whole path");
    expect(groups.slice(1)).toEqual(
      snapshot.path.blocks.map((b) => b.title).filter((t) => groups.includes(t)),
    );

    fireEvent.click(within(side).getByRole("button", { name: "a–z" }));
    const titles = entries(side).map((li) => li.querySelector(".res-title")!.textContent!.trim());
    expect(titles).toEqual(
      [...titles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    );
  });

  it("a use chip opens its Task in the Outline: Block open, filter cleared, row expanded", async () => {
    renderApp(`/path?today=${TODAY}&filter=done`);
    await screen.findByRole("heading", { level: 1, name: "The path." });
    const side = screen.getByRole("complementary", { name: "Resource index" });
    // ddia-stream-processing is day 38, in a later (closed) Block.
    fireEvent.click(within(entry(side, DDIA)).getByRole("button", { name: /^day 38: / }));

    await waitFor(() => {
      const row = document.querySelector<HTMLElement>(
        '.path-main li[data-task="ddia-stream-processing"]',
      );
      expect(row).not.toBeNull();
      expect(row!.querySelector(".title-btn")!.getAttribute("aria-expanded")).toBe("true");
      expect(within(row!).getByText(/^open day 38 in Today/)).toBeTruthy();
    });
    expect(
      within(screen.getByRole("group", { name: "Filter tasks" }))
        .getByRole("button", { name: "all" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
