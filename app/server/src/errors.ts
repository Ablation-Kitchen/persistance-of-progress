import type { FastifyError, FastifyInstance } from "fastify";
import {
  isDate,
  type ErrorCode,
  type ErrorResponse,
  type IssueJson as Issue,
} from "@learning-tracker/core";

/** A failure with the §8.2 envelope. Throw it from any handler. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly issues?: Issue[],
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, "not-found", `${what} not found`);

/** A real calendar date (spec §8.1). The TypeBox pattern has already checked the shape. */
export function requireDate(value: string, field: string): string {
  if (!isDate(value))
    throw new ApiError(400, "bad-request", `${field} is not a calendar date: ${value}`);
  return value;
}

export function problems(n: number): string {
  return n === 1 ? "The file has 1 problem." : `The file has ${n} problems.`;
}

/** Map every thrown error onto the §8.2 envelope. */
export function installErrorHandler(app: FastifyInstance) {
  app.setErrorHandler<FastifyError | ApiError>((err, request, reply) => {
    let body: ErrorResponse;
    let status: number;
    if (err instanceof ApiError) {
      status = err.status;
      body = {
        error: { code: err.code, message: err.message, ...(err.issues && { issues: err.issues }) },
      };
    } else if (err.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      status = 413;
      body = { error: { code: "too-large", message: "The upload is over 5 MB." } };
    } else if (
      err.validation ||
      (err.statusCode && err.statusCode >= 400 && err.statusCode < 500)
    ) {
      status = err.statusCode && err.statusCode !== 500 ? err.statusCode : 400;
      if (status === 404) body = { error: { code: "not-found", message: err.message } };
      else {
        status = 400;
        body = { error: { code: "bad-request", message: err.message } };
      }
    } else {
      request.log.error(err);
      status = 500;
      body = { error: { code: "internal", message: "Something went wrong on the server." } };
    }
    return reply.code(status).send(body);
  });
}
