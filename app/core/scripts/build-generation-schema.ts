/**
 * Writes the generation schema (spec §3.3) from the canonical schema.
 *
 *   npm run build:generation-schema [-- <input> <output>]
 *
 * Defaults: schema/learning-path.schema.json → schema/generated/learning-path.generation.schema.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGenerationSchema,
  GenerationSchemaError,
  serialiseGenerationSchema,
} from "../src/schema/generation.js";

const coreDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = resolve(process.argv[2] ?? `${coreDir}/schema/learning-path.schema.json`);
const output = resolve(
  process.argv[3] ?? `${coreDir}/schema/generated/learning-path.generation.schema.json`,
);

try {
  const { schema, nullable } = buildGenerationSchema(JSON.parse(readFileSync(input, "utf8")));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, serialiseGenerationSchema(schema));
  console.log(`wrote ${output} (${nullable.length} nullable fields)`);
} catch (err) {
  if (!(err instanceof GenerationSchemaError)) throw err;
  console.error(`build:generation-schema failed: ${err.message}`);
  process.exit(1);
}
