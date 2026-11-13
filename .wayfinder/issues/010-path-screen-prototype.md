---
title: "What should the Path screen look like?"
labels: [wayfinder:prototype]
status: closed
assignee: sombra
parent: 1
blocked_by: []
---

## Question

Using the real 17-week data, how should the Path screen show the whole run: Blocks and weeks, each Task's status and effective day, progress per Block, overdue Tasks and shifts, and the **derived resource index** (core `resources` plus Task links)? Build a rough clickable prototype to react to, in the visual direction set by [008](008-today-view-prototype.md).

Sub-questions:
- How are Blocks and weeks laid out: a timeline, a calendar grid, or a list per Block? Can you jump from a day to Today's day view?
- What does "motivating" mean beyond percent and streak (for example Block completion, checkpoints passed, a streak calendar)?
- Resource index: how core resources and Task links are de-duplicated, how URL-less books show, and how entries are ordered (by first use, by Block, alphabetically).
- Are optional Tasks whose due day has passed still tickable here (007 says yes), and how do they look?
- Where do tombstoned (removed) Tasks show, if anywhere?

_Context: Blocks have no id and their day range is derived ([004](004-define-learning-path-schema.md)). Effective day = `day + offsetDays` ([007](007-enrollment-data-model.md)). Today's week strip and card style: [`/prototypes/today-view/today-view.html`](../../prototypes/today-view/today-view.html)._

_Prototype (2026-11-12): [`/prototypes/path-screen/path-prototype.html`](../../prototypes/path-screen/path-prototype.html) (throwaway; rebuild with `sh prototypes/path-screen/build.sh`). Variants via `?variant=` or ←/→: **A Outline** (a collapsible section per Block, Tasks by week, resource index in a side column), **B Calendar** (the whole run as a weeks × weekdays grid that doubles as the streak calendar, a day pane with "Open in Today", the index below), **C Milestones** (six Block tiles with rings, then a per-Block table plus a "Can you…" checkpoint list; resources and removed Tasks on tabs). Scenarios: before start, week 4, **week 4 after a +2 shift with 2 tombstones** (default), week 12, after the end. All three show four motivation stats: required %, checkpoints passed, Blocks complete, streak._

_Found while building it:_
- _**Book de-duplication needs normalised titles.** Core `resources` and Task links name the same URL-less book differently ("Designing Data-Intensive Applications (Martin Kleppmann)" vs "… (Kleppmann)", "AI Engineering (Chip Huyen, 2025)" vs "(Chip Huyen)"). The prototype uses this key: the URL without scheme or trailing slash, or for a book the title with any `(…)` removed, lowercased. Result: 5 core + 50 links → 49 entries; 4 core resources are also used by Tasks; one core entry (Karpathy's channel) is linked from no Task. The alternative would be an author rule ("a book is named exactly as in `resources`"), which the validator could warn on._
- _**A shift pushes the rhythm off.** After +2, Saturday reviews land on the "off" Sunday for the rest of the run, and every future row shows `+2d`. In B this is one `+2` per cell; in A and C it repeats on every row, which is noisy._
- _Optional Tasks past their due day stay tickable and render muted, with "optional · past · still tickable". Tombstones are listed in A and C but only counted in B, with a pointer to Notes ([011](011-notes-screen-prototype.md))._
- _"Open in Today" is a mock (toast); the real jump needs Today to accept a selected day._

## Resolution

Decided 2026-11-12 after trying three variants on the real 17-week data.

- **Layout: variant A, Outline.** Same header and hero as Today (eyebrow `day N of M · week W of 17 · date`, "The path." and the path title). Four stats: **required %, checkpoints passed, Blocks complete, streak**. These are the extra motivation signals beyond percent and streak. Below the hero, a main column and a sticky side column.
- **Main column: one collapsible section per Block**, in file order. The current Block opens by default; "expand all" and "collapse" sit above. The Block header shows its number (`01`), title, a progress bar, `done/required`, `checkpoints a/b`, `+N bonus`, `N overdue`, the effective date range, and a state tag (complete · current · behind · upcoming). Inside: the goal, then **weeks** ("Week 4 · 7 dec – 13 dec", with a "this week" tag), then one row per Task. Filter chips above the list: all / open / overdue / optional / done.
- **Task rows:** a done-check, the title (click to expand the description, links and "open day N in Today →"), the kind and status text, and the effective date on the right (`wed 9 dec · d24`). Tasks stay under their Block from the file even when a shift moves them. Ticking works here exactly as on Today.
- **Shifts:** a dashed marker in the week where the shift was applied ("shifted +2d on mon 7 dec · 107 open tasks moved"). Each week holding moved Tasks says **"moved +2d by a shift" once in its heading**, not on every row. The authored day and the offset appear only in a Task's expanded details.
- **Optional Tasks past their due day** stay tickable and render muted, with "optional · past · still tickable". They are never overdue (007).
- **Removed (tombstoned) Tasks:** a "Removed from the path" section at the bottom, showing kind, former day, status and a Note excerpt, plus "open note →" to the Notes screen ([011](011-notes-screen-prototype.md) owns them fully).
- **Jump to Today:** "open day N in Today" needs Today to accept a selected day (a URL/route parameter). This goes to [014](014-api-and-frontend-state.md).
- **Resource index (side column),** derived and never stored:
  - **De-duplication:** key = the URL without scheme or trailing slash, lowercased; for a URL-less book, the title with any `(…)` removed and punctuation and case normalised. The core resource's title and note win; the other spellings show as "also listed as …". **No author rule, no validator warning.**
  - **Entries:** title (link ↗, or a `book` tag), a `core` tag for path resources, the note, and one chip per Task that uses it (`d24`, ✓ when done; clicking it opens that Task in the Outline). A core resource no Task links reads "not linked from a task · whole-path reference".
  - **Ordering:** a toggle between **first use** (default; ties broken by core order, then title), **by Block** (grouped under each Block, with whole-path references first) and **A–Z**. It applies to every entry; core entries are not pinned.
  - **Filtering:** a search box (matches titles, other spellings, notes, URLs and the titles of the Tasks that use the resource) and chips all / core / books / still to use (has an unfinished Task).
  - On the sample, 5 core + 50 Task links give 49 entries; 4 core resources are also used by Tasks.
- **Not chosen:** B Calendar (the weeks × weekdays grid, a streak calendar, a day pane) and C Milestones (Block tiles with rings, a per-Block table, a checkpoint list). The user judged the Outline to work best; no other reasons were recorded. Both stay in the prototype for reference.
- **Primary source:** [`/prototypes/path-screen/path-prototype.html`](../../prototypes/path-screen/path-prototype.html) (A/B/C, rebuilt with `sh prototypes/path-screen/build.sh`). It is a prototype; it gets rewritten, not promoted.
