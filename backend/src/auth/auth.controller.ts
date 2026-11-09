import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { RedeemPointsDto } from './dto/redeem-points.dto.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

interface AuthRequest extends Request {
  user: { userId: number; email: string };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** POST /auth/register — Giới hạn chống spam tạo tài khoản: tối đa 5 lần / phút */
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /** POST /auth/login — Giới hạn chống dò mật khẩu brute-force: tối đa 5 lần / phút */
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * GET /auth/me — Lấy thông tin user hiện tại kèm loyaltyPoints (Task 10)
   * Yêu cầu JWT Bearer Token
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@Request() req: AuthRequest) {
    return this.authService.getProfile(req.user.userId);
  }

  /**
   * PATCH /auth/profile — Cập nhật thông tin cá nhân và đổi mật khẩu
   * Yêu cầu JWT Bearer Token
   */
  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  updateProfile(@Request() req: AuthRequest, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.userId, dto);
  }

  /**
   * POST /auth/redeem-points — Đổi điểm Hạt Vàng lấy Voucher / Quà tặng (trừ điểm & cộng dồn voucher)
   * Yêu cầu JWT Bearer Token, kiểm tra chặt chẽ DTO chống điểm âm
   */
  @UseGuards(JwtAuthGuard)
  @Post('redeem-points')
  redeemPoints(
    @Request() req: AuthRequest,
    @Body() dto: RedeemPointsDto,
  ) {
    return this.authService.redeemPoints(
      req.user.userId,
      dto.points,
      dto.description,
      dto.voucherCode,
    );
  }

  /**
   * GET /auth/vouchers — Lấy danh sách mã giảm giá người dùng đang sở hữu
   */
  @UseGuards(JwtAuthGuard)
  @Get('vouchers')
  getUserVouchers(@Request() req: AuthRequest) {
    return this.authService.getUserVouchers(req.user.userId);
  }
}
