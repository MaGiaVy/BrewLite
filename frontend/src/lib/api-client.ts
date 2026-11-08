/**
 * BrewLite — Centralized API Client (Task T5.1b-4 & WEB-T09)
 * - Tự động đính kèm JWT Bearer Token từ authStore
 * - Bắt chặn mã lỗi HTTP 401 Unauthorized:
 *   + Xóa trạng thái xác thực (authStore.logout())
 *   + TUYỆT ĐỐI bảo toàn giỏ hàng (useCartStore giữ nguyên 100% items)
 *   + Điều hướng về /login?redirect=<đường dẫn hiện tại>
 */

import { useAuthStore } from "../app/store/authStore";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface ApiClientOptions extends RequestInit {
  /** Cho phép truyền hàm điều hướng tùy chỉnh (hữu ích cho router hoặc unit test) */
  onUnauthorizedRedirect?: (loginUrl: string) => void;
  /** Đường dẫn hiện tại để gắn vào query ?redirect=... */
  currentPath?: string;
}

/**
 * Điều hướng mặc định trên trình duyệt khi gặp 401
 */
function defaultRedirect(loginUrl: string) {
  if (typeof window !== "undefined") {
    const pathname = window.location?.pathname ?? "";
    if (!pathname.startsWith("/login")) {
      try {
        window.location.href = loginUrl;
      } catch {
        // Fallback trong môi trường test jsdom
      }
    }
  }
}

/**
 * Gọi API Backend với cơ chế tự động gắn Bearer Token và xử lý 401 tập trung
 */
export async function apiClient(
  path: string,
  options: ApiClientOptions = {}
): Promise<Response> {
  const { onUnauthorizedRedirect, currentPath, ...fetchOptions } = options;
  const token = useAuthStore.getState().token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...fetchOptions,
    headers,
  });

  if (response.status === 401) {
    // 1. Xóa phiên đăng nhập (chỉ xóa authStore, KHÔNG đụng vào cartStore)
    useAuthStore.getState().logout();

    // 2. Xác định đường dẫn redirect sau khi đăng nhập lại
    const targetPath =
      currentPath ??
      (typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search || ""}`
        : "/checkout");

    const loginUrl =
      targetPath && !targetPath.startsWith("/login")
        ? `/login?redirect=${encodeURIComponent(targetPath)}`
        : "/login";

    if (onUnauthorizedRedirect) {
      onUnauthorizedRedirect(loginUrl);
    } else {
      defaultRedirect(loginUrl);
    }
  }

  return response;
}

export default apiClient;
