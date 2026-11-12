import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('ProductsService — Admin Menu CRUD & Visibility Management', () => {
  let service: ProductsService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      product: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      orderItem: {
        findMany: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('chỉ lấy sản phẩm đang hiển thị (isActive: true) khi gọi findAll() mặc định cho khách hàng', async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: 1,
        name: 'Cà phê Muối',
        basePrice: 42000,
        isActive: true,
        isSoldOutManual: false,
        recipes: [{ id: 10, size: 'S', amount: 20, ingredient: { stock: 500, isRequiredForSale: true } }],
      },
    ]);

    const res = await service.findAll(false);

    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
      }),
    );
    expect(res).toHaveLength(1);
    expect(res[0].isOutOfStock).toBe(false);
  });

  it('lấy toàn bộ sản phẩm (kể cả món ẩn) kèm thống kê số lần đặt khi Admin gọi findAll(true)', async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: 1,
        name: 'Cà phê Muối',
        basePrice: 42000,
        isActive: true,
        isSoldOutManual: false,
        recipes: [{ id: 10, size: 'S', amount: 20, ingredient: { stock: 500 } }],
      },
      {
        id: 2,
        name: 'Món Đang Ẩn',
        basePrice: 39000,
        isActive: false,
        isSoldOutManual: true,
        recipes: [],
      },
    ]);
    mockPrisma.orderItem.findMany.mockResolvedValue([
      { productId: 1, quantity: 3 },
      { productId: 1, quantity: 2 },
    ]);

    const res = await service.findAll(true);

    expect(res).toHaveLength(2);
    expect(res[0].orderItemsCount).toBe(5);
    expect(res[1].isOutOfStock).toBe(true); // do isSoldOutManual = true
    expect(res[1].availableServings).toBe(0);
  });

  it('cho phép Admin tạo sản phẩm mới (create)', async () => {
    mockPrisma.product.create.mockResolvedValue({
      id: 15,
      name: 'Cold Brew Cam Vàng',
      description: 'Ủ lạnh 18 giờ thanh mát',
      basePrice: 52000,
      category: 'coldbrew',
      tag: 'Mới',
      isActive: true,
      isSoldOutManual: false,
      recipes: [{ id: 11, size: 'S', amount: 20, ingredient: { stock: 500, isRequiredForSale: true } }],
    });

    const created = await service.create({
      name: 'Cold Brew Cam Vàng',
      description: 'Ủ lạnh 18 giờ thanh mát',
      basePrice: 52000,
      category: 'coldbrew',
      tag: 'Mới',
    });

    expect(created.id).toBe(15);
    expect(created.category).toBe('coldbrew');
    expect(created.isOutOfStock).toBe(false);
  });

  it('cho phép Admin cập nhật thông tin và bật/tắt Ẩn món hoặc Báo hết hàng thủ công (toggleVisibility)', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ id: 1, name: 'Cà phê Đen' });
    mockPrisma.product.update.mockResolvedValue({
      id: 1,
      name: 'Cà phê Đen',
      isActive: false,
      isSoldOutManual: true,
      recipes: [],
    });

    const toggled = await service.toggleVisibility(1, {
      isActive: false,
      isSoldOutManual: true,
    });

    expect(toggled.isActive).toBe(false);
    expect(toggled.isSoldOutManual).toBe(true);
    expect(toggled.isOutOfStock).toBe(true);
  });

  it('cho phép Admin xóa sản phẩm (remove) và ném NotFoundException nếu không tồn tại', async () => {
    mockPrisma.product.findUnique.mockResolvedValueOnce({
      id: 8,
      name: 'Bánh Pain au Chocolat',
      recipes: [{ id: 101 }],
    });
    mockPrisma.product.delete.mockResolvedValue({});

    const delRes = await service.remove(8);
    expect(delRes.deleted).toBe(true);
    expect(delRes.removedRecipesCount).toBe(1);

    mockPrisma.product.findUnique.mockResolvedValueOnce(null);
    await expect(service.remove(999)).rejects.toThrow(NotFoundException);
  });

  describe('Task 6 — Bảo mật bí mật kinh doanh BOM & Giá vốn khỏi Menu', () => {
    it('loại bỏ recipes, cogs, gross profit, margin khi khách hàng xem menu (findAll/findOne không phải ADMIN)', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Cà phê Đen',
          basePrice: 25000,
          sizeUpchargeM: 5000,
          sizeUpchargeL: 10000,
          imageUrl: '/images/products/ca-phe-den.png',
          description: 'Cà phê đậm đà',
          category: 'vietnamese',
          isActive: true,
          isSoldOutManual: false,
          recipes: [
            {
              id: 1,
              productId: 1,
              size: 'S',
              amount: 25,
              ingredient: {
                id: 10,
                name: 'Hạt Robusta',
                stock: 500,
                costPerUnit: 180,
                isRequiredForSale: true,
              },
            },
          ],
        },
      ]);

      const [customerProduct] = await service.findAll(false, false);

      // Các trường nhạy cảm phải bị loại bỏ
      expect(customerProduct.recipes).toBeUndefined();
      expect(customerProduct.cogsSizeS).toBeUndefined();
      expect(customerProduct.cogsSizeM).toBeUndefined();
      expect(customerProduct.cogsSizeL).toBeUndefined();
      expect(customerProduct.grossProfitS).toBeUndefined();
      expect(customerProduct.marginPercentS).toBeUndefined();
      expect(customerProduct.recipesCount).toBeUndefined();
      expect(customerProduct.orderItemsCount).toBeUndefined();

      // Các trường khách hàng cần nhận phải có đầy đủ
      expect(customerProduct).toEqual({
        id: 1,
        name: 'Cà phê Đen',
        basePrice: 25000,
        sizeUpchargeM: 5000,
        sizeUpchargeL: 10000,
        imageUrl: '/images/products/ca-phe-den.png',
        description: 'Cà phê đậm đà',
        isOutOfStock: false,
        isSoldOutManual: false,
        outOfStockSizes: [],
        availableServings: 20,
        category: 'vietnamese',
      });
    });

    it('giữ nguyên đầy đủ recipes và cogs cho Admin (findAll/findOne với isAdmin = true)', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Cà phê Đen',
          basePrice: 25000,
          category: 'vietnamese',
          isActive: true,
          isSoldOutManual: false,
          recipes: [
            {
              id: 1,
              productId: 1,
              size: 'S',
              amount: 25,
              ingredient: {
                id: 10,
                name: 'Hạt Robusta',
                stock: 500,
                costPerUnit: 180,
                isRequiredForSale: true,
              },
            },
          ],
        },
      ]);

      const [adminProduct] = await service.findAll(false, true);

      expect(adminProduct.recipes).toBeDefined();
      expect(adminProduct.recipes).toHaveLength(1);
      expect(adminProduct.cogsSizeS).toBe(4500); // 25 * 180
      expect(adminProduct.grossProfitS).toBe(20500); // 25000 - 4500
      expect(adminProduct.marginPercentS).toBe(82);
    });

    it('findOne bảo vệ dữ liệu nhạy cảm cho khách hàng và hiển thị cho Admin', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 2,
        name: 'Trà Đào Cam Sả',
        basePrice: 45000,
        sizeUpchargeM: 6000,
        sizeUpchargeL: 12000,
        imageUrl: '/images/products/tra-dao.png',
        description: 'Thanh mát',
        category: 'tea',
        isActive: true,
        isSoldOutManual: false,
        recipes: [
          {
            id: 2,
            size: 'S',
            amount: 1,
            ingredient: { stock: 100, costPerUnit: 5000, isRequiredForSale: true },
          },
        ],
      });

      const customerItem = await service.findOne(2, false);
      expect(customerItem.recipes).toBeUndefined();
      expect(customerItem.cogsSizeS).toBeUndefined();
      expect(customerItem.id).toBe(2);
      expect(customerItem.name).toBe('Trà Đào Cam Sả');

      const adminItem = await service.findOne(2, true);
      expect(adminItem.recipes).toBeDefined();
      expect(adminItem.cogsSizeS).toBe(5000);
      expect(adminItem.grossProfitS).toBe(40000);
    });
 
    it('trả về outOfStockSizes chính xác khi chỉ hết ly size M, không khóa toàn bộ món', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 1,
        name: 'Cà phê Đen',
        basePrice: 25000,
        sizeUpchargeM: 5000,
        sizeUpchargeL: 10000,
        imageUrl: '/images/products/ca-phe-den.png',
        description: 'Cà phê đậm đà',
        category: 'vietnamese',
        isActive: true,
        isSoldOutManual: false,
        recipes: [
          // Size S còn ly
          { id: 1, size: 'S', amount: 1, ingredient: { code: 'PKG_CUP_S', stock: 50, isRequiredForSale: true } },
          // Size M hết ly
          { id: 2, size: 'M', amount: 1, ingredient: { code: 'PKG_CUP_M', stock: 0, isRequiredForSale: true } },
          // Size L còn ly
          { id: 3, size: 'L', amount: 1, ingredient: { code: 'PKG_CUP_L', stock: 30, isRequiredForSale: true } },
        ],
      });

      const res = await service.findOne(1, false);
      expect(res.outOfStockSizes).toEqual(['M']);
      expect(res.isOutOfStock).toBe(false); // Vẫn bán được Size S và L
      // Task 3.5 [MEDIUM-14]: Size M hết ly không được kéo availableServings của cả món về 0
      expect(res.availableServings).toBe(30);
    });

    it('khóa toàn bộ món (isOutOfStock = true) khi toàn bộ các size đều hết hàng', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 1,
        name: 'Cà phê Đen',
        basePrice: 25000,
        sizeUpchargeM: 5000,
        sizeUpchargeL: 10000,
        imageUrl: '/images/products/ca-phe-den.png',
        description: 'Cà phê đậm đà',
        category: 'vietnamese',
        isActive: true,
        isSoldOutManual: false,
        recipes: [
          { id: 1, size: 'S', amount: 1, ingredient: { code: 'PKG_CUP_S', stock: 0, isRequiredForSale: true } },
          { id: 2, size: 'M', amount: 1, ingredient: { code: 'PKG_CUP_M', stock: 0, isRequiredForSale: true } },
          { id: 3, size: 'L', amount: 1, ingredient: { code: 'PKG_CUP_L', stock: 0, isRequiredForSale: true } },
        ],
      });

      const res = await service.findOne(1, false);
      expect(res.outOfStockSizes).toEqual(['S', 'M', 'L']);
      expect(res.isOutOfStock).toBe(true);
    });
  });
});