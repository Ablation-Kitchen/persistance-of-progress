---
title: "How is the app packaged and run with Docker Compose?"
labels: [wayfinder:grilling]
status: closed
assignee: sombra
parent: 1
blocked_by: [12]
---

## Question

Settle the run-time packaging: base image and Node version, a multi-stage build (Vite build, then a slim runtime), the port and how it's set, the `./paths` bind mount (read-only? how the app watches it for the reload banner from [006](006-reload-reconciliation.md)), the named volume at `/data`, and how the JSON backup relates to the volume (download only, or also scheduled snapshots onto a host folder). Also the user's whole first-run experience, from `docker compose up` to the first Enrollment.

_Context: [003](003-sqlite-in-node-docker.md) chose `node:sqlite` on Node 26 LTS, a named volume at `/data`, migrations at startup, and `backup()`/`VACUUM INTO`._

## Resolution

Grilled 2026-11-12. The glossary now has **Safety Copy**.

- **Image:** a two-stage Dockerfile on `node:26-bookworm-slim`, pinned to major 26. The **build stage** runs `npm ci` (with `node_modules` in `.dockerignore`), then the Vite build and the server build. The **runtime stage** holds production dependencies, the server output and the built `dist/`, which Fastify serves from the same origin. It runs as `USER node`, with `RUN mkdir /data && chown node:node /data` so a new named volume belongs to uid 1000 ([003](003-sqlite-in-node-docker.md)). Slim was chosen over Alpine to avoid musl surprises if we ever fall back to `better-sqlite3`.
- **Source:** compose builds the image locally (`build: .`), and no image is published. An upgrade is `git pull && docker compose up --build`.
- **Port:** the container always listens on 3000. Compose publishes it as `127.0.0.1:${PORT:-4321}:3000`, which is localhost only because there is no login. The host port can be changed with `PORT` in `.env`. LAN access (e.g. from a phone) means editing that one line, which the README documents.
- **Mounts:** `./paths:/paths:ro` (read-only) and the named volume `appdata:/data`. Uploaded paths live only as the Enrollment's copy in the database ([007](007-enrollment-data-model.md)) and are never written to `./paths`. The repo ships `paths/` with the 17-week sample (`eval-infra-17-weeks.yaml`) and a README pointing at the schema. If `/paths` is missing or empty, the picker simply offers Upload and Restore.
- **Changed-file banner ([006](006-reload-reconciliation.md)):** there is **no file watcher**, because events across the macOS bind mount and editors' save-by-rename are unreliable. The server rescans `/paths` when the frontend asks: on page load, when the window regains focus, and every 60 s while it is open. The scan stats each `*.yaml`/`*.yml` file, re-hashes only those whose mtime or size changed, and compares the result with the active Enrollment's path `id` and hash.
- **Backups:** the JSON Backup ([012](012-export-backup-format.md)) is **download only** in v1. The README warns that `docker compose down -v` (or deleting the volume in Docker Desktop) wipes all data, and the app menu shows a "last backup: N days ago" hint. Scheduled snapshots onto a host `./backups` folder are a possible later feature.
- **Safety copy before migrations:** when startup finds the database's `user_version` older than the code's, it first writes `VACUUM INTO '/data/pre-migrate-v<old>-<timestamp>.db'`, keeps the last 3 such copies, then runs the migrations before `listen()`. This is the counterpart of 012's pre-restore copy.
- **Compose runtime settings:** `init: true` (tini, so SIGTERM reaches Node and the database closes cleanly), `restart: unless-stopped`, and a healthcheck using `node -e "fetch('http://localhost:3000/api/health')…"`, since slim has no curl. Logs go to stdout only. There is no `TZ`: "today" is the browser's local date (007), stored timestamps are UTC ISO, and the client sends its local date for the dates in export filenames.
- **First run:**
  1. `docker compose up --build`. The log prints `Learning tracker ready at http://localhost:4321`, and no browser opens automatically.
  2. The empty state offers **Load a path** (files from `/paths` with title, Task count and validation status), **Upload a file**, and **Restore from backup**.
  3. Picking a path asks for the start date, which defaults to the next Monday with "today" one click away. A file that fails validation shows its error list and can't be picked.
  4. On confirm, the Enrollment is created, made active, and the learner lands on Today.
- **Handed to [014](014-api-and-frontend-state.md):** `GET /api/health`, the `/paths` rescan endpoint and its polling, the client-supplied local date for export filenames, and the "last backup" timestamp.
