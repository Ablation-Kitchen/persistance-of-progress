import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  DeleteNoteResponse,
  EnrollmentParams,
  NoteBody,
  NoteParams,
  PutNoteBody,
  PutNoteResponse,
} from "@learning-tracker/core";
import { Type } from "typebox";
import type { Db } from "../db/index.js";
import { requireDate } from "../errors.js";
import { deleteNote, listNotes, putNote } from "../notes/repo.js";

export function noteRoutes(fastify: FastifyInstance, db: Db) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    "/api/enrollments/:id/notes",
    { schema: { params: EnrollmentParams, response: { 200: Type.Array(NoteBody) } } },
    async (request) => listNotes(db, request.params.id),
  );

  app.put(
    "/api/enrollments/:id/notes/:target",
    { schema: { params: NoteParams, body: PutNoteBody, response: { 200: PutNoteResponse } } },
    async (request) => {
      const { body, editedOn, fromTemplate } = request.body;
      return putNote(db, request.params.id, request.params.target, {
        body,
        editedOn: requireDate(editedOn, "editedOn"),
        fromTemplate,
      });
    },
  );

  app.delete(
    "/api/enrollments/:id/notes/:target",
    { schema: { params: NoteParams, response: { 200: DeleteNoteResponse } } },
    async (request) => deleteNote(db, request.params.id, request.params.target),
  );
}
