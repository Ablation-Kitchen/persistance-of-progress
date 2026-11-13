import { mkdtempSync, readdirSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MIGRATIONS_DIR,
  bumpAppStateVersion,
  bumpEnrollmentVersion,
  getSettings,
  migrate,
  openAndMigrate,
  openDb,
  readMigrations,
  setActiveEnrollmentId,
  setLastBackupAt,
  transaction,
  userVersion,
  type Db,
} from "./index.js";

let dataDir: string;
const open: Db[] = [];

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "lt-db-"));
});
afterEach(() => {
  for (const db of open.splice(0)) if (db.isOpen) db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function fresh(): Db {
  const { db } = openAndMigrate(dataDir);
  open.push(db);
  return db;
}

function copies() {
  return readdirSync(dataDir)
    .filter((f) => f.startsWith("pre-migrate-"))
    .sort();
}

const tables = (db: Db) =>
  (
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);

function insertEnrollment(db: Db, id = "e1") {
  db.prepare(
    `INSERT INTO enrollments (id, path_id, path_json, path_hash, start_date, created_at, loaded_at)
     VALUES (?, 'p', '{}', 'h', '2026-09-07', 'now', 'now')`,
  ).run(id);
}

describe("openAndMigrate", () => {
  it("a fresh volume gets user_version 1, every table, and no Safety Copy", () => {
    const { db, migration } = openAndMigrate(dataDir);
    open.push(db);
    expect(userVersion(db)).toBe(1);
    expect(migration).toEqual({ from: 0, to: 1 });
    expect(tables(db)).toEqual([
      "enrollments",
      "note_edits",
      "notes",
      "settings",
      "shifts",
      "task_states",
      "tombstones",
    ]);
    expect(copies()).toEqual([]);
  });

  it("sets the §4.1 pragmas", () => {
    const db = fresh();
    const pragma = (name: string) => Object.values(db.prepare(`PRAGMA ${name}`).get()!)[0];
    expect(pragma("journal_mode")).toBe("wal");
    expect(pragma("synchronous")).toBe(1); // NORMAL
    expect(pragma("foreign_keys")).toBe(1);
    expect(pragma("busy_timeout")).toBe(5000);
  });

  it("re-opening an up-to-date database changes nothing", () => {
    fresh().close();
    const { db, migration } = openAndMigrate(dataDir);
    open.push(db);
    expect(migration).toEqual({ from: 1, to: 1 });
    expect(copies()).toEqual([]);
  });

  it("refuses a database newer than the code", () => {
    const db = fresh();
    db.exec("PRAGMA user_version = 9");
    db.close();
    expect(() => openAndMigrate(dataDir)).toThrow(/newer than this app/);
  });
});

describe("pre-migrate Safety Copy", () => {
  let migrationsDir: string;
  beforeEach(() => {
    migrationsDir = mkdtempSync(path.join(tmpdir(), "lt-mig-"));
    cpSync(MIGRATIONS_DIR, migrationsDir, { recursive: true });
    writeFileSync(
      path.join(migrationsDir, "002-fake.sql"),
      "CREATE TABLE IF NOT EXISTS fake (x INTEGER);",
    );
  });
  afterEach(() => rmSync(migrationsDir, { recursive: true, force: true }));

  it("a v0 database with a fake 002 migrates, then a v1 one writes pre-migrate-v1-*.db", () => {
    // v0 → v2: a new database, so no copy.
    const first = openAndMigrate(dataDir, migrationsDir);
    expect(first.migration).toEqual({ from: 0, to: 2 });
    expect(copies()).toEqual([]);
    first.db.close();

    // Back to a v1 database with data, as if built by the previous release.
    const db = openDb(path.join(dataDir, "tracker.db"));
    open.push(db);
    db.exec("DROP TABLE fake; PRAGMA user_version = 1");
    insertEnrollment(db);
    db.close();

    const second = openAndMigrate(dataDir, migrationsDir);
    open.push(second.db);
    expect(second.migration.from).toBe(1);
    expect(second.migration.to).toBe(2);
    expect(copies()).toHaveLength(1);
    expect(copies()[0]).toMatch(/^pre-migrate-v1-\d{8}T\d{9}Z\.db$/);

    // The copy is a complete, readable database at the old version.
    const copy = openDb(path.join(dataDir, copies()[0]!));
    open.push(copy);
    expect(userVersion(copy)).toBe(1);
    expect(copy.prepare("SELECT id FROM enrollments").all()).toEqual([{ id: "e1" }]);
  });

  it("running the upgrade 4 times leaves the newest 3 copies", () => {
    fresh().close();
    const migrations = readMigrations(migrationsDir);
    let t = Date.UTC(2026, 10, 12, 9, 0, 0);
    const made: string[] = [];
    for (let run = 0; run < 4; run++) {
      const db = openDb(path.join(dataDir, "tracker.db"));
      db.exec("DROP TABLE IF EXISTS fake; PRAGMA user_version = 1");
      const result = migrate(db, { migrations, dataDir, now: () => new Date((t += 1000)) });
      made.push(path.basename(result.safetyCopy!));
      db.close();
    }
    expect(copies()).toEqual(made.slice(1).sort());
  });
});

describe("transaction", () => {
  it("an exception rolls back every statement", () => {
    const db = fresh();
    expect(() =>
      transaction(db, () => {
        insertEnrollment(db, "a");
        setActiveEnrollmentId(db, "a");
        bumpAppStateVersion(db);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.isTransaction).toBe(false);
    expect(db.prepare("SELECT count(*) AS n FROM enrollments").get()).toEqual({ n: 0 });
    expect(getSettings(db)).toEqual({
      activeEnrollmentId: null,
      lastBackupAt: null,
      appStateVersion: 0,
    });
  });

  it("a constraint failure mid-way rolls back the earlier statements", () => {
    const db = fresh();
    expect(() =>
      transaction(db, () => {
        insertEnrollment(db, "a");
        db.prepare(
          "INSERT INTO task_states (enrollment_id, task_id, status, updated_at) VALUES ('a', 't', 'nope', 'now')",
        ).run();
      }),
    ).toThrow(/CHECK constraint/);
    expect(db.prepare("SELECT count(*) AS n FROM enrollments").get()).toEqual({ n: 0 });
  });

  it("commits and returns the callback's value", () => {
    const db = fresh();
    expect(transaction(db, () => (insertEnrollment(db), 42))).toBe(42);
    expect(db.prepare("SELECT id FROM enrollments").all()).toEqual([{ id: "e1" }]);
  });
});

describe("settings and versions", () => {
  it("defaults, sets and clears settings", () => {
    const db = fresh();
    expect(getSettings(db)).toEqual({
      activeEnrollmentId: null,
      lastBackupAt: null,
      appStateVersion: 0,
    });
    insertEnrollment(db);
    setActiveEnrollmentId(db, "e1");
    setLastBackupAt(db, "2026-11-12T10:00:00.000Z");
    expect(getSettings(db)).toMatchObject({
      activeEnrollmentId: "e1",
      lastBackupAt: "2026-11-12T10:00:00.000Z",
    });
    setActiveEnrollmentId(db, null);
    expect(getSettings(db).activeEnrollmentId).toBeNull();
  });

  it("an Enrollment write bumps its state_version and appStateVersion together", () => {
    const db = fresh();
    insertEnrollment(db);
    insertEnrollment(db, "e2");
    expect(transaction(db, () => bumpEnrollmentVersion(db, "e1"))).toEqual({
      stateVersion: 1,
      appStateVersion: 1,
    });
    expect(transaction(db, () => bumpEnrollmentVersion(db, "e1"))).toEqual({
      stateVersion: 2,
      appStateVersion: 2,
    });
    expect(transaction(db, () => bumpEnrollmentVersion(db, "e2"))).toEqual({
      stateVersion: 1,
      appStateVersion: 3,
    });
    expect(transaction(db, () => bumpAppStateVersion(db))).toBe(4);
    expect(() => bumpEnrollmentVersion(db, "missing")).toThrow(/Unknown enrollment/);
  });

  it("deleting an Enrollment cascades to its rows", () => {
    const db = fresh();
    insertEnrollment(db);
    db.prepare(
      "INSERT INTO notes (enrollment_id, target, body, created_at, updated_at) VALUES ('e1', 'enrollment', 'x', 'now', 'now')",
    ).run();
    db.prepare("DELETE FROM enrollments WHERE id = 'e1'").run();
    expect(db.prepare("SELECT count(*) AS n FROM notes").get()).toEqual({ n: 0 });
  });
});
