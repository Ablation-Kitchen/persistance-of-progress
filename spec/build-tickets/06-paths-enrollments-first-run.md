---
title: "/paths scan, Enrollments API and first run"
status: closed
blocked_by: [2, 5]
---

**Spec:** §8.1–§8.3 (the routes listed below), §8.5 (the scan only; the banner is in 13), §7.1–§7.2, §10.

## Scope

- **Server routes:**
  - `GET /api/paths`, with an mtime/size cache and `[]` when `/paths` is missing;
  - `GET/PUT /api/app` and `/api/app/active`;
  - `GET/POST /api/enrollments`;
  - `GET/PATCH/DELETE /api/enrollments/:id`.
- The error envelope and codes (§8.2), shared by all routes from here on.
- A 5 MB body limit on the upload routes. Date-format validation.
- **Snapshot assembly** (§8.3). Note metadata is empty until 08.
- **Web:**
  - TanStack Query setup with the keys from §10;
  - the `['paths']` query (focus refetch, 60 s visible-only polling);
  - the empty state (Load a path / Upload / Restore stub);
  - the start-date dialog (next Monday by default, "today" one click away, the path's `startWeekday` as a hint);
  - the issue list for invalid files;
  - the Enrollment switcher in the app menu with Delete (confirmed);
  - landing logic (active → Today, `null` → switcher or empty state).

## Acceptance

- [x] **First run with the fixture:** empty state → the fixture listed with its title, "123 tasks" and valid → start date → Today placeholder for the new active Enrollment.
- [x] Dropping an invalid `.yaml` into `./paths` makes it appear within 60 s (or at once on focus), marked invalid with its issues, and it can't be picked.
- [x] Uploading the fixture gives an Enrollment with the same `pathHash` as the `/paths` copy.
- [x] `PATCH startDate` keeps statuses and offsets.
- [x] Deleting the active Enrollment sets the active setting to `null` and shows the switcher. Deleting the last Enrollment shows the empty state.
- [x] Upload a 6 MB file → 413 `too-large`. `startDate: "2026-02-30"` → 400.
