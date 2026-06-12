import pino, { type Logger, type LoggerOptions } from "pino";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { type Env } from "../config/env.js";

/**
 * Resolve `apps/api/package.json` once at module load. We can't `import`
 * the JSON directly because the project compiles with `"resolveJsonModule"`
 * off, and we don't want the build step to copy `package.json` into `dist`
 * either. `readFileSync` against a path resolved from `import.meta.url`
 * works in both dev (tsx) and built (node dist/) layouts.
 */
function resolveServiceVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // src/shared/logging/ → src/shared/ → src/ → api/ (4 hops up)
    const pkgPath = join(here, "..", "..", "..", "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // Fall through to the literal fallback. We never want logger
    // bootstrapping to crash boot — the alternative is debug-by-vibe.
  }
  return "unknown";
}

const SERVICE_VERSION = resolveServiceVersion();

export const REDACTION_PATHS = [
  "password",
  "password_hash",
  "passwordHash",
  "token",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "authorization",
  "Authorization",
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "*.password",
  "*.password_hash",
  "*.token",
  "*.refresh_token",
  "*.access_token",
];

export function createLogger(env: Pick<Env, "LOG_LEVEL" | "NODE_ENV">): Logger {
  const options: LoggerOptions = {
    level: env.LOG_LEVEL,
    base: {
      service: "linkfit-api",
      env: env.NODE_ENV,
      version: SERVICE_VERSION,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: REDACTION_PATHS,
      censor: "[REDACTED]",
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (env.NODE_ENV === "development") {
    return pino({
      ...options,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          singleLine: false,
          ignore: "pid,hostname,service,env,version",
        },
      },
    });
  }

  return pino(options);
}
