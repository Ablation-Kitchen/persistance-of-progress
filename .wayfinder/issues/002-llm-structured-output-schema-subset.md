---
title: "Which JSON Schema features do LLM structured-output modes support?"
labels: [wayfinder:research]
status: closed
assignee: claude
parent: 1
blocked_by: []
---

## Question

The Learning Path schema must be targetable by a future LLM step using structured output. Which JSON Schema keywords/constructs are supported (and which are rejected or ignored) by Anthropic's and OpenAI's structured-output / strict tool modes — e.g. `$ref`/`$defs`, `oneOf`/`anyOf`, `enum`, `pattern`, `format`, min/max, `additionalProperties`, required-ness, nesting depth, size limits? What does that imply for designing an LLM-friendly schema (e.g. how to express Task ids, day numbers, kinds)?

Findings: `/research/llm-structured-output-schema-subset.md`

## Resolution

Findings: [/research/llm-structured-output-schema-subset.md](../../research/llm-structured-output-schema-subset.md) (sources read 2026-11-10).

- Common subset across Anthropic + OpenAI strict: `type`, `properties`, `required`, `additionalProperties: false` everywhere, local `$ref`/`$defs` (no recursion), primitive `enum`/`const`, non-root `anyOf`, simple `pattern`, `minItems` 0/1.
- Avoid: `minimum`/`maximum`, `minLength`/`maxLength`, `maxItems`, `minItems`>1 (Claude); `allOf`/`not`/conditionals, root `anyOf` (OpenAI); `oneOf`, `format: uri` (neither reliable).
- OpenAI strict requires every property in `required` (optional = nullable); Claude caps optional params (24) and union-typed fields (16). → Prefer all-required with empty defaults.
- Implication for the schema ticket: consider a canonical schema (full JSON Schema 2020-12, used for file validation) plus a derived LLM-safe generation schema; range/uniqueness/contiguity checks (ids, `day` 1..N) live in app-side validation, with constraints described in field descriptions.
