/**
 * BrewLite — Zustand Auth Store (Task 7 + Sprint 4 RBAC)
 * Quản lý trạng thái xác thực người dùng, persist vào localStorage.
 * Pattern đồng bộ với cartStore.ts (Task 5).
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { SESSION_ROLE_COOKIE } from "../../lib/route-guard";

function syncSessionRoleCookie(role?: UserRole | string | null): void {
  if (typeof document === "undefined") return;
  if (role === "CUSTOMER" || role === "STAFF" || role === "ADMIN") {
    document.cookie = `${SESSION_ROLE_COOKIE}=${role}; Path=/; SameSite=Lax; Max-Age=86400`;
    return;
  }
  document.cookie = `${SESSION_ROLE_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
}

function clearSessionRoleCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SESSION_ROLE_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
}

function syncCookieFromAuthState(
  state?: { isAuthenticated?: boolean; token?: string | null; user?: AuthUser | null } | null
): void {
  if (state?.isAuthenticated && state.token && state.user) {
    syncSessionRoleCookie(state.user.role ?? "CUSTOMER");
    return;
  }
  clearSessionRoleCookie();
}

export type UserRole = "CUSTOMER" | "STAFF" | "ADMIN";

export interface UserVoucherItem {
  id?: number;
  code: string;
  quantity: number;
  discountPercent: number;
  minOrderAmount: number;
  maxDiscountAmount?: number | null;
}

export interface AuthUser {
  id: number;
  email: string;
  fullName: string | null;
  phone: string | null;
  role?: UserRole;
  loyaltyPoints?: number;
  vouchers?: UserVoucherItem[];
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  _hasHydrated: boolean;

  // ── Actions ────────────────────────────────────────────────────────────────
  setAuth: (user: AuthUser, token: string) => void;
  logout: () => void;
  setHasHydrated: (state: boolean) => void;
  refreshProfile: () => Promise<void>;
  redeemPoints: (
    points: number,
    description?: string,
    voucherData?: { code: string; discountPercent: number; minOrderAmount?: number }
  ) => Promise<{ success: boolean; message: string; voucher?: UserVoucherItem; vouchers?: UserVoucherItem[] }>;
}

export const ACTIVE_PENDING_ORDER_KEY = "brewlite_active_pending_order";

export interface ActivePendingOrderRecord {
  orderId: number;
  userId: number | null;
}

/** Parse active pending order from either JSON `{ orderId, userId }` or legacy numeric string. */
export function parseActivePendingOrderRaw(raw: string | null): ActivePendingOrderRecord | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const orderId = Number(trimmed);
    return Number.isInteger(orderId) && orderId > 0 ? { orderId, userId: null } : null;
  }
  try {
    const parsed = JSON.parse(trimmed) as { orderId?: unknown; userId?: unknown };
    const orderId = Number(parsed?.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) return null;
    const rawUserId = parsed?.userId;
    const userId =
      typeof rawUserId === "number" && Number.isInteger(rawUserId) && rawUserId > 0
        ? rawUserId
        : null;
    return { orderId, userId };
  } catch {
    return null;
  }
}

/** Read the stored active pending order from sessionStorage or localStorage. */
export function readActivePendingOrder(): ActivePendingOrderRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.sessionStorage?.getItem(ACTIVE_PENDING_ORDER_KEY) ||
      window.localStorage?.getItem(ACTIVE_PENDING_ORDER_KEY) ||
      null;
    return parseActivePendingOrderRaw(raw);
  } catch {
    return null;
  }
}

/** Persist the active pending order bound to the creating userId. */
export function writeActivePendingOrder(orderId: number, userId?: number | null): void {
  if (typeof window === "undefined" || !Number.isInteger(orderId) || orderId <= 0) return;
  try {
    const payload = JSON.stringify({
      orderId,
      userId: typeof userId === "number" && Number.isInteger(userId) && userId > 0 ? userId : null,
    });
    window.sessionStorage?.setItem(ACTIVE_PENDING_ORDER_KEY, payload);
  } catch {
    // ignore storage errors
  }
}

/** Clear stored active pending order unconditionally or when matching specific order ID(s). */
export function clearActivePendingOrder(matchingOrderIds?: number | number[]): void {
  if (typeof window === "undefined") return;
  const ids =
    matchingOrderIds === undefined
      ? null
      : Array.isArray(matchingOrderIds)
        ? matchingOrderIds
        : [matchingOrderIds];
  try {
    if (!ids) {
      window.sessionStorage?.removeItem(ACTIVE_PENDING_ORDER_KEY);
      window.localStorage?.removeItem(ACTIVE_PENDING_ORDER_KEY);
      return;
    }
    const ssRec = parseActivePendingOrderRaw(
      window.sessionStorage?.getItem(ACTIVE_PENDING_ORDER_KEY) ?? null
    );
    if (ssRec && ids.includes(ssRec.orderId)) {
      window.sessionStorage?.removeItem(ACTIVE_PENDING_ORDER_KEY);
    }
    const lsRec = parseActivePendingOrderRaw(
      window.localStorage?.getItem(ACTIVE_PENDING_ORDER_KEY) ?? null
    );
    if (lsRec && ids.includes(lsRec.orderId)) {
      window.localStorage?.removeItem(ACTIVE_PENDING_ORDER_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      _hasHydrated: false,

      setAuth: (user, token) =>
        {
          syncSessionRoleCookie(user?.role ?? "CUSTOMER");
          set({ user, token, isAuthenticated: true });
        },

      logout: () => {
        clearSessionRoleCookie();
        clearActivePendingOrder();
        set({ user: null, token: null, isAuthenticated: false });
      },

      setHasHydrated: (state) => {
        set({ _hasHydrated: state });
        if (state) {
          syncCookieFromAuthState(get());
        }
      },

      refreshProfile: async () => {
        const token = get().token;
        if (!token) {
          clearSessionRoleCookie();
          return;
        }
        try {
          const res = await apiFetch("/auth/me");
          if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
              get().logout();
            } else {
              clearSessionRoleCookie();
            }
            return;
          }
          if (res.ok) {
            const data = await res.json();
            set((state) => ({
              user: (() => {
                const nextUser = state.user ? { ...state.user, ...data } : data;
                syncSessionRoleCookie(nextUser?.role ?? "CUSTOMER");
                return nextUser;
              })(),
            }));
          }
        } catch {
          // ignore network error
        }
      },

      redeemPoints: async (
        points: number,
        description?: string,
        voucherData?: { code: string; discountPercent: number; minOrderAmount?: number }
      ) => {
        const token = get().token;
        if (!token) return { success: false, message: "Vui lòng đăng nhập để đổi quà" };
        try {
          const res = await apiFetch("/auth/redeem-points", {
            method: "POST",
            body: JSON.stringify({
              points,
              description,
              voucherCode: voucherData?.code,
              discountPercent: voucherData?.discountPercent,
              minOrderAmount: voucherData?.minOrderAmount,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            return { success: false, message: data.message || "Đổi điểm thất bại" };
          }

          if (data.user) {
            set((state) => ({
              user: state.user ? { ...state.user, ...data.user } : data.user,
            }));
          } else {
            // Client accumulation fallback
            set((state) => {
              if (!state.user) return state;
              const prevVouchers = [...(state.user.vouchers || [])];
              if (voucherData) {
                const idx = prevVouchers.findIndex((v) => v.code === voucherData.code);
                if (idx >= 0) {
                  prevVouchers[idx] = {
                    ...prevVouchers[idx],
                    quantity: (prevVouchers[idx].quantity || 1) + 1,
                  };
                } else {
                  prevVouchers.push({
                    code: voucherData.code,
                    quantity: 1,
                    discountPercent: voucherData.discountPercent,
                    minOrderAmount: voucherData.minOrderAmount || 0,
                  });
                }
              }
              return {
                user: {
                  ...state.user,
                  loyaltyPoints: typeof data.remainingPoints === "number"
                    ? data.remainingPoints
                    : Math.max(0, (state.user.loyaltyPoints || 0) - points),
                  vouchers: data.vouchers || prevVouchers,
                },
              };
            });
          }

          return {
            success: true,
            message: data.message || "Đổi điểm thành công!",
            voucher: data.voucher,
            vouchers: data.vouchers,
          };
        } catch {
          return { success: false, message: "Lỗi kết nối máy chủ" };
        }
      },
    }),
    {
      name: "brewlite-auth",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? localStorage : sessionStorage
      ),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        syncCookieFromAuthState(state);
      },
    }
  )
);

// ─── API helper với Bearer Token ─────────────────────────────────────────────

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Gọi API Backend với Authorization header tự động */
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    useAuthStore.getState().logout();
    if (typeof window !== "undefined") {
      const currentPath = `${window.location.pathname}${window.location.search || ""}`;
      if (!window.location.pathname.startsWith("/login")) {
        try {
          window.location.assign(
            new URL(
              `/login?redirect=${encodeURIComponent(currentPath || "/checkout")}`,
              window.location.origin
            ).toString()
          );
        } catch {
          // ignore in test environment
        }
      }
    }
  }
  return res;
}
