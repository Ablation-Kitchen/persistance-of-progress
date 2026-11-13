import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { HealthResponse } from "./health.js";

describe("HealthResponse", () => {
  it("accepts the scaffold's health body", () => {
    expect(Value.Check(HealthResponse, { ok: true, dbVersion: 0 })).toBe(true);
  });

  it("rejects ok: false and missing dbVersion", () => {
    expect(Value.Check(HealthResponse, { ok: false, dbVersion: 0 })).toBe(false);
    expect(Value.Check(HealthResponse, { ok: true })).toBe(false);
  });
});
