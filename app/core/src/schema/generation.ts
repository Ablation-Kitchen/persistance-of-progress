/**
 * The generation schema (spec §3.3): the canonical schema rewritten for strict
 * structured output. Every property is required; optional ones become nullable.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type SchemaNode = { [key: string]: Json };

/** Claude's cap on union-typed (nullable) fields in one strict schema. */
export const MAX_NULLABLE_FIELDS = 16;

export const NULL_SUFFIX = "Null when absent.";

const ALLOWED_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "$ref",
  "$defs",
  "enum",
  "const",
  "pattern",
  "minItems",
  "description",
  "title",
  "$schema",
  "$id",
  "anyOf",
]);

export class GenerationSchemaError extends Error {
  override name = "GenerationSchemaError";
}

export interface GenerationSchemaResult {
  schema: SchemaNode;
  /** JSON Pointers (into the output) of every property made nullable. */
  nullable: string[];
}

/** Derive the generation schema from the canonical one. Throws `GenerationSchemaError`. */
export function buildGenerationSchema(canonical: unknown): GenerationSchemaResult {
  if (!isNode(canonical)) throw new GenerationSchemaError("schema root must be an object");
  checkAllowlist(canonical, "", true);

  const nullable: string[] = [];
  const out = transform(canonical, "", nullable);
  delete out.$schema;
  delete out.$id;

  if (nullable.length > MAX_NULLABLE_FIELDS) {
    throw new GenerationSchemaError(
      `${nullable.length} nullable fields exceeds the cap of ${MAX_NULLABLE_FIELDS}: ${nullable.join(", ")}`,
    );
  }
  return { schema: out, nullable };
}

/** Serialised form of the committed file. */
export function serialiseGenerationSchema(schema: SchemaNode): string {
  return JSON.stringify(schema, null, 2) + "\n";
}

/** Ingest of generated output: delete every `null` property, recursively. */
export function normaliseGenerated<T = unknown>(value: T): T {
  return strip(value) as T;
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== null) out[k] = strip(v);
    }
    return out;
  }
  return value;
}

function isNode(value: unknown): value is SchemaNode {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Walk every subschema and reject keywords outside the shared structured-output subset. */
function checkAllowlist(node: SchemaNode, pointer: string, root: boolean): void {
  for (const [key, value] of Object.entries(node)) {
    const at = `${pointer}/${escape(key)}`;
    if (!ALLOWED_KEYWORDS.has(key)) {
      throw new GenerationSchemaError(`keyword "${key}" at ${at || "/"} is outside the allowlist`);
    }
    if (key === "minItems" && !(value === 0 || value === 1)) {
      throw new GenerationSchemaError(
        `"minItems": ${JSON.stringify(value)} at ${at} must be 0 or 1`,
      );
    }
    if (key === "anyOf" && root) {
      throw new GenerationSchemaError(`"anyOf" is not allowed at the schema root`);
    }
    if ((key === "$schema" || key === "$id") && !root) {
      throw new GenerationSchemaError(`"${key}" at ${at} is only allowed at the schema root`);
    }
  }
  for (const [key, child] of subschemas(node)) {
    checkAllowlist(child, `${pointer}/${key}`, false);
  }
}

/** Every direct subschema of `node`, with its pointer segment(s) relative to `node`. */
function* subschemas(node: SchemaNode): Generator<[string, SchemaNode]> {
  for (const mapKey of ["properties", "$defs"] as const) {
    const map = node[mapKey];
    if (isNode(map)) {
      for (const [name, child] of Object.entries(map)) {
        if (isNode(child)) yield [`${mapKey}/${escape(name)}`, child];
      }
    }
  }
  if (isNode(node.items)) yield ["items", node.items];
  if (Array.isArray(node.anyOf)) {
    for (const [i, child] of node.anyOf.entries()) {
      if (isNode(child)) yield [`anyOf/${i}`, child];
    }
  }
}

function transform(node: SchemaNode, pointer: string, nullable: string[]): SchemaNode {
  const out: SchemaNode = { ...node };

  if (isNode(node.$defs)) {
    out.$defs = mapValues(node.$defs, (child, name) =>
      transform(child, `${pointer}/$defs/${escape(name)}`, nullable),
    );
  }
  if (isNode(node.items)) out.items = transform(node.items, `${pointer}/items`, nullable);
  if (Array.isArray(node.anyOf)) {
    out.anyOf = node.anyOf.map((child, i) =>
      isNode(child) ? transform(child, `${pointer}/anyOf/${i}`, nullable) : child,
    );
  }

  if (isNode(node.properties)) {
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    out.properties = mapValues(node.properties, (child, name) => {
      const at = `${pointer}/properties/${escape(name)}`;
      const inner = transform(child, at, nullable);
      if (required.has(name)) return inner;
      nullable.push(at);
      return makeNullable(inner);
    });
    out.required = Object.keys(node.properties);
  }
  return out;
}

function makeNullable(node: SchemaNode): SchemaNode {
  const description =
    typeof node.description === "string" ? `${node.description} ${NULL_SUFFIX}` : NULL_SUFFIX;

  if (typeof node.type === "string" && node.type !== "array" && node.$ref === undefined) {
    const out: SchemaNode = { ...node, description, type: [node.type, "null"] };
    if (Array.isArray(node.enum)) out.enum = [...node.enum, null];
    return reorder(out, node);
  }

  // `$ref`, array and untyped properties: wrap in a union with null. The description
  // stays on the outer node so the model reads it once.
  const rest: SchemaNode = { ...node };
  delete rest.description;
  return { description, anyOf: [rest, { type: "null" }] };
}

/** Keep `out`'s keys in `original`'s order (description first if it was added). */
function reorder(out: SchemaNode, original: SchemaNode): SchemaNode {
  const keys = original.description === undefined ? ["description"] : [];
  const ordered: SchemaNode = {};
  for (const key of [...keys, ...Object.keys(original)]) {
    const v = out[key];
    if (v !== undefined) ordered[key] = v;
  }
  return ordered;
}

function mapValues(
  map: SchemaNode,
  fn: (child: SchemaNode, name: string) => SchemaNode,
): SchemaNode {
  const out: SchemaNode = {};
  for (const [name, child] of Object.entries(map)) {
    out[name] = isNode(child) ? fn(child, name) : child;
  }
  return out;
}

/** JSON Pointer segment escaping (RFC 6901). */
function escape(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
