---
title: "Notes screen"
status: closed
blocked_by: [8]
---

**Spec:** §7.5. **Visual reference:** [Notes prototype](../../prototypes/notes-screen/notes-prototype.html) variant C.

## Scope

- The header stats (notes · days with an edit · words).
- The Enrollment Note card with Edit.
- Search with a scope toggle and highlighted matches.
- Block chips with Note counts, and match counts while searching.
- The selected Block's list in path order, with clipped Notes, more/less, the trail and the gaps (not written yet / template ready / opens <date> / "+ note" for a reached exercise).
- The Day Note timeline (dates with Notes plus today).
- The "Removed tasks" chip.
- The drawer from 08, with the Task's description as the prompt and Delete behind a confirmation.
- URL state: `block`, `q`, `scope`, `note`.

## Acceptance

- [x] At week 16 with the story bank half filled (seeded): the Block holding it shows the written table, unwritten reached reflections show as dashed "not written yet" gaps, and future reflections show "opens <date>".
- [x] Searching a word that appears only in another Block's Note shows a match count on that Block's chip.
- [x] `/notes?note=day:2026-12-09` opens the drawer on that Day Note.
- [x] The "Removed tasks" chip lists the tombstoned Tasks with Notes, and their Notes can be edited.
- [x] Day Notes are assigned to the Block whose effective range holds their date.
