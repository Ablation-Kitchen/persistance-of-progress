---
title: "Convert the 17-week plan into the schema"
labels: [wayfinder:task]
status: closed
assignee: claude
parent: 1
blocked_by: [4]
---

## Question

Does the schema hold up against a real path? Convert `/samples/eval-infra-17-weeks.md` into `/samples/eval-infra-17-weeks.yaml`, placing every Task on an explicit day following the plan's weekly rhythm (Mon/Wed study, Tue/Thu/Fri build, Sat review), validate it against the schema, and record every place the schema was awkward or insufficient.

## Resolution

Done 2026-11-10 (AFK). Converted file: [`/samples/eval-infra-17-weeks.yaml`](../../samples/eval-infra-17-weeks.yaml). **It passes the JSON Schema and all six path-validator rules.** Totals: 123 Tasks over 6 Blocks, days 1–118 (`startWeekday: monday`, day = 7·(week−1) + weekday). `weekRhythm` = Study, Build, Study, Build, Build, Review, "".

**The schema holds up.** Every element of the plan found a home. Below is where it was awkward, most significant first:

1. **Recurring Tasks.** The weekly review (17×) and the weekly LeetCode slot from week 8 on (10×) have to be written out once per week, with the same description each time. Their ids end up positional (`learnings-week-3`, `leetcode-week-8`), which breaks the "meaningful, not positional" id convention. Nothing ties the copies together.
2. **Books can't be links.** `Link.url` is required, so the five or so book Tasks (asyncio, Kubernetes: Up and Running, DDIA, AI Engineering, Alex Xu) have no links. The book is named only in the title. A *derived* resource index would leave them out, so I added them to `resources` by hand. The source index's **Type** column (Video/Paper/Book) and its week column have no field.
3. **Rhythm labels don't fit every week.** Weeks 12–13 have no reading, so capstone exercises start on "Study" days (12 exercises start on a Study day). `weekRhythm` is global to the path, so in those weeks the labels are wrong.
4. **"Pick at least two of four"** (week 8 papers) became 4 optional Tasks, as the convention says. The app can't tell the learner when the requirement is met.
5. **Advice and swaps.** "Start applying" became an `exercise` (a stretch, but it works). "Swap one build session a week for LeetCode" can't be expressed as a swap. It became an extra optional Task on Friday.
6. **Final checks mix kinds.** Two of the plan's checkbox items are actions, not self-assessments: the mock interviews and the resume update. They became `exercise`s. Only "why evals" stayed a `checkpoint`.
7. **Placement was invented, not converted.** The plan gives exercises per Block and readings per group of weeks. Almost every exact day, and every `dueDay` span, is my judgment: for example, four week-3 readings fit into two study slots, and each exercise was given its own span of build days. This is the cost of the "days are explicit" decision. The schema isn't at fault, but it shows that writing a path by hand takes real work.
8. **Minor.** Block sub-headings ("Weeks 1–2: The model") survive only as text in the Block's `description`. "Concepts to whiteboard" became 5 checkpoints. Exercise dependencies (ex 2 uses ex 1's runner) are implied only by order.

**Fact for later tickets:** within a Block, Tasks are not sorted by day in the file. The app must order a day's Tasks by `(day, array index)`.

Follow-ups: items 1–3 are filed as [Which schema gaps from the 17-week conversion should be fixed?](009-schema-gaps-from-conversion.md). Item 3 is also passed on to the Today prototype.
