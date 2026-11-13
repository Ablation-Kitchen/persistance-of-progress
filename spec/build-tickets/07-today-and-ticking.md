---
title: "Today screen and Task ticking"
status: closed
blocked_by: [4, 6]
---

**Spec:** §7.3, §8.3 (Task state route), §10 (optimistic updates). **Visual reference:** [Today prototype](../../prototypes/today-view/today-view.html).

## Scope

- **Server:** `PUT /api/enrollments/:id/tasks/:taskId/state`, which returns 409 `task-removed` for a tombstoned id and 404 for an unknown id. A `todo` status clears `statusDate`.
- **Web:** the Today screen.
  - The hero (eyebrow, Block, three stats, per-Block bars).
  - The 7-day strip with `?day=` selection.
  - The Catch up / Today / In progress columns.
  - Cards with more/less and skip/unskip.
  - The side pane (Task details, Done/Skip, a "did it on…" date). Note editors are placeholders until 08, and the shift control is a placeholder until 09.
  - Before-the-start and after-the-end states. The narrow-screen stacking.
- Optimistic status mutations with rollback and a toast.

## Acceptance

- [x] At the fixture's week 4 (fixed `today` through a dev override such as `?today=` in dev builds only), the columns match `core`'s output, and ticking a card moves it, updates the stats and the strip dot without a reload, and survives a page refresh.
- [x] With the server stopped, a tick rolls back and shows the toast.
- [x] `/today?day=<a past date>` shows that day's Tasks labelled "past" and tickable.
- [x] Back-dating Done to yesterday sets `statusDate` = yesterday, and the streak reflects it.
- [x] Before the start: "Almost ready" with a countdown and a tickable day 1. After the end: "You finished it", the summary and "Still open".
- [x] At 375 px wide the layout stacks Catch up → Today → In progress → side pane.
