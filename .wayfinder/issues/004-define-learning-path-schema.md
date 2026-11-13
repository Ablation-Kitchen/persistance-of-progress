---
title: "Define the Learning Path schema"
labels: [wayfinder:grilling]
status: closed
assignee: sombra
parent: 1
blocked_by: [2]
---

## Question

What exactly is in a Learning Path file? Path metadata (title, description, version, total days, weekly rhythm labels), Blocks (id, title, goal, day range), Tasks (stable id format, `day`, kind, `optional`, title, description, links/resources, note template), and anything else the sample plan needs (core resources list, resource index, "apply in parallel" style advice). Produce the JSON Schema draft and decide id conventions, informed by the structured-output research.

## Resolution

Grilled 2026-11-10. Draft schema: [`/schema/learning-path.schema.json`](../../schema/learning-path.schema.json). Glossary gained **Due Day** and **Week Rhythm**, and *overdue* was redefined.

- **One canonical schema** limited to constructs from the shared LLM subset (see [research](../../research/llm-structured-output-schema-subset.md)), but optional properties may be left out. A **generation schema** (all fields required, optional ones nullable) is *derived* from it by a build-time script. That script is a build ticket.
- **Shape:** Path → `blocks[]` → `tasks[]`. There's no level below Block. Sub-heading context goes into the Block's `description`.
- **Path fields:** `schemaVersion` (const 1), `id` (kebab slug, used to match a reload), `version?` (display only), `title`, `description` (Markdown: how-to-use, assumptions, advice), `startWeekday?` (picker hint only), `weekRhythm?` (7 weekday-neutral labels indexed by `(day−1) mod 7`), `resources?` (`{title, url?, note?}`), `blocks[]`. Total days and the resource index are derived, not stored.
- **Block fields:** `title`, `goal`, `description?`, `tasks[]`. **No Block id** (display only). The day range is derived from its Tasks.
- **Task fields:** `id`, `day`, `dueDay?` (defaults to `day`; the Task is *open* through it, overdue only after it), `kind`, `optional?` (defaults to false), `title` (a checkpoint's statement), `description?` (a reflection's prompt), `links?` (`{title, url}`), `noteTemplate?`. Array order is the display order within a day. No time estimates.
- **Id convention:** written by the author, kebab-case, unique across the path, meaningful but not positional. The app never makes ids up.
- **Modelling conventions:** advice ("start applying") becomes an ordinary Task. "Pick N of M" becomes M `optional` Tasks with the instruction in their descriptions. The weekly "write in LEARNINGS.md" becomes a `reflection` Task.
- **Path validator** (app-side; a failing file is rejected as a whole with a list of errors, no partial loads):
  1. Task ids are unique.
  2. `day` ≥ 1 and `dueDay` ≥ `day`.
  3. Blocks are in order and don't overlap. Gaps and days with no Tasks are allowed.
  4. `weekRhythm` has exactly 7 entries.
  5. `kind` and `startWeekday` are lowercased on load.
  6. Link URLs match `^https?://`.
