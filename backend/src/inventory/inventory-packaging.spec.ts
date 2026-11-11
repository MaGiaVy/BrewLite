import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InventoryService } from './inventory.service.js';

describe('InventoryService — Packaging & Consumables Management (Task 4)', () => {
  let service: InventoryService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      ingredient: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
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
      },
      toppingRecipe: {
        findMany: vi.fn(),
      },
      inventoryLog: {
        create: vi.fn(),
      },
      storeSetting: {
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
      discountCode: {
        findMany: vi.fn(),
      },
    };

    service = new InventoryService(mockPrisma);
  });

  it('Test 1: Tạo nguyên vật liệu loại PACKAGING với isRequiredForSale = false (Bịch mang đi)', async () => {
    mockPrisma.ingredient.findUnique.mockResolvedValue(null);
    mockPrisma.ingredient.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 101,
        ...data,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const dto = {
      code: 'PKG_BAG_TAKEOUT',
      name: 'Bịch mang đi chữ T',
      unit: 'cái',
      stock: 500,
      minThreshold: 50,
      costPerUnit: 150,
      type: 'PACKAGING',
      isRequiredForSale: false,
    };

    const result = await service.createIngredient(dto);

    expect(mockPrisma.ingredient.findUnique).toHaveBeenCalledWith({
      where: { code: 'PKG_BAG_TAKEOUT' },
    });
    expect(mockPrisma.ingredient.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: 'PKG_BAG_TAKEOUT',
        name: 'Bịch mang đi chữ T',
        unit: 'cái',
        stock: 500,
        minThreshold: 50,
        costPerUnit: 150,
        type: 'PACKAGING',
        isRequiredForSale: false,
      }),
    });

    expect(result.code).toBe('PKG_BAG_TAKEOUT');
    expect(result.type).toBe('PACKAGING');
    expect(result.isRequiredForSale).toBe(false);
    expect(result.status).toBe('OK');
  });

  it('Test 2: Tạo nguyên vật liệu loại PACKAGING với isRequiredForSale = true (Ly giấy Size M)', async () => {
    mockPrisma.ingredient.findUnique.mockResolvedValue(null);
    mockPrisma.ingredient.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 102,
        ...data,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const dto = {
      code: 'PKG_CUP_PAPER_M',
      name: 'Ly giấy Kraft Size M 500ml',
      unit: 'cái',
      stock: 1200,
      minThreshold: 200,
      costPerUnit: 850,
      type: 'PACKAGING',
      isRequiredForSale: true,
    };

    const result = await service.createIngredient(dto);

    expect(mockPrisma.ingredient.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: 'PKG_CUP_PAPER_M',
        name: 'Ly giấy Kraft Size M 500ml',
        unit: 'cái',
        stock: 1200,
        minThreshold: 200,
        costPerUnit: 850,
        type: 'PACKAGING',
        isRequiredForSale: true,
      }),
    });

    expect(result.code).toBe('PKG_CUP_PAPER_M');
    expect(result.type).toBe('PACKAGING');
    expect(result.isRequiredForSale).toBe(true);
    expect(result.status).toBe('OK');
  });

  it('Test 3: Xác minh rằng khi vật tư isRequiredForSale = false có stock = 0, món vẫn khả dụng để bán', () => {
    // Sản phẩm: Cà phê Sữa Đá (Size S hoặc ALL)
    // - Cà phê Robusta: tồn 1000g, cần 20g -> 50 phần
    // - Sữa đặc: tồn 800g, cần 40g -> 20 phần
    // - Ly nhựa PET: tồn 100 cái, cần 1 cái, isRequiredForSale = true -> 100 phần
    // - Bịch mang đi (Phụ trợ): tồn 0 cái, cần 1 cái, isRequiredForSale = false
    // - Ống hút giấy (Phụ trợ): tồn 0 cái, cần 1 cái, isRequiredForSale = false
    const mockProduct = {
      id: 1,
      name: 'Cà phê Sữa Đá',
      basePrice: 29000,
      isSoldOutManual: false,
      recipes: [
        {
          id: 1,
          productId: 1,
          size: 'ALL',
          amount: 20,
          ingredient: {
            id: 1,
            code: 'ING_ROBUSTA',
            name: 'Cà phê Robusta',
            stock: 1000,
            unit: 'g',
            type: 'INGREDIENT',
            isRequiredForSale: true,
          },
        },
        {
          id: 2,
          productId: 1,
          size: 'ALL',
          amount: 40,
          ingredient: {
            id: 2,
            code: 'ING_CONDENSED_MILK',
            name: 'Sữa đặc Ngôi sao',
            stock: 800,
            unit: 'g',
            type: 'INGREDIENT',
            isRequiredForSale: true,
          },
        },
        {
          id: 3,
          productId: 1,
          size: 'ALL',
          amount: 1,
          ingredient: {
            id: 3,
            code: 'PKG_CUP_PET',
            name: 'Ly nhựa PET',
            stock: 100,
            unit: 'cái',
            type: 'PACKAGING',
            isRequiredForSale: true,
          },
        },
        {
          id: 4,
          productId: 1,
          size: 'ALL',
          amount: 1,
          ingredient: {
            id: 4,
            code: 'PKG_BAG_TAKEOUT',
            name: 'Bịch mang đi chữ T',
            stock: 0, // HẾT HÀNG NHƯNG LÀ VẬT TƯ PHỤ TRỢ (isRequiredForSale = false)
            unit: 'cái',
            type: 'PACKAGING',
            isRequiredForSale: false,
          },
        },
        {
          id: 5,
          productId: 1,
          size: 'ALL',
          amount: 1,
          ingredient: {
            id: 5,
            code: 'PKG_STRAW_PAPER',
            name: 'Ống hút giấy',
            stock: 0, // HẾT HÀNG NHƯNG LÀ VẬT TƯ PHỤ TRỢ (isRequiredForSale = false)
            unit: 'cái',
            type: 'PACKAGING',
            isRequiredForSale: false,
          },
        },
      ],
    };

    const status = service.calculateServings(mockProduct);

    // Món vẫn khả dụng (không bị khóa), số phần bán được tính dựa trên nguyên vật liệu & bao bì cốt lõi (min(1000/20, 800/40, 100/1) = 20)
    expect(status.isOutOfStock).toBe(false);
    expect(status.ingredientOutOfStock).toBe(false);
    expect(status.availableServings).toBe(20);
  });

  it('Test 4: Xác minh rằng khi vật tư isRequiredForSale = true có stock = 0, món bị đánh dấu hết hàng', () => {
    // Sản phẩm: Cà phê Đen Đá
    // - Cà phê Robusta: tồn 1000g, cần 20g
    // - Ly giấy Kraft (Cốt lõi - isRequiredForSale = true): tồn 0 cái, cần 1 cái
    // - Nắp bằng (Cốt lõi - isRequiredForSale = true): tồn 50 cái, cần 1 cái
    // - Ống hút giấy (Phụ trợ - isRequiredForSale = false): tồn 100 cái, cần 1 cái
    const mockProduct = {
      id: 2,
      name: 'Cà phê Đen Đá',
      basePrice: 25000,
      isSoldOutManual: false,
      recipes: [
        {
          id: 11,
          productId: 2,
          size: 'ALL',
          amount: 20,
          ingredient: {
            id: 1,
            code: 'ING_ROBUSTA',
            name: 'Cà phê Robusta',
            stock: 1000,
            unit: 'g',
            type: 'INGREDIENT',
            isRequiredForSale: true,
          },
        },
        {
          id: 12,
          productId: 2,
          size: 'ALL',
          amount: 1,
          ingredient: {
            id: 102,
            code: 'PKG_CUP_PAPER_M',
            name: 'Ly giấy Kraft Size M',
            stock: 0, // HẾT HÀNG VẬT TƯ CỐT LÕI (isRequiredForSale = true)
            unit: 'cái',
            type: 'PACKAGING',
            isRequiredForSale: true,
          },
        },
        {
          id: 13,
          productId: 2,
          size: 'ALL',
          amount: 1,
          ingredient: {
            id: 103,
            code: 'PKG_LID_FLAT',
            name: 'Nắp bằng phi 90',
            stock: 50,
            unit: 'cái',
            type: 'PACKAGING',
            isRequiredForSale: true,
          },
        },
        {
          id: 14,
          productId: 2,
          size: 'ALL',
          amount: 1,
          ingredient: {
            id: 5,
            code: 'PKG_STRAW_PAPER',
            name: 'Ống hút giấy',
            stock: 100,
            unit: 'cái',
            type: 'PACKAGING',
            isRequiredForSale: false,
          },
        },
      ],
    };

    const status = service.calculateServings(mockProduct);

    // Món bị khóa hết hàng ngay lập tức do Ly giấy Kraft (isRequiredForSale = true) có tồn kho = 0
    expect(status.isOutOfStock).toBe(true);
    expect(status.ingredientOutOfStock).toBe(true);
    expect(status.availableServings).toBe(0);
  });

  it('Test 5: Cập nhật phân loại vật tư và cờ isRequiredForSale qua updateIngredient', async () => {
    mockPrisma.ingredient.findUnique.mockResolvedValue({
      id: 50,
      code: 'PKG_SPOON',
      name: 'Muỗng nhựa',
      unit: 'cái',
      stock: 200,
      minThreshold: 30,
      costPerUnit: 100,
      type: 'INGREDIENT',
      isRequiredForSale: true,
      version: 1,
    });

    mockPrisma.ingredient.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.ingredient.findUnique
      .mockResolvedValueOnce({
        id: 50,
        code: 'PKG_SPOON',
        name: 'Muỗng nhựa',
        unit: 'cái',
        stock: 200,
        minThreshold: 30,
        costPerUnit: 100,
        type: 'INGREDIENT',
        isRequiredForSale: true,
        version: 1,
      })
      .mockResolvedValueOnce({
        id: 50,
        code: 'PKG_SPOON',
        name: 'Muỗng nhựa trong suốt',
        unit: 'cái',
        stock: 200,
        minThreshold: 30,
        costPerUnit: 100,
        type: 'PACKAGING',
        isRequiredForSale: false,
        version: 2,
      });

    const result = await service.updateIngredient(50, {
      name: 'Muỗng nhựa trong suốt',
      type: 'PACKAGING',
      isRequiredForSale: false,
    });

    expect(mockPrisma.ingredient.updateMany).toHaveBeenCalledWith({
      where: { id: 50, version: 1 },
      data: expect.objectContaining({
        name: 'Muỗng nhựa trong suốt',
        type: 'PACKAGING',
        isRequiredForSale: false,
        version: { increment: 1 },
      }),
    });

    expect(result.type).toBe('PACKAGING');
    expect(result.isRequiredForSale).toBe(false);
  });
});
