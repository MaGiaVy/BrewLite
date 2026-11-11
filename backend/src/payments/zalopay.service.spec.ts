import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ZaloPayService } from './zalopay.service.js';
import { createHmac } from 'crypto';

describe('ZaloPayService', () => {
  let service: ZaloPayService;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    service = new ZaloPayService();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should generate app_trans_id with correct yymmdd_orderId format', () => {
    const orderId = 123;
    const transId = service.generateAppTransId(orderId);
    expect(transId).toMatch(/^\d{6}_123_\d{6}$/);
  });

  it('should compute createOrderMac correctly using HMAC-SHA256 and key1', () => {
    const params = {
      appTransId: '261023_123_456789',
      appUser: 'test_user',
      amount: 65000,
      appTime: 1729700000000,
      embedData: '{}',
      item: '[]',
    };

    const mac = service.computeCreateOrderMac(params);
    expect(mac).toBeDefined();
    expect(mac.length).toBe(64); // SHA-256 hex string is 64 chars

    const expectedData = [
      service.appId,
      params.appTransId,
      params.appUser,
      params.amount,
      params.appTime,
      params.embedData,
      params.item,
    ].join('|');
    const expectedMac = createHmac('sha256', service.key1).update(expectedData).digest('hex');
    expect(mac).toBe(expectedMac);
  });

  it('should correctly verify valid and invalid callback MAC using key2', () => {
    const callbackData = JSON.stringify({
      app_id: service.appId,
      app_trans_id: '261023_123_456789',
      amount: 65000,
    });

    const validMac = createHmac('sha256', service.key2).update(callbackData).digest('hex');
    expect(service.verifyCallback(callbackData, validMac)).toBe(true);

    const invalidMac = '0000000000000000000000000000000000000000000000000000000000000000';
    expect(service.verifyCallback(callbackData, invalidMac)).toBe(false);

    // Tampered data
    const tamperedData = JSON.stringify({
      app_id: service.appId,
      app_trans_id: '261023_123_456789',
      amount: 99999999, // Hacked amount
    });
    expect(service.verifyCallback(tamperedData, validMac)).toBe(false);

    // TimingSafeEqual checks: different length
    expect(service.verifyCallback(callbackData, 'short_mac')).toBe(false);
    expect(service.verifyCallback(callbackData, '')).toBe(false);
    // Non-string inputs
    expect(service.verifyCallback(null as any, validMac)).toBe(false);
    expect(service.verifyCallback(callbackData, undefined as any)).toBe(false);
  });

  describe('Fail-fast Production Security Checks', () => {
    it('throw Error nếu NODE_ENV=production mà thiếu ZALOPAY_KEY1', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ZALOPAY_KEY1;
      process.env.ZALOPAY_KEY2 = 'key2_secret';

      expect(() => new ZaloPayService()).toThrow(
        /Missing ZALOPAY_KEY1 or ZALOPAY_KEY2 in production environment/,
      );
    });

    it('throw Error nếu NODE_ENV=production mà thiếu ZALOPAY_KEY2', () => {
      process.env.NODE_ENV = 'production';
      process.env.ZALOPAY_KEY1 = 'key1_secret';
      delete process.env.ZALOPAY_KEY2;

      expect(() => new ZaloPayService()).toThrow(
        /Missing ZALOPAY_KEY1 or ZALOPAY_KEY2 in production environment/,
      );
    });

    it('khởi tạo thành công trong NODE_ENV=production khi đủ cả ZALOPAY_KEY1 và ZALOPAY_KEY2', () => {
      process.env.NODE_ENV = 'production';
      process.env.ZALOPAY_KEY1 = 'prod_key1';
      process.env.ZALOPAY_KEY2 = 'prod_key2';

      const prodService = new ZaloPayService();
      expect(prodService.key1).toBe('prod_key1');
      expect(prodService.key2).toBe('prod_key2');
    });
  });

  it('should call createOrder and return response from ZaloPay Sandbox', async () => {
    const mockResponse = {
      return_code: 1,
      return_message: 'Giao dịch thành công',
      sub_return_code: 1,
      sub_return_message: 'Giao dịch thành công',
      order_url: 'https://qcgateway.zalopay.vn/pay?token=test_token',
      zp_trans_token: 'test_token',
      order_token: 'test_token',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue(mockResponse),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.createOrder({
      orderId: 999,
      amount: 45000,
    });

    expect(result.returnCode).toBe(1);
    expect(result.orderUrl).toBe('https://qcgateway.zalopay.vn/pay?token=test_token');
    expect(result.appTransId).toContain('_999_');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
