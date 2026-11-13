/// <reference types="node" />
/**
 * Test-only stand-in for `node:sqlite`. It is a prefix-only built-in, missing from Node's
 * `builtinModules`, so Vite would try to bundle it for the jsdom tests. Loading it through
 * `require` keeps it native.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sqlite = require("node:sqlite") as typeof import("node:sqlite");

export const DatabaseSync = sqlite.DatabaseSync;
export type DatabaseSync = import("node:sqlite").DatabaseSync;
