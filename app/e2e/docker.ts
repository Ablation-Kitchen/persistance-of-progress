/**
 * Docker control for the end-to-end run. Every command goes through `compose()`, which pins the
 * project name and the e2e compose file, so nothing here can reach another Compose project or
 * its volumes (in particular a real `app_appdata`).
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { YAMLMap, isMap, parseDocument, visit } from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT = "lt-e2e";
export const PORT = 4399;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
const COMPOSE_FILE = path.join(here, "compose.e2e.yaml");
export const TMP = path.join(here, ".tmp");
export const TMP_PATHS = path.join(TMP, "paths");
export const FIXTURE_NAME = "eval-infra-17-weeks.yaml";
const FIXTURE = path.join(here, "..", "paths", FIXTURE_NAME);

export function compose(...args: string[]) {
  const declared = /^name:\s*(\S+)\s*$/m.exec(readFileSync(COMPOSE_FILE, "utf8"))?.[1];
  if (declared !== PROJECT) {
    throw new Error(`refusing to run docker compose: the e2e compose file declares ${declared}`);
  }
  execFileSync("docker", ["compose", "-p", PROJECT, "-f", COMPOSE_FILE, ...args], {
    stdio: "inherit",
    // compose.e2e.yaml reads the host port from here, so Playwright and the container agree.
    env: { ...process.env, E2E_PORT: String(PORT) },
  });
}

export const up = () => compose("up", "-d", "--build", "--wait");

/** `down -v` for the e2e project only: wipes `lt-e2e_appdata`, nothing else. */
export function downWipe(extra: string[] = []) {
  compose("down", "-v", ...extra);
}

/** A fresh, writable copy of the fixture for the container's read-only `/paths`. */
export function resetPaths() {
  rmSync(TMP_PATHS, { recursive: true, force: true });
  mkdirSync(TMP_PATHS, { recursive: true });
  cpSync(FIXTURE, path.join(TMP_PATHS, FIXTURE_NAME));
}

/** Remove one Task, by id, from the temporary fixture copy (comments and layout kept). */
export function removeTaskFromFixture(taskId: string) {
  const file = path.join(TMP_PATHS, FIXTURE_NAME);
  const doc = parseDocument(readFileSync(file, "utf8"));
  let found = 0;
  visit(doc, {
    Seq(_key, seq) {
      const before = seq.items.length;
      seq.items = seq.items.filter(
        (item) => !(isMap(item) && (item as YAMLMap).get("id") === taskId),
      );
      found += before - seq.items.length;
    },
  });
  if (found !== 1)
    throw new Error(`expected one task ${taskId} in the fixture copy, found ${found}`);
  writeFileSync(file, doc.toString());
}
