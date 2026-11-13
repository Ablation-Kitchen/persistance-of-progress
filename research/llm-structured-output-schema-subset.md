# JSON Schema subset for LLM structured output (Anthropic + OpenAI)

Question: which JSON Schema constructs can a Learning Path schema use so that Claude (structured outputs / strict tool use) and OpenAI (Structured Outputs / strict function calling) can target it directly? What should be validated app-side instead?

Researched 2026-11-10 against the official docs:

- **[A]** Anthropic, Structured outputs: <https://platform.claude.com/docs/en/build-with-claude/structured-outputs> (docs.claude.com / docs.anthropic.com redirect here)
- **[O]** OpenAI, Structured Outputs, "Supported schemas": <https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas> (platform.openai.com redirects here)
- **[OF]** OpenAI, Function calling, "Strict mode": <https://developers.openai.com/api/docs/guides/function-calling#strict-mode>

"Undocumented" means the docs don't mention the keyword at all. Don't rely on it: test it, or leave it out.

## Compatibility matrix

| Construct | Anthropic (JSON outputs and `strict: true` tools) [A] | OpenAI (Structured Outputs and `strict: true` functions) [O] |
|---|---|---|
| Basic types | object, array, string, integer, number, boolean, null | String, Number, Boolean, Integer, Object, Array, Enum, anyOf |
| Root type | Not restricted beyond object types | Root **must be an object** and **must not be `anyOf`**. A top-level discriminated union fails. |
| `$ref` / `$defs` | Supported: `$ref`, `$def`, `definitions`. **External `$ref` rejected.** | Supported (`#/$defs/...`) |
| Recursion | **Not supported** (400) | Supported (`"$ref": "#"` or via `$defs`) |
| `anyOf` | Supported, but counts toward the union limit (see limits) | Supported, as long as each branch is valid under the subset. Not allowed at the root. |
| `allOf` | Supported with limits: **`allOf` with `$ref` is not supported** | **Not supported** (error) |
| `oneOf` | Undocumented | Undocumented |
| `not`, `if`/`then`/`else`, `dependentRequired`, `dependentSchemas` | Undocumented | **Not supported** (error) |
| `enum` | Supported for strings, numbers, booleans and null only, no complex values. **Casing is not guaranteed**: Claude may return a value that differs only in capitalization. | Supported. Up to 1000 enum values in total; >250 values in one string enum caps that enum at 15,000 chars |
| `const` | Supported (same casing caveat) | Counts toward the string-size limit. The keyword itself is not in the "Supported properties" list. |
| `pattern` | Supported, simple regex only: anchors, `* + ?`, simple `{n,m}`, `[]`, `.`, `\d \w \s`, groups. **No** backreferences, lookaround, `\b`, or large `{n,m}`. A complex pattern may return a 400. | Supported (not for fine-tuned models) |
| `format` | `date-time, time, date, duration, email, hostname, uri, ipv4, ipv6, uuid` | `date-time, time, date, duration, email, hostname, ipv4, ipv6, uuid`. **No `uri`.** Not supported for fine-tuned models. |
| `minimum` / `maximum` / `multipleOf` / exclusive* | **Not supported** (400) | Supported (not for fine-tuned models) |
| `minLength` / `maxLength` | **Not supported** (400) | Not in the "Supported string properties" list (only `pattern` and `format` are). Treat as unsupported. |
| `minItems` | **Only 0 or 1** | Supported (not for fine-tuned models) |
| `maxItems` | **Not supported** ("array constraints beyond minItems of 0 or 1") | Supported (not for fine-tuned models) |
| `additionalProperties` | **Must be `false`** on every object | **Must be `false`** on every object |
| `patternProperties` | Undocumented (and `additionalProperties` must be `false` anyway) | Not supported for fine-tuned models. Not listed as supported for base models. |
| `required` | Optional properties are allowed, but limited to **24 optional params in total** across all strict schemas in the request | **Every property must be listed in `required`.** Emulate optional with `"type": ["X","null"]` [O][OF] |
| Nullable (`["string","null"]`) | Supported, but counts toward the **16 union-typed params** limit | This is *the* way to express optional |
| `default` | Supported "for all supported types" | Undocumented. Required-ness makes it moot. |
| `description` | Supported, and used as model guidance | Supported, and used as model guidance |
| Key order | Schema order, **except required properties come first, then optional ones** | Schema order |
| Size limits | 20 strict tools/request; 24 optional params; 16 union-typed params; unspecified internal limits ("Schema is too complex for compilation"); 180 s compile timeout | 5000 object properties total; **10 nesting levels**; 120,000 chars in total across property names, definition names, enum values and const values; 1000 enum values |
| Unsupported keyword sent | 400 error with details | Error when `strict: true` |

Other behaviour worth knowing:

- **Anthropic SDK helpers** strip unsupported constraints (min/max/minLength...), copy them into the field `description`, add `additionalProperties: false`, filter `format` to the supported list, and validate the response against the *original* schema [A]. The model sees a simplified schema, and the SDK enforces the full one.
- **Compile latency/caching:** Anthropic compiles a grammar on first use and caches it for 24 h after last use. Changing only `name` or `description` doesn't invalidate the cache [A]. OpenAI adds latency on the first request for a new schema [O].
- **Output may still fail the schema:** Anthropic returns `stop_reason: "refusal"` or `"max_tokens"` when the output is not schema-valid, and the second case is likely for long paths. Give it a generous `max_tokens` and check `stop_reason` [A]. OpenAI also has refusals [O].
- **OpenAI strict defaults:** Responses API tries to normalise schemas into strict mode and falls back to non-strict *silently* (the tool shows `strict: false`). Chat Completions is non-strict by default. Always send `strict: true` explicitly [OF]. Strict mode is disabled for parallel calls on fine-tuned models [OF].

## The intersection (what to write if one schema must serve both)

Use only:

- `type` (object, array, string, integer, boolean, and `null` inside type arrays)
- `properties`, `required` (listing **every** property), `additionalProperties: false` on every object
- `items`, local `$ref` into `$defs` (no external refs, no recursion, no `allOf`+`$ref`)
- `enum` / `const` of primitive values
- `anyOf` only below the root, and sparingly
- simple `pattern`
- `format` from the shared list (date, date-time, uuid, email...). **Not `uri`** (OpenAI lacks it).
- `minItems` of 0 or 1
- `description` everywhere

Avoid: `oneOf`, `allOf`, `not`, conditionals, `minimum`/`maximum`, `minLength`/`maxLength`, `maxItems`, `minItems > 1`, `uniqueItems`, `patternProperties`, `propertyNames`, `default`-dependent semantics, recursion, more than 10 nesting levels.

## Design implications for the Learning Path schema

1. **Keep two schemas.**
   - An *authoring/canonical* schema (full JSON Schema 2020-12, used by the YAML editor and CI). It can use `minimum`, `maxItems`, `uniqueItems`, `oneOf`, `uri`, and so on.
   - A derived *generation* schema restricted to the intersection above.
   - Generate the second from the first (or from a Zod/Pydantic model, as the SDK helpers do), and validate every LLM output against the canonical schema app-side.
2. **Task `id`:** a string with a simple `pattern` such as `^[a-z0-9]+(-[a-z0-9]+)*$`, which works on both providers. Check **uniqueness** across the path app-side, because no `uniqueItems` and no cross-field constraints are available. Consider letting the app assign or normalise ids (slug from title plus suffix) instead of trusting the model.
3. **`day`:** `"type": "integer"` with a description such as "1-based day index within the path, 1..N". Claude rejects `minimum`/`maximum`, so enforce 1 ≤ day ≤ N, block/week consistency and ordering app-side. Optionally state N in the prompt.
4. **`kind`:** a lowercase string `enum` `["material","exercise","checkpoint","reflection"]`. Values are lowercase single words, so Claude's casing drift is unlikely, but **normalise to lowercase** on ingest anyway [A].
5. **Optional fields (`optional` flag, `description`, `links`):**
   - Prefer **required + non-nullable** where a natural empty value exists: `optional: boolean` (always emitted), `links: []` (array, `minItems` 0), `description: ""`.
   - Use `["string","null"]` only where "absent" must differ from empty.
   - This satisfies OpenAI's all-required rule, avoids Claude's 24-optional and 16-union caps, and avoids Claude reordering optional keys after required ones.
   - Unions and optionals count per *field definition*. If the `Task` def is reused via `$ref`, it probably counts once; that's not documented, so verify.
   - Strip null and empty values back out when writing YAML if the canonical files should omit them.
6. **Links:** an array of `{title: string, url: string}` objects with `additionalProperties: false`. Don't use `format: "uri"`, because OpenAI doesn't support it. Validate URLs app-side, or use a simple `^https?://` pattern.
7. **Structure:** Path → blocks[] → tasks[] (or weeks[] → tasks[]) is about 4–5 levels deep, well under OpenAI's limit of 10. Put `Block` and `Task` in `$defs`. No recursion is needed, so don't introduce any; Claude rejects it.
8. **Root:** a plain object (not a union), with `additionalProperties: false`. If the path has variants, model them with a `kind` enum plus nullable fields, not a root `anyOf`/`oneOf`.
9. **Validate app-side:**
   - id uniqueness and format normalisation
   - day range, contiguity and monotonic order
   - each task's day falls inside its block's week range
   - array length limits (tasks per day, blocks per path)
   - string min/max lengths
   - URL validity
   - checkpoint placement rules (for example, one per block)
   - cross-references between entities

   Neither provider can express any of these reliably.
10. **Long outputs:** a full path can be many tokens. Set a high `max_tokens` and treat `stop_reason` `max_tokens`/`refusal` as failures. Consider generating block by block, using the same Block schema as the output format.
11. **Descriptions carry the constraints:** whatever the provider can't enforce, put in the `description` (for example, "integer 1..N, unique per task"), the way Anthropic's SDK does automatically [A].
