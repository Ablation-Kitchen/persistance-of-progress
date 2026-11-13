import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyServerOptions } from "fastify";
import fastifyStatic from "@fastify/static";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { HealthResponse } from "@learning-tracker/core";
import { userVersion, type Db } from "./db/index.js";
import { installErrorHandler } from "./errors.js";
import { PathScanner } from "./paths/scan.js";
import { appRoutes } from "./routes/app.js";
import { enrollmentRoutes } from "./routes/enrollments.js";
import { noteRoutes } from "./routes/notes.js";
import { pathRoutes } from "./routes/paths.js";
import { shiftRoutes } from "./routes/shifts.js";

export interface AppOptions {
  /** Directory holding the built frontend (`web/dist`). Missing is fine: only the API is served. */
  webDist: string;
  /** Open, migrated database. The app closes it on `close()`. */
  db: Db;
  /** The read-only `/paths` folder. Missing is fine: the scan returns `[]`. */
  pathsDir: string;
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp({ webDist, db, pathsDir, logger = false }: AppOptions) {
  // Request logs are at info level; main.ts runs the logger at warn, so they stay quiet.
  const app = Fastify({ logger }).withTypeProvider<TypeBoxTypeProvider>();
  app.addHook("onClose", async () => {
    if (db.isOpen) db.close();
  });

  installErrorHandler(app);
  const scanner = new PathScanner(pathsDir);

  app.get("/api/health", { schema: { response: { 200: HealthResponse } } }, async () => ({
    ok: true as const,
    dbVersion: userVersion(db),
  }));

  appRoutes(app, db);
  pathRoutes(app, scanner);
  enrollmentRoutes(app, db, scanner);
  shiftRoutes(app, db);
  noteRoutes(app, db);

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
