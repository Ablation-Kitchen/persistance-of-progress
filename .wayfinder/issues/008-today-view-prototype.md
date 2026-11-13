---
title: "What should the Today view look like?"
labels: [wayfinder:prototype]
status: closed
assignee: sombra
parent: 1
blocked_by: [5, 7]
---

## Question

Using the converted 17-week plan as real data, how should Today present today's Tasks, overdue Tasks, in-progress exercises, the day's Block/goal context, quick notes, and motivation signals (progress, streak)? Build a rough clickable prototype to react to.

_Context from the conversion: [`/samples/eval-infra-17-weeks.yaml`](../../samples/eval-infra-17-weeks.yaml) is the real data (123 Tasks). On many days a Study label sits over build work (weeks 12–13). Several days have 3–8 Tasks (Saturdays carry checkpoints + review). Order a day's Tasks by `(day, array index)`._

_Context from the Enrollment decision ([007](007-enrollment-data-model.md)): Today needs states for before the start (countdown + day 1 preview, early ticking allowed) and after the end (finished summary above leftover overdue Tasks). Optional Tasks are never overdue and drop off Today after their due day. The motivation signals are percent (required only), bonus count and streak. Day Notes are keyed by calendar date. Shift has an undo for the most recent shift._

_Prototype: [`/prototypes/today-view/today-prototype.html`](../../prototypes/today-view/today-prototype.html) (throwaway; rebuild with `sh prototypes/today-view/build.sh`). Variants A Checklist, B Week board + notes pane, C Focus. Scenario picker covers before start, week 1, week 4, week 12, the 8-Task Saturday (day 104) and after the end._

## Resolution

Decided 2026-11-12 after trying three variants on the real 17-week data.

- **Layout: variant B, week board + notes pane**, with two pieces from A: each card has an inline **more/less** expand (description + links) so you can read a Task without the side pane, and at narrow widths everything stacks in A's order, **Catch up (overdue) → Today → In progress**, then the side pane. Built in the chosen look: [`/prototypes/today-view/today-view.html`](../../prototypes/today-view/today-view.html).
- **Structure, top to bottom:** a header with the Today / Path / Notes nav and a light/dark toggle. A hero with eyebrow `day N · week W of 17 · date · rhythm label`, the Block title and goal, and three stats (required % · bonus · streak) above a thin progress bar per Block. A **7-day strip** for the current path week: each day shows its rhythm label and one dot per Task (done / overdue / open / skipped). **Clicking a day** puts that day's Tasks in the middle column ("past"/"ahead", tickable) and its Day Note in the side pane. Then three columns: **Catch up** (overdue, oldest first, with the shift control and undo), **Today** and **In progress** (open exercises). The **side pane** holds the selected Task's details, Done/Skip, its Task Note, the Day Note and the Block goal.
- **Cards:** a round done-check, the kind (and optional) as a mono label, the title (click to select), status text ("2d overdue", "day 2 of 4 · due fri", "done today"), more/less, skip/unskip. Overdue is shown as an accent dot and accent text, not a coloured border.
- **Edge states:** before the start, the hero says "Almost ready" with a countdown and the column shows a tickable day 1. After the end, the hero says "You finished it", followed by a done-of-required summary and a "Still open" column of leftover overdue Tasks. Neither state shows the week strip.
- **Rhythm label vs. content** (from 005/009): the label appears in the eyebrow and as the Today column's subtitle and is never used to filter Tasks. In week 12 a "study" label over build Tasks reads fine as a hint.
- **Streak finding → 007 amended:** under the original rule the streak broke on every Build day spent on an unfinished exercise (week 4 showed a streak of 0). Now a day also counts if any Note was edited. The Task Note's label on exercises says so.
- **Look and feel:** taken from the user's ablation.kitchen design canvas (Instrument Serif display, Inter Tight body, JetBrains Mono labels; `#F7F6F3`/`#FFFFFF`/`#111111` with accent `#E4572E`, dark `#0C0C0B`/`#141413`/`#EDEBE6` with `#FF6A3D`; pill buttons, 12–14px radius cards with a hover lift). This becomes the app's visual direction.
- **Primary source:** the A/B/C comparison stays at [`/prototypes/today-view/today-prototype.html`](../../prototypes/today-view/today-prototype.html). The repo is not under git, so there is no throwaway branch. Both pages are rebuilt with `sh prototypes/today-view/build.sh`. They are prototypes and get rewritten, not promoted.
