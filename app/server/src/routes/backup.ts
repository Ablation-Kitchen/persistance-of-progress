import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  AppInfo,
  BackupQuery,
  backupFilename,
  backupJson,
  RestoreBody,
  RestorePreviewBody,
  RestorePreviewResponse,
  UPLOAD_LIMIT_BYTES,
} from "@learning-tracker/core";
import type { Db } from "../db/index.js";
import { applyRestore, markBackedUp, previewRestore, readBackup } from "../backup/backup.js";
import { requireDate } from "../errors.js";
import { appInfo, appVersion } from "./app.js";

/** `GET /api/backup`, `POST /api/restore/preview` and `POST /api/restore` (spec §8.3, §9.2). */
export function backupRoutes(fastify: FastifyInstance, db: Db, dataDir: string) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    "/api/backup",
    {
      schema: { querystring: BackupQuery },
      // `onResponse` runs once the response has been fully sent (not on an aborted download).
      // The server can't know the browser saved the file; "fully sent" is the best it can do.
      onResponse: (_request, reply, done) => {
        if (reply.statusCode === 200) markBackedUp(db);
        done();
      },
    },
    async (request, reply) => {
      const today = requireDate(request.query.today, "today");
      return reply
        .header("content-type", "application/json; charset=utf-8")
        .header("content-disposition", `attachment; filename="${backupFilename(today)}"`)
        .send(backupJson(readBackup(db, appVersion)));
    },
  );

  app.post(
    "/api/restore/preview",
    {
      bodyLimit: UPLOAD_LIMIT_BYTES,
      schema: { body: RestorePreviewBody, response: { 200: RestorePreviewResponse } },
    },
    async (request) =>
      previewRestore(db, request.body.backup, requireDate(request.body.today, "today"), appVersion),
  );

  app.post(
    "/api/restore",
    { bodyLimit: UPLOAD_LIMIT_BYTES, schema: { body: RestoreBody, response: { 200: AppInfo } } },
    async (request) => {
      const { backup, expectedSourceHash, expectedStateVersion } = request.body;
      applyRestore(
        db,
        dataDir,
        backup,
        { sourceHash: expectedSourceHash, stateVersion: expectedStateVersion },
        appVersion,
      );
      return appInfo(db);
    },
  );
}
