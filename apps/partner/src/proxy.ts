import { NextResponse, type NextRequest } from "next/server";

// Shared httpOnly access cookie (API-set, Domain=".linkfit.az"), readable here
// because it is sent same-site to this panel. Was the partner-specific
// "lf_admin_access" name before the shared-cookie migration.
const ACCESS_TOKEN_COOKIE = "lf_access";
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
