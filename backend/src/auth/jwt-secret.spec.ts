import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getJwtSecret } from './jwt-secret.helper.js';

describe('AUTH-01: Hardcode Fallback JWT Secret Protection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('phải ném lỗi nghiêm trọng trong môi trường Production nếu không có JWT_SECRET', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;

    expect(() => getJwtSecret()).toThrowError(
      /FATAL SECURITY CONFIGURATION: process.env.JWT_SECRET must be configured/,
    );
  });

  it('phải ném lỗi nghiêm trọng trong Production nếu cố tình dùng khóa mặc định brewlite_secret_key', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'brewlite_secret_key';

    expect(() => getJwtSecret()).toThrowError(
      /FATAL SECURITY CONFIGURATION: process.env.JWT_SECRET must be configured/,
    );
  });

  it('phải trả về khóa hợp lệ khi cấu hình chuẩn trong Production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'super_secure_production_key_123456789!';

    expect(getJwtSecret()).toBe('super_secure_production_key_123456789!');
  });

  it('trong môi trường dev/test, fallback an toàn cho quá trình chạy thử nếu chưa đặt biến', () => {
    delete process.env.NODE_ENV;
    delete process.env.JWT_SECRET;

    expect(getJwtSecret()).toBe('brewlite_secret_key');
  });
});

