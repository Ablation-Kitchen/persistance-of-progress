import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { notesExport, type NoteBody, type Snapshot } from "@learning-tracker/core";
import { buildApp } from "../app.js";
import { openAndMigrate, type Db } from "../db/index.js";

const FIXTURE = new URL("../../../paths/eval-infra-17-weeks.yaml", import.meta.url);

let dataDir: string;
let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let id: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "lt-export-"));
  const pathsDir = path.join(dataDir, "paths");
  mkdirSync(pathsDir);
  copyFileSync(FIXTURE, path.join(pathsDir, "eval-infra-17-weeks.yaml"));
  db = openAndMigrate(dataDir).db;
  app = await buildApp({ webDist: path.join(dataDir, "no-web"), db, pathsDir });
  const res = await app.inject({
    method: "POST",
    url: "/api/enrollments",
    payload: { source: { file: "eval-infra-17-weeks.yaml" }, startDate: "2026-09-07" },
  });
  id = res.json<Snapshot>().id;
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const get = (url: string) => app.inject({ method: "GET", url });
const putNote = (target: string, body: string, editedOn: string) =>
  app.inject({
    method: "PUT",
    url: `/api/enrollments/${id}/notes/${encodeURIComponent(target)}`,
    payload: { body, editedOn },
  });

describe("GET /api/enrollments/:id/notes-export", () => {
  it("returns the core export as a Markdown attachment named from the path, start and today", async () => {
    await putNote("enrollment", "# Why\n\nThe job.", "2026-09-08");
    await putNote("day:2026-09-08", "First day.", "2026-09-08");
    await putNote(
      "task:build-gpt-from-scratch",
      "# Heading\n\n## Sub\n\n```\n# kept\n```",
      "2026-09-08",
    );

    const res = await get(`/api/enrollments/${id}/notes-export?today=2026-09-10`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="eval-infra-17-weeks_2026-09-07_notes_2026-09-10.md"',
    );

    // The route only gathers the data; the layout is core's.
    const snap = (await get(`/api/enrollments/${id}`)).json<Snapshot>();
    const bodies = (await get(`/api/enrollments/${id}/notes`)).json<NoteBody[]>();
    expect(res.body).toBe(notesExport(snap, bodies, "2026-09-10").markdown);
    expect(res.body).toContain("###### Heading\n\n**Sub**\n\n```\n# kept\n```");
    expect(res.body).toContain("## About this run\n\n### Why");
  });

  it("needs a real ?today= and a known Enrollment", async () => {
    for (const q of ["", "?today=2026-02-30", "?today=9/10/2026"]) {
      const res = await get(`/api/enrollments/${id}/notes-export${q}`);
      expect(res.statusCode, q).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: "bad-request" } });
    }
    const missing = await get("/api/enrollments/nope/notes-export?today=2026-09-10");
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: "not-found" } });
  });

  it("writes nothing", async () => {
    const before = (await get(`/api/enrollments/${id}`)).json<Snapshot>().stateVersion;
    await get(`/api/enrollments/${id}/notes-export?today=2026-09-10`);
    expect((await get(`/api/enrollments/${id}`)).json<Snapshot>().stateVersion).toBe(before);
  });
});
