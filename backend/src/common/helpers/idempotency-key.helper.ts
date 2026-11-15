import { BadRequestException } from '@nestjs/common';

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/**
 * Chuẩn hóa và kiểm tra an toàn cho header `Idempotency-Key`.
 * - Từ chối giá trị không phải chuỗi (VD: gửi lặp nhiều header -> string[]).
 * - Bỏ qua chuỗi rỗng / toàn khoảng trắng để tránh đụng độ khóa unique trong DB.
 */
export function normalizeIdempotencyKey(rawKey?: unknown): string | undefined {
  if (rawKey === undefined || rawKey === null) {
    return undefined;
  }
  if (typeof rawKey !== 'string') {
    throw new BadRequestException('Header Idempotency-Key không hợp lệ');
  }
  const trimmed = rawKey.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new BadRequestException(
      `Header Idempotency-Key không được vượt quá ${MAX_IDEMPOTENCY_KEY_LENGTH} ký tự`,
    );
  }
  return trimmed;
}
