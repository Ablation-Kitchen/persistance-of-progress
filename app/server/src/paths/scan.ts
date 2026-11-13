import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { allTasks, loadPath, type LoadResult, type PathFile } from "@learning-tracker/core";
import { ApiError, notFound, problems } from "../errors.js";

const PATH_FILE = /\.ya?ml$/i;

interface Cached {
  mtimeMs: number;
  size: number;
  entry: PathFile;
}

/**
 * The `/paths` scan (spec §8.5): stat every `*.yaml`/`*.yml`, and re-read and validate only files
 * whose mtime or size changed. Never watches the folder.
 */
export class PathScanner {
  private cache = new Map<string, Cached>();

  constructor(readonly dir: string) {}

  scan(): PathFile[] {
    let names: string[];
    try {
      names = readdirSync(this.dir).filter((n) => PATH_FILE.test(n));
    } catch {
      this.cache.clear();
      return [];
    }
    const seen = new Set<string>();
    const out: PathFile[] = [];
    for (const name of names.sort()) {
      const full = path.join(this.dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue; // removed between readdir and stat
      }
      if (!st.isFile()) continue;
      seen.add(name);
      const hit = this.cache.get(name);
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
        out.push(hit.entry);
        continue;
      }
      const entry = describe(
        name,
        st.size,
        st.mtime,
        loadPath(readFileSync(full, "utf8"), { source: "yaml" }),
      );
      this.cache.set(name, { mtimeMs: st.mtimeMs, size: st.size, entry });
      out.push(entry);
    }
    for (const name of this.cache.keys()) if (!seen.has(name)) this.cache.delete(name);
    return out;
  }

  /** Read `file` fresh from disk for a create or reload. 404 for anything that isn't a plain path file. */
  read(file: string): { text: string; filename: string } {
    if (file !== path.basename(file) || !PATH_FILE.test(file)) throw notFound(`Path file ${file}`);
    try {
      return { text: readFileSync(path.join(this.dir, file), "utf8"), filename: file };
    } catch {
      throw notFound(`Path file ${file}`);
    }
  }
}

function describe(file: string, size: number, mtime: Date, result: LoadResult): PathFile {
  const base = { file, size, mtime: mtime.toISOString() };
  if (!result.ok) return { ...base, valid: false, issues: result.issues };
  const { path: p, hash } = result;
  return {
    ...base,
    valid: true,
    hash,
    pathId: p.id,
    title: p.title,
    ...(p.version !== undefined && { version: p.version }),
    ...(p.startWeekday !== undefined && { startWeekday: p.startWeekday }),
    taskCount: allTasks(p).length,
  };
}

/** Load a path or fail with 422 `path-invalid`. */
export function loadOrThrow(text: string) {
  const result = loadPath(text, { source: "yaml" });
  if (!result.ok) {
    throw new ApiError(422, "path-invalid", problems(result.issues.length), result.issues);
  }
  return result;
}
