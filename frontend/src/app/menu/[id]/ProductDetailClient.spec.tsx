import React, { Suspense } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import type { Product } from "../../utils/productUtils";
import type { CustomizationDetails, ProductDetailModalProps } from "../../components/ProductDetailModal";
import { useCartStore } from "../../store/cartStore";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock("../../components/Header", () => ({
  default: () => <header data-testid="mock-header" />,
}));

vi.mock("../../components/Footer", () => ({
  default: () => <footer data-testid="mock-footer" />,
}));

let capturedModalProps: ProductDetailModalProps | null = null;

vi.mock("../../components/ProductDetailModal", () => ({
  default: (props: ProductDetailModalProps) => {
    capturedModalProps = props;
    const prod = props.product;
    return (
      <div
        data-testid="mock-product-detail-modal"
        data-is-modal={String(props.isModal)}
      >
        <span>{prod?.name}</span>
        <button
          type="button"
          data-testid="mock-add-to-cart"
          onClick={() => {
            if (!prod || !props.onAddToCart) return;
            const customization: CustomizationDetails = {
              size: "M",
              sizeExtra: 5000,
              sizeLabel: "Vừa (M)",
              temp: "iced",
              tempLabel: "Đá",
              sweetness: "100%",
              ice: "100%",
              toppings: [],
              notes: "",
              quantity: 1,
              unitPrice: prod.basePrice + 5000,
              totalPrice: prod.basePrice + 5000,
              isBakery: false,
            };
            props.onAddToCart(prod, customization);
          }}
        >
          Add to cart
        </button>
      </div>
    );
  },
}));

import ProductDetailClient from "./ProductDetailClient";

describe("ProductDetailClient standalone navigation (Wave 4)", () => {
  const sampleProduct: Product = {
    id: 2,
    name: "Cà phê Sữa",
    description: "Cà phê phin truyền thống",
    imageUrl: "/images/products/ca-phe-sua.png",
    basePrice: 35000,
    category: "vietnamese",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    capturedModalProps = null;
    useCartStore.getState().clearCart();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(sampleProduct), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
    useCartStore.getState().clearCart();
  });

  it("passes isModal={false} and pushes /cart on add-to-cart without ever pushing /menu after >=2000ms", async () => {
    const paramsPromise = Promise.resolve({ id: "2" });

    await act(async () => {
      render(
        <Suspense fallback={<div>Loading...</div>}>
          <ProductDetailClient paramsPromise={paramsPromise} />
        </Suspense>
      );
    });

    const modalEl = await waitFor(() =>
      screen.getByTestId("mock-product-detail-modal")
    );
    expect(modalEl).toHaveAttribute("data-is-modal", "false");
    expect(capturedModalProps?.isModal).toBe(false);

    vi.useFakeTimers();

    fireEvent.click(screen.getByTestId("mock-add-to-cart"));

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/cart");
    expect(useCartStore.getState().items).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    expect(pushMock).not.toHaveBeenCalledWith("/menu");
    expect(pushMock).toHaveBeenCalledTimes(1);
  });
});
