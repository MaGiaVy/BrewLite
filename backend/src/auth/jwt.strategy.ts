import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { getJwtSecret } from './jwt-secret.helper.js';

export interface JwtPayload {
  sub: number;
  email: string;
  role?: Role;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: JwtPayload) {
    const rawSub = payload?.sub;
    const userId = Number(rawSub);
    if (!rawSub || isNaN(userId)) {
      throw new UnauthorizedException(
        'Token không hợp lệ hoặc thiếu thông tin người dùng (User ID).',
      );
    }

    if (this.prisma?.user?.findUnique) {
      try {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, role: true, isActive: true },
        });

        if (!user) {
          throw new UnauthorizedException('Tài khoản không tồn tại.');
        }

        if (user.isActive === false) {
          throw new UnauthorizedException(
            'Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ Quản lý cửa hàng.',
          );
        }

        return {
          userId: user.id,
          email: user.email,
          role: user.role ?? Role.CUSTOMER,
        };
      } catch (err: any) {
        if (err instanceof UnauthorizedException) {
          throw err;
        }
        return {
          userId,
          email: payload.email,
          role: payload.role ?? Role.CUSTOMER,
        };
      }
    }

    return {
      userId,
      email: payload.email,
      role: payload.role ?? Role.CUSTOMER,
    };
  }
}
