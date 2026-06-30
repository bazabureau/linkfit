// In production the API URL must be an explicit https endpoint — fail fast
// rather than silently shipping cleartext admin JWTs to a non-existent host.
// Gated on NEXT_PHASE (set by Next ONLY during `next build`) instead of an
// env-inlined IS_BUILD_PHASE flag: an inlined flag would bake "true" into the
// runtime bundle and never re-evaluate, which is exactly how a build-phase
// shortcut can silently disable a runtime check.
if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  (!process.env.NEXT_PUBLIC_API_URL ||
    !process.env.NEXT_PUBLIC_API_URL.startsWith("https://"))
) {
  throw new Error(
    "NEXT_PUBLIC_API_URL must be an https:// URL in production (e.g. https://api.linkfit.az)",
  );
}

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8788";

/**
 * Public Linkfit web key, sent as `X-Linkfit-App-Key` on every request. The
 * Cloudflare/Laravel ApiKeyGuard rejects requests lacking a valid key with 403
 * when REQUIRE_API_KEY=true (prod). Inlined at build via NEXT_PUBLIC_*.
 */
const APP_KEY =
  process.env.NEXT_PUBLIC_LINKFIT_APP_KEY ?? process.env.NEXT_PUBLIC_API_KEY;
const APP_KEY_HEADER = "X-Linkfit-App-Key";

/**
 * The admin panel authenticates purely via the httpOnly lf_access/lf_refresh
 * cookies and NEVER reads tokens from the response body. Declaring this
 * transport makes the API strip the raw access/refresh tokens out of
 * auth-response JSON (login/refresh), so an XSS foothold cannot exfiltrate them.
 */
const AUTH_TRANSPORT_HEADER = "X-Auth-Transport";
const AUTH_TRANSPORT_VALUE = "cookie";

export class APIError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(opts: {
    code: string;
    message: string;
    status: number;
    details?: Record<string, unknown>;
  }) {
    super(opts.message);
    this.name = "APIError";
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details;
  }
}

export interface ApiRequestOptions extends RequestInit {
  /**
   * Skip the 401 -> auth-refresh -> retry loop (e.g. for /auth/login itself,
   * which has no session to refresh yet). Auth now travels via the httpOnly
   * lf_access cookie sent automatically with `credentials: "include"`, so there
   * is no Authorization header to suppress.
   */
  skipAuth?: boolean;
  /** Skip the 401-refresh retry loop. */
  skipRefresh?: boolean;
  /** Convenience: a body that will be JSON.stringified. */
  json?: unknown;
}

interface RawErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) {
    // No content — caller is expected to type T as void/undefined.
    return undefined as T;
  }
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new APIError({
      code: "invalid_json",
      message: "Server returned non-JSON response",
      status: res.status,
    });
  }
}

async function toAPIError(res: Response): Promise<APIError> {
  let body: RawErrorBody = {};
  try {
    body = (await res.json()) as RawErrorBody;
  } catch {
    /* fall through with empty body */
  }
  return new APIError({
    code: body.error?.code ?? `http_${res.status}`,
    message: body.error?.message ?? res.statusText ?? "Request failed",
    status: res.status,
    details: body.error?.details,
  });
}

function buildHeaders(init: ApiRequestOptions): Headers {
  const headers = new Headers(init.headers ?? {});
  if (init.json !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (APP_KEY && !headers.has(APP_KEY_HEADER)) {
    headers.set(APP_KEY_HEADER, APP_KEY);
  }
  if (!headers.has(AUTH_TRANSPORT_HEADER)) {
    headers.set(AUTH_TRANSPORT_HEADER, AUTH_TRANSPORT_VALUE);
  }
  return headers;
}

// Auth is carried by the httpOnly lf_access cookie (sent automatically with
// `credentials: "include"`), so these headers no longer attach a Bearer token —
// they only set Accept + the public app key. Kept for the handful of callers
// that issue raw `fetch`es (CSV export, multipart upload).
export function apiHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers ?? {});
  if (!next.has("Accept")) next.set("Accept", "application/json");
  if (APP_KEY && !next.has(APP_KEY_HEADER)) {
    next.set(APP_KEY_HEADER, APP_KEY);
  }
  if (!next.has(AUTH_TRANSPORT_HEADER)) {
    next.set(AUTH_TRANSPORT_HEADER, AUTH_TRANSPORT_VALUE);
  }
  return next;
}

let inFlightRefresh: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    try {
      // The lf_refresh cookie is sent automatically via `credentials: "include"`
      // — no body token needed. On success the API rotates and re-sets the
      // httpOnly lf_access / lf_refresh cookies, so there is nothing for JS to
      // store; we just signal that the retry can proceed.
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: "POST",
        headers: apiHeaders(),
        credentials: "include",
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Reset after a tick so simultaneous callers share the same result.
      setTimeout(() => {
        inFlightRefresh = null;
      }, 0);
    }
  })();
  return inFlightRefresh;
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  // The httpOnly auth cookies cannot be cleared from JS; the API clears them on
  // logout / refresh failure. Just bounce to the login screen.
  if (window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

export async function apiFetch<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;

  const { json, skipAuth, skipRefresh, ...init } = options;
  const body =
    json !== undefined ? JSON.stringify(json) : (init.body as BodyInit | null | undefined);

  const headers = buildHeaders({ ...options, body });

  // `credentials: "include"` ships the httpOnly lf_access cookie (same-site to
  // api.linkfit.az) so the API can authenticate the request.
  const doFetch = (): Promise<Response> =>
    fetch(url, { ...init, headers, body, credentials: "include" });

  let res = await doFetch();

  if (res.status === 401 && !skipAuth && !skipRefresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await doFetch();
      if (res.status === 401) {
        redirectToLogin();
        throw await toAPIError(res);
      }
    } else {
      redirectToLogin();
      throw await toAPIError(res);
    }
  }

  if (!res.ok) {
    throw await toAPIError(res);
  }

  return parseResponse<T>(res);
}

export const api = {
  get: <T>(path: string, init?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...init, method: "GET" }),
  post: <T>(path: string, json?: unknown, init?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...init, method: "POST", json }),
  patch: <T>(path: string, json?: unknown, init?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...init, method: "PATCH", json }),
  put: <T>(path: string, json?: unknown, init?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...init, method: "PUT", json }),
  delete: <T>(path: string, init?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...init, method: "DELETE" }),
};
