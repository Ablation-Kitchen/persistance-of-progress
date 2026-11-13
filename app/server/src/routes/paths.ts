import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { PathFile } from "@learning-tracker/core";
import { Type } from "typebox";
import type { PathScanner } from "../paths/scan.js";

export function pathRoutes(fastify: FastifyInstance, scanner: PathScanner) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();
  app.get("/api/paths", { schema: { response: { 200: Type.Array(PathFile) } } }, async () =>
    scanner.scan(),
  );
}
