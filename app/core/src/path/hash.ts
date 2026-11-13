import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * JSON with object keys sorted recursively and no whitespace; array order is kept and
 * `undefined` properties are dropped, as `JSON.stringify` does.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** SHA-256 (lowercase hex) of the canonical JSON. Pure JS, so the browser can use it too. */
export function pathHash(path: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(path))));
}
