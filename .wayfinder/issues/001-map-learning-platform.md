---
title: "Map: Local learning-path tracker"
labels: [wayfinder:map]
status: closed
---

## Destination

A hand-off-ready spec for a locally-run (Docker) Node/React app that loads a Learning Path file conforming to our JSON Schema and turns it into a daily "what to do today" tracker with notes and progress — plus the list of build tickets to implement it. Building is a separate effort.

## Notes

- Domain: personal study tracking. Vocabulary in `/GLOSSARY.md` — consult and update it (call `domain-modeling` on grilling tickets).
- Reference path: `/samples/eval-infra-17-weeks.md` (the user's 17-week plan), the first real test of everything.
- Standing decisions from charting (not tickets):
  - App is a **tracker / visualization layer**, not a scheduler. Honour system: the user clicks "finished".
  - **Days are explicit in the file**: every Task has a `day` (1..N) relative to the Enrollment start date. Blocks and weekly rhythm are display labels only.
  - Format = **JSON Schema** contract, YAML files. Future LLM generation of paths must be able to target it (structured output), so keep it LLM-friendly.
  - Single user, no login; several Enrollments, one active.
  - Task kinds: material, exercise, checkpoint, reflection; `optional` flag. Status todo/done/skipped + completion date; overdue is derived. Exercises stay visible until done.
  - Missed days: stay overdue; manual "shift schedule by N days".
  - One Note concept (Markdown), attached to Task, Day, or Enrollment. Fill-in templates (e.g. Story bank) = a Task whose Note is pre-filled.
  - Stable Task ids so reloading an edited path keeps progress.
  - Stack: Node + Fastify, React + Vite, SQLite on a Docker volume, one container, `docker compose up`.
  - Loading: pick from mounted `./paths` folder or upload; asks for start date.
  - Screens: Today, Path, Notes. Exports: Notes → Markdown (by week), full JSON backup/restore.

## Decisions so far

- [Which JSON Schema features do LLM structured-output modes support?](issues/002-llm-structured-output-schema-subset.md): only a small shared subset (no min/max, no oneOf/allOf, all-required); keep range/uniqueness checks app-side, likely canonical + LLM-safe schemas.
- [Which SQLite driver fits a single Node container?](issues/003-sqlite-in-node-docker.md): built-in `node:sqlite` on Node 26 LTS, SQL-file migrations via `user_version`, DB on a named volume at `/data`.
- [Define the Learning Path schema](issues/004-define-learning-path-schema.md): Path → Blocks → Tasks, each Task with `day` + optional `dueDay`; author-written kebab ids; no Block ids; one canonical schema in the LLM-safe subset, with the generation schema derived from it; strict app-side validator ([draft](../schema/learning-path.schema.json)).
- [Convert the 17-week plan into the schema](issues/005-convert-sample-plan.md): the schema holds up (123 Tasks validate, [file](../samples/eval-infra-17-weeks.yaml)); the awkward spots are recurring Tasks, URL-less books and global rhythm labels, now a follow-up ticket; hand placement on days is laborious.
- [Which schema gaps from the 17-week conversion should be fixed?](issues/009-schema-gaps-from-conversion.md): no recurrence construct (explicit copies with `<series>-week-<n>` ids, never renumbered); `Link.url` optional for books; no resource type; Week Rhythm stays global and approximate.
- [What does an Enrollment store, and how are progress signals derived?](issues/007-enrollment-data-model.md): the Enrollment keeps a copy of the path; one state record per Task with an editable `statusDate` and a shift offset; shifts are logged, only the most recent can be undone; one Note per Task, date or Enrollment (Day Notes keyed by date); the browser's local date is today; optional Tasks never overdue; percent = done required ÷ required; streak by completion date, days with nothing scheduled skipped.
- [How does reloading an edited path treat existing progress?](issues/006-reload-reconciliation.md): one Enrollment at a time; refused on a validation failure or a different path `id`; only status, `statusDate`, offset and Note survive (matched by id); removed Tasks with progress or Notes are kept hidden behind tombstones and restored if the id returns; new Tasks start with the total of past shifts as their offset and may simply be overdue; a reload cancels undo for earlier shifts; preview then confirm or cancel; a banner when a file in `./paths` changes, never an automatic reload.
- [What should the Today view look like?](issues/008-today-view-prototype.md): week board + notes pane (7-day strip with clickable days; Catch up / Today / In progress columns; side pane with Task details, Task Note and Day Note) plus inline expand; stacks overdue → today → in progress on narrow screens; visual direction from the ablation.kitchen canvas; streak amended so a Note edit counts ([prototype](../prototypes/today-view/today-view.html)).
- [What should the Path screen look like?](issues/010-path-screen-prototype.md): Outline, with one collapsible section per Block (current open), Tasks by week with effective dates, filters, and a shift noted once per week heading; stats add checkpoints passed and Blocks complete; removed Tasks at the bottom; a derived Resource Index in a side column (de-duplicated by URL, books by fuzzy title; order first use / by Block / A–Z; search and filter) ([prototype](../prototypes/path-screen/path-prototype.html)).
- [What should the Notes screen look like?](issues/011-notes-screen-prototype.md): by Block, with the Enrollment Note as an "about this run" card, Block chips, Task Notes in path order with unwritten reflections shown as gaps, Day Notes in a side timeline; editing in a drawer showing the Task's prompt with Write/Preview; search over note text + Task titles with match counts per Block; removed Tasks on their own chip ([prototype](../prototypes/notes-screen/notes-prototype.html)).
- [What do the Markdown export and the JSON backup look like?](issues/012-export-backup-format.md): Markdown is one file per active Enrollment (`<path-id>_<start>_notes_<date>.md`), Block → week → day with the Enrollment Note first, Task Notes on their effective day under a title + kind/status line, Note headings pushed down, only written Notes, removed Tasks at the end; the JSON backup is the whole app with `formatVersion` (migrate older, refuse newer, separate from the DB version); restore replaces everything after a preview, writes a pre-restore safety copy, runs in one transaction, refuses on any validation error; the backup's path copy always wins, and a differing `./paths` file just triggers the reload banner.
- [How is the app packaged and run with Docker Compose?](issues/013-docker-compose-specifics.md): two-stage `node:26-bookworm-slim` image built locally, running as `node`, with Fastify serving the built frontend; published on `127.0.0.1:${PORT:-4321}`; `./paths` mounted read-only and rescanned on demand (load, focus, every 60 s), never watched; the named volume `appdata:/data`; the Backup is download only, with a README warning and a "last backup" hint; a `VACUUM INTO` Safety Copy before migrations (keep 3); `init`, `restart: unless-stopped`, a node-fetch healthcheck, no TZ; the repo ships `paths/` with the sample; first run is empty state → pick (start date defaults to next Monday) → Today.
- [What is the API between React and Fastify, and how does the frontend hold state?](issues/014-api-and-frontend-state.md): one snapshot per Enrollment (Note bodies in bulk) with small writes and full snapshots after bulk ones; a shared pure `core` workspace (validator, derived signals, reload diff, TypeBox contracts), with signals computed live on the client; "today" only as explicit date fields; `{error:{code,message,issues}}` with pointer/line issues; stateless preview → apply guarded by `sourceHash` + `stateVersion`; path hash over canonical JSON; TanStack Query + URL state (`/today?day=`), optimistic single ticks, whole-body Note autosave (~800 ms, last write wins), template Notes created on first edit; `react-markdown` + GFM, HTML off.
- [Assemble the hand-off spec and slice it into build tickets](issues/015-assemble-spec-and-build-tickets.md): [spec](../spec/SPEC.md) plus 16 ordered [build tickets](../spec/build-tickets/README.md) with acceptance criteria, with the 17-week path as the end-to-end fixture; choices made while assembling are listed in the spec's §13.

## Not yet specified

Each item now has a ticket:

- ~~Path screen~~ → decided in [010](issues/010-path-screen-prototype.md)
- ~~Notes screen~~ → decided in [011](issues/011-notes-screen-prototype.md)
- ~~Markdown export and JSON backup/restore format~~ → decided in [012](issues/012-export-backup-format.md)
- ~~Docker/compose packaging and first run~~ → decided in [013](issues/013-docker-compose-specifics.md)
- ~~API shape and frontend state~~ → decided in [014](issues/014-api-and-frontend-state.md)
- ~~Final spec, build tickets, and the generation-schema build script~~ → done in [015](issues/015-assemble-spec-and-build-tickets.md)

## Out of scope

- LLM generation of Learning Paths (future effort; the schema is designed to allow it).
- Markdown → path importer; reminders/notifications; structured forms for templates; time tracking; multi-user/auth; automatic scheduling or rollover.
