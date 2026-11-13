import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { EnrollmentParams, PlainDate, notesExport } from "@learning-tracker/core";
import { Type } from "typebox";
import type { Db } from "../db/index.js";
import { snapshot } from "../enrollments/repo.js";
import { requireDate } from "../errors.js";
import { listNotes } from "../notes/repo.js";

/** `?today=` comes from the browser: the server never decides what day it is (spec §8.1). */
const ExportQuery = Type.Object({ today: PlainDate });

export function exportRoutes(fastify: FastifyInstance, db: Db) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  /** Notes → Markdown (spec §9.1), as an attachment. */
  app.get(
    "/api/enrollments/:id/notes-export",
    { schema: { params: EnrollmentParams, querystring: ExportQuery } },
    async (request, reply) => {
      const today = requireDate(request.query.today, "today");
      const snap = snapshot(db, request.params.id);
      const { filename, markdown } = notesExport(snap, listNotes(db, snap.id), today);
      return reply
        .type("text/markdown; charset=utf-8")
        .header("content-disposition", `attachment; filename="${filename}"`)
        .send(markdown);
    },
  );
}
