import { NextRequest, NextResponse } from "next/server";
import { evaluateRouteAccess, SESSION_ROLE_COOKIE } from "./lib/route-guard";

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  const roleCookie = req.cookies.get(SESSION_ROLE_COOKIE)?.value;
  const decision = evaluateRouteAccess(pathname, search, roleCookie, "/login");

  if (decision.action === "redirect") {
    return NextResponse.redirect(new URL(decision.location, req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/staff/:path*",
    "/checkout/:path*",
    "/account/:path*",
    "/orders/:path*",
    "/order-confirmation/:path*",
  ],
};
