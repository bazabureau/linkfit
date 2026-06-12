import { type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import {
  AppError,
  InternalError,
  RateLimitedError,
  ValidationError,
  type ErrorCode,
} from "./AppError.js";

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    request_id?: string;
  };
}

function buildEnvelope(err: AppError, requestId: string | undefined): ErrorEnvelope {
  const body = err.toJSON();
  const envelope: ErrorEnvelope = { error: { code: body.code, message: body.message } };
  if (body.details !== undefined) {
    envelope.error.details = body.details;
  }
  if (requestId !== undefined) {
    envelope.error.request_id = requestId;
  }
  return envelope;
}

function fromZod(err: ZodError): ValidationError {
  return new ValidationError("Request validation failed", {
    details: {
      issues: err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
        code: i.code,
      })),
    },
  });
}

function fromFastifyError(err: FastifyError): AppError | null {
  if (err.statusCode === 429) {
    return new RateLimitedError(err.message);
  }
  if (err.validation && err.validation.length > 0) {
    return new ValidationError("Request validation failed", {
      details: { issues: err.validation },
    });
  }
  if (err.statusCode !== undefined && err.statusCode >= 400 && err.statusCode < 500) {
    return new ValidationError(err.message);
  }
  return null;
}

export function mapError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return fromZod(err);

  if (err !== null && typeof err === "object" && "statusCode" in err) {
    const mapped = fromFastifyError(err as FastifyError);
    if (mapped) return mapped;
  }

  return new InternalError("Internal server error", { cause: err });
}

export async function fastifyErrorHandler(
  err: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const appErr = mapError(err);

  if (appErr.httpStatus >= 500) {
    req.log.error({ err, code: appErr.code }, appErr.message);
  } else {
    req.log.warn({ code: appErr.code, message: appErr.message }, "request rejected");
  }

  const requestId = typeof req.id === "string" ? req.id : undefined;
  await reply.status(appErr.httpStatus).send(buildEnvelope(appErr, requestId));
}
