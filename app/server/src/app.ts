import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyServerOptions } from "fastify";
import fastifyStatic from "@fastify/static";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { HealthResponse } from "@learning-tracker/core";

export interface AppOptions {
  /** Directory holding the built frontend (`web/dist`). Missing is fine: only the API is served. */
  webDist: string;
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp({ webDist, logger = false }: AppOptions) {
  // Request logs are at info level; main.ts runs the logger at warn, so they stay quiet.
  const app = Fastify({ logger }).withTypeProvider<TypeBoxTypeProvider>();

  app.get("/api/health", { schema: { response: { 200: HealthResponse } } }, async () => ({
    ok: true as const,
    dbVersion: 0,
  }));

  const hasWeb = existsSync(path.join(webDist, "index.html"));
  if (hasWeb) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, index: ["index.html"] });
  }

  // Unknown /api routes get the §8.2 error shape; every other GET falls back to the SPA shell.
  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url === "/api" || request.url.startsWith("/api/");
    const isRead = request.method === "GET" || request.method === "HEAD";
    if (!isApi && isRead && hasWeb) {
      return reply.type("text/html").sendFile("index.html");
    }
    return reply.code(404).send({
      error: { code: "not-found", message: `No route for ${request.method} ${request.url}` },
    });
  });

  return app;
}
