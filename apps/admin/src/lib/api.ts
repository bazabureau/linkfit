import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  deleteCookie,
  getCookie,
  setCookie,
} from "./cookies";

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

const ACCESS_TTL_FALLBACK_SECONDS = 60 * 60; // 1h — overwritten by API response.
const REFRESH_TTL_SECONDS = 60 * 60 * 24; // 1d, matches API refresh lifetime.

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
  /** Skip the automatic Authorization header (e.g. for /auth/login itself). */
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

interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  access_token_expires_in_seconds: number;
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

function buildHeaders(
  init: ApiRequestOptions,
  accessToken: string | null,
): Headers {
  const headers = new Headers(init.headers ?? {});
  if (init.json !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!init.skipAuth && accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (APP_KEY && !headers.has(APP_KEY_HEADER)) {
    headers.set(APP_KEY_HEADER, APP_KEY);
  }
  return headers;
}

export function apiHeaders(
  headers?: HeadersInit,
  accessToken?: string | null,
): Headers {
  const next = new Headers(headers ?? {});
  if (accessToken && !next.has("Authorization")) {
    next.set("Authorization", `Bearer ${accessToken}`);
  }
  if (!next.has("Accept")) next.set("Accept", "application/json");
  if (APP_KEY && !next.has(APP_KEY_HEADER)) {
    next.set(APP_KEY_HEADER, APP_KEY);
  }
  return next;
}

let inFlightRefresh: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    const refresh = getCookie(REFRESH_TOKEN_COOKIE);
    if (!refresh) return null;
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: "POST",
        headers: apiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as RefreshResponse;
      setCookie(
        ACCESS_TOKEN_COOKIE,
        body.access_token,
        body.access_token_expires_in_seconds ?? ACCESS_TTL_FALLBACK_SECONDS,
      );
      setCookie(REFRESH_TOKEN_COOKIE, body.refresh_token, REFRESH_TTL_SECONDS);
      return body.access_token;
    } catch {
      return null;
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
  deleteCookie(ACCESS_TOKEN_COOKIE);
  deleteCookie(REFRESH_TOKEN_COOKIE);
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

  const accessToken = getCookie(ACCESS_TOKEN_COOKIE);
  const headers = buildHeaders({ ...options, body }, accessToken);

  const doFetch = (token: string | null): Promise<Response> => {
    const h = new Headers(headers);
    if (!skipAuth && token) h.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers: h, body });
  };

  let res = await doFetch(accessToken);

  if (res.status === 401 && !skipAuth && !skipRefresh) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await doFetch(newToken);
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
