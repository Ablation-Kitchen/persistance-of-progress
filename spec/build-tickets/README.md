# Build tickets

These tickets slice [the spec](../SPEC.md) into ordered pieces that can each be built on their own. Front matter follows the wayfinder convention (`status`, `blocked_by`), so the build effort can track them the same way. Any ticket whose blockers are all closed can start, so 02/04/05 can run in parallel after 01, and so on.

Every ticket's **done** includes: types check, lint passes, and the new tests are green.

| # | Ticket | Blocked by |
|---|---|---|
| 01 | [Repo scaffold, health route and Docker packaging](01-scaffold-and-packaging.md) | none |
| 02 | [Path loader and validator in `core`](02-path-loader-and-validator.md) | 01 |
| 03 | [Generation-schema build script](03-generation-schema-script.md) | 02 |
| 04 | [Derived signals in `core`](04-derived-signals.md) | 02 |
| 05 | [Database, migrations and pre-migrate Safety Copy](05-database-and-migrations.md) | 01 |
| 06 | [`/paths` scan, Enrollments API and first run](06-paths-enrollments-first-run.md) | 02, 05 |
| 07 | [Today screen and Task ticking](07-today-and-ticking.md) | 04, 06 |
| 08 | [Notes API, editor and autosave](08-notes-api-and-editor.md) | 07 |
| 09 | [Schedule Shift and undo](09-schedule-shift.md) | 07 |
| 10 | [Path screen outline](10-path-screen.md) | 07 |
| 11 | [Resource Index](11-resource-index.md) | 10 |
| 12 | [Notes screen](12-notes-screen.md) | 08 |
| 13 | [Reload: diff, preview/apply and banner](13-reload.md) | 06, 09 |
| 14 | [Notes Markdown export](14-notes-export.md) | 08, 09 |
| 15 | [JSON Backup and restore](15-backup-and-restore.md) | 08, 09, 13 |
| 16 | [README and end-to-end acceptance](16-readme-and-e2e-acceptance.md) | all |
