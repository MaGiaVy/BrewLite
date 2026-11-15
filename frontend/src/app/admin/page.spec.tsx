import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const pushMock = vi.fn();
const routerMock = {
  push: pushMock,
  replace: vi.fn(),
  prefetch: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("../components/BrewLiteLogo", () => ({
  default: () => <div data-testid="logo-stub" />,
}));

const apiFetchMock = vi.fn();

vi.mock("../store/authStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store/authStore")>();
  return {
    ...actual,
    apiFetch: (...args: Parameters<typeof actual.apiFetch>) => apiFetchMock(...args),
  };
});

import AdminPortalPage from "./page";
import { useAuthStore } from "../store/authStore";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AdminPortalPage bakery 'phần' unit & dashboard rendering (M-09)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: {
        id: 1,
        email: "admin@brewlite.vn",
        fullName: "Admin BrewLite",
        phone: "0900000001",
        role: "ADMIN",
        loyaltyPoints: 0,
        vouchers: [],
      },
      token: "admin-jwt",
      isAuthenticated: true,
      _hasHydrated: true,
    });
  });

  afterEach(() => {
    cleanup();
    useAuthStore.getState().logout();
  });

  it("displays 'phần' for bakery items and 'ly' for beverage items across Overview & Products tabs", async () => {
    const nowIso = new Date().toISOString();

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/inventory/ingredients") return jsonResponse([]);
      if (path === "/inventory/recipes") {
        return jsonResponse({ products: [], toppingRecipes: [] });
      }
      if (path === "/products?includeInactive=true") {
        return jsonResponse([
          {
            id: 3,
            name: "Pain au Chocolat",
            description: "Bánh ngàn lớp sô-cô-la",
            category: "bakery",
            basePrice: 39000,
            isActive: true,
            isSoldOutManual: false,
            availableServings: 12,
            orderItemsCount: 5,
          },
          {
            id: 1,
            name: "Cà phê Sữa",
            description: "Cà phê phin truyền thống",
            category: "vietnamese",
            basePrice: 35000,
            isActive: true,
            isSoldOutManual: false,
            availableServings: 20,
            orderItemsCount: 8,
          },
        ]);
      }
      if (path === "/inventory/dashboard") {
        return jsonResponse({
          totalRevenue: 475000,
          totalCogsSold: 150000,
          totalGrossProfit: 325000,
          totalInventoryValue: 1000000,
          recentOrders: [],
          chartOrders: [
            {
              id: 701,
              status: "COMPLETED",
              totalAmount: 475000,
              createdAt: nowIso,
              items: [
                {
                  id: 1,
                  productId: 3,
                  productName: "Pain au Chocolat",
                  size: "ALL",
                  toppings: [],
                  quantity: 5,
                  unitPrice: 39000,
                },
                {
                  id: 2,
                  productId: 1,
                  productName: "Cà phê Sữa",
                  size: "M",
                  toppings: [],
                  quantity: 8,
                  unitPrice: 35000,
                },
              ],
            },
          ],
          topSellingProducts: [
            {
              productId: 1,
              productName: "Cà phê Sữa",
              totalQuantity: 8,
              totalRevenue: 280000,
            },
            {
              productId: 3,
              productName: "Pain au Chocolat",
              totalQuantity: 5,
              totalRevenue: 195000,
            },
          ],
        });
      }
      if (path === "/inventory/logs?limit=40") return jsonResponse([]);
      if (path === "/inventory/vouchers") return jsonResponse([]);
      if (path === "/staff") return jsonResponse([]);
      if (path === "/admin/customers") return jsonResponse([]);
      return jsonResponse([]);
    });

    render(<AdminPortalPage />);

    // Overview tab: top-selling products & chart both use "phần" for Pain au Chocolat and "ly" for Cà phê Sữa
    expect((await screen.findAllByText("5 phần")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("8 ly").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/195\.000đ trước giảm/i)).toBeInTheDocument();

    // Switch to Products tab ("Quản Lý Thực Đơn")
    const productsTabBtn = screen.getByRole("button", { name: /Quản Lý Thực Đơn/i });
    fireEvent.click(productsTabBtn);

    expect(await screen.findByText(/• Đã bán: 5 phần/i)).toBeInTheDocument();
    expect(screen.getByText(/✅ Phục vụ ~12 phần/i)).toBeInTheDocument();
    expect(screen.getByText(/• Đã bán: 8 ly/i)).toBeInTheDocument();
    expect(screen.getByText(/✅ Pha được ~20 ly/i)).toBeInTheDocument();
  }, 20000);
});
