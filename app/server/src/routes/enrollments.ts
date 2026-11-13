import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  CreateEnrollmentBody,
  EnrollmentParams,
  EnrollmentSummary,
  PatchEnrollmentBody,
  Snapshot,
  UPLOAD_LIMIT_BYTES,
  type PathSource,
} from "@learning-tracker/core";
import { Type } from "typebox";
import type { Db } from "../db/index.js";
import {
  createEnrollment,
  deleteEnrollment,
  listEnrollments,
  setStartDate,
  snapshot,
} from "../enrollments/repo.js";
import { requireDate } from "../errors.js";
import { loadOrThrow, type PathScanner } from "../paths/scan.js";

/** Read a `source` (a `/paths` file or an upload) and load it, or throw 404 / 422. */
export function loadSource(scanner: PathScanner, source: PathSource) {
  const text = "file" in source ? scanner.read(source.file).text : source.yaml;
  return loadOrThrow(text);
}

export function enrollmentRoutes(fastify: FastifyInstance, db: Db, scanner: PathScanner) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    "/api/enrollments",
    { schema: { response: { 200: Type.Array(EnrollmentSummary) } } },
    async () => listEnrollments(db),
  );

  app.post(
    "/api/enrollments",
    {
      bodyLimit: UPLOAD_LIMIT_BYTES,
      schema: { body: CreateEnrollmentBody, response: { 201: Snapshot } },
    },
    async (request, reply) => {
      const startDate = requireDate(request.body.startDate, "startDate");
      const { path, hash } = loadSource(scanner, request.body.source);
      return reply.code(201).send(createEnrollment(db, { path, hash, startDate }));
    },
  );

  app.get(
    "/api/enrollments/:id",
    { schema: { params: EnrollmentParams, response: { 200: Snapshot } } },
    async (request) => snapshot(db, request.params.id),
  );

  app.patch(
    "/api/enrollments/:id",
    {
      schema: { params: EnrollmentParams, body: PatchEnrollmentBody, response: { 200: Snapshot } },
    },
    async (request) =>
      setStartDate(db, request.params.id, requireDate(request.body.startDate, "startDate")),
  );

  app.delete(
    "/api/enrollments/:id",
    { schema: { params: EnrollmentParams } },
    async (request, reply) => {
      deleteEnrollment(db, request.params.id);
      return reply.code(204).send();
    },
  );
}
