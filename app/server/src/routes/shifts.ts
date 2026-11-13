import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { EnrollmentParams, ShiftBody, Snapshot } from "@learning-tracker/core";
import type { Db } from "../db/index.js";
import { applyShift, undoLatestShift } from "../enrollments/shifts.js";
import { requireDate } from "../errors.js";

/** `POST …/shifts` and `DELETE …/shifts/latest` (spec §8.3). Both return the snapshot. */
export function shiftRoutes(fastify: FastifyInstance, db: Db) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.post(
    "/api/enrollments/:id/shifts",
    { schema: { params: EnrollmentParams, body: ShiftBody, response: { 200: Snapshot } } },
    async (request) =>
      applyShift(
        db,
        request.params.id,
        request.body.days,
        requireDate(request.body.appliedOn, "appliedOn"),
      ),
  );

  app.delete(
    "/api/enrollments/:id/shifts/latest",
    { schema: { params: EnrollmentParams, response: { 200: Snapshot } } },
    async (request) => undoLatestShift(db, request.params.id),
  );
}
