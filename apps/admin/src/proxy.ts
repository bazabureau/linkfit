import { NextResponse, type NextRequest } from "next/server";

// Edge proxy (Next.js 16 renamed the `middleware` file convention to `proxy`).
// Loaded from `src/proxy.ts` exporting `proxy`. Redirects requests without an
// admin access cookie to /login — defense-in-depth on top of the server-side
// 401s the API already enforces.
//
// Note: Next strips the configured basePath ("/admin") from
// `req.nextUrl.pathname`, so paths here are basePath-relative ("/login",
// "/_next", …) — do NOT prefix them with "/admin". The compiled
// `middleware-manifest.json` matchers carry the "/admin" prefix Next adds.

const ACCESS_TOKEN_COOKIE = "lf_admin_access";
const PUBLIC_PATHS = ["/login"];

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Allow Next internals + static assets + public auth pages through untouched.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/brand") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
