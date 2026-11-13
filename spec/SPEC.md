# Learning Tracker: hand-off spec

Version 1 · assembled 2026-11-12 from the resolved tickets of the [map](../.wayfinder/issues/001-map-learning-platform.md). Build tickets: [`build-tickets/`](build-tickets/README.md).

This document is the contract for the build. Each section names its source tickets, which hold the reasoning and the alternatives that weren't chosen. Where this spec and a ticket disagree, **this spec wins**. Choices made while writing this spec, which no ticket covered, are marked **[A]** and listed in [§13](#13-decisions-made-while-assembling).

---

## 1. What we're building

A locally run web app (one Docker container, `docker compose up`) that loads a **Learning Path** file, written in YAML and validated against a JSON Schema, and turns it into a daily tracker of what to do today, with Notes and progress.

- **A tracker, not a scheduler.** Days are explicit in the file. The learner ticks Tasks on the honour system. The app never reschedules anything by itself; the only move is a learner-triggered Schedule Shift.
- **A single user, no login.** The learner may hold several Enrollments and works in one active Enrollment at a time.
- **Three screens:** Today, Path, Notes. **Two exports:** Notes → Markdown and a full JSON Backup with restore.
- **Stack:** Node 26 + Fastify, React + Vite, SQLite through `node:sqlite`, TypeScript throughout.

**Out of scope for v1:** LLM generation of paths (the schema is built to allow it later), a Markdown → path importer, reminders and notifications, structured forms for templates, time tracking, multiple users or auth, automatic scheduling or rollover, scheduled backups to a host folder, and exporting a single Enrollment.

**End-to-end fixture:** [`/samples/eval-infra-17-weeks.yaml`](../samples/eval-infra-17-weeks.yaml), the 17-week plan with 6 Blocks, 123 Tasks and 0 validation errors. It ships in `paths/` and is the acceptance fixture for every ticket.

---

## 2. Domain

The glossary in [`/GLOSSARY.md`](../GLOSSARY.md) is normative, and code, UI copy and API names use its terms. In brief:

| Term | Meaning |
|---|---|
| **Learning Path** | An authored file: Blocks of Tasks, each Task placed on an explicit day. Loaded many times. |
| **Enrollment** | One run through a path from a chosen start date. Holds a copy of the path plus all progress and Notes. One is **active**. |
| **Task** | The smallest unit the learner ticks off. Stable author-written `id`. |
| **Task Kind** | `material`, `exercise`, `checkpoint`, `reflection`. Any Task may be `optional`. |
| **Block** | A named group of consecutive days with a goal. Display only, with no id. |
| **Task Status** | `todo`, `done`, `skipped`. **Overdue** is derived and never stored. Optional Tasks are never overdue. |
| **Due Day** | The last day a Task is meant to be worked on (defaults to its day). Between day and due day the Task is **open**. |
| **Note** | Markdown attached to one target: a Task, a calendar date (Day Note), or the Enrollment. One Note per target. |
| **Day** | A calendar date within an Enrollment. |
| **Week Rhythm** | 7 descriptive labels for the roles of the days in a path week. Never filters anything. |
| **Schedule Shift** | Moves every `todo` Task forward N > 0 days through a per-Task offset. Only the most recent shift can be undone. |
| **Percent Complete** | Done required Tasks ÷ required Tasks. Done optional Tasks count separately as the **bonus**. |
| **Streak** | Consecutive days with a Task marked done or a Note edited. Days with nothing scheduled don't break it. |
| **Resource Index** | The de-duplicated list of everything the path points to. Derived, never stored. |
| **Notes Export** | One Markdown file of an Enrollment's Notes. One-way. |
| **Backup** | A versioned JSON snapshot of the whole app. A restore replaces everything. |
| **Safety Copy** | An automatic copy the server writes into `/data` before a restore or a migration. |

---

## 3. Learning Path format, validator, generation schema

_Sources: [002](../.wayfinder/issues/002-llm-structured-output-schema-subset.md), [004](../.wayfinder/issues/004-define-learning-path-schema.md), [005](../.wayfinder/issues/005-convert-sample-plan.md), [009](../.wayfinder/issues/009-schema-gaps-from-conversion.md), [014](../.wayfinder/issues/014-api-and-frontend-state.md)._

### 3.1 Canonical schema

The canonical schema is [`/schema/learning-path.schema.json`](../schema/learning-path.schema.json) (JSON Schema 2020-12). The build moves it to `core/schema/learning-path.schema.json` and `paths/README.md` links to it. It uses only constructs from the shared Anthropic/OpenAI structured-output subset (`type`, `properties`, `required`, `additionalProperties: false`, local `$ref`/`$defs`, primitive `enum`/`const`, simple `pattern`, `minItems` 0/1), but optional properties may be left out.

```
Path   { schemaVersion: 1, id, version?, title, description, startWeekday?, weekRhythm?, resources?: Resource[], blocks: Block[≥1] }
Block  { title, goal, description?, tasks: Task[≥1] }
Task   { id, day, dueDay?, kind, optional?, title, description?, links?: Link[], noteTemplate? }
Link   { title, url? }
Resource { title, url?, note? }
```

- `id` (path and Task): kebab-case, `^[a-z0-9]+(-[a-z0-9]+)*$`. Task ids are meaningful, not positional. Copies of a recurring Task are named `<series>-week-<n>` and are never renumbered.
- `day` ≥ 1. `dueDay` ≥ `day` and defaults to `day`. `optional` defaults to false.
- `weekRhythm` holds exactly 7 labels, indexed by `(day − 1) mod 7`. An empty string means no label.
- `startWeekday` is only a hint for the start-date picker.
- A Link without a `url` names an offline resource, such as a book.
- **Array order is the display order within a day.** Tasks inside a Block are **not** sorted by day in the file, so a day's Tasks are always ordered by `(day, array index)`. "Path order" means effective day, then position in the file.
- The path's **length** `N` = the largest `dueDay ?? day` across all Tasks. Blocks have no stored range; a Block's range is its first `day` through its last due day.

### 3.2 Loading pipeline (`core`)

`loadPath(text, {source: "yaml" | "json"}) → { ok: true, path, hash } | { ok: false, issues }`

1. **Parse** with the `yaml` package, using a `LineCounter` so every pointer can be mapped to a line and column. A syntax error yields one issue with rule `yaml-syntax`.
2. **Normalise:** lowercase `kind` and `startWeekday`.
3. **Schema validation:** Ajv (2020-12) against the canonical schema. Each failure becomes an issue with rule `schema`.
4. **App rules,** which run only when the schema passes:

| Rule | Check |
|---|---|
| `duplicate-task-id` | Task ids are unique across the path |
| `day-out-of-range` | `day` ≥ 1 |
| `due-before-day` | `dueDay` ≥ `day` |
| `blocks-overlap` | Blocks are in order and don't overlap: each Block's first day > the previous Block's last due day. Gaps and empty days are allowed. |
| `week-rhythm-length` | `weekRhythm`, if present, has exactly 7 entries |

5. **Hash** = SHA-256 (hex) of the **canonical JSON** of the normalised path: keys sorted recursively, no whitespace, array order kept. Comments and formatting therefore never change the hash. The Enrollment stores this parsed JSON, not the YAML text.

A file with any issue is rejected as a whole; there are no partial loads.

**Issue shape** (shared with reload and restore): `{ pointer: string, line?: number, column?: number, rule: string, message: string }`. `pointer` is a JSON Pointer such as `/blocks/2/tasks/5/day`.

### 3.3 Generation schema (build-time script)

`npm run build:generation-schema` (in `core`) reads the canonical schema and writes `core/schema/generated/learning-path.generation.schema.json`. A future LLM step targets the generated file with strict structured output.

The transformation:
- Every object's `required` lists **all** of its properties (OpenAI strict mode requires this).
- Each property that was optional becomes **nullable**: `"type": ["<t>", "null"]`. If it has an `enum`, `null` is added to the enum. A `$ref`-typed or array property becomes `"anyOf": [<original>, {"type": "null"}]`.
- `additionalProperties: false`, descriptions, `pattern`, `const`, `enum` and `minItems` (0/1) are copied unchanged. Top-level `$schema` and `$id` are dropped, while `title` and `description` stay.
- Each description of a field made nullable gets the suffix "Null when absent."

The script **fails** when:
- the canonical schema uses any keyword outside an allowlist (`type`, `properties`, `required`, `additionalProperties`, `items`, `$ref`, `$defs`, `enum`, `const`, `pattern`, `minItems` ≤ 1, `description`, `title`, `$schema`, `$id`, `anyOf` below the root); or
- the output has more than 16 nullable fields, which is Claude's cap on union-typed fields. The current schema has 13.

**Ingest of generated output:** `normaliseGenerated(obj)` deletes every `null` property recursively. The result then goes through the normal pipeline (§3.2, with `source: "json"`).

**Drift check:** a test regenerates the schema in memory and asserts that it equals the committed file.

---

## 4. Data model

_Sources: [003](../.wayfinder/issues/003-sqlite-in-node-docker.md), [006](../.wayfinder/issues/006-reload-reconciliation.md), [007](../.wayfinder/issues/007-enrollment-data-model.md), [012](../.wayfinder/issues/012-export-backup-format.md), [014](../.wayfinder/issues/014-api-and-frontend-state.md)._

### 4.1 Storage

- **Database:** SQLite at `/data/tracker.db` through `node:sqlite` (`DatabaseSync`), on a named Docker volume.
- **Pragmas:** WAL, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- **Transactions:** a small helper wraps `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`.
- **Migrations:** numbered `server/migrations/NNN-*.sql` files, applied at startup before `listen()`, with the level tracked in `PRAGMA user_version`. When the database is older than the code, the server first writes a **Safety Copy**: `VACUUM INTO '/data/pre-migrate-v<old>-<timestamp>.db'`, keeping the newest 3.
- **Shutdown:** the database closes on SIGTERM.

Tables (column names are indicative) **[A]**:

```sql
settings      (key TEXT PRIMARY KEY, value TEXT)            -- activeEnrollmentId | lastBackupAt | appStateVersion
enrollments   (id TEXT PRIMARY KEY,                          -- crypto.randomUUID()
               path_id TEXT, path_json TEXT, path_hash TEXT,
               start_date TEXT,                              -- local YYYY-MM-DD
               created_at TEXT, loaded_at TEXT, reloaded_at TEXT NULL,   -- UTC ISO
               state_version INTEGER DEFAULT 0)
task_states   (enrollment_id, task_id, status TEXT CHECK (status IN ('todo','done','skipped')),
               status_date TEXT NULL, offset_days INTEGER DEFAULT 0, updated_at TEXT,
               PRIMARY KEY (enrollment_id, task_id))
notes         (enrollment_id, target TEXT,                   -- 'task:<id>' | 'day:YYYY-MM-DD' | 'enrollment'
               body TEXT, from_template INTEGER, created_at TEXT, updated_at TEXT,
               PRIMARY KEY (enrollment_id, target))
note_edits    (enrollment_id, target, edited_on TEXT,        -- local date; the edit-date trail
               PRIMARY KEY (enrollment_id, target, edited_on))
shifts        (id INTEGER PRIMARY KEY, enrollment_id, applied_on TEXT, days INTEGER,
               task_ids TEXT /* JSON array */, created_at TEXT)
tombstones    (enrollment_id, task_id, title, kind, former_day INTEGER, removed_at TEXT,
               PRIMARY KEY (enrollment_id, task_id))
```

The foreign keys from child tables to `enrollments` use `ON DELETE CASCADE`.

### 4.2 Rules

- **Path copy:** the Enrollment stores the parsed path JSON and its hash. Only a reload changes it. One path can have several Enrollments.
- **Start date:** it can be changed. Changing it re-anchors every Task while keeping statuses and offsets. Day Notes stay on their dates.
- **Active Enrollment:** a single setting, not a flag. It is `null` when nothing is active: on first run, or after the active Enrollment is deleted.
- **Task state:** a Task with no record is `todo` with offset 0. Setting a Task back to `todo` clears `status_date` but keeps the record and its offset. There is no history.
- **Removed (tombstoned) Tasks:** their state records and Notes are kept, but hidden. Their status is frozen and their Note stays editable.
- **Notes:** one per target.
  - A save adds its `editedOn` date to `note_edits` if that date isn't there yet.
  - A Task with a `noteTemplate` gets a stored Note only on its **first edit**, saved with `from_template = 1`. Opening it only shows the template.
  - A blank Note is still a Note.
  - Deleting a Note removes it and its trail **[A]**.
- **Shift log:** each shift is `{appliedOn, days, taskIds}`.
  - A shift is **undoable** only while it is the most recent row and was created after `reloaded_at`, if there has been a reload.
  - Undo deletes the row. The previous shift then becomes undoable under the same rule **[A]**.
- **Versions:** every write to an Enrollment bumps its `state_version`. Every write anywhere bumps `settings.appStateVersion`.
- **Timestamps** are UTC ISO-8601. **Dates** are plain local `YYYY-MM-DD` strings.

---

## 5. Derived signals (`core`, pure)

_Sources: [007](../.wayfinder/issues/007-enrollment-data-model.md) (amended by [008](../.wayfinder/issues/008-today-view-prototype.md)), [010](../.wayfinder/issues/010-path-screen-prototype.md), [014](../.wayfinder/issues/014-api-and-frontend-state.md)._

Every derived signal is a function of `(snapshot, today)` and nothing else. No function reads a clock. The client computes all of them live. The server calls the same functions only for the Notes Export header and the restore preview.

**Date arithmetic:** convert `YYYY-MM-DD` to an integer day count through `Date.UTC`, and never use local `Date` objects. This keeps day differences free of daylight-saving errors. "Today" is the browser's local date, formatted from `getFullYear/getMonth/getDate`.

The definitions below apply to **live Tasks**, meaning Tasks in the current path copy. Tombstoned Tasks are excluded from every signal except the Note-edit part of the streak.

| Signal | Definition |
|---|---|
| day number `t` | `daysBetween(startDate, today) + 1`. `t ≤ 0` means before the start. |
| effective day / due day | `day + offsetDays`, `(dueDay ?? day) + offsetDays`. Its date is `startDate + (effDay − 1)`. |
| **open** | `todo` and `effDay ≤ t ≤ effDue` |
| **overdue** | required, `todo`, `t > effDue` |
| **done late** | `done` and `statusDate > date(effDue)` |
| run length `M` | the largest `effDue` over live Tasks. Run weeks = `ceil(M / 7)` **[A]** |
| path week of a day | `ceil(d / 7)`. Week W covers dates `startDate + 7(W−1)` … `+ 7W − 1`. |
| rhythm label of a day | `weekRhythm[(d − 1) mod 7]`, by day number (not shifted) |
| **percent** | done required ÷ required. Skipped counts as not done. Shown as "—" when there are no required Tasks. |
| **bonus** | the count of done optional Tasks |
| checkpoints passed | done checkpoints ÷ all checkpoints |
| Block complete | every required Task in the Block is done |
| Block state tag | `complete`; otherwise `behind` if it has an overdue Task or `t` is past its effective range; otherwise `current` if `t` is inside the range; otherwise `upcoming` **[A]** |
| Blocks complete | the count of complete Blocks |
| **streak** | see below |
| longest streak | the longest run under the same rules, from the first activity date to today |
| finished | `t > M`. Shown only, never stored. |

**Streak.** *Activity* on date D means a live Task has `status = done` with `statusDate = D`, or any Note (any target, including Notes on removed Tasks) has `D` in its trail. A date is *scheduled* when at least one live Task has its effective day on it.

To compute the streak, walk back from today:
- Today counts if it has activity, and never breaks the streak.
- On each earlier date: activity adds 1; a date with no activity and nothing scheduled is skipped; a date with no activity but something scheduled ends the walk.
- Stop before the earliest activity date.
- Skipped Tasks never count.

**Ordering:** within a day, Tasks go by `(effective day, Block index, array index)`. Catch up lists the oldest effective due day first.

---

## 6. Reload

_Sources: [006](../.wayfinder/issues/006-reload-reconciliation.md), [014](../.wayfinder/issues/014-api-and-frontend-state.md)._

`core.diffReload(enrollmentSnapshot, newPath) → ReloadDiff` is a pure function, used for both the preview and the apply.

- **Refused** (nothing written): the new file fails validation (422, with issues), or its path `id` differs from the stored copy's (409 `path-id-mismatch`). An unchanged hash returns `{unchanged: true}` ("No changes") and writes nothing.
- **Matching:** Tasks are matched by id.
  - **Carried over:** `status`, `statusDate`, `offsetDays` and the Task's Note.
  - **From the new file:** everything else (title, description, kind, `optional`, links, `noteTemplate`, `day`/`dueDay`, Block).
  - A Note that already exists is never changed by an edited `noteTemplate`.
- **Diff categories:**

| Category | Contents |
|---|---|
| Added | new ids, with the count already overdue once added |
| Removed | ids gone from the file; those with a state record or Note are flagged "will be kept hidden" |
| Restored | ids coming back from a tombstone |
| Moved | `day`/`dueDay` old → new |
| Changed | any other field differs |
| Path-level | changes to title, `version`, description, `weekRhythm`, `startWeekday`, resources, and the number, titles or goals of Blocks |

- **Apply** (one transaction):
  - Store the new path JSON and hash, and set `reloaded_at = now`.
  - Write a tombstone `{taskId, title, kind, formerDay}` for each removed Task that has a state record or a Note.
  - Delete the tombstones of restored ids; their saved state takes effect again.
  - Give each **added** Task a record with `offsetDays` = the sum of `days` over all logged shifts, if that sum is > 0.
  - Shift undo is cancelled for every earlier shift, since undo eligibility is derived from `reloaded_at`.
  - Bump the versions and return the snapshot.
- **The app never reschedules.** A new Task already past its due day is simply overdue, if it's required.
- **Preview → apply guard:** see §8.4.

---

## 7. Screens

_Sources: [008](../.wayfinder/issues/008-today-view-prototype.md), [010](../.wayfinder/issues/010-path-screen-prototype.md), [011](../.wayfinder/issues/011-notes-screen-prototype.md), [013](../.wayfinder/issues/013-docker-compose-specifics.md), [014](../.wayfinder/issues/014-api-and-frontend-state.md)._

The prototypes are the visual reference. They are rewritten, not promoted: [Today](../prototypes/today-view/today-view.html), [Path](../prototypes/path-screen/path-prototype.html) (variant A), [Notes](../prototypes/notes-screen/notes-prototype.html) (variant C).

### 7.1 Shell and visual direction

- **Fonts:** Instrument Serif for display, Inter Tight for body text, JetBrains Mono for labels.
- **Light theme:** `#F7F6F3` / `#FFFFFF` / `#111111`, accent `#E4572E`.
- **Dark theme:** `#0C0C0B` / `#141413` / `#EDEBE6`, accent `#FF6A3D`.
- **Components:** pill buttons, cards with a 12–14 px radius and a hover lift.
- **Header:** Today / Path / Notes nav, a light/dark toggle, and the **app menu**. The menu holds the Enrollment switcher, Backup, Restore and the "last backup: N days ago" hint (or "never").
- **Changed-file banner** (§8.5): "The path file has changed — review reload". It opens the reload preview.
- **Routes** (React Router), with view state in the URL:
  - `/today`, `/today?day=YYYY-MM-DD` (a selected calendar date)
  - `/path?block=<n>&filter=all|open|overdue|optional|done`
  - `/notes?block=<n|removed>&q=<text>&scope=notes|titles&note=<target>`, where `note` opens the drawer
- **On load:** the app opens Today for the active Enrollment. When the active setting is `null`, it shows the switcher, or the first-run empty state if no Enrollments exist.

### 7.2 First run and the Enrollment switcher

The empty state offers three actions:
- **Load a path:** files from `/paths`, each with title, Task count and validation status. An invalid file shows its issues and can't be picked.
- **Upload a file.**
- **Restore from backup.**

Picking a path asks for the start date: it defaults to the next Monday, with "today" one click away. On confirm, the Enrollment is created, made active, and the learner lands on Today.

The switcher lists each Enrollment's title, start date and Task count, and the active one's percent and streak. It also offers "New enrollment" and Delete (confirmed). Deleting the active Enrollment leaves none active.

### 7.3 Today

- **Hero:**
  - The eyebrow `day N · week W of <weeks> · <date> · <rhythm label>`.
  - The Block's title and goal.
  - Three stats: required %, bonus and streak.
  - A thin progress bar per Block.
- **7-day strip** for the current path week. Each day shows its rhythm label and one dot per Task (done / overdue / open / skipped). **Clicking a day** sets `?day=`: the middle column shows that day's Tasks ("past"/"ahead", tickable) and the side pane shows that day's Day Note.
- **Columns:**

| Column | Contents |
|---|---|
| **Catch up** | overdue Tasks, oldest first, with the shift control (+N days) and undo |
| **Today** | Tasks whose effective day is today; subtitle = the rhythm label |
| **In progress** | open Tasks that started on an earlier day (multi-day exercises) |

- **Cards:**
  - A round done-check.
  - The kind (and `optional`) as a mono label, then the title (a click selects the Task).
  - Status text such as "2d overdue", "day 2 of 4 · due fri" or "done today".
  - An inline more/less (description and links) and skip/unskip.
  - Overdue shows as an accent dot and accent text.
- **Side pane:** the selected Task's details with Done/Skip, its Task Note, the Day Note and the Block goal. Both Notes use the shared editor with the **Write/Preview toggle**.
- **Narrow screens** stack Catch up → Today → In progress → the side pane.
- **Before the start:** the hero says "Almost ready" with a countdown, and a tickable day-1 preview appears. **After the end:** "You finished it", a summary (percent, bonus, longest streak) and a "Still open" column of leftover overdue Tasks. Neither state shows the strip.
- Early ticks and back-dated ticks are allowed. Done has a "did it on…" date control that sets `statusDate`.

### 7.4 Path

- **Hero:** `day N of M · week W of <weeks> · date`, "The path." and the path title. Four stats: required %, checkpoints passed, Blocks complete and streak.
- **Main column:** one collapsible section per Block in file order. The current Block is open, with expand all / collapse controls.
  - **Block header:** `01`, the title, a progress bar, `done/required`, `checkpoints a/b`, `+N bonus`, `N overdue`, the effective date range and the state tag.
  - **Inside:** the goal, then weeks ("Week 4 · 7 dec – 13 dec", with a "this week" tag), each with its Task rows. Filter chips: all / open / overdue / optional / done.
- **Task rows:**
  - A done-check, the title, the kind and status text, and the effective date on the right (`wed 9 dec · d24`).
  - Clicking the title expands the description, links, the authored day and offset, and "open day N in Today →", which goes to `/today?day=<date>`.
  - Tasks stay under their own Block even when shifted.
- **Shift markers:** a dashed marker in the week a shift was applied ("shifted +2d on mon 7 dec · 107 open tasks moved"). Each week holding moved Tasks says "moved +2d by a shift" **once**, in its heading.
- **Optional Tasks past their due day** render muted with "optional · past · still tickable".
- **"Removed from the path"** section at the bottom: kind, former day, status, a Note excerpt, and "open note →" to Notes.
- **Resource Index** in a sticky side column:
  - **De-duplication key:** a URL without scheme or trailing slash, lowercased. A URL-less book uses its title with any `(…)` removed, punctuation stripped and lowercased.
  - The core resource's title and note win; the other spellings show as "also listed as …".
  - **Each entry:** the title (a ↗ link or a `book` tag), a `core` tag, the note, and one chip per Task that uses it (`d24`, ✓ when done). Clicking a chip opens that Task in the Outline. A core resource used by no Task reads "not linked from a task · whole-path reference".
  - **Order toggle:** first use (default; ties go to core order, then title), by Block (whole-path references first), A–Z.
  - **Search** covers titles, other spellings, notes, URLs and the titles of the Tasks that use the resource. Filter chips: all / core / books / still to use.
  - **Fixture check:** 5 core + 50 links → **49 entries**, with 4 core resources also used by Tasks.

### 7.5 Notes

- **Header:** an eyebrow, "Notes, by block." and three stats: notes, days with an edit, words.
- **Enrollment Note:** an "about this run" card, rendered in two columns, with Edit.
- **Search** with a scope toggle, note text / **+ Task titles** (the default). Then one **chip per Block** (`01 How LLMs work and run 10`), defaulting to the current Block. The count is the number of Notes, or the number of matches while searching. The last chip is "Removed tasks N".
- **Selected Block:** its number, title and goal, and "N task notes · reflections a/b written so far". Then, in path order: every Task that has a Note, every reflection, every Task with a template, and every exercise already reached.
  - **Written Notes** render clipped to about 6 lines, with more/less, the "edited on" trail and Edit.
  - **A reached reflection with no Note:** a dashed "not written yet" box with Write.
  - **A template Task:** "template ready" with Write.
  - **A future reflection:** "opens <date>".
  - **A reached exercise with no Note:** a small "+ note" link. Future exercises are hidden.
- **Day Notes:** a side timeline over the Block's date range, listing dates that have a Note, plus today (with "+ write").
- **Drawer editor** for every Note type, including Notes on removed Tasks:
  - A context line (kind, day, status, "from template"), the title, and the Task's description as the prompt.
  - A Write/Preview toggle, autosave, and the edit-date trail.
  - Esc or the backdrop closes it. Delete Note sits behind a confirmation.
- **Export** button in the header (§9).

### 7.6 Note rendering

One `<NoteView>` component built on `react-markdown` + `remark-gfm` handles tables, task lists and autolinks. Raw HTML is shown as text, not rendered. Links open in a new tab. The server never renders Markdown.

---

## 8. HTTP API

_Sources: [013](../.wayfinder/issues/013-docker-compose-specifics.md), [014](../.wayfinder/issues/014-api-and-frontend-state.md)._

Everything sits under `/api` and speaks JSON. Every non-`/api` path serves `index.html`. Request and response schemas are **TypeBox** schemas in `core`, which Fastify uses for validation and serialization and the client uses for its types.

### 8.1 Dates

The server **never** decides what day it is. Every request that records a date carries it explicitly: `statusDate`, `editedOn`, `appliedOn`, and `today` on exports and previews. Dates are checked against `^\d{4}-\d{2}-\d{2}$` and for being a real calendar date, and nothing more, because back-dating and early ticks are allowed.

### 8.2 Errors

```json
{ "error": { "code": "path-invalid", "message": "The file has 3 problems.", "issues": [ { "pointer": "/blocks/0/tasks/3/dueDay", "line": 57, "column": 18, "rule": "due-before-day", "message": "dueDay (3) is before day (4)" } ] } }
```

| Status | When | Example codes |
|---|---|---|
| 400 | malformed request (TypeBox) | `bad-request` |
| 404 | unknown Enrollment, Task, Note target or `/paths` file | `not-found` |
| 409 | conflict | `preview-stale`, `path-id-mismatch`, `nothing-to-undo`, `task-removed` |
| 413 | upload over 5 MB | `too-large` |
| 422 | the path or Backup parses but is invalid | `path-invalid`, `backup-invalid`, `backup-too-new` |

### 8.3 Routes

| Route | Body / query | Returns |
|---|---|---|
| `GET /api/health` | | `{ok: true, dbVersion}` |
| `GET /api/app` | | `{activeEnrollmentId, lastBackupAt, appVersion, backupFormatVersion, appStateVersion}` |
| `PUT /api/app/active` | `{enrollmentId}` | app |
| `GET /api/paths` | | `[{file, size, mtime, valid, hash?, pathId?, title?, version?, taskCount?, issues?}]` |
| `GET /api/enrollments` | | `[{id, pathId, title, startDate, createdAt, taskCount}]` |
| `POST /api/enrollments` | `{source, startDate}` | snapshot (now active) |
| `GET /api/enrollments/:id` | | snapshot |
| `PATCH /api/enrollments/:id` | `{startDate}` | snapshot |
| `DELETE /api/enrollments/:id` | | 204 |
| `PUT /api/enrollments/:id/tasks/:taskId/state` | `{status, statusDate}` | `{record, stateVersion}` |
| `GET /api/enrollments/:id/notes` | | `[{target, body}]` |
| `PUT /api/enrollments/:id/notes/:target` | `{body, editedOn, fromTemplate?}` | `{meta, stateVersion}` |
| `DELETE /api/enrollments/:id/notes/:target` | | `{stateVersion}` |
| `POST /api/enrollments/:id/shifts` | `{days, appliedOn}` | snapshot |
| `DELETE /api/enrollments/:id/shifts/latest` | | snapshot |
| `POST /api/enrollments/:id/reload/preview` | `{source}` | `{unchanged} \| {diff, sourceHash, stateVersion}` |
| `POST /api/enrollments/:id/reload` | `{source, expectedSourceHash, expectedStateVersion}` | snapshot |
| `GET /api/enrollments/:id/notes-export?today=` | | `text/markdown`, `Content-Disposition: attachment; filename=…` |
| `GET /api/backup?today=` | | `application/json`, attachment |
| `POST /api/restore/preview` | `{backup, today}` | `{summary, sourceHash, stateVersion}` |
| `POST /api/restore` | `{backup, expectedSourceHash, expectedStateVersion}` | app |

**Field details:**
- **`source`** is `{file: "<name in /paths>"}` or `{filename, yaml: "<text>"}`.
- **`:target`** is `task:<id>`, `day:YYYY-MM-DD` or `enrollment`, URL-encoded. A `task:` target must name a live or tombstoned Task, and anything else gets a 404.
- **`status = todo`** clears `statusDate`. Any other status requires `statusDate`. A tombstoned Task gets **409 `task-removed`**.
- **`days`** is an integer from 1 to 365 **[A]**. A shift moves every live `todo` Task, creating records where needed. Undo subtracts `days` from the offsets of the shift's `taskIds`, whatever their status now, and never changes a status.
- **Upload routes** (`POST /api/enrollments`, both reload routes, both restore routes) accept bodies up to **5 MB**. The browser reads files with `File.text()`. There is no multipart.

**Snapshot:**

```ts
{
  id, pathId, pathHash, startDate, createdAt, loadedAt, reloadedAt, stateVersion,
  path,                                                 // the parsed path copy
  taskStates: [{ taskId, status, statusDate, offsetDays, updatedAt }],
  shifts:     [{ id, appliedOn, days, taskIds, createdAt, undoable }],
  tombstones: [{ taskId, title, kind, formerDay, removedAt }],
  noteMeta:   [{ target, fromTemplate, editedOn: string[], length, createdAt, updatedAt }]
}
```

### 8.4 Preview → apply (reload and restore)

Previews are stateless. The preview returns `sourceHash` and the current `stateVersion`; for restore, that is `appStateVersion`. `sourceHash` is the path hash for a reload and SHA-256 of the file text for a restore. Apply resends the source with both expectations, and the server recomputes everything. If either value has changed (the file was edited again, or another tab wrote something), apply returns **409 `preview-stale`**, and the client re-runs the preview.

### 8.5 `/paths` scan and the banner

- **Scan:** the server stats every `*.yaml`/`*.yml` in `/paths` and re-reads and validates only files whose `mtime` or `size` changed, caching the results in memory. It never watches the folder. A missing or empty `/paths` returns `[]`.
- **Banner:** the **client** shows the banner when a valid file has the active Enrollment's `pathId` and a different `hash`. With several such files, the banner lists them and the learner picks one. Uploaded paths never get a banner.
- **Polling:** the query refetches on window focus and every 60 s while the tab is visible.

### 8.6 `lastBackupAt`

The server sets it (UTC) once `GET /api/backup` has sent the full response. It can't know whether the browser saved the file, so the hint is approximate. A restore sets it to the restored Backup's `exportedAt`. Safety Copies don't count.

---

## 9. Exports

_Source: [012](../.wayfinder/issues/012-export-backup-format.md)._

### 9.1 Notes → Markdown

This exports one file for the active Enrollment, named `<path-id>_<start-date>_notes_<today>.md`.

```
# <Path title> — notes
<start date · exported on <today> · <percent> · streak <n>>

## About this run                       ← Enrollment Note (if written)
## Block 1 · <Block title>
### Week 1 · 2026-09-07 – 2026-09-13
_shifted +2d on 2026-12-07_             ← once, in the week the shift was applied
#### Mon 2026-09-07 · day 1
<Day Note>
##### <Task title>
_exercise · due day 23 · done 2026-12-02 · from template_
<Task Note>
## Removed tasks
##### <title>
_<kind> · former day <n> · removed from the path on <reloadedAt date>_
```

- Task Notes appear on their Task's **effective** day, in path order after that day's Day Note. A Day Note belongs to the Block whose effective range contains its date. A Day Note outside every range goes under the nearest earlier Block **[A]**.
- Only written Notes are exported; weeks and days without one are left out.
- **Heading demotion** inside Note bodies: in Task Notes, a `#` heading becomes `######`, and `##` or deeper becomes `**bold**`. In Day Notes the base level is `#####`, and in the Enrollment Note `###`. Fenced code blocks are left untouched. The body is otherwise copied as-is.

### 9.2 JSON Backup

```json
{
  "format": "learning-tracker-backup", "formatVersion": 1,
  "exportedAt": "<UTC ISO>", "appVersion": "<semver>",
  "activeEnrollmentId": "<id|null>",
  "enrollments": [{
    "id", "createdAt", "startDate", "loadedAt", "reloadedAt",
    "path": { … }, "pathHash",
    "taskStates": [{ "taskId", "status", "statusDate", "offsetDays", "updatedAt" }],
    "shifts":     [{ "appliedOn", "days", "taskIds", "createdAt" }],
    "notes":      [{ "target", "body", "fromTemplate", "createdAt", "updatedAt", "editedOn": [] }],
    "tombstones": [{ "taskId", "title", "kind", "formerDay", "removedAt" }]
  }]
}
```

- **Output:** pretty-printed, named `learning-tracker-backup_<today>.json`. `formatVersion` is separate from the database's `user_version`; it changes only when this JSON shape does.
- **Validation before writing anything:**
  - the format and version: newer → 422 `backup-too-new`; older → migrated forward step by step;
  - the structure;
  - every path copy against the **current** path validator;
  - every reference: Task state, `task:` Note targets and shift `taskIds` must name a Task in that Enrollment's copy or one of its tombstones;
  - `activeEnrollmentId` must name an Enrollment or be `null`.
  - Any failure refuses the whole restore with the list of issues.
- **Preview:** shows the Backup's `exportedAt` and, for each Enrollment, path title, start date, percent and Note count. Beside it is the same for the current data, computed with `today`.
- **Restore:**
  1. Write the current data as a Backup to `/data/pre-restore-<timestamp>.json`, keeping the newest 3 **[A]**.
  2. In **one transaction**, replace everything, set `lastBackupAt` to the Backup's `exportedAt`, and bump `appStateVersion`.
  3. The client clears its entire cache.
- **No merging** with existing data. A Backup's path copy is always the one restored; files in `./paths` are never included, and a differing file simply raises the banner afterwards.

---

## 10. Frontend state

_Source: [014](../.wayfinder/issues/014-api-and-frontend-state.md)._

- **TanStack Query** holds all server state: `['app']`, `['paths']`, `['enrollments']`, `['enrollment', id]` (the snapshot) and `['notes', id]` (the bodies). There is no other global store. UI state lives in the URL or in components.
- **Single-Task status changes are optimistic:** patch the snapshot, roll back on error with a "Couldn't save, try again" toast. **Create, start-date change, shift, undo, reload and restore are server-confirmed,** with a spinner, and replace the snapshot.
- **Cache after writes:**
  - Small writes patch the snapshot and note caches from the response with `setQueryData`, including `stateVersion`.
  - Bulk writes replace the snapshot.
  - Switching Enrollments invalidates `['app']`.
  - A restore clears the cache and refetches `['app']`.
- **Note autosave:**
  - The editor sends the whole body with `PUT`, debounced ~800 ms. It flushes immediately on drawer close, Esc, blur and `visibilitychange`/`pagehide` (`fetch` with `keepalive`).
  - A "saving… / saved" indicator shows.
  - Last write wins, with no version check.
  - A template Task's editor starts from `noteTemplate` and doesn't save until the first keystroke, which sends `fromTemplate: true`.

---

## 11. Packaging and running

_Sources: [003](../.wayfinder/issues/003-sqlite-in-node-docker.md), [013](../.wayfinder/issues/013-docker-compose-specifics.md)._

**Repo layout** (npm workspaces):

```
core/      pure TS: schema + generation script, loader/validator, derivations, reload diff, export layout, TypeBox API contracts
server/    Fastify app, migrations, routes, /paths scan, backup/restore
web/       React + Vite
paths/     eval-infra-17-weeks.yaml + README (points at the schema)
Dockerfile, compose.yaml, .dockerignore, .env.example, README.md
```

**Dockerfile:** two stages on `node:26-bookworm-slim`.
- **Build stage:** `npm ci`, then the `core`, `web` (Vite) and `server` builds.
- **Runtime stage:** production dependencies, the server output and `web/dist`, with Fastify serving `web/dist` from the same origin. It runs `RUN mkdir /data && chown node:node /data` and `USER node`. The container listens on 3000.

**compose.yaml:**

```yaml
services:
  app:
    build: .
    init: true
    restart: unless-stopped
    ports: ["127.0.0.1:${PORT:-4321}:3000"]
    volumes: ["./paths:/paths:ro", "appdata:/data"]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
volumes: { appdata: {} }
```

- **No `TZ` variable.** Logs go to stdout only.
- On startup the server prints `Learning tracker ready at http://localhost:<PORT>`. No browser opens.
- **Upgrade:** `git pull && docker compose up --build`.

**README** covers:
- running and changing `PORT`;
- LAN access (edit the one ports line; there is no login);
- authoring paths (with a link to the schema);
- that `docker compose down -v` or deleting the volume **wipes all data**, so download Backups;
- that "last backup" is approximate;
- where Safety Copies live.

---

## 12. Testing

- **`core`:** unit tests with Vitest. The 17-week fixture validates (123 Tasks), and broken copies produce each rule's issue with the right line. The derivations are checked at fixed `today`s: before the start, week 4, week 4 after +2 with 2 tombstones, week 12, week 16, and after the end. Also tested: the reload diff, the export layout, the Resource Index count (49), and the generation schema with its drift check.
- **`server`:** route tests through `fastify.inject` on a temporary database, covering errors, 409 guards, transactions (a failed restore leaves data unchanged), migrations and Safety Copies.
- **End to end:** see the [final build ticket](build-tickets/16-readme-and-e2e-acceptance.md). A Playwright script runs the fixture through every screen against the composed container.

---

## 13. Decisions made while assembling

No ticket settled these, so I chose them while writing this spec. Each is easy to change before the build starts.

1. **The table layout** in §4.1, including `note_edits` as its own table and shift undo eligibility derived from `created_at > reloaded_at`, not stored.
2. **Undo is a stack.** Undoing the latest shift deletes it, and the shift before it then becomes undoable (unless a reload came after it). 007 only says "only the most recent can be undone".
3. **Deleting a Note also deletes its edit trail,** so the streak may drop.
4. **Run length and "week W of <weeks>"** use the largest **effective** due day. After a +2 shift the 17-week run reads "of 18" once its last Task spills over.
5. **Block state tag:** a past Block that isn't complete is `behind` even when nothing is overdue, for example when it has skipped required Tasks. This matches percent, where skipped counts as not done.
6. **A shift's `days` is limited to 1–365.**
7. **The newest 3 pre-restore Safety Copies are kept,** matching the pre-migrate rule.
8. **Export:** heading demotion for Day Notes and the Enrollment Note (bases `#####` and `###`), fenced code left alone, and a Day Note outside every Block range going to the nearest earlier Block.
9. **The generation schema keeps every optional field nullable,** following 004 (13 nullable fields, under Claude's 16). The research's alternative, using natural empty values (`[]`, `""`, `false`) to reduce unions, wasn't taken.
