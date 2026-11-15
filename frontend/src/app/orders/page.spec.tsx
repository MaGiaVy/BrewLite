import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const pushMock = vi.fn();
const routerMock = {
  push: pushMock,
  replace: vi.fn(),
  prefetch: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
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

import OrdersPage from "./page";
import { useAuthStore } from "../store/authStore";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OrdersPage customer cancel rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: {
        id: 1,
        email: "customer@brewlite.vn",
        fullName: "Khách Test",
        phone: "0901234567",
        role: "CUSTOMER",
        loyaltyPoints: 20,
        vouchers: [],
      },
      token: "test-token",
      isAuthenticated: true,
      _hasHydrated: true,
    });
  });

  afterEach(() => {
    cleanup();
    useAuthStore.getState().logout();
  });

  it("shows Hủy đơn only for non-expired PENDING and PAYMENT_FAILED orders, never for PAID", async () => {
    const nowIso = new Date().toISOString();
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/orders/me") {
        return jsonResponse([
          {
            id: 201,
            status: "PENDING",
            totalAmount: 45000,
            createdAt: nowIso,
            updatedAt: nowIso,
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
            payments: [],
          },
          {
            id: 202,
            status: "PAYMENT_FAILED",
            totalAmount: 39000,
            createdAt: nowIso,
            updatedAt: nowIso,
            items: [
              {
                id: 2,
                productId: 3,
                productName: "Pain au Chocolat",
                size: "ALL",
                toppings: [],
                quantity: 1,
                unitPrice: 39000,
              },
            ],
            payments: [],
          },
          {
            id: 203,
            status: "PAID",
            totalAmount: 55000,
            createdAt: nowIso,
            updatedAt: nowIso,
            items: [
              {
                id: 3,
                productId: 2,
                productName: "Latte",
                size: "M",
                toppings: [],
                quantity: 1,
                unitPrice: 55000,
              },
            ],
            payments: [{ id: 1, method: "EWALLET", status: "SUCCESS", amount: 55000, createdAt: nowIso }],
          },
        ]);
      }
      return jsonResponse({});
    });

    render(<OrdersPage />);

    await screen.findByText("#BL-201");
    expect(screen.getAllByText("#BL-202").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("#BL-203").length).toBeGreaterThanOrEqual(1);

    // Only PENDING (201) and PAYMENT_FAILED (202) get the "Hủy đơn" button; PAID (203) does not
    const cancelButtons = screen.getAllByRole("button", { name: /^Hủy đơn$/ });
    expect(cancelButtons).toHaveLength(2);
  });

  it("surfaces backend cancel error and does not optimistically mark order CANCELLED", async () => {
    const nowIso = new Date().toISOString();
    const pendingOrder = {
      id: 301,
      status: "PENDING",
      totalAmount: 45000,
      createdAt: nowIso,
      updatedAt: nowIso,
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
      payments: [],
    };

    apiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/orders/me") {
        return jsonResponse([pendingOrder]);
      }
      if (path === "/orders/301/status" && init?.method === "PATCH") {
        return jsonResponse(
          { message: "Đơn hàng đã được thanh toán, không thể hủy." },
          400
        );
      }
      return jsonResponse({});
    });

    render(<OrdersPage />);

    const cancelBtn = await screen.findByRole("button", { name: /^Hủy đơn$/ });
    fireEvent.click(cancelBtn);

    expect(
      await screen.findByText(/Đơn hàng đã được thanh toán, không thể hủy\./i)
    ).toBeInTheDocument();

    // Order must NOT be optimistically marked CANCELLED: it stays PENDING with Hủy đơn button still present
    expect(screen.getByText("Chờ thanh toán")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Hủy đơn$/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/orders/301/status",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ status: "CANCELLED" }),
        })
      );
    });
  });
});
