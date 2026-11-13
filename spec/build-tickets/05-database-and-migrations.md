---
title: "Database, migrations and pre-migrate Safety Copy"
status: closed
blocked_by: [1]
---

**Spec:** §4.1, §4.2, §11.

## Scope

- `server/db.ts`: open `/data/tracker.db` (configurable for tests) with `node:sqlite` `DatabaseSync`, set the pragmas from §4.1, and provide the `transaction(fn)` helper (`BEGIN IMMEDIATE`).
- A migration runner over `server/migrations/NNN-*.sql` and `PRAGMA user_version`, which runs before `listen()`. Migration `001` creates **all** the tables in §4.1, so later tickets don't need migrations.
- **Safety Copy:** when `user_version` < the latest migration and the database isn't new, run `VACUUM INTO '/data/pre-migrate-v<old>-<timestamp>.db'` first, then prune to the newest 3.
- A settings repository (`activeEnrollmentId`, `lastBackupAt`, `appStateVersion`) and the version-bump helpers, which bump the Enrollment's `state_version` and `appStateVersion` together in the same transaction.
- `/api/health` returns the real `dbVersion`.

## Acceptance

- [x] A fresh volume gets `user_version = 1` and no Safety Copy.
- [x] A test database at version 0 with a fake `002`: startup writes `pre-migrate-v1-*.db`. Running it 4 times leaves 3 copies.
- [x] An exception inside `transaction()` rolls back every statement.
- [x] After `docker compose restart`, the data is still there. After `docker compose down -v`, it's gone, which the README in 16 warns about.
