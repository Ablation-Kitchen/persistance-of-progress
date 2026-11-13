import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

let webDist: string;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  webDist = mkdtempSync(path.join(tmpdir(), "lt-web-"));
  writeFileSync(path.join(webDist, "index.html"), "<!doctype html><title>shell</title>");
  writeFileSync(path.join(webDist, "app.js"), "console.log(1)");
  app = await buildApp({ webDist });
});

afterAll(async () => {
  await app.close();
  rmSync(webDist, { recursive: true, force: true });
});

describe("server scaffold", () => {
  it("GET /api/health returns ok and dbVersion 0", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, dbVersion: 0 });
  });

  it.each(["/", "/today", "/notes", "/path?block=2&filter=open"])(
    "serves the shell at %s",
    async (url) => {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.body).toContain("<title>shell</title>");
    },
  );

  it("serves built assets", async () => {
    const res = await app.inject({ method: "GET", url: "/app.js" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("console.log(1)");
  });

  it("unknown /api routes 404 with the error shape, never the shell", async () => {
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: "not-found" } });
  });
});
