import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { transaction, userVersion, type Db } from "./db.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** `NNN-name.sql` files in version order. Gaps or duplicates are a packaging bug, so they throw. */
export function readMigrations(dir: string): Migration[] {
  const migrations = readdirSync(dir)
    .filter((f) => /^\d{3}-.+\.sql$/.test(f))
    .sort()
    .map((f) => ({
      version: Number(f.slice(0, 3)),
      name: f,
      sql: readFileSync(path.join(dir, f), "utf8"),
    }));
  migrations.forEach((m, i) => {
    if (m.version !== i + 1)
      throw new Error(`Migration ${m.name} out of sequence (expected ${i + 1})`);
  });
  return migrations;
}

export interface MigrateOptions {
  migrations: Migration[];
  /** Where Safety Copies go (the folder holding the database, `/data` in the container). */
  dataDir: string;
  /** How many pre-migrate Safety Copies to keep. */
  keep?: number;
  now?: () => Date;
}

export interface MigrateResult {
  from: number;
  to: number;
  safetyCopy?: string;
}

const COPY_PATTERN = /^pre-migrate-v(\d+)-(\d{8}T\d{9}Z)\.db$/;

/**
 * Bring the database up to the latest migration (spec §4.1, §11). When an existing database is
 * older than the code, a `VACUUM INTO` Safety Copy is written first and older copies are pruned.
 * Each migration runs in its own transaction together with its `user_version` bump.
 */
export function migrate(
  db: Db,
  { migrations, dataDir, keep = 3, now = () => new Date() }: MigrateOptions,
): MigrateResult {
  const from = userVersion(db);
  const latest = migrations.at(-1)?.version ?? 0;
  if (from > latest) {
    throw new Error(
      `Database is at version ${from}, newer than this app (${latest}). Upgrade the app.`,
    );
  }
  if (from === latest) return { from, to: from };

  let safetyCopy: string | undefined;
  if (from > 0) {
    safetyCopy = path.join(dataDir, `pre-migrate-v${from}-${stamp(now())}.db`);
    db.exec(`VACUUM INTO '${safetyCopy.replaceAll("'", "''")}'`);
    pruneSafetyCopies(dataDir, keep);
  }

  for (const m of migrations) {
    if (m.version <= from) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return safetyCopy ? { from, to: latest, safetyCopy } : { from, to: latest };
}

/** Keep the newest `keep` pre-migrate copies, by the timestamp in their name. */
export function pruneSafetyCopies(dataDir: string, keep: number) {
  const copies = readdirSync(dataDir)
    .map((name) => ({ name, match: COPY_PATTERN.exec(name) }))
    .filter((c): c is { name: string; match: RegExpExecArray } => c.match !== null)
    .sort((a, b) => (b.match[2]! < a.match[2]! ? -1 : b.match[2]! > a.match[2]! ? 1 : 0));
  for (const old of copies.slice(keep)) rmSync(path.join(dataDir, old.name), { force: true });
}

/** `20261112T213005123Z`: sortable, filename-safe UTC timestamp with milliseconds. */
function stamp(d: Date): string {
  return d.toISOString().replace(/[-:.]/g, "");
}
