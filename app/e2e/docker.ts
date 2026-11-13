/**
 * Docker control for the end-to-end run. Every command goes through `compose()`, which pins the
 * project name and the e2e compose file, so nothing here can reach another Compose project or
 * its volumes (in particular a real `app_appdata`).
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT = "lt-e2e";
export const PORT = 4399;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
const COMPOSE_FILE = path.join(here, "compose.e2e.yaml");
export const TMP = path.join(here, ".tmp");
export const TMP_PATHS = path.join(TMP, "paths");
export const FIXTURE_NAME = "eval-infra-17-weeks.yaml";
const FIXTURE = path.join(here, "..", "paths", FIXTURE_NAME);

function assertProject() {
  const declared = /^name:\s*(\S+)\s*$/m.exec(readFileSync(COMPOSE_FILE, "utf8"))?.[1];
  if (PROJECT !== "lt-e2e" || declared !== PROJECT) {
    throw new Error(`refusing to run docker compose: project is ${PROJECT}/${declared}`);
  }
}

export function compose(...args: string[]) {
  assertProject();
  execFileSync("docker", ["compose", "-p", PROJECT, "-f", COMPOSE_FILE, ...args], {
    stdio: "inherit",
  });
}

export const up = () => compose("up", "-d", "--build", "--wait");

/** `down -v` for the e2e project only: wipes `lt-e2e_appdata`, nothing else. */
export function downWipe(extra: string[] = []) {
  assertProject();
  compose("down", "-v", ...extra);
}

/** A fresh, writable copy of the fixture for the container's read-only `/paths`. */
export function resetPaths() {
  rmSync(TMP_PATHS, { recursive: true, force: true });
  mkdirSync(TMP_PATHS, { recursive: true });
  cpSync(FIXTURE, path.join(TMP_PATHS, FIXTURE_NAME));
}

/**
 * Remove one Task from the temporary fixture copy: its `- id:` line and every following line
 * indented deeper than the dash (or blank).
 */
export function removeTaskFromFixture(taskId: string) {
  const file = path.join(TMP_PATHS, FIXTURE_NAME);
  const lines = readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\s*- id: ${taskId}\\s*$`).test(l));
  if (start < 0) throw new Error(`task ${taskId} not found in the fixture copy`);
  const dash = lines[start]!.indexOf("-");
  let end = start + 1;
  while (end < lines.length) {
    const l = lines[end]!;
    const indent = l.length - l.trimStart().length;
    if (l.trim() !== "" && indent <= dash) break;
    end++;
  }
  lines.splice(start, end - start);
  writeFileSync(file, lines.join("\n"));
}
