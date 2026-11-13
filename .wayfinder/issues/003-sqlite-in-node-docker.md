---
title: "Which SQLite driver fits a single Node container?"
labels: [wayfinder:research]
status: closed
assignee: claude
parent: 1
blocked_by: []
---

## Question

For a single Docker container running Fastify + a built React app, with SQLite on a mounted volume: should we use built-in `node:sqlite` (stability status in current Node LTS) or `better-sqlite3` (native build implications on alpine/debian-slim, multi-arch for Apple Silicon)? Also: a lightweight migration approach that fits, and any gotchas with SQLite WAL files on Docker volumes on macOS.

Findings: `/research/sqlite-in-node-docker.md`

## Resolution

Findings: [/research/sqlite-in-node-docker.md](../../research/sqlite-in-node-docker.md) (docs-based; Docker not run locally).

- Use built-in **`node:sqlite`** on **Node 26 LTS** (no flag, stability 1.2 RC, no warning). Import `DatabaseSync` (works on 22/24/26). Add a ~10-line `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` transaction helper.
- Fallback: `better-sqlite3` v13+ (N-API, prebuilt glibc/musl x64/arm64 — no compiler needed) if nested transactions or custom builds are needed.
- Migrations: numbered `.sql` files + `PRAGMA user_version`, run at startup before `listen()`, no library.
- Docker: DB on a **named volume** mounted at `/data` (not a bind mount; WAL `-shm` can't be shared across the macOS VM boundary). Don't open the live DB from the host.
- Ops: WAL + `synchronous=NORMAL`, set busy timeout, back up via `backup()`/`VACUUM INTO`, close on SIGTERM, `/data` owned by the `node` user.
