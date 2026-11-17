/**
 * Chuyển đổi một pattern CORS có chứa wildcard `*` thành RegExp khớp chính xác toàn bộ Origin.
 * - Với pattern không có scheme (VD: `*.vercel.app`), cho phép optional `http://` hoặc `https://`.
 * - Không dùng `.*` để tránh khớp xuyên qua dấu `/` trong path/query.
 */
export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]+');

  if (!pattern.includes('://')) {
    return new RegExp(`^(?:https?:\\/\\/)?${escaped}$`, 'i');
  }

  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Phân tích biến môi trường `CORS_ORIGIN` hỗ trợ:
 * - Rỗng hoặc `*`: cho phép mọi origin (`true`).
 * - Danh sách phân tách dấu `,` kết hợp origin chính xác và wildcard pattern
 *   (VD: `http://localhost:3000,https://*.vercel.app`).
 */
export function parseCorsOrigin(
  corsOrigin?: string,
): boolean | string | RegExp | Array<string | RegExp> {
  const trimmed = corsOrigin?.trim();
  if (!trimmed || trimmed === '*') {
    return true;
  }

  const entries = trimmed
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (entries.length === 0 || entries.includes('*')) {
    return true;
  }

  const origins = entries.map((entry) =>
    entry.includes('*') ? wildcardToRegExp(entry) : entry,
  );

  return origins.length === 1 ? origins[0] : origins;
}
