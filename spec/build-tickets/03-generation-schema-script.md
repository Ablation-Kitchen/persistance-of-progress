---
title: "Generation-schema build script"
status: closed
blocked_by: [2]
---

**Spec:** §3.3. **Background:** [002 research](../../research/llm-structured-output-schema-subset.md).

## Scope

- `core/scripts/build-generation-schema.ts`, run as `npm run build:generation-schema`. It writes `core/schema/generated/learning-path.generation.schema.json`. The transformation:
  - every property listed in `required`;
  - optional properties made nullable (adding `null` to type or enum, or `anyOf` with `{type: "null"}` for `$ref` and array properties);
  - "Null when absent." appended to their descriptions;
  - `$schema`/`$id` dropped.
- Fails on any keyword outside the allowlist, or on more than 16 nullable fields.
- `normaliseGenerated(obj)` in `core` strips `null` properties recursively.
- Commit the generated file.

## Acceptance

- [x] The output has `required` = all keys on every object, 13 nullable fields, no `$schema`/`$id`, and every original description intact.
- [x] The **drift test**: regenerating in memory equals the committed file.
- [x] Adding `"minimum": 1` to `day` in a test copy of the schema makes the script fail with a clear message.
- [x] **Round trip:** fill every absent optional field of the fixture with `null`. The result validates against the generation schema (Ajv), and `normaliseGenerated` + `loadPath` gives the same hash as the original fixture.
