/**
 * Helper quản lý khóa bí mật JWT an toàn (AUTH-01).
 * Chống lỗ hổng Hardcode Fallback JWT Secret.
 *
 * Trên môi trường Production (process.env.NODE_ENV === 'production'):
 * - Bắt buộc biến môi trường JWT_SECRET phải được cấu hình.
 * - Tuyệt đối không chấp nhận secret mặc định 'brewlite_secret_key'.
 * - Ném lỗi dừng khởi động hệ thống nếu thiếu cấu hình.
 *
 * Trên môi trường Dev / Test:
 * - Ưu tiên lấy JWT_SECRET nếu có, nếu không thì fallback về secret dev an toàn cho test runner.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    if (!secret || secret === 'brewlite_secret_key') {
      throw new Error(
        'FATAL SECURITY CONFIGURATION: process.env.JWT_SECRET must be configured with a secure key in production!',
      );
    }
    return secret;
  }

  return secret || 'brewlite_secret_key';
}

