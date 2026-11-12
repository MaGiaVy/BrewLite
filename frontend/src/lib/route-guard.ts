export const SESSION_ROLE_COOKIE = "brewlite_session_role";

export type SessionRole = "CUSTOMER" | "STAFF" | "ADMIN";

export type RouteAccessDecision =
  | { action: "allow" }
  | { action: "redirect"; location: string };

const AUTHENTICATED_PREFIXES = [
  "/checkout",
  "/account",
  "/orders",
  "/order-confirmation",
] as const;

const PUBLIC_PREFIXES = [
  "/login",
  "/register",
  "/auth",
  "/menu",
  "/cart",
  "/promotions",
  "/api",
  "/_next",
  "/gateway",
] as const;

function parseSessionRole(raw?: string | null): SessionRole | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "CUSTOMER" || trimmed === "STAFF" || trimmed === "ADMIN") {
    return trimmed;
  }
  return null;
}

function matchesSegmentPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Evaluate edge route access based on pathname, query string, session role cookie, and login path.
 */
export function evaluateRouteAccess(
  pathname: string,
  search = "",
  roleCookie?: string | null,
  loginPath = "/login"
): RouteAccessDecision {
  if (
    pathname === "/" ||
    matchesSegmentPrefix(pathname, loginPath) ||
    PUBLIC_PREFIXES.some((prefix) => matchesSegmentPrefix(pathname, prefix))
  ) {
    return { action: "allow" };
  }

  const normalizedSearch = search
    ? search.startsWith("?")
      ? search
      : `?${search}`
    : "";
  const loginRedirect = `${loginPath}?redirect=${encodeURIComponent(`${pathname}${normalizedSearch}`)}`;
  const role = parseSessionRole(roleCookie);

  if (matchesSegmentPrefix(pathname, "/admin")) {
    if (!role) return { action: "redirect", location: loginRedirect };
    if (role !== "ADMIN") return { action: "redirect", location: "/" };
    return { action: "allow" };
  }

  if (matchesSegmentPrefix(pathname, "/staff")) {
    if (!role) return { action: "redirect", location: loginRedirect };
    if (role !== "STAFF" && role !== "ADMIN") {
      return { action: "redirect", location: "/" };
    }
    return { action: "allow" };
  }

  if (
    AUTHENTICATED_PREFIXES.some((prefix) => matchesSegmentPrefix(pathname, prefix))
  ) {
    if (!role) return { action: "redirect", location: loginRedirect };
    return { action: "allow" };
  }

  return { action: "allow" };
}
