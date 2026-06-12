export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SLOT_CONFLICT"
  | "PRECONDITION_FAILED"
  | "RATE_LIMITED"
  | "INTERNAL";

export interface AppErrorOptions {
  details?: Record<string, unknown>;
  cause?: unknown;
}

export abstract class AppError extends Error {
  public readonly details?: Record<string, unknown>;
  public abstract readonly code: ErrorCode;
  public abstract readonly httpStatus: number;

  protected constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }

  public toJSON(): { code: ErrorCode; message: string; details?: Record<string, unknown> } {
    const base: { code: ErrorCode; message: string; details?: Record<string, unknown> } = {
      code: this.code,
      message: this.message,
    };
    if (this.details !== undefined) {
      base.details = this.details;
    }
    return base;
  }
}

export class ValidationError extends AppError {
  public readonly code = "VALIDATION_ERROR" as const;
  public readonly httpStatus = 400;
  constructor(message = "Validation failed", options: AppErrorOptions = {}) {
    super(message, options);
  }
}

export class UnauthenticatedError extends AppError {
  public readonly code = "UNAUTHENTICATED" as const;
  public readonly httpStatus = 401;
  constructor(message = "Authentication required", options: AppErrorOptions = {}) {
    super(message, options);
  }
}

export class ForbiddenError extends AppError {
  public readonly code = "FORBIDDEN" as const;
  public readonly httpStatus = 403;
  constructor(message = "You do not have access to this resource", options: AppErrorOptions = {}) {
    super(message, options);
  }
}

export class NotFoundError extends AppError {
  public readonly code = "NOT_FOUND" as const;
  public readonly httpStatus = 404;
  constructor(message = "Resource not found", options: AppErrorOptions = {}) {
    super(message, options);
  }
}

export class ConflictError extends AppError {
  public readonly code = "CONFLICT" as const;
  public readonly httpStatus = 409;
  constructor(message = "Conflict with current state", options: AppErrorOptions = {}) {
    super(message, options);
  }
}

/**
 * Specialised 409 for court-booking overlaps. Distinct from the generic
 * `CONFLICT` code so clients can branch on it mechanically — the iOS booking
 * grid shows a "slot just got taken, pick another time" sheet for this code
 * instead of the generic conflict toast.
 */
export class SlotConflictError extends AppError {
  public readonly code = "SLOT_CONFLICT" as const;
  public readonly httpStatus = 409;
  constructor(
    message = "The requested time slot is already booked",
    options: AppErrorOptions = {},
  ) {
    super(message, options);
  }
}

export class PreconditionFailedError extends AppError {
  public readonly code = "PRECONDITION_FAILED" as const;
  public readonly httpStatus = 422;
  constructor(message = "Precondition failed", options: AppErrorOptions = {}) {
    super(message, options);
  }
}

export class RateLimitedError extends AppError {
  public readonly code = "RATE_LIMITED" as const;
  public readonly httpStatus = 429;
  constructor(message = "Too many requests", options: AppErrorOptions = {}) {
    super(message, options);
  }
}

export class InternalError extends AppError {
  public readonly code = "INTERNAL" as const;
  public readonly httpStatus = 500;
  constructor(message = "Internal server error", options: AppErrorOptions = {}) {
    super(message, options);
  }
}
