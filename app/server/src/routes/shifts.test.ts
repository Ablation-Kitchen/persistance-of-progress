import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allTasks, todayColumns, type Snapshot } from "@learning-tracker/core";
import { buildApp } from "../app.js";
import { openAndMigrate, type Db } from "../db/index.js";

const FIXTURE = new URL("../../../paths/eval-infra-17-weeks.yaml", import.meta.url);
const WEEK4 = "2026-09-30"; // day 24 of a run starting 2026-09-07

let dataDir: string;
let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let id: string;

async function call<T = unknown>(method: string, url: string, payload?: unknown) {
  const res = await app.inject({
    method: method as "GET",
    url,
    ...(payload !== undefined && { payload: payload as object }),
  });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "lt-shift-"));
  const pathsDir = path.join(dataDir, "paths");
  mkdirSync(pathsDir);
  copyFileSync(FIXTURE, path.join(pathsDir, "eval-infra-17-weeks.yaml"));
  db = openAndMigrate(dataDir).db;
  app = await buildApp({ webDist: path.join(dataDir, "no-web"), db, pathsDir });
  id = (
    await call<Snapshot>("POST", "/api/enrollments", {
      source: { file: "eval-infra-17-weeks.yaml" },
      startDate: "2026-09-07",
    })
  ).body.id;
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const shift = (days: unknown, appliedOn: unknown = WEEK4) =>
  call<Snapshot>("POST", `/api/enrollments/${id}/shifts`, { days, appliedOn });
const undo = () => call<Snapshot>("DELETE", `/api/enrollments/${id}/shifts/latest`);
const tick = (taskId: string, status = "done", statusDate = WEEK4) =>
  call("PUT", `/api/enrollments/${id}/tasks/${taskId}/state`, { status, statusDate });
const offsets = (s: Snapshot) =>
  Object.fromEntries(s.taskStates.map((r) => [r.taskId, r.offsetDays]));

describe("POST /api/enrollments/:id/shifts", () => {
  it("at week 4, +2 moves every todo Task (optional and future too) and leaves done/skipped", async () => {
    const before = (await call<Snapshot>("GET", `/api/enrollments/${id}`)).body;
    const tasks = allTasks(before.path).map((p) => p.task);
    await tick(tasks[0]!.id, "done");
    await tick(tasks[1]!.id, "skipped");
    const start = (await call<Snapshot>("GET", `/api/enrollments/${id}`)).body;
    const catchUp = todayColumns(start, WEEK4).catchUp;
    expect(catchUp.some((v) => v.daysOverdue <= 2)).toBe(true);
    expect(catchUp.some((v) => v.daysOverdue > 2)).toBe(true);

    const res = await shift(2);
    expect(res.status).toBe(200);
    const after = res.body;
    expect(after.stateVersion).toBe(start.stateVersion + 1);
    const off = offsets(after);
    expect(off[tasks[0]!.id]).toBe(0);
    expect(off[tasks[1]!.id]).toBe(0);
    const todo = tasks.slice(2);
    for (const t of todo) expect(off[t.id], t.id).toBe(2);
    expect(todo.some((t) => t.optional)).toBe(true);
    expect(todo.some((t) => t.day > 24)).toBe(true);
    expect(after.shifts).toEqual([
      expect.objectContaining({
        appliedOn: WEEK4,
        days: 2,
        taskIds: todo.map((t) => t.id),
        undoable: true,
      }),
    ]);

    // Catch up keeps only Tasks that were more than 2 days overdue.
    const now = new Set(todayColumns(after, WEEK4).catchUp.map((v) => v.task.id));
    for (const v of catchUp) expect(now.has(v.task.id), v.task.id).toBe(v.daysOverdue > 2);
  });

  it("days must be 1–365 and appliedOn a real date", async () => {
    for (const days of [0, 366, 1.5, -1]) {
      const res = await shift(days);
      expect(res.status, String(days)).toBe(400);
      expect(res.body).toMatchObject({ error: { code: "bad-request" } });
    }
    expect((await shift(1, "2026-02-30")).status).toBe(400);
    expect((await shift(365)).status).toBe(200);
    const res = await call("POST", "/api/enrollments/nope/shifts", { days: 1, appliedOn: WEEK4 });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/enrollments/:id/shifts/latest", () => {
  it("a Task ticked after a shift keeps done when the shift is undone; its offset goes back", async () => {
    const moved = (await shift(2)).body.shifts[0]!.taskIds[0]!;
    await tick(moved, "done");
    const res = await undo();
    expect(res.status).toBe(200);
    expect(res.body.shifts).toEqual([]);
    expect(res.body.taskStates.find((r) => r.taskId === moved)).toMatchObject({
      status: "done",
      statusDate: WEEK4,
      offsetDays: 0,
    });
  });

  it("two shifts then two undos restore every offset; a third undo is 409", async () => {
    const original = offsets((await call<Snapshot>("GET", `/api/enrollments/${id}`)).body);
    await shift(3);
    const second = (await shift(4)).body;
    expect(second.shifts.map((s) => s.undoable)).toEqual([false, true]);
    expect(Object.values(offsets(second)).every((o) => o === 7)).toBe(true);

    const once = (await undo()).body;
    expect(once.shifts).toHaveLength(1);
    expect(once.shifts[0]).toMatchObject({ days: 3, undoable: true });
    const twice = (await undo()).body;
    expect(Object.values(offsets(twice)).every((o) => o === 0)).toBe(true);
    for (const [taskId, o] of Object.entries(original)) expect(offsets(twice)[taskId]).toBe(o);

    const third = await undo();
    expect(third.status).toBe(409);
    expect(third.body).toMatchObject({ error: { code: "nothing-to-undo" } });
  });

  it("a shift made before the last reload can't be undone", async () => {
    await shift(1);
    db.prepare("UPDATE enrollments SET reloaded_at = ? WHERE id = ?").run(
      new Date(Date.now() + 60_000).toISOString(),
      id,
    );
    const snap = (await call<Snapshot>("GET", `/api/enrollments/${id}`)).body;
    expect(snap.shifts[0]?.undoable).toBe(false);
    expect((await undo()).status).toBe(409);
  });
});
