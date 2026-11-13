---
title: "Notes API, editor and autosave"
status: closed
blocked_by: [7]
---

**Spec:** §4.2 (Notes), §7.5 (the drawer), §7.6, §8.3 (Note routes), §10 (autosave).

## Scope

- **Server:**
  - `GET /api/enrollments/:id/notes`;
  - `PUT/DELETE /api/enrollments/:id/notes/:target`, with target validation (live Task, tombstone, valid date, `enrollment`) and `note_edits` trail upserts;
  - `fromTemplate` honoured only when the Note is created;
  - Note metadata in the snapshot.
- **Web:**
  - `<NoteView>` (`react-markdown` + `remark-gfm`, HTML off, links in a new tab);
  - a `<NoteEditor>` with Write/Preview, ~800 ms debounced whole-body saves, a flush on blur, close, Esc and `pagehide`/`visibilitychange` (`keepalive`), and a "saving… / saved" indicator;
  - the template-on-first-edit behaviour;
  - the reusable drawer;
  - the Task Note and Day Note in Today's side pane.

## Acceptance

- [x] The fixture's story-bank Task: opening shows the template table, and **nothing is stored and the streak doesn't change** until the first keystroke. After that the Note is `fromTemplate` and today is in its trail. Preview renders the table.
- [x] Typing continuously sends at most one PUT per ~800 ms. Closing the tab mid-typing still saves the last text (check in the server log or the database).
- [x] Editing a Note on two dates gives a trail of two dates. Editing twice on one date gives one.
- [x] `<script>` in a Note body renders as text.
- [x] `PUT …/notes/task:no-such-id` → 404. A Note on a tombstoned Task can be saved and deleted.
- [x] A Note edited on a day with no ticks keeps the streak going (§5).
