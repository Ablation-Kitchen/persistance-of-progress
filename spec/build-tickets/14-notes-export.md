---
title: "Notes Markdown export"
status: closed
blocked_by: [8, 9]
---

**Spec:** §9.1.

## Scope

- `core`: `notesExport(snapshot, notes, today) → {filename, markdown}`, implementing the layout, the effective-day placement, the shift line, the metadata line, heading demotion (with fenced code left untouched) and the Removed tasks section.
- **Server:** `GET /api/enrollments/:id/notes-export?today=` as an attachment.
- **Web:** the Export button on the Notes screen, which passes the local date.

## Acceptance

- [x] **Golden-file test:** the seeded week-16 scenario produces the committed `notes-export.golden.md`.
- [x] The filename is `eval-infra-17-weeks_<start>_notes_<today>.md`.
- [x] A Task Note containing `# Heading` exports as `###### Heading`, and `## Sub` becomes `**Sub**`. A `#` inside a fenced block is unchanged.
- [x] Weeks and days without Notes are absent. The story-bank table survives byte for byte.
- [x] A shifted Task's Note appears under its effective day.
