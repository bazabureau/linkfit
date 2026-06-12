import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  type AppError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  PreconditionFailedError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from "./AppError.js";
import { mapError } from "./errorMapper.js";

describe("AppError → http mapping", () => {
  const cases: { err: AppError; status: number; code: string }[] = [
    { err: new ValidationError(), status: 400, code: "VALIDATION_ERROR" },
    { err: new UnauthenticatedError(), status: 401, code: "UNAUTHENTICATED" },
    { err: new ForbiddenError(), status: 403, code: "FORBIDDEN" },
    { err: new NotFoundError(), status: 404, code: "NOT_FOUND" },
    { err: new ConflictError(), status: 409, code: "CONFLICT" },
    { err: new PreconditionFailedError(), status: 422, code: "PRECONDITION_FAILED" },
    { err: new RateLimitedError(), status: 429, code: "RATE_LIMITED" },
    { err: new InternalError(), status: 500, code: "INTERNAL" },
  ];

  for (const { err, status, code } of cases) {
    it(`${err.constructor.name} → ${String(status)} ${code}`, () => {
      expect(err.httpStatus).toBe(status);
      expect(err.code).toBe(code);
    });
  }

  it("preserves details when provided", () => {
    const err = new ValidationError("bad", { details: { field: "email" } });
    expect(err.toJSON().details).toEqual({ field: "email" });
  });
});

describe("mapError", () => {
  it("returns the same AppError instance unchanged", () => {
    const original = new NotFoundError("missing user");
    expect(mapError(original)).toBe(original);
  });

  it("maps a ZodError to ValidationError with issue details", () => {
    const schema = z.object({ email: z.string().email(), age: z.number().int() });
    const parsed = schema.safeParse({ email: "nope", age: "x" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const mapped = mapError(parsed.error);
    expect(mapped).toBeInstanceOf(ValidationError);
    expect(mapped.httpStatus).toBe(400);
    const details = mapped.toJSON().details as { issues: { path: string }[] };
    expect(details.issues.map((i) => i.path).sort()).toEqual(["age", "email"]);
  });

  it("falls back to InternalError for unknown throwables", () => {
    expect(mapError(new Error("boom"))).toBeInstanceOf(InternalError);
    expect(mapError("string-error")).toBeInstanceOf(InternalError);
    expect(mapError(null)).toBeInstanceOf(InternalError);
  });

  it("maps fastify-style 429 to RateLimitedError", () => {
    const fastify429 = Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 });
    expect(mapError(fastify429)).toBeInstanceOf(RateLimitedError);
  });
});
