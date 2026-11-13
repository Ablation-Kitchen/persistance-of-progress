---
title: "Reload: diff, preview/apply and banner"
status: closed
blocked_by: [6, 9]
---

**Spec:** §6, §8.4, §8.5 (banner).

## Scope

- `core`: `diffReload(snapshot, newPath)` returns the diff categories in §6, plus the plan of record changes (new tombstones, restored ids, added-Task offsets).
- **Server:**
  - `POST …/reload/preview` (validate → 422; different id → 409; unchanged → `{unchanged: true}`) and `POST …/reload`, which recomputes, checks `expectedSourceHash` and `expectedStateVersion` (409 `preview-stale`), and applies in one transaction;
  - the source is `{file}` or an upload.
- **Web:**
  - the changed-file banner (decided client-side from `['paths']` and the snapshot, with a picker when several files match);
  - "Reload from file / upload" in the app menu;
  - the preview dialog with every category and the Added-and-overdue count;
  - confirm or cancel;
  - stale-preview handling (re-run automatically and say so).

## Acceptance

- [x] Edit the fixture in `./paths`: add 2 Tasks on past days, remove one done Task that has a Note and one untouched Task, move one Task, and retitle one. The banner appears within 60 s. The preview lists exactly those changes, with "1 removed task will be kept hidden" and "2 added, 2 already overdue".
- [x] After the apply: the done Task's Note is under Removed tasks, the untouched removed Task is gone, and the added Tasks carry the total shift offset. Undo of the pre-reload shift → 409 `nothing-to-undo`.
- [x] Putting the removed Task back and reloading restores its status, date, offset and Note.
- [x] A comment-only edit raises no banner (the hash is unchanged).
- [x] A different `id` → 409 `path-id-mismatch`. An invalid file → 422 with line numbers.
- [x] Ticking a Task in another tab between preview and apply → 409 `preview-stale`, and the UI re-previews.
