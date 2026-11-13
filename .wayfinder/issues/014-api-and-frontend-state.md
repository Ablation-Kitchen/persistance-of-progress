---
title: "What is the API between React and Fastify, and how does the frontend hold state?"
labels: [wayfinder:grilling]
status: closed
assignee: sombra
parent: 1
blocked_by: [10, 11, 12]
---

## Question

With the screens and exports settled, define the HTTP API (resources, routes, payloads, error shape, path validation results, the reload preview/apply pair, shift/undo, Note saves and their edit dates, export/backup endpoints) and how the browser sends "today" ([007](007-enrollment-data-model.md)). Then the frontend state approach: a server-cache library vs. hand-rolled fetches, optimistic ticks, Note autosave and debounce, and where derived signals (overdue, percent, streak) are computed (server, client, or a shared module).

_Context from the packaging decision ([013](013-docker-compose-specifics.md)): the API must also cover `GET /api/health` (used by the compose healthcheck), a `/paths` rescan endpoint that the frontend calls on page load, on window focus and every 60 s (it powers the changed-file banner and the first-run picker with title, Task count and validation status), the client's local date sent for export filenames, and a "last backup" timestamp for the app-menu hint. Stored timestamps are UTC ISO._

## Resolution

Grilled 2026-11-12. No glossary changes: the terms here are technical, not domain.

**Code layout**

- npm workspaces `core/`, `server/`, `web/`. `core` holds **pure functions only** (no I/O, no clock; `today` is always passed in): the path validator, the derived signals (open, overdue, percent, bonus, streak, effective days, week/Block mapping, Resource Index), the reload diff, and the **TypeBox** schemas for every request and response. Fastify validates and serializes with them, and the client takes its static types from the same source: no codegen, no OpenAPI. The Learning Path JSON Schema stays its own hand-written canonical file ([004](004-define-learning-path-schema.md)). The derivations are tested once, in `core`, against the 17-week fixture.
- The client computes every derived signal live from the snapshot. The server uses the same functions only for the Notes Export header and the restore preview.

**"Today" and dates**

- No header. Every request that records a date carries it explicitly: `statusDate` on Task state, `editedOn` on a Note save, `appliedOn` on a shift, `?today=YYYY-MM-DD` on exports. The server checks only the format (back-dating and early ticks are allowed, [007](007-enrollment-data-model.md)) and never reads its own clock for a date. `updatedAt`, `lastBackupAt` and similar timestamps are UTC ISO.

**Reads**

- `GET /api/enrollments/:id` returns the **snapshot**: the path copy, Task state records, shift log, tombstones, Note **metadata** (target, `fromTemplate`, edit-date trail, length, `updatedAt`), the path `id` and hash, and `stateVersion`, a counter bumped on every write to that Enrollment. Note **bodies** come in bulk from `GET …/notes`, so Today doesn't pay for them. The streak works from the trail in the metadata.
- `GET /api/enrollments` is light: `{id, pathId, title, startDate, createdAt, taskCount}`. Percent and streak are shown only for the active Enrollment.

**Routes**

| Route | Purpose |
|---|---|
| `GET /api/health` | `{ok, dbVersion}` for the compose healthcheck ([013](013-docker-compose-specifics.md)) |
| `GET /api/app` | active Enrollment id, `lastBackupAt`, appVersion, backup `formatVersion` |
| `PUT /api/app/active` `{enrollmentId}` | switch Enrollment |
| `GET /api/paths` | rescan `/paths` |
| `GET /api/enrollments` | switcher list |
| `POST /api/enrollments` `{source, startDate}` | create and make active → snapshot |
| `GET /api/enrollments/:id` | snapshot |
| `PATCH /api/enrollments/:id` `{startDate}` | re-anchor → snapshot |
| `DELETE /api/enrollments/:id` | delete (confirmed in the UI) |
| `PUT /api/enrollments/:id/tasks/:taskId/state` `{status, statusDate}` | tick, skip, untick, back-date → record |
| `GET /api/enrollments/:id/notes` | all Note bodies |
| `PUT /api/enrollments/:id/notes/:target` `{body, editedOn, fromTemplate?}` | save → metadata |
| `DELETE /api/enrollments/:id/notes/:target` | delete a Note |
| `POST /api/enrollments/:id/shifts` `{days, appliedOn}` | shift → snapshot |
| `DELETE /api/enrollments/:id/shifts/latest` | undo → snapshot |
| `POST /api/enrollments/:id/reload/preview`, `POST /api/enrollments/:id/reload` | reload pair |
| `GET /api/enrollments/:id/notes-export?today=` | Markdown download, filename in `Content-Disposition` ([012](012-export-backup-format.md)) |
| `GET /api/backup?today=` | JSON Backup download |
| `POST /api/restore/preview`, `POST /api/restore` | restore pair |

- `source` is `{file}` (a name from `/paths`) or `{filename, yaml}` (an upload). A Note `target` is `task:<id>`, `day:YYYY-MM-DD` or `enrollment`. It must be a Task in the current copy, a tombstone, any valid date, or the Enrollment; anything else is a 404.
- Setting a Task back to `todo` clears `statusDate` but keeps the record, since it holds `offsetDays`.
- **Removed (tombstoned) Tasks:** their status is frozen (`PUT …/state` → 409 `task-removed`) until a reload restores the id ([006](006-reload-reconciliation.md)). Their Notes stay editable and deletable.
- Every non-`/api` path serves `index.html`.

**Errors and validation**

- Every non-2xx response: `{ "error": { "code", "message", "issues"? } }`. `code` is a stable kebab string the client switches on. **400** for a malformed request (TypeBox), **404** for an unknown Enrollment, Task or Note target, **409** for a conflict (`preview-stale`, a different path id on reload, nothing to undo, `task-removed`), **413** for an upload that's too large, **422** for a path or Backup that parses but is invalid.
- A validation issue is `{pointer, line?, column?, rule, message}`. `rule` is `schema` or a named app-side rule (`yaml-syntax`, `duplicate-task-id`, `day-out-of-range`, `due-before-day`, …). `line`/`column` come from the `yaml` library's source map when the input was YAML; for a Backup the pointer refers into the JSON. The same issues appear per file in `/api/paths` and in the picker, reload and restore dialogs.

**Uploads, hashing, preview → apply**

- Uploads are file text inside a JSON body (`{filename, yaml}` / `{backup}`), read in the browser with `File.text()`. There is no multipart. The upload routes have a **5 MB** body limit (413 above it).
- **Path hash** = SHA-256 of the **canonical JSON** of the parsed path (keys sorted, no whitespace), so comment or formatting edits don't raise the changed-file banner, and an upload matches the identical `/paths` file. The Enrollment stores the parsed JSON, not the YAML text (refines [007](007-enrollment-data-model.md)).
- **Reload and restore are stateless pairs.** Preview returns the diff or summary plus `sourceHash` and the current `stateVersion` (for restore, a whole-app counter). Apply resends the source with `expectedSourceHash` and `expectedStateVersion`. The server recomputes everything and answers **409 `preview-stale`** on any mismatch, and the client re-runs the preview. No server-held tokens.

**`/paths` and the banner**

- `GET /api/paths` returns facts: `[{file, size, mtime, hash?, valid, pathId?, title?, version?, taskCount?, issues?}]`, cached server-side by mtime and size ([013](013-docker-compose-specifics.md)). The **client** shows the banner when a valid file has the active Enrollment's `pathId` and a different hash. If several files qualify, the banner lists them and the learner picks one to preview. The query refetches on focus and polls every 60 s only while the tab is visible.

**App settings**

- **Deleting the active Enrollment** sets the active setting to `null`, and the app then shows the switcher, or the empty state if no Enrollments are left. Nothing is activated silently. On open, the app goes to the active Enrollment's Today, or to the switcher/empty state if the setting is `null`.
- **`lastBackupAt`** is set once `GET /api/backup` has sent the full response, which makes the hint approximate (the README says so). A restore sets it to the Backup's `exportedAt`. Safety Copies don't count.

**Frontend state**

- **TanStack Query** holds all server state (snapshot, Note bodies, `/api/paths`, `/api/app`). There's no Redux/Zustand. UI state lives in the URL or in components, routed with **React Router**: `/today`, `/today?day=YYYY-MM-DD` (a calendar date, not a path day number; this is [010](010-path-screen-prototype.md)'s "open day N in Today"), `/path?block=&filter=`, `/notes?block=&q=&note=task:<id>` (opens the drawer).
- **Optimistic** for single-Task status changes (tick, skip, untick, `statusDate`): the cache updates at once, so every derived signal moves; on failure it rolls back with a "Couldn't save" toast. **Server-confirmed** with a spinner for create, start date, shift, undo, reload and restore.
- **Cache after writes:** small writes patch the snapshot and Note-body caches from the response (`setQueryData`, including the new `stateVersion`). Bulk writes replace the snapshot. Switching Enrollments invalidates `/api/app`. A restore clears the whole cache.
- **Note autosave:** whole-body `PUT`, debounced by ~800 ms, flushed immediately on drawer close, Esc, blur and `visibilitychange`/`pagehide` (with `keepalive`). A "saving… / saved" indicator shows. **Last write wins** across tabs, with no version check. The server stores the body and `updatedAt`, and adds `editedOn` to the trail if it's a new date.
- **Templates (refines [011](011-notes-screen-prototype.md)):** opening a Task with a `noteTemplate` shows the template as the editor's starting text, but **nothing is stored until the first edit**. That first save stores the body with `fromTemplate: true` and the first trail date, so just looking doesn't add a streak day or fill the "template ready" gap. A Note emptied to blank stays a Note. Deleting is an explicit action.
- **Markdown rendering:** one shared `<NoteView>` on `react-markdown` + `remark-gfm` (tables for the story bank, task lists, autolinks). Raw HTML is shown as text, links open in a new tab. It's used in the drawer Preview, the Notes cards, the Enrollment card and the Today pane's new Write/Preview toggle. The server never renders Markdown.
