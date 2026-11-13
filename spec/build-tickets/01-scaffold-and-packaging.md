---
title: "Repo scaffold, health route and Docker packaging"
status: closed
blocked_by: []
---

**Spec:** §11, §8.3 (`/api/health`), §7.1 (look).

## Scope

- npm workspaces `core/`, `server/` and `web/`, with TypeScript (strict), ESLint, Prettier and Vitest. Each workspace has `build` and `test` scripts.
- `server`: Fastify serves `web/dist`, with a fallback to `index.html` for every non-`/api` path. Add `GET /api/health → {ok: true, dbVersion: 0}` (the database arrives in 05). Log the ready line, and close cleanly on SIGTERM.
- `web`: a Vite + React shell with React Router (`/today`, `/path`, `/notes` placeholders), the header nav, a light/dark toggle, and the design tokens and fonts from §7.1.
- Dockerfile (two stages on `node:26-bookworm-slim`), `compose.yaml` exactly as in §11, `.dockerignore` (including `node_modules`), `.env.example` with `PORT=4321`, and `paths/` holding the 17-week fixture plus a README.

## Acceptance

- [x] `docker compose up --build` on a clean checkout logs `Learning tracker ready at http://localhost:4321`. The container turns **healthy**.
- [x] `http://127.0.0.1:4321/notes` serves the shell (fallback works). `/api/health` returns `{ok: true}`. The port isn't reachable on the LAN address.
- [x] `PORT=5000` in `.env` moves the host port.
- [x] The container runs as `node`, and `/data` is owned by `node`.
- [x] `docker compose stop` exits within 2 s (tini forwards SIGTERM).
