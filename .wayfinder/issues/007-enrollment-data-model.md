---
title: "What does an Enrollment store, and how are progress signals derived?"
labels: [wayfinder:grilling]
status: closed
assignee: sombra
parent: 1
blocked_by: [4]
---

## Question

Define the stored data for an Enrollment (start date, path snapshot vs. reference, Task Status records with timestamps, Notes and their attachment targets, Schedule Shifts, active flag) and the exact definitions of derived signals: overdue, percent complete (do optional/skipped count?), streak (per calendar day? do off days break it?), and "today" when the Enrollment has ended or not yet started.

_Context from the schema decision: overdue means not done after the Task's **due day** (`dueDay`, defaults to `day`). Between `day` and `dueDay` a Task is open._

## Resolution

Grilled 2026-11-11. The glossary now has **Streak** and **Percent Complete**, and the **Task Status** and **Schedule Shift** entries are more precise.

**Stored**

- **Enrollment:** a **copy** of the validated path (not a link to the file), plus a hash of its contents and when it was loaded. Also the start date (can be changed later; it re-anchors every Task and keeps statuses and offsets) and when it was created. No lifecycle state (finished/archived). "Finished" is only shown, never stored. The path copy changes only on reload ([006](006-reload-reconciliation.md)). The same path may have several Enrollments. _(Refined 2026-11-12 by [014](014-api-and-frontend-state.md): the copy is the parsed path stored as JSON, not the YAML text, and the hash is SHA-256 of its canonical JSON, so comment or formatting edits don't count as a change.)_
- **Active Enrollment:** a single app setting, not a flag on each Enrollment. Deleting an Enrollment needs a confirmation.
- **Task state:** at most one record per (Enrollment, Task id): `status` (`todo`/`done`/`skipped`), `statusDate` (local `YYYY-MM-DD`, defaults to today, can be changed for "did it yesterday"), `updatedAt`, and `offsetDays` (the running shift offset, default 0). A Task with no record is `todo` with offset 0. No history.
- **Schedule Shift log:** `{appliedOn, days, taskIds}`, where `days` is a positive whole number of days. A shift adds N to the offset of **every Task still `todo`** at that moment: overdue, future and optional Tasks all move, and both `day` and `dueDay` move. Only the **most recent** shift can be undone. Undo takes N back off the offsets of the Tasks it moved, even ones finished since, and never changes a status.
- **Notes:** exactly **one Markdown Note per target**. A target is a Task id, a **calendar date** (Day Note) or the Enrollment. Day Notes are keyed by date, not by path day number, so they stay on their date when the start date changes or a shift moves Tasks. A Task's `noteTemplate` fills in its Note only when the Note is first created.
- **Dates and "today":** all dates are plain local `YYYY-MM-DD`. The browser's local date is "today" and is sent with each request. The server clock (UTC in Docker) is never used to decide what day it is.

**Derived** (with *effective day* = `day + offsetDays` and *effective due day* = `(dueDay ?? day) + offsetDays`)

- **Open:** `todo` and the effective day ≤ today's day number ≤ the effective due day.
- **Overdue:** a **required** Task that is still `todo` after its effective due day. **Optional Tasks are never overdue.** Once their due day has passed they drop off Today and can still be ticked from the Path screen.
- **Percent complete:** done required Tasks ÷ all required Tasks. Skipped Tasks count as not done. Finished optional Tasks show as a separate **bonus** count.
- **Streak** (*amended 2026-11-12 by [008](008-today-view-prototype.md)*): consecutive calendar days on which at least one Task was marked `done` (its `statusDate`) **or a Note was edited** (any target). This makes "worked on the exercise" count: add a line to its Note. Notes therefore need an edit-date trail, at least the set of local dates on which each Note was changed, not only `updatedAt`. Days with no Task scheduled (by effective day) are skipped over without breaking it. Today only breaks the streak once it has ended. Skipped Tasks don't count.
- **Done late:** `statusDate` is after the effective due day. It is worked out, never stored, and the screens decide whether to show it.
- **Today before the start date:** Today shows "starts in N days" with a preview of day 1. Ticking Tasks early is allowed (honour system), both before the start and later on.
- **Today after the last effective day:** Today shows a "path finished" summary (percent, bonus count, longest streak) above any Tasks still overdue. The Enrollment stays active until you switch.
