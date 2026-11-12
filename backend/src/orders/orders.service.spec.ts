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
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { computeRequiredIngredients } from './bom.helper.js';

describe('OrdersService — Task 10 & Sprint 4 (State Machine, BOM Inventory Optimistic Locking, RBAC)', () => {
  let service: OrdersService;
  let prisma: {
    order: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    product: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    toppingRecipe: {
      findMany: ReturnType<typeof vi.fn>;
    };
    storeSetting: {
      findMany: ReturnType<typeof vi.fn>;
    };
    discountCode: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    userVoucher: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
    $queryRaw?: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    prisma = {
      order: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
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
            category: 'bakery',
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
      storeSetting: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      discountCode: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          const code = where?.code?.toUpperCase();
          const mockCodes: Record<string, any> = {
            BREW10: {
              id: 1,
              code: 'BREW10',
              discountPercent: 10,
              minOrderAmount: 0,
              maxDiscountAmount: 15000,
              isActive: true,
            },
            BREWCOZY: {
              id: 2,
              code: 'BREWCOZY',
              discountPercent: 15,
              minOrderAmount: 0,
              maxDiscountAmount: 25000,
              isActive: true,
            },
            BREW20: {
              id: 3,
              code: 'BREW20',
              discountPercent: 20,
              minOrderAmount: 60000,
              maxDiscountAmount: 25000,
              isActive: true,
            },
            WELCOME20: {
              id: 4,
              code: 'WELCOME20',
              discountPercent: 20,
              minOrderAmount: 0,
              maxDiscountAmount: 25000,
              isActive: true,
            },
            BREW50: {
              id: 5,
              code: 'BREW50',
              discountPercent: 50,
              minOrderAmount: 120000,
              maxDiscountAmount: 60000,
              isActive: true,
            },
          };
          return mockCodes[code] || null;
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      userVoucher: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: vi.fn(async (cb) => cb(prisma)),
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
      prisma.order.findUnique
        .mockResolvedValueOnce({
          id: 104,
          userId: 2,
          status: OrderStatus.PAID,
          items: [],
        })
        .mockResolvedValueOnce({
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
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
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

    it('[INV-01] ném ConflictException và không hoàn kho nếu phát hiện Race Condition khi hủy đơn song song (casResult.count === 0)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 115,
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
        recipe: { findMany: vi.fn().mockResolvedValue([]) },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        ingredient: { update: vi.fn() },
        user: { update: vi.fn() },
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }), // Bị cạnh tranh bởi cron/request khác
        },
      };

      prisma.$transaction.mockImplementation(async (cb) => cb(mockTx));

      await expect(
        service.updateOrderStatus(115, OrderStatus.CANCELLED, 1, Role.CUSTOMER),
      ).rejects.toThrow(ConflictException);

      // Tuyệt đối không cộng kho 2 lần
      expect(mockTx.ingredient.update).not.toHaveBeenCalled();
    });

    it('[INV-02] cancelExpiredPendingOrders quét và tự động hủy cả đơn PENDING lẫn PAYMENT_FAILED quá 5 phút để giải phóng kho', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: 201,
          status: OrderStatus.PENDING,
          createdAt: new Date(Date.now() - 6 * 60 * 1000),
          items: [
            {
              productId: 4,
              size: 'M',
              toppings: [],
              quantity: 1,
            },
          ],
        },
        {
          id: 202,
          status: OrderStatus.PAYMENT_FAILED,
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
          items: [
            {
              productId: 4,
              size: 'M',
              toppings: [],
              quantity: 2,
            },
          ],
        },
      ]);

      const mockTx = {
        recipe: {
          findMany: vi.fn().mockResolvedValue([
            {
              productId: 4,
              size: 'M',
              amount: 25,
              ingredient: { id: 1 },
            },
          ]),
        },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        ingredient: { update: vi.fn() },
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };

      prisma.$transaction.mockImplementation(async (cb) => cb(mockTx));

      const count = await service.cancelExpiredPendingOrders();
      expect(count).toBe(2);
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED] },
          }),
        }),
      );
      // Đã hoàn kho cho cả 2 đơn
      expect(mockTx.ingredient.update).toHaveBeenCalled();
    });

    it('cho phép Staff/Admin cập nhật PAID -> PREPARING thành công', async () => {
      const now = new Date();
      prisma.order.findUnique
        .mockResolvedValueOnce({
          id: 110,
          userId: 2,
          status: OrderStatus.PAID,
          items: [],
        })
        .mockResolvedValueOnce({
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
      expect(prisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 110, status: OrderStatus.PAID },
          data: expect.objectContaining({
            status: OrderStatus.PREPARING,
            version: { increment: 1 },
          }),
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
          findUnique: vi.fn().mockResolvedValue({ loyaltyPoints: 100 }),
          update: vi.fn().mockResolvedValue({}),
        },
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
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
      // Thu hồi 84 điểm Hạt Vàng (100 - 84 = 16)
      expect(mockTx.user.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: {
          loyaltyPoints: 16,
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

    it('tính toán và trừ kho thông minh các bao bì vật tư phụ trợ (Ống hút Boba/Bio, Túi đôi/Túi đơn, Khăn, Muỗng)', async () => {
      const packagingItems = [
        { id: 284, code: 'PKG_CUP_M', name: 'Ly Kraft M', unit: 'chiếc', stock: 100, isRequiredForSale: true, version: 1 },
        { id: 288, code: 'PKG_LID_FLAT', name: 'Nắp phẳng', unit: 'cái', stock: 100, isRequiredForSale: true, version: 1 },
        { id: 290, code: 'PKG_STRAW_BIO', name: 'Ống hút Bio', unit: 'ống', stock: 100, isRequiredForSale: false, version: 1 },
        { id: 291, code: 'PKG_STRAW_BOBA', name: 'Ống hút Boba', unit: 'ống', stock: 100, isRequiredForSale: false, version: 1 },
        { id: 292, code: 'PKG_BAG_T', name: 'Túi chữ T', unit: 'chiếc', stock: 100, isRequiredForSale: false, version: 1 },
        { id: 293, code: 'PKG_BAG_2CUP', name: 'Túi 2 ly', unit: 'chiếc', stock: 100, isRequiredForSale: false, version: 1 },
        { id: 294, code: 'PKG_TISSUE', name: 'Khăn giấy', unit: 'tờ', stock: 100, isRequiredForSale: false, version: 1 },
        { id: 295, code: 'PKG_SPOON', name: 'Muỗng', unit: 'cái', stock: 100, isRequiredForSale: false, version: 1 },
      ];

      const mockTx = {
        recipe: {
          findMany: vi.fn().mockResolvedValue([
            { productId: 1, size: 'M', amount: 1, ingredient: packagingItems[0] },
            { productId: 1, size: 'M', amount: 1, ingredient: packagingItems[1] },
            { productId: 8, size: 'ALL', amount: 1, ingredient: { id: 13, code: 'ING_PAIN', name: 'Bánh Pain', unit: 'chiếc', stock: 20, isRequiredForSale: true, version: 1 } },
          ]),
        },
        toppingRecipe: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        product: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, category: 'vietnamese' },
            { id: 8, category: 'bakery' },
          ]),
        },
        ingredient: {
          findMany: vi.fn().mockResolvedValue(packagingItems.slice(2)),
          findUnique: vi.fn().mockImplementation(({ where }: { where: { id: number } }) => {
            const found = packagingItems.find((p) => p.id === where.id);
            if (found) return Promise.resolve(found);
            if (where.id === 13) return Promise.resolve({ id: 13, code: 'ING_PAIN', name: 'Bánh Pain', unit: 'chiếc', stock: 20, isRequiredForSale: true, version: 1 });
            return Promise.resolve(null);
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        order: {
          create: vi.fn().mockResolvedValue({
            id: 888,
            status: OrderStatus.PENDING,
            totalAmount: 150000,
            items: [],
          }),
        },
      };

      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await service.createOrder(
        {
          items: [
            { productId: 1, productName: 'Cà phê Đen', size: 'M', toppings: [], quantity: 2, unitPrice: 29000 },
            { productId: 1, productName: 'Cà phê Đen', size: 'M', toppings: ['Trân châu trắng'], quantity: 1, unitPrice: 37000 },
            { productId: 8, productName: 'Bánh Pain', size: 'ALL', toppings: [], quantity: 1, unitPrice: 39000 },
          ],
        },
        1,
      );

      // Ly M: 3
      expect(mockTx.ingredient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 284 }),
          data: expect.objectContaining({ stock: { decrement: 3 } }),
        }),
      );
      // Nắp phẳng: 3
      expect(mockTx.ingredient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 288 }),
          data: expect.objectContaining({ stock: { decrement: 3 } }),
        }),
      );
      // Ống hút bio: 2
      expect(mockTx.ingredient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 290 }),
          data: expect.objectContaining({ stock: { decrement: 2 } }),
        }),
      );
      // Ống hút boba: 1
      expect(mockTx.ingredient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 291 }),
          data: expect.objectContaining({ stock: { decrement: 1 } }),
        }),
      );
      // Túi 2 ly: 1
      expect(mockTx.ingredient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 293 }),
          data: expect.objectContaining({ stock: { decrement: 1 } }),
        }),
      );
      // Túi chữ T: 1
      expect(mockTx.ingredient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 292 }),
          data: expect.objectContaining({ stock: { decrement: 1 } }),
        }),
      );
      // Khăn giấy: 3
      expect(mockTx.ingredient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 294 }),
          data: expect.objectContaining({ stock: { decrement: 3 } }),
        }),
      );
      // Muỗng: 1
      expect(mockTx.ingredient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 295 }),
          data: expect.objectContaining({ stock: { decrement: 1 } }),
        }),
      );
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

    it('đọc phụ thu size chuẩn từ StoreSetting khi sizeUpchargeM/L là null và miễn phụ thu cho bánh ngọt', async () => {
      prisma.product.findMany.mockResolvedValueOnce([
        {
          id: 1,
          name: 'Cà phê Đen',
          basePrice: 29000,
          category: 'vietnamese',
          sizeUpchargeM: null,
          sizeUpchargeL: null,
          isActive: true,
        },
        {
          id: 8,
          name: 'Bánh Pain au Chocolat',
          basePrice: 39000,
          category: 'bakery',
          sizeUpchargeM: null,
          sizeUpchargeL: null,
          isActive: true,
        },
      ]);
      prisma.toppingRecipe.findMany.mockResolvedValueOnce([]);
      prisma.storeSetting.findMany.mockResolvedValueOnce([
        { key: 'SIZE_UPCHARGE_S', value: '0' },
        { key: 'SIZE_UPCHARGE_M', value: '6000' },
        { key: 'SIZE_UPCHARGE_L', value: '12000' },
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
                id: 502,
                status: OrderStatus.PENDING,
                discountCode: null,
                discountAmount: 0,
                ...data,
              });
            }),
          },
        });
      });

      await service.createOrder(
        {
          items: [
            {
              productId: 1,
              productName: 'Cà phê Đen',
              size: 'L',
              toppings: [],
              quantity: 1,
            },
            {
              productId: 8,
              productName: 'Bánh Pain au Chocolat',
              size: 'M',
              toppings: [],
              quantity: 1,
            },
          ],
        },
        1,
      );

      // Cà phê Đen Size L: 29.000 + 12.000 (từ StoreSetting) = 41.000đ
      // Bánh ngọt gửi size 'M' nhưng category='bakery' -> 39.000 + 0 = 39.000đ
      expect(capturedCreateData.items.create[0].unitPrice).toBe(41000);
      expect(capturedCreateData.items.create[1].unitPrice).toBe(39000);
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

    it('chống Spam Cart Hoarding DoS: ném BadRequestException khi user đã có >= 5 đơn PENDING', async () => {
      prisma.order.count.mockResolvedValueOnce(5);

      await expect(
        service.createOrder(
          {
            items: [
              {
                productId: 1,
                productName: 'Cà phê',
                size: 'M',
                toppings: [],
                quantity: 1,
              },
            ],
          },
          1,
        ),
      ).rejects.toThrow(/Bạn đang có 5 đơn hàng chờ thanh toán/i);
    });

    it('chống gian lận dùng 1 voucher cá nhân cho nhiều đơn PENDING đồng thời', async () => {
      // 0 đơn pending tổng thể
      prisma.order.count.mockResolvedValueOnce(0);

      // product mock
      prisma.product.findMany.mockResolvedValueOnce([
        { id: 1, name: 'Cà phê Đen', basePrice: 29000, isActive: true },
      ]);
      (prisma as any).toppingRecipe = {
        findMany: vi.fn().mockResolvedValue([]),
      };
      (prisma as any).discountCode = {
        findUnique: vi.fn().mockResolvedValue(null),
      };
      (prisma as any).userVoucher = {
        findUnique: vi.fn().mockResolvedValue({
          id: 1,
          userId: 1,
          code: 'PERSONAL10',
          quantity: 1,
          discountPercent: 10,
        }),
      };

      // Giả lập đã có 1 đơn PENDING đang áp dụng mã này
      prisma.order.count.mockResolvedValueOnce(1);

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
              },
            ],
            discountCode: 'PERSONAL10',
          },
          1,
        ),
      ).rejects.toThrow(/Voucher cá nhân "PERSONAL10" đang được áp dụng cho một đơn hàng chờ thanh toán khác/i);
    });
  });

  describe('Tasks 1.1, 1.3, 1.5, 1.6 — CRITICAL-10, HIGH-07, HIGH-04, HIGH-05', () => {
    it('[HIGH-07] chặn tuyệt đối nhân viên quầy nhảy cóc sang PAID qua updateOrderStatus (PATCH /orders/:id/status)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 108,
        userId: 1,
        status: OrderStatus.PENDING,
        items: [],
      });

      await expect(
        service.updateOrderStatus(108, OrderStatus.PAID, 99, Role.STAFF),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateOrderStatus(108, OrderStatus.PAID, 99, Role.STAFF),
      ).rejects.toThrow(
        /Trạng thái ĐÃ THANH TOÁN \(PAID\) chỉ được phép cập nhật thông qua Cổng thanh toán hoặc Xác nhận thanh toán hợp lệ/,
      );
    });

    it('[HIGH-05] chặn sàn số dư điểm Hạt Vàng không bao giờ bị âm khi hủy đơn hàng', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 109,
        userId: 7,
        status: OrderStatus.PAID,
        totalAmount: 100000, // 100 điểm cần thu hồi
        items: [],
      });

      const mockTx = {
        recipe: { findMany: vi.fn().mockResolvedValue([]) },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        ingredient: { update: vi.fn().mockResolvedValue({}) },
        user: {
          findUnique: vi.fn().mockResolvedValue({ loyaltyPoints: 30 }), // Chỉ còn 30 điểm
          update: vi.fn().mockResolvedValue({}),
        },
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 109,
            status: OrderStatus.CANCELLED,
            updatedAt: new Date(),
          }),
        },
      };

      prisma.$transaction.mockImplementation(async (cb) => cb(mockTx));

      await service.updateOrderStatus(109, OrderStatus.CANCELLED, 99, Role.STAFF);

      // Điểm thu hồi 100 > số dư 30 -> số dư sàn về 0
      expect(mockTx.user.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: {
          loyaltyPoints: 0,
        },
      });
    });

    it('[HIGH-04] luôn gán cứng productName từ CSDL chống giả mạo tên món trong CreateOrderDto', async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: 4,
          name: 'Cà phê Robusta Đen Đá',
          basePrice: 29000,
          sizeUpchargeM: 0,
          sizeUpchargeL: 0,
          isActive: true,
        },
      ]);

      const mockTx = {
        recipe: { findMany: vi.fn().mockResolvedValue([]) },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        ingredient: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        order: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({
            id: 401,
            status: OrderStatus.PENDING,
            totalAmount: data.totalAmount,
            discountCode: null,
            discountAmount: 0,
            items: data.items.create,
          })),
        },
      };

      prisma.$transaction.mockImplementation(async (cb) => cb(mockTx));

      await service.createOrder(
        {
          items: [
            {
              productId: 4,
              productName: 'Combo Vip Hoàng Gia 500k', // Tên giả mạo
              size: 'M',
              toppings: [],
              quantity: 1,
            },
          ],
        },
        1,
      );

      expect(mockTx.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            items: {
              create: [
                expect.objectContaining({
                  productId: 4,
                  productName: 'Cà phê Robusta Đen Đá', // Phải là tên thật trong DB
                }),
              ],
            },
          }),
        }),
      );
    });

    it('[CRITICAL-10] lưu đầy đủ sugarLevel, iceLevel, temperature, notes vào OrderItem khi tạo đơn', async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: 4,
          name: 'Cà phê Muối',
          basePrice: 42000,
          sizeUpchargeM: 0,
          sizeUpchargeL: 8000,
          isActive: true,
        },
      ]);

      const mockTx = {
        recipe: { findMany: vi.fn().mockResolvedValue([]) },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        ingredient: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        order: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({
            id: 402,
            status: OrderStatus.PENDING,
            totalAmount: data.totalAmount,
            discountCode: null,
            discountAmount: 0,
            items: data.items.create,
          })),
        },
      };

      prisma.$transaction.mockImplementation(async (cb) => cb(mockTx));

      await service.createOrder(
        {
          items: [
            {
              productId: 4,
              productName: 'Cà phê Muối',
              size: 'M',
              sugarLevel: '30%',
              iceLevel: '50%',
              temperature: 'HOT',
              notes: 'Ít ngọt nhiều béo dặn riêng',
              toppings: [],
              quantity: 1,
            },
          ],
        },
        1,
      );

      expect(mockTx.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            items: {
              create: [
                expect.objectContaining({
                  productId: 4,
                  sugarLevel: '30%',
                  iceLevel: '50%',
                  temperature: 'HOT',
                  notes: 'Ít ngọt nhiều béo dặn riêng',
                }),
              ],
            },
          }),
        }),
      );
    });
  });

  describe('Task 2 — BOM Packaging Actual Deduction, InventoryLog & Refund Integrity', () => {
    it('createOrder chỉ ghi SALE InventoryLog cho phần bao bì phụ trợ thực tế đã trừ (bỏ qua bao bì stock=0 hoặc updateMany count=0)', async () => {
      const robIng = {
        id: 1,
        code: 'ING_ROBUSTA',
        name: 'Hạt Cà phê Robusta',
        unit: 'g',
        stock: 500,
        isRequiredForSale: true,
        version: 2,
      };
      const strawBio = {
        id: 290,
        code: 'PKG_STRAW_BIO',
        name: 'Ống hút Bio',
        unit: 'ống',
        stock: 0, // Hết hàng -> không trừ, không ghi log SALE
        isRequiredForSale: false,
        version: 1,
      };
      const tissue = {
        id: 294,
        code: 'PKG_TISSUE',
        name: 'Khăn giấy',
        unit: 'tờ',
        stock: 2, // Cần 3 nhưng chỉ còn 2 -> chỉ trừ 2 và ghi log -2
        isRequiredForSale: false,
        version: 4,
      };
      const bagT = {
        id: 292,
        code: 'PKG_BAG_T',
        name: 'Túi chữ T',
        unit: 'chiếc',
        stock: 5, // Bị race condition count=0 khi trừ phụ trợ -> không chặn đơn, không ghi log SALE
        isRequiredForSale: false,
        version: 1,
      };
      const bag2Cup = {
        id: 293,
        code: 'PKG_BAG_2CUP',
        name: 'Túi 2 ly',
        unit: 'chiếc',
        stock: 10,
        isRequiredForSale: false,
        version: 1,
      };

      const allIngs = [robIng, strawBio, bagT, bag2Cup, tissue];
      const inventoryLogCreate = vi.fn().mockResolvedValue({});

      const mockTx = {
        recipe: {
          findMany: vi.fn().mockResolvedValue([
            { productId: 1, size: 'M', amount: 25, ingredient: robIng },
          ]),
        },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        product: {
          findMany: vi.fn().mockResolvedValue([{ id: 1, category: 'vietnamese' }]),
        },
        ingredient: {
          findMany: vi.fn().mockResolvedValue([strawBio, bagT, bag2Cup, tissue]),
          findUnique: vi.fn().mockImplementation(({ where }: { where: { id: number } }) =>
            Promise.resolve(allIngs.find((i) => i.id === where.id) || null),
          ),
          updateMany: vi.fn().mockImplementation(({ where }: { where: { id: number } }) => {
            if (where.id === 292) return Promise.resolve({ count: 0 });
            return Promise.resolve({ count: 1 });
          }),
        },
        inventoryLog: {
          create: inventoryLogCreate,
        },
        order: {
          create: vi.fn().mockResolvedValue({
            id: 701,
            status: OrderStatus.PENDING,
            totalAmount: 150000,
            discountCode: null,
            discountAmount: 0,
            items: [],
          }),
        },
      };

      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await service.createOrder(
        {
          items: [
            {
              productId: 1,
              productName: 'Cà phê Muối',
              size: 'M',
              toppings: [],
              quantity: 3,
              unitPrice: 50000,
            },
          ],
        },
        10,
      );

      // Chỉ có 3 log SALE (ING_ROBUSTA -75, PKG_BAG_2CUP -1, PKG_TISSUE -2); KHÔNG log PKG_STRAW_BIO và PKG_BAG_T
      expect(inventoryLogCreate).toHaveBeenCalledTimes(3);
      expect(inventoryLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ingredientId: 1,
          ingredientName: 'Hạt Cà phê Robusta',
          unit: 'g',
          type: 'SALE',
          changeAmount: -75,
          previousStock: 500,
          newStock: 425,
          note: 'Xuất bán đơn hàng #701',
        }),
      });
      expect(inventoryLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ingredientId: 294,
          ingredientName: 'Khăn giấy',
          unit: 'tờ',
          type: 'SALE',
          changeAmount: -2,
          previousStock: 2,
          newStock: 0,
          note: 'Xuất bán đơn hàng #701',
        }),
      });
      expect(inventoryLogCreate).not.toHaveBeenCalledWith({
        data: expect.objectContaining({ ingredientId: 290 }),
      });
      expect(inventoryLogCreate).not.toHaveBeenCalledWith({
        data: expect.objectContaining({ ingredientId: 292 }),
      });
    });

    it('hủy đơn hoàn kho chính xác theo SALE InventoryLog (không hoàn thừa bao bì) và tạo CANCEL_REFUND đủ ingredientName/unit', async () => {
      const now = new Date();
      prisma.order.findUnique.mockResolvedValue({
        id: 702,
        userId: 5,
        status: OrderStatus.PENDING,
        totalAmount: 100000,
        discountCode: null,
        voucherDeducted: false,
        items: [
          { productId: 1, size: 'M', toppings: [], quantity: 3 },
        ],
      });

      const inventoryLogCreate = vi.fn().mockResolvedValue({});
      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 702,
            status: OrderStatus.CANCELLED,
            updatedAt: now,
          }),
        },
        inventoryLog: {
          findMany: vi.fn().mockResolvedValue([
            {
              ingredientId: 1,
              ingredientName: 'Hạt Cà phê Robusta',
              unit: 'g',
              changeAmount: -75,
            },
            {
              ingredientId: 294,
              ingredientName: 'Khăn giấy',
              unit: 'tờ',
              changeAmount: -2,
            },
          ]),
          create: inventoryLogCreate,
        },
        ingredient: {
          update: vi.fn().mockImplementation(({ where }: { where: { id: number } }) => {
            if (where.id === 1) {
              return Promise.resolve({ id: 1, name: 'Hạt Cà phê Robusta', unit: 'g', stock: 500 });
            }
            return Promise.resolve({ id: 294, name: 'Khăn giấy', unit: 'tờ', stock: 2 });
          }),
        },
        recipe: { findMany: vi.fn() },
      };

      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await service.updateOrderStatus(702, OrderStatus.CANCELLED, 5, Role.CUSTOMER);

      expect(mockTx.inventoryLog.findMany).toHaveBeenCalledWith({
        where: { type: 'SALE', note: 'Xuất bán đơn hàng #702' },
      });
      // Không dùng recipe fallback khi đã có SALE logs
      expect(mockTx.recipe.findMany).not.toHaveBeenCalled();
      expect(mockTx.ingredient.update).toHaveBeenCalledTimes(2);
      expect(mockTx.ingredient.update).toHaveBeenCalledWith({
        where: { id: 294 },
        data: { stock: { increment: 2 }, version: { increment: 1 } },
      });
      expect(inventoryLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ingredientId: 294,
          ingredientName: 'Khăn giấy',
          unit: 'tờ',
          type: 'CANCEL_REFUND',
          changeAmount: 2,
          previousStock: 0,
          newStock: 2,
          note: 'Hoàn kho do hủy đơn hàng #702',
          performedBy: 'User #5',
        }),
      });
    });

    it('hủy đơn không có SALE log fallback sang computeRequiredIngredients và vẫn ghi CANCEL_REFUND đủ ingredientName/unit', async () => {
      const now = new Date();
      prisma.order.findUnique.mockResolvedValue({
        id: 703,
        userId: 5,
        status: OrderStatus.PENDING,
        totalAmount: 50000,
        discountCode: null,
        voucherDeducted: false,
        items: [{ productId: 4, size: 'M', toppings: [], quantity: 1 }],
      });

      const inventoryLogCreate = vi.fn().mockResolvedValue({});
      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 703,
            status: OrderStatus.CANCELLED,
            updatedAt: now,
          }),
        },
        inventoryLog: {
          findMany: vi.fn().mockResolvedValue([]),
          create: inventoryLogCreate,
        },
        recipe: {
          findMany: vi.fn().mockResolvedValue([
            {
              productId: 4,
              size: 'M',
              amount: 25,
              ingredient: { id: 1, code: 'ING_ROBUSTA', name: 'Hạt Cà phê Robusta', unit: 'g' },
            },
          ]),
        },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        ingredient: {
          update: vi.fn().mockResolvedValue({ id: 1, name: 'Hạt Cà phê Robusta', unit: 'g', stock: 125 }),
        },
      };

      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await service.updateOrderStatus(703, OrderStatus.CANCELLED, 5, Role.CUSTOMER);

      expect(inventoryLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ingredientId: 1,
          ingredientName: 'Hạt Cà phê Robusta',
          unit: 'g',
          type: 'CANCEL_REFUND',
          changeAmount: 25,
          previousStock: 100,
          newStock: 125,
        }),
      });
    });

    it('hủy đơn có voucherDeducted=true và vé cuối cùng đã bị xóa -> tạo lại UserVoucher theo DiscountCode hoặc mặc định', async () => {
      const now = new Date();
      prisma.order.findUnique.mockResolvedValue({
        id: 704,
        userId: 8,
        status: OrderStatus.PENDING,
        totalAmount: 90000,
        discountCode: 'PERSONAL20',
        voucherDeducted: true,
        items: [],
      });

      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 704,
            status: OrderStatus.CANCELLED,
            updatedAt: now,
          }),
        },
        userVoucher: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
          update: vi.fn(),
        },
        discountCode: {
          findUnique: vi.fn().mockResolvedValue({
            code: 'PERSONAL20',
            discountPercent: 20,
            minOrderAmount: 50000,
            maxDiscountAmount: 30000,
          }),
          updateMany: vi.fn(),
        },
      };

      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await service.updateOrderStatus(704, OrderStatus.CANCELLED, 8, Role.CUSTOMER);

      expect(mockTx.userVoucher.create).toHaveBeenCalledWith({
        data: {
          userId: 8,
          code: 'PERSONAL20',
          quantity: 1,
          discountPercent: 20,
          minOrderAmount: 50000,
          maxDiscountAmount: 30000,
        },
      });
      expect(mockTx.discountCode.updateMany).not.toHaveBeenCalled();
    });

    it('hủy đơn dùng mã toàn hệ thống (voucherDeducted=false) -> giảm DiscountCode.usageCount (mutually exclusive với UserVoucher)', async () => {
      const now = new Date();
      prisma.order.findUnique.mockResolvedValue({
        id: 705,
        userId: 8,
        status: OrderStatus.PENDING,
        totalAmount: 90000,
        discountCode: 'BREW10',
        voucherDeducted: false,
        items: [],
      });

      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 705,
            status: OrderStatus.CANCELLED,
            updatedAt: now,
          }),
        },
        userVoucher: {
          findUnique: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
        },
        discountCode: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };

      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await service.updateOrderStatus(705, OrderStatus.CANCELLED, 8, Role.CUSTOMER);

      expect(mockTx.discountCode.updateMany).toHaveBeenCalledWith({
        where: { code: 'BREW10', usageCount: { gt: 0 } },
        data: { usageCount: { decrement: 1 } },
      });
      expect(mockTx.userVoucher.findUnique).not.toHaveBeenCalled();
    });

    it('cancelExpiredPendingOrders gọi refundOrderResources để hoàn DiscountCode.usageCount và reset voucherDeducted=false', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: 706,
          userId: 9,
          status: OrderStatus.PENDING,
          discountCode: 'BREW10',
          voucherDeducted: false,
          createdAt: new Date(Date.now() - 6 * 60 * 1000),
          items: [],
        },
      ]);

      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        discountCode: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };

      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const count = await service.cancelExpiredPendingOrders();

      expect(count).toBe(1);
      expect(mockTx.order.updateMany).toHaveBeenCalledWith({
        where: { id: 706, status: OrderStatus.PENDING },
        data: expect.objectContaining({
          status: OrderStatus.CANCELLED,
          voucherDeducted: false,
          version: { increment: 1 },
        }),
      });
      expect(mockTx.discountCode.updateMany).toHaveBeenCalledWith({
        where: { code: 'BREW10', usageCount: { gt: 0 } },
        data: { usageCount: { decrement: 1 } },
      });
    });
  });

  describe('Task 3 — Retry PAYMENT_FAILED -> PENDING, CAS Guards, COMPLETED staffData & deleteOrder Integrity', () => {
    it('cho phép Customer thử lại thanh toán (PAYMENT_FAILED -> PENDING) trong hạn 5 phút với CAS updateMany', async () => {
      const now = new Date();
      prisma.order.findUnique.mockResolvedValue({
        id: 801,
        userId: 5,
        status: OrderStatus.PAYMENT_FAILED,
        createdAt: new Date(Date.now() - 2 * 60 * 1000),
        items: [],
      });

      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 801,
            status: OrderStatus.PENDING,
            updatedAt: now,
            staffId: null,
            staffName: null,
          }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const result = await service.updateOrderStatus(
        801,
        OrderStatus.PENDING,
        5,
        Role.CUSTOMER,
      );

      expect(result.previousStatus).toBe(OrderStatus.PAYMENT_FAILED);
      expect(result.status).toBe(OrderStatus.PENDING);
      expect(mockTx.order.updateMany).toHaveBeenCalledWith({
        where: { id: 801, status: OrderStatus.PAYMENT_FAILED },
        data: { status: OrderStatus.PENDING, version: { increment: 1 } },
      });
    });

    it('chặn Customer tự chuyển PAYMENT_FAILED -> PAID (ném ForbiddenException) và chặn non-owner retry (ném ForbiddenException)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 802,
        userId: 5,
        status: OrderStatus.PAYMENT_FAILED,
        createdAt: new Date(),
        items: [],
      });

      await expect(
        service.updateOrderStatus(802, OrderStatus.PAID, 5, Role.CUSTOMER),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.updateOrderStatus(802, OrderStatus.PENDING, 999, Role.CUSTOMER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('khi Customer retry PAYMENT_FAILED -> PENDING nhưng đơn đã quá hạn 5 phút: CAS-cancel + refundOrderResources rồi ném BadRequestException', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 803,
        userId: 5,
        status: OrderStatus.PAYMENT_FAILED,
        discountCode: 'BREW10',
        voucherDeducted: false,
        createdAt: new Date(Date.now() - 6 * 60 * 1000),
        items: [{ productId: 4, size: 'M', toppings: [], quantity: 1 }],
      });

      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        inventoryLog: {
          findMany: vi.fn().mockResolvedValue([
            { ingredientId: 1, ingredientName: 'Robusta', unit: 'g', changeAmount: -25 },
          ]),
          create: vi.fn().mockResolvedValue({}),
        },
        ingredient: {
          update: vi.fn().mockResolvedValue({ id: 1, name: 'Robusta', unit: 'g', stock: 125 }),
        },
        discountCode: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await expect(
        service.updateOrderStatus(803, OrderStatus.PENDING, 5, Role.CUSTOMER),
      ).rejects.toThrow(
        new BadRequestException('Đơn hàng đã quá hạn thanh toán (5 phút) và đã được tự động hủy.'),
      );

      expect(mockTx.order.updateMany).toHaveBeenCalledWith({
        where: { id: 803, status: OrderStatus.PAYMENT_FAILED },
        data: {
          status: OrderStatus.CANCELLED,
          voucherDeducted: false,
          version: { increment: 1 },
        },
      });
      expect(mockTx.ingredient.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { stock: { increment: 25 }, version: { increment: 1 } },
      });
      expect(mockTx.inventoryLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'CANCEL_REFUND',
          note: 'Hoàn kho do đơn hàng quá hạn 5 phút khi thử lại #803',
        }),
      });
      expect(mockTx.discountCode.updateMany).toHaveBeenCalled();
    });

    it('ném ConflictException khi CAS retry PAYMENT_FAILED -> PENDING gặp race condition (count === 0)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 804,
        userId: 5,
        status: OrderStatus.PAYMENT_FAILED,
        createdAt: new Date(Date.now() - 60 * 1000),
        items: [],
      });

      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await expect(
        service.updateOrderStatus(804, OrderStatus.PENDING, 5, Role.CUSTOMER),
      ).rejects.toThrow(ConflictException);
    });

    it('ném ConflictException khi PREPARING hoặc READY thất bại CAS guard (count === 0)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 805,
        userId: 5,
        status: OrderStatus.PAID,
        items: [],
      });
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateOrderStatus(805, OrderStatus.PREPARING, 99, Role.STAFF),
      ).rejects.toThrow(ConflictException);

      prisma.order.findUnique.mockResolvedValue({
        id: 805,
        userId: 5,
        status: OrderStatus.PREPARING,
        items: [],
      });
      await expect(
        service.updateOrderStatus(805, OrderStatus.READY, 99, Role.STAFF),
      ).rejects.toThrow(ConflictException);
    });

    it('COMPLETED lưu staffData qua CAS updateMany và trả về staffId/staffName từ findUnique', async () => {
      const now = new Date();
      prisma.order.findUnique.mockResolvedValue({
        id: 806,
        userId: 5,
        status: OrderStatus.READY,
        staffId: null,
        staffName: null,
        discountCode: null,
        voucherDeducted: false,
        items: [],
      });
      (prisma as any).user = {
        findUnique: vi.fn().mockResolvedValue({ id: 99, fullName: 'Barista Nam' }),
      };

      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 806,
            status: OrderStatus.COMPLETED,
            updatedAt: now,
            staffId: 99,
            staffName: 'Barista Nam',
          }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const result = await service.updateOrderStatus(
        806,
        OrderStatus.COMPLETED,
        99,
        Role.STAFF,
      );

      expect(mockTx.order.updateMany).toHaveBeenCalledWith({
        where: { id: 806, status: OrderStatus.READY },
        data: {
          status: OrderStatus.COMPLETED,
          staffId: 99,
          staffName: 'Barista Nam',
          version: { increment: 1 },
        },
      });
      expect(result.status).toBe(OrderStatus.COMPLETED);
      expect(result.staffId).toBe(99);
      expect(result.staffName).toBe('Barista Nam');
    });

    it('COMPLETED ném ConflictException nếu CAS updateMany count === 0 và không trừ nhầm legacy userVoucher', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 807,
        userId: 5,
        status: OrderStatus.READY,
        discountCode: 'OLD_VOUCHER',
        voucherDeducted: false,
        items: [],
      });
      const userVoucherFind = vi.fn();
      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        userVoucher: {
          findUnique: userVoucherFind,
        },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await expect(
        service.updateOrderStatus(807, OrderStatus.COMPLETED, 99, Role.STAFF),
      ).rejects.toThrow(ConflictException);
      expect(userVoucherFind).not.toHaveBeenCalled();
    });

    it('deleteOrder trên đơn PAYMENT_FAILED thực hiện CAS cancel, hoàn kho + voucher qua refundOrderResources rồi xóa đơn', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 808,
        userId: 5,
        status: OrderStatus.PAYMENT_FAILED,
        discountCode: 'PERSONAL10',
        voucherDeducted: true,
        items: [{ productId: 4, size: 'M', toppings: [], quantity: 1 }],
      });

      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          delete: vi.fn().mockResolvedValue({ id: 808 }),
        },
        payment: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
        orderItem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
        inventoryLog: {
          findMany: vi.fn().mockResolvedValue([
            { ingredientId: 1, ingredientName: 'Robusta', unit: 'g', changeAmount: -25 },
          ]),
          create: vi.fn().mockResolvedValue({}),
        },
        ingredient: {
          update: vi.fn().mockResolvedValue({ id: 1, name: 'Robusta', unit: 'g', stock: 125 }),
        },
        userVoucher: {
          findUnique: vi.fn().mockResolvedValue({ id: 12, quantity: 1 }),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const result = await service.deleteOrder(808, 5, Role.CUSTOMER);

      expect(result.success).toBe(true);
      expect(mockTx.order.updateMany).toHaveBeenCalledWith({
        where: {
          id: 808,
          status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED] },
        },
        data: {
          status: OrderStatus.CANCELLED,
          voucherDeducted: false,
          version: { increment: 1 },
        },
      });
      expect(mockTx.ingredient.update).toHaveBeenCalled();
      expect(mockTx.userVoucher.update).toHaveBeenCalledWith({
        where: { id: 12 },
        data: { quantity: { increment: 1 } },
      });
      expect(mockTx.inventoryLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          note: 'Hoàn kho do xóa đơn hàng chưa thanh toán #808',
        }),
      });
      expect(mockTx.payment.deleteMany).toHaveBeenCalledWith({ where: { orderId: 808 } });
      expect(mockTx.orderItem.deleteMany).toHaveBeenCalledWith({ where: { orderId: 808 } });
      expect(mockTx.order.delete).toHaveBeenCalledWith({ where: { id: 808 } });
    });

    it('deleteOrder ném ConflictException và không hoàn kho/xóa nếu CAS updateMany count === 0 trên đơn PENDING/PAYMENT_FAILED', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 809,
        userId: 5,
        status: OrderStatus.PENDING,
        items: [{ productId: 4, size: 'M', toppings: [], quantity: 1 }],
      });

      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          delete: vi.fn(),
        },
        payment: { deleteMany: vi.fn() },
        orderItem: { deleteMany: vi.fn() },
        ingredient: { update: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await expect(service.deleteOrder(809, 5, Role.CUSTOMER)).rejects.toThrow(
        ConflictException,
      );
      expect(mockTx.ingredient.update).not.toHaveBeenCalled();
      expect(mockTx.order.delete).not.toHaveBeenCalled();
    });

    it('deleteOrder trên đơn CANCELLED KHÔNG hoàn kho/voucher lần 2 và kiểm tra CAS order.deleteMany', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 810,
        userId: 5,
        status: OrderStatus.CANCELLED,
        discountCode: 'BREW10',
        voucherDeducted: false,
        items: [{ productId: 4, size: 'M', toppings: [], quantity: 1 }],
      });

      const mockTx = {
        order: {
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        payment: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
        orderItem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
        ingredient: { update: vi.fn() },
        discountCode: { updateMany: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const result = await service.deleteOrder(810, 5, Role.CUSTOMER);
      expect(result.success).toBe(true);
      expect(mockTx.ingredient.update).not.toHaveBeenCalled();
      expect(mockTx.discountCode.updateMany).not.toHaveBeenCalled();
      expect(mockTx.order.deleteMany).toHaveBeenCalledWith({
        where: { id: 810, status: OrderStatus.CANCELLED },
      });

      // Race condition khi 2 request cùng xóa đơn CANCELLED -> count: 0 -> ConflictException
      mockTx.order.deleteMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.deleteOrder(810, 5, Role.CUSTOMER)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('Fix Wave Track A — BE-C4, BE-I2, BE-I4, BE-I5, BE-M1/M2/M3', () => {
    it('[BE-C4] createOrder does not swallow tx.inventoryLog.create or tx.discountCode.update errors', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 1, name: 'Cà phê Muối', basePrice: 50000, sizeUpchargeM: 0, sizeUpchargeL: 0, isActive: true },
      ]);

      const mockTxFailLog = {
        recipe: {
          findMany: vi.fn().mockResolvedValue([
            { productId: 1, size: 'M', amount: 25, ingredient: { id: 1, code: 'ING_ROBUSTA', name: 'Robusta', unit: 'g' } },
          ]),
        },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        ingredient: {
          findUnique: vi.fn().mockResolvedValue({ id: 1, name: 'Robusta', unit: 'g', stock: 500, version: 1 }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        inventoryLog: {
          create: vi.fn().mockRejectedValue(new Error('DB write failed')),
        },
        order: {
          create: vi.fn().mockResolvedValue({ id: 901, status: OrderStatus.PENDING, totalAmount: 54000, items: [] }),
        },
      };
      prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mockTxFailLog));

      await expect(
        service.createOrder(
          { items: [{ productId: 1, size: 'M', toppings: [], quantity: 1 }] },
          1,
        ),
      ).rejects.toThrow('DB write failed');

      const mockTxFailDiscount = {
        discountCode: {
          findUnique: vi.fn().mockResolvedValue({
            id: 1,
            code: 'BREW10',
            discountPercent: 10,
            minOrderAmount: 0,
            maxDiscountAmount: 15000,
            isActive: true,
          }),
          update: vi.fn().mockRejectedValue(new Error('Discount update failed')),
        },
        userVoucher: { findUnique: vi.fn().mockResolvedValue(null) },
        order: { create: vi.fn() },
      };
      prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mockTxFailDiscount));

      await expect(
        service.createOrder(
          { items: [{ productId: 1, size: 'M', toppings: [], quantity: 1 }], discountCode: 'BREW10' },
          1,
        ),
      ).rejects.toThrow('Discount update failed');
    });

    it('[BE-C4] refundOrderResources does not swallow tx.inventoryLog.create error on cancellation', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 902,
        userId: 5,
        status: OrderStatus.PENDING,
        totalAmount: 50000,
        items: [{ productId: 1, size: 'M', toppings: [], quantity: 1 }],
      });

      const mockTx = {
        order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        inventoryLog: {
          findMany: vi.fn().mockResolvedValue([
            { ingredientId: 1, ingredientName: 'Robusta', unit: 'g', changeAmount: -25 },
          ]),
          create: vi.fn().mockRejectedValue(new Error('InventoryLog constraint error')),
        },
        ingredient: {
          update: vi.fn().mockResolvedValue({ id: 1, name: 'Robusta', unit: 'g', stock: 125 }),
        },
      };
      prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mockTx));

      await expect(
        service.updateOrderStatus(902, OrderStatus.CANCELLED, 5, Role.CUSTOMER),
      ).rejects.toThrow('InventoryLog constraint error');
    });

    it('[BE-C4] refundOrderResources uses atomic updateMany -> createMany(skipDuplicates) -> retry updateMany for UserVoucher when supported', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 903,
        userId: 8,
        status: OrderStatus.PENDING,
        totalAmount: 90000,
        discountCode: 'BREW10',
        voucherDeducted: true,
        items: [],
      });

      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({ id: 903, status: OrderStatus.CANCELLED, updatedAt: new Date() }),
        },
        userVoucher: {
          updateMany: vi.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 }),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
          findUnique: vi.fn(),
          create: vi.fn(),
        },
        discountCode: {
          findUnique: vi.fn().mockResolvedValue({
            code: 'BREW10',
            discountPercent: 10,
            minOrderAmount: 0,
            maxDiscountAmount: 15000,
          }),
        },
      };
      prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mockTx));

      await service.updateOrderStatus(903, OrderStatus.CANCELLED, 8, Role.CUSTOMER);

      expect(mockTx.userVoucher.updateMany).toHaveBeenCalledTimes(2);
      expect(mockTx.userVoucher.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 8,
            code: 'BREW10',
            quantity: 1,
            discountPercent: 10,
            minOrderAmount: 0,
            maxDiscountAmount: 15000,
          },
        ],
        skipDuplicates: true,
      });
      expect(mockTx.userVoucher.findUnique).not.toHaveBeenCalled();
      expect(mockTx.userVoucher.create).not.toHaveBeenCalled();
    });

    it('[BE-C4] refundOrderResources recovers from P2002 with SAVEPOINT when using legacy create + $executeRawUnsafe', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 904,
        userId: 8,
        status: OrderStatus.PENDING,
        totalAmount: 90000,
        discountCode: 'BREW10',
        voucherDeducted: true,
        items: [],
      });

      const p2002Err = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      const mockTx = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({ id: 904, status: OrderStatus.CANCELLED, updatedAt: new Date() }),
        },
        userVoucher: {
          findUnique: vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 44, userId: 8, code: 'BREW10', quantity: 1 }),
          create: vi.fn().mockRejectedValue(p2002Err),
          update: vi.fn().mockResolvedValue({ id: 44, quantity: 2 }),
        },
        discountCode: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };
      prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await service.updateOrderStatus(904, OrderStatus.CANCELLED, 8, Role.CUSTOMER);

      expect(res.status).toBe(OrderStatus.CANCELLED);
      expect(mockTx.$executeRawUnsafe).toHaveBeenCalledWith('SAVEPOINT sp_voucher');
      expect(mockTx.$executeRawUnsafe).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT sp_voucher');
      expect(mockTx.userVoucher.update).toHaveBeenCalledWith({
        where: { id: 44 },
        data: { quantity: { increment: 1 } },
      });
    });

    it('[BE-I5] BOM fallback when saleLogs is empty does NOT refund auxiliary packaging', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 905,
        userId: 5,
        status: OrderStatus.PENDING,
        totalAmount: 50000,
        discountCode: null,
        voucherDeducted: false,
        items: [{ productId: 1, size: 'M', toppings: [], quantity: 2 }],
      });

      const auxItems = [
        { id: 290, code: 'PKG_STRAW_BIO', name: 'Ống hút Bio', unit: 'ống', isRequiredForSale: false },
        { id: 292, code: 'PKG_BAG_T', name: 'Túi chữ T', unit: 'chiếc', isRequiredForSale: false },
        { id: 294, code: 'PKG_TISSUE', name: 'Khăn giấy', unit: 'tờ', isRequiredForSale: false },
      ];
      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({ id: 905, status: OrderStatus.CANCELLED, updatedAt: new Date() }),
        },
        inventoryLog: {
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockResolvedValue({}),
        },
        recipe: {
          findMany: vi.fn().mockResolvedValue([
            {
              productId: 1,
              size: 'M',
              amount: 25,
              ingredient: { id: 1, code: 'ING_ROBUSTA', name: 'Robusta', unit: 'g', isRequiredForSale: true },
            },
            {
              productId: 1,
              size: 'M',
              amount: 1,
              ingredient: { id: 284, code: 'PKG_CUP_M', name: 'Ly M', unit: 'chiếc', isRequiredForSale: true },
            },
          ]),
        },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        product: { findMany: vi.fn().mockResolvedValue([{ id: 1, category: 'vietnamese' }]) },
        ingredient: {
          findMany: vi.fn().mockResolvedValue(auxItems),
          update: vi.fn().mockImplementation(({ where }: { where: { id: number } }) =>
            Promise.resolve({ id: where.id, name: 'Item', unit: 'u', stock: 100 }),
          ),
        },
      };
      prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mockTx));

      await service.updateOrderStatus(905, OrderStatus.CANCELLED, 5, Role.CUSTOMER);

      expect(mockTx.ingredient.update).toHaveBeenCalledTimes(2);
      expect(mockTx.ingredient.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { stock: { increment: 50 }, version: { increment: 1 } },
      });
      expect(mockTx.ingredient.update).toHaveBeenCalledWith({
        where: { id: 284 },
        data: { stock: { increment: 2 }, version: { increment: 1 } },
      });
      expect(mockTx.ingredient.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 290 } }),
      );
      expect(mockTx.ingredient.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 292 } }),
      );
      expect(mockTx.ingredient.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 294 } }),
      );
    });

    it('[BE-I2] createOrder prioritizes personal UserVoucher over global DiscountCode when code matches both', async () => {
      prisma.product.findMany.mockResolvedValueOnce([
        { id: 1, name: 'Cà phê Muối', basePrice: 50000, sizeUpchargeM: 0, sizeUpchargeL: 0, isActive: true },
      ]);

      const mockTx = {
        userVoucher: {
          findUnique: vi.fn().mockResolvedValue({
            id: 77,
            userId: 1,
            code: 'BREW10',
            quantity: 1,
            discountPercent: 10,
            minOrderAmount: 0,
            maxDiscountAmount: 15000,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          delete: vi.fn().mockResolvedValue({}),
          update: vi.fn(),
        },
        discountCode: {
          findUnique: vi.fn().mockResolvedValue({
            id: 1,
            code: 'BREW10',
            discountPercent: 10,
            minOrderAmount: 0,
            maxDiscountAmount: 15000,
            isActive: true,
          }),
          update: vi.fn(),
        },
        order: {
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 906, status: OrderStatus.PENDING, items: [], ...data }),
          ),
        },
      };
      prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await service.createOrder(
        {
          items: [{ productId: 1, size: 'M', toppings: [], quantity: 2 }],
          discountCode: 'BREW10',
        },
        1,
      );

      expect(res.discountAmount).toBe(10000);
      expect(mockTx.userVoucher.updateMany).toHaveBeenCalledWith({
        where: { id: 77, quantity: { gte: 1 } },
        data: { quantity: { decrement: 1 } },
      });
      expect(mockTx.userVoucher.deleteMany).toHaveBeenCalledWith({
        where: { id: 77, quantity: { lte: 0 } },
      });
      expect(mockTx.discountCode.update).not.toHaveBeenCalled();
      expect(mockTx.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ voucherDeducted: true }),
        }),
      );
    });

    it('[BE-I2] updateOrderStatus PAID -> CANCELLED uses atomic user.updateMany CAS clawback and clamps at 0', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 907,
        userId: 5,
        status: OrderStatus.PAID,
        totalAmount: 84000, // 84 points
        items: [],
      });

      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({ id: 907, status: OrderStatus.CANCELLED, updatedAt: new Date() }),
        },
        user: {
          updateMany: vi.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 }),
          findUnique: vi.fn(),
          update: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mockTx));

      await service.updateOrderStatus(907, OrderStatus.CANCELLED, 99, Role.STAFF);

      expect(mockTx.user.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 5, loyaltyPoints: { gte: 84 } },
        data: { loyaltyPoints: { decrement: 84 } },
      });
      expect(mockTx.user.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: 5, loyaltyPoints: { gt: 0, lt: 84 } },
        data: { loyaltyPoints: 0 },
      });
      expect(mockTx.user.findUnique).not.toHaveBeenCalled();
      expect(mockTx.user.update).not.toHaveBeenCalled();
    });

    it('[BE-I2] updateOrderStatus READY -> COMPLETED does not deduct UserVoucher when voucherDeducted is false', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 908,
        userId: 5,
        status: OrderStatus.READY,
        discountCode: 'BREW10',
        voucherDeducted: false,
        items: [],
      });
      (prisma as any).user = {
        findUnique: vi.fn().mockResolvedValue({ id: 99, fullName: 'Barista' }),
      };

      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({ id: 908, status: OrderStatus.COMPLETED, updatedAt: new Date() }),
        },
        userVoucher: {
          findUnique: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await service.updateOrderStatus(908, OrderStatus.COMPLETED, 99, Role.STAFF);

      expect(res.status).toBe(OrderStatus.COMPLETED);
      expect(mockTx.userVoucher.findUnique).not.toHaveBeenCalled();
      expect(mockTx.userVoucher.update).not.toHaveBeenCalled();
      expect(mockTx.userVoucher.delete).not.toHaveBeenCalled();
    });

    it('[BE-M3] blocks STAFF and ADMIN from manually setting PAYMENT_FAILED via updateOrderStatus', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 909,
        userId: 5,
        status: OrderStatus.PENDING,
        items: [],
      });

      await expect(
        service.updateOrderStatus(909, OrderStatus.PAYMENT_FAILED, 99, Role.STAFF),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateOrderStatus(909, OrderStatus.PAYMENT_FAILED, 99, Role.ADMIN),
      ).rejects.toThrow(BadRequestException);
    });

    it('[BE-M1] getBaristaQueue bounds COMPLETED orders to 24h and strips email PII while keeping fullName/phone', async () => {
      prisma.order.findMany.mockResolvedValueOnce([]);
      (prisma as any).recipe = { findMany: vi.fn().mockResolvedValue([]) };
      (prisma as any).toppingRecipe = { findMany: vi.fn().mockResolvedValue([]) };

      await service.getBaristaQueue();

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              {
                status: {
                  in: [OrderStatus.PAID, OrderStatus.PREPARING, OrderStatus.READY],
                },
              },
              {
                status: OrderStatus.COMPLETED,
                updatedAt: { gte: expect.any(Date) },
              },
            ],
          },
          include: expect.objectContaining({
            user: {
              select: { id: true, fullName: true, phone: true },
            },
          }),
          take: 200,
        }),
      );
    });

    it('[BE-M2] getOrderById and getMyOrders scope expired-order sweep instead of global sweep', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.findUnique.mockResolvedValueOnce({
        id: 910,
        userId: 5,
        status: OrderStatus.PAID,
        items: [],
        payments: [],
      });

      await service.getOrderById(910, 5, Role.CUSTOMER);
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 910 }),
        }),
      );

      prisma.order.findMany.mockClear();
      prisma.order.findMany.mockResolvedValue([]);
      await service.getMyOrders(5);
      expect(prisma.order.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({ userId: 5 }),
        }),
      );
    });

    it('[BE-I4] CreateOrderDto validates productId >= 1, quantity <= 50, items <= 50, and accepts size ALL', async () => {
      const validBakeryDto = plainToInstance(CreateOrderDto, {
        items: [{ productId: 1, size: 'ALL', toppings: [], quantity: 1 }],
      });
      expect(await validate(validBakeryDto)).toHaveLength(0);

      const badProductId = plainToInstance(CreateOrderDto, {
        items: [{ productId: 0, size: 'M', toppings: [], quantity: 1 }],
      });
      expect((await validate(badProductId)).length).toBeGreaterThan(0);

      const badQty = plainToInstance(CreateOrderDto, {
        items: [{ productId: 1, size: 'M', toppings: [], quantity: 51 }],
      });
      expect((await validate(badQty)).length).toBeGreaterThan(0);

      const badSize = plainToInstance(CreateOrderDto, {
        items: [{ productId: 1, size: 'XL', toppings: [], quantity: 1 }],
      });
      expect((await validate(badSize)).length).toBeGreaterThan(0);

      const tooManyItems = plainToInstance(CreateOrderDto, {
        items: Array.from({ length: 51 }, () => ({
          productId: 1,
          size: 'M',
          toppings: [],
          quantity: 1,
        })),
      });
      expect((await validate(tooManyItems)).length).toBeGreaterThan(0);
    });
  });

  describe('Task 4 — Order Concurrency (User Row Lock, Atomic UserVoucher) & Beverage size ALL Rejection', () => {
    it('createOrder rejects beverage (category !== "bakery") with size "ALL" and permits bakery with "ALL" or "M"', async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Cà phê Muối',
          category: 'vietnamese',
          basePrice: 50000,
          sizeUpchargeM: 0,
          sizeUpchargeL: 8000,
          isActive: true,
        },
        {
          id: 8,
          name: 'Bánh Pain au Chocolat',
          category: 'bakery',
          basePrice: 39000,
          sizeUpchargeM: 0,
          sizeUpchargeL: 0,
          isActive: true,
        },
      ]);

      await expect(
        service.createOrder(
          { items: [{ productId: 1, size: 'ALL', toppings: [], quantity: 1 }] } as any,
          1,
        ),
      ).rejects.toThrow(BadRequestException);

      // Mixed payload: bakery 'ALL' + beverage 'ALL' must still reject
      await expect(
        service.createOrder(
          {
            items: [
              { productId: 8, size: 'ALL', toppings: [], quantity: 1 },
              { productId: 1, size: 'all', toppings: [], quantity: 1 },
            ],
          } as any,
          1,
        ),
      ).rejects.toThrow(BadRequestException);

      const mockTx = {
        recipe: { findMany: vi.fn().mockResolvedValue([]) },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        ingredient: { findMany: vi.fn().mockResolvedValue([]) },
        order: {
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 960, status: OrderStatus.PENDING, items: [], ...data }),
          ),
        },
      };
      prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mockTx));

      // Mixed payload: beverage 'L' + bakery 'ALL' succeeds (97000 * 1.08 = 104760 -> 104000)
      const mixedOk = await service.createOrder(
        {
          items: [
            { productId: 1, size: 'L', toppings: [], quantity: 1 },
            { productId: 8, size: 'ALL', toppings: [], quantity: 1 },
          ],
        } as any,
        1,
      );
      expect(mixedOk.totalAmount).toBe(104000);

      prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mockTx));
      // Bakery with size 'M' succeeds with 0 upcharge (39000 * 1.08 = 42120 -> 42000)
      const bakeryM = await service.createOrder(
        {
          items: [{ productId: 8, size: 'M', toppings: [], quantity: 1 }],
        } as any,
        1,
      );
      expect(bakeryM.totalAmount).toBe(42000);
    });

    it('computeRequiredIngredients does NOT classify a beverage as isBakery when size "ALL" is passed directly', async () => {
      const mockTx = {
        recipe: {
          findMany: vi.fn().mockResolvedValue([
            {
              productId: 1,
              size: 'ALL',
              amount: 25,
              ingredient: { id: 1, code: 'ING_ROBUSTA', name: 'Robusta', unit: 'g', isRequiredForSale: true },
            },
          ]),
        },
        toppingRecipe: { findMany: vi.fn().mockResolvedValue([]) },
        product: { findMany: vi.fn().mockResolvedValue([{ id: 1, category: 'vietnamese' }]) },
        ingredient: {
          findMany: vi.fn().mockResolvedValue([
            { id: 290, code: 'PKG_STRAW_BIO', name: 'Ống hút Bio', unit: 'ống', isRequiredForSale: false },
            { id: 292, code: 'PKG_BAG_T', name: 'Túi chữ T', unit: 'chiếc', isRequiredForSale: false },
            { id: 294, code: 'PKG_TISSUE', name: 'Khăn giấy', unit: 'tờ', isRequiredForSale: false },
            { id: 295, code: 'PKG_SPOON', name: 'Muỗng', unit: 'cái', isRequiredForSale: false },
          ]),
        },
      };

      const reqs = await computeRequiredIngredients(mockTx, [
        { productId: 1, size: 'ALL', toppings: [], quantity: 1 },
      ]);
      const codes = reqs.map((r) => r.code);

      expect(codes).toContain('PKG_STRAW_BIO');
      expect(codes).toContain('PKG_BAG_T');
      expect(codes).toContain('PKG_TISSUE');
      expect(codes).not.toContain('PKG_SPOON');
    });

    it('createOrder acquires per-user FOR UPDATE lock via $queryRaw before checking tx.order.count >= 5 inside $transaction', async () => {
      const callOrder: string[] = [];
      const mockTx = {
        $queryRaw: vi.fn().mockImplementation(async () => {
          callOrder.push('queryRaw');
          return [{ id: 1 }];
        }),
        order: {
          count: vi.fn().mockImplementation(async () => {
            callOrder.push('txOrderCount');
            return 5;
          }),
          create: vi.fn(),
        },
      };

      // Pre-tx prisma.order.count should not block if inside-tx check is authoritative
      prisma.order.count.mockResolvedValue(0);
      prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mockTx));

      await expect(
        service.createOrder(
          { items: [{ productId: 1, size: 'M', toppings: [], quantity: 1 }] } as any,
          1,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(mockTx.order.count).toHaveBeenCalledWith({
        where: {
          userId: 1,
          status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED] },
        },
      });
      expect(callOrder).toEqual(['queryRaw', 'txOrderCount']);
      expect(mockTx.order.create).not.toHaveBeenCalled();
    });

    it('createOrder uses atomic UserVoucher updateMany + deleteMany and throws BadRequestException when concurrent depletion returns count: 0', async () => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 1 }]),
        userVoucher: {
          findUnique: vi.fn().mockResolvedValue({
            id: 88,
            userId: 1,
            code: 'PERSONAL10',
            quantity: 1,
            discountPercent: 10,
            minOrderAmount: 0,
            maxDiscountAmount: 15000,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        order: {
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mockTx));

      await expect(
        service.createOrder(
          {
            items: [{ productId: 1, size: 'M', toppings: [], quantity: 1 }],
            discountCode: 'PERSONAL10',
          } as any,
          1,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockTx.userVoucher.updateMany).toHaveBeenCalledWith({
        where: { id: 88, quantity: { gte: 1 } },
        data: { quantity: { decrement: 1 } },
      });
      expect(mockTx.userVoucher.deleteMany).not.toHaveBeenCalled();
      expect(mockTx.order.create).not.toHaveBeenCalled();
    });

    it('createOrder filters pendingWithVoucher with voucherDeducted: false so already-deducted pending orders do not double-count remaining UserVoucher.quantity', async () => {
      const orderCountMock = vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.discountCode === 'PERSONAL10') {
          return where.voucherDeducted === false ? 0 : 1;
        }
        return 1;
      });
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 1 }]),
        userVoucher: {
          findUnique: vi.fn().mockResolvedValue({
            id: 89,
            userId: 1,
            code: 'PERSONAL10',
            quantity: 1,
            discountPercent: 10,
            minOrderAmount: 0,
            maxDiscountAmount: 15000,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        order: {
          count: orderCountMock,
          create: vi.fn().mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 991, status: OrderStatus.PENDING, items: [], ...data }),
          ),
        },
      };
      prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await service.createOrder(
        {
          items: [{ productId: 1, size: 'M', toppings: [], quantity: 1 }],
          discountCode: 'PERSONAL10',
        } as any,
        1,
      );

      expect(res.orderId).toBe(991);
      expect(orderCountMock).toHaveBeenNthCalledWith(2, {
        where: {
          userId: 1,
          discountCode: 'PERSONAL10',
          status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED] },
          voucherDeducted: false,
        },
      });
      expect(mockTx.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ voucherDeducted: true }),
        }),
      );
    });
  });
});
