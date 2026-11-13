---
title: "Which schema gaps from the 17-week conversion should be fixed?"
labels: [wayfinder:grilling]
status: closed
assignee: sombra
parent: 1
blocked_by: [5]
---

## Question

Converting the real plan surfaced three schema gaps (see [Convert the 17-week plan into the schema](005-convert-sample-plan.md), items 1–3). For each, decide whether to change the schema or accept the convention, while staying inside the LLM-safe subset:

1. **Recurring Tasks** (weekly review, weekly LeetCode): add a recurrence construct, or keep writing one Task per week? If one per week, change the id convention to allow positional ids for recurring Tasks. How do recurring Tasks interact with Schedule Shift and with reload?
2. **Book resources without a URL:** make `Link.url` optional, or should Tasks reference `resources` entries? Should Resource gain a type (video/paper/book)? Is the resource index still derived?
3. **Week Rhythm that doesn't hold in some weeks:** add a per-Block `weekRhythm` override, or keep labels approximate?

## Resolution

Grilled 2026-11-10. Changes applied to the [schema draft](../../schema/learning-path.schema.json) and the [converted sample](../../samples/eval-infra-17-weeks.yaml). The sample still validates: 123 Tasks, 0 errors.

1. **Recurring Tasks: no recurrence construct.** Each copy stays an ordinary Task with its own explicit `day`. Progress, Notes, Schedule Shift and reload need no special case. **Id exception:** recurring copies are named `<series>-week-<n>`, where n is the week the copy was authored for. They are **never renumbered** when a copy moves, because the id is its identity and the suffix is only a name. Recorded in the Task `id` description.
2. **`Link.url` is optional.** A Link without a URL names an offline resource, such as a book chapter. There are no Resource ids and no cross-references. The validator rule "URLs match `^https?://`" applies only when a URL is present. The generation schema makes `url` nullable, as it does every optional field. The sample's book Tasks now carry URL-less links, and the three books added to `resources` by hand were removed.
3. **No resource type** (video/paper/book). Add it only if a resource-index view needs it.
4. **Week Rhythm stays global and approximate.** It's a display hint for the intended rhythm, not a promise about a day's Tasks. A per-Block override wouldn't help: Block 4 (weeks 10–13) mixes weeks with reading and weeks without. How Today shows the label is left to the Today prototype.
5. **Resource index:** still derived, from `resources` plus Task links. Its layout (de-duplication, ordering) moved to the Path-screen fog.
