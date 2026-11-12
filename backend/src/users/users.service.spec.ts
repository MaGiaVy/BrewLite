import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('UsersService — Staff & Admin User Management', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
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
        count: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAllStaff', () => {
    it('lấy danh sách nhân viên và quản trị viên', async () => {
      const mockUsers = [
        { id: 1, email: 'admin@brewlite.vn', role: Role.ADMIN },
        { id: 2, email: 'staff@brewlite.vn', role: Role.STAFF },
      ];
      prisma.user.findMany.mockResolvedValue(mockUsers);

      const result = await service.getAllStaff();
      expect(result).toEqual(mockUsers);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { role: { in: [Role.STAFF, Role.ADMIN] } },
        select: expect.any(Object),
        orderBy: { id: 'asc' },
      });
    });
  });

  describe('getStaffById', () => {
    it('trả về thông tin nhân viên nếu tìm thấy', async () => {
      const mockUser = { id: 2, email: 'staff@brewlite.vn', fullName: 'Staff 1' };
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getStaffById(2);
      expect(result).toEqual(mockUser);
    });

    it('ném NotFoundException nếu không tìm thấy nhân viên', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getStaffById(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createStaff', () => {
    it('tạo nhân viên thành công với role mặc định là STAFF', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 3,
          email: data.email,
          fullName: data.fullName,
          role: data.role,
          isActive: true,
        }),
      );

      const dto = {
        email: 'newstaff@brewlite.vn',
        password: 'password123',
        fullName: 'Nhân Viên Mới',
      };

      const result = await service.createStaff(dto, { email: 'manager@brewlite.vn' });
      expect(result.role).toBe(Role.STAFF);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'newstaff@brewlite.vn',
            role: Role.STAFF,
          }),
        }),
      );
    });

    it('ném BadRequestException khi tạo tài khoản có role ADMIN kể cả khi người tạo là Root Admin (admin@brewlite.vn)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const dto = {
        email: 'subadmin@brewlite.vn',
        password: 'password123',
        fullName: 'Phó Quản Trị',
        role: Role.ADMIN,
      };

      await expect(
        service.createStaff(dto, { email: 'admin@brewlite.vn' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('ném BadRequestException nếu người tạo không phải Root Admin khi tạo tài khoản ADMIN', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const dto = {
        email: 'hackeradmin@brewlite.vn',
        password: 'password123',
        fullName: 'Admin Giả Mạo',
        role: Role.ADMIN,
      };

      // Người tạo là admin thường hoặc staff
      await expect(
        service.createStaff(dto, { email: 'otheradmin@brewlite.vn' }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('ném BadRequestException nếu email đã tồn tại', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 1, email: 'duplicate@brewlite.vn' });

      await expect(
        service.createStaff({
          email: 'duplicate@brewlite.vn',
          password: 'password123',
          fullName: 'Trùng',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateStaff', () => {
    it('ném BadRequestException nếu tự khóa tài khoản của chính mình (dto.isActive === false && id === currentAdminId)', async () => {
      await expect(
        service.updateStaff(5, { isActive: false }, 5),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('ném NotFoundException nếu nhân viên cần cập nhật không tồn tại', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStaff(999, { fullName: 'Test' }, 1),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném BadRequestException nếu cố thay đổi địa chỉ email của Root Admin (admin@brewlite.vn)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'admin@brewlite.vn',
        role: Role.ADMIN,
        isActive: true,
      });

      await expect(
        service.updateStaff(1, { email: 'newadmin@brewlite.vn' }, 1),
      ).rejects.toThrow('Không thể thay đổi địa chỉ email của Quản trị viên Tối cao (Root Admin).');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('cho phép chính Root Admin (id === currentAdminId) cập nhật fullName, phone, position, password của mình', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'admin@brewlite.vn',
        role: Role.ADMIN,
        isActive: true,
      });
      prisma.user.update.mockResolvedValue({
        id: 1,
        email: 'admin@brewlite.vn',
        fullName: 'Root Admin Cập Nhật',
        phone: '0901234567',
        position: 'Chủ quán',
        role: Role.ADMIN,
        isActive: true,
      });

      const result = await service.updateStaff(
        1,
        {
          fullName: 'Root Admin Cập Nhật',
          phone: '0901234567',
          position: 'Chủ quán',
          password: 'newSecretPassword123',
          email: 'admin@brewlite.vn',
        },
        1,
      );
      expect(result.fullName).toBe('Root Admin Cập Nhật');
      expect(result.phone).toBe('0901234567');
      expect(result.position).toBe('Chủ quán');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            fullName: 'Root Admin Cập Nhật',
            phone: '0901234567',
            position: 'Chủ quán',
            passwordHash: expect.any(String),
          }),
        }),
      );
    });

    it('ném ForbiddenException nếu người gọi khác Root Admin (currentAdminId !== rootAdmin.id hoặc undefined) cố sửa thông tin Root Admin', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'admin@brewlite.vn',
        role: Role.ADMIN,
        isActive: true,
      });

      for (const payload of [
        { fullName: 'Bị sửa tên' },
        { phone: '0999999999' },
        { position: 'Bị sửa chức vụ' },
        { password: 'hackedPassword123' },
      ]) {
        await expect(service.updateStaff(1, payload, 2)).rejects.toThrow(
          ForbiddenException,
        );
        await expect(service.updateStaff(1, payload, undefined)).rejects.toThrow(
          ForbiddenException,
        );
      }

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('ném BadRequestException nếu cố thăng cấp bất kỳ nhân viên nào lên Role.ADMIN kể cả khi người gọi là Root Admin', async () => {
      prisma.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 1) {
          return Promise.resolve({
            id: 1,
            email: 'admin@brewlite.vn',
            role: Role.ADMIN,
            isActive: true,
          });
        }
        return Promise.resolve({
          id: 10,
          email: 'staff10@brewlite.vn',
          role: Role.STAFF,
          isActive: true,
        });
      });

      await expect(
        service.updateStaff(10, { role: Role.ADMIN }, 1),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('ném BadRequestException nếu Admin tự hạ quyền của chính mình (id === currentAdminId && dto.role !== Role.ADMIN)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 2,
        email: 'legacyadmin@brewlite.vn',
        role: Role.ADMIN,
        isActive: true,
      });

      await expect(
        service.updateStaff(2, { role: Role.STAFF }, 2),
      ).rejects.toThrow('Bạn không thể tự hạ quyền Quản trị viên của chính mình.');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('ném BadRequestException nếu hạ quyền bất kỳ tài khoản Role.ADMIN nào (bất kể activeAdminCount)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 2,
        email: 'legacyadmin@brewlite.vn',
        role: Role.ADMIN,
        isActive: true,
      });
      prisma.user.count.mockResolvedValue(2);

      await expect(
        service.updateStaff(2, { role: Role.STAFF }, 1),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('ném BadRequestException nếu vô hiệu hóa (isActive: false) bất kỳ tài khoản Role.ADMIN nào (bất kể activeAdminCount)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 2,
        email: 'legacyadmin@brewlite.vn',
        role: Role.ADMIN,
        isActive: true,
      });
      prisma.user.count.mockResolvedValue(2);

      await expect(
        service.updateStaff(2, { isActive: false }, 1),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('cập nhật thông tin staff bình thường thành công', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 10,
        email: 'staff10@brewlite.vn',
        role: Role.STAFF,
        isActive: true,
      });
      prisma.user.update.mockResolvedValue({
        id: 10,
        email: 'staff10@brewlite.vn',
        fullName: 'Staff Đã Cập Nhật',
        role: Role.STAFF,
        isActive: true,
      });

      const result = await service.updateStaff(
        10,
        { fullName: 'Staff Đã Cập Nhật' },
        1,
      );
      expect(result.fullName).toBe('Staff Đã Cập Nhật');
      expect(prisma.user.update).toHaveBeenCalled();
    });
  });

  describe('toggleStaffStatus', () => {
    it('ném BadRequestException nếu tự khóa tài khoản của chính mình (id === currentAdminId)', async () => {
      await expect(service.toggleStaffStatus(5, false, 5)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('ném NotFoundException nếu nhân viên không tồn tại', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.toggleStaffStatus(999, false, 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ném BadRequestException nếu cố khóa tài khoản Root Admin (admin@brewlite.vn)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'admin@brewlite.vn',
        role: Role.ADMIN,
        isActive: true,
      });

      await expect(service.toggleStaffStatus(1, false, 2)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('ném BadRequestException nếu cố khóa bất kỳ tài khoản Role.ADMIN nào (bất kể activeAdminCount)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 2,
        email: 'legacyadmin@brewlite.vn',
        role: Role.ADMIN,
        isActive: true,
      });
      prisma.user.count.mockResolvedValue(2);

      await expect(service.toggleStaffStatus(2, false, 1)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('khóa và mở khóa tài khoản STAFF bình thường', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 10,
        email: 'staff10@brewlite.vn',
        role: Role.STAFF,
        isActive: true,
      });
      prisma.user.update.mockResolvedValue({
        id: 10,
        email: 'staff10@brewlite.vn',
        isActive: false,
      });

      const result = await service.toggleStaffStatus(10, false, 1);
      expect(result.isActive).toBe(false);
      expect(prisma.user.update).toHaveBeenCalled();
    });
  });

  describe('deleteStaff', () => {
    it('ném BadRequestException nếu tự xóa tài khoản của chính mình (id === currentAdminId)', async () => {
      await expect(service.deleteStaff(5, 5)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('ném NotFoundException nếu nhân viên cần xóa không tồn tại', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deleteStaff(999, 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ném BadRequestException nếu cố xóa tài khoản Root Admin (admin@brewlite.vn)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'admin@brewlite.vn',
        role: Role.ADMIN,
      });

      await expect(service.deleteStaff(1, 2)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('ném BadRequestException nếu cố xóa bất kỳ tài khoản Role.ADMIN nào (bất kể activeAdminCount)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 2,
        email: 'legacyadmin@brewlite.vn',
        role: Role.ADMIN,
      });
      prisma.user.count.mockResolvedValue(2);

      await expect(service.deleteStaff(2, 1)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('xóa vĩnh viễn nhân viên nếu không bị ràng buộc dữ liệu', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 15,
        email: 'tempstaff@brewlite.vn',
        fullName: 'Nhân Viên Thời Vụ',
        role: Role.STAFF,
      });
      prisma.user.delete.mockResolvedValue({ id: 15 });

      const result = await service.deleteStaff(15, 1);
      expect(result.success).toBe(true);
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 15 } });
    });

    it('chuyển sang vô hiệu hóa nếu có ràng buộc ngoại lệ khi xóa (soft delete)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 16,
        email: 'orderstaff@brewlite.vn',
        fullName: 'Nhân Viên Bán Hàng',
        role: Role.STAFF,
      });
      prisma.user.delete.mockRejectedValue(new Error('Foreign key constraint failed'));
      prisma.user.update.mockResolvedValue({ id: 16, isActive: false });

      const result = await service.deleteStaff(16, 1);
      expect(result.success).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 16 },
        data: { isActive: false },
      });
    });
  });
});
