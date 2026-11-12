import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import VoucherModal from "./VoucherModal";
import { useAuthStore } from "../store/authStore";

describe("VoucherModal loyalty point redemption (Wave 4)", () => {
  const redeemPointsMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    redeemPointsMock.mockResolvedValue({
      success: true,
      message: "Đổi thành công",
      voucher: {
        id: 1,
        code: "BREW10",
        quantity: 1,
        discountPercent: 10,
        minOrderAmount: 0,
      },
    });

    useAuthStore.setState({
      user: {
        id: 10,
        email: "customer@brewlite.vn",
        fullName: "Khách Test",
        phone: "0901234567",
        role: "CUSTOMER",
        loyaltyPoints: 100,
        vouchers: [],
      },
      token: "test-jwt-token",
      isAuthenticated: true,
      _hasHydrated: true,
      redeemPoints: redeemPointsMock,
    });
  });

  afterEach(() => {
    cleanup();
    useAuthStore.getState().logout();
  });

  it("renders BREW10/BREW20/BREW50 at 10/20/50 points and calls redeemPoints with 10, 20, 50 (never 50/100/250)", async () => {
    const onSelectVoucher = vi.fn();
    const onRedeemSuccess = vi.fn();

    render(
      <VoucherModal
        isOpen={true}
        onClose={vi.fn()}
        vouchers={[]}
        appliedCode={null}
        subtotal={150000}
        onSelectVoucher={onSelectVoucher}
        onRemoveVoucher={vi.fn()}
        onRedeemSuccess={onRedeemSuccess}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Đổi bằng Hạt Vàng/i }));

    expect(screen.getByText("10 Hạt Vàng")).toBeInTheDocument();
    expect(screen.getByText("20 Hạt Vàng")).toBeInTheDocument();
    expect(screen.getByText("50 Hạt Vàng")).toBeInTheDocument();
    expect(screen.queryByText(/100 Hạt/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/250 Hạt/i)).not.toBeInTheDocument();

    const redeem10Btn = screen.getByRole("button", { name: "Đổi (-10 Hạt)" });
    const redeem20Btn = screen.getByRole("button", { name: "Đổi (-20 Hạt)" });
    const redeem50Btn = screen.getByRole("button", { name: "Đổi (-50 Hạt)" });

    fireEvent.click(redeem10Btn);
    await waitFor(() => {
      expect(redeemPointsMock).toHaveBeenNthCalledWith(
        1,
        10,
        expect.stringContaining("BREW10"),
        expect.objectContaining({ code: "BREW10", discountPercent: 10 })
      );
    });

    fireEvent.click(redeem20Btn);
    await waitFor(() => {
      expect(redeemPointsMock).toHaveBeenNthCalledWith(
        2,
        20,
        expect.stringContaining("BREW20"),
        expect.objectContaining({ code: "BREW20", discountPercent: 20 })
      );
    });

    fireEvent.click(redeem50Btn);
    await waitFor(() => {
      expect(redeemPointsMock).toHaveBeenNthCalledWith(
        3,
        50,
        expect.stringContaining("BREW50"),
        expect.objectContaining({ code: "BREW50", discountPercent: 50 })
      );
    });

    const calledPoints = redeemPointsMock.mock.calls.map((call) => call[0]);
    expect(calledPoints).toEqual([10, 20, 50]);
    expect(calledPoints).not.toContain(100);
    expect(calledPoints).not.toContain(250);
  });
});
