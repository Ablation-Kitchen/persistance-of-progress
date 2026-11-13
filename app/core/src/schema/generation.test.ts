import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import canonical from "../../schema/learning-path.schema.json" with { type: "json" };
import { loadPath } from "../path/load.js";
import {
  buildGenerationSchema,
  normaliseGenerated,
  NULL_SUFFIX,
  serialiseGenerationSchema,
} from "./generation.js";

const coreDir = new URL("../../", import.meta.url);
const committedPath = new URL("schema/generated/learning-path.generation.schema.json", coreDir);
const fixture = readFileSync(new URL("../paths/eval-infra-17-weeks.yaml", coreDir), "utf8");

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => v !== null && typeof v === "object" && !Array.isArray(v);

/** Every object schema (`type: "object"` with `properties`), keyed by pointer. */
function objectSchemas(node: unknown, pointer = ""): [string, Node][] {
  if (!isNode(node) && !Array.isArray(node)) return [];
  const own: [string, Node][] =
    isNode(node) && node.type === "object" && isNode(node.properties) ? [[pointer, node]] : [];
  const nested = Object.entries(node).flatMap(([k, v]) => objectSchemas(v, `${pointer}/${k}`));
  return [...own, ...nested];
}

/** Every `description` string in a schema, keyed by pointer. */
function descriptions(node: unknown, pointer = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (isNode(node) || Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (k === "description" && typeof v === "string") out.set(pointer, v);
      else for (const [p, d] of descriptions(v, `${pointer}/${k}`)) out.set(p, d);
    }
  }
  return out;
}

describe("buildGenerationSchema on the canonical schema", () => {
  const { schema, nullable } = buildGenerationSchema(canonical);

  it("lists every property in required on every object", () => {
    const objects = objectSchemas(schema);
    expect(objects.map(([p]) => p).sort()).toEqual(
      ["", "/$defs/Block", "/$defs/Link", "/$defs/Resource", "/$defs/Task"].sort(),
    );
    for (const [, node] of objects) {
      expect(node.required).toEqual(Object.keys(node.properties as Node));
    }
  });

  it("makes exactly the 13 optional fields nullable", () => {
    expect([...nullable].sort()).toEqual(
      [
        "/properties/version",
        "/properties/startWeekday",
        "/properties/weekRhythm",
        "/properties/resources",
        "/$defs/Block/properties/description",
        "/$defs/Task/properties/dueDay",
        "/$defs/Task/properties/optional",
        "/$defs/Task/properties/description",
        "/$defs/Task/properties/links",
        "/$defs/Task/properties/noteTemplate",
        "/$defs/Link/properties/url",
        "/$defs/Resource/properties/url",
        "/$defs/Resource/properties/note",
      ].sort(),
    );
  });

  it("uses type unions for scalars, adds null to enums, and anyOf for arrays and refs", () => {
    const props = schema.properties as Record<string, Node>;
    expect(props.version?.type).toEqual(["string", "null"]);
    expect(props.startWeekday?.enum).toContain(null);
    expect(props.weekRhythm?.anyOf).toEqual([
      { type: "array", items: { type: "string" } },
      { type: "null" },
    ]);
  });

  it("drops $schema and $id but keeps title and description", () => {
    expect(schema).not.toHaveProperty("$schema");
    expect(schema).not.toHaveProperty("$id");
    expect(schema.title).toBe(canonical.title);
    expect(schema.description).toBe(canonical.description);
  });

  it("keeps every original description, suffixing only the nullable ones", () => {
    const before = descriptions(canonical);
    const after = descriptions(schema);
    const nullableSet = new Set(nullable);
    for (const [pointer, text] of before) {
      const expected = nullableSet.has(pointer) ? `${text} ${NULL_SUFFIX}` : text;
      expect(after.get(pointer), pointer).toBe(expected);
    }
  });
});

describe("drift", () => {
  it("regenerating in memory equals the committed file", () => {
    const fresh = serialiseGenerationSchema(buildGenerationSchema(canonical).schema);
    expect(readFileSync(committedPath, "utf8"), "run `npm run build:generation-schema`").toBe(
      fresh,
    );
  });
});

describe("the script", () => {
  it("fails with a clear message on a keyword outside the allowlist", () => {
    const copy = structuredClone(canonical) as Node;
    const day = (((copy.$defs as Node).Task as Node).properties as Node).day as Node;
    day.minimum = 1;
    const dir = mkdtempSync(join(tmpdir(), "gen-schema-"));
    const input = join(dir, "schema.json");
    writeFileSync(input, JSON.stringify(copy));

    let stderr = "";
    let status: number | null = 0;
    try {
      execFileSync(
        "npx",
        ["tsx", "scripts/build-generation-schema.ts", input, join(dir, "out.json")],
        { cwd: coreDir, stdio: "pipe" },
      );
    } catch (err) {
      const e = err as { status: number | null; stderr: Buffer };
      status = e.status;
      stderr = e.stderr.toString();
    }
    expect(status).toBe(1);
    expect(stderr).toContain(
      'keyword "minimum" at /$defs/Task/properties/day/minimum is outside the allowlist',
    );
  }, 30_000);

  it("rejects minItems above 1 and more than 16 nullable fields", () => {
    const wide = structuredClone(canonical) as Node;
    ((wide.properties as Node).blocks as Node).minItems = 2;
    expect(() => buildGenerationSchema(wide)).toThrow(/"minItems": 2 .* must be 0 or 1/);

    const many = structuredClone(canonical) as Node;
    for (let i = 0; i < 4; i++) (many.properties as Node)[`extra${i}`] = { type: "string" };
    expect(() => buildGenerationSchema(many)).toThrow(/17 nullable fields exceeds the cap of 16/);
  });
});

describe("round trip", () => {
  /** Fill every absent optional property with null, following the canonical schema. */
  function fillNulls(value: unknown, node: Node): unknown {
    if (typeof node.$ref === "string") {
      const name = node.$ref.replace("#/$defs/", "");
      return fillNulls(value, (canonical.$defs as Record<string, Node>)[name] as Node);
    }
    if (Array.isArray(value) && isNode(node.items)) {
      return value.map((v) => fillNulls(v, node.items as Node));
    }
    if (isNode(value) && isNode(node.properties)) {
      const out: Node = {};
      for (const [k, child] of Object.entries(node.properties)) {
        out[k] = k in value ? fillNulls(value[k], child as Node) : null;
      }
      return out;
    }
    return value;
  }

  it("a null-filled fixture validates and normalises back to the same hash", () => {
    const original = loadPath(fixture, { source: "yaml" });
    if (!original.ok) throw new Error("fixture should load");

    const filled = fillNulls(parse(fixture), canonical as Node);
    expect(JSON.stringify(filled)).toContain("null");

    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(buildGenerationSchema(canonical).schema);
    expect(validate(filled), JSON.stringify(validate.errors)).toBe(true);

    const back = loadPath(JSON.stringify(normaliseGenerated(filled)), { source: "json" });
    expect(back.ok && back.hash).toBe(original.hash);
  });
});
