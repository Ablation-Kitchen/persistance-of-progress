import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allTasks,
  backupSourceHash,
  pathHash,
  type AppInfo,
  type Backup,
  type LearningPath,
  type RestorePreviewResponse,
  type Snapshot,
} from "@learning-tracker/core";
import { buildApp } from "../app.js";
import { openAndMigrate, type Db } from "../db/index.js";

const FIXTURE = new URL("../../../paths/eval-infra-17-weeks.yaml", import.meta.url);
const START = "2026-09-07";
const TODAY = "2026-09-30"; // day 24

interface Instance {
  dataDir: string;
  db: Db;
  app: Awaited<ReturnType<typeof buildApp>>;
}
const instances: Instance[] = [];

async function boot(): Promise<Instance> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "lt-backup-"));
  const pathsDir = path.join(dataDir, "paths");
  mkdirSync(pathsDir);
  copyFileSync(FIXTURE, path.join(pathsDir, "eval-infra-17-weeks.yaml"));
  const db = openAndMigrate(dataDir).db;
  const app = await buildApp({ webDist: path.join(dataDir, "no-web"), db, pathsDir, dataDir });
  const i = { dataDir, db, app };
  instances.push(i);
  return i;
}

let main: Instance;
beforeEach(async () => {
  main = await boot();
});
afterEach(async () => {
  for (const i of instances.splice(0)) {
    await i.app.close();
    rmSync(i.dataDir, { recursive: true, force: true });
  }
});

async function call<T = unknown>(i: Instance, method: string, url: string, payload?: unknown) {
  const res = await i.app.inject({
    method: method as "GET",
    url,
    ...(payload !== undefined && { payload: payload as object }),
  });
  const json = res.headers["content-type"]?.toString().includes("json") && res.body;
  return {
    status: res.statusCode,
    headers: res.headers,
    text: res.body,
    body: (json ? JSON.parse(res.body) : undefined) as T,
  };
}

/**
 * Week 4 at day 24: ticks (one back-dated), Notes on a Task, a day and the Enrollment, a +2 shift,
 * and two Tasks removed by a reload (one done with a Note), as tombstones.
 */
async function seedWeek4(i: Instance): Promise<string> {
  const { id } = (
    await call<Snapshot>(i, "POST", "/api/enrollments", {
      source: { file: "eval-infra-17-weeks.yaml" },
      startDate: START,
    })
  ).body;
  const snap = (await call<Snapshot>(i, "GET", `/api/enrollments/${id}`)).body;
  const tasks = allTasks(snap.path).map((p) => p.task);
  const early = tasks.filter((t) => t.day < 14);
  for (const t of early.slice(0, 5)) {
    await call(i, "PUT", `/api/enrollments/${id}/tasks/${t.id}/state`, {
      status: "done",
      statusDate: "2026-09-29",
    });
  }
  await call(i, "PUT", `/api/enrollments/${id}/tasks/${early[5]!.id}/state`, {
    status: "skipped",
    statusDate: "2026-09-12",
  });
  const note = (target: string, body: string, editedOn: string) =>
    call(i, "PUT", `/api/enrollments/${id}/notes/${encodeURIComponent(target)}`, {
      body,
      editedOn,
    });
  await note(`task:${early[0]!.id}`, "## Learnt\n\n| a | b |\n|---|---|\n| 1 | 2 |", "2026-09-28");
  await note(`task:${early[0]!.id}`, "## Learnt more", "2026-09-29");
  await note("day:2026-09-29", "A day note.", "2026-09-29");
  await note("enrollment", "Why I'm doing this.", "2026-09-07");

  // Two later Tasks get removed by a reload; the first was done early and has a Note.
  const [gone1, gone2] = tasks.filter((t) => t.day > 30);
  await call(i, "PUT", `/api/enrollments/${id}/tasks/${gone1!.id}/state`, {
    status: "done",
    statusDate: "2026-09-30",
  });
  await note(`task:${gone1!.id}`, "Done ahead of time.", "2026-09-30");
  const edited = structuredClone(snap.path) as LearningPath;
  for (const b of edited.blocks)
    b.tasks = b.tasks.filter((t) => t.id !== gone1!.id && t.id !== gone2!.id);
  const removedAt = "2026-09-30T08:00:00.000Z";
  i.db
    .prepare("UPDATE enrollments SET path_json = ?, path_hash = ?, reloaded_at = ? WHERE id = ?")
    .run(JSON.stringify(edited), pathHash(edited), removedAt, id);
  const stone = i.db.prepare(
    `INSERT INTO tombstones (enrollment_id, task_id, title, kind, former_day, removed_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const t of [gone1!, gone2!]) stone.run(id, t.id, t.title, t.kind, t.day, removedAt);

  await call(i, "POST", `/api/enrollments/${id}/shifts`, { days: 2, appliedOn: TODAY });
  return id;
}

const download = (i: Instance) => call<Backup>(i, "GET", `/api/backup?today=${TODAY}`);
const preview = (i: Instance, backup: string) =>
  call<RestorePreviewResponse>(i, "POST", "/api/restore/preview", { backup, today: TODAY });
async function restore(i: Instance, backup: string) {
  const p = (await preview(i, backup)).body;
  return call<AppInfo>(i, "POST", "/api/restore", {
    backup,
    expectedSourceHash: p.sourceHash,
    expectedStateVersion: p.stateVersion,
  });
}
const safetyCopies = (i: Instance) =>
  readdirSync(i.dataDir).filter((f) => /^pre-restore-.*\.json$/.test(f));

/** Everything the screens show for an Enrollment, minus the version counter. */
async function state(i: Instance, id: string) {
  const snap: Partial<Snapshot> = (await call<Snapshot>(i, "GET", `/api/enrollments/${id}`)).body;
  delete snap.stateVersion;
  const notes = (await call(i, "GET", `/api/enrollments/${id}/notes`)).body;
  return { snap, notes };
}

describe("GET /api/backup", () => {
  it("sends the whole app as a pretty-printed attachment and sets lastBackupAt", async () => {
    const id = await seedWeek4(main);
    const before = (await call<AppInfo>(main, "GET", "/api/app")).body;
    expect(before.lastBackupAt).toBeNull();

    const res = await download(main);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="learning-tracker-backup_${TODAY}.json"`,
    );
    expect(res.text).toMatch(
      /^\{\n {2}"format": "learning-tracker-backup",\n {2}"formatVersion": 1,/,
    );
    expect(res.body.activeEnrollmentId).toBe(id);
    const e = res.body.enrollments[0]!;
    expect(e.tombstones).toHaveLength(2);
    expect(e.shifts).toHaveLength(1);
    expect(e.notes.find((n) => n.target === "enrollment")?.body).toBe("Why I'm doing this.");

    const after = (await call<AppInfo>(main, "GET", "/api/app")).body;
    expect(after.lastBackupAt).not.toBeNull();
    expect(after.appStateVersion).toBe(before.appStateVersion + 1);
  });

  it("needs a real today", async () => {
    expect((await call(main, "GET", "/api/backup?today=2026-02-30")).status).toBe(400);
    expect((await call(main, "GET", "/api/backup")).status).toBe(400);
  });
});

describe("restore", () => {
  it("round trip: back up, wipe the volume, restore from empty — every screen's data is the same", async () => {
    const id = await seedWeek4(main);
    const original = await state(main, id);
    expect(original.snap.shifts?.map((s) => s.undoable)).toEqual([true]);
    const text = (await download(main)).text;

    const fresh = await boot();
    const p = await preview(fresh, text);
    expect(p.status).toBe(200);
    expect(p.body.summary.current.enrollments).toEqual([]);
    expect(p.body.summary.backup.enrollments).toEqual([
      expect.objectContaining({ id, startDate: START, notes: 4, active: true }),
    ]);
    expect(p.body.sourceHash).toBe(backupSourceHash(text));

    const res = await restore(fresh, text);
    expect(res.status).toBe(200);
    expect(res.body.activeEnrollmentId).toBe(id);
    expect(res.body.lastBackupAt).toBe((JSON.parse(text) as Backup).exportedAt);
    expect(await state(fresh, id)).toEqual(original);
    expect(safetyCopies(fresh)).toHaveLength(1);
  });

  it.each([
    [
      "formatVersion 2",
      (b: Backup): void => {
        (b as { formatVersion: number }).formatVersion = 2;
      },
      422,
      "backup-too-new",
    ],
    [
      "a Note on an unknown Task",
      (b: Backup): void => {
        b.enrollments[0]!.notes.push({
          target: "task:no-such-task",
          body: "?",
          fromTemplate: false,
          createdAt: "2026-09-30T00:00:00.000Z",
          updatedAt: "2026-09-30T00:00:00.000Z",
          editedOn: [TODAY],
        });
      },
      422,
      "backup-invalid",
    ],
  ] as const)("%s → %s %s, and nothing is written", async (_name, edit, status, code) => {
    const id = await seedWeek4(main);
    const backup = (await download(main)).body;
    edit(backup);
    const text = JSON.stringify(backup);
    const before = await state(main, id);
    const version = (await call<AppInfo>(main, "GET", "/api/app")).body.appStateVersion;

    const p = await preview(main, text);
    expect(p.status).toBe(status);
    expect(p.body).toMatchObject({ error: { code } });
    if (code === "backup-invalid") {
      expect(p.body).toMatchObject({
        error: {
          issues: [{ pointer: expect.stringMatching(/^\/enrollments\/0\/notes\/\d+\/target$/) }],
        },
      });
    }
    const apply = await call(main, "POST", "/api/restore", {
      backup: text,
      expectedSourceHash: backupSourceHash(text),
      expectedStateVersion: version,
    });
    expect(apply.status).toBe(status);

    expect(await state(main, id)).toEqual(before);
    expect((await call<AppInfo>(main, "GET", "/api/app")).body.appStateVersion).toBe(version);
    expect(safetyCopies(main)).toEqual([]);
  });

  it("a failure halfway through the transaction leaves the old data, after the Safety Copy", async () => {
    const id = await seedWeek4(main);
    const text = (await download(main)).text;
    // Change the data so a successful restore would be visible, then make the restore fail
    // after the enrollments have been deleted and re-inserted.
    await call(main, "PUT", `/api/enrollments/${id}/notes/enrollment`, {
      body: "Changed after the backup.",
      editedOn: TODAY,
    });
    const before = await state(main, id);
    const app = (await call<AppInfo>(main, "GET", "/api/app")).body;
    main.db.exec(
      "CREATE TRIGGER boom BEFORE INSERT ON tombstones BEGIN SELECT RAISE(ABORT, 'forced failure'); END",
    );

    const res = await restore(main, text);
    expect(res.status).toBe(500);
    expect(await state(main, id)).toEqual(before);
    expect((await call<AppInfo>(main, "GET", "/api/app")).body).toEqual(app);
    expect(safetyCopies(main)).toHaveLength(1);
  });

  it("409 preview-stale when something was written or the file changed since the preview", async () => {
    const id = await seedWeek4(main);
    const text = (await download(main)).text;
    const p = (await preview(main, text)).body;
    await call(main, "PUT", `/api/enrollments/${id}/notes/enrollment`, {
      body: "x",
      editedOn: TODAY,
    });
    const stale = await call(main, "POST", "/api/restore", {
      backup: text,
      expectedSourceHash: p.sourceHash,
      expectedStateVersion: p.stateVersion,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: "preview-stale" } });

    const q = (await preview(main, text)).body;
    const edited = await call(main, "POST", "/api/restore", {
      backup: `${text} `,
      expectedSourceHash: q.sourceHash,
      expectedStateVersion: q.stateVersion,
    });
    expect(edited.status).toBe(409);
    expect(safetyCopies(main)).toEqual([]);
  });

  it("four restores keep the newest 3 Safety Copies", async () => {
    await seedWeek4(main);
    const text = (await download(main)).text;
    for (let n = 0; n < 4; n++) expect((await restore(main, text)).status).toBe(200);
    const copies = safetyCopies(main).sort();
    expect(copies).toHaveLength(3);
  });
});
