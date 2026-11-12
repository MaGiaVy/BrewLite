import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import type { JwtPayload } from './jwt.strategy.js';

const SALT_ROUNDS = 10;

export interface VoucherCatalogItem {
  requiredPoints: number;
  discountPercent: number;
  maxDiscountAmount: number;
  minOrderAmount: number;
}

/**
 * Bảng quy đổi điểm thưởng chuẩn mực (Voucher Catalog)
 * Cố định server-side để chống can thiệp discountPercent / minOrderAmount từ client.
 */
export const VOUCHER_CATALOG: Record<string, VoucherCatalogItem> = {
  BREW10: {
    requiredPoints: 10,
    discountPercent: 10,
    maxDiscountAmount: 15000,
    minOrderAmount: 0,
  },
  BREWCOZY: {
    requiredPoints: 15,
    discountPercent: 15,
    maxDiscountAmount: 25000,
    minOrderAmount: 0,
  },
  BREW20: {
    requiredPoints: 20,
    discountPercent: 20,
    maxDiscountAmount: 25000,
    minOrderAmount: 60000,
  },
  WELCOME20: {
    requiredPoints: 20,
    discountPercent: 20,
    maxDiscountAmount: 25000,
    minOrderAmount: 50000,
  },
  BREW50: {
    requiredPoints: 50,
    discountPercent: 50,
    maxDiscountAmount: 60000,
    minOrderAmount: 120000,
  },
};

/** Dữ liệu user an toàn trả về client (ẩn passwordHash) */
function safeUser(u: {
  id: number;
  email: string;
  fullName: string | null;
  phone: string | null;
  role?: Role;
  position?: string | null;
  isActive?: boolean;
  loyaltyPoints: number;
  createdAt: Date;
  vouchers?: any[];
}) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone,
    role: u.role ?? Role.CUSTOMER,
    position: (u.role ?? Role.CUSTOMER) === Role.CUSTOMER ? null : ((u as any).position ?? null),
    isActive: (u as any).isActive !== false,
    loyaltyPoints: u.loyaltyPoints,
    createdAt: u.createdAt,
    vouchers: u.vouchers ?? [],
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // ─── Register ────────────────────────────────────────────────────────────────

  async register(dto: RegisterDto) {
    if (!dto.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dto.email)) {
      throw new BadRequestException('Email không hợp lệ');
    }
    if (!dto.password || dto.password.length < 6) {
      throw new BadRequestException('Mật khẩu phải có ít nhất 6 ký tự');
    }
    if (!dto.fullName || !dto.fullName.trim()) {
      throw new BadRequestException('Họ và tên không được để trống');
    }
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException(
        'Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        phone: dto.phone ?? null,
        position: null,
        role: Role.CUSTOMER,
      },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: safeUser(user),
    };
  }

  // ─── Login ───────────────────────────────────────────────────────────────────

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException(
        'Email hoặc mật khẩu không chính xác. Vui lòng thử lại.',
      );
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException(
        'Email hoặc mật khẩu không chính xác. Vui lòng thử lại.',
      );
    }

    if ((user as any).isActive === false) {
      throw new UnauthorizedException(
        'Tài khoản này hiện đang bị tạm khóa. Vui lòng liên hệ Quản lý cửa hàng.',
      );
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: safeUser(user),
    };
  }

  // ─── Get Profile ─────────────────────────────────────────────────────────────

  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { vouchers: true },
    });

    if (!user) {
      throw new NotFoundException('User không tồn tại');
    }

    return safeUser(user);
  }

  // ─── Update Profile ──────────────────────────────────────────────────────────

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User không tồn tại');
    }

    let newPasswordHash: string | undefined;

    if (dto.newPassword) {
      if (!dto.currentPassword) {
        throw new BadRequestException(
          'Vui lòng nhập mật khẩu hiện tại để đổi mật khẩu mới',
        );
      }

      const isMatch = await bcrypt.compare(
        dto.currentPassword,
        user.passwordHash,
      );
      if (!isMatch) {
        throw new BadRequestException('Mật khẩu hiện tại không chính xác');
      }

      newPasswordHash = await bcrypt.hash(dto.newPassword, 10);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        fullName: dto.fullName?.trim(),
        phone: dto.phone?.trim(),
        passwordHash: newPasswordHash,
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
  }

  // ─── Get User Vouchers ───────────────────────────────────────────────────────

  async getUserVouchers(userId: number) {
    return (this.prisma as any).userVoucher.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Redeem Loyalty Points ───────────────────────────────────────────────────

  async redeemPoints(
    userId: number,
    points: number,
    description?: string,
    voucherCode?:
      | string
      | {
          code: string;
          discountPercent?: number;
          minOrderAmount?: number;
          [key: string]: any;
        },
  ) {
    if (!points || points <= 0) {
      throw new BadRequestException('Số Hạt Vàng cần đổi phải lớn hơn 0');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User không tồn tại');
    }

    if (user.loyaltyPoints < points) {
      throw new BadRequestException(
        `Bạn không đủ Hạt Vàng (Cần ${points} Hạt Vàng, hiện có ${user.loyaltyPoints} Hạt Vàng).`,
      );
    }

    let catalogEntry: VoucherCatalogItem | undefined;
    let dbVoucher: any = null;
    let cleanCode: string | null = null;
    let effectivePointsToDeduct = points;

    if (voucherCode !== undefined && voucherCode !== null) {
      const rawCode =
        typeof voucherCode === 'string' ? voucherCode : voucherCode.code;

      if (rawCode && typeof rawCode === 'string' && rawCode.trim()) {
        cleanCode = rawCode.trim().toUpperCase();
        catalogEntry = VOUCHER_CATALOG[cleanCode];

        if (!catalogEntry && (this.prisma as any).discountCode?.findUnique) {
          try {
            dbVoucher = await (this.prisma as any).discountCode.findUnique({
              where: { code: cleanCode },
            });
          } catch {
            dbVoucher = null;
          }
        }

        if (!catalogEntry && !dbVoucher) {
          throw new BadRequestException('Mã voucher đổi thưởng không hợp lệ');
        }

        if (!catalogEntry && dbVoucher && dbVoucher.isActive === false) {
          throw new BadRequestException(
            'Mã voucher đổi thưởng hiện đang tạm ngưng áp dụng',
          );
        }

        const requiredPoints = catalogEntry
          ? catalogEntry.requiredPoints
          : Math.max(1, Math.round(dbVoucher.discountPercent) || 10);

        if (points < requiredPoints) {
          throw new BadRequestException('Số Hạt Vàng không đủ để đổi mã này');
        }

        effectivePointsToDeduct = requiredPoints;
      } else {
        throw new BadRequestException('Mã voucher đổi thưởng không hợp lệ');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Triệt tiêu Race Condition âm điểm (Atomic Lock)
      const updateRes = await tx.user.updateMany({
        where: {
          id: userId,
          loyaltyPoints: { gte: effectivePointsToDeduct }, // Chỉ trừ khi điểm hiện có >= effectivePointsToDeduct!
        },
        data: {
          loyaltyPoints: { decrement: effectivePointsToDeduct },
        },
      });

      if (updateRes.count === 0) {
        throw new BadRequestException(
          'Số dư Hạt Vàng không đủ hoặc đang có giao dịch đồng thời.',
        );
      }

      const updatedUser = await tx.user.findUnique({
        where: { id: userId },
      });

      const remainingPoints =
        updatedUser && updatedUser.loyaltyPoints !== user.loyaltyPoints
          ? updatedUser.loyaltyPoints
          : Math.max(0, user.loyaltyPoints - effectivePointsToDeduct);

      const finalUser = updatedUser
        ? { ...updatedUser, loyaltyPoints: remainingPoints }
        : { ...user, loyaltyPoints: remainingPoints };

      // 2. Cộng dồn số lượng mã voucher khả dụng (nếu đã có thì quantity + 1, chưa có thì tạo mới)
      let userVoucher = null;
      if (cleanCode) {
        const effectivePercent =
          catalogEntry?.discountPercent ?? dbVoucher?.discountPercent ?? 10;
        const effectiveMax =
          catalogEntry?.maxDiscountAmount ??
          dbVoucher?.maxDiscountAmount ??
          null;
        const effectiveMin =
          catalogEntry?.minOrderAmount ?? dbVoucher?.minOrderAmount ?? 0;

        const existing = await (tx as any).userVoucher.findUnique({
          where: {
            userId_code: {
              userId,
              code: cleanCode,
            },
          },
        });

        if (existing) {
          userVoucher = await (tx as any).userVoucher.update({
            where: { id: existing.id },
            data: {
              quantity: { increment: 1 },
              ...(effectiveMax !== null && effectiveMax !== undefined
                ? { maxDiscountAmount: effectiveMax }
                : {}),
            },
          });
        } else {
          userVoucher = await (tx as any).userVoucher.create({
            data: {
              userId,
              code: cleanCode,
              quantity: 1,
              discountPercent: effectivePercent,
              minOrderAmount: effectiveMin,
              ...(effectiveMax !== null && effectiveMax !== undefined
                ? { maxDiscountAmount: effectiveMax }
                : {}),
            },
          });
        }
      }

      const allVouchers = await (tx as any).userVoucher.findMany({
        where: { userId },
      });

      const qty = userVoucher ? userVoucher.quantity : 1;
      const message = userVoucher
        ? `Đã đổi thành công! Trừ ${effectivePointsToDeduct} Hạt Vàng. Bạn hiện đang sở hữu x${qty} mã ${userVoucher.code}.`
        : `Đã đổi thành công! Trừ ${effectivePointsToDeduct} Hạt Vàng.`;

      return {
        success: true,
        message,
        remainingPoints,
        voucher: userVoucher,
        vouchers: allVouchers,
        user: {
          ...safeUser(finalUser),
          vouchers: allVouchers,
        },
      };
    });
  }
}
