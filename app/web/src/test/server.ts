/// <reference types="node" />
/**
 * Test harness: the real server (Fastify + SQLite in a temp dir) behind `fetch`, through
 * `app.inject`. UI tests then exercise the actual routes and database.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../../../server/src/app.js";
import { openAndMigrate } from "../../../server/src/db/index.js";

export const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../paths/eval-infra-17-weeks.yaml",
);

export interface TestServer {
  pathsDir: string;
  writePath(name: string, text: string): void;
  close(): Promise<void>;
}

export async function startServer({ withFixture = true } = {}): Promise<TestServer> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "lt-web-"));
  const pathsDir = path.join(dataDir, "paths");
  mkdirSync(pathsDir);
  if (withFixture) copyFileSync(FIXTURE, path.join(pathsDir, "eval-infra-17-weeks.yaml"));
  const app = await buildApp({
    webDist: path.join(dataDir, "no-web"),
    db: openAndMigrate(dataDir).db,
    pathsDir,
  });

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const res = await app.inject({
      method: (init?.method ?? "GET") as "GET",
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(typeof init?.body === "string" && { payload: init.body }),
    });
    const body = res.statusCode === 204 ? null : res.body;
    return new Response(body, {
      status: res.statusCode,
      headers: { "content-type": String(res.headers["content-type"] ?? "application/json") },
    });
  };

  return {
    pathsDir,
    writePath: (name, text) => writeFileSync(path.join(pathsDir, name), text),
    async close() {
      globalThis.fetch = realFetch;
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
