---
title: "Assemble the hand-off spec and slice it into build tickets"
labels: [wayfinder:task]
status: closed
assignee: sombra
parent: 1
blocked_by: [10, 11, 12, 13, 14]
---

## Question

Combine every resolved ticket on the map into one hand-off-ready spec: domain (from `/GLOSSARY.md`), schema and validator, data model and derived signals, reload, screens, API, exports, packaging. Then slice it into ordered, independently buildable tickets with acceptance criteria. Include the build-time script that derives the LLM **generation schema** from the canonical one ([004](004-define-learning-path-schema.md)). Use the 17-week path as the end-to-end acceptance fixture.

## Resolution

Assembled 2026-11-12.

- **Spec:** [`/spec/SPEC.md`](../../spec/SPEC.md) covers the domain, the path format with its loader, validator and generation schema, the data model, derived signals, reload, screens, the HTTP API, exports, frontend state, packaging and testing. Each section names its source tickets, and **the spec wins** where the two disagree.
- **Build tickets:** [`/spec/build-tickets/`](../../spec/build-tickets/README.md) holds 16 ordered tickets with `blocked_by` and acceptance criteria. Foundations come first: scaffold and Docker (01), loader/validator (02), generation-schema script (03), derived signals (04), database (05). Then first run (06), Today (07), Notes (08), shift (09), Path (10), Resource Index (11), Notes screen (12), reload (13), Markdown export (14), Backup/restore (15), and README + end-to-end walkthrough (16).
- **Generation schema** (004's build ticket): ticket 03. It makes every property required and the optional ones nullable (13 fields, under Claude's cap of 16), checks for keywords outside the allowlist, adds `normaliseGenerated`, a drift test and a round trip on the fixture.
- **Fixture facts pinned:** 6 Blocks, 123 Tasks, path length 118, 5 core resources + 50 Task links → 49 Resource Index entries.
- **Choices made while assembling** that no ticket settled are listed in the spec's §13 and marked [A] inline: the table layout, undo as a stack, deleting a Note also deletes its trail, run length from effective due days, the Block `behind` rule, shift days 1–365, keeping 3 pre-restore Safety Copies, heading demotion for Day and Enrollment Notes, and keeping every optional field nullable in the generation schema.
