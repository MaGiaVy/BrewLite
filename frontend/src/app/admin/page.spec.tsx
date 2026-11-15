import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

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

  it("chọn nhiều nguyên liệu theo size (ALL/S/M/L) trong modal Thêm món mới và gọi POST /inventory/recipes", async () => {
    const createdProduct = {
      id: 77,
      name: "Cà Phê Trứng Hà Nội",
      description: "",
      imageUrl: "/images/products/ca-phe-sua.png",
      basePrice: 45000,
      sizeUpchargeM: null,
      sizeUpchargeL: null,
      category: "vietnamese",
      tag: "Mới",
      isActive: false,
      isSoldOutManual: false,
      isAvailable: false,
      maxServings: 0,
      soldCount: 0,
    };
    const productsList = [
      {
        id: 1,
        name: "Bạc Xỉu",
        description: "",
        imageUrl: "/images/products/ca-phe-sua.png",
        basePrice: 35000,
        sizeUpchargeM: null,
        sizeUpchargeL: null,
        category: "vietnamese",
        tag: null,
        isActive: true,
        isSoldOutManual: false,
        isAvailable: true,
        maxServings: 10,
        soldCount: 2,
      },
    ];

    apiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/inventory/ingredients") {
        return new Response(
          JSON.stringify([
            {
              id: 10,
              code: "ING_COFFEE",
              name: "Cà phê Robusta",
              unit: "g",
              stock: 1000,
              minStock: 100,
              costPerUnit: 500,
              type: "INGREDIENT",
            },
            {
              id: 11,
              code: "ING_MILK",
              name: "Sữa đặc",
              unit: "ml",
              stock: 2000,
              minStock: 200,
              costPerUnit: 200,
              type: "INGREDIENT",
            },
          ]),
          { status: 200 },
        );
      }
      if (path === "/products?includeInactive=true") {
        return new Response(JSON.stringify(productsList), { status: 200 });
      }
      if (path === "/products" && init?.method === "POST") {
        productsList.unshift(createdProduct);
        return new Response(JSON.stringify(createdProduct), { status: 201 });
      }
      if (path === "/inventory/recipes" && init?.method === "POST") {
        return new Response(String(init.body), { status: 201 });
      }
      if (path === "/inventory/dashboard") {
        return new Response(
          JSON.stringify({ summary: {}, lowStockItems: [], recentOrders: [] }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(<AdminPortalPage />);

    const productsTabBtn = await screen.findByRole("button", {
      name: /Quản Lý Thực Đơn/i,
    });
    fireEvent.click(productsTabBtn);

    const openModalBtn = await screen.findByRole("button", {
      name: /Thêm món mới/i,
    });
    fireEvent.click(openModalBtn);

    fireEvent.change(screen.getByPlaceholderText("VD: Cold Brew Cam Sả"), {
      target: { value: "Cà Phê Trứng Hà Nội" },
    });
    fireEvent.click(screen.getByText("+ Thêm nguyên liệu"));
    fireEvent.change(screen.getByLabelText("Nguyên liệu 2"), {
      target: { value: "11" },
    });
    fireEvent.change(screen.getByLabelText("Size 2"), {
      target: { value: "L" },
    });
    fireEvent.change(screen.getByLabelText("Định lượng 2"), {
      target: { value: "30" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Tạo món mới" }));

    await waitFor(() => {
      expect(screen.getByText("Cà Phê Trứng Hà Nội")).toBeInTheDocument();
    });
    await waitFor(() => {
      const recipeBodies = apiFetchMock.mock.calls
        .filter(([p, i]) => p === "/inventory/recipes" && i?.method === "POST")
        .map(([, i]) => JSON.parse(String(i?.body)));
      expect(recipeBodies).toHaveLength(2);
      expect(recipeBodies[0]).toMatchObject({
        productId: 77,
        ingredientId: 10,
        size: "ALL",
        amount: 20,
      });
      expect(recipeBodies[1]).toMatchObject({
        productId: 77,
        ingredientId: 11,
        size: "L",
        amount: 30,
      });
    });
  }, 20000);
});
