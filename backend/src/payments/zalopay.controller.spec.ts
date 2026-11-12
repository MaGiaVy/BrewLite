import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { OrderStatus, PaymentMethod, PaymentStatus, Role } from '@prisma/client';
import { PaymentsService } from './payments.service.js';
import { PaymentsController } from './payments.controller.js';
import { ROLES_KEY } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

describe('ZaloPay Integration — Service & Controller Endpoints', () => {
  let service: PaymentsService;
  let controller: PaymentsController;
  let mockPrisma: any;
  let mockPaymentService: any;
  let mockZaloPayService: any;

  beforeEach(() => {
    mockPrisma = {
      order: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      payment: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      user: {
        update: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => cb(mockPrisma)),
    };

    mockPaymentService = {
      processPayment: vi.fn(),
    };

    mockZaloPayService = {
      createOrder: vi.fn(),
      verifyCallback: vi.fn(),
      queryStatus: vi.fn(),
    };

    service = new PaymentsService(
      mockPrisma as any,
      mockPaymentService as any,
      mockZaloPayService as any,
    );

    controller = new PaymentsController(service);
  });

  describe('POST /payments/zalopay/create', () => {
    it('gọi createZaloPayOrder và trả về link thanh toán', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 77,
        userId: 1,
        totalAmount: 110000,
        status: OrderStatus.PENDING,
        createdAt: new Date(),
      });

      mockZaloPayService.createOrder.mockResolvedValue({
        returnCode: 1,
        returnMessage: 'Giao dịch thành công',
        subReturnCode: 1,
        subReturnMessage: 'Giao dịch thành công',
        orderUrl: 'https://qcgateway.zalopay.vn/pay?token=test_token',
        zpTransToken: 'test_token',
        orderToken: 'test_token',
        appTransId: '261023_77_123456',
      });

      const req: any = { user: { userId: 1, email: 'test@brewlite.com', role: Role.CUSTOMER } };
      const res = await controller.createZaloPayOrder(req, 77);

      expect(res.returnCode).toBe(1);
      expect(res.orderUrl).toBe('https://qcgateway.zalopay.vn/pay?token=test_token');
      expect(mockZaloPayService.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 77,
          amount: 110000,
        }),
      );
    });

    it('ném NotFoundException nếu orderId không tồn tại', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      const req: any = { user: { userId: 1, email: 'test@brewlite.com', role: Role.CUSTOMER } };
      await expect(controller.createZaloPayOrder(req, 999)).rejects.toThrow();
    });

    it('ném ForbiddenException nếu userId không trùng với chủ đơn hàng', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 77,
        userId: 1, // Chủ đơn là User 1
        totalAmount: 110000,
        status: OrderStatus.PENDING,
        createdAt: new Date(),
      });

      const req: any = { user: { userId: 2, email: 'other@brewlite.com', role: Role.CUSTOMER } }; // User 2 gọi
      await expect(controller.createZaloPayOrder(req, 77)).rejects.toThrow(ForbiddenException);
    });

    it('ném BadRequestException nếu đơn hàng không ở trạng thái PENDING', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 77,
        userId: 1,
        totalAmount: 110000,
        status: OrderStatus.PAID,
        createdAt: new Date(),
      });

      const req: any = { user: { userId: 1, email: 'test@brewlite.com', role: Role.CUSTOMER } };
      await expect(controller.createZaloPayOrder(req, 77)).rejects.toThrow(BadRequestException);
    });
  });

  describe('POST /payments/zalopay/callback', () => {
    it('từ chối callback nếu chữ ký MAC không khớp', async () => {
      mockZaloPayService.verifyCallback.mockReturnValue(false);

      const res = await controller.handleZaloPayCallback({
        data: '{"app_trans_id": "test"}',
        mac: 'invalid_mac',
      });

      expect(res.return_code).toBe(-1);
      expect(res.return_message).toBe('mac not equal');
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it('handleZaloPayCallback cập nhật trạng thái đơn PAID khi MAC hợp lệ', async () => {
      mockZaloPayService.verifyCallback.mockReturnValue(true);

      const callbackData = {
        app_trans_id: '261023_77_998877',
        amount: 110000,
        zp_trans_id: 12345678,
        embed_data: JSON.stringify({ orderId: 77 }),
      };

      mockPrisma.order.findUnique.mockResolvedValue({
        id: 77,
        userId: 1,
        status: OrderStatus.PENDING,
        totalAmount: 110000,
      });

      mockPrisma.payment.create.mockResolvedValue({
        id: 55,
        orderId: 77,
        amount: 110000,
        method: PaymentMethod.EWALLET,
        status: PaymentStatus.SUCCESS,
      });

      const res = await controller.handleZaloPayCallback({
        data: JSON.stringify(callbackData),
        mac: 'valid_mac_key2',
      });

      expect(res.return_code).toBe(1);
      expect(res.return_message).toBe('success');
      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 77, status: OrderStatus.PENDING },
          data: expect.objectContaining({ status: OrderStatus.PAID }),
        }),
      );
    });

    it('idempotency: trả về return_code: 1 ngay nếu đơn hàng đã PAID', async () => {
      mockZaloPayService.verifyCallback.mockReturnValue(true);

      const callbackData = {
        app_trans_id: '261023_77_998877',
        amount: 110000,
        zp_trans_id: 12345678,
        embed_data: JSON.stringify({ orderId: 77 }),
      };

      mockPrisma.order.findUnique.mockResolvedValue({
        id: 77,
        userId: 1,
        status: OrderStatus.PAID,
        totalAmount: 110000,
      });

      const res = await controller.handleZaloPayCallback({
        data: JSON.stringify(callbackData),
        mac: 'valid_mac_key2',
      });

      expect(res.return_code).toBe(1);
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it('HIGH-09: không lùi trạng thái đơn khi webhook retry cho đơn đã PREPARING / READY / COMPLETED', async () => {
      mockZaloPayService.verifyCallback.mockReturnValue(true);

      const callbackData = {
        app_trans_id: '261023_77_998877',
        amount: 110000,
        zp_trans_id: 12345678,
        embed_data: JSON.stringify({ orderId: 77 }),
      };

      for (const status of [OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.COMPLETED]) {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 77,
          userId: 1,
          status,
          totalAmount: 110000,
        });

        const res = await controller.handleZaloPayCallback({
          data: JSON.stringify(callbackData),
          mac: 'valid_mac_key2',
        });

        expect(res.return_code).toBe(1);
        expect(res.return_message).toBe('Order already processed');
        expect(mockPrisma.order.update).not.toHaveBeenCalled();
      }
    });

    it('CRITICAL-06: trả về return_code: 2 khi callback thiếu amount hoặc amount rỗng', async () => {
      mockZaloPayService.verifyCallback.mockReturnValue(true);

      const callbackData = {
        app_trans_id: '261023_77_998877',
        amount: null,
        zp_trans_id: 12345678,
        embed_data: JSON.stringify({ orderId: 77 }),
      };

      mockPrisma.order.findUnique.mockResolvedValue({
        id: 77,
        userId: 1,
        status: OrderStatus.PENDING,
        totalAmount: 110000,
      });

      const res = await controller.handleZaloPayCallback({
        data: JSON.stringify(callbackData),
        mac: 'valid_mac_key2',
      });

      expect(res.return_code).toBe(2);
      expect(res.return_message).toBe('Số tiền thanh toán không khớp đơn hàng');
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it('CRITICAL-06: trả về return_code: 2 khi callback amount lệch với totalAmount của đơn hàng', async () => {
      mockZaloPayService.verifyCallback.mockReturnValue(true);

      const callbackData = {
        app_trans_id: '261023_77_998877',
        amount: 50000, // Đơn 110.000 mà callback chỉ 50.000
        zp_trans_id: 12345678,
        embed_data: JSON.stringify({ orderId: 77 }),
      };

      mockPrisma.order.findUnique.mockResolvedValue({
        id: 77,
        userId: 1,
        status: OrderStatus.PENDING,
        totalAmount: 110000,
      });

      const res = await controller.handleZaloPayCallback({
        data: JSON.stringify(callbackData),
        mac: 'valid_mac_key2',
      });

      expect(res.return_code).toBe(2);
      expect(res.return_message).toBe('Số tiền thanh toán không khớp đơn hàng');
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it('HIGH-10: bắt lỗi Prisma P2002 khi tạo Payment trùng lặp và trả về return_code: 1', async () => {
      mockZaloPayService.verifyCallback.mockReturnValue(true);

      const callbackData = {
        app_trans_id: '261023_77_998877',
        amount: 110000,
        zp_trans_id: 12345678,
        embed_data: JSON.stringify({ orderId: 77 }),
      };

      mockPrisma.order.findUnique.mockResolvedValue({
        id: 77,
        userId: 1,
        status: OrderStatus.PENDING,
        totalAmount: 110000,
      });

      mockPrisma.payment.create.mockRejectedValue({ code: 'P2002' });

      const res = await controller.handleZaloPayCallback({
        data: JSON.stringify(callbackData),
        mac: 'valid_mac_key2',
      });

      expect(res.return_code).toBe(1);
    });

    it('chống replay attack: từ chối cập nhật PAID và trả về thông báo nếu đơn hàng đã CANCELLED', async () => {
      mockZaloPayService.verifyCallback.mockReturnValue(true);

      const callbackData = {
        app_trans_id: '261023_77_998877',
        amount: 110000,
        zp_trans_id: 12345678,
        embed_data: JSON.stringify({ orderId: 77 }),
      };

      mockPrisma.order.findUnique.mockResolvedValue({
        id: 77,
        userId: 1,
        status: OrderStatus.CANCELLED,
        totalAmount: 110000,
      });

      const res = await controller.handleZaloPayCallback({
        data: JSON.stringify(callbackData),
        mac: 'valid_mac_key2',
      });

      expect(res.return_code).toBe(1);
      expect(res.return_message).toBe('Đơn hàng đã hết hạn hoặc bị hủy');
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('GET /payments/zalopay/status/:orderId', () => {
    it('trả về isPaid: true ngay nếu order trong DB đã PAID', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 77,
        userId: 1,
        status: OrderStatus.PAID,
      });

      const req: any = { user: { userId: 1, email: 'test@brewlite.com', role: Role.CUSTOMER } };
      const res = await controller.getZaloPayStatus(req, 77);

      expect(res.isPaid).toBe(true);
      expect(mockZaloPayService.queryStatus).not.toHaveBeenCalled();
    });

    it('tra cứu ZaloPay queryStatus và tự động cập nhật đơn sang PAID khi nhận được tiền', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 77,
        userId: 1,
        status: OrderStatus.PENDING,
        totalAmount: 85000,
      });

      mockZaloPayService.queryStatus.mockResolvedValue({
        returnCode: 1,
        returnMessage: 'Giao dịch thành công',
        subReturnCode: 1,
        subReturnMessage: 'Giao dịch thành công',
        isProcessing: false,
        amount: 85000,
        zpTransId: 99887766,
      });

      const req: any = { user: { userId: 1, email: 'test@brewlite.com', role: Role.CUSTOMER } };
      const res = await controller.getZaloPayStatus(req, 77, '261023_77_123456');

      expect(res.isPaid).toBe(true);
      expect(res.zpTransId).toBe(99887766);
      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 77, status: OrderStatus.PENDING },
          data: expect.objectContaining({ status: OrderStatus.PAID }),
        }),
      );
    });

    it('ném BadRequestException nếu số tiền query trên ZaloPay không khớp với totalAmount của đơn', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 77,
        userId: 1,
        status: OrderStatus.PENDING,
        totalAmount: 100000,
      });

      mockZaloPayService.queryStatus.mockResolvedValue({
        returnCode: 1,
        isProcessing: false,
        amount: 50000, // Khác 100000
        zpTransId: 99887766,
      });

      const req: any = { user: { userId: 1, email: 'test@brewlite.com', role: Role.CUSTOMER } };
      await expect(
        controller.getZaloPayStatus(req, 77, '261023_77_123456'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('POST /payments/zalopay/confirm & cancel', () => {
    it('Task 5: endpoint confirmZaloPayOrder chỉ gắn JwtAuthGuard (bỏ @Roles(Role.ADMIN)) để CUSTOMER chủ đơn được phép xác nhận', () => {
      const confirmHandler = Object.getOwnPropertyDescriptor(
        PaymentsController.prototype,
        'confirmZaloPayOrder',
      )?.value as (this: void, ...args: unknown[]) => unknown;
      const roles = Reflect.getMetadata(ROLES_KEY, confirmHandler);
      expect(roles).toBeUndefined();

      const guards = Reflect.getMetadata('__guards__', confirmHandler);
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).not.toContain(RolesGuard);

      const reflector = new Reflector();
      const rolesGuard = new RolesGuard(reflector);
      const mockContext = {
        getHandler: () => confirmHandler,
        getClass: () => PaymentsController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { userId: 1, role: Role.CUSTOMER } }),
        }),
      } as unknown as ExecutionContext;
      expect(rolesGuard.canActivate(mockContext)).toBe(true);
    });

    describe('NestJS HTTP Guard & Pipe Pipeline — POST /payments/zalopay/confirm', () => {
      let app: any;
      let activeUser: { userId: number; email: string; role: Role };
      const originalEnv = process.env;

      beforeEach(async () => {
        process.env = { ...originalEnv, ALLOW_SANDBOX_CONFIRM: 'true' };
        activeUser = { userId: 1, email: 'owner@brewlite.com', role: Role.CUSTOMER };

        const moduleRef = await Test.createTestingModule({
          controllers: [PaymentsController],
          providers: [
            { provide: PaymentsService, useValue: service },
            RolesGuard,
            Reflector,
          ],
        })
          .overrideGuard(JwtAuthGuard)
          .useValue({
            canActivate: (context: ExecutionContext) => {
              const req = context.switchToHttp().getRequest();
              req.user = activeUser;
              return true;
            },
          })
          .compile();

        app = moduleRef.createNestApplication();
        await app.init();
      });

      afterEach(async () => {
        process.env = originalEnv;
        await app?.close();
      });

      it('cho phép Role.CUSTOMER là chủ đơn hàng xác nhận qua HTTP pipeline (HTTP 200)', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 77,
          userId: 1,
          totalAmount: 50000,
          status: OrderStatus.PENDING,
        });
        mockZaloPayService.createMockCallbackPayload = vi.fn().mockReturnValue({
          data: JSON.stringify({
            app_trans_id: '261024_77_112233',
            amount: 50000,
            zp_trans_id: 112233,
            embed_data: JSON.stringify({ orderId: 77 }),
          }),
          mac: 'valid_mock_mac',
        });
        mockZaloPayService.verifyCallback.mockReturnValue(true);

        const res = await request(app.getHttpServer())
          .post('/payments/zalopay/confirm')
          .send({ orderId: 77, appTransId: '261024_77_112233' })
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.status).toBe(OrderStatus.PAID);
      });

      it('cho phép request chỉ gửi appTransId (không gửi orderId) nhờ ParseIntPipe({ optional: true })', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 77,
          userId: 1,
          totalAmount: 50000,
          status: OrderStatus.PENDING,
        });
        mockZaloPayService.createMockCallbackPayload = vi.fn().mockReturnValue({
          data: JSON.stringify({
            app_trans_id: '261024_77_112233',
            amount: 50000,
            zp_trans_id: 112233,
            embed_data: JSON.stringify({ orderId: 77 }),
          }),
          mac: 'valid_mock_mac',
        });
        mockZaloPayService.verifyCallback.mockReturnValue(true);

        const res = await request(app.getHttpServer())
          .post('/payments/zalopay/confirm')
          .send({ appTransId: '261024_77_112233' })
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.orderId).toBe(77);
      });

      it('từ chối Role.CUSTOMER không phải chủ đơn hàng với HTTP 403 ForbiddenException', async () => {
        activeUser = { userId: 2, email: 'other@brewlite.com', role: Role.CUSTOMER };
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 77,
          userId: 1,
          totalAmount: 50000,
          status: OrderStatus.PENDING,
        });

        await request(app.getHttpServer())
          .post('/payments/zalopay/confirm')
          .send({ orderId: 77, appTransId: '261024_77_112233' })
          .expect(403);
      });

      it('từ chối orderId không phải số nguyên với HTTP 400 BadRequestException', async () => {
        await request(app.getHttpServer())
          .post('/payments/zalopay/confirm')
          .send({ orderId: 'invalid-id', appTransId: '261024_77_112233' })
          .expect(400);
      });

      it('BE-C1: chặn POST /payments/zalopay/cancel với đơn PAID khi caller là Role.CUSTOMER (HTTP 403) và chặn Role.STAFF không phải chủ đơn (HTTP 403)', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 77,
          userId: 1,
          totalAmount: 50000,
          status: OrderStatus.PAID,
          items: [],
        });

        await request(app.getHttpServer())
          .post('/payments/zalopay/cancel')
          .send({ orderId: 77 })
          .expect(403);

        activeUser = { userId: 99, email: 'staff@brewlite.com', role: Role.STAFF };
        await request(app.getHttpServer())
          .post('/payments/zalopay/cancel')
          .send({ orderId: 77 })
          .expect(403);
      });
    });

    describe('Sandbox Confirm/Cancel Unit Tests (ALLOW_SANDBOX_CONFIRM=true)', () => {
      const originalEnv = process.env;

      beforeEach(() => {
        process.env = { ...originalEnv, ALLOW_SANDBOX_CONFIRM: 'true' };
      });

      afterEach(() => {
        process.env = originalEnv;
      });

      it('confirmZaloPayOrder xác nhận thanh toán thành công và cập nhật đơn PAID', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 77,
          userId: 1,
          totalAmount: 50000,
          status: OrderStatus.PENDING,
        });

        mockZaloPayService.createMockCallbackPayload = vi.fn().mockReturnValue({
          data: JSON.stringify({
            app_trans_id: '261024_77_112233',
            amount: 50000,
            zp_trans_id: 112233,
            embed_data: JSON.stringify({ orderId: 77 }),
          }),
          mac: 'valid_mock_mac',
        });
        mockZaloPayService.verifyCallback.mockReturnValue(true);

        const req: any = { user: { userId: 1, email: 'test@brewlite.com', role: Role.CUSTOMER } };
        const res = await controller.confirmZaloPayOrder(req, 77, '261024_77_112233');
        expect(res.success).toBe(true);
        expect(res.status).toBe(OrderStatus.PAID);
        expect(mockPrisma.order.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 77, status: OrderStatus.PENDING },
            data: expect.objectContaining({ status: OrderStatus.PAID }),
          }),
        );
      });

      it('confirmZaloPayOrder ném ForbiddenException nếu không phải chủ đơn hàng', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 77,
          userId: 1, // Chủ đơn là User 1
          totalAmount: 50000,
          status: OrderStatus.PENDING,
        });

        const req: any = { user: { userId: 2, email: 'hacker@brewlite.com', role: Role.CUSTOMER } };
        await expect(
          controller.confirmZaloPayOrder(req, 77, '261024_77_112233'),
        ).rejects.toThrow(ForbiddenException);
      });

      it('confirmZaloPayOrder ném ForbiddenException khi ADMIN không phải chủ đơn hàng', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 77,
          userId: 1,
          totalAmount: 50000,
          status: OrderStatus.PENDING,
        });

        const req: any = { user: { userId: 99, email: 'admin@brewlite.com', role: Role.ADMIN } };
        await expect(
          controller.confirmZaloPayOrder(req, 77, '261024_77_112233'),
        ).rejects.toThrow(ForbiddenException);
      });

      it('cancelZaloPayOrder hủy giao dịch thành công', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 77,
          userId: 1,
          status: OrderStatus.PENDING,
        });

        const req: any = { user: { userId: 1, email: 'test@brewlite.com', role: Role.CUSTOMER } };
        const res = await controller.cancelZaloPayOrder(req, 77);
        expect(res.success).toBe(true);
        expect(res.message).toContain('đã được hủy');
      });

      it('cancelZaloPayOrder ném ForbiddenException nếu không phải chủ đơn hàng', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 77,
          userId: 1,
          status: OrderStatus.PENDING,
        });

        const req: any = { user: { userId: 2, email: 'other@brewlite.com', role: Role.CUSTOMER } };
        await expect(controller.cancelZaloPayOrder(req, 77)).rejects.toThrow(ForbiddenException);
      });

      it('cancelZaloPayOrder ném ForbiddenException khi ADMIN không phải chủ đơn hàng', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 77,
          userId: 1,
          status: OrderStatus.PENDING,
        });

        const req: any = { user: { userId: 99, email: 'admin@brewlite.com', role: Role.ADMIN } };
        await expect(controller.cancelZaloPayOrder(req, 77)).rejects.toThrow(ForbiddenException);
      });

      it('Task 5: cancelZaloPayOrder tạo lại UserVoucher đã xóa, giảm DiscountCode.usageCount (khi !voucherDeducted) và ghi CANCEL_REFUND đủ ingredientName & unit', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 78,
          userId: 1,
          status: OrderStatus.PAYMENT_FAILED,
          discountCode: 'PERSONAL15',
          voucherDeducted: true,
          items: [{ productId: 1, size: 'M', toppings: [], quantity: 1 }],
        });
        mockPrisma.inventoryLog = {
          findMany: vi.fn().mockResolvedValue([
            {
              ingredientId: 11,
              ingredientName: 'Trà ô long',
              unit: 'ml',
              changeAmount: -200,
            },
          ]),
          create: vi.fn().mockResolvedValue({}),
        };
        mockPrisma.ingredient = {
          update: vi.fn().mockResolvedValue({ id: 11, name: 'Trà ô long', unit: 'ml', stock: 1000 }),
        };
        mockPrisma.userVoucher = {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
        };
        mockPrisma.discountCode = {
          findUnique: vi.fn().mockResolvedValue({
            code: 'PERSONAL15',
            discountPercent: 15,
            minOrderAmount: 30000,
            maxDiscountAmount: 25000,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        };

        const req: any = { user: { userId: 1, email: 'test@brewlite.com', role: Role.CUSTOMER } };
        const res = await controller.cancelZaloPayOrder(req, 78);

        expect(res.success).toBe(true);
        expect(mockPrisma.userVoucher.create).toHaveBeenCalledWith({
          data: {
            userId: 1,
            code: 'PERSONAL15',
            quantity: 1,
            discountPercent: 15,
            minOrderAmount: 30000,
            maxDiscountAmount: 25000,
          },
        });
        expect(mockPrisma.inventoryLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              type: 'CANCEL_REFUND',
              ingredientName: 'Trà ô long',
              unit: 'ml',
            }),
          }),
        );

        // Kiểm tra đơn dùng mã toàn hệ thống (!voucherDeducted) -> giảm usageCount
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 79,
          userId: 1,
          status: OrderStatus.PENDING,
          discountCode: 'GLOBAL10',
          voucherDeducted: false,
          items: [],
        });
        await controller.cancelZaloPayOrder(req, 79);
        expect(mockPrisma.discountCode.updateMany).toHaveBeenCalledWith({
          where: { code: 'GLOBAL10', usageCount: { gt: 0 } },
          data: { usageCount: { decrement: 1 } },
        });
      });
    });
  });

  describe('Default-Deny Sandbox Confirm/Cancel across all NODE_ENV values', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
    });

    it.each(['development', 'test', 'production', undefined])(
      'chặn confirmZaloPayOrder và cancelZaloPayOrder khi ALLOW_SANDBOX_CONFIRM chưa set với NODE_ENV=%s',
      (nodeEnv) => {
        process.env = { ...originalEnv };
        delete process.env.ALLOW_SANDBOX_CONFIRM;
        if (nodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = nodeEnv;
        }

        const req: any = { user: { userId: 1, email: 'test@brewlite.com', role: Role.CUSTOMER } };
        expect(() =>
          controller.confirmZaloPayOrder(req, 77, '261024_77_112233'),
        ).toThrow(ForbiddenException);
        expect(() => controller.cancelZaloPayOrder(req, 77)).toThrow(ForbiddenException);
      },
    );
  });

  describe('BE-C1 & BE-M4: Production Environment Gates (NODE_ENV=production)', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: 'production' };
      delete process.env.ALLOW_MOCK_PAYMENT;
      delete process.env.ALLOW_SANDBOX_CONFIRM;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('chặn POST /payments (processPayment) khi NODE_ENV=production và ALLOW_MOCK_PAYMENT !== true', () => {
      const req: any = { user: { userId: 1, email: 'test@brewlite.com', role: Role.CUSTOMER } };
      expect(() =>
        controller.processPayment(req, { orderId: 77, method: PaymentMethod.EWALLET }),
      ).toThrow(ForbiddenException);
    });

    it('cho phép POST /payments (processPayment) trong production khi ALLOW_MOCK_PAYMENT=true', async () => {
      process.env.ALLOW_MOCK_PAYMENT = 'true';
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 77,
        userId: 1,
        totalAmount: 50000,
        status: OrderStatus.PENDING,
        version: 0,
        createdAt: new Date(),
      });
      mockPaymentService.processPayment.mockResolvedValue({
        success: true,
        transactionId: 'TXN-PROD-DEMO',
        message: 'OK',
      });
      mockPrisma.payment.create.mockResolvedValue({
        id: 901,
        orderId: 77,
        amount: 50000,
        method: PaymentMethod.EWALLET,
        status: PaymentStatus.SUCCESS,
      });

      const req: any = { user: { userId: 1, email: 'test@brewlite.com', role: Role.CUSTOMER } };
      const res = await controller.processPayment(req, {
        orderId: 77,
        method: PaymentMethod.EWALLET,
      });
      expect(res.success).toBe(true);
    });

    it('chặn POST /payments/zalopay/confirm khi NODE_ENV=production và ALLOW_SANDBOX_CONFIRM !== true', () => {
      const req: any = { user: { userId: 1, email: 'test@brewlite.com', role: Role.CUSTOMER } };
      expect(() =>
        controller.confirmZaloPayOrder(req, 77, '261024_77_112233'),
      ).toThrow(ForbiddenException);
    });

    it('chặn POST /payments/zalopay/cancel khi NODE_ENV=production và ALLOW_SANDBOX_CONFIRM !== true', () => {
      const req: any = { user: { userId: 1, email: 'test@brewlite.com', role: Role.CUSTOMER } };
      expect(() => controller.cancelZaloPayOrder(req, 77)).toThrow(ForbiddenException);
    });

    it('cho phép confirm & cancel ZaloPay sandbox trong production khi ALLOW_SANDBOX_CONFIRM=true', async () => {
      process.env.ALLOW_SANDBOX_CONFIRM = 'true';
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 77,
        userId: 1,
        totalAmount: 50000,
        status: OrderStatus.PENDING,
      });
      mockZaloPayService.createMockCallbackPayload = vi.fn().mockReturnValue({
        data: JSON.stringify({
          app_trans_id: '261024_77_112233',
          amount: 50000,
          zp_trans_id: 112233,
          embed_data: JSON.stringify({ orderId: 77 }),
        }),
        mac: 'valid_mock_mac',
      });
      mockZaloPayService.verifyCallback.mockReturnValue(true);

      const req: any = { user: { userId: 1, email: 'test@brewlite.com', role: Role.CUSTOMER } };
      const confirmRes = await controller.confirmZaloPayOrder(req, 77, '261024_77_112233');
      expect(confirmRes.success).toBe(true);

      const cancelRes = await controller.cancelZaloPayOrder(req, 77);
      expect(cancelRes.success).toBe(true);
    });
  });
});
