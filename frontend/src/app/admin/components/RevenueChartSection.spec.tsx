import { describe, it, expect } from "vitest";
import {
  computeRevenueDashboardMetrics,
  type OrderSummary,
  type ProductItem,
} from "./RevenueChartSection";

describe("computeRevenueDashboardMetrics (Wave 4)", () => {
  const fixedNow = new Date(2026, 10, 12, 12, 0, 0);

  const products: ProductItem[] = [
    { id: 1, name: "Cà phê Sữa", category: "vietnamese", basePrice: 35000 },
    { id: 2, name: "Latte", category: "espresso", basePrice: 55000 },
    { id: 3, name: "Pain au Chocolat", category: "bakery", basePrice: 39000 },
  ];

  it("reconciles discounted/VAT orders to order.totalAmount (94,000đ items -> 91,000đ totalAmount) without NaN", () => {
    const orders: OrderSummary[] = [
      {
        id: 1001,
        status: "COMPLETED",
        totalAmount: 91000,
        discountCode: "BREW10",
        discountAmount: 10000,
        createdAt: new Date(2026, 10, 12, 9, 30, 0).toISOString(),
        items: [
          {
            id: 1,
            productId: 2,
            productName: "Latte",
            size: "M",
            toppings: [],
            quantity: 1,
            unitPrice: 55000,
          },
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
      },
    ];

    const metrics = computeRevenueDashboardMetrics(orders, products, fixedNow);

    expect(metrics.total7DaysRevenue).toBe(91000);
    expect(metrics.categoryStats.totalCatRevenue).toBe(91000);
    expect(metrics.total7DaysOrders).toBe(1);
    expect(metrics.averageOrderValue).toBe(91000);

    const catSum = metrics.categoryStats.list.reduce(
      (sum, item) => sum + item.revenue,
      0
    );
    expect(catSum).toBe(91000);

    for (const cat of metrics.categoryStats.list) {
      expect(Number.isNaN(cat.revenue)).toBe(false);
      expect(Number.isNaN(cat.percent)).toBe(false);
      expect(Number.isNaN(cat.quantity)).toBe(false);
    }
  });

  it("handles >50 orders across 7 days with zero-weight guard and excludes CANCELLED orders", () => {
    const orders: OrderSummary[] = [];
    let expectedRevenue = 0;

    for (let i = 0; i < 55; i++) {
      const dayOffset = i % 7;
      const createdAt = new Date(2026, 10, 12 - dayOffset, 10, i % 60, 0).toISOString();
      const totalAmount = i === 0 ? 91000 : 40000 + (i % 5) * 5000;
      expectedRevenue += totalAmount;

      orders.push({
        id: i + 1,
        status: i % 2 === 0 ? "COMPLETED" : "PAID",
        totalAmount,
        createdAt,
        items:
          i === 0
            ? [
                {
                  id: 1,
                  productId: 2,
                  productName: "Latte",
                  size: "M",
                  toppings: [],
                  quantity: 1,
                  unitPrice: 55000,
                },
                {
                  id: 2,
                  productId: 3,
                  productName: "Pain au Chocolat",
                  size: "ALL",
                  toppings: [],
                  quantity: 1,
                  unitPrice: 39000,
                },
              ]
            : i === 1
            ? [
                {
                  id: 3,
                  productId: 1,
                  productName: "Cà phê Sữa",
                  size: "M",
                  toppings: [],
                  quantity: 1,
                  unitPrice: 0,
                },
              ]
            : [
                {
                  id: i + 100,
                  productId: (i % 3) + 1,
                  productName: "Item",
                  size: "M",
                  toppings: [],
                  quantity: 1,
                  unitPrice: totalAmount,
                },
              ],
      });
    }

    // Cancelled order should not be counted
    orders.push({
      id: 9999,
      status: "CANCELLED",
      totalAmount: 500000,
      createdAt: fixedNow.toISOString(),
      items: [
        {
          id: 9999,
          productId: 1,
          productName: "Cà phê Sữa",
          size: "M",
          toppings: [],
          quantity: 10,
          unitPrice: 50000,
        },
      ],
    });

    const metrics = computeRevenueDashboardMetrics(orders, products, fixedNow);

    expect(metrics.total7DaysOrders).toBe(55);
    expect(metrics.total7DaysRevenue).toBe(expectedRevenue);
    expect(metrics.categoryStats.totalCatRevenue).toBe(expectedRevenue);
    expect(Number.isNaN(metrics.averageOrderValue)).toBe(false);

    for (const day of metrics.last7DaysData) {
      expect(Number.isNaN(day.revenue)).toBe(false);
      expect(Number.isNaN(day.orderCount)).toBe(false);
    }
    for (const cat of metrics.categoryStats.list) {
      expect(Number.isNaN(cat.revenue)).toBe(false);
      expect(Number.isNaN(cat.percent)).toBe(false);
    }
  });
});
