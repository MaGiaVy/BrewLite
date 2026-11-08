import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { Role } from '@prisma/client';
import { ProductsController } from './products.controller.js';
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
});
