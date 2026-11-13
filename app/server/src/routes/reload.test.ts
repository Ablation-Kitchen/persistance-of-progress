import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPath,
  pathHash,
  type LearningPath,
  type ReloadDiff,
  type Snapshot,
} from "@learning-tracker/core";
import { buildApp } from "../app.js";
import { openAndMigrate, type Db } from "../db/index.js";

const FIXTURE = new URL("../../../paths/eval-infra-17-weeks.yaml", import.meta.url);
const FILE = "eval-infra-17-weeks.yaml";
const fixtureText = readFileSync(FIXTURE, "utf8");
const loaded = loadPath(fixtureText, { source: "yaml" });
if (!loaded.ok) throw new Error("fixture must load");
const fixture = loaded.path;

let dataDir: string;
let pathsDir: string;
let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "lt-reload-"));
  pathsDir = path.join(dataDir, "paths");
  mkdirSync(pathsDir);
  copyFileSync(FIXTURE, path.join(pathsDir, FILE));
  db = openAndMigrate(dataDir).db;
  app = await buildApp({ webDist: path.join(dataDir, "no-web"), db, pathsDir });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function call<T = unknown>(method: string, url: string, payload?: unknown) {
  const res = await app.inject({
    method: method as "GET",
    url,
    ...(payload !== undefined && { payload: payload as object }),
  });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

type Preview = { unchanged: true } | { diff: ReloadDiff; sourceHash: string; stateVersion: number };

/** JSON is YAML, so an edited path can be written or uploaded as its JSON text. */
const asYaml = (p: LearningPath) => JSON.stringify(p, null, 2);

function edited(fn: (p: LearningPath) => void): LearningPath {
  const p = structuredClone(fixture);
  fn(p);
  return p;
}
function removeTask(p: LearningPath, id: string) {
  for (const b of p.blocks) b.tasks = b.tasks.filter((t) => t.id !== id);
}
function task(p: LearningPath, id: string) {
  return p.blocks.flatMap((b) => b.tasks).find((t) => t.id === id)!;
}

/** The ticket's edit: 2 added on past days, a done+Note Task and an untouched one removed, 1 moved, 1 retitled. */
const ticketEdit = (p: LearningPath) => {
  p.blocks[0]!.tasks.push(
    { id: "added-past-one", day: 3, kind: "material", title: "Added on day 3" },
    { id: "added-past-two", day: 5, kind: "exercise", title: "Added on day 5" },
  );
  removeTask(p, "intro-to-llms");
  removeTask(p, "attention-is-all-you-need");
  task(p, "learnings-week-1").day = 7;
  task(p, "go-brrr").title = "Go brrr (retitled)";
};

async function setup() {
  const { id } = (
    await call<Snapshot>("POST", "/api/enrollments", {
      source: { file: FILE },
      startDate: "2026-09-07",
    })
  ).body;
  await call("PUT", `/api/enrollments/${id}/tasks/intro-to-llms/state`, {
    status: "done",
    statusDate: "2026-09-07",
  });
  await call("PUT", `/api/enrollments/${id}/notes/task%3Aintro-to-llms`, {
    body: "What I learned on day 1",
    editedOn: "2026-09-07",
  });
  await call("POST", `/api/enrollments/${id}/shifts`, { days: 2, appliedOn: "2026-09-25" });
  return id;
}

const preview = (id: string, source: unknown) =>
  call<Preview>("POST", `/api/enrollments/${id}/reload/preview`, { source });
const apply = (id: string, source: unknown, sourceHash: string, stateVersion: number) =>
  call<Snapshot>("POST", `/api/enrollments/${id}/reload`, {
    source,
    expectedSourceHash: sourceHash,
    expectedStateVersion: stateVersion,
  });

describe("reload", () => {
  it("previews exactly the ticket's edit, applies it, and restores a removed Task later", async () => {
    const id = await setup();
    const next = edited(ticketEdit);
    writeFileSync(path.join(pathsDir, FILE), asYaml(next));

    const p = await preview(id, { file: FILE });
    expect(p.status).toBe(200);
    if (!("diff" in p.body)) throw new Error("expected a diff");
    const { diff, sourceHash, stateVersion } = p.body;
    expect(sourceHash).toBe(pathHash(next));
    expect(diff.added.map((a) => a.taskId)).toEqual(["added-past-one", "added-past-two"]);
    expect(diff.removed.map((r) => [r.taskId, r.keptHidden])).toEqual([
      ["intro-to-llms", true],
      ["attention-is-all-you-need", false],
    ]);
    expect(diff.moved.map((m) => m.taskId)).toEqual(["learnings-week-1"]);
    expect(diff.changed).toEqual([
      expect.objectContaining({ taskId: "go-brrr", fields: ["title"] }),
    ]);
    expect(diff.restored).toEqual([]);
    expect(diff.pathChanges).toEqual([]);
    expect(diff.plan.addedOffset).toBe(2);

    // The preview wrote nothing.
    const before = (await call<Snapshot>("GET", `/api/enrollments/${id}`)).body;
    expect(before.stateVersion).toBe(stateVersion);
    expect(before.reloadedAt).toBeNull();

    const res = await apply(id, { file: FILE }, sourceHash, stateVersion);
    expect(res.status).toBe(200);
    const after = res.body;
    expect(after.pathHash).toBe(sourceHash);
    expect(after.reloadedAt).not.toBeNull();
    expect(after.stateVersion).toBe(stateVersion + 1);
    expect(after.tombstones.map((t) => t.taskId)).toEqual(["intro-to-llms"]);
    expect(after.tombstones[0]).toMatchObject({ kind: "material", formerDay: 1 });
    const states = new Map(after.taskStates.map((r) => [r.taskId, r]));
    expect(states.get("intro-to-llms")).toMatchObject({ status: "done", statusDate: "2026-09-07" });
    expect(states.has("attention-is-all-you-need")).toBe(false);
    expect(states.get("added-past-one")).toMatchObject({ status: "todo", offsetDays: 2 });
    expect(states.get("added-past-two")).toMatchObject({ status: "todo", offsetDays: 2 });
    expect(after.noteMeta.map((n) => n.target)).toContain("task:intro-to-llms");
    expect(after.shifts[0]?.undoable).toBe(false);

    // The pre-reload shift can no longer be undone.
    const undo = await call("DELETE", `/api/enrollments/${id}/shifts/latest`);
    expect(undo.status).toBe(409);
    expect(undo.body).toMatchObject({ error: { code: "nothing-to-undo" } });

    // Put the done Task back: it comes back with its status, date, offset and Note.
    const restoredPath = edited((q) => {
      ticketEdit(q);
      q.blocks[0]!.tasks.unshift(structuredClone(task(fixture, "intro-to-llms")));
    });
    const upload = { filename: "edited.yaml", yaml: asYaml(restoredPath) };
    const p2 = await preview(id, upload);
    if (!("diff" in p2.body)) throw new Error("expected a diff");
    expect(p2.body.diff.restored.map((r) => r.taskId)).toEqual(["intro-to-llms"]);
    expect(p2.body.diff.added).toEqual([]);
    const restored = (await apply(id, upload, p2.body.sourceHash, p2.body.stateVersion)).body;
    expect(restored.tombstones).toEqual([]);
    expect(restored.taskStates.find((r) => r.taskId === "intro-to-llms")).toMatchObject({
      status: "done",
      statusDate: "2026-09-07",
      offsetDays: 0,
    });
    expect(restored.noteMeta.map((n) => n.target)).toContain("task:intro-to-llms");
  });

  it("a comment-only edit is unchanged and writes nothing", async () => {
    const id = await setup();
    writeFileSync(path.join(pathsDir, FILE), `# a comment\n${fixtureText}\n# another\n`);
    const before = (await call<Snapshot>("GET", `/api/enrollments/${id}`)).body;
    expect((await preview(id, { file: FILE })).body).toEqual({ unchanged: true });
    const files = (await call<{ hash?: string }[]>("GET", "/api/paths")).body;
    expect(files[0]?.hash).toBe(before.pathHash);
    expect((await call<Snapshot>("GET", `/api/enrollments/${id}`)).body.stateVersion).toBe(
      before.stateVersion,
    );
  });

  it("a different id is 409 path-id-mismatch; an invalid file is 422 with line numbers", async () => {
    const id = await setup();
    const other = { filename: "x.yaml", yaml: asYaml(edited((p) => (p.id = "another-path"))) };
    const mismatch = await preview(id, other);
    expect(mismatch.status).toBe(409);
    expect(mismatch.body).toMatchObject({ error: { code: "path-id-mismatch" } });
    const mismatchApply = await apply(id, other, "x", 0);
    expect(mismatchApply.status).toBe(409);
    expect(mismatchApply.body).toMatchObject({ error: { code: "path-id-mismatch" } });

    const broken = fixtureText.replace("    day: 6\n", "    day: 6\n    dueDay: 2\n");
    const invalid = await call<{ error: { code: string; issues: { line?: number }[] } }>(
      "POST",
      `/api/enrollments/${id}/reload/preview`,
      { source: { filename: "b.yaml", yaml: broken } },
    );
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe("path-invalid");
    expect(invalid.body.error.issues[0]?.line).toBeGreaterThan(0);

    expect((await preview(id, { file: "nope.yaml" })).status).toBe(404);
    expect((await preview("nope", { file: FILE })).status).toBe(404);
  });

  it("a write between preview and apply, or a re-edited file, is 409 preview-stale and writes nothing", async () => {
    const id = await setup();
    const next = edited(ticketEdit);
    writeFileSync(path.join(pathsDir, FILE), asYaml(next));
    const p = await preview(id, { file: FILE });
    if (!("diff" in p.body)) throw new Error("expected a diff");

    // Another tab ticks a Task.
    await call("PUT", `/api/enrollments/${id}/tasks/go-brrr/state`, {
      status: "done",
      statusDate: "2026-09-26",
    });
    const stale = await apply(id, { file: FILE }, p.body.sourceHash, p.body.stateVersion);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: "preview-stale" } });

    // The file is edited again after a fresh preview.
    const fresh = await preview(id, { file: FILE });
    if (!("diff" in fresh.body)) throw new Error("expected a diff");
    writeFileSync(path.join(pathsDir, FILE), asYaml(edited((q) => (q.title = "Again"))));
    const stale2 = await apply(id, { file: FILE }, fresh.body.sourceHash, fresh.body.stateVersion);
    expect(stale2.status).toBe(409);

    const snap = (await call<Snapshot>("GET", `/api/enrollments/${id}`)).body;
    expect(snap.reloadedAt).toBeNull();
    expect(snap.tombstones).toEqual([]);
  });
});
