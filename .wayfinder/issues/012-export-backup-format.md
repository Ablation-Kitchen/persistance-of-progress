---
title: "What do the Markdown export and the JSON backup look like?"
labels: [wayfinder:grilling]
status: closed
assignee: sombra
parent: 1
blocked_by: []
---

## Question

Define the two exports:
1. **Notes → Markdown:** one file or several? The "by week" layout: headings, how Day Notes, Task Notes and the Enrollment Note are placed, whether Task titles and status appear, how a Note on a tombstoned Task is handled, and the file name.
2. **Full JSON backup/restore:** what it contains (every Enrollment, or one?), the format version and how later versions migrate, and restore semantics: replace everything, merge, or restore as a new Enrollment. What happens on restore when the backup's path copy differs from a file in `./paths`?

_Context: the stored data is defined in [007](007-enrollment-data-model.md) and [006](006-reload-reconciliation.md) (path copy plus hash, Task state with offsets, shift log, Notes with edit dates, tombstones, the active-Enrollment setting)._

## Resolution

Grilled 2026-11-12. The glossary now has **Notes Export** and **Backup**.

**Notes → Markdown export**

- **One file** for the active Enrollment, started from the Export button on the Notes screen ([011](011-notes-screen-prototype.md)). Named `<path-id>_<start-date>_notes_<export-date>.md`, e.g. `eval-infra-17-weeks_2026-09-07_notes_2026-11-12.md`. The start date tells apart several Enrollments of the same path; the export date stops a new export from overwriting an older one.
- **Outline: Block → week → day.** This keeps the "by week" plan inside the screen's Block grouping:
  ```
  # <Path title> — notes
  <start date · exported on · percent · streak>
  ## About this run            ← Enrollment Note
  ## Block 1 · <Block title>
  ### Week 1 · 2026-09-07 – 2026-09-13
  #### Mon 2026-09-07 · day 1
  <Day Note, then the Task Notes for that day in path order>
  ## Removed tasks
  ```
  Task Notes go on their Task's **effective** day and Day Notes on their date, so the file reads like a journal. Weeks and days with no Notes are left out. A shift is shown once, under the week heading where it happened, as on the Path screen ([010](010-path-screen-prototype.md)).
- **Task Notes:** each starts with `##### <Task title>` and a metadata line, e.g. `_exercise · due day 23 · done 2026-12-02 · from template_`. Only Tasks that have a Note appear; the screen's "not written yet" gaps are not exported.
- **Note bodies** are copied as-is (the story bank's table included), except that headings inside a Note are **pushed down** to sit below the Note's own heading. A `#` inside a Task Note becomes `######`, and anything deeper becomes bold text, so the file's outline stays intact.
- **Removed Tasks:** a final `## Removed tasks` section holds Notes on tombstoned Tasks ([006](006-reload-reconciliation.md)), each with its title, kind, former day and "removed from the path on <reloadedAt>". Removed Tasks with a status but no Note are left out.

**Full JSON backup / restore**

- **Scope: the whole app.** One backup holds every Enrollment plus the active-Enrollment setting: path copies and hashes, Task state, the shift log, Notes with their edit-date trails, and tombstones ([007](007-enrollment-data-model.md)). It is for disaster recovery and moving to another machine. Exporting a single Enrollment ("share a run") is a possible later feature.
- **Envelope:** `{ "format": "learning-tracker-backup", "formatVersion": 1, "exportedAt", "appVersion", ... }`. The JSON is pretty-printed, and the file is named `learning-tracker-backup_<export-date>.json`.
- **Versions:** an older `formatVersion` is migrated forward step by step in code (v1→v2→…) before it is restored. A newer one is refused ("made by a newer app"). The backup version is separate from the SQLite `user_version` ([003](003-sqlite-in-node-docker.md)): the backup format is a public contract, the database schema is internal, and it is bumped only when the JSON shape changes.
- **Restore replaces everything.** A preview shows the backup's `exportedAt` and each Enrollment in it (path title, start date, percent, Note count) next to what is there now; the learner confirms or cancels. There is no merging and no "restore as a new Enrollment".
- **Safety:** before replacing anything, the server writes the current database as a backup to `/data/pre-restore-<timestamp>.json`. The restore runs in **one transaction**, so a failure leaves the old data untouched.
- **Validation:** the whole file is checked before anything is written: format and version, structure, every path copy against the **current** path validator, and every reference (Task state, Notes and shift `taskIds` must point to a Task in that Enrollment's copy or to one of its tombstones). Any failure refuses the whole restore with a list of errors, the same rule as reload.
- **Path copy vs `./paths`: no special case.** The backup's path copy is always the one restored, and files from `./paths` are never included in a backup. If a file in `./paths` has the same path `id` but a different hash, the normal "path file has changed — review reload" banner from 006 appears afterwards.
- **Where:** Backup and Restore sit in the app menu next to the Enrollment switcher, since they cover the whole app. "Restore from backup" is also offered on the first-run empty state, next to "Load a path".
