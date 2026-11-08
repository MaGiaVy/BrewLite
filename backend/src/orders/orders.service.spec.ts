import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { OrdersService } from './orders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Role } from '@prisma/client';

describe('OrdersService — Task 10 & Sprint 4 (State Machine, BOM Inventory Optimistic Locking, RBAC)', () => {
  let service: OrdersService;
  let prisma: {
    order: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    product: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    toppingRecipe: {
      findMany: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    prisma = {
      order: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      product: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 1,
            name: 'Cà phê Muối',
            basePrice: 50000,
            sizeUpchargeM: 0,
            sizeUpchargeL: 0,
            isActive: true,
          },
          {
            id: 4,
            name: 'Cà phê Muối',
            basePrice: 42000,
            sizeUpchargeM: 0,
            sizeUpchargeL: 8000,
            isActive: true,
          },
          {
            id: 8,
            name: 'Bánh Pain au Chocolat',
            basePrice: 39000,
            sizeUpchargeM: 0,
            sizeUpchargeL: 0,
            isActive: true,
          },
        ]),
        findUnique: vi.fn(),
      },
      toppingRecipe: {
        findMany: vi.fn().mockResolvedValue([
          {
            toppingId: 'boba',
            toppingName: 'Trân châu trắng giòn',
            price: 8000,
            isActive: true,
          },
        ]),
      },
      $transaction: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getMyOrders (Task 9)', () => {
    it('should query orders with userId and return order list', async () => {
      const mockOrders = [
        {
          id: 101,
          status: 'PAID',
          totalAmount: 85000,
          createdAt: new Date('2026-10-17T06:00:00Z'),
          updatedAt: new Date('2026-10-17T06:01:00Z'),
          items: [
            { id: 1, productName: 'Espresso', quantity: 2, unitPrice: 35000 },
          ],
          payments: [
            { id: 1, method: 'EWALLET', status: 'SUCCESS', amount: 85000 },
          ],
        },
      ];

      prisma.order.findMany.mockResolvedValue(mockOrders);

      const result = await service.getMyOrders(1);

      expect(prisma.order.findMany).toHaveBeenCalledWith({
        where: { userId: 1 },
        include: {
          items: true,
          payments: { orderBy: { createdAt: 'desc' } },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(101);
      expect(result[0].status).toBe('PAID');
    });
  });

  describe('getOrderById', () => {
    it('should throw NotFoundException if order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.getOrderById(999, 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if order belongs to another user (Customer)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 102,
        userId: 2,
        status: 'PAID',
        totalAmount: 50000,
        items: [],
        payments: [],
      });

      await expect(service.getOrderById(102, 1, Role.CUSTOMER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow STAFF or ADMIN to view any order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 102,
        userId: 2,
        status: 'PAID',
        totalAmount: 50000,
        items: [],
        payments: [],
      });

      const result = await service.getOrderById(102, 99, Role.STAFF);
      expect(result.id).toBe(102);
    });

    it('should return order if userId matches', async () => {
      const mockOrder = {
        id: 103,
        userId: 1,
        status: 'PAID',
        totalAmount: 50000,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
        payments: [],
      };
      prisma.order.findUnique.mockResolvedValue(mockOrder);

      const result = await service.getOrderById(103, 1);
      expect(result.id).toBe(103);
      expect(result.status).toBe('PAID');
    });
  });

  describe('updateOrderStatus (Task 10 State Machine & Cancellation Refund)', () => {
    it('should throw NotFoundException if order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.updateOrderStatus(999, OrderStatus.PREPARING, 1),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if customer tries to update another user order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 104,
        userId: 2,
        status: OrderStatus.PAID,
      });

      await expect(
        service.updateOrderStatus(104, OrderStatus.PREPARING, 1, Role.CUSTOMER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow STAFF (Barista) to transition another user order from PAID -> PREPARING', async () => {
      const now = new Date();
      prisma.order.findUnique.mockResolvedValue({
        id: 104,
        userId: 2,
        status: OrderStatus.PAID,
        items: [],
      });
      prisma.order.update.mockResolvedValue({
        id: 104,
        status: OrderStatus.PREPARING,
        updatedAt: now,
      });

      const result = await service.updateOrderStatus(
        104,
        OrderStatus.PREPARING,
        99,
        Role.STAFF,
      );
      expect(result.status).toBe(OrderStatus.PREPARING);
    });

    it('should throw BadRequestException if state transition is invalid (PAID -> COMPLETED)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 105,
        userId: 1,
        status: OrderStatus.PAID,
      });

      await expect(
        service.updateOrderStatus(105, OrderStatus.COMPLETED, 1, Role.STAFF),
      ).rejects.toThrow(BadRequestException);
    });

    it('chặn khách hàng thường (role CUSTOMER) cố tình gọi updateOrderStatus với status: PAID (ném ForbiddenException)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 106,
        userId: 1,
        status: OrderStatus.PENDING,
        items: [],
      });

      await expect(
        service.updateOrderStatus(106, OrderStatus.PAID, 1, Role.CUSTOMER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('chặn khách hàng thường tự hủy đơn khi đơn không còn ở trạng thái PENDING (ném BadRequestException)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 107,
        userId: 1,
        status: OrderStatus.PAID,
        items: [],
      });

      await expect(
        service.updateOrderStatus(107, OrderStatus.CANCELLED, 1, Role.CUSTOMER),
      ).rejects.toThrow(BadRequestException);
    });

    it('cho phép khách hàng thường hủy đơn PENDING của chính mình sang CANCELLED, thành công và hoàn trả nguyên liệu kho', async () => {
      const now = new Date();
      prisma.order.findUnique.mockResolvedValue({
        id: 109,
        userId: 1,
        status: OrderStatus.PENDING,
        totalAmount: 50000,
        items: [
          {
            productId: 4,
            productName: 'Cà phê Muối',
            size: 'M',
            toppings: [],
            quantity: 1,
            unitPrice: 50000,
          },
        ],
      });

      const mockTx = {
        recipe: {
          findMany: vi.fn().mockResolvedValue([
            {
              productId: 4,
              size: 'M',
              amount: 25,
              ingredient: {
                id: 1,
                code: 'ING_ROBUSTA',
                name: 'Hạt Cà phê Robusta',
                unit: 'g',
              },
            },
          ]),
        },
        toppingRecipe: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        ingredient: {
          update: vi.fn().mockResolvedValue({}),
        },
        user: {
          update: vi.fn(),
        },
        order: {
          update: vi.fn().mockResolvedValue({
            id: 109,
            status: OrderStatus.CANCELLED,
            updatedAt: now,
          }),
        },
      };

      prisma.$transaction.mockImplementation(async (cb) => cb(mockTx));

      const result = await service.updateOrderStatus(
        109,
        OrderStatus.CANCELLED,
        1,
        Role.CUSTOMER,
      );

      expect(result.previousStatus).toBe(OrderStatus.PENDING);
      expect(result.status).toBe(OrderStatus.CANCELLED);
      // Hoàn kho 25g Robusta
      expect(mockTx.ingredient.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          stock: { increment: 25 },
          version: { increment: 1 },
        },
      });
      // Đơn PENDING chưa thanh toán nên không thu hồi điểm loyalty
      expect(mockTx.user.update).not.toHaveBeenCalled();
    });

    it('cho phép Staff/Admin cập nhật PAID -> PREPARING thành công', async () => {
      const now = new Date();
      prisma.order.findUnique.mockResolvedValue({
        id: 110,
        userId: 2,
        status: OrderStatus.PAID,
        items: [],
      });
      prisma.order.update.mockResolvedValue({
        id: 110,
        status: OrderStatus.PREPARING,
        updatedAt: now,
      });

      const result = await service.updateOrderStatus(
        110,
        OrderStatus.PREPARING,
        99,
        Role.STAFF,
      );

      expect(result.previousStatus).toBe(OrderStatus.PAID);
      expect(result.status).toBe(OrderStatus.PREPARING);
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 110 },
          data: expect.objectContaining({ status: OrderStatus.PREPARING }),
        }),
      );
    });

    it('cho phép Staff hủy đơn từ trạng thái PAID -> CANCELLED, tự động hoàn kho nguyên vật liệu và thu hồi điểm Loyalty', async () => {
      const now = new Date();
      prisma.order.findUnique.mockResolvedValue({
        id: 108,
        userId: 5,
        status: OrderStatus.PAID,
        totalAmount: 84000, // 84 điểm Hạt Vàng
        items: [
          {
            productId: 4,
            productName: 'Cà phê Muối',
            size: 'M',
            toppings: [],
            quantity: 2,
            unitPrice: 42000,
          },
        ],
      });

      const mockTx = {
        recipe: {
          findMany: vi.fn().mockResolvedValue([
            {
              productId: 4,
              size: 'M',
              amount: 25,
              ingredient: {
                id: 1,
                code: 'ING_ROBUSTA',
                name: 'Hạt Cà phê Robusta',
                unit: 'g',
              },
            },
          ]),
        },
        toppingRecipe: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        ingredient: {
          update: vi.fn().mockResolvedValue({}),
        },
        user: {
          update: vi.fn().mockResolvedValue({}),
        },
        order: {
          update: vi.fn().mockResolvedValue({
            id: 108,
            status: OrderStatus.CANCELLED,
            updatedAt: now,
          }),
        },
      };

      prisma.$transaction.mockImplementation(async (cb) => cb(mockTx));

      const result = await service.updateOrderStatus(
        108,
        OrderStatus.CANCELLED,
        99,
        Role.STAFF,
      );

      expect(result.previousStatus).toBe(OrderStatus.PAID);
      expect(result.status).toBe(OrderStatus.CANCELLED);
      // Hoàn kho 2 ly * 25g = 50g Robusta
      expect(mockTx.ingredient.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          stock: { increment: 50 },
          version: { increment: 1 },
        },
      });
      // Thu hồi 84 điểm Hạt Vàng
      expect(mockTx.user.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: {
          loyaltyPoints: { decrement: 84 },
        },
      });
    });
  });

  describe('Task 10 (c) — Concurrency & Ingredient Stock Optimistic Locking', () => {
    it('trừ tồn kho nguyên vật liệu chính xác theo định lượng Recipe (Size + Topping) với Optimistic Locking version', async () => {
      const mockTx = {
        recipe: {
          findMany: vi.fn().mockResolvedValue([
            {
              productId: 4,
              size: 'M',
              amount: 25,
              ingredient: {
                id: 1,
                code: 'ING_ROBUSTA',
                name: 'Hạt Cà phê Robusta',
                unit: 'g',
              },
            },
          ]),
        },
        toppingRecipe: {
          findMany: vi.fn().mockResolvedValue([
            {
              toppingId: 'boba',
              toppingName: 'Trân châu trắng giòn',
              amount: 40,
              ingredient: {
                id: 11,
                code: 'ING_BOBA',
                name: 'Trân Châu Trắng 3Q',
                unit: 'g',
              },
            },
          ]),
        },
        ingredient: {
          findUnique: vi
            .fn()
            .mockImplementation(({ where }: { where: { id: number } }) => {
              if (where.id === 1) {
                return Promise.resolve({
                  id: 1,
                  code: 'ING_ROBUSTA',
                  name: 'Hạt Cà phê Robusta',
                  unit: 'g',
                  stock: 500,
                  version: 3,
                });
              }
              return Promise.resolve({
                id: 11,
                code: 'ING_BOBA',
                name: 'Trân Châu Trắng 3Q',
                unit: 'g',
                stock: 200,
                version: 1,
              });
            }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        order: {
          create: vi.fn().mockResolvedValue({
            id: 301,
            status: OrderStatus.PENDING,
            totalAmount: 100000,
            discountCode: null,
            discountAmount: 0,
            items: [],
          }),
        },
      };

      prisma.$transaction.mockImplementation(async (cb) => cb(mockTx));

      const result = await service.createOrder(
        {
          items: [
            {
              productId: 4,
              productName: 'Cà phê Muối',
              size: 'M',
              toppings: ['Trân châu trắng giòn'],
              quantity: 2, // Cần 50g Robusta & 80g Trân châu
              unitPrice: 50000,
            },
          ],
        },
        1,
      );

      expect(result.orderId).toBe(301);
      expect(mockTx.ingredient.updateMany).toHaveBeenCalledWith({
        where: {
          id: 1,
          version: 3,
          stock: { gte: 50 },
        },
        data: {
          stock: { decrement: 50 },
          version: { increment: 1 },
        },
      });
      expect(mockTx.ingredient.updateMany).toHaveBeenCalledWith({
        where: {
          id: 11,
          version: 1,
          stock: { gte: 80 },
        },
        data: {
          stock: { decrement: 80 },
          version: { increment: 1 },
        },
      });
    });

    it('chặn bán vượt tồn kho (Overselling): ném BadRequestException khi nguyên vật liệu trong kho không đủ', async () => {
      const mockTx = {
        recipe: {
          findMany: vi.fn().mockResolvedValue([
            {
              productId: 8,
              size: 'ALL',
              amount: 1,
              ingredient: {
                id: 13,
                code: 'ING_PAIN_AU_CHOCOLAT',
                name: 'Bánh Pain au Chocolat (Nhập sẵn)',
                unit: 'chiếc',
              },
            },
          ]),
        },
        toppingRecipe: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        ingredient: {
          findUnique: vi.fn().mockResolvedValue({
            id: 13,
            code: 'ING_PAIN_AU_CHOCOLAT',
            name: 'Bánh Pain au Chocolat (Nhập sẵn)',
            unit: 'chiếc',
            stock: 1, // Kho chỉ còn đúng 1 chiếc bánh
            version: 0,
          }),
          updateMany: vi.fn(),
        },
        order: {
          create: vi.fn(),
        },
      };

      prisma.$transaction.mockImplementation(async (cb) => cb(mockTx));

      // Khách đặt 2 chiếc bánh khi kho chỉ còn 1 chiếc -> Chặn ngay!
      await expect(
        service.createOrder(
          {
            items: [
              {
                productId: 8,
                productName: 'Bánh Pain au Chocolat',
                size: 'M',
                toppings: [],
                quantity: 2,
                unitPrice: 39000,
              },
            ],
          },
          1,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockTx.order.create).not.toHaveBeenCalled();
    });

    it('chặn xung đột đặt đơn đồng thời (Optimistic Lock Race Condition): ném ConflictException (409) khi 2 khách tranh nhau phần nguyên liệu cuối cùng', async () => {
      const mockTx = {
        recipe: {
          findMany: vi.fn().mockResolvedValue([
            {
              productId: 1,
              size: 'M',
              amount: 25,
              ingredient: {
                id: 1,
                code: 'ING_ROBUSTA',
                name: 'Hạt Cà phê Robusta',
                unit: 'g',
              },
            },
          ]),
        },
        toppingRecipe: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        ingredient: {
          findUnique: vi.fn().mockResolvedValue({
            id: 1,
            code: 'ING_ROBUSTA',
            name: 'Hạt Cà phê Robusta',
            unit: 'g',
            stock: 25, // Chỉ còn đúng 25g đủ cho 1 ly duy nhất
            version: 5,
          }),
          // Giả lập request khác đã nhanh tay trừ kho trước và tăng version lên 6 -> count: 0
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        order: {
          create: vi.fn(),
        },
      };

      prisma.$transaction.mockImplementation(async (cb) => cb(mockTx));

      await expect(
        service.createOrder(
          {
            items: [
              {
                productId: 1,
                productName: 'Cà phê Đen',
                size: 'M',
                toppings: [],
                quantity: 1,
                unitPrice: 29000,
              },
            ],
          },
          2,
        ),
      ).rejects.toThrow(ConflictException);

      expect(mockTx.order.create).not.toHaveBeenCalled();
    });
  });

  describe('createOrder & Discount Codes (Voucher)', () => {
    it('áp dụng mã BREW10 giảm đúng 10% tổng đơn', async () => {
      const mockCreatedOrder = {
        id: 201,
        status: OrderStatus.PENDING,
        totalAmount: 90000,
        discountCode: 'BREW10',
        discountAmount: 10000,
        items: [],
      };

      prisma.$transaction.mockImplementation(async (cb) => {
        return cb({
          order: {
            create: vi.fn().mockResolvedValue(mockCreatedOrder),
          },
        });
      });

      const result = await service.createOrder(
        {
          items: [
            {
              productId: 1,
              productName: 'Cà phê Muối',
              size: 'M',
              toppings: [],
              quantity: 2,
              unitPrice: 50000,
            },
          ],
          discountCode: 'BREW10',
        },
        1,
      );

      expect(result.totalAmount).toBe(90000);
      expect(result.discountCode).toBe('BREW10');
      expect(result.discountAmount).toBe(10000);
    });

    it('áp dụng mã BREWCOZY giảm đúng 15% tổng đơn', async () => {
      prisma.product.findMany.mockResolvedValueOnce([
        {
          id: 1,
          name: 'Cà phê Sữa',
          basePrice: 100000,
          sizeUpchargeM: 0,
          sizeUpchargeL: 0,
          isActive: true,
        },
      ]);

      const mockCreatedOrder = {
        id: 202,
        status: OrderStatus.PENDING,
        totalAmount: 85000,
        discountCode: 'BREWCOZY',
        discountAmount: 15000,
        items: [],
      };

      prisma.$transaction.mockImplementation(async (cb) => {
        return cb({
          order: {
            create: vi.fn().mockResolvedValue(mockCreatedOrder),
          },
        });
      });

      const result = await service.createOrder(
        {
          items: [
            {
              productId: 1,
              productName: 'Cà phê Sữa',
              size: 'M',
              toppings: [],
              quantity: 1,
              unitPrice: 100000,
            },
          ],
          discountCode: 'brewcozy',
        },
        1,
      );

      expect(result.totalAmount).toBe(85000);
      expect(result.discountCode).toBe('BREWCOZY');
      expect(result.discountAmount).toBe(15000);
    });

    it('ném BadRequestException khi nhập mã giảm giá không hợp lệ', async () => {
      await expect(
        service.createOrder(
          {
            items: [
              {
                productId: 1,
                productName: 'Matcha Latte',
                size: 'S',
                toppings: [],
                quantity: 1,
                unitPrice: 45000,
              },
            ],
            discountCode: 'INVALID_CODE',
          },
          1,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('giới hạn mức giảm tối đa 15.000đ cho mã BREW10 khi đơn lớn', async () => {
      const mockCreatedOrder = {
        id: 203,
        status: OrderStatus.PENDING,
        totalAmount: 185000,
        discountCode: 'BREW10',
        discountAmount: 15000,
        items: [],
      };

      prisma.$transaction.mockImplementation(async (cb) => {
        return cb({
          order: {
            create: vi.fn().mockResolvedValue(mockCreatedOrder),
          },
        });
      });

      // Đơn 200.000đ, 10% = 20.000đ -> Giảm tối đa 15.000đ
      const result = await service.createOrder(
        {
          items: [
            {
              productId: 1,
              productName: 'Cà phê Muối',
              size: 'L',
              toppings: [],
              quantity: 4,
              unitPrice: 50000,
            },
          ],
          discountCode: 'BREW10',
        },
        1,
      );

      expect(result.discountAmount).toBe(15000);
    });

    it('từ chối mã BREW20 nếu đơn dưới 60.000đ và áp dụng đúng khi đủ điều kiện', async () => {
      // Đơn 50.000đ < 60.000đ -> Lỗi
      await expect(
        service.createOrder(
          {
            items: [
              {
                productId: 1,
                productName: 'Cà phê Muối',
                size: 'M',
                toppings: [],
                quantity: 1,
                unitPrice: 50000,
              },
            ],
            discountCode: 'BREW20',
          },
          1,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('giới hạn mức giảm tối đa 60.000đ cho mã BREW50', async () => {
      const mockCreatedOrder = {
        id: 204,
        status: OrderStatus.PENDING,
        totalAmount: 140000,
        discountCode: 'BREW50',
        discountAmount: 60000,
        items: [],
      };

      prisma.$transaction.mockImplementation(async (cb) => {
        return cb({
          order: {
            create: vi.fn().mockResolvedValue(mockCreatedOrder),
          },
        });
      });

      // Đơn 200.000đ, 50% = 100.000đ -> Giảm tối đa 60.000đ
      const result = await service.createOrder(
        {
          items: [
            {
              productId: 1,
              productName: 'Cà phê Phin',
              size: 'L',
              toppings: [],
              quantity: 4,
              unitPrice: 50000,
            },
          ],
          discountCode: 'BREW50',
        },
        1,
      );

      expect(result.discountAmount).toBe(60000);
    });

    it('tự tính đơn giá từ DB và bỏ qua unitPrice=0 do client gửi lên', async () => {
      prisma.product.findMany.mockResolvedValueOnce([
        {
          id: 4,
          name: 'Cà phê Muối',
          basePrice: 42000,
          sizeUpchargeM: 5000,
          sizeUpchargeL: 8000,
          isActive: true,
        },
      ]);
      prisma.toppingRecipe.findMany.mockResolvedValueOnce([
        {
          toppingId: 'boba',
          toppingName: 'Trân châu trắng giòn',
          price: 8000,
          isActive: true,
        },
      ]);

      let capturedCreateData: any = null;
      prisma.$transaction.mockImplementation(async (cb) => {
        return cb({
          recipe: { findMany: vi.fn().mockResolvedValue([]) },
          toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
          ingredient: { findUnique: vi.fn(), updateMany: vi.fn() },
          order: {
            create: vi.fn().mockImplementation(({ data }) => {
              capturedCreateData = data;
              return Promise.resolve({
                id: 501,
                status: OrderStatus.PENDING,
                discountCode: null,
                discountAmount: 0,
                ...data,
              });
            }),
          },
        });
      });

      const result = await service.createOrder(
        {
          items: [
            {
              productId: 4,
              productName: 'Cà phê Muối',
              size: 'M',
              toppings: ['Trân châu trắng giòn'],
              quantity: 2,
              unitPrice: 0, // Client cố tình hack giá = 0đ
            },
          ],
        },
        1,
      );

      // Backend tự tính đơn giá: 42.000 + 5.000 (size M) + 8.000 (topping) = 55.000đ/ly
      // Subtotal = 55.000 * 2 = 110.000đ, VAT 8% = 8.800đ -> totalAmount = 118.000đ
      expect(capturedCreateData.items.create[0].unitPrice).toBe(55000);
      expect(capturedCreateData.totalAmount).toBe(118000);
      expect(result.totalAmount).toBe(118000);
    });

    it('ném BadRequestException khi sản phẩm không tồn tại hoặc đã ngừng kinh doanh (isActive=false)', async () => {
      prisma.product.findMany.mockResolvedValueOnce([
        {
          id: 99,
          name: 'Món đã ngừng bán',
          basePrice: 50000,
          isActive: false,
        },
      ]);

      await expect(
        service.createOrder(
          {
            items: [
              {
                productId: 99,
                productName: 'Món đã ngừng bán',
                size: 'M',
                toppings: [],
                quantity: 1,
                unitPrice: 50000,
              },
            ],
          },
          1,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
