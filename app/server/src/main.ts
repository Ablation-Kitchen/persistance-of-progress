import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { openAndMigrate } from "./db/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = process.env.WEB_DIST ?? path.resolve(here, "../../web/dist");
const listenPort = Number(process.env.LISTEN_PORT ?? 3000);
// The host port compose publishes; only used for the ready line.
const publicPort = process.env.PUBLIC_PORT ?? String(listenPort);

const dataDir = process.env.DATA_DIR ?? "/data";
const pathsDir = process.env.PATHS_DIR ?? "/paths";

// Migrations (and any pre-migrate Safety Copy) finish before the server listens.
const { db, migration } = openAndMigrate(dataDir);
if (migration.from !== migration.to) {
  const copy = migration.safetyCopy ? `; safety copy ${migration.safetyCopy}` : "";
  console.log(`Database migrated v${migration.from} → v${migration.to}${copy}`);
}

const app = await buildApp({
  webDist,
  db,
  pathsDir,
  dataDir,
  logger: { level: process.env.LOG_LEVEL ?? "warn" },
});

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`${signal} received, shutting down`);
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: "0.0.0.0", port: listenPort });
console.log(`Learning tracker ready at http://localhost:${publicPort}`);
