"use client";

import React, { Suspense, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Clock,
  Lock,
  Wallet,
  Building2,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  PlusCircle,
  RotateCcw,
  X,
  XCircle,
} from "lucide-react";
import { apiFetch, useAuthStore } from "../../store/authStore";
import { useCartStore } from "../../store/cartStore";

function vnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
  }).format(amount);
}

const DEFAULT_BALANCE = 1000000; // 1.000.000đ mặc định
const BALANCE_STORAGE_KEY = "zalopay_sandbox_wallet_balance";
const GATEWAY_TTL_SECONDS = 300; // 5 phút đồng bộ theo TTL backend
const ACTIVE_PENDING_ORDER_KEY = "brewlite_active_pending_order";
const EXPIRY_SYNC_BACKOFF_MS = [1200, 2500, 4000] as const;
const PAID_ORDER_STATUSES: ReadonlySet<string> = new Set([
  "PAID",
  "PREPARING",
  "READY",
  "COMPLETED",
]);

function clearActivePendingOrder(targetOrderId?: number) {
  if (typeof window === "undefined") return;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      const raw = storage.getItem(ACTIVE_PENDING_ORDER_KEY);
      if (!raw) continue;
      if (targetOrderId !== undefined) {
        let storedId: number | null = Number(raw);
        if (Number.isNaN(storedId)) {
          const parsed = JSON.parse(raw) as { orderId?: unknown } | null;
          storedId = parsed && typeof parsed === "object" ? Number(parsed.orderId) : null;
        }
        if (storedId !== null && !Number.isNaN(storedId) && storedId !== targetOrderId) {
          continue;
        }
      }
      storage.removeItem(ACTIVE_PENDING_ORDER_KEY);
    } catch {
      try {
        storage.removeItem(ACTIVE_PENDING_ORDER_KEY);
      } catch {
        // ignore storage access errors
      }
    }
  }
}

interface GatewayOrderInfo {
  id: number;
  status: string;
  totalAmount: number;
  createdAt: string;
}

function calcRemainingFromCreatedAt(createdAt?: string): number {
  if (!createdAt) return GATEWAY_TTL_SECONDS;
  const createdMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdMs)) return GATEWAY_TTL_SECONDS;
  return Math.max(0, GATEWAY_TTL_SECONDS - Math.floor((Date.now() - createdMs) / 1000));
}

function extractGatewayErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const msg = (data as { message?: unknown }).message;
  if (Array.isArray(msg)) {
    const joined = msg.filter((m): m is string => typeof m === "string").join(", ");
    return joined || fallback;
  }
  return typeof msg === "string" && msg.trim() ? msg : fallback;
}

function ZaloPayGatewayContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clearCart = useCartStore((s) => s.clearCart);
  const { user, isAuthenticated, _hasHydrated } = useAuthStore();

  // Lấy các tham số từ URL
  const orderId = Number(searchParams.get("orderId")) || 0;
  const initialAmount = Number(searchParams.get("amount")) || 0;
  const [fallbackAppTransId] = useState(
    () => `261024_${orderId}_${Math.floor(100000 + Math.random() * 900000)}`
  );
  const appTransId = searchParams.get("appTransId") || fallbackAppTransId;
  const token = searchParams.get("token") || "";

  // State quản lý luồng thanh toán & đồng bộ đơn hàng thực tế
  const [orderInfo, setOrderInfo] = useState<GatewayOrderInfo | null>(null);
  const amount = orderInfo?.totalAmount ?? initialAmount;
  const [walletBalance, setWalletBalance] = useState<number>(DEFAULT_BALANCE);
  const [timeLeft, setTimeLeft] = useState(GATEWAY_TTL_SECONDS); // 5 phút (300s) đếm ngược
  const [status, setStatus] = useState<"READY" | "PROCESSING" | "SUCCESS" | "FAILED">("READY");
  const [isCancelling, setIsCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [redirectCountdown, setRedirectCountdown] = useState(3);
  const [expirySyncExhaustedKey, setExpirySyncExhaustedKey] = useState<string | null>(null);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [, startTransition] = useTransition();

  // State Nạp tiền vào ví
  const [isTopupModalOpen, setIsTopupModalOpen] = useState(false);
  const [topupAmountInput, setTopupAmountInput] = useState("500000");
  const [topupSuccessMsg, setTopupSuccessMsg] = useState("");

  // Tên và SĐT chủ ví động
  const accountHolder = user?.fullName || "MÃ GIA VỸ (ZaloPay Sandbox User)";
  const accountPhone = user?.phone || "0901***001";

  // Kiểm tra đăng nhập
  useEffect(() => {
    if (_hasHydrated && !isAuthenticated) {
      const redirectUrl = `/gateway/zalopay?orderId=${orderId || ""}`;
      router.push(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
    }
  }, [_hasHydrated, isAuthenticated, orderId, router]);

  // Đọc số dư từ localStorage khi mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem(BALANCE_STORAGE_KEY);
        if (saved !== null && !isNaN(Number(saved)) && Number(saved) >= 0) {
          setWalletBalance(Number(saved));
        } else {
          localStorage.setItem(BALANCE_STORAGE_KEY, String(DEFAULT_BALANCE));
          setWalletBalance(DEFAULT_BALANCE);
        }
      } catch {
        // fallback
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Tải trạng thái & createdAt thực tế của đơn hàng để đồng bộ đếm ngược 300s
  useEffect(() => {
    if (!_hasHydrated || !isAuthenticated || !orderId) return;
    let cancelled = false;

    const loadOrder = async () => {
      try {
        const res = await apiFetch(`/orders/${orderId}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setErrorMessage(
            extractGatewayErrorMessage(data, `Không thể tải thông tin đơn hàng #${orderId} (${res.status})`)
          );
          return;
        }
        const loaded: GatewayOrderInfo = data;
        setOrderInfo(loaded);

        if (PAID_ORDER_STATUSES.has(loaded.status)) {
          clearActivePendingOrder(orderId);
          setStatus("SUCCESS");
          return;
        }

        if (loaded.status === "CANCELLED") {
          clearActivePendingOrder(orderId);
          setTimeLeft(0);
          setStatus("FAILED");
          setErrorMessage(
            `Đơn hàng #${orderId} đã bị hủy hoặc hết hạn thanh toán (quá 5 phút). Nguyên liệu giữ chỗ đã được hoàn trả.`
          );
          return;
        }

        const rem = calcRemainingFromCreatedAt(loaded.createdAt);
        setTimeLeft(rem);

        if (loaded.status === "PAYMENT_FAILED") {
          setStatus("FAILED");
          setErrorMessage(
            "Đơn hàng đang ở trạng thái Thanh toán thất bại. Vui lòng quay lại Checkout và bấm \"Thử lại thanh toán\" trước khi thanh toán lại."
          );
        }
      } catch {
        // giữ fallback 300s nếu lỗi mạng tạm thời
      }
    };

    loadOrder();
    return () => {
      cancelled = true;
    };
  }, [_hasHydrated, isAuthenticated, orderId]);

  // Đếm ngược 5 phút (300s) đồng bộ theo createdAt của đơn hàng
  useEffect(() => {
    if (status === "SUCCESS" || orderInfo?.status === "CANCELLED") return;
    const orderCreatedAt = orderInfo?.createdAt;
    const timer = setInterval(() => {
      if (orderCreatedAt) {
        setTimeLeft(calcRemainingFromCreatedAt(orderCreatedAt));
      } else {
        setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [status, orderInfo?.createdAt, orderInfo?.status]);

  const isAwaitingExpirySync =
    timeLeft <= 0 &&
    status !== "SUCCESS" &&
    Boolean(orderId) &&
    _hasHydrated &&
    isAuthenticated &&
    (!orderInfo || orderInfo.status === "PENDING" || orderInfo.status === "PAYMENT_FAILED");

  const showExpiryRefreshPrompt =
    isAwaitingExpirySync && expirySyncExhaustedKey === String(orderId);

  // Khi hết thời gian 5 phút, kiểm tra lại trạng thái thực tế từ backend với bounded backoff (1.2s -> 2.5s -> 4s)
  useEffect(() => {
    if (!isAwaitingExpirySync) {
      return;
    }

    let cancelled = false;
    let activeTimer: ReturnType<typeof setTimeout> | null = null;

    const attemptSync = (attemptIndex: number) => {
      if (cancelled) return;
      if (attemptIndex >= EXPIRY_SYNC_BACKOFF_MS.length) {
        setExpirySyncExhaustedKey(String(orderId));
        return;
      }

      activeTimer = setTimeout(async () => {
        if (cancelled) return;
        try {
          const res = await apiFetch(`/orders/${orderId}`);
          if (cancelled) return;
          if (res.ok) {
            const data: GatewayOrderInfo = await res.json();
            if (cancelled) return;
            setOrderInfo(data);
            if (PAID_ORDER_STATUSES.has(data.status)) {
              clearActivePendingOrder(orderId);
              setStatus("SUCCESS");
              return;
            }
            if (data.status === "CANCELLED") {
              clearActivePendingOrder(orderId);
              setTimeLeft(0);
              setStatus("FAILED");
              setErrorMessage(
                `Đơn hàng #${orderId} đã bị hủy hoặc hết hạn thanh toán (quá 5 phút). Nguyên liệu giữ chỗ đã được hoàn trả.`
              );
              return;
            }
            if (data.status !== "PENDING" && data.status !== "PAYMENT_FAILED") {
              return;
            }
          }
        } catch {
          // retry next backoff attempt
        }
        if (!cancelled) {
          attemptSync(attemptIndex + 1);
        }
      }, EXPIRY_SYNC_BACKOFF_MS[attemptIndex]);
    };

    attemptSync(0);

    return () => {
      cancelled = true;
      if (activeTimer) clearTimeout(activeTimer);
    };
  }, [isAwaitingExpirySync, orderId]);

  const handleManualExpiryRefresh = async () => {
    if (!orderId || isRefreshingStatus) return;
    setIsRefreshingStatus(true);
    setExpirySyncExhaustedKey(null);
    try {
      const res = await apiFetch(`/orders/${orderId}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setExpirySyncExhaustedKey(String(orderId));
        return;
      }
      const refreshed = data as GatewayOrderInfo;
      setOrderInfo(refreshed);
      if (PAID_ORDER_STATUSES.has(refreshed.status)) {
        clearActivePendingOrder(orderId);
        setStatus("SUCCESS");
        return;
      }
      if (refreshed.status === "CANCELLED") {
        clearActivePendingOrder(orderId);
        setTimeLeft(0);
        setStatus("FAILED");
        setErrorMessage(
          `Đơn hàng #${orderId} đã bị hủy hoặc hết hạn thanh toán (quá 5 phút). Nguyên liệu giữ chỗ đã được hoàn trả.`
        );
        return;
      }
      if (refreshed.status === "PENDING" || refreshed.status === "PAYMENT_FAILED") {
        setExpirySyncExhaustedKey(String(orderId));
      }
    } catch {
      setExpirySyncExhaustedKey(String(orderId));
    } finally {
      setIsRefreshingStatus(false);
    }
  };

  // Format mm:ss
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Đếm ngược tự động chuyển hướng khi thành công
  useEffect(() => {
    if (status !== "SUCCESS") return;

    // Xóa giỏ hàng khi đơn đã thanh toán thành công
    clearCart();

    const interval = setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          startTransition(() => {
            router.push(`/order-confirmation?orderId=${orderId}`);
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [status, orderId, router, clearCart]);

  // Hành động Nạp tiền vào Ví
  const handleTopup = (addAmount: number) => {
    if (addAmount <= 0) return;
    const nextBal = walletBalance + addAmount;
    setWalletBalance(nextBal);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(BALANCE_STORAGE_KEY, String(nextBal));
      } catch {}
    }
    setIsTopupModalOpen(false);
    setErrorMessage(""); // Xóa thông báo lỗi thiếu tiền nếu có
    setTopupSuccessMsg(`Đã nạp thành công +${vnd(addAmount)} vào ví ZaloPay!`);
    setTimeout(() => setTopupSuccessMsg(""), 3500);
  };

  // Đặt lại số dư về mặc định 1.000.000đ
  const handleResetBalance = () => {
    setWalletBalance(DEFAULT_BALANCE);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(BALANCE_STORAGE_KEY, String(DEFAULT_BALANCE));
      } catch {}
    }
    setErrorMessage("");
    setTopupSuccessMsg("Đã khôi phục số dư ví về 1.000.000đ");
    setTimeout(() => setTopupSuccessMsg(""), 3000);
  };

  // Hành động 1: Xác nhận thanh toán qua ZaloPay
  const handleConfirmPayment = async () => {
    if (status === "PROCESSING" || status === "SUCCESS" || isCancelling) return;

    if (!orderId) {
      setStatus("FAILED");
      setErrorMessage("Không tìm thấy mã đơn hàng hợp lệ để xác nhận thanh toán.");
      return;
    }

    if (timeLeft <= 0 || orderInfo?.status === "CANCELLED") {
      setStatus("FAILED");
      setErrorMessage(
        "Đơn hàng đã hết hạn thanh toán (quá 5 phút) hoặc đã bị hủy. Vui lòng quay lại Checkout hoặc xem Lịch sử đơn hàng."
      );
      return;
    }

    if (orderInfo?.status === "PAYMENT_FAILED") {
      setStatus("FAILED");
      setErrorMessage(
        "Đơn hàng đang ở trạng thái Thanh toán thất bại. Vui lòng quay lại Checkout và bấm \"Thử lại thanh toán\" trước."
      );
      return;
    }

    // KIỂM TRA ĐIỀU KIỆN SỐ DƯ VÍ
    if (amount > walletBalance) {
      setStatus("FAILED");
      const missing = amount - walletBalance;
      setErrorMessage(
        `Giao dịch không thành công do số dư ví ZaloPay (${vnd(walletBalance)}) không đủ để thanh toán đơn hàng này (${vnd(amount)}). Bạn còn thiếu ${vnd(missing)}, vui lòng nạp thêm tiền vào ví để tiếp tục.`
      );
      return;
    }

    setStatus("PROCESSING");
    setErrorMessage("");

    try {
      // Giả lập trễ mạng bảo mật 1 giây tạo cảm giác giao dịch thực tế
      await new Promise((r) => setTimeout(r, 1000));

      const res = await apiFetch("/payments/zalopay/confirm", {
        method: "POST",
        body: JSON.stringify({
          orderId,
          appTransId,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        // Trừ tiền ví ZaloPay trên UI và lưu localStorage
        const paidAmount = data.totalAmount || amount;
        const newBal = Math.max(0, walletBalance - paidAmount);
        setWalletBalance(newBal);
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(BALANCE_STORAGE_KEY, String(newBal));
          } catch {}
        }
        clearActivePendingOrder(orderId);
        setStatus("SUCCESS");
      } else {
        setStatus("FAILED");
        const fallbackMsg =
          res.status === 403
            ? "Bạn không có quyền xác nhận giao dịch này hoặc cổng Sandbox đang bị giới hạn truy cập (403)."
            : res.status === 409
            ? "Trạng thái đơn hàng vừa thay đổi bởi thao tác khác. Vui lòng kiểm tra lại trạng thái đơn hàng."
            : res.status === 400
            ? "Đơn hàng đã hết hạn thanh toán (quá 5 phút) hoặc trạng thái không hợp lệ."
            : "Xác thực giao dịch từ máy chủ ZaloPay thất bại";
        setErrorMessage(extractGatewayErrorMessage(data, fallbackMsg));

        if (res.status === 400 || res.status === 409) {
          const refreshRes = await apiFetch(`/orders/${orderId}`).catch(() => null);
          if (refreshRes && refreshRes.ok) {
            const refreshed: GatewayOrderInfo = await refreshRes.json().catch(() => null);
            if (refreshed) {
              setOrderInfo(refreshed);
              if (refreshed.status === "CANCELLED") {
                clearActivePendingOrder(orderId);
                setTimeLeft(0);
              } else if (PAID_ORDER_STATUSES.has(refreshed.status)) {
                clearActivePendingOrder(orderId);
                setStatus("SUCCESS");
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      setStatus("FAILED");
      setErrorMessage(
        err instanceof Error ? err.message : "Không thể kết nối đến máy chủ Cổng thanh toán ZaloPay"
      );
    }
  };

  // Hành động 2A: Hủy đơn thực sự & hoàn kho, sau đó quay về Checkout với ?canceled=true
  const handleCancelAndRefund = async () => {
    if (!orderId || status === "PROCESSING" || isCancelling) return;
    setIsCancelling(true);
    setErrorMessage("");
    try {
      const res = await apiFetch("/payments/zalopay/cancel", {
        method: "POST",
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMessage(
          extractGatewayErrorMessage(data, `Không thể hủy đơn hàng #${orderId} (${res.status})`)
        );
        const refreshRes = await apiFetch(`/orders/${orderId}`).catch(() => null);
        if (refreshRes && refreshRes.ok) {
          const refreshed: GatewayOrderInfo = await refreshRes.json().catch(() => null);
          if (refreshed) {
            setOrderInfo(refreshed);
            if (refreshed.status === "CANCELLED") {
              clearActivePendingOrder(orderId);
              router.push(`/checkout?orderId=${orderId}&canceled=true`);
              return;
            }
            if (PAID_ORDER_STATUSES.has(refreshed.status)) {
              clearActivePendingOrder(orderId);
              setStatus("SUCCESS");
            }
          }
        }
        return;
      }
      clearActivePendingOrder(orderId);
      router.push(`/checkout?orderId=${orderId}&canceled=true`);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "Lỗi kết nối khi hủy giao dịch trên ZaloPay."
      );
    } finally {
      setIsCancelling(false);
    }
  };

  // Hành động 2B: Quay lại Checkout giữ nguyên đơn 5 phút (không hủy DB)
  const handleBackToCheckout = () => {
    if (status === "PROCESSING" || isCancelling) return;
    router.push(orderId ? `/checkout?orderId=${orderId}` : "/orders");
  };

  const isInsufficient = amount > walletBalance;
  const isExpiredOrCancelled = timeLeft <= 0 || orderInfo?.status === "CANCELLED";
  const isPaymentFailed = orderInfo?.status === "PAYMENT_FAILED";

  return (
    <div className="min-h-screen bg-[#F5F7FB] text-stone-800 flex flex-col font-sans selection:bg-[#0068FF] selection:text-white">
      {/* ─── HEADER CHUẨN ZALOPAY GATEWAY ─── */}
      <header className="bg-gradient-to-r from-[#0068FF] via-[#005AE0] to-[#0047BA] text-white shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo ZaloPay SVG */}
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-xs p-1">
              <svg viewBox="0 0 100 100" className="w-full h-full" fill="none">
                <rect width="100" height="100" rx="20" fill="#0068FF" />
                <path
                  d="M25 32H75L35 72H75"
                  stroke="white"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight">ZaloPay</span>
                <span className="text-xs uppercase tracking-wider font-semibold opacity-90 border-l border-white/30 pl-2">
                  Gateway
                </span>
              </div>
              <p className="text-[11px] text-blue-100 font-medium">
                Cổng thanh toán điện tử bảo mật VNG Corporation
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="hidden sm:inline-flex items-center gap-1.5 bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 px-2.5 py-1 rounded-full font-semibold text-[11px]">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Môi trường Sandbox VNG
            </span>
            <div className="hidden md:flex items-center gap-1.5 text-blue-100 text-[11px] border-l border-white/20 pl-3">
              <Lock size={12} className="text-emerald-300" />
              <span>PCI-DSS Level 1</span>
            </div>
          </div>
        </div>
      </header>

      {/* ─── NỘI DUNG CHÍNH ─── */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col justify-center">
        {status === "SUCCESS" ? (
          /* ── MÀN HÌNH THÀNH CÔNG RỰC RỠ ── */
          <div className="max-w-xl w-full mx-auto bg-white rounded-3xl p-8 sm:p-10 shadow-xl border border-emerald-100 text-center animate-in fade-in zoom-in-95 duration-300">
            <div className="w-20 h-20 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-5 ring-8 ring-emerald-50">
              <CheckCircle2 size={48} className="stroke-[2.5]" />
            </div>

            <span className="inline-block bg-emerald-100 text-emerald-800 text-xs font-extrabold uppercase px-3 py-1 rounded-full mb-3 tracking-wider">
              Giao dịch thành công
            </span>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-stone-900 mb-2">
              Thanh toán hoàn tất!
            </h1>
            <p className="text-stone-600 text-sm mb-6">
              Cổng ZaloPay đã xác thực chữ ký bảo mật và cập nhật đơn hàng thành công sang BrewLite Coffee.
            </p>

            {/* Chi tiết biên nhận ZaloPay */}
            <div className="bg-stone-50 rounded-2xl p-5 border border-stone-200/70 text-left space-y-2.5 mb-6 text-xs sm:text-sm">
              <div className="flex justify-between pb-2 border-b border-stone-200">
                <span className="text-stone-500">Mã đơn hàng BrewLite:</span>
                <span className="font-bold text-stone-900">#{orderId}</span>
              </div>
              <div className="flex justify-between pb-2 border-b border-stone-200">
                <span className="text-stone-500">Mã giao dịch ZaloPay (app_trans_id):</span>
                <span className="font-mono font-bold text-stone-900">{appTransId}</span>
              </div>
              <div className="flex justify-between pb-2 border-b border-stone-200">
                <span className="text-stone-500">Số tiền thanh toán:</span>
                <span className="font-bold text-[#0068FF] text-base">{vnd(amount)}</span>
              </div>
              <div className="flex justify-between pb-2 border-b border-stone-200">
                <span className="text-stone-500">Nguồn tiền thanh toán:</span>
                <span className="font-medium text-stone-800 flex items-center gap-1.5">
                  <Wallet size={14} className="text-[#0068FF]" />
                  Ví ZaloPay Sandbox ({accountHolder})
                </span>
              </div>
              <div className="flex justify-between pt-1">
                <span className="text-stone-500">Số dư ví ZaloPay còn lại:</span>
                <span className="font-bold text-emerald-700">{vnd(walletBalance)}</span>
              </div>
            </div>

            {/* Đếm ngược chuyển hướng */}
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3.5 mb-5 flex items-center justify-center gap-2 text-xs font-semibold text-[#0052CC]">
              <RefreshCw size={14} className="animate-spin text-[#0068FF]" />
              <span>
                Tự động quay về BrewLite Coffee sau {redirectCountdown} giây...
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                clearCart();
                router.push(`/order-confirmation?orderId=${orderId}`);
              }}
              className="w-full py-3.5 px-6 bg-[#0068FF] hover:bg-[#0052CC] text-white font-extrabold rounded-2xl text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-blue-500/25 cursor-pointer"
            >
              <span>Về BrewLite Coffee nhận đồ uống ngay</span>
              <ArrowRight size={16} />
            </button>
          </div>
        ) : (
          /* ── GIAO DIỆN CỔNG ZALOPAY THANH TOÁN TIÊU CHUẨN ── */
          <div className="bg-white rounded-3xl shadow-xl border border-stone-200/80 overflow-hidden">
            {/* Thanh thông báo đếm ngược hạn thanh toán */}
            <div className="bg-[#FFF8E6] border-b border-[#FFE8A3] px-6 py-2.5 flex items-center justify-between text-xs text-[#8A5800]">
              <div className="flex items-center gap-2 font-medium">
                <Clock size={14} className="text-[#D97706]" />
                <span>Thời gian giữ đơn hàng còn lại:</span>
              </div>
              <span className="font-mono font-extrabold text-sm text-[#B45309] bg-white px-2.5 py-0.5 rounded-lg border border-[#FDE68A] shadow-xs">
                {formatTime(timeLeft)}
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12">
              {/* CỘT TRÁI (5 phần): THÔNG TIN ĐƠN HÀNG & THỤ HƯỞNG */}
              <div className="lg:col-span-5 p-6 sm:p-8 bg-gradient-to-b from-stone-50 to-white border-b lg:border-b-0 lg:border-r border-stone-200 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs text-stone-500 mb-2 uppercase tracking-wider font-bold">
                    <Building2 size={14} className="text-[#0068FF]" />
                    Đơn vị bán hàng
                  </div>
                  <h2 className="text-lg font-black text-stone-900 leading-snug">
                    Công ty Cổ phần Cà phê BrewLite
                  </h2>
                  <p className="text-xs text-stone-500 mt-0.5">
                    Hệ thống đặt cà phê công nghệ & bánh ngọt cao cấp
                  </p>

                  <div className="mt-6 p-4 rounded-2xl bg-white border border-stone-200 shadow-xs space-y-2.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-stone-500">Mã đơn hàng:</span>
                      <span className="font-bold text-stone-800">#{orderId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500">Mã giao dịch ZaloPay:</span>
                      <span className="font-mono font-medium text-stone-700 truncate max-w-[150px]">
                        {appTransId}
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline pt-2 border-t border-stone-100">
                      <span className="text-stone-600 font-semibold">Tổng tiền thanh toán:</span>
                      <span className="text-xl font-extrabold text-[#0068FF]">
                        {vnd(amount)}
                      </span>
                    </div>
                  </div>

                  {/* Mã QR ZaloPay động chuẩn */}
                  <div className="mt-6 flex flex-col items-center p-4 bg-white rounded-2xl border border-stone-200 text-center">
                    <p className="text-xs font-bold text-stone-700 mb-2.5">
                      Quét mã bằng ZaloPay trên điện thoại:
                    </p>
                    <div className="relative w-44 h-44 bg-white p-2 border border-stone-200 rounded-xl shadow-xs flex items-center justify-center overflow-hidden">
                      <Image
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                          token ? `zalopay://pay?token=${token}` : `https://qcgateway.zalopay.vn/openinapp?app_trans_id=${appTransId}`
                        )}`}
                        alt="ZaloPay QR Sandbox"
                        fill
                        unoptimized
                        sizes="176px"
                        className="object-contain"
                      />
                    </div>
                    <span className="text-[11px] text-stone-500 mt-2">
                      Hoặc thực hiện thanh toán trực tiếp ở khung bên phải
                    </span>
                  </div>
                </div>

                <div className="pt-6 text-[11px] text-stone-500 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-emerald-600 shrink-0" />
                  <span>Bảo mật giao dịch bằng mã hóa HMAC-SHA256 theo chuẩn VNG</span>
                </div>
              </div>

              {/* CỘT PHẢI (7 phần): NGUỒN TIỀN VÍ & NẠP TIỀN */}
              <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-extrabold text-base text-stone-900 flex items-center gap-2">
                      <Wallet size={18} className="text-[#0068FF]" />
                      Nguồn tiền thanh toán
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleResetBalance}
                        className="text-[11px] text-stone-500 hover:text-stone-800 flex items-center gap-1 font-semibold transition px-2 py-1 rounded-lg hover:bg-stone-100 cursor-pointer"
                        title="Khôi phục số dư ví về 1.000.000đ ban đầu"
                      >
                        <RotateCcw size={12} />
                        <span>Đặt lại 1tr</span>
                      </button>
                    </div>
                  </div>

                  {/* Thông báo Nạp tiền thành công */}
                  {topupSuccessMsg && (
                    <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2 animate-in fade-in">
                      <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                      <span className="font-semibold">{topupSuccessMsg}</span>
                    </div>
                  )}

                  {/* Thông báo lỗi khi không đủ tiền hoặc lỗi thanh toán */}
                  {errorMessage && (
                    <div className="mb-4 p-4 bg-rose-50 border-2 border-rose-300 text-rose-800 rounded-2xl text-xs space-y-2 animate-in fade-in">
                      <div className="flex items-start gap-2.5">
                        <AlertCircle size={18} className="text-rose-600 shrink-0 mt-0.5" />
                        <span className="font-medium leading-relaxed">{errorMessage}</span>
                      </div>
                      {isInsufficient && (
                        <div className="pt-2 border-t border-rose-200 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setIsTopupModalOpen(true)}
                            className="px-3.5 py-1.5 bg-[#0068FF] hover:bg-[#0050C8] text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition shadow-xs cursor-pointer"
                          >
                            <PlusCircle size={14} />
                            <span>Nạp thêm tiền vào ví ngay</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Thẻ Ví ZaloPay Sandbox */}
                  <div
                    className={`rounded-2xl p-4 mb-4 transition shadow-xs relative border-2 ${
                      isInsufficient
                        ? "border-rose-400 bg-rose-50/40"
                        : "border-[#0068FF] bg-[#F2F7FF]"
                    }`}
                  >
                    <div className="absolute top-3 right-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsTopupModalOpen(true)}
                        className="px-3 py-1.5 rounded-xl bg-[#0068FF] hover:bg-[#0050C8] text-white text-xs font-extrabold flex items-center gap-1.5 transition shadow-xs cursor-pointer"
                      >
                        <PlusCircle size={14} />
                        <span>+ Nạp tiền</span>
                      </button>
                    </div>

                    <div className="flex items-start gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-white border border-[#BFDBFE] p-1.5 flex items-center justify-center shrink-0 shadow-2xs">
                        <svg viewBox="0 0 100 100" className="w-full h-full" fill="none">
                          <rect width="100" height="100" rx="20" fill="#0068FF" />
                          <path
                            d="M25 32H75L35 72H75"
                            stroke="white"
                            strokeWidth="12"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>

                      <div className="space-y-1 pr-24">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-stone-900 text-sm">
                            Ví điện tử ZaloPay
                          </span>
                          <span className="bg-blue-100 text-[#0068FF] text-[10px] font-bold px-2 py-0.5 rounded-full">
                            Sandbox
                          </span>
                        </div>
                        <p className="text-xs text-stone-600 font-medium">
                          Chủ ví: <strong className="text-stone-800">{accountHolder}</strong>
                        </p>
                        <p className="text-xs text-stone-600 font-mono">
                          Số điện thoại: <strong>{accountPhone}</strong>
                        </p>

                        <div className="pt-2 flex items-center gap-2 text-xs flex-wrap">
                          <span className="font-semibold text-stone-600">Số dư khả dụng:</span>
                          <span
                            className={`font-black text-sm px-2.5 py-0.5 rounded-lg border ${
                              isInsufficient
                                ? "bg-rose-100 text-rose-700 border-rose-300"
                                : "bg-emerald-100 text-emerald-800 border-emerald-300"
                            }`}
                          >
                            {vnd(walletBalance)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Dòng trạng thái so sánh số dư & đơn hàng */}
                    <div className="mt-3 pt-3 border-t border-stone-200/80 flex items-center justify-between text-xs">
                      <span className="text-stone-500">Cần thanh toán:</span>
                      <span className="font-extrabold text-[#0068FF]">{vnd(amount)}</span>
                    </div>
                  </div>

                  {/* Thông báo hết hạn thanh toán 5 phút hoặc đơn đã hủy */}
                  {isExpiredOrCancelled && (
                    <div className="mb-4 p-4 bg-amber-50 border-2 border-amber-300 text-amber-950 rounded-2xl text-xs space-y-2.5">
                      <div className="flex items-start gap-2.5">
                        <Clock size={18} className="text-amber-700 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold text-sm text-amber-900">
                            {orderInfo?.status === "CANCELLED"
                              ? `Đơn hàng #${orderId} đã bị hủy hoặc hết hạn`
                              : "Đã hết thời gian giữ đơn hàng (5 phút)"}
                          </p>
                          <p className="text-amber-800 mt-0.5 leading-relaxed">
                            Không thể xác nhận thanh toán qua ZaloPay sau khi hết hạn. Vui lòng quay lại BrewLite để kiểm tra đơn hoặc đặt đơn mới.
                          </p>
                          {showExpiryRefreshPrompt && (
                            <p className="text-amber-900 font-semibold mt-1.5 leading-relaxed">
                              Máy chủ chưa đồng bộ trạng thái hủy tự động. Vui lòng bấm làm mới để kiểm tra lại trạng thái đơn hàng.
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {showExpiryRefreshPrompt && (
                          <button
                            type="button"
                            onClick={handleManualExpiryRefresh}
                            disabled={isRefreshingStatus}
                            className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-950 border border-amber-400 font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <RefreshCw size={13} className={isRefreshingStatus ? "animate-spin" : ""} />
                            <span>{isRefreshingStatus ? "Đang kiểm tra..." : "Làm mới trạng thái"}</span>
                          </button>
                        )}
                        <Link
                          href={orderId ? `/checkout?orderId=${orderId}` : "/orders"}
                          className="px-3.5 py-1.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-bold transition"
                        >
                          Về trang Checkout
                        </Link>
                        <Link
                          href="/orders"
                          className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold transition"
                        >
                          Xem Lịch sử đơn hàng
                        </Link>
                      </div>
                    </div>
                  )}

                  {/* Hướng dẫn ngắn */}
                  <div className="p-3.5 bg-blue-50/80 rounded-2xl border border-blue-100 text-xs text-[#1E429F] flex items-start gap-2.5">
                    <Sparkles size={16} className="text-[#0068FF] shrink-0 mt-0.5" />
                    <span>
                      {isExpiredOrCancelled ? (
                        <>
                          Phiên thanh toán đã đóng sau 5 phút. Bấm{" "}
                          <strong>Về trang Checkout</strong> hoặc <strong>Xem Lịch sử đơn hàng</strong> ở trên để tiếp tục.
                        </>
                      ) : isInsufficient ? (
                        <>
                          Số dư ví hiện tại không đủ để trả cho đơn hàng này. Vui lòng bấm{" "}
                          <strong>+ Nạp tiền</strong> ở trên để nạp thêm và tiếp tục.
                        </>
                      ) : (
                        <>
                          Số dư ví hoàn toàn khả dụng. Nhấn nút <strong>Xác nhận thanh toán</strong> bên dưới để hoàn tất giao dịch.
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {/* ── CÁC NÚT HÀNH ĐỘNG ── */}
                <div className="pt-6 space-y-2.5">
                  {/* NÚT CHÍNH: THANH TOÁN BẰNG VÍ ZALOPAY */}
                  <button
                    type="button"
                    disabled={
                      status === "PROCESSING" ||
                      isCancelling ||
                      isInsufficient ||
                      isExpiredOrCancelled ||
                      isPaymentFailed ||
                      !orderId
                    }
                    onClick={handleConfirmPayment}
                    className={`w-full py-4 px-6 font-extrabold rounded-2xl text-base flex items-center justify-center gap-2.5 transition shadow-lg cursor-pointer transform active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed ${
                      isInsufficient || isExpiredOrCancelled || isPaymentFailed || !orderId
                        ? "bg-stone-300 text-stone-600 shadow-none"
                        : "bg-gradient-to-r from-[#0068FF] to-[#0050C8] hover:from-[#0050C8] hover:to-[#003B94] text-white shadow-blue-500/30"
                    }`}
                  >
                    {status === "PROCESSING" ? (
                      <>
                        <RefreshCw size={18} className="animate-spin text-white" />
                        <span>Đang xử lý giao dịch qua cổng bảo mật ZaloPay...</span>
                      </>
                    ) : isExpiredOrCancelled ? (
                      <>
                        <Clock size={18} className="text-stone-600" />
                        <span>Đơn hàng đã hết hạn / Đã hủy</span>
                      </>
                    ) : isPaymentFailed ? (
                      <>
                        <AlertCircle size={18} className="text-stone-600" />
                        <span>Vui lòng thử lại từ Checkout</span>
                      </>
                    ) : isInsufficient ? (
                      <>
                        <AlertCircle size={18} className="text-rose-600" />
                        <span>Số dư không đủ — Vui lòng nạp thêm tiền</span>
                      </>
                    ) : (
                      <>
                        <Lock size={16} />
                        <span>Xác nhận thanh toán {vnd(amount)}</span>
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>

                  {/* NÚT PHỤ 1: QUAY LẠI CHECKOUT GIỮ NGUYÊN ĐƠN 5 PHÚT (KHÔNG HỦY DB) */}
                  <button
                    type="button"
                    disabled={status === "PROCESSING" || isCancelling}
                    onClick={handleBackToCheckout}
                    className="w-full py-3 px-4 bg-[#F2F7FF] hover:bg-[#E5EFFF] text-[#0052CC] font-bold rounded-2xl text-xs sm:text-sm border border-[#BFDBFE] transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowLeft size={15} />
                    <span>Quay lại Checkout (giữ đơn 5 phút)</span>
                  </button>

                  {/* NÚT PHỤ 2: HỦY ĐƠN THỰC SỰ & HOÀN KHO */}
                  <button
                    type="button"
                    disabled={
                      status === "PROCESSING" ||
                      isCancelling ||
                      orderInfo?.status === "CANCELLED" ||
                      !orderId
                    }
                    onClick={handleCancelAndRefund}
                    className="w-full py-3 px-4 bg-white hover:bg-rose-50 text-rose-700 hover:text-rose-800 font-semibold rounded-2xl text-xs sm:text-sm border border-rose-200 transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCancelling ? (
                      <>
                        <RefreshCw size={15} className="animate-spin" />
                        <span>Đang hủy đơn &amp; hoàn kho...</span>
                      </>
                    ) : (
                      <>
                        <XCircle size={15} />
                        <span>Hủy đơn &amp; Hoàn kho</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── MODAL NẠP TIỀN VÀO VÍ ZALOPAY SANDBOX ── */}
      {isTopupModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div
            className="fixed inset-0"
            onClick={() => setIsTopupModalOpen(false)}
            aria-hidden="true"
          />

          <div
            className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden p-6 z-10 border border-stone-200 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-100 text-[#0068FF] flex items-center justify-center">
                  <Wallet size={20} />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-stone-900">
                    Nạp Tiền Vào Ví ZaloPay
                  </h3>
                  <p className="text-xs text-stone-500">Môi trường thử nghiệm Sandbox</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsTopupModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-stone-100 transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div className="bg-stone-50 p-3.5 rounded-2xl border border-stone-200 flex justify-between items-center text-xs">
                <span className="text-stone-500">Số dư hiện tại:</span>
                <span className="font-extrabold text-stone-900 text-sm">
                  {vnd(walletBalance)}
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-700 mb-1.5">
                  Nhập số tiền muốn nạp (VNĐ):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="50000"
                    min="10000"
                    value={topupAmountInput}
                    onChange={(e) => setTopupAmountInput(e.target.value)}
                    placeholder="VD: 500000"
                    className="w-full px-4 py-3 rounded-2xl bg-[#FAF6F0] border-2 border-stone-300 focus:border-[#0068FF] text-base font-extrabold text-[#0068FF] outline-hidden transition"
                  />
                  <span className="absolute right-4 top-3.5 text-xs font-bold text-stone-400">
                    VNĐ
                  </span>
                </div>
              </div>

              {/* Nút nạp nhanh */}
              <div>
                <p className="text-[11px] font-bold text-stone-500 mb-1.5">Chọn nhanh mức nạp:</p>
                <div className="grid grid-cols-3 gap-2">
                  {[100000, 500000, 1000000].map((quick) => (
                    <button
                      key={quick}
                      type="button"
                      onClick={() => setTopupAmountInput(String(quick))}
                      className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition cursor-pointer text-center ${
                        topupAmountInput === String(quick)
                          ? "bg-blue-50 border-[#0068FF] text-[#0068FF]"
                          : "bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100"
                      }`}
                    >
                      +{vnd(quick)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsTopupModalOpen(false)}
                className="flex-1 py-3 px-4 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-100 text-xs font-bold transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => handleTopup(Number(topupAmountInput) || 0)}
                className="flex-1 py-3 px-4 rounded-xl bg-[#0068FF] hover:bg-[#0050C8] text-white text-xs font-extrabold transition shadow-md shadow-blue-500/20 cursor-pointer flex items-center justify-center gap-1.5"
              >
                <PlusCircle size={15} />
                <span>Xác nhận Nạp tiền</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER BẢO MẬT */}
      <footer className="py-4 text-center text-xs text-stone-500 border-t border-stone-200/60 bg-white/50">
        <p>© 2026 ZaloPay & VNG Corporation. All rights reserved. Môi trường kiểm thử môn Công nghệ Phần mềm.</p>
      </footer>
    </div>
  );
}

export default function ZaloPayGatewayPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F5F7FB] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-[#0068FF] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-semibold text-stone-600">
              Đang kết nối tới Cổng thanh toán ZaloPay Gateway...
            </p>
          </div>
        </div>
      }
    >
      <ZaloPayGatewayContent />
    </Suspense>
  );
}
