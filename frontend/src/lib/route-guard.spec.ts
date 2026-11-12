import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { evaluateRouteAccess, SESSION_ROLE_COOKIE } from "./route-guard";
import { middleware } from "../middleware";
import { useAuthStore } from "../app/store/authStore";

function clearRoleCookie() {
  document.cookie = `${SESSION_ROLE_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
}

describe("Route Guard & Edge Middleware (As1)", () => {
  describe("evaluateRouteAccess", () => {
    it("redirects unauthenticated /admin requests to /login with encoded redirect", () => {
      expect(evaluateRouteAccess("/admin", "", undefined, "/login")).toEqual({
        action: "redirect",
        location: "/login?redirect=%2Fadmin",
      });
      expect(evaluateRouteAccess("/admin/orders", "?tab=pending", "", "/login")).toEqual({
        action: "redirect",
        location: "/login?redirect=%2Fadmin%2Forders%3Ftab%3Dpending",
      });
    });

    it("redirects non-ADMIN roles on /admin to / and allows ADMIN", () => {
      expect(evaluateRouteAccess("/admin", "", "CUSTOMER", "/login")).toEqual({
        action: "redirect",
        location: "/",
      });
      expect(evaluateRouteAccess("/admin/inventory", "", "STAFF", "/login")).toEqual({
        action: "redirect",
        location: "/",
      });
      expect(evaluateRouteAccess("/admin", "", "ADMIN", "/login")).toEqual({
        action: "allow",
      });
    });

    it("enforces STAFF or ADMIN on /staff*", () => {
      expect(evaluateRouteAccess("/staff", "", null, "/login")).toEqual({
        action: "redirect",
        location: "/login?redirect=%2Fstaff",
      });
      expect(evaluateRouteAccess("/staff/kds", "", "CUSTOMER", "/login")).toEqual({
        action: "redirect",
        location: "/",
      });
      expect(evaluateRouteAccess("/staff", "", "STAFF", "/login")).toEqual({
        action: "allow",
      });
      expect(evaluateRouteAccess("/staff/kds", "", "ADMIN", "/login")).toEqual({
        action: "allow",
      });
    });

    it("requires valid session role on /checkout, /account, /orders, /order-confirmation", () => {
      const protectedPaths = [
        "/checkout",
        "/checkout/payment",
        "/account",
        "/account/profile",
        "/orders",
        "/orders/42",
        "/order-confirmation",
        "/order-confirmation/42",
      ];

      for (const path of protectedPaths) {
        expect(evaluateRouteAccess(path, "", undefined, "/login")).toEqual({
          action: "redirect",
          location: `/login?redirect=${encodeURIComponent(path)}`,
        });
        expect(evaluateRouteAccess(path, "", "INVALID_ROLE", "/login")).toEqual({
          action: "redirect",
          location: `/login?redirect=${encodeURIComponent(path)}`,
        });
        expect(evaluateRouteAccess(path, "", "CUSTOMER", "/login")).toEqual({
          action: "allow",
        });
        expect(evaluateRouteAccess(path, "", "STAFF", "/login")).toEqual({
          action: "allow",
        });
        expect(evaluateRouteAccess(path, "", "ADMIN", "/login")).toEqual({
          action: "allow",
        });
      }
    });

    it("allows public routes without redirect loops even when unauthenticated", () => {
      const publicPaths = [
        "/",
        "/menu",
        "/menu/101",
        "/cart",
        "/login",
        "/auth/login",
        "/auth/register",
        "/promotions",
        "/api/health",
        "/_next/static/chunk.js",
        "/gateway/mock",
      ];

      for (const path of publicPaths) {
        expect(evaluateRouteAccess(path, "", undefined, "/login")).toEqual({
          action: "allow",
        });
      }
    });
  });

  describe("Next.js Edge middleware", () => {
    it("redirects unauthenticated /admin request to /login?redirect=%2Fadmin", () => {
      const req = new NextRequest("http://localhost:3000/admin?view=kpis");
      const res = middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(
        "http://localhost:3000/login?redirect=%2Fadmin%3Fview%3Dkpis"
      );
    });

    it("redirects CUSTOMER on /staff to /", () => {
      const req = new NextRequest("http://localhost:3000/staff", {
        headers: { cookie: `${SESSION_ROLE_COOKIE}=CUSTOMER` },
      });
      const res = middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/");
    });

    it("allows ADMIN on /admin and passes /login cleanly", () => {
      const adminReq = new NextRequest("http://localhost:3000/admin", {
        headers: { cookie: `${SESSION_ROLE_COOKIE}=ADMIN` },
      });
      const adminRes = middleware(adminReq);
      expect(adminRes.headers.get("location")).toBeNull();
      expect(adminRes.headers.get("x-middleware-next")).toBe("1");

      const loginReq = new NextRequest("http://localhost:3000/login");
      const loginRes = middleware(loginReq);
      expect(loginRes.headers.get("location")).toBeNull();
      expect(loginRes.headers.get("x-middleware-next")).toBe("1");
    });
  });

  describe("authStore brewlite_session_role cookie sync", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      clearRoleCookie();
      useAuthStore.getState().logout();
    });

    it("sets brewlite_session_role on setAuth and clears it on logout", () => {
      useAuthStore.getState().setAuth(
        {
          id: 1,
          email: "admin@brewlite.vn",
          fullName: "Admin",
          phone: null,
          role: "ADMIN",
        },
        "jwt-token"
      );
      expect(document.cookie).toContain(`${SESSION_ROLE_COOKIE}=ADMIN`);

      useAuthStore.getState().logout();
      expect(document.cookie).not.toContain(`${SESSION_ROLE_COOKIE}=ADMIN`);
    });

    it("syncs cookie on hydration when authenticated and clears when unauthenticated", () => {
      useAuthStore.setState({
        user: {
          id: 2,
          email: "staff@brewlite.vn",
          fullName: "Barista",
          phone: null,
          role: "STAFF",
        },
        token: "valid-token",
        isAuthenticated: true,
        _hasHydrated: false,
      });
      clearRoleCookie();
      useAuthStore.getState().setHasHydrated(true);
      expect(document.cookie).toContain(`${SESSION_ROLE_COOKIE}=STAFF`);

      useAuthStore.setState({
        user: null,
        token: null,
        isAuthenticated: false,
        _hasHydrated: false,
      });
      useAuthStore.getState().setHasHydrated(true);
      expect(document.cookie).not.toContain(`${SESSION_ROLE_COOKIE}=STAFF`);
    });

    it("clears brewlite_session_role when refreshProfile receives non-OK response", async () => {
      useAuthStore.getState().setAuth(
        {
          id: 3,
          email: "cust@brewlite.vn",
          fullName: "Customer",
          phone: null,
          role: "CUSTOMER",
        },
        "token-123"
      );
      expect(document.cookie).toContain(`${SESSION_ROLE_COOKIE}=CUSTOMER`);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 })
        )
      );

      await useAuthStore.getState().refreshProfile();
      expect(document.cookie).not.toContain(`${SESSION_ROLE_COOKIE}=CUSTOMER`);
    });
  });
});
