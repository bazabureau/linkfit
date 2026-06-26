// In production the API URL must be an explicit https endpoint — fail fast
// rather than silently shipping cleartext requests to a non-existent host.
// Gated on NEXT_PHASE (set by Next ONLY during `next build`) instead of an
// env-inlined IS_BUILD_PHASE flag: an inlined flag would bake "true" into the
// runtime bundle and never re-evaluate, which is exactly how a build-phase
// shortcut can silently disable this runtime check.
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

// Public Linkfit app key sent as X-Linkfit-App-Key on every request. This
// identifies Linkfit-owned client builds to the Cloudflare/API gate
// (ApiKeyGuard); it is NOT a private secret and never replaces user JWT auth.
const LINKFIT_APP_KEY =
  process.env.NEXT_PUBLIC_LINKFIT_APP_KEY || process.env.NEXT_PUBLIC_API_KEY;

/** Inject the public app key header if configured and not already present. */
function applyAppKey(headers: Headers): void {
  if (LINKFIT_APP_KEY && !headers.has("X-Linkfit-App-Key")) {
    headers.set("X-Linkfit-App-Key", LINKFIT_APP_KEY);
  }
}

// The app is served under a basePath (default `/owner`). Raw browser
// navigations (window.location) are NOT basePath-prefixed by Next.js, so we
// must prepend it manually to reach the real login route.
const OWNER_BASE_PATH = process.env.NEXT_PUBLIC_OWNER_BASE_PATH || "/owner";
const LOGIN_PATH = `${OWNER_BASE_PATH}/login`;

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
   * Mark this as an auth endpoint (e.g. /auth/login). Auth no longer rides on a
   * JS-attached Authorization header — the httpOnly `lf_access` cookie carries
   * it automatically — but `skipAuth` still suppresses the 401-refresh retry so
   * a login/credential check surfaces its own error instead of looping.
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
  applyAppKey(headers);
  return headers;
}

export function apiHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers ?? {});
  if (!next.has("Accept")) next.set("Accept", "application/json");
  applyAppKey(next);
  return next;
}

let inFlightRefresh: Promise<boolean> | null = null;

/**
 * Ask the API to mint a fresh access token. The refresh token is read from the
 * httpOnly `lf_refresh` cookie server-side (credentials:"include"), and the new
 * `lf_access` / `lf_refresh` cookies come back as httpOnly Set-Cookie headers —
 * nothing is read or written from JS. Resolves to whether the refresh
 * succeeded so the caller can retry the original request.
 */
async function refreshAccessToken(): Promise<boolean> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: apiHeaders(),
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
  // The auth cookies are httpOnly (API-owned) and can't be cleared from JS;
  // /auth/logout (or their TTL) clears them. We just bounce to the login route.
  if (window.location.pathname !== LOGIN_PATH) {
    window.location.assign(LOGIN_PATH);
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

  // credentials:"include" attaches the httpOnly `lf_access` cookie automatically
  // (same-site to api.linkfit.az); there is no JS-attached Authorization header.
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

/**
 * Fetch a binary/blob endpoint (e.g. CSV export) using the same auth flow as
 * apiFetch: the httpOnly access cookie rides along via credentials:"include"
 * plus the X-Linkfit-App-Key header, and it transparently refreshes + retries
 * once on a 401 so an expired access token does not cause a spurious download
 * failure while the session is still valid.
 */
export async function apiBlob(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Blob> {
  const url = path.startsWith("http")
    ? path
    : `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;

  const { json, skipAuth, skipRefresh, ...init } = options;
  const body =
    json !== undefined ? JSON.stringify(json) : (init.body as BodyInit | null | undefined);

  const headers = buildHeaders({ ...options, body });

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

  return res.blob();
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
