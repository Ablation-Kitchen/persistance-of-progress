---
title: "JSON Backup and restore"
status: open
blocked_by: [8, 9, 13]
---

**Spec:** §9.2, §8.4, §8.6.

## Scope

- `core`:
  - the Backup TypeBox schema (v1);
  - `buildBackup(db state)`;
  - `validateBackup(text)` (format, version, structure, path copies through `loadPath`, references, active id), with the migration-chain hook (`migrations[v] : v → v+1`, empty for v1);
  - `backupSummary` using the derived percent.
- **Server:**
  - `GET /api/backup?today=` (an attachment that sets `lastBackupAt` once fully sent);
  - `POST /api/restore/preview`;
  - `POST /api/restore`, which checks the expectations, writes the pre-restore Safety Copy (keeping 3), replaces everything in one transaction and sets `lastBackupAt = exportedAt`.
- **Web:**
  - Backup and Restore in the app menu, plus Restore on the empty state;
  - the "last backup: N days ago / never" hint;
  - the preview dialog comparing the Backup with the current data;
  - clearing the whole cache after a restore.

## Acceptance

- [ ] **Round trip:** seed the week-4 + shift + tombstones scenario with Notes, back up, wipe the volume, restore from the empty state. Every screen shows the same data, including shift undo eligibility and Removed tasks.
- [ ] `formatVersion: 2` → 422 `backup-too-new`. A Note pointing at an unknown Task → 422 with a pointer. Nothing is written in either case.
- [ ] A forced failure halfway through the restore transaction leaves the old data intact, and `pre-restore-*.json` exists.
- [ ] The hint changes from "never" to "today" after a download, and four restores leave 3 Safety Copies.
