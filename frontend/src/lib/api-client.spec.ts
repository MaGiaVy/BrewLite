import { describe, it, expect, beforeEach, vi } from "vitest";
import { apiClient } from "./api-client";
import { useAuthStore } from "../app/store/authStore";
import { useCartStore } from "../app/store/cartStore";

describe("Task T5.1b — Frontend API Client 401 Handling (WEB-T09)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.getState().logout();
    useCartStore.getState().clearCart();
  });

  it("[WEB-T09] clears auth token, redirects to /login?redirect=..., and strictly preserves cart items on 401 Unauthorized", async () => {
    // 1. Giả lập người dùng đã đăng nhập và có 2 món trong giỏ hàng
    useAuthStore.getState().setAuth(
      {
        id: 1,
        email: "3124410414@sv.sgu.edu.vn",
        fullName: "Mã Gia Vỹ",
        phone: "0901234567",
        role: "CUSTOMER",
        loyaltyPoints: 50,
      },
      "expired_jwt_token_xyz"
    );

    useCartStore.getState().addItem({
      id: 101,
      name: "Cà Phê Sữa Đá Cầu Đất",
      price: 45000,
      quantity: 2,
      size: "M",
      temperature: "COLD",
    });

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().token).toBe("expired_jwt_token_xyz");
    expect(useCartStore.getState().cartCount()).toBe(2);

    // 2. Giả lập Backend trả về 401 Unauthorized khi gọi API đặt hàng
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 401, message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    let redirectedUrl = "";
    const res = await apiClient("/orders", {
      method: "POST",
      body: JSON.stringify({ items: [] }),
      currentPath: "/checkout",
      onUnauthorizedRedirect: (url) => {
        redirectedUrl = url;
      },
    });

    // 3. Kiểm chứng:
    // - Response trả về đúng 401
    expect(res.status).toBe(401);
    // - Token và trạng thái đăng nhập đã bị xóa sạch
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    // - Điều hướng về /login kèm tham số redirect
    expect(redirectedUrl).toBe("/login?redirect=%2Fcheckout");
    // - QUAN TRỌNG NHẤT: Giỏ hàng (cartStore) được bảo toàn nguyên vẹn 100%
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().cartCount()).toBe(2);
    expect(useCartStore.getState().cartTotal()).toBe(90000);
    expect(useCartStore.getState().items[0].name).toBe("Cà Phê Sữa Đá Cầu Đất");
  });

  it("[WEB-T09] attaches Authorization Bearer token and keeps session intact on 200 OK", async () => {
    useAuthStore.getState().setAuth(
      {
        id: 1,
        email: "3124410414@sv.sgu.edu.vn",
        fullName: "Mã Gia Vỹ",
        phone: "0901234567",
      },
      "valid_jwt_token_123"
    );

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 1, email: "3124410414@sv.sgu.edu.vn" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiClient("/auth/me");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/me"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer valid_jwt_token_123",
        }),
      })
    );
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().token).toBe("valid_jwt_token_123");
  });
});
