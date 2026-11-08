import React, { Suspense } from "react";
import type { Metadata } from "next";
import LoginClient from "../login/LoginClient";

export const metadata: Metadata = {
  title: "Đăng ký tài khoản | BrewLite Cashless Coffee",
  description:
    "Tạo tài khoản BrewLite để đặt cà phê không chạm, tích lũy Hạt Vàng và nhận thông báo khi món sẵn sàng.",
};

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#fef8f4] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-[#2c1810]/20 border-t-[#2c1810] rounded-full animate-spin" />
            <p className="text-[#504440] text-sm font-body">Đang tải...</p>
          </div>
        </div>
      }
    >
      <LoginClient initialMode="register" />
    </Suspense>
  );
}
