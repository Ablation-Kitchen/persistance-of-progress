import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, type Db } from "./db.js";
import { migrate, readMigrations, type MigrateResult } from "./migrate.js";

export * from "./db.js";
export * from "./migrate.js";
export * from "./settings.js";

/** `server/migrations`, from both `src/db` (tests, tsx) and `dist/db` (the build). */
export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

/** Open `<dataDir>/tracker.db` and migrate it. Runs before `listen()`. */
export function openAndMigrate(
  dataDir: string,
  migrationsDir = MIGRATIONS_DIR,
): { db: Db; migration: MigrateResult } {
  const db = openDb(path.join(dataDir, "tracker.db"));
  try {
    const migration = migrate(db, { migrations: readMigrations(migrationsDir), dataDir });
    return { db, migration };
  } catch (err) {
    db.close();
    throw err;
  }
}
