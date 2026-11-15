import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { useAuthStore } from "./authStore";
import EditProfileModal from "../components/EditProfileModal";

describe("authStore.redeemPoints DTO whitelist & EditProfileModal timer safety", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({
      user: {
        id: 1,
        email: "customer@brewlite.vn",
        fullName: "Khách Test",
        phone: "0901234567",
        role: "CUSTOMER",
        loyaltyPoints: 100,
        vouchers: [],
      },
      token: "jwt-token",
      isAuthenticated: true,
      _hasHydrated: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    useAuthStore.getState().logout();
  });

  it("sends only whitelisted RedeemPointsDto keys (no discountPercent or minOrderAmount)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          message: "Đổi thành công",
          loyaltyPoints: 90,
          vouchers: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const res = await useAuthStore.getState().redeemPoints(10, "Đổi BREW10", {
      code: "BREW10",
      discountPercent: 10,
      minOrderAmount: 0,
    });

    expect(res.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const parsedBody = JSON.parse(String(init?.body));
    expect(parsedBody).toEqual({
      points: 10,
      description: "Đổi BREW10",
      voucherCode: "BREW10",
    });
    expect("discountPercent" in parsedBody).toBe(false);
    expect("minOrderAmount" in parsedBody).toBe(false);
  });

  it("clears EditProfileModal auto-close timeout when unmounted before 900ms", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: 1,
            email: "customer@brewlite.vn",
            fullName: "Khách Updated",
            phone: "0901234567",
            role: "CUSTOMER",
            loyaltyPoints: 100,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { unmount } = render(
      <EditProfileModal isOpen={true} onClose={onClose} />
    );

    const submitBtn = screen.getByRole("button", { name: /Lưu thay đổi/i });
    await act(async () => {
      fireEvent.submit(submitBtn.closest("form")!);
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
