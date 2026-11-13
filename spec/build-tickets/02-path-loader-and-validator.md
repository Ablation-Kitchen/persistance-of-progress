---
title: "Path loader and validator in core"
status: closed
blocked_by: [1]
---

**Spec:** §3.1, §3.2, §8.2 (issue shape).

## Scope

- Move the canonical schema to `core/schema/learning-path.schema.json` and point `paths/README.md` at it.
- `loadPath(text, {source})`: parse with `yaml` (with a `LineCounter`), lowercase `kind`/`startWeekday`, run Ajv 2020-12, then the app rules (`duplicate-task-id`, `day-out-of-range`, `due-before-day`, `blocks-overlap`, `week-rhythm-length`), and return `{ok, path, hash}` or `{ok: false, issues}`.
- Issues are `{pointer, line?, column?, rule, message}`, with each pointer mapped to a line and column for YAML input.
- `canonicalJson(value)` (keys sorted recursively) and `pathHash(path)` (SHA-256 hex).
- Path helpers that later tickets use: `allTasks(path)` in path order, `pathLength(path)`, and `blockRange(block)`.

## Acceptance

- [x] The 17-week fixture loads with 0 issues and 123 Tasks, and `pathLength = 118` (week 17, Saturday).
- [x] For each rule, a broken copy of the fixture produces exactly that rule, with the right pointer and line.
- [x] `Kind: Material` loads as `material`. A YAML syntax error yields one `yaml-syntax` issue with a line number.
- [x] Re-indenting the fixture or adding comments leaves the hash unchanged. Changing one Task title changes it.
- [x] A day's Tasks sort by `(day, Block index, array index)`. The fixture has days where file order ≠ day order; cover one of them.
