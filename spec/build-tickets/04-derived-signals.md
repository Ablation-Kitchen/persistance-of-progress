---
title: "Derived signals in core"
status: closed
blocked_by: [2]
---

**Spec:** §5 (all of it), §4.2 (shift undo eligibility).

## Scope

- Plain-date utilities on UTC day counts: `parseDate`, `formatDate`, `addDays`, `daysBetween`, `weekday`, and `localToday()`, which runs in the browser only.
- The `Snapshot` TypeBox type (§8.3), defined here so the tests can build fixtures.
- Pure functions of `(snapshot, today)`:
  - per Task: effective day and due day and their dates, status, open, overdue, done late;
  - per path: day number, run length and weeks, path week, rhythm label;
  - stats: percent, bonus, checkpoints passed;
  - per Block: progress, state tag, Blocks complete;
  - streak and longest streak;
  - the Today columns (Catch up / Today / In progress) and the week-strip dots;
  - `undoableShift(snapshot)`.
- A scenario builder for tests, using the fixture: before the start, week 4, week 4 after +2 with 2 tombstones, week 12, week 16, and after the end.

## Acceptance

- [x] Optional Tasks are never overdue. A required Task with `dueDay` 4 is open on days 2–4 and overdue on day 5.
- [x] Percent ignores optional and tombstoned Tasks, and counts skipped as not done. Bonus counts done optional Tasks.
- [x] **Streak:** a day with a Note edit but no tick counts. A day with nothing scheduled and no activity is skipped. Today with no activity doesn't break it. A scheduled day with no activity ends it. A Note edit on a tombstoned Task counts.
- [x] Run length uses effective due days, so "+2" pushes the fixture's last week number when the last Task spills into week 18.
- [x] The day number is right across a DST change. Use a start date in late October and check a `today` in November with the process TZ set to `Europe/Berlin` and `America/New_York`.
- [x] Undo eligibility: the latest shift is undoable. Once a reload is newer than it, no shift is undoable.
- [x] No function reads `Date.now()` or `new Date()` without an argument (a lint rule or a grep test).
