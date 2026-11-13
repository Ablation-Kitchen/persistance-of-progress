import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NoteBody, PutNoteResponse, Snapshot } from "@learning-tracker/core";
import { buildApp } from "../app.js";
import { openAndMigrate, type Db } from "../db/index.js";

const FIXTURE = new URL("../../../paths/eval-infra-17-weeks.yaml", import.meta.url);

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
  dataDir = mkdtempSync(path.join(tmpdir(), "lt-notes-"));
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

const url = (target: string) => `/api/enrollments/${id}/notes/${encodeURIComponent(target)}`;
const put = (target: string, body: unknown) => call<PutNoteResponse>("PUT", url(target), body);
const snap = async () => (await call<Snapshot>("GET", `/api/enrollments/${id}`)).body;

describe("Note routes", () => {
  it("saves every target kind, lists bodies and returns meta with the bumped stateVersion", async () => {
    const v0 = (await snap()).stateVersion;
    for (const target of ["task:intro-to-llms", "day:2026-09-08", "enrollment"]) {
      const res = await put(target, { body: `about ${target}`, editedOn: "2026-09-08" });
      expect(res.status, target).toBe(200);
      expect(res.body.meta).toMatchObject({
        target,
        fromTemplate: false,
        editedOn: ["2026-09-08"],
        length: `about ${target}`.length,
      });
    }
    const list = await call<NoteBody[]>("GET", `/api/enrollments/${id}/notes`);
    expect(list.body).toEqual([
      { target: "day:2026-09-08", body: "about day:2026-09-08" },
      { target: "enrollment", body: "about enrollment" },
      { target: "task:intro-to-llms", body: "about task:intro-to-llms" },
    ]);
    const s = await snap();
    expect(s.stateVersion).toBe(v0 + 3);
    expect(s.noteMeta.map((m) => m.target)).toEqual([
      "day:2026-09-08",
      "enrollment",
      "task:intro-to-llms",
    ]);
  });

  it("the trail gets one date per edit day; last write wins", async () => {
    await put("enrollment", { body: "a", editedOn: "2026-09-08" });
    await put("enrollment", { body: "b", editedOn: "2026-09-08" });
    const res = await put("enrollment", { body: "c", editedOn: "2026-09-10" });
    expect(res.body.meta.editedOn).toEqual(["2026-09-08", "2026-09-10"]);
    const list = (await call<NoteBody[]>("GET", `/api/enrollments/${id}/notes`)).body;
    expect(list).toEqual([{ target: "enrollment", body: "c" }]);
  });

  it("fromTemplate is honoured only when the Note is created; a blank Note is still a Note", async () => {
    const first = await put("task:story-bank", {
      body: "",
      editedOn: "2026-09-08",
      fromTemplate: true,
    });
    expect(first.body.meta).toMatchObject({ fromTemplate: true, length: 0 });
    const again = await put("task:intro-to-llms", { body: "x", editedOn: "2026-09-08" });
    expect(again.body.meta.fromTemplate).toBe(false);
    const later = await put("task:intro-to-llms", {
      body: "y",
      editedOn: "2026-09-08",
      fromTemplate: true,
    });
    expect(later.body.meta.fromTemplate).toBe(false);
  });

  it("404 for unknown targets and Enrollments; 400 for a bad editedOn", async () => {
    const ok = { body: "x", editedOn: "2026-09-08" };
    for (const target of [
      "task:no-such-id",
      "day:2026-02-30",
      "day:nope",
      "week:1",
      "Enrollment",
    ]) {
      expect((await put(target, ok)).status, target).toBe(404);
    }
    expect((await call("PUT", `/api/enrollments/nope/notes/enrollment`, ok)).status).toBe(404);
    expect((await call("GET", `/api/enrollments/nope/notes`)).status).toBe(404);
    expect((await put("enrollment", { body: "x", editedOn: "2026-02-30" })).status).toBe(400);
    expect((await put("enrollment", { body: "x" })).status).toBe(400);
  });

  it("a Note on a tombstoned Task can be saved and deleted", async () => {
    db.prepare(
      `INSERT INTO tombstones (enrollment_id, task_id, title, kind, former_day, removed_at)
       VALUES (?, 'gone-task', 'Gone', 'material', 3, 'x')`,
    ).run(id);
    expect((await put("task:gone-task", { body: "kept", editedOn: "2026-09-08" })).status).toBe(
      200,
    );
    const del = await call<{ stateVersion: number }>("DELETE", url("task:gone-task"));
    expect(del.status).toBe(200);
    expect(del.body.stateVersion).toBe((await snap()).stateVersion);
  });

  it("delete removes the Note and its trail; deleting again is a 404", async () => {
    await put("day:2026-09-08", { body: "x", editedOn: "2026-09-08" });
    expect((await call("DELETE", url("day:2026-09-08"))).status).toBe(200);
    expect((await snap()).noteMeta).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM note_edits").get()).toEqual({ n: 0 });
    expect((await call("DELETE", url("day:2026-09-08"))).status).toBe(404);
  });
});
