import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentMethod, PaymentStatus, Role } from '@prisma/client';
import { PaymentsService } from './payments.service.js';
import { MockPaymentService } from './mock-payment.service.js';
import { assertTransition } from './state-machine.helper.js';

describe('Task 10 — Payments, State Machine, Idempotency, Optimistic Locking & Loyalty Tests', () => {
  describe('State Machine Guard (assertTransition)', () => {
    it('cho phép chuyển từ PENDING sang PAID', () => {
      expect(() => assertTransition(OrderStatus.PENDING, OrderStatus.PAID)).not.toThrow();
    });

    it('cho phép chuyển từ PENDING sang PAYMENT_FAILED', () => {
      expect(() => assertTransition(OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED)).not.toThrow();
    });

    it('cho phép chuyển từ PENDING sang CANCELLED', () => {
      expect(() => assertTransition(OrderStatus.PENDING, OrderStatus.CANCELLED)).not.toThrow();
    });

    it('cho phép chuyển từ PAYMENT_FAILED sang PENDING khi khách hàng thử lại thanh toán', () => {
      expect(() => assertTransition(OrderStatus.PAYMENT_FAILED, OrderStatus.PENDING)).not.toThrow();
    });

    it('cho phép chuyển từ PAYMENT_FAILED sang CANCELLED', () => {
      expect(() => assertTransition(OrderStatus.PAYMENT_FAILED, OrderStatus.CANCELLED)).not.toThrow();
    });

    it('chặn chuyển trực tiếp từ PAYMENT_FAILED sang PAID và chặn self-loop PAYMENT_FAILED -> PAYMENT_FAILED', () => {
      expect(() => assertTransition(OrderStatus.PAYMENT_FAILED, OrderStatus.PAID)).toThrow(BadRequestException);
      expect(() => assertTransition(OrderStatus.PAYMENT_FAILED, OrderStatus.PAYMENT_FAILED)).toThrow(
        BadRequestException,
      );
    });

    it('cho phép chuyển từ PAID sang PREPARING (Barista bắt đầu pha chế)', () => {
      expect(() => assertTransition(OrderStatus.PAID, OrderStatus.PREPARING)).not.toThrow();
    });

    it('cho phép chuyển từ PAID sang CANCELLED', () => {
      expect(() => assertTransition(OrderStatus.PAID, OrderStatus.CANCELLED)).not.toThrow();
    });

    it('cho phép chuyển từ PREPARING sang READY (Pha chế xong, chờ nhận)', () => {
      expect(() => assertTransition(OrderStatus.PREPARING, OrderStatus.READY)).not.toThrow();
    });

    it('cho phép chuyển từ READY sang COMPLETED (Khách đã nhận nước)', () => {
      expect(() => assertTransition(OrderStatus.READY, OrderStatus.COMPLETED)).not.toThrow();
    });

    it('chặn hủy đơn khi đang pha chế hoặc đã sẵn sàng (PREPARING -> CANCELLED, READY -> CANCELLED)', () => {
      expect(() => assertTransition(OrderStatus.PREPARING, OrderStatus.CANCELLED)).toThrow(BadRequestException);
      expect(() => assertTransition(OrderStatus.READY, OrderStatus.CANCELLED)).toThrow(BadRequestException);
    });

    it('chặn chuyển từ COMPLETED sang bất kỳ trạng thái nào (Terminal State)', () => {
      for (const next of Object.values(OrderStatus)) {
        expect(() => assertTransition(OrderStatus.COMPLETED, next)).toThrow(BadRequestException);
      }
    });

    it('chặn chuyển từ CANCELLED sang bất kỳ trạng thái nào (Terminal State)', () => {
      for (const next of Object.values(OrderStatus)) {
        expect(() => assertTransition(OrderStatus.CANCELLED, next)).toThrow(BadRequestException);
      }
    });

    it('chặn chuyển ngược từ READY về PENDING (Backward transition)', () => {
      expect(() => assertTransition(OrderStatus.READY, OrderStatus.PENDING)).toThrow(BadRequestException);
    });
  });

  describe('MockPaymentService', () => {
    let mockPaymentService: MockPaymentService;

    beforeEach(() => {
      mockPaymentService = new MockPaymentService();
    });

    it('trả về success=true khi không có simulateFailure', async () => {
      const result = await mockPaymentService.processPayment({
        amount: 85000,
        method: PaymentMethod.EWALLET,
        simulateFailure: false,
      });

      expect(result.success).toBe(true);
      expect(result.transactionId).toBeDefined();
      expect(result.message).toContain('thành công');
    });

    it('trả về success=false khi simulateFailure=true', async () => {
      const result = await mockPaymentService.processPayment({
        amount: 85000,
        method: PaymentMethod.BANK_CARD,
        simulateFailure: true,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('bị từ chối');
    });
  });

  describe('PaymentsService Protection & Logic', () => {
    let service: PaymentsService;
    let mockPrisma: any;
    let mockPaymentService: any;

    beforeEach(() => {
      mockPrisma = {
        payment: {
          findUnique: vi.fn(),
          create: vi.fn(),
          upsert: vi.fn(),
          update: vi.fn(),
        },
        order: {
          findUnique: vi.fn(),
          update: vi.fn(),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        user: {
          update: vi.fn(),
        },
        $transaction: vi.fn(async (cb) => cb(mockPrisma)),
      };
      mockPaymentService = {
        processPayment: vi.fn(),
      };
      service = new PaymentsService(mockPrisma as any, mockPaymentService as any, {} as any);
    });

    it('ném NotFoundException nếu đơn hàng không tồn tại', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.processPayment({ orderId: 999, method: PaymentMethod.EWALLET }, 1),
      ).rejects.toThrow(NotFoundException);
    });

    it('chống IDOR: ném ForbiddenException nếu userId không khớp với chủ đơn hàng', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 10,
        userId: 1, // Chủ đơn là User 1
        totalAmount: 50000,
        status: OrderStatus.PENDING,
      });

      await expect(
        service.processPayment({ orderId: 10, method: PaymentMethod.EWALLET }, 2, undefined, Role.CUSTOMER), // User 2 gọi thanh toán
      ).rejects.toThrow(ForbiddenException);
    });

    describe('Idempotency Key Handling & Retry (Task 2.6)', () => {
      it('trả về kết quả cũ với isIdempotent=true nếu key đã tồn tại và status là SUCCESS', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 5,
          userId: 1,
          totalAmount: 85000,
          status: OrderStatus.PAID,
        });
        mockPrisma.payment.findUnique.mockResolvedValue({
          id: 100,
          orderId: 5,
          amount: 85000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.SUCCESS,
          order: { status: OrderStatus.PAID },
        });

        const result = await service.processPayment(
          { orderId: 5, method: PaymentMethod.EWALLET },
          1,
          'idempotency-key-123',
        );

        expect(result.isIdempotent).toBe(true);
        expect(result.paymentId).toBe(100);
        expect(result.status).toBe(OrderStatus.PAID);
        expect(mockPaymentService.processPayment).not.toHaveBeenCalled();
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      });

      it('BE-C5: kiểm tra tồn tại và quyền sở hữu đơn TRƯỚC khi tra cứu Idempotency-Key (chống leak qua key người khác)', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 10,
          userId: 1,
          totalAmount: 85000,
          status: OrderStatus.PAID,
        });
        mockPrisma.payment.findUnique.mockResolvedValue({
          id: 100,
          orderId: 10,
          amount: 85000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.SUCCESS,
          order: { status: OrderStatus.PAID },
        });

        await expect(
          service.processPayment(
            { orderId: 10, method: PaymentMethod.EWALLET },
            2,
            'victim-idempotency-key',
            Role.CUSTOMER,
          ),
        ).rejects.toThrow(ForbiddenException);

        expect(mockPrisma.payment.findUnique).not.toHaveBeenCalled();
      });

      it('BE-C5: ném ConflictException nếu dùng lại Idempotency-Key đã gắn với đơn hàng khác (SUCCESS)', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 6,
          userId: 1,
          totalAmount: 50000,
          status: OrderStatus.PENDING,
        });
        mockPrisma.payment.findUnique.mockResolvedValue({
          id: 100,
          orderId: 5, // Khác orderId 6
          amount: 85000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.SUCCESS,
          order: { status: OrderStatus.PAID },
        });

        await expect(
          service.processPayment(
            { orderId: 6, method: PaymentMethod.EWALLET },
            1,
            'shared-key-order-5',
            Role.CUSTOMER,
          ),
        ).rejects.toThrow(ConflictException);
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      });

      it('BE-C5: ném ConflictException nếu dùng lại Idempotency-Key FAILED của đơn hàng khác (chống hijack upsert)', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 6,
          userId: 1,
          totalAmount: 50000,
          status: OrderStatus.PENDING,
        });
        mockPrisma.payment.findUnique.mockResolvedValue({
          id: 99,
          orderId: 5,
          amount: 85000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.FAILED,
        });

        await expect(
          service.processPayment(
            { orderId: 6, method: PaymentMethod.EWALLET },
            1,
            'failed-key-order-5',
            Role.CUSTOMER,
          ),
        ).rejects.toThrow(ConflictException);
        expect(mockPrisma.payment.upsert).not.toHaveBeenCalled();
      });

      it('BE-C5: ném ConflictException nếu P2002 đồng thời trong transaction thuộc về đơn hàng khác', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 6,
          userId: 1,
          totalAmount: 50000,
          status: OrderStatus.PENDING,
          version: 0,
        });
        mockPrisma.payment.findUnique
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 200,
            orderId: 99, // Thuộc đơn khác
            amount: 50000,
            method: PaymentMethod.EWALLET,
            status: PaymentStatus.SUCCESS,
            order: { status: OrderStatus.PAID },
          });
        mockPaymentService.processPayment.mockResolvedValue({
          success: true,
          transactionId: 'TXN-RACE',
          message: 'Thành công',
        });
        mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.payment.create.mockRejectedValueOnce({ code: 'P2002' });

        await expect(
          service.processPayment(
            { orderId: 6, method: PaymentMethod.EWALLET },
            1,
            'concurrent-foreign-key',
            Role.CUSTOMER,
          ),
        ).rejects.toThrow(ConflictException);
      });

      it('BE-C4: bọc payment create trong SAVEPOINT và thực thi ROLLBACK TO SAVEPOINT khi gặp P2002', async () => {
        mockPrisma.$executeRawUnsafe = vi.fn().mockResolvedValue(undefined);
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 5,
          userId: 1,
          totalAmount: 85000,
          status: OrderStatus.PENDING,
          version: 1,
        });
        mockPrisma.payment.findUnique
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 105,
            orderId: 5,
            amount: 85000,
            method: PaymentMethod.EWALLET,
            status: PaymentStatus.SUCCESS,
            order: { status: OrderStatus.PAID },
          });
        mockPaymentService.processPayment.mockResolvedValue({
          success: true,
          transactionId: 'TXN-SAVEPOINT',
          message: 'Thành công',
        });
        mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.payment.create.mockRejectedValueOnce({ code: 'P2002' });

        const result = await service.processPayment(
          { orderId: 5, method: PaymentMethod.EWALLET },
          1,
          'savepoint-key-race',
          Role.CUSTOMER,
        );

        expect(result.isIdempotent).toBe(true);
        const rawCalls = mockPrisma.$executeRawUnsafe.mock.calls.map((c: any[]) => c[0]);
        expect(rawCalls.some((q: string) => q.startsWith('SAVEPOINT '))).toBe(true);
        expect(rawCalls.some((q: string) => q.startsWith('ROLLBACK TO SAVEPOINT '))).toBe(true);
      });

      it('tiếp tục xử lý nếu idempotencyKey tồn tại nhưng trạng thái trước đó là FAILED', async () => {
        // Giao dịch cũ bị FAILED
        mockPrisma.payment.findUnique.mockResolvedValue({
          id: 99,
          orderId: 5,
          amount: 85000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.FAILED,
        });

        mockPrisma.order.findUnique.mockResolvedValue({
          id: 5,
          userId: 1,
          totalAmount: 85000,
          status: OrderStatus.PAYMENT_FAILED,
          version: 1,
        });

        mockPaymentService.processPayment.mockResolvedValue({
          success: true,
          transactionId: 'TXN-NEW',
          message: 'Thành công',
        });

        mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.payment.create.mockResolvedValue({
          id: 101,
          orderId: 5,
          amount: 85000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.SUCCESS,
        });

        const result = await service.processPayment(
          { orderId: 5, method: PaymentMethod.EWALLET },
          1,
          'idempotency-key-failed',
        );

        expect(result.success).toBe(true);
        expect(result.paymentId).toBe(101);
        expect(mockPaymentService.processPayment).toHaveBeenCalled();
      });

      it('MEDIUM-09 / Task 2.6: Cập nhật bản ghi Payment FAILED lên SUCCESS qua upsert khi retry với cùng idempotencyKey', async () => {
        mockPrisma.payment.findUnique.mockResolvedValueOnce({
          id: 99,
          orderId: 5,
          amount: 85000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.FAILED,
        });

        mockPrisma.order.findUnique.mockResolvedValue({
          id: 5,
          userId: 1,
          totalAmount: 85000,
          status: OrderStatus.PAYMENT_FAILED,
          version: 1,
        });

        mockPaymentService.processPayment.mockResolvedValue({
          success: true,
          transactionId: 'TXN-RETRY-UPSERT',
          message: 'Thành công',
        });

        mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.payment.upsert.mockResolvedValue({
          id: 99,
          orderId: 5,
          amount: 85000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.SUCCESS,
        });

        const result = await service.processPayment(
          { orderId: 5, method: PaymentMethod.EWALLET },
          1,
          'idempotency-key-failed-upsert',
        );

        expect(result.success).toBe(true);
        expect(result.paymentStatus).toBe(PaymentStatus.SUCCESS);
        expect(mockPrisma.payment.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { idempotencyKey: 'idempotency-key-failed-upsert' },
            update: expect.objectContaining({ status: PaymentStatus.SUCCESS }),
          }),
        );
      });

      it('MEDIUM-09 / Task 2.6: Cập nhật bản ghi Payment FAILED lên SUCCESS qua fallback update nếu create bị P2002', async () => {
        mockPrisma.payment.findUnique.mockResolvedValueOnce({
          id: 99,
          orderId: 5,
          amount: 85000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.FAILED,
        });

        mockPrisma.order.findUnique.mockResolvedValue({
          id: 5,
          userId: 1,
          totalAmount: 85000,
          status: OrderStatus.PAYMENT_FAILED,
          version: 1,
        });

        mockPaymentService.processPayment.mockResolvedValue({
          success: true,
          transactionId: 'TXN-RETRY-FALLBACK',
          message: 'Thành công',
        });

        mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
        // Xóa mock upsert để kích hoạt luồng create -> catch P2002 -> update
        delete mockPrisma.payment.upsert;
        mockPrisma.payment.create.mockRejectedValueOnce({ code: 'P2002' });
        mockPrisma.payment.update.mockResolvedValue({
          id: 99,
          orderId: 5,
          amount: 85000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.SUCCESS,
        });

        const result = await service.processPayment(
          { orderId: 5, method: PaymentMethod.EWALLET },
          1,
          'idempotency-key-failed-fallback',
        );

        expect(result.success).toBe(true);
        expect(result.paymentStatus).toBe(PaymentStatus.SUCCESS);
        expect(mockPrisma.payment.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { idempotencyKey: 'idempotency-key-failed-fallback' },
            data: expect.objectContaining({ status: PaymentStatus.SUCCESS }),
          }),
        );
      });

      it('bắt lỗi Prisma P2002 khi tạo Payment bị trùng idempotencyKey và trả về idempotent response', async () => {
        // Initial findUnique returns null (request đồng thời chưa tạo xong)
        mockPrisma.payment.findUnique.mockResolvedValueOnce(null);

        mockPrisma.order.findUnique.mockResolvedValue({
          id: 5,
          userId: 1,
          totalAmount: 85000,
          status: OrderStatus.PENDING,
          version: 1,
        });

        mockPaymentService.processPayment.mockResolvedValue({
          success: true,
          transactionId: 'TXN-CONCURRENT',
          message: 'Thành công',
        });

        mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });

        // tx.payment.create ném lỗi P2002 Unique constraint
        delete mockPrisma.payment.upsert;
        mockPrisma.payment.create.mockRejectedValue({ code: 'P2002' });
        mockPrisma.payment.update.mockRejectedValue({ code: 'P2002' });

        // findUnique sau khi bắt P2002 trả về bản ghi của request đồng thời đã tạo thành công
        mockPrisma.payment.findUnique.mockResolvedValueOnce({
          id: 105,
          orderId: 5,
          amount: 85000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.SUCCESS,
          order: { status: OrderStatus.PAID },
        });

        const result = await service.processPayment(
          { orderId: 5, method: PaymentMethod.EWALLET },
          1,
          'idempotency-key-race',
        );

        expect(result.isIdempotent).toBe(true);
        expect(result.paymentId).toBe(105);
        expect(result.status).toBe(OrderStatus.PAID);
        expect(result.success).toBe(true);
      });
    });

    describe('IDOR Protection & Role Normalization (Task 2.3)', () => {
      it('processPayment: Chặn CUSTOMER thanh toán đơn của user khác', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 15,
          userId: 1,
          totalAmount: 50000,
          status: OrderStatus.PENDING,
        });

        await expect(
          service.processPayment(
            { orderId: 15, method: PaymentMethod.EWALLET },
            2,
            undefined,
            Role.CUSTOMER,
          ),
        ).rejects.toThrow(ForbiddenException);
      });

      it('processPayment: Cho phép STAFF thanh toán hộ đơn của khách hàng', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 15,
          userId: 1,
          totalAmount: 50000,
          status: OrderStatus.PENDING,
        });

        mockPaymentService.processPayment.mockResolvedValue({
          success: true,
          transactionId: 'TXN-STAFF',
          message: 'Thành công',
        });
        mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.payment.create.mockResolvedValue({
          id: 201,
          orderId: 15,
          amount: 50000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.SUCCESS,
        });

        const res = await service.processPayment(
          { orderId: 15, method: PaymentMethod.EWALLET },
          99,
          undefined,
          Role.STAFF,
        );
        expect(res.success).toBe(true);
      });
    });

    describe('Optimistic Locking & Concurrency Control', () => {
      it('ném ConflictException khi optimistic lock thất bại (version không khớp do race condition)', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 7,
          userId: 1,
          totalAmount: 60000,
          status: OrderStatus.PENDING,
          version: 2,
        });

        mockPaymentService.processPayment.mockResolvedValue({
          success: true,
          transactionId: 'TXN-CONCURRENT',
          message: 'Thành công',
        });

        // Giả lập updateMany trả về count: 0 (có request khác đã update version lên 3)
        mockPrisma.order.updateMany.mockResolvedValue({ count: 0 });

        await expect(
          service.processPayment({ orderId: 7, method: PaymentMethod.EWALLET }, 1),
        ).rejects.toThrow(ConflictException);
      });
    });

    describe('Task 4 — Retry Step, 5m Expiry Refund, Voucher Guard & CAS', () => {
      it('retry đơn PAYMENT_FAILED trong 5 phút thực hiện 2 bước CAS (PAYMENT_FAILED -> PENDING -> PAID)', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 50,
          userId: 1,
          totalAmount: 65000,
          status: OrderStatus.PAYMENT_FAILED,
          version: 1,
          createdAt: new Date(),
          items: [],
        });

        mockPaymentService.processPayment.mockResolvedValue({
          success: true,
          transactionId: 'TXN-RETRY-2STEP',
          message: 'Thành công',
        });

        mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.payment.create.mockResolvedValue({
          id: 501,
          orderId: 50,
          amount: 65000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.SUCCESS,
        });

        const result = await service.processPayment(
          { orderId: 50, method: PaymentMethod.EWALLET },
          1,
        );

        expect(result.success).toBe(true);
        expect(result.status).toBe(OrderStatus.PAID);
        expect(mockPrisma.order.updateMany).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            where: {
              id: 50,
              status: OrderStatus.PAYMENT_FAILED,
              version: 1,
            },
            data: {
              status: OrderStatus.PENDING,
              version: { increment: 1 },
            },
          }),
        );
        expect(mockPrisma.order.updateMany).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            where: {
              id: 50,
              status: OrderStatus.PENDING,
              version: 2,
            },
            data: expect.objectContaining({
              status: OrderStatus.PAID,
              version: { increment: 1 },
            }),
          }),
        );
      });

      it('đơn PAYMENT_FAILED quá hạn 5 phút tự động CAS cancel sang CANCELLED, gọi hoàn kho/voucher và ném BadRequestException', async () => {
        const expiredDate = new Date(Date.now() - 6 * 60 * 1000);
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 51,
          userId: 1,
          totalAmount: 70000,
          status: OrderStatus.PAYMENT_FAILED,
          discountCode: 'BEAN10',
          voucherDeducted: true,
          version: 1,
          createdAt: expiredDate,
          items: [{ productId: 1, size: 'M', toppings: [], quantity: 1 }],
        });

        mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.inventoryLog = {
          findMany: vi.fn().mockResolvedValue([
            {
              ingredientId: 10,
              ingredientName: 'Cà phê hạt',
              unit: 'g',
              changeAmount: -20,
            },
          ]),
          create: vi.fn().mockResolvedValue({}),
        };
        mockPrisma.ingredient = {
          update: vi.fn().mockResolvedValue({ id: 10, name: 'Cà phê hạt', unit: 'g', stock: 120 }),
        };
        mockPrisma.userVoucher = {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
        };
        mockPrisma.discountCode = {
          findUnique: vi.fn().mockResolvedValue({
            code: 'BEAN10',
            discountPercent: 10,
            minOrderAmount: 0,
            maxDiscountAmount: 20000,
          }),
        };

        await expect(
          service.processPayment({ orderId: 51, method: PaymentMethod.EWALLET }, 1),
        ).rejects.toThrow(BadRequestException);

        expect(mockPaymentService.processPayment).not.toHaveBeenCalled();
        expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({
          where: {
            id: 51,
            status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED] },
          },
          data: {
            status: OrderStatus.CANCELLED,
            voucherDeducted: false,
            version: { increment: 1 },
          },
        });
        expect(mockPrisma.ingredient.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 10 },
            data: expect.objectContaining({ stock: { increment: 20 } }),
          }),
        );
        expect(mockPrisma.inventoryLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              type: 'CANCEL_REFUND',
              ingredientName: 'Cà phê hạt',
              unit: 'g',
            }),
          }),
        );
        expect(mockPrisma.userVoucher.create).toHaveBeenCalled();
      });

      it('đơn PENDING quá hạn 5 phút cũng tự động CAS cancel sang CANCELLED và giảm DiscountCode.usageCount trước khi ném BadRequestException', async () => {
        const expiredDate = new Date(Date.now() - 6 * 60 * 1000);
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 52,
          userId: 1,
          totalAmount: 70000,
          status: OrderStatus.PENDING,
          discountCode: 'SUMMER20',
          voucherDeducted: false,
          version: 0,
          createdAt: expiredDate,
          items: [],
        });

        mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.discountCode = {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        };

        await expect(
          service.processPayment({ orderId: 52, method: PaymentMethod.EWALLET }, 1),
        ).rejects.toThrow(BadRequestException);

        expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({
          where: {
            id: 52,
            status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED] },
          },
          data: {
            status: OrderStatus.CANCELLED,
            voucherDeducted: false,
            version: { increment: 1 },
          },
        });
        expect(mockPrisma.discountCode.updateMany).toHaveBeenCalledWith({
          where: { code: 'SUMMER20', usageCount: { gt: 0 } },
          data: { usageCount: { decrement: 1 } },
        });
      });

      it('KHÔNG trừ lại UserVoucher khi đơn hàng đã có voucherDeducted = true', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 53,
          userId: 1,
          totalAmount: 60000,
          status: OrderStatus.PENDING,
          discountCode: 'BEAN10',
          voucherDeducted: true,
          version: 0,
          createdAt: new Date(),
        });

        mockPrisma.userVoucher = {
          findUnique: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        };

        mockPaymentService.processPayment.mockResolvedValue({
          success: true,
          transactionId: 'TXN-VOUCHER',
          message: 'Thành công',
        });
        mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.payment.create.mockResolvedValue({
          id: 503,
          orderId: 53,
          amount: 60000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.SUCCESS,
        });

        const result = await service.processPayment(
          { orderId: 53, method: PaymentMethod.EWALLET },
          1,
        );

        expect(result.success).toBe(true);
        expect(mockPrisma.userVoucher.findUnique).not.toHaveBeenCalled();
        expect(mockPrisma.userVoucher.update).not.toHaveBeenCalled();
        expect(mockPrisma.userVoucher.delete).not.toHaveBeenCalled();
      });

      it('giữ voucherDeducted = false khi đơn dùng mã giảm giá toàn hệ thống (DiscountCode, không phải UserVoucher)', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 54,
          userId: 1,
          totalAmount: 60000,
          status: OrderStatus.PENDING,
          discountCode: 'SUMMER20',
          voucherDeducted: false,
          version: 0,
          createdAt: new Date(),
        });

        mockPrisma.userVoucher = {
          findUnique: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
          delete: vi.fn(),
        };

        mockPaymentService.processPayment.mockResolvedValue({
          success: true,
          transactionId: 'TXN-GLOBAL-CODE',
          message: 'Thành công',
        });
        mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.payment.create.mockResolvedValue({
          id: 504,
          orderId: 54,
          amount: 60000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.SUCCESS,
        });

        const result = await service.processPayment(
          { orderId: 54, method: PaymentMethod.EWALLET },
          1,
        );

        expect(result.success).toBe(true);
        expect(mockPrisma.order.updateMany).toHaveBeenCalledTimes(1);
        const callArgs = mockPrisma.order.updateMany.mock.calls[0][0];
        expect(callArgs.data.voucherDeducted).not.toBe(true);
      });

      it('simulateFailure=true lọc theo status trong CAS failResult và ném ConflictException nếu đơn đã bị hủy song song', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 55,
          userId: 1,
          totalAmount: 60000,
          status: OrderStatus.PENDING,
          version: 1,
          createdAt: new Date(),
        });

        mockPaymentService.processPayment.mockResolvedValue({
          success: false,
          transactionId: 'TXN-DECLINED',
          message: 'Giao dịch bị từ chối',
        });
        mockPrisma.order.updateMany.mockResolvedValue({ count: 0 });

        await expect(
          service.processPayment(
            { orderId: 55, method: PaymentMethod.BANK_CARD, simulateFailure: true },
            1,
          ),
        ).rejects.toThrow(ConflictException);

        expect(mockPrisma.order.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: 55,
              status: OrderStatus.PENDING,
              version: 1,
            },
          }),
        );
      });

      it('ném BadRequestException nếu orderId là NaN hoặc không hợp lệ', async () => {
        await expect(
          service.processPayment({ orderId: Number.NaN, method: PaymentMethod.EWALLET }, 1),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('Loyalty Points (Hạt Vàng)', () => {
      it('cộng điểm tích lũy chính xác (1 điểm / 1.000 VNĐ) sau khi thanh toán thành công', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 8,
          userId: 1,
          totalAmount: 85000,
          status: OrderStatus.PENDING,
          version: 0,
        });

        mockPaymentService.processPayment.mockResolvedValue({
          success: true,
          transactionId: 'TXN-POINTS',
          message: 'Thành công',
        });

        mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.payment.create.mockResolvedValue({
          id: 102,
          orderId: 8,
          amount: 85000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.SUCCESS,
        });

        const result = await service.processPayment(
          { orderId: 8, method: PaymentMethod.EWALLET },
          1,
        );

        expect(result.success).toBe(true);
        expect(result.pointsEarned).toBe(85); // 85.000 / 1.000 = 85
        expect(mockPrisma.user.update).toHaveBeenCalledWith({
          where: { id: 1 },
          data: { loyaltyPoints: { increment: 85 } },
        });
      });

      it('BE-C3: chặn CUSTOMER thanh toán đơn khách vãng lai (userId: null) và cho phép STAFF', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 9,
          userId: null,
          totalAmount: 50000,
          status: OrderStatus.PENDING,
          version: 0,
        });

        await expect(
          service.processPayment(
            { orderId: 9, method: PaymentMethod.EWALLET },
            1,
            undefined,
            Role.CUSTOMER,
          ),
        ).rejects.toThrow(ForbiddenException);
      });

      it('không gọi user.update nếu đơn hàng không có userId (khách vãng lai, STAFF thu hộ)', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 9,
          userId: null, // Khách không login
          totalAmount: 50000,
          status: OrderStatus.PENDING,
          version: 0,
        });

        mockPaymentService.processPayment.mockResolvedValue({
          success: true,
          transactionId: 'TXN-ANONYMOUS',
          message: 'Thành công',
        });

        mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.payment.create.mockResolvedValue({
          id: 103,
          orderId: 9,
          amount: 50000,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.SUCCESS,
        });

        const result = await service.processPayment(
          { orderId: 9, method: PaymentMethod.EWALLET },
          99,
          undefined,
          Role.STAFF,
        );

        expect(result.success).toBe(true);
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
      });

      it('không gọi user.update nếu pointsEarned = 0 (đơn giá < 1.000 VNĐ)', async () => {
        mockPrisma.order.findUnique.mockResolvedValue({
          id: 11,
          userId: 1,
          totalAmount: 500, // < 1.000
          status: OrderStatus.PENDING,
          version: 0,
        });

        mockPaymentService.processPayment.mockResolvedValue({
          success: true,
          transactionId: 'TXN-CHEAP',
          message: 'Thành công',
        });

        mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.payment.create.mockResolvedValue({
          id: 104,
          orderId: 11,
          amount: 500,
          method: PaymentMethod.EWALLET,
          status: PaymentStatus.SUCCESS,
        });

        const result = await service.processPayment(
          { orderId: 11, method: PaymentMethod.EWALLET },
          1,
        );

        expect(result.pointsEarned).toBe(0);
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
      });
    });

    describe('ZaloPay Sandbox & Replay Attack Protection', () => {
      let mockZaloPayService: any;

      beforeEach(() => {
        mockZaloPayService = {
          createOrder: vi.fn(),
          verifyCallback: vi.fn(),
          queryStatus: vi.fn(),
          createMockCallbackPayload: vi.fn(),
        };
        service = new PaymentsService(mockPrisma as any, mockPaymentService as any, mockZaloPayService as any);
      });

      describe('createZaloPayOrder (Task 2.3)', () => {
        it('chặn CUSTOMER tạo order cho đơn của người khác', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 16,
            userId: 1,
            totalAmount: 50000,
            status: OrderStatus.PENDING,
            createdAt: new Date(),
          });

          await expect(
            service.createZaloPayOrder(16, 2, Role.CUSTOMER),
          ).rejects.toThrow(ForbiddenException);
        });

        it('BE-C3: chặn CUSTOMER tạo ZaloPay order cho đơn khách vãng lai (userId: null)', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 16,
            userId: null,
            totalAmount: 50000,
            status: OrderStatus.PENDING,
            createdAt: new Date(),
          });

          await expect(
            service.createZaloPayOrder(16, 2, Role.CUSTOMER),
          ).rejects.toThrow(ForbiddenException);
          expect(mockZaloPayService.createOrder).not.toHaveBeenCalled();
        });

        it('cho phép STAFF tạo order cho đơn của người khác', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 16,
            userId: 1,
            totalAmount: 50000,
            status: OrderStatus.PENDING,
            createdAt: new Date(),
          });
          mockZaloPayService.createOrder.mockResolvedValue({
            returnCode: 1,
            orderUrl: 'https://zalopay.vn/pay',
            appTransId: 'trans_123',
          });

          const res = await service.createZaloPayOrder(16, 99, Role.STAFF);
          expect(res.returnCode).toBe(1);
        });

        it('Task 5: cho phép retry createZaloPayOrder từ PAYMENT_FAILED (trong 5 phút) bằng CAS PAYMENT_FAILED -> PENDING', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 17,
            userId: 1,
            totalAmount: 75000,
            status: OrderStatus.PAYMENT_FAILED,
            createdAt: new Date(),
            items: [],
          });
          mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
          mockZaloPayService.createOrder.mockResolvedValue({
            returnCode: 1,
            orderUrl: 'https://zalopay.vn/retry',
            appTransId: '261024_17_123456',
          });

          const res = await service.createZaloPayOrder(17, 1, Role.CUSTOMER);
          expect(res.returnCode).toBe(1);
          expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({
            where: { id: 17, status: OrderStatus.PAYMENT_FAILED },
            data: { status: OrderStatus.PENDING, version: { increment: 1 } },
          });
          expect(mockZaloPayService.createOrder).toHaveBeenCalled();
        });

        it('Task 5: ném ConflictException nếu retry createZaloPayOrder từ PAYMENT_FAILED gặp race condition (count === 0)', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 18,
            userId: 1,
            totalAmount: 75000,
            status: OrderStatus.PAYMENT_FAILED,
            createdAt: new Date(),
            items: [],
          });
          mockPrisma.order.updateMany.mockResolvedValue({ count: 0 });

          await expect(service.createZaloPayOrder(18, 1, Role.CUSTOMER)).rejects.toThrow(
            ConflictException,
          );
          expect(mockZaloPayService.createOrder).not.toHaveBeenCalled();
        });

        it('Task 5: tự động hủy CANCELLED, hoàn kho/voucher và ném BadRequestException khi đơn PAYMENT_FAILED quá hạn 5 phút', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 19,
            userId: 1,
            totalAmount: 75000,
            status: OrderStatus.PAYMENT_FAILED,
            discountCode: 'BEAN10',
            voucherDeducted: true,
            createdAt: new Date(Date.now() - 6 * 60 * 1000),
            items: [],
          });
          mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
          mockPrisma.userVoucher = {
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({}),
          };
          mockPrisma.discountCode = {
            findUnique: vi.fn().mockResolvedValue({
              code: 'BEAN10',
              discountPercent: 10,
              minOrderAmount: 0,
              maxDiscountAmount: null,
            }),
          };

          await expect(service.createZaloPayOrder(19, 1, Role.CUSTOMER)).rejects.toThrow(
            BadRequestException,
          );
          expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({
            where: {
              id: 19,
              status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED] },
            },
            data: {
              status: OrderStatus.CANCELLED,
              voucherDeducted: false,
              version: { increment: 1 },
            },
          });
          expect(mockPrisma.userVoucher.create).toHaveBeenCalled();
          expect(mockZaloPayService.createOrder).not.toHaveBeenCalled();
        });
      });

      describe('confirmZaloPaySandbox', () => {
        it('ném ForbiddenException nếu userId không khớp với chủ đơn hàng và không phải ADMIN/STAFF', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 20,
            userId: 1, // Chủ đơn là User 1
            totalAmount: 50000,
            status: OrderStatus.PENDING,
          });

          await expect(
            service.confirmZaloPaySandbox(20, 2, Role.CUSTOMER, '261024_20_123'),
          ).rejects.toThrow(ForbiddenException);
        });

        it('cho phép ADMIN xác nhận đơn hàng dù không phải chủ đơn', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 20,
            userId: 1,
            totalAmount: 50000,
            status: OrderStatus.PENDING,
          });

          mockZaloPayService.createMockCallbackPayload.mockReturnValue({
            data: JSON.stringify({
              app_trans_id: '261024_20_123',
              amount: 50000,
              zp_trans_id: 12345,
              embed_data: JSON.stringify({ orderId: 20 }),
            }),
            mac: 'valid_mac',
          });
          mockZaloPayService.verifyCallback.mockReturnValue(true);

          const result = await service.confirmZaloPaySandbox(20, 99, Role.ADMIN, '261024_20_123');
          expect(result.success).toBe(true);
        });

        it('BE-C3: chặn CUSTOMER xác nhận đơn khách vãng lai (order.userId === null) và chỉ cho phép STAFF/ADMIN', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 21,
            userId: null,
            totalAmount: 50000,
            status: OrderStatus.PENDING,
          });

          await expect(
            service.confirmZaloPaySandbox(21, 5, Role.CUSTOMER, '261024_21_123'),
          ).rejects.toThrow(ForbiddenException);

          mockZaloPayService.createMockCallbackPayload.mockReturnValue({
            data: JSON.stringify({
              app_trans_id: '261024_21_123',
              amount: 50000,
              zp_trans_id: 12345,
              embed_data: JSON.stringify({ orderId: 21 }),
            }),
            mac: 'valid_mac',
          });
          mockZaloPayService.verifyCallback.mockReturnValue(true);

          const result = await service.confirmZaloPaySandbox(21, 99, Role.STAFF, '261024_21_123');
          expect(result.success).toBe(true);
        });

        it('BE-C2: ném BadRequestException khi appTransId không khớp orderId hoặc sai định dạng', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 20,
            userId: 1,
            totalAmount: 50000,
            status: OrderStatus.PENDING,
            createdAt: new Date(),
          });

          await expect(
            service.confirmZaloPaySandbox(20, 1, Role.CUSTOMER, '261024_99_123'),
          ).rejects.toThrow(BadRequestException);

          await expect(
            service.confirmZaloPaySandbox(20, 1, Role.CUSTOMER, 'invalid-trans'),
          ).rejects.toThrow(BadRequestException);
          expect(mockZaloPayService.createMockCallbackPayload).not.toHaveBeenCalled();
        });

        it('BE-I1 / FE-I3: confirmZaloPaySandbox tự động CAS cancel + hoàn kho và ném BadRequestException nếu đơn PENDING quá hạn 5 phút', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 25,
            userId: 1,
            totalAmount: 60000,
            status: OrderStatus.PENDING,
            discountCode: 'SUMMER20',
            voucherDeducted: false,
            createdAt: new Date(Date.now() - 6 * 60 * 1000),
            items: [],
          });
          mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
          mockPrisma.discountCode = {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          };

          await expect(
            service.confirmZaloPaySandbox(25, 1, Role.CUSTOMER, '261024_25_123'),
          ).rejects.toThrow(BadRequestException);

          expect(mockPrisma.order.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: {
                id: 25,
                status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED] },
              },
              data: expect.objectContaining({ status: OrderStatus.CANCELLED }),
            }),
          );
          expect(mockPrisma.discountCode.updateMany).toHaveBeenCalled();
          expect(mockZaloPayService.createMockCallbackPayload).not.toHaveBeenCalled();
        });

        it('Task 5: ném BadRequestException nếu đơn hàng đã CANCELLED hoặc PAYMENT_FAILED (không giả mạo status PAID)', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 22,
            userId: 1,
            totalAmount: 50000,
            status: OrderStatus.CANCELLED,
          });

          await expect(
            service.confirmZaloPaySandbox(22, 1, Role.CUSTOMER, '261024_22_123'),
          ).rejects.toThrow(BadRequestException);

          mockPrisma.order.findUnique.mockResolvedValue({
            id: 23,
            userId: 1,
            totalAmount: 50000,
            status: OrderStatus.PAYMENT_FAILED,
          });

          await expect(
            service.confirmZaloPaySandbox(23, 1, Role.CUSTOMER, '261024_23_123'),
          ).rejects.toThrow(BadRequestException);
        });

        it('Task 5: ném BadRequestException khi handleZaloPayCallback trả về return_code !== 1', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 24,
            userId: 1,
            totalAmount: 50000,
            status: OrderStatus.PENDING,
          });
          mockZaloPayService.createMockCallbackPayload.mockReturnValue({
            data: JSON.stringify({
              app_trans_id: '261024_24_123',
              amount: 50000,
              zp_trans_id: 12345,
              embed_data: JSON.stringify({ orderId: 24 }),
            }),
            mac: 'valid_mac',
          });
          vi.spyOn(service, 'handleZaloPayCallback').mockResolvedValueOnce({
            return_code: 0,
            return_message: 'Đơn hàng đã hết hạn, bị hủy hoặc đang chờ thử lại',
          });

          await expect(
            service.confirmZaloPaySandbox(24, 1, Role.CUSTOMER, '261024_24_123'),
          ).rejects.toThrow(BadRequestException);
        });
      });

      describe('cancelZaloPaySandbox', () => {
        it('ném ForbiddenException nếu userId không khớp với chủ đơn hàng và không phải ADMIN/STAFF', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 20,
            userId: 1,
            status: OrderStatus.PENDING,
          });

          await expect(service.cancelZaloPaySandbox(20, 2, Role.CUSTOMER)).rejects.toThrow(
            ForbiddenException,
          );
        });

        it('cho phép ADMIN hủy thanh toán dù không phải chủ đơn', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 20,
            userId: 1,
            status: OrderStatus.PENDING,
          });

          const result = await service.cancelZaloPaySandbox(20, 99, Role.ADMIN);
          expect(result.success).toBe(true);
          expect(result.message).toContain('đã được hủy');
        });

        it('BE-C3: chặn CUSTOMER hủy đơn khách vãng lai (userId: null) và cho phép STAFF', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 20,
            userId: null,
            status: OrderStatus.PENDING,
          });

          await expect(service.cancelZaloPaySandbox(20, 5, Role.CUSTOMER)).rejects.toThrow(
            ForbiddenException,
          );

          const res = await service.cancelZaloPaySandbox(20, 99, Role.STAFF);
          expect(res.success).toBe(true);
        });

        it('BE-C1: chặn CUSTOMER hủy đơn đã thanh toán (PAID -> CANCELLED) với ForbiddenException', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 25,
            userId: 1,
            totalAmount: 80000,
            status: OrderStatus.PAID,
            items: [],
          });

          await expect(
            service.cancelZaloPaySandbox(25, 1, Role.CUSTOMER),
          ).rejects.toThrow(ForbiddenException);
          expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
        });

        it('Task 2.5 & BE-I2: STAFF/ADMIN hủy đơn PAID -> CANCELLED hoàn kho BOM và thu hồi điểm loyalty nguyên tử bằng updateMany', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 25,
            userId: 1,
            totalAmount: 80000,
            status: OrderStatus.PAID,
            items: [
              {
                productId: 1,
                size: 'M',
                toppings: [],
                quantity: 2,
              },
            ],
          });

          mockPrisma.recipe = {
            findMany: vi.fn().mockResolvedValue([
              {
                productId: 1,
                size: 'M',
                amount: 20,
                ingredient: { id: 10, code: 'ING_COFFEE', name: 'Cà phê', unit: 'g' },
              },
            ]),
          };
          mockPrisma.ingredient = {
            update: vi.fn(),
          };
          mockPrisma.user = {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            update: vi.fn(),
          };
          mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });

          const result = await service.cancelZaloPaySandbox(25, 99, Role.STAFF);

          expect(result.success).toBe(true);
          expect(result.status).toBe(OrderStatus.CANCELLED);
          expect(mockPrisma.ingredient.update).toHaveBeenCalledWith(
            expect.objectContaining({
              where: { id: 10 },
              data: expect.objectContaining({ stock: { increment: 40 } }),
            }),
          );
          expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
            where: {
              id: 1,
              loyaltyPoints: { gte: 80 },
            },
            data: {
              loyaltyPoints: { decrement: 80 },
            },
          });
        });

        it('BE-I2: thu hồi điểm loyalty clamp về 0 nguyên tử khi số dư user nhỏ hơn điểm cần thu hồi', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 28,
            userId: 1,
            totalAmount: 80000,
            status: OrderStatus.PAID,
            items: [],
          });
          mockPrisma.user = {
            updateMany: vi
              .fn()
              .mockResolvedValueOnce({ count: 0 })
              .mockResolvedValueOnce({ count: 1 }),
            update: vi.fn(),
          };
          mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });

          const result = await service.cancelZaloPaySandbox(28, 99, Role.ADMIN);
          expect(result.success).toBe(true);
          expect(mockPrisma.user.updateMany).toHaveBeenNthCalledWith(1, {
            where: { id: 1, loyaltyPoints: { gte: 80 } },
            data: { loyaltyPoints: { decrement: 80 } },
          });
          expect(mockPrisma.user.updateMany).toHaveBeenNthCalledWith(2, {
            where: { id: 1, loyaltyPoints: { lt: 80, gt: 0 } },
            data: { loyaltyPoints: 0 },
          });
        });

        it('Task 5: cho phép hủy đơn PAYMENT_FAILED, tạo lại UserVoucher đã bị xóa và ghi CANCEL_REFUND log đủ ingredientName & unit', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 26,
            userId: 1,
            totalAmount: 80000,
            status: OrderStatus.PAYMENT_FAILED,
            discountCode: 'BEAN10',
            voucherDeducted: true,
            items: [{ productId: 1, size: 'M', toppings: [], quantity: 1 }],
          });
          mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
          mockPrisma.inventoryLog = {
            findMany: vi.fn().mockResolvedValue([
              {
                ingredientId: 10,
                ingredientName: 'Sữa tươi',
                unit: 'ml',
                changeAmount: -150,
              },
            ]),
            create: vi.fn().mockResolvedValue({}),
          };
          mockPrisma.ingredient = {
            update: vi.fn().mockResolvedValue({ id: 10, name: 'Sữa tươi', unit: 'ml', stock: 500 }),
          };
          mockPrisma.userVoucher = {
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({}),
          };
          mockPrisma.discountCode = {
            findUnique: vi.fn().mockResolvedValue({
              code: 'BEAN10',
              discountPercent: 10,
              minOrderAmount: 0,
              maxDiscountAmount: null,
            }),
            updateMany: vi.fn(),
          };

          const result = await service.cancelZaloPaySandbox(26, 1, Role.CUSTOMER);
          expect(result.success).toBe(true);
          expect(result.status).toBe(OrderStatus.CANCELLED);
          expect(mockPrisma.order.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: { id: 26, status: OrderStatus.PAYMENT_FAILED },
              data: expect.objectContaining({
                status: OrderStatus.CANCELLED,
                voucherDeducted: false,
                version: { increment: 1 },
              }),
            }),
          );
          expect(mockPrisma.inventoryLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                type: 'CANCEL_REFUND',
                ingredientName: 'Sữa tươi',
                unit: 'ml',
              }),
            }),
          );
          expect(mockPrisma.userVoucher.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
              userId: 1,
              code: 'BEAN10',
              quantity: 1,
            }),
          });
          expect(mockPrisma.discountCode.updateMany).not.toHaveBeenCalled();
        });

        it('Task 5: hủy đơn dùng mã toàn hệ thống (!voucherDeducted) giảm DiscountCode.usageCount và ném ConflictException nếu CAS count === 0', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 27,
            userId: 1,
            totalAmount: 80000,
            status: OrderStatus.PENDING,
            discountCode: 'SUMMER20',
            voucherDeducted: false,
            items: [],
          });
          mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
          mockPrisma.discountCode = {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          };

          await service.cancelZaloPaySandbox(27, 1, Role.CUSTOMER);
          expect(mockPrisma.discountCode.updateMany).toHaveBeenCalledWith({
            where: { code: 'SUMMER20', usageCount: { gt: 0 } },
            data: { usageCount: { decrement: 1 } },
          });

          mockPrisma.order.updateMany.mockResolvedValue({ count: 0 });
          await expect(service.cancelZaloPaySandbox(27, 1, Role.CUSTOMER)).rejects.toThrow(
            ConflictException,
          );
        });
      });

      describe('getZaloPayStatus', () => {
        it('chặn CUSTOMER xem đơn hàng của user khác', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 30,
            userId: 1,
            status: OrderStatus.PAID,
            totalAmount: 100000,
          });

          await expect(
            service.getZaloPayStatus(30, 2, undefined, Role.CUSTOMER),
          ).rejects.toThrow(ForbiddenException);
        });

        it('cho phép STAFF xem đơn hàng của user khác', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 30,
            userId: 1,
            status: OrderStatus.PAID,
            totalAmount: 100000,
          });

          const res = await service.getZaloPayStatus(30, 99, undefined, Role.STAFF);
          expect(res.isPaid).toBe(true);
        });

        it('ném BadRequestException nếu số tiền ZaloPay query trả về khác với order.totalAmount', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 30,
            userId: 1,
            status: OrderStatus.PENDING,
            totalAmount: 100000,
          });

          mockZaloPayService.queryStatus.mockResolvedValue({
            returnCode: 1,
            isProcessing: false,
            amount: 50000, // Khác 100000
            zpTransId: 99999,
          });

          await expect(service.getZaloPayStatus(30, 1, '261024_30_123')).rejects.toThrow(
            BadRequestException,
          );
        });

        it('Task 5: trả về isPaid: true cho mọi trạng thái PAID, PREPARING, READY, COMPLETED', async () => {
          for (const status of [
            OrderStatus.PAID,
            OrderStatus.PREPARING,
            OrderStatus.READY,
            OrderStatus.COMPLETED,
          ]) {
            mockPrisma.order.findUnique.mockResolvedValue({
              id: 31,
              userId: 1,
              status,
              totalAmount: 100000,
            });

            const res = await service.getZaloPayStatus(31, 1, undefined, Role.CUSTOMER);
            expect(res.isPaid).toBe(true);
            expect(res.status).toBe(status);
          }
        });

        it('Task 5: KHÔNG tạo payment hay cộng điểm loyalty khi CAS updateMany trả về count === 0', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 32,
            userId: 1,
            status: OrderStatus.PENDING,
            totalAmount: 85000,
          });
          mockZaloPayService.queryStatus.mockResolvedValue({
            returnCode: 1,
            isProcessing: false,
            amount: 85000,
            zpTransId: 998877,
          });
          mockPrisma.order.updateMany.mockResolvedValue({ count: 0 });

          await service.getZaloPayStatus(32, 1, '261024_32_123');
          expect(mockPrisma.payment.create).not.toHaveBeenCalled();
          expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });

        it('BE-C3: chặn CUSTOMER xem trạng thái đơn khách vãng lai (userId: null) và cho phép ADMIN', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 30,
            userId: null,
            status: OrderStatus.PAID,
            totalAmount: 100000,
          });

          await expect(
            service.getZaloPayStatus(30, 2, undefined, Role.CUSTOMER),
          ).rejects.toThrow(ForbiddenException);

          const res = await service.getZaloPayStatus(30, 99, undefined, Role.ADMIN);
          expect(res.isPaid).toBe(true);
        });

        it('BE-C2: ném BadRequestException trong getZaloPayStatus khi appTransId không khớp orderId hoặc sai định dạng', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 30,
            userId: 1,
            status: OrderStatus.PENDING,
            totalAmount: 100000,
          });

          await expect(
            service.getZaloPayStatus(30, 1, '261024_99_123', Role.CUSTOMER),
          ).rejects.toThrow(BadRequestException);

          await expect(
            service.getZaloPayStatus(30, 1, 'bad_format', Role.CUSTOMER),
          ).rejects.toThrow(BadRequestException);
          expect(mockZaloPayService.queryStatus).not.toHaveBeenCalled();
        });

        it('BE-I1: getZaloPayStatus tự động hủy CANCELLED khi đơn PENDING/PAYMENT_FAILED quá hạn 5 phút', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 34,
            userId: 1,
            status: OrderStatus.PENDING,
            totalAmount: 85000,
            discountCode: 'SUMMER20',
            voucherDeducted: false,
            createdAt: new Date(Date.now() - 6 * 60 * 1000),
            items: [],
          });
          mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
          mockPrisma.discountCode = {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          };

          const res = await service.getZaloPayStatus(34, 1, '261024_34_123', Role.CUSTOMER);
          expect(res.isPaid).toBe(false);
          expect(res.status).toBe(OrderStatus.CANCELLED);
          expect(mockZaloPayService.queryStatus).not.toHaveBeenCalled();
          expect(mockPrisma.discountCode.updateMany).toHaveBeenCalled();

          // PAYMENT_FAILED quá hạn cũng tự động hủy
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 35,
            userId: 1,
            status: OrderStatus.PAYMENT_FAILED,
            totalAmount: 85000,
            createdAt: new Date(Date.now() - 6 * 60 * 1000),
            items: [],
          });
          const failedRes = await service.getZaloPayStatus(35, 1, undefined, Role.CUSTOMER);
          expect(failedRes.isPaid).toBe(false);
          expect(failedRes.status).toBe(OrderStatus.CANCELLED);
        });

        it('Task 5: KHÔNG cộng điểm loyalty trùng lặp khi tx.payment.create ném P2002', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 33,
            userId: 1,
            status: OrderStatus.PENDING,
            totalAmount: 85000,
          });
          mockZaloPayService.queryStatus.mockResolvedValue({
            returnCode: 1,
            isProcessing: false,
            amount: 85000,
            zpTransId: 998877,
          });
          mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
          mockPrisma.payment.create.mockRejectedValue({ code: 'P2002' });

          const res = await service.getZaloPayStatus(33, 1, '261024_33_123');
          expect(res.isPaid).toBe(true);
          expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });
      });

      describe('handleZaloPayCallback', () => {
        it('chống replay attack: nếu order đã CANCELLED thì trả về thông báo và KHÔNG cập nhật PAID', async () => {
          mockZaloPayService.verifyCallback.mockReturnValue(true);

          const callbackData = {
            app_trans_id: '261024_40_123',
            amount: 75000,
            zp_trans_id: 88888,
            embed_data: JSON.stringify({ orderId: 40 }),
          };

          mockPrisma.order.findUnique.mockResolvedValue({
            id: 40,
            userId: 1,
            status: OrderStatus.CANCELLED,
            totalAmount: 75000,
          });

          const res = await service.handleZaloPayCallback({
            data: JSON.stringify(callbackData),
            mac: 'valid_mac',
          });

          expect(res.return_code).toBe(1);
          expect(res.return_message).toBe('Đơn hàng đã hết hạn hoặc bị hủy');
          expect(mockPrisma.order.update).not.toHaveBeenCalled();
        });

        it('Task 5: từ chối callback khi đơn đang ở PAYMENT_FAILED (return_code: 0, không bỏ qua bước retry)', async () => {
          mockZaloPayService.verifyCallback.mockReturnValue(true);

          const callbackData = {
            app_trans_id: '261024_41_123',
            amount: 75000,
            zp_trans_id: 88889,
            embed_data: JSON.stringify({ orderId: 41 }),
          };

          mockPrisma.order.findUnique.mockResolvedValue({
            id: 41,
            userId: 1,
            status: OrderStatus.PAYMENT_FAILED,
            totalAmount: 75000,
          });

          const res = await service.handleZaloPayCallback({
            data: JSON.stringify(callbackData),
            mac: 'valid_mac',
          });

          expect(res.return_code).toBe(0);
          expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
          expect(mockPrisma.payment.create).not.toHaveBeenCalled();
          expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });

        it('Task 5: KHÔNG tạo payment hay cộng điểm loyalty nếu CAS updateMany trả về count === 0', async () => {
          mockZaloPayService.verifyCallback.mockReturnValue(true);

          const callbackData = {
            app_trans_id: '261024_42_123',
            amount: 75000,
            zp_trans_id: 88890,
            embed_data: JSON.stringify({ orderId: 42 }),
          };

          mockPrisma.order.findUnique.mockResolvedValue({
            id: 42,
            userId: 1,
            status: OrderStatus.PENDING,
            totalAmount: 75000,
          });
          mockPrisma.order.updateMany.mockResolvedValue({ count: 0 });

          await service.handleZaloPayCallback({
            data: JSON.stringify(callbackData),
            mac: 'valid_mac',
          });

          expect(mockPrisma.payment.create).not.toHaveBeenCalled();
          expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });

        it('BE-C3: chặn CUSTOMER xem trạng thái đơn khách vãng lai (userId: null) và cho phép ADMIN', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 30,
            userId: null,
            status: OrderStatus.PAID,
            totalAmount: 100000,
          });

          await expect(
            service.getZaloPayStatus(30, 2, undefined, Role.CUSTOMER),
          ).rejects.toThrow(ForbiddenException);

          const res = await service.getZaloPayStatus(30, 99, undefined, Role.ADMIN);
          expect(res.isPaid).toBe(true);
        });

        it('BE-C2: ném BadRequestException trong getZaloPayStatus khi appTransId không khớp orderId hoặc sai định dạng', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 30,
            userId: 1,
            status: OrderStatus.PENDING,
            totalAmount: 100000,
          });

          await expect(
            service.getZaloPayStatus(30, 1, '261024_99_123', Role.CUSTOMER),
          ).rejects.toThrow(BadRequestException);

          await expect(
            service.getZaloPayStatus(30, 1, 'bad_format', Role.CUSTOMER),
          ).rejects.toThrow(BadRequestException);
          expect(mockZaloPayService.queryStatus).not.toHaveBeenCalled();
        });

        it('BE-I1: getZaloPayStatus tự động hủy CANCELLED khi đơn PENDING/PAYMENT_FAILED quá hạn 5 phút', async () => {
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 34,
            userId: 1,
            status: OrderStatus.PENDING,
            totalAmount: 85000,
            discountCode: 'SUMMER20',
            voucherDeducted: false,
            createdAt: new Date(Date.now() - 6 * 60 * 1000),
            items: [],
          });
          mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
          mockPrisma.discountCode = {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          };

          const res = await service.getZaloPayStatus(34, 1, '261024_34_123', Role.CUSTOMER);
          expect(res.isPaid).toBe(false);
          expect(res.status).toBe(OrderStatus.CANCELLED);
          expect(mockZaloPayService.queryStatus).not.toHaveBeenCalled();
          expect(mockPrisma.discountCode.updateMany).toHaveBeenCalled();

          // PAYMENT_FAILED quá hạn cũng tự động hủy
          mockPrisma.order.findUnique.mockResolvedValue({
            id: 35,
            userId: 1,
            status: OrderStatus.PAYMENT_FAILED,
            totalAmount: 85000,
            createdAt: new Date(Date.now() - 6 * 60 * 1000),
            items: [],
          });
          const failedRes = await service.getZaloPayStatus(35, 1, undefined, Role.CUSTOMER);
          expect(failedRes.isPaid).toBe(false);
          expect(failedRes.status).toBe(OrderStatus.CANCELLED);
        });

        it('Task 5: KHÔNG cộng điểm loyalty trùng lặp khi tx.payment.create ném P2002', async () => {
          mockZaloPayService.verifyCallback.mockReturnValue(true);

          const callbackData = {
            app_trans_id: '261024_43_123',
            amount: 75000,
            zp_trans_id: 88891,
            embed_data: JSON.stringify({ orderId: 43 }),
          };

          mockPrisma.order.findUnique.mockResolvedValue({
            id: 43,
            userId: 1,
            status: OrderStatus.PENDING,
            totalAmount: 75000,
          });
          mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
          mockPrisma.payment.create.mockRejectedValue({ code: 'P2002' });

          const res = await service.handleZaloPayCallback({
            data: JSON.stringify(callbackData),
            mac: 'valid_mac',
          });

          expect(res.return_code).toBe(1);
          expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });

        it('Task 5: KHÔNG trừ lại UserVoucher khi voucherDeducted === true', async () => {
          mockZaloPayService.verifyCallback.mockReturnValue(true);

          const callbackData = {
            app_trans_id: '261024_44_123',
            amount: 75000,
            zp_trans_id: 88892,
            embed_data: JSON.stringify({ orderId: 44 }),
          };

          mockPrisma.order.findUnique.mockResolvedValue({
            id: 44,
            userId: 1,
            status: OrderStatus.PENDING,
            totalAmount: 75000,
            discountCode: 'BEAN10',
            voucherDeducted: true,
          });
          mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
          mockPrisma.payment.create.mockResolvedValue({ id: 444 });
          mockPrisma.userVoucher = {
            findUnique: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          };

          const res = await service.handleZaloPayCallback({
            data: JSON.stringify(callbackData),
            mac: 'valid_mac',
          });

          expect(res.return_code).toBe(1);
          expect(mockPrisma.userVoucher.findUnique).not.toHaveBeenCalled();
          expect(mockPrisma.userVoucher.update).not.toHaveBeenCalled();
          expect(mockPrisma.userVoucher.delete).not.toHaveBeenCalled();
        });

        it('BE-C4: settleZaloPayPaymentInTx bọc payment.create trong SAVEPOINT và rollback savepoint khi P2002', async () => {
          mockPrisma.$executeRawUnsafe = vi.fn().mockResolvedValue(undefined);
          mockZaloPayService.verifyCallback.mockReturnValue(true);

          const callbackData = {
            app_trans_id: '261024_45_123',
            amount: 75000,
            zp_trans_id: 88893,
            embed_data: JSON.stringify({ orderId: 45 }),
          };

          mockPrisma.order.findUnique.mockResolvedValue({
            id: 45,
            userId: 1,
            status: OrderStatus.PENDING,
            totalAmount: 75000,
            createdAt: new Date(),
          });
          mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
          mockPrisma.payment.create.mockRejectedValueOnce({ code: 'P2002' });

          const res = await service.handleZaloPayCallback({
            data: JSON.stringify(callbackData),
            mac: 'valid_mac',
          });

          expect(res.return_code).toBe(1);
          const rawCalls = mockPrisma.$executeRawUnsafe.mock.calls.map((c: any[]) => c[0]);
          expect(rawCalls.some((q: string) => q.startsWith('SAVEPOINT '))).toBe(true);
          expect(rawCalls.some((q: string) => q.startsWith('ROLLBACK TO SAVEPOINT '))).toBe(true);
        });

        it('BE-I1: từ chối webhook callback và tự động hủy CANCELLED nếu đơn PENDING đã quá hạn 5 phút', async () => {
          mockZaloPayService.verifyCallback.mockReturnValue(true);

          const callbackData = {
            app_trans_id: '261024_46_123',
            amount: 75000,
            zp_trans_id: 88894,
            embed_data: JSON.stringify({ orderId: 46 }),
          };

          mockPrisma.order.findUnique.mockResolvedValue({
            id: 46,
            userId: 1,
            status: OrderStatus.PENDING,
            totalAmount: 75000,
            discountCode: 'SUMMER20',
            voucherDeducted: false,
            createdAt: new Date(Date.now() - 6 * 60 * 1000),
            items: [],
          });
          mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
          mockPrisma.discountCode = {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          };

          const res = await service.handleZaloPayCallback({
            data: JSON.stringify(callbackData),
            mac: 'valid_mac',
          });

          expect(res.return_code).toBe(0);
          expect(res.return_message).toBe('Đơn hàng đã quá hạn thanh toán (5 phút) và đã được hủy');
          expect(mockPrisma.order.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: {
                id: 46,
                status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED] },
              },
              data: expect.objectContaining({ status: OrderStatus.CANCELLED }),
            }),
          );
          expect(mockPrisma.payment.create).not.toHaveBeenCalled();
          expect(mockPrisma.discountCode.updateMany).toHaveBeenCalled();
        });
      });
    });
  });
});
