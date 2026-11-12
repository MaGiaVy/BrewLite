import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { Role } from '@prisma/client';
import * as crypto from 'node:crypto';
import { getJwtSecret } from '../auth/jwt-secret.helper.js';
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
    remove: any;
  };

  beforeEach(async () => {
    mockProductsService = {
      findAll: vi.fn(),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      toggleVisibility: vi.fn(),
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
});
