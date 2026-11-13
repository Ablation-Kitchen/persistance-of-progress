---
title: "How does reloading an edited path treat existing progress?"
labels: [wayfinder:grilling]
status: closed
assignee: sombra
parent: 1
blocked_by: [4]
---

## Question

When a user reloads a changed version of a path into an existing Enrollment, what happens to: Tasks removed from the file (with progress/notes attached), Tasks whose `day` moved, new Tasks on past days, changed titles, a changed Block structure, and an applied Schedule Shift? When is a reload refused vs. applied, and what does the user see?

_Context from the schema decision: Blocks have no id and are display only, so a changed Block structure carries no progress. Tasks now have `dueDay` as well as `day`, and both can move._

_Context from the schema-gaps decision: recurring Tasks are ordinary Tasks (ids `<series>-week-<n>`, never renumbered), so reload needs no special case for them. A moved weekly copy is just a Task whose `day` changed._

_Context from the Enrollment decision ([007](007-enrollment-data-model.md)): the Enrollment keeps a copy of the path (plus a hash of its contents), so reload is the only way the path changes. Task state is keyed by Task id and holds `offsetDays` from shifts. The shift log stores the ids of the Tasks each shift moved. Day Notes are keyed by date, not Task, so reload doesn't touch them._

## Resolution

Grilled 2026-11-12. This builds on the [Enrollment data model](007-enrollment-data-model.md).

- **Scope and refusal:** a reload applies to **one Enrollment at a time** and takes its file from `./paths` or an upload. Other Enrollments of the same path are untouched. A reload is **refused**, with nothing changed, when the new file fails path validation (the whole file is rejected with a list of errors) or when its path `id` differs from the stored copy's. If the hash matches the stored one, the app says "No changes" and writes nothing.
- **What carries over:** matched by Task id, only the Enrollment's own data survives: `status`, `statusDate`, `offsetDays` and the Task's Note. Everything else comes from the new file: title, description, kind, `optional`, links, `day`/`dueDay` and Block. A Task whose `day` moved lands on the new day plus its existing offset. Changing `optional` changes the percentage. An edited `noteTemplate` never touches a Note that already exists.
- **Removed Tasks:** if the Enrollment has a state record or a Note for a removed Task, both are **kept but hidden**, along with a **tombstone** `{id, title, kind}`. A tombstoned Task doesn't count towards percent, streak or overdue. Its Note stays reachable on the Notes screen under "Removed Tasks". If the id comes back in a later reload, the Task is **restored** with its saved status, `statusDate`, offset and Note. Removed Tasks with neither a record nor a Note simply disappear.
- **New Tasks:** they start with `offsetDays` equal to the total of all logged shifts, which lines them up with their neighbours. A new Task already past its effective due day is simply overdue (if it's required). The app never reschedules Tasks itself.
- **Stored after a reload:** the new path copy, the new hash, `reloadedAt` and any tombstones. No version history.
- **Shift undo:** a reload cancels undo for every shift made before it. The logged shifts are kept for display. Shifts made after the reload can be undone as usual.
- **What the learner sees:** a **preview** before anything is written. It lists Added Tasks (with the number already overdue), Removed Tasks (those with progress or Notes flagged "will be kept hidden"), Restored Tasks (back from a tombstone), Moved Tasks (old → new `day`/`dueDay`), Changed Tasks (content edited), and path-level changes (title, `version`, Blocks). The learner confirms or cancels the whole reload; there's no choosing Task by Task.
- **Noticing a changed file:** when a file in `./paths` has the same path `id` as the active Enrollment's copy but a different hash, the app shows a **banner** ("The path file has changed — review reload") that opens the preview. Nothing ever reloads automatically. Uploaded paths get no banner.
