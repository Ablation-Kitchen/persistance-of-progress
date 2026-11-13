import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

/** Open the database file and apply the §4.1 pragmas. */
export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  return db;
}

/**
 * Run `fn` inside `BEGIN IMMEDIATE … COMMIT`. Any throw rolls back every statement and rethrows.
 * Not re-entrant: callers compose plain functions inside one transaction instead of nesting.
 */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw err;
  }
}

export function userVersion(db: Db): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}
