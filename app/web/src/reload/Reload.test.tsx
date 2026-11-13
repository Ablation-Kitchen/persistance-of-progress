// @vitest-environment jsdom
/** Ticket 13: the changed-file banner, the reload picker, preview → apply and stale previews. */
import { File } from "node:buffer";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPath, type LearningPath, type Snapshot } from "@learning-tracker/core";
import { api } from "../api";
import { FIXTURE, startServer, type TestServer } from "../test/server";
import { renderApp } from "../test/render";

const FILE = "eval-infra-17-weeks.yaml";
const TODAY = "2026-09-30"; // day 24
const fixtureText = readFileSync(FIXTURE, "utf8");
const loaded = loadPath(fixtureText, { source: "yaml" });
if (!loaded.ok) throw new Error("fixture must load");
const fixture = loaded.path;

let server: TestServer;
let id: string;

beforeEach(async () => {
  server = await startServer();
  id = (
    await api<Snapshot>("POST", "/api/enrollments", {
      source: { file: FILE },
      startDate: "2026-09-07",
    })
  ).id;
  await api("PUT", `/api/enrollments/${id}/tasks/intro-to-llms/state`, {
    status: "done",
    statusDate: "2026-09-07",
  });
  await api("PUT", `/api/enrollments/${id}/notes/task%3Aintro-to-llms`, {
    body: "Day 1 thoughts",
    editedOn: "2026-09-07",
  });
  await api("POST", `/api/enrollments/${id}/shifts`, { days: 2, appliedOn: "2026-09-25" });
});

afterEach(async () => {
  cleanup();
  await server.close();
});

const getSnapshot = () => api<Snapshot>("GET", `/api/enrollments/${id}`);

function edited(fn: (p: LearningPath) => void): string {
  const p = structuredClone(fixture);
  fn(p);
  return JSON.stringify(p, null, 2); // JSON is YAML
}
const removeTask = (p: LearningPath, taskId: string) => {
  for (const b of p.blocks) b.tasks = b.tasks.filter((t) => t.id !== taskId);
};
const taskOf = (p: LearningPath, taskId: string) =>
  p.blocks.flatMap((b) => b.tasks).find((t) => t.id === taskId)!;

const ticketEdit = edited((p) => {
  p.blocks[0]!.tasks.push(
    { id: "added-past-one", day: 3, kind: "material", title: "Added on day 3" },
    { id: "added-past-two", day: 5, kind: "exercise", title: "Added on day 5" },
  );
  removeTask(p, "intro-to-llms");
  removeTask(p, "attention-is-all-you-need");
  taskOf(p, "learnings-week-1").day = 7;
  taskOf(p, "go-brrr").title = "Go brrr (retitled)";
});

async function openToday() {
  renderApp(`/today?today=${TODAY}`);
  await screen.findByRole("heading", { level: 1, name: "Today." });
}

async function openPicker() {
  fireEvent.click(await screen.findByRole("button", { name: /▾$/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Reload path…" }));
  return screen.findByRole("dialog", { name: "Reload the path" });
}

describe("changed-file banner and reload", () => {
  it("an edited file raises the banner; the preview lists the changes; apply hides the banner", async () => {
    server.writePath(FILE, ticketEdit);
    await openToday();
    expect(await screen.findByText("The path file has changed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review reload" }));

    const dialog = await screen.findByRole("dialog", { name: "Review reload" });
    const summary = await within(dialog).findByText(/added/);
    expect(summary.textContent).toContain("2 added, 2 already overdue");
    expect(summary.textContent).toContain("1 removed task will be kept hidden");
    const section = (name: string) => within(within(dialog).getByRole("region", { name }));
    expect(section("Added").getAllByRole("listitem")).toHaveLength(2);
    expect(section("Removed").getAllByRole("listitem")).toHaveLength(2);
    expect(section("Moved").getByText(/day 6 → day 7/)).toBeTruthy();
    expect(section("Changed").getByText("Go brrr (retitled)")).toBeTruthy();
    expect(within(dialog).queryByRole("region", { name: "Restored" })).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Reload" }));
    expect(await screen.findByText("Path reloaded")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("The path file has changed")).toBeNull());
    const snap = await getSnapshot();
    expect(snap.tombstones.map((t) => t.taskId)).toEqual(["intro-to-llms"]);
    expect(snap.taskStates.find((r) => r.taskId === "added-past-one")?.offsetDays).toBe(2);
  });

  it("cancel writes nothing and keeps the banner", async () => {
    server.writePath(FILE, ticketEdit);
    await openToday();
    fireEvent.click(await screen.findByRole("button", { name: "Review reload" }));
    const dialog = await screen.findByRole("dialog", { name: "Review reload" });
    await within(dialog).findByText(/added/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("The path file has changed")).toBeTruthy();
    expect((await getSnapshot()).reloadedAt).toBeNull();
  });

  it("a comment-only edit raises no banner", async () => {
    server.writePath(FILE, `# just a comment\n${fixtureText}`);
    await openToday();
    const picker = await openPicker();
    // The /paths listing has loaded (the file is listed) and its hash matches.
    expect(await within(picker).findByText("same as loaded")).toBeTruthy();
    expect(screen.queryByText("The path file has changed")).toBeNull();
  });

  it("several changed files: the banner lists each to pick from", async () => {
    server.writePath(FILE, ticketEdit);
    server.writePath(
      "copy.yaml",
      edited((p) => (p.title = "Retitled copy")),
    );
    await openToday();
    expect(await screen.findByText(/2 files for this path have changed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review copy.yaml" }));
    const dialog = await screen.findByRole("dialog", { name: "Review reload" });
    expect(
      await within(dialog).findByText(
        /“17-Week Plan: Eval Infrastructure Engineer” → “Retitled copy”/,
      ),
    ).toBeTruthy();
  });

  it("a write in another tab makes the preview stale; the dialog re-previews and says so", async () => {
    server.writePath(FILE, ticketEdit);
    await openToday();
    fireEvent.click(await screen.findByRole("button", { name: "Review reload" }));
    const dialog = await screen.findByRole("dialog", { name: "Review reload" });
    await within(dialog).findByText(/added/);

    await api("PUT", `/api/enrollments/${id}/tasks/go-brrr/state`, {
      status: "done",
      statusDate: TODAY,
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reload" }));
    expect(await within(dialog).findByText(/changed since this preview/)).toBeTruthy();
    expect((await getSnapshot()).reloadedAt).toBeNull();

    // The refreshed preview applies.
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Reload" })).toHaveProperty(
        "disabled",
        false,
      ),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Reload" }));
    expect(await screen.findByText("Path reloaded")).toBeTruthy();
    expect((await getSnapshot()).reloadedAt).not.toBeNull();
  });
});

describe("reload from the app menu", () => {
  it("uploading an invalid file shows its problems with line numbers", async () => {
    await openToday();
    const picker = await openPicker();
    const input = within(picker).getByText("Upload a .yaml file").querySelector("input")!;
    const broken = fixtureText.replace("    day: 6\n", "    day: 6\n    dueDay: 2\n");
    fireEvent.change(input, { target: { files: [new File([broken], "broken.yaml")] } });
    const dialog = await screen.findByRole("dialog", { name: "Review reload" });
    expect(await within(dialog).findByText(/problem/)).toBeTruthy();
    expect(within(dialog).getByRole("list", { name: "Problems" }).textContent).toMatch(/line \d+/);
    expect(within(dialog).queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("uploading another path's file is refused", async () => {
    await openToday();
    const picker = await openPicker();
    const input = within(picker).getByText("Upload a .yaml file").querySelector("input")!;
    const other = edited((p) => (p.id = "another-path"));
    fireEvent.change(input, { target: { files: [new File([other], "other.yaml")] } });
    const dialog = await screen.findByRole("dialog", { name: "Review reload" });
    expect(await within(dialog).findByText(/another-path/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("picking the unchanged file says No changes", async () => {
    await openToday();
    const picker = await openPicker();
    fireEvent.click(await within(picker).findByRole("button", { name: FILE }));
    const dialog = await screen.findByRole("dialog", { name: "Review reload" });
    expect(await within(dialog).findByText(/No changes/)).toBeTruthy();
  });
});
