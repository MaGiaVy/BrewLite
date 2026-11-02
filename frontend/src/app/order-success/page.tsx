"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function OrderSuccessRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    // 1. Thử lấy orderId trực tiếp từ query params
    let orderId = searchParams.get("orderId");

    // 2. Nếu không có, thử trích xuất từ apptransid của ZaloPay (định dạng yymmdd_{orderId}_{random})
    if (!orderId) {
      const appTransId = searchParams.get("apptransid");
      if (appTransId) {
        const parts = appTransId.split("_");
        if (parts.length >= 2) {
          orderId = parts[1];
        }
      }
    }

    if (orderId) {
      router.replace(`/order-confirmation?orderId=${orderId}`);
    } else {
      router.replace("/orders");
    }
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-[#FAF7F2] flex flex-col items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-stone-200 flex flex-col items-center max-w-sm w-full text-center">
        <div className="w-10 h-10 border-4 border-[#0068FF] border-t-transparent rounded-full animate-spin mb-4" />
        <h2 className="text-base font-bold text-stone-800">Đang hoàn tất thanh toán...</h2>
        <p className="text-xs text-stone-500 mt-1">Đang chuyển hướng về trang xác nhận đơn hàng.</p>
      </div>
    </div>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense fallback={null}>
      <OrderSuccessRedirect />
    </Suspense>
  );
}
