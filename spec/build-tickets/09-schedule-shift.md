---
title: "Schedule Shift and undo"
status: closed
blocked_by: [7]
---

**Spec:** §4.2 (shift log, undo), §8.3 (shift routes), §7.3 (Catch up control), §7.4 (shift markers, which ticket 10 renders).

## Scope

- **Server:**
  - `POST /api/enrollments/:id/shifts {days, appliedOn}` moves every live `todo` Task (creating records as needed) and logs `taskIds`;
  - `DELETE …/shifts/latest` undoes the latest undoable shift (409 `nothing-to-undo` otherwise) by subtracting from the logged `taskIds`' offsets, whatever their status now;
  - both are transactional, bump the versions and return the snapshot.
- **Web:** the shift control in Catch up (+N days, confirm with "N open tasks will move"), and undo with the shift's details. Both are server-confirmed with a spinner.

## Acceptance

- [x] At week 4 with overdue Tasks, a +2 shift clears Catch up for Tasks now inside their windows, moves optional and future `todo` Tasks too, and leaves done and skipped Tasks where they are.
- [x] Ticking a moved Task and then undoing: the Task keeps `done`, and its offset goes back.
- [x] Two shifts then two undos return every offset to its original value. A third undo → 409.
- [x] `days: 0` and `days: 366` → 400.
