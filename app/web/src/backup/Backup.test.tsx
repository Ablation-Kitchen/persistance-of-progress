// @vitest-environment jsdom
/** Ticket 15: Backup download, the "last backup" hint, and restore through the UI. */
import { File } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  allTasks,
  pathHash,
  type AppInfo,
  type LearningPath,
  type Snapshot,
} from "@learning-tracker/core";
import { api } from "../api";
import { startServer, type TestServer } from "../test/server";
import { renderApp } from "../test/render";

const START = "2026-09-07";
const TODAY = "2026-09-30"; // day 24

let server: TestServer;

beforeEach(async () => {
  server = await startServer();
});
afterEach(async () => {
  cleanup();
  await server.close();
});

/** Week 4 with ticks, Notes, a +2 shift and two removed Tasks (one done, with a Note). */
async function seed(s: TestServer): Promise<Snapshot> {
  const created = await api<Snapshot>("POST", "/api/enrollments", {
    source: { file: "eval-infra-17-weeks.yaml" },
    startDate: START,
  });
  const id = created.id;
  const tasks = allTasks(created.path).map((p) => p.task);
  for (const t of tasks.filter((x) => x.day < 6)) {
    await api("PUT", `/api/enrollments/${id}/tasks/${t.id}/state`, {
      status: "done",
      statusDate: "2026-09-29",
    });
  }
  await api("PUT", `/api/enrollments/${id}/notes/enrollment`, {
    body: "About this run.",
    editedOn: START,
  });
  const [gone1, gone2] = tasks.filter((t) => t.day > 30);
  await api("PUT", `/api/enrollments/${id}/notes/${encodeURIComponent(`task:${gone1!.id}`)}`, {
    body: "Kept after removal.",
    editedOn: TODAY,
  });
  const edited = structuredClone(created.path) as LearningPath;
  for (const b of edited.blocks) {
    b.tasks = b.tasks.filter((t) => t.id !== gone1!.id && t.id !== gone2!.id);
  }
  const removedAt = "2026-09-30T08:00:00.000Z";
  s.db
    .prepare("UPDATE enrollments SET path_json = ?, path_hash = ?, reloaded_at = ? WHERE id = ?")
    .run(JSON.stringify(edited), pathHash(edited), removedAt, id);
  const stone = s.db.prepare(
    `INSERT INTO tombstones (enrollment_id, task_id, title, kind, former_day, removed_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const t of [gone1!, gone2!]) stone.run(id, t.id, t.title, t.kind, t.day, removedAt);
  return api<Snapshot>("POST", `/api/enrollments/${id}/shifts`, { days: 2, appliedOn: TODAY });
}

const pickBackup = (text: string, name = "learning-tracker-backup.json") => {
  const input = screen.getByLabelText<HTMLInputElement>(/^(Choose a backup…|Restore…)$/);
  fireEvent.change(input, { target: { files: [new File([text], name)] } });
};

describe("backup download and hint", () => {
  it("the hint goes from never to today after a download", async () => {
    await seed(server);
    renderApp("/today");
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(await screen.findByRole("button", { name: /▾$/ }));
    const menu = await screen.findByRole("menu");
    expect(await within(menu).findByText(/last backup: never$/)).toBeTruthy();
    fireEvent.click(within(menu).getByRole("button", { name: "Download backup" }));
    expect(await within(menu).findByText(/last backup: today$/)).toBeTruthy();
    expect((await api<AppInfo>("GET", "/api/app")).lastBackupAt).not.toBeNull();
  });
});

describe("restore", () => {
  it("round trip: back up, wipe, restore from the empty state; screens show the same data", async () => {
    const before = await seed(server);
    const text = await (await fetch(`/api/backup?today=${TODAY}`)).text();
    const notesBefore = await api("GET", `/api/enrollments/${before.id}/notes`);
    await server.close();
    server = await startServer(); // a wiped volume

    renderApp(`/today?today=${TODAY}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Pick a path." })).toBeTruthy();
    pickBackup(text);
    const dialog = await screen.findByRole("dialog");
    const inBackup = await within(dialog).findByRole("region", { name: "In the backup" });
    expect(inBackup.textContent).toContain(before.path.title);
    expect(inBackup.textContent).toContain(`from ${START}`);
    expect(inBackup.textContent).toContain("2 notes");
    expect(within(dialog).getByRole("region", { name: "Here now" }).textContent).toContain(
      "No enrollments.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Today." })).toBeTruthy();
    expect(await screen.findByText("Backup restored")).toBeTruthy();
    // Shift undo eligibility survived.
    expect(await screen.findByRole("button", { name: "Undo +2d" })).toBeTruthy();

    const after = await api<Snapshot>("GET", `/api/enrollments/${before.id}`);
    const { stateVersion: _a, ...a } = after;
    const { stateVersion: _b, ...b } = before;
    void _a;
    void _b;
    expect(a).toEqual(b);
    expect(await api("GET", `/api/enrollments/${before.id}/notes`)).toEqual(notesBefore);

    // Removed tasks are back on the Path screen.
    cleanup();
    renderApp(`/path?today=${TODAY}`);
    const removed = await screen.findByRole("region", { name: "Removed from the path" });
    await waitFor(() => expect(removed.textContent).toContain("Kept after removal"));
  });

  it("a backup from a newer app is refused with nothing written", async () => {
    const snap = await seed(server);
    const backup = JSON.parse(await (await fetch(`/api/backup?today=${TODAY}`)).text()) as {
      formatVersion: number;
    };
    backup.formatVersion = 2;
    const version = (await api<AppInfo>("GET", "/api/app")).appStateVersion;

    renderApp(`/today?today=${TODAY}`);
    fireEvent.click(await screen.findByRole("button", { name: /▾$/ }));
    await screen.findByRole("menu");
    pickBackup(JSON.stringify(backup));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/made by a newer version of the app/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Restore" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await api<AppInfo>("GET", "/api/app")).appStateVersion).toBe(version);
    expect((await api<Snapshot>("GET", `/api/enrollments/${snap.id}`)).stateVersion).toBe(
      snap.stateVersion,
    );
  });
});
