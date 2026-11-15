import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { OrderStatus, PaymentMethod, PaymentStatus, Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth/auth.service.js';
import { RedeemPointsDto } from './auth/dto/redeem-points.dto.js';
import { RegisterDto } from './auth/dto/register.dto.js';
import { UpdateProfileDto } from './auth/dto/update-profile.dto.js';
import { getJwtSecret } from './auth/jwt-secret.helper.js';
import { JwtStrategy } from './auth/jwt.strategy.js';
import { ToggleStatusDto } from './common/dto/toggle-status.dto.js';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter.js';
import { INT32_MAX, ParseInt32Pipe } from './common/pipes/parse-int32.pipe.js';
import { containsUnsafeHtml } from './common/validators/no-unsafe-html.validator.js';
import { CreateCustomerDto } from './customers/dto/create-customer.dto.js';
import { UpdateCustomerDto } from './customers/dto/update-customer.dto.js';
import { InventoryService } from './inventory/inventory.service.js';
import { computeRequiredIngredients } from './orders/bom.helper.js';
import { CreateOrderDto, OrderItemDto } from './orders/dto/create-order.dto.js';
import { refundOrderResources } from './orders/order-refund.helper.js';
import { OrdersService } from './orders/orders.service.js';
import {
  findExactToppingGroup,
  resolveOrderToppingOrThrow,
} from './orders/topping.helper.js';
import { PaymentsService } from './payments/payments.service.js';
import { ZaloPayService } from './payments/zalopay.service.js';
import { CreateProductDto, UpdateProductDto } from './products/dto/product.dto.js';
import { ProductsService } from './products/products.service.js';
import { UpdateStaffDto } from './users/dto/update-staff.dto.js';
import { UsersService } from './users/users.service.js';

describe('Backend Audit Fixes Regression Suite (C-01..LOW-4)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  describe('C-01: Strict exact topping validation & shared helper', () => {
    const sampleToppings = [
      {
        toppingId: 'boba_white',
        toppingName: 'Trân châu trắng giòn',
        price: 8000,
        isActive: true,
        amount: 30,
        ingredient: { id: 10, code: 'ING_BOBA_W', name: 'Trân châu trắng', unit: 'g', isRequiredForSale: true },
      },
      {
        toppingId: 'cheese_foam',
        toppingName: 'Kem phô mai',
        price: 10000,
        isActive: false,
        amount: 25,
        ingredient: { id: 11, code: 'ING_CHEESE_FOAM', name: 'Kem phô mai', unit: 'ml', isRequiredForSale: true },
      },
      {
        toppingId: 'bakery_jam',
        toppingName: 'Mứt dâu',
        price: 6000,
        isActive: true,
        amount: 15,
        ingredient: { id: 12, code: 'ING_JAM', name: 'Mứt dâu', unit: 'g', isRequiredForSale: true },
      },
    ];

    it('rejects empty, whitespace, substring-only, unknown, inactive, and cross-category toppings', () => {
      expect(() => resolveOrderToppingOrThrow(sampleToppings, '')).toThrow(BadRequestException);
      expect(() => resolveOrderToppingOrThrow(sampleToppings, '   ')).toThrow(BadRequestException);
      expect(() => resolveOrderToppingOrThrow(sampleToppings, 'Trân châu')).toThrow(BadRequestException);
      expect(() => resolveOrderToppingOrThrow(sampleToppings, 'NonExistent')).toThrow(BadRequestException);
      expect(() => resolveOrderToppingOrThrow(sampleToppings, 'Kem phô mai')).toThrow(BadRequestException);
      expect(() =>
        resolveOrderToppingOrThrow(sampleToppings, 'Mứt dâu', { isBakery: false }),
      ).toThrow(BadRequestException);
      expect(() =>
        resolveOrderToppingOrThrow(sampleToppings, 'Trân châu trắng giòn', { isBakery: true }),
      ).toThrow(BadRequestException);

      const ok = resolveOrderToppingOrThrow(sampleToppings, 'Trân châu trắng giòn', { isBakery: false });
      expect(ok.toppingId).toBe('boba_white');
      expect(ok.price).toBe(8000);
    });

    it('computeRequiredIngredients only deducts exact active toppings (never substring multi-match)', async () => {
      const tx = {
        recipe: { findMany: vi.fn().mockResolvedValue([]) },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue(sampleToppings) },
        product: { findMany: vi.fn().mockResolvedValue([{ id: 1, category: 'vietnamese' }]) },
        ingredient: { findMany: vi.fn().mockResolvedValue([]) },
      };

      const partialMatch = await computeRequiredIngredients(tx, [
        { productId: 1, size: 'M', toppings: ['Trân châu'], quantity: 1 },
      ]);
      expect(partialMatch).toHaveLength(0);

      const exactMatch = await computeRequiredIngredients(tx, [
        { productId: 1, size: 'M', toppings: ['Trân châu trắng giòn'], quantity: 2 },
      ]);
      expect(exactMatch).toEqual([
        expect.objectContaining({ ingredientId: 10, requiredAmount: 60 }),
      ]);
      expect(findExactToppingGroup(sampleToppings, 'cheese_foam')).toBeNull();
    });
  });

  describe('C-02 & LOW-4: 0đ orders, ZaloPay callback hardening & exact VND total', () => {
    it('OrdersService transitions totalAmount === 0 directly to PAID and preserves exact VND without 1000đ rounding', async () => {
      let capturedCreate: any;
      const mockPrisma: any = {
        order: {
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn(),
        },
        product: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Espresso', basePrice: 29000, category: 'vietnamese', isActive: true, isSoldOutManual: false },
          ]),
        },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        storeSetting: { findMany: vi.fn().mockResolvedValue([]) },
        $transaction: vi.fn(async (cb: any) =>
          cb({
            order: {
              count: vi.fn().mockResolvedValue(0),
              create: vi.fn().mockImplementation(({ data }) => {
                capturedCreate = data;
                return Promise.resolve({ id: 700, status: data.status ?? OrderStatus.PENDING, items: [], ...data });
              }),
            },
            userVoucher: {
              findUnique: vi.fn().mockResolvedValue({
                id: 9,
                code: 'FREE100',
                quantity: 1,
                discountPercent: 100,
                minOrderAmount: 0,
                maxDiscountAmount: 0,
              }),
              updateMany: vi.fn().mockResolvedValue({ count: 1 }),
              deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
            recipe: { findMany: vi.fn().mockResolvedValue([]) },
            toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
            product: { findMany: vi.fn().mockResolvedValue([{ id: 1, category: 'vietnamese' }]) },
            ingredient: { findMany: vi.fn().mockResolvedValue([]) },
          }),
        ),
      };

      const ordersService = new OrdersService(mockPrisma);
      const freeOrder = await ordersService.createOrder(
        {
          items: [{ productId: 1, size: 'S', toppings: [], quantity: 1 }],
          discountCode: 'FREE100',
        },
        5,
      );

      expect(freeOrder.totalAmount).toBe(0);
      expect(freeOrder.status).toBe(OrderStatus.PAID);
      expect(capturedCreate.voucherDiscountPercent).toBe(100);
      expect(capturedCreate.voucherMinOrderAmount).toBe(0);
    });

    it('PaymentsService handles 0đ ZaloPay create, explicit amount=0 check, embed_data mismatch & optional MockPaymentService', async () => {
      process.env.WEB_URL = 'https://brewlite.example.com/';
      delete process.env.ZALOPAY_CREATE_ENDPOINT;
      process.env.ZALOPAY_ENDPOINT = 'https://custom-zalo.example/v2/create';

      const zaloPay = new ZaloPayService();
      expect(zaloPay.createEndpoint).toBe('https://custom-zalo.example/v2/create');
      const fetchMock = vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ return_code: 1, order_url: 'https://pay.test/1' }),
      });
      vi.stubGlobal('fetch', fetchMock);
      await zaloPay.createOrder({ orderId: 12, amount: 25000 });
      const reqParams = new URLSearchParams(fetchMock.mock.calls[0][1].body);
      expect(JSON.parse(reqParams.get('embed_data') || '{}').redirecturl).toBe(
        'https://brewlite.example.com/order-confirmation?orderId=12',
      );

      const mockPrisma: any = {
        order: {
          findUnique: vi.fn().mockResolvedValue({
            id: 55,
            userId: 1,
            status: OrderStatus.PENDING,
            totalAmount: 0,
            createdAt: new Date(),
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        payment: { create: vi.fn().mockResolvedValue({ id: 1 }) },
        user: { update: vi.fn() },
        $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
        $executeRawUnsafe: vi.fn(),
      };
      const payments = new PaymentsService(mockPrisma, undefined, zaloPay);

      const zeroRes = await payments.createZaloPayOrder(55, 1, Role.CUSTOMER);
      expect(zeroRes.returnCode).toBe(1);
      expect(zeroRes.appTransId).toBe('FREE_55');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 55, status: OrderStatus.PENDING },
          data: expect.objectContaining({ status: OrderStatus.PAID }),
        }),
      );

      // Missing/0 amount rejected against >0đ order
      mockPrisma.order.findUnique.mockResolvedValueOnce({
        id: 56,
        userId: 1,
        status: OrderStatus.PENDING,
        totalAmount: 45000,
        createdAt: new Date(),
      });
      const tampered = zaloPay.createMockCallbackPayload(56, 0, '261115_56_123456');
      const mismatchAmtRes = await payments.handleZaloPayCallback(tampered);
      expect(mismatchAmtRes.return_code).toBe(2);

      // Mismatched embed_data.orderId vs app_trans_id rejected
      const crossOrderData = JSON.stringify({
        app_trans_id: '261115_99_123456',
        amount: 45000,
        embed_data: JSON.stringify({ orderId: 56 }),
      });
      const crypto = await import('crypto');
      const mac = crypto.createHmac('sha256', zaloPay.key2).update(crossOrderData).digest('hex');
      const mismatchIdRes = await payments.handleZaloPayCallback({ data: crossOrderData, mac });
      expect(mismatchIdRes.return_code).toBe(0);
      expect(mismatchIdRes.return_message).toContain('mismatch');

      // Concurrent idempotency replay inside tx returns 'Order already processed'
      mockPrisma.order.findUnique
        .mockResolvedValueOnce({ id: 57, status: OrderStatus.PENDING, totalAmount: 45000, createdAt: new Date() })
        .mockResolvedValueOnce({ id: 57, status: OrderStatus.PAID, totalAmount: 45000, createdAt: new Date() });
      const okPayload = zaloPay.createMockCallbackPayload(57, 45000, '261115_57_123456');
      const replayRes = await payments.handleZaloPayCallback(okPayload);
      expect(replayRes).toEqual({ return_code: 1, return_message: 'Order already processed' });

      // Optional MockPaymentService: 0đ succeeds, >0đ throws ForbiddenException
      mockPrisma.order.findUnique.mockResolvedValueOnce({
        id: 58,
        userId: 1,
        status: OrderStatus.PENDING,
        totalAmount: 30000,
        version: 0,
        createdAt: new Date(),
      });
      await expect(
        payments.processPayment({ orderId: 58, method: PaymentMethod.EWALLET }, 1),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('H-01 & H-02: tokenVersion invalidation & weak JWT secrets rejected in production', () => {
    it('rejects weak/placeholder JWT_SECRET in production and rejects mismatched tokenVersion', async () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'brewlite-super-secret-jwt-key-change-in-prod';
      expect(() => getJwtSecret()).toThrow(/FATAL SECURITY CONFIGURATION/);

      process.env.JWT_SECRET = 'change-me-to-a-random-64-char-hex-secret';
      expect(() => getJwtSecret()).toThrow(/FATAL SECURITY CONFIGURATION/);

      process.env.JWT_SECRET = 'short_key';
      expect(() => getJwtSecret()).toThrow(/FATAL SECURITY CONFIGURATION/);

      process.env.JWT_SECRET = 'a9f3e2c1b0d48f6e7a5c3b1d9e8f0a2b4c6d8e0f';
      expect(getJwtSecret()).toBe('a9f3e2c1b0d48f6e7a5c3b1d9e8f0a2b4c6d8e0f');

      const strategy = new JwtStrategy({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: 1,
            email: 'a@b.com',
            role: Role.CUSTOMER,
            isActive: true,
            tokenVersion: 2,
          }),
        },
      } as any);

      await expect(
        strategy.validate({ sub: 1, email: 'a@b.com', role: Role.CUSTOMER, tokenVersion: 1 }),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        strategy.validate({ sub: 1, email: 'a@b.com', role: Role.CUSTOMER, tokenVersion: 2 }),
      ).resolves.toEqual({ userId: 1, email: 'a@b.com', role: Role.CUSTOMER });
    });
  });

  describe('H-03, H-04, H-05, H-06, M-01..M-11 & LOW-1: RBAC, INT32, Prisma filter, DTO & Voucher snapshots', () => {
    it('ParseInt32Pipe & PrismaExceptionFilter convert overflow/Prisma errors to clean 4xx', () => {
      const pipe = new ParseInt32Pipe();
      expect(pipe.transform('1')).toBe(1);
      expect(pipe.transform(INT32_MAX)).toBe(INT32_MAX);
      expect(() => pipe.transform('0')).toThrow(BadRequestException);
      expect(() => pipe.transform('2147483648')).toThrow(BadRequestException);
      expect(() => pipe.transform('abc')).toThrow(BadRequestException);

      const filter = new PrismaExceptionFilter();
      const jsonMock = vi.fn();
      const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
      const host: any = {
        switchToHttp: () => ({ getResponse: () => ({ status: statusMock }) }),
      };

      filter.catch(
        new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: '6.19.3' }),
        host,
      );
      expect(statusMock).toHaveBeenCalledWith(409);

      filter.catch(
        new Prisma.PrismaClientKnownRequestError('Missing', { code: 'P2025', clientVersion: '6.19.3' }),
        host,
      );
      expect(statusMock).toHaveBeenCalledWith(404);
    });

    it('ProductsService.findOne returns 404 for hidden product when !allowInactive', async () => {
      const products = new ProductsService({
        product: {
          findUnique: vi.fn().mockResolvedValue({
            id: 5,
            name: 'Secret Drink',
            basePrice: 40000,
            isActive: false,
            recipes: [],
          }),
        },
        orderItem: { groupBy: vi.fn().mockResolvedValue([]) },
      } as any);

      await expect(products.findOne(5, false, false)).rejects.toThrow(NotFoundException);
      await expect(products.findOne(5, false, true)).resolves.toEqual(
        expect.objectContaining({ id: 5, isActive: false }),
      );
    });

    it('InventoryService protects costPerUnit/PKG_*, honors maxDiscountAmount=0, and omits usageCount from public config', async () => {
      const mockPrisma: any = {
        ingredient: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 1,
              code: 'PKG_CUP_M',
              name: 'Ly M',
              unit: 'chiếc',
              stock: 50,
              minStock: 10,
              costPerUnit: 1200,
              isActive: true,
              recipes: [],
            },
          ]),
          findUnique: vi.fn().mockResolvedValue({ id: 1, code: 'PKG_CUP_M', name: 'Ly M' }),
          delete: vi.fn(),
        },
        storeSetting: { findMany: vi.fn().mockResolvedValue([]) },
        discountCode: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 1,
              code: 'FLAT',
              discountPercent: 10,
              minOrderAmount: 0,
              maxDiscountAmount: 0,
              isActive: true,
              usageCount: 99,
              createdAt: new Date(),
            },
          ]),
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 2, ...data })),
        },
        toppingRecipe: {
          findMany: vi.fn().mockResolvedValue([
            { toppingId: 'boba', toppingName: 'Trân châu', price: 8000, isActive: true },
            { toppingId: 'old', toppingName: 'Tạm ngưng', price: 8000, isActive: false },
          ]),
        },
        recipe: { findMany: vi.fn().mockResolvedValue([]) },
      };

      const inv = new InventoryService(mockPrisma);
      const staffIngs = await inv.getAllIngredients(false);
      expect((staffIngs[0] as any).costPerUnit).toBeUndefined();

      const adminIngs = await inv.getAllIngredients(true);
      expect((adminIngs[0] as any).costPerUnit).toBe(1200);

      await expect(inv.deleteIngredient(1)).rejects.toThrow(ConflictException);
      await expect(inv.updateIngredient(1, { code: 'CUSTOM_1' })).rejects.toThrow(ConflictException);

      const createdVoucher = await inv.createVoucher({
        code: 'NOCAP',
        discountPercent: 15,
        minOrderAmount: 0,
        maxDiscountAmount: 0,
      });
      expect(createdVoucher.maxDiscountAmount).toBe(0);

      const pubCfg = await inv.getPublicPricingConfig();
      expect((pubCfg.vouchers[0] as any).usageCount).toBeUndefined();
      expect((pubCfg.vouchers[0] as any).createdAt).toBeUndefined();
      expect(pubCfg.allToppings).toHaveLength(1);
    });

    it('UsersService blocks cross-role CUSTOMER access on /staff/:id & protects seeded root admin', async () => {
      const users = new UsersService({
        user: {
          findUnique: vi
            .fn()
            .mockResolvedValueOnce({ id: 2, email: 'cust@test.vn', role: Role.CUSTOMER })
            .mockResolvedValueOnce({ id: 1, email: '3124410414@sv.sgu.edu.vn', role: Role.ADMIN }),
        },
      } as any);

      await expect(users.getStaffById(2)).rejects.toThrow(NotFoundException);
      await expect(users.toggleStaffStatus(1, false)).rejects.toThrow(BadRequestException);
    });

    it('AuthService.redeemPoints rejects disabled DiscountCode even if in VOUCHER_CATALOG', async () => {
      const mockAuthPrisma: any = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: 1, loyaltyPoints: 100 }),
        },
        discountCode: {
          findUnique: vi.fn().mockResolvedValue({ code: 'WELCOME20', isActive: false }),
        },
        $transaction: vi.fn(),
      };
      const auth = new AuthService(
        mockAuthPrisma,
        { sign: vi.fn() } as any,
      );

      await expect(auth.redeemPoints(1, 20, 'WELCOME20')).rejects.toThrow(BadRequestException);
    });

    it('refundOrderResources restores UserVoucher from Order voucher snapshot even if DiscountCode was deleted', async () => {
      const createMany = vi.fn().mockResolvedValue({ count: 1 });
      const tx = {
        inventoryLog: { findMany: vi.fn().mockResolvedValue([]) },
        userVoucher: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          createMany,
        },
        discountCode: { findUnique: vi.fn().mockResolvedValue(null) },
      };

      const res = await refundOrderResources(
        tx,
        {
          id: 99,
          userId: 3,
          discountCode: 'PROMO30',
          voucherDeducted: true,
          voucherDiscountPercent: 30,
          voucherMinOrderAmount: 100000,
          voucherMaxDiscountAmount: 40000,
        },
        { performedBy: 'System', notePrefix: 'Refund' },
      );

      expect(res.refundedVoucher).toBe(true);
      expect(createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              code: 'PROMO30',
              discountPercent: 30,
              minOrderAmount: 100000,
              maxDiscountAmount: 40000,
            }),
          ],
        }),
      );
    });

    it('ValidationPipe rejects XSS payloads, non-whitelisted fields, invalid roles & invalid booleans', async () => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });

      expect(containsUnsafeHtml('<script>alert(1)</script>')).toBe(true);
      expect(containsUnsafeHtml('Nguyễn Văn An - Sữa tươi')).toBe(false);

      await expect(
        pipe.transform(
          { fullName: '<img src=x onerror=alert(1)>', role: 'SUPERADMIN' },
          { type: 'body', metatype: UpdateStaffDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        pipe.transform(
          { isActive: 'not-a-bool' },
          { type: 'body', metatype: ToggleStatusDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        pipe.transform(
          { email: 'a@b.com', fullName: 'A', password: 'password1', extraField: 123 },
          { type: 'body', metatype: CreateCustomerDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        pipe.transform(
          { items: [{ productId: 1, size: 'M', toppings: [''], quantity: 1 }] },
          { type: 'body', metatype: CreateOrderDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        pipe.transform(
          { points: 10, voucherCode: '   ' },
          { type: 'body', metatype: RedeemPointsDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Security Audit Fixes — 7 Vulnerability Regression Suite', () => {
    it('Bug #3 (Loyalty): awards 0 points on PAID (processPayment & ZaloPay) and awards points only on COMPLETED without PAID->CANCELLED clawback', async () => {
      const userUpdate = vi.fn().mockResolvedValue({});
      const txOrder = {
        id: 201,
        userId: 11,
        totalAmount: 50000,
        status: OrderStatus.PENDING,
        version: 0,
        createdAt: new Date(),
      };
      const prismaPay: any = {
        order: {
          findUnique: vi.fn().mockResolvedValue(txOrder),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        payment: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({
            id: 501,
            orderId: 201,
            amount: 50000,
            method: PaymentMethod.EWALLET,
            status: PaymentStatus.SUCCESS,
          }),
        },
        user: { update: userUpdate },
        $transaction: vi.fn(async (cb: any) => cb(prismaPay)),
      };
      const gateway: any = {
        processPayment: vi.fn().mockResolvedValue({
          success: true,
          transactionId: 'GW-201',
          message: 'Thanh toán thành công',
        }),
      };

      const payRes = await new PaymentsService(
        prismaPay,
        gateway,
        undefined as any,
      ).processPayment({ orderId: 201, method: PaymentMethod.EWALLET }, 11);
      expect(payRes.pointsEarned).toBe(0);
      expect(userUpdate).not.toHaveBeenCalled();

      // ZaloPay callback -> PAID also does not award loyalty points
      const zaloSvc = new ZaloPayService();
      const cbPayload = JSON.stringify({
        app_trans_id: '261115_201_999',
        amount: 50000,
        zp_trans_id: 777001,
      });
      const cbMac = createHmac('sha256', zaloSvc.key2).update(cbPayload).digest('hex');
      const cbRes = await new PaymentsService(
        prismaPay,
        undefined,
        zaloSvc,
      ).handleZaloPayCallback({
        data: cbPayload,
        mac: cbMac,
      });
      expect(cbRes.return_code).toBe(1);
      expect(userUpdate).not.toHaveBeenCalled();

      // PAID -> CANCELLED does not touch user loyalty points
      const ordersPrisma: any = {
        order: {
          findUnique: vi.fn().mockResolvedValue({
            id: 201,
            userId: 11,
            totalAmount: 50000,
            status: OrderStatus.PAID,
            items: [],
          }),
        },
        user: { findUnique: vi.fn().mockResolvedValue({ id: 99, fullName: 'Staff' }) },
        $transaction: vi.fn(async (cb: any) =>
          cb({
            order: {
              updateMany: vi.fn().mockResolvedValue({ count: 1 }),
              findUnique: vi.fn().mockResolvedValue({
                id: 201,
                userId: 11,
                totalAmount: 50000,
                status: OrderStatus.CANCELLED,
                updatedAt: new Date(),
              }),
            },
            user: { update: userUpdate, updateMany: vi.fn() },
          }),
        ),
      };
      const ordersSvc = new OrdersService(ordersPrisma);
      await ordersSvc.updateOrderStatus(201, OrderStatus.CANCELLED, 99, Role.STAFF);
      expect(userUpdate).not.toHaveBeenCalled();

      // READY -> COMPLETED awards floor(50000 / 1000) = 50 points
      ordersPrisma.order.findUnique.mockResolvedValueOnce({
        id: 202,
        userId: 11,
        totalAmount: 50000,
        status: OrderStatus.READY,
        items: [],
      });
      ordersPrisma.$transaction.mockImplementationOnce(async (cb: any) =>
        cb({
          order: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            findUnique: vi.fn().mockResolvedValue({
              id: 202,
              userId: 11,
              totalAmount: 50000,
              status: OrderStatus.COMPLETED,
              updatedAt: new Date(),
            }),
          },
          user: { update: userUpdate },
        }),
      );
      const completeRes = await ordersSvc.updateOrderStatus(
        202,
        OrderStatus.COMPLETED,
        99,
        Role.STAFF,
      );
      expect((completeRes as any).pointsEarned).toBe(50);
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 11 },
        data: { loyaltyPoints: { increment: 50 } },
      });
    });

    it('Bug #2 (Voucher): blocks personal UserVoucher when DiscountCode is inactive, blocks repeated global DiscountCode use, and blocks guest voucher use', async () => {
      const basePrisma = (txOverrides: any): any => ({
        product: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Coffee', basePrice: 40000, category: 'vietnamese', isActive: true },
          ]),
        },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        storeSetting: { findMany: vi.fn().mockResolvedValue([]) },
        $transaction: vi.fn(async (cb: any) =>
          cb({
            $queryRaw: vi.fn(),
            order: { count: vi.fn().mockResolvedValue(0) },
            userVoucher: { findUnique: vi.fn().mockResolvedValue(null) },
            discountCode: { findUnique: vi.fn().mockResolvedValue(null) },
            recipe: { findMany: vi.fn().mockResolvedValue([]) },
            ingredient: { findMany: vi.fn().mockResolvedValue([]) },
            ...txOverrides,
          }),
        ),
      });

      // 1) Personal voucher deactivated at DiscountCode level
      const svcInactivePersonal = new OrdersService(
        basePrisma({
          userVoucher: {
            findUnique: vi.fn().mockResolvedValue({
              id: 5,
              userId: 10,
              code: 'REWARD10',
              quantity: 1,
              discountPercent: 10,
              minOrderAmount: 0,
              maxDiscountAmount: 20000,
            }),
          },
          discountCode: {
            findUnique: vi.fn().mockResolvedValue({ code: 'REWARD10', isActive: false }),
          },
        }),
      );
      await expect(
        svcInactivePersonal.createOrder(
          { items: [{ productId: 1, size: 'M', toppings: [], quantity: 1 }], discountCode: 'REWARD10' },
          10,
        ),
      ).rejects.toThrow(BadRequestException);

      // 2) Repeat use of global DiscountCode by same user
      const svcRepeatGlobal = new OrdersService(
        basePrisma({
          discountCode: {
            findUnique: vi.fn().mockResolvedValue({
              id: 2,
              code: 'BREW10',
              isActive: true,
              discountPercent: 10,
              minOrderAmount: 0,
              maxDiscountAmount: 20000,
            }),
          },
          order: { count: vi.fn().mockResolvedValue(1) },
        }),
      );
      await expect(
        svcRepeatGlobal.createOrder(
          { items: [{ productId: 1, size: 'M', toppings: [], quantity: 1 }], discountCode: 'BREW10' },
          10,
        ),
      ).rejects.toThrow(BadRequestException);

      // 3) Guest user attempting to use DiscountCode
      await expect(
        svcRepeatGlobal.createOrder(
          { items: [{ productId: 1, size: 'M', toppings: [], quantity: 1 }], discountCode: 'BREW10' },
          undefined as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('Bug #1 (ZaloPay): handles missing/non-string callback fields without 500, rejects blank/unconfigured verifyCallback, and blocks cross-order P2002 collision', async () => {
      const zaloSvc = new ZaloPayService();
      expect(zaloSvc.verifyCallback('', 'abc')).toBe(false);
      expect(zaloSvc.verifyCallback('   ', '   ')).toBe(false);

      const prevEnv = process.env;
      try {
        process.env = { ...prevEnv, NODE_ENV: 'production' };
        delete process.env.ZALOPAY_KEY2;
        delete process.env.ALLOW_SANDBOX_CONFIRM;
        expect(() => zaloSvc.verifyCallback('{"a":1}', 'abcd')).toThrow(
          /Missing ZALOPAY_KEY1 or ZALOPAY_KEY2 in production environment/,
        );
      } finally {
        process.env = prevEnv;
      }

      const prismaMissing: any = { order: { findUnique: vi.fn() } };
      const paySvc = new PaymentsService(prismaMissing, undefined, zaloSvc);

      expect(await paySvc.handleZaloPayCallback(undefined as any)).toEqual({
        return_code: -1,
        return_message: 'invalid callback payload',
      });
      expect(await paySvc.handleZaloPayCallback({ data: { forged: true } as any, mac: 'abc' })).toEqual({
        return_code: -1,
        return_message: 'invalid callback payload',
      });
      expect(await paySvc.handleZaloPayCallback({ data: '{}', mac: '   ' })).toEqual({
        return_code: -1,
        return_message: 'invalid callback payload',
      });

      // Cross-order P2002 collision: zp_trans_id already used on order #99
      const p2002Err: any = new Error('Unique constraint failed');
      p2002Err.code = 'P2002';
      const txMock: any = {
        $executeRawUnsafe: vi.fn(),
        order: {
          findUnique: vi.fn().mockResolvedValue({
            id: 20,
            userId: 5,
            status: OrderStatus.PENDING,
            totalAmount: 50000,
            createdAt: new Date(),
            items: [],
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        payment: {
          create: vi.fn().mockRejectedValue(p2002Err),
          findUnique: vi.fn().mockResolvedValue({ id: 1, orderId: 99, idempotencyKey: 'ZALOPAY_55555' }),
        },
      };
      const collisionPrisma: any = {
        order: txMock.order,
        $transaction: vi.fn(async (cb: any) => cb(txMock)),
      };
      const collisionZalo: any = {
        verifyCallback: vi.fn().mockReturnValue(true),
        queryStatus: vi.fn().mockResolvedValue({
          returnCode: 1,
          amount: 50000,
          zpTransId: 55555,
          isProcessing: false,
          returnMessage: 'ok',
        }),
      };
      const collisionPaySvc = new PaymentsService(collisionPrisma, undefined, collisionZalo);
      const cbPayload = JSON.stringify({
        app_trans_id: '261115_20_111',
        amount: 50000,
        zp_trans_id: 55555,
      });
      const collisionCb = await collisionPaySvc.handleZaloPayCallback({ data: cbPayload, mac: 'valid' });
      expect(collisionCb.return_code).toBe(0);
      expect(collisionCb.return_message).toContain('#99');

      await expect(
        collisionPaySvc.getZaloPayStatus(20, 5, '261115_20_111', Role.CUSTOMER),
      ).rejects.toThrow(ConflictException);
    });

    it('Bug #4 (BOM): rejects createOrder when ordered product/size lacks a BOM recipe while DB has recipes configured', async () => {
      // Case A: recipe table has recipes configured (count > 0), none for product #2 size L
      const prismaCountMock: any = {
        product: {
          findMany: vi.fn().mockResolvedValue([
            { id: 2, name: 'Latte Mới', basePrice: 45000, category: 'espresso', isActive: true },
          ]),
        },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        storeSetting: { findMany: vi.fn().mockResolvedValue([]) },
        $transaction: vi.fn(async (cb: any) =>
          cb({
            $queryRaw: vi.fn(),
            recipe: {
              findMany: vi.fn().mockResolvedValue([]),
              count: vi.fn().mockResolvedValue(5),
            },
            toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
            product: { findMany: vi.fn().mockResolvedValue([{ id: 2, category: 'espresso' }]) },
            ingredient: { findMany: vi.fn().mockResolvedValue([]) },
          }),
        ),
      };
      await expect(
        new OrdersService(prismaCountMock).createOrder(
          { items: [{ productId: 2, size: 'L', toppings: [], quantity: 1 }] },
          1,
        ),
      ).rejects.toThrow(BadRequestException);

      // Case B: matchedProduct.recipes is explicitly []
      const prismaEmptyRecipesProp: any = {
        product: {
          findMany: vi.fn().mockResolvedValue([
            { id: 3, name: 'Trà Chưa Cấu Hình', basePrice: 35000, category: 'tea', isActive: true, recipes: [] },
          ]),
        },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        storeSetting: { findMany: vi.fn().mockResolvedValue([]) },
      };
      await expect(
        new OrdersService(prismaEmptyRecipesProp).createOrder(
          { items: [{ productId: 3, size: 'M', toppings: [], quantity: 1 }] },
          1,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('Bug #5 (RBAC deleteOrder): blocks STAFF deleting another user order while allowing ADMIN or owner', async () => {
      const makePrisma = (orderOwnerId: number): any => ({
        order: {
          findUnique: vi.fn().mockResolvedValue({
            id: 50,
            userId: orderOwnerId,
            status: OrderStatus.CANCELLED,
            items: [],
          }),
        },
        $transaction: vi.fn(async (cb: any) =>
          cb({
            payment: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
            orderItem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
            order: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
          }),
        ),
      });

      await expect(
        new OrdersService(makePrisma(77)).deleteOrder(50, 99, Role.STAFF),
      ).rejects.toThrow(ForbiddenException);

      const adminRes = await new OrdersService(makePrisma(77)).deleteOrder(50, 1, Role.ADMIN);
      expect(adminRes.success).toBe(true);

      const ownerRes = await new OrdersService(makePrisma(77)).deleteOrder(50, 77, Role.CUSTOMER);
      expect(ownerRes.success).toBe(true);
    });

    it('Bug #6 (Auth): normalizes email on register/login, rejects whitespace passwords, and returns new accessToken on password change', async () => {
      const existingHash = await bcrypt.hash('OldPass123', 10);
      const prisma: any = {
        user: {
          findUnique: vi.fn(),
          create: vi.fn().mockImplementation(async ({ data }: any) => ({
            id: 42,
            ...data,
            isActive: true,
            loyaltyPoints: 0,
            tokenVersion: 0,
            createdAt: new Date(),
          })),
          update: vi.fn().mockResolvedValue({
            id: 42,
            email: 'user@brewlite.vn',
            fullName: 'Test User',
            phone: null,
            role: Role.CUSTOMER,
            isActive: true,
            loyaltyPoints: 0,
            createdAt: new Date(),
          }),
        },
      };
      const jwt: any = { sign: vi.fn().mockReturnValue('signed-token-v4') };
      const authSvc = new AuthService(prisma, jwt);

      // Register normalizes email
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const regRes = await authSvc.register({
        email: '  User@BrewLite.VN  ',
        password: 'ValidPassword1',
        fullName: '  Nguyen Van A ',
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'user@brewlite.vn' } });
      expect(regRes.user.email).toBe('user@brewlite.vn');

      // Login normalizes email
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 42,
        email: 'user@brewlite.vn',
        passwordHash: existingHash,
        role: Role.CUSTOMER,
        isActive: true,
        tokenVersion: 3,
      });
      const loginRes = await authSvc.login({ email: '  USER@BREWLITE.VN  ', password: 'OldPass123' });
      expect(prisma.user.findUnique).toHaveBeenLastCalledWith({ where: { email: 'user@brewlite.vn' } });
      expect(loginRes.accessToken).toBe('signed-token-v4');

      // Whitespace-only password rejected in service + DTOs
      await expect(
        authSvc.register({ email: 'a@b.com', password: '      ', fullName: 'A' }),
      ).rejects.toThrow(BadRequestException);

      prisma.user.findUnique.mockResolvedValueOnce({
        id: 42,
        email: 'user@brewlite.vn',
        passwordHash: existingHash,
        role: Role.CUSTOMER,
        tokenVersion: 3,
      });
      await expect(
        authSvc.updateProfile(42, { currentPassword: 'OldPass123', newPassword: '      ' }),
      ).rejects.toThrow(BadRequestException);

      const regDtoErrors = await validate(
        plainToInstance(RegisterDto, { email: 'a@b.com', password: '      ', fullName: 'Nguyen A' }),
      );
      expect(regDtoErrors.length).toBeGreaterThan(0);

      const updDtoErrors = await validate(
        plainToInstance(UpdateProfileDto, { currentPassword: 'OldPass123', newPassword: '      ' }),
      );
      expect(updDtoErrors.length).toBeGreaterThan(0);

      // updateProfile issues new accessToken with incremented tokenVersion when password changes
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 42,
        email: 'user@brewlite.vn',
        passwordHash: existingHash,
        role: Role.CUSTOMER,
        tokenVersion: 3,
      });
      const profRes: any = await authSvc.updateProfile(42, {
        currentPassword: 'OldPass123',
        newPassword: 'NewStrongPassword9!',
      });
      expect(profRes.accessToken).toBe('signed-token-v4');
      expect(jwt.sign).toHaveBeenLastCalledWith(
        expect.objectContaining({ sub: 42, tokenVersion: 4 }),
      );
    });

    it('Bug #7 (Type guard & DTO): rejects non-string appTransId cleanly and blocks duplicate/HTML toppings in OrderItemDto', async () => {
      const prisma: any = {
        order: {
          findUnique: vi.fn().mockResolvedValue({
            id: 15,
            userId: 5,
            status: OrderStatus.PENDING,
            totalAmount: 50000,
          }),
        },
      };
      const paySvc = new PaymentsService(prisma, undefined, new ZaloPayService());

      await expect(
        paySvc.getZaloPayStatus(15, 5, ['261115_15_1', 'other'] as any, Role.CUSTOMER),
      ).rejects.toThrow(BadRequestException);
      await expect(
        paySvc.confirmZaloPaySandbox(15, 5, Role.CUSTOMER, { malicious: true } as any),
      ).rejects.toThrow(BadRequestException);

      const dupToppingsErrors = await validate(
        plainToInstance(OrderItemDto, {
          productId: 1,
          size: 'M',
          toppings: ['Trân châu trắng', '  trân châu trắng  '],
          quantity: 1,
        }),
      );
      expect(dupToppingsErrors.some((e) => e.property === 'toppings')).toBe(true);

      const xssItemErrors = await validate(
        plainToInstance(OrderItemDto, {
          productId: 1,
          productName: '<script>alert(1)</script>',
          size: 'M',
          toppings: ['<img src=x onerror=alert(1)>'],
          quantity: 1,
        }),
      );
      expect(xssItemErrors.some((e) => e.property === 'productName')).toBe(true);
      expect(xssItemErrors.some((e) => e.property === 'toppings')).toBe(true);
    });

    it('Final Pass — normalizes/rejects malformed Idempotency-Key, blocks whitespace-only Product/Customer/Redeem DTOs, and filters inactive DiscountCodes from wallet', async () => {
      // 1. Idempotency-Key: whitespace-only is ignored (no findUnique lookup), duplicate header array -> 400
      const orderPrisma: any = {
        order: {
          findUnique: vi.fn(),
        },
        product: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        storeSetting: { findMany: vi.fn().mockResolvedValue([]) },
      };
      const ordersSvc = new OrdersService(orderPrisma);
      await expect(
        ordersSvc.createOrder(
          { items: [{ productId: 1, size: 'M', toppings: [], quantity: 1 }] },
          1,
          ['k1', 'k2'] as any,
        ),
      ).rejects.toThrow(BadRequestException);

      // Whitespace-only idempotencyKey should NOT query userId_idempotencyKey
      await expect(
        ordersSvc.createOrder(
          { items: [{ productId: 999, size: 'M', toppings: [], quantity: 1 }] },
          1,
          '   ',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(orderPrisma.order.findUnique).not.toHaveBeenCalled();

      const payPrisma: any = {
        order: {
          findUnique: vi.fn().mockResolvedValue({
            id: 1,
            userId: 1,
            status: OrderStatus.CANCELLED,
            totalAmount: 30000,
          }),
        },
        payment: { findUnique: vi.fn() },
      };
      const paySvc = new PaymentsService(payPrisma, undefined, undefined as any);
      await expect(
        paySvc.processPayment({ orderId: 1, method: PaymentMethod.EWALLET }, 1, ['k1', 'k2'] as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        paySvc.processPayment({ orderId: 1, method: PaymentMethod.EWALLET }, 1, '   '),
      ).rejects.toThrow(BadRequestException);
      expect(payPrisma.payment.findUnique).not.toHaveBeenCalled();

      // 2. Whitespace-only & XSS DTO checks for Product, Customer, RedeemPoints
      const prodCreateErrs = await validate(
        plainToInstance(CreateProductDto, { name: '   ', basePrice: 30000 }),
      );
      expect(prodCreateErrs.some((e) => e.property === 'name')).toBe(true);

      const prodUpdErrs = await validate(plainToInstance(UpdateProductDto, { name: '   ' }));
      expect(prodUpdErrs.some((e) => e.property === 'name')).toBe(true);

      const custCreateErrs = await validate(
        plainToInstance(CreateCustomerDto, {
          email: 'c@brewlite.vn',
          fullName: '   ',
          password: '      ',
        }),
      );
      expect(custCreateErrs.some((e) => e.property === 'fullName')).toBe(true);
      expect(custCreateErrs.some((e) => e.property === 'password')).toBe(true);

      const custUpdErrs = await validate(
        plainToInstance(UpdateCustomerDto, { fullName: '   ', password: '      ' }),
      );
      expect(custUpdErrs.some((e) => e.property === 'fullName')).toBe(true);
      expect(custUpdErrs.some((e) => e.property === 'password')).toBe(true);

      const redeemErrs = await validate(
        plainToInstance(RedeemPointsDto, {
          points: 10,
          voucherCode: '   ',
          description: '<script>alert(1)</script>',
        }),
      );
      expect(redeemErrs.some((e) => e.property === 'voucherCode')).toBe(true);
      expect(redeemErrs.some((e) => e.property === 'description')).toBe(true);

      // 3. Inactive DiscountCode vouchers hidden in getUserVouchers & getProfile
      const authPrisma: any = {
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: 1,
            email: 'u@brewlite.vn',
            fullName: 'User',
            phone: null,
            role: Role.CUSTOMER,
            isActive: true,
            loyaltyPoints: 50,
            createdAt: new Date(),
            vouchers: [
              { id: 1, code: 'BREW10', quantity: 1 },
              { id: 2, code: 'DISABLED_CODE', quantity: 1 },
            ],
          }),
        },
        userVoucher: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, code: 'BREW10', quantity: 1 },
            { id: 2, code: 'DISABLED_CODE', quantity: 1 },
          ]),
        },
        discountCode: {
          findMany: vi.fn().mockResolvedValue([{ code: 'DISABLED_CODE' }]),
        },
      };
      const authSvc = new AuthService(authPrisma, { sign: vi.fn() } as any);
      const wallet = await authSvc.getUserVouchers(1);
      expect(wallet.map((v: any) => v.code)).toEqual(['BREW10']);
      const profile = await authSvc.getProfile(1);
      expect(profile.vouchers.map((v: any) => v.code)).toEqual(['BREW10']);
    });
  });
});
