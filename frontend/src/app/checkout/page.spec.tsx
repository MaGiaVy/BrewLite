import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const pushMock = vi.fn();
const replaceMock = vi.fn();
let currentOrderIdParam = "101";

const routerMock = {
  push: pushMock,
  replace: replaceMock,
  prefetch: vi.fn(),
};

const searchParamsMock = {
  get: (key: string) => (key === "orderId" ? currentOrderIdParam : null),
};

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  useSearchParams: () => searchParamsMock,
}));

vi.mock("../components/Header", () => ({
  default: () => <div data-testid="header-stub" />,
}));

vi.mock("../components/Footer", () => ({
  default: () => <div data-testid="footer-stub" />,
}));

const apiFetchMock = vi.fn();

vi.mock("../store/authStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store/authStore")>();
  return {
    ...actual,
    apiFetch: (...args: Parameters<typeof actual.apiFetch>) => apiFetchMock(...args),
  };
});

import CheckoutPage from "./page";
import { useAuthStore } from "../store/authStore";
import { useCartStore } from "../store/cartStore";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CheckoutPage payment & 0đ / VAT behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentOrderIdParam = "101";
    useAuthStore.setState({
      user: {
        id: 1,
        email: "customer@brewlite.vn",
        fullName: "Khách Test",
        phone: "0901234567",
        role: "CUSTOMER",
        loyaltyPoints: 50,
        vouchers: [],
      },
      token: "test-token",
      isAuthenticated: true,
      _hasHydrated: true,
    });
    useCartStore.setState({ items: [], appliedPromo: null });
  });

  afterEach(() => {
    cleanup();
    useAuthStore.getState().logout();
  });

  it("bypasses /payments/zalopay/create and settles 0đ free-voucher orders directly", async () => {
    apiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/orders/101") {
        return jsonResponse({
          id: 101,
          status: "PENDING",
          totalAmount: 0,
          discountCode: "FREE100",
          discountAmount: 45000,
          createdAt: new Date().toISOString(),
          items: [
            {
              id: 1,
              productId: 1,
              productName: "Cà phê Sữa",
              size: "M",
              toppings: [],
              quantity: 1,
              unitPrice: 45000,
            },
          ],
        });
      }
      if (path === "/payments" && init?.method === "POST") {
        return jsonResponse({ success: true, orderId: 101, status: "PAID" });
      }
      throw new Error(`Unexpected apiFetch call: ${path}`);
    });

    render(<CheckoutPage />);

    const confirmBtn = await screen.findByRole("button", {
      name: /Xác nhận đơn miễn phí • 0đ/i,
    });
    expect(confirmBtn).not.toBeDisabled();

    // Must never invoke ZaloPay create for 0đ orders
    expect(
      apiFetchMock.mock.calls.some(([path]) => path === "/payments/zalopay/create")
    ).toBe(false);
    expect(screen.queryByText(/Thuế VAT \(8%\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\(đã làm tròn\)/i)).not.toBeInTheDocument();

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/payments",
        expect.objectContaining({ method: "POST" })
      );
      expect(pushMock).toHaveBeenCalledWith("/order-confirmation?orderId=101");
    });

    expect(
      pushMock.mock.calls.some(([url]) => String(url).includes("/gateway/zalopay"))
    ).toBe(false);
  });

  it("surfaces real /payments/zalopay/create error and never redirects to /gateway/zalopay", async () => {
    currentOrderIdParam = "102";

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/orders/102") {
        return jsonResponse({
          id: 102,
          status: "PENDING",
          totalAmount: 45500,
          discountCode: null,
          discountAmount: 0,
          createdAt: new Date().toISOString(),
          items: [
            {
              id: 2,
              productId: 2,
              productName: "Latte",
              size: "M",
              toppings: [],
              quantity: 1,
              unitPrice: 45500,
            },
          ],
        });
      }
      if (path === "/payments/zalopay/create") {
        return jsonResponse(
          { message: "ZaloPay sandbox key chưa được cấu hình trên máy chủ" },
          502
        );
      }
      return jsonResponse({});
    });

    render(<CheckoutPage />);

    expect(
      await screen.findByText(/ZaloPay sandbox key chưa được cấu hình trên máy chủ/i)
    ).toBeInTheDocument();

    // Verify 0% VAT / no floor rounding in order summary
    expect(screen.queryByText(/Thuế VAT \(8%\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\(đã làm tròn\)/i)).not.toBeInTheDocument();

    const confirmBtn = document.getElementById("confirmPaymentBtn") as HTMLButtonElement;
    expect(confirmBtn).toBeDisabled();
    expect(
      pushMock.mock.calls.some(([url]) => String(url).includes("/gateway/zalopay"))
    ).toBe(false);
  });
});
