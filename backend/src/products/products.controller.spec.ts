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
    it('buộc showAll = false và isAdmin = false khi khách vãng lai gọi với includeInactive=true', () => {
      mockProductsService.findAll.mockReturnValue([]);

      controller.findAll('true', undefined);

      expect(mockProductsService.findAll).toHaveBeenCalledWith(false, false);
    });

    it('buộc showAll = false và isAdmin = false khi khách hàng (CUSTOMER) gọi với includeInactive=true', () => {
      mockProductsService.findAll.mockReturnValue([]);
      const mockReq = { user: { role: Role.CUSTOMER } };

      controller.findAll('true', mockReq);

      expect(mockProductsService.findAll).toHaveBeenCalledWith(false, false);
    });

    it('cho phép showAll = true nhưng isAdmin = false khi STAFF gọi với includeInactive=true', () => {
      mockProductsService.findAll.mockReturnValue([]);
      const mockReq = { user: { role: Role.STAFF } };

      controller.findAll('true', mockReq);

      expect(mockProductsService.findAll).toHaveBeenCalledWith(true, false);
    });

    it('cho phép showAll = true và isAdmin = true khi ADMIN gọi với includeInactive=true', () => {
      mockProductsService.findAll.mockReturnValue([]);
      const mockReq = { user: { role: Role.ADMIN } };

      controller.findAll('true', mockReq);

      expect(mockProductsService.findAll).toHaveBeenCalledWith(true, true);
    });
  });

  describe('GET /products/:id — Phân quyền xem chi tiết món', () => {
    it('gọi findOne với isAdmin = false cho khách hàng thường', () => {
      mockProductsService.findOne.mockReturnValue({});

      controller.findOne(1, undefined);

      expect(mockProductsService.findOne).toHaveBeenCalledWith(1, false);
    });

    it('gọi findOne với isAdmin = true cho Admin', () => {
      mockProductsService.findOne.mockReturnValue({});
      const mockReq = { user: { role: Role.ADMIN } };

      controller.findOne(1, mockReq);

      expect(mockProductsService.findOne).toHaveBeenCalledWith(1, true);
    });
  });

  describe('extractUserFromRequest — Kiểm tra thời hạn token (CRIT-03)', () => {
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

    it('từ chối token Admin đã hết hạn (exp trong quá khứ) và trả về null', () => {
      const expiredPayload = {
        sub: 1,
        email: 'admin@brewlite.vn',
        role: Role.ADMIN,
        exp: Math.floor(Date.now() / 1000) - 3600, // Hết hạn 1 tiếng trước
      };
      const token = createTestToken(expiredPayload);
      const req = { headers: { authorization: `Bearer ${token}` } };

      const user = extractUserFromRequest(req);
      expect(user).toBeNull();
    });

    it('chấp nhận token hợp lệ và còn hạn', () => {
      const validPayload = {
        sub: 2,
        email: 'staff@brewlite.vn',
        role: Role.STAFF,
        exp: Math.floor(Date.now() / 1000) + 3600, // Còn hạn 1 tiếng
      };
      const token = createTestToken(validPayload);
      const req = { headers: { authorization: `Bearer ${token}` } };

      const user = extractUserFromRequest(req);
      expect(user).not.toBeNull();
      expect(user?.role).toBe(Role.STAFF);
    });
  });
});
