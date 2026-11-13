import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppInfo, EnrollmentSummary, PathFile, Snapshot } from "@learning-tracker/core";
import { buildApp } from "../app.js";
import { openAndMigrate, type Db } from "../db/index.js";

const FIXTURE = new URL("../../../paths/eval-infra-17-weeks.yaml", import.meta.url);
const fixtureText = readFileSync(FIXTURE, "utf8");

let dataDir: string;
let pathsDir: string;
let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "lt-data-"));
  pathsDir = path.join(dataDir, "paths");
  mkdirSync(pathsDir);
  copyFileSync(FIXTURE, path.join(pathsDir, "eval-infra-17-weeks.yaml"));
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

const create = (startDate = "2026-09-07", source: unknown = { file: "eval-infra-17-weeks.yaml" }) =>
  call<Snapshot>("POST", "/api/enrollments", { source, startDate });

describe("GET /api/paths", () => {
  it("lists the fixture as valid with its title and Task count", async () => {
    const { status, body } = await call<PathFile[]>("GET", "/api/paths");
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      file: "eval-infra-17-weeks.yaml",
      valid: true,
      taskCount: 123,
    });
    expect(body[0]?.title).toBeTruthy();
    expect(body[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns [] when /paths is missing", async () => {
    rmSync(pathsDir, { recursive: true });
    expect((await call("GET", "/api/paths")).body).toEqual([]);
  });

  it("marks an invalid file with its issues and re-reads only changed files", async () => {
    const bad = path.join(pathsDir, "broken.yml");
    const pinned = new Date("2026-01-01T00:00:00Z");
    writeFileSync(bad, "schemaVersion: 1\nid: Not Kebab\n");
    utimesSync(bad, pinned, pinned);
    const first = (await call<PathFile[]>("GET", "/api/paths")).body;
    const entry = first.find((f) => f.file === "broken.yml");
    expect(entry?.valid).toBe(false);
    expect(entry?.issues?.length).toBeGreaterThan(0);
    expect(entry).not.toHaveProperty("taskCount");

    // Same size and mtime → cached result, even though the content changed.
    writeFileSync(bad, "schemaVersion: 1\nid: not-kebab\n");
    utimesSync(bad, pinned, pinned);
    const cached = (await call<PathFile[]>("GET", "/api/paths")).body.find(
      (f) => f.file === "broken.yml",
    );
    expect(cached?.issues).toEqual(entry?.issues);

    writeFileSync(bad, fixtureText);
    const fresh = (await call<PathFile[]>("GET", "/api/paths")).body.find(
      (f) => f.file === "broken.yml",
    );
    expect(fresh?.valid).toBe(true);
  });

  it("ignores non-YAML files", async () => {
    writeFileSync(path.join(pathsDir, "README.md"), "# hi");
    expect((await call<PathFile[]>("GET", "/api/paths")).body).toHaveLength(1);
  });
});

describe("Enrollments", () => {
  it("first run: no active Enrollment, then create makes it active", async () => {
    const before = await call<AppInfo>("GET", "/api/app");
    expect(before.body).toMatchObject({ activeEnrollmentId: null, backupFormatVersion: 1 });

    const { status, body } = await create();
    expect(status).toBe(201);
    expect(body).toMatchObject({ startDate: "2026-09-07", stateVersion: 1, reloadedAt: null });
    expect(body.path.blocks).toHaveLength(6);
    expect(body).toMatchObject({ taskStates: [], shifts: [], tombstones: [], noteMeta: [] });

    const after = await call<AppInfo>("GET", "/api/app");
    expect(after.body.activeEnrollmentId).toBe(body.id);
    expect(after.body.appStateVersion).toBeGreaterThan(before.body.appStateVersion);

    const list = await call<EnrollmentSummary[]>("GET", "/api/enrollments");
    expect(list.body).toEqual([
      expect.objectContaining({ id: body.id, taskCount: 123, startDate: "2026-09-07" }),
    ]);
    expect((await call<Snapshot>("GET", `/api/enrollments/${body.id}`)).body).toEqual(body);
  });

  it("uploading the fixture gives the same pathHash as the /paths copy", async () => {
    const listed = (await call<PathFile[]>("GET", "/api/paths")).body[0];
    const fromFile = (await create()).body;
    const uploaded = (await create("2026-09-07", { filename: "mine.yaml", yaml: fixtureText }))
      .body;
    expect(uploaded.pathHash).toBe(fromFile.pathHash);
    expect(uploaded.pathHash).toBe(listed?.hash);
  });

  it("an invalid upload is 422 path-invalid with issues; an unknown file is 404", async () => {
    const bad = await call<{ error: { code: string; issues: unknown[] } }>(
      "POST",
      "/api/enrollments",
      {
        source: { filename: "x.yaml", yaml: "schemaVersion: 2\n" },
        startDate: "2026-09-07",
      },
    );
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("path-invalid");
    expect(bad.body.error.issues.length).toBeGreaterThan(0);

    for (const file of ["nope.yaml", "../paths/eval-infra-17-weeks.yaml", "x.txt"]) {
      const res = await create("2026-09-07", { file });
      expect(res.status, file).toBe(404);
    }
  });

  it("PATCH startDate keeps statuses and offsets", async () => {
    const { id } = (await create()).body;
    db.prepare(
      `INSERT INTO task_states (enrollment_id, task_id, status, status_date, offset_days, updated_at)
       VALUES (?, 'intro-to-llms', 'done', '2026-09-07', 3, 'x')`,
    ).run(id);
    const { status, body } = await call<Snapshot>("PATCH", `/api/enrollments/${id}`, {
      startDate: "2026-10-05",
    });
    expect(status).toBe(200);
    expect(body.startDate).toBe("2026-10-05");
    expect(body.stateVersion).toBe(2);
    expect(body.taskStates).toEqual([
      {
        taskId: "intro-to-llms",
        status: "done",
        statusDate: "2026-09-07",
        offsetDays: 3,
        updatedAt: "x",
      },
    ]);
  });

  it("deleting the active Enrollment leaves none active", async () => {
    const a = (await create()).body;
    const b = (await create("2026-09-14")).body;
    expect((await call("DELETE", `/api/enrollments/${b.id}`)).status).toBe(204);
    expect((await call<AppInfo>("GET", "/api/app")).body.activeEnrollmentId).toBeNull();
    expect(
      (await call<EnrollmentSummary[]>("GET", "/api/enrollments")).body.map((e) => e.id),
    ).toEqual([a.id]);
    expect((await call("GET", `/api/enrollments/${b.id}`)).status).toBe(404);

    const set = await call<AppInfo>("PUT", "/api/app/active", { enrollmentId: a.id });
    expect(set.body.activeEnrollmentId).toBe(a.id);
    expect((await call("PUT", "/api/app/active", { enrollmentId: "nope" })).status).toBe(404);

    expect((await call("DELETE", `/api/enrollments/${a.id}`)).status).toBe(204);
    expect((await call("GET", "/api/enrollments")).body).toEqual([]);
  });
});

describe("validation and limits", () => {
  it("a 6 MB upload is 413 too-large", async () => {
    const yaml = "#".repeat(6 * 1024 * 1024);
    const res = await call<{ error: { code: string } }>("POST", "/api/enrollments", {
      source: { filename: "big.yaml", yaml },
      startDate: "2026-09-07",
    });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("too-large");
  });

  it.each(["2026-02-30", "2026-9-7", "tomorrow"])(
    "startDate %s is 400 bad-request",
    async (startDate) => {
      const res = await create(startDate);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: "bad-request" } });
      const { id } = (await create()).body;
      const patched = await call("PATCH", `/api/enrollments/${id}`, { startDate });
      expect(patched.status).toBe(400);
    },
  );

  it("a malformed body is 400", async () => {
    const res = await call("POST", "/api/enrollments", {
      source: { nope: 1 },
      startDate: "2026-09-07",
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "bad-request" } });
  });
});
