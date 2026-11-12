import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService, VOUCHER_CATALOG } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('AuthService - Loyalty Points Redemption & Voucher Accumulation', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    userVoucher: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    discountCode: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      userVoucher: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
      discountCode: {
        findUnique: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
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
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('VOUCHER_CATALOG', () => {
    it('defines fixed conversion catalog with required points and discount limits', () => {
      expect(VOUCHER_CATALOG.BREW10).toEqual({
        requiredPoints: 10,
        discountPercent: 10,
        maxDiscountAmount: 15000,
        minOrderAmount: 0,
      });
      expect(VOUCHER_CATALOG.BREWCOZY).toEqual({
        requiredPoints: 15,
        discountPercent: 15,
        maxDiscountAmount: 25000,
        minOrderAmount: 0,
      });
      expect(VOUCHER_CATALOG.BREW20).toEqual({
        requiredPoints: 20,
        discountPercent: 20,
        maxDiscountAmount: 25000,
        minOrderAmount: 60000,
      });
      expect(VOUCHER_CATALOG.WELCOME20).toEqual({
        requiredPoints: 20,
        discountPercent: 20,
        maxDiscountAmount: 25000,
        minOrderAmount: 50000,
      });
      expect(VOUCHER_CATALOG.BREW50).toEqual({
        requiredPoints: 50,
        discountPercent: 50,
        maxDiscountAmount: 60000,
        minOrderAmount: 120000,
      });
    });
  });

  describe('redeemPoints', () => {
    it('throws BadRequestException if points <= 0', async () => {
      await expect(service.redeemPoints(1, 0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.redeemPoints(1, -10)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.redeemPoints(999, 20)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException if user has insufficient loyalty points', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        fullName: 'Test User',
        phone: '0901234567',
        loyaltyPoints: 10,
        createdAt: new Date(),
      });

      await expect(service.redeemPoints(1, 20)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException if voucher code is invalid (not in catalog or discountCode)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        fullName: 'Test User',
        phone: '0901234567',
        loyaltyPoints: 100,
        createdAt: new Date(),
      });

      await expect(
        service.redeemPoints(1, 20, 'Đổi mã bậy', 'INVALID_CODE_999'),
      ).rejects.toThrow(
        new BadRequestException('Mã voucher đổi thưởng không hợp lệ'),
      );

      await expect(
        service.redeemPoints(1, 20, 'Đổi mã rỗng', ''),
      ).rejects.toThrow(
        new BadRequestException('Mã voucher đổi thưởng không hợp lệ'),
      );
    });

    it('throws BadRequestException and does not deduct loyaltyPoints if db DiscountCode has isActive === false', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        fullName: 'Test User',
        phone: '0901234567',
        loyaltyPoints: 100,
        createdAt: new Date(),
      });
      prisma.discountCode.findUnique.mockResolvedValue({
        code: 'INACTIVE20',
        discountPercent: 20,
        isActive: false,
      });

      await expect(
        service.redeemPoints(1, 20, undefined, 'INACTIVE20'),
      ).rejects.toThrow(
        new BadRequestException(
          'Mã voucher đổi thưởng hiện đang tạm ngưng áp dụng',
        ),
      );
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('throws BadRequestException if points < catalog.requiredPoints', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        fullName: 'Test User',
        phone: '0901234567',
        loyaltyPoints: 100,
        createdAt: new Date(),
      });

      // BREW50 requires 50 points, but client passes only 20 points
      await expect(
        service.redeemPoints(1, 20, 'Đổi mã BREW50 thiếu điểm', 'BREW50'),
      ).rejects.toThrow(
        new BadRequestException('Số Hạt Vàng không đủ để đổi mã này'),
      );
    });

    it('throws BadRequestException when updateMany returns count 0 (race condition / concurrent transaction)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        fullName: 'Test User',
        phone: '0901234567',
        loyaltyPoints: 50,
        createdAt: new Date(),
      });

      // Giả lập xung đột đồng thời: điểm hiện có bị trừ ở transaction khác
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.redeemPoints(1, 20, 'Đổi voucher tranh chấp điểm', 'BREW10'),
      ).rejects.toThrow(
        new BadRequestException(
          'Số dư Hạt Vàng không đủ hoặc đang có giao dịch đồng thời.',
        ),
      );
    });

    it('creates a new voucher with quantity=1 if user does not own it yet', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        fullName: 'Test User',
        phone: '0901234567',
        loyaltyPoints: 50,
        createdAt: new Date(),
      });

      prisma.user.updateMany.mockResolvedValue({ count: 1 });

      prisma.userVoucher.findUnique.mockResolvedValue(null);
      prisma.userVoucher.create.mockResolvedValue({
        id: 10,
        userId: 1,
        code: 'BREW10',
        quantity: 1,
        discountPercent: 10,
        minOrderAmount: 0,
        maxDiscountAmount: 15000,
      });
      prisma.userVoucher.findMany.mockResolvedValue([
        {
          id: 10,
          userId: 1,
          code: 'BREW10',
          quantity: 1,
          discountPercent: 10,
          minOrderAmount: 0,
          maxDiscountAmount: 15000,
        },
      ]);

      const res = await service.redeemPoints(
        1,
        20,
        'Đổi voucher BREW10',
        'BREW10',
      );

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 1, loyaltyPoints: { gte: 10 } },
        data: { loyaltyPoints: { decrement: 10 } },
      });
      expect(prisma.userVoucher.create).toHaveBeenCalledWith({
        data: {
          userId: 1,
          code: 'BREW10',
          quantity: 1,
          discountPercent: 10,
          minOrderAmount: 0,
          maxDiscountAmount: 15000,
        },
      });
      expect(res.success).toBe(true);
      expect(res.remainingPoints).toBe(40);
      expect(res.message).toContain('Trừ 10 Hạt Vàng');
      expect(res.voucher.quantity).toBe(1);
    });

    it('enforces server requiredPoints (10) when client sends excess points (50) for BREW10', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        fullName: 'Test User',
        phone: '0901234567',
        loyaltyPoints: 100,
        createdAt: new Date(),
      });

      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.userVoucher.findUnique.mockResolvedValue(null);
      prisma.userVoucher.create.mockResolvedValue({
        id: 11,
        userId: 1,
        code: 'BREW10',
        quantity: 1,
        discountPercent: 10,
        minOrderAmount: 0,
        maxDiscountAmount: 15000,
      });
      prisma.userVoucher.findMany.mockResolvedValue([]);

      const res = await service.redeemPoints(
        1,
        50,
        'Đổi BREW10 gửi thừa điểm',
        'BREW10',
      );

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 1, loyaltyPoints: { gte: 10 } },
        data: { loyaltyPoints: { decrement: 10 } },
      });
      expect(res.remainingPoints).toBe(90);
      expect(res.message).toContain('Trừ 10 Hạt Vàng');
      expect(res.message).not.toContain('Trừ 50 Hạt Vàng');
    });

    it('succeeds and deducts 10 when user has loyaltyPoints=20 and client sends excess points=50 for BREW10', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        fullName: 'Test User',
        phone: '0901234567',
        loyaltyPoints: 20,
        createdAt: new Date(),
      });

      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.userVoucher.findUnique.mockResolvedValue(null);
      prisma.userVoucher.create.mockResolvedValue({
        id: 12,
        userId: 1,
        code: 'BREW10',
        quantity: 1,
        discountPercent: 10,
        minOrderAmount: 0,
        maxDiscountAmount: 15000,
      });
      prisma.userVoucher.findMany.mockResolvedValue([]);

      const res = await service.redeemPoints(
        1,
        50,
        'Đổi BREW10 khi có 20 điểm nhưng client gửi 50',
        'BREW10',
      );

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 1, loyaltyPoints: { gte: 10 } },
        data: { loyaltyPoints: { decrement: 10 } },
      });
      expect(res.success).toBe(true);
      expect(res.remainingPoints).toBe(10);
      expect(res.message).toContain('Trừ 10 Hạt Vàng');
    });

    it('enforces server requiredPoints for BREW20 (20), BREW50 (50), and active dbVoucher discountPercent fallback', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        fullName: 'Test User',
        phone: '0901234567',
        loyaltyPoints: 100,
        createdAt: new Date(),
      });
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.userVoucher.findUnique.mockResolvedValue(null);
      prisma.userVoucher.create.mockImplementation(async ({ data }: any) => ({
        id: 20,
        ...data,
      }));
      prisma.userVoucher.findMany.mockResolvedValue([]);

      await service.redeemPoints(1, 35, 'Đổi BREW20', 'BREW20');
      expect(prisma.user.updateMany).toHaveBeenLastCalledWith({
        where: { id: 1, loyaltyPoints: { gte: 20 } },
        data: { loyaltyPoints: { decrement: 20 } },
      });

      await service.redeemPoints(1, 80, 'Đổi BREW50', 'BREW50');
      expect(prisma.user.updateMany).toHaveBeenLastCalledWith({
        where: { id: 1, loyaltyPoints: { gte: 50 } },
        data: { loyaltyPoints: { decrement: 50 } },
      });

      prisma.discountCode.findUnique.mockResolvedValue({
        code: 'CUSTOM25',
        discountPercent: 25,
        minOrderAmount: 30000,
        maxDiscountAmount: 20000,
        isActive: true,
      });
      await service.redeemPoints(1, 40, 'Đổi DB voucher', 'CUSTOM25');
      expect(prisma.user.updateMany).toHaveBeenLastCalledWith({
        where: { id: 1, loyaltyPoints: { gte: 25 } },
        data: { loyaltyPoints: { decrement: 25 } },
      });
    });

    it('accumulates (cộng dồn) voucher quantity if user already owns the voucher', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        fullName: 'Test User',
        phone: '0901234567',
        loyaltyPoints: 80,
        createdAt: new Date(),
      });

      prisma.user.updateMany.mockResolvedValue({ count: 1 });

      // User already owns BREW10 with quantity=1
      prisma.userVoucher.findUnique.mockResolvedValue({
        id: 10,
        userId: 1,
        code: 'BREW10',
        quantity: 1,
      });
      // After accumulation: quantity becomes 2
      prisma.userVoucher.update.mockResolvedValue({
        id: 10,
        userId: 1,
        code: 'BREW10',
        quantity: 2,
        discountPercent: 10,
        minOrderAmount: 0,
        maxDiscountAmount: 15000,
      });
      prisma.userVoucher.findMany.mockResolvedValue([
        {
          id: 10,
          userId: 1,
          code: 'BREW10',
          quantity: 2,
          discountPercent: 10,
          minOrderAmount: 0,
          maxDiscountAmount: 15000,
        },
      ]);

      const res = await service.redeemPoints(
        1,
        20,
        'Đổi thêm voucher BREW10',
        'BREW10',
      );

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 1, loyaltyPoints: { gte: 10 } },
        data: { loyaltyPoints: { decrement: 10 } },
      });
      expect(prisma.userVoucher.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { quantity: { increment: 1 }, maxDiscountAmount: 15000 },
      });
      expect(res.success).toBe(true);
      expect(res.voucher.quantity).toBe(2);
      expect(res.message).toContain('x2 mã BREW10');
    });

    it('chặn hack discountPercent từ client và trừ điểm atomic', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'attacker@brewlite.vn',
        fullName: 'Hacker',
        phone: '0999999999',
        loyaltyPoints: 100,
        createdAt: new Date(),
      });

      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.userVoucher.findUnique.mockResolvedValue(null);
      prisma.userVoucher.create.mockResolvedValue({
        id: 99,
        userId: 1,
        code: 'BREW10',
        quantity: 1,
        discountPercent: 10,
        minOrderAmount: 0,
        maxDiscountAmount: 15000,
      });
      prisma.userVoucher.findMany.mockResolvedValue([]);

      // Kẻ tấn công cố tình truyền discountPercent: 99 và minOrderAmount: 0
      const maliciousPayload = {
        code: 'BREW10',
        discountPercent: 99,
        minOrderAmount: 0,
      };

      const res = await service.redeemPoints(
        1,
        10,
        'Thử hack voucher 99%',
        maliciousPayload as any,
      );

      // 1. Kiểm tra atomic decrement chỉ xảy ra khi loyaltyPoints >= 10
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 1, loyaltyPoints: { gte: 10 } },
        data: { loyaltyPoints: { decrement: 10 } },
      });

      // 2. Kiểm tra discountPercent được lấy từ Catalog chuẩn (10%), TUYỆT ĐỐI không lấy 99% từ client
      expect(prisma.userVoucher.create).toHaveBeenCalledWith({
        data: {
          userId: 1,
          code: 'BREW10',
          quantity: 1,
          discountPercent: 10,
          minOrderAmount: 0,
          maxDiscountAmount: 15000,
        },
      });

      expect(res.success).toBe(true);
      expect(res.remainingPoints).toBe(90);
    });
  });
});
