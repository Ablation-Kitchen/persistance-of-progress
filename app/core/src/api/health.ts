import { Type, type Static } from "typebox";

/** `GET /api/health` (spec §8.3). `dbVersion` is the SQLite `user_version`; 0 until ticket 05. */
export const HealthResponse = Type.Object({
  ok: Type.Literal(true),
  dbVersion: Type.Integer({ minimum: 0 }),
});
export type HealthResponse = Static<typeof HealthResponse>;
