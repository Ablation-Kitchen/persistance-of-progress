import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  EnrollmentParams,
  ReloadBody,
  ReloadPreviewBody,
  ReloadPreviewResponse,
  Snapshot,
  UPLOAD_LIMIT_BYTES,
} from "@learning-tracker/core";
import type { Db } from "../db/index.js";
import type { PathScanner } from "../paths/scan.js";
import { applyReload, previewReload } from "../reload/reload.js";
import { loadSource } from "./enrollments.js";

/** `POST …/reload/preview` and `POST …/reload` (spec §6, §8.4). The source is a file or an upload. */
export function reloadRoutes(fastify: FastifyInstance, db: Db, scanner: PathScanner) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.post(
    "/api/enrollments/:id/reload/preview",
    {
      bodyLimit: UPLOAD_LIMIT_BYTES,
      schema: {
        params: EnrollmentParams,
        body: ReloadPreviewBody,
        response: { 200: ReloadPreviewResponse },
      },
    },
    async (request) =>
      previewReload(db, request.params.id, loadSource(scanner, request.body.source)),
  );

  app.post(
    "/api/enrollments/:id/reload",
    {
      bodyLimit: UPLOAD_LIMIT_BYTES,
      schema: { params: EnrollmentParams, body: ReloadBody, response: { 200: Snapshot } },
    },
    async (request) => {
      const { source, expectedSourceHash, expectedStateVersion } = request.body;
      return applyReload(db, request.params.id, loadSource(scanner, source), {
        sourceHash: expectedSourceHash,
        stateVersion: expectedStateVersion,
      });
    },
  );
}
