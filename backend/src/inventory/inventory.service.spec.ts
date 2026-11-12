import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpsertRecipeDto, UpdateRecipeDto } from './dto/inventory.dto.js';
import { InventoryService } from './inventory.service.js';

describe('InventoryService — Sprint 4 (Admin BOM Warehouse, Full CRUD & Optimistic Locking)', () => {
  let service: InventoryService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      ingredient: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      },
      product: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      recipe: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      },
      toppingRecipe: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      },
      inventoryLog: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      storeSetting: {
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
      discountCode: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      },
      order: {
        findMany: vi.fn(),
      },
    };
    service = new InventoryService(mockPrisma);
  });

  it('phân loại đúng trạng thái tồn kho: OK, LOW_STOCK, và OUT_OF_STOCK', async () => {
    mockPrisma.ingredient.findMany.mockResolvedValue([
      {
        id: 1,
        code: 'ING_ROBUSTA',
        name: 'Hạt Cà phê Robusta',
        unit: 'g',
        stock: 4000,
        minThreshold: 500,
        version: 0,
      },
      {
        id: 2,
        code: 'ING_MATCHA',
        name: 'Bột Matcha Uji',
        unit: 'g',
        stock: 120,
        minThreshold: 150,
        version: 1,
      },
      {
        id: 3,
        code: 'ING_PEACH',
        name: 'Đào miếng ngâm',
        unit: 'lát',
        stock: 0,
        minThreshold: 30,
        version: 2,
      },
    ]);

    const result = await service.getAllIngredients();

    expect(result[0].status).toBe('OK');
    expect(result[1].status).toBe('LOW_STOCK');
    expect(result[2].status).toBe('OUT_OF_STOCK');
  });

  it('nhập thêm kho (restockIngredient) sử dụng Optimistic Locking tăng version', async () => {
    mockPrisma.ingredient.findUnique
      .mockResolvedValueOnce({
        id: 1,
        code: 'ING_ROBUSTA',
        name: 'Hạt Cà phê Robusta',
        unit: 'g',
        stock: 500,
        minThreshold: 500,
        version: 2,
      })
      .mockResolvedValueOnce({
        id: 1,
        code: 'ING_ROBUSTA',
        name: 'Hạt Cà phê Robusta',
        unit: 'g',
        stock: 2500,
        minThreshold: 500,
        version: 3,
      });

    mockPrisma.ingredient.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.restockIngredient(1, { addAmount: 2000 });

    expect(mockPrisma.ingredient.updateMany).toHaveBeenCalledWith({
      where: { id: 1, version: 2 },
      data: {
        stock: { increment: 2000 },
        version: { increment: 1 },
      },
    });
    expect(res.stock).toBe(2500);
    expect(res.status).toBe('OK');
  });

  it('ném ConflictException khi nhập kho bị xung đột version (Optimistic Lock)', async () => {
    mockPrisma.ingredient.findUnique.mockResolvedValue({
      id: 1,
      code: 'ING_ROBUSTA',
      name: 'Hạt Cà phê Robusta',
      unit: 'g',
      stock: 500,
      minThreshold: 500,
      version: 2,
    });
    mockPrisma.ingredient.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.restockIngredient(1, { addAmount: 1000 }),
    ).rejects.toThrow(ConflictException);
  });

  it('ném NotFoundException nếu nguyên vật liệu không tồn tại', async () => {
    mockPrisma.ingredient.findUnique.mockResolvedValue(null);

    await expect(
      service.restockIngredient(999, { addAmount: 500 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('cập nhật nguyên vật liệu (updateIngredient) sử dụng CAS Guard tăng version', async () => {
    mockPrisma.ingredient.findUnique
      .mockResolvedValueOnce({
        id: 1,
        code: 'ING_ROBUSTA',
        name: 'Hạt Cà phê Robusta',
        unit: 'g',
        stock: 500,
        minThreshold: 500,
        costPerUnit: 100,
        type: 'INGREDIENT',
        isRequiredForSale: true,
        version: 2,
      })
      .mockResolvedValueOnce({
        id: 1,
        code: 'ING_ROBUSTA_SPECIAL',
        name: 'Hạt Cà phê Robusta Đặc Biệt',
        unit: 'g',
        stock: 800,
        minThreshold: 500,
        costPerUnit: 120,
        type: 'INGREDIENT',
        isRequiredForSale: true,
        version: 3,
      });

    mockPrisma.ingredient.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.updateIngredient(1, {
      name: 'Hạt Cà phê Robusta Đặc Biệt',
      stock: 800,
      costPerUnit: 120,
    });

    expect(mockPrisma.ingredient.updateMany).toHaveBeenCalledWith({
      where: { id: 1, version: 2 },
      data: expect.objectContaining({
        name: 'Hạt Cà phê Robusta Đặc Biệt',
        stock: 800,
        costPerUnit: 120,
        version: { increment: 1 },
      }),
    });
    expect(res.stock).toBe(800);
    expect(res.version).toBe(3);
  });

  it('ném ConflictException khi updateIngredient bị xung đột version (Optimistic Lock Conflict - CRITICAL-08)', async () => {
    mockPrisma.ingredient.findUnique.mockResolvedValue({
      id: 1,
      code: 'ING_ROBUSTA',
      name: 'Hạt Cà phê Robusta',
      unit: 'g',
      stock: 500,
      minThreshold: 500,
      version: 2,
    });
    mockPrisma.ingredient.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.updateIngredient(1, { stock: 1000 }),
    ).rejects.toThrow(ConflictException);

    await expect(
      service.updateIngredient(1, { stock: 1000 }),
    ).rejects.toThrow(
      'Xung đột cập nhật tồn kho (Optimistic Lock Conflict). Dữ liệu vừa bị thay đổi bởi tiến trình khác, vui lòng tải lại.',
    );
  });

  it('cho phép Admin thêm nguyên vật liệu mới (createIngredient) và chặn trùng mã code', async () => {
    mockPrisma.ingredient.findUnique.mockResolvedValueOnce(null);
    mockPrisma.ingredient.create.mockResolvedValue({
      id: 16,
      code: 'ING_OAT_MILK',
      name: 'Sữa Yến Mạch Oatside',
      unit: 'ml',
      stock: 5000,
      minThreshold: 500,
      version: 0,
    });

    const created = await service.createIngredient({
      code: 'ing oat milk',
      name: 'Sữa Yến Mạch Oatside',
      unit: 'ml',
      stock: 5000,
      minThreshold: 500,
    });

    expect(created.code).toBe('ING_OAT_MILK');
    expect(created.status).toBe('OK');

    mockPrisma.ingredient.findUnique.mockResolvedValueOnce({ id: 16 });
    await expect(
      service.createIngredient({
        code: 'ING_OAT_MILK',
        name: 'Trùng mã',
        unit: 'ml',
        stock: 100,
        minThreshold: 50,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('cho phép Admin thêm/cập nhật công thức BOM (upsertRecipe) và xóa dòng công thức (deleteRecipe)', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ id: 1, name: 'Cà phê Đen' });
    mockPrisma.ingredient.findUnique.mockResolvedValue({ id: 1, name: 'Robusta' });
    mockPrisma.recipe.upsert.mockResolvedValue({
      id: 50,
      productId: 1,
      ingredientId: 1,
      size: 'M',
      amount: 28,
      ingredient: { id: 1, name: 'Robusta', unit: 'g' },
    });

    const upserted = await service.upsertRecipe({
      productId: 1,
      ingredientId: 1,
      size: 'm',
      amount: 28,
    });

    expect(upserted.size).toBe('M');
    expect(upserted.amount).toBe(28);

    mockPrisma.recipe.findUnique.mockResolvedValue({ id: 50 });
    mockPrisma.recipe.delete.mockResolvedValue({});
    const del = await service.deleteRecipe(50);
    expect(del.deleted).toBe(true);
  });

  it('cho phép Admin cấu hình giá phụ thu Size (updateGlobalSizePricing) và lấy cấu hình đồng bộ (getPublicPricingConfig)', async () => {
    mockPrisma.storeSetting.upsert.mockResolvedValue({});
    mockPrisma.storeSetting.findMany.mockResolvedValue([
      { key: 'SIZE_UPCHARGE_S', value: '0' },
      { key: 'SIZE_UPCHARGE_M', value: '6000' },
      { key: 'SIZE_UPCHARGE_L', value: '12000' },
    ]);
    const sizeRes = await service.updateGlobalSizePricing({
      sizeS: 0,
      sizeM: 6000,
      sizeL: 12000,
    });
    expect(sizeRes).toEqual({ sizeS: 0, sizeM: 6000, sizeL: 12000 });
    expect(mockPrisma.storeSetting.upsert).toHaveBeenCalledTimes(3);
  });

  it('cho phép Admin quản lý Topping (thêm, sửa giá bán, ẩn/hiện, xóa) và quản lý Voucher giảm giá', async () => {
    mockPrisma.ingredient.findUnique.mockResolvedValue({
      id: 1,
      name: 'Kem muối',
      unit: 'ml',
    });
    mockPrisma.toppingRecipe.upsert.mockResolvedValue({
      id: 9,
      toppingId: 'cream',
      toppingName: 'Kem Muối Biển',
      subtext: 'Béo mặn dịu nhẹ',
      price: 12000,
      isActive: true,
      ingredientId: 1,
      amount: 35,
      ingredient: { id: 1, name: 'Kem muối', unit: 'ml' },
    });

    const top = await service.createToppingRecipe({
      toppingId: 'cream',
      toppingName: 'Kem Muối Biển',
      subtext: 'Béo mặn dịu nhẹ',
      price: 12000,
      amount: 35,
      ingredientId: 1,
      isActive: true,
    });
    expect(top.price).toBe(12000);
    expect(top.toppingId).toBe('cream');

    mockPrisma.discountCode.findUnique.mockResolvedValueOnce(null);
    mockPrisma.discountCode.create.mockResolvedValue({
      id: 1,
      code: 'SUMMER20',
      description: 'Giảm 20% mùa hè',
      discountPercent: 20,
      minOrderAmount: 50000,
      isActive: true,
      usageCount: 0,
    });

    const voucher = await service.createVoucher({
      code: 'summer20',
      description: 'Giảm 20% mùa hè',
      discountPercent: 20,
      minOrderAmount: 50000,
    });
    expect(voucher.code).toBe('SUMMER20');
    expect(voucher.discountPercent).toBe(20);
  });

  describe('Task 6 — Chống Cascade Delete nguyên liệu & Validation DTO Size', () => {
    it('chặn xóa nguyên liệu khi đang được sử dụng trong công thức Recipe (chống Cascade Delete)', async () => {
      mockPrisma.ingredient.findUnique.mockResolvedValue({
        id: 1,
        code: 'ING_ROBUSTA',
        name: 'Hạt Cà phê Robusta',
      });
      mockPrisma.recipe.count.mockResolvedValue(3);

      await expect(service.deleteIngredient(1)).rejects.toThrow(ConflictException);
      await expect(service.deleteIngredient(1)).rejects.toThrow(
        'Không thể xóa nguyên liệu vì đang được sử dụng trong công thức món. Vui lòng gỡ khỏi công thức trước.',
      );
      expect(mockPrisma.ingredient.delete).not.toHaveBeenCalled();
    });

    it('chặn xóa nguyên liệu khi đang được sử dụng trong ToppingRecipe (chống Cascade Delete)', async () => {
      mockPrisma.ingredient.findUnique.mockResolvedValue({
        id: 2,
        code: 'ING_BOBA',
        name: 'Trân châu đen',
      });
      mockPrisma.recipe.count.mockResolvedValue(0);
      mockPrisma.toppingRecipe.count.mockResolvedValue(1);

      await expect(service.deleteIngredient(2)).rejects.toThrow(ConflictException);
      await expect(service.deleteIngredient(2)).rejects.toThrow(
        'Không thể xóa nguyên liệu vì đang được sử dụng trong công thức món. Vui lòng gỡ khỏi công thức trước.',
      );
      expect(mockPrisma.ingredient.delete).not.toHaveBeenCalled();
    });

    it('chặn xóa nguyên liệu khi đã phát sinh InventoryLog (inventoryLog.count > 0)', async () => {
      mockPrisma.ingredient.findUnique.mockResolvedValue({
        id: 10,
        code: 'ING_LOGGED',
        name: 'Sữa tươi đã nhập kho',
      });
      mockPrisma.recipe.count.mockResolvedValue(0);
      mockPrisma.toppingRecipe.count.mockResolvedValue(0);
      mockPrisma.inventoryLog.count.mockResolvedValue(3);

      await expect(service.deleteIngredient(10)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.deleteIngredient(10)).rejects.toThrow(
        'Không thể xóa nguyên liệu vì đã phát sinh nhật ký nhập/xuất kho.',
      );
      expect(mockPrisma.ingredient.delete).not.toHaveBeenCalled();
    });

    it('cho phép xóa nguyên liệu thành công khi không còn liên kết với công thức món nào', async () => {
      mockPrisma.ingredient.findUnique.mockResolvedValue({
        id: 99,
        code: 'ING_UNUSED',
        name: 'Nguyên liệu không dùng',
      });
      mockPrisma.recipe.count.mockResolvedValue(0);
      mockPrisma.toppingRecipe.count.mockResolvedValue(0);
      mockPrisma.ingredient.delete.mockResolvedValue({ id: 99 });

      const res = await service.deleteIngredient(99);

      expect(res.deleted).toBe(true);
      expect(res.id).toBe(99);
      expect(mockPrisma.ingredient.delete).toHaveBeenCalledWith({ where: { id: 99 } });
    });

    it('ném NotFoundException khi xóa nguyên liệu không tồn tại', async () => {
      mockPrisma.ingredient.findUnique.mockResolvedValue(null);
      await expect(service.deleteIngredient(404)).rejects.toThrow(NotFoundException);
    });

    it('UpsertRecipeDto từ chối size không hợp lệ và chấp nhận size S, M, L, ALL', async () => {
      const invalidDto = plainToInstance(UpsertRecipeDto, {
        productId: 1,
        ingredientId: 1,
        size: 'XL',
        amount: 20,
      });
      const errors = await validate(invalidDto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints?.isIn).toBe(
        'Size công thức chỉ được là S, M, L hoặc ALL',
      );

      for (const validSize of ['S', 'M', 'L', 'ALL']) {
        const validDto = plainToInstance(UpsertRecipeDto, {
          productId: 1,
          ingredientId: 1,
          size: validSize,
          amount: 20,
        });
        const validErrors = await validate(validDto);
        expect(validErrors.length).toBe(0);
      }
    });

    it('UpdateRecipeDto kiểm tra size hợp lệ', async () => {
      const invalidUpdate = plainToInstance(UpdateRecipeDto, {
        size: 'INVALID_SIZE',
        amount: 15,
      });
      const errors = await validate(invalidUpdate);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints?.isIn).toBe(
        'Size công thức chỉ được là S, M, L hoặc ALL',
      );

      const validUpdate = plainToInstance(UpdateRecipeDto, {
        size: 'M',
        amount: 15,
      });
      const validErrors = await validate(validUpdate);
      expect(validErrors.length).toBe(0);
    });
  });

  describe('FE-I4 — getDashboardStats expires stale >5m PENDING/PAYMENT_FAILED orders', () => {
    it('cancels stale >5m PENDING orders via $transaction before reading recentOrders', async () => {
      const staleOrder = {
        id: 501,
        status: 'PENDING',
        discountCode: null,
        voucherDeducted: false,
        createdAt: new Date(Date.now() - 6 * 60 * 1000),
        items: [{ productId: 1, size: 'M', toppings: [], quantity: 1 }],
      };

      const mockTx = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        inventoryLog: {
          findMany: vi.fn().mockResolvedValue([
            {
              ingredientId: 1,
              ingredientName: 'Robusta',
              unit: 'g',
              changeAmount: -25,
            },
          ]),
          create: vi.fn().mockResolvedValue({}),
        },
        ingredient: {
          update: vi.fn().mockResolvedValue({
            id: 1,
            name: 'Robusta',
            unit: 'g',
            stock: 1025,
          }),
        },
      };

      mockPrisma.$transaction = vi.fn(async (cb: any) => cb(mockTx));
      mockPrisma.order.findMany
        .mockResolvedValueOnce([staleOrder])
        .mockResolvedValueOnce([
          {
            id: 501,
            status: 'CANCELLED',
            totalAmount: 45000,
            createdAt: staleOrder.createdAt,
            items: [],
            user: null,
          },
        ]);
      mockPrisma.ingredient.findMany.mockResolvedValue([]);
      mockPrisma.storeSetting.findMany.mockResolvedValue([]);
      mockPrisma.discountCode.findMany.mockResolvedValue([]);
      mockPrisma.inventoryLog.findMany.mockResolvedValue([]);
      mockPrisma.recipe.findMany = vi.fn().mockResolvedValue([]);

      const stats = await service.getDashboardStats();

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 501, status: 'PENDING' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
      expect(mockTx.ingredient.update).toHaveBeenCalled();
      expect(stats.recentOrders[0].status).toBe('CANCELLED');
    });

    it('returns full 7-day chartOrders (>50) and full stats while capping recentOrders at 50', async () => {
      const now = Date.now();
      const orders = Array.from({ length: 65 }, (_, idx) => ({
        id: idx + 1,
        status: idx % 2 === 0 ? 'COMPLETED' : 'PAID',
        totalAmount: 50000,
        createdAt: new Date(now - idx * 60 * 60 * 1000),
        items: [
          {
            productId: 1,
            productName: 'Cà phê Sữa Đá',
            size: 'M',
            quantity: 1,
            unitPrice: 50000,
          },
        ],
        user: null,
      }));
      orders.push({
        id: 999,
        status: 'CANCELLED',
        totalAmount: 50000,
        createdAt: new Date(now),
        items: [],
        user: null,
      });

      mockPrisma.order.findMany.mockResolvedValueOnce(orders);
      mockPrisma.ingredient.findMany.mockResolvedValue([]);
      mockPrisma.storeSetting.findMany.mockResolvedValue([]);
      mockPrisma.discountCode.findMany.mockResolvedValue([]);
      mockPrisma.inventoryLog.findMany.mockResolvedValue([]);
      mockPrisma.recipe.findMany = vi.fn().mockResolvedValue([
        {
          productId: 1,
          size: 'M',
          amount: 10,
          ingredient: { costPerUnit: 1000 },
        },
      ]);

      const stats = await service.getDashboardStats();

      expect(mockPrisma.order.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { createdAt: { gte: expect.any(Date) } },
          take: 1000,
        }),
      );
      expect(stats.recentOrders).toHaveLength(50);
      expect((stats as any).chartOrders).toHaveLength(65);
      expect(stats.totalRevenue).toBe(65 * 50000);
      expect(stats.totalCogsSold).toBe(65 * 10000);
      expect(stats.topSellingProducts[0].totalQuantity).toBe(65);
    });
  });
});
