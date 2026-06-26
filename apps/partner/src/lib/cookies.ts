// Shared Linkfit auth cookie names.
//
// The access/refresh tokens now live in **httpOnly** cookies set by the API
// (api.linkfit.az) with Domain=".linkfit.az" in production, so they are NOT
// readable or writable from JS. These constants exist only so the Next edge
// proxy and server components can look the cookie up *by name* — the value is
// carried automatically by the browser (credentials:"include") on same-site
// requests to the API. No client-side read/write helpers remain.

export const ACCESS_TOKEN_COOKIE = "lf_access";
export const REFRESH_TOKEN_COOKIE = "lf_refresh";
