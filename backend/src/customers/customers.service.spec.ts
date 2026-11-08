import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CustomersService } from './customers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('CustomersService — Admin Customer Management API', () => {
  let service: CustomersService;
  let prisma: {
    user: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    order: {
      count: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      order: {
        count: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAllCustomers', () => {
    it('lấy danh sách toàn bộ khách hàng kèm số lượng đơn hàng đã đặt', async () => {
      const mockCustomers = [
        {
          id: 2,
          email: 'customer2@example.com',
          fullName: 'Khách hàng 2',
          phone: '0901234567',
          isActive: true,
          loyaltyPoints: 120,
          createdAt: new Date(),
          _count: { orders: 5 },
        },
        {
          id: 1,
          email: 'customer1@example.com',
          fullName: 'Khách hàng 1',
          phone: null,
          isActive: true,
          loyaltyPoints: 0,
          createdAt: new Date(),
          _count: { orders: 0 },
        },
      ];

      prisma.user.findMany.mockResolvedValue(mockCustomers);

      const result = await service.getAllCustomers();

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { role: Role.CUSTOMER },
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          isActive: true,
          loyaltyPoints: true,
          createdAt: true,
          _count: {
            select: { orders: true },
          },
        },
        orderBy: { id: 'desc' },
      });
      expect(result).toEqual(mockCustomers);
      expect(result).toHaveLength(2);
    });
  });

  describe('getCustomerById', () => {
    it('lấy chi tiết khách hàng theo ID thành công', async () => {
      const mockCustomer = {
        id: 10,
        email: 'test@example.com',
        fullName: 'Nguyễn Văn A',
        phone: '0987654321',
        role: Role.CUSTOMER,
        isActive: true,
        loyaltyPoints: 50,
        createdAt: new Date(),
        _count: { orders: 3 },
      };

      prisma.user.findUnique.mockResolvedValue(mockCustomer);

      const result = await service.getCustomerById(10);
      expect(result).toEqual(mockCustomer);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 10 },
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
          isActive: true,
          loyaltyPoints: true,
          createdAt: true,
          _count: {
            select: { orders: true },
          },
        },
      });
    });

    it('ném NotFoundException nếu khách hàng không tồn tại', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getCustomerById(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ném NotFoundException nếu người dùng tồn tại nhưng không phải Role.CUSTOMER', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 99,
        email: 'admin@brewlite.vn',
        role: Role.ADMIN,
      });

      await expect(service.getCustomerById(99)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createCustomer', () => {
    it('tạo khách hàng mới thành công với điểm Hạt Vàng luôn = 0 và mật khẩu mặc định 123456', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 1,
          email: data.email,
          fullName: data.fullName,
          phone: data.phone,
          isActive: data.isActive,
          loyaltyPoints: data.loyaltyPoints,
          createdAt: new Date(),
        }),
      );

      const dto = {
        email: '  NewCustomer@Example.COM  ',
        fullName: '  Lê Thị B  ',
        phone: '  0912345678  ',
      };

      const result = await service.createCustomer(dto);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'newcustomer@example.com' },
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'newcustomer@example.com',
            fullName: 'Lê Thị B',
            phone: '0912345678',
            role: Role.CUSTOMER,
            loyaltyPoints: 0, // RÀNG BUỘC SỐNG CÒN
            isActive: true,
          }),
        }),
      );

      // Điểm tích lũy khi tạo mới luôn phải là 0
      expect(result.loyaltyPoints).toBe(0);
      expect(result.email).toBe('newcustomer@example.com');
      expect(result.fullName).toBe('Lê Thị B');
    });

    it('tạo khách hàng mới với mật khẩu riêng được cấp', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 2,
          email: data.email,
          fullName: data.fullName,
          phone: data.phone,
          isActive: data.isActive,
          loyaltyPoints: data.loyaltyPoints,
          createdAt: new Date(),
        }),
      );

      const dto = {
        email: 'custompass@example.com',
        fullName: 'Trần Văn C',
        password: 'mysecurepassword123',
      };

      const result = await service.createCustomer(dto);

      expect(result.loyaltyPoints).toBe(0);
      expect(prisma.user.create).toHaveBeenCalled();
    });

    it('ném BadRequestException nếu email đã tồn tại trong hệ thống', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'duplicate@example.com',
      });

      await expect(
        service.createCustomer({
          email: 'duplicate@example.com',
          fullName: 'Trùng Email',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('updateCustomer', () => {
    it('ném NotFoundException nếu không tìm thấy khách hàng cần sửa', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateCustomer(999, { fullName: 'Tên Mới' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném NotFoundException nếu cố cập nhật tài khoản không phải Role.CUSTOMER (Admin/Staff)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'admin@brewlite.vn',
        role: Role.ADMIN,
      });

      await expect(
        service.updateCustomer(1, { fullName: 'Hacker Name' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('cập nhật thông tin khách hàng và hash lại mật khẩu mới nếu có', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 5,
        email: 'customer5@example.com',
        fullName: 'Tên Cũ',
        role: Role.CUSTOMER,
      });

      prisma.user.update.mockResolvedValue({
        id: 5,
        email: 'customer5@example.com',
        fullName: 'Tên Mới Cập Nhật',
        phone: '0988776655',
        isActive: true,
        loyaltyPoints: 300,
        createdAt: new Date(),
      });

      const result = await service.updateCustomer(5, {
        fullName: '  Tên Mới Cập Nhật  ',
        phone: ' 0988776655 ',
        password: 'newpassword123',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5 },
          data: expect.objectContaining({
            fullName: 'Tên Mới Cập Nhật',
            phone: '0988776655',
            passwordHash: expect.any(String),
          }),
        }),
      );
      expect(result.fullName).toBe('Tên Mới Cập Nhật');
    });

    it('tuyệt đối không cho phép cập nhật điểm Hạt Vàng loyaltyPoints', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 5,
        email: 'customer5@example.com',
        role: Role.CUSTOMER,
        loyaltyPoints: 100,
      });

      prisma.user.update.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 5,
          email: 'customer5@example.com',
          fullName: data.fullName || 'Tên Cũ',
          phone: null,
          isActive: true,
          loyaltyPoints: 100,
          createdAt: new Date(),
        }),
      );

      // Thử truyền bọc lén loyaltyPoints
      const roguePayload = {
        fullName: 'Hacker Name',
        loyaltyPoints: 999999,
      } as any;

      await service.updateCustomer(5, roguePayload);

      // Xác minh trong argument data của prisma.user.update KHÔNG chứa loyaltyPoints
      const updateCall = prisma.user.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('loyaltyPoints');
      expect(updateCall.data.fullName).toBe('Hacker Name');
    });
  });

  describe('toggleCustomerStatus', () => {
    it('ném NotFoundException nếu khách hàng không tồn tại', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.toggleCustomerStatus(404, false)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ném NotFoundException nếu tài khoản không phải Role.CUSTOMER', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 2,
        email: 'staff@example.com',
        role: Role.STAFF,
        isActive: true,
      });

      await expect(service.toggleCustomerStatus(2, false)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('chuyển đổi trạng thái tài khoản thành công (isActive = false / true)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 3,
        email: 'active@example.com',
        role: Role.CUSTOMER,
        isActive: true,
      });

      prisma.user.update.mockResolvedValue({
        id: 3,
        email: 'active@example.com',
        fullName: 'Khách Hàng',
        phone: null,
        isActive: false,
        loyaltyPoints: 50,
        createdAt: new Date(),
      });

      const result = await service.toggleCustomerStatus(3, false);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 3 },
        data: { isActive: false },
        select: expect.any(Object),
      });
      expect(result.isActive).toBe(false);
    });
  });

  describe('deleteCustomer (Smart Delete)', () => {
    it('ném NotFoundException nếu khách hàng cần xóa không tồn tại', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deleteCustomer(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ném NotFoundException nếu tài khoản cần xóa không phải Role.CUSTOMER (bảo vệ Admin/Staff khỏi bị xóa qua API customer)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'admin@brewlite.vn',
        role: Role.ADMIN,
      });

      await expect(service.deleteCustomer(1)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('xóa vĩnh viễn (Hard Delete) nếu khách hàng CHƯA có đơn hàng nào (ordersCount === 0)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 10,
        email: 'newuser@example.com',
        role: Role.CUSTOMER,
      });
      prisma.order.count.mockResolvedValue(0);
      prisma.user.delete.mockResolvedValue({ id: 10 });

      const result = await service.deleteCustomer(10);

      expect(prisma.order.count).toHaveBeenCalledWith({
        where: { userId: 10 },
      });
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 10 },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'Đã xóa hoàn toàn tài khoản khách hàng.',
      });
    });

    it('chuyển sang Tạm khóa (Soft Delete) nếu khách hàng ĐÃ có đơn hàng (ordersCount > 0)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 20,
        email: 'loyaluser@example.com',
        role: Role.CUSTOMER,
      });
      prisma.order.count.mockResolvedValue(7);
      prisma.user.update.mockResolvedValue({ id: 20, isActive: false });

      const result = await service.deleteCustomer(20);

      expect(prisma.order.count).toHaveBeenCalledWith({
        where: { userId: 20 },
      });
      // Không được xóa vật lý
      expect(prisma.user.delete).not.toHaveBeenCalled();
      // Khóa tài khoản
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 20 },
        data: { isActive: false },
      });
      expect(result).toEqual({
        success: true,
        softDeleted: true,
        message:
          'Khách hàng đã có 7 đơn hàng. Tài khoản đã được chuyển sang trạng thái Tạm khóa để bảo toàn dữ liệu doanh thu.',
      });
    });
  });
});
