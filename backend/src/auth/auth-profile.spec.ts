import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

describe('AuthProfile - Backend Customer Profile Update (PATCH /auth/profile)', () => {
  let service: AuthService;
  let controller: AuthController;
  let prisma: {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  const initialPassword = 'OldSecretPassword123!';
  let existingPasswordHash: string;

  beforeEach(async () => {
    existingPasswordHash = await bcrypt.hash(initialPassword, 10);

    prisma = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: {
            sign: vi.fn().mockReturnValue('mock-jwt-token'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    controller = module.get<AuthController>(AuthController);
  });

  describe('AuthService.updateProfile', () => {
    it('cập nhật Họ tên, SĐT thành công mà không đổi mật khẩu (không cần currentPassword)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'customer@brewlite.vn',
        fullName: 'Nguyễn Văn Cũ',
        phone: '0901111222',
        passwordHash: existingPasswordHash,
        role: Role.CUSTOMER,
        isActive: true,
        loyaltyPoints: 50,
        createdAt: new Date('2026-01-01'),
      });

      const updatedUser = {
        id: 1,
        email: 'customer@brewlite.vn',
        fullName: 'Nguyễn Văn Mới',
        phone: '0909999888',
        role: Role.CUSTOMER,
        isActive: true,
        loyaltyPoints: 50,
        createdAt: new Date('2026-01-01'),
      };
      prisma.user.update.mockResolvedValue(updatedUser);

      const dto: UpdateProfileDto = {
        fullName: '   Nguyễn Văn Mới   ',
        phone: '  0909999888  ',
      };

      const result = await service.updateProfile(1, dto);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          fullName: 'Nguyễn Văn Mới',
          phone: '0909999888',
          passwordHash: undefined,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
          isActive: true,
          loyaltyPoints: true,
          createdAt: true,
        },
      });
      expect(result).toEqual(updatedUser);
    });

    it('đổi mật khẩu thành công khi currentPassword khớp', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'customer@brewlite.vn',
        fullName: 'Nguyễn Văn A',
        phone: '0901234567',
        passwordHash: existingPasswordHash,
        role: Role.CUSTOMER,
        isActive: true,
        loyaltyPoints: 100,
        createdAt: new Date('2026-01-01'),
      });

      prisma.user.update.mockImplementation(async (args) => ({
        id: 1,
        email: 'customer@brewlite.vn',
        fullName: 'Nguyễn Văn A',
        phone: '0901234567',
        role: Role.CUSTOMER,
        isActive: true,
        loyaltyPoints: 100,
        createdAt: new Date('2026-01-01'),
      }));

      const newPassword = 'BrandNewPassword789!';
      const dto: UpdateProfileDto = {
        currentPassword: initialPassword,
        newPassword,
      };

      const result = await service.updateProfile(1, dto);

      expect(prisma.user.update).toHaveBeenCalled();
      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 1 });
      expect(updateArgs.data.passwordHash).toBeDefined();

      // Kiểm tra mật khẩu mới đã được băm an toàn bằng bcrypt
      const isNewPasswordValid = await bcrypt.compare(
        newPassword,
        updateArgs.data.passwordHash,
      );
      expect(isNewPasswordValid).toBe(true);
      expect(result.id).toBe(1);
    });

    it('báo lỗi BadRequestException khi currentPassword sai', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'customer@brewlite.vn',
        fullName: 'Nguyễn Văn A',
        phone: '0901234567',
        passwordHash: existingPasswordHash,
        role: Role.CUSTOMER,
        isActive: true,
        loyaltyPoints: 100,
        createdAt: new Date(),
      });

      const dto: UpdateProfileDto = {
        currentPassword: 'IncorrectPassword999!',
        newPassword: 'BrandNewPassword789!',
      };

      await expect(service.updateProfile(1, dto)).rejects.toThrow(
        new BadRequestException('Mật khẩu hiện tại không chính xác'),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('báo lỗi khi có newPassword mà không gửi currentPassword', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'customer@brewlite.vn',
        fullName: 'Nguyễn Văn A',
        phone: '0901234567',
        passwordHash: existingPasswordHash,
        role: Role.CUSTOMER,
        isActive: true,
        loyaltyPoints: 100,
        createdAt: new Date(),
      });

      const dto: UpdateProfileDto = {
        newPassword: 'BrandNewPassword789!',
      };

      await expect(service.updateProfile(1, dto)).rejects.toThrow(
        new BadRequestException(
          'Vui lòng nhập mật khẩu hiện tại để đổi mật khẩu mới',
        ),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('báo lỗi NotFoundException khi user không tồn tại trong hệ thống', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const dto: UpdateProfileDto = {
        fullName: 'Không Tìm Thấy',
      };

      await expect(service.updateProfile(999, dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('cập nhật đồng thời Họ tên, SĐT và đổi mật khẩu mới thành công', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 2,
        email: 'user2@brewlite.vn',
        fullName: 'Trần Văn Cũ',
        phone: '0911000111',
        passwordHash: existingPasswordHash,
        role: Role.CUSTOMER,
        isActive: true,
        loyaltyPoints: 30,
        createdAt: new Date('2026-02-01'),
      });

      prisma.user.update.mockResolvedValue({
        id: 2,
        email: 'user2@brewlite.vn',
        fullName: 'Trần Văn Mới',
        phone: '0988777666',
        role: Role.CUSTOMER,
        isActive: true,
        loyaltyPoints: 30,
        createdAt: new Date('2026-02-01'),
      });

      const dto: UpdateProfileDto = {
        fullName: 'Trần Văn Mới',
        phone: '0988777666',
        currentPassword: initialPassword,
        newPassword: 'MyNewSuperPassword2026',
      };

      const result = await service.updateProfile(2, dto);

      expect(prisma.user.update).toHaveBeenCalled();
      const updateCall = prisma.user.update.mock.calls[0][0];
      expect(updateCall.data.fullName).toBe('Trần Văn Mới');
      expect(updateCall.data.phone).toBe('0988777666');
      const isMatch = await bcrypt.compare(
        'MyNewSuperPassword2026',
        updateCall.data.passwordHash,
      );
      expect(isMatch).toBe(true);
      expect(result.fullName).toBe('Trần Văn Mới');
    });
  });

  describe('AuthController.updateProfile', () => {
    it('gọi AuthService.updateProfile với userId từ JWT Bearer req.user và DTO tương ứng', async () => {
      const mockResult = {
        id: 10,
        email: 'jwtuser@brewlite.vn',
        fullName: 'User Qua JWT',
        phone: '0933111222',
        role: Role.CUSTOMER,
        isActive: true,
        loyaltyPoints: 200,
        createdAt: new Date(),
      };

      const spy = vi.spyOn(service, 'updateProfile').mockResolvedValue(mockResult);

      const fakeReq = {
        user: { userId: 10, email: 'jwtuser@brewlite.vn' },
      } as any;

      const dto: UpdateProfileDto = {
        fullName: 'User Qua JWT',
        phone: '0933111222',
      };

      const res = await controller.updateProfile(fakeReq, dto);

      expect(spy).toHaveBeenCalledWith(10, dto);
      expect(res).toEqual(mockResult);
    });
  });
});
