---
title: "Resource Index"
status: closed
blocked_by: [10]
---

**Spec:** §7.4 (Resource Index).

## Scope

- `core`: `resourceIndex(path, snapshot)` → entries `{key, title, url?, isBook, isCore, note?, otherSpellings[], uses: [{taskId, effDay, done}]}`, using the de-duplication key and the rule that the core entry wins.
- Web side column:
  - the entries, with a link ↗ or `book` tag, the `core` tag, the note, "also listed as …" and use chips (`d24`, ✓) that scroll to and expand the Task in the Outline;
  - the order toggle (first use / by Block / A–Z);
  - search;
  - chips all / core / books / still to use.

## Acceptance

- [x] Fixture: **49 entries** from 5 core + 50 links, of which 4 core entries are used by Tasks. Karpathy's channel reads "not linked from a task · whole-path reference".
- [x] "Designing Data-Intensive Applications (Martin Kleppmann)" and "… (Kleppmann)" are one entry, titled from the core resource, with the other spelling listed.
- [x] Searching a Task title finds the resources that Task uses.
- [x] "still to use" hides entries whose using Tasks are all done.
