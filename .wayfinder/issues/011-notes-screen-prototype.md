---
title: "What should the Notes screen look like?"
labels: [wayfinder:prototype]
status: closed
assignee: sombra
parent: 1
blocked_by: []
---

## Question

How should the Notes screen present the three kinds of Note (Task, Day, Enrollment) for an Enrollment? Build a rough clickable prototype on the real data, in the [008](008-today-view-prototype.md) visual direction.

Sub-questions:
- Editor: plain textarea, or Markdown with a preview toggle or a live preview? The same editor in the Today side pane?
- Organisation: by week (matching the planned Markdown export), by Block, by kind, or one chronological feed? How Day Notes and Task Notes interleave.
- Search: scope (Note text only, or Task titles too) and how results show.
- Template Notes (for example `story-bank`): how a Note filled from a template looks and where it lives.
- The "Removed Tasks" section for Notes on tombstoned Tasks ([006](006-reload-reconciliation.md)).
- The Enrollment Note: where it shows.

_Context: one Note per target. Day Notes are keyed by calendar date. A Note edit counts toward the streak, so edits keep a trail of the dates they were made on ([007](007-enrollment-data-model.md), as amended)._

_Prototype (2026-11-12): [`/prototypes/notes-screen/notes-prototype.html`](../../prototypes/notes-screen/notes-prototype.html) (throwaway; rebuild with `sh prototypes/notes-screen/build.sh`). Variants via `?variant=` or ←/→:_
- _**A Journal:** one feed by week, the shape of the planned Markdown export ([012](012-export-backup-format.md)). The Enrollment Note is pinned on top. Task Notes sit on their Task's effective day and Day Notes on their date. A week rail with Block headings is on the left. Editing is inline with a Write/Preview toggle, and there is a "+ Day Note for today" button. Removed Tasks get a section at the end._
- _**B Notebook:** a list plus an editor. The list is sorted by recent edit ("edited this week / earlier") or by path order (grouped by Block), with the Enrollment Note pinned. The editor has a context header (Task status and prompt; for a Day Note, what was planned and done that day), a live split Markdown and preview, and the edit-date trail._
- _**C By Block:** the Enrollment Note as an "about this run" card, then Block chips. Each Block lists its Task Notes in path order; unwritten reflections and the template show as dashed gaps; Day Notes sit in a side timeline. Editing happens in a drawer that shows the Task's prompt above a Write/Preview toggle. Removed Tasks get their own chip._
- _In all three: search with a scope toggle (**note text** / **+ Task titles**), highlighted matches, a template Note marked "from template", and edits recorded on a date trail that feeds the streak. Scenarios: week 4, week 12 with 2 removed Tasks that have Notes, **week 16 with the story bank half filled** (default), and after the end._

_Found while building it:_
- _**The story bank decides the editor question.** Its Note is a Markdown table; in a raw textarea it wraps into unreadable pipes, while rendered it's a clear 3-column table. Whatever editor is chosen needs a rendered view (toggle or live split), and the Today side pane (a plain textarea since 008) faces the same problem whenever a Task with a template is selected._
- _Weeks without Notes (e.g. week 2) appear in A as an empty heading saying "no notes this week"._
- _**Searching per Block (C) hides matches elsewhere.** Fixed in the prototype by showing match counts on the Block chips while searching._
- _**On a phone, B becomes a long list with the editor below it.** A real build would need a list → editor navigation step._

## Resolution

Decided 2026-11-12 after trying three variants on the real 17-week data: **variant C, By Block.**

- **Organisation: by Block, following the path.** At the top, the header with an eyebrow (`day N · week W · date`), "Notes, by block." and three stats (notes · days with an edit · words). Below it, the **Enrollment Note** as a full-width "about this run" card, rendered in two columns, with an Edit button. Then the search bar and one **chip per Block** (`01 How LLMs work and run 10`), defaulting to the current Block. The chip count is the number of Notes in the Block, or the number of matches while searching.
- **Selected Block, main column:** the Block's number, title and goal, and a line "N task notes · reflections a/b written so far". Then, in path order (effective day, then file order), every Task that has a Note, plus every reflection, every Task with a template, and every exercise already reached. A written Note shows rendered, clipped to about 6 lines, with more/less, its "edited on" trail and an Edit button. Gaps:
  - A **reflection** that has been reached but not written shows as a dashed box "not written yet" (accent border) with a Write button.
  - A Task with a **template** shows "template ready" with Write.
  - A future reflection reads "opens <date>".
  - A reached **exercise with no Note** gets only a small "+ note" link (no dashed box), and future exercises are hidden.
- **Day Notes, side column:** a timeline over the Block's date range listing the dates that have a Note, plus today (with "+ write"). Day Notes stay keyed by calendar date (007) and are assigned to the Block that contains the date.
- **Editor: a drawer** from the right, with a context line (kind, day, status, "from template"), the title, and the **Task's description as the prompt**. A Write/Preview toggle switches between a Markdown textarea and the rendered Note. It saves as you type, shows the edit-date trail, and closes with Esc or the backdrop. The same drawer edits Task, Day and Enrollment Notes and Notes on removed Tasks.
- **Templates:** the first time a Task's Note is opened, its `noteTemplate` fills it (007), and the Note is marked "from template". _(Refined 2026-11-12 by [014](014-api-and-frontend-state.md): opening only shows the template in the editor; the Note is stored, marked "from template", and counted toward the streak on the first edit.)_ The story bank's table is why Preview exists.
- **Search:** one box above the Block chips, with a scope toggle **note text / + Task titles** (default: + Task titles). It filters the selected Block's rows and Day Notes, highlights matches, and changes the Block chips to match counts so hits in other Blocks are visible.
- **Removed Tasks:** a last chip, "Removed tasks N", lists each tombstoned Task (title, kind, former day, "kept after reload") with its Note and an Open button that opens the drawer ([006](006-reload-reconciliation.md)).
- **Export:** an Export button in the header leads to the Markdown export. Its layout is still [012](012-export-backup-format.md)'s call; the screen is by Block, while the export was planned "by week".
- **Today's side pane:** 008 uses a plain textarea. Given the story bank, it should get the same Write/Preview toggle. Noted for the hand-off spec ([015](015-assemble-spec-and-build-tickets.md)), not a change to 008's layout.
- **Not chosen:** A Journal (one feed by week with inline editing) and B Notebook (list + editor with a live split preview). The user judged the By Block view best; no other reasons were recorded. Both stay in the prototype for reference.
- **Primary source:** [`/prototypes/notes-screen/notes-prototype.html`](../../prototypes/notes-screen/notes-prototype.html) (A/B/C, rebuilt with `sh prototypes/notes-screen/build.sh`). It is a prototype; it gets rewritten, not promoted.
