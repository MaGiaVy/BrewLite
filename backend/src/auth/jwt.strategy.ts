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
    if (this.prisma?.user?.findUnique) {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
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
    }

    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role ?? Role.CUSTOMER,
    };
  }
}
