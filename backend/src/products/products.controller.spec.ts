import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { Role } from '@prisma/client';
import * as crypto from 'node:crypto';
import { getJwtSecret } from '../auth/jwt-secret.helper.js';
import { ROLES_KEY } from '../auth/roles.decorator.js';
import { ProductsController, extractUserFromRequest } from './products.controller.js';
import { ProductsService } from './products.service.js';

describe('ProductsController', () => {
  let controller: ProductsController;
  let mockProductsService: {
    findAll: any;
    findOne: any;
    create: any;
    update: any;
    toggleVisibility: any;
    toggleSoldOut: any;
    remove: any;
  };

  beforeEach(async () => {
    mockProductsService = {
      findAll: vi.fn(),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      toggleVisibility: vi.fn(),
      toggleSoldOut: vi.fn(),
      remove: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        {
          provide: ProductsService,
          useValue: mockProductsService,
        },
      ],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /products — Bảo vệ includeInactive và phân quyền dữ liệu', () => {
    it('buộc showAll = false và isAdmin = false khi khách vãng lai gọi với includeInactive=true', async () => {
      mockProductsService.findAll.mockReturnValue([]);

      await controller.findAll('true', undefined);

      expect(mockProductsService.findAll).toHaveBeenCalledWith(false, false);
    });

    it('buộc showAll = false và isAdmin = false khi khách hàng (CUSTOMER) gọi với includeInactive=true', async () => {
      mockProductsService.findAll.mockReturnValue([]);
      const mockReq = { user: { role: Role.CUSTOMER } };

      await controller.findAll('true', mockReq);

      expect(mockProductsService.findAll).toHaveBeenCalledWith(false, false);
    });

    it('cho phép showAll = true nhưng isAdmin = false khi STAFF gọi với includeInactive=true', async () => {
      mockProductsService.findAll.mockReturnValue([]);
      const mockReq = { user: { role: Role.STAFF } };

      await controller.findAll('true', mockReq);

      expect(mockProductsService.findAll).toHaveBeenCalledWith(true, false);
    });

    it('cho phép showAll = true và isAdmin = true khi ADMIN gọi với includeInactive=true', async () => {
      mockProductsService.findAll.mockReturnValue([]);
      const mockReq = { user: { role: Role.ADMIN } };

      await controller.findAll('true', mockReq);

      expect(mockProductsService.findAll).toHaveBeenCalledWith(true, true);
    });
  });

  describe('GET /products/:id — Phân quyền xem chi tiết món', () => {
    it('gọi findOne với isAdmin = false cho khách hàng thường', async () => {
      mockProductsService.findOne.mockReturnValue({});

      await controller.findOne(1, undefined);

      expect(mockProductsService.findOne).toHaveBeenCalledWith(1, false);
    });

    it('gọi findOne với isAdmin = true cho Admin', async () => {
      mockProductsService.findOne.mockReturnValue({});
      const mockReq = { user: { role: Role.ADMIN } };

      await controller.findOne(1, mockReq);

      expect(mockProductsService.findOne).toHaveBeenCalledWith(1, true);
    });
  });

  describe('extractUserFromRequest — BE-C01: Raw Authorization header fallback removal', () => {
    function createTestToken(payload: any): string {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const secret = getJwtSecret();
      const signature = crypto
        .createHmac('sha256', secret)
        .update(`${header}.${body}`)
        .digest('base64url');
      return `${header}.${body}.${signature}`;
    }

    it('trả về null khi req.user vắng mặt kể cả với token Admin đã hết hạn hoặc hợp lệ trong raw Authorization header', () => {
      const expiredPayload = {
        sub: 1,
        email: 'admin@brewlite.vn',
        role: Role.ADMIN,
        exp: Math.floor(Date.now() / 1000) - 3600,
      };
      expect(
        extractUserFromRequest({ headers: { authorization: `Bearer ${createTestToken(expiredPayload)}` } }),
      ).toBeNull();

      const validPayload = {
        sub: 99,
        email: 'locked@brewlite.vn',
        role: Role.ADMIN,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      expect(
        extractUserFromRequest({ headers: { authorization: `Bearer ${createTestToken(validPayload)}` } }),
      ).toBeNull();
    });

    it('GET /products?includeInactive=true và GET /products/:id buộc showAll=false, isAdmin=false khi req.user là null dù có raw ADMIN header', async () => {
      const validPayload = {
        sub: 99,
        email: 'locked@brewlite.vn',
        role: Role.ADMIN,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const req = { user: null, headers: { authorization: `Bearer ${createTestToken(validPayload)}` } };
      mockProductsService.findAll.mockReturnValue([]);
      mockProductsService.findOne.mockReturnValue({});

      await controller.findAll('true', req);
      expect(mockProductsService.findAll).toHaveBeenCalledWith(false, false);

      await controller.findOne(5, req);
      expect(mockProductsService.findOne).toHaveBeenCalledWith(5, false);
    });
  });

  describe('PATCH /products/:id/sold-out — RBAC & Delegation', () => {
    const reflector = new Reflector();

    it('guards toggleSoldOut with @Roles(Role.STAFF, Role.ADMIN) while toggleVisibility stays @Roles(Role.ADMIN)', () => {
      const soldOutRoles = reflector.get(
        ROLES_KEY,
        ProductsController.prototype.toggleSoldOut,
      );
      const visibilityRoles = reflector.get(
        ROLES_KEY,
        ProductsController.prototype.toggleVisibility,
      );

      expect(soldOutRoles).toEqual([Role.STAFF, Role.ADMIN]);
      expect(visibilityRoles).toEqual([Role.ADMIN]);
    });

    it('delegates controller.toggleSoldOut(1, { isSoldOutManual: true }) to productsService.toggleSoldOut with isAdmin based on req.user.role', async () => {
      const dto = { isSoldOutManual: true };
      const expected = { id: 1, isSoldOutManual: true };
      mockProductsService.toggleSoldOut.mockResolvedValue(expected);

      const staffRes = await controller.toggleSoldOut(1, dto, {
        user: { role: Role.STAFF },
      });
      expect(mockProductsService.toggleSoldOut).toHaveBeenCalledWith(1, dto, false);
      expect(staffRes).toEqual(expected);

      const adminRes = await controller.toggleSoldOut(1, dto, {
        user: { role: Role.ADMIN },
      });
      expect(mockProductsService.toggleSoldOut).toHaveBeenCalledWith(1, dto, true);
      expect(adminRes).toEqual(expected);
    });

    it('ProductsService.toggleSoldOut hides recipes and COGS for STAFF (isAdmin=false) while keeping isSoldOutManual and isOutOfStock', async () => {
      const mockPrisma = {
        product: {
          findUnique: vi.fn().mockResolvedValue({ id: 1, name: 'Cà phê Đen', isActive: true }),
          update: vi.fn().mockResolvedValue({
            id: 1,
            name: 'Cà phê Đen',
            basePrice: 29000,
            category: 'vietnamese',
            isActive: true,
            isSoldOutManual: true,
            recipes: [
              {
                id: 1,
                size: 'S',
                amount: 20,
                ingredient: { id: 10, stock: 200, costPerUnit: 200, isRequiredForSale: true },
              },
            ],
          }),
        },
      };
      const realService = new ProductsService(mockPrisma as any);

      const staffResult: any = await realService.toggleSoldOut(1, { isSoldOutManual: true }, false);
      expect(staffResult.isSoldOutManual).toBe(true);
      expect(staffResult.isOutOfStock).toBe(true);
      expect(staffResult.recipes).toBeUndefined();
      expect(staffResult.cogsSizeS).toBeUndefined();
      expect(staffResult.cogsSizeM).toBeUndefined();
      expect(staffResult.cogsSizeL).toBeUndefined();
      expect(staffResult.grossProfitS).toBeUndefined();
      expect(staffResult.marginPercentS).toBeUndefined();

      const adminResult: any = await realService.toggleSoldOut(1, { isSoldOutManual: true }, true);
      expect(adminResult.isSoldOutManual).toBe(true);
      expect(adminResult.recipes).toBeDefined();
      expect(adminResult.cogsSizeS).toBe(4000);
    });
  });
});
