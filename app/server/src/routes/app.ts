import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { AppInfo, BACKUP_FORMAT_VERSION, SetActiveBody } from "@learning-tracker/core";
import { getSettings, type Db } from "../db/index.js";
import { setActive } from "../enrollments/repo.js";

const appVersion = (
  JSON.parse(
    readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../package.json"),
      "utf8",
    ),
  ) as {
    version: string;
  }
).version;

export function appInfo(db: Db): AppInfo {
  const s = getSettings(db);
  return {
    activeEnrollmentId: s.activeEnrollmentId,
    lastBackupAt: s.lastBackupAt,
    appVersion,
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    appStateVersion: s.appStateVersion,
  };
}

export function appRoutes(fastify: FastifyInstance, db: Db) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get("/api/app", { schema: { response: { 200: AppInfo } } }, async () => appInfo(db));

  app.put(
    "/api/app/active",
    { schema: { body: SetActiveBody, response: { 200: AppInfo } } },
    async (request) => {
      setActive(db, request.body.enrollmentId);
      return appInfo(db);
    },
  );
}
