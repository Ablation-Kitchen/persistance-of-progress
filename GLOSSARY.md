# Glossary

**Learning Path** — An ordered body of study material (tasks grouped into blocks) that a learner works through over a number of weeks. Authored once, loaded many times.
_Avoid:_ plan, course, curriculum (when meaning the loaded thing)

**Enrollment** — One learner's run through a Learning Path, anchored to a chosen start date. Holds all progress and notes for that run. The learner may hold several, but works in one **active** Enrollment at a time.
_Avoid:_ instance, session

**Task** — The smallest unit of work in a Learning Path that the learner ticks off. Has a stable identity that survives edits to the path.
_Avoid:_ item, todo, lesson

**Task Kind** — What sort of work a Task is: **material** (read/watch/skim), **exercise** (a hands-on build that may span several sessions), **checkpoint** (a self-assessment statement), or **reflection** (a prompt to write a Note). Any Task may be marked **optional**.

**Block** — A named group of consecutive weeks in a Learning Path with a shared goal (e.g. "Weeks 4–6: The platform layer").

**Task Status** — Where a Task stands in an Enrollment: `todo`, `done`, or `skipped`. A required Task still `todo` after its (shifted) **due day** is **overdue**; overdue is derived, never stored. Optional Tasks are never overdue.

**Due Day** — The last day a Task is meant to be worked on. A Task appears on its day and stays **open** (not overdue) through its due day; by default the due day is the Task's own day. Lets an exercise span several sessions.

**Note** — Free-form Markdown written by the learner, attached to a Task, a Day, or a whole Enrollment. Captures both reflections and findings (links, snippets).
_Avoid:_ finding, resource, comment (as separate concepts)

**Day** — A calendar date within an Enrollment, derived from the start date and the path's day numbering.

**Week Rhythm** — Seven display labels (e.g. "Study", "Build", "Review") that name the recurring role of each day of a path week. Purely descriptive; Tasks carry their own days.

**Schedule Shift** — A learner-triggered move of every Task still `todo` (overdue, future and optional alike) forward by N > 0 days, recorded as a per-Task offset. Only the most recent shift can be undone.

**Percent Complete** — Done required Tasks ÷ all required Tasks. Skipped Tasks count as not done. Finished optional Tasks are counted separately as a **bonus**.

**Resource Index** — The de-duplicated list of everything a Learning Path points to: its core resources plus every Task link. Derived on the Path screen, never stored or authored. One entry per URL, or per book title with any bracketed author or edition part ignored.
_Avoid:_ bibliography, library, reading list

**Streak** — Consecutive calendar days on which at least one Task was marked done or a Note was edited. Days with no Task scheduled don't break it, and today only breaks it once it has ended.

**Notes Export** — A single Markdown file of one Enrollment's Notes, laid out Block → week → day, for reading or keeping outside the app. One-way: it is never imported back.
_Avoid:_ backup (it isn't one)

**Backup** — A versioned JSON snapshot of the whole app (every Enrollment and the active setting). Restoring one replaces everything after a preview.
_Avoid:_ export (when meaning the JSON), sync

**Safety Copy** — An automatic copy of the database that the server writes into `/data` before a risky change: a JSON Backup before a restore (`pre-restore-<timestamp>.json`), and a `VACUUM INTO` copy before migrations (`pre-migrate-v<old>-<timestamp>.db`, last 3 kept). It lives on the same volume, so it doesn't replace a downloaded Backup.
_Avoid:_ snapshot, autosave
